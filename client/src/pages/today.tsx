// today.tsx — Executive Operating Cockpit
// Replaces the old widget-grid with a structured cockpit showing the user's
// most important work, risks, messages, meetings, and opportunities for today.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle, RefreshCw, Calendar, CheckSquare, Mail,
  MessageSquare, TrendingUp, Megaphone, Settings, Star,
  Clock, ChevronRight, ArrowUpRight, Zap, Building2,
  CheckCircle2, Circle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { queryClient } from "@/lib/queryClient";
import {
  UniversalDrilldownSheet,
  type UniversalDrilldownConfig,
} from "@/components/shared/universal-drilldown-sheet";
import { usePageFavorites } from "@/hooks/use-page-favorites";
import { useRecentPages } from "@/hooks/use-recent-pages";
import { type UserProfile } from "@/lib/dashboard-config";

// ── Types ──────────────────────────────────────────────────────────────────────

type ActionSeverity = "critical" | "high" | "medium" | "low";

type PriorityAction = {
  id: string; type: string; title: string; description: string;
  severity: ActionSeverity; link: string; source: string;
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
  label, value, endpoint, metric, link, colorClass = "text-foreground", testId,
}: {
  label: string; value: number | string; endpoint?: string; metric?: string;
  link?: string; colorClass?: string; testId?: string;
}) {
  const [drilldown, setDrilldown] = useState<UniversalDrilldownConfig | null>(null);
  const canDrill = !!(endpoint && metric);

  const chip = (
    <button
      type="button"
      onClick={canDrill ? () => setDrilldown({ metric: metric!, title: label }) : undefined}
      data-testid={testId}
      className={`flex flex-col items-center px-3 py-2 rounded-lg border border-border/40 bg-muted/20 transition-colors min-w-[64px] ${canDrill || link ? "cursor-pointer hover:bg-muted/50 hover:border-border" : "cursor-default"}`}
    >
      <span className={`text-xl font-bold tabular-nums leading-none ${colorClass}`}>{value}</span>
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
}: {
  icon: React.ElementType; title: string; count?: number; link?: string;
  linkLabel?: string; children: React.ReactNode; testId?: string;
}) {
  return (
    <Card className="border-border/50 bg-card/60" data-testid={testId}>
      <CardHeader className="pb-3 pt-4 px-4">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Icon className="h-4 w-4 text-muted-foreground" />
            {title}
            {count !== undefined && count > 0 && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{count}</Badge>
            )}
          </CardTitle>
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
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">{children}</CardContent>
    </Card>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground/70 py-2 italic">{text}</p>;
}

// ── Priority Actions ───────────────────────────────────────────────────────────

const TYPE_ICONS: Record<string, React.ElementType> = {
  meeting: Calendar, tasks: CheckSquare, operations: Settings,
  marketing: Megaphone, capital: Building2, pipeline: TrendingUp,
  support: AlertTriangle,
};

function PriorityActionsSection({ items, emptyState }: { items: PriorityAction[]; emptyState: string }) {
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 py-2">
        <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
        <p className="text-sm text-muted-foreground">{emptyState}</p>
      </div>
    );
  }
  return (
    <div className="space-y-1" data-testid="priority-actions-list">
      {items.map((action) => {
        const Icon = TYPE_ICONS[action.type] ?? Circle;
        return (
          <Link key={action.id} href={action.link}>
            <div
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer group"
              data-testid={`priority-action-${action.id}`}
            >
              <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{action.title}</p>
                {action.description && (
                  <p className="text-xs text-muted-foreground truncate">{action.description}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline" className="text-[9px] h-4 px-1.5 text-muted-foreground/70">{action.source}</Badge>
                <SeverityBadge severity={action.severity} />
                <ArrowUpRight className="h-3 w-3 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

// ── Schedule ───────────────────────────────────────────────────────────────────

function ScheduleSection({ data }: { data: TodaySummary["sections"]["schedule"] }) {
  if (data.items.length === 0) return <EmptyState text={data.empty_state} />;
  return (
    <div className="space-y-1.5" data-testid="schedule-list">
      {data.items.map((m: any) => (
        <div key={m.id} className="flex items-start gap-2.5 py-1.5">
          <div className="flex flex-col items-center shrink-0 pt-0.5">
            <span className="text-[11px] font-semibold text-primary">{fmtTime(m.startTime)}</span>
            {m.endTime && <span className="text-[9px] text-muted-foreground/60">{fmtTime(m.endTime)}</span>}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{m.title}</p>
            {m.location && <p className="text-[11px] text-muted-foreground truncate">{m.location}</p>}
          </div>
          {m.meetingUrl && (
            <a href={m.meetingUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] gap-1 text-muted-foreground">
                Join <ArrowUpRight className="h-2.5 w-2.5" />
              </Button>
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Tasks ──────────────────────────────────────────────────────────────────────

function TasksSection({ data }: { data: TodaySummary["sections"]["tasks"] }) {
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
          testId="chip-tasks-due-today"
        />
        <MetricChip
          label="Overdue" value={counts.overdue}
          endpoint={data.drilldown_endpoint} metric="tasks_overdue"
          colorClass={counts.overdue > 0 ? "text-red-400" : "text-muted-foreground"}
          testId="chip-tasks-overdue"
        />
        <MetricChip
          label="High Priority" value={counts.high_priority}
          endpoint={data.drilldown_endpoint} metric="tasks_high_priority"
          colorClass={counts.high_priority > 0 ? "text-orange-400" : "text-muted-foreground"}
          testId="chip-tasks-high-priority"
        />
        <MetricChip
          label="Done Today" value={counts.completed_today}
          link={data.link}
          colorClass={counts.completed_today > 0 ? "text-green-400" : "text-muted-foreground"}
          testId="chip-tasks-done-today"
        />
      </div>
      {allTasks.length === 0 ? (
        <EmptyState text={data.empty_state} />
      ) : (
        <div className="space-y-1" data-testid="tasks-list">
          {allTasks.slice(0, 5).map((t: any) => (
            <div key={t.id} className="flex items-center gap-2 py-1">
              <Circle className="h-3 w-3 text-muted-foreground/50 shrink-0" />
              <span className="text-sm flex-1 truncate">{t.title}</span>
              {t._isOverdue ? (
                <Badge className="text-[9px] h-3.5 px-1 bg-red-500/20 text-red-400 border-red-500/30 border">overdue</Badge>
              ) : t.dueDate ? (
                <span className="text-[10px] text-muted-foreground shrink-0">{fmtDateShort(t.dueDate)}</span>
              ) : null}
            </div>
          ))}
        </div>
      )}
      <UniversalDrilldownSheet config={drilldown} onClose={() => setDrilldown(null)} endpoint={data.drilldown_endpoint} />
    </div>
  );
}

// ── Inbox ──────────────────────────────────────────────────────────────────────

function InboxSection({ data }: { data: TodaySummary["sections"]["inbox"] }) {
  const { counts } = data;
  return (
    <div className="space-y-3" data-testid="inbox-section-content">
      <div className="flex gap-2 flex-wrap">
        <MetricChip label="Unread Inbox" value={counts.unread_inbox} link={data.link} colorClass={counts.unread_inbox > 0 ? "text-primary" : "text-muted-foreground"} testId="chip-inbox-unread" />
        <MetricChip label="Unread Total" value={counts.unread_total} link={data.link} colorClass={counts.unread_total > 0 ? "text-foreground" : "text-muted-foreground"} testId="chip-inbox-unread-total" />
        <MetricChip label="New Inbound" value={counts.recent_unread_inbound} link={data.link} colorClass={counts.recent_unread_inbound > 0 ? "text-cyan-400" : "text-muted-foreground"} testId="chip-inbox-inbound" />
      </div>
      {counts.unread_inbox === 0 && counts.unread_total === 0 && <EmptyState text={data.empty_state} />}
    </div>
  );
}

// ── CURRENTS ───────────────────────────────────────────────────────────────────

function CurrentsSection({ data }: { data: TodaySummary["sections"]["currents"] }) {
  const all = [
    ...data.channel_messages.map((m: any) => ({ ...m, _kind: "channel" })),
    ...data.dm_messages.map((m: any) => ({ ...m, _kind: "dm" })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5);

  if (all.length === 0) return <EmptyState text={data.empty_state} />;

  return (
    <div className="space-y-1.5" data-testid="currents-list">
      {all.map((m: any) => (
        <Link key={m.id} href={m._kind === "channel" ? `/currents/${m.channelSlug ?? ""}` : "/currents"}>
          <div className="flex items-start gap-2 py-1.5 rounded hover:bg-muted/30 transition-colors cursor-pointer px-1">
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
              <p className="text-xs text-muted-foreground truncate">{m.body}</p>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

// ── Pipeline ───────────────────────────────────────────────────────────────────

function PipelineSection({ data }: { data: TodaySummary["sections"]["pipeline"] }) {
  const { counts, hot_opportunities } = data;
  return (
    <div className="space-y-3" data-testid="pipeline-section-content">
      <div className="flex gap-2 flex-wrap">
        <MetricChip label="Stalled" value={counts.stalled} endpoint={data.drilldown_endpoint} metric="opportunities_stalled" colorClass={counts.stalled > 0 ? "text-orange-400" : "text-muted-foreground"} testId="chip-pipeline-stalled" />
        <MetricChip label="Quotes Sent" value={counts.quotes_awaiting} endpoint={data.drilldown_endpoint} metric="quotes_stale" colorClass={counts.quotes_awaiting > 0 ? "text-yellow-400" : "text-muted-foreground"} testId="chip-pipeline-quotes" />
        <MetricChip label="Hot Opps" value={counts.hot_opportunities} link={data.link} colorClass={counts.hot_opportunities > 0 ? "text-green-400" : "text-muted-foreground"} testId="chip-pipeline-hot" />
      </div>
      {hot_opportunities.length === 0 ? (
        <EmptyState text={data.empty_state} />
      ) : (
        <div className="space-y-1" data-testid="pipeline-opps-list">
          {hot_opportunities.map((o: any) => (
            <Link key={o.id} href="/opportunities">
              <div className="flex items-center gap-2 py-1 rounded hover:bg-muted/30 transition-colors cursor-pointer px-1">
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

function MarketingSection({ data }: { data: TodaySummary["sections"]["marketing"] }) {
  const { counts } = data;
  return (
    <div className="space-y-3" data-testid="marketing-section-content">
      <div className="flex gap-2 flex-wrap">
        <MetricChip label="Active" value={counts.active} link={data.link} colorClass={counts.active > 0 ? "text-green-400" : "text-muted-foreground"} testId="chip-mkt-active" />
        <MetricChip label="Draft" value={counts.draft} link={data.link} colorClass="text-muted-foreground" testId="chip-mkt-draft" />
        <MetricChip label="Blocked" value={counts.blocked} endpoint={data.drilldown_endpoint} metric="campaigns_blocked" colorClass={counts.blocked > 0 ? "text-red-400" : "text-muted-foreground"} testId="chip-mkt-blocked" />
        <MetricChip label="Paused" value={counts.paused} link={data.link} colorClass="text-muted-foreground" testId="chip-mkt-paused" />
      </div>
      {counts.active === 0 && counts.draft === 0 && counts.blocked === 0 && <EmptyState text={data.empty_state} />}
    </div>
  );
}

// ── Operations ─────────────────────────────────────────────────────────────────

function OperationsSection({ data }: { data: TodaySummary["sections"]["operations"] }) {
  const { counts } = data;
  const hasBlockers = counts.blocked_installs > 0 || counts.overdue_installs > 0 || counts.blocked_procurement > 0;
  return (
    <div className="space-y-3" data-testid="operations-section-content">
      <div className="flex gap-2 flex-wrap">
        <MetricChip label="Blocked Installs" value={counts.blocked_installs} endpoint={data.drilldown_endpoint} metric="blocked_installs" colorClass={counts.blocked_installs > 0 ? "text-red-400" : "text-muted-foreground"} testId="chip-ops-blocked" />
        <MetricChip label="Overdue Installs" value={counts.overdue_installs} endpoint={data.drilldown_endpoint} metric="installs_overdue" colorClass={counts.overdue_installs > 0 ? "text-orange-400" : "text-muted-foreground"} testId="chip-ops-overdue" />
        <MetricChip label="Procurement" value={counts.blocked_procurement} link={data.link} colorClass={counts.blocked_procurement > 0 ? "text-yellow-400" : "text-muted-foreground"} testId="chip-ops-procurement" />
      </div>
      {!hasBlockers && <EmptyState text={data.empty_state} />}
    </div>
  );
}

// ── Capital ────────────────────────────────────────────────────────────────────

function CapitalSection({ data }: { data: NonNullable<TodaySummary["sections"]["capital"]> }) {
  const { investors, stats } = data;
  return (
    <div className="space-y-3" data-testid="capital-section-content">
      <div className="flex gap-2 flex-wrap">
        <MetricChip label="Active" value={stats.total_active} link={data.link} colorClass="text-foreground" testId="chip-cap-active" />
        <MetricChip label="Overdue Follow-ups" value={stats.overdue_follow_ups} link={data.link} colorClass={stats.overdue_follow_ups > 0 ? "text-red-400" : "text-muted-foreground"} testId="chip-cap-overdue" />
        <MetricChip label="Hot" value={stats.hot_count} link={data.link} colorClass={stats.hot_count > 0 ? "text-orange-400" : "text-muted-foreground"} testId="chip-cap-hot" />
      </div>
      {investors.length === 0 ? (
        <EmptyState text={data.empty_state} />
      ) : (
        <div className="space-y-1" data-testid="capital-investors-list">
          {investors.map((inv: any) => (
            <Link key={inv.id} href="/capital">
              <div className="flex items-center gap-2 py-1.5 rounded hover:bg-muted/30 transition-colors cursor-pointer px-1">
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

function FavoritesRecentsSection({ isCapitalUser, isAdmin }: { isCapitalUser: boolean; isAdmin: boolean }) {
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
                <div className="flex items-center gap-2 py-1 rounded hover:bg-muted/30 transition-colors cursor-pointer px-1">
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
                <div className="flex items-center gap-2 py-1 rounded hover:bg-muted/30 transition-colors cursor-pointer px-1">
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

// ── Main export ────────────────────────────────────────────────────────────────

export default function TodayPage() {
  const summaryQuery = useQuery<TodaySummary>({ queryKey: ["/api/today/summary"] });
  const profileQuery = useQuery<UserProfile>({ queryKey: ["/api/users/me/profile"] });

  const profile   = profileQuery.data;
  const isCapital = profile?.permissions?.capital === "edit";
  const role      = String(profile?.globalRole ?? "").toLowerCase();
  const isAdmin   = role === "admin" || role === "master_admin";

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

  return (
    <div className="p-4 sm:p-6 space-y-4 w-full max-w-[1400px]" data-testid="today-page">

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
      </div>

      {/* Priority Actions — full width */}
      <SectionCard
        icon={Zap}
        title="Priority Actions"
        count={s.priority_actions.count || undefined}
        testId="section-priority-actions"
      >
        <PriorityActionsSection items={s.priority_actions.items} emptyState={s.priority_actions.empty_state} />
      </SectionCard>

      {/* Schedule + Tasks */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard
          icon={Calendar} title="Schedule"
          count={s.schedule.count || undefined}
          link={s.schedule.link}
          testId="section-schedule"
        >
          <ScheduleSection data={s.schedule} />
        </SectionCard>
        <SectionCard
          icon={CheckSquare} title="Tasks"
          count={(s.tasks.counts.overdue + s.tasks.counts.due_today) || undefined}
          link={s.tasks.link}
          testId="section-tasks"
        >
          <TasksSection data={s.tasks} />
        </SectionCard>
      </div>

      {/* Inbox + CURRENTS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard
          icon={Mail} title="Inbox"
          count={s.inbox.counts.unread_inbox || undefined}
          link={s.inbox.link}
          testId="section-inbox"
        >
          <InboxSection data={s.inbox} />
        </SectionCard>
        <SectionCard
          icon={MessageSquare} title="CURRENTS"
          count={s.currents.count || undefined}
          link={s.currents.link}
          testId="section-currents"
        >
          <CurrentsSection data={s.currents} />
        </SectionCard>
      </div>

      {/* Pipeline + Marketing */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard
          icon={TrendingUp} title="Pipeline"
          count={(s.pipeline.counts.stalled + s.pipeline.counts.quotes_awaiting) || undefined}
          link={s.pipeline.link}
          testId="section-pipeline"
        >
          <PipelineSection data={s.pipeline} />
        </SectionCard>
        <SectionCard
          icon={Megaphone} title="Marketing"
          count={s.marketing.counts.blocked || undefined}
          link={s.marketing.link}
          testId="section-marketing"
        >
          <MarketingSection data={s.marketing} />
        </SectionCard>
      </div>

      {/* Operations — full width */}
      <SectionCard
        icon={Settings} title="Operations"
        count={(s.operations.counts.blocked_installs + s.operations.counts.overdue_installs) || undefined}
        link={s.operations.link}
        testId="section-operations"
      >
        <OperationsSection data={s.operations} />
      </SectionCard>

      {/* Capital — only for Capital users */}
      {isCapital && s.capital && (
        <SectionCard
          icon={Building2} title="Capital & Fundraising"
          count={s.capital.stats.overdue_follow_ups || undefined}
          link={s.capital.link}
          testId="section-capital"
        >
          <CapitalSection data={s.capital} />
        </SectionCard>
      )}

      {/* Favorites + Recents */}
      <FavoritesRecentsSection isCapitalUser={isCapital} isAdmin={isAdmin} />

    </div>
  );
}
