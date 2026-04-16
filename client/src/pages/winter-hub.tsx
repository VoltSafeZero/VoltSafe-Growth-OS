import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Snowflake, AlertTriangle, CheckCircle2, Clock, TrendingUp,
  Package, BookOpen, BarChart3, Inbox, Plus, Search, RefreshCw,
  Globe, Star, MessageSquare, Zap, Copy, Check, ChevronRight,
  Edit, FileText, Users, Target, ShieldAlert, Activity,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

// ── Types ─────────────────────────────────────────────────────────────────────

interface WinterProduct {
  id: number; name: string; sku?: string; version?: string; launchYear?: number;
  certifications?: string[]; unitsSold?: number; channels?: string[];
  status: string; notes?: string;
}

interface WinterCase {
  id: number; caseNumber: string; customerName?: string; customerEmail?: string;
  issueType: string; severity: string; status: string; subject?: string;
  bodyExcerpt?: string; country?: string; autoDetected?: boolean;
  sentimentScore?: number; productName?: string; ownerName?: string;
  firstResponseAt?: string; resolvedAt?: string; lastCustomerReplyAt?: string;
  daysOpen?: number; tags?: string[]; createdAt: string;
}

interface KbArticle {
  id: number; title: string; issueType: string; description?: string;
  approvedResponse?: string; internalNotes?: string; status: string;
  relatedCaseCount?: number; createdAt: string;
}

interface ResponseTemplate {
  id: number; name: string; issueType: string; subjectTemplate?: string;
  bodyTemplate: string; tags?: string[]; isActive: boolean; sortOrder: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ISSUE_TYPES = [
  "warranty", "troubleshooting", "replacement", "complaint",
  "feature_request", "retailer_inquiry", "reorder_interest", "general",
  "overheating", "charging_issue", "magnet_issue", "cable_wear", "compatibility",
];

const ISSUE_LABELS: Record<string, string> = {
  warranty: "Warranty", troubleshooting: "Troubleshooting", replacement: "Replacement",
  complaint: "Complaint", feature_request: "Feature Request", retailer_inquiry: "Retailer Inquiry",
  reorder_interest: "Reorder Interest", general: "General", overheating: "Overheating",
  charging_issue: "Charging Issue", magnet_issue: "Magnet Issue",
  cable_wear: "Cable Wear", compatibility: "Compatibility",
};

const STATUSES = ["new", "triaging", "open", "in_progress", "awaiting_customer", "escalated", "resolved", "closed"];
const STATUS_LABELS: Record<string, string> = {
  new: "New", triaging: "Triaging", open: "Open", in_progress: "In Progress",
  awaiting_customer: "Awaiting Customer", escalated: "Escalated",
  resolved: "Resolved", closed: "Closed",
};
const SEVERITIES = ["low", "medium", "high", "critical"];
const PRODUCT_STATUSES = ["legacy", "active", "paused", "relaunch_candidate"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function issueBadge(type: string) {
  const colors: Record<string, string> = {
    complaint: "bg-red-500/10 text-red-400 border-red-500/30",
    warranty: "bg-orange-500/10 text-orange-400 border-orange-500/30",
    troubleshooting: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    replacement: "bg-rose-500/10 text-rose-400 border-rose-500/30",
    retailer_inquiry: "bg-violet-500/10 text-violet-400 border-violet-500/30",
    reorder_interest: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    feature_request: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  };
  return `border text-xs px-2 py-0.5 rounded-full font-medium ${colors[type] ?? "bg-muted text-muted-foreground border-border"}`;
}

function severityColor(s: string) {
  return s === "critical" ? "text-red-400" : s === "high" ? "text-orange-400"
    : s === "medium" ? "text-amber-400" : "text-blue-400";
}

function statusBadgeClass(s: string) {
  if (s === "escalated") return "bg-red-500/10 text-red-400 border border-red-500/30";
  if (s === "new") return "bg-cyan-500/10 text-cyan-400 border border-cyan-500/30";
  if (s === "triaging") return "bg-violet-500/10 text-violet-400 border border-violet-500/30";
  if (s === "in_progress") return "bg-amber-500/10 text-amber-400 border border-amber-500/30";
  if (s === "awaiting_customer") return "bg-purple-500/10 text-purple-400 border border-purple-500/30";
  if (s === "open") return "bg-blue-500/10 text-blue-400 border border-blue-500/30";
  if (s === "resolved" || s === "closed") return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30";
  return "bg-muted text-muted-foreground border border-border";
}

function productStatusBadge(s: string) {
  if (s === "active") return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30";
  if (s === "relaunch_candidate") return "bg-violet-500/10 text-violet-400 border border-violet-500/30";
  if (s === "paused") return "bg-amber-500/10 text-amber-400 border border-amber-500/30";
  return "bg-muted/30 text-muted-foreground border border-border";
}

function fmtHrs(hrs: number | null | undefined) {
  if (hrs == null) return "—";
  if (hrs < 1) return `${Math.round(hrs * 60)}m`;
  if (hrs < 24) return `${hrs.toFixed(1)}h`;
  return `${(hrs / 24).toFixed(1)}d`;
}

function fmtDays(d: number | null | undefined) {
  if (d == null) return "—";
  return d < 1 ? `${Math.round(d * 24)}h` : `${d.toFixed(1)}d`;
}

function sentimentEmoji(score?: number) {
  if (score == null) return null;
  if (score > 30) return "😊";
  if (score > -20) return "😐";
  return "😟";
}

// ── Shared stat card ──────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, color = "text-foreground", sub }: {
  label: string; value: string | number; icon: React.ElementType; color?: string; sub?: string;
}) {
  return (
    <Card className="border border-border/50 bg-card/80">
      <CardContent className="p-4 flex items-start gap-3">
        <div className={`p-2 rounded-lg bg-muted/30 shrink-0 ${color}`}><Icon className="h-4 w-4" /></div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`text-xl font-bold ${color}`}>{value}</p>
          {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Case Row ──────────────────────────────────────────────────────────────────

function CaseRow({ c, onEdit }: { c: WinterCase; onEdit: (c: WinterCase) => void }) {
  return (
    <Card className="border border-border/50 bg-card/80 hover:bg-card transition-colors" data-testid={`case-row-${c.id}`}>
      <CardContent className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs text-muted-foreground">{c.caseNumber}</span>
              <span className={issueBadge(c.issueType)}>{ISSUE_LABELS[c.issueType] ?? c.issueType}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadgeClass(c.status)}`}>{STATUS_LABELS[c.status] ?? c.status}</span>
              {c.autoDetected && <span className="text-[10px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 px-1.5 py-0.5 rounded-full">Auto</span>}
              {c.sentimentScore != null && <span className="text-sm">{sentimentEmoji(c.sentimentScore)}</span>}
              {c.firstResponseAt == null && c.status !== "resolved" && c.status !== "closed" && (
                <span className="text-[10px] bg-orange-500/10 text-orange-400 border border-orange-500/30 px-1.5 py-0.5 rounded-full">No response</span>
              )}
            </div>
            <p className="text-sm font-medium mt-0.5 truncate">{c.subject ?? `Case from ${c.customerName ?? c.customerEmail ?? "Unknown"}`}</p>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
              {c.customerName && <span>{c.customerName}</span>}
              {c.country && <span>· {c.country}</span>}
              {c.daysOpen != null && <span>· {fmtDays(c.daysOpen)} old</span>}
              <span>· {new Date(c.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-xs font-semibold ${severityColor(c.severity)}`}>{c.severity.toUpperCase()}</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(c)} data-testid={`button-edit-case-${c.id}`}>
              <Edit className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TAB: COMMAND CENTER
// ════════════════════════════════════════════════════════════════════════════

function CommandCenterTab() {
  const { data: dash, isLoading: dashLoading } = useQuery<any>({ queryKey: ["/api/winter/dashboard"] });
  const { data: metrics, isLoading: metricsLoading } = useQuery<any>({ queryKey: ["/api/winter/metrics"] });
  const { toast } = useToast();

  const scanMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/winter/scan-emails", { limitHours: 720 }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/winter/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/winter/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/winter/metrics"] });
      toast({ title: "Email scan complete", description: `${data.created} new cases from ${data.scanned} emails` });
    },
  });

  const isLoading = dashLoading || metricsLoading;
  if (isLoading) return <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>;

  const s = dash?.stats ?? {};
  const m = metrics?.sla ?? {};
  const dv = metrics?.demandVsDefect ?? {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Winter Command Center</h2>
          <p className="text-sm text-muted-foreground">Live support overview · SLA health · Relaunch demand</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => scanMutation.mutate()} disabled={scanMutation.isPending} data-testid="button-scan-emails">
          <RefreshCw className={`h-4 w-4 mr-2 ${scanMutation.isPending ? "animate-spin" : ""}`} />
          {scanMutation.isPending ? "Scanning…" : "Scan Emails"}
        </Button>
      </div>

      {/* Volume */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Open Cases" value={s.openCases ?? 0} icon={Inbox} color="text-blue-400" sub={`${s.inProgressCases ?? 0} in progress`} />
        <StatCard label="Critical / High" value={`${s.criticalCases ?? 0} / ${s.highCases ?? 0}`} icon={AlertTriangle} color="text-orange-400" sub="Needs attention" />
        <StatCard label="No First Response" value={m.noFirstResponse ?? 0} icon={Clock} color={m.noFirstResponse > 0 ? "text-orange-400" : "text-muted-foreground"} sub="Still awaiting reply" />
        <StatCard label="Escalated" value={m.escalated ?? 0} icon={ShieldAlert} color={m.escalated > 0 ? "text-red-400" : "text-muted-foreground"} sub="Needs urgent attention" />
      </div>

      {/* SLA */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5" /> SLA Performance
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Avg First Response" value={fmtHrs(m.avgFirstResponseHrs)} icon={Clock} color={m.avgFirstResponseHrs == null ? "text-muted-foreground" : m.avgFirstResponseHrs <= 24 ? "text-emerald-400" : "text-orange-400"} sub="Target: <24h" />
          <StatCard label="Avg Resolution" value={fmtHrs(m.avgResolutionHrs)} icon={CheckCircle2} color={m.avgResolutionHrs == null ? "text-muted-foreground" : m.avgResolutionHrs <= 72 ? "text-emerald-400" : "text-amber-400"} sub="Target: <72h" />
          <StatCard label="Avg Days Open" value={fmtDays(m.avgDaysOpen)} icon={BarChart3} color="text-violet-400" sub="Active cases" />
          <StatCard label="Oldest Open" value={fmtDays(m.maxDaysOpen)} icon={AlertTriangle} color={m.maxDaysOpen > 14 ? "text-red-400" : "text-muted-foreground"} sub="Max age" />
        </div>
      </div>

      {/* Demand vs Defect */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="border border-border/50 bg-card/80">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-400" /> Demand Signals
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {[
              { label: "Reorder / Retailer Interest", value: dv.demand_cases ?? 0, color: "text-emerald-400" },
              { label: "Unique Demand Sources", value: dv.unique_demand_sources ?? 0, color: "text-emerald-400" },
              { label: "Feature Requests", value: dv.feature_cases ?? 0, color: "text-blue-400" },
            ].map(r => (
              <div key={r.label} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{r.label}</span>
                <span className={`font-semibold ${r.color}`}>{r.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border border-border/50 bg-card/80">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-orange-400" /> Defect Burden
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {[
              { label: "Support / Defect Cases", value: dv.defect_cases ?? 0, color: "text-orange-400" },
              { label: "Technical Defects", value: dv.technical_defects ?? 0, color: "text-amber-400" },
              { label: "Critical Defects (open)", value: dv.critical_defects ?? 0, color: "text-red-400" },
            ].map(r => (
              <div key={r.label} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{r.label}</span>
                <span className={`font-semibold ${r.color}`}>{r.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border border-border/50 bg-card/80">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <Target className="h-3.5 w-3.5 text-violet-400" /> Relaunch Signal
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {[
              { label: "Demand Score", value: `${dash?.demandScore ?? 0}/100`, color: dash?.demandScore >= 70 ? "text-emerald-400" : dash?.demandScore >= 40 ? "text-amber-400" : "text-muted-foreground" },
              { label: "Reorder Signals", value: dash?.reorderSignals ?? 0, color: "text-emerald-400" },
              { label: "Revenue Opportunity", value: (dash?.revenueOpportunity ?? 0) > 0 ? `$${((dash?.revenueOpportunity ?? 0) / 1000).toFixed(0)}k` : "—", color: "text-emerald-400" },
            ].map(r => (
              <div key={r.label} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{r.label}</span>
                <span className={`font-semibold ${r.color}`}>{r.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Top issues + weekly trend */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="border border-border/50 bg-card/80">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-orange-400" /> Issue Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {(metrics?.byType ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No cases yet</p> : null}
            {(metrics?.byType ?? []).map((issue: any) => (
              <div key={issue.issueType} className="flex items-center justify-between">
                <span className={issueBadge(issue.issueType)}>{ISSUE_LABELS[issue.issueType] ?? issue.issueType}</span>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="text-blue-400 font-medium">{issue.open_count} open</span>
                  <span>{issue.total} total</span>
                  {issue.avg_res_hrs != null && <span className="text-emerald-400">{fmtHrs(Number(issue.avg_res_hrs))} avg</span>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border border-border/50 bg-card/80">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <BarChart3 className="h-3.5 w-3.5 text-blue-400" /> Weekly Trend
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {(metrics?.weeklyTrend ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No trend data yet</p>
            ) : (
              <div className="flex items-end gap-1.5 h-16">
                {(metrics.weeklyTrend ?? []).map((w: any, i: number) => {
                  const h = Math.max(4, Math.min(100, Number(w.new_cases) * 10));
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div className="w-full bg-blue-400/70 rounded-sm" style={{ height: `${h}%` }} title={`${w.new_cases} new cases`} />
                      <span className="text-[9px] text-muted-foreground">{String(w.week).slice(5, 10)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TAB: CASES
// ════════════════════════════════════════════════════════════════════════════

function CasesTab() {
  const { toast } = useToast();
  const [view, setView] = useState<"list" | "queues">("list");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [issueFilter, setIssueFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [editCase, setEditCase] = useState<WinterCase | null>(null);

  const { data: cases = [], isLoading: casesLoading } = useQuery<WinterCase[]>({
    queryKey: ["/api/winter/cases", statusFilter, issueFilter, search],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (issueFilter !== "all") params.set("issueType", issueFilter);
      if (search) params.set("search", search);
      return fetch(`/api/winter/cases?${params}`, { credentials: "include" }).then(r => r.json());
    },
    enabled: view === "list",
  });

  const { data: queues, isLoading: queuesLoading } = useQuery<any>({
    queryKey: ["/api/winter/queues"],
    enabled: view === "queues",
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/winter/cases", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/winter/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/winter/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/winter/queues"] });
      toast({ title: "Case created" });
      setShowCreate(false);
    },
    onError: () => toast({ title: "Failed to create case", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: any) => apiRequest("PUT", `/api/winter/cases/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/winter/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/winter/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/winter/queues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/winter/metrics"] });
      toast({ title: "Case updated" });
      setEditCase(null);
    },
    onError: () => toast({ title: "Failed to update case", variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="flex rounded-lg border border-border overflow-hidden text-xs">
            <button className={`px-3 py-1.5 ${view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => setView("list")} data-testid="view-list">All Cases</button>
            <button className={`px-3 py-1.5 ${view === "queues" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => setView("queues")} data-testid="view-queues">
              Queues {queues?.counts && (
                <span className="ml-1 bg-red-500 text-white text-[10px] px-1 rounded-full">
                  {(queues.counts.unassigned ?? 0) + (queues.counts.highSeverity ?? 0) + (queues.counts.escalated ?? 0)}
                </span>
              )}
            </button>
          </div>
          {view === "list" && (
            <>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-sm w-44" data-testid="input-case-search" />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36 h-8 text-xs" data-testid="select-case-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  {STATUSES.map(s => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={issueFilter} onValueChange={setIssueFilter}>
                <SelectTrigger className="w-40 h-8 text-xs" data-testid="select-case-issue"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Issues</SelectItem>
                  {Object.entries(ISSUE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </>
          )}
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-create-case">
          <Plus className="h-4 w-4 mr-1" /> New Case
        </Button>
      </div>

      {/* List view */}
      {view === "list" && (
        casesLoading ? (
          <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded" />)}</div>
        ) : cases.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Inbox className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No cases found</p>
            <p className="text-xs mt-1">Adjust filters or run an email scan</p>
          </div>
        ) : (
          <div className="space-y-2">
            {cases.map(c => <CaseRow key={c.id} c={c} onEdit={setEditCase} />)}
          </div>
        )
      )}

      {/* Queues view */}
      {view === "queues" && (
        queuesLoading ? (
          <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32 rounded" />)}</div>
        ) : (
          <div className="space-y-4">
            {[
              { key: "escalated", label: "Escalated", icon: ShieldAlert, color: "text-red-400", emptyMsg: "No escalated cases" },
              { key: "highSeverity", label: "High Severity", icon: AlertTriangle, color: "text-orange-400", emptyMsg: "No high/critical open cases" },
              { key: "unassigned", label: "Unassigned", icon: Users, color: "text-amber-400", emptyMsg: "All cases have owners" },
              { key: "retailer", label: "Retailer Queue", icon: Globe, color: "text-violet-400", emptyMsg: "No open retailer inquiries" },
              { key: "relaunches", label: "Relaunch Interest", icon: TrendingUp, color: "text-emerald-400", emptyMsg: "No reorder signals" },
              { key: "awaitingCustomer", label: "Awaiting Customer", icon: Clock, color: "text-purple-400", emptyMsg: "No cases awaiting replies" },
            ].map(({ key, label, icon: Icon, color, emptyMsg }) => {
              const items: WinterCase[] = queues?.[key] ?? [];
              return (
                <Card key={key} className="border border-border/50 bg-card/80">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                      <Icon className={`h-3.5 w-3.5 ${color}`} />
                      {label}
                      <span className={`ml-1 text-[10px] font-bold ${items.length > 0 ? color : "text-muted-foreground"}`}>({items.length})</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    {items.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{emptyMsg}</p>
                    ) : (
                      <div className="space-y-2">
                        {items.slice(0, 8).map((c: any) => <CaseRow key={c.id} c={c} onEdit={setEditCase} />)}
                        {items.length > 8 && <p className="text-xs text-muted-foreground text-center">+{items.length - 8} more</p>}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )
      )}

      <CreateCaseDialog open={showCreate} onClose={() => setShowCreate(false)} onSave={d => createMutation.mutate(d)} saving={createMutation.isPending} />
      {editCase && <EditCaseDialog c={editCase} onClose={() => setEditCase(null)} onSave={d => updateMutation.mutate({ id: editCase.id, ...d })} saving={updateMutation.isPending} />}
    </div>
  );
}

function CreateCaseDialog({ open, onClose, onSave, saving }: { open: boolean; onClose: () => void; onSave: (d: any) => void; saving: boolean }) {
  const [form, setForm] = useState({ customerName: "", customerEmail: "", issueType: "general", severity: "medium", subject: "", bodyExcerpt: "", country: "", status: "new" });
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid="dialog-create-case">
        <DialogHeader><DialogTitle>New Support Case</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Customer Name</Label><Input value={form.customerName} onChange={e => set("customerName", e.target.value)} className="h-8 text-sm" data-testid="input-customer-name" /></div>
            <div className="space-y-1"><Label className="text-xs">Email</Label><Input value={form.customerEmail} onChange={e => set("customerEmail", e.target.value)} className="h-8 text-sm" data-testid="input-customer-email" /></div>
          </div>
          <div className="space-y-1"><Label className="text-xs">Subject</Label><Input value={form.subject} onChange={e => set("subject", e.target.value)} className="h-8 text-sm" data-testid="input-case-subject" /></div>
          <div className="grid grid-cols-4 gap-2">
            <div className="space-y-1 col-span-2"><Label className="text-xs">Issue Type</Label>
              <Select value={form.issueType} onValueChange={v => set("issueType", v)}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-issue-type"><SelectValue /></SelectTrigger>
                <SelectContent>{ISSUE_TYPES.map(t => <SelectItem key={t} value={t}>{ISSUE_LABELS[t] ?? t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label className="text-xs">Severity</Label>
              <Select value={form.severity} onValueChange={v => set("severity", v)}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-severity"><SelectValue /></SelectTrigger>
                <SelectContent>{SEVERITIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label className="text-xs">Status</Label>
              <Select value={form.status} onValueChange={v => set("status", v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.slice(0, 5).map(s => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1"><Label className="text-xs">Country</Label><Input value={form.country} onChange={e => set("country", e.target.value)} className="h-8 text-sm" data-testid="input-country" /></div>
          <div className="space-y-1"><Label className="text-xs">Notes / Excerpt</Label><Textarea value={form.bodyExcerpt} onChange={e => set("bodyExcerpt", e.target.value)} rows={3} className="text-sm resize-none" data-testid="input-body-excerpt" /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="button-cancel-case">Cancel</Button>
          <Button size="sm" onClick={() => onSave(form)} disabled={saving} data-testid="button-save-case">{saving ? "Creating…" : "Create Case"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditCaseDialog({ c, onClose, onSave, saving }: { c: WinterCase; onClose: () => void; onSave: (d: any) => void; saving: boolean }) {
  const [form, setForm] = useState({ status: c.status, issueType: c.issueType, severity: c.severity, resolution: "", country: c.country ?? "" });
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid={`dialog-edit-case-${c.id}`}>
        <DialogHeader><DialogTitle>Edit Case {c.caseNumber}</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-1">
          {/* SLA info if available */}
          {(c.firstResponseAt || c.resolvedAt) && (
            <div className="bg-muted/20 rounded-lg p-3 text-xs space-y-1">
              {c.firstResponseAt && <div className="flex justify-between"><span className="text-muted-foreground">First Response</span><span>{new Date(c.firstResponseAt).toLocaleString()}</span></div>}
              {c.resolvedAt && <div className="flex justify-between"><span className="text-muted-foreground">Resolved At</span><span>{new Date(c.resolvedAt).toLocaleString()}</span></div>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Status</Label>
              <Select value={form.status} onValueChange={v => set("status", v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label className="text-xs">Severity</Label>
              <Select value={form.severity} onValueChange={v => set("severity", v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{SEVERITIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1"><Label className="text-xs">Issue Type</Label>
            <Select value={form.issueType} onValueChange={v => set("issueType", v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{ISSUE_TYPES.map(t => <SelectItem key={t} value={t}>{ISSUE_LABELS[t] ?? t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Resolution Notes</Label>
            <Textarea value={form.resolution} onChange={e => set("resolution", e.target.value)} rows={3} className="text-sm resize-none" placeholder="Describe how this was resolved…" />
          </div>
          <p className="text-[10px] text-muted-foreground">
            Moving to In Progress, Resolved, or Closed will auto-stamp SLA timestamps.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => onSave(form)} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TAB: KNOWLEDGE BASE
// ════════════════════════════════════════════════════════════════════════════

function KnowledgeBaseTab() {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editArticle, setEditArticle] = useState<KbArticle | null>(null);

  const { data: articles = [], isLoading } = useQuery<KbArticle[]>({ queryKey: ["/api/winter/kb"] });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/winter/kb", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/winter/kb"] }); toast({ title: "Article created" }); setShowCreate(false); },
    onError: () => toast({ title: "Failed to create article", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: any) => apiRequest("PUT", `/api/winter/kb/${id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/winter/kb"] }); toast({ title: "Article updated" }); setEditArticle(null); },
    onError: () => toast({ title: "Failed to update article", variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h3 className="text-sm font-semibold">Known Issues + Approved Responses</h3>
          <p className="text-xs text-muted-foreground">{articles.length} articles</p></div>
        <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-create-article">
          <Plus className="h-4 w-4 mr-1" /> Add Article
        </Button>
      </div>
      {isLoading ? <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 rounded" />)}</div> :
        <div className="space-y-2">
          {articles.map(a => (
            <Card key={a.id} className="border border-border/50 bg-card/80" data-testid={`kb-article-${a.id}`}>
              <CardContent className="p-0">
                <button className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-muted/20 transition-colors"
                  onClick={() => setExpanded(expanded === a.id ? null : a.id)}>
                  <div className="flex items-center gap-3 min-w-0">
                    <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{a.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={issueBadge(a.issueType)}>{ISSUE_LABELS[a.issueType] ?? a.issueType}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${a.status === "active" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-muted/30 text-muted-foreground border-border"}`}>{a.status}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={e => { e.stopPropagation(); setEditArticle(a); }}><Edit className="h-3.5 w-3.5" /></Button>
                    <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${expanded === a.id ? "rotate-90" : ""}`} />
                  </div>
                </button>
                {expanded === a.id && (
                  <div className="px-4 pb-4 space-y-3 border-t border-border/30">
                    {a.description && <div className="pt-3"><p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Description</p><p className="text-sm text-muted-foreground">{a.description}</p></div>}
                    {a.approvedResponse && <div><p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wide mb-1">Approved Response</p><div className="bg-emerald-500/5 border border-emerald-500/20 rounded p-3 text-sm whitespace-pre-wrap">{a.approvedResponse}</div></div>}
                    {a.internalNotes && <div><p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wide mb-1">Internal Notes</p><div className="bg-amber-500/5 border border-amber-500/20 rounded p-3 text-sm text-muted-foreground">{a.internalNotes}</div></div>}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      }
      <KbArticleDialog open={showCreate} article={null} onClose={() => setShowCreate(false)} onSave={d => createMutation.mutate(d)} saving={createMutation.isPending} />
      {editArticle && <KbArticleDialog open article={editArticle} onClose={() => setEditArticle(null)} onSave={d => updateMutation.mutate({ id: editArticle.id, ...d })} saving={updateMutation.isPending} />}
    </div>
  );
}

function KbArticleDialog({ open, article, onClose, onSave, saving }: { open: boolean; article: KbArticle | null; onClose: () => void; onSave: (d: any) => void; saving: boolean }) {
  const [form, setForm] = useState({ title: article?.title ?? "", issueType: article?.issueType ?? "general", description: article?.description ?? "", approvedResponse: article?.approvedResponse ?? "", internalNotes: article?.internalNotes ?? "", status: article?.status ?? "active" });
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto" data-testid="dialog-kb-article">
        <DialogHeader><DialogTitle>{article ? "Edit Article" : "New KB Article"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-1">
          <div className="space-y-1"><Label className="text-xs">Title</Label><Input value={form.title} onChange={e => set("title", e.target.value)} className="h-8 text-sm" data-testid="input-kb-title" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Issue Type</Label><Select value={form.issueType} onValueChange={v => set("issueType", v)}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{ISSUE_TYPES.map(t => <SelectItem key={t} value={t}>{ISSUE_LABELS[t] ?? t}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1"><Label className="text-xs">Status</Label><Select value={form.status} onValueChange={v => set("status", v)}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="draft">Draft</SelectItem><SelectItem value="archived">Archived</SelectItem></SelectContent></Select></div>
          </div>
          <div className="space-y-1"><Label className="text-xs">Description</Label><Textarea value={form.description} onChange={e => set("description", e.target.value)} rows={2} className="text-sm resize-none" /></div>
          <div className="space-y-1"><Label className="text-xs">Approved Customer Response</Label><Textarea value={form.approvedResponse} onChange={e => set("approvedResponse", e.target.value)} rows={4} className="text-sm resize-none" data-testid="input-approved-response" /></div>
          <div className="space-y-1"><Label className="text-xs">Internal Notes</Label><Textarea value={form.internalNotes} onChange={e => set("internalNotes", e.target.value)} rows={2} className="text-sm resize-none" /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => onSave(form)} disabled={saving || !form.title}>{saving ? "Saving…" : article ? "Save Changes" : "Create Article"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TAB: RESPONSE TEMPLATES
// ════════════════════════════════════════════════════════════════════════════

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }
  return (
    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={copy} title="Copy to clipboard" data-testid="button-copy-template">
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

function TemplatesTab() {
  const { toast } = useToast();
  const [issueFilter, setIssueFilter] = useState("all");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editTemplate, setEditTemplate] = useState<ResponseTemplate | null>(null);

  const { data: templates = [], isLoading } = useQuery<ResponseTemplate[]>({
    queryKey: ["/api/winter/templates", issueFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (issueFilter !== "all") params.set("issueType", issueFilter);
      return fetch(`/api/winter/templates?${params}`, { credentials: "include" }).then(r => r.json());
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/winter/templates", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/winter/templates"] }); toast({ title: "Template created" }); setShowCreate(false); },
    onError: () => toast({ title: "Failed to create template", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: any) => apiRequest("PUT", `/api/winter/templates/${id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/winter/templates"] }); toast({ title: "Template updated" }); setEditTemplate(null); },
    onError: () => toast({ title: "Failed to update template", variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Select value={issueFilter} onValueChange={setIssueFilter}>
            <SelectTrigger className="w-44 h-8 text-xs" data-testid="select-template-issue"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Issue Types</SelectItem>
              {Object.entries(ISSUE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">{templates.length} templates</span>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-create-template">
          <Plus className="h-4 w-4 mr-1" /> Add Template
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 rounded" />)}</div>
      ) : templates.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No templates found</p>
      ) : (
        <div className="space-y-2">
          {templates.map(t => (
            <Card key={t.id} className={`border bg-card/80 transition-colors ${t.isActive ? "border-border/50" : "border-border/20 opacity-60"}`} data-testid={`template-card-${t.id}`}>
              <CardContent className="p-0">
                <button className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-muted/20 transition-colors"
                  onClick={() => setExpanded(expanded === t.id ? null : t.id)}>
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{t.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={issueBadge(t.issueType)}>{ISSUE_LABELS[t.issueType] ?? t.issueType}</span>
                        {!t.isActive && <span className="text-[10px] text-muted-foreground border border-border/40 px-1.5 py-0.5 rounded-full">Inactive</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <CopyButton text={t.bodyTemplate} />
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={e => { e.stopPropagation(); setEditTemplate(t); }} data-testid={`button-edit-template-${t.id}`}>
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                    <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${expanded === t.id ? "rotate-90" : ""}`} />
                  </div>
                </button>
                {expanded === t.id && (
                  <div className="px-4 pb-4 space-y-3 border-t border-border/30">
                    {t.subjectTemplate && (
                      <div className="pt-3">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Subject Line</p>
                          <CopyButton text={t.subjectTemplate} />
                        </div>
                        <p className="text-sm font-medium">{t.subjectTemplate}</p>
                      </div>
                    )}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wide">Response Body</p>
                        <CopyButton text={t.bodyTemplate} />
                      </div>
                      <div className="bg-muted/20 border border-border/40 rounded p-3 text-sm whitespace-pre-wrap text-muted-foreground font-mono text-xs leading-relaxed">
                        {t.bodyTemplate}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <TemplateDialog open={showCreate} template={null} onClose={() => setShowCreate(false)} onSave={d => createMutation.mutate(d)} saving={createMutation.isPending} />
      {editTemplate && <TemplateDialog open template={editTemplate} onClose={() => setEditTemplate(null)} onSave={d => updateMutation.mutate({ id: editTemplate.id, ...d })} saving={updateMutation.isPending} />}
    </div>
  );
}

function TemplateDialog({ open, template, onClose, onSave, saving }: { open: boolean; template: ResponseTemplate | null; onClose: () => void; onSave: (d: any) => void; saving: boolean }) {
  const [form, setForm] = useState({ name: template?.name ?? "", issueType: template?.issueType ?? "general", subjectTemplate: template?.subjectTemplate ?? "", bodyTemplate: template?.bodyTemplate ?? "", isActive: template?.isActive ?? true });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto" data-testid="dialog-template">
        <DialogHeader><DialogTitle>{template ? "Edit Template" : "New Response Template"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-1">
          <div className="space-y-1"><Label className="text-xs">Template Name *</Label><Input value={form.name} onChange={e => set("name", e.target.value)} className="h-8 text-sm" data-testid="input-template-name" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Issue Type</Label>
              <Select value={form.issueType} onValueChange={v => set("issueType", v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{ISSUE_TYPES.map(t => <SelectItem key={t} value={t}>{ISSUE_LABELS[t] ?? t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label className="text-xs">Active</Label>
              <Select value={form.isActive ? "true" : "false"} onValueChange={v => set("isActive", v === "true")}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="true">Active</SelectItem><SelectItem value="false">Inactive</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1"><Label className="text-xs">Subject Line (optional)</Label><Input value={form.subjectTemplate} onChange={e => set("subjectTemplate", e.target.value)} className="h-8 text-sm" placeholder="Re: Your VoltSafe Winter…" /></div>
          <div className="space-y-1"><Label className="text-xs">Response Body * (use {"{{customer_name}}"} for merge)</Label>
            <Textarea value={form.bodyTemplate} onChange={e => set("bodyTemplate", e.target.value)} rows={8} className="text-sm resize-none font-mono" data-testid="input-template-body" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => onSave(form)} disabled={saving || !form.name || !form.bodyTemplate}>{saving ? "Saving…" : template ? "Save Changes" : "Create Template"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TAB: DEMAND SIGNALS
// ════════════════════════════════════════════════════════════════════════════

function DemandSignalsTab() {
  const { data: signals, isLoading } = useQuery<any>({ queryKey: ["/api/winter/demand-signals"] });
  const { data: metrics } = useQuery<any>({ queryKey: ["/api/winter/metrics"] });

  if (isLoading) return <div className="grid lg:grid-cols-2 gap-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}</div>;

  const { byCountry = [], retailers = [], improvements = [], sentiment = {} } = signals ?? {};
  const dv = metrics?.demandVsDefect ?? {};

  const posNeg = Number(sentiment.positive ?? 0) + Number(sentiment.negative ?? 0);
  const npsEst = posNeg > 0 ? Math.round(((Number(sentiment.positive ?? 0) - Number(sentiment.negative ?? 0)) / posNeg) * 100) : null;

  return (
    <div className="space-y-4">
      {/* Demand vs Defect */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Demand vs Defect Signal</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Demand Cases" value={dv.demand_cases ?? 0} icon={TrendingUp} color="text-emerald-400" sub="Reorder + Retailer" />
          <StatCard label="Defect Cases" value={dv.defect_cases ?? 0} icon={AlertTriangle} color="text-orange-400" sub="Support burden" />
          <StatCard label="Technical Defects" value={dv.technical_defects ?? 0} icon={Zap} color="text-amber-400" sub="Overheating/cable/magnet" />
          <StatCard label="NPS Estimate" value={npsEst !== null ? (npsEst > 0 ? `+${npsEst}` : `${npsEst}`) : "—"} icon={MessageSquare} color={npsEst !== null && npsEst > 0 ? "text-emerald-400" : "text-red-400"} />
        </div>
      </div>

      {/* Defect hot spots */}
      {(metrics?.byType ?? []).length > 0 && (
        <Card className="border border-border/50 bg-card/80">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-orange-400" /> Defect Hot Spots
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {(metrics.byType ?? [])
              .filter((t: any) => !["reorder_interest", "retailer_inquiry", "feature_request", "general"].includes(t.issueType))
              .map((issue: any) => (
                <div key={issue.issueType} className="flex items-center justify-between">
                  <span className={issueBadge(issue.issueType)}>{ISSUE_LABELS[issue.issueType] ?? issue.issueType}</span>
                  <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-1.5">
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-orange-400 rounded-full" style={{ width: `${Math.min(100, Number(issue.total) * 8)}%` }} />
                      </div>
                      <span className="text-muted-foreground">{issue.total}</span>
                    </div>
                    <span className="text-blue-400">{issue.open_count} open</span>
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="border border-border/50 bg-card/80">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <Globe className="h-3.5 w-3.5 text-blue-400" /> Interest by Country
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {byCountry.length === 0 ? <p className="text-sm text-muted-foreground">No country data yet</p> : byCountry.map((c: any) => (
              <div key={c.country} className="flex items-center gap-3">
                <span className="text-sm flex-1">{c.country}</span>
                <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden"><div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.min(100, (c.count / (byCountry[0]?.count ?? 1)) * 100)}%` }} /></div>
                <span className="text-xs text-muted-foreground w-5 text-right">{c.count}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border border-border/50 bg-card/80">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <MessageSquare className="h-3.5 w-3.5 text-violet-400" /> Sentiment
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {[
              { label: "Positive", key: "positive", color: "bg-emerald-400" },
              { label: "Neutral", key: "neutral", color: "bg-amber-400" },
              { label: "Negative", key: "negative", color: "bg-red-400" },
            ].map(({ label, key, color }) => {
              const val = Number(sentiment[key] ?? 0);
              const total = Number(sentiment.positive ?? 0) + Number(sentiment.neutral ?? 0) + Number(sentiment.negative ?? 0);
              const pct = total > 0 ? Math.round((val / total) * 100) : 0;
              return (
                <div key={key} className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground"><span>{label}</span><span>{pct}% ({val})</span></div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden"><div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {retailers.length > 0 && (
        <Card className="border border-border/50 bg-card/80">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <Package className="h-3.5 w-3.5 text-violet-400" /> Retailers Asking
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {retailers.slice(0, 10).map((r: any, i: number) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="font-medium">{r.customerName ?? r.customerEmail}</span>
                <span className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {improvements.length > 0 && (
        <Card className="border border-border/50 bg-card/80">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <Star className="h-3.5 w-3.5 text-amber-400" /> Feature Requests
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {improvements.slice(0, 10).map((r: any, i: number) => (
              <div key={i} className="text-sm">
                <p className="font-medium truncate">{r.subject ?? "Feature request"}</p>
                {r.bodyExcerpt && <p className="text-xs text-muted-foreground truncate mt-0.5">{r.bodyExcerpt}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TAB: PRODUCTS
// ════════════════════════════════════════════════════════════════════════════

function ProductsTab() {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [editProduct, setEditProduct] = useState<WinterProduct | null>(null);

  const { data: products = [], isLoading } = useQuery<WinterProduct[]>({ queryKey: ["/api/winter/products"] });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/winter/products", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/winter/products"] }); toast({ title: "Product added" }); setShowCreate(false); },
    onError: () => toast({ title: "Failed to add product", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: any) => apiRequest("PUT", `/api/winter/products/${id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/winter/products"] }); toast({ title: "Product updated" }); setEditProduct(null); },
    onError: () => toast({ title: "Failed to update product", variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h3 className="text-sm font-semibold">Product Registry</h3><p className="text-xs text-muted-foreground">{products.length} products</p></div>
        <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-create-product"><Plus className="h-4 w-4 mr-1" /> Add Product</Button>
      </div>
      {isLoading ? <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div> : (
        <div className="grid lg:grid-cols-2 gap-4">
          {products.map(p => (
            <Card key={p.id} className="border border-border/50 bg-card/80" data-testid={`product-card-${p.id}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-semibold">{p.name}</h4>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${productStatusBadge(p.status)}`}>{p.status.replace("_", " ")}</span>
                    </div>
                    {p.sku && <p className="text-xs text-muted-foreground font-mono mt-0.5">{p.sku} {p.version && `· v${p.version}`} {p.launchYear && `· ${p.launchYear}`}</p>}
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditProduct(p)} data-testid={`button-edit-product-${p.id}`}><Edit className="h-3.5 w-3.5" /></Button>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  {p.unitsSold != null && <div><p className="text-muted-foreground">Units Sold</p><p className="font-semibold">{p.unitsSold.toLocaleString()}</p></div>}
                  {p.certifications && p.certifications.length > 0 && (
                    <div><p className="text-muted-foreground">Certifications</p>
                      <div className="flex gap-1 flex-wrap mt-0.5">{p.certifications.map(c => <span key={c} className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded text-[10px] font-medium">{c}</span>)}</div>
                    </div>
                  )}
                  {p.channels && p.channels.length > 0 && (
                    <div><p className="text-muted-foreground">Channels</p>
                      <div className="flex gap-1 flex-wrap mt-0.5">{p.channels.map(c => <span key={c} className="bg-blue-500/10 text-blue-400 border border-blue-500/30 px-1.5 py-0.5 rounded text-[10px]">{c}</span>)}</div>
                    </div>
                  )}
                </div>
                {p.notes && <p className="text-xs text-muted-foreground border-t border-border/30 pt-2">{p.notes}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <ProductDialog open={showCreate} product={null} onClose={() => setShowCreate(false)} onSave={d => createMutation.mutate(d)} saving={createMutation.isPending} />
      {editProduct && <ProductDialog open product={editProduct} onClose={() => setEditProduct(null)} onSave={d => updateMutation.mutate({ id: editProduct.id, ...d })} saving={updateMutation.isPending} />}
    </div>
  );
}

function ProductDialog({ open, product, onClose, onSave, saving }: { open: boolean; product: WinterProduct | null; onClose: () => void; onSave: (d: any) => void; saving: boolean }) {
  const [form, setForm] = useState({ name: product?.name ?? "", sku: product?.sku ?? "", version: product?.version ?? "", launchYear: product?.launchYear?.toString() ?? "", unitsSold: product?.unitsSold?.toString() ?? "", certifications: (product?.certifications ?? []).join(", "), channels: (product?.channels ?? []).join(", "), status: product?.status ?? "legacy", notes: product?.notes ?? "" });
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  const data = () => ({ ...form, launchYear: form.launchYear ? Number(form.launchYear) : null, unitsSold: form.unitsSold ? Number(form.unitsSold) : 0, certifications: form.certifications.split(",").map((s: string) => s.trim()).filter(Boolean), channels: form.channels.split(",").map((s: string) => s.trim()).filter(Boolean) });
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid="dialog-product">
        <DialogHeader><DialogTitle>{product ? "Edit Product" : "New Product"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-1">
          <div className="space-y-1"><Label className="text-xs">Product Name *</Label><Input value={form.name} onChange={e => set("name", e.target.value)} className="h-8 text-sm" data-testid="input-product-name" /></div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1"><Label className="text-xs">SKU</Label><Input value={form.sku} onChange={e => set("sku", e.target.value)} className="h-8 text-sm font-mono" /></div>
            <div className="space-y-1"><Label className="text-xs">Version</Label><Input value={form.version} onChange={e => set("version", e.target.value)} className="h-8 text-sm" /></div>
            <div className="space-y-1"><Label className="text-xs">Launch Year</Label><Input value={form.launchYear} onChange={e => set("launchYear", e.target.value)} className="h-8 text-sm" type="number" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Units Sold</Label><Input value={form.unitsSold} onChange={e => set("unitsSold", e.target.value)} className="h-8 text-sm" type="number" /></div>
            <div className="space-y-1"><Label className="text-xs">Status</Label><Select value={form.status} onValueChange={v => set("status", v)}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{PRODUCT_STATUSES.map(s => <SelectItem key={s} value={s}>{s.replace("_"," ")}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="space-y-1"><Label className="text-xs">Certifications (comma-separated)</Label><Input value={form.certifications} onChange={e => set("certifications", e.target.value)} className="h-8 text-sm" placeholder="CSA, UL, ETL" /></div>
          <div className="space-y-1"><Label className="text-xs">Channels (comma-separated)</Label><Input value={form.channels} onChange={e => set("channels", e.target.value)} className="h-8 text-sm" placeholder="amazon, retail, dtc" /></div>
          <div className="space-y-1"><Label className="text-xs">Notes</Label><Textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={2} className="text-sm resize-none" /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => onSave(data())} disabled={saving || !form.name}>{saving ? "Saving…" : product ? "Save Changes" : "Add Product"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ════════════════════════════════════════════════════════════════════════════

export default function WinterHubPage() {
  return (
    <>
      <title>Winter Support — VoltSafe Growth OS</title>
      <div className="flex-1 flex flex-col min-h-0 overflow-auto">
        <div className="max-w-6xl mx-auto w-full px-4 py-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20">
              <Snowflake className="h-6 w-6 text-blue-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Winter Support</h1>
              <p className="text-sm text-muted-foreground">Legacy product ops · Case workflow · Response automation</p>
            </div>
          </div>

          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList className="h-9 text-xs flex-wrap" data-testid="winter-tabs">
              <TabsTrigger value="overview" className="text-xs" data-testid="tab-overview">Command Center</TabsTrigger>
              <TabsTrigger value="cases" className="text-xs" data-testid="tab-cases">Cases</TabsTrigger>
              <TabsTrigger value="kb" className="text-xs" data-testid="tab-kb">Knowledge Base</TabsTrigger>
              <TabsTrigger value="templates" className="text-xs" data-testid="tab-templates">Templates</TabsTrigger>
              <TabsTrigger value="demand" className="text-xs" data-testid="tab-demand">Demand Signals</TabsTrigger>
              <TabsTrigger value="products" className="text-xs" data-testid="tab-products">Products</TabsTrigger>
            </TabsList>

            <TabsContent value="overview"><CommandCenterTab /></TabsContent>
            <TabsContent value="cases"><CasesTab /></TabsContent>
            <TabsContent value="kb"><KnowledgeBaseTab /></TabsContent>
            <TabsContent value="templates"><TemplatesTab /></TabsContent>
            <TabsContent value="demand"><DemandSignalsTab /></TabsContent>
            <TabsContent value="products"><ProductsTab /></TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  );
}
