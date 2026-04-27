/**
 * Local label mirror — keeps email_messages.label_ids in sync after
 * Gmail-side bulk mutations (bulk-mark-read, bulk-archive, etc).
 *
 * Why this exists: without it, the user clicks "archive 5", they vanish
 * optimistically in the UI, then briefly reappear when react-query refetches
 * before the next hourly poll / push event arrives. With Commit 1.1's local
 * default, that visual flash is much more obvious.
 *
 * Pattern matches the toggle-star inline-mirror added in Apr 2026 (see
 * server/routes.ts:9650-9677): SELECT current row, parse label_ids (CSV or
 * JSON), mutate the set, re-serialize as JSON, UPDATE by primary key.
 *
 * Conventions:
 *  • label_ids is `text` in the schema. Two formats coexist in production:
 *    JSON arrays from upsertMessageById (`["INBOX","UNREAD"]`) and legacy
 *    CSV from earlier sync paths (`INBOX,UNREAD`). parseLabels handles both;
 *    we always re-serialize as JSON to converge on one format over time.
 *  • All writes are scoped by source_account_id when provided so a bulk op
 *    on Account A can't accidentally touch a same-Gmail-message-id row that
 *    belongs to Account B (rare but possible with shared aliases).
 *  • Helpers return counts for caller logging — they don't throw on
 *    individual row failures (the caller already wraps the whole call in a
 *    try/catch and treats local-mirror as best-effort).
 *
 * Race notes: Pub/Sub push events that arrive concurrently with our UPDATE
 * write to the same row. Postgres row-level locking serializes the UPDATEs,
 * so no structural corruption is possible. Strictly though, this IS a
 * read-modify-write pattern WITHOUT `SELECT ... FOR UPDATE`: if a push
 * event lands between our SELECT (line ~95) and our UPDATE (line ~110), it
 * could be overwritten by our mirror's stale pre-image for non-target
 * labels (e.g. push added STARRED, mirror removes UNREAD with stale
 * pre-image that lacked STARRED → STARRED gets dropped). The window is
 * narrow (single-digit ms in practice) and self-healing — the next sync
 * reads canonical state from Gmail and re-applies. Acceptable for a
 * best-effort cosmetic mirror; if we ever need strict consistency, wrap
 * the SELECT/UPDATE in a transaction with `FOR UPDATE` row lock.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

export type LabelOp = { add?: string[]; remove?: string[] };

export type MirrorResult = {
  /** Number of email_messages rows we successfully UPDATE'd. */
  updated: number;
  /** Number of input IDs that didn't match any local row (caller can log). */
  missing: number;
  /** Number of rows where SELECT/UPDATE itself errored — not "label parse failed". */
  errors: number;
};

function parseLabels(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const t = String(raw).trim();
  if (!t) return [];
  try {
    if (t.startsWith("[")) {
      const arr = JSON.parse(t);
      return Array.isArray(arr) ? arr.filter(x => typeof x === "string") : [];
    }
    return t.split(",").map(s => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function serializeLabels(labels: Iterable<string>): string {
  return JSON.stringify(Array.from(new Set(labels)));
}

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
}

function applyOp(current: string[], op: LabelOp): string[] {
  const set = new Set(current);
  for (const l of op.remove || []) set.delete(l);
  for (const l of op.add || []) set.add(l);
  return [...set];
}

/**
 * Apply `op` to label_ids on every email_messages row whose
 * gmail_message_id is in `gmailMessageIds`. Used by bulk-mark-read.
 *
 * Caller is expected to have ALREADY done the Gmail-side modify and to be
 * passing only the IDs that Gmail confirmed succeeded.
 */
export async function mirrorLabelChangeForMessages(
  gmailMessageIds: string[],
  accountId: number | null | undefined,
  op: LabelOp,
): Promise<MirrorResult> {
  if (gmailMessageIds.length === 0) return { updated: 0, missing: 0, errors: 0 };

  const idList = gmailMessageIds.map(id => `'${escapeSqlString(String(id))}'`).join(",");
  const accClause = accountId ? ` AND source_account_id = ${Number(accountId)}` : "";

  let rows: any[] = [];
  try {
    const r: any = await db.execute(sql.raw(
      `SELECT id, gmail_message_id, label_ids FROM email_messages
        WHERE gmail_message_id IN (${idList})${accClause}`
    ));
    rows = ((r as any).rows ?? r) as any[];
  } catch (e: any) {
    // The SELECT itself failed — treat the whole batch as errored, surface
    // to caller (which logs with full context).
    throw new Error(`SELECT failed: ${e.message}`);
  }

  const found = new Set<string>(rows.map(r => String(r.gmail_message_id)));
  const missing = gmailMessageIds.filter(id => !found.has(String(id))).length;

  let updated = 0;
  let errors = 0;
  for (const row of rows) {
    try {
      const next = applyOp(parseLabels(row.label_ids), op);
      const escaped = escapeSqlString(serializeLabels(next));
      await db.execute(sql.raw(
        `UPDATE email_messages SET label_ids = '${escaped}' WHERE id = ${Number(row.id)}`
      ));
      updated++;
    } catch (e: any) {
      errors++;
      console.error(
        `[local-label-mirror] UPDATE failed for id=${row.id} gmail_id=${row.gmail_message_id}:`,
        e.message,
      );
    }
  }

  return { updated, missing, errors };
}

/**
 * Apply `op` to label_ids on every email_messages row in the listed threads.
 * Used by bulk-archive, which mutates Gmail at thread granularity:
 * `gmail.users.threads.modify` removes INBOX from ALL messages in each
 * thread, so the local mirror must do the same — not just the message IDs
 * the user clicked.
 */
export async function mirrorLabelChangeForThreads(
  gmailThreadIds: string[],
  accountId: number | null | undefined,
  op: LabelOp,
): Promise<MirrorResult & { threads: number }> {
  if (gmailThreadIds.length === 0) return { updated: 0, missing: 0, errors: 0, threads: 0 };

  const tidList = gmailThreadIds.map(id => `'${escapeSqlString(String(id))}'`).join(",");
  const accClause = accountId ? ` AND source_account_id = ${Number(accountId)}` : "";

  let rows: any[] = [];
  try {
    const r: any = await db.execute(sql.raw(
      `SELECT id, gmail_thread_id, label_ids FROM email_messages
        WHERE gmail_thread_id IN (${tidList})${accClause}`
    ));
    rows = ((r as any).rows ?? r) as any[];
  } catch (e: any) {
    throw new Error(`SELECT failed: ${e.message}`);
  }

  // "missing" = threads with zero local message rows. A thread we don't have
  // any cached messages for is fine (the next sync will catch up); we report
  // it for log visibility but it isn't an error.
  const foundThreads = new Set<string>(rows.map(r => String(r.gmail_thread_id)));
  const missing = gmailThreadIds.filter(t => !foundThreads.has(String(t))).length;

  let updated = 0;
  let errors = 0;
  for (const row of rows) {
    try {
      const next = applyOp(parseLabels(row.label_ids), op);
      const escaped = escapeSqlString(serializeLabels(next));
      await db.execute(sql.raw(
        `UPDATE email_messages SET label_ids = '${escaped}' WHERE id = ${Number(row.id)}`
      ));
      updated++;
    } catch (e: any) {
      errors++;
      console.error(
        `[local-label-mirror] UPDATE failed for id=${row.id} thread=${row.gmail_thread_id}:`,
        e.message,
      );
    }
  }

  return { updated, missing, errors, threads: gmailThreadIds.length };
}

// Test-only exports for unit testing the parser/serializer round-trip.
export const __testOnly = { parseLabels, serializeLabels, applyOp };
