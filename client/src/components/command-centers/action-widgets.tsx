import { useRef, useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle, CheckSquare, Mail, Zap, Plus, Clock, Users, Trophy,
  TrendingUp, TrendingDown, ShieldAlert, Shield, Calendar, Package,
  ChevronRight, GripVertical, FlaskConical, Truck, BarChart3,
  Star, Target, FileText, PhoneCall, UserPlus, RefreshCw, Flame,
  ArrowRight, Circle,
} from "lucide-react";
import { format, formatDistanceToNow, isToday } from "date-fns";
import { WeatherWidget } from "@/components/widgets/weather";
import { TravelCalendarWidget as _TravelCalendarWidget } from "@/components/travel/travel-calendar-widget";
import { LeadsMissionControlWidget as _LeadsMissionControlWidget } from "@/components/leads/leads-mission-control-widget";
import {
  ExecutiveSnapshotWidget,
  PipelineHealthWidget,
  CertBlockersWidget,
  DeploymentBlockersWidget,
  CloseLikelihoodDealsWidget,
  KeyAccountsActionWidget,
} from "@/components/widgets/role-cards";
import { MyCalendarWidget } from "@/components/widgets/my-calendar-widget";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(n?: number | string) {
  const v = Number(n ?? 0);
  if (!v) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v}`;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "";
  try { return format(new Date(d), "MMM d"); } catch { return ""; }
}

const SEV_DOT: Record<string, string> = {
  high: "bg-red-400", urgent: "bg-red-500", medium: "bg-amber-400", low: "bg-blue-400",
};

const STAGE_LABEL: Record<string, string> = {
  inbound_new: "New", qualifying: "Qualifying", proposal: "Proposal",
  negotiation: "Negotiating", verbal_commit: "Verbal", closed_won: "Won",
};

// ── Widget Shell ──────────────────────────────────────────────────────────────

export function ActionWidgetShell({
  id, icon: Icon, title, count, link, children, compact,
  isDragging, dragProps,
}: {
  id: string; icon: React.ElementType; title: string; count?: number;
  link?: string; children: React.ReactNode; compact?: boolean;
  isDragging?: boolean; dragProps?: React.HTMLAttributes<HTMLDivElement>;
}) {
  return (
    <Card
      className={`border border-border/50 bg-card/80 relative group/widget transition-all ${isDragging ? "opacity-40 scale-[0.98] ring-2 ring-primary/30" : ""}`}
      data-testid={`widget-${id}`}
    >
      {dragProps && (
        <div
          {...dragProps}
          className="absolute top-3 right-3 opacity-0 group-hover/widget:opacity-100 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-all z-10 touch-none"
          data-testid={`drag-handle-${id}`}
          title="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </div>
      )}
      <CardHeader className={`${compact ? "pb-1 pt-3 px-4" : "pb-2 pt-4 px-4"} pr-10`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</CardTitle>
            {count !== undefined && count > 0 && (
              <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-primary/10 text-primary text-xs font-bold">{count}</span>
            )}
          </div>
          {link && count !== undefined && count > 0 && (
            <Link href={link}>
              <button className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5 mr-6">
                All <ChevronRight className="h-3 w-3" />
              </button>
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent className={`${compact ? "px-4 pb-3 pt-0" : "px-4 pb-4 pt-0"}`}>{children}</CardContent>
    </Card>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="text-xs text-muted-foreground italic py-2">{message}</p>;
}

function ItemRow({ icon: Icon, title, subtitle, right, link, severity, testId }: {
  icon?: React.ElementType; title: string; subtitle?: string; right?: string;
  link?: string; severity?: string; testId?: string;
}) {
  const inner = (
    <div
      className="flex items-start gap-2 py-1.5 px-2 -mx-2 rounded-md hover:bg-muted/40 cursor-pointer transition-colors group"
      data-testid={testId}
    >
      {severity && <div className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${SEV_DOT[severity] ?? "bg-muted-foreground/30"}`} />}
      {Icon && !severity && <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{title}</p>
        {subtitle && <p className="text-xs text-muted-foreground truncate mt-0.5">{subtitle}</p>}
      </div>
      {right && <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">{right}</span>}
      <ArrowRight className="h-3 w-3 text-muted-foreground/0 group-hover:text-muted-foreground/50 transition-colors shrink-0 mt-0.5" />
    </div>
  );
  return link ? <Link href={link}>{inner}</Link> : inner;
}

// ── Widget Data Hook ──────────────────────────────────────────────────────────

export function useWidgetData() {
  return useQuery<any>({
    queryKey: ["/api/command-center/widget-data"],
    refetchInterval: 5 * 60 * 1000,
    staleTime: 2 * 60 * 1000,
  });
}

// ── 1. Today's Critical Actions ───────────────────────────────────────────────

export function TodayCriticalActionsWidget({ compact, isDragging, dragProps }: WidgetProps) {
  const { data, isLoading } = useWidgetData();
  const items = data?.criticalActions?.items ?? [];
  const count = data?.criticalActions?.count ?? 0;

  return (
    <ActionWidgetShell id="today_critical_actions" icon={Flame} title="Today's Critical Actions"
      count={count} link="/execution/tasks" compact={compact} isDragging={isDragging} dragProps={dragProps}>
      {isLoading && <Skeleton className="h-20" />}
      {!isLoading && items.length === 0 && <EmptyState message="No critical tasks due today. Clear!" />}
      {!isLoading && items.slice(0, 5).map((t: any) => (
        <ItemRow key={t.id}
          title={t.title}
          subtitle={t.linked_name ? `${t.linked_object_type}: ${t.linked_name}` : t.owner_name ?? undefined}
          right={t.urgency === "overdue" ? "Overdue" : "Today"}
          severity={t.priority}
          link="/execution/tasks"
          testId={`critical-action-${t.id}`}
        />
      ))}
    </ActionWidgetShell>
  );
}

// ── 2. Inbox Priority Radar ───────────────────────────────────────────────────

function fmtWaitAge(since: string | null | undefined): string {
  if (!since) return "Today";
  const age = Math.floor((Date.now() - new Date(since).getTime()) / 86400000);
  if (age <= 0) return "Today";
  if (age < 90) return `${age}d waiting`;
  try { return format(new Date(since), "MMM yyyy") + " · waiting"; } catch { return `${age}d waiting`; }
}

export function InboxPriorityRadarWidget({ compact, isDragging, dragProps }: WidgetProps) {
  const { data: threads, isLoading } = useQuery<any[]>({
    queryKey: ["/api/inbox/awaiting-reply"],
    staleTime: 2 * 60 * 1000,
  });
  const items = threads ?? [];

  return (
    <ActionWidgetShell id="inbox_priority_radar" icon={Mail} title="Inbox Priority Radar"
      count={items.length} link="/gmail" compact={compact} isDragging={isDragging} dragProps={dragProps}>
      {isLoading && <Skeleton className="h-20" />}
      {!isLoading && items.length === 0 && <EmptyState message="Inbox clear — no threads awaiting reply." />}
      {!isLoading && items.slice(0, 5).map((t: any, i: number) => {
        const since = t.awaiting_reply_since ?? t.awaitingReplySince;
        const age = since ? Math.floor((Date.now() - new Date(since).getTime()) / 86400000) : 0;
        const threadLink = t.gmail_thread_id
          ? `/gmail?thread=${encodeURIComponent(t.gmail_thread_id)}`
          : "/gmail";
        return (
          <ItemRow key={t.gmail_thread_id ?? i}
            title={t.subject ?? t.preview ?? "(No subject)"}
            subtitle={t.account_name ?? t.from_name ?? undefined}
            right={fmtWaitAge(since)}
            severity={age >= 7 ? "high" : age >= 2 ? "medium" : "low"}
            link={threadLink}
            testId={`inbox-radar-${i}`}
          />
        );
      })}
    </ActionWidgetShell>
  );
}

// ── 3. Certification Watchtower ───────────────────────────────────────────────

export function CertWatchtowerWidget({ compact, isDragging, dragProps }: WidgetProps) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/executive/risk-alerts"],
    staleTime: 5 * 60 * 1000,
  });
  const certAlerts = data?.certTrackerAlerts ?? [];
  const count = certAlerts.length;

  return (
    <ActionWidgetShell id="cert_watchtower" icon={FlaskConical} title="Certification Watchtower"
      count={count} compact={compact} isDragging={isDragging} dragProps={dragProps}>
      {isLoading && <Skeleton className="h-20" />}
      {!isLoading && count === 0 && <EmptyState message="No active certification alerts. All clear." />}
      {!isLoading && certAlerts.slice(0, 5).map((p: any, i: number) => {
        const state = typeof p.alertState === "string" ? JSON.parse(p.alertState) : (p.alertState ?? {});
        const active = Object.entries(state.conditions ?? {}).filter(([, v]: any) => v?.triggered).map(([k]) => k);
        return (
          <ItemRow key={p.id ?? i}
            title={p.projectName ?? p.name ?? `Project ${p.id}`}
            subtitle={active.map(a => a.replace(/_/g, " ")).join(", ") || "Alert active"}
            severity="high"
            link={`/projects`}
            testId={`cert-alert-${i}`}
          />
        );
      })}
    </ActionWidgetShell>
  );
}

// ── 4. Deployment Pulse ───────────────────────────────────────────────────────

export function DeploymentPulseWidget({ compact, isDragging, dragProps }: WidgetProps) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/executive/risk-alerts"],
    staleTime: 5 * 60 * 1000,
  });
  const blockers = data?.installationBlockers ?? [];
  const count = blockers.length;

  return (
    <ActionWidgetShell id="deployment_pulse" icon={Truck} title="Deployment Pulse"
      count={count} link="/installs" compact={compact} isDragging={isDragging} dragProps={dragProps}>
      {isLoading && <Skeleton className="h-20" />}
      {!isLoading && count === 0 && (
        <div className="flex items-center gap-2 py-2">
          <div className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
          <p className="text-sm text-emerald-400">All deployments on track</p>
        </div>
      )}
      {!isLoading && blockers.slice(0, 5).map((w: any, i: number) => (
        <ItemRow key={w.id ?? i}
          title={w.title}
          subtitle={w.blockers ? `Blocker: ${String(w.blockers).slice(0, 60)}` : w.owner_name ?? undefined}
          right={w.target_completion_date ? fmtDate(w.target_completion_date) : undefined}
          severity="high"
          link="/installs"
          testId={`deploy-pulse-${i}`}
        />
      ))}
    </ActionWidgetShell>
  );
}

// ── 5. Cash Pulse ─────────────────────────────────────────────────────────────

export function CashPulseWidget({ compact, isDragging, dragProps }: WidgetProps) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/executive/kpis"],
    staleTime: 5 * 60 * 1000,
  });

  const pipeline = Number(data?.pipeline?.totalPipeline ?? 0);
  const weighted = Number(data?.pipeline?.weightedPipeline ?? 0);
  const wonMonth = Number(data?.pipeline?.wonThisMonth ?? 0);
  const commits  = Number(data?.pipeline?.commitAmount ?? 0);

  return (
    <ActionWidgetShell id="cash_pulse" icon={TrendingUp} title="Cash Pulse"
      compact={compact} isDragging={isDragging} dragProps={dragProps}>
      {isLoading && <Skeleton className="h-24" />}
      {!isLoading && (
        <div className="grid grid-cols-2 gap-3 mt-1">
          {[
            { label: "Total Pipeline",   value: fmtMoney(pipeline), color: "text-blue-400"    },
            { label: "Weighted Forecast",value: fmtMoney(weighted), color: "text-violet-400"  },
            { label: "Committed",        value: fmtMoney(commits),  color: "text-emerald-400" },
            { label: "Won This Month",   value: fmtMoney(wonMonth), color: "text-primary"     },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-muted/30 rounded-lg p-2.5">
              <p className={`text-lg font-bold ${color}`}>{value}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}
      {!isLoading && (
        <Link href="/executive-dashboard">
          <button className="text-xs text-primary hover:underline flex items-center gap-1 mt-2">
            Full executive view <ArrowRight className="h-3 w-3" />
          </button>
        </Link>
      )}
    </ActionWidgetShell>
  );
}

// ── 6. Team Load Balancer ─────────────────────────────────────────────────────

export function TeamLoadBalancerWidget({ compact, isDragging, dragProps }: WidgetProps) {
  const { data, isLoading } = useWidgetData();
  const items: any[] = data?.teamLoad?.items ?? [];
  const max = Math.max(...items.map((u: any) => Number(u.open_count)), 1);

  return (
    <ActionWidgetShell id="team_load_balancer" icon={Users} title="Team Load Balancer"
      compact={compact} isDragging={isDragging} dragProps={dragProps}>
      {isLoading && <Skeleton className="h-24" />}
      {!isLoading && items.length === 0 && <EmptyState message="No open tasks assigned to team members." />}
      {!isLoading && items.slice(0, 8).map((u: any) => {
        const open = Number(u.open_count);
        const overdue = Number(u.overdue_count);
        const pct = Math.round((open / max) * 100);
        const color = overdue > 0 ? "bg-red-400" : open > 10 ? "bg-amber-400" : "bg-emerald-400";
        return (
          <div key={u.user_id} className="py-1.5" data-testid={`team-load-${u.user_id}`}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-xs font-medium truncate max-w-[120px]">{u.user_name ?? "Unknown"}</span>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-xs text-muted-foreground">{open} open</span>
                {overdue > 0 && <Badge variant="destructive" className="text-[10px] h-4 px-1">{overdue} overdue</Badge>}
              </div>
            </div>
            <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
              <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </ActionWidgetShell>
  );
}

// ── 7. My Waiting On ─────────────────────────────────────────────────────────

export function MyWaitingOnWidget({ compact, isDragging, dragProps }: WidgetProps) {
  const { data, isLoading } = useWidgetData();
  const items: any[] = data?.waitingOn?.items ?? [];
  const { data: threads, isLoading: threadsLoading } = useQuery<any[]>({
    queryKey: ["/api/inbox/awaiting-reply"],
    staleTime: 2 * 60 * 1000,
  });

  // Combine: tasks waiting + email threads needing reply from THEM
  const waitingThreads = (threads ?? []).filter((t: any) => {
    const status = t.reply_status ?? t.replyStatus;
    return status === "waiting_on_them";
  }).slice(0, 3);

  const total = items.length + waitingThreads.length;

  return (
    <ActionWidgetShell id="my_waiting_on" icon={Clock} title="My Waiting On"
      count={total} compact={compact} isDragging={isDragging} dragProps={dragProps}>
      {(isLoading || threadsLoading) && <Skeleton className="h-20" />}
      {!isLoading && !threadsLoading && total === 0 && <EmptyState message="Nothing pending — you're on top of everything!" />}
      {!isLoading && items.slice(0, 4).map((t: any) => (
        <ItemRow key={`task-${t.id}`}
          icon={CheckSquare}
          title={t.title}
          subtitle={t.linked_name ? `via ${t.linked_object_type}: ${t.linked_name}` : undefined}
          right={`${t.days_waiting ?? 0}d waiting`}
          link="/execution/tasks"
          testId={`waiting-task-${t.id}`}
        />
      ))}
      {!threadsLoading && waitingThreads.map((t: any, i: number) => (
        <ItemRow key={`thread-${i}`}
          icon={Mail}
          title={t.subject ?? "(No subject)"}
          subtitle={t.account_name ?? "Waiting on reply"}
          link="/communications"
          testId={`waiting-thread-${i}`}
        />
      ))}
    </ActionWidgetShell>
  );
}

// ── 8. AI Suggested Moves ─────────────────────────────────────────────────────

export function AISuggestedMovesWidget({ compact, isDragging, dragProps }: WidgetProps) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/tasks/suggestions"],
    staleTime: 5 * 60 * 1000,
  });
  const { toast } = useToast();

  const acceptMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/tasks/suggestions/${id}/accept`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/suggestions"] });
      toast({ title: "Task created from suggestion" });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/tasks/suggestions/${id}/dismiss`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tasks/suggestions"] }),
  });

  const items: any[] = data?.suggestions ?? [];

  return (
    <ActionWidgetShell id="ai_suggested_moves" icon={Zap} title="AI Suggested Moves"
      count={items.length} compact={compact} isDragging={isDragging} dragProps={dragProps}>
      {isLoading && <Skeleton className="h-24" />}
      {!isLoading && items.length === 0 && <EmptyState message="No AI suggestions right now — great position!" />}
      {!isLoading && items.slice(0, 4).map((s: any) => (
        <div key={s.id} className="py-2 border-b border-border/20 last:border-0" data-testid={`ai-move-${s.id}`}>
          <div className="flex items-start gap-2">
            <div className={`mt-1 h-2 w-2 rounded-full shrink-0 ${SEV_DOT[s.severity] ?? "bg-muted-foreground/40"}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{s.title}</p>
              {s.reason && <p className="text-xs text-muted-foreground mt-0.5 truncate">{s.reason}</p>}
            </div>
          </div>
          <div className="flex gap-2 mt-1.5 ml-4">
            <Button size="sm" variant="outline" className="h-6 text-[11px] px-2 gap-1"
              onClick={() => acceptMutation.mutate(s.id)}
              disabled={acceptMutation.isPending}
              data-testid={`accept-suggestion-${s.id}`}>
              <CheckSquare className="h-3 w-3" /> Accept
            </Button>
            <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2 text-muted-foreground"
              onClick={() => dismissMutation.mutate(s.id)}
              disabled={dismissMutation.isPending}
              data-testid={`dismiss-suggestion-${s.id}`}>
              Dismiss
            </Button>
          </div>
        </div>
      ))}
    </ActionWidgetShell>
  );
}

// ── 9. Quick Create Launcher ──────────────────────────────────────────────────

export function QuickCreateLauncherWidget({ compact, isDragging, dragProps }: WidgetProps) {
  const { toast } = useToast();

  const shortcuts = [
    { icon: CheckSquare, label: "New Task",    href: "/execution/tasks",  color: "text-primary" },
    { icon: UserPlus,    label: "New Lead",    href: "/opportunities",    color: "text-emerald-400" },
    { icon: FileText,    label: "New Quote",   href: "/quotes",           color: "text-amber-400" },
    { icon: PhoneCall,   label: "Log a Call",  href: "/execution/tasks",  color: "text-blue-400" },
    { icon: Plus,        label: "Add Account", href: "/accounts",         color: "text-violet-400" },
    { icon: Calendar,    label: "Schedule",    href: "/execution/calendar",color: "text-cyan-400" },
  ];

  return (
    <ActionWidgetShell id="quick_create_launcher" icon={Plus} title="Quick Create"
      compact={compact} isDragging={isDragging} dragProps={dragProps}>
      <div className="grid grid-cols-3 gap-2 mt-1">
        {shortcuts.map(({ icon: Icon, label, href, color }) => (
          <Link key={label} href={href}>
            <button
              className="flex flex-col items-center gap-1.5 p-2.5 rounded-lg border border-border/40 hover:bg-muted/40 hover:border-border/70 transition-all w-full group"
              data-testid={`quick-create-${label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <Icon className={`h-5 w-5 ${color} group-hover:scale-110 transition-transform`} />
              <span className="text-[10px] text-muted-foreground text-center leading-tight">{label}</span>
            </button>
          </Link>
        ))}
      </div>
    </ActionWidgetShell>
  );
}

// ── 10. Board Pack Readiness ──────────────────────────────────────────────────

export function BoardPackReadinessWidget({ compact, isDragging, dragProps }: WidgetProps) {
  const { data, isLoading } = useWidgetData();
  const board = data?.boardPack;
  const score = board?.readinessScore ?? 0;
  const checks: any[] = board?.checks ?? [];

  const scoreColor = score >= 80 ? "text-emerald-400" : score >= 50 ? "text-amber-400" : "text-red-400";
  const ringColor  = score >= 80 ? "border-emerald-400" : score >= 50 ? "border-amber-400" : "border-red-400";

  return (
    <ActionWidgetShell id="board_pack_readiness" icon={Shield} title="Board Pack Readiness"
      compact={compact} isDragging={isDragging} dragProps={dragProps}>
      {isLoading && <Skeleton className="h-24" />}
      {!isLoading && board && (
        <>
          <div className="flex items-center gap-4 mb-3 mt-1">
            <div className={`w-14 h-14 rounded-full border-4 ${ringColor} flex items-center justify-center shrink-0`}>
              <span className={`text-lg font-bold ${scoreColor}`}>{score}</span>
            </div>
            <div>
              <p className={`text-sm font-semibold ${scoreColor}`}>
                {score >= 80 ? "Pack Ready" : score >= 50 ? "Needs Attention" : "Not Ready"}
              </p>
              <p className="text-xs text-muted-foreground">{checks.filter((c: any) => c.ok).length}/{checks.length} checks passing</p>
            </div>
          </div>
          <div className="space-y-1">
            {checks.map((c: any) => (
              <div key={c.key} className="flex items-center gap-2 py-0.5" data-testid={`board-check-${c.key}`}>
                <div className={`h-4 w-4 rounded-full flex items-center justify-center shrink-0 ${c.ok ? "bg-emerald-500/20" : "bg-red-500/20"}`}>
                  {c.ok
                    ? <CheckSquare className="h-2.5 w-2.5 text-emerald-400" />
                    : <AlertTriangle className="h-2.5 w-2.5 text-red-400" />}
                </div>
                <span className={`text-xs ${c.ok ? "text-muted-foreground" : "text-foreground"}`}>{c.label}</span>
                {!c.ok && c.value > 0 && (
                  <Badge variant="outline" className="text-[10px] h-4 px-1 ml-auto text-red-400 border-red-400/30">{c.value}</Badge>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </ActionWidgetShell>
  );
}

// ── 11. Open Quotes Aging ─────────────────────────────────────────────────────

export function OpenQuotesAgingWidget({ compact, isDragging, dragProps }: WidgetProps) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/executive/risk-alerts"],
    staleTime: 5 * 60 * 1000,
  });
  const quotes: any[] = data?.quotesAwaitingResponse ?? [];

  return (
    <ActionWidgetShell id="open_quotes_aging" icon={FileText} title="Open Quotes Aging"
      count={quotes.length} link="/quotes" compact={compact} isDragging={isDragging} dragProps={dragProps}>
      {isLoading && <Skeleton className="h-20" />}
      {!isLoading && quotes.length === 0 && <EmptyState message="No stale quotes awaiting response." />}
      {!isLoading && quotes.slice(0, 5).map((q: any) => (
        <ItemRow key={q.id}
          title={q.quote_number ?? `Quote ${q.id}`}
          subtitle={q.account_name ?? q.customer_name ?? undefined}
          right={`${q.days_waiting}d · ${fmtMoney(q.total)}`}
          severity={Number(q.days_waiting) >= 30 ? "high" : "medium"}
          link="/quotes"
          testId={`quote-aging-${q.id}`}
        />
      ))}
    </ActionWidgetShell>
  );
}

// ── 12. Pipeline Stage Funnel ─────────────────────────────────────────────────

export function PipelineFunnelWidget({ compact, isDragging, dragProps }: WidgetProps) {
  const { data, isLoading } = useWidgetData();
  const stages: any[] = data?.pipelineFunnel?.stages ?? [];
  const total = stages.reduce((s: number, r: any) => s + Number(r.total_value ?? 0), 0);

  return (
    <ActionWidgetShell id="pipeline_funnel" icon={BarChart3} title="Pipeline Stage Funnel"
      compact={compact} isDragging={isDragging} dragProps={dragProps}>
      {isLoading && <Skeleton className="h-24" />}
      {!isLoading && stages.length === 0 && <EmptyState message="No open opportunities in the pipeline." />}
      {!isLoading && stages.map((s: any) => {
        const pct = total > 0 ? Math.round((Number(s.total_value) / total) * 100) : 0;
        return (
          <div key={s.stage} className="py-1" data-testid={`funnel-stage-${s.stage}`}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-xs font-medium">{STAGE_LABEL[s.stage] ?? s.stage}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{s.opp_count}</span>
                <span className="text-xs text-muted-foreground">{fmtMoney(s.total_value)}</span>
              </div>
            </div>
            <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
              <div className="h-full bg-primary/60 rounded-full" style={{ width: `${Math.max(pct, 4)}%` }} />
            </div>
          </div>
        );
      })}
      {!isLoading && total > 0 && (
        <p className="text-xs text-muted-foreground mt-2">Total: <span className="text-foreground font-medium">{fmtMoney(total)}</span></p>
      )}
    </ActionWidgetShell>
  );
}

// ── 13. Recent Wins ───────────────────────────────────────────────────────────

export function RecentWinsWidget({ compact, isDragging, dragProps }: WidgetProps) {
  const { data, isLoading } = useWidgetData();
  const wins: any[] = data?.recentWins?.items ?? [];
  const totalValue = data?.recentWins?.totalValue ?? 0;

  return (
    <ActionWidgetShell id="recent_wins" icon={Trophy} title="Recent Wins"
      count={wins.length} link="/pipeline" compact={compact} isDragging={isDragging} dragProps={dragProps}>
      {isLoading && <Skeleton className="h-20" />}
      {!isLoading && wins.length === 0 && <EmptyState message="No wins in the last 30 days yet — go close something!" />}
      {!isLoading && wins.length > 0 && (
        <>
          <div className="flex items-center gap-2 mb-2 mt-1">
            <Star className="h-4 w-4 text-amber-400" />
            <span className="text-sm font-bold text-amber-400">{fmtMoney(totalValue)}</span>
            <span className="text-xs text-muted-foreground">won this month</span>
          </div>
          {wins.slice(0, 5).map((w: any) => (
            <ItemRow key={w.id}
              title={w.title}
              subtitle={[w.account_name, w.owner_name].filter(Boolean).join(" · ")}
              right={fmtMoney(w.amount)}
              link="/pipeline"
              testId={`recent-win-${w.id}`}
            />
          ))}
        </>
      )}
    </ActionWidgetShell>
  );
}

// ── 14. Top Performers ────────────────────────────────────────────────────────

export function TopPerformersWidget({ compact, isDragging, dragProps }: WidgetProps) {
  const { data, isLoading } = useWidgetData();
  const performers: any[] = data?.topPerformers?.items ?? [];

  return (
    <ActionWidgetShell id="top_performers" icon={Star} title="Top Performers"
      compact={compact} isDragging={isDragging} dragProps={dragProps}>
      {isLoading && <Skeleton className="h-20" />}
      {!isLoading && performers.length === 0 && <EmptyState message="No completed tasks this month yet." />}
      {!isLoading && performers.slice(0, 6).map((p: any, i: number) => (
        <div key={p.user_id} className="flex items-center gap-2 py-1.5" data-testid={`performer-${p.user_id}`}>
          <span className={`text-sm font-bold w-5 ${i === 0 ? "text-amber-400" : i === 1 ? "text-zinc-400" : i === 2 ? "text-orange-600" : "text-muted-foreground"}`}>
            {i + 1}
          </span>
          <span className="flex-1 text-sm font-medium truncate">{p.user_name ?? "Unknown"}</span>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-emerald-400 border-emerald-400/30">
              {p.completed_this_month} done
            </Badge>
            <span className="text-xs text-muted-foreground">{p.open_count} open</span>
          </div>
        </div>
      ))}
    </ActionWidgetShell>
  );
}

// ── 15. Certification Status Summary ─────────────────────────────────────────

export function CertStatusSummaryWidget({ compact, isDragging, dragProps }: WidgetProps) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/executive/risk-alerts"],
    staleTime: 5 * 60 * 1000,
  });
  const certAlerts = data?.certTrackerAlerts ?? [];
  const certBlockers: any[] = data?.certificationBlockers ?? [];

  const combined = [...certAlerts.slice(0, 3), ...certBlockers.slice(0, 3)];

  return (
    <ActionWidgetShell id="cert_status_summary" icon={FlaskConical} title="Certification Status"
      count={combined.length} compact={compact} isDragging={isDragging} dragProps={dragProps}>
      {isLoading && <Skeleton className="h-20" />}
      {!isLoading && combined.length === 0 && <EmptyState message="No certification blockers or alerts." />}
      {!isLoading && certBlockers.slice(0, 4).map((b: any) => (
        <ItemRow key={b.id}
          title={b.title ?? b.project_name ?? `Cert ${b.id}`}
          subtitle={b.blocker_summary ?? b.reason ?? "Blocker"}
          severity="high"
          link="/projects"
          testId={`cert-status-${b.id}`}
        />
      ))}
      {!isLoading && certAlerts.length > 0 && certBlockers.length === 0 && (
        <div className="flex items-center gap-2 py-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          <span className="text-sm">{certAlerts.length} project{certAlerts.length > 1 ? "s" : ""} with active tracker alerts</span>
        </div>
      )}
    </ActionWidgetShell>
  );
}

// ── 16. Deal Velocity Tracker ─────────────────────────────────────────────────

export function DealVelocityWidget({ compact, isDragging, dragProps }: WidgetProps) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/executive/kpis"],
    staleTime: 5 * 60 * 1000,
  });

  const stalled   = Number(data?.pipeline?.stalledCount ?? 0);
  const totalOpps = Number(data?.pipeline?.totalOpps ?? 0);
  const closed    = Number(data?.pipeline?.closedWonCount ?? 0);
  const healthPct = totalOpps > 0 ? Math.round(((totalOpps - stalled) / totalOpps) * 100) : 100;

  return (
    <ActionWidgetShell id="deal_velocity" icon={Target} title="Deal Velocity"
      compact={compact} isDragging={isDragging} dragProps={dragProps}>
      {isLoading && <Skeleton className="h-16" />}
      {!isLoading && (
        <div className="space-y-3 mt-1">
          <div className="flex gap-4">
            <div className="text-center">
              <p className="text-xl font-bold text-foreground">{totalOpps}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Total Opps</p>
            </div>
            <div className="h-8 w-px bg-border/50" />
            <div className="text-center">
              <p className={`text-xl font-bold ${stalled > 0 ? "text-amber-400" : "text-emerald-400"}`}>{stalled}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Stalled</p>
            </div>
            <div className="h-8 w-px bg-border/50" />
            <div className="text-center">
              <p className="text-xl font-bold text-emerald-400">{closed}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Won</p>
            </div>
          </div>
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-[10px] text-muted-foreground uppercase">Pipeline Health</span>
              <span className={`text-[10px] font-medium ${healthPct >= 70 ? "text-emerald-400" : "text-amber-400"}`}>{healthPct}%</span>
            </div>
            <div className="h-2 bg-muted/50 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${healthPct >= 70 ? "bg-emerald-400" : "bg-amber-400"}`} style={{ width: `${healthPct}%` }} />
            </div>
          </div>
          {stalled > 0 && (
            <Link href="/pipeline">
              <button className="text-xs text-amber-400 hover:underline flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Review {stalled} stalled deal{stalled > 1 ? "s" : ""}
              </button>
            </Link>
          )}
        </div>
      )}
    </ActionWidgetShell>
  );
}

// ── 17. Unresponded Leads ─────────────────────────────────────────────────────

export function UnrespondedLeadsWidget({ compact, isDragging, dragProps }: WidgetProps) {
  const { data, isLoading } = useWidgetData();
  const items: any[] = data?.unrespondedLeads?.items ?? [];
  const count = data?.unrespondedLeads?.count ?? 0;

  return (
    <ActionWidgetShell id="unresponded_leads" icon={UserPlus} title="Unresponded Leads"
      count={count} link="/opportunities" compact={compact} isDragging={isDragging} dragProps={dragProps}>
      {isLoading && <Skeleton className="h-20" />}
      {!isLoading && count === 0 && <EmptyState message="All new leads have been contacted. Good job!" />}
      {!isLoading && items.slice(0, 5).map((l: any) => (
        <ItemRow key={l.id}
          title={l.lead_name ?? "Unknown"}
          subtitle={[l.company, l.source].filter(Boolean).join(" · ")}
          right={`${l.days_old}d old`}
          severity={Number(l.days_old) >= 7 ? "high" : "medium"}
          link="/opportunities"
          testId={`unresponded-lead-${l.id}`}
        />
      ))}
    </ActionWidgetShell>
  );
}

// ── 18. Renewal Countdown ─────────────────────────────────────────────────────

export function RenewalCountdownWidget({ compact, isDragging, dragProps }: WidgetProps) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/cs/dashboard"],
    staleTime: 5 * 60 * 1000,
  });

  const renewalValue = Number(data?.totalRenewalValue ?? 0);
  const count = Number(data?.renewalsThisMonth ?? 0);
  const atRisk = Number(data?.atRiskCount ?? 0);

  return (
    <ActionWidgetShell id="renewal_countdown" icon={RefreshCw} title="Renewal Countdown"
      count={count} link="/renewals" compact={compact} isDragging={isDragging} dragProps={dragProps}>
      {isLoading && <Skeleton className="h-20" />}
      {!isLoading && (
        <div className="space-y-2 mt-1">
          <div className="flex gap-4">
            <div className="text-center">
              <p className={`text-xl font-bold ${count > 0 ? "text-amber-400" : "text-emerald-400"}`}>{count}</p>
              <p className="text-[10px] text-muted-foreground uppercase">This Month</p>
            </div>
            <div className="h-8 w-px bg-border/50" />
            <div className="text-center">
              <p className={`text-xl font-bold ${atRisk > 0 ? "text-red-400" : "text-emerald-400"}`}>{atRisk}</p>
              <p className="text-[10px] text-muted-foreground uppercase">At Risk</p>
            </div>
            <div className="h-8 w-px bg-border/50" />
            <div className="text-center">
              <p className="text-xl font-bold text-foreground">{fmtMoney(renewalValue)}</p>
              <p className="text-[10px] text-muted-foreground uppercase">ARR Stake</p>
            </div>
          </div>
          {count === 0 && <p className="text-xs text-emerald-400">No renewals due this month.</p>}
          {count > 0 && (
            <Link href="/renewals">
              <button className="text-xs text-primary hover:underline flex items-center gap-1">
                View renewal accounts <ArrowRight className="h-3 w-3" />
              </button>
            </Link>
          )}
        </div>
      )}
    </ActionWidgetShell>
  );
}

// ── 19. Revenue Forecast Gap ──────────────────────────────────────────────────

export function ForecastGapWidget({ compact, isDragging, dragProps }: WidgetProps) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/executive/kpis"],
    staleTime: 5 * 60 * 1000,
  });

  const commit  = Number(data?.pipeline?.commitAmount  ?? 0);
  const bestCase= Number(data?.pipeline?.bestCaseAmount ?? 0);
  const wonMonth= Number(data?.pipeline?.wonThisMonth  ?? data?.wonThisMonth ?? 0);
  const weighted= Number(data?.pipeline?.weightedPipeline ?? 0);

  // Show commit vs best-case as a gauge
  const gap = bestCase > 0 ? Math.round((commit / bestCase) * 100) : 0;
  const color = gap >= 80 ? "text-emerald-400" : gap >= 50 ? "text-amber-400" : "text-red-400";

  return (
    <ActionWidgetShell id="forecast_gap" icon={TrendingDown} title="Revenue Forecast Gap"
      compact={compact} isDragging={isDragging} dragProps={dragProps}>
      {isLoading && <Skeleton className="h-16" />}
      {!isLoading && (
        <div className="space-y-3 mt-1">
          <div className="flex gap-3">
            <div>
              <p className="text-lg font-bold text-emerald-400">{fmtMoney(commit)}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Committed</p>
            </div>
            <div className="h-8 w-px bg-border/50" />
            <div>
              <p className="text-lg font-bold text-blue-400">{fmtMoney(bestCase)}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Best Case</p>
            </div>
            <div className="h-8 w-px bg-border/50" />
            <div>
              <p className="text-lg font-bold text-violet-400">{fmtMoney(weighted)}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Weighted</p>
            </div>
          </div>
          {bestCase > 0 && (
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-[10px] text-muted-foreground uppercase">Commit Coverage</span>
                <span className={`text-[10px] font-medium ${color}`}>{gap}%</span>
              </div>
              <div className="h-2 bg-muted/50 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${gap >= 80 ? "bg-emerald-400" : gap >= 50 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${Math.min(gap, 100)}%` }} />
              </div>
            </div>
          )}
        </div>
      )}
    </ActionWidgetShell>
  );
}

// ── 20. My Calendar ───────────────────────────────────────────────────────────
// The premium replacement for the old "Today's Meetings" widget lives in
// `client/src/components/widgets/my-calendar-widget.tsx`. It's wired to this
// registry under the same `todays_meetings` id so existing dashboard layouts
// and visibility prefs keep working without a migration.

// ── My Inbox & Team Inboxes (Mission Control) ────────────────────────────────

type InboxSummary = {
  myInbox: {
    userId: number;
    emailAddress: string | null;
    displayName: string | null;
    authStatus: string;
    awaitingReplyCount: number;
    recentInboundCount: number;
    accountCount: number;
    recent: Array<{
      id: number; subject: string | null; from_name: string | null; from_email: string | null;
      snippet: string | null; sent_at: string | null; gmail_thread_id: string;
      awaiting_reply_since: string | null;
    }>;
  };
  teamInboxes: Array<{
    accountId: number; userId: number; userName: string;
    emailAddress: string; displayName: string | null;
    isShared: boolean; authStatus: string; lastSyncAt: string | null;
    awaitingReplyCount: number; recentInboundCount: number;
  }>;
};

function useInboxSummary() {
  return useQuery<InboxSummary>({
    queryKey: ["/api/command-center/inbox-summary"],
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

export function MyInboxWidget({ compact, isDragging, dragProps }: WidgetProps) {
  const { data, isLoading } = useInboxSummary();
  const inbox = data?.myInbox;
  const recent = inbox?.recent ?? [];
  const notConnected = !inbox?.emailAddress || inbox.authStatus !== "active";

  return (
    <ActionWidgetShell
      id="my_inbox"
      icon={Mail}
      title="My Inbox"
      count={inbox?.awaitingReplyCount}
      link="/gmail"
      compact={compact}
      isDragging={isDragging}
      dragProps={dragProps}
    >
      {isLoading && <Skeleton className="h-20" />}

      {!isLoading && notConnected && (
        <Link href="/gmail">
          <div className="flex items-center justify-between gap-3 py-2 cursor-pointer hover:bg-muted/40 px-2 -mx-2 rounded-md transition-colors" data-testid="my-inbox-not-connected">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">No Gmail account connected.</p>
              <p className="text-xs text-muted-foreground/70 mt-0.5">Connect your inbox to see messages here.</p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </div>
        </Link>
      )}

      {!isLoading && !notConnected && (
        <>
          <Link href="/gmail">
            <div className="flex items-center justify-between gap-3 py-2 px-2 -mx-2 rounded-md hover:bg-muted/40 cursor-pointer transition-colors mb-1" data-testid="my-inbox-summary">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">{inbox.emailAddress}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs text-amber-400 font-medium" data-testid="text-my-inbox-awaiting">
                    {inbox.awaitingReplyCount} awaiting
                  </span>
                  <span className="text-xs text-muted-foreground" data-testid="text-my-inbox-recent">
                    {inbox.recentInboundCount} this week
                  </span>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </div>
          </Link>

          {recent.length === 0 && <EmptyState message="No recent inbound emails." />}

          {recent.slice(0, 4).map((m) => {
            const awaiting = !!m.awaiting_reply_since;
            const since = m.sent_at;
            const timeAgo = since
              ? formatDistanceToNow(new Date(since), { addSuffix: false })
              : "";
            return (
              <ItemRow
                key={m.id}
                title={m.subject || "(No subject)"}
                subtitle={m.from_name || m.from_email || undefined}
                right={timeAgo}
                severity={awaiting ? "medium" : "low"}
                link="/gmail"
                testId={`my-inbox-row-${m.id}`}
              />
            );
          })}
        </>
      )}
    </ActionWidgetShell>
  );
}

export function TeamInboxesWidget({ compact, isDragging, dragProps }: WidgetProps) {
  const { data, isLoading } = useInboxSummary();
  const team = data?.teamInboxes ?? [];
  const totalAwaiting = team.reduce((s, t) => s + (t.awaitingReplyCount || 0), 0);

  return (
    <ActionWidgetShell
      id="team_inboxes"
      icon={Users}
      title="Team Inboxes"
      count={totalAwaiting}
      link="/gmail"
      compact={compact}
      isDragging={isDragging}
      dragProps={dragProps}
    >
      {isLoading && <Skeleton className="h-20" />}
      {!isLoading && team.length === 0 && (
        <EmptyState message="No other team inboxes connected yet." />
      )}
      {!isLoading && team.slice(0, 6).map((t) => {
        const stale = t.authStatus !== "active";
        const subtitle = t.isShared
          ? `Shared inbox · ${t.userName}`
          : t.userName;
        return (
          <Link key={t.accountId} href="/gmail">
            <div
              className="flex items-center justify-between gap-3 py-1.5 px-2 -mx-2 rounded-md hover:bg-muted/40 cursor-pointer transition-colors group"
              data-testid={`team-inbox-row-${t.accountId}`}
            >
              <div className="flex items-start gap-2 min-w-0 flex-1">
                <div className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${
                  stale ? "bg-red-400" : t.awaitingReplyCount > 0 ? "bg-amber-400" : "bg-emerald-500"
                }`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{t.emailAddress}</p>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{subtitle}</p>
                </div>
              </div>
              <div className="flex flex-col items-end shrink-0">
                <span className={`text-xs font-medium whitespace-nowrap ${
                  t.awaitingReplyCount > 0 ? "text-amber-400" : "text-muted-foreground"
                }`}>
                  {t.awaitingReplyCount} awaiting
                </span>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap mt-0.5">
                  {t.recentInboundCount}/wk
                </span>
              </div>
            </div>
          </Link>
        );
      })}
    </ActionWidgetShell>
  );
}

// ── Widget type + registry ────────────────────────────────────────────────────

export type WidgetProps = {
  compact?: boolean;
  isDragging?: boolean;
  dragProps?: React.HTMLAttributes<HTMLDivElement>;
};

// Travel Calendar — wrapped to fit the draggable grid contract.
// The underlying TravelCalendarWidget is self-contained when no onOpenPlanner prop
// is passed (it manages its own dialog state).
export function TravelCalendarGridWidget(_props: WidgetProps) {
  return <_TravelCalendarWidget />;
}

// Leads Nearby — same self-contained pattern. The underlying widget mounts its
// own MarinasDayPlannerDialog when no onPlanDay prop is supplied, so it can
// participate in the draggable grid like every other widget instead of being
// pinned to the top of the role command center page.
export function LeadsNearbyGridWidget(_props: WidgetProps) {
  return <_LeadsMissionControlWidget />;
}

export const ACTION_WIDGET_MAP: Record<string, React.ComponentType<WidgetProps>> = {
  travel_calendar:        TravelCalendarGridWidget,
  leads_nearby:           LeadsNearbyGridWidget,
  today_critical_actions: TodayCriticalActionsWidget,
  inbox_priority_radar:   InboxPriorityRadarWidget,
  cert_watchtower:        CertWatchtowerWidget,
  deployment_pulse:       DeploymentPulseWidget,
  cash_pulse:             CashPulseWidget,
  team_load_balancer:     TeamLoadBalancerWidget,
  my_waiting_on:          MyWaitingOnWidget,
  ai_suggested_moves:     AISuggestedMovesWidget,
  quick_create_launcher:  QuickCreateLauncherWidget,
  board_pack_readiness:   BoardPackReadinessWidget,
  open_quotes_aging:      OpenQuotesAgingWidget,
  pipeline_funnel:        PipelineFunnelWidget,
  recent_wins:            RecentWinsWidget,
  top_performers:         TopPerformersWidget,
  cert_status_summary:    CertStatusSummaryWidget,
  deal_velocity:          DealVelocityWidget,
  unresponded_leads:      UnrespondedLeadsWidget,
  renewal_countdown:      RenewalCountdownWidget,
  forecast_gap:           ForecastGapWidget,
  todays_meetings:        MyCalendarWidget,
  my_inbox:               MyInboxWidget,
  team_inboxes:           TeamInboxesWidget,
  weather:                WeatherWidget,
  // Role-card widgets (migrated from CEOCommandCenter / CTOCommandCenter so they
  // participate in the draggable grid like every other widget).
  summary_bullets:        ExecutiveSnapshotWidget,
  pipeline_health:        PipelineHealthWidget,
  cert_blockers:          CertBlockersWidget,
  deployment_blockers:    DeploymentBlockersWidget,
  close_opps_score:       CloseLikelihoodDealsWidget,
  key_accounts:           KeyAccountsActionWidget,
};

// ── Drag-and-drop hook (native HTML5 DnD) ────────────────────────────────────

export function useDragOrder(
  initialOrder: string[],
  onReorder: (newOrder: string[]) => void,
) {
  const [order, setOrder] = useState<string[]>(initialOrder);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragItem = useRef<string | null>(null);
  const dragOver = useRef<string | null>(null);

  const updateOrder = useCallback((newOrder: string[]) => {
    setOrder(newOrder);
    onReorder(newOrder);
  }, [onReorder]);

  const getDragProps = useCallback((id: string): React.HTMLAttributes<HTMLDivElement> => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      dragItem.current = id;
      setDraggingId(id);
      e.dataTransfer.effectAllowed = "move";
    },
    onDragEnd: () => {
      if (dragItem.current && dragOver.current && dragItem.current !== dragOver.current) {
        setOrder(prev => {
          const next = [...prev];
          const fromIdx = next.indexOf(dragItem.current!);
          const toIdx   = next.indexOf(dragOver.current!);
          if (fromIdx === -1 || toIdx === -1) return prev;
          next.splice(fromIdx, 1);
          next.splice(toIdx, 0, dragItem.current!);
          onReorder(next);
          return next;
        });
      }
      dragItem.current = null;
      dragOver.current = null;
      setDraggingId(null);
    },
  }), [onReorder]);

  const getDropProps = useCallback((id: string): React.HTMLAttributes<HTMLDivElement> => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      dragOver.current = id;
    },
    onDragLeave: () => {
      if (dragOver.current === id) dragOver.current = null;
    },
  }), []);

  // Sync when initialOrder changes externally
  const syncOrder = useCallback((newInitial: string[]) => {
    setOrder(prev => {
      const merged = [
        ...prev.filter(id => newInitial.includes(id)),
        ...newInitial.filter(id => !prev.includes(id)),
      ];
      return merged;
    });
  }, []);

  return { order, setOrder, draggingId, getDragProps, getDropProps, syncOrder };
}

// ── Draggable Action Widgets Grid ─────────────────────────────────────────────

export function ActionWidgetsGrid({
  visible,
  widgetOrder,
  compact,
  onReorder,
}: {
  visible: Record<string, boolean>;
  widgetOrder: string[];
  compact?: boolean;
  onReorder: (newOrder: string[]) => void;
}) {
  const { order, draggingId, getDragProps, getDropProps } = useDragOrder(widgetOrder, onReorder);

  // Filter to only visible new widgets, in drag order
  const visibleOrdered = order.filter(id => visible[id] !== false && id in ACTION_WIDGET_MAP);

  if (visibleOrdered.length === 0) return null;

  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="action-widgets-grid">
      {visibleOrdered.map(id => {
        const WidgetComp = ACTION_WIDGET_MAP[id];
        if (!WidgetComp) return null;
        return (
          <div
            key={id}
            {...getDropProps(id)}
            className="relative"
            data-testid={`widget-slot-${id}`}
          >
            <WidgetComp
              compact={compact}
              isDragging={draggingId === id}
              dragProps={getDragProps(id)}
            />
          </div>
        );
      })}
    </div>
  );
}
