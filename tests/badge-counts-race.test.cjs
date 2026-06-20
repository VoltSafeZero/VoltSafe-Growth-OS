/**
 * tests/badge-counts-race.test.cjs
 *
 * Structural ("source-grep") tests for the Inbox Count race-condition fix.
 *
 * These tests assert that the code structure satisfies the invariants required
 * to prevent mixed-freshness badge rendering and misleading section-header counts.
 * They pin the shape of the implementation so regressions are caught without an
 * expensive E2E browser session.
 *
 * All tests operate against the raw source of gmail-inbox.tsx.
 */

const fs   = require("fs");
const path = require("path");

const SRC = path.resolve(__dirname, "../client/src/pages/gmail-inbox.tsx");
const src = fs.readFileSync(SRC, "utf8");

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    results.push({ status: "PASS", name });
  } catch (e) {
    failed++;
    results.push({ status: "FAIL", name, error: e.message });
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "Assertion failed");
}

// ─── R1: Aligned refetch intervals ────────────────────────────────────────────

test("R1: categoryCountsQuery uses refetchInterval 30_000 (aligned with health)", () => {
  // Scope the check to the categoryCountsQuery block only.
  // Use 900 chars — the refetchInterval line is ~15 lines into the query definition.
  const idx = src.indexOf("const categoryCountsQuery = useQuery");
  assert(idx !== -1, "categoryCountsQuery not found");
  const block = src.slice(idx, idx + 900);
  assert(
    block.includes("refetchInterval: 30_000"),
    "categoryCountsQuery must use refetchInterval: 30_000 — found 60_000 or missing"
  );
});

test("R1b: categoryCountsQuery does NOT have refetchInterval 60_000", () => {
  // Check the specific query block — not the whole file (other queries may use 60_000).
  const idx = src.indexOf("const categoryCountsQuery = useQuery");
  assert(idx !== -1, "categoryCountsQuery not found");
  const block = src.slice(idx, idx + 600);
  assert(
    !block.includes("refetchInterval: 60_000"),
    "categoryCountsQuery must NOT use refetchInterval: 60_000"
  );
});

// ─── R2: invalidateBadgeQueries helper ────────────────────────────────────────

test("R2: invalidateBadgeQueries helper is defined", () => {
  assert(
    src.includes("const invalidateBadgeQueries"),
    "Expected const invalidateBadgeQueries to be defined"
  );
});

test("R2b: invalidateBadgeQueries invalidates accounts/health", () => {
  const idx = src.indexOf("const invalidateBadgeQueries");
  assert(idx !== -1, "invalidateBadgeQueries not found");
  const snippet = src.slice(idx, idx + 400);
  assert(
    snippet.includes('"/api/gmail/accounts", "health"'),
    'invalidateBadgeQueries must invalidate ["/api/gmail/accounts", "health"]'
  );
});

test("R2c: invalidateBadgeQueries invalidates category-counts", () => {
  const idx = src.indexOf("const invalidateBadgeQueries");
  assert(idx !== -1, "invalidateBadgeQueries not found");
  const snippet = src.slice(idx, idx + 400);
  assert(
    snippet.includes('"/api/gmail/category-counts"'),
    'invalidateBadgeQueries must invalidate ["/api/gmail/category-counts"]'
  );
});

// ─── R3: All mailbox mutations use invalidateBadgeQueries ─────────────────────

test("R3a: polling/sync handler uses invalidateBadgeQueries (not bare health invalidation)", () => {
  const pollingSection = src.slice(
    src.indexOf("const pollCtrl = new AbortController"),
    src.indexOf("const handleRefreshAccount")
  );
  assert(
    pollingSection.includes("invalidateBadgeQueries()"),
    "Polling/sync handler must call invalidateBadgeQueries()"
  );
});

test("R3b: handleRefreshAccount uses invalidateBadgeQueries", () => {
  const idx = src.indexOf("const handleRefreshAccount");
  assert(idx !== -1, "handleRefreshAccount not found");
  // The invalidation is in the `if (res.ok)` block ~400 chars from the definition
  const snippet = src.slice(idx, idx + 600);
  assert(
    snippet.includes("invalidateBadgeQueries()"),
    "handleRefreshAccount must call invalidateBadgeQueries()"
  );
});

test("R3c: handleRefreshInbox uses invalidateBadgeQueries", () => {
  const idx = src.indexOf("const handleRefreshInbox");
  assert(idx !== -1, "handleRefreshInbox not found");
  // The invalidation is in the `finally` block which comes after a long `try` body.
  // Use 2000 chars to safely reach the finally block.
  const snippet = src.slice(idx, idx + 2000);
  assert(
    snippet.includes("invalidateBadgeQueries()"),
    "handleRefreshInbox must call invalidateBadgeQueries()"
  );
});

test("R3d: bulkArchiveMutation onSuccess uses invalidateBadgeQueries", () => {
  const idx = src.indexOf("const bulkArchiveMutation");
  assert(idx !== -1, "bulkArchiveMutation not found");
  // onSuccess is within ~15 lines of the mutation definition; use 1200 chars
  const snippet = src.slice(idx, idx + 1200);
  assert(
    snippet.includes("invalidateBadgeQueries()"),
    "bulkArchiveMutation.onSuccess must call invalidateBadgeQueries()"
  );
});

test("R3e: bulkTrashMutation onSuccess uses invalidateBadgeQueries", () => {
  const idx = src.indexOf("const bulkTrashMutation");
  assert(idx !== -1, "bulkTrashMutation not found");
  // onSuccess block is ~25 lines into the mutation; use 1600 chars to be safe
  const snippet = src.slice(idx, idx + 1600);
  assert(
    snippet.includes("invalidateBadgeQueries()"),
    "bulkTrashMutation.onSuccess must call invalidateBadgeQueries()"
  );
});

test("R3f: archiveThreadMutation onSuccess uses invalidateBadgeQueries", () => {
  const idx = src.indexOf("const archiveThreadMutation");
  assert(idx !== -1, "archiveThreadMutation not found");
  const snippet = src.slice(idx, idx + 1200);
  assert(
    snippet.includes("invalidateBadgeQueries()"),
    "archiveThreadMutation.onSuccess must call invalidateBadgeQueries()"
  );
});

test("R3g: trashThreadMutation onSuccess uses invalidateBadgeQueries", () => {
  const idx = src.indexOf("const trashThreadMutation");
  assert(idx !== -1, "trashThreadMutation not found");
  const snippet = src.slice(idx, idx + 1200);
  assert(
    snippet.includes("invalidateBadgeQueries()"),
    "trashThreadMutation.onSuccess must call invalidateBadgeQueries()"
  );
});

test("R3h: bulkMarkReadMutation onSuccess invalidates both badge queries", () => {
  const idx = src.indexOf("const bulkMarkReadMutation");
  assert(idx !== -1, "bulkMarkReadMutation not found");
  const snippet = src.slice(idx, idx + 1800);
  assert(
    snippet.includes("invalidateBadgeQueries()"),
    "bulkMarkReadMutation.onSuccess must call invalidateBadgeQueries()"
  );
});

// ─── R4: Atomic countSnapshot structure ───────────────────────────────────────

test("R4a: _rawServerInboxUnread private variable is defined", () => {
  assert(
    src.includes("const _rawServerInboxUnread"),
    "Expected private _rawServerInboxUnread variable"
  );
});

test("R4b: _candidateSnapshot is computed from _rawServerInboxUnread and categoryCountsQuery.data", () => {
  const idx = src.indexOf("const _candidateSnapshot");
  assert(idx !== -1, "_candidateSnapshot not found");
  const snippet = src.slice(idx, idx + 900);
  assert(
    snippet.includes("_rawServerInboxUnread") && snippet.includes("categoryCountsQuery.data"),
    "_candidateSnapshot must depend on both _rawServerInboxUnread and categoryCountsQuery.data"
  );
});

test("R4c: countSnapshot has all required fields", () => {
  const idx = src.indexOf("const _candidateSnapshot");
  assert(idx !== -1, "_candidateSnapshot not found");
  // Use 1000 chars to cover the full return object including gap and isReconciled
  const snippet = src.slice(idx, idx + 1000);
  const required = ["inbox", "people", "updates", "promotions", "social", "forums",
                    "categorySum", "gap", "isReconciled", "sourceTimestamp"];
  for (const field of required) {
    assert(snippet.includes(field), `countSnapshot missing required field: ${field}`);
  }
});

test("R4d: _stableSnapshotRef is used to stabilise countSnapshot", () => {
  assert(
    src.includes("_stableSnapshotRef"),
    "Expected _stableSnapshotRef useRef for stable snapshot"
  );
});

test("R4e: stable snapshot only updates when NEITHER query is fetching", () => {
  const idx = src.indexOf("_stableSnapshotRef");
  assert(idx !== -1, "_stableSnapshotRef not found");
  const snippet = src.slice(idx, idx + 600);
  assert(
    snippet.includes("accountsHealthQuery.isFetching") &&
    snippet.includes("categoryCountsQuery.isFetching"),
    "Stable snapshot update must check BOTH isFetching flags"
  );
});

test("R4f: serverInboxUnreadCount is an alias for countSnapshot.inbox (not direct health query)", () => {
  assert(
    src.includes("const serverInboxUnreadCount = countSnapshot.inbox"),
    "serverInboxUnreadCount must be defined as `= countSnapshot.inbox` (alias)"
  );
});

test("R4g: serverGroupCounts derives from countSnapshot (not directly from categoryCountsQuery.data)", () => {
  const idx = src.indexOf("const serverGroupCounts = useMemo");
  assert(idx !== -1, "serverGroupCounts useMemo not found");
  const snippet = src.slice(idx, idx + 600);
  assert(
    snippet.includes("countSnapshot"),
    "serverGroupCounts must source from countSnapshot"
  );
  assert(
    !snippet.includes("categoryCountsQuery.data"),
    "serverGroupCounts must NOT read categoryCountsQuery.data directly (use countSnapshot)"
  );
});

test("R4h: sidebarCategoryBadges derives from countSnapshot (not directly from categoryCountsQuery.data)", () => {
  const idx = src.indexOf("const sidebarCategoryBadges");
  assert(idx !== -1, "sidebarCategoryBadges not found");
  const snippet = src.slice(idx, idx + 300);
  assert(
    snippet.includes("countSnapshot"),
    "sidebarCategoryBadges must source from countSnapshot"
  );
  assert(
    !snippet.includes("categoryCountsQuery.data"),
    "sidebarCategoryBadges must NOT read categoryCountsQuery.data directly"
  );
});

// ─── R5: Smart Inbox section headers — no item.count fallback for server-backed sections ──

test("R5a: section header no longer uses bare ?? item.count fallback", () => {
  assert(
    !src.includes("serverGroupCounts?.[item.id as keyof typeof serverGroupCounts] ?? item.count"),
    "Old ?? item.count fallback pattern must be removed from section headers"
  );
});

test("R5b: server-backed section headers use explicit server-backed check", () => {
  assert(
    src.includes('"unread-people" || item.id === "unread-notifications"'),
    "Section header must distinguish server-backed sections by ID"
  );
});

test("R5c: server-backed sections show loading skeleton when serverGroupCounts is null", () => {
  assert(
    src.includes("serverGroupCounts !== null") &&
    src.includes("opacity-50"),
    "Server-backed section headers must show a loading indicator (opacity-50 span) when serverGroupCounts is null"
  );
});

test("R5d: section header count span has data-testid for testing", () => {
  assert(
    src.includes('data-testid={`section-header-count-${item.id}`}'),
    "Section header count span must have data-testid attribute"
  );
});

test("R5e: local-only sections (seen, priority) still fall back to item.count", () => {
  assert(
    src.includes(": item.count}"),
    "Local-only sections must still use item.count as their count source"
  );
});

// ─── R6: Diagnostic logging is gated ──────────────────────────────────────────

test("R6a: diagnostic useEffect is gated behind import.meta.env.DEV || isAdmin", () => {
  assert(
    src.includes("if (!import.meta.env.DEV && !isAdmin) return;"),
    "Diagnostic logging must be gated: if (!import.meta.env.DEV && !isAdmin) return;"
  );
});

test("R6b: diagnostic gate appears INSIDE the useEffect (not outside)", () => {
  const effectIdx = src.indexOf("// ── LIVE BADGE COUNT DIAGNOSTIC");
  assert(effectIdx !== -1, "Diagnostic block not found");
  // Use 600 chars to safely reach past the comment block and into the useEffect body
  const block = src.slice(effectIdx, effectIdx + 600);
  assert(
    block.includes("if (!import.meta.env.DEV && !isAdmin) return;"),
    "Gate must be inside the diagnostic useEffect block"
  );
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log("\n=== badge-counts-race.test.cjs ===\n");
for (const r of results) {
  const icon = r.status === "PASS" ? "✅" : "❌";
  console.log(`${icon} ${r.status}: ${r.name}`);
  if (r.error) console.log(`       ${r.error}`);
}
console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} total\n`);

if (failed > 0) process.exit(1);
