/**
 * Revenue Operating System v3
 * Scenario Commitments, Gap-to-Plan Tracking, and Auto-Task Creation
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { chooseBoardPackScenario, type BoardPackScenario } from "./revenue-simulator-insights";

// ── Types ─────────────────────────────────────────────────────────────────────

export type GapStatus = "on_track" | "at_risk" | "off_track" | "no_commit";

export type GapToPlan = {
  monthKey: string;
  committedRevenue: number;
  actualRevenueToDate: number;
  forecastRevenueToDate: number;
  projectedMonthEndRevenue: number;
  gapAmount: number;
  gapPercent: number;
  status: GapStatus;
  daysInMonth: number;
  daysElapsed: number;
  paceRate: number; // 0–1: how far through month we are
  commitId: number | null;
  scenarioId: number | null;
  drivers: GapDriver[];
};

export type GapDriver = {
  type: "volume" | "conversion" | "velocity" | "churn" | "expansion";
  label: string;
  impact: number; // dollar impact on gap
  severity: "high" | "medium" | "low";
};

export type GapClosureAction = {
  title: string;
  reason: string;
  priority: "low" | "medium" | "high" | "critical";
  actionType: "manual" | "auto_gap" | "auto_pipeline" | "auto_velocity" | "auto_conversion";
  metricTarget?: number;
  metricUnit?: "deals" | "dollars" | "percent" | "days";
  linkedObjectType?: string;
};

type PlanCommitRow = {
  id: number;
  name: string;
  scenario_id: number | null;
  month_key: string;
  committed_revenue: string;
  baseline_revenue: string;
  stretch_revenue: string | null;
  notes: string | null;
  status: string;
  committed_by: number | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isNaN(n) ? 0 : n;
}

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

function daysInMonth(monthKey: string): number {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function daysElapsed(monthKey: string): number {
  const now = new Date();
  const [y, m] = monthKey.split("-").map(Number);
  if (now.getFullYear() !== y || now.getMonth() + 1 !== m) {
    // Past month = all days elapsed; future = 0
    const monthStart = new Date(y, m - 1, 1);
    return now < monthStart ? 0 : daysInMonth(monthKey);
  }
  return now.getDate();
}

// ── 1. createPlanCommitFromScenario ───────────────────────────────────────────

export async function createPlanCommitFromScenario(opts: {
  name: string;
  monthKey: string;
  scenarioId?: number | null;
  committedRevenue: number;
  baselineRevenue: number;
  stretchRevenue?: number | null;
  notes?: string | null;
  committedBy: number;
  status?: string;
}): Promise<PlanCommitRow> {
  const { name, monthKey, scenarioId, committedRevenue, baselineRevenue, stretchRevenue, notes, committedBy, status = "active" } = opts;

  // Supersede any existing active commits for the same month
  if (status === "active") {
    await db.execute(sql`
      UPDATE revenue_plan_commits
      SET status = 'superseded', updated_at = NOW()
      WHERE month_key = ${monthKey} AND status = 'active'
    `);
  }

  const row = await db.execute(sql`
    INSERT INTO revenue_plan_commits
      (name, scenario_id, month_key, committed_revenue, baseline_revenue, stretch_revenue, notes, status, committed_by)
    VALUES (
      ${name},
      ${scenarioId ?? null},
      ${monthKey},
      ${committedRevenue.toFixed(2)},
      ${baselineRevenue.toFixed(2)},
      ${stretchRevenue != null ? stretchRevenue.toFixed(2) : null},
      ${notes ?? null},
      ${status},
      ${committedBy}
    )
    RETURNING *
  `);
  return row.rows[0] as PlanCommitRow;
}

// ── 2. computeGapToPlan ───────────────────────────────────────────────────────

export async function computeGapToPlan(monthKey: string): Promise<GapToPlan> {
  // Active commit for the month
  const commitRes = await db.execute(sql`
    SELECT * FROM revenue_plan_commits
    WHERE month_key = ${monthKey} AND status = 'active'
    ORDER BY created_at DESC LIMIT 1
  `);
  const commit = commitRes.rows[0] as PlanCommitRow | undefined;

  // Actuals on record for the month
  const actualsRes = await db.execute(sql`
    SELECT actual_amount, forecast_amount FROM revenue_forecast_actuals
    WHERE month_key = ${monthKey}
  `);
  const actualRow = actualsRes.rows[0] as { actual_amount: string; forecast_amount: string } | undefined;
  const actualRevenue = num(actualRow?.actual_amount);
  const forecastRevenue = num(actualRow?.forecast_amount);

  // Board pack scenario projection for the month
  let projectedRevenue = forecastRevenue;
  if (projectedRevenue === 0) {
    try {
      const sim = await chooseBoardPackScenario();
      if (sim) {
        const matchMonth = sim.months?.find((m: any) => m.month === monthKey);
        projectedRevenue = matchMonth ? num(matchMonth.simulated) : num(sim.totalSimulated) / 12;
      }
    } catch (_) {}
  }

  const committed = num(commit?.committed_revenue);

  // Time pacing
  const total = daysInMonth(monthKey);
  const elapsed = daysElapsed(monthKey);
  const paceRate = total > 0 ? elapsed / total : 1;

  // Project month-end based on pace if we have actuals
  const projected =
    projectedRevenue > 0 ? projectedRevenue :
    actualRevenue > 0 && paceRate > 0 ? actualRevenue / paceRate : 0;

  const gap = committed > 0 ? projected - committed : 0;
  const gapPct = committed > 0 ? (gap / committed) * 100 : 0;

  // Status
  let status: GapStatus = "no_commit";
  if (committed > 0) {
    if (gapPct >= -5) status = "on_track";
    else if (gapPct >= -15) status = "at_risk";
    else status = "off_track";
  }

  // Gap drivers (heuristic — would be enriched from CRM in production)
  const drivers: GapDriver[] = [];
  if (gap < 0) {
    const gapAbs = Math.abs(gap);
    if (gapAbs > 0) {
      drivers.push({ type: "volume", label: "Pipeline Volume", impact: -(gapAbs * 0.45), severity: "high" });
      drivers.push({ type: "conversion", label: "Win Rate / Conversion", impact: -(gapAbs * 0.30), severity: "medium" });
      drivers.push({ type: "velocity", label: "Deal Velocity", impact: -(gapAbs * 0.15), severity: "medium" });
      if (gapAbs > 50_000) drivers.push({ type: "churn", label: "Churn / Contraction", impact: -(gapAbs * 0.10), severity: "low" });
    }
  } else if (gap > 0) {
    drivers.push({ type: "expansion", label: "Expansion Upside", impact: gap * 0.6, severity: "low" });
  }

  return {
    monthKey,
    committedRevenue: committed,
    actualRevenueToDate: actualRevenue,
    forecastRevenueToDate: forecastRevenue,
    projectedMonthEndRevenue: projected,
    gapAmount: gap,
    gapPercent: gapPct,
    status,
    daysInMonth: total,
    daysElapsed: elapsed,
    paceRate,
    commitId: commit ? Number(commit.id) : null,
    scenarioId: commit?.scenario_id ? Number(commit.scenario_id) : null,
    drivers,
  };
}

// ── 3. generateGapClosureActions ──────────────────────────────────────────────

export function generateGapClosureActions(gap: GapToPlan): GapClosureAction[] {
  const actions: GapClosureAction[] = [];
  const gapAbs = Math.abs(gap.gapAmount);
  const gapPct = Math.abs(gap.gapPercent);

  if (gap.status === "no_commit") return [];
  if (gap.status === "on_track") {
    return [{
      title: "Maintain current pipeline pace — you are on track",
      reason: `Projected month-end revenue is within 5% of committed target ($${(gap.committedRevenue / 1000).toFixed(0)}K).`,
      priority: "low",
      actionType: "manual",
    }];
  }

  // Volume gap
  const volumeDriver = gap.drivers.find(d => d.type === "volume");
  if (volumeDriver && gapAbs > 0) {
    const dealsNeeded = Math.ceil(gapAbs / Math.max(gap.committedRevenue / 20, 10_000));
    actions.push({
      title: `Source ${dealsNeeded} additional qualified opportunities this month`,
      reason: `Pipeline volume accounts for ~45% of the gap. Adding ${dealsNeeded} deals at average size would recover ~$${(gapAbs * 0.45 / 1000).toFixed(0)}K.`,
      priority: gapPct > 20 ? "critical" : "high",
      actionType: "auto_pipeline",
      metricTarget: dealsNeeded,
      metricUnit: "deals",
      linkedObjectType: "lead",
    });
  }

  // Conversion gap
  if (gapPct > 10) {
    actions.push({
      title: "Audit proposal-stage deals and address objections this week",
      reason: "Win rate compression is the second-largest gap driver. Focus reps on deals stuck in proposal.",
      priority: "high",
      actionType: "auto_conversion",
      metricTarget: 15,
      metricUnit: "percent",
      linkedObjectType: "opportunity",
    });
  }

  // Velocity gap
  if (gapPct > 8) {
    actions.push({
      title: "Escalate top 5 near-close deals to fast-track approval",
      reason: "Slow deal velocity is preventing revenue from landing before month-end.",
      priority: gapPct > 20 ? "critical" : "high",
      actionType: "auto_velocity",
      metricTarget: 7,
      metricUnit: "days",
      linkedObjectType: "opportunity",
    });
    actions.push({
      title: "Review contracts awaiting signature and send follow-ups",
      reason: "Deals in final stages are blocked. A targeted outreach can recover $20K–$50K this week.",
      priority: "high",
      actionType: "auto_velocity",
      linkedObjectType: "opportunity",
    });
  }

  // Churn drag
  const churnDriver = gap.drivers.find(d => d.type === "churn");
  if (churnDriver) {
    actions.push({
      title: "Conduct emergency retention calls for at-risk accounts",
      reason: "Churn drag is shrinking the net revenue base. Prioritize accounts with renewal dates this month.",
      priority: "high",
      actionType: "auto_gap",
      linkedObjectType: "account",
    });
  }

  // Expansion upside
  if (gap.status === "at_risk") {
    actions.push({
      title: "Activate upsell campaign for top 10 current accounts",
      reason: "Expansion revenue from existing accounts can offset the pipeline shortfall with lower effort.",
      priority: "medium",
      actionType: "auto_gap",
      metricTarget: gapAbs * 0.2,
      metricUnit: "dollars",
      linkedObjectType: "account",
    });
  }

  // Management escalation for severe gap
  if (gapPct > 25) {
    actions.push({
      title: "Escalate gap to VP — update board pack forecast",
      reason: `Gap is ${gapPct.toFixed(0)}% below committed. Leadership visibility and plan revision are needed.`,
      priority: "critical",
      actionType: "auto_gap",
    });
  }

  return actions.slice(0, 8);
}

// ── 4. autoCreateTasksFromActions ─────────────────────────────────────────────

export async function autoCreateTasksFromActions(opts: {
  actions: GapClosureAction[];
  planCommitId: number;
  scenarioId?: number | null;
  createdByUserId: number;
  ownerUserId: number;
  priorities?: ("high" | "critical")[]; // only create tasks for these priorities; default high + critical
}): Promise<Array<{ taskId: number; actionTitle: string; created: boolean }>> {
  const { actions, planCommitId, createdByUserId, ownerUserId, priorities = ["high", "critical"] } = opts;
  const results: Array<{ taskId: number; actionTitle: string; created: boolean }> = [];

  const filtered = actions.filter(a => priorities.includes(a.priority as any));

  // Check for existing tasks from this plan commit to avoid duplicates
  const existingRes = await db.execute(sql`
    SELECT title FROM tasks
    WHERE source = 'revenue_ops' AND source_meta->>'planCommitId' = ${String(planCommitId)}
  `);
  const existingTitles = new Set((existingRes.rows as { title: string }[]).map(r => r.title));

  for (const action of filtered) {
    if (existingTitles.has(action.title)) {
      // Duplicate detected — skip
      const existingTask = await db.execute(sql`
        SELECT id FROM tasks WHERE title = ${action.title} AND source = 'revenue_ops' LIMIT 1
      `);
      const tid = existingTask.rows[0] ? Number((existingTask.rows[0] as any).id) : 0;
      results.push({ taskId: tid, actionTitle: action.title, created: false });
      continue;
    }

    const due = new Date();
    due.setDate(due.getDate() + 7); // Due in 1 week by default

    const taskRes = await db.execute(sql`
      INSERT INTO tasks
        (title, description, priority, status, source, source_label, source_meta,
         owner_user_id, created_by_user_id, linked_object_type, due_date)
      VALUES (
        ${action.title},
        ${action.reason},
        ${action.priority === "critical" ? "high" : action.priority},
        'pending',
        'revenue_ops',
        'Revenue Ops Gap Closure',
        ${JSON.stringify({ planCommitId, actionType: action.actionType, metricTarget: action.metricTarget, metricUnit: action.metricUnit })}::jsonb,
        ${ownerUserId},
        ${createdByUserId},
        ${action.linkedObjectType ?? null},
        ${due.toISOString()}
      )
      RETURNING id
    `);
    const taskId = Number((taskRes.rows[0] as { id: number }).id);
    existingTitles.add(action.title);
    results.push({ taskId, actionTitle: action.title, created: true });
  }

  return results;
}

// ── 5. snapshotGapStatus ──────────────────────────────────────────────────────

export async function snapshotGapStatus(monthKey: string): Promise<RevenueGapSnapshotInserted> {
  const gap = await computeGapToPlan(monthKey);
  const row = await db.execute(sql`
    INSERT INTO revenue_gap_snapshots
      (month_key, snapshot_date, committed_revenue, actual_revenue_to_date,
       forecast_revenue_to_date, projected_month_end_revenue, gap_amount, gap_percent, source_scenario_id)
    VALUES (
      ${monthKey},
      NOW(),
      ${gap.committedRevenue.toFixed(2)},
      ${gap.actualRevenueToDate.toFixed(2)},
      ${gap.forecastRevenueToDate.toFixed(2)},
      ${gap.projectedMonthEndRevenue.toFixed(2)},
      ${gap.gapAmount.toFixed(2)},
      ${gap.gapPercent.toFixed(2)},
      ${gap.scenarioId ?? null}
    )
    RETURNING *
  `);
  return { ...gap, snapshotId: Number((row.rows[0] as any).id) };
}

type RevenueGapSnapshotInserted = GapToPlan & { snapshotId: number };

// ── Board Pack helper ──────────────────────────────────────────────────────────

export type RevenueExecutionBlock = {
  monthKey: string;
  commitName: string | null;
  committedRevenue: number;
  projectedMonthEndRevenue: number;
  actualRevenueToDate: number;
  gapAmount: number;
  gapPercent: number;
  status: GapStatus;
  topActions: Pick<GapClosureAction, "title" | "priority">[];
};

export async function buildRevenueExecutionBlock(monthKey?: string): Promise<RevenueExecutionBlock | null> {
  const mk = monthKey ?? currentMonthKey();
  try {
    const gap = await computeGapToPlan(mk);
    if (gap.status === "no_commit") return null;

    const commitRes = await db.execute(sql`
      SELECT name FROM revenue_plan_commits WHERE month_key = ${mk} AND status = 'active' LIMIT 1
    `);
    const commitName = commitRes.rows[0] ? (commitRes.rows[0] as any).name : null;

    const actions = generateGapClosureActions(gap);
    return {
      monthKey: mk,
      commitName,
      committedRevenue: gap.committedRevenue,
      projectedMonthEndRevenue: gap.projectedMonthEndRevenue,
      actualRevenueToDate: gap.actualRevenueToDate,
      gapAmount: gap.gapAmount,
      gapPercent: gap.gapPercent,
      status: gap.status,
      topActions: actions.slice(0, 3).map(a => ({ title: a.title, priority: a.priority })),
    };
  } catch (_) {
    return null;
  }
}
