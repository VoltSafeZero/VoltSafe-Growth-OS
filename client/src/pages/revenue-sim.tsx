import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ReferenceLine,
} from "recharts";
import {
  FlaskRound, TrendingUp, TrendingDown, Play, Save, Trash2, ChevronDown,
  ChevronUp, RotateCcw, Plus, Check, Info, SlidersHorizontal, BookOpen,
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
  month: string;
  label: string;
  baseline: number;
  simulated: number;
  delta: number;
  deltaPct: number;
  dealCount: number;
};

type SimSummary = {
  totalBaseline: number;
  totalSimulated: number;
  totalDelta: number;
  deltaPct: number;
  peakMonth: string;
  peakAmount: number;
  dealsIncluded: number;
  avgDealSize: number;
  paramsApplied: SimParams;
};

type SimResult = {
  months: MonthProjection[];
  summary: SimSummary;
};

type SimParams = {
  winRateMultiplier?: number;
  dealSizeMultiplier?: number;
  velocityWeeks?: number;
  newPipelineDeals?: number;
  newPipelineAvgSize?: number;
  forecastCategory?: string;
  churnRateMonthly?: number;
  expansionRateMonthly?: number;
  months?: number;
};

type SavedScenario = {
  id: number;
  name: string;
  description: string | null;
  parameters: SimParams;
  projection: SimResult;
  baseline_snapshot: SimResult;
  created_at: string;
  updated_at: string;
};

type CompareEntry = {
  scenario: SavedScenario;
  result: SimResult;
  color: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const COMPARE_COLORS = ["#f59e0b", "#8b5cf6", "#ec4899"];

const DEFAULT_PARAMS: SimParams = {
  winRateMultiplier: 1.0,
  dealSizeMultiplier: 1.0,
  velocityWeeks: 0,
  newPipelineDeals: 0,
  forecastCategory: "all",
  churnRateMonthly: 0,
  expansionRateMonthly: 0,
  months: 12,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtSign(n: number): string {
  if (n >= 0) return `+${fmt(n)}`;
  return `-${fmt(Math.abs(n))}`;
}

function pct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function paramsEqual(a: SimParams, b: SimParams): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── Custom tooltip ─────────────────────────────────────────────────────────────

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

// ── Slider row ─────────────────────────────────────────────────────────────────

function ParamSlider({
  label, hint, value, min, max, step, display,
  onChange,
}: {
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
        onValueChange={([v]) => onChange(v)}
        className="mb-1"
      />
      <p className="text-xs text-zinc-400 dark:text-zinc-500">{hint}</p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RevenueSimPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [params, setParams] = useState<SimParams>(DEFAULT_PARAMS);
  const [pendingParams, setPendingParams] = useState<SimParams>(DEFAULT_PARAMS);
  const [dirty, setDirty] = useState(false);
  const [simResult, setSimResult] = useState<SimResult | null>(null);
  const [compareEntries, setCompareEntries] = useState<CompareEntry[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveDesc, setSaveDesc] = useState("");
  const [scenariosOpen, setScenariosOpen] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Baseline (auto-fetched)
  const { data: baseline, isLoading: baselineLoading } = useQuery<SimResult>({
    queryKey: ["/api/revenue-sim/baseline"],
  });

  // Saved scenarios
  const { data: scenarios = [], isLoading: scenariosLoading } = useQuery<SavedScenario[]>({
    queryKey: ["/api/revenue-sim/scenarios"],
  });

  // Simulate mutation
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

  // Save mutation
  const saveMut = useMutation({
    mutationFn: (body: any) =>
      apiRequest("POST", "/api/revenue-sim/scenarios", body).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/revenue-sim/scenarios"] });
      setSaveOpen(false);
      setSaveName("");
      setSaveDesc("");
      toast({ title: "Scenario saved" });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  // Delete mutation
  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/revenue-sim/scenarios/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/revenue-sim/scenarios"] });
      toast({ title: "Scenario deleted" });
    },
    onError: (err: any) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  // Auto-run simulation on first baseline load
  useEffect(() => {
    if (baseline && !simResult) {
      setSimResult(baseline);
    }
  }, [baseline]);

  const updateParam = useCallback(<K extends keyof SimParams>(key: K, val: SimParams[K]) => {
    setPendingParams(prev => {
      const next = { ...prev, [key]: val };
      setDirty(!paramsEqual(next, DEFAULT_PARAMS));
      return next;
    });
  }, []);

  const handleRun = useCallback(() => {
    simulateMut.mutate(pendingParams);
  }, [pendingParams, simulateMut]);

  const handleReset = useCallback(() => {
    setPendingParams(DEFAULT_PARAMS);
    setDirty(false);
    setSimResult(baseline ?? null);
    setParams(DEFAULT_PARAMS);
  }, [baseline]);

  const handleSave = useCallback(() => {
    if (!simResult || !saveName.trim()) return;
    saveMut.mutate({
      name: saveName.trim(),
      description: saveDesc.trim() || undefined,
      parameters: params,
      projection: simResult,
      baselineSnapshot: baseline ?? {},
    });
  }, [simResult, saveName, saveDesc, params, baseline, saveMut]);

  const handleLoadScenario = useCallback((sc: SavedScenario) => {
    const p = sc.parameters ?? DEFAULT_PARAMS;
    setPendingParams(p);
    setDirty(!paramsEqual(p, DEFAULT_PARAMS));
    simulateMut.mutate(p);
    toast({ title: `Loaded: ${sc.name}` });
  }, [simulateMut, toast]);

  const handleCompare = useCallback((sc: SavedScenario) => {
    const existing = compareEntries.findIndex(e => e.scenario.id === sc.id);
    if (existing >= 0) {
      setCompareEntries(prev => prev.filter(e => e.scenario.id !== sc.id));
      return;
    }
    if (compareEntries.length >= 3) {
      toast({ title: "Max 3 scenarios can be compared at once", variant: "destructive" });
      return;
    }
    const result = sc.projection as SimResult;
    if (!result?.months) return;
    const color = COMPARE_COLORS[compareEntries.length];
    setCompareEntries(prev => [...prev, { scenario: sc, result, color }]);
  }, [compareEntries, toast]);

  // Build chart data: merge all series by month label
  const chartData = (() => {
    const active = simResult ?? baseline;
    if (!active?.months) return [];
    return active.months.map((m, i) => {
      const point: Record<string, any> = {
        label: m.label,
        Baseline: Math.round(m.baseline),
        Simulated: Math.round(m.simulated),
      };
      compareEntries.forEach(ce => {
        const cm = ce.result.months?.[i];
        if (cm) point[ce.scenario.name] = Math.round(cm.simulated);
      });
      return point;
    });
  })();

  const summary = simResult?.summary ?? baseline?.summary;

  return (
    <>
      <title>Revenue Simulator — VoltSafe Growth OS</title>

      <div className="flex flex-col h-full overflow-hidden bg-zinc-50 dark:bg-zinc-950">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950">
              <FlaskRound className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Revenue Simulator</h1>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Model scenarios against your live pipeline</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {dirty && (
              <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-700">
                Unsaved changes
              </Badge>
            )}
            <Button
              data-testid="button-reset"
              variant="outline" size="sm"
              onClick={handleReset}
              disabled={!dirty && !simResult}
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" />
              Reset
            </Button>
            <Button
              data-testid="button-run"
              size="sm" onClick={handleRun}
              disabled={simulateMut.isPending}
            >
              <Play className="w-3.5 h-3.5 mr-1" />
              {simulateMut.isPending ? "Running…" : "Run Simulation"}
            </Button>
            <Button
              data-testid="button-save"
              variant="outline" size="sm"
              onClick={() => setSaveOpen(true)}
              disabled={!simResult || simulateMut.isPending}
            >
              <Save className="w-3.5 h-3.5 mr-1" />
              Save Scenario
            </Button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">

          {/* ── Left: Controls ── */}
          <div className="w-72 flex-shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-y-auto p-5">
            <div className="flex items-center gap-2 mb-5">
              <SlidersHorizontal className="w-4 h-4 text-zinc-500" />
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 uppercase tracking-wide">Parameters</span>
            </div>

            {/* Win Rate */}
            <ParamSlider
              label="Win Rate"
              hint="Scale stage-weighted probabilities"
              value={pendingParams.winRateMultiplier ?? 1.0}
              min={0.1} max={2.5} step={0.05}
              display={v => `${v.toFixed(2)}×`}
              onChange={v => updateParam("winRateMultiplier", v)}
            />

            {/* Deal Size */}
            <ParamSlider
              label="Avg Deal Size"
              hint="Scale opportunity amounts"
              value={pendingParams.dealSizeMultiplier ?? 1.0}
              min={0.1} max={3.0} step={0.05}
              display={v => `${v.toFixed(2)}×`}
              onChange={v => updateParam("dealSizeMultiplier", v)}
            />

            {/* Velocity */}
            <ParamSlider
              label="Deal Velocity"
              hint="Shift close dates earlier (−) or later (+)"
              value={pendingParams.velocityWeeks ?? 0}
              min={-12} max={12} step={1}
              display={v => v === 0 ? "±0 wks" : v > 0 ? `+${v} wks` : `${v} wks`}
              onChange={v => updateParam("velocityWeeks", v)}
            />

            {/* New Pipeline Deals */}
            <ParamSlider
              label="New Pipeline Deals"
              hint="Add synthetic deals at discovery probability"
              value={pendingParams.newPipelineDeals ?? 0}
              min={0} max={50} step={1}
              display={v => `${v} deals`}
              onChange={v => updateParam("newPipelineDeals", v)}
            />

            {/* Churn Rate */}
            <ParamSlider
              label="Churn Rate"
              hint="Monthly ARR erosion applied per period"
              value={pendingParams.churnRateMonthly ?? 0}
              min={0} max={0.15} step={0.005}
              display={v => `${(v * 100).toFixed(1)}%/mo`}
              onChange={v => updateParam("churnRateMonthly", v)}
            />

            {/* Expansion Rate */}
            <ParamSlider
              label="Expansion Rate"
              hint="Monthly uplift from upsells/cross-sells"
              value={pendingParams.expansionRateMonthly ?? 0}
              min={0} max={0.15} step={0.005}
              display={v => `${(v * 100).toFixed(1)}%/mo`}
              onChange={v => updateParam("expansionRateMonthly", v)}
            />

            {/* Forecast Category */}
            <div className="mb-4">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200 block mb-1">
                Forecast Category
              </label>
              <Select
                value={pendingParams.forecastCategory ?? "all"}
                onValueChange={v => updateParam("forecastCategory", v)}
              >
                <SelectTrigger data-testid="select-forecast-category" className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Open Deals</SelectItem>
                  <SelectItem value="commit">Commit Only</SelectItem>
                  <SelectItem value="commit_best_case">Commit + Best Case</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">Which deals to include</p>
            </div>

            {/* Horizon */}
            <div className="mb-4">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200 block mb-1">
                Projection Horizon
              </label>
              <Select
                value={String(pendingParams.months ?? 12)}
                onValueChange={v => updateParam("months", parseInt(v))}
              >
                <SelectTrigger data-testid="select-months" className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3 Months</SelectItem>
                  <SelectItem value="6">6 Months</SelectItem>
                  <SelectItem value="12">12 Months</SelectItem>
                  <SelectItem value="18">18 Months</SelectItem>
                  <SelectItem value="24">24 Months</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Advanced: newPipelineAvgSize (optional override) */}
            {(pendingParams.newPipelineDeals ?? 0) > 0 && (
              <div className="mb-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-100 dark:border-blue-900">
                <label className="text-xs font-medium text-blue-700 dark:text-blue-300 block mb-1">
                  New Deal Avg Size Override
                </label>
                <Input
                  data-testid="input-new-pipeline-avg-size"
                  type="number"
                  placeholder="Use live avg deal size"
                  className="h-7 text-xs"
                  value={pendingParams.newPipelineAvgSize ?? ""}
                  onChange={e => updateParam("newPipelineAvgSize", e.target.value ? parseFloat(e.target.value) : undefined)}
                />
                <p className="text-xs text-blue-500 mt-1">Leave blank to use live avg ({fmt(simResult?.summary?.avgDealSize ?? 0)})</p>
              </div>
            )}
          </div>

          {/* ── Right: Chart + Results ── */}
          <div className="flex-1 overflow-y-auto p-6">

            {/* Summary cards */}
            {summary && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                <SummaryCard
                  label="12-Mo Simulated"
                  value={fmt(summary.totalSimulated)}
                  sub={`vs ${fmt(summary.totalBaseline)} baseline`}
                  testId="card-total-simulated"
                />
                <SummaryCard
                  label="vs Baseline"
                  value={fmtSign(summary.totalDelta)}
                  sub={pct(summary.deltaPct)}
                  positive={summary.totalDelta >= 0}
                  testId="card-vs-baseline"
                />
                <SummaryCard
                  label="Peak Month"
                  value={summary.peakMonth}
                  sub={fmt(summary.peakAmount)}
                  testId="card-peak-month"
                />
                <SummaryCard
                  label="Deals in Scope"
                  value={String(summary.dealsIncluded)}
                  sub={`avg ${fmt(summary.avgDealSize)}`}
                  testId="card-deals-in-scope"
                />
              </div>
            )}

            {/* Chart */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 mb-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                  Monthly Revenue Projection
                </h2>
                {simulateMut.isPending && (
                  <span className="text-xs text-blue-500 animate-pulse">Simulating…</span>
                )}
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
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: "#94a3b8" }}
                      axisLine={{ stroke: "#e2e8f0" }}
                      tickLine={false}
                    />
                    <YAxis
                      tickFormatter={v => fmt(v)}
                      tick={{ fontSize: 11, fill: "#94a3b8" }}
                      axisLine={false}
                      tickLine={false}
                      width={60}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                    <Area
                      type="monotone" dataKey="Baseline"
                      stroke="#94a3b8" fill="url(#gradBaseline)"
                      strokeWidth={1.5} strokeDasharray="4 4"
                      dot={false} activeDot={{ r: 4 }}
                    />
                    <Area
                      type="monotone" dataKey="Simulated"
                      stroke="#3b82f6" fill="url(#gradSimulated)"
                      strokeWidth={2}
                      dot={false} activeDot={{ r: 5 }}
                    />
                    {compareEntries.map(ce => (
                      <Line
                        key={ce.scenario.id}
                        type="monotone"
                        dataKey={ce.scenario.name}
                        stroke={ce.color}
                        strokeWidth={1.5}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Month table */}
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
                      {simResult.months.map((m, i) => (
                        <tr
                          key={m.month}
                          data-testid={`row-month-${m.month}`}
                          className="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
                        >
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
              <button
                data-testid="toggle-scenarios"
                className="w-full flex items-center justify-between px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
                onClick={() => setScenariosOpen(p => !p)}
              >
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-zinc-500" />
                  <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Saved Scenarios</span>
                  <Badge variant="secondary" className="text-xs">{scenarios.length}</Badge>
                  {compareEntries.length > 0 && (
                    <Badge className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border-blue-200 dark:border-blue-800">
                      {compareEntries.length} in compare
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
                    <div className="px-5 py-8 text-center text-xs text-zinc-400">
                      No saved scenarios yet. Run a simulation and hit <strong>Save Scenario</strong>.
                    </div>
                  ) : (
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {scenarios.map(sc => {
                        const isCompared = compareEntries.some(e => e.scenario.id === sc.id);
                        const compareColor = compareEntries.find(e => e.scenario.id === sc.id)?.color;
                        const scSummary = (sc.projection as SimResult)?.summary;
                        return (
                          <div
                            key={sc.id}
                            data-testid={`scenario-row-${sc.id}`}
                            className="flex items-center gap-3 px-5 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
                          >
                            <div
                              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                              style={{ background: compareColor ?? "#e2e8f0" }}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">{sc.name}</p>
                              {sc.description && (
                                <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate">{sc.description}</p>
                              )}
                              {scSummary && (
                                <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
                                  {fmt(scSummary.totalSimulated)} total
                                  <span className={scSummary.totalDelta >= 0 ? "text-emerald-500 ml-1" : "text-red-400 ml-1"}>
                                    ({pct(scSummary.deltaPct)})
                                  </span>
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Button
                                data-testid={`button-load-scenario-${sc.id}`}
                                variant="outline" size="sm"
                                className="h-7 text-xs"
                                onClick={() => handleLoadScenario(sc)}
                              >
                                Load
                              </Button>
                              <Button
                                data-testid={`button-compare-scenario-${sc.id}`}
                                variant={isCompared ? "default" : "outline"}
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => handleCompare(sc)}
                              >
                                {isCompared ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                                {isCompared ? "Comparing" : "Compare"}
                              </Button>
                              <Button
                                data-testid={`button-delete-scenario-${sc.id}`}
                                variant="ghost" size="sm"
                                className="h-7 w-7 p-0 text-zinc-400 hover:text-red-500"
                                onClick={() => deleteMut.mutate(sc.id)}
                                disabled={deleteMut.isPending}
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
          <DialogHeader>
            <DialogTitle>Save Scenario</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 block mb-1">
                Name <span className="text-red-500">*</span>
              </label>
              <Input
                data-testid="input-scenario-name"
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
                placeholder="e.g. Optimistic Q3, Win Rate +20%"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 block mb-1">Description</label>
              <Textarea
                data-testid="input-scenario-description"
                value={saveDesc}
                onChange={e => setSaveDesc(e.target.value)}
                placeholder="Optional notes about this scenario…"
                rows={3}
              />
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
            <Button
              data-testid="button-confirm-save"
              onClick={handleSave}
              disabled={!saveName.trim() || saveMut.isPending}
            >
              {saveMut.isPending ? "Saving…" : "Save Scenario"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Summary card component ────────────────────────────────────────────────────

function SummaryCard({
  label, value, sub, positive, testId,
}: {
  label: string; value: string; sub?: string; positive?: boolean; testId?: string;
}) {
  const subColor = positive === undefined
    ? "text-zinc-400 dark:text-zinc-500"
    : positive
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-red-500 dark:text-red-400";

  return (
    <div
      data-testid={testId}
      className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-4 py-3"
    >
      <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">{label}</p>
      <p className="text-xl font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">{value}</p>
      {sub && <p className={`text-xs font-medium mt-0.5 ${subColor}`}>{sub}</p>}
    </div>
  );
}
