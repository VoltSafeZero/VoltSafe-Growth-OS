/**
 * campaign-reply-classifier.ts
 *
 * Phase 7 — Reply Classification + Sales Task Automation
 *
 * Classifies campaign replies using deterministic rules first, AI second.
 * Creates CRM tasks automatically for high-intent classifications.
 *
 * Phase 8 (Inbound Reply Ingestion) added automatic matching: Gmail sync
 * now hooks new inbound replies to processInboundEmailForCampaignReply()
 * in campaign-reply-ingestion.ts, which matches and classifies automatically.
 * The manual POST /api/marketing/replies/classify endpoint remains for
 * manual override and backfill.
 */

import OpenAI from "openai";
import { buildOpenAIModelParams } from "./openai-compat";
import { db } from "../db";
import { sql } from "drizzle-orm";

// ── Types ────────────────────────────────────────────────────────────────────

export type ReplyClassification =
  | "interested"
  | "meeting_request"
  | "referral"
  | "not_now"
  | "objection"
  | "technical_question"
  | "pricing_question"
  | "procurement_question"
  | "wrong_person"
  | "unsubscribe"
  | "negative"
  | "out_of_office"
  | "auto_reply"
  | "unknown";

export type ClassificationStatus =
  | "pending"
  | "reviewed"
  | "task_created"
  | "ignored"
  | "dismissed";

export type ReplyClassificationRecord = {
  id: number;
  campaign_id: number | null;
  campaign_email_id: number | null;
  campaign_recipient_id: number | null;
  contact_id: number | null;
  account_id: number | null;
  source_message_id: string | null;
  source_thread_id: string | null;
  reply_body_preview: string | null;
  classification: ReplyClassification;
  confidence: number;
  sentiment: "positive" | "neutral" | "negative" | "unknown";
  objection_type: string | null;
  recommended_action: string;
  recommended_task_title: string;
  recommended_task_body: string;
  assigned_to_user_id: number | null;
  task_id: number | null;
  status: ClassificationStatus;
  reviewed_by_user_id: number | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  metadata_json: Record<string, unknown> | null;
};

export type ClassifyInput = {
  campaignRecipientId: number;
  replyBody: string;
  sourceMessageId?: string | null;
  sourceThreadId?: string | null;
  /** Phase 8: "manual" (default) or "inbound_ingested" */
  ingestionSource?: string | null;
};

type ClassifyResult = {
  classification: ReplyClassification;
  confidence: number;
  sentiment: "positive" | "neutral" | "negative" | "unknown";
  objection_type: string | null;
  recommended_action: string;
  recommended_task_title: string;
  recommended_task_body: string;
};

// ── Migration ─────────────────────────────────────────────────────────────────

export async function migrateReplyClassificationSchema(): Promise<void> {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS campaign_reply_classifications (
      id                    SERIAL PRIMARY KEY,
      campaign_id           INTEGER,
      campaign_email_id     INTEGER,
      campaign_recipient_id INTEGER,
      contact_id            INTEGER,
      account_id            INTEGER,
      source_message_id     TEXT,
      source_thread_id      TEXT,
      reply_body_preview    TEXT,
      classification        TEXT NOT NULL DEFAULT 'unknown',
      confidence            REAL NOT NULL DEFAULT 0,
      sentiment             TEXT NOT NULL DEFAULT 'unknown',
      objection_type        TEXT,
      recommended_action    TEXT NOT NULL DEFAULT '',
      recommended_task_title TEXT NOT NULL DEFAULT '',
      recommended_task_body  TEXT NOT NULL DEFAULT '',
      assigned_to_user_id   INTEGER,
      task_id               INTEGER,
      status                TEXT NOT NULL DEFAULT 'pending',
      reviewed_by_user_id   INTEGER,
      reviewed_at           TIMESTAMPTZ,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      metadata_json         JSONB
    )
  `));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_crc_campaign_id
      ON campaign_reply_classifications(campaign_id)
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_crc_recipient_id
      ON campaign_reply_classifications(campaign_recipient_id)
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_crc_contact_id
      ON campaign_reply_classifications(contact_id)
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_crc_account_id
      ON campaign_reply_classifications(account_id)
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_crc_classification
      ON campaign_reply_classifications(classification)
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_crc_status
      ON campaign_reply_classifications(status)
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_crc_created_at
      ON campaign_reply_classifications(created_at)
  `));
}

// ── OpenAI client ─────────────────────────────────────────────────────────────

function buildOpenAIClient(): OpenAI | null {
  const apiKey =
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  return new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
}

// ── Rule-based classification ─────────────────────────────────────────────────

const UNSUBSCRIBE_PATTERNS = [
  /\bunsubscribe\b/i,
  /\bremove me\b/i,
  /\bstop emailing\b/i,
  /\bopt[- ]?out\b/i,
  /\bdo not (contact|email|send)\b/i,
  /\btake me off\b/i,
  /\bno longer (wish|want) to receive\b/i,
];

const NEGATIVE_PATTERNS = [
  /\bnot interested\b/i,
  /\bno thanks\b/i,
  /\bno thank you\b/i,
  /\bplease (don't|do not) (contact|email|send)\b/i,
  /\bnot a good fit\b/i,
  /\bnot for us\b/i,
  /\bnever contact\b/i,
];

const OUT_OF_OFFICE_PATTERNS = [
  /\bout of (office|town|country)\b/i,
  /\bon (vacation|holiday|leave|sabbatical)\b/i,
  /\baway from (the office|work|my desk|email)\b/i,
  /\bwill be (away|back|returning) (on|from)?\b/i,
  /\bcurrently (unavailable|out)\b/i,
];

const AUTO_REPLY_PATTERNS = [
  /\b(this is an? )?auto(matic)?[- ]?reply\b/i,
  /\bauto[- ]?response\b/i,
  /\bdo not reply to this (email|message)\b/i,
  /\bthis message was sent (automatically|from an unmonitored)\b/i,
  /\bnoreply\b/i,
];

const WRONG_PERSON_PATTERNS = [
  /\bwrong (person|email|address|contact)\b/i,
  /\bnot the right (person|contact)\b/i,
  /\bi('m| am) not the\b/i,
  /\byou (should|might|may) want to (contact|reach|speak with|talk to)\b/i,
];

const REFERRAL_PATTERNS = [
  /\b(talk|speak|reach out) to\b/i,
  /\bcontact (our|the|our|my)\b/i,
  /\btry ([A-Z][a-z]+)\b/,
  /\byou should (talk|speak|reach out|connect) (with|to)\b/i,
  /\bcc[- ](ing|ed)?\b/i,
];

const PRICING_PATTERNS = [
  /\bpric(e|es|ing)\b/i,
  /\bcost(s|ing)?\b/i,
  /\bbudget\b/i,
  /\brates?\b/i,
  /\bquote\b/i,
  /\bhow much\b/i,
  /\bROI\b/,
  /\bper unit\b/i,
  /\binvestment\b/i,
];

const TECHNICAL_PATTERNS = [
  /\btechnical\b/i,
  /\binstall(ation)?\b/i,
  /\belectrical\b/i,
  /\bCSA\b/,
  /\bUL[ -]?(listed|certified|approved)?\b/i,
  /\bwiring\b/i,
  /\bEVSE\b/i,
  /\bshore power\b/i,
  /\bamperage\b/i,
  /\bvoltage\b/i,
  /\brequest a specification\b/i,
  /\bcharger\b/i,
  /\bpedestal\b/i,
  /\bload (balance|management|calc)\b/i,
];

const PROCUREMENT_PATTERNS = [
  /\bprocurement\b/i,
  /\bRFP\b/i,
  /\bRFQ\b/i,
  /\btender\b/i,
  /\bboard (meeting|approval|vote)\b/i,
  /\bcouncil\b/i,
  /\bcommittee\b/i,
  /\bapproval process\b/i,
  /\bpurchasing\b/i,
];

const MEETING_PATTERNS = [
  /\b(book|schedule) (a |our )?(call|meeting|demo|time|appointment)\b/i,
  /\b(set up|arrange|organize) (a |our )?(call|meeting|demo)\b/i,
  /\b(would love|happy) to (chat|connect|talk|meet)\b/i,
  /\bcalendar\b/i,
  /\bcalendly\b/i,
  /\bavailability\b/i,
  /\bfree (for|on)?\b/i,
  /\bdemonstration\b/i,
  /\bwebinar\b/i,
];

const INTERESTED_PATTERNS = [
  /\binterested\b/i,
  /\bsend (me |us )?(more|info|information|details)\b/i,
  /\btell (me|us) more\b/i,
  /\bwould like to (know|learn|hear)\b/i,
  /\bsounds (good|great|interesting)\b/i,
  /\bplease (send|share|forward)\b/i,
  /\bexcited\b/i,
  /\bimpressed\b/i,
];

const NOT_NOW_PATTERNS = [
  /\bnot now\b/i,
  /\blater (this year|in the year|quarter|year)?\b/i,
  /\bnext (year|quarter|season|summer|spring|fall|winter)\b/i,
  /\bcircle back\b/i,
  /\breach out (later|again)\b/i,
  /\bin a few (months|weeks)\b/i,
  /\bnot (yet|at this (time|stage))\b/i,
  /\bwait until\b/i,
  /\bfollow[- ]?up (with me|again) (in|after|later)\b/i,
];

const OBJECTION_PATTERNS = [
  /\bconcerned?\b/i,
  /\bworr(y|ied)\b/i,
  /\bnot sure (about|if|whether)\b/i,
  /\bchallenge\b/i,
  /\bissue\b/i,
  /\bproblem\b/i,
  /\bhesitant\b/i,
  /\bdoubt\b/i,
  /\bskeptical\b/i,
  /\bunhappy\b/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(p => p.test(text));
}

function classifyRuleBased(body: string): ClassifyResult | null {
  const t = body.trim();

  if (matchesAny(t, AUTO_REPLY_PATTERNS)) {
    return {
      classification: "auto_reply",
      confidence: 0.95,
      sentiment: "neutral",
      objection_type: null,
      recommended_action: "No action required — automated response",
      recommended_task_title: "",
      recommended_task_body: "",
    };
  }

  if (matchesAny(t, OUT_OF_OFFICE_PATTERNS)) {
    return {
      classification: "out_of_office",
      confidence: 0.93,
      sentiment: "neutral",
      objection_type: null,
      recommended_action: "Contact replied while out of office — re-engage when they return",
      recommended_task_title: "",
      recommended_task_body: "",
    };
  }

  if (matchesAny(t, UNSUBSCRIBE_PATTERNS)) {
    return {
      classification: "unsubscribe",
      confidence: 0.97,
      sentiment: "negative",
      objection_type: null,
      recommended_action: "Process unsubscribe and suppress from future sends",
      recommended_task_title: "",
      recommended_task_body: "",
    };
  }

  if (matchesAny(t, NEGATIVE_PATTERNS)) {
    return {
      classification: "negative",
      confidence: 0.88,
      sentiment: "negative",
      objection_type: null,
      recommended_action: "Do not automatically suppress — flag for human review",
      recommended_task_title: "",
      recommended_task_body: "",
    };
  }

  if (matchesAny(t, WRONG_PERSON_PATTERNS)) {
    return {
      classification: "wrong_person",
      confidence: 0.87,
      sentiment: "neutral",
      objection_type: null,
      recommended_action: "Find the correct contact at this account and update CRM",
      recommended_task_title: "Update contact record — wrong person identified",
      recommended_task_body: "Recipient indicated they are not the right contact. Find the correct decision-maker at this account.",
    };
  }

  if (matchesAny(t, MEETING_PATTERNS)) {
    return {
      classification: "meeting_request",
      confidence: 0.91,
      sentiment: "positive",
      objection_type: null,
      recommended_action: "Schedule a call or demo immediately",
      recommended_task_title: "Schedule demo/call — meeting requested",
      recommended_task_body: "Recipient requested a meeting or demo. Follow up immediately to schedule.",
    };
  }

  if (matchesAny(t, PROCUREMENT_PATTERNS)) {
    return {
      classification: "procurement_question",
      confidence: 0.86,
      sentiment: "positive",
      objection_type: null,
      recommended_action: "Route to procurement team — formal process indicated",
      recommended_task_title: "Route to procurement — RFP/tender process",
      recommended_task_body: "Recipient has indicated a formal procurement or tendering process. Prepare documentation and route to appropriate team.",
    };
  }

  if (matchesAny(t, TECHNICAL_PATTERNS)) {
    return {
      classification: "technical_question",
      confidence: 0.85,
      sentiment: "positive",
      objection_type: null,
      recommended_action: "Send technical specifications or schedule technical call",
      recommended_task_title: "Technical follow-up — shore power/install question",
      recommended_task_body: "Recipient has a technical question. Send specifications or arrange a technical consultation.",
    };
  }

  if (matchesAny(t, PRICING_PATTERNS)) {
    return {
      classification: "pricing_question",
      confidence: 0.85,
      sentiment: "positive",
      objection_type: null,
      recommended_action: "Send pricing information and create follow-up opportunity",
      recommended_task_title: "Send pricing info — quote requested",
      recommended_task_body: "Recipient asked about pricing or costs. Send a proposal or pricing sheet.",
    };
  }

  if (matchesAny(t, REFERRAL_PATTERNS)) {
    return {
      classification: "referral",
      confidence: 0.78,
      sentiment: "neutral",
      objection_type: null,
      recommended_action: "Contact the referred person and update CRM",
      recommended_task_title: "Referral received — contact new lead",
      recommended_task_body: "Recipient referred you to another contact. Reach out to the referred person and add them to the CRM.",
    };
  }

  if (matchesAny(t, INTERESTED_PATTERNS)) {
    return {
      classification: "interested",
      confidence: 0.87,
      sentiment: "positive",
      objection_type: null,
      recommended_action: "Follow up with more information and move to active pipeline",
      recommended_task_title: "Follow up — expressed interest",
      recommended_task_body: "Recipient expressed interest. Send requested information and move to active opportunity.",
    };
  }

  if (matchesAny(t, NOT_NOW_PATTERNS)) {
    return {
      classification: "not_now",
      confidence: 0.82,
      sentiment: "neutral",
      objection_type: null,
      recommended_action: "Set a nurture reminder to re-engage in 60–90 days",
      recommended_task_title: "Nurture: circle back in 90 days",
      recommended_task_body: "Recipient is not ready now but asked to be contacted later. Set a re-engagement reminder.",
    };
  }

  if (matchesAny(t, OBJECTION_PATTERNS)) {
    return {
      classification: "objection",
      confidence: 0.72,
      sentiment: "negative",
      objection_type: "general",
      recommended_action: "Address objection and schedule a call to understand concerns",
      recommended_task_title: "Address objection — follow-up review",
      recommended_task_body: "Recipient raised concerns or objections. Schedule a call to understand and address their hesitation.",
    };
  }

  return null;
}

// ── AI fallback ───────────────────────────────────────────────────────────────

const VALID_CLASSIFICATIONS: ReplyClassification[] = [
  "interested", "meeting_request", "referral", "not_now", "objection",
  "technical_question", "pricing_question", "procurement_question",
  "wrong_person", "unsubscribe", "negative", "out_of_office", "auto_reply", "unknown",
];

async function classifyWithAI(body: string): Promise<ClassifyResult> {
  const fallback: ClassifyResult = {
    classification: "unknown",
    confidence: 0.1,
    sentiment: "unknown",
    objection_type: null,
    recommended_action: "Review this reply manually",
    recommended_task_title: "",
    recommended_task_body: "",
  };

  const client = buildOpenAIClient();
  if (!client) return fallback;

  try {
    const model = "gpt-5-mini";
    const preview = body.slice(0, 800);
    const resp = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: `You are a sales intelligence assistant for VoltSafe, a marina shore power and EV charging infrastructure company. Classify inbound email replies from marina managers, harbour masters, and marina operators.

Respond ONLY with valid JSON in this exact format:
{
  "classification": "<one of: interested|meeting_request|referral|not_now|objection|technical_question|pricing_question|procurement_question|wrong_person|unsubscribe|negative|out_of_office|auto_reply|unknown>",
  "confidence": <0.0 to 1.0>,
  "sentiment": "<positive|neutral|negative|unknown>",
  "objection_type": "<string or null>",
  "recommended_action": "<concise action for the sales rep>",
  "recommended_task_title": "<task title or empty string>",
  "recommended_task_body": "<task description or empty string>"
}

Classification guide:
- interested: positive signal, wants more info
- meeting_request: wants to book a call/demo/meeting
- referral: directing you to another person
- not_now: timing not right but not closing the door
- objection: concerns or hesitations raised
- technical_question: shore power specs, EVSE install, electrical, CSA/UL
- pricing_question: costs, budget, rates, ROI, quote
- procurement_question: RFP, tender, board approval, committee
- wrong_person: not the correct contact
- unsubscribe: wants off the list
- negative: explicitly not interested or hostile
- out_of_office: temporary absence message
- auto_reply: automated mail system response
- unknown: cannot determine intent`,
        },
        {
          role: "user",
          content: `Classify this reply:\n\n${preview}`,
        },
      ],
      ...buildOpenAIModelParams(model, { tokenLimit: 400, temperature: 0.2 }),
    });

    const raw = resp.choices?.[0]?.message?.content?.trim() ?? "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return fallback;
    }

    const classification = VALID_CLASSIFICATIONS.includes(parsed.classification as ReplyClassification)
      ? (parsed.classification as ReplyClassification)
      : "unknown";
    const confidence = typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.3;
    const sentiment = (["positive", "neutral", "negative", "unknown"] as const).includes(
      parsed.sentiment as "positive" | "neutral" | "negative" | "unknown"
    )
      ? (parsed.sentiment as "positive" | "neutral" | "negative" | "unknown")
      : "unknown";

    return {
      classification,
      confidence,
      sentiment,
      objection_type: typeof parsed.objection_type === "string" ? parsed.objection_type : null,
      recommended_action: typeof parsed.recommended_action === "string" ? parsed.recommended_action : "",
      recommended_task_title: typeof parsed.recommended_task_title === "string" ? parsed.recommended_task_title : "",
      recommended_task_body: typeof parsed.recommended_task_body === "string" ? parsed.recommended_task_body : "",
    };
  } catch (err) {
    console.error("[reply-classifier] AI classification failed (non-critical):", (err as Error).message ?? err);
    return fallback;
  }
}

// ── Whether to auto-create a CRM task ────────────────────────────────────────

const AUTO_TASK_CLASSIFICATIONS: ReplyClassification[] = [
  "interested",
  "meeting_request",
  "pricing_question",
  "technical_question",
  "procurement_question",
  "referral",
  "not_now",
  "objection",
  "wrong_person",
];

function shouldAutoCreateTask(classification: ReplyClassification): boolean {
  return AUTO_TASK_CLASSIFICATIONS.includes(classification);
}

// ── Core classify function ────────────────────────────────────────────────────

export async function classifyCampaignReply(input: ClassifyInput): Promise<ReplyClassificationRecord> {
  const { campaignRecipientId, replyBody, sourceMessageId, sourceThreadId, ingestionSource } = input;

  const preview = replyBody.slice(0, 500).replace(/\n/g, " ").trim();

  // Load recipient row for campaign/contact/account linkage
  const recipRows = (await db.execute(sql.raw(
    `SELECT cr.id, cr.campaign_id, cr.campaign_email_id, cr.contact_id, cr.account_id,
            cr.replied_at, cr.unsubscribed_at,
            c.email AS contact_email, c.name AS contact_name,
            mc.campaign_name
     FROM campaign_recipients cr
     LEFT JOIN contacts c ON c.id = cr.contact_id
     LEFT JOIN marketing_campaigns mc ON mc.id = cr.campaign_id
     WHERE cr.id = ${campaignRecipientId}
     LIMIT 1`
  ))).rows as any[];

  const recip = recipRows[0] ?? null;

  const campaignId = recip?.campaign_id ?? null;
  const contactId = recip?.contact_id ?? null;
  const accountId = recip?.account_id ?? null;
  const campaignEmailId = recip?.campaign_email_id ?? null;

  // Step 1: rule-based classification
  let result = classifyRuleBased(replyBody);

  // Step 2: AI fallback
  if (!result) {
    result = await classifyWithAI(replyBody);
  }

  // Step 3: Insert classification record
  const insertedRows = (await db.execute(sql.raw(
    `INSERT INTO campaign_reply_classifications
       (campaign_id, campaign_email_id, campaign_recipient_id, contact_id, account_id,
        source_message_id, source_thread_id, reply_body_preview,
        classification, confidence, sentiment, objection_type,
        recommended_action, recommended_task_title, recommended_task_body,
        status, ingestion_source, created_at, updated_at)
     VALUES
       (${campaignId !== null ? campaignId : "NULL"},
        ${campaignEmailId !== null ? campaignEmailId : "NULL"},
        ${campaignRecipientId},
        ${contactId !== null ? contactId : "NULL"},
        ${accountId !== null ? accountId : "NULL"},
        ${sourceMessageId ? `'${sourceMessageId.replace(/'/g, "''")}'` : "NULL"},
        ${sourceThreadId ? `'${sourceThreadId.replace(/'/g, "''")}'` : "NULL"},
        ${preview ? `'${preview.replace(/'/g, "''")}'` : "NULL"},
        '${result.classification}',
        ${result.confidence},
        '${result.sentiment}',
        ${result.objection_type ? `'${result.objection_type.replace(/'/g, "''")}'` : "NULL"},
        '${result.recommended_action.replace(/'/g, "''")}',
        '${result.recommended_task_title.replace(/'/g, "''")}',
        '${result.recommended_task_body.replace(/'/g, "''")}',
        'pending',
        '${(ingestionSource ?? "manual").replace(/'/g, "''")}',
        NOW(), NOW())
     RETURNING *`
  ))).rows as ReplyClassificationRecord[];

  const classification = insertedRows[0];

  // Step 4: Mark replied_at on recipient (if not already set)
  if (recip && !recip.replied_at) {
    await db.execute(sql.raw(
      `UPDATE campaign_recipients SET replied_at = NOW(), updated_at = NOW() WHERE id = ${campaignRecipientId}`
    ));
  }

  // Step 5: Record campaign_event replied
  try {
    await db.execute(sql.raw(
      `INSERT INTO campaign_events (campaign_id, recipient_id, contact_id, account_id, event_type, event_timestamp, metadata)
       VALUES (${campaignId !== null ? campaignId : "NULL"},
               ${campaignRecipientId},
               ${contactId !== null ? contactId : "NULL"},
               ${accountId !== null ? accountId : "NULL"},
               'replied',
               NOW(),
               '{"classification":"${result.classification}","confidence":${result.confidence}}'::jsonb)
       ON CONFLICT DO NOTHING`
    ));
  } catch (err) {
    console.error("[reply-classifier] recordEvent replied failed (non-critical):", (err as Error).message);
  }

  // Step 6: Compliance — auto-process unsubscribe
  if (result.classification === "unsubscribe" && recip) {
    await processUnsubscribeReply(campaignRecipientId, contactId, recip.contact_email, campaignId);
  }

  return classification;
}

// ── Unsubscribe processing ─────────────────────────────────────────────────────

async function processUnsubscribeReply(
  recipientId: number,
  contactId: number | null,
  email: string | null,
  campaignId: number | null,
): Promise<void> {
  try {
    // Mark recipient unsubscribed
    await db.execute(sql.raw(
      `UPDATE campaign_recipients
       SET unsubscribed_at = NOW(), automation_status = 'stopped', updated_at = NOW()
       WHERE id = ${recipientId} AND unsubscribed_at IS NULL`
    ));

    // Suppress email
    if (email) {
      const safeEmail = email.toLowerCase().replace(/'/g, "''");
      await db.execute(sql.raw(
        `INSERT INTO campaign_suppression (email, reason, created_at)
         VALUES ('${safeEmail}', 'reply_unsubscribe', NOW())
         ON CONFLICT (email) DO NOTHING`
      ));
    }

    // Update contact unsubscribe_status
    if (contactId) {
      await db.execute(sql.raw(
        `UPDATE contacts SET unsubscribe_status = 'unsubscribed', updated_at = NOW()
         WHERE id = ${contactId}`
      ));
    }

    // Record unsubscribed event
    if (campaignId) {
      await db.execute(sql.raw(
        `INSERT INTO campaign_events (campaign_id, recipient_id, contact_id, event_type, event_timestamp)
         VALUES (${campaignId}, ${recipientId}, ${contactId ?? "NULL"}, 'unsubscribed', NOW())`
      ));
    }
  } catch (err) {
    console.error("[reply-classifier] processUnsubscribeReply failed (non-critical):", (err as Error).message);
  }
}

// ── Create CRM task from classification ──────────────────────────────────────

export async function createTaskFromClassification(
  classificationId: number,
  userId: number,
): Promise<{ taskId: number | null; error?: string }> {
  const rows = (await db.execute(sql.raw(
    `SELECT crc.*, mc.campaign_name,
            c.name AS contact_name, c.email AS contact_email,
            a.name AS account_name
     FROM campaign_reply_classifications crc
     LEFT JOIN marketing_campaigns mc ON mc.id = crc.campaign_id
     LEFT JOIN contacts c ON c.id = crc.contact_id
     LEFT JOIN accounts a ON a.id = crc.account_id
     WHERE crc.id = ${classificationId}
     LIMIT 1`
  ))).rows as any[];

  const crc = rows[0];
  if (!crc) return { taskId: null, error: "Classification not found" };
  if (crc.task_id) return { taskId: crc.task_id, error: "Task already created" };

  // Unsubscribe / negative / out_of_office / auto_reply → do not create task
  const blocked: ReplyClassification[] = ["unsubscribe", "negative", "out_of_office", "auto_reply"];
  if (blocked.includes(crc.classification as ReplyClassification)) {
    return { taskId: null, error: `Task creation blocked for classification: ${crc.classification}` };
  }

  if (!crc.recommended_task_title) {
    return { taskId: null, error: "No task title available for this classification" };
  }

  const title = enrichTaskTitle(crc.recommended_task_title, crc.account_name ?? null, crc.contact_name ?? null);
  const description = crc.recommended_task_body ?? "";
  const dueDate = taskDueDate(crc.classification as ReplyClassification);
  const priority = taskPriority(crc.classification as ReplyClassification);

  const taskRows = (await db.execute(sql.raw(
    `INSERT INTO tasks
       (title, description, status, priority, owner_user_id, created_by_user_id,
        contact_id, account_id, linked_object_type, linked_object_id,
        source, source_label, source_meta, ai_suggested,
        due_date, created_at, updated_at)
     VALUES
       ('${title.replace(/'/g, "''")}',
        '${description.replace(/'/g, "''")}',
        'pending',
        '${priority}',
        ${userId},
        ${userId},
        ${crc.contact_id ?? "NULL"},
        ${crc.account_id ?? "NULL"},
        'campaign_reply',
        ${classificationId},
        'campaign_reply',
        '${(crc.campaign_name ?? "Campaign Reply").replace(/'/g, "''")}',
        '{"classificationId":${classificationId},"classification":"${crc.classification}","campaignId":${crc.campaign_id ?? "null"}}'::jsonb,
        true,
        ${dueDate ? `'${dueDate}'` : "NULL"},
        NOW(), NOW())
     RETURNING id`
  ))).rows as { id: number }[];

  const taskId = taskRows[0]?.id ?? null;
  if (!taskId) return { taskId: null, error: "Task insert failed" };

  // Update classification record
  await db.execute(sql.raw(
    `UPDATE campaign_reply_classifications
     SET task_id = ${taskId}, status = 'task_created', updated_at = NOW()
     WHERE id = ${classificationId}`
  ));

  return { taskId };
}

function enrichTaskTitle(template: string, accountName: string | null, contactName: string | null): string {
  if (accountName) return `${template} — ${accountName}`;
  if (contactName) return `${template} — ${contactName}`;
  return template;
}

function taskDueDate(classification: ReplyClassification): string | null {
  const now = new Date();
  const add = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    return d.toISOString();
  };
  switch (classification) {
    case "meeting_request": return add(1);
    case "interested": return add(2);
    case "pricing_question": return add(2);
    case "technical_question": return add(3);
    case "procurement_question": return add(5);
    case "referral": return add(2);
    case "wrong_person": return add(3);
    case "not_now": return add(90);
    case "objection": return add(7);
    default: return add(5);
  }
}

function taskPriority(classification: ReplyClassification): string {
  switch (classification) {
    case "meeting_request": return "high";
    case "interested": return "high";
    case "pricing_question": return "high";
    case "procurement_question": return "high";
    case "technical_question": return "medium";
    case "referral": return "medium";
    case "wrong_person": return "medium";
    case "objection": return "medium";
    case "not_now": return "low";
    default: return "medium";
  }
}

// ── List / get / review / dismiss ────────────────────────────────────────────

export type ReplyListFilters = {
  classification?: string;
  status?: string;
  campaign_id?: number;
  account_id?: number;
  contact_id?: number;
  confidence_min?: number;
  sentiment?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
};

export async function listReplyClassifications(
  filters: ReplyListFilters = {},
): Promise<ReplyClassificationRecord[]> {
  const where: string[] = [];
  if (filters.classification) where.push(`crc.classification = '${filters.classification.replace(/'/g, "''")}'`);
  if (filters.status) where.push(`crc.status = '${filters.status.replace(/'/g, "''")}'`);
  if (filters.campaign_id) where.push(`crc.campaign_id = ${Number(filters.campaign_id)}`);
  if (filters.account_id) where.push(`crc.account_id = ${Number(filters.account_id)}`);
  if (filters.contact_id) where.push(`crc.contact_id = ${Number(filters.contact_id)}`);
  if (filters.confidence_min !== undefined) where.push(`crc.confidence >= ${Number(filters.confidence_min)}`);
  if (filters.sentiment) where.push(`crc.sentiment = '${filters.sentiment.replace(/'/g, "''")}'`);
  if (filters.date_from) where.push(`crc.created_at >= '${filters.date_from.replace(/'/g, "''")}'`);
  if (filters.date_to) where.push(`crc.created_at <= '${filters.date_to.replace(/'/g, "''")}'`);

  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Number(filters.limit ?? 100), 500);

  const rows = (await db.execute(sql.raw(
    `SELECT crc.*,
            c.name AS contact_name, c.email AS contact_email,
            a.name AS account_name,
            mc.campaign_name,
            t.title AS task_title, t.status AS task_status
     FROM campaign_reply_classifications crc
     LEFT JOIN contacts c ON c.id = crc.contact_id
     LEFT JOIN accounts a ON a.id = crc.account_id
     LEFT JOIN marketing_campaigns mc ON mc.id = crc.campaign_id
     LEFT JOIN tasks t ON t.id = crc.task_id
     ${whereClause}
     ORDER BY crc.created_at DESC
     LIMIT ${limit}`
  ))).rows as ReplyClassificationRecord[];

  return rows;
}

export async function getReplyClassification(id: number): Promise<ReplyClassificationRecord | null> {
  const rows = (await db.execute(sql.raw(
    `SELECT crc.*,
            c.name AS contact_name, c.email AS contact_email,
            a.name AS account_name,
            mc.campaign_name,
            t.title AS task_title, t.status AS task_status
     FROM campaign_reply_classifications crc
     LEFT JOIN contacts c ON c.id = crc.contact_id
     LEFT JOIN accounts a ON a.id = crc.account_id
     LEFT JOIN marketing_campaigns mc ON mc.id = crc.campaign_id
     LEFT JOIN tasks t ON t.id = crc.task_id
     WHERE crc.id = ${id}
     LIMIT 1`
  ))).rows as ReplyClassificationRecord[];

  return rows[0] ?? null;
}

export async function markClassificationReviewed(id: number, userId: number): Promise<boolean> {
  await db.execute(sql.raw(
    `UPDATE campaign_reply_classifications
     SET status = 'reviewed', reviewed_by_user_id = ${userId}, reviewed_at = NOW(), updated_at = NOW()
     WHERE id = ${id} AND status = 'pending'`
  ));
  return true;
}

export async function dismissClassification(id: number, userId: number): Promise<boolean> {
  await db.execute(sql.raw(
    `UPDATE campaign_reply_classifications
     SET status = 'dismissed', reviewed_by_user_id = ${userId}, reviewed_at = NOW(), updated_at = NOW()
     WHERE id = ${id}`
  ));
  return true;
}

// ── Batch unprocessed ─────────────────────────────────────────────────────────

export async function classifyUnprocessedReplies(limit = 50): Promise<{
  processed: number;
  failed: number;
}> {
  const rows = (await db.execute(sql.raw(
    `SELECT cr.id AS recipient_id
     FROM campaign_recipients cr
     WHERE cr.replied_at IS NOT NULL
       AND cr.id NOT IN (
         SELECT DISTINCT campaign_recipient_id FROM campaign_reply_classifications
         WHERE campaign_recipient_id IS NOT NULL
       )
     ORDER BY cr.replied_at DESC
     LIMIT ${Math.min(limit, 200)}`
  ))).rows as { recipient_id: number }[];

  let processed = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      await classifyCampaignReply({
        campaignRecipientId: row.recipient_id,
        replyBody: "[Reply body not available — manual review required]",
      });
      processed++;
    } catch (err) {
      console.error(`[reply-classifier] batchClassify failed for recipient ${row.recipient_id}:`, (err as Error).message);
      failed++;
    }
  }

  return { processed, failed };
}

// ── Campaign reply stats (for campaign detail panel) ─────────────────────────

export async function getCampaignReplyStats(campaignId: number): Promise<{
  total: number;
  byClassification: Record<string, number>;
  pendingReview: number;
  tasksCreated: number;
}> {
  const rows = (await db.execute(sql.raw(
    `SELECT classification, COUNT(*) AS count
     FROM campaign_reply_classifications
     WHERE campaign_id = ${campaignId}
     GROUP BY classification`
  ))).rows as { classification: string; count: string }[];

  const total = rows.reduce((s, r) => s + Number(r.count), 0);
  const byClassification: Record<string, number> = {};
  for (const r of rows) byClassification[r.classification] = Number(r.count);

  const pending = (await db.execute(sql.raw(
    `SELECT COUNT(*) AS count FROM campaign_reply_classifications
     WHERE campaign_id = ${campaignId} AND status = 'pending'`
  ))).rows as { count: string }[];

  const tasksRow = (await db.execute(sql.raw(
    `SELECT COUNT(*) AS count FROM campaign_reply_classifications
     WHERE campaign_id = ${campaignId} AND status = 'task_created'`
  ))).rows as { count: string }[];

  return {
    total,
    byClassification,
    pendingReview: Number(pending[0]?.count ?? 0),
    tasksCreated: Number(tasksRow[0]?.count ?? 0),
  };
}

// ── Account-level reply signals (for heat score) ─────────────────────────────

export async function getAccountReplyClassificationScore(accountId: number): Promise<{
  delta: number;
  reasons: string[];
  negativeReasons: string[];
}> {
  const rows = (await db.execute(sql.raw(
    `SELECT classification, COUNT(*) AS cnt
     FROM campaign_reply_classifications
     WHERE account_id = ${accountId}
     GROUP BY classification`
  ))).rows as { classification: string; cnt: string }[];

  const SCORE_MAP: Record<string, number> = {
    meeting_request: 30,
    interested: 20,
    referral: 15,
    pricing_question: 15,
    technical_question: 12,
    procurement_question: 12,
    not_now: 5,
    objection: 5,
    wrong_person: 0,
    unknown: 0,
    auto_reply: 0,
    out_of_office: 0,
    negative: -15,
    unsubscribe: -25,
  };

  let delta = 0;
  const reasons: string[] = [];
  const negativeReasons: string[] = [];

  for (const row of rows) {
    const pts = SCORE_MAP[row.classification] ?? 0;
    const cnt = Number(row.cnt);
    if (pts === 0) continue;
    const contribution = pts * cnt;
    delta += contribution;
    const label = row.classification.replace(/_/g, " ");
    if (pts > 0) {
      reasons.push(`${cnt} "${label}" repl${cnt !== 1 ? "ies" : "y"} (+${contribution} pts)`);
    } else {
      negativeReasons.push(`${cnt} "${label}" repl${cnt !== 1 ? "ies" : "y"} (${contribution} pts)`);
    }
  }

  return { delta, reasons, negativeReasons };
}
