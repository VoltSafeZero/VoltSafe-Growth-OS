/**
 * ceo-one-on-ones.ts
 * CEO Cockpit Phase 5 — 1:1 Notes, Commitment Extraction, and Currents Update Drafts
 *
 * Data model: reuses meeting_notes with source='one_on_one',
 *   linked_object_type='user', linked_object_id=teamMemberId.
 * Commitment lifecycle: meeting_note_action_items (suggested→accepted→task_created).
 * Soft delete: status='deleted' on meeting_notes row.
 * No auto-send, no external APIs beyond optional OpenAI extraction, no keystroke tracking.
 * All string inputs parameterized via Drizzle sql`` tagged template.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import crypto from "crypto";
import OpenAI from "openai";
import { buildOpenAIModelParams } from "./openai-compat";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OneOnOneNote {
  id: number;
  uuid: string;
  title: string | null;
  meetingDate: string | null;
  notesText: string | null;
  decisionsText: string | null;
  actionItemsText: string | null;
  sections: OneOnOneSections;
  actionItemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface OneOnOneSections {
  wins: string | null;
  blockers: string | null;
  priorities: string | null;
  supportNeeded: string | null;
}

export interface AgendaItem {
  text: string;
  source: string;
  priority?: string | null;
  dueDate?: string | null;
  staleDays?: number;
  id?: string | number;
}

export interface OneOnOneAgenda {
  teamMemberId: number;
  teamMemberName: string;
  openCommitments: AgendaItem[];
  overdueTasks: AgendaItem[];
  blockers: AgendaItem[];
  staleWork: AgendaItem[];
  recentWins: AgendaItem[];
  priorActionItems: AgendaItem[];
  suggestedQuestions: string[];
  generated_at: string;
}

export interface CommitmentCandidate {
  title: string;
  ownerUserId: number | null;
  ownerName: string | null;
  dueDate: string | null;
  sourceQuote: string;
  confidence: number;
  suggestedPriority: string;
  needsReview: true;
}

export interface UpdateDraftResult {
  draftText: string;
  dmConversationId: number | null;
  currentsLink: string | null;
}

export interface CreateOneOnOneNoteInput {
  title?: string;
  meetingDate?: string | null;
  notesText?: string | null;
  decisionsText?: string | null;
  actionItemsText?: string | null;
  wins?: string | null;
  blockers?: string | null;
  priorities?: string | null;
  supportNeeded?: string | null;
}

export interface CommitmentTaskInput {
  title: string;
  ownerUserId: number;
  dueDate?: string | null;
  priority?: string;
  sourceQuote?: string;
}

// ── Safety helpers ─────────────────────────────────────────────────────────────

function safeId(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error("Invalid ID");
  return n;
}

function safeBound(s: string | null | undefined, max: number): string | null {
  if (!s || !s.trim()) return null;
  return s.slice(0, max);
}

function parseSections(raw: unknown): OneOnOneSections {
  if (!raw || typeof raw !== "object") return { wins: null, blockers: null, priorities: null, supportNeeded: null };
  const obj = raw as Record<string, string>;
  return {
    wins: obj.wins || null,
    blockers: obj.blockers || null,
    priorities: obj.priorities || null,
    supportNeeded: obj.support_needed || null,
  };
}

// ── 1. List 1:1 notes ─────────────────────────────────────────────────────────

export async function getOneOnOneNotes(ceoId: number, teamMemberId: number): Promise<OneOnOneNote[]> {
  ceoId = safeId(ceoId);
  teamMemberId = safeId(teamMemberId);

  const rows = (await db.execute(sql`
    SELECT mn.id, mn.uuid, mn.title,
           mn.started_at  AS meeting_date,
           mn.notes_text, mn.decisions_text, mn.action_items_text,
           mn.one_on_one_sections,
           mn.created_at, mn.updated_at,
           COALESCE((
             SELECT COUNT(*)::int FROM meeting_note_action_items ai
             WHERE ai.meeting_note_id = mn.id AND ai.status NOT IN ('rejected')
           ), 0) AS action_item_count
    FROM meeting_notes mn
    WHERE mn.created_by = ${ceoId}
      AND mn.linked_object_type = 'user'
      AND mn.linked_object_id = ${teamMemberId}
      AND mn.source = 'one_on_one'
      AND mn.status != 'deleted'
    ORDER BY mn.started_at DESC NULLS LAST, mn.created_at DESC
    LIMIT 20
  `)).rows as any[];

  return rows.map(r => ({
    id: Number(r.id),
    uuid: r.uuid,
    title: r.title,
    meetingDate: r.meeting_date,
    notesText: r.notes_text,
    decisionsText: r.decisions_text,
    actionItemsText: r.action_items_text,
    sections: parseSections(r.one_on_one_sections),
    actionItemCount: Number(r.action_item_count) || 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

// ── 2. Create 1:1 note ─────────────────────────────────────────────────────────

export async function createOneOnOneNote(
  ceoId: number,
  teamMemberId: number,
  data: CreateOneOnOneNoteInput
): Promise<{ id: number; uuid: string }> {
  ceoId = safeId(ceoId);
  teamMemberId = safeId(teamMemberId);

  const uuid = crypto.randomUUID();
  const title = safeBound(data.title, 255) ?? "1:1 Note";
  const notesText = safeBound(data.notesText, 50000);
  const decisionsText = safeBound(data.decisionsText, 20000);
  const actionItemsText = safeBound(data.actionItemsText, 20000);
  const sectionsJson = JSON.stringify({
    wins: safeBound(data.wins, 10000),
    blockers: safeBound(data.blockers, 10000),
    priorities: safeBound(data.priorities, 10000),
    support_needed: safeBound(data.supportNeeded, 10000),
  });
  const meetingDate = data.meetingDate ? new Date(data.meetingDate).toISOString() : new Date().toISOString();

  const [row] = (await db.execute(sql`
    INSERT INTO meeting_notes (
      uuid, source, created_by, linked_object_type, linked_object_id,
      title, status, started_at,
      notes_text, decisions_text, action_items_text,
      one_on_one_sections, consent_noted, created_at, updated_at
    )
    VALUES (
      ${uuid}, 'one_on_one', ${ceoId}, 'user', ${teamMemberId},
      ${title}, 'completed', ${meetingDate}::timestamptz,
      ${notesText}, ${decisionsText}, ${actionItemsText},
      ${sectionsJson}::jsonb, true, NOW(), NOW()
    )
    RETURNING id, uuid
  `)).rows as any[];

  const noteId = Number(row.id);

  await db.execute(sql`
    INSERT INTO meeting_note_participants (meeting_note_id, user_id, is_internal, created_at)
    VALUES (${noteId}, ${teamMemberId}, true, NOW())
    ON CONFLICT DO NOTHING
  `);

  return { id: noteId, uuid: row.uuid };
}

// ── 3. Update 1:1 note ─────────────────────────────────────────────────────────

export async function updateOneOnOneNote(
  noteId: number,
  ceoId: number,
  data: Partial<CreateOneOnOneNoteInput>
): Promise<void> {
  noteId = safeId(noteId);
  ceoId = safeId(ceoId);

  const [existing] = (await db.execute(sql`
    SELECT id FROM meeting_notes
    WHERE id = ${noteId} AND created_by = ${ceoId} AND source = 'one_on_one' AND status != 'deleted'
    LIMIT 1
  `)).rows as any[];
  if (!existing) throw new Error("Note not found or access denied");

  const sectionsJson = JSON.stringify({
    wins: safeBound(data.wins, 10000),
    blockers: safeBound(data.blockers, 10000),
    priorities: safeBound(data.priorities, 10000),
    support_needed: safeBound(data.supportNeeded, 10000),
  });

  await db.execute(sql`
    UPDATE meeting_notes SET
      title           = COALESCE(${safeBound(data.title, 255)}, title),
      notes_text      = ${safeBound(data.notesText, 50000)},
      decisions_text  = ${safeBound(data.decisionsText, 20000)},
      action_items_text = ${safeBound(data.actionItemsText, 20000)},
      one_on_one_sections = ${sectionsJson}::jsonb,
      updated_at      = NOW()
    WHERE id = ${noteId} AND created_by = ${ceoId} AND status != 'deleted'
  `);
}

// ── 4. Soft-delete 1:1 note ────────────────────────────────────────────────────

export async function deleteOneOnOneNote(noteId: number, ceoId: number): Promise<void> {
  noteId = safeId(noteId);
  ceoId = safeId(ceoId);

  const result = await db.execute(sql`
    UPDATE meeting_notes SET status = 'deleted', updated_at = NOW()
    WHERE id = ${noteId} AND created_by = ${ceoId} AND source = 'one_on_one' AND status != 'deleted'
  `);
  if ((result.rowCount ?? 0) === 0) throw new Error("Note not found or access denied");
}

// ── 5. Build agenda (deterministic) ───────────────────────────────────────────

const SUGGESTED_QUESTIONS = [
  "What is the biggest blocker I can help remove?",
  "What changed since our last 1:1?",
  "Which commitment is at risk?",
  "What decision do you need from me?",
  "What should we stop doing?",
  "What's going well that we should double down on?",
  "Is there anything slowing you down that I might not know about?",
];

export async function buildOneOnOneAgenda(ceoId: number, teamMemberId: number): Promise<OneOnOneAgenda> {
  ceoId = safeId(ceoId);
  teamMemberId = safeId(teamMemberId);

  const [member] = (await db.execute(sql`
    SELECT id, name FROM users WHERE id = ${teamMemberId} AND status = 'active' LIMIT 1
  `)).rows as any[];
  const memberName = member?.name ?? "Team Member";

  const openCommitmentsRows = (await db.execute(sql`
    SELECT t.id, t.title, t.due_date, t.status, t.priority
    FROM tasks t
    WHERE t.owner_user_id = ${teamMemberId}
      AND t.source = 'one_on_one_note'
      AND t.status NOT IN ('completed', 'cancelled')
      AND t.archived = false
    ORDER BY t.due_date ASC NULLS LAST
    LIMIT 5
  `)).rows as any[];

  const overdueRows = (await db.execute(sql`
    SELECT t.id, t.title, t.due_date, t.priority
    FROM tasks t
    WHERE t.owner_user_id = ${teamMemberId}
      AND t.due_date < NOW()
      AND t.status NOT IN ('completed', 'cancelled')
      AND t.archived = false
      AND t.source != 'one_on_one_note'
    ORDER BY t.due_date ASC
    LIMIT 5
  `)).rows as any[];

  const blockerRows = (await db.execute(sql`
    SELECT t.id, t.title, t.priority,
           EXTRACT(EPOCH FROM (NOW() - t.updated_at)) / 86400 AS stale_days
    FROM tasks t
    WHERE t.owner_user_id = ${teamMemberId}
      AND t.board_column = 'blocked'
      AND t.status NOT IN ('completed', 'cancelled')
      AND t.archived = false
    ORDER BY t.updated_at ASC
    LIMIT 3
  `)).rows as any[];

  const staleRows = (await db.execute(sql`
    SELECT t.id, t.title, t.priority,
           EXTRACT(EPOCH FROM (NOW() - t.updated_at)) / 86400 AS stale_days
    FROM tasks t
    WHERE t.owner_user_id = ${teamMemberId}
      AND t.updated_at < NOW() - INTERVAL '7 days'
      AND t.status NOT IN ('completed', 'cancelled')
      AND t.archived = false
      AND (t.board_column IS NULL OR t.board_column != 'blocked')
    ORDER BY t.updated_at ASC
    LIMIT 3
  `)).rows as any[];

  const winsRows = (await db.execute(sql`
    SELECT t.id, t.title, t.completed_at
    FROM tasks t
    WHERE t.owner_user_id = ${teamMemberId}
      AND t.status = 'completed'
      AND t.completed_at > NOW() - INTERVAL '14 days'
    ORDER BY t.completed_at DESC
    LIMIT 3
  `)).rows as any[];

  const priorActionRows = (await db.execute(sql`
    SELECT ai.id, ai.title, ai.status, ai.due_date, ai.owner_name
    FROM meeting_note_action_items ai
    JOIN meeting_notes mn ON mn.id = ai.meeting_note_id
    WHERE mn.created_by = ${ceoId}
      AND mn.linked_object_type = 'user'
      AND mn.linked_object_id = ${teamMemberId}
      AND mn.source = 'one_on_one'
      AND mn.status != 'deleted'
      AND ai.status IN ('suggested', 'accepted')
    ORDER BY ai.created_at DESC
    LIMIT 5
  `)).rows as any[];

  return {
    teamMemberId,
    teamMemberName: memberName,
    openCommitments: openCommitmentsRows.map(r => ({
      id: r.id,
      text: r.title,
      source: "prior 1:1 commitment",
      priority: r.priority,
      dueDate: r.due_date,
    })),
    overdueTasks: overdueRows.map(r => ({
      id: r.id,
      text: r.title,
      source: "overdue task",
      priority: r.priority,
      dueDate: r.due_date,
    })),
    blockers: blockerRows.map(r => ({
      id: r.id,
      text: r.title,
      source: "blocked task",
      staleDays: Math.round(Number(r.stale_days) || 0),
    })),
    staleWork: staleRows.map(r => ({
      id: r.id,
      text: r.title,
      source: "no recent update",
      staleDays: Math.round(Number(r.stale_days) || 0),
    })),
    recentWins: winsRows.map(r => ({
      id: r.id,
      text: r.title,
      source: "recently completed",
    })),
    priorActionItems: priorActionRows.map(r => ({
      id: r.id,
      text: r.title,
      source: `prior 1:1 action (${r.status})`,
      dueDate: r.due_date,
    })),
    suggestedQuestions: SUGGESTED_QUESTIONS,
    generated_at: new Date().toISOString(),
  };
}

// ── 6. Extract commitments from note ──────────────────────────────────────────

const COMMITMENT_PATTERNS = [
  /^\s*[-*]\s*\[[ x?]\]\s*(.+)/i,
  /^\s*[-*•]\s*((?:I will|You will|Will|Need to|Follow up|Action:|TODO:|Next step:?).+)/i,
  /(.+\b(?:by (?:Friday|Monday|Tuesday|Wednesday|Thursday|end of (?:week|month)|next week)|by \d{1,2}\/\d{1,2}).+)/i,
  /^\s*(?:Action|TODO|Follow[- ]up|Next step)[:\s]+(.+)/i,
];

function extractDeterministic(text: string | null, defaultOwnerId: number | null): CommitmentCandidate[] {
  if (!text) return [];
  const candidates: CommitmentCandidate[] = [];
  const lines = text.split(/\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 5) continue;
    for (const pattern of COMMITMENT_PATTERNS) {
      const m = trimmed.match(pattern);
      if (m) {
        const title = (m[1] ?? trimmed).trim().slice(0, 300);
        if (title.length < 5) continue;
        const dueDateMatch = title.match(/by\s+((?:Friday|Monday|Tuesday|Wednesday|Thursday|end of (?:week|month)|next week)|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i);
        candidates.push({
          title,
          ownerUserId: defaultOwnerId,
          ownerName: null,
          dueDate: dueDateMatch ? null : null,
          sourceQuote: trimmed.slice(0, 200),
          confidence: 0.7,
          suggestedPriority: "medium",
          needsReview: true,
        });
        break;
      }
    }
  }
  return candidates;
}

function buildOpenAIClient(): OpenAI | null {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  return new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
}

export async function extractCommitmentsFromNote(
  noteId: number,
  ceoId: number
): Promise<{ candidates: CommitmentCandidate[]; warnings: string[] }> {
  noteId = safeId(noteId);
  ceoId = safeId(ceoId);

  const [note] = (await db.execute(sql`
    SELECT mn.id, mn.notes_text, mn.decisions_text, mn.action_items_text,
           mn.one_on_one_sections, mn.linked_object_id AS team_member_id,
           u.name AS team_member_name
    FROM meeting_notes mn
    LEFT JOIN users u ON u.id = mn.linked_object_id
    WHERE mn.id = ${noteId}
      AND mn.created_by = ${ceoId}
      AND mn.source = 'one_on_one'
      AND mn.status != 'deleted'
    LIMIT 1
  `)).rows as any[];
  if (!note) throw new Error("Note not found or access denied");

  const teamMemberId = Number(note.team_member_id) || null;
  const warnings: string[] = [];

  const sections = parseSections(note.one_on_one_sections);
  const allText = [
    note.action_items_text,
    note.notes_text,
    sections.blockers,
    sections.priorities,
  ].filter(Boolean).join("\n");

  const deterministic = extractDeterministic(allText, teamMemberId);

  let aiCandidates: CommitmentCandidate[] = [];
  const client = buildOpenAIClient();
  if (client) {
    try {
      const prompt = `You are reviewing a 1:1 meeting note. Extract explicit commitments, action items, and follow-ups.
Return JSON: { "items": [{ "title": string, "owner": "ceo"|"team_member"|"both"|"unknown", "due_date": "YYYY-MM-DD or null", "source_quote": string, "confidence": 0.0-1.0 }] }
Only extract items that are explicit commitments. Do not invent. Do not include vague discussion points.
Keep titles concise (under 120 chars). Preserve exact wording where possible.

NOTE TEXT:
${allText.slice(0, 3000)}`;

      const model = "gpt-4o-mini";
      const resp = await client.chat.completions.create({
        model,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
        ...buildOpenAIModelParams(model, { tokenLimit: 1000, temperature: 0.2 }),
      });
      const parsed = JSON.parse(resp.choices[0]?.message?.content ?? "{}");
      if (Array.isArray(parsed.items)) {
        for (const item of parsed.items.slice(0, 15)) {
          const ownerUserId = item.owner === "ceo" ? ceoId : item.owner === "team_member" ? teamMemberId : null;
          aiCandidates.push({
            title: String(item.title ?? "").slice(0, 300),
            ownerUserId,
            ownerName: ownerUserId === ceoId ? "Trevor" : (ownerUserId ? (note.team_member_name || null) : null),
            dueDate: item.due_date || null,
            sourceQuote: String(item.source_quote ?? "").slice(0, 200),
            confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0.6)),
            suggestedPriority: "medium",
            needsReview: true,
          });
        }
      }
    } catch (err: any) {
      warnings.push(`AI extraction unavailable — showing deterministic results only. (${err?.message?.slice(0, 60)})`);
    }
  } else {
    warnings.push("AI extraction not configured — showing deterministic results only.");
  }

  const seen = new Set<string>();
  const deduped = [...aiCandidates, ...deterministic].filter(c => {
    const key = c.title.toLowerCase().slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return c.title.length >= 5;
  });

  return { candidates: deduped.slice(0, 20), warnings };
}

// ── 7. Create tasks from reviewed commitments ──────────────────────────────────

export async function createTasksFromCommitments(
  noteId: number,
  ceoId: number,
  commitments: CommitmentTaskInput[]
): Promise<{ createdIds: number[]; skipped: number }> {
  noteId = safeId(noteId);
  ceoId = safeId(ceoId);

  const [note] = (await db.execute(sql`
    SELECT id, linked_object_id AS team_member_id, title AS note_title
    FROM meeting_notes
    WHERE id = ${noteId} AND created_by = ${ceoId} AND source = 'one_on_one' AND status != 'deleted'
    LIMIT 1
  `)).rows as any[];
  if (!note) throw new Error("Note not found or access denied");

  const teamMemberId = Number(note.team_member_id) || null;
  const noteTitle = note.note_title || "1:1 Note";

  const existingRows = (await db.execute(sql`
    SELECT title FROM tasks
    WHERE source = 'one_on_one_note'
      AND (source_meta->>'meetingNoteId')::int = ${noteId}
  `)).rows as any[];
  const existingTitles = new Set((existingRows as any[]).map(r => r.title?.toLowerCase()?.slice(0, 60)));

  const createdIds: number[] = [];
  let skipped = 0;

  for (const c of commitments.slice(0, 20)) {
    const title = safeBound(c.title, 500);
    if (!title) { skipped++; continue; }
    if (existingTitles.has(title.toLowerCase().slice(0, 60))) { skipped++; continue; }

    const ownerUserId = safeId(c.ownerUserId);
    const [validUser] = (await db.execute(sql`
      SELECT id FROM users WHERE id = ${ownerUserId} AND status = 'active' LIMIT 1
    `)).rows as any[];
    if (!validUser) { skipped++; continue; }

    const priority = ["high", "medium", "low"].includes(c.priority ?? "") ? c.priority! : "medium";
    const dueDate = c.dueDate ? new Date(c.dueDate).toISOString() : null;
    const sourceMeta = JSON.stringify({ meetingNoteId: noteId, teamMemberId, sourceQuote: c.sourceQuote?.slice(0, 200) });
    const sourceLabel = `From 1:1 Note: ${noteTitle.slice(0, 80)}`;

    const [created] = (await db.execute(sql`
      INSERT INTO tasks (
        owner_user_id, created_by_user_id, title, status, priority,
        source, source_label, source_meta,
        due_date, created_at, updated_at, archived
      ) VALUES (
        ${ownerUserId}, ${ceoId}, ${title}, 'pending', ${priority},
        'one_on_one_note', ${sourceLabel}, ${sourceMeta}::jsonb,
        ${dueDate}::timestamptz, NOW(), NOW(), false
      )
      RETURNING id
    `)).rows as any[];

    if (created?.id) {
      createdIds.push(Number(created.id));
      existingTitles.add(title.toLowerCase().slice(0, 60));

      await db.execute(sql`
        INSERT INTO meeting_note_action_items (
          meeting_note_id, title, owner_user_id, due_date, source_quote,
          confidence_score, status, created_task_id, created_at
        ) VALUES (
          ${noteId}, ${title}, ${ownerUserId}, ${dueDate}::timestamptz,
          ${c.sourceQuote?.slice(0, 200) ?? null}, 0.9, 'task_created', ${Number(created.id)}, NOW()
        )
      `);
    }
  }

  return { createdIds, skipped };
}

// ── 8. Update draft / Ask for Update ──────────────────────────────────────────

export async function getUpdateDraft(
  ceoId: number,
  targetUserId: number,
  _sourceType: string,
  _sourceId: string | number,
  customMessage?: string | null
): Promise<UpdateDraftResult> {
  ceoId = safeId(ceoId);
  targetUserId = safeId(targetUserId);

  const [target] = (await db.execute(sql`
    SELECT id, name FROM users WHERE id = ${targetUserId} AND user_type = 'internal' AND status = 'active' LIMIT 1
  `)).rows as any[];
  if (!target) throw new Error("Target user not found or not an internal user");

  const lo = Math.min(ceoId, targetUserId);
  const hi = Math.max(ceoId, targetUserId);
  const pairKey = `dm:${lo}:${hi}`;

  const [conv] = (await db.execute(sql`
    SELECT id FROM current_conversations WHERE participant_key = ${pairKey} AND type = 'dm' LIMIT 1
  `)).rows as any[];

  const dmConversationId = conv ? Number(conv.id) : null;
  const currentsLink = dmConversationId ? `/currents?dm=${dmConversationId}` : null;

  const draftText = customMessage?.slice(0, 2000) ||
    `Quick check-in — can you post a brief update on this today? Please include: current status, blocker if any, and next step.`;

  return { draftText, dmConversationId, currentsLink };
}
