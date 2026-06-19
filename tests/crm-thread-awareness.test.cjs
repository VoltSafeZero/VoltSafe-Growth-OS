/**
 * crm-thread-awareness.test.cjs
 *
 * Source-grep tests that verify Phase 7 thread-awareness logic in
 * emails-tab.tsx — thread grouping, per-message expand, thread header,
 * and state management.
 */

const fs = require("fs");
const path = require("path");

const emailsTabPath = path.join(__dirname, "../client/src/components/emails-tab.tsx");
const src = fs.readFileSync(emailsTabPath, "utf8");

// ── Test runner ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
    failures.push({ name, message: err.message });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed");
}

function assertContains(needle, label) {
  assert(src.includes(needle), `Expected source to contain: ${label || needle}`);
}

function assertNotContains(needle, label) {
  assert(!src.includes(needle), `Expected source NOT to contain: ${label || needle}`);
}

// ── Section 1: Thread data structure ──────────────────────────────────────────

console.log("\n[1] Thread data structure");

test("EmailThread type has threadId", () => {
  assertContains("threadId", "threadId in EmailThread");
});

test("EmailThread type has messages array", () => {
  assertContains("messages: EmailWithAssociation[]", "messages: EmailWithAssociation[]");
});

test("EmailThread type has latest (most recent message)", () => {
  assertContains("latest: EmailWithAssociation", "latest: EmailWithAssociation");
});

test("EmailThread type has hasMultiple boolean", () => {
  assertContains("hasMultiple: boolean", "hasMultiple: boolean");
});

// ── Section 2: Thread grouping algorithm ──────────────────────────────────────

console.log("\n[2] Thread grouping algorithm");

test("Emails grouped using Map keyed by gmailThreadId", () => {
  assertContains("Map<string, EmailWithAssociation[]>", "Map grouping");
});

test("Fallback key for emails without gmailThreadId", () => {
  assertContains("email.gmailThreadId || String(email.id)", "gmailThreadId fallback to String(id)");
});

test("Messages within a thread sorted newest-first", () => {
  assertContains("new Date(b.sentAt).getTime() : 0) - (a.sentAt", "sorting messages newest first");
});

test("Threads sorted by latest.sentAt descending", () => {
  assertContains("b.latest.sentAt", "sort threads by latest.sentAt");
});

test("hasMultiple set to true when thread has more than 1 message", () => {
  assertContains("hasMultiple: sorted.length > 1", "hasMultiple = sorted.length > 1");
});

test("useMemo used for thread grouping (avoids re-computation on unrelated state changes)", () => {
  assertContains("useMemo<EmailThread[]>", "useMemo<EmailThread[]>");
});

test("useMemo dependency is [emails]", () => {
  assertContains("}, [emails]);", "useMemo deps [emails]");
});

// ── Section 3: ThreadCard component ───────────────────────────────────────────

console.log("\n[3] ThreadCard component");

test("ThreadCard component is declared", () => {
  assertContains("function ThreadCard(", "ThreadCard function");
});

test("ThreadCard receives thread prop of type EmailThread", () => {
  assertContains("thread: EmailThread", "thread: EmailThread prop");
});

test("ThreadCard receives isExpanded prop", () => {
  assertContains("isExpanded: boolean", "isExpanded prop");
});

test("ThreadCard receives expandedMessageId prop", () => {
  assertContains("expandedMessageId: number | null", "expandedMessageId prop");
});

test("ThreadCard receives onToggleThread callback", () => {
  assertContains("onToggleThread: () => void", "onToggleThread callback");
});

test("ThreadCard receives onToggleMessage callback", () => {
  assertContains("onToggleMessage: (id: number) => void", "onToggleMessage callback");
});

// ── Section 4: MessageRow component ───────────────────────────────────────────

console.log("\n[4] MessageRow component");

test("MessageRow component is declared", () => {
  assertContains("function MessageRow(", "MessageRow function");
});

test("MessageRow receives isBodyOpen prop", () => {
  assertContains("isBodyOpen: boolean", "isBodyOpen prop");
});

test("MessageRow receives onToggleBody callback", () => {
  assertContains("onToggleBody: () => void", "onToggleBody callback");
});

test("MessageRow has data-testid email-message-row-{id}", () => {
  assertContains("email-message-row-${email.id}", "email-message-row testid");
});

test("MessageRow has data-testid button-toggle-message-{id}", () => {
  assertContains("button-toggle-message-${email.id}", "button-toggle-message testid");
});

test("MessageRow renders FullBodyViewer when isBodyOpen", () => {
  assertContains("<FullBodyViewer", "FullBodyViewer in MessageRow");
});

// ── Section 5: State management ───────────────────────────────────────────────

console.log("\n[5] State management");

test("expandedThreadId state initialized to null", () => {
  assertContains("useState<string | null>(null)", "expandedThreadId initialized to null");
});

test("expandedMessageId state initialized to null", () => {
  assertContains("useState<number | null>(null)", "expandedMessageId initialized to null");
});

test("handleToggleThread function exists", () => {
  assertContains("function handleToggleThread(", "handleToggleThread");
});

test("handleToggleThread collapses thread (sets null) when same thread clicked", () => {
  assertContains("setExpandedThreadId(null)", "collapse to null");
  assertContains("setExpandedMessageId(null)", "collapse message to null");
});

test("handleToggleThread auto-expands latest message body", () => {
  assertContains("setExpandedMessageId(thread.latest.id)", "auto-expand latest message");
});

test("handleToggleMessage toggles individual message body", () => {
  assertContains("function handleToggleMessage(", "handleToggleMessage");
});

test("handleToggleMessage closes already-open message", () => {
  assertContains("prev === msgId ? null : msgId", "toggle off when same message");
});

// ── Section 6: Thread UI — expand/collapse indicators ─────────────────────────

console.log("\n[6] Thread UI — expand / collapse indicators");

test("ChevronUp shown when thread is expanded", () => {
  assertContains("ChevronUp", "ChevronUp icon");
});

test("ChevronDown shown when thread is collapsed", () => {
  assertContains("ChevronDown", "ChevronDown icon");
});

test("Thread body area only rendered when isExpanded", () => {
  assertContains("{isExpanded && (", "isExpanded guard on thread body");
});

test("Message body only rendered when isBodyOpen", () => {
  assertContains("{isBodyOpen && (", "isBodyOpen guard on message body");
});

// ── Section 7: Thread renders list of MessageRow children ─────────────────────

console.log("\n[7] Thread expanded — MessageRow list");

test("ThreadCard maps thread.messages to MessageRow components", () => {
  assertContains("thread.messages.map((msg) => (", "thread.messages.map to MessageRow");
});

test("MessageRow key is message id", () => {
  assertContains("key={msg.id}", "key={msg.id}");
});

test("MessageRow passed email=msg prop", () => {
  assertContains("email={msg}", "email={msg} prop to MessageRow");
});

test("MessageRow body open state tied to expandedMessageId", () => {
  assertContains("isBodyOpen={expandedMessageId === msg.id}", "expandedMessageId === msg.id");
});

// ── Section 8: Multi-message thread summary header ────────────────────────────

console.log("\n[8] Multi-message thread summary header");

test("Thread summary header shown only when hasMultiple", () => {
  assertContains("{thread.hasMultiple && (", "hasMultiple guard on summary header");
});

test("Summary header shows message count", () => {
  assertContains("thread.messages.length}", "message count in summary");
});

test("Summary header shows date range (oldest → newest)", () => {
  assertContains("thread.messages[thread.messages.length - 1].sentAt", "oldest message date in range");
  assertContains("thread.messages[0].sentAt", "newest message date in range");
});

// ── Section 9: Thread count label in EmailsTab header ─────────────────────────

console.log("\n[9] EmailsTab header count label");

test("threadCount variable derived from threads.length", () => {
  assertContains("threads.length", "threads.length for threadCount");
});

test("msgCount variable derived from emails.length", () => {
  assertContains("emails.length", "emails.length for msgCount");
});

test("Count label shows both thread and email counts when they differ", () => {
  assertContains("threadCount === msgCount", "threadCount === msgCount comparison");
});

test("Count label handles singular/plural for threads", () => {
  assertContains("thread${threadCount !== 1", "thread plural");
});

test("Count label handles singular/plural for emails", () => {
  assertContains("email${msgCount !== 1", "email plural");
});

// ── Section 10: No duplicate message cards ────────────────────────────────────

console.log("\n[10] No duplicate message cards");

test("ThreadCard rendered per thread (not per email message)", () => {
  assertContains("threads.map((thread) => (", "threads.map for rendering");
});

test("emails.map is not used for rendering cards (avoids per-message duplication)", () => {
  assertNotContains("emails.map((email) => (", "emails.map would render per-message cards");
});

// ── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`CRM Thread Awareness — ${passed} passed, ${failed} failed`);

if (failures.length > 0) {
  console.log("\nFailed:");
  failures.forEach(f => console.log(`  ✗ ${f.name}: ${f.message}`));
}

if (failed > 0) process.exit(1);
