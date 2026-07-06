import { useState, useEffect } from "react";
import { UniversalDrilldownSheet, type UniversalDrilldownConfig } from "@/components/shared/universal-drilldown-sheet";
import { ScoreBadge } from "@/components/scores/score-badge";
import { useChurnRiskScores } from "@/hooks/use-scores";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AttachmentsSection } from "@/components/attachments-section";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  RefreshCcw, Heart, AlertTriangle, TrendingUp, TrendingDown, X, Plus, ChevronRight,
  Building2, CalendarClock, DollarSign, User, Zap, CheckCircle2, XCircle,
  Activity, Loader2, Shield, ArrowUpRight, Clock, Ban, Link2,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────
function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (24 * 3600 * 1000));
}

function fmtDate(dateStr: string | null | undefined) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

function fmtMoney(n: number | null | undefined) {
  if (!n && n !== 0) return "—";
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n}`;
}

function RenewalCountdown({ days }: { days: number | null }) {
  if (days === null) return <span className="text-muted-foreground text-xs">No renewal date</span>;
  if (days < 0) return <span className="text-red-400 text-xs font-medium">{Math.abs(days)}d overdue</span>;
  if (days <= 30) return <span className="text-red-400 text-xs font-medium">{days}d</span>;
  if (days <= 60) return <span className="text-amber-400 text-xs font-medium">{days}d</span>;
  if (days <= 120) return <span className="text-yellow-400 text-xs font-medium">{days}d</span>;
  return <span className="text-muted-foreground text-xs">{days}d</span>;
}

function HealthBadge({ score, status }: { score: number; status: string }) {
  const color =
    status === "healthy" ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/8" :
    status === "at_risk" ? "text-amber-400 border-amber-500/30 bg-amber-500/8" :
    "text-red-400 border-red-500/30 bg-red-500/8";
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${color}`}>
      <Heart className="h-2.5 w-2.5" /> {score}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "text-emerald-400 border-emerald-500/30",
    renewal_due: "text-amber-400 border-amber-500/30",
    renewal_in_progress: "text-blue-400 border-blue-500/30",
    renewed: "text-purple-400 border-purple-500/30",
    churn_risk: "text-red-400 border-red-500/30",
    cancelled: "text-muted-foreground border-border/40",
  };
  const labels: Record<string, string> = {
    active: "Active", renewal_due: "Renewal Due", renewal_in_progress: "In Progress",
    renewed: "Renewed", churn_risk: "Churn Risk", cancelled: "Cancelled",
  };
  return (
    <Badge variant="outline" className={`text-xs ${map[status] ?? ""}`}>
      {labels[status] ?? status}
    </Badge>
  );
}

// ── Customer Card ─────────────────────────────────────────────────────────────
function CustomerCard({ cs, onClick }: { cs: any; onClick: () => void }) {
  const days = daysUntil(cs.renewal_date);
  return (
    <div
      className="border border-border/50 rounded-lg p-3.5 hover:border-border transition-colors cursor-pointer bg-card hover:bg-muted/20"
      onClick={onClick}
      data-testid={`cs-card-${cs.id}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Building2 className="h-4 w-4 text-muted-foreground/60 flex-shrink-0" />
          <span className="font-medium text-sm truncate">{cs.account_name ?? `Account #${cs.account_id}`}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <HealthBadge score={cs.health_score ?? 100} status={cs.health_status ?? "healthy"} />
          <StatusBadge status={cs.status} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <DollarSign className="h-3 w-3" />
          <span>{fmtMoney(cs.arr)} ARR</span>
        </div>
        <div className="flex items-center gap-1">
          <CalendarClock className="h-3 w-3" />
          <RenewalCountdown days={days} />
        </div>
        <div className="flex items-center gap-1">
          <User className="h-3 w-3" />
          <span className="truncate">{cs.owner_name ?? "Unassigned"}</span>
        </div>
      </div>

      {cs.city && (
        <div className="mt-1.5 text-[11px] text-muted-foreground/60">{cs.city}{cs.state_province ? `, ${cs.state_province}` : ""}</div>
      )}
    </div>
  );
}

// ── Dashboard KPI Card ────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon: Icon, color, onClick }: { label: string; value: string | number; sub?: string; icon: any; color?: string; onClick?: () => void }) {
  return (
    <Card className={`border border-border/50 ${onClick ? "cursor-pointer hover:border-primary/40 transition-colors" : ""}`} onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-muted-foreground">{label}</span>
          <Icon className={`h-4 w-4 ${color ?? "text-muted-foreground/40"}`} />
        </div>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// ── Customer Detail Panel ─────────────────────────────────────────────────────
// ── CS Timeline icons ─────────────────────────────────────────────────────────
const CS_TIMELINE_ICONS: Record<string, { icon: any; color: string }> = {
  went_live:            { icon: Activity,      color: "text-emerald-400" },
  status_change:        { icon: Activity,      color: "text-blue-400"    },
  churn_flagged:        { icon: AlertTriangle, color: "text-red-400"     },
  renewal_won:          { icon: CheckCircle2,  color: "text-emerald-400" },
  renewal_lost:         { icon: XCircle,       color: "text-red-400"     },
  health_worsened:      { icon: TrendingDown,  color: "text-red-400"     },
  expansion_identified: { icon: TrendingUp,    color: "text-primary"     },
  expansion_linked:     { icon: Link2,         color: "text-primary"     },
  default:              { icon: Clock,         color: "text-muted-foreground" },
};

function CsTimelinePanel({ csId }: { csId: number }) {
  const { data: events = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/cs", csId, "timeline"],
    queryFn: () => fetch(`/api/cs/${csId}/timeline`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: 30000,
  });

  if (isLoading) return <div className="space-y-2 p-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>;
  if (!events.length) return (
    <div className="flex flex-col items-center justify-center py-10 gap-2 px-4">
      <Activity className="h-8 w-8 text-muted-foreground/30" />
      <p className="text-sm text-muted-foreground/60 text-center">No activity recorded yet</p>
      <p className="text-xs text-muted-foreground/40 text-center">Events appear when status changes, health worsens, renewals are won/lost, or expansion opportunities are identified.</p>
    </div>
  );

  return (
    <div className="relative p-4 space-y-0">
      <div className="absolute left-8 top-10 bottom-4 w-px bg-border/40" />
      {events.map((ev, i) => {
        const { icon: Icon, color } = CS_TIMELINE_ICONS[ev.event_type] ?? CS_TIMELINE_ICONS.default;
        return (
          <div key={ev.id} className="flex gap-3 relative py-1.5" data-testid={`cs-timeline-event-${ev.id}`}>
            <div className={`z-10 w-8 h-8 rounded-full bg-background border-2 shrink-0 flex items-center justify-center ${i === 0 ? "border-primary/40" : "border-border/60"}`}>
              <Icon className={`h-3.5 w-3.5 ${color}`} />
            </div>
            <div className="flex-1 min-w-0 pt-1">
              <p className="text-xs leading-snug">{ev.description}</p>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                {ev.actor_name ? `${ev.actor_name} · ` : ""}{fmtDate(ev.created_at)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CustomerDetailPanel({ csId, onClose }: { csId: number; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const [editFields, setEditFields] = useState<Record<string, any>>({});
  const [detailTab, setDetailTab] = useState("detail");
  const [linkOppId, setLinkOppId] = useState("");

  const detail = useQuery<any>({
    queryKey: ["/api/cs", csId],
    queryFn: () => fetch(`/api/cs/${csId}`, { credentials: "include" }).then(r => r.json()),
  });

  const update = useMutation({
    mutationFn: (body: any) => apiRequest("PATCH", `/api/cs/${csId}`, body),
    onSuccess: () => {
      toast({ title: "Saved" });
      qc.invalidateQueries({ queryKey: ["/api/cs", csId] });
      qc.invalidateQueries({ queryKey: ["/api/cs/dashboard"] });
      qc.invalidateQueries({ queryKey: ["/api/cs"] });
      setEditMode(false);
      setEditFields({});
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const computeHealth = useMutation({
    mutationFn: () => apiRequest("POST", `/api/cs/${csId}/compute-health`, {}),
    onSuccess: (d: any) => {
      toast({ title: "Health recomputed", description: `Score: ${d.score} (${d.status})` });
      qc.invalidateQueries({ queryKey: ["/api/cs", csId] });
      qc.invalidateQueries({ queryKey: ["/api/cs", csId, "timeline"] });
    },
  });

  const linkOpp = useMutation({
    mutationFn: (opportunityId: number) => apiRequest("POST", `/api/cs/${csId}/link-opportunity`, { opportunityId }),
    onSuccess: () => {
      toast({ title: "Expansion opportunity linked" });
      setLinkOppId("");
      qc.invalidateQueries({ queryKey: ["/api/cs", csId] });
      qc.invalidateQueries({ queryKey: ["/api/cs", csId, "timeline"] });
    },
    onError: (e: any) => toast({ title: "Link failed", description: e.message, variant: "destructive" }),
  });

  const unlinkOpp = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/cs/${csId}/link-opportunity`),
    onSuccess: () => {
      toast({ title: "Expansion opportunity unlinked" });
      qc.invalidateQueries({ queryKey: ["/api/cs", csId] });
    },
  });

  const d = detail.data;

  const handleSave = () => {
    if (Object.keys(editFields).length === 0) { setEditMode(false); return; }
    update.mutate(editFields);
  };

  const field = (label: string, key: string, value: any, type: "text" | "date" | "number" | "select" = "text", options?: string[]) => (
    <div className="space-y-0.5">
      <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">{label}</div>
      {editMode && type !== "select" ? (
        <Input
          type={type}
          className="h-7 text-xs"
          defaultValue={value ?? ""}
          onChange={e => setEditFields(prev => ({ ...prev, [key]: e.target.value || null }))}
        />
      ) : editMode && type === "select" && options ? (
        <Select defaultValue={value ?? ""} onValueChange={v => setEditFields(prev => ({ ...prev, [key]: v }))}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {options.map(o => <SelectItem key={o} value={o}>{o.replace(/_/g, " ")}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : (
        <div className="text-sm">{value ?? <span className="text-muted-foreground/40 italic">—</span>}</div>
      )}
    </div>
  );

  const statusOptions = ["active", "renewal_due", "renewal_in_progress", "renewed", "churn_risk", "cancelled"];
  const billingOptions = ["current", "overdue", "paused"];
  const expansionOptions = ["none", "low", "medium", "high"];

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full lg:w-[480px] bg-background border-l border-border shadow-2xl flex flex-col" data-testid="cs-detail-panel">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/50">
        <div className="flex items-center gap-2">
          <RefreshCcw className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">{d?.account_name ?? "Customer"}</span>
          {d && <StatusBadge status={d.status} />}
        </div>
        <div className="flex items-center gap-1.5">
          {editMode ? (
            <>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setEditMode(false); setEditFields({}); }}>Cancel</Button>
              <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={update.isPending} data-testid="btn-cs-save">
                {update.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditMode(true)} data-testid="btn-cs-edit">Edit</Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
      </div>

      {/* Sub-tabs: Detail | Timeline */}
      <div className="border-b border-border/50 px-5 flex gap-4">
        {["detail", "timeline"].map(t => (
          <button key={t} onClick={() => setDetailTab(t)}
            className={`py-2 text-xs font-medium capitalize border-b-2 transition-colors ${detailTab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            data-testid={`cs-tab-${t}`}>
            {t === "timeline" ? "Timeline" : "Detail"}
          </button>
        ))}
      </div>

      {detailTab === "timeline" ? (
        <ScrollArea className="flex-1 min-h-0"><CsTimelinePanel csId={csId} /></ScrollArea>
      ) : (
      <ScrollArea className="flex-1 min-h-0">
        {detail.isLoading && (
          <div className="p-5 space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
        )}
        {d && (
          <div className="p-5 space-y-5">
            {/* Health score */}
            <div className="rounded-lg border border-border/50 p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Health</span>
                <Button size="sm" variant="ghost" className="h-6 text-xs gap-1" onClick={() => computeHealth.mutate()} disabled={computeHealth.isPending} data-testid="btn-compute-health">
                  {computeHealth.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" />}
                  Recompute
                </Button>
              </div>
              <div className="flex items-center gap-3">
                <div className={`text-3xl font-bold tabular-nums ${d.health_status === "healthy" ? "text-emerald-400" : d.health_status === "at_risk" ? "text-amber-400" : "text-red-400"}`}>
                  {d.health_score ?? 100}
                </div>
                <div className="flex-1 space-y-1">
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${d.health_status === "healthy" ? "bg-emerald-400" : d.health_status === "at_risk" ? "bg-amber-400" : "bg-red-400"}`}
                      style={{ width: `${d.health_score ?? 100}%` }} />
                  </div>
                  <div className="text-xs text-muted-foreground capitalize">{(d.health_status ?? "healthy").replace("_", " ")}</div>
                </div>
              </div>
              {d.churn_risk_flags && Array.isArray(d.churn_risk_flags) && d.churn_risk_flags.length > 0 && (
                <div className="space-y-1">
                  {(d.churn_risk_flags as string[]).map((f, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs text-amber-400">
                      <AlertTriangle className="h-3 w-3 flex-shrink-0" /> {f}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Core fields */}
            <div className="grid grid-cols-2 gap-3">
              {field("Status", "status", d.status, "select", statusOptions)}
              {field("Billing", "billingStatus", d.billing_status, "select", billingOptions)}
              {field("MRR", "mrr", d.mrr, "number")}
              {field("ARR", "arr", d.arr, "number")}
              {field("Renewal Date", "renewalDate", d.renewal_date ? d.renewal_date.slice(0, 10) : "", "date")}
              {field("Contract (months)", "contractTermMonths", d.contract_term_months, "number")}
              {field("Go-Live Date", "goLiveDate", d.go_live_date ? d.go_live_date.slice(0, 10) : "", "date")}
              {field("Sub Start", "subscriptionStart", d.subscription_start ? d.subscription_start.slice(0, 10) : "", "date")}
              {field("Sub End", "subscriptionEnd", d.subscription_end ? d.subscription_end.slice(0, 10) : "", "date")}
              {field("Last Check-in", "lastCheckinAt", d.last_checkin_at ? d.last_checkin_at.slice(0, 10) : "", "date")}
            </div>

            <Separator />

            {/* Renewal countdown */}
            {d.renewal_date && (
              <div className="rounded-lg border border-border/50 p-3 flex items-center justify-between">
                <div className="text-xs text-muted-foreground">Renewal</div>
                <div className="text-right">
                  <div className="text-sm font-medium">{fmtDate(d.renewal_date)}</div>
                  <RenewalCountdown days={daysUntil(d.renewal_date)} />
                </div>
              </div>
            )}

            {/* Expansion */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Expansion</div>
              <div className="grid grid-cols-2 gap-3">
                {field("Potential", "expansionPotential", d.expansion_potential, "select", expansionOptions)}
                {field("Expansion Notes", "expansionNotes", d.expansion_notes, "text")}
              </div>
              {/* Linked expansion opportunity */}
              <div className="rounded-md border border-border/50 bg-muted/20 p-3 space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">Expansion Opportunity</div>
                {d.exp_opp_id ? (
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium">{d.exp_opp_title}</p>
                      <p className="text-[10px] text-muted-foreground capitalize">{d.exp_opp_status}{d.exp_opp_amount ? ` · $${Number(d.exp_opp_amount).toLocaleString()}` : ""}</p>
                    </div>
                    <button onClick={() => unlinkOpp.mutate()} className="text-[10px] text-red-400 hover:text-red-500 shrink-0" data-testid="btn-unlink-opp">Unlink</button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input placeholder="Opportunity ID" value={linkOppId} onChange={e => setLinkOppId(e.target.value)} className="h-7 text-xs flex-1" type="number" min="1" data-testid="input-link-opp-id" />
                    <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={() => linkOppId && linkOpp.mutate(parseInt(linkOppId))} disabled={!linkOppId || linkOpp.isPending} data-testid="btn-link-opp">
                      {linkOpp.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Link"}
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <Separator />

            {/* Linked objects */}
            <div className="space-y-2 text-xs">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Linked Records</div>
              {d.deploy_number && <div className="flex items-center justify-between"><span className="text-muted-foreground">Deployment</span><span>{d.deploy_number} · {d.deployment_status}</span></div>}
              {d.install_title && <div className="flex items-center justify-between"><span className="text-muted-foreground">Install</span><span className="truncate max-w-[200px]">{d.install_title}</span></div>}
              {d.opportunity_title && <div className="flex items-center justify-between"><span className="text-muted-foreground">Opportunity</span><span className="truncate max-w-[200px]">{d.opportunity_title}</span></div>}
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notes</div>
              {editMode ? (
                <textarea
                  className="w-full rounded-md border border-border bg-muted/30 text-xs p-2.5 resize-none h-20 focus:outline-none focus:ring-1 focus:ring-ring"
                  defaultValue={d.notes ?? ""}
                  onChange={e => setEditFields(prev => ({ ...prev, notes: e.target.value || null }))}
                />
              ) : (
                <div className="text-sm text-muted-foreground whitespace-pre-line">{d.notes || <span className="italic text-muted-foreground/40">No notes</span>}</div>
              )}
            </div>

            {/* Tasks */}
            {d.tasks && d.tasks.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Renewal Tasks</div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-xs gap-1 px-2"
                      onClick={() => window.dispatchEvent(new CustomEvent("open-quick-capture", { detail: { tab: "task", prefill: { title: `Renewal task: ${d.account_name || "customer"}`, linkedObjectType: "customer_success", linkedObjectId: csId, accountId: d.account_id } } }))}
                      data-testid={`button-add-task-renewal-${csId}`}
                    >
                      <Plus className="h-3 w-3" /> Add Task
                    </Button>
                  </div>
                  {(d.tasks as any[]).map((t: any) => (
                    <div key={t.id} className="flex items-start gap-2 text-xs border border-border/40 rounded-md p-2">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{t.title}</div>
                        <div className="text-muted-foreground mt-0.5">{fmtDate(t.due_date)} · {t.status}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <Separator />
            <AttachmentsSection objectType="customer_success" objectId={csId} />
          </div>
        )}
      </ScrollArea>
      )}
    </div>
  );
}

// ── New Customer Modal ────────────────────────────────────────────────────────
function NewCustomerModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    accountId: "", ownerUserId: "", mrr: "", arr: "",
    renewalDate: "", goLiveDate: "", status: "active",
    contractTermMonths: "12", expansionPotential: "none", notes: "",
  });

  // Search accounts
  const [accountSearch, setAccountSearch] = useState("");
  const accountsQ = useQuery<any[]>({
    queryKey: ["/api/accounts", accountSearch],
    queryFn: () => fetch(`/api/accounts?search=${encodeURIComponent(accountSearch)}&limit=20`, { credentials: "include" }).then(r => r.json()),
    enabled: accountSearch.length >= 1,
  });

  const usersQ = useQuery<any[]>({
    queryKey: ["/api/users"],
    queryFn: () => fetch("/api/users", { credentials: "include" }).then(r => r.json()),
  });

  const create = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/cs", body),
    onSuccess: () => {
      toast({ title: "Customer added" });
      qc.invalidateQueries({ queryKey: ["/api/cs/dashboard"] });
      qc.invalidateQueries({ queryKey: ["/api/cs"] });
      onCreated();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleSubmit = () => {
    if (!form.accountId) { toast({ title: "Account is required", variant: "destructive" }); return; }
    create.mutate({
      accountId: parseInt(form.accountId),
      ownerUserId: form.ownerUserId ? parseInt(form.ownerUserId) : undefined,
      mrr: form.mrr ? parseFloat(form.mrr) : 0,
      arr: form.arr ? parseFloat(form.arr) : 0,
      renewalDate: form.renewalDate || undefined,
      goLiveDate: form.goLiveDate || undefined,
      status: form.status,
      contractTermMonths: parseInt(form.contractTermMonths) || 12,
      expansionPotential: form.expansionPotential,
      notes: form.notes || undefined,
    });
  };

  const [selectedAccount, setSelectedAccount] = useState<any>(null);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/50">
          <span className="font-semibold text-sm">Add Customer to CS</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className="p-5 space-y-4">
          {/* Account search */}
          <div className="space-y-1.5">
            <Label className="text-xs">Account *</Label>
            {selectedAccount ? (
              <div className="flex items-center justify-between rounded-md border border-border/50 px-3 py-2 text-sm">
                <span>{selectedAccount.name}</span>
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => { setSelectedAccount(null); setForm(f => ({ ...f, accountId: "" })); }}>Change</Button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  placeholder="Search accounts..."
                  value={accountSearch}
                  onChange={e => setAccountSearch(e.target.value)}
                  className="h-8 text-xs"
                  data-testid="input-cs-account-search"
                />
                {accountsQ.data && accountsQ.data.length > 0 && (
                  <div className="absolute z-10 w-full bg-background border border-border rounded-md mt-1 max-h-40 overflow-auto shadow-lg">
                    {(accountsQ.data as any[]).map((a: any) => (
                      <button key={a.id} className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors"
                        onClick={() => { setSelectedAccount(a); setForm(f => ({ ...f, accountId: String(a.id) })); setAccountSearch(""); }}>
                        {a.name} {a.city ? `· ${a.city}` : ""}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Success Owner</Label>
              <Select value={form.ownerUserId} onValueChange={v => setForm(f => ({ ...f, ownerUserId: v }))}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-cs-owner"><SelectValue placeholder="Assign owner" /></SelectTrigger>
                <SelectContent>
                  {(usersQ.data ?? []).map((u: any) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["active","renewal_due","renewal_in_progress","renewed","churn_risk"].map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">MRR ($)</Label>
              <Input type="number" value={form.mrr} onChange={e => setForm(f => ({ ...f, mrr: e.target.value }))} className="h-8 text-xs" placeholder="0" data-testid="input-cs-mrr" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">ARR ($)</Label>
              <Input type="number" value={form.arr} onChange={e => setForm(f => ({ ...f, arr: e.target.value }))} className="h-8 text-xs" placeholder="Auto from MRR" data-testid="input-cs-arr" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Renewal Date</Label>
              <Input type="date" value={form.renewalDate} onChange={e => setForm(f => ({ ...f, renewalDate: e.target.value }))} className="h-8 text-xs" data-testid="input-cs-renewal-date" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Go-Live Date</Label>
              <Input type="date" value={form.goLiveDate} onChange={e => setForm(f => ({ ...f, goLiveDate: e.target.value }))} className="h-8 text-xs" data-testid="input-cs-golive-date" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Contract (months)</Label>
              <Input type="number" value={form.contractTermMonths} onChange={e => setForm(f => ({ ...f, contractTermMonths: e.target.value }))} className="h-8 text-xs" data-testid="input-cs-contract-months" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Expansion Potential</Label>
              <Select value={form.expansionPotential} onValueChange={v => setForm(f => ({ ...f, expansionPotential: v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["none","low","medium","high"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <textarea
              className="w-full rounded-md border border-border bg-muted/30 text-xs p-2.5 resize-none h-16 focus:outline-none focus:ring-1 focus:ring-ring"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Optional notes..."
              data-testid="input-cs-notes"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-border/50">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSubmit} disabled={create.isPending} data-testid="btn-cs-create">
            {create.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
            Add Customer
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Dashboard Tab ─────────────────────────────────────────────────────────────
function DashboardTab() {
  const dash = useQuery<any>({
    queryKey: ["/api/cs/dashboard"],
    queryFn: () => fetch("/api/cs/dashboard", { credentials: "include" }).then(r => r.json()),
  });
  const { toast } = useToast();
  const qc = useQueryClient();

  const runCheck = useMutation({
    mutationFn: () => apiRequest("POST", "/api/cs/renewal-check", {}),
    onSuccess: (d: any) => {
      toast({ title: "Renewal check complete", description: `${d.recordsChecked} customers checked` });
      qc.invalidateQueries({ queryKey: ["/api/cs/dashboard"] });
    },
  });

  if (dash.isLoading) return <div className="grid grid-cols-4 gap-3">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-24" />)}</div>;
  const d = dash.data;
  if (!d) return null;

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Active Customers" value={d.overview.active} icon={CheckCircle2} color="text-emerald-400" />
        <KpiCard label="Renewal Due"     value={d.overview.renewalDue} sub={`${d.overview.renewalInProgress} in progress`} icon={RefreshCcw} color="text-amber-400" onClick={dd("cs_renewals_due", "Renewals Due")} />
        <KpiCard label="Churn Risk"      value={d.overview.churnRisk} icon={AlertTriangle} color="text-red-400" onClick={dd("cs_at_risk", "Churn Risk Accounts")} />
        <KpiCard label="Total ARR"       value={fmtMoney(d.overview.totalArr)} sub={`${fmtMoney(d.overview.totalMrr)}/mo MRR`} icon={DollarSign} color="text-primary" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Upcoming renewals */}
        <div className="md:col-span-2 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Upcoming Renewals</span>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => runCheck.mutate()} disabled={runCheck.isPending} data-testid="btn-renewal-check">
              {runCheck.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />}
              Run Renewal Check
            </Button>
          </div>
          {d.upcomingRenewals.length === 0 && <div className="text-xs text-muted-foreground text-center py-6">No upcoming renewals</div>}
          {d.upcomingRenewals.map((cs: any) => {
            const days = daysUntil(cs.renewal_date);
            return (
              <div key={cs.id} className="flex items-center justify-between border border-border/40 rounded-md px-3 py-2 text-xs" data-testid={`dashboard-renewal-${cs.id}`}>
                <div className="flex items-center gap-2">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground/60" />
                  <span className="font-medium">{cs.account_name}</span>
                  <StatusBadge status={cs.status} />
                  {churnScores[cs.account_id] && churnScores[cs.account_id].band !== "low" && (
                    <ScoreBadge score={churnScores[cs.account_id]} variant="compact" data-testid={`score-churn-risk-${cs.account_id}`} />
                  )}
                </div>
                <div className="flex items-center gap-3 text-right">
                  <span className="text-muted-foreground">{fmtDate(cs.renewal_date)}</span>
                  <RenewalCountdown days={days} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Health breakdown */}
        <div className="space-y-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Health</span>
          {d.byHealth.map((h: any) => (
            <div key={h.health_status} className="flex items-center justify-between border border-border/40 rounded-md px-3 py-2 text-xs">
              <span className="capitalize">{(h.health_status ?? "unknown").replace("_", " ")}</span>
              <span className={`font-bold ${h.health_status === "healthy" ? "text-emerald-400" : h.health_status === "at_risk" ? "text-amber-400" : "text-red-400"}`}>{h.cnt}</span>
            </div>
          ))}
          <Separator />
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">At-Risk Accounts</span>
            {d.atRisk.slice(0, 5).map((cs: any) => (
              <div key={cs.id} className="flex items-center gap-2 text-xs border border-red-500/20 rounded-md px-2.5 py-1.5" data-testid={`dashboard-atrisk-${cs.id}`}>
                <AlertTriangle className="h-3 w-3 text-red-400 flex-shrink-0" />
                <span className="truncate flex-1">{cs.account_name}</span>
                <HealthBadge score={cs.health_score ?? 0} status={cs.health_status} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Expansion */}
      {d.expansionOpportunities.length > 0 && (
        <div className="space-y-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Expansion Opportunities</span>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {d.expansionOpportunities.map((cs: any) => (
              <div key={cs.id} className="border border-primary/20 bg-primary/5 rounded-md px-3 py-2 text-xs space-y-0.5" data-testid={`dashboard-expansion-${cs.id}`}>
                <div className="flex items-center gap-1.5 font-medium">
                  <ArrowUpRight className="h-3.5 w-3.5 text-primary" /> {cs.account_name}
                </div>
                <div className="text-muted-foreground capitalize">{cs.expansion_potential} potential · {fmtMoney(cs.arr)} ARR</div>
                {cs.expansion_notes && <div className="text-muted-foreground/60 truncate">{cs.expansion_notes}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function RenewalsPage() {
  const [drilldown, setDrilldown] = useState<UniversalDrilldownConfig | null>(null);
  const dd = (metric: string, title: string) => () => setDrilldown({ metric, title });
  const [activeTab, setActiveTab] = useState("customers");
  const [selectedCsId, setSelectedCsId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [healthFilter, setHealthFilter] = useState<string>("all");
  const qc = useQueryClient();

  // Shift the global FAB left when the right detail panel is open
  useEffect(() => {
    if (selectedCsId !== null) {
      document.body.classList.add("has-right-panel");
      document.body.style.setProperty("--right-panel-width", "480px");
    } else {
      document.body.classList.remove("has-right-panel");
      document.body.style.removeProperty("--right-panel-width");
    }
    return () => {
      document.body.classList.remove("has-right-panel");
      document.body.style.removeProperty("--right-panel-width");
    };
  }, [selectedCsId]);
  const { scoreMap: churnScores } = useChurnRiskScores();

  // Build query params for active tab
  const buildParams = () => {
    const p: Record<string, string> = {};
    if (activeTab === "renewals") p.status = "renewal_due";
    if (activeTab === "churn") { /* health filter below */ }
    if (activeTab === "expansion") p.expansion = "medium";
    if (statusFilter !== "all" && activeTab === "customers") p.status = statusFilter;
    if (healthFilter !== "all") p.health = healthFilter;
    return new URLSearchParams(p).toString();
  };

  const listQ = useQuery<any>({
    queryKey: ["/api/cs", activeTab, statusFilter, healthFilter],
    queryFn: () => {
      const params: Record<string, string> = {};
      if (activeTab === "renewals") params.status = "renewal_due";
      else if (activeTab === "churn") params.health = "at_risk";
      else if (activeTab === "expansion") params.expansion = "medium";
      else {
        if (statusFilter !== "all") params.status = statusFilter;
        if (healthFilter !== "all") params.health = healthFilter;
      }
      const qs = new URLSearchParams(params).toString();
      return fetch(`/api/cs${qs ? `?${qs}` : ""}`, { credentials: "include" }).then(r => r.json());
    },
    enabled: activeTab !== "dashboard",
  });

  const items: any[] = listQ.data?.data ?? [];

  return (
    <div className="relative flex-1 flex flex-col h-full overflow-hidden">
      {/* Overlay for detail panel */}
      {selectedCsId && <div className="fixed inset-0 z-30 bg-black/20" onClick={() => setSelectedCsId(null)} />}

      <div className="p-6 flex-1 overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <RefreshCcw className="h-5 w-5 text-primary" />
              Customer Success
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">Renewals, health, and expansion tracking for live customers</p>
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => setShowNew(true)} data-testid="btn-add-customer">
            <Plus className="h-3.5 w-3.5" /> Add Customer
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="customers" data-testid="tab-customers">Customers</TabsTrigger>
            <TabsTrigger value="renewals" data-testid="tab-renewals">Renewals</TabsTrigger>
            <TabsTrigger value="churn" data-testid="tab-churn">Churn Risk</TabsTrigger>
            <TabsTrigger value="expansion" data-testid="tab-expansion">Expansion</TabsTrigger>
            <TabsTrigger value="dashboard" data-testid="tab-dashboard">Dashboard</TabsTrigger>
          </TabsList>

          {/* Customers Tab */}
          <TabsContent value="customers">
            <div className="flex items-center gap-2 mb-3">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-8 text-xs w-44" data-testid="select-status-filter">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {["active","renewal_due","renewal_in_progress","renewed","churn_risk","cancelled"].map(s => (
                    <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={healthFilter} onValueChange={setHealthFilter}>
                <SelectTrigger className="h-8 text-xs w-36" data-testid="select-health-filter">
                  <SelectValue placeholder="All health" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All health</SelectItem>
                  <SelectItem value="healthy">Healthy</SelectItem>
                  <SelectItem value="at_risk">At Risk</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {listQ.isLoading && <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>}
            {!listQ.isLoading && items.length === 0 && (
              <div className="text-center py-16 text-muted-foreground">
                <RefreshCcw className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
                <p className="text-sm">No customers yet.</p>
                <Button size="sm" variant="outline" className="mt-3" onClick={() => setShowNew(true)}>Add first customer</Button>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {items.map(cs => <CustomerCard key={cs.id} cs={cs} onClick={() => setSelectedCsId(cs.id)} />)}
            </div>
          </TabsContent>

          {/* Renewals Tab */}
          <TabsContent value="renewals">
            {listQ.isLoading && <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>}
            {!listQ.isLoading && items.length === 0 && (
              <div className="text-center py-16 text-muted-foreground">
                <CheckCircle2 className="h-10 w-10 mx-auto mb-2 text-emerald-500" />
                <p>No renewal-due customers.</p>
              </div>
            )}
            <div className="space-y-2">
              {items.map(cs => {
                const days = daysUntil(cs.renewal_date);
                return (
                  <div key={cs.id} className={`flex items-center justify-between border rounded-lg px-4 py-3 cursor-pointer hover:bg-muted/20 transition-colors ${days !== null && days < 0 ? "border-red-500/30" : days !== null && days <= 30 ? "border-amber-500/30" : "border-border/50"}`}
                    onClick={() => setSelectedCsId(cs.id)} data-testid={`renewal-row-${cs.id}`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <HealthBadge score={cs.health_score ?? 100} status={cs.health_status ?? "healthy"} />
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{cs.account_name}</div>
                        <div className="text-xs text-muted-foreground">{fmtMoney(cs.arr)} ARR · {cs.owner_name ?? "Unassigned"}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">{fmtDate(cs.renewal_date)}</div>
                        <RenewalCountdown days={days} />
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/40" />
                    </div>
                  </div>
                );
              })}
            </div>
          </TabsContent>

          {/* Churn Risk Tab */}
          <TabsContent value="churn">
            {listQ.isLoading && <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>}
            {!listQ.isLoading && items.length === 0 && (
              <div className="text-center py-16 text-muted-foreground">
                <Shield className="h-10 w-10 mx-auto mb-2 text-emerald-500" />
                <p>No at-risk customers — great!</p>
              </div>
            )}
            <div className="space-y-2">
              {items.map(cs => (
                <div key={cs.id} className="border border-red-500/20 bg-red-500/5 rounded-lg p-3.5 cursor-pointer hover:border-red-500/40 transition-colors"
                  onClick={() => setSelectedCsId(cs.id)} data-testid={`churn-row-${cs.id}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground/60" />
                      <span className="font-medium text-sm">{cs.account_name}</span>
                      <HealthBadge score={cs.health_score ?? 0} status={cs.health_status ?? "critical"} />
                    </div>
                    <StatusBadge status={cs.status} />
                  </div>
                  {cs.churn_risk_flags && Array.isArray(cs.churn_risk_flags) && cs.churn_risk_flags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {(cs.churn_risk_flags as string[]).map((f: string, i: number) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-full">{f}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </TabsContent>

          {/* Expansion Tab */}
          <TabsContent value="expansion">
            {listQ.isLoading && <div className="grid grid-cols-2 gap-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}</div>}
            {!listQ.isLoading && items.length === 0 && (
              <div className="text-center py-16 text-muted-foreground">
                <TrendingUp className="h-10 w-10 mx-auto mb-2 text-muted-foreground/30" />
                <p>No expansion opportunities identified.</p>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {items.map(cs => (
                <div key={cs.id} className="border border-primary/20 bg-primary/5 rounded-lg p-3.5 cursor-pointer hover:border-primary/40 transition-colors"
                  onClick={() => setSelectedCsId(cs.id)} data-testid={`expansion-row-${cs.id}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <ArrowUpRight className="h-4 w-4 text-primary" />
                      <span className="font-medium text-sm">{cs.account_name}</span>
                    </div>
                    <Badge variant="outline" className="text-xs capitalize text-primary border-primary/30">{cs.expansion_potential}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">{fmtMoney(cs.arr)} ARR</div>
                  {cs.expansion_notes && <div className="text-xs text-muted-foreground/60 mt-1.5 line-clamp-2">{cs.expansion_notes}</div>}
                </div>
              ))}
            </div>
          </TabsContent>

          {/* Dashboard Tab */}
          <TabsContent value="dashboard">
            <DashboardTab />
          </TabsContent>
        </Tabs>
      </div>

      {/* Detail panel */}
      {selectedCsId && (
        <CustomerDetailPanel csId={selectedCsId} onClose={() => setSelectedCsId(null)} />
      )}

      {/* New customer modal */}
      {showNew && (
        <NewCustomerModal onClose={() => setShowNew(false)} onCreated={() => setShowNew(false)} />
      )}

      <UniversalDrilldownSheet
        config={drilldown}
        onClose={() => setDrilldown(null)}
        endpoint="/api/insights/drilldown"
      />
    </div>
  );
}
