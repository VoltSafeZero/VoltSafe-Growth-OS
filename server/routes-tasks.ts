import type { Express, Request } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { requirePermission } from "./auth";
import { saveMentions } from "./services/mention-service";

// ── System columns: permanent, shared, always present for every user ─────────
export const SYSTEM_COLUMNS = [
  { value: "backlog",     label: "Backlog",               color: "slate"   },
  { value: "blocked",     label: "Blocked",               color: "amber"   },
  { value: "delegated",   label: "Delegated",             color: "violet"  },
  { value: "today_tasks", label: "Today's Tasks",         color: "teal"    },
  { value: "done",        label: "Done",                  color: "emerald" },
] as const;
const SYSTEM_COL_SLUGS = new Set(SYSTEM_COLUMNS.map(c => c.value));
const USER_COL_RE = /^u(\d+)_([a-z0-9_]{1,32})$/;
const ALLOWED_COL_COLORS = new Set([
  "slate","blue","violet","amber","emerald","rose","teal","red","orange","cyan","pink","lime",
]);
const SLUG_RE = /^[a-z0-9_]{1,32}$/;

// Kept for backward compat — now just returns system column slugs
async function loadCustomColumnValues(): Promise<string[]> {
  return SYSTEM_COLUMNS.map(c => c.value);
}

// Load all columns visible to a specific user:
//   1. The 4 permanent system columns
//   2. User's own personal columns
//   3. Personal columns of other users shared with this user
async function loadColumnsForUser(userId: number): Promise<{value: string; label: string; color: string}[]> {
  const cols: {value: string; label: string; color: string}[] = [...SYSTEM_COLUMNS];
  try {
    const own: any = await db.execute(sql`
      SELECT slug, label, color FROM user_task_columns
      WHERE user_id = ${userId} ORDER BY sort_order, id
    `);
    for (const r of (own.rows ?? [])) {
      cols.push({ value: `u${userId}_${r.slug}`, label: r.label, color: r.color });
    }
    const sharedSlugs: any = await db.execute(sql`
      SELECT DISTINCT column_slug FROM task_column_shares WHERE shared_with_user_id = ${userId}
    `);
    for (const r of (sharedSlugs.rows ?? [])) {
      const slug = r.column_slug as string;
      if (cols.find(c => c.value === slug)) continue;
      const m = slug.match(USER_COL_RE);
      if (!m) continue;
      const ownId = Number(m[1]);
      const bareSlug = m[2];
      const cd: any = await db.execute(sql`
        SELECT label, color FROM user_task_columns
        WHERE user_id = ${ownId} AND slug = ${bareSlug} LIMIT 1
      `);
      if (cd.rows?.[0]) cols.push({ value: slug, label: cd.rows[0].label, color: cd.rows[0].color });
    }
  } catch { /* tables may not exist yet on first boot */ }
  return cols;
}

function uid(req: Request): number | null {
  const u = (req.session as any)?.userId;
  return typeof u === "number" ? u : null;
}

function isAdmin(req: Request): boolean {
  const r = (req.session as any)?.globalRole;
  return r === "master_admin" || r === "admin";
}

function isMasterAdmin(req: Request): boolean {
  return (req.session as any)?.globalRole === "master_admin";
}

// Check if userId has hub-access permission to view targetUserId's tasks.
// Admins always have access. Other users need an explicit non-revoked grant.
async function checkHubAccess(viewerId: number, targetId: number, adminOverride: boolean): Promise<"edit" | "view" | null> {
  if (adminOverride) return "edit";
  if (viewerId === targetId) return "edit";
  try {
    const row: any = await db.execute(sql`
      SELECT permission_level FROM task_hub_access_permissions
      WHERE viewer_user_id = ${viewerId} AND target_user_id = ${targetId} AND revoked_at IS NULL
      LIMIT 1
    `);
    const level = row.rows?.[0]?.permission_level;
    if (level === "edit") return "edit";
    if (level === "view") return "view";
  } catch { /* table may not exist yet */ }
  return null;
}

// Object-level authorization guard for individual task endpoints.
//
// A caller may access a task if ANY of the following hold:
//   • they are the task's owner_user_id (edit)
//   • they are the task's created_by_user_id (edit — delegation)
//   • they are an admin (edit)
//   • they hold a hub-access grant to the task owner:
//       "edit" grant → write access (readOnly=false)
//       "view" grant → read access only (readOnly=true)
//
// Returns the task's ownership row on success, or sends a 401/403/404
// response and returns null so the caller can early-return.
async function requireTaskAccess(
  req: Request,
  res: any,
  taskId: number,
  readOnly = false,
): Promise<{ owner_user_id: number | null; created_by_user_id: number | null } | null> {
  const taskRow: any = await db.execute(sql`
    SELECT owner_user_id, created_by_user_id FROM tasks WHERE id = ${taskId} LIMIT 1
  `);
  const task = taskRow.rows?.[0] ?? null;
  if (!task) {
    res.status(404).json({ message: "Not found" });
    return null;
  }
  const userId = uid(req);
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return null;
  }
  // Owner, creator, or admin always have full edit access
  if (task.owner_user_id === userId || task.created_by_user_id === userId || isAdmin(req)) {
    return task;
  }
  // Hub-access delegation
  const ownerId: number | null = task.owner_user_id ?? null;
  if (ownerId !== null) {
    const level = await checkHubAccess(userId, ownerId, false);
    if (readOnly && level !== null) return task;
    if (!readOnly && level === "edit") return task;
  }
  res.status(403).json({ message: "Access denied" });
  return null;
}

async function logActivity(
  taskId: number,
  userId: number | null,
  action: string,
  fromValue?: string | null,
  toValue?: string | null,
  meta?: any,
) {
  await db.execute(sql`
    INSERT INTO task_activity (task_id, user_id, action, from_value, to_value, meta)
    VALUES (${taskId}, ${userId}, ${action}, ${fromValue ?? null}, ${toValue ?? null}, ${meta ? JSON.stringify(meta) : null})
  `);
}

// ── Notification helpers ───────────────────────────────────────────────────
// Insert a row into the notifications table for the recipient. Idempotent via
// dedupe_key on the notifications table.
async function notifyUser(args: {
  userId: number;
  type: string;
  title: string;
  body?: string | null;
  severity?: "high" | "medium" | "low";
  taskId: number;
  dedupeKey: string;
}) {
  if (!args.userId) return;
  try {
    await db.execute(sql`
      INSERT INTO notifications
        (user_id, type, title, body, severity, linked_object_type, linked_object_id, action_url, dedupe_key, is_read, created_at)
      VALUES
        (${args.userId}, ${args.type}, ${args.title}, ${args.body ?? null},
         ${args.severity ?? "medium"}, 'task', ${args.taskId},
         ${'/execution/tasks?taskId=' + args.taskId}, ${args.dedupeKey}, false, NOW())
      ON CONFLICT (dedupe_key) DO NOTHING
    `);
  } catch (err: any) {
    console.warn("[notifyUser]", err.message);
  }
}

async function getTaskMeta(taskId: number) {
  const r: any = await db.execute(sql`
    SELECT t.id, t.title, t.owner_user_id, t.created_by_user_id,
           ou.name AS owner_name
    FROM tasks t LEFT JOIN users ou ON ou.id = t.owner_user_id
    WHERE t.id = ${taskId} LIMIT 1`);
  return r.rows?.[0] ?? null;
}

async function getActorName(userId: number | null): Promise<string> {
  if (!userId) return "Someone";
  const r: any = await db.execute(sql`SELECT name FROM users WHERE id = ${userId}`);
  return r.rows?.[0]?.name ?? "Someone";
}

// Notify the new owner (and optionally the previous one) when a task is reassigned.
async function notifyAssignment(taskId: number, prevOwnerId: number | null, newOwnerId: number | null, actorId: number | null) {
  if (newOwnerId === prevOwnerId) return;
  const t = await getTaskMeta(taskId);
  if (!t) return;
  const actorName = await getActorName(actorId);
  const stamp = Date.now();
  if (newOwnerId && newOwnerId !== actorId) {
    await notifyUser({
      userId: newOwnerId,
      type: "task_assigned",
      title: prevOwnerId ? `Task reassigned to you: ${t.title}` : `Task assigned to you: ${t.title}`,
      body: `${actorName} ${prevOwnerId ? "reassigned" : "assigned"} this task to you`,
      severity: "medium",
      taskId,
      dedupeKey: `task-assign-${taskId}-${newOwnerId}-${stamp}`,
    });
  }
  if (prevOwnerId && prevOwnerId !== actorId && prevOwnerId !== newOwnerId) {
    await notifyUser({
      userId: prevOwnerId,
      type: "task_reassigned_away",
      title: `Task reassigned away: ${t.title}`,
      body: `${actorName} reassigned this task to someone else`,
      severity: "low",
      taskId,
      dedupeKey: `task-reassign-away-${taskId}-${prevOwnerId}-${stamp}`,
    });
  }
}

// Notify creator + watchers when a task is completed.
async function notifyCompletion(taskId: number, actorId: number | null) {
  const t = await getTaskMeta(taskId);
  if (!t) return;
  const actorName = await getActorName(actorId);
  const recipients = new Set<number>();
  if (t.created_by_user_id && t.created_by_user_id !== actorId) recipients.add(t.created_by_user_id);
  const w: any = await db.execute(sql`SELECT user_id FROM task_watchers WHERE task_id = ${taskId}`);
  for (const row of (w.rows ?? [])) {
    if (row.user_id !== actorId) recipients.add(row.user_id);
  }
  const stamp = Date.now();
  for (const uid of recipients) {
    await notifyUser({
      userId: uid,
      type: "task_completed",
      title: `Task completed: ${t.title}`,
      body: `${actorName} marked this task complete`,
      severity: "low",
      taskId,
      dedupeKey: `task-complete-${taskId}-${uid}-${stamp}`,
    });
  }
}

// When a dependency is removed OR the task it depends on is completed, check
// every dependent task — if it now has zero open deps, ping its owner.
async function notifyDependencyUnblock(completedOrRemovedTaskId: number, actorId: number | null) {
  // Find dependents of the just-completed task
  const deps: any = await db.execute(sql`
    SELECT DISTINCT d.task_id FROM task_dependencies d
    WHERE d.depends_on_task_id = ${completedOrRemovedTaskId}`);
  const stamp = Date.now();
  for (const row of (deps.rows ?? [])) {
    const tid = row.task_id;
    const open: any = await db.execute(sql`
      SELECT COUNT(*)::int AS open FROM task_dependencies d
      JOIN tasks t ON t.id = d.depends_on_task_id
      WHERE d.task_id = ${tid} AND t.status NOT IN ('completed','done')`);
    if ((open.rows?.[0]?.open ?? 0) > 0) continue;
    const t = await getTaskMeta(tid);
    if (!t || !t.owner_user_id) continue;
    if (t.owner_user_id === actorId) continue;
    await notifyUser({
      userId: t.owner_user_id,
      type: "task_unblocked",
      title: `Task unblocked: ${t.title}`,
      body: "All dependencies are now complete — you're clear to start",
      severity: "medium",
      taskId: tid,
      dedupeKey: `task-unblock-${tid}-${stamp}`,
    });
  }
}

async function loadTaskFull(taskId: number) {
  const taskRes: any = await db.execute(sql`
    SELECT
      t.*,
      cu.name AS creator_name,
      ou.name AS owner_name,
      cb.name AS completed_by_name,
      lu.name AS last_updated_by_name,
      a.name AS account_name,
      co.name AS contact_name,
      l.company AS lead_name
    FROM tasks t
    LEFT JOIN users cu ON cu.id = t.created_by_user_id
    LEFT JOIN users ou ON ou.id = t.owner_user_id
    LEFT JOIN users cb ON cb.id = t.completed_by_user_id
    LEFT JOIN users lu ON lu.id = t.last_updated_by_user_id
    LEFT JOIN accounts a ON a.id = t.account_id
    LEFT JOIN contacts co ON co.id = COALESCE(t.contact_id, CASE WHEN t.linked_object_type = 'contact' THEN t.linked_object_id END)
    LEFT JOIN leads l ON l.id = t.linked_object_id AND t.linked_object_type = 'lead'
    WHERE t.id = ${taskId}
    LIMIT 1
  `);
  const task = taskRes.rows?.[0];
  if (!task) return null;

  const [labelsRes, depsRes, blockingRes, checklistsRes, itemsRes, watchersRes, activityRes] = await Promise.all([
    db.execute(sql`
      SELECT l.id, l.name, l.color
      FROM task_label_assignments la JOIN task_labels l ON l.id = la.label_id
      WHERE la.task_id = ${taskId} ORDER BY l.name`),
    db.execute(sql`
      SELECT d.id, d.depends_on_task_id, t2.title, t2.status, t2.completed_at, t2.board_column
      FROM task_dependencies d JOIN tasks t2 ON t2.id = d.depends_on_task_id
      WHERE d.task_id = ${taskId} ORDER BY d.created_at`),
    db.execute(sql`
      SELECT d.id, d.task_id, t2.title, t2.status, t2.board_column
      FROM task_dependencies d JOIN tasks t2 ON t2.id = d.task_id
      WHERE d.depends_on_task_id = ${taskId} ORDER BY d.created_at`),
    db.execute(sql`SELECT * FROM task_checklists WHERE task_id = ${taskId} ORDER BY sort_order, id`),
    db.execute(sql`
      SELECT i.* FROM task_checklist_items i
      JOIN task_checklists c ON c.id = i.checklist_id
      WHERE c.task_id = ${taskId}
      ORDER BY i.sort_order, i.id`),
    db.execute(sql`
      SELECT u.id, u.name FROM task_watchers w JOIN users u ON u.id = w.user_id
      WHERE w.task_id = ${taskId} ORDER BY u.name`),
    db.execute(sql`
      SELECT a.*, u.name AS user_name
      FROM task_activity a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.task_id = ${taskId} ORDER BY a.created_at DESC LIMIT 100`),
  ]);

  const items = (itemsRes as any).rows ?? [];
  const checklists = ((checklistsRes as any).rows ?? []).map((c: any) => ({
    ...c,
    items: items.filter((it: any) => it.checklist_id === c.id),
  }));

  const dependencies = (depsRes as any).rows ?? [];
  const isBlocked = dependencies.some((d: any) => d.completed_at == null && d.status !== "completed" && d.status !== "done");

  return {
    task,
    labels: (labelsRes as any).rows ?? [],
    dependencies,
    blocking: (blockingRes as any).rows ?? [],
    checklists,
    watchers: (watchersRes as any).rows ?? [],
    activity: (activityRes as any).rows ?? [],
    isBlocked,
  };
}

// ── Recurring: calculate next due date and spawn a new task instance ─────────
async function spawnNextOccurrence(taskId: number, actorId: number) {
  const r: any = await db.execute(sql`SELECT * FROM tasks WHERE id = ${taskId} LIMIT 1`);
  const t = r.rows?.[0];
  if (!t || !t.recurrence_rule || t.recurrence_rule === "none") return;

  const base = t.due_date ? new Date(t.due_date) : new Date();
  const next = new Date(base);
  switch (t.recurrence_rule) {
    case "daily":     next.setDate(next.getDate() + 1); break;
    case "weekly":    next.setDate(next.getDate() + 7); break;
    case "biweekly":  next.setDate(next.getDate() + 14); break;
    case "monthly":   next.setMonth(next.getMonth() + 1); break;
    case "quarterly": next.setMonth(next.getMonth() + 3); break;
    case "yearly":    next.setFullYear(next.getFullYear() + 1); break;
    default: return;
  }
  if (t.recurrence_end_date && next > new Date(t.recurrence_end_date)) return;

  const prevCol = t.board_column === "done" ? "todo" : (t.board_column || "todo");
  const newTask: any = await db.execute(sql`
    INSERT INTO tasks (
      title, description, priority, owner_user_id, created_by_user_id,
      linked_object_type, linked_object_id, account_id,
      board_column, status, due_date, source,
      recurrence_rule, recurrence_end_date,
      created_at, updated_at
    ) VALUES (
      ${t.title}, ${t.description}, ${t.priority}, ${t.owner_user_id}, ${actorId},
      ${t.linked_object_type}, ${t.linked_object_id}, ${t.account_id},
      ${prevCol}, 'pending', ${next}, 'recurring',
      ${t.recurrence_rule}, ${t.recurrence_end_date},
      NOW(), NOW()
    ) RETURNING id
  `);
  const newId = newTask.rows?.[0]?.id;
  if (!newId) return;
  await db.execute(sql`
    INSERT INTO task_label_assignments (task_id, label_id, created_at)
    SELECT ${newId}, label_id, NOW() FROM task_label_assignments WHERE task_id = ${taskId}
    ON CONFLICT DO NOTHING
  `);
  console.log(`[recurrence] spawned next occurrence task ${newId} from task ${taskId} (rule=${t.recurrence_rule} next=${next.toISOString().slice(0,10)})`);
}

export function registerTaskRoutes(app: Express, requireAuth: any) {
  const canView = requirePermission("crm", "view");
  const canEdit = requirePermission("crm", "edit");

  // ── CRM auto-link rules: bootstrap (idempotent) ─────────────────────────
  db.execute(sql`
    CREATE TABLE IF NOT EXISTS crm_auto_link_rules (
      id SERIAL PRIMARY KEY,
      domain TEXT NOT NULL,
      object_type TEXT NOT NULL,
      object_id INTEGER NOT NULL,
      object_name TEXT,
      created_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(domain, object_type, object_id)
    )
  `).then(() => console.log("[migration] CRM auto-link rules schema migration complete."))
    .catch(e => console.error("[crm-auto-link-rules] migration error:", e.message));

  // ── Task Hub Access Permissions: bootstrap (idempotent) ─────────────────
  db.execute(sql`
    CREATE TABLE IF NOT EXISTS task_hub_access_permissions (
      id SERIAL PRIMARY KEY,
      viewer_user_id INTEGER NOT NULL,
      target_user_id INTEGER NOT NULL,
      permission_level TEXT NOT NULL DEFAULT 'view',
      created_by_user_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ,
      UNIQUE(viewer_user_id, target_user_id)
    )
  `).then(() => console.log("[migration] task_hub_access_permissions ready."))
    .catch(e => console.error("[task-hub-access] migration error:", e.message));

  // ── Column shares: bootstrap (idempotent) ────────────────────────────────
  db.execute(sql`
    CREATE TABLE IF NOT EXISTS task_column_shares (
      id SERIAL PRIMARY KEY,
      column_slug TEXT NOT NULL,
      shared_by_user_id INTEGER NOT NULL,
      shared_with_user_id INTEGER NOT NULL,
      permission TEXT NOT NULL DEFAULT 'view',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(column_slug, shared_with_user_id)
    )
  `).then(() => console.log("[migration] Column shares schema migration complete."))
    .catch(e => console.error("[task-column-shares] migration error:", e.message));

  // ── Recurrence columns: bootstrap (idempotent) ───────────────────────────
  db.execute(sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_rule TEXT NOT NULL DEFAULT 'none'`)
    .then(() => db.execute(sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_end_date TIMESTAMPTZ`))
    .then(() => console.log("[migration] Task recurrence columns ready."))
    .catch(e => console.error("[task-recurrence] migration error:", e.message));

  // ── Team Task flag + assignment audit columns: bootstrap (idempotent) ────
  // Additive only — defaults to false so existing tasks are never
  // retroactively flagged as Team Tasks.
  db.execute(sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_team_task BOOLEAN NOT NULL DEFAULT false`)
    .then(() => db.execute(sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ`))
    .then(() => db.execute(sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_by_user_id INTEGER`))
    .then(() => console.log("[migration] Team Task columns ready."))
    .catch(e => console.error("[team-task] migration error:", e.message));

  // ── Per-user personal columns: bootstrap ─────────────────────────────────
  db.execute(sql`
    CREATE TABLE IF NOT EXISTS user_task_columns (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      slug TEXT NOT NULL,
      label TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT 'slate',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, slug)
    )
  `).then(async () => {
    console.log("[migration] User task columns schema migration complete.");
    // One-time: migrate old workspace custom columns to master_admin's personal columns
    try {
      const adminRow: any = await db.execute(sql`SELECT id FROM users WHERE global_role = 'master_admin' LIMIT 1`);
      const adminId = adminRow.rows?.[0]?.id;
      if (!adminId) return;
      const settingsRow: any = await db.execute(sql`SELECT value FROM system_settings WHERE key = 'task_columns' LIMIT 1`);
      if (!settingsRow.rows?.[0]) return;
      const parsed = JSON.parse(settingsRow.rows[0].value);
      const oldCols = (parsed.columns || []).filter((c: any) => !SYSTEM_COL_SLUGS.has(c.value));
      for (let i = 0; i < oldCols.length; i++) {
        const col = oldCols[i];
        if (!SLUG_RE.test(col.value)) continue;
        await db.execute(sql`
          INSERT INTO user_task_columns (user_id, slug, label, color, sort_order)
          VALUES (${adminId}, ${col.value}, ${col.label || col.value}, ${col.color || 'slate'}, ${i})
          ON CONFLICT (user_id, slug) DO NOTHING
        `);
        // Re-slug tasks: old bare slug → u{adminId}_{slug}
        await db.execute(sql.raw(
          `UPDATE tasks SET board_column = 'u${adminId}_${col.value}' WHERE board_column = '${col.value}'`
        ));
      }
    } catch (e: any) {
      console.warn("[user-task-columns] old-col migration warning:", e.message);
    }
  }).catch(e => console.error("[user-task-columns] migration error:", e.message));

  // ── Full task detail ──────────────────────────────────────────────────────
  app.get("/api/tasks/:id/full", canView, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
      if (!await requireTaskAccess(req, res, id, true)) return;
      const data = await loadTaskFull(id);
      if (!data) return res.status(404).json({ message: "Not found" });
      res.json(data);
    } catch (err: any) {
      console.error("[tasks/:id/full]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Board view: all open tasks grouped by column ──────────────────────────
  app.get("/api/tasks/board", canView, async (req, res) => {
    try {
      const userId = uid(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const view = String(req.query.view || "my");
      const admin = isAdmin(req);

      // Team Tasks board is a global, flag-scoped view — every user (admin or
      // not) sees the exact same set of tasks explicitly flagged is_team_task.
      // It intentionally ignores viewingUserId / ownership entirely so it
      // never leaks into (or gets confused with) another user's personal board.
      if (view === "team") {
        const rows: any = await db.execute(sql.raw(`
          SELECT
            t.id, t.title, t.description, t.status, t.priority,
            t.due_date AS "dueDate", t.start_date AS "startDate",
            t.completed_at AS "completedAt", t.completed_by_user_id AS "completedByUserId",
            t.board_column AS "boardColumn", t.sort_order AS "sortOrder",
            t.linked_object_type AS "linkedObjectType", t.linked_object_id AS "linkedObjectId",
            t.account_id AS "accountId", t.owner_user_id AS "ownerUserId",
            t.created_by_user_id AS "createdByUserId",
            t.is_team_task AS "isTeamTask", t.assigned_at AS "assignedAt",
            t.assigned_by_user_id AS "assignedByUserId",
            ou.name AS "ownerName", cu.name AS "creatorName", ab.name AS "assignedByName",
            cb.name AS "completedByName", a.name AS "accountName",
            l.company AS "leadName",
            t.recurrence_rule AS "recurrenceRule",
            (SELECT COUNT(*) FROM task_checklist_items i JOIN task_checklists c ON c.id = i.checklist_id WHERE c.task_id = t.id)::int AS "checklistTotal",
            (SELECT COUNT(*) FROM task_checklist_items i JOIN task_checklists c ON c.id = i.checklist_id WHERE c.task_id = t.id AND i.completed = true)::int AS "checklistDone",
            (SELECT COUNT(*) FROM comments WHERE object_type='task' AND object_id=t.id)::int AS "commentsCount",
            (SELECT COUNT(*) FROM task_dependencies d JOIN tasks t2 ON t2.id = d.depends_on_task_id WHERE d.task_id = t.id AND t2.status NOT IN ('done','completed'))::int AS "openDependencies",
            (SELECT COUNT(*) FROM task_dependencies d WHERE d.task_id = t.id)::int AS "totalDependencies",
            ARRAY(
              SELECT json_build_object('id', l.id, 'name', l.name, 'color', l.color)
              FROM task_label_assignments la JOIN task_labels l ON l.id = la.label_id
              WHERE la.task_id = t.id
            ) AS labels
          FROM tasks t
          LEFT JOIN users ou ON ou.id = t.owner_user_id
          LEFT JOIN users cu ON cu.id = t.created_by_user_id
          LEFT JOIN users ab ON ab.id = t.assigned_by_user_id
          LEFT JOIN users cb ON cb.id = t.completed_by_user_id
          LEFT JOIN accounts a ON a.id = t.account_id
          LEFT JOIN leads l ON l.id = t.linked_object_id AND t.linked_object_type = 'lead'
          WHERE t.archived = false AND t.is_team_task = true
          ORDER BY t.sort_order ASC, t.due_date ASC NULLS LAST, t.id DESC
          LIMIT 1000
        `));
        const tasks: any[] = (rows as any).rows ?? [];
        // Team board always uses the shared system columns (not any single
        // user's personal columns) since it's a cross-user board.
        const colValues = SYSTEM_COLUMNS.map(c => c.value);
        const colSet = new Set(colValues);
        const fallback = "backlog";
        const grouped: Record<string, any[]> = {};
        for (const v of colValues) grouped[v] = [];
        for (const t of tasks) {
          let col = String(t.boardColumn || fallback);
          if (!colSet.has(col)) col = fallback;
          if (col !== "done" && t.openDependencies > 0) col = "blocked";
          grouped[col].push(t);
        }
        return res.json({ columns: colValues, grouped, total: tasks.length });
      }

      // Hub-access delegation: if viewingUserId is provided, verify access before showing that user's board.
      const rawViewingId = req.query.viewingUserId ? Number(req.query.viewingUserId) : null;
      let effectiveUserId = userId;
      if (rawViewingId && Number.isFinite(rawViewingId) && rawViewingId !== userId) {
        const accessLevel = await checkHubAccess(userId, rawViewingId, admin);
        if (!accessLevel) return res.status(403).json({ message: "Access denied to that user's tasks" });
        effectiveUserId = rawViewingId;
      }

      // Build the WHERE clause filter for this view:
      //   assigned_by_me → tasks I created but assigned to someone else
      //   anything else → only tasks assigned to me (or delegated by me)
      let whereFilter = "";
      if (view === "assigned_by_me") {
        whereFilter = `AND t.created_by_user_id = ${effectiveUserId} AND t.owner_user_id IS NOT NULL AND t.owner_user_id != ${effectiveUserId}`;
      } else {
        // Default: effective user's assigned tasks + tasks they created and delegated to others
        whereFilter = `AND (t.owner_user_id = ${effectiveUserId} OR (t.created_by_user_id = ${effectiveUserId} AND t.owner_user_id IS NOT NULL AND t.owner_user_id != ${effectiveUserId}))`;
      }

      const rows: any = await db.execute(sql.raw(`
        SELECT
          t.id, t.title, t.description, t.status, t.priority,
          t.due_date AS "dueDate", t.start_date AS "startDate",
          t.completed_at AS "completedAt", t.completed_by_user_id AS "completedByUserId",
          t.board_column AS "boardColumn", t.sort_order AS "sortOrder",
          t.linked_object_type AS "linkedObjectType", t.linked_object_id AS "linkedObjectId",
          t.account_id AS "accountId", t.owner_user_id AS "ownerUserId",
          t.created_by_user_id AS "createdByUserId",
          ou.name AS "ownerName", cu.name AS "creatorName",
          cb.name AS "completedByName", a.name AS "accountName",
          l.company AS "leadName",
          t.recurrence_rule AS "recurrenceRule",
          (SELECT COUNT(*) FROM task_checklist_items i JOIN task_checklists c ON c.id = i.checklist_id WHERE c.task_id = t.id)::int AS "checklistTotal",
          (SELECT COUNT(*) FROM task_checklist_items i JOIN task_checklists c ON c.id = i.checklist_id WHERE c.task_id = t.id AND i.completed = true)::int AS "checklistDone",
          (SELECT COUNT(*) FROM comments WHERE object_type='task' AND object_id=t.id)::int AS "commentsCount",
          (SELECT COUNT(*) FROM task_dependencies d JOIN tasks t2 ON t2.id = d.depends_on_task_id WHERE d.task_id = t.id AND t2.status NOT IN ('done','completed'))::int AS "openDependencies",
          (SELECT COUNT(*) FROM task_dependencies d WHERE d.task_id = t.id)::int AS "totalDependencies",
          ARRAY(
            SELECT json_build_object('id', l.id, 'name', l.name, 'color', l.color)
            FROM task_label_assignments la JOIN task_labels l ON l.id = la.label_id
            WHERE la.task_id = t.id
          ) AS labels
        FROM tasks t
        LEFT JOIN users ou ON ou.id = t.owner_user_id
        LEFT JOIN users cu ON cu.id = t.created_by_user_id
        LEFT JOIN users cb ON cb.id = t.completed_by_user_id
        LEFT JOIN accounts a ON a.id = t.account_id
        LEFT JOIN leads l ON l.id = t.linked_object_id AND t.linked_object_type = 'lead'
        WHERE t.archived = false ${whereFilter}
        ORDER BY t.sort_order ASC, t.due_date ASC NULLS LAST, t.id DESC
        LIMIT 1000
      `));

      const tasks: any[] = (rows as any).rows ?? [];
      // Use the effective user's currently configured columns so custom columns
      // appear on the board. Anything pointing at an unknown column gets
      // dropped into "backlog" (the guaranteed fallback).
      const allCols = await loadColumnsForUser(effectiveUserId);
      const colValues = allCols.map(c => c.value);
      const colSet = new Set(colValues);
      const fallback = "backlog";
      const grouped: Record<string, any[]> = {};
      for (const v of colValues) grouped[v] = [];
      for (const t of tasks) {
        let col = String(t.boardColumn || fallback);
        if (!colSet.has(col)) col = fallback;
        // Auto-blocked override only applies when "blocked" is still a column
        if (col !== "done" && t.openDependencies > 0 && colSet.has("blocked")) col = "blocked";
        // Auto-delegated override: tasks effective user created but assigned to someone else → delegated column
        // Guard against completed tasks: check original boardColumn AND status so that a task
        // completed by its assignee (board_column='done', status='completed') doesn't leak back
        // into the delegated column after the fallback remaps 'done' → 'backlog' above.
        const isDone = String(t.boardColumn) === "done" || t.status === "completed" || t.status === "done";
        if (!isDone && t.createdByUserId === effectiveUserId && t.ownerUserId != null && t.ownerUserId !== effectiveUserId && colSet.has("delegated")) col = "delegated";
        grouped[col].push(t);
      }
      res.json({ columns: colValues, grouped, total: tasks.length });
    } catch (err: any) {
      console.error("[tasks/board]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Move/reorder card on the board ────────────────────────────────────────
  // canView (not canEdit): moving your own card on your personal board is a
  // personal workspace action and should be available to all CRM-visible users.
  app.patch("/api/tasks/:id/board", canView, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const userId = uid(req);
      if (!await requireTaskAccess(req, res, id)) return;
      const { boardColumn, sortOrder } = req.body || {};
      const isValidBoardCol = typeof boardColumn === "string" && (SLUG_RE.test(boardColumn) || USER_COL_RE.test(boardColumn));
      if (!isValidBoardCol) {
        return res.status(400).json({ message: "Invalid column" });
      }
      const allAllowedCols = await loadColumnsForUser(userId!);
      const allowedCols = allAllowedCols.map(c => c.value);
      if (!allowedCols.includes(boardColumn)) {
        return res.status(400).json({ message: "Unknown column" });
      }

      const cur: any = await db.execute(sql`SELECT board_column, status FROM tasks WHERE id = ${id} LIMIT 1`);
      const prev = cur.rows?.[0];
      if (!prev) return res.status(404).json({ message: "Not found" });

      // Block completion via drag if there are open dependencies
      if (boardColumn === "done") {
        const blocking: any = await db.execute(sql`
          SELECT COUNT(*)::int AS open FROM task_dependencies d
          JOIN tasks t ON t.id = d.depends_on_task_id
          WHERE d.task_id = ${id} AND t.status NOT IN ('completed','done')`);
        if ((blocking.rows?.[0]?.open ?? 0) > 0) {
          return res.status(400).json({ message: "Cannot complete: task has open dependencies" });
        }
      }

      // Sync status with column for done
      let statusUpdate = sql``;
      if (boardColumn === "done" && prev.status !== "completed" && prev.status !== "done") {
        statusUpdate = sql`, status = 'completed', completed_at = NOW(), completed_by_user_id = ${userId}`;
      } else if (boardColumn !== "done" && (prev.status === "completed" || prev.status === "done")) {
        statusUpdate = sql`, status = 'pending', completed_at = NULL, completed_by_user_id = NULL`;
      }

      await db.execute(sql`
        UPDATE tasks
        SET board_column = ${boardColumn},
            sort_order = ${Number(sortOrder ?? 0)},
            last_updated_by_user_id = ${userId},
            updated_at = NOW()
            ${statusUpdate}
        WHERE id = ${id}
      `);
      if (prev.board_column !== boardColumn) {
        await logActivity(id, userId, "moved", prev.board_column, boardColumn);
      }
      // Notifications when transitioning into/out of done via the board
      if (boardColumn === "done" && prev.status !== "completed" && prev.status !== "done") {
        await notifyCompletion(id, userId);
        await notifyDependencyUnblock(id, userId);
        await spawnNextOccurrence(id, userId);
      }
      res.json({ success: true });
    } catch (err: any) {
      console.error("[tasks/:id/board]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Generic patch (title/description/dueDate/priority/assignee) ───────────
  app.patch("/api/tasks/:id", canEdit, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const userId = uid(req);
      if (!await requireTaskAccess(req, res, id)) return;
      const body = req.body || {};
      const cur: any = await db.execute(sql`SELECT * FROM tasks WHERE id = ${id} LIMIT 1`);
      const prev = cur.rows?.[0];
      if (!prev) return res.status(404).json({ message: "Not found" });

      const fragments: any[] = [];
      const log: Array<[string, string | null, string | null]> = [];
      const setIf = (col: string, key: string, parse?: (v: any) => any, label?: string) => {
        if (key in body) {
          let v: any = body[key];
          if (parse) v = parse(v);
          fragments.push(sql`${sql.identifier(col)} = ${v}`);
          const before = (prev as any)[col];
          const beforeStr = before instanceof Date ? before.toISOString() : (before == null ? "" : String(before));
          const afterStr = v instanceof Date ? v.toISOString() : (v == null ? "" : String(v));
          if (beforeStr !== afterStr) {
            log.push([label || col, beforeStr || null, afterStr || null]);
          }
        }
      };
      // NOTE: status & boardColumn intentionally excluded — clients must use
      // /complete, /reopen, or /board to keep status<->column invariants in sync.
      setIf("title", "title", String, "title");
      setIf("description", "description", (v) => (v == null ? null : String(v)), "description");
      setIf("priority", "priority", String, "priority");
      setIf("due_date", "dueDate", (v) => (v ? new Date(v) : null), "due date");
      setIf("start_date", "startDate", (v) => (v ? new Date(v) : null), "start date");
      setIf("owner_user_id", "ownerUserId", (v) => (v == null ? null : Number(v)), "assignee");
      setIf("completion_notes", "completionNotes", (v) => (v == null ? null : String(v)), "completion notes");
      setIf("archived", "archived", Boolean, "archived");
      setIf("linked_object_type", "linkedObjectType", (v) => (v == null ? null : String(v)), "linked contact type");
      setIf("linked_object_id", "linkedObjectId", (v) => (v == null ? null : Number(v)), "linked contact");
      setIf("account_id", "accountId", (v) => (v == null ? null : Number(v)), "organization");
      setIf("contact_id", "contactId", (v) => (v == null ? null : Number(v)), "linked contact");
      setIf("recurrence_rule", "recurrenceRule", (v) => (v == null ? "none" : String(v)), "recurrence");
      setIf("recurrence_end_date", "recurrenceEndDate", (v) => (v ? new Date(v) : null), "recurrence end date");
      setIf("is_team_task", "isTeamTask", Boolean, "team task flag");

      // Reassignment of a Team Task: stamp who reassigned it, to/from whom, and
      // when — plus land the new assignee's copy back in Backlog (single-row
      // model, so this is a global column reset, matching the spec that a
      // reassigned Team Task should reappear in the new assignee's Backlog).
      const isTeamTaskAfter = "isTeamTask" in body ? Boolean(body.isTeamTask) : Boolean(prev.is_team_task);
      let reassignmentFragments: any[] = [];
      if ("ownerUserId" in body) {
        const newOwner = body.ownerUserId == null ? null : Number(body.ownerUserId);
        const prevOwner = prev.owner_user_id == null ? null : Number(prev.owner_user_id);
        if (isTeamTaskAfter && newOwner !== prevOwner) {
          reassignmentFragments.push(sql`assigned_at = NOW()`);
          reassignmentFragments.push(sql`assigned_by_user_id = ${userId}`);
          reassignmentFragments.push(sql`board_column = 'backlog'`);
        }
      }

      if (!fragments.length) return res.json({ success: true, noop: true });

      fragments.push(sql`last_updated_by_user_id = ${userId}`);
      fragments.push(sql`updated_at = NOW()`);
      fragments.push(...reassignmentFragments);
      const setClause = sql.join(fragments, sql`, `);
      await db.execute(sql`UPDATE tasks SET ${setClause} WHERE id = ${id}`);

      for (const [field, before, after] of log) {
        await logActivity(id, userId, `updated_${field.replace(/\s+/g, "_")}`, before, after);
      }
      // Notify on assignment changes
      if ("ownerUserId" in body) {
        const newOwner = body.ownerUserId == null ? null : Number(body.ownerUserId);
        const prevOwner = (prev as any).owner_user_id == null ? null : Number((prev as any).owner_user_id);
        if (newOwner !== prevOwner) {
          if (isTeamTaskAfter) {
            const prevName = prevOwner ? await getActorName(prevOwner) : "Unassigned";
            const newName = newOwner ? await getActorName(newOwner) : "Unassigned";
            await logActivity(id, userId, "reassigned", prevName, newName, { fromUserId: prevOwner, toUserId: newOwner });
          }
          await notifyAssignment(id, prevOwner, newOwner, userId);
        }
      }
      res.json({ success: true });
      // Fire-and-forget: notify @mentions in description or completionNotes
      if ("description" in body && typeof body.description === "string" && body.description.trim()) {
        const lnkType = prev.linked_object_type; const lnkId = prev.linked_object_id ? Number(prev.linked_object_id) : null;
        const deepLink = lnkType && lnkId ? `/${lnkType === "lead" ? "opportunities" : lnkType + "s"}/${lnkId}?task=${id}` : `/execution/tasks?task=${id}`;
        saveMentions({ body: body.description, entityType: "task_description", entityId: id, moduleKey: "tasks", moduleLabel: "Tasks", authorId: userId, deepLinkUrl: deepLink, recordTitle: prev.title || undefined }).catch(() => {});
      }
      if ("completionNotes" in body && typeof body.completionNotes === "string" && body.completionNotes.trim()) {
        saveMentions({ body: body.completionNotes, entityType: "task_completion_notes", entityId: id, moduleKey: "tasks", moduleLabel: "Tasks", authorId: userId, deepLinkUrl: `/execution/tasks?task=${id}`, recordTitle: prev.title || undefined }).catch(() => {});
      }
    } catch (err: any) {
      console.error("[tasks/:id PATCH]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Complete & Reopen ─────────────────────────────────────────────────────
  app.post("/api/tasks/:id/complete", canEdit, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const userId = uid(req);
      if (!await requireTaskAccess(req, res, id)) return;
      const notes = req.body?.notes ? String(req.body.notes) : null;
      await db.execute(sql`
        UPDATE tasks SET status='completed', completed_at=NOW(), completed_by_user_id=${userId},
          completion_notes=${notes}, board_column='done', last_updated_by_user_id=${userId}, updated_at=NOW()
        WHERE id = ${id}
      `);
      await logActivity(id, userId, "completed", null, null, notes ? { notes } : undefined);
      await notifyCompletion(id, userId);
      await notifyDependencyUnblock(id, userId);
      await spawnNextOccurrence(id, userId);
      res.json({ success: true });
    } catch (err: any) {
      console.error("[tasks/:id/complete]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/tasks/:id/reopen", canEdit, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const userId = uid(req);
      if (!await requireTaskAccess(req, res, id)) return;
      await db.execute(sql`
        UPDATE tasks SET status='pending', completed_at=NULL, completed_by_user_id=NULL,
          completion_notes=NULL, board_column='todo', last_updated_by_user_id=${userId}, updated_at=NOW()
        WHERE id = ${id}
      `);
      await logActivity(id, userId, "reopened");
      res.json({ success: true });
    } catch (err: any) {
      console.error("[tasks/:id/reopen]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Dependencies ──────────────────────────────────────────────────────────
  app.post("/api/tasks/:id/dependencies", canEdit, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const userId = uid(req);
      if (!await requireTaskAccess(req, res, id)) return;
      const dependsOn = Number(req.body?.dependsOnTaskId);
      if (!Number.isFinite(dependsOn) || dependsOn === id) return res.status(400).json({ message: "Invalid dependency" });
      // Cycle check (simple): can't depend on a task that depends on this one
      const cycle: any = await db.execute(sql`
        WITH RECURSIVE chain AS (
          SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ${dependsOn}
          UNION ALL
          SELECT d.depends_on_task_id FROM task_dependencies d JOIN chain c ON c.depends_on_task_id = d.task_id
        )
        SELECT 1 FROM chain WHERE depends_on_task_id = ${id} LIMIT 1
      `);
      if (cycle.rows?.length) return res.status(400).json({ message: "Would create a dependency cycle" });
      await db.execute(sql`
        INSERT INTO task_dependencies (task_id, depends_on_task_id, created_by_user_id)
        VALUES (${id}, ${dependsOn}, ${userId})
        ON CONFLICT DO NOTHING
      `);
      await logActivity(id, userId, "dependency_added", null, String(dependsOn));
      res.json({ success: true });
    } catch (err: any) {
      console.error("[tasks deps add]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/tasks/:id/dependencies/:depId", canEdit, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const depId = Number(req.params.depId);
      const userId = uid(req);
      if (!await requireTaskAccess(req, res, id)) return;
      const depRow: any = await db.execute(sql`SELECT depends_on_task_id FROM task_dependencies WHERE id = ${depId} AND task_id = ${id}`);
      const removedDep = depRow.rows?.[0]?.depends_on_task_id ?? null;
      await db.execute(sql`DELETE FROM task_dependencies WHERE id = ${depId} AND task_id = ${id}`);
      await logActivity(id, userId, "dependency_removed", String(depId), null);
      // After removal, the dependent task may now be unblocked
      if (removedDep) {
        const open: any = await db.execute(sql`
          SELECT COUNT(*)::int AS open FROM task_dependencies d
          JOIN tasks t ON t.id = d.depends_on_task_id
          WHERE d.task_id = ${id} AND t.status NOT IN ('completed','done')`);
        if ((open.rows?.[0]?.open ?? 0) === 0) {
          const t = await getTaskMeta(id);
          if (t?.owner_user_id && t.owner_user_id !== userId) {
            await notifyUser({
              userId: t.owner_user_id,
              type: "task_unblocked",
              title: `Task unblocked: ${t.title}`,
              body: "All dependencies cleared — you're clear to start",
              severity: "medium",
              taskId: id,
              dedupeKey: `task-unblock-${id}-${Date.now()}`,
            });
          }
        }
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Labels (workspace) ────────────────────────────────────────────────────
  app.get("/api/task-labels", canView, async (_req, res) => {
    const r: any = await db.execute(sql`SELECT id, name, color FROM task_labels ORDER BY name`);
    res.json(r.rows ?? []);
  });

  app.post("/api/task-labels", canEdit, async (req, res) => {
    try {
      const userId = uid(req);
      const name = String(req.body?.name || "").trim().slice(0, 60);
      const color = String(req.body?.color || "slate").slice(0, 30);
      if (!name) return res.status(400).json({ message: "Name required" });
      const r: any = await db.execute(sql`
        INSERT INTO task_labels (name, color, created_by_user_id) VALUES (${name}, ${color}, ${userId})
        ON CONFLICT (name) DO UPDATE SET color = EXCLUDED.color
        RETURNING id, name, color`);
      res.json(r.rows?.[0]);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/tasks/:id/labels/:labelId", canEdit, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const labelId = Number(req.params.labelId);
      const userId = uid(req);
      if (!await requireTaskAccess(req, res, id)) return;
      await db.execute(sql`
        INSERT INTO task_label_assignments (task_id, label_id) VALUES (${id}, ${labelId})
        ON CONFLICT DO NOTHING`);
      const lab: any = await db.execute(sql`SELECT name FROM task_labels WHERE id = ${labelId}`);
      await logActivity(id, userId, "label_added", null, lab.rows?.[0]?.name ?? String(labelId));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/tasks/:id/labels/:labelId", canEdit, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const labelId = Number(req.params.labelId);
      const userId = uid(req);
      if (!await requireTaskAccess(req, res, id)) return;
      const lab: any = await db.execute(sql`SELECT name FROM task_labels WHERE id = ${labelId}`);
      await db.execute(sql`DELETE FROM task_label_assignments WHERE task_id = ${id} AND label_id = ${labelId}`);
      await logActivity(id, userId, "label_removed", lab.rows?.[0]?.name ?? String(labelId), null);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Checklists ────────────────────────────────────────────────────────────
  app.post("/api/tasks/:id/checklists", canEdit, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const userId = uid(req);
      if (!await requireTaskAccess(req, res, id)) return;
      const title = String(req.body?.title || "Checklist").slice(0, 120);
      const r: any = await db.execute(sql`
        INSERT INTO task_checklists (task_id, title) VALUES (${id}, ${title}) RETURNING *`);
      await logActivity(id, userId, "checklist_added", null, title);
      res.json(r.rows?.[0]);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/task-checklists/:id", canEdit, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const userId = uid(req);
      const c: any = await db.execute(sql`SELECT task_id, title FROM task_checklists WHERE id = ${id}`);
      const row = c.rows?.[0];
      if (!row) return res.status(404).json({ message: "Not found" });
      if (!await requireTaskAccess(req, res, row.task_id)) return;
      await db.execute(sql`DELETE FROM task_checklist_items WHERE checklist_id = ${id}`);
      await db.execute(sql`DELETE FROM task_checklists WHERE id = ${id}`);
      await logActivity(row.task_id, userId, "checklist_removed", row.title, null);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/task-checklists/:id/items", canEdit, async (req, res) => {
    try {
      const checklistId = Number(req.params.id);
      const userId = uid(req);
      const content = String(req.body?.content || "").slice(0, 500);
      if (!content.trim()) return res.status(400).json({ message: "Content required" });
      const c: any = await db.execute(sql`SELECT task_id FROM task_checklists WHERE id = ${checklistId}`);
      const taskId = c.rows?.[0]?.task_id;
      if (!taskId) return res.status(404).json({ message: "Checklist not found" });
      if (!await requireTaskAccess(req, res, taskId)) return;
      const r: any = await db.execute(sql`
        INSERT INTO task_checklist_items (checklist_id, content, sort_order)
        VALUES (${checklistId}, ${content},
          COALESCE((SELECT MAX(sort_order) + 1 FROM task_checklist_items WHERE checklist_id = ${checklistId}), 0))
        RETURNING *`);
      await logActivity(taskId, userId, "checklist_item_added", null, content.slice(0, 80));
      res.json(r.rows?.[0]);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/task-checklist-items/:id", canEdit, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const userId = uid(req);
      const { completed, content, start_date, due_date } = req.body || {};
      const cur: any = await db.execute(sql`
        SELECT i.*, c.task_id FROM task_checklist_items i
        JOIN task_checklists c ON c.id = i.checklist_id WHERE i.id = ${id}`);
      const row = cur.rows?.[0];
      if (!row) return res.status(404).json({ message: "Not found" });
      if (!await requireTaskAccess(req, res, row.task_id)) return;
      if (typeof completed === "boolean") {
        await db.execute(sql`
          UPDATE task_checklist_items
          SET completed = ${completed},
              completed_at = ${completed ? sql`NOW()` : sql`NULL`},
              completed_by_user_id = ${completed ? userId : null}
          WHERE id = ${id}`);
        await logActivity(row.task_id, userId, completed ? "checklist_item_checked" : "checklist_item_unchecked", null, row.content?.slice(0, 80));
      }
      if (typeof content === "string") {
        await db.execute(sql`UPDATE task_checklist_items SET content = ${content.slice(0, 500)} WHERE id = ${id}`);
      }
      if (start_date !== undefined) {
        const sd = start_date ? String(start_date) : null;
        await db.execute(sql`UPDATE task_checklist_items SET start_date = ${sd}::date WHERE id = ${id}`);
      }
      if (due_date !== undefined) {
        const dd = due_date ? String(due_date) : null;
        await db.execute(sql`UPDATE task_checklist_items SET due_date = ${dd}::date WHERE id = ${id}`);
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/task-checklist-items/:id", canEdit, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const itemRow: any = await db.execute(sql`
        SELECT c.task_id FROM task_checklist_items i
        JOIN task_checklists c ON c.id = i.checklist_id
        WHERE i.id = ${id} LIMIT 1`);
      const taskId: number | null = itemRow.rows?.[0]?.task_id ?? null;
      if (taskId === null) return res.status(404).json({ message: "Not found" });
      if (!await requireTaskAccess(req, res, taskId)) return;
      await db.execute(sql`DELETE FROM task_checklist_items WHERE id = ${id}`);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Watchers ──────────────────────────────────────────────────────────────
  app.post("/api/tasks/:id/watchers/:userId", canEdit, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const watcherId = Number(req.params.userId);
      const actor = uid(req);
      if (!await requireTaskAccess(req, res, id)) return;
      await db.execute(sql`
        INSERT INTO task_watchers (task_id, user_id) VALUES (${id}, ${watcherId})
        ON CONFLICT DO NOTHING`);
      await logActivity(id, actor, "watcher_added", null, String(watcherId));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/tasks/:id/watchers/:userId", canEdit, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const watcherId = Number(req.params.userId);
      const actor = uid(req);
      if (!await requireTaskAccess(req, res, id)) return;
      await db.execute(sql`DELETE FROM task_watchers WHERE task_id = ${id} AND user_id = ${watcherId}`);
      await logActivity(id, actor, "watcher_removed", String(watcherId), null);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Comments (uses existing comments table polymorphically) ───────────────
  app.get("/api/tasks/:id/comments", canView, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!await requireTaskAccess(req, res, id, true)) return;
      const r: any = await db.execute(sql`
        SELECT c.id, c.content AS body, c.created_at AS "createdAt", c.user_id AS "authorId",
               COALESCE(u.name, c.user_name) AS "authorName"
        FROM comments c LEFT JOIN users u ON u.id = c.user_id
        WHERE c.object_type = 'task' AND c.object_id = ${id}
        ORDER BY c.created_at ASC`);
      res.json(r.rows ?? []);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/tasks/:id/comments", canEdit, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const userId = uid(req);
      if (!await requireTaskAccess(req, res, id)) return;
      const body = String(req.body?.body || "").slice(0, 2000);
      if (!body.trim()) return res.status(400).json({ message: "Body required" });
      const userRow: any = userId ? await db.execute(sql`SELECT name FROM users WHERE id = ${userId}`) : null;
      const userName = userRow?.rows?.[0]?.name ?? null;
      const r: any = await db.execute(sql`
        INSERT INTO comments (object_type, object_id, user_id, user_name, content)
        VALUES ('task', ${id}, ${userId}, ${userName}, ${body}) RETURNING id, created_at`);
      await logActivity(id, userId, "commented", null, body.slice(0, 80));
      // Fire-and-forget global @mention tracking
      saveMentions({
        body,
        entityType: "task_comment",
        entityId: id,
        moduleKey: "tasks",
        moduleLabel: "Tasks",
        authorId: userId!,
        recordTitle: `Task #${id}`,
        deepLinkUrl: `/execution/tasks?selected=${id}`,
      }).catch(() => {});
      res.json({ id: r.rows?.[0]?.id, createdAt: r.rows?.[0]?.created_at });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Quick search for dependency picker ────────────────────────────────────
  // ── Saved board views (per user) ───────────────────────────────────────────
  app.get("/api/task-board-views", canView, async (req, res) => {
    try {
      const userId = uid(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const r: any = await db.execute(sql`
        SELECT id, name, filters, is_default AS "isDefault", sort_order AS "sortOrder", created_at AS "createdAt"
        FROM task_board_views WHERE user_id = ${userId}
        ORDER BY sort_order, id`);
      res.json(r.rows ?? []);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/task-board-views", canEdit, async (req, res) => {
    try {
      const userId = uid(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const name = String(req.body?.name || "").trim().slice(0, 80);
      if (!name) return res.status(400).json({ message: "Name required" });
      const filters = req.body?.filters ?? {};
      const isDefault = Boolean(req.body?.isDefault);
      if (isDefault) {
        await db.execute(sql`UPDATE task_board_views SET is_default = false WHERE user_id = ${userId}`);
      }
      const r: any = await db.execute(sql`
        INSERT INTO task_board_views (user_id, name, filters, is_default)
        VALUES (${userId}, ${name}, ${JSON.stringify(filters)}::jsonb, ${isDefault})
        RETURNING id, name, filters, is_default AS "isDefault", sort_order AS "sortOrder", created_at AS "createdAt"`);
      res.json(r.rows?.[0]);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/task-board-views/:id", canEdit, async (req, res) => {
    try {
      const userId = uid(req);
      const id = Number(req.params.id);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const own: any = await db.execute(sql`SELECT 1 FROM task_board_views WHERE id = ${id} AND user_id = ${userId}`);
      if (!own.rows?.length) return res.status(404).json({ message: "Not found" });
      const sets: any[] = [];
      if (typeof req.body?.name === "string") sets.push(sql`name = ${String(req.body.name).slice(0, 80)}`);
      if (req.body?.filters !== undefined) sets.push(sql`filters = ${JSON.stringify(req.body.filters)}::jsonb`);
      if (typeof req.body?.isDefault === "boolean") {
        if (req.body.isDefault) {
          await db.execute(sql`UPDATE task_board_views SET is_default = false WHERE user_id = ${userId}`);
        }
        sets.push(sql`is_default = ${req.body.isDefault}`);
      }
      if (typeof req.body?.sortOrder === "number") sets.push(sql`sort_order = ${req.body.sortOrder}`);
      if (!sets.length) return res.json({ success: true, noop: true });
      await db.execute(sql`UPDATE task_board_views SET ${sql.join(sets, sql`, `)} WHERE id = ${id} AND user_id = ${userId}`);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/task-board-views/:id", canEdit, async (req, res) => {
    try {
      const userId = uid(req);
      const id = Number(req.params.id);
      await db.execute(sql`DELETE FROM task_board_views WHERE id = ${id} AND user_id = ${userId}`);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Archived tasks (archive bin) ───────────────────────────────────────────
  app.get("/api/tasks/archived", canView, async (req, res) => {
    try {
      const userId = uid(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const view = String(req.query.view || "my");
      const admin = isAdmin(req);
      const allowAll = view === "team" || admin;
      const ownerFilter = allowAll ? sql`` : sql`AND t.owner_user_id = ${userId}`;
      const r: any = await db.execute(sql`
        SELECT t.id, t.title, t.priority, t.status,
               t.due_date AS "dueDate", t.updated_at AS "updatedAt",
               t.board_column AS "boardColumn",
               t.owner_user_id AS "ownerUserId",
               ou.name AS "ownerName",
               cu.name AS "creatorName",
               cb.name AS "completedByName",
               t.completed_at AS "completedAt",
               a.name AS "accountName"
        FROM tasks t
        LEFT JOIN users ou ON ou.id = t.owner_user_id
        LEFT JOIN users cu ON cu.id = t.created_by_user_id
        LEFT JOIN users cb ON cb.id = t.completed_by_user_id
        LEFT JOIN accounts a ON a.id = t.account_id
        WHERE t.archived = true ${ownerFilter}
        ORDER BY t.updated_at DESC LIMIT 500`);
      res.json(r.rows ?? []);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/tasks/search", canView, async (req, res) => {
    try {
      const q = String(req.query.q || "").slice(0, 100);
      const exclude = Number(req.query.exclude || 0);
      const userId = uid(req);
      const admin = isAdmin(req);
      const like = `%${q.replace(/[%_]/g, " ")}%`;
      // Scope results to tasks the caller can legitimately see:
      //   • their own tasks (owner or creator)
      //   • tasks belonging to users they have hub-access grants for
      //   • admins see all tasks (team visibility)
      const visibilityClause = (admin || !userId) ? sql`` : sql`
        AND (
          owner_user_id = ${userId}
          OR created_by_user_id = ${userId}
          OR owner_user_id IN (
            SELECT target_user_id FROM task_hub_access_permissions
            WHERE viewer_user_id = ${userId} AND revoked_at IS NULL
          )
        )`;
      const r: any = await db.execute(sql`
        SELECT id, title, status, board_column AS "boardColumn"
        FROM tasks WHERE title ILIKE ${like} AND id <> ${exclude} AND archived = false
        ${visibilityClause}
        ORDER BY id DESC LIMIT 20`);
      res.json(r.rows ?? []);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Column sharing ────────────────────────────────────────────────────────
  app.get("/api/task-columns/shares", canView, async (_req, res) => {
    try {
      const r: any = await db.execute(sql`
        SELECT s.id, s.column_slug AS "columnSlug",
          s.shared_with_user_id AS "userId",
          u1.name AS "userName",
          s.permission,
          s.shared_by_user_id AS "sharedByUserId",
          u2.name AS "sharedByName",
          s.created_at AS "createdAt"
        FROM task_column_shares s
        JOIN users u1 ON u1.id = s.shared_with_user_id
        JOIN users u2 ON u2.id = s.shared_by_user_id
        ORDER BY s.column_slug, s.created_at
      `);
      const bySlug: Record<string, any[]> = {};
      for (const row of (r.rows ?? [])) {
        if (!bySlug[row.columnSlug]) bySlug[row.columnSlug] = [];
        bySlug[row.columnSlug].push(row);
      }
      res.json(bySlug);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/task-columns/:slug/shares", requireAuth, async (req, res) => {
    try {
      const { slug } = req.params;
      if (!SLUG_RE.test(slug)) return res.status(400).json({ message: "Invalid column slug" });
      const actorId = uid(req);
      const targetUserId = Number(req.body?.userId);
      const permission = req.body?.permission;
      if (!["view", "edit"].includes(permission)) {
        return res.status(400).json({ message: "Permission must be 'view' or 'edit'" });
      }
      if (!Number.isFinite(targetUserId)) {
        return res.status(400).json({ message: "Invalid userId" });
      }
      if (!SYSTEM_COL_SLUGS.has(slug) && !USER_COL_RE.test(slug)) {
        return res.status(400).json({ message: "Invalid column slug" });
      }
      await db.execute(sql`
        INSERT INTO task_column_shares (column_slug, shared_by_user_id, shared_with_user_id, permission)
        VALUES (${slug}, ${actorId}, ${targetUserId}, ${permission})
        ON CONFLICT (column_slug, shared_with_user_id) DO UPDATE SET permission = ${permission}
      `);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/task-columns/:slug/shares/:userId", requireAuth, async (req, res) => {
    try {
      const { slug, userId: targetUserIdStr } = req.params;
      const permission = req.body?.permission;
      if (!["view", "edit"].includes(permission)) {
        return res.status(400).json({ message: "Permission must be 'view' or 'edit'" });
      }
      const targetId = Number(targetUserIdStr);
      if (!Number.isFinite(targetId)) return res.status(400).json({ message: "Invalid userId" });
      await db.execute(sql`
        UPDATE task_column_shares SET permission = ${permission}
        WHERE column_slug = ${slug} AND shared_with_user_id = ${targetId}
      `);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/task-columns/:slug/shares/:userId", requireAuth, async (req, res) => {
    try {
      const { slug, userId: targetUserIdStr } = req.params;
      const targetId = Number(targetUserIdStr);
      if (!Number.isFinite(targetId)) return res.status(400).json({ message: "Invalid userId" });
      await db.execute(sql`
        DELETE FROM task_column_shares
        WHERE column_slug = ${slug} AND shared_with_user_id = ${targetId}
      `);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Bulk replace a user's personal columns ────────────────────────────────
  app.put("/api/task-columns/user", requireAuth, async (req, res) => {
    try {
      const userId = uid(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const incoming = Array.isArray(req.body?.columns) ? req.body.columns : null;
      if (incoming === null) return res.status(400).json({ message: "columns array required" });
      if (incoming.length > 20) return res.status(400).json({ message: "Max 20 personal columns" });

      const cleaned: Array<{ value: string; label: string; color: string }> = [];
      const seen = new Set<string>();
      for (const raw of incoming) {
        const value = String(raw?.value || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 32);
        const label = String(raw?.label || "").trim().slice(0, 60);
        const color = String(raw?.color || "slate").trim().toLowerCase();
        if (!value || !label) continue;
        if (seen.has(value)) continue;
        seen.add(value);
        cleaned.push({ value, label, color: ALLOWED_COL_COLORS.has(color) ? color : "slate" });
      }

      // Fetch current slugs for this user
      const existing: any = await db.execute(sql`
        SELECT slug FROM user_task_columns WHERE user_id = ${userId}
      `);
      const existingSlugs = new Set((existing.rows ?? []).map((r: any) => r.slug as string));
      const newSlugs = new Set(cleaned.map(c => c.value));

      // Delete removed columns — move their tasks to backlog
      for (const slug of existingSlugs) {
        if (!newSlugs.has(slug)) {
          const fullSlug = `u${userId}_${slug}`;
          await db.execute(sql.raw(
            `UPDATE tasks SET board_column = 'backlog' WHERE board_column = '${fullSlug}'`
          ));
          await db.execute(sql`DELETE FROM user_task_columns WHERE user_id = ${userId} AND slug = ${slug}`);
          await db.execute(sql`DELETE FROM task_column_shares WHERE column_slug = ${fullSlug}`);
        }
      }

      // Upsert remaining in given order
      for (let i = 0; i < cleaned.length; i++) {
        const { value, label, color } = cleaned[i];
        await db.execute(sql`
          INSERT INTO user_task_columns (user_id, slug, label, color, sort_order)
          VALUES (${userId}, ${value}, ${label}, ${color}, ${i})
          ON CONFLICT (user_id, slug) DO UPDATE SET label = ${label}, color = ${color}, sort_order = ${i}
        `);
      }

      res.json({ success: true, count: cleaned.length });
    } catch (err: any) {
      console.error("[task-columns/user PUT]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Task Hub Access: what users the current user can view ─────────────────
  app.get("/api/tasks/hub-access/my-access", requireAuth, async (req, res) => {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    try {
      const rows: any = await db.execute(sql`
        SELECT p.id, p.target_user_id AS "targetUserId", u.name AS "targetUserName", p.permission_level AS "permissionLevel"
        FROM task_hub_access_permissions p
        JOIN users u ON u.id = p.target_user_id
        WHERE p.viewer_user_id = ${userId} AND p.revoked_at IS NULL
        ORDER BY u.name
      `);
      res.json(rows.rows ?? []);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Task Hub Access: list all permissions (admin only) ────────────────────
  app.get("/api/tasks/hub-access/permissions", requireAuth, async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ message: "Admin only" });
    try {
      const rows: any = await db.execute(sql`
        SELECT p.id, p.viewer_user_id AS "viewerUserId", vu.name AS "viewerName",
               p.target_user_id AS "targetUserId", tu.name AS "targetName",
               p.permission_level AS "permissionLevel", p.created_at AS "createdAt"
        FROM task_hub_access_permissions p
        JOIN users vu ON vu.id = p.viewer_user_id
        JOIN users tu ON tu.id = p.target_user_id
        WHERE p.revoked_at IS NULL
        ORDER BY vu.name, tu.name
      `);
      res.json(rows.rows ?? []);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Task Hub Access: grant access (admin only) ────────────────────────────
  app.post("/api/tasks/hub-access/permissions", requireAuth, async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ message: "Admin only" });
    const { viewerUserId, targetUserId, permissionLevel } = req.body;
    const adminId = uid(req);
    if (!viewerUserId || !targetUserId) {
      return res.status(400).json({ message: "viewerUserId and targetUserId are required" });
    }
    if (Number(viewerUserId) === Number(targetUserId)) {
      return res.status(400).json({ message: "A user already has access to their own tasks" });
    }
    const level = permissionLevel === "edit" ? "edit" : "view";
    try {
      await db.execute(sql`
        INSERT INTO task_hub_access_permissions (viewer_user_id, target_user_id, permission_level, created_by_user_id, created_at, updated_at)
        VALUES (${Number(viewerUserId)}, ${Number(targetUserId)}, ${level}, ${adminId}, NOW(), NOW())
        ON CONFLICT (viewer_user_id, target_user_id) DO UPDATE
          SET permission_level = ${level}, revoked_at = NULL, updated_at = NOW()
      `);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Task Hub Access: revoke access (admin only) ───────────────────────────
  app.delete("/api/tasks/hub-access/permissions/:id", requireAuth, async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ message: "Admin only" });
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    try {
      await db.execute(sql`UPDATE task_hub_access_permissions SET revoked_at = NOW(), updated_at = NOW() WHERE id = ${id}`);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
