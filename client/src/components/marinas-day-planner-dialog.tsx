import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, Loader2, Navigation, Clock, Anchor, MapPin, ExternalLink, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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

function fmtClock(startHHMM: string, addMin: number): string {
  const [hh, mm] = startHHMM.split(":").map(Number);
  const total = hh * 60 + mm + Math.round(addMin);
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
    stops,
    totalDriveKm,
    totalDriveMin,
    totalElapsedMin,
    returnDriveKm,
    returnDriveMin,
    candidatesConsidered: candidates.length,
  };
}

function buildGoogleMapsUrl(start: { lat: number; lng: number }, stops: PlannedStop[], returnToStart: boolean): string {
  if (!stops.length) return "";
  const origin = `${start.lat},${start.lng}`;
  const last = stops[stops.length - 1];
  const destination = returnToStart ? origin : `${last.lead.marina_lat},${last.lead.marina_lng}`;
  const waypoints = (returnToStart ? stops : stops.slice(0, -1))
    .map(s => `${s.lead.marina_lat},${s.lead.marina_lng}`)
    .join("|");
  const params = new URLSearchParams({
    api: "1",
    origin,
    destination,
    travelmode: "driving",
  });
  if (waypoints) params.set("waypoints", waypoints);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function MarinasDayPlannerDialog({
  open,
  onOpenChange,
  userLocation,
  defaultStageFilter,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userLocation: { lat: number; lng: number } | null;
  defaultStageFilter?: string;
}) {
  const { toast } = useToast();
  const [hoursAvailable, setHoursAvailable] = useState(4);
  const [visitMin, setVisitMin] = useState(30);
  const [avgSpeedKmh, setAvgSpeedKmh] = useState(50);
  const [minSlips, setMinSlips] = useState<string>("");
  const [stageFilter, setStageFilter] = useState<string>(defaultStageFilter || "all");
  const [returnToStart, setReturnToStart] = useState(true);
  const [startTime, setStartTime] = useState("09:00");
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const searchRadiusKm = useMemo(() => {
    return Math.max(20, Math.min(300, Math.round((hoursAvailable * avgSpeedKmh) / 2)));
  }, [hoursAvailable, avgSpeedKmh]);

  const runPlan = async () => {
    if (!userLocation) {
      toast({ title: "Location needed", description: "Tap My Location on the map first so Cortex knows where you're starting from.", variant: "destructive" });
      return;
    }
    setLoading(true);
    setError(null);
    setPlan(null);
    try {
      const url = `/api/leads/nearby?lat=${userLocation.lat}&lng=${userLocation.lng}&radius=${searchRadiusKm}&limit=500`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch nearby marinas");
      const all: PlannerLead[] = await res.json();
      const minSlipsN = Number(minSlips) || 0;
      const filtered = all.filter(l => {
        if (stageFilter !== "all" && l.status !== stageFilter) return false;
        if (minSlipsN > 0 && parseSlips(l.slips) < minSlipsN) return false;
        if (typeof l.marina_lat !== "number" || typeof l.marina_lng !== "number") return false;
        return true;
      });
      if (!filtered.length) {
        setError("No marinas matched your scope within reach. Try widening the slip count or stage filter.");
        return;
      }
      const result = planRoute(userLocation, filtered, { hoursAvailable, visitMin, avgSpeedKmh, returnToStart });
      if (!result.stops.length) {
        setError("Couldn't fit any marinas in your time budget. Try more hours, fewer minutes per visit, or a larger speed.");
        return;
      }
      setPlan(result);
    } catch (e: any) {
      setError(e.message || "Plan failed");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setPlan(null);
    setError(null);
  };

  const mapsUrl = plan && userLocation ? buildGoogleMapsUrl(userLocation, plan.stops, returnToStart) : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-day-planner">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Plan my marina day
          </DialogTitle>
          <DialogDescription>
            Tell Cortex how much time you have and the kind of marinas you care about — it'll order the most efficient driving route from your location.
          </DialogDescription>
        </DialogHeader>

        {!plan ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block">Hours available</Label>
                <Input type="number" min={1} max={14} step={0.5} value={hoursAvailable}
                  onChange={e => setHoursAvailable(Math.max(0.5, Number(e.target.value) || 0))}
                  data-testid="input-hours-available" />
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Minutes per visit</Label>
                <Input type="number" min={5} max={240} step={5} value={visitMin}
                  onChange={e => setVisitMin(Math.max(5, Number(e.target.value) || 0))}
                  data-testid="input-visit-min" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block">Min slips</Label>
                <Input type="number" min={0} step={50} placeholder="e.g. 300" value={minSlips}
                  onChange={e => setMinSlips(e.target.value)}
                  data-testid="input-min-slips" />
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Avg driving speed (km/h)</Label>
                <Input type="number" min={20} max={120} step={5} value={avgSpeedKmh}
                  onChange={e => setAvgSpeedKmh(Math.max(20, Number(e.target.value) || 0))}
                  data-testid="input-avg-speed" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block">Start time</Label>
                <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                  data-testid="input-start-time" />
              </div>
              <div className="flex items-end gap-2 pb-1">
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

            <div className="flex justify-between items-center pt-2">
              <p className="text-[11px] text-muted-foreground">Searching within ~{searchRadiusKm} km</p>
              <Button onClick={runPlan} disabled={loading || !userLocation} data-testid="button-build-plan" className="gap-2">
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
                <p className="text-[10px] text-muted-foreground">of {hoursAvailable}h budget</p>
              </div>
            </div>

            <div className="space-y-1.5">
              {plan.stops.map((s, i) => {
                const addr = s.lead.marina_address || [s.lead.street_address, s.lead.city, s.lead.state].filter(Boolean).join(", ");
                const slips = parseSlips(s.lead.slips);
                const stopMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${s.lead.marina_lat},${s.lead.marina_lng}&travelmode=driving`;
                return (
                  <div key={s.lead.id} className="flex items-start gap-3 p-2.5 rounded-lg border border-border/40 bg-card/40" data-testid={`planned-stop-${s.lead.id}`}>
                    <div className="w-7 h-7 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                      {i + 1}
                    </div>
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
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Arrive {fmtClock(startTime, s.arriveMin)} → leave {fmtClock(startTime, s.departMin)}</span>
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
              <Button variant="ghost" size="sm" onClick={reset} data-testid="button-reset-plan">
                Adjust scope
              </Button>
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
