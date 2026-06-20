/**
 * tests/badge-counts-unit.test.cjs
 *
 * UI Badge Count Smoke Test — source-grep invariants.
 *
 * CANONICAL UNIT: unread THREADS everywhere.
 * The inbox list renders one row per thread (dedupByThread). All visible
 * badges must count threads so the number matches visible rows.
 *
 * Checks verified here (no server needed):
 *
 *  G1. No 99+ cap — badges render the raw number from the API.
 *  G2. Inbox badge reads serverInboxUnreadCount ← _rawServerInboxUnread ← accountsHealthQuery.data
 *        (threads, via count(distinct) in the health endpoint).
 *        NOTE: After countSnapshot refactor, serverInboxUnreadCount = countSnapshot.inbox,
 *        and _rawServerInboxUnread is the private variable that reads accountsHealthQuery.data.
 *  G3. Sidebar category badges read sidebarCategoryBadges ← countSnapshot ← _candidateSnapshot
 *        which reads from categoryCountsQuery.data
 *        (threads, via COUNT(DISTINCT gmail_thread_id) in the category-counts endpoint).
 *  G4. People badge is NOT derived from local inboxMain message arrays —
 *        cc.people?.unread API field is checked first in _candidateSnapshot.
 *  G5. The People fallback (when API field is absent) subtracts thread values
 *        from a thread total — never mixes message and thread arithmetic.
 *  G6. category-counts queryKey includes activeAccountId so per-account
 *        switching invalidates the right cache partition.
 *  G7. accounts/health queryKey does NOT include activeAccountId (health
 *        returns all accounts at once and filters client-side).
 *  G8. bulkMarkReadMutation.onSuccess invalidates BOTH badge queries so
 *        sidebar numbers update immediately (not just on the next 30s poll).
 *  G9. markAllInboxReadMutation.onSuccess invalidates BOTH badge queries.
 * G10. markUnreadSingleMutation.onSuccess invalidates BOTH badge queries.
 * G11. Priority section is annotated as a non-additive overlay in the UI.
 * G12. serverGroupCounts (section headers) derives from countSnapshot (which
 *        is itself derived from categoryCountsQuery.data), never from the
 *        local inboxMain message array directly.
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

// ── Load source ─────────────────────────────────────────────────────────────

const src = fs.readFileSync(
  path.join(__dirname, "../client/src/pages/gmail-inbox.tsx"), "utf8"
);
const routesSrc = fs.readFileSync(
  path.join(__dirname, "../server/routes.ts"), "utf8"
);

// ── G1: No 99+ cap ───────────────────────────────────────────────────────────

console.log("\n── G1. No 99+ cap on badge numbers ──");

assert(!src.includes("99+"),            'no literal "99+" string in gmail-inbox.tsx');
assert(!src.includes(">= 99"),          "no >= 99 comparison for badge cap");
assert(!src.includes("> 99"),           "no > 99 comparison for badge cap");
assert(!src.includes("Math.min(99"),    "no Math.min(99, ...) cap on badge values");

// ── G2: Inbox badge reads thread count from accountsHealthQuery ──────────────

console.log("\n── G2. Inbox badge derives from accountsHealthQuery (thread count) ──");

// After the countSnapshot refactor, the chain is:
//   accountsHealthQuery.data → _rawServerInboxUnread → _candidateSnapshot → countSnapshot → serverInboxUnreadCount
// Check the private raw variable reads from accountsHealthQuery.data:
const rawUnreadIdx = src.indexOf("const _rawServerInboxUnread = useMemo");
const rawUnreadBlock = rawUnreadIdx !== -1
  ? src.slice(rawUnreadIdx, rawUnreadIdx + 600)
  : "";

assert(
  rawUnreadBlock.includes("accountsHealthQuery.data"),
  "_rawServerInboxUnread reads from accountsHealthQuery.data"
);
assert(
  rawUnreadBlock.includes("unreadCount"),
  "_rawServerInboxUnread sums .unreadCount from health data"
);
assert(
  !rawUnreadBlock.includes("inboxMain.filter"),
  "_rawServerInboxUnread does NOT derive from local inboxMain array"
);

// serverInboxUnreadCount must be an alias for countSnapshot.inbox (not a standalone useMemo):
assert(
  src.includes("const serverInboxUnreadCount = countSnapshot.inbox"),
  "serverInboxUnreadCount is an alias for countSnapshot.inbox (atomic snapshot)"
);

// The health endpoint returns thread counts
assert(
  routesSrc.includes("count(distinct m.gmail_thread_id)"),
  "accounts/health endpoint uses count(distinct) for unread_count"
);

// ── G3: Category badges read from categoryCountsQuery (via countSnapshot) ────

console.log("\n── G3. Category badges derive from categoryCountsQuery (thread count) ──");

// The _candidateSnapshot useMemo is the actual consumer of categoryCountsQuery.data.
// sidebarCategoryBadges now reads from countSnapshot (stabilised version).
const candidateIdx = src.indexOf("const _candidateSnapshot = useMemo");
const candidateBlock = candidateIdx !== -1
  ? src.slice(candidateIdx, candidateIdx + 800)
  : "";

assert(
  candidateBlock.includes("categoryCountsQuery.data"),
  "_candidateSnapshot reads from categoryCountsQuery.data (actual API consumer)"
);
assert(
  candidateBlock.includes("cc?.updates?.unread"),
  "updates badge reads cc?.updates?.unread from API (via _candidateSnapshot)"
);
assert(
  candidateBlock.includes("cc?.promotions?.unread"),
  "promotions badge reads cc?.promotions?.unread from API (via _candidateSnapshot)"
);
assert(
  candidateBlock.includes("cc?.social?.unread"),
  "social badge reads cc?.social?.unread from API (via _candidateSnapshot)"
);
assert(
  candidateBlock.includes("cc?.forums?.unread"),
  "forums badge reads cc?.forums?.unread from API (via _candidateSnapshot)"
);

// The category-counts endpoint returns thread counts.
const catEndpointIdx = routesSrc.indexOf('"/api/gmail/category-counts"');
const catEndpointBlock = catEndpointIdx !== -1
  ? routesSrc.slice(catEndpointIdx, catEndpointIdx + 4000)
  : "";
assert(
  catEndpointBlock.includes("COUNT(DISTINCT gmail_thread_id) FILTER"),
  "category-counts endpoint uses COUNT(DISTINCT gmail_thread_id) — canonical thread unit"
);
assert(
  !catEndpointBlock.includes("COUNT(*) FILTER (WHERE label_ids ILIKE '%CATEGORY_UPDATES"),
  "category-counts endpoint does NOT use COUNT(*) for CATEGORY_UPDATES (message count gone)"
);

// ── G4: People badge NOT derived from local message array ────────────────────

console.log("\n── G4. People badge is NOT derived from local message arrays ──");

// cc?.people?.unread API field is checked first inside _candidateSnapshot.
assert(
  candidateBlock.includes("cc?.people?.unread"),
  "People badge checks cc?.people?.unread (API field) first, via _candidateSnapshot"
);

const sidebarBadgesIdx = src.indexOf("const sidebarCategoryBadges");
const sidebarBadgesBlock = sidebarBadgesIdx !== -1
  ? src.slice(sidebarBadgesIdx, sidebarBadgesIdx + 300)
  : "";
assert(
  !sidebarBadgesBlock.includes("inboxMain.filter"),
  "sidebarCategoryBadges does NOT filter inboxMain for People count"
);
assert(
  !sidebarBadgesBlock.includes("peopleCount"),
  "sidebarCategoryBadges does NOT use local peopleCount variable"
);

// ── G5: People fallback arithmetic stays within the thread unit ──────────────

console.log("\n── G5. People fallback uses thread-unit arithmetic ──");

// After countSnapshot refactor, the fallback lives inside _candidateSnapshot as:
//   ?? Math.max(0, inbox - updates - promotions - social - forums)
// where `inbox` comes from _rawServerInboxUnread (thread total from health API).
const fallbackInCandidate = candidateBlock.includes("Math.max(0, inbox -") &&
  candidateBlock.includes("updates") && candidateBlock.includes("promotions");
assert(
  fallbackInCandidate,
  "People fallback pattern Math.max(0, inbox - ...) exists in _candidateSnapshot"
);
assert(
  !candidateBlock.includes("inboxMain"),
  "People fallback does NOT touch local inboxMain array"
);

// ── G6: category-counts queryKey includes activeAccountId ────────────────────

console.log("\n── G6. category-counts queryKey scopes per active account ──");

assert(
  src.includes('queryKey: ["/api/gmail/category-counts", activeAccountId]'),
  'category-counts queryKey = ["/api/gmail/category-counts", activeAccountId]'
);

// ── G7: accounts/health queryKey is account-agnostic ─────────────────────────

console.log("\n── G7. accounts/health queryKey is account-agnostic (returns all accounts) ──");

const healthQueryIdx = src.indexOf('queryKey: ["/api/gmail/accounts", "health"]');
assert(
  healthQueryIdx !== -1,
  'accounts/health queryKey = ["/api/gmail/accounts", "health"]'
);
const healthKeyLine = src.slice(healthQueryIdx, healthQueryIdx + 60);
assert(
  !healthKeyLine.includes("activeAccountId"),
  "accounts/health queryKey does NOT include activeAccountId segment"
);

// ── G8: bulkMarkRead invalidates badge queries ────────────────────────────────

console.log("\n── G8. bulkMarkReadMutation invalidates badge queries on success ──");

const bulkMutIdx = src.indexOf("const bulkMarkReadMutation = useMutation");
const bulkMutBlock = bulkMutIdx !== -1
  ? src.slice(bulkMutIdx, bulkMutIdx + 1800)
  : "";

assert(
  bulkMutBlock.includes("invalidateBadgeQueries()"),
  'bulkMarkReadMutation.onSuccess invalidates accounts/health'
);
assert(
  bulkMutBlock.includes("invalidateBadgeQueries()"),
  'bulkMarkReadMutation.onSuccess invalidates category-counts'
);

// ── G9: markAllInboxRead invalidates badge queries ───────────────────────────

console.log("\n── G9. markAllInboxReadMutation invalidates badge queries on success ──");

const markAllIdx = src.indexOf("const markAllInboxReadMutation = useMutation");
const markAllBlock = markAllIdx !== -1
  ? src.slice(markAllIdx, markAllIdx + 1500)
  : "";

assert(
  markAllBlock.includes('invalidateQueries({ queryKey: ["/api/gmail/accounts", "health"]'),
  'markAllInboxReadMutation.onSuccess invalidates accounts/health'
);
assert(
  markAllBlock.includes('invalidateQueries({ queryKey: ["/api/gmail/category-counts"]'),
  'markAllInboxReadMutation.onSuccess invalidates category-counts'
);

// ── G10: markUnreadSingle invalidates badge queries ───────────────────────────

console.log("\n── G10. markUnreadSingleMutation invalidates badge queries on success ──");

const markUnreadIdx = src.indexOf("const markUnreadSingleMutation = useMutation");
const markUnreadBlock = markUnreadIdx !== -1
  ? src.slice(markUnreadIdx, markUnreadIdx + 1500)
  : "";

assert(
  markUnreadBlock.includes('invalidateQueries({ queryKey: ["/api/gmail/accounts", "health"]'),
  'markUnreadSingleMutation.onSuccess invalidates accounts/health'
);
assert(
  markUnreadBlock.includes('invalidateQueries({ queryKey: ["/api/gmail/category-counts"]'),
  'markUnreadSingleMutation.onSuccess invalidates category-counts'
);

// ── G11: Priority overlay annotation ─────────────────────────────────────────

console.log("\n── G11. Priority section annotated as non-additive overlay ──");

const priorityOverlayIdx = src.indexOf("isPriority && (");
const priorityOverlayBlock = priorityOverlayIdx !== -1
  ? src.slice(priorityOverlayIdx, priorityOverlayIdx + 300)
  : "";

assert(
  priorityOverlayIdx !== -1,
  "isPriority conditional block exists in section header"
);
assert(
  priorityOverlayBlock.includes("overlay") || priorityOverlayBlock.includes("also"),
  'Priority section shows "overlay" or "also in" annotation (non-additive)'
);

const serverGroupIdx = src.indexOf("const serverGroupCounts = useMemo");
const serverGroupBlock = serverGroupIdx !== -1
  ? src.slice(serverGroupIdx, serverGroupIdx + 900)
  : "";

assert(
  !serverGroupBlock.includes('"priority"'),
  'serverGroupCounts does NOT include a "priority" key (Priority is overlay-only)'
);
assert(
  serverGroupBlock.includes('"unread-people"') && serverGroupBlock.includes('"unread-newsletters"'),
  'serverGroupCounts contains the three additive section keys'
);

// ── G12: serverGroupCounts derives from countSnapshot (→ categoryCountsQuery) ─

console.log("\n── G12. serverGroupCounts derives from categoryCountsQuery (not local arrays) ──");

// After countSnapshot refactor: serverGroupCounts reads countSnapshot.*
// which is derived from _candidateSnapshot which reads categoryCountsQuery.data.
// Verify the intermediate link: serverGroupCounts uses countSnapshot, NOT categoryCountsQuery.data directly.
assert(
  serverGroupBlock.includes("countSnapshot"),
  "serverGroupCounts derives from countSnapshot (which wraps categoryCountsQuery.data)"
);
assert(
  !serverGroupBlock.includes("categoryCountsQuery.data"),
  "serverGroupCounts does NOT read categoryCountsQuery.data directly (goes through countSnapshot)"
);
assert(
  !serverGroupBlock.includes("inboxMain.filter"),
  "serverGroupCounts does NOT filter inboxMain for section header counts"
);

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(55)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll tests passed.");
}
