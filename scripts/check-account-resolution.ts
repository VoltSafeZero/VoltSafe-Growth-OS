import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  // Check what getUserGmailAccount(4) would return
  const res = await db.execute(sql.raw(`
    SELECT id, user_id, email_address, is_active, is_shared
    FROM email_accounts
    WHERE user_id = 4
    ORDER BY id
  `));
  const rows = ((res as any).rows ?? res) as any[];
  console.log("email_accounts for user 4:", rows);

  // Check the actual count of messages per account for boatbnbsd
  const cnt = await db.execute(sql.raw(`
    SELECT source_account_id, count(*) as cnt, owner_user_id
    FROM email_messages
    WHERE lower(coalesce(all_participants,'')) LIKE '%boatbnbsd@gmail.com%'
    GROUP BY source_account_id, owner_user_id
  `));
  console.log("\nMessages per account for boatbnbsd:", ((cnt as any).rows ?? cnt));
  
  // Also check: what does the ROUTE actually do when source=local and q="boatbnbsd@gmail.com"
  // specifically: does getAccessibleAccountIds(4, false, {}) return account 1?
  // Check if account 1 is accessible to user 4
  const accs = await db.execute(sql.raw(`
    SELECT id, user_id, email_address, is_shared, is_active
    FROM email_accounts
    WHERE id = 1
  `));
  console.log("\nAccount 1:", ((accs as any).rows ?? accs));
}
main().catch(console.error).finally(() => process.exit(0));
