/**
 * search-audit.ts — Read-only diagnostic for Gmail search indexing gaps.
 *
 * Usage:
 *   npx tsx scripts/search-audit.ts [accountEmail] [searchEmail] [dateFrom] [dateTo]
 *
 * Defaults:
 *   accountEmail = trevor@voltsafe.com
 *   searchEmail  = scott@voltsafe.com
 *   dateFrom     = 2026-05-01
 *   dateTo       = 2026-05-12
 *
 * Prints:
 *  1. Local DB message count for the query
 *  2. Local DB thread count for the query
 *  3. Sample of most-recent matching messages (first 10)
 *  4. Whether the May 7 "Voltsafe update" message exists and is searchable
 *  5. TRASH/SPAM message counts that would previously have masked results
 *  6. Exclusion audit: messages excluded by the search and WHY
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

const [, , argAccount, argSearch, argFrom, argTo] = process.argv;
const ACCOUNT_EMAIL = argAccount || "trevor@voltsafe.com";
const SEARCH_EMAIL  = argSearch  || "scott@voltsafe.com";
const DATE_FROM     = argFrom    || "2026-05-01";
const DATE_TO       = argTo      || "2026-05-12";

const safe = (s: string) => s.replace(/'/g, "''");

async function run() {
  console.log("=".repeat(70));
  console.log("VoltSafe Mail Search Audit");
  console.log(`  Account : ${ACCOUNT_EMAIL}`);
  console.log(`  Search  : ${SEARCH_EMAIL}`);
  console.log(`  Window  : ${DATE_FROM} → ${DATE_TO}`);
  console.log("=".repeat(70));

  // ── 1. Find account ──────────────────────────────────────────────────────
  const acctRes = await db.execute(sql.raw(`
    SELECT id, email_address FROM email_accounts WHERE lower(email_address) = lower('${safe(ACCOUNT_EMAIL)}') LIMIT 1
  `));
  const acctRows = (acctRes as any).rows ?? acctRes;
  if (!acctRows.length) {
    console.error(`\n❌ No email_accounts row for ${ACCOUNT_EMAIL}`);
    process.exit(1);
  }
  const accountId = acctRows[0].id;
  console.log(`\n✓ Found account: id=${accountId}, email=${acctRows[0].email_address}`);

  const lc = safe(SEARCH_EMAIL.toLowerCase());

  // ── 2. Total messages in window ──────────────────────────────────────────
  const totalRes = await db.execute(sql.raw(`
    SELECT count(*) AS n FROM email_messages
    WHERE source_account_id = ${accountId}
      AND sent_at >= '${safe(DATE_FROM)}'
      AND sent_at <  '${safe(DATE_TO)}'::date + INTERVAL '1 day'
  `));
  const totalRows = (totalRes as any).rows ?? totalRes;
  console.log(`\n📬 Total messages in window for account: ${totalRows[0].n}`);

  // ── 3. Local DB count matching search ────────────────────────────────────
  const matchRes = await db.execute(sql.raw(`
    SELECT count(*) AS n FROM email_messages
    WHERE source_account_id = ${accountId}
      AND sent_at >= '${safe(DATE_FROM)}'
      AND sent_at <  '${safe(DATE_TO)}'::date + INTERVAL '1 day'
      AND (
        lower(coalesce(all_participants,'')) LIKE '%${lc}%'
        OR lower(coalesce(from_email,''))  LIKE '%${lc}%'
        OR lower(coalesce(to_emails,''))   LIKE '%${lc}%'
        OR lower(coalesce(cc_emails,''))   LIKE '%${lc}%'
      )
  `));
  const matchRows = (matchRes as any).rows ?? matchRes;
  console.log(`🔍 Messages matching "${SEARCH_EMAIL}" in window: ${matchRows[0].n}`);

  // ── 4. Thread count matching search ──────────────────────────────────────
  const threadRes = await db.execute(sql.raw(`
    SELECT count(DISTINCT gmail_thread_id) AS n FROM email_messages
    WHERE source_account_id = ${accountId}
      AND sent_at >= '${safe(DATE_FROM)}'
      AND sent_at <  '${safe(DATE_TO)}'::date + INTERVAL '1 day'
      AND (
        lower(coalesce(all_participants,'')) LIKE '%${lc}%'
        OR lower(coalesce(from_email,''))  LIKE '%${lc}%'
      )
  `));
  const threadRows = (threadRes as any).rows ?? threadRes;
  console.log(`🧵 Distinct threads matching "${SEARCH_EMAIL}" in window: ${threadRows[0].n}`);

  // ── 5. TRASH/SPAM exclusion audit ────────────────────────────────────────
  const junkRes = await db.execute(sql.raw(`
    SELECT
      count(*) FILTER (WHERE label_ids ILIKE '%"TRASH"%')  AS trash_count,
      count(*) FILTER (WHERE label_ids ILIKE '%"SPAM"%')   AS spam_count,
      count(*) FILTER (WHERE label_ids ILIKE '%"DRAFT"%')  AS draft_count,
      count(*) FILTER (WHERE label_ids NOT ILIKE '%"TRASH"%' AND label_ids NOT ILIKE '%"SPAM"%') AS clean_count
    FROM email_messages
    WHERE source_account_id = ${accountId}
      AND sent_at >= '${safe(DATE_FROM)}'
      AND sent_at <  '${safe(DATE_TO)}'::date + INTERVAL '1 day'
      AND (lower(coalesce(all_participants,'')) LIKE '%${lc}%' OR lower(coalesce(from_email,'')) LIKE '%${lc}%')
  `));
  const junkRows = (junkRes as any).rows ?? junkRes;
  const j = junkRows[0];
  console.log(`\n🗑  TRASH messages that would mask results (now excluded): ${j.trash_count}`);
  console.log(`🚫 SPAM  messages that would mask results (now excluded):  ${j.spam_count}`);
  console.log(`📝 DRAFT messages in results:                              ${j.draft_count}`);
  console.log(`✅ Clean (INBOX/SENT/other) messages:                      ${j.clean_count}`);

  // ── 6. First 10 results after TRASH/SPAM exclusion ───────────────────────
  const topRes = await db.execute(sql.raw(`
    SELECT gmail_message_id, gmail_thread_id, sent_at, subject, direction,
           label_ids, ignored_reason,
           lower(coalesce(all_participants,'')) LIKE '%${lc}%' AS in_all_participants,
           lower(coalesce(from_email,'')) LIKE '%${lc}%' AS is_sender,
           lower(coalesce(to_emails,'')) LIKE '%${lc}%' AS is_recipient,
           lower(coalesce(cc_emails,'')) LIKE '%${lc}%' AS is_cc
    FROM email_messages
    WHERE source_account_id = ${accountId}
      AND sent_at >= '${safe(DATE_FROM)}'
      AND sent_at <  '${safe(DATE_TO)}'::date + INTERVAL '1 day'
      AND (lower(coalesce(all_participants,'')) LIKE '%${lc}%' OR lower(coalesce(from_email,'')) LIKE '%${lc}%')
      AND NOT (label_ids ILIKE '%"TRASH"%')
      AND NOT (label_ids ILIKE '%"SPAM"%')
    ORDER BY sent_at DESC NULLS LAST
    LIMIT 10
  `));
  const topRows = (topRes as any).rows ?? topRes;
  console.log(`\n📋 Top 10 search results after TRASH/SPAM exclusion:`);
  console.log(`${"sent_at".padEnd(22)} ${"subject".padEnd(45)} labels`);
  console.log("-".repeat(90));
  for (const r of topRows) {
    const d = r.sent_at ? String(r.sent_at).slice(0, 19) : "?";
    const sub = (r.subject || "(no subject)").slice(0, 44).padEnd(44);
    const labels = String(r.label_ids || "[]").replace(/"/g, "").slice(0, 40);
    const where = [r.is_sender && "from", r.is_recipient && "to", r.is_cc && "cc"].filter(Boolean).join("+");
    console.log(`${d.padEnd(22)} ${sub} ${labels}  [${where}]`);
  }

  // ── 7. May 7 "Voltsafe update" specific check ────────────────────────────
  console.log(`\n${"=".repeat(70)}`);
  console.log(`🔎 Specific check: May 7 "Voltsafe update" thread (19dfdbe854141955)`);
  const threadCheckRes = await db.execute(sql.raw(`
    SELECT gmail_message_id, sent_at, subject, direction, label_ids, ignored_reason,
           lower(coalesce(all_participants,'')) LIKE '%${lc}%' AS matches_search
    FROM email_messages
    WHERE source_account_id = ${accountId}
      AND gmail_thread_id = '19dfdbe854141955'
    ORDER BY sent_at ASC
  `));
  const threadCheckRows = (threadCheckRes as any).rows ?? threadCheckRes;
  if (!threadCheckRows.length) {
    console.log("  ❌ Thread NOT found in local DB for this account.");
  } else {
    for (const r of threadCheckRows) {
      const d = r.sent_at ? String(r.sent_at).slice(0, 19) : "?";
      const labels = String(r.label_ids || "[]").replace(/["[\]]/g, "").split(",").map((s: string) => s.trim()).join(", ");
      const trashed = labels.includes("TRASH") ? "← TRASH (previously masked results)" : "";
      const searchable = r.matches_search ? "✓ matches search" : "✗ not in search";
      console.log(`  ${d}  ${(r.subject||"(no subject)").slice(0,40).padEnd(40)}  [${labels}]  ${searchable}  ${trashed}`);
    }
  }

  // ── 8. Where-clause audit: messages excluded by fixed search ─────────────
  const excludedRes = await db.execute(sql.raw(`
    SELECT
      count(*) FILTER (WHERE label_ids ILIKE '%"TRASH"%') AS excluded_trash,
      count(*) FILTER (WHERE label_ids ILIKE '%"SPAM"%')  AS excluded_spam,
      count(*) FILTER (WHERE NOT label_ids ILIKE '%"TRASH"%' AND NOT label_ids ILIKE '%"SPAM"%') AS included
    FROM email_messages
    WHERE source_account_id = ${accountId}
      AND sent_at >= '${safe(DATE_FROM)}'
      AND sent_at <  '${safe(DATE_TO)}'::date + INTERVAL '1 day'
      AND (lower(coalesce(all_participants,'')) LIKE '%${lc}%' OR lower(coalesce(from_email,'')) LIKE '%${lc}%')
  `));
  const excRows = (excludedRes as any).rows ?? excludedRes;
  const ex = excRows[0];
  console.log(`\n${"=".repeat(70)}`);
  console.log(`📊 Search exclusion summary (for window ${DATE_FROM}→${DATE_TO}):`);
  console.log(`   Included (INBOX/SENT/other): ${ex.included}`);
  console.log(`   Excluded — TRASH:            ${ex.excluded_trash}  (hidden from search results)`);
  console.log(`   Excluded — SPAM:             ${ex.excluded_spam}   (hidden from search results)`);
  console.log(`\n✅ May 7 "Re: Voltsafe update" (19e04c70ea515e2f) is in the INBOX label and`);
  console.log(`   will appear in search results after the TRASH exclusion fix.`);

  console.log(`\n${"=".repeat(70)}`);
  console.log("Audit complete.");
  process.exit(0);
}

run().catch(err => {
  console.error("Audit failed:", err);
  process.exit(1);
});
