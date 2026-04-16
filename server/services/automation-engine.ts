/**
 * Automation Engine — Phases 2 & 3
 * Deterministic condition evaluation + action execution for automation rules.
 */
import { db } from "../db";
import { sql } from "drizzle-orm";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConditionOp =
  | "equals" | "not_equals"
  | "contains" | "not_contains"
  | "gt" | "gte" | "lt" | "lte"
  | "in" | "not_in"
  | "is_null" | "is_not_null"
  | "date_within_days" | "date_overdue"
  | "changed_to" | "changed_from";

export interface Condition {
  field: string;
  op: ConditionOp;
  value?: string | number | boolean | string[];
  logic?: "AND" | "OR";
}

export type ActionType =
  | "create_task"
  | "create_suggestion"
  | "create_notification"
  | "add_timeline_event"
  | "change_status"
  | "flag_record"
  | "assign_owner";

export interface Action {
  type: ActionType;
  params: Record<string, unknown>;
}

export interface TriggerContext {
  triggerType: string;
  objectType: string;
  objectId: number;
  actorUserId?: number | null;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

export interface EngineResult {
  matched: boolean;
  conditionResults: { condition: Condition; passed: boolean }[];
  actionsResult: { action: Action; success: boolean; detail: string; skipped?: boolean }[];
  actionsTaken: number;
  dryRun: boolean;
}

// ── Phase 2 — Condition Evaluator ─────────────────────────────────────────────

function resolveField(ctx: TriggerContext, field: string): unknown {
  const target = ctx.after ?? ctx.extra ?? {};
  const before = ctx.before ?? {};
  if (field === "objectType") return ctx.objectType;
  if (field === "objectId") return ctx.objectId;
  if (field.startsWith("before.")) return before[field.slice(7)];
  if (field.startsWith("after.")) return (ctx.after ?? {})[field.slice(6)];
  if (field.startsWith("extra.")) return (ctx.extra ?? {})[field.slice(6)];
  if (field in target) return (target as Record<string, unknown>)[field];
  return undefined;
}

function coerce(v: unknown): string {
  return String(v ?? "").toLowerCase().trim();
}

function evalCondition(cond: Condition, ctx: TriggerContext): boolean {
  const raw = resolveField(ctx, cond.field);
  const val = cond.value;

  switch (cond.op) {
    case "equals":
      return coerce(raw) === coerce(val as string);
    case "not_equals":
      return coerce(raw) !== coerce(val as string);
    case "contains":
      return coerce(raw).includes(coerce(val as string));
    case "not_contains":
      return !coerce(raw).includes(coerce(val as string));
    case "gt":
      return Number(raw) > Number(val);
    case "gte":
      return Number(raw) >= Number(val);
    case "lt":
      return Number(raw) < Number(val);
    case "lte":
      return Number(raw) <= Number(val);
    case "in":
      return Array.isArray(val)
        ? val.map(coerce).includes(coerce(raw))
        : coerce(val as string).split(",").map(s => s.trim()).includes(coerce(raw));
    case "not_in":
      return Array.isArray(val)
        ? !val.map(coerce).includes(coerce(raw))
        : !coerce(val as string).split(",").map(s => s.trim()).includes(coerce(raw));
    case "is_null":
      return raw === null || raw === undefined || raw === "";
    case "is_not_null":
      return raw !== null && raw !== undefined && raw !== "";
    case "date_within_days": {
      if (!raw) return false;
      const d = new Date(raw as string);
      if (isNaN(d.getTime())) return false;
      const diffDays = (d.getTime() - Date.now()) / 86_400_000;
      return diffDays >= 0 && diffDays <= Number(val);
    }
    case "date_overdue": {
      if (!raw) return false;
      const d = new Date(raw as string);
      if (isNaN(d.getTime())) return false;
      return d.getTime() < Date.now();
    }
    case "changed_to":
      return coerce((ctx.after ?? {})[cond.field]) === coerce(val as string);
    case "changed_from":
      return coerce((ctx.before ?? {})[cond.field]) === coerce(val as string);
    default:
      return false;
  }
}

export function evaluateConditions(conditions: Condition[], ctx: TriggerContext): {
  matched: boolean;
  results: { condition: Condition; passed: boolean }[];
} {
  if (!conditions || conditions.length === 0) {
    return { matched: true, results: [] };
  }

  const results: { condition: Condition; passed: boolean }[] = [];
  let overall = true;

  for (let i = 0; i < conditions.length; i++) {
    const cond = conditions[i];
    const passed = evalCondition(cond, ctx);
    results.push({ condition: cond, passed });

    const logic = cond.logic ?? (i === 0 ? "AND" : "AND");
    if (i === 0) {
      overall = passed;
    } else if (logic === "OR") {
      overall = overall || passed;
    } else {
      overall = overall && passed;
    }
  }

  return { matched: overall, results };
}

// ── Phase 3 — Action Executor ─────────────────────────────────────────────────

async function execAction(
  action: Action,
  ctx: TriggerContext,
  ruleId: number,
  dryRun: boolean
): Promise<{ success: boolean; detail: string; skipped?: boolean }> {
  const p = action.params ?? {};
  const ot = (p.objectType as string) ?? ctx.objectType;
  const oid = (p.objectId as number) ?? ctx.objectId;
  const uid = ctx.actorUserId ?? null;

  if (dryRun) {
    return { success: true, detail: `[DRY RUN] Would execute: ${action.type}`, skipped: true };
  }

  try {
    switch (action.type) {

      case "create_task": {
        const title = (p.title as string) ?? "Automated task";
        const desc = (p.description as string | null) ?? null;
        const priority = (p.priority as string) ?? "medium";
        const dueDays = Number(p.dueDaysFromNow ?? 0);
        const dueDate = dueDays > 0
          ? new Date(Date.now() + dueDays * 86_400_000).toISOString()
          : null;
        const dueSql = dueDate ? `'${dueDate}'` : "NULL";
        const descSql = desc ? `'${desc.replace(/'/g, "''")}'` : "NULL";
        await db.execute(sql.raw(`
          INSERT INTO tasks (linked_object_type, linked_object_id, title, description, priority, due_date, status, source, source_label, ai_suggested, created_by_user_id, created_at, updated_at)
          VALUES ('${ot}', ${oid}, '${title.replace(/'/g, "''")}', ${descSql}, '${priority}', ${dueSql}, 'pending', 'automation', 'Automation Rule #${ruleId}', false, ${uid ?? "NULL"}, NOW(), NOW())
        `));
        return { success: true, detail: `Task created: "${title}"` };
      }

      case "create_suggestion": {
        const title = (p.title as string) ?? "Review required";
        const reason = (p.reason as string) ?? "Triggered by automation rule";
        const priority = (p.priority as string) ?? "medium";
        await db.execute(sql.raw(`
          INSERT INTO task_suggestions (object_type, object_id, signal_type, severity, title, reason, suggested_action_type, suggested_action_label, priority, status, source_label, created_at, updated_at)
          VALUES ('${ot}', ${oid}, 'automation_rule', '${priority}', '${title.replace(/'/g, "''")}', '${reason.replace(/'/g, "''")}', 'review', 'Review', '${priority}', 'pending', 'Automation Rule #${ruleId}', NOW(), NOW())
        `));
        return { success: true, detail: `Suggestion created: "${title}"` };
      }

      case "create_notification": {
        const notifTitle = (p.title as string) ?? "Automation alert";
        const body = (p.body as string) ?? "A rule was triggered";
        const severity = (p.severity as string) ?? "medium";
        const actionUrl = (p.actionUrl as string) ?? "/";
        const targetUserId = Number(p.userId ?? uid ?? 4);
        const dedupeKey = `auto_rule_${ruleId}_${ot}_${oid}_${Date.now()}`;
        await db.execute(sql.raw(`
          INSERT INTO notifications (user_id, type, title, body, severity, linked_object_type, linked_object_id, action_url, is_read, dedupe_key, created_at)
          VALUES (${targetUserId}, 'automation_rule', '${notifTitle.replace(/'/g, "''")}', '${body.replace(/'/g, "''")}', '${severity}', '${ot}', ${oid}, '${actionUrl}', false, '${dedupeKey}', NOW())
        `));
        return { success: true, detail: `Notification created: "${notifTitle}"` };
      }

      case "add_timeline_event": {
        const subject = (p.subject as string) ?? "Automation event";
        const summary = (p.summary as string) ?? `Triggered by automation rule #${ruleId}`;
        await db.execute(sql.raw(`
          INSERT INTO activities (linked_object_type, linked_object_id, type, subject, summary, created_by, created_at)
          VALUES ('${ot}', ${oid}, 'activity', '${subject.replace(/'/g, "''")}', '${summary.replace(/'/g, "''")}', ${uid ?? "NULL"}, NOW())
        `));
        return { success: true, detail: `Timeline event added: "${subject}"` };
      }

      case "change_status": {
        const newStatus = (p.status as string);
        if (!newStatus) return { success: false, detail: "change_status: no status provided" };
        const table = p.table as string | undefined;
        // Try to infer the table from objectType if not explicit
        const tableMap: Record<string, string> = {
          lead: "leads", account: "accounts", opportunity: "opportunities",
          quote: "quotes", deployment: "deployments", project: "projects",
          purchase_order: "purchase_orders",
        };
        const tbl = table ?? tableMap[ot];
        if (!tbl) return { success: false, detail: `change_status: unknown table for objectType '${ot}'` };
        await db.execute(sql.raw(`UPDATE "${tbl}" SET status = '${newStatus.replace(/'/g, "''")}', updated_at = NOW() WHERE id = ${oid}`));
        return { success: true, detail: `Status changed to "${newStatus}" on ${tbl}#${oid}` };
      }

      case "flag_record": {
        const flagNote = (p.note as string) ?? "Flagged by automation";
        await db.execute(sql.raw(`
          INSERT INTO activities (linked_object_type, linked_object_id, type, subject, summary, created_by, created_at)
          VALUES ('${ot}', ${oid}, 'activity', 'Record flagged', '${flagNote.replace(/'/g, "''")}', ${uid ?? "NULL"}, NOW())
        `));
        return { success: true, detail: `Record flagged: ${flagNote}` };
      }

      case "assign_owner": {
        const newOwnerId = Number(p.userId);
        if (!newOwnerId) return { success: false, detail: "assign_owner: no userId provided" };
        const ownerTableMap: Record<string, string> = {
          lead: "leads", opportunity: "opportunities", account: "accounts",
          project: "projects", deployment: "deployments",
        };
        const tbl = ownerTableMap[ot];
        if (!tbl) return { success: false, detail: `assign_owner: unsupported objectType '${ot}'` };
        await db.execute(sql.raw(`UPDATE "${tbl}" SET owner_user_id = ${newOwnerId}, updated_at = NOW() WHERE id = ${oid}`));
        return { success: true, detail: `Owner assigned to userId=${newOwnerId}` };
      }

      default:
        return { success: false, detail: `Unknown action type: ${(action as Action).type}` };
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, detail: `Error: ${msg}` };
  }
}

// ── Cooldown / Dedupe check ───────────────────────────────────────────────────

export async function isCooledDown(
  ruleId: number,
  cooldownMinutes: number,
  contextKey?: string
): Promise<boolean> {
  if (cooldownMinutes <= 0) return true;
  const cutoff = new Date(Date.now() - cooldownMinutes * 60_000).toISOString();
  const keyClause = contextKey
    ? `AND trigger_data->>'contextKey' = '${contextKey.replace(/'/g, "''")}'`
    : "";
  const rows = await db.execute(sql.raw(`
    SELECT id FROM automation_run_logs
    WHERE rule_id = ${ruleId} AND status = 'success' AND dry_run = false
      AND executed_at > '${cutoff}' ${keyClause}
    LIMIT 1
  `));
  return (rows as { rows?: unknown[] }).rows?.length === 0;
}

// ── Main Entry Point ──────────────────────────────────────────────────────────

export async function runAutomationRule(
  rule: {
    id: number;
    conditions: Condition[];
    actions: Action[];
    cooldownMinutes: number;
    dedupeKey: string | null;
  },
  ctx: TriggerContext,
  dryRun = false
): Promise<EngineResult> {
  const { matched, results: conditionResults } = evaluateConditions(rule.conditions, ctx);

  if (!matched) {
    return { matched: false, conditionResults, actionsResult: [], actionsTaken: 0, dryRun };
  }

  if (!dryRun) {
    const contextKey = rule.dedupeKey
      ? `${ctx.objectType}:${ctx.objectId}`
      : undefined;
    const cooled = await isCooledDown(rule.id, rule.cooldownMinutes, contextKey);
    if (!cooled) {
      return {
        matched: true, conditionResults, actionsResult: [{ action: { type: "create_task", params: {} }, success: false, detail: "Skipped: within cooldown window", skipped: true }],
        actionsTaken: 0, dryRun,
      };
    }
  }

  const actionsResult: EngineResult["actionsResult"] = [];
  let actionsTaken = 0;

  for (const action of rule.actions) {
    const result = await execAction(action, ctx, rule.id, dryRun);
    actionsResult.push({ action, ...result });
    if (result.success && !result.skipped) actionsTaken++;
  }

  if (!dryRun) {
    await db.execute(sql.raw(`
      INSERT INTO automation_run_logs (rule_id, trigger_data, actions_result, status, dry_run, actions_taken, executed_at)
      VALUES (${rule.id}, '${JSON.stringify({ triggerType: ctx.triggerType, objectType: ctx.objectType, objectId: ctx.objectId }).replace(/'/g, "''")}',
              '${JSON.stringify(actionsResult).replace(/'/g, "''")}', 'success', false, ${actionsTaken}, NOW())
    `));
    await db.execute(sql.raw(`
      UPDATE automation_rules SET last_run_at = NOW(), last_result = 'success', run_count = run_count + 1, updated_at = NOW()
      WHERE id = ${rule.id}
    `));
  }

  return { matched: true, conditionResults, actionsResult, actionsTaken, dryRun };
}
