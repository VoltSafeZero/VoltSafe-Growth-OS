/**
 * Source-grep regression tests: AI Suggested Email temporal awareness.
 *
 * Verifies that generateSuggestedNextEmail includes:
 *  1. Deterministic date classification (pre-LLM, no hallucination risk)
 *  2. Today's date injected into the system prompt
 *  3. Guardrails against "upcoming meeting" language for past dates
 *  4. detectedContext field on SuggestedEmail interface
 *
 * These are structural tests — if any piece regresses the AI will again
 * hallucinate "upcoming meeting" for past events.
 */

const fs   = require("fs");
const path = require("path");
const assert = require("assert");

const SRC_FILE = path.join(__dirname, "../server/services/crm-ai-summary.ts");
const src = fs.readFileSync(SRC_FILE, "utf8");

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

console.log("\n[server/services/crm-ai-summary.ts — temporal awareness]");

// 1. SuggestedEmail interface has detectedContext field
check(
  "SuggestedEmail interface includes detectedContext field",
  /interface SuggestedEmail[\s\S]{0,300}detectedContext\?/.test(src),
);

// 2. classifyDate helper exists and checks both past and future
check(
  "classifyDate function is defined",
  /function classifyDate\(/.test(src),
);
check(
  "classifyDate returns 'past' classification",
  /return ["']past["']/.test(src),
);
check(
  "classifyDate returns 'future' classification",
  /return ["']future["']/.test(src),
);
check(
  "classifyDate returns 'today' classification",
  /return ["']today["']/.test(src),
);

// 3. extractAndClassifyDates scans for both ISO and human-readable dates
check(
  "extractAndClassifyDates function is defined",
  /function extractAndClassifyDates\(/.test(src),
);
check(
  "ISO date regex (20xx-xx-xx) is present",
  /20\\d\{2\}-\\d\{2\}-\\d\{2\}/.test(src),
);
check(
  "Human-readable month regex is present",
  /Jan|February|March/.test(src) && /HUMAN_RE/.test(src),
);

// 4. Today's date is injected into the system prompt
check(
  "todayISO variable is set to current date",
  /todayISO\s*=\s*now\.toISOString\(\)\.slice\(0,\s*10\)/.test(src),
);
check(
  "System prompt references todayISO",
  /systemPrompt[\s\S]{0,800}todayISO/.test(src),
);
check(
  "Today's date is injected into DETERMINISTIC DATE CONTEXT block",
  /DETERMINISTIC DATE CONTEXT/.test(src) && /Today:\s*\$\{todayISO\}/.test(src),
);

// 5. Prompt guardrails explicitly forbid "upcoming meeting" for past dates
check(
  "System prompt forbids 'upcoming' language for past meetings",
  /NEVER.*upcoming.*past|past.*NEVER.*upcoming/i.test(src) ||
  /NEVER describe past meetings as.*upcoming/i.test(src) ||
  /NEVER.*upcoming.*meeting.*past|past.*upcoming.*meeting/i.test(src),
);
check(
  "System prompt instructs follow-up email for past meetings",
  /past.*follow.?up|follow.?up.*past/i.test(src),
);

// 6. pastDates and futureDates arrays are populated and used
check(
  "pastDates array is populated from classified dates",
  /pastDates\s*=\s*classifiedDates\.filter/.test(src),
);
check(
  "futureDates array is populated from classified dates",
  /futureDates\s*=\s*classifiedDates\.filter/.test(src),
);
check(
  "pastDates are included in the user prompt",
  /pastDates[\s\S]{0,200}userPrompt|userPrompt[\s\S]{0,200}pastDates/.test(src),
);
check(
  "futureDates are included in the user prompt",
  // futureDates is embedded inside the userPrompt array literal — use a broader check
  /futureDates[\s\S]{0,1000}userPrompt|userPrompt[\s\S]{0,1000}futureDates/.test(src) ||
  /Future dates found[\s\S]{0,200}\$\{futureDates/.test(src),
);

// 7. emailIntent and detectedContext are built before LLM call
check(
  "emailIntent variable is set based on date classification",
  /emailIntent\s*=\s*["']post-meeting follow-up/.test(src),
);
check(
  "detectedContext is returned in SuggestedEmail response",
  /return\s*\{[\s\S]{0,300}detectedContext/.test(src),
);

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} checks — ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
