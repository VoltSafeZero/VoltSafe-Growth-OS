import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import {
  Target, TrendingUp, TrendingDown, CheckCircle, AlertTriangle, XCircle,
  Plus, ChevronDown, ChevronUp, Zap, ListChecks, RefreshCcw, Loader2,
  BarChart2, BadgeCheck, BookOpen, ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────

type GapStatus = "on_track" | "at_risk" | "off_track" | "no_commit";

type GapDriver = {
  type: string; label: string; impact: number; severity: string;
};

type GapToPlan = {
  monthKey: string; committedRevenue: number; actualRevenueToDate: number;
  forecastRevenueToDate: number; projectedMonthEndRevenue: number;
  gapAmount: number; gapPercent: number; status: GapStatus;
  daysInMonth: number; daysElapsed: number; paceRate: number;
  commitId: number | null; scenarioId: number | null; drivers: GapDriver[];
};

type GapClosureAction = {
  title: string; reason: string; priority: string;
  actionType: string; metricTarget?: number; metricUnit?: string; linkedObjectType?: string;
};

type PlanCommit = {
  id: number; name: string; scenario_id: number | null; month_key: string;
  committed_revenue: string; baseline_revenue: string; stretch_revenue: string | null;
  notes: string | null; status: string; committed_by: number | null;
  scenario_name?: string; created_at: string;
};

type GapSnapshot = {
  id: number; month_key: string; snapshot_date: string;
  committed_revenue: string; actual_revenue_to_date: string;
  forecast_revenue_to_date: string; projected_month_end_revenue: string;
  gap_amount: string; gap_percent: string;
};

type SavedScenario = {
  id: number; name: string; projection: { summary: { totalSimulated: number; totalBaseline: number } };
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(Math.abs(n)).toLocaleString()}`;
}

function num(v: string | number | undefined | null): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isNaN(n) ? 0 : n;
}

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

const STATUS_CONFIG: Record<GapStatus, { label: string; color: string; bg: string; Icon: any }> = {
  on_track: { label: "On Track", color: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800", Icon: CheckCircle },
  at_risk: { label: "At Risk", color: "text-amber-700 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800", Icon: AlertTriangle },
  off_track: { label: "Off Track", color: "text-red-700 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800", Icon: XCircle },
  no_commit: { label: "No Commit", color: "text-zinc-500", bg: "bg-zinc-50 dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-700", Icon: BarChart2 },
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: "text-red-700 bg-red-100 dark:bg-red-950/50 dark:text-red-400 border-red-200",
  high: "text-orange-700 bg-orange-100 dark:bg-orange-950/50 dark:text-orange-400 border-orange-200",
  medium: "text-amber-700 bg-amber-100 dark:bg-amber-950/50 dark:text-amber-400 border-amber-200",
  low: "text-emerald-700 bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-400 border-emerald-200",
};

const DRIVER_COLORS: Record<string, string> = {
  volume: "#6366f1", conversion: "#f59e0b", velocity: "#3b82f6",
  churn: "#ef4444", expansion: "#10b981",
};

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 text-xs shadow-lg min-w-[160px]">
      <p className="font-semibold text-zinc-700 dark:text-zinc-200 mb-2">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.color }} />
          <span className="text-zinc-500 dark:text-zinc-400 capitalize">{p.name}:</span>
          <span className="font-medium">{p.value >= 0 ? fmt(p.value) : `-${fmt(Math.abs(p.value))}`}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RevenueOpsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey());
  const [commitOpen, setCommitOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [commitsOpen, setCommitsOpen] = useState(true);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [creatingTaskFor, setCreatingTaskFor] = useState<GapClosureAction | null>(null);

  // Commit form state
  const [commitForm, setCommitForm] = useState({
    name: "", monthKey: currentMonthKey(), scenarioId: "",
    committedRevenue: "", baselineRevenue: "", stretchRevenue: "", notes: "", status: "active",
  });

  // ── Queries ──
  const { data: commits = [], isLoading: commitsLoading } = useQuery<PlanCommit[]>({
    queryKey: ["/api/revenue-ops/plan-commits"],
  });

  const { data: gap, isLoading: gapLoading } = useQuery<GapToPlan>({
    queryKey: ["/api/revenue-ops/gap", selectedMonth],
    queryFn: () => fetch(`/api/revenue-ops/gap/${selectedMonth}`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: gapActions, isLoading: actionsLoading } = useQuery<{ gap: GapToPlan; actions: GapClosureAction[] }>({
    queryKey: ["/api/revenue-ops/gap-actions", selectedMonth],
    queryFn: () => fetch(`/api/revenue-ops/gap/${selectedMonth}/actions`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" }).then(r => r.json()),
    enabled: actionsOpen,
  });

  const { data: history = [], isLoading: historyLoading } = useQuery<GapSnapshot[]>({
    queryKey: ["/api/revenue-ops/gap-history", selectedMonth],
    queryFn: () => fetch(`/api/revenue-ops/gap-history/${selectedMonth}`, { credentials: "include" }).then(r => r.json()),
    enabled: historyOpen,
  });

  const { data: scenarios = [] } = useQuery<SavedScenario[]>({
    queryKey: ["/api/revenue-sim/scenarios"],
  });

  // ── Mutations ──
  const createCommitMut = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/revenue-ops/plan-commits", body).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/revenue-ops/plan-commits"] });
      qc.invalidateQueries({ queryKey: ["/api/revenue-ops/gap", selectedMonth] });
      setCommitOpen(false);
      setCommitForm({ name: "", monthKey: currentMonthKey(), scenarioId: "", committedRevenue: "", baselineRevenue: "", stretchRevenue: "", notes: "", status: "active" });
      toast({ title: "Plan commit created" });
    },
    onError: (e: any) => toast({ title: "Failed to create commit", description: e.message, variant: "destructive" }),
  });

  const snapshotMut = useMutation({
    mutationFn: () => fetch(`/api/revenue-ops/gap/${selectedMonth}/snapshot`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/revenue-ops/gap-history", selectedMonth] });
      toast({ title: "Gap snapshot saved" });
    },
    onError: (e: any) => toast({ title: "Snapshot failed", description: e.message, variant: "destructive" }),
  });

  const createTaskMut = useMutation({
    mutationFn: (action: GapClosureAction) =>
      apiRequest("POST", "/api/revenue-ops/actions/0/create-task", {
        title: action.title, reason: action.reason, priority: action.priority,
        actionType: action.actionType, metricTarget: action.metricTarget,
        metricUnit: action.metricUnit, linkedObjectType: action.linkedObjectType,
        planCommitId: gap?.commitId,
      }).then(r => r.json()),
    onSuccess: (d: any) => {
      setCreatingTaskFor(null);
      toast({ title: d.duplicate ? "Task already exists" : "Task created", description: d.duplicate ? "This action is already a tracked task." : "Added to your task hub." });
    },
    onError: (e: any) => toast({ title: "Failed to create task", description: e.message, variant: "destructive" }),
  });

  const setActiveMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/revenue-ops/plan-commits/${id}/set-active`, {}).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/revenue-ops/plan-commits"] });
      qc.invalidateQueries({ queryKey: ["/api/revenue-ops/gap", selectedMonth] });
      toast({ title: "Commit activated" });
    },
    onError: (e: any) => toast({ title: "Failed to activate", description: e.message, variant: "destructive" }),
  });

  // One-click automation: generate + save all high/critical actions as tasks
  const oneClickMut = useMutation({
    mutationFn: async () => {
      if (!gapActions?.actions) return [];
      const highPriority = gapActions.actions.filter(a => a.priority === "high" || a.priority === "critical");
      const results = [];
      for (const action of highPriority) {
        const r = await apiRequest("POST", "/api/revenue-ops/actions/0/create-task", {
          title: action.title, reason: action.reason, priority: action.priority,
          actionType: action.actionType, metricTarget: action.metricTarget,
          metricUnit: action.metricUnit, linkedObjectType: action.linkedObjectType,
          planCommitId: gap?.commitId,
        }).then(r => r.json());
        results.push(r);
      }
      return results;
    },
    onSuccess: (results: any[]) => {
      const created = results.filter(r => r.created).length;
      const skipped = results.filter(r => r.duplicate).length;
      toast({ title: `${created} tasks created`, description: skipped > 0 ? `${skipped} already existed and were skipped.` : undefined });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const handleCreateCommit = useCallback(() => {
    const body: any = {
      name: commitForm.name,
      monthKey: commitForm.monthKey,
      committedRevenue: parseFloat(commitForm.committedRevenue) || 0,
      baselineRevenue: parseFloat(commitForm.baselineRevenue) || 0,
      status: commitForm.status,
    };
    if (commitForm.scenarioId) body.scenarioId = parseInt(commitForm.scenarioId);
    if (commitForm.stretchRevenue) body.stretchRevenue = parseFloat(commitForm.stretchRevenue);
    if (commitForm.notes) body.notes = commitForm.notes;
    createCommitMut.mutate(body);
  }, [commitForm, createCommitMut]);

  // Prefill commit form from a scenario
  const handlePrefillFromScenario = useCallback((scId: string) => {
    const sc = scenarios.find(s => s.id === parseInt(scId));
    if (!sc) return;
    const total = sc.projection?.summary?.totalSimulated ?? 0;
    const baseline = sc.projection?.summary?.totalBaseline ?? 0;
    const monthly = Math.round(total / 12);
    const baselineMonthly = Math.round(baseline / 12);
    setCommitForm(p => ({
      ...p, scenarioId: scId,
      committedRevenue: String(monthly),
      baselineRevenue: String(baselineMonthly),
      name: p.name || `${sc.name} — ${p.monthKey}`,
    }));
  }, [scenarios]);

  // Month options (current + next 5 months)
  const monthOptions = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() + i);
    return d.toISOString().slice(0, 7);
  });

  // History chart data
  const historyChartData = history.map(h => ({
    label: h.snapshot_date ? new Date(h.snapshot_date).toLocaleDateString("en-CA", { month: "short", day: "numeric" }) : "",
    "Gap": num(h.gap_amount),
    "Committed": num(h.committed_revenue),
    "Projected": num(h.projected_month_end_revenue),
  }));

  const status = gap?.status ?? "no_commit";
  const StatusConf = STATUS_CONFIG[status];
  const StatusIcon = StatusConf.Icon;

  const activeCommit = commits.find(c => c.month_key === selectedMonth && c.status === "active");

  return (
    <>
      <title>Revenue Ops — VoltSafe Growth OS</title>
      <div className="flex flex-col h-full overflow-hidden bg-zinc-50 dark:bg-zinc-950">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950">
              <Target className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Revenue Ops</h1>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Plan commits, gap tracking, and execution</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger data-testid="select-month" className="h-8 text-sm w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button data-testid="button-snapshot" variant="outline" size="sm" onClick={() => snapshotMut.mutate()} disabled={snapshotMut.isPending || !gap?.commitId}>
              <RefreshCcw className="w-3.5 h-3.5 mr-1" />{snapshotMut.isPending ? "Saving…" : "Snapshot"}
            </Button>
            <Button data-testid="button-new-commit" size="sm" onClick={() => setCommitOpen(true)}>
              <Plus className="w-3.5 h-3.5 mr-1" />New Commit
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 pb-36 md:pb-24 space-y-5">

          {/* ── Gap to Plan Scoreboard ── */}
          <div className={`border rounded-xl overflow-hidden ${StatusConf.bg}`}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-current border-opacity-10">
              <div className="flex items-center gap-2">
                <StatusIcon className={`w-5 h-5 ${StatusConf.color}`} />
                <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                  Gap to Plan — {selectedMonth}
                </span>
                <Badge className={`text-xs ${StatusConf.bg} ${StatusConf.color} border`} data-testid="badge-gap-status">
                  {StatusConf.label}
                </Badge>
              </div>
              {activeCommit && (
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Commit: <strong className="text-zinc-700 dark:text-zinc-200">{activeCommit.name}</strong>
                </span>
              )}
            </div>

            {gapLoading ? (
              <div className="flex items-center justify-center py-12 gap-2 text-zinc-400">
                <Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm">Computing gap…</span>
              </div>
            ) : gap?.status === "no_commit" ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3">
                <Target className="w-10 h-10 text-zinc-300 dark:text-zinc-600" />
                <p className="text-sm text-zinc-400 dark:text-zinc-500">No active plan commit for {selectedMonth}.</p>
                <Button variant="outline" size="sm" onClick={() => { setCommitForm(p => ({ ...p, monthKey: selectedMonth })); setCommitOpen(true); }}>
                  <Plus className="w-3.5 h-3.5 mr-1" />Create Monthly Commit
                </Button>
              </div>
            ) : gap ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 p-5">
                {[
                  { label: "Committed Target", value: fmt(gap.committedRevenue), testId: "card-committed" },
                  { label: "Actuals to Date", value: fmt(gap.actualRevenueToDate), testId: "card-actuals" },
                  { label: "Projected Month-End", value: fmt(gap.projectedMonthEndRevenue), testId: "card-projected" },
                  { label: "Gap Amount", value: gap.gapAmount >= 0 ? `+${fmt(gap.gapAmount)}` : `-${fmt(Math.abs(gap.gapAmount))}`, color: gap.gapAmount >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400", testId: "card-gap-amount" },
                  { label: "Gap %", value: `${gap.gapPercent >= 0 ? "+" : ""}${gap.gapPercent.toFixed(1)}%`, color: gap.gapPercent >= -5 ? "text-emerald-600 dark:text-emerald-400" : gap.gapPercent >= -15 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400", testId: "card-gap-pct" },
                  { label: "Days Elapsed", value: `${gap.daysElapsed}/${gap.daysInMonth}`, sub: `${Math.round(gap.paceRate * 100)}% of month`, testId: "card-days" },
                ].map(card => (
                  <div key={card.label} data-testid={card.testId} className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 px-4 py-3">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">{card.label}</p>
                    <p className={`text-xl font-bold tabular-nums ${(card as any).color ?? "text-zinc-900 dark:text-zinc-100"}`}>{card.value}</p>
                    {(card as any).sub && <p className="text-xs text-zinc-400 mt-0.5">{(card as any).sub}</p>}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* ── Gap Drivers ── */}
          {gap?.drivers && gap.drivers.length > 0 && (
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800">
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 flex items-center gap-2">
                  <TrendingDown className="w-4 h-4 text-zinc-400" />Gap Drivers
                </h3>
              </div>
              <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
                {gap.drivers.map(d => (
                  <div key={d.type} data-testid={`driver-${d.type}`}
                    className="rounded-lg border border-zinc-100 dark:border-zinc-800 p-3 flex flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: DRIVER_COLORS[d.type] ?? "#94a3b8" }} />
                      <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{d.label}</span>
                    </div>
                    <p className={`text-base font-bold tabular-nums ${d.impact < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                      {d.impact < 0 ? `-${fmt(Math.abs(d.impact))}` : `+${fmt(d.impact)}`}
                    </p>
                    <Badge variant="outline" className={`text-[10px] w-fit ${d.severity === "high" ? "text-red-600 border-red-200" : d.severity === "medium" ? "text-amber-600 border-amber-200" : "text-zinc-500"}`}>
                      {d.severity}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Recommended Actions ── */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
            <button data-testid="toggle-actions"
              className="w-full flex items-center justify-between px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
              onClick={() => setActionsOpen(p => !p)}>
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-zinc-500" />
                <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Gap-Closure Actions</span>
                {gapActions?.actions && <Badge variant="secondary" className="text-xs">{gapActions.actions.length}</Badge>}
              </div>
              {actionsOpen ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
            </button>

            {actionsOpen && (
              <div>
                {actionsLoading ? (
                  <div className="flex items-center justify-center py-8 gap-2 text-zinc-400">
                    <Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm">Generating actions…</span>
                  </div>
                ) : !gapActions?.actions?.length ? (
                  <div className="py-8 text-center text-sm text-zinc-400">No actions generated for {selectedMonth}.</div>
                ) : (
                  <>
                    {/* One-click automation */}
                    {gap?.status !== "no_commit" && gap?.status !== "on_track" && (
                      <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-indigo-50 dark:bg-indigo-950/30 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">One-click: save all high + critical actions as tasks</p>
                          <p className="text-xs text-indigo-500 dark:text-indigo-400 mt-0.5">
                            {gapActions.actions.filter(a => a.priority === "high" || a.priority === "critical").length} actions will be created in your task hub. Duplicates are skipped.
                          </p>
                        </div>
                        <Button data-testid="button-one-click-tasks" size="sm" onClick={() => oneClickMut.mutate()} disabled={oneClickMut.isPending}>
                          {oneClickMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Zap className="w-3.5 h-3.5 mr-1" />}
                          {oneClickMut.isPending ? "Creating…" : "Create Tasks"}
                        </Button>
                      </div>
                    )}
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {gapActions.actions.map((action, i) => (
                        <div key={i} data-testid={`action-row-${i}`}
                          className="flex items-start gap-4 px-5 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{action.title}</p>
                              <Badge variant="outline" className={`text-[10px] h-4 px-1.5 ${PRIORITY_COLORS[action.priority] ?? ""}`}>
                                {action.priority}
                              </Badge>
                              {action.metricTarget != null && (
                                <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-zinc-500">
                                  Target: {action.metricUnit === "dollars" ? fmt(action.metricTarget) : `${action.metricTarget} ${action.metricUnit ?? ""}`}
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-zinc-400 dark:text-zinc-500 leading-relaxed">{action.reason}</p>
                          </div>
                          <Button
                            data-testid={`button-create-task-${i}`}
                            variant="outline" size="sm" className="h-7 text-xs flex-shrink-0"
                            onClick={() => { setCreatingTaskFor(action); createTaskMut.mutate(action); }}
                            disabled={createTaskMut.isPending && creatingTaskFor === action}
                          >
                            {createTaskMut.isPending && creatingTaskFor === action
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <><ListChecks className="w-3 h-3 mr-1" />Create Task</>}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* ── Gap History Chart ── */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
            <button data-testid="toggle-history"
              className="w-full flex items-center justify-between px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
              onClick={() => setHistoryOpen(p => !p)}>
              <div className="flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-zinc-500" />
                <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Gap History</span>
                {history.length > 0 && <Badge variant="secondary" className="text-xs">{history.length} snapshots</Badge>}
              </div>
              {historyOpen ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
            </button>

            {historyOpen && (
              <div className="p-5">
                {historyLoading ? (
                  <div className="flex items-center justify-center py-8 gap-2 text-zinc-400">
                    <Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm">Loading…</span>
                  </div>
                ) : history.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
                    <BarChart2 className="w-10 h-10 text-zinc-300 dark:text-zinc-600" />
                    <p className="text-sm text-zinc-400 dark:text-zinc-500">No snapshots yet for {selectedMonth}.</p>
                    <p className="text-xs text-zinc-400">Click <strong>Snapshot</strong> to save the current gap state.</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={historyChartData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                      <defs>
                        <linearGradient id="gradCommitted" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="gradProjected" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.5} />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={v => fmt(v)} tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={55} />
                      <Tooltip content={<CustomTooltip />} />
                      <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                      <Area type="monotone" dataKey="Committed" stroke="#6366f1" fill="url(#gradCommitted)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                      <Area type="monotone" dataKey="Projected" stroke="#3b82f6" fill="url(#gradProjected)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                      <Area type="monotone" dataKey="Gap" stroke="#ef4444" fill="none" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            )}
          </div>

          {/* ── Saved Plan Commits ── */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
            <button data-testid="toggle-commits"
              className="w-full flex items-center justify-between px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
              onClick={() => setCommitsOpen(p => !p)}>
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-zinc-500" />
                <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Plan Commits</span>
                <Badge variant="secondary" className="text-xs">{commits.length}</Badge>
              </div>
              {commitsOpen ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
            </button>

            {commitsOpen && (
              <div>
                {commitsLoading ? (
                  <div className="px-5 py-8 text-center text-xs text-zinc-400">Loading…</div>
                ) : commits.length === 0 ? (
                  <div className="px-5 py-10 text-center">
                    <Target className="w-8 h-8 text-zinc-300 dark:text-zinc-600 mx-auto mb-2" />
                    <p className="text-sm text-zinc-400 dark:text-zinc-500">No plan commits yet.</p>
                    <p className="text-xs text-zinc-400 mt-1">Create a monthly commit to start tracking your gap.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-500 dark:text-zinc-400">
                          <th className="text-left px-5 py-2 font-medium">Name</th>
                          <th className="text-left px-4 py-2 font-medium">Month</th>
                          <th className="text-right px-4 py-2 font-medium">Committed</th>
                          <th className="text-right px-4 py-2 font-medium">Baseline</th>
                          <th className="text-right px-4 py-2 font-medium">Stretch</th>
                          <th className="text-left px-4 py-2 font-medium">Status</th>
                          <th className="px-4 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {commits.map(c => (
                          <tr key={c.id} data-testid={`commit-row-${c.id}`}
                            className={`border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors ${c.status === "active" ? "bg-indigo-50/30 dark:bg-indigo-950/10" : ""}`}>
                            <td className="px-5 py-2 font-medium text-zinc-800 dark:text-zinc-200 max-w-[200px] truncate">
                              <div className="flex items-center gap-1.5">
                                {c.status === "active" && <BadgeCheck className="w-3.5 h-3.5 text-indigo-600 flex-shrink-0" />}
                                {c.name}
                              </div>
                            </td>
                            <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400 tabular-nums">{c.month_key}</td>
                            <td className="px-4 py-2 text-right font-semibold text-zinc-800 dark:text-zinc-200 tabular-nums">{fmt(num(c.committed_revenue))}</td>
                            <td className="px-4 py-2 text-right text-zinc-500 dark:text-zinc-400 tabular-nums">{fmt(num(c.baseline_revenue))}</td>
                            <td className="px-4 py-2 text-right text-zinc-400 dark:text-zinc-500 tabular-nums">{c.stretch_revenue ? fmt(num(c.stretch_revenue)) : "—"}</td>
                            <td className="px-4 py-2">
                              <Badge variant="outline" className={`text-[10px] h-4 px-1.5 ${
                                c.status === "active" ? "text-indigo-600 border-indigo-300 bg-indigo-50 dark:bg-indigo-950" :
                                c.status === "superseded" ? "text-zinc-400" : "text-zinc-500"}`}>
                                {c.status}
                              </Badge>
                            </td>
                            <td className="px-4 py-2">
                              {c.status !== "active" && (
                                <Button
                                  data-testid={`button-set-active-${c.id}`}
                                  variant="ghost" size="sm" className="h-6 text-xs text-indigo-600 hover:text-indigo-700"
                                  onClick={() => setActiveMut.mutate(c.id)} disabled={setActiveMut.isPending}
                                >
                                  <ArrowRight className="w-3 h-3 mr-0.5" />Set Active
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── New Commit Dialog ── */}
      <Dialog open={commitOpen} onOpenChange={setCommitOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Target className="w-5 h-5 text-indigo-500" />Create Monthly Commit
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 block mb-1">Month <span className="text-red-500">*</span></label>
              <Select value={commitForm.monthKey} onValueChange={v => setCommitForm(p => ({ ...p, monthKey: v, name: p.name || v }))}>
                <SelectTrigger data-testid="select-commit-month" className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{monthOptions.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 block mb-1">Load from Scenario</label>
              <Select value={commitForm.scenarioId} onValueChange={v => { setCommitForm(p => ({ ...p, scenarioId: v })); handlePrefillFromScenario(v); }}>
                <SelectTrigger data-testid="select-commit-scenario" className="h-8 text-sm">
                  <SelectValue placeholder="Choose scenario (optional)…" />
                </SelectTrigger>
                <SelectContent>
                  {scenarios.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 block mb-1">Commit Name <span className="text-red-500">*</span></label>
              <Input data-testid="input-commit-name" value={commitForm.name} onChange={e => setCommitForm(p => ({ ...p, name: e.target.value }))} placeholder={`${commitForm.monthKey} Revenue Commit`} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 block mb-1">Committed Revenue <span className="text-red-500">*</span></label>
                <Input data-testid="input-committed-revenue" type="number" value={commitForm.committedRevenue} onChange={e => setCommitForm(p => ({ ...p, committedRevenue: e.target.value }))} placeholder="150000" />
              </div>
              <div>
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 block mb-1">Baseline Revenue</label>
                <Input data-testid="input-baseline-revenue" type="number" value={commitForm.baselineRevenue} onChange={e => setCommitForm(p => ({ ...p, baselineRevenue: e.target.value }))} placeholder="120000" />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 block mb-1">Stretch Target (optional)</label>
              <Input data-testid="input-stretch-revenue" type="number" value={commitForm.stretchRevenue} onChange={e => setCommitForm(p => ({ ...p, stretchRevenue: e.target.value }))} placeholder="180000" />
            </div>

            <div>
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 block mb-1">Status</label>
              <Select value={commitForm.status} onValueChange={v => setCommitForm(p => ({ ...p, status: v }))}>
                <SelectTrigger data-testid="select-commit-status" className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 block mb-1">Notes</label>
              <Textarea data-testid="input-commit-notes" value={commitForm.notes} onChange={e => setCommitForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional context…" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCommitOpen(false)}>Cancel</Button>
            <Button
              data-testid="button-confirm-commit"
              onClick={handleCreateCommit}
              disabled={!commitForm.name.trim() || !commitForm.committedRevenue || createCommitMut.isPending}
            >
              {createCommitMut.isPending ? "Creating…" : "Create Commit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
