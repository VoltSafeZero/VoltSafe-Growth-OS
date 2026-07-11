// Mailbox Integrity Service
//
// Provides two capabilities:
//
// 1. backfillAllParticipants() — one-time idempotent repair of the
//    all_participants column for rows where it is NULL or empty.
//    Root cause: all_participants was added as a schema column after some
//    messages were first imported. Those rows have all_participants=NULL,
//    which causes CC/To participant searches to silently miss them (since
//    the search relied on all_participants LIKE before we added explicit
//    cc_emails coverage). This function rebuilds all_participants from the
//    three authoritative raw columns: from_email, to_emails, cc_emails.
//
// 2. getMailboxAudit(userId) — admin-only integrity report for all
//    connected mailboxes visible to the user, showing sync coverage,
//    participant-field completeness, and a health status.

import { db } from "../db";
import { sql } from "drizzle-orm";

const log = (...a: any[]) => console.log("[mailbox-integrity]", ...a);

// ── 1. all_participants backfill ─────────────────────────────────────────────

let backfillDone = false;

export async function backfillAllParticipants(opts?: { force?: boolean }): Promise<void> {
  if (backfillDone && !opts?.force) return;
  backfillDone = true;

  try {
    // Count how many rows need repair before touching anything.
    const countRes = await db.execute(sql.raw(`
      SELECT count(*)::int AS n
      FROM email_messages
      WHERE all_participants IS NULL OR all_participants = '' OR all_participants = '[]'
    `));
    const rows = (countRes as any).rows ?? countRes;
    const needsRepair: number = rows[0]?.n ?? 0;

    if (needsRepair === 0) {
      log("all_participants backfill: no rows need repair — skipping");
      return;
    }

    log(`all_participants backfill: ${needsRepair} rows need repair — starting`);
    const t0 = Date.now();

    // Rebuild all_participants as a de-duplicated JSON array from the three
    // authoritative raw columns.  We do this in pure SQL so it runs in a single
    // round-trip without pulling every row into Node memory.
    //
    // Strategy:
    //   1. Split to_emails and cc_emails on commas (they are stored as plain
    //      comma-separated strings, e.g. "a@x.com, b@y.com").
    //   2. Union with from_email.
    //   3. Trim whitespace and lower-case each address.
    //   4. Deduplicate and filter out empty strings.
    //   5. Re-encode as a JSON array string to match the format that
    //      parseGmailMessage produces and that the rest of the system expects.
    //
    // NULL to_emails / cc_emails are handled via COALESCE so they contribute
    // an empty string that the filter removes.
    //
    // Process in batches of 5000 to avoid locking the table for too long.
    let offset = 0;
    const BATCH = 5000;
    let totalFixed = 0;

    while (true) {
      const result = await db.execute(sql.raw(`
        WITH batch AS (
          SELECT id, from_email, to_emails, cc_emails
          FROM email_messages
          WHERE all_participants IS NULL OR all_participants = '' OR all_participants = '[]'
          ORDER BY id
          LIMIT ${BATCH} OFFSET ${offset}
        ),
        expanded AS (
          SELECT
            id,
            array_agg(DISTINCT lower(trim(addr))) FILTER (WHERE trim(addr) <> '') AS addrs
          FROM batch,
          LATERAL unnest(
            array_remove(
              string_to_array(
                coalesce(from_email,'') || ',' ||
                coalesce(to_emails,'') || ',' ||
                coalesce(cc_emails,''),
                ','
              ),
              NULL
            )
          ) AS addr
          GROUP BY id
        )
        UPDATE email_messages
        SET all_participants = to_json(e.addrs)::text
        FROM expanded e
        WHERE email_messages.id = e.id
          AND e.addrs IS NOT NULL
          AND array_length(e.addrs, 1) > 0
        RETURNING email_messages.id
      `));

      const fixed = ((result as any).rows ?? result).length;
      totalFixed += fixed;

      if (fixed < BATCH) break; // processed all remaining rows
      offset += BATCH;
    }

    log(`all_participants backfill: repaired ${totalFixed} rows in ${Date.now() - t0}ms`);
  } catch (e: any) {
    log(`all_participants backfill FAILED: ${e.message}`);
    // Non-fatal — the search LIKE clause now covers cc_emails directly,
    // so the system degrades gracefully rather than crashing on startup.
  }
}

// ── 2. Admin mailbox integrity audit ────────────────────────────────────────

export type MailboxAuditEntry = {
  accountId: number;
  emailAddress: string;
  ownerName: string | null;
  ownerEmail: string | null;
  provider: string;
  authStatus: string;
  lastIncrementalSync: string | null;
  oldestLocalMessage: string | null;
  newestLocalMessage: string | null;
  totalLocalMessages: number;
  totalLocalThreads: number;
  inboxMessages: number;
  sentMessages: number;
  archivedMessages: number;
  draftMessages: number;
  spamMessages: number;
  trashMessages: number;
  missingBody: number;
  missingSubject: number;
  missingThreadId: number;
  nullAllParticipants: number;
  nullCcEmails: number;
  health: "healthy" | "participants_incomplete" | "sync_stale" | "oauth_error" | "no_data";
  healthDetails: string[];
};

export async function getMailboxAudit(
  requestingUserId: number,
  isAdmin: boolean,
): Promise<MailboxAuditEntry[]> {
  // Admins see all accounts; regular users only see their own.
  const accountFilter = isAdmin
    ? ""
    : `WHERE ea.user_id = ${Number(requestingUserId)}`;

  const res = await db.execute(sql.raw(`
    SELECT
      ea.id                         AS account_id,
      ea.email_address,
      u.name                        AS owner_name,
      u.email                       AS owner_email,
      COALESCE(ea.provider, 'gmail') AS provider,
      COALESCE(ea.auth_status, 'unknown') AS auth_status,
      ea.updated_at                 AS last_incremental_sync,
      -- message-level stats (all non-destructive aggregates)
      COUNT(m.id)::int              AS total_local_messages,
      COUNT(DISTINCT m.gmail_thread_id)::int AS total_local_threads,
      MIN(m.sent_at)                AS oldest_local_message,
      MAX(m.sent_at)                AS newest_local_message,
      SUM(CASE WHEN m.is_inbox  = true THEN 1 ELSE 0 END)::int   AS inbox_messages,
      SUM(CASE WHEN m.is_sent   = true THEN 1 ELSE 0 END)::int   AS sent_messages,
      SUM(CASE WHEN m.is_draft  = true THEN 1 ELSE 0 END)::int   AS draft_messages,
      SUM(CASE WHEN m.is_spam   = true THEN 1 ELSE 0 END)::int   AS spam_messages,
      SUM(CASE WHEN m.is_trash  = true THEN 1 ELSE 0 END)::int   AS trash_messages,
      SUM(CASE WHEN m.is_inbox = false
               AND m.is_sent  = false
               AND m.is_draft = false
               AND m.is_spam  = false
               AND m.is_trash = false
               AND m.is_starred = false
               THEN 1 ELSE 0 END)::int AS archived_messages,
      -- completeness checks
      SUM(CASE WHEN (m.body_text IS NULL OR m.body_text = '')
               AND  (m.body_html IS NULL OR m.body_html = '')
               THEN 1 ELSE 0 END)::int  AS missing_body,
      SUM(CASE WHEN m.subject IS NULL OR m.subject = '' THEN 1 ELSE 0 END)::int AS missing_subject,
      SUM(CASE WHEN m.gmail_thread_id IS NULL OR m.gmail_thread_id = '' THEN 1 ELSE 0 END)::int AS missing_thread_id,
      SUM(CASE WHEN m.all_participants IS NULL OR m.all_participants = '' OR m.all_participants = '[]' THEN 1 ELSE 0 END)::int AS null_all_participants,
      SUM(CASE WHEN m.cc_emails IS NULL THEN 1 ELSE 0 END)::int AS null_cc_emails
    FROM email_accounts ea
    LEFT JOIN users u ON u.id = ea.user_id
    LEFT JOIN email_messages m ON m.source_account_id = ea.id AND m.ignored_reason IS NULL
    ${accountFilter}
    GROUP BY ea.id, ea.email_address, u.name, u.email, ea.provider, ea.auth_status, ea.updated_at
    ORDER BY ea.email_address
  `));

  const rawRows = ((res as any).rows ?? res) as any[];

  return rawRows.map((r) => {
    const healthDetails: string[] = [];
    let health: MailboxAuditEntry["health"] = "healthy";

    // Auth problems are the most critical
    if (r.auth_status === "revoked" || r.auth_status === "error" || r.auth_status === "expired") {
      healthDetails.push(`OAuth status: ${r.auth_status} — user must reconnect`);
      health = "oauth_error";
    }

    // No data at all
    if (!r.total_local_messages || r.total_local_messages === 0) {
      healthDetails.push("No messages stored locally — initial sync may not have run");
      if (health === "healthy") health = "no_data";
    }

    // Participant data completeness
    if (r.null_all_participants > 0) {
      const pct = r.total_local_messages > 0
        ? Math.round((r.null_all_participants / r.total_local_messages) * 100)
        : 0;
      healthDetails.push(`${r.null_all_participants} messages (${pct}%) have null all_participants — search may miss CC/To participants. Run participant backfill.`);
      if (health === "healthy") health = "participants_incomplete";
    }

    // Stale sync (last incremental sync > 30 min ago)
    if (r.last_incremental_sync) {
      const minsAgo = (Date.now() - new Date(r.last_incremental_sync).getTime()) / 60000;
      if (minsAgo > 60) {
        healthDetails.push(`Last incremental sync was ${Math.round(minsAgo)} minutes ago — may be stale`);
        if (health === "healthy") health = "sync_stale";
      }
    } else {
      healthDetails.push("No incremental sync timestamp recorded");
      if (health === "healthy") health = "sync_stale";
    }

    // Missing body text
    if (r.missing_body > 0) {
      const pct = r.total_local_messages > 0
        ? Math.round((r.missing_body / r.total_local_messages) * 100)
        : 0;
      healthDetails.push(`${r.missing_body} messages (${pct}%) missing body text — search quality degraded`);
    }

    // Missing thread IDs
    if (r.missing_thread_id > 0) {
      healthDetails.push(`${r.missing_thread_id} messages have no thread ID — thread grouping broken for these`);
    }

    return {
      accountId: r.account_id,
      emailAddress: r.email_address ?? "",
      ownerName: r.owner_name ?? null,
      ownerEmail: r.owner_email ?? null,
      provider: r.provider ?? "gmail",
      authStatus: r.auth_status ?? "unknown",
      lastIncrementalSync: r.last_incremental_sync ? new Date(r.last_incremental_sync).toISOString() : null,
      oldestLocalMessage: r.oldest_local_message ? new Date(r.oldest_local_message).toISOString() : null,
      newestLocalMessage: r.newest_local_message ? new Date(r.newest_local_message).toISOString() : null,
      totalLocalMessages: r.total_local_messages ?? 0,
      totalLocalThreads: r.total_local_threads ?? 0,
      inboxMessages: r.inbox_messages ?? 0,
      sentMessages: r.sent_messages ?? 0,
      archivedMessages: r.archived_messages ?? 0,
      draftMessages: r.draft_messages ?? 0,
      spamMessages: r.spam_messages ?? 0,
      trashMessages: r.trash_messages ?? 0,
      missingBody: r.missing_body ?? 0,
      missingSubject: r.missing_subject ?? 0,
      missingThreadId: r.missing_thread_id ?? 0,
      nullAllParticipants: r.null_all_participants ?? 0,
      nullCcEmails: r.null_cc_emails ?? 0,
      health: health as MailboxAuditEntry["health"],
      healthDetails,
    };
  });
}

// ── 3. Participant field repair for a single account ─────────────────────────

export async function repairParticipantsForAccount(accountId: number): Promise<{ fixed: number }> {
  const result = await db.execute(sql.raw(`
    WITH expanded AS (
      SELECT
        id,
        array_agg(DISTINCT lower(trim(addr))) FILTER (WHERE trim(addr) <> '') AS addrs
      FROM email_messages,
      LATERAL unnest(
        array_remove(
          string_to_array(
            coalesce(from_email,'') || ',' ||
            coalesce(to_emails,'') || ',' ||
            coalesce(cc_emails,''),
            ','
          ),
          NULL
        )
      ) AS addr
      WHERE source_account_id = ${Number(accountId)}
        AND (all_participants IS NULL OR all_participants = '' OR all_participants = '[]')
      GROUP BY id
    )
    UPDATE email_messages
    SET all_participants = to_json(e.addrs)::text
    FROM expanded e
    WHERE email_messages.id = e.id
      AND e.addrs IS NOT NULL
      AND array_length(e.addrs, 1) > 0
    RETURNING email_messages.id
  `));
  const fixed = ((result as any).rows ?? result).length;
  log(`repairParticipantsForAccount(${accountId}): fixed ${fixed} rows`);
  return { fixed };
}
