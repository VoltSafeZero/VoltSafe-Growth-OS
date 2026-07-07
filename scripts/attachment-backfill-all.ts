import { db } from "../server/db";
import { emailMessages, emailAccounts, emailAttachments } from "../shared/schema";
import { eq, sql } from "drizzle-orm";
import { getGmailClient } from "../server/gmail-oauth";
import { parseGmailMessage } from "../server/services/email-parser";
import { insertAttachmentsForMessage } from "../server/services/email-attachments";

const ACCOUNT_ID = Number(process.env.ATT_BACKFILL_ACCOUNT_ID || 1);
const BATCH_SIZE = Number(process.env.ATT_BACKFILL_BATCH || 100);
const SLEEP_MS = Number(process.env.ATT_BACKFILL_SLEEP_MS || 150);
const MAX_RUNTIME_MS = Number(process.env.ATT_BACKFILL_MAX_MINUTES || 0) * 60_000;

let stopRequested = false;
process.on("SIGTERM", () => { console.log("[signal] SIGTERM — finishing current batch"); stopRequested = true; });
process.on("SIGINT",  () => { console.log("[signal] SIGINT — finishing current batch"); stopRequested = true; });

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function countPending(): Promise<number> {
  const r = await db.execute(sql`
    SELECT count(*)::int AS n FROM email_messages m
    WHERE m.source_account_id = ${ACCOUNT_ID}
      AND m.has_attachments = true
      AND NOT EXISTS (SELECT 1 FROM email_attachments a WHERE a.message_id = m.id)
  `);
  return Number((r as any).rows?.[0]?.n ?? 0);
}

async function countAttRows(): Promise<{ msgs: number; rows: number }> {
  const r = await db.execute(sql`
    SELECT count(DISTINCT message_id)::int AS msgs, count(*)::int AS rows FROM email_attachments
  `);
  return { msgs: Number((r as any).rows?.[0]?.msgs ?? 0), rows: Number((r as any).rows?.[0]?.rows ?? 0) };
}

async function main() {
  const startedAt = Date.now();
  console.log(`[start] account=${ACCOUNT_ID} batch=${BATCH_SIZE} sleep=${SLEEP_MS}ms maxRuntime=${MAX_RUNTIME_MS || "unlimited"}ms`);

  const [acct] = await db.select().from(emailAccounts).where(eq(emailAccounts.id, ACCOUNT_ID));
  if (!acct) { console.error(`[fatal] no account id=${ACCOUNT_ID}`); process.exit(1); }
  if (acct.authStatus !== "active") {
    console.log(`[skip] account=${ACCOUNT_ID} auth_status=${acct.authStatus} — reconnect required, nothing to do`);
    process.exit(0);
  }
  const myDomain = (acct.emailAddress.split("@")[1] || "").toLowerCase();

  const beforePending = await countPending();
  const before = await countAttRows();
  console.log(`[before] pending=${beforePending} att_rows=${before.rows} msgs_with_rows=${before.msgs}`);

  let totalProcessed = 0, totalMsgsTouched = 0, totalAttRows = 0, totalNoAttFound = 0, totalFailed = 0;
  const failedIds: string[] = [];
  let batchNum = 0;

  while (!stopRequested) {
    if (MAX_RUNTIME_MS && Date.now() - startedAt > MAX_RUNTIME_MS) {
      console.log(`[stop] hit max runtime`); break;
    }

    let gmail;
    try {
      gmail = await getGmailClient(acct.userId, ACCOUNT_ID);
    } catch (e: any) {
      console.error(`[fatal] failed to get gmail client: ${e.message}`); break;
    }

    const rows = await db.execute(sql`
      SELECT m.id, m.gmail_message_id
      FROM email_messages m
      WHERE m.source_account_id = ${ACCOUNT_ID}
        AND m.has_attachments = true
        AND NOT EXISTS (SELECT 1 FROM email_attachments a WHERE a.message_id = m.id)
      ORDER BY m.sent_at DESC NULLS LAST
      LIMIT ${BATCH_SIZE}
    `);
    const todo = ((rows as any).rows ?? []) as { id: number; gmail_message_id: string }[];
    if (todo.length === 0) { console.log("[done] no more pending"); break; }

    batchNum++;
    let bMsgs = 0, bRows = 0, bNo = 0, bFail = 0;
    const batchStart = Date.now();

    for (const r of todo) {
      if (stopRequested) break;
      try {
        const m = await gmail.users.messages.get({ userId: "me", id: r.gmail_message_id, format: "full" });
        const parsed = parseGmailMessage(m.data as any, myDomain);
        if (parsed.attachments.length > 0) {
          const n = await insertAttachmentsForMessage(r.id, parsed.attachments);
          bRows += n; bMsgs++;
        } else {
          // has_attachments=true flagged at ingest, but parser found none (likely all-inline filtered).
          // Mark message so this row is skipped on next pass: insert a sentinel? No — instead we just
          // drop has_attachments to false so the WHERE clause naturally excludes it.
          await db.update(emailMessages).set({ hasAttachments: false }).where(eq(emailMessages.id, r.id));
          bNo++;
        }
      } catch (e: any) {
        bFail++;
        failedIds.push(r.gmail_message_id);
        const msg = (e?.message || "").substring(0, 100);
        console.error(`[err] msg=${r.gmail_message_id}: ${msg}`);
        if (/rate|quota|429|503/i.test(msg)) {
          console.log(`[backoff] rate-limit — sleeping 30s`); await sleep(30_000);
        }
      }
      await sleep(SLEEP_MS);
    }

    totalProcessed += todo.length;
    totalMsgsTouched += bMsgs;
    totalAttRows += bRows;
    totalNoAttFound += bNo;
    totalFailed += bFail;
    const remaining = await countPending();
    const elapsedSec = ((Date.now() - batchStart) / 1000).toFixed(1);
    console.log(
      `[batch ${batchNum}] processed=${todo.length} msgs+rows=${bMsgs}/+${bRows} no-att=${bNo} failed=${bFail} ` +
      `remaining=${remaining} (${elapsedSec}s) | totals: processed=${totalProcessed} msgs+rows=${totalMsgsTouched}/+${totalAttRows} no-att=${totalNoAttFound} failed=${totalFailed}`
    );
  }

  const after = await countAttRows();
  const afterPending = await countPending();
  console.log(`\n========== ATTACHMENT BACKFILL FINAL REPORT ==========`);
  console.log(`account_id          : ${ACCOUNT_ID} (${acct.emailAddress})`);
  console.log(`runtime             : ${((Date.now() - startedAt) / 1000).toFixed(0)}s`);
  console.log(`batches             : ${batchNum}`);
  console.log(`messages processed  : ${totalProcessed}`);
  console.log(`messages with rows  : ${totalMsgsTouched}`);
  console.log(`new attachment rows : ${totalAttRows}`);
  console.log(`no att in source    : ${totalNoAttFound}  (has_attachments flag corrected to false)`);
  console.log(`failed              : ${totalFailed}`);
  console.log(`---`);
  console.log(`att_rows  before -> after : ${before.rows} -> ${after.rows}  (Δ ${after.rows - before.rows})`);
  console.log(`msgs+rows before -> after : ${before.msgs} -> ${after.msgs}  (Δ ${after.msgs - before.msgs})`);
  console.log(`pending  before -> after  : ${beforePending} -> ${afterPending}`);
  if (failedIds.length > 0) {
    console.log(`failed gmail ids    : ${failedIds.slice(0, 50).join(", ")}${failedIds.length > 50 ? ` ...(+${failedIds.length - 50} more)` : ""}`);
  }
  console.log(`======================================================`);
  process.exit(stopRequested ? 130 : 0);
}

main().catch(e => { console.error("[fatal]", e); process.exit(1); });
