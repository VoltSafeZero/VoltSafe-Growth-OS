/**
 * Capital Email Linker — Phase 2D
 *
 * Provides fire-and-forget linking between VoltSafe Mail messages/threads and
 * Capital investors/contacts. Called from the Gmail incremental sync pipeline
 * after each new message is inserted.
 *
 * Matching strategy (conservative by design):
 *  1. Exact email match against capital_contacts.email → auto_exact_contact link
 *  2. Non-generic business domain match → capital_email_review queue (pending review)
 *  3. Generic / free-mail domains → ignored entirely
 *
 * All writes are idempotent: duplicate syncs do not create duplicate records.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

// ── Free / generic email domains — never auto-link by domain ─────────────────
export const FREE_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com",
  "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com",
  "live.com", "msn.com", "yahoo.ca", "hotmail.ca", "ymail.com",
  "mail.com", "zohomail.com", "fastmail.com", "hey.com",
]);

function esc(v: string): string { return String(v).replace(/'/g, "''"); }

function extractDomain(email: string): string | null {
  const m = email.toLowerCase().match(/@([\w.-]+)$/);
  return m ? m[1] : null;
}

function parseParticipantEmails(
  fromEmail: string | null,
  toEmailsJson: string | null,
): string[] {
  const out: string[] = [];
  if (fromEmail?.trim()) out.push(fromEmail.trim().toLowerCase());
  if (toEmailsJson) {
    try {
      const arr = JSON.parse(toEmailsJson);
      if (Array.isArray(arr)) {
        for (const e of arr) {
          if (typeof e === "string" && e.trim()) out.push(e.trim().toLowerCase());
        }
      }
    } catch { /* non-JSON, skip */ }
  }
  return [...new Set(out)];
}

export interface LinkResult {
  matched: boolean;
  linkType: "auto_exact_contact" | "review_queue" | "no_match";
  investorId?: number;
  contactId?: number;
  reviewId?: number;
  reason: string;
}

export async function tryCapitalEmailLink(emailMessageDbId: number): Promise<LinkResult> {
  // 1. Fetch the message
  const msgRows = await db.execute(sql.raw(`
    SELECT id, gmail_message_id, gmail_thread_id,
           from_email, from_name, to_emails, subject,
           snippet, direction, sent_at
    FROM email_messages
    WHERE id = ${emailMessageDbId}
    LIMIT 1
  `));
  const msg = msgRows.rows[0] as any;
  if (!msg) return { matched: false, linkType: "no_match", reason: "message not found" };

  const participants = parseParticipantEmails(msg.from_email, msg.to_emails);
  const subject   = msg.subject ?? "";
  const threadId  = msg.gmail_thread_id ?? null;
  const messageId = msg.gmail_message_id ?? null;
  const direction = msg.direction ?? "unknown";
  const sentAt    = msg.sent_at ?? null;

  // 2. Exact contact email match
  for (const email of participants) {
    const contactRows = await db.execute(sql.raw(`
      SELECT cc.id AS contact_id, cc.investor_id,
             ci.name AS investor_name
      FROM capital_contacts cc
      JOIN capital_investors ci ON ci.id = cc.investor_id
      WHERE LOWER(cc.email) = '${esc(email)}'
      LIMIT 1
    `));
    const contact = contactRows.rows[0] as any;
    if (!contact) continue;

    const investorId = contact.investor_id as number;
    const contactId  = contact.contact_id  as number;

    // Upsert link
    const linkId = await upsertEmailLink({
      investorId, contactId,
      threadId, messageId, emailDbId: emailMessageDbId,
      subject, direction,
      participants: participants.join(", "),
      latestMessageAt: sentAt,
      linkType: "auto_exact_contact",
      matchConfidence: 100,
      matchReason: `Exact email match: ${email}`,
    });

    // Upsert activity (deduped by thread + investor)
    if (linkId) {
      await upsertEmailActivity({
        investorId, contactId,
        threadId, messageId,
        subject, direction,
        participants: participants.join(", "),
        sentAt,
      });
      // Update last_touch_at
      await db.execute(sql.raw(`
        UPDATE capital_investors
        SET last_touch_at = COALESCE('${sentAt ?? "NOW()"}', last_touch_at)
        WHERE id = ${investorId}
          AND (last_touch_at IS NULL OR last_touch_at < COALESCE('${sentAt ?? "NOW()"}', NOW()))
      `)).catch(() => {});
    }

    return {
      matched: true,
      linkType: "auto_exact_contact",
      investorId,
      contactId,
      reason: `Exact email match: ${email}`,
    };
  }

  // 3. Conservative domain fallback → review queue (non-free domains only)
  for (const email of participants) {
    const domain = extractDomain(email);
    if (!domain || FREE_DOMAINS.has(domain)) continue;

    // Check if this domain/thread is already in review or linked
    const alreadyReviewed = await db.execute(sql.raw(`
      SELECT 1 FROM capital_email_review
      WHERE email_thread_id = ${threadId ? `'${esc(threadId)}'` : "NULL"}
        AND status IN ('pending','approved','rejected')
      LIMIT 1
    `)).then(r => r.rows.length > 0).catch(() => false);

    if (alreadyReviewed) break;

    // Look for investor with matching website domain or org
    const investorRows = await db.execute(sql.raw(`
      SELECT ci.id, ci.name
      FROM capital_investors ci
      WHERE (
        LOWER(REPLACE(REPLACE(ci.website,'https://',''),'http://','')) LIKE '%${esc(domain)}%'
        OR ci.name ILIKE '%${esc(domain.split(".")[0])}%'
      )
      AND ci.do_not_contact IS NOT TRUE
      LIMIT 1
    `));
    const guessedInvestor = investorRows.rows[0] as any;

    // Create review queue item
    const reviewRow = await db.execute(sql.raw(`
      INSERT INTO capital_email_review
        (email_thread_id, email_message_id, email_db_id, subject,
         sender_email, participants, snippet, latest_message_at,
         guessed_investor_id, match_reason, match_confidence, status)
      VALUES (
        ${threadId  ? `'${esc(threadId)}'`  : "NULL"},
        ${messageId ? `'${esc(messageId)}'` : "NULL"},
        ${emailMessageDbId},
        ${subject   ? `'${esc(subject)}'`   : "NULL"},
        '${esc(email)}',
        '${esc(participants.join(", "))}',
        ${msg.snippet ? `'${esc(msg.snippet)}'` : "NULL"},
        ${sentAt ? `'${sentAt}'` : "NULL"},
        ${guessedInvestor ? guessedInvestor.id : "NULL"},
        'Domain match: ${esc(domain)}',
        ${guessedInvestor ? 40 : 20},
        'pending'
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `)).catch(() => ({ rows: [] }));

    const reviewId = (reviewRow.rows[0] as any)?.id;
    return {
      matched: false,
      linkType: "review_queue",
      reviewId,
      reason: `Domain ${domain} sent to review queue`,
    };
  }

  return { matched: false, linkType: "no_match", reason: "no capital contact match" };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function upsertEmailLink(opts: {
  investorId: number; contactId: number | null;
  threadId: string | null; messageId: string | null; emailDbId: number;
  subject: string; direction: string; participants: string;
  latestMessageAt: string | null; linkType: string;
  matchConfidence: number; matchReason: string;
}): Promise<number | null> {
  const { investorId, contactId, threadId, messageId, emailDbId,
          subject, direction, participants, latestMessageAt,
          linkType, matchConfidence, matchReason } = opts;

  // Try upsert by thread + investor (update if newer message)
  if (threadId) {
    const existing = await db.execute(sql.raw(`
      SELECT id FROM capital_email_links
      WHERE email_thread_id = '${esc(threadId)}'
        AND capital_investor_id = ${investorId}
        AND deleted_at IS NULL
      LIMIT 1
    `));
    if (existing.rows.length > 0) {
      const linkId = (existing.rows[0] as any).id;
      // Update latest_message_at and last_synced_at
      await db.execute(sql.raw(`
        UPDATE capital_email_links SET
          latest_message_at = GREATEST(
            COALESCE(latest_message_at, '1970-01-01'),
            COALESCE(${latestMessageAt ? `'${latestMessageAt}'` : "NOW()"}, NOW())
          ),
          last_synced_at = NOW(),
          updated_at = NOW()
          ${contactId ? `, capital_contact_id = COALESCE(capital_contact_id, ${contactId})` : ""}
        WHERE id = ${linkId}
      `)).catch(() => {});
      return linkId;
    }
  }

  // Fresh insert
  const row = await db.execute(sql.raw(`
    INSERT INTO capital_email_links
      (capital_investor_id, capital_contact_id,
       email_thread_id, email_message_id, email_db_id,
       subject, direction, participants,
       latest_message_at, link_type, match_confidence, match_reason,
       first_linked_at, last_synced_at)
    VALUES (
      ${investorId},
      ${contactId ?? "NULL"},
      ${threadId  ? `'${esc(threadId)}'`  : "NULL"},
      ${messageId ? `'${esc(messageId)}'` : "NULL"},
      ${emailDbId},
      ${subject   ? `'${esc(subject)}'`   : "NULL"},
      '${esc(direction)}',
      '${esc(participants)}',
      ${latestMessageAt ? `'${latestMessageAt}'` : "NOW()"},
      '${esc(linkType)}',
      ${matchConfidence},
      ${matchReason ? `'${esc(matchReason)}'` : "NULL"},
      NOW(), NOW()
    )
    ON CONFLICT DO NOTHING
    RETURNING id
  `)).catch(() => ({ rows: [] }));

  return (row.rows[0] as any)?.id ?? null;
}

async function upsertEmailActivity(opts: {
  investorId: number; contactId: number | null;
  threadId: string | null; messageId: string | null;
  subject: string; direction: string; participants: string;
  sentAt: string | null;
}): Promise<void> {
  const { investorId, contactId, threadId, subject, direction, participants, sentAt } = opts;

  if (!threadId) return;

  // Check for existing activity for this thread + investor
  const existing = await db.execute(sql.raw(`
    SELECT id FROM capital_activities
    WHERE entity_type = 'investor'
      AND entity_id = ${investorId}
      AND activity_type = 'Email'
      AND email_thread_id = '${esc(threadId)}'
    LIMIT 1
  `));

  if (existing.rows.length > 0) {
    // Update activity_at to latest message time
    await db.execute(sql.raw(`
      UPDATE capital_activities
      SET activity_at = GREATEST(
            COALESCE(activity_at, '1970-01-01'),
            COALESCE(${sentAt ? `'${sentAt}'` : "NOW()"}, NOW())
          ),
          updated_at = NOW()
      WHERE id = ${(existing.rows[0] as any).id}
    `)).catch(() => {});
    return;
  }

  const dirLabel = direction === "inbound" ? "Inbound" : direction === "outbound" ? "Outbound" : "";
  const title    = subject ? `${dirLabel ? `[${dirLabel}] ` : ""}${subject}` : `Email conversation`;
  const body     = `Participants: ${participants}${threadId ? ` | thread:${threadId}` : ""}${contactId ? ` | contact:${contactId}` : ""}`;

  await db.execute(sql.raw(`
    INSERT INTO capital_activities
      (entity_type, entity_id, activity_type, title, body,
       email_thread_id, activity_at)
    VALUES (
      'investor', ${investorId},
      'Email',
      '${esc(title)}',
      '${esc(body)}',
      '${esc(threadId)}',
      ${sentAt ? `'${sentAt}'` : "NOW()"}
    )
    ON CONFLICT DO NOTHING
  `)).catch(() => {});
}

/**
 * Manually link an email thread/message to a Capital investor.
 * Called from the manual "Link to Capital" UI action.
 */
export async function manualCapitalEmailLink(opts: {
  investorId: number; contactId?: number | null;
  threadId?: string | null; messageId?: string | null; emailDbId?: number | null;
  subject?: string; direction?: string; participants?: string;
  latestMessageAt?: string | null; createdBy: number;
}): Promise<{ linkId: number | null }> {
  const { investorId, contactId, threadId, messageId, emailDbId,
          subject, direction, participants, latestMessageAt, createdBy } = opts;

  const linkId = await upsertEmailLink({
    investorId,
    contactId: contactId ?? null,
    threadId: threadId ?? null,
    messageId: messageId ?? null,
    emailDbId: emailDbId ?? 0,
    subject: subject ?? "",
    direction: direction ?? "unknown",
    participants: participants ?? "",
    latestMessageAt: latestMessageAt ?? null,
    linkType: "manual",
    matchConfidence: 100,
    matchReason: `Manually linked by user ${createdBy}`,
  });

  if (linkId && investorId) {
    await upsertEmailActivity({
      investorId,
      contactId: contactId ?? null,
      threadId: threadId ?? null,
      messageId: messageId ?? null,
      subject: subject ?? "",
      direction: direction ?? "unknown",
      participants: participants ?? "",
      sentAt: latestMessageAt ?? null,
    });
    await db.execute(sql.raw(`
      UPDATE capital_investors SET last_touch_at = NOW() WHERE id = ${investorId}
    `)).catch(() => {});
  }

  return { linkId };
}
