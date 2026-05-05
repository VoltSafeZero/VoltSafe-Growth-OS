import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const res = await db.execute(sql.raw(`SELECT * FROM email_filters ORDER BY id`));
  const rows = ((res as any).rows ?? res) as any[];
  console.log("email_filters rows:", rows.length);
  for (const r of rows) console.log(JSON.stringify(r));
}
main().catch(console.error).finally(() => process.exit(0));
