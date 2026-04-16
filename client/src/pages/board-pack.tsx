import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  FileText, Download, Printer, ChevronRight, AlertTriangle,
  TrendingUp, DollarSign, Package, Shield, Users, Globe,
  BarChart3, Zap, BookOpen, Save, Trash2, Play, RefreshCw,
  Calendar, Clock, Send, Pause, History, Plus, Mail, Bell,
  CheckCircle, XCircle, Timer, Settings,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
type ReportType = { value: string; label: string; description: string };
type SectionMeta = { key: string; label: string; description: string; defaultFor: string[] };
type ReportData = Record<string, any>;
type Preset = { id: number; name: string; reportType: string; dateRangePreset: string; includedSections: string[]; description?: string; createdAt: string };

type Schedule = {
  id: number;
  name: string;
  enabled: boolean;
  schedule_type: string;
  weekday?: number | null;
  day_of_month?: number | null;
  month_in_quarter?: number | null;
  send_hour: number;
  timezone: string;
  report_type: string;
  preset_id?: number | null;
  included_sections: string[];
  recipients: string[];
  delivery_channels: string[];
  last_run_at?: string | null;
  next_run_at?: string | null;
  last_status?: string | null;
  last_error?: string | null;
  run_count?: number;
  delivered_count?: number;
  created_at: string;
};

type ScheduleRun = {
  id: number;
  schedule_id: number;
  status: string;
  report_type?: string;
  recipient_count: number;
  errors?: string | null;
  triggered_by?: number | null;
  generated_at: string;
  delivered_at?: string | null;
  schedule_name?: string;
};

const DATE_PRESETS = [
  { value: "this_week", label: "This Week" },
  { value: "this_month", label: "This Month" },
  { value: "this_quarter", label: "This Quarter" },
  { value: "last_month", label: "Last Month" },
  { value: "last_quarter", label: "Last Quarter" },
  { value: "custom", label: "Custom Range" },
];

const SECTION_ICONS: Record<string, any> = {
  kpi_summary: BarChart3,
  pipeline_forecast: TrendingUp,
  quote_snapshot: DollarSign,
  installs_deployments: Package,
  procurement_risks: AlertTriangle,
  certification_oversight: Shield,
  customer_success: Users,
  geography_territory: Globe,
  source_attribution: Zap,
  risk_blockers: AlertTriangle,
  narrative_bullets: BookOpen,
};

// ── Format helpers ────────────────────────────────────────────────────────────
const fmtCurrency = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M`
  : v >= 1_000 ? `$${(v / 1_000).toFixed(0)}k`
  : `$${v.toFixed(0)}`;

const fmtNum = (v: number) => v.toLocaleString();
const pct = (v: number) => `${v}%`;

// ── Report Preview Sections ───────────────────────────────────────────────────

function SectionCard({ title, icon: Icon, children }: { title: string; icon?: any; children: React.ReactNode }) {
  return (
    <div className="report-section mb-6 break-inside-avoid">
      <h2 className="flex items-center gap-2 text-base font-semibold text-foreground mb-3 pb-2 border-b border-border">
        {Icon && <Icon className="w-4 h-4 text-primary" />}
        {title}
      </h2>
      {children}
    </div>
  );
}

function KpiSummarySection({ data }: { data: ReportData["kpiSummary"] }) {
  if (!data) return null;
  const kpis = [
    { label: "Total Pipeline", value: fmtCurrency(data.totalPipeline), sub: `${fmtCurrency(data.weightedPipeline)} weighted` },
    { label: "Closed-Won Revenue", value: fmtCurrency(data.closedWonAmount), sub: `${fmtNum(data.totalOpps)} open opps` },
    { label: "Quote Win Rate", value: pct(data.winRate), sub: `${fmtCurrency(data.acceptedRevenue)} accepted` },
    { label: "Lead Conversion", value: pct(data.conversionRate), sub: `${fmtNum(data.totalLeads)} leads tracked` },
    { label: "Installs In Progress", value: fmtNum(data.installsInProgress), sub: `${data.installBlockers} with blockers` },
    { label: "Overdue Tasks", value: fmtNum(data.overdueTasks), sub: `${data.unownedLeads} unowned leads` },
  ];
  return (
    <SectionCard title="KPI Summary" icon={BarChart3}>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3" data-testid="kpi-summary-grid">
        {kpis.map(k => (
          <div key={k.label} className="bg-muted/40 rounded-lg p-3">
            <div className="text-xs text-muted-foreground">{k.label}</div>
            <div className="text-xl font-bold text-foreground mt-0.5">{k.value}</div>
            <div className="text-xs text-muted-foreground">{k.sub}</div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function PipelineForecastSection({ data }: { data: ReportData["pipelineForecast"] }) {
  if (!data || !data.periods?.length) return null;
  return (
    <SectionCard title="Pipeline Forecast" icon={TrendingUp}>
      <div className="mb-2 flex gap-4 text-sm text-muted-foreground">
        <span>Commit: <strong className="text-foreground">{fmtCurrency(data.totalCommit)}</strong></span>
        <span>Best Case: <strong className="text-foreground">{fmtCurrency(data.totalBestCase)}</strong></span>
        <span>Weighted: <strong className="text-foreground">{fmtCurrency(data.totalWeightedForecast)}</strong></span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="pipeline-forecast-table">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="pb-1 pr-4 font-medium">Month</th>
              <th className="pb-1 pr-4 font-medium text-right">Commit</th>
              <th className="pb-1 pr-4 font-medium text-right">Best Case</th>
              <th className="pb-1 pr-4 font-medium text-right">Pipeline</th>
              <th className="pb-1 font-medium text-right">Closed Won</th>
            </tr>
          </thead>
          <tbody>
            {data.periods.map((p: any) => (
              <tr key={p.month} className="border-b border-border/50">
                <td className="py-1.5 pr-4 font-medium">{p.label}</td>
                <td className="py-1.5 pr-4 text-right">{p.commitAmount > 0 ? fmtCurrency(p.commitAmount) : "—"}</td>
                <td className="py-1.5 pr-4 text-right">{p.bestCaseAmount > 0 ? fmtCurrency(p.bestCaseAmount) : "—"}</td>
                <td className="py-1.5 pr-4 text-right">{p.pipelineAmount > 0 ? fmtCurrency(p.pipelineAmount) : "—"}</td>
                <td className="py-1.5 text-right">{p.closedWonAmount > 0 ? fmtCurrency(p.closedWonAmount) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

function QuoteSnapshotSection({ data }: { data: ReportData["quoteSnapshot"] }) {
  if (!data) return null;
  return (
    <SectionCard title="Quote Snapshot" icon={DollarSign}>
      <div className="flex flex-wrap gap-4 mb-3 text-sm">
        {[
          { l: "Total Quotes", v: fmtNum(data.total) },
          { l: "Sent", v: fmtNum(data.sent) },
          { l: "Accepted", v: fmtNum(data.accepted) },
          { l: "Win Rate", v: pct(data.winRate) },
          { l: "Accepted Revenue", v: fmtCurrency(data.acceptedRevenue) },
          { l: "Avg. Value", v: fmtCurrency(data.avgAcceptedValue) },
          { l: "Awaiting Reply", v: fmtNum(data.awaitingResponse), warn: data.awaitingResponse > 3 },
        ].map(({ l, v, warn }) => (
          <div key={l} className={`text-center px-3 py-2 rounded-lg ${warn ? "bg-amber-500/10 border border-amber-500/30" : "bg-muted/40"}`}>
            <div className="text-xs text-muted-foreground">{l}</div>
            <div className={`text-lg font-bold ${warn ? "text-amber-600 dark:text-amber-400" : ""}`}>{v}</div>
          </div>
        ))}
      </div>
      {data.recentQuotes?.length > 0 && (
        <table className="w-full text-sm" data-testid="quote-snapshot-table">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border text-xs">
              <th className="pb-1 pr-3">Quote #</th>
              <th className="pb-1 pr-3">Account</th>
              <th className="pb-1 pr-3">Status</th>
              <th className="pb-1 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.recentQuotes.map((q: any) => (
              <tr key={q.id} className="border-b border-border/40">
                <td className="py-1 pr-3 font-mono text-xs">{q.quoteNumber}</td>
                <td className="py-1 pr-3">{q.companyName}</td>
                <td className="py-1 pr-3">
                  <Badge variant={q.status === "accepted" ? "default" : q.status === "declined" ? "destructive" : "secondary"} className="text-xs">{q.status}</Badge>
                </td>
                <td className="py-1 text-right">{fmtCurrency(q.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}

function InstallsSection({ data }: { data: ReportData["installsDeployments"] }) {
  if (!data) return null;
  return (
    <SectionCard title="Installs & Deployments" icon={Package}>
      <div className="flex flex-wrap gap-3 mb-3">
        {[
          { l: "In Progress", v: data.inProgress, color: "text-blue-600 dark:text-blue-400" },
          { l: "Pending Kickoff", v: data.pendingKickoff, color: "text-amber-600 dark:text-amber-400" },
          { l: "Complete", v: data.complete, color: "text-green-600 dark:text-green-400" },
          { l: "On Hold", v: data.onHold, color: "text-muted-foreground" },
          { l: "With Blockers", v: data.withBlockers, color: "text-red-600 dark:text-red-400" },
          { l: "Overdue", v: data.overdue, color: "text-red-600 dark:text-red-400" },
          { l: "Completed This Month", v: data.completedThisMonth, color: "text-green-600 dark:text-green-400" },
        ].map(({ l, v, color }) => (
          <div key={l} className="bg-muted/40 rounded-lg px-3 py-2 text-center min-w-[80px]">
            <div className="text-xs text-muted-foreground">{l}</div>
            <div className={`text-xl font-bold ${color}`}>{v}</div>
          </div>
        ))}
      </div>
      {data.recentBlockers?.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground font-medium mb-1">Active blockers:</p>
          <ul className="space-y-1">
            {data.recentBlockers.map((b: any) => (
              <li key={b.id} className="text-sm flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                <span><strong>{b.accountName}</strong>: {b.blockers}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

function ProcurementSection({ data }: { data: ReportData["procurementRisks"] }) {
  if (!data) return null;
  return (
    <SectionCard title="Procurement Risks" icon={AlertTriangle}>
      <div className="flex flex-wrap gap-3 mb-3">
        {[
          { l: "Low-Stock Items", v: data.lowStockItems, warn: data.lowStockItems > 0 },
          { l: "Pending POs", v: data.pendingPOs },
          { l: "Blocked Installs", v: data.blockedInstalls, warn: data.blockedInstalls > 0 },
        ].map(({ l, v, warn }) => (
          <div key={l} className={`rounded-lg px-3 py-2 text-center ${warn ? "bg-red-500/10" : "bg-muted/40"}`}>
            <div className="text-xs text-muted-foreground">{l}</div>
            <div className={`text-xl font-bold ${warn ? "text-red-600 dark:text-red-400" : ""}`}>{v}</div>
          </div>
        ))}
      </div>
      {data.criticalItems?.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground border-b border-border">
              <th className="pb-1 pr-3 text-left">Part</th>
              <th className="pb-1 pr-3 text-right">Stock</th>
              <th className="pb-1 text-right">Reorder At</th>
            </tr>
          </thead>
          <tbody>
            {data.criticalItems.map((it: any, i: number) => (
              <tr key={i} className="border-b border-border/40">
                <td className="py-1 pr-3">{it.partName}</td>
                <td className="py-1 pr-3 text-right text-red-600 dark:text-red-400 font-medium">{it.currentStock}</td>
                <td className="py-1 text-right text-muted-foreground">{it.reorderPoint}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data.criticalItems?.length === 0 && data.lowStockItems === 0 && (
        <p className="text-sm text-muted-foreground">No procurement risks identified.</p>
      )}
    </SectionCard>
  );
}

function CertificationSection({ data }: { data: ReportData["certificationOversight"] }) {
  if (!data) return null;
  return (
    <SectionCard title="Certification Oversight" icon={Shield}>
      <div className="flex flex-wrap gap-3 mb-3">
        {[
          { l: "Certified", v: data.certified, color: "text-green-600 dark:text-green-400" },
          { l: "On Track", v: data.onTrack, color: "text-blue-600 dark:text-blue-400" },
          { l: "At Risk", v: data.atRisk, color: "text-amber-600 dark:text-amber-400" },
          { l: "Blocked", v: data.blocked, color: "text-red-600 dark:text-red-400" },
          { l: "Retest Required", v: data.retestRequired, color: "text-amber-600 dark:text-amber-400" },
          { l: "Expiring 90d", v: data.certExpiring90d, color: data.certExpiring90d > 0 ? "text-amber-600 dark:text-amber-400" : "" },
        ].map(({ l, v, color }) => (
          <div key={l} className="bg-muted/40 rounded-lg px-3 py-2 text-center">
            <div className="text-xs text-muted-foreground">{l}</div>
            <div className={`text-xl font-bold ${color}`}>{v}</div>
          </div>
        ))}
      </div>
      {data.nextDueItems?.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground font-medium mb-1">Next due:</p>
          <ul className="space-y-0.5 text-sm">
            {data.nextDueItems.map((it: any, i: number) => (
              <li key={i} className="flex justify-between">
                <span>{it.projectName} — {it.certType}</span>
                <span className="text-muted-foreground">{it.dueDate ? new Date(it.dueDate).toLocaleDateString() : "TBD"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

function CustomerSuccessSection({ data }: { data: ReportData["customerSuccess"] }) {
  if (!data) return null;
  return (
    <SectionCard title="Customer Success & Renewals" icon={Users}>
      <div className="flex flex-wrap gap-3 mb-3">
        {[
          { l: "Healthy", v: data.healthy, color: "text-green-600 dark:text-green-400" },
          { l: "At Risk", v: data.atRisk, color: "text-amber-600 dark:text-amber-400" },
          { l: "Critical", v: data.critical, color: "text-red-600 dark:text-red-400" },
          { l: "Renewal / 30d", v: fmtCurrency(data.renewalValue30d) },
          { l: "Renewal / 60d", v: fmtCurrency(data.renewalValue60d) },
          { l: "Renewal / 90d", v: fmtCurrency(data.renewalValue90d), warn: data.renewalValue90d > 0 },
        ].map(({ l, v, color, warn }: any) => (
          <div key={l} className={`rounded-lg px-3 py-2 text-center ${warn ? "bg-amber-500/10" : "bg-muted/40"}`}>
            <div className="text-xs text-muted-foreground">{l}</div>
            <div className={`text-xl font-bold ${color ?? ""}`}>{v}</div>
          </div>
        ))}
      </div>
      {data.highRiskAccounts?.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground border-b border-border">
              <th className="pb-1 pr-3 text-left">Account</th>
              <th className="pb-1 pr-3 text-left">Health</th>
              <th className="pb-1 pr-3 text-left">Renewal</th>
              <th className="pb-1 text-right">MRR</th>
            </tr>
          </thead>
          <tbody>
            {data.highRiskAccounts.map((a: any) => (
              <tr key={a.accountName} className="border-b border-border/40">
                <td className="py-1 pr-3 font-medium">{a.accountName}</td>
                <td className="py-1 pr-3">
                  <Badge variant={a.healthStatus === "critical" ? "destructive" : "secondary"} className="text-xs">{a.healthStatus}</Badge>
                </td>
                <td className="py-1 pr-3 text-muted-foreground">{a.renewalDate ? new Date(a.renewalDate).toLocaleDateString() : "—"}</td>
                <td className="py-1 text-right">{fmtCurrency(a.mrr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}

function GeographySection({ data }: { data: ReportData["geographyTerritory"] }) {
  if (!data) return null;
  return (
    <SectionCard title="Geography & Territory" icon={Globe}>
      {data.topRegion && <p className="text-sm text-muted-foreground mb-2">Top region: <strong className="text-foreground">{data.topRegion}</strong> · Whitespace accounts: <strong className="text-foreground">{data.whitespaceCount}</strong></p>}
      {data.regions?.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground border-b border-border">
              <th className="pb-1 pr-3 text-left">Region</th>
              <th className="pb-1 pr-3 text-right">Leads</th>
              <th className="pb-1 pr-3 text-right">Accounts</th>
              <th className="pb-1 pr-3 text-right">Opps</th>
              <th className="pb-1 text-right">Pipeline</th>
            </tr>
          </thead>
          <tbody>
            {data.regions.slice(0, 8).map((r: any) => (
              <tr key={r.region} className="border-b border-border/40">
                <td className="py-1 pr-3 font-medium">{r.region}</td>
                <td className="py-1 pr-3 text-right">{r.leadCount}</td>
                <td className="py-1 pr-3 text-right">{r.accountCount}</td>
                <td className="py-1 pr-3 text-right">{r.oppCount}</td>
                <td className="py-1 text-right">{r.pipelineValue > 0 ? fmtCurrency(r.pipelineValue) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}

function SourceAttributionSection({ data }: { data: ReportData["sourceAttribution"] }) {
  if (!data) return null;
  return (
    <SectionCard title="Source Attribution" icon={Zap}>
      {data.topSource && <p className="text-sm text-muted-foreground mb-2">Top source: <strong className="text-foreground">{data.topSource}</strong>{data.strongestConvertingSource && data.strongestConvertingSource !== data.topSource ? ` · Best conversion: ${data.strongestConvertingSource}` : ""}</p>}
      {data.sources?.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground border-b border-border">
              <th className="pb-1 pr-3 text-left">Source</th>
              <th className="pb-1 pr-3 text-right">Leads</th>
              <th className="pb-1 pr-3 text-right">Conv.%</th>
              <th className="pb-1 pr-3 text-right">Opps</th>
              <th className="pb-1 text-right">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {data.sources.map((s: any) => (
              <tr key={s.source} className="border-b border-border/40">
                <td className="py-1 pr-3 font-medium">{s.source}</td>
                <td className="py-1 pr-3 text-right">{s.totalLeads}</td>
                <td className="py-1 pr-3 text-right">{s.conversionRate}%</td>
                <td className="py-1 pr-3 text-right">{s.totalOpps}</td>
                <td className="py-1 text-right">{s.totalRevenue > 0 ? fmtCurrency(s.totalRevenue) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}

function RiskBlockersSection({ data }: { data: ReportData["riskBlockers"] }) {
  if (!data) return null;
  const hasAny = data.stalledOpps?.length > 0 || data.awaitingQuotes?.length > 0 || data.installBlockers?.length > 0 || data.overdueTasks?.length > 0;
  return (
    <SectionCard title="Risks & Blockers" icon={AlertTriangle}>
      {!hasAny && <p className="text-sm text-green-600 dark:text-green-400">No critical risks or blockers identified.</p>}
      {data.stalledOpps?.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-medium text-muted-foreground mb-1">Stalled Opportunities ({data.stalledOpps.length})</p>
          <ul className="space-y-0.5">
            {data.stalledOpps.slice(0, 5).map((o: any) => (
              <li key={o.id} className="text-sm flex justify-between">
                <span className="text-amber-700 dark:text-amber-300">{o.title}</span>
                <span className="text-muted-foreground">{fmtCurrency(o.amount)} · {o.daysSinceActivity}d idle</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.awaitingQuotes?.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-medium text-muted-foreground mb-1">Awaiting Quote Response ({data.awaitingQuotes.length})</p>
          <ul className="space-y-0.5">
            {data.awaitingQuotes.slice(0, 5).map((q: any) => (
              <li key={q.id} className="text-sm flex justify-between">
                <span>{q.companyName} ({q.quoteNumber})</span>
                <span className="text-muted-foreground">{fmtCurrency(q.total)} · {q.daysSinceSent}d ago</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.overdueTasks?.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Overdue Tasks ({data.overdueTasks.length})</p>
          <ul className="space-y-0.5">
            {data.overdueTasks.slice(0, 4).map((t: any) => (
              <li key={t.id} className="text-sm flex justify-between">
                <span>{t.title}</span>
                <span className="text-muted-foreground">{t.assignedUserName ?? "Unassigned"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

function NarrativeSection({ bullets }: { bullets?: string[] }) {
  if (!bullets?.length) return null;
  return (
    <SectionCard title="Executive Summary" icon={BookOpen}>
      <ul className="space-y-2">
        {bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <ChevronRight className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

// ── Report Preview Container ──────────────────────────────────────────────────

function ReportPreview({ data, reportTypeLabel }: { data: ReportData; reportTypeLabel: string }) {
  return (
    <div className="report-preview bg-background text-foreground" data-testid="report-preview">
      {/* Header */}
      <div className="report-header mb-6 pb-4 border-b-2 border-primary/30">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs font-semibold tracking-widest text-primary uppercase mb-1">VoltSafe</div>
            <h1 className="text-2xl font-bold text-foreground">{reportTypeLabel}</h1>
            {data.meta && (
              <p className="text-sm text-muted-foreground mt-1">
                Generated {new Date(data.meta.generatedAt).toLocaleString()}
                {data.meta.dateFrom && ` · ${new Date(data.meta.dateFrom).toLocaleDateString()} – ${data.meta.dateTo ? new Date(data.meta.dateTo).toLocaleDateString() : "now"}`}
                {data.meta.region && ` · Region: ${data.meta.region}`}
              </p>
            )}
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <div className="font-semibold">CONFIDENTIAL</div>
            <div>{new Date().toLocaleDateString()}</div>
          </div>
        </div>
      </div>

      {/* Sections */}
      {data.narrativeBullets && <NarrativeSection bullets={data.narrativeBullets} />}
      {data.kpiSummary && <KpiSummarySection data={data.kpiSummary} />}
      {data.pipelineForecast && <PipelineForecastSection data={data.pipelineForecast} />}
      {data.quoteSnapshot && <QuoteSnapshotSection data={data.quoteSnapshot} />}
      {data.installsDeployments && <InstallsSection data={data.installsDeployments} />}
      {data.procurementRisks && <ProcurementSection data={data.procurementRisks} />}
      {data.certificationOversight && <CertificationSection data={data.certificationOversight} />}
      {data.customerSuccess && <CustomerSuccessSection data={data.customerSuccess} />}
      {data.geographyTerritory && <GeographySection data={data.geographyTerritory} />}
      {data.sourceAttribution && <SourceAttributionSection data={data.sourceAttribution} />}
      {data.riskBlockers && <RiskBlockersSection data={data.riskBlockers} />}
    </div>
  );
}

// ── Schedule Helpers ──────────────────────────────────────────────────────────

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SCHEDULE_TYPES = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
];
const DELIVERY_CHANNELS = [
  { value: "email", label: "Email", icon: Mail },
  { value: "in_app", label: "In-App Notification", icon: Bell },
];

function scheduleLabel(s: Schedule): string {
  if (s.schedule_type === "weekly") return `Every ${WEEKDAYS[s.weekday ?? 1]} at ${s.send_hour}:00`;
  if (s.schedule_type === "monthly") return `Monthly on day ${s.day_of_month ?? 1} at ${s.send_hour}:00`;
  if (s.schedule_type === "quarterly") return `Quarterly (month ${s.month_in_quarter ?? 1}) at ${s.send_hour}:00`;
  return "Custom schedule";
}

function statusBadge(status?: string | null) {
  if (!status) return <Badge variant="outline" className="text-xs text-muted-foreground">Never run</Badge>;
  if (status === "delivered" || status === "completed") return <Badge className="bg-emerald-500/20 text-emerald-700 border-emerald-300 text-xs"><CheckCircle className="w-3 h-3 mr-1" />Delivered</Badge>;
  if (status === "running" || status === "generating") return <Badge className="bg-blue-500/20 text-blue-700 border-blue-300 text-xs"><Timer className="w-3 h-3 mr-1" />Running</Badge>;
  if (status === "failed") return <Badge className="bg-red-500/20 text-red-700 border-red-300 text-xs"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
  return <Badge variant="outline" className="text-xs">{status}</Badge>;
}

// ── Schedule Create / Edit Modal ──────────────────────────────────────────────

function ScheduleModal({
  open, onClose, schedule, reportTypes, sectionMeta,
}: {
  open: boolean;
  onClose: () => void;
  schedule?: Schedule | null;
  reportTypes: ReportType[];
  sectionMeta: SectionMeta[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const isEdit = !!schedule;

  const [name, setName] = useState(schedule?.name ?? "");
  const [scheduleType, setScheduleType] = useState(schedule?.schedule_type ?? "monthly");
  const [weekday, setWeekday] = useState(String(schedule?.weekday ?? 1));
  const [dayOfMonth, setDayOfMonth] = useState(String(schedule?.day_of_month ?? 1));
  const [monthInQuarter, setMonthInQuarter] = useState(String(schedule?.month_in_quarter ?? 1));
  const [sendHour, setSendHour] = useState(String(schedule?.send_hour ?? 8));
  const [reportType, setReportType] = useState(schedule?.report_type ?? "board_pack");
  const [includedSections, setIncludedSections] = useState<string[]>(schedule?.included_sections ?? []);
  const [recipientsText, setRecipientsText] = useState((schedule?.recipients ?? []).join("\n"));
  const [channels, setChannels] = useState<string[]>(schedule?.delivery_channels ?? ["in_app"]);

  const toggleChannel = (ch: string) =>
    setChannels(prev => prev.includes(ch) ? prev.filter(c => c !== ch) : [...prev, ch]);

  const toggleSection = (key: string) =>
    setIncludedSections(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);

  const saveMutation = useMutation({
    mutationFn: (body: any) => isEdit
      ? apiRequest("PATCH", `/api/board-pack/schedules/${schedule!.id}`, body).then(r => r.json())
      : apiRequest("POST", "/api/board-pack/schedules", body).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/board-pack/schedules"] });
      toast({ title: isEdit ? "Schedule updated" : "Schedule created" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleSave = () => {
    if (!name.trim()) return toast({ title: "Name required", variant: "destructive" });
    const recipients = recipientsText.split(/[\n,]/).map(e => e.trim()).filter(Boolean);
    saveMutation.mutate({
      name: name.trim(),
      scheduleType,
      weekday: scheduleType === "weekly" ? parseInt(weekday) : null,
      dayOfMonth: scheduleType === "monthly" ? parseInt(dayOfMonth) : null,
      monthInQuarter: scheduleType === "quarterly" ? parseInt(monthInQuarter) : null,
      sendHour: parseInt(sendHour),
      reportType,
      includedSections,
      recipients,
      deliveryChannels: channels,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Schedule" : "New Schedule"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Schedule Name</Label>
            <Input data-testid="input-schedule-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Monthly Board Pack" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Cadence</Label>
              <Select value={scheduleType} onValueChange={setScheduleType}>
                <SelectTrigger data-testid="select-schedule-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SCHEDULE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Send Hour (24h)</Label>
              <Select value={sendHour} onValueChange={setSendHour}>
                <SelectTrigger data-testid="select-send-hour"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[6,7,8,9,10,11,12,14,16,18].map(h => <SelectItem key={h} value={String(h)}>{h}:00</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {scheduleType === "weekly" && (
            <div>
              <Label>Day of Week</Label>
              <Select value={weekday} onValueChange={setWeekday}>
                <SelectTrigger data-testid="select-weekday"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {scheduleType === "monthly" && (
            <div>
              <Label>Day of Month</Label>
              <Select value={dayOfMonth} onValueChange={setDayOfMonth}>
                <SelectTrigger data-testid="select-day-of-month"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1,2,3,5,7,10,14,15,20,25,28].map(d => <SelectItem key={d} value={String(d)}>Day {d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {scheduleType === "quarterly" && (
            <div>
              <Label>Month in Quarter</Label>
              <Select value={monthInQuarter} onValueChange={setMonthInQuarter}>
                <SelectTrigger data-testid="select-month-in-quarter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">First month of quarter</SelectItem>
                  <SelectItem value="2">Second month of quarter</SelectItem>
                  <SelectItem value="3">Third month of quarter</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label>Report Type</Label>
            <Select value={reportType} onValueChange={setReportType}>
              <SelectTrigger data-testid="select-schedule-report-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {reportTypes.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="block mb-2">Delivery Channels</Label>
            <div className="flex gap-3">
              {DELIVERY_CHANNELS.map(ch => (
                <label key={ch.value} className="flex items-center gap-2 cursor-pointer text-sm">
                  <Checkbox
                    checked={channels.includes(ch.value)}
                    onCheckedChange={() => toggleChannel(ch.value)}
                    data-testid={`checkbox-channel-${ch.value}`}
                  />
                  <ch.icon className="w-3.5 h-3.5 text-muted-foreground" />
                  {ch.label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <Label>Recipients (one email per line)</Label>
            <Textarea
              data-testid="input-recipients"
              value={recipientsText}
              onChange={e => setRecipientsText(e.target.value)}
              placeholder="admin@voltsafe.com&#10;board@voltsafe.com"
              rows={3}
              className="text-sm font-mono"
            />
            <p className="text-xs text-muted-foreground mt-1">Only used for Email channel. Leave empty for in-app only.</p>
          </div>

          <div>
            <Label className="block mb-2">Included Sections (leave empty for all)</Label>
            <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
              {sectionMeta.map(s => (
                <label key={s.key} className="flex items-center gap-2 cursor-pointer text-xs py-0.5">
                  <Checkbox
                    checked={includedSections.includes(s.key)}
                    onCheckedChange={() => toggleSection(s.key)}
                    data-testid={`checkbox-schedule-section-${s.key}`}
                  />
                  {s.label}
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            data-testid="button-save-schedule"
            onClick={handleSave}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? "Saving..." : isEdit ? "Save Changes" : "Create Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Run History Panel ─────────────────────────────────────────────────────────

function RunHistoryPanel({ scheduleId }: { scheduleId: number }) {
  const { data: runs = [], isLoading } = useQuery<ScheduleRun[]>({
    queryKey: ["/api/board-pack/schedules", scheduleId, "history"],
    queryFn: () => fetch(`/api/board-pack/schedules/${scheduleId}/history?limit=10`, { credentials: "include" }).then(r => r.json()),
  });

  if (isLoading) return <div className="py-3 text-xs text-muted-foreground">Loading history…</div>;
  if (!runs.length) return <div className="py-3 text-xs text-muted-foreground">No runs yet.</div>;

  return (
    <div className="space-y-1.5 mt-2">
      {runs.map(run => (
        <div key={run.id} className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-muted/40">
          <div className="flex items-center gap-2">
            {(run.status === "delivered" || run.status === "completed") ? <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> :
             run.status === "failed" ? <XCircle className="w-3.5 h-3.5 text-red-500" /> :
             <Timer className="w-3.5 h-3.5 text-blue-500" />}
            <span className="text-muted-foreground">{new Date(run.generated_at).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
            {run.recipient_count > 0 && <span className="text-muted-foreground">· {run.recipient_count} recipient{run.recipient_count > 1 ? "s" : ""}</span>}
            {run.triggered_by && <span className="text-muted-foreground italic">manual</span>}
          </div>
          {run.errors && (
            <span className="text-amber-600 dark:text-amber-400 truncate max-w-48 ml-2 shrink-0" title={run.errors}>
              ⚠ {run.errors.slice(0, 50)}{run.errors.length > 50 ? "…" : ""}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Schedules Panel ───────────────────────────────────────────────────────────

function SchedulesPanel({ reportTypes, sectionMeta }: { reportTypes: ReportType[]; sectionMeta: SectionMeta[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editSchedule, setEditSchedule] = useState<Schedule | null>(null);
  const [expandedHistory, setExpandedHistory] = useState<number | null>(null);

  const { data: schedules = [], isLoading } = useQuery<Schedule[]>({
    queryKey: ["/api/board-pack/schedules"],
  });

  const toggleMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/board-pack/schedules/${id}/toggle`).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/board-pack/schedules"] }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const runNowMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/board-pack/schedules/${id}/run-now`).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Board pack generation started", description: "Check run history shortly." });
      setTimeout(() => qc.invalidateQueries({ queryKey: ["/api/board-pack/schedules"] }), 3000);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/board-pack/schedules/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/board-pack/schedules"] });
      toast({ title: "Schedule deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4" data-testid="schedules-panel">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Auto-Scheduling</h2>
          <p className="text-sm text-muted-foreground">Automatically generate and deliver recurring board packs</p>
        </div>
        <Button
          data-testid="button-new-schedule"
          size="sm"
          onClick={() => { setEditSchedule(null); setModalOpen(true); }}
        >
          <Plus className="w-4 h-4 mr-1.5" />New Schedule
        </Button>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading schedules…</div>}

      {!isLoading && schedules.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <Calendar className="w-6 h-6 text-primary" />
          </div>
          <div>
            <p className="font-medium">No schedules yet</p>
            <p className="text-sm text-muted-foreground mt-1">Create your first auto-schedule to start delivering board packs automatically.</p>
          </div>
          <Button size="sm" onClick={() => { setEditSchedule(null); setModalOpen(true); }}>
            <Plus className="w-4 h-4 mr-1.5" />Create First Schedule
          </Button>
        </div>
      )}

      <div className="space-y-3" data-testid="schedules-list">
        {schedules.map(s => (
          <Card key={s.id} data-testid={`schedule-card-${s.id}`} className={s.enabled ? "" : "opacity-60"}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-medium text-sm truncate">{s.name}</h3>
                    {statusBadge(s.last_status)}
                    {!s.enabled && <Badge variant="outline" className="text-xs text-muted-foreground">Paused</Badge>}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{scheduleLabel(s)}</span>
                    <span className="flex items-center gap-1">
                      {s.delivery_channels.includes("email") && <Mail className="w-3 h-3" />}
                      {s.delivery_channels.includes("in_app") && <Bell className="w-3 h-3" />}
                      {s.delivery_channels.join(", ")}
                    </span>
                    {s.recipients.length > 0 && (
                      <span>{s.recipients.length} recipient{s.recipients.length > 1 ? "s" : ""}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
                    {s.last_run_at && <span>Last run: {new Date(s.last_run_at).toLocaleDateString("en-CA")}</span>}
                    {s.next_run_at && s.enabled && <span>Next: {new Date(s.next_run_at).toLocaleDateString("en-CA")}</span>}
                    {(s.run_count ?? 0) > 0 && <span>{s.delivered_count ?? 0}/{s.run_count} delivered</span>}
                  </div>
                  {s.last_error && (
                    <p className="text-xs text-red-500 mt-1 truncate" title={s.last_error}>{s.last_error}</p>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <Switch
                    data-testid={`toggle-schedule-${s.id}`}
                    checked={s.enabled}
                    onCheckedChange={() => toggleMutation.mutate(s.id)}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid={`button-run-now-${s.id}`}
                    onClick={() => runNowMutation.mutate(s.id)}
                    disabled={runNowMutation.isPending}
                    title="Send now"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid={`button-history-${s.id}`}
                    onClick={() => setExpandedHistory(expandedHistory === s.id ? null : s.id)}
                    title="Run history"
                  >
                    <History className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid={`button-edit-schedule-${s.id}`}
                    onClick={() => { setEditSchedule(s); setModalOpen(true); }}
                    title="Edit"
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid={`button-delete-schedule-${s.id}`}
                    onClick={() => deleteMutation.mutate(s.id)}
                    className="text-muted-foreground hover:text-destructive"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {expandedHistory === s.id && (
                <div className="mt-3 border-t border-border pt-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
                    <History className="w-3 h-3" />Run History
                  </p>
                  <RunHistoryPanel scheduleId={s.id} />
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <ScheduleModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditSchedule(null); }}
        schedule={editSchedule}
        reportTypes={reportTypes}
        sectionMeta={sectionMeta}
      />
    </div>
  );
}

// ── Save Preset Dialog ────────────────────────────────────────────────────────

function SavePresetDialog({
  open, onClose, reportType, dateRangePreset, enabledSections, onSaved,
}: {
  open: boolean; onClose: () => void;
  reportType: string; dateRangePreset: string; enabledSections: string[];
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/reports/presets", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/reports/presets"] });
      toast({ title: "Preset saved" });
      onSaved();
      setName(""); setDesc("");
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Save Report Preset</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input data-testid="input-preset-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Monthly Board Pack" />
          </div>
          <div>
            <Label>Description (optional)</Label>
            <Input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Short description" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            data-testid="button-save-preset"
            disabled={!name.trim() || saveMutation.isPending}
            onClick={() => saveMutation.mutate({ name: name.trim(), description: desc, reportType, dateRangePreset, includedSections: enabledSections })}
          >
            {saveMutation.isPending ? "Saving..." : "Save Preset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function BoardPackPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const previewRef = useRef<HTMLDivElement>(null);

  // Config state
  const [reportType, setReportType] = useState("executive_weekly");
  const [dateRangePreset, setDateRangePreset] = useState("this_month");
  const [customDateFrom, setCustomDateFrom] = useState("");
  const [customDateTo, setCustomDateTo] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [enabledSections, setEnabledSections] = useState<string[]>([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [activeTab, setActiveTab] = useState<"builder" | "preview">("builder");
  const [pageView, setPageView] = useState<"builder" | "schedules">("builder");

  // Metadata
  const { data: types = [] } = useQuery<ReportType[]>({ queryKey: ["/api/reports/types"] });
  const { data: sections = [] } = useQuery<SectionMeta[]>({ queryKey: ["/api/reports/sections"] });
  const { data: presets = [] } = useQuery<Preset[]>({ queryKey: ["/api/reports/presets"] });

  // Sync default sections when report type changes
  const syncDefaults = (type: string) => {
    const defaults = sections.filter(s => s.defaultFor.includes(type)).map(s => s.key);
    setEnabledSections(defaults.length > 0 ? defaults : sections.map(s => s.key));
  };

  const handleTypeChange = (val: string) => {
    setReportType(val);
    syncDefaults(val);
  };

  const toggleSection = (key: string) => {
    setEnabledSections(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key],
    );
  };

  // Compose mutation
  const composeMutation = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/reports/compose", body).then(r => r.json()),
    onSuccess: (data) => {
      setReportData(data);
      setActiveTab("preview");
    },
    onError: (e: any) => toast({ title: "Failed to generate report", description: e.message, variant: "destructive" }),
  });

  const handleGenerate = () => {
    const payload: any = {
      reportType,
      sections: enabledSections.length > 0 ? enabledSections : undefined,
    };
    if (dateRangePreset === "custom") {
      if (customDateFrom) payload.dateFrom = customDateFrom;
      if (customDateTo) payload.dateTo = customDateTo;
    } else {
      // Map preset to date range
      const now = new Date();
      if (dateRangePreset === "this_week") {
        const d = new Date(now); d.setDate(d.getDate() - d.getDay());
        payload.dateFrom = d.toISOString().split("T")[0];
      } else if (dateRangePreset === "this_month") {
        payload.dateFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
      } else if (dateRangePreset === "this_quarter") {
        payload.dateFrom = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).toISOString().split("T")[0];
      } else if (dateRangePreset === "last_month") {
        const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        payload.dateFrom = lm.toISOString().split("T")[0];
        payload.dateTo = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split("T")[0];
      } else if (dateRangePreset === "last_quarter") {
        const q = Math.floor(now.getMonth() / 3);
        const lqs = new Date(now.getFullYear(), (q - 1) * 3, 1);
        const lqe = new Date(now.getFullYear(), q * 3, 0);
        payload.dateFrom = lqs.toISOString().split("T")[0];
        payload.dateTo = lqe.toISOString().split("T")[0];
      }
    }
    if (regionFilter.trim()) payload.region = regionFilter.trim();
    composeMutation.mutate(payload);
  };

  // Load preset
  const loadPreset = (preset: Preset) => {
    setReportType(preset.reportType);
    setDateRangePreset(preset.dateRangePreset);
    setEnabledSections(preset.includedSections);
    toast({ title: `Loaded: ${preset.name}` });
  };

  // Delete preset
  const deletePreset = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/reports/presets/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/reports/presets"] });
      toast({ title: "Preset deleted" });
    },
  });

  // Export: print (PDF via browser)
  const handlePrint = () => window.print();

  // Export: download HTML
  const handleDownloadHTML = () => {
    if (!previewRef.current) return;
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>VoltSafe Board Pack — ${new Date().toLocaleDateString()}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 32px; color: #111; background: #fff; max-width: 960px; }
  h1 { font-size: 1.8rem; font-weight: 700; margin-bottom: 4px; }
  h2 { font-size: 1rem; font-weight: 600; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; margin: 24px 0 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  th, td { padding: 6px 12px 6px 0; text-align: left; border-bottom: 1px solid #f3f4f6; }
  th { color: #6b7280; font-weight: 500; }
  .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
  .kpi-box { background: #f9fafb; border-radius: 8px; padding: 12px; }
  .kpi-label { font-size: 0.75rem; color: #6b7280; }
  .kpi-value { font-size: 1.5rem; font-weight: 700; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 0.7rem; background: #e5e7eb; }
  .confidential { font-size: 0.7rem; color: #9ca3af; text-align: right; }
  @media print { body { margin: 16px; } }
</style>
</head>
<body>
${previewRef.current.innerHTML}
</body>
</html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `voltsafe-board-pack-${new Date().toISOString().split("T")[0]}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export: download Markdown
  const handleDownloadMarkdown = () => {
    if (!reportData) return;
    const lines: string[] = [`# VoltSafe Board Pack — ${new Date().toLocaleDateString()}`, "", `*Generated: ${new Date(reportData.meta.generatedAt).toLocaleString()}*`, ""];

    if (reportData.narrativeBullets?.length) {
      lines.push("## Executive Summary", "");
      reportData.narrativeBullets.forEach((b: string) => lines.push(`- ${b}`));
      lines.push("");
    }
    if (reportData.kpiSummary) {
      const k = reportData.kpiSummary;
      lines.push("## KPI Summary", "");
      lines.push(`| Metric | Value |`, `| --- | --- |`);
      lines.push(`| Total Pipeline | ${fmtCurrency(k.totalPipeline)} |`);
      lines.push(`| Weighted Pipeline | ${fmtCurrency(k.weightedPipeline)} |`);
      lines.push(`| Closed-Won Revenue | ${fmtCurrency(k.closedWonAmount)} |`);
      lines.push(`| Quote Win Rate | ${pct(k.winRate)} |`);
      lines.push(`| Lead Conversion | ${pct(k.conversionRate)} |`);
      lines.push(`| Install Blockers | ${k.installBlockers} |`);
      lines.push("");
    }
    if (reportData.sourceAttribution?.sources?.length) {
      lines.push("## Source Attribution", "");
      lines.push("| Source | Leads | Conv% | Revenue |", "| --- | --- | --- | --- |");
      reportData.sourceAttribution.sources.forEach((s: any) => lines.push(`| ${s.source} | ${s.totalLeads} | ${s.conversionRate}% | ${fmtCurrency(s.totalRevenue)} |`));
      lines.push("");
    }
    if (reportData.riskBlockers?.stalledOpps?.length) {
      lines.push("## Risks & Blockers", "");
      lines.push("**Stalled Opportunities:**", "");
      reportData.riskBlockers.stalledOpps.forEach((o: any) => lines.push(`- ${o.title} — ${fmtCurrency(o.amount)}, ${o.daysSinceActivity}d idle`));
      lines.push("");
    }

    const md = lines.join("\n");
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `voltsafe-board-pack-${new Date().toISOString().split("T")[0]}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const currentTypeMeta = (types as ReportType[]).find(t => t.value === reportType);
  const allSectionKeys = (sections as SectionMeta[]).map(s => s.key);
  const effectiveEnabled = enabledSections.length > 0 ? enabledSections : allSectionKeys;

  return (
    <div className="flex flex-col h-full" data-testid="board-pack-page">
      {/* Print-only styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .report-preview { max-width: 100%; font-size: 11pt; }
          .report-header { border-bottom: 2pt solid #0d9488; }
          .report-section { break-inside: avoid; page-break-inside: avoid; }
          body { -webkit-print-color-adjust: exact; }
        }
      `}</style>

      {/* Page header */}
      <div className="no-print flex items-center justify-between px-6 py-4 border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-primary" />
            <div>
              <h1 className="text-lg font-semibold">Board Pack & Reports</h1>
              <p className="text-xs text-muted-foreground">Generate printable leadership and board-ready reports</p>
            </div>
          </div>
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            <button
              data-testid="tab-builder"
              onClick={() => setPageView("builder")}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${pageView === "builder" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              <FileText className="w-3.5 h-3.5 inline mr-1.5" />Report Builder
            </button>
            <button
              data-testid="tab-schedules"
              onClick={() => setPageView("schedules")}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${pageView === "schedules" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Calendar className="w-3.5 h-3.5 inline mr-1.5" />Auto-Scheduling
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {pageView === "builder" && reportData && (
            <>
              <Button data-testid="button-download-html" variant="outline" size="sm" onClick={handleDownloadHTML}>
                <Download className="w-4 h-4 mr-1.5" />HTML
              </Button>
              <Button data-testid="button-download-md" variant="outline" size="sm" onClick={handleDownloadMarkdown}>
                <Download className="w-4 h-4 mr-1.5" />Markdown
              </Button>
              <Button data-testid="button-print" variant="outline" size="sm" onClick={handlePrint}>
                <Printer className="w-4 h-4 mr-1.5" />Print / PDF
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSaveDialogOpen(true)}>
                <Save className="w-4 h-4 mr-1.5" />Save Preset
              </Button>
            </>
          )}
          {pageView === "builder" && (
            <Button
              data-testid="button-generate-report"
              onClick={handleGenerate}
              disabled={composeMutation.isPending}
            >
              {composeMutation.isPending ? (
                <><RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />Generating...</>
              ) : (
                <><Play className="w-4 h-4 mr-1.5" />Generate Report</>
              )}
            </Button>
          )}
        </div>
      </div>

      {pageView === "schedules" ? (
        <SchedulesPanel reportTypes={types as ReportType[]} sectionMeta={sections as SectionMeta[]} />
      ) : (
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left panel: Builder config */}
        <div className="no-print w-72 shrink-0 border-r border-border overflow-y-auto p-4 space-y-5">
          {/* Report type */}
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Report Type</Label>
            <Select value={reportType} onValueChange={handleTypeChange}>
              <SelectTrigger data-testid="select-report-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(types as ReportType[]).map(t => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {currentTypeMeta && (
              <p className="text-xs text-muted-foreground mt-1.5">{currentTypeMeta.description}</p>
            )}
          </div>

          <Separator />

          {/* Date range */}
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Date Range</Label>
            <Select value={dateRangePreset} onValueChange={setDateRangePreset}>
              <SelectTrigger data-testid="select-date-range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_PRESETS.map(p => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {dateRangePreset === "custom" && (
              <div className="mt-2 space-y-1.5">
                <Input type="date" data-testid="input-date-from" value={customDateFrom} onChange={e => setCustomDateFrom(e.target.value)} className="text-sm" />
                <Input type="date" data-testid="input-date-to" value={customDateTo} onChange={e => setCustomDateTo(e.target.value)} className="text-sm" />
              </div>
            )}
          </div>

          {/* Filters */}
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Filters</Label>
            <Input
              data-testid="input-region-filter"
              placeholder="Region / territory..."
              value={regionFilter}
              onChange={e => setRegionFilter(e.target.value)}
              className="text-sm"
            />
          </div>

          <Separator />

          {/* Section toggles */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sections</Label>
              <div className="flex gap-1">
                <button onClick={() => setEnabledSections(allSectionKeys)} className="text-xs text-primary hover:underline">All</button>
                <span className="text-muted-foreground text-xs">·</span>
                <button onClick={() => setEnabledSections([])} className="text-xs text-muted-foreground hover:underline">None</button>
              </div>
            </div>
            <div className="space-y-2">
              {(sections as SectionMeta[]).map(s => {
                const Icon = SECTION_ICONS[s.key] ?? FileText;
                const checked = effectiveEnabled.includes(s.key);
                return (
                  <div key={s.key} className="flex items-start gap-2">
                    <Checkbox
                      id={`section-${s.key}`}
                      data-testid={`checkbox-section-${s.key}`}
                      checked={checked}
                      onCheckedChange={() => toggleSection(s.key)}
                    />
                    <label htmlFor={`section-${s.key}`} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <Icon className="w-3.5 h-3.5 text-primary shrink-0" />
                      {s.label}
                    </label>
                  </div>
                );
              })}
            </div>
          </div>

          <Separator />

          {/* Saved presets */}
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Saved Presets</Label>
            {(presets as Preset[]).length === 0 && (
              <p className="text-xs text-muted-foreground">No saved presets yet. Generate a report and save it.</p>
            )}
            <div className="space-y-1" data-testid="presets-list">
              {(presets as Preset[]).map(p => (
                <div key={p.id} className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-muted/50 group">
                  <button
                    data-testid={`button-load-preset-${p.id}`}
                    onClick={() => loadPreset(p)}
                    className="text-sm text-left flex-1 truncate"
                  >
                    {p.name}
                  </button>
                  <button
                    data-testid={`button-delete-preset-${p.id}`}
                    onClick={() => deletePreset.mutate(p.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right panel: Preview — bottom padding prevents FAB from hiding last content */}
        <div className="flex-1 overflow-y-auto pb-36 md:pb-24">
          {!reportData ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6 no-print">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                <FileText className="w-8 h-8 text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-semibold">Ready to Generate</h2>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm">Configure your report type, date range, and sections on the left, then click <strong>Generate Report</strong>.</p>
              </div>
              <Button data-testid="button-generate-empty" onClick={handleGenerate} disabled={composeMutation.isPending}>
                {composeMutation.isPending ? "Generating..." : "Generate Report"}
              </Button>
            </div>
          ) : (
            <div className="p-6 max-w-4xl mx-auto" ref={previewRef}>
              <ReportPreview
                data={reportData}
                reportTypeLabel={currentTypeMeta?.label ?? reportType}
              />
            </div>
          )}
        </div>
      </div>
      )}

      <SavePresetDialog
        open={saveDialogOpen}
        onClose={() => setSaveDialogOpen(false)}
        reportType={reportType}
        dateRangePreset={dateRangePreset}
        enabledSections={effectiveEnabled}
        onSaved={() => setSaveDialogOpen(false)}
      />
    </div>
  );
}
