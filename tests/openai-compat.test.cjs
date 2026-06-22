"use strict";
/**
 * openai-compat.test.cjs
 *
 * Tests for server/services/openai-compat.ts:
 *   - getTokenLimitParam  (legacy individual helper)
 *   - getTemperatureParam (legacy individual helper)
 *   - buildOpenAIModelParams (unified helper)
 *
 * Also verifies every OpenAI call site in the codebase routes all generation
 * params through the compat helpers — no bare legacy params remain.
 */

const fs   = require("fs");
const path = require("path");

const COMPAT  = path.join(__dirname, "../server/services/openai-compat.ts");
const SUMMARY = path.join(__dirname, "../server/services/crm-ai-summary.ts");
const MEETING = path.join(__dirname, "../server/services/meeting-notes-ai.ts");
const VOICE   = path.join(__dirname, "../server/services/ai-voice-profiles.ts");
const ROUTES  = path.join(__dirname, "../server/routes.ts");
const VA      = path.join(__dirname, "../server/voice-assistant.ts");

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

const compat  = fs.readFileSync(COMPAT,   "utf8");
const summary = fs.readFileSync(SUMMARY,  "utf8");
const meeting = fs.readFileSync(MEETING,  "utf8");
const voice   = fs.readFileSync(VOICE,    "utf8");
const routes  = fs.readFileSync(ROUTES,   "utf8");
const va      = fs.readFileSync(VA,       "utf8");

// ── Section 1: helper exports ─────────────────────────────────────────────────
console.log("\n── openai-compat.ts: exports ──");

assert(compat.includes("export function getTokenLimitParam"),      "getTokenLimitParam exported");
assert(compat.includes("export function supportsCustomTemperature"),"supportsCustomTemperature exported");
assert(compat.includes("export function getTemperatureParam"),     "getTemperatureParam exported");
assert(compat.includes("export function buildOpenAIModelParams"),  "buildOpenAIModelParams exported");
assert(compat.includes("export interface OpenAIModelOptions"),     "OpenAIModelOptions interface exported");

// ── Section 2: OpenAIModelOptions interface covers all params ─────────────────
console.log("\n── openai-compat.ts: OpenAIModelOptions fields ──");

assert(compat.includes("tokenLimit?"),       "tokenLimit option present");
assert(compat.includes("temperature?"),      "temperature option present");
assert(compat.includes("topP?"),             "topP option present");
assert(compat.includes("frequencyPenalty?"), "frequencyPenalty option present");
assert(compat.includes("presencePenalty?"),  "presencePenalty option present");

// ── Section 3: newer-model detection ─────────────────────────────────────────
console.log("\n── openai-compat.ts: newer-model detection ──");

assert(compat.includes('n.startsWith("o")'),      "o-series detected");
assert(compat.includes('n.includes("gpt-5")'),     "gpt-5 family detected");
assert(compat.includes('n.includes("gpt-4.1")'),   "gpt-4.1 family detected");
assert(compat.includes('n.includes("reasoning")'), "reasoning keyword detected");

// ── Section 4: buildOpenAIModelParams logic ───────────────────────────────────
console.log("\n── openai-compat.ts: buildOpenAIModelParams logic ──");

assert(compat.includes("result.max_completion_tokens = options.tokenLimit"),
       "newer models: tokenLimit → max_completion_tokens");
assert(compat.includes("result.max_tokens = options.tokenLimit"),
       "legacy models: tokenLimit → max_tokens");
assert(compat.includes("if (!newer)"),
       "sampling params gated on !newer");
assert(compat.includes("result.temperature = options.temperature"),
       "temperature passed for legacy models");
assert(compat.includes("result.top_p = options.topP"),
       "top_p passed for legacy models");
assert(compat.includes("result.frequency_penalty = options.frequencyPenalty"),
       "frequency_penalty passed for legacy models");
assert(compat.includes("result.presence_penalty = options.presencePenalty"),
       "presence_penalty passed for legacy models");

// ── Section 5: no bare generation params remain anywhere ──────────────────────
console.log("\n── No bare legacy params in call sites ──");

function countBareParam(src, paramName) {
  return src.split("\n").filter(line => {
    const t = line.trim();
    return new RegExp(`\\b${paramName}\\s*:`).test(t) &&
           !t.startsWith("//") &&
           !t.startsWith("*") &&
           !t.includes("buildOpenAIModelParams") &&
           !t.includes("getTemperatureParam") &&
           !t.includes("getTokenLimitParam") &&
           // allow return statements inside the helper itself
           !t.includes("result.") &&
           !t.includes("return {");
  }).length;
}

// Services
assert(countBareParam(summary, "max_tokens")          === 0, "crm-ai-summary: no bare max_tokens");
assert(countBareParam(summary, "max_completion_tokens") === 0, "crm-ai-summary: no bare max_completion_tokens");
assert(countBareParam(summary, "temperature")          === 0, "crm-ai-summary: no bare temperature");
assert(countBareParam(summary, "top_p")                === 0, "crm-ai-summary: no bare top_p");

assert(countBareParam(meeting, "max_tokens")           === 0, "meeting-notes: no bare max_tokens");
assert(countBareParam(meeting, "max_completion_tokens") === 0, "meeting-notes: no bare max_completion_tokens");
assert(countBareParam(meeting, "temperature")          === 0, "meeting-notes: no bare temperature");

assert(countBareParam(voice, "max_tokens")             === 0, "ai-voice-profiles: no bare max_tokens");
assert(countBareParam(voice, "max_completion_tokens")  === 0, "ai-voice-profiles: no bare max_completion_tokens");
assert(countBareParam(voice, "temperature")            === 0, "ai-voice-profiles: no bare temperature");

// Routes
assert(countBareParam(routes, "max_tokens")            === 0, "routes: no bare max_tokens");
assert(countBareParam(routes, "max_completion_tokens") === 0, "routes: no bare max_completion_tokens");
assert(countBareParam(routes, "temperature")           === 0, "routes: no bare temperature");

// Voice assistant
assert(countBareParam(va, "max_tokens")                === 0, "voice-assistant: no bare max_tokens");
assert(countBareParam(va, "max_completion_tokens")     === 0, "voice-assistant: no bare max_completion_tokens");
assert(countBareParam(va, "temperature")               === 0, "voice-assistant: no bare temperature");
assert(countBareParam(va, "top_p")                     === 0, "voice-assistant: no bare top_p");
assert(countBareParam(va, "frequency_penalty")         === 0, "voice-assistant: no bare frequency_penalty");
assert(countBareParam(va, "presence_penalty")          === 0, "voice-assistant: no bare presence_penalty");

// ── Section 6: buildOpenAIModelParams usage counts ────────────────────────────
console.log("\n── buildOpenAIModelParams spread usage ──");

function countSpread(src, fn) {
  return (src.match(new RegExp(`\\.\\.\\.${fn}\\(`, "g")) || []).length;
}

assert(countSpread(summary, "buildOpenAIModelParams") === 2,
       "crm-ai-summary: spread ×2 (summary + suggested-email)");
assert(countSpread(meeting, "buildOpenAIModelParams") === 1,
       "meeting-notes: spread ×1");
assert(countSpread(voice,   "buildOpenAIModelParams") === 1,
       "ai-voice-profiles: spread ×1");
assert(countSpread(routes,  "buildOpenAIModelParams") === 1,
       "routes: spread ×1");
assert(countSpread(va,      "buildOpenAIModelParams") === 5,
       "voice-assistant: spread ×5 (tool-loop ×2, summary ×2, stream ×1)");

// ── Section 7: imports correct ────────────────────────────────────────────────
console.log("\n── buildOpenAIModelParams imported ──");

assert(
  summary.includes("buildOpenAIModelParams") && summary.includes('from "./openai-compat"'),
  "crm-ai-summary imports buildOpenAIModelParams"
);
assert(
  meeting.includes("buildOpenAIModelParams") && meeting.includes('from "./openai-compat"'),
  "meeting-notes imports buildOpenAIModelParams"
);
assert(
  voice.includes("buildOpenAIModelParams") && voice.includes('from "./openai-compat"'),
  "ai-voice-profiles imports buildOpenAIModelParams"
);
assert(
  routes.includes("buildOpenAIModelParams") && routes.includes('from "./services/openai-compat"'),
  "routes imports buildOpenAIModelParams"
);
assert(
  va.includes("buildOpenAIModelParams") && va.includes('from "./services/openai-compat"'),
  "voice-assistant imports buildOpenAIModelParams"
);

// ── Section 8: option values preserved correctly ──────────────────────────────
console.log("\n── Option values preserved at call sites ──");

assert(summary.includes('buildOpenAIModelParams("gpt-5-mini", { tokenLimit: 3000, temperature: 0.3 })'),
       "AI summary: tokenLimit 3000, temperature 0.3");
assert(summary.includes('buildOpenAIModelParams("gpt-5-mini", { tokenLimit: 4000, temperature: 0.4 })'),
       "Suggested email: tokenLimit 4000, temperature 0.4");
assert(meeting.includes('buildOpenAIModelParams(model, { tokenLimit: 4096, temperature: 0.2 })'),
       "Meeting notes: model variable, tokenLimit 4096, temperature 0.2");
assert(voice.includes('buildOpenAIModelParams("gpt-5-mini", { tokenLimit: 800, temperature: 0.2 })'),
       "Voice profiles: tokenLimit 800, temperature 0.2");
assert(routes.includes('buildOpenAIModelParams("gpt-5-mini", { tokenLimit: 600, temperature: 0.5 })'),
       "Sales briefing: tokenLimit 600, temperature 0.5");

// Voice assistant token limits
assert(va.includes('buildOpenAIModelParams("gpt-5-nano", { tokenLimit: 4096 })'),
       "Voice assistant tool loop: tokenLimit 4096");
assert(va.includes('buildOpenAIModelParams("gpt-5-nano", { tokenLimit: 1024 })'),
       "Voice assistant confirmation summary: tokenLimit 1024");
assert(va.includes('buildOpenAIModelParams("gpt-5-nano", { tokenLimit: 2048 })'),
       "Voice assistant tool summary: tokenLimit 2048");
assert(va.includes('buildOpenAIModelParams("gpt-5-nano", { tokenLimit: 8192 })'),
       "Voice assistant read-only stream: tokenLimit 8192");

// ── Section 9: legacy helpers still exported (backward compat) ────────────────
console.log("\n── Legacy helpers still available ──");

assert(compat.includes("export function getTokenLimitParam"),
       "getTokenLimitParam still exported for backward compat");
assert(compat.includes("export function getTemperatureParam"),
       "getTemperatureParam still exported for backward compat");
assert(compat.includes("export function supportsCustomTemperature"),
       "supportsCustomTemperature still exported for backward compat");

// ── Section 10: meeting-notes uses model variable (not hardcoded) ─────────────
console.log("\n── meeting-notes-ai: model variable used ──");

assert(
  meeting.includes("buildOpenAIModelParams(model,"),
  "meeting-notes passes `model` variable — gpt-4o fallback gets max_tokens + temperature, gpt-5-mini does not"
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n────────────────────────────────────────────────────────────");
console.log(`openai-compat: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
