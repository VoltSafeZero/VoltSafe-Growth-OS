import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Landmark, Plus, Search, MoreHorizontal, Calendar, AlertTriangle,
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

const PROGRAM_TYPES = [
  "Federal Grant","Provincial Grant","Municipal Grant","Port Authority Funding",
  "Utility Program","Climate Funding","Clean Tech Funding","Export Funding",
  "R&D Funding","Manufacturing Funding","Blue Economy Funding",
  "Pilot / Demo Funding","Demand Response Funding","Infrastructure Funding",
  "Tax Credit","Loan","Contribution","Other",
];
const APP_STATUSES = [
  "Identified","Eligibility Review","Go / No-Go","Drafting","Submitted",
  "Under Review","Shortlisted","Approved","Rejected","Reporting / Claims","Closed",
];
const ELIG_STATUSES = ["Unknown","Likely Eligible","Confirmed Eligible","Unclear","Not Eligible"];
const REPORTING_BURDENS = ["Low","Medium","High","Very High"];

function fmt(cents: number | null | undefined): string {
  if (!cents) return "—";
  const v = cents / 100;
  if (v >= 1_000_000) return `$${(v/1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${(v/1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

function deadlineWarning(d: string | null): string | null {
  if (!d) return null;
  const days = Math.floor((new Date(d).getTime() - Date.now()) / 86400000);
  if (days < 0)  return "text-red-400";    // overdue
  if (days <= 14) return "text-red-400";
  if (days <= 30) return "text-amber-400";
  return null;
}

function statusBadge(s: string) {
  if (["Approved"].includes(s))             return "bg-emerald-500/15 text-emerald-400";
  if (["Submitted","Under Review","Shortlisted"].includes(s)) return "bg-blue-500/15 text-blue-400";
  if (["Drafting","Go / No-Go"].includes(s)) return "bg-amber-500/15 text-amber-400";
  if (["Rejected","Closed"].includes(s))    return "bg-muted text-muted-foreground";
  return "bg-secondary text-secondary-foreground";
}

type Grant = {
  id: number;
  program_name: string;
  funding_body: string | null;
  program_type: string;
  application_status: string;
  eligibility_status: string;
  deadline: string | null;
  fit_score: number | null;
  expected_amount_cents: number | null;
  weighted_amount_cents: number | null;
  probability_percent: number | null;
  required_documents: string | null;
  reporting_burden: string;
  next_action: string | null;
  notes: string | null;
  max_funding_amount_cents: number | null;
  geography: string | null;
  sector_fit: string | null;
};

type FormState = Partial<Grant> & { program_name: string };
const BLANK: FormState = { program_name: "", program_type: "Federal Grant", application_status: "Identified", eligibility_status: "Unknown", reporting_burden: "Medium" };

export default function CapitalGrants() {
  const { toast } = useToast();
  const [q, setQ]               = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing]   = useState<Grant | null>(null);
  const [form, setForm] = useState<FormState>(BLANK);

  const qk = ["/api/capital/grants", q, statusFilter];
  const { data: grants = [], isLoading } = useQuery<Grant[]>({
    queryKey: qk,
    queryFn: () => {
      const p = new URLSearchParams();
      if (q)           p.set("q", q);
      if (statusFilter !== "all") p.set("status", statusFilter);
      return fetch(`/api/capital/grants?${p}`).then(r => r.json());
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/capital/grants", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/capital/grants"] }); setCreating(false); setForm(BLANK); toast({ title: "Grant added" }); },
    onError: (e: any) => toast({ title: "Failed to create", description: e?.message, variant: "destructive" }),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PATCH", `/api/capital/grants/${id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/capital/grants"] }); setEditing(null); toast({ title: "Grant updated" }); },
    onError: (e: any) => toast({ title: "Failed to update", description: e?.message, variant: "destructive" }),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/capital/grants/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/capital/grants"] }); toast({ title: "Grant deleted" }); },
    onError: (e: any) => toast({ title: "Failed to delete", description: e?.message, variant: "destructive" }),
  });

  function sf(key: keyof FormState, val: any) { setForm(prev => ({ ...prev, [key]: val })); }
  function openEdit(g: Grant) { setEditing(g); setForm({ ...g }); }

  function submitCreate() {
    if (!form.program_name?.trim()) { toast({ title: "Program name required", variant: "destructive" }); return; }
    const payload: any = { ...form };
    if (payload.expected_amount_cents) payload.expected_amount_cents = Math.round(Number(payload.expected_amount_cents) * 100);
    if (payload.max_funding_amount_cents) payload.max_funding_amount_cents = Math.round(Number(payload.max_funding_amount_cents) * 100);
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
            <Landmark className="w-5 h-5 text-primary" /> Grants
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">{grants.length} grant program{grants.length !== 1 ? "s" : ""}</p>
        </div>
        <Button size="sm" onClick={() => { setForm(BLANK); setCreating(true); }} data-testid="btn-add-grant">
          <Plus className="w-4 h-4 mr-1.5" /> Add Grant
        </Button>
      </div>

      <div className="px-6 py-3 border-b border-border/30 flex flex-wrap gap-2 shrink-0">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="Search grants…" value={q} onChange={e => setQ(e.target.value)} className="pl-8 h-8 text-sm" data-testid="input-grant-search" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 text-sm w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {APP_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        ) : grants.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center">
            <Landmark className="w-8 h-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">No grants found. Add a grant program to start tracking.</p>
          </div>
        ) : (
          <table className="w-full text-sm" data-testid="grants-table">
            <thead>
              <tr className="border-b border-border/30 text-xs text-muted-foreground">
                <th className="text-left px-4 py-2 font-medium">Program</th>
                <th className="text-left px-4 py-2 font-medium hidden md:table-cell">Deadline</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-right px-4 py-2 font-medium hidden lg:table-cell">Fit</th>
                <th className="text-right px-4 py-2 font-medium">Expected</th>
                <th className="text-right px-4 py-2 font-medium hidden xl:table-cell">Weighted</th>
                <th className="text-left px-4 py-2 font-medium hidden xl:table-cell">Reporting</th>
                <th className="text-left px-4 py-2 font-medium hidden 2xl:table-cell">Next Action</th>
                <th className="px-4 py-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {grants.map(g => {
                const warnColor = deadlineWarning(g.deadline);
                return (
                  <tr key={g.id} className="border-b border-border/20 hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => openEdit(g)} data-testid={`row-grant-${g.id}`}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-foreground">{g.program_name}</p>
                      {g.funding_body && <p className="text-xs text-muted-foreground">{g.funding_body}</p>}
                    </td>
                    <td className="px-4 py-2.5 hidden md:table-cell">
                      <span className={`text-xs font-medium ${warnColor ?? "text-muted-foreground"}`}>
                        {g.deadline ? fmtDate(g.deadline) : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${statusBadge(g.application_status)}`}>{g.application_status}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right hidden lg:table-cell text-xs">
                      {g.fit_score != null ? <span className="text-primary font-mono">{g.fit_score}</span> : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-foreground">{fmt(g.expected_amount_cents)}</td>
                    <td className="px-4 py-2.5 text-right hidden xl:table-cell text-xs text-muted-foreground">{fmt(g.weighted_amount_cents)}</td>
                    <td className="px-4 py-2.5 hidden xl:table-cell text-xs text-muted-foreground">{g.reporting_burden}</td>
                    <td className="px-4 py-2.5 hidden 2xl:table-cell text-xs text-muted-foreground max-w-[160px] truncate">{g.next_action ?? "—"}</td>
                    <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0"><MoreHorizontal className="w-3.5 h-3.5" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(g)}>Edit</DropdownMenuItem>
                          <DropdownMenuItem className="text-red-400" onClick={() => deleteMutation.mutate(g.id)}>Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={creating || !!editing} onOpenChange={v => !v && (setCreating(false), setEditing(null))}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit Grant" : "Add Grant Program"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
            <div className="md:col-span-2">
              <Label>Program Name *</Label>
              <Input value={form.program_name ?? ""} onChange={e => sf("program_name", e.target.value)} placeholder="e.g. SDTC Net Zero Accelerator" className="mt-1" data-testid="input-grant-name" />
            </div>
            <div>
              <Label>Funding Body</Label>
              <Input value={form.funding_body ?? ""} onChange={e => sf("funding_body", e.target.value)} placeholder="e.g. NRCan, SDTC" className="mt-1" />
            </div>
            <div>
              <Label>Program Type</Label>
              <Select value={form.program_type ?? "Federal Grant"} onValueChange={v => sf("program_type", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{PROGRAM_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Application Status</Label>
              <Select value={form.application_status ?? "Identified"} onValueChange={v => sf("application_status", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{APP_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Eligibility Status</Label>
              <Select value={form.eligibility_status ?? "Unknown"} onValueChange={v => sf("eligibility_status", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{ELIG_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Deadline</Label>
              <Input type="date" value={form.deadline ? String(form.deadline).slice(0,10) : ""} onChange={e => sf("deadline", e.target.value || null)} className="mt-1" />
            </div>
            <div>
              <Label>Reporting Burden</Label>
              <Select value={form.reporting_burden ?? "Medium"} onValueChange={v => sf("reporting_burden", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{REPORTING_BURDENS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Expected Amount ($)</Label>
              <Input type="number" value={form.expected_amount_cents ? String(form.expected_amount_cents / 100) : ""} onChange={e => sf("expected_amount_cents", e.target.value ? Math.round(Number(e.target.value)*100) : null)} placeholder="250000" className="mt-1" />
            </div>
            <div>
              <Label>Probability (%)</Label>
              <Input type="number" min="0" max="100" value={form.probability_percent ?? ""} onChange={e => sf("probability_percent", e.target.value ? Number(e.target.value) : null)} placeholder="40" className="mt-1" />
            </div>
            <div>
              <Label>Fit Score (0–100)</Label>
              <Input type="number" min="0" max="100" value={form.fit_score ?? ""} onChange={e => sf("fit_score", e.target.value ? Number(e.target.value) : null)} className="mt-1" />
            </div>
            <div>
              <Label>Geography</Label>
              <Input value={form.geography ?? ""} onChange={e => sf("geography", e.target.value)} placeholder="Canada, Ontario…" className="mt-1" />
            </div>
            <div>
              <Label>Required Documents</Label>
              <Input value={form.required_documents ?? ""} onChange={e => sf("required_documents", e.target.value)} placeholder="Business plan, financials…" className="mt-1" />
            </div>
            <div>
              <Label>Next Action</Label>
              <Input value={form.next_action ?? ""} onChange={e => sf("next_action", e.target.value)} placeholder="Submit LOI by…" className="mt-1" />
            </div>
            <div className="md:col-span-2">
              <Label>Notes</Label>
              <Textarea value={form.notes ?? ""} onChange={e => sf("notes", e.target.value)} placeholder="Eligibility notes, contacts, strategic context…" className="mt-1" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreating(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={editing ? submitUpdate : submitCreate} disabled={createMutation.isPending || updateMutation.isPending} data-testid="btn-submit-grant">
              {createMutation.isPending || updateMutation.isPending ? "Saving…" : editing ? "Save Changes" : "Add Grant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
