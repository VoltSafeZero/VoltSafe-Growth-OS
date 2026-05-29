import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Car, MapPin, Clock, Calendar, Navigation,
  Anchor, AlertCircle, Sparkles, ExternalLink, ChevronDown, ChevronUp,
  Route, Plus, Trash2, GripVertical, ArrowUp, ArrowDown,
  RotateCcw, Search, X,
} from "lucide-react";
import { format } from "date-fns";
import { MarinasDayPlannerDialog } from "@/components/marinas-day-planner-dialog";

// ── Types ────────────────────────────────────────────────────────────────────

type TravelTask = {
  task_id: number;
  title: string;
  due_date: string;
  priority: string;
  status: string;
  lead_id: number;
  company: string;
  city: string | null;
  state: string | null;
  slips: string | null;
  address: string | null;
  marina_lat: number | null;
  marina_lng: number | null;
};

type UpcomingDay = {
  date: string;
  label: string;
  tasks: TravelTask[];
};

type MyDayData = {
  today: TravelTask[];
  upcoming: UpcomingDay[];
};

type ExtraStop = {
  stopId: string;
  lead_id: number;
  company: string;
  city: string | null;
  state: string | null;
  slips: string | null;
  address: string | null;
  marina_lat: number | null;
  marina_lng: number | null;
};

type DisplayStop =
  | { kind: "task"; stopId: string; task: TravelTask }
  | { kind: "extra"; stopId: string; extra: ExtraStop };

type RouteOverride = {
  orderedIds: string[] | null;
  hidden: string[];
  extras: ExtraStop[];
};

// ── Constants ────────────────────────────────────────────────────────────────

const PRIORITY_COLOR: Record<string, string> = {
  urgent: "text-red-400 bg-red-500/10 border-red-500/20",
  high:   "text-orange-400 bg-orange-500/10 border-orange-500/20",
  medium: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  low:    "text-blue-400 bg-blue-500/10 border-blue-500/20",
};
const PRIORITY_DOT: Record<string, string> = {
  urgent: "bg-red-500", high: "bg-orange-400", medium: "bg-amber-400", low: "bg-blue-400",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(d: string) {
  try {
    const utc = d && !/[Z+]/.test(d) ? d.replace(" ", "T") + "Z" : d;
    return new Date(utc).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch { return ""; }
}

function parseSlips(s: string | null) {
  const m = String(s ?? "").match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

function taskStopId(t: TravelTask) { return `t_${t.task_id}`; }

function lsKey(dateKey: string) { return `travel_route_${dateKey}`; }

function loadOverride(dateKey: string): RouteOverride {
  try {
    const raw = localStorage.getItem(lsKey(dateKey));
    if (!raw) return { orderedIds: null, hidden: [], extras: [] };
    return JSON.parse(raw);
  } catch { return { orderedIds: null, hidden: [], extras: [] }; }
}

function saveOverride(dateKey: string, o: RouteOverride) {
  try {
    localStorage.setItem(lsKey(dateKey), JSON.stringify(o));
  } catch {}
}

function hasOverride(o: RouteOverride) {
  return o.orderedIds !== null || o.hidden.length > 0 || o.extras.length > 0;
}

function applyOverride(tasks: TravelTask[], override: RouteOverride): DisplayStop[] {
  const hiddenSet = new Set(override.hidden);

  // Base stops from tasks (not hidden)
  const taskStops: DisplayStop[] = tasks
    .filter(t => !hiddenSet.has(taskStopId(t)))
    .map(t => ({ kind: "task", stopId: taskStopId(t), task: t }));

  // Extra manually-added stops (not hidden)
  const extraStops: DisplayStop[] = override.extras
    .filter(e => !hiddenSet.has(e.stopId))
    .map(e => ({ kind: "extra", stopId: e.stopId, extra: e }));

  const all: DisplayStop[] = [...taskStops, ...extraStops];

  // Apply custom order
  if (override.orderedIds) {
    const orderMap = new Map(override.orderedIds.map((id, i) => [id, i]));
    const inOrder = override.orderedIds
      .map(id => all.find(s => s.stopId === id))
      .filter(Boolean) as DisplayStop[];
    const newOnes = all.filter(s => !orderMap.has(s.stopId));
    return [...inOrder, ...newOnes];
  }

  return all;
}

// ── useRouteOverride hook ─────────────────────────────────────────────────────

function useRouteOverride(dateKey: string) {
  const [override, setOverrideState] = useState<RouteOverride>(() => loadOverride(dateKey));

  // Reload if dateKey changes
  useEffect(() => { setOverrideState(loadOverride(dateKey)); }, [dateKey]);

  const persist = useCallback((next: RouteOverride) => {
    saveOverride(dateKey, next);
    setOverrideState(next);
  }, [dateKey]);

  const setOrder = useCallback((ids: string[]) => {
    setOverrideState(prev => {
      const next = { ...prev, orderedIds: ids };
      saveOverride(dateKey, next);
      return next;
    });
  }, [dateKey]);

  const hideStop = useCallback((stopId: string) => {
    setOverrideState(prev => {
      // Also remove from extras if it's an extra stop
      const next: RouteOverride = {
        orderedIds: prev.orderedIds ? prev.orderedIds.filter(id => id !== stopId) : null,
        hidden: [...prev.hidden.filter(h => h !== stopId), stopId],
        extras: prev.extras.filter(e => e.stopId !== stopId),
      };
      saveOverride(dateKey, next);
      return next;
    });
  }, [dateKey]);

  const addExtra = useCallback((extra: ExtraStop) => {
    setOverrideState(prev => {
      // Avoid duplicates
      if (prev.extras.some(e => e.lead_id === extra.lead_id)) return prev;
      const next: RouteOverride = {
        ...prev,
        extras: [...prev.extras, extra],
        hidden: prev.hidden.filter(h => h !== extra.stopId),
      };
      saveOverride(dateKey, next);
      return next;
    });
  }, [dateKey]);

  const reset = useCallback(() => {
    const next: RouteOverride = { orderedIds: null, hidden: [], extras: [] };
    persist(next);
  }, [persist]);

  return { override, setOrder, hideStop, addExtra, reset };
}

// ── AddStopDialog ─────────────────────────────────────────────────────────────

type LeadResult = {
  id: number;
  company: string;
  city: string | null;
  state: string | null;
  slips: string | null;
  streetAddress: string | null;
  lead_lat: number | null;
  lead_lng: number | null;
  leadLat: number | null;
  leadLng: number | null;
};

function AddStopDialog({
  open,
  onOpenChange,
  existingLeadIds,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existingLeadIds: Set<number>;
  onAdd: (extra: ExtraStop) => void;
}) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading } = useQuery<{ data: LeadResult[]; total: number } | LeadResult[]>({
    queryKey: [`/api/leads?search=${encodeURIComponent(debouncedSearch)}&limit=25`],
    enabled: open,
  });

  const leads: LeadResult[] = useMemo(() => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return (data as any).data ?? [];
  }, [data]);

  function handleAdd(lead: LeadResult) {
    onAdd({
      stopId: `e_${lead.id}`,
      lead_id: lead.id,
      company: lead.company || "Unknown",
      city: lead.city,
      state: lead.state,
      slips: lead.slips,
      address: lead.streetAddress ?? null,
      marina_lat: lead.leadLat ?? lead.lead_lat ?? null,
      marina_lng: lead.leadLng ?? lead.lead_lng ?? null,
    });
    onOpenChange(false);
    setSearch("");
  }

  return (
    <Dialog open={open} onOpenChange={v => { onOpenChange(v); if (!v) setSearch(""); }}>
      <DialogContent className="max-w-md max-h-[80vh] flex flex-col" data-testid="dialog-add-stop">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-primary" /> Add a Stop
          </DialogTitle>
          <DialogDescription>Search for a lead to add to this route.</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            autoFocus
            placeholder="Search leads by name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 pr-8"
            data-testid="input-add-stop-search"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-1 min-h-0">
          {isLoading ? (
            <div className="space-y-2 pt-1">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
            </div>
          ) : leads.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <MapPin className="h-7 w-7 mx-auto mb-2 opacity-25" />
              <p className="text-sm">{debouncedSearch ? "No leads found" : "Start typing to search leads"}</p>
            </div>
          ) : (
            leads.map(lead => {
              const alreadyAdded = existingLeadIds.has(lead.id);
              const loc = [lead.city, lead.state].filter(Boolean).join(", ");
              const slips = parseSlips(lead.slips);
              return (
                <button
                  key={lead.id}
                  disabled={alreadyAdded}
                  onClick={() => !alreadyAdded && handleAdd(lead)}
                  className="w-full flex items-start gap-3 px-3 py-2.5 rounded-lg border border-border/30 hover:bg-muted/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-left"
                  data-testid={`add-stop-lead-${lead.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium">{lead.company}</span>
                      {slips > 0 && (
                        <Badge variant="outline" className="text-[10px] h-4 px-1 gap-0.5">
                          <Anchor className="h-2.5 w-2.5" /> {slips}
                        </Badge>
                      )}
                      {alreadyAdded && <span className="text-[10px] text-muted-foreground italic">already added</span>}
                    </div>
                    {loc && <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><MapPin className="h-2.5 w-2.5 flex-shrink-0" />{loc}</p>}
                  </div>
                  {!alreadyAdded && <Plus className="h-3.5 w-3.5 text-primary flex-shrink-0 mt-1" />}
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── StopCard ──────────────────────────────────────────────────────────────────

function StopCard({
  stop,
  index,
  total,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  stop: DisplayStop;
  index: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  const task = stop.kind === "task" ? stop.task : null;
  const extra = stop.kind === "extra" ? stop.extra : null;

  const company = task?.company ?? extra?.company ?? "";
  const slips = parseSlips(task?.slips ?? extra?.slips ?? null);
  const loc = [(task?.city ?? extra?.city), (task?.state ?? extra?.state)].filter(Boolean).join(", ")
    || task?.address || extra?.address || null;
  const lat = task?.marina_lat ?? extra?.marina_lat ?? null;
  const lng = task?.marina_lng ?? extra?.marina_lng ?? null;
  const leadId = task?.lead_id ?? extra?.lead_id ?? null;
  const priority = task?.priority ?? null;
  const time = task ? fmtTime(task.due_date) : null;
  const mapsUrl = lat && lng
    ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`
    : null;

  return (
    <div
      className="flex items-start gap-3 p-4 rounded-xl border border-border/40 bg-card/60 hover:bg-card/80 transition-colors"
      data-testid={`travel-stop-${stop.stopId}`}
    >
      {/* Reorder controls — always visible */}
      <div className="flex flex-col items-center gap-0.5 flex-shrink-0 mt-0.5">
        <button
          onClick={onMoveUp}
          disabled={index === 0}
          className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
          title="Move up"
          data-testid={`stop-move-up-${stop.stopId}`}
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <GripVertical className="h-4 w-4 text-muted-foreground/30" />
        <button
          onClick={onMoveDown}
          disabled={index === total - 1}
          className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
          title="Move down"
          data-testid={`stop-move-down-${stop.stopId}`}
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Stop number */}
      <div className="w-8 h-8 rounded-full bg-primary/15 text-primary text-sm font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
        {index + 1}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          {leadId ? (
            <a
              href={`/opportunities/${leadId}`}
              className="text-base font-semibold hover:underline text-foreground"
              data-testid={`travel-stop-link-${leadId}`}
            >
              {company}
            </a>
          ) : (
            <span className="text-base font-semibold">{company}</span>
          )}
          {slips > 0 && (
            <Badge variant="outline" className="text-[11px] gap-1 h-5">
              <Anchor className="h-2.5 w-2.5" /> {slips} slips
            </Badge>
          )}
          {priority && (
            <Badge
              variant="outline"
              className={`text-[11px] h-5 capitalize ${PRIORITY_COLOR[priority] ?? ""}`}
            >
              {priority}
            </Badge>
          )}
          {stop.kind === "extra" && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">Added manually</Badge>
          )}
        </div>
        {task && <p className="text-sm text-muted-foreground">{task.title}</p>}
        {loc && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3 flex-shrink-0" /> {loc}
          </div>
        )}
      </div>

      {/* Actions — always visible */}
      <div className="flex flex-col items-end gap-2 flex-shrink-0">
        <button
          onClick={onDelete}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          title="Remove from route"
          data-testid={`stop-delete-${stop.stopId}`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
        {time && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" /> {time}
          </span>
        )}
        {mapsUrl && (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener"
            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80"
            data-testid={`travel-maps-link-${stop.stopId}`}
          >
            <Navigation className="h-3.5 w-3.5" /> Navigate
          </a>
        )}
        {leadId && (
          <a
            href={`/opportunities/${leadId}`}
            className="text-xs text-muted-foreground/60 hover:text-muted-foreground flex items-center gap-1"
          >
            <ExternalLink className="h-3 w-3" /> View opportunity profile
          </a>
        )}
      </div>
    </div>
  );
}

// ── RouteSection ──────────────────────────────────────────────────────────────

function RouteSection({
  dateKey,
  tasks,
  title,
  subTitle,
  collapsible,
  defaultCollapsed,
  plannerLeads,
  onOpenPlanner,
  onDisplayStopsChange,
}: {
  dateKey: string;
  tasks: TravelTask[];
  title: string;
  subTitle?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  plannerLeads?: { id: number; company: string; marina_lat: number; marina_lng: number; marina_address: string | null; street_address: null; city: string | null; state: string | null; slips: string | null; status: string }[];
  onOpenPlanner?: () => void;
  onDisplayStopsChange?: (stops: DisplayStop[]) => void;
}) {
  const [open, setOpen] = useState(!defaultCollapsed);
  const [addOpen, setAddOpen] = useState(false);
  const { override, setOrder, hideStop, addExtra, reset } = useRouteOverride(dateKey);

  const displayStops = useMemo(() => applyOverride(tasks, override), [tasks, override]);

  useEffect(() => { onDisplayStopsChange?.(displayStops); }, [displayStops, onDisplayStopsChange]);

  // All lead IDs currently in route (to prevent duplicates in add dialog)
  const existingLeadIds = useMemo(() => {
    const ids = new Set<number>();
    displayStops.forEach(s => {
      if (s.kind === "task") ids.add(s.task.lead_id);
      else ids.add(s.extra.lead_id);
    });
    return ids;
  }, [displayStops]);

  function moveStop(fromIdx: number, toIdx: number) {
    if (toIdx < 0 || toIdx >= displayStops.length) return;
    const ids = displayStops.map(s => s.stopId);
    const [moved] = ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, moved);
    setOrder(ids);
  }

  const modified = hasOverride(override);

  const stopCount = displayStops.length + (override.hidden.length);

  return (
    <div data-testid={`route-section-${dateKey}`}>
      {/* Section header */}
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {collapsible ? (
            <button
              onClick={() => setOpen(v => !v)}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity text-left min-w-0"
              data-testid={`travel-section-toggle-${dateKey}`}
            >
              <h2 className="text-lg font-semibold">{title}</h2>
              {subTitle && <span className="text-sm text-muted-foreground hidden sm:inline">{subTitle}</span>}
              <Badge variant="secondary" className="text-xs flex-shrink-0">
                {displayStops.length} stop{displayStops.length !== 1 ? "s" : ""}
              </Badge>
              {open ? <ChevronUp className="h-4 w-4 text-muted-foreground/60 flex-shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground/60 flex-shrink-0" />}
            </button>
          ) : (
            <>
              <h2 className="text-lg font-semibold">{title}</h2>
              {subTitle && <span className="text-sm text-muted-foreground">{subTitle}</span>}
              {displayStops.length > 0 && (
                <Badge className="gap-1 flex-shrink-0">
                  <Car className="h-3 w-3" /> {displayStops.length} stop{displayStops.length !== 1 ? "s" : ""}
                </Badge>
              )}
            </>
          )}
        </div>

        {/* Route controls */}
        {modified && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={reset}
              className="h-7 px-2 text-xs text-muted-foreground gap-1 hover:text-foreground"
              title="Reset to original order"
              data-testid={`button-reset-route-${dateKey}`}
            >
              <RotateCcw className="h-3 w-3" /> Reset
            </Button>
          </div>
        )}
      </div>

      {/* Collapsed state for collapsible sections */}
      {collapsible && !open ? null : (
        <div className="space-y-2">
          {displayStops.length === 0 ? (
            <Card className="border-dashed border-border/50">
              <CardContent className="py-8 text-center text-muted-foreground">
                {tasks.length === 0 ? (
                  <>
                    <Car className="h-8 w-8 mx-auto mb-2 opacity-20" />
                    <p className="text-sm">No stops yet</p>
                    <Button variant="outline" size="sm" className="mt-3 gap-1.5" onClick={() => setAddOpen(true)}>
                      <Plus className="h-3.5 w-3.5" /> Add Stop
                    </Button>
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-7 w-7 mx-auto mb-2 opacity-20" />
                    <p className="text-sm">All stops removed</p>
                    <Button variant="outline" size="sm" className="mt-2 gap-1.5" onClick={reset}>
                      <RotateCcw className="h-3.5 w-3.5" /> Restore original stops
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              {displayStops.map((stop, i) => (
                <StopCard
                  key={stop.stopId}
                  stop={stop}
                  index={i}
                  total={displayStops.length}
                  onMoveUp={() => moveStop(i, i - 1)}
                  onMoveDown={() => moveStop(i, i + 1)}
                  onDelete={() => hideStop(stop.stopId)}
                />
              ))}

              {/* Add stop — always visible */}
              <button
                onClick={() => setAddOpen(true)}
                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border-2 border-dashed border-primary/30 hover:border-primary/60 hover:bg-primary/5 text-primary/70 hover:text-primary transition-all text-sm font-medium"
                data-testid={`button-add-stop-${dateKey}`}
              >
                <Plus className="h-4 w-4" /> Add a stop
              </button>

              {/* Planner footer for today */}
              {plannerLeads && plannerLeads.length > 0 && onOpenPlanner && (
                <div className="flex items-center justify-between pt-2">
                  <p className="text-xs text-muted-foreground">
                    {plannerLeads.length} of {stopCount} stops have map coordinates
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={onOpenPlanner}
                    data-testid="button-open-planner-bottom"
                  >
                    <Sparkles className="h-3.5 w-3.5" /> Route in Day Planner
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <AddStopDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        existingLeadIds={existingLeadIds}
        onAdd={extra => {
          addExtra(extra);
          setEditMode(false);
        }}
      />
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function MyTravelPage() {
  const [plannerOpen, setPlannerOpen] = useState(false);

  const { data, isLoading, error } = useQuery<MyDayData>({
    queryKey: ["/api/travel/my-day"],
    refetchInterval: 5 * 60 * 1000,
  });

  const today = data?.today ?? [];
  const upcoming = data?.upcoming ?? [];

  const todayDateKey = format(new Date(), "yyyy-MM-dd");
  const todayLabel = format(new Date(), "EEEE, MMMM d");

  // Reactive today display stops — updated by RouteSection via onDisplayStopsChange
  const [todayDisplayStops, setTodayDisplayStops] = useState<DisplayStop[]>(() =>
    applyOverride(today, loadOverride(todayDateKey))
  );
  // Re-seed when server data arrives
  useEffect(() => {
    setTodayDisplayStops(applyOverride(today, loadOverride(todayDateKey)));
  }, [today, todayDateKey]);

  function stopsToLeads(stops: DisplayStop[]) {
    return stops
      .filter(s => {
        const lat = s.kind === "task" ? s.task.marina_lat : s.extra.marina_lat;
        const lng = s.kind === "task" ? s.task.marina_lng : s.extra.marina_lng;
        return lat && lng;
      })
      .map(s => ({
        id: s.kind === "task" ? s.task.lead_id : s.extra.lead_id,
        company: s.kind === "task" ? s.task.company : s.extra.company,
        marina_lat: (s.kind === "task" ? s.task.marina_lat : s.extra.marina_lat)!,
        marina_lng: (s.kind === "task" ? s.task.marina_lng : s.extra.marina_lng)!,
        marina_address: s.kind === "task" ? s.task.address : s.extra.address,
        street_address: null as null,
        city: s.kind === "task" ? s.task.city : s.extra.city,
        state: s.kind === "task" ? s.task.state : s.extra.state,
        slips: s.kind === "task" ? s.task.slips : s.extra.slips,
        status: "",
      }));
  }
  const plannerLeads = useMemo(() => stopsToLeads(todayDisplayStops), [todayDisplayStops]);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8 pb-36 lg:pb-8 space-y-8">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Car className="h-6 w-6 text-primary" />
              <h1 className="text-2xl font-bold">My Travel</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Marina visits scheduled via tasks linked to leads
            </p>
          </div>
          {plannerLeads.length > 0 && (
            <Button
              onClick={() => setPlannerOpen(true)}
              className="gap-2 flex-shrink-0"
              data-testid="button-plan-route"
            >
              <Route className="h-4 w-4" /> Plan Today's Route
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 text-destructive p-4 rounded-xl border border-destructive/20 bg-destructive/5">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <p>Failed to load travel data. Please refresh.</p>
          </div>
        ) : (
          <>
            {/* ── Today ──────────────────────────────────────────────── */}
            <section data-testid="section-today">
              {today.length === 0 && loadOverride(todayDateKey).extras.length === 0 ? (
                <>
                  <div className="flex items-center justify-between mb-3 gap-2">
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold">Today</h2>
                      <span className="text-sm text-muted-foreground">{todayLabel}</span>
                    </div>
                  </div>
                  <Card className="border-dashed border-border/50">
                    <CardContent className="py-10 text-center text-muted-foreground">
                      <Car className="h-10 w-10 mx-auto mb-3 opacity-20" />
                      <p className="font-medium mb-1">No marina visits scheduled today</p>
                      <p className="text-sm mb-4 max-w-xs mx-auto">
                        To schedule a visit, create a task linked to a lead and set today as the due date.
                      </p>
                      <Button variant="outline" size="sm" asChild>
                        <a href="/opportunities">
                          <Plus className="h-3.5 w-3.5 mr-1.5" /> Browse Leads
                        </a>
                      </Button>
                    </CardContent>
                  </Card>
                </>
              ) : (
                <RouteSection
                  dateKey={todayDateKey}
                  tasks={today}
                  title="Today"
                  subTitle={todayLabel}
                  plannerLeads={plannerLeads}
                  onOpenPlanner={() => setPlannerOpen(true)}
                  onDisplayStopsChange={setTodayDisplayStops}
                />
              )}
            </section>

            {/* ── Upcoming ───────────────────────────────────────────── */}
            <section data-testid="section-upcoming">
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-lg font-semibold">Upcoming</h2>
                {upcoming.length > 0 && (
                  <Badge variant="secondary">
                    {upcoming.reduce((s, d) => s + d.tasks.length, 0)} visit{upcoming.reduce((s, d) => s + d.tasks.length, 0) !== 1 ? "s" : ""}
                  </Badge>
                )}
              </div>

              {upcoming.length === 0 ? (
                <Card className="border-dashed border-border/50">
                  <CardContent className="py-8 text-center text-muted-foreground">
                    <Calendar className="h-8 w-8 mx-auto mb-2 opacity-20" />
                    <p className="text-sm">No visits in the next 14 days</p>
                    <p className="text-xs mt-1">
                      Create tasks linked to leads with future due dates to see them here.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
                  {upcoming.map(day => (
                    <RouteSection
                      key={day.date}
                      dateKey={day.date}
                      tasks={day.tasks}
                      title={day.label}
                      collapsible
                      defaultCollapsed
                    />
                  ))}
                </div>
              )}
            </section>

            {/* ── How it works ───────────────────────────────────────── */}
            {today.length === 0 && upcoming.length === 0 && (
              <Card className="border-primary/20 bg-primary/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-primary flex items-center gap-2">
                    <Sparkles className="h-4 w-4" /> How My Travel Works
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-2">
                  <p>1. Go to a lead in your pipeline (e.g. <a href="/opportunities" className="text-primary underline">Leads</a>).</p>
                  <p>2. Create a task linked to that lead and set a due date for the visit day.</p>
                  <p>3. That visit will appear here — today's stops can be routed in the Day Planner.</p>
                  <p>4. Use the <strong className="text-foreground">Edit</strong> button on any day to reorder, remove, or add extra stops to your route.</p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      <MarinasDayPlannerDialog
        open={plannerOpen}
        onOpenChange={setPlannerOpen}
        userLocation={null}
        preselectedLeads={plannerLeads}
      />
    </div>
  );
}
