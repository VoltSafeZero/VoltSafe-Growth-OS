"use strict";
// Regression tests — Category-filter + Unread mode + Loading-state machine
//
// Covers the three-part surgical fix:
//  1. inboxCategoryQ: category tabs include is:unread so badge ∩ list predicates match
//  2. inboxQuery / loadMoreInbox: page 1 and page 2+ use the same category-scoped query
//  3. listState machine: mutually exclusive render states prevent contradictory UI
//
// All tests are source-grep / static-analysis only (no running server needed).

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

// ─── Load source files ────────────────────────────────────────────────────────

const inboxSrc = fs.readFileSync(
  path.join(__dirname, "../client/src/pages/gmail-inbox.tsx"),
  "utf8"
);

const localMailbox = fs.readFileSync(
  path.join(__dirname, "../server/services/local-mailbox.ts"),
  "utf8"
);

const inboxQueryKeySrc = fs.readFileSync(
  path.join(__dirname, "../client/src/lib/inbox-query-key.ts"),
  "utf8"
);

// ─── 1. inboxCategoryQ — query token generation ───────────────────────────────

console.log("\n── 1. inboxCategoryQ — category query token generation ──");

check(
  "People tab returns \"in:people is:unread\"",
  inboxSrc.includes(`return "in:people is:unread"`)
);

check(
  "Newsletters tab returns \"in:newsletters is:unread\"",
  inboxSrc.includes(`return "in:newsletters is:unread"`)
);

check(
  "Notifications tab returns \"in:notifications is:unread\"",
  inboxSrc.includes(`return "in:notifications is:unread"`)
);

check(
  "All tab returns \"in:inbox\" (no forced is:unread)",
  inboxSrc.includes(`return "in:inbox";`) &&
    !inboxSrc.includes(`return "in:inbox is:unread"`)
);

// ─── 2. inboxQuery (page 1) — request generation ─────────────────────────────

console.log("\n── 2. inboxQuery page-1 request generation ──");

check(
  "People + Unread sends inboxCategoryQ (which is \"in:people is:unread\")",
  // In unread mode for non-all category tabs, inboxCategoryQ is used directly
  inboxSrc.includes(`inboxCategory === "all" ? "in:inbox is:unread" : inboxCategoryQ`)
);

check(
  "All + Unread sends literal \"in:inbox is:unread\"",
  inboxSrc.includes(`"in:inbox is:unread"`)
);

check(
  "Non-unread mode sends bare inboxCategoryQ without appending is:unread",
  inboxSrc.includes(`params.set("q", inboxCategoryQ)`)
);

check(
  "Search query in unread mode appends is:unread to searchQuery not inboxCategoryQ",
  inboxSrc.includes(`searchQuery ? \`\${searchQuery} is:unread\``)
);

// ─── 3. loadMoreInbox (page 2+) — mirrors page 1 ─────────────────────────────

console.log("\n── 3. loadMoreInbox (page 2+) mirrors page-1 query ──");

// Count occurrences to verify both page 1 and page 2+ use the same pattern
const categoryAllPattern = `inboxCategory === "all" ? "in:inbox is:unread" : inboxCategoryQ`;
const occurrences = (inboxSrc.match(new RegExp(categoryAllPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
check(
  "Both inboxQuery and loadMoreInbox use the same category-aware unread query (2 occurrences)",
  occurrences === 2,
  `found ${occurrences} occurrence(s)`
);

check(
  "loadMoreInbox uses pageToken for cursor pagination",
  inboxSrc.includes(`params.set("pageToken", inboxNextToken)`)
);

// ─── 4. Backend buildQClauses — server-side category handling ─────────────────

console.log("\n── 4. Backend buildQClauses — category + unread handling ──");

check(
  "in:people → smart_category = 'people'",
  localMailbox.includes(`smart_category = 'people'`)
);

check(
  "in:newsletters → smart_category IN ('promotions', 'forums')",
  localMailbox.includes(`smart_category IN ('promotions', 'forums')`)
);

check(
  "in:notifications → smart_category IN ('updates', 'social')",
  localMailbox.includes(`smart_category IN ('updates', 'social')`)
);

check(
  "is:unread → is_unread = true (derived column, not ILIKE)",
  localMailbox.includes(`is_unread = true`)
);

// ─── 5. Query key partitioning ────────────────────────────────────────────────

console.log("\n── 5. inboxQueryKey partitions (category, crmFilter) independently ──");

check(
  "inboxQueryKey includes inboxCategory as 5th segment",
  inboxQueryKeySrc.includes("inboxCategory")
);

check(
  "inboxQueryKey includes crmFilter=unread as \"unread\" discriminator",
  inboxQueryKeySrc.includes(`crmFilter === "unread" ? "unread"`)
);

check(
  "People+Unread and All+Unread get different cache partitions (inboxCategory in key)",
  inboxQueryKeySrc.includes("inboxCategory") && inboxQueryKeySrc.includes(`crmFilter === "unread" ? "unread"`)
);

// ─── 6. listState machine — mutual exclusion ──────────────────────────────────

console.log("\n── 6. listState machine — mutual exclusion invariants ──");

check(
  "listState type declared with all 7 required states",
  inboxSrc.includes('"initial_loading"') &&
    inboxSrc.includes('"loaded_results"') &&
    inboxSrc.includes('"auto_loading_unread"') &&
    inboxSrc.includes('"loading_next_page"') &&
    inboxSrc.includes('"loaded_empty"') &&
    inboxSrc.includes('"failed"') &&
    inboxSrc.includes('"exhausted_with_discrepancy"')
);

check(
  "loaded_empty requires !loadingMoreInbox (guarded by listState before checking badge)",
  // The machine returns "initial_loading" when loadingMoreInbox is true with 0 rows,
  // so loaded_empty can only be reached after loadingMoreInbox is false.
  inboxSrc.includes(`if (isLoading || loadingMoreInbox) return "initial_loading"`)
);

check(
  "auto_loading_unread only fires in Unread mode (crmFilter check in listState)",
  inboxSrc.includes(`if (crmFilter === "unread" && loadingMoreInbox) return "auto_loading_unread"`)
);

check(
  "loading_next_page covers All-mode loadMore (no crmFilter guard)",
  inboxSrc.includes(`if (loadingMoreInbox) return "loading_next_page"`)
);

check(
  "exhausted_with_discrepancy: requires is:unread + positive badge + no next token",
  inboxSrc.includes(`if (crmFilter === "unread" && inboxCategoryServerUnread > 0 && !inboxNextToken)`) &&
    inboxSrc.includes(`return "exhausted_with_discrepancy"`)
);

// ─── 7. Render guards — contradictory state prevention ───────────────────────

console.log("\n── 7. Render guards — contradictory combinations impossible ──");

check(
  "Skeleton uses listState === \"initial_loading\" for inbox tab",
  inboxSrc.includes(`tab === "inbox" ? listState === "initial_loading" : isLoading`)
);

check(
  "Empty state gated on listState === \"loaded_empty\" || listState === \"exhausted_with_discrepancy\"",
  inboxSrc.includes(`listState === "loaded_empty" || listState === "exhausted_with_discrepancy"`)
);

check(
  "No messages found cannot appear while auto_loading_unread (loaded_empty gate)",
  // auto_loading_unread requires loadingMoreInbox=true, which causes listState to be
  // auto_loading_unread (not loaded_empty), so the empty state block is never entered.
  inboxSrc.includes(`listState === "loaded_empty" || listState === "exhausted_with_discrepancy"`) &&
    inboxSrc.includes(`if (crmFilter === "unread" && loadingMoreInbox) return "auto_loading_unread"`)
);

check(
  "PART C strip gated on loaded_results | auto_loading_unread | loading_next_page",
  inboxSrc.includes(
    `listState === "loaded_results" || listState === "auto_loading_unread" || listState === "loading_next_page"`
  )
);

check(
  "PART C never shows in loaded_empty or exhausted_with_discrepancy (gated out)",
  // The PART C guard explicitly lists only 3 states; loaded_empty/exhausted_with_discrepancy
  // are absent, so PART C cannot render alongside "No messages found".
  inboxSrc.includes(
    `listState === "loaded_results" || listState === "auto_loading_unread" || listState === "loading_next_page"`
  )
);

check(
  "PART C text distinguishes auto_loading_unread from loading_next_page",
  inboxSrc.includes(`listState === "auto_loading_unread"`) &&
    inboxSrc.includes(`"Loading remaining unread emails…"`) &&
    inboxSrc.includes(`"Loading more messages…"`)
);

check(
  "failed state shows error UI (existing error block unchanged)",
  inboxSrc.includes(`{error && tab !== "folder"`)
);

check(
  "exhausted_with_discrepancy shows Retry button with data-testid",
  inboxSrc.includes(`data-testid="button-retry-inbox"`) &&
    inboxSrc.includes(`inboxQuery.refetch()`)
);

check(
  "exhausted_with_discrepancy diagnostic ref string present",
  inboxSrc.includes(`ref: exhausted_with_discrepancy`)
);

// ─── 8. PART B auto-loader — All mode guard ───────────────────────────────────

console.log("\n── 8. PART B unread auto-loader — All mode guard ──");

check(
  "PART B exits early when crmFilter !== \"unread\" (All mode never auto-loads for unread)",
  inboxSrc.includes(`if (crmFilter !== "unread") return;`)
);

check(
  "PART B exits early when inboxCategoryServerUnread === 0",
  inboxSrc.includes(`if (inboxCategoryServerUnread === 0) return;`)
);

check(
  "PART B stops when inboxUnreadCount >= inboxCategoryServerUnread",
  inboxSrc.includes(`if (inboxUnreadCount >= inboxCategoryServerUnread) return;`)
);

// ─── 9. Category + Unread mode — rendering groups ────────────────────────────

console.log("\n── 9. Category + Unread rendering — group isolation ──");

check(
  "categorizedInbox filters by inboxCategory (no bypass in unread mode)",
  // Post-fix: the bypass `crmFilter === "unread" ? inboxMain :` is removed
  !inboxSrc.includes(`crmFilter === "unread"\n    ? inboxMain`) &&
    !inboxSrc.includes(`crmFilter === "unread" ? inboxMain`)
);

check(
  "categorizedInbox for All tab returns inboxMain (no extra filter)",
  inboxSrc.includes(`inboxCategory === "all"`) &&
    inboxSrc.includes(`? inboxMain`)
);

// ─── 10. isCategoryTab constant ───────────────────────────────────────────────

console.log("\n── 10. isCategoryTab constant ──");

check(
  "isCategoryTab is false (legacy category system disabled; inboxCategory system active)",
  inboxSrc.includes(`const isCategoryTab = false`)
);

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`  Passed: ${passed}   Failed: ${failed}   Total: ${passed + failed}`);
if (failed > 0) {
  console.error(`\nFAILED — ${failed} check(s) did not pass`);
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");
