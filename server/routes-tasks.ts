import type { Express, Request } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { requirePermission } from "./auth";

const BOARD_COLUMNS = ["backlog", "todo", "in_progress", "blocked", "done"] as const;
type BoardColumn = (typeof BOARD_COLUMNS)[number];

// Workspace-wide custom columns (lives in system_settings as a JSON blob under
// key='task_columns'). When unset, falls back to the built-in 5. Kept here as a
// tiny helper so the board endpoint groups by whatever the admin configured.
async function loadCustomColumnValues(): Promise<string[]> {
  try {
    const r: any = await db.execute(sql`SELECT value FROM system_settings WHERE key = 'task_columns' LIMIT 1`);
    const row = r.rows?.[0];
    if (!row) return [...BOARD_COLUMNS];
    const parsed = JSON.parse(row.value);
    if (Array.isArray(parsed?.columns) && parsed.columns.length > 0) {
      return parsed.columns.map((c: any) => String(c.value));
    }
  } catch { /* fall through */ }
  return [...BOARD_COLUMNS];
}
const SLUG_RE = /^[a-z0-9_]{1,32}$/;

function uid(req: Request): number | null {
  const u = (req.session as any)?.userId;
  return typeof u === "number" ? u : null;
}

function isAdmin(req: Request): boolean {
  const r = (req.session as any)?.globalRole;
  return r === "master_admin" || r === "admin";
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
      co.name AS contact_name
    FROM tasks t
    LEFT JOIN users cu ON cu.id = t.created_by_user_id
    LEFT JOIN users ou ON ou.id = t.owner_user_id
    LEFT JOIN users cb ON cb.id = t.completed_by_user_id
    LEFT JOIN users lu ON lu.id = t.last_updated_by_user_id
    LEFT JOIN accounts a ON a.id = t.account_id
    LEFT JOIN contacts co ON co.id = t.linked_object_id AND t.linked_object_type = 'contact'
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

  // ── Full task detail ──────────────────────────────────────────────────────
  app.get("/api/tasks/:id/full", canView, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
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
      // Build the WHERE clause filter for this view:
      //   assigned_by_me → tasks I created but assigned to someone else
      //   team (admin only) → no owner restriction (full team visibility)
      //   anything else (or team for non-admin) → only tasks assigned to me
      let whereFilter = "";
      if (view === "assigned_by_me") {
        whereFilter = `AND t.created_by_user_id = ${userId} AND t.owner_user_id IS NOT NULL AND t.owner_user_id != ${userId}`;
      } else if (view === "team" && admin) {
        whereFilter = ""; // admin sees everyone
      } else {
        whereFilter = `AND t.owner_user_id = ${userId}`;
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
        WHERE t.archived = false ${whereFilter}
        ORDER BY t.sort_order ASC, t.due_date ASC NULLS LAST, t.id DESC
        LIMIT 1000
      `));

      const tasks: any[] = (rows as any).rows ?? [];
      // Use the workspace's currently configured columns so custom columns
      // appear on the board. Anything pointing at an unknown column gets
      // dropped into "backlog" (the guaranteed fallback).
      const colValues = await loadCustomColumnValues();
      const colSet = new Set(colValues);
      const fallback = colSet.has("backlog") ? "backlog" : colValues[0];
      const grouped: Record<string, any[]> = {};
      for (const v of colValues) grouped[v] = [];
      for (const t of tasks) {
        let col = String(t.boardColumn || fallback);
        if (!colSet.has(col)) col = fallback;
        // Auto-blocked override only applies when "blocked" is still a column
        if (col !== "done" && t.openDependencies > 0 && colSet.has("blocked")) col = "blocked";
        grouped[col].push(t);
      }
      res.json({ columns: colValues, grouped, total: tasks.length });
    } catch (err: any) {
      console.error("[tasks/board]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Move/reorder card on the board ────────────────────────────────────────
  app.patch("/api/tasks/:id/board", canEdit, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const userId = uid(req);
      const { boardColumn, sortOrder } = req.body || {};
      if (typeof boardColumn !== "string" || !SLUG_RE.test(boardColumn)) {
        return res.status(400).json({ message: "Invalid column" });
      }
      const allowedCols = await loadCustomColumnValues();
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

      if (!fragments.length) return res.json({ success: true, noop: true });

      fragments.push(sql`last_updated_by_user_id = ${userId}`);
      fragments.push(sql`updated_at = NOW()`);
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
          await notifyAssignment(id, prevOwner, newOwner, userId);
        }
      }
      res.json({ success: true });
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
      const notes = req.body?.notes ? String(req.body.notes) : null;
      await db.execute(sql`
        UPDATE tasks SET status='completed', completed_at=NOW(), completed_by_user_id=${userId},
          completion_notes=${notes}, board_column='done', last_updated_by_user_id=${userId}, updated_at=NOW()
        WHERE id = ${id}
      `);
      await logActivity(id, userId, "completed", null, null, notes ? { notes } : undefined);
      await notifyCompletion(id, userId);
      await notifyDependencyUnblock(id, userId);
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
      const { completed, content } = req.body || {};
      const cur: any = await db.execute(sql`
        SELECT i.*, c.task_id FROM task_checklist_items i
        JOIN task_checklists c ON c.id = i.checklist_id WHERE i.id = ${id}`);
      const row = cur.rows?.[0];
      if (!row) return res.status(404).json({ message: "Not found" });
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
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/task-checklist-items/:id", canEdit, async (req, res) => {
    try {
      const id = Number(req.params.id);
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
      const body = String(req.body?.body || "").slice(0, 2000);
      if (!body.trim()) return res.status(400).json({ message: "Body required" });
      const userRow: any = userId ? await db.execute(sql`SELECT name FROM users WHERE id = ${userId}`) : null;
      const userName = userRow?.rows?.[0]?.name ?? null;
      const r: any = await db.execute(sql`
        INSERT INTO comments (object_type, object_id, user_id, user_name, content)
        VALUES ('task', ${id}, ${userId}, ${userName}, ${body}) RETURNING id, created_at`);
      await logActivity(id, userId, "commented", null, body.slice(0, 80));
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
      const like = `%${q.replace(/[%_]/g, " ")}%`;
      const r: any = await db.execute(sql`
        SELECT id, title, status, board_column AS "boardColumn"
        FROM tasks WHERE title ILIKE ${like} AND id <> ${exclude} AND archived = false
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
      const cols = await loadCustomColumnValues();
      if (!cols.includes(slug)) return res.status(404).json({ message: "Column not found" });
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
}
