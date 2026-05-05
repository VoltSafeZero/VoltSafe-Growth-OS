import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const res = await db.execute(sql.raw(`
    SELECT gmail_message_id, gmail_thread_id, subject, from_email, sent_at, 
           label_ids, all_participants
    FROM email_messages
    WHERE source_account_id = 1
      AND lower(coalesce(all_participants,'')) LIKE '%boatbnbsd@gmail.com%'
    ORDER BY sent_at DESC
  `));
  const rows = ((res as any).rows ?? res) as any[];
  console.log("=== All 8 messages with label_ids ===");
  for (const r of rows) {
    console.log(`${String(r.sent_at).slice(0,10)} | thread=${r.gmail_thread_id?.slice(0,12)} | label_ids=${r.label_ids} | from=${r.from_email} | subj=${r.subject?.slice(0,40)}`);
  }
}
main().catch(console.error).finally(() => process.exit(0));
