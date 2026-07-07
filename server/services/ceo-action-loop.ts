/**
 * ceo-action-loop.ts
 * CEO Cockpit Phase 6 — Action Queue, Follow-Up, and Accountability Trail
 *
 * All functions are deterministic. No AI calls. No email. No messaging.
 * All string inputs are parameterized. Ownership enforced on every mutation.
 * buildUpdateRequestDraft: Never sends. Returns copyable text only.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { getCeoCockpitData } from "./ceo-cockpit";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ActionType =
  | "ask_for_update"
  | "create_task"
  | "follow_up"
  | "resolve_blocker"
  | "schedule_1on1"
  | "review_commitment";

export type ActionStatus = "draft" | "queued" | "completed" | "dismissed" | "snoozed";
export type ActionPriority = "low" | "medium" | "high" | "critical";

const VALID_TYPES = new Set<string>(["ask_for_update", "create_task", "follow_up", "resolve_blocker", "schedule_1on1", "review_commitment"]);
const VALID_STATUS = new Set<string>(["draft", "queued", "completed", "dismissed", "snoozed"]);
const VALID_PRIORITY = new Set<string>(["low", "medium", "high", "critical"]);
const VALID_SECTIONS = new Set<string>(["team_pulse", "blockers", "silence_watch", "commitments", "one_on_ones", "ceo_attention", "communication_hotspots"]);

export interface CeoAction {
  id: number;
  type: ActionType;
  status: ActionStatus;
  priority: ActionPriority;
  source_section: string | null;
  source_type: string | null;
  source_id: string | null;
  assigned_to_user_id: number | null;
  assigned_to_name: string | null;
  created_by_user_id: number;
  title: string;
  body: string | null;
  suggested_message: string | null;
  due_at: string | null;
  snoozed_until: string | null;
  completed_at: string | null;
  dismissed_reason: string | null;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface CreateActionInput {
  type: ActionType;
  priority?: ActionPriority;
  source_section?: string | null;
  source_type?: string | null;
  source_id?: string | null;
  assigned_to_user_id?: number | null;
  title: string;
  body?: string | null;
  suggested_message?: string | null;
  due_at?: string | null;
  metadata?: Record<string, any>;
}

export interface ListFilters {
  status?: string;
  priority?: string;
  type?: string;
  assigned_to_user_id?: number;
  source_section?: string;
  limit?: number;
}

// ── Safety helpers ─────────────────────────────────────────────────────────────

function safeId(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error("Invalid ID");
  return n;
}

function safeBound(s: string | null | undefined, max: number): string | null {
  if (!s || !s.trim()) return null;
  return s.slice(0, max);
}

function validateEnum<T extends string>(v: string | undefined | null, allowed: Set<string>, fallback: T): T {
  if (v && allowed.has(v)) return v as T;
  return fallback;
}

// ── Event logging ─────────────────────────────────────────────────────────────

async function logEvent(actionId: number, eventType: string, actorId: number, note: string | null, meta: object = {}): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO ceo_action_events (action_id, event_type, actor_user_id, note, metadata, created_at)
      VALUES (${actionId}, ${eventType}, ${actorId}, ${note}, ${JSON.stringify(meta)}::jsonb, NOW())
    `);
  } catch (err: any) {
    console.error("[ceo-action-loop] event log failed:", err?.message);
  }
}

// ── Dedup key ─────────────────────────────────────────────────────────────────

function dedupKey(type: string, section: string | null, stype: string | null, sid: string | null): string {
  return `${type}|${section ?? ""}|${stype ?? ""}|${sid ?? ""}`;
}

// ── 1. generateCockpitActions ─────────────────────────────────────────────────

export async function generateCockpitActions(
  ceoId: number
): Promise<{ created: number; deduped: number; dismissed: number }> {
  ceoId = safeId(ceoId);

  // Fetch fresh cockpit data
  const cockpitData = await getCeoCockpitData(ceoId);
  const sections = cockpitData?.sections;
  if (!sections) return { created: 0, deduped: 0, dismissed: 0 };

  // Existing open/snoozed items — do not duplicate
  const openRows = (await db.execute(sql`
    SELECT type, source_section, source_type, source_id FROM ceo_action_queue
    WHERE created_by_user_id = ${ceoId}
      AND status NOT IN ('completed')
  `)).rows as any[];
  const existingKeys = new Set(openRows.map((r: any) => dedupKey(r.type, r.source_section, r.source_type, r.source_id)));

  const candidates: CreateActionInput[] = [];

  // ── team_pulse members ───────────────────────────────────────────────────
  for (const m of (sections.team_pulse?.members ?? [])) {
    const label = m.signal?.label ?? "";
    if (label === "Blocked" || label === "Needs follow-up") {
      candidates.push({
        type: "ask_for_update",
        priority: "high",
        source_section: "team_pulse",
        source_type: "user",
        source_id: String(m.userId ?? m.id),
        assigned_to_user_id: m.userId ?? m.id ?? null,
        title: `Ask ${m.name} for update`,
        body: `${m.name} has a "${label}" signal. Get a status update on current work and blockers.`,
        suggested_message: `Hey ${m.name.split(" ")[0]}, can you share a quick update on where things stand and what you're blocked on?`,
      });
    } else if (label === "Quiet") {
      candidates.push({
        type: "follow_up",
        priority: "medium",
        source_section: "team_pulse",
        source_type: "user",
        source_id: String(m.userId ?? m.id),
        assigned_to_user_id: m.userId ?? m.id ?? null,
        title: `Check in with ${m.name}`,
        body: `${m.name} has been quiet. ${m.signal?.reason ?? ""}`.trim(),
        suggested_message: `Hey ${m.name.split(" ")[0]}, just checking in — how are things going?`,
      });
    } else if (label === "Overloaded") {
      candidates.push({
        type: "follow_up",
        priority: "medium",
        source_section: "team_pulse",
        source_type: "user",
        source_id: `overloaded:${String(m.userId ?? m.id)}`,
        assigned_to_user_id: m.userId ?? m.id ?? null,
        title: `${m.name} appears overloaded`,
        body: `${m.name} has ${m.activeTasks ?? "multiple"} active tasks and ${m.overdueTasks ?? "some"} overdue. Consider reprioritizing.`,
      });
    }
  }

  // ── blockers ─────────────────────────────────────────────────────────────
  for (const b of (sections.blockers?.items ?? [])) {
    const daysStale = Math.round((b.ageHours ?? 0) / 24);
    candidates.push({
      type: "resolve_blocker",
      priority: daysStale > 7 ? "high" : "medium",
      source_section: "blockers",
      source_type: b.source ?? "task",
      source_id: String(b.id),
      assigned_to_user_id: null,
      title: `Resolve blocker: ${b.title}`,
      body: `${b.ownerName ?? "Someone"} is blocked on "${b.title}" (${daysStale}d). ${b.nextAction ?? ""}`.trim(),
      suggested_message: `Can you unblock "${b.title}"? What's needed to move this forward?`,
    });
  }

  // ── silence_watch ─────────────────────────────────────────────────────────
  for (const s of (sections.silence_watch?.items ?? [])) {
    const ownerId = (s as any).ownerId ?? (s as any).userId ?? null;
    candidates.push({
      type: "follow_up",
      priority: "medium",
      source_section: "silence_watch",
      source_type: s.type ?? "task",
      source_id: String(s.id),
      assigned_to_user_id: ownerId,
      title: `Check in: ${s.title}`,
      body: `${s.reason ?? "No recent activity"}. Owner: ${s.ownerName ?? "unknown"}.`,
      suggested_message: (s as any).askForUpdateText ?? null,
    });
  }

  // ── commitments (overdue) ─────────────────────────────────────────────────
  for (const c of (sections.commitments?.items ?? [])) {
    if ((c.daysOverdue ?? 0) > 0) {
      candidates.push({
        type: "review_commitment",
        priority: (c.daysOverdue ?? 0) > 7 ? "critical" : "high",
        source_section: "commitments",
        source_type: "task",
        source_id: String(c.id),
        assigned_to_user_id: (c as any).ownerId ?? null,
        title: `Overdue commitment: ${c.title}`,
        body: `"${c.title}" by ${c.ownerName ?? "unknown"} is ${c.daysOverdue}d overdue.`,
      });
    }
  }

  // ── one_on_ones ───────────────────────────────────────────────────────────
  for (const o of (sections.one_on_ones?.items ?? [])) {
    if ((o.overdueCommitments ?? 0) > 0) {
      candidates.push({
        type: "review_commitment",
        priority: "medium",
        source_section: "one_on_ones",
        source_type: "user",
        source_id: `commitments:${o.userId}`,
        assigned_to_user_id: o.userId,
        title: `Review ${o.overdueCommitments} overdue commitment(s) with ${o.userName}`,
        body: `${o.userName} has ${o.overdueCommitments} overdue commitment(s) from prior 1:1s.`,
      });
    }
    if (!o.nextScheduled) {
      candidates.push({
        type: "schedule_1on1",
        priority: "low",
        source_section: "one_on_ones",
        source_type: "user",
        source_id: `schedule:${o.userId}`,
        assigned_to_user_id: o.userId,
        title: `Schedule 1:1 with ${o.userName}`,
        body: `No upcoming 1:1 scheduled with ${o.userName}.`,
      });
    }
  }

  // ── ceo_attention ─────────────────────────────────────────────────────────
  for (const a of (sections.ceo_attention?.items ?? [])) {
    const atype: ActionType = a.type === "commitment" ? "review_commitment" : "follow_up";
    const sid = a.sourceId ? String(a.sourceId) : `attn:${a.linkedUserId ?? a.title?.slice(0, 20) ?? "x"}`;
    candidates.push({
      type: atype,
      priority: validateEnum(a.priority, VALID_PRIORITY, "medium"),
      source_section: "ceo_attention",
      source_type: a.sourceType ?? "user",
      source_id: sid,
      assigned_to_user_id: a.linkedUserId ?? null,
      title: a.title,
      body: a.body,
    });
  }

  // ── dedup and insert ──────────────────────────────────────────────────────
  let created = 0; let deduped = 0; let dismissed = 0;
  for (const c of candidates) {
    const key = dedupKey(c.type, c.source_section ?? null, c.source_type ?? null, c.source_id ?? null);
    if (existingKeys.has(key)) {
      const row = openRows.find((r: any) => dedupKey(r.type, r.source_section, r.source_type, r.source_id) === key);
      if (row && (row as any).status === "dismissed") dismissed++;
      else deduped++;
      continue;
    }
    existingKeys.add(key);
    await createCeoAction({ ...c, created_by_user_id: ceoId } as any, ceoId);
    created++;
  }
  return { created, deduped, dismissed };
}

// ── 2. listCeoActions ─────────────────────────────────────────────────────────

export async function listCeoActions(ceoId: number, filters: ListFilters = {}): Promise<CeoAction[]> {
  ceoId = safeId(ceoId);
  const limit = Math.min(Number(filters.limit) || 50, 100);

  // Build status filter
  let statusClause = "";
  const sf = filters.status ?? "open";
  if (sf === "open") {
    statusClause = `AND q.status IN ('draft','queued') AND (q.snoozed_until IS NULL OR q.snoozed_until <= NOW())`;
  } else if (sf === "snoozed") {
    statusClause = `AND q.status = 'snoozed'`;
  } else if (sf === "completed") {
    statusClause = `AND q.status = 'completed'`;
  } else if (sf === "dismissed") {
    statusClause = `AND q.status = 'dismissed'`;
  } else if (sf === "high_priority") {
    statusClause = `AND q.status NOT IN ('dismissed','completed') AND q.priority IN ('high','critical')
      AND (q.snoozed_until IS NULL OR q.snoozed_until <= NOW())`;
  } else {
    statusClause = `AND q.status NOT IN ('dismissed')`;
  }

  // Priority filter
  const pf = filters.priority && VALID_PRIORITY.has(filters.priority) ? filters.priority : null;
  const priorityClause = pf ? `AND q.priority = '${pf}'` : "";

  // Type filter
  const tf = filters.type && VALID_TYPES.has(filters.type) ? filters.type : null;
  const typeClause = tf ? `AND q.type = '${tf}'` : "";

  // Section filter
  const secf = filters.source_section && VALID_SECTIONS.has(filters.source_section) ? filters.source_section : null;
  const sectionClause = secf ? `AND q.source_section = '${secf}'` : "";

  const rows = (await db.execute(sql.raw(`
    SELECT q.*, u.name AS assigned_to_name
    FROM ceo_action_queue q
    LEFT JOIN users u ON u.id = q.assigned_to_user_id
    WHERE q.created_by_user_id = ${ceoId}
    ${statusClause}
    ${priorityClause}
    ${typeClause}
    ${sectionClause}
    ORDER BY
      CASE q.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      q.created_at DESC
    LIMIT ${limit}
  `))).rows as any[];

  return rows.map(mapRow);
}

function mapRow(r: any): CeoAction {
  return {
    id: Number(r.id),
    type: r.type,
    status: r.status,
    priority: r.priority,
    source_section: r.source_section,
    source_type: r.source_type,
    source_id: r.source_id,
    assigned_to_user_id: r.assigned_to_user_id ? Number(r.assigned_to_user_id) : null,
    assigned_to_name: r.assigned_to_name ?? null,
    created_by_user_id: Number(r.created_by_user_id),
    title: r.title,
    body: r.body,
    suggested_message: r.suggested_message,
    due_at: r.due_at,
    snoozed_until: r.snoozed_until,
    completed_at: r.completed_at,
    dismissed_reason: r.dismissed_reason,
    metadata: r.metadata ?? {},
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// ── 3. createCeoAction ────────────────────────────────────────────────────────

export async function createCeoAction(input: CreateActionInput & { created_by_user_id: number }, ceoId: number): Promise<CeoAction> {
  const type = validateEnum(input.type, VALID_TYPES, "follow_up" as ActionType);
  const priority = validateEnum(input.priority, VALID_PRIORITY, "medium" as ActionPriority);
  const title = safeBound(input.title, 500) ?? "Action";
  const body = safeBound(input.body, 2000);
  const suggested_message = safeBound(input.suggested_message, 2000);
  const due_at = input.due_at ? new Date(input.due_at).toISOString() : null;
  const source_section = safeBound(input.source_section, 100);
  const source_type = safeBound(input.source_type, 100);
  const source_id = safeBound(input.source_id, 500);
  const assigned_to_user_id = input.assigned_to_user_id ? Number(input.assigned_to_user_id) : null;
  const meta = JSON.stringify(input.metadata ?? {});

  const [row] = (await db.execute(sql`
    INSERT INTO ceo_action_queue (
      type, status, priority, source_section, source_type, source_id,
      assigned_to_user_id, created_by_user_id, title, body, suggested_message,
      due_at, metadata, created_at, updated_at
    ) VALUES (
      ${type}, 'queued', ${priority}, ${source_section}, ${source_type}, ${source_id},
      ${assigned_to_user_id}, ${ceoId}, ${title}, ${body}, ${suggested_message},
      ${due_at}::timestamptz, ${meta}::jsonb, NOW(), NOW()
    )
    RETURNING *
  `)).rows as any[];

  await logEvent(Number(row.id), "created", ceoId, null, { type, source_section, source_type });
  return mapRow(row);
}

// ── 4. updateCeoAction ────────────────────────────────────────────────────────

export async function updateCeoAction(
  id: number,
  ceoId: number,
  patch: Partial<Pick<CeoAction, "title" | "body" | "priority" | "suggested_message" | "due_at">>
): Promise<void> {
  id = safeId(id);
  ceoId = safeId(ceoId);

  const [existing] = (await db.execute(sql`
    SELECT id, status FROM ceo_action_queue WHERE id = ${id} AND created_by_user_id = ${ceoId} LIMIT 1
  `)).rows as any[];
  if (!existing) throw new Error("Action not found or access denied");
  if (["completed", "dismissed"].includes(existing.status)) throw new Error("Cannot update a terminal action");

  const priority = patch.priority && VALID_PRIORITY.has(patch.priority) ? patch.priority : null;

  await db.execute(sql`
    UPDATE ceo_action_queue SET
      title            = COALESCE(${safeBound(patch.title, 500)}, title),
      body             = COALESCE(${safeBound(patch.body, 2000)}, body),
      priority         = COALESCE(${priority}, priority),
      suggested_message = COALESCE(${safeBound(patch.suggested_message, 2000)}, suggested_message),
      due_at           = COALESCE(${patch.due_at ? new Date(patch.due_at).toISOString() : null}::timestamptz, due_at),
      updated_at       = NOW()
    WHERE id = ${id} AND created_by_user_id = ${ceoId}
  `);
  await logEvent(id, "updated", ceoId, null, { fields: Object.keys(patch) });
}

// ── 5. completeCeoAction ──────────────────────────────────────────────────────

export async function completeCeoAction(id: number, ceoId: number): Promise<void> {
  id = safeId(id); ceoId = safeId(ceoId);
  const result = await db.execute(sql`
    UPDATE ceo_action_queue SET status = 'completed', completed_at = NOW(), updated_at = NOW()
    WHERE id = ${id} AND created_by_user_id = ${ceoId} AND status NOT IN ('completed','dismissed')
  `);
  if ((result.rowCount ?? 0) === 0) throw new Error("Action not found, already completed, or access denied");
  await logEvent(id, "completed", ceoId, null, {});
}

// ── 6. dismissCeoAction ───────────────────────────────────────────────────────

export async function dismissCeoAction(id: number, ceoId: number, reason: string | null): Promise<void> {
  id = safeId(id); ceoId = safeId(ceoId);
  const safeReason = safeBound(reason, 500);
  const result = await db.execute(sql`
    UPDATE ceo_action_queue SET status = 'dismissed', dismissed_reason = ${safeReason}, updated_at = NOW()
    WHERE id = ${id} AND created_by_user_id = ${ceoId} AND status NOT IN ('completed','dismissed')
  `);
  if ((result.rowCount ?? 0) === 0) throw new Error("Action not found or access denied");
  await logEvent(id, "dismissed", ceoId, safeReason, {});
}

// ── 7. snoozeCeoAction ────────────────────────────────────────────────────────

export async function snoozeCeoAction(id: number, ceoId: number, snoozedUntil: string): Promise<void> {
  id = safeId(id); ceoId = safeId(ceoId);
  const until = new Date(snoozedUntil);
  if (isNaN(until.getTime()) || until <= new Date()) throw new Error("snoozed_until must be a future date");
  const result = await db.execute(sql`
    UPDATE ceo_action_queue SET status = 'snoozed', snoozed_until = ${until.toISOString()}::timestamptz, updated_at = NOW()
    WHERE id = ${id} AND created_by_user_id = ${ceoId} AND status NOT IN ('completed','dismissed')
  `);
  if ((result.rowCount ?? 0) === 0) throw new Error("Action not found or access denied");
  await logEvent(id, "snoozed", ceoId, null, { until: until.toISOString() });
}

// ── 8. buildUpdateRequestDraft ────────────────────────────────────────────────

export async function buildUpdateRequestDraft(
  actionId: number,
  ceoId: number
): Promise<{ draftText: string; dmConversationId: number | null; currentsLink: string | null; copy_only: true }> {
  actionId = safeId(actionId); ceoId = safeId(ceoId);

  const [action] = (await db.execute(sql`
    SELECT * FROM ceo_action_queue WHERE id = ${actionId} AND created_by_user_id = ${ceoId} LIMIT 1
  `)).rows as any[];
  if (!action) throw new Error("Action not found or access denied");

  const draftText = action.suggested_message
    || `Quick check-in — can you share a brief update on this today? Include: current status, any blockers, and next step.`;

  // Look up existing DM if we have a target user
  let dmConversationId: number | null = null;
  let currentsLink: string | null = null;
  const targetUserId = action.assigned_to_user_id;
  if (targetUserId) {
    const lo = Math.min(ceoId, targetUserId);
    const hi = Math.max(ceoId, targetUserId);
    const pairKey = `dm:${lo}:${hi}`;
    const [conv] = (await db.execute(sql`
      SELECT id FROM current_conversations WHERE participant_key = ${pairKey} AND type = 'dm' LIMIT 1
    `)).rows as any[];
    if (conv) {
      dmConversationId = Number(conv.id);
      currentsLink = `/currents?dm=${dmConversationId}`;
    }
  }

  await logEvent(actionId, "draft_copied", ceoId, null, { has_dm: !!dmConversationId });
  return { draftText, dmConversationId, currentsLink, copy_only: true as const };
}

// ── 9. createTaskFromAction ───────────────────────────────────────────────────

export async function createTaskFromAction(
  actionId: number,
  ceoId: number
): Promise<{ taskId: number }> {
  actionId = safeId(actionId); ceoId = safeId(ceoId);

  const [action] = (await db.execute(sql`
    SELECT * FROM ceo_action_queue WHERE id = ${actionId} AND created_by_user_id = ${ceoId} LIMIT 1
  `)).rows as any[];
  if (!action) throw new Error("Action not found or access denied");

  // Idempotency: check if task already created from this action
  const existingTaskId = action.metadata?.created_task_id;
  if (existingTaskId) {
    const [exists] = (await db.execute(sql`
      SELECT id FROM tasks WHERE id = ${Number(existingTaskId)} LIMIT 1
    `)).rows as any[];
    if (exists) return { taskId: Number(existingTaskId) };
  }

  const ownerUserId = action.assigned_to_user_id ?? ceoId;
  const title = safeBound(action.title, 500) ?? "CEO Action Item";
  const priority = VALID_PRIORITY.has(action.priority) ? action.priority : "medium";
  const sourceMeta = JSON.stringify({
    actionId,
    sourceSection: action.source_section,
    sourceType: action.source_type,
    sourceId: action.source_id,
  });
  const sourceLabel = `From CEO Action Queue: ${title.slice(0, 80)}`;

  const [created] = (await db.execute(sql`
    INSERT INTO tasks (
      owner_user_id, created_by_user_id, title, status, priority,
      source, source_label, source_meta,
      due_date, created_at, updated_at, archived
    ) VALUES (
      ${ownerUserId}, ${ceoId}, ${title}, 'pending', ${priority},
      'ceo_action_queue', ${sourceLabel}, ${sourceMeta}::jsonb,
      ${action.due_at ? new Date(action.due_at).toISOString() : null}::timestamptz,
      NOW(), NOW(), false
    )
    RETURNING id
  `)).rows as any[];

  const taskId = Number(created.id);

  // Update action metadata with task reference
  const updatedMeta = JSON.stringify({ ...(action.metadata ?? {}), created_task_id: taskId });
  await db.execute(sql`
    UPDATE ceo_action_queue SET metadata = ${updatedMeta}::jsonb, updated_at = NOW()
    WHERE id = ${actionId}
  `);

  await logEvent(actionId, "task_created", ceoId, null, { taskId });
  return { taskId };
}
