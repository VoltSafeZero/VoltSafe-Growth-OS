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
import { db } from "../db";
import { sql } from "drizzle-orm";

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
    subject: string;
    fromEmail: string;
    snippet: string;
    direction: string;
    sentAt: string;
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

  // --- Entity fields ---
  let entityFields: Record<string, any> = {};
  if (entityType === "lead") {
    const rows = await safeRows(`SELECT company, contact_name, contact_email, status, deal_amount, est_close_date, source, notes FROM leads WHERE id = ${id}`);
    entityFields = rows[0] || {};
  } else if (entityType === "account") {
    const rows = await safeRows(`SELECT name, org_type, website, address, slip_count, power_demand_intensity, strategic_importance, priority_level FROM accounts WHERE id = ${id}`);
    entityFields = rows[0] || {};
  } else {
    const rows = await safeRows(`SELECT first_name, last_name, name, title, email, phone, persona, relationship_strength, linkedin_url FROM contacts WHERE id = ${id}`);
    entityFields = rows[0] || {};
  }

  // --- Notes ---
  const noteRows = await safeRows(`
    SELECT content, created_at FROM notes
    WHERE linked_object_type = '${entityType}' AND linked_object_id = ${id}
    ORDER BY created_at DESC LIMIT 25
  `);
  const notes = noteRows.map((r: any) => ({
    content: String(r.content || "").substring(0, 400),
    createdAt: String(r.created_at || ""),
  }));

  // --- Emails ---
  const emailRows = await safeRows(`
    SELECT em.subject, em.from_email, em.snippet, em.direction, em.sent_at
    FROM email_associations ea
    JOIN email_messages em ON ea.email_message_id = em.id
    WHERE ea.object_type = '${entityType}' AND ea.object_id = ${id}
    ORDER BY em.sent_at DESC NULLS LAST LIMIT 25
  `);
  const emails = emailRows.map((r: any) => ({
    subject: String(r.subject || ""),
    fromEmail: String(r.from_email || ""),
    snippet: String(r.snippet || "").substring(0, 200),
    direction: String(r.direction || ""),
    sentAt: String(r.sent_at || ""),
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

  // --- Activities ---
  const actRows = await safeRows(`
    SELECT type, description, created_at FROM activities
    WHERE linked_object_type = '${entityType}' AND linked_object_id = ${id}
    ORDER BY created_at DESC LIMIT 15
  `);
  const activities = actRows.map((r: any) => ({
    type: String(r.type || ""),
    description: String(r.description || "").substring(0, 200),
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
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a CRM intelligence assistant. Return only valid JSON. No markdown, no explanation.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 1200,
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
}

export async function generateSuggestedNextEmail(
  entityType: CrmEntityType,
  entityId: number
): Promise<SuggestedEmail> {
  const id = Number(entityId);

  const openai = buildOpenAIClient();
  if (!openai) {
    return {
      to: "",
      cc: "",
      subject: "Follow-up",
      body: "",
      reason: "AI is not configured.",
      warning: "No OpenAI API key configured.",
    };
  }

  // Use saved summary if available — do not auto-generate if missing
  const summary = await getCrmAiSummary(entityType, id);
  const ctx = await collectCrmEntityContext(entityType, id);

  const systemPrompt = `You are an expert sales and relationship manager at VoltSafe, a marina electrification company. Generate a professional, warm, and concise email suggestion. Return only valid JSON.`;

  const userPrompt = [
    `Generate a suggested next email for this ${entityType}:`,
    `\n=== AI SUMMARY ===`,
    JSON.stringify(summary?.summaryJson || {}, null, 2),
    `\n=== KEY CONTEXT ===`,
    `Entity: ${JSON.stringify(ctx.entityFields)}`,
    `Contacts: ${JSON.stringify(ctx.contacts.slice(0, 5))}`,
    `Recent notes: ${ctx.notes.slice(0, 3).map(n => n.content).join(" | ")}`,
    `\n=== INSTRUCTIONS ===`,
    `Return JSON matching:`,
    JSON.stringify({
      to: "best recipient email address (prefer decision-makers; empty string if unknown)",
      cc: "cc recipient email if appropriate (empty string if none)",
      subject: "concise, professional subject line",
      body: "email body — professional, warm, 3-5 paragraphs max, VoltSafe-specific context",
      reason: "1-2 sentences explaining why this email is recommended now",
      warning: "optional: warning if recipient is uncertain or context is incomplete",
    }, null, 2),
    `NEVER hallucinate pricing, commitments, delivery dates, specs, or promises not in the data.`,
    `NEVER auto-send. This is a suggestion only.`,
    `Tone: professional, concise, warm, operational.`,
  ].join("\n");

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
      max_tokens: 800,
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const parsed: SuggestedEmail = JSON.parse(raw);
    return {
      to: parsed.to || "",
      cc: parsed.cc || "",
      subject: parsed.subject || "Follow-up",
      body: parsed.body || "",
      reason: parsed.reason || "",
      warning: parsed.warning || undefined,
    };
  } catch (err: any) {
    console.error(`[crm-ai-summary] suggest-next-email error for ${entityType}:${id}:`, err?.message);
    return {
      to: "",
      cc: "",
      subject: "Follow-up",
      body: "",
      reason: "Could not generate email suggestion.",
      warning: err?.message || "Generation failed.",
    };
  }
}

// ── Backfill ──────────────────────────────────────────────────────────────────

/**
 * One-time (or periodic) backfill that generates summaries for all entities
 * that don't have a fresh one yet. Safe to re-run — skips unchanged records.
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
    const leadIds    = (await safeRows("SELECT id FROM leads ORDER BY id LIMIT 5000")).map((r: any) => r.id);
    const accountIds = (await safeRows("SELECT id FROM accounts ORDER BY id LIMIT 2000")).map((r: any) => r.id);
    const contactIds = (await safeRows("SELECT id FROM contacts ORDER BY id LIMIT 5000")).map((r: any) => r.id);

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
