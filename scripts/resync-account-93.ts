/**
 * One-off operational catch-up sync for sales@voltsafe.com (account id 93).
 *
 * Context: ran as Step 3 of the post-Commit-4.1 visibility data correction.
 * Account 93 was missed by the OAuth-completion admin tasks (is_shared/
 * mail_team), and its `email_accounts.last_sync_at` was NULL when the
 * visibility fix landed. This script invokes the same sync entry point that
 * `POST /api/gmail/accounts/:id/resync` uses, but bypasses the auth layer
 * (test admin credentials in this repo have drifted) by calling the service
 * function directly. Idempotent — safe to re-run; already-mirrored messages
 * are no-ops on the upsert path inside syncEmailAccount.
 *
 * Run: npx tsx scripts/resync-account-93.ts
 * No DB schema changes. Writes only to email_messages / email_threads via
 * the standard mirror path. Read-only against email_accounts metadata
 * (the sync function itself updates last_sync_at as a side effect).
 *
 * History (do not delete — this file documents the data correction):
 *   - 2026-04-28: first run, post-Commit-4.1, post-OAuth-admin-task backfill.
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { syncEmailAccount } from "../server/services/gmail-sync";

const ACCOUNT_ID = 93;
const PAGE_SIZE = 100;
const MAX_PAGES = 3; // up to 300 messages — plenty for visible live-mail catch-up.

async function snapshot(label: string) {
  const r: any = await db.execute(sql`
    SELECT
      a.id,
      a.email_address,
      a.last_sync_at,
      a.last_webhook_at,
      a.watch_expiration_at,
      (SELECT count(*)::int FROM email_messages m
         WHERE m.source_account_id = a.id) AS total_msgs,
      (SELECT count(*)::int FROM email_messages m
         WHERE m.source_account_id = a.id
           AND m.label_ids LIKE '%"INBOX"%') AS inbox_msgs,
      (SELECT max(sent_at) FROM email_messages m
         WHERE m.source_account_id = a.id) AS newest_msg_at
    FROM email_accounts a
    WHERE a.id = ${ACCOUNT_ID};
  `);
  const row = (r.rows ?? r)[0];
  console.log(`\n--- ${label} ---`);
  console.log(JSON.stringify(row, null, 2));
  return row;
}

async function main() {
  console.log(`==== One-off resync for account ${ACCOUNT_ID} (sales@voltsafe.com) ====`);
  const before = await snapshot("BEFORE");

  console.log(`\n--- Calling syncEmailAccount(${ACCOUNT_ID}, { maxPages: ${MAX_PAGES}, pageSize: ${PAGE_SIZE} }) ---`);
  const t0 = Date.now();
  let result;
  try {
    result = await syncEmailAccount(ACCOUNT_ID, { maxPages: MAX_PAGES, pageSize: PAGE_SIZE });
  } catch (err: any) {
    console.error(`\n!! syncEmailAccount threw: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
  const elapsedMs = Date.now() - t0;
  console.log(`\n--- syncEmailAccount returned in ${elapsedMs}ms ---`);
  console.log(JSON.stringify(result, null, 2));

  const after = await snapshot("AFTER");

  const delta = {
    new_total_msgs: (after.total_msgs ?? 0) - (before.total_msgs ?? 0),
    new_inbox_msgs: (after.inbox_msgs ?? 0) - (before.inbox_msgs ?? 0),
    last_sync_at_was: before.last_sync_at,
    last_sync_at_now: after.last_sync_at,
    newest_msg_was: before.newest_msg_at,
    newest_msg_now: after.newest_msg_at,
  };
  console.log("\n--- DELTA ---");
  console.log(JSON.stringify(delta, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error("Top-level failure:", err);
  process.exit(1);
});
