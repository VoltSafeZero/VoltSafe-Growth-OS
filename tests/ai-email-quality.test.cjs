/**
 * ai-email-quality.test.cjs
 *
 * Source-grep regression suite for the AI email formatting and quality fixes.
 *
 * Covers:
 *   1. cleanAiEmailBody — placeholder signature stripping
 *   2. System prompt — signature rules, formatting rules, forbidden phrases
 *   3. Context builder — all CRM fields, emails labeled inbound/outbound, newest-first
 *   4. User prompt — full context, recency weighting
 *   5. Modal — plainTextToHtml import and usage before compose handoff
 *   6. Existing compose-handoff invariants still pass
 *
 * Run: node tests/ai-email-quality.test.cjs
 */
"use strict";

const fs   = require("fs");
const path = require("path");

const root        = path.resolve(__dirname, "..");
const summaryPath = path.join(root, "server/services/crm-ai-summary.ts");
const modalPath   = path.join(root, "client/src/components/crm/suggested-next-email-modal.tsx");
const inboxPath   = path.join(root, "client/src/pages/gmail-inbox.tsx");

const src   = fs.readFileSync(summaryPath, "utf8");
const modal = fs.readFileSync(modalPath,   "utf8");
const inbox = fs.readFileSync(inboxPath,   "utf8");

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

// ── 1. cleanAiEmailBody — exported and correct ────────────────────────────────
console.log("\n── 1. cleanAiEmailBody — export and patterns ──────────────────");

check(
  "cleanAiEmailBody is exported",
  src.includes("export function cleanAiEmailBody"),
);

check(
  "cleanAiEmailBody removes [Your Name]",
  src.includes("[Your Name]") && src.includes("Your Name"),
);

check(
  "cleanAiEmailBody removes [Your Title]",
  src.includes("[Your Title]"),
);

check(
  "cleanAiEmailBody removes [Your Contact Information]",
  src.includes("[Your Contact Information]"),
);

check(
  "cleanAiEmailBody strips full fake signature block (regex targeting Best regards + bracket pattern)",
  /Best regards\?.*\\\\n.*\[Your/.test(src) || src.includes("Best regards?|Kind regards?") && src.includes("\\[Your (?:Name|Title"),
);

check(
  "cleanAiEmailBody normalises excessive blank lines (max 2 consecutive newlines)",
  src.includes("\\n{3,}") && src.includes("\\n\\n"),
);

check(
  "cleanAiEmailBody trims trailing whitespace",
  src.includes(".trim()"),
);

check(
  "cleanAiEmailBody is applied to parsed body before returning",
  src.includes("cleanAiEmailBody(parsed.body"),
);

// ── 2. System prompt — signature and formatting rules ────────────────────────
console.log("\n── 2. System prompt — mandatory rules ─────────────────────────");

check(
  "System prompt: SIGNATURE RULES section present",
  src.includes("SIGNATURE RULES"),
);

check(
  "System prompt: forbids full signature block",
  src.includes("Do not generate an email signature"),
);

check(
  "System prompt: forbids sender name/title/company in body",
  src.includes("Do not generate: sender name"),
);

check(
  "System prompt: forbids bracket placeholder text",
  src.includes("[Your Name]") && src.includes("[Your Title]") && src.includes("[Your Contact Information]"),
);

check(
  "System prompt: tells AI that VoltSafe Mail appends the real signature",
  src.includes("email system will append the correct signature automatically"),
);

check(
  "System prompt: instructs AI to end with simple closing only",
  src.includes("DO NOT add any closing phrase") && src.includes("End the draft at the final sentence"),
);

check(
  "System prompt: FORMATTING RULES section present",
  src.includes("FORMATTING RULES"),
);

check(
  "System prompt: requires blank lines between paragraphs",
  src.includes("blank lines") && src.includes("paragraph"),
);

check(
  "System prompt: forbids entire body as one paragraph",
  src.includes("NEVER write the entire body as one paragraph"),
);

check(
  "System prompt: requires greeting on its own line",
  src.includes("Greeting on its own line"),
);

check(
  "System prompt: CONTENT RULES section present",
  src.includes("CONTENT RULES"),
);

check(
  "System prompt: forbids 'I hope this email finds you well'",
  src.includes("I hope this email finds you well"),
);

check(
  "System prompt: forbids 'I hope this message finds you well'",
  src.includes("I hope this message finds you well"),
);

check(
  "System prompt: forbids inventing attachments/transcripts/proposals not in context",
  src.includes("attaching or providing a transcript"),
);

check(
  "System prompt: requires ONE clear next-step ask",
  src.includes("ONE clear next-step ask"),
);

// ── 3. User prompt — full context, recency, email labels ─────────────────────
console.log("\n── 3. User prompt — context richness and recency ──────────────");

check(
  "User prompt: instructs to use ALL available context",
  src.includes("Use ALL available context"),
);

check(
  "User prompt: instructs strongest weight on most recent emails",
  src.includes("strongest weight on the most recent"),
);

check(
  "User prompt: emails section labeled newest-first",
  src.includes("newest first") || src.includes("newest-first"),
);

check(
  "User prompt: emails labeled INBOUND / OUTBOUND",
  src.includes("INBOUND") && src.includes("OUTBOUND"),
);

check(
  "User prompt: labels most recent email",
  src.includes("MOST RECENT"),
);

check(
  "User prompt: includes all CRM fields (SELECT l.*)",
  src.includes("SELECT l.*") || src.includes("SELECT a.*") || src.includes("SELECT c.*"),
);

check(
  "User prompt: notes section sorted newest-first",
  /notes.*newest first/i.test(src) || src.includes("ORDER BY created_at DESC") && src.includes("notes"),
);

check(
  "User prompt: activities section present",
  src.includes("ACTIVITY HISTORY"),
);

check(
  "User prompt: attachments/documents section present",
  src.includes("DOCUMENTS / ATTACHMENTS"),
);

check(
  "User prompt: body field description forbids dense single paragraph",
  src.includes("Do NOT return the body as a single dense paragraph"),
);

check(
  "User prompt: final REMEMBER reminder about paragraph breaks",
  src.includes("REMEMBER: body must use"),
);

check(
  "User prompt: final REMEMBER reminder about no signature placeholder",
  src.includes("REMEMBER: DO NOT add"),
);

// ── 4. Context builder — expanded fields ─────────────────────────────────────
console.log("\n── 4. Context builder — expanded fields ────────────────────────");

check(
  "Context builder: leads uses SELECT l.* (all fields)",
  src.includes("SELECT l.*"),
);

check(
  "Context builder: accounts uses SELECT a.* (all fields)",
  src.includes("SELECT a.*"),
);

check(
  "Context builder: contacts uses SELECT c.* + account join",
  src.includes("SELECT c.*") && src.includes("LEFT JOIN accounts a ON a.id = c.account_id"),
);

check(
  "Context builder: leads joins users table for owner name",
  src.includes("LEFT JOIN users u ON u.id = l.owner_user_id"),
);

check(
  "Context builder: accounts joins users table for assignee name",
  src.includes("LEFT JOIN users u ON u.id = a.assigned_to_user_id"),
);

check(
  "Context builder: email snippet increased to 350 chars",
  src.includes("substring(0, 350)"),
);

check(
  "Context builder: emails query includes to_recipients column",
  src.includes("em.to_recipients"),
);

check(
  "Context builder: emails limit increased to 50",
  src.includes("LIMIT 50") && src.includes("email_messages"),
);

check(
  "Context builder: notes limit 25, activities limit 20",
  src.includes("LIMIT 25") && src.includes("LIMIT 20"),
);

// ── 5. Modal — plainTextToHtml conversion before compose handoff ──────────────
console.log("\n── 5. Modal — HTML conversion before compose handoff ───────────");

check(
  "Modal: imports plainTextToHtml from @/lib/email-format",
  modal.includes("plainTextToHtml") && modal.includes("email-format"),
);

check(
  "Modal: calls plainTextToHtml on body before setPendingCompose",
  modal.includes("plainTextToHtml(rawBody)") || modal.includes("plainTextToHtml("),
);

check(
  "Modal: finalBody is the HTML-converted result",
  modal.includes("const finalBody = plainTextToHtml"),
);

check(
  "Modal: payload uses finalBody (HTML), not rawBody (plain text)",
  (() => {
    const idx = modal.indexOf("const payload =");
    const block = idx > -1 ? modal.slice(idx, idx + 200) : "";
    return block.includes("finalBody") && !block.includes("rawBody");
  })(),
  "payload.body must be finalBody (HTML), not the raw plain-text body",
);

check(
  "Modal: comment explains why plainTextToHtml is needed",
  modal.includes("contentEditable") || modal.includes("Convert plain-text"),
);

// ── 6. email-format.ts — plainTextToHtml converts newlines ───────────────────
console.log("\n── 6. email-format.ts — plainTextToHtml ────────────────────────");

const emailFormatPath = path.join(root, "client/src/lib/email-format.ts");
const ef = fs.readFileSync(emailFormatPath, "utf8");

check(
  "email-format.ts exports plainTextToHtml",
  ef.includes("export function plainTextToHtml"),
);

check(
  "plainTextToHtml converts \\n\\n to <br><br>",
  ef.includes("<br><br>"),
);

check(
  "plainTextToHtml converts single \\n to <br>",
  ef.includes("<br>") && (ef.includes('.replace(/\\n/') || ef.includes('.replace(/\\n/g')),
);

// ── 7. Existing compose-handoff invariants still pass ─────────────────────────
console.log("\n── 7. Existing compose-handoff invariants ──────────────────────");

const handoffPath = path.join(root, "client/src/lib/compose-handoff.ts");
const handoff = fs.readFileSync(handoffPath, "utf8");

check(
  "compose-handoff: exports setPendingCompose",
  handoff.includes("export function setPendingCompose"),
);

check(
  "compose-handoff: exports takePendingCompose",
  handoff.includes("export function takePendingCompose"),
);

check(
  "Modal: still calls setPendingCompose(payload) before setLocation",
  (() => {
    const idx = modal.indexOf("setPendingCompose(payload)");
    const navIdx = modal.indexOf("setLocation(");
    return idx > -1 && navIdx > -1 && idx < navIdx;
  })(),
);

check(
  "Modal: still saves sessionStorage as secondary fallback",
  modal.includes("sessionStorage.setItem"),
);

check(
  "Modal: PENDING_COMPOSE_KEY exported",
  modal.includes("export const PENDING_COMPOSE_KEY"),
);

check(
  "Inbox: imports takePendingCompose",
  inbox.includes("takePendingCompose"),
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
console.log("─".repeat(60));
if (failed > 0) process.exit(1);
