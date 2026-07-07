/**
 * CEO Execution Intelligence — Phase 8
 * Execution radar, drift detection, commitments radar, recurring risk patterns, scorecard.
 *
 * Safety rules:
 * - Never auto-sends anything — no email, no message, no notifications
 * - No AI or external API calls — local DB only
 * - Private Currents channels excluded
 * - DM channel bodies not broadly fetched
 * - Capital data only when actorUser.hasCapital === true
 * - Neutral operational language only — no shaming terms
 * - All DB queries wrapped in try/catch for missing-column resilience
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { createCeoAction } from "./ceo-action-loop";
import type { CreateActionInput } from "./ceo-action-loop";

// ── Shared actor type ──────────────────────────────────────────────────────────

export interface ExecutionActorUser {
  id: number;
  name: string;
  hasCapital: boolean;
}

// ── Centralised thresholds (easy to tune) ─────────────────────────────────────

export const DRIFT_THRESHOLDS = {
  blocker_stale_days: 7,
  task_stale_days: 7,
  task_blocked_no_update_days: 3,
  opp_stale_days: 14,
  opp_overdue_close_days: 0,
  commitment_missed_days: 0,
  action_snooze_repeat: 2,
  owner_overdue_count: 3,
  scorecard_critical_penalty: 8,
  scorecard_critical_max: 32,
  scorecard_high_action_penalty: 5,
  scorecard_high_action_max: 20,
  scorecard_commitment_penalty: 4,
  scorecard_commitment_max: 20,
  scorecard_blocker_penalty: 3,
  scorecard_blocker_max: 15,
  scorecard_stale_task_penalty: 2,
  scorecard_stale_task_max: 10,
  scorecard_snooze_penalty: 1,
  scorecard_snooze_max: 5,
} as const;

// ── Severity type ──────────────────────────────────────────────────────────────

export type ExecutionSeverity = "info" | "watch" | "urgent" | "critical";

export interface ExecutionItem {
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

export interface ExecutionSection {
  key: string;
  title: string;
  severity: ExecutionSeverity;
  items: ExecutionItem[];
  empty_state: string;
  reason: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 86_400_000));
}

function ageDays(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  return daysBetween(new Date(dateStr), new Date());
}

function safeRows(result: any): any[] {
  return result?.rows ?? [];
}

// ── 1. buildExecutionRadar ─────────────────────────────────────────────────────

export interface ExecutionRadarResult {
  generated_at: string;
  sections: Record<string, ExecutionSection>;
  recommended_interventions: Array<{
    title: string;
    reason: string;
    severity: ExecutionSeverity;
    suggested_action: string;
    source_type: string;
    source_id: string | null;
  }>;
}

export async function buildExecutionRadar(
  actorUser: ExecutionActorUser,
  _options: Record<string, any> = {}
): Promise<ExecutionRadarResult> {
  const now = new Date();

  // ── Section: critical_drift ────────────────────────────────────────────────
  const criticalItems: ExecutionItem[] = [];

  // Overdue critical/high action queue items
  try {
    const overdueActions = await db.execute(sql.raw(`
      SELECT id, title, priority, due_at, updated_at, created_at, source_type, source_id,
             assigned_to_user_id
      FROM ceo_action_queue
      WHERE status NOT IN ('completed', 'dismissed')
        AND priority IN ('critical', 'high')
        AND due_at IS NOT NULL AND due_at < NOW()
      ORDER BY priority DESC, due_at ASC
      LIMIT 20
    `));
    for (const r of safeRows(overdueActions)) {
      criticalItems.push({
        id: `action:${r.id}`,
        title: r.title,
        owner: null,
        source_type: r.source_type ?? "action_queue",
        source_id: String(r.id),
        age_days: ageDays(r.due_at),
        last_activity_at: r.updated_at,
        risk_reason: `${r.priority} priority action overdue by ${ageDays(r.due_at)} day(s)`,
        suggested_next_step: "Review and resolve or escalate",
        linked_action_id: r.id,
        metadata: { priority: r.priority },
      });
    }
  } catch (_e) { /* table not yet created */ }

  // Blockers open > DRIFT_THRESHOLDS.blocker_stale_days
  try {
    const staleBlockers = await db.execute(sql.raw(`
      SELECT t.id, t.title, t.updated_at, t.created_at, u.name AS owner_name
      FROM tasks t
      LEFT JOIN users u ON u.id = t.owner_user_id
      WHERE (t.status = 'blocked' OR (t.blockers IS NOT NULL AND t.blockers <> ''))
        AND t.updated_at < NOW() - INTERVAL '${DRIFT_THRESHOLDS.blocker_stale_days} days'
      ORDER BY t.updated_at ASC
      LIMIT 15
    `));
    for (const r of safeRows(staleBlockers)) {
      criticalItems.push({
        id: `task-blocker:${r.id}`,
        title: r.title,
        owner: r.owner_name ?? null,
        source_type: "task",
        source_id: String(r.id),
        age_days: ageDays(r.updated_at),
        last_activity_at: r.updated_at,
        risk_reason: `Blocker unresolved for ${ageDays(r.updated_at)} days`,
        suggested_next_step: "Unblock or escalate to remove dependency",
        linked_action_id: null,
        metadata: {},
      });
    }
  } catch (_e) { /* blockers column may not exist */ }

  const critical_drift: ExecutionSection = {
    key: "critical_drift",
    title: "Critical Drift",
    severity: criticalItems.length > 0 ? "critical" : "info",
    items: criticalItems.slice(0, 20),
    empty_state: "No critical drift detected",
    reason: criticalItems.length > 0
      ? `${criticalItems.length} critical item(s) require immediate attention`
      : "All critical items are on track",
  };

  // ── Section: slipping_commitments ─────────────────────────────────────────
  const slippingCommitments: ExecutionItem[] = [];
  try {
    const notesRows = await db.execute(sql.raw(`
      SELECT mn.id, mn.one_on_one_sections, mn.created_at, u.name AS member_name
      FROM meeting_notes mn
      LEFT JOIN users u ON u.id = mn.user_id
      WHERE mn.one_on_one_sections IS NOT NULL
      ORDER BY mn.created_at DESC
      LIMIT 50
    `));
    const seen = new Set<string>();
    for (const r of safeRows(notesRows)) {
      const sections: any = r.one_on_one_sections ?? {};
      const commits: any[] = sections.commitments ?? [];
      for (const c of commits) {
        if (!c?.text) continue;
        const key = `${r.member_name ?? ""}:${c.text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const isOverdue = c.due_date && new Date(c.due_date) < now;
        const notCompleted = c.status !== "completed" && c.status !== "done";
        if (isOverdue && notCompleted) {
          slippingCommitments.push({
            id: `commit:${r.id}:${c.text.slice(0, 20)}`,
            title: c.text,
            owner: c.owner ?? r.member_name ?? null,
            source_type: "meeting_note",
            source_id: String(r.id),
            age_days: ageDays(c.due_date),
            last_activity_at: c.updated_at ?? r.created_at,
            risk_reason: `Commitment due ${ageDays(c.due_date)} day(s) ago with no completion`,
            suggested_next_step: "Check in on progress or convert to action item",
            linked_action_id: null,
            metadata: { due_date: c.due_date, status: c.status },
          });
        }
      }
    }
  } catch (_e) { /* one_on_one_sections may not exist */ }

  const slipping_commitments: ExecutionSection = {
    key: "slipping_commitments",
    title: "Slipping Commitments",
    severity: slippingCommitments.length > 3 ? "urgent" : slippingCommitments.length > 0 ? "watch" : "info",
    items: slippingCommitments.slice(0, 20),
    empty_state: "No slipping commitments detected",
    reason: slippingCommitments.length > 0
      ? `${slippingCommitments.length} commitment(s) past due date without completion`
      : "Commitments appear on track",
  };

  // ── Section: stale_tasks ──────────────────────────────────────────────────
  const staleTaskItems: ExecutionItem[] = [];
  try {
    const staleTasks = await db.execute(sql.raw(`
      SELECT t.id, t.title, t.status, t.due_date, t.updated_at, t.created_at,
             u.name AS owner_name
      FROM tasks t
      LEFT JOIN users u ON u.id = t.owner_user_id
      WHERE t.status NOT IN ('done', 'completed', 'cancelled')
        AND t.updated_at < NOW() - INTERVAL '${DRIFT_THRESHOLDS.task_stale_days} days'
      ORDER BY t.updated_at ASC
      LIMIT 25
    `));
    for (const r of safeRows(staleTasks)) {
      staleTaskItems.push({
        id: `task:${r.id}`,
        title: r.title,
        owner: r.owner_name ?? null,
        source_type: "task",
        source_id: String(r.id),
        age_days: ageDays(r.updated_at),
        last_activity_at: r.updated_at,
        risk_reason: `No activity for ${ageDays(r.updated_at)} days`,
        suggested_next_step: "Follow up or close if no longer relevant",
        linked_action_id: null,
        metadata: { status: r.status, due_date: r.due_date },
      });
    }
  } catch (_e) { /* tasks table structure issue */ }

  const stale_tasks: ExecutionSection = {
    key: "stale_tasks",
    title: "Stale Tasks",
    severity: staleTaskItems.length > 10 ? "urgent" : staleTaskItems.length > 0 ? "watch" : "info",
    items: staleTaskItems.slice(0, 20),
    empty_state: "No stale tasks found",
    reason: staleTaskItems.length > 0
      ? `${staleTaskItems.length} task(s) with no activity in ${DRIFT_THRESHOLDS.task_stale_days}+ days`
      : "Tasks are actively maintained",
  };

  // ── Section: repeated_snoozes ─────────────────────────────────────────────
  const snoozedItems: ExecutionItem[] = [];
  try {
    const snoozed = await db.execute(sql.raw(`
      SELECT id, title, priority, snooze_count, snoozed_until, due_at, updated_at, source_type, source_id
      FROM ceo_action_queue
      WHERE status NOT IN ('completed', 'dismissed')
        AND snooze_count >= ${DRIFT_THRESHOLDS.action_snooze_repeat}
      ORDER BY snooze_count DESC, priority DESC
      LIMIT 20
    `));
    for (const r of safeRows(snoozed)) {
      snoozedItems.push({
        id: `snoozed-action:${r.id}`,
        title: r.title,
        owner: null,
        source_type: r.source_type ?? "action_queue",
        source_id: String(r.id),
        age_days: ageDays(r.due_at ?? r.updated_at),
        last_activity_at: r.updated_at,
        risk_reason: `Snoozed ${r.snooze_count} times — may be drifting`,
        suggested_next_step: "Address or escalate — repeated snooze indicates friction",
        linked_action_id: r.id,
        metadata: { snooze_count: r.snooze_count, priority: r.priority },
      });
    }
  } catch (_e) { /* snooze_count column may not exist */ }

  const repeated_snoozes: ExecutionSection = {
    key: "repeated_snoozes",
    title: "Repeated Snoozes",
    severity: snoozedItems.length > 5 ? "watch" : "info",
    items: snoozedItems,
    empty_state: "No repeatedly snoozed items",
    reason: snoozedItems.length > 0
      ? `${snoozedItems.length} item(s) snoozed ${DRIFT_THRESHOLDS.action_snooze_repeat}+ times`
      : "No persistent snooze patterns",
  };

  // ── Section: unresolved_blockers ──────────────────────────────────────────
  const unresolvedBlockers: ExecutionItem[] = [];
  try {
    const blockers = await db.execute(sql.raw(`
      SELECT t.id, t.title, t.updated_at, t.created_at, u.name AS owner_name
      FROM tasks t
      LEFT JOIN users u ON u.id = t.owner_user_id
      WHERE t.status = 'blocked'
        OR (t.blockers IS NOT NULL AND t.blockers <> '')
      ORDER BY t.updated_at ASC
      LIMIT 20
    `));
    for (const r of safeRows(blockers)) {
      unresolvedBlockers.push({
        id: `blocker:${r.id}`,
        title: r.title,
        owner: r.owner_name ?? null,
        source_type: "task",
        source_id: String(r.id),
        age_days: ageDays(r.updated_at),
        last_activity_at: r.updated_at,
        risk_reason: "Marked as blocked",
        suggested_next_step: "Identify what is needed to clear the blocker",
        linked_action_id: null,
        metadata: {},
      });
    }
  } catch (_e) { /* blockers column */ }

  const unresolved_blockers: ExecutionSection = {
    key: "unresolved_blockers",
    title: "Unresolved Blockers",
    severity: unresolvedBlockers.length > 5 ? "urgent" : unresolvedBlockers.length > 0 ? "watch" : "info",
    items: unresolvedBlockers.slice(0, 20),
    empty_state: "No active blockers",
    reason: unresolvedBlockers.length > 0
      ? `${unresolvedBlockers.length} blocker(s) preventing progress`
      : "No blockers detected",
  };

  // ── Section: stale_opportunities ─────────────────────────────────────────
  const staleOpps: ExecutionItem[] = [];
  try {
    const opps = await db.execute(sql.raw(`
      SELECT o.id, o.title, o.stage, o.expected_close_date, o.updated_at,
             u.name AS owner_name
      FROM opportunities o
      LEFT JOIN users u ON u.id = o.owner_user_id
      WHERE o.stage NOT IN ('closed_won', 'closed_lost')
        AND o.updated_at < NOW() - INTERVAL '${DRIFT_THRESHOLDS.opp_stale_days} days'
      ORDER BY o.updated_at ASC
      LIMIT 20
    `));
    for (const r of safeRows(opps)) {
      const pastClose = r.expected_close_date && new Date(r.expected_close_date) < now;
      staleOpps.push({
        id: `opp:${r.id}`,
        title: r.title,
        owner: r.owner_name ?? null,
        source_type: "opportunity",
        source_id: String(r.id),
        age_days: ageDays(r.updated_at),
        last_activity_at: r.updated_at,
        risk_reason: pastClose
          ? `Past expected close date and no activity for ${ageDays(r.updated_at)} days`
          : `No activity for ${ageDays(r.updated_at)} days`,
        suggested_next_step: "Update stage or add a note on current status",
        linked_action_id: null,
        metadata: { stage: r.stage, expected_close_date: r.expected_close_date },
      });
    }
  } catch (_e) { /* opportunities table issue */ }

  const stale_opportunities: ExecutionSection = {
    key: "stale_opportunities",
    title: "Stale Opportunities",
    severity: staleOpps.length > 5 ? "watch" : "info",
    items: staleOpps.slice(0, 20),
    empty_state: "All opportunities have recent activity",
    reason: staleOpps.length > 0
      ? `${staleOpps.length} opportunity(ies) with no movement in ${DRIFT_THRESHOLDS.opp_stale_days}+ days`
      : "Pipeline is actively maintained",
  };

  // ── Section: owner_load_risk ──────────────────────────────────────────────
  const ownerLoadItems: ExecutionItem[] = [];
  try {
    const ownerLoad = await db.execute(sql.raw(`
      SELECT u.name AS owner_name, u.id AS owner_id,
             COUNT(*) FILTER (WHERE t.due_date < NOW()) AS overdue_count,
             COUNT(*) AS total_open
      FROM tasks t
      JOIN users u ON u.id = t.owner_user_id
      WHERE t.status NOT IN ('done', 'completed', 'cancelled')
      GROUP BY u.id, u.name
      HAVING COUNT(*) FILTER (WHERE t.due_date < NOW()) >= ${DRIFT_THRESHOLDS.owner_overdue_count}
      ORDER BY overdue_count DESC
      LIMIT 10
    `));
    for (const r of safeRows(ownerLoad)) {
      ownerLoadItems.push({
        id: `owner-load:${r.owner_id}`,
        title: `${r.owner_name} — ${r.overdue_count} overdue of ${r.total_open} open tasks`,
        owner: r.owner_name ?? null,
        source_type: "user",
        source_id: String(r.owner_id),
        age_days: 0,
        last_activity_at: null,
        risk_reason: `${r.overdue_count} overdue items may indicate support needed`,
        suggested_next_step: "Check in to identify prioritization or capacity issues",
        linked_action_id: null,
        metadata: { overdue_count: Number(r.overdue_count), total_open: Number(r.total_open) },
      });
    }
  } catch (_e) { /* query issue */ }

  const owner_load_risk: ExecutionSection = {
    key: "owner_load_risk",
    title: "Owner Load Risk",
    severity: ownerLoadItems.length > 0 ? "watch" : "info",
    items: ownerLoadItems,
    empty_state: "No owner load risk detected",
    reason: ownerLoadItems.length > 0
      ? `${ownerLoadItems.length} team member(s) may need prioritization support`
      : "Load distribution looks manageable",
  };

  // ── Section: recurring_risks ──────────────────────────────────────────────
  const recurringRisks = await buildRecurringRiskPatternsInternal(actorUser);

  const recurring_risks: ExecutionSection = {
    key: "recurring_risks",
    title: "Recurring Risk Patterns",
    severity: recurringRisks.length > 3 ? "watch" : "info",
    items: recurringRisks.slice(0, 15),
    empty_state: "No recurring risk patterns detected",
    reason: recurringRisks.length > 0
      ? `${recurringRisks.length} recurring pattern(s) detected`
      : "Execution patterns look healthy",
  };

  // ── Section: execution_wins ────────────────────────────────────────────────
  const wins: ExecutionItem[] = [];
  try {
    const completedActions = await db.execute(sql.raw(`
      SELECT id, title, priority, updated_at, source_type, source_id
      FROM ceo_action_queue
      WHERE status = 'completed'
        AND updated_at > NOW() - INTERVAL '7 days'
        AND priority IN ('critical', 'high')
      ORDER BY updated_at DESC
      LIMIT 10
    `));
    for (const r of safeRows(completedActions)) {
      wins.push({
        id: `win-action:${r.id}`,
        title: r.title,
        owner: null,
        source_type: r.source_type ?? "action_queue",
        source_id: String(r.id),
        age_days: 0,
        last_activity_at: r.updated_at,
        risk_reason: "",
        suggested_next_step: "",
        linked_action_id: r.id,
        metadata: { priority: r.priority },
      });
    }
  } catch (_e) { /* */ }

  const execution_wins: ExecutionSection = {
    key: "execution_wins",
    title: "Execution Wins",
    severity: "info",
    items: wins.slice(0, 10),
    empty_state: "No recent high-priority completions",
    reason: wins.length > 0
      ? `${wins.length} high-priority item(s) completed this week`
      : "Complete high-priority items to see wins here",
  };

  // ── Section: recommended_interventions ───────────────────────────────────
  const interventions: ExecutionRadarResult["recommended_interventions"] = [];

  if (criticalItems.length > 0) {
    interventions.push({
      title: `Clear ${criticalItems.length} overdue critical action(s)`,
      reason: "Critical actions directly block team progress",
      severity: "critical",
      suggested_action: "Review and resolve or delegate each overdue critical item",
      source_type: "action_queue",
      source_id: null,
    });
  }
  if (slippingCommitments.length > 0) {
    interventions.push({
      title: `Follow up on ${slippingCommitments.length} slipping commitment(s)`,
      reason: "Commitments made in 1:1s and meetings are past due",
      severity: "urgent",
      suggested_action: "Schedule check-ins with commitment owners",
      source_type: "commitments",
      source_id: null,
    });
  }
  if (unresolvedBlockers.length > 5) {
    interventions.push({
      title: `Address ${unresolvedBlockers.length} active blocker(s)`,
      reason: "High blocker count signals team is stuck",
      severity: "urgent",
      suggested_action: "Run a blocker-clearing session with affected teams",
      source_type: "tasks",
      source_id: null,
    });
  }
  if (ownerLoadItems.length > 0) {
    interventions.push({
      title: `Check in with ${ownerLoadItems.length} overloaded team member(s)`,
      reason: "Multiple overdue items may indicate capacity or prioritization support needed",
      severity: "watch",
      suggested_action: "Schedule brief check-in to identify what support is needed",
      source_type: "users",
      source_id: null,
    });
  }

  return {
    generated_at: now.toISOString(),
    sections: {
      critical_drift,
      slipping_commitments,
      stale_tasks,
      repeated_snoozes,
      unresolved_blockers,
      stale_opportunities,
      owner_load_risk,
      recurring_risks,
      execution_wins,
    },
    recommended_interventions: interventions,
  };
}

// ── 2. detectExecutionDrift ────────────────────────────────────────────────────

export interface DriftResult {
  generated_at: string;
  drift_items: ExecutionItem[];
  total_count: number;
  by_severity: Record<ExecutionSeverity, number>;
}

export async function detectExecutionDrift(
  actorUser: ExecutionActorUser,
  _options: Record<string, any> = {}
): Promise<DriftResult> {
  const now = new Date();
  const items: Array<ExecutionItem & { severity: ExecutionSeverity }> = [];

  // Critical: overdue high/critical action queue items
  try {
    const rows = await db.execute(sql.raw(`
      SELECT id, title, priority, due_at, updated_at, source_type, source_id
      FROM ceo_action_queue
      WHERE status NOT IN ('completed', 'dismissed')
        AND priority IN ('critical', 'high')
        AND due_at IS NOT NULL AND due_at < NOW()
      ORDER BY due_at ASC LIMIT 20
    `));
    for (const r of safeRows(rows)) {
      items.push({
        id: `drift-action:${r.id}`,
        title: r.title,
        owner: null,
        source_type: r.source_type ?? "action_queue",
        source_id: String(r.id),
        age_days: ageDays(r.due_at),
        last_activity_at: r.updated_at,
        risk_reason: `Overdue ${r.priority} action (${ageDays(r.due_at)}d past due)`,
        suggested_next_step: "Resolve or escalate",
        linked_action_id: r.id,
        metadata: { priority: r.priority },
        severity: r.priority === "critical" ? "critical" : "urgent",
      });
    }
  } catch (_e) { /* */ }

  // Stale committed tasks — blocked for 3+ days with no update
  try {
    const rows = await db.execute(sql.raw(`
      SELECT t.id, t.title, t.updated_at, u.name AS owner_name
      FROM tasks t
      LEFT JOIN users u ON u.id = t.owner_user_id
      WHERE (t.status = 'blocked' OR (t.blockers IS NOT NULL AND t.blockers <> ''))
        AND t.updated_at < NOW() - INTERVAL '${DRIFT_THRESHOLDS.task_blocked_no_update_days} days'
      ORDER BY t.updated_at ASC LIMIT 15
    `));
    for (const r of safeRows(rows)) {
      items.push({
        id: `drift-blocked:${r.id}`,
        title: r.title,
        owner: r.owner_name ?? null,
        source_type: "task",
        source_id: String(r.id),
        age_days: ageDays(r.updated_at),
        last_activity_at: r.updated_at,
        risk_reason: `Blocked task with no update for ${ageDays(r.updated_at)} days`,
        suggested_next_step: "Escalate or unblock",
        linked_action_id: null,
        metadata: {},
        severity: "urgent",
      });
    }
  } catch (_e) { /* */ }

  // Stale tasks (no update 7+ days)
  try {
    const rows = await db.execute(sql.raw(`
      SELECT t.id, t.title, t.due_date, t.updated_at, u.name AS owner_name
      FROM tasks t
      LEFT JOIN users u ON u.id = t.owner_user_id
      WHERE t.status NOT IN ('done', 'completed', 'cancelled')
        AND t.updated_at < NOW() - INTERVAL '${DRIFT_THRESHOLDS.task_stale_days} days'
      ORDER BY t.updated_at ASC LIMIT 20
    `));
    for (const r of safeRows(rows)) {
      const overdue = r.due_date && new Date(r.due_date) < now;
      items.push({
        id: `drift-stale:${r.id}`,
        title: r.title,
        owner: r.owner_name ?? null,
        source_type: "task",
        source_id: String(r.id),
        age_days: ageDays(r.updated_at),
        last_activity_at: r.updated_at,
        risk_reason: overdue
          ? `Overdue and stale (${ageDays(r.updated_at)}d no activity)`
          : `No activity for ${ageDays(r.updated_at)} days`,
        suggested_next_step: overdue ? "Close or reassign" : "Follow up on status",
        linked_action_id: null,
        metadata: { due_date: r.due_date },
        severity: overdue ? "watch" : "info",
      });
    }
  } catch (_e) { /* */ }

  // Repeated snoozes
  try {
    const rows = await db.execute(sql.raw(`
      SELECT id, title, priority, snooze_count, updated_at, source_type, source_id
      FROM ceo_action_queue
      WHERE status NOT IN ('completed', 'dismissed')
        AND snooze_count >= ${DRIFT_THRESHOLDS.action_snooze_repeat}
      ORDER BY snooze_count DESC LIMIT 10
    `));
    for (const r of safeRows(rows)) {
      items.push({
        id: `drift-snooze:${r.id}`,
        title: r.title,
        owner: null,
        source_type: r.source_type ?? "action_queue",
        source_id: String(r.id),
        age_days: ageDays(r.updated_at),
        last_activity_at: r.updated_at,
        risk_reason: `Snoozed ${r.snooze_count} times — drifting without resolution`,
        suggested_next_step: "Address root cause or close",
        linked_action_id: r.id,
        metadata: { snooze_count: r.snooze_count, priority: r.priority },
        severity: r.priority === "high" ? "watch" : "info",
      });
    }
  } catch (_e) { /* */ }

  const bySeverity: Record<ExecutionSeverity, number> = { info: 0, watch: 0, urgent: 0, critical: 0 };
  for (const item of items) {
    bySeverity[item.severity] = (bySeverity[item.severity] ?? 0) + 1;
  }

  // Sort by severity
  const order: Record<ExecutionSeverity, number> = { critical: 0, urgent: 1, watch: 2, info: 3 };
  items.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    generated_at: now.toISOString(),
    drift_items: items.map(({ severity: _s, ...rest }) => rest),
    total_count: items.length,
    by_severity: bySeverity,
  };
}

// ── 3. buildCommitmentsRadar ───────────────────────────────────────────────────

export interface CommitmentItem {
  id: string;
  text: string;
  owner: string | null;
  source_type: string;
  source_id: string | null;
  due_date: string | null;
  status: string;
  linked_task_id: number | null;
  age_days: number;
  risk_reason: string;
  suggested_ceo_action: string;
}

export interface CommitmentsRadarResult {
  generated_at: string;
  sections: {
    due_today: CommitmentItem[];
    due_this_week: CommitmentItem[];
    overdue: CommitmentItem[];
    no_owner: CommitmentItem[];
    no_due_date: CommitmentItem[];
    accepted_not_tasked: CommitmentItem[];
    tasked_not_completed: CommitmentItem[];
    completed: CommitmentItem[];
    recurring_commitments: CommitmentItem[];
  };
}

export async function buildCommitmentsRadar(
  _actorUser: ExecutionActorUser,
  _options: Record<string, any> = {}
): Promise<CommitmentsRadarResult> {
  const now = new Date();
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const allCommitments: CommitmentItem[] = [];

  // Pull from meeting_notes.one_on_one_sections
  try {
    const rows = await db.execute(sql.raw(`
      SELECT mn.id, mn.one_on_one_sections, mn.created_at, u.name AS member_name
      FROM meeting_notes mn
      LEFT JOIN users u ON u.id = mn.user_id
      WHERE mn.one_on_one_sections IS NOT NULL
      ORDER BY mn.created_at DESC
      LIMIT 100
    `));

    const textSeen = new Map<string, number>();

    for (const r of safeRows(rows)) {
      const sections: any = r.one_on_one_sections ?? {};
      const commits: any[] = sections.commitments ?? [];
      for (const c of commits) {
        if (!c?.text) continue;
        const key = `${c.owner ?? r.member_name ?? ""}:${c.text}`;
        textSeen.set(key, (textSeen.get(key) ?? 0) + 1);

        const dueDate = c.due_date ? new Date(c.due_date) : null;
        const isCompleted = c.status === "completed" || c.status === "done";

        allCommitments.push({
          id: `commit:${r.id}:${c.text.slice(0, 20).replace(/\s/g, "-")}`,
          text: c.text,
          owner: c.owner ?? r.member_name ?? null,
          source_type: "meeting_note",
          source_id: String(r.id),
          due_date: c.due_date ?? null,
          status: c.status ?? "pending",
          linked_task_id: c.linked_task_id ?? null,
          age_days: dueDate ? ageDays(c.due_date) : ageDays(r.created_at),
          risk_reason: !c.owner ? "No owner assigned" : isCompleted ? "Completed" : dueDate && dueDate < now ? "Overdue" : "",
          suggested_ceo_action: !c.owner
            ? "Assign an owner"
            : isCompleted
              ? "No action needed"
              : dueDate && dueDate < now
                ? "Check in on status"
                : "Monitor progress",
        });
      }

      // Mark recurring (seen in multiple notes)
      for (const item of allCommitments) {
        const key = `${item.owner ?? ""}:${item.text}`;
        if ((textSeen.get(key) ?? 0) > 1) {
          (item as any).__recurring = true;
        }
      }
    }
  } catch (_e) { /* */ }

  // Also pull from action queue commitments
  try {
    const rows = await db.execute(sql.raw(`
      SELECT id, title, status, due_at, created_at, source_type, source_id, assigned_to_user_id
      FROM ceo_action_queue
      WHERE type = 'commitment' OR source_section = 'commitments'
      ORDER BY created_at DESC LIMIT 50
    `));
    for (const r of safeRows(rows)) {
      const dueDate = r.due_at ? new Date(r.due_at) : null;
      allCommitments.push({
        id: `action-commit:${r.id}`,
        text: r.title,
        owner: null,
        source_type: r.source_type ?? "action_queue",
        source_id: String(r.id),
        due_date: r.due_at ?? null,
        status: r.status ?? "open",
        linked_task_id: null,
        age_days: dueDate ? ageDays(r.due_at) : ageDays(r.created_at),
        risk_reason: dueDate && dueDate < now && r.status !== "completed" ? "Overdue" : "",
        suggested_ceo_action: "Monitor or escalate",
      });
    }
  } catch (_e) { /* */ }

  // Classify into groups
  const due_today: CommitmentItem[] = [];
  const due_this_week: CommitmentItem[] = [];
  const overdue: CommitmentItem[] = [];
  const no_owner: CommitmentItem[] = [];
  const no_due_date: CommitmentItem[] = [];
  const accepted_not_tasked: CommitmentItem[] = [];
  const tasked_not_completed: CommitmentItem[] = [];
  const completed: CommitmentItem[] = [];
  const recurring_commitments: CommitmentItem[] = [];

  for (const c of allCommitments) {
    if ((c as any).__recurring) recurring_commitments.push(c);
    if (c.status === "completed" || c.status === "done") { completed.push(c); continue; }
    if (!c.owner) { no_owner.push(c); }
    if (!c.due_date) { no_due_date.push(c); continue; }
    const d = new Date(c.due_date);
    if (d < now) { overdue.push(c); }
    else if (d <= todayEnd) { due_today.push(c); }
    else if (d <= weekEnd) { due_this_week.push(c); }

    if (!c.linked_task_id && c.status !== "completed") { accepted_not_tasked.push(c); }
    if (c.linked_task_id && c.status !== "completed") { tasked_not_completed.push(c); }
  }

  return {
    generated_at: now.toISOString(),
    sections: {
      due_today: due_today.slice(0, 20),
      due_this_week: due_this_week.slice(0, 20),
      overdue: overdue.slice(0, 20),
      no_owner: no_owner.slice(0, 20),
      no_due_date: no_due_date.slice(0, 20),
      accepted_not_tasked: accepted_not_tasked.slice(0, 20),
      tasked_not_completed: tasked_not_completed.slice(0, 20),
      completed: completed.slice(0, 20),
      recurring_commitments: recurring_commitments.slice(0, 20),
    },
  };
}

// ── 4. buildRecurringRiskPatterns (public + internal helper) ──────────────────

async function buildRecurringRiskPatternsInternal(_actorUser: ExecutionActorUser): Promise<ExecutionItem[]> {
  const items: ExecutionItem[] = [];

  // Owners with 3+ overdue tasks
  try {
    const rows = await db.execute(sql.raw(`
      SELECT u.id AS owner_id, u.name AS owner_name, COUNT(*) AS overdue_count
      FROM tasks t
      JOIN users u ON u.id = t.owner_user_id
      WHERE t.status NOT IN ('done', 'completed', 'cancelled')
        AND t.due_date IS NOT NULL AND t.due_date < NOW()
      GROUP BY u.id, u.name
      HAVING COUNT(*) >= ${DRIFT_THRESHOLDS.owner_overdue_count}
      ORDER BY overdue_count DESC
      LIMIT 10
    `));
    for (const r of safeRows(rows)) {
      items.push({
        id: `recurring-owner:${r.owner_id}`,
        title: `${r.owner_name} — ${r.overdue_count} recurring overdue tasks`,
        owner: r.owner_name ?? null,
        source_type: "user",
        source_id: String(r.owner_id),
        age_days: 0,
        last_activity_at: null,
        risk_reason: `Same owner has ${r.overdue_count} overdue items — recurring pattern`,
        suggested_next_step: "Check in to identify root cause and offer support",
        linked_action_id: null,
        metadata: { overdue_count: Number(r.overdue_count), pattern_type: "owner_overdue" },
      });
    }
  } catch (_e) { /* */ }

  // Same source_type/source producing repeated blockers in action queue
  try {
    const rows = await db.execute(sql.raw(`
      SELECT source_type, source_id, COUNT(*) AS blocker_count
      FROM ceo_action_queue
      WHERE status NOT IN ('completed', 'dismissed')
        AND source_type IS NOT NULL AND source_id IS NOT NULL
      GROUP BY source_type, source_id
      HAVING COUNT(*) >= 3
      ORDER BY blocker_count DESC
      LIMIT 10
    `));
    for (const r of safeRows(rows)) {
      items.push({
        id: `recurring-source:${r.source_type}:${r.source_id}`,
        title: `${r.source_type} (id:${r.source_id}) — ${r.blocker_count} open actions`,
        owner: null,
        source_type: r.source_type,
        source_id: r.source_id,
        age_days: 0,
        last_activity_at: null,
        risk_reason: `Same source has generated ${r.blocker_count} unresolved actions — repeated friction`,
        suggested_next_step: "Investigate root cause for this source",
        linked_action_id: null,
        metadata: { blocker_count: Number(r.blocker_count), pattern_type: "source_repeated" },
      });
    }
  } catch (_e) { /* */ }

  return items;
}

export interface RecurringRiskResult {
  generated_at: string;
  patterns: ExecutionItem[];
  summary: string;
}

export async function buildRecurringRiskPatterns(
  actorUser: ExecutionActorUser,
  _options: Record<string, any> = {}
): Promise<RecurringRiskResult> {
  const patterns = await buildRecurringRiskPatternsInternal(actorUser);
  return {
    generated_at: new Date().toISOString(),
    patterns,
    summary: patterns.length > 0
      ? `${patterns.length} recurring risk pattern(s) detected — same owners or sources repeatedly generating unresolved items`
      : "No recurring risk patterns detected",
  };
}

// ── 5. buildExecutionScorecard ────────────────────────────────────────────────

export interface ScorecardResult {
  generated_at: string;
  score: number;
  label: "Strong" | "Watch" | "At Risk" | "Critical";
  reason: string;
  contributing_factors: Array<{ label: string; value: number; penalty: number }>;
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
    owner_load_distribution: Array<{ owner: string; overdue: number; total: number }>;
    execution_health_score: number;
  };
  disclaimer: string;
}

export async function buildExecutionScorecard(
  actorUser: ExecutionActorUser,
  _options: Record<string, any> = {}
): Promise<ScorecardResult> {
  const now = new Date();
  const T = DRIFT_THRESHOLDS;

  // Gather raw metrics
  let openCeoActions = 0;
  let overdueCeoActions = 0;
  let completedThisWeek = 0;
  let dismissedThisWeek = 0;
  let snoozedActive = 0;
  let criticalDriftCount = 0;
  let highActionOverdue = 0;
  let repeatedSnoozes = 0;

  try {
    const r = await db.execute(sql.raw(`
      SELECT
        COUNT(*) FILTER (WHERE status NOT IN ('completed','dismissed'))                              AS open_count,
        COUNT(*) FILTER (WHERE status NOT IN ('completed','dismissed') AND due_at < NOW())          AS overdue_count,
        COUNT(*) FILTER (WHERE status = 'completed' AND updated_at > NOW() - INTERVAL '7 days')     AS completed_week,
        COUNT(*) FILTER (WHERE status = 'dismissed' AND updated_at > NOW() - INTERVAL '7 days')     AS dismissed_week,
        COUNT(*) FILTER (WHERE status = 'snoozed')                                                  AS snoozed_count,
        COUNT(*) FILTER (WHERE status NOT IN ('completed','dismissed') AND priority IN ('critical','high') AND due_at IS NOT NULL AND due_at < NOW()) AS crit_overdue,
        COUNT(*) FILTER (WHERE status NOT IN ('completed','dismissed') AND priority = 'high' AND due_at IS NOT NULL AND due_at < NOW()) AS high_overdue,
        COUNT(*) FILTER (WHERE snooze_count >= ${T.action_snooze_repeat} AND status NOT IN ('completed','dismissed')) AS repeated_snooze_count
      FROM ceo_action_queue
    `));
    const row = safeRows(r)[0] ?? {};
    openCeoActions = Number(row.open_count ?? 0);
    overdueCeoActions = Number(row.overdue_count ?? 0);
    completedThisWeek = Number(row.completed_week ?? 0);
    dismissedThisWeek = Number(row.dismissed_week ?? 0);
    snoozedActive = Number(row.snoozed_count ?? 0);
    criticalDriftCount = Number(row.crit_overdue ?? 0);
    highActionOverdue = Number(row.high_overdue ?? 0);
    repeatedSnoozes = Number(row.repeated_snooze_count ?? 0);
  } catch (_e) { /* */ }

  let openBlockers = 0;
  let blockersResolvedThisWeek = 0;
  let staleTaskCount = 0;

  try {
    const r = await db.execute(sql.raw(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'blocked' OR (blockers IS NOT NULL AND blockers <> ''))   AS open_blockers,
        COUNT(*) FILTER (WHERE status NOT IN ('done','completed','cancelled') AND updated_at < NOW() - INTERVAL '${T.task_stale_days} days') AS stale_count
      FROM tasks
    `));
    const row = safeRows(r)[0] ?? {};
    openBlockers = Number(row.open_blockers ?? 0);
    staleTaskCount = Number(row.stale_count ?? 0);
  } catch (_e) { /* */ }

  try {
    const r = await db.execute(sql.raw(`
      SELECT COUNT(*) AS resolved
      FROM tasks
      WHERE status IN ('done', 'completed')
        AND updated_at > NOW() - INTERVAL '7 days'
        AND (blockers IS NOT NULL OR status = 'blocked')
    `));
    blockersResolvedThisWeek = Number(safeRows(r)[0]?.resolved ?? 0);
  } catch (_e) { /* */ }

  let overdueCommitments = 0;
  let commitmentsCompletedThisWeek = 0;

  try {
    const r = await db.execute(sql.raw(`
      SELECT mn.one_on_one_sections
      FROM meeting_notes mn
      WHERE mn.one_on_one_sections IS NOT NULL
      ORDER BY mn.created_at DESC LIMIT 100
    `));
    for (const row of safeRows(r)) {
      const commits = (row.one_on_one_sections as any)?.commitments ?? [];
      for (const c of commits) {
        if (!c?.text) continue;
        if (c.due_date && new Date(c.due_date) < now && c.status !== "completed") overdueCommitments++;
        if (c.status === "completed" && c.updated_at && new Date(c.updated_at) > new Date(now.getTime() - 7 * 86400000)) commitmentsCompletedThisWeek++;
      }
    }
  } catch (_e) { /* */ }

  let staleOpps = 0;
  try {
    const r = await db.execute(sql.raw(`
      SELECT COUNT(*) AS stale
      FROM opportunities
      WHERE stage NOT IN ('closed_won', 'closed_lost')
        AND updated_at < NOW() - INTERVAL '${T.opp_stale_days} days'
    `));
    staleOpps = Number(safeRows(r)[0]?.stale ?? 0);
  } catch (_e) { /* */ }

  const ownerLoad: Array<{ owner: string; overdue: number; total: number }> = [];
  try {
    const r = await db.execute(sql.raw(`
      SELECT u.name AS owner_name,
             COUNT(*) FILTER (WHERE t.due_date < NOW()) AS overdue_count,
             COUNT(*) AS total_open
      FROM tasks t
      JOIN users u ON u.id = t.owner_user_id
      WHERE t.status NOT IN ('done', 'completed', 'cancelled')
      GROUP BY u.id, u.name
      ORDER BY overdue_count DESC
      LIMIT 10
    `));
    for (const r2 of safeRows(r)) {
      ownerLoad.push({ owner: r2.owner_name, overdue: Number(r2.overdue_count ?? 0), total: Number(r2.total_open ?? 0) });
    }
  } catch (_e) { /* */ }

  // Compute score
  const staleBlockersOld = Math.min(openBlockers, 10); // approximate
  let score = 100;
  const factors: ScorecardResult["contributing_factors"] = [];

  const critPenalty = Math.min(criticalDriftCount * T.scorecard_critical_penalty, T.scorecard_critical_max);
  if (critPenalty > 0) { score -= critPenalty; factors.push({ label: "Critical drift items", value: criticalDriftCount, penalty: critPenalty }); }

  const highPenalty = Math.min(highActionOverdue * T.scorecard_high_action_penalty, T.scorecard_high_action_max);
  if (highPenalty > 0) { score -= highPenalty; factors.push({ label: "Overdue high-priority actions", value: highActionOverdue, penalty: highPenalty }); }

  const commitPenalty = Math.min(overdueCommitments * T.scorecard_commitment_penalty, T.scorecard_commitment_max);
  if (commitPenalty > 0) { score -= commitPenalty; factors.push({ label: "Overdue commitments", value: overdueCommitments, penalty: commitPenalty }); }

  const blockerPenalty = Math.min(staleBlockersOld * T.scorecard_blocker_penalty, T.scorecard_blocker_max);
  if (blockerPenalty > 0) { score -= blockerPenalty; factors.push({ label: "Unresolved blockers", value: openBlockers, penalty: blockerPenalty }); }

  const stalePenalty = Math.min(staleTaskCount * T.scorecard_stale_task_penalty, T.scorecard_stale_task_max);
  if (stalePenalty > 0) { score -= stalePenalty; factors.push({ label: "Stale tasks", value: staleTaskCount, penalty: stalePenalty }); }

  const snoozePenalty = Math.min(repeatedSnoozes * T.scorecard_snooze_penalty, T.scorecard_snooze_max);
  if (snoozePenalty > 0) { score -= snoozePenalty; factors.push({ label: "Repeated snoozes", value: repeatedSnoozes, penalty: snoozePenalty }); }

  score = Math.max(0, Math.min(100, score));

  const label: ScorecardResult["label"] =
    score >= 80 ? "Strong" :
    score >= 60 ? "Watch" :
    score >= 40 ? "At Risk" : "Critical";

  const reason =
    score >= 80 ? "Execution is healthy with minimal drift or blockers" :
    score >= 60 ? "Some items need attention — monitor closely" :
    score >= 40 ? "Multiple risk signals detected — intervention recommended" :
    "Significant execution drift — immediate leadership attention needed";

  return {
    generated_at: now.toISOString(),
    score,
    label,
    reason,
    contributing_factors: factors,
    metrics: {
      open_ceo_actions: openCeoActions,
      overdue_ceo_actions: overdueCeoActions,
      completed_this_week: completedThisWeek,
      dismissed_this_week: dismissedThisWeek,
      snoozed_active: snoozedActive,
      open_blockers: openBlockers,
      blockers_resolved_this_week: blockersResolvedThisWeek,
      overdue_commitments: overdueCommitments,
      commitments_completed_this_week: commitmentsCompletedThisWeek,
      stale_tasks: staleTaskCount,
      stale_opportunities: staleOpps,
      owner_load_distribution: ownerLoad,
      execution_health_score: score,
    },
    disclaimer:
      "This score is a simple operational indicator, not a scientific measurement. Use it as a directional guide only.",
  };
}

// ── Re-export createCeoAction for route use ────────────────────────────────────
export { createCeoAction };
export type { CreateActionInput };
