/**
 * security-audit.ts
 *
 * Lightweight security audit event service.
 * Records high-risk and critical actions to the security_audit_events table.
 *
 * Rules:
 * - NEVER store sensitive payloads (email bodies, tokens, passwords, Capital memo text)
 * - Store IDs, counts, route, action type, and safe labels only
 * - safeAuditMetadata() is the mandatory strip function for all metadata
 * - Table is bootstrapped via ensureAuditTable() on first import
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

// ── Sensitive key blocklist ────────────────────────────────────────────────────
// Any metadata key matching these (case-insensitive) is stripped before insert.
const BLOCKED_METADATA_KEYS = new Set([
  "email_body",
  "body",
  "html",
  "text",
  "content",
  "raw_content",
  "plain_text",
  "html_body",
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "webhook_token",
  "password",
  "secret",
  "credential",
  "credentials",
  "private_key",
  "api_key",
  "memo_text",
  "memo",
  "board_pack_content",
  "investor_memo",
  "investor_update_body",
  "draft_body",
  "message_body",
  "subject_line",
]);

export type AuditSeverity = "low" | "medium" | "high" | "critical";
export type AuditResult = "attempted" | "succeeded" | "failed" | "denied";
export type AuditCategory =
  | "auth"
  | "user_management"
  | "permission_change"
  | "data_delete"
  | "data_export"
  | "email_send"
  | "email_bulk"
  | "integration_change"
  | "capital_action"
  | "board_pack_action"
  | "currents_membership"
  | "campaign_send"
  | "bulk_action"
  | "token_action";

export interface AuditEventInput {
  actor_user_id: number | null;
  action: string;
  category: AuditCategory;
  target_type?: string;
  target_id?: string | number | null;
  route?: string;
  severity: AuditSeverity;
  result: AuditResult;
  metadata?: Record<string, unknown>;
}

// ── Table bootstrap ────────────────────────────────────────────────────────────

let tableReady = false;
let tableBootstrapPromise: Promise<void> | null = null;

export async function ensureAuditTable(): Promise<void> {
  if (tableReady) return;
  if (tableBootstrapPromise) return tableBootstrapPromise;
  tableBootstrapPromise = (async () => {
    try {
      await db.execute(sql.raw(`
        CREATE TABLE IF NOT EXISTS security_audit_events (
          id            SERIAL PRIMARY KEY,
          actor_user_id INTEGER,
          action        TEXT NOT NULL,
          category      TEXT NOT NULL,
          target_type   TEXT,
          target_id     TEXT,
          route         TEXT,
          severity      TEXT NOT NULL DEFAULT 'medium',
          result        TEXT NOT NULL DEFAULT 'succeeded',
          metadata      JSONB,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `));
      await db.execute(sql.raw(`
        CREATE INDEX IF NOT EXISTS idx_sae_actor ON security_audit_events (actor_user_id)
      `));
      await db.execute(sql.raw(`
        CREATE INDEX IF NOT EXISTS idx_sae_category ON security_audit_events (category)
      `));
      await db.execute(sql.raw(`
        CREATE INDEX IF NOT EXISTS idx_sae_created ON security_audit_events (created_at DESC)
      `));
      tableReady = true;
      console.log("[security-audit] Table ready");
    } catch (err) {
      console.error("[security-audit] Table bootstrap failed:", err);
    }
  })();
  return tableBootstrapPromise;
}

// ── Metadata sanitizer ────────────────────────────────────────────────────────

/**
 * Strips any metadata key that could contain sensitive payload.
 * Must be called on all metadata before storing.
 */
export function safeAuditMetadata(
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> | null {
  if (!metadata) return null;
  const safe: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(metadata)) {
    if (!BLOCKED_METADATA_KEYS.has(key.toLowerCase())) {
      if (typeof val === "object" && val !== null && !Array.isArray(val)) {
        safe[key] = safeAuditMetadata(val as Record<string, unknown>);
      } else {
        safe[key] = val;
      }
    }
  }
  return safe;
}

// ── Actor extractor ────────────────────────────────────────────────────────────

export function getAuditActor(req: any): number | null {
  return (req?.session?.userId as number) ?? null;
}

// ── Core recorder ────────────────────────────────────────────────────────────

/**
 * Records a security audit event.
 * Fire-and-forget safe — never throws to caller.
 */
export async function recordSecurityAuditEvent(
  input: AuditEventInput
): Promise<void> {
  try {
    await ensureAuditTable();
    const safeMeta = safeAuditMetadata(input.metadata ?? {});
    const targetId =
      input.target_id != null ? String(input.target_id) : null;
    await db.execute(sql.raw(`
      INSERT INTO security_audit_events
        (actor_user_id, action, category, target_type, target_id, route, severity, result, metadata)
      VALUES
        (
          ${input.actor_user_id ?? "NULL"},
          ${escapeLiteral(input.action)},
          ${escapeLiteral(input.category)},
          ${input.target_type ? escapeLiteral(input.target_type) : "NULL"},
          ${targetId ? escapeLiteral(targetId) : "NULL"},
          ${input.route ? escapeLiteral(input.route) : "NULL"},
          ${escapeLiteral(input.severity)},
          ${escapeLiteral(input.result)},
          ${safeMeta ? escapeLiteral(JSON.stringify(safeMeta)) + "::jsonb" : "NULL"}
        )
    `));
  } catch (err) {
    console.error("[security-audit] recordSecurityAuditEvent failed:", err);
  }
}

/**
 * Convenience wrapper for high-risk actions.
 * Defaults severity=high, result=succeeded.
 */
export async function recordHighRiskAction(
  input: Omit<AuditEventInput, "severity" | "result"> &
    Partial<Pick<AuditEventInput, "severity" | "result">>
): Promise<void> {
  return recordSecurityAuditEvent({
    severity: "high",
    result: "succeeded",
    ...input,
  });
}

// ── SQL literal escape (no user input ever reaches this path) ─────────────────
function escapeLiteral(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}
