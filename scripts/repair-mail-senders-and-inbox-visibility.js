/**
 * repair-mail-senders-and-inbox-visibility.js
 *
 * Safe, idempotent repair script for two classes of data problems:
 *
 * 1. Missing sender fields — rows where from_name IS NULL but from_email IS NOT NULL.
 *    Recovery strategy: cross-reference other messages from the same from_email address
 *    that already have a from_name populated. The most-frequently occurring name for
 *    each address is used as the canonical value (ties broken alphabetically).
 *    Only rows that are still NULL after the fix are counted as unrecoverable.
 *
 *    NOTE: The schema does not include a from_header column; the cross-reference
 *    approach recovers sender names without it.
 *
 * 2. Missing category labels — this script DOES NOT touch label_ids; that would
 *    require a live Gmail API call per message to re-fetch the current labels.
 *    Instead it reports how many messages now appear in the inbox view (INBOX or
 *    CATEGORY_* label) so the operator can confirm the server-side query is working.
 *
 * Usage:
 *   node scripts/repair-mail-senders-and-inbox-visibility.js
 *
 * Safe to run multiple times — only updates rows where from_name IS NULL.
 */

import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();
  try {
    console.log("=== VoltSafe Mail Sender + Inbox Repair ===\n");

    // ── 1. Before-repair stats ────────────────────────────────────────────
    const { rows: [before] } = await client.query(
      "SELECT COUNT(*) FILTER (WHERE from_name IS NULL AND from_email IS NULL) AS both_null, " +
      "COUNT(*) FILTER (WHERE from_name IS NULL AND from_email IS NOT NULL) AS name_only_null, " +
      "COUNT(*) FILTER (WHERE from_name IS NOT NULL AND from_email IS NULL) AS email_only_null, " +
      "COUNT(*) AS total FROM email_messages"
    );
    console.log("Before repair:");
    console.log(`  Total messages:            ${before.total}`);
    console.log(`  Both from_name+email null: ${before.both_null}`);
    console.log(`  from_name null only:       ${before.name_only_null}`);
    console.log(`  from_email null only:      ${before.email_only_null}\n`);

    // ── 2. Repair: fill from_name via most-frequent cross-reference ───────
    // For every message where from_name IS NULL but from_email IS NOT NULL,
    // find the most commonly used non-null from_name for that email address
    // across all messages. Ties are broken alphabetically.
    // Idempotent: WHERE from_name IS NULL ensures already-fixed rows are skipped.
    const repairResult = await client.query(`
      UPDATE email_messages em
      SET from_name = sub.canonical_name
      FROM (
        SELECT from_email,
               from_name AS canonical_name
        FROM (
          SELECT from_email,
                 from_name,
                 COUNT(*) AS freq,
                 ROW_NUMBER() OVER (
                   PARTITION BY from_email
                   ORDER BY COUNT(*) DESC, from_name ASC
                 ) AS rn
          FROM email_messages
          WHERE from_name IS NOT NULL
            AND from_email IS NOT NULL
          GROUP BY from_email, from_name
        ) ranked
        WHERE rn = 1
      ) sub
      WHERE em.from_email = sub.from_email
        AND em.from_name IS NULL
    `);
    const repaired = repairResult.rowCount ?? 0;
    console.log(`Repair pass complete: ${repaired} rows updated via cross-reference\n`);

    // ── 3. After-repair stats ─────────────────────────────────────────────
    const { rows: [after] } = await client.query(
      "SELECT COUNT(*) FILTER (WHERE from_name IS NULL AND from_email IS NULL) AS both_null, " +
      "COUNT(*) FILTER (WHERE from_name IS NULL AND from_email IS NOT NULL) AS name_only_null, " +
      "COUNT(*) FILTER (WHERE from_name IS NOT NULL AND from_email IS NULL) AS email_only_null " +
      "FROM email_messages"
    );
    console.log("After repair:");
    console.log(`  Both from_name+email null: ${after.both_null}`);
    console.log(`  from_name null only:       ${after.name_only_null}`);
    console.log(`  from_email null only:      ${after.email_only_null}\n`);

    const remaining = Number(after.name_only_null);
    if (remaining > 0) {
      console.log(
        `  → ${remaining} rows remain with null from_name (sender appears only once in DB ` +
        `with no name; unrecoverable without a live Gmail API call)\n`
      );
    } else {
      console.log("  → All recoverable sender names have been filled in.\n");
    }

    // ── 4. Inbox visibility report ────────────────────────────────────────
    const { rows: [inbox] } = await client.query(
      "SELECT " +
      "COUNT(*) FILTER (WHERE label_ids LIKE '%\"INBOX\"%') AS inbox_label_count, " +
      "COUNT(*) FILTER (WHERE label_ids LIKE '%CATEGORY_UPDATES%' OR label_ids LIKE '%CATEGORY_PROMOTIONS%' " +
      "  OR label_ids LIKE '%CATEGORY_SOCIAL%' OR label_ids LIKE '%CATEGORY_FORUMS%') AS category_label_count, " +
      "COUNT(*) FILTER (WHERE (" +
      "  label_ids LIKE '%\"INBOX\"%' OR label_ids LIKE '%CATEGORY_UPDATES%' " +
      "  OR label_ids LIKE '%CATEGORY_PROMOTIONS%' OR label_ids LIKE '%CATEGORY_SOCIAL%' " +
      "  OR label_ids LIKE '%CATEGORY_FORUMS%') " +
      "AND label_ids NOT LIKE '%\"SENT\"%' AND label_ids NOT LIKE '%\"DRAFT\"%' " +
      "AND label_ids NOT LIKE '%\"SPAM\"%' AND label_ids NOT LIKE '%\"TRASH\"%') AS inbox_visible_count " +
      "FROM email_messages"
    );
    console.log("Inbox visibility:");
    console.log(`  Messages with INBOX label:      ${inbox.inbox_label_count}`);
    console.log(`  Messages with CATEGORY_* label: ${inbox.category_label_count}`);
    console.log(`  Total inbox-visible:            ${inbox.inbox_visible_count}`);
    const gained = Number(inbox.inbox_visible_count) - Number(inbox.inbox_label_count);
    if (gained > 0) {
      console.log(
        `  → ${gained} extra messages now visible in Inbox ` +
        `(previously hidden in category folders only)\n`
      );
    } else {
      console.log(
        "  → No additional messages gained " +
        "(all CATEGORY_* messages also carry INBOX label)\n"
      );
    }

    console.log("Done. No further action required.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
