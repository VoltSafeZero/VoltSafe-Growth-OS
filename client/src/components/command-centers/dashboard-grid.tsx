import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { Responsive as ResponsiveGridLayout, type LayoutItem, type ResponsiveLayouts } from "react-grid-layout";
import { Button } from "@/components/ui/button";
import { Pencil, Save, X, RotateCcw, Move } from "lucide-react";
import { ACTION_WIDGET_MAP } from "@/components/command-centers/action-widgets";

// Re-export friendlier aliases so callers don't have to know about RGL's naming
export type Layout = LayoutItem;
export type Layouts = ResponsiveLayouts;

export type WidgetSizeHint = { w: number; h: number; minW?: number; minH?: number; maxW?: number; maxH?: number };

// Per-widget default sizing hints. Most widgets are 4 wide × 8 tall on lg (12-col grid).
// Bigger widgets get more room; team_load_balancer is taller; cash_pulse and board_pack
// are wider for their KPI summaries.
const WIDGET_SIZE_HINTS: Record<string, WidgetSizeHint> = {
  cash_pulse:             { w: 6, h: 8,  minW: 3, minH: 6 },
  board_pack_readiness:   { w: 6, h: 9,  minW: 3, minH: 7 },
  team_load_balancer:     { w: 4, h: 12, minW: 3, minH: 6 },
  team_inboxes:           { w: 4, h: 10, minW: 3, minH: 6 },
  ai_suggested_moves:     { w: 4, h: 10, minW: 3, minH: 6 },
  pipeline_funnel:        { w: 6, h: 10, minW: 3, minH: 6 },
  forecast_gap:           { w: 6, h: 8,  minW: 3, minH: 6 },
  todays_meetings:        { w: 4, h: 9,  minW: 3, minH: 6 },
  my_inbox:               { w: 4, h: 8,  minW: 3, minH: 6 },
  inbox_priority_radar:   { w: 4, h: 10, minW: 3, minH: 6 },
  today_critical_actions: { w: 4, h: 10, minW: 3, minH: 6 },
  cert_watchtower:        { w: 4, h: 9,  minW: 3, minH: 6 },
  deployment_pulse:       { w: 4, h: 9,  minW: 3, minH: 6 },
  my_waiting_on:          { w: 4, h: 9,  minW: 3, minH: 6 },
  quick_create_launcher:  { w: 4, h: 7,  minW: 3, minH: 5 },
  open_quotes_aging:      { w: 4, h: 8,  minW: 3, minH: 6 },
  recent_wins:            { w: 4, h: 8,  minW: 3, minH: 6 },
  top_performers:         { w: 4, h: 8,  minW: 3, minH: 6 },
  cert_status_summary:    { w: 4, h: 9,  minW: 3, minH: 6 },
  deal_velocity:          { w: 6, h: 9,  minW: 3, minH: 6 },
  unresponded_leads:      { w: 4, h: 8,  minW: 3, minH: 6 },
  renewal_countdown:      { w: 4, h: 9,  minW: 3, minH: 6 },
};

const DEFAULT_HINT: WidgetSizeHint = { w: 4, h: 8, minW: 3, minH: 6 };

const COLS = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 } as const;
const BREAKPOINTS = { lg: 1280, md: 996, sm: 768, xs: 480, xxs: 0 } as const;
const ROW_HEIGHT = 30;

type BP = keyof typeof COLS;

function hintFor(id: string): WidgetSizeHint {
  return WIDGET_SIZE_HINTS[id] ?? DEFAULT_HINT;
}

/** Clamp size constraints to never exceed the column count for the breakpoint. */
function clampConstraints(hint: WidgetSizeHint, cols: number) {
  const minW = Math.min(hint.minW ?? 1, cols);
  const maxW = hint.maxW != null ? Math.min(hint.maxW, cols) : undefined;
  return { minW, maxW, minH: hint.minH, maxH: hint.maxH };
}

/** Generate a sensible default layout for the given widget IDs at a breakpoint. */
function generateDefaultLayout(widgetIds: string[], cols: number): Layout[] {
  const placed: Layout[] = [];
  let cursorX = 0;
  let cursorY = 0;
  for (const id of widgetIds) {
    const h = hintFor(id);
    let w = Math.min(h.w, cols);
    if (cols <= 4) w = cols;          // narrow screens: full width
    else if (cols <= 6) w = Math.min(w, cols);
    if (cursorX + w > cols) {
      cursorX = 0;
      cursorY = nextOpenRow(placed);
    }
    const c = clampConstraints(h, cols);
    placed.push({
      i: id, x: cursorX, y: cursorY, w, h: h.h,
      minW: c.minW, minH: c.minH, maxW: c.maxW, maxH: c.maxH,
    });
    cursorX += w;
    if (cursorX >= cols) {
      cursorX = 0;
      cursorY = nextOpenRow(placed);
    }
  }
  return placed;
}

function nextOpenRow(layouts: Layout[]): number {
  if (!layouts.length) return 0;
  return Math.max(...layouts.map(l => l.y + l.h));
}

/** Merge a saved layout with the current visible widgets, adding missing ones gracefully. */
function reconcileLayout(saved: Layout[] | undefined, visibleIds: string[], cols: number): Layout[] {
  const savedMap = new Map<string, Layout>();
  (saved ?? []).forEach(l => { if (l && l.i) savedMap.set(l.i, l); });

  const result: Layout[] = [];
  const missing: string[] = [];
  for (const id of visibleIds) {
    const existing = savedMap.get(id);
    if (existing) {
      const hint = hintFor(id);
      const c = clampConstraints(hint, cols);
      const w = Math.max(c.minW, Math.min(existing.w, cols));
      const x = Math.min(existing.x, Math.max(0, cols - w));
      result.push({
        ...existing,
        x,
        w,
        h: Math.max(c.minH ?? 1, existing.h),
        minW: c.minW, minH: c.minH, maxW: c.maxW, maxH: c.maxH,
      });
    } else {
      missing.push(id);
    }
  }
  if (missing.length) {
    // place new widgets after existing ones
    let cursorX = 0;
    let cursorY = nextOpenRow(result);
    for (const id of missing) {
      const h = hintFor(id);
      const w = Math.min(h.w, cols);
      if (cursorX + w > cols) {
        cursorX = 0;
        cursorY = nextOpenRow(result);
      }
      result.push({
        i: id, x: cursorX, y: cursorY, w, h: h.h,
        minW: h.minW, minH: h.minH, maxW: h.maxW, maxH: h.maxH,
      });
      cursorX += w;
      if (cursorX >= cols) {
        cursorX = 0;
        cursorY = nextOpenRow(result);
      }
    }
  }
  // strip any saved widgets no longer visible
  return result.filter(l => visibleIds.includes(l.i));
}

export function generateDefaultLayouts(widgetIds: string[]): Layouts {
  return {
    lg: generateDefaultLayout(widgetIds, COLS.lg),
    md: generateDefaultLayout(widgetIds, COLS.md),
    sm: generateDefaultLayout(widgetIds, COLS.sm),
    xs: generateDefaultLayout(widgetIds, COLS.xs),
    xxs: generateDefaultLayout(widgetIds, COLS.xxs),
  };
}

export function reconcileLayouts(savedLayouts: Layouts | undefined, visibleIds: string[]): Layouts {
  return {
    lg: reconcileLayout(savedLayouts?.lg, visibleIds, COLS.lg),
    md: reconcileLayout(savedLayouts?.md, visibleIds, COLS.md),
    sm: reconcileLayout(savedLayouts?.sm, visibleIds, COLS.sm),
    xs: reconcileLayout(savedLayouts?.xs, visibleIds, COLS.xs),
    xxs: reconcileLayout(savedLayouts?.xxs, visibleIds, COLS.xxs),
  };
}

// ── Widget wrapper ────────────────────────────────────────────────────────────

function WidgetRenderer({ id, editing }: { id: string; editing: boolean }) {
  const Comp = ACTION_WIDGET_MAP[id];
  if (!Comp) return null;
  return (
    <div className="widget-fill" data-testid={`widget-cell-${id}`}>
      {editing && (
        <div
          className="widget-drag-handle absolute inset-x-0 top-0 h-8 cursor-grab active:cursor-grabbing z-20 flex items-center justify-between px-3 rounded-t-[14px] select-none"
          data-testid={`drag-handle-${id}`}
          title="Drag to move · use the corner handle to resize"
        >
          <div className="flex items-center gap-2">
            <span className="grip-dots" aria-hidden="true">
              <span /><span /><span /><span /><span /><span />
            </span>
            <Move className="h-3 w-3 text-primary/80" aria-hidden="true" />
          </div>
          <span className="handle-label">Drag</span>
        </div>
      )}
      {/* Push card content below the drag strip in edit mode */}
      <div className={editing ? "pt-8 h-full flex flex-col min-h-0" : "h-full flex flex-col min-h-0"}>
        <Comp />
      </div>
    </div>
  );
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

export function DashboardEditToolbar({
  editing, dirty, saving, onEdit, onSave, onCancel, onReset,
}: {
  editing: boolean; dirty: boolean; saving: boolean;
  onEdit: () => void; onSave: () => void; onCancel: () => void; onReset: () => void;
}) {
  if (!editing) {
    return (
      <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8"
        onClick={onEdit} data-testid="dashboard-edit-btn">
        <Pencil className="h-3.5 w-3.5" /> Edit Layout
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-1.5 flex-wrap" data-testid="dashboard-edit-toolbar">
      <Button size="sm" className="gap-1.5 text-xs h-8" onClick={onSave}
        disabled={!dirty || saving} data-testid="dashboard-save-btn">
        <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save"}
      </Button>
      <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8"
        onClick={onCancel} disabled={saving} data-testid="dashboard-cancel-btn">
        <X className="h-3.5 w-3.5" /> Cancel
      </Button>
      <Button variant="ghost" size="sm" className="gap-1.5 text-xs h-8 text-muted-foreground hover:text-foreground"
        onClick={onReset} disabled={saving} data-testid="dashboard-reset-btn">
        <RotateCcw className="h-3.5 w-3.5" /> Reset to Default
      </Button>
    </div>
  );
}

// ── DashboardGrid ─────────────────────────────────────────────────────────────

export function DashboardGrid({
  visibleIds,
  savedLayouts,
  editing,
  onLayoutsChange,
}: {
  visibleIds: string[];
  savedLayouts: Layouts | undefined;
  editing: boolean;
  onLayoutsChange: (next: Layouts) => void;
}) {
  // Filter to widgets with a known component
  const renderableIds = useMemo(
    () => visibleIds.filter(id => id in ACTION_WIDGET_MAP),
    [visibleIds],
  );

  const [layouts, setLayouts] = useState<Layouts>(() =>
    reconcileLayouts(savedLayouts, renderableIds)
  );

  // When the visible widget set changes, reconcile (add new / strip removed)
  // without losing user positioning of unchanged widgets.
  const lastIdsRef = useRef<string>(renderableIds.join("|"));
  useEffect(() => {
    const key = renderableIds.join("|");
    if (key !== lastIdsRef.current) {
      lastIdsRef.current = key;
      setLayouts((prev: Layouts) => reconcileLayouts(prev, renderableIds));
    }
  }, [renderableIds]);

  // Sync from external savedLayouts when they change (e.g. after server load or reset)
  const lastSavedKey = useRef<string>(JSON.stringify(savedLayouts ?? null));
  useEffect(() => {
    const key = JSON.stringify(savedLayouts ?? null);
    if (key !== lastSavedKey.current) {
      lastSavedKey.current = key;
      setLayouts(reconcileLayouts(savedLayouts, renderableIds));
    }
  }, [savedLayouts, renderableIds]);

  const handleLayoutChange = useCallback((_current: any, all: Layouts) => {
    setLayouts(all);
    if (editing) onLayoutsChange(all);
  }, [editing, onLayoutsChange]);

  // Measure container width — react-grid-layout v2 Responsive needs an explicit
  // `width` prop (the legacy WidthProvider HOC was removed in v2).
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number>(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  if (renderableIds.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className={editing ? "dashboard-grid-edit" : ""}
      data-testid="dashboard-grid"
      data-editing={editing}
    >
      {width > 0 && (
        <ResponsiveGridLayout
          className="layout"
          layouts={layouts as any}
          width={width}
          breakpoints={BREAKPOINTS}
          cols={COLS}
          rowHeight={ROW_HEIGHT}
          margin={[16, 16]}
          containerPadding={[0, 0]}
          isDraggable={editing}
          isResizable={editing}
          draggableHandle=".widget-drag-handle"
          compactType="vertical"
          preventCollision={false}
          useCSSTransforms
          onLayoutChange={handleLayoutChange as any}
        >
          {renderableIds.map(id => (
            <div key={id} data-testid={`grid-item-${id}`}>
              <WidgetRenderer id={id} editing={editing} />
            </div>
          ))}
        </ResponsiveGridLayout>
      )}
    </div>
  );
}
