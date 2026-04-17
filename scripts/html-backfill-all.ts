import { db } from "../server/db";
import { emailMessages, emailAccounts } from "../shared/schema";
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import { getGmailClient } from "../server/gmail-oauth";
import { parseGmailMessage } from "../server/services/email-parser";

const ACCOUNT_ID = Number(process.env.HTML_BACKFILL_ACCOUNT_ID || 1);
const BATCH_SIZE = Number(process.env.HTML_BACKFILL_BATCH || 200);
const SLEEP_MS = Number(process.env.HTML_BACKFILL_SLEEP_MS || 120);
const MAX_RUNTIME_MS = Number(process.env.HTML_BACKFILL_MAX_MINUTES || 0) * 60_000;

let stopRequested = false;
process.on("SIGTERM", () => { console.log("[signal] SIGTERM — finishing current batch then exiting"); stopRequested = true; });
process.on("SIGINT",  () => { console.log("[signal] SIGINT — finishing current batch then exiting"); stopRequested = true; });

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function countRemaining(): Promise<number> {
  const r = await db.execute(sql`
    SELECT count(*)::int AS n
    FROM email_messages
    WHERE source_account_id = ${ACCOUNT_ID} AND body_html IS NULL
  `);
  return Number((r as any).rows?.[0]?.n ?? 0);
}

async function countWithHtml(): Promise<number> {
  const r = await db.execute(sql`
    SELECT count(*)::int AS n
    FROM email_messages
    WHERE source_account_id = ${ACCOUNT_ID} AND body_html IS NOT NULL AND length(body_html) > 0
  `);
  return Number((r as any).rows?.[0]?.n ?? 0);
}

async function main() {
  const startedAt = Date.now();
  console.log(`[start] account=${ACCOUNT_ID} batch=${BATCH_SIZE} sleep=${SLEEP_MS}ms maxRuntime=${MAX_RUNTIME_MS || "unlimited"}ms`);

  const [acct] = await db.select().from(emailAccounts).where(eq(emailAccounts.id, ACCOUNT_ID));
  if (!acct) { console.error(`[fatal] no account with id=${ACCOUNT_ID}`); process.exit(1); }
  const myDomain = (acct.emailAddress.split("@")[1] || "").toLowerCase();

  const beforeWithHtml = await countWithHtml();
  const beforeRemaining = await countRemaining();
  console.log(`[before] withHtml=${beforeWithHtml} remaining(NULL)=${beforeRemaining}`);

  let totalProcessed = 0, totalUpdated = 0, totalNoHtml = 0, totalFailed = 0;
  const failedIds: string[] = [];
  let batchNum = 0;

  while (!stopRequested) {
    if (MAX_RUNTIME_MS && Date.now() - startedAt > MAX_RUNTIME_MS) {
      console.log(`[stop] hit max runtime (${MAX_RUNTIME_MS}ms)`);
      break;
    }

    // Re-fetch the gmail client every batch so token refresh is automatic
    let gmail;
    try {
      gmail = await getGmailClient(acct.userId, ACCOUNT_ID);
    } catch (e: any) {
      console.error(`[fatal] failed to get gmail client: ${e.message}`);
      break;
    }

    const rows = await db.select({ id: emailMessages.id, gmailId: emailMessages.gmailMessageId })
      .from(emailMessages)
      .where(and(eq(emailMessages.sourceAccountId, ACCOUNT_ID), isNull(emailMessages.bodyHtml)))
      .orderBy(desc(emailMessages.sentAt))
      .limit(BATCH_SIZE);

    if (rows.length === 0) {
      console.log("[done] no more messages to process");
      break;
    }

    batchNum++;
    let bUpdated = 0, bNoHtml = 0, bFailed = 0;
    const batchStart = Date.now();

    for (const r of rows) {
      if (stopRequested) break;
      try {
        const m = await gmail.users.messages.get({ userId: "me", id: r.gmailId, format: "full" });
        const parsed = parseGmailMessage(m.data as any, myDomain);
        const html = parsed.bodyHtml ?? "";
        // Empty string for "no HTML part" — falsy in JS so UI fallback to text continues to work,
        // but distinguishable from NULL so this row is skipped on next pass.
        await db.update(emailMessages)
          .set({ bodyHtml: html })
          .where(eq(emailMessages.id, r.id));
        if (html.length > 0) bUpdated++; else bNoHtml++;
      } catch (e: any) {
        bFailed++;
        failedIds.push(r.gmailId);
        const msg = (e?.message || "").substring(0, 100);
        console.error(`[err] msg=${r.gmailId}: ${msg}`);
        // Backoff on rate-limit / quota
        if (/rate|quota|429|503/i.test(msg)) {
          console.log(`[backoff] rate-limit detected — sleeping 30s`);
          await sleep(30_000);
        }
      }
      await sleep(SLEEP_MS);
    }

    totalProcessed += rows.length;
    totalUpdated   += bUpdated;
    totalNoHtml    += bNoHtml;
    totalFailed    += bFailed;
    const remaining = await countRemaining();
    const elapsedSec = ((Date.now() - batchStart) / 1000).toFixed(1);
    console.log(
      `[batch ${batchNum}] processed=${rows.length} updated=${bUpdated} no-html=${bNoHtml} failed=${bFailed} ` +
      `remaining=${remaining} (${elapsedSec}s) | totals: processed=${totalProcessed} updated=${totalUpdated} no-html=${totalNoHtml} failed=${totalFailed}`
    );
  }

  const afterWithHtml = await countWithHtml();
  const afterRemaining = await countRemaining();
  console.log(`\n========== FINAL REPORT ==========`);
  console.log(`account_id          : ${ACCOUNT_ID} (${acct.emailAddress})`);
  console.log(`runtime             : ${((Date.now() - startedAt) / 1000).toFixed(0)}s`);
  console.log(`batches             : ${batchNum}`);
  console.log(`messages processed  : ${totalProcessed}`);
  console.log(`updated with HTML   : ${totalUpdated}`);
  console.log(`no HTML in source   : ${totalNoHtml}`);
  console.log(`failed              : ${totalFailed}`);
  console.log(`---`);
  console.log(`body_html before    : ${beforeWithHtml}`);
  console.log(`body_html after     : ${afterWithHtml}`);
  console.log(`net new HTML rows   : ${afterWithHtml - beforeWithHtml}`);
  console.log(`remaining (NULL)    : ${afterRemaining}`);
  if (failedIds.length > 0) {
    console.log(`failed gmail ids    : ${failedIds.slice(0, 50).join(", ")}${failedIds.length > 50 ? ` ...(+${failedIds.length - 50} more)` : ""}`);
  }
  console.log(`==================================`);
  process.exit(stopRequested ? 130 : 0);
}

main().catch(e => { console.error("[fatal]", e); process.exit(1); });
