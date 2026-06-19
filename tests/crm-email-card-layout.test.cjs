/**
 * crm-email-card-layout.test.cjs
 *
 * Source-grep tests that verify the Phase 7 CRM Email Experience Upgrade
 * layout, data fields, and component structure in emails-tab.tsx.
 *
 * These tests pin structural invariants without requiring a browser or
 * running server — they grep the component source to ensure the expected
 * elements and data-testid attributes exist.
 */

const fs = require("fs");
const path = require("path");

// ── Load source files ──────────────────────────────────────────────────────────

const emailsTabPath = path.join(__dirname, "../client/src/components/emails-tab.tsx");
const contactProfilePath = path.join(__dirname, "../client/src/pages/contact-profile.tsx");
const routesPath = path.join(__dirname, "../server/routes.ts");

const emailsTabSrc = fs.readFileSync(emailsTabPath, "utf8");
const contactProfileSrc = fs.readFileSync(contactProfilePath, "utf8");
const routesSrc = fs.readFileSync(routesPath, "utf8");

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

function assertContains(src, needle, label) {
  assert(src.includes(needle), `Expected source to contain: ${label || needle}`);
}

function assertNotContains(src, needle, label) {
  assert(!src.includes(needle), `Expected source NOT to contain: ${label || needle}`);
}

// ── Section 1: Type definitions ───────────────────────────────────────────────

console.log("\n[1] Type definitions");

test("EmailWithAssociation type includes toEmails field", () => {
  assertContains(emailsTabSrc, "toEmails", "toEmails in type");
});

test("EmailWithAssociation type includes ccEmails field", () => {
  assertContains(emailsTabSrc, "ccEmails", "ccEmails in type");
});

test("EmailWithAssociation type includes attachmentCount field", () => {
  assertContains(emailsTabSrc, "attachmentCount", "attachmentCount in type");
});

test("EmailThread type is declared for thread grouping", () => {
  assertContains(emailsTabSrc, "EmailThread", "EmailThread type");
});

// ── Section 2: Direction badge ─────────────────────────────────────────────────

console.log("\n[2] Direction badge (Inbound / Outbound)");

test("DirectionBadge component exists", () => {
  assertContains(emailsTabSrc, "function DirectionBadge", "DirectionBadge function");
});

test("DirectionBadge renders Outbound text", () => {
  assertContains(emailsTabSrc, "Outbound", "Outbound label");
});

test("DirectionBadge renders Inbound text", () => {
  assertContains(emailsTabSrc, "Inbound", "Inbound label");
});

test("DirectionBadge has dynamic data-testid for direction", () => {
  assertContains(emailsTabSrc, 'badge-direction-${isOutbound ?', "badge-direction dynamic testid");
});

test("DirectionBadge testid includes outbound/inbound strings", () => {
  assertContains(emailsTabSrc, '"outbound"', "outbound string in testid template");
  assertContains(emailsTabSrc, '"inbound"', "inbound string in testid template");
});

test("DirectionBadge uses ArrowUpRight icon for outbound", () => {
  assertContains(emailsTabSrc, "ArrowUpRight", "ArrowUpRight icon");
});

test("DirectionBadge uses ArrowDownLeft icon for inbound", () => {
  assertContains(emailsTabSrc, "ArrowDownLeft", "ArrowDownLeft icon");
});

// ── Section 3: Collapsed card layout ──────────────────────────────────────────

console.log("\n[3] Collapsed card layout");

test("Thread card has data-testid thread-card-{threadId}", () => {
  assertContains(emailsTabSrc, "thread-card-${thread.threadId}", "thread-card testid");
});

test("Thread toggle button has data-testid", () => {
  assertContains(emailsTabSrc, "button-toggle-thread-${thread.threadId}", "button-toggle-thread testid");
});

test("Collapsed card shows subject", () => {
  assertContains(emailsTabSrc, "latest.subject", "subject in collapsed");
});

test("Collapsed card shows sender", () => {
  assertContains(emailsTabSrc, "Sent by you", "Sent by you for outbound");
  assertContains(emailsTabSrc, "latest.fromName", "fromName for inbound");
});

test("Collapsed card shows date via formatEmailDate", () => {
  assertContains(emailsTabSrc, "formatEmailDate(latest.sentAt)", "date in collapsed");
});

test("Collapsed card shows snippet when not expanded", () => {
  assertContains(emailsTabSrc, "latest.snippet", "snippet in collapsed");
});

test("DirectionBadge is rendered in collapsed thread header", () => {
  assertContains(emailsTabSrc, "<DirectionBadge isOutbound={isOutbound}", "DirectionBadge used in ThreadCard");
});

test("Attachment count chip shown in collapsed row", () => {
  assertContains(emailsTabSrc, "badge-attachment-count-${latest.id}", "attachment-count testid");
});

test("Attachment chip uses Paperclip icon", () => {
  assertContains(emailsTabSrc, "Paperclip", "Paperclip icon");
});

// ── Section 4: Thread count badge ─────────────────────────────────────────────

console.log("\n[4] Thread count badge");

test("Thread count badge has data-testid badge-thread-count", () => {
  assertContains(emailsTabSrc, "badge-thread-count-${thread.threadId}", "badge-thread-count testid");
});

test("Thread count badge shows message count", () => {
  assertContains(emailsTabSrc, "thread.messages.length", "thread.messages.length in count badge");
});

test("Thread count badge uses Users icon", () => {
  assertContains(emailsTabSrc, "Users", "Users icon in thread count");
});

test("Thread count badge only shows when hasMultiple", () => {
  assertContains(emailsTabSrc, "hasMultiple", "hasMultiple guard on thread count badge");
});

// ── Section 5: Expanded card — thread summary header ──────────────────────────

console.log("\n[5] Expanded card — thread summary header");

test("Thread summary header has data-testid", () => {
  assertContains(emailsTabSrc, "thread-summary-header-${thread.threadId}", "thread-summary-header testid");
});

test("Thread summary header only shown when hasMultiple", () => {
  assertContains(emailsTabSrc, "{thread.hasMultiple && (", "hasMultiple guard on thread summary");
});

test("Thread summary shows message count and date range", () => {
  assertContains(emailsTabSrc, "thread.messages.length} messages", "message count text in thread summary");
  assertContains(emailsTabSrc, "thread.messages[0].sentAt", "date range in thread summary");
});

// ── Section 6: Expanded card — recipients ─────────────────────────────────────

console.log("\n[6] Expanded card — recipients (To / CC)");

test("Recipients block has data-testid", () => {
  assertContains(emailsTabSrc, "recipients-block-${email.id}", "recipients-block testid");
});

test("To field shown when toEmails is present", () => {
  assertContains(emailsTabSrc, "to-field-${email.id}", "to-field testid");
  assertContains(emailsTabSrc, "email.toEmails", "email.toEmails display");
});

test("CC field shown when ccEmails is present", () => {
  assertContains(emailsTabSrc, "cc-field-${email.id}", "cc-field testid");
  assertContains(emailsTabSrc, "email.ccEmails", "email.ccEmails display");
});

test("From field always shown in expanded view", () => {
  assertContains(emailsTabSrc, "email.fromEmail", "fromEmail in expanded");
  assertContains(emailsTabSrc, "email.fromName", "fromName in expanded");
});

// ── Section 7: Expanded card — full body ──────────────────────────────────────

console.log("\n[7] Expanded card — full body rendering");

test("FullBodyViewer component renders HTML bodies", () => {
  assertContains(emailsTabSrc, "email-full-body-html", "email-full-body-html testid");
});

test("FullBodyViewer component renders plain text bodies", () => {
  assertContains(emailsTabSrc, "email-full-body-text", "email-full-body-text testid");
});

test("FullBodyViewer has loading state", () => {
  assertContains(emailsTabSrc, "email-body-loading", "email-body-loading testid");
});

test("FullBodyViewer uses sanitizeRichText for HTML", () => {
  assertContains(emailsTabSrc, "sanitizeRichText", "sanitizeRichText used");
});

// ── Section 8: Expanded card — attachments ─────────────────────────────────────

console.log("\n[8] Expanded card — attachment count");

test("Attachment count shown in message body when > 0", () => {
  assertContains(emailsTabSrc, "attachment-count-${email.id}", "attachment-count-{id} testid");
});

test("Attachment count displays count number", () => {
  assertContains(emailsTabSrc, "email.attachmentCount", "email.attachmentCount display");
});

test("Attachment section has hint to open in VS Mail", () => {
  assertContains(emailsTabSrc, "Open in VS Mail to download", "VS Mail download hint");
});

// ── Section 9: Open in VS Mail button ─────────────────────────────────────────

console.log("\n[9] Open in VS Mail button");

test("Open in VS Mail button exists with correct data-testid", () => {
  assertContains(emailsTabSrc, "button-open-vsmail-${email.id}", "button-open-vsmail testid");
});

test("Open in VS Mail button navigates via setLocation (no window.open)", () => {
  assertContains(emailsTabSrc, "setLocation(`/gmail?", "setLocation to /gmail");
  assertNotContains(emailsTabSrc, "window.open", "no window.open");
});

test("Open in VS Mail routes to /gmail with thread parameter", () => {
  assertContains(emailsTabSrc, "thread: email.gmailThreadId", "thread param");
});

test("Open in VS Mail includes account parameter when sourceAccountId present", () => {
  assertContains(emailsTabSrc, "email.sourceAccountId", "sourceAccountId in URL");
});

test("Open in VS Mail label text correct", () => {
  assertContains(emailsTabSrc, "Open in VS Mail", "Open in VS Mail label");
});

test("No mail.google.com URLs in emails-tab.tsx", () => {
  assertNotContains(emailsTabSrc, "mail.google.com", "no Gmail URLs in emails-tab");
});

// ── Section 10: Confirm / Remove link buttons ──────────────────────────────────

console.log("\n[10] Confirm / Remove link buttons");

test("Confirm link button has data-testid", () => {
  assertContains(emailsTabSrc, "button-confirm-assoc-${email.id}", "button-confirm-assoc testid");
});

test("Remove link button has data-testid", () => {
  assertContains(emailsTabSrc, "button-remove-assoc-${email.id}", "button-remove-assoc testid");
});

// ── Section 11: Thread grouping logic ─────────────────────────────────────────

console.log("\n[11] Thread grouping logic");

test("threads computed with useMemo", () => {
  assertContains(emailsTabSrc, "useMemo<EmailThread[]>", "useMemo for threads");
});

test("Threads grouped by gmailThreadId", () => {
  assertContains(emailsTabSrc, "email.gmailThreadId", "grouping by gmailThreadId");
});

test("Threads sorted by latest sentAt descending", () => {
  assertContains(emailsTabSrc, "latest.sentAt", "sort by latest.sentAt");
});

test("handleToggleThread auto-expands latest message body", () => {
  assertContains(emailsTabSrc, "setExpandedMessageId(thread.latest.id)", "auto-expand latest message");
});

test("expandedThreadId state is used for thread open/close", () => {
  assertContains(emailsTabSrc, "expandedThreadId", "expandedThreadId state");
});

test("expandedMessageId state is used for message body open/close", () => {
  assertContains(emailsTabSrc, "expandedMessageId", "expandedMessageId state");
});

// ── Section 12: Count label ────────────────────────────────────────────────────

console.log("\n[12] Thread/email count label");

test("Count label has data-testid text-email-count", () => {
  assertContains(emailsTabSrc, "text-email-count", "text-email-count testid");
});

test("Count label shows thread count when grouping reduces cards", () => {
  assertContains(emailsTabSrc, "threadCount", "threadCount in label");
  assertContains(emailsTabSrc, "msgCount", "msgCount in label");
});

// ── Section 13: Engagement panel (preserved) ──────────────────────────────────

console.log("\n[13] Engagement panel preserved");

test("EngagementPanel component still exists", () => {
  assertContains(emailsTabSrc, "function EngagementPanel", "EngagementPanel function");
});

test("EngagementPanel still has engagement-panel testid", () => {
  assertContains(emailsTabSrc, "engagement-panel", "engagement-panel testid");
});

test("EngagementPanel shows hot-prospect indicator", () => {
  assertContains(emailsTabSrc, "engagement-hot-indicator", "engagement-hot-indicator testid");
});

test("EngagementPanel shown for outbound emails only", () => {
  assertContains(emailsTabSrc, "{isOutbound && (", "isOutbound guard on EngagementPanel");
});

// ── Section 14: Contact profile — EmailsTab added ─────────────────────────────

console.log("\n[14] Contact profile — EmailsTab");

test("Contact profile imports EmailsTab", () => {
  assertContains(contactProfileSrc, 'from "@/components/emails-tab"', "EmailsTab import");
});

test("Contact profile uses EmailsTab with objectType=contact", () => {
  assertContains(contactProfileSrc, 'objectType="contact"', "objectType contact in EmailsTab");
});

test("Contact profile imports Tabs components", () => {
  assertContains(contactProfileSrc, 'from "@/components/ui/tabs"', "Tabs import");
});

// ── Section 15: Backend — attachmentCount in API ──────────────────────────────

console.log("\n[15] Backend — attachmentCount in /api/crm-emails");

test("attachmentCount is in the CRM emails result map", () => {
  assertContains(routesSrc, "attachmentCount: attachCountMap[msg.id]", "attachmentCount in result");
});

test("Batch attachment query targets email_attachments table", () => {
  assertContains(routesSrc, "FROM email_attachments", "email_attachments query");
});

test("Attachment batch query excludes inline attachments", () => {
  assertContains(routesSrc, "is_inline IS NOT TRUE", "inline exclusion in batch query");
});

// ── Section 16: No unintended Gmail links in CRM email components ─────────────

console.log("\n[16] Gmail link audit");

test("No mail.google.com in emails-tab.tsx", () => {
  assertNotContains(emailsTabSrc, "mail.google.com", "no mail.google.com in emails-tab");
});

test("No gmail.google.com in emails-tab.tsx", () => {
  assertNotContains(emailsTabSrc, "gmail.google.com", "no gmail.google.com in emails-tab");
});

test("No Open in Gmail text in emails-tab.tsx", () => {
  assertNotContains(emailsTabSrc, "Open in Gmail", "no Open in Gmail text");
});

// ── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`CRM Email Card Layout — ${passed} passed, ${failed} failed`);

if (failures.length > 0) {
  console.log("\nFailed:");
  failures.forEach(f => console.log(`  ✗ ${f.name}: ${f.message}`));
}

if (failed > 0) process.exit(1);
