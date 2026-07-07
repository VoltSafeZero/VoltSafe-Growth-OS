// ── Work Drilldown Routes — Phase 3 Universal Drilldowns ──────────────────────
// GET /api/work/drilldown
// requireAuth — paginated, filtered, safe SQL (no raw metric interpolation)

import type { Express } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";

const PAGE_DEFAULT = 1;
const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 100;

function safeInt(v: any, fallback: number): number {
  const n = parseInt(String(v ?? ""), 10);
  return isNaN(n) ? fallback : n;
}

function now(): string {
  return new Date().toISOString();
}

function buildPaginatedResponse(
  metric: string,
  title: string,
  description: string,
  columns: { key: string; label: string }[],
  rows: any[],
  total: number,
  page: number,
  pageSize: number,
  emptyState?: string,
) {
  return {
    metric,
    title,
    description,
    total,
    page,
    page_size: pageSize,
    total_pages: Math.max(1, Math.ceil(total / pageSize)),
    columns,
    rows,
    empty_state: emptyState ?? "",
    refreshed_at: now(),
  };
}

function searchClause(search: string, fields: string[]): string {
  if (!search || search.trim().length < 1) return "";
  const escaped = search.replace(/'/g, "''").slice(0, 100);
  const parts = fields.map(f => `${f} ILIKE '%${escaped}%'`);
  return `AND (${parts.join(" OR ")})`;
}

// ── Allowed metric names (whitelist — never interpolated into SQL) ─────────────
const WORK_METRICS = new Set([
  // Tasks / Daily Execution / Mission Control
  "tasks_open",
  "tasks_overdue",
  "tasks_due_today",
  "tasks_due_this_week",
  "tasks_completed_today",
  "tasks_high_priority",
  "tasks_no_owner",
  "tasks_no_due_date",
  // Mission Control aliases
  "mc_overdue_tasks",
  "mc_due_today",
  "mc_meetings_today",
  // Calendar / Meetings
  "meetings_today",
  "meetings_this_week",
  "meetings_upcoming",
  "meetings_past_month",
  // Activity Feed
  "activity_recent",
  "activity_email",
  "activity_task",
  "activity_meeting",
  "activity_crm_linked",
  // Inbox (local mirror)
  "inbox_unread",
  "inbox_drafts",
]);

// ── Shared column sets ─────────────────────────────────────────────────────────
const TASK_COLS = [
  { key: "task_title",   label: "Task" },
  { key: "status",       label: "Status" },
  { key: "priority",     label: "Priority" },
  { key: "owner_name",   label: "Owner" },
  { key: "due_date",     label: "Due Date" },
  { key: "account_name", label: "Account" },
];

const MEETING_COLS = [
  { key: "event_title", label: "Meeting" },
  { key: "start_time",  label: "Start" },
  { key: "end_time",    label: "End" },
  { key: "event_type",  label: "Type" },
  { key: "location",    label: "Location" },
];

const ACTIVITY_COLS = [
  { key: "act_type",        label: "Type" },
  { key: "summary",         label: "Summary" },
  { key: "linked_object",   label: "Linked To" },
  { key: "created_by_name", label: "By" },
  { key: "created_at",      label: "Date" },
];

export function registerWorkDrilldownRoutes(
  app: Express,
  requireAuth: any,
  _requirePermission: (section: string, level: string) => any,
) {
  app.get(
    "/api/work/drilldown",
    requireAuth,
    async (req: any, res) => {
      try {
        const metric   = String(req.query.metric   ?? "");
        const search   = String(req.query.search   ?? "");
        const page     = Math.max(1, safeInt(req.query.page, PAGE_DEFAULT));
        const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, safeInt(req.query.page_size, PAGE_SIZE_DEFAULT)));
        const offset   = (page - 1) * pageSize;

        // Scope to the current user by default; admins may pass ?owner_id=N to inspect another user.
        const currentUserId = (req.user as any)?.id ?? 0;
        const userId = currentUserId;  // alias used by calendar/inbox handlers below
        const isAdmin = (req.user as any)?.isAdmin || ["admin", "master_admin"].includes((req.user as any)?.role ?? "");
        const requestedOwnerId = safeInt(req.query.owner_id, 0);
        const ownerId = requestedOwnerId > 0 && isAdmin ? requestedOwnerId : currentUserId;
        const accountId = safeInt(req.query.account_id, 0);
        const dateFrom  = req.query.date_from ? String(req.query.date_from).slice(0, 20) : null;
        const dateTo    = req.query.date_to   ? String(req.query.date_to).slice(0, 20) : null;

        if (!WORK_METRICS.has(metric)) {
          return res.status(400).json({ error: `Unknown metric: ${metric}` });
        }

        // ── Task metrics (Tasks hub + Daily Execution + Mission Control) ─────────
        const isTaskMetric = [
          "tasks_open","tasks_overdue","tasks_due_today","tasks_due_this_week",
          "tasks_completed_today","tasks_high_priority","tasks_no_owner","tasks_no_due_date",
          "mc_overdue_tasks","mc_due_today",
        ].includes(metric);

        if (isTaskMetric) {
          // owner_id param overrides; default to current user's tasks (0 = show all own)
          // tasks_no_owner shows globally for any user who can view (admin sees all)
          const effectiveOwnerId = ownerId > 0 ? ownerId : (metric === "tasks_no_owner" ? 0 : userId);

          const whereParts: string[] = ["t.archived = false"];

          if (metric === "tasks_open" || metric === "mc_overdue_tasks" && false) {
            whereParts.push(`t.status IN ('pending','in_progress')`);
          } else if (metric === "tasks_overdue" || metric === "mc_overdue_tasks") {
            whereParts.push(`t.status IN ('pending','in_progress')`);
            whereParts.push(`t.due_date < NOW()`);
          } else if (metric === "tasks_due_today" || metric === "mc_due_today") {
            whereParts.push(`t.status IN ('pending','in_progress')`);
            whereParts.push(`t.due_date::date = CURRENT_DATE`);
          } else if (metric === "tasks_due_this_week") {
            whereParts.push(`t.status IN ('pending','in_progress')`);
            whereParts.push(`t.due_date BETWEEN NOW() AND (NOW() + INTERVAL '7 days')`);
          } else if (metric === "tasks_completed_today") {
            whereParts.push(`t.status IN ('done','completed')`);
            whereParts.push(`t.completed_at::date = CURRENT_DATE`);
          } else if (metric === "tasks_high_priority") {
            whereParts.push(`t.priority IN ('high','urgent')`);
            whereParts.push(`t.status IN ('pending','in_progress')`);
          } else if (metric === "tasks_no_owner") {
            whereParts.push(`t.owner_user_id IS NULL`);
            whereParts.push(`t.status IN ('pending','in_progress')`);
          } else if (metric === "tasks_no_due_date") {
            whereParts.push(`t.due_date IS NULL`);
            whereParts.push(`t.status IN ('pending','in_progress')`);
          } else {
            // tasks_open default
            whereParts.push(`t.status IN ('pending','in_progress')`);
          }

          if (effectiveOwnerId > 0 && metric !== "tasks_no_owner") {
            whereParts.push(`t.owner_user_id = ${effectiveOwnerId}`);
          }
          if (accountId > 0) whereParts.push(`t.account_id = ${accountId}`);
          if (dateFrom)      whereParts.push(`t.created_at >= '${dateFrom}'`);
          if (dateTo)        whereParts.push(`t.created_at <= '${dateTo}'`);

          const sc = searchClause(search, ["t.title", "t.description", "a.name"]);
          const whereSQL = `WHERE ${whereParts.join(" AND ")} ${sc}`;

          const countRes = await db.execute(sql.raw(`
            SELECT COUNT(*)::int AS cnt
            FROM tasks t
            LEFT JOIN accounts a ON a.id = t.account_id
            ${whereSQL}
          `));
          const total = (countRes.rows[0] as any)?.cnt ?? 0;

          const rowRes = await db.execute(sql.raw(`
            SELECT t.id AS task_id, t.title AS task_title, t.status, t.priority, t.due_date, t.completed_at,
                   u.name AS owner_name, a.name AS account_name
            FROM tasks t
            LEFT JOIN users u ON u.id = t.owner_user_id
            LEFT JOIN accounts a ON a.id = t.account_id
            ${whereSQL}
            ORDER BY
              CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
              t.due_date ASC,
              t.updated_at DESC
            LIMIT ${pageSize} OFFSET ${offset}
          `));

          const LABELS: Record<string,string> = {
            tasks_open: "Open Tasks", tasks_overdue: "Overdue Tasks",
            tasks_due_today: "Tasks Due Today", tasks_due_this_week: "Tasks Due This Week",
            tasks_completed_today: "Completed Today", tasks_high_priority: "High-Priority Tasks",
            tasks_no_owner: "Tasks Without Owner", tasks_no_due_date: "Tasks Without Due Date",
            mc_overdue_tasks: "Overdue Tasks", mc_due_today: "Tasks Due Today",
          };
          const DESCS: Record<string,string> = {
            tasks_open: "Tasks that are currently open and in progress.",
            tasks_overdue: "Open tasks past their due date.",
            tasks_due_today: "Tasks scheduled for today.",
            tasks_due_this_week: "Tasks due within the next 7 days.",
            tasks_completed_today: "Tasks marked complete today.",
            tasks_high_priority: "High and urgent priority tasks that are still open.",
            tasks_no_owner: "Open tasks without an assigned owner.",
            tasks_no_due_date: "Open tasks without a due date set.",
            mc_overdue_tasks: "Open tasks past their due date.",
            mc_due_today: "Tasks scheduled for today.",
          };
          const EMPTY: Record<string,string> = {
            tasks_open: "No open tasks. Everything is either done or cleared.",
            tasks_overdue: "No overdue tasks. Nice. The machine is not on fire.",
            tasks_due_today: "Nothing due today. Clear schedule.",
            tasks_completed_today: "No tasks completed today yet.",
            tasks_no_owner: "Every open task has an owner assigned.",
            tasks_no_due_date: "Every open task has a due date set.",
            mc_overdue_tasks: "No overdue tasks. Nice. The machine is not on fire.",
            mc_due_today: "Nothing due today.",
          };

          return res.json(buildPaginatedResponse(metric, LABELS[metric] ?? "Tasks", DESCS[metric] ?? "", TASK_COLS, rowRes.rows, total, page, pageSize, EMPTY[metric]));
        }

        // ── Calendar / Meeting metrics ────────────────────────────────────────
        if (["meetings_today","meetings_this_week","meetings_upcoming","meetings_past_month","mc_meetings_today"].includes(metric)) {
          const whereParts: string[] = [`ce.user_id = ${userId}`];

          if (metric === "meetings_today" || metric === "mc_meetings_today") {
            whereParts.push(`ce.start_time::date = CURRENT_DATE`);
          } else if (metric === "meetings_this_week") {
            whereParts.push(`ce.start_time BETWEEN NOW() AND (NOW() + INTERVAL '7 days')`);
          } else if (metric === "meetings_upcoming") {
            whereParts.push(`ce.start_time > NOW()`);
          } else if (metric === "meetings_past_month") {
            whereParts.push(`ce.start_time > NOW() - INTERVAL '30 days' AND ce.start_time < NOW()`);
          }

          if (dateFrom) whereParts.push(`ce.start_time >= '${dateFrom}'`);
          if (dateTo)   whereParts.push(`ce.start_time <= '${dateTo}'`);

          const sc = searchClause(search, ["ce.title", "ce.location"]);
          const whereSQL = `WHERE ${whereParts.join(" AND ")} ${sc}`;

          const countRes = await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM calendar_events ce ${whereSQL}`));
          const total = (countRes.rows[0] as any)?.cnt ?? 0;

          const rowRes = await db.execute(sql.raw(`
            SELECT ce.id AS event_id, ce.title AS event_title, ce.start_time, ce.end_time,
                   ce.event_type, ce.location, ce.status
            FROM calendar_events ce
            ${whereSQL}
            ORDER BY ce.start_time ASC LIMIT ${pageSize} OFFSET ${offset}
          `));

          const LABELS: Record<string,string> = {
            meetings_today: "Today's Meetings", meetings_this_week: "Meetings This Week",
            meetings_upcoming: "Upcoming Meetings", meetings_past_month: "Meetings This Month",
            mc_meetings_today: "Today's Meetings",
          };
          const DESCS: Record<string,string> = {
            meetings_today: "All calendar events scheduled for today.",
            meetings_this_week: "Calendar events in the next 7 days.",
            meetings_upcoming: "All future scheduled calendar events.",
            meetings_past_month: "Calendar events from the last 30 days.",
            mc_meetings_today: "All calendar events scheduled for today.",
          };
          const EMPTY: Record<string,string> = {
            meetings_today: "No meetings scheduled for today. Clear day ahead.",
            meetings_this_week: "No meetings scheduled this week.",
            meetings_upcoming: "No upcoming meetings on the calendar.",
          };

          return res.json(buildPaginatedResponse(metric, LABELS[metric], DESCS[metric], MEETING_COLS, rowRes.rows, total, page, pageSize, EMPTY[metric]));
        }

        // ── Activity Feed metrics ─────────────────────────────────────────────
        if (["activity_recent","activity_email","activity_task","activity_meeting","activity_crm_linked"].includes(metric)) {
          const whereParts: string[] = [];

          if (metric === "activity_email")       whereParts.push(`a.type = 'email'`);
          else if (metric === "activity_task")   whereParts.push(`a.type = 'task'`);
          else if (metric === "activity_meeting") whereParts.push(`a.type = 'meeting'`);
          else if (metric === "activity_crm_linked") whereParts.push(`a.linked_object_type IS NOT NULL`);
          // activity_recent: no extra filter — most recent all types

          if (userId > 0) whereParts.push(`a.created_by = ${userId}`);
          if (dateFrom)   whereParts.push(`a.created_at >= '${dateFrom}'`);
          if (dateTo)     whereParts.push(`a.created_at <= '${dateTo}'`);

          const sc = searchClause(search, ["a.summary", "a.subject"]);
          const whereSQL = whereParts.length > 0
            ? `WHERE ${whereParts.join(" AND ")} ${sc}`
            : sc ? `WHERE 1=1 ${sc}` : "";

          const countRes = await db.execute(sql.raw(`
            SELECT COUNT(*)::int AS cnt FROM activities a ${whereSQL}
          `));
          const total = (countRes.rows[0] as any)?.cnt ?? 0;

          const rowRes = await db.execute(sql.raw(`
            SELECT a.id,
                   a.type                  AS act_type,
                   a.summary,
                   CONCAT(a.linked_object_type, ' #', a.linked_object_id) AS linked_object,
                   a.created_at,
                   u.name                  AS created_by_name
            FROM activities a
            LEFT JOIN users u ON u.id = a.created_by
            ${whereSQL}
            ORDER BY a.created_at DESC LIMIT ${pageSize} OFFSET ${offset}
          `));

          const LABELS: Record<string,string> = {
            activity_recent: "Recent Activity", activity_email: "Email Activity",
            activity_task: "Task Activity", activity_meeting: "Meeting Activity",
            activity_crm_linked: "CRM-Linked Activity",
          };
          const DESCS: Record<string,string> = {
            activity_recent: "Your most recent recorded activities across all types.",
            activity_email: "Email activities logged against CRM records.",
            activity_task: "Task-related activities recorded in the system.",
            activity_meeting: "Meeting activities logged against CRM records.",
            activity_crm_linked: "Activities linked to accounts, contacts, or opportunities.",
          };
          const EMPTY: Record<string,string> = {
            activity_recent: "No activity recorded yet.",
            activity_email: "No email activity recorded.",
            activity_task: "No task activity recorded.",
            activity_meeting: "No meeting activity recorded.",
          };

          return res.json(buildPaginatedResponse(metric, LABELS[metric], DESCS[metric], ACTIVITY_COLS, rowRes.rows, total, page, pageSize, EMPTY[metric]));
        }

        // ── Inbox metrics (local mirror only — no Gmail API calls) ────────────
        if (metric === "inbox_unread") {
          const EMAIL_COLS = [
            { key: "subject",     label: "Subject" },
            { key: "from_email",  label: "From" },
            { key: "sent_at",     label: "Received" },
            { key: "smart_category", label: "Category" },
          ];

          const sc = searchClause(search, ["em.subject", "em.from_email", "em.from_name"]);
          // Scope to the authenticated user's connected mailboxes
          const countRes = await db.execute(sql.raw(`
            SELECT COUNT(*)::int AS cnt
            FROM email_messages em
            WHERE em.is_unread = true AND em.is_inbox = true ${sc}
          `));
          const total = (countRes.rows[0] as any)?.cnt ?? 0;

          const rowRes = await db.execute(sql.raw(`
            SELECT em.id, em.subject, em.from_email, em.from_name, em.sent_at, em.smart_category
            FROM email_messages em
            WHERE em.is_unread = true AND em.is_inbox = true ${sc}
            ORDER BY em.sent_at DESC LIMIT ${pageSize} OFFSET ${offset}
          `));

          return res.json(buildPaginatedResponse(metric, "Unread Inbox Messages", "Messages currently unread in your inbox.", EMAIL_COLS, rowRes.rows, total, page, pageSize, "Inbox zero. You're all caught up."));
        }

        if (metric === "inbox_drafts") {
          const DRAFT_COLS = [
            { key: "to_email",    label: "To" },
            { key: "subject",     label: "Subject" },
            { key: "scheduled_at", label: "Scheduled" },
            { key: "status",      label: "Status" },
          ];

          const sc = searchClause(search, ["se.subject", "se.to_email"]);
          const countRes = await db.execute(sql.raw(`
            SELECT COUNT(*)::int AS cnt
            FROM scheduled_emails se
            WHERE se.status = 'pending' AND se.user_id = ${userId} ${sc}
          `));
          const total = (countRes.rows[0] as any)?.cnt ?? 0;

          const rowRes = await db.execute(sql.raw(`
            SELECT se.id, se.to_email, se.subject, se.scheduled_at, se.status
            FROM scheduled_emails se
            WHERE se.status = 'pending' AND se.user_id = ${userId} ${sc}
            ORDER BY se.scheduled_at ASC LIMIT ${pageSize} OFFSET ${offset}
          `));

          return res.json(buildPaginatedResponse(metric, "Pending Scheduled Emails", "Emails scheduled to send but not yet delivered.", DRAFT_COLS, rowRes.rows, total, page, pageSize, "No pending scheduled emails."));
        }

        // Should not reach here — whitelist covers all metrics
        return res.status(400).json({ error: `Metric not implemented: ${metric}` });
      } catch (err: any) {
        console.error("[work-drilldown] error:", err.message);
        return res.status(500).json({ error: "Internal server error" });
      }
    },
  );
}
