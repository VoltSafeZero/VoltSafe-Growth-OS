import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { UniversalDrilldownSheet, type UniversalDrilldownConfig } from "@/components/shared/universal-drilldown-sheet";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { DatePicker } from "@/components/ui/date-picker";
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
import { Switch } from "@/components/ui/switch";
import { NotesPanel } from "@/components/notes-panel";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus, Layers, Anchor, Handshake, Landmark, FlaskConical,
  CalendarDays, Megaphone, Star, Pencil, Trash2, DollarSign,
  ShieldCheck, AlertTriangle, CheckCircle2, Circle, Clock,
  ChevronDown, ChevronRight, ExternalLink, Zap, Loader2,
  TrendingUp, XCircle, TriangleAlert, RefreshCw, FileText,
  FlaskRound, Users, BarChart3, Link2, Upload, Download, X,
  Activity, Paperclip, Settings, Table2, PlusCircle, Trash,
  Maximize2, Minimize2, UserPlus, Share2, Copy,
} from "lucide-react";

// ── Sharing / Membership Types ──────────────────────────────────────────────────
type ProjectMemberRow = { userId: number; role: string; name: string; email: string; avatarUrl?: string | null };
type OrgUser = { id: number; name: string; email: string };
const PROJECT_ROLE_LABELS: Record<string, string> = {
  owner: "Owner", co_owner: "Co-owner", editor: "Editor", contributor: "Contributor", viewer: "Viewer",
};
function initials(name: string) {
  return (name || "?").split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
}

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
type SheetTab = { name: string; gid: string };
type TrackerConfig = {
  defaultGid?: string;
  tabs: SheetTab[];
  columnMap?: { status?: string; result?: string; blocker?: string; retest?: string; dueDate?: string };
  alertHooks?: { failedTest?: boolean; blocker?: boolean; retestRequired?: boolean; certRisk?: boolean };
};
type SheetSyncResult = {
  source: string;
  gid: string;
  total: number;
  passed: number;
  failed: number;
  pending: number;
  inProgress: number;
  other: number;
  blockerCount: number;
  retestCount: number;
  dueSoonCount: number;
  lastUpdated: string | null;
  syncedAt: string;
  columnsFound: Record<string, string | null>;
  alertConditions: { failedTest: boolean; blocker: boolean; retestRequired: boolean; certRisk: boolean };
  error: string | null;
  message?: string;
};
type AlertConditionState = { triggered: boolean; at: string | null; count: number };
type AlertState = {
  lastEvalAt: string;
  conditions: Partial<Record<"failed_test" | "blocker" | "retest_required" | "cert_risk" | "due_soon", AlertConditionState>>;
};
type AlertType = "failed_test" | "blocker" | "retest_required" | "cert_risk" | "due_soon";
const ALERT_LABELS: Record<AlertType, string> = {
  failed_test:     "Failed Tests",
  blocker:         "Blockers",
  retest_required: "Retests Required",
  cert_risk:       "Certification Risk",
  due_soon:        "Due Soon",
};
const ALERT_SEVERITY: Record<AlertType, "high" | "medium"> = {
  failed_test:     "high",
  blocker:         "high",
  retest_required: "medium",
  cert_risk:       "high",
  due_soon:        "medium",
};
function getActiveAlertTypes(state: AlertState | null): AlertType[] {
  if (!state) return [];
  const cooldownMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  return (Object.entries(state.conditions) as [AlertType, AlertConditionState][])
    .filter(([, v]) => v.triggered && v.at && (now - new Date(v.at).getTime()) < cooldownMs)
    .map(([k]) => k);
}

// ── Sheet URL helpers ──────────────────────────────────────────────────────────
function extractSheetId(url: string): string | null {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}
function makeEmbedUrl(sheetId: string, gid?: string): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/htmlview${gid ? `?gid=${gid}` : ""}`;
}
function extractGidFromUrl(url: string): string {
  const m = url.match(/[?#&]gid=(\d+)/);
  return m ? m[1] : "0";
}

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

// ── Live Test Tracker: Config Dialog ─────────────────────────────────────────
function TrackerConfigDialog({
  projectId, initialConfig, initialUrl, open, onClose,
}: {
  projectId: number; initialConfig: TrackerConfig; initialUrl: string;
  open: boolean; onClose: (saved?: boolean) => void;
}) {
  const { toast } = useToast();
  const [url, setUrl] = useState(initialUrl);
  const [tabs, setTabs] = useState<SheetTab[]>(initialConfig.tabs?.length ? initialConfig.tabs : [{ name: "Sheet1", gid: "0" }]);
  const [defaultGid, setDefaultGid] = useState(initialConfig.defaultGid ?? "0");
  const [colMap, setColMap] = useState(initialConfig.columnMap ?? {});
  const [alerts, setAlerts] = useState(initialConfig.alertHooks ?? { failedTest: false, blocker: false, retestRequired: false, certRisk: false });

  const saveMut = useMutation({
    mutationFn: async () => {
      const config: TrackerConfig = {
        defaultGid,
        tabs,
        columnMap: colMap,
        alertHooks: alerts,
      };
      return apiRequest("POST", `/api/projects/${projectId}/certification`, {
        trackerSheetUrl: url.trim(),
        trackerSheetConfig: JSON.stringify(config),
        trackerSheetLastSynced: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "certification"] });
      toast({ title: "Tracker configured", description: "Sheet source saved." });
      onClose(true);
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const addTab = () => setTabs(t => [...t, { name: `Sheet${t.length + 1}`, gid: "" }]);
  const removeTab = (i: number) => setTabs(t => t.filter((_, idx) => idx !== i));
  const updateTab = (i: number, field: "name" | "gid", val: string) =>
    setTabs(t => t.map((tab, idx) => idx === i ? { ...tab, [field]: val } : tab));

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Table2 className="h-4 w-4 text-emerald-400" />
            Live Test Tracker — Sheet Source
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-1">
          {/* Sheet URL */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Google Sheets URL</Label>
            <Input
              data-testid="input-tracker-sheet-url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="text-xs font-mono"
            />
            <p className="text-[10px] text-muted-foreground">
              Share the sheet as "Anyone with the link can view" for the embed to load. Your existing NRTL sharing workflow is unaffected.
            </p>
          </div>

          <Separator />

          {/* Tab config */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">Worksheet Tabs</Label>
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={addTab} data-testid="button-add-tab">
                <PlusCircle className="h-3.5 w-3.5" /> Add Tab
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">Find the GID in the sheet URL after <code>#gid=</code> — e.g. <code>...#gid=1234567890</code></p>
            {tabs.map((tab, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  data-testid={`input-tab-name-${i}`}
                  value={tab.name}
                  onChange={e => updateTab(i, "name", e.target.value)}
                  placeholder="Tab name"
                  className="text-xs flex-1"
                />
                <Input
                  data-testid={`input-tab-gid-${i}`}
                  value={tab.gid}
                  onChange={e => updateTab(i, "gid", e.target.value)}
                  placeholder="GID (e.g. 0)"
                  className="text-xs w-32 font-mono"
                />
                <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => removeTab(i)} disabled={tabs.length === 1}>
                  <Trash className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            {tabs.length > 0 && (
              <div className="flex items-center gap-2 mt-1">
                <Label className="text-xs text-muted-foreground shrink-0">Default tab:</Label>
                <Select value={defaultGid} onValueChange={setDefaultGid}>
                  <SelectTrigger className="h-7 text-xs flex-1">
                    <SelectValue placeholder="Select default tab" />
                  </SelectTrigger>
                  <SelectContent>
                    {tabs.map((t, i) => (
                      <SelectItem key={i} value={t.gid || "0"}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <Separator />

          {/* Column mapping */}
          <div className="space-y-2">
            <Label className="text-xs font-medium">Column Mapping <span className="text-muted-foreground font-normal">(optional — for future data sync)</span></Label>
            <div className="grid grid-cols-2 gap-2">
              {(["status", "result", "blocker", "retest", "dueDate"] as const).map(field => (
                <div key={field} className="space-y-0.5">
                  <Label className="text-[10px] text-muted-foreground capitalize">{field === "dueDate" ? "Due Date" : field} column header</Label>
                  <Input
                    data-testid={`input-colmap-${field}`}
                    value={(colMap as any)[field] ?? ""}
                    onChange={e => setColMap(m => ({ ...m, [field]: e.target.value }))}
                    placeholder={field === "dueDate" ? "Due Date" : field.charAt(0).toUpperCase() + field.slice(1)}
                    className="text-xs h-7"
                  />
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Alert hooks */}
          <div className="space-y-2">
            <Label className="text-xs font-medium">Alert Hooks <span className="text-muted-foreground font-normal">(future — structure ready)</span></Label>
            <div className="grid grid-cols-2 gap-y-2 gap-x-4">
              {([
                ["failedTest", "Failed test found"],
                ["blocker", "Blocker found"],
                ["retestRequired", "Retest required"],
                ["certRisk", "Certification risk rising"],
              ] as const).map(([key, label]) => (
                <div key={key} className="flex items-center gap-2">
                  <Switch
                    data-testid={`switch-alert-${key}`}
                    checked={!!(alerts as any)[key]}
                    onCheckedChange={v => setAlerts(a => ({ ...a, [key]: v }))}
                    className="scale-75 origin-left"
                  />
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">These settings are stored now and will activate when sheet sync is enabled.</p>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => onClose()}>Cancel</Button>
            <Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending} data-testid="button-save-tracker-config">
              {saveMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Save Configuration
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Live Test Tracker: Certification Summary Panel ────────────────────────────
function LiveTrackerCertSummary({
  cert, milestones, sheetSync, syncLoading, onSync, alertState,
}: {
  cert: CertRecord | null | undefined;
  milestones: Milestone[];
  sheetSync?: SheetSyncResult | null;
  syncLoading?: boolean;
  onSync?: () => void;
  alertState?: AlertState | null;
}) {
  if (!cert) return <div className="w-64 shrink-0 text-xs text-muted-foreground text-center pt-8">No certification data yet.</div>;

  const health = calcCertHealth(cert);
  const mTotal = milestones.length;
  const mDone = milestones.filter(m => m.status === "done").length;
  const mInProg = milestones.filter(m => m.status === "in_progress").length;
  const mPending = milestones.filter(m => m.status === "pending").length;

  const statRow = (label: string, val: string | number | boolean | null | undefined, color?: string) => (
    <div className="flex items-center justify-between py-1 border-b border-border/20 last:border-0">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className={`text-xs font-medium ${color ?? ""}`}>{val === null || val === undefined ? "—" : String(val)}</span>
    </div>
  );

  const lastUpdate = cert.last_status_update
    ? new Date(cert.last_status_update).toLocaleDateString("en-CA", { month: "short", day: "numeric" })
    : null;

  const syncedAt = sheetSync?.syncedAt
    ? new Date(sheetSync.syncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  const hasRealSync = sheetSync && !sheetSync.error && sheetSync.total >= 0;
  const syncError = sheetSync?.error;
  const ac = sheetSync?.alertConditions;

  const activeAlerts = getActiveAlertTypes(alertState ?? null);
  const hasHighAlert = activeAlerts.some(a => ALERT_SEVERITY[a] === "high");

  return (
    <div className="w-64 shrink-0 space-y-3" data-testid="panel-cert-summary">
      {/* Persistent alert banner (from stored alert state) */}
      {activeAlerts.length > 0 && (
        <div
          className={`rounded-lg border px-3 py-2 space-y-1 ${hasHighAlert ? "border-red-500/40 bg-red-500/10" : "border-amber-500/30 bg-amber-500/10"}`}
          data-testid="panel-active-alerts-banner"
        >
          <div className={`text-[10px] font-semibold uppercase tracking-wide flex items-center gap-1 ${hasHighAlert ? "text-red-400" : "text-amber-400"}`}>
            <TriangleAlert className="h-3 w-3" />
            {activeAlerts.length} Active Alert{activeAlerts.length !== 1 ? "s" : ""}
          </div>
          {activeAlerts.map(a => (
            <div key={a} className={`text-[10px] flex items-center gap-1 ${ALERT_SEVERITY[a] === "high" ? "text-red-300/90" : "text-amber-300/90"}`}>
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${ALERT_SEVERITY[a] === "high" ? "bg-red-400" : "bg-amber-400"}`} />
              {ALERT_LABELS[a]}
            </div>
          ))}
        </div>
      )}

      {/* Health badge */}
      <div className={`rounded-lg border px-3 py-2.5 flex items-center gap-2 ${health.bg} ${health.border}`}>
        <ShieldCheck className={`h-4 w-4 ${health.color}`} />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-muted-foreground">Certification Health</div>
          <div className={`text-sm font-semibold ${health.color}`}>{health.label}</div>
        </div>
        {onSync && (
          <button
            onClick={onSync}
            disabled={syncLoading}
            title="Sync from Google Sheets"
            data-testid="button-sync-sheet"
            className="p-1 rounded hover:bg-white/10 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-muted-foreground ${syncLoading ? "animate-spin" : ""}`} />
          </button>
        )}
      </div>

      {/* Sync timestamp / error */}
      {syncedAt && !syncError && (
        <p className="text-[10px] text-muted-foreground/60 text-center -mt-1">
          Sheet synced {syncedAt}
        </p>
      )}
      {syncError === "permission_denied" && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-400" data-testid="sync-error-permission">
          <AlertTriangle className="h-3 w-3 inline mr-1" />
          {sheetSync?.message ?? "Sheet is private — share as 'Anyone with the link can view' to enable sync."}
        </div>
      )}
      {syncError && syncError !== "permission_denied" && syncError !== "not_configured" && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[10px] text-red-400" data-testid="sync-error-other">
          <AlertTriangle className="h-3 w-3 inline mr-1" />
          {sheetSync?.message ?? "Could not read sheet data."}
        </div>
      )}

      {/* Live Test Counts (from sheet sync) */}
      {hasRealSync ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-0" data-testid="panel-sheet-counts">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-medium text-emerald-400 uppercase tracking-wide">Live Test Counts</div>
            <Badge variant="outline" className="text-[9px] h-4 px-1 border-emerald-500/40 text-emerald-400">Sheet</Badge>
          </div>
          {statRow("Total Tests", sheetSync!.total)}
          {statRow("Passed", sheetSync!.passed, sheetSync!.passed > 0 ? "text-emerald-400" : undefined)}
          {statRow("Failed", sheetSync!.failed, sheetSync!.failed > 0 ? "text-red-400" : undefined)}
          {statRow("In Progress", sheetSync!.inProgress, sheetSync!.inProgress > 0 ? "text-blue-400" : undefined)}
          {statRow("Pending", sheetSync!.pending, "text-muted-foreground")}
          {sheetSync!.blockerCount > 0 && statRow("Blockers", sheetSync!.blockerCount, "text-red-400")}
          {sheetSync!.retestCount > 0 && statRow("Retest Required", sheetSync!.retestCount, "text-amber-400")}
          {sheetSync!.dueSoonCount > 0 && statRow("Due ≤7 Days", sheetSync!.dueSoonCount, "text-yellow-400")}
          {sheetSync!.lastUpdated && statRow("Latest Date", sheetSync!.lastUpdated)}
        </div>
      ) : (
        !syncError && (
          <div className="rounded-lg border border-dashed border-border/30 bg-muted/10 p-3">
            <div className="text-[10px] text-muted-foreground/60 text-center">
              {onSync ? "Click ↻ to sync live counts from Google Sheets." : "Configure column mapping to enable live sync."}
            </div>
          </div>
        )
      )}

      {/* Alert conditions from sheet (Phase 5) */}
      {hasRealSync && (ac?.failedTest || ac?.blocker || ac?.retestRequired || ac?.certRisk) && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 space-y-1" data-testid="panel-alert-conditions">
          <div className="text-[10px] font-medium text-red-400 uppercase tracking-wide">Alert Conditions Found</div>
          {ac?.failedTest     && <div className="text-[10px] text-red-300/90 flex items-center gap-1"><XCircle className="h-3 w-3 shrink-0" /> Failed tests detected</div>}
          {ac?.blocker        && <div className="text-[10px] text-red-300/90 flex items-center gap-1"><XCircle className="h-3 w-3 shrink-0" /> Blockers in sheet</div>}
          {ac?.retestRequired && <div className="text-[10px] text-amber-300/90 flex items-center gap-1"><RefreshCw className="h-3 w-3 shrink-0" /> Retests required</div>}
          {ac?.certRisk       && <div className="text-[10px] text-orange-300/90 flex items-center gap-1"><AlertTriangle className="h-3 w-3 shrink-0" /> Certification risk rising</div>}
        </div>
      )}

      {/* Milestones */}
      <div className="rounded-lg border border-border/30 bg-card p-3 space-y-0">
        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Milestones</div>
        {statRow("Total", mTotal)}
        {statRow("Completed", mDone, "text-emerald-400")}
        {statRow("In Progress", mInProg, "text-blue-400")}
        {statRow("Pending", mPending, "text-muted-foreground")}
      </div>

      {/* Cert status */}
      <div className="rounded-lg border border-border/30 bg-card p-3 space-y-0">
        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Certification Status</div>
        {statRow("Status", cert.certification_status)}
        {statRow("Overall Risk", cert.overall_risk, cert.overall_risk === "Critical" || cert.overall_risk === "High" ? "text-red-400" : cert.overall_risk === "Medium" ? "text-yellow-400" : "text-emerald-400")}
        {statRow("Launch Blocker", cert.launch_blocker ? "YES" : "No", cert.launch_blocker ? "text-red-400" : "text-emerald-400")}
        {statRow("Failure Found", cert.failure_found ? "YES" : "No", cert.failure_found ? "text-red-400" : "text-emerald-400")}
        {statRow("Retest Required", cert.retest_required ? "YES" : "No", cert.retest_required ? "text-amber-400" : "text-emerald-400")}
        {lastUpdate && statRow("Last Update", lastUpdate)}
      </div>

      {/* Blocker note */}
      {cert.launch_blocker && cert.blocker_summary && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          <div className="font-medium mb-0.5">Blocker</div>
          <div className="text-red-300/80">{cert.blocker_summary}</div>
        </div>
      )}
    </div>
  );
}

// ── Live Test Tracker: Main Tab ───────────────────────────────────────────────
function LiveTestTrackerTab({ projectId, projectName }: { projectId: number; projectName: string }) {
  const [activeGid, setActiveGid] = useState<string>("");
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const [configOpen, setConfigOpen] = useState(false);
  const [sheetSync, setSheetSync] = useState<SheetSyncResult | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [alertState, setAlertState] = useState<AlertState | null>(null);
  const [sheetFullscreen, setSheetFullscreen] = useState(false);

  // Close fullscreen on Escape
  useEffect(() => {
    if (!sheetFullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSheetFullscreen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheetFullscreen]);

  const { data: cert, isLoading: certLoading, refetch: refetchCert } = useQuery<CertRecord>({
    queryKey: ["/api/projects", projectId, "certification"],
    queryFn: () => apiRequest("GET", `/api/projects/${projectId}/certification`).then(r => r.json()),
  });
  const { data: milestones = [] } = useQuery<Milestone[]>({
    queryKey: ["/api/projects", projectId, "milestones"],
    queryFn: () => apiRequest("GET", `/api/projects/${projectId}/milestones`).then(r => r.json()),
  });

  // Load stored alert state on mount
  const { data: alertStateData, refetch: refetchAlertState } = useQuery<{ alertState: AlertState | null; activeAlerts: AlertType[] }>({
    queryKey: ["/api/projects", projectId, "tracker-alerts", "state"],
    queryFn: () => apiRequest("GET", `/api/projects/${projectId}/tracker-alerts/state`).then(r => r.json()),
  });
  // Keep alertState in sync with server data (overridden by evaluate result after each sync)
  useMemo(() => {
    if (alertStateData?.alertState && !alertState) {
      setAlertState(alertStateData.alertState);
    }
  }, [alertStateData]);

  const trackerUrl = cert?.tracker_sheet_url ?? "";
  const config: TrackerConfig = useMemo(() => {
    try { return JSON.parse(cert?.tracker_sheet_config ?? "{}"); } catch { return { tabs: [] }; }
  }, [cert?.tracker_sheet_config]);

  const currentGid = activeGid || config.defaultGid || config.tabs?.[0]?.gid || "";
  const sheetId = useMemo(() => extractSheetId(trackerUrl), [trackerUrl]);
  const embedUrl = useMemo(() => sheetId ? makeEmbedUrl(sheetId, currentGid) : null, [sheetId, currentGid]);

  // Sync sheet data from server, then auto-evaluate alert conditions
  const handleSync = useCallback(async () => {
    if (!trackerUrl) return;
    setSyncLoading(true);
    try {
      const r = await apiRequest("GET", `/api/projects/${projectId}/tracker-sync${currentGid ? `?gid=${currentGid}` : ""}`);
      const data: SheetSyncResult = await r.json();
      setSheetSync(data);

      // Phase 2: evaluate alerts if sync succeeded and has column data
      if (!data.error && data.total >= 0) {
        try {
          const evalR = await apiRequest("POST", `/api/projects/${projectId}/tracker-alerts/evaluate`, data);
          const evalData = await evalR.json();
          if (evalData.newState) {
            setAlertState(evalData.newState);
            refetchAlertState();
          }
        } catch { /* alert eval failure is non-fatal */ }
      }
    } catch {
      setSheetSync({ error: "fetch_error", message: "Could not reach sync endpoint.", source: "", gid: currentGid, total: 0, passed: 0, failed: 0, pending: 0, inProgress: 0, other: 0, blockerCount: 0, retestCount: 0, dueSoonCount: 0, lastUpdated: null, syncedAt: new Date().toISOString(), columnsFound: {}, alertConditions: { failedTest: false, blocker: false, retestRequired: false, certRisk: false } });
    } finally {
      setSyncLoading(false);
    }
  }, [projectId, trackerUrl, currentGid]);

  const handleRefresh = useCallback(() => {
    setIframeKey(k => k + 1);
    setLastLoaded(new Date());
    handleSync();
  }, [handleSync]);

  if (certLoading) return <div className="flex items-center justify-center h-40"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-0" data-testid="tab-live-tracker">
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {(config.tabs?.length ?? 0) > 1 && (
          <Select value={currentGid} onValueChange={v => { setActiveGid(v); setIframeKey(k => k + 1); setSheetSync(null); }}>
            <SelectTrigger className="h-8 text-xs w-44" data-testid="select-sheet-tab">
              <SelectValue placeholder="Select tab" />
            </SelectTrigger>
            <SelectContent>
              {config.tabs.map((t, i) => (
                <SelectItem key={i} value={t.gid || "0"} data-testid={`option-tab-${i}`}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={handleRefresh} data-testid="button-tracker-refresh">
          <RefreshCw className={`h-3.5 w-3.5 ${syncLoading ? "animate-spin" : ""}`} /> Refresh
        </Button>
        {trackerUrl && (
          <>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={handleSync} disabled={syncLoading} data-testid="button-sync-counts">
              {syncLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BarChart3 className="h-3.5 w-3.5" />} Sync Counts
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => window.open(trackerUrl, "_blank")} data-testid="button-open-in-sheets">
              <ExternalLink className="h-3.5 w-3.5" /> Open in Sheets
            </Button>
          </>
        )}
        <Button size="sm" variant="ghost" className="h-8 text-xs gap-1.5" onClick={() => setConfigOpen(true)} data-testid="button-tracker-settings">
          <Settings className="h-3.5 w-3.5" /> {trackerUrl ? "Sheet Settings" : "Configure Sheet"}
        </Button>
        {lastLoaded && (
          <span className="text-[10px] text-muted-foreground ml-auto">
            Viewer loaded {lastLoaded.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>

      {/* Main layout: left = viewer, right = summary */}
      <div className="flex gap-4 min-h-0">
        {/* Sheet Viewer */}
        <div className="flex-1 flex flex-col min-w-0">
          {!trackerUrl ? (
            <div className="flex flex-col items-center justify-center h-64 rounded-lg border border-dashed border-border/40 bg-muted/10 gap-3">
              <Table2 className="h-8 w-8 text-muted-foreground/40" />
              <div className="text-center space-y-1">
                <p className="text-sm font-medium text-muted-foreground">No sheet configured</p>
                <p className="text-xs text-muted-foreground/60 max-w-xs">
                  Connect a Google Sheet to view the live certification test tracker without leaving this page.
                </p>
              </div>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setConfigOpen(true)} data-testid="button-setup-tracker">
                <Settings className="h-3.5 w-3.5" /> Configure Sheet Source
              </Button>
            </div>
          ) : !sheetId ? (
            <div className="flex flex-col items-center justify-center h-64 rounded-lg border border-dashed border-amber-500/30 bg-amber-500/5 gap-2">
              <AlertTriangle className="h-6 w-6 text-amber-400" />
              <p className="text-sm text-amber-400">Invalid Google Sheets URL</p>
              <Button size="sm" variant="ghost" onClick={() => setConfigOpen(true)}>Fix URL</Button>
            </div>
          ) : (
            <>
              {/* Inline viewer (normal mode) */}
              {!sheetFullscreen && (
                <div className="relative rounded-lg border border-border/30 overflow-hidden bg-white group" style={{ height: "460px" }}>
                  <iframe
                    key={iframeKey}
                    src={embedUrl!}
                    className="w-full h-full"
                    title={`${projectName} — Live Test Tracker`}
                    onLoad={() => setLastLoaded(new Date())}
                    allow="fullscreen"
                    data-testid="iframe-sheet-viewer"
                  />
                  {/* Expand button — top-right corner, appears on hover */}
                  <button
                    onClick={() => setSheetFullscreen(true)}
                    className="absolute top-2 right-2 z-10 flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/60 hover:bg-black/80 text-white text-[11px] font-medium opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Expand to full screen (Esc to exit)"
                    data-testid="button-sheet-fullscreen"
                  >
                    <Maximize2 className="h-3 w-3" />
                    Expand
                  </button>
                </div>
              )}

              {/* Fullscreen overlay */}
              {sheetFullscreen && (
                <div className="fixed inset-0 z-[70] bg-black/90 flex flex-col" data-testid="sheet-fullscreen-overlay">
                  {/* Overlay toolbar */}
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-background/95 backdrop-blur border-b border-border/40 flex-shrink-0">
                    <span className="text-sm font-medium truncate flex-1">{projectName} — Live Test Tracker</span>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={handleRefresh} data-testid="button-fullscreen-refresh">
                      <RefreshCw className={`h-3 w-3 ${syncLoading ? "animate-spin" : ""}`} /> Refresh
                    </Button>
                    {trackerUrl && (
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => window.open(trackerUrl, "_blank")} data-testid="button-fullscreen-open-sheets">
                        <ExternalLink className="h-3 w-3" /> Open in Sheets
                      </Button>
                    )}
                    <button
                      onClick={() => setSheetFullscreen(false)}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-muted hover:bg-muted/80 text-foreground transition-colors"
                      title="Exit fullscreen (Esc)"
                      data-testid="button-sheet-exit-fullscreen"
                    >
                      <Minimize2 className="h-3.5 w-3.5" /> Exit
                    </button>
                  </div>
                  {/* Full-height iframe */}
                  <div className="flex-1 min-h-0 bg-white">
                    <iframe
                      key={`fs-${iframeKey}`}
                      src={embedUrl!}
                      className="w-full h-full"
                      title={`${projectName} — Live Test Tracker (fullscreen)`}
                      allow="fullscreen"
                      data-testid="iframe-sheet-viewer-fullscreen"
                    />
                  </div>
                </div>
              )}
            </>
          )}
          <p className="text-[10px] text-muted-foreground/50 mt-1.5">
            For private sheets, share as "Anyone with the link can view". The NRTL shared editing workflow is unaffected.
          </p>
        </div>

        {/* Cert Summary Panel — passes live sheet sync data + stored alert state */}
        <LiveTrackerCertSummary
          cert={cert}
          milestones={milestones as Milestone[]}
          sheetSync={sheetSync}
          syncLoading={syncLoading}
          onSync={trackerUrl ? handleSync : undefined}
          alertState={alertState}
        />
      </div>

      {configOpen && (
        <TrackerConfigDialog
          projectId={projectId}
          initialConfig={config}
          initialUrl={trackerUrl}
          open={configOpen}
          onClose={(saved) => {
            setConfigOpen(false);
            if (saved) { refetchCert(); setIframeKey(k => k + 1); setSheetSync(null); }
          }}
        />
      )}
    </div>
  );
}

// ── Phase 1: Certification Summary Strip ──────────────────────────────────────
type CertSummary = {
  total: number; blocked: number; at_risk: number; on_track: number;
  retest_required: number; certified: number; cert_expiring_90d: number;
  failure_open: number; next_due_items: any[];
};

function CertSummaryStrip({ onCertFilter, onDrilldown }: { onCertFilter: (f: string) => void; onDrilldown: (metric: string) => void }) {
  const { data, isLoading } = useQuery<CertSummary>({
    queryKey: ["/api/projects/cert-summary"],
    queryFn: () => fetch("/api/projects/cert-summary", { credentials: "include" }).then(r => r.json()),
    refetchInterval: 60000,
  });

  if (isLoading || !data || data.total === 0) return null;

  const stats = [
    { label: "Total", value: data.total, color: "text-foreground", filter: "", metric: "active_projects" },
    { label: "On Track", value: data.on_track, color: "text-emerald-400", filter: "", metric: "active_projects" },
    { label: "At Risk", value: data.at_risk, color: "text-orange-400", filter: "", metric: "overdue_projects" },
    { label: "Blocked", value: data.blocked, color: "text-red-400", filter: "blocked", metric: "overdue_projects" },
    { label: "Retest", value: data.retest_required, color: "text-amber-400", filter: "retest", metric: "active_projects" },
    { label: "Certified", value: data.certified, color: "text-emerald-400", filter: "passed", metric: "completed_projects" },
    { label: "Expiring 90d", value: data.cert_expiring_90d, color: "text-yellow-400", filter: "cert_expiring", metric: "projects_due_this_week" },
  ];

  return (
    <div className="mx-6 mt-4 rounded-xl border border-red-500/20 bg-red-500/5 overflow-hidden" data-testid="cert-summary-strip">
      <div className="px-4 py-2 flex items-center gap-2 border-b border-red-500/10">
        <ShieldCheck className="h-3.5 w-3.5 text-red-400" />
        <span className="text-xs font-semibold text-red-400 uppercase tracking-wide">Certification Oversight</span>
      </div>
      <div className="px-4 py-3 flex items-start gap-6 flex-wrap">
        {stats.map(s => (
          <button key={s.label} className="flex flex-col items-center gap-0.5 min-w-[48px] cursor-pointer hover:opacity-80 transition-opacity" onClick={() => { if (s.filter) onCertFilter(s.filter); onDrilldown(s.metric); }} data-testid={`cert-stat-${s.label.toLowerCase().replace(/\s/g, "-")}`}>
            <span className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value}</span>
            <span className="text-[10px] text-muted-foreground">{s.label}</span>
          </button>
        ))}
        {data.next_due_items.length > 0 && (
          <div className="flex-1 min-w-[180px]">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Due soon</div>
            {data.next_due_items.slice(0, 3).map((item: any) => (
              <div key={item.id} className="text-xs flex items-center gap-1.5 mb-0.5">
                <Clock className="h-3 w-3 text-amber-400 shrink-0" />
                <span className="truncate">{item.name}</span>
                {item.next_action_due_date && (
                  <span className="text-muted-foreground/70 shrink-0">{fmtDate(item.next_action_due_date)}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Phase 3: Attachments Section ──────────────────────────────────────────────
function AttachmentsSection({ projectId }: { projectId: number }) {
  const { toast } = useToast();
  const [dragging, setDragging] = useState(false);
  const inputRef = useState<HTMLInputElement | null>(null);

  const { data: attachments = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ["/api/projects", projectId, "attachments"],
    queryFn: () => fetch(`/api/projects/${projectId}/attachments`, { credentials: "include" }).then(r => r.json()),
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/projects/${projectId}/attachments`, { method: "POST", body: fd, credentials: "include" });
      if (!r.ok) { const e = await r.json(); throw new Error(e.message); }
      return r.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "attachments"] }); toast({ title: "File uploaded" }); },
    onError: (e: any) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (aid: number) => apiRequest("DELETE", `/api/projects/${projectId}/attachments/${aid}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "attachments"] }); toast({ title: "Attachment deleted" }); },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) uploadMutation.mutate(f);
  };

  function fmtSize(bytes: number) {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / 1048576).toFixed(1)}MB`;
  }

  function fileIcon(mime: string) {
    if (mime?.includes("pdf")) return "📄";
    if (mime?.startsWith("image/")) return "🖼️";
    if (mime?.includes("spreadsheet") || mime?.includes("excel") || mime?.includes("csv")) return "📊";
    if (mime?.includes("word") || mime?.includes("document")) return "📝";
    if (mime?.includes("zip")) return "🗜️";
    return "📎";
  }

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        className={`rounded-lg border-2 border-dashed transition-colors flex flex-col items-center gap-2 py-6 px-4 cursor-pointer ${dragging ? "border-primary bg-primary/10" : "border-border/50 hover:border-border"}`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => document.getElementById(`cert-file-input-${projectId}`)?.click()}
        data-testid="attachment-dropzone"
      >
        <Upload className="h-6 w-6 text-muted-foreground/50" />
        <p className="text-xs text-muted-foreground text-center">Drop files here or click to upload</p>
        <p className="text-[10px] text-muted-foreground/50">PDF, images, Word, Excel, CSV — up to 50MB</p>
        {uploadMutation.isPending && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
      </div>
      <input id={`cert-file-input-${projectId}`} type="file" multiple className="hidden" accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.svg,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip" onChange={e => handleFiles(e.target.files)} data-testid="attachment-file-input" />

      {/* Attachment list */}
      {isLoading ? (
        <div className="space-y-1">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : attachments.length === 0 ? (
        <div className="text-xs text-muted-foreground text-center py-2">No attachments yet</div>
      ) : (
        <div className="space-y-1.5">
          {attachments.map((att: any) => (
            <div key={att.id} className="flex items-center gap-2.5 px-3 py-2 rounded-md border border-border/40 hover:border-border transition-colors" data-testid={`attachment-${att.id}`}>
              <span className="text-lg shrink-0">{fileIcon(att.mime_type)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{att.original_name}</p>
                <p className="text-[10px] text-muted-foreground">{fmtSize(att.file_size)} · {fmtDate(att.created_at)}</p>
              </div>
              <a href={`/api/projects/${projectId}/attachments/${att.id}/download`} target="_blank" rel="noreferrer"
                className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted transition-colors" data-testid={`btn-download-${att.id}`}>
                <Download className="h-3.5 w-3.5 text-muted-foreground" />
              </a>
              <button onClick={() => deleteMutation.mutate(att.id)} className="h-6 w-6 flex items-center justify-center rounded hover:bg-destructive/10 hover:text-destructive transition-colors" data-testid={`btn-delete-attachment-${att.id}`}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Phase 4: Timeline Panel ────────────────────────────────────────────────────
const TIMELINE_ICONS: Record<string, { icon: any; color: string }> = {
  status_change:     { icon: Activity,      color: "text-blue-400"    },
  launch_blocker_on: { icon: XCircle,       color: "text-red-400"     },
  launch_blocker_off:{ icon: CheckCircle2,  color: "text-emerald-400" },
  retest_required:   { icon: RefreshCw,     color: "text-amber-400"   },
  cert_issued:       { icon: ShieldCheck,   color: "text-emerald-400" },
  milestone_done:    { icon: CheckCircle2,  color: "text-emerald-400" },
  attachment_added:  { icon: Paperclip,     color: "text-blue-400"    },
  default:           { icon: Clock,         color: "text-muted-foreground" },
};

function TimelinePanel({ projectId }: { projectId: number }) {
  const { data: events = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/projects", projectId, "timeline"],
    queryFn: () => fetch(`/api/projects/${projectId}/timeline`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: 30000,
  });

  if (isLoading) return <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>;
  if (!events.length) return (
    <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
      <Activity className="h-8 w-8 text-muted-foreground/30" />
      <p className="text-sm text-muted-foreground/60">No activity recorded yet</p>
      <p className="text-xs text-muted-foreground/40">Timeline events appear when certification status changes, blockers are set, milestones complete, or files are attached.</p>
    </div>
  );

  return (
    <div className="relative space-y-0">
      {/* Vertical line */}
      <div className="absolute left-4 top-6 bottom-0 w-px bg-border/40" />
      {events.map((ev, i) => {
        const { icon: Icon, color } = TIMELINE_ICONS[ev.event_type] ?? TIMELINE_ICONS.default;
        return (
          <div key={ev.id} className="flex gap-3 relative py-2" data-testid={`timeline-event-${ev.id}`}>
            <div className={`z-10 w-8 h-8 rounded-full bg-background border-2 border-border/60 flex items-center justify-center shrink-0 ${i === 0 ? "border-primary/40" : ""}`}>
              <Icon className={`h-3.5 w-3.5 ${color}`} />
            </div>
            <div className="flex-1 min-w-0 pt-1">
              <p className="text-xs leading-snug">{ev.description}</p>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                {ev.actor_name ? `${ev.actor_name} · ` : ""}{fmtDate(ev.created_at)}
              </p>
            </div>
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
        ? type === "date"
          ? <DatePicker value={v(fkey) || ""} onChange={val => set(fkey, val || null)} placeholder={ph || "Pick a date"} />
          : <Input type={type} className="h-7 text-xs" defaultValue={v(fkey)} onChange={e => set(fkey, e.target.value || null)} placeholder={ph} />
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

      {/* Section 9 — Attachments (Phase 3) */}
      <Section title="Attachments" icon={Paperclip} defaultOpen={false}>
        <AttachmentsSection projectId={projectId} />
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
              <div className="mt-1"><DatePicker value={startDate} onChange={setStartDate} placeholder="Start date" /></div>
            </div>
            <div>
              <Label className="text-xs">End Date</Label>
              <div className="mt-1"><DatePicker value={endDate} onChange={setEndDate} placeholder="End date" /></div>
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
// ── People & Access — avatar stack, add/assign/share popovers, panel ──────────

function useOrgUsers() {
  return useQuery<OrgUser[]>({ queryKey: ["/api/users"] });
}

function AvatarStack({ members, max = 4 }: { members: ProjectMemberRow[]; max?: number }) {
  const shown = members.slice(0, max);
  const extra = members.length - shown.length;
  if (members.length === 0) return null;
  return (
    <div className="flex items-center -space-x-2" data-testid="avatar-stack-members">
      {shown.map(m => (
        <Avatar key={m.userId} className="h-6 w-6 border-2 border-background" title={`${m.name} · ${PROJECT_ROLE_LABELS[m.role] ?? m.role}`}>
          {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt={m.name} />}
          <AvatarFallback className="text-[9px]">{initials(m.name)}</AvatarFallback>
        </Avatar>
      ))}
      {extra > 0 && (
        <div className="h-6 w-6 rounded-full bg-muted border-2 border-background flex items-center justify-center text-[9px] font-medium text-muted-foreground" data-testid="avatar-stack-overflow">
          +{extra}
        </div>
      )}
    </div>
  );
}

function AddPeoplePopover({ projectId, existingIds }: { projectId: number; existingIds: number[] }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const { data: users } = useOrgUsers();
  const { toast } = useToast();
  const candidates = (users || []).filter(u => !existingIds.includes(u.id));

  const mutation = useMutation({
    mutationFn: async () => {
      const usersPayload = Object.entries(picked).map(([userId, role]) => ({ userId: Number(userId), role }));
      return apiRequest("POST", `/api/projects/${projectId}/members`, { users: usersPayload, notify: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", String(projectId), "activity"] });
      toast({ title: "People added" });
      setPicked({});
      setOpen(false);
    },
    onError: (e: any) => toast({ title: "Failed to add people", description: e?.message, variant: "destructive" }),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" data-testid="button-add-people">
          <UserPlus className="h-3.5 w-3.5" /> Add People
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="end">
        <div className="text-xs font-medium mb-2">Add people to this project</div>
        <div className="max-h-60 overflow-y-auto space-y-1.5">
          {candidates.length === 0 && <p className="text-xs text-muted-foreground">No more users to add.</p>}
          {candidates.map(u => (
            <div key={u.id} className="flex items-center justify-between gap-2" data-testid={`row-add-person-${u.id}`}>
              <label className="flex items-center gap-2 min-w-0 cursor-pointer">
                <Checkbox
                  checked={!!picked[u.id]}
                  onCheckedChange={(c) => setPicked(prev => {
                    const next = { ...prev };
                    if (c) next[u.id] = next[u.id] || "viewer"; else delete next[u.id];
                    return next;
                  })}
                  data-testid={`checkbox-add-person-${u.id}`}
                />
                <span className="text-xs truncate">{u.name}</span>
              </label>
              {picked[u.id] && (
                <Select value={picked[u.id]} onValueChange={(v) => setPicked(prev => ({ ...prev, [u.id]: v }))}>
                  <SelectTrigger className="h-6 w-24 text-[10px]" data-testid={`select-role-${u.id}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viewer">Viewer</SelectItem>
                    <SelectItem value="contributor">Contributor</SelectItem>
                    <SelectItem value="editor">Editor</SelectItem>
                    <SelectItem value="co_owner">Co-owner</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          ))}
        </div>
        <Button size="sm" className="w-full mt-3 h-7 text-xs" disabled={Object.keys(picked).length === 0 || mutation.isPending}
          onClick={() => mutation.mutate()} data-testid="button-confirm-add-people">
          {mutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function AssignPopover({ projectId }: { projectId: number }) {
  const [open, setOpen] = useState(false);
  const [ownerId, setOwnerId] = useState<string>("");
  const [coOwnerId, setCoOwnerId] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");
  const { data: users } = useOrgUsers();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/projects/${projectId}/assign`, {
      ownerId: ownerId ? Number(ownerId) : undefined,
      coOwnerId: coOwnerId ? Number(coOwnerId) : undefined,
      dueDate: dueDate || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Assignment updated" });
      setOpen(false);
    },
    onError: (e: any) => toast({ title: "Failed to assign", description: e?.message, variant: "destructive" }),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" data-testid="button-assign">
          <Users className="h-3.5 w-3.5" /> Assign
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 space-y-2.5" align="end">
        <div>
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Owner</Label>
          <Select value={ownerId} onValueChange={setOwnerId}>
            <SelectTrigger className="h-7 text-xs mt-1" data-testid="select-assign-owner"><SelectValue placeholder="Keep current" /></SelectTrigger>
            <SelectContent>{(users || []).map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Co-owner</Label>
          <Select value={coOwnerId} onValueChange={setCoOwnerId}>
            <SelectTrigger className="h-7 text-xs mt-1" data-testid="select-assign-coowner"><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent>{(users || []).map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Due Date</Label>
          <Input type="date" className="h-7 text-xs mt-1" value={dueDate} onChange={(e) => setDueDate(e.target.value)} data-testid="input-assign-due-date" />
        </div>
        <Button size="sm" className="w-full h-7 text-xs" disabled={mutation.isPending || (!ownerId && !coOwnerId && !dueDate)}
          onClick={() => mutation.mutate()} data-testid="button-confirm-assign">
          {mutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save Assignment"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function SharePopover({ projectId, existingIds }: { projectId: number; existingIds: number[] }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [role, setRole] = useState("viewer");
  const [link, setLink] = useState<string | null>(null);
  const { data: users } = useOrgUsers();
  const { toast } = useToast();
  const candidates = users || [];

  const mutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/projects/${projectId}/share`, { userIds: picked, role, notify: true }),
    onSuccess: async (res: any) => {
      const data = typeof res?.json === "function" ? await res.json() : res;
      setLink(data?.link || null);
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      toast({ title: "Project shared" });
    },
    onError: (e: any) => toast({ title: "Failed to share", description: e?.message, variant: "destructive" }),
  });

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setPicked([]); setLink(null); } }}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" data-testid="button-share">
          <Share2 className="h-3.5 w-3.5" /> Share
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3 space-y-2.5" align="end">
        <div className="text-xs font-medium">Share this project</div>
        <div className="max-h-40 overflow-y-auto space-y-1.5">
          {candidates.map(u => (
            <label key={u.id} className="flex items-center gap-2 cursor-pointer" data-testid={`row-share-person-${u.id}`}>
              <Checkbox checked={picked.includes(u.id)}
                onCheckedChange={(c) => setPicked(prev => c ? [...prev, u.id] : prev.filter(id => id !== u.id))}
                data-testid={`checkbox-share-person-${u.id}`} />
              <span className="text-xs truncate">{u.name}</span>
            </label>
          ))}
        </div>
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger className="h-7 text-xs" data-testid="select-share-role"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="viewer">Viewer</SelectItem>
            <SelectItem value="contributor">Contributor</SelectItem>
            <SelectItem value="editor">Editor</SelectItem>
          </SelectContent>
        </Select>
        {link && (
          <div className="flex items-center gap-1.5 bg-muted/50 rounded px-2 py-1.5">
            <span className="text-[10px] truncate flex-1" data-testid="text-share-link">{link}</span>
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0 shrink-0" onClick={() => { navigator.clipboard.writeText(link); toast({ title: "Link copied" }); }} data-testid="button-copy-share-link">
              <Copy className="h-3 w-3" />
            </Button>
          </div>
        )}
        <Button size="sm" className="w-full h-7 text-xs" disabled={picked.length === 0 || mutation.isPending}
          onClick={() => mutation.mutate()} data-testid="button-confirm-share">
          {mutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Share"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function PeopleAccessPanel({ projectId, members, myRole }: { projectId: number; members: ProjectMemberRow[]; myRole: string | null }) {
  const { toast } = useToast();
  const canManage = myRole === "owner" || myRole === "co_owner";

  const roleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: number; role: string }) =>
      apiRequest("PATCH", `/api/projects/${projectId}/members/${userId}`, { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      toast({ title: "Role updated" });
    },
    onError: (e: any) => toast({ title: "Failed to update role", description: e?.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async (userId: number) => apiRequest("DELETE", `/api/projects/${projectId}/members/${userId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      toast({ title: "Access removed" });
    },
    onError: (e: any) => toast({ title: "Failed to remove access", description: e?.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-2" data-testid="panel-people-access">
      {members.map(m => (
        <div key={m.userId} className="flex items-center justify-between gap-2 py-1.5" data-testid={`row-member-${m.userId}`}>
          <div className="flex items-center gap-2 min-w-0">
            <Avatar className="h-7 w-7">
              {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt={m.name} />}
              <AvatarFallback className="text-[10px]">{initials(m.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="text-xs font-medium truncate">{m.name}</p>
              <p className="text-[10px] text-muted-foreground truncate">{m.email}</p>
            </div>
          </div>
          {canManage && m.role !== "owner" ? (
            <div className="flex items-center gap-1 shrink-0">
              <Select value={m.role} onValueChange={(v) => roleMutation.mutate({ userId: m.userId, role: v })}>
                <SelectTrigger className="h-6 w-24 text-[10px]" data-testid={`select-member-role-${m.userId}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem value="contributor">Contributor</SelectItem>
                  <SelectItem value="editor">Editor</SelectItem>
                  <SelectItem value="co_owner">Co-owner</SelectItem>
                  {myRole === "owner" && <SelectItem value="owner">Owner (transfer)</SelectItem>}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => removeMutation.mutate(m.userId)} data-testid={`button-remove-member-${m.userId}`}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">{PROJECT_ROLE_LABELS[m.role] ?? m.role}</Badge>
          )}
        </div>
      ))}
      {members.length === 0 && <p className="text-xs text-muted-foreground">No one has been added to this project yet.</p>}
    </div>
  );
}

function ProjectDetailDialog({ project, onClose, onDelete }: { project: Project; onClose: () => void; onDelete: () => void }) {
  const [editOpen, setEditOpen] = useState(false);
  const [tab, setTab] = useState(project.type === "certification" ? "certification" : "overview");
  const typeConfig = getTypeConfig(project.type);
  const Icon = typeConfig.icon;
  const isCert = project.type === "certification";

  const { data: fullProject } = useQuery<Project & { myRole?: string | null; members?: ProjectMemberRow[] }>({
    queryKey: ["/api/projects", project.id],
    queryFn: () => fetch(`/api/projects/${project.id}`, { credentials: "include" }).then(r => r.json()),
  });
  const members = fullProject?.members ?? [];
  const myRole = fullProject?.myRole ?? null;
  const existingIds = members.map(m => m.userId);

  const { data: cert } = useQuery<CertRecord | null>({
    queryKey: ["/api/projects", project.id, "certification"],
    queryFn: () => fetch(`/api/projects/${project.id}/certification`, { credentials: "include" }).then(r => r.json()),
    enabled: isCert,
  });

  const { data: trackerAlertData } = useQuery<{ alertState: AlertState | null; activeAlerts: AlertType[] }>({
    queryKey: ["/api/projects", project.id, "tracker-alerts", "state"],
    queryFn: () => fetch(`/api/projects/${project.id}/tracker-alerts/state`, { credentials: "include" }).then(r => r.json()),
    enabled: isCert,
  });
  const tabBadgeCount = trackerAlertData?.activeAlerts?.length ?? 0;

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
              <div className="flex items-center gap-1.5 shrink-0">
                <AvatarStack members={members} />
                {(myRole === "owner" || myRole === "co_owner") && <AddPeoplePopover projectId={project.id} existingIds={existingIds} />}
                {(myRole === "owner" || myRole === "co_owner") && <AssignPopover projectId={project.id} />}
                {(myRole === "owner" || myRole === "co_owner" || myRole === "editor") && <SharePopover projectId={project.id} existingIds={existingIds} />}
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setEditOpen(true)} data-testid="button-edit-project">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                {myRole === "owner" && (
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={onDelete} data-testid="button-delete-project">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
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
                {isCert && <TabsTrigger value="timeline" data-testid="tab-timeline">Timeline</TabsTrigger>}
                {isCert && (
                  <TabsTrigger value="tracker" data-testid="tab-tracker" className="gap-1.5 relative">
                    <Table2 className="h-3.5 w-3.5" />
                    Live Test Tracker
                    {tabBadgeCount > 0 && (
                      <span
                        className="ml-1 text-[9px] font-bold px-1 py-0 rounded-full bg-red-500 text-white leading-4"
                        data-testid="badge-tracker-alerts"
                      >{tabBadgeCount}</span>
                    )}
                  </TabsTrigger>
                )}
              </TabsList>

              <ScrollArea className="flex-1 min-h-0">
                <div className="px-4 sm:px-6 py-4">

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
                    <Separator />
                    <div>
                      <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wide mb-2">People & Access</div>
                      <PeopleAccessPanel projectId={project.id} members={members} myRole={myRole} />
                    </div>
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

                  {isCert && (
                    <TabsContent value="timeline" className="mt-0">
                      <TimelinePanel projectId={project.id} />
                    </TabsContent>
                  )}

                  {isCert && (
                    <TabsContent value="tracker" className="mt-0">
                      <LiveTestTrackerTab projectId={project.id} projectName={project.name} />
                    </TabsContent>
                  )}
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
// ── Phase 2 cert quick-filter definitions ─────────────────────────────────────
const CERT_QUICK_FILTERS = [
  { key: "all_cert",     label: "All Certification",   color: "text-red-400",    border: "border-red-500/30",    bg: "bg-red-500/10"    },
  { key: "blocked",      label: "Blocked",             color: "text-red-400",    border: "border-red-500/30",    bg: "bg-red-500/10"    },
  { key: "retest",       label: "Retest Required",     color: "text-amber-400",  border: "border-amber-500/30",  bg: "bg-amber-500/10"  },
  { key: "due_30",       label: "Due in 30 days",      color: "text-orange-400", border: "border-orange-500/30", bg: "bg-orange-500/10" },
  { key: "cert_expiring",label: "Cert Expiring",       color: "text-yellow-400", border: "border-yellow-500/30", bg: "bg-yellow-500/10" },
  { key: "passed",       label: "Passed / Certified",  color: "text-emerald-400",border: "border-emerald-500/30",bg: "bg-emerald-500/10"},
];

export default function ProjectsPage() {
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [certFilter, setCertFilter] = useState("");  // Phase 2
  const [mineFilter, setMineFilter] = useState<"" | "owned" | "assigned" | "shared">("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Project | null>(null);
  const [drilldownConfig, setDrilldownConfig] = useState<UniversalDrilldownConfig | null>(null);
  const { toast } = useToast();

  const { data: projectsData, isLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects", { type: typeFilter, status: statusFilter, certFilter, mine: mineFilter }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (certFilter && certFilter !== "all_cert") {
        params.set("certFilter", certFilter);
      } else {
        if (typeFilter !== "all") params.set("type", typeFilter);
        if (certFilter === "all_cert") params.set("type", "certification");
      }
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (mineFilter) params.set("mine", mineFilter);
      return fetch(`/api/projects?${params}`, { credentials: "include" }).then(r => r.json());
    },
  });

  const handleCertFilter = (f: string) => {
    setCertFilter(f);
    setTypeFilter("certification");
    setStatusFilter("all");
  };

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

      {/* Phase 1 — Certification Oversight strip */}
      <CertSummaryStrip onCertFilter={handleCertFilter} onDrilldown={(metric) => setDrilldownConfig({ metric })} />

      <div className="px-6 py-4 border-b border-border/30">
        <div className="flex flex-wrap gap-1.5 mb-3">
          <button onClick={() => { setTypeFilter("all"); setCertFilter(""); }} className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${typeFilter === "all" && !certFilter ? "bg-primary/20 text-primary border-primary/30" : "border-border/50 text-muted-foreground hover:border-border"}`} data-testid="filter-type-all">
            All Types ({allProjects.length})
          </button>
          <span className="w-px h-4 bg-border/50 self-center mx-0.5" />
          {[
            { key: "", label: "All Projects" },
            { key: "owned", label: "Owned by Me" },
            { key: "assigned", label: "Assigned to Me" },
            { key: "shared", label: "Shared with Me" },
          ].map(f => (
            <button key={f.key || "all"} onClick={() => setMineFilter(f.key as any)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${mineFilter === f.key ? "bg-primary/20 text-primary border-primary/30" : "border-border/50 text-muted-foreground hover:border-border"}`}
              data-testid={`filter-mine-${f.key || "all"}`}>
              {f.label}
            </button>
          ))}
          {PROJECT_TYPES.map(t => (
            <button key={t.key} onClick={() => { setCertFilter(""); setTypeFilter(t.key === typeFilter ? "all" : t.key); }}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${typeFilter === t.key && !certFilter ? `${t.bg} ${t.color} ${t.border}` : "border-border/50 text-muted-foreground hover:border-border"}`}
              data-testid={`filter-type-${t.key}`}>
              {t.label} {typeCounts[t.key] > 0 && `(${typeCounts[t.key]})`}
            </button>
          ))}
        </div>

        {/* Phase 2 — Cert quick-filter chips (only visible when Safety Certification type is selected) */}
        {typeFilter === "certification" && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wide self-center mr-1">Cert:</span>
            {CERT_QUICK_FILTERS.map(f => {
              const active = certFilter === f.key || (f.key === "all_cert" && certFilter === "all_cert");
              return (
                <button key={f.key}
                  onClick={() => handleCertFilter(certFilter === f.key ? "" : f.key)}
                  className={`px-2 py-0.5 rounded-full text-xs font-medium border transition-all ${active ? `${f.bg} ${f.color} ${f.border}` : "border-border/40 text-muted-foreground/70 hover:border-border"}`}
                  data-testid={`filter-cert-${f.key}`}>
                  {f.label}
                </button>
              );
            })}
          </div>
        )}

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

      <UniversalDrilldownSheet
        config={drilldownConfig}
        onClose={() => setDrilldownConfig(null)}
        endpoint="/api/operations/drilldown"
      />
    </div>
  );
}
