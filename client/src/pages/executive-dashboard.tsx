import { useState, useMemo } from "react";
import { UniversalDrilldownSheet, type UniversalDrilldownConfig } from "@/components/shared/universal-drilldown-sheet";
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
import { TrendingUp, TrendingDown, DollarSign, Target, Users, Hammer, FileText, AlertTriangle, CheckCircle2, Clock, XCircle, Zap, Minus, RefreshCw, Filter, Maximize2, Minimize2, Trophy, Building2, User, Calendar,
} from "lucide-react";
import { InfoIcon as Info } from "@/components/icons/info-icon";

// ── Types ─────────────────────────────────────────────────────────────────────

interface KpiDelta {
  current: number;
  previous: number;
  delta: number;
  pctDelta: number | null;
  trend: "up" | "down" | "flat";
}

type DeltaOrNum = KpiDelta | number;

interface ExecMetadata {
  generatedAt: string;
  dateFrom: string | null;
  dateTo: string | null;
  ownerId: number | null;
  comparisonMode: "explicit_range" | "month_over_month" | "quarter_over_quarter";
  priorFrom: string;
  priorTo: string;
  stalledThresholdDays: number;
  quoteAwaitingThresholdDays: number;
}

interface ExecKPIs {
  metadata: ExecMetadata;
  summaryBullets: string[];
  pipeline: {
    totalPipeline: KpiDelta; weightedPipeline: KpiDelta; totalOpps: KpiDelta;
    commitAmount: number; bestCaseAmount: number;
    closedWonCount: number; closedWonAmount: number; stalledCount: number;
  };
  quotes: {
    total: number; sent: number; accepted: number; declined: number;
    expired: number; awaitingResponse: number; avgAcceptedValue: number;
    acceptedRevenue: KpiDelta; winRate: KpiDelta;
    acceptedMonth: number; acceptedRevenueMonth: number;
    acceptedQtr: number; acceptedRevenueQtr: number;
  };
  installs: {
    total: number; inProgress: number; pendingKickoff: number; complete: number;
    onHold: number; withBlockers: number; overdueInstalls: number;
    completedMonth: KpiDelta; completedQtr: number;
  };
  leads: {
    total: number; converted: number; qualified: number; active: number;
    newThisMonth: KpiDelta; convertedMonth: KpiDelta; noOwner: number;
  };
  risks: {
    overdueTaskCount: number; stalledOpps: number; stalledAmount: number;
    installsWithBlockers: number; quotesAwaitingReply: number; leadsNoOwner: number;
    severity: Record<string,string>;
    distinctAtRiskCount: number;
  };
}

interface RiskAlerts {
  stalledOpps: any[];
  awaitingQuotes: any[];
  installBlockers: any[];
  overdueTasks: any[];
  dqRisks: any;
  unownedLeads: any[];
  severity: Record<string,string>;
  distinctAtRiskCount: number;
  stalledThresholdDays: number;
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

/** Extract current scalar from a KpiDelta or plain number */
function cur(v: DeltaOrNum | undefined): number {
  if (v === undefined || v === null) return 0;
  if (typeof v === "number") return v;
  return (v as KpiDelta).current ?? 0;
}

/** Extract the delta object if present */
function delta(v: DeltaOrNum | undefined): KpiDelta | null {
  if (v === undefined || v === null || typeof v === "number") return null;
  return v as KpiDelta;
}

const PIE_COLORS = ["#06b6d4","#10b981","#8b5cf6","#f59e0b","#3b82f6","#6b7280"];

// ── Delta Chip ────────────────────────────────────────────────────────────────
function DeltaChip({ d }: { d: KpiDelta | null }) {
  if (!d || (d.delta === 0 && d.pctDelta === null)) return null;
  const up   = d.trend === "up";
  const down = d.trend === "down";
  const pctStr = d.pctDelta !== null ? `${Math.abs(d.pctDelta)}%` : "—";
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] font-medium tabular-nums px-1 py-0.5 rounded ${
        up   ? "text-emerald-400 bg-emerald-400/10" :
        down ? "text-red-400 bg-red-400/10"         :
               "text-muted-foreground bg-muted/30"
      }`}
      title={`vs prior: ${d.previous >= 1000 ? fmtAmt(d.previous) : d.previous}`}
    >
      {up   ? <TrendingUp  className="h-2.5 w-2.5" /> :
       down ? <TrendingDown className="h-2.5 w-2.5" /> :
              <Minus        className="h-2.5 w-2.5" />}
      {pctStr}
    </span>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({
  label, value, sub, color, icon: Icon, board, deltaVal, onClick,
}: {
  label: string; value: string | number; sub?: string; color?: string;
  icon: any; board?: boolean; deltaVal?: KpiDelta | null; onClick?: () => void;
}) {
  return (
    <Card
      className={`border border-border/50 ${onClick ? "cursor-pointer hover:border-primary/40 transition-colors" : ""}`}
      data-testid={`kpi-${label.toLowerCase().replace(/[\s/]/g,"-")}`}
      onClick={onClick}
    >
      <CardContent className={board ? "p-4" : "p-3"}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground font-medium">{label}</span>
          <Icon className={`h-3.5 w-3.5 ${color ?? "text-muted-foreground"}`} />
        </div>
        <div className={`font-bold tabular-nums ${board ? "text-3xl" : "text-2xl"} ${color ?? ""}`}>{value}</div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
          {deltaVal && <DeltaChip d={deltaVal} />}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Risk Chip ─────────────────────────────────────────────────────────────────
function RiskChip({ count, label, level = "medium" }: { count: number; label: string; level?: "low"|"medium"|"high" }) {
  if (count === 0) return null;
  const color = level === "high"   ? "border-red-500/40 bg-red-500/10 text-red-400"
              : level === "medium" ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
              :                      "border-emerald-500/40 bg-emerald-500/10 text-emerald-400";
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${color}`}>
      <AlertTriangle className="h-3 w-3" /> {count} {label}
    </span>
  );
}

// ── Summary Strip ─────────────────────────────────────────────────────────────
function SummaryStrip({ bullets, board }: { bullets: string[]; board: boolean }) {
  if (!bullets?.length) return null;
  if (board) {
    return (
      <div className="flex flex-wrap gap-2 mb-1" data-testid="summary-strip">
        {bullets.map((b, i) => (
          <span key={i} className="text-xs text-muted-foreground border border-border/30 rounded px-2 py-1 bg-muted/20">
            {b}
          </span>
        ))}
      </div>
    );
  }
  return (
    <Card className="border border-border/40 bg-muted/20" data-testid="summary-strip">
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Info className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold text-primary">Leadership Summary</span>
        </div>
        <ul className="space-y-1">
          {bullets.map((b, i) => (
            <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5" data-testid={`summary-bullet-${i}`}>
              <span className="text-primary mt-0.5">·</span>
              {b}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ── Metadata Bar ──────────────────────────────────────────────────────────────
function MetadataBar({ meta, board }: { meta: ExecMetadata; board: boolean }) {
  if (!meta) return null;
  const modeLabel = meta.comparisonMode === "month_over_month" ? "Month-over-month"
                  : meta.comparisonMode === "quarter_over_quarter" ? "Quarter-over-quarter"
                  : "Custom range";
  const priorStr = `${fmtDate(meta.priorFrom)} – ${fmtDate(meta.priorTo)}`;
  return (
    <div
      className={`flex items-center gap-3 flex-wrap text-[10px] text-muted-foreground/70 ${board ? "" : "px-0.5"}`}
      data-testid="metadata-bar"
    >
      <span className="flex items-center gap-1">
        <RefreshCw className="h-2.5 w-2.5" />
        Generated {new Date(meta.generatedAt).toLocaleTimeString()}
      </span>
      <span className="text-border/50">|</span>
      <span>Δ vs {modeLabel.toLowerCase()} · prior: {priorStr}</span>
      {meta.ownerId && <><span className="text-border/50">|</span><span>Rep #{meta.ownerId} filtered</span></>}
      {(meta.dateFrom || meta.dateTo) && (
        <><span className="text-border/50">|</span>
        <span>{meta.dateFrom ?? "—"} → {meta.dateTo ?? "now"}</span></>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ExecutiveDashboardPage() {
  const [boardMode, setBoardMode] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo,   setDateTo]   = useState("");
  const [ownerId,  setOwnerId]  = useState("all");
  const [activeTab, setActiveTab] = useState("overview");
  const [drilldown, setDrilldown] = useState<UniversalDrilldownConfig | null>(null);
  const dd = (metric: string, title?: string) => () => setDrilldown({ metric, title });

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
    queryKey: ["/api/pipeline/forecast", ownerId],
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

  const { data: revenueDash } = useQuery<any>({
    queryKey: ["/api/revenue/dashboard"],
    queryFn: () => fetch("/api/revenue/dashboard", { credentials: "include" }).then(r => r.json()),
  });

  const { data: repPerf } = useQuery<any>({
    queryKey: ["/api/pipeline/rep-performance"],
    queryFn: () => fetch("/api/pipeline/rep-performance", { credentials: "include" }).then(r => r.json()),
  });

  const forecastPeriods = useMemo(() => (forecast?.periods ?? []).slice(0, 6).reverse(), [forecast]);
  const sourceRows = useMemo(() => (sourceData?.data ?? []).slice(0, 6), [sourceData]);
  const repRows    = useMemo(() => [...(repPerf?.reps ?? [])].sort((a: any, b: any) => (b.closedWonAmount ?? 0) - (a.closedWonAmount ?? 0)).slice(0, 8), [repPerf]);

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

  // Severity map from API or fallback
  const sev = risks?.severity ?? {};
  const riskSev = (bucket: string) => (sev[bucket] ?? "medium") as "high" | "medium" | "low";

  return (
    <div className={`flex-1 overflow-auto bg-background p-6 space-y-4 ${boardMode ? "print:p-4" : ""}`}>
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" data-testid="page-title">
            <Trophy className="h-5 w-5 text-primary" />
            Executive Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Leadership cockpit — pipeline, revenue, delivery, and risk at a glance.
          </p>
          {kpis?.metadata && <MetadataBar meta={kpis.metadata} board={boardMode} />}
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

      {/* Summary bullets */}
      {kpis?.summaryBullets?.length ? <SummaryStrip bullets={kpis.summaryBullets} board={boardMode} /> : null}

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
              <KpiCard label="Total Pipeline"
                value={fmtAmt(cur(kpis.pipeline.totalPipeline))}
                deltaVal={delta(kpis.pipeline.totalPipeline)}
                icon={DollarSign} color="text-primary" board={boardMode}
                onClick={dd("exec_total_pipeline", "Total Pipeline")} />
              <KpiCard label="Weighted Forecast"
                value={fmtAmt(cur(kpis.pipeline.weightedPipeline))}
                deltaVal={delta(kpis.pipeline.weightedPipeline)}
                icon={Target} board={boardMode}
                sub={`Commit: ${fmtAmt(kpis.pipeline.commitAmount)}`}
                onClick={dd("exec_weighted_forecast", "Weighted Forecast")} />
              <KpiCard label="Open Opportunities"
                value={cur(kpis.pipeline.totalOpps)}
                deltaVal={delta(kpis.pipeline.totalOpps)}
                icon={Target} board={boardMode}
                sub={`${kpis.pipeline.stalledCount} stalled`}
                color={kpis.pipeline.stalledCount > 5 ? "text-amber-400" : undefined}
                onClick={dd("exec_open_opps", "Open Opportunities")} />
              <KpiCard label="Closed Won"
                value={fmtAmt(kpis.pipeline.closedWonAmount)}
                icon={Trophy} color="text-emerald-400" board={boardMode}
                sub={`${kpis.pipeline.closedWonCount} deals`}
                onClick={dd("exec_closed_won", "Closed Won")} />
            </div>
          </div>

          {/* Row 2: Quotes & Revenue */}
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Quotes & Revenue
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              <KpiCard label="Accepted Revenue"
                value={fmtAmt(cur(kpis.quotes.acceptedRevenue))}
                deltaVal={delta(kpis.quotes.acceptedRevenue)}
                color="text-emerald-400" icon={DollarSign} board={boardMode}
                onClick={dd("exec_accepted_revenue", "Accepted Revenue")} />
              <KpiCard label="Revenue This Month"  value={fmtAmt(kpis.quotes.acceptedRevenueMonth)} icon={Calendar} board={boardMode}
                onClick={dd("exec_revenue_month", "Revenue This Month")} />
              <KpiCard label="Revenue This Quarter" value={fmtAmt(kpis.quotes.acceptedRevenueQtr)} icon={Calendar} board={boardMode}
                onClick={dd("exec_revenue_qtr", "Revenue This Quarter")} />
              <KpiCard label="Win Rate"
                value={pct(cur(kpis.quotes.winRate))}
                deltaVal={delta(kpis.quotes.winRate)}
                icon={Trophy}
                color={cur(kpis.quotes.winRate) >= 40 ? "text-emerald-400" : cur(kpis.quotes.winRate) >= 20 ? "text-amber-400" : "text-red-400"} board={boardMode}
                onClick={dd("exec_win_rate", "Win Rate — Quote Outcomes")} />
              <KpiCard label="Avg Deal Value"      value={fmtAmt(kpis.quotes.avgAcceptedValue)} icon={DollarSign} board={boardMode}
                onClick={dd("exec_avg_deal", "Average Deal Value")} />
              <KpiCard label="Awaiting Response"   value={kpis.quotes.awaitingResponse} icon={Clock}
                color={kpis.quotes.awaitingResponse > 5 ? "text-amber-400" : undefined} board={boardMode}
                sub={`${kpis.quotes.sent} sent total`}
                onClick={dd("exec_awaiting_response", "Awaiting Response")} />
            </div>
          </div>

          {/* Row 3: Installs + Leads */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Hammer className="h-3.5 w-3.5" /> Install & Delivery
              </div>
              <div className="grid grid-cols-2 gap-3">
                <KpiCard label="In Progress" value={kpis.installs.inProgress} icon={RefreshCw} color="text-blue-400" board={boardMode}
                  onClick={dd("exec_installs_in_progress", "Installs In Progress")} />
                <KpiCard label="Completed (Qtr)" value={kpis.installs.completedQtr} icon={CheckCircle2} color="text-emerald-400" board={boardMode}
                  sub={`${cur(kpis.installs.completedMonth)} this month`}
                  deltaVal={delta(kpis.installs.completedMonth)} />
                <KpiCard label="With Blockers" value={kpis.installs.withBlockers} icon={AlertTriangle}
                  color={kpis.installs.withBlockers > 0 ? "text-amber-400" : undefined} board={boardMode}
                  onClick={dd("exec_installs_with_blockers", "Installs With Blockers")} />
                <KpiCard label="Overdue" value={kpis.installs.overdueInstalls} icon={XCircle}
                  color={kpis.installs.overdueInstalls > 0 ? "text-red-400" : undefined} board={boardMode}
                  onClick={dd("exec_installs_overdue", "Overdue Installs")} />
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" /> Lead Funnel
              </div>
              <div className="grid grid-cols-2 gap-3">
                <KpiCard label="Total Leads"    value={kpis.leads.total.toLocaleString()} icon={Users} board={boardMode}
                  onClick={dd("exec_leads_total", "Total Leads")} />
                <KpiCard label="New This Month"
                  value={cur(kpis.leads.newThisMonth)}
                  deltaVal={delta(kpis.leads.newThisMonth)}
                  icon={Zap} board={boardMode}
                  onClick={dd("exec_leads_new_month", "New Leads This Month")} />
                <KpiCard label="Converted"
                  value={kpis.leads.converted.toLocaleString()}
                  icon={CheckCircle2} color="text-emerald-400" board={boardMode}
                  onClick={dd("exec_leads_converted", "Converted Leads")} />
                <KpiCard label="No Owner"       value={kpis.leads.noOwner} icon={User}
                  color={kpis.leads.noOwner > 10 ? "text-amber-400" : undefined} board={boardMode}
                  onClick={dd("exec_leads_no_owner", "Leads Without Owner")} />
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
          <RiskChip count={kpis.risks.stalledOpps}          label="stalled opps"      level={riskSev("stalledOpps")} />
          <RiskChip count={kpis.risks.quotesAwaitingReply}  label="quotes aging"      level={riskSev("awaitingQuotes")} />
          <RiskChip count={kpis.risks.installsWithBlockers} label="install blockers"  level={riskSev("installBlockers")} />
          <RiskChip count={kpis.risks.overdueTaskCount}     label="overdue tasks"     level={riskSev("overdueTasks")} />
          <RiskChip count={kpis.risks.leadsNoOwner}         label="unowned leads"     level={riskSev("unownedLeads")} />
          {kpis.risks.distinctAtRiskCount > 0 && (
            <span className="text-[10px] text-muted-foreground ml-auto">
              {kpis.risks.distinctAtRiskCount} distinct at-risk records
            </span>
          )}
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-8 bg-muted/40 p-1 gap-1 flex-wrap">
          <TabsTrigger value="overview"  className="text-xs h-6" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="forecast"  className="text-xs h-6" data-testid="tab-forecast">Forecast</TabsTrigger>
          <TabsTrigger value="source"    className="text-xs h-6" data-testid="tab-source">Source Attribution</TabsTrigger>
          <TabsTrigger value="installs"  className="text-xs h-6" data-testid="tab-installs">Installs</TabsTrigger>
          <TabsTrigger value="reps"      className="text-xs h-6" data-testid="tab-reps">Rep Leaderboard</TabsTrigger>
          <TabsTrigger value="revenue"   className="text-xs h-6" data-testid="tab-revenue">Revenue</TabsTrigger>
          <TabsTrigger value="risks"     className="text-xs h-6" data-testid="tab-risks">
            Risks {totalRisks > 0 && <Badge className="ml-1 text-[9px] px-1 py-0 bg-red-500 text-white">{totalRisks}</Badge>}
          </TabsTrigger>
        </TabsList>

        {/* ── Overview ─────────────────────────────────────────────────────── */}
        <TabsContent value="overview" className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
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
                    <Bar dataKey="commit.totalAmount"    name="Commit"    fill="#10b981" stackId="a" radius={[0,0,0,0]} />
                    <Bar dataKey="best_case.totalAmount" name="Best Case" fill="#06b6d4" stackId="a" />
                    <Bar dataKey="pipeline.totalAmount"  name="Pipeline"  fill="#3b82f6" stackId="a" radius={[3,3,0,0]} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

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
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Forecast ─────────────────────────────────────────────────────── */}
        <TabsContent value="forecast" className="mt-3">
          <Card className="border border-border/50">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm">6-Month Revenue Forecast</CardTitle>
            </CardHeader>
            <CardContent className="pb-4 px-4">
              {!forecastPeriods.length ? <Skeleton className="h-60" /> : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={forecastPeriods} margin={{ left: 10, right: 10, top: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => fmtAmt(v)} />
                    <Tooltip formatter={(v: any) => fmtAmt(v)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: 11 }} />
                    <Bar dataKey="commit.totalAmount"    name="Commit"     fill="#10b981" stackId="a" />
                    <Bar dataKey="best_case.totalAmount" name="Best Case"  fill="#06b6d4" stackId="a" />
                    <Bar dataKey="pipeline.totalAmount"  name="Pipeline"   fill="#3b82f6" stackId="a" radius={[3,3,0,0]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Source Attribution ────────────────────────────────────────────── */}
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
                      {["Source","Leads","Qualified","Won","Win %","Revenue"].map(h => (
                        <th key={h} className={`py-1.5 px-2 text-muted-foreground font-medium ${h === "Source" ? "text-left" : "text-right"}`}>{h}</th>
                      ))}
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

        {/* ── Installs ─────────────────────────────────────────────────────── */}
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
                    { label: "Total Workflows",   value: kpis.installs.total },
                    { label: "In Progress",       value: kpis.installs.inProgress },
                    { label: "Pending Kickoff",   value: kpis.installs.pendingKickoff },
                    { label: "Completed (Qtr)",   value: kpis.installs.completedQtr },
                    { label: "Completed (Month)", value: cur(kpis.installs.completedMonth), alert: false },
                    { label: "With Blockers",     value: kpis.installs.withBlockers,   alert: kpis.installs.withBlockers > 0 },
                    { label: "Overdue",           value: kpis.installs.overdueInstalls, alert: kpis.installs.overdueInstalls > 0 },
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

        {/* ── Rep Leaderboard ───────────────────────────────────────────────── */}
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
                      {["Rep","Open Opps","Stale","Closed Won $","Activity 7d"].map(h => (
                        <th key={h} className={`py-1.5 px-2 text-muted-foreground font-medium ${h === "Rep" ? "text-left" : "text-right"}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {repRows.map((r: any, i: number) => (
                      <tr key={r.name ?? i} className="border-b border-border/20 hover:bg-muted/10" data-testid={`rep-row-${i}`}>
                        <td className="py-1.5 px-2 font-medium flex items-center gap-1.5">
                          {i === 0 && <Trophy className="h-3 w-3 text-amber-400" />}
                          {r.name ?? r.repName ?? "Unassigned"}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{r.openOpps ?? "—"}</td>
                        <td className={`py-1.5 px-2 text-right tabular-nums ${(r.staleOpps ?? 0) > 3 ? "text-amber-400" : ""}`}>{r.staleOpps ?? r.staleCount ?? 0}</td>
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

        {/* ── Revenue ─────────────────────────────────────────────────────── */}
        <TabsContent value="revenue" className="mt-3 space-y-4">
          {!revenueDash ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[...Array(8)].map((_, i) => <div key={i} className="h-24 bg-muted/30 rounded-lg animate-pulse" />)}
            </div>
          ) : (
            <>
              {/* MRR KPIs */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">SaaS MRR</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: "Current MRR",       value: fmtAmt(revenueDash.mrr?.current ?? 0),          sub: `${revenueDash.mrr?.accountsWithBilling ?? 0} billed` },
                    { label: "Contracted MRR",     value: fmtAmt(revenueDash.mrr?.contracted ?? 0),        sub: "All active lines" },
                    { label: "MRR Gap",            value: fmtAmt((revenueDash.mrr?.contracted ?? 0) - (revenueDash.mrr?.current ?? 0)), sub: "Rollout upside" },
                    { label: "Software-Only MRR",  value: fmtAmt(revenueDash.mrr?.softwareOnly ?? 0),      sub: "Lite slip SaaS" },
                  ].map(k => (
                    <div key={k.label} className="rounded-lg p-3 border border-border/50 bg-card" data-testid={`rev-kpi-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
                      <p className="text-xs text-muted-foreground">{k.label}</p>
                      <p className="text-xl font-bold mt-0.5">{k.value}</p>
                      {k.sub && <p className="text-[11px] text-muted-foreground mt-0.5">{k.sub}</p>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Hardware Revenue */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Hardware Revenue</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: "Contracted", value: fmtAmt(revenueDash.hardware?.contracted ?? 0) },
                    { label: "Booked",     value: fmtAmt(revenueDash.hardware?.booked ?? 0) },
                    { label: "Delivered",  value: fmtAmt(revenueDash.hardware?.delivered ?? 0) },
                    { label: "Remaining",  value: fmtAmt(revenueDash.hardware?.remaining ?? 0) },
                  ].map(k => (
                    <div key={k.label} className="rounded-lg p-3 border border-border/50 bg-card" data-testid={`rev-hw-${k.label.toLowerCase()}`}>
                      <p className="text-xs text-muted-foreground">{k.label}</p>
                      <p className="text-xl font-bold mt-0.5">{k.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Slip Counts */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Slip Counts</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: "Total Slips",      value: (revenueDash.slips?.total ?? 0).toLocaleString() },
                    { label: "VoltSafe Live",    value: (revenueDash.slips?.voltsafeLive ?? 0).toLocaleString() },
                    { label: "Software-Only",    value: (revenueDash.slips?.softwareOnly ?? 0).toLocaleString() },
                    { label: "Future Upgrade",   value: (revenueDash.slips?.futureUpgrade ?? 0).toLocaleString() },
                  ].map(k => (
                    <div key={k.label} className="rounded-lg p-3 border border-border/50 bg-card" data-testid={`rev-slip-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
                      <p className="text-xs text-muted-foreground">{k.label}</p>
                      <p className="text-xl font-bold mt-0.5">{k.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Rollout Phases */}
              {revenueDash.rolloutPhases && Object.keys(revenueDash.rolloutPhases).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Rollout Phase Status</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(revenueDash.rolloutPhases as Record<string, number>).map(([status, count]) => (
                      <div key={status} className="rounded-full px-3 py-1.5 border border-border/50 text-sm font-medium capitalize"
                        data-testid={`exec-phase-${status}`}>
                        {status.replace(/_/g, " ")}: <span className="font-bold">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Top Expansion Accounts */}
              {(revenueDash.topExpansionAccounts ?? []).length > 0 && (
                <Card className="border-border/50">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm">Top Expansion Accounts</CardTitle>
                  </CardHeader>
                  <CardContent className="pb-4 px-4">
                    <div className="space-y-2">
                      {revenueDash.topExpansionAccounts.map((a: any) => (
                        <div key={a.id} className="flex items-center justify-between text-xs py-1.5 border-b border-border/20 last:border-0"
                          data-testid={`exec-expansion-${a.id}`}>
                          <span className="font-medium">{a.name}</span>
                          <div className="flex items-center gap-3 text-muted-foreground">
                            {a.currentMrr > 0 && <span className="text-emerald-400 font-medium">{fmtAmt(a.currentMrr)}/mo</span>}
                            {a.futureUpgradeSlips > 0 && <span className="text-amber-400">+{a.futureUpgradeSlips} slips</span>}
                            {a.contractedUnits > 0 && <span>{a.installedUnits}/{a.contractedUnits} units</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="risks" className="mt-3 space-y-3">
          {riskLoading ? <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}</div> : risks && (
            <>
              {/* Distinct count summary */}
              {risks.distinctAtRiskCount > 0 && (
                <div className="text-xs text-muted-foreground p-2 rounded bg-muted/20 border border-border/30" data-testid="distinct-risk-count">
                  <span className="font-medium text-red-400">{risks.distinctAtRiskCount}</span> distinct at-risk records across stalled opps, aging quotes, and install blockers.
                  {risks.stalledThresholdDays && <span className="ml-2 text-muted-foreground/60">Stalled threshold: {risks.stalledThresholdDays}d.</span>}
                </div>
              )}

              {/* Stalled Opps */}
              {risks.stalledOpps.length > 0 && (
                <Card className="border border-amber-500/30 bg-amber-500/5">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm flex items-center gap-2 text-amber-400">
                      <AlertTriangle className="h-4 w-4" />Stalled Opportunities ({risks.stalledOpps.length})
                      <Badge variant="outline" className="text-[9px] text-amber-400 border-amber-500/30 ml-auto">
                        {risks.severity?.stalledOpps ?? "high"}
                      </Badge>
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
                      <Badge variant="outline" className="text-[9px] text-red-400 border-red-500/30 ml-auto">
                        {risks.severity?.awaitingQuotes ?? "high"}
                      </Badge>
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
                            <span className="text-red-400">Sent {fmtDate(r.sent_at)} · {r.days_waiting}d</span>
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
                      <Badge variant="outline" className="text-[9px] text-amber-400 border-amber-500/30 ml-auto">
                        {risks.severity?.installBlockers ?? "medium"}
                      </Badge>
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
                        { label: "Leads (no owner)",  value: risks.dqRisks.leads_no_owner  ?? 0 },
                        { label: "Opps (no owner)",   value: risks.dqRisks.opps_no_owner   ?? 0 },
                        { label: "Opps stale 30d",    value: risks.dqRisks.opps_stale_30d  ?? 0 },
                        { label: "Quotes stale 30d",  value: risks.dqRisks.quotes_stale_30d ?? 0 },
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

      <UniversalDrilldownSheet
        config={drilldown}
        onClose={() => setDrilldown(null)}
        endpoint="/api/insights/drilldown"
      />
    </div>
  );
}
