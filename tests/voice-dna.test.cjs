"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const voiceSrc  = fs.readFileSync(path.join(__dirname, "../server/services/ai-voice-profiles.ts"), "utf8");
const routesSrc = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; }
}

// ── Migration ─────────────────────────────────────────────────────────────────
test("migration 0014_voice_dna.sql exists", () => {
  const migPath = path.join(__dirname, "../migrations/0014_voice_dna.sql");
  assert.ok(fs.existsSync(migPath), "migrations/0014_voice_dna.sql must exist");
});
test("migration 0014 adds trained_at column", () => {
  const migSrc = fs.readFileSync(
    path.join(__dirname, "../migrations/0014_voice_dna.sql"), "utf8"
  );
  assert.ok(migSrc.includes("trained_at"), "must add trained_at column");
});
test("migration 0014 adds voice_dna_json column", () => {
  const migSrc = fs.readFileSync(
    path.join(__dirname, "../migrations/0014_voice_dna.sql"), "utf8"
  );
  assert.ok(migSrc.includes("voice_dna_json"), "must add voice_dna_json column");
});
test("migration 0014 adds training_email_count column", () => {
  const migSrc = fs.readFileSync(
    path.join(__dirname, "../migrations/0014_voice_dna.sql"), "utf8"
  );
  assert.ok(migSrc.includes("training_email_count"), "must add training_email_count column");
});

// ── Service function ──────────────────────────────────────────────────────────
test("trainVoiceFromSentMail is exported from ai-voice-profiles.ts", () => {
  assert.ok(
    voiceSrc.includes("export async function trainVoiceFromSentMail"),
    "trainVoiceFromSentMail must be exported"
  );
});
test("trainVoiceFromSentMail accepts userId and emailCount parameters", () => {
  assert.ok(
    voiceSrc.includes("trainVoiceFromSentMail(\n  userId: number") ||
    voiceSrc.includes("trainVoiceFromSentMail(userId: number") ||
    voiceSrc.includes("trainVoiceFromSentMail(\n  userId"),
    "must accept userId and emailCount parameters"
  );
  assert.ok(
    voiceSrc.includes("emailCount: number = 50") ||
    voiceSrc.includes("emailCount = 50"),
    "emailCount must default to 50"
  );
});
test("trainVoiceFromSentMail caps email count at 100", () => {
  assert.ok(
    voiceSrc.includes("Math.min(emailCount, 100)"),
    "must cap email count at 100 to prevent prompt bloat"
  );
});
test("trainVoiceFromSentMail queries outbound emails only", () => {
  const trainBlock = voiceSrc.slice(voiceSrc.indexOf("export async function trainVoiceFromSentMail"));
  assert.ok(
    trainBlock.includes("direction = 'outbound'"),
    "must query only outbound (sent) emails"
  );
});
test("trainVoiceFromSentMail filters by user's own email addresses", () => {
  const trainBlock = voiceSrc.slice(voiceSrc.indexOf("export async function trainVoiceFromSentMail"));
  assert.ok(
    trainBlock.includes("FROM email_accounts") || trainBlock.includes("email_accounts"),
    "must load user's email accounts first"
  );
  assert.ok(
    trainBlock.includes("from_email IN"),
    "must filter sent emails by user's own from_email addresses"
  );
});
test("trainVoiceFromSentMail throws if fewer than 3 emails found", () => {
  assert.ok(
    voiceSrc.includes("emails.length < 3"),
    "must throw if < 3 sent emails found"
  );
});
test("trainVoiceFromSentMail saves voice_dna_json to the profile", () => {
  const trainBlock = voiceSrc.slice(voiceSrc.indexOf("export async function trainVoiceFromSentMail"));
  assert.ok(
    trainBlock.includes("voice_dna_json"),
    "must update voice_dna_json on the profile record"
  );
});
test("trainVoiceFromSentMail saves trained_at timestamp", () => {
  const trainBlock = voiceSrc.slice(voiceSrc.indexOf("export async function trainVoiceFromSentMail"));
  assert.ok(
    trainBlock.includes("trained_at"),
    "must update trained_at when training completes"
  );
});

// ── API route ─────────────────────────────────────────────────────────────────
test("POST /api/ai/voice-profiles/train-from-sent-mail route exists", () => {
  assert.ok(
    routesSrc.includes('"/api/ai/voice-profiles/train-from-sent-mail"'),
    "route must be registered"
  );
});
test("train-from-sent-mail route requires authentication", () => {
  const routeBlock = routesSrc.slice(
    routesSrc.indexOf('"/api/ai/voice-profiles/train-from-sent-mail"') - 100,
    routesSrc.indexOf('"/api/ai/voice-profiles/train-from-sent-mail"') + 500
  );
  assert.ok(routeBlock.includes("requireAuth"), "route must require authentication");
});
test("train-from-sent-mail route imports trainVoiceFromSentMail", () => {
  const routeBlock = routesSrc.slice(
    routesSrc.indexOf('"/api/ai/voice-profiles/train-from-sent-mail"'),
    routesSrc.indexOf('"/api/ai/voice-profiles/train-from-sent-mail"') + 500
  );
  assert.ok(
    routeBlock.includes("trainVoiceFromSentMail"),
    "route must call trainVoiceFromSentMail"
  );
});

// ── Supporting voice profile functions ───────────────────────────────────────
test("listVoiceProfiles is exported", () => {
  assert.ok(voiceSrc.includes("export async function listVoiceProfiles"), "must export listVoiceProfiles");
});
test("buildVoiceProfilePromptBlock is exported", () => {
  assert.ok(voiceSrc.includes("export function buildVoiceProfilePromptBlock"), "must export buildVoiceProfilePromptBlock");
});
test("getUserDefaultVoiceProfile is exported", () => {
  assert.ok(voiceSrc.includes("export async function getUserDefaultVoiceProfile"), "must export getUserDefaultVoiceProfile");
});
test("deriveWhyGenerated is exported", () => {
  assert.ok(voiceSrc.includes("export function deriveWhyGenerated"), "must export deriveWhyGenerated");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
