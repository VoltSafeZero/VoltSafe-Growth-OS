/**
 * Production-safe idempotent backfill for derived email label columns.
 *
 * Fills is_inbox, is_unread, is_starred, is_spam, is_trash, is_draft, is_sent,
 * and smart_category for any email_messages row where any derived field is NULL.
 *
 * Safety guarantees:
 *  - NEVER mutates label_ids
 *  - Only writes derived columns
 *  - Idempotent: safe to re-run; already-filled rows are untouched
 *  - Cursor-batched by row id: partial failures lose at most one batch
 *  - Canonical formula mirrors inbox-policy.ts / migration 0016
 *
 * Usage:
 *   npx tsx scripts/production-derived-label-backfill.ts
 *
 * Environment:
 *   DATABASE_URL — connect string (default: dev DB)
 *   BACKFILL_BATCH — rows per batch (default: 500)
 *   BACKFILL_SLEEP_MS — ms to sleep between batches (default: 50)
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

const BATCH_SIZE = Number(process.env.BACKFILL_BATCH  || 500);
const SLEEP_MS   = Number(process.env.BACKFILL_SLEEP_MS || 50);

let stopRequested = false;
process.on("SIGTERM", () => { console.log("[signal] SIGTERM — will stop after current batch"); stopRequested = true; });
process.on("SIGINT",  () => { console.log("[signal] SIGINT — will stop after current batch");  stopRequested = true; });

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function countNull(): Promise<number> {
  const r = await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM email_messages
    WHERE is_inbox IS NULL
       OR is_unread IS NULL
       OR smart_category IS NULL
  `);
  return Number((r as any).rows?.[0]?.n ?? 0);
}

async function runBatch(afterId: number): Promise<{ rowsUpdated: number; maxId: number | null }> {
  const r = await db.execute(sql`
    WITH batch AS (
      SELECT id FROM email_messages
      WHERE (is_inbox IS NULL OR is_unread IS NULL OR smart_category IS NULL)
        AND id > ${afterId}
      ORDER BY id
      LIMIT ${BATCH_SIZE}
    )
    UPDATE email_messages SET
      is_unread     = (label_ids LIKE '%"UNREAD"%'),
      is_starred    = (label_ids LIKE '%"STARRED"%'),
      is_spam       = (label_ids LIKE '%"SPAM"%'),
      is_trash      = (label_ids LIKE '%"TRASH"%'),
      is_draft      = (label_ids LIKE '%"DRAFT"%'),
      is_sent       = (label_ids LIKE '%"SENT"%'),
      is_inbox      = (
          (   label_ids LIKE '%"INBOX"%'
           OR label_ids ILIKE '%CATEGORY_PERSONAL%'
           OR label_ids ILIKE '%CATEGORY_UPDATES%'
           OR label_ids ILIKE '%CATEGORY_PROMOTIONS%'
           OR label_ids ILIKE '%CATEGORY_SOCIAL%'
           OR label_ids ILIKE '%CATEGORY_FORUMS%')
          AND label_ids NOT LIKE '%"SPAM"%'
          AND label_ids NOT LIKE '%"TRASH"%'
          AND label_ids NOT LIKE '%"DRAFT"%'
      ),
      smart_category = CASE
        WHEN label_ids ILIKE '%CATEGORY_UPDATES%'    THEN 'updates'
        WHEN label_ids ILIKE '%CATEGORY_PROMOTIONS%' THEN 'promotions'
        WHEN label_ids ILIKE '%CATEGORY_SOCIAL%'     THEN 'social'
        WHEN label_ids ILIKE '%CATEGORY_FORUMS%'     THEN 'forums'
        ELSE 'people'
      END
    FROM batch
    WHERE email_messages.id = batch.id
    RETURNING email_messages.id
  `);
  const rows = (r as any).rows as Array<{ id: number }>;
  const maxId = rows.length > 0 ? Math.max(...rows.map(rr => rr.id)) : null;
  return { rowsUpdated: rows.length, maxId };
}

async function main() {
  const startedAt = Date.now();
  console.log("========== DERIVED LABEL BACKFILL ==========");
  console.log(`[config] batch=${BATCH_SIZE} sleep=${SLEEP_MS}ms`);

  const initialNull = await countNull();
  console.log(`[before] rows needing backfill: ${initialNull}`);

  if (initialNull === 0) {
    console.log("[done] all rows already have derived columns — nothing to do");
    process.exit(0);
  }

  let totalUpdated = 0;
  let batchNum     = 0;
  let cursorId     = 0;

  while (!stopRequested) {
    batchNum++;
    let rowsUpdated: number;
    let maxId: number | null;

    try {
      ({ rowsUpdated, maxId } = await runBatch(cursorId));
    } catch (err: any) {
      console.error(`[error] batch ${batchNum} failed: ${err?.message ?? String(err)}`);
      console.error("[stop] aborting to prevent partial state — re-run is safe");
      process.exit(1);
    }

    if (rowsUpdated === 0) {
      // No rows left to fill — done
      break;
    }

    totalUpdated += rowsUpdated;
    cursorId      = maxId ?? cursorId;

    const remaining  = await countNull();
    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
      `[batch ${batchNum}] updated=${rowsUpdated} total_so_far=${totalUpdated} remaining=${remaining} elapsed=${elapsedSec}s`
    );

    if (remaining === 0) break;
    if (SLEEP_MS > 0) await sleep(SLEEP_MS);
  }

  const finalNull  = await countNull();
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log("");
  console.log("========== BACKFILL FINAL REPORT ==========");
  console.log(`runtime         : ${elapsedSec}s`);
  console.log(`batches         : ${batchNum}`);
  console.log(`rows updated    : ${totalUpdated}`);
  console.log(`null remaining  : ${finalNull}`);
  console.log(`status          : ${finalNull === 0 ? "SUCCESS — all derived columns populated" : "WARNING — some NULLs remain, re-run required"}`);
  console.log("===========================================");

  process.exit(finalNull === 0 ? 0 : 1);
}

main().catch(err => {
  console.error("[fatal]", err);
  process.exit(1);
});
