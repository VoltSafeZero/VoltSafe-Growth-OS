import { useState, useMemo, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, Loader2, Navigation, Clock, Anchor, MapPin, ExternalLink, RotateCcw, Target } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { WheelPicker, WheelGroup, type WheelOption } from "@/components/ui/wheel-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type PlannerLead = {
  id: number;
  company: string;
  marina_lat: number;
  marina_lng: number;
  marina_address: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  slips: string | null;
  status: string;
};

type PlannedStop = {
  lead: PlannerLead;
  driveKm: number;
  driveMin: number;
  arriveMin: number;
  departMin: number;
};

type Plan = {
  stops: PlannedStop[];
  totalDriveKm: number;
  totalDriveMin: number;
  totalElapsedMin: number;
  returnDriveKm: number;
  returnDriveMin: number;
  candidatesConsidered: number;
};

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function parseSlips(s: string | null): number {
  if (!s) return 0;
  const m = String(s).match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

function fmtMin(min: number): string {
  if (!isFinite(min)) return "—";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function fmtClock(startTotalMin: number, addMin: number): string {
  const total = startTotalMin + Math.round(addMin);
  const h = Math.floor((total % (24 * 60)) / 60);
  const m = total % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function planRoute(
  start: { lat: number; lng: number },
  candidates: PlannerLead[],
  opts: { hoursAvailable: number; visitMin: number; avgSpeedKmh: number; returnToStart: boolean }
): Plan {
  const budgetMin = opts.hoursAvailable * 60;
  const stops: PlannedStop[] = [];
  let cur = start;
  let elapsed = 0;
  const pool = candidates.slice();
  while (pool.length) {
    let bestIdx = -1;
    let bestKm = Infinity;
    for (let i = 0; i < pool.length; i++) {
      const d = haversineKm(cur.lat, cur.lng, pool[i].marina_lat, pool[i].marina_lng);
      if (d < bestKm) { bestKm = d; bestIdx = i; }
    }
    if (bestIdx === -1) break;
    const lead = pool[bestIdx];
    const driveMin = (bestKm / opts.avgSpeedKmh) * 60;
    const arriveMin = elapsed + driveMin;
    const departMin = arriveMin + opts.visitMin;
    const backKm = haversineKm(lead.marina_lat, lead.marina_lng, start.lat, start.lng);
    const backMin = (backKm / opts.avgSpeedKmh) * 60;
    const projectedTotal = opts.returnToStart ? departMin + backMin : departMin;
    if (projectedTotal > budgetMin) {
      pool.splice(bestIdx, 1);
      continue;
    }
    stops.push({ lead, driveKm: bestKm, driveMin, arriveMin, departMin });
    elapsed = departMin;
    cur = { lat: lead.marina_lat, lng: lead.marina_lng };
    pool.splice(bestIdx, 1);
  }
  const last = stops[stops.length - 1];
  const returnDriveKm = last ? haversineKm(last.lead.marina_lat, last.lead.marina_lng, start.lat, start.lng) : 0;
  const returnDriveMin = (returnDriveKm / opts.avgSpeedKmh) * 60;
  const totalDriveKm = stops.reduce((sum, s) => sum + s.driveKm, 0) + (opts.returnToStart ? returnDriveKm : 0);
  const totalDriveMin = stops.reduce((sum, s) => sum + s.driveMin, 0) + (opts.returnToStart ? returnDriveMin : 0);
  const totalElapsedMin = (last ? last.departMin : 0) + (opts.returnToStart ? returnDriveMin : 0);
  return {
    stops, totalDriveKm, totalDriveMin, totalElapsedMin,
    returnDriveKm, returnDriveMin, candidatesConsidered: candidates.length,
  };
}

function buildGoogleMapsUrl(start: { lat: number; lng: number }, stops: PlannedStop[], returnToStart: boolean): string {
  if (!stops.length) return "";
  const origin = `${start.lat},${start.lng}`;
  const last = stops[stops.length - 1];
  const destination = returnToStart ? origin : `${last.lead.marina_lat},${last.lead.marina_lng}`;
  const waypoints = (returnToStart ? stops : stops.slice(0, -1))
    .map(s => `${s.lead.marina_lat},${s.lead.marina_lng}`).join("|");
  const params = new URLSearchParams({ api: "1", origin, destination, travelmode: "driving" });
  if (waypoints) params.set("waypoints", waypoints);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

// ── Wheel option builders ────────────────────────────────────────────
const HOUR_OPTIONS: WheelOption[] = Array.from({ length: 24 }, (_, h) => {
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { value: h, label: `${h12} ${period}` };
});
const MINUTE_OPTIONS: WheelOption[] = Array.from({ length: 12 }, (_, i) => {
  const m = i * 5;
  return { value: m, label: String(m).padStart(2, "0") };
});
const VISIT_MIN_OPTIONS: WheelOption[] = [10, 15, 20, 30, 45, 60, 75, 90, 120, 150, 180].map(m => ({ value: m, label: `${m} min` }));
const SPEED_OPTIONS: WheelOption[] = [20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120].map(s => ({ value: s, label: `${s} km/h` }));
const SLIP_OPTIONS: WheelOption[] = [0, 25, 50, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500].map(s => ({ value: s, label: s === 0 ? "Any" : `${s}+` }));
const RADIUS_OPTIONS: WheelOption[] = [5, 10, 15, 20, 30, 40, 50, 75, 100, 150, 200, 250, 300, 400, 500].map(r => ({ value: r, label: `${r} km` }));

function buildDayOptions(): WheelOption[] {
  const labels: WheelOption[] = [];
  const days = 14;
  const today = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(today.getTime() + i * 86_400_000);
    const dayLabel =
      i === 0 ? "Today" :
      i === 1 ? "Tomorrow" :
      d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    labels.push({ value: i, label: dayLabel });
  }
  return labels;
}

const STAGE_LABELS: Record<string, string> = {
  all: "All stages",
  new: "New", contacted: "Contacted", meeting_scheduled: "Meeting scheduled",
  qualified: "Qualified", proposal_sent: "Proposal sent", negotiation: "Negotiation",
  converted: "Closed Won", lost: "Closed Lost",
};

function dayHourMinToTotalMin(dayOffset: number, hour: number, minute: number): number {
  return dayOffset * 24 * 60 + hour * 60 + minute;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userLocation: { lat: number; lng: number } | null;
  defaultStageFilter?: string;
  /** When provided, planning uses ONLY these leads instead of fetching by radius. */
  preselectedLeads?: PlannerLead[] | null;
}

export function MarinasDayPlannerDialog({
  open, onOpenChange, userLocation, defaultStageFilter, preselectedLeads,
}: Props) {
  const { toast } = useToast();
  const dayOptions = useMemo(buildDayOptions, []);

  // Time wheels (start)
  const [startDay, setStartDay] = useState(0);
  const [startHour, setStartHour] = useState(9);
  const [startMin, setStartMin] = useState(0);
  // Time wheels (stop)
  const [stopDay, setStopDay] = useState(0);
  const [stopHour, setStopHour] = useState(17);
  const [stopMin, setStopMin] = useState(0);
  // Trip params
  const [visitMin, setVisitMin] = useState(30);
  const [avgSpeedKmh, setAvgSpeedKmh] = useState(50);
  const [minSlips, setMinSlips] = useState<number>(0);
  const [searchRadiusKm, setSearchRadiusKm] = useState<number>(50);
  const [stageFilter, setStageFilter] = useState<string>(defaultStageFilter || "all");
  const [returnToStart, setReturnToStart] = useState(true);

  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startTotalMin = dayHourMinToTotalMin(startDay, startHour, startMin);
  const stopTotalMin = dayHourMinToTotalMin(stopDay, stopHour, stopMin);
  const windowMin = stopTotalMin - startTotalMin;
  const hoursAvailable = windowMin > 0 ? windowMin / 60 : 0;

  // Reset plan whenever scope changes
  useEffect(() => { setPlan(null); }, [startTotalMin, stopTotalMin, visitMin, avgSpeedKmh, minSlips, searchRadiusKm, stageFilter, returnToStart, preselectedLeads]);

  // Clear stale plan/error/loading whenever the dialog closes so reopening starts fresh.
  useEffect(() => {
    if (!open) {
      setPlan(null);
      setError(null);
      setLoading(false);
    }
  }, [open]);

  const usingPreselected = !!(preselectedLeads && preselectedLeads.length > 0);

  const runPlan = async () => {
    if (!userLocation) {
      toast({ title: "Location needed", description: "Enable My Location on the map first.", variant: "destructive" });
      return;
    }
    if (windowMin <= 0) {
      toast({ title: "Stop time must be after start time", variant: "destructive" });
      return;
    }
    setLoading(true);
    setError(null);
    setPlan(null);
    try {
      let candidates: PlannerLead[];
      if (usingPreselected) {
        candidates = preselectedLeads!.filter(l => typeof l.marina_lat === "number" && typeof l.marina_lng === "number");
      } else {
        const url = `/api/leads/nearby?lat=${userLocation.lat}&lng=${userLocation.lng}&radius=${searchRadiusKm}&limit=500`;
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) throw new Error("Failed to fetch nearby marinas");
        const all: PlannerLead[] = await res.json();
        candidates = all.filter(l => {
          if (stageFilter !== "all" && l.status !== stageFilter) return false;
          if (minSlips > 0 && parseSlips(l.slips) < minSlips) return false;
          if (typeof l.marina_lat !== "number" || typeof l.marina_lng !== "number") return false;
          return true;
        });
      }
      if (!candidates.length) {
        setError(usingPreselected
          ? "No selected marinas have map coordinates."
          : "No marinas matched your scope within reach. Widen the radius, slip count, or stage filter.");
        return;
      }
      const result = planRoute(userLocation, candidates, { hoursAvailable, visitMin, avgSpeedKmh, returnToStart });
      if (!result.stops.length) {
        setError("Couldn't fit any marinas in your time window. Try a longer window, fewer minutes per visit, or a higher driving speed.");
        return;
      }
      setPlan(result);
    } catch (e: any) {
      setError(e.message || "Plan failed");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { setPlan(null); setError(null); };
  const mapsUrl = plan && userLocation ? buildGoogleMapsUrl(userLocation, plan.stops, returnToStart) : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto" data-testid="dialog-day-planner">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Plan my marina day
          </DialogTitle>
          <DialogDescription>
            Spin the wheels to set your day. Cortex builds the most efficient driving route from your location.
          </DialogDescription>
        </DialogHeader>

        {!plan ? (
          <div className="space-y-5">
            {usingPreselected && (
              <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-primary/10 border border-primary/30 text-primary">
                <Target className="h-3.5 w-3.5" />
                Planning route across <strong>{preselectedLeads!.length}</strong> selected marinas — radius & filters ignored.
              </div>
            )}

            {/* Start time */}
            <div>
              <Label className="text-xs mb-1.5 block">Start time</Label>
              <WheelGroup>
                <WheelPicker options={dayOptions} value={startDay} onChange={setStartDay} width="9rem" data-testid="wheel-start-day" />
                <WheelPicker options={HOUR_OPTIONS} value={startHour} onChange={setStartHour} width="5rem" data-testid="wheel-start-hour" />
                <WheelPicker options={MINUTE_OPTIONS} value={startMin} onChange={setStartMin} width="4rem" data-testid="wheel-start-min" />
              </WheelGroup>
            </div>

            {/* Stop time */}
            <div>
              <Label className="text-xs mb-1.5 block">Stop time</Label>
              <WheelGroup>
                <WheelPicker options={dayOptions} value={stopDay} onChange={setStopDay} width="9rem" data-testid="wheel-stop-day" />
                <WheelPicker options={HOUR_OPTIONS} value={stopHour} onChange={setStopHour} width="5rem" data-testid="wheel-stop-hour" />
                <WheelPicker options={MINUTE_OPTIONS} value={stopMin} onChange={setStopMin} width="4rem" data-testid="wheel-stop-min" />
              </WheelGroup>
              <p className="text-[11px] text-muted-foreground mt-1">
                Window: <span className={windowMin <= 0 ? "text-destructive" : "text-foreground"}>{windowMin > 0 ? fmtMin(windowMin) : "Stop must be after start"}</span>
              </p>
            </div>

            {/* Visit / speed */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block">Minutes per visit</Label>
                <WheelGroup className="justify-center">
                  <WheelPicker options={VISIT_MIN_OPTIONS} value={visitMin} onChange={setVisitMin} width="6rem" data-testid="wheel-visit-min" />
                </WheelGroup>
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Avg driving speed</Label>
                <WheelGroup className="justify-center">
                  <WheelPicker options={SPEED_OPTIONS} value={avgSpeedKmh} onChange={setAvgSpeedKmh} width="6rem" data-testid="wheel-avg-speed" />
                </WheelGroup>
              </div>
            </div>

            {/* Slips / radius — hidden when preselected (overridden by selection) */}
            {!usingPreselected && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs mb-1.5 block">Min slips</Label>
                  <WheelGroup className="justify-center">
                    <WheelPicker options={SLIP_OPTIONS} value={minSlips} onChange={setMinSlips} width="6rem" data-testid="wheel-min-slips" />
                  </WheelGroup>
                </div>
                <div>
                  <Label className="text-xs mb-1.5 block">Search radius (within)</Label>
                  <WheelGroup className="justify-center">
                    <WheelPicker options={RADIUS_OPTIONS} value={searchRadiusKm} onChange={setSearchRadiusKm} width="6rem" data-testid="wheel-radius" />
                  </WheelGroup>
                </div>
              </div>
            )}

            {/* Stage filter + return-to-start */}
            <div className="grid grid-cols-2 gap-3 items-end">
              {!usingPreselected && (
                <div>
                  <Label className="text-xs mb-1.5 block">Stage filter</Label>
                  <Select value={stageFilter} onValueChange={setStageFilter}>
                    <SelectTrigger className="h-9 text-xs" data-testid="select-planner-stage">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(STAGE_LABELS).map(([v, l]) => (
                        <SelectItem key={v} value={v}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex items-center gap-2 pb-1">
                <Checkbox id="return-to-start" checked={returnToStart}
                  onCheckedChange={(v) => setReturnToStart(v === true)}
                  data-testid="checkbox-return-to-start" />
                <Label htmlFor="return-to-start" className="text-xs cursor-pointer">Return to start</Label>
              </div>
            </div>

            {!userLocation && (
              <div className="text-xs text-amber-400 flex items-center gap-2">
                <MapPin className="h-3 w-3" /> Tap "My Location" on the map first so Cortex knows where you're starting from.
              </div>
            )}
            {error && (
              <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded p-2" data-testid="text-plan-error">
                {error}
              </div>
            )}

            <div className="flex justify-between items-center pt-1 border-t border-border/40">
              <p className="text-[11px] text-muted-foreground">
                {usingPreselected
                  ? `Routing ${preselectedLeads!.length} marinas`
                  : `Searching within ${searchRadiusKm} km`}
              </p>
              <Button onClick={runPlan} disabled={loading || !userLocation || windowMin <= 0} data-testid="button-build-plan" className="gap-2">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {loading ? "Planning…" : "Build my route"}
              </Button>
            </div>
            {loading && (
              <div className="space-y-2 pt-2">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-border/40 p-2.5 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Stops</p>
                <p className="text-lg font-semibold" data-testid="text-stop-count">{plan.stops.length}</p>
              </div>
              <div className="rounded-lg border border-border/40 p-2.5 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Drive</p>
                <p className="text-lg font-semibold">{Math.round(plan.totalDriveKm)} km</p>
                <p className="text-[10px] text-muted-foreground">{fmtMin(plan.totalDriveMin)}</p>
              </div>
              <div className="rounded-lg border border-border/40 p-2.5 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Day length</p>
                <p className="text-lg font-semibold">{fmtMin(plan.totalElapsedMin)}</p>
                <p className="text-[10px] text-muted-foreground">of {fmtMin(windowMin)} window</p>
              </div>
            </div>

            <div className="space-y-1.5">
              {plan.stops.map((s, i) => {
                const addr = s.lead.marina_address || [s.lead.street_address, s.lead.city, s.lead.state].filter(Boolean).join(", ");
                const slips = parseSlips(s.lead.slips);
                const stopMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${s.lead.marina_lat},${s.lead.marina_lng}&travelmode=driving`;
                return (
                  <div key={s.lead.id} className="flex items-start gap-3 p-2.5 rounded-lg border border-border/40 bg-card/40" data-testid={`planned-stop-${s.lead.id}`}>
                    <div className="w-7 h-7 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <a href={`/opportunities/${s.lead.id}`} target="_blank" rel="noopener" className="text-sm font-medium hover:underline truncate" data-testid={`link-stop-marina-${s.lead.id}`}>
                          {s.lead.company}
                        </a>
                        {slips > 0 && (
                          <Badge variant="outline" className="text-[10px] h-4 px-1 gap-0.5">
                            <Anchor className="h-2.5 w-2.5" /> {slips} slips
                          </Badge>
                        )}
                      </div>
                      {addr && <p className="text-[11px] text-muted-foreground truncate flex items-center gap-1"><MapPin className="h-2.5 w-2.5" />{addr}</p>}
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1"><Navigation className="h-3 w-3" />{s.driveKm.toFixed(1)} km · {fmtMin(s.driveMin)}</span>
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Arrive {fmtClock(startTotalMin, s.arriveMin)} → leave {fmtClock(startTotalMin, s.departMin)}</span>
                      </div>
                    </div>
                    <a href={stopMapsUrl} target="_blank" rel="noopener" className="p-1.5 rounded-md text-primary hover:bg-primary/10 flex-shrink-0" title="Open in Maps" data-testid={`button-stop-maps-${s.lead.id}`}>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                );
              })}
              {returnToStart && plan.returnDriveKm > 0 && (
                <div className="flex items-center gap-3 p-2 text-[11px] text-muted-foreground italic">
                  <RotateCcw className="h-3 w-3" /> Return to start: {plan.returnDriveKm.toFixed(1)} km · {fmtMin(plan.returnDriveMin)}
                </div>
              )}
            </div>

            <div className="flex gap-2 justify-between items-center pt-2 border-t border-border/40">
              <Button variant="ghost" size="sm" onClick={reset} data-testid="button-reset-plan">Adjust scope</Button>
              {mapsUrl && (
                <a href={mapsUrl} target="_blank" rel="noopener" data-testid="link-open-route-maps">
                  <Button size="sm" className="gap-2">
                    <Navigation className="h-3.5 w-3.5" /> Open route in Google Maps
                  </Button>
                </a>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
