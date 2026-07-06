/**
 * Theme Regression Tests
 * Ensures CMS modules do not use hardcoded dark-only backgrounds that break light mode.
 *
 * Run: node tests/theme-regression.test.cjs
 */

"use strict";
const fs = require("fs");
const path = require("path");

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

function readFile(rel) {
  return fs.readFileSync(path.resolve(__dirname, "..", rel), "utf8");
}

function countMatches(content, pattern) {
  return (content.match(pattern) || []).length;
}

// ─── Work Calendar ────────────────────────────────────────────────────────────

console.log("\nWork Calendar — theme tokens");
const wc = readFile("client/src/pages/team-work-calendar.tsx");

assert(!wc.includes("bg-[#0a0f1a]"),       "No hardcoded #0a0f1a page background");
assert(!wc.includes("bg-[#0f1623]"),        "No hardcoded #0f1623 popover background");
assert(!wc.includes("bg-slate-800"),        "No bg-slate-800 structural backgrounds");
assert(!wc.includes("bg-slate-900"),        "No bg-slate-900 structural backgrounds");
assert(!wc.includes("border-slate-700"),    "No border-slate-700 structural borders");
assert(!wc.includes("text-slate-100"),      "No text-slate-100 (use text-foreground)");
assert(!wc.includes("text-slate-200"),      "No text-slate-200 (use text-foreground)");
assert(!wc.includes("placeholder:text-slate-"), "No placeholder:text-slate-* (use placeholder:text-muted-foreground)");
assert(wc.includes("bg-muted"),             "Uses bg-muted for structural backgrounds");
assert(wc.includes("border-border"),        "Uses border-border for structural borders");
assert(wc.includes("text-foreground"),      "Uses text-foreground for primary text");
assert(wc.includes("text-muted-foreground"),"Uses text-muted-foreground for secondary text");
assert(wc.includes("bg-popover"),           "Uses bg-popover for dialogs/selects");

// ─── STATUS_CONFIG semantic colors preserved ──────────────────────────────────

console.log("\nWork Calendar — semantic status colors preserved");
assert(wc.includes("text-emerald-400"),     "Preserved: in_office green");
assert(wc.includes("text-blue-400"),        "Preserved: remote blue");
assert(wc.includes("text-purple-400"),      "Preserved: work_travel purple");
assert(wc.includes("text-red-400"),         "Preserved: sick red");
assert(wc.includes("text-orange-400"),      "Preserved: hybrid orange");
assert(wc.includes("text-amber-400"),       "Preserved: flexible amber");
// Day Off and Not Updated use slate as intentional neutral-status colors in STATUS_CONFIG
assert(wc.includes("text-slate-400"),       "Preserved: day_off neutral slate in STATUS_CONFIG");
assert(wc.includes("text-slate-500"),       "Preserved: not_updated neutral slate in STATUS_CONFIG");
assert(wc.includes("bg-slate-500/15"),      "Preserved: day_off badge bg in STATUS_CONFIG");
assert(wc.includes("bg-slate-500/10"),      "Preserved: not_updated badge bg in STATUS_CONFIG");
assert(wc.includes("border-slate-600/30"), "Preserved: not_updated badge border in STATUS_CONFIG");

// ─── CMS-wide audit — no structural dark page backgrounds ────────────────────

console.log("\nCMS-wide audit — structural dark page backgrounds");
const pagesDir = path.resolve(__dirname, "../client/src/pages");
const pagesToAudit = [
  "team-work-calendar.tsx",
];

// These are exempted: intentionally dark standalone pages outside the CMS shell
const EXEMPTIONS = new Set([
  "unsubscribe.tsx",            // public email unsubscribe page
  "preferences.tsx",            // public email preferences page
  "unsubscribe-compliance.tsx", // public compliance unsubscribe page
]);

const CMS_STRUCTURAL_DARKS = [
  /bg-\[#0a0f1a\]/,
  /bg-\[#020617\]/,
  /bg-\[#050b14\]/,
  /bg-slate-950\b/,
  /bg-gray-950\b/,
];

// Scan all CMS pages that aren't exempted
const allPages = fs.readdirSync(pagesDir).filter(f => f.endsWith(".tsx"));
let darkPagesFound = [];

for (const page of allPages) {
  if (EXEMPTIONS.has(page)) continue;
  const content = fs.readFileSync(path.join(pagesDir, page), "utf8");
  const hits = CMS_STRUCTURAL_DARKS.filter(p => p.test(content));
  if (hits.length > 0) {
    darkPagesFound.push(`${page}: ${hits.map(p => p.toString()).join(", ")}`);
  }
}

assert(
  darkPagesFound.length === 0,
  darkPagesFound.length === 0
    ? "No CMS page uses hardcoded dark page backgrounds (bg-[#0a0f1a], bg-slate-950, etc.)"
    : `CMS pages with hardcoded dark backgrounds:\n    ${darkPagesFound.join("\n    ")}`
);

// ─── Specific CMS pages — no bg-slate-800 structural (structural bg only) ────

console.log("\nWork Calendar specifically — no bg-slate-800 structural class");
assert(
  countMatches(wc, /bg-slate-800/g) === 0,
  "team-work-calendar.tsx: zero bg-slate-800 occurrences"
);

// ─── Verify theme tokens are present and working ──────────────────────────────

console.log("\nTheme infrastructure — CSS vars exist");
const indexCss = readFile("client/src/index.css");
assert(indexCss.includes("--background"),       "CSS var --background defined");
assert(indexCss.includes("--foreground"),        "CSS var --foreground defined");
assert(indexCss.includes("--card"),              "CSS var --card defined");
assert(indexCss.includes("--muted"),             "CSS var --muted defined");
assert(indexCss.includes("--border"),            "CSS var --border defined");
assert(indexCss.includes("--popover"),           "CSS var --popover defined");
assert(indexCss.includes("--muted-foreground"),  "CSS var --muted-foreground defined");

// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(53)}`);
console.log(`Theme regression: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
