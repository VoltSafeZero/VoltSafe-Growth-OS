// Today page — fully customisable widget grid, completely independent of the
// Command Center. Widget visibility lives in the same flat
// `widgetVisibility` map on the user profile (today widget ids are
// `today_*` prefixed so they cannot collide with Command Center widgets),
// and grid layouts live under `dashboardLayouts.today` (the server route
// merges per-key, so saving here never disturbs other dashboards).

import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  AlertTriangle, RefreshCw, SlidersHorizontal, Eye, EyeOff, Sparkles, RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

import {
  DashboardGrid,
  DashboardEditToolbar,
  type DashboardGridHandle,
  type Layouts,
} from "@/components/command-centers/dashboard-grid";
import {
  TODAY_WIDGET_DEFS,
  useTodayData,
} from "@/components/today/today-widgets";
import {
  canUserSeeWidget,
  type UserProfile,
  type WidgetDef,
} from "@/lib/dashboard-config";

// Apply this user's permission rules to the today catalog. (None of the today
// widgets currently have visibility rules, but new ones might — this honors
// them automatically.)
function visibleTodayCatalog(profile: UserProfile): WidgetDef[] {
  return TODAY_WIDGET_DEFS.filter(w => canUserSeeWidget(profile, w));
}

const CATEGORY_LABELS: Record<string, string> = {
  action:     "Daily Action",
  risk:       "Risk Signals",
  revenue:    "Revenue",
  pipeline:   "Pipeline",
  team:       "Team",
  operations: "Operations",
  classic:    "Other",
};

// ── Inline widget picker (mirrors the Command Center sheet) ─────────────────

function TodayWidgetPicker({
  widgets, visible, onToggle, onReset,
}: {
  widgets: WidgetDef[];
  visible: Record<string, boolean>;
  onToggle: (id: string) => void;
  onReset: () => void;
}) {
  const byCategory: Record<string, WidgetDef[]> = {};
  for (const w of widgets) {
    const cat = w.category ?? "action";
    (byCategory[cat] ??= []).push(w);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Toggle which widgets appear on your Today page. Independent from your Command Center.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="text-xs gap-1 shrink-0"
            title="Restore the default visible Today widgets. Does not change widget positions."
            data-testid="today-picker-reset-btn"
          >
            <RotateCcw className="h-3 w-3" /> Reset
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground/70 leading-snug">
          To restore widget positions and sizes, use{" "}
          <span className="font-medium text-foreground/80">Reset Layout Positions</span>{" "}
          in the Edit Layout toolbar.
        </p>
      </div>

      <div className="space-y-5">
        {Object.entries(byCategory).map(([cat, catWidgets]) => (
          <div key={cat}>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-2 px-1">
              {CATEGORY_LABELS[cat] ?? cat}
            </p>
            <div className="space-y-2">
              {catWidgets.map(w => (
                <div
                  key={w.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-border/40 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex-1 min-w-0 pr-4">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium">{w.label}</p>
                      {w.isNew && (
                        <Badge className="text-[9px] h-3.5 px-1 py-0 bg-primary/20 text-primary border-primary/30 rounded-full">
                          NEW
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{w.description}</p>
                  </div>
                  <Button
                    variant={visible[w.id] ? "default" : "outline"}
                    size="sm"
                    onClick={() => onToggle(w.id)}
                    className="shrink-0 gap-1 text-xs h-7"
                    data-testid={`toggle-today-widget-${w.id}`}
                  >
                    {visible[w.id]
                      ? <><Eye className="h-3 w-3" /> On</>
                      : <><EyeOff className="h-3 w-3" /> Off</>}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function TodayPage() {
  const { toast } = useToast();
  const profileQuery = useQuery<UserProfile>({ queryKey: ["/api/users/me/profile"] });

  // We still hit /api/dashboard/today here so the page shows a top-level
  // error boundary if the endpoint is down (every widget would be empty
  // otherwise). The widgets share this exact query key, so React Query
  // dedupes and there's only ever one network request.
  const todayQuery = useTodayData();

  // ── Local state for visibility + grid edit ────────────────────────────────
  const [localVisibility, setLocalVisibility] = useState<Record<string, boolean> | null>(null);
  const [editingLayout, setEditingLayout] = useState(false);
  const [draftLayouts, setDraftLayouts] = useState<Layouts | null>(null);
  const [resetSeed, setResetSeed] = useState(0);
  const visibilitySaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gridHandleRef = useRef<DashboardGridHandle | null>(null);

  const saveMutation = useMutation({
    mutationFn: (data: { widgetVisibility?: Record<string, any>; dashboardLayouts?: Record<string, any> }) =>
      apiRequest("PATCH", "/api/users/me/layout", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users/me/profile"] });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err?.message || "Could not save Today layout", variant: "destructive" });
    },
  });

  const profile = profileQuery.data;

  // Compute the catalog + visibility map. Today widgets live in the same flat
  // widgetVisibility map but are namespaced by their `today_` id prefix, so
  // they don't interfere with Command Center toggles.
  const widgets = useMemo(() => profile ? visibleTodayCatalog(profile) : [], [profile]);

  const baseVisibility = useMemo<Record<string, boolean>>(() => {
    const stored = (profile?.widgetVisibility ?? {}) as Record<string, any>;
    const out: Record<string, boolean> = {};
    for (const w of widgets) {
      out[w.id] = w.id in stored ? !!stored[w.id] : w.defaultVisible;
    }
    return out;
  }, [profile, widgets]);

  const visible = localVisibility ?? baseVisibility;

  // The grid only gets ids that are toggled on. Order follows the catalog
  // (TODAY_WIDGET_DEFS order). The grid itself remembers per-widget x/y
  // from saved layouts, so catalog order only matters for newly-added widgets.
  const visibleGridIds = useMemo(
    () => widgets.filter(w => visible[w.id] !== false).map(w => w.id),
    [widgets, visible],
  );

  const allDashboardLayouts = (profile?.dashboardLayouts ?? {}) as Record<string, Layouts>;
  const savedLayouts: Layouts | undefined = allDashboardLayouts.today;
  // resetSeed forces the grid to fall back to defaults after a reset/cancel.
  const effectiveSavedLayouts = resetSeed > 0 && !savedLayouts ? undefined : savedLayouts;

  // Read the freshest stored visibility map at mutation time (not from the
  // closure-captured profile). This avoids stomping on toggles that another
  // tab/page wrote between when we rendered and when our debounced save
  // fires — the server REPLACES widgetVisibility wholesale so we have to
  // ship the full latest map each time.
  const readFreshStoredVisibility = useCallback((): Record<string, any> => {
    const fresh = queryClient.getQueryData<UserProfile>(["/api/users/me/profile"]);
    return ((fresh?.widgetVisibility ?? profile?.widgetVisibility ?? {}) as Record<string, any>);
  }, [profile]);

  // ── Visibility handlers (auto-saved with short debounce) ──────────────────
  const handleToggleWidget = useCallback((id: string) => {
    const current = localVisibility ?? baseVisibility;
    const isOn = current[id] !== false;
    const next = { ...current, [id]: !isOn };
    setLocalVisibility(next);

    if (visibilitySaveTimer.current) clearTimeout(visibilitySaveTimer.current);
    visibilitySaveTimer.current = setTimeout(() => {
      // Re-read freshest server state right before sending so concurrent
      // edits from other tabs aren't silently overwritten.
      const merged = { ...readFreshStoredVisibility(), ...next };
      saveMutation.mutate({ widgetVisibility: merged });
    }, 500);
  }, [localVisibility, baseVisibility, readFreshStoredVisibility, saveMutation]);

  const handleResetWidgets = useCallback(() => {
    setLocalVisibility(null);
    if (visibilitySaveTimer.current) clearTimeout(visibilitySaveTimer.current);
    // Remove every today_* override from the freshest stored visibility map
    // so the catalog defaults take over again. Leaves Command Center toggles
    // intact even if another tab updated them concurrently.
    const stored = { ...readFreshStoredVisibility() };
    for (const id of Object.keys(stored)) {
      if (id.startsWith("today_")) delete stored[id];
    }
    saveMutation.mutate({ widgetVisibility: stored });
    toast({ title: "Today widgets reset to default" });
  }, [readFreshStoredVisibility, saveMutation, toast]);

  // ── Grid edit handlers ─────────────────────────────────────────────────────
  const handleEnterEditMode = useCallback(() => {
    setEditingLayout(true);
    setDraftLayouts(null);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingLayout(false);
    setDraftLayouts(null);
    setResetSeed(s => s + 1);
  }, []);

  const handleSaveLayout = useCallback(() => {
    const live = gridHandleRef.current?.getLayouts();
    const layoutsToSave = live ?? draftLayouts;
    if (!layoutsToSave) {
      setEditingLayout(false);
      return;
    }
    saveMutation.mutate(
      { dashboardLayouts: { today: layoutsToSave } },
      {
        onSuccess: () => {
          setEditingLayout(false);
          setDraftLayouts(null);
          toast({ title: "Today layout saved" });
        },
      },
    );
  }, [draftLayouts, saveMutation, toast]);

  const handleResetLayout = useCallback(() => {
    // Clear today's saved layouts client-side AND on the server. We strip
    // only the `today` key so other dashboards keep their layouts.
    const dl = { ...((profile?.dashboardLayouts ?? {}) as Record<string, any>) };
    delete dl.today;
    // The server merges per-key, so to actually delete we have to send the
    // full dashboardLayouts object as-is (it'll replace because the merge is
    // top-level spread and `today` isn't in the new payload). Instead the
    // simplest correct path: send `today: {}` which represents "no saved
    // positions" — the grid will fall back to defaults via reconcileLayouts.
    saveMutation.mutate(
      { dashboardLayouts: { today: {} as any } },
      {
        onSuccess: () => {
          setEditingLayout(false);
          setDraftLayouts(null);
          setResetSeed(s => s + 1);
          toast({ title: "Today layout reset" });
        },
      },
    );
  }, [profile, saveMutation, toast]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (todayQuery.isError) return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[40vh] gap-4" data-testid="today-error">
      <AlertTriangle className="h-8 w-8 text-amber-400" />
      <p className="text-sm text-muted-foreground">Failed to load today's data.</p>
      <Button variant="outline" size="sm" onClick={() => todayQuery.refetch()} className="gap-2">
        <RefreshCw className="h-3.5 w-3.5" /> Try again
      </Button>
    </div>
  );

  if (profileQuery.isLoading) return (
    <div className="p-4 sm:p-6 space-y-4" data-testid="today-loading">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <div className="grid gap-4 md:grid-cols-2">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-40 rounded-xl" />)}
      </div>
    </div>
  );

  return (
    <div className="p-4 sm:p-6 space-y-4 w-full" data-testid="today-page">
      {/* Header — light, since the day-stats hero widget carries the greeting */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight" data-testid="today-page-title">Today</h1>
          <Badge variant="outline" className="text-[10px] gap-1">
            <Sparkles className="h-2.5 w-2.5" /> Customisable
          </Badge>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          <DashboardEditToolbar
            editing={editingLayout}
            dirty={editingLayout}
            saving={saveMutation.isPending}
            onEdit={handleEnterEditMode}
            onSave={handleSaveLayout}
            onCancel={handleCancelEdit}
            onReset={handleResetLayout}
          />
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8" data-testid="today-widgets-btn">
                <SlidersHorizontal className="h-3.5 w-3.5" /> Widgets
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-80 flex flex-col">
              <SheetHeader>
                <SheetTitle>Today Widgets</SheetTitle>
              </SheetHeader>
              <div className="mt-4 flex-1 min-h-0 overflow-y-auto pr-1 -mr-1">
                <TodayWidgetPicker
                  widgets={widgets}
                  visible={visible}
                  onToggle={handleToggleWidget}
                  onReset={handleResetWidgets}
                />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Empty state (everything toggled off) */}
      {visibleGridIds.length === 0 && (
        <div className="border border-dashed border-border/50 rounded-xl py-12 text-center"
          data-testid="today-empty-state">
          <Sparkles className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            All widgets are hidden. Open <span className="font-medium text-foreground">Widgets</span> to add some back.
          </p>
        </div>
      )}

      {/* Grid */}
      <DashboardGrid
        key={`today-grid-${resetSeed}`}
        visibleIds={visibleGridIds}
        savedLayouts={effectiveSavedLayouts}
        editing={editingLayout}
        onLayoutsChange={setDraftLayouts}
        gridHandleRef={gridHandleRef}
      />
    </div>
  );
}
