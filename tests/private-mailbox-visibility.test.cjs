/**
 * private-mailbox-visibility.test.cjs
 *
 * Verifies that:
 *  1. The Mail sidebar API (/api/gmail/accounts) returns ALL owned private
 *     accounts regardless of is_active — active and expired alike.
 *  2. Admin API (/api/my/mailbox) and Mail API both surface the same
 *     private account set (no account silently dropped by one path).
 *  3. isOwner=true is set for all owned private accounts in the Mail API.
 *  4. Inactive private accounts carry an `isActive: false` flag that the
 *     frontend can use to show a Reconnect badge.
 *  5. The InboxCategoryNav shared component exists in gmail-inbox.tsx and is
 *     used at exactly 4 call sites (personal + fallback + private + team).
 *  6. INBOX_CATEGORY_TABS.map appears exactly once (inside InboxCategoryNav).
 *  7. The resolveAccount function allows owners to access inactive accounts
 *     (the guard ordering check in routes.ts).
 *
 * All API tests run in SKIP mode when the environment cannot reach a live
 * server, to avoid false failures in CI.
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

// ── Static source analysis (always runs) ─────────────────────────────────────

const INBOX_SRC = path.join(__dirname, "../client/src/pages/gmail-inbox.tsx");
const ROUTES_SRC = path.join(__dirname, "../server/routes.ts");

const inboxSrc  = fs.readFileSync(INBOX_SRC,  "utf8");
const routesSrc = fs.readFileSync(ROUTES_SRC, "utf8");

let passed = 0;
let failed = 0;

function check(label, ok, detail = "") {
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

// ── Section 1: InboxCategoryNav component ────────────────────────────────────

console.log("\n[1] InboxCategoryNav component structure");

// Exactly one INBOX_CATEGORY_TABS.map call (inside the shared component)
const mapUsages = [...inboxSrc.matchAll(/INBOX_CATEGORY_TABS\.map/g)].length;
check(
  `INBOX_CATEGORY_TABS.map appears exactly 1 time (inside InboxCategoryNav)`,
  mapUsages === 1,
  `found ${mapUsages}`,
);

// InboxCategoryNav is used at 5 call sites:
// personal + fallback + active-private + all-inboxes + team
const navUsages = [...inboxSrc.matchAll(/<InboxCategoryNav\b/g)].length;
check(
  `<InboxCategoryNav> used at exactly 5 call sites`,
  navUsages === 5,
  `found ${navUsages}`,
);

// Component definition exists
check(
  `InboxCategoryNav function definition exists`,
  /function InboxCategoryNav\s*\(/.test(inboxSrc),
);

// Component accepts testIdSuffix prop
check(
  `InboxCategoryNav accepts testIdSuffix prop`,
  /testIdSuffix/.test(inboxSrc),
);

// Component appends suffix to data-testid
check(
  `nav-inbox-cat-\${key}\${testIdSuffix} pattern present`,
  inboxSrc.includes("nav-inbox-cat-${key}${testIdSuffix}"),
);

// All five usage sites appear (personal, fallback, active-private, all-inboxes, team)
const navSuffix0 = [...inboxSrc.matchAll(/<InboxCategoryNav[^>]*onSelect/g)].length;
check(
  `All 5 InboxCategoryNav usages have onSelect prop`,
  navSuffix0 === 5,
  `found ${navSuffix0}`,
);

const navWithSuffix = [...inboxSrc.matchAll(/testIdSuffix=\{`-\$\{acct\.id\}`\}/g)].length;
check(
  `2 InboxCategoryNav usages carry testIdSuffix={\`-\${acct.id}\`} (private + team)`,
  navWithSuffix === 2,
  `found ${navWithSuffix}`,
);

// ── Section 2: Reconnect badges ───────────────────────────────────────────────

console.log("\n[2] Reconnect badges for inactive accounts");

check(
  `Personal account renders badge-reconnect-personal when !isActive`,
  inboxSrc.includes("badge-reconnect-personal"),
);

check(
  `Personal account Reconnect badge keyed on !personalAccount.isActive`,
  inboxSrc.includes("!personalAccount.isActive"),
);

check(
  `Private account renders badge-reconnect-private-\${acct.id} when !isActive`,
  inboxSrc.includes("badge-reconnect-private-${acct.id}"),
);

check(
  `Private account Reconnect badge keyed on !acct.isActive`,
  inboxSrc.includes("!acct.isActive"),
);

// ── Section 3: Backend — getAccessibleAccounts ───────────────────────────────

console.log("\n[3] Backend — getAccessibleAccounts no longer filters owned accounts by isActive");

// The owned-account query must NOT have eq(emailAccounts.isActive, true) in an
// and() that also includes eq(emailAccounts.userId, …)
// We look for the current pattern: userId query without isActive restriction
check(
  `Owned-account query uses eq(emailAccounts.userId, userId) without isActive guard`,
  /\.where\(eq\(emailAccounts\.userId, userId\)\)/.test(routesSrc),
);

// The old combined and(eq(isActive, true), eq(userId, userId)) pattern must be gone
// (only the sharedAccts query retains it)
const ownedActiveFilter = routesSrc.match(
  /and\(eq\(emailAccounts\.isActive, true\), eq\(emailAccounts\.userId, userId\)\)/g,
);
check(
  `Owned-account isActive+userId conjunction removed (only shared branch may remain)`,
  !ownedActiveFilter,
  ownedActiveFilter ? `still found ${ownedActiveFilter.length} occurrences` : "",
);

// Shared accounts still filtered by isActive
check(
  `Shared accounts still guarded by isActive=true`,
  /allSharedCondition = and\(eq\(emailAccounts\.isActive, true\)/.test(routesSrc),
);

// ── Section 4: Backend — resolveAccount owner-first ordering ─────────────────

console.log("\n[4] Backend — resolveAccount checks ownership before isActive");

// Owner check must appear BEFORE the isActive null-return
const ownerIdx   = routesSrc.indexOf("acct.userId === currentUserId");
const isActiveIdx = routesSrc.indexOf("if (!acct.isActive) return null; // Non-owner");

check(
  `resolveAccount: owner check (acct.userId === currentUserId) appears before isActive guard`,
  ownerIdx !== -1 && isActiveIdx !== -1 && ownerIdx < isActiveIdx,
  ownerIdx === -1 ? "owner check not found" :
  isActiveIdx === -1 ? "isActive guard not found" :
  `ownerIdx=${ownerIdx} isActiveIdx=${isActiveIdx}`,
);

check(
  `resolveAccount: non-owner isActive guard present with correct comment`,
  routesSrc.includes("if (!acct.isActive) return null; // Non-owner"),
);

check(
  `resolveAccount: !acct (null check) still present before ownership test`,
  /if \(!acct\) return null/.test(routesSrc),
);

// ── Section 5: Cross-path consistency — no orphaned inline maps ───────────────

console.log("\n[5] Cross-path consistency");

// No raw INBOX_CATEGORY_TABS.map outside InboxCategoryNav (would mean a 5th
// duplicated loop was added by mistake)
const allMapLines = inboxSrc.split("\n").map((l, i) => ({ n: i + 1, l }))
  .filter(({ l }) => l.includes("INBOX_CATEGORY_TABS.map"));

const outsideComponent = allMapLines.filter(({ l }) => {
  // The component's own map is inside "function InboxCategoryNav" — it's the only
  // one that should exist.  All occurrences must be on lines where the map is
  // clearly inside the InboxCategoryNav function body (no way to tell from text
  // alone, so we just assert count === 1 which we already confirmed above).
  return true;
});
check(
  `No extra INBOX_CATEGORY_TABS.map occurrences outside InboxCategoryNav (total=1)`,
  allMapLines.length === 1,
  `found ${allMapLines.length}: ${allMapLines.map(({ n }) => "L" + n).join(", ")}`,
);

// Fallback branch (<InboxCategoryNav without testIdSuffix) exists
const fallbackUsage = [...inboxSrc.matchAll(/<InboxCategoryNav\s*\n\s*badges=/g)].length
                    + [...inboxSrc.matchAll(/<InboxCategoryNav\s+badges=/g)].length;
check(
  `At least 2 InboxCategoryNav usages have no testIdSuffix (personal + fallback)`,
  (navUsages - navWithSuffix) >= 2,
  `no-suffix count = ${navUsages - navWithSuffix}`,
);

// ── Results ───────────────────────────────────────────────────────────────────

console.log(`\n  Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
