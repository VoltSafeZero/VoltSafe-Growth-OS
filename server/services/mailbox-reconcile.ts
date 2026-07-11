/**
 * Full-mailbox reconciliation service.
 *
 * Unlike the scroll backfill (fetchOlderFromGmail in gmail-history-backfill.ts),
 * which uses "in:inbox OR in:sent" to mirror inbox scroll semantics, this service
 * fetches the COMPLETE mailbox using "in:anywhere -in:spam -in:trash" so that
 * archived mail that was never in inbox or sent is included.
 *
 * Design:
 *   • Admin-only endpoint triggers this. Never runs automatically at startup.
 *   • Uses upsertMessageById() — same pipeline as all other sync paths. No
 *     duplicate parsing logic; process is fully idempotent (upsert on gmail_message_id).
 *   • Paginated: follows nextPageToken from users.messages.list.
 *   • Rate-limited: same CONCURRENCY=5 as scroll backfill.
 *   • Progress: logs every BATCH_LOG_INTERVAL messages.
 *   • Hard guard: refuses to run if auth_status ≠ active.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { upsertMessageById } from "./gmail-incremental";
import { getGmailClient } from "../gmail-oauth";
import pLimit from "p-limit";

const CONCURRENCY = 5;
const BATCH_LOG_INTERVAL = 100;

// ── In-memory progress tracker ────────────────────────────────────────────────
// Keyed by accountId. Cleared when the job finishes (success or failure).
export interface ReconcileProgress {
  accountId: number;
  emailAddress: string;
  startedAt: string;
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  providerTotal: number;
  phase: "running" | "done" | "failed";
  durationMs?: number;
  stopReason?: string;
}

const _active = new Map<number, ReconcileProgress>();

export function getReconcileStatus(accountId: number): ReconcileProgress | null {
  return _active.get(accountId) ?? null;
}

export function getAllReconcileStatuses(): ReconcileProgress[] {
  return Array.from(_active.values());
}

export interface ReconcileOptions {
  accountId: number;
  includeSpam?: boolean;
  includeTrash?: boolean;
  maxMessages?: number;
}

export interface ReconcileResult {
  accountId: number;
  emailAddress: string;
  providerTotal: number;
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  durationMs: number;
  stopped: boolean;
  stopReason?: string;
}

const log = (...a: any[]) => console.log("[mailbox-reconcile]", ...a);

export async function reconcileFullMailbox(opts: ReconcileOptions): Promise<ReconcileResult> {
  const { accountId, includeSpam = false, includeTrash = false, maxMessages = 50_000 } = opts;
  const start = Date.now();

  const acctRows = await db.execute(sql.raw(
    `SELECT id, email_address, auth_status, user_id FROM email_accounts WHERE id = ${Number(accountId)} LIMIT 1`
  ));
  const acctList = ((acctRows as any).rows ?? acctRows) as any[];
  if (!acctList.length) throw new Error(`No email_accounts row with id=${accountId}`);
  const acct = acctList[0];

  if (acct.auth_status !== "active") {
    throw new Error(
      `Cannot reconcile account ${acct.email_address} — auth_status is '${acct.auth_status}'. OAuth reconnect required.`
    );
  }

  const gmail = await getGmailClient(Number(acct.user_id), Number(acct.id));

  const spamPart  = includeSpam  ? "" : " -in:spam";
  const trashPart = includeTrash ? "" : " -in:trash";
  const q = `in:anywhere${spamPart}${trashPart}`;

  let pageToken: string | undefined;
  let fetched = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  let providerTotal = 0;
  let stopped = false;
  let stopReason: string | undefined;

  const limit = pLimit(CONCURRENCY);
  const emailAddress: string = acct.email_address;
  const ownerUserId = Number(acct.user_id);

  log(`start account=${accountId} email=${emailAddress} q="${q}" maxMessages=${maxMessages}`);

  const progress: ReconcileProgress = {
    accountId, emailAddress, startedAt: new Date().toISOString(),
    fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0, providerTotal: 0, phase: "running",
  };
  _active.set(accountId, progress);

  while (true) {
    if (fetched >= maxMessages) {
      stopped = true;
      stopReason = `maxMessages limit (${maxMessages}) reached`;
      break;
    }

    const listParams: Record<string, any> = { userId: "me", q, maxResults: 500 };
    if (pageToken) listParams.pageToken = pageToken;

    let listRes: any;
    try {
      listRes = await gmail.users.messages.list(listParams);
    } catch (e: any) {
      stopped = true;
      stopReason = `Gmail list failed: ${e.message}`;
      log(`list error account=${accountId}: ${e.message}`);
      break;
    }

    const messages: any[] = listRes.data.messages ?? [];
    pageToken = listRes.data.nextPageToken;
    if (!providerTotal && listRes.data.resultSizeEstimate) {
      providerTotal = listRes.data.resultSizeEstimate;
      progress.providerTotal = providerTotal;
    }

    if (messages.length === 0) break;

    const tasks = messages.map((m) =>
      limit(async () => {
        try {
          const result = await upsertMessageById(gmail, m.id, ownerUserId, accountId, emailAddress);
          if (result.inserted) inserted++;
          else if (result.updatedLabels) updated++;
          else skipped++;
        } catch (e: any) {
          errors++;
          log(`msg error account=${accountId} msgId=${m.id}: ${e.message}`);
        }
        fetched++;
        progress.fetched   = fetched;
        progress.inserted  = inserted;
        progress.updated   = updated;
        progress.skipped   = skipped;
        progress.errors    = errors;
        if (fetched % BATCH_LOG_INTERVAL === 0) {
          log(`progress account=${accountId} fetched=${fetched} inserted=${inserted} skipped=${skipped} errors=${errors}`);
        }
      })
    );

    await Promise.all(tasks);
    if (!pageToken) break;
  }

  const durationMs = Date.now() - start;
  log(`done account=${accountId} fetched=${fetched} inserted=${inserted} updated=${updated} skipped=${skipped} errors=${errors} durationMs=${durationMs}${stopped ? ` STOPPED: ${stopReason}` : ""}`);

  progress.phase      = errors > 0 && fetched === 0 ? "failed" : "done";
  progress.durationMs = durationMs;
  progress.stopReason = stopReason;
  // Keep the final status in the map for 30 minutes so the audit endpoint can read it.
  setTimeout(() => _active.delete(accountId), 30 * 60 * 1000);

  return { accountId, emailAddress, providerTotal, fetched, inserted, updated, skipped, errors, durationMs, stopped, stopReason };
}

/**
 * Returns the provider message count estimate for a given query.
 * Used by the audit to surface provider vs. local count gaps without
 * downloading any message bodies.
 */
export async function getGmailMessageCount(
  acct: { id: number; userId: number; emailAddress: string },
  q: string
): Promise<number> {
  try {
    const gmail = await getGmailClient(acct.userId, acct.id);
    const res = await gmail.users.messages.list({ userId: "me", q, maxResults: 1 });
    return (res as any).data?.resultSizeEstimate ?? 0;
  } catch {
    return -1;
  }
}
