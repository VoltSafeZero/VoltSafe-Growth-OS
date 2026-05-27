import { useState, useMemo, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sparkles, Loader2, Navigation, Clock, Anchor, MapPin, ExternalLink,
  RotateCcw, Target, LocateFixed, Search, Check, X, Map,
} from "lucide-react";
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

type LocMode = "current" | "address" | "map";
type EndMode = "return_start" | "finish_last" | "custom";
type GeoPoint = { lat: number; lng: number };
type ResolvedGeo = GeoPoint & { display: string };

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
  start: GeoPoint,
  candidates: PlannerLead[],
  opts: { hoursAvailable: number; visitMin: number; avgSpeedKmh: number; returnTo: GeoPoint | null }
): Plan {
  const { hoursAvailable, visitMin, avgSpeedKmh, returnTo } = opts;
  const budgetMin = hoursAvailable * 60;
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
    const driveMin = (bestKm / avgSpeedKmh) * 60;
    const arriveMin = elapsed + driveMin;
    const departMin = arriveMin + visitMin;
    let projectedTotal = departMin;
    if (returnTo) {
      const backKm = haversineKm(lead.marina_lat, lead.marina_lng, returnTo.lat, returnTo.lng);
      projectedTotal = departMin + (backKm / avgSpeedKmh) * 60;
    }
    if (projectedTotal > budgetMin) { pool.splice(bestIdx, 1); continue; }
    stops.push({ lead, driveKm: bestKm, driveMin, arriveMin, departMin });
    elapsed = departMin;
    cur = { lat: lead.marina_lat, lng: lead.marina_lng };
    pool.splice(bestIdx, 1);
  }
  const last = stops[stops.length - 1];
  const returnDriveKm = (last && returnTo)
    ? haversineKm(last.lead.marina_lat, last.lead.marina_lng, returnTo.lat, returnTo.lng) : 0;
  const returnDriveMin = returnDriveKm > 0 ? (returnDriveKm / avgSpeedKmh) * 60 : 0;
  const totalDriveKm = stops.reduce((s, x) => s + x.driveKm, 0) + returnDriveKm;
  const totalDriveMin = stops.reduce((s, x) => s + x.driveMin, 0) + returnDriveMin;
  const totalElapsedMin = (last ? last.departMin : 0) + returnDriveMin;
  return { stops, totalDriveKm, totalDriveMin, totalElapsedMin, returnDriveKm, returnDriveMin, candidatesConsidered: candidates.length };
}

function buildGoogleMapsUrl(start: GeoPoint, stops: PlannedStop[], end: GeoPoint | null): string {
  if (!stops.length) return "";
  const origin = `${start.lat},${start.lng}`;
  const last = stops[stops.length - 1];
  const destination = end
    ? `${end.lat},${end.lng}`
    : `${last.lead.marina_lat},${last.lead.marina_lng}`;
  const waypointStops = end ? stops : stops.slice(0, -1);
  const waypoints = waypointStops.map(s => `${s.lead.marina_lat},${s.lead.marina_lng}`).join("|");
  const params = new URLSearchParams({ api: "1", origin, destination, travelmode: "driving" });
  if (waypoints) params.set("waypoints", waypoints);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

const HOUR_OPTIONS: WheelOption[] = Array.from({ length: 24 }, (_, h) => {
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { value: h, label: `${h12} ${period}` };
});
const MINUTE_OPTIONS: WheelOption[] = Array.from({ length: 12 }, (_, i) => ({ value: i * 5, label: String(i * 5).padStart(2, "0") }));
const VISIT_MIN_OPTIONS: WheelOption[] = [10, 15, 20, 30, 45, 60, 75, 90, 120, 150, 180].map(m => ({ value: m, label: `${m} min` }));
const SPEED_OPTIONS: WheelOption[] = [20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120].map(s => ({ value: s, label: `${s} km/h` }));
const SLIP_OPTIONS: WheelOption[] = [0, 25, 50, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500].map(s => ({ value: s, label: s === 0 ? "Any" : `${s}+` }));
const RADIUS_OPTIONS: WheelOption[] = [5, 10, 15, 20, 30, 40, 50, 75, 100, 150, 200, 250, 300, 400, 500].map(r => ({ value: r, label: `${r} km` }));

function buildDayOptions(): WheelOption[] {
  const labels: WheelOption[] = [];
  const today = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(today.getTime() + i * 86_400_000);
    const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    labels.push({ value: i, label });
  }
  return labels;
}

const STAGE_LABELS: Record<string, string> = {
  all: "All stages", new: "New", contacted: "Contacted", meeting_scheduled: "Meeting scheduled",
  qualified: "Qualified", proposal_sent: "Proposal sent", negotiation: "Negotiation",
  converted: "Closed Won", lost: "Closed Lost",
};

function dayHourMinToTotalMin(d: number, h: number, m: number): number { return d * 24 * 60 + h * 60 + m; }

async function geocodeAddress(q: string): Promise<ResolvedGeo | null> {
  const res = await fetch(`/api/geocode/search?q=${encodeURIComponent(q)}`, { credentials: "include" });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data?.lat) return null;
  return { lat: parseFloat(data.lat), lng: parseFloat(data.lon ?? data.lng), display: data.display_name ?? q };
}

function LocModeToggle({ value, onChange, onPickMap, label }: {
  value: LocMode; onChange: (v: LocMode) => void; onPickMap: () => void; label: string;
}) {
  return (
    <div>
      <Label className="text-xs mb-2 block">{label}</Label>
      <div className="flex gap-1.5 flex-wrap">
        {(["current", "address", "map"] as LocMode[]).map(mode => (
          <button
            key={mode}
            onClick={() => { if (mode === "map") { onPickMap(); } else { onChange(mode); } }}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
              value === mode
                ? "bg-primary/20 border-primary/50 text-primary"
                : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
            }`}
            data-testid={`button-loc-${label.toLowerCase().replace(/\s+/g, "-")}-${mode}`}
          >
            {mode === "current" && <LocateFixed className="h-3 w-3" />}
            {mode === "address" && <Search className="h-3 w-3" />}
            {mode === "map" && <Map className="h-3 w-3" />}
            {mode === "current" ? "My location" : mode === "address" ? "Address" : "Pick on map"}
          </button>
        ))}
      </div>
    </div>
  );
}

function AddressSearchRow({ inputVal, onInputChange, onSearch, loading, resolved, onClear, placeholder }: {
  inputVal: string; onInputChange: (v: string) => void; onSearch: () => void;
  loading: boolean; resolved: ResolvedGeo | null; onClear: () => void; placeholder?: string;
}) {
  return (
    <div className="space-y-1.5 mt-2">
      <div className="flex gap-2">
        <Input
          value={inputVal}
          onChange={e => onInputChange(e.target.value)}
          onKeyDown={e => e.key === "Enter" && onSearch()}
          placeholder={placeholder ?? "Enter address or city…"}
          className="h-8 text-xs flex-1"
          data-testid="input-loc-address"
        />
        <Button size="sm" variant="outline" className="h-8 px-2.5 gap-1.5" onClick={onSearch} disabled={loading || !inputVal.trim()}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
        </Button>
        {resolved && (
          <Button size="sm" variant="ghost" className="h-8 px-2" onClick={onClear}>
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {resolved && (
        <p className="text-[11px] text-emerald-400 flex items-center gap-1">
          <Check className="h-3 w-3" /> {resolved.display}
        </p>
      )}
    </div>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userLocation: { lat: number; lng: number } | null;
  defaultStageFilter?: string;
  preselectedLeads?: PlannerLead[] | null;
  onRequestMapPick?: (target: "start" | "end") => void;
  pickedLocation?: { lat: number; lng: number; target: "start" | "end" } | null;
}

export function MarinasDayPlannerDialog({
  open, onOpenChange, userLocation, defaultStageFilter, preselectedLeads,
  onRequestMapPick, pickedLocation,
}: Props) {
  const { toast } = useToast();
  const dayOptions = useMemo(buildDayOptions, []);

  const [startDay, setStartDay] = useState(0);
  const [startHour, setStartHour] = useState(9);
  const [startMin, setStartMin] = useState(0);
  const [stopDay, setStopDay] = useState(0);
  const [stopHour, setStopHour] = useState(17);
  const [stopMin, setStopMin] = useState(0);

  const [visitMin, setVisitMin] = useState(30);
  const [avgSpeedKmh, setAvgSpeedKmh] = useState(50);
  const [minSlips, setMinSlips] = useState<number>(0);
  const [searchRadiusKm, setSearchRadiusKm] = useState<number>(50);
  const [stageFilter, setStageFilter] = useState<string>(defaultStageFilter || "all");

  // ── Start location ──────────────────────────────────────────────────────────
  const [startLocMode, setStartLocMode] = useState<LocMode>("current");
  const [startAddrInput, setStartAddrInput] = useState("");
  const [startAddrGeo, setStartAddrGeo] = useState<ResolvedGeo | null>(null);
  const [startAddrLoading, setStartAddrLoading] = useState(false);
  const [startMapGeo, setStartMapGeo] = useState<GeoPoint | null>(null);

  // ── End location ────────────────────────────────────────────────────────────
  const [endLocMode, setEndLocMode] = useState<EndMode>("return_start");
  const [endAddrInput, setEndAddrInput] = useState("");
  const [endAddrGeo, setEndAddrGeo] = useState<ResolvedGeo | null>(null);
  const [endAddrLoading, setEndAddrLoading] = useState(false);
  const [endMapGeo, setEndMapGeo] = useState<GeoPoint | null>(null);

  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startTotalMin = dayHourMinToTotalMin(startDay, startHour, startMin);
  const stopTotalMin = dayHourMinToTotalMin(stopDay, stopHour, stopMin);
  const windowMin = stopTotalMin - startTotalMin;
  const hoursAvailable = windowMin > 0 ? windowMin / 60 : 0;

  const effectiveStart: GeoPoint | null = useMemo(() => {
    if (startLocMode === "current") return userLocation;
    if (startLocMode === "map") return startMapGeo;
    return startAddrGeo ? { lat: startAddrGeo.lat, lng: startAddrGeo.lng } : null;
  }, [startLocMode, userLocation, startMapGeo, startAddrGeo]);

  const effectiveEnd: GeoPoint | null = useMemo(() => {
    if (endLocMode === "return_start") return effectiveStart;
    if (endLocMode === "finish_last") return null;
    if (endAddrGeo) return { lat: endAddrGeo.lat, lng: endAddrGeo.lng };
    if (endMapGeo) return endMapGeo;
    return null;
  }, [endLocMode, effectiveStart, endAddrGeo, endMapGeo]);

  // Consume picked map location from parent
  const lastPickedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pickedLocation) return;
    const key = `${pickedLocation.lat},${pickedLocation.lng},${pickedLocation.target}`;
    if (key === lastPickedRef.current) return;
    lastPickedRef.current = key;
    if (pickedLocation.target === "start") {
      setStartLocMode("map");
      setStartMapGeo({ lat: pickedLocation.lat, lng: pickedLocation.lng });
    } else {
      setEndLocMode("custom");
      setEndMapGeo({ lat: pickedLocation.lat, lng: pickedLocation.lng });
    }
  }, [pickedLocation]);

  useEffect(() => {
    setPlan(null);
  }, [startTotalMin, stopTotalMin, visitMin, avgSpeedKmh, minSlips, searchRadiusKm, stageFilter, preselectedLeads, effectiveStart?.lat, effectiveStart?.lng, endLocMode, effectiveEnd?.lat, effectiveEnd?.lng]);

  useEffect(() => {
    if (!open) { setPlan(null); setError(null); setLoading(false); }
  }, [open]);

  const usingPreselected = !!(preselectedLeads && preselectedLeads.length > 0);

  const searchStartAddr = async () => {
    if (!startAddrInput.trim()) return;
    setStartAddrLoading(true);
    const geo = await geocodeAddress(startAddrInput);
    setStartAddrLoading(false);
    if (geo) { setStartAddrGeo(geo); }
    else toast({ title: "Address not found", description: "Try a more specific address.", variant: "destructive" });
  };

  const searchEndAddr = async () => {
    if (!endAddrInput.trim()) return;
    setEndAddrLoading(true);
    const geo = await geocodeAddress(endAddrInput);
    setEndAddrLoading(false);
    if (geo) { setEndAddrGeo(geo); }
    else toast({ title: "Address not found", description: "Try a more specific address.", variant: "destructive" });
  };

  const startReady = effectiveStart !== null;
  const endCustomReady = endLocMode !== "custom" || (endAddrGeo !== null || endMapGeo !== null);

  const runPlan = async () => {
    if (!effectiveStart) {
      const msg = startLocMode === "current"
        ? 'Enable "My Location" on the map first.'
        : startLocMode === "address"
        ? "Search for a start address first."
        : "Pick a start location on the map first.";
      toast({ title: "Start location needed", description: msg, variant: "destructive" });
      return;
    }
    if (!endCustomReady) {
      toast({ title: "End location needed", description: "Search for an end address or pick one on the map.", variant: "destructive" });
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
        const url = `/api/leads/nearby?lat=${effectiveStart.lat}&lng=${effectiveStart.lng}&radius=${searchRadiusKm}&limit=500`;
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
          : "No marinas matched your scope. Widen the radius, slip count, or stage filter.");
        return;
      }
      const returnTo = endLocMode === "finish_last" ? null : effectiveEnd;
      const result = planRoute(effectiveStart, candidates, { hoursAvailable, visitMin, avgSpeedKmh, returnTo });
      if (!result.stops.length) {
        setError("Couldn't fit any marinas in your time window. Try a longer window, fewer minutes per visit, or a higher speed.");
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
  const mapsUrl = plan && effectiveStart
    ? buildGoogleMapsUrl(effectiveStart, plan.stops, endLocMode === "finish_last" ? null : effectiveEnd)
    : "";

  const startLocLabel = () => {
    if (startLocMode === "current") return userLocation ? "My location" : "My location (not set)";
    if (startLocMode === "map") return startMapGeo ? `${startMapGeo.lat.toFixed(4)}, ${startMapGeo.lng.toFixed(4)}` : "Pick on map";
    return startAddrGeo ? startAddrGeo.display : "Address";
  };
  const endLocLabel = () => {
    if (endLocMode === "return_start") return `Return to ${startLocLabel()}`;
    if (endLocMode === "finish_last") return "Finish at last stop";
    if (endMapGeo) return `${endMapGeo.lat.toFixed(4)}, ${endMapGeo.lng.toFixed(4)}`;
    return endAddrGeo ? endAddrGeo.display : "Custom location";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto" data-testid="dialog-day-planner">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Plan my marina day
          </DialogTitle>
          <DialogDescription>
            Set your start and end points, then let Cortex build the most efficient driving route.
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

            {/* ── Start location ─────────────────────────────────────────── */}
            <div className="rounded-xl border border-border/50 bg-card/30 p-3.5 space-y-2.5">
              <LocModeToggle
                label="Start location"
                value={startLocMode}
                onChange={setStartLocMode}
                onPickMap={() => onRequestMapPick?.("start")}
              />
              {startLocMode === "current" && (
                <p className={`text-[11px] flex items-center gap-1 ${userLocation ? "text-emerald-400" : "text-amber-400"}`}>
                  {userLocation ? <Check className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}
                  {userLocation ? `${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}` : 'Tap "My Location" on the map to set your position'}
                </p>
              )}
              {startLocMode === "address" && (
                <AddressSearchRow
                  inputVal={startAddrInput}
                  onInputChange={v => { setStartAddrInput(v); setStartAddrGeo(null); }}
                  onSearch={searchStartAddr}
                  loading={startAddrLoading}
                  resolved={startAddrGeo}
                  onClear={() => { setStartAddrGeo(null); setStartAddrInput(""); }}
                  placeholder="e.g. Kelowna, BC or 123 Marina Way"
                />
              )}
              {startLocMode === "map" && (
                <p className={`text-[11px] flex items-center gap-1 ${startMapGeo ? "text-emerald-400" : "text-amber-400"}`}>
                  {startMapGeo ? <Check className="h-3 w-3" /> : <Map className="h-3 w-3" />}
                  {startMapGeo
                    ? `Pinned: ${startMapGeo.lat.toFixed(4)}, ${startMapGeo.lng.toFixed(4)}`
                    : "Click the map to drop a start pin — this dialog will reopen automatically"}
                </p>
              )}
            </div>

            {/* ── End location ───────────────────────────────────────────── */}
            <div className="rounded-xl border border-border/50 bg-card/30 p-3.5 space-y-2.5">
              <div>
                <Label className="text-xs mb-2 block">End location</Label>
                <div className="flex gap-1.5 flex-wrap">
                  {(["return_start", "finish_last", "custom"] as EndMode[]).map(mode => (
                    <button
                      key={mode}
                      onClick={() => setEndLocMode(mode)}
                      className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
                        endLocMode === mode
                          ? "bg-primary/20 border-primary/50 text-primary"
                          : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                      }`}
                      data-testid={`button-end-loc-${mode}`}
                    >
                      {mode === "return_start" && <RotateCcw className="h-3 w-3" />}
                      {mode === "finish_last" && <Navigation className="h-3 w-3" />}
                      {mode === "custom" && <MapPin className="h-3 w-3" />}
                      {mode === "return_start" ? "Return to start" : mode === "finish_last" ? "Finish at last stop" : "Custom location"}
                    </button>
                  ))}
                </div>
              </div>
              {endLocMode === "return_start" && (
                <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <RotateCcw className="h-3 w-3" /> Route will loop back to: <span className="text-foreground">{startLocLabel()}</span>
                </p>
              )}
              {endLocMode === "finish_last" && (
                <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Navigation className="h-3 w-3" /> Route ends at your last marina stop — no return trip.
                </p>
              )}
              {endLocMode === "custom" && (
                <div className="space-y-2">
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => { setEndAddrGeo(null); setEndMapGeo(null); }}
                      className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border transition-all ${
                        endMapGeo === null
                          ? "bg-muted/60 border-border text-foreground"
                          : "border-border/40 text-muted-foreground hover:border-border"
                      }`}
                    >
                      <Search className="h-3 w-3" /> Address
                    </button>
                    <button
                      onClick={() => onRequestMapPick?.("end")}
                      className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border border-border/40 text-muted-foreground hover:border-border hover:text-foreground transition-all"
                      data-testid="button-end-pick-map"
                    >
                      <Map className="h-3 w-3" /> Pick on map
                    </button>
                  </div>
                  {endMapGeo ? (
                    <p className="text-[11px] text-emerald-400 flex items-center gap-1">
                      <Check className="h-3 w-3" /> Pinned: {endMapGeo.lat.toFixed(4)}, {endMapGeo.lng.toFixed(4)}
                      <button onClick={() => setEndMapGeo(null)} className="ml-1 text-muted-foreground hover:text-foreground">
                        <X className="h-3 w-3" />
                      </button>
                    </p>
                  ) : (
                    <AddressSearchRow
                      inputVal={endAddrInput}
                      onInputChange={v => { setEndAddrInput(v); setEndAddrGeo(null); }}
                      onSearch={searchEndAddr}
                      loading={endAddrLoading}
                      resolved={endAddrGeo}
                      onClear={() => { setEndAddrGeo(null); setEndAddrInput(""); }}
                      placeholder="e.g. Vancouver, BC or hotel address"
                    />
                  )}
                </div>
              )}
            </div>

            {/* ── Start time ─────────────────────────────────────────────── */}
            <div>
              <Label className="text-xs mb-1.5 block">Start time</Label>
              <WheelGroup>
                <WheelPicker options={dayOptions} value={startDay} onChange={setStartDay} width="9rem" data-testid="wheel-start-day" />
                <WheelPicker options={HOUR_OPTIONS} value={startHour} onChange={setStartHour} width="5rem" data-testid="wheel-start-hour" />
                <WheelPicker options={MINUTE_OPTIONS} value={startMin} onChange={setStartMin} width="4rem" data-testid="wheel-start-min" />
              </WheelGroup>
            </div>

            {/* ── Stop time ──────────────────────────────────────────────── */}
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

            {/* ── Visit / speed ──────────────────────────────────────────── */}
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

            {/* ── Slips / radius ─────────────────────────────────────────── */}
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

            {/* ── Stage filter ───────────────────────────────────────────── */}
            {!usingPreselected && (
              <div className="w-1/2">
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

            {error && (
              <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded p-2" data-testid="text-plan-error">
                {error}
              </div>
            )}

            <div className="flex justify-between items-center pt-1 border-t border-border/40">
              <p className="text-[11px] text-muted-foreground">
                {usingPreselected ? `Routing ${preselectedLeads!.length} marinas` : `Searching within ${searchRadiusKm} km`}
              </p>
              <Button
                onClick={runPlan}
                disabled={loading || !startReady || !endCustomReady || windowMin <= 0}
                data-testid="button-build-plan"
                className="gap-2"
              >
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
            {/* Route summary banner */}
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground bg-muted/30 rounded-lg px-3 py-2 flex-wrap">
              <span className="flex items-center gap-1"><MapPin className="h-3 w-3 text-primary" />{startLocLabel()}</span>
              <span className="text-border">→</span>
              <span className="flex items-center gap-1 italic">{plan.stops.length} stops</span>
              <span className="text-border">→</span>
              <span className="flex items-center gap-1"><Navigation className="h-3 w-3 text-primary" />{endLocLabel()}</span>
            </div>

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
              {endLocMode !== "finish_last" && plan.returnDriveKm > 0 && (
                <div className="flex items-center gap-3 p-2 text-[11px] text-muted-foreground italic">
                  <RotateCcw className="h-3 w-3" /> Return to end: {plan.returnDriveKm.toFixed(1)} km · {fmtMin(plan.returnDriveMin)}
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
