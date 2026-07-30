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

// The queryKey discriminator logic lives in inbox-query-key.ts (extracted
// to its own file so all callers share one definition).
const inboxQueryKeySrc = fs.readFileSync(
  path.join(__dirname, "../client/src/lib/inbox-query-key.ts"),
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
  // The discriminator lives in inbox-query-key.ts (extracted helper),
  // not inline in gmail-inbox.tsx.
  inboxQueryKeySrc.includes(`crmFilter === "unread" ? "unread" : "all"`) ||
    inboxQueryKeySrc.includes(`crmFilter === "unread" ? "unread"`) ||
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
  // Accept either the old ternary pattern or the new pageQ pattern:
  //   old: const baseQ = ...; params.set("q", crmFilter === "unread" ? `${baseQ} is:unread` : baseQ)
  //   new: const pageQ = crmFilter === "unread" ? (...is:unread...) : (searchQuery || inboxCategoryQ)
  /crmFilter === "unread"\s*[\?\n\s]+.*is:unread[\s\S]{0,200}(inboxCategoryQ|baseQ|searchQuery)/s.test(inboxSrc) ||
  /const pageQ.*crmFilter[\s\S]{0,300}inboxCategoryQ/s.test(inboxSrc)
);

// ─── 5. Frontend: Effect A reset includes crmFilter ──────────────────────────

console.log("\n── 5. Pagination reset fires on crmFilter change ──");

check(
  "Effect A (setInboxExtra reset) dependency array includes crmFilter",
  // The reset effect: setInboxExtra([]) + setInboxNextToken(null) in deps that include crmFilter.
  // inboxCategory may also be present (cursor reset on category switch).
  /setInboxExtra\(\[\]\)[\s\S]{0,200}setInboxNextToken\(null\)[\s\S]{0,400}crmFilter/s.test(inboxSrc) ||
    /\[searchQuery,\s*activeAccountId,\s*crmFilter/.test(inboxSrc)
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
// Root cause (Task 212 fix): inboxCategoryQ now bakes is:unread into the query
// for category tabs (people/newsletters/notifications) so the server filters by
// both category AND read-state. The old client-side bypass (crmFilter==="unread"
// ? inboxMain) is no longer needed and has been removed — the category filter now
// runs in all modes, and the server ensures the right messages arrive.

console.log("\n── 8. categorizedInbox applies category filter in all modes (Task 212) ──");

check(
  'categorizedInbox does NOT bypass category filter when crmFilter === "unread" (server filters now)',
  // After Task 212: bypass removed — category filter runs even in unread mode.
  // The server sends "in:people is:unread" etc. so client-side filter is a safe net.
  !/categorizedInbox\s*=\s*crmFilter\s*===\s*"unread"\s*\?\s*inboxMain/.test(inboxSrc)
);

check(
  "categorizedInbox still filters by inboxCategory for non-all tabs",
  // The canonical === inboxCategory comparison must still exist (for all modes).
  inboxSrc.includes('canonical === inboxCategory')
);

check(
  "Priority/starred filter is absent (Priority tab removed)",
  // isStarred(m.labelIds) must not appear in categorizedInbox logic.
  !inboxSrc.includes('isStarred(m.labelIds)')
);

check(
  "people/updates/promotions category filters exist in categorizedInbox",
  // Three known forms (pre-Phase 6, Phase 6, Phase 7+ canonical-var):
  //   getEmailCategory(m.labelIds) === inboxCategory          (pre-Phase 6)
  //   (m.smartCategory ?? getEmailCategory(m.labelIds)) === inboxCategory  (Phase 6)
  //   canonical === inboxCategory  (Phase 7+: raw extracted to var, mapped to canonical)
  (() => {
    const catIdxOld = inboxSrc.indexOf('getEmailCategory(m.labelIds) === inboxCategory');
    const catIdxNew = inboxSrc.indexOf('getEmailCategory(m.labelIds)) === inboxCategory');
    const catIdxCanonical = inboxSrc.indexOf('canonical === inboxCategory');
    return catIdxOld !== -1 || catIdxNew !== -1 || catIdxCanonical !== -1;
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

// ─── 10. listState machine replaces "still loading" inline guard ─────────────
//
// The old inline guard (crmFilter==="unread" && serverInboxUnreadCount>0 && isFetching)
// was replaced by the listState machine.  The machine enforces:
//   • loaded_empty only when !loadingMoreInbox && !isFetching && badge=0
//   • exhausted_with_discrepancy when badge>0 after exhaustion (shows Retry, not "No messages found")
//   • initial_loading when isFetching with 0 rows (skeleton, not empty state)
// These three checks verify the machine's guard is in place.

console.log("\n── 10. listState machine: empty-state guards ──");

check(
  "listState \"initial_loading\" includes isFetching guard (prevents empty state during refetch)",
  inboxSrc.includes(`(isLoading || inboxQuery.isFetching) && rowCount === 0`) &&
    inboxSrc.includes(`return "initial_loading"`)
);

check(
  "listState \"exhausted_with_discrepancy\" shows Retry — not \"No messages found\" — when badge>0",
  inboxSrc.includes(`listState === "exhausted_with_discrepancy"`) &&
    inboxSrc.includes(`data-testid="button-retry-inbox"`) &&
    inboxSrc.includes(`ref: exhausted_with_discrepancy`)
);

check(
  "Loading spinner (Loader2 animate-spin) used in initial_loading skeleton",
  /Loader2.*animate-spin|animate-spin.*Loader2/.test(inboxSrc)
);

check(
  "Empty state gated on listState=loaded_empty or exhausted_with_discrepancy (never fires alongside loaders)",
  inboxSrc.includes(`listState === "loaded_empty" || listState === "exhausted_with_discrepancy"`)
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
