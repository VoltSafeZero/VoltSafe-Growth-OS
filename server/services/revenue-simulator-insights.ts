/**
 * Revenue Simulator Insights Service (v2)
 * Provides CRM-derived baseline inference, action recommendations,
 * forecast vs actuals variance, and board pack scenario selection.
 *
 * REUSES: same DB/opportunity query patterns as report-composer.ts
 *         All SQL uses established db.execute(sql.raw/tagged) patterns.
 */
import { db } from "../db";
import { sql } from "drizzle-orm";
import type { SimResult, SimParams } from "./revenue-simulator";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CRMBaseline = {
  avgDealSize: number;
  winRate: number;          // 0–1
  avgSalesCycleDays: number;
  openDealCount: number;
  openPipelineValue: number;
  wonLast180: number;
  lostLast180: number;
  stageDistribution: Record<string, number>; // stage → count
  impliedParams: SimParams; // suggested param overrides vs 1.0 identity
  dataCoverage: "full" | "partial" | "sparse"; // how much real data backed this
  notes: string[];
};

export type RecommendedAction = {
  title: string;
  rationale: string;
  priority: "high" | "medium" | "low";
  linkedObjectType?: string;
};

export type ForecastActualRow = {
  month_key: string;
  forecast_amount: number;
  actual_amount: number;
  variance_amount: number;
  variance_pct: number;
  forecasted_from_scenario_id: number | null;
};

export type ForecastVsActuals = {
  rows: ForecastActualRow[];
  totalForecast: number;
  totalActual: number;
  totalVariance: number;
  variancePct: number;
  hasSufficientData: boolean;
};

export type BoardPackScenario = {
  id: number;
  name: string;
  description: string | null;
  parameters: SimParams;
  projection: SimResult;
  totalSimulated: number;
  deltaPct: number;
  isPinned: boolean;
  boardPackInclude: boolean;
  sourceType: string;
  topAssumptions: string[];
} | null;

// ── deriveScenarioFromCRM ──────────────────────────────────────────────────────

export async function deriveScenarioFromCRM(): Promise<CRMBaseline> {
  const notes: string[] = [];

  // ── Won / Lost deals in last 180 days ──
  const winLossRow = await db.execute(sql.raw(`
    SELECT
      COUNT(*) FILTER (WHERE stage = 'closed_won'
        AND updated_at >= NOW() - INTERVAL '180 days') AS won_count,
      COUNT(*) FILTER (WHERE stage = 'closed_lost'
        AND updated_at >= NOW() - INTERVAL '180 days') AS lost_count,
      COALESCE(AVG(amount) FILTER (WHERE stage = 'closed_won'
        AND updated_at >= NOW() - INTERVAL '180 days'), 0) AS avg_won_size,
      COALESCE(AVG(amount) FILTER (WHERE stage NOT IN ('closed_won','closed_lost')
        AND amount > 0), 0) AS avg_open_size,
      COUNT(*) FILTER (WHERE stage NOT IN ('closed_won','closed_lost')) AS open_count,
      COALESCE(SUM(amount) FILTER (WHERE stage NOT IN ('closed_won','closed_lost')), 0) AS open_pipeline
    FROM opportunities
  `));
  const wl = winLossRow.rows[0] as any;
  const wonCount = parseInt(wl.won_count) || 0;
  const lostCount = parseInt(wl.lost_count) || 0;
  const avgWonSize = parseFloat(wl.avg_won_size) || 0;
  const avgOpenSize = parseFloat(wl.avg_open_size) || 0;
  const openCount = parseInt(wl.open_count) || 0;
  const openPipeline = parseFloat(wl.open_pipeline) || 0;

  // Win rate (require at least 3 closed deals for statistical significance)
  const totalClosed = wonCount + lostCount;
  const winRate = totalClosed >= 3 ? wonCount / totalClosed : null;

  // Avg deal size: prefer won size, fall back to open, then default
  const avgDealSize = avgWonSize > 0 ? avgWonSize : (avgOpenSize > 0 ? avgOpenSize : 25000);

  // ── Average sales cycle from created_at to close for won deals ──
  const cycleRow = await db.execute(sql.raw(`
    SELECT COALESCE(
      AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400)
      FILTER (WHERE stage = 'closed_won' AND amount > 0 AND updated_at >= NOW() - INTERVAL '365 days'),
      60
    ) AS avg_cycle_days
    FROM opportunities
  `));
  const avgCycleDays = Math.round(parseFloat((cycleRow.rows[0] as any).avg_cycle_days) || 60);

  // ── Stage distribution of open pipeline ──
  const stageRows = await db.execute(sql.raw(`
    SELECT stage, COUNT(*) AS cnt
    FROM opportunities
    WHERE stage NOT IN ('closed_won','closed_lost')
    GROUP BY stage
    ORDER BY cnt DESC
  `));
  const stageDistribution: Record<string, number> = {};
  for (const r of stageRows.rows as any[]) {
    stageDistribution[r.stage] = parseInt(r.cnt) || 0;
  }

  // ── Determine data coverage ──
  let dataCoverage: "full" | "partial" | "sparse" = "sparse";
  if (totalClosed >= 10 && openCount >= 5) dataCoverage = "full";
  else if (totalClosed >= 3 || openCount >= 3) dataCoverage = "partial";

  // ── Infer implied parameter adjustments vs 1.0 identity ──
  const impliedParams: SimParams = {};

  // Win rate multiplier: if CRM win rate differs meaningfully from a generic 40% target
  if (winRate !== null) {
    const BENCHMARK_WIN_RATE = 0.40;
    const winRateMult = Math.round((winRate / BENCHMARK_WIN_RATE) * 100) / 100;
    impliedParams.winRateMultiplier = Math.max(0.1, Math.min(3.0, winRateMult));
    notes.push(`Win rate: ${Math.round(winRate * 100)}% over last 180 days (${wonCount} won, ${lostCount} lost)`);
  } else {
    notes.push(`Insufficient closed deals (${totalClosed}) for win rate — using 1.0× default`);
  }

  // Avg deal size: set newPipelineAvgSize to the CRM-derived size
  impliedParams.newPipelineAvgSize = Math.round(avgDealSize);
  notes.push(`Avg deal size: $${Math.round(avgDealSize).toLocaleString()} (from ${avgWonSize > 0 ? "won deals" : "open pipeline"})`);

  // Sales cycle: convert days to velocity weeks offset (assume 60-day baseline)
  const velocityOffset = Math.round((60 - avgCycleDays) / 7); // positive = faster
  impliedParams.velocityWeeks = Math.max(-12, Math.min(12, velocityOffset));
  notes.push(`Avg sales cycle: ~${avgCycleDays} days → velocity offset ${impliedParams.velocityWeeks > 0 ? "+" : ""}${impliedParams.velocityWeeks} weeks`);

  if (dataCoverage === "sparse") {
    notes.push("⚠ Limited historical data — CRM suggestions are estimates. Add more closed deals for accuracy.");
  }

  return {
    avgDealSize: Math.round(avgDealSize),
    winRate: winRate ?? 0,
    avgSalesCycleDays: avgCycleDays,
    openDealCount: openCount,
    openPipelineValue: Math.round(openPipeline),
    wonLast180: wonCount,
    lostLast180: lostCount,
    stageDistribution,
    impliedParams,
    dataCoverage,
    notes,
  };
}

// ── generateScenarioActions ───────────────────────────────────────────────────

export function generateScenarioActions(result: SimResult, crmBaseline?: CRMBaseline): RecommendedAction[] {
  const actions: RecommendedAction[] = [];
  const s = result.summary;
  const params = s.paramsApplied ?? {};

  // Action 1: If total is below baseline, address win rate
  if (s.totalDelta < 0) {
    actions.push({
      title: `Increase qualified pipeline to offset projected shortfall of ${fmtDelta(s.totalDelta)}`,
      rationale: `The scenario projects ${Math.abs(s.deltaPct).toFixed(1)}% below baseline. Adding top-of-funnel volume is the fastest lever.`,
      priority: "high",
      linkedObjectType: "lead",
    });
  }

  // Action 2: Win rate lever
  if ((params.winRateMultiplier ?? 1.0) < 0.9) {
    actions.push({
      title: "Review and coach proposal-to-close process — win rate is below target",
      rationale: `Win rate multiplier is set to ${(params.winRateMultiplier! * 100).toFixed(0)}%. Focus on demo quality and objection handling to recover rate.`,
      priority: "high",
      linkedObjectType: "opportunity",
    });
  } else if ((params.winRateMultiplier ?? 1.0) > 1.2) {
    actions.push({
      title: "Capture and document what's driving the higher win rate for repeatability",
      rationale: "Win rate is above baseline — identify the patterns (rep behaviour, segment, message) and systemise them.",
      priority: "medium",
      linkedObjectType: "opportunity",
    });
  }

  // Action 3: Deal size lever
  if ((params.dealSizeMultiplier ?? 1.0) < 0.85) {
    actions.push({
      title: "Audit deal pricing and bundling — average deal size is compressed",
      rationale: `Deal size is at ${(params.dealSizeMultiplier! * 100).toFixed(0)}% of baseline. Review quoting process and upsell opportunities.`,
      priority: "high",
      linkedObjectType: "opportunity",
    });
  }

  // Action 4: Velocity lever
  if ((params.velocityWeeks ?? 0) > 3) {
    actions.push({
      title: "Identify and resolve deal blockers slowing the pipeline by more than 3 weeks",
      rationale: `Deals are projected to close ${params.velocityWeeks} weeks later than baseline. Target proposals stuck in approval or technical validation.`,
      priority: "medium",
      linkedObjectType: "opportunity",
    });
  } else if ((params.velocityWeeks ?? 0) < -3) {
    actions.push({
      title: "Lock in accelerated deal timelines with clear next steps and deadlines",
      rationale: `Pipeline velocity is ${Math.abs(params.velocityWeeks!)} weeks ahead — protect momentum with committed milestones.`,
      priority: "low",
    });
  }

  // Action 5: New pipeline deals
  if ((params.newPipelineDeals ?? 0) > 0) {
    actions.push({
      title: `Generate ${params.newPipelineDeals} new qualified opportunities to match scenario assumptions`,
      rationale: "The scenario relies on net-new pipeline creation. Assign SDR targets and activate outbound sequences.",
      priority: "high",
      linkedObjectType: "lead",
    });
  }

  // Action 6: Churn risk
  if ((params.churnRateMonthly ?? 0) > 0.03) {
    actions.push({
      title: "Launch proactive customer success check-ins to reduce churn risk",
      rationale: `Monthly churn of ${((params.churnRateMonthly ?? 0) * 100).toFixed(1)}% will compound over the projection. Target at-risk accounts first.`,
      priority: "high",
      linkedObjectType: "account",
    });
  }

  // Action 7: Expansion opportunity
  if ((params.expansionRateMonthly ?? 0) > 0.02) {
    actions.push({
      title: "Activate expansion playbook for existing accounts to support projected growth",
      rationale: `${((params.expansionRateMonthly ?? 0) * 100).toFixed(1)}%/month expansion is assumed — identify high-NPS accounts to upsell first.`,
      priority: "medium",
      linkedObjectType: "account",
    });
  }

  // Action 8 (CRM-informed): if win rate from CRM is low
  if (crmBaseline && crmBaseline.winRate > 0 && crmBaseline.winRate < 0.25 && crmBaseline.wonLast180 >= 3) {
    actions.push({
      title: "Improve discovery and qualification — CRM win rate is below 25%",
      rationale: `Only ${Math.round(crmBaseline.winRate * 100)}% of deals are closing over the last 6 months. Strengthen ICP targeting and qualification framework.`,
      priority: "high",
      linkedObjectType: "lead",
    });
  }

  // Ensure at least 3 actions
  if (actions.length === 0) {
    actions.push({
      title: "Monitor and maintain pipeline health — scenario is close to baseline",
      rationale: "Current settings project near-baseline performance. Focus on maintaining deal quality and velocity.",
      priority: "low",
    });
  }

  if (actions.length === 1) {
    actions.push({
      title: "Run a pipeline review to validate deal close dates are accurate",
      rationale: "Accurate close dates are critical for forecast reliability. Review deals in proposal+ stages.",
      priority: "medium",
      linkedObjectType: "opportunity",
    });
    actions.push({
      title: "Schedule monthly forecast review against actuals as scenarios mature",
      rationale: "Track variance between simulated and actual revenue to continuously improve assumptions.",
      priority: "low",
    });
  }

  // Cap at 7
  return actions.slice(0, 7);
}

// ── computeForecastVsActuals ─────────────────────────────────────────────────

export async function computeForecastVsActuals(): Promise<ForecastVsActuals> {
  const rows = await db.execute(sql.raw(`
    SELECT month_key, 
           CAST(forecast_amount AS float) AS forecast_amount, 
           CAST(actual_amount AS float) AS actual_amount, 
           forecasted_from_scenario_id
    FROM revenue_forecast_actuals
    ORDER BY month_key ASC
    LIMIT 36
  `));

  const result: ForecastActualRow[] = (rows.rows as any[]).map(r => {
    const forecast = parseFloat(r.forecast_amount) || 0;
    const actual = parseFloat(r.actual_amount) || 0;
    const variance = actual - forecast;
    const variancePct = forecast > 0 ? Math.round((variance / forecast) * 1000) / 10 : 0;
    return {
      month_key: r.month_key,
      forecast_amount: Math.round(forecast),
      actual_amount: Math.round(actual),
      variance_amount: Math.round(variance),
      variance_pct: variancePct,
      forecasted_from_scenario_id: r.forecasted_from_scenario_id ?? null,
    };
  });

  const totalForecast = result.reduce((s, r) => s + r.forecast_amount, 0);
  const totalActual = result.reduce((s, r) => s + r.actual_amount, 0);
  const totalVariance = totalActual - totalForecast;
  const variancePct = totalForecast > 0 ? Math.round((totalVariance / totalForecast) * 1000) / 10 : 0;

  return {
    rows: result,
    totalForecast,
    totalActual,
    totalVariance,
    variancePct,
    hasSufficientData: result.length >= 2,
  };
}

// ── chooseBoardPackScenario ────────────────────────────────────────────────────

export async function chooseBoardPackScenario(): Promise<BoardPackScenario> {
  // Prefer: pinned first, then board_pack_include, then most recent
  const row = await db.execute(sql.raw(`
    SELECT id, name, description, parameters, projection, 
           is_pinned, board_pack_include, source_type
    FROM revenue_scenarios
    WHERE is_pinned = true OR board_pack_include = true
    ORDER BY is_pinned DESC, board_pack_include DESC, updated_at DESC
    LIMIT 1
  `));

  if (!row.rows.length) return null;
  const r = row.rows[0] as any;
  const projection = r.projection as SimResult;
  const parameters = r.parameters as SimParams;
  const summary = projection?.summary ?? {};

  // Build top 3 human-readable assumption lines
  const topAssumptions = buildAssumptionLines(parameters).slice(0, 3);

  return {
    id: r.id,
    name: r.name,
    description: r.description,
    parameters,
    projection,
    totalSimulated: Math.round(summary.totalSimulated ?? 0),
    deltaPct: summary.deltaPct ?? 0,
    isPinned: r.is_pinned,
    boardPackInclude: r.board_pack_include,
    sourceType: r.source_type,
    topAssumptions,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function fmtDelta(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(abs / 1_000).toFixed(0)}K`;
  return `$${Math.round(abs).toLocaleString()}`;
}

function buildAssumptionLines(params: SimParams): string[] {
  const lines: string[] = [];
  if (params.winRateMultiplier != null && params.winRateMultiplier !== 1.0) {
    lines.push(`Win rate ${params.winRateMultiplier > 1 ? "+" : ""}${Math.round((params.winRateMultiplier - 1) * 100)}% vs baseline`);
  }
  if (params.dealSizeMultiplier != null && params.dealSizeMultiplier !== 1.0) {
    lines.push(`Deal size ${params.dealSizeMultiplier > 1 ? "+" : ""}${Math.round((params.dealSizeMultiplier - 1) * 100)}% vs baseline`);
  }
  if (params.velocityWeeks != null && params.velocityWeeks !== 0) {
    lines.push(`Close dates shifted ${params.velocityWeeks > 0 ? "+" : ""}${params.velocityWeeks} weeks`);
  }
  if (params.newPipelineDeals != null && params.newPipelineDeals > 0) {
    lines.push(`+${params.newPipelineDeals} new pipeline deals assumed`);
  }
  if (params.churnRateMonthly != null && params.churnRateMonthly > 0) {
    lines.push(`${(params.churnRateMonthly * 100).toFixed(1)}%/mo churn applied`);
  }
  if (params.expansionRateMonthly != null && params.expansionRateMonthly > 0) {
    lines.push(`${(params.expansionRateMonthly * 100).toFixed(1)}%/mo expansion uplift`);
  }
  if (params.forecastCategory && params.forecastCategory !== "all") {
    lines.push(`Filtered to ${params.forecastCategory === "commit" ? "commit only" : "commit + best case"} deals`);
  }
  if (lines.length === 0) lines.push("Identity scenario — no parameter changes vs baseline");
  return lines;
}
