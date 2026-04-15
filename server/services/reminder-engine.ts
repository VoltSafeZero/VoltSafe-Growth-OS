import { db } from "../db";
import { sql } from "drizzle-orm";

const sqlStr = (s: string | null | undefined): string => {
  if (s == null) return "NULL";
  return `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
};

export interface ReminderRule {
  id: string;
  label: string;
  description: string;
  triggerFn: (task: TaskRow, settings: ReminderSettings) => boolean;
  reminderType: string;
  escalates: boolean;
  cooldownHours: number;
}

export interface TaskRow {
  id: number;
  title: string;
  owner_user_id: number | null;
  due_date: string | null;
  priority: string;
  status: string;
  reminder_at: string | null;
  last_reminded_at: string | null;
  reminder_count: number;
  escalation_level: number;
  snoozed_until: string | null;
  source: string | null;
  account_id: number | null;
  linked_object_type: string | null;
  linked_object_id: number | null;
}

export interface ReminderSettings {
  overdueEscalationDays: number;
  maxRemindersPerDay: number;
  staleUntouchedDays: number;
}

const DEFAULT_SETTINGS: ReminderSettings = {
  overdueEscalationDays: 3,
  maxRemindersPerDay: 3,
  staleUntouchedDays: 7,
};

function hoursAgo(dateStr: string | null, hours: number): boolean {
  if (!dateStr) return true;
  const d = new Date(dateStr).getTime();
  return Date.now() - d > hours * 3_600_000;
}

function daysOverdue(dueDateStr: string | null): number {
  if (!dueDateStr) return 0;
  const diff = Date.now() - new Date(dueDateStr).getTime();
  return diff > 0 ? Math.floor(diff / 86_400_000) : 0;
}

function isSnoozed(task: TaskRow): boolean {
  if (!task.snoozed_until) return false;
  return new Date(task.snoozed_until) > new Date();
}

export const REMINDER_RULES: ReminderRule[] = [
  {
    id: "due_today_morning",
    label: "Due Today — Morning Reminder",
    description: "Task is due today and hasn't been completed by morning.",
    reminderType: "due_today",
    escalates: false,
    cooldownHours: 12,
    triggerFn: (task, _s) => {
      if (!task.due_date) return false;
      const due = new Date(task.due_date);
      const now = new Date();
      const sameDay =
        due.getUTCFullYear() === now.getUTCFullYear() &&
        due.getUTCMonth() === now.getUTCMonth() &&
        due.getUTCDate() === now.getUTCDate();
      return sameDay && hoursAgo(task.last_reminded_at, 12);
    },
  },
  {
    id: "overdue_reminder",
    label: "Overdue Task Reminder",
    description: "Task is past its due date and hasn't been reminded recently.",
    reminderType: "overdue",
    escalates: false,
    cooldownHours: 24,
    triggerFn: (task, _s) => {
      const days = daysOverdue(task.due_date);
      if (days < 1) return false;
      return hoursAgo(task.last_reminded_at, 24);
    },
  },
  {
    id: "high_priority_escalation",
    label: "High Priority Escalation",
    description: "High-priority task is overdue — escalate faster.",
    reminderType: "escalation",
    escalates: true,
    cooldownHours: 12,
    triggerFn: (task, settings) => {
      if (task.priority !== "high" && task.priority !== "urgent") return false;
      const days = daysOverdue(task.due_date);
      if (days < settings.overdueEscalationDays) return false;
      return hoursAgo(task.last_reminded_at, 12);
    },
  },
  {
    id: "untouched_task",
    label: "Untouched Task",
    description: "Task has not been updated or reminded for X days.",
    reminderType: "stale",
    escalates: false,
    cooldownHours: 48,
    triggerFn: (task, settings) => {
      if (!task.reminder_at && !task.due_date) return false;
      return hoursAgo(task.last_reminded_at, settings.staleUntouchedDays * 24);
    },
  },
  {
    id: "suggestion_ignored",
    label: "Ignored Suggestion Resurfaced",
    description: "A task created from a suggestion has been untouched for 5+ days.",
    reminderType: "suggestion_resurface",
    escalates: false,
    cooldownHours: 120,
    triggerFn: (task, _s) => {
      if (task.source !== "suggestion") return false;
      return hoursAgo(task.last_reminded_at, 120);
    },
  },
];

export interface ReminderCandidate {
  task: TaskRow;
  rule: ReminderRule;
}

export async function findReminderCandidates(
  userId: number
): Promise<ReminderCandidate[]> {
  const settingsRes = await db.execute(sql.raw(
    `SELECT * FROM execution_settings WHERE user_id = ${userId} LIMIT 1`
  ));
  const settings: ReminderSettings =
    settingsRes.rows.length > 0
      ? {
          overdueEscalationDays: Number((settingsRes.rows[0] as any).overdue_escalation_days) || 3,
          maxRemindersPerDay: Number((settingsRes.rows[0] as any).max_reminders_per_day) || 3,
          staleUntouchedDays: DEFAULT_SETTINGS.staleUntouchedDays,
        }
      : DEFAULT_SETTINGS;

  const result = await db.execute(sql.raw(`
    SELECT t.*, 
      COALESCE(daily.cnt, 0) AS reminders_today
    FROM tasks t
    LEFT JOIN (
      SELECT task_id, COUNT(*) AS cnt
      FROM task_reminder_logs
      WHERE created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY task_id
    ) daily ON daily.task_id = t.id
    WHERE t.owner_user_id = ${userId}
      AND t.status NOT IN ('completed','cancelled')
      AND (t.snoozed_until IS NULL OR t.snoozed_until < NOW())
    ORDER BY t.due_date ASC NULLS LAST
    LIMIT 200
  `));

  const tasks = result.rows as (TaskRow & { reminders_today: number })[];
  const candidates: ReminderCandidate[] = [];

  for (const task of tasks) {
    if (task.reminders_today >= settings.maxRemindersPerDay) continue;
    if (isSnoozed(task)) continue;

    for (const rule of REMINDER_RULES) {
      if (rule.triggerFn(task, settings)) {
        candidates.push({ task, rule });
        break;
      }
    }
  }

  return candidates;
}

export async function generateRemindersForUser(
  userId: number
): Promise<{ created: number; escalated: number }> {
  const candidates = await findReminderCandidates(userId);
  let created = 0;
  let escalated = 0;

  for (const { task, rule } of candidates) {
    const newEscalationLevel = rule.escalates
      ? (task.escalation_level || 0) + 1
      : task.escalation_level || 0;

    const overdaysDays = daysOverdue(task.due_date);
    const body =
      rule.reminderType === "due_today"
        ? `"${task.title}" is due today — mark it complete when done.`
        : rule.reminderType === "escalation"
        ? `"${task.title}" is ${overdaysDays}d overdue and escalated to level ${newEscalationLevel}.`
        : rule.reminderType === "stale"
        ? `"${task.title}" hasn't been touched in a while — any update?`
        : rule.reminderType === "suggestion_resurface"
        ? `A suggested task "${task.title}" is still pending — worth reviewing.`
        : `"${task.title}" is ${overdaysDays} day${overdaysDays === 1 ? "" : "s"} overdue.`;

    const severity =
      rule.reminderType === "escalation"
        ? "high"
        : rule.reminderType === "due_today"
        ? "medium"
        : "low";

    const dedupeKey = `reminder-${task.id}-${rule.id}-${new Date().toISOString().slice(0, 10)}`;

    const notifResult = await db.execute(sql.raw(`
      INSERT INTO notifications (user_id, type, title, body, severity, linked_object_type, linked_object_id, action_url, is_read, dedupe_key, created_at)
      VALUES (
        ${userId},
        'task_reminder',
        ${sqlStr(rule.label)},
        ${sqlStr(body)},
        '${severity}',
        'task',
        ${task.id},
        '/execution/daily',
        false,
        ${sqlStr(dedupeKey)},
        NOW()
      )
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING id
    `));

    if (notifResult.rows.length === 0) continue;
    const notifId = (notifResult.rows[0] as any).id;

    await db.execute(sql.raw(`
      INSERT INTO task_reminder_logs (task_id, user_id, reminder_type, channel, notification_id)
      VALUES (${task.id}, ${userId}, '${rule.reminderType}', 'in_app', ${notifId})
    `));

    await db.execute(sql.raw(`
      UPDATE tasks
      SET last_reminded_at = NOW(),
          reminder_count = COALESCE(reminder_count, 0) + 1,
          escalation_level = ${newEscalationLevel},
          updated_at = NOW()
      WHERE id = ${task.id}
    `));

    created++;
    if (rule.escalates) escalated++;
  }

  return { created, escalated };
}
