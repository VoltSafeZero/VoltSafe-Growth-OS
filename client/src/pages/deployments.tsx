import { useState, useEffect } from "react";
import { ScoreBadge } from "@/components/scores/score-badge";
import { DatePicker } from "@/components/ui/date-picker";
import { useDeploymentRiskScores } from "@/hooks/use-scores";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AttachmentsSection } from "@/components/attachments-section";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  MapPin, Truck, CheckCircle2, XCircle, AlertTriangle, Clock,
  Plus, Zap, Activity, CheckSquare2, Package, Building2, User,
  ChevronRight, Radio, HardHat, Anchor,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Deployment {
  id: number;
  deploy_number: string;
  site_name: string;
  address?: string;
  region?: string;
  status: string;
  account_name?: string;
  owner_name?: string;
  install_workflow_title?: string;
  planned_start?: string;
  target_go_live?: string;
  actual_go_live?: string;
  hw_count?: number;
  hw_missing?: number;
  total_checkpoints?: number;
  passed_checkpoints?: number;
  open_blockers?: number;
  docks_count?: number;
  notes?: string;
}

interface CheckpointRow {
  id: number;
  name: string;
  status: string;
  sequence_order: number;
  checked_at?: string;
  checked_by_name?: string;
  notes?: string;
}

interface BlockerRow {
  id: number;
  title: string;
  severity: string;
  status: string;
  description?: string;
  resolved_at?: string;
}

interface HwRow {
  id: number;
  description?: string;
  part_name?: string;
  sku?: string;
  status: string;
  quantity_required: number;
  quantity_shipped: number;
  quantity_delivered: number;
}

interface DashboardData {
  overview: {
    total: number; active: number; live: number; blocked: number;
    commissioning: number; liveThisMonth: number; overdue: number;
  };
  byStatus: Record<string, number>;
  overdueDeployments: any[];
  blockedDeployments: any[];
  commissioningProgress: any[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(s?: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const DEPLOY_STATUSES = [
  "planned","scheduled","mobilizing","in_install",
  "commissioning","partially_live","live","blocked","complete",
];

const STATUS_COLOR: Record<string, string> = {
  planned:        "border-border/40 text-muted-foreground bg-muted/20",
  scheduled:      "border-blue-400/40 text-blue-400 bg-blue-400/10",
  mobilizing:     "border-amber-400/40 text-amber-400 bg-amber-400/10",
  in_install:     "border-violet-500/40 text-violet-400 bg-violet-500/10",
  commissioning:  "border-cyan-500/40 text-cyan-400 bg-cyan-500/10",
  partially_live: "border-teal-400/40 text-teal-400 bg-teal-400/10",
  live:           "border-emerald-500/40 text-emerald-400 bg-emerald-500/10",
  blocked:        "border-red-500/40 text-red-400 bg-red-500/10",
  complete:       "border-emerald-600/50 text-emerald-300 bg-emerald-600/10",
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: "border-red-600/50 text-red-300 bg-red-600/10",
  high:     "border-red-500/40 text-red-400 bg-red-500/10",
  medium:   "border-amber-500/40 text-amber-400 bg-amber-500/10",
  low:      "border-border/40 text-muted-foreground bg-muted/20",
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLOR[status] ?? "border-border/40 text-muted-foreground";
  return <span className={`text-[10px] font-medium border rounded-full px-2 py-0.5 ${cls}`}>{status.replace(/_/g, " ")}</span>;
}

function CpIcon({ status }: { status: string }) {
  if (status === "passed") return <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-red-400 flex-shrink-0" />;
  return <div className="h-4 w-4 rounded-full border-2 border-border/50 flex-shrink-0" />;
}

// ── Create Deployment Modal ───────────────────────────────────────────────────
function CreateDeploymentButton() {
  const [open, setOpen] = useState(false);
  const [siteName, setSiteName] = useState("");
  const [address, setAddress] = useState("");
  const [region, setRegion] = useState("");
  const [targetGoLive, setTargetGoLive] = useState("");
  const [docksCount, setDocksCount] = useState("");
  const { toast } = useToast();

  const mut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/deployments", {
      siteName, address: address || null, region: region || null,
      targetGoLive: targetGoLive || null,
      docksCount: docksCount ? parseInt(docksCount) : null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deployments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/deployments/dashboard"] });
      setOpen(false); setSiteName(""); setAddress(""); setRegion(""); setTargetGoLive(""); setDocksCount("");
      toast({ title: "Deployment created — commissioning checklist seeded" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!open) return (
    <Button size="sm" className="h-7 text-xs gap-1" onClick={() => setOpen(true)} data-testid="btn-create-deployment">
      <Plus className="h-3 w-3" /> New Deployment
    </Button>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" data-testid="create-deployment-modal">
      <div className="bg-card border border-border rounded-xl p-5 w-full max-w-sm space-y-3 shadow-xl">
        <div className="font-semibold text-sm">New Site Deployment</div>
        <Input value={siteName} onChange={e => setSiteName(e.target.value)}
          className="h-8 text-xs" placeholder="Site name (required)" data-testid="deploy-site-name" />
        <Input value={address} onChange={e => setAddress(e.target.value)}
          className="h-8 text-xs" placeholder="Address" data-testid="deploy-address" />
        <Input value={region} onChange={e => setRegion(e.target.value)}
          className="h-8 text-xs" placeholder="Region" data-testid="deploy-region" />
        <DatePicker value={targetGoLive} onChange={setTargetGoLive} placeholder="Target go-live" data-testid="deploy-target-go-live" />
        <Input type="number" value={docksCount} onChange={e => setDocksCount(e.target.value)}
          className="h-8 text-xs" placeholder="Number of docks" data-testid="deploy-docks-count" />
        <div className="flex gap-2">
          <Button size="sm" className="flex-1 h-7 text-xs" onClick={() => mut.mutate()} disabled={mut.isPending || !siteName.trim()} data-testid="btn-create-deployment-submit">
            {mut.isPending ? "Creating…" : "Create"}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

// ── Deployment Status Select ──────────────────────────────────────────────────
function DeployStatusSelect({ dep }: { dep: Deployment }) {
  const { toast } = useToast();
  const mut = useMutation({
    mutationFn: (status: string) => apiRequest("PATCH", `/api/deployments/${dep.id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deployments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/deployments/dashboard"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  return (
    <Select value={dep.status} onValueChange={s => mut.mutate(s)} disabled={mut.isPending}>
      <SelectTrigger className="h-6 text-[10px] w-36 border-0 p-1" data-testid={`deploy-status-${dep.id}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {DEPLOY_STATUSES.map(s => <SelectItem key={s} value={s} className="text-xs">{s.replace(/_/g, " ")}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

// ── Checkpoint Row ────────────────────────────────────────────────────────────
function CheckpointItem({ cp, deployId }: { cp: CheckpointRow; deployId: number }) {
  const { toast } = useToast();
  const mut = useMutation({
    mutationFn: (status: string) => apiRequest("PATCH", `/api/deployments/${deployId}/checkpoints/${cp.id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/deployments/${deployId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/deployments"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${cp.status === "passed" ? "border-emerald-500/20 bg-emerald-500/5" : cp.status === "failed" ? "border-red-500/20 bg-red-500/5" : "border-border/30"}`}
      data-testid={`cp-row-${cp.id}`}>
      <CpIcon status={cp.status} />
      <div className="flex-1 min-w-0">
        <div className={`text-xs font-medium ${cp.status === "passed" ? "line-through text-muted-foreground" : ""}`}>{cp.name}</div>
        {cp.checked_at && <div className="text-[10px] text-muted-foreground mt-0.5">Checked {fmtDate(cp.checked_at)}</div>}
      </div>
      {cp.status !== "passed" && (
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" className="h-6 text-[10px] text-emerald-400 hover:text-emerald-300 px-2"
            onClick={() => mut.mutate("passed")} disabled={mut.isPending} data-testid={`cp-pass-${cp.id}`}>
            Pass
          </Button>
          {cp.status === "pending" && (
            <Button size="sm" variant="ghost" className="h-6 text-[10px] text-red-400 hover:text-red-300 px-2"
              onClick={() => mut.mutate("failed")} disabled={mut.isPending} data-testid={`cp-fail-${cp.id}`}>
              Fail
            </Button>
          )}
        </div>
      )}
      {cp.status === "passed" && (
        <Button size="sm" variant="ghost" className="h-6 text-[10px] text-muted-foreground px-2"
          onClick={() => mut.mutate("pending")} disabled={mut.isPending}>
          Reset
        </Button>
      )}
    </div>
  );
}

// ── Deployment Detail Panel ───────────────────────────────────────────────────
function DeploymentDetail({ deployId, onClose }: { deployId: number; onClose: () => void }) {
  const [detailTab, setDetailTab] = useState("checkpoints");
  const { toast } = useToast();
  const [newBlocker, setNewBlocker] = useState("");

  const { data: dep, isLoading } = useQuery<any>({
    queryKey: [`/api/deployments/${deployId}`],
    queryFn: () => fetch(`/api/deployments/${deployId}`, { credentials: "include" }).then(r => r.json()),
    staleTime: 10_000,
  });

  const addBlockerMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/deployments/${deployId}/blockers`, {
      title: newBlocker, severity: "high",
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/deployments/${deployId}`] });
      setNewBlocker("");
      toast({ title: "Blocker logged — task created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const resolveBlockerMut = useMutation({
    mutationFn: (blId: number) => apiRequest("PATCH", `/api/deployments/${deployId}/blockers/${blId}`, { status: "resolved" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/deployments/${deployId}`] }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/30">
      <div className="bg-card border border-border rounded-xl p-6 w-full max-w-2xl"><Skeleton className="h-64" /></div>
    </div>
  );
  if (!dep) return null;

  const totalCps  = dep.checkpoints?.length ?? 0;
  const passedCps = dep.checkpoints?.filter((c: CheckpointRow) => c.status === "passed").length ?? 0;
  const pct       = totalCps > 0 ? Math.round((passedCps / totalCps) * 100) : 0;
  const openBls   = dep.blockers?.filter((b: BlockerRow) => b.status === "open") ?? [];

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/40 p-4" data-testid="deployment-detail-panel">
      <div className="bg-card border border-border rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-border/40">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Anchor className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">{dep.site_name}</span>
              <StatusBadge status={dep.status} />
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              <span className="font-mono">{dep.deploy_number}</span>
              {dep.address && <span><MapPin className="h-3 w-3 inline mr-0.5" />{dep.address}</span>}
              {dep.account_name && <span><Building2 className="h-3 w-3 inline mr-0.5" />{dep.account_name}</span>}
              {dep.target_go_live && <span><Clock className="h-3 w-3 inline mr-0.5" />Go-live {fmtDate(dep.target_go_live)}</span>}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={() => window.dispatchEvent(new CustomEvent("open-quick-capture", { detail: { tab: "task", prefill: { title: `Deployment task: ${dep.site_name}`, linkedObjectType: "deployment", linkedObjectId: dep.id, accountId: dep.account_id } } }))}
              data-testid={`button-add-task-deploy-${dep.id}`}
            >
              <Plus className="h-3 w-3" /> Task
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onClose}>Close</Button>
          </div>
        </div>

        {/* Commissioning progress bar */}
        {totalCps > 0 && (
          <div className="px-5 py-2 border-b border-border/20 bg-muted/10">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
              <span>Commissioning progress</span>
              <span className="font-semibold">{passedCps}/{totalCps} ({pct}%)</span>
            </div>
            <div className="h-1.5 bg-muted/40 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {/* Tabs */}
        <Tabs value={detailTab} onValueChange={setDetailTab} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="h-8 bg-muted/20 mx-4 mt-3 p-1 gap-1">
            <TabsTrigger value="checkpoints" className="text-xs h-6" data-testid="dtab-checkpoints">
              Checklist {pct < 100 && <span className="ml-1 text-[9px] opacity-60">{pct}%</span>}
            </TabsTrigger>
            <TabsTrigger value="blockers" className="text-xs h-6" data-testid="dtab-blockers">
              Blockers {openBls.length > 0 && <Badge className="ml-1 text-[9px] px-1 py-0 bg-red-500 text-white">{openBls.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="hardware" className="text-xs h-6" data-testid="dtab-hardware">Hardware</TabsTrigger>
            <TabsTrigger value="info" className="text-xs h-6" data-testid="dtab-info">Info</TabsTrigger>
            <TabsTrigger value="documents" className="text-xs h-6" data-testid="dtab-documents">Documents</TabsTrigger>
          </TabsList>

          {/* Checklist */}
          <TabsContent value="checkpoints" className="flex-1 overflow-auto px-4 pb-4 pt-2 space-y-2">
            {dep.checkpoints?.map((cp: CheckpointRow) => (
              <CheckpointItem key={cp.id} cp={cp} deployId={dep.id} />
            ))}
            {dep.checkpoints?.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-4">No checkpoints.</div>
            )}
          </TabsContent>

          {/* Blockers */}
          <TabsContent value="blockers" className="flex-1 overflow-auto px-4 pb-4 pt-2 space-y-2">
            {/* Add blocker */}
            <div className="flex gap-2">
              <Input value={newBlocker} onChange={e => setNewBlocker(e.target.value)}
                className="h-7 text-xs flex-1" placeholder="Describe a new blocker…" data-testid="new-blocker-input" />
              <Button size="sm" className="h-7 text-xs" onClick={() => addBlockerMut.mutate()}
                disabled={addBlockerMut.isPending || !newBlocker.trim()} data-testid="btn-add-blocker">
                Log
              </Button>
            </div>
            {dep.blockers?.map((bl: BlockerRow) => (
              <div key={bl.id} className={`p-3 rounded-lg border ${bl.status === "open" ? "border-amber-500/30 bg-amber-500/5" : "border-border/20 bg-muted/5 opacity-60"}`}
                data-testid={`blocker-row-${bl.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className={`text-xs font-medium ${bl.status === "resolved" ? "line-through text-muted-foreground" : ""}`}>{bl.title}</span>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[10px] border rounded-full px-1.5 py-0 ${SEVERITY_COLOR[bl.severity] ?? ""}`}>{bl.severity}</span>
                      {bl.status === "resolved" && <span className="text-[10px] text-emerald-400">Resolved {fmtDate(bl.resolved_at)}</span>}
                    </div>
                  </div>
                  {bl.status === "open" && (
                    <Button size="sm" variant="ghost" className="h-6 text-[10px] text-emerald-400 px-2 flex-shrink-0"
                      onClick={() => resolveBlockerMut.mutate(bl.id)} data-testid={`btn-resolve-blocker-${bl.id}`}>
                      Resolve
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {dep.blockers?.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-4">
                <CheckCircle2 className="h-5 w-5 text-emerald-400 mx-auto mb-1" />No blockers
              </div>
            )}
          </TabsContent>

          {/* Hardware */}
          <TabsContent value="hardware" className="flex-1 overflow-auto px-4 pb-4 pt-2">
            {dep.hardware?.length === 0 ? (
              <div className="text-xs text-muted-foreground text-center py-4">No hardware allocations.</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/40">
                    {["Item","Status","Required","Shipped","Delivered"].map(h => (
                      <th key={h} className={`py-1.5 pr-3 text-muted-foreground font-medium ${h === "Item" ? "text-left" : "text-right"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dep.hardware?.map((hw: HwRow) => (
                    <tr key={hw.id} className={`border-b border-border/20 ${hw.status === "missing" ? "bg-red-500/5" : ""}`}
                      data-testid={`hw-row-${hw.id}`}>
                      <td className="py-2 pr-3">{hw.description ?? hw.part_name ?? "—"}</td>
                      <td className="py-2 pr-3 text-right">
                        <span className={`text-[10px] border rounded-full px-1.5 ${hw.status === "delivered" ? "border-emerald-500/40 text-emerald-400" : hw.status === "missing" ? "border-red-500/40 text-red-400" : "border-border/40 text-muted-foreground"}`}>{hw.status}</span>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{hw.quantity_required}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{hw.quantity_shipped}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{hw.quantity_delivered}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </TabsContent>

          {/* Info */}
          <TabsContent value="info" className="flex-1 overflow-auto px-4 pb-4 pt-2">
            <div className="space-y-2">
              {[
                { label: "Deploy Number",    value: dep.deploy_number },
                { label: "Site",             value: dep.site_name },
                { label: "Address",          value: dep.address ?? "—" },
                { label: "Region",           value: dep.region ?? "—" },
                { label: "Account",          value: dep.account_name ?? "—" },
                { label: "Owner",            value: dep.owner_name ?? "—" },
                { label: "Install Workflow", value: dep.install_workflow_title ?? "—" },
                { label: "Planned Start",    value: fmtDate(dep.planned_start) },
                { label: "Actual Start",     value: fmtDate(dep.actual_start) },
                { label: "Target Go-Live",   value: fmtDate(dep.target_go_live) },
                { label: "Actual Go-Live",   value: fmtDate(dep.actual_go_live) },
                { label: "Docks",            value: dep.docks_count ?? "—" },
              ].map(r => (
                <div key={r.label} className="flex justify-between text-xs py-1.5 border-b border-border/20">
                  <span className="text-muted-foreground">{r.label}</span>
                  <span className="font-medium">{r.value}</span>
                </div>
              ))}
              {dep.notes && (
                <div className="text-xs text-muted-foreground mt-2 p-2 bg-muted/20 rounded">{dep.notes}</div>
              )}
            </div>
          </TabsContent>

          {/* Documents */}
          <TabsContent value="documents" className="flex-1 overflow-auto px-4 pb-4 pt-2">
            <AttachmentsSection objectType="deployment" objectId={dep.id} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function DeploymentsPage() {
  const [activeTab, setActiveTab] = useState("deployments");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedDeployId, setSelectedDeployId] = useState<number | null>(null);

  // Hide the global FAB while a deployment detail modal is open (z-[60] panel covers it anyway)
  useEffect(() => {
    if (selectedDeployId !== null) {
      document.body.classList.add("has-modal");
    } else {
      document.body.classList.remove("has-modal");
    }
    return () => {
      document.body.classList.remove("has-modal");
    };
  }, [selectedDeployId]);

  const { scoreMap: deployRiskScores } = useDeploymentRiskScores();

  const { data: dashboard, isLoading: dashLoading } = useQuery<DashboardData>({
    queryKey: ["/api/deployments/dashboard"],
    queryFn: () => fetch("/api/deployments/dashboard", { credentials: "include" }).then(r => r.json()),
    staleTime: 30_000,
  });

  const params = statusFilter !== "all" ? `?status=${statusFilter}` : "";
  const { data: deploysData, isLoading: deploysLoading } = useQuery<{ data: Deployment[] }>({
    queryKey: ["/api/deployments", statusFilter],
    queryFn: () => fetch(`/api/deployments${params}`, { credentials: "include" }).then(r => r.json()),
    staleTime: 20_000,
  });

  const { data: blockedData } = useQuery<{ data: any[] }>({
    queryKey: ["/api/deployments/blocked"],
    queryFn: () => fetch("/api/deployments/blocked", { credentials: "include" }).then(r => r.json()),
    staleTime: 20_000,
  });

  const dash     = dashboard;
  const deploys  = deploysData?.data ?? [];
  const blocked  = blockedData?.data ?? [];

  return (
    <div className="flex-1 overflow-auto bg-background p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" data-testid="page-title-deployments">
            <HardHat className="h-5 w-5 text-primary" />
            Deployment Manager
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Track marina/site rollouts from planning through go-live — commissioning, hardware, and field execution.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(dash?.overview.overdue ?? 0) > 0 && (
            <span className="text-xs px-2 py-1 rounded-full border border-red-500/40 bg-red-500/10 text-red-400 font-medium">
              <Clock className="h-3 w-3 inline mr-1" />{dash!.overview.overdue} overdue
            </span>
          )}
          {(dash?.overview.blocked ?? 0) > 0 && (
            <span className="text-xs px-2 py-1 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-400 font-medium">
              <AlertTriangle className="h-3 w-3 inline mr-1" />{dash!.overview.blocked} blocked
            </span>
          )}
        </div>
      </div>

      {/* KPI Strip */}
      {dashLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(7)].map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : dash && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3" data-testid="deploy-kpi-strip">
          {[
            { label: "Total Sites",     value: dash.overview.total,         icon: MapPin,       color: "" },
            { label: "Active",          value: dash.overview.active,        icon: Activity,     color: "text-blue-400" },
            { label: "Commissioning",   value: dash.overview.commissioning, icon: Radio,        color: "text-cyan-400" },
            { label: "Live",            value: dash.overview.live,          icon: Zap,          color: "text-emerald-400" },
            { label: "Blocked",         value: dash.overview.blocked,       icon: AlertTriangle, color: dash.overview.blocked > 0 ? "text-amber-400" : "" },
            { label: "Go-Live Overdue", value: dash.overview.overdue,       icon: Clock,        color: dash.overview.overdue > 0 ? "text-red-400" : "" },
            { label: "Live This Month", value: dash.overview.liveThisMonth, icon: CheckCircle2, color: "text-emerald-400" },
          ].map(k => (
            <Card key={k.label} className="border border-border/50" data-testid={`kpi-deploy-${k.label.toLowerCase().replace(/\s/g, "-")}`}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-muted-foreground font-medium">{k.label}</span>
                  <k.icon className={`h-3 w-3 ${k.color || "text-muted-foreground"}`} />
                </div>
                <div className={`text-xl font-bold tabular-nums ${k.color}`}>{k.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-8 bg-muted/40 p-1 gap-1">
          <TabsTrigger value="deployments" className="text-xs h-6" data-testid="tab-deployments">
            Deployments {deploys.length > 0 && <Badge className="ml-1 text-[9px] px-1 py-0 bg-primary text-white">{deploys.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="blocked" className="text-xs h-6" data-testid="tab-blocked-deploys">
            Blocked {blocked.length > 0 && <Badge className="ml-1 text-[9px] px-1 py-0 bg-red-500 text-white">{blocked.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="dashboard" className="text-xs h-6" data-testid="tab-deploy-dashboard">Dashboard</TabsTrigger>
        </TabsList>

        {/* ── Deployments List ───────────────────────────────────────────────── */}
        <TabsContent value="deployments" className="mt-3 space-y-3">
          <div className="flex items-center justify-between">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-7 w-44 text-xs" data-testid="deploy-status-filter">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {DEPLOY_STATUSES.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
              </SelectContent>
            </Select>
            <CreateDeploymentButton />
          </div>

          {deploysLoading ? <Skeleton className="h-40" /> : deploys.length === 0 ? (
            <div className="text-center py-10 border border-border/30 rounded-lg">
              <HardHat className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <div className="text-sm text-muted-foreground">No deployments yet. Create the first site rollout.</div>
            </div>
          ) : (
            <div className="space-y-2">
              {deploys.map(dep => {
                const totalCps  = dep.total_checkpoints ?? 0;
                const passedCps = dep.passed_checkpoints ?? 0;
                const pct = totalCps > 0 ? Math.round((passedCps / totalCps) * 100) : 0;
                const isOverdue = dep.target_go_live && new Date(dep.target_go_live) < new Date() && !["live","complete"].includes(dep.status);

                return (
                  <Card key={dep.id} className={`border cursor-pointer hover:bg-muted/5 transition-colors ${dep.status === "blocked" ? "border-red-500/30" : isOverdue ? "border-amber-500/30" : "border-border/50"}`}
                    onClick={() => setSelectedDeployId(dep.id)} data-testid={`deploy-card-${dep.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium truncate">{dep.site_name}</span>
                            <StatusBadge status={dep.status} />
                            {isOverdue && <span className="text-[10px] text-red-400 font-medium">OVERDUE</span>}
                            {deployRiskScores[dep.id] && deployRiskScores[dep.id].band !== "low" && (
                              <ScoreBadge score={deployRiskScores[dep.id]} variant="compact" data-testid={`score-deploy-risk-${dep.id}`} />
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                            <span className="font-mono text-[10px]">{dep.deploy_number}</span>
                            {dep.account_name && <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{dep.account_name}</span>}
                            {dep.region && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{dep.region}</span>}
                            {dep.target_go_live && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Go-live {fmtDate(dep.target_go_live)}</span>}
                          </div>
                          {/* Commissioning progress bar */}
                          {totalCps > 0 && (
                            <div className="mt-2">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1 bg-muted/40 rounded-full overflow-hidden">
                                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
                                </div>
                                <span className="text-[10px] text-muted-foreground tabular-nums">{pct}%</span>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                          <DeployStatusSelect dep={dep} />
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            {(dep.open_blockers ?? 0) > 0 && (
                              <span className="text-amber-400"><AlertTriangle className="h-3 w-3 inline mr-0.5" />{dep.open_blockers}</span>
                            )}
                            {(dep.hw_missing ?? 0) > 0 && (
                              <span className="text-red-400"><Package className="h-3 w-3 inline mr-0.5" />{dep.hw_missing} missing</span>
                            )}
                            <ChevronRight className="h-3 w-3" />
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Blocked ───────────────────────────────────────────────────────── */}
        <TabsContent value="blocked" className="mt-3 space-y-2">
          {blocked.length === 0 ? (
            <div className="p-8 text-center border border-border/40 rounded-lg">
              <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
              <div className="text-sm font-medium">No blocked deployments</div>
              <div className="text-xs text-muted-foreground">All active sites have no open blockers or missing hardware.</div>
            </div>
          ) : blocked.map((r: any) => (
            <Card key={r.id} className="border border-red-500/30 bg-red-500/5 cursor-pointer hover:bg-red-500/8"
              onClick={() => setSelectedDeployId(r.id)} data-testid={`blocked-deploy-${r.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle className="h-4 w-4 text-red-400" />
                      <span className="text-sm font-medium">{r.site_name}</span>
                      <StatusBadge status={r.status} />
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {r.account_name && <span><Building2 className="h-3 w-3 inline mr-0.5" />{r.account_name}</span>}
                      {r.target_go_live && <span><Clock className="h-3 w-3 inline mr-0.5" />Due {fmtDate(r.target_go_live)}</span>}
                    </div>
                  </div>
                  <div className="text-right text-xs space-y-0.5">
                    {r.open_blocker_count > 0 && <div className="text-amber-400">{r.open_blocker_count} open blocker{r.open_blocker_count > 1 ? "s" : ""}</div>}
                    {r.missing_hw_count > 0 && <div className="text-red-400">{r.missing_hw_count} missing hardware</div>}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* ── Dashboard ─────────────────────────────────────────────────────── */}
        <TabsContent value="dashboard" className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Status breakdown */}
          <Card className="border border-border/50">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" />By Status</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {dashLoading ? <Skeleton className="h-32" /> : Object.entries(dash?.byStatus ?? {}).length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-4">No deployments yet</div>
              ) : (
                <div className="space-y-1.5">
                  {Object.entries(dash?.byStatus ?? {}).map(([status, count]) => (
                    <div key={status} className="flex items-center gap-2 text-xs">
                      <StatusBadge status={status} />
                      <div className="flex-1 h-1.5 bg-muted/40 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (count / Math.max(...Object.values(dash!.byStatus).map(Number))) * 100)}%` }} />
                      </div>
                      <span className="tabular-nums w-5 text-right">{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Overdue */}
          {(dash?.overdueDeployments ?? []).length > 0 && (
            <Card className="border border-red-500/30 bg-red-500/5">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm flex items-center gap-2 text-red-400">
                  <Clock className="h-4 w-4" />Go-Live Overdue
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-1.5">
                {dash!.overdueDeployments.map((d: any) => (
                  <div key={d.id} className="flex justify-between text-xs py-1.5 border-b border-border/20 cursor-pointer hover:opacity-80"
                    onClick={() => setSelectedDeployId(d.id)}>
                    <span className="font-medium">{d.site_name}</span>
                    <span className="text-red-400">{fmtDate(d.target_go_live)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Commissioning progress */}
          {(dash?.commissioningProgress ?? []).length > 0 && (
            <Card className="border border-cyan-500/30 bg-cyan-500/5">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm flex items-center gap-2 text-cyan-400">
                  <Radio className="h-4 w-4" />Commissioning In Progress
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                {dash!.commissioningProgress.map((d: any) => (
                  <div key={d.id} className="cursor-pointer hover:opacity-80" onClick={() => setSelectedDeployId(d.id)}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-medium">{d.site_name}</span>
                      <span className="text-muted-foreground">{d.passed_cps}/{d.total_cps}</span>
                    </div>
                    <div className="h-1 bg-muted/40 rounded-full overflow-hidden">
                      <div className="h-full bg-cyan-500 rounded-full" style={{ width: `${d.pct_complete ?? 0}%` }} />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Deployment detail panel */}
      {selectedDeployId !== null && (
        <DeploymentDetail deployId={selectedDeployId} onClose={() => setSelectedDeployId(null)} />
      )}
    </div>
  );
}
