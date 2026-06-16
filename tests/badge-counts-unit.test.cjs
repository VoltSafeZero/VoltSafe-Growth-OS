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
 *  G2. Inbox badge reads serverInboxUnreadCount ← accountsHealthQuery.unreadCount
 *        (threads, via count(distinct) in the health endpoint).
 *  G3. Sidebar category badges read sidebarCategoryBadges ← categoryCountsQuery.data
 *        (threads, via COUNT(DISTINCT gmail_thread_id) in the category-counts endpoint).
 *  G4. People badge is NOT derived from local inboxMain message arrays when
 *        the API field cc.people?.unread is available.
 *  G5. The People fallback (when API field is absent) subtracts thread values
 *        from a thread total — never mixes message and thread arithmetic.
 *  G6. category-counts queryKey includes activeAccountId so per-account
 *        switching invalidates the right cache partition.
 *  G7. accounts/health queryKey does NOT include activeAccountId (health
 *        returns all accounts at once and filters client-side).
 *  G8. bulkMarkReadMutation.onSuccess invalidates BOTH badge queries so
 *        sidebar numbers update immediately (not just on the next 30-60s poll).
 *  G9. markAllInboxReadMutation.onSuccess invalidates BOTH badge queries.
 * G10. markUnreadSingleMutation.onSuccess invalidates BOTH badge queries.
 * G11. Priority section is annotated as a non-additive overlay in the UI.
 * G12. serverGroupCounts (section headers) is derived from categoryCountsQuery,
 *        never from the local inboxMain message array directly.
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

// serverInboxUnreadCount must sum a.unreadCount from accountsHealthQuery.data
const serverUnreadIdx = src.indexOf("const serverInboxUnreadCount = useMemo");
const serverUnreadBlock = serverUnreadIdx !== -1
  ? src.slice(serverUnreadIdx, serverUnreadIdx + 600)
  : "";

assert(
  serverUnreadBlock.includes("accountsHealthQuery.data"),
  "serverInboxUnreadCount reads from accountsHealthQuery.data"
);
assert(
  serverUnreadBlock.includes("unreadCount"),
  "serverInboxUnreadCount sums .unreadCount from health data"
);
assert(
  !serverUnreadBlock.includes("inboxMain.filter"),
  "serverInboxUnreadCount does NOT derive from local inboxMain array"
);

// The health endpoint returns thread counts
assert(
  routesSrc.includes("count(distinct m.gmail_thread_id)"),
  "accounts/health endpoint uses count(distinct) for unread_count"
);

// ── G3: Category badges read from categoryCountsQuery ────────────────────────

console.log("\n── G3. Category badges derive from categoryCountsQuery (thread count) ──");

const sidebarBadgesIdx = src.indexOf("const sidebarCategoryBadges = useMemo");
const sidebarBadgesBlock = sidebarBadgesIdx !== -1
  ? src.slice(sidebarBadgesIdx, sidebarBadgesIdx + 500)
  : "";

assert(
  sidebarBadgesBlock.includes("categoryCountsQuery.data"),
  "sidebarCategoryBadges reads from categoryCountsQuery.data"
);
assert(
  sidebarBadgesBlock.includes("cc?.updates?.unread"),
  "updates badge reads cc?.updates?.unread from API"
);
assert(
  sidebarBadgesBlock.includes("cc?.promotions?.unread"),
  "promotions badge reads cc?.promotions?.unread from API"
);
assert(
  sidebarBadgesBlock.includes("cc?.social?.unread"),
  "social badge reads cc?.social?.unread from API"
);
assert(
  sidebarBadgesBlock.includes("cc?.forums?.unread"),
  "forums badge reads cc?.forums?.unread from API"
);

// The category-counts endpoint returns thread counts.
// Scope the check to the endpoint block only — the inbox-debug endpoint still has
// COUNT(*) for its message-count reference column, so checking the whole file would
// produce a false positive.
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

// sidebarCategoryBadges.people must check cc?.people?.unread FIRST.
// The fallback (Math.max) is only reached when the API field is absent.
assert(
  sidebarBadgesBlock.includes("cc?.people?.unread"),
  "People badge checks cc?.people?.unread (API field) first"
);
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

// The fallback subtracts thread values (updates+promotions+social+forums) from
// serverInboxUnreadCount (also threads). All operands are the same unit.
// There are two Math.max occurrences; the sidebarCategoryBadges one (with
// updates/promotions) is the SECOND occurrence — skip the first one which
// belongs to serverGroupCounts and uses newsletters/notifications.
const firstFallbackIdx = src.indexOf("Math.max(0, serverInboxUnreadCount -");
const fallbackIdx = firstFallbackIdx !== -1
  ? src.indexOf("Math.max(0, serverInboxUnreadCount -", firstFallbackIdx + 1)
  : -1;
// 160 chars captures the fallback line + return + closing deps array but stops
// before the next useMemo (pinnedMessages) which references inboxMain unrelated.
const fallbackBlock = fallbackIdx !== -1
  ? src.slice(fallbackIdx, fallbackIdx + 160)
  : "";

assert(
  fallbackIdx !== -1,
  "People fallback pattern Math.max(0, serverInboxUnreadCount - ...) exists"
);
assert(
  // The fallback subtracts updates+promotions+social+forums (all thread values)
  fallbackBlock.includes("updates") && fallbackBlock.includes("promotions"),
  "People fallback subtracts category thread values from serverInboxUnreadCount"
);
assert(
  !fallbackBlock.includes("inboxMain"),
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
// The health endpoint returns ALL accounts; client filters locally by activeAccountId.
// The key must NOT include activeAccountId (would cause redundant fetches per account).
const healthKeyLine = src.slice(healthQueryIdx, healthQueryIdx + 60);
assert(
  !healthKeyLine.includes("activeAccountId"),
  "accounts/health queryKey does NOT include activeAccountId segment"
);

// ── G8: bulkMarkRead invalidates badge queries ────────────────────────────────

console.log("\n── G8. bulkMarkReadMutation invalidates badge queries on success ──");

const bulkMutIdx = src.indexOf("const bulkMarkReadMutation = useMutation");
// The invalidations land ~1570 chars into the block; use 1800 to be safe.
const bulkMutBlock = bulkMutIdx !== -1
  ? src.slice(bulkMutIdx, bulkMutIdx + 1800)
  : "";

assert(
  bulkMutBlock.includes('invalidateQueries({ queryKey: ["/api/gmail/accounts", "health"]'),
  'bulkMarkReadMutation.onSuccess invalidates accounts/health'
);
assert(
  bulkMutBlock.includes('invalidateQueries({ queryKey: ["/api/gmail/category-counts"]'),
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

// Priority is NOT included in the serverGroupCounts that feed the section
// header additive math (only people, notifications, newsletters are included).
const serverGroupIdx = src.indexOf("const serverGroupCounts = useMemo");
// "unread-people" key is ~625 chars into the block; use 900 to be safe.
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

// ── G12: serverGroupCounts derives from categoryCountsQuery, not inboxMain ───

console.log("\n── G12. serverGroupCounts derives from categoryCountsQuery (not local arrays) ──");

assert(
  serverGroupBlock.includes("categoryCountsQuery.data"),
  "serverGroupCounts reads from categoryCountsQuery.data"
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
