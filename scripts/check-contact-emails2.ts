import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  // Check all boatbnbsd emails with their thread IDs
  const rows = await db.execute(sql`
    SELECT gmail_message_id, gmail_thread_id, subject, from_email, sent_at,
           to_emails, all_participants, source_account_id
    FROM email_messages
    WHERE from_email ILIKE '%boatbnbsd%' OR all_participants ILIKE '%boatbnbsd%'
    ORDER BY sent_at DESC
  `);
  console.log("=== All emails for boatbnbsd ===");
  for (const r of rows.rows as any[]) {
    console.log("\n---");
    console.log("  date:", String(r.sent_at).slice(0,10));
    console.log("  subject:", r.subject?.slice(0,70));
    console.log("  from:", r.from_email);
    console.log("  to_emails:", r.to_emails?.slice(0,200));
    console.log("  all_participants:", r.all_participants?.slice(0,200));
    console.log("  thread_id:", r.gmail_thread_id);
  }

  // Distinct thread IDs 
  const threads = await db.execute(sql`
    SELECT DISTINCT gmail_thread_id, COUNT(*) as msg_count, MAX(sent_at) as latest
    FROM email_messages
    WHERE from_email ILIKE '%boatbnbsd%' OR all_participants ILIKE '%boatbnbsd%'
    GROUP BY gmail_thread_id
    ORDER BY latest DESC
  `);
  console.log("\n=== Distinct threads ===");
  for (const t of threads.rows as any[]) {
    console.log("  thread:", t.gmail_thread_id, "| msgs:", t.msg_count, "| latest:", String(t.latest).slice(0,10));
  }

  // Check if the invitation emails specifically have boatbnbsd
  const invites = await db.execute(sql`
    SELECT subject, from_email, to_emails, all_participants, sent_at
    FROM email_messages
    WHERE subject ILIKE '%Shelter Cove%' OR subject ILIKE '%invitation%'
    ORDER BY sent_at DESC
    LIMIT 10
  `);
  console.log("\n=== Shelter Cove / invitation emails ===");
  for (const r of invites.rows as any[]) {
    console.log("  date:", String(r.sent_at).slice(0,10), "| subject:", r.subject?.slice(0,60));
    console.log("    all_participants:", r.all_participants?.slice(0,150));
  }
}
main().catch(console.error).finally(() => process.exit(0));
