import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  // Check folder assignments for boatbnbsd messages using correct column 'email_id'
  // First get the IDs of the boatbnbsd messages
  const msgs = await db.execute(sql.raw(`
    SELECT id, gmail_message_id, subject, sent_at, label_ids
    FROM email_messages
    WHERE lower(coalesce(all_participants,'')) LIKE '%boatbnbsd@gmail.com%'
    ORDER BY sent_at DESC
  `));
  const msgRows = ((msgs as any).rows ?? msgs) as any[];
  console.log("boatbnbsd message DB ids:", msgRows.map((r:any) => `${r.id} (${String(r.sent_at).slice(0,10)} ${r.subject?.slice(0,30)})`));

  const ids = msgRows.map((r:any) => r.id);
  if (ids.length === 0) { console.log("No messages found"); return; }

  // Check folder assignments  
  const assigns = await db.execute(sql.raw(`
    SELECT efa.email_id, efa.folder_id, mf.name AS folder_name, efa.assignment_reason
    FROM email_folder_assignments efa
    LEFT JOIN mail_folders mf ON mf.id = efa.folder_id
    WHERE efa.email_id IN (${ids.join(',')})
  `));
  console.log("\nFolder assignments:", ((assigns as any).rows ?? assigns));

  // Check ALL folder assignments count
  const total = await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM email_folder_assignments`));
  console.log("\nTotal folder assignments:", ((total as any).rows ?? total)[0]?.cnt);

  // Check mail_folders
  const folders = await db.execute(sql.raw(`SELECT id, name, owner_user_id FROM mail_folders ORDER BY id`));
  console.log("\nAll mail_folders:", ((folders as any).rows ?? folders));
}
main().catch(console.error).finally(() => process.exit(0));
