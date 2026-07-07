import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle, CheckCircle2, Clock, RefreshCw,
  ShieldAlert, TrendingDown, Users, Repeat2,
  Zap, FileText, Target, BarChart3, ChevronDown,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

type Severity = "info" | "watch" | "urgent" | "critical";

interface ExecutionItem {
  id: string;
  title: string;
  owner: string | null;
  source_type: string;
  source_id: string | null;
  age_days: number;
  last_activity_at: string | null;
  risk_reason: string;
  suggested_next_step: string;
  linked_action_id: number | null;
  metadata: Record<string, any>;
}

interface ExecutionSection {
  key: string;
  title: string;
  severity: Severity;
  items: ExecutionItem[];
  empty_state: string;
  reason: string;
}

interface RadarResult {
  generated_at: string;
  sections: Record<string, ExecutionSection>;
  recommended_interventions: Array<{
    title: string;
    reason: string;
    severity: Severity;
    suggested_action: string;
    source_type: string;
    source_id: string | null;
  }>;
}

interface ScorecardResult {
  score: number;
  label: "Strong" | "Watch" | "At Risk" | "Critical";
  reason: string;
  contributing_factors: Array<{ label: string; value: number; penalty: number }>;
  disclaimer: string;
  metrics: {
    open_ceo_actions: number;
    overdue_ceo_actions: number;
    completed_this_week: number;
    dismissed_this_week: number;
    snoozed_active: number;
    open_blockers: number;
    blockers_resolved_this_week: number;
    overdue_commitments: number;
    commitments_completed_this_week: number;
    stale_tasks: number;
    stale_opportunities: number;
  };
}

interface DriftResult {
  generated_at: string;
  drift_items: ExecutionItem[];
  total_count: number;
  by_severity: Record<Severity, number>;
}

interface RecurringResult {
  patterns: ExecutionItem[];
  summary: string;
}

interface CommitmentsResult {
  sections: {
    due_today: any[];
    due_this_week: any[];
    overdue: any[];
    no_owner: any[];
    no_due_date: any[];
    accepted_not_tasked: any[];
    tasked_not_completed: any[];
    completed: any[];
    recurring_commitments: any[];
  };
}

// ── Severity helpers ───────────────────────────────────────────────────────────

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
  urgent:   "bg-orange-500/20 text-orange-400 border-orange-500/30",
  watch:    "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  info:     "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

const SCORE_COLOR = (score: number) =>
  score >= 80 ? "text-green-400" : score >= 60 ? "text-yellow-400" : score >= 40 ? "text-orange-400" : "text-red-400";

const SCORE_BG = (score: number) =>
  score >= 80 ? "border-green-500/30" : score >= 60 ? "border-yellow-500/30" : score >= 40 ? "border-orange-500/30" : "border-red-500/30";

// ── Item card ─────────────────────────────────────────────────────────────────

function ItemCard({
  item,
  onCreateAction,
  onMarkReviewed,
  onDismiss,
  isPending,
}: {
  item: ExecutionItem;
  onCreateAction: (item: ExecutionItem) => void;
  onMarkReviewed: (item: ExecutionItem) => void;
  onDismiss: (item: ExecutionItem) => void;
  isPending: boolean;
}) {
  return (
    <div
      className="rounded-lg border border-border/30 bg-card/40 p-3 space-y-2"
      data-testid={`execution-item-${item.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground leading-tight truncate">{item.title}</p>
          {item.owner && (
            <p className="text-xs text-muted-foreground mt-0.5">Owner: {item.owner}</p>
          )}
        </div>
        <Badge variant="outline" className="text-xs shrink-0 text-muted-foreground">
          {item.age_days}d
        </Badge>
      </div>

      {item.risk_reason && (
        <p className="text-xs text-muted-foreground italic">{item.risk_reason}</p>
      )}
      {item.suggested_next_step && (
        <p className="text-xs text-cyan-400/80">{item.suggested_next_step}</p>
      )}

      <div className="flex gap-1.5 flex-wrap" data-testid="item-action-buttons">
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-xs px-2 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
          onClick={() => onCreateAction(item)}
          disabled={isPending}
          data-testid="create-action-btn"
        >
          <Zap className="h-3 w-3 mr-1" /> Create Action
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-xs px-2 text-muted-foreground hover:text-foreground"
          onClick={() => onMarkReviewed(item)}
          disabled={isPending}
          data-testid="mark-reviewed-btn"
        >
          <CheckCircle2 className="h-3 w-3 mr-1" /> Reviewed
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-xs px-2 text-muted-foreground/60 hover:text-muted-foreground"
          onClick={() => onDismiss(item)}
          disabled={isPending}
          data-testid="dismiss-btn"
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}

// ── Section renderer ───────────────────────────────────────────────────────────

function SectionBlock({
  section,
  onCreateAction,
  onMarkReviewed,
  onDismiss,
  isPending,
}: {
  section: ExecutionSection;
  onCreateAction: (item: ExecutionItem) => void;
  onMarkReviewed: (item: ExecutionItem) => void;
  onDismiss: (item: ExecutionItem) => void;
  isPending: boolean;
}) {
  const [expanded, setExpanded] = useState(section.severity === "critical" || section.severity === "urgent");

  return (
    <div
      className="rounded-lg border border-border/40 bg-card/60 overflow-hidden"
      data-testid={`execution-section-${section.key}`}
    >
      <button
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(e => !e)}
        data-testid={`section-toggle-${section.key}`}
      >
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${SEVERITY_COLOR[section.severity]}`}>
            {section.severity.toUpperCase()}
          </Badge>
          <span className="text-sm font-medium text-foreground">{section.title}</span>
          {section.items.length > 0 && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{section.items.length}</Badge>
          )}
        </div>
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2" data-testid={`section-items-${section.key}`}>
          <p className="text-xs text-slate-500 mb-2">{section.reason}</p>
          {section.items.length === 0 ? (
            <p className="text-xs text-slate-500 italic py-2 text-center">{section.empty_state}</p>
          ) : (
            section.items.map(item => (
              <ItemCard
                key={item.id}
                item={item}
                onCreateAction={onCreateAction}
                onMarkReviewed={onMarkReviewed}
                onDismiss={onDismiss}
                isPending={isPending}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

const SECTION_ORDER = [
  "critical_drift", "slipping_commitments", "unresolved_blockers",
  "repeated_snoozes", "stale_tasks", "stale_opportunities",
  "owner_load_risk", "recurring_risks", "execution_wins",
];

export function CeoExecutionRadarPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const radarQuery = useQuery<RadarResult>({
    queryKey: ["/api/today/ceo-execution/radar"],
  });
  const scorecardQuery = useQuery<ScorecardResult>({
    queryKey: ["/api/today/ceo-execution/scorecard"],
  });
  const driftQuery = useQuery<DriftResult>({
    queryKey: ["/api/today/ceo-execution/drift"],
  });
  const recurringQuery = useQuery<RecurringResult>({
    queryKey: ["/api/today/ceo-execution/recurring-risks"],
  });
  const commitmentsQuery = useQuery<CommitmentsResult>({
    queryKey: ["/api/today/ceo-execution/commitments"],
  });

  const createActionMut = useMutation({
    mutationFn: ({ itemId, title, source_type, source_id }: any) =>
      apiRequest("POST", `/api/today/ceo-execution/items/${encodeURIComponent(itemId)}/create-action`, {
        title: `Follow up: ${title}`,
        type: "follow_up",
        priority: "medium",
        source_type,
        source_id,
      }),
    onSuccess: () => {
      toast({ title: "Action created", description: "Added to your CEO Action Queue" });
      queryClient.invalidateQueries({ queryKey: ["/api/today/ceo-execution/radar"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const markReviewedMut = useMutation({
    mutationFn: ({ itemId, source_type, source_id }: any) =>
      apiRequest("POST", `/api/today/ceo-execution/items/${encodeURIComponent(itemId)}/mark-reviewed`, {
        source_type, source_id,
      }),
    onSuccess: () => {
      toast({ title: "Marked reviewed" });
      queryClient.invalidateQueries({ queryKey: ["/api/today/ceo-execution/radar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/today/ceo-execution/drift"] });
    },
  });

  const dismissMut = useMutation({
    mutationFn: ({ itemId, source_type, source_id }: any) =>
      apiRequest("POST", `/api/today/ceo-execution/items/${encodeURIComponent(itemId)}/dismiss`, {
        source_type, source_id,
      }),
    onSuccess: () => {
      toast({ title: "Dismissed" });
      queryClient.invalidateQueries({ queryKey: ["/api/today/ceo-execution/radar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/today/ceo-execution/drift"] });
    },
  });

  const isPending = createActionMut.isPending || markReviewedMut.isPending || dismissMut.isPending;

  const handleCreateAction = (item: ExecutionItem) =>
    createActionMut.mutate({ itemId: item.id, title: item.title, source_type: item.source_type, source_id: item.source_id });

  const handleMarkReviewed = (item: ExecutionItem) =>
    markReviewedMut.mutate({ itemId: item.id, source_type: item.source_type, source_id: item.source_id });

  const handleDismiss = (item: ExecutionItem) =>
    dismissMut.mutate({ itemId: item.id, source_type: item.source_type, source_id: item.source_id });

  const scorecard = scorecardQuery.data;
  const radar = radarQuery.data;

  return (
    <Card className="bg-[#0a0f1a] border-border/40" data-testid="ceo-execution-radar-panel">
      <CardHeader className="pb-3 pt-4 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-cyan-400" />
            <CardTitle className="text-sm font-semibold text-foreground">Execution Radar</CardTitle>
          </div>
          {scorecard && (
            <div className="flex items-center gap-2" data-testid="execution-health-score">
              <span className={`text-xl font-bold ${SCORE_COLOR(scorecard.score)}`}>{scorecard.score}</span>
              <Badge
                variant="outline"
                className={`text-xs ${SEVERITY_COLOR[
                  scorecard.label === "Strong" ? "info" :
                  scorecard.label === "Watch" ? "watch" :
                  scorecard.label === "At Risk" ? "urgent" : "critical"
                ]}`}
                data-testid="execution-health-label"
              >
                {scorecard.label}
              </Badge>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4">
        <Tabs defaultValue="radar" data-testid="execution-radar-tabs">
          <TabsList className="grid w-full grid-cols-5 h-8 mb-4 bg-white/5">
            <TabsTrigger value="radar" className="text-xs" data-testid={`execution-tab-radar`}>Radar</TabsTrigger>
            <TabsTrigger value="commitments" className="text-xs" data-testid={`execution-tab-commitments`}>Commitments</TabsTrigger>
            <TabsTrigger value="drift" className="text-xs" data-testid={`execution-tab-drift`}>Drift</TabsTrigger>
            <TabsTrigger value="recurring" className="text-xs" data-testid={`execution-tab-recurring`}>Recurring</TabsTrigger>
            <TabsTrigger value="scorecard" className="text-xs" data-testid={`execution-tab-scorecard`}>Scorecard</TabsTrigger>
          </TabsList>

          {/* ── Radar tab ── */}
          <TabsContent value="radar" data-testid="radar-tab-content">
            {radarQuery.isLoading ? (
              <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
            ) : !radar ? (
              <p className="text-sm text-slate-500 text-center py-4">Unable to load radar</p>
            ) : (
              <div className="space-y-2">
                {/* Recommended interventions */}
                {radar.recommended_interventions.length > 0 && (
                  <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3 space-y-2" data-testid="recommended-interventions">
                    <p className="text-xs font-semibold text-cyan-400 uppercase tracking-wide">Recommended Interventions</p>
                    {radar.recommended_interventions.map((iv, i) => (
                      <div key={i} className="flex items-start gap-2" data-testid={`intervention-item-${i}`}>
                        <Badge variant="outline" className={`text-[10px] shrink-0 ${SEVERITY_COLOR[iv.severity]}`}>
                          {iv.severity}
                        </Badge>
                        <div>
                          <p className="text-xs text-foreground">{iv.title}</p>
                          <p className="text-xs text-muted-foreground">{iv.suggested_action}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Sections */}
                {SECTION_ORDER.map(key => {
                  const section = radar.sections[key];
                  if (!section) return null;
                  return (
                    <SectionBlock
                      key={key}
                      section={section}
                      onCreateAction={handleCreateAction}
                      onMarkReviewed={handleMarkReviewed}
                      onDismiss={handleDismiss}
                      isPending={isPending}
                    />
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* ── Commitments tab ── */}
          <TabsContent value="commitments" data-testid="commitments-tab-content">
            {commitmentsQuery.isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : !commitmentsQuery.data ? (
              <p className="text-sm text-slate-500 text-center py-4">Unable to load commitments</p>
            ) : (
              <div className="space-y-4">
                {(["overdue", "due_today", "due_this_week", "no_owner", "accepted_not_tasked", "recurring_commitments"] as const).map(groupKey => {
                  const group = commitmentsQuery.data!.sections[groupKey];
                  if (!group?.length) return null;
                  const labels: Record<string, string> = {
                    overdue: "Overdue",
                    due_today: "Due Today",
                    due_this_week: "Due This Week",
                    no_owner: "No Owner",
                    accepted_not_tasked: "Accepted — Not Tasked",
                    recurring_commitments: "Recurring",
                  };
                  return (
                    <div key={groupKey} data-testid={`commitments-group-${groupKey}`}>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">{labels[groupKey] ?? groupKey} ({group.length})</p>
                      <div className="space-y-1.5" data-testid={`commitments-items-${groupKey}`}>
                        {group.map((c: any, i: number) => (
                          <div
                            key={i}
                            className="rounded-lg border border-border/30 bg-card/40 p-2.5"
                            data-testid={`commitment-item-${i}`}
                          >
                            <p className="text-xs font-medium text-foreground">{c.text}</p>
                            <div className="flex items-center gap-3 mt-1">
                              {c.owner && <span className="text-[10px] text-slate-500">Owner: {c.owner}</span>}
                              {c.due_date && <span className="text-[10px] text-slate-500">Due: {c.due_date}</span>}
                              {c.risk_reason && <span className="text-[10px] text-orange-400 italic">{c.risk_reason}</span>}
                            </div>
                            {c.suggested_ceo_action && (
                              <p className="text-[10px] text-cyan-400/70 mt-1">{c.suggested_ceo_action}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {Object.values(commitmentsQuery.data.sections).every((g: any) => g.length === 0) && (
                  <p className="text-sm text-slate-500 text-center py-6">No commitment data found. Add commitments in 1:1 notes to see them here.</p>
                )}
              </div>
            )}
          </TabsContent>

          {/* ── Drift tab ── */}
          <TabsContent value="drift" data-testid="drift-tab-content">
            {driftQuery.isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : !driftQuery.data ? (
              <p className="text-sm text-slate-500 text-center py-4">Unable to load drift data</p>
            ) : (
              <div className="space-y-3">
                {/* Severity summary */}
                <div className="flex gap-2 flex-wrap" data-testid="drift-severity-summary">
                  {(["critical", "urgent", "watch", "info"] as Severity[]).map(sev => (
                    <Badge key={sev} variant="outline" className={`text-xs ${SEVERITY_COLOR[sev]}`}>
                      {driftQuery.data!.by_severity[sev] ?? 0} {sev}
                    </Badge>
                  ))}
                </div>

                <div className="space-y-2" data-testid="drift-items-list">
                  {driftQuery.data.drift_items.length === 0 ? (
                    <p className="text-sm text-slate-500 text-center py-4">No drift detected — execution looks clean</p>
                  ) : (
                    driftQuery.data.drift_items.map(item => (
                      <ItemCard
                        key={item.id}
                        item={item}
                        onCreateAction={handleCreateAction}
                        onMarkReviewed={handleMarkReviewed}
                        onDismiss={handleDismiss}
                        isPending={isPending}
                      />
                    ))
                  )}
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── Recurring Risks tab ── */}
          <TabsContent value="recurring" data-testid="recurring-tab-content">
            {recurringQuery.isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : !recurringQuery.data ? (
              <p className="text-sm text-slate-500 text-center py-4">Unable to load recurring risks</p>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-slate-400" data-testid="recurring-summary">{recurringQuery.data.summary}</p>
                <div className="space-y-2" data-testid="recurring-patterns-list">
                  {recurringQuery.data.patterns.length === 0 ? (
                    <p className="text-sm text-slate-500 text-center py-4">No recurring risk patterns detected</p>
                  ) : (
                    recurringQuery.data.patterns.map(item => (
                      <div
                        key={item.id}
                        className="rounded-lg border border-border/30 bg-card/40 p-3"
                        data-testid={`recurring-pattern-${item.id}`}
                      >
                        <p className="text-sm font-medium text-foreground">{item.title}</p>
                        <p className="text-xs text-slate-400 mt-1">{item.risk_reason}</p>
                        <p className="text-xs text-cyan-400/80 mt-1">{item.suggested_next_step}</p>
                        <div className="mt-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs px-2 border-cyan-500/30 text-cyan-400"
                            onClick={() => handleCreateAction(item)}
                            disabled={isPending}
                            data-testid="create-action-btn"
                          >
                            <Zap className="h-3 w-3 mr-1" /> Create Action
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── Scorecard tab ── */}
          <TabsContent value="scorecard" data-testid="scorecard-tab-content">
            {scorecardQuery.isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : !scorecard ? (
              <p className="text-sm text-slate-500 text-center py-4">Unable to load scorecard</p>
            ) : (
              <div className="space-y-4">
                {/* Health score hero */}
                <div
                  className={`rounded-xl border p-4 text-center ${SCORE_BG(scorecard.score)}`}
                  data-testid="scorecard-health-hero"
                >
                  <div className={`text-5xl font-bold mb-1 ${SCORE_COLOR(scorecard.score)}`} data-testid="scorecard-score-value">
                    {scorecard.score}
                  </div>
                  <div className="text-sm font-semibold text-foreground" data-testid="scorecard-label-value">{scorecard.label}</div>
                  <div className="text-xs text-slate-400 mt-1" data-testid="scorecard-reason">{scorecard.reason}</div>
                  <div className="text-[10px] text-slate-500 mt-2 italic" data-testid="scorecard-disclaimer">{scorecard.disclaimer}</div>
                </div>

                {/* Key metrics grid */}
                <div className="grid grid-cols-2 gap-2" data-testid="scorecard-metrics-grid">
                  {[
                    { label: "Open CEO Actions", value: scorecard.metrics.open_ceo_actions, testid: "metric-open-actions" },
                    { label: "Overdue Actions", value: scorecard.metrics.overdue_ceo_actions, testid: "metric-overdue-actions" },
                    { label: "Completed This Week", value: scorecard.metrics.completed_this_week, testid: "metric-completed-week" },
                    { label: "Active Snoozes", value: scorecard.metrics.snoozed_active, testid: "metric-snoozed" },
                    { label: "Open Blockers", value: scorecard.metrics.open_blockers, testid: "metric-open-blockers" },
                    { label: "Overdue Commitments", value: scorecard.metrics.overdue_commitments, testid: "metric-overdue-commitments" },
                    { label: "Stale Tasks", value: scorecard.metrics.stale_tasks, testid: "metric-stale-tasks" },
                    { label: "Stale Opportunities", value: scorecard.metrics.stale_opportunities, testid: "metric-stale-opps" },
                  ].map(m => (
                    <div key={m.testid} className="rounded-lg border border-border/30 bg-card/40 p-2.5" data-testid={m.testid}>
                      <div className="text-lg font-bold text-foreground">{m.value}</div>
                      <div className="text-[10px] text-slate-400">{m.label}</div>
                    </div>
                  ))}
                </div>

                {/* Contributing factors */}
                {scorecard.contributing_factors.length > 0 && (
                  <div data-testid="scorecard-contributing-factors">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Contributing Factors</p>
                    <div className="space-y-1.5">
                      {scorecard.contributing_factors.map((f, i) => (
                        <div key={i} className="flex items-center justify-between rounded border border-border/30 bg-card/40 px-2.5 py-1.5"
                          data-testid={`factor-item-${i}`}>
                          <span className="text-xs text-slate-300">{f.label}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-400">{f.value}</span>
                            <span className="text-xs text-red-400">−{f.penalty}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
