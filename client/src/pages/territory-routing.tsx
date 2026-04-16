import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  MapPin, Navigation, Locate, ExternalLink, Plus, Minus, ArrowUpDown,
  CheckCircle2, Circle, ChevronRight, Flame, AlertTriangle, Clock,
  Route, Map, Filter, Search, Trash2, Save, Play, X, Star,
  Building2, Users, Zap, Truck, RefreshCw, SlidersHorizontal,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────
type EntityType = "lead" | "account" | "opportunity" | "deployment";
type UrgencyFilter = "all" | "overdue" | "hot" | "at_risk";

interface RankedStop {
  entityType: EntityType;
  entityId: number;
  entityName: string;
  entitySubtype: string;
  lat: number;
  lng: number;
  address: string;
  city: string;
  region: string;
  territory: string;
  distanceKm: number;
  predictiveScore: number;
  scoreLabel: string;
  compositeScore: number;
  reasons: string[];
  priorityColor: "red" | "orange" | "yellow" | "green";
  link: string;
  phone?: string;
  email?: string;
  status: string;
  rank?: number;
}

interface TripStop {
  id?: number;
  entityType: EntityType;
  entityId: number;
  entityName: string;
  entitySubtype: string;
  lat?: number;
  lng?: number;
  address?: string;
  score?: number;
  compositeScore?: number;
  rank?: number;
  reasons?: string[];
  visited?: boolean;
  visitedAt?: string;
  visitNotes?: string;
  sortOrder?: number;
}

interface TripPlan {
  id: number;
  name: string;
  status: string;
  radiusKm: number;
  maxStops: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  stops?: TripStop[];
  stop_count?: number;
  visited_count?: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const ENTITY_ICONS: Record<EntityType, React.ReactNode> = {
  lead: <Users className="h-3.5 w-3.5" />,
  account: <Building2 className="h-3.5 w-3.5" />,
  opportunity: <Zap className="h-3.5 w-3.5" />,
  deployment: <Truck className="h-3.5 w-3.5" />,
};

const ENTITY_COLORS: Record<EntityType, string> = {
  lead: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  account: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  opportunity: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  deployment: "bg-teal-500/10 text-teal-600 border-teal-500/20",
};

const PRIORITY_STYLES: Record<string, { bar: string; badge: string; label: string }> = {
  red: { bar: "bg-red-500", badge: "bg-red-500/10 text-red-600 border-red-500/20", label: "Critical" },
  orange: { bar: "bg-orange-400", badge: "bg-orange-400/10 text-orange-600 border-orange-400/20", label: "High" },
  yellow: { bar: "bg-yellow-400", badge: "bg-yellow-400/10 text-yellow-700 border-yellow-400/20", label: "Medium" },
  green: { bar: "bg-green-500", badge: "bg-green-500/10 text-green-600 border-green-500/20", label: "Low" },
};

function DirectionsMenu({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  const enc = encodeURIComponent(label);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1"
          data-testid={`btn-directions-${label.slice(0, 20)}`}
        >
          <Navigation className="h-3 w-3" />
          Directions
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`}
            target="_blank" rel="noopener noreferrer"
            data-testid="directions-google"
          >
            Google Maps
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a
            href={`maps://maps.apple.com/?daddr=${lat},${lng}&q=${enc}`}
            data-testid="directions-apple"
          >
            Apple Maps
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a
            href={`https://waze.com/ul?ll=${lat},${lng}&navigate=yes`}
            target="_blank" rel="noopener noreferrer"
            data-testid="directions-waze"
          >
            Waze
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ScorePip({ score, label }: { score: number; label: string }) {
  const band = score >= 75 ? "critical" : score >= 55 ? "high" : score >= 35 ? "medium" : "low";
  const cls = band === "critical" ? "bg-red-500 text-white" :
    band === "high" ? "bg-orange-400 text-white" :
    band === "medium" ? "bg-yellow-400 text-black" : "bg-muted text-muted-foreground";
  return (
    <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${cls}`} data-testid="score-pip">
      {score}
    </span>
  );
}

// ── Stop Card ──────────────────────────────────────────────────────────────────
function StopCard({
  stop,
  rank,
  inTrip,
  onAddToTrip,
  onRemoveFromTrip,
  compact = false,
}: {
  stop: RankedStop;
  rank: number;
  inTrip: boolean;
  onAddToTrip: (stop: RankedStop) => void;
  onRemoveFromTrip: (stop: RankedStop) => void;
  compact?: boolean;
}) {
  const ps = PRIORITY_STYLES[stop.priorityColor] ?? PRIORITY_STYLES.green;
  const ec = ENTITY_COLORS[stop.entityType] ?? "";

  return (
    <div
      className="bg-card border border-border/50 rounded-xl overflow-hidden hover:shadow-md transition-shadow"
      data-testid={`stop-card-${stop.entityType}-${stop.entityId}`}
    >
      <div className={`h-1 w-full ${ps.bar}`} />
      <div className="p-3 flex gap-3">
        {/* Rank */}
        <div className="flex flex-col items-center gap-1 shrink-0">
          <span className="text-xs font-bold text-muted-foreground w-6 h-6 rounded-full bg-muted/50 flex items-center justify-center">
            {rank}
          </span>
          <MapPin className="h-3.5 w-3.5 text-muted-foreground/50" />
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate" data-testid={`stop-name-${stop.entityId}`}>
                {stop.entityName}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border ${ec}`}>
                  {ENTITY_ICONS[stop.entityType]}
                  {stop.entityType}
                </span>
                <span className="text-xs text-muted-foreground">{stop.distanceKm.toFixed(1)} km</span>
                {stop.city && <span className="text-xs text-muted-foreground truncate max-w-[100px]">{stop.city}</span>}
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-1.5">
              <ScorePip score={stop.predictiveScore} label={stop.scoreLabel} />
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${ps.badge}`}>
                {ps.label}
              </span>
            </div>
          </div>

          {/* Reasons */}
          {!compact && (
            <div className="mt-2 flex flex-wrap gap-1">
              {stop.reasons.slice(0, 3).map((r, i) => (
                <span key={i} className="text-[10px] bg-muted/40 text-muted-foreground px-1.5 py-0.5 rounded-full">
                  {r}
                </span>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
            {stop.lat && stop.lng && (
              <DirectionsMenu lat={stop.lat} lng={stop.lng} label={stop.entityName} />
            )}
            <Button
              variant={inTrip ? "destructive" : "outline"}
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => inTrip ? onRemoveFromTrip(stop) : onAddToTrip(stop)}
              data-testid={`btn-trip-toggle-${stop.entityType}-${stop.entityId}`}
            >
              {inTrip ? <><Minus className="h-3 w-3" /> Remove</> : <><Plus className="h-3 w-3" /> Add to Trip</>}
            </Button>
            <Link href={stop.link}>
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" data-testid={`btn-open-${stop.entityType}-${stop.entityId}`}>
                <ExternalLink className="h-3 w-3" /> Open
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Filters Panel ──────────────────────────────────────────────────────────────
function FiltersPanel({
  lat, setLat,
  lng, setLng,
  radius, setRadius,
  maxStops, setMaxStops,
  selectedTypes, setSelectedTypes,
  scoreThreshold, setScoreThreshold,
  urgencyFilter, setUrgencyFilter,
  onLocate, onSearch, isLocating,
  addressQuery, setAddressQuery,
}: {
  lat: string; setLat: (v: string) => void;
  lng: string; setLng: (v: string) => void;
  radius: string; setRadius: (v: string) => void;
  maxStops: string; setMaxStops: (v: string) => void;
  selectedTypes: EntityType[];
  setSelectedTypes: (v: EntityType[]) => void;
  scoreThreshold: string; setScoreThreshold: (v: string) => void;
  urgencyFilter: UrgencyFilter; setUrgencyFilter: (v: UrgencyFilter) => void;
  onLocate: () => void; onSearch: () => void; isLocating: boolean;
  addressQuery: string; setAddressQuery: (v: string) => void;
}) {
  const allTypes: EntityType[] = ["lead", "account", "opportunity", "deployment"];

  function toggleType(t: EntityType) {
    setSelectedTypes(
      selectedTypes.includes(t) ? selectedTypes.filter(x => x !== t) : [...selectedTypes, t]
    );
  }

  return (
    <div className="space-y-4 p-4 bg-card border border-border/50 rounded-xl">
      {/* Location row */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={addressQuery}
            onChange={e => setAddressQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && onSearch()}
            placeholder="Search city, marina, or address…"
            className="pl-8 h-9 text-sm"
            data-testid="input-address-search"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 shrink-0"
          onClick={onLocate}
          disabled={isLocating}
          data-testid="btn-use-location"
        >
          <Locate className={`h-3.5 w-3.5 ${isLocating ? "animate-pulse" : ""}`} />
          {isLocating ? "Locating…" : "My Location"}
        </Button>
      </div>

      {/* Coords display */}
      {lat && lng && (
        <p className="text-xs text-muted-foreground" data-testid="coords-display">
          📍 {parseFloat(lat).toFixed(4)}, {parseFloat(lng).toFixed(4)}
        </p>
      )}

      {/* Radius + Max Stops + Score */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Radius</label>
          <Select value={radius} onValueChange={setRadius}>
            <SelectTrigger className="h-8 text-xs" data-testid="select-radius">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["10","25","50","100","200"].map(v => (
                <SelectItem key={v} value={v}>{v} km</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Max Stops</label>
          <Select value={maxStops} onValueChange={setMaxStops}>
            <SelectTrigger className="h-8 text-xs" data-testid="select-max-stops">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["5","10","15","20","30","50"].map(v => (
                <SelectItem key={v} value={v}>{v} stops</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Min Score</label>
          <Select value={scoreThreshold} onValueChange={setScoreThreshold}>
            <SelectTrigger className="h-8 text-xs" data-testid="select-score-threshold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Any score</SelectItem>
              <SelectItem value="40">40+ (Medium)</SelectItem>
              <SelectItem value="60">60+ (High)</SelectItem>
              <SelectItem value="75">75+ (Critical)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Record types */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-2 block">Record Types</label>
        <div className="flex gap-2 flex-wrap">
          {allTypes.map(t => (
            <button
              key={t}
              onClick={() => toggleType(t)}
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
                selectedTypes.includes(t)
                  ? "bg-primary/10 text-primary border-primary/30"
                  : "bg-muted/30 text-muted-foreground border-border/50 hover:bg-muted/50"
              }`}
              data-testid={`btn-type-${t}`}
            >
              {ENTITY_ICONS[t]}
              {t.charAt(0).toUpperCase() + t.slice(1)}s
            </button>
          ))}
        </div>
      </div>

      {/* Urgency filter */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-2 block">Urgency Filter</label>
        <div className="flex gap-2 flex-wrap">
          {([["all","All"],["overdue","Overdue"],["hot","Hot Scores"],["at_risk","At Risk"]] as const).map(([v, l]) => (
            <button
              key={v}
              onClick={() => setUrgencyFilter(v as UrgencyFilter)}
              className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
                urgencyFilter === v
                  ? "bg-primary/10 text-primary border-primary/30"
                  : "bg-muted/30 text-muted-foreground border-border/50 hover:bg-muted/50"
              }`}
              data-testid={`btn-urgency-${v}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Trip Builder sidebar ───────────────────────────────────────────────────────
function TripBuilder({
  tripStops,
  onRemove,
  onReorder,
  onSave,
  onClear,
  isSaving,
}: {
  tripStops: RankedStop[];
  onRemove: (stop: RankedStop) => void;
  onReorder: (fromIdx: number, toIdx: number) => void;
  onSave: (name: string, notes: string) => void;
  onClear: () => void;
  isSaving: boolean;
}) {
  const [tripName, setTripName] = useState("");
  const [tripNotes, setTripNotes] = useState("");
  const dragIdx = useRef<number | null>(null);

  return (
    <div className="space-y-3">
      {tripStops.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground" data-testid="trip-empty-state">
          <Route className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No stops added yet.</p>
          <p className="text-xs mt-1">Browse the Nearby tab and click "Add to Trip".</p>
        </div>
      ) : (
        <>
          {/* Stop list */}
          <div className="space-y-2" data-testid="trip-stop-list">
            {tripStops.map((stop, idx) => (
              <div
                key={`${stop.entityType}-${stop.entityId}`}
                className="flex items-center gap-2 p-2.5 bg-muted/30 rounded-lg border border-border/40 group"
                draggable
                onDragStart={() => { dragIdx.current = idx; }}
                onDragOver={e => e.preventDefault()}
                onDrop={() => {
                  if (dragIdx.current !== null && dragIdx.current !== idx) {
                    onReorder(dragIdx.current, idx);
                    dragIdx.current = null;
                  }
                }}
                data-testid={`trip-stop-${stop.entityType}-${stop.entityId}`}
              >
                <span className="text-xs font-bold text-muted-foreground w-5 shrink-0 text-center">{idx + 1}</span>
                <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/40 cursor-grab shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{stop.entityName}</p>
                  <p className="text-[10px] text-muted-foreground">{stop.entityType} · {stop.distanceKm?.toFixed(1)} km</p>
                </div>
                {stop.lat && stop.lng && (
                  <DirectionsMenu lat={stop.lat} lng={stop.lng} label={stop.entityName} />
                )}
                <button
                  onClick={() => onRemove(stop)}
                  className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                  data-testid={`btn-remove-stop-${stop.entityId}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Save form */}
          <div className="border-t border-border/40 pt-3 space-y-2">
            <Input
              value={tripName}
              onChange={e => setTripName(e.target.value)}
              placeholder="Trip name (e.g. Ontario Week, BC Coast)"
              className="h-8 text-sm"
              data-testid="input-trip-name"
            />
            <Input
              value={tripNotes}
              onChange={e => setTripNotes(e.target.value)}
              placeholder="Notes (optional)"
              className="h-8 text-sm"
              data-testid="input-trip-notes"
            />
            <div className="flex gap-2">
              <Button
                className="flex-1 h-8 text-xs gap-1.5"
                onClick={() => onSave(tripName, tripNotes)}
                disabled={isSaving || !tripName.trim()}
                data-testid="btn-save-trip"
              >
                <Save className="h-3 w-3" />
                {isSaving ? "Saving…" : "Save Trip"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={onClear}
                data-testid="btn-clear-trip"
              >
                Clear
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Saved Trip Card ────────────────────────────────────────────────────────────
function SavedTripCard({
  plan,
  onOpen,
  onDelete,
}: {
  plan: TripPlan;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const stopCount = parseInt(String(plan.stop_count ?? 0));
  const visitedCount = parseInt(String(plan.visited_count ?? 0));
  const progress = stopCount > 0 ? Math.round((visitedCount / stopCount) * 100) : 0;

  return (
    <div
      className="bg-card border border-border/50 rounded-xl p-4 hover:shadow-sm transition-shadow"
      data-testid={`saved-trip-${plan.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate" data-testid={`trip-name-${plan.id}`}>{plan.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {stopCount} stop{stopCount !== 1 ? "s" : ""} · {visitedCount} visited · {plan.radiusKm} km radius
          </p>
          {plan.notes && (
            <p className="text-xs text-muted-foreground mt-1 italic truncate">{plan.notes}</p>
          )}
        </div>
        <Badge
          variant="outline"
          className={`text-xs shrink-0 ${
            plan.status === "completed" ? "border-green-500/30 text-green-600" :
            plan.status === "active" ? "border-primary/30 text-primary" :
            "border-border/50 text-muted-foreground"
          }`}
          data-testid={`trip-status-${plan.id}`}
        >
          {plan.status}
        </Badge>
      </div>

      {stopCount > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-muted-foreground">Progress</span>
            <span className="text-[10px] font-medium text-muted-foreground">{progress}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${progress}%` }}
              data-testid={`trip-progress-${plan.id}`}
            />
          </div>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          variant="outline"
          className="flex-1 h-7 text-xs gap-1"
          onClick={onOpen}
          data-testid={`btn-open-trip-${plan.id}`}
        >
          <Play className="h-3 w-3" /> Open
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-destructive hover:bg-destructive/10"
          onClick={onDelete}
          data-testid={`btn-delete-trip-${plan.id}`}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// ── Trip Detail Dialog ─────────────────────────────────────────────────────────
function TripDetailDialog({
  plan,
  open,
  onClose,
  onRefresh,
}: {
  plan: TripPlan | null;
  open: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const { data: detail, isLoading } = useQuery<TripPlan>({
    queryKey: ["/api/routing/plans", plan?.id],
    enabled: open && !!plan?.id,
  });

  const markVisited = useMutation({
    mutationFn: ({ stopId, visited, notes }: { stopId: number; visited: boolean; notes?: string }) =>
      apiRequest("PATCH", `/api/routing/plans/${plan?.id}/stops/${stopId}`, { visited, visitNotes: notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/routing/plans", plan?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/routing/plans"] });
      onRefresh();
    },
  });

  const completePlan = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/routing/plans/${plan?.id}`, { status: "completed" }),
    onSuccess: () => {
      toast({ title: "Trip marked complete" });
      queryClient.invalidateQueries({ queryKey: ["/api/routing/plans"] });
      onClose();
    },
  });

  if (!plan) return null;
  const stops = detail?.stops ?? [];

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Route className="h-4 w-4 text-primary" />
            {plan.name}
          </DialogTitle>
        </DialogHeader>

        {isLoading && <Skeleton className="h-40" />}

        {!isLoading && (
          <div className="space-y-2" data-testid="trip-detail-stops">
            {stops.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No stops in this trip.</p>
            )}
            {stops.map((stop, idx) => (
              <div
                key={stop.id}
                className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors ${
                  stop.visited ? "bg-green-500/5 border-green-500/20" : "bg-muted/20 border-border/40"
                }`}
                data-testid={`trip-detail-stop-${stop.id}`}
              >
                <span className="text-xs font-bold text-muted-foreground w-5 shrink-0 text-center">{idx + 1}</span>
                <button
                  onClick={() => markVisited.mutate({ stopId: stop.id!, visited: !stop.visited })}
                  className="shrink-0"
                  data-testid={`btn-mark-visited-${stop.id}`}
                >
                  {stop.visited
                    ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                    : <Circle className="h-4 w-4 text-muted-foreground" />
                  }
                </button>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-medium truncate ${stop.visited ? "line-through text-muted-foreground" : ""}`}>
                    {stop.entityName}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{stop.entityType}</p>
                  {stop.visitNotes && (
                    <p className="text-[10px] text-muted-foreground italic mt-0.5">{stop.visitNotes}</p>
                  )}
                </div>
                {stop.lat && stop.lng && (
                  <DirectionsMenu lat={stop.lat} lng={stop.lng} label={stop.entityName} />
                )}
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => completePlan.mutate()}
            disabled={completePlan.isPending || plan.status === "completed"}
            data-testid="btn-complete-trip"
          >
            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
            Mark Complete
          </Button>
          <Button size="sm" onClick={onClose} data-testid="btn-close-trip-dialog">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function TerritoryRoutingPage() {
  const { toast } = useToast();

  // Location state
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [addressQuery, setAddressQuery] = useState("");
  const [isLocating, setIsLocating] = useState(false);

  // Filter state
  const [radius, setRadius] = useState("50");
  const [maxStops, setMaxStops] = useState("20");
  const [selectedTypes, setSelectedTypes] = useState<EntityType[]>(["lead", "account", "opportunity", "deployment"]);
  const [scoreThreshold, setScoreThreshold] = useState("0");
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>("all");
  const [showFilters, setShowFilters] = useState(true);

  // Trip builder state
  const [tripStops, setTripStops] = useState<RankedStop[]>([]);

  // Saved trips
  const [selectedTrip, setSelectedTrip] = useState<TripPlan | null>(null);
  const [showTripDetail, setShowTripDetail] = useState(false);

  // Active tab
  const [activeTab, setActiveTab] = useState("nearby");

  // Whether we have a valid location to search
  const hasLocation = lat !== "" && lng !== "" && !isNaN(parseFloat(lat)) && !isNaN(parseFloat(lng));

  // Grouped by territory/region toggle
  const [groupByTerritory, setGroupByTerritory] = useState(false);

  // Nearby query — only fetches when we have location
  const nearbyQuery = useQuery<{ stops: RankedStop[]; total: number; lat: number; lng: number; radiusKm: number }>({
    queryKey: [
      "/api/routing/nearby-ranked",
      lat, lng, radius, maxStops, selectedTypes.join(","), scoreThreshold, urgencyFilter,
    ],
    enabled: hasLocation,
    queryFn: async () => {
      const params = new URLSearchParams({
        lat, lng, radius, maxStops,
        types: selectedTypes.join(","),
        scoreThreshold,
        urgencyFilter,
      });
      const res = await fetch(`/api/routing/nearby-ranked?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch nearby stops");
      return res.json();
    },
    staleTime: 2 * 60 * 1000,
  });

  // Saved trips
  const plansQuery = useQuery<TripPlan[]>({
    queryKey: ["/api/routing/plans"],
  });

  // Geocode address
  const geocodeSearch = useCallback(async () => {
    if (!addressQuery.trim()) return;
    try {
      const res = await fetch(`/api/geocode/search?q=${encodeURIComponent(addressQuery)}&limit=1`, { credentials: "include" });
      if (!res.ok) throw new Error("Not found");
      const data = await res.json();
      if (data.lat && data.lng) {
        setLat(String(data.lat));
        setLng(String(data.lng));
        toast({ title: `Location set: ${data.display_name?.slice(0, 60)}` });
      }
    } catch {
      toast({ title: "Address not found", description: "Try a different search", variant: "destructive" });
    }
  }, [addressQuery, toast]);

  // Geolocation
  const handleLocate = useCallback(() => {
    if (!navigator.geolocation) {
      toast({ title: "Geolocation not supported", variant: "destructive" });
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLat(String(pos.coords.latitude));
        setLng(String(pos.coords.longitude));
        setIsLocating(false);
        toast({ title: "Location acquired" });
      },
      () => {
        setIsLocating(false);
        toast({ title: "Could not get location", variant: "destructive" });
      }
    );
  }, [toast]);

  // Trip builder actions
  const addToTrip = useCallback((stop: RankedStop) => {
    setTripStops(prev => {
      if (prev.some(s => s.entityType === stop.entityType && s.entityId === stop.entityId)) return prev;
      return [...prev, stop];
    });
    toast({ title: `Added: ${stop.entityName}` });
  }, [toast]);

  const removeFromTrip = useCallback((stop: RankedStop) => {
    setTripStops(prev => prev.filter(s => !(s.entityType === stop.entityType && s.entityId === stop.entityId)));
  }, []);

  const reorderTrip = useCallback((fromIdx: number, toIdx: number) => {
    setTripStops(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }, []);

  // Save trip mutation
  const saveTripMutation = useMutation({
    mutationFn: async ({ name, notes }: { name: string; notes: string }) => {
      const planRes = await apiRequest("POST", "/api/routing/plans", {
        name, notes, radiusKm: parseFloat(radius), maxStops: parseInt(maxStops),
      });
      const plan = await planRes.json();
      for (let i = 0; i < tripStops.length; i++) {
        const s = tripStops[i];
        await apiRequest("POST", `/api/routing/plans/${plan.id}/stops`, {
          entityType: s.entityType, entityId: s.entityId, entityName: s.entityName,
          entitySubtype: s.entitySubtype, lat: s.lat, lng: s.lng, address: s.address,
          score: s.predictiveScore, compositeScore: s.compositeScore, rank: s.rank,
          reasons: s.reasons, sortOrder: i,
        });
      }
      return plan;
    },
    onSuccess: (plan) => {
      toast({ title: `Trip "${plan.name}" saved with ${tripStops.length} stops` });
      setTripStops([]);
      queryClient.invalidateQueries({ queryKey: ["/api/routing/plans"] });
      setActiveTab("saved");
    },
    onError: (e: any) => {
      toast({ title: "Failed to save trip", description: e.message, variant: "destructive" });
    },
  });

  // Delete trip
  const deleteTripMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/routing/plans/${id}`),
    onSuccess: () => {
      toast({ title: "Trip deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/routing/plans"] });
    },
  });

  const stops = nearbyQuery.data?.stops ?? [];
  const tripStopKeys = new Set(tripStops.map(s => `${s.entityType}-${s.entityId}`));

  // Group by territory
  const groupedStops = groupByTerritory
    ? stops.reduce((acc, stop) => {
        const key = stop.region || stop.territory || "Unknown";
        (acc[key] = acc[key] || []).push(stop);
        return acc;
      }, {} as Record<string, RankedStop[]>)
    : { "All Stops": stops };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border/50 px-6 py-4 flex items-center justify-between gap-4 shrink-0">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" data-testid="page-title">
            <Route className="h-5 w-5 text-primary" />
            Territory Routing
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Rank nearby stops by score, urgency, and distance — then build your route.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {tripStops.length > 0 && (
            <Badge className="bg-primary/10 text-primary border-primary/30 gap-1" data-testid="badge-trip-count">
              <Route className="h-3 w-3" />
              {tripStops.length} in trip
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-8 text-xs"
            onClick={() => setShowFilters(f => !f)}
            data-testid="btn-toggle-filters"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {showFilters ? "Hide" : "Show"} Filters
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 pb-36 md:pb-24">
        {/* Filters */}
        {showFilters && (
          <div className="mb-4">
            <FiltersPanel
              lat={lat} setLat={setLat}
              lng={lng} setLng={setLng}
              radius={radius} setRadius={setRadius}
              maxStops={maxStops} setMaxStops={setMaxStops}
              selectedTypes={selectedTypes} setSelectedTypes={setSelectedTypes}
              scoreThreshold={scoreThreshold} setScoreThreshold={setScoreThreshold}
              urgencyFilter={urgencyFilter} setUrgencyFilter={setUrgencyFilter}
              onLocate={handleLocate} onSearch={geocodeSearch} isLocating={isLocating}
              addressQuery={addressQuery} setAddressQuery={setAddressQuery}
            />
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4" data-testid="routing-tabs">
            <TabsTrigger value="nearby" data-testid="tab-nearby">
              <MapPin className="h-3.5 w-3.5 mr-1.5" />
              Nearby
              {nearbyQuery.data && (
                <span className="ml-1.5 text-xs bg-primary/10 text-primary px-1.5 rounded-full">
                  {nearbyQuery.data.total}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="trip" data-testid="tab-trip">
              <Route className="h-3.5 w-3.5 mr-1.5" />
              Trip Planner
              {tripStops.length > 0 && (
                <span className="ml-1.5 text-xs bg-primary/10 text-primary px-1.5 rounded-full">
                  {tripStops.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="saved" data-testid="tab-saved">
              <Star className="h-3.5 w-3.5 mr-1.5" />
              Saved Trips
              {(plansQuery.data?.length ?? 0) > 0 && (
                <span className="ml-1.5 text-xs bg-muted/60 text-muted-foreground px-1.5 rounded-full">
                  {plansQuery.data?.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── Nearby Tab ── */}
          <TabsContent value="nearby">
            {!hasLocation && (
              <div className="text-center py-16" data-testid="no-location-prompt">
                <MapPin className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground font-medium">Set your location to find nearby stops</p>
                <p className="text-sm text-muted-foreground/70 mt-1">Use "My Location" or search for an address above.</p>
                <Button className="mt-4 gap-2" onClick={handleLocate} disabled={isLocating} data-testid="btn-locate-cta">
                  <Locate className="h-4 w-4" />
                  {isLocating ? "Locating…" : "Use My Location"}
                </Button>
              </div>
            )}

            {hasLocation && nearbyQuery.isLoading && (
              <div className="space-y-3" data-testid="stops-loading">
                {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}
              </div>
            )}

            {hasLocation && !nearbyQuery.isLoading && stops.length === 0 && (
              <div className="text-center py-16" data-testid="no-stops">
                <Map className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground">No qualifying stops found in this area.</p>
                <p className="text-sm text-muted-foreground/70 mt-1">Try expanding the radius or relaxing filters.</p>
              </div>
            )}

            {hasLocation && !nearbyQuery.isLoading && stops.length > 0 && (
              <>
                {/* Toolbar */}
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm text-muted-foreground" data-testid="stops-count">
                    {stops.length} stop{stops.length !== 1 ? "s" : ""} ranked by priority
                  </p>
                  <button
                    onClick={() => setGroupByTerritory(g => !g)}
                    className={`text-xs flex items-center gap-1.5 px-2.5 py-1 rounded border transition-all ${
                      groupByTerritory ? "bg-primary/10 text-primary border-primary/30" : "text-muted-foreground border-border/50 hover:bg-muted/30"
                    }`}
                    data-testid="btn-group-territory"
                  >
                    <Filter className="h-3 w-3" />
                    Group by region
                  </button>
                </div>

                {/* Stop groups */}
                {Object.entries(groupedStops).map(([group, groupStops]) => (
                  <div key={group}>
                    {groupByTerritory && (
                      <div className="flex items-center gap-2 mb-2 mt-4">
                        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{group}</span>
                        <div className="flex-1 h-px bg-border/40" />
                        <span className="text-xs text-muted-foreground">{groupStops.length}</span>
                      </div>
                    )}
                    <div className="space-y-3">
                      {groupStops.map((stop, idx) => (
                        <StopCard
                          key={`${stop.entityType}-${stop.entityId}`}
                          stop={stop}
                          rank={stops.indexOf(stop) + 1}
                          inTrip={tripStopKeys.has(`${stop.entityType}-${stop.entityId}`)}
                          onAddToTrip={addToTrip}
                          onRemoveFromTrip={removeFromTrip}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </TabsContent>

          {/* ── Trip Planner Tab ── */}
          <TabsContent value="trip">
            <div className="max-w-xl mx-auto">
              <Card className="border border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Route className="h-4 w-4 text-primary" />
                    Build Your Trip
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Drag to reorder stops. Set a name and save to keep the trip.
                  </p>
                </CardHeader>
                <CardContent>
                  <TripBuilder
                    tripStops={tripStops}
                    onRemove={removeFromTrip}
                    onReorder={reorderTrip}
                    onSave={(name, notes) => saveTripMutation.mutate({ name, notes })}
                    onClear={() => setTripStops([])}
                    isSaving={saveTripMutation.isPending}
                  />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── Saved Trips Tab ── */}
          <TabsContent value="saved">
            {plansQuery.isLoading && (
              <div className="grid gap-3 sm:grid-cols-2" data-testid="saved-trips-loading">
                {[1,2,3].map(i => <Skeleton key={i} className="h-36 rounded-xl" />)}
              </div>
            )}

            {!plansQuery.isLoading && (plansQuery.data?.length ?? 0) === 0 && (
              <div className="text-center py-16" data-testid="no-saved-trips">
                <Star className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground">No saved trips yet.</p>
                <p className="text-sm text-muted-foreground/70 mt-1">Build a route in the Trip Planner tab and save it.</p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => setActiveTab("trip")}
                  data-testid="btn-go-to-planner"
                >
                  Go to Trip Planner
                </Button>
              </div>
            )}

            {!plansQuery.isLoading && (plansQuery.data?.length ?? 0) > 0 && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="saved-trips-grid">
                {(plansQuery.data ?? []).map(plan => (
                  <SavedTripCard
                    key={plan.id}
                    plan={plan}
                    onOpen={() => { setSelectedTrip(plan); setShowTripDetail(true); }}
                    onDelete={() => {
                      if (confirm(`Delete "${plan.name}"?`)) deleteTripMutation.mutate(plan.id);
                    }}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Trip Detail Dialog */}
      <TripDetailDialog
        plan={selectedTrip}
        open={showTripDetail}
        onClose={() => { setShowTripDetail(false); setSelectedTrip(null); }}
        onRefresh={() => queryClient.invalidateQueries({ queryKey: ["/api/routing/plans"] })}
      />
    </div>
  );
}
