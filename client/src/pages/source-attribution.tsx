import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend,
} from "recharts";
import {
  TrendingUp, Users, Target, DollarSign, Clock, Zap, Download,
  Filter, RefreshCw, Trophy, AlertTriangle, ChevronUp, ChevronDown,
  BarChart2, Table, Layers,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SourceRow {
  bucket: string;
  label: string;
  totalLeads: number;
  convertedLeads: number;
  opps: number;
  quoted: number;
  won: number;
  installs: number;
  qualifyRate: number;
  quoteRate: number;
  winRate: number;
  installRate: number;
  avgDaysToQualify: number;
  avgDaysToWin: number;
  avgWonValue: number;
  totalWonValue: number;
}

interface Summary {
  totalLeads: number;
  convertedLeads: number;
  qualifyRate: number;
  totalOpps: number;
  quotedOpps: number;
  wonOpps: number;
  winRate: number;
  installs: number;
  avgDaysToQualify: number;
  avgWonValue: number;
  totalWonRevenue: number;
}

// ── Colour palette ────────────────────────────────────────────────────────────
const BUCKET_COLORS: Record<string, string> = {
  inbound_web:       "#06b6d4",  // cyan
  referral:          "#10b981",  // emerald
  partner:           "#8b5cf6",  // violet
  event_conference:  "#f59e0b",  // amber
  outbound:          "#3b82f6",  // blue
  association:       "#ec4899",  // pink
  field_prospecting: "#f97316",  // orange
  investor_network:  "#a855f7",  // purple
  other:             "#6b7280",  // slate
};

// ── Saved Views ───────────────────────────────────────────────────────────────
const SAVED_VIEWS = [
  { id: "best", label: "Best Converters",        desc: "Sources with highest win rate", filter: { sortBy: "winRate" } },
  { id: "high-vol", label: "High Vol · Low Conv", desc: "High lead volume, low qualification", filter: { sortBy: "totalLeads" } },
  { id: "referral", label: "Referral",            desc: "All referral-sourced leads",   filter: { bucket: "referral" } },
  { id: "event",    label: "Events",              desc: "Conference and event leads",    filter: { bucket: "event_conference" } },
  { id: "outbound", label: "Outbound",            desc: "SDR + cold outreach leads",    filter: { bucket: "outbound" } },
];

function fmtAmt(n: number) {
  if (!n) return "$0";
  if (n >= 1_000_000) return `$${(n/1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n/1_000).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}

function fmtDays(n: number) {
  if (!n || n <= 0) return "—";
  return `${Math.round(n)}d`;
}

function pctColor(n: number) {
  if (n >= 60) return "text-emerald-400";
  if (n >= 30) return "text-amber-400";
  return "text-red-400";
}

// ── Summary Card ──────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color, icon: Icon }: { label: string; value: string | number; sub?: string; color?: string; icon: any }) {
  return (
    <Card className="border border-border/50">
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">{label}</span>
          <Icon className={`h-3.5 w-3.5 ${color ?? "text-muted-foreground"}`} />
        </div>
        <div className={`text-2xl font-bold tabular-nums ${color ?? ""}`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// ── Funnel Bar (visual) ───────────────────────────────────────────────────────
function FunnelBar({ row }: { row: SourceRow }) {
  const max = row.totalLeads;
  const bars = [
    { label: "Leads",    value: row.totalLeads,     color: "bg-slate-500" },
    { label: "Qualified",value: row.convertedLeads, color: "bg-blue-500" },
    { label: "Quoted",   value: row.quoted,          color: "bg-amber-500" },
    { label: "Won",      value: row.won,             color: "bg-emerald-500" },
    { label: "Install",  value: row.installs,        color: "bg-cyan-500" },
  ];
  return (
    <div className="flex items-end gap-1 h-12">
      {bars.map(b => (
        <div key={b.label} className="flex flex-col items-center gap-0.5 flex-1">
          <div className="w-full relative flex items-end" style={{ height: "36px" }}>
            <div
              className={`w-full ${b.color} rounded-t opacity-80`}
              style={{ height: max > 0 ? `${Math.max(2, (b.value / max) * 36)}px` : "2px" }}
            />
          </div>
          <span className="text-[9px] text-muted-foreground truncate w-full text-center">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SourceAttributionPage() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo,   setDateTo]   = useState("");
  const [ownerId,  setOwnerId]  = useState("all");
  const [region,   setRegion]   = useState("");
  const [bucketFilter, setBucketFilter] = useState("all");
  const [sortBy,   setSortBy]   = useState("totalLeads");
  const [sortDir,  setSortDir]  = useState<"desc"|"asc">("desc");
  const [view,     setView]     = useState("table");
  const [activeView, setActiveView] = useState<string | null>(null);

  const { data: users } = useQuery<any[]>({ queryKey: ["/api/users"] });

  function buildParams() {
    const p: Record<string,string> = {};
    if (dateFrom) p.dateFrom = dateFrom;
    if (dateTo)   p.dateTo   = dateTo;
    if (ownerId && ownerId !== "all") p.ownerId = ownerId;
    if (region)   p.region   = region;
    return new URLSearchParams(p).toString();
  }
  const params = buildParams();

  const { data: summary, isLoading: sumLoading } = useQuery<Summary>({
    queryKey: ["/api/analytics/source-attribution/summary", params],
    queryFn: () => fetch(`/api/analytics/source-attribution/summary?${params}`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: funnelData, isLoading: funnelLoading } = useQuery<{ data: SourceRow[] }>({
    queryKey: ["/api/analytics/source-attribution", params],
    queryFn: () => fetch(`/api/analytics/source-attribution?${params}`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: rawSources } = useQuery<{ data: any[] }>({
    queryKey: ["/api/analytics/source-attribution/raw-sources"],
    queryFn: () => fetch("/api/analytics/source-attribution/raw-sources", { credentials: "include" }).then(r => r.json()),
  });

  // Filter + sort
  const rows = useMemo(() => {
    let data = funnelData?.data ?? [];
    if (bucketFilter !== "all") data = data.filter(r => r.bucket === bucketFilter);
    // Apply saved view sorting
    const sortField = activeView === "best" ? "winRate" : activeView === "high-vol" ? "totalLeads" : sortBy;
    return [...data].sort((a, b) => {
      const av = (a as any)[sortField] ?? 0;
      const bv = (b as any)[sortField] ?? 0;
      return sortDir === "desc" ? bv - av : av - bv;
    });
  }, [funnelData, bucketFilter, sortBy, sortDir, activeView]);

  const chartRows = useMemo(() => [...rows].sort((a,b) => b.totalLeads - a.totalLeads).slice(0, 8), [rows]);

  function toggleSort(field: string) {
    if (sortBy === field) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortBy(field); setSortDir("desc"); }
    setActiveView(null);
  }

  function SortIcon({ field }: { field: string }) {
    if (sortBy !== field) return <span className="opacity-20">↕</span>;
    return sortDir === "desc" ? <ChevronDown className="h-3 w-3 inline" /> : <ChevronUp className="h-3 w-3 inline" />;
  }

  const exportUrl = `/api/analytics/source-attribution/export?${params}`;

  return (
    <div className="flex-1 overflow-auto bg-background p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" data-testid="page-title">
            <BarChart2 className="h-5 w-5 text-primary" />
            Lead Source Attribution
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Which channels produce qualified pipeline, accepted quotes, and delivered installs.
          </p>
        </div>
        <a href={exportUrl} download>
          <Button variant="outline" size="sm" data-testid="btn-export-csv">
            <Download className="h-3.5 w-3.5 mr-1" /> Export CSV
          </Button>
        </a>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center p-3 rounded-lg bg-muted/30 border border-border/40">
        <Filter className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-8 w-34 text-xs" placeholder="From" data-testid="filter-date-from" />
        <Input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   className="h-8 w-34 text-xs" placeholder="To"   data-testid="filter-date-to" />
        <Select value={ownerId} onValueChange={setOwnerId}>
          <SelectTrigger className="h-8 w-36 text-xs" data-testid="filter-owner">
            <SelectValue placeholder="All Owners" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Owners</SelectItem>
            {(users ?? []).map((u: any) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input value={region} onChange={e => setRegion(e.target.value)} placeholder="Region (state)" className="h-8 w-28 text-xs" data-testid="filter-region" />
        <Select value={bucketFilter} onValueChange={setBucketFilter}>
          <SelectTrigger className="h-8 w-40 text-xs" data-testid="filter-bucket">
            <SelectValue placeholder="All Sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            {["inbound_web","referral","partner","event_conference","outbound","association","field_prospecting","investor_network","other"].map(b => (
              <SelectItem key={b} value={b}>{b.replace(/_/g," ").replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(dateFrom || dateTo || ownerId !== "all" || region || bucketFilter !== "all") && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setDateFrom(""); setDateTo(""); setOwnerId("all"); setRegion(""); setBucketFilter("all"); }}>
            <RefreshCw className="h-3 w-3 mr-1" /> Clear
          </Button>
        )}
      </div>

      {/* Saved Views */}
      <div className="flex gap-1.5 flex-wrap">
        {SAVED_VIEWS.map(sv => (
          <button
            key={sv.id}
            onClick={() => { setActiveView(activeView === sv.id ? null : sv.id); if (sv.filter?.bucket) setBucketFilter((sv.filter as any).bucket); else setBucketFilter("all"); }}
            data-testid={`saved-view-${sv.id}`}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors
              ${activeView === sv.id
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border/50 text-muted-foreground hover:text-foreground hover:border-border"
              }`}
          >
            {sv.label}
          </button>
        ))}
      </div>

      {/* Summary Cards */}
      {sumLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Total Leads"    value={summary.totalLeads.toLocaleString()} icon={Users} />
          <StatCard label="Qualify Rate"   value={`${summary.qualifyRate}%`}  color={pctColor(summary.qualifyRate)} icon={TrendingUp} />
          <StatCard label="Quoted Opps"    value={summary.quotedOpps}          icon={Target} />
          <StatCard label="Win Rate"       value={`${summary.winRate}%`}       color={pctColor(summary.winRate)} icon={Trophy} />
          <StatCard label="Avg Days to Qualify" value={fmtDays(summary.avgDaysToQualify)} icon={Clock} />
          <StatCard label="Total Won Revenue"   value={fmtAmt(summary.totalWonRevenue)} color="text-emerald-400" icon={DollarSign} sub={`Avg ${fmtAmt(summary.avgWonValue)} / deal`} />
        </div>
      )}

      {/* Main Content Tabs */}
      <Tabs value={view} onValueChange={setView}>
        <TabsList className="h-8 bg-muted/40 p-1 gap-1">
          <TabsTrigger value="table" className="text-xs h-6" data-testid="tab-table"><Table className="h-3 w-3 mr-1" />Funnel Table</TabsTrigger>
          <TabsTrigger value="chart" className="text-xs h-6" data-testid="tab-chart"><BarChart2 className="h-3 w-3 mr-1" />Bar Chart</TabsTrigger>
          <TabsTrigger value="raw"   className="text-xs h-6" data-testid="tab-raw"><Layers className="h-3 w-3 mr-1" />Raw Sources</TabsTrigger>
        </TabsList>

        {/* ── Funnel Table ─────────────────────────────────────────────────── */}
        <TabsContent value="table" className="mt-3">
          {funnelLoading ? (
            <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : rows.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <BarChart2 className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p>No data matching filters.</p>
            </div>
          ) : (
            <div className="rounded-lg border border-border/40 overflow-x-auto">
              <table className="w-full text-xs" data-testid="funnel-table">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Source</th>
                    {[
                      ["totalLeads",     "Leads"],
                      ["convertedLeads", "Qualified"],
                      ["qualifyRate",    "Qualify %"],
                      ["quoted",         "Quoted"],
                      ["won",            "Won"],
                      ["winRate",        "Win %"],
                      ["installs",       "Installs"],
                      ["avgDaysToQualify","Avg Days"],
                      ["avgWonValue",    "Avg Value"],
                      ["totalWonValue",  "Total Won"],
                    ].map(([field, label]) => (
                      <th key={field} className="text-right px-3 py-2 font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                        onClick={() => toggleSort(field)}>
                        {label} <SortIcon field={field} />
                      </th>
                    ))}
                    <th className="px-3 py-2 font-medium text-muted-foreground">Funnel</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.bucket} className={`border-b border-border/20 hover:bg-muted/20 ${i === 0 && activeView === "best" ? "bg-emerald-500/5" : ""}`}
                      data-testid={`row-source-${r.bucket}`}>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: BUCKET_COLORS[r.bucket] ?? "#6b7280" }} />
                          <span className="font-medium">{r.label}</span>
                        </div>
                      </td>
                      <td className="text-right px-3 py-2.5 tabular-nums">{r.totalLeads.toLocaleString()}</td>
                      <td className="text-right px-3 py-2.5 tabular-nums">{r.convertedLeads.toLocaleString()}</td>
                      <td className="text-right px-3 py-2.5 tabular-nums">
                        <span className={pctColor(r.qualifyRate)}>{r.qualifyRate}%</span>
                      </td>
                      <td className="text-right px-3 py-2.5 tabular-nums">{r.quoted.toLocaleString()}</td>
                      <td className="text-right px-3 py-2.5 tabular-nums">{r.won.toLocaleString()}</td>
                      <td className="text-right px-3 py-2.5 tabular-nums">
                        <span className={pctColor(r.winRate)}>{r.winRate}%</span>
                      </td>
                      <td className="text-right px-3 py-2.5 tabular-nums">{r.installs.toLocaleString()}</td>
                      <td className="text-right px-3 py-2.5 tabular-nums text-muted-foreground">{fmtDays(r.avgDaysToQualify)}</td>
                      <td className="text-right px-3 py-2.5 tabular-nums">{r.avgWonValue > 0 ? fmtAmt(r.avgWonValue) : "—"}</td>
                      <td className="text-right px-3 py-2.5 tabular-nums text-emerald-400">{r.totalWonValue > 0 ? fmtAmt(r.totalWonValue) : "—"}</td>
                      <td className="px-3 py-2.5 w-28"><FunnelBar row={r} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* ── Bar Chart ────────────────────────────────────────────────────── */}
        <TabsContent value="chart" className="mt-3 space-y-4">
          {funnelLoading ? <Skeleton className="h-64" /> : (
            <>
              {/* Lead volume by source */}
              <Card className="border border-border/50">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm">Lead Volume by Source</CardTitle>
                </CardHeader>
                <CardContent className="pb-4 px-4">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={chartRows} margin={{ left: 0, right: 0, top: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: 11 }} />
                      <Bar dataKey="totalLeads" name="Leads" radius={[3,3,0,0]}>
                        {chartRows.map(r => <Cell key={r.bucket} fill={BUCKET_COLORS[r.bucket] ?? "#6b7280"} />)}
                      </Bar>
                      <Bar dataKey="convertedLeads" name="Qualified" radius={[3,3,0,0]} fill="#3b82f6" opacity={0.6} />
                      <Bar dataKey="won" name="Won" radius={[3,3,0,0]} fill="#10b981" opacity={0.8} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Win rate ranking */}
              <Card className="border border-border/50">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm flex items-center gap-2"><Trophy className="h-4 w-4 text-amber-400" />Win Rate by Source</CardTitle>
                </CardHeader>
                <CardContent className="pb-4 px-4">
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={[...chartRows].sort((a,b) => b.winRate - a.winRate)} layout="vertical" margin={{ left: 80, right: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} domain={[0,100]} tickFormatter={v => `${v}%`} />
                      <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                      <Tooltip formatter={(v: any) => `${v}%`} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: 11 }} />
                      <Bar dataKey="winRate" name="Win Rate %" radius={[0,3,3,0]}>
                        {[...chartRows].sort((a,b) => b.winRate - a.winRate).map(r => (
                          <Cell key={r.bucket} fill={BUCKET_COLORS[r.bucket] ?? "#6b7280"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Avg deal value */}
              <Card className="border border-border/50">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm flex items-center gap-2"><DollarSign className="h-4 w-4 text-emerald-400" />Average Won Deal Value by Source</CardTitle>
                </CardHeader>
                <CardContent className="pb-4 px-4">
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={[...chartRows].filter(r => r.avgWonValue > 0).sort((a,b) => b.avgWonValue - a.avgWonValue)} margin={{ left: 0, right: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => fmtAmt(v)} />
                      <Tooltip formatter={(v: any) => fmtAmt(v)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: 11 }} />
                      <Bar dataKey="avgWonValue" name="Avg Won Value" radius={[3,3,0,0]} fill="#10b981">
                        {[...chartRows].filter(r => r.avgWonValue > 0).sort((a,b) => b.avgWonValue - a.avgWonValue).map(r => (
                          <Cell key={r.bucket} fill={BUCKET_COLORS[r.bucket] ?? "#6b7280"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ── Raw Sources Audit ────────────────────────────────────────────── */}
        <TabsContent value="raw" className="mt-3">
          <Card className="border border-border/50">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Layers className="h-4 w-4" />
                Raw Source Values → Normalized Buckets
              </CardTitle>
              <p className="text-xs text-muted-foreground">Top 100 raw source strings with their automatic normalization. Edit <code>server/source-attribution.ts</code> to adjust mappings.</p>
            </CardHeader>
            <CardContent className="pb-4 px-4">
              <div className="rounded-lg border border-border/40 overflow-auto max-h-96">
                <table className="w-full text-xs" data-testid="raw-sources-table">
                  <thead>
                    <tr className="border-b border-border/40 bg-muted/20">
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Raw Value</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Normalized Bucket</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(rawSources?.data ?? []).map((r: any) => (
                      <tr key={r.raw} className="border-b border-border/20 hover:bg-muted/20" data-testid={`row-raw-${r.raw?.slice(0,10)}`}>
                        <td className="px-3 py-1.5 font-mono">{r.raw}</td>
                        <td className="px-3 py-1.5">
                          <Badge variant="outline" className="text-[10px] px-1.5" style={{ borderColor: BUCKET_COLORS[r.bucket], color: BUCKET_COLORS[r.bucket] }}>
                            {r.label}
                          </Badge>
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{r.count.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Insight callouts */}
      {!funnelLoading && rows.length > 0 && (() => {
        const best = [...rows].sort((a,b) => b.winRate - a.winRate)[0];
        const highVol = [...rows].sort((a,b) => b.totalLeads - a.totalLeads)[0];
        const lowConv = [...rows].filter(r => r.totalLeads > 50).sort((a,b) => a.qualifyRate - b.qualifyRate)[0];
        return (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
            {best && (
              <div className="rounded-lg p-3 border border-emerald-500/30 bg-emerald-500/5 flex items-start gap-2">
                <Trophy className="h-4 w-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div className="text-xs">
                  <div className="font-semibold text-emerald-400 mb-0.5">Best Converter</div>
                  <span className="text-muted-foreground">{best.label} closes at </span>
                  <span className="font-medium text-foreground">{best.winRate}% win rate</span>
                  {best.avgWonValue > 0 && <span className="text-muted-foreground"> · avg {fmtAmt(best.avgWonValue)}/deal</span>}
                </div>
              </div>
            )}
            {highVol && (
              <div className="rounded-lg p-3 border border-blue-500/30 bg-blue-500/5 flex items-start gap-2">
                <Users className="h-4 w-4 text-blue-400 flex-shrink-0 mt-0.5" />
                <div className="text-xs">
                  <div className="font-semibold text-blue-400 mb-0.5">Highest Volume</div>
                  <span className="text-muted-foreground">{highVol.label} generates </span>
                  <span className="font-medium text-foreground">{highVol.totalLeads.toLocaleString()} leads</span>
                  <span className="text-muted-foreground"> ({highVol.qualifyRate}% qualify)</span>
                </div>
              </div>
            )}
            {lowConv && lowConv.qualifyRate < 20 && (
              <div className="rounded-lg p-3 border border-amber-500/30 bg-amber-500/5 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="text-xs">
                  <div className="font-semibold text-amber-400 mb-0.5">Low Conversion</div>
                  <span className="text-muted-foreground">{lowConv.label} has </span>
                  <span className="font-medium text-foreground">{lowConv.totalLeads.toLocaleString()} leads</span>
                  <span className="text-muted-foreground"> but only {lowConv.qualifyRate}% qualify</span>
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
