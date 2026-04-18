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
const TOOL_PERMISSIONS: Record<string, { section: string; level: "view" | "edit" }> = {
  find_lead:      { section: "crm",     level: "view" },
  find_account:   { section: "crm",     level: "view" },
  update_lead:    { section: "crm",     level: "edit" },
  update_account: { section: "crm",     level: "edit" },
  update_ticket:  { section: "support", level: "edit" },
  // add_comment is resolved per-target inside requireToolPermission()
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
    const objectId = Number(
      opts.args?.lead_id ?? opts.args?.account_id ?? opts.args?.ticket_id ?? opts.args?.object_id ?? 0,
    );
    if (!objectId) return; // can't link an activity without a target id
    await storage.createActivity({
      linkedObjectType: objectType,
      linkedObjectId: objectId,
      type: `assistant_${opts.toolName}_denied`,
      subject: `Assistant write denied`,
      summary: `[${opts.source}] ${opts.userName} (#${opts.userId}) blocked from ${opts.toolName}: ${opts.reason}`,
      outcome: "denied",
      rawContent: JSON.stringify({ args: opts.args, reason: opts.reason, prompt: opts.transcriptSnippet }),
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
