import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { UserCircle, Plus, Search, MoreHorizontal, Mail, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const ROLE_TYPES = [
  "Decision Maker","Partner","Associate","Analyst","Angel","Connector",
  "Advisor","Government Officer","Grant Officer","Other",
];
const INFLUENCE_LEVELS  = ["High","Medium","Low"];
const REL_STRENGTHS     = ["Cold","Light","Warm","Strong","Champion"];

type Contact = {
  id: number; investor_id: number | null; first_name: string; last_name: string | null;
  full_name: string | null; title: string | null; email: string | null; phone: string | null;
  linkedin_url: string | null; role_type: string; influence_level: string;
  relationship_strength: string; notes: string | null; last_touch_at: string | null;
  next_step: string | null; next_step_date: string | null;
  investor_name?: string | null;
};

const BLANK: Partial<Contact> & { first_name: string } = {
  first_name: "", role_type: "Other", influence_level: "Medium", relationship_strength: "Cold",
};

export default function CapitalContacts() {
  const { toast } = useToast();
  const [search, setSearch]           = useState("");
  const [roleFilter, setRoleFilter]   = useState("all");
  const [creating, setCreating]       = useState(false);
  const [editing, setEditing]         = useState<Contact | null>(null);
  const [form, setForm]               = useState<typeof BLANK>({ ...BLANK });

  const { data: investors = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/capital/investors", "dropdown"],
    queryFn: () => fetch("/api/capital/investors").then(r => r.json()),
  });

  const qk = ["/api/capital/contacts", search, roleFilter];
  const { data: contacts = [], isLoading } = useQuery<Contact[]>({
    queryKey: qk,
    queryFn: () => {
      const p = new URLSearchParams();
      if (search)           p.set("search", search);
      if (roleFilter !== "all") p.set("role_type", roleFilter);
      return fetch(`/api/capital/contacts?${p}`).then(r => r.json());
    },
  });

  const createMut = useMutation({
    mutationFn: (d: any) => apiRequest("POST", "/api/capital/contacts", d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/capital/contacts"] });
      setCreating(false); setForm({ ...BLANK }); toast({ title: "Contact added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.message, variant: "destructive" }),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PATCH", `/api/capital/contacts/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/capital/contacts"] });
      setEditing(null); toast({ title: "Contact updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.message, variant: "destructive" }),
  });

  function ff(key: string, val: any) { setForm(prev => ({ ...prev, [key]: val })); }
  function openEdit(c: Contact) { setEditing(c); setForm({ ...c }); }

  function handleSubmit() {
    if (!form.first_name?.trim()) { toast({ title: "First name is required", variant: "destructive" }); return; }
    if (editing) updateMut.mutate({ id: editing.id, data: { ...form } });
    else createMut.mutate({ ...form });
  }

  function relBadge(r: string) {
    if (r === "Champion") return "bg-emerald-500/15 text-emerald-400";
    if (r === "Strong")   return "bg-cyan-500/15 text-cyan-400";
    if (r === "Warm")     return "bg-amber-500/15 text-amber-400";
    return "bg-muted text-muted-foreground";
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="px-6 py-4 border-b border-border/40 shrink-0 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <UserCircle className="w-5 h-5 text-primary" /> Investor Contacts
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">{contacts.length} contact{contacts.length !== 1 ? "s" : ""}</p>
        </div>
        <Button size="sm" onClick={() => { setForm({ ...BLANK }); setCreating(true); }} data-testid="btn-add-contact">
          <Plus className="w-4 h-4 mr-1.5" /> Add Contact
        </Button>
      </div>

      <div className="px-6 py-3 border-b border-border/30 flex flex-wrap gap-2 shrink-0">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="Search contacts…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-sm" data-testid="input-contact-search" />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="h-8 text-sm w-[160px]"><SelectValue placeholder="Role type" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All roles</SelectItem>{ROLE_TYPES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32"><div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" /></div>
        ) : contacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center">
            <UserCircle className="w-8 h-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">No contacts yet. Add your first investor contact.</p>
          </div>
        ) : (
          <table className="w-full text-sm" data-testid="contacts-table">
            <thead>
              <tr className="border-b border-border/30 text-xs text-muted-foreground">
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium hidden md:table-cell">Investor</th>
                <th className="text-left px-4 py-2 font-medium">Role</th>
                <th className="text-left px-4 py-2 font-medium hidden lg:table-cell">Relationship</th>
                <th className="text-left px-4 py-2 font-medium hidden xl:table-cell">Contact</th>
                <th className="px-4 py-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {contacts.map(c => (
                <tr key={c.id} className="border-b border-border/20 hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => openEdit(c)} data-testid={`row-contact-${c.id}`}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-foreground">{c.full_name || `${c.first_name} ${c.last_name || ""}`.trim()}</p>
                    {c.title && <p className="text-xs text-muted-foreground">{c.title}</p>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground hidden md:table-cell">{c.investor_name || "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{c.role_type}</td>
                  <td className="px-4 py-2.5 hidden lg:table-cell">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${relBadge(c.relationship_strength)}`}>{c.relationship_strength}</span>
                  </td>
                  <td className="px-4 py-2.5 hidden xl:table-cell text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      {c.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{c.email}</span>}
                      {c.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{c.phone}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0"><MoreHorizontal className="w-3.5 h-3.5" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(c)}>Edit</DropdownMenuItem>
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
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit Contact" : "Add Contact"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div>
              <Label>First Name *</Label>
              <Input value={form.first_name ?? ""} onChange={e => ff("first_name", e.target.value)} placeholder="First name" className="mt-1" data-testid="input-contact-first-name" />
            </div>
            <div>
              <Label>Last Name</Label>
              <Input value={form.last_name ?? ""} onChange={e => ff("last_name", e.target.value)} placeholder="Last name" className="mt-1" />
            </div>
            <div className="col-span-2">
              <Label>Title</Label>
              <Input value={form.title ?? ""} onChange={e => ff("title", e.target.value)} placeholder="Partner, Associate, GP…" className="mt-1" />
            </div>
            <div className="col-span-2">
              <Label>Linked Investor</Label>
              <Select value={String(form.investor_id ?? "")} onValueChange={v => ff("investor_id", v ? Number(v) : null)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Link to investor…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">— None —</SelectItem>
                  {investors.map((i: any) => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Role Type</Label>
              <Select value={form.role_type ?? "Other"} onValueChange={v => ff("role_type", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{ROLE_TYPES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Influence Level</Label>
              <Select value={form.influence_level ?? "Medium"} onValueChange={v => ff("influence_level", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{INFLUENCE_LEVELS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Relationship Strength</Label>
              <Select value={form.relationship_strength ?? "Cold"} onValueChange={v => ff("relationship_strength", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{REL_STRENGTHS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={form.email ?? ""} onChange={e => ff("email", e.target.value)} placeholder="name@fund.com" className="mt-1" />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={form.phone ?? ""} onChange={e => ff("phone", e.target.value)} placeholder="+1 416…" className="mt-1" />
            </div>
            <div className="col-span-2">
              <Label>LinkedIn</Label>
              <Input value={form.linkedin_url ?? ""} onChange={e => ff("linkedin_url", e.target.value)} placeholder="https://linkedin.com/in/…" className="mt-1" />
            </div>
            <div className="col-span-2">
              <Label>Next Step</Label>
              <Input value={form.next_step ?? ""} onChange={e => ff("next_step", e.target.value)} placeholder="Next action for this contact…" className="mt-1" />
            </div>
            <div className="col-span-2">
              <Label>Notes</Label>
              <Textarea value={form.notes ?? ""} onChange={e => ff("notes", e.target.value)} placeholder="Relationship context, background…" className="mt-1" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreating(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMut.isPending || updateMut.isPending} data-testid="btn-submit-contact">
              {createMut.isPending || updateMut.isPending ? "Saving…" : editing ? "Save Changes" : "Add Contact"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
