import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function q(qsql: any) {
  const r = await db.execute(qsql);
  return ((r as any).rows ?? r) as any[];
}

async function main() {
  const accountId = Number(process.env.REPORT_ACCOUNT_ID || 1);
  const now = new Date();

  const [snap] = await q(sql`
    SELECT
      (SELECT count(*) FROM email_messages WHERE source_account_id=${accountId})::int AS total_messages,
      (SELECT count(*) FROM email_messages WHERE source_account_id=${accountId} AND body_html IS NOT NULL AND length(body_html)>0)::int AS with_html,
      (SELECT count(*) FROM email_messages WHERE source_account_id=${accountId} AND body_html = '')::int AS html_no_html_marker,
      (SELECT count(*) FROM email_messages WHERE source_account_id=${accountId} AND body_html IS NULL)::int AS html_still_null,
      (SELECT count(*) FROM email_messages WHERE source_account_id=${accountId} AND has_attachments=true)::int AS msgs_with_att_flag,
      (SELECT count(DISTINCT message_id) FROM email_attachments)::int AS msgs_with_att_rows,
      (SELECT count(*) FROM email_attachments)::int AS att_rows_total,
      (SELECT count(*) FROM email_messages m WHERE source_account_id=${accountId} AND has_attachments=true
         AND NOT EXISTS (SELECT 1 FROM email_attachments a WHERE a.message_id=m.id))::int AS att_pending,
      (SELECT auth_status FROM email_accounts WHERE id=${accountId}) AS auth_status,
      (SELECT watch_expiration_at FROM email_accounts WHERE id=${accountId}) AS watch_expires_at,
      (SELECT last_webhook_at FROM email_accounts WHERE id=${accountId}) AS last_webhook_at,
      (SELECT last_incremental_sync_at FROM email_accounts WHERE id=${accountId}) AS last_incremental_sync_at,
      (SELECT incremental_event_count FROM email_accounts WHERE id=${accountId})::int AS incremental_event_count,
      (SELECT count(*) FROM (
         SELECT gmail_message_id, count(*) c FROM email_messages WHERE source_account_id=${accountId}
         GROUP BY gmail_message_id HAVING count(*)>1) d)::int AS duplicate_gmail_ids,
      (SELECT count(*) FROM email_messages WHERE source_account_id=${accountId} AND sent_at > now() - interval '12 hours')::int AS new_msgs_last_12h,
      (SELECT count(*) FROM email_messages WHERE source_account_id=${accountId} AND label_ids LIKE '%"UNREAD"%' AND label_ids LIKE '%"INBOX"%')::int AS unread_inbox
  `);

  const watchExp = snap.watch_expires_at ? new Date(snap.watch_expires_at) : null;
  const watchHrsLeft = watchExp ? ((watchExp.getTime() - now.getTime()) / 3_600_000).toFixed(1) : "n/a";
  const lastWebhookMin = snap.last_webhook_at ? ((now.getTime() - new Date(snap.last_webhook_at).getTime()) / 60_000).toFixed(0) : "n/a";

  // attachment type breakdown
  const types = await q(sql`
    SELECT
      CASE
        WHEN mime_type ILIKE 'application/pdf' THEN 'pdf'
        WHEN mime_type ILIKE 'image/%' THEN 'image'
        WHEN mime_type ILIKE 'application/vnd.openxmlformats%' OR mime_type ILIKE 'application/msword' OR mime_type ILIKE 'application/vnd.ms-%' THEN 'office'
        WHEN is_inline=true THEN 'inline'
        ELSE 'other'
      END AS bucket,
      count(*)::int AS n
    FROM email_attachments
    GROUP BY 1 ORDER BY n DESC
  `);

  console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║          VOLTSAFE TREVOR MAILBOX — MORNING REPORT            ║`);
  console.log(`║          Generated: ${now.toISOString().substring(0, 19)}Z                  ║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝\n`);

  console.log(`▼ HEALTH`);
  console.log(`  Auth status              : ${snap.auth_status}`);
  console.log(`  Gmail watch              : expires ${snap.watch_expires_at}  (${watchHrsLeft}h remaining)`);
  console.log(`  Last webhook received    : ${snap.last_webhook_at}  (${lastWebhookMin} min ago)`);
  console.log(`  Last incremental sync    : ${snap.last_incremental_sync_at}`);
  console.log(`  Incremental events total : ${snap.incremental_event_count}`);
  console.log(`  Duplicate gmail_ids      : ${snap.duplicate_gmail_ids}  ${snap.duplicate_gmail_ids === 0 ? '✓' : '✗ INVESTIGATE'}`);
  console.log(`  New messages last 12h    : ${snap.new_msgs_last_12h}`);
  console.log(`  Unread in inbox          : ${snap.unread_inbox}\n`);

  console.log(`▼ HTML BACKFILL PROGRESS`);
  console.log(`  Total messages           : ${snap.total_messages}`);
  console.log(`  body_html populated      : ${snap.with_html}  (${(snap.with_html / snap.total_messages * 100).toFixed(1)}%)`);
  console.log(`  body_html='' (no-HTML)   : ${snap.html_no_html_marker}`);
  console.log(`  body_html still NULL     : ${snap.html_still_null}  ${snap.html_still_null === 0 ? '✓ COMPLETE' : '⏳ in progress'}\n`);

  console.log(`▼ ATTACHMENT BACKFILL PROGRESS`);
  console.log(`  Messages with attach flag: ${snap.msgs_with_att_flag}`);
  console.log(`  Messages with att rows   : ${snap.msgs_with_att_rows}`);
  console.log(`  Total attachment rows    : ${snap.att_rows_total}`);
  console.log(`  Pending backfill         : ${snap.att_pending}  ${snap.att_pending === 0 ? '✓ COMPLETE' : '⏳ in progress'}`);
  console.log(`  Type breakdown:`);
  for (const t of types) console.log(`    ${t.bucket.padEnd(8)} : ${t.n}`);
  console.log();

  console.log(`▼ HOW TO READ`);
  console.log(`  • body_html=''  means parser tried, no HTML in source → text fallback shown in UI`);
  console.log(`  • body_html=NULL means not yet processed (HTML backfill will pick it up)`);
  console.log(`  • duplicate_gmail_ids=0 confirms no double-ingest`);
  console.log(`  • watch_hrs_left < 24 → re-watch needed; > 48h → healthy\n`);

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
