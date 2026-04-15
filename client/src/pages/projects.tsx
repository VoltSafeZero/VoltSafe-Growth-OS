import { useState } from "react";
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
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
type Project = {
  id: number; name: string; type: string; status: string; phase?: string;
  description?: string; accountId?: number; ownerUserId?: number;
  budget?: number; currency?: string; startDate?: string; endDate?: string;
  // Joined cert fields
  certification_status?: string; overall_risk?: string; launch_blocker?: boolean;
  cert_target_completion_date?: string; certification_program?: string; product_name?: string;
  next_action_due_date?: string;
};

type CertRecord = Record<string, any>;
type Milestone = { id: number; project_id: number; title: string; status: string; sort_order: number; due_date?: string; completed_at?: string; notes?: string; };

// ── Constants ─────────────────────────────────────────────────────────────────
const PROJECT_TYPES = [
  { key: "pilot", label: "Pilot", icon: Anchor, color: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/20" },
  { key: "lighthouse", label: "Lighthouse", icon: Star, color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/20" },
  { key: "partnership", label: "Partnership", icon: Handshake, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" },
  { key: "grant", label: "Grant", icon: Landmark, color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/20" },
  { key: "research", label: "Research", icon: FlaskConical, color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20" },
  { key: "event", label: "Event", icon: CalendarDays, color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20" },
  { key: "marketing", label: "Marketing / Content", icon: Megaphone, color: "text-pink-400", bg: "bg-pink-500/10", border: "border-pink-500/20" },
  { key: "internal", label: "Internal Initiative", icon: Layers, color: "text-slate-400", bg: "bg-slate-500/10", border: "border-slate-500/20" },
  { key: "certification", label: "Safety Certification", icon: ShieldCheck, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20" },
];

const CERT_PROGRAMS = ["CSA", "UL", "ETL", "FCC", "CE", "ABYC", "IEC", "Other"];

const CERT_STATUS_OPTIONS = [
  "Planning", "Document Prep", "Sample Build", "Submitted", "In Testing",
  "Failure Review", "Corrective Action", "Retest", "Passed", "Certified", "Blocked", "Cancelled",
];

const CERT_STATUS_COLORS: Record<string, string> = {
  "Planning": "text-slate-400 border-slate-500/30",
  "Document Prep": "text-blue-400 border-blue-500/30",
  "Sample Build": "text-indigo-400 border-indigo-500/30",
  "Submitted": "text-cyan-400 border-cyan-500/30",
  "In Testing": "text-yellow-400 border-yellow-500/30",
  "Failure Review": "text-orange-400 border-orange-500/30",
  "Corrective Action": "text-orange-400 border-orange-500/30",
  "Retest": "text-amber-400 border-amber-500/30",
  "Passed": "text-emerald-400 border-emerald-500/30",
  "Certified": "text-emerald-400 border-emerald-500/30",
  "Blocked": "text-red-400 border-red-500/30",
  "Cancelled": "text-muted-foreground border-border/40",
};

const RISK_COLORS: Record<string, string> = {
  Low: "text-emerald-400", Medium: "text-yellow-400", High: "text-orange-400", Critical: "text-red-400",
};

const STATUS_COLORS: Record<string, string> = {
  planning: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  active: "bg-green-500/10 text-green-400 border-green-500/20",
  paused: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  completed: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  cancelled: "bg-red-500/10 text-red-400 border-red-500/20",
};

function getTypeConfig(type: string) {
  return PROJECT_TYPES.find(t => t.key === type) || PROJECT_TYPES[PROJECT_TYPES.length - 2];
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

// ── Milestone Checklist ───────────────────────────────────────────────────────
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
  if (!milestones.length) return <div className="text-xs text-muted-foreground text-center py-4">No milestones yet.</div>;

  const doneCount = milestones.filter(m => m.status === "done").length;
  const pct = Math.round((doneCount / milestones.length) * 100);

  return (
    <div className="space-y-2">
      {/* Progress bar */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">{doneCount}/{milestones.length}</span>
      </div>

      {milestones.map(m => {
        const isDone = m.status === "done";
        const isSkipped = m.status === "skipped";
        return (
          <div key={m.id} className={`flex items-center gap-2.5 p-2 rounded-md border transition-colors ${isDone ? "border-emerald-500/20 bg-emerald-500/5" : isSkipped ? "border-border/20 opacity-50" : "border-border/40 hover:border-border"}`}
            data-testid={`milestone-${m.id}`}>
            <button
              onClick={() => updateMilestone.mutate({ mid: m.id, status: isDone ? "pending" : "done" })}
              className="flex-shrink-0"
              data-testid={`milestone-toggle-${m.id}`}
            >
              {isDone
                ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                : m.status === "in_progress"
                ? <Clock className="h-4 w-4 text-amber-400" />
                : <Circle className="h-4 w-4 text-muted-foreground/40" />}
            </button>
            <span className={`text-xs flex-1 ${isDone ? "line-through text-muted-foreground" : ""}`}>{m.title}</span>
            {m.due_date && !isDone && (
              <span className="text-[10px] text-muted-foreground">{fmtDate(m.due_date)}</span>
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

// ── Certification Detail Form ─────────────────────────────────────────────────
function CertificationDetailPanel({ projectId }: { projectId: number }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [changes, setChanges] = useState<Record<string, any>>({});
  const [selectedPrograms, setSelectedPrograms] = useState<string[]>([]);

  const { data: cert, isLoading, refetch } = useQuery<CertRecord | null>({
    queryKey: ["/api/projects", projectId, "certification"],
    queryFn: () => fetch(`/api/projects/${projectId}/certification`, { credentials: "include" }).then(r => r.json()),
    onSuccess: (d) => {
      if (d?.certification_program) {
        try { setSelectedPrograms(JSON.parse(d.certification_program)); } catch { setSelectedPrograms([]); }
      }
    },
  });

  const saveMutation = useMutation({
    mutationFn: (body: any) => apiRequest("POST", `/api/projects/${projectId}/certification`, body).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Certification details saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "certification"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setEditing(false);
      setChanges({});
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const createAlerts = useMutation({
    mutationFn: () => apiRequest("POST", `/api/projects/${projectId}/create-alerts`, {}),
    onSuccess: (d: any) => toast({ title: "Alerts created", description: `${d.tasksCreated} new task(s) created` }),
    onError: () => toast({ title: "Failed to create alerts", variant: "destructive" }),
  });

  if (isLoading) return <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-8" />)}</div>;

  const v = (key: string, fallback: any = "") => (editing && key in changes ? changes[key] : cert?.[key] ?? fallback);
  const set = (key: string, val: any) => setChanges(prev => ({ ...prev, [key]: val }));

  const handleSave = () => {
    const body = { ...changes, certificationProgram: JSON.stringify(selectedPrograms) };
    saveMutation.mutate(body);
  };

  const toggleProgram = (p: string) => {
    setSelectedPrograms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
    if (!editing) setEditing(true);
  };

  const Field = ({ label, fkey, type = "text", opts }: { label: string; fkey: string; type?: string; opts?: string[] }) => (
    <div className="space-y-1">
      <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">{label}</div>
      {editing && type !== "select" ? (
        <Input type={type} className="h-7 text-xs" defaultValue={v(fkey)} onChange={e => set(fkey, e.target.value || null)} />
      ) : editing && type === "select" && opts ? (
        <Select value={v(fkey, opts[0])} onValueChange={val => set(fkey, val)}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{opts.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
        </Select>
      ) : (
        <div className="text-sm">{v(fkey) || <span className="text-muted-foreground/30 italic">—</span>}</div>
      )}
    </div>
  );

  const BoolField = ({ label, fkey, testId }: { label: string; fkey: string; testId?: string }) => {
    const val = editing && fkey in changes ? changes[fkey] : cert?.[fkey] ?? false;
    return (
      <div className="flex items-center gap-2 cursor-pointer" onClick={() => { if (editing) set(fkey, !val); else { setEditing(true); set(fkey, !val); } }} data-testid={testId}>
        <div className={`h-4 w-4 rounded border flex items-center justify-center transition-colors ${val ? "bg-primary border-primary" : "border-border"}`}>
          {val && <CheckCircle2 className="h-3 w-3 text-primary-foreground" />}
        </div>
        <span className="text-xs">{label}</span>
      </div>
    );
  };

  const currentPrograms = editing ? selectedPrograms : (() => { try { return JSON.parse(cert?.certification_program ?? "[]"); } catch { return []; } })();

  return (
    <div className="space-y-5">
      {/* Action bar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5">
          {cert?.launch_blocker && (
            <Badge variant="outline" className="text-xs text-red-400 border-red-500/40 bg-red-500/10 gap-1" data-testid="badge-launch-blocker">
              <AlertTriangle className="h-3 w-3" /> Launch Blocker
            </Badge>
          )}
          {cert?.certification_status && (
            <Badge variant="outline" className={`text-xs ${CERT_STATUS_COLORS[cert.certification_status] ?? ""}`} data-testid="badge-cert-status">
              {cert.certification_status}
            </Badge>
          )}
          {cert?.overall_risk && cert.overall_risk !== "Low" && (
            <Badge variant="outline" className={`text-xs border-border/30 ${RISK_COLORS[cert.overall_risk]}`} data-testid="badge-overall-risk">
              Risk: {cert.overall_risk}
            </Badge>
          )}
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => createAlerts.mutate()} disabled={createAlerts.isPending} data-testid="btn-create-alerts">
            {createAlerts.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            Create Alerts
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

      {/* Certification Program multi-select */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Certification Program(s)</div>
        <div className="flex flex-wrap gap-1.5">
          {CERT_PROGRAMS.map(p => {
            const active = currentPrograms.includes(p);
            return (
              <button key={p}
                className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${active ? "bg-primary/20 text-primary border-primary/40" : "border-border/50 text-muted-foreground hover:border-border"}`}
                onClick={() => toggleProgram(p)}
                data-testid={`cert-program-${p}`}
              >{p}</button>
            );
          })}
        </div>
      </div>

      <Separator />

      {/* Core Info */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Core Info</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Product Name" fkey="product_name" />
          <Field label="Product Version" fkey="product_version" />
          <Field label="Revision" fkey="product_revision" />
          <Field label="SKU / Internal Code" fkey="sku_or_internal_code" />
          <Field label="Priority" fkey="certification_priority" type="select" opts={["Critical","High","Medium","Low"]} />
          <Field label="Target Market" fkey="target_market" type="select" opts={["Canada","USA","Europe","Global","Other"]} />
        </div>
        <Field label="Certification Scope" fkey="certification_scope" />
        <Field label="Standard Codes (e.g. CSA C22.2 No. 107)" fkey="certification_standard_codes" />
      </div>

      <Separator />

      {/* Status */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status Tracking</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Certification Status" fkey="certification_status" type="select" opts={CERT_STATUS_OPTIONS} />
          <Field label="Overall Risk" fkey="overall_risk" type="select" opts={["Low","Medium","High","Critical"]} />
          <Field label="Next Action" fkey="next_action" />
          <Field label="Next Action Due Date" fkey="next_action_due_date" type="date" />
          <Field label="Budget Status" fkey="budget_status" type="select" opts={["On Budget","At Risk","Over Budget"]} />
        </div>
        <div className="flex gap-4">
          <BoolField label="Launch Blocker" fkey="launch_blocker" testId="toggle-launch-blocker" />
          <BoolField label="Failure Found" fkey="failure_found" testId="toggle-failure-found" />
          <BoolField label="Corrective Action Required" fkey="corrective_action_required" />
          <BoolField label="Retest Required" fkey="retest_required" testId="toggle-retest-required" />
        </div>
        {(v("launch_blocker") || v("blocker_summary")) && (
          <Field label="Blocker Summary" fkey="blocker_summary" />
        )}
        {(v("failure_found") || v("failure_summary")) && (
          <Field label="Failure Summary" fkey="failure_summary" />
        )}
        {(v("corrective_action_required") || v("corrective_action_summary")) && (
          <Field label="Corrective Action Summary" fkey="corrective_action_summary" />
        )}
      </div>

      <Separator />

      {/* Lab Info */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Regulatory / Lab</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Testing Lab" fkey="testing_lab_name" />
          <Field label="Lab Contact" fkey="lab_contact_name" />
          <Field label="Lab Email" fkey="lab_contact_email" type="email" />
          <Field label="Lab Phone" fkey="lab_contact_phone" />
        </div>
      </div>

      <Separator />

      {/* Key Dates */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Key Dates</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Application Submitted" fkey="application_submission_date" type="date" />
          <Field label="Planned Test Start" fkey="planned_test_start_date" type="date" />
          <Field label="Actual Test Start" fkey="actual_test_start_date" type="date" />
          <Field label="Target Completion" fkey="target_completion_date" type="date" />
          <Field label="Actual Completion" fkey="actual_completion_date" type="date" />
          <Field label="Retest Date" fkey="retest_date" type="date" />
          <Field label="Pass Date" fkey="pass_date" type="date" />
          <Field label="Certificate Issued" fkey="certificate_issue_date" type="date" />
          <Field label="Certificate Expiry" fkey="certificate_expiry_date" type="date" />
        </div>
      </div>

      <Separator />

      {/* Samples */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sample / Unit Tracking</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Units Required" fkey="sample_units_required" type="number" />
          <Field label="Units Built" fkey="sample_units_built" type="number" />
          <Field label="Units Shipped" fkey="sample_units_shipped" type="number" />
          <Field label="Received by Lab" fkey="sample_units_received_by_lab" type="number" />
        </div>
        <Field label="Serial Numbers" fkey="sample_serial_numbers" />
        <Field label="Sample Notes" fkey="sample_notes" />
      </div>

      <Separator />

      {/* Commercial */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Commercial</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Engineering Owner" fkey="engineering_owner" />
          <Field label="Operations Owner" fkey="operations_owner" />
          <Field label="Linked Supplier" fkey="linked_supplier" />
          <Field label="Production Batch" fkey="linked_production_batch" />
          <Field label="Estimated Cost ($)" fkey="estimated_certification_cost" type="number" />
          <Field label="Actual Cost ($)" fkey="actual_certification_cost" type="number" />
        </div>
      </div>

      <Separator />

      {/* Documentation */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Documentation</div>
        {[
          { label: "Certification Doc", key: "certification_doc_link" },
          { label: "Test Report", key: "test_report_link" },
          { label: "Shared Drive Folder", key: "shared_drive_folder_link" },
          { label: "Certificate File", key: "certificate_file" },
        ].map(({ label, key }) => (
          <div key={key} className="space-y-0.5">
            <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">{label}</div>
            {editing ? (
              <Input className="h-7 text-xs" defaultValue={v(key)} onChange={e => set(key, e.target.value || null)} placeholder="https://..." />
            ) : v(key) ? (
              <a href={v(key)} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                <ExternalLink className="h-3 w-3" /> {v(key)}
              </a>
            ) : (
              <span className="text-muted-foreground/30 italic text-sm">—</span>
            )}
          </div>
        ))}
        {editing ? (
          <div className="space-y-0.5">
            <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">Compliance Notes</div>
            <textarea className="w-full rounded-md border border-border bg-muted/20 text-xs p-2 h-16 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              defaultValue={v("compliance_notes")} onChange={e => set("compliance_notes", e.target.value || null)} />
          </div>
        ) : v("compliance_notes") ? (
          <div>
            <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wide mb-0.5">Compliance Notes</div>
            <p className="text-xs text-muted-foreground whitespace-pre-wrap">{v("compliance_notes")}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Project Card ──────────────────────────────────────────────────────────────
function ProjectCard({ project, onClick }: { project: Project; onClick: () => void }) {
  const typeConfig = getTypeConfig(project.type);
  const Icon = typeConfig.icon;
  const isCert = project.type === "certification";

  return (
    <Card
      className="border-border/50 hover:border-border cursor-pointer transition-all hover:shadow-md group"
      onClick={onClick}
      data-testid={`card-project-${project.id}`}
    >
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
            <Badge variant="outline" className={`text-[11px] px-1.5 py-0 ${STATUS_COLORS[project.status] || ""}`}>
              {project.status}
            </Badge>
          </div>
        </div>

        <h3 className="font-semibold text-sm leading-tight mb-1">{project.name}</h3>

        {/* Cert status strip */}
        {isCert && project.certification_status && (
          <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${CERT_STATUS_COLORS[project.certification_status] ?? ""}`} data-testid={`badge-cert-status-${project.id}`}>
              {project.certification_status}
            </Badge>
            {project.overall_risk && project.overall_risk !== "Low" && (
              <span className={`text-[10px] font-medium ${RISK_COLORS[project.overall_risk]}`} data-testid={`text-risk-${project.id}`}>
                {project.overall_risk} Risk
              </span>
            )}
            {project.product_name && (
              <span className="text-[10px] text-muted-foreground/60 truncate">{project.product_name}</span>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap mt-1">
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${typeConfig.bg} ${typeConfig.color} ${typeConfig.border}`}>
            {typeConfig.label}
          </span>
          {project.phase && <span className="text-[10px] text-muted-foreground">Phase: {project.phase}</span>}
        </div>

        {isCert && project.cert_target_completion_date && (
          <p className="text-[10px] text-muted-foreground mt-1.5" data-testid={`text-target-completion-${project.id}`}>
            Target: {fmtDate(project.cert_target_completion_date)}
          </p>
        )}
        {!isCert && (project.startDate || project.endDate) && (
          <p className="text-[10px] text-muted-foreground mt-2">
            {project.startDate ? new Date(project.startDate).getFullYear() : "?"} – {project.endDate ? new Date(project.endDate).getFullYear() : "ongoing"}
          </p>
        )}
        {project.budget && (
          <div className="flex items-center gap-1 mt-1.5">
            <DollarSign className="h-3 w-3 text-green-400" />
            <span className="text-xs text-green-400">{Number(project.budget).toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
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
      const res = await fetch(`/api/projects?${params}`, { credentials: "include" });
      return res.json();
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

  const typeCounts = PROJECT_TYPES.reduce((acc, t) => {
    acc[t.key] = allProjects.filter(p => p.type === t.key).length;
    return acc;
  }, {} as Record<string, number>);

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
          <button
            onClick={() => setTypeFilter("all")}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${typeFilter === "all" ? "bg-primary/20 text-primary border-primary/30" : "border-border/50 text-muted-foreground hover:border-border"}`}
            data-testid="filter-type-all"
          >
            All Types ({allProjects.length})
          </button>
          {PROJECT_TYPES.map(t => (
            <button
              key={t.key}
              onClick={() => setTypeFilter(t.key === typeFilter ? "all" : t.key)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${typeFilter === t.key ? `${t.bg} ${t.color} ${t.border}` : "border-border/50 text-muted-foreground hover:border-border"}`}
              data-testid={`filter-type-${t.key}`}
            >
              {t.label} {typeCounts[t.key] > 0 && `(${typeCounts[t.key]})`}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
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
            <Button onClick={() => setCreateOpen(true)} data-testid="button-empty-create">
              <Plus className="h-4 w-4 mr-2" /> New Project
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {allProjects.map(project => (
              <ProjectCard key={project.id} project={project} onClick={() => setSelected(project)} />
            ))}
          </div>
        )}
      </div>

      {createOpen && <ProjectFormDialog onClose={() => setCreateOpen(false)} />}

      {selected && (
        <ProjectDetailDialog
          project={selected}
          onClose={() => setSelected(null)}
          onDelete={() => deleteMutation.mutate(selected.id)}
          onRefresh={(updated) => setSelected(updated)}
        />
      )}
    </div>
  );
}

// ── Project Form Dialog ───────────────────────────────────────────────────────
function ProjectFormDialog({ project, onClose }: { project?: Project; onClose: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(project?.name || "");
  const [type, setType] = useState(project?.type || "pilot");
  const [status, setStatus] = useState(project?.status || "planning");
  const [phase, setPhase] = useState(project?.phase || "");
  const [description, setDescription] = useState(project?.description || "");
  const [budget, setBudget] = useState(project?.budget ? String(project.budget) : "");
  const [currency, setCurrency] = useState(project?.currency || "USD");
  const [startDate, setStartDate] = useState(project?.startDate ? new Date(project.startDate).toISOString().split("T")[0] : "");
  const [endDate, setEndDate] = useState(project?.endDate ? new Date(project.endDate).toISOString().split("T")[0] : "");

  const mutation = useMutation({
    mutationFn: async (d: Record<string, unknown>) => {
      if (project) {
        const res = await apiRequest("PUT", `/api/projects/${project.id}`, d);
        return res.json();
      }
      const res = await apiRequest("POST", "/api/projects", d);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: project ? "Project updated" : "Project created" });
      onClose();
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  const handleSubmit = () => {
    if (!name.trim()) return;
    mutation.mutate({
      name: name.trim(), type, status,
      phase: phase || undefined, description: description || undefined,
      budget: budget ? Number(budget) : undefined, currency,
      startDate: startDate || undefined, endDate: endDate || undefined,
    });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{project ? "Edit Project" : "New Project"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Project Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} className="mt-1" placeholder="e.g. RVYC Jericho Pilot" data-testid="input-project-name" />
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
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400 flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
              A default certification checklist (12 milestones) will be auto-created after saving.
            </div>
          )}

          <div>
            <Label className="text-xs">Phase</Label>
            <Input value={phase} onChange={e => setPhase(e.target.value)} className="mt-1 h-8 text-sm" placeholder="e.g. Data collection" data-testid="input-project-phase" />
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className="mt-1 text-sm" placeholder="What is this project about?" data-testid="input-project-description" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Budget</Label>
              <Input value={budget} onChange={e => setBudget(e.target.value)} type="number" className="mt-1 h-8 text-sm" placeholder="0" data-testid="input-project-budget" />
            </div>
            <div>
              <Label className="text-xs">Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="CAD">CAD</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Start Date</Label>
              <Input value={startDate} onChange={e => setStartDate(e.target.value)} type="date" className="mt-1 h-8 text-sm" data-testid="input-project-start" />
            </div>
            <div>
              <Label className="text-xs">End Date</Label>
              <Input value={endDate} onChange={e => setEndDate(e.target.value)} type="date" className="mt-1 h-8 text-sm" data-testid="input-project-end" />
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={!name.trim() || mutation.isPending} data-testid="button-save-project">
              {mutation.isPending ? "Saving..." : project ? "Update" : "Create Project"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Project Detail Dialog ─────────────────────────────────────────────────────
function ProjectDetailDialog({ project, onClose, onDelete, onRefresh }: {
  project: Project; onClose: () => void; onDelete: () => void; onRefresh: (p: Project) => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [tab, setTab] = useState(project.type === "certification" ? "certification" : "overview");
  const typeConfig = getTypeConfig(project.type);
  const Icon = typeConfig.icon;
  const isCert = project.type === "certification";

  const updateMutation = useMutation({
    mutationFn: async (d: Partial<Project>) => {
      const res = await apiRequest("PUT", `/api/projects/${project.id}`, d);
      return res.json();
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      onRefresh(updated);
    },
  });

  return (
    <>
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0">
          {/* Header */}
          <DialogHeader className="px-6 pt-5 pb-3 border-b border-border/50 shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl ${typeConfig.bg} ${typeConfig.border} border flex items-center justify-center shrink-0`}>
                  <Icon className={`h-5 w-5 ${typeConfig.color}`} />
                </div>
                <div>
                  <DialogTitle className="text-xl">{project.name}</DialogTitle>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <p className={`text-xs ${typeConfig.color}`}>{typeConfig.label}</p>
                    {isCert && project.launch_blocker && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-red-400 border-red-500/30 bg-red-500/10 gap-0.5" data-testid="detail-badge-launch-blocker">
                        <AlertTriangle className="h-2.5 w-2.5" /> Launch Blocker
                      </Badge>
                    )}
                    {isCert && project.certification_status && (
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${CERT_STATUS_COLORS[project.certification_status] ?? ""}`} data-testid="detail-badge-cert-status">
                        {project.certification_status}
                      </Badge>
                    )}
                  </div>
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
          </DialogHeader>

          <div className="flex-1 overflow-hidden flex flex-col">
            <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 min-h-0">
              <TabsList className="mx-6 mt-3 mb-0 shrink-0">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                {isCert && <TabsTrigger value="certification" data-testid="tab-certification">Certification</TabsTrigger>}
                {isCert && <TabsTrigger value="milestones" data-testid="tab-milestones">Milestones</TabsTrigger>}
                <TabsTrigger value="notes">Notes</TabsTrigger>
              </TabsList>

              <ScrollArea className="flex-1 min-h-0">
                <div className="px-6 py-4">

                  <TabsContent value="overview" className="space-y-4 mt-0">
                    <div className="flex gap-2 flex-wrap">
                      <Badge variant="outline" className={STATUS_COLORS[project.status] || ""}>{project.status}</Badge>
                      {project.phase && <Badge variant="outline" className="text-muted-foreground">{project.phase}</Badge>}
                      {isCert && project.overall_risk && project.overall_risk !== "Low" && (
                        <Badge variant="outline" className={`border-border/30 ${RISK_COLORS[project.overall_risk]}`} data-testid="detail-badge-risk">
                          {project.overall_risk} Risk
                        </Badge>
                      )}
                    </div>

                    {project.description && (
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{project.description}</p>
                    )}

                    <Separator />

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      {project.budget && (
                        <div>
                          <Label className="text-xs text-muted-foreground">Budget</Label>
                          <div className="flex items-center gap-1 mt-1">
                            <DollarSign className="h-3.5 w-3.5 text-green-400" />
                            <p className="text-sm font-medium">{Number(project.budget).toLocaleString()} {project.currency}</p>
                          </div>
                        </div>
                      )}
                      {project.startDate && (
                        <div>
                          <Label className="text-xs text-muted-foreground">Start</Label>
                          <p className="text-sm mt-1">{new Date(project.startDate).toLocaleDateString()}</p>
                        </div>
                      )}
                      {project.endDate && (
                        <div>
                          <Label className="text-xs text-muted-foreground">End</Label>
                          <p className="text-sm mt-1">{new Date(project.endDate).toLocaleDateString()}</p>
                        </div>
                      )}
                      {isCert && project.cert_target_completion_date && (
                        <div>
                          <Label className="text-xs text-muted-foreground">Target Completion</Label>
                          <p className="text-sm mt-1" data-testid="detail-target-completion">{fmtDate(project.cert_target_completion_date)}</p>
                        </div>
                      )}
                    </div>

                    <div className="mt-2">
                      <Label className="text-xs text-muted-foreground">Status</Label>
                      <Select value={project.status} onValueChange={(v) => updateMutation.mutate({ status: v })}>
                        <SelectTrigger className="mt-1 h-8 w-40 text-sm" data-testid="select-detail-status"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="planning">Planning</SelectItem>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="paused">Paused</SelectItem>
                          <SelectItem value="completed">Completed</SelectItem>
                          <SelectItem value="cancelled">Cancelled</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </TabsContent>

                  {isCert && (
                    <TabsContent value="certification" className="mt-0">
                      <CertificationDetailPanel projectId={project.id} />
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

      {editOpen && <ProjectFormDialog project={project} onClose={() => setEditOpen(false)} />}
    </>
  );
}
