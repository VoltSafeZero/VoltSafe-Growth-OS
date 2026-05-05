import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const rows = await db.execute(sql`
    SELECT gmail_thread_id, gmail_message_id, from_email, sent_at, label_ids, direction
    FROM email_messages
    WHERE from_email ILIKE '%boatbnbsd%' OR all_participants ILIKE '%boatbnbsd%'
    ORDER BY sent_at DESC
  `);
  console.log("=== Emails + labels ===");
  for (const r of rows.rows as any[]) {
    console.log(String(r.sent_at).slice(0,10), "| direction=", r.direction, "| labels=", r.label_ids, "| from=", r.from_email);
    console.log("  thread:", r.gmail_thread_id);
  }

  // Check the gmail_accounts table name
  const tbls = await db.execute(sql`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename ILIKE '%gmail%' ORDER BY tablename`);
  console.log("\nGmail tables:", tbls.rows);
}
main().catch(console.error).finally(() => process.exit(0));
