// today.tsx — Executive Operating Cockpit (Phase 2 + CEO Cockpit)
// Phase 2: section order/hide/pin preferences, Priority Action sorting,
// snooze controls, inline task completion, follow-up task creation.
// CEO Cockpit (admin-only): Team Pulse, Blockers, Silence Watch, Commitments,
// 1:1 Operating System, CEO Attention, Communication Hotspots.

import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle, RefreshCw, Calendar, CheckSquare, Mail,
  MessageSquare, TrendingUp, Megaphone, Settings, Star,
  Clock, ChevronRight, ArrowUpRight, Zap, Building2,
  CheckCircle2, Circle, SlidersHorizontal, Pin, PinOff,
  BellOff, ChevronUp, ChevronDown, Plus, MoreVertical,
  RotateCcw, Eye, EyeOff, CheckCircle,
  LayoutDashboard, FileText, Activity, Users, BookOpen, Shield, BarChart2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  UniversalDrilldownSheet,
  type UniversalDrilldownConfig,
} from "@/components/shared/universal-drilldown-sheet";
import { usePageFavorites } from "@/hooks/use-page-favorites";
import { useRecentPages } from "@/hooks/use-recent-pages";
import { useToast } from "@/hooks/use-toast";
import { useTodayPrefs } from "@/hooks/use-today-prefs";
import { type UserProfile } from "@/lib/dashboard-config";
import {
  TeamPulseSection, BlockersSection, SilenceWatchSection,
  CommitmentsSection, OneOnOnesSection, CeoAttentionSection,
  CommunicationHotspotsSection,
  type CeoCockpitData,
} from "@/components/today/ceo-cockpit-sections";
import { CeoActionQueuePanel } from "@/components/today/ceo-action-queue";
import { CeoBriefingPanel } from "@/components/today/ceo-briefing";
import { CeoExecutionRadarPanel } from "@/components/today/ceo-execution-radar";
import { CeoForecastingPanel } from "@/components/today/ceo-forecasting";

// ── Types ──────────────────────────────────────────────────────────────────────

type ActionSeverity = "critical" | "high" | "medium" | "low";

type PriorityAction = {
  id: string; type: string; title: string; description: string;
  severity: ActionSeverity; link: string; source: string; dueAt?: string;
};

type TodaySummary = {
  generated_at: string;
  user: { id: number; is_capital_user: boolean };
  sections: {
    priority_actions: { title: string; count: number; items: PriorityAction[]; empty_state: string };
    schedule: { title: string; count: number; items: any[]; next_meeting: any | null; empty_state: string; link: string };
    tasks: {
      title: string;
      counts: { due_today: number; overdue: number; high_priority: number; completed_today: number };
      due_today: any[]; overdue: any[]; high_priority: any[];
      empty_state: string; link: string; drilldown_endpoint: string;
    };
    inbox: { title: string; counts: { unread_inbox: number; unread_total: number; recent_unread_inbound: number }; empty_state: string; link: string };
    currents: { title: string; count: number; channel_messages: any[]; dm_messages: any[]; empty_state: string; link: string };
    pipeline: {
      title: string;
      counts: { stalled: number; quotes_awaiting: number; hot_opportunities: number };
      hot_opportunities: any[];
      empty_state: string; link: string; drilldown_endpoint: string;
    };
    marketing: { title: string; counts: { active: number; draft: number; paused: number; blocked: number }; empty_state: string; link: string; drilldown_endpoint: string };
    operations: { title: string; counts: { blocked_installs: number; overdue_installs: number; blocked_procurement: number }; empty_state: string; link: string; drilldown_endpoint: string };
    capital: {
      title: string;
      investors: any[];
      stats: { total_active: number; overdue_follow_ups: number; hot_count: number };
      link: string; drilldown_endpoint?: string; empty_state: string;
    } | null;
  };
};

// ── Section config — canonical list with metadata ──────────────────────────────

type SectionMeta = {
  id: string;
  label: string;
  alwaysVisible?: boolean;
  capitalOnly?: boolean;
  fullWidth?: boolean;
};

const SECTION_CONFIG: SectionMeta[] = [
  { id: "priority_actions", label: "Priority Actions", alwaysVisible: true, fullWidth: true },
  { id: "schedule",         label: "Schedule" },
  { id: "tasks",            label: "Tasks" },
  { id: "inbox",            label: "Inbox" },
  { id: "currents",         label: "CURRENTS" },
  { id: "pipeline",         label: "Pipeline" },
  { id: "marketing",        label: "Marketing" },
  { id: "operations",       label: "Operations", fullWidth: true },
  { id: "capital",          label: "Capital & Fundraising", capitalOnly: true, fullWidth: true },
  { id: "favorites_recents", label: "Favorites & Recents", fullWidth: true },
];

const DEFAULT_ORDER = SECTION_CONFIG.map(s => s.id);

// Adjacent pairs rendered in 2-col grid when consecutive in order
const KNOWN_PAIRS: [string, string][] = [
  ["schedule", "tasks"],
  ["inbox", "currents"],
  ["pipeline", "marketing"],
];

const SEVERITY_ORDER: Record<ActionSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

// ── Severity badge ─────────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<ActionSeverity, string> = {
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
  high:     "bg-orange-500/20 text-orange-400 border-orange-500/30",
  medium:   "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  low:      "bg-muted/50 text-muted-foreground border-border",
};

function SeverityBadge({ severity }: { severity: ActionSeverity }) {
  return (
    <Badge className={`text-[10px] h-4 px-1.5 border font-medium shrink-0 ${SEVERITY_STYLES[severity]}`}>
      {severity}
    </Badge>
  );
}

// ── Format helpers ─────────────────────────────────────────────────────────────

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }); }
  catch { return "—"; }
}

function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" }); }
  catch { return "—"; }
}

// ── MetricChip — clickable stat, optionally opens a drilldown ─────────────────

function MetricChip({
  label, value, endpoint, metric, link, colorClass = "text-foreground", testId, compact,
}: {
  label: string; value: number | string; endpoint?: string; metric?: string;
  link?: string; colorClass?: string; testId?: string; compact?: boolean;
}) {
  const [drilldown, setDrilldown] = useState<UniversalDrilldownConfig | null>(null);
  const canDrill = !!(endpoint && metric);

  const chip = (
    <button
      type="button"
      onClick={canDrill ? () => setDrilldown({ metric: metric!, title: label }) : undefined}
      data-testid={testId}
      className={`flex flex-col items-center ${compact ? "px-2 py-1.5" : "px-3 py-2"} rounded-lg border border-border/40 bg-muted/20 transition-colors min-w-[56px] ${canDrill || link ? "cursor-pointer hover:bg-muted/50 hover:border-border" : "cursor-default"}`}
    >
      <span className={`${compact ? "text-lg" : "text-xl"} font-bold tabular-nums leading-none ${colorClass}`}>{value}</span>
      <span className="text-[10px] text-muted-foreground mt-0.5 text-center leading-tight">{label}</span>
    </button>
  );

  if (link && !canDrill) return <Link href={link}>{chip}</Link>;

  return (
    <>
      {chip}
      {canDrill && (
        <UniversalDrilldownSheet config={drilldown} onClose={() => setDrilldown(null)} endpoint={endpoint} />
      )}
    </>
  );
}

// ── SectionCard ────────────────────────────────────────────────────────────────

function SectionCard({
  icon: Icon, title, count, link, linkLabel = "View all", children, testId,
  isPinned, onTogglePin, onHide, onRefresh, isFetching, compact,
}: {
  icon: React.ElementType; title: string; count?: number; link?: string;
  linkLabel?: string; children: React.ReactNode; testId?: string;
  isPinned?: boolean; onTogglePin?: () => void; onHide?: () => void;
  onRefresh?: () => void; isFetching?: boolean; compact?: boolean;
}) {
  return (
    <Card
      className={`border-border/50 bg-card/60 ${isPinned ? "ring-1 ring-primary/30" : ""}`}
      data-testid={testId}
    >
      <CardHeader className={`${compact ? "pb-2 pt-3" : "pb-3 pt-4"} px-4`}>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Icon className="h-4 w-4 text-muted-foreground" />
            {title}
            {isPinned && <Pin className="h-3 w-3 text-primary/60" />}
            {count !== undefined && count > 0 && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{count}</Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-1">
            {link && (
              <Link href={link}>
                <Button
                  variant="ghost" size="sm"
                  className="text-[11px] h-6 px-2 gap-1 text-muted-foreground hover:text-foreground"
                  data-testid={`${testId}-view-all`}
                >
                  {linkLabel} <ChevronRight className="h-3 w-3" />
                </Button>
              </Link>
            )}
            {(onTogglePin || onHide || onRefresh) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost" size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground/50 hover:text-muted-foreground"
                    data-testid={`${testId}-section-menu`}
                  >
                    <MoreVertical className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40 text-xs">
                  {onRefresh && (
                    <DropdownMenuItem onClick={onRefresh} className="gap-2 text-xs" data-testid={`${testId}-refresh`}>
                      <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
                      Refresh
                    </DropdownMenuItem>
                  )}
                  {onTogglePin && (
                    <DropdownMenuItem onClick={onTogglePin} className="gap-2 text-xs" data-testid={`${testId}-pin`}>
                      {isPinned ? <><PinOff className="h-3.5 w-3.5" /> Unpin</> : <><Pin className="h-3.5 w-3.5" /> Pin</>}
                    </DropdownMenuItem>
                  )}
                  {onHide && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={onHide} className="gap-2 text-xs text-muted-foreground" data-testid={`${testId}-hide`}>
                        <EyeOff className="h-3.5 w-3.5" /> Hide section
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className={`px-4 ${compact ? "pb-3" : "pb-4"}`}>{children}</CardContent>
    </Card>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground/70 py-2 italic">{text}</p>;
}

// ── Customize Today sheet ──────────────────────────────────────────────────────

function CustomizeTodaySheet({
  prefs, toggleVisibility, setSectionOrder, togglePin, setCompact,
  isCapital, resetPrefs,
}: {
  prefs: ReturnType<typeof useTodayPrefs>["prefs"];
  toggleVisibility: (id: string) => void;
  setSectionOrder: (order: string[]) => void;
  togglePin: (id: string) => void;
  setCompact: (v: boolean) => void;
  isCapital: boolean;
  resetPrefs: () => void;
}) {
  const visibleSections = SECTION_CONFIG.filter(s => {
    if (s.capitalOnly && !isCapital) return false;
    return true;
  });

  const effectiveOrder = prefs.sectionOrder.length > 0
    ? prefs.sectionOrder.filter(id => visibleSections.some(s => s.id === id))
    : visibleSections.map(s => s.id);

  function moveSection(id: string, direction: -1 | 1) {
    const current = effectiveOrder;
    const idx = current.indexOf(id);
    if (idx < 0) return;
    const next = [...current];
    const target = idx + direction;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setSectionOrder(next);
  }

  const isHidden = (id: string) => prefs.hiddenSections.includes(id);
  const isPinned = (id: string) => prefs.pinnedSections.includes(id);

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="outline" size="sm"
          className="gap-1.5 text-xs h-8"
          data-testid="today-customize-btn"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Customize
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-80 sm:w-96" data-testid="customize-today-sheet">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-base">Customize Today</SheetTitle>
        </SheetHeader>

        {/* Compact mode toggle */}
        <div className="flex items-center justify-between py-3 border-b border-border/50" data-testid="compact-mode-toggle">
          <Label className="text-sm font-medium cursor-pointer">Compact view</Label>
          <Switch
            checked={prefs.compact}
            onCheckedChange={setCompact}
            data-testid="compact-mode-switch"
          />
        </div>

        {/* Section list */}
        <div className="py-3 space-y-1" data-testid="section-order-list">
          <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Sections</p>
          {effectiveOrder.map((id, idx) => {
            const meta = visibleSections.find(s => s.id === id);
            if (!meta) return null;
            const hidden = isHidden(id);
            const pinned = isPinned(id);
            const canHide = !meta.alwaysVisible;

            return (
              <div
                key={id}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-md border ${pinned ? "border-primary/30 bg-primary/5" : "border-transparent"} hover:bg-muted/30 transition-colors`}
                data-testid={`section-row-${id}`}
              >
                <div className="flex flex-col gap-0.5">
                  <Button
                    variant="ghost" size="sm"
                    className="h-4 w-5 p-0 text-muted-foreground/50 hover:text-muted-foreground"
                    onClick={() => moveSection(id, -1)}
                    disabled={idx === 0}
                    data-testid={`section-up-${id}`}
                  >
                    <ChevronUp className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost" size="sm"
                    className="h-4 w-5 p-0 text-muted-foreground/50 hover:text-muted-foreground"
                    onClick={() => moveSection(id, 1)}
                    disabled={idx === effectiveOrder.length - 1}
                    data-testid={`section-down-${id}`}
                  >
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </div>

                <span className={`flex-1 text-sm ${hidden ? "line-through text-muted-foreground/50" : ""}`}>
                  {meta.label}
                </span>

                {meta.alwaysVisible && (
                  <Badge variant="outline" className="text-[9px] h-4 px-1.5 shrink-0">always on</Badge>
                )}

                <Button
                  variant="ghost" size="sm"
                  className={`h-6 w-6 p-0 shrink-0 ${pinned ? "text-primary" : "text-muted-foreground/50 hover:text-muted-foreground"}`}
                  onClick={() => togglePin(id)}
                  title={pinned ? "Unpin" : "Pin"}
                  data-testid={`section-pin-${id}`}
                >
                  {pinned ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
                </Button>

                {canHide && (
                  <Button
                    variant="ghost" size="sm"
                    className={`h-6 w-6 p-0 shrink-0 ${hidden ? "text-muted-foreground/50" : "text-muted-foreground/80 hover:text-muted-foreground"}`}
                    onClick={() => toggleVisibility(id)}
                    title={hidden ? "Show" : "Hide"}
                    data-testid={`section-toggle-${id}`}
                  >
                    {hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {/* Reset */}
        <div className="pt-4 border-t border-border/50">
          <Button
            variant="outline" size="sm"
            className="w-full gap-2 text-xs"
            onClick={resetPrefs}
            data-testid="reset-layout-btn"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset to default layout
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Priority Actions ───────────────────────────────────────────────────────────

const TYPE_ICONS: Record<string, React.ElementType> = {
  meeting: Calendar, tasks: CheckSquare, operations: Settings,
  marketing: Megaphone, capital: Building2, pipeline: TrendingUp,
  support: AlertTriangle,
};

const SEVERITY_WEIGHT: Record<ActionSeverity, number> = { critical: 3, high: 2, medium: 1, low: 0 };

function sortActions(items: PriorityAction[], sortBy: string): PriorityAction[] {
  return [...items].sort((a, b) => {
    if (sortBy === "severity") {
      const diff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (diff !== 0) return diff;
      if (a.dueAt && b.dueAt) return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
      if (a.dueAt) return -1;
      if (b.dueAt) return 1;
      return 0;
    }
    if (sortBy === "time") {
      if (a.dueAt && b.dueAt) return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
      if (a.dueAt) return -1;
      if (b.dueAt) return 1;
      return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    }
    if (sortBy === "source") {
      return a.source.localeCompare(b.source) || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    }
    return 0;
  });
}

function SnoozeMenu({
  action, onSnooze, onUnsnooze, isSnoozed,
}: {
  action: PriorityAction;
  onSnooze: (days: number) => void;
  onUnsnooze: () => void;
  isSnoozed: boolean;
}) {
  const isCritical = action.severity === "critical";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost" size="sm"
          className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/60 hover:text-muted-foreground shrink-0"
          data-testid={`snooze-menu-${action.id}`}
          onClick={e => e.stopPropagation()}
        >
          <MoreVertical className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44 text-xs">
        {isSnoozed ? (
          <DropdownMenuItem onClick={onUnsnooze} className="gap-2 text-xs" data-testid={`unsnooze-${action.id}`}>
            <BellOff className="h-3.5 w-3.5" /> Show again
          </DropdownMenuItem>
        ) : (
          <>
            {isCritical && (
              <div className="px-2 py-1.5 text-[10px] text-amber-400 bg-amber-500/10 rounded mx-1 mb-1">
                This item is critical — snooze with caution.
              </div>
            )}
            <DropdownMenuItem
              onClick={() => onSnooze(1)}
              className="gap-2 text-xs"
              data-testid={`snooze-1d-${action.id}`}
            >
              <BellOff className="h-3.5 w-3.5" /> Snooze until tomorrow
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onSnooze(3)}
              className="gap-2 text-xs"
              data-testid={`snooze-3d-${action.id}`}
            >
              <BellOff className="h-3.5 w-3.5" /> Snooze for 3 days
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PriorityActionsSection({
  items, emptyState, sortBy, onSortChange, onSnooze, onUnsnooze, isSnoozed, compact,
}: {
  items: PriorityAction[];
  emptyState: string;
  sortBy: string;
  onSortChange: (v: string) => void;
  onSnooze: (id: string, type: string, days: number) => void;
  onUnsnooze: (id: string) => void;
  isSnoozed: (id: string) => boolean;
  compact?: boolean;
}) {
  const visible = sortActions(
    items.filter(a => !isSnoozed(a.id)),
    sortBy,
  );
  const snoozedCount = items.filter(a => isSnoozed(a.id)).length;

  return (
    <div className="space-y-2" data-testid="priority-actions-section">
      {/* Sort controls */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Sort by</span>
          <Select value={sortBy} onValueChange={onSortChange}>
            <SelectTrigger
              className="h-6 text-xs w-[110px] border-border/50"
              data-testid="priority-sort-select"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="severity" data-testid="sort-severity">Severity</SelectItem>
              <SelectItem value="time" data-testid="sort-time">Due time</SelectItem>
              <SelectItem value="source" data-testid="sort-source">Source</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {snoozedCount > 0 && (
          <span className="text-[10px] text-muted-foreground italic" data-testid="snoozed-count">
            {snoozedCount} snoozed
          </span>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="flex items-center gap-2 py-2" data-testid="priority-actions-empty">
          <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
          <p className="text-sm text-muted-foreground">
            {snoozedCount > 0 ? `All caught up — ${snoozedCount} item${snoozedCount > 1 ? "s" : ""} snoozed.` : emptyState}
          </p>
        </div>
      ) : (
        <div className="space-y-1" data-testid="priority-actions-list">
          {visible.map((action) => {
            const Icon = TYPE_ICONS[action.type] ?? Circle;
            const snoozed = isSnoozed(action.id);
            return (
              <div
                key={action.id}
                className={`flex items-center gap-3 ${compact ? "px-2 py-1.5" : "px-3 py-2"} rounded-lg hover:bg-muted/40 transition-colors cursor-pointer group`}
                data-testid={`priority-action-${action.id}`}
              >
                <Link href={action.link} className="flex-1 flex items-center gap-3 min-w-0">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{action.title}</p>
                    {action.description && !compact && (
                      <p className="text-xs text-muted-foreground truncate">{action.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {action.dueAt && (
                      <span className="text-[10px] text-muted-foreground/60 shrink-0">{fmtDateShort(action.dueAt)}</span>
                    )}
                    <Badge variant="outline" className="text-[9px] h-4 px-1.5 text-muted-foreground/70 shrink-0">{action.source}</Badge>
                    <SeverityBadge severity={action.severity} />
                    <ArrowUpRight className="h-3 w-3 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
                  </div>
                </Link>
                <SnoozeMenu
                  action={action}
                  isSnoozed={snoozed}
                  onSnooze={(days) => onSnooze(action.id, action.type, days)}
                  onUnsnooze={() => onUnsnooze(action.id)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Schedule ───────────────────────────────────────────────────────────────────

function ScheduleSection({ data, compact }: { data: TodaySummary["sections"]["schedule"]; compact?: boolean }) {
  if (data.items.length === 0) return <EmptyState text={data.empty_state} />;
  return (
    <div className="space-y-1.5" data-testid="schedule-list">
      {data.items.map((m: any) => (
        <div key={m.id} className={`flex items-start gap-2.5 ${compact ? "py-1" : "py-1.5"}`}>
          <div className="flex flex-col items-center shrink-0 pt-0.5">
            <span className="text-[11px] font-semibold text-primary">{fmtTime(m.startTime)}</span>
            {m.endTime && <span className="text-[9px] text-muted-foreground/60">{fmtTime(m.endTime)}</span>}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{m.title}</p>
            {m.location && !compact && <p className="text-[11px] text-muted-foreground truncate">{m.location}</p>}
          </div>
          {m.meetingUrl && (
            <a href={m.meetingUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] gap-1 text-muted-foreground" data-testid="schedule-join-btn">
                Join <ArrowUpRight className="h-2.5 w-2.5" />
              </Button>
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Tasks — with inline complete + follow-up task creation ─────────────────────

function CreateFollowUpButton({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const { toast } = useToast();

  const createMutation = useMutation({
    mutationFn: (t: string) => apiRequest("POST", "/api/tasks", { title: t, status: "pending", priority: "medium" }),
    onSuccess: () => {
      toast({ title: "Follow-up task created" });
      setTitle("");
      setOpen(false);
      onCreated();
    },
    onError: () => toast({ title: "Failed to create task", variant: "destructive" }),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost" size="sm"
          className="h-6 px-2 gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          data-testid="create-followup-btn"
        >
          <Plus className="h-3 w-3" /> Follow-up task
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="end" data-testid="create-followup-popover">
        <p className="text-xs font-medium mb-2">New follow-up task</p>
        <Input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Task title…"
          className="h-8 text-xs mb-2"
          onKeyDown={e => {
            if (e.key === "Enter" && title.trim()) createMutation.mutate(title.trim());
          }}
          autoFocus
          data-testid="followup-task-input"
        />
        <Button
          size="sm"
          className="w-full h-7 text-xs"
          disabled={!title.trim() || createMutation.isPending}
          onClick={() => createMutation.mutate(title.trim())}
          data-testid="followup-task-submit"
        >
          {createMutation.isPending ? "Creating…" : "Create task"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function InlineCompleteButton({ taskId, onDone }: { taskId: number; onDone: () => void }) {
  const { toast } = useToast();
  const completeMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/tasks/${taskId}/complete`),
    onSuccess: () => {
      toast({ title: "Task marked complete" });
      onDone();
    },
    onError: () => toast({ title: "Failed to complete task", variant: "destructive" }),
  });

  return (
    <Button
      variant="ghost" size="sm"
      className="h-5 w-5 p-0 text-muted-foreground/40 hover:text-green-400 transition-colors shrink-0"
      onClick={e => { e.preventDefault(); e.stopPropagation(); completeMutation.mutate(); }}
      disabled={completeMutation.isPending}
      title="Mark complete"
      data-testid={`complete-task-${taskId}`}
    >
      {completeMutation.isPending
        ? <RefreshCw className="h-3 w-3 animate-spin" />
        : <Circle className="h-3 w-3 hover:hidden" />
      }
    </Button>
  );
}

function TasksSection({ data, onRefreshToday, compact }: {
  data: TodaySummary["sections"]["tasks"];
  onRefreshToday: () => void;
  compact?: boolean;
}) {
  const [drilldown, setDrilldown] = useState<UniversalDrilldownConfig | null>(null);
  const { counts } = data;
  const allTasks = [
    ...data.overdue.map((t: any) => ({ ...t, _isOverdue: true })),
    ...data.due_today,
  ];

  return (
    <div className="space-y-3" data-testid="tasks-section-content">
      <div className="flex gap-2 flex-wrap">
        <MetricChip
          label="Due Today" value={counts.due_today}
          endpoint={data.drilldown_endpoint} metric="tasks_due_today"
          colorClass={counts.due_today > 0 ? "text-yellow-400" : "text-muted-foreground"}
          testId="chip-tasks-due-today" compact={compact}
        />
        <MetricChip
          label="Overdue" value={counts.overdue}
          endpoint={data.drilldown_endpoint} metric="tasks_overdue"
          colorClass={counts.overdue > 0 ? "text-red-400" : "text-muted-foreground"}
          testId="chip-tasks-overdue" compact={compact}
        />
        <MetricChip
          label="High Priority" value={counts.high_priority}
          endpoint={data.drilldown_endpoint} metric="tasks_high_priority"
          colorClass={counts.high_priority > 0 ? "text-orange-400" : "text-muted-foreground"}
          testId="chip-tasks-high-priority" compact={compact}
        />
        <MetricChip
          label="Done Today" value={counts.completed_today}
          link={data.link}
          colorClass={counts.completed_today > 0 ? "text-green-400" : "text-muted-foreground"}
          testId="chip-tasks-done-today" compact={compact}
        />
      </div>
      {allTasks.length === 0 ? (
        <EmptyState text={data.empty_state} />
      ) : (
        <div className="space-y-1" data-testid="tasks-list">
          {allTasks.slice(0, 5).map((t: any) => (
            <div key={t.id} className="flex items-center gap-2 py-1 group">
              <InlineCompleteButton taskId={t.id} onDone={onRefreshToday} />
              <Link href={data.link} className="flex-1 flex items-center gap-2 min-w-0">
                <span className="text-sm flex-1 truncate">{t.title}</span>
                {t._isOverdue ? (
                  <Badge className="text-[9px] h-3.5 px-1 bg-red-500/20 text-red-400 border-red-500/30 border shrink-0">overdue</Badge>
                ) : t.dueDate ? (
                  <span className="text-[10px] text-muted-foreground shrink-0">{fmtDateShort(t.dueDate)}</span>
                ) : null}
              </Link>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end">
        <CreateFollowUpButton onCreated={onRefreshToday} />
      </div>
      <UniversalDrilldownSheet config={drilldown} onClose={() => setDrilldown(null)} endpoint={data.drilldown_endpoint} />
    </div>
  );
}

// ── Inbox ──────────────────────────────────────────────────────────────────────

function InboxSection({ data, compact }: { data: TodaySummary["sections"]["inbox"]; compact?: boolean }) {
  const { counts } = data;
  return (
    <div className="space-y-3" data-testid="inbox-section-content">
      <div className="flex gap-2 flex-wrap">
        <MetricChip label="Unread Inbox" value={counts.unread_inbox} link={data.link} colorClass={counts.unread_inbox > 0 ? "text-primary" : "text-muted-foreground"} testId="chip-inbox-unread" compact={compact} />
        <MetricChip label="Unread Total" value={counts.unread_total} link={data.link} colorClass={counts.unread_total > 0 ? "text-foreground" : "text-muted-foreground"} testId="chip-inbox-unread-total" compact={compact} />
        <MetricChip label="New Inbound" value={counts.recent_unread_inbound} link={data.link} colorClass={counts.recent_unread_inbound > 0 ? "text-cyan-400" : "text-muted-foreground"} testId="chip-inbox-inbound" compact={compact} />
      </div>
      {counts.unread_inbox === 0 && counts.unread_total === 0
        ? <EmptyState text={data.empty_state} />
        : null
      }
    </div>
  );
}

// ── CURRENTS ───────────────────────────────────────────────────────────────────

function CurrentsSection({ data, compact }: { data: TodaySummary["sections"]["currents"]; compact?: boolean }) {
  const all = [
    ...data.channel_messages.map((m: any) => ({ ...m, _kind: "channel" })),
    ...data.dm_messages.map((m: any) => ({ ...m, _kind: "dm" })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5);

  if (all.length === 0) return <EmptyState text={data.empty_state} />;

  return (
    <div className="space-y-1.5" data-testid="currents-list">
      {all.map((m: any) => (
        <Link key={m.id} href={m._kind === "channel" ? `/currents/${m.channelSlug ?? ""}` : "/currents"}>
          <div className={`flex items-start gap-2 ${compact ? "py-1" : "py-1.5"} rounded hover:bg-muted/30 transition-colors cursor-pointer px-1`}>
            <div className="h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-[9px] font-semibold text-primary">{(m.userName ?? "?").charAt(0).toUpperCase()}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium">{m.userName}</span>
                {m._kind === "channel" && m.channelName && (
                  <Badge variant="outline" className="text-[9px] h-3.5 px-1">#{m.channelName}</Badge>
                )}
                {m._kind === "dm" && <Badge variant="outline" className="text-[9px] h-3.5 px-1">DM</Badge>}
                <span className="text-[9px] text-muted-foreground ml-auto shrink-0">{fmtDateShort(m.createdAt)}</span>
              </div>
              {!compact && <p className="text-xs text-muted-foreground truncate">{m.body}</p>}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

// ── Pipeline ───────────────────────────────────────────────────────────────────

function PipelineSection({ data, compact }: { data: TodaySummary["sections"]["pipeline"]; compact?: boolean }) {
  const { counts, hot_opportunities } = data;
  return (
    <div className="space-y-3" data-testid="pipeline-section-content">
      <div className="flex gap-2 flex-wrap">
        <MetricChip label="Stalled" value={counts.stalled} endpoint={data.drilldown_endpoint} metric="opportunities_stalled" colorClass={counts.stalled > 0 ? "text-orange-400" : "text-muted-foreground"} testId="chip-pipeline-stalled" compact={compact} />
        <MetricChip label="Quotes Sent" value={counts.quotes_awaiting} endpoint={data.drilldown_endpoint} metric="quotes_stale" colorClass={counts.quotes_awaiting > 0 ? "text-yellow-400" : "text-muted-foreground"} testId="chip-pipeline-quotes" compact={compact} />
        <MetricChip label="Hot Opps" value={counts.hot_opportunities} link={data.link} colorClass={counts.hot_opportunities > 0 ? "text-green-400" : "text-muted-foreground"} testId="chip-pipeline-hot" compact={compact} />
      </div>
      {hot_opportunities.length === 0 ? (
        <EmptyState text={data.empty_state} />
      ) : (
        <div className="space-y-1" data-testid="pipeline-opps-list">
          {hot_opportunities.map((o: any) => (
            <Link key={o.id} href="/opportunities">
              <div className={`flex items-center gap-2 ${compact ? "py-0.5" : "py-1"} rounded hover:bg-muted/30 transition-colors cursor-pointer px-1`}>
                <TrendingUp className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                <span className="text-sm flex-1 truncate">{o.title}</span>
                {o.accountName && <span className="text-[10px] text-muted-foreground shrink-0 truncate max-w-[80px]">{o.accountName}</span>}
                {o.amount != null && (
                  <span className="text-[11px] font-medium text-green-400 shrink-0">
                    {o.amount >= 1000 ? `$${Math.round(o.amount / 1000)}k` : `$${o.amount}`}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Marketing ──────────────────────────────────────────────────────────────────

function MarketingSection({ data, compact }: { data: TodaySummary["sections"]["marketing"]; compact?: boolean }) {
  const { counts } = data;
  return (
    <div className="space-y-3" data-testid="marketing-section-content">
      <div className="flex gap-2 flex-wrap">
        <MetricChip label="Active" value={counts.active} link={data.link} colorClass={counts.active > 0 ? "text-green-400" : "text-muted-foreground"} testId="chip-mkt-active" compact={compact} />
        <MetricChip label="Draft" value={counts.draft} link={data.link} colorClass="text-muted-foreground" testId="chip-mkt-draft" compact={compact} />
        <MetricChip label="Blocked" value={counts.blocked} endpoint={data.drilldown_endpoint} metric="campaigns_blocked" colorClass={counts.blocked > 0 ? "text-red-400" : "text-muted-foreground"} testId="chip-mkt-blocked" compact={compact} />
        <MetricChip label="Paused" value={counts.paused} link={data.link} colorClass="text-muted-foreground" testId="chip-mkt-paused" compact={compact} />
      </div>
      {counts.active === 0 && counts.draft === 0 && counts.blocked === 0 && <EmptyState text={data.empty_state} />}
    </div>
  );
}

// ── Operations ─────────────────────────────────────────────────────────────────

function OperationsSection({ data, compact }: { data: TodaySummary["sections"]["operations"]; compact?: boolean }) {
  const { counts } = data;
  const hasBlockers = counts.blocked_installs > 0 || counts.overdue_installs > 0 || counts.blocked_procurement > 0;
  return (
    <div className="space-y-3" data-testid="operations-section-content">
      <div className="flex gap-2 flex-wrap">
        <MetricChip label="Blocked Installs" value={counts.blocked_installs} endpoint={data.drilldown_endpoint} metric="blocked_installs" colorClass={counts.blocked_installs > 0 ? "text-red-400" : "text-muted-foreground"} testId="chip-ops-blocked" compact={compact} />
        <MetricChip label="Overdue Installs" value={counts.overdue_installs} endpoint={data.drilldown_endpoint} metric="installs_overdue" colorClass={counts.overdue_installs > 0 ? "text-orange-400" : "text-muted-foreground"} testId="chip-ops-overdue" compact={compact} />
        <MetricChip label="Procurement" value={counts.blocked_procurement} link={data.link} colorClass={counts.blocked_procurement > 0 ? "text-yellow-400" : "text-muted-foreground"} testId="chip-ops-procurement" compact={compact} />
      </div>
      {!hasBlockers && <EmptyState text={data.empty_state} />}
    </div>
  );
}

// ── Capital ────────────────────────────────────────────────────────────────────

function CapitalSection({ data, compact }: { data: NonNullable<TodaySummary["sections"]["capital"]>; compact?: boolean }) {
  const { investors, stats } = data;
  return (
    <div className="space-y-3" data-testid="capital-section-content">
      <div className="flex gap-2 flex-wrap">
        <MetricChip label="Active" value={stats.total_active} link={data.link} colorClass="text-foreground" testId="chip-cap-active" compact={compact} />
        <MetricChip label="Overdue Follow-ups" value={stats.overdue_follow_ups} link={data.link} colorClass={stats.overdue_follow_ups > 0 ? "text-red-400" : "text-muted-foreground"} testId="chip-cap-overdue" compact={compact} />
        <MetricChip label="Hot" value={stats.hot_count} link={data.link} colorClass={stats.hot_count > 0 ? "text-orange-400" : "text-muted-foreground"} testId="chip-cap-hot" compact={compact} />
      </div>
      {investors.length === 0 ? (
        <EmptyState text={data.empty_state} />
      ) : (
        <div className="space-y-1" data-testid="capital-investors-list">
          {investors.map((inv: any) => (
            <Link key={inv.id} href="/capital">
              <div className={`flex items-center gap-2 ${compact ? "py-1" : "py-1.5"} rounded hover:bg-muted/30 transition-colors cursor-pointer px-1`}>
                <Building2 className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                <span className="text-sm flex-1 truncate font-medium">{inv.name}</span>
                {inv.priority && <Badge variant="outline" className="text-[9px] h-3.5 px-1 shrink-0">{inv.priority}</Badge>}
                {inv.nextStepOverdue && (
                  <Badge className="text-[9px] h-3.5 px-1 bg-red-500/20 text-red-400 border-red-500/30 border shrink-0">overdue</Badge>
                )}
                {inv.daysSinceTouch != null && (
                  <span className="text-[10px] text-muted-foreground shrink-0">{inv.daysSinceTouch}d ago</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Favorites + Recents ────────────────────────────────────────────────────────

function FavoritesRecentsSection({ isCapitalUser, isAdmin, compact }: {
  isCapitalUser: boolean; isAdmin: boolean; compact?: boolean;
}) {
  const { favorites } = usePageFavorites(isCapitalUser, isAdmin);
  const { recents }   = useRecentPages(isCapitalUser, isAdmin);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-testid="favorites-recents-section">
      <SectionCard icon={Star} title="Favorites" testId="section-favorites">
        {favorites.length === 0 ? (
          <EmptyState text="No favorites yet. Star pages to pin them here." />
        ) : (
          <div className="space-y-1">
            {favorites.slice(0, 6).map((f) => (
              <Link key={f.url} href={f.url}>
                <div className={`flex items-center gap-2 ${compact ? "py-0.5" : "py-1"} rounded hover:bg-muted/30 transition-colors cursor-pointer px-1`}>
                  <Star className="h-3 w-3 text-yellow-400/70 shrink-0" />
                  <span className="text-sm truncate">{f.label}</span>
                  <ChevronRight className="h-3 w-3 text-muted-foreground/30 ml-auto shrink-0" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard icon={Clock} title="Recent Pages" testId="section-recents">
        {recents.length === 0 ? (
          <EmptyState text="No recent pages yet." />
        ) : (
          <div className="space-y-1">
            {recents.slice(0, 6).map((r) => (
              <Link key={`${r.url}-${r.visitedAt}`} href={r.url}>
                <div className={`flex items-center gap-2 ${compact ? "py-0.5" : "py-1"} rounded hover:bg-muted/30 transition-colors cursor-pointer px-1`}>
                  <Clock className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                  <span className="text-sm truncate flex-1">{r.label}</span>
                  <span className="text-[9px] text-muted-foreground/50 shrink-0">{fmtDateShort(r.visitedAt)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ── Loading skeleton ───────────────────────────────────────────────────────────

function CockpitSkeleton() {
  return (
    <div className="space-y-4" data-testid="today-loading">
      <Skeleton className="h-10 w-72" />
      <Skeleton className="h-32 w-full rounded-xl" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-44 rounded-xl" />)}
      </div>
    </div>
  );
}

// ── Section rendering helpers ──────────────────────────────────────────────────

type RenderGroup =
  | { kind: "single"; id: string }
  | { kind: "pair"; ids: [string, string] };

function buildRenderGroups(orderedIds: string[]): RenderGroup[] {
  const groups: RenderGroup[] = [];
  const consumed = new Set<string>();

  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i];
    if (consumed.has(id)) continue;

    const nextId = orderedIds[i + 1];
    const pair = nextId && KNOWN_PAIRS.find(([a, b]) =>
      (a === id && b === nextId) || (a === nextId && b === id)
    );

    if (pair && nextId && !consumed.has(nextId)) {
      groups.push({ kind: "pair", ids: [id, nextId] });
      consumed.add(id);
      consumed.add(nextId);
      i++;
    } else {
      groups.push({ kind: "single", id });
      consumed.add(id);
    }
  }

  return groups;
}

// ── CEO Cockpit helpers ────────────────────────────────────────────────────────

function fmtCockpitRefreshed(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

const TAB_SUBTITLES: Record<string, string> = {
  overview:     "Team pulse, blockers, commitments, and CEO attention",
  actions:      "Review, copy, and queue follow-up actions",
  briefing:     "Daily priorities, weekly review, and leadership agenda",
  execution:    "Drift detection, scorecard, and execution health",
  forecasting:  "Scenario planning, runway, and revenue intelligence",
  "1on1s":      "1:1 schedules, agenda prep, and commitment tracking",
  "board-pack": "Board and investor reporting pack",
};

const TAB_CONFIG = [
  { id: "overview",    label: "Overview",    icon: LayoutDashboard },
  { id: "actions",     label: "Actions",     icon: Zap             },
  { id: "briefing",    label: "Briefing",    icon: FileText        },
  { id: "execution",   label: "Execution",   icon: Activity        },
  { id: "forecasting", label: "Forecasting", icon: TrendingUp      },
  { id: "1on1s",       label: "1:1s",        icon: Users           },
  { id: "board-pack",  label: "Board Pack",  icon: BookOpen        },
] as const;

// ── Main export ────────────────────────────────────────────────────────────────

export default function TodayPage() {
  const [todayMode, setTodayMode] = useState<"my_day" | "ceo_cockpit">("my_day");
  const [cockpitTab, setCockpitTab] = useState<string>("overview");

  const summaryQuery = useQuery<TodaySummary>({ queryKey: ["/api/today/summary"] });
  const profileQuery = useQuery<UserProfile>({ queryKey: ["/api/users/me/profile"] });

  const profile   = profileQuery.data;
  const userId    = profile?.id as number | undefined;
  const isCapital = profile?.permissions?.capital === "edit";
  const role      = String(profile?.globalRole ?? "").toLowerCase();
  const isAdmin   = role === "admin" || role === "master_admin";

  const cockpitQuery = useQuery<CeoCockpitData>({
    queryKey: ["/api/today/ceo-cockpit"],
    enabled: isAdmin && todayMode === "ceo_cockpit",
    staleTime: 60_000,
  });

  const prefs = useTodayPrefs(userId);

  const now     = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: ["/api/today/summary"] });
  }

  if (summaryQuery.isError) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[40vh] gap-4" data-testid="today-error">
        <AlertTriangle className="h-8 w-8 text-amber-400" />
        <p className="text-sm text-muted-foreground">Failed to load today's summary.</p>
        <Button variant="outline" size="sm" onClick={() => summaryQuery.refetch()} className="gap-2" data-testid="today-retry-btn">
          <RefreshCw className="h-3.5 w-3.5" /> Try again
        </Button>
      </div>
    );
  }

  if (summaryQuery.isLoading) {
    return <div className="p-4 sm:p-6 w-full"><CockpitSkeleton /></div>;
  }

  const s           = summaryQuery.data!.sections;
  const generatedAt = summaryQuery.data!.generated_at;

  // ── Build effective section order ────────────────────────────────────────────

  const baseOrder = prefs.prefs.sectionOrder.length > 0
    ? prefs.prefs.sectionOrder
    : DEFAULT_ORDER;

  const visibleIds = baseOrder.filter(id => {
    const meta = SECTION_CONFIG.find(m => m.id === id);
    if (!meta) return false;
    if (meta.capitalOnly && !isCapital) return false;                  // Capital gate
    if (meta.alwaysVisible) return true;                               // priority_actions always on
    if (prefs.prefs.hiddenSections.includes(id)) return false;         // user hidden
    return true;
  });

  const renderGroups = buildRenderGroups(visibleIds);

  // ── Section renderer ─────────────────────────────────────────────────────────

  function renderSection(id: string) {
    const compact   = prefs.prefs.compact;
    const isPinned  = prefs.prefs.pinnedSections.includes(id);
    const canHide   = !SECTION_CONFIG.find(m => m.id === id)?.alwaysVisible;

    const sharedCardProps = {
      isPinned,
      onTogglePin: () => prefs.togglePin(id),
      onHide: canHide ? () => prefs.toggleSectionVisibility(id) : undefined,
      onRefresh: handleRefresh,
      isFetching: summaryQuery.isFetching,
    };

    switch (id) {
      case "priority_actions":
        return (
          <SectionCard
            key="priority_actions"
            icon={Zap}
            title="Priority Actions"
            count={s.priority_actions.count || undefined}
            testId="section-priority-actions"
            {...sharedCardProps}
          >
            <PriorityActionsSection
              items={s.priority_actions.items}
              emptyState={s.priority_actions.empty_state}
              sortBy={prefs.prefs.sortBy}
              onSortChange={v => prefs.setSortBy(v as any)}
              onSnooze={prefs.snoozeItem}
              onUnsnooze={prefs.unsnoozeItem}
              isSnoozed={prefs.isSnoozed}
              compact={compact}
            />
          </SectionCard>
        );

      case "schedule":
        return (
          <SectionCard
            key="schedule"
            icon={Calendar} title="Schedule"
            count={s.schedule.count || undefined}
            link={s.schedule.link}
            testId="section-schedule"
            {...sharedCardProps}
          >
            <ScheduleSection data={s.schedule} compact={compact} />
          </SectionCard>
        );

      case "tasks":
        return (
          <SectionCard
            key="tasks"
            icon={CheckSquare} title="Tasks"
            count={(s.tasks.counts.overdue + s.tasks.counts.due_today) || undefined}
            link={s.tasks.link}
            testId="section-tasks"
            {...sharedCardProps}
          >
            <TasksSection data={s.tasks} onRefreshToday={handleRefresh} compact={compact} />
          </SectionCard>
        );

      case "inbox":
        return (
          <SectionCard
            key="inbox"
            icon={Mail} title="Inbox"
            count={s.inbox.counts.unread_inbox || undefined}
            link={s.inbox.link}
            testId="section-inbox"
            {...sharedCardProps}
          >
            <InboxSection data={s.inbox} compact={compact} />
          </SectionCard>
        );

      case "currents":
        return (
          <SectionCard
            key="currents"
            icon={MessageSquare} title="CURRENTS"
            count={s.currents.count || undefined}
            link={s.currents.link}
            testId="section-currents"
            {...sharedCardProps}
          >
            <CurrentsSection data={s.currents} compact={compact} />
          </SectionCard>
        );

      case "pipeline":
        return (
          <SectionCard
            key="pipeline"
            icon={TrendingUp} title="Pipeline"
            count={(s.pipeline.counts.stalled + s.pipeline.counts.quotes_awaiting) || undefined}
            link={s.pipeline.link}
            testId="section-pipeline"
            {...sharedCardProps}
          >
            <PipelineSection data={s.pipeline} compact={compact} />
          </SectionCard>
        );

      case "marketing":
        return (
          <SectionCard
            key="marketing"
            icon={Megaphone} title="Marketing"
            count={s.marketing.counts.blocked || undefined}
            link={s.marketing.link}
            testId="section-marketing"
            {...sharedCardProps}
          >
            <MarketingSection data={s.marketing} compact={compact} />
          </SectionCard>
        );

      case "operations":
        return (
          <SectionCard
            key="operations"
            icon={Settings} title="Operations"
            count={(s.operations.counts.blocked_installs + s.operations.counts.overdue_installs) || undefined}
            link={s.operations.link}
            testId="section-operations"
            {...sharedCardProps}
          >
            <OperationsSection data={s.operations} compact={compact} />
          </SectionCard>
        );

      case "capital":
        if (!isCapital || !s.capital) return null;
        return (
          <SectionCard
            key="capital"
            icon={Building2} title="Capital & Fundraising"
            count={s.capital.stats.overdue_follow_ups || undefined}
            link={s.capital.link}
            testId="section-capital"
            {...sharedCardProps}
          >
            <CapitalSection data={s.capital} compact={compact} />
          </SectionCard>
        );

      case "favorites_recents":
        return (
          <div key="favorites_recents" data-testid="section-favorites-recents">
            <FavoritesRecentsSection isCapitalUser={isCapital} isAdmin={isAdmin} compact={compact} />
          </div>
        );

      default:
        return null;
    }
  }

  return (
    <div
      className={`p-4 sm:p-6 space-y-4 w-full max-w-[1400px] ${prefs.prefs.compact ? "space-y-3" : "space-y-4"}`}
      data-testid="today-page"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold tracking-tight" data-testid="today-page-title">Today</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{dateStr}</p>
          {generatedAt && (
            <p className="text-[10px] text-muted-foreground/50 mt-0.5" data-testid="today-generated-at">
              Updated {fmtTime(generatedAt)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap" data-testid="today-header-actions">
          <Button
            variant="outline" size="sm"
            onClick={handleRefresh}
            disabled={summaryQuery.isFetching}
            className="gap-1.5 text-xs h-8"
            data-testid="today-refresh-btn"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${summaryQuery.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          {userId && (
            <CustomizeTodaySheet
              prefs={prefs.prefs}
              toggleVisibility={prefs.toggleSectionVisibility}
              setSectionOrder={prefs.setSectionOrder}
              togglePin={prefs.togglePin}
              setCompact={prefs.setCompact}
              isCapital={isCapital}
              resetPrefs={prefs.resetPrefs}
            />
          )}
        </div>
      </div>

      {/* Mode toggle — admin only */}
      {isAdmin && (
        <div className="flex items-center gap-1 bg-muted/30 rounded-lg p-0.5 w-fit" data-testid="today-mode-toggle">
          <button
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${todayMode === "my_day" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setTodayMode("my_day")}
            data-testid="today-mode-my-day"
          >
            My Day
          </button>
          <button
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${todayMode === "ceo_cockpit" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setTodayMode("ceo_cockpit")}
            data-testid="today-mode-ceo-cockpit"
          >
            CEO Cockpit
          </button>
        </div>
      )}

      {/* CEO Cockpit mode */}
      {todayMode === "ceo_cockpit" && isAdmin && (
        <div className="space-y-3" data-testid="ceo-cockpit-view">

          {/* ── Cockpit header ── */}
          <div className="flex items-start justify-between gap-3" data-testid="ceo-cockpit-header">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground leading-tight" data-testid="ceo-cockpit-title">CEO Cockpit</h2>
              <p className="text-xs text-muted-foreground mt-0.5 truncate" data-testid="ceo-cockpit-subtitle">
                {TAB_SUBTITLES[cockpitTab] ?? "Executive operating view"}
              </p>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {cockpitQuery.data?.generated_at && (
                <span className="text-[10px] text-muted-foreground/60 hidden md:block" data-testid="ceo-cockpit-last-refreshed">
                  Updated {fmtCockpitRefreshed(cockpitQuery.data.generated_at)}
                </span>
              )}
              <Button
                size="sm" variant="ghost"
                className="h-7 gap-1 text-xs px-2"
                onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/today/ceo-cockpit"] })}
                disabled={cockpitQuery.isFetching}
                data-testid="ceo-cockpit-refresh-btn"
              >
                <RefreshCw className={`h-3 w-3 ${cockpitQuery.isFetching ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Badge variant="secondary" className="text-[10px] hidden sm:flex items-center gap-1 h-5 px-1.5" data-testid="ceo-cockpit-admin-badge">
                <Shield className="h-2.5 w-2.5" />
                CEO&nbsp;/&nbsp;Admin
              </Badge>
            </div>
          </div>

          {/* ── Tab navigation ── */}
          <div className="flex gap-1 overflow-x-auto border-b border-border pb-2 [&::-webkit-scrollbar]:hidden" data-testid="ceo-cockpit-tabs">
            {TAB_CONFIG.map(tab => {
              const Icon = tab.icon;
              const oneOnOneBadge = tab.id === "1on1s" && cockpitQuery.data
                ? (cockpitQuery.data.sections.one_on_ones.items.length ?? 0) : 0;
              return (
                <button
                  key={tab.id}
                  data-testid={`ceo-cockpit-tab-${tab.id}`}
                  onClick={() => setCockpitTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap flex-shrink-0 ${
                    cockpitTab === tab.id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                  {oneOnOneBadge > 0 && (
                    <span
                      className={`text-[9px] font-medium px-1 rounded-full leading-none ${
                        cockpitTab === tab.id
                          ? "bg-primary-foreground/20 text-primary-foreground"
                          : "bg-muted-foreground/20 text-muted-foreground"
                      }`}
                      data-testid="ceo-cockpit-tab-badge-1on1s"
                    >
                      {oneOnOneBadge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* ── Overview tab: core cockpit sections ── */}
          {cockpitTab === "overview" && (
            <div className="space-y-3" data-testid="ceo-cockpit-overview">
              {cockpitQuery.isLoading && (
                <div className="py-10 flex items-center justify-center" data-testid="ceo-cockpit-loading">
                  <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
              {cockpitQuery.isError && (
                <div className="py-6 flex flex-col items-center gap-2" data-testid="ceo-cockpit-error">
                  <AlertTriangle className="h-5 w-5 text-amber-400" />
                  <p className="text-xs text-muted-foreground">Failed to load CEO Cockpit data.</p>
                </div>
              )}
              {cockpitQuery.data && (() => {
                const cs = cockpitQuery.data!.sections;
                const urgentCount = (cs.blockers.count ?? 0) + (cs.ceo_attention.count ?? 0) + (cs.commitments.overdue ?? 0);
                return (
                  <>
                    {urgentCount > 0 && (
                      <div
                        className="rounded-lg border border-orange-500/20 bg-orange-500/5 px-3 py-2.5 flex items-center gap-2.5"
                        data-testid="ceo-priority-summary"
                      >
                        <Zap className="h-3.5 w-3.5 text-orange-400 flex-shrink-0" />
                        <div className="flex items-center gap-3 flex-wrap text-xs flex-1 min-w-0">
                          {(cs.blockers.count ?? 0) > 0 && (
                            <span className="text-red-400 font-medium">
                              {cs.blockers.count} blocker{cs.blockers.count !== 1 ? "s" : ""}
                            </span>
                          )}
                          {(cs.ceo_attention.count ?? 0) > 0 && (
                            <span className="text-amber-400 font-medium">
                              {cs.ceo_attention.count} need{cs.ceo_attention.count === 1 ? "s" : ""} CEO attention
                            </span>
                          )}
                          {(cs.commitments.overdue ?? 0) > 0 && (
                            <span className="text-orange-400 font-medium">
                              {cs.commitments.overdue} overdue commitment{cs.commitments.overdue !== 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground/60 hidden sm:block flex-shrink-0">Review below ↓</span>
                      </div>
                    )}
                    <SectionCard
                      icon={({ className }: any) => <span className={className}>👥</span>}
                      title="Team Pulse"
                      count={cs.team_pulse.source_counts.total || undefined}
                      testId="section-team-pulse"
                      isFetching={cockpitQuery.isFetching}
                      onRefresh={() => queryClient.invalidateQueries({ queryKey: ["/api/today/ceo-cockpit"] })}
                    >
                      <TeamPulseSection data={cs.team_pulse} />
                    </SectionCard>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <SectionCard
                        icon={AlertTriangle}
                        title="Blockers"
                        count={cs.blockers.count || undefined}
                        testId="section-blockers"
                        isFetching={cockpitQuery.isFetching}
                        onRefresh={() => queryClient.invalidateQueries({ queryKey: ["/api/today/ceo-cockpit"] })}
                      >
                        <BlockersSection data={cs.blockers} />
                      </SectionCard>
                      <SectionCard
                        icon={Zap}
                        title="CEO Attention"
                        count={cs.ceo_attention.count || undefined}
                        testId="section-ceo-attention"
                        isFetching={cockpitQuery.isFetching}
                        onRefresh={() => queryClient.invalidateQueries({ queryKey: ["/api/today/ceo-cockpit"] })}
                      >
                        <CeoAttentionSection data={cs.ceo_attention} />
                      </SectionCard>
                    </div>

                    <SectionCard
                      icon={Clock}
                      title="Silence Watch"
                      count={cs.silence_watch.count || undefined}
                      testId="section-silence-watch"
                      isFetching={cockpitQuery.isFetching}
                      onRefresh={() => queryClient.invalidateQueries({ queryKey: ["/api/today/ceo-cockpit"] })}
                    >
                      <SilenceWatchSection data={cs.silence_watch} />
                    </SectionCard>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <SectionCard
                        icon={CheckSquare}
                        title="Commitments"
                        count={cs.commitments.count || undefined}
                        testId="section-commitments"
                        isFetching={cockpitQuery.isFetching}
                        onRefresh={() => queryClient.invalidateQueries({ queryKey: ["/api/today/ceo-cockpit"] })}
                      >
                        <CommitmentsSection data={cs.commitments} />
                      </SectionCard>
                      <SectionCard
                        icon={MessageSquare}
                        title="Communication Hotspots"
                        testId="section-communication-hotspots"
                        isFetching={cockpitQuery.isFetching}
                        onRefresh={() => queryClient.invalidateQueries({ queryKey: ["/api/today/ceo-cockpit"] })}
                      >
                        <CommunicationHotspotsSection data={cs.communication_hotspots} />
                      </SectionCard>
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* ── Actions tab ── */}
          {cockpitTab === "actions" && (
            <div data-testid="ceo-cockpit-actions-tab">
              <CeoActionQueuePanel />
            </div>
          )}

          {/* ── Briefing tab ── */}
          {cockpitTab === "briefing" && (
            <div data-testid="ceo-cockpit-briefing-tab">
              <CeoBriefingPanel />
            </div>
          )}

          {/* ── Execution tab ── */}
          {cockpitTab === "execution" && (
            <div data-testid="ceo-cockpit-execution-tab">
              <CeoExecutionRadarPanel />
            </div>
          )}

          {/* ── Forecasting tab ── */}
          {cockpitTab === "forecasting" && (
            <div data-testid="ceo-cockpit-forecasting-tab">
              <CeoForecastingPanel />
            </div>
          )}

          {/* ── 1:1s tab ── */}
          {cockpitTab === "1on1s" && (
            <div data-testid="ceo-cockpit-1on1s-tab">
              {cockpitQuery.isLoading && (
                <div className="py-10 flex items-center justify-center">
                  <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
              {cockpitQuery.isError && (
                <div className="py-6 flex flex-col items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-400" />
                  <p className="text-xs text-muted-foreground">Failed to load 1:1 data.</p>
                </div>
              )}
              {cockpitQuery.data && (
                <SectionCard
                  icon={Calendar}
                  title="1:1 Operating System"
                  count={cockpitQuery.data.sections.one_on_ones.items.length || undefined}
                  testId="section-one-on-ones"
                  isFetching={cockpitQuery.isFetching}
                  onRefresh={() => queryClient.invalidateQueries({ queryKey: ["/api/today/ceo-cockpit"] })}
                >
                  <OneOnOnesSection data={cockpitQuery.data.sections.one_on_ones} />
                </SectionCard>
              )}
            </div>
          )}

          {/* ── Board Pack tab ── */}
          {cockpitTab === "board-pack" && (
            <div className="space-y-3" data-testid="ceo-cockpit-board-pack-tab">
              <div className="rounded-lg border border-border bg-card p-5 flex flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <BookOpen className="h-4 w-4 text-primary" />
                      <p className="text-sm font-semibold text-foreground">Board &amp; Investor Pack</p>
                    </div>
                    <p className="text-xs text-muted-foreground">Generate, review, and distribute board reporting packages. CEO and CFO access only.</p>
                  </div>
                  <Link href="/board-pack">
                    <Button size="sm" variant="outline" className="gap-1.5 text-xs flex-shrink-0" data-testid="ceo-cockpit-board-pack-link">
                      Open <ArrowUpRight className="h-3 w-3" />
                    </Button>
                  </Link>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 border-t border-border pt-3">
                  {[
                    { icon: BarChart2, label: "Pack Generation", desc: "AI-assembled reports from live CRM and revenue data" },
                    { icon: Clock,     label: "Historical Comparisons", desc: "QoQ and YoY snapshots against prior board packs" },
                    { icon: Star,      label: "Investor Updates", desc: "Lightweight investor-ready summaries from the same data" },
                  ].map(({ icon: Icon, label, desc }) => (
                    <div key={label} className="rounded-md border border-border/50 bg-muted/20 p-2.5 space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <Icon className="h-3 w-3 text-primary/70" />
                        <p className="text-[11px] font-medium text-foreground">{label}</p>
                      </div>
                      <p className="text-[10px] text-muted-foreground">{desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

        </div>
      )}

      {/* My Day mode — sections in user-defined order */}
      {todayMode === "my_day" && renderGroups.map((group, gi) => {
        if (group.kind === "pair") {
          const [idA, idB] = group.ids;
          const nodeA = renderSection(idA);
          const nodeB = renderSection(idB);
          if (!nodeA && !nodeB) return null;
          if (!nodeA) return <div key={gi}>{nodeB}</div>;
          if (!nodeB) return <div key={gi}>{nodeA}</div>;
          return (
            <div key={gi} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {nodeA}
              {nodeB}
            </div>
          );
        }
        const node = renderSection(group.id);
        return node ? <div key={gi}>{node}</div> : null;
      })}
    </div>
  );
}
