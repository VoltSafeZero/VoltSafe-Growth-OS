#!/usr/bin/env npx tsx
/**
 * Inbox Visibility Backfill
 * =========================
 * One-time idempotent script that restores the INBOX label for inbound
 * emails that Gmail delivered directly to a CATEGORY_* tab without the
 * INBOX label (happens when the user's Gmail is configured with category
 * tabs set to "skip inbox").
 *
 * Scope: UNREAD inbound messages only.
 *   - UNREAD ensures we don't restore INBOX for emails the user has already
 *     read and archived (they explicitly moved them out of inbox).
 *   - Excludes SENT / DRAFT / SPAM / TRASH.
 *
 * Idempotent: the WHERE clause filters rows that already have INBOX.
 *
 * Run: npx tsx scripts/inbox-visibility-backfill.ts
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function run() {
  console.log("[inbox-backfill] Starting inbox visibility backfill…");

  // 1. Find all affected messages
  const findResult = await db.execute(sql.raw(`
    SELECT id, label_ids
    FROM email_messages
    WHERE
      label_ids NOT ILIKE '%"INBOX"%' AND label_ids NOT ILIKE '%INBOX%'
      AND (
        label_ids ILIKE '%CATEGORY_UPDATES%'
        OR label_ids ILIKE '%CATEGORY_PROMOTIONS%'
        OR label_ids ILIKE '%CATEGORY_SOCIAL%'
        OR label_ids ILIKE '%CATEGORY_FORUMS%'
      )
      AND label_ids NOT ILIKE '%"SPAM"%'
      AND label_ids NOT ILIKE '%"TRASH"%'
      AND label_ids NOT ILIKE '%"DRAFT"%'
      AND label_ids NOT ILIKE '%"SENT"%'
      AND label_ids ILIKE '%UNREAD%'
    ORDER BY id
  `));

  const rows = ((findResult as any).rows ?? findResult) as { id: number; label_ids: string }[];
  console.log(`[inbox-backfill] Found ${rows.length} unread inbound category-only messages to repair`);

  if (rows.length === 0) {
    console.log("[inbox-backfill] Nothing to do — all inbox-eligible messages already have INBOX.");
    return;
  }

  // 2. Repair each row: append "INBOX" to the label_ids JSON array
  let fixed = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      let labels: string[];
      try {
        labels = JSON.parse(row.label_ids || "[]");
      } catch {
        console.warn(`[inbox-backfill] Skipping id=${row.id}: invalid JSON label_ids`);
        skipped++;
        continue;
      }

      // Guard: double-check INBOX is absent (idempotency at the row level)
      if (labels.some(l => l.toUpperCase() === "INBOX")) {
        skipped++;
        continue;
      }

      const newLabels = [...labels, "INBOX"];
      const escaped = JSON.stringify(newLabels).replace(/'/g, "''");

      await db.execute(sql.raw(`
        UPDATE email_messages
        SET
          label_ids  = '${escaped}',
          updated_at = NOW()
        WHERE id = ${row.id}
          AND label_ids NOT ILIKE '%"INBOX"%'
          AND label_ids NOT ILIKE '%INBOX%'
      `));

      fixed++;
    } catch (err: any) {
      console.error(`[inbox-backfill] Error fixing id=${row.id}:`, err.message);
      errors++;
    }
  }

  console.log(`[inbox-backfill] Done. fixed=${fixed} skipped=${skipped} errors=${errors}`);

  // 3. Verify: re-run the find query to confirm all rows are repaired
  const verifyResult = await db.execute(sql.raw(`
    SELECT COUNT(*)::int AS remaining
    FROM email_messages
    WHERE
      label_ids NOT ILIKE '%"INBOX"%' AND label_ids NOT ILIKE '%INBOX%'
      AND (
        label_ids ILIKE '%CATEGORY_UPDATES%'
        OR label_ids ILIKE '%CATEGORY_PROMOTIONS%'
        OR label_ids ILIKE '%CATEGORY_SOCIAL%'
        OR label_ids ILIKE '%CATEGORY_FORUMS%'
      )
      AND label_ids NOT ILIKE '%"SPAM"%'
      AND label_ids NOT ILIKE '%"TRASH"%'
      AND label_ids NOT ILIKE '%"DRAFT"%'
      AND label_ids NOT ILIKE '%"SENT"%'
      AND label_ids ILIKE '%UNREAD%'
  `));
  const verifyRows = ((verifyResult as any).rows ?? verifyResult) as { remaining: number }[];
  const remaining = verifyRows[0]?.remaining ?? 0;

  if (remaining === 0) {
    console.log("[inbox-backfill] Verification: PASS — no remaining unread category-only messages.");
  } else {
    console.warn(`[inbox-backfill] Verification: WARN — ${remaining} rows still missing INBOX (check errors above).`);
    process.exit(1);
  }
}

run().then(() => process.exit(0)).catch((err) => {
  console.error("[inbox-backfill] Fatal:", err.message);
  process.exit(1);
});
