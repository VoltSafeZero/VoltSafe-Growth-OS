/**
 * CRM AI Summary Service
 *
 * Generates and maintains stored AI summaries for Leads, Accounts, and Contacts.
 *
 * Lifecycle:
 *   1. Page open          → read-only GET, never triggers generation
 *   2. Data mutation      → markCrmAiSummaryStale() → queues background regen
 *   3. Manual regen       → queueCrmAiSummaryGeneration() → background queue
 *   4. Backfill           → admin-only, runs once to seed all entities
 *
 * NEVER throws — all errors are caught and stored on the row.
 */

import OpenAI from "openai";
import { createHash } from "crypto";
import { getTokenLimitParam } from "./openai-compat";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { resolveIntentModifiers, buildIntentModifierPromptBlock } from "../../shared/intent-modifiers";

// ── OpenAI client ────────────────────────────────────────────────────────────

function buildOpenAIClient(): OpenAI | null {
  const apiKey =
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  return new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
}

// ── Types ────────────────────────────────────────────────────────────────────

export type CrmEntityType = "lead" | "account" | "contact";

export interface AiSummaryJson {
  executiveSummary: string;
  keyPeople: Array<{
    name: string;
    role?: string;
    title?: string;
    email?: string;
    isDecisionMaker?: boolean;
  }>;
  relevantHistory: Array<{
    event: string;
    date?: string;
    significance?: string;
  }>;
  currentStatus: string;
  opportunitiesAndRisks: Array<{
    type: "opportunity" | "risk";
    description: string;
  }>;
  suggestedNextSteps: string[];
}

export interface AiSummaryRow {
  id: number;
  entityType: CrmEntityType;
  entityId: number;
  summaryJson: AiSummaryJson | null;
  summaryText: string | null;
  status: "pending" | "generating" | "success" | "failed" | "stale";
  sourceHash: string | null;
  generatedAt: string | null;
  staleAt: string | null;
  lastAttemptedAt: string | null;
  retryCount: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Background queue (in-memory, non-blocking) ───────────────────────────────

interface QueueItem {
  entityType: CrmEntityType;
  entityId: number;
}

const queue: QueueItem[] = [];
const inQueue = new Set<string>(); // "lead:123"
let queueProcessing = false;

function queueKey(entityType: CrmEntityType, entityId: number) {
  return `${entityType}:${entityId}`;
}

export function queueCrmAiSummaryGeneration(
  entityType: CrmEntityType,
  entityId: number
): void {
  const k = queueKey(entityType, entityId);
  if (inQueue.has(k)) return;
  inQueue.add(k);
  queue.push({ entityType, entityId });
  scheduleQueueProcess();
}

export function getQueueSize(): number {
  return queue.length + (queueProcessing ? 1 : 0);
}

function scheduleQueueProcess(): void {
  if (queueProcessing) return;
  setTimeout(processNextInQueue, 200);
}

async function processNextInQueue(): Promise<void> {
  if (queueProcessing) return;
  const item = queue.shift();
  if (!item) return;

  inQueue.delete(queueKey(item.entityType, item.entityId));
  queueProcessing = true;
  try {
    await generateCrmAiSummary(item.entityType, item.entityId, false);
  } catch (_err) {
    // already swallowed inside generateCrmAiSummary
  } finally {
    queueProcessing = false;
    if (queue.length > 0) {
      setTimeout(processNextInQueue, 500);
    }
  }
}

// ── Backfill state ────────────────────────────────────────────────────────────

interface EntityTypeStats {
  total: number;
  processed: number;
  skipped: number;
  failed: number;
}

export interface BackfillState {
  running: boolean;
  total: number;
  queued: number;
  generating: number;
  completed: number;
  skipped: number;
  failed: number;
  byType: {
    leads: EntityTypeStats;
    accounts: EntityTypeStats;
    contacts: EntityTypeStats;
  };
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
}

const backfillState: BackfillState = {
  running: false,
  total: 0,
  queued: 0,
  generating: 0,
  completed: 0,
  skipped: 0,
  failed: 0,
  byType: {
    leads: { total: 0, processed: 0, skipped: 0, failed: 0 },
    accounts: { total: 0, processed: 0, skipped: 0, failed: 0 },
    contacts: { total: 0, processed: 0, skipped: 0, failed: 0 },
  },
  startedAt: null,
  finishedAt: null,
  lastError: null,
};

export function getBackfillStatus(): BackfillState & { queueSize: number } {
  return {
    ...backfillState,
    byType: { ...backfillState.byType },
    queueSize: getQueueSize(),
  };
}

// ── Context collection ────────────────────────────────────────────────────────

interface CrmEntityContext {
  entityType: CrmEntityType;
  entityId: number;
  entityFields: Record<string, any>;
  notes: Array<{ content: string; createdAt: string }>;
  emails: Array<{
    id: number;
    subject: string;
    fromEmail: string;
    snippet: string;
    direction: string;
    sentAt: string;
    labelIds?: string;
  }>;
  attachments: Array<{ name: string; category: string; createdAt: string }>;
  activities: Array<{ type: string; description: string; createdAt: string }>;
  contacts: Array<{
    name: string;
    title: string | null;
    email: string | null;
    phone: string | null;
    role: string | null;
  }>;
}

async function safeRows(sqlStr: string): Promise<any[]> {
  try {
    const r = await db.execute(sql.raw(sqlStr));
    return (r as any).rows || [];
  } catch (_err) {
    return [];
  }
}

async function collectCrmEntityContext(
  entityType: CrmEntityType,
  entityId: number
): Promise<CrmEntityContext> {
  const id = Number(entityId);

  // --- Entity fields (all available fields, entity-specific) ---
  let entityFields: Record<string, any> = {};
  if (entityType === "lead") {
    const rows = await safeRows(`
      SELECT l.*,
             u.name as owner_name
      FROM leads l
      LEFT JOIN users u ON u.id = l.owner_user_id
      WHERE l.id = ${id}
    `);
    entityFields = rows[0] || {};
    // Remove internal DB-only / noise fields to keep context clean
    const skipFields = ["id", "owner_user_id", "marina_id", "lead_lat", "lead_lng",
      "converted_account_id", "converted_contact_id", "created_at", "updated_at"];
    for (const k of skipFields) delete entityFields[k];
  } else if (entityType === "account") {
    const rows = await safeRows(`
      SELECT a.*,
             u.name as assigned_to_name
      FROM accounts a
      LEFT JOIN users u ON u.id = a.assigned_to_user_id
      WHERE a.id = ${id}
    `);
    entityFields = rows[0] || {};
    const skipFields = ["id", "assigned_to_user_id", "latitude", "longitude",
      "created_at", "updated_at", "partner_metadata"];
    for (const k of skipFields) delete entityFields[k];
  } else {
    const rows = await safeRows(`
      SELECT c.*,
             a.name as account_name,
             a.website as account_website,
             a.org_type as account_org_type,
             a.lead_status as account_lead_status,
             a.priority as account_priority
      FROM contacts c
      LEFT JOIN accounts a ON a.id = c.account_id
      WHERE c.id = ${id}
    `);
    entityFields = rows[0] || {};
    const skipFields = ["id", "account_id", "created_at", "updated_at", "avatar_url"];
    for (const k of skipFields) delete entityFields[k];
  }

  // --- Notes (newest first) ---
  const noteRows = await safeRows(`
    SELECT content, created_at FROM notes
    WHERE linked_object_type = '${entityType}' AND linked_object_id = ${id}
    ORDER BY created_at DESC LIMIT 25
  `);
  const notes = noteRows.map((r: any) => ({
    content: String(r.content || "").substring(0, 500),
    createdAt: String(r.created_at || ""),
  }));

  // --- Emails (newest first, full snippet, direction-labelled) ---
  // Fetch 50 rows so the smart selector has enough material to pick from.
  const emailRows = await safeRows(`
    SELECT em.id, em.subject, em.from_email, em.snippet, em.direction, em.sent_at,
           em.label_ids, em.to_recipients
    FROM email_associations ea
    JOIN email_messages em ON ea.email_message_id = em.id
    WHERE ea.object_type = '${entityType}' AND ea.object_id = ${id}
    ORDER BY em.sent_at DESC NULLS LAST LIMIT 50
  `);
  const emails = emailRows.map((r: any) => ({
    id: Number(r.id),
    subject: String(r.subject || ""),
    fromEmail: String(r.from_email || ""),
    snippet: String(r.snippet || "").substring(0, 350),
    direction: String(r.direction || ""),
    sentAt: String(r.sent_at || ""),
    labelIds: r.label_ids ? String(r.label_ids) : undefined,
  }));

  // --- Attachments ---
  const attRows = await safeRows(`
    SELECT original_name, category, created_at FROM attachments
    WHERE object_type = '${entityType}' AND object_id = ${id}
    ORDER BY created_at DESC LIMIT 20
  `);
  const attachments = attRows.map((r: any) => ({
    name: String(r.original_name || ""),
    category: String(r.category || ""),
    createdAt: String(r.created_at || ""),
  }));

  // --- Activities (newest first) ---
  const actRows = await safeRows(`
    SELECT type, description, created_at FROM activities
    WHERE linked_object_type = '${entityType}' AND linked_object_id = ${id}
    ORDER BY created_at DESC LIMIT 20
  `);
  const activities = actRows.map((r: any) => ({
    type: String(r.type || ""),
    description: String(r.description || "").substring(0, 300),
    createdAt: String(r.created_at || ""),
  }));

  // --- Contacts ---
  let contacts: CrmEntityContext["contacts"] = [];
  if (entityType === "lead") {
    const cRows = await safeRows(`
      SELECT c.name, c.title, c.email, c.phone, lc.role
      FROM contacts c
      JOIN lead_contacts lc ON lc.contact_id = c.id
      WHERE lc.lead_id = ${id}
      LIMIT 10
    `);
    contacts = cRows.map((r: any) => ({
      name: String(r.name || ""),
      title: r.title ? String(r.title) : null,
      email: r.email ? String(r.email) : null,
      phone: r.phone ? String(r.phone) : null,
      role: r.role ? String(r.role) : null,
    }));
  } else if (entityType === "account") {
    const cRows = await safeRows(`
      SELECT name, title, email, phone, NULL as role
      FROM contacts
      WHERE account_id = ${id}
      LIMIT 10
    `);
    contacts = cRows.map((r: any) => ({
      name: String(r.name || ""),
      title: r.title ? String(r.title) : null,
      email: r.email ? String(r.email) : null,
      phone: r.phone ? String(r.phone) : null,
      role: null,
    }));
  } else {
    const acctRows = await safeRows(`SELECT name FROM accounts WHERE id = (SELECT account_id FROM contacts WHERE id = ${id})`);
    if (acctRows[0]) {
      contacts = [{ name: acctRows[0].name, title: "Primary Account", email: null, phone: null, role: null }];
    }
  }

  return { entityType, entityId: id, entityFields, notes, emails, attachments, activities, contacts };
}

// ── Post-processing: clean up AI-generated email body ─────────────────────────

/**
 * Strips placeholder signature blocks and normalises paragraph formatting
 * in an AI-generated email body before it is returned to the client.
 *
 * Placeholder patterns that MUST be removed:
 *   [Your Name], [Your Title], [Your Contact Information]
 *   Best regards, [Your Name] ... VoltSafe [Your Contact Information]
 * Any closing line that still contains bracket placeholders is removed entirely.
 */
export function cleanAiEmailBody(raw: string): string {
  if (!raw) return raw;

  let text = raw;

  // 1. Remove full fake-signature blocks (multi-line, greedy at end of body)
  //    Matches from a closing word through any remaining lines that contain bracket placeholders
  text = text.replace(
    /\n?(Best regards?|Kind regards?|Warm regards?|Sincerely|Thanks?|Cheers|Regards?)[,:]?\s*\n[\s\S]*?\[Your (?:Name|Title|Contact Information)\][\s\S]*/gi,
    ""
  );

  // 2. Remove any remaining inline bracket placeholder fragments
  text = text.replace(/\[Your Name\]/gi, "");
  text = text.replace(/\[Your Title\]/gi, "");
  text = text.replace(/\[Your Contact Information\]/gi, "");
  text = text.replace(/VoltSafe\s*\[.*?\]/gi, "VoltSafe");

  // 3. Remove lines that are now empty closing artifacts ("[Your Name]" was the only content)
  text = text
    .split("\n")
    .filter(line => line.trim() !== "VoltSafe" || false)  // keep VoltSafe if standalone — harmless
    .join("\n");

  // 4. Strip standalone signoff-only lines at the end of the body
  //    (lines that are JUST a closing phrase with no [Your Name] following them)
  //    Walk backward from the end, removing any trailing blank lines and then
  //    a single signoff line if present.
  const SIGNOFF_PATTERN = /^(best regards?|kind regards?|warm regards?|regards?|sincerely|thanks?|cheers|best)[,\s]*$/i;
  const lines = text.split("\n");
  let tail = lines.length - 1;
  // skip trailing blank lines
  while (tail >= 0 && lines[tail].trim() === "") tail--;
  // remove the signoff line if present
  if (tail >= 0 && SIGNOFF_PATTERN.test(lines[tail].trim())) {
    lines.splice(tail, 1);
    text = lines.join("\n");
  }

  // 5. Normalise line endings and strip excessive blank lines (max 2 consecutive newlines)
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");

  // 6. Trim trailing/leading whitespace
  text = text.trim();

  return text;
}

// ── Source hash ───────────────────────────────────────────────────────────────

async function computeSourceHash(
  entityType: CrmEntityType,
  entityId: number
): Promise<string> {
  const id = Number(entityId);
  try {
    const parts: string[] = [];

    const tableName = entityType === "lead" ? "leads" : entityType === "account" ? "accounts" : "contacts";
    const entityRows = await safeRows(`SELECT updated_at FROM ${tableName} WHERE id = ${id}`);
    parts.push(entityRows[0]?.updated_at || "");

    const noteRows = await safeRows(`SELECT COUNT(*) as cnt, MAX(created_at) as mx FROM notes WHERE linked_object_type = '${entityType}' AND linked_object_id = ${id}`);
    parts.push(`notes:${noteRows[0]?.cnt}:${noteRows[0]?.mx}`);

    const emailRows = await safeRows(`
      SELECT COUNT(*) as cnt, MAX(em.sent_at) as mx
      FROM email_associations ea
      JOIN email_messages em ON ea.email_message_id = em.id
      WHERE ea.object_type = '${entityType}' AND ea.object_id = ${id}
    `);
    parts.push(`emails:${emailRows[0]?.cnt}:${emailRows[0]?.mx}`);

    const attRows = await safeRows(`SELECT COUNT(*) as cnt FROM attachments WHERE object_type = '${entityType}' AND object_id = ${id}`);
    parts.push(`attachments:${attRows[0]?.cnt}`);

    const actRows = await safeRows(`SELECT COUNT(*) as cnt, MAX(created_at) as mx FROM activities WHERE linked_object_type = '${entityType}' AND linked_object_id = ${id}`);
    parts.push(`activities:${actRows[0]?.cnt}:${actRows[0]?.mx}`);

    // Contact count (tracks link/unlink operations on lead/account)
    if (entityType === "lead") {
      const lcRows = await safeRows(`SELECT COUNT(*) as cnt FROM lead_contacts WHERE lead_id = ${id}`);
      parts.push(`linked_contacts:${lcRows[0]?.cnt}`);
    } else if (entityType === "account") {
      const acRows = await safeRows(`SELECT COUNT(*) as cnt FROM contacts WHERE account_id = ${id}`);
      parts.push(`linked_contacts:${acRows[0]?.cnt}`);
    }

    return createHash("sha256").update(parts.join("|")).digest("hex").substring(0, 16);
  } catch (_err) {
    return createHash("sha256").update(`${entityType}:${entityId}:${Date.now()}`).digest("hex").substring(0, 16);
  }
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildCrmAiSummaryPrompt(ctx: CrmEntityContext): string {
  const lines: string[] = [];
  lines.push(`You are an AI assistant for VoltSafe, a marina electrification company.`);
  lines.push(`Generate a structured CRM summary for this ${ctx.entityType.toUpperCase()} in JSON format.`);
  lines.push(`\n=== ${ctx.entityType.toUpperCase()} FIELDS ===`);
  lines.push(JSON.stringify(ctx.entityFields, null, 2));

  if (ctx.contacts.length > 0) {
    lines.push(`\n=== LINKED CONTACTS ===`);
    ctx.contacts.forEach(c => {
      lines.push(`- ${c.name}${c.title ? ` (${c.title})` : ""}${c.email ? ` <${c.email}>` : ""}${c.role ? ` [${c.role}]` : ""}`);
    });
  }

  if (ctx.notes.length > 0) {
    lines.push(`\n=== NOTES (most recent first) ===`);
    ctx.notes.slice(0, 15).forEach((n, i) => {
      lines.push(`[${i + 1}] (${n.createdAt.substring(0, 10)}) ${n.content}`);
    });
  }

  if (ctx.emails.length > 0) {
    lines.push(`\n=== LINKED EMAILS (most recent first) ===`);
    ctx.emails.slice(0, 15).forEach((e, i) => {
      lines.push(`[${i + 1}] ${e.sentAt.substring(0, 10)} | ${e.direction} | From: ${e.fromEmail} | Subject: ${e.subject} | ${e.snippet}`);
    });
  }

  if (ctx.attachments.length > 0) {
    lines.push(`\n=== DOCUMENTS ===`);
    ctx.attachments.forEach(a => {
      lines.push(`- ${a.name}${a.category ? ` [${a.category}]` : ""}`);
    });
  }

  if (ctx.activities.length > 0) {
    lines.push(`\n=== ACTIVITIES ===`);
    ctx.activities.slice(0, 10).forEach(a => {
      lines.push(`- ${a.createdAt.substring(0, 10)} | ${a.type}: ${a.description}`);
    });
  }

  lines.push(`\n=== INSTRUCTIONS ===`);
  lines.push(`Return ONLY valid JSON matching this exact schema:`);
  lines.push(JSON.stringify({
    executiveSummary: "2-3 sentence plain-English snapshot of this relationship",
    keyPeople: [{ name: "string", role: "string", title: "string", email: "string", isDecisionMaker: true }],
    relevantHistory: [{ event: "string", date: "YYYY-MM-DD or approximate", significance: "why this matters" }],
    currentStatus: "1-2 sentence current status and momentum",
    opportunitiesAndRisks: [{ type: "opportunity|risk", description: "string" }],
    suggestedNextSteps: ["action item 1", "action item 2"],
  }, null, 2));
  lines.push(`Keep it concise and actionable. Focus on what matters operationally. Do NOT hallucinate pricing, commitments, or dates not in the data.`);

  return lines.join("\n");
}

// ── Core generation ───────────────────────────────────────────────────────────

export async function generateCrmAiSummary(
  entityType: CrmEntityType,
  entityId: number,
  force = false
): Promise<void> {
  const id = Number(entityId);

  try {
    // Check if already generating
    const existing = await safeRows(`
      SELECT status, source_hash, retry_count, summary_json FROM crm_ai_summaries
      WHERE entity_type = '${entityType}' AND entity_id = ${id}
    `);

    if (!force && existing[0]?.status === "generating") {
      return; // already in-flight
    }

    // Compute source hash and check if anything changed
    const newHash = await computeSourceHash(entityType, id);
    if (!force && existing[0]?.status === "success" && existing[0]?.source_hash === newHash) {
      return; // nothing changed — skip generation
    }

    const retryCount = Number(existing[0]?.retry_count || 0);

    // Mark as generating (preserves existing summary_json for display during regen)
    await db.execute(sql.raw(`
      INSERT INTO crm_ai_summaries (entity_type, entity_id, status, retry_count, last_attempted_at, created_at, updated_at)
      VALUES ('${entityType}', ${id}, 'generating', ${retryCount}, NOW(), NOW(), NOW())
      ON CONFLICT (entity_type, entity_id) DO UPDATE SET
        status = 'generating',
        last_attempted_at = NOW(),
        retry_count = EXCLUDED.retry_count,
        updated_at = NOW()
    `));

    const openai = buildOpenAIClient();
    if (!openai) {
      await db.execute(sql.raw(`
        UPDATE crm_ai_summaries SET
          status = 'failed',
          error_message = 'No OpenAI API key configured',
          retry_count = ${retryCount + 1},
          updated_at = NOW()
        WHERE entity_type = '${entityType}' AND entity_id = ${id}
      `));
      return;
    }

    // Collect context and generate
    const ctx = await collectCrmEntityContext(entityType, id);
    const prompt = buildCrmAiSummaryPrompt(ctx);

    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content: "You are a CRM intelligence assistant. Return only valid JSON. No markdown, no explanation.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      ...getTokenLimitParam("gpt-5-mini", 1200),
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    let parsed: AiSummaryJson;
    try {
      parsed = JSON.parse(raw);
    } catch (_e) {
      throw new Error(`Invalid JSON from OpenAI: ${raw.substring(0, 200)}`);
    }

    const summaryText = [
      parsed.executiveSummary || "",
      ...(parsed.suggestedNextSteps || []).map((s: string) => `• ${s}`),
    ].join("\n").substring(0, 2000);

    const safeJson = (JSON.stringify(parsed) || "{}").replace(/'/g, "''");
    const safeText = summaryText.replace(/'/g, "''");
    await db.execute(sql.raw(`
      UPDATE crm_ai_summaries SET
        status = 'success',
        summary_json = '${safeJson}'::jsonb,
        summary_text = '${safeText}',
        source_hash = '${newHash}',
        generated_at = NOW(),
        stale_at = NULL,
        error_message = NULL,
        retry_count = 0,
        updated_at = NOW()
      WHERE entity_type = '${entityType}' AND entity_id = ${id}
    `));

    console.log(`[crm-ai-summary] Generated ${entityType}:${id}`);
  } catch (err: any) {
    // On failure: preserve existing summary_json; just update status fields
    const msg = String(err?.message || err || "Unknown error").substring(0, 500).replace(/'/g, "''");
    try {
      await db.execute(sql.raw(`
        UPDATE crm_ai_summaries SET
          status = 'failed',
          error_message = '${msg}',
          retry_count = retry_count + 1,
          updated_at = NOW()
        WHERE entity_type = '${entityType}' AND entity_id = ${id}
      `));
    } catch (_) {
      // ignore secondary error
    }
    console.error(`[crm-ai-summary] Error for ${entityType}:${id}:`, err?.message || err);
  }
}

// ── Stale marking ─────────────────────────────────────────────────────────────

/**
 * Called from mutation routes (note create/edit/delete, field updates, etc.)
 * Marks the summary stale and queues background regeneration.
 * Fire-and-forget — never blocks the calling route.
 */
export async function markCrmAiSummaryStale(
  entityType: CrmEntityType,
  entityId: number,
  reason?: string
): Promise<void> {
  const id = Number(entityId);
  try {
    await db.execute(sql.raw(`
      INSERT INTO crm_ai_summaries (entity_type, entity_id, status, stale_at, created_at, updated_at)
      VALUES ('${entityType}', ${id}, 'stale', NOW(), NOW(), NOW())
      ON CONFLICT (entity_type, entity_id) DO UPDATE SET
        status = CASE WHEN crm_ai_summaries.status = 'generating' THEN 'generating' ELSE 'stale' END,
        stale_at = NOW(),
        updated_at = NOW()
    `));
    // Queue background regeneration
    queueCrmAiSummaryGeneration(entityType, id);
    if (reason) {
      console.log(`[crm-ai-summary] Marked stale ${entityType}:${id} (${reason})`);
    }
  } catch (_err) {
    // non-fatal
  }
}

// ── GET summary ───────────────────────────────────────────────────────────────

export async function getCrmAiSummary(
  entityType: CrmEntityType,
  entityId: number
): Promise<AiSummaryRow | null> {
  const id = Number(entityId);
  try {
    const rows = await safeRows(`
      SELECT id, entity_type, entity_id, summary_json, summary_text,
             status, source_hash, generated_at, stale_at,
             last_attempted_at, retry_count, error_message, created_at, updated_at
      FROM crm_ai_summaries
      WHERE entity_type = '${entityType}' AND entity_id = ${id}
    `);
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id,
      entityType: r.entity_type as CrmEntityType,
      entityId: r.entity_id,
      summaryJson: r.summary_json || null,
      summaryText: r.summary_text || null,
      status: r.status as AiSummaryRow["status"],
      sourceHash: r.source_hash || null,
      generatedAt: r.generated_at ? String(r.generated_at) : null,
      staleAt: r.stale_at ? String(r.stale_at) : null,
      lastAttemptedAt: r.last_attempted_at ? String(r.last_attempted_at) : null,
      retryCount: Number(r.retry_count || 0),
      errorMessage: r.error_message || null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  } catch (_err) {
    return null;
  }
}

// ── Suggested next email ──────────────────────────────────────────────────────

export interface SuggestedEmail {
  to: string;
  cc: string;
  subject: string;
  body: string;
  reason: string;
  warning?: string;
  /** Human-readable explanation of the deterministic context used (shown in UI). */
  detectedContext?: string;
  /** The voice profile id that was applied (if any). */
  voiceProfileId?: number;
  /** The voice profile name that was applied (if any). */
  voiceProfileName?: string;
  /** The CEO Wattson influence level that was applied (0-100). */
  ceoWattsonInfluenceLevel?: number;
  /** Bullet-point reasons explaining what transformations were applied. */
  whyGenerated?: string[];
}

// ── Deterministic date classifier (runs before LLM, no hallucination risk) ───
function classifyDate(dateStr: string | null | undefined, now: Date): "past" | "today" | "future" | "unknown" {
  if (!dateStr) return "unknown";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "unknown";
    const todayMidnight = new Date(now); todayMidnight.setHours(0, 0, 0, 0);
    const dMidnight = new Date(d); dMidnight.setHours(0, 0, 0, 0);
    if (dMidnight < todayMidnight) return "past";
    if (dMidnight > todayMidnight) return "future";
    return "today";
  } catch { return "unknown"; }
}

// Scan free-text for ISO and human-readable date strings, classify each.
function extractAndClassifyDates(text: string, now: Date): { dateStr: string; classification: "past" | "today" | "future" | "unknown" }[] {
  const ISO_RE = /\b(20\d{2}-\d{2}-\d{2})\b/g;
  const HUMAN_RE = /\b((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s*20\d{2})\b/gi;
  const seen = new Set<string>();
  const results: { dateStr: string; classification: "past" | "today" | "future" | "unknown" }[] = [];
  for (const re of [ISO_RE, HUMAN_RE]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const ds = m[0];
      if (seen.has(ds)) continue;
      seen.add(ds);
      results.push({ dateStr: ds, classification: classifyDate(ds, now) });
    }
  }
  return results;
}

// ── Smart email context selector ─────────────────────────────────────────────

/** Keywords that signal commercially or technically important emails. */
const SMART_EMAIL_KEYWORDS = [
  "pricing", "proposal", "quote", "contract", "certification", "pilot",
  "compliance", "budget", "procurement", "technical review", "discovery",
  "marina", "pedestal", "shore power",
];

type EmailRow = CrmEntityContext["emails"][number];

interface SmartEmailRow extends EmailRow {
  /** Human-readable label injected into the AI prompt for this email. */
  selectionLabel: string;
  /** Lower = appears earlier in the sorted prompt output. */
  _sortOrder: number;
}

/**
 * Selects up to `cap` emails using priority rules:
 *   1. Most recent 10 (prompt order: newest → oldest)
 *   2. Important / starred (Gmail label_ids contains STARRED or IMPORTANT)
 *   3. Keyword matches in subject or snippet
 *   4. First 3 historical emails (oldest available — early relationship context)
 *
 * De-duplicates by id. Final prompt order: recent → starred → keyword → early.
 */
export function selectSmartEmailContext(emails: EmailRow[], cap = 20): SmartEmailRow[] {
  if (emails.length === 0) return [];

  const selected = new Map<number, SmartEmailRow>();

  const tag = (e: EmailRow, label: string, order: number) => {
    if (!selected.has(e.id)) {
      selected.set(e.id, { ...e, selectionLabel: label, _sortOrder: order });
    }
  };

  // Group 1 — most recent 10 (array comes sorted newest-first from DB)
  emails.slice(0, 10).forEach((e, i) => tag(e, "MOST RECENT", i));

  // The very newest email gets an elevated label so the model treats it as the primary signal
  if (emails.length > 0) {
    const newest = selected.get(emails[0].id);
    if (newest) newest.selectionLabel = "⚑ NEWEST — PRIMARY SIGNAL";
  }

  // Group 2 — important / starred via Gmail label_ids
  emails.forEach(e => {
    const upper = (e.labelIds || "").toUpperCase();
    if (upper.includes("STARRED") || upper.includes("IMPORTANT")) {
      tag(e, "IMPORTANT / STARRED", 20);
    }
  });

  // Group 3 — keyword matches in subject or snippet
  emails.forEach(e => {
    const hay = `${e.subject} ${e.snippet}`.toLowerCase();
    for (const kw of SMART_EMAIL_KEYWORDS) {
      if (hay.includes(kw)) {
        tag(e, `KEYWORD MATCH: ${kw}`, 30);
        break; // first matching keyword wins
      }
    }
  });

  // Group 4 — first 3 historical emails (oldest; tail of the newest-first array)
  const earlyStart = Math.max(0, emails.length - 3);
  emails.slice(earlyStart).forEach((e, i) => tag(e, "EARLY RELATIONSHIP CONTEXT", 40 + i));

  return Array.from(selected.values())
    .sort((a, b) => a._sortOrder - b._sortOrder)
    .slice(0, cap);
}

/** Engagement signals passed from the Follow-Up Engine into the AI prompt. */
export interface EngagementContext {
  category: string;
  insightText: string;
  whyText: string[];
  uniqueOpens: number;
  uniqueClicks: number;
  daysSinceLastOutbound: number | null;
  ctaClicks: Array<{ ctaName: string; destinationUrl: string; clickCount: number }>;
}

export async function generateSuggestedNextEmail(
  entityType: CrmEntityType,
  entityId: number,
  voiceProfileId?: number,
  callerUserId?: number,
  callerIsAdmin?: boolean,
  ceoWattsonInfluenceLevel: number = 75,
  engagementSummary?: EngagementContext,
  intentModifierIds?: string[],
  userInputs?: string
): Promise<SuggestedEmail> {
  const id = Number(entityId);

  const openai = buildOpenAIClient();
  if (!openai) {
    return { to: "", cc: "", subject: "Follow-up", body: "", reason: "AI is not configured.", warning: "No OpenAI API key configured." };
  }

  // Load voice profile if requested
  let voiceProfileBlock = "";
  let voiceProfileName = "";
  let resolvedVoiceProfileId: number | undefined;
  if (voiceProfileId && callerUserId) {
    try {
      const { getVoiceProfileForPrompt, buildVoiceProfilePromptBlock } = await import("./ai-voice-profiles");
      const profile = await getVoiceProfileForPrompt(voiceProfileId, callerUserId, callerIsAdmin ?? false);
      if (profile) {
        voiceProfileBlock = buildVoiceProfilePromptBlock(profile, ceoWattsonInfluenceLevel);
        voiceProfileName = profile.name;
        resolvedVoiceProfileId = profile.id;
      }
    } catch { /* voice profile load failure is non-fatal */ }
  }

  // If no explicit voice profile, still inject the influence block on its own
  let standaloneInfluenceBlock = "";
  if (!voiceProfileBlock) {
    try {
      const { buildInfluencePromptBlock } = await import("./ai-voice-profiles");
      standaloneInfluenceBlock = buildInfluencePromptBlock(ceoWattsonInfluenceLevel);
    } catch { /* non-fatal */ }
  }

  // Use saved summary if available — do not auto-generate if missing
  const summary = await getCrmAiSummary(entityType, id);
  const ctx = await collectCrmEntityContext(entityType, id);

  // ── Deterministic date classification (authoritative, pre-LLM) ───────────
  const now = new Date();
  const todayISO = now.toISOString().slice(0, 10); // e.g. "2026-05-21"

  // Collect all text that might contain date references
  const allContextText = [
    JSON.stringify(summary?.summaryJson || {}),
    ...ctx.notes.map((n) => n.content),
    ...ctx.activities.map((a) => a.description),
    ...ctx.emails.map((e) => `${e.subject} ${e.snippet}`),
    JSON.stringify(ctx.entityFields),
  ].join(" ");

  const classifiedDates = extractAndClassifyDates(allContextText, now);
  const pastDates   = classifiedDates.filter((d) => d.classification === "past").map((d) => d.dateStr);
  const futureDates = classifiedDates.filter((d) => d.classification === "future").map((d) => d.dateStr);
  const todayDates  = classifiedDates.filter((d) => d.classification === "today").map((d) => d.dateStr);

  // Also classify est_close_date for leads
  const estCloseDate = ctx.entityFields.est_close_date as string | undefined;
  const estCloseClass = classifyDate(estCloseDate, now);
  if (estCloseDate && !classifiedDates.some((d) => d.dateStr === estCloseDate)) {
    if (estCloseClass === "past") pastDates.push(estCloseDate);
    else if (estCloseClass === "future") futureDates.push(estCloseDate);
  }

  // Determine email intent from date evidence
  let emailIntent: string;
  let detectedContext: string;
  if (pastDates.length > 0 && futureDates.length === 0) {
    emailIntent = "post-meeting follow-up or re-engagement";
    detectedContext = `Detected past event(s) — suggesting follow-up language. (Past dates: ${pastDates.slice(0, 3).join(", ")})`;
  } else if (futureDates.length > 0 && pastDates.length === 0) {
    emailIntent = "pre-meeting confirmation or preparation";
    detectedContext = `Detected upcoming event(s) — suggesting pre-meeting language. (Future dates: ${futureDates.slice(0, 3).join(", ")})`;
  } else if (futureDates.length > 0 && pastDates.length > 0) {
    emailIntent = "post-meeting follow-up (past events) with awareness of upcoming events";
    detectedContext = `Detected both past and future events — emphasizing follow-up. (Past: ${pastDates.slice(0, 2).join(", ")}; Future: ${futureDates.slice(0, 2).join(", ")})`;
  } else if (todayDates.length > 0) {
    emailIntent = "same-day check-in or confirmation";
    detectedContext = "Detected event scheduled for today — suggesting timely check-in.";
  } else {
    emailIntent = "neutral outreach or next-step proposal";
    detectedContext = "No specific event dates detected — using neutral outreach language.";
  }

  const resolvedModifiers = resolveIntentModifiers(intentModifierIds ?? []);
  const modifierBlock = buildIntentModifierPromptBlock(resolvedModifiers);

  const systemPrompt = [
    voiceProfileBlock ? voiceProfileBlock : null,
    voiceProfileBlock ? `` : null,
    !voiceProfileBlock && standaloneInfluenceBlock ? standaloneInfluenceBlock : null,
    !voiceProfileBlock && standaloneInfluenceBlock ? `` : null,
    modifierBlock || null,
    modifierBlock ? `` : null,
    voiceProfileBlock
      ? `You are writing emails on behalf of VoltSafe. Follow the voice profile above precisely. Return only valid JSON.`
      : `You are an expert sales and relationship manager at VoltSafe, a marina electrification company.`,
    voiceProfileBlock
      ? `Generate a professional email suggestion in the ${voiceProfileName} voice. Return only valid JSON.`
      : `Generate a professional, concise, human-sounding email suggestion. Return only valid JSON.`,
    ``,
    `=== SIGNATURE RULES — MANDATORY ===`,
    `- Do not generate an email signature.`,
    `- Do not generate: sender name, sender title, sender company, sender phone number, sender email address, or sender contact information.`,
    `- DO NOT use placeholder text like [Your Name], [Your Title], [Your Contact Information], or any bracket placeholders.`,
    `- DO NOT add any closing phrase such as "Best regards,", "Regards,", "Sincerely,", "Thanks,", "Best,", or any sign-off.`,
    `- End the draft at the final sentence of the email body. The user's email system will append the correct signature automatically.`,
    ``,
    `=== FORMATTING RULES — MANDATORY ===`,
    `- Use blank lines (\\n\\n) to separate paragraphs. NEVER write the entire body as one paragraph.`,
    `- Greeting on its own line, then a blank line before the first paragraph.`,
    `- Each paragraph should be 1-3 sentences maximum. Short, direct, executive prose.`,
    `- End at the final sentence. Do NOT add a closing phrase or sign-off line.`,
    `- Example structure:`,
    `  Dear [recipient first name],\\n\\n[First paragraph — context/reason for writing]\\n\\n[Second paragraph — specific ask or next step]`,
    ``,
    `=== CONTENT RULES — MANDATORY ===`,
    `- NEVER open with "I hope this email finds you well", "I hope this message finds you well", or any similar generic filler.`,
    `- NEVER say "as discussed" or "as we discussed" unless there is explicit meeting/call evidence in the context.`,
    `- NEVER claim to be attaching or providing a transcript, summary, proposal, or document unless it exists in the context.`,
    `- NEVER invent commitments, pricing, timelines, or facts not present in the context.`,
    `- Be specific to the recipient and the actual context — no generic CRM fluff.`,
    `- Make ONE clear next-step ask. Do not list multiple asks.`,
    `- Concise and direct. No overexplaining.`,
    ``,
    `=== RECENCY-WEIGHTED EMAIL GENERATION RULES — MANDATORY ===`,
    `Treat the CRM file as a TIMELINE, not a static pile of facts. The newest activity carries the most weight.`,
    ``,
    `Context weight — highest to lowest:`,
    `1. MOST RECENT EMAILS (inbound and outbound) — the latest reply, question, objection, commitment, or open loop`,
    `   is the STRONGEST signal. NEVER ignore the newest email. NEVER restart the conversation as if prior emails`,
    `   did not happen.`,
    `2. MOST RECENT COMMENTS, NOTES, AND ACTION ITEMS — if a recent comment says outreach is planned today,`,
    `   execute that outreach (not a generic check-in). If a recent action item exists, the email must advance it.`,
    `3. CURRENT CRM STATUS — pipeline stage, temperature, lead status, and assigned owner shape tone and urgency.`,
    `   Do not write a generic outreach email when the lead is already warm, qualified, or mid-conversation.`,
    `4. KEY STAKEHOLDER CONTEXT — address the right person based on the LATEST communication thread.`,
    `5. OLDER BACKGROUND NOTES — older meeting notes, early relationship history. Use only to SUPPORT the email.`,
    `   Older context must NEVER override a newer email, comment, or action item.`,
    ``,
    `HARD RULE: MOST RECENT ACTIVITY WINS.`,
    `A comment, email, note, or action item from today outweighs a meeting summary from last month.`,
    `The HIGH PRIORITY CONTEXT block in the user prompt is pre-computed and authoritative — it identifies`,
    `the newest 3–5 items. The generated email MUST acknowledge or advance the top item in that block.`,
    ``,
    `Before writing the email, silently determine:`,
    `- What happened most recently? Who said what last?`,
    `- What is the latest open loop or unanswered question?`,
    `- What is the most logical next step for this specific account?`,
    `- What should the recipient understand, feel, and do after reading this email?`,
    ``,
    `AVOID: generic "just checking in" emails, repeating stale meeting notes, summarizing the whole account,`,
    `overexplaining, or ignoring recent emails, comments, or action items.`,
    `If the latest context includes a pilot invitation, meeting follow-up, requested deck, compliance question,`,
    `pricing discussion, technical question, stakeholder intro, scheduling need, or decision deadline —`,
    `the email MUST directly advance that specific item.`,
    ``,
    `CRITICAL TEMPORAL RULES — NEVER VIOLATE:`,
    `- Today's date is ${todayISO}. You must treat this as the authoritative present.`,
    `- Dates BEFORE ${todayISO} are IN THE PAST. NEVER describe past meetings as "upcoming."`,
    `- NEVER say "looking forward to our upcoming meeting" if the meeting date is in the past.`,
    `- NEVER say "as we approach our scheduled meeting" if the meeting already occurred.`,
    `- NEVER invent or assume preparation work for a past event.`,
    `- If a meeting/event is in the past: write a FOLLOW-UP email, not a pre-meeting email.`,
    `- If a meeting/event is in the future: pre-meeting confirmation language is appropriate.`,
    `- When uncertain about timing: use neutral, evergreen language with no time-specific claims.`,
    `- The DETERMINISTIC DATE CONTEXT section below is authoritative. Trust it over any date in the AI summary.`,
  ].filter(Boolean).join("\n");

  // Smart email context: up to 20 emails covering recent, important, keyword-matched, and early history
  const smartEmails = selectSmartEmailContext(ctx.emails);
  // ── Build labelled email context lines ───────────────────────────────────
  const emailContextLines: string[] = [];
  if (smartEmails.length > 0) {
    emailContextLines.push(`=== EMAIL HISTORY (smart-selected: ${smartEmails.length} emails — ordered newest-first) ===`);
    emailContextLines.push(`[⚑ NEWEST — PRIMARY SIGNAL] is the most recent email. It must drive the email you generate.`);
    emailContextLines.push(`EARLY RELATIONSHIP CONTEXT emails are background only — never let them override newer signals.`);
    smartEmails.forEach((e, i) => {
      const dirLabel = e.direction === "outbound" ? "OUTBOUND (we sent)" : e.direction === "inbound" ? "INBOUND (they sent)" : e.direction || "UNKNOWN";
      emailContextLines.push(`[${i + 1}] [${e.selectionLabel}] TYPE: email | ${dirLabel} | ${e.sentAt} | From: ${e.fromEmail} | Subject: "${e.subject}"`);
      emailContextLines.push(`    Preview: ${e.snippet}`);
    });
  }

  // ── Pre-compute HIGH PRIORITY CONTEXT (newest 3–5 items across all types) ─
  // Collect all timestamped items from emails, notes, and activities then sort
  // newest-first so the model sees exactly what the latest open loop is.
  interface PriorityContextItem {
    type: string;
    direction?: string;
    timestamp: string;
    author?: string;
    subject?: string;
    content: string;
  }
  const allTimedItems: PriorityContextItem[] = [];

  // Most-recent email (index 0 of smartEmails = newest)
  if (smartEmails.length > 0) {
    const e = smartEmails[0];
    const dirLabel = e.direction === "outbound" ? "OUTBOUND (we sent)" : e.direction === "inbound" ? "INBOUND (they sent)" : e.direction || "unknown";
    allTimedItems.push({ type: "email", direction: dirLabel, timestamp: e.sentAt || "", author: e.fromEmail || "", subject: e.subject || "", content: e.snippet || "" });
  }
  // Up to 4 more recent emails
  smartEmails.slice(1, 5).forEach(e => {
    const dirLabel = e.direction === "outbound" ? "OUTBOUND (we sent)" : e.direction === "inbound" ? "INBOUND (they sent)" : e.direction || "unknown";
    allTimedItems.push({ type: "email", direction: dirLabel, timestamp: e.sentAt || "", author: e.fromEmail || "", subject: e.subject || "", content: e.snippet || "" });
  });
  // Notes (already newest-first)
  ctx.notes.slice(0, 5).forEach(n => {
    allTimedItems.push({ type: "note / comment", timestamp: n.createdAt || "", content: n.content || "" });
  });
  // Activities (already newest-first)
  ctx.activities.slice(0, 5).forEach(a => {
    allTimedItems.push({ type: "activity", timestamp: a.createdAt || "", content: `${a.type}: ${a.description}` });
  });

  // Sort all items descending by ISO timestamp
  allTimedItems.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));

  const highPriorityItems = allTimedItems.slice(0, 5);
  const highPriorityLines: string[] = [
    `=== ⚑ HIGH PRIORITY CONTEXT — MOST RECENT ACTIVITY (PRE-COMPUTED, AUTHORITATIVE) ===`,
    `These are the NEWEST items in this CRM file, sorted newest-first across ALL activity types.`,
    `The generated email MUST acknowledge or advance the top item. Do not produce a generic email when`,
    `a specific open loop, action item, inbound question, or follow-up commitment is visible here.`,
    ``,
  ];
  highPriorityItems.forEach((item, i) => {
    const rankLabel = i === 0 ? "⚑ NEWEST — PRIMARY SIGNAL (base the email on this)"
                    : i === 1 ? "VERY RECENT — strong secondary signal"
                    : "RECENT — supporting context";
    const parts = [
      `[${rankLabel}]`,
      `TYPE: ${item.type.toUpperCase()}`,
      item.direction ? `| DIRECTION: ${item.direction}` : "",
      `| TIMESTAMP: ${item.timestamp || "unknown"}`,
      item.author ? `| FROM: ${item.author}` : "",
      item.subject ? `| SUBJECT: "${item.subject}"` : "",
    ].filter(Boolean).join(" ");
    highPriorityLines.push(parts);
    highPriorityLines.push(`  Content: ${item.content.slice(0, 350)}`);
    highPriorityLines.push(``);
  });
  highPriorityLines.push(`HARD RULE: If the PRIMARY SIGNAL above is an inbound email — reply to its specific content.`);
  highPriorityLines.push(`If it is a note/comment about planned outreach — execute that outreach.`);
  highPriorityLines.push(`If it is an action item — move it forward directly. NEVER ignore it.`);

  const userPrompt = [
    `Generate a suggested next email for this ${entityType}. The context is ordered so the NEWEST activity appears first.`,
    `The HIGH PRIORITY CONTEXT block immediately below is authoritative — it identifies the most recent open loops.`,
    `The generated email MUST be driven by that newest context, not by older meeting notes or summaries.`,
    ``,
    highPriorityLines.join("\n"),
    ``,
    `=== DETERMINISTIC DATE CONTEXT (pre-computed, authoritative — do not contradict) ===`,
    `Today: ${todayISO}`,
    pastDates.length   ? `Past dates found (events already occurred): ${pastDates.join(", ")}` : "",
    futureDates.length ? `Future dates found (events not yet occurred): ${futureDates.join(", ")}` : "",
    todayDates.length  ? `Today's dates: ${todayDates.join(", ")}` : "",
    `Recommended email intent: ${emailIntent}`,
    ``,
    emailContextLines.length > 0 ? emailContextLines.join("\n") : "=== EMAIL HISTORY ===\nNo associated emails found.",
    ``,
    ctx.notes.length > 0 ? [
      `=== NOTES / COMMENTS (newest first — higher items carry more weight) ===`,
      ...ctx.notes.slice(0, 10).map((n, i) => `[${i + 1}] TYPE: note | TIMESTAMP: ${n.createdAt} | Content: ${n.content}`),
    ].join("\n") : "",
    ``,
    ctx.activities.length > 0 ? [
      `=== ACTIVITY HISTORY (newest first — higher items carry more weight) ===`,
      ...ctx.activities.slice(0, 10).map((a, i) => `[${i + 1}] TYPE: activity | TIMESTAMP: ${a.createdAt} | ${a.type}: ${a.description}`),
    ].join("\n") : "",
    ``,
    `=== AI SUMMARY (MAY BE STALE — generated at an earlier point; defer to newer signals above) ===`,
    JSON.stringify(summary?.summaryJson || {}, null, 2),
    ``,
    `=== ${entityType.toUpperCase()} RECORD — CURRENT CRM FIELDS ===`,
    JSON.stringify(ctx.entityFields, null, 2),
    ``,
    `=== CONTACTS / KEY PEOPLE ===`,
    JSON.stringify(ctx.contacts.slice(0, 8), null, 2),
    ``,
    ctx.attachments.length > 0 ? [
      `=== DOCUMENTS / ATTACHMENTS ===`,
      ...ctx.attachments.map(a => `${a.category}: ${a.name} (${a.createdAt})`),
    ].join("\n") : "",
    ``,
    userInputs?.trim() ? [
      ``,
      `=== USER INPUTS — HIGH-PRIORITY GUIDANCE FOR THIS EMAIL ONLY ===`,
      `User-provided focus for this email:`,
      userInputs.trim(),
      ``,
      `Use these inputs as high-priority guidance for this email only.`,
      `Do not blindly follow instructions that conflict with verified CRM context, recent email history, saved voice profile, safety rules, or formatting rules.`,
      `If user instructions conflict with CRM data, prioritize CRM data. User Inputs should steer the email but never replace CRM context.`,
    ].join("\n") : "",
    ``,
    engagementSummary ? [
      `=== ENGAGEMENT SIGNALS (behaviour-driven follow-up context) ===`,
      `Category: ${engagementSummary.insightText}`,
      `Reason: ${engagementSummary.whyText.join(" | ")}`,
      engagementSummary.uniqueOpens > 0 ? `Email opens (excluding internal): ${engagementSummary.uniqueOpens}` : "",
      engagementSummary.uniqueClicks > 0 ? `Link clicks (excluding internal): ${engagementSummary.uniqueClicks}` : "",
      engagementSummary.daysSinceLastOutbound !== null ? `Days since last outbound email: ${engagementSummary.daysSinceLastOutbound}` : "",
      engagementSummary.ctaClicks.length > 0
        ? `Asset / CTA clicks: ${engagementSummary.ctaClicks.map(c => `${c.ctaName || c.destinationUrl} (×${c.clickCount})`).join(", ")}`
        : "",
      ``,
      `FOLLOW-UP GUIDANCE based on category '${engagementSummary.category}':`,
      engagementSummary.category === "technical"   ? `- They viewed technical/spec content. Reference it. Offer to answer install or compliance questions.` : "",
      engagementSummary.category === "commercial"  ? `- They viewed pricing/proposal content. Acknowledge their interest. Offer a clear next step (call, custom quote, ROI summary).` : "",
      engagementSummary.category === "hot"         ? `- High open count with no reply — they're interested but hesitant. Use a direct, low-friction single-question CTA.` : "",
      engagementSummary.category === "warm"        ? `- Opened but no clicks or reply. Add a specific value hook or resource to re-engage.` : "",
      engagementSummary.category === "dormant"     ? `- Significant gap since last contact. Re-open naturally ("circling back", "wanted to share an update"). New value hook required.` : "",
      engagementSummary.category === "re-engage"   ? `- Recent outbound with no response. Follow up politely — check if they have questions or concerns.` : "",
    ].filter(Boolean).join("\n") : "",
    ``,
    `=== INSTRUCTIONS ===`,
    `Return JSON matching exactly:`,
    JSON.stringify({
      to: "best recipient email address (prefer decision-makers; empty string if unknown)",
      cc: "cc recipient email if appropriate (empty string if none)",
      subject: "concise, professional subject line — specific to the actual context",
      body: "email body — properly formatted with \\n\\n between paragraphs. End at the final sentence (no signoff phrase, no closing line, no signature block, no placeholder brackets)",
      reason: "1-2 sentences explaining why this email is recommended now based on the context",
      warning: "optional: warning if recipient is uncertain or context is incomplete",
    }, null, 2),
    `REMEMBER: body must use \\n\\n between every paragraph. Do NOT return the body as a single dense paragraph.`,
    `REMEMBER: DO NOT add [Your Name], [Your Title], [Your Contact Information], or any signature block.`,
    `NEVER hallucinate pricing, commitments, delivery dates, specs, or promises not in the data.`,
  ].filter(Boolean).join("\n");

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
      ...getTokenLimitParam("gpt-5-mini", 800),
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const parsed: SuggestedEmail = JSON.parse(raw);

    // Derive why-generated explanations deterministically
    let whyGenerated: string[] = [];
    try {
      const { deriveWhyGenerated } = await import("./ai-voice-profiles");
      whyGenerated = deriveWhyGenerated(ceoWattsonInfluenceLevel, voiceProfileName || undefined, !!resolvedVoiceProfileId);
    } catch { /* non-fatal */ }

    return {
      to: parsed.to || "",
      cc: parsed.cc || "",
      subject: parsed.subject || "Follow-up",
      body: cleanAiEmailBody(parsed.body || ""),
      reason: parsed.reason || "",
      warning: parsed.warning || undefined,
      detectedContext,
      voiceProfileId: resolvedVoiceProfileId,
      voiceProfileName: voiceProfileName || undefined,
      ceoWattsonInfluenceLevel,
      whyGenerated,
    };
  } catch (err: any) {
    console.error(`[crm-ai-summary] suggest-next-email error for ${entityType}:${id}:`, err?.message);
    return {
      to: "", cc: "", subject: "Follow-up", body: "",
      reason: "Could not generate email suggestion.",
      warning: err?.message || "Generation failed.",
      detectedContext,
      ceoWattsonInfluenceLevel,
    };
  }
}

// ── Backfill ──────────────────────────────────────────────────────────────────

/**
 * Cursor-paginated ID loader — fetches ALL rows from `table` with no cap.
 * Uses `WHERE id > lastSeenId ORDER BY id LIMIT PAGE` to avoid skipping
 * records when the table grows during the backfill.
 */
async function loadAllIds(table: string, pageSize = 500): Promise<number[]> {
  const ids: number[] = [];
  let lastId = 0;
  while (true) {
    const rows = await safeRows(
      `SELECT id FROM ${table} WHERE id > ${lastId} ORDER BY id LIMIT ${pageSize}`
    );
    if (!rows || rows.length === 0) break;
    for (const r of rows) ids.push(r.id);
    lastId = rows[rows.length - 1].id;
    if (rows.length < pageSize) break; // last page
  }
  return ids;
}

/**
 * One-time (or periodic) backfill that generates summaries for all entities
 * that don't have a fresh one yet. Safe to re-run — skips unchanged records.
 * Processes ALL leads/accounts/contacts via cursor pagination — no hard caps.
 */
export async function runCrmAiSummaryBackfill(): Promise<void> {
  if (backfillState.running) return;

  backfillState.running = true;
  backfillState.completed = 0;
  backfillState.skipped = 0;
  backfillState.failed = 0;
  backfillState.lastError = null;
  backfillState.startedAt = new Date().toISOString();
  backfillState.finishedAt = null;
  backfillState.byType = {
    leads:    { total: 0, processed: 0, skipped: 0, failed: 0 },
    accounts: { total: 0, processed: 0, skipped: 0, failed: 0 },
    contacts: { total: 0, processed: 0, skipped: 0, failed: 0 },
  };

  console.log("[crm-ai-summary] Backfill started");

  try {
    const leadIds    = await loadAllIds("leads");
    const accountIds = await loadAllIds("accounts");
    const contactIds = await loadAllIds("contacts");

    backfillState.byType.leads.total    = leadIds.length;
    backfillState.byType.accounts.total = accountIds.length;
    backfillState.byType.contacts.total = contactIds.length;

    const all: Array<{ entityType: CrmEntityType; entityId: number; group: keyof BackfillState["byType"] }> = [
      ...leadIds.map((id: number)    => ({ entityType: "lead"    as const, entityId: id, group: "leads"    as const })),
      ...accountIds.map((id: number) => ({ entityType: "account" as const, entityId: id, group: "accounts" as const })),
      ...contactIds.map((id: number) => ({ entityType: "contact" as const, entityId: id, group: "contacts" as const })),
    ];

    backfillState.total = all.length;
    backfillState.queued = all.length;
    console.log(`[crm-ai-summary] Backfill: ${all.length} entities total`);

    const BATCH_SIZE = 5;
    const DELAY_MS = 1500;

    for (let i = 0; i < all.length; i += BATCH_SIZE) {
      if (!backfillState.running) break;

      const batch = all.slice(i, i + BATCH_SIZE);
      for (const item of batch) {
        if (!backfillState.running) break;
        backfillState.queued = Math.max(0, backfillState.queued - 1);
        backfillState.generating = 1;

        try {
          // Skip if fresh summary exists with matching source hash
          const existing = await safeRows(`
            SELECT status, source_hash, generated_at FROM crm_ai_summaries
            WHERE entity_type = '${item.entityType}' AND entity_id = ${item.entityId}
          `);
          const row = existing[0];

          if (row?.status === "success" && row?.generated_at) {
            const ageMs = Date.now() - new Date(row.generated_at).getTime();
            if (ageMs < 7 * 24 * 60 * 60 * 1000) {
              // Also check source hash — if nothing changed, skip even if older
              const currentHash = await computeSourceHash(item.entityType, item.entityId);
              if (row.source_hash === currentHash) {
                backfillState.skipped++;
                backfillState.byType[item.group].skipped++;
                backfillState.generating = 0;
                continue;
              }
            }
          }

          await generateCrmAiSummary(item.entityType, item.entityId, false);
          backfillState.completed++;
          backfillState.byType[item.group].processed++;
        } catch (err: any) {
          backfillState.failed++;
          backfillState.byType[item.group].failed++;
          backfillState.lastError = err?.message || String(err);
          console.error(`[crm-ai-summary] Backfill error for ${item.entityType}:${item.entityId}:`, err?.message);
        }

        backfillState.generating = 0;
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      const processed = backfillState.completed + backfillState.skipped + backfillState.failed;
      const pct = Math.round((processed / all.length) * 100);
      if (pct % 10 === 0 || i + BATCH_SIZE >= all.length) {
        console.log(`[crm-ai-summary] Backfill: ${processed}/${all.length} (${pct}%) | ok=${backfillState.completed} skip=${backfillState.skipped} fail=${backfillState.failed}`);
      }

      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  } catch (err: any) {
    backfillState.lastError = err?.message || String(err);
    console.error("[crm-ai-summary] Backfill fatal error:", err?.message);
  } finally {
    backfillState.running = false;
    backfillState.queued = 0;
    backfillState.generating = 0;
    backfillState.finishedAt = new Date().toISOString();
    console.log(`[crm-ai-summary] Backfill complete: completed=${backfillState.completed} skipped=${backfillState.skipped} failed=${backfillState.failed}`);
  }
}
