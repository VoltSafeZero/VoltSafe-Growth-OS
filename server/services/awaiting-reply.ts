/**
 * Awaiting Reply Service
 *
 * Deterministic thread-level logic for tracking outbound reply obligations.
 *
 * "Awaiting reply" (needs_reply):
 *   An external contact sent us an inbound email and we haven't replied yet.
 *   Condition: last_inbound_at > last_outbound_at (or no outbound in thread)
 *   AND thread is not manually marked waiting_on_them or done.
 *
 * "Waiting on them":
 *   We sent an outbound and they haven't replied.
 *   Condition: last_outbound_at > last_inbound_at (or no inbound in thread)
 *   Unless manually overridden.
 *
 * Clears:
 *   - awaiting_reply_since is cleared when we send a reply OR when manually marked done/waiting_on_them
 *   - Both timing columns update on every sync
 */
import { db } from "../db";
import { sql } from "drizzle-orm";
import { esc } from "../tracking";

const INTERNAL_DOMAIN = "voltsafe.com";
const AWAITING_THRESHOLD_HOURS = 0; // Mark immediately (no grace period)

export async function computeAwaitingReply(): Promise<{ updated: number; awaitingCount: number }> {
  try {
    // Step 1: Update last_inbound_at + last_outbound_at for all threads
    await db.execute(sql.raw(`
      UPDATE email_threads et
      SET
        last_inbound_at = sub.last_inbound,
        last_outbound_at = sub.last_outbound,
        updated_at = NOW()
      FROM (
        SELECT
          em.gmail_thread_id,
          MAX(em.sent_at) FILTER (
            WHERE em.direction = 'inbound'
              AND em.from_email NOT ILIKE '%${INTERNAL_DOMAIN}%'
              AND em.from_email NOT ILIKE '%noreply%'
              AND em.from_email NOT ILIKE '%no-reply%'
              AND em.from_email NOT ILIKE '%donotreply%'
              AND em.from_email NOT ILIKE '%mailer%'
          ) AS last_inbound,
          MAX(em.sent_at) FILTER (
            WHERE em.direction = 'outbound'
          ) AS last_outbound
        FROM email_messages em
        GROUP BY em.gmail_thread_id
      ) sub
      WHERE et.gmail_thread_id = sub.gmail_thread_id
        AND (sub.last_inbound IS NOT NULL OR sub.last_outbound IS NOT NULL)
    `));

    // Step 2: Set awaiting_reply_since for threads where:
    //   - We have an external inbound
    //   - Either no outbound at all, OR last_inbound_at > last_outbound_at
    //   - Not already manually marked as waiting_on_them or done
    const setResult = await db.execute(sql.raw(`
      UPDATE email_threads
      SET
        awaiting_reply_since = COALESCE(awaiting_reply_since, last_inbound_at),
        reply_status = CASE
          WHEN reply_status IN ('waiting_on_them', 'done') THEN reply_status
          ELSE 'needs_reply'
        END,
        updated_at = NOW()
      WHERE last_inbound_at IS NOT NULL
        AND (last_outbound_at IS NULL OR last_inbound_at > last_outbound_at)
        AND reply_status NOT IN ('waiting_on_them', 'done')
        AND awaiting_reply_since IS NULL
    `));

    // Step 3: Clear awaiting_reply_since for threads where we have replied
    //   (last_outbound_at >= last_inbound_at) AND not manually overridden
    const clearResult = await db.execute(sql.raw(`
      UPDATE email_threads
      SET
        awaiting_reply_since = NULL,
        reply_status = CASE
          WHEN reply_status = 'needs_reply' THEN 'waiting_on_them'
          ELSE reply_status
        END,
        updated_at = NOW()
      WHERE last_outbound_at IS NOT NULL
        AND (last_inbound_at IS NULL OR last_outbound_at >= last_inbound_at)
        AND awaiting_reply_since IS NOT NULL
        AND reply_status = 'needs_reply'
    `));

    // Count threads currently awaiting reply
    const [countRow] = (await db.execute(sql.raw(`
      SELECT COUNT(*)::int AS cnt FROM email_threads WHERE awaiting_reply_since IS NOT NULL
    `))).rows as any[];

    const awaitingCount = Number(countRow?.cnt || 0);
    const updated = Number((setResult as any).rowCount || 0) + Number((clearResult as any).rowCount || 0);

    console.log(`[awaiting-reply] Updated ${updated} threads; ${awaitingCount} currently awaiting reply`);
    return { updated, awaitingCount };
  } catch (err) {
    console.error("[awaiting-reply] computeAwaitingReply error:", err);
    return { updated: 0, awaitingCount: 0 };
  }
}

/**
 * Clear awaiting reply status for a specific thread (called when we send a reply)
 */
export async function clearAwaitingReply(threadId: string): Promise<void> {
  try {
    await db.execute(sql.raw(`
      UPDATE email_threads
      SET
        awaiting_reply_since = NULL,
        last_outbound_at = NOW(),
        reply_status = CASE WHEN reply_status = 'needs_reply' THEN 'waiting_on_them' ELSE reply_status END,
        updated_at = NOW()
      WHERE gmail_thread_id = '${esc(threadId)}'
        AND reply_status = 'needs_reply'
    `));
  } catch (err) {
    console.error("[awaiting-reply] clearAwaitingReply error:", err);
  }
}

/**
 * Triage summary counts: awaitingReply, hot, unlinked
 */
export async function getTriageSummary(): Promise<{
  awaitingReply: number;
  hot: number;
  unlinked: number;
}> {
  try {
    const [[awaitingRow], [hotRow], [unlinkedRow]] = await Promise.all([
      db.execute(sql.raw(`
        SELECT COUNT(*)::int AS n FROM email_threads
        WHERE awaiting_reply_since IS NOT NULL
      `)).then(r => r.rows as any[]),

      db.execute(sql.raw(`
        SELECT COUNT(DISTINCT em.gmail_thread_id)::int AS n
        FROM email_tracking_pixels p
        JOIN email_messages em ON em.gmail_message_id = p.gmail_message_id
        WHERE p.is_hot = true
      `)).then(r => r.rows as any[]),

      db.execute(sql.raw(`
        SELECT COUNT(*)::int AS n FROM email_threads
        WHERE association_status = 'unassociated'
          OR id NOT IN (
            SELECT DISTINCT et2.id FROM email_threads et2
            JOIN email_messages em ON em.gmail_thread_id = et2.gmail_thread_id
            JOIN email_associations ea ON ea.email_message_id = em.id
          )
      `)).then(r => r.rows as any[]),
    ]);

    return {
      awaitingReply: Number(awaitingRow?.n || 0),
      hot:           Number(hotRow?.n || 0),
      unlinked:      Number(unlinkedRow?.n || 0),
    };
  } catch (err) {
    console.error("[awaiting-reply] getTriageSummary error:", err);
    return { awaitingReply: 0, hot: 0, unlinked: 0 };
  }
}

/**
 * Get threads awaiting reply (DB-tracked, up to 100)
 */
export async function getAwaitingReplyThreads(): Promise<Array<{
  gmailThreadId: string;
  awaitingReplySince: string;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  replyStatus: string;
  primaryContactId: number | null;
  primaryAccountId: number | null;
  primaryLeadId: number | null;
  sender: string | null;
  subject: string | null;
}>> {
  try {
    const rows = (await db.execute(sql.raw(`
      SELECT
        et.gmail_thread_id,
        et.awaiting_reply_since,
        et.last_inbound_at,
        et.last_outbound_at,
        et.reply_status,
        et.primary_contact_id,
        et.primary_account_id,
        et.primary_lead_id,
        em.from_email    AS sender,
        em.subject
      FROM email_threads et
      LEFT JOIN LATERAL (
        SELECT from_email, subject FROM email_messages
        WHERE gmail_thread_id = et.gmail_thread_id
          AND direction = 'inbound'
        ORDER BY sent_at DESC NULLS LAST
        LIMIT 1
      ) em ON true
      WHERE et.awaiting_reply_since IS NOT NULL
      ORDER BY et.awaiting_reply_since ASC NULLS LAST
      LIMIT 100
    `))).rows as any[];

    return rows.map(r => ({
      gmailThreadId:    r.gmail_thread_id,
      awaitingReplySince: r.awaiting_reply_since,
      lastInboundAt:    r.last_inbound_at ?? null,
      lastOutboundAt:   r.last_outbound_at ?? null,
      replyStatus:      r.reply_status || "none",
      primaryContactId: r.primary_contact_id ?? null,
      primaryAccountId: r.primary_account_id ?? null,
      primaryLeadId:    r.primary_lead_id ?? null,
      sender:  r.sender  ?? null,
      subject: r.subject ?? null,
    }));
  } catch (err) {
    console.error("[awaiting-reply] getAwaitingReplyThreads error:", err);
    return [];
  }
}
