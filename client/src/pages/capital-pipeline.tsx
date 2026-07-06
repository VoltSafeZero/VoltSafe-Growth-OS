import { useQuery } from "@tanstack/react-query";
import { TrendingUp, DollarSign } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

const STAGE_ORDER = [
  "Target Identified","Researching","Intro Needed","Intro Requested","Intro Made",
  "First Contacted","Meeting Booked","First Meeting Complete","Interested",
  "Data Room Shared","Diligence","Partner / IC Review","Soft Commitment",
  "Committed","Wired","Passed","Nurture",
];

function fmt(cents: number | null | undefined): string {
  if (!cents) return "—";
  const v = cents / 100;
  if (v >= 1_000_000) return `$${(v/1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${(v/1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function stageColor(s: string) {
  if (["Committed","Wired"].includes(s))          return "border-l-emerald-500 bg-emerald-500/5";
  if (["Soft Commitment"].includes(s))            return "border-l-cyan-500 bg-cyan-500/5";
  if (["Diligence","Partner / IC Review","Interested"].includes(s)) return "border-l-violet-500 bg-violet-500/5";
  if (["Data Room Shared"].includes(s))           return "border-l-blue-500 bg-blue-500/5";
  if (["Passed","Nurture"].includes(s))           return "border-l-muted-foreground/30 bg-muted/20";
  return "border-l-border/50 bg-card/30";
}

function priorityDot(p: string) {
  if (p === "High")   return "bg-red-400";
  if (p === "Medium") return "bg-amber-400";
  return "bg-muted-foreground/40";
}

type Funder = { id: number; name: string; funder_type: string; priority: string; expected_amount_cents: number | null; weighted_amount_cents: number | null; probability_percent: number | null; pipeline_stage: string; relationship_strength: string; };
type StageSummary = { pipeline_stage: string; count: string; total_expected: string; total_weighted: string; };

export default function CapitalPipeline() {
  const { data, isLoading } = useQuery<{ stagesSummary: StageSummary[]; funders: Funder[] }>({
    queryKey: ["/api/capital/pipeline"],
    queryFn: () => fetch("/api/capital/pipeline").then(r => r.json()),
  });

  if (isLoading) return (
    <div className="p-6 space-y-4">
      <Skeleton className="h-8 w-48" />
      {Array.from({length:4}).map((_,i) => <Skeleton key={i} className="h-24" />)}
    </div>
  );

  const funders = data?.funders ?? [];
  const summaryMap = Object.fromEntries((data?.stagesSummary ?? []).map(s => [s.pipeline_stage, s]));

  const byStage: Record<string, Funder[]> = {};
  for (const f of funders) {
    if (!byStage[f.pipeline_stage]) byStage[f.pipeline_stage] = [];
    byStage[f.pipeline_stage].push(f);
  }

  const stages = STAGE_ORDER.filter(s => byStage[s]?.length > 0);

  const totalWeighted = funders
    .filter(f => !["Passed","Nurture"].includes(f.pipeline_stage))
    .reduce((s, f) => s + (f.weighted_amount_cents ?? 0), 0);

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="px-6 py-4 border-b border-border/40 shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" /> Investor Pipeline
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {funders.length} investor{funders.length !== 1 ? "s" : ""} · Weighted: {fmt(totalWeighted)}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        {stages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center">
            <TrendingUp className="w-8 h-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">No investors in pipeline yet. Add investors from the Investors page.</p>
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
                  <p className="text-xs text-muted-foreground">Expected: <span className="text-foreground font-medium">{fmt(Number(summary?.total_expected ?? 0))}</span></p>
                  <p className="text-xs text-muted-foreground">Weighted: <span className="text-primary font-medium">{fmt(Number(summary?.total_weighted ?? 0))}</span></p>
                </div>
              </div>
              <div className="divide-y divide-border/20">
                {list.map(f => (
                  <div key={f.id} className="flex items-center justify-between px-4 py-2.5" data-testid={`pipeline-row-${f.id}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${priorityDot(f.priority)}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{f.name}</p>
                        <p className="text-xs text-muted-foreground">{f.funder_type} · {f.relationship_strength}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-4">
                      <p className="text-sm font-semibold text-foreground">{fmt(f.expected_amount_cents)}</p>
                      {f.probability_percent != null && (
                        <p className="text-xs text-muted-foreground">{f.probability_percent}% → {fmt(f.weighted_amount_cents)}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
