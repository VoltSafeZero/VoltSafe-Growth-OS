import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Brain, AlertTriangle, AlertCircle, CheckCircle, RefreshCcw, Loader2, ArrowRight, Target, Inbox, BarChart2, TrendingDown, TrendingUp, Clock, Users, Zap, ChevronRight, X, ListChecks, ShieldAlert, MailOpen, Megaphone,
} from "lucide-react";
import { InfoIcon as Info } from "@/components/icons/info-icon";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

// ── Types ─────────────────────────────────────────────────────────────────────

type AlertSeverity = "low" | "medium" | "high" | "critical";

type Signal = {
  type: string; severity: AlertSeverity; title: string; detail: string;
  suggestedMove: string; linkedObjectType?: string; linkedObjectId?: number;
};

type Radar = {
  gapStatus: string; gapPercent: number; committedRevenue: number; projectedRevenue: number;
  overdueTasks: number; criticalOverdue: number; newLeadsThisMonth: number;
  stalledDeals: number; stalledValue: number; awaitingReplyThreads: number;
  boardPackLastRunDays: number | null; openHighTickets: number;
};

type Brief = {
  briefDate: string; headline: string; summary: string;
  topSignals: Signal[]; radar: Radar; generatedAt: string;
};

type Alert = {
  id: number; type: string; severity: AlertSeverity; title: string;
  description: string; linked_object_type?: string; linked_object_id?: number;
  status: string; score: number; brief_date: string; suggested_move?: string;
  created_at: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(Math.abs(n)).toLocaleString()}`;
}

const SEV_CONFIG: Record<AlertSeverity, { label: string; bg: string; text: string; border: string; icon: any }> = {
  critical: { label: "Critical", bg: "bg-red-50 dark:bg-red-950/40", text: "text-red-700 dark:text-red-400", border: "border-red-200 dark:border-red-800", icon: AlertCircle },
  high: { label: "High", bg: "bg-orange-50 dark:bg-orange-950/40", text: "text-orange-700 dark:text-orange-400", border: "border-orange-200 dark:border-orange-800", icon: AlertTriangle },
  medium: { label: "Medium", bg: "bg-amber-50 dark:bg-amber-950/40", text: "text-amber-700 dark:text-amber-400", border: "border-amber-200 dark:border-amber-800", icon: Info },
  low: { label: "Low", bg: "bg-zinc-50 dark:bg-zinc-800/50", text: "text-zinc-500 dark:text-zinc-400", border: "border-zinc-200 dark:border-zinc-700", icon: Info },
};

const GAP_STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  on_track: { label: "On Track", color: "text-emerald-600 dark:text-emerald-400", icon: CheckCircle },
  at_risk: { label: "At Risk", color: "text-amber-600 dark:text-amber-400", icon: AlertTriangle },
  off_track: { label: "Off Track", color: "text-red-600 dark:text-red-400", icon: AlertCircle },
  no_commit: { label: "No Commit", color: "text-zinc-400", icon: Target },
};

const TYPE_ICON: Record<string, any> = {
  stalled_deal: TrendingDown,
  commit_off_track: BarChart2,
  critical_task_overdue: Clock,
  no_new_leads: Users,
  awaiting_reply: MailOpen,
  churn_risk: ShieldAlert,
  board_pack_stale: Megaphone,
  pipeline_drop: TrendingDown,
  expansion_idle: TrendingUp,
  open_ticket_high: AlertTriangle,
};

const OBJECT_LINKS: Record<string, string> = {
  opportunity: "/pipeline",
  task: "/tasks",
  revenue_commit: "/revenue-ops",
  lead: "/leads",
  account: "/accounts",
};

function SignalIcon({ type }: { type: string }) {
  const Icon = TYPE_ICON[type] ?? Zap;
  return <Icon className="w-4 h-4 flex-shrink-0" />;
}

// ── Radar Tile ────────────────────────────────────────────────────────────────

function RadarTile({ label, value, sub, icon: Icon, color = "text-zinc-800 dark:text-zinc-100", testId }: {
  label: string; value: string; sub?: string; icon: any; color?: string; testId: string;
}) {
  return (
    <div data-testid={testId} className="bg-card border border-border rounded-xl px-4 py-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
        <Icon className="w-3.5 h-3.5" />
        <span className="text-xs">{label}</span>
      </div>
      <p className={`text-xl font-bold tabular-nums leading-tight ${color}`}>{value}</p>
      {sub && <p className="text-xs text-zinc-400 dark:text-zinc-500">{sub}</p>}
    </div>
  );
}

// ── Signal Card ───────────────────────────────────────────────────────────────

function SignalCard({ signal, index, onDismiss, dismissPending }: {
  signal: Signal | Alert; index: number;
  onDismiss?: () => void; dismissPending?: boolean;
}) {
  const sev = ("severity" in signal ? signal.severity : "medium") as AlertSeverity;
  const cfg = SEV_CONFIG[sev];
  const Icon = cfg.icon;
  const title = signal.title;
  const detail = "detail" in signal ? signal.detail : (signal as Alert).description;
  const suggestedMove = "suggestedMove" in signal ? signal.suggestedMove : (signal as Alert).suggested_move;
  const linkedType = "linkedObjectType" in signal ? signal.linkedObjectType : (signal as Alert).linked_object_type;
  const linkedId = "linkedObjectId" in signal ? signal.linkedObjectId : (signal as Alert).linked_object_id;
  const signalType = "type" in signal ? signal.type : "";
  const linkUrl = linkedType ? OBJECT_LINKS[linkedType] : undefined;

  return (
    <div data-testid={`signal-card-${index}`} className={`border rounded-xl overflow-hidden ${cfg.bg} ${cfg.border}`}>
      <div className="px-5 py-4">
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 ${cfg.text}`}>
            <SignalIcon type={signalType} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <p className={`text-sm font-semibold ${cfg.text}`}>{title}</p>
              <Badge variant="outline" className={`text-[10px] h-4 px-1.5 ${cfg.text} ${cfg.border} ${cfg.bg}`}>
                {cfg.label}
              </Badge>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed mb-3">{detail}</p>
            {suggestedMove && (
              <div className="flex items-start gap-2 bg-card rounded-lg border border-border px-3 py-2">
                <Zap className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">{suggestedMove}</p>
              </div>
            )}
          </div>
          {onDismiss && (
            <button data-testid={`dismiss-alert-${index}`}
              onClick={onDismiss} disabled={dismissPending}
              className="text-zinc-300 hover:text-zinc-500 dark:text-zinc-600 dark:hover:text-zinc-400 transition-colors flex-shrink-0 mt-0.5">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      {(linkUrl || linkedId) && (
        <div className="px-5 py-2 border-t border-current border-opacity-10 flex justify-end">
          <Link href={linkUrl ?? "#"}>
            <a className={`text-xs font-medium flex items-center gap-1 ${cfg.text} hover:opacity-80 transition-opacity`}>
              Open record <ChevronRight className="w-3 h-3" />
            </a>
          </Link>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ExecutiveCopilotPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showAllAlerts, setShowAllAlerts] = useState(false);

  const { data: brief, isLoading: briefLoading } = useQuery<Brief>({
    queryKey: ["/api/executive/brief/today"],
  });

  const { data: alerts = [], isLoading: alertsLoading } = useQuery<Alert[]>({
    queryKey: ["/api/executive/alerts"],
  });

  const refreshMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/executive/brief/refresh", {}).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/executive/brief/today"] });
      qc.invalidateQueries({ queryKey: ["/api/executive/alerts"] });
      toast({ title: "Brief refreshed", description: "All signals re-scanned from live data." });
    },
    onError: (e: any) => toast({ title: "Refresh failed", description: e.message, variant: "destructive" }),
  });

  const dismissMut = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/executive/alerts/${id}`, { status: "dismissed" }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/executive/alerts"] }),
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const radar = brief?.radar;
  const signals = brief?.topSignals ?? [];
  const displayAlerts = showAllAlerts ? alerts : alerts.slice(0, 5);

  const gapConf = GAP_STATUS_CONFIG[radar?.gapStatus ?? "no_commit"];
  const GapIcon = gapConf.icon;

  const currentDate = new Date().toLocaleDateString("en-CA", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  return (
    <>
      <title>Executive Copilot — VoltSafe Growth OS</title>
      <div className="flex flex-col h-full overflow-hidden bg-background">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950">
              <Brain className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Executive Copilot</h1>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{currentDate}</p>
            </div>
          </div>
          <Button data-testid="button-refresh-brief" variant="outline" size="sm"
            onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending}>
            {refreshMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <RefreshCcw className="w-3.5 h-3.5 mr-1" />}
            {refreshMut.isPending ? "Refreshing…" : "Refresh Brief"}
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 pb-36 lg:pb-24 space-y-5">

          {/* ── Today's Brief ── */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border/40 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-indigo-500" />
                <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Today's Brief</span>
              </div>
              {brief?.generatedAt && (
                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                  Generated {new Date(brief.generatedAt).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </div>

            {briefLoading ? (
              <div className="flex items-center justify-center py-12 gap-2 text-zinc-400">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Scanning all systems…</span>
              </div>
            ) : !brief ? (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <Brain className="w-12 h-12 text-zinc-200 dark:text-zinc-700" />
                <div className="text-center">
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">No brief generated yet today</p>
                  <p className="text-xs text-zinc-400 mt-1">Click Refresh Brief to scan live data and build today's priorities.</p>
                </div>
                <Button data-testid="button-generate-brief" size="sm" onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending}>
                  {refreshMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Brain className="w-3.5 h-3.5 mr-1" />}
                  Generate Brief
                </Button>
              </div>
            ) : (
              <div className="px-5 py-5">
                <p data-testid="text-headline" className="text-base font-semibold text-zinc-800 dark:text-zinc-100 mb-2">{brief.headline}</p>
                <p data-testid="text-summary" className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">{brief.summary}</p>
              </div>
            )}
          </div>

          {/* ── Live Radar ── */}
          {radar && (
            <div>
              <h2 className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-3">Live Radar</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <RadarTile
                  testId="radar-gap"
                  label="Commit Status"
                  value={gapConf.label}
                  sub={radar.gapPercent !== 0 ? `${radar.gapPercent > 0 ? "+" : ""}${radar.gapPercent.toFixed(1)}%` : undefined}
                  icon={GapIcon}
                  color={gapConf.color}
                />
                <RadarTile
                  testId="radar-pipeline"
                  label="Stalled Deals"
                  value={String(radar.stalledDeals)}
                  sub={radar.stalledValue > 0 ? `${fmt(radar.stalledValue)} at risk` : undefined}
                  icon={TrendingDown}
                  color={radar.stalledDeals > 0 ? "text-red-600 dark:text-red-400" : "text-zinc-800 dark:text-zinc-100"}
                />
                <RadarTile
                  testId="radar-overdue"
                  label="Overdue Tasks"
                  value={String(radar.overdueTasks)}
                  sub={radar.criticalOverdue > 0 ? `${radar.criticalOverdue} critical` : undefined}
                  icon={Clock}
                  color={radar.criticalOverdue > 0 ? "text-red-600 dark:text-red-400" : radar.overdueTasks > 0 ? "text-amber-600 dark:text-amber-400" : "text-zinc-800 dark:text-zinc-100"}
                />
                <RadarTile
                  testId="radar-leads"
                  label="New Leads (MTD)"
                  value={String(radar.newLeadsThisMonth)}
                  sub={radar.newLeadsThisMonth === 0 ? "None this month" : undefined}
                  icon={Users}
                  color={radar.newLeadsThisMonth === 0 ? "text-red-600 dark:text-red-400" : "text-zinc-800 dark:text-zinc-100"}
                />
                <RadarTile
                  testId="radar-email"
                  label="Awaiting Reply"
                  value={String(radar.awaitingReplyThreads)}
                  sub={radar.awaitingReplyThreads > 0 ? ">48h old" : undefined}
                  icon={MailOpen}
                  color={radar.awaitingReplyThreads > 0 ? "text-amber-600 dark:text-amber-400" : "text-zinc-800 dark:text-zinc-100"}
                />
                <RadarTile
                  testId="radar-boardpack"
                  label="Board Pack Age"
                  value={radar.boardPackLastRunDays === null ? "Never" : `${radar.boardPackLastRunDays}d`}
                  sub={radar.boardPackLastRunDays !== null && radar.boardPackLastRunDays >= 7 ? "Stale" : undefined}
                  icon={Megaphone}
                  color={radar.boardPackLastRunDays === null || radar.boardPackLastRunDays >= 7 ? "text-amber-600 dark:text-amber-400" : "text-zinc-800 dark:text-zinc-100"}
                />
              </div>
            </div>
          )}

          {/* ── Top Priorities (from brief signals) ── */}
          {signals.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-3">
                Top Priorities
              </h2>
              <div className="space-y-3">
                {signals.map((s, i) => (
                  <SignalCard key={i} signal={s} index={i} />
                ))}
              </div>
            </div>
          )}

          {/* ── All Open Alerts ── */}
          {alerts.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                  All Open Alerts
                  <Badge variant="secondary" className="ml-2 text-xs">{alerts.length}</Badge>
                </h2>
                {alerts.length > 5 && (
                  <button onClick={() => setShowAllAlerts(p => !p)}
                    className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                    {showAllAlerts ? "Show less" : `Show all ${alerts.length}`}
                  </button>
                )}
              </div>
              <div className="space-y-3">
                {displayAlerts.map((a, i) => (
                  <SignalCard
                    key={a.id}
                    signal={a}
                    index={i}
                    onDismiss={() => dismissMut.mutate(a.id)}
                    dismissPending={dismissMut.isPending && dismissMut.variables === a.id}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── Quick Actions ── */}
          <div>
            <h2 className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-3">Quick Actions</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Revenue Ops", href: "/revenue-ops", icon: Target, testId: "quick-revenue-ops" },
                { label: "Board Pack", href: "/board-pack", icon: Megaphone, testId: "quick-board-pack" },
                { label: "Task Hub", href: "/tasks", icon: ListChecks, testId: "quick-tasks" },
                { label: "Inbox", href: "/inbox", icon: Inbox, testId: "quick-inbox" },
              ].map(action => (
                <Link key={action.href} href={action.href}>
                  <a data-testid={action.testId}
                    className="flex items-center gap-2 bg-card border border-border rounded-xl px-4 py-3 hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-950/20 transition-colors group">
                    <action.icon className="w-4 h-4 text-zinc-400 group-hover:text-indigo-500 transition-colors" />
                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{action.label}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600 group-hover:text-indigo-400 ml-auto transition-colors" />
                  </a>
                </Link>
              ))}
            </div>
          </div>

          {/* ── Empty state ── */}
          {!briefLoading && !brief && alerts.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
              <CheckCircle className="w-14 h-14 text-emerald-400" />
              <div>
                <p className="text-base font-semibold text-zinc-700 dark:text-zinc-200">All clear — nothing critical today</p>
                <p className="text-sm text-zinc-400 mt-1">Click Refresh Brief to run a fresh scan of all systems.</p>
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  );
}
