/**
 * Cortex Email Intel Service
 *
 * Manages manually-flagged marine industry intelligence from Trevor's inbox.
 * Records are ingested via the Save to Cortex flow and used by the AI email
 * generator, campaign builder, and account research features.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import OpenAI from "openai";

function buildOpenAIClient(): OpenAI | null {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  return new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
}

// ── Migration ──────────────────────────────────────────────────────────────

export async function migrateCortexEmailIntelSchema(): Promise<void> {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS cortex_email_intel (
      id                  SERIAL PRIMARY KEY,
      mail_message_id     TEXT NOT NULL,
      thread_id           TEXT,
      subject             TEXT,
      sender_name         TEXT,
      sender_email        TEXT,
      received_at         TIMESTAMPTZ,
      source_label        TEXT,
      intel_type          TEXT NOT NULL DEFAULT 'Marine Industry Intel',
      importance          TEXT NOT NULL DEFAULT 'Medium',
      use_for             TEXT[] NOT NULL DEFAULT '{}',
      tags                TEXT[] NOT NULL DEFAULT '{}',
      user_notes          TEXT,
      ai_summary          TEXT,
      strategic_relevance TEXT,
      extracted_facts     JSONB,
      source_url          TEXT,
      related_contact_id  INTEGER,
      related_account_id  INTEGER,
      related_lead_id     INTEGER,
      created_by_user_id  INTEGER NOT NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at          TIMESTAMPTZ
    )
  `));
  console.log("[migration] cortex_email_intel schema ready.");
}

// ── Types ──────────────────────────────────────────────────────────────────

export const INTEL_TYPES = [
  "Marine Industry Intel",
  "NMMA / Association News",
  "Marina Market Data",
  "Boating Consumer Trends",
  "Regulatory / Compliance",
  "Competitor / Partner Intel",
  "Grant / Funding Intel",
  "Customer Pain / Voice of Market",
  "Other",
] as const;

export const IMPORTANCE_LEVELS = [
  "Low",
  "Medium",
  "High",
  "Board-Level / Strategic",
] as const;

export const USE_FOR_OPTIONS = [
  "AI email writing",
  "Lead/account research",
  "Campaign context",
  "Investor/funding narrative",
  "Cortex knowledge base",
  "All of the above",
] as const;

// ── CRUD ───────────────────────────────────────────────────────────────────

export async function checkCortexIntelByMessageId(mailMessageId: string): Promise<any | null> {
  const rows = await db.execute(sql.raw(`
    SELECT id, mail_message_id, intel_type, importance, ai_summary, strategic_relevance,
           use_for, tags, user_notes, created_at, updated_at
    FROM cortex_email_intel
    WHERE mail_message_id = '${mailMessageId.replace(/'/g, "''")}'
      AND deleted_at IS NULL
    LIMIT 1
  `));
  return (rows as any).rows?.[0] ?? null;
}

export async function listCortexIntelRecords(opts: {
  limit?: number;
  offset?: number;
  intelType?: string;
  importance?: string;
  search?: string;
} = {}): Promise<{ records: any[]; total: number }> {
  const { limit = 25, offset = 0, intelType, importance, search } = opts;
  const conditions: string[] = ["deleted_at IS NULL"];
  if (intelType) conditions.push(`intel_type = '${intelType.replace(/'/g, "''")}'`);
  if (importance) conditions.push(`importance = '${importance.replace(/'/g, "''")}'`);
  if (search) {
    const s = search.replace(/'/g, "''");
    conditions.push(`(subject ILIKE '%${s}%' OR ai_summary ILIKE '%${s}%' OR sender_name ILIKE '%${s}%' OR source_label ILIKE '%${s}%' OR user_notes ILIKE '%${s}%')`);
  }
  const where = conditions.join(" AND ");

  const [dataRows, countRow] = await Promise.all([
    db.execute(sql.raw(`
      SELECT id, mail_message_id, thread_id, subject, sender_name, sender_email,
             received_at, source_label, intel_type, importance, use_for, tags,
             user_notes, ai_summary, strategic_relevance, source_url,
             related_contact_id, related_account_id, related_lead_id,
             created_by_user_id, created_at, updated_at
      FROM cortex_email_intel
      WHERE ${where}
      ORDER BY
        CASE importance
          WHEN 'Board-Level / Strategic' THEN 1
          WHEN 'High' THEN 2
          WHEN 'Medium' THEN 3
          ELSE 4
        END,
        created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `)),
    db.execute(sql.raw(`SELECT COUNT(*)::int AS total FROM cortex_email_intel WHERE ${where}`)),
  ]);

  return {
    records: (dataRows as any).rows ?? [],
    total: ((countRow as any).rows?.[0]?.total ?? 0) as number,
  };
}

export async function createCortexIntelRecord(data: {
  mailMessageId: string;
  threadId?: string;
  subject?: string;
  senderName?: string;
  senderEmail?: string;
  receivedAt?: Date | string;
  sourceLabel?: string;
  intelType: string;
  importance: string;
  useFor: string[];
  tags: string[];
  userNotes?: string;
  aiSummary?: string;
  strategicRelevance?: string;
  extractedFacts?: any;
  sourceUrl?: string;
  relatedContactId?: number;
  relatedAccountId?: number;
  relatedLeadId?: number;
  createdByUserId: number;
}): Promise<any> {
  const useForArr = `ARRAY[${data.useFor.map(s => `'${s.replace(/'/g, "''")}'`).join(",")}]::text[]`;
  const tagsArr   = `ARRAY[${data.tags.map(s => `'${s.replace(/'/g, "''")}'`).join(",")}]::text[]`;

  const row = await db.execute(sql.raw(`
    INSERT INTO cortex_email_intel (
      mail_message_id, thread_id, subject, sender_name, sender_email, received_at,
      source_label, intel_type, importance, use_for, tags, user_notes,
      ai_summary, strategic_relevance, extracted_facts, source_url,
      related_contact_id, related_account_id, related_lead_id, created_by_user_id
    ) VALUES (
      '${data.mailMessageId.replace(/'/g, "''")}',
      ${data.threadId ? `'${data.threadId.replace(/'/g, "''")}'` : "NULL"},
      ${data.subject ? `'${data.subject.replace(/'/g, "''")}'` : "NULL"},
      ${data.senderName ? `'${data.senderName.replace(/'/g, "''")}'` : "NULL"},
      ${data.senderEmail ? `'${data.senderEmail.replace(/'/g, "''")}'` : "NULL"},
      ${data.receivedAt ? `'${new Date(data.receivedAt).toISOString()}'` : "NULL"},
      ${data.sourceLabel ? `'${data.sourceLabel.replace(/'/g, "''")}'` : "NULL"},
      '${data.intelType.replace(/'/g, "''")}',
      '${data.importance.replace(/'/g, "''")}',
      ${useForArr},
      ${tagsArr},
      ${data.userNotes ? `'${data.userNotes.replace(/'/g, "''")}'` : "NULL"},
      ${data.aiSummary ? `'${data.aiSummary.replace(/'/g, "''")}'` : "NULL"},
      ${data.strategicRelevance ? `'${data.strategicRelevance.replace(/'/g, "''")}'` : "NULL"},
      ${data.extractedFacts ? `'${JSON.stringify(data.extractedFacts).replace(/'/g, "''")}'::jsonb` : "NULL"},
      ${data.sourceUrl ? `'${data.sourceUrl.replace(/'/g, "''")}'` : "NULL"},
      ${data.relatedContactId ?? "NULL"},
      ${data.relatedAccountId ?? "NULL"},
      ${data.relatedLeadId ?? "NULL"},
      ${data.createdByUserId}
    )
    RETURNING *
  `));
  return (row as any).rows?.[0] ?? null;
}

export async function updateCortexIntelRecord(id: number, data: Partial<{
  intelType: string;
  importance: string;
  useFor: string[];
  tags: string[];
  userNotes: string;
  aiSummary: string;
  strategicRelevance: string;
  extractedFacts: any;
  sourceUrl: string;
  relatedContactId: number | null;
  relatedAccountId: number | null;
  relatedLeadId: number | null;
}>): Promise<any> {
  const setClauses: string[] = ["updated_at = NOW()"];
  if (data.intelType !== undefined) setClauses.push(`intel_type = '${data.intelType.replace(/'/g, "''")}'`);
  if (data.importance !== undefined) setClauses.push(`importance = '${data.importance.replace(/'/g, "''")}'`);
  if (data.useFor !== undefined) {
    const arr = `ARRAY[${data.useFor.map(s => `'${s.replace(/'/g, "''")}'`).join(",")}]::text[]`;
    setClauses.push(`use_for = ${arr}`);
  }
  if (data.tags !== undefined) {
    const arr = `ARRAY[${data.tags.map(s => `'${s.replace(/'/g, "''")}'`).join(",")}]::text[]`;
    setClauses.push(`tags = ${arr}`);
  }
  if (data.userNotes !== undefined) setClauses.push(`user_notes = ${data.userNotes ? `'${data.userNotes.replace(/'/g, "''")}'` : "NULL"}`);
  if (data.aiSummary !== undefined) setClauses.push(`ai_summary = ${data.aiSummary ? `'${data.aiSummary.replace(/'/g, "''")}'` : "NULL"}`);
  if (data.strategicRelevance !== undefined) setClauses.push(`strategic_relevance = ${data.strategicRelevance ? `'${data.strategicRelevance.replace(/'/g, "''")}'` : "NULL"}`);
  if (data.extractedFacts !== undefined) setClauses.push(`extracted_facts = ${data.extractedFacts ? `'${JSON.stringify(data.extractedFacts).replace(/'/g, "''")}'::jsonb` : "NULL"}`);
  if (data.sourceUrl !== undefined) setClauses.push(`source_url = ${data.sourceUrl ? `'${data.sourceUrl.replace(/'/g, "''")}'` : "NULL"}`);
  if (data.relatedContactId !== undefined) setClauses.push(`related_contact_id = ${data.relatedContactId ?? "NULL"}`);
  if (data.relatedAccountId !== undefined) setClauses.push(`related_account_id = ${data.relatedAccountId ?? "NULL"}`);
  if (data.relatedLeadId !== undefined) setClauses.push(`related_lead_id = ${data.relatedLeadId ?? "NULL"}`);

  const row = await db.execute(sql.raw(`
    UPDATE cortex_email_intel SET ${setClauses.join(", ")}
    WHERE id = ${id} AND deleted_at IS NULL
    RETURNING *
  `));
  return (row as any).rows?.[0] ?? null;
}

// ── AI Summary Generation ──────────────────────────────────────────────────

export async function generateCortexIntelSummary(emailData: {
  subject: string;
  senderName?: string;
  senderEmail?: string;
  receivedAt?: string;
  body?: string;
  snippet?: string;
  sourceLabel?: string;
}): Promise<{
  aiSummary: string;
  strategicRelevance: string;
  suggestedTags: string[];
  suggestedIntelType: string;
  suggestedUseCases: string[];
  extractedFacts: string[];
}> {
  const openai = buildOpenAIClient();
  if (!openai) {
    return {
      aiSummary: "AI not configured.",
      strategicRelevance: "",
      suggestedTags: [],
      suggestedIntelType: "Marine Industry Intel",
      suggestedUseCases: ["Cortex knowledge base"],
      extractedFacts: [],
    };
  }

  const bodyContent = (emailData.body || emailData.snippet || "").slice(0, 6000);
  const prompt = `You are analyzing an email for VoltSafe, a marina electrification company that sells EV charging infrastructure to marinas. Trevor Burgess (CEO) is an NMMA Canada Board of Directors member.

Email details:
Subject: ${emailData.subject || "(none)"}
From: ${emailData.senderName || ""} ${emailData.senderEmail ? `<${emailData.senderEmail}>` : ""}
Date: ${emailData.receivedAt || "unknown"}
Source: ${emailData.sourceLabel || "email"}

Body:
${bodyContent}

Analyze this email and return JSON with:
- aiSummary: 2-3 sentence factual summary of the key information/data in this email
- strategicRelevance: 1-2 sentences on why this is relevant to VoltSafe's marina electrification business, investor narrative, or sales positioning
- suggestedTags: array of 3-6 concise keyword tags (e.g. ["NMMA", "market data", "marine spending", "2025"])
- suggestedIntelType: one of: "Marine Industry Intel", "NMMA / Association News", "Marina Market Data", "Boating Consumer Trends", "Regulatory / Compliance", "Competitor / Partner Intel", "Grant / Funding Intel", "Customer Pain / Voice of Market", "Other"
- suggestedUseCases: array from: ["AI email writing", "Lead/account research", "Campaign context", "Investor/funding narrative", "Cortex knowledge base"]
- extractedFacts: array of 3-5 specific, concrete, quotable facts or data points from the email (e.g. "U.S. recreational marine spending totaled $54B in 2025")

Return only valid JSON.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 800,
      temperature: 0.3,
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const parsed = JSON.parse(stripped);

    return {
      aiSummary: parsed.aiSummary || "",
      strategicRelevance: parsed.strategicRelevance || "",
      suggestedTags: Array.isArray(parsed.suggestedTags) ? parsed.suggestedTags.slice(0, 8) : [],
      suggestedIntelType: parsed.suggestedIntelType || "Marine Industry Intel",
      suggestedUseCases: Array.isArray(parsed.suggestedUseCases) ? parsed.suggestedUseCases : ["Cortex knowledge base"],
      extractedFacts: Array.isArray(parsed.extractedFacts) ? parsed.extractedFacts.slice(0, 8) : [],
    };
  } catch (e) {
    console.error("[cortex-intel] AI summary generation failed:", e);
    return {
      aiSummary: "AI summary unavailable.",
      strategicRelevance: "",
      suggestedTags: [],
      suggestedIntelType: "Marine Industry Intel",
      suggestedUseCases: ["Cortex knowledge base"],
      extractedFacts: [],
    };
  }
}

// ── Prompt Injection ───────────────────────────────────────────────────────
// Called by crm-ai-summary.ts to inject relevant intel into email generation prompts.

export async function getCortexIntelForPrompt(opts: {
  limit?: number;
  minImportance?: "Medium" | "High" | "Board-Level / Strategic";
} = {}): Promise<string> {
  const { limit = 5, minImportance = "Medium" } = opts;
  const importancePriority: Record<string, number> = {
    "Low": 4,
    "Medium": 3,
    "High": 2,
    "Board-Level / Strategic": 1,
  };
  const minRank = importancePriority[minImportance] ?? 3;

  try {
    const rows = await db.execute(sql.raw(`
      SELECT subject, sender_name, received_at, intel_type, importance,
             ai_summary, strategic_relevance, tags, extracted_facts
      FROM cortex_email_intel
      WHERE deleted_at IS NULL
        AND ai_summary IS NOT NULL AND ai_summary != ''
        AND CASE importance
          WHEN 'Board-Level / Strategic' THEN 1
          WHEN 'High' THEN 2
          WHEN 'Medium' THEN 3
          ELSE 4
        END <= ${minRank}
      ORDER BY
        CASE importance
          WHEN 'Board-Level / Strategic' THEN 1
          WHEN 'High' THEN 2
          WHEN 'Medium' THEN 3
          ELSE 4
        END,
        created_at DESC
      LIMIT ${limit}
    `));

    const records: any[] = (rows as any).rows ?? [];
    if (records.length === 0) return "";

    const lines: string[] = [
      `=== 🌊 MARINE INDUSTRY INTELLIGENCE (from Cortex knowledge base — use where relevant) ===`,
      `The following intelligence was manually flagged as high-value marine industry context.`,
      `Use it naturally when relevant — DO NOT force it into every email. Prefer concise, 1-sentence references.`,
      ``,
    ];

    records.forEach((r, i) => {
      const tags = Array.isArray(r.tags) ? r.tags.join(", ") : "";
      const facts = Array.isArray(r.extracted_facts)
        ? r.extracted_facts.slice(0, 3).join(" | ")
        : typeof r.extracted_facts === "object" && r.extracted_facts
        ? Object.values(r.extracted_facts).join(" | ")
        : "";
      const dateStr = r.received_at ? new Date(r.received_at).toLocaleDateString("en-CA", { year: "numeric", month: "short" }) : "";
      lines.push(`[Intel ${i + 1}] ${r.intel_type}${r.importance === "Board-Level / Strategic" || r.importance === "High" ? ` ⭐ ${r.importance}` : ""}`);
      if (r.subject) lines.push(`  Source: ${r.sender_name || ""} "${r.subject}"${dateStr ? ` (${dateStr})` : ""}`);
      if (r.ai_summary) lines.push(`  Summary: ${r.ai_summary}`);
      if (r.strategic_relevance) lines.push(`  VoltSafe relevance: ${r.strategic_relevance}`);
      if (facts) lines.push(`  Key facts: ${facts}`);
      if (tags) lines.push(`  Tags: ${tags}`);
      lines.push(``);
    });

    return lines.join("\n");
  } catch (e) {
    console.error("[cortex-intel] Failed to load intel for prompt:", e);
    return "";
  }
}
