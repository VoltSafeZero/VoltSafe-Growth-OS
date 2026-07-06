import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  TrendingUp, Plus, ChevronDown, ChevronRight, AlertTriangle,
  Users, Calendar, DollarSign, Activity, Zap, Flame,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { InvestorDetail, fmtMoney, INVESTOR_TYPES, PIPELINE_STAGES, type Investor } from "./capital-investors";
import { useQuery as useDetailQuery } from "@tanstack/react-query";

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}
function isOverdue(d: string | null | undefined): boolean {
  if (!d) return false;
  return new Date(d) < new Date();
}

function stageAccentClass(s: string) {
  if (["Committed", "Wired / Closed"].includes(s)) return "border-l-emerald-500";
  if (s === "Soft Commit")                          return "border-l-cyan-500";
  if (["Diligence", "Partner Meeting"].includes(s)) return "border-l-violet-500";
  if (s === "Passed")                               return "border-l-border/30";
  return "border-l-border/40";
}
function stageBgClass(s: string) {
  if (["Committed", "Wired / Closed"].includes(s)) return "bg-emerald-500/5";
  if (s === "Soft Commit")                          return "bg-cyan-500/5";
  if (["Diligence", "Partner Meeting"].includes(s)) return "bg-violet-500/5";
  if (s === "Passed")                               return "bg-muted/10";
  return "bg-card/20";
}
function priorityDot(p: string) {
  if (p === "Critical" || p === "High") return "bg-red-400";
  if (p === "Medium") return "bg-amber-400";
  return "bg-muted-foreground/40";
}

type PipelineInvestor = Investor & {
  primary_contact_name: string | null;
  last_activity_at: string | null;
  committed_amount: number | null;
};

type StageSummary = {
  stage: string;
  count: string;
  total_max: string;
  total_weighted: string;
  total_committed: string;
};

const BLANK = { name: "", investor_type: "Venture Capital", stage: "Target Identified", priority: "Medium" };

export default function CapitalPipeline() {
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [createStage, setCreateStage] = useState("Target Identified");
  const [form, setForm] = useState<any>({ ...BLANK });
  const [collapsedStages, setCollapsedStages] = useState<Set<string>>(new Set(["Passed"]));
  const [detailId, setDetailId] = useState<number | null>(null);
  const [stagePending, setStagePending] = useState<number | null>(null);

  const { data, isLoading, isError } = useQuery<{ stagesSummary: StageSummary[]; investors: PipelineInvestor[] }>({
    queryKey: ["/api/capital/pipeline"],
    queryFn: () => fetch("/api/capital/pipeline", { credentials: "include" }).then(r => {
      if (!r.ok) throw new Error("Failed to load pipeline");
      return r.json();
    }),
  });

  const { data: intel } = useQuery<{
    hot_count: number; warm_count: number; overdue_follow_ups: number;
    at_risk_count: number; never_contacted: number;
  }>({
    queryKey: ["/api/capital/intelligence/pipeline"],
    queryFn: () => fetch("/api/capital/intelligence/pipeline", { credentials: "include" }).then(r => r.json()),
  });

  const { data: detailData } = useDetailQuery<Investor>({
    queryKey: ["/api/capital/investors", detailId],
    queryFn: () => fetch(`/api/capital/investors/${detailId}`, { credentials: "include" }).then(r => r.json()),
    enabled: detailId != null,
  });

  const createMut = useMutation({
    mutationFn: (d: any) => apiRequest("POST", "/api/capital/investors", d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/capital/pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/capital/investors"] });
      setCreating(false);
      setForm({ ...BLANK });
      toast({ title: "Investor added to pipeline" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.message, variant: "destructive" }),
  });

  const stageMut = useMutation({
    mutationFn: ({ id, stage }: { id: number; stage: string }) =>
      apiRequest("PATCH", `/api/capital/investors/${id}`, { stage }),
    onMutate: ({ id }) => setStagePending(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/capital/pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/capital/investors"] });
      setStagePending(null);
      toast({ title: "Stage updated" });
    },
    onError: (e: any) => {
      setStagePending(null);
      toast({ title: "Error", description: e?.message, variant: "destructive" });
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PATCH", `/api/capital/investors/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/capital/pipeline"] });
      if (detailId) queryClient.invalidateQueries({ queryKey: ["/api/capital/investors", detailId] });
    },
  });

  function toggleStage(stage: string) {
    setCollapsedStages(prev => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage); else next.add(stage);
      return next;
    });
  }

  function openCreate(stage: string) {
    setCreateStage(stage);
    setForm({ ...BLANK, stage });
    setCreating(true);
  }

  if (isLoading) return (
    <div className="p-6 space-y-4">
      <Skeleton className="h-8 w-48" />
      {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
    </div>
  );

  if (isError) return (
    <div className="flex flex-col items-center justify-center h-64 text-center px-6">
      <AlertTriangle className="w-8 h-8 text-amber-400 mb-3" />
      <p className="text-sm font-medium text-foreground">Could not load pipeline</p>
      <p className="text-xs text-muted-foreground mt-1">Refresh the page or contact your admin.</p>
    </div>
  );

  const investors = data?.investors ?? [];
  const summaryMap = Object.fromEntries((data?.stagesSummary ?? []).map(s => [s.stage, s]));
  const byStage: Record<string, PipelineInvestor[]> = {};
  for (const inv of investors) {
    if (!byStage[inv.stage]) byStage[inv.stage] = [];
    byStage[inv.stage].push(inv);
  }

  const totalInvestors = investors.filter(i => i.stage !== "Passed").length;
  const totalWeighted  = investors
    .filter(i => i.stage !== "Passed")
    .reduce((sum, i) => {
      const max = i.check_size_max;
      const prob = i.probability;
      return sum + (max != null && prob != null ? Math.round(max * prob / 100) : 0);
    }, 0);
  const totalCommitted = investors
    .filter(i => !["Passed"].includes(i.stage))
    .reduce((sum, i) => sum + (Number(i.committed_amount) || 0), 0);

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border/40 shrink-0">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" /> Investor Pipeline
            </h1>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
              <span>{totalInvestors} active investor{totalInvestors !== 1 ? "s" : ""}</span>
              {totalWeighted > 0 && (
                <span>Weighted: <span className="text-primary font-medium">{fmtMoney(totalWeighted)}</span></span>
              )}
              {totalCommitted > 0 && (
                <span>Committed: <span className="text-emerald-400 font-medium">{fmtMoney(totalCommitted)}</span></span>
              )}
            </div>
          </div>
          <Button size="sm" onClick={() => openCreate("Target Identified")} data-testid="btn-add-investor-pipeline">
            <Plus className="w-4 h-4 mr-1.5" /> Add Investor
          </Button>
        </div>
      </div>

      {/* Intelligence strip */}
      {intel && (intel.hot_count > 0 || intel.warm_count > 0 || intel.overdue_follow_ups > 0 || intel.at_risk_count > 0) && (
        <div className="px-6 py-2 border-b border-border/20 flex items-center gap-4 bg-muted/10 text-xs flex-wrap shrink-0"
          data-testid="intelligence-strip">
          <span className="text-muted-foreground font-medium flex items-center gap-1">
            <Zap className="w-3 h-3 text-primary" /> Intelligence:
          </span>
          {intel.hot_count > 0 && (
            <span className="flex items-center gap-1 text-red-400 font-medium">
              <Flame className="w-3 h-3" /> {intel.hot_count} Hot
            </span>
          )}
          {intel.warm_count > 0 && (
            <span className="flex items-center gap-1 text-amber-400">
              {intel.warm_count} Warm
            </span>
          )}
          {intel.overdue_follow_ups > 0 && (
            <span className="flex items-center gap-1 text-amber-400">
              <AlertTriangle className="w-3 h-3" /> {intel.overdue_follow_ups} overdue
            </span>
          )}
          {intel.at_risk_count > 0 && (
            <span className="text-muted-foreground">
              {intel.at_risk_count} at risk
            </span>
          )}
          {intel.never_contacted > 0 && (
            <span className="text-muted-foreground">
              {intel.never_contacted} never contacted
            </span>
          )}
        </div>
      )}

      {/* Stage list */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
        {PIPELINE_STAGES.map(stage => {
          const list = byStage[stage] ?? [];
          const summary = summaryMap[stage];
          const collapsed = collapsedStages.has(stage);
          const isEmpty = list.length === 0;

          return (
            <div
              key={stage}
              className={`rounded-xl border border-l-4 overflow-hidden transition-all ${stageAccentClass(stage)} ${stageBgClass(stage)} border-border/30`}
              data-testid={`pipeline-stage-${stage.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
            >
              {/* Stage header */}
              <button
                className="w-full flex items-center justify-between px-4 py-3 border-b border-border/20 text-left hover:bg-white/5 transition-colors"
                onClick={() => toggleStage(stage)}
                aria-expanded={!collapsed}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {collapsed ? (
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  )}
                  <span className="text-sm font-semibold text-foreground truncate">{stage}</span>
                  <Badge variant="secondary" className="text-xs shrink-0">{list.length}</Badge>
                </div>
                <div className="flex items-center gap-4 shrink-0" onClick={e => e.stopPropagation()}>
                  {summary && (
                    <div className="text-right space-y-0.5">
                      {Number(summary.total_committed) > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Committed: <span className="text-emerald-400 font-medium">{fmtMoney(Number(summary.total_committed))}</span>
                        </p>
                      )}
                      {Number(summary.total_max) > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Max: <span className="text-foreground font-medium">{fmtMoney(Number(summary.total_max))}</span>
                        </p>
                      )}
                      {Number(summary.total_weighted) > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Weighted: <span className="text-primary font-medium">{fmtMoney(Number(summary.total_weighted))}</span>
                        </p>
                      )}
                    </div>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 shrink-0 opacity-60 hover:opacity-100"
                    onClick={() => openCreate(stage)}
                    title={`Add investor to ${stage}`}
                    data-testid={`btn-add-to-stage-${stage.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </button>

              {/* Investor cards */}
              {!collapsed && (
                <div>
                  {isEmpty ? (
                    <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground/60">
                      <span>No investors in this stage.</span>
                      <button
                        className="underline underline-offset-2 hover:text-muted-foreground transition-colors"
                        onClick={() => openCreate(stage)}
                      >
                        Add one
                      </button>
                    </div>
                  ) : (
                    <div className="divide-y divide-border/15">
                      {list.map(inv => (
                        <div
                          key={inv.id}
                          className="px-4 py-3 hover:bg-white/5 transition-colors cursor-pointer group"
                          onClick={() => setDetailId(inv.id)}
                          data-testid={`pipeline-card-${inv.id}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            {/* Left: priority + name + meta */}
                            <div className="flex items-start gap-2 min-w-0 flex-1">
                              <div className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${priorityDot(inv.priority)}`} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <p className="text-sm font-medium text-foreground">{inv.name}</p>
                                  {!inv.can_write_cheque && (
                                    <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" title="No direct cheque" />
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground">{inv.investor_type}</p>

                                {/* Meta row */}
                                <div className="flex items-center gap-3 mt-1 flex-wrap">
                                  {inv.primary_contact_name && (
                                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                                      <Users className="w-2.5 h-2.5" /> {inv.primary_contact_name}
                                    </span>
                                  )}
                                  {inv.last_activity_at && (
                                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                                      <Activity className="w-2.5 h-2.5" /> {fmtDate(inv.last_activity_at)}
                                    </span>
                                  )}
                                  {Number(inv.committed_amount) > 0 && (
                                    <span className="text-xs text-emerald-400 flex items-center gap-1">
                                      <DollarSign className="w-2.5 h-2.5" /> {fmtMoney(Number(inv.committed_amount))} committed
                                    </span>
                                  )}
                                </div>

                                {/* Next step */}
                                {(inv.next_step || inv.next_step_date) && (
                                  <p className="text-xs mt-1 text-muted-foreground truncate">
                                    {inv.next_step && <span>{inv.next_step}</span>}
                                    {inv.next_step_date && (
                                      <span className={`ml-1 ${isOverdue(inv.next_step_date) ? "text-red-400" : ""}`}>
                                        · <Calendar className="w-2.5 h-2.5 inline mr-0.5" />{fmtDate(inv.next_step_date)}
                                      </span>
                                    )}
                                  </p>
                                )}

                                {inv.introducer_name && (
                                  <p className="text-xs text-muted-foreground mt-0.5">via {inv.introducer_name}</p>
                                )}
                              </div>
                            </div>

                            {/* Right: cheque size + stage dropdown */}
                            <div className="shrink-0 text-right space-y-1.5 min-w-[130px]">
                              {(inv.check_size_min || inv.check_size_max) && (
                                <p className="text-xs text-muted-foreground">
                                  {fmtMoney(inv.check_size_min)}–{fmtMoney(inv.check_size_max)}
                                </p>
                              )}
                              {inv.probability != null && (
                                <p className="text-xs text-muted-foreground">{inv.probability}%</p>
                              )}
                              <div onClick={e => e.stopPropagation()}>
                                <Select
                                  value={inv.stage}
                                  onValueChange={s => stageMut.mutate({ id: inv.id, stage: s })}
                                  disabled={stagePending === inv.id}
                                >
                                  <SelectTrigger className="h-6 text-xs w-[130px]" data-testid={`stage-select-${inv.id}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {PIPELINE_STAGES.map(s => (
                                      <SelectItem key={s} value={s}>{s}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Investor detail drawer */}
      <Sheet open={detailId != null} onOpenChange={v => !v && setDetailId(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto" side="right">
          {detailData ? (
            <InvestorDetail
              investor={detailData}
              onEdit={() => setDetailId(null)}
              onStageChange={stage => {
                if (detailData) updateMut.mutate({ id: detailData.id, data: { stage } });
              }}
            />
          ) : (
            <div className="flex items-center justify-center h-40">
              <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Quick Add Dialog */}
      <Dialog open={creating} onOpenChange={v => !v && setCreating(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Investor to Pipeline</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Name *</Label>
              <Input
                value={form.name}
                onChange={e => setForm((p: any) => ({ ...p, name: e.target.value }))}
                placeholder="Investor or fund name"
                className="mt-1"
                data-testid="input-pipeline-investor-name"
              />
            </div>
            <div>
              <Label>Investor Type</Label>
              <Select value={form.investor_type} onValueChange={v => setForm((p: any) => ({ ...p, investor_type: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INVESTOR_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Stage</Label>
              <Select value={form.stage} onValueChange={v => setForm((p: any) => ({ ...p, stage: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PIPELINE_STAGES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Priority</Label>
              <Select value={form.priority} onValueChange={v => setForm((p: any) => ({ ...p, priority: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Critical", "High", "Medium", "Low"].map(p => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Check Size Max ($)</Label>
              <Input
                type="number"
                value={form.check_size_max ?? ""}
                onChange={e => setForm((p: any) => ({ ...p, check_size_max: e.target.value ? Number(e.target.value) : null }))}
                placeholder="500000"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Probability (%)</Label>
              <Input
                type="number"
                min="0"
                max="100"
                value={form.probability ?? ""}
                onChange={e => setForm((p: any) => ({ ...p, probability: e.target.value ? Number(e.target.value) : null }))}
                placeholder="25"
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!form.name?.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
                createMut.mutate(form);
              }}
              disabled={createMut.isPending}
              data-testid="btn-submit-pipeline-investor"
            >
              {createMut.isPending ? "Adding…" : "Add Investor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
