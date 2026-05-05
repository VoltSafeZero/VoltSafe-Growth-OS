// Phase 5 Commit 2 — auto-overflow backfill from Gmail.
//
// When the unified inbox scrolls past the bottom of the local archive, this
// helper pulls the next slice of older messages from Gmail and persists them
// via the same parsing/insertion pipeline that gmail-sync and gmail-incremental
// use (no logic duplication — see upsertMessageById in gmail-incremental.ts).
//
// Design notes:
//
// 1. Concurrency. Gmail's per-user quota is 250 quota-units/sec; users.messages.get
//    is 5 units. A concurrency cap of 5 in-flight gives ~25 units/sec — well
//    inside the budget even when other syncs are running. Higher concurrency
//    would stack rate-limit risk for a marginal speed-up.
//
// 2. Rate-limit handling. 429 responses honor the server's Retry-After header
//    (seconds), falling back to exponential backoff (2s, 4s, 8s) up to
//    MAX_RETRIES attempts. After that, the call surfaces the error so the
//    caller can mark historyLoadFailed=true and degrade gracefully.
//
// 3. Per-account in-flight de-dupe. Two concurrent /api/gmail/messages
//    requests for the SAME account would otherwise issue two parallel Gmail
//    list calls and two waves of upserts. We keep one Promise per accountId
//    in `inFlight`; the second caller awaits the first's result. The second
//    caller gets `rows: []` so the user doesn't see duplicate rows in their
//    response — they'll pick up the just-persisted rows on their next page
//    request via standard local pagination.
//
// 4. Query semantics. We use `in:inbox OR in:sent` (not just `in:inbox`) to
//    match the unified-inbox semantics in the rest of the system: the local
//    archive contains both directions, the live Gmail sync writes both, and
//    listLocalMessages doesn't filter by direction. Using `in:inbox` alone
//    would mean the user's back-scroll silently skipped all sent items.
//
// 5. `before:<unix-seconds>` boundary. Gmail accepts a Unix timestamp for
//    second-level precision (vs the YYYY/MM/DD form which is day-resolution
//    only). Using seconds means we never fetch a row we already have — the
//    keyset cursor is exact.

import { db } from "../db";
import { sql } from "drizzle-orm";
import { upsertMessageById } from "./gmail-incremental";
import { log } from "../index";
import type { LocalMessageSummary } from "./local-mailbox";

const CONCURRENCY = 5;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = [2000, 4000, 8000];

const Q_BASE = "in:inbox OR in:sent";

export type BackfillResult = {
  rows: LocalMessageSummary[];
  fetched: number;        // # of message IDs Gmail returned
  inserted: number;       // # of NEW rows persisted
  skipped: number;        // # already present (existing rows pre-inserted by another sync path)
  errors: number;         // # of per-message fetch errors (non-fatal)
  noMoreHistory: boolean; // Gmail returned 0 IDs → end of mailbox
  failed: boolean;        // hard error (auth/quota exhausted/network) — partial rows still returned
  failureReason?: string;
  // For cursor stitching by the caller (oldest = furthest back in time).
  oldest: { sentAtIso: string | null; pk: number } | null;
  tookMs: number;
};

const inFlight = new Map<string, Promise<BackfillResult>>();

export async function fetchOlderFromGmail(
  account: { id: number; userId: number; emailAddress: string },
  before: Date | null,
  limit: number,
  labelFilter?: string,
): Promise<BackfillResult> {
  // Key on (accountId + query) so concurrent searches with different
  // query strings don't share the same in-flight lock and cancel each other.
  const key = `${account.id}:${labelFilter ?? ""}`;
  const existing = inFlight.get(key);
  if (existing) {
    // Another caller is already backfilling this account. Wait for them, but
    // return rows: [] so the user response doesn't accidentally render rows
    // a sibling response is also rendering. The next page request will pick
    // up the persisted rows via normal local pagination.
    //
    // We also zero out inserted/skipped/errors here: the leader request's
    // route handler is the one that attributes the work to the per-session
    // soft cap (gmailBackfillCount). If the follower also incremented its
    // session counter we'd double-count the same DB inserts and burn through
    // the cap at 2× the real rate. inFlight de-dupe is safe ONLY because of
    // this zero-out — see architect review of Commit 2.
    const r = await existing;
    return {
      ...r,
      rows: [],
      oldest: null,
      inserted: 0,
      skipped: 0,
      errors: 0,
      fetched: 0,
      noMoreHistory: false,
    };
  }
  const p = doFetch(account, before, limit, labelFilter).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

async function doFetch(
  account: { id: number; userId: number; emailAddress: string },
  before: Date | null,
  limit: number,
  labelFilter?: string,
): Promise<BackfillResult> {
  const t0 = Date.now();
  const result: BackfillResult = {
    rows: [], fetched: 0, inserted: 0, skipped: 0, errors: 0,
    noMoreHistory: false, failed: false, oldest: null, tookMs: 0,
  };
  const cap = Math.max(1, Math.min(100, limit));

  let gmailClient: any;
  try {
    const { getGmailClient } = await import("../gmail-oauth");
    gmailClient = await getGmailClient(account.userId, account.id);
  } catch (e: any) {
    result.failed = true;
    result.failureReason = `auth: ${e.message}`;
    result.tookMs = Date.now() - t0;
    log(`[gmail-backfill] account=${account.id} auth failed: ${e.message}`);
    return result;
  }

  let q = labelFilter ?? Q_BASE;
  if (before) {
    const unix = Math.floor(before.getTime() / 1000);
    q = `${q} before:${unix}`;
  }

  let listRes: any;
  try {
    listRes = await callWithRetry(() =>
      gmailClient.users.messages.list({ userId: "me", q, maxResults: cap })
    );
  } catch (e: any) {
    result.failed = true;
    result.failureReason = `list: ${e.message}`;
    result.tookMs = Date.now() - t0;
    log(`[gmail-backfill] account=${account.id} list failed: ${e.message}`);
    return result;
  }

  const ids: string[] = (listRes.data.messages || [])
    .map((m: any) => m?.id)
    .filter((x: any): x is string => typeof x === "string" && x.length > 0);
  result.fetched = ids.length;

  if (ids.length === 0) {
    result.noMoreHistory = true;
    result.tookMs = Date.now() - t0;
    log(`[gmail-backfill] account=${account.id} no more history before=${before?.toISOString() ?? "now"}`);
    return result;
  }

  const myDomain = account.emailAddress.split("@")[1] || "voltsafe.com";

  // Bounded-concurrency fan-out. Each worker pulls IDs off the shared queue
  // until it's empty; keeps exactly CONCURRENCY workers in flight at all times
  // (simpler than a semaphore, no allocations per task).
  const queue = [...ids];
  const workers: Promise<void>[] = [];
  let hardFailure: any = null;

  for (let w = 0; w < Math.min(CONCURRENCY, queue.length); w++) {
    workers.push((async () => {
      while (queue.length > 0) {
        if (hardFailure) return;
        const id = queue.shift();
        if (!id) return;
        try {
          const r = await callWithRetry(() =>
            upsertMessageById(gmailClient, id, account.userId, account.id, myDomain)
          );
          if (r.inserted) result.inserted++;
          else result.skipped++;
        } catch (e: any) {
          // 429-after-retries / 5xx-after-retries: treat as a hard failure for
          // this run so we don't burn through the rest of the queue against
          // an unhealthy backend. Already-persisted rows are still returned.
          const code = e?.code || e?.response?.status;
          if (code === 429 || (code >= 500 && code < 600)) {
            hardFailure = e;
            return;
          }
          result.errors++;
          log(`[gmail-backfill] account=${account.id} msg=${id} err: ${e.message}`);
        }
      }
    })());
  }
  await Promise.all(workers);

  if (hardFailure) {
    result.failed = true;
    result.failureReason = `fetch: ${hardFailure.message ?? String(hardFailure)}`;
  }

  // Read back the rows we just touched so the caller can return them as part
  // of the same HTTP response. We re-query (vs collecting from upsertMessageById)
  // because the parser may have applied label-routing / domain-stripping that
  // changes the persisted shape, and we want the response to match exactly
  // what a subsequent local query would return.
  const persistedIds = ids.filter((_, i) => i < (result.inserted + result.skipped + result.errors));
  // ^ NOTE: we attempted every ID; the row may exist even if errors > 0 (if a
  //   prior sync persisted it). Just query for ALL ids — same cost.
  const placeholders = ids.map(id => `'${id.replace(/'/g, "''")}'`).join(",");
  try {
    const rowsRes = await db.execute(sql.raw(`
      SELECT
        id AS pk,
        gmail_message_id, gmail_thread_id, snippet, sent_at,
        from_email, from_name, to_emails, subject, label_ids, source_account_id
      FROM email_messages
      WHERE source_account_id = ${Number(account.id)}
        AND gmail_message_id IN (${placeholders})
      ORDER BY sent_at DESC NULLS LAST, id DESC
    `));
    const raw = ((rowsRes as any).rows ?? rowsRes) as any[];
    result.rows = raw.map(rowToSummary);
    if (raw.length > 0) {
      const oldestRow = raw[raw.length - 1];
      result.oldest = {
        sentAtIso: oldestRow.sent_at ? new Date(oldestRow.sent_at).toISOString() : null,
        pk: Number(oldestRow.pk),
      };
    }
  } catch (e: any) {
    log(`[gmail-backfill] account=${account.id} read-back failed: ${e.message}`);
    // Non-fatal — partial result is still useful (insert counters tell the truth).
  }

  result.tookMs = Date.now() - t0;
  log(`[gmail-backfill] account=${account.id} fetched=${result.fetched} inserted=${result.inserted} skipped=${result.skipped} errors=${result.errors} ${result.failed ? "FAILED" : ""} (${result.tookMs}ms)`);
  return result;
}

// Map an email_messages row into the LocalMessageSummary shape. Kept in sync
// with the same mapping in local-mailbox.ts/listLocalMessages by convention —
// they read identical columns. (Refactoring to a shared helper would force a
// public export from local-mailbox solely for one consumer; this duplication
// is small and the column names are stable.)
function rowToSummary(r: any): LocalMessageSummary {
  const sentAt = r.sent_at ? new Date(r.sent_at) : null;
  const labelIds = parseLabelIds(r.label_ids);
  const to = parseToList(r.to_emails);
  return {
    id: r.gmail_message_id,
    threadId: r.gmail_thread_id,
    snippet: r.snippet || "",
    internalDate: sentAt ? String(sentAt.getTime()) : "0",
    labelIds,
    from: fmtFrom(r.from_name, r.from_email),
    to,
    subject: r.subject || "",
    date: sentAt ? sentAt.toUTCString() : "",
    sourceAccountId: r.source_account_id != null ? Number(r.source_account_id) : undefined,
  };
}

function parseLabelIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const s = raw.trim();
  if (!s) return [];
  if (s.startsWith("[")) {
    try { const v = JSON.parse(s); return Array.isArray(v) ? v.map(String) : []; } catch { /* */ }
  }
  return s.split(",").map(x => x.trim()).filter(Boolean);
}

function parseToList(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = raw.trim();
  if (!s) return "";
  if (s.startsWith("[")) { try { const v = JSON.parse(s); if (Array.isArray(v)) return v.join(", "); } catch { /* */ } }
  return s;
}

function fmtFrom(name: string | null, email: string | null): string {
  if (name && email) return `${name} <${email}>`;
  return email || name || "";
}

async function callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (e: any) {
      const code = e?.code || e?.response?.status;
      const isRateLimit = code === 429;
      if (!isRateLimit || attempt >= MAX_RETRIES) throw e;
      const retryAfterRaw =
        e?.response?.headers?.["retry-after"] ??
        e?.response?.headers?.get?.("retry-after");
      const retryAfterMs = retryAfterRaw
        ? Math.max(100, Math.min(30_000, Number(retryAfterRaw) * 1000))
        : RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)];
      await new Promise(r => setTimeout(r, retryAfterMs));
      attempt++;
    }
  }
}
