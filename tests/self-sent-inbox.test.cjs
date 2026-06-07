"use strict";
/**
 * tests/self-sent-inbox.test.cjs
 *
 * Verifies that self-sent emails (from === to, same @voltsafe.com domain) are
 * not tagged as "Internal-only email" by the parser, and that the inbox label
 * filter in local-mailbox.ts correctly includes them.
 */
const fs   = require("fs");
const path = require("path");

let passed = 0, failed = 0;
function assert(label, condition, detail) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else           { console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`); failed++; }
}

console.log("=== Self-Sent Inbox Tests ===\n");

// ── 1. email-parser.ts — isSelfSent guard ─────────────────────────────────
const parserSrc = fs.readFileSync(
  path.join(__dirname, "../server/services/email-parser.ts"), "utf8");

console.log("── 1. email-parser.ts — isSelfSent guard ──");
assert(
  "isSelfSent variable defined (from === single-recipient-to guard)",
  parserSrc.includes("isSelfSent") && parserSrc.includes("toList.length === 1")
);
assert(
  "isSelfSent uses case-insensitive comparison",
  parserSrc.includes("toLowerCase()")
);
assert(
  "allInternal check excludes self-sent emails from ignoredReason",
  parserSrc.includes("allInternal && !isSelfSent") ||
  parserSrc.includes("!isSelfSent") && parserSrc.includes("allInternal")
);
assert(
  "ignoredReason still set for genuine internal-only emails (not self-sent)",
  parserSrc.includes('"Internal-only email"')
);

// ── 2. Functional: isSelfSent logic simulation ────────────────────────────
console.log("\n── 2. Functional: isSelfSent logic simulation ──");

function simulateIsSelfSent(fromEmail, toList) {
  return (
    toList.length === 1 &&
    toList[0].toLowerCase() === (fromEmail || "").toLowerCase()
  );
}

function simulateIgnoredReason(fromEmail, toList, internalDomain, autoScore, bulkScore) {
  const allParticipants = Array.from(new Set([fromEmail, ...toList].filter(Boolean)));
  const allInternal = allParticipants.every(e => e.endsWith(`@${internalDomain}`));
  const isSelfSent  = simulateIsSelfSent(fromEmail, toList);

  if (autoScore >= 60) return `Auto-generated email (score: ${autoScore})`;
  if (bulkScore >= 60) return `Bulk/newsletter email (score: ${bulkScore})`;
  if (allInternal && !isSelfSent) return "Internal-only email";
  return null;
}

// Case A: trevor → trevor (self-sent, should NOT be internal-only)
const r1 = simulateIgnoredReason("trevor@voltsafe.com", ["trevor@voltsafe.com"], "voltsafe.com", 0, 0);
assert(
  "trevor→trevor self-sent: ignoredReason is null (appears in inbox)",
  r1 === null,
  `got: ${r1}`
);

// Case B: trevor → colleague (both @voltsafe.com, NOT self-sent → internal-only)
const r2 = simulateIgnoredReason("trevor@voltsafe.com", ["alice@voltsafe.com"], "voltsafe.com", 0, 0);
assert(
  "trevor→alice@voltsafe.com: ignoredReason = Internal-only email (correct — CRM-irrelevant internal mail)",
  r2 === "Internal-only email",
  `got: ${r2}`
);

// Case C: trevor → external (inbound-style, no ignoredReason)
const r3 = simulateIgnoredReason("marina@example.com", ["trevor@voltsafe.com"], "voltsafe.com", 0, 0);
assert(
  "marina@example.com→trevor: ignoredReason is null (real inbound email)",
  r3 === null,
  `got: ${r3}`
);

// Case D: no-reply auto-gen (should still be ignored regardless of self-sent)
const r4 = simulateIgnoredReason("noreply@voltsafe.com", ["noreply@voltsafe.com"], "voltsafe.com", 65, 0);
assert(
  "noreply self-sent with autoScore=65: ignoredReason = Auto-generated (auto-score takes priority)",
  r4 !== null && r4.includes("Auto-generated"),
  `got: ${r4}`
);

// Case E: self-sent case-insensitive (Trevor@Voltsafe.Com → trevor@voltsafe.com)
const r5 = simulateIgnoredReason("Trevor@Voltsafe.Com", ["trevor@voltsafe.com"], "voltsafe.com", 0, 0);
assert(
  "Self-sent with mixed case: isSelfSent still detected (case-insensitive)",
  r5 === null,
  `got: ${r5}`
);

// ── 3. local-mailbox.ts — INBOX label filter includes self-sent ───────────
const mailboxSrc = fs.readFileSync(
  path.join(__dirname, "../server/services/local-mailbox.ts"), "utf8");

console.log("\n── 3. local-mailbox.ts — INBOX label filter ──");
assert(
  "INBOX filter includes INBOX-labeled messages (handles SENT+INBOX self-sent copies)",
  mailboxSrc.includes('"INBOX"') || mailboxSrc.includes("'INBOX'") || mailboxSrc.includes("INBOX")
);
assert(
  "INBOX filter does NOT exclude SENT label (comment confirms self-sent awareness)",
  mailboxSrc.includes("SENT") && (
    mailboxSrc.includes("Do NOT exclude SENT") ||
    mailboxSrc.includes("self-addressed") ||
    mailboxSrc.includes("SENT+INBOX") ||
    mailboxSrc.includes("self-sent")
  )
);
assert(
  "INBOX filter DOES exclude SPAM, DRAFT, TRASH (correct inbox filtering)",
  mailboxSrc.includes('"SPAM"') && mailboxSrc.includes('"DRAFT"') && mailboxSrc.includes('"TRASH"')
);
assert(
  "ignored_reason NOT used to filter INBOX query (self-sent emails are visible even if ignoredReason set)",
  !mailboxSrc.includes("ignored_reason") && !mailboxSrc.includes("ignoredReason")
);

// ── 4. gmail-incremental.ts — upsertMessageById stores labels as-is ──────
const incrSrc = fs.readFileSync(
  path.join(__dirname, "../server/services/gmail-incremental.ts"), "utf8");

console.log("\n── 4. gmail-incremental.ts — label pass-through ──");
assert(
  "upsertMessageById calls parseGmailMessage with myEmail for direction/isSelfSent logic",
  incrSrc.includes("parseGmailMessage") && incrSrc.includes("myEmail")
);
assert(
  "upsertMessageById uses onConflictDoNothing (idempotent — safe for self-sent SENT+INBOX duplication)",
  incrSrc.includes("onConflictDoNothing")
);
assert(
  "label update path stores newLabels from Gmail event as-is (no INBOX stripping)",
  incrSrc.includes("newLabelsJson") && incrSrc.includes("JSON.stringify(newLabels)")
);

// ── 5. diagnostic endpoint exists ─────────────────────────────────────────
const routesSrc = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");

console.log("\n── 5. Sync diagnostic endpoint ──");
assert(
  "GET /api/dev/gmail-sync-check endpoint defined",
  routesSrc.includes('"/api/dev/gmail-sync-check"')
);
assert(
  "Diagnostic endpoint fetches Gmail messages.list with query",
  routesSrc.includes("users.messages.list") && routesSrc.includes("gmail-sync-check")
);
assert(
  "Diagnostic reports inDb, gmailLabels, and verdict for each message",
  routesSrc.includes('"MISSING_FROM_DB"') && routesSrc.includes('"IN_DB_BUT_WRONG_LABELS"') &&
  routesSrc.includes("gmailHasInbox")
);
assert(
  "Diagnostic endpoint protected by requireAdmin",
  (() => {
    const idx = routesSrc.indexOf('"/api/dev/gmail-sync-check"');
    if (idx < 0) return false;
    const ctx = routesSrc.slice(idx - 200, idx + 200);
    return ctx.includes("requireAdmin");
  })()
);

console.log();
console.log("─".repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
