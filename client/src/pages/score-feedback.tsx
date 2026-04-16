import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Target, TrendingUp, TrendingDown, BarChart3, CheckCircle2, XCircle,
  AlertTriangle, Info, Lightbulb, History, Crosshair, Brain,
  RefreshCw, ChevronRight, Minus, ArrowUp, ArrowDown, Activity,
  ShieldCheck, Gauge, ListOrdered,
} from "lucide-react";

// ─── Constants ─────────────────────────────────────────────────────────────────
const MODEL_OPTIONS = [
  { value: "lead_quality",         label: "Lead Quality" },
  { value: "opportunity_close",    label: "Opportunity Close Prob." },
  { value: "quote_urgency",        label: "Quote Follow-Up Urgency" },
  { value: "deployment_risk",      label: "Deployment Delay Risk" },
  { value: "churn_risk",           label: "Churn Risk" },
  { value: "expansion_likelihood", label: "Expansion Likelihood" },
];

const ENTITY_TYPE_OPTIONS = [
  { value: "lead",        label: "Lead" },
  { value: "opportunity", label: "Opportunity" },
  { value: "quote",       label: "Quote" },
  { value: "deployment",  label: "Deployment" },
  { value: "account",     label: "Account" },
];

const OUTCOME_OPTIONS = [
  { value: "won",         label: "Won / Closed Won" },
  { value: "lost",        label: "Lost / Closed Lost" },
  { value: "churned",     label: "Churned" },
  { value: "expanded",    label: "Expanded" },
  { value: "renewed",     label: "Renewed" },
  { value: "not_renewed", label: "Not Renewed" },
  { value: "converted",   label: "Converted" },
  { value: "stalled",     label: "Stalled" },
  { value: "disqualified","label": "Disqualified" },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────
function bandColor(band: string) {
  return { critical: "bg-red-500", high: "bg-orange-400", medium: "bg-yellow-400", low: "bg-emerald-400" }[band] ?? "bg-muted";
}

function bandBadgeVariant(band: string): "destructive" | "secondary" | "outline" | "default" {
  if (band === "critical") return "destructive";
  if (band === "high") return "secondary";
  return "outline";
}

function accuracyColor(acc: number) {
  if (acc >= 70) return "text-emerald-600 dark:text-emerald-400";
  if (acc >= 50) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

function confidenceIcon(label: string) {
  if (label === "high") return <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />;
  if (label === "medium") return <Gauge className="h-3.5 w-3.5 text-yellow-500" />;
  return <AlertTriangle className="h-3.5 w-3.5 text-red-400" />;
}

function deltaDisplay(delta: number | null) {
  if (delta === null) return null;
  if (delta === 0) return <span className="text-muted-foreground flex items-center gap-0.5"><Minus className="h-3 w-3" />0</span>;
  if (delta > 0) return <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5"><ArrowUp className="h-3 w-3" />+{delta}</span>;
  return <span className="text-red-500 flex items-center gap-0.5"><ArrowDown className="h-3 w-3" />{delta}</span>;
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 75 ? "bg-red-500" : score >= 55 ? "bg-orange-400" : score >= 30 ? "bg-yellow-400" : "bg-emerald-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
        <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-sm font-mono w-8 text-right">{score}</span>
    </div>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab() {
  const { data: overview, isLoading: loadingOverview } = useQuery<any>({
    queryKey: ["/api/scores/feedback/overview"],
  });
  const { data: accuracy, isLoading: loadingAccuracy } = useQuery<any[]>({
    queryKey: ["/api/scores/accuracy"],
  });

  const evaluateMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/scores/evaluate-all", { daysBack: 180 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scores/accuracy"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scores/feedback/overview"] });
    },
  });

  if (loadingOverview || loadingAccuracy) {
    return <div className="flex items-center justify-center h-48 text-muted-foreground">Loading accuracy data…</div>;
  }

  return (
    <div className="space-y-6">
      {/* Hero stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Score Snapshots", value: overview?.totalSnapshots?.toLocaleString() ?? "—", icon: <Activity className="h-4 w-4 text-blue-500" /> },
          { label: "Outcomes Logged", value: overview?.totalOutcomes?.toLocaleString() ?? "—", icon: <Target className="h-4 w-4 text-emerald-500" /> },
          { label: "Models Tracked", value: overview?.modelsTracked ?? "—", icon: <Brain className="h-4 w-4 text-purple-500" /> },
          { label: "Overall Accuracy", value: overview?.totalOutcomes > 0 ? `${overview.overallAccuracy}%` : "—", icon: <Gauge className="h-4 w-4 text-orange-500" /> },
        ].map(stat => (
          <Card key={stat.label}>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                {stat.icon}
                <span className="text-xs text-muted-foreground">{stat.label}</span>
              </div>
              <div className="text-2xl font-bold" data-testid={`stat-${stat.label.replace(/\s/g, "-").toLowerCase()}`}>{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Re-evaluate button */}
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => evaluateMut.mutate()}
          disabled={evaluateMut.isPending}
          data-testid="button-evaluate-all"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${evaluateMut.isPending ? "animate-spin" : ""}`} />
          Re-evaluate All Models
        </Button>
      </div>

      {/* Per-model accuracy cards */}
      <div className="grid gap-4">
        {(accuracy ?? []).map((model: any) => (
          <Card key={model.modelName} className={model.isUnderperforming ? "border-red-300 dark:border-red-700" : ""}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium" data-testid={`model-name-${model.modelName}`}>{model.displayName}</h3>
                    {model.isUnderperforming && (
                      <Badge variant="destructive" className="text-xs" data-testid={`badge-underperforming-${model.modelName}`}>
                        Underperforming
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{model.entityType} model · {model.totalOutcomes} outcomes logged</p>
                </div>
                <div className="text-right">
                  <div className={`text-2xl font-bold ${accuracyColor(model.directionAccuracy)}`} data-testid={`accuracy-${model.modelName}`}>
                    {model.totalOutcomes > 0 ? `${model.directionAccuracy}%` : "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">direction accuracy</div>
                </div>
              </div>

              {model.totalOutcomes > 0 && (
                <>
                  <div className="grid grid-cols-3 gap-4 text-sm mb-3">
                    <div>
                      <div className="text-muted-foreground text-xs mb-0.5">Band Accuracy</div>
                      <div className={`font-medium ${accuracyColor(model.bandAccuracy)}`}>{model.bandAccuracy}%</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs mb-0.5">Avg Score on Win</div>
                      <div className="font-medium text-emerald-600 dark:text-emerald-400">{model.avgScoreOnWin}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs mb-0.5">Avg Score on Loss</div>
                      <div className="font-medium text-red-500">{model.avgScoreOnLoss}</div>
                    </div>
                  </div>

                  {/* Band breakdown */}
                  {Object.keys(model.bandBreakdown).length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-xs text-muted-foreground mb-1">Prediction accuracy by band</div>
                      {(["critical", "high", "medium", "low"] as const).filter(b => model.bandBreakdown[b]).map(band => {
                        const bb = model.bandBreakdown[band];
                        return (
                          <div key={band} className="flex items-center gap-2 text-xs">
                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${bandColor(band)}`} />
                            <span className="w-16 capitalize">{band}</span>
                            <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                              <div
                                className={`h-1.5 rounded-full ${bb.accuracy >= 70 ? "bg-emerald-500" : bb.accuracy >= 50 ? "bg-yellow-400" : "bg-red-400"}`}
                                style={{ width: `${bb.accuracy}%` }}
                              />
                            </div>
                            <span className="w-24 text-right text-muted-foreground">{bb.positive}/{bb.total} correct</span>
                            <span className={`w-10 text-right font-medium ${accuracyColor(bb.accuracy)}`}>{bb.accuracy}%</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {model.totalOutcomes === 0 && (
                <div className="text-xs text-muted-foreground bg-muted/40 rounded px-3 py-2">
                  No outcomes recorded yet. Use the Outcomes tab to log results and unlock accuracy metrics.
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent snapshots */}
      {overview?.recentActivity?.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Recent Score Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {overview.recentActivity.map((item: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${bandColor(item.band)}`} />
                    <span className="font-medium">{item.entity_name ?? `${item.entity_type} #${item.entity_id}`}</span>
                    <span className="text-muted-foreground text-xs">{item.model_name?.replace(/_/g, " ")}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={bandBadgeVariant(item.band)} className="text-xs">{item.band}</Badge>
                    <span className="font-mono text-xs w-8 text-right">{item.score}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Outcomes Tab ─────────────────────────────────────────────────────────────
function OutcomesTab() {
  const { toast } = useToast();
  const [filterModel, setFilterModel] = useState<string>("all");
  const [filterEntityType, setFilterEntityType] = useState<string>("all");
  const [filterOutcome, setFilterOutcome] = useState<string>("all");

  // Record outcome form
  const [form, setForm] = useState({
    entityType: "opportunity", entityId: "", entityName: "", modelName: "opportunity_close",
    outcome: "won", outcomeValue: "", notes: "",
  });

  const { data: outcomes, isLoading } = useQuery<{ rows: any[]; total: number }>({
    queryKey: ["/api/scores/outcomes", filterModel, filterEntityType, filterOutcome],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "50" });
      if (filterModel !== "all") params.set("modelName", filterModel);
      if (filterEntityType !== "all") params.set("entityType", filterEntityType);
      if (filterOutcome !== "all") params.set("outcome", filterOutcome);
      const res = await fetch(`/api/scores/outcomes?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  const recordMut = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/scores/outcome", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scores/outcomes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scores/feedback/overview"] });
      toast({ title: "Outcome recorded", description: "The prediction outcome has been logged." });
      setForm(f => ({ ...f, entityId: "", entityName: "", outcomeValue: "", notes: "" }));
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const outcomeLabel = (o: string) => OUTCOME_OPTIONS.find(x => x.value === o)?.label ?? o;
  const modelLabel = (m: string) => MODEL_OPTIONS.find(x => x.value === m)?.label ?? m;

  return (
    <div className="space-y-6">
      {/* Record outcome form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4 text-emerald-500" />
            Record New Outcome
          </CardTitle>
          <CardDescription>Log the final result for an entity to improve prediction accuracy.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Entity Type</Label>
              <Select value={form.entityType} onValueChange={v => setForm(f => ({ ...f, entityType: v }))}>
                <SelectTrigger data-testid="select-entity-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Entity ID</Label>
              <Input
                placeholder="e.g. 42"
                value={form.entityId}
                onChange={e => setForm(f => ({ ...f, entityId: e.target.value }))}
                data-testid="input-entity-id"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Entity Name (optional)</Label>
              <Input
                placeholder="e.g. Harbour Lights Marina"
                value={form.entityName}
                onChange={e => setForm(f => ({ ...f, entityName: e.target.value }))}
                data-testid="input-entity-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Score Model</Label>
              <Select value={form.modelName} onValueChange={v => setForm(f => ({ ...f, modelName: v }))}>
                <SelectTrigger data-testid="select-model-name">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Outcome</Label>
              <Select value={form.outcome} onValueChange={v => setForm(f => ({ ...f, outcome: v }))}>
                <SelectTrigger data-testid="select-outcome">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OUTCOME_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Value ($, optional)</Label>
              <Input
                placeholder="e.g. 85000"
                type="number"
                value={form.outcomeValue}
                onChange={e => setForm(f => ({ ...f, outcomeValue: e.target.value }))}
                data-testid="input-outcome-value"
              />
            </div>
            <div className="col-span-2 md:col-span-3 space-y-1.5">
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea
                placeholder="Additional context about this outcome…"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
                data-testid="textarea-outcome-notes"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button
              onClick={() => recordMut.mutate({ ...form, entityId: parseInt(form.entityId), outcomeValue: form.outcomeValue ? parseFloat(form.outcomeValue) : null })}
              disabled={!form.entityId || recordMut.isPending}
              data-testid="button-record-outcome"
            >
              {recordMut.isPending ? "Saving…" : "Record Outcome"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={filterModel} onValueChange={setFilterModel}>
          <SelectTrigger className="w-48" data-testid="filter-model">
            <SelectValue placeholder="All models" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All models</SelectItem>
            {MODEL_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterEntityType} onValueChange={setFilterEntityType}>
          <SelectTrigger className="w-40" data-testid="filter-entity-type">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {ENTITY_TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterOutcome} onValueChange={setFilterOutcome}>
          <SelectTrigger className="w-44" data-testid="filter-outcome">
            <SelectValue placeholder="All outcomes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All outcomes</SelectItem>
            {OUTCOME_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground ml-auto" data-testid="text-outcomes-count">
          {outcomes?.total ?? 0} total outcome{outcomes?.total !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Outcomes list */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading outcomes…</div>
      ) : (outcomes?.rows ?? []).length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Target className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p>No outcomes logged yet.</p>
          <p className="text-xs mt-1">Record the first outcome above to start training the model evaluator.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {(outcomes?.rows ?? []).map((row: any) => {
            const isPos = ["won", "closed_won", "renewed", "expanded", "converted", "qualified"].includes(row.outcome);
            const isNeg = ["lost", "closed_lost", "churned", "not_renewed", "disqualified", "stalled"].includes(row.outcome);
            return (
              <Card key={row.id} data-testid={`outcome-row-${row.id}`}>
                <CardContent className="py-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 rounded-full p-1 ${isPos ? "bg-emerald-100 dark:bg-emerald-900" : isNeg ? "bg-red-100 dark:bg-red-900" : "bg-muted"}`}>
                        {isPos ? <TrendingUp className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> :
                          isNeg ? <TrendingDown className="h-3.5 w-3.5 text-red-500" /> :
                            <Minus className="h-3.5 w-3.5 text-muted-foreground" />}
                      </div>
                      <div>
                        <div className="font-medium text-sm">
                          {row.entity_name ?? `${row.entity_type} #${row.entity_id}`}
                          <span className="text-muted-foreground font-normal ml-1 text-xs">· {modelLabel(row.model_name)}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <Badge variant={isPos ? "default" : isNeg ? "destructive" : "secondary"} className="text-xs">
                            {outcomeLabel(row.outcome)}
                          </Badge>
                          {row.predicted_band && (
                            <span className="text-xs text-muted-foreground">
                              Predicted: <Badge variant={bandBadgeVariant(row.predicted_band)} className="text-xs ml-0.5">{row.predicted_band}</Badge>
                              {row.predicted_score ? ` (${row.predicted_score})` : ""}
                            </span>
                          )}
                          {row.outcome_value && (
                            <span className="text-xs text-muted-foreground">Value: ${Number(row.outcome_value).toLocaleString()}</span>
                          )}
                        </div>
                        {row.notes && <p className="text-xs text-muted-foreground mt-1">{row.notes}</p>}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground text-right shrink-0">
                      {row.created_at ? new Date(row.created_at).toLocaleDateString() : ""}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Explainability Tab ───────────────────────────────────────────────────────
function ExplainabilityTab() {
  const [entityType, setEntityType] = useState("opportunity");
  const [entityId, setEntityId] = useState("");
  const [searched, setSearched] = useState(false);

  const { data, isLoading, refetch } = useQuery<any[]>({
    queryKey: ["/api/scores/explainability", entityType, entityId],
    queryFn: async () => {
      if (!entityId) return [];
      const res = await fetch(`/api/scores/explainability/${entityType}/${entityId}`, { credentials: "include" });
      return res.json();
    },
    enabled: false,
  });

  const handleSearch = () => {
    setSearched(true);
    refetch();
  };

  return (
    <div className="space-y-6">
      {/* Search */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Crosshair className="h-4 w-4 text-blue-500" />
            Why is this score this value?
          </CardTitle>
          <CardDescription>Enter an entity to see a full breakdown of every factor that drove its score.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1.5">
              <Label className="text-xs">Entity Type</Label>
              <Select value={entityType} onValueChange={v => { setEntityType(v); setSearched(false); }}>
                <SelectTrigger className="w-40" data-testid="explainability-entity-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Entity ID</Label>
              <Input
                placeholder="e.g. 12"
                value={entityId}
                onChange={e => setEntityId(e.target.value)}
                className="w-32"
                data-testid="explainability-entity-id"
                onKeyDown={e => e.key === "Enter" && handleSearch()}
              />
            </div>
            <Button onClick={handleSearch} disabled={!entityId || isLoading} data-testid="button-explain">
              {isLoading ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : <Crosshair className="h-4 w-4 mr-2" />}
              Explain
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {searched && isLoading && (
        <div className="text-center py-8 text-muted-foreground">Analysing score factors…</div>
      )}
      {searched && !isLoading && (!data || data.length === 0) && (
        <div className="text-center py-8 text-muted-foreground">
          <Info className="h-6 w-6 mx-auto mb-2 opacity-40" />
          No score data found for {entityType} #{entityId}. Call the score API first to generate a snapshot.
        </div>
      )}

      {(data ?? []).map((item: any) => (
        <Card key={item.modelName} data-testid={`explainability-card-${item.modelName}`}>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-base">
                  {MODEL_OPTIONS.find(m => m.value === item.modelName)?.label ?? item.modelName}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {item.entityName ?? `${item.entityType} #${item.entityId}`}
                </p>
              </div>
              <div className="text-right">
                {item.currentScore !== null ? (
                  <>
                    <div className="text-3xl font-bold" data-testid={`score-value-${item.modelName}`}>{item.currentScore}</div>
                    <div className="flex items-center gap-1 justify-end mt-0.5">
                      <Badge variant={bandBadgeVariant(item.currentBand)} className="text-xs">{item.currentBand}</Badge>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        {confidenceIcon(item.confidenceLabel ?? "low")}
                        {item.currentConfidence}% confidence
                      </div>
                    </div>
                  </>
                ) : (
                  <span className="text-muted-foreground">No score yet</span>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Score deltas */}
            {item.currentScore !== null && (
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs">7-day change:</span>
                  <span className="font-medium text-xs">{deltaDisplay(item.scoreDelta7d) ?? <span className="text-muted-foreground">N/A</span>}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs">30-day change:</span>
                  <span className="font-medium text-xs">{deltaDisplay(item.scoreDelta30d) ?? <span className="text-muted-foreground">N/A</span>}</span>
                </div>
              </div>
            )}

            <Separator />

            {/* Reasons (the "why") */}
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Score Drivers</div>
              {item.currentReasons?.length > 0 ? (
                <ul className="space-y-1.5" data-testid={`reasons-list-${item.modelName}`}>
                  {item.currentReasons.map((r: string, i: number) => {
                    const isNeg = r.toLowerCase().includes("no ") || r.toLowerCase().includes("not ") || r.toLowerCase().includes("overdue") || r.toLowerCase().includes("stall") || r.toLowerCase().includes("risk");
                    return (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        {isNeg
                          ? <XCircle className="h-3.5 w-3.5 mt-0.5 text-red-400 shrink-0" />
                          : <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-emerald-500 shrink-0" />}
                        <span>{r}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">No reasons available — score this entity via the API first.</p>
              )}
            </div>

            {/* Score history sparkline */}
            {item.scoreHistory?.length > 1 && (
              <>
                <Separator />
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Score History</div>
                  <div className="flex items-end gap-1 h-12">
                    {item.scoreHistory.slice(-20).map((h: any, i: number) => (
                      <div
                        key={i}
                        className={`flex-1 rounded-sm ${bandColor(h.band)} opacity-80`}
                        style={{ height: `${Math.max(4, (h.score / 100) * 48)}px` }}
                        title={`${h.score} — ${new Date(h.recordedAt).toLocaleDateString()}`}
                        data-testid={`history-bar-${item.modelName}-${i}`}
                      />
                    ))}
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>{item.scoreHistory.length > 0 ? new Date(item.scoreHistory[0].recordedAt).toLocaleDateString() : ""}</span>
                    <span>Today</span>
                  </div>
                </div>
              </>
            )}

            {/* Outcome */}
            {item.outcome && (
              <>
                <Separator />
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs">Recorded outcome:</span>
                    <Badge variant={["won", "expanded", "renewed"].includes(item.outcome) ? "default" : "destructive"} className="text-xs">
                      {OUTCOME_OPTIONS.find(o => o.value === item.outcome)?.label ?? item.outcome}
                    </Badge>
                  </div>
                  {item.predictionAccurate !== null && (
                    <div className="flex items-center gap-1">
                      {item.predictionAccurate
                        ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        : <XCircle className="h-4 w-4 text-red-500" />}
                      <span className={`text-xs font-medium ${item.predictionAccurate ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                        Prediction {item.predictionAccurate ? "correct" : "incorrect"}
                      </span>
                    </div>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Recommendations Tab ──────────────────────────────────────────────────────
function RecommendationsTab() {
  const { data: recs, isLoading } = useQuery<any[]>({
    queryKey: ["/api/scores/recommendations"],
  });

  const refreshMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/scores/evaluate-all", { daysBack: 180 }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/scores/recommendations"] }),
  });

  const confidenceColors: Record<string, string> = {
    high: "text-red-600 dark:text-red-400",
    medium: "text-yellow-600 dark:text-yellow-400",
    low: "text-blue-600 dark:text-blue-400",
  };

  if (isLoading) return <div className="text-center py-8 text-muted-foreground">Loading recommendations…</div>;

  const grouped: Record<string, any[]> = {};
  (recs ?? []).forEach(r => {
    if (!grouped[r.modelName]) grouped[r.modelName] = [];
    grouped[r.modelName].push(r);
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Weight Tuning Recommendations</h2>
          <p className="text-sm text-muted-foreground">
            AI-generated suggestions based on prediction vs outcome analysis.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending} data-testid="button-refresh-recs">
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshMut.isPending ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {Object.keys(grouped).length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Lightbulb className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p>No recommendations yet. Log at least 5 outcomes per model to unlock weight tuning suggestions.</p>
        </div>
      )}

      {Object.entries(grouped).map(([modelName, modelRecs]) => (
        <Card key={modelName}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Brain className="h-4 w-4 text-purple-500" />
              {MODEL_OPTIONS.find(m => m.value === modelName)?.label ?? modelName}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {modelRecs.map((rec: any, i: number) => (
              <div
                key={i}
                className="border rounded-lg p-4 space-y-2"
                data-testid={`recommendation-${modelName}-${i}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Lightbulb className="h-4 w-4 text-yellow-500 shrink-0" />
                    <span className="font-medium text-sm capitalize">{rec.factor?.replace(/_/g, " ")}</span>
                  </div>
                  <Badge variant="outline" className={`text-xs ${confidenceColors[rec.confidence]}`}>
                    {rec.confidence} confidence
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{rec.currentImpact}</p>
                <p className="text-sm">{rec.recommendation}</p>
                {rec.expectedImprovement && (
                  <div className="flex items-start gap-1.5 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 rounded px-2 py-1">
                    <TrendingUp className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    {rec.expectedImprovement}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── History Tab ──────────────────────────────────────────────────────────────
function HistoryTab() {
  const [entityType, setEntityType] = useState("all");
  const [modelName, setModelName] = useState("all");

  const { data, isLoading } = useQuery<{ rows: any[]; total: number }>({
    queryKey: ["/api/scores/outcomes", "history", entityType, modelName],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "100" });
      if (entityType !== "all") params.set("entityType", entityType);
      if (modelName !== "all") params.set("modelName", modelName);
      const res = await fetch(`/api/scores/outcomes?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  const rows = data?.rows ?? [];

  // Build daily counts
  const countByDate: Record<string, { positive: number; negative: number }> = {};
  rows.forEach((r: any) => {
    const date = new Date(r.created_at).toLocaleDateString();
    if (!countByDate[date]) countByDate[date] = { positive: 0, negative: 0 };
    const isPos = ["won", "closed_won", "renewed", "expanded", "converted"].includes(r.outcome);
    if (isPos) countByDate[date].positive++;
    else countByDate[date].negative++;
  });

  const dates = Object.keys(countByDate).slice(-14);
  const maxCount = Math.max(...Object.values(countByDate).map(d => d.positive + d.negative), 1);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        <Select value={entityType} onValueChange={setEntityType}>
          <SelectTrigger className="w-40" data-testid="history-filter-entity">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All entity types</SelectItem>
            {ENTITY_TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={modelName} onValueChange={setModelName}>
          <SelectTrigger className="w-48" data-testid="history-filter-model">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All models</SelectItem>
            {MODEL_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Outcome timeline bar chart */}
      {dates.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-blue-500" />
              Outcome Distribution (last 14 days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2 h-28">
              {dates.map(date => {
                const d = countByDate[date];
                const total = d.positive + d.negative;
                const posH = (d.positive / maxCount) * 100;
                const negH = (d.negative / maxCount) * 100;
                return (
                  <div key={date} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex flex-col gap-0.5 justify-end" style={{ height: "96px" }}>
                      {d.negative > 0 && <div className="w-full bg-red-400 rounded-t-sm" style={{ height: `${(negH / 100) * 88}px` }} />}
                      {d.positive > 0 && <div className="w-full bg-emerald-400 rounded-t-sm" style={{ height: `${(posH / 100) * 88}px` }} />}
                    </div>
                    <div className="text-[9px] text-muted-foreground text-center leading-tight w-full truncate">{date}</div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 mt-2">
              <div className="flex items-center gap-1.5 text-xs"><div className="w-3 h-3 rounded-sm bg-emerald-400" /> Positive</div>
              <div className="flex items-center gap-1.5 text-xs"><div className="w-3 h-3 rounded-sm bg-red-400" /> Negative</div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-entity history */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <ListOrdered className="h-4 w-4 text-purple-500" />
            Outcome Log
          </CardTitle>
          <CardDescription>{data?.total ?? 0} outcomes recorded</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-6 text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">No outcomes match the selected filters.</div>
          ) : (
            <div className="space-y-1">
              {rows.map((row: any) => {
                const isPos = ["won", "closed_won", "renewed", "expanded", "converted"].includes(row.outcome);
                return (
                  <div key={row.id} className="flex items-center justify-between py-1.5 border-b last:border-0 text-sm" data-testid={`history-row-${row.id}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${isPos ? "bg-emerald-400" : "bg-red-400"}`} />
                      <span className="truncate font-medium">{row.entity_name ?? `${row.entity_type} #${row.entity_id}`}</span>
                      <span className="text-muted-foreground text-xs hidden sm:inline">{MODEL_OPTIONS.find(m => m.value === row.model_name)?.label ?? row.model_name}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Badge variant={isPos ? "default" : "destructive"} className="text-xs">
                        {OUTCOME_OPTIONS.find(o => o.value === row.outcome)?.label ?? row.outcome}
                      </Badge>
                      {row.predicted_band && (
                        <Badge variant={bandBadgeVariant(row.predicted_band)} className="text-xs hidden sm:flex">
                          {row.predicted_band}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">{new Date(row.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ScoreFeedbackPage() {
  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <Brain className="h-5 w-5 text-purple-500" />
            <h1 className="text-2xl font-bold" data-testid="page-title">Score Feedback Loop</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            Compare predictions vs real outcomes. Track accuracy, log results, and get AI-powered recommendations to improve model weights over time.
          </p>
        </div>

        <Tabs defaultValue="overview">
          <TabsList className="mb-6" data-testid="tabs-feedback">
            <TabsTrigger value="overview" data-testid="tab-overview">
              <BarChart3 className="h-3.5 w-3.5 mr-1.5" />Overview
            </TabsTrigger>
            <TabsTrigger value="outcomes" data-testid="tab-outcomes">
              <Target className="h-3.5 w-3.5 mr-1.5" />Outcomes
            </TabsTrigger>
            <TabsTrigger value="explainability" data-testid="tab-explainability">
              <Crosshair className="h-3.5 w-3.5 mr-1.5" />Explainability
            </TabsTrigger>
            <TabsTrigger value="recommendations" data-testid="tab-recommendations">
              <Lightbulb className="h-3.5 w-3.5 mr-1.5" />Recommendations
            </TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history">
              <History className="h-3.5 w-3.5 mr-1.5" />History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview"><OverviewTab /></TabsContent>
          <TabsContent value="outcomes"><OutcomesTab /></TabsContent>
          <TabsContent value="explainability"><ExplainabilityTab /></TabsContent>
          <TabsContent value="recommendations"><RecommendationsTab /></TabsContent>
          <TabsContent value="history"><HistoryTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
