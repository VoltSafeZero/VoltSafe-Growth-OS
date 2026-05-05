/**
 * One-time script: mark all emails before 2026-05-01 as read in Gmail AND
 * in the local mirror across all accounts (trevor=1, support=92, sales=93).
 *
 * Strategy: query Gmail directly (not local DB) for `is:unread before:CUTOFF`
 * so we get the true Gmail state regardless of local mirror. Then batchModify
 * to remove UNREAD at the source. Also patches local DB rows that still carry
 * the UNREAD label.
 *
 * Run: npx tsx scripts/bulk-mark-read-before-may2026.ts
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { getGmailClient } from "../server/gmail-oauth";

const CUTOFF_DATE  = "2026-05-01";
const CUTOFF_UNIX  = Math.floor(new Date(CUTOFF_DATE).getTime() / 1000);
const USER_ID      = 4;
const ACCOUNT_IDS  = [1, 92, 93];
const LIST_BATCH   = 500;   // Gmail list page size
const MODIFY_BATCH = 1000;  // batchModify max per call
const SLEEP_MS     = 300;   // pause between batchModify calls

let stopRequested = false;
process.on("SIGTERM", () => { console.log("[signal] SIGTERM — will stop after current batch"); stopRequested = true; });
process.on("SIGINT",  () => { console.log("[signal] SIGINT — will stop after current batch");  stopRequested = true; });

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function listGmailUnreadBefore(gmail: any): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    const res: any = await gmail.users.messages.list({
      userId: "me",
      q: `is:unread before:${CUTOFF_UNIX}`,
      maxResults: LIST_BATCH,
      pageToken,
    });
    const msgs: any[] = res.data.messages || [];
    ids.push(...msgs.map((m: any) => m.id as string));
    pageToken = res.data.nextPageToken;
    if (ids.length % 2000 === 0 || !pageToken) {
      console.log(`  Listed ${ids.length} IDs so far${pageToken ? " (more pages…)" : " (done)"}`);
    }
  } while (pageToken && !stopRequested);

  return ids;
}

async function batchMarkReadInGmail(
  gmail: any,
  ids: string[],
): Promise<{ succeeded: string[]; failed: number }> {
  const succeeded: string[] = [];
  let failed = 0;

  for (let i = 0; i < ids.length; i += MODIFY_BATCH) {
    if (stopRequested) break;
    const batch = ids.slice(i, i + MODIFY_BATCH);
    try {
      await gmail.users.messages.batchModify({
        userId: "me",
        requestBody: { ids: batch, removeLabelIds: ["UNREAD"] },
      });
      succeeded.push(...batch);
      console.log(`  batchModify OK: ${batch.length} msgs (offset ${i} / ${ids.length})`);
    } catch (e: any) {
      console.error(`  batchModify FAILED offset ${i}:`, e.message);
      failed += batch.length;
    }
    if (i + MODIFY_BATCH < ids.length) await sleep(SLEEP_MS);
  }

  return { succeeded, failed };
}

async function mirrorReadLocally(ids: string[], accountId: number): Promise<number> {
  if (ids.length === 0) return 0;
  let updated = 0;
  const LOCAL_BATCH = 500;

  for (let i = 0; i < ids.length; i += LOCAL_BATCH) {
    const batch = ids.slice(i, i + LOCAL_BATCH);
    const idList = batch.map(id => `'${id.replace(/'/g, "''")}'`).join(",");
    try {
      const r = await db.execute(sql.raw(`
        UPDATE email_messages
        SET label_ids = COALESCE(
          (SELECT jsonb_agg(elem)::text
           FROM jsonb_array_elements_text(label_ids::jsonb) elem
           WHERE elem != 'UNREAD'),
          '[]'
        )
        WHERE gmail_message_id IN (${idList})
          AND source_account_id = ${accountId}
          AND label_ids ILIKE '%UNREAD%'
      `));
      const n = Number((r as any).rowCount ?? (r as any).count ?? 0);
      updated += n;
    } catch (e: any) {
      console.error(`  Local mirror batch FAILED offset ${i}:`, e.message);
    }
  }
  return updated;
}

async function processAccount(accountId: number): Promise<void> {
  console.log(`\n=== Account ${accountId} ===`);

  let gmail: any;
  try {
    gmail = await getGmailClient(USER_ID, accountId);
  } catch (e: any) {
    console.error(`  Could not get Gmail client: ${e.message}`);
    return;
  }

  console.log(`  Querying Gmail for is:unread before:${CUTOFF_DATE} …`);
  const ids = await listGmailUnreadBefore(gmail);
  console.log(`  Gmail reports ${ids.length} unread messages before ${CUTOFF_DATE}`);

  if (ids.length === 0) {
    console.log("  Nothing to do.");
    return;
  }

  const { succeeded, failed } = await batchMarkReadInGmail(gmail, ids);
  console.log(`  Gmail mark-read: ${succeeded.length} OK, ${failed} failed`);

  const mirroredCount = await mirrorReadLocally(succeeded, accountId);
  console.log(`  Local mirror: ${mirroredCount} rows updated`);
}

async function main() {
  console.log(`[bulk-mark-read] START — cutoff: ${CUTOFF_DATE} (unix ${CUTOFF_UNIX})`);
  for (const accountId of ACCOUNT_IDS) {
    if (stopRequested) break;
    await processAccount(accountId);
  }
  console.log("\n[bulk-mark-read] DONE.");
  process.exit(0);
}

main().catch(e => {
  console.error("[bulk-mark-read] Fatal:", e);
  process.exit(1);
});
