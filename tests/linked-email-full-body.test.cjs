/**
 * Regression: linked email full body + "Open in VS Mail" deep-link.
 *
 * Source-grep tests that pin the key invariants without spinning up
 * a browser (no Gmail API calls needed).
 */

"use strict";
const fs = require("fs");
const path = require("path");

const EMAILS_TAB = path.join(__dirname, "../client/src/components/emails-tab.tsx");
const GMAIL_INBOX = path.join(__dirname, "../client/src/pages/gmail-inbox.tsx");

const src = fs.readFileSync(EMAILS_TAB, "utf8");
const inboxSrc = fs.readFileSync(GMAIL_INBOX, "utf8");

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

console.log("\n── emails-tab.tsx ──────────────────────────────────");

check(
  "FullBodyViewer component is defined",
  src.includes("function FullBodyViewer(")
);

check(
  "FullBodyViewer fetches /api/gmail/messages/.../full-body",
  src.includes("/api/gmail/messages/full-body") &&
  src.includes("full-body")
);

check(
  "Expanded view renders FullBodyViewer (not raw snippet paragraph)",
  src.includes("<FullBodyViewer gmailMessageId={email.gmailMessageId}")
);

check(
  "Full HTML body rendered via dangerouslySetInnerHTML",
  src.includes("dangerouslySetInnerHTML") && src.includes("email-full-body-html")
);

check(
  "Plain-text body fallback renders in <pre>",
  src.includes("email-full-body-text")
);

check(
  "Snippet fallback exists when body fetch fails/empty",
  src.includes("email-full-body-snippet")
);

check(
  "HTML body is sanitized before render (sanitizeRichText)",
  src.includes("sanitizeRichText")
);

check(
  '"Open in Gmail" external link has been removed',
  !src.includes("mail.google.com") && !src.includes("Open in Gmail")
);

check(
  '"Open in VS Mail" button is present',
  src.includes("Open in VS Mail")
);

check(
  '"Open in VS Mail" uses internal setLocation (not window.open or <a target=_blank>)',
  src.includes("setLocation(") && !src.includes('target="_blank"')
);

check(
  "Navigation targets /gmail?thread=<gmailThreadId>",
  src.includes("/gmail?") && src.includes("thread: email.gmailThreadId")
);

check(
  "sourceAccountId included in URL params when available",
  src.includes("account") && src.includes("sourceAccountId")
);

check(
  "button-open-vsmail test-id present",
  src.includes("button-open-vsmail")
);

check(
  "useLocation imported from wouter",
  src.includes("useLocation") && src.includes("wouter")
);

check(
  "sanitizeRichText imported from sanitize-html",
  src.includes('from "@/lib/sanitize-html"')
);

check(
  "sourceAccountId field in EmailWithAssociation type",
  src.includes("sourceAccountId: number | null")
);

check(
  "FullBodyViewer has loading state (data-testid=email-body-loading)",
  src.includes("email-body-loading")
);

check(
  "FullBodyViewer staleTime set (5 min cache)",
  src.includes("staleTime: 5 * 60 * 1000")
);

console.log("\n── gmail-inbox.tsx ─────────────────────────────────");

check(
  "currentThreadAccountId reads ?account= URL param on init (deep-link support)",
  inboxSrc.includes('params.get("account")') &&
  inboxSrc.includes("currentThreadAccountId")
);

check(
  "Deep-link account param is validated as a number",
  inboxSrc.includes("!isNaN(Number(acct))")
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
