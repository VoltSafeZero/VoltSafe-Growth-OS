/**
 * Campaign Reply Ingestion Service — Phase 8
 *
 * Automatically matches inbound Gmail replies back to campaign recipients.
 * Creates replied campaign_events, updates replied_at, triggers classification
 * and optional task creation.
 *
 * Matching priority (fail-conservative — unmatched beats wrong match):
 *   1. gmailThreadId == campaign_sent_messages.provider_thread_id
 *   2. In-Reply-To / References header matches provider_message_id
 *   3. fromEmail + normalizedSubject + 30-day window (single unambiguous match only)
 *
 * Do NOT implement automated reply sending.
 * Do NOT implement branch-based drip changes.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { classifyCampaignReply, createTaskFromClassification } from "./campaign-reply-classifier";

// ── SQL-safe string escape ────────────────────────────────────────────────────

function sq(val: string): string {
  return "'" + val.replace(/'/g, "''") + "'";
}

// ── Migration ─────────────────────────────────────────────────────────────────

export async function migrateReplyIngestionSchema(): Promise<void> {
  // campaign_sent_messages: tracks outbound campaign sends with provider IDs
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS campaign_sent_messages (
      id                    SERIAL PRIMARY KEY,
      campaign_id           INTEGER NOT NULL,
      campaign_email_id     INTEGER,
      campaign_recipient_id INTEGER NOT NULL,
      contact_id            INTEGER,
      account_id            INTEGER,
      recipient_email       TEXT NOT NULL,
      provider_message_id   TEXT,
      provider_thread_id    TEXT,
      subject               TEXT,
      sent_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      metadata_json         JSONB
    )
  `));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_csm_provider_message_id ON campaign_sent_messages(provider_message_id) WHERE provider_message_id IS NOT NULL`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_csm_provider_thread_id  ON campaign_sent_messages(provider_thread_id)  WHERE provider_thread_id  IS NOT NULL`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_csm_campaign_recipient  ON campaign_sent_messages(campaign_recipient_id)`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_csm_contact_id          ON campaign_sent_messages(contact_id) WHERE contact_id IS NOT NULL`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_csm_account_id          ON campaign_sent_messages(account_id) WHERE account_id IS NOT NULL`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_csm_recipient_email     ON campaign_sent_messages(recipient_email)`));

  // campaign_unmatched_replies: stores inbound replies we couldn't match to a recipient
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS campaign_unmatched_replies (
      id                    SERIAL PRIMARY KEY,
      from_email            TEXT NOT NULL,
      subject               TEXT,
      body_preview          TEXT,
      provider_message_id   TEXT,
      provider_thread_id    TEXT,
      in_reply_to           TEXT,
      received_at           TIMESTAMPTZ,
      match_attempts        INTEGER NOT NULL DEFAULT 1,
      status                TEXT    NOT NULL DEFAULT 'unmatched',
      possible_matches_json JSONB,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `));
  await db.execute(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cur_provider_message_id ON campaign_unmatched_replies(provider_message_id) WHERE provider_message_id IS NOT NULL`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_cur_status          ON campaign_unmatched_replies(status)`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_cur_provider_thread ON campaign_unmatched_replies(provider_thread_id) WHERE provider_thread_id IS NOT NULL`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_cur_from_email      ON campaign_unmatched_replies(from_email)`));

  // Additive columns
  await db.execute(sql.raw(`ALTER TABLE email_messages           ADD COLUMN IF NOT EXISTS in_reply_to     TEXT`));
  await db.execute(sql.raw(`ALTER TABLE campaign_reply_classifications ADD COLUMN IF NOT EXISTS ingestion_source TEXT DEFAULT 'manual'`));

  console.log("[migration] Reply ingestion schema ready.");
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InboundReplyInput {
  fromEmail: string;
  toEmail?: string | null;
  subject?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  providerMessageId?: string | null;
  providerThreadId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  receivedAt?: Date | null;
  /** Internal email_messages.id if already stored in DB */
  emailMessageDbId?: number | null;
}

export type MatchMethod = "thread_id" | "in_reply_to" | "references" | "subject_fallback";

export type MatchResult =
  | {
      matched: true;
      campaignRecipientId: number;
      campaignId: number;
      contactId: number | null;
      accountId: number | null;
      matchMethod: MatchMethod;
      sentMessageId: number;
    }
  | { matched: false; reason: string };

// ── Store sent campaign message ───────────────────────────────────────────────

export async function storeSentCampaignMessage(data: {
  campaignId: number;
  campaignEmailId?: number | null;
  campaignRecipientId: number;
  contactId?: number | null;
  accountId?: number | null;
  recipientEmail: string;
  providerMessageId?: string | null;
  providerThreadId?: string | null;
  subject?: string | null;
  sentAt?: Date;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.execute(sql.raw(`
      INSERT INTO campaign_sent_messages
        (campaign_id, campaign_email_id, campaign_recipient_id, contact_id, account_id,
         recipient_email, provider_message_id, provider_thread_id, subject, sent_at, metadata_json)
      VALUES (
        ${data.campaignId},
        ${data.campaignEmailId ?? "NULL"},
        ${data.campaignRecipientId},
        ${data.contactId ?? "NULL"},
        ${data.accountId ?? "NULL"},
        ${sq(data.recipientEmail)},
        ${data.providerMessageId ? sq(data.providerMessageId) : "NULL"},
        ${data.providerThreadId ? sq(data.providerThreadId) : "NULL"},
        ${data.subject ? sq(data.subject) : "NULL"},
        ${data.sentAt ? sq(data.sentAt.toISOString()) : "NOW()"},
        ${data.metadata ? sq(JSON.stringify(data.metadata)) : "NULL"}
      )
      ON CONFLICT DO NOTHING
    `));
  } catch (err: any) {
    // Non-critical — campaign send already recorded; this is just for reply matching
    console.error("[reply-ingestion] storeSentCampaignMessage error:", err.message);
  }
}

// ── Match inbound reply to campaign recipient ─────────────────────────────────

export async function matchInboundReplyToCampaignRecipient(
  input: InboundReplyInput
): Promise<MatchResult> {
  const { fromEmail, subject, providerThreadId, providerMessageId, inReplyTo, references } = input;

  // ── Priority 1: Provider thread ID ──────────────────────────────────────────
  if (providerThreadId) {
    const [row] = (await db.execute(sql.raw(`
      SELECT id, campaign_id, campaign_recipient_id, contact_id, account_id
      FROM campaign_sent_messages
      WHERE provider_thread_id = ${sq(providerThreadId)}
      ORDER BY sent_at DESC
      LIMIT 1
    `))).rows as any[];
    if (row) {
      return {
        matched: true,
        campaignRecipientId: Number(row.campaign_recipient_id),
        campaignId: Number(row.campaign_id),
        contactId: row.contact_id ? Number(row.contact_id) : null,
        accountId: row.account_id ? Number(row.account_id) : null,
        matchMethod: "thread_id",
        sentMessageId: Number(row.id),
      };
    }
  }

  // ── Priority 2: In-Reply-To header → provider_message_id ────────────────────
  if (inReplyTo) {
    const cleaned = inReplyTo.replace(/[<>]/g, "").trim();
    if (cleaned) {
      const [row] = (await db.execute(sql.raw(`
        SELECT id, campaign_id, campaign_recipient_id, contact_id, account_id
        FROM campaign_sent_messages
        WHERE provider_message_id = ${sq(cleaned)}
        LIMIT 1
      `))).rows as any[];
      if (row) {
        return {
          matched: true,
          campaignRecipientId: Number(row.campaign_recipient_id),
          campaignId: Number(row.campaign_id),
          contactId: row.contact_id ? Number(row.contact_id) : null,
          accountId: row.account_id ? Number(row.account_id) : null,
          matchMethod: "in_reply_to",
          sentMessageId: Number(row.id),
        };
      }
    }
  }

  // ── Priority 3: References header (any contained ID) ──────────────────────
  if (references) {
    const refIds = references
      .split(/[\s,]+/)
      .map(r => r.replace(/[<>]/g, "").trim())
      .filter(Boolean);
    for (const refId of refIds) {
      const [row] = (await db.execute(sql.raw(`
        SELECT id, campaign_id, campaign_recipient_id, contact_id, account_id
        FROM campaign_sent_messages
        WHERE provider_message_id = ${sq(refId)}
        LIMIT 1
      `))).rows as any[];
      if (row) {
        return {
          matched: true,
          campaignRecipientId: Number(row.campaign_recipient_id),
          campaignId: Number(row.campaign_id),
          contactId: row.contact_id ? Number(row.contact_id) : null,
          accountId: row.account_id ? Number(row.account_id) : null,
          matchMethod: "references",
          sentMessageId: Number(row.id),
        };
      }
    }
  }

  // ── Priority 4: fromEmail + normalized subject + 30-day window ──────────────
  // Conservative: only match if there is exactly ONE candidate (no ambiguity).
  if (fromEmail && subject) {
    const normalised = normalizeSubjectStr(subject);
    if (normalised) {
      const rows = (await db.execute(sql.raw(`
        SELECT id, campaign_id, campaign_recipient_id, contact_id, account_id
        FROM campaign_sent_messages
        WHERE recipient_email ILIKE ${sq(fromEmail)}
          AND LOWER(REGEXP_REPLACE(COALESCE(subject,''), '^(re:\\s*|fwd:\\s*)+', '', 'gi')) = LOWER(${sq(normalised)})
          AND sent_at > NOW() - INTERVAL '30 days'
        ORDER BY sent_at DESC
        LIMIT 2
      `))).rows as any[];
      if (rows.length === 1) {
        const row = rows[0] as any;
        return {
          matched: true,
          campaignRecipientId: Number(row.campaign_recipient_id),
          campaignId: Number(row.campaign_id),
          contactId: row.contact_id ? Number(row.contact_id) : null,
          accountId: row.account_id ? Number(row.account_id) : null,
          matchMethod: "subject_fallback",
          sentMessageId: Number(row.id),
        };
      }
      // rows.length === 0: no match; rows.length > 1: ambiguous → unmatched
    }
  }

  return { matched: false, reason: "No matching campaign sent message found" };
}

function normalizeSubjectStr(subject: string): string {
  return subject.replace(/^(re:\s*|fwd:\s*)+/gi, "").trim();
}

// ── Process inbound reply ──────────────────────────────────────────────────────

const VOLTSAFE_DOMAINS = new Set(["voltsafe.com", "voltsafe.test"]);

export async function processInboundEmailForCampaignReply(input: InboundReplyInput): Promise<{
  status: "matched" | "unmatched" | "skipped" | "duplicate";
  classificationId?: number;
  matchMethod?: MatchMethod;
}> {
  // Skip outbound (our own domains)
  const domain = (input.fromEmail ?? "").split("@")[1]?.toLowerCase() ?? "";
  if (VOLTSAFE_DOMAINS.has(domain)) {
    return { status: "skipped" };
  }

  // Idempotency: skip if this provider_message_id already has a classification
  if (input.providerMessageId) {
    const [existing] = (await db.execute(sql.raw(`
      SELECT id FROM campaign_reply_classifications
      WHERE source_message_id = ${sq(input.providerMessageId)}
      LIMIT 1
    `))).rows as any[];
    if (existing) return { status: "duplicate" };

    // Also skip if it's already in the unmatched queue
    const [existingUnmatched] = (await db.execute(sql.raw(`
      SELECT id FROM campaign_unmatched_replies
      WHERE provider_message_id = ${sq(input.providerMessageId)}
      LIMIT 1
    `))).rows as any[];
    if (existingUnmatched) return { status: "duplicate" };
  }

  const matchResult = await matchInboundReplyToCampaignRecipient(input);

  if (!matchResult.matched) {
    await storeUnmatchedReply(input);
    return { status: "unmatched" };
  }

  const { campaignRecipientId, campaignId, contactId, accountId, matchMethod, sentMessageId } = matchResult;

  // Record replied campaign_event
  try {
    await db.execute(sql.raw(`
      INSERT INTO campaign_events
        (campaign_id, recipient_id, contact_id, account_id, event_type, metadata, created_at)
      VALUES (
        ${campaignId},
        ${campaignRecipientId},
        ${contactId ?? "NULL"},
        ${accountId ?? "NULL"},
        'replied',
        ${sq(JSON.stringify({
          match_method: matchMethod,
          source_message_id: input.providerMessageId ?? null,
          source_thread_id: input.providerThreadId ?? null,
          sent_message_id: sentMessageId,
          ingestion_source: "inbound_ingested",
        }))},
        NOW()
      )
    `));
  } catch { /* non-critical */ }

  // Update replied_at on recipient
  try {
    await db.execute(sql.raw(`
      UPDATE campaign_recipients
      SET replied_at = NOW(), updated_at = NOW()
      WHERE id = ${campaignRecipientId} AND replied_at IS NULL
    `));
  } catch { /* non-critical */ }

  // Classify the reply
  let classificationId: number | undefined;
  try {
    const classification = await classifyCampaignReply({
      campaignRecipientId,
      replyBody: input.bodyText ?? input.bodyHtml ?? "",
      sourceMessageId: input.providerMessageId ?? null,
      sourceThreadId: input.providerThreadId ?? null,
      ingestionSource: "inbound_ingested",
    });
    classificationId = classification.id;

    // Auto-create task only for highest-intent, non-sensitive classifications
    if (classification.id && AUTO_TASK_CLASSIFICATIONS.has(classification.classification)) {
      createTaskFromClassification(classification.id, null).catch(() => {});
    }
  } catch (err: any) {
    console.error("[reply-ingestion] Classification error:", err.message);
  }

  return { status: "matched", classificationId, matchMethod };
}

/** Classifications that automatically generate a CRM task on inbound ingestion. */
const AUTO_TASK_CLASSIFICATIONS = new Set(["meeting_request", "interested"]);

// ── Store unmatched reply ─────────────────────────────────────────────────────

async function storeUnmatchedReply(input: InboundReplyInput): Promise<void> {
  try {
    const preview = (input.bodyText ?? "").slice(0, 300);
    await db.execute(sql.raw(`
      INSERT INTO campaign_unmatched_replies
        (from_email, subject, body_preview, provider_message_id, provider_thread_id,
         in_reply_to, received_at, match_attempts, status, created_at, updated_at)
      VALUES (
        ${sq(input.fromEmail ?? "")},
        ${input.subject ? sq(input.subject) : "NULL"},
        ${preview ? sq(preview) : "NULL"},
        ${input.providerMessageId ? sq(input.providerMessageId) : "NULL"},
        ${input.providerThreadId ? sq(input.providerThreadId) : "NULL"},
        ${input.inReplyTo ? sq(input.inReplyTo) : "NULL"},
        ${input.receivedAt ? sq(input.receivedAt.toISOString()) : "NOW()"},
        1, 'unmatched', NOW(), NOW()
      )
      ON CONFLICT (provider_message_id) WHERE provider_message_id IS NOT NULL DO UPDATE
        SET match_attempts = campaign_unmatched_replies.match_attempts + 1,
            updated_at = NOW()
    `));
  } catch (err: any) {
    console.error("[reply-ingestion] storeUnmatchedReply error:", err.message);
  }
}

// ── Get unmatched replies ─────────────────────────────────────────────────────

export async function getUnmatchedReplies(filters: {
  status?: string;
  limit?: number;
} = {}): Promise<any[]> {
  const statusClause = filters.status
    ? `WHERE status = ${sq(filters.status)}`
    : `WHERE status != 'matched'`;
  const limit = Math.min(filters.limit ?? 50, 200);
  return (await db.execute(sql.raw(`
    SELECT id, from_email, subject, body_preview, provider_message_id, provider_thread_id,
           in_reply_to, received_at, match_attempts, status, possible_matches_json,
           created_at, updated_at
    FROM campaign_unmatched_replies
    ${statusClause}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `))).rows as any[];
}

// ── Retry unmatched queue ────────────────────────────────────────────────────

export async function processUnmatchedCampaignReplies(limit = 20): Promise<{
  processed: number;
  matched: number;
}> {
  const rows = (await db.execute(sql.raw(`
    SELECT id, from_email, subject, body_preview, provider_message_id,
           provider_thread_id, in_reply_to, received_at
    FROM campaign_unmatched_replies
    WHERE status = 'unmatched' AND match_attempts < 5
    ORDER BY created_at DESC
    LIMIT ${limit}
  `))).rows as any[];

  let processed = 0;
  let matched = 0;

  for (const row of rows) {
    processed++;
    try {
      const result = await processInboundEmailForCampaignReply({
        fromEmail: row.from_email,
        subject: row.subject,
        bodyText: row.body_preview,
        providerMessageId: row.provider_message_id,
        providerThreadId: row.provider_thread_id,
        inReplyTo: row.in_reply_to,
        receivedAt: row.received_at ? new Date(row.received_at) : null,
      });
      if (result.status === "matched") {
        matched++;
        await db.execute(sql.raw(`
          UPDATE campaign_unmatched_replies
          SET status = 'matched', updated_at = NOW()
          WHERE id = ${Number(row.id)}
        `));
      } else {
        await db.execute(sql.raw(`
          UPDATE campaign_unmatched_replies
          SET match_attempts = match_attempts + 1, updated_at = NOW()
          WHERE id = ${Number(row.id)}
        `));
      }
    } catch (err: any) {
      console.error("[reply-ingestion] retry error for id:", row.id, err.message);
    }
  }
  return { processed, matched };
}

// ── Scan recent inbound replies from email_messages ────────────────────────────
// This bridges the gap: picks up inbound replies already stored by Gmail sync
// that have not yet been matched to a campaign recipient.

export async function scanRecentInboundReplies(options: {
  hoursBack?: number;
  limit?: number;
}): Promise<{
  scanned: number;
  matched: number;
  unmatched: number;
  skipped: number;
}> {
  const hoursBack = Math.min(options.hoursBack ?? 24, 168); // max 7 days
  const limit = Math.min(options.limit ?? 100, 500);

  const rows = (await db.execute(sql.raw(`
    SELECT em.id, em.gmail_message_id, em.gmail_thread_id, em.from_email,
           em.normalized_subject, em.snippet, em.sent_at, em.in_reply_to
    FROM email_messages em
    WHERE em.direction = 'inbound'
      AND em.is_reply = TRUE
      AND em.sent_at > NOW() - INTERVAL '${hoursBack} hours'
      AND em.gmail_message_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM campaign_reply_classifications crc
        WHERE crc.source_message_id = em.gmail_message_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM campaign_unmatched_replies cur
        WHERE cur.provider_message_id = em.gmail_message_id
      )
    ORDER BY em.sent_at DESC
    LIMIT ${limit}
  `))).rows as any[];

  let matchedCount = 0;
  let unmatchedCount = 0;
  let skippedCount = 0;

  for (const row of rows) {
    try {
      const result = await processInboundEmailForCampaignReply({
        fromEmail: row.from_email ?? "",
        subject: row.normalized_subject ?? "",
        bodyText: row.snippet ?? "",
        providerMessageId: row.gmail_message_id,
        providerThreadId: row.gmail_thread_id,
        inReplyTo: row.in_reply_to,
        receivedAt: row.sent_at ? new Date(row.sent_at) : null,
        emailMessageDbId: Number(row.id),
      });
      if (result.status === "matched") matchedCount++;
      else if (result.status === "unmatched") unmatchedCount++;
      else skippedCount++;
    } catch (err: any) {
      console.error("[reply-ingestion] scan error msgId:", row.gmail_message_id, err.message);
      unmatchedCount++;
    }
  }

  return { scanned: rows.length, matched: matchedCount, unmatched: unmatchedCount, skipped: skippedCount };
}
