/**
 * Smart Revenue Simulator
 * Applies scenario multipliers to the live opportunity pipeline
 * and projects month-by-month revenue over 12 months.
 *
 * REUSES: stage probability weights identical to composePipelineForecast()
 *         in report-composer.ts and the /api/pipeline/forecast route.
 *         No duplicate DB query logic — pulls directly from opportunities table.
 */
import { db } from "../db";
import { sql } from "drizzle-orm";

// ── Stage probability weights (same as report-composer.ts + pipeline route) ──
export const STAGE_PROB: Record<string, number> = {
  inbound_new: 0.10,
  qualifying: 0.20,
  discovery: 0.30,
  proposal: 0.40,
  negotiation: 0.65,
  verbal_commit: 0.85,
  closed_won: 1.00,
};

// ── Parameter types ────────────────────────────────────────────────────────────

export type ForecastCategoryFilter = "all" | "commit" | "commit_best_case";

export type SimParams = {
  winRateMultiplier?: number;       // 0.5–2.0, scales stage probabilities (default 1.0)
  dealSizeMultiplier?: number;      // 0.5–2.0, scales opportunity amounts (default 1.0)
  velocityWeeks?: number;           // -8 to +8, shifts est_close_date (default 0)
  newPipelineDeals?: number;        // 0–50 synthetic new deals added (default 0)
  newPipelineAvgSize?: number;      // override avg deal size for synthetic deals (default: live avg)
  forecastCategory?: ForecastCategoryFilter; // filter which opps to include (default "all")
  churnRateMonthly?: number;        // 0–0.10, monthly ARR reduction (default 0)
  expansionRateMonthly?: number;    // 0–0.10, monthly expansion revenue (default 0)
  months?: number;                  // projection horizon (default 12)
};

export type MonthProjection = {
  month: string;          // "2024-06"
  label: string;          // "Jun 2024"
  baseline: number;       // baseline weighted revenue
  simulated: number;      // scenario weighted revenue
  delta: number;          // simulated - baseline
  deltaPct: number;       // % change vs baseline
  dealCount: number;      // # deals in this period (simulated)
};

export type SimSummary = {
  totalBaseline: number;
  totalSimulated: number;
  totalDelta: number;
  deltaPct: number;
  peakMonth: string;       // label of highest simulated month
  peakAmount: number;
  dealsIncluded: number;   // # open opps used in simulation
  avgDealSize: number;     // live avg deal size of included opps
  paramsApplied: SimParams;
};

export type SimResult = {
  months: MonthProjection[];
  summary: SimSummary;
};

// ── Internal raw opportunity type ─────────────────────────────────────────────

type RawOpp = {
  id: number;
  stage: string;
  amount: number;
  forecast_cat: string;
  close_date: Date;
};

// ── Load live open opportunities ──────────────────────────────────────────────

async function loadOpenOpps(months: number): Promise<RawOpp[]> {
  const until = new Date(Date.now() + months * 31 * 86400000);
  const rows = await db.execute(sql.raw(`
    SELECT o.id, o.stage, COALESCE(o.amount, 0) AS amount,
           COALESCE(o.forecast_category, 'pipeline') AS forecast_cat,
           COALESCE(o.est_close_date, NOW() + INTERVAL '30 days') AS close_date
    FROM opportunities o
    WHERE o.stage NOT IN ('closed_lost')
      AND COALESCE(o.est_close_date, NOW() + INTERVAL '30 days') <= '${until.toISOString()}'
    ORDER BY close_date
  `));
  return (rows.rows as any[]).map(r => ({
    id: r.id,
    stage: r.stage,
    amount: parseFloat(r.amount) || 0,
    forecast_cat: r.forecast_cat,
    close_date: new Date(r.close_date),
  }));
}

// ── Build a period map skeleton (N months starting from now) ──────────────────

function buildPeriodMap(months: number): Map<string, MonthProjection> {
  const map = new Map<string, MonthProjection>();
  const now = new Date();
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    map.set(mKey, { month: mKey, label, baseline: 0, simulated: 0, delta: 0, deltaPct: 0, dealCount: 0 });
  }
  return map;
}

// ── Accumulate one opportunity into a period map ──────────────────────────────

function accumOpp(
  map: Map<string, MonthProjection>,
  opp: RawOpp,
  prob: number,
  amount: number,
  field: "baseline" | "simulated",
  closeDate?: Date,
): void {
  const d = closeDate ?? opp.close_date;
  const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  if (!map.has(mKey)) return; // outside projection window
  const p = map.get(mKey)!;
  const weighted = amount * Math.min(prob, 1.0);
  p[field] += weighted;
  if (field === "simulated") p.dealCount++;
}

// ── Filter check ──────────────────────────────────────────────────────────────

function passesFilter(opp: RawOpp, filter: ForecastCategoryFilter): boolean {
  if (filter === "all") return true;
  if (filter === "commit") return opp.forecast_cat === "commit";
  if (filter === "commit_best_case") return opp.forecast_cat === "commit" || opp.forecast_cat === "best_case";
  return true;
}

// ── Public: get baseline projection ──────────────────────────────────────────

export async function getBaseline(months = 12): Promise<SimResult> {
  const opps = await loadOpenOpps(months);
  const map = buildPeriodMap(months);

  for (const opp of opps) {
    const prob = STAGE_PROB[opp.stage] ?? 0.20;
    accumOpp(map, opp, prob, opp.amount, "baseline");
    accumOpp(map, opp, prob, opp.amount, "simulated");
  }

  const periods = [...map.values()];
  periods.forEach(p => {
    p.delta = 0;
    p.deltaPct = 0;
  });

  const totalBaseline = periods.reduce((s, p) => s + p.baseline, 0);
  const peak = periods.reduce((a, b) => b.simulated > a.simulated ? b : a, periods[0] ?? { label: "—", simulated: 0 });
  const avgDealSize = opps.length > 0 ? opps.reduce((s, o) => s + o.amount, 0) / opps.length : 0;

  return {
    months: periods,
    summary: {
      totalBaseline,
      totalSimulated: totalBaseline,
      totalDelta: 0,
      deltaPct: 0,
      peakMonth: peak?.label ?? "—",
      peakAmount: peak?.simulated ?? 0,
      dealsIncluded: opps.length,
      avgDealSize: Math.round(avgDealSize),
      paramsApplied: {},
    },
  };
}

// ── Public: run simulation ────────────────────────────────────────────────────

export async function runSimulation(params: SimParams): Promise<SimResult> {
  const horizonMonths = Math.max(1, Math.min(24, params.months ?? 12));
  const winMult   = clamp(params.winRateMultiplier ?? 1.0, 0.1, 3.0);
  const sizeMult  = clamp(params.dealSizeMultiplier ?? 1.0, 0.1, 3.0);
  const velWeeks  = clamp(params.velocityWeeks ?? 0, -26, 26);
  const newDeals  = Math.max(0, Math.round(params.newPipelineDeals ?? 0));
  const catFilter = params.forecastCategory ?? "all";
  const churnRate = clamp(params.churnRateMonthly ?? 0, 0, 0.5);
  const expansionRate = clamp(params.expansionRateMonthly ?? 0, 0, 0.5);

  const allOpps = await loadOpenOpps(horizonMonths);
  const map = buildPeriodMap(horizonMonths);

  // ── Baseline pass (unmodified) ──
  for (const opp of allOpps) {
    const prob = STAGE_PROB[opp.stage] ?? 0.20;
    accumOpp(map, opp, prob, opp.amount, "baseline");
  }

  // ── Simulated pass (apply multipliers + filter) ──
  const includedOpps = allOpps.filter(o => passesFilter(o, catFilter));

  const avgDealSize = includedOpps.length > 0
    ? includedOpps.reduce((s, o) => s + o.amount, 0) / includedOpps.length
    : 10000;
  const syntheticAvg = params.newPipelineAvgSize ?? avgDealSize;

  for (const opp of includedOpps) {
    const rawProb = STAGE_PROB[opp.stage] ?? 0.20;
    const prob = opp.stage === "closed_won" ? 1.0 : rawProb * winMult; // don't scale closed_won
    const amount = opp.amount * sizeMult;
    // Shift close date by velocity
    const shiftedDate = new Date(opp.close_date.getTime() + velWeeks * 7 * 86400000);
    accumOpp(map, opp, prob, amount, "simulated", shiftedDate);
  }

  // ── Synthetic new pipeline deals (spread evenly across projection window) ──
  if (newDeals > 0) {
    const periods = [...map.keys()];
    const dealsPerMonth = newDeals / horizonMonths;
    for (const mKey of periods) {
      const [y, m] = mKey.split("-").map(Number);
      const syntheticDate = new Date(y, m - 1, 15); // mid-month
      const p = map.get(mKey)!;
      // Synthetic deals at discovery-level probability (30%) × win multiplier
      const prob = 0.30 * winMult;
      p.simulated += dealsPerMonth * syntheticAvg * prob;
      p.dealCount += Math.ceil(dealsPerMonth);
    }
  }

  // ── Apply churn and expansion as adjustments to each month ──
  let cumulativeChurn = 0;
  let cumulativeExpansion = 0;
  const periods = [...map.values()];
  for (const p of periods) {
    cumulativeChurn += p.simulated * churnRate;
    cumulativeExpansion += p.simulated * expansionRate;
    p.simulated = Math.max(0, p.simulated - cumulativeChurn + cumulativeExpansion);
  }

  // ── Compute deltas ──
  for (const p of periods) {
    p.delta = p.simulated - p.baseline;
    p.deltaPct = p.baseline > 0 ? Math.round((p.delta / p.baseline) * 1000) / 10 : 0;
  }

  const totalBaseline  = periods.reduce((s, p) => s + p.baseline, 0);
  const totalSimulated = periods.reduce((s, p) => s + p.simulated, 0);
  const totalDelta     = totalSimulated - totalBaseline;
  const peak = periods.reduce((a, b) => b.simulated > a.simulated ? b : a, periods[0] ?? { label: "—", simulated: 0 });

  return {
    months: periods,
    summary: {
      totalBaseline: Math.round(totalBaseline),
      totalSimulated: Math.round(totalSimulated),
      totalDelta: Math.round(totalDelta),
      deltaPct: totalBaseline > 0 ? Math.round((totalDelta / totalBaseline) * 1000) / 10 : 0,
      peakMonth: peak?.label ?? "—",
      peakAmount: Math.round(peak?.simulated ?? 0),
      dealsIncluded: includedOpps.length,
      avgDealSize: Math.round(avgDealSize),
      paramsApplied: params,
    },
  };
}

// ── Utility ───────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
