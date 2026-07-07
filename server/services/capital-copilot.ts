/**
 * capital-copilot.ts — Phase 2K
 *
 * Capital AI Copilot service.
 * Builds system/user prompts, calls OpenAI, returns structured response.
 * No DB calls — all data passed as built context.
 */

import OpenAI from "openai";
import { buildOpenAIModelParams } from "./openai-compat.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CopilotMode =
  | "ask"
  | "strategy"
  | "follow_up"
  | "board_update"
  | "closing_plan"
  | "data_room"
  | "engagement"
  | "email_draft";

export const VALID_COPILOT_MODES: CopilotMode[] = [
  "ask",
  "strategy",
  "follow_up",
  "board_update",
  "closing_plan",
  "data_room",
  "engagement",
  "email_draft",
];

export interface CopilotAction {
  action_type:   string;
  title:         string;
  description:   string;
  investor_id?:  number | null;
  contact_id?:   number | null;
  round_id?:     number | null;
  due_date?:     string | null;
  priority:      "high" | "medium" | "low";
  reason:        string;
  source_signal: string;
}

export interface DraftOutput {
  subject:        string;
  body:           string;
  tone:           string;
  target_contact: string;
  investor_id:    number | null;
  context_used:   string[];
  warnings:       string[];
}

export interface CopilotResponse {
  answer:              string;
  context_used:        string[];
  recommended_actions: CopilotAction[];
  draft_output:        DraftOutput | null;
  warnings:            string[];
  generated_at:        string;
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

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT_BASE = `You are the Capital AI Copilot for VoltSafe Growth OS.
You are a private, expert fundraising advisor for the CEO and CFO only.

CRITICAL RULES — NEVER VIOLATE:
1. Never invent investor status, commitments, valuations, emails, documents, or events. Only use provided Capital context.
2. State clearly when data is missing or incomplete. Do not fill gaps with assumptions.
3. Preserve exact numbers from the context — do not round, estimate, or extrapolate financial figures.
4. Separate facts (derived from context) from recommendations (your analysis).
5. Do not auto-send emails. Do not create or submit messages. Drafts are drafts only.
6. In BOARD-SAFE mode: exclude raw email snippets, internal notes, private commentary, and confidential investor details. Summarize only.
7. Be concise and action-oriented. This is a CEO/CFO tool — no filler, no hedging.
8. Cite source labels (e.g., [weighted_pipeline], [risk_flags]) where relevant so the user can verify.
9. If you cannot answer from the provided context, say so explicitly and state what additional data would be needed.
10. Never expose Capital data to users outside this session. All outputs are confidential.

RESPONSE FORMAT:
Return valid JSON with this exact structure:
{
  "answer": "...",
  "context_used": ["source_label_1", "source_label_2"],
  "recommended_actions": [
    {
      "action_type": "follow_up|draft_email|send_material|update_next_step|schedule_meeting|chase_docs|confirm_allocation|update_commitment|create_task|review_email_link|update_data_room",
      "title": "...",
      "description": "...",
      "investor_id": null,
      "contact_id": null,
      "round_id": null,
      "due_date": null,
      "priority": "high|medium|low",
      "reason": "...",
      "source_signal": "..."
    }
  ],
  "draft_output": null,
  "warnings": []
}

For email_draft mode, populate draft_output:
{
  "subject": "...",
  "body": "...",
  "tone": "professional|warm|urgent|formal",
  "target_contact": "...",
  "investor_id": null,
  "context_used": [],
  "warnings": []
}
`;

function buildModeInstructions(mode: CopilotMode, includeSensitive: boolean): string {
  const boardNote = !includeSensitive
    ? "\nBOARD-SAFE MODE ACTIVE: Exclude all internal notes, private commentary, raw email content. Summarize only safe-for-board facts.\n"
    : "";

  const modeInstructions: Record<CopilotMode, string> = {
    ask: `MODE: ask\nAnswer the question directly using provided context. Be precise. Cite sources.`,
    strategy: `MODE: strategy\nIdentify risks, opportunities, and sequencing. Provide specific next actions. Structure as: Situation → Risks → Opportunities → Recommended Sequence.`,
    follow_up: `MODE: follow_up\nIdentify who needs follow-up, why, and with what message. Prioritize by urgency and investor value. Return recommended_actions for each follow-up.`,
    board_update: `MODE: board_update\nProduce a board-safe capital update. Include: round status, pipeline progress vs target, top 3 risks, key milestones, and management asks. No internal commentary.`,
    closing_plan: `MODE: closing_plan\nProduce an investor-by-investor close plan. For each investor, state: current stage, what's needed to advance, specific action, timeline. Focus on the fastest path to minimum close.`,
    data_room: `MODE: data_room\nFocus on: which investors are missing key materials, what materials are driving engagement, who opened the portal without responding, and which diligence requests are overdue.`,
    engagement: `MODE: engagement\nInterpret investor engagement signals. Identify the hottest investors, the ones going cold, and what behavior is driving or blocking momentum.`,
    email_draft: `MODE: email_draft\nDraft a professional investor email. Use only information from context. Set answer to a brief summary of what you drafted and why. Populate draft_output fully. Mark clearly: THIS IS A DRAFT — DO NOT SEND WITHOUT REVIEW.`,
  };

  return boardNote + modeInstructions[mode];
}

// ── Prompt builder ────────────────────────────────────────────────────────────

export function buildCopilotPrompt(
  context: string,
  question: string,
  mode: CopilotMode,
  includeSensitive: boolean,
): string {
  const modeInstructions = buildModeInstructions(mode, includeSensitive);
  return `${modeInstructions}

=== CAPITAL DATA CONTEXT ===
${context}
=== END CONTEXT ===

USER QUESTION:
${question}

Respond with valid JSON only. No markdown, no explanation outside the JSON.`;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runCopilotQuery(
  question:        string,
  contextText:     string,
  sourceLabels:    string[],
  mode:            CopilotMode,
  includeSensitive: boolean,
  investorId?:     number | null,
  roundId?:        number | null,
): Promise<CopilotResponse> {
  const generated_at = new Date().toISOString();

  const openai = buildOpenAIClient();
  if (!openai) {
    return {
      answer:              "Capital AI Copilot is unavailable — no OpenAI API key configured.",
      context_used:        [],
      recommended_actions: [],
      draft_output:        null,
      warnings:            ["No OpenAI API key configured. Set AI_INTEGRATIONS_OPENAI_API_KEY."],
      generated_at,
    };
  }

  const MODEL = "gpt-5-mini";
  const userPrompt = buildCopilotPrompt(contextText, question, mode, includeSensitive);

  let raw = "";
  try {
    const completion = await openai.chat.completions.create({
      model:    MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT_BASE },
        { role: "user",   content: userPrompt },
      ],
      response_format: { type: "json_object" },
      ...buildOpenAIModelParams(MODEL, { tokenLimit: 4000 }),
    });

    raw = completion.choices[0]?.message?.content ?? "";
    if (!raw) throw new Error("Empty response from model");

    const parsed = JSON.parse(raw);

    return {
      answer:              String(parsed.answer ?? "No answer provided."),
      context_used:        Array.isArray(parsed.context_used) ? parsed.context_used : sourceLabels,
      recommended_actions: Array.isArray(parsed.recommended_actions) ? parsed.recommended_actions : [],
      draft_output:        parsed.draft_output ?? null,
      warnings:            Array.isArray(parsed.warnings) ? parsed.warnings : [],
      generated_at,
    };
  } catch (err: any) {
    return {
      answer:              `Capital AI Copilot encountered an error: ${err?.message ?? "Unknown error"}`,
      context_used:        sourceLabels,
      recommended_actions: [],
      draft_output:        null,
      warnings:            [`AI generation failed: ${err?.message ?? "unknown"}`],
      generated_at,
    };
  }
}

// ── Suggested prompts ─────────────────────────────────────────────────────────

export const SUGGESTED_PROMPTS: Record<string, { label: string; question: string; mode: CopilotMode }[]> = {
  general: [
    { label: "What changed this week?",       question: "What changed in the round this week?",         mode: "ask" },
    { label: "Biggest risks right now",        question: "What are the biggest risks right now?",        mode: "strategy" },
    { label: "What should Trevor do today?",  question: "What should Trevor do today?",                 mode: "strategy" },
    { label: "What should Scott focus on?",   question: "What should Scott care about this week?",      mode: "ask" },
  ],
  investor: [
    { label: "Why is this investor hot/stale?",       question: "Why is this investor hot or stale?",               mode: "engagement" },
    { label: "Draft a follow-up",                     question: "Draft a follow-up to this investor.",              mode: "email_draft" },
    { label: "What is blocking commitment?",          question: "What is blocking this investor from committing?",  mode: "strategy" },
    { label: "What materials has this investor seen?",question: "What materials has this investor seen?",           mode: "data_room" },
    { label: "What should the next step be?",         question: "What should the next step be with this investor?", mode: "strategy" },
  ],
  round: [
    { label: "Hit minimum close",      question: "What needs to happen to hit minimum close?",   mode: "closing_plan" },
    { label: "Hit target close",       question: "What needs to happen to hit target close?",    mode: "closing_plan" },
    { label: "Who can lead this round?",question: "Which investors can lead this round?",        mode: "strategy" },
    { label: "Top 5 closing risks",    question: "What are the top 5 closing risks?",            mode: "strategy" },
    { label: "7-day close plan",       question: "Build a 7-day close plan.",                    mode: "closing_plan" },
  ],
  data_room: [
    { label: "Missing key materials",      question: "Which investors are missing key materials?",        mode: "data_room" },
    { label: "Materials driving engagement",question: "Which materials are driving engagement?",          mode: "data_room" },
    { label: "Portal views without reply", question: "Who opened the portal but did not respond?",        mode: "data_room" },
    { label: "Overdue diligence requests", question: "Which diligence requests are overdue?",             mode: "data_room" },
  ],
  reporting: [
    { label: "Draft board capital update",   question: "Draft a board-ready capital update.",   mode: "board_update" },
    { label: "Draft CFO closing summary",    question: "Draft a CFO closing summary.",          mode: "board_update" },
    { label: "Draft this week's brief",      question: "Draft this week's capital brief.",      mode: "ask" },
  ],
};
