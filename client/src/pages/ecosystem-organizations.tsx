import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Building2, Globe, Trash2 } from "lucide-react";
import type { EcosystemOrganization } from "@shared/schema";

const ORG_TYPES = ["Marina", "Marina Group", "Association", "Company", "Government", "OEM", "Distributor"];
const STRATEGIC_TIERS = ["Tier 1", "Tier 2", "Tier 3"];

const tierColors: Record<string, string> = {
  "Tier 1": "bg-green-500/10 text-green-500 border-green-500/20",
  "Tier 2": "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  "Tier 3": "bg-gray-500/10 text-gray-500 border-gray-500/20",
};

export default function EcosystemOrganizationsPage() {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<EcosystemOrganization | null>(null);
  const { toast } = useToast();

  const { data: orgs, isLoading } = useQuery<EcosystemOrganization[]>({
    queryKey: ["/api/ecosystem/organizations", { search }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const res = await fetch(`/api/ecosystem/organizations?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/ecosystem/organizations", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ecosystem/organizations"] });
      setCreateOpen(false);
      toast({ title: "Account created" });
    },
    onError: (err: any) => { toast({ title: "Error", description: err?.message || "Failed to create organization", variant: "destructive" }); },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
      const res = await apiRequest("PUT", `/api/ecosystem/organizations/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ecosystem/organizations"] });
      setSelected(null);
      toast({ title: "Account updated" });
    },
    onError: (err: any) => { toast({ title: "Error", description: err?.message || "Failed to update organization", variant: "destructive" }); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/ecosystem/organizations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ecosystem/organizations"] });
      setSelected(null);
      toast({ title: "Account deleted" });
    },
    onError: (err: any) => { toast({ title: "Error", description: err?.message || "Failed to delete organization", variant: "destructive" }); },
  });

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-page-title">Ecosystem Accounts</h1>
          <p className="text-muted-foreground mt-1 text-sm">Manage accounts in the VoltSafe ecosystem.</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-primary-foreground" data-testid="button-create-org">
              <Plus className="mr-2 h-4 w-4" /> New Account
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Create Account</DialogTitle></DialogHeader>
            <OrgForm onSubmit={(d) => createMutation.mutate(d)} isPending={createMutation.isPending} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative w-full sm:max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search organizations..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" data-testid="input-search-orgs" />
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {orgs?.map((org) => (
            <Card key={org.id} className="border-border/50 hover:border-primary/30 cursor-pointer transition-colors" onClick={() => setSelected(org)} data-testid={`card-org-${org.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Building2 className="w-5 h-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-base truncate">{org.name}</CardTitle>
                      <p className="text-xs text-muted-foreground">{[org.region, org.country].filter(Boolean).join(", ") || "No location"}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {org.organizationType && <Badge variant="outline">{org.organizationType}</Badge>}
                    {org.strategicTier && <Badge variant="outline" className={tierColors[org.strategicTier] || ""}>{org.strategicTier}</Badge>}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <div className="flex items-center gap-3 flex-wrap">
                    {org.marinasOrLocations != null && <span>{org.marinasOrLocations} locations</span>}
                    {org.totalSlipCount != null && <span>{org.totalSlipCount} slips</span>}
                  </div>
                  {org.influenceScore != null && <span>Score: {org.influenceScore}</span>}
                </div>
              </CardContent>
            </Card>
          ))}
          {(!orgs || orgs.length === 0) && (
            <div className="col-span-full p-8 text-center text-muted-foreground">No organizations found</div>
          )}
        </div>
      )}

      {selected && (
        <Dialog open onOpenChange={() => setSelected(null)}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Account</DialogTitle>
            </DialogHeader>
            <OrgForm
              initial={selected}
              onSubmit={(d) => updateMutation.mutate({ id: selected.id, data: d })}
              isPending={updateMutation.isPending}
            />
            <div className="flex justify-end pt-2">
              <Button variant="destructive" size="sm" onClick={() => deleteMutation.mutate(selected.id)} disabled={deleteMutation.isPending} data-testid="button-delete-org">
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function OrgForm({ initial, onSubmit, isPending }: { initial?: EcosystemOrganization; onSubmit: (d: Record<string, unknown>) => void; isPending: boolean }) {
  const [form, setForm] = useState({
    name: initial?.name || "",
    organizationType: initial?.organizationType || "",
    region: initial?.region || "",
    country: initial?.country || "",
    website: initial?.website || "",
    marinasOrLocations: initial?.marinasOrLocations?.toString() || "",
    totalSlipCount: initial?.totalSlipCount?.toString() || "",
    strategicTier: initial?.strategicTier || "",
    influenceScore: initial?.influenceScore?.toString() || "",
    notes: initial?.notes || "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name: form.name,
      organizationType: form.organizationType || null,
      region: form.region || null,
      country: form.country || null,
      website: form.website || null,
      marinasOrLocations: form.marinasOrLocations ? parseInt(form.marinasOrLocations) : null,
      totalSlipCount: form.totalSlipCount ? parseInt(form.totalSlipCount) : null,
      strategicTier: form.strategicTier || null,
      influenceScore: form.influenceScore ? parseInt(form.influenceScore) : null,
      notes: form.notes || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label>Name *</Label>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="input-org-name" />
      </div>
      <div>
        <Label>Account Type</Label>
        <Select value={form.organizationType} onValueChange={(v) => setForm({ ...form, organizationType: v })}>
          <SelectTrigger data-testid="select-org-type"><SelectValue placeholder="Select type" /></SelectTrigger>
          <SelectContent>
            {ORG_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Region</Label>
          <Input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} data-testid="input-org-region" />
        </div>
        <div>
          <Label>Country</Label>
          <Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} data-testid="input-org-country" />
        </div>
      </div>
      <div>
        <Label>Website</Label>
        <Input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} data-testid="input-org-website" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Marinas / Locations</Label>
          <Input type="number" value={form.marinasOrLocations} onChange={(e) => setForm({ ...form, marinasOrLocations: e.target.value })} data-testid="input-org-locations" />
        </div>
        <div>
          <Label>Total Slip Count</Label>
          <Input type="number" value={form.totalSlipCount} onChange={(e) => setForm({ ...form, totalSlipCount: e.target.value })} data-testid="input-org-slips" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Strategic Tier</Label>
          <Select value={form.strategicTier} onValueChange={(v) => setForm({ ...form, strategicTier: v })}>
            <SelectTrigger data-testid="select-org-tier"><SelectValue placeholder="Select tier" /></SelectTrigger>
            <SelectContent>
              {STRATEGIC_TIERS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Influence Score</Label>
          <Input type="number" value={form.influenceScore} onChange={(e) => setForm({ ...form, influenceScore: e.target.value })} data-testid="input-org-influence" />
        </div>
      </div>
      <div>
        <Label>Notes</Label>
        <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="input-org-notes" />
      </div>
      <Button type="submit" disabled={isPending || !form.name} className="w-full" data-testid="button-submit-org">
        {isPending ? "Saving..." : initial ? "Update Account" : "Create Account"}
      </Button>
    </form>
  );
}
