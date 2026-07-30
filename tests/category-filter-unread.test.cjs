"use strict";
// Regression tests — Category-filter + Unread mode + Loading-state machine
//
// Covers the three-part surgical fix:
//  1. inboxCategoryQ: bare category token WITHOUT is:unread so People+All / Newsletters+All
//     etc. return ALL inbox messages, not just unread ones.
//  2. inboxQuery / loadMoreInbox: page 1 and page 2+ use `${inboxCategoryQ} is:unread`
//     when crmFilter==="unread" so every tab/mode combination generates the correct query.
//  3. listState machine: mutually exclusive render states prevent contradictory UI
//
// All tests are source-grep / static-analysis only (no running server needed).
//
// Required request matrix:
//   All + All:             in:inbox
//   All + Unread:          in:inbox is:unread
//   People + All:          in:people
//   People + Unread:       in:people is:unread
//   Newsletters + All:     in:newsletters
//   Newsletters + Unread:  in:newsletters is:unread
//   Notifications + All:   in:notifications
//   Notifications + Unread: in:notifications is:unread

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

// ─── 0. Eight-combination request matrix ─────────────────────────────────────
// Static analysis: verify inboxCategoryQ and the unread-mode branch together
// produce the correct query string for all 8 (tab, crmFilter) combinations.

console.log("\n── 0. Eight-combination request matrix ──");

// All + All: inboxCategoryQ returns "in:inbox"; crmFilter !== "unread" → sends "in:inbox"
check(
  'All + All sends "in:inbox"',
  inboxSrc.includes(`return "in:inbox"`) &&
    inboxSrc.includes(`params.set("q", inboxCategoryQ)`)
);

// All + Unread: `${inboxCategoryQ} is:unread` where inboxCategoryQ="in:inbox" → "in:inbox is:unread"
check(
  'All + Unread sends "${inboxCategoryQ} is:unread" (resolves to "in:inbox is:unread")',
  inboxSrc.includes("`${inboxCategoryQ} is:unread`")
);

// People + All: inboxCategoryQ returns "in:people"; no is:unread in All mode
check(
  'People + All sends "in:people" (no is:unread)',
  inboxSrc.includes(`return "in:people"`) &&
    !inboxSrc.includes(`return "in:people is:unread"`)
);

// People + Unread: `${inboxCategoryQ} is:unread` where inboxCategoryQ="in:people"
check(
  'People + Unread sends "in:people is:unread" via template (no literal baked-in)',
  inboxSrc.includes("`${inboxCategoryQ} is:unread`") &&
    inboxSrc.includes(`return "in:people"`)
);

// Newsletters + All: bare token, no is:unread
check(
  'Newsletters + All sends "in:newsletters" (no is:unread)',
  inboxSrc.includes(`return "in:newsletters"`) &&
    !inboxSrc.includes(`return "in:newsletters is:unread"`)
);

// Newsletters + Unread: via template
check(
  'Newsletters + Unread sends "in:newsletters is:unread" via template',
  inboxSrc.includes("`${inboxCategoryQ} is:unread`") &&
    inboxSrc.includes(`return "in:newsletters"`)
);

// Notifications + All: bare token
check(
  'Notifications + All sends "in:notifications" (no is:unread)',
  inboxSrc.includes(`return "in:notifications"`) &&
    !inboxSrc.includes(`return "in:notifications is:unread"`)
);

// Notifications + Unread: via template
check(
  'Notifications + Unread sends "in:notifications is:unread" via template',
  inboxSrc.includes("`${inboxCategoryQ} is:unread`") &&
    inboxSrc.includes(`return "in:notifications"`)
);

// Confirm is:unread is NOT baked into the bare token for any category tab
check(
  'No category tab bakes is:unread into inboxCategoryQ (all bare tokens)',
  !inboxSrc.includes(`return "in:people is:unread"`) &&
    !inboxSrc.includes(`return "in:newsletters is:unread"`) &&
    !inboxSrc.includes(`return "in:notifications is:unread"`)
);

// Confirm the old special-case branch is gone — no `inboxCategory === "all" ? "in:inbox is:unread"`
check(
  'Old special-case `inboxCategory === "all" ? "in:inbox is:unread"` branch is gone',
  !inboxSrc.includes(`inboxCategory === "all" ? "in:inbox is:unread"`)
);

// ─── 1. inboxCategoryQ — query token generation ───────────────────────────────

console.log("\n── 1. inboxCategoryQ — category query token generation ──");

check(
  'People tab returns bare "in:people" (no forced is:unread)',
  inboxSrc.includes(`return "in:people"`) &&
    !inboxSrc.includes(`return "in:people is:unread"`)
);

check(
  'Newsletters tab returns bare "in:newsletters" (no forced is:unread)',
  inboxSrc.includes(`return "in:newsletters"`) &&
    !inboxSrc.includes(`return "in:newsletters is:unread"`)
);

check(
  'Notifications tab returns bare "in:notifications" (no forced is:unread)',
  inboxSrc.includes(`return "in:notifications"`) &&
    !inboxSrc.includes(`return "in:notifications is:unread"`)
);

check(
  'All tab returns "in:inbox" (no forced is:unread)',
  inboxSrc.includes(`return "in:inbox";`) &&
    !inboxSrc.includes(`return "in:inbox is:unread"`)
);

// ─── 2. inboxQuery (page 1) — request generation ─────────────────────────────

console.log("\n── 2. inboxQuery page-1 request generation ──");

check(
  "Unread mode uses `${inboxCategoryQ} is:unread` template (works for all tabs)",
  inboxSrc.includes("`${inboxCategoryQ} is:unread`")
);

check(
  "All + Unread resolves to in:inbox is:unread via template (inboxCategoryQ=in:inbox)",
  // The template `${inboxCategoryQ} is:unread` where inboxCategoryQ="in:inbox"
  // produces "in:inbox is:unread" at runtime. Verify the template exists.
  inboxSrc.includes("`${inboxCategoryQ} is:unread`")
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

// Both inboxQuery (page 1) and loadMoreInbox (page 2+) use `${inboxCategoryQ} is:unread`
const templatePattern = "`${inboxCategoryQ} is:unread`";
const templateOccurrences = (inboxSrc.split(templatePattern).length - 1);
// At least 2 code-site occurrences (page 1 + page 2); a 3rd may appear in comments.
check(
  "Both inboxQuery and loadMoreInbox use `${inboxCategoryQ} is:unread` template (≥2 occurrences)",
  templateOccurrences >= 2,
  `found ${templateOccurrences} occurrence(s)`
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
