import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const rows = await db.execute(sql`
    SELECT gmail_message_id, from_email, sent_at, label_ids, direction, 
           owner_user_id, source_account_id, gmail_thread_id
    FROM email_messages
    WHERE from_email ILIKE '%boatbnbsd%' OR all_participants ILIKE '%boatbnbsd%'
    ORDER BY sent_at DESC
  `);
  console.log("=== owner_user_id for boatbnbsd emails ===");
  for (const r of rows.rows as any[]) {
    console.log(String(r.sent_at).slice(0,10), "| owner_user_id=", r.owner_user_id, "| source_account_id=", r.source_account_id, "| dir=", r.direction, "| from=", r.from_email);
  }

  // Check connected gmail accounts (not gmail_accounts which doesn't exist)
  const userAccts = await db.execute(sql`
    SELECT id, email, last_history_id FROM connected_accounts ORDER BY id LIMIT 10
  `).catch(() => ({ rows: [] }));
  const mailAccts = await db.execute(sql`
    SELECT id, email FROM mail_accounts ORDER BY id LIMIT 10
  `).catch(() => ({ rows: [] }));
  const oauthAccts = await db.execute(sql`
    SELECT id, email, provider FROM oauth_accounts ORDER BY id LIMIT 10
  `).catch(() => ({ rows: [] }));

  // Find what table stores gmail accounts
  const tbls = await db.execute(sql`
    SELECT tablename, (SELECT COUNT(*) FROM information_schema.columns WHERE table_name=pg_tables.tablename AND table_schema='public') as cols
    FROM pg_tables WHERE schemaname='public' AND (tablename ILIKE '%account%' OR tablename ILIKE '%mail%' OR tablename ILIKE '%connect%')
    ORDER BY tablename
  `);
  console.log("\nAccount-related tables:", tbls.rows);
}
main().catch(console.error).finally(() => process.exit(0));
