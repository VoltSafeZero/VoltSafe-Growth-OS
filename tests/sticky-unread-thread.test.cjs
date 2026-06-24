"use strict";
// Regression test: Sticky Unread Thread — stay visible while selected
//
// Bug: Opening an unread email from the Unread mailbox caused it to disappear
// from the list ~10 s later even while the user was still reading it.
//
// Root cause: crmFilter="unread" sends "in:inbox is:unread" to the server.
// After mark-read + background refetch the server response excludes the now-read
// thread, evicting it from inboxQuery.data. The existing
// `|| m.threadId === selectedThreadId` guard at crmFilteredMessages only works
// while the thread is still in inboxMain — once evicted it cannot help.
//
// Fix (gmail-inbox.tsx):
//   1. stickyUnreadMessage state: saved as a "read" copy when user opens an
//      unread thread while crmFilter="unread".
//   2. allInboxMessages re-injects the sticky when its threadId is absent from
//      server data, so the thread stays in inboxMain → crmFilteredMessages.
//   3. sticky cleared: when navigating to a different thread, when
//      selectedThreadId becomes null, or when crmFilter changes away from "unread".
//   4. Injection guard uses threadId (not id) so a newer reply to the same thread
//      cannot create a ghost row.
//
// These are source-grep checks — they pin code structure without requiring a
// running dev server.

const fs   = require("fs");
const path = require("path");

const src = fs.readFileSync(
  path.join(__dirname, "../client/src/pages/gmail-inbox.tsx"),
  "utf8"
);

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

// ── 1. State declaration ───────────────────────────────────────────────────────

console.log("\n── 1. stickyUnreadMessage state declared ──");

check(
  "stickyUnreadMessage useState present",
  /useState<MessageSummary \| null>\(null\)/.test(src) &&
  /stickyUnreadMessage/.test(src)
);

check(
  "setStickyUnreadMessage setter present",
  /setStickyUnreadMessage/.test(src)
);

// ── 2. Sticky set on open (A→sticky) ─────────────────────────────────────────

console.log("\n── 2. Sticky set when opening unread thread from Unread filter ──");

check(
  "handleSelectMessage sets sticky when crmFilter=unread and isUnread",
  /crmFilter === .unread. && isUnread\(msg\.labelIds\)/.test(src) &&
  /setStickyUnreadMessage\(\{/.test(src)
);

check(
  "sticky copy has UNREAD stripped (labelIds filtered)",
  /setStickyUnreadMessage\(\{\s*\.\.\.msg,\s*labelIds:\s*msg\.labelIds\.filter\(l => l !== .UNREAD.\)/.test(src)
);

check(
  "sticky copy does not retain UNREAD label (stripped at save time)",
  // The save strips UNREAD so the row renders as read — no bold / no dot
  src.includes('labelIds: msg.labelIds.filter(l => l !== "UNREAD")')
);

// ── 3. A disappears when B is clicked (sticky handoff) ────────────────────────

console.log("\n── 3. Old sticky released when navigating to a different thread ──");

check(
  "different-thread guard clears old sticky in handleSelectMessage",
  /stickyUnreadMessage\.threadId !== msg\.threadId/.test(src) &&
  /setStickyUnreadMessage\(null\)/.test(src)
);

check(
  "guard condition checks stickyUnreadMessage truthiness before accessing .threadId",
  /stickyUnreadMessage && stickyUnreadMessage\.threadId !== msg\.threadId/.test(src)
);

// ── 4. B stays visible — re-injection after refetch ───────────────────────────

console.log("\n── 4. Sticky thread re-injected into allInboxMessages after server eviction ──");

check(
  "allInboxMessages useMemo checks stickyUnreadMessage",
  /stickyUnreadMessage && !messages\.some/.test(src)
);

check(
  "injection guard uses threadId (not message id) to prevent ghost rows",
  /m\.threadId === stickyUnreadMessage\.threadId/.test(src)
);

check(
  "injection prepends sticky before other messages",
  /dedupById\(\[stickyUnreadMessage,\s*\.\.\.messages\]\)/.test(src)
);

check(
  "allInboxMessages depends on stickyUnreadMessage",
  // The useMemo dep array must include stickyUnreadMessage
  /\[inboxQuery\.data,\s*inboxExtra,\s*stickyUnreadMessage\]/.test(src)
);

// ── 5. No duplicate rows ──────────────────────────────────────────────────────

console.log("\n── 5. No duplicate rows ──");

check(
  "dedupById called on injected array",
  // injection path: dedupById([sticky, ...messages])
  /dedupById\(\[stickyUnreadMessage/.test(src)
);

check(
  "injection only fires when threadId is absent from current messages",
  // The !messages.some(...) guard prevents injection when thread already present
  /!messages\.some\(m => m\.threadId === stickyUnreadMessage\.threadId\)/.test(src)
);

// ── 6. Sticky cleared on thread deselect / filter change ─────────────────────

console.log("\n── 6. Sticky cleared when user leaves unread context ──");

check(
  "useEffect clears sticky when selectedThreadId becomes null",
  /!selectedThreadId.*setStickyUnreadMessage\(null\)|setStickyUnreadMessage\(null\).*!selectedThreadId/.test(src) ||
  // multiline — just check the effect body contains both the condition and the clear
  (src.includes("!selectedThreadId") && src.includes("setStickyUnreadMessage(null)"))
);

check(
  "useEffect clears sticky when crmFilter changes away from unread",
  /crmFilter !== .unread./.test(src) &&
  // same block uses setStickyUnreadMessage(null)
  src.includes('setStickyUnreadMessage(null)')
);

check(
  "useEffect depends on selectedThreadId and crmFilter",
  /\[\s*selectedThreadId,\s*crmFilter\s*\]/.test(src)
);

// ── 7. Unread count not double-counted ────────────────────────────────────────

console.log("\n── 7. Sticky does not inflate unread count ──");

check(
  "inboxUnreadCount counts isUnread(labelIds) — sticky has UNREAD stripped so excluded",
  /inboxUnreadCount.*isUnread\(m\.labelIds\)/.test(src)
);

check(
  "crmFilteredMessages unread guard still uses isUnread || selectedThreadId",
  /isUnread\(m\.labelIds\)\s*\|\|\s*m\.threadId === selectedThreadId/.test(src)
);

// ── 8. openThreadWasUnread preserved (smart-inbox grouper compat) ─────────────

console.log("\n── 8. Smart-inbox grouper compatibility preserved ──");

check(
  "openThreadWasUnread still set in handleSelectMessage",
  /setOpenThreadWasUnread\(isUnread\(msg\.labelIds\)\)/.test(src)
);

check(
  "openThreadId and openThreadWasUnread still passed to groupSmartInbox",
  /openThreadId:\s*selectedThreadId/.test(src) &&
  /openThreadWasUnread/.test(src)
);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("\nSome checks failed — sticky unread invariants are not met.");
  process.exit(1);
}
console.log("\nAll sticky-unread-thread checks passed.");
