/**
 * tests/smart-inbox-people-flipback.test.cjs
 *
 * Regression suite for the Smart Inbox PEOPLE "unread flip-back" bug.
 *
 * Bug: clicking an unread PEOPLE email removes the unread dot/bold immediately
 * (optimistic patch correct) but the row flips back to bold/dot within 1-2 s.
 *
 * Root cause: handleSelectMessage's .then() callback called
 *   queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] })
 * That 1-part prefix invalidation triggered an immediate background refetch of
 * inboxQuery. The refetch response can arrive before (or race) the mirror DB
 * write, returning the message still with UNREAD in label_ids, overwriting the
 * optimistic patch. PEOPLE messages land in the first-page of results (they are
 * fresh, human-sender emails) so they get overwritten; Newsletter/Notification
 * messages are often in inboxExtra (loaded via loadMore) and dedupById never
 * replaces them from the refetch result, so those categories don't flip back.
 *
 * Fix:
 *   - Removed the broad invalidateQueries(["/api/gmail/messages"]) from .then().
 *   - Added a re-application of setQueriesData (inbox + sent) in .then() to
 *     neutralise any concurrent sync-tick that re-added UNREAD to the cache.
 *   - invalidateBadgeQueries() is retained: it refreshes unread-count badges.
 *   - The 15 s inboxQuery poll provides eventual consistency for the message list.
 *
 * Checks:
 *   F1  handleSelectMessage's .then() no longer calls the broad
 *       invalidateQueries(["/api/gmail/messages"]).
 *   F2  handleSelectMessage's .then() re-applies setQueriesData for the inbox
 *       prefix after a successful mark-read response.
 *   F3  handleSelectMessage's .then() re-applies setQueriesData for the sent
 *       prefix (keeps sent-tab consistent too).
 *   F4  invalidateBadgeQueries() is still called inside the .then() callback.
 *   F5  The optimistic removeUnread patch (before the fetch) still removes UNREAD
 *       from the inbox cache prefix.
 *   F6  The optimistic removeUnread patch still updates inboxExtra state.
 *   F7  isOpenAndJustRead guard exists in smart-inbox-grouper.ts so PEOPLE
 *       messages stay visible in the PEOPLE section while being read.
 *   F8  groupSmartInbox correctly handles isOpenAndJustRead — message stays
 *       in the unread-people bucket when thread is open and was unread at click.
 *   F9  The row renderer derives unread state from msg.labelIds, not a separate
 *       isUnread field, so the optimistic labelIds patch is the sole source of truth.
 *   F10 The dot-unread element is gated on the local `unread` variable (labelIds).
 */

"use strict";

const fs   = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "assertion failed");
}

const INBOX_PATH   = path.resolve(__dirname, "../client/src/pages/gmail-inbox.tsx");
const GROUPER_PATH = path.resolve(__dirname, "../client/src/components/inbox/smart-inbox-grouper.ts");

const inboxSrc   = fs.readFileSync(INBOX_PATH,   "utf8");
const grouperSrc = fs.readFileSync(GROUPER_PATH, "utf8");

// ── Locate handleSelectMessage .then() block ─────────────────────────────────
// We find the fire-and-forget fetch for mark-read and extract the .then() body.
const markReadFetchIdx = inboxSrc.indexOf("fetch(`/api/gmail/messages/${msg.id}/mark-read`");
assert(markReadFetchIdx !== -1, "Could not locate mark-read fetch in gmail-inbox.tsx");

// The .then() callback starts after the fetch(...) block
const thenStart = inboxSrc.indexOf(".then(() => {", markReadFetchIdx);
assert(thenStart !== -1, ".then(() => { not found after mark-read fetch");

const thenEnd = inboxSrc.indexOf("}", thenStart + 13); // closing brace of .then body
// Grab a generous window around the .then block (up to 800 chars)
const thenBlock = inboxSrc.slice(thenStart, thenStart + 800);

// ── F1: broad invalidateQueries gone from .then() ────────────────────────────
console.log("\n── F1-F4: .then() callback after mark-read fetch ──");

test("F1: .then() does NOT call invalidateQueries(['/api/gmail/messages']) (broad invalidation removed)", () => {
  // The broad invalidation was:
  //   queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
  // It must NOT appear inside the .then() block.  We check the .then() block
  // specifically (not the whole file) because other places legitimately call it.
  const hasInvalidateInThen =
    thenBlock.includes('invalidateQueries({ queryKey: ["/api/gmail/messages"] })') ||
    thenBlock.includes("invalidateQueries({ queryKey: ['/api/gmail/messages'] })");
  assert(
    !hasInvalidateInThen,
    ".then() block still contains the broad invalidateQueries(['/api/gmail/messages']) call — flip-back bug not fixed"
  );
});

// ── F2: setQueriesData re-patch for inbox in .then() ────────────────────────
test("F2: .then() re-applies setQueriesData for inbox prefix (re-asserts read state)", () => {
  const hasInboxRepatch =
    thenBlock.includes('setQueriesData({ queryKey: ["/api/gmail/messages", "inbox"] }') ||
    thenBlock.includes("setQueriesData({ queryKey: ['/api/gmail/messages', 'inbox'] }");
  assert(hasInboxRepatch, ".then() block is missing the setQueriesData inbox re-patch");
});

// ── F3: setQueriesData re-patch for sent in .then() ─────────────────────────
test("F3: .then() re-applies setQueriesData for sent prefix", () => {
  const hasSentRepatch =
    thenBlock.includes('setQueriesData({ queryKey: ["/api/gmail/messages", "sent"] }') ||
    thenBlock.includes("setQueriesData({ queryKey: ['/api/gmail/messages', 'sent'] }");
  assert(hasSentRepatch, ".then() block is missing the setQueriesData sent re-patch");
});

// ── F4: invalidateBadgeQueries still present in .then() ──────────────────────
test("F4: .then() still calls invalidateBadgeQueries() for badge refresh", () => {
  assert(
    thenBlock.includes("invalidateBadgeQueries()"),
    ".then() block is missing invalidateBadgeQueries() — badge counts won't refresh"
  );
});

// ── F5-F6: Optimistic patch (before fetch) ───────────────────────────────────
console.log("\n── F5-F6: Optimistic patch before the fetch ──");

// Locate the handleSelectMessage function
const hsm = inboxSrc.indexOf("const handleSelectMessage = (msg: MessageSummary)");
assert(hsm !== -1, "handleSelectMessage not found");
// Extract from handleSelectMessage up to (but not including) the .then() block
const preThunk = inboxSrc.slice(hsm, thenStart);

test("F5: optimistic setQueriesData removes UNREAD from inbox cache before fetch", () => {
  const hasOptPatch =
    preThunk.includes('setQueriesData({ queryKey: ["/api/gmail/messages", "inbox"] }') ||
    preThunk.includes("setQueriesData({ queryKey: ['/api/gmail/messages', 'inbox'] }");
  assert(hasOptPatch, "Optimistic setQueriesData for inbox prefix not found in handleSelectMessage");
});

test("F6: optimistic update also patches inboxExtra local state", () => {
  assert(
    preThunk.includes("setInboxExtra("),
    "setInboxExtra optimistic patch missing from handleSelectMessage"
  );
});

// ── F7-F8: isOpenAndJustRead guard in grouper ────────────────────────────────
console.log("\n── F7-F8: isOpenAndJustRead guard in smart-inbox-grouper.ts ──");

test("F7: isOpenAndJustRead variable is defined in groupSmartInbox", () => {
  assert(
    grouperSrc.includes("isOpenAndJustRead"),
    "isOpenAndJustRead guard missing from smart-inbox-grouper.ts"
  );
});

test("F8: groupSmartInbox routes isOpenAndJustRead into unread buckets (keeps message in PEOPLE while reading)", () => {
  // The guard: if (unread || isOpenAndJustRead) { ... unreadPeople.push(m) ... }
  const hasUnreadOrGuard =
    grouperSrc.includes("unread || isOpenAndJustRead") ||
    grouperSrc.includes("isOpenAndJustRead || unread");
  assert(hasUnreadOrGuard, "groupSmartInbox does not use isOpenAndJustRead in the bucket dispatch");
});

// ── F9-F10: Row renderer reads labelIds as source of truth ───────────────────
console.log("\n── F9-F10: Row renderer unread state ──");

test("F9: Smart Inbox row renderer derives `unread` from msg.labelIds (not a separate field)", () => {
  // Line: const unread = isUnread(msg.labelIds);
  assert(
    inboxSrc.includes("const unread = isUnread(msg.labelIds)"),
    "Row renderer does not use isUnread(msg.labelIds) — unread state source changed"
  );
});

test("F10: unread dot element is gated on the local `unread` variable", () => {
  // {unread && <div ... data-testid={`dot-unread-${msg.id}`} />}
  assert(
    inboxSrc.includes("dot-unread-"),
    "dot-unread testid missing from Smart Inbox row — unread dot rendering changed"
  );
  assert(
    inboxSrc.includes("{unread && (") || inboxSrc.includes("{unread &&\n"),
    "Unread dot is not gated on the `unread` variable"
  );
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n────────────────────────────────────────────────────────────`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
console.log(`────────────────────────────────────────────────────────────`);
if (failed > 0) process.exit(1);
