/**
 * Bulk-action multi-account router (Commit 4 of 8 — unified inbox).
 *
 * The single-account bulk endpoints (/api/gmail/bulk-mark-read,
 * /api/gmail/bulk-archive) shipped in Commit 3 against a SINGLE Gmail
 * account: caller passes a numeric `asAccountId`, the route resolves to one
 * Gmail client, and one client.modify call per ID. This breaks for the
 * unified-inbox "All Inboxes" view where the user can multi-select rows
 * spanning 2+ accounts: a single Gmail client only knows its own account's
 * IDs, so 67% of operations would fail with "message not found" if you
 * naively send all IDs to one client.
 *
 * The unified-mode UI sends `asAccountId: "all"`. Pre-Commit-4 the route
 * coerced "all" through Number() → NaN, then resolveAccount silently fell
 * back to the user's personal account — every cross-account row failed
 * silently. The bare `} catch { failed++; }` (fixed in Commit 3) at least
 * counted them; Commit 4 actually routes them correctly.
 *
 * This module provides the routing layer:
 *   1. Look up which account each Gmail message/thread ID belongs to (we
 *      keep that mapping in `email_messages.source_account_id`, populated
 *      by the sync pipeline).
 *   2. Filter to the set of accounts the caller has been authorized for
 *      (caller passes the accessible-account-id list — same set used by
 *      the unified inbox listing).
 *   3. Group the IDs by account so the route can do one Gmail-client call
 *      per account, sequentially, with per-account error/permission
 *      handling and per-account local-mirror invocation.
 *
 * Pure functions (no side effects beyond a SELECT). Caller decides what to
 * do with the groups; this module just maps the shape.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

export type AccountGroup = {
  /** accountId → list of input IDs that resolved to that account */
  byAccount: Map<number, string[]>;
  /**
   * IDs we have NO local row for. Most likely Gmail-side IDs that were
   * deleted/expunged or never synced into our local store. The caller
   * should report these as "not found" rather than retrying on Gmail —
   * the unified-mode UI only sees IDs that came from a local listing,
   * so missing IDs here are a real anomaly worth logging.
   */
  unknownIds: string[];
  /**
   * IDs that DID have a local row but the row's source_account_id is
   * NOT in the caller's `accessibleAccountIds` set. The caller should
   * count these as a permission failure, NOT a Gmail-side failure.
   * Splitting this from `unknownIds` lets the response distinguish
   * "you don't have access" from "we can't find it".
   */
  forbiddenIds: string[];
};

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
}

function quoteList(ids: string[]): string {
  return ids.map(id => `'${escapeSqlString(String(id))}'`).join(",");
}

/**
 * Look up source_account_id for a batch of Gmail message IDs and group
 * them by account. IDs that have no local row land in `unknownIds`. IDs
 * whose account isn't in the caller's accessible set land in `forbiddenIds`.
 */
export async function groupMessageIdsByAccount(
  gmailMessageIds: string[],
  accessibleAccountIds: number[],
): Promise<AccountGroup> {
  const byAccount = new Map<number, string[]>();
  const unknownIds: string[] = [];
  const forbiddenIds: string[] = [];
  if (gmailMessageIds.length === 0) {
    return { byAccount, unknownIds, forbiddenIds };
  }

  const accessibleSet = new Set<number>(accessibleAccountIds.map(Number));
  const inputSet = new Set<string>(gmailMessageIds.map(String));

  const r: any = await db.execute(sql.raw(`
    SELECT gmail_message_id, source_account_id
    FROM email_messages
    WHERE gmail_message_id IN (${quoteList(gmailMessageIds)})
  `));
  const rows = ((r as any).rows ?? r) as Array<{
    gmail_message_id: string | null;
    source_account_id: number | string | null;
  }>;

  const seen = new Set<string>();
  for (const row of rows) {
    const gid = row.gmail_message_id != null ? String(row.gmail_message_id) : null;
    if (!gid || seen.has(gid)) continue;
    seen.add(gid);
    const acctId = row.source_account_id == null ? null : Number(row.source_account_id);
    if (acctId == null || !Number.isFinite(acctId)) {
      // Local row has no account — treat as forbidden (we can't route it).
      forbiddenIds.push(gid);
      continue;
    }
    if (!accessibleSet.has(acctId)) {
      forbiddenIds.push(gid);
      continue;
    }
    const bucket = byAccount.get(acctId);
    if (bucket) bucket.push(gid);
    else byAccount.set(acctId, [gid]);
  }

  // Anything in the input but not in `seen` had no local row at all.
  for (const id of inputSet) {
    if (!seen.has(id)) unknownIds.push(id);
  }

  return { byAccount, unknownIds, forbiddenIds };
}

/**
 * Same as groupMessageIdsByAccount but for thread IDs. Looks up the thread's
 * account by joining email_messages on gmail_thread_id (one thread is owned
 * by exactly one account because Gmail thread IDs are scoped per-mailbox).
 *
 * Returns the input THREAD ids in the buckets — NOT message ids — because
 * the bulk-archive endpoint operates on threads, not individual messages.
 */
export async function groupThreadIdsByAccount(
  gmailThreadIds: string[],
  accessibleAccountIds: number[],
): Promise<AccountGroup> {
  const byAccount = new Map<number, string[]>();
  const unknownIds: string[] = [];
  const forbiddenIds: string[] = [];
  if (gmailThreadIds.length === 0) {
    return { byAccount, unknownIds, forbiddenIds };
  }

  const accessibleSet = new Set<number>(accessibleAccountIds.map(Number));
  const inputSet = new Set<string>(gmailThreadIds.map(String));

  // Use DISTINCT because a thread typically has multiple email_messages rows
  // — we only need the (thread_id, account_id) tuple once.
  const r: any = await db.execute(sql.raw(`
    SELECT DISTINCT gmail_thread_id, source_account_id
    FROM email_messages
    WHERE gmail_thread_id IN (${quoteList(gmailThreadIds)})
  `));
  const rows = ((r as any).rows ?? r) as Array<{
    gmail_thread_id: string | null;
    source_account_id: number | string | null;
  }>;

  const seen = new Set<string>();
  for (const row of rows) {
    const tid = row.gmail_thread_id != null ? String(row.gmail_thread_id) : null;
    if (!tid) continue;
    // First (thread_id, account_id) we encounter wins. If the same thread
    // somehow has rows from two different accounts (shouldn't happen — Gmail
    // thread IDs are per-mailbox — but defensively), the first one we see is
    // authoritative for the routing.
    if (seen.has(tid)) continue;
    seen.add(tid);
    const acctId = row.source_account_id == null ? null : Number(row.source_account_id);
    if (acctId == null || !Number.isFinite(acctId)) {
      forbiddenIds.push(tid);
      continue;
    }
    if (!accessibleSet.has(acctId)) {
      forbiddenIds.push(tid);
      continue;
    }
    const bucket = byAccount.get(acctId);
    if (bucket) bucket.push(tid);
    else byAccount.set(acctId, [tid]);
  }

  for (const id of inputSet) {
    if (!seen.has(id)) unknownIds.push(id);
  }

  return { byAccount, unknownIds, forbiddenIds };
}
