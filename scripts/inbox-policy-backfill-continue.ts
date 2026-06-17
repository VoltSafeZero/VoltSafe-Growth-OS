import { db } from "../server/db";
import { sql } from "drizzle-orm";

const BATCH_SIZE = 10_000;
const START_FROM = 55001;

async function run() {
  const rangeRows = await db.execute(sql.raw(`SELECT MAX(id) AS hi FROM email_messages`));
  const hi = Number(((rangeRows as any).rows ?? rangeRows)[0].hi);
  console.log(`Continuing backfill from id ${START_FROM} to ${hi}`);

  let updated = 0, batch = 0;
  for (let start = START_FROM; start <= hi; start += BATCH_SIZE) {
    const end = start + BATCH_SIZE - 1;
    batch++;
    const r = await db.execute(sql.raw(`
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
    const rows = (r as any).rowCount ?? "?";
    updated += Number(rows) || 0;
    console.log(`  batch ${batch}: id ${start}–${end} → ${rows} rows`);
  }

  console.log(`\nTotal updated this run: ${updated}`);
  const nc = await db.execute(sql.raw(
    `SELECT COUNT(*) AS still_null FROM email_messages WHERE is_inbox IS NULL`
  ));
  console.log(`Rows still NULL: ${((nc as any).rows ?? nc)[0].still_null}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
