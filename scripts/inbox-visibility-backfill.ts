#!/usr/bin/env npx tsx
/**
 * Inbox Visibility Backfill (v2 — durable)
 * ==========================================
 * Idempotent one-time script that restores the INBOX label for unread inbound
 * emails that Gmail delivered directly to a CATEGORY_* tab without INBOX.
 *
 * Scope: UNREAD CATEGORY_(UPDATES|PROMOTIONS|SOCIAL|FORUMS) messages without INBOX.
 *   - Excludes CATEGORY_PERSONAL (user may have intentionally skipped inbox).
 *   - Excludes SPAM / TRASH / SENT / DRAFT.
 *   - Excludes read messages (user already saw and archived them).
 *
 * Two-layer durability:
 *   1. Local DB   — appends INBOX to label_ids immediately.
 *   2. Gmail API  — calls threads.modify({addLabelIds:["INBOX"]}) so future
 *                   incremental syncs get the INBOX label from Gmail directly.
 *                   If the API call fails for any thread it is logged and skipped;
 *                   the sync-layer guard in gmail-incremental.ts ensures the local
 *                   INBOX label is not stripped for unread categorized messages.
 *
 * Run: npx tsx scripts/inbox-visibility-backfill.ts
 */
import { db } from "../server/db";
import { emailAccounts } from "../shared/schema";
import { sql } from "drizzle-orm";

async function run() {
  console.log("[inbox-backfill] Starting inbox visibility backfill (v2 — with Gmail write-back)…");

  // ── 1. Find all affected messages ──────────────────────────────────────────
  const findResult = await db.execute(sql.raw(`
    SELECT m.id, m.label_ids, m.gmail_message_id, m.gmail_thread_id,
           m.source_account_id
    FROM email_messages m
    WHERE
      m.label_ids NOT ILIKE '%"INBOX"%' AND m.label_ids NOT ILIKE '%INBOX%'
      AND (
        m.label_ids ILIKE '%CATEGORY_UPDATES%'
        OR m.label_ids ILIKE '%CATEGORY_PROMOTIONS%'
        OR m.label_ids ILIKE '%CATEGORY_SOCIAL%'
        OR m.label_ids ILIKE '%CATEGORY_FORUMS%'
      )
      AND m.label_ids NOT ILIKE '%"SPAM"%'
      AND m.label_ids NOT ILIKE '%"TRASH"%'
      AND m.label_ids NOT ILIKE '%"DRAFT"%'
      AND m.label_ids NOT ILIKE '%"SENT"%'
      AND m.label_ids ILIKE '%UNREAD%'
    ORDER BY m.source_account_id, m.gmail_thread_id, m.id
  `));

  type Row = { id: number; label_ids: string; gmail_message_id: string; gmail_thread_id: string; source_account_id: number };
  const rows = ((findResult as any).rows ?? findResult) as Row[];
  console.log(`[inbox-backfill] Found ${rows.length} unread inbound category-only messages to repair`);

  if (rows.length === 0) {
    console.log("[inbox-backfill] Nothing to do — all inbox-eligible messages already have INBOX.");
    return;
  }

  // ── 2. Repair local DB ─────────────────────────────────────────────────────
  let localFixed = 0;
  let localSkipped = 0;
  let localErrors = 0;

  for (const row of rows) {
    try {
      let labels: string[];
      try {
        labels = JSON.parse(row.label_ids || "[]");
      } catch {
        console.warn(`[inbox-backfill] Skipping id=${row.id}: invalid JSON label_ids`);
        localSkipped++;
        continue;
      }

      if (labels.some((l: string) => l.toUpperCase() === "INBOX")) {
        localSkipped++;
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

      localFixed++;
    } catch (err: any) {
      console.error(`[inbox-backfill] DB error id=${row.id}:`, err.message);
      localErrors++;
    }
  }

  console.log(`[inbox-backfill] Local DB repair done. fixed=${localFixed} skipped=${localSkipped} errors=${localErrors}`);

  // ── 3. Gmail API write-back — add INBOX in Gmail per account/thread ─────────
  // Group by (source_account_id, gmail_thread_id) to minimise API calls.
  // Each thread.modify adds INBOX once regardless of how many messages in thread.
  const threadsByAccount = new Map<number, Set<string>>();
  for (const row of rows) {
    if (!row.gmail_thread_id || !row.source_account_id) continue;
    if (!threadsByAccount.has(row.source_account_id)) {
      threadsByAccount.set(row.source_account_id, new Set());
    }
    threadsByAccount.get(row.source_account_id)!.add(row.gmail_thread_id);
  }

  // Load all relevant email accounts once.
  const accountRows = await db.execute(sql.raw(`
    SELECT id, user_id FROM email_accounts
    WHERE id IN (${[...threadsByAccount.keys()].join(",")})
  `));
  type AccountRow = { id: number; user_id: number };
  const accounts = ((accountRows as any).rows ?? accountRows) as AccountRow[];

  let gmailFixed = 0;
  let gmailErrors = 0;
  let gmailSkipped = 0;

  for (const acct of accounts) {
    const threadIds = [...(threadsByAccount.get(acct.id) ?? [])];
    if (threadIds.length === 0) continue;

    let gmailClient: any;
    try {
      const { getGmailClient } = await import("../server/gmail-oauth");
      gmailClient = await getGmailClient(acct.user_id, acct.id);
    } catch (err: any) {
      console.warn(`[inbox-backfill] Cannot get Gmail client for account ${acct.id}: ${err.message} — skipping Gmail write-back for this account`);
      gmailSkipped += threadIds.length;
      continue;
    }

    for (const threadId of threadIds) {
      try {
        await gmailClient.users.threads.modify({
          userId: "me",
          id: threadId,
          requestBody: { addLabelIds: ["INBOX"] },
        });
        gmailFixed++;
      } catch (err: any) {
        // 404 = thread deleted in Gmail, 400 = invalid thread — both non-fatal.
        // The sync-layer guard (Part A) ensures local INBOX is preserved anyway.
        console.warn(`[inbox-backfill] Gmail threads.modify failed for thread=${threadId}: ${err.message}`);
        gmailErrors++;
      }
    }

    console.log(`[inbox-backfill] Account ${acct.id}: attempted Gmail write-back for ${threadIds.length} threads`);
  }

  console.log(`[inbox-backfill] Gmail write-back done. threads_added=${gmailFixed} errors=${gmailErrors} skipped=${gmailSkipped}`);

  // ── 4. Verify local DB is clean ────────────────────────────────────────────
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
