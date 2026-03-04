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
import { Plus, Search, Link2, Trash2, ArrowRight } from "lucide-react";
import type { EcosystemRelationship } from "@shared/schema";

const ENTITY_TYPES = ["organization", "person", "partner"];
const RELATIONSHIP_TYPES = [
  "Member Of", "Partner With", "Uses Software", "Distributor Of",
  "Investor In", "Pilot Customer", "OEM Integration", "Licensing Partner",
  "Government Program", "Research Collaboration",
];
const STRATEGIC_IMPORTANCES = ["Low", "Medium", "High", "Critical"];

const importanceColors: Record<string, string> = {
  Low: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  Medium: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  High: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  Critical: "bg-red-500/10 text-red-500 border-red-500/20",
};

export default function EcosystemRelationshipsPage() {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<EcosystemRelationship | null>(null);
  const { toast } = useToast();

  const { data: relationships, isLoading } = useQuery<EcosystemRelationship[]>({
    queryKey: ["/api/ecosystem/relationships", { search }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const res = await fetch(`/api/ecosystem/relationships?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/ecosystem/relationships", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ecosystem/relationships"] });
      setCreateOpen(false);
      toast({ title: "Relationship created" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
      const res = await apiRequest("PUT", `/api/ecosystem/relationships/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ecosystem/relationships"] });
      setSelected(null);
      toast({ title: "Relationship updated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/ecosystem/relationships/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ecosystem/relationships"] });
      setSelected(null);
      toast({ title: "Relationship deleted" });
    },
  });

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-page-title">Ecosystem Relationships</h1>
          <p className="text-muted-foreground mt-1 text-sm">Map connections between organizations, people, and partners.</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-primary-foreground" data-testid="button-create-relationship">
              <Plus className="mr-2 h-4 w-4" /> New Relationship
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Create Relationship</DialogTitle></DialogHeader>
            <RelationshipForm onSubmit={(d) => createMutation.mutate(d)} isPending={createMutation.isPending} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative w-full sm:max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search relationships..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" data-testid="input-search-relationships" />
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {relationships?.map((rel) => (
            <Card key={rel.id} className="border-border/50 hover:border-primary/30 cursor-pointer transition-colors" onClick={() => setSelected(rel)} data-testid={`card-relationship-${rel.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Link2 className="w-5 h-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-sm truncate">{rel.sourceEntityName || `${rel.sourceEntityType} #${rel.sourceEntityId}`}</CardTitle>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <ArrowRight className="h-3 w-3 shrink-0" />
                        <span className="truncate">{rel.targetEntityName || `${rel.targetEntityType} #${rel.targetEntityId}`}</span>
                      </div>
                    </div>
                  </div>
                  {rel.strategicImportance && (
                    <Badge variant="outline" className={importanceColors[rel.strategicImportance] || ""}>{rel.strategicImportance}</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 flex-wrap">
                  {rel.relationshipType && <Badge variant="outline">{rel.relationshipType}</Badge>}
                  {rel.startDate && <span className="text-xs text-muted-foreground">Since {new Date(rel.startDate).toLocaleDateString()}</span>}
                </div>
              </CardContent>
            </Card>
          ))}
          {(!relationships || relationships.length === 0) && (
            <div className="col-span-full p-8 text-center text-muted-foreground">No relationships found</div>
          )}
        </div>
      )}

      {selected && (
        <Dialog open onOpenChange={() => setSelected(null)}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Edit Relationship</DialogTitle></DialogHeader>
            <RelationshipForm
              initial={selected}
              onSubmit={(d) => updateMutation.mutate({ id: selected.id, data: d })}
              isPending={updateMutation.isPending}
            />
            <div className="flex justify-end pt-2">
              <Button variant="destructive" size="sm" onClick={() => deleteMutation.mutate(selected.id)} disabled={deleteMutation.isPending} data-testid="button-delete-relationship">
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function RelationshipForm({ initial, onSubmit, isPending }: { initial?: EcosystemRelationship; onSubmit: (d: Record<string, unknown>) => void; isPending: boolean }) {
  const [form, setForm] = useState({
    sourceEntityType: initial?.sourceEntityType || "",
    sourceEntityId: initial?.sourceEntityId?.toString() || "",
    sourceEntityName: initial?.sourceEntityName || "",
    targetEntityType: initial?.targetEntityType || "",
    targetEntityId: initial?.targetEntityId?.toString() || "",
    targetEntityName: initial?.targetEntityName || "",
    relationshipType: initial?.relationshipType || "",
    startDate: initial?.startDate ? new Date(initial.startDate).toISOString().split("T")[0] : "",
    strategicImportance: initial?.strategicImportance || "",
    notes: initial?.notes || "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      sourceEntityType: form.sourceEntityType,
      sourceEntityId: parseInt(form.sourceEntityId),
      sourceEntityName: form.sourceEntityName || null,
      targetEntityType: form.targetEntityType,
      targetEntityId: parseInt(form.targetEntityId),
      targetEntityName: form.targetEntityName || null,
      relationshipType: form.relationshipType || null,
      startDate: form.startDate ? new Date(form.startDate).toISOString() : null,
      strategicImportance: form.strategicImportance || null,
      notes: form.notes || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Source Entity Type *</Label>
          <Select value={form.sourceEntityType} onValueChange={(v) => setForm({ ...form, sourceEntityType: v })}>
            <SelectTrigger data-testid="select-source-type"><SelectValue placeholder="Select type" /></SelectTrigger>
            <SelectContent>
              {ENTITY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Source Entity ID *</Label>
          <Input type="number" value={form.sourceEntityId} onChange={(e) => setForm({ ...form, sourceEntityId: e.target.value })} required data-testid="input-source-id" />
        </div>
      </div>
      <div>
        <Label>Source Entity Name</Label>
        <Input value={form.sourceEntityName} onChange={(e) => setForm({ ...form, sourceEntityName: e.target.value })} data-testid="input-source-name" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Target Entity Type *</Label>
          <Select value={form.targetEntityType} onValueChange={(v) => setForm({ ...form, targetEntityType: v })}>
            <SelectTrigger data-testid="select-target-type"><SelectValue placeholder="Select type" /></SelectTrigger>
            <SelectContent>
              {ENTITY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Target Entity ID *</Label>
          <Input type="number" value={form.targetEntityId} onChange={(e) => setForm({ ...form, targetEntityId: e.target.value })} required data-testid="input-target-id" />
        </div>
      </div>
      <div>
        <Label>Target Entity Name</Label>
        <Input value={form.targetEntityName} onChange={(e) => setForm({ ...form, targetEntityName: e.target.value })} data-testid="input-target-name" />
      </div>
      <div>
        <Label>Relationship Type</Label>
        <Select value={form.relationshipType} onValueChange={(v) => setForm({ ...form, relationshipType: v })}>
          <SelectTrigger data-testid="select-relationship-type"><SelectValue placeholder="Select type" /></SelectTrigger>
          <SelectContent>
            {RELATIONSHIP_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Start Date</Label>
          <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} data-testid="input-rel-start-date" />
        </div>
        <div>
          <Label>Strategic Importance</Label>
          <Select value={form.strategicImportance} onValueChange={(v) => setForm({ ...form, strategicImportance: v })}>
            <SelectTrigger data-testid="select-rel-importance"><SelectValue placeholder="Select level" /></SelectTrigger>
            <SelectContent>
              {STRATEGIC_IMPORTANCES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label>Notes</Label>
        <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="input-rel-notes" />
      </div>
      <Button type="submit" disabled={isPending || !form.sourceEntityType || !form.sourceEntityId || !form.targetEntityType || !form.targetEntityId} className="w-full" data-testid="button-submit-relationship">
        {isPending ? "Saving..." : initial ? "Update Relationship" : "Create Relationship"}
      </Button>
    </form>
  );
}
