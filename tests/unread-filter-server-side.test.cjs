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
  'UNREAD label SQL filter uses ILIKE with quoted label (%"UNREAD"%)',
  localMailbox.includes(`label_ids ILIKE '%"UNREAD"%'`)
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
  inboxSrc.includes(`crmFilter === "unread" ? \`\${inboxCategoryQ} is:unread\``) ||
    inboxSrc.includes('crmFilter === "unread" ? `${inboxCategoryQ} is:unread`')
);

check(
  "inboxQuery q param falls back to inboxCategoryQ when not unread",
  // The ternary ends with `: inboxCategoryQ` — simple literal search is reliable
  inboxSrc.includes(": inboxCategoryQ") &&
    inboxSrc.includes("is:unread` : inboxCategoryQ") ||
    inboxSrc.includes("is:unread\` : inboxCategoryQ") ||
    /crmFilter === "unread"[\s\S]{0,80}inboxCategoryQ/.test(inboxSrc)
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

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(64)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
if (failed > 0) process.exit(1);
