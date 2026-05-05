import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const cols = await db.execute(sql`
    SELECT column_name FROM information_schema.columns 
    WHERE table_schema='public' AND table_name='email_accounts' ORDER BY ordinal_position
  `);
  console.log("email_accounts columns:", cols.rows.map((r: any) => r.column_name).join(', '));

  const accts = await db.execute(sql`SELECT id, user_id, is_active, is_shared FROM email_accounts ORDER BY id LIMIT 10`);
  console.log("\nemail_accounts rows:", accts.rows);

  // What does getUserGmailAccount(4) return?
  const trevorAcct = await db.execute(sql`
    SELECT id, user_id, is_active, is_shared FROM email_accounts WHERE user_id = 4 ORDER BY id LIMIT 5
  `);
  console.log("\nTrevor's email accounts (userId=4):", trevorAcct.rows);
}
main().catch(console.error).finally(() => process.exit(0));
