import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  // Check folder assignments for the Feb 2026 boatbnbsd messages
  const res = await db.execute(sql.raw(`
    SELECT efa.message_id, efa.folder_id, mf.name AS folder_name, 
           em.gmail_message_id, em.subject, em.sent_at
    FROM email_folder_assignments efa
    JOIN email_messages em ON em.gmail_message_id = efa.message_id
    LEFT JOIN mail_folders mf ON mf.id = efa.folder_id
    WHERE lower(coalesce(em.all_participants,'')) LIKE '%boatbnbsd@gmail.com%'
  `));
  const rows = ((res as any).rows ?? res) as any[];
  console.log("Folder assignments for boatbnbsd messages:", rows.length);
  for (const r of rows) console.log(JSON.stringify(r));

  // Also check what mail_folders exist
  const folders = await db.execute(sql.raw(`SELECT id, name, user_id, is_system FROM mail_folders ORDER BY id`));
  console.log("\nMail folders:", ((folders as any).rows ?? folders));

  // Check mail_folder_domains
  const fDomains = await db.execute(sql.raw(`SELECT * FROM mail_folder_domains LIMIT 20`));
  console.log("\nMail folder domains:", ((fDomains as any).rows ?? fDomains));
}
main().catch(console.error).finally(() => process.exit(0));
