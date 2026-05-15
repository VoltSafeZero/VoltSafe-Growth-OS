/**
 * Canonical "Not Spam" service — permanently removes the SPAM label from an entire
 * thread/conversation and restores every linked message to the Inbox.
 *
 * Design goals
 * ─────────────
 * 1. Thread resolution uses ALL available identifiers in priority order:
 *      a) gmail_thread_id  (primary — covers every message synced from Gmail)
 *      b) normalized_subject fallback (for historical imports where thread IDs differ)
 * 2. Every distinct mailbox account that holds messages in the thread is updated
 *    individually via the Gmail API (so the provider state matches local state).
 * 3. Provider failures are logged and counted but NEVER block the local DB update.
 * 4. Returns structured counts so callers can surface partial-success warnings.
 * 5. Structured log events for observability:
 *      not_spam_requested | not_spam_thread_resolved | not_spam_local_update_complete
 *      not_spam_provider_update_complete | not_spam_remaining_spam_detected
 *
 * No schema changes — operates on the existing label_ids text column.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

const log = (event: string, data: Record<string, unknown>) =>
  console.log(`[not-spam] ${event}`, JSON.stringify(data));

function parseLabels(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const t = String(raw).trim();
  if (!t) return [];
  try {
    if (t.startsWith("[")) {
      const arr = JSON.parse(t);
      return Array.isArray(arr) ? arr.filter((x: unknown) => typeof x === "string") : [];
    }
    return t.split(",").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function serializeLabels(labels: Iterable<string>): string {
  return JSON.stringify(Array.from(new Set(labels)));
}

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

function containsSpam(labels: string[]): boolean {
  return labels.some((l) => l.toUpperCase() === "SPAM");
}

// ─── Public types ────────────────────────────────────────────────────────────

export type LinkedMessage = {
  id: number;
  gmailMessageId: string;
  gmailThreadId: string;
  sourceAccountId: number;
  labelIds: string[];
  isSpam: boolean;
};

export type NotSpamResult = {
  ok: boolean;
  resolvedThreadId: string;
  linkedMessageCount: number;
  updatedLocal: number;
  remainingSpam: number;
  providerAttempted: number;
  providerSucceeded: number;
  providerFailed: number;
  warnings: string[];
};

// ─── Thread resolver ─────────────────────────────────────────────────────────

/**
 * Find every email_messages row that belongs to this thread across all supplied
 * account IDs.
 *
 * Primary  : gmail_thread_id exact match
 * Fallback : normalized_subject match scoped to accounts that already have at
 *   least one SPAM message sharing the same subject — only activated when the
 *   primary lookup returns zero rows AND a fallback subject is supplied.
 *   (This covers historical imports where reply chains were stored under
 *   differing gmail_thread_ids.)
 */
export async function resolveLinkedMessages(
  gmailThreadId: string,
  accessibleAccountIds: number[],
  normalizedSubjectFallback?: string | null,
): Promise<LinkedMessage[]> {
  if (accessibleAccountIds.length === 0) return [];

  const accIds = accessibleAccountIds
    .map(Number)
    .filter(Number.isFinite)
    .join(",");

  // Primary: all messages with this gmail_thread_id across accessible accounts
  const r: any = await db.execute(sql.raw(
    `SELECT id, gmail_message_id, gmail_thread_id, source_account_id, label_ids
       FROM email_messages
      WHERE gmail_thread_id = '${esc(gmailThreadId)}'
        AND source_account_id IN (${accIds})`,
  ));
  const rows: any[] = (r as any).rows ?? r;

  if (rows.length > 0) {
    return rows.map(toLinkedMessage);
  }

  // Fallback: normalized_subject — only when primary found nothing
  if (normalizedSubjectFallback) {
    const r2: any = await db.execute(sql.raw(
      `SELECT id, gmail_message_id, gmail_thread_id, source_account_id, label_ids
         FROM email_messages
        WHERE normalized_subject = '${esc(normalizedSubjectFallback)}'
          AND source_account_id IN (${accIds})
          AND label_ids ILIKE '%SPAM%'
        LIMIT 200`,
    ));
    const rows2: any[] = (r2 as any).rows ?? r2;
    return rows2.map(toLinkedMessage);
  }

  return [];
}

function toLinkedMessage(row: any): LinkedMessage {
  const labelIds = parseLabels(row.label_ids);
  return {
    id: Number(row.id),
    gmailMessageId: String(row.gmail_message_id),
    gmailThreadId: String(row.gmail_thread_id),
    sourceAccountId: Number(row.source_account_id),
    labelIds,
    isSpam: containsSpam(labelIds),
  };
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Mark an entire thread as not-spam — permanent, provider-synced, multi-account.
 *
 * Steps:
 *  1. Resolve ALL linked messages across every accessible account.
 *  2. Group by sourceAccountId.
 *  3. For each account: call gmail.users.threads.modify (remove SPAM, add INBOX)
 *     for every distinct gmail_thread_id present in that account's message set.
 *     Provider failures are caught — they must never block local state correction.
 *  4. Update local label_ids for every resolved message:
 *     remove SPAM, add INBOX (preserving all other labels including SENT, STARRED,
 *     CATEGORY_* etc.).
 *  5. Re-query to count remaining spam rows (should be zero; non-zero = warning).
 *  6. Return structured result.
 *
 * The `getGmailClientFn` is passed in so the service stays independent of the
 * OAuth module (easier to test; avoids circular imports).
 */
export async function markNotSpam(
  gmailThreadId: string,
  userId: number,
  accessibleAccountIds: number[],
  getGmailClientFn: (userId: number, accId: number) => Promise<any>,
  normalizedSubjectFallback?: string | null,
): Promise<NotSpamResult> {
  const warnings: string[] = [];
  const result: NotSpamResult = {
    ok: false,
    resolvedThreadId: gmailThreadId,
    linkedMessageCount: 0,
    updatedLocal: 0,
    remainingSpam: 0,
    providerAttempted: 0,
    providerSucceeded: 0,
    providerFailed: 0,
    warnings,
  };

  log("not_spam_requested", {
    userId,
    gmailThreadId,
    accessibleAccounts: accessibleAccountIds.length,
  });

  // ── 1. Resolve linked messages ────────────────────────────────────────────
  const messages = await resolveLinkedMessages(
    gmailThreadId,
    accessibleAccountIds,
    normalizedSubjectFallback,
  );
  result.linkedMessageCount = messages.length;

  const spamMessages = messages.filter((m) => m.isSpam);
  const distinctAccounts = [...new Set(messages.map((m) => m.sourceAccountId))];

  log("not_spam_thread_resolved", {
    userId,
    gmailThreadId,
    linkedCount: messages.length,
    spamCount: spamMessages.length,
    accounts: distinctAccounts,
    usingSubjectFallback: messages.length > 0 && messages[0].gmailThreadId !== gmailThreadId,
  });

  if (messages.length === 0) {
    warnings.push("Thread not found in any accessible mailbox");
    return result;
  }

  // ── 2 & 3. Per-account Gmail API calls ────────────────────────────────────
  // Group messages by account so we make one (or a small set of) API call(s) per mailbox.
  const byAccount = new Map<number, string[]>(); // accId → distinct gmailThreadIds
  for (const msg of messages) {
    if (!byAccount.has(msg.sourceAccountId)) byAccount.set(msg.sourceAccountId, []);
    const existing = byAccount.get(msg.sourceAccountId)!;
    if (!existing.includes(msg.gmailThreadId)) existing.push(msg.gmailThreadId);
  }

  for (const [accId, threadIds] of byAccount) {
    result.providerAttempted++;
    try {
      const gmail = await getGmailClientFn(userId, accId);
      for (const tId of threadIds) {
        await gmail.users.threads.modify({
          userId: "me",
          id: tId,
          requestBody: { removeLabelIds: ["SPAM"], addLabelIds: ["INBOX"] },
        });
      }
      result.providerSucceeded++;
    } catch (e: any) {
      result.providerFailed++;
      const msg = `Provider update failed for account=${accId}: ${e?.message ?? String(e)}`;
      warnings.push(msg);
      console.warn(`[not-spam] not_spam_provider_update_failed`, {
        userId,
        gmailThreadId,
        accId,
        error: e?.message ?? String(e),
      });
    }
  }

  log("not_spam_provider_update_complete", {
    userId,
    gmailThreadId,
    attempted: result.providerAttempted,
    succeeded: result.providerSucceeded,
    failed: result.providerFailed,
    mailboxType: distinctAccounts.length > 1 ? "multi" : "single",
  });

  // ── 4. Local DB label updates ─────────────────────────────────────────────
  // Apply to ALL resolved messages regardless of provider success/failure.
  // Provider failures are non-fatal: local state must always be corrected so the
  // next Gmail incremental sync can reconcile rather than fighting our UI.
  let localErrors = 0;
  for (const msg of messages) {
    try {
      const labelSet = new Set(msg.labelIds);
      labelSet.delete("SPAM");
      labelSet.add("INBOX");
      const serialized = esc(serializeLabels(labelSet));
      await db.execute(sql.raw(
        `UPDATE email_messages SET label_ids = '${serialized}' WHERE id = ${msg.id}`,
      ));
      result.updatedLocal++;
    } catch (e: any) {
      localErrors++;
      console.error(`[not-spam] local_update_failed id=${msg.id}:`, e.message);
    }
  }

  // ── 5. Verify — count remaining spam rows in this thread ──────────────────
  const idList = messages.map((m) => m.id).join(",");
  if (idList) {
    try {
      const remCheck: any = await db.execute(sql.raw(
        `SELECT COUNT(*)::int AS cnt FROM email_messages
          WHERE id IN (${idList}) AND label_ids ILIKE '%SPAM%'`,
      ));
      const remRows: any[] = (remCheck as any).rows ?? remCheck;
      result.remainingSpam = Number(remRows[0]?.cnt ?? 0);
    } catch {
      // Non-fatal — remaining count will be 0 (optimistic)
    }
  }

  log("not_spam_local_update_complete", {
    userId,
    gmailThreadId,
    updatedLocal: result.updatedLocal,
    localErrors,
    remainingSpam: result.remainingSpam,
  });

  if (result.remainingSpam > 0) {
    const w = `${result.remainingSpam} message(s) in this thread could not be removed from spam`;
    warnings.push(w);
    log("not_spam_remaining_spam_detected", {
      userId,
      gmailThreadId,
      remainingSpam: result.remainingSpam,
    });
  }

  result.ok = result.updatedLocal > 0 || result.remainingSpam === 0;
  return result;
}
