import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CheckSquare, Plus, MoreHorizontal, DollarSign } from "lucide-react";
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

const COMMITMENT_STAGES = [
  "Verbal Interest","Soft Commit","Committed","Docs Sent","Signed","Wired / Closed","Passed",
];
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
function stageBadge(s: string) {
  if (["Wired / Closed","Signed"].includes(s))   return "bg-emerald-500/15 text-emerald-400";
  if (s === "Committed")                          return "bg-cyan-500/15 text-cyan-400";
  if (s === "Soft Commit")                        return "bg-violet-500/15 text-violet-400";
  if (s === "Docs Sent")                          return "bg-blue-500/15 text-blue-400";
  if (s === "Passed")                             return "bg-muted text-muted-foreground";
  return "bg-muted/60 text-muted-foreground";
}

type Commitment = {
  id: number; investor_id: number | null; round_id: number | null; contact_id: number | null;
  amount: number | null; currency: string; commitment_stage: string; probability: number | null;
  expected_close_date: string | null; actual_close_date: string | null;
  terms_summary: string | null; notes: string | null;
  investor_name?: string | null; round_name?: string | null;
};

const BLANK: any = { commitment_stage: "Verbal Interest", currency: "CAD" };

export default function CapitalCommitments() {
  const { toast } = useToast();
  const [creating, setCreating]   = useState(false);
  const [editing, setEditing]     = useState<Commitment | null>(null);
  const [stageFilter, setStageFilter] = useState("all");
  const [form, setForm]           = useState<any>({ ...BLANK });

  const { data: investors = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/capital/investors", "dropdown"],
    queryFn: () => fetch("/api/capital/investors").then(r => r.json()),
  });
  const { data: rounds = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/capital/rounds"],
    queryFn: () => fetch("/api/capital/rounds").then(r => r.json()),
  });

  const qk = ["/api/capital/commitments", stageFilter];
  const { data: commitments = [], isLoading } = useQuery<Commitment[]>({
    queryKey: qk,
    queryFn: () => {
      const p = new URLSearchParams();
      if (stageFilter !== "all") p.set("commitment_stage", stageFilter);
      return fetch(`/api/capital/commitments?${p}`).then(r => r.json());
    },
  });

  const createMut = useMutation({
    mutationFn: (d: any) => apiRequest("POST", "/api/capital/commitments", d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/capital/commitments"] });
      setCreating(false); setForm({ ...BLANK }); toast({ title: "Commitment added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.message, variant: "destructive" }),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PATCH", `/api/capital/commitments/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/capital/commitments"] });
      setEditing(null); toast({ title: "Commitment updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.message, variant: "destructive" }),
  });

  function ff(key: string, val: any) { setForm((p: any) => ({ ...p, [key]: val })); }
  function openEdit(c: Commitment) { setEditing(c); setForm({ ...c }); }

  function handleSubmit() {
    if (!form.investor_id) { toast({ title: "Investor is required", variant: "destructive" }); return; }
    if (editing) updateMut.mutate({ id: editing.id, data: { ...form } });
    else createMut.mutate({ ...form });
  }

  const totalCommitted = commitments
    .filter(c => ["Committed","Docs Sent","Signed","Wired / Closed"].includes(c.commitment_stage))
    .reduce((s, c) => s + (c.amount ?? 0), 0);
  const totalSoft = commitments
    .filter(c => c.commitment_stage === "Soft Commit")
    .reduce((s, c) => s + (c.amount ?? 0), 0);

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="px-6 py-4 border-b border-border/40 shrink-0 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <CheckSquare className="w-5 h-5 text-primary" /> Commitments
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {commitments.length} commitment{commitments.length !== 1 ? "s" : ""}
            {totalCommitted > 0 && <> · Committed: <span className="text-emerald-400 font-medium">{fmtMoney(totalCommitted)}</span></>}
            {totalSoft > 0 && <> · Soft: <span className="text-cyan-400 font-medium">{fmtMoney(totalSoft)}</span></>}
          </p>
        </div>
        <Button size="sm" onClick={() => { setForm({ ...BLANK }); setCreating(true); }} data-testid="btn-add-commitment">
          <Plus className="w-4 h-4 mr-1.5" /> Add Commitment
        </Button>
      </div>

      <div className="px-6 py-3 border-b border-border/30 flex gap-2 shrink-0">
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="h-8 text-sm w-[180px]"><SelectValue placeholder="All stages" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            {COMMITMENT_STAGES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-32"><div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" /></div>
        ) : commitments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center">
            <CheckSquare className="w-8 h-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">No commitments yet. Log your first commitment to track progress.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {commitments.map(c => (
              <div key={c.id} className="border border-border/30 rounded-xl px-4 py-3 bg-card/30 hover:bg-muted/10 transition-colors cursor-pointer" onClick={() => openEdit(c)} data-testid={`row-commitment-${c.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-foreground">{fmtMoney(c.amount)} {c.currency}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${stageBadge(c.commitment_stage)}`}>{c.commitment_stage}</span>
                      {c.probability != null && <span className="text-xs text-muted-foreground">{c.probability}%</span>}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                      {c.investor_name && <span>{c.investor_name}</span>}
                      {c.round_name && <span>· {c.round_name}</span>}
                      {c.expected_close_date && <span>· Close: {fmtDate(c.expected_close_date)}</span>}
                    </div>
                    {c.terms_summary && <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{c.terms_summary}</p>}
                  </div>
                  <div className="shrink-0" onClick={e => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0"><MoreHorizontal className="w-3.5 h-3.5" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(c)}>Edit</DropdownMenuItem>
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
          <DialogHeader><DialogTitle>{editing ? "Edit Commitment" : "Log Commitment"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2">
              <Label>Investor *</Label>
              <Select value={String(form.investor_id ?? "")} onValueChange={v => ff("investor_id", v ? Number(v) : null)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select investor…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">— Select investor —</SelectItem>
                  {investors.map((i: any) => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Round (optional)</Label>
              <Select value={String(form.round_id ?? "")} onValueChange={v => ff("round_id", v ? Number(v) : null)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Link to a round…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">— No round —</SelectItem>
                  {rounds.map((r: any) => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Commitment Stage</Label>
              <Select value={form.commitment_stage ?? "Verbal Interest"} onValueChange={v => ff("commitment_stage", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{COMMITMENT_STAGES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
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
              <Label>Amount ($)</Label>
              <Input type="number" value={form.amount ?? ""} onChange={e => ff("amount", e.target.value ? Number(e.target.value) : null)} placeholder="250000" className="mt-1" />
            </div>
            <div>
              <Label>Probability (%)</Label>
              <Input type="number" min="0" max="100" value={form.probability ?? ""} onChange={e => ff("probability", e.target.value ? Number(e.target.value) : null)} placeholder="80" className="mt-1" />
            </div>
            <div>
              <Label>Expected Close Date</Label>
              <Input type="date" value={form.expected_close_date ? String(form.expected_close_date).slice(0,10) : ""} onChange={e => ff("expected_close_date", e.target.value || null)} className="mt-1" />
            </div>
            {editing && (
              <div>
                <Label>Actual Close Date</Label>
                <Input type="date" value={form.actual_close_date ? String(form.actual_close_date).slice(0,10) : ""} onChange={e => ff("actual_close_date", e.target.value || null)} className="mt-1" />
              </div>
            )}
            <div className="col-span-2">
              <Label>Terms Summary</Label>
              <Input value={form.terms_summary ?? ""} onChange={e => ff("terms_summary", e.target.value)} placeholder="Convertible note, SAFE, priced round…" className="mt-1" />
            </div>
            <div className="col-span-2">
              <Label>Notes</Label>
              <Textarea value={form.notes ?? ""} onChange={e => ff("notes", e.target.value)} placeholder="Any notes about this commitment…" className="mt-1" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreating(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMut.isPending || updateMut.isPending} data-testid="btn-submit-commitment">
              {createMut.isPending || updateMut.isPending ? "Saving…" : editing ? "Save Changes" : "Log Commitment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
