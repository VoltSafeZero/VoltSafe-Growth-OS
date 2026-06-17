/**
 * Phase 1 backfill — derived label columns
 * Populates is_inbox, is_unread, is_starred, is_spam, is_trash, is_draft,
 * is_sent, smart_category for all email_messages rows.
 *
 * Runs in batches of BATCH_SIZE by id to avoid long-lock timeouts.
 * label_ids is never mutated.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const BATCH_SIZE = 5_000;

async function run() {
  // Find the id range
  const rangeRows = await db.execute(sql.raw(`SELECT MIN(id) AS lo, MAX(id) AS hi FROM email_messages`));
  const range = ((rangeRows as any).rows ?? rangeRows)[0] as { lo: number; hi: number };
  const lo = Number(range.lo ?? 0);
  const hi = Number(range.hi ?? 0);

  if (!hi) {
    console.log("No rows found — nothing to backfill.");
    return;
  }

  console.log(`Backfilling id ${lo}…${hi} in batches of ${BATCH_SIZE}`);

  let updated = 0;
  let batch = 0;
  for (let start = lo; start <= hi; start += BATCH_SIZE) {
    const end = start + BATCH_SIZE - 1;
    batch++;
    const result = await db.execute(sql.raw(`
      UPDATE email_messages SET
        is_unread  = (label_ids LIKE '%"UNREAD"%'),
        is_starred = (label_ids LIKE '%"STARRED"%'),
        is_spam    = (label_ids LIKE '%"SPAM"%'),
        is_trash   = (label_ids LIKE '%"TRASH"%'),
        is_draft   = (label_ids LIKE '%"DRAFT"%'),
        is_sent    = (label_ids LIKE '%"SENT"%'),
        is_inbox   = (
          (  label_ids LIKE '%"INBOX"%'
          OR label_ids ILIKE '%CATEGORY_PERSONAL%'
          OR label_ids ILIKE '%CATEGORY_UPDATES%'
          OR label_ids ILIKE '%CATEGORY_PROMOTIONS%'
          OR label_ids ILIKE '%CATEGORY_SOCIAL%'
          OR label_ids ILIKE '%CATEGORY_FORUMS%')
          AND label_ids NOT LIKE '%"SPAM"%'
          AND label_ids NOT LIKE '%"TRASH"%'
          AND label_ids NOT LIKE '%"DRAFT"%'
          AND label_ids NOT LIKE '%"SENT"%'
        ),
        smart_category = CASE
          WHEN label_ids ILIKE '%CATEGORY_UPDATES%'    THEN 'updates'
          WHEN label_ids ILIKE '%CATEGORY_PROMOTIONS%' THEN 'promotions'
          WHEN label_ids ILIKE '%CATEGORY_SOCIAL%'     THEN 'social'
          WHEN label_ids ILIKE '%CATEGORY_FORUMS%'     THEN 'forums'
          ELSE 'people'
        END
      WHERE id BETWEEN ${start} AND ${end}
    `));
    const rows = (result as any).rowCount ?? (result as any).rowsAffected ?? "?";
    updated += Number(rows) || 0;
    process.stdout.write(`  batch ${batch}: id ${start}–${end} → ${rows} rows\n`);
  }

  console.log(`\nDone. Total rows updated: ${updated}`);

  // Verify: any NULL left?
  const nullCheck = await db.execute(sql.raw(
    `SELECT COUNT(*) AS still_null FROM email_messages WHERE is_inbox IS NULL`
  ));
  const nullRow = ((nullCheck as any).rows ?? nullCheck)[0] as { still_null: string };
  console.log(`Rows still NULL: ${nullRow.still_null}`);
}

run().catch((err) => { console.error(err); process.exit(1); });
