import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UniversalDrilldownSheet, type UniversalDrilldownConfig } from "@/components/shared/universal-drilldown-sheet";
import { apiRequest } from "@/lib/queryClient";
import { UniversalDrilldownSheet } from "@/components/shared/universal-drilldown-sheet";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Hammer, CheckCircle2, Clock, AlertTriangle, XCircle,
  ChevronRight, Building2, FileText, Calendar, User,
  TrendingUp, Zap, CircleDot, SkipForward, Plus, Edit2,
  RefreshCw, DollarSign, MapPin, CheckSquare, X, ChevronDown,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface InstallWorkflow {
  id: number;
  title: string;
  status: string;
  quoteId: number | null;
  opportunityId: number | null;
  accountId: number | null;
  ownerUserId: number | null;
  ownerName: string | null;
  accountName: string | null;
  kickoffDate: string | null;
  targetCompletionDate: string | null;
  actualCompletionDate: string | null;
  notes: string | null;
  blockers: string | null;
  totalAmount: number | null;
  quoteNumber: string | null;
  customerName: string | null;
  siteAddress: string | null;
  milestoneTotal: number;
  milestoneDone: number;
  milestoneBlocked: number;
  progressPct: number;
  milestones?: InstallMilestone[];
  tasks?: any[];
  opportunityTitle?: string | null;
  opportunityStage?: string | null;
  quoteStatus?: string | null;
  quoteTotal?: number | null;
}

interface InstallMilestone {
  id: number;
  workflowId: number;
  name: string;
  description: string | null;
  status: string;
  ownerUserId: number | null;
  ownerName: string | null;
  dueDate: string | null;
  completedAt: string | null;
  sortOrder: number;
  notes: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  pending_kickoff:  { label: "Pending Kickoff",  color: "text-slate-400  border-slate-500/40  bg-slate-500/10",  icon: Clock },
  in_progress:      { label: "In Progress",      color: "text-blue-400   border-blue-500/40   bg-blue-500/10",   icon: RefreshCw },
  on_hold:          { label: "On Hold",          color: "text-amber-400  border-amber-500/40  bg-amber-500/10",  icon: AlertTriangle },
  complete:         { label: "Complete",         color: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10", icon: CheckCircle2 },
  cancelled:        { label: "Cancelled",        color: "text-red-400    border-red-500/40    bg-red-500/10",    icon: XCircle },
};

const MILESTONE_STATUS_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  pending:     { label: "Pending",     icon: CircleDot,    color: "text-slate-400" },
  in_progress: { label: "In Progress", icon: RefreshCw,    color: "text-blue-400" },
  complete:    { label: "Complete",    icon: CheckCircle2, color: "text-emerald-400" },
  blocked:     { label: "Blocked",     icon: AlertTriangle,color: "text-red-400" },
  skipped:     { label: "Skipped",     icon: SkipForward,  color: "text-slate-500" },
};

const WF_STATUSES = ["pending_kickoff","in_progress","on_hold","complete","cancelled"];

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtAmt(n: number | null) {
  if (!n) return null;
  return n >= 1000 ? `$${(n/1000).toFixed(0)}k` : `$${n}`;
}

// ── Status Badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending_kickoff;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border font-medium ${cfg.color}`}>
      <Icon className="h-3 w-3" /> {cfg.label}
    </span>
  );
}

// ── Milestone Row ─────────────────────────────────────────────────────────────
function MilestoneRow({
  milestone, workflowId, onUpdated,
}: { milestone: InstallMilestone; workflowId: number; onUpdated: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(milestone.notes ?? "");

  const update = useMutation({
    mutationFn: (body: any) => apiRequest("PATCH", `/api/install-workflows/${workflowId}/milestones/${milestone.id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/install-workflows", workflowId] }); onUpdated(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const cfg = MILESTONE_STATUS_CONFIG[milestone.status] ?? MILESTONE_STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  const isComplete = milestone.status === "complete";

  const cycleStatus = () => {
    const next: Record<string, string> = { pending: "in_progress", in_progress: "complete", complete: "pending", blocked: "in_progress", skipped: "pending" };
    update.mutate({ status: next[milestone.status] ?? "pending" });
  };

  return (
    <div className={`group flex items-start gap-3 py-2.5 px-3 rounded-lg ${isComplete ? "opacity-60" : ""} hover:bg-muted/20`}
      data-testid={`milestone-row-${milestone.id}`}>
      <button onClick={cycleStatus} disabled={update.isPending}
        className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors
          ${isComplete ? "border-emerald-500 bg-emerald-500/20" : "border-muted-foreground/40 hover:border-primary"}`}>
        {isComplete && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-medium ${isComplete ? "line-through text-muted-foreground" : ""}`}>{milestone.name}</div>
        {milestone.description && <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{milestone.description}</div>}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <Icon className={`h-3 w-3 ${cfg.color}`} />
          <span className={`text-xs ${cfg.color}`}>{cfg.label}</span>
          {milestone.dueDate && (
            <span className={`text-xs ${new Date(milestone.dueDate) < new Date() && !isComplete ? "text-red-400" : "text-muted-foreground"}`}>
              Due {fmtDate(milestone.dueDate)}
            </span>
          )}
          {milestone.completedAt && <span className="text-xs text-emerald-400">Done {fmtDate(milestone.completedAt)}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Select value={milestone.status}
          onValueChange={(v) => update.mutate({ status: v })}>
          <SelectTrigger className="h-6 w-28 text-xs" data-testid={`milestone-status-select-${milestone.id}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(MILESTONE_STATUS_CONFIG).map(([v, c]) => (
              <SelectItem key={v} value={v}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// ── Workflow Detail Dialog ──────────────────────────────────────────────────────
function WorkflowDetailDialog({
  workflowId, open, onClose,
}: { workflowId: number; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editingBlockers, setEditingBlockers] = useState(false);
  const [blockersText, setBlockersText] = useState("");
  const [editingStatus, setEditingStatus] = useState(false);

  const { data: wf, isLoading } = useQuery<InstallWorkflow>({
    queryKey: ["/api/install-workflows", workflowId],
    queryFn: () => fetch(`/api/install-workflows/${workflowId}`, { credentials: "include" }).then(r => r.json()),
    enabled: open && !!workflowId,
  });

  const { data: users } = useQuery<any[]>({ queryKey: ["/api/users"] });

  const update = useMutation({
    mutationFn: (body: any) => apiRequest("PATCH", `/api/install-workflows/${workflowId}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/install-workflows", workflowId] });
      qc.invalidateQueries({ queryKey: ["/api/install-workflows"] });
      toast({ title: "Workflow updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0">
        {isLoading || !wf ? (
          <div className="p-6 space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : (
          <>
            {/* Header */}
            <div className="sticky top-0 bg-background border-b border-border/40 px-6 py-4 z-10">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-bold truncate" data-testid="workflow-dialog-title">{wf.title}</h2>
                    <StatusBadge status={wf.status} />
                  </div>
                  {wf.siteAddress && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                      <MapPin className="h-3 w-3" /> {wf.siteAddress}
                    </div>
                  )}
                </div>
                <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 flex-shrink-0">
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Progress bar */}
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <span>{wf.milestoneDone} / {wf.milestoneTotal} milestones</span>
                  <span>{wf.progressPct}%</span>
                </div>
                <Progress value={wf.progressPct} className="h-1.5" data-testid="workflow-progress" />
              </div>
            </div>

            <div className="px-6 py-4 space-y-5">
              {/* Key info */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "Owner",     value: wf.ownerName ?? "Unassigned", icon: User },
                  { label: "Kickoff",   value: fmtDate(wf.kickoffDate),      icon: Calendar },
                  { label: "Target",    value: fmtDate(wf.targetCompletionDate), icon: Calendar },
                  { label: "Value",     value: fmtAmt(wf.totalAmount) ?? "—",icon: DollarSign },
                ].map(k => (
                  <div key={k.label} className="rounded-lg bg-muted/30 p-2.5">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-0.5"><k.icon className="h-3 w-3" />{k.label}</div>
                    <div className="text-sm font-medium">{k.value}</div>
                  </div>
                ))}
              </div>

              {/* Status + Owner quick edit */}
              <div className="flex gap-2 flex-wrap">
                <Select value={wf.status} onValueChange={(v) => update.mutate({ status: v })}>
                  <SelectTrigger className="w-40 h-8 text-xs" data-testid="select-workflow-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WF_STATUSES.map(s => <SelectItem key={s} value={s}>{STATUS_CONFIG[s]?.label ?? s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={String(wf.ownerUserId ?? "")} onValueChange={(v) => update.mutate({ owner_user_id: v })}>
                  <SelectTrigger className="w-40 h-8 text-xs" data-testid="select-workflow-owner">
                    <SelectValue placeholder="Assign owner…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(users ?? []).map((u: any) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Blockers */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4 text-amber-400" /> Blockers
                  </span>
                  <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => { setEditingBlockers(!editingBlockers); setBlockersText(wf.blockers ?? ""); }}>
                    {editingBlockers ? "Cancel" : <><Edit2 className="h-3 w-3 mr-1" /> Edit</>}
                  </Button>
                </div>
                {editingBlockers ? (
                  <div className="space-y-2">
                    <Textarea value={blockersText} onChange={e => setBlockersText(e.target.value)} rows={3} className="text-sm" placeholder="Describe any blockers…" data-testid="input-blockers" />
                    <Button size="sm" onClick={() => { update.mutate({ blockers: blockersText }); setEditingBlockers(false); }} disabled={update.isPending} data-testid="btn-save-blockers">
                      Save
                    </Button>
                  </div>
                ) : (
                  <div className={`text-sm rounded-lg p-2.5 ${wf.blockers ? "bg-amber-500/10 border border-amber-500/30 text-amber-300" : "text-muted-foreground italic"}`}>
                    {wf.blockers || "None"}
                  </div>
                )}
              </div>

              {/* CRM Links */}
              {(wf.accountName || wf.opportunityTitle || wf.quoteNumber) && (
                <div className="space-y-1.5">
                  <div className="text-sm font-semibold">Linked Records</div>
                  <div className="space-y-1">
                    {wf.accountName && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Building2 className="h-3.5 w-3.5" />
                        <span className="font-medium text-foreground">{wf.accountName}</span>
                        <Badge variant="outline" className="text-[10px]">Account</Badge>
                      </div>
                    )}
                    {wf.opportunityTitle && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <TrendingUp className="h-3.5 w-3.5" />
                        <span className="font-medium text-foreground">{wf.opportunityTitle}</span>
                        <Badge variant="outline" className="text-[10px]">{wf.opportunityStage}</Badge>
                      </div>
                    )}
                    {wf.quoteNumber && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <FileText className="h-3.5 w-3.5" />
                        <span className="font-medium text-foreground">{wf.quoteNumber}</span>
                        <Badge variant="outline" className="text-[10px]">{wf.quoteStatus}</Badge>
                        {wf.quoteTotal && <span className="text-emerald-400">{fmtAmt(wf.quoteTotal)}</span>}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Milestones */}
              <div className="space-y-1.5">
                <div className="text-sm font-semibold flex items-center gap-2">
                  <CheckSquare className="h-4 w-4" /> Milestones
                  <span className="text-xs text-muted-foreground font-normal">({wf.milestoneDone}/{wf.milestoneTotal} complete)</span>
                </div>
                <div className="border border-border/40 rounded-lg divide-y divide-border/20">
                  {(wf.milestones ?? []).map((m) => (
                    <MilestoneRow key={m.id} milestone={m} workflowId={workflowId}
                      onUpdated={() => qc.invalidateQueries({ queryKey: ["/api/install-workflows", workflowId] })} />
                  ))}
                </div>
              </div>

              {/* Open Tasks */}
              {(wf.tasks ?? []).length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-sm font-semibold flex items-center gap-2">
                    <Zap className="h-4 w-4" /> Open Tasks
                    <Badge variant="outline" className="text-[10px]">{wf.tasks?.length}</Badge>
                  </div>
                  <div className="space-y-1">
                    {(wf.tasks ?? []).map((t: any) => (
                      <div key={t.id} className="flex items-center justify-between text-xs py-1.5 px-2 rounded hover:bg-muted/20"
                        data-testid={`task-row-${t.id}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${t.priority === "high" ? "bg-red-400" : t.priority === "medium" ? "bg-amber-400" : "bg-slate-400"}`} />
                          <span className="truncate">{t.title}</span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground flex-shrink-0 ml-2">
                          {t.owner_name && <span>{t.owner_name}</span>}
                          {t.due_date && <span className={new Date(t.due_date) < new Date() ? "text-red-400" : ""}>{fmtDate(t.due_date)}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              <div className="space-y-1.5">
                <div className="text-sm font-semibold">Notes</div>
                <Textarea
                  defaultValue={wf.notes ?? ""}
                  rows={3}
                  className="text-sm"
                  placeholder="Add workflow notes…"
                  onBlur={(e) => { if (e.target.value !== (wf.notes ?? "")) update.mutate({ notes: e.target.value }); }}
                  data-testid="input-workflow-notes"
                />
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Workflow Card ─────────────────────────────────────────────────────────────
function WorkflowCard({ wf, onClick }: { wf: InstallWorkflow; onClick: () => void }) {
  const cfg = STATUS_CONFIG[wf.status] ?? STATUS_CONFIG.pending_kickoff;
  const isOverdue = wf.targetCompletionDate && new Date(wf.targetCompletionDate) < new Date() && wf.status !== "complete";

  return (
    <Card className={`border border-border/50 hover:border-border cursor-pointer transition-colors`}
      onClick={onClick} data-testid={`workflow-card-${wf.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate">{wf.title}</div>
            {wf.accountName && (
              <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <Building2 className="h-3 w-3" /> {wf.accountName}
              </div>
            )}
          </div>
          <StatusBadge status={wf.status} />
        </div>

        {/* Progress */}
        <div className="mb-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>{wf.milestoneDone}/{wf.milestoneTotal} milestones</span>
            <span>{wf.progressPct}%</span>
          </div>
          <Progress value={wf.progressPct} className="h-1" />
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          {wf.ownerName && <span className="flex items-center gap-1"><User className="h-3 w-3" />{wf.ownerName}</span>}
          {wf.totalAmount && <span className="flex items-center gap-1 text-emerald-400"><DollarSign className="h-3 w-3" />{fmtAmt(wf.totalAmount)}</span>}
          {wf.targetCompletionDate && (
            <span className={`flex items-center gap-1 ${isOverdue ? "text-red-400" : ""}`}>
              <Calendar className="h-3 w-3" />
              {isOverdue ? "Overdue — " : ""}
              {fmtDate(wf.targetCompletionDate)}
            </span>
          )}
          {wf.milestoneBlocked > 0 && (
            <span className="flex items-center gap-1 text-amber-400">
              <AlertTriangle className="h-3 w-3" /> {wf.milestoneBlocked} blocked
            </span>
          )}
          {wf.blockers && <span className="text-red-400 font-medium">⚠ Blocker</span>}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Create Workflow Dialog ─────────────────────────────────────────────────────
function CreateWorkflowDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: users } = useQuery<any[]>({ queryKey: ["/api/users"] });
  const [form, setForm] = useState({ title: "", ownerUserId: "", kickoffDate: "", targetCompletionDate: "", notes: "" });

  const create = useMutation({
    mutationFn: () => apiRequest("POST", "/api/install-workflows", {
      ...form,
      ownerUserId: form.ownerUserId ? parseInt(form.ownerUserId) : undefined,
    }),
    onSuccess: () => {
      toast({ title: "Install workflow created" });
      qc.invalidateQueries({ queryKey: ["/api/install-workflows"] });
      qc.invalidateQueries({ queryKey: ["/api/install-workflows/summary"] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New Install Workflow</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Title *</label>
            <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Install – Marina Name" data-testid="input-wf-title" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Owner</label>
            <Select value={form.ownerUserId} onValueChange={v => setForm(f => ({ ...f, ownerUserId: v }))}>
              <SelectTrigger data-testid="select-wf-owner"><SelectValue placeholder="Select owner…" /></SelectTrigger>
              <SelectContent>{(users ?? []).map((u: any) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Kickoff Date</label>
              <Input type="date" value={form.kickoffDate} onChange={e => setForm(f => ({ ...f, kickoffDate: e.target.value }))} data-testid="input-wf-kickoff" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Target Completion</label>
              <Input type="date" value={form.targetCompletionDate} onChange={e => setForm(f => ({ ...f, targetCompletionDate: e.target.value }))} data-testid="input-wf-target" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Optional context…" data-testid="input-wf-notes" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!form.title || create.isPending} onClick={() => create.mutate()} data-testid="btn-create-workflow">
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function InstallWorkflowsPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [drilldownConfig, setDrilldownConfig] = useState<UniversalDrilldownConfig | null>(null);

  const { data: summary } = useQuery<any>({
    queryKey: ["/api/install-workflows/summary"],
    queryFn: () => fetch("/api/install-workflows/summary", { credentials: "include" }).then(r => r.json()),
  });

  const { data: listData, isLoading } = useQuery<{ data: InstallWorkflow[]; total: number }>({
    queryKey: ["/api/install-workflows", statusFilter],
    queryFn: () => {
      const url = statusFilter === "all"
        ? "/api/install-workflows"
        : `/api/install-workflows?status=${statusFilter}`;
      return fetch(url, { credentials: "include" }).then(r => r.json());
    },
  });

  const workflows = listData?.data ?? [];

  const tabs = [
    { key: "all",            label: "All",             count: summary?.total ?? 0 },
    { key: "pending_kickoff",label: "Awaiting Kickoff",count: summary?.byStatus?.pending_kickoff ?? 0 },
    { key: "in_progress",    label: "In Progress",     count: summary?.byStatus?.in_progress ?? 0 },
    { key: "on_hold",        label: "On Hold",         count: summary?.byStatus?.on_hold ?? 0 },
    { key: "complete",       label: "Complete",        count: summary?.byStatus?.complete ?? 0 },
  ];

  return (
    <div className="flex-1 overflow-auto bg-background p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" data-testid="page-title">
            <Hammer className="h-5 w-5 text-primary" />
            Install & Onboarding Workflows
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Track delivery from accepted quote through commissioning and closeout.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} data-testid="btn-new-workflow" size="sm">
          <Plus className="h-4 w-4 mr-1" /> New Workflow
        </Button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total",       value: summary.total,        color: "text-foreground",  metric: "" },
            { label: "In Progress", value: summary.byStatus?.in_progress ?? 0, color: "text-blue-400",  metric: "active_installs" },
            { label: "Overdue",     value: summary.overdue,      color: summary.overdue > 0 ? "text-red-400" : "text-foreground",   metric: "overdue_installs" },
            { label: "With Blockers", value: summary.withBlockers, color: summary.withBlockers > 0 ? "text-amber-400" : "text-foreground", metric: "blocked_installs" },
          ].map(card => (
            <Card
              key={card.label}
              className={`border border-border/50 ${card.metric ? "cursor-pointer hover:border-primary/40 hover:bg-card/80 transition-all" : ""}`}
              data-testid={`summary-card-${card.label.toLowerCase().replace(/\s/g,"-")}`}
              onClick={card.metric ? () => setDrilldownConfig({ metric: card.metric }) : undefined}
            >
              <CardContent className="p-3">
                <div className="text-xs text-muted-foreground">{card.label}</div>
                <div className={`text-2xl font-bold tabular-nums ${card.color}`}>{card.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Tabs + List */}
      <Tabs value={statusFilter} onValueChange={setStatusFilter}>
        <TabsList className="w-full justify-start gap-1 h-9 bg-muted/40 p-1">
          {tabs.map(t => (
            <TabsTrigger key={t.key} value={t.key} className="text-xs" data-testid={`tab-${t.key}`}>
              {t.label}
              {t.count > 0 && <Badge variant="outline" className="ml-1 text-[10px] px-1">{t.count}</Badge>}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={statusFilter} className="mt-4">
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-32" />)}
            </div>
          ) : workflows.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Hammer className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p>No install workflows found.</p>
              <p className="text-sm mt-1">Create a workflow when a quote is accepted.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {workflows.map(wf => (
                <WorkflowCard key={wf.id} wf={wf} onClick={() => setSelectedId(wf.id)} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      {selectedId !== null && (
        <WorkflowDetailDialog workflowId={selectedId} open={true} onClose={() => setSelectedId(null)} />
      )}
      <CreateWorkflowDialog open={showCreate} onClose={() => setShowCreate(false)} />

      <UniversalDrilldownSheet
        config={drilldownConfig}
        onClose={() => setDrilldownConfig(null)}
        endpoint="/api/operations/drilldown"
      />
    </div>
  );
}
