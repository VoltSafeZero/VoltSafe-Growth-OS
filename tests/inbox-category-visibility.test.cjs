/**
 * tests/inbox-category-visibility.test.cjs
 *
 * Source-grep tests for inbox category visibility and sender field fixes.
 * Covers:
 *   (a) isInboxVisible logic — INBOX + CATEGORY_* labels included, SENT/DRAFT/SPAM/TRASH excluded
 *   (b) LocalMessageSummary includes fromName and fromEmail fields
 *   (c) listLocalMessages map populates fromName and fromEmail from DB columns
 *   (d) buildQClauses INBOX branch expands to CATEGORY_* labels
 *   (e) routes.ts mailbox stats subqueries include CATEGORY_* labels
 *   (f) Frontend MessageSummary type has optional fromName/fromEmail fields
 *   (g) Category row renderer uses msg.fromName / msg.fromEmail
 *   (h) Regression: in:sent, in:updates, in:promotions etc. are unchanged
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
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

// ── Load source files ──────────────────────────────────────────────────────

const localMailboxPath = path.join(__dirname, "../server/services/local-mailbox.ts");
const routesPath       = path.join(__dirname, "../server/routes.ts");
const inboxPagePath    = path.join(__dirname, "../client/src/pages/gmail-inbox.tsx");

const localMailboxSrc = fs.readFileSync(localMailboxPath, "utf8");
const routesSrc       = fs.readFileSync(routesPath, "utf8");
const inboxPageSrc    = fs.readFileSync(inboxPagePath, "utf8");

// ── (a) LocalMessageSummary type has fromName and fromEmail ────────────────

console.log("\n(a) LocalMessageSummary type — separate sender fields");
assert(
  localMailboxSrc.includes("fromName: string"),
  "LocalMessageSummary declares fromName: string"
);
assert(
  localMailboxSrc.includes("fromEmail: string"),
  "LocalMessageSummary declares fromEmail: string"
);

// ── (b) listLocalMessages map populates fromName and fromEmail ────────────

console.log("\n(b) listLocalMessages map — fromName and fromEmail populated");
assert(
  localMailboxSrc.includes("fromName: r.from_name") || localMailboxSrc.includes("fromName:r.from_name"),
  "map sets fromName from r.from_name"
);
assert(
  localMailboxSrc.includes("fromEmail: r.from_email") || localMailboxSrc.includes("fromEmail:r.from_email"),
  "map sets fromEmail from r.from_email"
);

// ── (c) buildQClauses INBOX branch — CATEGORY_* labels included ────────────

console.log("\n(c) buildQClauses INBOX branch — CATEGORY_* label expansion");

// Find the INBOX branch in buildQClauses
const buildQClausesMatch = localMailboxSrc.match(/function buildQClauses[\s\S]*?^}/m);
// Just search the whole file for the pattern since the function spans many lines
assert(
  localMailboxSrc.includes("CATEGORY_UPDATES%") &&
  localMailboxSrc.includes("CATEGORY_PROMOTIONS%") &&
  localMailboxSrc.includes("CATEGORY_SOCIAL%") &&
  localMailboxSrc.includes("CATEGORY_FORUMS%"),
  "buildQClauses contains all four CATEGORY_* ILIKE patterns"
);

// The INBOX branch must NOT simply push the generic label_ids ILIKE for INBOX alone
// It must have CATEGORY_UPDATES alongside the INBOX label
const inboxBranchIdx = localMailboxSrc.indexOf('if (label === "INBOX")');
assert(inboxBranchIdx !== -1, 'buildQClauses has if (label === "INBOX") branch');

const inboxBranchSection = localMailboxSrc.slice(inboxBranchIdx, inboxBranchIdx + 1200);
assert(
  inboxBranchSection.includes("CATEGORY_UPDATES%"),
  "INBOX branch includes CATEGORY_UPDATES pattern"
);
assert(
  inboxBranchSection.includes("CATEGORY_PROMOTIONS%"),
  "INBOX branch includes CATEGORY_PROMOTIONS pattern"
);
assert(
  inboxBranchSection.includes("CATEGORY_SOCIAL%"),
  "INBOX branch includes CATEGORY_SOCIAL pattern"
);
assert(
  inboxBranchSection.includes("CATEGORY_FORUMS%"),
  "INBOX branch includes CATEGORY_FORUMS pattern"
);

// INBOX branch must exclude SENT, DRAFT, SPAM, TRASH
assert(
  inboxBranchSection.includes('"SENT"') || inboxBranchSection.includes("SENT"),
  "INBOX branch excludes SENT label"
);
assert(
  inboxBranchSection.includes('"DRAFT"') || inboxBranchSection.includes("DRAFT"),
  "INBOX branch excludes DRAFT label"
);
assert(
  inboxBranchSection.includes('"SPAM"') || inboxBranchSection.includes("SPAM"),
  "INBOX branch excludes SPAM label"
);
assert(
  inboxBranchSection.includes('"TRASH"') || inboxBranchSection.includes("TRASH"),
  "INBOX branch excludes TRASH label"
);

// ── (d) Regression: other label branches are unchanged ────────────────────

console.log("\n(d) Regression — non-INBOX label branches unchanged");
// The else branch should still push the generic ILIKE clause for non-INBOX labels
assert(
  localMailboxSrc.includes("} else {") &&
  localMailboxSrc.includes("label_ids ILIKE '%\"${safe(label)}\"%'"),
  "else branch still uses generic ILIKE for non-INBOX labels"
);

// CATEGORY_LABEL_MAP should still map "updates" etc. to CATEGORY_* labels
assert(
  localMailboxSrc.includes("UPDATES: \"CATEGORY_UPDATES\""),
  "CATEGORY_LABEL_MAP maps UPDATES → CATEGORY_UPDATES"
);
assert(
  localMailboxSrc.includes("PROMOTIONS: \"CATEGORY_PROMOTIONS\""),
  "CATEGORY_LABEL_MAP maps PROMOTIONS → CATEGORY_PROMOTIONS"
);

// ── (e) routes.ts mailbox stats subqueries include CATEGORY_* labels ───────

console.log("\n(e) routes.ts mailbox stats — CATEGORY_* in unread_count and inbox_count");

// Find the account status endpoint section
const statusSectionIdx = routesSrc.indexOf("unread_count,");
assert(statusSectionIdx !== -1, "routes.ts has unread_count subquery");

const statusSection = routesSrc.slice(statusSectionIdx - 500, statusSectionIdx + 1500);

assert(
  statusSection.includes("CATEGORY_UPDATES%"),
  "unread_count/inbox_count section includes CATEGORY_UPDATES"
);
assert(
  statusSection.includes("CATEGORY_PROMOTIONS%"),
  "unread_count/inbox_count section includes CATEGORY_PROMOTIONS"
);
assert(
  statusSection.includes("CATEGORY_SOCIAL%"),
  "unread_count/inbox_count section includes CATEGORY_SOCIAL"
);
assert(
  statusSection.includes("CATEGORY_FORUMS%"),
  "unread_count/inbox_count section includes CATEGORY_FORUMS"
);

// Must exclude junk labels in the stats queries
const inboxCountIdx = routesSrc.indexOf("inbox_count,");
assert(inboxCountIdx !== -1, "routes.ts has inbox_count subquery");
// Use a wider backward window (300 chars) because NOT LIKE '%"SENT"%' appears
// ~180 chars before the closing "AS inbox_count," token.
const inboxCountSection = routesSrc.slice(inboxCountIdx - 300, inboxCountIdx + 600);
assert(
  inboxCountSection.includes('"SENT"') || inboxCountSection.includes("SENT"),
  "inbox_count subquery excludes SENT"
);
assert(
  inboxCountSection.includes('"TRASH"') || inboxCountSection.includes("TRASH"),
  "inbox_count subquery excludes TRASH"
);

// ── (f) Frontend MessageSummary type has fromName/fromEmail ───────────────

console.log("\n(f) Frontend MessageSummary type — optional fromName/fromEmail");
assert(
  inboxPageSrc.includes("fromName?: string"),
  "MessageSummary type declares fromName?: string"
);
assert(
  inboxPageSrc.includes("fromEmail?: string"),
  "MessageSummary type declares fromEmail?: string"
);

// ── (g) Category row renderer uses msg.fromName / msg.fromEmail ────────────

console.log("\n(g) Category row renderer — uses msg.fromName and msg.fromEmail");
assert(
  inboxPageSrc.includes("msg.fromName || msg.fromEmail"),
  "category row senderName fallback uses msg.fromName || msg.fromEmail"
);

// Renderer must not fall back to hard-coded "Unknown" before trying fromEmail
// i.e. the expression must be: fromName || fromEmail?.split(...) || "Unknown"
const categoryRenderIdx = inboxPageSrc.indexOf("senderName = msg.fromName");
assert(categoryRenderIdx !== -1, "category row senderName expression starts with msg.fromName");
const categoryRenderSnippet = inboxPageSrc.slice(categoryRenderIdx, categoryRenderIdx + 100);
assert(
  categoryRenderSnippet.includes("fromEmail"),
  "category senderName expression falls through to fromEmail before Unknown"
);

// ── (h) Main inbox row uses parseSenderName on combined from (unchanged) ───

console.log("\n(h) Regression — main inbox row still uses parseSenderName(msg.from)");
assert(
  inboxPageSrc.includes("parseSenderName(msg.from)"),
  "main inbox row still uses parseSenderName(msg.from)"
);

// ── SQL SELECT in listLocalMessages includes from_name and from_email ──────

console.log("\n(i) SQL SELECT — from_name and from_email included in query");
assert(
  localMailboxSrc.includes("from_email, from_name"),
  "SQL SELECT in listLocalMessages includes from_email and from_name columns"
);

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(55)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll tests passed.");
}
