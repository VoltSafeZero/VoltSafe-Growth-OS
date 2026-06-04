/**
 * backfill-sender-names.ts
 *
 * Idempotent script to fill in missing from_name values for email_messages
 * rows where from_name IS NULL but from_email IS NOT NULL and a
 * gmail_message_id is available for a live API lookup.
 *
 * Strategy:
 *   1. Cross-reference pass (zero API calls) — fills from_name by finding
 *      the most-frequent name used for the same from_email address across
 *      all sibling rows in the DB.
 *   2. For rows still null after that, snapshot ALL candidate IDs upfront
 *      (one query), then process them in batches via Gmail messages.get with
 *      format=metadata — the lightest possible API request.
 *      Each message is attempted exactly once per run regardless of outcome.
 *   3. Rows belonging to accounts with no refresh token are skipped and
 *      reported.
 *
 * Usage:
 *   npx tsx scripts/backfill-sender-names.ts
 *
 * Env vars (all optional):
 *   BACKFILL_BATCH_SIZE   messages per processing batch (default 100)
 *   BACKFILL_SLEEP_MS     ms delay between individual API calls (default 80)
 *
 * Safe to re-run — only touches rows where from_name IS NULL.
 */

import { db } from "../server/db";
import { emailMessages, emailAccounts } from "../shared/schema";
import { eq, and, isNull, isNotNull, sql, inArray } from "drizzle-orm";
import { getGmailClient } from "../server/gmail-oauth";
import { parseEmailAddress } from "../server/services/email-parser";

const BATCH_SIZE = Number(process.env.BACKFILL_BATCH_SIZE || 100);
const SLEEP_MS   = Number(process.env.BACKFILL_SLEEP_MS   || 80);

let stopRequested = false;
process.on("SIGTERM", () => { console.log("[signal] SIGTERM — will stop after current message"); stopRequested = true; });
process.on("SIGINT",  () => { console.log("[signal] SIGINT — will stop after current message");  stopRequested = true; });

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function countNull(): Promise<number> {
  const r = await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM email_messages
    WHERE from_name IS NULL AND from_email IS NOT NULL
  `);
  return Number((r as any).rows?.[0]?.n ?? 0);
}

async function crossReferencePass(): Promise<number> {
  const r = await db.execute(sql`
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
  return Number((r as any).rowCount ?? 0);
}

async function processAccount(
  accountId: number,
  emailAddress: string,
  userId: number,
): Promise<{ updated: number; noName: number; failed: number }> {
  const stats = { updated: 0, noName: 0, failed: 0 };

  // Snapshot ALL candidate IDs for this account in one query.
  // Processing from this fixed list ensures each message is attempted
  // exactly once per run — messages that return no name or fail are NOT
  // re-queried in subsequent iterations.
  const candidateRows = await db
    .select({ id: emailMessages.id, gmailId: emailMessages.gmailMessageId })
    .from(emailMessages)
    .where(and(
      eq(emailMessages.sourceAccountId, accountId),
      isNull(emailMessages.fromName),
      isNotNull(emailMessages.fromEmail),
      isNotNull(emailMessages.gmailMessageId),
    ));

  if (candidateRows.length === 0) {
    console.log(`[account ${accountId}] ${emailAddress} — no null rows, skipping`);
    return stats;
  }

  console.log(`\n[account ${accountId}] ${emailAddress} — ${candidateRows.length} rows to process`);

  let gmail;
  try {
    gmail = await getGmailClient(userId, accountId);
  } catch (e: any) {
    console.error(`[account ${accountId}] cannot get Gmail client: ${e.message} — skipping account`);
    return stats;
  }

  // Process in BATCH_SIZE chunks, refreshing the gmail client each batch
  // so the access token is renewed if needed for long runs.
  for (let offset = 0; offset < candidateRows.length; offset += BATCH_SIZE) {
    if (stopRequested) {
      console.log(`[account ${accountId}] stop requested — processed ${offset}/${candidateRows.length}`);
      break;
    }

    // Refresh gmail client per batch (token may expire during long runs)
    try {
      gmail = await getGmailClient(userId, accountId);
    } catch (e: any) {
      console.error(`[account ${accountId}] token refresh failed at offset ${offset}: ${e.message}`);
      break;
    }

    const batch = candidateRows.slice(offset, offset + BATCH_SIZE);
    let bUpdated = 0, bNoName = 0, bFailed = 0;

    for (const row of batch) {
      if (stopRequested) break;
      if (!row.gmailId) { bNoName++; continue; }

      try {
        const res = await gmail.users.messages.get({
          userId: "me",
          id: row.gmailId,
          format: "metadata",
          metadataHeaders: ["From"],
        });
        const headers: { name: string; value: string }[] =
          res.data?.payload?.headers ?? [];
        const fromRaw =
          headers.find(h => h.name.toLowerCase() === "from")?.value ?? "";
        const { name: fromName } = parseEmailAddress(fromRaw);

        if (fromName) {
          await db
            .update(emailMessages)
            .set({ fromName })
            .where(eq(emailMessages.id, row.id));
          bUpdated++;
        } else {
          // Sender genuinely has no display name — leave null, do not retry
          bNoName++;
        }
      } catch (e: any) {
        bFailed++;
        const msg = (e?.message || "").substring(0, 120);
        console.error(`[account ${accountId}] msg=${row.gmailId}: ${msg}`);
        if (/rate|quota|429|503/i.test(msg)) {
          console.log(`[account ${accountId}] rate-limit — sleeping 30s`);
          await sleep(30_000);
        }
      }

      await sleep(SLEEP_MS);
    }

    stats.updated += bUpdated;
    stats.noName  += bNoName;
    stats.failed  += bFailed;

    const done = Math.min(offset + BATCH_SIZE, candidateRows.length);
    console.log(
      `[account ${accountId}] batch processed=${done}/${candidateRows.length} ` +
      `updated=${bUpdated} no-name=${bNoName} failed=${bFailed} | ` +
      `totals: updated=${stats.updated} no-name=${stats.noName} failed=${stats.failed}`,
    );
  }

  return stats;
}

async function main() {
  const startedAt = Date.now();
  console.log("=== VoltSafe Sender Name Backfill ===");
  console.log(`Settings: batch=${BATCH_SIZE} sleep=${SLEEP_MS}ms\n`);

  const nullBefore = await countNull();
  console.log(`Before pass: ${nullBefore} rows with from_name IS NULL\n`);

  // ── 1. Cross-reference pass (free — no API calls) ─────────────────────────
  console.log("Step 1: cross-reference pass (fill names from sibling rows)...");
  const xrefCount = await crossReferencePass();
  const nullAfterXref = await countNull();
  console.log(`  Filled ${xrefCount} rows via cross-reference`);
  console.log(`  Remaining after cross-reference: ${nullAfterXref}\n`);

  if (nullAfterXref === 0) {
    console.log("All sender names filled — no Gmail API calls needed.");
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`\nDone in ${elapsed}s.`);
    return;
  }

  // ── 2. Load active accounts with tokens ──────────────────────────────────
  console.log("Step 2: Gmail API lookups for remaining null rows...");
  const accounts = await db
    .select({
      id: emailAccounts.id,
      emailAddress: emailAccounts.emailAddress,
      userId: emailAccounts.userId,
    })
    .from(emailAccounts)
    .where(and(eq(emailAccounts.isActive, true), isNotNull(emailAccounts.refreshToken)));

  const activeIds = accounts.map(a => a.id);
  console.log(
    `  Accounts with active tokens: ${accounts.map(a => `${a.id}(${a.emailAddress})`).join(", ") || "none"}\n`,
  );

  // Warn about affected rows whose account has no token
  if (activeIds.length > 0) {
    const orphanCheck = await db.execute(sql`
      SELECT source_account_id, COUNT(*)::int AS n
      FROM email_messages
      WHERE from_name IS NULL
        AND from_email IS NOT NULL
        AND gmail_message_id IS NOT NULL
        AND source_account_id NOT IN (${sql.raw(activeIds.join(","))})
      GROUP BY source_account_id
    `);
    const orphanRows: any[] = (orphanCheck as any).rows ?? [];
    for (const row of orphanRows) {
      console.warn(
        `  [warn] account_id=${row.source_account_id} has ${row.n} null rows but NO active token ` +
        `— skipping (account may be deleted or disconnected)`,
      );
    }
    if (orphanRows.length > 0) console.log();
  }

  // ── 3. Per-account API backfill ───────────────────────────────────────────
  const globalStats = { updated: 0, noName: 0, failed: 0 };

  for (const acct of accounts) {
    if (stopRequested) break;
    const s = await processAccount(acct.id, acct.emailAddress, acct.userId);
    globalStats.updated += s.updated;
    globalStats.noName  += s.noName;
    globalStats.failed  += s.failed;
  }

  // ── 4. Final report ───────────────────────────────────────────────────────
  const nullAfter = await countNull();
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log(`\n========== FINAL REPORT ==========`);
  console.log(`runtime                 : ${elapsed}s`);
  console.log(`null rows before        : ${nullBefore}`);
  console.log(`filled by cross-ref     : ${xrefCount}`);
  console.log(`filled by Gmail API     : ${globalStats.updated}`);
  console.log(`no display name in API  : ${globalStats.noName}`);
  console.log(`failed API calls        : ${globalStats.failed}`);
  console.log(`null rows after         : ${nullAfter}`);
  if (nullAfter === 0) {
    console.log(`result                  : ✓ all sender names recovered`);
  } else {
    console.log(
      `result                  : ${nullAfter} rows remain null ` +
      `(confirmed bare-address senders or disconnected accounts)`,
    );
  }
  console.log(`==================================`);

  process.exit(stopRequested ? 130 : 0);
}

main().catch(e => {
  console.error("[fatal]", e.message ?? e);
  process.exit(1);
});
