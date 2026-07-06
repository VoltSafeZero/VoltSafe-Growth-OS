import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Users, Plus, Search, MoreHorizontal, DollarSign, Flame, ChevronDown,
} from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const FUNDER_TYPES = [
  "Angel","High Net Worth Individual","Family Office","VC","Corporate VC",
  "Strategic Investor","Government Investment Fund","Impact Fund","Climate Fund",
  "Infrastructure Fund","Marine / Blue Economy Fund","Accelerator / Incubator",
  "Venture Debt","Bank / Lender","Government Grant Body","Utility Program",
  "Advisor / Connector","Other",
];

const FUNDER_PERSONAS = [
  "Operator Angel","Technical Angel","Climate Angel","Marine Industry Angel",
  "Family Office — Long-Term Capital","Family Office — Opportunistic",
  "Seed VC","Deep Tech VC","Climate VC","Hardware VC",
  "Strategic Corporate Investor","Government-Backed Investor","Impact Investor",
  "R&D Grant","Pilot / Demo Grant","Climate Infrastructure Grant",
  "Export Growth Grant","Manufacturing Scale-Up Grant",
  "Utility / Demand Response Program","Blue Economy Program",
  "Regional Economic Development Program","Connector / Advisor","Unknown",
];

const PIPELINE_STAGES = [
  "Target Identified","Researching","Intro Needed","Intro Requested","Intro Made",
  "First Contacted","Meeting Booked","First Meeting Complete","Interested",
  "Data Room Shared","Diligence","Partner / IC Review","Soft Commitment",
  "Committed","Wired","Passed","Nurture",
];

const PRIORITIES = ["High","Medium","Low","Ignore"];
const REL_STRENGTHS = ["Cold","Light","Warm","Strong","Champion"];

function fmt(cents: number | null | undefined): string {
  if (!cents) return "—";
  const v = cents / 100;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function priorityBadge(p: string) {
  if (p === "High")   return "bg-red-500/15 text-red-400";
  if (p === "Medium") return "bg-amber-500/15 text-amber-400";
  if (p === "Ignore") return "bg-muted text-muted-foreground";
  return "bg-muted text-muted-foreground";
}

function stageColor(s: string) {
  if (["Committed","Wired"].includes(s))          return "text-emerald-400";
  if (["Soft Commitment","Interested"].includes(s)) return "text-cyan-400";
  if (["Diligence","Partner / IC Review"].includes(s)) return "text-violet-400";
  if (["Passed","Nurture"].includes(s))            return "text-muted-foreground";
  return "text-foreground";
}

type Funder = {
  id: number;
  name: string;
  funder_type: string;
  funder_persona: string;
  typical_stage: string | null;
  priority: string;
  fit_score: number | null;
  heat_score: number | null;
  expected_amount_cents: number | null;
  weighted_amount_cents: number | null;
  last_contacted_at: string | null;
  next_follow_up_at: string | null;
  pipeline_stage: string;
  relationship_strength: string;
  organization: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  website: string | null;
  linkedin: string | null;
  intro_path: string | null;
  probability_percent: number | null;
  notes: string | null;
};

type FormState = Partial<Funder> & { name: string };

const BLANK: FormState = {
  name: "", funder_type: "VC", funder_persona: "Unknown", priority: "Medium",
  pipeline_stage: "Target Identified", relationship_strength: "Cold",
};

export default function CapitalInvestors() {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter]   = useState<string>("all");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [priFilter, setPriFilter]     = useState<string>("all");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing]   = useState<Funder | null>(null);
  const [form, setForm] = useState<FormState>(BLANK);

  const qk = ["/api/capital/funders", q, typeFilter, stageFilter, priFilter];
  const { data: funders = [], isLoading } = useQuery<Funder[]>({
    queryKey: qk,
    queryFn: () => {
      const p = new URLSearchParams();
      if (q)           p.set("q", q);
      if (typeFilter  !== "all") p.set("type", typeFilter);
      if (stageFilter !== "all") p.set("stage", stageFilter);
      if (priFilter   !== "all") p.set("priority", priFilter);
      return fetch(`/api/capital/funders?${p}`).then(r => r.json());
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/capital/funders", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/capital/funders"] }); setCreating(false); setForm(BLANK); toast({ title: "Investor added" }); },
    onError: (e: any) => toast({ title: "Failed to create", description: e?.message, variant: "destructive" }),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PATCH", `/api/capital/funders/${id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/capital/funders"] }); setEditing(null); toast({ title: "Investor updated" }); },
    onError: (e: any) => toast({ title: "Failed to update", description: e?.message, variant: "destructive" }),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/capital/funders/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/capital/funders"] }); toast({ title: "Investor deleted" }); },
    onError: (e: any) => toast({ title: "Failed to delete", description: e?.message, variant: "destructive" }),
  });

  function f(key: keyof FormState, val: any) { setForm(prev => ({ ...prev, [key]: val })); }

  function openEdit(funder: Funder) {
    setEditing(funder);
    setForm({ ...funder });
  }

  function submitCreate() {
    if (!form.name?.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    const payload: any = { ...form };
    if (payload.expected_amount_cents) payload.expected_amount_cents = Math.round(Number(payload.expected_amount_cents) * 100);
    if (payload.cheque_size_min_cents) payload.cheque_size_min_cents = Math.round(Number(payload.cheque_size_min_cents) * 100);
    if (payload.cheque_size_max_cents) payload.cheque_size_max_cents = Math.round(Number(payload.cheque_size_max_cents) * 100);
    createMutation.mutate(payload);
  }
  function submitUpdate() {
    if (!editing) return;
    const payload: any = { ...form };
    if (payload.expected_amount_cents) payload.expected_amount_cents = Math.round(Number(payload.expected_amount_cents) * 100);
    updateMutation.mutate({ id: editing.id, data: payload });
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="px-6 py-4 border-b border-border/40 shrink-0 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" /> Investors
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">{funders.length} investor{funders.length !== 1 ? "s" : ""}</p>
        </div>
        <Button size="sm" onClick={() => { setForm(BLANK); setCreating(true); }} data-testid="btn-add-investor">
          <Plus className="w-4 h-4 mr-1.5" /> Add Investor
        </Button>
      </div>

      {/* Filters */}
      <div className="px-6 py-3 border-b border-border/30 flex flex-wrap gap-2 shrink-0">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="Search investors…" value={q} onChange={e => setQ(e.target.value)} className="pl-8 h-8 text-sm" data-testid="input-investor-search" />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 text-sm w-[160px]" data-testid="select-investor-type"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {FUNDER_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="h-8 text-sm w-[180px]"><SelectValue placeholder="Stage" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            {PIPELINE_STAGES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={priFilter} onValueChange={setPriFilter}>
          <SelectTrigger className="h-8 text-sm w-[130px]"><SelectValue placeholder="Priority" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        ) : funders.length === 0 ? (
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
                <th className="text-right px-4 py-2 font-medium hidden lg:table-cell">Fit</th>
                <th className="text-right px-4 py-2 font-medium">Expected</th>
                <th className="text-right px-4 py-2 font-medium hidden xl:table-cell">Weighted</th>
                <th className="text-left px-4 py-2 font-medium hidden xl:table-cell">Next Follow-Up</th>
                <th className="px-4 py-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {funders.map(f => (
                <tr key={f.id} className="border-b border-border/20 hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => openEdit(f)} data-testid={`row-investor-${f.id}`}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-foreground">{f.name}</p>
                    {f.organization && <p className="text-xs text-muted-foreground">{f.organization}</p>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{f.funder_type}</td>
                  <td className="px-4 py-2.5 hidden lg:table-cell">
                    <span className={`text-xs font-medium ${stageColor(f.pipeline_stage)}`}>{f.pipeline_stage}</span>
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${priorityBadge(f.priority)}`}>{f.priority}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right hidden lg:table-cell text-xs">
                    {f.fit_score != null ? <span className="text-primary font-mono">{f.fit_score}</span> : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium text-foreground">{fmt(f.expected_amount_cents)}</td>
                  <td className="px-4 py-2.5 text-right hidden xl:table-cell text-xs text-muted-foreground">{fmt(f.weighted_amount_cents)}</td>
                  <td className="px-4 py-2.5 hidden xl:table-cell text-xs text-muted-foreground">{fmtDate(f.next_follow_up_at)}</td>
                  <td className="px-4 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0"><MoreHorizontal className="w-3.5 h-3.5" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(f)}>Edit</DropdownMenuItem>
                        <DropdownMenuItem className="text-red-400" onClick={() => deleteMutation.mutate(f.id)}>Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create / Edit Dialog */}
      <FunderDialog
        open={creating || !!editing}
        editing={!!editing}
        form={form}
        setField={f}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSubmit={editing ? submitUpdate : submitCreate}
        isPending={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}

function FunderDialog({ open, editing, form, setField, onClose, onSubmit, isPending }: {
  open: boolean; editing: boolean; form: FormState;
  setField: (k: keyof FormState, v: any) => void;
  onClose: () => void; onSubmit: () => void; isPending: boolean;
}) {
  const dollarVal = (cents: number | null | undefined) => cents ? String(cents / 100) : "";

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Investor" : "Add Investor"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
          <div className="md:col-span-2">
            <Label>Name *</Label>
            <Input value={form.name ?? ""} onChange={e => setField("name", e.target.value)} placeholder="Investor or fund name" className="mt-1" data-testid="input-funder-name" />
          </div>
          <div>
            <Label>Funder Type</Label>
            <Select value={form.funder_type ?? "VC"} onValueChange={v => setField("funder_type", v)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{FUNDER_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Persona</Label>
            <Select value={form.funder_persona ?? "Unknown"} onValueChange={v => setField("funder_persona", v)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{FUNDER_PERSONAS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Pipeline Stage</Label>
            <Select value={form.pipeline_stage ?? "Target Identified"} onValueChange={v => setField("pipeline_stage", v)}>
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
            <Label>Relationship Strength</Label>
            <Select value={form.relationship_strength ?? "Cold"} onValueChange={v => setField("relationship_strength", v)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{REL_STRENGTHS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Organization</Label>
            <Input value={form.organization ?? ""} onChange={e => setField("organization", e.target.value)} placeholder="Fund or firm name" className="mt-1" />
          </div>
          <div>
            <Label>Contact Name</Label>
            <Input value={form.primary_contact_name ?? ""} onChange={e => setField("primary_contact_name", e.target.value)} placeholder="Primary contact" className="mt-1" />
          </div>
          <div>
            <Label>Contact Email</Label>
            <Input value={form.primary_contact_email ?? ""} onChange={e => setField("primary_contact_email", e.target.value)} placeholder="email@fund.com" className="mt-1" />
          </div>
          <div>
            <Label>Expected Amount ($)</Label>
            <Input type="number" value={dollarVal(form.expected_amount_cents)} onChange={e => setField("expected_amount_cents", e.target.value ? Math.round(Number(e.target.value) * 100) : null)} placeholder="500000" className="mt-1" />
          </div>
          <div>
            <Label>Probability (%)</Label>
            <Input type="number" min="0" max="100" value={form.probability_percent ?? ""} onChange={e => setField("probability_percent", e.target.value ? Number(e.target.value) : null)} placeholder="25" className="mt-1" />
          </div>
          <div>
            <Label>Next Follow-Up</Label>
            <Input type="date" value={form.next_follow_up_at ? String(form.next_follow_up_at).slice(0,10) : ""} onChange={e => setField("next_follow_up_at", e.target.value || null)} className="mt-1" />
          </div>
          <div>
            <Label>Fit Score (0–100)</Label>
            <Input type="number" min="0" max="100" value={form.fit_score ?? ""} onChange={e => setField("fit_score", e.target.value ? Number(e.target.value) : null)} className="mt-1" />
          </div>
          <div>
            <Label>Intro Path</Label>
            <Input value={form.intro_path ?? ""} onChange={e => setField("intro_path", e.target.value)} placeholder="Who can make the intro?" className="mt-1" />
          </div>
          <div>
            <Label>Website</Label>
            <Input value={form.website ?? ""} onChange={e => setField("website", e.target.value)} placeholder="https://…" className="mt-1" />
          </div>
          <div className="md:col-span-2">
            <Label>Investment Thesis / Notes</Label>
            <Textarea value={form.notes ?? ""} onChange={e => setField("notes", e.target.value)} placeholder="What is their thesis? Any notes on the relationship?" className="mt-1" rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onSubmit} disabled={isPending} data-testid="btn-submit-funder">
            {isPending ? "Saving…" : editing ? "Save Changes" : "Add Investor"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
