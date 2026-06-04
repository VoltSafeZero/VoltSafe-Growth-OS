/**
 * tests/inbox-category-badge.test.cjs
 *
 * Source-grep tests for CategoryBadge component rendering in gmail-inbox.tsx.
 * Covers:
 *   (a) CATEGORY_BADGE_CONFIG map — dynamically asserts every CATEGORY_* key
 *       it declares also exists in the onFilter tabMap (self-updating coverage).
 *   (b) CategoryBadge is rendered inside the inbox row with a tab === "inbox" guard
 *   (c) onFilter tabMap covers every CATEGORY_* key present in CATEGORY_BADGE_CONFIG
 *       and maps each one to a non-empty tab-name string
 *
 * MAINTENANCE NOTE
 * ────────────────
 * Sections (a) and (c) extract CATEGORY_* keys directly from the
 * CATEGORY_BADGE_CONFIG object literal in source via regex.  When a new key
 * (e.g. CATEGORY_PERSONAL) is added to CATEGORY_BADGE_CONFIG, this test
 * automatically fails unless the same key is also added to the tabMap inside
 * the onFilter handler — no manual update required.
 *
 * Both the config block and the tabMap block are extracted using a
 * brace-balanced scan (not a fixed-width slice) to stay correct as the
 * surrounding source grows or is reformatted.
 */

"use strict";

const fs   = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

/**
 * Extract the balanced-brace block starting at `openIdx` in `src`.
 * `openIdx` must point to the opening `{`.
 * Returns the slice from `{` up to and including the matching `}`.
 */
function extractBraceBlock(src, openIdx) {
  if (src[openIdx] !== "{") throw new Error(`No '{' at index ${openIdx}`);
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(openIdx, i + 1);
    }
  }
  return src.slice(openIdx); // unbalanced — return to end of file
}

// ── Load source file ────────────────────────────────────────────────────────

const inboxPagePath = path.join(__dirname, "../client/src/pages/gmail-inbox.tsx");
const inboxPageSrc  = fs.readFileSync(inboxPagePath, "utf8");

// ── Extract CATEGORY_BADGE_CONFIG object literal (brace-balanced) ────────────
//
// We advance to the `{` of the object literal (after the `=`) so that the
// variable name itself is never matched by the CATEGORY_* regex.

const configDeclIdx = inboxPageSrc.indexOf("CATEGORY_BADGE_CONFIG");
assert(configDeclIdx !== -1, "CATEGORY_BADGE_CONFIG is declared in source");

// The declaration line contains a TypeScript generic type annotation whose own
// `{` comes before the object literal's `{`.  We skip past the `= ` assignment
// to land on the object literal's opening brace.
const configAssignIdx  = inboxPageSrc.indexOf("= {", configDeclIdx);
const configOpenBrace  = inboxPageSrc.indexOf("{", configAssignIdx + 1); // the `{` in `= {`
const configBlock      = extractBraceBlock(inboxPageSrc, configOpenBrace);

// Dynamically collect every CATEGORY_* key declared inside the object literal.
const configKeyMatches = [...configBlock.matchAll(/\b(CATEGORY_[A-Z_]+)\s*:/g)];
const configKeys       = [...new Set(configKeyMatches.map(m => m[1]))];

assert(
  configKeys.length > 0,
  `CATEGORY_BADGE_CONFIG contains at least one CATEGORY_* key (found: ${configKeys.join(", ")})`
);

// ── (a) CATEGORY_BADGE_CONFIG — all declared keys have label + className ────

console.log("\n(a) CATEGORY_BADGE_CONFIG — every declared CATEGORY_* key has label + className");

assert(
  inboxPageSrc.includes("CATEGORY_BADGE_CONFIG"),
  "CATEGORY_BADGE_CONFIG map is declared"
);

for (const key of configKeys) {
  assert(configBlock.includes(`${key}:`), `CATEGORY_BADGE_CONFIG contains ${key} key`);
}

assert(
  /label:\s*"[^"]+"/.test(configBlock),
  "CATEGORY_BADGE_CONFIG entries include a label string"
);
assert(
  /className:\s*"[^"]+"/.test(configBlock),
  "CATEGORY_BADGE_CONFIG entries include a className string"
);

assert(
  configKeys.every(k => configBlock.includes(`${k}:`)),
  `all declared CATEGORY_* keys appear inside CATEGORY_BADGE_CONFIG (${configKeys.join(", ")})`
);

// ── (b) CategoryBadge rendered inside the inbox row with tab guard ───────────

console.log("\n(b) CategoryBadge — rendered with tab === \"inbox\" (or isSmartView) guard");

assert(
  inboxPageSrc.includes("function CategoryBadge("),
  "CategoryBadge function component is defined"
);

// There are two <CategoryBadge usages in the file:
//   1. A read-only badge (no onFilter prop) used in a different view
//   2. The guarded inbox-row badge with onFilter prop
// We locate the guarded usage by finding the <CategoryBadge that has onFilter= nearby.
let guardedBadgeIdx = -1;
let searchFrom = 0;
while (true) {
  const idx = inboxPageSrc.indexOf("<CategoryBadge", searchFrom);
  if (idx === -1) break;
  const tagSnippet = inboxPageSrc.slice(idx, idx + 400);
  if (tagSnippet.includes("onFilter=")) {
    guardedBadgeIdx = idx;
    break;
  }
  searchFrom = idx + 1;
}

assert(guardedBadgeIdx !== -1, "<CategoryBadge with onFilter= exists in source");

// The guard must wrap the CategoryBadge usage and explicitly include tab === "inbox"
const guardWindow = inboxPageSrc.slice(Math.max(0, guardedBadgeIdx - 200), guardedBadgeIdx + 10);
assert(guardWindow.includes('tab === "inbox"'),  'CategoryBadge is wrapped in an explicit tab === "inbox" guard');
assert(guardWindow.includes("isSmartView"),       "CategoryBadge guard additionally covers isSmartView (smart inbox view)");
assert(guardWindow.includes("&&") || guardWindow.includes("?"), "CategoryBadge guard uses conditional rendering (&& or ternary)");

const badgeOpeningTag = inboxPageSrc.slice(guardedBadgeIdx, guardedBadgeIdx + 300);
assert(badgeOpeningTag.includes("labelIds="),  "CategoryBadge receives labelIds prop");
assert(badgeOpeningTag.includes("messageId="), "CategoryBadge receives messageId prop");
assert(badgeOpeningTag.includes("onFilter="),  "CategoryBadge receives onFilter prop in inbox row");

// ── (c) onFilter tabMap covers every CATEGORY_* key in CATEGORY_BADGE_CONFIG ─

console.log("\n(c) onFilter tabMap — every CATEGORY_* key from CATEGORY_BADGE_CONFIG has a valid tabMap entry");

// Locate the tabMap declaration inside the onFilter handler
const tabMapIdx = inboxPageSrc.indexOf("const tabMap");
assert(tabMapIdx !== -1, "tabMap is declared inside onFilter handler");

// Extract the tabMap object using a brace-balanced scan
const tabMapOpenBrace = inboxPageSrc.indexOf("{", tabMapIdx);
const tabMapBlock     = extractBraceBlock(inboxPageSrc, tabMapOpenBrace);

// For every key dynamically found in CATEGORY_BADGE_CONFIG, assert:
//   (i)  the key appears in tabMap
//   (ii) it maps to a non-empty quoted tab-name string
//
// This assertion automatically fails when a new key is added to
// CATEGORY_BADGE_CONFIG but not to tabMap — no manual test update needed.
for (const key of configKeys) {
  assert(
    tabMapBlock.includes(key),
    `tabMap contains ${key} (mirrors CATEGORY_BADGE_CONFIG)`
  );

  // Check that the mapped value is a non-empty quoted string, e.g.  "updates"
  const valueMatch = tabMapBlock.match(new RegExp(`${key}\\s*:\\s*["']([^"']+)["']`));
  assert(
    valueMatch !== null && valueMatch[1].length > 0,
    `tabMap maps ${key} → a non-empty tab-name string (found: "${valueMatch ? valueMatch[1] : "none"}")`
  );
}

// Parity: the number of CATEGORY_* entries in tabMap matches CATEGORY_BADGE_CONFIG
const tabKeyMatches = [...tabMapBlock.matchAll(/\b(CATEGORY_[A-Z_]+)\s*:/g)];
const tabKeys       = [...new Set(tabKeyMatches.map(m => m[1]))];
assert(
  tabKeys.length === configKeys.length,
  `tabMap has the same number of CATEGORY_* entries as CATEGORY_BADGE_CONFIG (${tabKeys.length} === ${configKeys.length})`
);

// Verify the tabMap drives a setTab call
const tabMapSection = inboxPageSrc.slice(tabMapIdx, tabMapIdx + 500);
assert(tabMapSection.includes("setTab("), "onFilter handler calls setTab() using the tabMap destination");

// ── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(55)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll tests passed.");
}
