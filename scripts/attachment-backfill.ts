import { db } from "../server/db";
import { emailMessages, emailAccounts, emailAttachments } from "../shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { getGmailClient } from "../server/gmail-oauth";
import { parseGmailMessage } from "../server/services/email-parser";
import { insertAttachmentsForMessage } from "../server/services/email-attachments";

async function main() {
  const limit = Number(process.argv[2] || 200);
  const accountId = Number(process.argv[3] || 1);
  const sleepMs = Number(process.argv[4] || (limit > 100 ? 100 : 0));

  const [acct] = await db.select().from(emailAccounts).where(eq(emailAccounts.id, accountId));
  if (!acct) { console.log("no account"); process.exit(1); }
  const gmail = await getGmailClient(acct.userId, accountId);
  const myDomain = (acct.emailAddress.split("@")[1] || "").toLowerCase();

  // Find messages that have attachments but don't have rows in email_attachments yet
  const rows = await db.execute(sql.raw(`
    SELECT m.id, m.gmail_message_id
    FROM email_messages m
    WHERE m.source_account_id = ${accountId}
      AND m.has_attachments = true
      AND NOT EXISTS (SELECT 1 FROM email_attachments a WHERE a.message_id = m.id)
    ORDER BY m.sent_at DESC NULLS LAST
    LIMIT ${limit}
  `));
  const todo = ((rows as any).rows ?? rows) as { id: number; gmail_message_id: string }[];
  console.log(`backfill candidates: ${todo.length} (limit ${limit}, sleep ${sleepMs}ms)`);

  let totalAttach = 0, msgsTouched = 0, errs = 0, noAttach = 0;
  for (const r of todo) {
    try {
      const m = await gmail.users.messages.get({ userId: "me", id: r.gmail_message_id, format: "full" });
      const parsed = parseGmailMessage(m.data as any, myDomain);
      if (parsed.attachments.length > 0) {
        const n = await insertAttachmentsForMessage(r.id, parsed.attachments);
        totalAttach += n;
        msgsTouched++;
      } else {
        // Has has_attachments=true but parser didn't find any (likely all inline filtered or odd MIME)
        noAttach++;
      }
    } catch (e: any) {
      errs++;
      console.error("err", r.gmail_message_id, e.message?.substring(0, 80));
    }
    if (sleepMs > 0) await new Promise(r => setTimeout(r, sleepMs));
  }
  console.log(`done: messages=${msgsTouched}, attachments=${totalAttach}, no-attach-found=${noAttach}, errs=${errs}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
