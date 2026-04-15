import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { NotesPanel } from "@/components/notes-panel";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Layers, Anchor, Handshake, Landmark, FlaskConical,
  CalendarDays, Megaphone, Star, Pencil, Trash2, DollarSign,
  ShieldCheck, AlertTriangle, CheckCircle2, Circle, Clock,
  ChevronDown, ChevronRight, ExternalLink, Zap, Loader2,
  TrendingUp, XCircle, TriangleAlert, RefreshCw, FileText,
  FlaskRound, Users, BarChart3, Link2,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────
type Project = {
  id: number; name: string; type: string; status: string; phase?: string;
  description?: string; accountId?: number; ownerUserId?: number;
  budget?: number; currency?: string; startDate?: string; endDate?: string;
  certification_status?: string; overall_risk?: string; launch_blocker?: boolean;
  cert_target_completion_date?: string; certification_program?: string; product_name?: string;
  next_action_due_date?: string;
};
type CertRecord = Record<string, any>;
type Milestone = { id: number; project_id: number; title: string; status: string; sort_order: number; due_date?: string; completed_at?: string; notes?: string; };

// ── Constants ──────────────────────────────────────────────────────────────────
const PROJECT_TYPES = [
  { key: "pilot",         label: "Pilot",                icon: Anchor,      color: "text-cyan-400",   bg: "bg-cyan-500/10",   border: "border-cyan-500/20"   },
  { key: "lighthouse",   label: "Lighthouse",           icon: Star,        color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/20" },
  { key: "partnership",  label: "Partnership",          icon: Handshake,   color: "text-blue-400",   bg: "bg-blue-500/10",   border: "border-blue-500/20"   },
  { key: "grant",        label: "Grant",                icon: Landmark,    color: "text-green-400",  bg: "bg-green-500/10",  border: "border-green-500/20"  },
  { key: "research",     label: "Research",             icon: FlaskConical,color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20" },
  { key: "event",        label: "Event",                icon: CalendarDays,color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20" },
  { key: "marketing",    label: "Marketing / Content",  icon: Megaphone,   color: "text-pink-400",   bg: "bg-pink-500/10",   border: "border-pink-500/20"   },
  { key: "internal",     label: "Internal Initiative",  icon: Layers,      color: "text-slate-400",  bg: "bg-slate-500/10",  border: "border-slate-500/20"  },
  { key: "certification",label: "Safety Certification", icon: ShieldCheck, color: "text-red-400",    bg: "bg-red-500/10",    border: "border-red-500/20"    },
];

const CERT_PROGRAMS = ["CSA", "UL", "ETL", "FCC", "CE", "ABYC", "IEC", "Other"];
const CERT_STATUS_OPTIONS = [
  "Planning","Document Prep","Sample Build","Submitted","In Testing",
  "Failure Review","Corrective Action","Retest","Passed","Certified","Blocked","Cancelled",
];
const CERT_STATUS_COLORS: Record<string, string> = {
  "Planning":           "text-slate-400  border-slate-500/30  bg-slate-500/10",
  "Document Prep":      "text-blue-400   border-blue-500/30   bg-blue-500/10",
  "Sample Build":       "text-indigo-400 border-indigo-500/30 bg-indigo-500/10",
  "Submitted":          "text-cyan-400   border-cyan-500/30   bg-cyan-500/10",
  "In Testing":         "text-yellow-400 border-yellow-500/30 bg-yellow-500/10",
  "Failure Review":     "text-orange-400 border-orange-500/30 bg-orange-500/10",
  "Corrective Action":  "text-orange-400 border-orange-500/30 bg-orange-500/10",
  "Retest":             "text-amber-400  border-amber-500/30  bg-amber-500/10",
  "Passed":             "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  "Certified":          "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  "Blocked":            "text-red-400    border-red-500/30    bg-red-500/10",
  "Cancelled":          "text-muted-foreground border-border/40 bg-muted/20",
};
const RISK_COLORS: Record<string, { text: string; border: string; bg: string }> = {
  Low:      { text: "text-emerald-400", border: "border-emerald-500/30", bg: "bg-emerald-500/10" },
  Medium:   { text: "text-yellow-400",  border: "border-yellow-500/30",  bg: "bg-yellow-500/10"  },
  High:     { text: "text-orange-400",  border: "border-orange-500/30",  bg: "bg-orange-500/10"  },
  Critical: { text: "text-red-400",     border: "border-red-500/30",     bg: "bg-red-500/10"     },
};
const STATUS_COLORS: Record<string, string> = {
  planning:  "bg-slate-500/10  text-slate-400  border-slate-500/20",
  active:    "bg-green-500/10  text-green-400  border-green-500/20",
  paused:    "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  completed: "bg-blue-500/10   text-blue-400   border-blue-500/20",
  cancelled: "bg-red-500/10    text-red-400    border-red-500/20",
};

function getTypeConfig(type: string) {
  return PROJECT_TYPES.find(t => t.key === type) ?? PROJECT_TYPES[PROJECT_TYPES.length - 2];
}
function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}
function daysUntil(d?: string | null) {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

// ── Collapsible section ────────────────────────────────────────────────────────
function Section({ title, icon: Icon, defaultOpen = true, badge, children }: {
  title: string; icon?: any; defaultOpen?: boolean; badge?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border/40 rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/20 hover:bg-muted/30 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
          {badge && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/20 text-primary">{badge}</span>}
        </div>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
      {open && <div className="px-4 py-3 space-y-3">{children}</div>}
    </div>
  );
}

// ── Field row helpers (for read/edit) ─────────────────────────────────────────
function FieldGrid({ children, cols = 2 }: { children: React.ReactNode; cols?: 2 | 3 | 4 }) {
  const cls = cols === 4 ? "grid grid-cols-4 gap-3" : cols === 3 ? "grid grid-cols-3 gap-3" : "grid grid-cols-2 gap-3";
  return <div className={cls}>{children}</div>;
}

// ── Cert health calculation ─────────────────────────────────────────────────
function calcCertHealth(cert: CertRecord | null | undefined): { label: string; color: string; bg: string; border: string } {
  if (!cert) return { label: "Unknown", color: "text-muted-foreground", bg: "bg-muted/20", border: "border-border/30" };
  if (cert.launch_blocker) return { label: "Blocked", color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30" };
  const nextActionDays = daysUntil(cert.next_action_due_date);
  const targetDays = daysUntil(cert.target_completion_date);
  if (cert.retest_required && !["Certified","Passed"].includes(cert.certification_status ?? "")) return { label: "At Risk", color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/30" };
  if (cert.failure_found && !["Certified","Passed"].includes(cert.certification_status ?? "")) return { label: "At Risk", color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/30" };
  if (nextActionDays !== null && nextActionDays < 0) return { label: "At Risk", color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/30" };
  if (targetDays !== null && targetDays < 0 && !["Certified","Passed","Cancelled"].includes(cert.certification_status ?? "")) return { label: "At Risk", color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/30" };
  if (["Certified","Passed"].includes(cert.certification_status ?? "")) return { label: "Complete", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30" };
  return { label: "On Track", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30" };
}

// ── Warning banners ────────────────────────────────────────────────────────────
function CertWarningBanners({ cert, projectName }: { cert: CertRecord | null | undefined; projectName: string }) {
  if (!cert) return null;
  const warnings: { key: string; icon: any; msg: string; cls: string }[] = [];
  if (cert.launch_blocker) {
    warnings.push({ key: "blocker", icon: XCircle, msg: `Launch blocked${cert.blocker_summary ? " — " + cert.blocker_summary : ""}`, cls: "border-red-500/30 bg-red-500/10 text-red-400" });
  }
  const nextActionDays = daysUntil(cert.next_action_due_date);
  if (nextActionDays !== null && nextActionDays < 0 && cert.next_action) {
    warnings.push({ key: "nextaction", icon: AlertTriangle, msg: `Next action overdue by ${Math.abs(nextActionDays)}d: "${cert.next_action}"`, cls: "border-orange-500/30 bg-orange-500/10 text-orange-400" });
  } else if (nextActionDays !== null && nextActionDays >= 0 && nextActionDays <= 3 && cert.next_action) {
    warnings.push({ key: "nextaction-soon", icon: Clock, msg: `Next action due in ${nextActionDays}d: "${cert.next_action}"`, cls: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400" });
  }
  const targetDays = daysUntil(cert.target_completion_date);
  if (targetDays !== null && targetDays < 0 && !["Certified","Passed","Cancelled"].includes(cert.certification_status ?? "")) {
    warnings.push({ key: "target-overdue", icon: TriangleAlert, msg: `Target completion overdue by ${Math.abs(targetDays)}d — still "${cert.certification_status}"`, cls: "border-orange-500/30 bg-orange-500/10 text-orange-400" });
  } else if (targetDays !== null && targetDays >= 0 && targetDays <= 14 && !["Certified","Passed","Cancelled"].includes(cert.certification_status ?? "")) {
    warnings.push({ key: "target-soon", icon: Clock, msg: `Target completion in ${targetDays}d`, cls: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400" });
  }
  if (cert.retest_required && !["Certified","Passed"].includes(cert.certification_status ?? "")) {
    const retestDays = daysUntil(cert.retest_date);
    warnings.push({ key: "retest", icon: RefreshCw, msg: `Retest required${retestDays !== null ? ` — due in ${retestDays}d` : ""}`, cls: "border-amber-500/30 bg-amber-500/10 text-amber-400" });
  }
  const expiryDays = daysUntil(cert.certificate_expiry_date);
  if (expiryDays !== null && expiryDays >= 0 && expiryDays <= 90) {
    warnings.push({ key: "expiry", icon: AlertTriangle, msg: `Certificate expires in ${expiryDays}d`, cls: expiryDays <= 30 ? "border-red-500/30 bg-red-500/10 text-red-400" : "border-yellow-500/30 bg-yellow-500/10 text-yellow-400" });
  }
  if (!warnings.length) return null;
  return (
    <div className="space-y-1.5">
      {warnings.map(w => {
        const Icon = w.icon;
        return (
          <div key={w.key} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${w.cls}`} data-testid={`warning-${w.key}`}>
            <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{w.msg}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Milestone Checklist ────────────────────────────────────────────────────────
function MilestoneChecklist({ projectId }: { projectId: number }) {
  const { toast } = useToast();
  const { data: milestones = [], isLoading } = useQuery<Milestone[]>({
    queryKey: ["/api/projects", projectId, "milestones"],
    queryFn: () => fetch(`/api/projects/${projectId}/milestones`, { credentials: "include" }).then(r => r.json()),
  });
  const updateMilestone = useMutation({
    mutationFn: ({ mid, status }: { mid: number; status: string }) =>
      apiRequest("PATCH", `/api/projects/${projectId}/milestones/${mid}`, { status }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "milestones"] }),
    onError: () => toast({ title: "Failed to update milestone", variant: "destructive" }),
  });

  if (isLoading) return <div className="space-y-1.5">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8" />)}</div>;
  if (!milestones.length) return <div className="text-xs text-muted-foreground text-center py-6">No milestones yet.</div>;

  const doneCount = milestones.filter(m => m.status === "done").length;
  const pct = Math.round((doneCount / milestones.length) * 100);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">{doneCount}/{milestones.length} ({pct}%)</span>
      </div>
      {milestones.map(m => {
        const isDone = m.status === "done";
        const isSkipped = m.status === "skipped";
        const overdue = m.due_date && !isDone && daysUntil(m.due_date)! < 0;
        return (
          <div key={m.id} className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md border transition-colors ${isDone ? "border-emerald-500/20 bg-emerald-500/5" : isSkipped ? "border-border/20 opacity-50" : overdue ? "border-red-500/20 bg-red-500/5" : "border-border/40 hover:border-border"}`}
            data-testid={`milestone-${m.id}`}>
            <button onClick={() => updateMilestone.mutate({ mid: m.id, status: isDone ? "pending" : "done" })} className="shrink-0" data-testid={`milestone-toggle-${m.id}`}>
              {isDone ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : m.status === "in_progress" ? <Clock className="h-4 w-4 text-amber-400" /> : <Circle className="h-4 w-4 text-muted-foreground/40" />}
            </button>
            <span className={`text-xs flex-1 ${isDone ? "line-through text-muted-foreground" : ""}`}>{m.title}</span>
            {m.due_date && !isDone && (
              <span className={`text-[10px] ${overdue ? "text-red-400 font-medium" : "text-muted-foreground"}`}>{fmtDate(m.due_date)}</span>
            )}
            <Select value={m.status} onValueChange={v => updateMilestone.mutate({ mid: m.id, status: v })}>
              <SelectTrigger className="h-6 w-24 text-[10px] border-0 bg-transparent p-0 pr-1 shadow-none focus:ring-0" data-testid={`milestone-status-${m.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="done">Done</SelectItem>
                <SelectItem value="skipped">Skipped</SelectItem>
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </div>
  );
}

// ── Certification full edit/view panel ────────────────────────────────────────
function CertificationDetailPanel({ projectId, projectName }: { projectId: number; projectName: string }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [changes, setChanges] = useState<Record<string, any>>({});

  const { data: cert, isLoading } = useQuery<CertRecord | null>({
    queryKey: ["/api/projects", projectId, "certification"],
    queryFn: () => fetch(`/api/projects/${projectId}/certification`, { credentials: "include" }).then(r => r.json()),
  });

  const saveMutation = useMutation({
    mutationFn: (body: any) => apiRequest("POST", `/api/projects/${projectId}/certification`, body).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "certification"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setEditing(false); setChanges({});
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const createAlerts = useMutation({
    mutationFn: () => apiRequest("POST", `/api/projects/${projectId}/create-alerts`, {}),
    onSuccess: (d: any) => toast({ title: d.tasksCreated ? `${d.tasksCreated} alert task(s) created` : "No new alerts (already up to date)" }),
    onError: () => toast({ title: "Failed to create alerts", variant: "destructive" }),
  });

  if (isLoading) return <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-8" />)}</div>;

  const merged = { ...(cert ?? {}), ...changes };
  const v = (key: string, fallback: any = "") => merged[key] ?? fallback;
  const set = (key: string, val: any) => { setChanges(prev => ({ ...prev, [key]: val })); if (!editing) setEditing(true); };

  const programs: string[] = (() => { try { return JSON.parse(v("certification_program", "[]")); } catch { return []; } })();
  const toggleProgram = (p: string) => {
    const next = programs.includes(p) ? programs.filter(x => x !== p) : [...programs, p];
    set("certificationProgram", JSON.stringify(next));
  };

  const handleSave = () => saveMutation.mutate(changes);
  const health = calcCertHealth(merged);

  // Convenience field renderers
  const TF = ({ label, fkey, type = "text", ph }: { label: string; fkey: string; type?: string; ph?: string }) => (
    <div className="space-y-1">
      <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wide">{label}</div>
      {editing
        ? <Input type={type} className="h-7 text-xs" defaultValue={v(fkey)} onChange={e => set(fkey, e.target.value || null)} placeholder={ph} />
        : <div className="text-sm">{v(fkey) || <span className="italic text-muted-foreground/30">—</span>}</div>}
    </div>
  );

  const SF = ({ label, fkey, opts }: { label: string; fkey: string; opts: string[] }) => (
    <div className="space-y-1">
      <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wide">{label}</div>
      {editing
        ? <Select value={v(fkey, "")} onValueChange={val => set(fkey, val)}>
            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
            <SelectContent>{opts.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
          </Select>
        : <div className="text-sm">{v(fkey) || <span className="italic text-muted-foreground/30">—</span>}</div>}
    </div>
  );

  const BF = ({ label, fkey, id }: { label: string; fkey: string; id?: string }) => {
    const val = v(fkey, false);
    return (
      <div className="flex items-center gap-2 cursor-pointer select-none" onClick={() => set(fkey, !val)} data-testid={id}>
        <div className={`h-4 w-7 rounded-full transition-colors flex items-center px-0.5 ${val ? "bg-primary justify-end" : "bg-muted justify-start"}`}>
          <div className="h-3 w-3 rounded-full bg-white shadow" />
        </div>
        <span className="text-xs">{label}</span>
      </div>
    );
  };

  const LinkF = ({ label, fkey }: { label: string; fkey: string }) => (
    <div className="space-y-1">
      <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wide">{label}</div>
      {editing
        ? <Input className="h-7 text-xs" defaultValue={v(fkey)} onChange={e => set(fkey, e.target.value || null)} placeholder="https://…" />
        : v(fkey)
          ? <a href={v(fkey)} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1"><ExternalLink className="h-3 w-3" />{v(fkey)}</a>
          : <span className="italic text-muted-foreground/30 text-sm">—</span>}
    </div>
  );

  const currentPrograms: string[] = (() => { try { return JSON.parse(v("certification_program", "[]")); } catch { return []; } })();

  return (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${health.color} ${health.border} ${health.bg}`} data-testid="cert-health-badge">
            {health.label === "Blocked" ? <XCircle className="h-3 w-3" /> : health.label === "At Risk" ? <AlertTriangle className="h-3 w-3" /> : health.label === "Complete" ? <CheckCircle2 className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
            {health.label}
          </div>
          {v("certification_status") && (
            <Badge variant="outline" className={`text-xs ${CERT_STATUS_COLORS[v("certification_status")] ?? ""}`} data-testid="badge-cert-status">
              {v("certification_status")}
            </Badge>
          )}
          {v("overall_risk") && v("overall_risk") !== "Low" && (
            <Badge variant="outline" className={`text-xs ${RISK_COLORS[v("overall_risk")]?.text ?? ""} ${RISK_COLORS[v("overall_risk")]?.border ?? ""}`} data-testid="badge-overall-risk">
              {v("overall_risk")} Risk
            </Badge>
          )}
          {v("launch_blocker") && (
            <Badge variant="outline" className="text-xs text-red-400 border-red-500/40 bg-red-500/10 gap-1" data-testid="badge-launch-blocker">
              <AlertTriangle className="h-3 w-3" /> Launch Blocker
            </Badge>
          )}
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => createAlerts.mutate()} disabled={createAlerts.isPending} data-testid="btn-create-alerts">
            {createAlerts.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />} Alerts
          </Button>
          {editing ? (
            <>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setEditing(false); setChanges({}); }}>Cancel</Button>
              <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={saveMutation.isPending} data-testid="btn-save-cert">
                {saveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setEditing(true)} data-testid="btn-edit-cert">
              <Pencil className="h-3 w-3" /> Edit
            </Button>
          )}
        </div>
      </div>

      {/* Warning banners */}
      <CertWarningBanners cert={merged} projectName={projectName} />

      {/* Section 2 — Snapshot */}
      <Section title="Certification Snapshot" icon={BarChart3} defaultOpen>
        {/* Programs */}
        <div className="space-y-1.5">
          <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wide">Certification Program(s)</div>
          <div className="flex flex-wrap gap-1.5">
            {CERT_PROGRAMS.map(p => {
              const active = currentPrograms.includes(p);
              return (
                <button key={p} onClick={() => toggleProgram(p)}
                  className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${active ? "bg-primary/20 text-primary border-primary/40 font-medium" : "border-border/50 text-muted-foreground hover:border-border"}`}
                  data-testid={`cert-program-${p}`}>{p}</button>
              );
            })}
          </div>
        </div>
        <FieldGrid>
          <SF label="Certification Status" fkey="certificationStatus" opts={CERT_STATUS_OPTIONS} />
          <SF label="Overall Risk" fkey="overallRisk" opts={["Low","Medium","High","Critical"]} />
          <TF label="Product Name" fkey="product_name" />
          <TF label="Product Version" fkey="product_version" />
          <SF label="Priority" fkey="certificationPriority" opts={["Critical","High","Medium","Low"]} />
          <TF label="Next Action Due Date" fkey="next_action_due_date" type="date" />
        </FieldGrid>
        <TF label="Next Action" fkey="next_action" ph="What needs to happen next…" />
        <div className="space-y-2">
          <BF label="Launch Blocker" fkey="launchBlocker" id="toggle-launch-blocker" />
          {v("launch_blocker") && <TF label="Blocker Summary" fkey="blocker_summary" ph="Describe what is blocking launch…" />}
        </div>
      </Section>

      {/* Section 3 — Product + Scope */}
      <Section title="Product + Scope" icon={FlaskRound} defaultOpen>
        <FieldGrid>
          <TF label="Product Name" fkey="product_name" />
          <TF label="Product Version" fkey="product_version" />
          <TF label="Revision" fkey="product_revision" />
          <TF label="SKU / Internal Code" fkey="sku_or_internal_code" />
          <SF label="Target Market" fkey="target_market" opts={["Canada","USA","Europe","Global","Other"]} />
        </FieldGrid>
        <TF label="Certification Scope" fkey="certification_scope" ph="Describe what is in scope for this certification…" />
        <TF label="Standard Codes" fkey="certification_standard_codes" ph="e.g. CSA C22.2 No. 107.1, UL 2594" />
      </Section>

      {/* Section 4 — Lab + Regulatory + Dates */}
      <Section title="Lab / Regulatory + Dates" icon={CalendarDays} defaultOpen>
        <FieldGrid>
          <TF label="Testing Lab" fkey="testing_lab_name" />
          <TF label="Lab Contact" fkey="lab_contact_name" />
          <TF label="Lab Email" fkey="lab_contact_email" type="email" />
          <TF label="Lab Phone" fkey="lab_contact_phone" />
        </FieldGrid>
        <Separator />
        <FieldGrid>
          <TF label="Application Submitted" fkey="application_submission_date" type="date" />
          <TF label="Planned Test Start" fkey="planned_test_start_date" type="date" />
          <TF label="Actual Test Start" fkey="actual_test_start_date" type="date" />
          <TF label="Target Completion" fkey="target_completion_date" type="date" />
          <TF label="Actual Completion" fkey="actual_completion_date" type="date" />
          <TF label="Pass Date" fkey="pass_date" type="date" />
          <TF label="Certificate Issued" fkey="certificate_issue_date" type="date" />
          <TF label="Certificate Expiry" fkey="certificate_expiry_date" type="date" />
        </FieldGrid>
      </Section>

      {/* Section 5 — Sample / Unit Tracking */}
      <Section title="Sample / Unit Tracking" icon={Layers} defaultOpen={false}>
        <FieldGrid cols={4}>
          <TF label="Required" fkey="sample_units_required" type="number" />
          <TF label="Built" fkey="sample_units_built" type="number" />
          <TF label="Shipped" fkey="sample_units_shipped" type="number" />
          <TF label="Recv'd by Lab" fkey="sample_units_received_by_lab" type="number" />
        </FieldGrid>
        <TF label="Serial Numbers" fkey="sample_serial_numbers" ph="S/N-001, S/N-002…" />
        <TF label="Sample Notes" fkey="sample_notes" />
      </Section>

      {/* Section 6 — Failures / Corrective Action */}
      <Section title="Failures / Corrective Action" icon={TriangleAlert}
        defaultOpen={!!(v("failure_found") || v("corrective_action_required") || v("retest_required"))}>
        <div className="space-y-3">
          <BF label="Failure Found" fkey="failureFound" id="toggle-failure-found" />
          {v("failure_found") && <TF label="Failure Summary" fkey="failure_summary" ph="Describe the failure mode…" />}
          <BF label="Corrective Action Required" fkey="correctiveActionRequired" />
          {v("corrective_action_required") && <TF label="Corrective Action Summary" fkey="corrective_action_summary" ph="Describe the corrective action plan…" />}
          <BF label="Retest Required" fkey="retestRequired" id="toggle-retest-required" />
          {v("retest_required") && (
            <FieldGrid>
              <TF label="Retest Date" fkey="retest_date" type="date" />
              <TF label="Pass Date" fkey="pass_date" type="date" />
            </FieldGrid>
          )}
        </div>
      </Section>

      {/* Section 7 — Internal / Commercial */}
      <Section title="Internal / Commercial" icon={Users} defaultOpen={false}>
        <FieldGrid>
          <TF label="Engineering Owner" fkey="engineering_owner" />
          <TF label="Operations Owner" fkey="operations_owner" />
          <TF label="Linked Supplier" fkey="linked_supplier" />
          <TF label="Production Batch" fkey="linked_production_batch" />
          <TF label="Estimated Cost ($)" fkey="estimated_certification_cost" type="number" />
          <TF label="Actual Cost ($)" fkey="actual_certification_cost" type="number" />
          <SF label="Budget Status" fkey="budgetStatus" opts={["On Budget","At Risk","Over Budget"]} />
        </FieldGrid>
      </Section>

      {/* Section 8 — Documents + Links */}
      <Section title="Documents + Links" icon={FileText} defaultOpen={!!(v("certification_doc_link") || v("test_report_link") || v("shared_drive_folder_link") || v("compliance_notes"))}>
        <LinkF label="Certification Doc" fkey="certification_doc_link" />
        <LinkF label="Test Report" fkey="test_report_link" />
        <LinkF label="Shared Drive Folder" fkey="shared_drive_folder_link" />
        <LinkF label="Certificate File" fkey="certificate_file" />
        <div className="space-y-1">
          <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wide">Compliance Notes</div>
          {editing
            ? <Textarea className="text-xs min-h-[72px] resize-none" defaultValue={v("compliance_notes")} onChange={e => set("compliance_notes", e.target.value || null)} placeholder="Any relevant compliance notes…" />
            : v("compliance_notes")
              ? <p className="text-sm text-muted-foreground whitespace-pre-wrap">{v("compliance_notes")}</p>
              : <span className="italic text-muted-foreground/30 text-sm">—</span>}
        </div>
      </Section>
    </div>
  );
}

// ── Project Card ───────────────────────────────────────────────────────────────
function ProjectCard({ project, onClick }: { project: Project; onClick: () => void }) {
  const typeConfig = getTypeConfig(project.type);
  const Icon = typeConfig.icon;
  const isCert = project.type === "certification";
  const riskStyle = project.overall_risk ? RISK_COLORS[project.overall_risk] : null;

  return (
    <Card className="border-border/50 hover:border-border cursor-pointer transition-all hover:shadow-md group" onClick={onClick} data-testid={`card-project-${project.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className={`w-8 h-8 rounded-lg ${typeConfig.bg} ${typeConfig.border} border flex items-center justify-center shrink-0`}>
            <Icon className={`h-4 w-4 ${typeConfig.color}`} />
          </div>
          <div className="flex items-center gap-1 flex-wrap justify-end">
            {isCert && project.launch_blocker && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-red-400 border-red-500/30 bg-red-500/10 gap-0.5" data-testid={`badge-launch-blocker-${project.id}`}>
                <AlertTriangle className="h-2.5 w-2.5" /> Blocker
              </Badge>
            )}
            <Badge variant="outline" className={`text-[11px] px-1.5 py-0 ${STATUS_COLORS[project.status] || ""}`}>{project.status}</Badge>
          </div>
        </div>

        <h3 className="font-semibold text-sm leading-tight mb-1.5">{project.name}</h3>

        {isCert && (
          <div className="space-y-1 mb-2">
            {project.certification_status && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${CERT_STATUS_COLORS[project.certification_status] ?? ""}`} data-testid={`badge-cert-status-${project.id}`}>
                  {project.certification_status}
                </Badge>
                {project.overall_risk && project.overall_risk !== "Low" && riskStyle && (
                  <span className={`text-[10px] font-medium ${riskStyle.text}`} data-testid={`text-risk-${project.id}`}>{project.overall_risk} Risk</span>
                )}
              </div>
            )}
            {project.product_name && (
              <p className="text-[10px] text-muted-foreground truncate">{project.product_name}</p>
            )}
            {project.cert_target_completion_date && (
              <p className="text-[10px] text-muted-foreground" data-testid={`text-target-completion-${project.id}`}>
                Target: {fmtDate(project.cert_target_completion_date)}
              </p>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${typeConfig.bg} ${typeConfig.color} ${typeConfig.border}`}>
            {typeConfig.label}
          </span>
          {project.phase && <span className="text-[10px] text-muted-foreground">Phase: {project.phase}</span>}
        </div>

        {!isCert && (project.startDate || project.endDate) && (
          <p className="text-[10px] text-muted-foreground mt-1.5">
            {project.startDate ? new Date(project.startDate).getFullYear() : "?"} – {project.endDate ? new Date(project.endDate).getFullYear() : "ongoing"}
          </p>
        )}
        {project.budget && (
          <div className="flex items-center gap-1 mt-1.5">
            <DollarSign className="h-3 w-3 text-green-400" />
            <span className="text-xs text-green-400">{Number(project.budget).toLocaleString()}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── SLIM Quick-Create Modal ────────────────────────────────────────────────────
function ProjectQuickCreateDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState("pilot");
  const [status, setStatus] = useState("planning");
  const [description, setDescription] = useState("");

  const mutation = useMutation({
    mutationFn: async (d: any) => (await apiRequest("POST", "/api/projects", d)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Project created", description: type === "certification" ? "Fill in certification details in the project view." : undefined });
      onClose();
    },
    onError: () => toast({ title: "Failed to create", variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4" /> New Project
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Project Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} className="mt-1" autoFocus placeholder="What are we tracking?" data-testid="input-project-name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="mt-1 h-8 text-sm" data-testid="select-project-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROJECT_TYPES.map(t => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="mt-1 h-8 text-sm" data-testid="select-project-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="planning">Planning</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {type === "certification" && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs flex items-start gap-2">
              <ShieldCheck className="h-3.5 w-3.5 text-red-400 mt-0.5 shrink-0" />
              <div>
                <span className="text-red-400 font-medium">Safety Certification project</span>
                <span className="text-muted-foreground"> — open the project after saving to fill in lab details, milestones, and sample tracking.</span>
              </div>
            </div>
          )}

          <div>
            <Label className="text-xs">Description <span className="text-muted-foreground/50">(optional)</span></Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="mt-1 text-sm resize-none" placeholder="Brief summary…" data-testid="input-project-description" />
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => mutation.mutate({ name: name.trim(), type, status, description: description || undefined })} disabled={!name.trim() || mutation.isPending} data-testid="button-save-project">
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Full Edit Modal (non-cert types or edit) ──────────────────────────────────
function ProjectEditDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(project.name);
  const [status, setStatus] = useState(project.status);
  const [phase, setPhase] = useState(project.phase || "");
  const [description, setDescription] = useState(project.description || "");
  const [budget, setBudget] = useState(project.budget ? String(project.budget) : "");
  const [currency, setCurrency] = useState(project.currency || "USD");
  const [startDate, setStartDate] = useState(project.startDate ? new Date(project.startDate).toISOString().split("T")[0] : "");
  const [endDate, setEndDate] = useState(project.endDate ? new Date(project.endDate).toISOString().split("T")[0] : "");

  const mutation = useMutation({
    mutationFn: async (d: any) => (await apiRequest("PUT", `/api/projects/${project.id}`, d)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Project updated" });
      onClose();
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Edit Project</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Project Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} className="mt-1" data-testid="input-project-name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="mt-1 h-8 text-sm" data-testid="select-project-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="planning">Planning</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Phase</Label>
              <Input value={phase} onChange={e => setPhase(e.target.value)} className="mt-1 h-8 text-sm" data-testid="input-project-phase" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="mt-1 text-sm resize-none" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Budget</Label>
              <Input value={budget} onChange={e => setBudget(e.target.value)} type="number" className="mt-1 h-8 text-sm" data-testid="input-project-budget" />
            </div>
            <div>
              <Label className="text-xs">Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="CAD">CAD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Start Date</Label>
              <Input value={startDate} onChange={e => setStartDate(e.target.value)} type="date" className="mt-1 h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">End Date</Label>
              <Input value={endDate} onChange={e => setEndDate(e.target.value)} type="date" className="mt-1 h-8 text-sm" />
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => mutation.mutate({ name: name.trim(), status, phase: phase || undefined, description: description || undefined, budget: budget ? Number(budget) : undefined, currency, startDate: startDate || undefined, endDate: endDate || undefined })} disabled={!name.trim() || mutation.isPending} data-testid="button-save-project">
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Project Detail Dialog ──────────────────────────────────────────────────────
function ProjectDetailDialog({ project, onClose, onDelete }: { project: Project; onClose: () => void; onDelete: () => void }) {
  const [editOpen, setEditOpen] = useState(false);
  const [tab, setTab] = useState(project.type === "certification" ? "certification" : "overview");
  const typeConfig = getTypeConfig(project.type);
  const Icon = typeConfig.icon;
  const isCert = project.type === "certification";

  const { data: cert } = useQuery<CertRecord | null>({
    queryKey: ["/api/projects", project.id, "certification"],
    queryFn: () => fetch(`/api/projects/${project.id}/certification`, { credentials: "include" }).then(r => r.json()),
    enabled: isCert,
  });

  const health = isCert ? calcCertHealth(cert) : null;

  return (
    <>
      <Dialog open onOpenChange={onClose}>
        <DialogContent className={`${isCert ? "max-w-3xl" : "max-w-xl"} max-h-[90vh] flex flex-col p-0 gap-0`}>

          {/* ── Header strip ─────────────────────────────────────────────── */}
          <div className="px-6 pt-5 pb-3 border-b border-border/50 shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className={`w-10 h-10 rounded-xl ${typeConfig.bg} ${typeConfig.border} border flex items-center justify-center shrink-0 mt-0.5`}>
                  <Icon className={`h-5 w-5 ${typeConfig.color}`} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-bold leading-tight truncate" data-testid="detail-project-name">{project.name}</h2>
                  <div className="flex items-center flex-wrap gap-1.5 mt-1">
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${typeConfig.bg} ${typeConfig.color} ${typeConfig.border}`}>{typeConfig.label}</span>
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${STATUS_COLORS[project.status] || ""}`}>{project.status}</Badge>
                    {isCert && health && (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${health.color} ${health.border} ${health.bg}`} data-testid="detail-cert-health">
                        {health.label}
                      </span>
                    )}
                    {isCert && project.certification_status && (
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${CERT_STATUS_COLORS[project.certification_status] ?? ""}`} data-testid="detail-badge-cert-status">
                        {project.certification_status}
                      </Badge>
                    )}
                    {isCert && project.launch_blocker && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-red-400 border-red-500/30 bg-red-500/10 gap-0.5" data-testid="detail-badge-launch-blocker">
                        <AlertTriangle className="h-2.5 w-2.5" /> Blocker
                      </Badge>
                    )}
                    {isCert && project.overall_risk && project.overall_risk !== "Low" && (
                      <span className={`text-[10px] font-medium ${RISK_COLORS[project.overall_risk]?.text ?? ""}`} data-testid="detail-badge-risk">{project.overall_risk} Risk</span>
                    )}
                  </div>
                  {isCert && cert?.next_action && (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">{cert.next_action}</span>
                      {cert.next_action_due_date && (
                        <span className={`text-[10px] ${daysUntil(cert.next_action_due_date)! < 0 ? "text-red-400 font-medium" : daysUntil(cert.next_action_due_date)! <= 3 ? "text-yellow-400" : "text-muted-foreground"}`}>
                          · {fmtDate(cert.next_action_due_date)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setEditOpen(true)} data-testid="button-edit-project">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={onDelete} data-testid="button-delete-project">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>

          {/* ── Tabs ────────────────────────────────────────────────────── */}
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 min-h-0">
              <TabsList className="mx-6 mt-3 mb-0 shrink-0">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                {isCert && <TabsTrigger value="certification" data-testid="tab-certification">Certification</TabsTrigger>}
                {isCert && <TabsTrigger value="milestones" data-testid="tab-milestones">Milestones</TabsTrigger>}
                <TabsTrigger value="notes">Notes</TabsTrigger>
              </TabsList>

              <ScrollArea className="flex-1 min-h-0">
                <div className="px-6 py-4">

                  <TabsContent value="overview" className="mt-0 space-y-4">
                    {project.description && (
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{project.description}</p>
                    )}
                    {(project.budget || project.startDate || project.endDate || (isCert && project.cert_target_completion_date)) && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        {project.budget && (
                          <div>
                            <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wide mb-1">Budget</div>
                            <div className="flex items-center gap-1">
                              <DollarSign className="h-3.5 w-3.5 text-green-400" />
                              <span className="text-sm font-medium">{Number(project.budget).toLocaleString()} {project.currency}</span>
                            </div>
                          </div>
                        )}
                        {project.startDate && (
                          <div>
                            <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wide mb-1">Start</div>
                            <p className="text-sm">{fmtDate(project.startDate)}</p>
                          </div>
                        )}
                        {project.endDate && (
                          <div>
                            <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wide mb-1">End</div>
                            <p className="text-sm">{fmtDate(project.endDate)}</p>
                          </div>
                        )}
                        {isCert && project.cert_target_completion_date && (
                          <div>
                            <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wide mb-1">Target Completion</div>
                            <p className="text-sm" data-testid="detail-target-completion">{fmtDate(project.cert_target_completion_date)}</p>
                          </div>
                        )}
                      </div>
                    )}
                    {project.phase && (
                      <div>
                        <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wide mb-1">Phase</div>
                        <p className="text-sm">{project.phase}</p>
                      </div>
                    )}
                  </TabsContent>

                  {isCert && (
                    <TabsContent value="certification" className="mt-0">
                      <CertificationDetailPanel projectId={project.id} projectName={project.name} />
                    </TabsContent>
                  )}

                  {isCert && (
                    <TabsContent value="milestones" className="mt-0">
                      <MilestoneChecklist projectId={project.id} />
                    </TabsContent>
                  )}

                  <TabsContent value="notes" className="mt-0">
                    <NotesPanel linkedObjectType="project" linkedObjectId={project.id} />
                  </TabsContent>
                </div>
              </ScrollArea>
            </Tabs>
          </div>
        </DialogContent>
      </Dialog>

      {editOpen && <ProjectEditDialog project={project} onClose={() => setEditOpen(false)} />}
    </>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function ProjectsPage() {
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Project | null>(null);
  const { toast } = useToast();

  const { data: projectsData, isLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects", { type: typeFilter, status: statusFilter }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      return fetch(`/api/projects?${params}`, { credentials: "include" }).then(r => r.json());
    },
  });

  const allProjects = projectsData || [];

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/projects/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Project deleted" });
      setSelected(null);
    },
  });

  const typeCounts = useMemo(() => PROJECT_TYPES.reduce((acc, t) => {
    acc[t.key] = allProjects.filter(p => p.type === t.key).length;
    return acc;
  }, {} as Record<string, number>), [allProjects]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-5 border-b border-border/50">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Projects</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Coordinated workstreams and internal initiatives · {allProjects.length} total</p>
          </div>
          <Button className="bg-primary text-primary-foreground shrink-0" onClick={() => setCreateOpen(true)} data-testid="button-create-project">
            <Plus className="h-4 w-4 mr-2" /> New Project
          </Button>
        </div>
      </div>

      <div className="px-6 py-4 border-b border-border/30">
        <div className="flex flex-wrap gap-1.5 mb-3">
          <button onClick={() => setTypeFilter("all")} className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${typeFilter === "all" ? "bg-primary/20 text-primary border-primary/30" : "border-border/50 text-muted-foreground hover:border-border"}`} data-testid="filter-type-all">
            All Types ({allProjects.length})
          </button>
          {PROJECT_TYPES.map(t => (
            <button key={t.key} onClick={() => setTypeFilter(t.key === typeFilter ? "all" : t.key)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${typeFilter === t.key ? `${t.bg} ${t.color} ${t.border}` : "border-border/50 text-muted-foreground hover:border-border"}`}
              data-testid={`filter-type-${t.key}`}>
              {t.label} {typeCounts[t.key] > 0 && `(${typeCounts[t.key]})`}
            </button>
          ))}
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-40 text-xs" data-testid="select-status-filter"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="planning">Planning</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-36" />)}
          </div>
        ) : allProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Layers className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-medium text-muted-foreground mb-2">No projects yet</h3>
            <p className="text-sm text-muted-foreground/70 mb-4">Create your first project to track pilots, grants, certifications and more</p>
            <Button onClick={() => setCreateOpen(true)} data-testid="button-empty-create"><Plus className="h-4 w-4 mr-2" /> New Project</Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {allProjects.map(project => (
              <ProjectCard key={project.id} project={project} onClick={() => setSelected(project)} />
            ))}
          </div>
        )}
      </div>

      {createOpen && <ProjectQuickCreateDialog onClose={() => setCreateOpen(false)} />}

      {selected && (
        <ProjectDetailDialog
          project={selected}
          onClose={() => setSelected(null)}
          onDelete={() => deleteMutation.mutate(selected.id)}
        />
      )}
    </div>
  );
}
