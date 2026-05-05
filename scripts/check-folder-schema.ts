import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const cols = await db.execute(sql.raw(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'email_folder_assignments' ORDER BY ordinal_position
  `));
  console.log("email_folder_assignments columns:", ((cols as any).rows ?? cols).map((r:any) => r.column_name));
  
  const fcols = await db.execute(sql.raw(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'mail_folders' ORDER BY ordinal_position
  `));
  console.log("mail_folders columns:", ((fcols as any).rows ?? fcols).map((r:any) => r.column_name));
  
  const fdcols = await db.execute(sql.raw(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'mail_folder_domains' ORDER BY ordinal_position
  `));
  console.log("mail_folder_domains columns:", ((fdcols as any).rows ?? fdcols).map((r:any) => r.column_name));
}
main().catch(console.error).finally(() => process.exit(0));
