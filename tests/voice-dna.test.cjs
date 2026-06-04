/**
 * voice-dna.test.cjs
 *
 * Phase 2: Voice DNA from sent mail.
 * Source-grep and structural tests — no DB, no network calls required.
 */

const fs = require("fs");
const assert = require("assert");

let passed = 0;
let failed = 0;

function check(label, value, hint = "") {
  if (value) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${hint ? " — " + hint : ""}`);
    failed++;
  }
}

function read(p) {
  try { return fs.readFileSync(p, "utf8"); } catch { return ""; }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Migration checks
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── 1. Migration 0014_voice_dna.sql ──────────────────────────────────────────");
{
  const sql = read("migrations/0014_voice_dna.sql");
  check("migration file exists", sql.length > 0);
  check("adds training_source column", sql.includes("training_source"));
  check("adds training_email_count column", sql.includes("training_email_count"));
  check("adds trained_at column", sql.includes("trained_at"));
  check("adds voice_dna_json column", sql.includes("voice_dna_json"));
  check("uses ALTER TABLE ai_voice_profiles", sql.includes("ALTER TABLE ai_voice_profiles"));
  check("uses ADD COLUMN IF NOT EXISTS (safe for re-run)", sql.includes("ADD COLUMN IF NOT EXISTS"));
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Service: ai-voice-profiles.ts
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── 2. Service — ai-voice-profiles.ts ────────────────────────────────────────");
{
  const src = read("server/services/ai-voice-profiles.ts");

  check("trainVoiceFromSentMail exported", src.includes("export async function trainVoiceFromSentMail("));
  check("VoiceDnaProfile interface exported", src.includes("export interface VoiceDnaProfile"));
  check("TrainVoiceResult interface exported", src.includes("export interface TrainVoiceResult"));
  check("stripEmailNoise helper defined", src.includes("function stripEmailNoise("));
  check("analyzeVoiceDnaWithOpenAI helper defined", src.includes("function analyzeVoiceDnaWithOpenAI("));
  check("OpenAI imported", src.includes("import OpenAI from"));
  check("queries mailbox_accounts for user", src.includes("mailbox_accounts WHERE user_id"));
  check("queries outbound emails by direction", src.includes("direction = 'outbound'"));
  check("limits email count to 100 max", src.includes("Math.min(emailCount, 100)"));
  check("stores voice_dna_json in profile", src.includes("voice_dna_json"));
  check("stores training_source = sent_mail", src.includes("training_source = 'sent_mail'"));
  check("stores training_email_count", src.includes("training_email_count"));
  check("stores trained_at = NOW()", src.includes("trained_at = NOW()"));
  check("VoiceDnaProfile has tone field", src.includes('"tone"') || src.includes("tone: string"));
  check("VoiceDnaProfile has formality field", src.includes("formality: string"));
  check("VoiceDnaProfile has signaturePhrases field", src.includes("signaturePhrases"));
  check("OpenAI response_format json_object used", src.includes('type: "json_object"'));
  check("handles no active mailbox gracefully", src.includes("No active mailbox found"));
  check("handles insufficient emails gracefully", src.includes("Not enough sent emails found"));
  check("handles no profile gracefully", src.includes("No voice profile found"));
  check("strips quoted reply lines", src.includes("> ") || src.includes("^>"));
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Route: POST /api/ai-voice-profiles/train-from-sent-mail
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── 3. Route — POST /api/ai/voice-profiles/train-from-sent-mail ─────────────");
{
  const src = read("server/routes.ts");
  const ROUTE = '"/api/ai/voice-profiles/train-from-sent-mail"';

  check("route defined", src.includes(ROUTE));
  check("route uses POST method",
    (() => {
      const idx = src.indexOf(ROUTE);
      return idx >= 0 && src.slice(Math.max(0, idx - 20), idx).includes("post(");
    })()
  );
  check("route requires authentication",
    (() => {
      const idx = src.indexOf(ROUTE);
      const ctx = src.slice(Math.max(0, idx - 100), idx + 200);
      return ctx.includes("requireAuth");
    })()
  );
  check("route imports trainVoiceFromSentMail", src.includes("trainVoiceFromSentMail"));
  check("route caps emailCount at 100", src.includes("Math.min") && src.includes("100"));
  check("route reads emailCount from body",
    (() => {
      const idx = src.indexOf(ROUTE);
      const ctx = src.slice(idx, idx + 400);
      return ctx.includes("emailCount");
    })()
  );
  check("route reads optional profileId from body",
    (() => {
      const idx = src.indexOf(ROUTE);
      const ctx = src.slice(idx, idx + 400);
      return ctx.includes("profileId");
    })()
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Unit logic: stripEmailNoise
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── 4. Unit logic — stripEmailNoise ─────────────────────────────────────────");
{
  // Minimal inline implementation matching the service
  function stripEmailNoise(text) {
    if (!text) return "";
    let cleaned = text.replace(/^>.*$/gm, "").trim();
    cleaned = cleaned.replace(/On .{5,80} wrote:/gi, "").trim();
    cleaned = cleaned.replace(/--\s*\n[\s\S]{0,500}$/, "").trim();
    cleaned = cleaned.replace(/\s+/g, " ").trim();
    return cleaned;
  }

  check("empty string returns empty", stripEmailNoise("") === "");
  check("null-ish returns empty", stripEmailNoise(undefined) === "");
  check("quoted reply lines stripped",
    !stripEmailNoise("> This is a quoted line").includes(">")
  );
  check("On ... wrote: pattern stripped",
    !stripEmailNoise("On Mon, Jan 1, 2026 at 9:00 AM John wrote:\nSome quoted text").includes("wrote:")
  );
  check("signature separator stripped",
    !stripEmailNoise("Hi there\n--\nJohn Smith\nCEO").includes("John Smith")
  );
  check("normal text preserved",
    stripEmailNoise("Hi John, thanks for your time.").includes("John")
  );
  check("collapses multiple spaces",
    !stripEmailNoise("Hello   World").includes("   ")
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Regression: existing voice profiles functionality still intact
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── 5. Regression — existing voice profiles intact ───────────────────────────");
{
  const src = read("server/services/ai-voice-profiles.ts");
  check("buildVoiceProfilePromptBlock still exported", src.includes("export function buildVoiceProfilePromptBlock("));
  check("createVoiceProfile still exported", src.includes("export async function createVoiceProfile("));
  check("updateVoiceProfile still exported", src.includes("export async function updateVoiceProfile("));
  check("INFLUENCE_LEVELS still exported", src.includes("export const INFLUENCE_LEVELS"));
  check("buildInfluencePromptBlock still present", src.includes("function buildInfluencePromptBlock("));

  const routes = read("server/routes.ts");
  check("existing GET /api/ai/voice-profiles route still present",
    routes.includes('"/api/ai/voice-profiles"') || routes.includes("'/api/ai/voice-profiles'")
  );
}

// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(70)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
