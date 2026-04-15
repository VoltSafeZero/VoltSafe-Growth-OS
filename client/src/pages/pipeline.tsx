import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  TrendingUp, AlertTriangle, Flame, Users, DollarSign,
  Clock, Building2, ChevronRight, BarChart3, ArrowUpRight,
  RefreshCw, ArrowRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type OppRow = {
  id: number; title: string; stage: string; amount?: number;
  accountName: string; ownerName: string; daysSinceActivity: number;
  lastActivityDate?: string; updatedAt: string;
};

type StageRow = {
  stage: string; probability: number; count: number; totalAmount: number; weightedAmount: number;
};

type OwnerRow = { owner: string; count: number; totalAmount: number; stalled: number };

type PipelineData = {
  stalled: OppRow[];
  noNextStep: OppRow[];
  highValueInactive: OppRow[];
  byStage: StageRow[];
  byOwner: OwnerRow[];
  totalActive: number;
  totalPipeline: number;
};

const STAGE_LABELS: Record<string, string> = {
  inbound_new: "New", qualifying: "Qualifying", proposal: "Proposal",
  negotiation: "Negotiating", verbal_commit: "Verbal Commit",
  closed_won: "Won", closed_lost: "Lost",
};

const STAGE_NEXT: Record<string, string[]> = {
  inbound_new: ["qualifying", "closed_lost"],
  qualifying: ["proposal", "closed_lost"],
  proposal: ["negotiation", "closed_lost"],
  negotiation: ["verbal_commit", "closed_lost"],
  verbal_commit: ["closed_won", "closed_lost"],
};

const STAGE_PROB_COLOR: Record<string, string> = {
  inbound_new: "bg-gray-500/20 text-gray-400",
  qualifying: "bg-purple-500/20 text-purple-400",
  proposal: "bg-blue-500/20 text-blue-400",
  negotiation: "bg-amber-500/20 text-amber-400",
  verbal_commit: "bg-emerald-500/20 text-emerald-400",
};

const STALL_COLOR = (days: number) =>
  days >= 21 ? "text-red-400" : days >= 14 ? "text-amber-400" : "text-muted-foreground";

function OppCard({ opp, onStageChange }: { opp: OppRow; onStageChange: (id: number, stage: string) => void }) {
  const nextStages = STAGE_NEXT[opp.stage] ?? [];
  const [advancing, setAdvancing] = useState(false);

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-border/40 bg-card hover:border-border/70 transition-colors" data-testid={`pipeline-opp-${opp.id}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{opp.title}</p>
            <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
              <Building2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{opp.accountName}</span>
              <span className="shrink-0">· {opp.ownerName}</span>
            </div>
          </div>
          <div className="text-right shrink-0">
            {opp.amount && <p className="text-sm font-semibold text-emerald-400">${opp.amount.toLocaleString()}</p>}
            <Badge variant="outline" className={`text-[10px] mt-0.5 ${STAGE_PROB_COLOR[opp.stage] ?? ""}`}>
              {STAGE_LABELS[opp.stage] ?? opp.stage}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-2">
          <span className={`text-xs flex items-center gap-1 ${STALL_COLOR(opp.daysSinceActivity)}`}>
            <Clock className="h-3 w-3" />
            {opp.daysSinceActivity === 0 ? "Active today" : `${opp.daysSinceActivity}d no activity`}
          </span>
          {nextStages.length > 0 && !advancing && (
            <Button variant="ghost" size="sm" className="h-6 text-xs ml-auto gap-1 text-muted-foreground hover:text-foreground"
              onClick={() => setAdvancing(true)} data-testid={`button-advance-${opp.id}`}>
              Advance <ArrowRight className="h-3 w-3" />
            </Button>
          )}
          {advancing && (
            <div className="ml-auto flex items-center gap-1">
              <Select onValueChange={v => { onStageChange(opp.id, v); setAdvancing(false); }}>
                <SelectTrigger className="h-6 text-xs w-36">
                  <SelectValue placeholder="Move to…" />
                </SelectTrigger>
                <SelectContent>
                  {nextStages.map(s => <SelectItem key={s} value={s}>{STAGE_LABELS[s] ?? s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" className="h-6 text-xs px-1" onClick={() => setAdvancing(false)}>✕</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type TabId = "stalled" | "noNextStep" | "highValue" | "forecast" | "byOwner";

export default function PipelinePage({ canEdit = true }: { canEdit?: boolean }) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<TabId>("stalled");

  const { data, isLoading, refetch } = useQuery<PipelineData>({
    queryKey: ["/api/pipeline/insights"],
    refetchInterval: 5 * 60_000,
  });

  const advanceMutation = useMutation({
    mutationFn: ({ id, stage }: { id: number; stage: string }) =>
      apiRequest("PATCH", `/api/leads/${id}`, { stage }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pipeline/insights"] });
      toast({ title: "Stage updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleStageChange = (id: number, stage: string) => advanceMutation.mutate({ id, stage });

  const tabs: { id: TabId; label: string; icon: React.ElementType; count?: number }[] = [
    { id: "stalled", label: "Stalled", icon: Clock, count: data?.stalled.length },
    { id: "noNextStep", label: "No Next Step", icon: AlertTriangle, count: data?.noNextStep.length },
    { id: "highValue", label: "High Value", icon: Flame, count: data?.highValueInactive.length },
    { id: "forecast", label: "Forecast", icon: BarChart3 },
    { id: "byOwner", label: "By Owner", icon: Users },
  ];

  const totalWeighted = data?.byStage.reduce((s, r) => s + r.weightedAmount, 0) ?? 0;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto" data-testid="pipeline-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-pipeline-title">
            Pipeline Health
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">Identify deals that need attention and keep revenue moving.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {data && (
            <div className="flex items-center gap-3">
              <div className="text-center px-3 py-2 rounded-lg bg-secondary/30 border border-border/40">
                <p className="text-xl font-bold text-primary" data-testid="stat-total-active">{data.totalActive}</p>
                <p className="text-xs text-muted-foreground">Active deals</p>
              </div>
              <div className="text-center px-3 py-2 rounded-lg bg-secondary/30 border border-border/40">
                <p className="text-xl font-bold text-emerald-400" data-testid="stat-total-pipeline">${(data.totalPipeline / 1000).toFixed(0)}k</p>
                <p className="text-xs text-muted-foreground">Total pipeline</p>
              </div>
              <div className="text-center px-3 py-2 rounded-lg bg-secondary/30 border border-border/40">
                <p className="text-xl font-bold text-blue-400" data-testid="stat-weighted">${(totalWeighted / 1000).toFixed(0)}k</p>
                <p className="text-xs text-muted-foreground">Weighted</p>
              </div>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5 h-9" data-testid="button-refresh-pipeline">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"}`}
              data-testid={`tab-${tab.id}`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className={`ml-0.5 text-xs rounded-full px-1.5 ${active ? "bg-primary-foreground/20" : "bg-secondary"}`}>{tab.count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : (
        <>
          {/* Stalled */}
          {activeTab === "stalled" && (
            <div className="space-y-2">
              {data?.stalled.length === 0 ? (
                <Card className="border-border/50"><CardContent className="py-12 text-center text-muted-foreground">No stalled deals — pipeline is moving!</CardContent></Card>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">{data?.stalled.length} deals with no activity in 7+ days</p>
                  {data?.stalled.map(o => <OppCard key={o.id} opp={o} onStageChange={handleStageChange} />)}
                </>
              )}
            </div>
          )}

          {/* No Next Step */}
          {activeTab === "noNextStep" && (
            <div className="space-y-2">
              {data?.noNextStep.length === 0 ? (
                <Card className="border-border/50"><CardContent className="py-12 text-center text-muted-foreground">All deals have recent activity.</CardContent></Card>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">{data?.noNextStep.length} deals need attention</p>
                  {data?.noNextStep.map(o => <OppCard key={o.id} opp={o} onStageChange={handleStageChange} />)}
                </>
              )}
            </div>
          )}

          {/* High Value Inactive */}
          {activeTab === "highValue" && (
            <div className="space-y-2">
              {data?.highValueInactive.length === 0 ? (
                <Card className="border-border/50"><CardContent className="py-12 text-center text-muted-foreground">No high-value deals are going cold.</CardContent></Card>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">{data?.highValueInactive.length} high-value deals stalled 14+ days</p>
                  {data?.highValueInactive.map(o => <OppCard key={o.id} opp={o} onStageChange={handleStageChange} />)}
                </>
              )}
            </div>
          )}

          {/* Forecast by Stage */}
          {activeTab === "forecast" && (
            <div className="space-y-3">
              <Card className="border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Weighted Forecast by Stage</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {data?.byStage.filter(s => s.count > 0).map(s => (
                      <div key={s.stage} data-testid={`forecast-${s.stage}`}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={`text-xs ${STAGE_PROB_COLOR[s.stage] ?? ""}`}>
                              {STAGE_LABELS[s.stage] ?? s.stage}
                            </Badge>
                            <span className="text-muted-foreground text-xs">{s.count} deal{s.count > 1 ? "s" : ""} · {s.probability}% probability</span>
                          </div>
                          <div className="text-right">
                            <span className="font-semibold">${s.weightedAmount.toLocaleString()}</span>
                            <span className="text-muted-foreground text-xs ml-1.5">(${s.totalAmount.toLocaleString()} raw)</span>
                          </div>
                        </div>
                        <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full"
                            style={{ width: `${(s.weightedAmount / Math.max(totalWeighted, 1)) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-border/30 mt-4 pt-3 flex justify-between text-sm font-semibold">
                    <span>Total weighted forecast</span>
                    <span className="text-emerald-400">${totalWeighted.toLocaleString()}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* By Owner */}
          {activeTab === "byOwner" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {data?.byOwner.map(o => (
                <Card key={o.owner} className="border-border/50" data-testid={`owner-${o.owner.replace(/\s+/g, "-")}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                        {o.owner.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{o.owner}</p>
                        <p className="text-xs text-muted-foreground">{o.count} active deal{o.count > 1 ? "s" : ""}</p>
                      </div>
                    </div>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Pipeline value</span>
                        <span className="font-medium text-emerald-400">${o.totalAmount.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Stalled deals</span>
                        <span className={o.stalled > 0 ? "text-amber-400 font-medium" : "text-muted-foreground"}>{o.stalled}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
