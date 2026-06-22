/**
 * Phase B.5 — AI-powered meeting note extraction.
 *
 * Flow:
 *   1. Read raw_transcript_text from DB
 *   2. If empty/missing, write polite empty-state fields and mark completed
 *   3. Call OpenAI (gpt-4o → gpt-5-mini fallback) with JSON-mode prompt
 *   4. Parse structured output:
 *        executive_summary, detailed_notes, decisions, action_items,
 *        blockers, risks, followup_draft, voltsafe_signals
 *   5. Write all text fields to meeting_notes row
 *   6. Insert each action item into meeting_note_action_items (status='suggested')
 *   7. Set status='completed' on success, 'failed' on hard error
 *
 * This function NEVER throws — all errors end up in processing_error column.
 */

import OpenAI from "openai";
import { getTokenLimitParam } from "./openai-compat";
import { db } from "../db";
import {
  meetingNotes,
  meetingNoteActionItems,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  extractEmailsFromText,
  populateParticipantsFromEmails,
  getUserEmail,
} from "./participant-matcher";

// ── OpenAI client ─────────────────────────────────────────────────────────

function buildOpenAIClient(): OpenAI | null {
  const apiKey =
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  return new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
}

// ── Type shapes ───────────────────────────────────────────────────────────

interface AiActionItem {
  title: string;
  description?: string | null;
  owner_name?: string | null;
  due_date?: string | null;
  source_quote?: string | null;
  confidence_score?: number | null;
}

interface VoltSafeSignals {
  marina_names: string[];
  customer_names: string[];
  thirty_amp_mentions: string[];
  fifty_amp_mentions: string[];
  code_or_compliance_mentions: string[];
  pilot_readiness: string;
  procurement_blockers: string[];
  dock_upgrade_timing: string[];
  contractor_names: string[];
  funding_or_investor_signals: string[];
  next_step_commitments: string[];
}

interface AiOutput {
  executive_summary: string;
  detailed_notes: string;
  decisions: string[];
  action_items: AiActionItem[];
  blockers: string[];
  risks: string[];
  followup_draft: string;
  voltsafe_signals: VoltSafeSignals;
}

// ── Constants ─────────────────────────────────────────────────────────────

const TRANSCRIPT_CHAR_LIMIT = 80_000;
const MAX_ACTION_ITEMS      = 20;

// ── System prompt ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a meeting analyst for VoltSafe, a company that sells shore-power \
pedestals and electrical upgrade solutions to marinas. Your job is to extract structured information \
from raw meeting transcripts.

Respond ONLY with a single valid JSON object. No markdown, no commentary, no code fences.

Rules:
- Be concise and practical. Do not pad or repeat.
- Do NOT invent owners, dates, or commitments. Use null when unknown.
- Extract only real action items that were explicitly discussed.
- Confidence scores are 0.0–1.0.
- Due dates must be ISO 8601 (YYYY-MM-DD) or null.
- Keep arrays empty ([]) when there is nothing to report.
- followup_draft should be a professional email draft (or "" if nothing to follow up).

VoltSafe-specific detection:
- marina_names: any named marinas mentioned
- customer_names: contact or company names (prospects, customers)
- thirty_amp_mentions / fifty_amp_mentions: any discussion of 30A or 50A shore power
- code_or_compliance_mentions: NEC, CSA, electrical code, compliance, permit
- pilot_readiness: brief string — "ready", "concerns", "not discussed", etc.
- procurement_blockers: budget, PO, approval, pricing friction
- dock_upgrade_timing: when dock work or slip upgrades are expected
- contractor_names: electrician, contractor, or subcontractor names
- funding_or_investor_signals: investor, funding, revenue, financing mentions
- next_step_commitments: concrete next steps both parties agreed to

Output schema (all fields required):
{
  "executive_summary": "string",
  "detailed_notes": "string",
  "decisions": ["string"],
  "action_items": [
    {
      "title": "string",
      "description": "string or null",
      "owner_name": "string or null",
      "due_date": "YYYY-MM-DD or null",
      "source_quote": "string or null",
      "confidence_score": 0.0
    }
  ],
  "blockers": ["string"],
  "risks": ["string"],
  "followup_draft": "string",
  "voltsafe_signals": {
    "marina_names": [],
    "customer_names": [],
    "thirty_amp_mentions": [],
    "fifty_amp_mentions": [],
    "code_or_compliance_mentions": [],
    "pilot_readiness": "string",
    "procurement_blockers": [],
    "dock_upgrade_timing": [],
    "contractor_names": [],
    "funding_or_investor_signals": [],
    "next_step_commitments": []
  }
}`;

// ── Prompt builder ────────────────────────────────────────────────────────

function buildUserPrompt(transcript: string, truncated: boolean): string {
  const note = truncated
    ? "\n\n[NOTE: Transcript was truncated to fit context limits. " +
      "Extract what you can from the available text.]\n"
    : "";
  return `Here is the meeting transcript:\n\n${transcript}${note}`;
}

// ── AI call with model fallback ───────────────────────────────────────────

async function callAI(
  client: OpenAI,
  userPrompt: string,
): Promise<AiOutput | null> {
  const models = ["gpt-4o", "gpt-5-mini"];
  for (const model of models) {
    try {
      const resp = await client.chat.completions.create({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user",   content: userPrompt },
        ],
        temperature: 0.2,
        ...getTokenLimitParam(model, 4096),
      });
      const raw = resp.choices[0]?.message?.content ?? "";
      const parsed = JSON.parse(raw) as AiOutput;
      console.log(
        `[meeting-notes-ai] model=${model} ` +
          `summary_chars=${(parsed.executive_summary ?? "").length} ` +
          `action_items=${(parsed.action_items ?? []).length}`,
      );
      return parsed;
    } catch (err: unknown) {
      console.warn(
        `[meeting-notes-ai] ${model} failed: ${(err as Error).message}`,
      );
    }
  }
  return null;
}

// ── Text formatters ───────────────────────────────────────────────────────

function formatList(items: string[]): string {
  if (!items || items.length === 0) return "";
  return items.map((item) => `• ${item}`).join("\n");
}

function formatActionItemsText(items: AiActionItem[]): string {
  if (!items || items.length === 0) return "";
  return items
    .map((ai, i) => {
      const parts: string[] = [`${i + 1}. ${ai.title}`];
      if (ai.description) parts.push(`   ${ai.description}`);
      if (ai.owner_name)  parts.push(`   Owner: ${ai.owner_name}`);
      if (ai.due_date)    parts.push(`   Due: ${ai.due_date}`);
      return parts.join("\n");
    })
    .join("\n\n");
}

function formatVoltSafeSignals(vs: VoltSafeSignals): string {
  if (!vs) return "";
  const sections: string[] = [];

  const appendSection = (label: string, items: string[]) => {
    if (items && items.length > 0) {
      sections.push(`**${label}:** ${items.join(", ")}`);
    }
  };

  appendSection("Marina Names",           vs.marina_names);
  appendSection("Customer Names",         vs.customer_names);
  appendSection("30A Mentions",           vs.thirty_amp_mentions);
  appendSection("50A Mentions",           vs.fifty_amp_mentions);
  appendSection("Code/Compliance",        vs.code_or_compliance_mentions);
  if (vs.pilot_readiness && vs.pilot_readiness !== "not discussed") {
    sections.push(`**Pilot Readiness:** ${vs.pilot_readiness}`);
  }
  appendSection("Procurement Blockers",   vs.procurement_blockers);
  appendSection("Dock Upgrade Timing",    vs.dock_upgrade_timing);
  appendSection("Contractor Names",       vs.contractor_names);
  appendSection("Funding/Investor",       vs.funding_or_investor_signals);
  appendSection("Next Step Commitments",  vs.next_step_commitments);

  return sections.length > 0
    ? `\n\n---\n**VoltSafe Signals**\n\n${sections.join("\n")}`
    : "";
}

// ── Empty-transcript handler ──────────────────────────────────────────────

async function handleEmptyTranscript(noteId: number): Promise<void> {
  console.log(
    `[meeting-notes-ai] noteId=${noteId} transcript empty — writing empty state`,
  );
  try {
    await db
      .update(meetingNotes)
      .set({
        summaryText:       "No discussion captured.",
        notesText:         "",
        decisionsText:     "",
        actionItemsText:   "",
        followupDraftText: "",
        processingError:   null,
        status:            "completed",
        updatedAt:         new Date(),
      })
      .where(eq(meetingNotes.id, noteId));
  } catch (err: unknown) {
    await markError(
      noteId,
      `DB write failed (empty-transcript path): ${(err as Error).message}`,
      true,
    );
  }
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Run AI extraction on a meeting note that already has raw_transcript_text.
 * This function NEVER throws — all errors are stored in processing_error.
 * Idempotent: if summary_text is already populated, returns immediately.
 */
export async function processWithAI(noteId: number): Promise<void> {
  try {
    await _processWithAI(noteId);
  } catch (err: unknown) {
    // Safety net — should not reach here, but guarantees no throw
    await markError(
      noteId,
      `Unexpected error: ${(err as Error).message}`,
      false,
    );
  }
}

async function _processWithAI(noteId: number): Promise<void> {
  // 1. Fetch note — include status so we can guard against spurious calls
  let note: { rawTranscriptText: string | null; status: string } | undefined;
  try {
    const rows = await db
      .select({
        rawTranscriptText: meetingNotes.rawTranscriptText,
        status:            meetingNotes.status,
      })
      .from(meetingNotes)
      .where(eq(meetingNotes.id, noteId));
    note = rows[0];
  } catch (err: unknown) {
    await markError(
      noteId,
      `DB read failed: ${(err as Error).message}`,
      false,
    );
    return;
  }

  if (!note) {
    await markError(noteId, "Meeting note not found.", false);
    return;
  }

  // 2. Idempotency guard — only run when status has been explicitly set to
  //    "processing" (by processMeetingNote or stopRecording). Any other status
  //    means a spurious or duplicate call; skip safely.
  if (note.status !== "processing") {
    console.log(
      `[meeting-notes-ai] noteId=${noteId} status="${note.status}" ≠ processing — skipping (idempotent)`,
    );
    return;
  }

  const transcript = (note.rawTranscriptText ?? "").trim();

  // 3. Empty transcript — write empty state and mark completed
  if (transcript.length === 0) {
    await handleEmptyTranscript(noteId);
    return;
  }

  // 4. Build OpenAI client
  const client = buildOpenAIClient();
  if (!client) {
    await markError(
      noteId,
      "OpenAI API key not configured — AI processing unavailable. " +
        "Set AI_INTEGRATIONS_OPENAI_API_KEY or OPENAI_API_KEY to enable.",
      false,
    );
    return;
  }

  // 4. Truncate if needed
  let truncated = false;
  let safeTranscript = transcript;
  if (transcript.length > TRANSCRIPT_CHAR_LIMIT) {
    safeTranscript = transcript.slice(0, TRANSCRIPT_CHAR_LIMIT);
    truncated = true;
    console.warn(
      `[meeting-notes-ai] noteId=${noteId} transcript truncated from ` +
        `${transcript.length} to ${TRANSCRIPT_CHAR_LIMIT} chars`,
    );
  }

  // 5. Call AI
  const userPrompt = buildUserPrompt(safeTranscript, truncated);
  const aiOutput = await callAI(client, userPrompt);

  if (!aiOutput) {
    await markError(
      noteId,
      "All AI model attempts failed. Check server logs for details.",
      false,
    );
    return;
  }

  // 6. Clamp action items
  const actionItems = (aiOutput.action_items ?? []).slice(0, MAX_ACTION_ITEMS);

  // 7. Format text fields
  const summaryText     = (aiOutput.executive_summary ?? "").trim();
  const decisionsText   = formatList(aiOutput.decisions ?? []);
  const actionItemsText = formatActionItemsText(actionItems);
  const voltSafeSection = formatVoltSafeSignals(aiOutput.voltsafe_signals);
  const notesText       = ((aiOutput.detailed_notes ?? "").trim() + voltSafeSection).trim();
  const followupDraft   = (aiOutput.followup_draft ?? "").trim();

  if (truncated) {
    console.warn(
      `[meeting-notes-ai] noteId=${noteId} transcript was truncated — ` +
        `some content may be missing from the AI output`,
    );
  }

  // 8. Write to DB — processingError always NULL on success path
  try {
    await db
      .update(meetingNotes)
      .set({
        summaryText,
        notesText,
        decisionsText,
        actionItemsText,
        followupDraftText: followupDraft,
        processingError:   null,
        status:            "completed",
        updatedAt:         new Date(),
      })
      .where(eq(meetingNotes.id, noteId));
  } catch (err: unknown) {
    await markError(
      noteId,
      `DB write failed: ${(err as Error).message}`,
      true,
    );
    return;
  }

  // 9. Clear old action items and insert fresh ones
  try {
    await db
      .delete(meetingNoteActionItems)
      .where(eq(meetingNoteActionItems.meetingNoteId, noteId));

    if (actionItems.length > 0) {
      const rows = actionItems.map((ai) => ({
        meetingNoteId:   noteId,
        title:           (ai.title ?? "").trim() || "Untitled action item",
        description:     ai.description?.trim() ?? null,
        ownerName:       ai.owner_name?.trim() ?? null,
        ownerUserId:     null as number | null,
        dueDate:         ai.due_date ? new Date(ai.due_date) : null as Date | null,
        sourceQuote:     ai.source_quote?.trim() ?? null,
        confidenceScore: ai.confidence_score != null
          ? String(Math.min(1, Math.max(0, ai.confidence_score)))
          : null,
        status:          "suggested" as const,
        createdTaskId:   null as number | null,
      }));
      await db.insert(meetingNoteActionItems).values(rows);
    }

    console.log(
      `[meeting-notes-ai] noteId=${noteId} completed — ` +
        `summary_chars=${summaryText.length} ` +
        `decisions=${(aiOutput.decisions ?? []).length} ` +
        `action_items=${actionItems.length} ` +
        `blockers=${(aiOutput.blockers ?? []).length}`,
    );
  } catch (err: unknown) {
    await markError(
      noteId,
      `Action item insert failed: ${(err as Error).message}`,
      true,
    );
  }

  // 10. Extract emails from transcript → seed participants (fire-and-forget)
  if (transcript) {
    setImmediate(async () => {
      try {
        const emails = extractEmailsFromText(transcript);
        if (emails.length === 0) return;
        const noteRows = await db
          .select({ createdBy: meetingNotes.createdBy })
          .from(meetingNotes)
          .where(eq(meetingNotes.id, noteId))
          .limit(1);
        if (!noteRows[0]?.createdBy) return;
        const ownerEmail = await getUserEmail(noteRows[0].createdBy);
        await populateParticipantsFromEmails(noteId, emails, ownerEmail);
      } catch (err) {
        console.error(`[participant-matcher] transcript email extraction error for note ${noteId}:`, err);
      }
    });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function markError(
  noteId: number,
  error: string,
  keepCompleted: boolean,
): Promise<void> {
  console.error(`[meeting-notes-ai] noteId=${noteId} error: ${error}`);
  try {
    await db
      .update(meetingNotes)
      .set({
        processingError: error,
        status:          keepCompleted ? "completed" : "failed",
        updatedAt:       new Date(),
      })
      .where(eq(meetingNotes.id, noteId));
  } catch (dbErr: unknown) {
    console.error(
      `[meeting-notes-ai] noteId=${noteId} failed to write processingError: ` +
        `${(dbErr as Error).message}`,
    );
  }
}
