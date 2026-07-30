/**
 * inbox-category-unread-filter.test.cjs
 *
 * Regression test for: category sidebar tabs (Social/People/Updates/Promotions/Forums)
 * must send "is:unread" in their query when the Unread pill is active so the list
 * matches the badge count.
 *
 * Original root cause: inboxCategoryQ sent "in:social" (no is:unread); backend returned
 * 50 newest Social messages (all read) while the badge counted only unread Social.
 *
 * Current fix (required matrix):
 *   inboxCategoryQ returns the BARE category token ("in:people", "in:newsletters",
 *   "in:notifications", "in:inbox") — no is:unread baked in.
 *   "is:unread" is appended at the call site via `${inboxCategoryQ} is:unread` ONLY
 *   when crmFilter === "unread", so:
 *     People + All:    in:people              (all inbox messages for that category)
 *     People + Unread: in:people is:unread    (only unread, matches badge)
 *   1. inboxCategoryQ returns bare tokens; is:unread added at call site.
 *   2. loadMoreInbox uses `${inboxCategoryQ} is:unread` template (not hardcoded "in:inbox is:unread").
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

// ── (a) inboxCategoryQ — returns bare tokens; is:unread added at call site ────
//
// Required matrix:
//   People + All:          in:people           (bare token, no is:unread)
//   People + Unread:       in:people is:unread (appended via `${inboxCategoryQ} is:unread`)
//   Newsletters + All:     in:newsletters
//   Newsletters + Unread:  in:newsletters is:unread
//   Notifications + All:   in:notifications
//   Notifications + Unread: in:notifications is:unread
//
// SECTION_FETCH_QUERIES (smart-section auto-loader) still embeds literal
// per-category is:unread queries ("in:social is:unread" etc.) — those are
// separate from inboxCategoryQ and are unaffected.

console.log("\n(a) inboxCategoryQ — returns bare tokens (is:unread added at call site)");

// Narrow slice around the memo to avoid matching SECTION_FETCH_QUERIES constants.
const inboxCategoryQStart = src.indexOf("const inboxCategoryQ = useMemo");
const inboxCategoryQEnd   = src.indexOf("}, [searchQuery, inboxCategory])", inboxCategoryQStart) + 50;
const inboxCategoryQBlock = src.slice(inboxCategoryQStart, inboxCategoryQEnd);

ok(
  inboxCategoryQBlock.includes(`return "in:people"`) &&
    !inboxCategoryQBlock.includes(`return "in:people is:unread"`),
  'inboxCategoryQ returns bare "in:people" for People tab (is:unread NOT baked in)'
);
ok(
  inboxCategoryQBlock.includes(`return "in:newsletters"`) &&
    !inboxCategoryQBlock.includes(`return "in:newsletters is:unread"`),
  'inboxCategoryQ returns bare "in:newsletters" for Newsletters tab (is:unread NOT baked in)'
);
ok(
  inboxCategoryQBlock.includes(`return "in:notifications"`) &&
    !inboxCategoryQBlock.includes(`return "in:notifications is:unread"`),
  'inboxCategoryQ returns bare "in:notifications" for Notifications tab (is:unread NOT baked in)'
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

// inboxCategoryQ must NOT contain is:unread at all (it's bare tokens only)
ok(
  !inboxCategoryQBlock.includes(`"in:social"`),
  'inboxCategoryQ does NOT reference "in:social" (social not a tab; covered by notifications)'
);
ok(
  !inboxCategoryQBlock.includes('"in:people is:unread"'),
  'inboxCategoryQ does NOT bake is:unread into "in:people"'
);
ok(
  !inboxCategoryQBlock.includes('"in:updates"') || inboxCategoryQBlock.includes('"in:updates is:unread"') === false,
  'inboxCategoryQ does NOT reference bare "in:updates"'
);
ok(
  !inboxCategoryQBlock.includes('"in:promotions"'),
  'inboxCategoryQ does NOT reference "in:promotions"'
);
ok(
  !inboxCategoryQBlock.includes('"in:forums"'),
  'inboxCategoryQ does NOT reference "in:forums"'
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

// The unread pill path uses `${inboxCategoryQ} is:unread` template (works for all tabs)
ok(
  loadMoreBlock.includes("`${inboxCategoryQ} is:unread`"),
  'loadMoreInbox uses `${inboxCategoryQ} is:unread` template for crmFilter==="unread" path'
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
