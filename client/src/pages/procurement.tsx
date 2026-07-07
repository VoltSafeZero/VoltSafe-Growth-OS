import { useState, Fragment } from "react";
import { UniversalDrilldownSheet, type UniversalDrilldownConfig } from "@/components/shared/universal-drilldown-sheet";
import { DatePicker } from "@/components/ui/date-picker";
import { AttachmentsSection } from "@/components/attachments-section";
import { useQuery, useMutation } from "@tanstack/react-query";
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
  Package, Truck, Factory, Boxes, AlertTriangle, CheckCircle2,
  Clock, XCircle, Plus, RefreshCw, TrendingDown, ChevronRight,
  Hammer, Building2, User,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Supplier { id: number; name: string; status: string; country?: string; lead_time_days?: number; po_count?: number; }
interface Part { id: number; sku: string; name: string; category?: string; unit: string; unit_cost?: number; supplier_name?: string; }
interface PurchaseOrder {
  id: number; po_number: string; status: string; supplier_name?: string;
  owner_name?: string; account_name?: string; expected_delivery_date?: string;
  total_amount?: number; currency: string; blockers?: string; line_count?: number;
}
interface PurchaseOrderLine {
  id: number; description?: string; part_name?: string; sku?: string;
  quantity: number; quantity_received: number; unit_cost?: number;
}
interface ProductionBatch {
  id: number; batch_number: string; status: string; part_name?: string;
  quantity: number; owner_name?: string; account_name?: string;
  install_workflow_title?: string; blockers?: string;
  target_completion_date?: string;
}
interface DashboardData {
  pos: { byStatus: Record<string,{count:number;value:number}>; totalOpen: number; totalDelayed: number; delayedSuppliers: any[] };
  batches: { byStatus: Record<string,{count:number;qty:number}>; totalBlocked: number; totalReady: number };
  inventory: { totalSkuLocations: number; totalOnHand: number; totalAllocated: number; totalAvailable: number; shortfallCount: number };
  blockedInstalls: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(s?: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtAmt(n?: number | null) {
  if (!n) return "—";
  if (n >= 1_000_000) return `$${(n/1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n/1_000).toFixed(0)}k`;
  return `$${Math.round(n)}`;
}

const PO_STATUS_COLOR: Record<string,string> = {
  draft:              "border-border/40 text-muted-foreground bg-muted/20",
  issued:             "border-blue-500/40 text-blue-400 bg-blue-500/10",
  partially_received: "border-amber-500/40 text-amber-400 bg-amber-500/10",
  received:           "border-emerald-500/40 text-emerald-400 bg-emerald-500/10",
  delayed:            "border-red-500/40 text-red-400 bg-red-500/10",
  cancelled:          "border-border/30 text-muted-foreground/50 bg-muted/10",
};
const BATCH_STATUS_COLOR: Record<string,string> = {
  planned:     "border-border/40 text-muted-foreground bg-muted/20",
  in_assembly: "border-blue-500/40 text-blue-400 bg-blue-500/10",
  testing:     "border-purple-500/40 text-purple-400 bg-purple-500/10",
  ready:       "border-emerald-500/40 text-emerald-400 bg-emerald-500/10",
  shipped:     "border-teal-500/40 text-teal-400 bg-teal-500/10",
  blocked:     "border-red-500/40 text-red-400 bg-red-500/10",
};

function StatusBadge({ status, map }: { status: string; map: Record<string,string> }) {
  const cls = map[status] ?? "border-border/40 text-muted-foreground";
  return <span className={`text-[10px] font-medium border rounded-full px-2 py-0.5 ${cls}`}>{status.replace(/_/g," ")}</span>;
}

// ── Create PO Modal ───────────────────────────────────────────────────────────
function CreatePOButton({ suppliers }: { suppliers: Supplier[] }) {
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const { toast } = useToast();

  const mut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/procurement/purchase-orders", {
      supplierId: supplierId ? parseInt(supplierId) : null,
      expectedDeliveryDate: expectedDate || null,
      notes: notes || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurement/purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/procurement/dashboard"] });
      setOpen(false); setSupplierId(""); setExpectedDate(""); setNotes("");
      toast({ title: "Purchase order created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!open) return (
    <Button size="sm" className="h-7 text-xs gap-1" onClick={() => setOpen(true)} data-testid="btn-create-po">
      <Plus className="h-3 w-3" /> New PO
    </Button>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" data-testid="create-po-modal">
      <div className="bg-card border border-border rounded-xl p-5 w-full max-w-sm space-y-3 shadow-xl">
        <div className="font-semibold text-sm">New Purchase Order</div>
        <Select value={supplierId} onValueChange={setSupplierId}>
          <SelectTrigger className="h-8 text-xs" data-testid="po-supplier-select">
            <SelectValue placeholder="Select supplier (optional)" />
          </SelectTrigger>
          <SelectContent>
            {suppliers.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <DatePicker value={expectedDate} onChange={setExpectedDate} placeholder="Expected delivery" data-testid="po-expected-date" />
        <Input value={notes} onChange={e => setNotes(e.target.value)}
          className="h-8 text-xs" placeholder="Notes (optional)" data-testid="po-notes" />
        <div className="flex gap-2">
          <Button size="sm" className="flex-1 h-7 text-xs" onClick={() => mut.mutate()} disabled={mut.isPending} data-testid="btn-create-po-submit">
            {mut.isPending ? "Creating…" : "Create PO"}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

// ── Create Batch Modal ────────────────────────────────────────────────────────
function CreateBatchButton({ parts }: { parts: Part[] }) {
  const [open, setOpen] = useState(false);
  const [partId, setPartId] = useState("");
  const [partName, setPartName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const { toast } = useToast();

  const mut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/procurement/production-batches", {
      partId: partId ? parseInt(partId) : null,
      partName: partName || null,
      quantity: parseFloat(quantity) || 1,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurement/production-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/procurement/dashboard"] });
      setOpen(false); setPartId(""); setPartName(""); setQuantity("1");
      toast({ title: "Production batch created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!open) return (
    <Button size="sm" className="h-7 text-xs gap-1" onClick={() => setOpen(true)} data-testid="btn-create-batch">
      <Plus className="h-3 w-3" /> New Batch
    </Button>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" data-testid="create-batch-modal">
      <div className="bg-card border border-border rounded-xl p-5 w-full max-w-sm space-y-3 shadow-xl">
        <div className="font-semibold text-sm">New Production Batch</div>
        <Select value={partId} onValueChange={setPartId}>
          <SelectTrigger className="h-8 text-xs" data-testid="batch-part-select">
            <SelectValue placeholder="Select part (optional)" />
          </SelectTrigger>
          <SelectContent>
            {parts.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.sku} — {p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input value={partName} onChange={e => setPartName(e.target.value)}
          className="h-8 text-xs" placeholder="Part name (if not in catalog)" data-testid="batch-part-name" />
        <Input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)}
          className="h-8 text-xs" placeholder="Quantity" data-testid="batch-quantity" />
        <div className="flex gap-2">
          <Button size="sm" className="flex-1 h-7 text-xs" onClick={() => mut.mutate()} disabled={mut.isPending} data-testid="btn-create-batch-submit">
            {mut.isPending ? "Creating…" : "Create Batch"}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

// ── PO Status Update ──────────────────────────────────────────────────────────
const PO_STATUSES = ["draft","issued","partially_received","received","delayed","cancelled"];
const BATCH_STATUSES = ["planned","in_assembly","testing","ready","shipped","blocked"];

function POStatusSelect({ po }: { po: PurchaseOrder }) {
  const { toast } = useToast();
  const mut = useMutation({
    mutationFn: (status: string) => apiRequest("PATCH", `/api/procurement/purchase-orders/${po.id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurement/purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/procurement/dashboard"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  return (
    <Select value={po.status} onValueChange={s => mut.mutate(s)} disabled={mut.isPending}>
      <SelectTrigger className="h-6 text-[10px] w-36 border-0 p-1" data-testid={`po-status-${po.id}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PO_STATUSES.map(s => <SelectItem key={s} value={s} className="text-xs">{s.replace(/_/g," ")}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function BatchStatusSelect({ batch }: { batch: ProductionBatch }) {
  const { toast } = useToast();
  const mut = useMutation({
    mutationFn: (status: string) => apiRequest("PATCH", `/api/procurement/production-batches/${batch.id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurement/production-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/procurement/dashboard"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  return (
    <Select value={batch.status} onValueChange={s => mut.mutate(s)} disabled={mut.isPending}>
      <SelectTrigger className="h-6 text-[10px] w-36 border-0 p-1" data-testid={`batch-status-${batch.id}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {BATCH_STATUSES.map(s => <SelectItem key={s} value={s} className="text-xs">{s.replace(/_/g," ")}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ProcurementPage() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [poStatusFilter, setPoStatusFilter] = useState("all");
  const [batchStatusFilter, setBatchStatusFilter] = useState("all");
  const [selectedPoId, setSelectedPoId] = useState<number | null>(null);
  const [drilldownConfig, setDrilldownConfig] = useState<UniversalDrilldownConfig | null>(null);

  const { data: dashboard, isLoading: dashLoading } = useQuery<DashboardData>({
    queryKey: ["/api/procurement/dashboard"],
    queryFn: () => fetch("/api/procurement/dashboard", { credentials: "include" }).then(r => r.json()),
    staleTime: 30_000,
  });

  const poParams = poStatusFilter !== "all" ? `?status=${poStatusFilter}` : "";
  const { data: posData, isLoading: posLoading } = useQuery<{data: PurchaseOrder[]}>({
    queryKey: ["/api/procurement/purchase-orders", poStatusFilter],
    queryFn: () => fetch(`/api/procurement/purchase-orders${poParams}`, { credentials: "include" }).then(r => r.json()),
    staleTime: 30_000,
  });

  const batchParams = batchStatusFilter !== "all" ? `?status=${batchStatusFilter}` : "";
  const { data: batchesData, isLoading: batchesLoading } = useQuery<{data: ProductionBatch[]}>({
    queryKey: ["/api/procurement/production-batches", batchStatusFilter],
    queryFn: () => fetch(`/api/procurement/production-batches${batchParams}`, { credentials: "include" }).then(r => r.json()),
    staleTime: 30_000,
  });

  const { data: suppliersData } = useQuery<{data: Supplier[]}>({
    queryKey: ["/api/procurement/suppliers"],
    queryFn: () => fetch("/api/procurement/suppliers", { credentials: "include" }).then(r => r.json()),
  });

  const { data: partsData } = useQuery<{data: Part[]}>({
    queryKey: ["/api/procurement/parts"],
    queryFn: () => fetch("/api/procurement/parts", { credentials: "include" }).then(r => r.json()),
  });

  const { data: inventoryData } = useQuery<{data: any[]}>({
    queryKey: ["/api/procurement/inventory"],
    queryFn: () => fetch("/api/procurement/inventory", { credentials: "include" }).then(r => r.json()),
    staleTime: 30_000,
  });

  const { data: blockedData } = useQuery<{data: any[]}>({
    queryKey: ["/api/procurement/blocked-installs"],
    queryFn: () => fetch("/api/procurement/blocked-installs", { credentials: "include" }).then(r => r.json()),
    staleTime: 30_000,
  });

  const suppliers = suppliersData?.data ?? [];
  const parts     = partsData?.data ?? [];
  const pos       = posData?.data ?? [];
  const batches   = batchesData?.data ?? [];
  const inventory = inventoryData?.data ?? [];
  const blocked   = blockedData?.data ?? [];

  const dash = dashboard;

  return (
    <div className="flex-1 overflow-auto bg-background p-6 pb-36 lg:pb-24 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" data-testid="page-title">
            <Package className="h-5 w-5 text-primary" />
            Procurement & Manufacturing
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Hardware delivery operations — purchasing, production, inventory, and install readiness.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(dash?.pos.totalDelayed ?? 0) > 0 && (
            <span className="text-xs px-2 py-1 rounded-full border border-red-500/40 bg-red-500/10 text-red-400 font-medium">
              <AlertTriangle className="h-3 w-3 inline mr-1" />{dash!.pos.totalDelayed} delayed POs
            </span>
          )}
          {(dash?.batches.totalBlocked ?? 0) > 0 && (
            <span className="text-xs px-2 py-1 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-400 font-medium">
              <Factory className="h-3 w-3 inline mr-1" />{dash!.batches.totalBlocked} blocked batches
            </span>
          )}
        </div>
      </div>

      {/* Dashboard KPI strip */}
      {dashLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : dash && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3" data-testid="kpi-strip">
          {[
            { label: "Open POs",         value: dash.pos.totalOpen,         icon: Truck,       color: "",                                                                          metric: "procurement_open_pos" },
            { label: "Delayed POs",      value: dash.pos.totalDelayed,      icon: AlertTriangle, color: dash.pos.totalDelayed > 0 ? "text-red-400" : "",                          metric: "procurement_delayed_pos" },
            { label: "In Assembly",      value: dash.batches.byStatus.in_assembly?.count ?? 0, icon: Factory, color: "text-blue-400",                                             metric: "" },
            { label: "Ready to Ship",    value: dash.batches.totalReady,    icon: CheckCircle2, color: "text-emerald-400",                                                        metric: "" },
            { label: "Blocked Batches",  value: dash.batches.totalBlocked,  icon: XCircle,     color: dash.batches.totalBlocked > 0 ? "text-red-400" : "",                       metric: "procurement_blocked_batches" },
            { label: "SKU Locations",    value: dash.inventory.totalSkuLocations, icon: Boxes, color: "",                                                                         metric: "" },
            { label: "Available Stock",  value: Math.round(dash.inventory.totalAvailable), icon: Boxes, color: dash.inventory.totalAvailable < 0 ? "text-red-400" : "text-emerald-400", metric: "" },
            { label: "Blocked Installs", value: dash.blockedInstalls,       icon: Hammer,      color: dash.blockedInstalls > 0 ? "text-amber-400" : "",                           metric: "blocked_installs" },
          ].map(k => (
            <Card
              key={k.label}
              className={`border border-border/50 ${k.metric ? "cursor-pointer hover:border-primary/40 hover:bg-card/80 transition-all" : ""}`}
              data-testid={`kpi-${k.label.toLowerCase().replace(/\s/g,"-")}`}
              onClick={k.metric ? () => setDrilldownConfig({ metric: k.metric }) : undefined}
            >
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

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-8 bg-muted/40 p-1 gap-1">
          <TabsTrigger value="dashboard"   className="text-xs h-6" data-testid="tab-dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="pos"         className="text-xs h-6" data-testid="tab-pos">
            Purchase Orders {(dash?.pos.totalOpen ?? 0) > 0 && <Badge className="ml-1 text-[9px] px-1 py-0 bg-primary text-white">{dash!.pos.totalOpen}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="batches"     className="text-xs h-6" data-testid="tab-batches">Production</TabsTrigger>
          <TabsTrigger value="inventory"   className="text-xs h-6" data-testid="tab-inventory">Inventory</TabsTrigger>
          <TabsTrigger value="blocked"     className="text-xs h-6" data-testid="tab-blocked">
            Blocked Installs {(dash?.blockedInstalls ?? 0) > 0 && <Badge className="ml-1 text-[9px] px-1 py-0 bg-amber-500 text-white">{dash!.blockedInstalls}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="suppliers"   className="text-xs h-6" data-testid="tab-suppliers">Suppliers</TabsTrigger>
          <TabsTrigger value="parts"       className="text-xs h-6" data-testid="tab-parts">Parts</TabsTrigger>
        </TabsList>

        {/* ── Dashboard ─────────────────────────────────────────────────────── */}
        <TabsContent value="dashboard" className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* PO status breakdown */}
          <Card className="border border-border/50">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm flex items-center gap-2"><Truck className="h-4 w-4" />PO Status Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="pb-4 px-4">
              {dashLoading ? <Skeleton className="h-32" /> : (
                <div className="space-y-1.5">
                  {Object.entries(dash?.pos.byStatus ?? {}).map(([status, d]) => (
                    <div key={status} className="flex items-center gap-2 text-xs">
                      <StatusBadge status={status} map={PO_STATUS_COLOR} />
                      <div className="flex-1 h-1.5 bg-muted/40 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (d.count / Math.max(...Object.values(dash!.pos.byStatus).map(x => x.count))) * 100)}%` }} />
                      </div>
                      <span className="tabular-nums w-6 text-right">{d.count}</span>
                      <span className="tabular-nums w-16 text-right text-muted-foreground">{fmtAmt(d.value)}</span>
                    </div>
                  ))}
                  {!Object.keys(dash?.pos.byStatus ?? {}).length && <div className="text-xs text-muted-foreground text-center py-4">No purchase orders yet</div>}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Batch status breakdown */}
          <Card className="border border-border/50">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm flex items-center gap-2"><Factory className="h-4 w-4" />Production Pipeline</CardTitle>
            </CardHeader>
            <CardContent className="pb-4 px-4">
              {dashLoading ? <Skeleton className="h-32" /> : (
                <div className="space-y-1.5">
                  {Object.entries(dash?.batches.byStatus ?? {}).map(([status, d]) => (
                    <div key={status} className="flex items-center gap-2 text-xs">
                      <StatusBadge status={status} map={BATCH_STATUS_COLOR} />
                      <div className="flex-1 h-1.5 bg-muted/40 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (d.count / Math.max(...Object.values(dash!.batches.byStatus).map(x => x.count))) * 100)}%` }} />
                      </div>
                      <span className="tabular-nums w-6 text-right">{d.count}</span>
                      <span className="tabular-nums w-16 text-right text-muted-foreground">{d.qty} units</span>
                    </div>
                  ))}
                  {!Object.keys(dash?.batches.byStatus ?? {}).length && <div className="text-xs text-muted-foreground text-center py-4">No production batches yet</div>}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Delayed suppliers */}
          {(dash?.pos.delayedSuppliers ?? []).length > 0 && (
            <Card className="border border-red-500/30 bg-red-500/5">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm flex items-center gap-2 text-red-400">
                  <AlertTriangle className="h-4 w-4" />Delayed Suppliers
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-4 px-4">
                {dash!.pos.delayedSuppliers.map((s: any) => (
                  <div key={s.name} className="flex justify-between text-xs py-1 border-b border-border/20" data-testid={`delayed-supplier-${s.name}`}>
                    <span className="font-medium">{s.name}</span>
                    <Badge variant="outline" className="text-[10px] text-red-400 border-red-500/40">{s.delayed_pos} delayed</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Inventory summary */}
          <Card className="border border-border/50">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm flex items-center gap-2"><Boxes className="h-4 w-4" />Inventory Snapshot</CardTitle>
            </CardHeader>
            <CardContent className="pb-4 px-4">
              {[
                { label: "SKU Locations",  value: dash?.inventory.totalSkuLocations ?? 0 },
                { label: "On Hand",        value: (dash?.inventory.totalOnHand ?? 0).toFixed(0) + " units" },
                { label: "Allocated",      value: (dash?.inventory.totalAllocated ?? 0).toFixed(0) + " units" },
                { label: "Available",      value: (dash?.inventory.totalAvailable ?? 0).toFixed(0) + " units", alert: (dash?.inventory.totalAvailable ?? 0) < 0 },
                { label: "Shortfalls",     value: dash?.inventory.shortfallCount ?? 0, alert: (dash?.inventory.shortfallCount ?? 0) > 0 },
              ].map(k => (
                <div key={k.label} className="flex justify-between text-xs py-1.5 border-b border-border/20">
                  <span className="text-muted-foreground">{k.label}</span>
                  <span className={`font-semibold tabular-nums ${k.alert ? "text-red-400" : ""}`}>{k.value}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Purchase Orders ───────────────────────────────────────────────── */}
        <TabsContent value="pos" className="mt-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex gap-2 items-center">
              <Select value={poStatusFilter} onValueChange={setPoStatusFilter}>
                <SelectTrigger className="h-7 w-40 text-xs" data-testid="po-status-filter">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {PO_STATUSES.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g," ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <CreatePOButton suppliers={suppliers} />
          </div>

          <Card className="border border-border/50">
            <CardContent className="p-0 overflow-x-auto">
              {posLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : pos.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">No purchase orders found. Create one to get started.</div>
              ) : (
                <table className="w-full text-xs" data-testid="po-table">
                  <thead>
                    <tr className="border-b border-border/40">
                      {["PO #","Supplier","Status","Account","Expected","Amount","Lines"].map(h => (
                        <th key={h} className={`py-2 px-3 text-muted-foreground font-medium ${h === "PO #" ? "text-left" : "text-right"}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pos.map((po) => (
                      <Fragment key={po.id}>
                        <tr
                          className={`border-b border-border/20 hover:bg-muted/10 cursor-pointer ${selectedPoId === po.id ? "bg-muted/20" : ""}`}
                          onClick={() => setSelectedPoId(selectedPoId === po.id ? null : po.id)}
                          data-testid={`po-row-${po.id}`}>
                          <td className="py-2 px-3 font-mono font-medium">{po.po_number}</td>
                          <td className="py-2 px-3 text-right">{po.supplier_name ?? "—"}</td>
                          <td className="py-2 px-3 text-right" onClick={e => e.stopPropagation()}><POStatusSelect po={po} /></td>
                          <td className="py-2 px-3 text-right text-muted-foreground">{po.account_name ?? "—"}</td>
                          <td className="py-2 px-3 text-right text-muted-foreground">{fmtDate(po.expected_delivery_date)}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{fmtAmt(po.total_amount)}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{po.line_count ?? 0}</td>
                        </tr>
                        {selectedPoId === po.id && (
                          <tr className="border-b border-border/20 bg-muted/10">
                            <td colSpan={7} className="px-4 py-3">
                              <AttachmentsSection objectType="purchase_order" objectId={po.id} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Production Batches ────────────────────────────────────────────── */}
        <TabsContent value="batches" className="mt-3 space-y-3">
          <div className="flex items-center justify-between">
            <Select value={batchStatusFilter} onValueChange={setBatchStatusFilter}>
              <SelectTrigger className="h-7 w-40 text-xs" data-testid="batch-status-filter">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {BATCH_STATUSES.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g," ")}</SelectItem>)}
              </SelectContent>
            </Select>
            <CreateBatchButton parts={parts} />
          </div>

          <Card className="border border-border/50">
            <CardContent className="p-0 overflow-x-auto">
              {batchesLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : batches.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">No production batches. Create one to track assembly progress.</div>
              ) : (
                <table className="w-full text-xs" data-testid="batch-table">
                  <thead>
                    <tr className="border-b border-border/40">
                      {["Batch #","Part","Status","Qty","Account","Install","Target","Blockers"].map(h => (
                        <th key={h} className={`py-2 px-3 text-muted-foreground font-medium ${h === "Batch #" ? "text-left" : "text-right"}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((b) => (
                      <tr key={b.id} className={`border-b border-border/20 hover:bg-muted/10 ${b.status === "blocked" ? "bg-red-500/5" : ""}`} data-testid={`batch-row-${b.id}`}>
                        <td className="py-2 px-3 font-mono font-medium">{b.batch_number}</td>
                        <td className="py-2 px-3 text-right">{b.part_name ?? b.part_name ?? "—"}</td>
                        <td className="py-2 px-3 text-right"><BatchStatusSelect batch={b} /></td>
                        <td className="py-2 px-3 text-right tabular-nums">{b.quantity}</td>
                        <td className="py-2 px-3 text-right text-muted-foreground">{b.account_name ?? "—"}</td>
                        <td className="py-2 px-3 text-right text-muted-foreground max-w-32 truncate">{b.install_workflow_title ?? "—"}</td>
                        <td className="py-2 px-3 text-right text-muted-foreground">{fmtDate(b.target_completion_date)}</td>
                        <td className="py-2 px-3 text-right max-w-32">
                          {b.blockers ? <span className="text-red-400 truncate block">{b.blockers}</span> : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Inventory ─────────────────────────────────────────────────────── */}
        <TabsContent value="inventory" className="mt-3">
          <Card className="border border-border/50">
            <CardContent className="p-0 overflow-x-auto">
              {inventory.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">No inventory records yet.</div>
              ) : (
                <table className="w-full text-xs" data-testid="inventory-table">
                  <thead>
                    <tr className="border-b border-border/40">
                      {["Part","SKU","Supplier","Location","On Hand","Allocated","Reserved","Available"].map(h => (
                        <th key={h} className={`py-2 px-3 text-muted-foreground font-medium ${h === "Part" ? "text-left" : "text-right"}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.map((r: any) => {
                      const avail = parseFloat(r.quantity_available ?? (r.quantity_on_hand - r.quantity_allocated - r.quantity_reserved_cert));
                      return (
                        <tr key={r.id} className={`border-b border-border/20 hover:bg-muted/10 ${avail < 0 ? "bg-red-500/5" : ""}`} data-testid={`inventory-row-${r.id}`}>
                          <td className="py-2 px-3 font-medium">{r.part_name ?? "—"}</td>
                          <td className="py-2 px-3 text-right font-mono">{r.sku ?? "—"}</td>
                          <td className="py-2 px-3 text-right text-muted-foreground">{r.supplier_name ?? "—"}</td>
                          <td className="py-2 px-3 text-right">{r.location}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{r.quantity_on_hand}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{r.quantity_allocated}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{r.quantity_reserved_cert}</td>
                          <td className={`py-2 px-3 text-right tabular-nums font-medium ${avail < 0 ? "text-red-400" : avail === 0 ? "text-amber-400" : "text-emerald-400"}`}>{avail}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Blocked Installs ──────────────────────────────────────────────── */}
        <TabsContent value="blocked" className="mt-3 space-y-2">
          {blocked.length === 0 ? (
            <div className="p-8 text-center border border-border/40 rounded-lg">
              <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
              <div className="text-sm font-medium">No blocked installs</div>
              <div className="text-xs text-muted-foreground">All active install workflows have hardware on track.</div>
            </div>
          ) : blocked.map((r: any) => (
            <Card key={r.id} className="border border-amber-500/30 bg-amber-500/5" data-testid={`blocked-install-${r.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Hammer className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />
                      <span className="text-sm font-medium truncate">{r.title}</span>
                      <StatusBadge status={r.install_status} map={{}} />
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      {r.account_name && <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{r.account_name}</span>}
                      {r.owner_name   && <span className="flex items-center gap-1"><User className="h-3 w-3" />{r.owner_name}</span>}
                      {r.target_completion_date && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Due {fmtDate(r.target_completion_date)}</span>}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right space-y-1">
                    <div className="text-xs">
                      <span className="text-muted-foreground">Batches: </span>
                      <span className="font-medium">{r.ready_batches}/{r.total_batches} ready</span>
                    </div>
                    {r.delayed_pos > 0 && <div className="text-xs text-red-400">{r.delayed_pos} delayed PO{r.delayed_pos > 1 ? "s" : ""}</div>}
                    {r.blocked_batches > 0 && <div className="text-xs text-amber-400">{r.blocked_batches} blocked batch{r.blocked_batches > 1 ? "es" : ""}</div>}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* ── Suppliers ─────────────────────────────────────────────────────── */}
        <TabsContent value="suppliers" className="mt-3">
          <Card className="border border-border/50">
            <CardContent className="p-0 overflow-x-auto">
              {suppliers.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">No suppliers yet.</div>
              ) : (
                <table className="w-full text-xs" data-testid="supplier-table">
                  <thead>
                    <tr className="border-b border-border/40">
                      {["Name","Contact","Country","Lead Time","Status","POs"].map(h => (
                        <th key={h} className={`py-2 px-3 text-muted-foreground font-medium ${h === "Name" ? "text-left" : "text-right"}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {suppliers.map((s) => (
                      <tr key={s.id} className="border-b border-border/20 hover:bg-muted/10" data-testid={`supplier-row-${s.id}`}>
                        <td className="py-2 px-3 font-medium">{s.name}</td>
                        <td className="py-2 px-3 text-right text-muted-foreground">{(s as any).contact_name ?? "—"}</td>
                        <td className="py-2 px-3 text-right text-muted-foreground">{s.country ?? "—"}</td>
                        <td className="py-2 px-3 text-right">{s.lead_time_days ? `${s.lead_time_days}d` : "—"}</td>
                        <td className="py-2 px-3 text-right">
                          <span className={`text-[10px] border rounded-full px-2 py-0.5 ${s.status === "active" ? "border-emerald-500/40 text-emerald-400" : "border-border/40 text-muted-foreground"}`}>{s.status}</span>
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">{s.po_count ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Parts ─────────────────────────────────────────────────────────── */}
        <TabsContent value="parts" className="mt-3">
          <Card className="border border-border/50">
            <CardContent className="p-0 overflow-x-auto">
              {parts.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">No parts in catalog yet.</div>
              ) : (
                <table className="w-full text-xs" data-testid="parts-table">
                  <thead>
                    <tr className="border-b border-border/40">
                      {["SKU","Name","Category","Unit","Unit Cost","Supplier","Lead Time"].map(h => (
                        <th key={h} className={`py-2 px-3 text-muted-foreground font-medium ${h === "SKU" ? "text-left" : "text-right"}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parts.map((p) => (
                      <tr key={p.id} className="border-b border-border/20 hover:bg-muted/10" data-testid={`part-row-${p.id}`}>
                        <td className="py-2 px-3 font-mono font-medium">{p.sku}</td>
                        <td className="py-2 px-3 text-right">{p.name}</td>
                        <td className="py-2 px-3 text-right text-muted-foreground">{p.category ?? "—"}</td>
                        <td className="py-2 px-3 text-right">{p.unit}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{p.unit_cost ? fmtAmt(p.unit_cost) : "—"}</td>
                        <td className="py-2 px-3 text-right text-muted-foreground">{p.supplier_name ?? "—"}</td>
                        <td className="py-2 px-3 text-right">{p.lead_time_days ? `${p.lead_time_days}d` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <UniversalDrilldownSheet
        config={drilldownConfig}
        onClose={() => setDrilldownConfig(null)}
        endpoint="/api/operations/drilldown"
      />
    </div>
  );
}
