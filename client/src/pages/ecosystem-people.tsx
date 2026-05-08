import { useState } from "react";
import { EmailAutocompleteInput } from "@/components/email/email-autocomplete";
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
import { Plus, Search, User, Trash2, Mail, Phone, Linkedin } from "lucide-react";
import type { EcosystemPerson } from "@shared/schema";

const ROLE_TYPES = ["Executive", "Harbourmaster", "Director", "Engineer", "Investor"];
const RELATIONSHIP_STRENGTHS = ["Weak", "Moderate", "Strong"];

const strengthColors: Record<string, string> = {
  Weak: "bg-red-500/10 text-red-500 border-red-500/20",
  Moderate: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  Strong: "bg-green-500/10 text-green-500 border-green-500/20",
};

export default function EcosystemPeoplePage() {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<EcosystemPerson | null>(null);
  const { toast } = useToast();

  const { data: people, isLoading } = useQuery<EcosystemPerson[]>({
    queryKey: ["/api/ecosystem/people", { search }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const res = await fetch(`/api/ecosystem/people?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/ecosystem/people", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ecosystem/people"] });
      setCreateOpen(false);
      toast({ title: "Person created" });
    },
    onError: (err: any) => { toast({ title: "Error", description: err?.message || "Failed to create person", variant: "destructive" }); },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
      const res = await apiRequest("PUT", `/api/ecosystem/people/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ecosystem/people"] });
      setSelected(null);
      toast({ title: "Person updated" });
    },
    onError: (err: any) => { toast({ title: "Error", description: err?.message || "Failed to update person", variant: "destructive" }); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/ecosystem/people/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ecosystem/people"] });
      setSelected(null);
      toast({ title: "Person deleted" });
    },
    onError: (err: any) => { toast({ title: "Error", description: err?.message || "Failed to delete person", variant: "destructive" }); },
  });

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-page-title">Ecosystem People</h1>
          <p className="text-muted-foreground mt-1 text-sm">Manage key contacts in the ecosystem.</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-primary-foreground" data-testid="button-create-person">
              <Plus className="mr-2 h-4 w-4" /> New Person
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Create Person</DialogTitle></DialogHeader>
            <PersonForm onSubmit={(d) => createMutation.mutate(d)} isPending={createMutation.isPending} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative w-full sm:max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search people..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" data-testid="input-search-people" />
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {people?.map((person) => (
            <Card key={person.id} className="border-border/50 hover:border-primary/30 cursor-pointer transition-colors" onClick={() => setSelected(person)} data-testid={`card-person-${person.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <User className="w-5 h-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-base truncate">{person.fullName}</CardTitle>
                      <p className="text-xs text-muted-foreground truncate">{person.title || person.organizationName || "No title"}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {person.roleType && <Badge variant="outline">{person.roleType}</Badge>}
                    {person.relationshipStrength && <Badge variant="outline" className={strengthColors[person.relationshipStrength] || ""}>{person.relationshipStrength}</Badge>}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                  {person.organizationName && <span>{person.organizationName}</span>}
                  {person.influenceScore != null && <span>Score: {person.influenceScore}</span>}
                </div>
                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                  {person.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{person.email}</span>}
                  {person.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{person.phone}</span>}
                </div>
              </CardContent>
            </Card>
          ))}
          {(!people || people.length === 0) && (
            <div className="col-span-full p-8 text-center text-muted-foreground">No people found</div>
          )}
        </div>
      )}

      {selected && (
        <Dialog open onOpenChange={() => setSelected(null)}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Edit Person</DialogTitle></DialogHeader>
            <PersonForm
              initial={selected}
              onSubmit={(d) => updateMutation.mutate({ id: selected.id, data: d })}
              isPending={updateMutation.isPending}
            />
            <div className="flex justify-end pt-2">
              <Button variant="destructive" size="sm" onClick={() => deleteMutation.mutate(selected.id)} disabled={deleteMutation.isPending} data-testid="button-delete-person">
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function PersonForm({ initial, onSubmit, isPending }: { initial?: EcosystemPerson; onSubmit: (d: Record<string, unknown>) => void; isPending: boolean }) {
  const [form, setForm] = useState({
    fullName: initial?.fullName || "",
    title: initial?.title || "",
    organizationId: initial?.organizationId?.toString() || "",
    organizationName: initial?.organizationName || "",
    roleType: initial?.roleType || "",
    linkedinProfile: initial?.linkedinProfile || "",
    email: initial?.email || "",
    phone: initial?.phone || "",
    influenceScore: initial?.influenceScore?.toString() || "",
    relationshipStrength: initial?.relationshipStrength || "",
    notes: initial?.notes || "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      fullName: form.fullName,
      title: form.title || null,
      organizationId: form.organizationId ? parseInt(form.organizationId) : null,
      organizationName: form.organizationName || null,
      roleType: form.roleType || null,
      linkedinProfile: form.linkedinProfile || null,
      email: form.email || null,
      phone: form.phone || null,
      influenceScore: form.influenceScore ? parseInt(form.influenceScore) : null,
      relationshipStrength: form.relationshipStrength || null,
      notes: form.notes || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label>Full Name *</Label>
        <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required data-testid="input-person-name" />
      </div>
      <div>
        <Label>Title</Label>
        <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-person-title" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Account Name</Label>
          <Input value={form.organizationName} onChange={(e) => setForm({ ...form, organizationName: e.target.value })} data-testid="input-person-org" />
        </div>
        <div>
          <Label>Account ID</Label>
          <Input type="number" value={form.organizationId} onChange={(e) => setForm({ ...form, organizationId: e.target.value })} data-testid="input-person-org-id" />
        </div>
      </div>
      <div>
        <Label>Role Type</Label>
        <Select value={form.roleType} onValueChange={(v) => setForm({ ...form, roleType: v })}>
          <SelectTrigger data-testid="select-person-role"><SelectValue placeholder="Select role" /></SelectTrigger>
          <SelectContent>
            {ROLE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Email</Label>
          <EmailAutocompleteInput value={form.email ?? ""} onChange={(v) => setForm({ ...form, email: v })} data-testid="input-person-email" />
        </div>
        <div>
          <Label>Phone</Label>
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="input-person-phone" />
        </div>
      </div>
      <div>
        <Label>LinkedIn Profile</Label>
        <Input value={form.linkedinProfile} onChange={(e) => setForm({ ...form, linkedinProfile: e.target.value })} data-testid="input-person-linkedin" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Relationship Strength</Label>
          <Select value={form.relationshipStrength} onValueChange={(v) => setForm({ ...form, relationshipStrength: v })}>
            <SelectTrigger data-testid="select-person-strength"><SelectValue placeholder="Select strength" /></SelectTrigger>
            <SelectContent>
              {RELATIONSHIP_STRENGTHS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Influence Score</Label>
          <Input type="number" value={form.influenceScore} onChange={(e) => setForm({ ...form, influenceScore: e.target.value })} data-testid="input-person-influence" />
        </div>
      </div>
      <div>
        <Label>Notes</Label>
        <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="input-person-notes" />
      </div>
      <Button type="submit" disabled={isPending || !form.fullName} className="w-full" data-testid="button-submit-person">
        {isPending ? "Saving..." : initial ? "Update Person" : "Create Person"}
      </Button>
    </form>
  );
}
