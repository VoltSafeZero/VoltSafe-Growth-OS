import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  TrendingUp, AlertTriangle, Flame, Users, DollarSign,
  Clock, Building2, ChevronRight, BarChart3, ArrowUpRight,
  RefreshCw, ArrowRight, Target, Award, Activity, CheckSquare,
  FileText, Calendar, Zap, Filter,
} from "lucide-react";
import { formatDistanceToNow, format, isThisMonth, isPast } from "date-fns";

// ── Types ─────────────────────────────────────────────────────────────────────

type OppRow = {
  id: number; title: string; stage: string; amount?: number;
  accountName: string; ownerName: string; ownerUserId?: number; daysSinceActivity: number;
  lastActivityDate?: string; updatedAt: string; estCloseDate?: string;
  forecastCategory?: string; nextStep?: string;
};
type StageRow = { stage: string; probability: number; count: number; totalAmount: number; weightedAmount: number };
type OwnerRow = { owner: string; count: number; totalAmount: number; stalled: number };
type CatRow  = { category: string; count: number; totalAmount: number; weightedAmount: number };

type PipelineData = {
  stalled: OppRow[]; noNextStep: OppRow[]; highValueInactive: OppRow[];
  byStage: StageRow[]; byOwner: OwnerRow[]; byCat: CatRow[];
  quotesAwaitingResponse: OppRow[]; closingThisMonth: OppRow[]; noOpenTask: OppRow[];
  totalActive: number; totalPipeline: number;
};

type ForecastPeriod = {
  label: string; month: string;
  commit: { count: number; totalAmount: number; weightedAmount: number };
  best_case: { count: number; totalAmount: number; weightedAmount: number };
  pipeline: { count: number; totalAmount: number; weightedAmount: number };
  closed_won: { count: number; totalAmount: number; weightedAmount: number };
  totalWeighted: number;
};
type ForecastData = { periods: ForecastPeriod[]; summary: Record<string, number> };

type RepRow = {
  userId: number; name: string; email: string;
  openOpps: number; totalPipeline: number; weightedPipeline: number;
  staleOpps: number; overdueFollowups: number;
  quotesSent: number; quotesAccepted: number;
  closedWonCount: number; closedWonAmount: number; closedLostCount: number;
  winRate: number | null; avgSaleCycleDays: number | null;
  activitiesLast7d: number; activitiesLast30d: number;
};
type RepData = { reps: RepRow[]; lookbackDays: number };

// ── Constants ─────────────────────────────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  inbound_new: "New", qualifying: "Qualifying", discovery: "Discovery",
  proposal: "Proposal", negotiation: "Negotiating", verbal_commit: "Verbal Commit",
  closed_won: "Won", closed_lost: "Lost",
};

const STAGE_NEXT: Record<string, string[]> = {
  inbound_new: ["qualifying", "closed_lost"],
  qualifying: ["discovery", "proposal", "closed_lost"],
  discovery: ["proposal", "closed_lost"],
  proposal: ["negotiation", "closed_lost"],
  negotiation: ["verbal_commit", "closed_lost"],
  verbal_commit: ["closed_won", "closed_lost"],
};

const STAGE_PROB_COLOR: Record<string, string> = {
  inbound_new: "bg-gray-500/20 text-gray-400",
  qualifying: "bg-purple-500/20 text-purple-400",
  discovery: "bg-cyan-500/20 text-cyan-400",
  proposal: "bg-blue-500/20 text-blue-400",
  negotiation: "bg-amber-500/20 text-amber-400",
  verbal_commit: "bg-emerald-500/20 text-emerald-400",
};

const CAT_COLOR: Record<string, string> = {
  commit: "text-emerald-400 border-emerald-400/30 bg-emerald-500/10",
  best_case: "text-blue-400 border-blue-400/30 bg-blue-500/10",
  pipeline: "text-muted-foreground border-border/50",
};

const STALL_COLOR = (days: number) =>
  days >= 21 ? "text-red-400" : days >= 14 ? "text-amber-400" : "text-muted-foreground";

function fmtK(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toLocaleString()}`;
}

// ── OppCard component ─────────────────────────────────────────────────────────

function OppCard({ opp, onStageChange, showCloseDate = false }: {
  opp: OppRow; onStageChange: (id: number, stage: string) => void; showCloseDate?: boolean;
}) {
  const nextStages = STAGE_NEXT[opp.stage] ?? [];
  const [advancing, setAdvancing] = useState(false);
  const overdue = opp.estCloseDate && isPast(new Date(opp.estCloseDate)) &&
    !["closed_won", "closed_lost"].includes(opp.stage);

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-border/40 bg-card hover:border-border/70 transition-colors" data-testid={`pipeline-opp-${opp.id}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link href={`/opportunities/${opp.id}`}>
              <p className="text-sm font-medium truncate hover:text-primary cursor-pointer">{opp.title}</p>
            </Link>
            <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
              <Building2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{opp.accountName}</span>
              <span className="shrink-0">· {opp.ownerName}</span>
            </div>
          </div>
          <div className="text-right shrink-0">
            {opp.amount != null && opp.amount > 0 && <p className="text-sm font-semibold text-emerald-400">{fmtK(opp.amount)}</p>}
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
          {showCloseDate && opp.estCloseDate && (
            <span className={`text-xs flex items-center gap-1 ${overdue ? "text-red-400" : "text-muted-foreground"}`}>
              <Calendar className="h-3 w-3" />
              {overdue ? "Overdue · " : "Closes "}
              {format(new Date(opp.estCloseDate), "MMM d")}
            </span>
          )}
          {nextStages.length > 0 && !advancing && (
            <Button variant="ghost" size="sm" className="h-6 text-xs ml-auto gap-1 text-muted-foreground hover:text-foreground"
              onClick={() => setAdvancing(true)} data-testid={`button-advance-${opp.id}`}>
              Advance <ArrowRight className="h-3 w-3" />
            </Button>
          )}
          {advancing && (
            <div className="ml-auto flex items-center gap-1">
              <Select onValueChange={v => { onStageChange(opp.id, v); setAdvancing(false); }}>
                <SelectTrigger className="h-6 text-xs w-36"><SelectValue placeholder="Move to…" /></SelectTrigger>
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

// ── Stale Reason Badge ────────────────────────────────────────────────────────

function staleReasons(opp: OppRow): string[] {
  const reasons: string[] = [];
  if (opp.daysSinceActivity >= 14) reasons.push(`${opp.daysSinceActivity}d no activity`);
  if (opp.estCloseDate && isPast(new Date(opp.estCloseDate))) reasons.push("close date passed");
  return reasons;
}

// ── Tab button helper ─────────────────────────────────────────────────────────

function TabBtn({ id, label, icon: Icon, count, active, onClick, testId }: {
  id: string; label: string; icon: React.ElementType; count?: number;
  active: boolean; onClick: () => void; testId?: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId ?? `tab-${id}`}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors
        ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"}`}
    >
      <Icon className="h-4 w-4" />
      {label}
      {count !== undefined && count > 0 && (
        <span className={`ml-0.5 text-xs rounded-full px-1.5 ${active ? "bg-primary-foreground/20" : "bg-secondary"}`}>{count}</span>
      )}
    </button>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type TabId = "stalled" | "noNextStep" | "highValue" | "forecast" | "reps" | "staleDeals";
type SavedView = "closingThisMonth" | "noActivity14" | "awaitingQuote" | "commitOnly" | "overdueClose" | null;

export default function PipelinePage({ canEdit = true }: { canEdit?: boolean }) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<TabId>("stalled");
  const [savedView, setSavedView] = useState<SavedView>(null);
  const [ownerFilter, setOwnerFilter] = useState<string>("all");

  const { data, isLoading, isError, refetch } = useQuery<PipelineData>({
    queryKey: ["/api/pipeline/insights"],
    refetchInterval: 5 * 60_000,
  });

  const forecastQuery = useQuery<ForecastData>({
    queryKey: ["/api/pipeline/forecast", ownerFilter],
    queryFn: () => fetch(`/api/pipeline/forecast?months=6${ownerFilter !== "all" ? `&ownerId=${ownerFilter}` : ""}`).then(r => r.json()),
    enabled: activeTab === "forecast",
  });

  const repQuery = useQuery<RepData>({
    queryKey: ["/api/pipeline/rep-performance"],
    enabled: activeTab === "reps",
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

  // Saved view filtering — overrides active tab list
  const savedViewItems = (): OppRow[] | null => {
    if (!data || !savedView) return null;
    switch (savedView) {
      case "closingThisMonth": return data.closingThisMonth;
      case "noActivity14": return data.stalled.filter(o => o.daysSinceActivity >= 14);
      case "awaitingQuote": return data.quotesAwaitingResponse;
      case "commitOnly": return (data as any).enriched?.filter((o: OppRow) => o.forecastCategory === "commit") ?? null;
      case "overdueClose": return (data.stalled as OppRow[]).filter(o => o.estCloseDate && isPast(new Date(o.estCloseDate)));
    }
  };

  // All unique owners from insights data for filter dropdown
  const owners = Array.from(new Set(data?.byOwner.map(o => o.owner) ?? []));

  const totalWeighted = data?.byStage.reduce((s, r) => s + r.weightedAmount, 0) ?? 0;

  const tabs: { id: TabId; label: string; icon: React.ElementType; count?: number }[] = [
    { id: "stalled",    label: "Stalled",       icon: Clock,       count: data?.stalled.length },
    { id: "noNextStep", label: "No Next Step",   icon: AlertTriangle, count: data?.noNextStep.length },
    { id: "highValue",  label: "High Value",     icon: Flame,       count: data?.highValueInactive.length },
    { id: "staleDeals", label: "Stale Deals",    icon: Activity,    count: data ? (data.stalled.filter(o => o.daysSinceActivity >= 14).length + (data.noOpenTask?.length ?? 0)) : undefined },
    { id: "forecast",   label: "Forecast",       icon: BarChart3 },
    { id: "reps",       label: "Rep Performance",icon: Award },
  ];

  if (isError) return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[40vh] gap-4">
      <AlertTriangle className="h-8 w-8 text-amber-400" />
      <p className="text-sm text-muted-foreground">Failed to load pipeline data.</p>
      <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
        <RefreshCw className="h-3.5 w-3.5" /> Try again
      </Button>
    </div>
  );

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto" data-testid="pipeline-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-pipeline-title">
            Pipeline &amp; Forecast
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">Visibility into revenue timing, rep performance, and deal health.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {data && (
            <div className="flex items-center gap-2">
              <div className="text-center px-3 py-2 rounded-lg bg-secondary/30 border border-border/40">
                <p className="text-xl font-bold text-primary" data-testid="stat-total-active">{data.totalActive}</p>
                <p className="text-xs text-muted-foreground">Active deals</p>
              </div>
              <div className="text-center px-3 py-2 rounded-lg bg-secondary/30 border border-border/40">
                <p className="text-xl font-bold text-emerald-400" data-testid="stat-total-pipeline">{fmtK(data.totalPipeline)}</p>
                <p className="text-xs text-muted-foreground">Total pipeline</p>
              </div>
              <div className="text-center px-3 py-2 rounded-lg bg-secondary/30 border border-border/40">
                <p className="text-xl font-bold text-blue-400" data-testid="stat-weighted">{fmtK(totalWeighted)}</p>
                <p className="text-xs text-muted-foreground">Weighted</p>
              </div>
              {data.closingThisMonth.length > 0 && (
                <div className="text-center px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <p className="text-xl font-bold text-amber-400" data-testid="stat-closing-month">{data.closingThisMonth.length}</p>
                  <p className="text-xs text-muted-foreground">Closing this month</p>
                </div>
              )}
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5 h-9" data-testid="button-refresh-pipeline">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* Saved Views quick-filter bar */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1" data-testid="saved-views-bar">
        <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
          <Filter className="h-3 w-3" /> Quick views:
        </span>
        {([
          { id: "closingThisMonth", label: "Closing this month", count: data?.closingThisMonth.length },
          { id: "noActivity14",     label: "No activity 14+ days", count: data?.stalled.filter(o => o.daysSinceActivity >= 14).length },
          { id: "awaitingQuote",    label: "Awaiting quote response", count: data?.quotesAwaitingResponse.length },
          { id: "commitOnly",       label: "Commit deals only", count: data?.byCat.find(c => c.category === "commit")?.count },
          { id: "overdueClose",     label: "Overdue close date", count: data?.stalled.filter(o => o.estCloseDate && isPast(new Date(o.estCloseDate))).length },
        ] as { id: SavedView; label: string; count?: number }[]).map(v => {
          const active = savedView === v.id;
          return (
            <button
              key={String(v.id)}
              onClick={() => { setSavedView(active ? null : v.id); if (!active) setActiveTab("stalled"); }}
              data-testid={`saved-view-${v.id}`}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap border transition-colors
                ${active ? "bg-primary text-primary-foreground border-primary" : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"}`}
            >
              {v.label}
              {v.count !== undefined && v.count > 0 && (
                <span className={`rounded-full px-1 ${active ? "bg-primary-foreground/20" : "bg-secondary"}`}>{v.count}</span>
              )}
            </button>
          );
        })}
        {savedView && (
          <button onClick={() => setSavedView(null)} className="text-xs text-muted-foreground hover:text-foreground ml-1">
            ✕ Clear
          </button>
        )}
      </div>

      {/* Saved View content — shows instead of tabs when active */}
      {savedView ? (
        <div className="space-y-2">
          {(() => {
            const items = savedViewItems() ?? [];
            if (items.length === 0) return (
              <Card className="border-border/50">
                <CardContent className="py-12 text-center text-muted-foreground">No deals match this filter.</CardContent>
              </Card>
            );
            return (
              <>
                <p className="text-xs text-muted-foreground">{items.length} deal{items.length !== 1 ? "s" : ""}</p>
                {items.map(o => (
                  <OppCard key={o.id} opp={o} onStageChange={handleStageChange} showCloseDate />
                ))}
              </>
            );
          })()}
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {tabs.map(tab => (
              <TabBtn key={tab.id} id={tab.id} label={tab.label} icon={tab.icon}
                count={tab.count} active={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)} />
            ))}
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
                      {data?.stalled.map(o => <OppCard key={o.id} opp={o} onStageChange={handleStageChange} showCloseDate />)}
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

              {/* Stale Deals — table with reason badges */}
              {activeTab === "staleDeals" && (
                <div className="space-y-3">
                  {/* Forecast category summary */}
                  {data?.byCat && data.byCat.some(c => c.count > 0) && (
                    <div className="grid grid-cols-3 gap-3">
                      {data.byCat.map(cat => (
                        <Card key={cat.category} className={`border ${CAT_COLOR[cat.category] ?? ""}`} data-testid={`cat-${cat.category}`}>
                          <CardContent className="p-3 text-center">
                            <p className="text-xs font-semibold uppercase tracking-wide capitalize mb-1">{cat.category.replace("_", " ")}</p>
                            <p className="text-lg font-bold">{fmtK(cat.totalAmount)}</p>
                            <p className="text-xs text-muted-foreground">{cat.count} deal{cat.count !== 1 ? "s" : ""} · {fmtK(cat.weightedAmount)} weighted</p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}

                  <Card className="border-border/50">
                    <CardHeader className="pb-2 pt-4 px-4">
                      <CardTitle className="text-sm">Stale &amp; At-Risk Deals</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                      {(data?.stalled.filter(o => o.daysSinceActivity >= 14).length ?? 0) === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-6">No deals stale 14+ days.</p>
                      ) : (
                        <div className="space-y-0">
                          {data?.stalled.filter(o => o.daysSinceActivity >= 14).map(opp => {
                            const reasons = staleReasons(opp);
                            return (
                              <div key={opp.id} className="flex items-center gap-3 py-2.5 border-b border-border/20 last:border-0" data-testid={`stale-opp-${opp.id}`}>
                                <div className="flex-1 min-w-0">
                                  <Link href={`/opportunities/${opp.id}`}>
                                    <p className="text-sm font-medium hover:text-primary cursor-pointer truncate">{opp.title}</p>
                                  </Link>
                                  <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
                                    <Building2 className="h-3 w-3" />
                                    <span>{opp.accountName}</span>
                                    <span>· {opp.ownerName}</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                                  {reasons.map(r => (
                                    <Badge key={r} variant="outline" className="text-[10px] px-1.5 text-amber-400 border-amber-400/30">
                                      {r}
                                    </Badge>
                                  ))}
                                  {opp.amount != null && opp.amount > 0 && (
                                    <span className="text-xs font-semibold text-emerald-400 shrink-0">{fmtK(opp.amount)}</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* No open task list */}
                  {data?.noOpenTask && data.noOpenTask.length > 0 && (
                    <Card className="border-border/50">
                      <CardHeader className="pb-2 pt-4 px-4">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <CheckSquare className="h-4 w-4 text-muted-foreground" />
                          No Open Task ({data.noOpenTask.length})
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-4">
                        <div className="space-y-0">
                          {data.noOpenTask.slice(0, 10).map(opp => (
                            <div key={opp.id} className="flex items-center gap-3 py-2.5 border-b border-border/20 last:border-0" data-testid={`notask-opp-${opp.id}`}>
                              <div className="flex-1 min-w-0">
                                <Link href={`/opportunities/${opp.id}`}>
                                  <p className="text-sm font-medium hover:text-primary cursor-pointer truncate">{opp.title}</p>
                                </Link>
                                <p className="text-xs text-muted-foreground">{opp.accountName} · {opp.ownerName}</p>
                              </div>
                              {opp.amount != null && opp.amount > 0 && (
                                <span className="text-xs font-semibold text-emerald-400 shrink-0">{fmtK(opp.amount)}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}

              {/* Forecast tab — monthly bars + category breakdown */}
              {activeTab === "forecast" && (
                <div className="space-y-4">
                  {/* Filters */}
                  <div className="flex items-center gap-2">
                    <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                      <SelectTrigger className="h-8 w-40 text-xs" data-testid="select-forecast-owner">
                        <SelectValue placeholder="All owners" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All owners</SelectItem>
                        {owners.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Category breakdown */}
                  {data?.byCat && (
                    <div className="grid grid-cols-3 gap-3">
                      {data.byCat.map(cat => (
                        <Card key={cat.category} className={`border ${CAT_COLOR[cat.category] ?? ""}`} data-testid={`forecast-cat-${cat.category}`}>
                          <CardContent className="p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide capitalize text-muted-foreground">{cat.category.replace("_", " ")}</p>
                            <p className="text-2xl font-bold mt-1">{fmtK(cat.totalAmount)}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{cat.count} deal{cat.count !== 1 ? "s" : ""} · {fmtK(cat.weightedAmount)} weighted</p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}

                  {/* Weighted by stage */}
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
                                <span className="text-muted-foreground text-xs">{s.count} deal{s.count > 1 ? "s" : ""} · {s.probability}%</span>
                              </div>
                              <div className="text-right">
                                <span className="font-semibold">{fmtK(s.weightedAmount)}</span>
                                <span className="text-muted-foreground text-xs ml-1.5">({fmtK(s.totalAmount)} raw)</span>
                              </div>
                            </div>
                            <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                              <div className="h-full bg-primary rounded-full transition-all"
                                style={{ width: `${(s.weightedAmount / Math.max(totalWeighted, 1)) * 100}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="border-t border-border/30 mt-4 pt-3 flex justify-between text-sm font-semibold">
                        <span>Total weighted forecast</span>
                        <span className="text-emerald-400">{fmtK(totalWeighted)}</span>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Monthly forecast bars */}
                  {forecastQuery.isLoading ? (
                    <Skeleton className="h-64" />
                  ) : forecastQuery.data && forecastQuery.data.periods.length > 0 ? (
                    <Card className="border-border/50">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Monthly Close Forecast (6 months)</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3" data-testid="monthly-forecast">
                          {forecastQuery.data.periods.map(p => {
                            const maxAmt = Math.max(...forecastQuery.data!.periods.map(x => x.totalWeighted), 1);
                            const barPct = (p.totalWeighted / maxAmt) * 100;
                            const isCurrent = p.month === new Date().toISOString().slice(0, 7);
                            return (
                              <div key={p.month} data-testid={`forecast-month-${p.month}`}>
                                <div className="flex items-center justify-between text-sm mb-1">
                                  <div className="flex items-center gap-2">
                                    <span className={`text-sm font-medium ${isCurrent ? "text-primary" : ""}`}>{p.label}</span>
                                    {isCurrent && <Badge variant="outline" className="text-[10px] px-1.5 text-primary border-primary/30">Current</Badge>}
                                  </div>
                                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                    {p.closed_won.count > 0 && <span className="text-emerald-400 font-medium">✓ {fmtK(p.closed_won.totalAmount)}</span>}
                                    {p.commit.count > 0 && <span>Commit: {fmtK(p.commit.totalAmount)}</span>}
                                    <span className="font-semibold text-foreground">{fmtK(p.totalWeighted)} weighted</span>
                                  </div>
                                </div>
                                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                                  <div className="h-full rounded-full flex">
                                    {p.closed_won.totalAmount > 0 && (
                                      <div className="h-full bg-emerald-500 rounded-l-full"
                                        style={{ width: `${(p.closed_won.totalAmount / maxAmt) * 100}%` }} />
                                    )}
                                    {p.commit.weightedAmount > 0 && (
                                      <div className="h-full bg-primary"
                                        style={{ width: `${(p.commit.weightedAmount / maxAmt) * 100}%` }} />
                                    )}
                                    {p.best_case.weightedAmount > 0 && (
                                      <div className="h-full bg-blue-400"
                                        style={{ width: `${(p.best_case.weightedAmount / maxAmt) * 100}%` }} />
                                    )}
                                    {p.pipeline.weightedAmount > 0 && (
                                      <div className="h-full bg-secondary-foreground/20 rounded-r-full"
                                        style={{ width: `${(p.pipeline.weightedAmount / maxAmt) * 100}%` }} />
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {/* Legend */}
                        <div className="flex items-center gap-4 mt-4 pt-3 border-t border-border/30">
                          {[
                            { color: "bg-emerald-500", label: "Closed Won" },
                            { color: "bg-primary", label: "Commit" },
                            { color: "bg-blue-400", label: "Best Case" },
                            { color: "bg-secondary-foreground/20", label: "Pipeline" },
                          ].map(l => (
                            <div key={l.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <div className={`w-3 h-2 rounded-sm ${l.color}`} />
                              {l.label}
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ) : forecastQuery.data?.periods.length === 0 ? (
                    <Card className="border-border/50">
                      <CardContent className="py-8 text-center text-sm text-muted-foreground">
                        No opportunities with close dates in the next 6 months.
                      </CardContent>
                    </Card>
                  ) : null}
                </div>
              )}

              {/* Rep Performance tab */}
              {activeTab === "reps" && (
                <div className="space-y-4">
                  {repQuery.isLoading ? (
                    <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}</div>
                  ) : !repQuery.data || repQuery.data.reps.length === 0 ? (
                    <Card className="border-border/50">
                      <CardContent className="py-12 text-center text-muted-foreground">No rep data available.</CardContent>
                    </Card>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Last {repQuery.data.lookbackDays} days · {repQuery.data.reps.length} rep{repQuery.data.reps.length !== 1 ? "s" : ""}
                      </p>

                      {/* Rep leaderboard cards */}
                      <div className="space-y-3">
                        {repQuery.data.reps.map((rep, idx) => (
                          <Card key={rep.userId} className="border-border/50" data-testid={`rep-card-${rep.userId}`}>
                            <CardContent className="p-4">
                              <div className="flex items-start gap-3">
                                {/* Avatar + rank */}
                                <div className="relative shrink-0">
                                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                                    {rep.name.charAt(0)}
                                  </div>
                                  {idx < 3 && (
                                    <div className={`absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold
                                      ${idx === 0 ? "bg-amber-400 text-amber-900" : idx === 1 ? "bg-gray-300 text-gray-700" : "bg-amber-700 text-amber-100"}`}>
                                      {idx + 1}
                                    </div>
                                  )}
                                </div>

                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between mb-2">
                                    <div>
                                      <p className="text-sm font-semibold" data-testid={`rep-name-${rep.userId}`}>{rep.name}</p>
                                      <p className="text-xs text-muted-foreground">{rep.email}</p>
                                    </div>
                                    <div className="text-right">
                                      <p className="text-lg font-bold text-emerald-400">{fmtK(rep.totalPipeline)}</p>
                                      <p className="text-xs text-muted-foreground">pipeline</p>
                                    </div>
                                  </div>

                                  {/* Metrics grid */}
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    <div className="text-center p-2 rounded bg-secondary/30 border border-border/30">
                                      <p className="text-sm font-semibold" data-testid={`rep-open-${rep.userId}`}>{rep.openOpps}</p>
                                      <p className="text-[10px] text-muted-foreground">Open deals</p>
                                    </div>
                                    <div className="text-center p-2 rounded bg-secondary/30 border border-border/30">
                                      <p className={`text-sm font-semibold ${rep.winRate != null ? "text-primary" : "text-muted-foreground"}`}
                                        data-testid={`rep-winrate-${rep.userId}`}>
                                        {rep.winRate != null ? `${rep.winRate}%` : "—"}
                                      </p>
                                      <p className="text-[10px] text-muted-foreground">Win rate</p>
                                    </div>
                                    <div className="text-center p-2 rounded bg-secondary/30 border border-border/30">
                                      <p className={`text-sm font-semibold ${rep.overdueFollowups > 0 ? "text-amber-400" : ""}`}
                                        data-testid={`rep-overdue-${rep.userId}`}>
                                        {rep.overdueFollowups}
                                      </p>
                                      <p className="text-[10px] text-muted-foreground">Overdue tasks</p>
                                    </div>
                                    <div className="text-center p-2 rounded bg-secondary/30 border border-border/30">
                                      <p className="text-sm font-semibold" data-testid={`rep-act30-${rep.userId}`}>
                                        {rep.activitiesLast30d}
                                      </p>
                                      <p className="text-[10px] text-muted-foreground">Activity 30d</p>
                                    </div>
                                  </div>

                                  {/* Secondary metrics */}
                                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                                    {rep.closedWonCount > 0 && (
                                      <span className="text-emerald-400">✓ {rep.closedWonCount} won · {fmtK(rep.closedWonAmount)}</span>
                                    )}
                                    {rep.staleOpps > 0 && (
                                      <span className="text-amber-400">{rep.staleOpps} stale</span>
                                    )}
                                    {rep.avgSaleCycleDays != null && (
                                      <span>Avg cycle: {rep.avgSaleCycleDays}d</span>
                                    )}
                                    {rep.quotesSent > 0 && (
                                      <span>Quotes: {rep.quotesAccepted}/{rep.quotesSent} accepted</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
