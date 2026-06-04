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

import { db } from "../db";
import { sql } from "drizzle-orm";

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

export async function getUserAiSettings(userId: number): Promise<{ defaultVoiceProfileId: number | null }> {
  const rows = (
    await db.execute(sql.raw(`
      SELECT default_voice_profile_id FROM user_ai_settings WHERE user_id = ${userId}
    `))
  ).rows as any[];
  return {
    defaultVoiceProfileId: rows[0]?.default_voice_profile_id ?? null,
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

// ── Prompt injection ──────────────────────────────────────────────────────────

/**
 * Build the system prompt block for a voice profile.
 * Returns an empty string if the profile has no meaningful instructions.
 */
export function buildVoiceProfilePromptBlock(profile: VoiceProfile): string {
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
  return lines.join("\n");
}
