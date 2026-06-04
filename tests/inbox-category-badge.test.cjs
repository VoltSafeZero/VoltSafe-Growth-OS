/**
 * tests/inbox-category-badge.test.cjs
 *
 * Source-grep tests for CategoryBadge component rendering in gmail-inbox.tsx.
 * Covers:
 *   (a) CATEGORY_BADGE_CONFIG map contains all four category keys
 *   (b) CategoryBadge is rendered inside the inbox row with a tab === "inbox" guard
 *   (c) onFilter tabMap covers all four CATEGORY_* → tab-name mappings
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

// ── Load source file ────────────────────────────────────────────────────────

const inboxPagePath = path.join(__dirname, "../client/src/pages/gmail-inbox.tsx");
const inboxPageSrc  = fs.readFileSync(inboxPagePath, "utf8");

// ── (a) CATEGORY_BADGE_CONFIG contains all four category keys ───────────────

console.log("\n(a) CATEGORY_BADGE_CONFIG — all four category keys present");

assert(
  inboxPageSrc.includes("CATEGORY_BADGE_CONFIG"),
  "CATEGORY_BADGE_CONFIG map is declared"
);

assert(
  inboxPageSrc.includes("CATEGORY_UPDATES:"),
  "CATEGORY_BADGE_CONFIG contains CATEGORY_UPDATES key"
);

assert(
  inboxPageSrc.includes("CATEGORY_PROMOTIONS:"),
  "CATEGORY_BADGE_CONFIG contains CATEGORY_PROMOTIONS key"
);

assert(
  inboxPageSrc.includes("CATEGORY_SOCIAL:"),
  "CATEGORY_BADGE_CONFIG contains CATEGORY_SOCIAL key"
);

assert(
  inboxPageSrc.includes("CATEGORY_FORUMS:"),
  "CATEGORY_BADGE_CONFIG contains CATEGORY_FORUMS key"
);

// All four must appear within the same CATEGORY_BADGE_CONFIG block
const configBlockIdx = inboxPageSrc.indexOf("CATEGORY_BADGE_CONFIG");
assert(configBlockIdx !== -1, "CATEGORY_BADGE_CONFIG block located in source");

const configBlock = inboxPageSrc.slice(configBlockIdx, configBlockIdx + 600);
assert(
  configBlock.includes("CATEGORY_UPDATES:") &&
  configBlock.includes("CATEGORY_PROMOTIONS:") &&
  configBlock.includes("CATEGORY_SOCIAL:") &&
  configBlock.includes("CATEGORY_FORUMS:"),
  "all four CATEGORY_* keys appear together inside CATEGORY_BADGE_CONFIG"
);

// Each key must have a label and className entry
assert(
  configBlock.includes('label: "Updates"'),
  "CATEGORY_UPDATES entry has label: \"Updates\""
);
assert(
  configBlock.includes('label: "Promotions"'),
  "CATEGORY_PROMOTIONS entry has label: \"Promotions\""
);
assert(
  configBlock.includes('label: "Social"'),
  "CATEGORY_SOCIAL entry has label: \"Social\""
);
assert(
  configBlock.includes('label: "Forums"'),
  "CATEGORY_FORUMS entry has label: \"Forums\""
);

// ── (b) CategoryBadge rendered inside the inbox row with tab guard ───────────

console.log("\n(b) CategoryBadge — rendered with tab === \"inbox\" (or isSmartView) guard");

assert(
  inboxPageSrc.includes("function CategoryBadge("),
  "CategoryBadge function component is defined"
);

// Locate the JSX usage of CategoryBadge
const badgeUsageIdx = inboxPageSrc.indexOf("<CategoryBadge");
assert(badgeUsageIdx !== -1, "<CategoryBadge JSX element exists in source");

// The guard must wrap the CategoryBadge usage and explicitly include tab === "inbox"
// Look within reasonable proximity before the <CategoryBadge tag
const guardWindow = inboxPageSrc.slice(Math.max(0, badgeUsageIdx - 200), badgeUsageIdx + 10);
assert(
  guardWindow.includes('tab === "inbox"'),
  'CategoryBadge is wrapped in an explicit tab === "inbox" guard'
);

// The combined guard may also include isSmartView
assert(
  guardWindow.includes("isSmartView"),
  "CategoryBadge guard additionally covers isSmartView (smart inbox view)"
);

// The guard must use a conditional rendering pattern ( && or ternary )
assert(
  guardWindow.includes("&&") || guardWindow.includes("?"),
  "CategoryBadge guard uses conditional rendering (&& or ternary)"
);

// CategoryBadge must receive labelIds prop
const badgeOpeningTag = inboxPageSrc.slice(badgeUsageIdx, badgeUsageIdx + 300);
assert(
  badgeOpeningTag.includes("labelIds="),
  "CategoryBadge receives labelIds prop"
);

// CategoryBadge must receive messageId prop
assert(
  badgeOpeningTag.includes("messageId="),
  "CategoryBadge receives messageId prop"
);

// CategoryBadge must receive onFilter prop in its inbox-row usage
assert(
  badgeOpeningTag.includes("onFilter="),
  "CategoryBadge receives onFilter prop in inbox row"
);

// ── (c) onFilter tabMap covers all four CATEGORY_* → tab-name mappings ──────

console.log("\n(c) onFilter tabMap — all four CATEGORY_* → tab name entries");

// Locate the tabMap declaration inside the onFilter handler
const tabMapIdx = inboxPageSrc.indexOf("const tabMap");
assert(tabMapIdx !== -1, "tabMap is declared inside onFilter handler");

const tabMapBlock = inboxPageSrc.slice(tabMapIdx, tabMapIdx + 400);

assert(
  tabMapBlock.includes("CATEGORY_UPDATES"),
  "tabMap contains CATEGORY_UPDATES entry"
);
assert(
  tabMapBlock.includes("CATEGORY_PROMOTIONS"),
  "tabMap contains CATEGORY_PROMOTIONS entry"
);
assert(
  tabMapBlock.includes("CATEGORY_SOCIAL"),
  "tabMap contains CATEGORY_SOCIAL entry"
);
assert(
  tabMapBlock.includes("CATEGORY_FORUMS"),
  "tabMap contains CATEGORY_FORUMS entry"
);

// Verify correct tab-name values
assert(
  tabMapBlock.includes('"updates"') || tabMapBlock.includes("'updates'"),
  "tabMap maps CATEGORY_UPDATES → \"updates\""
);
assert(
  tabMapBlock.includes('"promotions"') || tabMapBlock.includes("'promotions'"),
  "tabMap maps CATEGORY_PROMOTIONS → \"promotions\""
);
assert(
  tabMapBlock.includes('"social"') || tabMapBlock.includes("'social'"),
  "tabMap maps CATEGORY_SOCIAL → \"social\""
);
assert(
  tabMapBlock.includes('"forums"') || tabMapBlock.includes("'forums'"),
  "tabMap maps CATEGORY_FORUMS → \"forums\""
);

// tabMap must drive a setTab call
const tabMapSection = inboxPageSrc.slice(tabMapIdx, tabMapIdx + 500);
assert(
  tabMapSection.includes("setTab("),
  "onFilter handler calls setTab() using the tabMap destination"
);

// ── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(55)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll tests passed.");
}
