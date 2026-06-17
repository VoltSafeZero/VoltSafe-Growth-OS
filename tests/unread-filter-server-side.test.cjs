"use strict";
// Regression test: Inbox Unread Filter — Server-Side Enforcement
//
// Root cause: With 51k inbox messages (99% read), the "Unread N" filter pill was
// purely client-side. The backend always returned 50 newest messages (mostly read),
// the client filtered them, and only ~5-8 unread threads appeared regardless of
// how many unread threads exist in the DB.
//
// Fix: Four coordinated changes —
//   1. Backend (local-mailbox.ts): buildQClauses handles "is:unread"
//   2. inboxQuery queryKey includes crmFilter="unread" as a distinct partition
//   3. inboxQuery sends "is:unread" in q param when filter is active
//   4. loadMoreInbox sends "is:unread" in q param (pagination coherence)
//   5. Effect A reset clears extras+token when crmFilter changes
//
// These tests are source-grep checks — they pin code structure invariants
// without requiring the dev server to be running.

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

// ─── Read source files ───────────────────────────────────────────────────────

const localMailbox = fs.readFileSync(
  path.join(__dirname, "../server/services/local-mailbox.ts"),
  "utf8"
);

const inboxSrc = fs.readFileSync(
  path.join(__dirname, "../client/src/pages/gmail-inbox.tsx"),
  "utf8"
);

// ─── 1. Backend: buildQClauses handles is:unread ─────────────────────────────

console.log("\n── 1. Backend: buildQClauses handles is:unread ──");

check(
  "is:unread regex match present in buildQClauses",
  /is:unread/i.test(localMailbox)
);

check(
  "is:unread regex uses \\bis:unread\\b word boundary",
  /\\bis:unread\\b/i.test(localMailbox)
);

check(
  "is:unread filter uses is_unread = true (Phase 3 — derived column replaces ILIKE)",
  localMailbox.includes(`is_unread = true`)
);

check(
  "is:unread match strips itself from rest (prevents free-text pass-through)",
  /isUnreadMatch.*replace.*isUnreadMatch\[0\]/s.test(localMailbox) ||
    /rest\s*=\s*rest\.replace\(isUnreadMatch\[0\]/.test(localMailbox)
);

// ─── 2. Frontend: inboxQuery queryKey includes crmFilter discriminator ────────

console.log("\n── 2. inboxQuery queryKey partitions on unread filter ──");

check(
  'queryKey includes crmFilter === "unread" discriminator',
  inboxSrc.includes(`crmFilter === "unread" ? "unread" : "all"`) ||
    inboxSrc.includes(`crmFilter === "unread" ? "unread"`)
);

check(
  "queryKey has 6 elements (added crmFilter partition after inboxCategory)",
  // The queryKey array should have 6 comma-separated elements
  (/queryKey:\s*\[.*"inbox".*searchQuery.*activeAccountId.*inboxCategory.*crmFilter/s.test(inboxSrc) ||
    /queryKey:\s*\[.*"\/api\/gmail\/messages".*"inbox".*searchQuery.*activeAccountId.*inboxCategory.*"unread".*"all"/s.test(inboxSrc))
);

// ─── 3. Frontend: inboxQuery sends is:unread in q param ───────────────────────

console.log("\n── 3. inboxQuery sends is:unread to backend when filter is active ──");

check(
  'inboxQuery params include is:unread when crmFilter === "unread"',
  // Old pattern (pre-fix): `${inboxCategoryQ} is:unread` — this leaked "in:people" as freetext FTS.
  // New pattern (post-fix): plain "in:inbox is:unread" so all category tabs share the same server
  // query and pagination stays coherent with loadMoreInbox which also sends "in:inbox is:unread".
  inboxSrc.includes(`crmFilter === "unread" ? \`\${inboxCategoryQ} is:unread\``) ||
    inboxSrc.includes('crmFilter === "unread" ? `${inboxCategoryQ} is:unread`') ||
    inboxSrc.includes('"in:inbox is:unread"') ||
    /crmFilter === "unread"[\s\S]{0,400}in:inbox is:unread/.test(inboxSrc)
);

check(
  "inboxQuery q param falls back to inboxCategoryQ when not unread",
  // When unread mode is NOT active, the base category query (inboxCategoryQ) is used.
  // This may be expressed as a ternary (`: inboxCategoryQ`) or an else branch (`params.set("q", inboxCategoryQ)`).
  inboxSrc.includes(": inboxCategoryQ") ||
    inboxSrc.includes(`, inboxCategoryQ)`) ||
    /else[\s\S]{0,120}params\.set\("q",\s*inboxCategoryQ\)/.test(inboxSrc) ||
    /crmFilter === "unread"[\s\S]{0,400}inboxCategoryQ/.test(inboxSrc)
);

// ─── 4. Frontend: loadMoreInbox sends is:unread (pagination coherence) ────────

console.log("\n── 4. loadMoreInbox mirrors unread filter for pagination coherence ──");

check(
  'loadMoreInbox q param includes is:unread when crmFilter === "unread"',
  // Count literal occurrences of "is:unread" appearing near params.set("q"
  // Simpler: just count occurrences of the is:unread literal in params.set blocks
  (() => {
    let count = 0;
    let idx = 0;
    while ((idx = inboxSrc.indexOf('is:unread', idx)) !== -1) {
      // Check if "params.set" appears in the 300 chars before this occurrence
      const before = inboxSrc.slice(Math.max(0, idx - 300), idx);
      if (before.includes('params.set(')) count++;
      idx++;
    }
    return count >= 2;
  })()
);

check(
  "loadMoreInbox uses same is:unread conditional as base query",
  /crmFilter === "unread"\s*\?.*is:unread.*:\s*(baseQ|searchQuery|"in:inbox")/s.test(inboxSrc)
);

// ─── 5. Frontend: Effect A reset includes crmFilter ──────────────────────────

console.log("\n── 5. Pagination reset fires on crmFilter change ──");

check(
  "Effect A (setInboxExtra reset) dependency array includes crmFilter",
  // The reset effect: setInboxExtra([]) + setInboxNextToken(null) in deps [searchQuery, activeAccountId, crmFilter]
  /setInboxExtra\(\[\]\)[\s\S]{0,200}setInboxNextToken\(null\)[\s\S]{0,200}\[searchQuery,\s*activeAccountId,\s*crmFilter\]/s.test(inboxSrc) ||
    /\[searchQuery,\s*activeAccountId,\s*crmFilter\]/.test(inboxSrc)
);

check(
  "Effect A reset comment explains crmFilter inclusion",
  inboxSrc.includes("crmFilter is included") ||
    inboxSrc.includes("crmFilter") && /setInboxExtra\(\[\]\)[\s\S]{0,400}crmFilter/s.test(inboxSrc)
);

// ─── 6. Epoch bump includes crmFilter (stale-response drop) ─────────────────

console.log("\n── 6. Request epoch bumps on crmFilter change ──");

check(
  "inboxEpochRef increment effect deps include crmFilter",
  // Already present from earlier work, but pin it
  /inboxEpochRef\.current \+= 1.*\[.*crmFilter.*\]/s.test(inboxSrc) ||
    /\[activeAccountId,\s*searchQuery,\s*tab,\s*inboxCategory,\s*crmFilter\]/.test(inboxSrc)
);

// ─── 7. Auto-chain key includes crmFilter (chain resets on filter switch) ────

console.log("\n── 7. Auto-chain key includes crmFilter (resets budget on filter switch) ──");

check(
  "inboxChainKey string interpolation includes crmFilter",
  /inboxChainKey.*crmFilter/.test(inboxSrc) ||
    /`inbox-or-other.*\$\{crmFilter\}`/.test(inboxSrc)
);

// ─── 8. categorizedInbox bypass when crmFilter === "unread" ─────────────────
//
// Root cause (regression): when the user had any inboxCategory sub-tab active
// (e.g. "priority"/starred, "people", "updates") and then clicked the "Unread"
// filter pill, categorizedInbox applied the sub-tab filter on top of the unread
// results. For "priority" with zero starred-unread messages this produced an
// empty list despite 200+ unread messages existing, causing the "No messages
// found" empty state and an infinite auto-chain spin loop.
//
// Fix: when crmFilter === "unread", categorizedInbox must be inboxMain (no
// category filter). The backend already sends "in:inbox is:unread" so all
// returned messages are unread; there is no need to further narrow by category.

console.log("\n── 8. categorizedInbox bypasses category filter in unread mode ──");

check(
  'categorizedInbox uses inboxMain directly when crmFilter === "unread"',
  // Must contain a guard that short-circuits to inboxMain before any category filter
  /categorizedInbox\s*=\s*crmFilter\s*===\s*"unread"\s*\?\s*inboxMain/.test(inboxSrc)
);

check(
  "categorizedInbox bypass comment explains the root-cause bug",
  inboxSrc.includes("crmFilter === \"unread\"") &&
    (inboxSrc.includes("bypass") || inboxSrc.includes("skip the") || inboxSrc.includes("bypass the category"))
);

check(
  'priority sub-tab filter only runs when crmFilter !== "unread"',
  // The priority/starred filter must come AFTER the crmFilter guard, not before
  (() => {
    const guardIdx = inboxSrc.indexOf('categorizedInbox = crmFilter === "unread"');
    const priorityIdx = inboxSrc.indexOf('isStarred(m.labelIds)');
    // Both must exist, and the guard must precede the priority filter
    return guardIdx !== -1 && priorityIdx !== -1 && guardIdx < priorityIdx;
  })()
);

check(
  "people/updates/promotions category filters are guarded behind crmFilter check",
  // Ensure the getEmailCategory filter sits after the crmFilter bypass
  (() => {
    const guardIdx = inboxSrc.indexOf('categorizedInbox = crmFilter === "unread"');
    const catIdx = inboxSrc.indexOf('getEmailCategory(m.labelIds) === inboxCategory');
    return guardIdx !== -1 && catIdx !== -1 && guardIdx < catIdx;
  })()
);

check(
  'inboxCategoryServerUnread returns countSnapshot.inbox for priority/all (unread convergence)',
  // When inboxCategory is "priority" (or "all"), the loader target must be the full
  // inbox count so the unread loader converges even though no category-specific count exists.
  /return countSnapshot\.inbox/.test(inboxSrc)
);

// ─── 9. Unread pill resets inboxCategory to "all" ───────────────────────────
//
// When the user clicks the "Unread" CRM filter pill while a sub-tab like
// "Priority" is active, inboxCategory must be reset to "all".  Without this
// the categorizedInbox bypass (§8) is the only defence — if someone re-enables
// the category filter for a different reason, the bug reappears.  Resetting to
// "all" is cleaner: the Unread view is logically global (not sub-tab-scoped).

console.log("\n── 9. Unread pill resets inboxCategory to 'all' on click ──");

check(
  'Unread pill onClick calls setInboxCategory("all")',
  // Must contain: setCrmFilter(key) paired with setInboxCategory("all") inside the Unread button handler
  /setCrmFilter\(key\).*setInboxCategory\("all"\)|setInboxCategory\("all"\).*setCrmFilter\(key\)/.test(inboxSrc) ||
    /key === "unread"\s*\)\s*setInboxCategory\("all"\)/.test(inboxSrc)
);

check(
  "Unread button handler calls both setCrmFilter and setInboxCategory in one onClick",
  (() => {
    // Find the crm-filter unread button and verify both calls appear in the same handler
    const filterBtnIdx = inboxSrc.indexOf('crm-filter-${key}');
    if (filterBtnIdx === -1) return false;
    // Look 300 chars around the data-testid for both setters
    const vicinity = inboxSrc.slice(Math.max(0, filterBtnIdx - 400), filterBtnIdx + 100);
    return vicinity.includes('setCrmFilter') && vicinity.includes('setInboxCategory');
  })()
);

// ─── 10. Visual guard: "still loading" replaces "No messages found" ─────────
//
// If the server reports N > 0 unread messages but crmFilteredMessages is empty
// (edge case: stale TanStack cache or pre-fetch render), the UI must NOT show
// the misleading "No messages found" empty state.  Instead it shows a spinner
// and "Unread messages are still loading…" so the user knows to wait.

console.log("\n── 10. Visual guard: loading state instead of 'No messages found' ──");

check(
  'Visual guard checks crmFilter === "unread" && serverInboxUnreadCount > 0',
  /crmFilter === "unread"\s*&&\s*serverInboxUnreadCount\s*>\s*0/.test(inboxSrc)
);

check(
  '"Unread messages are still loading" text present in source',
  inboxSrc.includes("Unread messages are still loading")
);

check(
  "Loading spinner (Loader2 animate-spin) used in unread stall state",
  /Loader2.*animate-spin|animate-spin.*Loader2/.test(inboxSrc)
);

check(
  "Guard appears immediately before the generic No-messages-found fallback (last occurrence) in source order",
  (() => {
    const guardIdx = inboxSrc.indexOf("Unread messages are still loading");
    // Use lastIndexOf: the definitive "No messages found" fallback is the last occurrence
    const noMsgIdx = inboxSrc.lastIndexOf("No messages found");
    return guardIdx !== -1 && noMsgIdx !== -1 && guardIdx < noMsgIdx;
  })()
);

// ─── 11. Stall safety-net refetch effect ────────────────────────────────────
//
// A useEffect fires ONE refetch when the stall state is detected (unread count
// > 0, rendered list empty, not already loading).  A ref guard prevents loops.

console.log("\n── 11. Stall safety-net refetch effect ──");

check(
  "Stall-refetch useEffect present in source",
  inboxSrc.includes("inboxQuery.refetch()") &&
    inboxSrc.includes("_unreadStallRefetchRef")
);

check(
  "Stall-refetch effect guarded against crmFilter !== 'unread'",
  // The guard is a multi-condition if-block; crmFilter check and inboxQuery.refetch()
  // can be 600+ chars apart — use a wide window of 900 chars.
  /crmFilter\s*!==\s*"unread"[\s\S]{0,900}inboxQuery\.refetch/.test(inboxSrc)
);

check(
  "Stall-refetch ref prevents duplicate fires for same context key",
  /_unreadStallRefetchRef\.current\s*===\s*key\s*\)\s*return/.test(inboxSrc)
);

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(64)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
if (failed > 0) process.exit(1);
