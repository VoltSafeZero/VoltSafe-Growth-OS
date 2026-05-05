import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  // Check if there's a blocked_domains table or similar
  const tables = await db.execute(sql.raw(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name ILIKE '%block%' OR table_name ILIKE '%filter%' OR table_name ILIKE '%domain%'
    ORDER BY table_name
  `));
  const rows = ((tables as any).rows ?? tables);
  console.log("Tables matching block/filter/domain:", rows);
  
  // Also check gmail_filters or inbox_filters
  const filters = await db.execute(sql.raw(`
    SELECT * FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name
  `));
  const allTables = ((filters as any).rows ?? filters) as any[];
  console.log("\nAll tables:", allTables.map((r: any) => r.table_name).join(', '));
}
main().catch(console.error).finally(() => process.exit(0));
