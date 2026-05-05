import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  // Simulate listLocalMessages(q="boatbnbsd@gmail.com", accountId=1)
  const freeText = 'boatbnbsd@gmail.com';
  const lc = freeText.replace(/'/g, "''").toLowerCase();
  const lit = `'${freeText.replace(/'/g, "''")}'`;
  const tsv = `to_tsvector('english', coalesce(subject,'') || ' ' || coalesce(from_name,'') || ' ' || coalesce(from_email,'') || ' ' || coalesce(snippet,'') || ' ' || coalesce(body_text,'') || ' ' || coalesce(all_participants,''))`;
  const ftsCond = `${tsv} @@ plainto_tsquery('english', ${lit})`;
  
  const q = `
    SELECT id AS pk, gmail_message_id, gmail_thread_id, snippet, sent_at,
           from_email, from_name, to_emails, subject, label_ids, source_account_id
    FROM email_messages
    WHERE source_account_id = 1
      AND (${ftsCond} OR lower(coalesce(all_participants,'')) LIKE '%${lc}%')
    ORDER BY sent_at DESC NULLS LAST, id DESC
    LIMIT 51
  `;
  
  console.log("Running listLocalMessages simulation...");
  const result = await db.execute(sql.raw(q));
  const rows = (result as any).rows ?? result;
  console.log("Rows returned:", rows.length);
  for (const r of rows) {
    console.log(String(r.sent_at).slice(0,10), "| from=", r.from_email, "| thread=", r.gmail_thread_id?.slice(0,16));
  }

  // Also test just the ILIKE
  const q2 = `
    SELECT COUNT(*) as cnt FROM email_messages
    WHERE source_account_id = 1
      AND lower(coalesce(all_participants,'')) LIKE '%${lc}%'
  `;
  const r2 = await db.execute(sql.raw(q2));
  console.log("\nILIKE match count:", ((r2 as any).rows ?? r2)[0].cnt);

  // Also test with owner_user_id = 4
  const q3 = `
    SELECT COUNT(*) as cnt FROM email_messages
    WHERE owner_user_id = 4
      AND lower(coalesce(all_participants,'')) LIKE '%${lc}%'
  `;
  const r3 = await db.execute(sql.raw(q3));
  console.log("owner_user_id=4 ILIKE match count:", ((r3 as any).rows ?? r3)[0].cnt);
}
main().catch(console.error).finally(() => process.exit(0));
