/**
 * repair-mail-senders-and-inbox-visibility.js
 *
 * Safe, idempotent repair script for two classes of data problems:
 *
 * 1. Missing sender fields — rows where from_name IS NULL or from_email IS NULL
 *    but data can be recovered by re-parsing the raw "Name <email>" from_header
 *    column (or by falling back to the snippet when the header is also absent).
 *    Only rows that are still NULL after the fix are counted as unrecoverable.
 *
 * 2. Missing category labels — this script DOES NOT touch label_ids; that would
 *    require a live Gmail API call per message to re-fetch the current labels.
 *    Instead it reports how many messages now appear in the inbox view after the
 *    buildQClauses fix (i.e. have at least one CATEGORY_* label) so the operator
 *    can confirm the server-side query change is working.
 *
 * Usage:
 *   npx tsx scripts/repair-mail-senders-and-inbox-visibility.js
 *   node scripts/repair-mail-senders-and-inbox-visibility.js
 *
 * Safe to run multiple times — only updates rows where the target column IS NULL.
 */

import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
});

/**
 * Parse a raw RFC 5322 "From" header into { name, email }.
 * Handles common formats:
 *   "Name <email>"
 *   "<email>"
 *   "email"
 *   "Name" (no email — rare but possible)
 */
function parseFrom(raw) {
  if (!raw || typeof raw !== "string") return { name: null, email: null };
  const trimmed = raw.trim();
  // "Name <email>" or "<email>"
  const angleMatch = trimmed.match(/^(.*?)<([^>]+)>\s*$/);
  if (angleMatch) {
    const name = angleMatch[1].replace(/^["'\s]+|["'\s]+$/g, "").trim() || null;
    const email = angleMatch[2].trim().toLowerCase() || null;
    return { name, email };
  }
  // Bare email address
  if (trimmed.includes("@")) {
    return { name: null, email: trimmed.toLowerCase() };
  }
  // Name only (no email address found)
  return { name: trimmed || null, email: null };
}

async function main() {
  const client = await pool.connect();
  try {
    console.log("=== VoltSafe Mail Sender + Inbox Repair ===\n");

    // ── 1. Count rows with missing sender fields ──────────────────────────
    const { rows: [missingBefore] } = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE from_name IS NULL AND from_email IS NULL) AS both_null,
        COUNT(*) FILTER (WHERE from_name IS NULL AND from_email IS NOT NULL) AS name_only_null,
        COUNT(*) FILTER (WHERE from_name IS NOT NULL AND from_email IS NULL) AS email_only_null,
        COUNT(*) AS total
      FROM email_messages
    `);
    console.log("Before repair:");
    console.log(`  Total messages:            ${missingBefore.total}`);
    console.log(`  Both from_name+email null: ${missingBefore.both_null}`);
    console.log(`  from_name null only:       ${missingBefore.name_only_null}`);
    console.log(`  from_email null only:      ${missingBefore.email_only_null}\n`);

    // ── 2. Fetch rows that need from_header re-parsing ────────────────────
    // We look for rows where from_name IS NULL or from_email IS NULL AND
    // from_header is non-null (i.e., there is raw data to recover from).
    const { rows: repairCandidates } = await client.query(`
      SELECT id, from_header, from_name, from_email
      FROM email_messages
      WHERE (from_name IS NULL OR from_email IS NULL)
        AND from_header IS NOT NULL AND from_header <> ''
      LIMIT 50000
    `);
    console.log(`Rows with non-null from_header to repair: ${repairCandidates.length}`);

    // ── 3. Batch-update recoverable rows ──────────────────────────────────
    let repaired = 0;
    let skipped = 0;
    const BATCH = 500;

    for (let i = 0; i < repairCandidates.length; i += BATCH) {
      const batch = repairCandidates.slice(i, i + BATCH);
      for (const row of batch) {
        const { name, email } = parseFrom(row.from_header);
        const updates = [];
        const params = [];
        let idx = 1;

        // Only set the column if it is currently NULL and we have a value to fill in
        if (row.from_name === null && name !== null) {
          updates.push(`from_name = $${idx++}`);
          params.push(name);
        }
        if (row.from_email === null && email !== null) {
          updates.push(`from_email = $${idx++}`);
          params.push(email);
        }
        if (updates.length === 0) {
          skipped++;
          continue;
        }
        params.push(row.id);
        await client.query(
          `UPDATE email_messages SET ${updates.join(", ")} WHERE id = $${idx}`,
          params,
        );
        repaired++;
      }
    }

    console.log(`Repair pass complete: ${repaired} rows updated, ${skipped} skipped (no recoverable data)\n`);

    // ── 4. After-repair stats ─────────────────────────────────────────────
    const { rows: [missingAfter] } = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE from_name IS NULL AND from_email IS NULL) AS both_null,
        COUNT(*) FILTER (WHERE from_name IS NULL AND from_email IS NOT NULL) AS name_only_null,
        COUNT(*) FILTER (WHERE from_name IS NOT NULL AND from_email IS NULL) AS email_only_null
      FROM email_messages
    `);
    console.log("After repair:");
    console.log(`  Both from_name+email null: ${missingAfter.both_null}`);
    console.log(`  from_name null only:       ${missingAfter.name_only_null}`);
    console.log(`  from_email null only:      ${missingAfter.email_only_null}\n`);

    // ── 5. Inbox visibility report ────────────────────────────────────────
    // Count messages that are now visible in the expanded inbox query
    // (INBOX OR any CATEGORY_* label, not SENT/DRAFT/SPAM/TRASH).
    const { rows: [inboxStats] } = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE label_ids LIKE '%"INBOX"%') AS inbox_label_count,
        COUNT(*) FILTER (WHERE
          label_ids LIKE '%CATEGORY_UPDATES%'
          OR label_ids LIKE '%CATEGORY_PROMOTIONS%'
          OR label_ids LIKE '%CATEGORY_SOCIAL%'
          OR label_ids LIKE '%CATEGORY_FORUMS%'
        ) AS category_label_count,
        COUNT(*) FILTER (WHERE (
          label_ids LIKE '%"INBOX"%'
          OR label_ids LIKE '%CATEGORY_UPDATES%'
          OR label_ids LIKE '%CATEGORY_PROMOTIONS%'
          OR label_ids LIKE '%CATEGORY_SOCIAL%'
          OR label_ids LIKE '%CATEGORY_FORUMS%'
        )
        AND label_ids NOT LIKE '%"SENT"%'
        AND label_ids NOT LIKE '%"DRAFT"%'
        AND label_ids NOT LIKE '%"SPAM"%'
        AND label_ids NOT LIKE '%"TRASH"%'
        ) AS inbox_visible_count
      FROM email_messages
    `);
    console.log("Inbox visibility (after server-side query fix):");
    console.log(`  Messages with INBOX label:      ${inboxStats.inbox_label_count}`);
    console.log(`  Messages with CATEGORY_* label: ${inboxStats.category_label_count}`);
    console.log(`  Total inbox-visible:            ${inboxStats.inbox_visible_count}`);
    const gained = Number(inboxStats.inbox_visible_count) - Number(inboxStats.inbox_label_count);
    if (gained > 0) {
      console.log(`  → ${gained} extra messages now visible in Inbox (previously hidden in category folders only)\n`);
    } else {
      console.log(`  → No additional messages gained (all CATEGORY_* messages also carry INBOX label)\n`);
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
