import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  TrendingUp, DollarSign, Target, Users, Hammer, FileText,
  AlertTriangle, CheckCircle2, Clock, XCircle, Zap,
  RefreshCw, Filter, Maximize2, Minimize2, Trophy,
  ChevronRight, Building2, User, Calendar,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ExecKPIs {
  asOf: string;
  pipeline: {
    totalPipeline: number; weightedPipeline: number; commitAmount: number;
    bestCaseAmount: number; totalOpps: number; closedWonCount: number;
    closedWonAmount: number; stalledCount: number;
  };
  quotes: {
    total: number; sent: number; accepted: number; declined: number;
    expired: number; awaitingResponse: number; acceptedRevenue: number;
    avgAcceptedValue: number; winRate: number;
    acceptedMonth: number; acceptedRevenueMonth: number;
    acceptedQtr: number; acceptedRevenueQtr: number;
  };
  installs: {
    total: number; inProgress: number; pendingKickoff: number; complete: number;
    onHold: number; withBlockers: number; overdueInstalls: number;
    completedMonth: number; completedQtr: number;
  };
  leads: {
    total: number; converted: number; qualified: number; active: number;
    newThisMonth: number; convertedMonth: number; noOwner: number;
  };
  risks: {
    overdueTaskCount: number; stalledOpps: number; stalledAmount: number;
    installsWithBlockers: number; quotesAwaitingReply: number; leadsNoOwner: number;
  };
}

interface RiskAlerts {
  stalledOpps: any[];
  awaitingQuotes: any[];
  installBlockers: any[];
  overdueTasks: any[];
  dqRisks: any;
  unownedLeads: any[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtAmt(n: number) {
  if (!n) return "$0";
  if (n >= 1_000_000) return `$${(n/1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n/1_000).toFixed(0)}k`;
  return `$${Math.round(n)}`;
}
function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function pct(n: number) { return `${Math.round(n)}%`; }

const RISK_COLORS = { low: "text-emerald-400", medium: "text-amber-400", high: "text-red-400" };
const PIE_COLORS = ["#06b6d4","#10b981","#8b5cf6","#f59e0b","#3b82f6","#6b7280"];

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({
  label, value, sub, color, icon: Icon, trend, board,
}: { label: string; value: string | number; sub?: string; color?: string; icon: any; trend?: string; board?: boolean }) {
  return (
    <Card className="border border-border/50" data-testid={`kpi-${label.toLowerCase().replace(/\s/g,"-")}`}>
      <CardContent className={board ? "p-4" : "p-3"}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground font-medium">{label}</span>
          <Icon className={`h-3.5 w-3.5 ${color ?? "text-muted-foreground"}`} />
        </div>
        <div className={`font-bold tabular-nums ${board ? "text-3xl" : "text-2xl"} ${color ?? ""}`}>{value}</div>
        {sub   && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
        {trend && <div className="text-xs text-emerald-400 mt-0.5">{trend}</div>}
      </CardContent>
    </Card>
  );
}

// ── Risk Chip ─────────────────────────────────────────────────────────────────
function RiskChip({ count, label, level = "medium" }: { count: number; label: string; level?: "low"|"medium"|"high" }) {
  if (count === 0) return null;
  const color = level === "high" ? "border-red-500/40 bg-red-500/10 text-red-400"
              : level === "medium" ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400";
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${color}`}>
      <AlertTriangle className="h-3 w-3" /> {count} {label}
    </span>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ExecutiveDashboardPage() {
  const [boardMode, setBoardMode] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo,   setDateTo]   = useState("");
  const [ownerId,  setOwnerId]  = useState("all");
  const [activeTab, setActiveTab] = useState("overview");

  const { data: users } = useQuery<any[]>({ queryKey: ["/api/users"] });

  function buildParams() {
    const p: Record<string,string> = {};
    if (dateFrom) p.dateFrom = dateFrom;
    if (dateTo)   p.dateTo   = dateTo;
    if (ownerId && ownerId !== "all") p.ownerId = ownerId;
    return new URLSearchParams(p).toString();
  }
  const params = buildParams();

  const { data: kpis, isLoading: kpiLoading } = useQuery<ExecKPIs>({
    queryKey: ["/api/executive/kpis", params],
    queryFn: () => fetch(`/api/executive/kpis?${params}`, { credentials: "include" }).then(r => r.json()),
    staleTime: 60_000,
  });

  const { data: risks, isLoading: riskLoading } = useQuery<RiskAlerts>({
    queryKey: ["/api/executive/risk-alerts", params],
    queryFn: () => fetch(`/api/executive/risk-alerts?${params}`, { credentials: "include" }).then(r => r.json()),
    staleTime: 60_000,
  });

  const { data: forecast } = useQuery<any>({
    queryKey: ["/api/pipeline/forecast", params],
    queryFn: () => fetch(`/api/pipeline/forecast?months=6${ownerId !== "all" ? `&ownerId=${ownerId}` : ""}`, { credentials: "include" }).then(r => r.json()),
    staleTime: 60_000,
  });

  const { data: sourceSummary } = useQuery<any>({
    queryKey: ["/api/analytics/source-attribution/summary", params],
    queryFn: () => fetch(`/api/analytics/source-attribution/summary?${params}`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: sourceData } = useQuery<any>({
    queryKey: ["/api/analytics/source-attribution", params],
    queryFn: () => fetch(`/api/analytics/source-attribution?${params}`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: repPerf } = useQuery<any>({
    queryKey: ["/api/pipeline/rep-performance"],
    queryFn: () => fetch("/api/pipeline/rep-performance", { credentials: "include" }).then(r => r.json()),
  });

  const forecastPeriods = useMemo(() => (forecast?.periods ?? []).slice(0, 6).reverse(), [forecast]);
  const sourceRows = useMemo(() => (sourceData?.data ?? []).slice(0, 6), [sourceData]);
  const repRows    = useMemo(() => [...(repPerf?.data ?? [])].sort((a: any, b: any) => b.closedWonAmount - a.closedWonAmount).slice(0, 8), [repPerf]);

  const totalRisks = kpis ? (
    kpis.risks.overdueTaskCount + kpis.risks.stalledOpps +
    kpis.risks.installsWithBlockers + kpis.risks.quotesAwaitingReply + kpis.risks.leadsNoOwner
  ) : 0;

  const installPieData = kpis ? [
    { name: "In Progress",  value: kpis.installs.inProgress,     fill: "#06b6d4" },
    { name: "Pending",      value: kpis.installs.pendingKickoff, fill: "#6b7280" },
    { name: "Complete",     value: kpis.installs.complete,        fill: "#10b981" },
    { name: "On Hold",      value: kpis.installs.onHold,          fill: "#f59e0b" },
  ].filter(d => d.value > 0) : [];

  return (
    <div className={`flex-1 overflow-auto bg-background p-6 space-y-5 ${boardMode ? "print:p-4" : ""}`}>
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" data-testid="page-title">
            <Trophy className="h-5 w-5 text-primary" />
            Executive Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Leadership cockpit — pipeline, revenue, delivery, and risk at a glance.
            {kpis && <span className="text-xs text-muted-foreground/60 ml-2">As of {new Date(kpis.asOf).toLocaleTimeString()}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {totalRisks > 0 && (
            <span className="text-xs px-2 py-1 rounded-full border border-red-500/40 bg-red-500/10 text-red-400 font-medium" data-testid="risk-badge">
              <AlertTriangle className="h-3 w-3 inline mr-1" />{totalRisks} risks
            </span>
          )}
          <Button variant={boardMode ? "default" : "outline"} size="sm" onClick={() => setBoardMode(b => !b)} data-testid="btn-board-mode">
            {boardMode ? <><Minimize2 className="h-3.5 w-3.5 mr-1" />Exit Board</>
                       : <><Maximize2 className="h-3.5 w-3.5 mr-1" />Board Mode</>}
          </Button>
        </div>
      </div>

      {/* Filters — hidden in board mode */}
      {!boardMode && (
        <div className="flex flex-wrap gap-2 items-center p-3 rounded-lg bg-muted/30 border border-border/40">
          <Filter className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-8 w-36 text-xs" data-testid="filter-date-from" />
          <span className="text-xs text-muted-foreground">–</span>
          <Input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   className="h-8 w-36 text-xs" data-testid="filter-date-to" />
          <Select value={ownerId} onValueChange={setOwnerId}>
            <SelectTrigger className="h-8 w-36 text-xs" data-testid="filter-owner">
              <SelectValue placeholder="All Reps" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Reps</SelectItem>
              {(users ?? []).map((u: any) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {(dateFrom || dateTo || ownerId !== "all") && (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setDateFrom(""); setDateTo(""); setOwnerId("all"); }}>
              <RefreshCw className="h-3 w-3 mr-1" /> Clear
            </Button>
          )}
        </div>
      )}

      {/* KPI Cards — top row */}
      {kpiLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {[...Array(12)].map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : kpis && (
        <>
          {/* Row 1: Pipeline */}
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" /> Pipeline
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard label="Total Pipeline"    value={fmtAmt(kpis.pipeline.totalPipeline)}    icon={DollarSign} color="text-primary" board={boardMode} />
              <KpiCard label="Weighted Forecast" value={fmtAmt(kpis.pipeline.weightedPipeline)} icon={Target} board={boardMode}
                sub={`Commit: ${fmtAmt(kpis.pipeline.commitAmount)}`} />
              <KpiCard label="Open Opportunities" value={kpis.pipeline.totalOpps} icon={Target} board={boardMode}
                sub={`${kpis.pipeline.stalledCount} stalled`} color={kpis.pipeline.stalledCount > 5 ? "text-amber-400" : undefined} />
              <KpiCard label="Closed Won" value={fmtAmt(kpis.pipeline.closedWonAmount)} icon={Trophy} color="text-emerald-400" board={boardMode}
                sub={`${kpis.pipeline.closedWonCount} deals`} />
            </div>
          </div>

          {/* Row 2: Revenue */}
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Quotes & Revenue
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              <KpiCard label="Accepted Revenue"    value={fmtAmt(kpis.quotes.acceptedRevenue)} color="text-emerald-400" icon={DollarSign} board={boardMode} />
              <KpiCard label="Revenue This Month"  value={fmtAmt(kpis.quotes.acceptedRevenueMonth)} icon={Calendar} board={boardMode} />
              <KpiCard label="Revenue This Quarter" value={fmtAmt(kpis.quotes.acceptedRevenueQtr)} icon={Calendar} board={boardMode} />
              <KpiCard label="Win Rate"            value={pct(kpis.quotes.winRate)} icon={Trophy}
                color={kpis.quotes.winRate >= 40 ? "text-emerald-400" : kpis.quotes.winRate >= 20 ? "text-amber-400" : "text-red-400"} board={boardMode} />
              <KpiCard label="Avg Deal Value"      value={fmtAmt(kpis.quotes.avgAcceptedValue)} icon={DollarSign} board={boardMode} />
              <KpiCard label="Awaiting Response"   value={kpis.quotes.awaitingResponse} icon={Clock}
                color={kpis.quotes.awaitingResponse > 5 ? "text-amber-400" : undefined} board={boardMode}
                sub={`${kpis.quotes.sent} sent total`} />
            </div>
          </div>

          {/* Row 3: Installs + Leads */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Hammer className="h-3.5 w-3.5" /> Install & Delivery
              </div>
              <div className="grid grid-cols-2 gap-3">
                <KpiCard label="In Progress" value={kpis.installs.inProgress} icon={RefreshCw} color="text-blue-400" board={boardMode} />
                <KpiCard label="Completed (Qtr)" value={kpis.installs.completedQtr} icon={CheckCircle2} color="text-emerald-400" board={boardMode}
                  sub={`${kpis.installs.completedMonth} this month`} />
                <KpiCard label="With Blockers" value={kpis.installs.withBlockers} icon={AlertTriangle}
                  color={kpis.installs.withBlockers > 0 ? "text-amber-400" : undefined} board={boardMode} />
                <KpiCard label="Overdue" value={kpis.installs.overdueInstalls} icon={XCircle}
                  color={kpis.installs.overdueInstalls > 0 ? "text-red-400" : undefined} board={boardMode} />
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" /> Lead Funnel
              </div>
              <div className="grid grid-cols-2 gap-3">
                <KpiCard label="Total Leads"    value={kpis.leads.total.toLocaleString()} icon={Users} board={boardMode} />
                <KpiCard label="New This Month" value={kpis.leads.newThisMonth} icon={Zap} board={boardMode} />
                <KpiCard label="Converted"      value={kpis.leads.converted.toLocaleString()} icon={CheckCircle2} color="text-emerald-400" board={boardMode} />
                <KpiCard label="No Owner"       value={kpis.leads.noOwner} icon={User}
                  color={kpis.leads.noOwner > 10 ? "text-amber-400" : undefined} board={boardMode} />
              </div>
            </div>
          </div>
        </>
      )}

      {/* Risk Alerts Banner */}
      {!kpiLoading && kpis && totalRisks > 0 && (
        <div className="flex items-center gap-2 flex-wrap p-3 rounded-lg bg-red-500/5 border border-red-500/20" data-testid="risk-alert-banner">
          <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0" />
          <span className="text-xs font-semibold text-red-400">Attention Required:</span>
          <RiskChip count={kpis.risks.stalledOpps}         label="stalled opps" level="high" />
          <RiskChip count={kpis.risks.quotesAwaitingReply} label="quotes aging"  level="high" />
          <RiskChip count={kpis.risks.installsWithBlockers}label="install blockers" level="medium" />
          <RiskChip count={kpis.risks.overdueTaskCount}    label="overdue tasks" level="medium" />
          <RiskChip count={kpis.risks.leadsNoOwner}        label="unowned leads" level="medium" />
        </div>
      )}

      {/* Tabs: Charts + Detail Views */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-8 bg-muted/40 p-1 gap-1 flex-wrap">
          <TabsTrigger value="overview"  className="text-xs h-6" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="forecast"  className="text-xs h-6" data-testid="tab-forecast">Forecast</TabsTrigger>
          <TabsTrigger value="source"    className="text-xs h-6" data-testid="tab-source">Source Attribution</TabsTrigger>
          <TabsTrigger value="installs"  className="text-xs h-6" data-testid="tab-installs">Installs</TabsTrigger>
          <TabsTrigger value="reps"      className="text-xs h-6" data-testid="tab-reps">Rep Leaderboard</TabsTrigger>
          <TabsTrigger value="risks"     className="text-xs h-6" data-testid="tab-risks">
            Risks {totalRisks > 0 && <Badge className="ml-1 text-[9px] px-1 py-0 bg-red-500 text-white">{totalRisks}</Badge>}
          </TabsTrigger>
        </TabsList>

        {/* ── Overview tab ─────────────────────────────────────────────────── */}
        <TabsContent value="overview" className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Pipeline Forecast mini-chart */}
          <Card className="border border-border/50">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4" />6-Month Forecast</CardTitle>
            </CardHeader>
            <CardContent className="pb-4 px-4">
              {!forecastPeriods.length ? <Skeleton className="h-40" /> : (
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={forecastPeriods} margin={{ left: 0, right: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                    <XAxis dataKey="month" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => fmtAmt(v)} />
                    <Tooltip formatter={(v: any) => fmtAmt(v)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: 10 }} />
                    <Bar dataKey="commit"     name="Commit"     fill="#10b981" stackId="a" radius={[0,0,0,0]} />
                    <Bar dataKey="best_case"  name="Best Case"  fill="#06b6d4" stackId="a" />
                    <Bar dataKey="pipeline"   name="Pipeline"   fill="#3b82f6" stackId="a" radius={[3,3,0,0]} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Source attribution mini */}
          <Card className="border border-border/50">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm flex items-center gap-2"><Users className="h-4 w-4" />Lead Sources</CardTitle>
            </CardHeader>
            <CardContent className="pb-4 px-4">
              {!sourceRows.length ? <Skeleton className="h-40" /> : (
                <div className="space-y-1.5">
                  {sourceRows.map((r: any) => (
                    <div key={r.bucket} className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-28 truncate flex-shrink-0">{r.label}</span>
                      <div className="flex-1 h-1.5 bg-muted/40 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (r.totalLeads / Math.max(...sourceRows.map((x: any) => x.totalLeads))) * 100)}%` }} />
                      </div>
                      <span className="text-xs tabular-nums w-10 text-right">{r.totalLeads.toLocaleString()}</span>
                      <span className={`text-xs tabular-nums w-10 text-right ${r.winRate >= 40 ? "text-emerald-400" : r.winRate >= 20 ? "text-amber-400" : "text-muted-foreground"}`}>{r.winRate}%</span>
                    </div>
                  ))}
                  <div className="flex text-[10px] text-muted-foreground mt-1 gap-2">
                    <span className="w-28" />
                    <span className="flex-1 text-center">Volume</span>
                    <span className="w-10 text-right">Leads</span>
                    <span className="w-10 text-right">Win%</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Forecast tab ─────────────────────────────────────────────────── */}
        <TabsContent value="forecast" className="mt-3">
          <Card className="border border-border/50">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm">6-Month Revenue Forecast</CardTitle>
              {forecast?.summary && (
                <div className="flex gap-4 text-xs text-muted-foreground mt-1 flex-wrap">
                  <span>Commit: <span className="text-emerald-400 font-medium">{fmtAmt(forecast.summary.totalCommit ?? 0)}</span></span>
                  <span>Best Case: <span className="text-cyan-400 font-medium">{fmtAmt(forecast.summary.totalBestCase ?? 0)}</span></span>
                  <span>Pipeline: <span className="text-blue-400 font-medium">{fmtAmt(forecast.summary.totalAmount ?? 0)}</span></span>
                </div>
              )}
            </CardHeader>
            <CardContent className="pb-4 px-4">
              {!forecastPeriods.length ? <Skeleton className="h-60" /> : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={forecastPeriods} margin={{ left: 10, right: 10, top: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => fmtAmt(v)} />
                    <Tooltip formatter={(v: any) => fmtAmt(v)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: 11 }} />
                    <Bar dataKey="commit"     name="Commit"     fill="#10b981" stackId="a" />
                    <Bar dataKey="best_case"  name="Best Case"  fill="#06b6d4" stackId="a" />
                    <Bar dataKey="pipeline"   name="Pipeline"   fill="#3b82f6" stackId="a" radius={[3,3,0,0]} />
                    <Bar dataKey="closed_won" name="Closed Won" fill="#8b5cf6" />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Source tab ───────────────────────────────────────────────────── */}
        <TabsContent value="source" className="mt-3 space-y-3">
          {sourceSummary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Total Leads",   value: sourceSummary.totalLeads?.toLocaleString(), icon: Users },
                { label: "Qualify Rate",  value: pct(sourceSummary.qualifyRate),  icon: TrendingUp },
                { label: "Win Rate",      value: pct(sourceSummary.winRate),       icon: Trophy, color: "text-emerald-400" },
                { label: "Total Revenue", value: fmtAmt(sourceSummary.totalWonRevenue), icon: DollarSign, color: "text-emerald-400" },
              ].map(k => <KpiCard key={k.label} {...k} board={boardMode} />)}
            </div>
          )}
          <Card className="border border-border/50">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm">Source → Win Rate → Revenue</CardTitle>
            </CardHeader>
            <CardContent className="pb-4 px-4 overflow-x-auto">
              {!sourceRows.length ? <Skeleton className="h-48" /> : (
                <table className="w-full text-xs" data-testid="source-table">
                  <thead>
                    <tr className="border-b border-border/40">
                      <th className="text-left py-1.5 pr-3 text-muted-foreground font-medium">Source</th>
                      <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Leads</th>
                      <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Qualified</th>
                      <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Won</th>
                      <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Win %</th>
                      <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourceRows.map((r: any) => (
                      <tr key={r.bucket} className="border-b border-border/20 hover:bg-muted/10" data-testid={`source-row-${r.bucket}`}>
                        <td className="py-1.5 pr-3 font-medium">{r.label}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{r.totalLeads.toLocaleString()}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{r.convertedLeads.toLocaleString()}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{r.won.toLocaleString()}</td>
                        <td className={`py-1.5 px-2 text-right tabular-nums ${r.winRate >= 40 ? "text-emerald-400" : r.winRate >= 20 ? "text-amber-400" : "text-red-400"}`}>{r.winRate}%</td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-emerald-400">{r.totalWonValue > 0 ? fmtAmt(r.totalWonValue) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Installs tab ─────────────────────────────────────────────────── */}
        <TabsContent value="installs" className="mt-3 space-y-3">
          {kpis && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {installPieData.length > 0 && (
                <Card className="border border-border/50">
                  <CardHeader className="pb-2 pt-4 px-4"><CardTitle className="text-sm">Install Status Breakdown</CardTitle></CardHeader>
                  <CardContent className="pb-4 px-4 flex justify-center">
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={installPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value">
                          {installPieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                        </Pie>
                        <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: 11 }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}
              <Card className="border border-border/50">
                <CardHeader className="pb-2 pt-4 px-4"><CardTitle className="text-sm">Delivery KPIs</CardTitle></CardHeader>
                <CardContent className="pb-4 px-4">
                  {[
                    { label: "Total Workflows",     value: kpis.installs.total },
                    { label: "In Progress",         value: kpis.installs.inProgress },
                    { label: "Pending Kickoff",     value: kpis.installs.pendingKickoff },
                    { label: "Completed (Qtr)",     value: kpis.installs.completedQtr },
                    { label: "Completed (Month)",   value: kpis.installs.completedMonth },
                    { label: "With Blockers",       value: kpis.installs.withBlockers,   alert: kpis.installs.withBlockers > 0 },
                    { label: "Overdue",             value: kpis.installs.overdueInstalls, alert: kpis.installs.overdueInstalls > 0 },
                  ].map(r => (
                    <div key={r.label} className="flex justify-between py-1.5 border-b border-border/20 text-sm" data-testid={`install-kpi-${r.label}`}>
                      <span className="text-muted-foreground">{r.label}</span>
                      <span className={`font-semibold tabular-nums ${r.alert ? "text-amber-400" : ""}`}>{r.value}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* ── Rep Leaderboard tab ───────────────────────────────────────────── */}
        <TabsContent value="reps" className="mt-3">
          <Card className="border border-border/50">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm flex items-center gap-2"><Trophy className="h-4 w-4 text-amber-400" />Rep Performance</CardTitle>
            </CardHeader>
            <CardContent className="pb-4 px-4 overflow-x-auto">
              {!repRows.length ? <Skeleton className="h-48" /> : (
                <table className="w-full text-xs" data-testid="rep-table">
                  <thead>
                    <tr className="border-b border-border/40">
                      {["Rep","Open Opps","Win Rate","Avg Cycle","Stale","Closed Won $","Activity 7d"].map(h => (
                        <th key={h} className={`py-1.5 px-2 text-muted-foreground font-medium ${h === "Rep" ? "text-left" : "text-right"}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {repRows.map((r: any, i: number) => (
                      <tr key={r.repName ?? i} className="border-b border-border/20 hover:bg-muted/10" data-testid={`rep-row-${i}`}>
                        <td className="py-1.5 px-2 font-medium flex items-center gap-1.5">
                          {i === 0 && <Trophy className="h-3 w-3 text-amber-400" />}
                          {r.repName ?? "Unassigned"}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{r.openOpps ?? "—"}</td>
                        <td className={`py-1.5 px-2 text-right tabular-nums ${(r.winRate ?? 0) >= 40 ? "text-emerald-400" : (r.winRate ?? 0) >= 20 ? "text-amber-400" : "text-muted-foreground"}`}>
                          {r.winRate != null ? pct(r.winRate) : "—"}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">
                          {r.avgCycleDays ? `${Math.round(r.avgCycleDays)}d` : "—"}
                        </td>
                        <td className={`py-1.5 px-2 text-right tabular-nums ${(r.staleCount ?? 0) > 3 ? "text-amber-400" : ""}`}>{r.staleCount ?? 0}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-emerald-400">
                          {r.closedWonAmount ? fmtAmt(r.closedWonAmount) : "—"}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{r.activitiesLast7d ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Risks tab ────────────────────────────────────────────────────── */}
        <TabsContent value="risks" className="mt-3 space-y-3">
          {riskLoading ? <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}</div> : risks && (
            <>
              {/* Stalled Opps */}
              {risks.stalledOpps.length > 0 && (
                <Card className="border border-amber-500/30 bg-amber-500/5">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm flex items-center gap-2 text-amber-400">
                      <AlertTriangle className="h-4 w-4" />Stalled Opportunities ({risks.stalledOpps.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pb-4 px-4">
                    <div className="space-y-1">
                      {risks.stalledOpps.map((r: any) => (
                        <div key={r.id} className="flex items-center justify-between text-xs py-1 border-b border-border/20" data-testid={`stalled-opp-${r.id}`}>
                          <div className="flex items-center gap-2 min-w-0">
                            <Building2 className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                            <span className="truncate font-medium">{r.title}</span>
                            <span className="text-muted-foreground truncate hidden sm:block">{r.account_name}</span>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                            <span className="text-muted-foreground">{r.owner_name ?? "Unassigned"}</span>
                            {r.amount && <span className="text-emerald-400">{fmtAmt(r.amount)}</span>}
                            <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/40">{r.days_stale}d stale</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Quotes awaiting response */}
              {risks.awaitingQuotes.length > 0 && (
                <Card className="border border-red-500/30 bg-red-500/5">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm flex items-center gap-2 text-red-400">
                      <Clock className="h-4 w-4" />Quotes Awaiting Response ({risks.awaitingQuotes.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pb-4 px-4">
                    <div className="space-y-1">
                      {risks.awaitingQuotes.map((r: any) => (
                        <div key={r.id} className="flex items-center justify-between text-xs py-1 border-b border-border/20" data-testid={`awaiting-quote-${r.id}`}>
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                            <span className="font-medium">{r.quote_number}</span>
                            <span className="text-muted-foreground truncate hidden sm:block">{r.customer_name ?? r.account_name}</span>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                            <span className="text-muted-foreground">{r.owner_name ?? "—"}</span>
                            {r.total && <span className="text-emerald-400">{fmtAmt(r.total)}</span>}
                            <span className="text-red-400">Sent {fmtDate(r.sent_at)} · {r.days_waiting}d ago</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Install blockers */}
              {risks.installBlockers.length > 0 && (
                <Card className="border border-amber-500/30 bg-amber-500/5">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm flex items-center gap-2 text-amber-400">
                      <Hammer className="h-4 w-4" />Install Blockers ({risks.installBlockers.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pb-4 px-4">
                    <div className="space-y-2">
                      {risks.installBlockers.map((r: any) => (
                        <div key={r.id} className="text-xs py-1.5 border-b border-border/20" data-testid={`install-blocker-${r.id}`}>
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{r.title}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">{r.owner_name ?? "—"}</span>
                              {r.total_amount && <span className="text-emerald-400">{fmtAmt(r.total_amount)}</span>}
                            </div>
                          </div>
                          <p className="text-amber-300/80 mt-0.5 line-clamp-1">{r.blockers}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Overdue tasks */}
              {risks.overdueTasks.length > 0 && (
                <Card className="border border-border/50">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Zap className="h-4 w-4 text-primary" />High-Priority Overdue Tasks ({risks.overdueTasks.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pb-4 px-4">
                    <div className="space-y-1">
                      {risks.overdueTasks.map((r: any) => (
                        <div key={r.id} className="flex items-center justify-between text-xs py-1 border-b border-border/20" data-testid={`overdue-task-${r.id}`}>
                          <span className="truncate font-medium">{r.title}</span>
                          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                            <span className="text-muted-foreground">{r.owner_name ?? "—"}</span>
                            <Badge variant="outline" className="text-[10px] text-red-400 border-red-500/40">{r.days_overdue}d overdue</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Unowned leads */}
              {risks.unownedLeads.length > 0 && (
                <Card className="border border-border/50">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <User className="h-4 w-4 text-amber-400" />Leads Without Owner ({risks.unownedLeads.length} shown)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pb-4 px-4">
                    <div className="space-y-1">
                      {risks.unownedLeads.map((r: any) => (
                        <div key={r.id} className="flex items-center justify-between text-xs py-1 border-b border-border/20" data-testid={`unowned-lead-${r.id}`}>
                          <span className="font-medium">{r.company}</span>
                          <div className="flex items-center gap-2">
                            {r.source && <Badge variant="outline" className="text-[10px]">{r.source}</Badge>}
                            <span className="text-muted-foreground">{fmtDate(r.created_at)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* DQ risk summary */}
              {risks.dqRisks && (
                <Card className="border border-border/50">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm">Data Quality Risk Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="pb-4 px-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { label: "Leads (no owner)", value: risks.dqRisks.leads_no_owner ?? 0 },
                        { label: "Opps (no owner)", value: risks.dqRisks.opps_no_owner ?? 0 },
                        { label: "Opps stale 30d",  value: risks.dqRisks.opps_stale_30d ?? 0 },
                        { label: "Quotes stale 30d", value: risks.dqRisks.quotes_stale_30d ?? 0 },
                      ].map(k => (
                        <div key={k.label} className="rounded-lg p-2.5 bg-muted/30 border border-border/40" data-testid={`dq-risk-${k.label}`}>
                          <div className="text-xs text-muted-foreground">{k.label}</div>
                          <div className={`text-xl font-bold tabular-nums ${Number(k.value) > 0 ? "text-amber-400" : "text-emerald-400"}`}>{k.value}</div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
