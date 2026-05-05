// Simulate the exact API call listLocalMessages makes for q="boatbnbsd@gmail.com"
// with the same parameters the frontend sends
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

// Replicate listLocalMessages exactly (source=local, accountId=1)
async function main() {
  // buildQClauses("boatbnbsd@gmail.com")
  const freeText = 'boatbnbsd@gmail.com';
  const safe = (s: string) => s.replace(/'/g, "''");
  const lit = `'${safe(freeText)}'`;
  const lc = safe(freeText.toLowerCase());
  const tsv = `to_tsvector('english', coalesce(subject,'') || ' ' || coalesce(from_name,'') || ' ' || coalesce(from_email,'') || ' ' || coalesce(snippet,'') || ' ' || coalesce(body_text,'') || ' ' || coalesce(all_participants,''))`;
  const ftsCond = `${tsv} @@ plainto_tsquery('english', ${lit})`;
  const qCond = `(${ftsCond} OR lower(coalesce(all_participants,'')) LIKE '%${lc}%')`;

  const limit = 50;
  const q = `
    SELECT
      id AS pk,
      gmail_message_id, gmail_thread_id, snippet, sent_at,
      from_email, from_name, to_emails, subject, label_ids, source_account_id
    FROM email_messages
    WHERE source_account_id = 1
      AND ${qCond}
    ORDER BY sent_at DESC NULLS LAST, id DESC
    LIMIT ${limit + 1}
  `;
  const rowsRes = await db.execute(sql.raw(q));
  const raw = ((rowsRes as any).rows ?? rowsRes) as any[];
  console.log(`Raw rows from DB: ${raw.length}`);
  for (const r of raw) {
    console.log(`  ${String(r.sent_at).slice(0,10)} | thread=${r.gmail_thread_id?.slice(0,12)} | from=${r.from_email} | labels=${r.label_ids} | id=${r.gmail_message_id}`);
  }

  const hasMore = raw.length > limit;
  const slice = raw.slice(0, limit);
  console.log(`\nhasMore=${hasMore}, slice.length=${slice.length}`);
  console.log(`localExhausted=${!hasMore}`);

  // Simulate what the frontend receives
  const messages = slice.map((r: any) => {
    const sentAt = r.sent_at ? new Date(r.sent_at) : null;
    return {
      id: r.gmail_message_id,
      threadId: r.gmail_thread_id,
      snippet: r.snippet || "",
      internalDate: sentAt ? String(sentAt.getTime()) : "0",
      labelIds: JSON.parse(r.label_ids || '[]'),
      from: r.from_name ? `${r.from_name} <${r.from_email}>` : r.from_email || '',
      to: r.to_emails || '',
      subject: r.subject || "",
      date: sentAt ? sentAt.toUTCString() : "",
      sourceAccountId: r.source_account_id,
    };
  });

  console.log(`\nMessages returned to client: ${messages.length}`);
  console.log("\nFrontend filter simulation:");
  const blockedDomains = new Set<string>(['email.teamsnap.com', 'email.crunchbase.com', 'user.luma-mail.com', 'p1c4.example.com']);
  const parseSenderDomain = (from: string) => {
    const m = from.match(/@([^>]+)>?/);
    return m ? m[1].toLowerCase() : '';
  };
  const inboxMain = messages.filter(m => !blockedDomains.has(parseSenderDomain(m.from)));
  console.log(`inboxMain.length = ${inboxMain.length}`);

  // categorizedInbox with inboxCategory="all"
  const categorizedInbox = inboxMain;
  console.log(`categorizedInbox (all).length = ${categorizedInbox.length}`);

  // activeMessages for tab="inbox"
  const activeMessages = categorizedInbox;
  console.log(`activeMessages.length = ${activeMessages.length}`);
  
  // crmFilteredMessages for crmFilter="all"
  const crmFilteredMessages = activeMessages;
  console.log(`crmFilteredMessages.length = ${crmFilteredMessages.length}`);
  
  console.log("\nFINAL: Would show", crmFilteredMessages.length, "rows in inbox");
  console.log("Unique threads:", new Set(crmFilteredMessages.map(m => m.threadId)).size);
}
main().catch(console.error).finally(() => process.exit(0));
