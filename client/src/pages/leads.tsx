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
import { Plus, Search, ArrowRightLeft, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import type { Lead } from "@shared/schema";

const statusColors: Record<string, string> = {
  new: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  contacted: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  qualified: "bg-green-500/10 text-green-500 border-green-500/20",
  unqualified: "bg-red-500/10 text-red-500 border-red-500/20",
  converted: "bg-primary/10 text-primary border-primary/20",
};

export default function LeadsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const { toast } = useToast();

  const { data, isLoading } = useQuery<{ data: Lead[]; total: number; page: number; totalPages: number }>({
    queryKey: ["/api/leads", { search, status: statusFilter === "all" ? "" : statusFilter, page }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      params.set("page", String(page));
      const res = await fetch(`/api/leads?${params}`);
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, string>) => {
      const res = await apiRequest("POST", "/api/leads", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      setCreateOpen(false);
      toast({ title: "Lead created" });
    },
  });

  const convertMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/leads/${id}/convert`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      setSelectedLead(null);
      toast({ title: "Lead converted to Account" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/leads/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      setSelectedLead(null);
      toast({ title: "Lead deleted" });
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">Leads</h1>
          <p className="text-muted-foreground mt-1">Manage and convert your sales leads.</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-primary-foreground" data-testid="button-create-lead">
              <Plus className="mr-2 h-4 w-4" /> New Lead
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Create New Lead</DialogTitle>
            </DialogHeader>
            <CreateLeadForm onSubmit={(data) => createMutation.mutate(data)} isPending={createMutation.isPending} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search leads..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-10"
            data-testid="input-search-leads"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-40" data-testid="select-status-filter">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="contacted">Contacted</SelectItem>
            <SelectItem value="qualified">Qualified</SelectItem>
            <SelectItem value="unqualified">Unqualified</SelectItem>
            <SelectItem value="converted">Converted</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : (
        <Card className="border-border/50">
          <CardContent className="p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground">Company</th>
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground">Contact</th>
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground">Source</th>
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground">Status</th>
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground">Created</th>
                  <th className="text-right p-4 text-sm font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data?.data.map((lead) => (
                  <tr key={lead.id} className="border-b border-border/30 hover:bg-muted/30 cursor-pointer" onClick={() => setSelectedLead(lead)} data-testid={`row-lead-${lead.id}`}>
                    <td className="p-4 font-medium">{lead.company}</td>
                    <td className="p-4 text-sm">
                      <div>{lead.contactName}</div>
                      <div className="text-muted-foreground text-xs">{lead.contactEmail}</div>
                    </td>
                    <td className="p-4 text-sm text-muted-foreground">{lead.source || "—"}</td>
                    <td className="p-4">
                      <Badge variant="outline" className={statusColors[lead.status] || ""} data-testid={`badge-status-${lead.id}`}>
                        {lead.status}
                      </Badge>
                    </td>
                    <td className="p-4 text-sm text-muted-foreground">
                      {new Date(lead.createdAt).toLocaleDateString()}
                    </td>
                    <td className="p-4 text-right">
                      {lead.status !== "converted" && (
                        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); convertMutation.mutate(lead.id); }} data-testid={`button-convert-${lead.id}`}>
                          <ArrowRightLeft className="h-4 w-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {data?.data.length === 0 && (
                  <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No leads found</td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{data.total} leads total</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)} data-testid="button-prev-page">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm py-1 px-3">Page {page} of {data.totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage(p => p + 1)} data-testid="button-next-page">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {selectedLead && (
        <Dialog open={!!selectedLead} onOpenChange={() => setSelectedLead(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{selectedLead.company}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Contact</Label>
                  <p className="text-sm font-medium">{selectedLead.contactName}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Email</Label>
                  <p className="text-sm">{selectedLead.contactEmail || "—"}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Phone</Label>
                  <p className="text-sm">{selectedLead.contactPhone || "—"}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Source</Label>
                  <p className="text-sm">{selectedLead.source || "—"}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  <Badge variant="outline" className={statusColors[selectedLead.status] || ""}>{selectedLead.status}</Badge>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Next Step</Label>
                  <p className="text-sm">{selectedLead.nextStep || "—"}</p>
                </div>
              </div>
              {selectedLead.notes && (
                <div>
                  <Label className="text-xs text-muted-foreground">Notes</Label>
                  <p className="text-sm">{selectedLead.notes}</p>
                </div>
              )}
              <div className="flex gap-2 justify-end pt-4 border-t border-border/50">
                {selectedLead.status !== "converted" && (
                  <Button variant="outline" onClick={() => convertMutation.mutate(selectedLead.id)} disabled={convertMutation.isPending} data-testid="button-convert-detail">
                    <ArrowRightLeft className="mr-2 h-4 w-4" /> Convert to Account
                  </Button>
                )}
                <Button variant="destructive" size="sm" onClick={() => deleteMutation.mutate(selectedLead.id)} disabled={deleteMutation.isPending} data-testid="button-delete-lead">
                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function CreateLeadForm({ onSubmit, isPending }: { onSubmit: (data: Record<string, string>) => void; isPending: boolean }) {
  const [form, setForm] = useState({ company: "", contactName: "", contactEmail: "", contactPhone: "", source: "", notes: "" });

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(form); }} className="space-y-4">
      <div>
        <Label>Company *</Label>
        <Input value={form.company} onChange={(e) => setForm(f => ({ ...f, company: e.target.value }))} required data-testid="input-company" />
      </div>
      <div>
        <Label>Contact Name *</Label>
        <Input value={form.contactName} onChange={(e) => setForm(f => ({ ...f, contactName: e.target.value }))} required data-testid="input-contact-name" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Email</Label>
          <Input type="email" value={form.contactEmail} onChange={(e) => setForm(f => ({ ...f, contactEmail: e.target.value }))} data-testid="input-contact-email" />
        </div>
        <div>
          <Label>Phone</Label>
          <Input value={form.contactPhone} onChange={(e) => setForm(f => ({ ...f, contactPhone: e.target.value }))} data-testid="input-contact-phone" />
        </div>
      </div>
      <div>
        <Label>Source</Label>
        <Input value={form.source} onChange={(e) => setForm(f => ({ ...f, source: e.target.value }))} placeholder="e.g. Website, Referral, Trade Show" data-testid="input-source" />
      </div>
      <div>
        <Label>Notes</Label>
        <Textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} data-testid="input-notes" />
      </div>
      <Button type="submit" className="w-full bg-primary text-primary-foreground" disabled={isPending} data-testid="button-submit-lead">
        {isPending ? "Creating..." : "Create Lead"}
      </Button>
    </form>
  );
}
