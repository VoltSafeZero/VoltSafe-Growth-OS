/**
 * Source-grep regression tests: CC/BCC draft persistence chain.
 *
 * Verifies all six links in the save→retrieve chain correctly handle CC/BCC.
 * These are structural tests — they pin the code shape so that any regression
 * in any link of the chain is caught immediately.
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const GMAIL_TS = path.join(__dirname, "../server/gmail.ts");
const ROUTES_TS = path.join(__dirname, "../server/routes.ts");
const INBOX_TSX = path.join(__dirname, "../client/src/pages/gmail-inbox.tsx");

const gmailSrc   = fs.readFileSync(GMAIL_TS, "utf8");
const routesSrc  = fs.readFileSync(ROUTES_TS, "utf8");
const inboxSrc   = fs.readFileSync(INBOX_TSX, "utf8");

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

// ── server/gmail.ts ────────────────────────────────────────────────────────
console.log("\n[server/gmail.ts]");

check(
  "saveDraft signature accepts cc parameter",
  /export async function saveDraft[\s\S]{0,400}cc\?:\s*string/.test(gmailSrc),
);
check(
  "saveDraft signature accepts bcc parameter",
  /export async function saveDraft[\s\S]{0,400}bcc\?:\s*string/.test(gmailSrc),
);
check(
  "saveDraft calls buildMimeRaw with cc and bcc",
  /buildMimeRaw\(from,\s*to,\s*subject,\s*body,\s*\[\],\s*cc,\s*bcc\)/.test(gmailSrc),
);
check(
  "getDraftContent returns cc header",
  /getDraftContent[\s\S]{0,600}cc:\s*getH\(["']Cc["']\)/.test(gmailSrc),
);
check(
  "getDraftContent returns bcc header",
  /getDraftContent[\s\S]{0,600}bcc:\s*getH\(["']Bcc["']\)/.test(gmailSrc),
);

// ── server/routes.ts ────────────────────────────────────────────────────────
console.log("\n[server/routes.ts — POST /api/gmail/drafts]");

check(
  "Route destructures cc from req.body",
  /const\s*\{[^}]*\bcc\b[^}]*\}\s*=\s*req\.body/.test(routesSrc),
);
check(
  "Route destructures bcc from req.body",
  /const\s*\{[^}]*\bbcc\b[^}]*\}\s*=\s*req\.body/.test(routesSrc),
);
// Route now normalizes cc/bcc (trim/dedupe/validate/strip-sender, shared
// with the send-route gate) before persisting a draft, rather than passing
// the raw req.body values straight through — see shared/recipients.ts.
check(
  "Route passes a normalized cc value to saveDraft",
  /saveDraft\([^)]*draftCleanCc[^)]*\)/.test(routesSrc),
);
check(
  "Route passes a normalized bcc value to saveDraft",
  /saveDraft\([^)]*draftCleanBcc[^)]*\)/.test(routesSrc),
);
check(
  "Route cc/bcc normalization uses the shared normalizeRecipients helper",
  /const draftCcNorm\s*=\s*normalizeRecipients/.test(routesSrc) &&
  /const draftBccNorm\s*=\s*normalizeRecipients/.test(routesSrc),
);

// ── client/src/pages/gmail-inbox.tsx ────────────────────────────────────────
console.log("\n[client/src/pages/gmail-inbox.tsx]");

check(
  "editingDraft state type includes cc field",
  /editingDraft.*setState.*cc\?:\s*string|cc\?:\s*string.*bcc\?:\s*string/.test(inboxSrc) ||
  /\{\s*to:\s*string;\s*cc\?:\s*string/.test(inboxSrc),
);
check(
  "editingDraft state type includes bcc field",
  /bcc\?:\s*string.*subject:\s*string/.test(inboxSrc),
);
check(
  "draftMutation sends cc in payload",
  /draftMutation[\s\S]{0,400}\.\.\..*cc.*\?.*\{.*cc.*\}/.test(inboxSrc) ||
  /\.\.\..*cc\s*\?.*\{.*cc.*\}/.test(inboxSrc),
);
check(
  "draftMutation sends bcc in payload",
  /\.\.\..*bcc\s*\?.*\{.*bcc.*\}/.test(inboxSrc),
);
check(
  "openDraft sets cc from content",
  /setEditingDraft\s*\([\s\S]{0,200}cc:\s*content\.cc/.test(inboxSrc),
);
check(
  "openDraft sets bcc from content",
  /setEditingDraft\s*\([\s\S]{0,200}bcc:\s*content\.bcc/.test(inboxSrc),
);
check(
  "ComposeDialog defaultCc includes editingDraft.cc",
  /defaultCc=\{editingDraft\?\.cc/.test(inboxSrc),
);
check(
  "ComposeDialog defaultBcc includes editingDraft.bcc",
  /defaultBcc=\{editingDraft\?\.bcc/.test(inboxSrc),
);

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} checks — ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
