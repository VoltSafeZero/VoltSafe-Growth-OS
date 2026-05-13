// Today page widgets. Each widget fetches `/api/dashboard/today` via the same
// react-query key so React Query dedupes — no Provider needed and the widgets
// remain self-contained (movable to other pages later if we want).
//
// Naming convention: every Today widget id starts with `today_` so it cannot
// collide with the existing Command Center widget catalog when stored in the
// flat `widgetVisibility` map on the user profile.

import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ActionWidgetShell } from "@/components/command-centers/action-widgets";
import { TeamWinsTickerWidget } from "@/components/today/TeamWinsTicker";
import {
  CalendarDays, Clock, CheckSquare, AlertTriangle, TrendingUp,
  UserPlus, Zap, Video, MapPin, ArrowRight, Building2,
  Mail, Flame, Sun, Users, ShieldAlert, BarChart3, FolderOpen,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import type { WidgetDef } from "@/lib/dashboard-config";

// ── Shared data hook ─────────────────────────────────────────────────────────

export type TodayData = {
  todaysMeetings: Array<{
    id: number; title: string; startTime: string; endTime?: string;
    eventType: string; location?: string; meetingUrl?: string;
    status: string; invitees?: string[];
  }>;
  tasksDueToday: Array<{ id: number; title: string; dueDate?: string; priority: string; accountId?: number }>;
  overdueTasks: Array<{ id: number; title: string; dueDate?: string; priority: string }>;
  newLeads: Array<{ id: number; company: string; contactName?: string; status: string; city?: string; state?: string; country: string; dealAmount?: number }>;
  hotOpportunities: Array<{ id: number; title: string; stage: string; amount?: number; accountName: string; updatedAt: string }>;
  recentActivity: Array<{ id: number; subject?: string; fromEmail?: string; sentAt?: string; direction?: string; snippet?: string }>;
  suggestedActions: Array<{ type: string; text: string; link: string; priority: "high" | "medium" | "low" }>;
  stats: { meetingsToday: number; tasksDueCount: number; overdueCount: number; newLeadsCount: number };
  teamWorkload: Array<{ id: number; name: string; open_tasks: number; overdue: number; completed_week: number }>;
  teamBlockers: Array<{ id: number; title: string; dueDate?: string; priority: string; ownerName: string; daysOverdue: number }>;
  pipelineFunnel: Array<{ stage: string; count: number; value: number }>;
  pipelineFunnelMeta: { stalledDealCount: number };
  activeProjects: Array<{ id: number; name: string; status: string; phase?: string; ownerName?: string; accountName?: string; milestones_done: number; milestones_total: number; endDate?: string }>;
};

export function useTodayData() {
  return useQuery<TodayData>({
    queryKey: ["/api/dashboard/today"],
    refetchInterval: 5 * 60 * 1000,
    staleTime: 2 * 60 * 1000,
  });
}

// ── Display helpers ──────────────────────────────────────────────────────────

const STAGE_LABEL: Record<string, string> = {
  inbound_new: "New", qualifying: "Qualifying", proposal: "Proposal",
  negotiation: "Negotiating", verbal_commit: "Verbal", closed_won: "Won",
};
const STAGE_ORDER = ["inbound_new", "qualifying", "proposal", "negotiation", "verbal_commit"];
const STAGE_COLOR: Record<string, string> = {
  verbal_commit: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  proposal: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  negotiation: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  qualifying: "bg-purple-500/15 text-purple-400 border-purple-500/25",
  inbound_new: "bg-secondary/60 text-muted-foreground",
};
const STAGE_BAR_COLOR: Record<string, string> = {
  verbal_commit: "bg-emerald-400",
  negotiation: "bg-amber-400",
  proposal: "bg-blue-400",
  qualifying: "bg-purple-400",
  inbound_new: "bg-muted-foreground/40",
};
const PRIORITY_DOT: Record<string, string> = {
  high: "bg-red-400", medium: "bg-amber-400", low: "bg-muted-foreground/40",
  urgent: "bg-red-500",
};
const ACTION_ICON: Record<string, React.ElementType> = {
  meeting: CalendarDays, task: CheckSquare, opportunity: TrendingUp,
  lead: UserPlus, email: Mail, deal: Flame,
};
const PROJECT_STATUS_COLOR: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  on_hold: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  at_risk: "bg-red-500/15 text-red-400 border-red-500/25",
  planning: "bg-blue-500/15 text-blue-400 border-blue-500/25",
};

function Empty({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground italic py-2">{text}</p>;
}

function fmt$(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toLocaleString()}`;
}

// ── 1. Greeting + Day Stats Hero ─────────────────────────────────────────────

export function TodayOverviewWidget() {
  const { data, isLoading } = useTodayData();
  const now = new Date();
  const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening";
  const dateStr = format(now, "EEEE, MMMM d");
  const stats = [
    { label: "Meetings today", value: data?.stats?.meetingsToday ?? 0, color: "text-primary" },
    { label: "Due today",      value: data?.stats?.tasksDueCount  ?? 0, color: "text-blue-400" },
    { label: "Overdue",        value: data?.stats?.overdueCount   ?? 0,
      color: (data?.stats?.overdueCount ?? 0) > 0 ? "text-red-400" : "text-muted-foreground" },
    { label: "New leads",      value: data?.stats?.newLeadsCount  ?? 0, color: "text-emerald-400" },
  ];
  return (
    <Card className="border border-border/50 bg-card/80 h-full" data-testid="widget-today_overview">
      <CardContent className="p-4 sm:p-5 h-full flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Sun className="h-5 w-5 text-amber-400" />
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight" data-testid="text-greeting">{greeting}</h2>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5" data-testid="text-today-date">{dateStr}</p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-20 rounded-lg" />)
            : stats.map(s => (
              <div key={s.label}
                className="text-center px-3 py-1.5 rounded-lg bg-secondary/30 border border-border/40 min-w-[5rem]">
                <p className={`text-xl font-bold ${s.color}`}
                  data-testid={`stat-${s.label.replace(/\s+/g, "-").toLowerCase()}`}>{s.value}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</p>
              </div>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── 2. Suggested Actions ─────────────────────────────────────────────────────

export function TodaySuggestedActionsWidget() {
  const { data, isLoading } = useTodayData();
  const items = data?.suggestedActions ?? [];
  return (
    <ActionWidgetShell id="today_suggested_actions" icon={Zap} title="Suggested Actions" count={items.length}>
      {isLoading && <Skeleton className="h-16" />}
      {!isLoading && items.length === 0 && <Empty text="No suggestions right now — you're caught up." />}
      {!isLoading && items.slice(0, 6).map((a, i) => {
        const Icon = ACTION_ICON[a.type] ?? Zap;
        return (
          <Link key={i} href={a.link}>
            <div
              className={`flex items-center gap-3 px-3 py-2 my-1 rounded-lg border cursor-pointer transition-colors hover:bg-secondary/40 ${a.priority === "high" ? "border-primary/30 bg-primary/5" : "border-border/40"}`}
              data-testid={`action-item-${i}`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${a.priority === "high" ? "text-primary" : "text-muted-foreground"}`} />
              <span className="text-sm flex-1 truncate">{a.text}</span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </div>
          </Link>
        );
      })}
    </ActionWidgetShell>
  );
}

// ── 3. Today's Meetings ──────────────────────────────────────────────────────

export function TodayMeetingsWidget() {
  const { data, isLoading } = useTodayData();
  const items = data?.todaysMeetings ?? [];
  const now = new Date();
  return (
    <ActionWidgetShell id="today_meetings" icon={CalendarDays} title="Today's Meetings"
      count={items.length} link="/execution/calendar">
      {isLoading && <Skeleton className="h-24" />}
      {!isLoading && items.length === 0 && <Empty text="No meetings today — clear schedule!" />}
      {!isLoading && items.map(m => {
        const start = new Date(m.startTime);
        const end = m.endTime ? new Date(m.endTime) : null;
        const isNow = start <= now && end && end >= now;
        const upcoming = start > now && start.getTime() - now.getTime() < 30 * 60 * 1000;
        return (
          <div
            key={m.id}
            className={`flex items-start gap-3 p-2.5 my-1 rounded-lg border ${isNow ? "border-primary/40 bg-primary/5" : "border-border/40"}`}
            data-testid={`meeting-${m.id}`}
          >
            <div className="text-center min-w-[3rem]">
              <p className={`text-sm font-bold ${isNow ? "text-primary" : ""}`}>{format(start, "h:mm")}</p>
              <p className="text-[10px] text-muted-foreground uppercase">{format(start, "a")}</p>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-medium truncate">{m.title}</p>
                {isNow && <Badge className="text-[10px] px-1.5 bg-primary/20 text-primary border-primary/30">Now</Badge>}
                {upcoming && <Badge className="text-[10px] px-1.5 bg-amber-500/15 text-amber-400 border-amber-500/25">Soon</Badge>}
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                <span><Clock className="inline h-3 w-3 mr-0.5" />{format(start, "h:mm")}–{end ? format(end, "h:mm a") : "?"}</span>
                {m.location && <span className="truncate"><MapPin className="inline h-3 w-3 mr-0.5" />{m.location}</span>}
              </div>
            </div>
            {m.meetingUrl && (
              <a href={m.meetingUrl} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1 shrink-0"
                  data-testid={`join-meeting-${m.id}`}>
                  <Video className="h-3 w-3" /> Join
                </Button>
              </a>
            )}
          </div>
        );
      })}
    </ActionWidgetShell>
  );
}

// ── 4. Tasks Due Today ──────────────────────────────────────────────────────

export function TodayTasksDueWidget() {
  const { data, isLoading } = useTodayData();
  const items = data?.tasksDueToday ?? [];
  return (
    <ActionWidgetShell id="today_tasks_due" icon={CheckSquare} title="Due Today"
      count={items.length} link="/execution/tasks">
      {isLoading && <Skeleton className="h-20" />}
      {!isLoading && items.length === 0 && <Empty text="No tasks due today." />}
      {!isLoading && items.map(t => (
        <div key={t.id} className="flex items-center gap-2 py-1 text-sm" data-testid={`task-due-${t.id}`}>
          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_DOT[t.priority] ?? "bg-muted-foreground/30"}`} />
          <span className="truncate flex-1">{t.title}</span>
        </div>
      ))}
    </ActionWidgetShell>
  );
}

// ── 5. Overdue Tasks ────────────────────────────────────────────────────────

export function TodayOverdueWidget() {
  const { data, isLoading } = useTodayData();
  const items = data?.overdueTasks ?? [];
  return (
    <ActionWidgetShell id="today_overdue" icon={AlertTriangle} title="Overdue"
      count={items.length} link="/execution/tasks">
      {isLoading && <Skeleton className="h-20" />}
      {!isLoading && items.length === 0 && <Empty text="No overdue tasks — great!" />}
      {!isLoading && items.map(t => (
        <div key={t.id} className="flex items-center gap-2 py-1 text-sm" data-testid={`task-overdue-${t.id}`}>
          <AlertTriangle className="h-3 w-3 text-red-400 shrink-0" />
          <span className="truncate flex-1">{t.title}</span>
          {t.dueDate && <span className="text-xs text-red-400 shrink-0">{format(new Date(t.dueDate), "MMM d")}</span>}
        </div>
      ))}
    </ActionWidgetShell>
  );
}

// ── 6. Recent Email Activity ────────────────────────────────────────────────

export function TodayEmailActivityWidget() {
  const { data, isLoading } = useTodayData();
  const items = data?.recentActivity ?? [];
  return (
    <ActionWidgetShell id="today_email_activity" icon={Mail} title="Recent Email Activity"
      count={items.length} link="/gmail">
      {isLoading && <Skeleton className="h-24" />}
      {!isLoading && items.length === 0 && <Empty text="No recent email activity." />}
      {!isLoading && items.map(e => (
        <div key={e.id}
          className="flex items-start gap-2.5 py-1.5 border-b border-border/30 last:border-0"
          data-testid={`activity-${e.id}`}
        >
          <Mail className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${e.direction === "outbound" ? "text-primary" : "text-muted-foreground"}`} />
          <div className="flex-1 min-w-0">
            <p className="text-sm truncate">{e.subject || "(no subject)"}</p>
            <p className="text-xs text-muted-foreground truncate">
              {e.fromEmail}{e.sentAt ? ` · ${formatDistanceToNow(new Date(e.sentAt), { addSuffix: true })}` : ""}
            </p>
          </div>
        </div>
      ))}
    </ActionWidgetShell>
  );
}

// ── 7. Hot Opportunities ────────────────────────────────────────────────────

export function TodayHotOpportunitiesWidget() {
  const { data, isLoading } = useTodayData();
  const items = data?.hotOpportunities ?? [];
  return (
    <ActionWidgetShell id="today_hot_opportunities" icon={Flame} title="Hot Opportunities"
      count={items.length} link="/opportunities">
      {isLoading && <Skeleton className="h-32" />}
      {!isLoading && items.length === 0 && <Empty text="No active opportunities assigned to you." />}
      {!isLoading && items.map(o => (
        <Link key={o.id} href={`/opportunities/${o.id}`}>
          <div
            className="p-2.5 my-1 rounded-lg border border-border/40 hover:border-primary/30 hover:bg-primary/5 transition-colors cursor-pointer"
            data-testid={`opp-${o.id}`}
          >
            <div className="flex items-start justify-between gap-1">
              <p className="text-sm font-medium truncate flex-1">{o.title}</p>
              {o.amount && <span className="text-xs font-semibold text-emerald-400 shrink-0">${o.amount.toLocaleString()}</span>}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <Building2 className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground truncate">{o.accountName}</span>
              <Badge variant="outline" className={`text-[10px] px-1 ml-auto shrink-0 ${STAGE_COLOR[o.stage] ?? ""}`}>
                {STAGE_LABEL[o.stage] ?? o.stage}
              </Badge>
            </div>
          </div>
        </Link>
      ))}
    </ActionWidgetShell>
  );
}

// ── 8. New Leads ────────────────────────────────────────────────────────────

export function TodayNewLeadsWidget() {
  const { data, isLoading } = useTodayData();
  const items = data?.newLeads ?? [];
  return (
    <ActionWidgetShell id="today_new_leads" icon={UserPlus} title="New Leads"
      count={items.length} link="/opportunities">
      {isLoading && <Skeleton className="h-24" />}
      {!isLoading && items.length === 0 && <Empty text="No new leads this week." />}
      {!isLoading && items.map(l => (
        <div key={l.id}
          className="py-1.5 border-b border-border/30 last:border-0"
          data-testid={`lead-${l.id}`}
        >
          <p className="text-sm font-medium truncate">{l.company}</p>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
            {l.contactName && <span>{l.contactName}</span>}
            {(l.city || l.state) && <span className="before:content-['·'] before:mx-1">{[l.city, l.state].filter(Boolean).join(", ")}</span>}
            {l.dealAmount && <span className="text-emerald-400 ml-auto">${l.dealAmount.toLocaleString()}</span>}
          </div>
        </div>
      ))}
    </ActionWidgetShell>
  );
}

// ── 9. Team Workload Snapshot ────────────────────────────────────────────────
// CEO view: see every active team member's task load at a glance — who's
// overloaded (high overdue) vs. productive (high completed_week).

export function TodayTeamWorkloadWidget() {
  const { data, isLoading } = useTodayData();
  const members = data?.teamWorkload ?? [];
  const maxOpen = Math.max(1, ...members.map(m => m.open_tasks));

  return (
    <ActionWidgetShell id="today_team_workload" icon={Users} title="Team Workload"
      count={members.length} link="/execution/team-workload">
      {isLoading && <Skeleton className="h-32" />}
      {!isLoading && members.length === 0 && <Empty text="No active team members found." />}
      {!isLoading && members.map(m => {
        const overdueRatio = m.open_tasks > 0 ? m.overdue / m.open_tasks : 0;
        const barColor = overdueRatio > 0.5 ? "bg-red-400" : overdueRatio > 0.2 ? "bg-amber-400" : "bg-emerald-400";
        return (
          <div key={m.id} className="py-2 border-b border-border/30 last:border-0" data-testid={`member-workload-${m.id}`}>
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-sm font-medium truncate flex-1">{m.name}</span>
              <div className="flex items-center gap-2 text-xs shrink-0">
                <span className="text-muted-foreground">{m.open_tasks} open</span>
                {m.overdue > 0 && (
                  <span className="text-red-400 font-semibold">{m.overdue} overdue</span>
                )}
                {m.completed_week > 0 && (
                  <span className="text-emerald-400">✓ {m.completed_week}</span>
                )}
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-secondary/50 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${barColor}`}
                style={{ width: `${Math.min(100, (m.open_tasks / maxOpen) * 100)}%` }}
              />
            </div>
          </div>
        );
      })}
      {!isLoading && members.length > 0 && (
        <p className="text-[10px] text-muted-foreground mt-2 italic">
          Bar = relative task load · Red = {">"}50% overdue · Green = on track · ✓ = completed this week
        </p>
      )}
    </ActionWidgetShell>
  );
}

// ── 10. Team Blockers (company-wide overdue) ─────────────────────────────────
// CEO view: all overdue tasks across the entire team with owner attribution so
// the CEO can see exactly who is blocked on what and intervene if needed.

export function TodayTeamBlockersWidget() {
  const { data, isLoading } = useTodayData();
  const items = data?.teamBlockers ?? [];

  return (
    <ActionWidgetShell id="today_team_blockers" icon={ShieldAlert} title="Team Blockers"
      count={items.length} link="/execution/team-workload">
      {isLoading && <Skeleton className="h-24" />}
      {!isLoading && items.length === 0 && <Empty text="No overdue tasks across the team — great work!" />}
      {!isLoading && items.map(t => {
        const urgency = t.daysOverdue > 14 ? "text-red-400" : t.daysOverdue > 7 ? "text-amber-400" : "text-muted-foreground";
        return (
          <div key={t.id}
            className="flex items-start gap-2.5 py-1.5 border-b border-border/30 last:border-0"
            data-testid={`blocker-${t.id}`}
          >
            <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${PRIORITY_DOT[t.priority] ?? "bg-muted-foreground/30"}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">{t.title}</p>
              <p className="text-xs text-muted-foreground">{t.ownerName}</p>
            </div>
            <span className={`text-xs font-medium shrink-0 tabular-nums ${urgency}`}>
              {t.daysOverdue}d
            </span>
          </div>
        );
      })}
      {!isLoading && items.length > 0 && (
        <Link href="/execution/team-workload">
          <p className="text-xs text-primary mt-2 flex items-center gap-1 cursor-pointer hover:underline">
            View all <ArrowRight className="h-3 w-3" />
          </p>
        </Link>
      )}
    </ActionWidgetShell>
  );
}

// ── 11. Pipeline Funnel ──────────────────────────────────────────────────────
// CEO view: company-wide pipeline stage distribution with $ value per stage
// and a stalled deal count so the CEO sees where deals are concentrating or
// getting stuck.

export function TodayPipelineFunnelWidget() {
  const { data, isLoading } = useTodayData();
  const rawFunnel = data?.pipelineFunnel ?? [];
  const stalledCount = data?.pipelineFunnelMeta?.stalledDealCount ?? 0;

  const knownSet = new Set(STAGE_ORDER);
  const ordered = STAGE_ORDER
    .map(stage => rawFunnel.find(r => r.stage === stage))
    .filter(Boolean) as typeof rawFunnel;
  const extra = rawFunnel.filter(r => !knownSet.has(r.stage));
  const funnelByStage = [...ordered, ...extra];

  const maxCount = Math.max(1, ...funnelByStage.map(r => r.count));

  return (
    <ActionWidgetShell id="today_pipeline_funnel" icon={BarChart3} title="Pipeline Funnel"
      link="/pipeline">
      {isLoading && <Skeleton className="h-32" />}
      {!isLoading && funnelByStage.length === 0 && <Empty text="No open pipeline deals." />}
      {!isLoading && funnelByStage.map(r => (
        <div key={r.stage} className="py-1.5 border-b border-border/30 last:border-0" data-testid={`funnel-${r.stage}`}>
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-xs text-muted-foreground w-24 shrink-0">{STAGE_LABEL[r.stage] ?? r.stage}</span>
            <div className="flex-1 h-2 rounded-full bg-secondary/40 overflow-hidden">
              <div
                className={`h-full rounded-full ${STAGE_BAR_COLOR[r.stage] ?? "bg-primary/50"}`}
                style={{ width: `${(r.count / maxCount) * 100}%` }}
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs font-semibold w-4 text-right">{r.count}</span>
              {r.value > 0 && (
                <span className="text-xs text-emerald-400 w-16 text-right tabular-nums">{fmt$(r.value)}</span>
              )}
            </div>
          </div>
        </div>
      ))}
      {!isLoading && stalledCount > 0 && (
        <div className="mt-2 flex items-center gap-2 px-2 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          <p className="text-xs text-amber-400">
            {stalledCount} deal{stalledCount > 1 ? "s" : ""} stalled — no activity in 7+ days
          </p>
        </div>
      )}
    </ActionWidgetShell>
  );
}

// ── 12. Active Projects ──────────────────────────────────────────────────────
// CEO view: all active projects with milestone completion progress, owner,
// and end date so the CEO can spot slipping or at-risk deliverables.

export function TodayActiveProjectsWidget() {
  const { data, isLoading } = useTodayData();
  const projects = data?.activeProjects ?? [];
  const now = new Date();

  return (
    <ActionWidgetShell id="today_active_projects" icon={FolderOpen} title="Active Projects"
      count={projects.length} link="/execution/projects">
      {isLoading && <Skeleton className="h-32" />}
      {!isLoading && projects.length === 0 && <Empty text="No active projects right now." />}
      {!isLoading && projects.map(p => {
        const pct = p.milestones_total > 0 ? Math.round((p.milestones_done / p.milestones_total) * 100) : 0;
        const isOverdue = p.endDate && new Date(p.endDate) < now;
        const endLabel = p.endDate ? format(new Date(p.endDate), "MMM d") : null;
        return (
          <div key={p.id}
            className="py-2 border-b border-border/30 last:border-0"
            data-testid={`project-${p.id}`}
          >
            <div className="flex items-start justify-between gap-1 mb-1">
              <p className="text-sm font-medium truncate flex-1">{p.name}</p>
              <Badge variant="outline"
                className={`text-[10px] px-1.5 shrink-0 ml-1 ${PROJECT_STATUS_COLOR[p.status] ?? "bg-secondary/60 text-muted-foreground"}`}>
                {p.status.replace(/_/g, " ")}
              </Badge>
            </div>
            <div className="flex items-center gap-2 mb-1.5">
              {p.accountName && (
                <span className="text-xs text-muted-foreground truncate flex-1">
                  <Building2 className="inline h-3 w-3 mr-0.5" />{p.accountName}
                </span>
              )}
              {endLabel && (
                <span className={`text-xs shrink-0 ${isOverdue ? "text-red-400" : "text-muted-foreground"}`}>
                  {isOverdue ? "⚠ " : ""}Due {endLabel}
                </span>
              )}
            </div>
            {p.milestones_total > 0 && (
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-secondary/50 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${pct === 100 ? "bg-emerald-400" : isOverdue ? "bg-red-400" : "bg-primary"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                  {p.milestones_done}/{p.milestones_total} milestones
                </span>
              </div>
            )}
            {p.ownerName && (
              <p className="text-[10px] text-muted-foreground mt-1">{p.ownerName}</p>
            )}
          </div>
        );
      })}
    </ActionWidgetShell>
  );
}

// ── Catalog: widget defs available on the Today page ────────────────────────
//
// All ids are `today_` prefixed so they cannot collide with the Command
// Center widget catalog. Visibility is stored in the same flat
// `widgetVisibility` map on the user profile — each page only consults its
// own catalog so the namespaces stay isolated by construction.

export const TODAY_WIDGET_DEFS: WidgetDef[] = [
  {
    id: "today_team_wins",
    label: "Team Wins Ticker",
    description: "Live-rotating feed of recently completed tasks, closed deals, and milestones from across the company.",
    defaultVisible: true, category: "team", isNew: true,
  },
  {
    id: "today_overview",
    label: "Greeting & Day Stats",
    description: "Time-of-day greeting plus a quick KPI strip (meetings, due, overdue, new leads).",
    defaultVisible: true, category: "action", isNew: true,
  },
  {
    id: "today_suggested_actions",
    label: "Suggested Actions",
    description: "Smart prompts for the most impactful next steps right now.",
    defaultVisible: true, category: "action", isNew: true,
  },
  {
    id: "today_meetings",
    label: "Today's Meetings",
    description: "Your calendar for the day with quick join links for video calls.",
    defaultVisible: true, category: "action", isNew: true,
  },
  {
    id: "today_tasks_due",
    label: "Due Today",
    description: "Tasks scheduled to be done today, ranked by priority.",
    defaultVisible: true, category: "action", isNew: true,
  },
  {
    id: "today_overdue",
    label: "Overdue Tasks",
    description: "Tasks past their due date that need attention.",
    defaultVisible: true, category: "risk", isNew: true,
  },
  {
    id: "today_email_activity",
    label: "Recent Email Activity",
    description: "Latest inbox movement: replies sent and emails received.",
    defaultVisible: true, category: "action", isNew: true,
  },
  {
    id: "today_hot_opportunities",
    label: "Hot Opportunities",
    description: "Top deals you own that are close to closing.",
    defaultVisible: true, category: "revenue", isNew: true,
  },
  {
    id: "today_new_leads",
    label: "New Leads",
    description: "Recently arrived leads ready for first-touch.",
    defaultVisible: true, category: "pipeline", isNew: true,
  },
  // ── CEO-focused additions ──
  {
    id: "today_team_workload",
    label: "Team Workload",
    description: "Every active team member's open tasks, overdue count, and completions this week — color-coded by health.",
    defaultVisible: true, category: "team", isNew: true,
  },
  {
    id: "today_team_blockers",
    label: "Team Blockers",
    description: "All overdue tasks across the entire team with owner attribution and days overdue.",
    defaultVisible: true, category: "team", isNew: true,
  },
  {
    id: "today_pipeline_funnel",
    label: "Pipeline Funnel",
    description: "Company-wide deal count and value per stage with stalled deal alerts.",
    defaultVisible: true, category: "revenue", isNew: true,
  },
  {
    id: "today_active_projects",
    label: "Active Projects",
    description: "All active projects with milestone progress, owner, and end date — spot slipping deliverables at a glance.",
    defaultVisible: true, category: "operations", isNew: true,
  },
];

// Map of today widget id → component, merged into ACTION_WIDGET_MAP at the
// dashboard-grid layer (avoids a circular import with action-widgets.tsx).
export const TODAY_ACTION_WIDGET_MAP: Record<string, React.ComponentType<any>> = {
  today_team_wins:          TeamWinsTickerWidget,
  today_overview:           TodayOverviewWidget,
  today_suggested_actions:  TodaySuggestedActionsWidget,
  today_meetings:           TodayMeetingsWidget,
  today_tasks_due:          TodayTasksDueWidget,
  today_overdue:            TodayOverdueWidget,
  today_email_activity:     TodayEmailActivityWidget,
  today_hot_opportunities:  TodayHotOpportunitiesWidget,
  today_new_leads:          TodayNewLeadsWidget,
  today_team_workload:      TodayTeamWorkloadWidget,
  today_team_blockers:      TodayTeamBlockersWidget,
  today_pipeline_funnel:    TodayPipelineFunnelWidget,
  today_active_projects:    TodayActiveProjectsWidget,
};

// Default size hints for today widgets in the 12-col responsive grid.
export const TODAY_WIDGET_SIZE_HINTS: Record<string, { w: number; h: number; minW?: number; minH?: number }> = {
  today_team_wins:          { w: 12, h: 3,  minW: 8,  minH: 3 },
  today_overview:           { w: 12, h: 4,  minW: 6,  minH: 3 },
  today_suggested_actions:  { w: 12, h: 6,  minW: 6,  minH: 4 },
  today_meetings:           { w: 8,  h: 11, minW: 4,  minH: 6 },
  today_tasks_due:          { w: 4,  h: 8,  minW: 3,  minH: 5 },
  today_overdue:            { w: 4,  h: 8,  minW: 3,  minH: 5 },
  today_email_activity:     { w: 8,  h: 8,  minW: 4,  minH: 5 },
  today_hot_opportunities:  { w: 4,  h: 11, minW: 3,  minH: 5 },
  today_new_leads:          { w: 4,  h: 8,  minW: 3,  minH: 5 },
  today_team_workload:      { w: 6,  h: 10, minW: 4,  minH: 6 },
  today_team_blockers:      { w: 6,  h: 10, minW: 4,  minH: 6 },
  today_pipeline_funnel:    { w: 6,  h: 9,  minW: 4,  minH: 5 },
  today_active_projects:    { w: 6,  h: 11, minW: 4,  minH: 6 },
};
