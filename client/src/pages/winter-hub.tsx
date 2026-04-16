import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Snowflake, AlertTriangle, CheckCircle2, Clock, TrendingUp, TrendingDown,
  Package, BookOpen, BarChart3, Inbox, Plus, Search, RefreshCw,
  Globe, Star, MessageSquare, Zap, ShieldCheck, ExternalLink,
  ChevronRight, Eye, Edit, X, Save, FileText,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  status: string; notes?: string; createdAt: string;
}

interface WinterCase {
  id: number; caseNumber: string; customerName?: string; customerEmail?: string;
  issueType: string; severity: string; status: string; subject?: string;
  bodyExcerpt?: string; country?: string; autoDetected?: boolean;
  sentimentScore?: number; productName?: string; ownerName?: string;
  tags?: string[]; createdAt: string;
}

interface KbArticle {
  id: number; title: string; issueType: string; description?: string;
  approvedResponse?: string; internalNotes?: string; status: string;
  appliesToVersions?: string[]; relatedCaseCount?: number;
  lastReviewedAt?: string; createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

const SEVERITIES = ["low", "medium", "high", "critical"];
const STATUSES = ["open", "in_progress", "resolved", "closed"];
const PRODUCT_STATUSES = ["legacy", "active", "paused", "relaunch_candidate"];

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
  return s === "critical" ? "text-red-400" : s === "high" ? "text-orange-400" : s === "medium" ? "text-amber-400" : "text-blue-400";
}

function statusBadge(s: string) {
  if (s === "open") return "bg-blue-500/10 text-blue-400 border border-blue-500/30";
  if (s === "in_progress") return "bg-amber-500/10 text-amber-400 border border-amber-500/30";
  if (s === "resolved" || s === "closed") return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30";
  return "bg-muted text-muted-foreground border border-border";
}

function productStatusBadge(s: string) {
  if (s === "active") return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30";
  if (s === "relaunch_candidate") return "bg-violet-500/10 text-violet-400 border border-violet-500/30";
  if (s === "paused") return "bg-amber-500/10 text-amber-400 border border-amber-500/30";
  return "bg-muted/30 text-muted-foreground border border-border";
}

function sentimentEmoji(score?: number) {
  if (score == null) return null;
  if (score > 30) return "😊";
  if (score > -20) return "😐";
  return "😟";
}

function demandScoreColor(score: number) {
  if (score >= 70) return "text-emerald-400";
  if (score >= 40) return "text-amber-400";
  return "text-muted-foreground";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, color = "text-foreground", sub }: {
  label: string; value: string | number; icon: React.ElementType; color?: string; sub?: string;
}) {
  return (
    <Card className="border border-border/50 bg-card/80">
      <CardContent className="p-4 flex items-start gap-3">
        <div className={`p-2 rounded-lg bg-muted/30 shrink-0 ${color}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`text-xl font-bold ${color}`}>{value}</p>
          {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Command Center Tab ────────────────────────────────────────────────────────

function CommandCenterTab() {
  const { data: dash, isLoading } = useQuery<any>({ queryKey: ["/api/winter/dashboard"] });

  const scanMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/winter/scan-emails", { limitHours: 720 }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/winter/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/winter/cases"] });
      const { toast } = { toast: (v: any) => {} }; // avoid hook outside component
      console.log(`Scan done: ${data.created} new cases from ${data.scanned} emails`);
    },
  });
  const { toast } = useToast();

  function handleScan() {
    scanMutation.mutate(undefined, {
      onSuccess: (data: any) => toast({ title: "Email scan complete", description: `${data.created} new cases from ${data.scanned} emails` }),
    });
  }

  if (isLoading) return <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>;

  const s = dash?.stats ?? {};
  const demandScore = dash?.demandScore ?? 0;
  const revenueOpp = dash?.revenueOpportunity ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Winter Command Center</h2>
          <p className="text-sm text-muted-foreground">Live product support overview + relaunch demand</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleScan} disabled={scanMutation.isPending} data-testid="button-scan-emails">
          <RefreshCw className={`h-4 w-4 mr-2 ${scanMutation.isPending ? "animate-spin" : ""}`} />
          {scanMutation.isPending ? "Scanning…" : "Scan Emails"}
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Open Cases" value={s.openCases ?? 0} icon={Inbox} color="text-blue-400" sub={`${s.inProgressCases ?? 0} in progress`} />
        <StatCard label="Critical / High" value={`${s.criticalCases ?? 0} / ${s.highCases ?? 0}`} icon={AlertTriangle} color="text-orange-400" sub="Needs attention" />
        <StatCard label="Relaunch Demand" value={`${demandScore}/100`} icon={TrendingUp} color={demandScoreColor(demandScore)} sub={`${dash?.reorderSignals ?? 0} reorder signals`} />
        <StatCard label="Revenue Opportunity" value={revenueOpp > 0 ? `$${(revenueOpp / 1000).toFixed(0)}k` : "—"} icon={Zap} color="text-emerald-400" sub="Est. from reorder signals" />
        <StatCard label="Last 30 Days" value={s.last30d ?? 0} icon={BarChart3} color="text-violet-400" sub={`${s.last7d ?? 0} last 7 days`} />
        <StatCard label="Auto-Detected" value={s.autoDetected ?? 0} icon={Star} color="text-cyan-400" sub="From email scan" />
        <StatCard label="Avg Sentiment" value={s.avgSentiment != null ? `${s.avgSentiment > 0 ? "+" : ""}${s.avgSentiment}` : "—"} icon={MessageSquare} color={s.avgSentiment > 0 ? "text-emerald-400" : s.avgSentiment < 0 ? "text-red-400" : "text-muted-foreground"} sub="Sentiment score" />
        <StatCard label="Resolved Cases" value={s.resolvedCases ?? 0} icon={CheckCircle2} color="text-emerald-400" sub="All time" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="border border-border/50 bg-card/80">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-orange-400" /> Top Issues
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {(dash?.topIssues ?? []).length === 0 && <p className="text-sm text-muted-foreground">No cases yet</p>}
            {(dash?.topIssues ?? []).map((issue: any) => (
              <div key={issue.issueType} className="flex items-center justify-between">
                <span className={issueBadge(issue.issueType)}>{ISSUE_LABELS[issue.issueType] ?? issue.issueType}</span>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="text-blue-400 font-medium">{issue.open_count} open</span>
                  <span>{issue.count} total</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border border-border/50 bg-card/80">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <Package className="h-3.5 w-3.5 text-violet-400" /> Product Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {(dash?.productBreakdown ?? []).length === 0 && <p className="text-sm text-muted-foreground">No products yet</p>}
            {(dash?.productBreakdown ?? []).map((p: any) => (
              <div key={p.id} className="space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{p.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${productStatusBadge(p.status)}`}>{p.status.replace("_", " ")}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{p.open_count} open / {p.case_count} total</span>
                </div>
                <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-violet-400 rounded-full" style={{ width: `${Math.min(100, Number(p.open_count) * 10)}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {(dash?.weeklyTrend ?? []).length > 0 && (
        <Card className="border border-border/50 bg-card/80">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <BarChart3 className="h-3.5 w-3.5 text-blue-400" /> Weekly Case Trend
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="flex items-end gap-2 h-16">
              {(dash.weeklyTrend ?? []).slice(0, 10).reverse().map((w: any, i: number) => {
                const h = Math.max(4, Math.min(100, Number(w.cases) * 8));
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full bg-blue-400/70 rounded-sm" style={{ height: `${h}%` }} title={`${w.cases} cases`} />
                    <span className="text-[9px] text-muted-foreground">{String(w.week).slice(5, 10)}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Cases Tab ─────────────────────────────────────────────────────────────────

function CasesTab() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [issueFilter, setIssueFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [editCase, setEditCase] = useState<WinterCase | null>(null);

  const { data: cases = [], isLoading } = useQuery<WinterCase[]>({
    queryKey: ["/api/winter/cases", statusFilter, issueFilter, search],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (issueFilter !== "all") params.set("issueType", issueFilter);
      if (search) params.set("search", search);
      return fetch(`/api/winter/cases?${params}`, { credentials: "include" }).then(r => r.json());
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/winter/cases", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/winter/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/winter/dashboard"] });
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
      toast({ title: "Case updated" });
      setEditCase(null);
    },
    onError: () => toast({ title: "Failed to update case", variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Search cases…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-sm" data-testid="input-case-search" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32 h-8 text-xs" data-testid="select-case-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              {STATUSES.map(s => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={issueFilter} onValueChange={setIssueFilter}>
            <SelectTrigger className="w-40 h-8 text-xs" data-testid="select-case-issue"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Issues</SelectItem>
              {Object.entries(ISSUE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-create-case">
          <Plus className="h-4 w-4 mr-1" /> New Case
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded" />)}</div>
      ) : cases.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Inbox className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No support cases found</p>
          <p className="text-xs mt-1">Run an email scan or create a case manually</p>
        </div>
      ) : (
        <div className="space-y-2">
          {cases.map(c => (
            <Card key={c.id} className="border border-border/50 bg-card/80 hover:bg-card transition-colors cursor-pointer" data-testid={`case-row-${c.id}`}>
              <CardContent className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-foreground">{c.caseNumber}</span>
                      <span className={issueBadge(c.issueType)}>{ISSUE_LABELS[c.issueType] ?? c.issueType}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadge(c.status)}`}>{c.status.replace("_", " ")}</span>
                      {c.autoDetected && <span className="text-[10px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 px-1.5 py-0.5 rounded-full">Auto</span>}
                      {c.sentimentScore != null && <span className="text-sm" title={`Sentiment: ${c.sentimentScore}`}>{sentimentEmoji(c.sentimentScore)}</span>}
                    </div>
                    <p className="text-sm font-medium mt-0.5 truncate">{c.subject ?? `Case from ${c.customerName ?? c.customerEmail ?? "Unknown"}`}</p>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                      {c.customerName && <span>{c.customerName}</span>}
                      {c.customerEmail && <span>{c.customerEmail}</span>}
                      {c.country && <span>· {c.country}</span>}
                      <span>· {new Date(c.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs font-semibold ${severityColor(c.severity)}`}>{c.severity.toUpperCase()}</span>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditCase(c)} data-testid={`button-edit-case-${c.id}`}>
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CreateCaseDialog open={showCreate} onClose={() => setShowCreate(false)} onSave={d => createMutation.mutate(d)} saving={createMutation.isPending} />
      {editCase && <EditCaseDialog c={editCase} onClose={() => setEditCase(null)} onSave={d => updateMutation.mutate({ id: editCase.id, ...d })} saving={updateMutation.isPending} />}
    </div>
  );
}

function CreateCaseDialog({ open, onClose, onSave, saving }: { open: boolean; onClose: () => void; onSave: (d: any) => void; saving: boolean }) {
  const [form, setForm] = useState({ customerName: "", customerEmail: "", issueType: "general", severity: "medium", subject: "", bodyExcerpt: "", country: "" });
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid="dialog-create-case">
        <DialogHeader><DialogTitle>New Support Case</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Customer Name</Label><Input value={form.customerName} onChange={e => set("customerName", e.target.value)} className="h-8 text-sm" data-testid="input-customer-name" /></div>
            <div className="space-y-1"><Label className="text-xs">Customer Email</Label><Input value={form.customerEmail} onChange={e => set("customerEmail", e.target.value)} className="h-8 text-sm" data-testid="input-customer-email" /></div>
          </div>
          <div className="space-y-1"><Label className="text-xs">Subject</Label><Input value={form.subject} onChange={e => set("subject", e.target.value)} className="h-8 text-sm" data-testid="input-case-subject" /></div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Issue Type</Label>
              <Select value={form.issueType} onValueChange={v => set("issueType", v)}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-issue-type"><SelectValue /></SelectTrigger>
                <SelectContent>{ISSUE_TYPES.map(t => <SelectItem key={t} value={t}>{ISSUE_LABELS[t] ?? t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Severity</Label>
              <Select value={form.severity} onValueChange={v => set("severity", v)}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-severity"><SelectValue /></SelectTrigger>
                <SelectContent>{SEVERITIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label className="text-xs">Country</Label><Input value={form.country} onChange={e => set("country", e.target.value)} className="h-8 text-sm" data-testid="input-country" /></div>
          </div>
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Status</Label><Select value={form.status} onValueChange={v => set("status", v)}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s.replace("_"," ")}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1"><Label className="text-xs">Severity</Label><Select value={form.severity} onValueChange={v => set("severity", v)}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{SEVERITIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="space-y-1"><Label className="text-xs">Issue Type</Label><Select value={form.issueType} onValueChange={v => set("issueType", v)}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{ISSUE_TYPES.map(t => <SelectItem key={t} value={t}>{ISSUE_LABELS[t]??t}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label className="text-xs">Resolution Notes</Label><Textarea value={form.resolution} onChange={e => set("resolution", e.target.value)} rows={3} className="text-sm resize-none" placeholder="Document how this was resolved…" /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => onSave(form)} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Knowledge Base Tab ────────────────────────────────────────────────────────

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
        <div>
          <h3 className="text-sm font-semibold">Known Issues + Approved Responses</h3>
          <p className="text-xs text-muted-foreground">{articles.length} articles in the knowledge base</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-create-article">
          <Plus className="h-4 w-4 mr-1" /> Add Article
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 rounded" />)}</div>
      ) : articles.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No articles yet. Add known issues and approved responses.</p>
      ) : (
        <div className="space-y-2">
          {articles.map(a => (
            <Card key={a.id} className="border border-border/50 bg-card/80" data-testid={`kb-article-${a.id}`}>
              <CardContent className="p-0">
                <button
                  className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-muted/20 transition-colors"
                  onClick={() => setExpanded(expanded === a.id ? null : a.id)}>
                  <div className="flex items-center gap-3 min-w-0">
                    <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{a.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={issueBadge(a.issueType)}>{ISSUE_LABELS[a.issueType] ?? a.issueType}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${a.status === "active" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-muted/30 text-muted-foreground border-border"}`}>{a.status}</span>
                        {(a.relatedCaseCount ?? 0) > 0 && <span className="text-[10px] text-muted-foreground">{a.relatedCaseCount} related cases</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={e => { e.stopPropagation(); setEditArticle(a); }}>
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                    <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${expanded === a.id ? "rotate-90" : ""}`} />
                  </div>
                </button>
                {expanded === a.id && (
                  <div className="px-4 pb-4 space-y-3 border-t border-border/30">
                    {a.description && (
                      <div className="pt-3">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Description</p>
                        <p className="text-sm text-muted-foreground">{a.description}</p>
                      </div>
                    )}
                    {a.approvedResponse && (
                      <div>
                        <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wide mb-1">Approved Response</p>
                        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded p-3 text-sm">{a.approvedResponse}</div>
                      </div>
                    )}
                    {a.internalNotes && (
                      <div>
                        <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wide mb-1">Internal Notes</p>
                        <div className="bg-amber-500/5 border border-amber-500/20 rounded p-3 text-sm text-muted-foreground">{a.internalNotes}</div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <KbArticleDialog open={showCreate} article={null} onClose={() => setShowCreate(false)} onSave={d => createMutation.mutate(d)} saving={createMutation.isPending} />
      {editArticle && <KbArticleDialog open article={editArticle} onClose={() => setEditArticle(null)} onSave={d => updateMutation.mutate({ id: editArticle.id, ...d })} saving={updateMutation.isPending} />}
    </div>
  );
}

function KbArticleDialog({ open, article, onClose, onSave, saving }: { open: boolean; article: KbArticle | null; onClose: () => void; onSave: (d: any) => void; saving: boolean }) {
  const [form, setForm] = useState({
    title: article?.title ?? "", issueType: article?.issueType ?? "general",
    description: article?.description ?? "", approvedResponse: article?.approvedResponse ?? "",
    internalNotes: article?.internalNotes ?? "", status: article?.status ?? "active",
  });
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto" data-testid="dialog-kb-article">
        <DialogHeader><DialogTitle>{article ? "Edit Article" : "New KB Article"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-1">
          <div className="space-y-1"><Label className="text-xs">Title</Label><Input value={form.title} onChange={e => set("title", e.target.value)} className="h-8 text-sm" data-testid="input-kb-title" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Issue Type</Label><Select value={form.issueType} onValueChange={v => set("issueType", v)}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{ISSUE_TYPES.map(t => <SelectItem key={t} value={t}>{ISSUE_LABELS[t]??t}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1"><Label className="text-xs">Status</Label><Select value={form.status} onValueChange={v => set("status", v)}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="draft">Draft</SelectItem><SelectItem value="archived">Archived</SelectItem></SelectContent></Select></div>
          </div>
          <div className="space-y-1"><Label className="text-xs">Description (internal)</Label><Textarea value={form.description} onChange={e => set("description", e.target.value)} rows={2} className="text-sm resize-none" /></div>
          <div className="space-y-1"><Label className="text-xs">Approved Customer Response</Label><Textarea value={form.approvedResponse} onChange={e => set("approvedResponse", e.target.value)} rows={4} className="text-sm resize-none" placeholder="Paste approved response template here…" data-testid="input-approved-response" /></div>
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

// ── Demand Signals Tab ────────────────────────────────────────────────────────

function DemandSignalsTab() {
  const { data: signals, isLoading } = useQuery<any>({ queryKey: ["/api/winter/demand-signals"] });

  if (isLoading) return <div className="grid lg:grid-cols-2 gap-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}</div>;

  const { byCountry = [], retailers = [], improvements = [], monthlyTrend = [], sentiment = {} } = signals ?? {};

  const posNeg = Number(sentiment.positive ?? 0) + Number(sentiment.negative ?? 0);
  const npsEst = posNeg > 0 ? Math.round(((Number(sentiment.positive ?? 0) - Number(sentiment.negative ?? 0)) / posNeg) * 100) : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Reorder Interest" value={(retailers?.length ?? 0) > 0 || improvements.length > 0 ? "Active" : "—"} icon={TrendingUp} color="text-emerald-400" />
        <StatCard label="Retailer Requests" value={retailers.length} icon={Globe} color="text-violet-400" />
        <StatCard label="Feature Requests" value={improvements.length} icon={Star} color="text-amber-400" />
        <StatCard label="NPS Estimate" value={npsEst !== null ? (npsEst > 0 ? `+${npsEst}` : `${npsEst}`) : "—"} icon={MessageSquare} color={npsEst !== null && npsEst > 0 ? "text-emerald-400" : "text-red-400"} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="border border-border/50 bg-card/80">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <Globe className="h-3.5 w-3.5 text-blue-400" /> Requests by Country
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {byCountry.length === 0 ? <p className="text-sm text-muted-foreground">No country data yet</p> : byCountry.map((c: any) => (
              <div key={c.country} className="flex items-center gap-3">
                <span className="text-sm flex-1">{c.country}</span>
                <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.min(100, (c.count / (byCountry[0]?.count ?? 1)) * 100)}%` }} />
                </div>
                <span className="text-xs text-muted-foreground w-6 text-right">{c.count}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border border-border/50 bg-card/80">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <MessageSquare className="h-3.5 w-3.5 text-violet-400" /> Sentiment Distribution
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
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className={issueBadge(r.issueType)}>{ISSUE_LABELS[r.issueType] ?? r.issueType}</span>
                  <span>{new Date(r.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {improvements.length > 0 && (
        <Card className="border border-border/50 bg-card/80">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <Star className="h-3.5 w-3.5 text-amber-400" /> Requested Improvements
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

// ── Products Tab ──────────────────────────────────────────────────────────────

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
        <div>
          <h3 className="text-sm font-semibold">Product Registry</h3>
          <p className="text-xs text-muted-foreground">{products.length} product records</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-create-product">
          <Plus className="h-4 w-4 mr-1" /> Add Product
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
      ) : (
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
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditProduct(p)} data-testid={`button-edit-product-${p.id}`}>
                    <Edit className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  {p.unitsSold != null && <div><p className="text-muted-foreground">Units Sold</p><p className="font-semibold">{p.unitsSold.toLocaleString()}</p></div>}
                  {p.certifications && p.certifications.length > 0 && (
                    <div>
                      <p className="text-muted-foreground">Certifications</p>
                      <div className="flex gap-1 flex-wrap mt-0.5">
                        {p.certifications.map(c => <span key={c} className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded text-[10px] font-medium">{c}</span>)}
                      </div>
                    </div>
                  )}
                  {p.channels && p.channels.length > 0 && (
                    <div>
                      <p className="text-muted-foreground">Channels</p>
                      <div className="flex gap-1 flex-wrap mt-0.5">
                        {p.channels.map(c => <span key={c} className="bg-blue-500/10 text-blue-400 border border-blue-500/30 px-1.5 py-0.5 rounded text-[10px]">{c}</span>)}
                      </div>
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
  const [form, setForm] = useState({
    name: product?.name ?? "", sku: product?.sku ?? "", version: product?.version ?? "",
    launchYear: product?.launchYear?.toString() ?? "", unitsSold: product?.unitsSold?.toString() ?? "",
    certifications: (product?.certifications ?? []).join(", "),
    channels: (product?.channels ?? []).join(", "),
    status: product?.status ?? "legacy", notes: product?.notes ?? "",
  });
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  const data = () => ({
    ...form,
    launchYear: form.launchYear ? Number(form.launchYear) : null,
    unitsSold: form.unitsSold ? Number(form.unitsSold) : 0,
    certifications: form.certifications.split(",").map(s => s.trim()).filter(Boolean),
    channels: form.channels.split(",").map(s => s.trim()).filter(Boolean),
  });
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
          <div className="space-y-1"><Label className="text-xs">Certifications (comma-separated, e.g. CSA, UL)</Label><Input value={form.certifications} onChange={e => set("certifications", e.target.value)} className="h-8 text-sm" placeholder="CSA, UL, ETL" /></div>
          <div className="space-y-1"><Label className="text-xs">Channels (comma-separated, e.g. amazon, retail, dtc)</Label><Input value={form.channels} onChange={e => set("channels", e.target.value)} className="h-8 text-sm" placeholder="amazon, retail, dtc" /></div>
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

// ── Main Page ─────────────────────────────────────────────────────────────────

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
              <p className="text-sm text-muted-foreground">Legacy product operations · Email intake · Relaunch demand</p>
            </div>
          </div>

          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList className="h-9 text-xs" data-testid="winter-tabs">
              <TabsTrigger value="overview" className="text-xs" data-testid="tab-overview">Command Center</TabsTrigger>
              <TabsTrigger value="cases" className="text-xs" data-testid="tab-cases">Cases</TabsTrigger>
              <TabsTrigger value="kb" className="text-xs" data-testid="tab-kb">Knowledge Base</TabsTrigger>
              <TabsTrigger value="demand" className="text-xs" data-testid="tab-demand">Demand Signals</TabsTrigger>
              <TabsTrigger value="products" className="text-xs" data-testid="tab-products">Products</TabsTrigger>
            </TabsList>

            <TabsContent value="overview"><CommandCenterTab /></TabsContent>
            <TabsContent value="cases"><CasesTab /></TabsContent>
            <TabsContent value="kb"><KnowledgeBaseTab /></TabsContent>
            <TabsContent value="demand"><DemandSignalsTab /></TabsContent>
            <TabsContent value="products"><ProductsTab /></TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  );
}
