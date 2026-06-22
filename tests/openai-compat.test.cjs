"use strict";
/**
 * openai-compat.test.cjs
 *
 * Source-grep tests that pin the openai-compat helper and verify every
 * OpenAI call site in the codebase uses getTokenLimitParam /
 * getTemperatureParam instead of bare max_tokens / temperature literals.
 */

const fs = require("fs");
const path = require("path");

const COMPAT   = path.join(__dirname, "../server/services/openai-compat.ts");
const SUMMARY  = path.join(__dirname, "../server/services/crm-ai-summary.ts");
const MEETING  = path.join(__dirname, "../server/services/meeting-notes-ai.ts");
const VOICE    = path.join(__dirname, "../server/services/ai-voice-profiles.ts");
const ROUTES   = path.join(__dirname, "../server/routes.ts");

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

// ── Section 1: getTokenLimitParam helper definition ───────────────────────────
console.log("\n── openai-compat.ts: getTokenLimitParam definition ──");

assert(compat.includes("export function getTokenLimitParam"), "getTokenLimitParam exported");
assert(compat.includes("max_completion_tokens: value"),       "returns max_completion_tokens for newer models");
assert(compat.includes("max_tokens: value"),                  "returns max_tokens for legacy models");
assert(compat.includes("if (!value) return {}"),              "returns {} when no value supplied");

// ── Section 2: getTemperatureParam helper definition ──────────────────────────
console.log("\n── openai-compat.ts: getTemperatureParam definition ──");

assert(compat.includes("export function supportsCustomTemperature"), "supportsCustomTemperature exported");
assert(compat.includes("export function getTemperatureParam"),       "getTemperatureParam exported");
assert(compat.includes("return { temperature: value }"),             "returns temperature for supported models");
assert(
  compat.includes("if (!supportsCustomTemperature(model)) return {}"),
  "returns {} for models that do not support custom temperature"
);

// ── Section 3: isNewerModel detects the right families ────────────────────────
console.log("\n── openai-compat.ts: newer-model detection ──");

assert(compat.includes('n.startsWith("o")'),          "o-series models detected");
assert(compat.includes('n.includes("gpt-5")'),         "gpt-5 family detected");
assert(compat.includes('n.includes("gpt-4.1")'),       "gpt-4.1 family detected");
assert(compat.includes('n.includes("reasoning")'),     "reasoning keyword detected");

// ── Section 4: no bare max_tokens in updated call sites ───────────────────────
console.log("\n── No bare max_tokens in updated files ──");

function countBareMaxTokens(src) {
  return src.split("\n").filter(line => {
    const trimmed = line.trim();
    return /\bmax_tokens\s*:/.test(trimmed) &&
           !trimmed.startsWith("//") &&
           !trimmed.startsWith("*") &&
           !trimmed.includes("max_completion_tokens");
  }).length;
}

assert(countBareMaxTokens(summary) === 0, "crm-ai-summary.ts: no bare max_tokens");
assert(countBareMaxTokens(meeting) === 0, "meeting-notes-ai.ts: no bare max_tokens");
assert(countBareMaxTokens(voice)   === 0, "ai-voice-profiles.ts: no bare max_tokens");
assert(countBareMaxTokens(routes)  === 0, "routes.ts: no bare max_tokens");

// ── Section 5: no bare temperature in updated call sites ──────────────────────
console.log("\n── No bare temperature literals in updated files ──");

function countBareTemperature(src) {
  return src.split("\n").filter(line => {
    const trimmed = line.trim();
    return /\btemperature\s*:/.test(trimmed) &&
           !trimmed.startsWith("//") &&
           !trimmed.startsWith("*") &&
           !trimmed.includes("getTemperatureParam") &&
           !trimmed.includes("return { temperature: value }");
  }).length;
}

assert(countBareTemperature(summary) === 0, "crm-ai-summary.ts: no bare temperature literal");
assert(countBareTemperature(meeting) === 0, "meeting-notes-ai.ts: no bare temperature literal");
assert(countBareTemperature(voice)   === 0, "ai-voice-profiles.ts: no bare temperature literal");
assert(countBareTemperature(routes)  === 0, "routes.ts: no bare temperature literal");

// ── Section 6: getTokenLimitParam spread usage counts ─────────────────────────
console.log("\n── getTokenLimitParam spread usage ──");

function countSpread(src, fn) {
  return (src.match(new RegExp(`\\.\\.\\.${fn}\\(`, "g")) || []).length;
}

assert(countSpread(summary, "getTokenLimitParam") === 2, "crm-ai-summary.ts: getTokenLimitParam spread ×2");
assert(countSpread(meeting, "getTokenLimitParam") === 1, "meeting-notes-ai.ts: getTokenLimitParam spread ×1");
assert(countSpread(voice,   "getTokenLimitParam") === 1, "ai-voice-profiles.ts: getTokenLimitParam spread ×1");
assert(countSpread(routes,  "getTokenLimitParam") === 1, "routes.ts: getTokenLimitParam spread ×1");

// ── Section 7: getTemperatureParam spread usage counts ────────────────────────
console.log("\n── getTemperatureParam spread usage ──");

assert(countSpread(summary, "getTemperatureParam") === 2, "crm-ai-summary.ts: getTemperatureParam spread ×2 (summary + suggested-email)");
assert(countSpread(meeting, "getTemperatureParam") === 1, "meeting-notes-ai.ts: getTemperatureParam spread ×1");
assert(countSpread(voice,   "getTemperatureParam") === 1, "ai-voice-profiles.ts: getTemperatureParam spread ×1");
assert(countSpread(routes,  "getTemperatureParam") === 1, "routes.ts: getTemperatureParam spread ×1");

// ── Section 8: imports are present ────────────────────────────────────────────
console.log("\n── imports include both helpers ──");

function hasFullImport(src, relPath) {
  return src.includes(`getTokenLimitParam, getTemperatureParam" from "${relPath}"`) ||
         src.includes(`getTokenLimitParam, getTemperatureParam } from "${relPath}"`);
}

assert(
  summary.includes('getTokenLimitParam, getTemperatureParam') && summary.includes('from "./openai-compat"'),
  "crm-ai-summary.ts imports both helpers from openai-compat"
);
assert(
  meeting.includes('getTokenLimitParam, getTemperatureParam') && meeting.includes('from "./openai-compat"'),
  "meeting-notes-ai.ts imports both helpers from openai-compat"
);
assert(
  voice.includes('getTokenLimitParam, getTemperatureParam') && voice.includes('from "./openai-compat"'),
  "ai-voice-profiles.ts imports both helpers from openai-compat"
);
assert(
  routes.includes('getTokenLimitParam, getTemperatureParam') && routes.includes('from "./services/openai-compat"'),
  "routes.ts imports both helpers from openai-compat"
);

// ── Section 9: temperature values are preserved correctly ─────────────────────
console.log("\n── Temperature values preserved ──");

assert(summary.includes('getTemperatureParam("gpt-5-mini", 0.3)'), "AI summary uses 0.3 temperature");
assert(summary.includes('getTemperatureParam("gpt-5-mini", 0.4)'), "Suggested email uses 0.4 temperature");
assert(meeting.includes('getTemperatureParam(model, 0.2)'),         "Meeting notes passes model variable with 0.2");
assert(voice.includes('getTemperatureParam("gpt-5-mini", 0.2)'),    "Voice profiles uses 0.2 temperature");
assert(routes.includes('getTemperatureParam("gpt-5-mini", 0.5)'),   "Sales briefing uses 0.5 temperature");

// ── Section 10: token limit values preserved ──────────────────────────────────
console.log("\n── Token limit values preserved ──");

assert(summary.includes('getTokenLimitParam("gpt-5-mini", 1200)'), "AI summary: 1200 token limit");
assert(summary.includes('getTokenLimitParam("gpt-5-mini", 800)'),  "Suggested email: 800 token limit");
assert(meeting.includes('getTokenLimitParam(model, 4096)'),         "Meeting notes: 4096 token limit");
assert(voice.includes('getTokenLimitParam("gpt-5-mini", 800)'),     "Voice profiles: 800 token limit");
assert(routes.includes('getTokenLimitParam("gpt-5-mini", 600)'),    "Sales briefing: 600 token limit");

// ── Section 11: meeting-notes passes model variable (not hardcoded) ───────────
console.log("\n── meeting-notes-ai: model variable used (not hardcoded string) ──");

assert(
  meeting.includes("getTemperatureParam(model, 0.2)"),
  "meeting-notes uses model variable for temperature — gpt-4o fallback gets temperature, gpt-5-mini does not"
);
assert(
  meeting.includes("getTokenLimitParam(model, 4096)"),
  "meeting-notes uses model variable for token limit"
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n────────────────────────────────────────────────────────────");
console.log(`openai-compat: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
