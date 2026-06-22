"use strict";
/**
 * openai-compat.test.cjs
 *
 * Source-grep tests that pin the openai-compat helper and verify every
 * OpenAI call site in the codebase uses getTokenLimitParam instead of a
 * bare max_tokens literal.
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
console.log("\n── openai-compat.ts: helper definition ──");

assert(
  compat.includes("export function getTokenLimitParam"),
  "getTokenLimitParam is exported"
);
assert(
  compat.includes('model.startsWith("o")'),
  "o-series models detected"
);
assert(
  compat.includes('model.includes("gpt-5")'),
  "gpt-5 family detected"
);
assert(
  compat.includes('model.includes("gpt-4.1")'),
  "gpt-4.1 family detected"
);
assert(
  compat.includes('model.includes("reasoning")'),
  "reasoning keyword detected"
);
assert(
  compat.includes("max_completion_tokens: value"),
  "returns max_completion_tokens for newer models"
);
assert(
  compat.includes("max_tokens: value"),
  "returns max_tokens for legacy models"
);
assert(
  compat.includes("if (!value) return {}"),
  "returns empty object when no value supplied"
);

// ── Section 2: no bare max_tokens in updated call sites ───────────────────────
console.log("\n── No bare max_tokens in updated files ──");

function countBareMaxTokens(src) {
  // match "max_tokens:" NOT preceded by "completion_" and not inside a comment or string
  // Simple heuristic: count lines containing "max_tokens:" where that token is NOT
  // "max_completion_tokens"
  return src.split("\n").filter(line => {
    const trimmed = line.trim();
    return /\bmax_tokens\s*:/.test(trimmed) &&
           !trimmed.startsWith("//") &&
           !trimmed.startsWith("*") &&
           !trimmed.includes("max_completion_tokens");
  }).length;
}

assert(
  countBareMaxTokens(summary) === 0,
  "crm-ai-summary.ts has no bare max_tokens property"
);
assert(
  countBareMaxTokens(meeting) === 0,
  "meeting-notes-ai.ts has no bare max_tokens property"
);
assert(
  countBareMaxTokens(voice) === 0,
  "ai-voice-profiles.ts has no bare max_tokens property"
);
assert(
  countBareMaxTokens(routes) === 0,
  "routes.ts has no bare max_tokens property"
);

// ── Section 3: getTokenLimitParam spread used at every call site ───────────────
console.log("\n── getTokenLimitParam spread used at call sites ──");

function countSpreadUsage(src) {
  return (src.match(/\.\.\.getTokenLimitParam\(/g) || []).length;
}

assert(
  countSpreadUsage(summary) === 2,
  "crm-ai-summary.ts uses getTokenLimitParam spread exactly 2 times (summary + suggested-email)"
);
assert(
  countSpreadUsage(meeting) === 1,
  "meeting-notes-ai.ts uses getTokenLimitParam spread exactly 1 time"
);
assert(
  countSpreadUsage(voice) === 1,
  "ai-voice-profiles.ts uses getTokenLimitParam spread exactly 1 time"
);
assert(
  countSpreadUsage(routes) === 1,
  "routes.ts uses getTokenLimitParam spread exactly 1 time"
);

// ── Section 4: imports are present ────────────────────────────────────────────
console.log("\n── imports of getTokenLimitParam ──");

assert(
  summary.includes('from "./openai-compat"'),
  "crm-ai-summary.ts imports from openai-compat"
);
assert(
  meeting.includes('from "./openai-compat"'),
  "meeting-notes-ai.ts imports from openai-compat"
);
assert(
  voice.includes('from "./openai-compat"'),
  "ai-voice-profiles.ts imports from openai-compat"
);
assert(
  routes.includes('from "./services/openai-compat"'),
  "routes.ts imports from openai-compat"
);

// ── Section 5: token values are preserved ─────────────────────────────────────
console.log("\n── Token limit values preserved ──");

assert(
  summary.includes("getTokenLimitParam(\"gpt-5-mini\", 1200)"),
  "AI summary generation preserves 1200 token limit"
);
assert(
  summary.includes("getTokenLimitParam(\"gpt-5-mini\", 800)"),
  "Suggested email generation preserves 800 token limit"
);
assert(
  meeting.includes("getTokenLimitParam(model, 4096)"),
  "Meeting notes preserves 4096 token limit (model-variable aware)"
);
assert(
  voice.includes("getTokenLimitParam(\"gpt-5-mini\", 800)"),
  "Voice profiles preserves 800 token limit"
);
assert(
  routes.includes("getTokenLimitParam(\"gpt-5-mini\", 600)"),
  "Routes sales briefing preserves 600 token limit"
);

// ── Section 6: meeting-notes correctly passes model variable ──────────────────
console.log("\n── meeting-notes-ai: model variable passed to helper ──");

assert(
  meeting.includes("getTokenLimitParam(model, 4096)"),
  "meeting-notes passes `model` variable so gpt-4o gets max_tokens and gpt-5-mini gets max_completion_tokens"
);

// ── Section 7: no token limits removed ────────────────────────────────────────
console.log("\n── Token limits not removed ──");

assert(
  !summary.includes("// max_tokens"),
  "No commented-out max_tokens in crm-ai-summary.ts"
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n────────────────────────────────────────────────────────────");
console.log(`openai-compat: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
