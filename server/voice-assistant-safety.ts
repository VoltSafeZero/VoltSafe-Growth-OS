/**
 * Voice Assistant Safety Layer (Build Sequence #1)
 *
 * Single source of truth for write-tool safety used by BOTH
 * /api/voice-assistant/ask and /api/voice-assistant/text.
 *
 * Concerns handled here (and ONLY here, so the two endpoints can never drift):
 *   1. Permission enforcement      — mirrors auth.ts:requirePermission logic
 *   2. Server-side value validation — enum + numeric bounds + type coercion
 *   3. Risk assessment              — terminal status transitions, large $ changes
 *   4. Confirmation gate            — stored as `pending_confirm` role messages
 *                                     in the existing conversations/messages table
 *                                     (NO schema changes, NO new tables)
 *   5. Audit trail                  — every successful write writes an activities row
 *                                     via storage.createActivity (existing mechanism)
 *
 * Additive only. Does not modify auth.ts, storage.ts, schema.ts, or any existing route.
 */

import { db } from "./db";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { storage } from "./storage";
import { chatStorage } from "./replit_integrations/chat/storage";
import {
  requireAccessibleLinkedObject,
  parseTzAwareISODate,
  idempotencyKey,
  claimIdempotency,
  reserveInflight,
  recordIdempotency,
  checkAndConsumeRateLimit,
  safeAuditWrite,
} from "./voice-assistant-create-guards";

// ────────────────────────────────────────────────────────────────────────────
// Permission check (mirrors server/auth.ts:requirePermission, function form)
// ────────────────────────────────────────────────────────────────────────────

const PERMISSION_LEVELS: Record<string, number> = { none: 0, view: 1, edit: 2 };

export async function userHasPermission(
  userId: number,
  section: string,
  minLevel: "view" | "edit",
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const [user] = await db
      .select({ globalRole: users.globalRole, permissions: users.permissions })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) return { ok: false, reason: "User not found." };
    if (user.globalRole === "master_admin" || user.globalRole === "admin") {
      return { ok: true };
    }
    const perms = (user.permissions as Record<string, string>) || {};
    const userLevel = PERMISSION_LEVELS[perms[section] ?? "none"] ?? 0;
    const required = PERMISSION_LEVELS[minLevel] ?? 1;
    if (userLevel < required) {
      return {
        ok: false,
        reason: `You don't have ${minLevel} permission on ${section}. Ask an administrator if you need access.`,
      };
    }
    return { ok: true };
  } catch (err) {
    console.error("[voice-safety] permission check error:", err);
    return { ok: false, reason: "Internal error checking permissions." };
  }
}

// Tool → required permission section + level
// Note: tools without an entry fall through to "ok" — that's correct for tools
// whose corresponding routes have no requirePermission gate (tasks, notes,
// calendar events). See routes.ts grep: those endpoints only use requireAuth.
const TOOL_PERMISSIONS: Record<string, { section: string; level: "view" | "edit" }> = {
  find_lead:      { section: "crm",     level: "view" },
  find_account:   { section: "crm",     level: "view" },
  update_lead:    { section: "crm",     level: "edit" },
  update_account: { section: "crm",     level: "edit" },
  update_ticket:  { section: "support", level: "edit" },
  // create_lead mirrors the gate on POST /api/leads
  create_lead:    { section: "crm",     level: "edit" },
  // add_comment + create_note_or_comment are resolved per-target inside requireToolPermission()
  // create_task, create_reminder, create_calendar_event have no app-level gate beyond auth.
};

async function requireToolPermission(
  toolName: string,
  args: any,
  userId: number,
): Promise<{ ok: boolean; reason?: string }> {
  if (toolName === "add_comment") {
    const t = String(args?.object_type || "").toLowerCase();
    const section = t === "ticket" ? "support" : "crm";
    return userHasPermission(userId, section, "edit");
  }
  const spec = TOOL_PERMISSIONS[toolName];
  if (!spec) return { ok: true }; // unknown tools fall through to executeTool's default error
  return userHasPermission(userId, spec.section, spec.level);
}

// ────────────────────────────────────────────────────────────────────────────
// Server-side value validation (enums + numeric bounds + type coercion)
// ────────────────────────────────────────────────────────────────────────────

const LEAD_STATUS_ENUM = new Set([
  "new", "contacted", "qualified", "proposal", "negotiation", "closed_won", "closed_lost",
]);
const LEAD_SEGMENT_ENUM = new Set(["enterprise", "mid_market", "small"]);
const TICKET_STATUS_ENUM = new Set(["new", "open", "in_progress", "resolved", "closed"]);
const TICKET_SEVERITY_ENUM = new Set(["low", "medium", "high", "critical"]);
// account.status: app uses free-text in places; we still defensively normalize common ones
const ACCOUNT_STATUS_ENUM = new Set(["active", "inactive", "prospect", "customer", "churned"]);

interface ValidationResult {
  ok: boolean;
  sanitized?: Record<string, any>;
  errors?: string[];
}

function validateUpdates(objectType: "lead" | "account" | "ticket", updates: Record<string, any>): ValidationResult {
  if (!updates || typeof updates !== "object") {
    return { ok: false, errors: ["No update fields provided."] };
  }
  const errors: string[] = [];
  const sanitized: Record<string, any> = {};

  for (const [rawKey, rawVal] of Object.entries(updates)) {
    const key = String(rawKey).toLowerCase();
    let val = rawVal;

    // Reject explicit null on required-shape fields; allow empty strings to clear text fields.
    if (val === undefined) continue;

    // Reject objects/arrays — LLM hallucinations sometimes wrap simple fields.
    // Numbers, strings, booleans, and null pass through.
    if (val !== null && typeof val === "object") {
      errors.push(`Invalid type for ${key}: expected scalar value, got ${Array.isArray(val) ? "array" : "object"}.`);
      continue;
    }

    if (objectType === "lead") {
      if (key === "status") {
        const v = String(val).toLowerCase().trim();
        if (!LEAD_STATUS_ENUM.has(v)) {
          errors.push(`Invalid lead status "${val}". Allowed: ${[...LEAD_STATUS_ENUM].join(", ")}.`);
          continue;
        }
        val = v;
      } else if (key === "segment") {
        const v = String(val).toLowerCase().trim();
        if (!LEAD_SEGMENT_ENUM.has(v)) {
          errors.push(`Invalid lead segment "${val}". Allowed: ${[...LEAD_SEGMENT_ENUM].join(", ")}.`);
          continue;
        }
        val = v;
      } else if (key === "deal_amount") {
        const n = Number(val);
        if (!Number.isFinite(n) || n < 0) {
          errors.push(`Invalid deal_amount "${val}". Must be a non-negative number.`);
          continue;
        }
        val = n;
      } else if (key === "deal_probability") {
        const n = Number(val);
        if (!Number.isInteger(n) || n < 0 || n > 100) {
          errors.push(`Invalid deal_probability "${val}". Must be an integer 0–100.`);
          continue;
        }
        val = n;
      }
    } else if (objectType === "account") {
      if (key === "status") {
        const v = String(val).toLowerCase().trim();
        if (!ACCOUNT_STATUS_ENUM.has(v)) {
          errors.push(`Invalid account status "${val}". Allowed: ${[...ACCOUNT_STATUS_ENUM].join(", ")}.`);
          continue;
        }
        val = v;
      } else if (key === "annual_revenue" || key === "employees") {
        const n = Number(val);
        if (!Number.isFinite(n) || n < 0) {
          errors.push(`Invalid ${key} "${val}". Must be a non-negative number.`);
          continue;
        }
        val = key === "employees" ? Math.trunc(n) : n;
      }
    } else if (objectType === "ticket") {
      if (key === "status") {
        const v = String(val).toLowerCase().trim();
        if (!TICKET_STATUS_ENUM.has(v)) {
          errors.push(`Invalid ticket status "${val}". Allowed: ${[...TICKET_STATUS_ENUM].join(", ")}.`);
          continue;
        }
        val = v;
      } else if (key === "severity") {
        const v = String(val).toLowerCase().trim();
        if (!TICKET_SEVERITY_ENUM.has(v)) {
          errors.push(`Invalid ticket severity "${val}". Allowed: ${[...TICKET_SEVERITY_ENUM].join(", ")}.`);
          continue;
        }
        val = v;
      }
    }

    sanitized[key] = val;
  }

  if (errors.length) return { ok: false, errors };
  if (Object.keys(sanitized).length === 0) {
    return { ok: false, errors: ["No valid fields to update."] };
  }
  return { ok: true, sanitized };
}

// ────────────────────────────────────────────────────────────────────────────
// Risk assessment + before-state fetch
// ────────────────────────────────────────────────────────────────────────────

const TERMINAL_LEAD_STATUSES = new Set(["closed_won", "closed_lost"]);
const TERMINAL_TICKET_STATUSES = new Set(["resolved", "closed"]);
const DEAL_AMOUNT_ABS_THRESHOLD = 25_000;     // $25k absolute change is risky
const DEAL_AMOUNT_PCT_THRESHOLD = 0.5;        // 50% relative change is risky

async function fetchBeforeState(
  toolName: string,
  args: any,
): Promise<{ table: string; id: number; row: Record<string, any> } | null> {
  try {
    if (toolName === "update_lead") {
      const id = Number(args.lead_id);
      const r = await db.execute(sql`SELECT * FROM leads WHERE id = ${id} LIMIT 1`);
      if (r.rows.length === 0) return null;
      return { table: "lead", id, row: r.rows[0] as any };
    }
    if (toolName === "update_account") {
      const id = Number(args.account_id);
      const r = await db.execute(sql`SELECT * FROM accounts WHERE id = ${id} LIMIT 1`);
      if (r.rows.length === 0) return null;
      return { table: "account", id, row: r.rows[0] as any };
    }
    if (toolName === "update_ticket") {
      const id = Number(args.ticket_id);
      const r = await db.execute(sql`SELECT * FROM tickets WHERE id = ${id} LIMIT 1`);
      if (r.rows.length === 0) return null;
      return { table: "ticket", id, row: r.rows[0] as any };
    }
  } catch (e) {
    console.error("[voice-safety] fetchBeforeState error:", e);
  }
  return null;
}

interface RiskAssessment {
  risky: boolean;
  reasons: string[];
}

function assessRisk(
  toolName: string,
  sanitized: Record<string, any>,
  before: Record<string, any> | null,
): RiskAssessment {
  const reasons: string[] = [];

  if (toolName === "update_lead") {
    if (sanitized.status && TERMINAL_LEAD_STATUSES.has(String(sanitized.status))) {
      reasons.push(`will move lead to terminal status "${sanitized.status}"`);
    }
    if (sanitized.deal_amount !== undefined) {
      const newAmt = Number(sanitized.deal_amount);
      const oldAmt = Number(before?.deal_amount ?? 0);
      const delta = Math.abs(newAmt - oldAmt);
      const pct = oldAmt > 0 ? delta / oldAmt : (newAmt > 0 ? 1 : 0);
      if (delta >= DEAL_AMOUNT_ABS_THRESHOLD || pct >= DEAL_AMOUNT_PCT_THRESHOLD) {
        reasons.push(`will change deal_amount from $${oldAmt} to $${newAmt}`);
      }
    }
    if (sanitized.deal_probability !== undefined) {
      const p = Number(sanitized.deal_probability);
      if (p === 0 || p === 100) {
        reasons.push(`will set deal_probability to ${p}%`);
      }
    }
  } else if (toolName === "update_ticket") {
    if (sanitized.status && TERMINAL_TICKET_STATUSES.has(String(sanitized.status))) {
      reasons.push(`will move ticket to terminal status "${sanitized.status}"`);
    }
  } else if (toolName === "update_account") {
    if (sanitized.status === "churned") {
      reasons.push(`will mark account as churned`);
    }
  }

  return { risky: reasons.length > 0, reasons };
}

function buildPreview(
  toolName: string,
  args: any,
  sanitized: Record<string, any>,
  before: { table: string; id: number; row: Record<string, any> } | null,
  reasons: string[],
): string {
  const label =
    before
      ? `${before.table} #${before.id}` +
        (before.row.company ? ` (${before.row.company})` :
         before.row.name ? ` (${before.row.name})` :
         before.row.subject ? ` (${before.row.subject})` : "")
      : toolName;

  const changes = Object.entries(sanitized).map(([k, v]) => {
    const oldV = before?.row?.[k];
    return oldV !== undefined && oldV !== null
      ? `  • ${k}: ${oldV} → ${v}`
      : `  • ${k}: ${v}`;
  }).join("\n");

  return [
    `⚠ Confirmation required for ${label}.`,
    `Reason: ${reasons.join("; ")}.`,
    `Proposed change(s):`,
    changes,
    `Reply "yes" or "confirm" to apply, or "no" / "cancel" to abort.`,
  ].join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Per-conversation mutex (in-process, single-server Replit deploy).
// Serializes all assistant operations on the same conversation so that the
// "read pending → apply → clear" cycle is atomic against concurrent turns.
// Without this, two parallel "yes" requests on the same conversation could
// both read the same pending action and both apply it.
// ────────────────────────────────────────────────────────────────────────────

const CONV_LOCKS = new Map<number, Promise<unknown>>();

async function withConversationLock<T>(conversationId: number, fn: () => Promise<T>): Promise<T> {
  const prev = CONV_LOCKS.get(conversationId) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  CONV_LOCKS.set(conversationId, prev.then(() => next));
  try {
    await prev; // wait our turn
    return await fn();
  } finally {
    release();
    // Best-effort cleanup so the map doesn't grow unbounded.
    if (CONV_LOCKS.get(conversationId) === prev.then(() => next)) {
      CONV_LOCKS.delete(conversationId);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Confirmation gate state — stored as messages with role "pending_confirm"
// in the existing conversations/messages table. NO schema changes.
// Format: content = JSON.stringify({ toolName, args, sanitized, expiresAt })
// ────────────────────────────────────────────────────────────────────────────

const PENDING_ROLE = "pending_confirm";
const CONFIRM_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface PendingAction {
  toolName: string;
  args: any;
  sanitized: Record<string, any>;
  preview: string;
  expiresAt: number;
  before?: Record<string, any> | null;
  beforeTable?: string;
  beforeId?: number;
}

export async function setPendingConfirmation(conversationId: number, action: PendingAction): Promise<void> {
  await chatStorage.createMessage(conversationId, PENDING_ROLE, JSON.stringify(action));
}

export async function getPendingConfirmation(conversationId: number): Promise<PendingAction | null> {
  const msgs = await chatStorage.getMessagesByConversation(conversationId);
  // Scan from the end for the latest pending_confirm not yet superseded by a *_cleared marker.
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m: any = msgs[i];
    if (m.role === `${PENDING_ROLE}_cleared`) return null;
    if (m.role === PENDING_ROLE) {
      try {
        const parsed = JSON.parse(m.content) as PendingAction;
        if (parsed.expiresAt && parsed.expiresAt < Date.now()) return null;
        return parsed;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function clearPendingConfirmation(conversationId: number, reason: string): Promise<void> {
  await chatStorage.createMessage(conversationId, `${PENDING_ROLE}_cleared`, reason);
}

// Only "user" / "assistant" roles are valid OpenAI message roles. Use this to
// strip our internal `pending_confirm[_cleared]` markers from LLM history.
export function isLLMVisibleRole(role: string): boolean {
  return role === "user" || role === "assistant" || role === "system" || role === "tool";
}

// ────────────────────────────────────────────────────────────────────────────
// Affirmation / denial detection (used to interpret the user's next turn)
// ────────────────────────────────────────────────────────────────────────────

const AFFIRM_RE = /^\s*(yes|y|yeah|yep|yup|confirm|confirmed|do it|go ahead|proceed|sure|ok|okay|approved|approve|sounds good|please do|affirmative)\b[\s.!,]*$/i;
const DENY_RE = /^\s*(no|n|nope|cancel|abort|stop|never\s*mind|nevermind|don['’]?t|do not|negative)\b[\s.!,]*$/i;

export function isAffirmation(text: string): boolean {
  return AFFIRM_RE.test(String(text || "").trim());
}

export function isDenial(text: string): boolean {
  return DENY_RE.test(String(text || "").trim());
}

// ────────────────────────────────────────────────────────────────────────────
// Audit logging via existing activities mechanism (storage.createActivity)
// ────────────────────────────────────────────────────────────────────────────

export type AssistantSource = "voice-assistant" | "voice-assistant-text";

async function logAssistantWrite(opts: {
  source: AssistantSource;
  userId: number;
  userName: string;
  toolName: string;
  objectType: string;     // "lead" | "account" | "ticket"
  objectId: number;
  changedFields: string[];
  before: Record<string, any> | null;
  after: Record<string, any>;
  transcriptSnippet?: string;
}): Promise<void> {
  try {
    const beforeMap: Record<string, any> = {};
    const afterMap: Record<string, any> = {};
    for (const f of opts.changedFields) {
      beforeMap[f] = opts.before?.[f] ?? null;
      afterMap[f] = opts.after[f];
    }
    const summaryParts = [
      `[${opts.source}] ${opts.userName} (#${opts.userId}) ran ${opts.toolName}`,
      `on ${opts.objectType} #${opts.objectId}.`,
      `Fields: ${opts.changedFields.join(", ")}.`,
    ];
    if (opts.transcriptSnippet) {
      const snip = opts.transcriptSnippet.slice(0, 200);
      summaryParts.push(`Prompt: "${snip}${opts.transcriptSnippet.length > 200 ? "…" : ""}"`);
    }
    await storage.createActivity({
      linkedObjectType: opts.objectType,
      linkedObjectId: opts.objectId,
      type: `assistant_${opts.toolName}`,
      subject: `Assistant ${opts.toolName}`,
      summary: summaryParts.join(" "),
      outcome: "success",
      rawContent: JSON.stringify({ before: beforeMap, after: afterMap, source: opts.source }),
      createdBy: opts.userId,
    } as any);
  } catch (e) {
    // Audit failure must not block the user from receiving the success response,
    // but it must be visible in server logs.
    console.error("[voice-safety] audit write failed:", e);
  }
}

async function logAssistantDenial(opts: {
  source: AssistantSource;
  userId: number;
  userName: string;
  toolName: string;
  args: any;
  reason: string;
  transcriptSnippet?: string;
}): Promise<void> {
  try {
    // Best-effort — link to a target object if we can extract one; otherwise skip.
    const objectType =
      opts.toolName === "update_lead" || opts.toolName === "find_lead" ? "lead" :
      opts.toolName === "update_account" || opts.toolName === "find_account" ? "account" :
      opts.toolName === "update_ticket" ? "ticket" :
      opts.toolName === "add_comment" ? String(opts.args?.object_type || "unknown") :
      "unknown";
    const extractedId = Number(
      opts.args?.lead_id ?? opts.args?.account_id ?? opts.args?.ticket_id ?? opts.args?.object_id ?? 0,
    );
    // Always audit denials. If we can't extract a target id (e.g. create_lead
    // before the lead exists, or a generic rate-limit denial), link the audit
    // row to the requesting user instead of silently dropping the record.
    const finalType = extractedId ? objectType : "assistant";
    const finalId = extractedId || opts.userId;
    await storage.createActivity({
      linkedObjectType: finalType,
      linkedObjectId: finalId,
      type: `assistant_denial`,
      subject: `Assistant write denied`,
      summary: `[${opts.source}] ${opts.userName} (#${opts.userId}) blocked from ${opts.toolName}: ${opts.reason}`,
      outcome: "denied",
      rawContent: JSON.stringify({ tool: opts.toolName, args: opts.args, reason: opts.reason, prompt: opts.transcriptSnippet }),
      createdBy: opts.userId,
    } as any);
  } catch (e) {
    console.error("[voice-safety] denial audit failed:", e);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Direct mutation helpers (used after permission/validation/confirmation pass).
// Mirror the buildUpdateQuery whitelist that exists in voice-assistant.ts.
// ────────────────────────────────────────────────────────────────────────────

const LEAD_ALLOWED: Record<string, string> = {
  status: "status", contact_name: "contact_name", contact_email: "contact_email",
  contact_phone: "contact_phone", notes: "notes", tags: "tags", next_step: "next_step",
  deal_amount: "deal_amount", deal_probability: "deal_probability",
  segment: "segment", city: "city", state: "state", country: "country",
  street_address: "street_address", zip_code: "zip_code", slips: "slips",
  source: "source", competitors: "competitors", roi_story: "roi_story",
  primary_value_driver: "primary_value_driver", closed_lost_reason: "closed_lost_reason",
  closed_won_notes: "closed_won_notes",
};
const ACCOUNT_ALLOWED: Record<string, string> = {
  name: "name", industry: "industry", type: "type", status: "status",
  phone: "phone", website: "website", notes: "notes",
  city: "city", state: "state", country: "country",
  street_address: "street_address", zip_code: "zip_code",
  annual_revenue: "annual_revenue", employees: "employees",
};
const TICKET_ALLOWED: Record<string, string> = {
  status: "status", severity: "severity", category: "category",
  subject: "subject", description: "description",
  internal_notes: "internal_notes", resolution_summary: "resolution_summary",
};

function buildSafeUpdate(
  table: string,
  id: number,
  sanitized: Record<string, any>,
  allowed: Record<string, string>,
): { sqlQuery: ReturnType<typeof sql> | null; fieldNames: string[] } {
  const updates: { col: string; val: any }[] = [];
  for (const [k, v] of Object.entries(sanitized)) {
    if (allowed[k]) updates.push({ col: allowed[k], val: v });
  }
  if (updates.length === 0) return { sqlQuery: null, fieldNames: [] };
  let q = sql``;
  for (let i = 0; i < updates.length; i++) {
    if (i > 0) q = sql`${q}, `;
    q = sql`${q}${sql.raw(updates[i].col)} = ${updates[i].val}`;
  }
  q = sql`UPDATE ${sql.raw(table)} SET ${q}, updated_at = NOW() WHERE id = ${id}`;
  return { sqlQuery: q, fieldNames: updates.map(u => u.col) };
}

// ────────────────────────────────────────────────────────────────────────────
// Main entry point — replaces direct executeTool() calls in voice-assistant.ts
// ────────────────────────────────────────────────────────────────────────────

export interface SafeExecContext {
  userId: number;
  userName: string;
  conversationId: number;
  source: AssistantSource;
  userMessage: string;
  /** When true, skip the confirmation gate (used when the user just said "yes"). */
  preApproved?: boolean;
}

/**
 * Resolves the original `executeTool(toolName, args, userId, userName)` contract,
 * but inserts: permission check → validation → risk/confirmation gate → mutation
 * → audit log. Read-only tools (find_*) only get the permission check.
 *
 * Returns the assistant-facing string the LLM should use (or relay) as the tool result.
 */
export async function executeToolSafely(
  toolName: string,
  args: any,
  ctx: SafeExecContext,
  fallbackExecute: (toolName: string, args: any, userId: number, userName: string) => Promise<string>,
): Promise<string> {
  // Serialize all mutation/confirmation work on a single conversation so
  // concurrent turns can't double-apply pending actions.
  return withConversationLock(ctx.conversationId, () =>
    _executeToolSafelyImpl(toolName, args, ctx, fallbackExecute),
  );
}

async function _executeToolSafelyImpl(
  toolName: string,
  args: any,
  ctx: SafeExecContext,
  fallbackExecute: (toolName: string, args: any, userId: number, userName: string) => Promise<string>,
): Promise<string> {
  // 1. Permission
  const perm = await requireToolPermission(toolName, args, ctx.userId);
  if (!perm.ok) {
    await logAssistantDenial({
      source: ctx.source, userId: ctx.userId, userName: ctx.userName,
      toolName, args, reason: perm.reason || "permission denied",
      transcriptSnippet: ctx.userMessage,
    });
    return `Permission denied: ${perm.reason}`;
  }

  // 2. Read-only tools: pass straight through to the existing implementation
  if (toolName === "find_lead" || toolName === "find_account") {
    return fallbackExecute(toolName, args, ctx.userId, ctx.userName);
  }

  // 2.5. CREATE tools (Build Sequence #2) — wrapped with rate-limit +
  // idempotency at the single dispatch chokepoint so create_reminder (which
  // delegates to create_task internally) inherits the same guarantees.
  if (CREATE_TOOLS.has(toolName)) {
    // Rate limit (per-(userId,tool) + per-userId global). preApproved bypasses
    // because the user already paid one bucket-slot when they originally
    // submitted the action that's now being confirmed.
    if (!ctx.preApproved) {
      const rl = checkAndConsumeRateLimit(ctx.userId, toolName);
      if (!rl.ok) {
        await logAssistantDenial({
          source: ctx.source, userId: ctx.userId, userName: ctx.userName,
          toolName, args, reason: rl.reason,
          transcriptSnippet: ctx.userMessage,
        });
        return rl.reason;
      }
    }

    // Idempotency: dedupe identical (userId, tool, args) within a 60s TTL,
    // and serialize concurrent duplicates so only one create row is written.
    // preApproved skips because the confirm-flow IS a deliberate re-execution.
    const idemKey = ctx.preApproved
      ? null
      : idempotencyKey(ctx.userId, toolName, args, args?.idempotency_key);
    if (idemKey) {
      const claim = await claimIdempotency(idemKey);
      if (!claim.ok) return claim.cached;
    }

    const dispatch = (): Promise<string> => {
      switch (toolName) {
        case "create_task":              return executeCreateTask(args, ctx);
        case "create_reminder":          return executeCreateReminder(args, ctx);
        case "create_lead":              return executeCreateLead(args, ctx);
        case "create_note_or_comment":   return executeCreateNoteOrComment(args, ctx);
        case "create_calendar_event":    return executeCreateCalendarEvent(args, ctx);
        default: return Promise.resolve(`Unknown create tool: ${toolName}`);
      }
    };

    if (idemKey) {
      const p = dispatch();
      reserveInflight(idemKey, p);
      const result = await p;
      // Only cache successful (✓) or confirmation-gated (⚠) responses; failed
      // validations are fine to retry immediately.
      if (result.startsWith("✓") || result.startsWith("⚠")) {
        recordIdempotency(idemKey, result);
      }
      return result;
    }
    return dispatch();
  }

  // 3. add_comment: validate target type, then pass through (audit row created here too)
  if (toolName === "add_comment") {
    const t = String(args?.object_type || "").toLowerCase();
    if (!["lead", "account", "ticket"].includes(t)) {
      return `Error: object_type must be one of lead, account, ticket. Got "${args?.object_type}".`;
    }
    const oid = Number(args?.object_id);
    if (!Number.isInteger(oid) || oid <= 0) {
      return `Error: object_id must be a positive integer.`;
    }
    const content = String(args?.content || "").trim();
    if (!content) return `Error: comment content cannot be empty.`;
    const result = await fallbackExecute("add_comment", { ...args, content }, ctx.userId, ctx.userName);
    if (result.startsWith("Successfully")) {
      await logAssistantWrite({
        source: ctx.source, userId: ctx.userId, userName: ctx.userName,
        toolName: "add_comment", objectType: t, objectId: oid,
        changedFields: ["comment"],
        before: null, after: { comment: content },
        transcriptSnippet: ctx.userMessage,
      });
    }
    return result;
  }

  // 4. Update tools: validate → risk-gate → mutate → audit
  const objectType: "lead" | "account" | "ticket" =
    toolName === "update_lead" ? "lead" :
    toolName === "update_account" ? "account" :
    toolName === "update_ticket" ? "ticket" :
    (() => { throw new Error(`unsupported tool ${toolName}`); })();

  const validation = validateUpdates(objectType, args?.updates || {});
  if (!validation.ok) {
    return `Validation failed: ${(validation.errors || []).join(" ")}`;
  }
  const sanitized = validation.sanitized!;

  const before = await fetchBeforeState(toolName, args);
  if (!before) {
    return `Error: ${objectType} with the given ID was not found.`;
  }

  // 5. Risk + confirmation gate
  if (!ctx.preApproved) {
    const risk = assessRisk(toolName, sanitized, before.row);
    if (risk.risky) {
      const preview = buildPreview(toolName, args, sanitized, before, risk.reasons);
      await setPendingConfirmation(ctx.conversationId, {
        toolName,
        args,
        sanitized,
        preview,
        expiresAt: Date.now() + CONFIRM_TTL_MS,
        before: before.row,
        beforeTable: before.table,
        beforeId: before.id,
      });
      return preview;
    }
  }

  // 6. Mutate via the same whitelist + parameterized SQL
  const allowed =
    objectType === "lead" ? LEAD_ALLOWED :
    objectType === "account" ? ACCOUNT_ALLOWED :
    TICKET_ALLOWED;
  const tableName =
    objectType === "lead" ? "leads" :
    objectType === "account" ? "accounts" :
    "tickets";

  const { sqlQuery, fieldNames } = buildSafeUpdate(tableName, before.id, sanitized, allowed);
  if (!sqlQuery) return `Error: No valid fields to update.`;

  try {
    await db.execute(sqlQuery);
  } catch (err: any) {
    console.error(`[voice-safety] ${toolName} mutation failed:`, err);
    return `Error updating ${objectType}: ${err?.message || "database error"}`;
  }

  // 7. Audit + clear any pending state for this conversation
  await logAssistantWrite({
    source: ctx.source, userId: ctx.userId, userName: ctx.userName,
    toolName, objectType, objectId: before.id,
    changedFields: Object.keys(sanitized),
    before: before.row, after: sanitized,
    transcriptSnippet: ctx.userMessage,
  });
  if (ctx.preApproved) {
    await clearPendingConfirmation(ctx.conversationId, "applied after user confirmation");
  }

  const label =
    before.row.company || before.row.name || before.row.subject || `#${before.id}`;
  return `Successfully updated ${objectType} "${label}" (ID: ${before.id}). Fields changed: ${fieldNames.join(", ")}.`;
}

/**
 * Called at the top of every assistant turn. If the user just said "yes" or
 * "no" to a pending confirmation, we handle it here and return a result string
 * (which the endpoint should surface and skip the LLM tool loop). Returns null
 * if there is no pending confirmation, OR the user's message isn't a clear
 * yes/no (in which case the pending confirmation is implicitly abandoned —
 * the LLM gets the new instruction).
 */
export async function handleConfirmationTurn(
  userMessage: string,
  ctx: SafeExecContext,
  fallbackExecute: (toolName: string, args: any, userId: number, userName: string) => Promise<string>,
): Promise<{ handled: true; result: string } | { handled: false }> {
  // Hold the per-conversation lock for the entire read-pending → apply → clear cycle
  // so two concurrent "yes" turns can't both consume the same pending action.
  return withConversationLock(ctx.conversationId, async () => {
    const pending = await getPendingConfirmation(ctx.conversationId);
    if (!pending) return { handled: false } as const;

    if (isAffirmation(userMessage)) {
      // Call the unwrapped impl to avoid re-entrant lock acquisition.
      const result = await _executeToolSafelyImpl(
        pending.toolName,
        pending.args,
        { ...ctx, preApproved: true, userMessage },
        fallbackExecute,
      );
      return { handled: true, result } as const;
    }
    if (isDenial(userMessage)) {
      await clearPendingConfirmation(ctx.conversationId, "user denied");
      return { handled: true, result: "Cancelled. The pending change was not applied." } as const;
    }
    // Ambiguous response → drop the pending action so the new message is treated fresh.
    await clearPendingConfirmation(ctx.conversationId, "superseded by new instruction");
    return { handled: false } as const;
  });
}

// ════════════════════════════════════════════════════════════════════════════
// Build Sequence #2: CREATE tools — additive only, no schema changes.
// Reuses storage.createX, the same audit table, and the same pending-confirm
// + per-conversation lock infrastructure already proven by Build #1.
// ════════════════════════════════════════════════════════════════════════════

const CREATE_TOOLS = new Set([
  "create_task",
  "create_reminder",
  "create_lead",
  "create_note_or_comment",
  "create_calendar_event",
]);

// Linkable object types accepted across create_* tools.
const LINKABLE_TYPES = new Set([
  "lead", "account", "ticket", "contact", "opportunity", "project", "quote",
]);
const LINKABLE_TABLE: Record<string, string> = {
  lead: "leads", account: "accounts", ticket: "tickets",
  contact: "contacts", opportunity: "opportunities",
  project: "projects", quote: "quotes",
};

const TASK_PRIORITY_ENUM = new Set(["low", "medium", "high", "urgent"]);
const TASK_STATUS_ENUM   = new Set(["pending", "in_progress", "completed", "cancelled", "blocked"]);

function parseISODate(input: any, label: string): { ok: true; date?: Date } | { ok: false; error: string } {
  if (input === undefined || input === null || input === "") return { ok: true };
  if (typeof input !== "string") return { ok: false, error: `${label} must be an ISO 8601 string` };
  const d = new Date(input);
  if (isNaN(d.getTime())) return { ok: false, error: `${label} is not a valid date: "${input}"` };
  return { ok: true, date: d };
}

// (verifyObjectExists removed — replaced by requireAccessibleLinkedObject from
// voice-assistant-create-guards.ts, which combines existence + per-section
// permission visibility into one uniform-error check.)

// Now delegates to safeAuditWrite — DB insert with file fallback so a
// transient audit-table failure can never blow up a successful create.
async function logAssistantCreate(opts: {
  source: AssistantSource;
  userId: number;
  userName: string;
  toolName: string;
  objectType: string;
  objectId: number;
  summary: string;
  payload: Record<string, any>;
  transcriptSnippet?: string;
}): Promise<void> {
  await safeAuditWrite({ ...opts, source: String(opts.source) });
}

// ──────────── Cortex private column helper ─────────────────────────────────
// Auto-provisions a per-user private "Cortex Tasks" column the first time it is
// needed. The column is stored in user_task_columns with a user-scoped slug so
// it is never visible to other users unless they are explicitly granted access
// via task_column_shares (which Cortex never does).
async function ensureCortexPrivateColumn(userId: number): Promise<string> {
  const slug = "cortex_tasks";
  const fullSlug = `u${userId}_${slug}`;
  await db.execute(sql`
    INSERT INTO user_task_columns (user_id, slug, label, color, sort_order)
    VALUES (${userId}, ${slug}, ${"Cortex Tasks"}, ${"violet"}, 999)
    ON CONFLICT (user_id, slug) DO NOTHING
  `);
  return fullSlug;
}

/** Returns true when the first two words of the message are "create task" (case-insensitive). */
function startsWithCreateTask(msg: string): boolean {
  const words = msg.trim().toLowerCase().split(/\s+/);
  return words[0] === "create" && words[1] === "task";
}

// ──────────── create_task ──────────────────────────────────────────────────
async function executeCreateTask(args: any, ctx: SafeExecContext): Promise<string> {
  const title = String(args?.title || "").trim();
  if (!title) return "I need a title to create a task. What should I call it?";

  const tz = args?.time_zone ? String(args.time_zone) : null;
  const due = parseTzAwareISODate(args?.due_date, "due_date", tz);
  if (!due.ok) return `Validation failed: ${due.error}`;
  const start = parseTzAwareISODate(args?.start_date, "start_date", tz);
  if (!start.ok) return `Validation failed: ${start.error}`;
  const remind = parseTzAwareISODate(args?.reminder_at, "reminder_at", tz);
  if (!remind.ok) return `Validation failed: ${remind.error}`;

  const priority = TASK_PRIORITY_ENUM.has(String(args?.priority || "").toLowerCase())
    ? String(args.priority).toLowerCase() : "medium";
  const status = TASK_STATUS_ENUM.has(String(args?.status || "").toLowerCase())
    ? String(args.status).toLowerCase() : "pending";

  const linkedType = args?.linked_object_type ? String(args.linked_object_type).toLowerCase() : null;
  const linkedIdRaw = args?.linked_object_id;
  const linkedId = (linkedIdRaw !== undefined && linkedIdRaw !== null && linkedIdRaw !== "") ? Number(linkedIdRaw) : null;
  if (linkedType && !LINKABLE_TYPES.has(linkedType)) {
    return `Validation failed: linked_object_type "${linkedType}" not supported. Valid: ${[...LINKABLE_TYPES].join(", ")}.`;
  }
  if ((linkedType && linkedId === null) || (linkedId !== null && (!Number.isInteger(linkedId) || linkedId <= 0))) {
    return `Validation failed: linked_object_id must be a positive integer when linked_object_type is set.`;
  }
  if (linkedType && linkedId) {
    const access = await requireAccessibleLinkedObject(ctx.userId, linkedType, linkedId);
    if (!access.ok) return access.reason;
  }

  const ownerUserId = (args?.owner_user_id !== undefined && args.owner_user_id !== null) ? Number(args.owner_user_id) : ctx.userId;
  if (!Number.isInteger(ownerUserId) || ownerUserId <= 0) {
    return `Validation failed: owner_user_id must be a positive integer.`;
  }

  const description = args?.description ? String(args.description) : null;

  // If the user opened with "create task …" (first two words), route the task
  // into their private Cortex Tasks column, which is auto-provisioned on first
  // use and never shared with other users.
  let boardColumn: string | undefined;
  if (startsWithCreateTask(ctx.userMessage)) {
    boardColumn = await ensureCortexPrivateColumn(ctx.userId);
  }

  let created: any;
  try {
    created = await storage.createTask({
      title,
      description: description as any,
      dueDate: due.date as any,
      startDate: start.date as any,
      reminderAt: remind.date as any,
      priority,
      status,
      ownerUserId,
      createdByUserId: ctx.userId,
      lastUpdatedByUserId: ctx.userId,
      linkedObjectType: linkedType as any,
      linkedObjectId: linkedId as any,
      source: args?.source ? String(args.source) : "voice-assistant",
      boardColumn: boardColumn as any,
      sortOrder: 0,
    } as any);
  } catch (e: any) {
    console.error("[voice-safety] create_task failed:", e);
    return `Error creating task: ${e?.message || "database error"}`;
  }

  await logAssistantCreate({
    source: ctx.source, userId: ctx.userId, userName: ctx.userName,
    toolName: "create_task",
    objectType: linkedType || "task",
    objectId: linkedId || created.id,
    summary: `created task "${title}" (#${created.id})`,
    payload: {
      task_id: created.id, title, priority, status,
      due_date: due.date?.toISOString(), reminder_at: remind.date?.toISOString(),
      owner_user_id: ownerUserId,
      linked: linkedType ? `${linkedType}#${linkedId}` : null,
    },
    transcriptSnippet: ctx.userMessage,
  });

  const dueStr = due.date ? `, due ${due.date.toISOString().slice(0, 16).replace("T", " ")} UTC` : "";
  const linkStr = linkedType ? `, linked to ${linkedType} #${linkedId}` : "";
  return `✓ Created task "${title}" (#${created.id})${dueStr}${linkStr}.`;
}

// ──────────── create_reminder (= create_task w/ reminderAt + source) ──────
async function executeCreateReminder(args: any, ctx: SafeExecContext): Promise<string> {
  const text = String(args?.text || args?.title || "").trim();
  if (!text) return "What would you like me to remind you about?";

  const tz = args?.time_zone ? String(args.time_zone) : null;
  const when = parseTzAwareISODate(args?.remind_at, "remind_at", tz);
  if (!when.ok) return `Validation failed: ${when.error}`;
  if (!when.date) return `When should I remind you? Please give me a specific time (ISO 8601 like "${new Date(Date.now() + 3600_000).toISOString()}").`;
  if (when.date.getTime() < Date.now() - 60_000) {
    return `Validation failed: remind_at "${args.remind_at}" is in the past.`;
  }

  return executeCreateTask({
    title: text,
    description: args?.notes,
    due_date: when.date.toISOString(),
    reminder_at: when.date.toISOString(),
    priority: "medium",
    status: "pending",
    linked_object_type: args?.linked_object_type,
    linked_object_id: args?.linked_object_id,
    owner_user_id: ctx.userId,
    source: "reminder",
  }, ctx);
}

// ──────────── create_lead ──────────────────────────────────────────────────
async function executeCreateLead(args: any, ctx: SafeExecContext): Promise<string> {
  const company = String(args?.company || "").trim();
  if (!company) return "I need a company / marina name to create a lead. What's it called?";
  const contactName = String(args?.contact_name || "").trim();
  if (!contactName) return `I need a contact name to create the lead for "${company}". Who's the primary contact?`;

  const status = String(args?.status || "new").toLowerCase();
  if (!LEAD_STATUS_ENUM.has(status)) {
    return `Validation failed: Invalid lead status "${status}". Allowed: ${[...LEAD_STATUS_ENUM].join(", ")}.`;
  }
  const segment = args?.segment ? String(args.segment).toLowerCase() : null;
  if (segment && !LEAD_SEGMENT_ENUM.has(segment)) {
    return `Validation failed: Invalid segment "${segment}". Allowed: ${[...LEAD_SEGMENT_ENUM].join(", ")}.`;
  }

  let dealAmount: number | null = null;
  if (args?.deal_amount !== undefined && args?.deal_amount !== null && args?.deal_amount !== "") {
    dealAmount = Number(args.deal_amount);
    if (!Number.isFinite(dealAmount) || dealAmount < 0) {
      return `Validation failed: deal_amount must be a non-negative number.`;
    }
  }

  // Risk gate: large deal_amount on creation requires confirmation.
  if (!ctx.preApproved && dealAmount !== null && dealAmount >= 100_000) {
    const preview = [
      `⚠ Confirmation required: about to create lead "${company}" with deal_amount $${dealAmount.toLocaleString()}.`,
      `Contact: ${contactName}`,
      `Status: ${status}`,
      `Reply "yes" or "confirm" to apply, or "no" / "cancel" to abort.`,
    ].join("\n");
    await setPendingConfirmation(ctx.conversationId, {
      toolName: "create_lead",
      args,
      sanitized: {},
      preview,
      expiresAt: Date.now() + CONFIRM_TTL_MS,
      before: null,
      beforeTable: "leads",
      beforeId: 0,
    });
    return preview;
  }

  let created: any;
  try {
    created = await storage.createLead({
      company,
      contactName,
      contactEmail: args?.contact_email ? String(args.contact_email).trim() : (undefined as any),
      contactPhone: args?.contact_phone ? String(args.contact_phone).trim() : (undefined as any),
      status,
      segment: segment || (undefined as any),
      dealAmount: dealAmount !== null ? dealAmount : (undefined as any),
      notes: args?.notes ? String(args.notes) : (undefined as any),
      source: args?.source ? String(args.source) : "voice-assistant",
      nextStep: args?.next_step ? String(args.next_step) : (undefined as any),
      city: args?.city ? String(args.city) : (undefined as any),
      state: args?.state ? String(args.state) : (undefined as any),
      country: args?.country ? String(args.country) : (undefined as any),
      ownerUserId: ctx.userId,
    } as any);
  } catch (e: any) {
    console.error("[voice-safety] create_lead failed:", e);
    return `Error creating lead: ${e?.message || "database error"}`;
  }

  await logAssistantCreate({
    source: ctx.source, userId: ctx.userId, userName: ctx.userName,
    toolName: "create_lead",
    objectType: "lead",
    objectId: created.id,
    summary: `created lead "${company}" (#${created.id}) — contact ${contactName}`,
    payload: {
      lead_id: created.id, company, contact_name: contactName,
      status, segment, deal_amount: dealAmount,
      contact_email: args?.contact_email || null,
      contact_phone: args?.contact_phone || null,
    },
    transcriptSnippet: ctx.userMessage,
  });
  if (ctx.preApproved) {
    await clearPendingConfirmation(ctx.conversationId, "applied after user confirmation");
  }

  const dealStr = dealAmount !== null ? `, deal $${dealAmount.toLocaleString()}` : "";
  return `✓ Created lead "${company}" (#${created.id}), contact ${contactName}, status ${status}${dealStr}.`;
}

// ──────────── create_note_or_comment ───────────────────────────────────────
async function executeCreateNoteOrComment(args: any, ctx: SafeExecContext): Promise<string> {
  const kind = String(args?.kind || "note").toLowerCase();
  if (kind !== "note" && kind !== "comment") {
    return `Validation failed: kind must be "note" or "comment".`;
  }
  const objType = String(args?.object_type || "").toLowerCase();
  if (!LINKABLE_TYPES.has(objType)) {
    return `Validation failed: object_type must be one of ${[...LINKABLE_TYPES].join(", ")}.`;
  }
  const objId = Number(args?.object_id);
  if (!Number.isInteger(objId) || objId <= 0) {
    return `Validation failed: object_id must be a positive integer.`;
  }
  const content = String(args?.content || "").trim();
  if (!content) return `What should the ${kind} say?`;

  // Permission check per-target (mirrors add_comment behavior).
  const section = objType === "ticket" ? "support" : "crm";
  const perm = await userHasPermission(ctx.userId, section, "edit");
  if (!perm.ok) {
    await logAssistantDenial({
      source: ctx.source, userId: ctx.userId, userName: ctx.userName,
      toolName: "create_note_or_comment",
      args, reason: perm.reason || "permission denied",
      transcriptSnippet: ctx.userMessage,
    });
    return `Permission denied: ${perm.reason}`;
  }

  const access = await requireAccessibleLinkedObject(ctx.userId, objType, objId);
  if (!access.ok) return `Cannot add ${kind}: ${access.reason}`;

  try {
    if (kind === "comment") {
      const c = await storage.createComment({
        objectType: objType,
        objectId: objId,
        userId: ctx.userId,
        userName: ctx.userName,
        content,
      } as any);
      await logAssistantCreate({
        source: ctx.source, userId: ctx.userId, userName: ctx.userName,
        toolName: "create_comment",
        objectType: objType, objectId: objId,
        summary: `added comment (#${c.id}) to ${objType} #${objId}`,
        payload: { comment_id: c.id, content },
        transcriptSnippet: ctx.userMessage,
      });
      return `✓ Added comment to ${objType} #${objId}.`;
    }
    // kind === "note"
    const n = await storage.createNote({
      linkedObjectType: objType,
      linkedObjectId: objId,
      authorId: ctx.userId,
      authorName: ctx.userName,
      content,
      isPinned: !!args?.is_pinned,
    } as any);
    await logAssistantCreate({
      source: ctx.source, userId: ctx.userId, userName: ctx.userName,
      toolName: "create_note",
      objectType: objType, objectId: objId,
      summary: `added note (#${n.id}) to ${objType} #${objId}`,
      payload: { note_id: n.id, content, is_pinned: !!args?.is_pinned },
      transcriptSnippet: ctx.userMessage,
    });
    return `✓ Added note to ${objType} #${objId}.`;
  } catch (e: any) {
    console.error("[voice-safety] create_note_or_comment failed:", e);
    return `Error creating ${kind}: ${e?.message || "database error"}`;
  }
}

// ──────────── create_calendar_event ────────────────────────────────────────
async function executeCreateCalendarEvent(args: any, ctx: SafeExecContext): Promise<string> {
  const title = String(args?.title || "").trim();
  if (!title) return "What should I call the calendar event?";

  const tz = args?.time_zone ? String(args.time_zone) : null;
  const startP = parseTzAwareISODate(args?.start_time, "start_time", tz);
  if (!startP.ok) return `Validation failed: ${startP.error}`;
  if (!startP.date) return "When does the event start? Please give me an ISO 8601 datetime.";
  if (startP.date.getTime() < Date.now() - 60_000) {
    return `Validation failed: start_time "${args.start_time}" is in the past.`;
  }
  const endP = parseTzAwareISODate(args?.end_time, "end_time", tz);
  if (!endP.ok) return `Validation failed: ${endP.error}`;

  const allDay = !!args?.all_day;
  let endDate = endP.date;
  if (endDate && endDate.getTime() <= startP.date.getTime()) {
    return `Validation failed: end_time must be after start_time.`;
  }
  // Default to a 30-minute meeting if no end given and not all-day.
  if (!endDate && !allDay) endDate = new Date(startP.date.getTime() + 30 * 60_000);

  const linkedType = args?.linked_object_type ? String(args.linked_object_type).toLowerCase() : null;
  const linkedIdRaw = args?.linked_object_id;
  const linkedId = (linkedIdRaw !== undefined && linkedIdRaw !== null && linkedIdRaw !== "") ? Number(linkedIdRaw) : null;
  if (linkedType && !LINKABLE_TYPES.has(linkedType)) {
    return `Validation failed: linked_object_type "${linkedType}" not supported.`;
  }
  if ((linkedType && linkedId === null) || (linkedId !== null && (!Number.isInteger(linkedId) || linkedId <= 0))) {
    return `Validation failed: linked_object_id must be a positive integer when linked_object_type is set.`;
  }
  if (linkedType && linkedId) {
    const access = await requireAccessibleLinkedObject(ctx.userId, linkedType, linkedId);
    if (!access.ok) return access.reason;
  }

  let invitees: string[] | undefined;
  if (Array.isArray(args?.invitees)) {
    invitees = args.invitees
      .map((x: any) => (typeof x === "string" ? x.trim() : ""))
      .filter((x: string) => x && x.includes("@"));
    if (invitees.length === 0) invitees = undefined;
  }

  let created: any;
  try {
    created = await storage.createCalendarEvent({
      userId: ctx.userId,
      title,
      description: args?.description ? String(args.description) : (undefined as any),
      eventType: args?.event_type ? String(args.event_type) : "meeting",
      startTime: startP.date,
      endTime: (endDate as any),
      allDay,
      location: args?.location ? String(args.location) : (undefined as any),
      meetingUrl: args?.meeting_url ? String(args.meeting_url) : (undefined as any),
      linkedObjectType: linkedType as any,
      linkedObjectId: linkedId as any,
      invitees: invitees as any,
      timeZone: args?.time_zone ? String(args.time_zone) : (undefined as any),
      status: "scheduled",
    } as any);
  } catch (e: any) {
    console.error("[voice-safety] create_calendar_event failed:", e);
    return `Error creating calendar event: ${e?.message || "database error"}`;
  }

  await logAssistantCreate({
    source: ctx.source, userId: ctx.userId, userName: ctx.userName,
    toolName: "create_calendar_event",
    objectType: linkedType || "calendar_event",
    objectId: linkedId || created.id,
    summary: `created calendar event "${title}" (#${created.id}) starting ${startP.date.toISOString()}`,
    payload: {
      event_id: created.id, title,
      start_time: startP.date.toISOString(),
      end_time: endDate?.toISOString() || null,
      all_day: allDay, invitees: invitees || null,
      linked: linkedType ? `${linkedType}#${linkedId}` : null,
    },
    transcriptSnippet: ctx.userMessage,
  });

  const startStr = startP.date.toISOString().slice(0, 16).replace("T", " ");
  const endStr = endDate && !allDay ? ` until ${endDate.toISOString().slice(11, 16)}` : (allDay ? " (all day)" : "");
  const linkStr = linkedType ? `, linked to ${linkedType} #${linkedId}` : "";
  return `✓ Created calendar event "${title}" (#${created.id}) starting ${startStr} UTC${endStr}${linkStr}.`;
}
