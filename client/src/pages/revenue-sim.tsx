import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Area, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, Cell,
} from "recharts";
import {
  FlaskRound, Play, Save, Trash2, ChevronDown, ChevronUp, RotateCcw,
  Plus, Check, SlidersHorizontal, BookOpen, Pin, LayoutGrid, Brain,
  TrendingUp, TrendingDown, Zap, ListChecks, BarChart2, RefreshCcw,
  CircleCheck, Circle, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────

type MonthProjection = {
  month: string; label: string; baseline: number; simulated: number;
  delta: number; deltaPct: number; dealCount: number;
};

type SimSummary = {
  totalBaseline: number; totalSimulated: number; totalDelta: number;
  deltaPct: number; peakMonth: string; peakAmount: number;
  dealsIncluded: number; avgDealSize: number; paramsApplied: SimParams;
};

type SimResult = { months: MonthProjection[]; summary: SimSummary };

type SimParams = {
  winRateMultiplier?: number; dealSizeMultiplier?: number;
  velocityWeeks?: number; newPipelineDeals?: number;
  newPipelineAvgSize?: number; forecastCategory?: string;
  churnRateMonthly?: number; expansionRateMonthly?: number; months?: number;
};

type SavedScenario = {
  id: number; name: string; description: string | null;
  parameters: SimParams; projection: SimResult; baseline_snapshot: SimResult;
  is_pinned: boolean; board_pack_include: boolean; source_type: string;
  created_at: string; updated_at: string;
};

type CompareEntry = { scenario: SavedScenario; result: SimResult; color: string };

type CRMBaseline = {
  avgDealSize: number; winRate: number; avgSalesCycleDays: number;
  openDealCount: number; openPipelineValue: number; wonLast180: number;
  lostLast180: number; stageDistribution: Record<string, number>;
  impliedParams: SimParams; dataCoverage: "full" | "partial" | "sparse"; notes: string[];
};

type RecommendedAction = {
  title: string; rationale: string; priority: "high" | "medium" | "low";
  linkedObjectType?: string;
};

type ScenarioAction = {
  id: number; scenario_id: number; title: string; status: string;
  notes: string | null; owner_name?: string; linked_object_type?: string; due_date?: string;
};

type ForecastActualRow = {
  month_key: string; forecast_amount: number; actual_amount: number;
  variance_amount: number; variance_pct: number;
};

type ForecastVsActuals = {
  rows: ForecastActualRow[]; totalForecast: number; totalActual: number;
  totalVariance: number; variancePct: number; hasSufficientData: boolean;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const COMPARE_COLORS = ["#f59e0b", "#8b5cf6", "#ec4899"];

const DEFAULT_PARAMS: SimParams = {
  winRateMultiplier: 1.0, dealSizeMultiplier: 1.0, velocityWeeks: 0,
  newPipelineDeals: 0, forecastCategory: "all", churnRateMonthly: 0,
  expansionRateMonthly: 0, months: 12,
};

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual", crm_snapshot: "CRM Snapshot", board_pack: "Board Pack",
};

const PRIORITY_COLORS: Record<string, string> = {
  high: "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/50",
  medium: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50",
  low: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50",
};

const STATUS_ICONS: Record<string, any> = {
  open: Circle, in_progress: Loader2, done: CircleCheck, dropped: Trash2,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtSign(n: number): string {
  return n >= 0 ? `+${fmt(n)}` : `-${fmt(Math.abs(n))}`;
}

function pct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function paramsEqual(a: SimParams, b: SimParams): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── Tooltip ────────────────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 text-xs shadow-lg min-w-[160px]">
      <p className="font-semibold text-zinc-700 dark:text-zinc-200 mb-2">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.color }} />
          <span className="text-zinc-500 dark:text-zinc-400 capitalize">{p.name}:</span>
          <span className="font-medium text-zinc-800 dark:text-zinc-100">{fmt(p.value ?? 0)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Slider ─────────────────────────────────────────────────────────────────────

function ParamSlider({ label, hint, value, min, max, step, display, onChange }: {
  label: string; hint: string; value: number; min: number; max: number;
  step: number; display: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{label}</span>
        <span className="text-sm font-semibold text-blue-600 dark:text-blue-400 tabular-nums">{display(value)}</span>
      </div>
      <Slider
        data-testid={`slider-${label.toLowerCase().replace(/\s+/g, "-")}`}
        min={min} max={max} step={step} value={[value]}
        onValueChange={([v]) => onChange(v)} className="mb-1"
      />
      <p className="text-xs text-zinc-400 dark:text-zinc-500">{hint}</p>
    </div>
  );
}

// ── SummaryCard ────────────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, positive, testId }: {
  label: string; value: string; sub?: string; positive?: boolean; testId?: string;
}) {
  const subColor = positive === undefined
    ? "text-zinc-400 dark:text-zinc-500"
    : positive ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400";
  return (
    <div data-testid={testId} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-4 py-3">
      <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">{label}</p>
      <p className="text-xl font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">{value}</p>
      {sub && <p className={`text-xs font-medium mt-0.5 ${subColor}`}>{sub}</p>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RevenueSimPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  // ── State ──
  const [params, setParams] = useState<SimParams>(DEFAULT_PARAMS);
  const [pendingParams, setPendingParams] = useState<SimParams>(DEFAULT_PARAMS);
  const [dirty, setDirty] = useState(false);
  const [simResult, setSimResult] = useState<SimResult | null>(null);
  const [compareEntries, setCompareEntries] = useState<CompareEntry[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveDesc, setSaveDesc] = useState("");
  const [scenariosOpen, setScenariosOpen] = useState(true);
  const [crmOpen, setCrmOpen] = useState(false);
  const [crmDiff, setCrmDiff] = useState<SimParams | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [activeScenarioId, setActiveScenarioId] = useState<number | null>(null);
  const [actualsOpen, setActualsOpen] = useState(false);
  const [actualsEntry, setActualsEntry] = useState({ month_key: "", actual_amount: "", forecast_amount: "" });
  const [forecastOpen, setForecastOpen] = useState(false);

  // ── Queries ──
  const { data: baseline, isLoading: baselineLoading } = useQuery<SimResult>({
    queryKey: ["/api/revenue-sim/baseline"],
  });

  const { data: scenarios = [], isLoading: scenariosLoading } = useQuery<SavedScenario[]>({
    queryKey: ["/api/revenue-sim/scenarios"],
  });

  const { data: crmBaseline, isLoading: crmLoading } = useQuery<CRMBaseline>({
    queryKey: ["/api/revenue-sim/crm-baseline"],
    enabled: crmOpen,
  });

  const { data: forecastActuals, isLoading: fvaLoading } = useQuery<ForecastVsActuals>({
    queryKey: ["/api/revenue-sim/forecast-vs-actuals"],
    enabled: forecastOpen,
  });

  const { data: scenarioActions = [], isLoading: actionsLoading } = useQuery<ScenarioAction[]>({
    queryKey: ["/api/revenue-sim", activeScenarioId, "actions"],
    enabled: actionsOpen && activeScenarioId != null,
  });

  // ── Simulate ──
  const simulateMut = useMutation({
    mutationFn: (p: SimParams) =>
      apiRequest("POST", "/api/revenue-sim/simulate", p).then(r => r.json()),
    onSuccess: (data: SimResult) => {
      setSimResult(data);
      setParams(pendingParams);
      setDirty(false);
    },
    onError: (err: any) => toast({ title: "Simulation failed", description: err.message, variant: "destructive" }),
  });

  // ── Save scenario ──
  const saveMut = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/revenue-sim/scenarios", body).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/revenue-sim/scenarios"] });
      setSaveOpen(false); setSaveName(""); setSaveDesc("");
      toast({ title: "Scenario saved" });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  // ── Delete scenario ──
  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/revenue-sim/scenarios/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/revenue-sim/scenarios"] });
      toast({ title: "Scenario deleted" });
    },
    onError: (err: any) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  // ── Pin scenario ──
  const pinMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/revenue-sim/${id}/pin`, {}).then(r => r.json()),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/revenue-sim/scenarios"] });
      toast({ title: data.is_pinned ? `📌 "${data.name}" pinned` : "Scenario unpinned" });
    },
    onError: (err: any) => toast({ title: "Pin failed", description: err.message, variant: "destructive" }),
  });

  // ── Board pack toggle ──
  const boardPackMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/revenue-sim/${id}/board-pack-toggle`, {}).then(r => r.json()),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/revenue-sim/scenarios"] });
      toast({ title: data.board_pack_include ? "Added to board pack" : "Removed from board pack" });
    },
    onError: (err: any) => toast({ title: "Toggle failed", description: err.message, variant: "destructive" }),
  });

  // ── Save actions (generated) ──
  const saveActionsMut = useMutation({
    mutationFn: ({ id, actions }: { id: number; actions: RecommendedAction[] }) =>
      apiRequest("POST", `/api/revenue-sim/${id}/actions`,
        actions.map(a => ({ title: a.title, notes: a.rationale, linked_object_type: a.linkedObjectType }))
      ).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/revenue-sim", activeScenarioId, "actions"] });
      toast({ title: "Actions saved to scenario" });
    },
    onError: (err: any) => toast({ title: "Failed to save actions", description: err.message, variant: "destructive" }),
  });

  // ── Update action status ──
  const updateActionMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/revenue-sim/actions/${id}`, { status }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/revenue-sim", activeScenarioId, "actions"] }),
    onError: (err: any) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  // ── Upsert actuals ──
  const actualsMut = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/revenue-sim/actuals/upsert", body).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/revenue-sim/forecast-vs-actuals"] });
      setActualsOpen(false);
      setActualsEntry({ month_key: "", actual_amount: "", forecast_amount: "" });
      toast({ title: "Actuals saved" });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  // ── Effects ──
  useEffect(() => { if (baseline && !simResult) setSimResult(baseline); }, [baseline]);

  const updateParam = useCallback(<K extends keyof SimParams>(key: K, val: SimParams[K]) => {
    setPendingParams(prev => {
      const next = { ...prev, [key]: val };
      setDirty(!paramsEqual(next, DEFAULT_PARAMS));
      return next;
    });
  }, []);

  const handleRun = useCallback(() => simulateMut.mutate(pendingParams), [pendingParams, simulateMut]);

  const handleReset = useCallback(() => {
    setPendingParams(DEFAULT_PARAMS); setDirty(false);
    setSimResult(baseline ?? null); setParams(DEFAULT_PARAMS);
  }, [baseline]);

  const handleApplyCRM = useCallback(() => {
    if (!crmDiff) return;
    setPendingParams(prev => {
      const next = { ...prev, ...crmDiff };
      setDirty(!paramsEqual(next, DEFAULT_PARAMS));
      return next;
    });
    setCrmOpen(false);
    toast({ title: "CRM assumptions applied — click Run to update chart" });
  }, [crmDiff, toast]);

  const handleSave = useCallback(() => {
    if (!simResult || !saveName.trim()) return;
    saveMut.mutate({
      name: saveName.trim(), description: saveDesc.trim() || undefined,
      parameters: params, projection: simResult, baselineSnapshot: baseline ?? {},
      sourceType: "manual",
    });
  }, [simResult, saveName, saveDesc, params, baseline, saveMut]);

  const handleLoadScenario = useCallback((sc: SavedScenario) => {
    const p = sc.parameters ?? DEFAULT_PARAMS;
    setPendingParams(p); setDirty(!paramsEqual(p, DEFAULT_PARAMS));
    simulateMut.mutate(p);
    setActiveScenarioId(sc.id);
    toast({ title: `Loaded: ${sc.name}` });
  }, [simulateMut, toast]);

  const handleCompare = useCallback((sc: SavedScenario) => {
    const existing = compareEntries.findIndex(e => e.scenario.id === sc.id);
    if (existing >= 0) { setCompareEntries(prev => prev.filter(e => e.scenario.id !== sc.id)); return; }
    if (compareEntries.length >= 3) { toast({ title: "Max 3 scenarios", variant: "destructive" }); return; }
    const result = sc.projection as SimResult;
    if (!result?.months) return;
    setCompareEntries(prev => [...prev, { scenario: sc, result, color: COMPARE_COLORS[prev.length] }]);
  }, [compareEntries, toast]);

  const handleOpenActions = useCallback((sc: SavedScenario) => {
    setActiveScenarioId(sc.id);
    setActionsOpen(true);
  }, []);

  // ── Computed actions from current sim (unsaved) ──
  const generatedActions: RecommendedAction[] = simResult ? (() => {
    const p = simResult.summary.paramsApplied ?? {};
    const s = simResult.summary;
    const actions: RecommendedAction[] = [];
    if (s.totalDelta < 0) actions.push({ title: `Close the ${fmt(Math.abs(s.totalDelta))} gap: add qualified pipeline`, rationale: `Scenario is ${Math.abs(s.deltaPct).toFixed(1)}% below baseline. Top-of-funnel volume is the fastest lever.`, priority: "high", linkedObjectType: "lead" });
    if ((p.winRateMultiplier ?? 1) < 0.9) actions.push({ title: "Review proposal-to-close process — win rate below target", rationale: `Win rate at ${((p.winRateMultiplier ?? 1) * 100).toFixed(0)}%. Focus on objection handling and demo quality.`, priority: "high", linkedObjectType: "opportunity" });
    if ((p.dealSizeMultiplier ?? 1) < 0.85) actions.push({ title: "Audit deal pricing — average deal size is compressed", rationale: `Deal size at ${((p.dealSizeMultiplier ?? 1) * 100).toFixed(0)}% of baseline. Review quoting and upsell opportunities.`, priority: "high", linkedObjectType: "opportunity" });
    if ((p.velocityWeeks ?? 0) > 3) actions.push({ title: "Resolve blockers slowing pipeline by more than 3 weeks", rationale: `Deals are closing ${p.velocityWeeks} weeks later than baseline. Target proposals in approval.`, priority: "medium", linkedObjectType: "opportunity" });
    if ((p.newPipelineDeals ?? 0) > 0) actions.push({ title: `Generate ${p.newPipelineDeals} new qualified opportunities`, rationale: "Scenario relies on net-new pipeline creation. Assign SDR targets and activate outbound.", priority: "high", linkedObjectType: "lead" });
    if ((p.churnRateMonthly ?? 0) > 0.03) actions.push({ title: "Launch customer success check-ins to reduce churn", rationale: `Monthly churn of ${((p.churnRateMonthly ?? 0) * 100).toFixed(1)}% compounds over projection. Target at-risk accounts.`, priority: "high", linkedObjectType: "account" });
    if ((p.expansionRateMonthly ?? 0) > 0.02) actions.push({ title: "Activate expansion playbook for existing accounts", rationale: `${((p.expansionRateMonthly ?? 0) * 100).toFixed(1)}%/mo expansion assumed. Start with high-NPS accounts.`, priority: "medium", linkedObjectType: "account" });
    if (actions.length === 0) actions.push({ title: "Maintain pipeline health — scenario near baseline", rationale: "Current settings project near-baseline performance. Focus on deal quality and velocity.", priority: "low" });
    return actions.slice(0, 7);
  })() : [];

  // ── Chart data ──
  const chartData = (() => {
    const active = simResult ?? baseline;
    if (!active?.months) return [];
    return active.months.map((m, i) => {
      const point: Record<string, any> = { label: m.label, Baseline: Math.round(m.baseline), Simulated: Math.round(m.simulated) };
      compareEntries.forEach(ce => { const cm = ce.result.months?.[i]; if (cm) point[ce.scenario.name] = Math.round(cm.simulated); });
      return point;
    });
  })();

  const summary = simResult?.summary ?? baseline?.summary;

  // ── Forecast vs actuals chart ──
  const fvaChartData = (forecastActuals?.rows ?? []).map(r => ({
    label: r.month_key,
    Forecast: r.forecast_amount,
    Actual: r.actual_amount,
    Variance: r.variance_amount,
  }));

  return (
    <>
      <title>Revenue Simulator — VoltSafe Growth OS</title>
      <div className="flex flex-col h-full overflow-hidden bg-zinc-50 dark:bg-zinc-950">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950">
              <FlaskRound className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Revenue Simulator</h1>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Model scenarios against your live pipeline</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {dirty && (
              <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-700">
                Unsaved changes
              </Badge>
            )}
            <Button data-testid="button-crm-baseline" variant="outline" size="sm" onClick={() => setCrmOpen(true)}>
              <Brain className="w-3.5 h-3.5 mr-1" />CRM Baseline
            </Button>
            <Button data-testid="button-forecast-actuals" variant="outline" size="sm" onClick={() => setForecastOpen(p => !p)}>
              <BarChart2 className="w-3.5 h-3.5 mr-1" />Forecast vs Actuals
            </Button>
            <Button data-testid="button-reset" variant="outline" size="sm" onClick={handleReset} disabled={!dirty && !simResult}>
              <RotateCcw className="w-3.5 h-3.5 mr-1" />Reset
            </Button>
            <Button data-testid="button-run" size="sm" onClick={handleRun} disabled={simulateMut.isPending}>
              <Play className="w-3.5 h-3.5 mr-1" />
              {simulateMut.isPending ? "Running…" : "Run Simulation"}
            </Button>
            <Button data-testid="button-save" variant="outline" size="sm" onClick={() => setSaveOpen(true)} disabled={!simResult || simulateMut.isPending}>
              <Save className="w-3.5 h-3.5 mr-1" />Save Scenario
            </Button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">

          {/* ── Left: Controls ── */}
          <div className="w-72 flex-shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-y-auto p-5 pb-36 md:pb-24">
            <div className="flex items-center gap-2 mb-5">
              <SlidersHorizontal className="w-4 h-4 text-zinc-500" />
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 uppercase tracking-wide">Parameters</span>
            </div>

            <ParamSlider label="Win Rate" hint="Scale stage-weighted probabilities"
              value={pendingParams.winRateMultiplier ?? 1.0} min={0.1} max={2.5} step={0.05}
              display={v => `${v.toFixed(2)}×`} onChange={v => updateParam("winRateMultiplier", v)} />

            <ParamSlider label="Avg Deal Size" hint="Scale opportunity amounts"
              value={pendingParams.dealSizeMultiplier ?? 1.0} min={0.1} max={3.0} step={0.05}
              display={v => `${v.toFixed(2)}×`} onChange={v => updateParam("dealSizeMultiplier", v)} />

            <ParamSlider label="Deal Velocity" hint="Shift close dates earlier (−) or later (+)"
              value={pendingParams.velocityWeeks ?? 0} min={-12} max={12} step={1}
              display={v => v === 0 ? "±0 wks" : v > 0 ? `+${v} wks` : `${v} wks`}
              onChange={v => updateParam("velocityWeeks", v)} />

            <ParamSlider label="New Pipeline Deals" hint="Add synthetic deals at discovery probability"
              value={pendingParams.newPipelineDeals ?? 0} min={0} max={50} step={1}
              display={v => `${v} deals`} onChange={v => updateParam("newPipelineDeals", v)} />

            <ParamSlider label="Churn Rate" hint="Monthly ARR erosion applied per period"
              value={pendingParams.churnRateMonthly ?? 0} min={0} max={0.15} step={0.005}
              display={v => `${(v * 100).toFixed(1)}%/mo`} onChange={v => updateParam("churnRateMonthly", v)} />

            <ParamSlider label="Expansion Rate" hint="Monthly uplift from upsells/cross-sells"
              value={pendingParams.expansionRateMonthly ?? 0} min={0} max={0.15} step={0.005}
              display={v => `${(v * 100).toFixed(1)}%/mo`} onChange={v => updateParam("expansionRateMonthly", v)} />

            <div className="mb-4">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200 block mb-1">Forecast Category</label>
              <Select value={pendingParams.forecastCategory ?? "all"} onValueChange={v => updateParam("forecastCategory", v)}>
                <SelectTrigger data-testid="select-forecast-category" className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Open Deals</SelectItem>
                  <SelectItem value="commit">Commit Only</SelectItem>
                  <SelectItem value="commit_best_case">Commit + Best Case</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="mb-4">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200 block mb-1">Projection Horizon</label>
              <Select value={String(pendingParams.months ?? 12)} onValueChange={v => updateParam("months", parseInt(v))}>
                <SelectTrigger data-testid="select-months" className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3 Months</SelectItem>
                  <SelectItem value="6">6 Months</SelectItem>
                  <SelectItem value="12">12 Months</SelectItem>
                  <SelectItem value="18">18 Months</SelectItem>
                  <SelectItem value="24">24 Months</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(pendingParams.newPipelineDeals ?? 0) > 0 && (
              <div className="mb-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-100 dark:border-blue-900">
                <label className="text-xs font-medium text-blue-700 dark:text-blue-300 block mb-1">New Deal Avg Size Override</label>
                <Input data-testid="input-new-pipeline-avg-size" type="number" placeholder="Use live avg deal size"
                  className="h-7 text-xs" value={pendingParams.newPipelineAvgSize ?? ""}
                  onChange={e => updateParam("newPipelineAvgSize", e.target.value ? parseFloat(e.target.value) : undefined)} />
                <p className="text-xs text-blue-500 mt-1">Leave blank to use live avg ({fmt(simResult?.summary?.avgDealSize ?? 0)})</p>
              </div>
            )}

            {/* Recommended Actions quick view */}
            {simResult && generatedActions.length > 0 && (
              <div className="mt-2">
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-4 h-4 text-zinc-500" />
                  <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 uppercase tracking-wide">Recommended Actions</span>
                </div>
                <div className="space-y-2">
                  {generatedActions.slice(0, 3).map((a, i) => (
                    <div key={i} className={`rounded-lg p-2.5 text-xs ${PRIORITY_COLORS[a.priority]}`}>
                      <p className="font-medium leading-tight">{a.title}</p>
                      <p className="text-zinc-400 dark:text-zinc-500 mt-0.5 text-[10px]">{a.priority} priority</p>
                    </div>
                  ))}
                  {generatedActions.length > 3 && (
                    <p className="text-xs text-zinc-400 text-center">+{generatedActions.length - 3} more — save scenario to track all</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Right: Chart + Results ── */}
          <div className="flex-1 overflow-y-auto p-6 pb-24 md:pb-6">

            {/* Summary cards */}
            {summary && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                <SummaryCard label="Simulated Total" value={fmt(summary.totalSimulated)} sub={`vs ${fmt(summary.totalBaseline)} baseline`} testId="card-total-simulated" />
                <SummaryCard label="vs Baseline" value={fmtSign(summary.totalDelta)} sub={pct(summary.deltaPct)} positive={summary.totalDelta >= 0} testId="card-vs-baseline" />
                <SummaryCard label="Peak Month" value={summary.peakMonth} sub={fmt(summary.peakAmount)} testId="card-peak-month" />
                <SummaryCard label="Deals in Scope" value={String(summary.dealsIncluded)} sub={`avg ${fmt(summary.avgDealSize)}`} testId="card-deals-in-scope" />
              </div>
            )}

            {/* Forecast vs Actuals (collapsible) */}
            {forecastOpen && (
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden mb-5">
                <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 dark:border-zinc-800">
                  <div className="flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-zinc-500" />
                    <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Forecast vs Actuals</span>
                    {forecastActuals && (
                      <Badge variant="outline" className={forecastActuals.totalVariance >= 0 ? "text-emerald-600 border-emerald-300" : "text-red-500 border-red-300"}>
                        {forecastActuals.totalVariance >= 0 ? "+" : ""}{fmt(forecastActuals.totalVariance)} variance
                      </Badge>
                    )}
                  </div>
                  <Button data-testid="button-add-actual" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setActualsOpen(true)}>
                    <Plus className="w-3 h-3 mr-1" />Add Actual
                  </Button>
                </div>

                {fvaLoading ? (
                  <div className="h-48 flex items-center justify-center text-zinc-400 text-sm">Loading…</div>
                ) : !forecastActuals?.hasSufficientData ? (
                  <div className="h-48 flex flex-col items-center justify-center gap-3">
                    <TrendingUp className="w-8 h-8 text-zinc-300 dark:text-zinc-600" />
                    <p className="text-sm text-zinc-400 dark:text-zinc-500">No actuals recorded yet.</p>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setActualsOpen(true)}>
                      <Plus className="w-3 h-3 mr-1" />Record first actual
                    </Button>
                  </div>
                ) : (
                  <div className="p-5">
                    <div className="grid grid-cols-3 gap-3 mb-4 text-xs">
                      <div className="text-center">
                        <p className="text-zinc-400">Total Forecast</p>
                        <p className="font-bold text-zinc-800 dark:text-zinc-200">{fmt(forecastActuals.totalForecast)}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-zinc-400">Total Actual</p>
                        <p className="font-bold text-zinc-800 dark:text-zinc-200">{fmt(forecastActuals.totalActual)}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-zinc-400">Variance</p>
                        <p className={`font-bold ${forecastActuals.totalVariance >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                          {pct(forecastActuals.variancePct)}
                        </p>
                      </div>
                    </div>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={fvaChartData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.5} />
                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                        <YAxis tickFormatter={v => fmt(v)} tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={55} />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="Forecast" fill="#94a3b8" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="Actual" radius={[3, 3, 0, 0]}>
                          {fvaChartData.map((entry, i) => (
                            <Cell key={i} fill={entry.Variance >= 0 ? "#16a34a" : "#dc2626"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            )}

            {/* Main chart */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 mb-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Monthly Revenue Projection</h2>
                {simulateMut.isPending && <span className="text-xs text-blue-500 animate-pulse">Simulating…</span>}
              </div>
              {(baselineLoading || simulateMut.isPending) && !simResult ? (
                <div className="h-64 flex items-center justify-center text-zinc-400 text-sm">Loading…</div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                    <defs>
                      <linearGradient id="gradSimulated" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="gradBaseline" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#94a3b8" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.5} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} />
                    <YAxis tickFormatter={v => fmt(v)} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={60} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                    <Area type="monotone" dataKey="Baseline" stroke="#94a3b8" fill="url(#gradBaseline)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} activeDot={{ r: 4 }} />
                    <Area type="monotone" dataKey="Simulated" stroke="#3b82f6" fill="url(#gradSimulated)" strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
                    {compareEntries.map(ce => (
                      <Line key={ce.scenario.id} type="monotone" dataKey={ce.scenario.name} stroke={ce.color} strokeWidth={1.5} dot={false} activeDot={{ r: 4 }} />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Month breakdown table */}
            {simResult?.months && simResult.months.length > 0 && (
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden mb-5">
                <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800">
                  <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Month-by-Month Breakdown</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-500 dark:text-zinc-400">
                        <th className="text-left px-4 py-2 font-medium">Month</th>
                        <th className="text-right px-4 py-2 font-medium">Baseline</th>
                        <th className="text-right px-4 py-2 font-medium">Simulated</th>
                        <th className="text-right px-4 py-2 font-medium">Delta</th>
                        <th className="text-right px-4 py-2 font-medium">Deals</th>
                      </tr>
                    </thead>
                    <tbody>
                      {simResult.months.map(m => (
                        <tr key={m.month} data-testid={`row-month-${m.month}`} className="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
                          <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300 font-medium">{m.label}</td>
                          <td className="px-4 py-2 text-right text-zinc-500 dark:text-zinc-400 tabular-nums">{fmt(m.baseline)}</td>
                          <td className="px-4 py-2 text-right font-semibold text-zinc-800 dark:text-zinc-200 tabular-nums">{fmt(m.simulated)}</td>
                          <td className={`px-4 py-2 text-right tabular-nums font-medium ${m.delta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
                            {fmtSign(m.delta)}
                          </td>
                          <td className="px-4 py-2 text-right text-zinc-400 dark:text-zinc-500">{m.dealCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Saved Scenarios */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
              <button data-testid="toggle-scenarios"
                className="w-full flex items-center justify-between px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
                onClick={() => setScenariosOpen(p => !p)}>
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-zinc-500" />
                  <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Saved Scenarios</span>
                  <Badge variant="secondary" className="text-xs">{scenarios.length}</Badge>
                  {compareEntries.length > 0 && (
                    <Badge className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border-blue-200 dark:border-blue-800">
                      {compareEntries.length} comparing
                    </Badge>
                  )}
                  {scenarios.some(s => s.is_pinned) && (
                    <Badge className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border-amber-200">
                      1 pinned
                    </Badge>
                  )}
                </div>
                {scenariosOpen ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
              </button>

              {scenariosOpen && (
                <div>
                  {scenariosLoading ? (
                    <div className="px-5 py-8 text-center text-xs text-zinc-400">Loading…</div>
                  ) : scenarios.length === 0 ? (
                    <div className="px-5 py-8 text-center">
                      <FlaskRound className="w-8 h-8 text-zinc-300 dark:text-zinc-600 mx-auto mb-2" />
                      <p className="text-sm text-zinc-400 dark:text-zinc-500">No saved scenarios yet.</p>
                      <p className="text-xs text-zinc-400 mt-1">Run a simulation and hit <strong>Save Scenario</strong>.</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {scenarios.map(sc => {
                        const isCompared = compareEntries.some(e => e.scenario.id === sc.id);
                        const compareColor = compareEntries.find(e => e.scenario.id === sc.id)?.color;
                        const scSummary = (sc.projection as SimResult)?.summary;
                        return (
                          <div key={sc.id} data-testid={`scenario-row-${sc.id}`}
                            className={`flex items-center gap-3 px-5 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors ${sc.is_pinned ? "bg-amber-50/30 dark:bg-amber-950/20" : ""}`}>
                            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: compareColor ?? "#e2e8f0" }} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">{sc.name}</p>
                                {/* Provenance badge */}
                                <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-zinc-500 border-zinc-300">
                                  {SOURCE_LABELS[sc.source_type] ?? sc.source_type}
                                </Badge>
                                {sc.is_pinned && (
                                  <Badge className="text-[10px] h-4 px-1.5 bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border-amber-200">
                                    📌 Pinned
                                  </Badge>
                                )}
                                {sc.board_pack_include && (
                                  <Badge className="text-[10px] h-4 px-1.5 bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border-indigo-200">
                                    Board Pack
                                  </Badge>
                                )}
                              </div>
                              {sc.description && <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate">{sc.description}</p>}
                              {scSummary && (
                                <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
                                  {fmt(scSummary.totalSimulated)} total
                                  <span className={scSummary.totalDelta >= 0 ? "text-emerald-500 ml-1" : "text-red-400 ml-1"}>
                                    ({pct(scSummary.deltaPct)})
                                  </span>
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-1 flex-wrap justify-end">
                              <Button data-testid={`button-load-scenario-${sc.id}`} variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleLoadScenario(sc)}>
                                Load
                              </Button>
                              <Button data-testid={`button-compare-scenario-${sc.id}`} variant={isCompared ? "default" : "outline"} size="sm" className="h-7 text-xs" onClick={() => handleCompare(sc)}>
                                {isCompared ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                                {isCompared ? "On" : "+"}
                              </Button>
                              <Button
                                data-testid={`button-pin-scenario-${sc.id}`}
                                variant={sc.is_pinned ? "default" : "ghost"} size="sm"
                                className={`h-7 w-7 p-0 ${sc.is_pinned ? "text-amber-600" : "text-zinc-400 hover:text-amber-500"}`}
                                onClick={() => pinMut.mutate(sc.id)} disabled={pinMut.isPending}
                                title={sc.is_pinned ? "Unpin scenario" : "Pin scenario"}
                              >
                                <Pin className="w-3 h-3" />
                              </Button>
                              <Button
                                data-testid={`button-board-pack-scenario-${sc.id}`}
                                variant={sc.board_pack_include ? "default" : "ghost"} size="sm"
                                className={`h-7 w-7 p-0 ${sc.board_pack_include ? "text-indigo-600" : "text-zinc-400 hover:text-indigo-500"}`}
                                onClick={() => boardPackMut.mutate(sc.id)} disabled={boardPackMut.isPending}
                                title={sc.board_pack_include ? "Remove from board pack" : "Include in board pack"}
                              >
                                <LayoutGrid className="w-3 h-3" />
                              </Button>
                              <Button
                                data-testid={`button-actions-scenario-${sc.id}`}
                                variant="ghost" size="sm" className="h-7 w-7 p-0 text-zinc-400 hover:text-blue-500"
                                onClick={() => handleOpenActions(sc)} title="View/manage actions"
                              >
                                <ListChecks className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                data-testid={`button-delete-scenario-${sc.id}`}
                                variant="ghost" size="sm" className="h-7 w-7 p-0 text-zinc-400 hover:text-red-500"
                                onClick={() => deleteMut.mutate(sc.id)} disabled={deleteMut.isPending}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Save Dialog ── */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Save Scenario</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 block mb-1">Name <span className="text-red-500">*</span></label>
              <Input data-testid="input-scenario-name" value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="e.g. Optimistic Q3, Win Rate +20%" />
            </div>
            <div>
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 block mb-1">Description</label>
              <Textarea data-testid="input-scenario-description" value={saveDesc} onChange={e => setSaveDesc(e.target.value)} placeholder="Optional notes…" rows={3} />
            </div>
            {simResult?.summary && (
              <div className="text-xs text-zinc-500 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-3 space-y-1">
                <p>Simulated Total: <strong>{fmt(simResult.summary.totalSimulated)}</strong></p>
                <p>vs Baseline: <strong className={simResult.summary.totalDelta >= 0 ? "text-emerald-600" : "text-red-500"}>
                  {fmtSign(simResult.summary.totalDelta)} ({pct(simResult.summary.deltaPct)})
                </strong></p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>Cancel</Button>
            <Button data-testid="button-confirm-save" onClick={handleSave} disabled={!saveName.trim() || saveMut.isPending}>
              {saveMut.isPending ? "Saving…" : "Save Scenario"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── CRM Baseline Dialog ── */}
      <Dialog open={crmOpen} onOpenChange={setCrmOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-blue-500" /> CRM-Derived Baseline
            </DialogTitle>
          </DialogHeader>
          {crmLoading ? (
            <div className="py-12 flex items-center justify-center gap-2 text-zinc-400">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Analysing pipeline data…</span>
            </div>
          ) : crmBaseline ? (
            <div className="py-2 space-y-4">
              {/* Data coverage badge */}
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={
                  crmBaseline.dataCoverage === "full" ? "text-emerald-600 border-emerald-300"
                  : crmBaseline.dataCoverage === "partial" ? "text-amber-600 border-amber-300"
                  : "text-red-500 border-red-300"}>
                  Data coverage: {crmBaseline.dataCoverage}
                </Badge>
                <span className="text-xs text-zinc-400">({crmBaseline.wonLast180} won, {crmBaseline.lostLast180} lost last 180 days)</span>
              </div>

              {/* Key stats */}
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-3">
                  <p className="text-zinc-400 mb-1">Avg Deal Size</p>
                  <p className="font-bold text-zinc-800 dark:text-zinc-200">{fmt(crmBaseline.avgDealSize)}</p>
                </div>
                <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-3">
                  <p className="text-zinc-400 mb-1">Win Rate</p>
                  <p className="font-bold text-zinc-800 dark:text-zinc-200">{crmBaseline.winRate > 0 ? `${Math.round(crmBaseline.winRate * 100)}%` : "n/a"}</p>
                </div>
                <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-3">
                  <p className="text-zinc-400 mb-1">Avg Cycle</p>
                  <p className="font-bold text-zinc-800 dark:text-zinc-200">{crmBaseline.avgSalesCycleDays}d</p>
                </div>
              </div>

              {/* CRM notes */}
              <div className="space-y-1">
                {crmBaseline.notes.map((n, i) => (
                  <p key={i} className="text-xs text-zinc-500 dark:text-zinc-400 flex items-start gap-1.5">
                    <span className="text-blue-400 mt-0.5">•</span>{n}
                  </p>
                ))}
              </div>

              {/* What changes if applied */}
              {crmBaseline.impliedParams && Object.keys(crmBaseline.impliedParams).length > 0 && (
                <div className="border border-blue-100 dark:border-blue-900 rounded-lg p-3 bg-blue-50 dark:bg-blue-950/30">
                  <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-2">Will apply these parameter changes:</p>
                  <div className="space-y-1">
                    {crmBaseline.impliedParams.winRateMultiplier != null && (
                      <p className="text-xs text-blue-600 dark:text-blue-400">• Win rate: → {crmBaseline.impliedParams.winRateMultiplier.toFixed(2)}×</p>
                    )}
                    {crmBaseline.impliedParams.velocityWeeks != null && (
                      <p className="text-xs text-blue-600 dark:text-blue-400">• Velocity: → {crmBaseline.impliedParams.velocityWeeks > 0 ? "+" : ""}{crmBaseline.impliedParams.velocityWeeks} weeks</p>
                    )}
                    {crmBaseline.impliedParams.newPipelineAvgSize != null && (
                      <p className="text-xs text-blue-600 dark:text-blue-400">• New deal avg size: → {fmt(crmBaseline.impliedParams.newPipelineAvgSize)}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-zinc-400">Could not load CRM data</div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCrmOpen(false)}>Close</Button>
            {crmBaseline && (
              <Button data-testid="button-apply-crm" onClick={() => { setCrmDiff(crmBaseline.impliedParams); handleApplyCRM(); }}>
                <RefreshCcw className="w-3.5 h-3.5 mr-1.5" />Apply CRM Assumptions
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Actions Dialog ── */}
      <Dialog open={actionsOpen} onOpenChange={setActionsOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListChecks className="w-5 h-5 text-blue-500" />
              Scenario Actions
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            {actionsLoading ? (
              <div className="flex items-center justify-center py-8 gap-2 text-zinc-400">
                <Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm">Loading…</span>
              </div>
            ) : scenarioActions.length === 0 ? (
              <div>
                <p className="text-sm text-zinc-400 text-center mb-4">No saved actions yet — save these recommended actions to start tracking:</p>
                <div className="space-y-2 mb-4">
                  {generatedActions.map((a, i) => (
                    <div key={i} className={`rounded-lg p-3 text-xs ${PRIORITY_COLORS[a.priority]}`}>
                      <p className="font-medium">{a.title}</p>
                      <p className="mt-0.5 opacity-70">{a.rationale}</p>
                    </div>
                  ))}
                </div>
                {activeScenarioId && generatedActions.length > 0 && (
                  <Button data-testid="button-save-actions" className="w-full" onClick={() => saveActionsMut.mutate({ id: activeScenarioId, actions: generatedActions })} disabled={saveActionsMut.isPending}>
                    {saveActionsMut.isPending ? "Saving…" : `Save ${generatedActions.length} actions`}
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {scenarioActions.map(action => {
                  const Icon = STATUS_ICONS[action.status] ?? Circle;
                  const NEXT_STATUS: Record<string, string> = { open: "in_progress", in_progress: "done", done: "dropped", dropped: "open" };
                  return (
                    <div key={action.id} data-testid={`action-row-${action.id}`}
                      className="flex items-start gap-3 p-3 rounded-lg border border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
                      <button
                        data-testid={`action-status-${action.id}`}
                        className="mt-0.5 flex-shrink-0 hover:opacity-70 transition-opacity"
                        onClick={() => updateActionMut.mutate({ id: action.id, status: NEXT_STATUS[action.status] ?? "open" })}
                        title={`Mark as ${NEXT_STATUS[action.status] ?? "open"}`}
                      >
                        <Icon className={`w-4 h-4 ${action.status === "done" ? "text-emerald-500" : action.status === "in_progress" ? "text-blue-500" : action.status === "dropped" ? "text-zinc-300" : "text-zinc-400"}`} />
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${action.status === "done" ? "line-through text-zinc-400" : action.status === "dropped" ? "text-zinc-300" : "text-zinc-800 dark:text-zinc-200"}`}>
                          {action.title}
                        </p>
                        {action.notes && <p className="text-xs text-zinc-400 mt-0.5">{action.notes}</p>}
                        {action.owner_name && <p className="text-xs text-zinc-400 mt-0.5">Owner: {action.owner_name}</p>}
                      </div>
                      <Badge variant="outline" className={`text-[10px] flex-shrink-0 ${
                        action.status === "done" ? "text-emerald-600 border-emerald-200" :
                        action.status === "in_progress" ? "text-blue-600 border-blue-200" :
                        action.status === "dropped" ? "text-zinc-400" : "text-zinc-500"}`}>
                        {action.status.replace("_", " ")}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionsOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add Actual Dialog ── */}
      <Dialog open={actualsOpen} onOpenChange={setActualsOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Record Monthly Actual</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 block mb-1">Month (YYYY-MM) <span className="text-red-500">*</span></label>
              <Input data-testid="input-actuals-month" value={actualsEntry.month_key} onChange={e => setActualsEntry(p => ({ ...p, month_key: e.target.value }))} placeholder="2024-06" />
            </div>
            <div>
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 block mb-1">Actual Revenue <span className="text-red-500">*</span></label>
              <Input data-testid="input-actuals-amount" type="number" value={actualsEntry.actual_amount} onChange={e => setActualsEntry(p => ({ ...p, actual_amount: e.target.value }))} placeholder="125000" />
            </div>
            <div>
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 block mb-1">Forecasted Amount (optional)</label>
              <Input data-testid="input-forecast-amount" type="number" value={actualsEntry.forecast_amount} onChange={e => setActualsEntry(p => ({ ...p, forecast_amount: e.target.value }))} placeholder="Leave blank to use pinned scenario" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActualsOpen(false)}>Cancel</Button>
            <Button data-testid="button-save-actual"
              onClick={() => actualsMut.mutate({
                month_key: actualsEntry.month_key,
                actual_amount: parseFloat(actualsEntry.actual_amount) || 0,
                forecast_amount: parseFloat(actualsEntry.forecast_amount) || 0,
              })}
              disabled={!actualsEntry.month_key || !actualsEntry.actual_amount || actualsMut.isPending}
            >
              {actualsMut.isPending ? "Saving…" : "Save Actual"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
