"use strict";
/**
 * Phase 6B — /api/gmail/messages response shape safety.
 *
 * Source-grep tests that pin three guarantees:
 *   A) All pre-existing fields are still present in LocalMessageSummary type and mapper.
 *   B) smartCategory is now additively included (type, SELECT, mapper).
 *   C) CRM linked-email consumers are NOT affected by the list endpoint's shape.
 *
 * No live server needed — everything is verified against source files.
 */

const fs = require("fs");
const path = require("path");

const LOCAL_MAILBOX = path.join(__dirname, "../server/services/local-mailbox.ts");
const EMAILS_TAB   = path.join(__dirname, "../client/src/components/emails-tab.tsx");
const GMAIL_INBOX  = path.join(__dirname, "../client/src/pages/gmail-inbox.tsx");

const mailboxSrc  = fs.readFileSync(LOCAL_MAILBOX, "utf8");
const emailsTab   = fs.readFileSync(EMAILS_TAB, "utf8");
const inboxSrc    = fs.readFileSync(GMAIL_INBOX, "utf8");

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

// ─── A. Pre-existing fields: type declaration ──────────────────────────────
console.log("\n[A] Pre-existing fields still present in LocalMessageSummary type");

const summaryTypeMatch = mailboxSrc.match(/export type LocalMessageSummary = \{([\s\S]*?)\};/);
const typeBody = summaryTypeMatch ? summaryTypeMatch[1] : "";

check(
  "LocalMessageSummary type exists and is exported",
  /export type LocalMessageSummary = \{/.test(mailboxSrc)
);
check(
  "id: string is present in type",
  /\bid\s*:\s*string/.test(typeBody)
);
check(
  "threadId: string is present in type",
  /\bthreadId\s*:\s*string/.test(typeBody)
);
check(
  "snippet: string is present in type",
  /\bsnippet\s*:\s*string/.test(typeBody)
);
check(
  "internalDate: string is present in type",
  /\binternalDate\s*:\s*string/.test(typeBody)
);
check(
  "labelIds: string[] is present in type",
  /\blabelIds\s*:\s*string\[\]/.test(typeBody)
);
check(
  "from: string is present in type",
  /\bfrom\s*:\s*string/.test(typeBody)
);
check(
  "fromName: string is present in type",
  /\bfromName\s*:\s*string/.test(typeBody)
);
check(
  "fromEmail: string is present in type",
  /\bfromEmail\s*:\s*string/.test(typeBody)
);
check(
  "to: string is present in type",
  /\bto\s*:\s*string/.test(typeBody)
);
check(
  "subject: string is present in type",
  /\bsubject\s*:\s*string/.test(typeBody)
);
check(
  "date: string is present in type",
  /\bdate\s*:\s*string/.test(typeBody)
);
check(
  "sourceAccountId?: number is present in type",
  /\bsourceAccountId\s*\??\s*:\s*number/.test(typeBody)
);

// ─── B. Phase 6B additive field: type, SELECT, mapper ─────────────────────
console.log("\n[B] Phase 6B: smartCategory added additively");

check(
  "smartCategory: string | null is present in LocalMessageSummary type",
  /\bsmartCategory\s*:\s*string \| null/.test(typeBody)
);
check(
  "smart_category column is in the SELECT clause",
  /SELECT[\s\S]*?smart_category[\s\S]*?FROM email_messages/.test(mailboxSrc)
);
check(
  "smart_category appears on the same SELECT line as other columns",
  /gmail_message_id[\s\S]{0,200}smart_category|smart_category[\s\S]{0,200}gmail_message_id/.test(mailboxSrc)
);
check(
  "mapper assigns smartCategory: r.smart_category ?? null",
  /smartCategory\s*:\s*r\.smart_category\s*\?\?\s*null/.test(mailboxSrc)
);
check(
  "mapper null-coalesces so null rows return null (not undefined)",
  mailboxSrc.includes("r.smart_category ?? null")
);

// ─── C. Existing mapper fields unchanged ──────────────────────────────────
console.log("\n[C] Mapper still maps all pre-existing fields");

const mapperMatch = mailboxSrc.match(/const messages: LocalMessageSummary\[\] = slice\.map\(r => \{([\s\S]*?)\}\);/);
const mapperBody = mapperMatch ? mapperMatch[1] : "";

check(
  "mapper assigns id from r.gmail_message_id",
  /\bid\s*:\s*r\.gmail_message_id/.test(mapperBody)
);
check(
  "mapper assigns threadId from r.gmail_thread_id",
  /\bthreadId\s*:\s*r\.gmail_thread_id/.test(mapperBody)
);
check(
  "mapper assigns snippet from r.snippet",
  /\bsnippet\s*:\s*r\.snippet/.test(mapperBody)
);
check(
  "mapper assigns internalDate from sentAt",
  /\binternalDate\s*:/.test(mapperBody) && /sentAt/.test(mapperBody)
);
check(
  "mapper assigns labelIds via parseLabelIds(r.label_ids)",
  /\blabelIds\s*:\s*parseLabelIds\(r\.label_ids\)/.test(mapperBody)
);
check(
  "mapper assigns from via fmtFrom()",
  /\bfrom\s*:\s*fmtFrom\(/.test(mapperBody)
);
check(
  "mapper assigns fromName from r.from_name",
  /\bfromName\s*:\s*r\.from_name/.test(mapperBody)
);
check(
  "mapper assigns fromEmail from r.from_email",
  /\bfromEmail\s*:\s*r\.from_email/.test(mapperBody)
);
check(
  "mapper assigns to via parseToList()",
  /\bto\s*:\s*parseToList\(/.test(mapperBody)
);
check(
  "mapper assigns subject from r.subject",
  /\bsubject\s*:\s*r\.subject/.test(mapperBody)
);
check(
  "mapper assigns date from sentAt",
  /\bdate\s*:\s*sentAt/.test(mapperBody)
);
check(
  "mapper assigns sourceAccountId from r.source_account_id",
  /\bsourceAccountId\s*:.*source_account_id/.test(mapperBody)
);

// ─── D. CRM linked-email safety ───────────────────────────────────────────
console.log("\n[D] CRM linked-email views are NOT affected by list endpoint shape");

check(
  "emails-tab.tsx fetches /full-body (per-message endpoint), not the list",
  // Phase 7.1: tab also fetches /attachments sub-path via queryKey containing
  // "/api/gmail/messages" — that's fine. The invariant is that the bare list
  // endpoint is never called; check for the list-only fetch pattern instead.
  emailsTab.includes("/full-body") && !emailsTab.includes('fetch("/api/gmail/messages"')
);
check(
  "emails-tab.tsx does NOT call the /api/gmail/messages list endpoint directly",
  !emailsTab.includes("queryKey: [\"/api/gmail/messages\"]") &&
  !emailsTab.includes("queryKey: ['/api/gmail/messages']")
);
check(
  "emails-tab.tsx reads gmailMessageId field (still present in response)",
  emailsTab.includes("gmailMessageId")
);
check(
  "emails-tab.tsx reads snippet field (still present in response)",
  emailsTab.includes(".snippet")
);
check(
  "emails-tab.tsx reads subject field (still present in response)",
  emailsTab.includes(".subject")
);
check(
  "emails-tab.tsx reads from field (still present in response)",
  emailsTab.includes(".from") || emailsTab.includes("fromEmail") || emailsTab.includes("fromName")
);

// ─── E. Gmail inbox consumer uses smartCategory with ?? fallback ──────────
console.log("\n[E] Gmail inbox consumer correctly uses smartCategory with label-id fallback");

check(
  "gmail-inbox.tsx reads m.smartCategory (new field)",
  inboxSrc.includes("m.smartCategory")
);
check(
  "gmail-inbox.tsx has ?? fallback to getEmailCategory(m.labelIds)",
  inboxSrc.includes("m.smartCategory ?? getEmailCategory(m.labelIds)")
);
check(
  "gmail-inbox.tsx still reads m.labelIds (existing field, fallback path)",
  inboxSrc.includes("m.labelIds")
);
check(
  "gmail-inbox.tsx still reads m.id (existing field)",
  inboxSrc.includes("m.id") || inboxSrc.includes(".id")
);
check(
  "gmail-inbox.tsx still reads m.threadId (existing field)",
  inboxSrc.includes("m.threadId")
);
check(
  "gmail-inbox.tsx still reads m.snippet (existing field)",
  inboxSrc.includes("m.snippet") || inboxSrc.includes(".snippet")
);
check(
  "gmail-inbox.tsx still reads m.from / m.fromName / m.fromEmail (existing fields)",
  inboxSrc.includes("m.fromName") || inboxSrc.includes("m.fromEmail") || inboxSrc.includes("m.from")
);
check(
  "gmail-inbox.tsx still reads m.subject (existing field)",
  inboxSrc.includes("m.subject") || inboxSrc.includes(".subject")
);
check(
  "gmail-inbox.tsx still reads m.date (existing field)",
  inboxSrc.includes("m.date") || inboxSrc.includes(".date")
);

// ─── F. Association safety — thread-associations endpoint is separate ──────
console.log("\n[F] Association engine uses separate thread-associations endpoint");

const assocSrc = fs.readFileSync(
  path.join(__dirname, "../tests/association-engine.test.js"),
  "utf8"
);
check(
  "association-engine.test.js uses /api/gmail/thread-associations/* (not list endpoint)",
  assocSrc.includes("/api/gmail/thread-associations/")
);
check(
  "association-engine.test.js does NOT call /api/gmail/messages list",
  !assocSrc.includes('"/api/gmail/messages"') && !assocSrc.includes("'/api/gmail/messages'")
);

// ─── Summary ──────────────────────────────────────────────────────────────
console.log("\n────────────────────────────────────────────────────────────");
console.log(`Phase 6B shape-safety: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
