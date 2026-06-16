#!/usr/bin/env npx tsx
/**
 * Inbox Count Reconciliation
 * ==========================
 * Validates that inbox category counts are internally consistent.
 *
 * Invariant: People + Updates + Promotions + Social + Forums === Inbox unread
 *            (delta must be 0)
 *
 * Also checks:
 *   • missing_inbox_unread === 0  (no CATEGORY_* messages silently missing INBOX)
 *   • multi_category === 0        (no message carries two CATEGORY_* labels)
 *
 * Priority (starred) is an OVERLAY — those messages are counted INSIDE
 * People/Updates/etc and are NOT part of the additive bucket sum.
 *
 * CRM Review is a UI-only tab (auto-association review). Its messages are
 * fully counted inside People/Updates/etc and have no separate label.
 *
 * Run: npx tsx scripts/inbox-count-reconciliation.ts
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function run() {
  console.log("[reconcile] Running inbox count reconciliation…");

  const rows = await db.execute(sql.raw(`
    SELECT
      COUNT(*) FILTER (WHERE label_ids LIKE '%"INBOX"%' AND label_ids LIKE '%"UNREAD"%')::int AS inbox_unread,
      COUNT(*) FILTER (WHERE label_ids LIKE '%"INBOX"%' AND label_ids LIKE '%"UNREAD"%'
                         AND label_ids NOT ILIKE '%CATEGORY_UPDATES%'
                         AND label_ids NOT ILIKE '%CATEGORY_PROMOTIONS%'
                         AND label_ids NOT ILIKE '%CATEGORY_SOCIAL%'
                         AND label_ids NOT ILIKE '%CATEGORY_FORUMS%')::int AS people_unread,
      COUNT(*) FILTER (WHERE label_ids ILIKE '%CATEGORY_UPDATES%'    AND label_ids LIKE '%"INBOX"%' AND label_ids LIKE '%"UNREAD"%')::int AS updates_unread,
      COUNT(*) FILTER (WHERE label_ids ILIKE '%CATEGORY_PROMOTIONS%' AND label_ids LIKE '%"INBOX"%' AND label_ids LIKE '%"UNREAD"%')::int AS promotions_unread,
      COUNT(*) FILTER (WHERE label_ids ILIKE '%CATEGORY_SOCIAL%'     AND label_ids LIKE '%"INBOX"%' AND label_ids LIKE '%"UNREAD"%')::int AS social_unread,
      COUNT(*) FILTER (WHERE label_ids ILIKE '%CATEGORY_FORUMS%'     AND label_ids LIKE '%"INBOX"%' AND label_ids LIKE '%"UNREAD"%')::int AS forums_unread,
      COUNT(*) FILTER (WHERE label_ids LIKE '%"STARRED"%' AND label_ids LIKE '%"INBOX"%' AND label_ids LIKE '%"UNREAD"%')::int            AS priority_unread,
      COUNT(*) FILTER (WHERE label_ids LIKE '%"UNREAD"%'
                         AND label_ids NOT LIKE '%"INBOX"%'
                         AND label_ids NOT LIKE '%"SENT"%'
                         AND label_ids NOT LIKE '%"DRAFT"%'
                         AND label_ids NOT ILIKE '%SPAM%'
                         AND label_ids NOT ILIKE '%TRASH%'
                         AND (label_ids ILIKE '%CATEGORY_UPDATES%'
                           OR label_ids ILIKE '%CATEGORY_PROMOTIONS%'
                           OR label_ids ILIKE '%CATEGORY_SOCIAL%'
                           OR label_ids ILIKE '%CATEGORY_FORUMS%'))::int AS missing_inbox_unread,
      COUNT(DISTINCT gmail_thread_id) FILTER (WHERE label_ids LIKE '%"INBOX"%' AND label_ids LIKE '%"UNREAD"%')::int AS inbox_unread_threads,
      COUNT(DISTINCT gmail_thread_id) FILTER (WHERE label_ids LIKE '%"INBOX"%' AND label_ids LIKE '%"UNREAD"%'
                         AND label_ids NOT ILIKE '%CATEGORY_UPDATES%'
                         AND label_ids NOT ILIKE '%CATEGORY_PROMOTIONS%'
                         AND label_ids NOT ILIKE '%CATEGORY_SOCIAL%'
                         AND label_ids NOT ILIKE '%CATEGORY_FORUMS%')::int AS people_unread_threads,
      COUNT(DISTINCT gmail_thread_id) FILTER (WHERE label_ids ILIKE '%CATEGORY_UPDATES%'    AND label_ids LIKE '%"INBOX"%' AND label_ids LIKE '%"UNREAD"%')::int AS updates_unread_threads,
      COUNT(DISTINCT gmail_thread_id) FILTER (WHERE label_ids ILIKE '%CATEGORY_PROMOTIONS%' AND label_ids LIKE '%"INBOX"%' AND label_ids LIKE '%"UNREAD"%')::int AS promotions_unread_threads,
      COUNT(DISTINCT gmail_thread_id) FILTER (WHERE label_ids ILIKE '%CATEGORY_SOCIAL%'     AND label_ids LIKE '%"INBOX"%' AND label_ids LIKE '%"UNREAD"%')::int AS social_unread_threads,
      COUNT(DISTINCT gmail_thread_id) FILTER (WHERE label_ids ILIKE '%CATEGORY_FORUMS%'     AND label_ids LIKE '%"INBOX"%' AND label_ids LIKE '%"UNREAD"%')::int AS forums_unread_threads
    FROM email_messages
    WHERE label_ids NOT ILIKE '%TRASH%'
      AND label_ids NOT ILIKE '%SPAM%'
      AND label_ids NOT ILIKE '%DRAFT%'
  `));

  const driftRows = await db.execute(sql.raw(`
    SELECT COUNT(*)::int AS multi_category
    FROM email_messages
    WHERE label_ids NOT ILIKE '%TRASH%'
      AND label_ids NOT ILIKE '%SPAM%'
      AND (
        (CASE WHEN label_ids ILIKE '%CATEGORY_UPDATES%'    THEN 1 ELSE 0 END) +
        (CASE WHEN label_ids ILIKE '%CATEGORY_PROMOTIONS%' THEN 1 ELSE 0 END) +
        (CASE WHEN label_ids ILIKE '%CATEGORY_SOCIAL%'     THEN 1 ELSE 0 END) +
        (CASE WHEN label_ids ILIKE '%CATEGORY_FORUMS%'     THEN 1 ELSE 0 END)
      ) > 1
  `));

  const r:  any = (rows      as any).rows?.[0] ?? (rows      as any)[0] ?? {};
  const rd: any = (driftRows as any).rows?.[0] ?? (driftRows as any)[0] ?? {};

  const p  = +r.people_unread     || 0;
  const u  = +r.updates_unread    || 0;
  const pr = +r.promotions_unread || 0;
  const s  = +r.social_unread     || 0;
  const f  = +r.forums_unread     || 0;
  const bucketSum = p + u + pr + s + f;
  const delta = (+r.inbox_unread || 0) - bucketSum;

  console.log("");
  console.log("=== INBOX COUNT RECONCILIATION REPORT ===");
  console.log("Unit: raw messages (sidebar badges count messages, not threads)");
  console.log("");
  console.log("--- Message counts ---");
  console.log(`inbox_unread:              ${r.inbox_unread}`);
  console.log(`  people_unread:           ${r.people_unread}  (INBOX + no CATEGORY_*)`);
  console.log(`  updates_unread:          ${r.updates_unread}  (INBOX + CATEGORY_UPDATES)`);
  console.log(`  promotions_unread:       ${r.promotions_unread}  (INBOX + CATEGORY_PROMOTIONS)`);
  console.log(`  social_unread:           ${r.social_unread}  (INBOX + CATEGORY_SOCIAL)`);
  console.log(`  forums_unread:           ${r.forums_unread}  (INBOX + CATEGORY_FORUMS)`);
  console.log(`  bucket_sum:              ${bucketSum}`);
  console.log(`  DELTA (inbox - sum):     ${delta}  ← must be 0`);
  console.log(`  priority_unread:         ${r.priority_unread}  (starred overlay, NOT additive)`);
  console.log("");
  console.log("--- Thread counts (reference only) ---");
  console.log(`inbox_threads:             ${r.inbox_unread_threads}`);
  console.log(`  people_threads:          ${r.people_unread_threads}`);
  console.log(`  updates_threads:         ${r.updates_unread_threads}`);
  console.log(`  promotions_threads:      ${r.promotions_unread_threads}`);
  console.log(`  social_threads:          ${r.social_unread_threads}`);
  console.log(`  forums_threads:          ${r.forums_unread_threads}`);
  console.log("");
  console.log("--- Drift checks ---");
  console.log(`missing_inbox_unread:      ${r.missing_inbox_unread}  ← must be 0`);
  console.log(`multi_category:            ${rd.multi_category}  ← must be 0`);
  console.log("");

  const ok = delta === 0 && (+r.missing_inbox_unread || 0) === 0 && (+rd.multi_category || 0) === 0;
  if (ok) {
    console.log("[reconcile] ✅ PASS — People + Updates + Promotions + Social + Forums === Inbox unread");
    console.log("[reconcile] ✅ PASS — no missing INBOX labels, no multi-category drift");
  } else {
    if (delta !== 0)                          console.error(`[reconcile] ❌ FAIL — delta is ${delta}, not 0`);
    if (+r.missing_inbox_unread || 0)         console.error(`[reconcile] ❌ FAIL — ${r.missing_inbox_unread} unread category messages missing INBOX label`);
    if (+rd.multi_category || 0)              console.error(`[reconcile] ❌ FAIL — ${rd.multi_category} messages carry multiple CATEGORY_* labels`);
  }
  process.exit(ok ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
