/**
 * AI Voice Profiles Service
 *
 * Manages the "Train From GPT" voice profile system.
 * Profiles encode a communication style (system instructions, style rules,
 * forbidden/preferred phrases, example messages, and knowledge docs) that is
 * injected into the email generation prompt.
 *
 * Access rules:
 *   - global profiles (owner_user_id IS NULL) — readable by everyone, editable
 *     only by admins.
 *   - user profiles (owner_user_id = N) — private to that user; other users
 *     cannot read or modify them.
 */

import OpenAI from "openai";
import { db } from "../db";
import { sql } from "drizzle-orm";

// ── Influence level constants ─────────────────────────────────────────────────

export const INFLUENCE_LEVELS = [
  { value: 0,   label: "Natural Voice",    short: "Natural",    description: "Use mostly your own voice. Still avoid obviously bad habits like spammy phrasing or fake warmth." },
  { value: 25,  label: "Light Polish",     short: "Light",      description: "Preserve more of your personality while improving clarity and structure. Less aggressive rewrite." },
  { value: 50,  label: "Executive Polish", short: "Executive",  description: "Balance your personality with significant clarity, brevity, and structure improvements." },
  { value: 75,  label: "CEO Wattson",      short: "Wattson",    description: "CEO Wattson foundation dominates. Preserves your strategic intent while upgrading tone, confidence, and CTA quality." },
  { value: 100, label: "Full CEO Wattson", short: "Full Wattson", description: "Fully apply the CEO Wattson executive style. Maximum rewrite toward clarity, brevity, confidence, and strong CTAs." },
] as const;

export type InfluenceLevel = 0 | 25 | 50 | 75 | 100;

export const VALID_INFLUENCE_VALUES: number[] = [0, 25, 50, 75, 100];

export function getInfluenceLabel(level: number): string {
  return INFLUENCE_LEVELS.find(l => l.value === level)?.label ?? "CEO Wattson";
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VoiceProfile {
  id: number;
  ownerUserId: number | null;
  name: string;
  description: string | null;
  profileType: "global" | "user";
  systemInstructions: string | null;
  styleRules: string | null;
  forbiddenPhrases: string | null;
  preferredPhrases: string | null;
  exampleMessagesJson: string;
  knowledgeSummary: string | null;
  sourceLabel: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  files?: VoiceProfileFile[];
}

export interface VoiceProfileFile {
  id: number;
  voiceProfileId: number;
  originalFilename: string;
  fileType: string;
  extractedText: string | null;
  textSummary: string | null;
  createdAt: string;
}

export interface UserAiSettings {
  defaultVoiceProfileId: number | null;
  ceoWattsonInfluenceLevel: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rowToProfile(row: any): VoiceProfile {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id ?? null,
    name: row.name,
    description: row.description ?? null,
    profileType: row.profile_type ?? "user",
    systemInstructions: row.system_instructions ?? null,
    styleRules: row.style_rules ?? null,
    forbiddenPhrases: row.forbidden_phrases ?? null,
    preferredPhrases: row.preferred_phrases ?? null,
    exampleMessagesJson: row.example_messages_json ?? "[]",
    knowledgeSummary: row.knowledge_summary ?? null,
    sourceLabel: row.source_label ?? null,
    isDefault: row.is_default ?? false,
    isActive: row.is_active ?? true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToFile(row: any): VoiceProfileFile {
  return {
    id: row.id,
    voiceProfileId: row.voice_profile_id,
    originalFilename: row.original_filename,
    fileType: row.file_type ?? "text",
    extractedText: row.extracted_text ?? null,
    textSummary: row.text_summary ?? null,
    createdAt: row.created_at,
  };
}

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

// ── Read ─────────────────────────────────────────────────────────────────────

/**
 * Return all profiles visible to this user:
 *   - all global profiles (profile_type = 'global')
 *   - their own user profiles (owner_user_id = userId)
 */
export async function listVoiceProfiles(userId: number): Promise<VoiceProfile[]> {
  const rows = (
    await db.execute(sql.raw(`
      SELECT * FROM ai_voice_profiles
      WHERE is_active = TRUE
        AND (profile_type = 'global' OR owner_user_id = ${userId})
      ORDER BY
        CASE WHEN profile_type = 'global' THEN 0 ELSE 1 END,
        is_default DESC,
        name ASC
    `))
  ).rows as any[];
  return rows.map(rowToProfile);
}

/**
 * Return a single profile + its attached files, enforcing access control.
 * Returns null if not found or not accessible.
 */
export async function getVoiceProfile(
  id: number,
  userId: number,
  isAdmin: boolean
): Promise<VoiceProfile | null> {
  const rows = (
    await db.execute(sql.raw(`
      SELECT * FROM ai_voice_profiles WHERE id = ${id} AND is_active = TRUE
    `))
  ).rows as any[];
  if (!rows.length) return null;

  const profile = rowToProfile(rows[0]);

  // Access check: global = anyone, user = owner or admin
  if (profile.profileType === "user" && profile.ownerUserId !== userId && !isAdmin) {
    return null;
  }

  // Load attached files
  const fileRows = (
    await db.execute(sql.raw(`
      SELECT * FROM ai_voice_profile_files WHERE voice_profile_id = ${id} ORDER BY id
    `))
  ).rows as any[];
  profile.files = fileRows.map(rowToFile);

  return profile;
}

/**
 * Get a profile by id for prompt injection — no file loading, just the core fields.
 * Used inside the email generation service.
 */
export async function getVoiceProfileForPrompt(
  id: number,
  userId: number,
  isAdmin: boolean
): Promise<VoiceProfile | null> {
  const rows = (
    await db.execute(sql.raw(`
      SELECT * FROM ai_voice_profiles WHERE id = ${id} AND is_active = TRUE
    `))
  ).rows as any[];
  if (!rows.length) return null;
  const profile = rowToProfile(rows[0]);

  if (profile.profileType === "user" && profile.ownerUserId !== userId && !isAdmin) {
    return null;
  }

  // Load knowledge files (text extraction for prompt)
  const fileRows = (
    await db.execute(sql.raw(`
      SELECT extracted_text, text_summary, original_filename
      FROM ai_voice_profile_files
      WHERE voice_profile_id = ${id}
      ORDER BY id
    `))
  ).rows as any[];
  profile.files = fileRows.map(rowToFile);

  return profile;
}

/**
 * Get the user's default voice profile (may be null if not set or no default exists).
 */
export async function getUserDefaultVoiceProfile(userId: number): Promise<VoiceProfile | null> {
  // Check explicit user setting first
  const settingRows = (
    await db.execute(sql.raw(`
      SELECT default_voice_profile_id FROM user_ai_settings WHERE user_id = ${userId}
    `))
  ).rows as any[];

  if (settingRows.length && settingRows[0].default_voice_profile_id) {
    const id = settingRows[0].default_voice_profile_id;
    const profile = await getVoiceProfileForPrompt(id, userId, false);
    if (profile) return profile;
  }

  // Fallback: global default
  const defaultRows = (
    await db.execute(sql.raw(`
      SELECT * FROM ai_voice_profiles
      WHERE is_default = TRUE AND is_active = TRUE AND profile_type = 'global'
      LIMIT 1
    `))
  ).rows as any[];
  if (defaultRows.length) return rowToProfile(defaultRows[0]);

  return null;
}

// ── Create ────────────────────────────────────────────────────────────────────

export interface CreateVoiceProfileInput {
  ownerUserId: number | null;
  name: string;
  description?: string;
  profileType: "global" | "user";
  systemInstructions?: string;
  styleRules?: string;
  forbiddenPhrases?: string;
  preferredPhrases?: string;
  exampleMessagesJson?: string;
  knowledgeSummary?: string;
  sourceLabel?: string;
  isDefault?: boolean;
}

export async function createVoiceProfile(input: CreateVoiceProfileInput): Promise<VoiceProfile> {
  const ownerVal = input.ownerUserId === null ? "NULL" : String(input.ownerUserId);
  const rows = (
    await db.execute(sql.raw(`
      INSERT INTO ai_voice_profiles (
        owner_user_id, name, description, profile_type,
        system_instructions, style_rules, forbidden_phrases, preferred_phrases,
        example_messages_json, knowledge_summary, source_label, is_default
      ) VALUES (
        ${ownerVal},
        '${esc(input.name.slice(0, 200))}',
        ${input.description ? `'${esc(input.description.slice(0, 1000))}'` : "NULL"},
        '${input.profileType}',
        ${input.systemInstructions ? `'${esc(input.systemInstructions)}'` : "NULL"},
        ${input.styleRules ? `'${esc(input.styleRules)}'` : "NULL"},
        ${input.forbiddenPhrases ? `'${esc(input.forbiddenPhrases)}'` : "NULL"},
        ${input.preferredPhrases ? `'${esc(input.preferredPhrases)}'` : "NULL"},
        '${esc(input.exampleMessagesJson ?? "[]")}',
        ${input.knowledgeSummary ? `'${esc(input.knowledgeSummary)}'` : "NULL"},
        ${input.sourceLabel ? `'${esc(input.sourceLabel.slice(0, 200))}'` : "NULL"},
        ${input.isDefault ? "TRUE" : "FALSE"}
      )
      RETURNING *
    `))
  ).rows as any[];
  return rowToProfile(rows[0]);
}

// ── Update ────────────────────────────────────────────────────────────────────

export interface UpdateVoiceProfileInput {
  name?: string;
  description?: string;
  systemInstructions?: string;
  styleRules?: string;
  forbiddenPhrases?: string;
  preferredPhrases?: string;
  exampleMessagesJson?: string;
  knowledgeSummary?: string;
  sourceLabel?: string;
  isDefault?: boolean;
  isActive?: boolean;
}

export async function updateVoiceProfile(
  id: number,
  input: UpdateVoiceProfileInput
): Promise<VoiceProfile | null> {
  const setParts: string[] = ["updated_at = NOW()"];

  if (input.name !== undefined) setParts.push(`name = '${esc(input.name.slice(0, 200))}'`);
  if (input.description !== undefined) setParts.push(`description = ${input.description ? `'${esc(input.description.slice(0, 1000))}'` : "NULL"}`);
  if (input.systemInstructions !== undefined) setParts.push(`system_instructions = ${input.systemInstructions ? `'${esc(input.systemInstructions)}'` : "NULL"}`);
  if (input.styleRules !== undefined) setParts.push(`style_rules = ${input.styleRules ? `'${esc(input.styleRules)}'` : "NULL"}`);
  if (input.forbiddenPhrases !== undefined) setParts.push(`forbidden_phrases = ${input.forbiddenPhrases ? `'${esc(input.forbiddenPhrases)}'` : "NULL"}`);
  if (input.preferredPhrases !== undefined) setParts.push(`preferred_phrases = ${input.preferredPhrases ? `'${esc(input.preferredPhrases)}'` : "NULL"}`);
  if (input.exampleMessagesJson !== undefined) setParts.push(`example_messages_json = '${esc(input.exampleMessagesJson)}'`);
  if (input.knowledgeSummary !== undefined) setParts.push(`knowledge_summary = ${input.knowledgeSummary ? `'${esc(input.knowledgeSummary)}'` : "NULL"}`);
  if (input.sourceLabel !== undefined) setParts.push(`source_label = ${input.sourceLabel ? `'${esc(input.sourceLabel.slice(0, 200))}'` : "NULL"}`);
  if (input.isDefault !== undefined) setParts.push(`is_default = ${input.isDefault ? "TRUE" : "FALSE"}`);
  if (input.isActive !== undefined) setParts.push(`is_active = ${input.isActive ? "TRUE" : "FALSE"}`);

  const rows = (
    await db.execute(sql.raw(`
      UPDATE ai_voice_profiles SET ${setParts.join(", ")}
      WHERE id = ${id}
      RETURNING *
    `))
  ).rows as any[];
  if (!rows.length) return null;
  return rowToProfile(rows[0]);
}

// ── Delete ────────────────────────────────────────────────────────────────────

export async function deleteVoiceProfile(id: number): Promise<boolean> {
  const rows = (
    await db.execute(sql.raw(`
      UPDATE ai_voice_profiles SET is_active = FALSE, updated_at = NOW()
      WHERE id = ${id}
      RETURNING id
    `))
  ).rows;
  return rows.length > 0;
}

// ── Files ─────────────────────────────────────────────────────────────────────

export async function addVoiceProfileFile(
  voiceProfileId: number,
  originalFilename: string,
  fileType: string,
  extractedText: string,
  textSummary?: string
): Promise<VoiceProfileFile> {
  const rows = (
    await db.execute(sql.raw(`
      INSERT INTO ai_voice_profile_files (
        voice_profile_id, original_filename, file_type, extracted_text, text_summary
      ) VALUES (
        ${voiceProfileId},
        '${esc(originalFilename.slice(0, 500))}',
        '${esc(fileType)}',
        ${extractedText ? `'${esc(extractedText)}'` : "NULL"},
        ${textSummary ? `'${esc(textSummary.slice(0, 2000))}'` : "NULL"}
      )
      RETURNING *
    `))
  ).rows as any[];
  return rowToFile(rows[0]);
}

export async function deleteVoiceProfileFile(fileId: number, voiceProfileId: number): Promise<boolean> {
  const rows = (
    await db.execute(sql.raw(`
      DELETE FROM ai_voice_profile_files WHERE id = ${fileId} AND voice_profile_id = ${voiceProfileId}
      RETURNING id
    `))
  ).rows;
  return rows.length > 0;
}

// ── User AI Settings ──────────────────────────────────────────────────────────

export async function getUserAiSettings(userId: number): Promise<UserAiSettings> {
  const rows = (
    await db.execute(sql.raw(`
      SELECT default_voice_profile_id, ceo_wattson_influence_level
      FROM user_ai_settings WHERE user_id = ${userId}
    `))
  ).rows as any[];
  return {
    defaultVoiceProfileId: rows[0]?.default_voice_profile_id ?? null,
    ceoWattsonInfluenceLevel: rows[0]?.ceo_wattson_influence_level ?? 75,
  };
}

export async function setDefaultVoiceProfile(userId: number, voiceProfileId: number | null): Promise<void> {
  const val = voiceProfileId === null ? "NULL" : String(voiceProfileId);
  await db.execute(sql.raw(`
    INSERT INTO user_ai_settings (user_id, default_voice_profile_id)
    VALUES (${userId}, ${val})
    ON CONFLICT (user_id) DO UPDATE
      SET default_voice_profile_id = ${val}, updated_at = NOW()
  `));
}

export async function setCeoWattsonInfluenceLevel(userId: number, level: number): Promise<UserAiSettings> {
  if (!VALID_INFLUENCE_VALUES.includes(level)) {
    throw new Error(`Invalid influence level: ${level}. Must be one of ${VALID_INFLUENCE_VALUES.join(", ")}`);
  }
  await db.execute(sql.raw(`
    INSERT INTO user_ai_settings (user_id, ceo_wattson_influence_level)
    VALUES (${userId}, ${level})
    ON CONFLICT (user_id) DO UPDATE
      SET ceo_wattson_influence_level = ${level}, updated_at = NOW()
  `));
  return getUserAiSettings(userId);
}

// ── Prompt injection ──────────────────────────────────────────────────────────

/**
 * Build the CEO Wattson influence block — extra prompt instructions that
 * modify how aggressively the AI rewrites toward the executive style.
 *
 * influenceLevel: 0 | 25 | 50 | 75 | 100 (default 75)
 */
export function buildInfluencePromptBlock(influenceLevel: number = 75): string {
  const lines: string[] = [];
  lines.push(`=== CEO WATTSON INFLUENCE: ${getInfluenceLabel(influenceLevel)} (${influenceLevel}%) ===`);

  if (influenceLevel >= 75) {
    lines.push(`CRITICAL: Do NOT copy the user's raw historical writing habits. The goal is to produce the BEST EVOLVED EXECUTIVE VERSION of their voice.`);
    lines.push(`- Preserve the user's intent, industry knowledge, values, and strategic instincts`);
    lines.push(`- Upgrade: clarity, brevity, confidence, sentence structure, and CTA quality`);
    lines.push(`- Remove: rambling, weak openings, apology language, vague asks, filler words, and needy tone`);
    lines.push(`- Do not start with "I hope", "Just checking in", "I wanted to", or similar weak openers`);
    lines.push(`- End with a single, clear, confident ask — not multiple questions`);
    lines.push(`- Rewrite aggressively toward the CEO Wattson voice above`);
  } else if (influenceLevel === 50) {
    lines.push(`BALANCE: Preserve the user's personality while applying meaningful executive polish.`);
    lines.push(`- Keep recognizable personal elements but improve clarity and structure`);
    lines.push(`- Remove obviously weak openers and vague asks`);
    lines.push(`- Strengthen the CTA — make the next step clear`);
    lines.push(`- Moderate rewrite: do not strip personality entirely`);
  } else if (influenceLevel === 25) {
    lines.push(`LIGHT TOUCH: Keep mostly natural voice with light polish only.`);
    lines.push(`- Fix grammatical issues and improve sentence flow`);
    lines.push(`- Keep the user's personality and natural phrases intact`);
    lines.push(`- Only remove truly egregious weak patterns (e.g. "I hope this email finds you well")`);
    lines.push(`- Minimal structural changes`);
  } else {
    // 0 — natural
    lines.push(`NATURAL: Use the user's natural voice with minimal intervention.`);
    lines.push(`- Do not rewrite or polish aggressively`);
    lines.push(`- Still avoid obviously spammy phrasing or fake corporate warmth`);
    lines.push(`- Write as the user would naturally write, with basic clarity improvements only`);
  }

  lines.push(`=== END INFLUENCE BLOCK ===`);
  return lines.join("\n");
}

/**
 * Derive bullet-point explanations for why the AI applied specific transformations,
 * based on the influence level and profile name. Deterministic — no extra AI call.
 */
export function deriveWhyGenerated(
  influenceLevel: number = 75,
  voiceProfileName?: string,
  hasVoiceProfile?: boolean
): string[] {
  const reasons: string[] = [];

  if (hasVoiceProfile && voiceProfileName) {
    reasons.push(`Applied ${voiceProfileName} voice profile`);
  }

  if (influenceLevel >= 75) {
    reasons.push("Upgraded intro — replaced weak opener with direct purpose statement");
    reasons.push("Strengthened CTA — single clear ask instead of vague follow-up");
    reasons.push("Applied CEO Wattson executive structure");
    reasons.push("Removed passive language and filler phrases");
    if (influenceLevel === 100) {
      reasons.push("Full executive rewrite — maximum clarity and confidence");
    }
  } else if (influenceLevel === 50) {
    reasons.push("Applied executive polish while preserving personal tone");
    reasons.push("Improved sentence structure and clarity");
    reasons.push("Strengthened CTA");
  } else if (influenceLevel === 25) {
    reasons.push("Light polish — grammar and flow improvements");
    reasons.push("Preserved user's natural voice and personality");
    reasons.push("Removed obvious weak openers");
  } else {
    reasons.push("Natural voice — minimal AI intervention");
    reasons.push("Basic clarity improvements only");
  }

  reasons.push("Used CRM context and recent email thread");
  reasons.push("Preserved user's strategic intent and industry knowledge");

  return reasons;
}

/**
 * Build the system prompt block for a voice profile.
 * Returns an empty string if the profile has no meaningful instructions.
 *
 * @param profile The voice profile to inject
 * @param influenceLevel How strongly to apply the CEO Wattson evolution (0-100, default 75)
 */
export function buildVoiceProfilePromptBlock(profile: VoiceProfile, influenceLevel: number = 75): string {
  const lines: string[] = [];

  lines.push(`=== VOICE PROFILE: ${profile.name} ===`);
  if (profile.description) {
    lines.push(profile.description);
    lines.push("");
  }

  if (profile.systemInstructions?.trim()) {
    lines.push("VOICE INSTRUCTIONS:");
    lines.push(profile.systemInstructions.trim());
    lines.push("");
  }

  if (profile.styleRules?.trim()) {
    lines.push("STYLE RULES:");
    lines.push(profile.styleRules.trim());
    lines.push("");
  }

  if (profile.forbiddenPhrases?.trim()) {
    const phrases = profile.forbiddenPhrases.split("\n").map(p => p.trim()).filter(Boolean);
    if (phrases.length) {
      lines.push("FORBIDDEN PHRASES — NEVER USE THESE:");
      phrases.forEach(p => lines.push(`- ${p}`));
      lines.push("");
    }
  }

  if (profile.preferredPhrases?.trim()) {
    const phrases = profile.preferredPhrases.split("\n").map(p => p.trim()).filter(Boolean);
    if (phrases.length) {
      lines.push("PREFERRED PHRASES — USE WHERE NATURAL:");
      phrases.forEach(p => lines.push(`- ${p}`));
      lines.push("");
    }
  }

  // Example messages
  try {
    const examples: string[] = JSON.parse(profile.exampleMessagesJson ?? "[]");
    if (Array.isArray(examples) && examples.length) {
      lines.push("EXAMPLE EMAILS IN THIS VOICE:");
      examples.slice(0, 3).forEach((ex, i) => {
        lines.push(`--- Example ${i + 1} ---`);
        lines.push(ex.trim());
        lines.push("");
      });
    }
  } catch { /* malformed JSON — skip */ }

  // Knowledge files
  if (profile.files && profile.files.length) {
    lines.push("KNOWLEDGE CONTEXT:");
    profile.files.forEach(f => {
      if (f.textSummary?.trim()) {
        lines.push(`[${f.originalFilename}]: ${f.textSummary.trim()}`);
      } else if (f.extractedText?.trim()) {
        lines.push(`[${f.originalFilename}]: ${f.extractedText.trim().slice(0, 800)}`);
      }
    });
    lines.push("");
  }

  if (profile.knowledgeSummary?.trim()) {
    lines.push("BACKGROUND KNOWLEDGE:");
    lines.push(profile.knowledgeSummary.trim());
    lines.push("");
  }

  lines.push(`=== END VOICE PROFILE ===`);
  lines.push("");

  // Append influence block inline
  lines.push(buildInfluencePromptBlock(influenceLevel));

  return lines.join("\n");
}

// ── Voice DNA Training (Phase 2) ──────────────────────────────────────────────

export interface VoiceDnaProfile {
  tone: string;
  formality: string;
  sentenceLength: string;
  openingPatterns: string[];
  closingPatterns: string[];
  signaturePhrases: string[];
  avoidPhrases: string[];
  bulletUsage: string;
  technicalLevel: string;
  emailCount: number;
  analysisDate: string;
}

export interface TrainVoiceResult {
  success: boolean;
  profileId: number;
  profileName: string;
  emailsAnalyzed: number;
  voiceDna: VoiceDnaProfile;
}

function stripEmailNoise(text: string): string {
  if (!text) return "";
  let cleaned = text.replace(/^>.*$/gm, "").trim();
  cleaned = cleaned.replace(/On .{5,80} wrote:/gi, "").trim();
  cleaned = cleaned.replace(/--\s*\n[\s\S]{0,500}$/, "").trim();
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned;
}

async function analyzeVoiceDnaWithOpenAI(
  emailSamples: string[],
  openai: OpenAI,
  emailCount: number
): Promise<VoiceDnaProfile> {
  const joined = emailSamples.slice(0, 30).map((s, i) => `--- Email ${i + 1} ---\n${s}`).join("\n\n");
  const systemPrompt = `You are a writing style analyst. Analyse the provided email samples and return a structured JSON describing the author's voice DNA.
Return only valid JSON matching this schema:
{
  "tone": "e.g. professional and warm / direct and assertive / casual and friendly",
  "formality": "formal / semi-formal / informal",
  "sentenceLength": "short and punchy / medium / long and detailed",
  "openingPatterns": ["array of 2-4 typical opening phrases they use"],
  "closingPatterns": ["array of 2-4 typical closing phrases they use"],
  "signaturePhrases": ["array of 3-6 characteristic phrases or expressions they use"],
  "avoidPhrases": ["array of 2-4 clichés or patterns they clearly avoid or that clash with their style"],
  "bulletUsage": "never / rarely / sometimes / often",
  "technicalLevel": "high (technical jargon) / medium (some technical terms) / low (plain language)",
  "emailCount": ${emailCount},
  "analysisDate": "${new Date().toISOString()}"
}
Return only the JSON object, no explanation.`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Analyse my writing style from these ${emailSamples.length} email samples:\n\n${joined}` },
    ],
    temperature: 0.2,
    max_tokens: 800,
    response_format: { type: "json_object" },
  });

  const raw = resp.choices[0]?.message?.content || "{}";
  try {
    const parsed = JSON.parse(raw);
    return {
      tone: parsed.tone || "professional",
      formality: parsed.formality || "semi-formal",
      sentenceLength: parsed.sentenceLength || "medium",
      openingPatterns: Array.isArray(parsed.openingPatterns) ? parsed.openingPatterns : [],
      closingPatterns: Array.isArray(parsed.closingPatterns) ? parsed.closingPatterns : [],
      signaturePhrases: Array.isArray(parsed.signaturePhrases) ? parsed.signaturePhrases : [],
      avoidPhrases: Array.isArray(parsed.avoidPhrases) ? parsed.avoidPhrases : [],
      bulletUsage: parsed.bulletUsage || "sometimes",
      technicalLevel: parsed.technicalLevel || "medium",
      emailCount,
      analysisDate: new Date().toISOString(),
    };
  } catch {
    return {
      tone: "professional", formality: "semi-formal", sentenceLength: "medium",
      openingPatterns: [], closingPatterns: [], signaturePhrases: [], avoidPhrases: [],
      bulletUsage: "sometimes", technicalLevel: "medium", emailCount,
      analysisDate: new Date().toISOString(),
    };
  }
}

/**
 * Trains a voice profile from the user's sent email history.
 * Queries outbound emails from connected mailboxes, analyses them
 * with OpenAI, and stores the Voice DNA JSON in the target profile.
 */
export async function trainVoiceFromSentMail(
  userId: number,
  emailCount: number = 50,
  profileId?: number
): Promise<TrainVoiceResult> {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("AI API key not configured");
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const openai = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });

  const accountRows = await db.execute(sql.raw(`
    SELECT email_address FROM mailbox_accounts WHERE user_id = ${userId} AND auth_status = 'active' LIMIT 5
  `));
  const accounts = (accountRows as any).rows as { email_address: string }[];
  if (!accounts.length) throw new Error("No active mailbox found. Connect your Gmail account first.");

  const emailSet = accounts.map(a => `'${a.email_address.replace(/'/g, "''")}'`).join(", ");

  const emailRows = await db.execute(sql.raw(`
    SELECT em.subject, em.snippet
    FROM email_messages em
    WHERE em.direction = 'outbound'
      AND em.from_email IN (${emailSet})
      AND em.snippet IS NOT NULL
      AND length(em.snippet) > 20
    ORDER BY em.sent_at DESC
    LIMIT ${Math.min(emailCount, 100)}
  `));
  const emails = (emailRows as any).rows as { subject: string; snippet: string }[];
  if (emails.length < 3) throw new Error("Not enough sent emails found. Send more emails and try again.");

  const samples = emails
    .map(e => `Subject: ${e.subject || "(no subject)"}\n${stripEmailNoise(e.snippet || "")}`.trim())
    .filter(s => s.length > 20);

  const voiceDna = await analyzeVoiceDnaWithOpenAI(samples, openai, samples.length);

  let targetProfileId: number;
  if (profileId) {
    targetProfileId = profileId;
  } else {
    const profRow = await db.execute(sql.raw(`
      SELECT id FROM ai_voice_profiles
      WHERE (owner_user_id = ${userId} OR profile_type = 'global')
      ORDER BY is_default DESC NULLS LAST, id ASC
      LIMIT 1
    `));
    const profRows = (profRow as any).rows as { id: number }[];
    if (!profRows.length) throw new Error("No voice profile found. Create a profile first.");
    targetProfileId = profRows[0].id;
  }

  const dnaJson = JSON.stringify(voiceDna).replace(/'/g, "''");
  const updated = await db.execute(sql.raw(`
    UPDATE ai_voice_profiles
    SET voice_dna_json = '${dnaJson}',
        training_source = 'sent_mail',
        training_email_count = ${samples.length},
        trained_at = NOW()
    WHERE id = ${targetProfileId}
    RETURNING name
  `));
  const profileName = ((updated as any).rows?.[0]?.name as string) ?? "your profile";

  return { success: true, profileId: targetProfileId, profileName, emailsAnalyzed: samples.length, voiceDna };
}
