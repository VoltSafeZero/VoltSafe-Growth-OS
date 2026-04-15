/**
 * Global Suggestions Engine
 *
 * Runs 6 deterministic rules across all CRM records to generate task suggestions.
 * Results are upserted into the task_suggestions table.
 * Each rule maps to a configurable threshold in task_rule_configs.
 *
 * Rules:
 *  1. unanswered_email    – inbound email from known contact with no reply in X hours
 *  2. stale_lead          – lead with no follow-up activity in X days
 *  3. missing_next_step   – opportunity open with no next_step set
 *  4. quote_no_followup   – quote sent, no follow-up task created within X days
 *  5. account_needs_attention – account last_interaction_at > X days ago
 *  6. overdue_task_reminder   – task overdue by more than X days, no completion
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

export interface GlobalSuggestion {
  id: number;
  objectType: string;
  objectId: number;
  signalType: string;
  severity: "low" | "medium" | "high";
  title: string;
  reason: string;
  suggestedActionType: string;
  suggestedActionLabel: string;
  priority: "low" | "medium" | "high";
  suggestedDueDate: string | null;
  status: string;
  sourceLabel: string;
  confidence: number;
  suggestedAssigneeId: number | null;
  accountName: string | null;
  objectLabel: string | null;
}

interface RuleConfig {
  ruleId: string;
  label: string;
  thresholdValue: number;
  thresholdUnit: string;
  isEnabled: boolean;
  assigneeStrategy: string;
  defaultAssigneeUserId: number | null;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function safeStr(s: string): string {
  return s.replace(/'/g, "''");
}

async function upsertSuggestion(
  objectType: string,
  objectId: number,
  signalType: string,
  {
    severity,
    title,
    reason,
    actionType,
    actionLabel,
    priority,
    dueDateIso,
    sourceLabel,
    confidence,
    suggestedAssigneeId,
  }: {
    severity: string;
    title: string;
    reason: string;
    actionType: string;
    actionLabel: string;
    priority: string;
    dueDateIso: string;
    sourceLabel: string;
    confidence: number;
    suggestedAssigneeId: number | null;
  }
): Promise<any> {
  const DISMISSED_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
  const ACCEPTED_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const { rows: existing } = await db.execute(sql.raw(
    `SELECT * FROM task_suggestions WHERE object_type = '${objectType}' AND object_id = ${objectId} AND signal_type = '${signalType}' LIMIT 1`
  ));
  const ext = existing[0] as any | undefined;

  if (ext) {
    // Check suppression cooldowns
    if (ext.status === "dismissed" && ext.dismissed_at) {
      if (now < new Date(ext.dismissed_at).getTime() + DISMISSED_COOLDOWN_MS) return null;
    }
    if (ext.status === "accepted" && ext.accepted_at) {
      if (now < new Date(ext.accepted_at).getTime() + ACCEPTED_COOLDOWN_MS) return null;
    }
    if (ext.status === "snoozed" && ext.snoozed_until) {
      if (now < new Date(ext.snoozed_until).getTime()) return null;
    }
    // Already pending — refresh content and return
    const assigneeClause = suggestedAssigneeId ? `, suggested_assignee_id = ${suggestedAssigneeId}` : "";
    await db.execute(sql.raw(
      `UPDATE task_suggestions SET
         title = '${safeStr(title)}', reason = '${safeStr(reason)}',
         severity = '${severity}', priority = '${priority}',
         suggested_action_type = '${actionType}', suggested_action_label = '${safeStr(actionLabel)}',
         suggested_due_date = '${dueDateIso}', source_label = '${safeStr(sourceLabel)}',
         confidence = ${confidence}, status = 'pending',
         dismissed_at = NULL, accepted_at = NULL, snoozed_until = NULL,
         updated_at = NOW() ${assigneeClause}
       WHERE id = ${ext.id}`
    ));
    const { rows } = await db.execute(sql.raw(`SELECT * FROM task_suggestions WHERE id = ${ext.id} LIMIT 1`));
    return rows[0];
  }

  // Insert new
  const assigneeCol = suggestedAssigneeId ? `, suggested_assignee_id` : "";
  const assigneeVal = suggestedAssigneeId ? `, ${suggestedAssigneeId}` : "";
  const { rows: inserted } = await db.execute(sql.raw(
    `INSERT INTO task_suggestions
       (object_type, object_id, signal_type, severity, title, reason,
        suggested_action_type, suggested_action_label, priority, suggested_due_date,
        status, source_label, confidence ${assigneeCol})
     VALUES
       ('${objectType}', ${objectId}, '${signalType}', '${severity}',
        '${safeStr(title)}', '${safeStr(reason)}',
        '${actionType}', '${safeStr(actionLabel)}', '${priority}', '${dueDateIso}',
        'pending', '${safeStr(sourceLabel)}', ${confidence} ${assigneeVal})
     RETURNING *`
  ));
  return inserted[0];
}

// ── Rules ────────────────────────────────────────────────────────────────────

async function runUnansweredEmailRule(cfg: RuleConfig, _userId: number): Promise<any[]> {
  const hours = cfg.thresholdValue;
  const { rows } = await db.execute(sql.raw(`
    SELECT
      ge.id AS email_id,
      ge.gmail_thread_id,
      ge.sender_email,
      ge.subject,
      ge.received_at,
      c.id AS contact_id,
      COALESCE(c.first_name || ' ' || c.last_name, ge.sender_email) AS contact_name,
      COALESCE(c.account_id, 0) AS account_id,
      a.name AS account_name,
      COALESCE(u.id, NULL) AS owner_user_id
    FROM gmail_emails ge
    JOIN contacts c ON c.email = ge.sender_email
    LEFT JOIN accounts a ON a.id = c.account_id
    LEFT JOIN users u ON u.id = a.owner_user_id
    WHERE ge.direction = 'inbound'
      AND ge.received_at < NOW() - INTERVAL '${hours} hours'
      AND NOT EXISTS (
        SELECT 1 FROM gmail_emails reply
        WHERE reply.gmail_thread_id = ge.gmail_thread_id
          AND reply.direction = 'outbound'
          AND reply.received_at > ge.received_at
      )
      AND NOT EXISTS (
        SELECT 1 FROM tasks t
        WHERE t.linked_object_type = 'contact'
          AND t.linked_object_id = c.id
          AND t.source = 'suggestion'
          AND t.status = 'pending'
          AND t.created_at > NOW() - INTERVAL '3 days'
      )
    ORDER BY ge.received_at ASC
    LIMIT 20
  `));

  const results: any[] = [];
  for (const row of rows as any[]) {
    const objectType = row.account_id ? "account" : "contact";
    const objectId = row.account_id || row.contact_id;
    if (!objectId) continue;
    const hoursAgo = Math.round((Date.now() - new Date(row.received_at).getTime()) / 3600000);
    const due = new Date(Date.now() + 24 * 3600000).toISOString();
    const suggestion = await upsertSuggestion(objectType, objectId, "unanswered_email", {
      severity: hoursAgo > 48 ? "high" : "medium",
      title: `Reply to email from ${row.contact_name}`,
      reason: `Email received ${hoursAgo}h ago with no reply: "${(row.subject ?? "").substring(0, 60)}"`,
      actionType: "reply_email",
      actionLabel: "Reply to email",
      priority: hoursAgo > 48 ? "high" : "medium",
      dueDateIso: due,
      sourceLabel: "Unanswered email",
      confidence: Math.min(95, 50 + Math.floor(hoursAgo / 2)),
      suggestedAssigneeId: row.owner_user_id ?? null,
    });
    if (suggestion) results.push({ ...suggestion, accountName: row.account_name ?? null, objectLabel: row.contact_name });
  }
  return results;
}

async function runStaleLeadRule(cfg: RuleConfig, _userId: number): Promise<any[]> {
  const days = cfg.thresholdValue;
  const { rows } = await db.execute(sql.raw(`
    SELECT
      l.id, l.first_name, l.last_name, l.company,
      l.owner_user_id,
      EXTRACT(EPOCH FROM (NOW() - COALESCE(l.last_activity_at, l.created_at))) / 86400 AS days_stale
    FROM leads l
    WHERE l.status NOT IN ('converted', 'disqualified', 'closed')
      AND COALESCE(l.last_activity_at, l.created_at) < NOW() - INTERVAL '${days} days'
    ORDER BY days_stale DESC
    LIMIT 20
  `));

  const results: any[] = [];
  for (const row of rows as any[]) {
    const daysStale = Math.round(Number(row.days_stale));
    const due = new Date(Date.now() + 48 * 3600000).toISOString();
    const name = [row.first_name, row.last_name].filter(Boolean).join(" ") || row.company || "Unknown Lead";
    const suggestion = await upsertSuggestion("lead", row.id, "stale_lead", {
      severity: daysStale > days * 2 ? "high" : "medium",
      title: `Follow up with ${name}`,
      reason: `Lead has had no activity in ${daysStale} days`,
      actionType: "log_call",
      actionLabel: "Log follow-up activity",
      priority: daysStale > days * 2 ? "high" : "medium",
      dueDateIso: due,
      sourceLabel: "Stale lead",
      confidence: Math.min(90, 40 + Math.floor(daysStale / days) * 15),
      suggestedAssigneeId: row.owner_user_id ?? null,
    });
    if (suggestion) results.push({ ...suggestion, accountName: row.company ?? null, objectLabel: name });
  }
  return results;
}

async function runMissingNextStepRule(cfg: RuleConfig, _userId: number): Promise<any[]> {
  const days = cfg.thresholdValue;
  const { rows } = await db.execute(sql.raw(`
    SELECT
      o.id, o.title, o.amount, o.stage, o.owner_user_id,
      a.name AS account_name,
      EXTRACT(EPOCH FROM (NOW() - o.created_at)) / 86400 AS age_days
    FROM opportunities o
    LEFT JOIN accounts a ON a.id = o.account_id
    WHERE o.status = 'open'
      AND (o.next_step IS NULL OR TRIM(o.next_step) = '')
      AND o.created_at < NOW() - INTERVAL '${days} days'
    ORDER BY o.amount DESC NULLS LAST
    LIMIT 20
  `));

  const results: any[] = [];
  for (const row of rows as any[]) {
    const ageDays = Math.round(Number(row.age_days));
    const valueStr = row.amount >= 1000 ? `$${(row.amount / 1000).toFixed(0)}k` : `$${row.amount ?? 0}`;
    const due = new Date(Date.now() + 2 * 24 * 3600000).toISOString();
    const suggestion = await upsertSuggestion("opportunity", row.id, "missing_next_step", {
      severity: row.amount >= 10000 ? "high" : "medium",
      title: `Add next step to "${row.title}"`,
      reason: `${row.account_name ?? "This deal"} (${valueStr}) has no next step set — open for ${ageDays} days`,
      actionType: "review_opportunity",
      actionLabel: "Update next step",
      priority: row.amount >= 10000 ? "high" : "medium",
      dueDateIso: due,
      sourceLabel: "Opportunity missing next step",
      confidence: 75,
      suggestedAssigneeId: row.owner_user_id ?? null,
    });
    if (suggestion) results.push({ ...suggestion, accountName: row.account_name ?? null, objectLabel: row.title });
  }
  return results;
}

async function runQuoteNoFollowupRule(cfg: RuleConfig, _userId: number): Promise<any[]> {
  const days = cfg.thresholdValue;
  const { rows } = await db.execute(sql.raw(`
    SELECT
      q.id, q.quote_number, q.status, q.total,
      q.account_id, a.name AS account_name,
      COALESCE(q.owner_user_id, a.owner_user_id) AS owner_user_id,
      EXTRACT(EPOCH FROM (NOW() - q.updated_at)) / 86400 AS days_since_sent
    FROM quotes q
    LEFT JOIN accounts a ON a.id = q.account_id
    WHERE q.status = 'sent'
      AND q.updated_at < NOW() - INTERVAL '${days} days'
      AND NOT EXISTS (
        SELECT 1 FROM tasks t
        WHERE t.linked_object_type = 'account'
          AND t.linked_object_id = q.account_id
          AND t.status = 'pending'
          AND t.created_at > q.updated_at
      )
    ORDER BY days_since_sent DESC
    LIMIT 20
  `));

  const results: any[] = [];
  for (const row of rows as any[]) {
    const daysAgo = Math.round(Number(row.days_since_sent));
    const valueStr = Number(row.total) >= 1000
      ? `$${(Number(row.total) / 1000).toFixed(0)}k`
      : `$${Number(row.total ?? 0).toFixed(0)}`;
    const due = new Date(Date.now() + 24 * 3600000).toISOString();
    const suggestion = await upsertSuggestion("account", row.account_id, "quote_no_followup", {
      severity: daysAgo > days * 2 ? "high" : "medium",
      title: `Follow up on sent quote for ${row.account_name ?? "account"}`,
      reason: `Quote ${row.quote_number} (${valueStr}) was sent ${daysAgo} days ago with no follow-up task`,
      actionType: "send_email",
      actionLabel: "Send follow-up email",
      priority: daysAgo > days * 2 ? "high" : "medium",
      dueDateIso: due,
      sourceLabel: "Quote follow-up",
      confidence: Math.min(90, 55 + daysAgo * 3),
      suggestedAssigneeId: row.owner_user_id ?? null,
    });
    if (suggestion) results.push({ ...suggestion, accountName: row.account_name ?? null, objectLabel: row.quote_number });
  }
  return results;
}

async function runExpiredQuoteRule(_cfg: RuleConfig, _userId: number): Promise<any[]> {
  const { rows } = await db.execute(sql.raw(`
    SELECT
      q.id, q.quote_number, q.total,
      q.account_id, a.name AS account_name,
      COALESCE(q.owner_user_id, a.owner_user_id) AS owner_user_id,
      EXTRACT(EPOCH FROM (NOW() - q.valid_until)) / 86400 AS days_expired
    FROM quotes q
    LEFT JOIN accounts a ON a.id = q.account_id
    WHERE q.status IN ('sent', 'follow_up_due')
      AND q.valid_until IS NOT NULL
      AND q.valid_until < NOW()
    ORDER BY days_expired DESC
    LIMIT 20
  `));

  const results: any[] = [];
  for (const row of rows as any[]) {
    if (!row.account_id) continue;
    const daysExp = Math.round(Number(row.days_expired));
    const valueStr = Number(row.total) >= 1000
      ? `$${(Number(row.total) / 1000).toFixed(0)}k`
      : `$${Number(row.total ?? 0).toFixed(0)}`;
    const due = new Date(Date.now() + 24 * 3600000).toISOString();
    const suggestion = await upsertSuggestion("account", row.account_id, "quote_expired", {
      severity: daysExp > 14 ? "high" : "medium",
      title: `Quote expired — renew or close ${row.account_name ?? ""}`,
      reason: `Quote ${row.quote_number} (${valueStr}) expired ${daysExp} day${daysExp !== 1 ? "s" : ""} ago`,
      actionType: "create_task",
      actionLabel: "Renew or close quote",
      priority: daysExp > 14 ? "high" : "medium",
      dueDateIso: due,
      sourceLabel: "Expired quote",
      confidence: Math.min(90, 60 + daysExp * 2),
      suggestedAssigneeId: row.owner_user_id ?? null,
    });
    if (suggestion) results.push({ ...suggestion, accountName: row.account_name ?? null, objectLabel: row.quote_number });
  }
  return results;
}

async function runAccountNeedsAttentionRule(cfg: RuleConfig, _userId: number): Promise<any[]> {
  const days = cfg.thresholdValue;
  const { rows } = await db.execute(sql.raw(`
    SELECT
      a.id, a.name, a.health_score, a.owner_user_id,
      EXTRACT(EPOCH FROM (NOW() - COALESCE(a.last_interaction_at, a.created_at))) / 86400 AS days_idle
    FROM accounts a
    WHERE a.is_active = true
      AND COALESCE(a.last_interaction_at, a.created_at) < NOW() - INTERVAL '${days} days'
      AND NOT EXISTS (
        SELECT 1 FROM tasks t
        WHERE t.linked_object_type = 'account'
          AND t.linked_object_id = a.id
          AND t.status = 'pending'
      )
    ORDER BY days_idle DESC
    LIMIT 20
  `));

  const results: any[] = [];
  for (const row of rows as any[]) {
    const daysIdle = Math.round(Number(row.days_idle));
    const due = new Date(Date.now() + 3 * 24 * 3600000).toISOString();
    const suggestion = await upsertSuggestion("account", row.id, "account_needs_attention", {
      severity: daysIdle > days * 2 ? "high" : "medium",
      title: `Re-engage ${row.name}`,
      reason: `No interaction with this account in ${daysIdle} days and no open tasks`,
      actionType: "log_call",
      actionLabel: "Log outreach",
      priority: daysIdle > days * 2 ? "high" : "medium",
      dueDateIso: due,
      sourceLabel: "Account needs attention",
      confidence: Math.min(85, 45 + Math.floor(daysIdle / 10) * 5),
      suggestedAssigneeId: row.owner_user_id ?? null,
    });
    if (suggestion) results.push({ ...suggestion, accountName: row.name ?? null, objectLabel: row.name });
  }
  return results;
}

async function runOverdueTaskReminderRule(cfg: RuleConfig, _userId: number): Promise<any[]> {
  const days = cfg.thresholdValue;
  const { rows } = await db.execute(sql.raw(`
    SELECT
      t.id, t.title, t.due_date, t.owner_user_id,
      t.linked_object_type, t.linked_object_id, t.account_id,
      a.name AS account_name,
      EXTRACT(EPOCH FROM (NOW() - t.due_date)) / 86400 AS days_overdue
    FROM tasks t
    LEFT JOIN accounts a ON a.id = t.account_id
    WHERE t.status NOT IN ('done', 'completed')
      AND t.due_date IS NOT NULL
      AND t.due_date < NOW() - INTERVAL '${days} days'
    ORDER BY days_overdue DESC
    LIMIT 20
  `));

  const results: any[] = [];
  for (const row of rows as any[]) {
    const daysOverdue = Math.round(Number(row.days_overdue));
    const objectType = row.linked_object_type ?? (row.account_id ? "account" : null);
    const objectId = row.linked_object_id ?? row.account_id;
    if (!objectType || !objectId) continue;
    const due = new Date(Date.now() + 24 * 3600000).toISOString();
    const suggestion = await upsertSuggestion(objectType, objectId, "overdue_task_reminder", {
      severity: daysOverdue > days * 2 ? "high" : "medium",
      title: `Complete overdue task: "${row.title}"`,
      reason: `Task is ${daysOverdue} days overdue with no completion or reassignment`,
      actionType: "complete_task",
      actionLabel: "Review overdue task",
      priority: "high",
      dueDateIso: due,
      sourceLabel: "Overdue task",
      confidence: 90,
      suggestedAssigneeId: row.owner_user_id ?? null,
    });
    if (suggestion) results.push({ ...suggestion, accountName: row.account_name ?? null, objectLabel: row.title });
  }
  return results;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateGlobalSuggestions(userId: number): Promise<GlobalSuggestion[]> {
  // Load rule configs
  const { rows: ruleRows } = await db.execute(sql.raw(`SELECT * FROM task_rule_configs ORDER BY rule_id`));
  const configs = (ruleRows as any[]).reduce<Record<string, RuleConfig>>((acc, r) => {
    acc[r.rule_id] = {
      ruleId: r.rule_id,
      label: r.label,
      thresholdValue: Number(r.threshold_value),
      thresholdUnit: r.threshold_unit,
      isEnabled: Boolean(r.is_enabled),
      assigneeStrategy: r.assignee_strategy,
      defaultAssigneeUserId: r.default_assignee_user_id ? Number(r.default_assignee_user_id) : null,
    };
    return acc;
  }, {});

  const all: any[] = [];

  const runRule = async (ruleId: string, fn: (cfg: RuleConfig, uid: number) => Promise<any[]>) => {
    const cfg = configs[ruleId];
    if (!cfg || !cfg.isEnabled) return;
    try {
      const suggestions = await fn(cfg, userId);
      all.push(...suggestions.filter(Boolean));
    } catch (err: any) {
      console.error(`[global-suggestions] Rule ${ruleId} error:`, err.message);
    }
  };

  await runRule("unanswered_email", runUnansweredEmailRule);
  await runRule("stale_lead", runStaleLeadRule);
  await runRule("missing_next_step", runMissingNextStepRule);
  await runRule("quote_no_followup", runQuoteNoFollowupRule);
  // expired quote rule uses a fallback config if not in DB
  const expiredCfg = configs["quote_expired"] ?? { ruleId: "quote_expired", label: "Expired quote", thresholdValue: 0, thresholdUnit: "days", isEnabled: true, assigneeStrategy: "record_owner", defaultAssigneeUserId: null };
  if (expiredCfg.isEnabled) {
    try {
      const expiredResults = await runExpiredQuoteRule(expiredCfg, userId);
      all.push(...expiredResults.filter(Boolean));
    } catch (err: any) {
      console.error("[global-suggestions] Rule quote_expired error:", err.message);
    }
  }
  await runRule("account_needs_attention", runAccountNeedsAttentionRule);
  await runRule("overdue_task_reminder", runOverdueTaskReminderRule);

  // Deduplicate by suggestion id and shape output
  const seen = new Set<number>();
  const out: GlobalSuggestion[] = [];
  for (const s of all) {
    if (!s?.id || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push({
      id: s.id,
      objectType: s.object_type,
      objectId: s.object_id,
      signalType: s.signal_type,
      severity: s.severity,
      title: s.title,
      reason: s.reason,
      suggestedActionType: s.suggested_action_type,
      suggestedActionLabel: s.suggested_action_label,
      priority: s.priority,
      suggestedDueDate: s.suggested_due_date ? new Date(s.suggested_due_date).toISOString() : null,
      status: s.status,
      sourceLabel: s.source_label ?? "Signal",
      confidence: Number(s.confidence ?? 50),
      suggestedAssigneeId: s.suggested_assignee_id ? Number(s.suggested_assignee_id) : null,
      accountName: s.accountName ?? null,
      objectLabel: s.objectLabel ?? null,
    });
  }

  // Sort: high severity first, then by confidence desc
  const sevOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => {
    const sd = (sevOrder[a.severity] ?? 2) - (sevOrder[b.severity] ?? 2);
    if (sd !== 0) return sd;
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });

  return out;
}
