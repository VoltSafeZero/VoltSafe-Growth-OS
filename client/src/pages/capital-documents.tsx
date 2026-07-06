import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { FileText, Plus, MoreHorizontal, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const DOC_TYPES = [
  "Pitch Deck","One-Pager","Financial Model","Cap Table","Use of Funds",
  "Investor Memo","Technical Overview","Patent Summary","Product Roadmap",
  "Pilot Summary","Customer Pipeline","Grant Budget","Grant Workplan",
  "Letter of Support","Board Materials","Due Diligence Doc","Other",
];
const DOC_STATUSES = ["Draft","Ready","Shared","Needs Update","Archived"];

function statusBadge(s: string) {
  if (s === "Ready")  return "bg-emerald-500/15 text-emerald-400";
  if (s === "Shared") return "bg-blue-500/15 text-blue-400";
  if (s === "Needs Update") return "bg-amber-500/15 text-amber-400";
  if (s === "Archived") return "bg-muted text-muted-foreground";
  return "bg-secondary text-secondary-foreground";
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

type CapDoc = {
  id: number;
  document_name: string;
  document_type: string;
  version: string | null;
  status: string;
  last_updated_at: string;
  funder_name: string | null;
  shared_with_funder_id: number | null;
  shared_at: string | null;
  notes: string | null;
};

type FormState = Partial<CapDoc> & { document_name: string };
const BLANK: FormState = { document_name: "", document_type: "Pitch Deck", status: "Draft" };

export default function CapitalDocuments() {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing]   = useState<CapDoc | null>(null);
  const [form, setForm] = useState<FormState>(BLANK);

  const { data: funders = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/capital/funders"],
    queryFn: () => fetch("/api/capital/funders").then(r => r.json()),
  });

  const { data: docs = [], isLoading } = useQuery<CapDoc[]>({
    queryKey: ["/api/capital/documents", q],
    queryFn: () => fetch("/api/capital/documents").then(r => r.json()),
  });

  const filtered = docs.filter(d =>
    !q || d.document_name.toLowerCase().includes(q.toLowerCase()) || (d.document_type ?? "").toLowerCase().includes(q.toLowerCase())
  );

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/capital/documents", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/capital/documents"] }); setCreating(false); setForm(BLANK); toast({ title: "Document added" }); },
    onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PATCH", `/api/capital/documents/${id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/capital/documents"] }); setEditing(null); toast({ title: "Document updated" }); },
    onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/capital/documents/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/capital/documents"] }); toast({ title: "Document deleted" }); },
    onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }),
  });

  function sf(key: keyof FormState, val: any) { setForm(prev => ({ ...prev, [key]: val })); }

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="px-6 py-4 border-b border-border/40 shrink-0 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" /> Capital Documents
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">{filtered.length} document{filtered.length !== 1 ? "s" : ""}</p>
        </div>
        <Button size="sm" onClick={() => { setForm(BLANK); setCreating(true); }} data-testid="btn-add-document">
          <Plus className="w-4 h-4 mr-1.5" /> Add Document
        </Button>
      </div>

      <div className="px-6 py-3 border-b border-border/30 shrink-0">
        <div className="relative max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="Search documents…" value={q} onChange={e => setQ(e.target.value)} className="pl-8 h-8 text-sm" />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center">
            <FileText className="w-8 h-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">No documents yet. Add pitch decks, financial models, and diligence docs here.</p>
          </div>
        ) : (
          <table className="w-full text-sm" data-testid="documents-table">
            <thead>
              <tr className="border-b border-border/30 text-xs text-muted-foreground">
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium hidden md:table-cell">Type</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium hidden lg:table-cell">Version</th>
                <th className="text-left px-4 py-2 font-medium hidden xl:table-cell">Shared With</th>
                <th className="text-left px-4 py-2 font-medium hidden lg:table-cell">Last Updated</th>
                <th className="px-4 py-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => (
                <tr key={d.id} className="border-b border-border/20 hover:bg-muted/20 cursor-pointer" onClick={() => { setEditing(d); setForm({ ...d }); }} data-testid={`row-doc-${d.id}`}>
                  <td className="px-4 py-2.5 font-medium text-foreground">{d.document_name}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground hidden md:table-cell">{d.document_type}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${statusBadge(d.status)}`}>{d.status}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground hidden lg:table-cell">{d.version ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground hidden xl:table-cell">{d.funder_name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground hidden lg:table-cell">{fmtDate(d.last_updated_at)}</td>
                  <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0"><MoreHorizontal className="w-3.5 h-3.5" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => { setEditing(d); setForm({ ...d }); }}>Edit</DropdownMenuItem>
                        <DropdownMenuItem className="text-red-400" onClick={() => deleteMutation.mutate(d.id)}>Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={creating || !!editing} onOpenChange={v => !v && (setCreating(false), setEditing(null))}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Edit Document" : "Add Document"}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Document Name *</Label>
              <Input value={form.document_name ?? ""} onChange={e => sf("document_name", e.target.value)} placeholder="e.g. Series A Pitch Deck v3" className="mt-1" data-testid="input-doc-name" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type</Label>
                <Select value={form.document_type ?? "Other"} onValueChange={v => sf("document_type", v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{DOC_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status ?? "Draft"} onValueChange={v => sf("status", v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{DOC_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Version</Label>
                <Input value={form.version ?? ""} onChange={e => sf("version", e.target.value)} placeholder="v1, v2.1…" className="mt-1" />
              </div>
              <div>
                <Label>Shared With Investor</Label>
                <Select value={String(form.shared_with_funder_id ?? "")} onValueChange={v => sf("shared_with_funder_id", v ? Number(v) : null)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {funders.map(f => <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={form.notes ?? ""} onChange={e => sf("notes", e.target.value)} placeholder="Notes on this document…" className="mt-1" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreating(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={() => {
              if (!form.document_name?.trim()) { toast({ title: "Name required", variant: "destructive" }); return; }
              editing ? updateMutation.mutate({ id: editing.id, data: form }) : createMutation.mutate(form);
            }} disabled={createMutation.isPending || updateMutation.isPending} data-testid="btn-submit-doc">
              {createMutation.isPending || updateMutation.isPending ? "Saving…" : editing ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
