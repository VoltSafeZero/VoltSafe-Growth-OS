import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const rows = await db.execute(sql`
    SELECT gmail_message_id, subject, from_email, from_name, sent_at,
           LEFT(all_participants, 400) as participants, source_account_id
    FROM email_messages
    WHERE from_email ILIKE '%boatbnbsd%' OR all_participants ILIKE '%boatbnbsd%'
    ORDER BY sent_at DESC
    LIMIT 30
  `);
  console.log("Emails involving boatbnbsd@gmail.com:", rows.rows.length);
  for (const r of rows.rows as any[]) {
    console.log(String(r.sent_at).slice(0,10), "| acct=", r.source_account_id, "| from=", r.from_email, "| subject=", String(r.subject).slice(0,60));
  }

  const accts = await db.execute(sql`
    SELECT id, email, last_history_id, last_full_sync FROM gmail_accounts ORDER BY id
  `);
  console.log("\nGmail accounts:");
  for (const a of accts.rows as any[]) {
    console.log(" id=", a.id, "| email=", a.email, "| lastHistoryId=", a.last_history_id, "| lastFullSync=", a.last_full_sync);
  }

  const total = await db.execute(sql`SELECT COUNT(*) as cnt, MIN(sent_at) as oldest, MAX(sent_at) as newest FROM email_messages`);
  const t = (total.rows[0] as any);
  console.log("\nTotal emails:", t.cnt, "| oldest:", t.oldest, "| newest:", t.newest);
}
main().catch(console.error).finally(() => process.exit(0));
