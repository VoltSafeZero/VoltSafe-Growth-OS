import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { RefreshCcw, Plus, MoreHorizontal, DollarSign } from "lucide-react";
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
import { SampleBadge, SampleDataBanner, CapitalHelpTip } from "@/components/capital/capital-sample-ui";

const ROUND_TYPES = ["Pre-Seed","Seed","Bridge","Series A","Strategic","Grant","Debt","Other"];
const ROUND_STATUSES = ["Planning","Open","Soft Circled","Closing","Closed","Paused","Cancelled"];
const CURRENCIES = ["CAD","USD"];

function fmtMoney(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v}`;
}
function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}
function statusBadge(s: string) {
  if (s === "Closed")        return "bg-emerald-500/15 text-emerald-400";
  if (s === "Open")          return "bg-cyan-500/15 text-cyan-400";
  if (s === "Soft Circled")  return "bg-violet-500/15 text-violet-400";
  if (s === "Closing")       return "bg-primary/15 text-primary";
  if (["Paused","Cancelled"].includes(s)) return "bg-muted text-muted-foreground";
  return "bg-muted text-muted-foreground";
}

type Round = {
  id: number; name: string; round_type: string; target_amount: number | null;
  currency: string; pre_money_valuation: number | null; post_money_valuation: number | null;
  minimum_check_size: number | null; status: string; open_date: string | null;
  target_close_date: string | null; actual_close_date: string | null; notes: string | null;
};

const BLANK: Partial<Round> & { name: string } = {
  name: "", round_type: "Seed", status: "Planning", currency: "CAD",
};

export default function CapitalRounds() {
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing]   = useState<Round | null>(null);
  const [form, setForm]         = useState<typeof BLANK>({ ...BLANK });

  const { data: rounds = [], isLoading } = useQuery<Round[]>({
    queryKey: ["/api/capital/rounds"],
    queryFn: () => fetch("/api/capital/rounds").then(r => r.json()),
  });

  const createMut = useMutation({
    mutationFn: (d: any) => apiRequest("POST", "/api/capital/rounds", d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/capital/rounds"] });
      setCreating(false); setForm({ ...BLANK }); toast({ title: "Round created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.message, variant: "destructive" }),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PATCH", `/api/capital/rounds/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/capital/rounds"] });
      setEditing(null); toast({ title: "Round updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.message, variant: "destructive" }),
  });

  function ff(key: string, val: any) { setForm(prev => ({ ...prev, [key]: val })); }
  function openEdit(r: Round) { setEditing(r); setForm({ ...r }); }

  function handleSubmit() {
    if (!form.name?.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    if (editing) updateMut.mutate({ id: editing.id, data: { ...form } });
    else createMut.mutate({ ...form });
  }

  const totalTarget = rounds.filter(r => !["Closed","Cancelled"].includes(r.status)).reduce((s, r) => s + (r.target_amount ?? 0), 0);

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="px-6 pt-4 shrink-0">
        <SampleDataBanner />
      </div>
      <div className="px-6 py-4 border-b border-border/40 shrink-0 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <RefreshCcw className="w-5 h-5 text-primary" /> Funding Rounds
            <CapitalHelpTip copyKey="target_amount" />
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {rounds.length} round{rounds.length !== 1 ? "s" : ""}{totalTarget > 0 && ` · Active target: ${fmtMoney(totalTarget)}`}
          </p>
        </div>
        <Button size="sm" onClick={() => { setForm({ ...BLANK }); setCreating(true); }} data-testid="btn-add-round">
          <Plus className="w-4 h-4 mr-1.5" /> Add Round
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-32"><div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" /></div>
        ) : rounds.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center">
            <RefreshCcw className="w-8 h-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">No funding rounds yet. Create your first round to start tracking commitments.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {rounds.map(r => (
              <div key={r.id} className="border border-border/30 rounded-xl p-4 bg-card/30 hover:bg-muted/10 transition-colors cursor-pointer" onClick={() => openEdit(r)} data-testid={`row-round-${r.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-foreground">{r.name}</h3>
                      <span className="text-xs text-muted-foreground">{r.round_type}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${statusBadge(r.status)}`}>{r.status}</span>
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                      {r.target_amount && <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />Target: {fmtMoney(r.target_amount)} {r.currency}</span>}
                      {r.pre_money_valuation && <span>Pre-money: {fmtMoney(r.pre_money_valuation)}</span>}
                      {r.minimum_check_size && <span>Min cheque: {fmtMoney(r.minimum_check_size)}</span>}
                      {r.target_close_date && <span>Close: {fmtDate(r.target_close_date)}</span>}
                    </div>
                    {r.notes && <p className="text-xs text-muted-foreground mt-1.5 line-clamp-1">{r.notes}</p>}
                  </div>
                  <div className="shrink-0" onClick={e => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0"><MoreHorizontal className="w-3.5 h-3.5" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(r)}>Edit</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={creating || !!editing} onOpenChange={v => !v && (setCreating(false), setEditing(null))}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit Round" : "Create Funding Round"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2">
              <Label>Round Name *</Label>
              <Input value={form.name ?? ""} onChange={e => ff("name", e.target.value)} placeholder="e.g. Seed Round 2025" className="mt-1" data-testid="input-round-name" />
            </div>
            <div>
              <Label>Round Type</Label>
              <Select value={form.round_type ?? "Seed"} onValueChange={v => ff("round_type", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{ROUND_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status ?? "Planning"} onValueChange={v => ff("status", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{ROUND_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Currency</Label>
              <Select value={form.currency ?? "CAD"} onValueChange={v => ff("currency", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Target Amount ($)</Label>
              <Input type="number" value={form.target_amount ?? ""} onChange={e => ff("target_amount", e.target.value ? Number(e.target.value) : null)} placeholder="2000000" className="mt-1" />
            </div>
            <div>
              <Label>Pre-Money Valuation ($)</Label>
              <Input type="number" value={form.pre_money_valuation ?? ""} onChange={e => ff("pre_money_valuation", e.target.value ? Number(e.target.value) : null)} placeholder="8000000" className="mt-1" />
            </div>
            <div>
              <Label>Post-Money Valuation ($)</Label>
              <Input type="number" value={form.post_money_valuation ?? ""} onChange={e => ff("post_money_valuation", e.target.value ? Number(e.target.value) : null)} placeholder="10000000" className="mt-1" />
            </div>
            <div>
              <Label>Minimum Cheque ($)</Label>
              <Input type="number" value={form.minimum_check_size ?? ""} onChange={e => ff("minimum_check_size", e.target.value ? Number(e.target.value) : null)} placeholder="25000" className="mt-1" />
            </div>
            <div>
              <Label>Open Date</Label>
              <Input type="date" value={form.open_date ? String(form.open_date).slice(0,10) : ""} onChange={e => ff("open_date", e.target.value || null)} className="mt-1" />
            </div>
            <div>
              <Label>Target Close Date</Label>
              <Input type="date" value={form.target_close_date ? String(form.target_close_date).slice(0,10) : ""} onChange={e => ff("target_close_date", e.target.value || null)} className="mt-1" />
            </div>
            {editing && (
              <div>
                <Label>Actual Close Date</Label>
                <Input type="date" value={form.actual_close_date ? String(form.actual_close_date).slice(0,10) : ""} onChange={e => ff("actual_close_date", e.target.value || null)} className="mt-1" />
              </div>
            )}
            <div className="col-span-2">
              <Label>Notes</Label>
              <Textarea value={form.notes ?? ""} onChange={e => ff("notes", e.target.value)} placeholder="Any notes about this round…" className="mt-1" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreating(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMut.isPending || updateMut.isPending} data-testid="btn-submit-round">
              {createMut.isPending || updateMut.isPending ? "Saving…" : editing ? "Save Changes" : "Create Round"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
