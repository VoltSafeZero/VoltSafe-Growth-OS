/**
 * Voice Assistant — Create Tool Hardening Guards
 *
 * Additive layer used by every create_* handler in voice-assistant-safety.ts.
 * Provides:
 *   1. requireAccessibleLinkedObject() — combined existence + permission check
 *      (visibility-safe: same error for not-found / unauthorized)
 *   2. parseTzAwareISODate() — rejects ambiguous local times unless an
 *      explicit IANA `time_zone` argument is supplied
 *   3. claimIdempotency() / recordIdempotency() — sha256-keyed dedupe with a
 *      60s TTL. Concurrent duplicate submissions only execute once.
 *   4. checkAndConsumeRateLimit() — sliding-window per-(userId,tool) limiter
 *      plus a per-userId global cap across all create_* tools
 *   5. safeAuditWrite() — wraps storage.createActivity with a file fallback so
 *      a partial audit failure never blows up a successful create
 *
 * NO schema changes, NO new tables, NO new dependencies.
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { storage } from "./storage";

// ────────────────────────────────────────────────────────────────────────────
// 1. Per-object visibility
// ────────────────────────────────────────────────────────────────────────────

const PERMISSION_LEVELS: Record<string, number> = { none: 0, view: 1, edit: 2 };

const LINKABLE_TABLE: Record<string, string> = {
  lead: "leads", account: "accounts", ticket: "tickets",
  contact: "contacts", opportunity: "opportunities",
  project: "projects", quote: "quotes",
};

// Maps a linkable object type to the permission section that gates it.
// Mirrors the section conventions used elsewhere in voice-assistant-safety.ts.
// Extended to cover every objectType that attachments may be linked to so the
// attachment ACL helper (requireSectionView) can resolve a section for any
// row it is asked about. Unknown types default to "crm" (most restrictive
// existing section) — see attachmentSectionFor() below.
// Round-2 review #3 (BOLA cross-section): keep this map in lock-step with the
// actual prefix-gates registered in server/routes.ts (see app.use("/api/...")
// + requirePermission(...)). A user without `projects:view` must NOT be able
// to read project attachments / project task exports just because they have
// `crm:view`.
const LINKABLE_SECTION: Record<string, string> = {
  lead: "crm", account: "crm", contact: "crm",
  opportunity: "crm", general: "crm",
  install_workflow: "crm", deployment: "crm",
  purchase_order: "crm", customer_success: "crm",
  // Tasks live under the same gate as the rest of the CRM/execution surface;
  // every /api/tasks state-change route already requires crm:edit, and the
  // task drawer only opens for users who are already viewing tasks they
  // can see, so crm:view is a safe minimum.
  task: "crm",
  project: "projects",
  quote: "quoting",
  partnership: "partnerships", ecosystem: "partnerships",
  ticket: "support",
  asset: "knowledge",
  campaign: "communications", comm_list: "communications",
};

/**
 * Returns the permission section that gates a given attachment objectType.
 * Defaults to "crm" for any unknown/legacy type so the gate fails closed
 * (a low-perm user must have crm:view at minimum to read any attachment).
 */
export function attachmentSectionFor(objectType: string): string {
  return LINKABLE_SECTION[String(objectType || "").toLowerCase()] || "crm";
}

/**
 * Strict variant for export endpoints. Returns null for unknown objectTypes
 * so the caller can fail closed with a 400 instead of silently defaulting to
 * "crm" (which would otherwise let any crm:view user export arbitrary
 * objectTypes that route to other sections).
 */
export function exportSectionFor(objectType: string): string | null {
  return LINKABLE_SECTION[String(objectType || "").toLowerCase()] ?? null;
}

/**
 * Cheap section-only permission check (no row existence lookup).
 * Used by attachment access checks where the row is already loaded.
 */
export async function requireSectionView(
  userId: number,
  section: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const u = await getUserPermView(userId);
    if (!u) return { ok: false, reason: "user not found" };
    if (u.globalRole === "admin" || u.globalRole === "master_admin") return { ok: true };
    const perms = (u.permissions as Record<string, string>) || {};
    const lvl = PERMISSION_LEVELS[perms[section] ?? "none"] ?? 0;
    if (lvl < PERMISSION_LEVELS.view) {
      return { ok: false, reason: `insufficient permissions: requires view on ${section}` };
    }
    return { ok: true };
  } catch (e) {
    console.error("[create-guards] requireSectionView error:", e);
    return { ok: false, reason: "permission check failed" };
  }
}

async function getUserPermView(userId: number) {
  const [u] = await db
    .select({ globalRole: users.globalRole, permissions: users.permissions })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return u || null;
}

/**
 * Existence + access check in a single call. Returns the SAME error string
 * for "doesn't exist" and "you can't see it" so a caller cannot enumerate
 * objects they aren't allowed to see.
 */
export async function requireAccessibleLinkedObject(
  userId: number,
  type: string,
  id: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const t = String(type || "").toLowerCase();
  const table = LINKABLE_TABLE[t];
  if (!table) return { ok: false, reason: `linked_object_type "${type}" not supported.` };
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, reason: `linked_object_id must be a positive integer.` };
  }

  const section = LINKABLE_SECTION[t] || "crm";
  // Visibility-uniform error — used for both "doesn't exist" and "no access".
  const opaqueError = `Cannot link to ${t} #${id} — no such record or you don't have access.`;

  try {
    const u = await getUserPermView(userId);
    if (!u) return { ok: false, reason: opaqueError };

    const isAdmin = u.globalRole === "admin" || u.globalRole === "master_admin";
    if (!isAdmin) {
      const perms = (u.permissions as Record<string, string>) || {};
      const lvl = PERMISSION_LEVELS[perms[section] ?? "none"] ?? 0;
      if (lvl < PERMISSION_LEVELS.view) {
        // No-access path: do NOT issue a SELECT (avoid timing leak), just deny.
        return { ok: false, reason: opaqueError };
      }
    }

    const r = await db.execute(
      sql`SELECT 1 FROM ${sql.raw(table)} WHERE id = ${id} LIMIT 1`,
    );
    if (r.rows.length === 0) return { ok: false, reason: opaqueError };
    return { ok: true };
  } catch (e) {
    console.error("[create-guards] visibility check error:", e);
    return { ok: false, reason: opaqueError };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 2. Timezone normalization
// ────────────────────────────────────────────────────────────────────────────

// Strict ISO 8601 with explicit zone designator (Z or ±HH:MM[:SS])
const ISO_WITH_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}(:\d{2})?)$/;

function ianaTzOffsetMs(date: Date, ianaTz: string): number | null {
  // Compute "what UTC instant does (date's wallclock components, interpreted
  // in ianaTz) point to?" — i.e. the offset from UTC for that wallclock time.
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: ianaTz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const parts = dtf.formatToParts(date).reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});
    const asUTC = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
    );
    return asUTC - date.getTime();
  } catch {
    return null;
  }
}

/**
 * Parse an ISO datetime string. UTC is the canonical storage form.
 *   - Strings ending in "Z" or "+/-HH:MM" → parsed as-is (always UTC after Date()).
 *   - TZ-naive strings (no Z, no offset) →
 *       * if `fallbackTz` is a valid IANA zone → interpret wallclock in that zone
 *       * else → REJECT with a clarification message
 *
 * Returns `{ ok:true, date?: Date, normalizedISO?: string }` (omitted fields
 * mean "input was empty"). On failure: `{ ok:false, error }`.
 */
export function parseTzAwareISODate(
  input: any,
  label: string,
  fallbackTz?: string | null,
): { ok: true; date?: Date; normalizedISO?: string } | { ok: false; error: string } {
  if (input === undefined || input === null || input === "") return { ok: true };
  if (typeof input !== "string") return { ok: false, error: `${label} must be an ISO 8601 string.` };
  const s = input.trim();

  // Fast path: explicit zone designator
  if (ISO_WITH_TZ.test(s)) {
    const d = new Date(s);
    if (isNaN(d.getTime())) return { ok: false, error: `${label} is not a valid date: "${input}"` };
    return { ok: true, date: d, normalizedISO: d.toISOString() };
  }

  // TZ-naive — only allow if caller supplied an IANA fallback
  if (!fallbackTz) {
    return {
      ok: false,
      error: `${label} "${input}" is missing a timezone. Either include a "Z" suffix (UTC) or an offset like "-07:00", or pass a "time_zone" argument like "America/Los_Angeles".`,
    };
  }
  // Validate the IANA zone
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: fallbackTz });
  } catch {
    return { ok: false, error: `time_zone "${fallbackTz}" is not a valid IANA timezone.` };
  }
  // Parse as if UTC, then shift by the zone's offset for that wallclock
  const naive = new Date(s + "Z");
  if (isNaN(naive.getTime())) return { ok: false, error: `${label} is not a valid date: "${input}"` };
  const offset = ianaTzOffsetMs(naive, fallbackTz);
  if (offset === null) return { ok: false, error: `Cannot apply time_zone "${fallbackTz}" to ${label}.` };
  const utc = new Date(naive.getTime() - offset);
  return { ok: true, date: utc, normalizedISO: utc.toISOString() };
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Idempotency (SHA-256 over canonical args, 60s TTL)
// ────────────────────────────────────────────────────────────────────────────

const IDEMPOTENCY_TTL_MS = 60_000;
const idempotencyCache = new Map<string, { result: string; expiresAt: number }>();
const idempotencyInflight = new Map<string, Promise<string>>();

function canonicalize(value: any): any {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const out: any = {};
    for (const k of Object.keys(value).sort()) {
      const v = canonicalize(value[k]);
      if (v !== undefined && v !== null && !(typeof v === "string" && v === "")) out[k] = v;
    }
    return out;
  }
  return value;
}

export function idempotencyKey(userId: number, toolName: string, args: any, explicit?: string): string {
  if (explicit && typeof explicit === "string" && explicit.length > 0 && explicit.length <= 200) {
    return crypto.createHash("sha256").update(`${userId}:${toolName}:explicit:${explicit}`).digest("hex");
  }
  const json = JSON.stringify(canonicalize(args ?? {}));
  return crypto.createHash("sha256").update(`${userId}:${toolName}:${json}`).digest("hex");
}

function gcIdempotency() {
  const now = Date.now();
  for (const [k, v] of idempotencyCache) if (v.expiresAt <= now) idempotencyCache.delete(k);
}

/**
 * Returns an existing cached result if a prior identical create succeeded
 * within the TTL, OR an in-flight promise if a concurrent identical request
 * is currently executing. Returns `{ ok: true }` if the caller should proceed.
 */
export async function claimIdempotency(
  key: string,
): Promise<{ ok: true } | { ok: false; cached: string }> {
  gcIdempotency();
  const cached = idempotencyCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { ok: false, cached: cached.result };
  }
  const inflight = idempotencyInflight.get(key);
  if (inflight) {
    const result = await inflight;
    return { ok: false, cached: result };
  }
  return { ok: true };
}

export function reserveInflight(key: string, p: Promise<string>): void {
  idempotencyInflight.set(key, p);
  p.finally(() => idempotencyInflight.delete(key));
}

export function recordIdempotency(key: string, result: string): void {
  idempotencyCache.set(key, { result, expiresAt: Date.now() + IDEMPOTENCY_TTL_MS });
}

// Test helper — exposed for the smoke harness only.
export function _resetIdempotencyForTest(): void {
  idempotencyCache.clear();
  idempotencyInflight.clear();
}

// ────────────────────────────────────────────────────────────────────────────
// 4. Rate limiting (sliding window, in-process)
// ────────────────────────────────────────────────────────────────────────────

// Per-tool: 10 successful claims per 60s.
// Per-user global across all create_* tools: 30 per 60s.
const PER_TOOL_LIMIT = 10;
const GLOBAL_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

const rateBuckets = new Map<string, number[]>(); // key → list of timestamps within the window

function pruneBucket(key: string, now: number): number[] {
  const arr = (rateBuckets.get(key) || []).filter((t) => t > now - RATE_WINDOW_MS);
  rateBuckets.set(key, arr);
  return arr;
}

export function checkAndConsumeRateLimit(
  userId: number,
  toolName: string,
): { ok: true } | { ok: false; reason: string } {
  const now = Date.now();
  const toolKey = `tool:${userId}:${toolName}`;
  const globalKey = `global:${userId}`;

  const toolHits = pruneBucket(toolKey, now);
  if (toolHits.length >= PER_TOOL_LIMIT) {
    const wait = Math.ceil((RATE_WINDOW_MS - (now - toolHits[0])) / 1000);
    return { ok: false, reason: `Rate limit hit for ${toolName} (max ${PER_TOOL_LIMIT}/min). Try again in ${wait}s.` };
  }
  const globalHits = pruneBucket(globalKey, now);
  if (globalHits.length >= GLOBAL_LIMIT) {
    const wait = Math.ceil((RATE_WINDOW_MS - (now - globalHits[0])) / 1000);
    return { ok: false, reason: `Rate limit hit for create actions (max ${GLOBAL_LIMIT}/min). Try again in ${wait}s.` };
  }

  toolHits.push(now);
  globalHits.push(now);
  rateBuckets.set(toolKey, toolHits);
  rateBuckets.set(globalKey, globalHits);
  return { ok: true };
}

export function _resetRateLimitsForTest(): void {
  rateBuckets.clear();
}

// ────────────────────────────────────────────────────────────────────────────
// 5. Safe audit write (DB insert + file fallback on failure)
// ────────────────────────────────────────────────────────────────────────────

const AUDIT_FALLBACK_DIR = path.join(process.cwd(), "logs");
const AUDIT_FALLBACK_FILE = path.join(AUDIT_FALLBACK_DIR, "assistant-audit-fallback.log");
let auditFallbackCount = 0;

export function getAuditFallbackCount(): number {
  return auditFallbackCount;
}

export async function safeAuditWrite(opts: {
  source: string;
  userId: number;
  userName: string;
  toolName: string;
  objectType: string;
  objectId: number;
  summary: string;
  payload: Record<string, any>;
  transcriptSnippet?: string;
}): Promise<{ ok: boolean; via: "db" | "file" | "lost" }> {
  // BigInt-safe JSON replacer so a stray BigInt in payload can't crash the
  // audit path (DB or file).
  const safeReplacer = (_k: string, v: any) => (typeof v === "bigint" ? v.toString() : v);
  const summaryLine =
    `[${opts.source}] ${opts.userName} (#${opts.userId}) ${opts.summary}.` +
    (opts.transcriptSnippet ? ` Prompt: "${opts.transcriptSnippet.slice(0, 200)}${opts.transcriptSnippet.length > 200 ? "…" : ""}"` : "");
  try {
    await storage.createActivity({
      linkedObjectType: opts.objectType,
      linkedObjectId: opts.objectId,
      type: `assistant_${opts.toolName}`,
      subject: `Assistant ${opts.toolName}`,
      summary: summaryLine,
      outcome: "success",
      rawContent: JSON.stringify({ payload: opts.payload, source: opts.source }, safeReplacer),
      createdBy: opts.userId,
    } as any);
    return { ok: true, via: "db" };
  } catch (dbErr) {
    auditFallbackCount += 1;
    console.error("[create-guards] DB audit failed, falling back to file:", dbErr);
    try {
      if (!fs.existsSync(AUDIT_FALLBACK_DIR)) fs.mkdirSync(AUDIT_FALLBACK_DIR, { recursive: true });
      fs.appendFileSync(
        AUDIT_FALLBACK_FILE,
        JSON.stringify({
          ts: new Date().toISOString(),
          source: opts.source,
          userId: opts.userId, userName: opts.userName,
          toolName: opts.toolName,
          objectType: opts.objectType, objectId: opts.objectId,
          summary: summaryLine,
          payload: opts.payload,
          dbError: String((dbErr as any)?.message || dbErr),
        }, safeReplacer) + "\n",
        "utf8",
      );
      return { ok: true, via: "file" };
    } catch (fileErr) {
      console.error("[create-guards] FILE audit fallback ALSO failed — audit lost:", fileErr);
      return { ok: false, via: "lost" };
    }
  }
}
