/**
 * Rolling CRM Intelligence Context
 *
 * Maintains a per-record compressed "durable summary" of all historical CRM
 * activity plus an incremental raw window of everything NEW since the last
 * context build.  AI email and summary generation uses this instead of
 * dumping the entire raw history on every call.
 *
 * Flow:
 *  1. getCrmIntelligenceContext()         — load existing context from DB
 *  2. buildOrUpdateCrmIntelligenceContext() — create / refresh the context
 *  3. buildSuggestedEmailContext()        — assemble compact prompt context
 *
 * Token budget (target ~2 000 input tokens):
 *   • Latest 5 activity items — full text   (~500 tok)
 *   • Next 10 items — snippet only          (~300 tok)
 *   • Durable historical summary            (~500 tok)
 *   • Key people + current CRM state        (~400 tok)
 *   • System prompt + instructions          (~600 tok)
 *                                      Total ≈ 2 300 tok
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

export type CrmEntityType = "lead" | "account" | "contact";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface KeyPerson {
  name: string;
  role?: string;
  title?: string;
  email?: string;
  isDecisionMaker?: boolean;
}

export interface RawActivityItem {
  type: "email" | "note" | "activity" | "comment" | "meeting_outcome";
  direction: "inbound" | "outbound" | "internal" | string;
  timestamp: string;
  author: string;
  recipients?: string;
  subject?: string;
  /** Full content for latest items; truncated snippet for older items */
  content: string;
  sourceId: string;
  /** For meeting_outcome type: the outcome label (e.g. "completed", "no_show") */
  meetingOutcome?: string;
  /** For meeting_outcome type: next-step text extracted from the saved notes */
  meetingNextSteps?: string;
}

export interface SourceCoverage {
  emailsThroughTimestamp: string | null;
  notesThroughTimestamp: string | null;
  activitiesThroughTimestamp: string | null;
  builtFromAiSummary: boolean;
  aiSummaryGeneratedAt: string | null;
}

export interface CrmIntelligenceContext {
  id: number;
  recordType: string;
  recordId: number;
  recordName: string;
  durableSummary: string;
  keyFacts: string[];
  keyPeople: KeyPerson[];
  openLoops: string[];
  objections: string[];
  buyingSignals: string[];
  risks: string[];
  opportunities: string[];
  commitments: string[];
  nextSteps: string[];
  recentActivityDigest: RawActivityItem[];
  lastContextBuildAt: string;
  sourceCoverage: SourceCoverage;
  updatedAt: string;
}

export interface OpenTask {
  title: string;
  status: string;
  dueDate: string | null;
  priority: string | null;
}

export interface MeetingOutcomeSummary {
  subject: string;
  outcome: string;
  notes: string;
  timestamp: string;
}

export interface LastOutboundEmail {
  timestamp: string;
  subject: string;
  recipients: string;
  snippet: string;
}

export interface SuggestedEmailContext {
  /** Latest 5 items in full — HIGH PRIORITY, drives the email */
  highPriorityRecentActivity: RawActivityItem[];
  /** Items 6–15 since last build — snippets only */
  recentActivityDigest: RawActivityItem[];
  durableContext: {
    summary: string;
    keyFacts: string[];
    openLoops: string[];
    objections: string[];
    risks: string[];
    opportunities: string[];
    commitments: string[];
    nextSteps: string[];
  };
  keyPeople: KeyPerson[];
  currentCrmState: Record<string, any>;
  recordName: string;
  cutoffUsed: string | null;
  estimatedPromptChars: number;
  hasIntelligenceContext: boolean;
  /** Most recent outbound email we sent — defines the "new since last touch" boundary */
  lastOutboundEmail: LastOutboundEmail | null;
  /** Open/pending tasks linked to this CRM record */
  openTasks: OpenTask[];
  /** Meeting outcomes recorded against this CRM record in the last 90 days */
  recentMeetingOutcomes: MeetingOutcomeSummary[];
}

// ─── DB helper ─────────────────────────────────────────────────────────────

async function safeRows(sqlStr: string): Promise<any[]> {
  try {
    const r = await db.execute(sql.raw(sqlStr));
    return (r as any).rows || [];
  } catch {
    return [];
  }
}

function esc(s: string): string {
  return String(s || "").replace(/'/g, "''");
}

// ─── Load ───────────────────────────────────────────────────────────────────

export async function getCrmIntelligenceContext(
  recordType: CrmEntityType,
  recordId: number
): Promise<CrmIntelligenceContext | null> {
  const rows = await safeRows(`
    SELECT * FROM crm_intelligence_context
    WHERE record_type = '${recordType}' AND record_id = ${recordId}
    LIMIT 1
  `);
  if (!rows[0]) return null;
  const r = rows[0];
  const parse = (v: any, fallback: any) => {
    if (v && typeof v === "object") return v;
    if (typeof v === "string") { try { return JSON.parse(v); } catch { return fallback; } }
    return fallback;
  };
  return {
    id: Number(r.id),
    recordType: String(r.record_type),
    recordId: Number(r.record_id),
    recordName: String(r.record_name || ""),
    durableSummary: String(r.durable_summary || ""),
    keyFacts: parse(r.key_facts, []),
    keyPeople: parse(r.key_people, []),
    openLoops: parse(r.open_loops, []),
    objections: parse(r.objections, []),
    buyingSignals: parse(r.buying_signals, []),
    risks: parse(r.risks, []),
    opportunities: parse(r.opportunities, []),
    commitments: parse(r.commitments, []),
    nextSteps: parse(r.next_steps, []),
    recentActivityDigest: parse(r.recent_activity_digest, []),
    lastContextBuildAt: String(r.last_context_build_at || ""),
    sourceCoverage: parse(r.source_coverage, {}),
    updatedAt: String(r.updated_at || ""),
  };
}

// ─── Incremental activity since a timestamp ─────────────────────────────────

export async function getNewCrmActivitySince(
  recordType: CrmEntityType,
  recordId: number,
  sinceTimestamp: string,
  limit = 30
): Promise<RawActivityItem[]> {
  const id = Number(recordId);
  const sinceIso = esc(sinceTimestamp);
  const items: RawActivityItem[] = [];

  // New emails (newest first)
  const emailRows = await safeRows(`
    SELECT em.id, em.subject, em.from_email, em.snippet, em.body_text,
           em.direction, em.sent_at, em.to_recipients
    FROM email_associations ea
    JOIN email_messages em ON ea.email_message_id = em.id
    WHERE ea.object_type = '${recordType}' AND ea.object_id = ${id}
      AND em.sent_at > '${sinceIso}'
    ORDER BY em.sent_at DESC NULLS LAST
    LIMIT ${limit}
  `);
  emailRows.forEach((r: any) => {
    const body = String(r.body_text || r.snippet || "").substring(0, 800);
    items.push({
      type: "email",
      direction: String(r.direction || "unknown"),
      timestamp: String(r.sent_at || ""),
      author: String(r.from_email || ""),
      recipients: r.to_recipients ? String(r.to_recipients).substring(0, 200) : undefined,
      subject: String(r.subject || ""),
      content: body,
      sourceId: `email:${r.id}`,
    });
  });

  // New notes/comments (newest first)
  const noteRows = await safeRows(`
    SELECT id, content, created_at FROM notes
    WHERE linked_object_type = '${recordType}' AND linked_object_id = ${id}
      AND created_at > '${sinceIso}'
    ORDER BY created_at DESC
    LIMIT ${Math.floor(limit / 2)}
  `);
  noteRows.forEach((r: any) => {
    items.push({
      type: "note",
      direction: "internal",
      timestamp: String(r.created_at || ""),
      author: "CRM",
      content: String(r.content || "").substring(0, 600),
      sourceId: `note:${r.id}`,
    });
  });

  // New activities (newest first) — includes calendar_meeting_outcome entries
  const actRows = await safeRows(`
    SELECT id, type, summary, outcome, subject, raw_content, created_at FROM activities
    WHERE linked_object_type = '${recordType}' AND linked_object_id = ${id}
      AND created_at > '${sinceIso}'
    ORDER BY created_at DESC
    LIMIT ${Math.floor(limit / 2)}
  `);
  actRows.forEach((r: any) => {
    const isMeetingOutcome = String(r.type || "") === "calendar_meeting_outcome";
    let content: string;
    let meetingOutcome: string | undefined;
    let meetingNextSteps: string | undefined;

    if (isMeetingOutcome) {
      meetingOutcome = r.outcome ? String(r.outcome) : undefined;
      // Parse next-step text from raw_content if present
      if (r.raw_content) {
        try {
          const metaIdx = String(r.raw_content).lastIndexOf("__meta:");
          const jsonStr = metaIdx !== -1
            ? String(r.raw_content).slice(0, metaIdx).trim()
            : String(r.raw_content);
          const parsed = JSON.parse(jsonStr);
          if (parsed.nextStep || parsed.next_step || parsed.nextSteps || parsed.next_steps) {
            meetingNextSteps = String(parsed.nextStep || parsed.next_step || parsed.nextSteps || parsed.next_steps).substring(0, 300);
          }
        } catch { /* non-fatal */ }
      }
      const parts = [
        meetingOutcome ? `Outcome: ${meetingOutcome}` : "",
        String(r.summary || "").substring(0, 300),
        meetingNextSteps ? `Next step: ${meetingNextSteps}` : "",
      ].filter(Boolean);
      content = parts.join(" | ");
    } else {
      content = String(r.summary || "").substring(0, 400);
    }

    items.push({
      type: isMeetingOutcome ? "meeting_outcome" : "activity",
      direction: "internal",
      timestamp: String(r.created_at || ""),
      author: "CRM",
      subject: String(r.subject || r.type || ""),
      content,
      sourceId: `activity:${r.id}`,
      meetingOutcome,
      meetingNextSteps,
    });
  });

  // Sort all items newest-first
  items.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
  return items.slice(0, limit);
}

// ─── New context helpers (last outbound, open tasks, meeting outcomes) ────────

/** Most recent outbound email sent to this CRM entity's contacts. */
async function getLastOutboundEmail(
  recordType: CrmEntityType,
  recordId: number
): Promise<LastOutboundEmail | null> {
  const id = Number(recordId);
  const rows = await safeRows(`
    SELECT em.subject, em.sent_at, em.to_recipients, em.snippet, em.body_text
    FROM email_associations ea
    JOIN email_messages em ON ea.email_message_id = em.id
    WHERE ea.object_type = '${recordType}' AND ea.object_id = ${id}
      AND em.direction = 'outbound'
    ORDER BY em.sent_at DESC NULLS LAST
    LIMIT 1
  `);
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    timestamp: String(r.sent_at || ""),
    subject: String(r.subject || ""),
    recipients: String(r.to_recipients || "").substring(0, 200),
    snippet: String(r.body_text || r.snippet || "").substring(0, 400),
  };
}

/** Open/pending tasks linked to this CRM record (newest due-date first). */
async function getOpenTasksForRecord(
  recordType: CrmEntityType,
  recordId: number
): Promise<OpenTask[]> {
  const id = Number(recordId);
  // Match by linked_object_type+id OR (for accounts) by account_id
  const accountClause = recordType === "account"
    ? `OR (account_id = ${id} AND linked_object_type IS NULL)`
    : "";
  const rows = await safeRows(`
    SELECT title, status, due_date, priority
    FROM tasks
    WHERE (
      (linked_object_type = '${recordType}' AND linked_object_id = ${id})
      ${accountClause}
    )
    AND status NOT IN ('completed', 'cancelled', 'dismissed')
    AND (archived = false OR archived IS NULL)
    ORDER BY COALESCE(due_date, '9999-12-31'::timestamp) ASC
    LIMIT 10
  `);
  return rows.map((r: any) => ({
    title: String(r.title || ""),
    status: String(r.status || "pending"),
    dueDate: r.due_date ? String(r.due_date) : null,
    priority: r.priority ? String(r.priority) : null,
  }));
}

/** Meeting outcomes (calendar_meeting_outcome activities) for this record — last 90 days. */
async function getRecentMeetingOutcomes(
  recordType: CrmEntityType,
  recordId: number
): Promise<MeetingOutcomeSummary[]> {
  const id = Number(recordId);
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await safeRows(`
    SELECT subject, outcome, summary, created_at
    FROM activities
    WHERE linked_object_type = '${recordType}' AND linked_object_id = ${id}
      AND type = 'calendar_meeting_outcome'
      AND created_at >= '${esc(cutoff)}'
    ORDER BY created_at DESC
    LIMIT 5
  `);
  return rows.map((r: any) => ({
    subject: String(r.subject || ""),
    outcome: String(r.outcome || ""),
    notes: String(r.summary || "").substring(0, 500),
    timestamp: String(r.created_at || ""),
  }));
}

// ─── Build / update context ─────────────────────────────────────────────────

/**
 * Build or refresh the intelligence context for a CRM record.
 *
 * Strategy:
 *  • First time: bootstrap durable_summary from existing crm_ai_summaries
 *    (already a high-quality compressed view).  Set last_context_build_at to
 *    the AI summary's generated_at so we don't re-process old history.
 *  • Subsequent times: pull only new activity since last_context_build_at and
 *    append it to recent_activity_digest.  Advance last_context_build_at.
 *  • Never overwrite a good context with empty data.
 */
export async function buildOrUpdateCrmIntelligenceContext(
  recordType: CrmEntityType,
  recordId: number
): Promise<CrmIntelligenceContext | null> {
  const id = Number(recordId);

  try {
    const existing = await getCrmIntelligenceContext(recordType, id);
    const now = new Date().toISOString();

    if (!existing) {
      // ── Bootstrap: use existing AI summary as durable context ──
      const aiRows = await safeRows(`
        SELECT summary_json, summary_text, generated_at
        FROM crm_ai_summaries
        WHERE entity_type = '${recordType}' AND entity_id = ${id}
          AND status = 'success'
        LIMIT 1
      `);

      let durableSummary = "";
      let keyFacts: string[] = [];
      let keyPeople: KeyPerson[] = [];
      let openLoops: string[] = [];
      let objections: string[] = [];
      let buyingSignals: string[] = [];
      let risks: string[] = [];
      let opportunities: string[] = [];
      let commitments: string[] = [];
      let nextSteps: string[] = [];
      let lastBuildAt = now;
      let builtFromAiSummary = false;
      let aiSummaryGeneratedAt: string | null = null;

      if (aiRows[0]) {
        builtFromAiSummary = true;
        aiSummaryGeneratedAt = String(aiRows[0].generated_at || "");
        lastBuildAt = aiSummaryGeneratedAt || now;
        const sj = (() => {
          const v = aiRows[0].summary_json;
          if (v && typeof v === "object") return v;
          if (typeof v === "string") { try { return JSON.parse(v); } catch { return {}; } }
          return {};
        })();

        durableSummary = [
          sj.executiveSummary || "",
          sj.currentStatus ? `Status: ${sj.currentStatus}` : "",
        ].filter(Boolean).join("\n").substring(0, 2000);

        // Extract structured arrays from the AI summary
        if (Array.isArray(sj.keyPeople)) {
          keyPeople = sj.keyPeople.slice(0, 10).map((p: any) => ({
            name: String(p.name || ""),
            role: p.role ? String(p.role) : undefined,
            title: p.title ? String(p.title) : undefined,
            email: p.email ? String(p.email) : undefined,
            isDecisionMaker: !!p.isDecisionMaker,
          }));
        }
        if (Array.isArray(sj.opportunitiesAndRisks)) {
          const items: string[] = sj.opportunitiesAndRisks.map((i: any) => String(i.description || i));
          opportunities = items.filter((_: string, idx: number) => idx % 2 === 0).slice(0, 5);
          risks = items.filter((_: string, idx: number) => idx % 2 !== 0).slice(0, 5);
        }
        if (Array.isArray(sj.suggestedNextSteps)) {
          nextSteps = sj.suggestedNextSteps.slice(0, 5).map((s: any) => String(s));
        }
        if (Array.isArray(sj.relevantHistory)) {
          keyFacts = sj.relevantHistory.slice(0, 8).map((h: any) => String(h));
        }
      }

      // Get record name
      const nameRow = await safeRows(
        recordType === "lead"
          ? `SELECT company_name as name FROM leads WHERE id = ${id}`
          : recordType === "account"
          ? `SELECT name FROM accounts WHERE id = ${id}`
          : `SELECT name FROM contacts WHERE id = ${id}`
      );
      const recordName = String(nameRow[0]?.name || `${recordType}:${id}`);

      const sourceCoverage: SourceCoverage = {
        emailsThroughTimestamp: lastBuildAt,
        notesThroughTimestamp: lastBuildAt,
        activitiesThroughTimestamp: lastBuildAt,
        builtFromAiSummary,
        aiSummaryGeneratedAt,
      };

      // Get the latest few raw items (for the recent_activity_digest)
      const recentActivity = await getNewCrmActivitySince(recordType, id, "2000-01-01T00:00:00Z", 5);

      await upsertCrmIntelligenceContext({
        recordType,
        recordId: id,
        recordName,
        durableSummary,
        keyFacts,
        keyPeople,
        openLoops,
        objections,
        buyingSignals,
        risks,
        opportunities,
        commitments,
        nextSteps,
        recentActivityDigest: recentActivity,
        lastContextBuildAt: lastBuildAt,
        sourceCoverage,
      });

      console.log(`[crm-intelligence] bootstrapped ${recordType}:${id} — durable=${durableSummary.length} chars, lastBuildAt=${lastBuildAt}`);
      return getCrmIntelligenceContext(recordType, id);
    }

    // ── Incremental update: only process new activity ──
    const newActivity = await getNewCrmActivitySince(recordType, id, existing.lastContextBuildAt);

    if (newActivity.length === 0) {
      // Nothing new — just advance the build timestamp
      await db.execute(sql.raw(`
        UPDATE crm_intelligence_context
        SET updated_at = NOW()
        WHERE record_type = '${recordType}' AND record_id = ${id}
      `));
      return existing;
    }

    // Merge new activity into the recent digest (keep latest 15 total)
    const merged = [...newActivity, ...existing.recentActivityDigest]
      .slice(0, 15);

    // Update open loops from recent notes/activities
    const newLoops = newActivity
      .filter(a => a.type === "note" || a.type === "activity")
      .slice(0, 3)
      .map(a => a.content.substring(0, 150));
    const mergedOpenLoops = [...newLoops, ...existing.openLoops].slice(0, 8);

    const sourceRow = await safeRows(
      recordType === "lead"
        ? `SELECT company_name as name FROM leads WHERE id = ${id}`
        : recordType === "account"
        ? `SELECT name FROM accounts WHERE id = ${id}`
        : `SELECT name FROM contacts WHERE id = ${id}`
    );
    const recordName = String(sourceRow[0]?.name || existing.recordName);

    const updatedCoverage: SourceCoverage = {
      ...existing.sourceCoverage,
      emailsThroughTimestamp: now,
      notesThroughTimestamp: now,
      activitiesThroughTimestamp: now,
    };

    await upsertCrmIntelligenceContext({
      recordType,
      recordId: id,
      recordName,
      durableSummary: existing.durableSummary,
      keyFacts: existing.keyFacts,
      keyPeople: existing.keyPeople,
      openLoops: mergedOpenLoops,
      objections: existing.objections,
      buyingSignals: existing.buyingSignals,
      risks: existing.risks,
      opportunities: existing.opportunities,
      commitments: existing.commitments,
      nextSteps: existing.nextSteps,
      recentActivityDigest: merged,
      lastContextBuildAt: now,
      sourceCoverage: updatedCoverage,
    });

    console.log(`[crm-intelligence] updated ${recordType}:${id} — ${newActivity.length} new items since ${existing.lastContextBuildAt}`);
    return getCrmIntelligenceContext(recordType, id);
  } catch (err: any) {
    console.error(`[crm-intelligence] buildOrUpdate ${recordType}:${recordId} error:`, err?.message);
    return null;
  }
}

async function upsertCrmIntelligenceContext(data: {
  recordType: string;
  recordId: number;
  recordName: string;
  durableSummary: string;
  keyFacts: string[];
  keyPeople: KeyPerson[];
  openLoops: string[];
  objections: string[];
  buyingSignals: string[];
  risks: string[];
  opportunities: string[];
  commitments: string[];
  nextSteps: string[];
  recentActivityDigest: RawActivityItem[];
  lastContextBuildAt: string;
  sourceCoverage: SourceCoverage;
}): Promise<void> {
  const safeJ = (v: any) => esc(JSON.stringify(v || []));
  const safeS = (v: string) => esc(v || "");

  await db.execute(sql.raw(`
    INSERT INTO crm_intelligence_context (
      record_type, record_id, record_name,
      durable_summary, key_facts, key_people, open_loops, objections,
      buying_signals, risks, opportunities, commitments, next_steps,
      recent_activity_digest, last_context_build_at, source_coverage,
      created_at, updated_at
    ) VALUES (
      '${data.recordType}', ${data.recordId}, '${safeS(data.recordName)}',
      '${safeS(data.durableSummary)}',
      '${safeJ(data.keyFacts)}'::jsonb,
      '${safeJ(data.keyPeople)}'::jsonb,
      '${safeJ(data.openLoops)}'::jsonb,
      '${safeJ(data.objections)}'::jsonb,
      '${safeJ(data.buyingSignals)}'::jsonb,
      '${safeJ(data.risks)}'::jsonb,
      '${safeJ(data.opportunities)}'::jsonb,
      '${safeJ(data.commitments)}'::jsonb,
      '${safeJ(data.nextSteps)}'::jsonb,
      '${safeJ(data.recentActivityDigest)}'::jsonb,
      '${safeS(data.lastContextBuildAt)}',
      '${safeJ(data.sourceCoverage)}'::jsonb,
      NOW(), NOW()
    )
    ON CONFLICT (record_type, record_id) DO UPDATE SET
      record_name          = EXCLUDED.record_name,
      durable_summary      = EXCLUDED.durable_summary,
      key_facts            = EXCLUDED.key_facts,
      key_people           = EXCLUDED.key_people,
      open_loops           = EXCLUDED.open_loops,
      objections           = EXCLUDED.objections,
      buying_signals       = EXCLUDED.buying_signals,
      risks                = EXCLUDED.risks,
      opportunities        = EXCLUDED.opportunities,
      commitments          = EXCLUDED.commitments,
      next_steps           = EXCLUDED.next_steps,
      recent_activity_digest = EXCLUDED.recent_activity_digest,
      last_context_build_at  = EXCLUDED.last_context_build_at,
      source_coverage      = EXCLUDED.source_coverage,
      updated_at           = NOW()
  `));
}

// ─── Assemble compact context for Suggested Email prompt ───────────────────

/**
 * Returns a compact, structured context object ready for the Suggested Email
 * prompt.  Uses the intelligence context (durable summary + incremental new
 * activity) instead of dumping every raw CRM record.
 */
export async function buildSuggestedEmailContext(
  recordType: CrmEntityType,
  recordId: number
): Promise<SuggestedEmailContext> {
  const id = Number(recordId);

  // Ensure the context is up to date (lazy build / incremental refresh)
  const ctx = await buildOrUpdateCrmIntelligenceContext(recordType, id);

  // Load current CRM state, contacts, and supplemental context in parallel
  const [entityFields, contacts, lastOutboundEmail, openTasks, recentMeetingOutcomes] = await Promise.all([
    getEntityFields(recordType, id),
    getContactsForRecord(recordType, id),
    getLastOutboundEmail(recordType, id),
    getOpenTasksForRecord(recordType, id),
    getRecentMeetingOutcomes(recordType, id),
  ]);

  // Key people: merge intelligence context + fresh contacts
  const keyPeople: KeyPerson[] = ctx?.keyPeople?.length
    ? ctx.keyPeople
    : contacts.map(c => ({
        name: c.name,
        role: c.role || undefined,
        title: c.title || undefined,
        email: c.email || undefined,
      }));

  if (ctx) {
    // Use intelligence context: latest items in full + durable summary for rest
    const latestItems = ctx.recentActivityDigest.slice(0, 5);
    const digestItems = ctx.recentActivityDigest.slice(5, 15);

    // Also check for any very-new items since the last build (within last 15 min)
    const veryRecent = await getNewCrmActivitySince(recordType, id, ctx.lastContextBuildAt, 5);

    const combined = [...veryRecent, ...latestItems].slice(0, 5);
    const combinedDigest = [...latestItems.slice(combined.length - veryRecent.length), ...digestItems].slice(0, 10);

    const durableContext = {
      summary: ctx.durableSummary,
      keyFacts: ctx.keyFacts,
      openLoops: ctx.openLoops,
      objections: ctx.objections,
      risks: ctx.risks,
      opportunities: ctx.opportunities,
      commitments: ctx.commitments,
      nextSteps: ctx.nextSteps,
    };

    const promptText = JSON.stringify({ combined, durableContext, keyPeople, entityFields, lastOutboundEmail, openTasks, recentMeetingOutcomes });
    return {
      highPriorityRecentActivity: combined,
      recentActivityDigest: combinedDigest,
      durableContext,
      keyPeople,
      currentCrmState: entityFields,
      recordName: ctx.recordName,
      cutoffUsed: ctx.lastContextBuildAt,
      estimatedPromptChars: promptText.length,
      hasIntelligenceContext: true,
      lastOutboundEmail,
      openTasks,
      recentMeetingOutcomes,
    };
  }

  // Fallback: no intelligence context — pass a reduced raw window
  const fallbackActivity = await getNewCrmActivitySince(recordType, id, "2000-01-01T00:00:00Z", 15);
  const nameRow = await safeRows(
    recordType === "lead"
      ? `SELECT company_name as name FROM leads WHERE id = ${id}`
      : recordType === "account"
      ? `SELECT name FROM accounts WHERE id = ${id}`
      : `SELECT name FROM contacts WHERE id = ${id}`
  );
  return {
    highPriorityRecentActivity: fallbackActivity.slice(0, 5),
    recentActivityDigest: fallbackActivity.slice(5),
    durableContext: { summary: "", keyFacts: [], openLoops: [], objections: [], risks: [], opportunities: [], commitments: [], nextSteps: [] },
    keyPeople,
    currentCrmState: entityFields,
    recordName: String(nameRow[0]?.name || `${recordType}:${id}`),
    cutoffUsed: null,
    estimatedPromptChars: JSON.stringify(fallbackActivity).length + JSON.stringify(entityFields).length,
    hasIntelligenceContext: false,
    lastOutboundEmail,
    openTasks,
    recentMeetingOutcomes,
  };
}

// ─── Entity field loader (mirrors collectCrmEntityContext but lightweight) ──

async function getEntityFields(recordType: CrmEntityType, id: number): Promise<Record<string, any>> {
  try {
    if (recordType === "lead") {
      const rows = await safeRows(`SELECT l.*, u.name as owner_name FROM leads l LEFT JOIN users u ON u.id = l.owner_user_id WHERE l.id = ${id}`);
      const f = { ...(rows[0] || {}) };
      for (const k of ["id", "owner_user_id", "marina_id", "lead_lat", "lead_lng", "converted_account_id", "converted_contact_id"]) delete f[k];
      return f;
    } else if (recordType === "account") {
      const rows = await safeRows(`SELECT a.*, u.name as assigned_to_name FROM accounts a LEFT JOIN users u ON u.id = a.assigned_to_user_id WHERE a.id = ${id}`);
      const f = { ...(rows[0] || {}) };
      for (const k of ["id", "assigned_to_user_id", "latitude", "longitude", "partner_metadata"]) delete f[k];
      return f;
    } else {
      const rows = await safeRows(`SELECT c.*, a.name as account_name FROM contacts c LEFT JOIN accounts a ON a.id = c.account_id WHERE c.id = ${id}`);
      const f = { ...(rows[0] || {}) };
      for (const k of ["id", "account_id", "avatar_url"]) delete f[k];
      return f;
    }
  } catch {
    return {};
  }
}

async function getContactsForRecord(recordType: CrmEntityType, id: number): Promise<Array<{ name: string; title: string | null; email: string | null; role: string | null }>> {
  if (recordType === "lead") {
    const rows = await safeRows(`SELECT c.name, c.title, c.email, lc.role FROM contacts c JOIN lead_contacts lc ON lc.contact_id = c.id WHERE lc.lead_id = ${id} LIMIT 10`);
    return rows.map((r: any) => ({ name: String(r.name || ""), title: r.title ? String(r.title) : null, email: r.email ? String(r.email) : null, role: r.role ? String(r.role) : null }));
  } else if (recordType === "account") {
    const rows = await safeRows(`SELECT name, title, email, NULL as role FROM contacts WHERE account_id = ${id} LIMIT 10`);
    return rows.map((r: any) => ({ name: String(r.name || ""), title: r.title ? String(r.title) : null, email: r.email ? String(r.email) : null, role: null }));
  }
  return [];
}

// ─── Debug / health info ────────────────────────────────────────────────────

export async function debugCrmIntelligenceContext(
  recordType: CrmEntityType,
  recordId: number
): Promise<object> {
  const id = Number(recordId);
  const ctx = await getCrmIntelligenceContext(recordType, id);

  const newActivityCount = ctx
    ? (await getNewCrmActivitySince(recordType, id, ctx.lastContextBuildAt, 50)).length
    : null;

  const emailContextChars = ctx
    ? JSON.stringify({
        latest: ctx.recentActivityDigest.slice(0, 5),
        durable: ctx.durableSummary,
        keyPeople: ctx.keyPeople,
      }).length
    : null;

  return {
    hasContext: !!ctx,
    recordType,
    recordId: id,
    lastContextBuildAt: ctx?.lastContextBuildAt || null,
    durableSummaryLength: ctx?.durableSummary?.length || 0,
    keyPeopleCount: ctx?.keyPeople?.length || 0,
    openLoopsCount: ctx?.openLoops?.length || 0,
    keyFactsCount: ctx?.keyFacts?.length || 0,
    nextStepsCount: ctx?.nextSteps?.length || 0,
    recentActivityDigestCount: ctx?.recentActivityDigest?.length || 0,
    newActivityCountSinceLastBuild: newActivityCount,
    estimatedPromptCharsForSuggestedEmail: emailContextChars,
    sourceCoverage: ctx?.sourceCoverage || null,
    updatedAt: ctx?.updatedAt || null,
  };
}
