import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const users = await db.execute(sql`SELECT id, name, email FROM users ORDER BY id LIMIT 10`);
  console.log("Users:", users.rows);
  
  const accts = await db.execute(sql`SELECT id, user_id, email, provider FROM email_accounts ORDER BY id LIMIT 10`);
  console.log("\nEmail accounts:", accts.rows);
}
main().catch(console.error).finally(() => process.exit(0));
