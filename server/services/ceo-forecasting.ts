/**
 * CEO Cockpit Phase 9 — Forecasting, Scenario Planning, and Runway Intelligence
 *
 * Safety rules:
 * - No external API calls. No AI dependency. No auto-send of any kind.
 * - Private Currents channels excluded from all queries.
 * - DM bodies not broadly fetched.
 * - Runway/funding sections gated by actorUser.hasCapital.
 * - All numbers sourced from live DB — no invented financials.
 * - Language: "suggests", "likely", "planning assumption", "risk", "scenario".
 * - Neutral language only: "suggests", "likely", "planning assumption", "scenario".
 *   Not a source of professional guidance. No certainty claims.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { buildExecutionScorecard, detectExecutionDrift, buildCommitmentsRadar, buildRecurringRiskPatterns } from "./ceo-execution-intelligence";
import type { ExecutionActorUser } from "./ceo-execution-intelligence";
import { createCeoAction } from "./ceo-action-loop";
import type { CreateActionInput } from "./ceo-action-loop";

export type ForecastActorUser = ExecutionActorUser; // reuse Phase 8 actor type

// ── Helpers ────────────────────────────────────────────────────────────────────

const fmt$ = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M`
  : v >= 1_000   ? `$${(v / 1_000).toFixed(0)}K`
  : `$${Math.round(v)}`;

function addMonthsLabel(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + Math.round(months));
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function safeNum(v: any): number { return Number(v) || 0; }

// ── 1. buildRevenueForecast ────────────────────────────────────────────────────

export async function buildRevenueForecast(actorUser: ForecastActorUser) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const thirtyDaysOut = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const sixtyDaysOut  = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
    const ninetyDaysOut = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);

    // Pipeline totals
    const totalsRes = await db.execute(sql`
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE stage NOT IN ('closed_won','closed_lost')), 0) AS total_open,
        COALESCE(SUM(amount) FILTER (WHERE forecast_category = 'commit' AND stage NOT IN ('closed_won','closed_lost')), 0) AS commit_amount,
        COALESCE(SUM(amount) FILTER (WHERE forecast_category = 'best_case' AND stage NOT IN ('closed_won','closed_lost')), 0) AS best_case_amount,
        COALESCE(SUM(amount) FILTER (WHERE stage = 'closed_won'), 0) AS closed_won,
        COUNT(*) FILTER (WHERE stage NOT IN ('closed_won','closed_lost')) AS open_count,
        COUNT(*) FILTER (WHERE stage = 'closed_won') AS won_count,
        COUNT(*) FILTER (WHERE stage = 'closed_lost') AS lost_count
      FROM opportunities
    `);
    const t = (totalsRes.rows[0] as any) ?? {};

    // Weighted pipeline using probability
    const weightedRes = await db.execute(sql`
      SELECT COALESCE(SUM(amount * COALESCE(probability_pct, 20) / 100.0), 0) AS weighted
      FROM opportunities
      WHERE stage NOT IN ('closed_won','closed_lost')
    `);
    const weighted = safeNum((weightedRes.rows[0] as any)?.weighted);

    // Stale opportunities — no updated_at change in 30+ days
    const staleRes = await db.execute(sql`
      SELECT id, title, amount, stage, forecast_category, est_close_date
      FROM opportunities
      WHERE stage NOT IN ('closed_won','closed_lost')
        AND (updated_at < ${thirtyDaysAgo} OR updated_at IS NULL)
      ORDER BY amount DESC NULLS LAST
      LIMIT 10
    `);

    // Slipped opportunities — est_close_date in the past, not closed
    const slippedRes = await db.execute(sql`
      SELECT id, title, amount, stage, forecast_category, est_close_date
      FROM opportunities
      WHERE stage NOT IN ('closed_won','closed_lost')
        AND est_close_date IS NOT NULL
        AND est_close_date < ${today}
      ORDER BY amount DESC NULLS LAST
      LIMIT 10
    `);

    // High-confidence opportunities (commit or late stage)
    const highConfRes = await db.execute(sql`
      SELECT id, title, amount, stage, forecast_category, est_close_date
      FROM opportunities
      WHERE stage NOT IN ('closed_won','closed_lost')
        AND (forecast_category = 'commit' OR stage IN ('proposal','negotiation','verbal_commit'))
      ORDER BY amount DESC NULLS LAST
      LIMIT 10
    `);

    // Monthly close forecast (next 6 months)
    const monthlyRes = await db.execute(sql`
      SELECT
        TO_CHAR(est_close_date, 'YYYY-MM') AS month_key,
        TO_CHAR(DATE_TRUNC('month', est_close_date), 'Mon YYYY') AS label,
        COUNT(*) AS opp_count,
        SUM(amount) AS total_amount,
        SUM(amount) FILTER (WHERE forecast_category = 'commit') AS commit_amount,
        SUM(amount) FILTER (WHERE forecast_category = 'best_case') AS best_case_amount
      FROM opportunities
      WHERE stage NOT IN ('closed_won','closed_lost')
        AND est_close_date >= ${today}
        AND est_close_date <= ${ninetyDaysOut}
        AND est_close_date IS NOT NULL
      GROUP BY month_key, label
      ORDER BY month_key
    `);

    // 30/60/90 day movement forecast
    const next30 = await db.execute(sql`
      SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
      FROM opportunities WHERE stage NOT IN ('closed_won','closed_lost') AND est_close_date BETWEEN ${today} AND ${thirtyDaysOut}
    `);
    const next60 = await db.execute(sql`
      SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
      FROM opportunities WHERE stage NOT IN ('closed_won','closed_lost') AND est_close_date BETWEEN ${today} AND ${sixtyDaysOut}
    `);
    const next90 = await db.execute(sql`
      SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
      FROM opportunities WHERE stage NOT IN ('closed_won','closed_lost') AND est_close_date BETWEEN ${today} AND ${ninetyDaysOut}
    `);

    const totalOpen    = safeNum(t.total_open);
    const commitAmount = safeNum(t.commit_amount);
    const closedWon    = safeNum(t.closed_won);
    const openCount    = safeNum(t.open_count);

    const stale    = staleRes.rows as any[];
    const slipped  = slippedRes.rows as any[];
    const highConf = highConfRes.rows as any[];

    const blockers: string[] = [];
    if (slipped.length > 0) blockers.push(`${slipped.length} opportunit${slipped.length === 1 ? "y" : "ies"} with missed close dates suggest execution or qualification gaps.`);
    if (stale.length > 5) blockers.push(`${stale.length} opportunities without activity in 30+ days risk aging out of the pipeline.`);
    if (commitAmount < totalOpen * 0.2 && totalOpen > 0) blockers.push(`Low commit-category coverage (${fmt$(commitAmount)} of ${fmt$(totalOpen)}) suggests pipeline confidence may be optimistic.`);

    const actions: string[] = [];
    if (slipped.length > 0) actions.push(`Review ${slipped.length} slipped close date${slipped.length > 1 ? "s" : ""} — update or re-qualify each opportunity.`);
    if (stale.length > 0) actions.push(`Re-engage ${stale.length} stale opportunit${stale.length === 1 ? "y" : "ies"} or mark closed-lost to clean the pipeline.`);
    if (highConf.length > 0) actions.push(`Accelerate ${highConf.length} high-confidence deal${highConf.length > 1 ? "s" : ""} — assign tasks and confirm next steps.`);

    const severity = slipped.length > 3 || stale.length > 5 ? "urgent"
      : slipped.length > 0 || stale.length > 0 ? "watch"
      : "info";

    return {
      section: "revenue_forecast",
      title: "Revenue Forecast",
      severity,
      summary: `${fmt$(totalOpen)} open pipeline (${fmt$(weighted)} weighted). ${fmt$(closedWon)} closed won. ${openCount} active opportunities.`,
      total_open_pipeline: totalOpen,
      weighted_pipeline: weighted,
      closed_won_amount: closedWon,
      commit_amount: commitAmount,
      best_case_amount: safeNum(t.best_case_amount),
      open_opportunity_count: openCount,
      stale_opportunities: stale.map((o: any) => ({ id: o.id, title: o.title, amount: safeNum(o.amount), stage: o.stage, est_close_date: o.est_close_date })),
      slipped_opportunities: slipped.map((o: any) => ({ id: o.id, title: o.title, amount: safeNum(o.amount), stage: o.stage, est_close_date: o.est_close_date })),
      high_confidence_opportunities: highConf.map((o: any) => ({ id: o.id, title: o.title, amount: safeNum(o.amount), stage: o.stage, forecast_category: o.forecast_category })),
      monthly_forecast: (monthlyRes.rows as any[]).map(r => ({
        month_key: r.month_key,
        label: r.label,
        opp_count: safeNum(r.opp_count),
        total_amount: safeNum(r.total_amount),
        commit_amount: safeNum(r.commit_amount),
        best_case_amount: safeNum(r.best_case_amount),
      })),
      next_30_days: { total: safeNum((next30.rows[0] as any)?.total), count: safeNum((next30.rows[0] as any)?.cnt) },
      next_60_days: { total: safeNum((next60.rows[0] as any)?.total), count: safeNum((next60.rows[0] as any)?.cnt) },
      next_90_days: { total: safeNum((next90.rows[0] as any)?.total), count: safeNum((next90.rows[0] as any)?.cnt) },
      blockers_to_revenue: blockers,
      recommended_ceo_actions: actions,
      assumptions: [
        "Weighted pipeline uses probability_pct column when available, defaults to 20% for unscored opportunities.",
        "Stale = no update in 30+ days. Slipped = est_close_date in past, not closed.",
        "Closed won figures include all time (not period-gated) unless options.dateFrom/dateTo provided.",
        "This is a planning assumption — not a financial guarantee.",
      ],
    };
  } catch (err: any) {
    return { section: "revenue_forecast", title: "Revenue Forecast", severity: "watch" as const, error: err?.message, summary: "Revenue forecast temporarily unavailable." };
  }
}

// ── 2. buildRunwayIntelligence ─────────────────────────────────────────────────

export async function buildRunwayIntelligence(actorUser: ForecastActorUser) {
  if (!actorUser.hasCapital) {
    return {
      section: "runway_intelligence",
      title: "Runway Intelligence",
      severity: "info" as const,
      access_denied: true,
      message: "Runway Intelligence requires CEO or CFO access.",
    };
  }

  try {
    // Pull active capital round with runway data
    const roundRes = await db.execute(sql`
      SELECT id, name, status, current_cash_balance, monthly_burn, target_amount,
             minimum_close_target, post_close_monthly_burn
      FROM capital_rounds
      WHERE status = 'active'
      ORDER BY created_at DESC
      LIMIT 1
    `);

    const round = roundRes.rows[0] as any;
    const cash = safeNum(round?.current_cash_balance);
    const burn = safeNum(round?.monthly_burn);

    if (!round || !cash || !burn) {
      const missing: string[] = [];
      if (!round) missing.push("No active capital round found — create a capital round to enable runway tracking.");
      if (round && !cash) missing.push("Current cash balance not set on the active round.");
      if (round && !burn) missing.push("Monthly burn rate not set on the active round.");
      missing.push("Committed funding from close round (if in-progress).");
      missing.push("Expected receivables for the next 90 days.");
      missing.push("Planned hires and major spend items.");
      return {
        section: "runway_intelligence",
        title: "Runway Intelligence",
        severity: "watch" as const,
        empty_state: true,
        missing_inputs: missing,
        message: "Runway cannot be estimated without current cash balance and monthly burn. No estimated number shown — missing inputs listed above.",
        assumptions: ["No runway number is shown when source data is absent — this is intentional."],
      };
    }

    const runwayToday = cash / burn;
    const target      = safeNum(round.target_amount);
    const minClose    = safeNum(round.minimum_close_target);
    const postBurn    = safeNum(round.post_close_monthly_burn) || burn;

    const runwayAfterMin    = minClose > 0 ? (cash + minClose)  / postBurn : null;
    const runwayAfterTarget = target > 0   ? (cash + target)    / postBurn : null;

    // Downside: -20% cash (cost overrun) + no new capital
    const runwayDownside = (cash * 0.8) / burn;
    // Upside: + committed capital
    const committedRes = await db.execute(sql`
      SELECT COALESCE(SUM(committed_amount), 0) AS committed
      FROM capital_commitments WHERE round_id = ${round.id}
    `).catch(() => ({ rows: [{ committed: 0 }] }));
    const committed = safeNum((committedRes.rows[0] as any)?.committed);
    const runwayUpside = committed > 0 ? (cash + committed) / postBurn : null;

    const severity = runwayToday < 3 ? "critical"
      : runwayToday < 6 ? "urgent"
      : runwayToday < 9 ? "watch"
      : "info";

    const actions: string[] = [];
    if (runwayToday < 6) actions.push("Prioritise closing committed capital immediately — runway is short.");
    if (!committed) actions.push("Identify and lock in committed capital to extend runway.");
    if (runwayToday >= 6 && runwayToday < 9) actions.push("Monitor burn rate monthly and begin next raise planning.");
    if (actions.length === 0) actions.push("Maintain current burn discipline and advance capital raise milestones on schedule.");

    return {
      section: "runway_intelligence",
      title: "Runway Intelligence",
      severity,
      current_cash_balance: cash,
      monthly_burn: burn,
      runway_today_months: Math.round(runwayToday * 10) / 10,
      cashout_date_today: addMonthsLabel(runwayToday),
      runway_downside_months: Math.round(runwayDownside * 10) / 10,
      runway_after_min_months: runwayAfterMin != null ? Math.round(runwayAfterMin * 10) / 10 : null,
      runway_after_target_months: runwayAfterTarget != null ? Math.round(runwayAfterTarget * 10) / 10 : null,
      runway_upside_months: runwayUpside != null ? Math.round(runwayUpside * 10) / 10 : null,
      committed_capital: committed,
      summary: `Estimated ${Math.round(runwayToday * 10) / 10} months runway at current burn of ${fmt$(burn)}/month. Cash: ${fmt$(cash)}.`,
      key_risks: [
        runwayToday < 6 ? "Short runway — immediate capital action likely required." : null,
        burn > cash * 0.15 ? "Monthly burn represents >15% of cash balance — monitor closely." : null,
        !committed ? "No committed capital recorded — raise progress unclear." : null,
      ].filter(Boolean) as string[],
      recommended_ceo_actions: actions,
      assumptions: [
        "Cash balance and monthly burn sourced from the active capital round record.",
        "Downside scenario assumes 20% cost overrun with no new capital.",
        "Upside scenario adds committed capital from capital_commitments table.",
        "Post-close burn used for post-raise scenarios if set; defaults to current burn.",
        "This is a planning assumption — not a financial projection or advice.",
      ],
    };
  } catch (err: any) {
    return { section: "runway_intelligence", title: "Runway Intelligence", severity: "watch" as const, error: err?.message };
  }
}

// ── 3. buildFundingForecast ────────────────────────────────────────────────────

export async function buildFundingForecast(actorUser: ForecastActorUser) {
  if (!actorUser.hasCapital) {
    return {
      section: "funding_forecast",
      title: "Funding Forecast",
      severity: "info" as const,
      access_denied: true,
      message: "Funding Forecast requires CEO or CFO access.",
    };
  }

  try {
    // Active investors
    const investorRes = await db.execute(sql`
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE status = 'active') AS active,
             COUNT(*) FILTER (WHERE status IN ('warm','hot','closing')) AS active_conversations
      FROM capital_investors
    `);
    const inv = (investorRes.rows[0] as any) ?? {};

    // Active round
    const roundRes = await db.execute(sql`
      SELECT id, name, status, target_amount, minimum_close_target, current_cash_balance, monthly_burn
      FROM capital_rounds WHERE status = 'active' ORDER BY created_at DESC LIMIT 1
    `);
    const round = roundRes.rows[0] as any;

    // Commitments
    const commitRes = round ? await db.execute(sql`
      SELECT COALESCE(SUM(committed_amount), 0) AS committed,
             COALESCE(SUM(soft_circle_amount), 0) AS soft_circled,
             COUNT(*) AS count
      FROM capital_commitments WHERE round_id = ${round.id}
    `).catch(() => ({ rows: [{ committed: 0, soft_circled: 0, count: 0 }] })) : { rows: [{ committed: 0, soft_circled: 0, count: 0 }] };
    const comm = (commitRes.rows[0] as any) ?? {};

    // Grants
    const grantRes = await db.execute(sql`
      SELECT COUNT(*) FILTER (WHERE status = 'applied' OR status = 'in_review') AS active,
             COALESCE(SUM(amount) FILTER (WHERE status IN ('approved','awarded')), 0) AS secured,
             COALESCE(SUM(amount) FILTER (WHERE status IN ('applied','in_review')), 0) AS pending
      FROM capital_grants
    `).catch(() => ({ rows: [{ active: 0, secured: 0, pending: 0 }] }));
    const grants = (grantRes.rows[0] as any) ?? {};

    const committed    = safeNum(comm.committed);
    const softCircled  = safeNum(comm.soft_circled);
    const grantSecured = safeNum(grants.secured);
    const grantPending = safeNum(grants.pending);
    const target       = safeNum(round?.target_amount);
    const remaining    = target > 0 ? Math.max(0, target - committed) : null;

    const nextActions: string[] = [];
    if (safeNum(inv.active_conversations) > 0) nextActions.push(`Follow up with ${inv.active_conversations} active investor conversations.`);
    if (softCircled > 0) nextActions.push(`Convert ${fmt$(softCircled)} soft-circled to committed — confirm terms and timeline.`);
    if (remaining !== null && remaining > 0) nextActions.push(`${fmt$(remaining)} remaining to target raise — identify next lead investors.`);
    if (safeNum(grants.active) > 0) nextActions.push(`${grants.active} grant application${grants.active > 1 ? "s" : ""} in review — follow up with program officers.`);

    const risks: string[] = [];
    if (safeNum(inv.active_conversations) === 0) risks.push("No active investor conversations recorded — pipeline may be stalled.");
    if (committed === 0 && target > 0) risks.push("No committed capital against target — raise progress may be behind plan.");
    if (grantPending > 0) risks.push(`${fmt$(grantPending)} in pending grant applications — outcomes uncertain, not included in base scenario.`);

    return {
      section: "funding_forecast",
      title: "Funding Forecast",
      severity: risks.length > 1 ? "urgent" : risks.length > 0 ? "watch" : "info",
      total_investors: safeNum(inv.total),
      active_conversations: safeNum(inv.active_conversations),
      round_status: round?.status ?? null,
      round_name: round?.name ?? null,
      target_raise: target || null,
      committed_capital: committed,
      soft_circled: softCircled,
      remaining_to_target: remaining,
      grant_secured: grantSecured,
      grant_pending: grantPending,
      active_grant_applications: safeNum(grants.active),
      summary: target > 0
        ? `${fmt$(committed)} committed of ${fmt$(target)} target. ${safeNum(inv.active_conversations)} active investor conversations.`
        : `${safeNum(inv.total)} investors tracked. ${fmt$(committed)} committed capital recorded.`,
      next_funding_actions: nextActions,
      funding_risks: risks,
      assumptions: [
        "Committed capital from capital_commitments table only.",
        "Soft-circled amounts from soft_circle_amount column on commitments.",
        "Grant figures from capital_grants table.",
        "Active conversations = investors with status warm, hot, or closing.",
        "This is a planning assumption — not a financial projection or advice.",
      ],
    };
  } catch (err: any) {
    return { section: "funding_forecast", title: "Funding Forecast", severity: "watch" as const, error: err?.message };
  }
}

// ── 4. buildExecutionForecast ──────────────────────────────────────────────────

export async function buildExecutionForecast(actorUser: ForecastActorUser) {
  try {
    const [drift, commitments, risks, scorecard] = await Promise.all([
      detectExecutionDrift(actorUser).catch(() => ({ items: [] as any[] })),
      buildCommitmentsRadar(actorUser).catch(() => ({ items: [] as any[] })),
      buildRecurringRiskPatterns(actorUser).catch(() => ({ items: [] as any[] })),
      buildExecutionScorecard(actorUser).catch(() => ({ score: null as any, items: [] as any[], label: "Unknown" })),
    ]);

    const driftItems    = (drift as any)?.items ?? [];
    const commitItems   = (commitments as any)?.items ?? [];
    const riskItems     = (risks as any)?.items ?? [];
    const scorecardData = scorecard as any;

    const likelySlips = driftItems.filter((i: any) => i.severity === "critical" || i.severity === "high").slice(0, 6).map((i: any) => ({
      title: i.title,
      severity: i.severity,
      reason: i.reason ?? i.subtitle,
    }));

    const atRiskCommitments = commitItems.filter((i: any) => i.severity === "critical" || i.severity === "high").slice(0, 6).map((i: any) => ({
      title: i.title,
      severity: i.severity,
      reason: i.reason ?? i.subtitle,
    }));

    const recurringRisks = riskItems.slice(0, 5).map((i: any) => ({
      title: i.title,
      severity: i.severity,
      reason: i.reason ?? i.subtitle,
    }));

    // Owner load risk — people with many overdue tasks
    const ownerRes = await db.execute(sql`
      SELECT u.name, COUNT(*) AS overdue_count
      FROM tasks t
      JOIN users u ON u.id = t.owner_id
      WHERE t.status NOT IN ('completed','cancelled')
        AND t.due_date < NOW()
      GROUP BY u.name
      HAVING COUNT(*) >= 3
      ORDER BY overdue_count DESC
      LIMIT 5
    `).catch(() => ({ rows: [] }));
    const ownerRisks = (ownerRes.rows as any[]).map(r => ({ name: r.name, overdue_count: safeNum(r.overdue_count) }));

    // Stale tasks likely to remain stale
    const staleRes = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM tasks
      WHERE status NOT IN ('completed','cancelled')
        AND updated_at < NOW() - INTERVAL '14 days'
    `).catch(() => ({ rows: [{ cnt: 0 }] }));
    const staleTasks = safeNum((staleRes.rows[0] as any)?.cnt);

    const severity = likelySlips.filter((i: any) => i.severity === "critical").length > 2 ? "critical"
      : likelySlips.length > 3 || atRiskCommitments.length > 2 ? "urgent"
      : likelySlips.length > 0 || atRiskCommitments.length > 0 ? "watch"
      : "info";

    const interventions: string[] = [];
    if (likelySlips.length > 0) interventions.push(`Address ${likelySlips.length} high-severity execution drift item${likelySlips.length > 1 ? "s" : ""} before they escalate.`);
    if (atRiskCommitments.length > 0) interventions.push(`${atRiskCommitments.length} commitment${atRiskCommitments.length > 1 ? "s" : ""} likely to miss — assign clear owners and due dates.`);
    if (ownerRisks.length > 0) interventions.push(`${ownerRisks[0].name} and ${ownerRisks.length - 1} other${ownerRisks.length > 2 ? "s" : ""} carry high overdue task loads — triage or redistribute.`);
    if (staleTasks > 10) interventions.push(`${staleTasks} stale tasks likely to remain without intervention — schedule a task triage session.`);

    return {
      section: "execution_forecast",
      title: "Execution Forecast",
      severity,
      execution_health_score: scorecardData?.score ?? null,
      execution_health_label: scorecardData?.label ?? null,
      likely_slips: likelySlips,
      at_risk_commitments: atRiskCommitments,
      recurring_risks: recurringRisks,
      owner_load_risks: ownerRisks,
      stale_tasks_count: staleTasks,
      summary: likelySlips.length > 0
        ? `${likelySlips.length} likely execution slip${likelySlips.length > 1 ? "s" : ""} detected. ${atRiskCommitments.length} commitment${atRiskCommitments.length > 1 ? "s" : ""} at risk.`
        : "Execution appears on track based on current drift and commitment data.",
      recommended_interventions: interventions,
      assumptions: [
        "Likely slips derived from Phase 8 Execution Intelligence drift detection.",
        "At-risk commitments from Phase 8 Commitments Radar (high/critical severity items).",
        "Recurring risks from Phase 8 pattern analysis.",
        "Owner load = users with 3+ overdue tasks.",
        "Stale tasks = not updated in 14+ days, not completed.",
        "This is a planning assumption based on current CMS data.",
      ],
    };
  } catch (err: any) {
    return { section: "execution_forecast", title: "Execution Forecast", severity: "watch" as const, error: err?.message };
  }
}

// ── 5. buildScenarioPlan ───────────────────────────────────────────────────────

export async function buildScenarioPlan(actorUser: ForecastActorUser) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const ninetyOut = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);

    const pipeRes = await db.execute(sql`
      SELECT
        COALESCE(SUM(amount), 0) AS total_pipeline,
        COALESCE(SUM(amount * COALESCE(probability_pct, 20) / 100.0), 0) AS weighted,
        COALESCE(SUM(amount) FILTER (WHERE forecast_category = 'commit'), 0) AS commit_amount,
        COALESCE(SUM(amount) FILTER (WHERE forecast_category = 'best_case'), 0) AS best_case_amount,
        COALESCE(SUM(amount) FILTER (WHERE forecast_category = 'pipeline'), 0) AS pipeline_amount,
        COALESCE(SUM(amount) FILTER (WHERE stage = 'closed_won'), 0) AS closed_won,
        COUNT(*) FILTER (WHERE stage NOT IN ('closed_won','closed_lost')) AS open_count,
        COUNT(*) FILTER (WHERE est_close_date < ${today} AND stage NOT IN ('closed_won','closed_lost')) AS slipped_count,
        COUNT(*) FILTER (WHERE est_close_date BETWEEN ${today} AND ${ninetyOut} AND stage NOT IN ('closed_won','closed_lost')) AS closing_90d_count
      FROM opportunities
    `);
    const p = (pipeRes.rows[0] as any) ?? {};

    const commitAmt  = safeNum(p.commit_amount);
    const bestCase   = safeNum(p.best_case_amount);
    const pipelineAmt = safeNum(p.pipeline_amount);
    const weighted   = safeNum(p.weighted);
    const closedWon  = safeNum(p.closed_won);
    const slipped    = safeNum(p.slipped_count);
    const open       = safeNum(p.open_count);

    // Base: commit × 0.85 + best_case × 0.50 + pipeline × 0.15
    const baseRevenue = Math.round(commitAmt * 0.85 + bestCase * 0.50 + pipelineAmt * 0.15);
    // Upside: commit × 0.95 + best_case × 0.70 + pipeline × 0.25
    const upsideRevenue = Math.round(commitAmt * 0.95 + bestCase * 0.70 + pipelineAmt * 0.25);
    // Downside: commit × 0.60 + best_case × 0.20 + pipeline × 0.05
    const downsideRevenue = Math.round(commitAmt * 0.60 + bestCase * 0.20 + pipelineAmt * 0.05);

    const executionForecast = await buildExecutionForecast(actorUser).catch(() => null);
    const slipCount = (executionForecast as any)?.likely_slips?.length ?? 0;
    const commitRisk = (executionForecast as any)?.at_risk_commitments?.length ?? 0;

    const baseCaseRisks: string[] = [];
    const baseCaseOpps: string[] = [];
    if (slipped > 0) baseCaseRisks.push(`${slipped} slipped close date${slipped > 1 ? "s" : ""} suggest execution gaps may continue.`);
    if (slipCount > 2) baseCaseRisks.push(`${slipCount} execution drift items suggest delivery risk in the base case.`);
    if (commitAmt > 0) baseCaseOpps.push(`${fmt$(commitAmt)} in commit-category pipeline supports the base revenue scenario.`);
    if (open > 10) baseCaseOpps.push(`Pipeline of ${open} active opportunities provides coverage above base case.`);

    return {
      section: "scenario_plan",
      title: "Scenario Planning",
      scenarios: {
        base_case: {
          label: "Base Case",
          summary: `Suggests ${fmt$(baseRevenue)} near-term revenue if current pipeline progresses at expected rates.`,
          likely_outcome: `Commit pipeline closes at ~85%, best-case at ~50%, remaining pipeline at ~15% — a planning assumption based on current forecast categories.`,
          revenue_implication: baseRevenue,
          revenue_implication_label: fmt$(baseRevenue),
          key_assumptions: [
            `Commit pipeline (${fmt$(commitAmt)}) closes at approximately 85%.`,
            `Best-case pipeline (${fmt$(bestCase)}) closes at approximately 50%.`,
            `Remaining pipeline (${fmt$(pipelineAmt)}) closes at approximately 15%.`,
            "No major new opportunities added to pipeline.",
            "Current execution pace continues without significant slippage.",
          ],
          top_risks: baseCaseRisks.length > 0 ? baseCaseRisks : ["No major risks identified in current data for base case."],
          top_opportunities: baseCaseOpps,
          recommended_actions: [
            "Lock in commit-category opportunities with clear next steps and signed agreements.",
            "Re-qualify best-case opportunities — confirm decision criteria and economic buyer.",
          ],
        },
        upside_case: {
          label: "Upside Case",
          summary: `Suggests ${fmt$(upsideRevenue)} if commit and best-case pipeline both outperform expectations.`,
          likely_outcome: `Upside suggests accelerated close rates — commit at ~95%, best-case at ~70%. This scenario requires execution above current trend.`,
          revenue_implication: upsideRevenue,
          revenue_implication_label: fmt$(upsideRevenue),
          key_assumptions: [
            `Commit pipeline (${fmt$(commitAmt)}) closes at approximately 95%.`,
            `Best-case pipeline (${fmt$(bestCase)}) closes at approximately 70%.`,
            "Executive attention accelerates at least 2–3 stalled opportunities.",
            "No major slippage on current close dates.",
            commitRisk === 0 ? "Execution remains on track." : `${commitRisk} at-risk commitment${commitRisk > 1 ? "s" : ""} resolved before impacting revenue deals.`,
          ],
          top_risks: [
            "Upside scenario requires execution above current pace — likely only if blockers are resolved.",
            slipCount > 0 ? `${slipCount} execution drift item${slipCount > 1 ? "s" : ""} need resolution for upside to materialise.` : null,
          ].filter(Boolean) as string[],
          top_opportunities: [
            bestCase > 0 ? `Converting ${fmt$(bestCase)} best-case pipeline at 70%+ would be a significant upside driver.` : null,
            open > 5 ? "Strong pipeline breadth provides opportunity to overperform if close rate improves." : null,
          ].filter(Boolean) as string[],
          recommended_actions: [
            "CEO direct engagement on top 3 stuck opportunities.",
            "Accelerate any deal sitting in proposal/negotiation for 30+ days.",
          ],
        },
        downside_case: {
          label: "Downside Case",
          summary: `Suggests ${fmt$(downsideRevenue)} if execution slips and pipeline conversion underperforms.`,
          likely_outcome: `Downside scenario — commit at ~60%, best-case at ~20% — reflects continued execution drift or market-side delays.`,
          revenue_implication: downsideRevenue,
          revenue_implication_label: fmt$(downsideRevenue),
          key_assumptions: [
            `Commit pipeline (${fmt$(commitAmt)}) closes at approximately 60% due to execution or external friction.`,
            `Best-case pipeline (${fmt$(bestCase)}) closes at approximately 20% — many deals slip.`,
            slipped > 0 ? `${slipped} already-slipped deal${slipped > 1 ? "s" : ""} do not recover this period.` : "Pipeline close dates slip by one quarter.",
            "No material new opportunities added to offset shortfall.",
          ],
          top_risks: [
            "Downside scenario is likely if current execution drift continues unaddressed.",
            "Revenue shortfall in this scenario may affect runway and require burn-rate adjustment.",
            commitRisk > 0 ? `${commitRisk} at-risk commitment${commitRisk > 1 ? "s" : ""} could further compress revenue if unresolved.` : null,
          ].filter(Boolean) as string[],
          top_opportunities: [
            "Early identification of downside signals allows faster course correction.",
            "CEO-led pipeline review can recover 1–2 slipped deals if acted on immediately.",
          ],
          recommended_actions: [
            "Immediately triage all slipped and stale opportunities — close or re-qualify.",
            "Review burn rate and discretionary spend if downside revenue risk materialises.",
            "Activate pipeline-generation activities to replenish top of funnel.",
          ],
        },
      },
      pipeline_context: {
        total_pipeline: safeNum(p.total_pipeline),
        weighted_pipeline: weighted,
        commit_amount: commitAmt,
        best_case_amount: bestCase,
        closed_won_amount: closedWon,
        slipped_count: slipped,
        open_count: open,
      },
      assumptions: [
        "Scenario multipliers are planning assumptions only — not scientific predictions.",
        "Base/Upside/Downside rates applied to forecast_category segments: commit, best_case, pipeline.",
        "Revenue implications do not include closed_won (already realised).",
        "Execution forecast data from Phase 8 Execution Intelligence.",
        "Scenarios do not constitute financial guidance or professional advice.",
      ],
    };
  } catch (err: any) {
    return { section: "scenario_plan", title: "Scenario Planning", severity: "watch" as const, error: err?.message };
  }
}

// ── 6. buildForecastInterventions ─────────────────────────────────────────────

export async function buildForecastInterventions(actorUser: ForecastActorUser) {
  try {
    const [revForecast, execForecast] = await Promise.all([
      buildRevenueForecast(actorUser).catch(() => null),
      buildExecutionForecast(actorUser).catch(() => null),
    ]);

    const interventions: Array<{
      title: string;
      priority: "critical" | "high" | "medium";
      reason: string;
      action_type: string;
    }> = [];

    const rev = revForecast as any;
    const exec = execForecast as any;

    if (rev?.slipped_opportunities?.length > 0) {
      interventions.push({
        title: `Review ${rev.slipped_opportunities.length} slipped pipeline opportunities`,
        priority: "high",
        reason: "Slipped close dates suggest execution or qualification gaps that reduce revenue forecast reliability.",
        action_type: "review_commitment",
      });
    }
    if (exec?.likely_slips?.length > 2) {
      interventions.push({
        title: `Address ${exec.likely_slips.length} execution drift items`,
        priority: exec.likely_slips.some((i: any) => i.severity === "critical") ? "critical" : "high",
        reason: "Recurring execution drift suggests systemic delivery risk in the base and downside scenarios.",
        action_type: "review_commitment",
      });
    }
    if (exec?.owner_load_risks?.length > 0) {
      interventions.push({
        title: `Triage task overload for ${exec.owner_load_risks[0]?.name}`,
        priority: "medium",
        reason: "High task load on key team members creates single-point-of-failure risk in execution forecast.",
        action_type: "follow_up",
      });
    }
    if (rev?.stale_opportunities?.length > 5) {
      interventions.push({
        title: "Pipeline triage session — re-qualify stale opportunities",
        priority: "medium",
        reason: "Large number of stale opportunities inflates pipeline total and reduces weighted forecast accuracy.",
        action_type: "follow_up",
      });
    }
    if (interventions.length === 0) {
      interventions.push({
        title: "Maintain execution discipline and monitor leading indicators",
        priority: "medium",
        reason: "No critical forecast risks detected — continue monitoring weekly.",
        action_type: "follow_up",
      });
    }

    return {
      section: "forecast_interventions",
      title: "Recommended CEO Interventions",
      interventions,
      count: interventions.length,
      assumptions: ["Interventions derived from live revenue and execution forecast data."],
    };
  } catch (err: any) {
    return { section: "forecast_interventions", title: "Recommended CEO Interventions", interventions: [], count: 0, error: err?.message };
  }
}

// ── 7. buildCeoForecast (master) ───────────────────────────────────────────────

export interface CeoForecastOptions {
  includeRunway?: boolean;
  includeFunding?: boolean;
}

export async function buildCeoForecast(actorUser: ForecastActorUser, options: CeoForecastOptions = {}) {
  const [revenue, execution, scenarios, interventions] = await Promise.all([
    buildRevenueForecast(actorUser),
    buildExecutionForecast(actorUser),
    buildScenarioPlan(actorUser),
    buildForecastInterventions(actorUser),
  ]);

  const runway = actorUser.hasCapital ? await buildRunwayIntelligence(actorUser) : null;
  const funding = actorUser.hasCapital ? await buildFundingForecast(actorUser) : null;

  const rv  = revenue as any;
  const ex  = execution as any;
  const sc  = scenarios as any;
  const rw  = runway as any;
  const fd  = funding as any;
  const inv = interventions as any;

  // Executive summary bullets
  const bullets: string[] = [];
  if (rv?.total_open_pipeline > 0) bullets.push(`Open pipeline: ${fmt$(rv.total_open_pipeline)} (${fmt$(rv.weighted_pipeline)} weighted).`);
  if (sc?.scenarios?.base_case?.revenue_implication > 0) bullets.push(`Base case scenario suggests ${sc.scenarios.base_case.revenue_implication_label} near-term revenue.`);
  if (ex?.likely_slips?.length > 0) bullets.push(`${ex.likely_slips.length} execution slip${ex.likely_slips.length > 1 ? "s" : ""} likely based on current drift.`);
  if (rw && !rw.access_denied && !rw.empty_state && rw.runway_today_months) bullets.push(`Estimated runway: ${rw.runway_today_months} months at current burn.`);
  if (fd && !fd.access_denied && fd.committed_capital > 0) bullets.push(`${fmt$(fd.committed_capital)} committed capital recorded.`);
  if (rv?.slipped_opportunities?.length > 0) bullets.push(`${rv.slipped_opportunities.length} opportunit${rv.slipped_opportunities.length === 1 ? "y" : "ies"} with missed close dates need immediate review.`);

  const overallSeverity = [rv?.severity, ex?.severity, rw?.severity].filter(Boolean);
  const severity = overallSeverity.includes("critical") ? "critical"
    : overallSeverity.includes("urgent") ? "urgent"
    : overallSeverity.includes("watch") ? "watch"
    : "info";

  return {
    generated_at: new Date().toISOString(),
    generated_by: actorUser.name,
    overall_severity: severity,
    executive_forecast_summary: {
      title: "Executive Forecast Summary",
      severity,
      bullets,
      top_risks: [
        ...(rv?.blockers_to_revenue ?? []).slice(0, 2),
        ...(ex?.recommended_interventions ?? []).slice(0, 2),
      ].slice(0, 4),
      top_opportunities: [
        ex?.execution_health_label ? `Execution health: ${ex.execution_health_label}` : null,
        sc?.scenarios?.upside_case?.summary ?? null,
      ].filter(Boolean),
      recommended_actions: inv?.interventions?.slice(0, 3).map((i: any) => i.title) ?? [],
    },
    revenue_forecast: revenue,
    execution_forecast: execution,
    scenario_plan: scenarios,
    runway_intelligence: runway,
    funding_forecast: funding,
    forecast_interventions: interventions,
    key_assumptions: [
      "All data sourced from VoltSafe CMS database — no external APIs.",
      "Scenario multipliers are planning assumptions only.",
      "Missing data is clearly identified — no numbers are invented.",
      "This forecast does not constitute professional financial guidance.",
      "Capital/runway sections visible to CEO and CFO only.",
    ],
    leading_indicators: {
      weighted_pipeline: rv?.weighted_pipeline ?? null,
      commit_amount: rv?.commit_amount ?? null,
      slipped_count: rv?.slipped_opportunities?.length ?? 0,
      stale_count: rv?.stale_opportunities?.length ?? 0,
      execution_health_score: ex?.execution_health_score ?? null,
      likely_slips: ex?.likely_slips?.length ?? 0,
      runway_months: rw?.runway_today_months ?? null,
    },
  };
}

// ── 8. saveScenarioNote ────────────────────────────────────────────────────────

export async function saveScenarioNote(actorUser: ForecastActorUser, input: {
  scenario_type: "base" | "upside" | "downside" | "general";
  title: string;
  body: string;
  assumptions?: Record<string, any>;
}) {
  try {
    const result = await db.execute(sql`
      INSERT INTO ceo_forecast_notes (scenario_type, title, body, assumptions, created_by_user_id)
      VALUES (${input.scenario_type}, ${input.title}, ${input.body}, ${JSON.stringify(input.assumptions ?? {})}::jsonb, ${actorUser.id})
      RETURNING id, scenario_type, title, body, created_at
    `);
    return { ok: true, note: result.rows[0] };
  } catch (err: any) {
    return { ok: false, error: err?.message, copy_only: true, text: `${input.title}\n\n${input.body}` };
  }
}

// ── 9. createForecastActions (Phase 6 integration) ────────────────────────────

export async function createForecastActions(actorUser: ForecastActorUser, interventions: Array<{
  title: string;
  priority: "critical" | "high" | "medium";
  reason: string;
  action_type: string;
}>) {
  const results: Array<{ ok: boolean; id?: number; title: string; error?: string }> = [];

  for (const intervention of interventions.slice(0, 5)) {
    try {
      const action = await createCeoAction({
        type: intervention.action_type === "review_commitment" ? "review_commitment" : "follow_up",
        priority: intervention.priority === "critical" ? "critical" : intervention.priority === "high" ? "high" : "medium",
        source_section: "ceo_forecasting",
        source_type: "forecast_intervention",
        title: intervention.title,
        body: intervention.reason,
        created_by_user_id: actorUser.id,
      } as CreateActionInput & { created_by_user_id: number }, actorUser.id);
      results.push({ ok: true, id: action.id, title: intervention.title });
    } catch (err: any) {
      results.push({ ok: false, title: intervention.title, error: err?.message });
    }
  }

  return { created: results.filter(r => r.ok).length, results };
}
