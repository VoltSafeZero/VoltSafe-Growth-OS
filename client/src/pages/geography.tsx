import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Globe, Map, Building2, Users, Zap, TrendingUp, Plus, X, Edit3,
  CheckCircle2, AlertCircle, MapPin, Layers, Target, BarChart3,
  ChevronRight, Package, RefreshCcw, Star, Search,
} from "lucide-react";

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmt(n: number | string | null | undefined, prefix = "") {
  const v = Number(n ?? 0);
  if (v >= 1_000_000) return `${prefix}${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${prefix}${(v / 1_000).toFixed(1)}K`;
  return `${prefix}${v.toLocaleString()}`;
}

const REGION_COLORS: Record<string, string> = {
  "British Columbia": "bg-blue-500/15 text-blue-400 border-blue-500/30",
  "Ontario": "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  "California": "bg-orange-500/15 text-orange-400 border-orange-500/30",
  "Florida": "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  "Washington": "bg-purple-500/15 text-purple-400 border-purple-500/30",
  "Unassigned": "bg-muted/40 text-muted-foreground border-border/40",
};

function regionBadge(region: string) {
  const cls = REGION_COLORS[region] ?? "bg-primary/10 text-primary border-primary/20";
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>{region}</span>;
}

// ── Saved View chips ───────────────────────────────────────────────────────────
const SAVED_VIEWS = [
  { label: "Ontario Marinas", region: "Ontario", country: "Canada" },
  { label: "SoCal Pipeline", region: "California", country: "United States" },
  { label: "BC Live Customers", region: "British Columbia", country: "Canada" },
  { label: "Great Lakes", region: "Michigan", country: "United States" },
  { label: "Atlantic Canada", region: "Nova Scotia", country: "Canada" },
  { label: "Pacific Northwest", region: "Washington", country: "United States" },
];

// ── Region Overview Card ───────────────────────────────────────────────────────
function RegionCard({ r, onClick, active }: { r: any; onClick: () => void; active: boolean }) {
  return (
    <button
      onClick={onClick}
      data-testid={`card-region-${r.region}`}
      className={`w-full text-left rounded-lg border p-4 transition-all hover:border-primary/40 hover:bg-accent/30 ${
        active ? "border-primary/60 bg-accent/40" : "border-border/40 bg-card"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{r.region}</div>
          {r.arr > 0 && <div className="text-xs text-muted-foreground mt-0.5">{fmt(r.arr, "$")} ARR</div>}
        </div>
        <MapPin className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        <Stat icon={Building2} label="Accounts" value={r.accounts} />
        <Stat icon={Users} label="Leads" value={r.leads} />
        <Stat icon={Layers} label="Deploys" value={r.deployments} />
        <Stat icon={CheckCircle2} label="Live" value={r.customers} />
      </div>
    </button>
  );
}

function Stat({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-semibold ml-auto">{value}</span>
    </div>
  );
}

// ── Territory Form ─────────────────────────────────────────────────────────────
function TerritoryForm({ initial, onSave, onCancel }: { initial?: any; onSave: (data: any) => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    code: initial?.code ?? "",
    status: initial?.status ?? "active",
    regions: initial?.regions ?? "",
    countries: initial?.countries ?? "",
    color: initial?.color ?? "",
    notes: initial?.notes ?? "",
  });
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div className="space-y-4 p-4 border border-border/40 rounded-lg bg-card">
      <div className="text-sm font-semibold">{initial ? "Edit Territory" : "New Territory"}</div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1">
          <Label className="text-xs">Territory Name *</Label>
          <Input data-testid="input-territory-name" placeholder="e.g. British Columbia" value={form.name} onChange={e => set("name", e.target.value)} className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Code</Label>
          <Input data-testid="input-territory-code" placeholder="e.g. BC" value={form.code} onChange={e => set("code", e.target.value)} className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <Select value={form.status} onValueChange={v => set("status", v)}>
            <SelectTrigger className="h-8 text-sm" data-testid="select-territory-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2 space-y-1">
          <Label className="text-xs">Regions / States Covered</Label>
          <Input data-testid="input-territory-regions" placeholder="e.g. British Columbia, Alberta, Yukon" value={form.regions} onChange={e => set("regions", e.target.value)} className="h-8 text-sm" />
        </div>
        <div className="col-span-2 space-y-1">
          <Label className="text-xs">Countries</Label>
          <Input data-testid="input-territory-countries" placeholder="e.g. Canada, United States" value={form.countries} onChange={e => set("countries", e.target.value)} className="h-8 text-sm" />
        </div>
        <div className="col-span-2 space-y-1">
          <Label className="text-xs">Notes</Label>
          <Input data-testid="input-territory-notes" placeholder="Optional notes" value={form.notes} onChange={e => set("notes", e.target.value)} className="h-8 text-sm" />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} data-testid="button-territory-cancel">Cancel</Button>
        <Button size="sm" onClick={() => form.name && onSave(form)} disabled={!form.name} data-testid="button-territory-save">
          {initial ? "Save" : "Create Territory"}
        </Button>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function GeographyPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("overview");
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [savedView, setSavedView] = useState<{ region: string; country: string } | null>(null);
  const [showNewTerritory, setShowNewTerritory] = useState(false);
  const [editingTerritory, setEditingTerritory] = useState<any | null>(null);
  const [regionSearch, setRegionSearch] = useState("");
  const [geoTab, setGeoTab] = useState<"accounts" | "leads">("accounts");

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: overview, isLoading: ovLoading } = useQuery<any>({
    queryKey: ["/api/analytics/geo/overview"],
  });
  const { data: territories, isLoading: terrLoading } = useQuery<any[]>({
    queryKey: ["/api/territories"],
  });
  const { data: terrDetails } = useQuery<any[]>({
    queryKey: ["/api/analytics/geo/territories"],
  });
  const { data: whitespace, isLoading: wsLoading } = useQuery<any>({
    queryKey: ["/api/analytics/geo/whitespace"],
  });
  const { data: winRate } = useQuery<any[]>({
    queryKey: ["/api/analytics/geo/win-rate"],
  });
  const { data: geoAccounts, isLoading: geoAccLoading } = useQuery<any[]>({
    queryKey: ["/api/analytics/geo/accounts", savedView?.region, savedView?.country],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (savedView?.region) params.set("region", savedView.region);
      if (savedView?.country) params.set("country", savedView.country);
      const r = await fetch(`/api/analytics/geo/accounts?${params}`, { credentials: "include" });
      return r.json();
    },
    enabled: !!savedView && geoTab === "accounts",
  });
  const { data: geoLeads, isLoading: geoLeadsLoading } = useQuery<any[]>({
    queryKey: ["/api/analytics/geo/leads", savedView?.region, savedView?.country],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (savedView?.region) params.set("region", savedView.region);
      if (savedView?.country) params.set("country", savedView.country);
      const r = await fetch(`/api/analytics/geo/leads?${params}`, { credentials: "include" });
      return r.json();
    },
    enabled: !!savedView && geoTab === "leads",
  });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const createTerritory = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/territories", data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/territories"] }); qc.invalidateQueries({ queryKey: ["/api/analytics/geo/territories"] }); setShowNewTerritory(false); toast({ title: "Territory created" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const updateTerritory = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PATCH", `/api/territories/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/territories"] }); qc.invalidateQueries({ queryKey: ["/api/analytics/geo/territories"] }); setEditingTerritory(null); toast({ title: "Territory updated" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const deleteTerritory = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/territories/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/territories"] }); qc.invalidateQueries({ queryKey: ["/api/analytics/geo/territories"] }); toast({ title: "Territory deleted" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Derived ────────────────────────────────────────────────────────────────
  const regions: any[] = (overview?.regions ?? []).filter((r: any) =>
    !regionSearch || r.region.toLowerCase().includes(regionSearch.toLowerCase())
  );
  const totals = overview?.totals ?? {};
  const selectedRegionData = regions.find(r => r.region === selectedRegion);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="border-b border-border/50 px-6 py-4 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Globe className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Territory & Geo Intelligence</h1>
            <p className="text-xs text-muted-foreground">Geographic coverage, territories, and whitespace</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["/api/analytics/geo"] })} data-testid="button-geo-refresh">
            <RefreshCcw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
          <Button size="sm" onClick={() => { setTab("territories"); setShowNewTerritory(true); }} data-testid="button-new-territory">
            <Plus className="h-3.5 w-3.5 mr-1" /> New Territory
          </Button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-5 divide-x divide-border/40 border-b border-border/50 shrink-0">
        {[
          { label: "Regions", value: overview?.regionCount ?? 0, icon: MapPin },
          { label: "Accounts", value: totals.accounts ?? 0, icon: Building2 },
          { label: "Active Leads", value: totals.leads ?? 0, icon: Users },
          { label: "Deployments", value: totals.deployments ?? 0, icon: Layers },
          { label: "Live Customers", value: totals.customers ?? 0, icon: CheckCircle2 },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="px-5 py-3 flex items-center gap-3">
            <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
            <div>
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="text-lg font-semibold leading-tight" data-testid={`kpi-${label.toLowerCase().replace(" ", "-")}`}>
                {ovLoading ? <Skeleton className="h-5 w-10" /> : fmt(value)}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 min-h-0">
        <TabsList className="h-9 px-4 gap-1 border-b border-border/50 rounded-none w-full justify-start shrink-0 bg-transparent">
          {[
            { value: "overview", label: "Region Overview", icon: Map },
            { value: "territories", label: "Territories", icon: Target },
            { value: "whitespace", label: "Whitespace", icon: AlertCircle },
            { value: "analytics", label: "Analytics", icon: BarChart3 },
            { value: "saved-views", label: "Saved Views", icon: Star },
          ].map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value} className="text-xs h-7 gap-1.5 data-[state=active]:bg-accent" data-testid={`tab-geo-${value}`}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── Overview Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="overview" className="flex-1 min-h-0 m-0 p-0">
          <div className="flex h-full min-h-0">
            {/* Region list */}
            <div className="w-80 border-r border-border/50 flex flex-col min-h-0">
              <div className="p-3 border-b border-border/30">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Filter regions..."
                    value={regionSearch}
                    onChange={e => setRegionSearch(e.target.value)}
                    className="pl-8 h-7 text-xs"
                    data-testid="input-region-search"
                  />
                </div>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-3 space-y-2">
                  {ovLoading ? (
                    Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-lg" />)
                  ) : regions.length === 0 ? (
                    <div className="text-xs text-muted-foreground text-center py-8">No regions found</div>
                  ) : (
                    regions.map((r: any) => (
                      <RegionCard
                        key={r.region}
                        r={r}
                        active={selectedRegion === r.region}
                        onClick={() => setSelectedRegion(selectedRegion === r.region ? null : r.region)}
                      />
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* Region detail pane */}
            <div className="flex-1 min-w-0 p-6">
              {!selectedRegionData ? (
                <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                    <Globe className="w-7 h-7 text-primary" />
                  </div>
                  <div>
                    <div className="font-semibold text-base">Select a region</div>
                    <div className="text-sm text-muted-foreground mt-1 max-w-xs">
                      Click any region card to see its breakdown — accounts, leads, deployments, and live customers.
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 justify-center mt-2">
                    {SAVED_VIEWS.slice(0, 4).map(v => (
                      <Button key={v.label} variant="outline" size="sm" className="text-xs"
                        onClick={() => { setTab("saved-views"); setSavedView(v); }} data-testid={`chip-saved-${v.label}`}>
                        {v.label}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-6 max-w-2xl">
                  <div className="flex items-center gap-3">
                    {regionBadge(selectedRegionData.region)}
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Region Detail</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {[
                      { label: "Accounts", value: selectedRegionData.accounts, icon: Building2, color: "text-blue-400" },
                      { label: "Active Leads", value: selectedRegionData.leads, icon: Users, color: "text-emerald-400" },
                      { label: "Deployments", value: selectedRegionData.deployments, icon: Layers, color: "text-orange-400" },
                      { label: "Live", value: selectedRegionData.customers, icon: Zap, color: "text-primary" },
                    ].map(({ label, value, icon: Icon, color }) => (
                      <Card key={label} className="border-border/40">
                        <CardContent className="pt-4 pb-3">
                          <Icon className={`h-5 w-5 ${color} mb-2`} />
                          <div className="text-2xl font-bold">{value}</div>
                          <div className="text-xs text-muted-foreground">{label}</div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                  {selectedRegionData.arr > 0 && (
                    <Card className="border-border/40">
                      <CardContent className="pt-4 pb-3">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="h-4 w-4 text-primary" />
                          <span className="text-sm text-muted-foreground">Annual Recurring Revenue</span>
                          <span className="text-base font-semibold ml-auto">{fmt(selectedRegionData.arr, "$")}</span>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => { setSavedView({ region: selectedRegionData.region, country: "" }); setTab("saved-views"); setGeoTab("accounts"); }}
                      data-testid="button-view-region-accounts">
                      <Building2 className="h-3.5 w-3.5 mr-1" /> View Accounts
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { setSavedView({ region: selectedRegionData.region, country: "" }); setTab("saved-views"); setGeoTab("leads"); }}
                      data-testid="button-view-region-leads">
                      <Users className="h-3.5 w-3.5 mr-1" /> View Leads
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── Territories Tab ───────────────────────────────────────────────── */}
        <TabsContent value="territories" className="flex-1 min-h-0 m-0 p-6">
          <div className="space-y-4 max-w-4xl">
            {showNewTerritory && (
              <TerritoryForm
                onSave={data => createTerritory.mutate(data)}
                onCancel={() => setShowNewTerritory(false)}
              />
            )}
            {!showNewTerritory && (
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-muted-foreground">{territories?.length ?? 0} territories</div>
                <Button size="sm" onClick={() => setShowNewTerritory(true)} data-testid="button-add-territory">
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Territory
                </Button>
              </div>
            )}
            <div className="border border-border/40 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/30">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Territory</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Coverage</th>
                    <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground">Accounts</th>
                    <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground">Leads</th>
                    <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground">Customers</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">ARR</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {terrLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i}><td colSpan={7} className="px-4 py-3"><Skeleton className="h-5 w-full" /></td></tr>
                    ))
                  ) : !territories?.length ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-xs text-muted-foreground">
                        No territories yet. Create one to start organizing your coverage.
                      </td>
                    </tr>
                  ) : territories.map(t => {
                    const detail = terrDetails?.find(d => d.id === t.id);
                    return editingTerritory?.id === t.id ? (
                      <tr key={t.id}>
                        <td colSpan={7} className="px-4 py-3">
                          <TerritoryForm
                            initial={editingTerritory}
                            onSave={data => updateTerritory.mutate({ id: t.id, data })}
                            onCancel={() => setEditingTerritory(null)}
                          />
                        </td>
                      </tr>
                    ) : (
                      <tr key={t.id} className="hover:bg-accent/20" data-testid={`row-territory-${t.id}`}>
                        <td className="px-4 py-3">
                          <div className="font-medium text-sm">{t.name}</div>
                          {t.code && <div className="text-xs text-muted-foreground">{t.code}</div>}
                          <Badge variant={t.status === "active" ? "default" : "secondary"} className="mt-1 text-[10px] h-4 px-1.5">{t.status}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          {t.regions ? (
                            <div className="text-xs text-muted-foreground max-w-[180px] truncate">{t.regions}</div>
                          ) : (
                            <span className="text-xs text-muted-foreground/40 italic">None specified</span>
                          )}
                          {t.countries && <div className="text-xs text-muted-foreground/60">{t.countries}</div>}
                        </td>
                        <td className="px-4 py-3 text-center font-medium">{Number(t.account_count ?? 0)}</td>
                        <td className="px-4 py-3 text-center font-medium">{Number(t.lead_count ?? 0)}</td>
                        <td className="px-4 py-3 text-center font-medium">{Number(detail?.customer_count ?? 0)}</td>
                        <td className="px-4 py-3 text-right font-medium text-primary">{fmt(detail?.total_arr ?? 0, "$")}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 justify-end">
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditingTerritory(t)} data-testid={`button-edit-territory-${t.id}`}>
                              <Edit3 className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6 hover:text-destructive" onClick={() => deleteTerritory.mutate(t.id)} data-testid={`button-delete-territory-${t.id}`}>
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* ── Whitespace Tab ────────────────────────────────────────────────── */}
        <TabsContent value="whitespace" className="flex-1 min-h-0 m-0 p-6">
          <div className="space-y-6 max-w-4xl">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <AlertCircle className="h-4 w-4 text-amber-400" />
                <h2 className="text-sm font-semibold">Leads Without Matched Accounts</h2>
                <Badge variant="secondary" className="ml-auto">{whitespace?.leadsWithoutAccounts?.length ?? 0}</Badge>
              </div>
              {wsLoading ? <Skeleton className="h-32 w-full rounded-lg" /> : (
                <div className="border border-border/40 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/40 bg-muted/30">
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Region / State</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Country</th>
                        <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground">Leads</th>
                        <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground">Type</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {!whitespace?.leadsWithoutAccounts?.length ? (
                        <tr><td colSpan={4} className="px-4 py-8 text-center text-xs text-muted-foreground">No whitespace leads found</td></tr>
                      ) : whitespace.leadsWithoutAccounts.map((r: any, i: number) => (
                        <tr key={i} className="hover:bg-accent/20" data-testid={`row-whitespace-lead-${i}`}>
                          <td className="px-4 py-3">{regionBadge(r.region)}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{r.country ?? "—"}</td>
                          <td className="px-4 py-3 text-center font-semibold">{Number(r.lead_count)}</td>
                          <td className="px-4 py-3 text-center"><Badge variant="outline" className="text-[10px]">No Accounts</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <Separator />
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Package className="h-4 w-4 text-orange-400" />
                <h2 className="text-sm font-semibold">Accounts Without Deployments</h2>
                <Badge variant="secondary" className="ml-auto">{whitespace?.accountsWithoutDeployments?.length ?? 0}</Badge>
              </div>
              {wsLoading ? <Skeleton className="h-32 w-full rounded-lg" /> : (
                <div className="border border-border/40 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/40 bg-muted/30">
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Region / State</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Country</th>
                        <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground">Accounts</th>
                        <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground">Type</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {!whitespace?.accountsWithoutDeployments?.length ? (
                        <tr><td colSpan={4} className="px-4 py-8 text-center text-xs text-muted-foreground">All regions have deployment coverage</td></tr>
                      ) : whitespace.accountsWithoutDeployments.map((r: any, i: number) => (
                        <tr key={i} className="hover:bg-accent/20" data-testid={`row-whitespace-account-${i}`}>
                          <td className="px-4 py-3">{regionBadge(r.region)}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{r.country ?? "—"}</td>
                          <td className="px-4 py-3 text-center font-semibold">{Number(r.account_count)}</td>
                          <td className="px-4 py-3 text-center"><Badge variant="outline" className="text-[10px]">No Deploys</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── Analytics Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="analytics" className="flex-1 min-h-0 m-0 p-6">
          <div className="space-y-6 max-w-4xl">
            <div>
              <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" /> Win Rate by Region
              </h2>
              <div className="border border-border/40 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/40 bg-muted/30">
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Region</th>
                      <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground">Won</th>
                      <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground">Lost</th>
                      <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground">Win Rate</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Won Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {!winRate?.length ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-xs text-muted-foreground">No closed opportunities found</td></tr>
                    ) : winRate.map((r: any) => (
                      <tr key={r.region} className="hover:bg-accent/20" data-testid={`row-winrate-${r.region}`}>
                        <td className="px-4 py-3">{regionBadge(r.region)}</td>
                        <td className="px-4 py-3 text-center text-emerald-400 font-medium">{r.won}</td>
                        <td className="px-4 py-3 text-center text-red-400 font-medium">{r.lost}</td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <div className="h-1.5 w-20 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-primary rounded-full" style={{ width: `${r.win_rate}%` }} />
                            </div>
                            <span className="text-xs font-medium">{r.win_rate}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-primary">{fmt(r.won_revenue, "$")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── Saved Views Tab ───────────────────────────────────────────────── */}
        <TabsContent value="saved-views" className="flex-1 min-h-0 m-0 p-0">
          <div className="flex h-full min-h-0">
            {/* View chips sidebar */}
            <div className="w-64 border-r border-border/50 p-4 flex flex-col gap-2 shrink-0">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Quick Views</div>
              {SAVED_VIEWS.map(v => (
                <button
                  key={v.label}
                  onClick={() => setSavedView(v)}
                  data-testid={`button-savedview-${v.label.replace(/\s+/g, "-")}`}
                  className={`w-full text-left px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                    savedView?.label === v.label
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/40 text-muted-foreground"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    {v.label}
                  </div>
                  <div className="text-[10px] text-muted-foreground/60 pl-5 mt-0.5">{v.country}</div>
                </button>
              ))}
            </div>

            {/* View content */}
            <div className="flex-1 min-w-0 flex flex-col min-h-0">
              {!savedView ? (
                <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-6">
                  <Star className="h-8 w-8 text-muted-foreground/40" />
                  <div>
                    <div className="font-semibold text-base">Select a saved view</div>
                    <div className="text-sm text-muted-foreground mt-1">Pick a region from the list to see filtered accounts and leads</div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="px-5 pt-4 pb-3 border-b border-border/50 flex items-center gap-3 shrink-0">
                    <MapPin className="h-4 w-4 text-primary" />
                    <div>
                      <div className="font-semibold text-sm">{savedView.label ?? savedView.region}</div>
                      <div className="text-xs text-muted-foreground">{savedView.country}</div>
                    </div>
                    <div className="flex gap-1 ml-auto">
                      <Button size="sm" variant={geoTab === "accounts" ? "default" : "ghost"} className="h-7 text-xs" onClick={() => setGeoTab("accounts")} data-testid="button-geo-accounts-tab">
                        <Building2 className="h-3 w-3 mr-1" /> Accounts
                      </Button>
                      <Button size="sm" variant={geoTab === "leads" ? "default" : "ghost"} className="h-7 text-xs" onClick={() => setGeoTab("leads")} data-testid="button-geo-leads-tab">
                        <Users className="h-3 w-3 mr-1" /> Leads
                      </Button>
                    </div>
                  </div>
                  <ScrollArea className="flex-1">
                    <div className="p-4">
                      {geoTab === "accounts" ? (
                        geoAccLoading ? (
                          <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
                        ) : !geoAccounts?.length ? (
                          <div className="text-center py-12 text-sm text-muted-foreground">No accounts in this region</div>
                        ) : (
                          <div className="space-y-2">
                            {geoAccounts.map((a: any) => (
                              <div key={a.id} className="flex items-center gap-3 border border-border/40 rounded-lg p-3 hover:bg-accent/20" data-testid={`row-geo-account-${a.id}`}>
                                <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm truncate">{a.name}</div>
                                  <div className="text-xs text-muted-foreground">{[a.city, a.state_province, a.country].filter(Boolean).join(", ")}</div>
                                </div>
                                {a.territory_name && <Badge variant="outline" className="text-[10px]">{a.territory_name}</Badge>}
                                <Badge variant="secondary" className="text-[10px]">{a.lead_status}</Badge>
                              </div>
                            ))}
                          </div>
                        )
                      ) : (
                        geoLeadsLoading ? (
                          <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
                        ) : !geoLeads?.length ? (
                          <div className="text-center py-12 text-sm text-muted-foreground">No leads in this region</div>
                        ) : (
                          <div className="space-y-2">
                            {geoLeads.map((l: any) => (
                              <div key={l.id} className="flex items-center gap-3 border border-border/40 rounded-lg p-3 hover:bg-accent/20" data-testid={`row-geo-lead-${l.id}`}>
                                <Users className="h-4 w-4 text-muted-foreground shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm truncate">{l.company}</div>
                                  <div className="text-xs text-muted-foreground">{[l.city, l.state, l.country].filter(Boolean).join(", ")}</div>
                                </div>
                                {l.territory_name && <Badge variant="outline" className="text-[10px]">{l.territory_name}</Badge>}
                                <Badge variant="secondary" className="text-[10px]">{l.status}</Badge>
                                {l.deal_amount && <span className="text-xs font-medium text-primary">{fmt(l.deal_amount, "$")}</span>}
                              </div>
                            ))}
                          </div>
                        )
                      )}
                    </div>
                  </ScrollArea>
                </>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
