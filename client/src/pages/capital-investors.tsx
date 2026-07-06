import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Users, Plus, Search, MoreHorizontal, AlertTriangle, DollarSign, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export const INVESTOR_TYPES = [
  "Angel","HNW Angel","Family Office","Venture Capital","Strategic Investor",
  "Government Investment","Grant / Non-Dilutive","Debt / Loan","Connector / Referrer",
];
export const PIPELINE_STAGES = [
  "Target Identified","Intro Needed","Intro Made","First Meeting","Follow-Up",
  "Diligence","Partner Meeting","Soft Commit","Committed","Wired / Closed","Passed",
];
const PRIORITIES = ["Critical","High","Medium","Low"];
const DATA_ROOM_STATUSES = ["Not Shared","Shared - NDA Required","NDA Signed","Full Access"];

export function fmtMoney(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v}`;
}
function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}
export function stageColor(s: string) {
  if (["Committed","Wired / Closed"].includes(s)) return "text-emerald-400";
  if (s === "Soft Commit")                        return "text-cyan-400";
  if (["Diligence","Partner Meeting"].includes(s)) return "text-violet-400";
  if (s === "Passed")                             return "text-muted-foreground";
  return "text-foreground";
}
function priorityBadge(p: string) {
  if (p === "Critical") return "bg-red-600/20 text-red-400";
  if (p === "High")     return "bg-red-500/15 text-red-400";
  if (p === "Medium")   return "bg-amber-500/15 text-amber-400";
  return "bg-muted text-muted-foreground";
}

export type Investor = {
  id: number; name: string; investor_type: string; status: string; priority: string;
  stage: string; check_size_min: number | null; check_size_max: number | null;
  currency: string; probability: number | null; source: string | null;
  introducer_name: string | null; website: string | null; country: string | null;
  region: string | null; strategic_relevance: string | null; thesis_fit: string | null;
  notes: string | null; last_touch_at: string | null; next_step: string | null;
  next_step_date: string | null; data_room_status: string; can_write_cheque: boolean;
  contacts?: any[]; commitments?: any[]; activities?: any[];
};

const BLANK: Partial<Investor> & { name: string } = {
  name: "", investor_type: "Venture Capital", status: "Active", priority: "Medium",
  stage: "Target Identified", currency: "CAD", data_room_status: "Not Shared",
};

export default function CapitalInvestors() {
  const { toast } = useToast();
  const [search, setSearch]           = useState("");
  const [typeFilter, setTypeFilter]   = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [cwcFilter, setCwcFilter]     = useState("all");
  const [creating, setCreating]       = useState(false);
  const [editing, setEditing]         = useState<Investor | null>(null);
  const [detail, setDetail]           = useState<number | null>(null);
  const [form, setForm]               = useState<typeof BLANK>({ ...BLANK });

  const qk = ["/api/capital/investors", search, typeFilter, stageFilter, cwcFilter];
  const { data: investors = [], isLoading } = useQuery<Investor[]>({
    queryKey: qk,
    queryFn: () => {
      const p = new URLSearchParams();
      if (search)                p.set("search", search);
      if (typeFilter  !== "all") p.set("investor_type", typeFilter);
      if (stageFilter !== "all") p.set("stage", stageFilter);
      if (cwcFilter   !== "all") p.set("can_write_cheque", cwcFilter);
      return fetch(`/api/capital/investors?${p}`).then(r => r.json());
    },
  });

  const { data: detailData } = useQuery<Investor>({
    queryKey: ["/api/capital/investors", detail],
    queryFn: () => fetch(`/api/capital/investors/${detail}`).then(r => r.json()),
    enabled: detail != null,
  });

  const createMut = useMutation({
    mutationFn: (d: any) => apiRequest("POST", "/api/capital/investors", d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/capital/investors"] });
      setCreating(false); setForm({ ...BLANK }); toast({ title: "Investor added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.message, variant: "destructive" }),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PATCH", `/api/capital/investors/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/capital/investors"] });
      if (detail) queryClient.invalidateQueries({ queryKey: ["/api/capital/investors", detail] });
      setEditing(null); toast({ title: "Investor updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.message, variant: "destructive" }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/capital/investors/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/capital/investors"] });
      toast({ title: "Investor deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.message, variant: "destructive" }),
  });

  function ff(key: string, val: any) { setForm(prev => ({ ...prev, [key]: val })); }
  function openEdit(inv: Investor) { setEditing(inv); setForm({ ...inv }); }

  function handleSubmit() {
    if (!form.name?.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    if (editing) updateMut.mutate({ id: editing.id, data: { ...form } });
    else createMut.mutate({ ...form });
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="px-6 py-4 border-b border-border/40 shrink-0 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" /> Investor Targets
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {investors.length} investor{investors.length !== 1 ? "s" : ""} · {investors.filter(i => i.can_write_cheque).length} can write cheque
          </p>
        </div>
        <Button size="sm" onClick={() => { setForm({ ...BLANK }); setCreating(true); }} data-testid="btn-add-investor">
          <Plus className="w-4 h-4 mr-1.5" /> Add Investor
        </Button>
      </div>

      <div className="px-6 py-3 border-b border-border/30 flex flex-wrap gap-2 shrink-0">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="Search investors…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-sm" data-testid="input-investor-search" />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 text-sm w-[180px]" data-testid="select-investor-type"><SelectValue placeholder="Investor type" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All types</SelectItem>{INVESTOR_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="h-8 text-sm w-[180px]" data-testid="select-investor-stage"><SelectValue placeholder="Stage" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All stages</SelectItem>{PIPELINE_STAGES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={cwcFilter} onValueChange={setCwcFilter}>
          <SelectTrigger className="h-8 text-sm w-[160px]"><SelectValue placeholder="Cheque" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="true">Can write cheque</SelectItem>
            <SelectItem value="false">Connector / No cheque</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32"><div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" /></div>
        ) : investors.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center">
            <Users className="w-8 h-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">No investors found. Add your first investor to get started.</p>
          </div>
        ) : (
          <table className="w-full text-sm" data-testid="investors-table">
            <thead>
              <tr className="border-b border-border/30 text-xs text-muted-foreground">
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium">Type</th>
                <th className="text-left px-4 py-2 font-medium hidden lg:table-cell">Stage</th>
                <th className="text-left px-4 py-2 font-medium hidden md:table-cell">Priority</th>
                <th className="text-right px-4 py-2 font-medium hidden xl:table-cell">Check Size</th>
                <th className="text-right px-4 py-2 font-medium hidden lg:table-cell">Prob.</th>
                <th className="text-left px-4 py-2 font-medium hidden xl:table-cell">Next Step</th>
                <th className="px-4 py-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {investors.map(inv => (
                <tr key={inv.id} className="border-b border-border/20 hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => setDetail(inv.id)} data-testid={`row-investor-${inv.id}`}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <p className="font-medium text-foreground">{inv.name}</p>
                      {!inv.can_write_cheque && <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />}
                    </div>
                    {inv.introducer_name && <p className="text-xs text-muted-foreground">via {inv.introducer_name}</p>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{inv.investor_type}</td>
                  <td className="px-4 py-2.5 hidden lg:table-cell">
                    <span className={`text-xs font-medium ${stageColor(inv.stage)}`}>{inv.stage}</span>
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${priorityBadge(inv.priority)}`}>{inv.priority}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs hidden xl:table-cell text-muted-foreground">
                    {inv.check_size_min || inv.check_size_max ? `${fmtMoney(inv.check_size_min)}–${fmtMoney(inv.check_size_max)}` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs hidden lg:table-cell text-muted-foreground">
                    {inv.probability != null ? `${inv.probability}%` : "—"}
                  </td>
                  <td className="px-4 py-2.5 hidden xl:table-cell text-xs">
                    {inv.next_step_date
                      ? <span className={new Date(inv.next_step_date) < new Date() ? "text-red-400" : "text-muted-foreground"}>{fmtDate(inv.next_step_date)}</span>
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0"><MoreHorizontal className="w-3.5 h-3.5" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setDetail(inv.id)}>View detail</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openEdit(inv)}>Edit</DropdownMenuItem>
                        <DropdownMenuItem className="text-red-400" onClick={() => deleteMut.mutate(inv.id)}>Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <InvestorDialog
        open={creating || !!editing}
        editing={!!editing}
        form={form}
        setField={ff}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSubmit={handleSubmit}
        isPending={createMut.isPending || updateMut.isPending}
      />

      <Sheet open={detail != null} onOpenChange={v => !v && setDetail(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto" side="right">
          {detailData ? (
            <InvestorDetail
              investor={detailData}
              onEdit={() => { openEdit(detailData); setDetail(null); }}
              onStageChange={stage => updateMut.mutate({ id: detailData.id, data: { stage } })}
            />
          ) : (
            <div className="flex items-center justify-center h-40">
              <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function InvestorDialog({ open, editing, form, setField, onClose, onSubmit, isPending }: {
  open: boolean; editing: boolean; form: any;
  setField: (k: string, v: any) => void;
  onClose: () => void; onSubmit: () => void; isPending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{editing ? "Edit Investor" : "Add Investor"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
          <div className="md:col-span-2">
            <Label>Name *</Label>
            <Input value={form.name ?? ""} onChange={e => setField("name", e.target.value)} placeholder="Investor or fund name" className="mt-1" data-testid="input-investor-name" />
          </div>
          <div>
            <Label>Investor Type *</Label>
            <Select value={form.investor_type ?? "Venture Capital"} onValueChange={v => {
              setField("investor_type", v);
              if (v === "Connector / Referrer") setField("can_write_cheque", false);
              else if (!editing) setField("can_write_cheque", true);
            }}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{INVESTOR_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Pipeline Stage *</Label>
            <Select value={form.stage ?? "Target Identified"} onValueChange={v => setField("stage", v)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{PIPELINE_STAGES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Priority</Label>
            <Select value={form.priority ?? "Medium"} onValueChange={v => setField("priority", v)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={form.status ?? "Active"} onValueChange={v => setField("status", v)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Active">Active</SelectItem>
                <SelectItem value="On Hold">On Hold</SelectItem>
                <SelectItem value="Passed">Passed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Check Size Min ($)</Label>
            <Input type="number" value={form.check_size_min ?? ""} onChange={e => setField("check_size_min", e.target.value ? Number(e.target.value) : null)} placeholder="250000" className="mt-1" />
          </div>
          <div>
            <Label>Check Size Max ($)</Label>
            <Input type="number" value={form.check_size_max ?? ""} onChange={e => setField("check_size_max", e.target.value ? Number(e.target.value) : null)} placeholder="500000" className="mt-1" />
          </div>
          <div>
            <Label>Probability (%)</Label>
            <Input type="number" min="0" max="100" value={form.probability ?? ""} onChange={e => setField("probability", e.target.value ? Number(e.target.value) : null)} placeholder="25" className="mt-1" />
          </div>
          <div>
            <Label>Next Step Date</Label>
            <Input type="date" value={form.next_step_date ? String(form.next_step_date).slice(0,10) : ""} onChange={e => setField("next_step_date", e.target.value || null)} className="mt-1" />
          </div>
          <div>
            <Label>Source</Label>
            <Input value={form.source ?? ""} onChange={e => setField("source", e.target.value)} placeholder="Conference, referral…" className="mt-1" />
          </div>
          <div>
            <Label>Introducer</Label>
            <Input value={form.introducer_name ?? ""} onChange={e => setField("introducer_name", e.target.value)} placeholder="Who made the intro?" className="mt-1" />
          </div>
          <div>
            <Label>Website</Label>
            <Input value={form.website ?? ""} onChange={e => setField("website", e.target.value)} placeholder="https://…" className="mt-1" />
          </div>
          <div>
            <Label>Country</Label>
            <Input value={form.country ?? ""} onChange={e => setField("country", e.target.value)} placeholder="Canada" className="mt-1" />
          </div>
          <div>
            <Label>Data Room Status</Label>
            <Select value={form.data_room_status ?? "Not Shared"} onValueChange={v => setField("data_room_status", v)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{DATA_ROOM_STATUSES.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label>Next Step</Label>
            <Input value={form.next_step ?? ""} onChange={e => setField("next_step", e.target.value)} placeholder="What is the next action?" className="mt-1" />
          </div>
          <div className="md:col-span-2">
            <Label>Thesis Fit</Label>
            <Textarea value={form.thesis_fit ?? ""} onChange={e => setField("thesis_fit", e.target.value)} placeholder="Why are they a fit for VoltSafe?" className="mt-1" rows={2} />
          </div>
          <div className="md:col-span-2">
            <Label>Notes</Label>
            <Textarea value={form.notes ?? ""} onChange={e => setField("notes", e.target.value)} placeholder="Notes on this investor…" className="mt-1" rows={2} />
          </div>
          {form.investor_type === "Connector / Referrer" && (
            <div className="md:col-span-2">
              <p className="text-xs text-amber-400 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Connector / Referrer: defaults to no direct cheque.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onSubmit} disabled={isPending} data-testid="btn-submit-investor">
            {isPending ? "Saving…" : editing ? "Save Changes" : "Add Investor"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function InvestorDetail({ investor, onEdit, onStageChange }: {
  investor: Investor; onEdit: () => void; onStageChange: (s: string) => void;
}) {
  return (
    <div className="space-y-5 pt-2">
      <SheetHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <SheetTitle className="text-lg">{investor.name}</SheetTitle>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xs text-muted-foreground">{investor.investor_type}</span>
              {!investor.can_write_cheque && (
                <span className="text-xs bg-amber-500/15 text-amber-400 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                  <AlertTriangle className="w-2.5 h-2.5" /> No direct cheque
                </span>
              )}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={onEdit}>Edit</Button>
        </div>
      </SheetHeader>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-16 shrink-0">Stage</span>
        <Select value={investor.stage} onValueChange={onStageChange}>
          <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>{PIPELINE_STAGES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div><p className="text-muted-foreground">Check size</p>
          <p className="font-medium">{investor.check_size_min || investor.check_size_max ? `${fmtMoney(investor.check_size_min)}–${fmtMoney(investor.check_size_max)}` : "—"}</p></div>
        <div><p className="text-muted-foreground">Probability</p>
          <p className="font-medium">{investor.probability != null ? `${investor.probability}%` : "—"}</p></div>
        <div><p className="text-muted-foreground">Data room</p>
          <p className="font-medium">{investor.data_room_status}</p></div>
        <div><p className="text-muted-foreground">Country</p>
          <p className="font-medium">{investor.country || "—"}</p></div>
        {investor.introducer_name && (
          <div className="col-span-2"><p className="text-muted-foreground">Introducer</p>
            <p className="font-medium">{investor.introducer_name}</p></div>
        )}
        {investor.next_step && (
          <div className="col-span-2"><p className="text-muted-foreground">Next step</p>
            <p className="font-medium">{investor.next_step}{investor.next_step_date && <span className="text-muted-foreground ml-1">· {fmtDate(investor.next_step_date)}</span>}</p></div>
        )}
        {investor.thesis_fit && (
          <div className="col-span-2"><p className="text-muted-foreground">Thesis fit</p><p>{investor.thesis_fit}</p></div>
        )}
        {investor.notes && (
          <div className="col-span-2"><p className="text-muted-foreground">Notes</p><p>{investor.notes}</p></div>
        )}
      </div>

      <Separator />
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" /> CONTACTS ({investor.contacts?.length ?? 0})
        </p>
        {investor.contacts?.length ? investor.contacts.map((c: any) => (
          <div key={c.id} className="flex items-center justify-between bg-muted/20 rounded-lg px-3 py-2 mb-1.5">
            <div>
              <p className="text-sm font-medium">{c.full_name || `${c.first_name} ${c.last_name || ""}`.trim()}</p>
              <p className="text-xs text-muted-foreground">{c.title || c.role_type}</p>
            </div>
            <span className="text-xs text-muted-foreground">{c.relationship_strength}</span>
          </div>
        )) : <p className="text-xs text-muted-foreground">No contacts linked.</p>}
      </div>

      <Separator />
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
          <DollarSign className="w-3.5 h-3.5" /> COMMITMENTS ({investor.commitments?.length ?? 0})
        </p>
        {investor.commitments?.length ? investor.commitments.map((c: any) => (
          <div key={c.id} className="flex items-center justify-between bg-muted/20 rounded-lg px-3 py-2 mb-1.5">
            <div>
              <p className="text-sm font-medium">{fmtMoney(c.amount)} · {c.commitment_stage}</p>
              {c.round_name && <p className="text-xs text-muted-foreground">{c.round_name}</p>}
            </div>
            {c.probability != null && <span className="text-xs text-muted-foreground">{c.probability}%</span>}
          </div>
        )) : <p className="text-xs text-muted-foreground">No commitments recorded.</p>}
      </div>

      <Separator />
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5" /> ACTIVITY ({investor.activities?.length ?? 0})
        </p>
        {investor.activities?.length ? investor.activities.slice(0, 10).map((a: any) => (
          <div key={a.id} className="flex gap-2 text-xs mb-2">
            <div className="w-1.5 h-1.5 rounded-full bg-primary/60 mt-1.5 shrink-0" />
            <div>
              <p className="text-foreground">{a.title || a.subject || a.activity_type}</p>
              {a.old_value && a.new_value && <p className="text-muted-foreground">{a.old_value} → {a.new_value}</p>}
              <p className="text-muted-foreground/60">{fmtDate(a.activity_at || a.created_at)}</p>
            </div>
          </div>
        )) : <p className="text-xs text-muted-foreground">No activity recorded yet.</p>}
      </div>
    </div>
  );
}
