import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Target, TrendingUp, AlertTriangle, CheckCircle2, Clock, Zap, Users,
  ChevronDown, RefreshCcw, Brain, Mail, ExternalLink, DollarSign,
  Calendar, Flame, Activity, BarChart3, Shield, Rocket, Minus,
  Percent, PieChart, FileText, CheckSquare, Square, ChevronRight,
  Edit2, ClipboardList, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { fmtMoney } from "@/pages/capital-investors";

// ── Types ──────────────────────────────────────────────────────────────────────

type Round = {
  id: number; name: string; round_type: string; status: string;
  target_amount: number | null; minimum_close_target: number | null;
  currency: string; open_date: string | null; target_close_date: string | null;
  days_open: number | null; current_cash_balance: number | null;
  monthly_burn: number | null; post_close_monthly_burn: number | null;
  notes: string | null;
  // Phase 2F
  pre_money_valuation: number | null; post_money_valuation: number | null;
  share_price: number | null; option_pool_percent_pre: number | null;
  option_pool_percent_post: number | null; round_instrument: string | null;
  discount_rate: number | null; valuation_cap: number | null;
  interest_rate: number | null; maturity_date: string | null;
  legal_close_status: string | null;
};

type Summary = {
  target_amount: number; minimum_close_target: number;
  committed_amount: number; wired_amount: number; soft_circled_amount: number;
  weighted_pipeline: number; remaining_to_target: number;
  remaining_to_min_close: number; committed_count: number;
  soft_circled_count: number; hot_count: number; likely_lead_count: number;
  total_active: number; confidence_low: number; confidence_high: number;
};

type LeadCandidate = {
  id: number; name: string; investor_type: string; stage: string;
  target_cheque_amount: number | null; committed_amount: number | null;
  score: number; tier: string; last_touch_at: string | null;
  next_step: string | null; next_step_date: string | null;
  likely_lead: boolean; warmth: string; primary_contact: string | null;
  email_link_count: number; risk_flags: string[];
};

type ThisWeekAction = {
  investor_id: number; investor_name: string;
  reason: string; action: string;
  priority: "critical" | "high" | "medium" | "low";
  due_date: string | null;
};

type RiskFlag = {
  level: "critical" | "warning" | "info";
  code: string; message: string; count?: number;
};

type RunwayResult = {
  current_cash_balance: number | null; monthly_burn: number | null;
  runway_today_months: number | null; runway_after_min_months: number | null;
  runway_after_target_months: number | null;
  runway_after_weighted_months: number | null;
  cashout_date_today: string | null; cashout_date_after_target: string | null;
  has_data: boolean;
};

type Scenario = {
  name: string; key: string; amount: number;
  runway_added_months: number | null; gap_to_target: number;
  required_additional: number; description: string;
};

// Phase 2F types
type ValuationSummary = {
  instrument: string | null;
  pre_money: number | null; post_money_computed: number | null; post_money_manual: number | null;
  amount_raised: number; share_price: number | null;
  option_pool_pre: number | null; option_pool_post: number | null;
  valuation_cap: number | null; discount_rate: number | null;
  interest_rate: number | null; maturity_date: string | null;
  legal_close_status: string | null;
  new_investor_ownership_pct: number | null; effective_valuation: number | null;
  is_priced: boolean; is_safe_or_convertible: boolean;
  warnings: string[]; has_valuation_data: boolean;
};

type DilutionScenario = Scenario & {
  post_money_valuation: number | null;
  new_investor_pct: number | null; dilution_pct: number | null;
  dilution_warnings: string[]; assumptions: string[];
};

type AllocationRow = {
  investor_id: number; investor_name: string; investor_type: string; stage: string;
  commitment_id: number | null;
  requested_amount: number | null; allocation_amount: number | null;
  final_allocation_amount: number | null; committed_amount: number | null;
  allocation_status: string; closing_status: string;
  docs_sent_at: string | null; docs_signed_at: string | null; funds_received_at: string | null;
  allocation_notes: string | null; target_cheque_amount: number | null;
  score: number; tier: string; likely_lead: boolean;
  last_touch_at: string | null; next_step: string | null;
};

type ClosePlanGroup = {
  status: string; label: string; investors: AllocationRow[];
  total_amount: number; count: number;
  pct_of_target: number | null; pct_of_min_close: number | null;
};

type ClosePlanSummary = {
  groups: ClosePlanGroup[];
  total_committed_in_close: number; wired_amount: number;
  closed_amount: number; dropped_amount: number; pending_wire: number;
  alerts: string[];
};

type CloseChecklistItem = {
  key: string; label: string; complete: boolean; note?: string;
};

type CommandCenterData = {
  round: Round; summary: Summary;
  lead_candidates: LeadCandidate[];
  this_week_actions: ThisWeekAction[];
  risk_flags: RiskFlag[];
  runway: RunwayResult;
  scenarios: Scenario[];
  valuation_summary: ValuationSummary;
  dilution_scenarios: DilutionScenario[];
  allocation_plan: AllocationRow[];
  close_plan: ClosePlanSummary;
  close_checklist: CloseChecklistItem[];
  recent_activity: any[];
  recent_emails: any[];
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}
function fmtDateShort(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}
function pct(v: number, total: number) {
  if (!total) return 0;
  return Math.min(100, Math.round((v / total) * 100));
}
function statusBadgeClass(s: string) {
  if (s === "Open")   return "bg-cyan-500/15 text-cyan-400 border-cyan-500/20";
  if (s === "Closing") return "bg-primary/15 text-primary border-primary/20";
  if (s === "Closed") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/20";
  if (["Paused","Cancelled"].includes(s)) return "bg-muted text-muted-foreground";
  return "bg-muted text-muted-foreground";
}
function tierBadge(tier: string) {
  if (tier === "Hot")    return "bg-red-500/15 text-red-400";
  if (tier === "Warm")   return "bg-amber-500/15 text-amber-400";
  if (tier === "Nurture") return "bg-cyan-500/15 text-cyan-400";
  return "bg-muted text-muted-foreground";
}
function priorityColor(p: string) {
  if (p === "critical") return "text-red-400";
  if (p === "high")     return "text-amber-400";
  if (p === "medium")   return "text-cyan-400";
  return "text-muted-foreground";
}
function priorityBg(p: string) {
  if (p === "critical") return "border-l-red-500";
  if (p === "high")     return "border-l-amber-500";
  if (p === "medium")   return "border-l-cyan-500";
  return "border-l-muted";
}
function riskColor(level: string) {
  if (level === "critical") return "text-red-400 bg-red-500/10 border-red-500/20";
  if (level === "warning")  return "text-amber-400 bg-amber-500/10 border-amber-500/20";
  return "text-cyan-400 bg-cyan-500/10 border-cyan-500/20";
}
function riskIcon(level: string) {
  if (level === "critical") return <AlertTriangle className="w-3.5 h-3.5 shrink-0" />;
  if (level === "warning")  return <AlertTriangle className="w-3.5 h-3.5 shrink-0" />;
  return <Shield className="w-3.5 h-3.5 shrink-0" />;
}
function allocStatusColor(s: string) {
  if (s === "confirmed")  return "bg-emerald-500/15 text-emerald-400";
  if (s === "reserved")   return "bg-cyan-500/15 text-cyan-400";
  if (s === "proposed")   return "bg-amber-500/15 text-amber-400";
  if (s === "rejected")   return "bg-red-500/15 text-red-400";
  if (s === "reduced")    return "bg-orange-500/15 text-orange-400";
  if (s === "increased")  return "bg-violet-500/15 text-violet-400";
  return "bg-muted text-muted-foreground";
}
function closingStatusColor(s: string) {
  if (s === "closed" || s === "wired") return "bg-emerald-500/15 text-emerald-400";
  if (s === "funds_pending")           return "bg-cyan-500/15 text-cyan-400";
  if (s === "docs_signed")             return "bg-violet-500/15 text-violet-400";
  if (s === "docs_sent")               return "bg-amber-500/15 text-amber-400";
  if (s === "dropped")                 return "bg-red-500/15 text-red-400";
  return "bg-muted/40 text-muted-foreground";
}
function closingStatusLabel(s: string) {
  const m: Record<string,string> = {
    not_started: "Not Started", docs_sent: "Docs Sent", docs_signed: "Signed",
    funds_pending: "Funds Pending", wired: "Wired", closed: "Closed", dropped: "Dropped",
  };
  return m[s] || s;
}
function allocStatusLabel(s: string) {
  const m: Record<string,string> = {
    unallocated: "Unallocated", proposed: "Proposed", reserved: "Reserved",
    confirmed: "Confirmed", reduced: "Reduced", increased: "Increased", rejected: "Rejected",
  };
  return m[s] || s;
}
function instrumentLabel(s: string | null) {
  if (!s) return "—";
  const m: Record<string,string> = {
    priced_equity: "Priced Equity", SAFE: "SAFE",
    convertible_note: "Convertible Note", grant: "Grant", other: "Other",
  };
  return m[s] || s;
}

// ── Progress bar ───────────────────────────────────────────────────────────────

function ProgressBar({ committed, weighted, target, currency }: {
  committed: number; weighted: number; target: number; currency: string;
}) {
  if (!target) return null;
  const cPct = pct(committed, target);
  const wPct = Math.max(0, pct(weighted, target) - cPct);
  return (
    <div>
      <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
        <span>0</span>
        <span>{fmtMoney(target)} target</span>
      </div>
      <div className="h-2.5 bg-muted/30 rounded-full overflow-hidden flex" data-testid="progress-bar-main">
        <div className="h-full bg-emerald-500 rounded-l-full transition-all" style={{ width: `${cPct}%` }} title={`Committed: ${fmtMoney(committed)}`} />
        <div className="h-full bg-cyan-500/50" style={{ width: `${wPct}%` }} title={`Weighted pipeline: ${fmtMoney(weighted)}`} />
      </div>
      <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-emerald-500" /> Committed {cPct}%</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-cyan-500/50" /> Weighted pipeline</span>
      </div>
    </div>
  );
}

// ── Summary card ───────────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, accent }: {
  label: string; value: string; sub?: string; accent?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-1" data-testid={`summary-card-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-xl font-semibold ${accent || ""}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ── Runway editor ──────────────────────────────────────────────────────────────

function RunwayEditorDialog({ roundId, round, onClose }: {
  roundId: number; round: Round; onClose: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    current_cash_balance:     round.current_cash_balance ?? "",
    monthly_burn:             round.monthly_burn ?? "",
    post_close_monthly_burn:  round.post_close_monthly_burn ?? "",
    minimum_close_target:     round.minimum_close_target ?? "",
  });
  const mut = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", `/api/capital/rounds/${roundId}/runway`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/capital/rounds", roundId, "command-center"] });
      queryClient.invalidateQueries({ queryKey: ["/api/capital/rounds"] });
      toast({ title: "Runway data saved" });
      onClose();
    },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });
  function ff(k: string, v: string) { setForm(p => ({ ...p, [k]: v })); }
  function parseOrNull(v: any) { const n = Number(v); return isNaN(n) || v === "" ? null : n; }
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><BarChart3 className="w-4 h-4 text-cyan-400" /> Runway & Close Targets</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Cash Balance (today)</Label>
              <Input value={form.current_cash_balance} onChange={e => ff("current_cash_balance", e.target.value)}
                placeholder="e.g. 800000" className="h-8 text-xs mt-1" data-testid="input-cash-balance" />
            </div>
            <div>
              <Label className="text-xs">Monthly Burn</Label>
              <Input value={form.monthly_burn} onChange={e => ff("monthly_burn", e.target.value)}
                placeholder="e.g. 120000" className="h-8 text-xs mt-1" data-testid="input-monthly-burn" />
            </div>
            <div>
              <Label className="text-xs">Minimum Close Target</Label>
              <Input value={form.minimum_close_target} onChange={e => ff("minimum_close_target", e.target.value)}
                placeholder="e.g. 1500000" className="h-8 text-xs mt-1" data-testid="input-min-close-target" />
            </div>
            <div>
              <Label className="text-xs">Post-Close Burn (optional)</Label>
              <Input value={form.post_close_monthly_burn} onChange={e => ff("post_close_monthly_burn", e.target.value)}
                placeholder="e.g. 100000" className="h-8 text-xs mt-1" data-testid="input-post-close-burn" />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">All values in {round.currency}. Runway calculations are private to Capital only.</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={mut.isPending} onClick={() => mut.mutate({
            current_cash_balance:    parseOrNull(form.current_cash_balance),
            monthly_burn:            parseOrNull(form.monthly_burn),
            post_close_monthly_burn: parseOrNull(form.post_close_monthly_burn),
            minimum_close_target:    parseOrNull(form.minimum_close_target),
          })} data-testid="btn-save-runway">
            {mut.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Valuation editor ───────────────────────────────────────────────────────────

function ValuationEditorDialog({ roundId, round, onClose }: {
  roundId: number; round: Round; onClose: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    round_instrument:         round.round_instrument ?? "",
    pre_money_valuation:      round.pre_money_valuation ?? "",
    post_money_valuation:     round.post_money_valuation ?? "",
    share_price:              round.share_price ?? "",
    valuation_cap:            round.valuation_cap ?? "",
    discount_rate:            round.discount_rate ?? "",
    interest_rate:            round.interest_rate ?? "",
    option_pool_percent_pre:  round.option_pool_percent_pre ?? "",
    option_pool_percent_post: round.option_pool_percent_post ?? "",
    maturity_date:            round.maturity_date ?? "",
    legal_close_status:       round.legal_close_status ?? "",
  });
  const mut = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", `/api/capital/rounds/${roundId}/valuation`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/capital/rounds", roundId, "command-center"] });
      queryClient.invalidateQueries({ queryKey: ["/api/capital/rounds"] });
      toast({ title: "Valuation data saved" });
      onClose();
    },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });
  function ff(k: string, v: string) { setForm(p => ({ ...p, [k]: v })); }
  function pn(v: any) { const n = Number(v); return isNaN(n) || v === "" ? null : n; }
  const instrument = form.round_instrument;
  const isPriced = instrument === "priced_equity";
  const isSafe   = instrument === "SAFE" || instrument === "convertible_note";
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PieChart className="w-4 h-4 text-violet-400" /> Valuation & Instrument</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto pr-1">
          <div>
            <Label className="text-xs">Investment Instrument</Label>
            <Select value={form.round_instrument} onValueChange={v => ff("round_instrument", v)}>
              <SelectTrigger className="h-8 text-xs mt-1" data-testid="select-instrument">
                <SelectValue placeholder="Select instrument" />
              </SelectTrigger>
              <SelectContent>
                {["priced_equity","SAFE","convertible_note","grant","other"].map(i => (
                  <SelectItem key={i} value={i}>{instrumentLabel(i)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{isPriced ? "Pre-money Valuation" : "Pre-money / Cap"}</Label>
              <Input value={form.pre_money_valuation} onChange={e => ff("pre_money_valuation", e.target.value)}
                placeholder="e.g. 8000000" className="h-8 text-xs mt-1" data-testid="input-pre-money" />
            </div>
            {isPriced && (
              <div>
                <Label className="text-xs">Post-money (override)</Label>
                <Input value={form.post_money_valuation} onChange={e => ff("post_money_valuation", e.target.value)}
                  placeholder="computed automatically" className="h-8 text-xs mt-1" data-testid="input-post-money" />
              </div>
            )}
            {isPriced && (
              <div>
                <Label className="text-xs">Share Price</Label>
                <Input value={form.share_price} onChange={e => ff("share_price", e.target.value)}
                  placeholder="e.g. 100" className="h-8 text-xs mt-1" data-testid="input-share-price" />
              </div>
            )}
            {isSafe && (
              <div>
                <Label className="text-xs">Valuation Cap</Label>
                <Input value={form.valuation_cap} onChange={e => ff("valuation_cap", e.target.value)}
                  placeholder="e.g. 10000000" className="h-8 text-xs mt-1" data-testid="input-valuation-cap" />
              </div>
            )}
            {isSafe && (
              <div>
                <Label className="text-xs">Discount Rate (%)</Label>
                <Input value={form.discount_rate} onChange={e => ff("discount_rate", e.target.value)}
                  placeholder="e.g. 20" className="h-8 text-xs mt-1" data-testid="input-discount-rate" />
              </div>
            )}
            {isSafe && (
              <div>
                <Label className="text-xs">Interest Rate (%)</Label>
                <Input value={form.interest_rate} onChange={e => ff("interest_rate", e.target.value)}
                  placeholder="e.g. 6" className="h-8 text-xs mt-1" data-testid="input-interest-rate" />
              </div>
            )}
            {isSafe && (
              <div>
                <Label className="text-xs">Maturity Date</Label>
                <Input type="date" value={form.maturity_date} onChange={e => ff("maturity_date", e.target.value)}
                  className="h-8 text-xs mt-1" data-testid="input-maturity-date" />
              </div>
            )}
            <div>
              <Label className="text-xs">Option Pool Pre (%)</Label>
              <Input value={form.option_pool_percent_pre} onChange={e => ff("option_pool_percent_pre", e.target.value)}
                placeholder="e.g. 10" className="h-8 text-xs mt-1" data-testid="input-pool-pre" />
            </div>
            <div>
              <Label className="text-xs">Option Pool Post (%)</Label>
              <Input value={form.option_pool_percent_post} onChange={e => ff("option_pool_percent_post", e.target.value)}
                placeholder="e.g. 12" className="h-8 text-xs mt-1" data-testid="input-pool-post" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Legal Close Status</Label>
            <Select value={form.legal_close_status} onValueChange={v => ff("legal_close_status", v)}>
              <SelectTrigger className="h-8 text-xs mt-1" data-testid="select-legal-status">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                {["not_started","docs_in_progress","review","executed","closed"].map(s => (
                  <SelectItem key={s} value={s}>{s.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase())}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-[10px] text-muted-foreground">All monetary values in {round.currency}. Percentages as plain numbers (e.g. 10 for 10%). No cap table data is required — leave fields blank if unknown.</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={mut.isPending} onClick={() => mut.mutate({
            round_instrument:         form.round_instrument || null,
            pre_money_valuation:      pn(form.pre_money_valuation),
            post_money_valuation:     pn(form.post_money_valuation),
            share_price:              pn(form.share_price),
            valuation_cap:            pn(form.valuation_cap),
            discount_rate:            pn(form.discount_rate),
            interest_rate:            pn(form.interest_rate),
            option_pool_percent_pre:  pn(form.option_pool_percent_pre),
            option_pool_percent_post: pn(form.option_pool_percent_post),
            maturity_date:            form.maturity_date || null,
            legal_close_status:       form.legal_close_status || null,
          })} data-testid="btn-save-valuation">
            {mut.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Allocation editor ──────────────────────────────────────────────────────────

function AllocationEditorDialog({ row, roundId, onClose }: {
  row: AllocationRow; roundId: number; onClose: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    requested_amount:        row.requested_amount ?? "",
    allocation_amount:       row.allocation_amount ?? "",
    final_allocation_amount: row.final_allocation_amount ?? "",
    allocation_status:       row.allocation_status || "unallocated",
    closing_status:          row.closing_status || "not_started",
    docs_sent_at:            row.docs_sent_at ? row.docs_sent_at.slice(0, 10) : "",
    docs_signed_at:          row.docs_signed_at ? row.docs_signed_at.slice(0, 10) : "",
    funds_received_at:       row.funds_received_at ? row.funds_received_at.slice(0, 10) : "",
    allocation_notes:        row.allocation_notes ?? "",
  });
  const mut = useMutation({
    mutationFn: (data: any) => {
      if (!row.commitment_id) return Promise.reject(new Error("No commitment record — create a commitment first"));
      return apiRequest("PATCH", `/api/capital/commitments/${row.commitment_id}/allocation`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/capital/rounds", roundId, "command-center"] });
      toast({ title: "Allocation saved" });
      onClose();
    },
    onError: (e: any) => toast({ title: e?.message || "Save failed", variant: "destructive" }),
  });
  function ff(k: string, v: string) { setForm(p => ({ ...p, [k]: v })); }
  function pn(v: any) { const n = Number(v); return isNaN(n) || v === "" ? null : n; }
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-cyan-400" />
            {row.investor_name} — Allocation
          </DialogTitle>
        </DialogHeader>
        {!row.commitment_id && (
          <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
            No commitment record exists yet. Create a commitment in Funding Rounds first to track allocation.
          </div>
        )}
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Requested Amount</Label>
              <Input value={form.requested_amount} onChange={e => ff("requested_amount", e.target.value)}
                placeholder="investor's ask" className="h-8 text-xs mt-1" data-testid="input-requested-amount" />
            </div>
            <div>
              <Label className="text-xs">Proposed Allocation</Label>
              <Input value={form.allocation_amount} onChange={e => ff("allocation_amount", e.target.value)}
                placeholder="your offer" className="h-8 text-xs mt-1" data-testid="input-allocation-amount" />
            </div>
            <div>
              <Label className="text-xs">Final Allocation</Label>
              <Input value={form.final_allocation_amount} onChange={e => ff("final_allocation_amount", e.target.value)}
                placeholder="agreed final" className="h-8 text-xs mt-1" data-testid="input-final-allocation" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Allocation Status</Label>
              <Select value={form.allocation_status} onValueChange={v => ff("allocation_status", v)}>
                <SelectTrigger className="h-8 text-xs mt-1" data-testid="select-allocation-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["unallocated","proposed","reserved","confirmed","reduced","increased","rejected"].map(s => (
                    <SelectItem key={s} value={s}>{allocStatusLabel(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Closing Status</Label>
              <Select value={form.closing_status} onValueChange={v => ff("closing_status", v)}>
                <SelectTrigger className="h-8 text-xs mt-1" data-testid="select-closing-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["not_started","docs_sent","docs_signed","funds_pending","wired","closed","dropped"].map(s => (
                    <SelectItem key={s} value={s}>{closingStatusLabel(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Docs Sent</Label>
              <Input type="date" value={form.docs_sent_at} onChange={e => ff("docs_sent_at", e.target.value)}
                className="h-8 text-xs mt-1" data-testid="input-docs-sent" />
            </div>
            <div>
              <Label className="text-xs">Docs Signed</Label>
              <Input type="date" value={form.docs_signed_at} onChange={e => ff("docs_signed_at", e.target.value)}
                className="h-8 text-xs mt-1" data-testid="input-docs-signed" />
            </div>
            <div>
              <Label className="text-xs">Funds Received</Label>
              <Input type="date" value={form.funds_received_at} onChange={e => ff("funds_received_at", e.target.value)}
                className="h-8 text-xs mt-1" data-testid="input-funds-received" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea value={form.allocation_notes} onChange={e => ff("allocation_notes", e.target.value)}
              className="text-xs mt-1 min-h-[60px]" placeholder="allocation context, conditions…" data-testid="input-allocation-notes" />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={mut.isPending || !row.commitment_id}
            onClick={() => mut.mutate({
              requested_amount:        pn(form.requested_amount),
              allocation_amount:       pn(form.allocation_amount),
              final_allocation_amount: pn(form.final_allocation_amount),
              allocation_status:       form.allocation_status,
              closing_status:          form.closing_status,
              docs_sent_at:            form.docs_sent_at || null,
              docs_signed_at:          form.docs_signed_at || null,
              funds_received_at:       form.funds_received_at || null,
              allocation_notes:        form.allocation_notes || null,
            })} data-testid="btn-save-allocation">
            {mut.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function CapitalCommandCenterPage() {
  const { toast } = useToast();
  const [selectedRoundId, setSelectedRoundId]     = useState<number | null>(null);
  const [runwayEditorOpen, setRunwayEditorOpen]   = useState(false);
  const [valuationEditorOpen, setValuationEditorOpen] = useState(false);
  const [allocEditRow, setAllocEditRow]           = useState<AllocationRow | null>(null);

  const { data: rounds = [], isLoading: roundsLoading } = useQuery<Round[]>({
    queryKey: ["/api/capital/rounds"],
    queryFn: () => fetch("/api/capital/rounds", { credentials: "include" }).then(r => r.json()),
    select: (d: any[]) => (d.sort((a, b) => {
      const ord = ["Open","Closing","Soft Circled","Planning"];
      const ai = ord.indexOf(a.status), bi = ord.indexOf(b.status);
      if (ai !== bi) return (ai === -1 ? 9 : ai) - (bi === -1 ? 9 : bi);
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    })),
  });

  const activeRoundId = selectedRoundId ?? (rounds.find(r => r.status === "Open")?.id ?? rounds[0]?.id ?? null);

  const { data: ccData, isLoading: ccLoading, error: ccError } = useQuery<CommandCenterData>({
    queryKey: ["/api/capital/rounds", activeRoundId, "command-center"],
    queryFn: () => fetch(`/api/capital/rounds/${activeRoundId}/command-center`, { credentials: "include" }).then(r => {
      if (!r.ok) throw new Error("Failed");
      return r.json();
    }),
    enabled: !!activeRoundId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const round            = ccData?.round;
  const summary          = ccData?.summary;
  const leads            = ccData?.lead_candidates ?? [];
  const actions          = ccData?.this_week_actions ?? [];
  const flags            = ccData?.risk_flags ?? [];
  const runway           = ccData?.runway;
  const scenarios        = ccData?.scenarios ?? [];
  const valuation        = ccData?.valuation_summary;
  const dilutionScenarios = ccData?.dilution_scenarios ?? [];
  const allocationPlan   = ccData?.allocation_plan ?? [];
  const closePlan        = ccData?.close_plan;
  const closeChecklist   = ccData?.close_checklist ?? [];

  const criticalCount = flags.filter(f => f.level === "critical").length;

  if (roundsLoading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">Loading rounds…</div>;
  }
  if (!rounds.length) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground" data-testid="empty-no-rounds">
        <Target className="w-8 h-8 opacity-40" />
        <p className="text-sm">No funding rounds found. Create a round in Funding Rounds first.</p>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto space-y-6" data-testid="capital-command-center">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-primary/10 rounded-lg shrink-0">
            <Target className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold truncate">Round Command Center</h1>
            <p className="text-xs text-muted-foreground">Live fundraising intelligence — Trevor &amp; Scott only</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {criticalCount > 0 && (
            <Badge className="bg-red-600/20 text-red-400 border-red-600/30 text-xs" data-testid="badge-critical-flags">
              {criticalCount} critical
            </Badge>
          )}
          <Select
            value={String(activeRoundId)}
            onValueChange={v => setSelectedRoundId(Number(v))}
          >
            <SelectTrigger className="h-8 text-xs w-52" data-testid="round-selector">
              <SelectValue placeholder="Select round" />
            </SelectTrigger>
            <SelectContent>
              {rounds.map(r => (
                <SelectItem key={r.id} value={String(r.id)}>
                  {r.name} — {r.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {ccLoading && <div className="text-xs text-muted-foreground py-8 text-center">Loading command center…</div>}
      {ccError && <div className="text-xs text-red-400 py-4 text-center" data-testid="cc-error">Failed to load command center data.</div>}

      {round && summary && (
        <>
          {/* ── Round header ── */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge className={`text-xs border ${statusBadgeClass(round.status)}`} data-testid="badge-round-status">
                {round.status}
              </Badge>
              <span className="font-semibold">{round.name}</span>
              <span className="text-xs text-muted-foreground">{round.round_type}</span>
              {round.days_open != null && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {round.days_open}d open
                </span>
              )}
              {round.target_close_date && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> Close {fmtDate(round.target_close_date)}
                </span>
              )}
              {round.round_instrument && (
                <Badge className="text-[10px] bg-violet-500/15 text-violet-400 border-violet-500/20" data-testid="badge-instrument">
                  {instrumentLabel(round.round_instrument)}
                </Badge>
              )}
            </div>
            {summary.target_amount > 0 && (
              <ProgressBar
                committed={summary.committed_amount}
                weighted={summary.weighted_pipeline}
                target={summary.target_amount}
                currency={round.currency}
              />
            )}
          </div>

          {/* ── Summary cards ── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <SummaryCard label="Target"       value={fmtMoney(summary.target_amount)}       sub={round.currency} />
            <SummaryCard label="Min Close"    value={fmtMoney(summary.minimum_close_target)} sub="minimum raise" />
            <SummaryCard label="Committed"    value={fmtMoney(summary.committed_amount)}     sub={`${summary.committed_count} investors`} accent="text-emerald-400" />
            <SummaryCard label="Soft Circled" value={fmtMoney(summary.soft_circled_amount)}  sub={`${summary.soft_circled_count} investors`} accent="text-cyan-400" />
            <SummaryCard label="Weighted Pipeline" value={fmtMoney(summary.weighted_pipeline)} sub={`$${(summary.confidence_low/1e6).toFixed(1)}M–$${(summary.confidence_high/1e6).toFixed(1)}M range`} />
            <SummaryCard label="Remaining"    value={fmtMoney(summary.remaining_to_target)}  sub="to target" accent={summary.remaining_to_target === 0 ? "text-emerald-400" : ""} />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard label="Hot Investors" value={String(summary.hot_count)} sub="score ≥55" accent="text-red-400" />
            <SummaryCard label="Likely Leads"  value={String(summary.likely_lead_count)} sub="identified" accent={summary.likely_lead_count > 0 ? "text-emerald-400" : "text-red-400"} />
            <SummaryCard label="Active Investors" value={String(summary.total_active)} sub="in pipeline" />
            <SummaryCard label="To Min Close" value={fmtMoney(summary.remaining_to_min_close)} sub="remaining" accent={summary.remaining_to_min_close === 0 ? "text-emerald-400" : ""} />
          </div>

          {/* ── Lead Investors + This Week Actions ── */}
          <div className="grid lg:grid-cols-2 gap-5">

            {/* Lead investors */}
            <section>
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" data-testid="section-lead-investors">
                <Flame className="w-4 h-4 text-amber-400" /> Lead Investor Tracker
                <span className="text-xs text-muted-foreground font-normal">({leads.length})</span>
              </h2>
              {leads.length === 0 ? (
                <div className="bg-card border border-border rounded-xl p-6 text-center text-muted-foreground text-xs" data-testid="leads-empty">
                  No lead candidates identified. Tag investors as "Likely Lead" in the pipeline.
                </div>
              ) : (
                <div className="space-y-2" data-testid="lead-candidate-list">
                  {leads.map(lead => (
                    <div key={lead.id} className="bg-card border border-border rounded-xl p-3 space-y-1.5" data-testid={`lead-candidate-${lead.id}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium truncate">{lead.name}</span>
                            {lead.likely_lead && <Badge className="text-[9px] px-1 py-0 bg-amber-500/15 text-amber-400 border-amber-500/20">LEAD</Badge>}
                            <Badge className={`text-[9px] px-1 py-0 ${tierBadge(lead.tier)}`}>{lead.tier}</Badge>
                          </div>
                          <p className="text-[10px] text-muted-foreground">{lead.investor_type} · {lead.stage}</p>
                        </div>
                        <a href={`/capital/targets`} className="text-muted-foreground hover:text-foreground p-1 rounded shrink-0" data-testid={`btn-open-lead-${lead.id}`}>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-muted-foreground">
                        <span>Cheque: <span className="text-foreground">{fmtMoney(lead.target_cheque_amount)}</span></span>
                        {lead.committed_amount ? <span>Committed: <span className="text-emerald-400">{fmtMoney(lead.committed_amount)}</span></span> : null}
                        <span>Score: <span className="text-foreground">{lead.score}</span></span>
                        <span>Touch: <span className="text-foreground">{lead.last_touch_at ? fmtDateShort(lead.last_touch_at) : "Never"}</span></span>
                        <span>Emails: <span className="text-foreground">{lead.email_link_count}</span></span>
                      </div>
                      {lead.next_step && (
                        <p className="text-[10px] text-cyan-400 flex items-center gap-1">
                          <Zap className="w-2.5 h-2.5" /> {lead.next_step}
                          {lead.next_step_date && ` · ${fmtDateShort(lead.next_step_date)}`}
                        </p>
                      )}
                      {lead.risk_flags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {lead.risk_flags.map(rf => (
                            <span key={rf} className="text-[9px] bg-red-500/10 text-red-400 border border-red-500/20 rounded px-1.5 py-0.5">{rf}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* This week actions */}
            <section>
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" data-testid="section-this-week-actions">
                <Zap className="w-4 h-4 text-primary" /> This Week to Close
                <span className="text-xs text-muted-foreground font-normal">({actions.length} actions)</span>
              </h2>
              {actions.length === 0 ? (
                <div className="bg-card border border-border rounded-xl p-6 text-center text-muted-foreground text-xs" data-testid="actions-empty">
                  <CheckCircle2 className="w-6 h-6 mx-auto mb-2 text-emerald-400 opacity-60" />
                  No urgent actions this week. Good momentum.
                </div>
              ) : (
                <div className="space-y-1.5" data-testid="action-list">
                  {actions.map((a, i) => (
                    <div
                      key={`${a.investor_id}-${i}`}
                      className={`bg-card border border-l-2 ${priorityBg(a.priority)} border-border rounded-xl p-3 flex items-start gap-3`}
                      data-testid={`action-row-${a.investor_id}`}
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] uppercase font-semibold ${priorityColor(a.priority)}`}>{a.priority}</span>
                          <span className="text-xs font-medium truncate">{a.investor_name}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground">{a.reason}</p>
                        <p className="text-[10px] text-foreground/80 flex items-center gap-1">
                          <Activity className="w-2.5 h-2.5 text-primary" /> {a.action}
                        </p>
                        {a.due_date && <p className="text-[9px] text-muted-foreground/60">Due {fmtDateShort(a.due_date)}</p>}
                      </div>
                      <a href={`/capital/targets`} className="shrink-0 text-muted-foreground hover:text-foreground p-1 rounded" data-testid={`btn-action-open-${a.investor_id}`}>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* ── Risk flags ── */}
          {flags.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" data-testid="section-risk-flags">
                <Shield className="w-4 h-4 text-red-400" /> Round Risk Flags
                <span className="text-xs text-muted-foreground font-normal">({flags.length})</span>
              </h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2" data-testid="risk-flag-list">
                {flags.map(f => (
                  <div key={f.code} className={`flex items-start gap-2 rounded-xl px-3 py-2.5 border text-xs ${riskColor(f.level)}`} data-testid={`risk-flag-${f.code}`}>
                    {riskIcon(f.level)}
                    <span>{f.message}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
          {flags.length === 0 && !ccLoading && (
            <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3" data-testid="no-risk-flags">
              <CheckCircle2 className="w-4 h-4" /> No risk flags — round is on track.
            </div>
          )}

          {/* ── Runway + Scenarios ── */}
          <div className="grid lg:grid-cols-2 gap-5">

            {/* Runway */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold flex items-center gap-2" data-testid="section-runway">
                  <BarChart3 className="w-4 h-4 text-violet-400" /> Runway Impact
                </h2>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setRunwayEditorOpen(true)} data-testid="btn-edit-runway">
                  {runway?.has_data ? "Edit" : "Add Data"}
                </Button>
              </div>
              {!runway?.has_data ? (
                <div className="bg-card border border-border rounded-xl p-5 text-center text-muted-foreground text-xs space-y-2" data-testid="runway-no-data">
                  <BarChart3 className="w-6 h-6 mx-auto opacity-30" />
                  <p>Add cash balance and burn rate to see runway projections.</p>
                </div>
              ) : (
                <div className="bg-card border border-border rounded-xl p-4 space-y-3" data-testid="runway-data">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-muted-foreground text-[10px] uppercase">Cash on Hand</p>
                      <p className="font-semibold">{fmtMoney(runway.current_cash_balance)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-[10px] uppercase">Monthly Burn</p>
                      <p className="font-semibold">{fmtMoney(runway.monthly_burn)}</p>
                    </div>
                  </div>
                  <Separator />
                  <div className="space-y-2 text-xs">
                    {[
                      { label: "Runway today", val: runway.runway_today_months, date: runway.cashout_date_today, color: runway.runway_today_months != null && runway.runway_today_months < 9 ? "text-red-400" : "text-foreground" },
                      { label: "After min close", val: runway.runway_after_min_months, date: null, color: "text-foreground" },
                      { label: "After weighted pipeline", val: runway.runway_after_weighted_months, date: null, color: "text-cyan-400" },
                      { label: "After target close", val: runway.runway_after_target_months, date: runway.cashout_date_after_target, color: "text-emerald-400" },
                    ].map(row => (
                      <div key={row.label} className="flex justify-between items-center">
                        <span className="text-muted-foreground">{row.label}</span>
                        <span className={`font-medium ${row.color}`}>
                          {row.val != null ? `${row.val}mo` : "—"}
                          {row.date && <span className="text-muted-foreground/60 text-[9px] ml-1">({fmtDateShort(row.date)})</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* Scenarios */}
            <section>
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" data-testid="section-scenarios">
                <Rocket className="w-4 h-4 text-primary" /> Scenario Planning
              </h2>
              {scenarios.length === 0 ? (
                <div className="bg-card border border-border rounded-xl p-5 text-center text-xs text-muted-foreground" data-testid="scenarios-empty">
                  Set a target raise amount in Funding Rounds to see scenarios.
                </div>
              ) : (
                <div className="space-y-2" data-testid="scenario-list">
                  {(dilutionScenarios.length ? dilutionScenarios : scenarios).map(s => {
                    const ds = s as DilutionScenario;
                    return (
                      <div key={s.key} className="bg-card border border-border rounded-xl p-3 space-y-1.5" data-testid={`scenario-${s.key}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold">{s.name}</span>
                          <span className="text-sm font-bold text-foreground">{fmtMoney(s.amount)}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground">{s.description}</p>
                        <div className="flex gap-4 text-[10px] text-muted-foreground flex-wrap">
                          {s.runway_added_months != null && (
                            <span>+{s.runway_added_months}mo runway</span>
                          )}
                          {ds.post_money_valuation && (
                            <span className="text-violet-400">Post: {fmtMoney(ds.post_money_valuation)}</span>
                          )}
                          {ds.new_investor_pct != null && (
                            <span className="text-cyan-400">{ds.new_investor_pct}% new investors</span>
                          )}
                          {s.gap_to_target > 0 && (
                            <span className="text-amber-400">{fmtMoney(s.gap_to_target)} below target</span>
                          )}
                          {s.gap_to_target === 0 && s.required_additional === 0 && (
                            <span className="text-emerald-400">Target met ✓</span>
                          )}
                        </div>
                        {ds.dilution_warnings?.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {ds.dilution_warnings.map((w, i) => (
                              <span key={i} className="text-[9px] bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded px-1.5 py-0.5 flex items-center gap-1">
                                <Info className="w-2.5 h-2.5" />{w}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* ── Valuation & Dilution ── */}
          <section data-testid="section-valuation">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <PieChart className="w-4 h-4 text-violet-400" /> Valuation & Dilution
              </h2>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setValuationEditorOpen(true)}
                data-testid="btn-edit-valuation">
                {valuation?.has_valuation_data ? "Edit Valuation" : "Add Valuation"}
              </Button>
            </div>
            {!valuation?.has_valuation_data ? (
              <div className="bg-card border border-border rounded-xl p-5 text-center text-muted-foreground text-xs space-y-2" data-testid="no-valuation">
                <PieChart className="w-6 h-6 mx-auto opacity-30" />
                <p>Add valuation details to model investor ownership and dilution.</p>
                <p className="text-[10px]">No cap table required — just enter the fields you have.</p>
              </div>
            ) : (
              <div className="bg-card border border-border rounded-xl p-4 space-y-4" data-testid="valuation-data">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">Instrument</p>
                    <p className="font-semibold text-violet-400">{instrumentLabel(valuation.instrument)}</p>
                  </div>
                  {valuation.is_priced && (
                    <>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Pre-money</p>
                        <p className="font-semibold">{valuation.pre_money ? fmtMoney(valuation.pre_money) : "—"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Post-money</p>
                        <p className="font-semibold text-emerald-400">
                          {valuation.post_money_computed ? fmtMoney(valuation.post_money_computed) : (valuation.post_money_manual ? fmtMoney(valuation.post_money_manual) : "—")}
                        </p>
                      </div>
                      {valuation.share_price && (
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase">Share Price</p>
                          <p className="font-semibold">{fmtMoney(valuation.share_price)}</p>
                        </div>
                      )}
                    </>
                  )}
                  {valuation.is_safe_or_convertible && (
                    <>
                      {valuation.valuation_cap && (
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase">Valuation Cap</p>
                          <p className="font-semibold">{fmtMoney(valuation.valuation_cap)}</p>
                        </div>
                      )}
                      {valuation.discount_rate && (
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase">Discount Rate</p>
                          <p className="font-semibold">{valuation.discount_rate}%</p>
                        </div>
                      )}
                      {valuation.interest_rate && (
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase">Interest Rate</p>
                          <p className="font-semibold">{valuation.interest_rate}%</p>
                        </div>
                      )}
                      {valuation.maturity_date && (
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase">Maturity</p>
                          <p className="font-semibold">{fmtDate(valuation.maturity_date)}</p>
                        </div>
                      )}
                    </>
                  )}
                  {valuation.new_investor_ownership_pct != null && (
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase">
                        {valuation.is_safe_or_convertible ? "Est. Ownership (at cap)" : "New Investor Ownership"}
                      </p>
                      <p className="font-semibold text-cyan-400">{valuation.new_investor_ownership_pct}%</p>
                    </div>
                  )}
                  {(valuation.option_pool_pre != null || valuation.option_pool_post != null) && (
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase">Option Pool</p>
                      <p className="font-semibold">
                        {valuation.option_pool_pre != null ? `${valuation.option_pool_pre}%` : "—"}
                        {" → "}
                        {valuation.option_pool_post != null ? `${valuation.option_pool_post}%` : "—"}
                      </p>
                    </div>
                  )}
                  {valuation.legal_close_status && (
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase">Legal Status</p>
                      <p className="font-semibold capitalize">{valuation.legal_close_status.replace(/_/g," ")}</p>
                    </div>
                  )}
                </div>
                {valuation.warnings.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {valuation.warnings.map((w, i) => (
                      <span key={i} className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-lg px-2 py-1 flex items-center gap-1">
                        <Info className="w-2.5 h-2.5 shrink-0" />{w}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ── Investor Allocation Planner ── */}
          <section data-testid="section-allocation-planner">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-cyan-400" /> Investor Allocation Planner
                <span className="text-xs text-muted-foreground font-normal">({allocationPlan.length})</span>
              </h2>
            </div>
            {allocationPlan.length === 0 ? (
              <div className="bg-card border border-border rounded-xl p-5 text-center text-muted-foreground text-xs" data-testid="allocation-empty">
                No investors in the allocation plan. Add commitments in Funding Rounds.
              </div>
            ) : (
              <div className="bg-card border border-border rounded-xl overflow-hidden" data-testid="allocation-table">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/20">
                        <th className="text-left px-3 py-2 text-[10px] text-muted-foreground font-medium">Investor</th>
                        <th className="text-left px-3 py-2 text-[10px] text-muted-foreground font-medium">Stage</th>
                        <th className="text-right px-3 py-2 text-[10px] text-muted-foreground font-medium">Requested</th>
                        <th className="text-right px-3 py-2 text-[10px] text-muted-foreground font-medium">Proposed</th>
                        <th className="text-right px-3 py-2 text-[10px] text-muted-foreground font-medium">Final</th>
                        <th className="text-left px-3 py-2 text-[10px] text-muted-foreground font-medium">Alloc</th>
                        <th className="text-left px-3 py-2 text-[10px] text-muted-foreground font-medium">Closing</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {allocationPlan.map(row => (
                        <tr key={row.investor_id} className="border-b border-border/50 hover:bg-muted/10 transition-colors"
                          data-testid={`alloc-row-${row.investor_id}`}>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {row.likely_lead && <Flame className="w-2.5 h-2.5 text-amber-400 shrink-0" />}
                              <span className="font-medium truncate max-w-[130px]">{row.investor_name}</span>
                              <span className={`text-[9px] px-1 py-0.5 rounded ${tierBadge(row.tier)}`}>{row.score}</span>
                            </div>
                            <p className="text-[9px] text-muted-foreground">{row.investor_type}</p>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{row.stage}</td>
                          <td className="px-3 py-2 text-right">{fmtMoney(row.requested_amount)}</td>
                          <td className="px-3 py-2 text-right">{fmtMoney(row.allocation_amount)}</td>
                          <td className="px-3 py-2 text-right font-medium">{fmtMoney(row.final_allocation_amount)}</td>
                          <td className="px-3 py-2">
                            <span className={`text-[9px] px-1.5 py-0.5 rounded ${allocStatusColor(row.allocation_status)}`}>
                              {allocStatusLabel(row.allocation_status)}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`text-[9px] px-1.5 py-0.5 rounded ${closingStatusColor(row.closing_status)}`}>
                              {closingStatusLabel(row.closing_status)}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <button
                              onClick={() => setAllocEditRow(row)}
                              className="text-muted-foreground hover:text-foreground p-1 rounded"
                              data-testid={`btn-edit-alloc-${row.investor_id}`}
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-muted/10 border-t border-border">
                        <td className="px-3 py-2 text-[10px] text-muted-foreground font-medium" colSpan={2}>Totals ({allocationPlan.length})</td>
                        <td className="px-3 py-2 text-right text-[10px] font-medium">
                          {fmtMoney(allocationPlan.reduce((s,r) => s + (r.requested_amount || 0), 0))}
                        </td>
                        <td className="px-3 py-2 text-right text-[10px] font-medium">
                          {fmtMoney(allocationPlan.reduce((s,r) => s + (r.allocation_amount || 0), 0))}
                        </td>
                        <td className="px-3 py-2 text-right text-[10px] font-medium text-emerald-400">
                          {fmtMoney(allocationPlan.reduce((s,r) => s + (r.final_allocation_amount || 0), 0))}
                        </td>
                        <td colSpan={3}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </section>

          {/* ── Close Plan Tracker ── */}
          <section data-testid="section-close-plan">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <FileText className="w-4 h-4 text-emerald-400" /> Close Plan Tracker
            </h2>
            {closePlan && closePlan.alerts.length > 0 && (
              <div className="space-y-1.5 mb-3">
                {closePlan.alerts.map((alert, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{alert}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3" data-testid="close-plan-groups">
              {(closePlan?.groups ?? [])
                .filter(g => g.count > 0 || ["not_started","docs_sent","docs_signed","wired","closed"].includes(g.status))
                .map(g => (
                  <div
                    key={g.status}
                    className={`bg-card border border-border rounded-xl p-3 space-y-2 ${g.count === 0 ? "opacity-40" : ""}`}
                    data-testid={`close-plan-group-${g.status}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${closingStatusColor(g.status)}`}>
                        {g.label}
                      </span>
                      <span className="text-xs font-semibold">{g.count}</span>
                    </div>
                    {g.count > 0 && (
                      <>
                        <p className="text-sm font-bold">{fmtMoney(g.total_amount)}</p>
                        <div className="text-[10px] text-muted-foreground space-y-0.5">
                          {g.pct_of_target != null && <p>{g.pct_of_target}% of target</p>}
                          {g.pct_of_min_close != null && <p>{g.pct_of_min_close}% of min close</p>}
                        </div>
                        <div className="space-y-0.5">
                          {g.investors.slice(0, 3).map(inv => (
                            <p key={inv.investor_id} className="text-[10px] text-muted-foreground truncate">{inv.investor_name}</p>
                          ))}
                          {g.investors.length > 3 && (
                            <p className="text-[9px] text-muted-foreground/60">+{g.investors.length - 3} more</p>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
            </div>
          </section>

          {/* ── Close Checklist ── */}
          <section data-testid="section-close-checklist">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-primary" /> Round Close Checklist
            </h2>
            <div className="bg-card border border-border rounded-xl divide-y divide-border/50">
              {closeChecklist.map(item => (
                <div
                  key={item.key}
                  className="px-4 py-2.5 flex items-start gap-3"
                  data-testid={`checklist-item-${item.key}`}
                >
                  {item.complete
                    ? <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    : <Square className="w-4 h-4 text-muted-foreground/40 shrink-0 mt-0.5" />
                  }
                  <div className="min-w-0 flex-1">
                    <p className={`text-xs ${item.complete ? "text-foreground" : "text-muted-foreground"}`}>
                      {item.label}
                    </p>
                    {!item.complete && item.note && (
                      <p className="text-[10px] text-muted-foreground/70 mt-0.5">{item.note}</p>
                    )}
                  </div>
                  {item.complete && <span className="text-[9px] text-emerald-400 shrink-0">✓</span>}
                </div>
              ))}
            </div>
            {closeChecklist.length > 0 && (
              <p className="text-[10px] text-muted-foreground mt-2 text-right">
                {closeChecklist.filter(i => i.complete).length} / {closeChecklist.length} complete
              </p>
            )}
          </section>

          {/* ── Recent activity ── */}
          {ccData?.recent_activity && ccData.recent_activity.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" data-testid="section-recent-activity">
                <Activity className="w-4 h-4 text-muted-foreground" /> Recent Round Activity
              </h2>
              <div className="bg-card border border-border rounded-xl divide-y divide-border" data-testid="recent-activity-list">
                {ccData.recent_activity.slice(0, 6).map((a: any) => (
                  <div key={a.id} className="px-4 py-2.5 flex items-start gap-3">
                    <Activity className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs truncate">{a.title || a.type}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {a.actor_name || "System"} · {fmtDate(a.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* Dialogs */}
      {runwayEditorOpen && round && (
        <RunwayEditorDialog roundId={activeRoundId!} round={round} onClose={() => setRunwayEditorOpen(false)} />
      )}
      {valuationEditorOpen && round && (
        <ValuationEditorDialog roundId={activeRoundId!} round={round} onClose={() => setValuationEditorOpen(false)} />
      )}
      {allocEditRow && (
        <AllocationEditorDialog row={allocEditRow} roundId={activeRoundId!} onClose={() => setAllocEditRow(null)} />
      )}
    </div>
  );
}
