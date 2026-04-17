import { db } from "../server/db";
import { emailMessages, emailAccounts } from "../shared/schema";
import { eq, and, desc, isNull } from "drizzle-orm";
import { getGmailClient } from "../server/gmail-oauth";
import { parseGmailMessage } from "../server/services/email-parser";

async function main() {
  const limit = Number(process.argv[2] || 50);
  const accountId = Number(process.argv[3] || 1);

  const [acct] = await db.select().from(emailAccounts).where(eq(emailAccounts.id, accountId));
  if (!acct) { console.log("no account"); process.exit(1); }
  const gmail = await getGmailClient(acct.userId, accountId);
  const myDomain = (acct.emailAddress.split("@")[1] || "").toLowerCase();

  const rows = await db.select({ id: emailMessages.id, gmailId: emailMessages.gmailMessageId })
    .from(emailMessages)
    .where(and(eq(emailMessages.sourceAccountId, accountId), isNull(emailMessages.bodyHtml)))
    .orderBy(desc(emailMessages.sentAt))
    .limit(limit);

  let withHtml = 0, plainOnly = 0, errs = 0;
  for (const r of rows) {
    try {
      const m = await gmail.users.messages.get({ userId: "me", id: r.gmailId, format: "full" });
      const parsed = parseGmailMessage(m.data as any, myDomain);
      await db.update(emailMessages)
        .set({ bodyHtml: parsed.bodyHtml ?? null, updatedAt: new Date() })
        .where(eq(emailMessages.id, r.id));
      if (parsed.bodyHtml) withHtml++; else plainOnly++;
    } catch (e: any) {
      errs++;
      console.error("err", r.gmailId, e.message?.substring(0, 80));
    }
    if (limit > 100) await new Promise(r => setTimeout(r, 100));
  }
  console.log(`backfilled ${rows.length} rows: withHtml=${withHtml}, plainOnly=${plainOnly}, errs=${errs}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
