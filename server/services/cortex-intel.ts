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
import { buildOpenAIModelParams } from "./openai-compat";

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

  // Partial unique index: prevent active duplicates per message id
  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cortex_intel_message_id_active
    ON cortex_email_intel (mail_message_id)
    WHERE deleted_at IS NULL
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

export async function getCortexIntelById(id: number): Promise<any | null> {
  const rows = await db.execute(sql.raw(`
    SELECT id, mail_message_id, thread_id, subject, sender_name, sender_email,
           received_at, source_label, intel_type, importance, use_for, tags,
           user_notes, ai_summary, strategic_relevance, extracted_facts, source_url,
           related_contact_id, related_account_id, related_lead_id,
           created_by_user_id, created_at, updated_at
    FROM cortex_email_intel
    WHERE id = ${id} AND deleted_at IS NULL
  `));
  return (rows as any).rows?.[0] ?? null;
}

export async function listCortexIntelRecords(opts: {
  limit?: number;
  offset?: number;
  intelType?: string;
  importance?: string;
  search?: string;
  useFor?: string;
  tags?: string[];
  senderEmail?: string;
  dateFrom?: string;
  dateTo?: string;
  savedByUserId?: number;
} = {}): Promise<{ records: any[]; total: number }> {
  const {
    limit = 25, offset = 0,
    intelType, importance, search,
    useFor, tags, senderEmail, dateFrom, dateTo, savedByUserId,
  } = opts;

  const conditions: string[] = ["deleted_at IS NULL"];
  if (intelType)     conditions.push(`intel_type = '${intelType.replace(/'/g, "''")}'`);
  if (importance)    conditions.push(`importance = '${importance.replace(/'/g, "''")}'`);
  if (senderEmail)   conditions.push(`sender_email ILIKE '%${senderEmail.replace(/'/g, "''")}%'`);
  if (savedByUserId) conditions.push(`created_by_user_id = ${Number(savedByUserId)}`);
  if (dateFrom)      conditions.push(`received_at >= '${dateFrom}'`);
  if (dateTo)        conditions.push(`received_at <= '${dateTo} 23:59:59'`);
  if (useFor) {
    const u = useFor.replace(/'/g, "''");
    conditions.push(`(use_for @> ARRAY['${u}']::text[] OR use_for @> ARRAY['All of the above']::text[])`);
  }
  if (tags && tags.length > 0) {
    const tagList = tags.map(t => `'${t.replace(/'/g, "''")}'`).join(",");
    conditions.push(`tags && ARRAY[${tagList}]::text[]`);
  }
  if (search) {
    const s = search.replace(/'/g, "''");
    conditions.push(`(subject ILIKE '%${s}%' OR ai_summary ILIKE '%${s}%' OR sender_name ILIKE '%${s}%' OR source_label ILIKE '%${s}%' OR user_notes ILIKE '%${s}%' OR strategic_relevance ILIKE '%${s}%' OR tags::text ILIKE '%${s}%')`);
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

/**
 * Upsert: if an active record already exists for this mailMessageId, update it;
 * otherwise create a new record. Handles the restored-from-deleted case too.
 */
export async function upsertCortexIntelRecord(data: Parameters<typeof createCortexIntelRecord>[0]): Promise<{ record: any; created: boolean }> {
  // Check for existing active record
  const existing = await checkCortexIntelByMessageId(data.mailMessageId);
  if (existing) {
    const updated = await updateCortexIntelRecord(existing.id, {
      intelType: data.intelType,
      importance: data.importance,
      useFor: data.useFor,
      tags: data.tags,
      userNotes: data.userNotes,
      aiSummary: data.aiSummary,
      strategicRelevance: data.strategicRelevance,
      extractedFacts: data.extractedFacts,
      sourceUrl: data.sourceUrl,
      relatedContactId: data.relatedContactId,
      relatedAccountId: data.relatedAccountId,
      relatedLeadId: data.relatedLeadId,
    });
    return { record: updated ?? existing, created: false };
  }

  // Check for soft-deleted record (restore it)
  const deletedRows = await db.execute(sql.raw(`
    SELECT id FROM cortex_email_intel
    WHERE mail_message_id = '${data.mailMessageId.replace(/'/g, "''")}'
      AND deleted_at IS NOT NULL
    LIMIT 1
  `));
  const deletedRow = (deletedRows as any).rows?.[0];
  if (deletedRow) {
    const useForArr = `ARRAY[${data.useFor.map(s => `'${s.replace(/'/g, "''")}'`).join(",")}]::text[]`;
    const tagsArr   = `ARRAY[${data.tags.map(s => `'${s.replace(/'/g, "''")}'`).join(",")}]::text[]`;
    const restored = await db.execute(sql.raw(`
      UPDATE cortex_email_intel SET
        deleted_at = NULL,
        intel_type = '${data.intelType.replace(/'/g, "''")}',
        importance = '${data.importance.replace(/'/g, "''")}',
        use_for = ${useForArr},
        tags = ${tagsArr},
        user_notes = ${data.userNotes ? `'${data.userNotes.replace(/'/g, "''")}'` : "NULL"},
        ai_summary = ${data.aiSummary ? `'${data.aiSummary.replace(/'/g, "''")}'` : "NULL"},
        strategic_relevance = ${data.strategicRelevance ? `'${data.strategicRelevance.replace(/'/g, "''")}'` : "NULL"},
        updated_at = NOW()
      WHERE id = ${deletedRow.id}
      RETURNING *
    `));
    const restoredRow = (restored as any).rows?.[0];
    return { record: restoredRow, created: true };
  }

  // Create fresh record
  const record = await createCortexIntelRecord(data);
  return { record, created: true };
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

export async function deleteCortexIntelRecord(id: number): Promise<boolean> {
  const row = await db.execute(sql.raw(`
    UPDATE cortex_email_intel SET deleted_at = NOW()
    WHERE id = ${id} AND deleted_at IS NULL
    RETURNING id
  `));
  return ((row as any).rows?.length ?? 0) > 0;
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
- aiSummary: 2-3 sentence factual summary of the key information/data in this email. If specific numbers or statistics appear, preserve them exactly.
- strategicRelevance: 1-2 sentences on why this is relevant to VoltSafe's marina electrification business, investor narrative, or sales positioning
- suggestedTags: array of 3-6 concise keyword tags (e.g. ["NMMA", "market data", "marine spending", "2025"])
- suggestedIntelType: one of: "Marine Industry Intel", "NMMA / Association News", "Marina Market Data", "Boating Consumer Trends", "Regulatory / Compliance", "Competitor / Partner Intel", "Grant / Funding Intel", "Customer Pain / Voice of Market", "Other"
- suggestedUseCases: array from: ["AI email writing", "Lead/account research", "Campaign context", "Investor/funding narrative", "Cortex knowledge base"]
- extractedFacts: array of 3-5 specific, concrete, quotable facts or data points from the email — these MUST be verbatim or very close paraphrases of what the source actually says (e.g. "NMMA reported U.S. recreational marine spending totaled $54B in 2025")

IMPORTANT: Do not invent or estimate statistics. Only extract facts that are clearly stated in the source email.

Return only valid JSON.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      ...buildOpenAIModelParams("gpt-5-mini", { tokenLimit: 800, temperature: 0.3 }),
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

/**
 * Fetches and ranks the most relevant Cortex intel records for a given generation context.
 * Uses JS-side scoring (tag overlap, type match, importance, recency, use_for match)
 * rather than blind top-N so that only genuinely relevant intel is injected.
 */
export async function getCortexIntelForPrompt(opts: {
  limit?: number;
  minImportance?: "Medium" | "High" | "Board-Level / Strategic";
  /** Recipient name / company name for relevance matching */
  recipientName?: string;
  /** Account / lead name for relevance matching */
  accountName?: string;
  /** Topic hint keywords (e.g. from lead industry, recent thread subjects) */
  topicHints?: string[];
  /** The purpose of this generation — matches against use_for */
  useForPurpose?: string;
} = {}): Promise<string> {
  const {
    limit = 5,
    minImportance = "Medium",
    recipientName,
    accountName,
    topicHints = [],
    useForPurpose,
  } = opts;

  const importancePriority: Record<string, number> = {
    "Low": 4, "Medium": 3, "High": 2, "Board-Level / Strategic": 1,
  };
  const minRank = importancePriority[minImportance] ?? 3;

  try {
    // Fetch a broader pool — we score + filter in JS
    const rows = await db.execute(sql.raw(`
      SELECT subject, sender_name, sender_email, received_at, intel_type, importance,
             ai_summary, strategic_relevance, tags, extracted_facts, use_for
      FROM cortex_email_intel
      WHERE deleted_at IS NULL
        AND ai_summary IS NOT NULL AND ai_summary != ''
        AND CASE importance
          WHEN 'Board-Level / Strategic' THEN 1
          WHEN 'High' THEN 2
          WHEN 'Medium' THEN 3
          ELSE 4
        END <= ${minRank}
      ORDER BY created_at DESC
      LIMIT 50
    `));

    const records: any[] = (rows as any).rows ?? [];
    if (records.length === 0) return "";

    // Build a set of hint tokens for matching
    const hintTokens = [
      ...(topicHints || []),
      recipientName || "",
      accountName || "",
    ]
      .join(" ")
      .toLowerCase()
      .split(/\s+/)
      .filter(t => t.length > 2);

    // Score each record for relevance
    const scored = records.map(r => {
      let score = 0;
      const recTags: string[] = Array.isArray(r.tags) ? r.tags.map((t: string) => t.toLowerCase()) : [];
      const recUseFor: string[] = Array.isArray(r.use_for) ? r.use_for : [];
      const recText = [r.subject || "", r.ai_summary || "", r.strategic_relevance || "", r.intel_type || ""].join(" ").toLowerCase();

      // Importance base weight
      const impWeight: Record<string, number> = {
        "Board-Level / Strategic": 5, "High": 3, "Medium": 1, "Low": 0,
      };
      score += impWeight[r.importance] ?? 1;

      // Recency bonus
      if (r.received_at) {
        const ageDays = (Date.now() - new Date(r.received_at).getTime()) / 86400000;
        if (ageDays <= 30)  score += 3;
        else if (ageDays <= 90)  score += 2;
        else if (ageDays <= 180) score += 1;
      }

      // Tag / topic overlap
      hintTokens.forEach(tok => {
        if (recTags.some(t => t.includes(tok) || tok.includes(t))) score += 3;
        else if (recText.includes(tok)) score += 1;
      });

      // use_for relevance
      if (useForPurpose) {
        const purpose = useForPurpose.toLowerCase();
        if (recUseFor.some(u => u.toLowerCase().includes(purpose) || purpose.includes(u.toLowerCase()))) score += 3;
        if (recUseFor.includes("All of the above")) score += 2;
      }

      // NMMA / Board-Level extra weight when relevant
      const isNmmaOrStrategic = r.intel_type === "NMMA / Association News" || r.importance === "Board-Level / Strategic";
      if (isNmmaOrStrategic && hintTokens.length > 0) score += 2;

      // Penalise if there are hint tokens and NONE of them matched
      if (hintTokens.length >= 3 && score <= (impWeight[r.importance] ?? 1) + 1) {
        score -= 3; // No relevant signal for this email context
      }

      return { r, score };
    });

    // Sort by relevance score, take the best N
    const top = scored
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (top.length === 0) return "";

    // Format using the clean structured format requested
    const lines: string[] = [
      `CORTEX INDUSTRY INTEL (use only when directly relevant — do not force into every email):`,
      `IMPORTANT: Preserve all numbers and statistics exactly as stated. Reference sources naturally (e.g. "NMMA recently reported..."). Do not invent statistics or vague generalisations.`,
      ``,
    ];

    top.forEach(({ r }) => {
      const dateStr = r.received_at
        ? new Date(r.received_at).toLocaleDateString("en-CA", { year: "numeric", month: "short" })
        : "";
      const sourceLine = [r.sender_name || r.sender_email || "", r.subject ? `"${r.subject}"` : ""].filter(Boolean).join(", ");
      const facts: string[] = Array.isArray(r.extracted_facts)
        ? r.extracted_facts.slice(0, 3)
        : typeof r.extracted_facts === "object" && r.extracted_facts
        ? Object.values(r.extracted_facts as Record<string, unknown>).slice(0, 3).map(String)
        : [];

      lines.push(`---`);
      lines.push(`CORTEX INDUSTRY INTEL:`);
      if (sourceLine || dateStr) lines.push(`- Source: ${[sourceLine, dateStr].filter(Boolean).join(" · ")}`);
      if (dateStr)               lines.push(`- Date: ${dateStr}`);
      if (facts.length > 0)      lines.push(`- Fact: ${facts[0]}`);
      if (facts.length > 1)      facts.slice(1).forEach(f => lines.push(`- Fact: ${f}`));
      if (r.ai_summary)          lines.push(`- Summary: ${r.ai_summary}`);
      if (r.strategic_relevance) lines.push(`- Strategic relevance: ${r.strategic_relevance}`);
      // Suggested usage angle: derive from intel_type + importance
      const angle = r.importance === "Board-Level / Strategic"
        ? `Reference in investor or board-level communications when this topic arises`
        : r.intel_type === "NMMA / Association News"
        ? `Cite naturally when discussing industry trends or marina market positioning`
        : r.intel_type === "Marina Market Data" || r.intel_type === "Boating Consumer Trends"
        ? `Use to support market opportunity statements in sales emails`
        : r.intel_type === "Regulatory / Compliance"
        ? `Reference when discussing compliance, permits, or safety considerations`
        : `Reference when contextually relevant — keep it brief and specific`;
      lines.push(`- Suggested usage angle: ${angle}`);
      lines.push(``);
    });

    return lines.join("\n");
  } catch (e) {
    console.error("[cortex-intel] Failed to load intel for prompt:", e);
    return "";
  }
}
