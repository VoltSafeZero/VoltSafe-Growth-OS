import { db } from "../server/db";
import { sql } from "drizzle-orm";
async function main() {
  const labelStats = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE label_ids LIKE '%"INBOX"%') AS in_inbox,
      COUNT(*) FILTER (WHERE label_ids LIKE '%"SENT"%') AS in_sent,
      COUNT(*) FILTER (WHERE label_ids LIKE '%"ARCHIVE"%' OR (label_ids NOT LIKE '%"INBOX"%' AND label_ids NOT LIKE '%"SENT"%' AND label_ids NOT LIKE '%"TRASH"%' AND label_ids NOT LIKE '%"SPAM"%')) AS other_or_archive,
      COUNT(*) FILTER (WHERE label_ids LIKE '%"TRASH"%') AS in_trash,
      COUNT(*) FILTER (WHERE label_ids LIKE '%"SPAM"%') AS in_spam,
      COUNT(*) FILTER (WHERE label_ids LIKE '%"UNREAD"%') AS total_unread,
      COUNT(*) FILTER (WHERE label_ids LIKE '%"INBOX"%' AND label_ids LIKE '%"UNREAD"%') AS inbox_unread,
      COUNT(*) AS total
    FROM email_messages WHERE source_account_id = 1
  `);
  console.log("Label stats:", JSON.stringify((labelStats as any).rows[0], null, 2));

  const ageBuckets = await db.execute(sql`
    SELECT
      CASE
        WHEN received_at > NOW() - INTERVAL '7 days' THEN 'last_7d'
        WHEN received_at > NOW() - INTERVAL '30 days' THEN 'last_30d'
        WHEN received_at > NOW() - INTERVAL '90 days' THEN 'last_90d'
        WHEN received_at > NOW() - INTERVAL '1 year' THEN 'last_year'
        ELSE 'older_than_1yr'
      END AS bucket,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE label_ids LIKE '%"INBOX"%' AND label_ids LIKE '%"UNREAD"%') AS inbox_unread,
      COUNT(*) FILTER (WHERE label_ids LIKE '%"UNREAD"%') AS any_unread
    FROM email_messages WHERE source_account_id = 1
    GROUP BY 1 ORDER BY 1
  `);
  console.log("Age buckets:", JSON.stringify((ageBuckets as any).rows, null, 2));
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
