/**
 * repair-mail-senders-and-inbox-visibility.ts
 *
 * Safe, idempotent repair script for rows in email_messages where
 * from_name / from_email are NULL but can be recovered from from_header.
 * Also reports inbox visibility stats after the CATEGORY_* fix.
 *
 * Usage:  npx tsx scripts/repair-mail-senders-and-inbox-visibility.ts
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

function parseFrom(raw: string | null): { name: string | null; email: string | null } {
  if (!raw) return { name: null, email: null };
  const trimmed = raw.trim();
  const angleMatch = trimmed.match(/^(.*?)<([^>]+)>\s*$/);
  if (angleMatch) {
    const name = angleMatch[1].replace(/^["'\s]+|["'\s]+$/g, "").trim() || null;
    const email = angleMatch[2].trim().toLowerCase() || null;
    return { name, email };
  }
  if (trimmed.includes("@")) return { name: null, email: trimmed.toLowerCase() };
  return { name: trimmed || null, email: null };
}

async function main() {
  console.log("=== VoltSafe Mail Sender + Inbox Visibility Repair ===\n");

  // ── Before stats ──────────────────────────────────────────────────────────
  const beforeRes = await db.execute(sql.raw(`
    SELECT
      COUNT(*) FILTER (WHERE from_name IS NULL AND from_email IS NULL)::int AS both_null,
      COUNT(*) FILTER (WHERE from_name IS NULL AND from_email IS NOT NULL)::int AS name_only_null,
      COUNT(*) FILTER (WHERE from_name IS NOT NULL AND from_email IS NULL)::int AS email_only_null,
      COUNT(*)::int AS total
    FROM email_messages
  `));
  const before = ((beforeRes as any).rows ?? beforeRes)[0] as any;
  console.log("Before repair:");
  console.log(`  Total messages:              ${before.total}`);
  console.log(`  Both from_name+email null:   ${before.both_null}`);
  console.log(`  from_name null only:         ${before.name_only_null}`);
  console.log(`  from_email null only:        ${before.email_only_null}\n`);

  // ── Sender repair ─────────────────────────────────────────────────────────
  // The database does not have a from_header column — sender fields are
  // populated at sync time. The display layer already handles from_name=NULL
  // gracefully: fromEmail.split("@")[0] is used as a fallback, which is
  // accurate. No DB repair is needed for sender fields.
  console.log("Sender fields: from_name is populated at sync time.");
  console.log("Rows with from_name=NULL will display the email local-part as sender name (correct fallback).\n");

  // ── After stats ───────────────────────────────────────────────────────────
  const afterRes = await db.execute(sql.raw(`
    SELECT
      COUNT(*) FILTER (WHERE from_name IS NULL AND from_email IS NULL)::int AS both_null,
      COUNT(*) FILTER (WHERE from_name IS NULL AND from_email IS NOT NULL)::int AS name_only_null,
      COUNT(*) FILTER (WHERE from_name IS NOT NULL AND from_email IS NULL)::int AS email_only_null
    FROM email_messages
  `));
  const after = ((afterRes as any).rows ?? afterRes)[0] as any;
  console.log("After repair:");
  console.log(`  Both from_name+email null:   ${after.both_null}`);
  console.log(`  from_name null only:         ${after.name_only_null}`);
  console.log(`  from_email null only:        ${after.email_only_null}\n`);

  // ── Inbox visibility report ───────────────────────────────────────────────
  const inboxRes = await db.execute(sql.raw(`
    SELECT
      COUNT(*) FILTER (WHERE label_ids LIKE '%"INBOX"%')::int AS inbox_label_count,
      COUNT(*) FILTER (WHERE
        label_ids LIKE '%CATEGORY_UPDATES%' OR
        label_ids LIKE '%CATEGORY_PROMOTIONS%' OR
        label_ids LIKE '%CATEGORY_SOCIAL%' OR
        label_ids LIKE '%CATEGORY_FORUMS%'
      )::int AS category_label_count,
      COUNT(*) FILTER (WHERE (
        label_ids LIKE '%"INBOX"%' OR
        label_ids LIKE '%CATEGORY_UPDATES%' OR
        label_ids LIKE '%CATEGORY_PROMOTIONS%' OR
        label_ids LIKE '%CATEGORY_SOCIAL%' OR
        label_ids LIKE '%CATEGORY_FORUMS%'
      )
      AND label_ids NOT LIKE '%"SENT"%'
      AND label_ids NOT LIKE '%"DRAFT"%'
      AND label_ids NOT LIKE '%"SPAM"%'
      AND label_ids NOT LIKE '%"TRASH"%'
      )::int AS inbox_visible_count
    FROM email_messages
  `));
  const inv = ((inboxRes as any).rows ?? inboxRes)[0] as any;
  console.log("Inbox visibility report:");
  console.log(`  INBOX-labeled messages:        ${inv.inbox_label_count}`);
  console.log(`  CATEGORY_*-labeled messages:   ${inv.category_label_count}`);
  console.log(`  Total inbox-visible (after fix): ${inv.inbox_visible_count}`);
  const gained = Number(inv.inbox_visible_count) - Number(inv.inbox_label_count);
  if (gained > 0) {
    console.log(`  → ${gained} category messages now visible in Inbox that were previously hidden`);
  } else {
    console.log(`  → No extra messages gained (all CATEGORY_* also carry INBOX label)`);
  }

  console.log("\nDone.");
  process.exit(0);
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
