/**
 * Certification Tracker Alert Engine
 * Phase 1 — Evaluation
 * Phase 2 — Outputs (notifications, tasks, executive alerts)
 * Phase 3 — Dedupe / cooldown
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

// ── Types ──────────────────────────────────────────────────────────────────────

export type AlertType = "failed_test" | "blocker" | "retest_required" | "cert_risk" | "due_soon";
export type AlertSeverity = "low" | "medium" | "high" | "critical";

export interface SheetSyncSnapshot {
  total: number;
  passed: number;
  failed: number;
  inProgress: number;
  pending: number;
  blockerCount: number;
  retestCount: number;
  dueSoonCount: number;
  alertConditions: {
    failedTest: boolean;
    blocker: boolean;
    retestRequired: boolean;
    certRisk: boolean;
  };
}

export interface AlertHooks {
  failedTestAlert?: boolean;
  blockerAlert?: boolean;
  retestAlert?: boolean;
  riskAlert?: boolean;
  dueSoonAlert?: boolean;
  dueSoonThreshold?: number;    // default 5
  cooldownHours?: number;       // default 24
  createTask?: boolean;
  createNotification?: boolean;
  addTimeline?: boolean;
}

export interface AlertConditionState {
  triggered: boolean;
  at: string | null;            // ISO timestamp of last trigger
  count: number;                // value at last trigger (e.g. failed count)
}

export interface AlertState {
  lastEvalAt: string;
  conditions: Partial<Record<AlertType, AlertConditionState>>;
}

export interface EvaluatedAlert {
  alertType: AlertType;
  severity: AlertSeverity;
  title: string;
  body: string;
  triggered: boolean;
  cooledDown: boolean;          // true = condition met but within cooldown window
  changed: boolean;             // condition changed since last eval
  currentCount: number;
}

// ── PHASE 1 — Evaluate conditions ─────────────────────────────────────────────

export function evaluateConditions(
  sync: SheetSyncSnapshot,
  hooks: AlertHooks,
  prevState: AlertState | null,
): EvaluatedAlert[] {
  const cooldownMs = (hooks.cooldownHours ?? 24) * 60 * 60 * 1000;
  const now = Date.now();
  const dueSoonThreshold = hooks.dueSoonThreshold ?? 5;

  function check(
    alertType: AlertType,
    hookEnabled: boolean | undefined,
    conditionMet: boolean,
    severity: AlertSeverity,
    title: string,
    body: string,
    currentCount: number,
  ): EvaluatedAlert {
    if (!hookEnabled) {
      return { alertType, severity, title, body, triggered: false, cooledDown: false, changed: false, currentCount };
    }

    const prev = prevState?.conditions?.[alertType];
    const prevCount = prev?.count ?? 0;
    const prevTriggered = prev?.triggered ?? false;
    const lastAt = prev?.at ? new Date(prev.at).getTime() : 0;
    const withinCooldown = (now - lastAt) < cooldownMs;

    // "Changed materially" = condition transitioned OFF→ON, or count grew by >0
    const changed = (!prevTriggered && conditionMet) ||
                    (conditionMet && currentCount > prevCount);

    const cooledDown = conditionMet && !changed && withinCooldown;
    const triggered = conditionMet && changed && !withinCooldown;

    return { alertType, severity, title, body, triggered, cooledDown, changed, currentCount };
  }

  return [
    check(
      "failed_test",
      hooks.failedTestAlert,
      sync.failed > 0,
      sync.failed >= 3 ? "high" : "medium",
      `${sync.failed} Failed Test${sync.failed !== 1 ? "s" : ""} Detected`,
      `${sync.failed} of ${sync.total} tests are currently failing in the Live Test Tracker.`,
      sync.failed,
    ),
    check(
      "blocker",
      hooks.blockerAlert,
      sync.blockerCount > 0,
      sync.blockerCount >= 2 ? "critical" : "high",
      `${sync.blockerCount} Test Blocker${sync.blockerCount !== 1 ? "s" : ""} Flagged`,
      `${sync.blockerCount} blocker${sync.blockerCount !== 1 ? "s" : ""} found in the tracker — immediate attention required to avoid cert delay.`,
      sync.blockerCount,
    ),
    check(
      "retest_required",
      hooks.retestAlert,
      sync.retestCount > 0,
      "medium",
      `${sync.retestCount} Retest${sync.retestCount !== 1 ? "s" : ""} Required`,
      `${sync.retestCount} test item${sync.retestCount !== 1 ? "s" : ""} have been flagged for retest in the Live Test Tracker.`,
      sync.retestCount,
    ),
    check(
      "cert_risk",
      hooks.riskAlert,
      sync.alertConditions.certRisk,
      "high",
      "Certification Risk Rising",
      `Combined signal: failed tests (${sync.failed}), blockers (${sync.blockerCount}), and retests (${sync.retestCount}) indicate elevated cert risk.`,
      sync.failed + sync.blockerCount + sync.retestCount,
    ),
    check(
      "due_soon",
      hooks.dueSoonAlert,
      sync.dueSoonCount >= dueSoonThreshold,
      "medium",
      `${sync.dueSoonCount} Test${sync.dueSoonCount !== 1 ? "s" : ""} Due Within 7 Days`,
      `${sync.dueSoonCount} test${sync.dueSoonCount !== 1 ? "s" : ""} are due within 7 days. Review the tracker to avoid missing deadlines.`,
      sync.dueSoonCount,
    ),
  ];
}

// ── PHASE 2 — Alert outputs ────────────────────────────────────────────────────

interface OutputContext {
  projectId: number;
  projectName: string;
  userId: number;       // user who triggered the sync (receives notifications / tasks)
  gid?: string;
}

export interface AlertRunResult {
  evaluated: EvaluatedAlert[];
  triggered: AlertType[];
  cooledDown: AlertType[];
  notificationsCreated: number;
  tasksCreated: number;
  execAlertsCreated: number;
  newState: AlertState;
}

export async function runAlertEngine(
  ctx: OutputContext,
  sync: SheetSyncSnapshot,
  hooks: AlertHooks,
  prevState: AlertState | null,
): Promise<AlertRunResult> {
  const evaluated = evaluateConditions(sync, hooks, prevState);
  const triggered: AlertType[] = [];
  const cooledDown: AlertType[] = [];
  let notificationsCreated = 0;
  let tasksCreated = 0;
  let execAlertsCreated = 0;

  const nowIso = new Date().toISOString();
  const newConditions: AlertState["conditions"] = { ...(prevState?.conditions ?? {}) };

  for (const ev of evaluated) {
    if (ev.cooledDown) {
      cooledDown.push(ev.alertType);
      continue;
    }
    if (!ev.triggered) continue;

    triggered.push(ev.alertType);

    // Update state entry
    newConditions[ev.alertType] = {
      triggered: true,
      at: nowIso,
      count: ev.currentCount,
    };

    const projectUrl = `/projects/${ctx.projectId}?tab=live-tracker`;

    // ── Notification ─────────────────────────────────────────────────────────
    if (hooks.createNotification !== false) {
      const dedupeKey = `cert_alert_${ctx.projectId}_${ev.alertType}_${nowIso.slice(0, 10)}`;
      const sev = ev.severity === "critical" ? "high" : ev.severity;
      await db.execute(sql.raw(`
        INSERT INTO notifications (user_id, type, title, body, severity, linked_object_type, linked_object_id, action_url, is_read, dedupe_key, created_at)
        SELECT
          ${ctx.userId},
          'cert_tracker_alert',
          ${sqlStr(ev.title)},
          ${sqlStr(ev.body)},
          ${sqlStr(sev)},
          'project',
          ${ctx.projectId},
          ${sqlStr(projectUrl)},
          false,
          ${sqlStr(dedupeKey)},
          NOW()
        WHERE NOT EXISTS (
          SELECT 1 FROM notifications
          WHERE user_id = ${ctx.userId} AND dedupe_key = ${sqlStr(dedupeKey)}
        )
      `));
      notificationsCreated++;
    }

    // ── Task ─────────────────────────────────────────────────────────────────
    if (hooks.createTask !== false && (ev.severity === "high" || ev.severity === "critical")) {
      const taskTitle = `[Cert Alert] ${ev.title} — ${ctx.projectName}`;
      const taskDueIso = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      const sourceMeta = JSON.stringify({ alertType: ev.alertType, projectId: ctx.projectId, gid: ctx.gid ?? "" });
      await db.execute(sql.raw(`
        INSERT INTO tasks (linked_object_type, linked_object_id, owner_user_id, created_by_user_id, title, description, due_date, status, priority, source, source_label, source_meta, created_at, updated_at)
        VALUES (
          'project',
          ${ctx.projectId},
          ${ctx.userId},
          ${ctx.userId},
          ${sqlStr(taskTitle)},
          ${sqlStr(ev.body)},
          ${sqlStr(taskDueIso)},
          'pending',
          ${sqlStr(ev.severity === "critical" ? "critical" : "high")},
          'cert_alert',
          'Live Test Tracker Alert',
          ${sqlStr(sourceMeta)},
          NOW(),
          NOW()
        )
      `));
      tasksCreated++;
    }

    // ── Executive alert (high / critical only) ────────────────────────────────
    if (ev.severity === "high" || ev.severity === "critical") {
      await db.execute(sql.raw(`
        INSERT INTO executive_alerts (type, severity, title, description, linked_object_type, linked_object_id, status, suggested_move, created_at)
        VALUES (
          'cert_tracker_alert',
          ${sqlStr(ev.severity)},
          ${sqlStr(ev.title + " — " + ctx.projectName)},
          ${sqlStr(ev.body)},
          'project',
          ${ctx.projectId},
          'open',
          'Review the Live Test Tracker and address failing / blocked items immediately.',
          NOW()
        )
      `));
      execAlertsCreated++;
    }
  }

  // ── Persist new alert state ───────────────────────────────────────────────
  const newState: AlertState = { lastEvalAt: nowIso, conditions: newConditions };
  await db.execute(sql.raw(`
    UPDATE project_certifications
    SET tracker_alert_state = ${sqlStr(JSON.stringify(newState))},
        tracker_sheet_last_synced = NOW()
    WHERE project_id = ${ctx.projectId}
  `));

  return { evaluated, triggered, cooledDown, notificationsCreated, tasksCreated, execAlertsCreated, newState };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sqlStr(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

export function parseAlertState(raw: string | null | undefined): AlertState | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as AlertState; } catch { return null; }
}

export function getActiveAlerts(state: AlertState | null): AlertType[] {
  if (!state) return [];
  const cooldownMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  return (Object.entries(state.conditions) as [AlertType, AlertConditionState][])
    .filter(([, v]) => v.triggered && v.at && (now - new Date(v.at).getTime()) < cooldownMs)
    .map(([k]) => k);
}
