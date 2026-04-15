/**
 * server/executive-kpis.ts
 *
 * Single source of truth for all Executive Dashboard KPI definitions, calculation
 * rules, and helper functions.  Both /api/executive/kpis and
 * /api/executive/risk-alerts import from here so the logic is never duplicated.
 *
 * Rule: if you change a KPI definition, change it here — nowhere else.
 */

// ── Stalled Opportunity ───────────────────────────────────────────────────────
/**
 * An opportunity is "stalled" when:
 *   1. It is not closed (stage ≠ closed_won / closed_lost)
 *   2. COALESCE(last_activity_date, created_at) is older than STALLED_THRESHOLD_DAYS
 *
 * Using COALESCE means a brand-new opp with no recorded activity is NOT
 * considered stalled — it only becomes stalled after THRESHOLD days have passed
 * since it was created.
 */
export const STALLED_THRESHOLD_DAYS = 21;

/** SQL WHERE fragment (no leading AND) for identifying stalled opps. */
export function buildStalledWhere(alias = "o"): string {
  return (
    `${alias}.stage NOT IN ('closed_won','closed_lost') ` +
    `AND COALESCE(${alias}.last_activity_date, ${alias}.created_at) ` +
    `< NOW() - INTERVAL '${STALLED_THRESHOLD_DAYS} days'`
  );
}

/** SQL expression that returns the integer number of days an opp has been stale. */
export function buildDaysStaleExpr(alias = "o"): string {
  return (
    `FLOOR(EXTRACT(EPOCH FROM NOW() - ` +
    `COALESCE(${alias}.last_activity_date, ${alias}.created_at)) / 86400)::int`
  );
}

// ── Weighted Pipeline ─────────────────────────────────────────────────────────
/**
 * Forecast-category probability weights used for the weighted pipeline figure.
 *
 *   commit    → 100%  rep is committing this will close in the period
 *   best_case →  60%  likely but not guaranteed
 *   pipeline  →  20%  early or uncertain stage
 *   (anything else) →  10%  fallback for uncategorised opps
 */
export const FORECAST_WEIGHT: Record<string, number> = {
  commit:    1.0,
  best_case: 0.6,
  pipeline:  0.2,
};
export const FORECAST_WEIGHT_DEFAULT = 0.1;

/** SQL SUM(…CASE…) expression for weighted pipeline. */
export function buildWeightedPipelineExpr(
  amountCol = "amount",
  fcCol = "forecast_category"
): string {
  return (
    `SUM(CASE ` +
    `WHEN ${fcCol} = 'commit'    THEN ${amountCol} * ${FORECAST_WEIGHT.commit} ` +
    `WHEN ${fcCol} = 'best_case' THEN ${amountCol} * ${FORECAST_WEIGHT.best_case} ` +
    `WHEN ${fcCol} = 'pipeline'  THEN ${amountCol} * ${FORECAST_WEIGHT.pipeline} ` +
    `ELSE ${amountCol} * ${FORECAST_WEIGHT_DEFAULT} END)`
  );
}

// ── Quote Status Buckets ──────────────────────────────────────────────────────
/**
 * Canonical quote status groups.
 *
 *   open   → draft, sent (not yet resolved)
 *   won    → accepted (converted to revenue)
 *   lost   → declined, expired (opportunity lost)
 *
 * Win-rate = won / (won + lost)  — excludes open quotes (still in-flight).
 */
export const QUOTE_OPEN_STATUSES    = ["draft", "sent"];
export const QUOTE_WON_STATUSES     = ["accepted"];
export const QUOTE_LOST_STATUSES    = ["declined", "expired"];

/**
 * A quote is "awaiting response" when:
 *   status = sent  AND  sent_at < NOW() - QUOTE_AWAITING_THRESHOLD_DAYS
 */
export const QUOTE_AWAITING_THRESHOLD_DAYS = 14;

// ── Install Workflow Buckets ──────────────────────────────────────────────────
export const INSTALL_ACTIVE_STATUSES   = ["pending_kickoff", "in_progress"];
export const INSTALL_COMPLETE_STATUSES = ["complete"];
export const INSTALL_INACTIVE_STATUSES = ["on_hold", "cancelled"];

// ── Lead Conversion Definition ────────────────────────────────────────────────
/**
 * A lead is "converted" when status = LEAD_CONVERTED_STATUS.
 * Closed/terminal statuses are excluded from "active" counts.
 */
export const LEAD_CONVERTED_STATUS = "converted";
export const LEAD_ACTIVE_STATUSES  = ["new", "contacted", "working", "qualified"];
export const LEAD_CLOSED_STATUSES  = ["converted", "disqualified"];

// ── Risk Severity ─────────────────────────────────────────────────────────────
/**
 * Severity rules for each risk category.
 * Used to drive UI colour coding and banner ordering.
 */
export const RISK_SEVERITY = {
  stalledOpps:          "high",
  awaitingQuotes:       "high",
  installBlockers:      "medium",
  overdueTasks:         "medium",
  dqRisks:              "medium",
  unownedLeads:         "low",
} as const;

export type RiskSeverity = "high" | "medium" | "low";

// ── Period Helpers ────────────────────────────────────────────────────────────

export type ComparisonMode = "explicit_range" | "month_over_month" | "quarter_over_quarter";

export interface PriorPeriod {
  priorFrom: Date;
  priorTo:   Date;
  mode:      ComparisonMode;
}

/**
 * Derive the "prior" comparison window from the current active window.
 *
 * Rules:
 *   - If dateFrom AND dateTo are explicit:
 *       prior window = same length immediately before dateFrom
 *       mode = "explicit_range"
 *   - If only dateFrom is provided:
 *       treat dateTo as today; same rule applies
 *       mode = "explicit_range"
 *   - If no dates:
 *       current = this calendar month; prior = last calendar month
 *       mode = "month_over_month"
 */
export function getPriorPeriod(
  dateFrom?: string,
  dateTo?: string
): PriorPeriod {
  const now = new Date();

  if (dateFrom) {
    const from = new Date(dateFrom);
    const to   = dateTo ? new Date(dateTo) : new Date(now);
    const diffMs = to.getTime() - from.getTime();
    const priorTo   = new Date(from.getTime() - 1);          // day before from
    const priorFrom = new Date(priorTo.getTime() - diffMs);  // same length prior
    return { priorFrom, priorTo, mode: "explicit_range" };
  }

  // No dates → month-over-month
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const priorMonthStart   = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const priorMonthEnd     = new Date(currentMonthStart.getTime() - 1);

  return {
    priorFrom: priorMonthStart,
    priorTo:   priorMonthEnd,
    mode:      "month_over_month",
  };
}

// ── Delta Calculation ─────────────────────────────────────────────────────────

export type Trend = "up" | "down" | "flat";

export interface KpiDelta {
  current:   number;
  previous:  number;
  delta:     number;
  /** % change rounded to 1 dp; null when previous is 0 */
  pctDelta:  number | null;
  trend:     Trend;
}

/**
 * Calculate period-over-period delta for a single KPI.
 * Both current and previous are raw numbers.
 *
 * Edge cases:
 *   - previous = 0, current > 0  → pctDelta = null (can't divide by zero)
 *   - previous = 0, current = 0  → delta = 0, trend = flat
 *   - negative values are valid (e.g. pipeline declined)
 */
export function calcDelta(current: number, previous: number): KpiDelta {
  const delta    = current - previous;
  const pctDelta = previous !== 0
    ? Math.round((delta / Math.abs(previous)) * 1000) / 10   // 1 decimal place
    : null;
  const trend: Trend = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  return { current, previous, delta, pctDelta, trend };
}

// ── Formatting Helpers (server-side, for summary bullets) ────────────────────

function fmtAmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

function pctStr(n: number | null): string {
  return n === null ? "—" : `${Math.abs(n)}%`;
}

// ── Executive Summary Bullet Generator ───────────────────────────────────────
/**
 * Generate up to 5 deterministic, board-ready summary bullets from the KPI
 * response returned by /api/executive/kpis.
 *
 * Priority order:
 *   1. Weighted pipeline movement (biggest financial signal)
 *   2. Accepted revenue movement
 *   3. Quote win-rate signal (above / below threshold)
 *   4. Install blocker signal (if any)
 *   5. Unowned leads / data quality warning (if material)
 *
 * Rules:
 *   - Each bullet is a single sentence, present-tense, ≤ 120 chars.
 *   - Numbers use short notation ($1.2M, 42%).
 *   - No AI; purely deterministic based on KPI values.
 */
export function generateSummaryBullets(kpis: any): string[] {
  const bullets: string[] = [];

  const pl = kpis?.pipeline ?? {};
  const qt = kpis?.quotes   ?? {};
  const iw = kpis?.installs ?? {};
  const rk = kpis?.risks    ?? {};

  // 1. Weighted pipeline movement
  const wp = pl.weightedPipeline;
  if (wp && typeof wp === "object") {
    if (wp.trend === "up" && wp.delta > 0) {
      bullets.push(
        `Weighted pipeline increased ${fmtAmt(wp.delta)} (+${pctStr(wp.pctDelta)}) ` +
        `to ${fmtAmt(wp.current)} vs prior period.`
      );
    } else if (wp.trend === "down" && wp.delta < 0) {
      bullets.push(
        `Weighted pipeline declined ${fmtAmt(Math.abs(wp.delta))} (${pctStr(wp.pctDelta)}) ` +
        `to ${fmtAmt(wp.current)} vs prior period.`
      );
    } else if (wp.current > 0) {
      bullets.push(`Weighted pipeline is ${fmtAmt(wp.current)}, flat vs prior period.`);
    }
  } else if (typeof wp === "number" && wp > 0) {
    bullets.push(`Weighted pipeline stands at ${fmtAmt(wp)}.`);
  }

  // 2. Accepted revenue movement
  const ar = qt.acceptedRevenue;
  if (ar && typeof ar === "object") {
    if (ar.trend === "up") {
      bullets.push(
        `Accepted revenue grew to ${fmtAmt(ar.current)} (+${pctStr(ar.pctDelta)} vs prior).`
      );
    } else if (ar.trend === "down") {
      bullets.push(
        `Accepted revenue fell to ${fmtAmt(ar.current)} (${pctStr(ar.pctDelta)} vs prior) — monitor close activity.`
      );
    } else if (ar.current > 0) {
      bullets.push(`Accepted revenue is ${fmtAmt(ar.current)}, flat vs prior period.`);
    }
  }

  // 3. Quote win-rate signal
  const winRateVal =
    typeof qt.winRate === "object" ? qt.winRate.current :
    typeof qt.winRate === "number" ? qt.winRate : null;

  if (winRateVal !== null) {
    if (winRateVal >= 40) {
      bullets.push(`Quote win rate is ${winRateVal}% — above the 40% target.`);
    } else if (winRateVal < 20) {
      bullets.push(
        `Quote win rate is ${winRateVal}% — below 20% threshold; review lost-quote reasons.`
      );
    }
  }

  // 4. Install blocker signal
  const blockerCount =
    typeof iw.withBlockers === "number" ? iw.withBlockers : 0;
  if (blockerCount > 0) {
    bullets.push(
      `${fmtNum(blockerCount)} install workflow${blockerCount !== 1 ? "s" : ""} ` +
      `${blockerCount !== 1 ? "have" : "has"} active blockers requiring resolution.`
    );
  }

  // 5. Data quality / unowned-leads signal
  const noOwner = typeof rk.leadsNoOwner === "number" ? rk.leadsNoOwner : 0;
  if (noOwner >= 10) {
    bullets.push(
      `${fmtNum(noOwner)} leads have no assigned owner — ` +
      `assign reps to prevent revenue leakage.`
    );
  } else if (typeof rk.stalledOpps === "number" && rk.stalledOpps > 0) {
    bullets.push(
      `${fmtNum(rk.stalledOpps)} open opportunit${rk.stalledOpps !== 1 ? "ies are" : "y is"} ` +
      `stalled with no activity in ${STALLED_THRESHOLD_DAYS}+ days.`
    );
  }

  return bullets.slice(0, 5);
}
