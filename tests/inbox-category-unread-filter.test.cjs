/**
 * inbox-category-unread-filter.test.cjs
 *
 * Regression test for: category sidebar tabs (Social/People/Updates/Promotions/Forums)
 * must send "is:unread" in their query so the list matches the badge count.
 *
 * Root cause: inboxCategoryQ for category tabs sent "in:social" (no is:unread).
 * Backend returned 50 newest Social messages (all read), while the badge counted
 * only UNREAD Social.  Result: Social badge=9, list showed "SEEN 1" (0 unread).
 *
 * Fix:
 *   1. inboxCategoryQ adds is:unread to all 5 category queries.
 *   2. loadMoreInbox uses inboxCategoryQ (not hardcoded "in:inbox") as its base.
 *   3. Effect A resets cursor+extras when inboxCategory changes (prevents cursor leak).
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const assert = require("assert");

let passed = 0;
let failed = 0;

function ok(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

const inboxPagePath = path.join(__dirname, "../client/src/pages/gmail-inbox.tsx");
const src = fs.readFileSync(inboxPagePath, "utf8");

// ── (a) inboxCategoryQ — all active categories send is:unread ────────────────
//
// NOTE: The code was refactored to aggregate categories:
//   "newsletters"   covers promotions + forums  → sends "in:inbox is:unread"
//   "notifications" covers updates  + social    → sends "in:inbox is:unread"
//   "people"                                    → sends "in:people is:unread"
// Every non-"all" category still sends is:unread; the query is just broader
// so client-side category filtering (getEmailCategory) can bucket the results.

console.log("\n(a) inboxCategoryQ — all category tabs include is:unread");

ok(
  src.includes('return "in:people is:unread"'),
  'inboxCategoryQ returns "in:people is:unread" for People tab'
);
ok(
  src.includes('return "in:newsletters is:unread"'),
  'inboxCategoryQ returns "in:newsletters is:unread" for Newsletters (promotions+forums) tab'
);
ok(
  src.includes('return "in:notifications is:unread"'),
  'inboxCategoryQ returns "in:notifications is:unread" for Notifications (updates+social) tab'
);
// SECTION_FETCH_QUERIES still issues per-category queries for smart-section fetches
ok(
  src.includes('"in:social is:unread"'),
  'SECTION_FETCH_QUERIES includes "in:social is:unread" for smart-section fetch'
);
ok(
  src.includes('"in:updates is:unread"') && src.includes('"in:promotions is:unread"') && src.includes('"in:forums is:unread"'),
  'SECTION_FETCH_QUERIES includes is:unread for updates, promotions, and forums smart-section fetches'
);

// Old bare queries (without is:unread) must not be present in inboxCategoryQ.
// Use narrow slice around the memo to avoid matching the SECTION_FETCH_QUERIES constants.
const inboxCategoryQStart = src.indexOf("const inboxCategoryQ = useMemo");
const inboxCategoryQEnd   = src.indexOf("}, [searchQuery, inboxCategory])", inboxCategoryQStart) + 50;
const inboxCategoryQBlock = src.slice(inboxCategoryQStart, inboxCategoryQEnd);

ok(
  !inboxCategoryQBlock.includes('"in:social"') || inboxCategoryQBlock.includes('"in:social is:unread"'),
  'inboxCategoryQ does NOT return bare "in:social" (must include is:unread)'
);
ok(
  !inboxCategoryQBlock.includes('"in:people"') || inboxCategoryQBlock.includes('"in:people is:unread"'),
  'inboxCategoryQ does NOT return bare "in:people" (must include is:unread)'
);
ok(
  !inboxCategoryQBlock.includes('"in:updates"') || inboxCategoryQBlock.includes('"in:updates is:unread"'),
  'inboxCategoryQ does NOT return bare "in:updates"'
);
ok(
  !inboxCategoryQBlock.includes('"in:promotions"') || inboxCategoryQBlock.includes('"in:promotions is:unread"'),
  'inboxCategoryQ does NOT return bare "in:promotions"'
);
ok(
  !inboxCategoryQBlock.includes('"in:forums"') || inboxCategoryQBlock.includes('"in:forums is:unread"'),
  'inboxCategoryQ does NOT return bare "in:forums"'
);

// The "all" inbox category must NOT add is:unread (it shows all mail)
ok(
  inboxCategoryQBlock.includes('return "in:inbox"'),
  'inboxCategoryQ default (all) returns "in:inbox" without is:unread'
);

// ── (b) loadMoreInbox — uses inboxCategoryQ not hardcoded "in:inbox" ─────────

console.log("\n(b) loadMoreInbox — uses inboxCategoryQ as base for page 2+");

const loadMoreStart = src.indexOf("const loadMoreInbox = async");
const loadMoreEnd   = src.indexOf("const loadMoreSent = async", loadMoreStart);
const loadMoreBlock = src.slice(loadMoreStart, loadMoreEnd);

// Must NOT use the old hardcoded pattern
ok(
  !loadMoreBlock.includes('const baseQ = searchQuery || "in:inbox"'),
  'loadMoreInbox does NOT use hardcoded "in:inbox" as baseQ (old bug removed)'
);

// Must use inboxCategoryQ for the non-unread path
ok(
  loadMoreBlock.includes("inboxCategoryQ"),
  'loadMoreInbox references inboxCategoryQ (mirrors page 1 query for category tabs)'
);

// The unread pill path must still use "in:inbox is:unread" (not category-scoped)
ok(
  loadMoreBlock.includes('"in:inbox is:unread"'),
  'loadMoreInbox uses "in:inbox is:unread" for crmFilter==="unread" path'
);

// Must set "q" param (not removed)
ok(
  loadMoreBlock.includes('params.set("q",') || loadMoreBlock.includes("params.set('q',"),
  'loadMoreInbox still sets q param'
);

// ── (c) Effect A reset — inboxCategory in dependency array ───────────────────

console.log("\n(c) Effect A — inboxCategory in reset dependency array");

const effectAStart = src.indexOf("setInboxExtra([]);");
// Read a generous window — the dep array is after multiple comment lines, needs ~900 chars
const effectABlock = src.slice(effectAStart, effectAStart + 900);

ok(
  effectABlock.includes("inboxCategory"),
  'Effect A dependency array includes inboxCategory (cursor reset on category switch)'
);
ok(
  effectABlock.includes("searchQuery") && effectABlock.includes("activeAccountId") && effectABlock.includes("crmFilter"),
  'Effect A still includes searchQuery, activeAccountId, crmFilter (existing deps preserved)'
);

// ── (d) buildQClauses — is:unread handled (backend parses it correctly) ──────

console.log("\n(d) buildQClauses — is:unread is parsed as is_unread = true");

const localMailboxPath = path.join(__dirname, "../server/services/local-mailbox.ts");
const lmSrc = fs.readFileSync(localMailboxPath, "utf8");

ok(
  lmSrc.includes("is:unread") && lmSrc.includes("is_unread = true"),
  'buildQClauses handles is:unread token → pushes is_unread = true SQL clause'
);

// The SOCIAL branch (else if label === "CATEGORY_SOCIAL") must add is_inbox + smart_category.
// Use the branch form, NOT the map entry form (SOCIAL: "CATEGORY_SOCIAL").
const socialBranchIdx = lmSrc.indexOf('label === "CATEGORY_SOCIAL"');
const socialBranchSnip = lmSrc.slice(socialBranchIdx, socialBranchIdx + 200);
ok(
  socialBranchSnip.includes("is_inbox = true") && socialBranchSnip.includes("smart_category = 'social'"),
  'CATEGORY_SOCIAL branch adds is_inbox=true AND smart_category=\'social\''
);

// ── (e) badge SQL — still uses is_unread (regression: must not be removed) ───

console.log("\n(e) category-counts badge SQL — still uses is_unread = true filter");

const routesSrc = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");

const ccIdx = routesSrc.indexOf("social_unread");
ok(ccIdx !== -1, "category-counts endpoint has social_unread column");
const ccBlock = routesSrc.slice(ccIdx - 200, ccIdx + 400);
ok(
  ccBlock.includes("is_inbox = true") && ccBlock.includes("is_unread = true") && ccBlock.includes("smart_category = 'social'"),
  "social_unread badge SQL uses is_inbox=true AND is_unread=true AND smart_category='social'"
);

const ppIdx = routesSrc.indexOf("people_unread");
ok(ppIdx !== -1, "category-counts endpoint has people_unread column");
const ppBlock = routesSrc.slice(ppIdx - 200, ppIdx + 400);
ok(
  ppBlock.includes("is_inbox = true") && ppBlock.includes("is_unread = true"),
  "people_unread badge SQL uses is_inbox=true AND is_unread=true"
);

// ── (f) SECTION_FETCH_QUERIES — loadAllForSection already uses is:unread ─────

console.log("\n(f) loadAllForSection — SECTION_FETCH_QUERIES already include is:unread");

ok(
  src.includes('"in:people is:unread"') && src.includes('"in:promotions is:unread"'),
  'SECTION_FETCH_QUERIES uses is:unread for People and Promotions sections'
);
ok(
  src.includes('"in:social is:unread"') && src.includes('"in:updates is:unread"') && src.includes('"in:forums is:unread"'),
  'SECTION_FETCH_QUERIES uses is:unread for Social, Updates, Forums sections'
);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll tests passed.");
}
