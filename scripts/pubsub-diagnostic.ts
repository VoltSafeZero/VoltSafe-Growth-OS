/**
 * Commit 5 — PubSub push-delivery diagnostic.
 *
 * Background: trevor's account (id 1) has been showing a stale
 * `last_webhook_at` (~10+ days old as of 2026-04-27) despite a current
 * `incremental_event_count`, so push delivery in the dev environment was
 * suspected broken. The Commit 4.1 restart auto-registered fresh watches
 * for support@ (id 92) and sales@ (id 93), expiring 2026-05-05. These
 * fresh watches give us a clean test: if push fires a webhook for a newly-
 * watched account, then push IS functional in dev for new watches and
 * trevor's stale state is specific to its old watch (likely a missed
 * renewal). If push does NOT fire for the new watches either, push is
 * structurally broken in dev and the foreground 15s polling fallback
 * (Commit 5 itself) is the actual safety net.
 *
 * What this script does:
 *   1. Snapshot last_webhook_at for accounts 1, 92, 93.
 *   2. Send two test emails using trevor's Gmail client:
 *        trevor@voltsafe.com  →  support@voltsafe.com
 *        trevor@voltsafe.com  →  sales@voltsafe.com
 *      Subject is uniquely tagged with `[pubsub-diag {ISO timestamp}]`
 *      so the test rows are easy to find / clean up later.
 *   3. Poll every 5s for up to 90s, watching last_webhook_at on accounts
 *      92 and 93 individually. (Trevor's account is also tracked since
 *      he sends the messages → his sent folder gets a new message → a
 *      messagesAdded event → push notification SHOULD fire for trevor too.)
 *   4. Report per-account: did the webhook fire? new last_webhook_at?
 *      did the message land in our local mirror?
 *
 * This is a one-shot diagnostic. Re-running is safe (will send two more
 * test emails and re-test push delivery).
 *
 * Run: npx tsx scripts/pubsub-diagnostic.ts
 * No DB schema changes. Reads from email_accounts and email_messages,
 * writes to Gmail (sent folder + recipient inbox) via the OAuth-authed
 * gmail.users.messages.send API call as trevor.
 *
 * History (do not delete — this file documents the diagnostic):
 *   - 2026-04-28: first run, post-Commit-5 implementation.
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { sendEmail } from "../server/gmail";

const TREVOR_USER_ID = 4;
const TREVOR_ACCOUNT_ID = 1;
const SUPPORT_ACCOUNT_ID = 92;
const SALES_ACCOUNT_ID = 93;
const ACCOUNTS_TO_TRACK = [TREVOR_ACCOUNT_ID, SUPPORT_ACCOUNT_ID, SALES_ACCOUNT_ID];

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 90_000;

type Snapshot = {
  id: number;
  email_address: string;
  last_webhook_at: string | null;
  last_incremental_sync_at: string | null;
  watch_expiration_at: string | null;
  total_msgs: number;
};

async function snapshotAccounts(label: string): Promise<Snapshot[]> {
  const r: any = await db.execute(sql`
    SELECT
      a.id,
      a.email_address,
      a.last_webhook_at::text  AS last_webhook_at,
      a.last_incremental_sync_at::text AS last_incremental_sync_at,
      a.watch_expiration_at::text AS watch_expiration_at,
      (SELECT count(*)::int FROM email_messages m
         WHERE m.source_account_id = a.id) AS total_msgs
    FROM email_accounts a
    WHERE a.id IN (1, 92, 93)
    ORDER BY a.id;
  `);
  const rows = (r.rows ?? r) as Snapshot[];
  console.log(`\n--- ${label} ---`);
  console.table(rows);
  return rows;
}

async function findTaggedMessage(tag: string, recipientAccountId: number): Promise<{ id: number; subject: string | null; sent_at: string | null } | null> {
  const r: any = await db.execute(sql`
    SELECT id, subject, sent_at::text AS sent_at
    FROM email_messages
    WHERE source_account_id = ${recipientAccountId}
      AND subject LIKE ${"%" + tag + "%"}
    ORDER BY sent_at DESC
    LIMIT 1;
  `);
  const rows = (r.rows ?? r);
  return rows[0] ?? null;
}

async function main() {
  console.log("==== PubSub push-delivery diagnostic ====");
  const before = await snapshotAccounts("BEFORE");
  const beforeById = new Map(before.map((s) => [s.id, s]));

  const tag = `pubsub-diag ${new Date().toISOString()}`;
  console.log(`\nTag for this run: [${tag}]`);

  // ── Step 1: Send test emails from trevor → support, trevor → sales ──
  console.log("\n--- Sending test emails as trevor (userId=4, accountId=1) ---");
  for (const recipient of ["support@voltsafe.com", "sales@voltsafe.com"]) {
    try {
      const t0 = Date.now();
      const res = await sendEmail(
        TREVOR_USER_ID,
        recipient,
        `[${tag}]`,
        `Diagnostic test message — verifies push notification delivery for the recipient's freshly-registered Gmail watch (Commit 5 follow-up).`,
        undefined,
        [],
        TREVOR_ACCOUNT_ID,
      );
      console.log(`  ✓ trevor → ${recipient}  (gmail msg id ${res.id}, ${Date.now() - t0}ms)`);
    } catch (err: any) {
      console.error(`  ✗ trevor → ${recipient}  failed: ${err.message}`);
    }
  }

  // ── Step 2: Poll for webhook activity ──
  console.log(`\n--- Polling every ${POLL_INTERVAL_MS / 1000}s for up to ${POLL_TIMEOUT_MS / 1000}s ---`);
  const fired = new Set<number>();
  const wakedAt: Record<number, string> = {};
  const startedAt = Date.now();
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    const now = await snapshotAccounts(`tick @ +${Math.round((Date.now() - startedAt) / 1000)}s`);
    for (const cur of now) {
      if (fired.has(cur.id)) continue;
      const prev = beforeById.get(cur.id);
      if (!prev) continue;
      if (cur.last_webhook_at && cur.last_webhook_at !== prev.last_webhook_at) {
        fired.add(cur.id);
        wakedAt[cur.id] = cur.last_webhook_at;
        console.log(`  ★ webhook FIRED for account ${cur.id} (${cur.email_address}) — last_webhook_at: ${prev.last_webhook_at} → ${cur.last_webhook_at}`);
      }
    }
    if (fired.size === ACCOUNTS_TO_TRACK.length) {
      console.log("\nAll three accounts received a webhook tick — short-circuiting wait.");
      break;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  // ── Step 3: Check whether the test message landed in our local mirror ──
  console.log("\n--- Local mirror landing check (did syncIncremental upsert the test row?) ---");
  for (const acctId of [SUPPORT_ACCOUNT_ID, SALES_ACCOUNT_ID]) {
    const found = await findTaggedMessage(tag, acctId);
    if (found) {
      console.log(`  ✓ account ${acctId}: found row id=${found.id} subject="${found.subject}" sent_at=${found.sent_at}`);
    } else {
      console.log(`  ✗ account ${acctId}: NOT YET in local mirror`);
    }
  }

  // ── Final report ──
  console.log("\n==== DIAGNOSTIC RESULT ====");
  for (const id of ACCOUNTS_TO_TRACK) {
    const before_ = beforeById.get(id);
    const status = fired.has(id)
      ? `WEBHOOK FIRED at ${wakedAt[id]} (was ${before_?.last_webhook_at ?? "null"})`
      : `NO webhook within ${POLL_TIMEOUT_MS / 1000}s window`;
    console.log(`  account ${id} (${before_?.email_address}): ${status}`);
  }
  console.log("\nInterpretation guide:");
  console.log("  • If fired for 92/93: push IS functional in dev for newly-watched accounts.");
  console.log("    Trevor's stale last_webhook_at is then specific to its old watch.");
  console.log("  • If NOT fired: push is structurally broken in dev (likely container sleep");
  console.log("    or webhook-URL drift). The Commit 5 foreground polling fallback is the");
  console.log("    actual user-facing safety net and is doing the right thing by existing.");

  process.exit(0);
}

main().catch((err) => {
  console.error("Top-level failure:", err);
  process.exit(1);
});
