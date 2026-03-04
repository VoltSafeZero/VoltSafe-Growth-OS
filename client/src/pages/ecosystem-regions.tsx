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
import { Plus, Search, MapPin, Trash2 } from "lucide-react";
import type { EcosystemRegion } from "@shared/schema";

const STRATEGIC_IMPORTANCES = ["Low", "Medium", "High", "Critical"];

const importanceColors: Record<string, string> = {
  Low: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  Medium: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  High: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  Critical: "bg-red-500/10 text-red-500 border-red-500/20",
};

export default function EcosystemRegionsPage() {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<EcosystemRegion | null>(null);
  const { toast } = useToast();

  const { data: regions, isLoading } = useQuery<EcosystemRegion[]>({
    queryKey: ["/api/ecosystem/regions", { search }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const res = await fetch(`/api/ecosystem/regions?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/ecosystem/regions", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ecosystem/regions"] });
      setCreateOpen(false);
      toast({ title: "Region created" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
      const res = await apiRequest("PUT", `/api/ecosystem/regions/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ecosystem/regions"] });
      setSelected(null);
      toast({ title: "Region updated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/ecosystem/regions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ecosystem/regions"] });
      setSelected(null);
      toast({ title: "Region deleted" });
    },
  });

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-page-title">Ecosystem Regions</h1>
          <p className="text-muted-foreground mt-1 text-sm">Manage geographic regions and regulatory information.</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-primary-foreground" data-testid="button-create-region">
              <Plus className="mr-2 h-4 w-4" /> New Region
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Create Region</DialogTitle></DialogHeader>
            <RegionForm onSubmit={(d) => createMutation.mutate(d)} isPending={createMutation.isPending} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative w-full sm:max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search regions..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" data-testid="input-search-regions" />
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {regions?.map((region) => (
            <Card key={region.id} className="border-border/50 hover:border-primary/30 cursor-pointer transition-colors" onClick={() => setSelected(region)} data-testid={`card-region-${region.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <MapPin className="w-5 h-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-base truncate">{region.name}</CardTitle>
                      <p className="text-xs text-muted-foreground">{[region.stateProvince, region.country].filter(Boolean).join(", ") || "No location"}</p>
                    </div>
                  </div>
                  {region.strategicImportance && (
                    <Badge variant="outline" className={importanceColors[region.strategicImportance] || ""}>{region.strategicImportance}</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                  {region.numberOfMarinas != null && <span>{region.numberOfMarinas} marinas</span>}
                  {region.electricalCodeVersion && <span>Code: {region.electricalCodeVersion}</span>}
                </div>
              </CardContent>
            </Card>
          ))}
          {(!regions || regions.length === 0) && (
            <div className="col-span-full p-8 text-center text-muted-foreground">No regions found</div>
          )}
        </div>
      )}

      {selected && (
        <Dialog open onOpenChange={() => setSelected(null)}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Edit Region</DialogTitle></DialogHeader>
            <RegionForm
              initial={selected}
              onSubmit={(d) => updateMutation.mutate({ id: selected.id, data: d })}
              isPending={updateMutation.isPending}
            />
            <div className="flex justify-end pt-2">
              <Button variant="destructive" size="sm" onClick={() => deleteMutation.mutate(selected.id)} disabled={deleteMutation.isPending} data-testid="button-delete-region">
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function RegionForm({ initial, onSubmit, isPending }: { initial?: EcosystemRegion; onSubmit: (d: Record<string, unknown>) => void; isPending: boolean }) {
  const [form, setForm] = useState({
    name: initial?.name || "",
    country: initial?.country || "",
    stateProvince: initial?.stateProvince || "",
    numberOfMarinas: initial?.numberOfMarinas?.toString() || "",
    electricalCodeVersion: initial?.electricalCodeVersion || "",
    regulatoryNotes: initial?.regulatoryNotes || "",
    strategicImportance: initial?.strategicImportance || "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name: form.name,
      country: form.country || null,
      stateProvince: form.stateProvince || null,
      numberOfMarinas: form.numberOfMarinas ? parseInt(form.numberOfMarinas) : null,
      electricalCodeVersion: form.electricalCodeVersion || null,
      regulatoryNotes: form.regulatoryNotes || null,
      strategicImportance: form.strategicImportance || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label>Region Name *</Label>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="input-region-name" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Country</Label>
          <Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} data-testid="input-region-country" />
        </div>
        <div>
          <Label>State / Province</Label>
          <Input value={form.stateProvince} onChange={(e) => setForm({ ...form, stateProvince: e.target.value })} data-testid="input-region-state" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Number of Marinas</Label>
          <Input type="number" value={form.numberOfMarinas} onChange={(e) => setForm({ ...form, numberOfMarinas: e.target.value })} data-testid="input-region-marinas" />
        </div>
        <div>
          <Label>Strategic Importance</Label>
          <Select value={form.strategicImportance} onValueChange={(v) => setForm({ ...form, strategicImportance: v })}>
            <SelectTrigger data-testid="select-region-importance"><SelectValue placeholder="Select level" /></SelectTrigger>
            <SelectContent>
              {STRATEGIC_IMPORTANCES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label>Electrical Code Version</Label>
        <Input value={form.electricalCodeVersion} onChange={(e) => setForm({ ...form, electricalCodeVersion: e.target.value })} data-testid="input-region-code" />
      </div>
      <div>
        <Label>Regulatory Notes</Label>
        <Textarea value={form.regulatoryNotes} onChange={(e) => setForm({ ...form, regulatoryNotes: e.target.value })} data-testid="input-region-regulatory" />
      </div>
      <Button type="submit" disabled={isPending || !form.name} className="w-full" data-testid="button-submit-region">
        {isPending ? "Saving..." : initial ? "Update Region" : "Create Region"}
      </Button>
    </form>
  );
}
