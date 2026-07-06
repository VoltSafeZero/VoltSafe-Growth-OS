import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { TrendingUp, Plus, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const INVESTOR_TYPES = [
  "Angel","HNW Angel","Family Office","Venture Capital","Strategic Investor",
  "Government Investment","Grant / Non-Dilutive","Debt / Loan","Connector / Referrer",
];
const PIPELINE_STAGES = [
  "Target Identified","Intro Needed","Intro Made","First Meeting","Follow-Up",
  "Diligence","Partner Meeting","Soft Commit","Committed","Wired / Closed","Passed",
];

function fmtMoney(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v}`;
}
function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}
function stageColor(s: string) {
  if (["Committed","Wired / Closed"].includes(s)) return "border-l-emerald-500 bg-emerald-500/5";
  if (s === "Soft Commit")                        return "border-l-cyan-500 bg-cyan-500/5";
  if (["Diligence","Partner Meeting"].includes(s)) return "border-l-violet-500 bg-violet-500/5";
  if (s === "Passed")                             return "border-l-muted-foreground/30 bg-muted/20";
  return "border-l-border/50 bg-card/30";
}
function priorityDot(p: string) {
  if (p === "Critical" || p === "High") return "bg-red-400";
  if (p === "Medium") return "bg-amber-400";
  return "bg-muted-foreground/40";
}

type Investor = {
  id: number; name: string; investor_type: string; priority: string; stage: string;
  check_size_min: number | null; check_size_max: number | null; probability: number | null;
  next_step: string | null; next_step_date: string | null; source: string | null;
  introducer_name: string | null; can_write_cheque: boolean;
};
type StageSummary = { stage: string; count: string; total_max: string; total_weighted: string; };

const BLANK = { name: "", investor_type: "Venture Capital", stage: "Target Identified", priority: "Medium" };

export default function CapitalPipeline() {
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<any>({ ...BLANK });
  const [stageMoving, setStageMoving] = useState<number | null>(null);

  const { data, isLoading } = useQuery<{ stagesSummary: StageSummary[]; investors: Investor[] }>({
    queryKey: ["/api/capital/pipeline"],
    queryFn: () => fetch("/api/capital/pipeline").then(r => r.json()),
  });

  const createMut = useMutation({
    mutationFn: (d: any) => apiRequest("POST", "/api/capital/investors", d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/capital/pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/capital/investors"] });
      setCreating(false); setForm({ ...BLANK }); toast({ title: "Investor added to pipeline" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.message, variant: "destructive" }),
  });
  const stageMut = useMutation({
    mutationFn: ({ id, stage }: { id: number; stage: string }) => apiRequest("PATCH", `/api/capital/investors/${id}`, { stage }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/capital/pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/capital/investors"] });
      setStageMoving(null); toast({ title: "Stage updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.message, variant: "destructive" }),
  });

  if (isLoading) return (
    <div className="p-6 space-y-4">
      <Skeleton className="h-8 w-48" />
      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
    </div>
  );

  const investors = data?.investors ?? [];
  const summaryMap = Object.fromEntries((data?.stagesSummary ?? []).map(s => [s.stage, s]));

  const byStage: Record<string, Investor[]> = {};
  for (const inv of investors) {
    if (!byStage[inv.stage]) byStage[inv.stage] = [];
    byStage[inv.stage].push(inv);
  }
  const stages = PIPELINE_STAGES.filter(s => byStage[s]?.length > 0);

  const totalWeighted = investors
    .filter(i => !["Passed"].includes(i.stage))
    .reduce((sum, i) => {
      const max = i.check_size_max;
      const prob = i.probability;
      return sum + (max != null && prob != null ? Math.round(max * prob / 100) : 0);
    }, 0);

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="px-6 py-4 border-b border-border/40 shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" /> Investor Pipeline
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {investors.length} investor{investors.length !== 1 ? "s" : ""} · Weighted: {fmtMoney(totalWeighted)}
          </p>
        </div>
        <Button size="sm" onClick={() => { setForm({ ...BLANK }); setCreating(true); }} data-testid="btn-add-investor-pipeline">
          <Plus className="w-4 h-4 mr-1.5" /> Add Investor
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        {stages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center">
            <TrendingUp className="w-8 h-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">No investors in pipeline yet. Add investors from the Investor Targets page.</p>
          </div>
        ) : stages.map(stage => {
          const list = byStage[stage] ?? [];
          const summary = summaryMap[stage];
          return (
            <div key={stage} className={`rounded-xl border border-l-4 overflow-hidden ${stageColor(stage)}`}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/20">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">{stage}</h3>
                  <Badge variant="secondary" className="text-xs">{list.length}</Badge>
                </div>
                <div className="text-right">
                  {summary?.total_max && Number(summary.total_max) > 0 && (
                    <p className="text-xs text-muted-foreground">Max: <span className="text-foreground font-medium">{fmtMoney(Number(summary.total_max))}</span></p>
                  )}
                  {summary?.total_weighted && Number(summary.total_weighted) > 0 && (
                    <p className="text-xs text-muted-foreground">Weighted: <span className="text-primary font-medium">{fmtMoney(Number(summary.total_weighted))}</span></p>
                  )}
                </div>
              </div>
              <div className="divide-y divide-border/20">
                {list.map(inv => (
                  <div key={inv.id} className="px-4 py-2.5" data-testid={`pipeline-card-${inv.id}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 min-w-0">
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${priorityDot(inv.priority)}`} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-medium text-foreground truncate">{inv.name}</p>
                            {!inv.can_write_cheque && <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />}
                          </div>
                          <p className="text-xs text-muted-foreground">{inv.investor_type}</p>
                          {(inv.next_step || inv.next_step_date) && (
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">
                              {inv.next_step && <span>{inv.next_step}</span>}
                              {inv.next_step_date && <span className={`ml-1 ${new Date(inv.next_step_date) < new Date() ? "text-red-400" : ""}`}>· {fmtDate(inv.next_step_date)}</span>}
                            </p>
                          )}
                          {inv.introducer_name && (
                            <p className="text-xs text-muted-foreground">via {inv.introducer_name}</p>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 text-right space-y-1">
                        {(inv.check_size_min || inv.check_size_max) && (
                          <p className="text-xs text-muted-foreground">{fmtMoney(inv.check_size_min)}–{fmtMoney(inv.check_size_max)}</p>
                        )}
                        {inv.probability != null && (
                          <p className="text-xs text-muted-foreground">{inv.probability}%</p>
                        )}
                        <Select
                          value={inv.stage}
                          onValueChange={s => stageMut.mutate({ id: inv.id, stage: s })}
                        >
                          <SelectTrigger className="h-6 text-xs w-[130px] mt-1" onClick={e => e.stopPropagation()}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PIPELINE_STAGES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick Add Dialog */}
      <Dialog open={creating} onOpenChange={v => !v && setCreating(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Investor to Pipeline</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Name *</Label>
              <Input value={form.name} onChange={e => setForm((p: any) => ({ ...p, name: e.target.value }))} placeholder="Investor or fund name" className="mt-1" data-testid="input-pipeline-investor-name" />
            </div>
            <div>
              <Label>Investor Type</Label>
              <Select value={form.investor_type} onValueChange={v => setForm((p: any) => ({ ...p, investor_type: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{INVESTOR_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Stage</Label>
              <Select value={form.stage} onValueChange={v => setForm((p: any) => ({ ...p, stage: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{PIPELINE_STAGES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Priority</Label>
              <Select value={form.priority} onValueChange={v => setForm((p: any) => ({ ...p, priority: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Critical","High","Medium","Low"].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Check Size Max ($)</Label>
              <Input type="number" value={form.check_size_max ?? ""} onChange={e => setForm((p: any) => ({ ...p, check_size_max: e.target.value ? Number(e.target.value) : null }))} placeholder="500000" className="mt-1" />
            </div>
            <div>
              <Label>Probability (%)</Label>
              <Input type="number" min="0" max="100" value={form.probability ?? ""} onChange={e => setForm((p: any) => ({ ...p, probability: e.target.value ? Number(e.target.value) : null }))} placeholder="25" className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={() => {
              if (!form.name?.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
              createMut.mutate(form);
            }} disabled={createMut.isPending}>
              {createMut.isPending ? "Adding…" : "Add Investor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
