"use strict";
const fs = require("fs");
const path = require("path");

let passed = 0, failed = 0;
function ok(label, condition) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else           { console.error(`  ✗ ${label}`); failed++; }
}

const routesSrc = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");
const schemaSrc = fs.readFileSync(path.join(__dirname, "../shared/schema.ts"), "utf8");
const sigPage   = fs.readFileSync(path.join(__dirname, "../client/src/pages/signature-settings.tsx"), "utf8");
const inboxSrc  = fs.readFileSync(path.join(__dirname, "../client/src/pages/gmail-inbox.tsx"), "utf8");

// ── 1. Schema ──────────────────────────────────────────────────────────────
console.log("── 1. Schema — emailAccountId column ──");
ok("emailSignatures table has nullable emailAccountId column",
  /emailAccountId:\s*integer\(["']email_account_id["']\)/.test(schemaSrc));

// ── 2. Migration ─────────────────────────────────────────────────────────
console.log("\n── 2. Additive migration ──");
ok("routes.ts contains additive migration for email_account_id column",
  routesSrc.includes("ALTER TABLE email_signatures ADD COLUMN IF NOT EXISTS email_account_id"));

// ── 3. Ownership/permission helper ─────────────────────────────────────────
console.log("\n── 3. assertSignatureAccountAccess helper ──");
const helperIdx = routesSrc.indexOf("async function assertSignatureAccountAccess");
ok("assertSignatureAccountAccess helper is defined", helperIdx !== -1);
const helperBody = routesSrc.slice(helperIdx, helperIdx + 700);
ok("helper allows legacy (null accountId) signatures unconditionally",
  helperBody.includes("if (accountId == null) return { ok: true"));
ok("helper enforces owner-or-admin check on scoped mailboxes",
  helperBody.includes("acct.userId !== userId && !isAdmin"));
ok("helper returns 404 for unknown mailbox (no ID enumeration leak)",
  helperBody.includes("Mailbox not found"));
ok("helper returns 403 for non-owner/non-admin",
  helperBody.includes("You do not have permission to manage this mailbox's signature"));

// ── 4. Routes are account-aware ─────────────────────────────────────────────
console.log("\n── 4. Signature routes are account-aware ──");
['app.get("/api/signatures"', 'app.post("/api/signatures"', 'app.put("/api/signatures/:id"', 'app.delete("/api/signatures/:id"'].forEach(sig => {
  const idx = routesSrc.indexOf(sig);
  ok(`${sig} exists and calls assertSignatureAccountAccess`,
    idx !== -1 && routesSrc.slice(idx, idx + 1200).includes("assertSignatureAccountAccess"));
});

ok("GET /api/signatures reads accountId from query string",
  routesSrc.includes("req.query.accountId as string"));

const getIdx = routesSrc.indexOf('app.get("/api/signatures"');
const getBody = routesSrc.slice(getIdx, getIdx + 2200);
ok("GET /api/signatures falls back to legacy NULL-account signatures when a scoped mailbox has none",
  /accountId != null[\s\S]*?length === 0[\s\S]*?emailAccountId/.test(getBody) || getBody.includes("legacy"));

// ── 5. Frontend — mailbox selector + editor labelling ───────────────────────
console.log("\n── 5. Frontend mailbox scoping ──");
ok("signature-settings.tsx tracks a selectedAccountId for the mailbox selector",
  sigPage.includes("selectedAccountId"));
ok("signature-settings.tsx scopes the signatures query by selectedAccountId",
  /queryKey:\s*\[["']\/api\/signatures["'],\s*selectedAccountId\]/.test(sigPage));
ok("SignatureDialog accepts accountId/accountEmail props",
  sigPage.includes("accountId") && sigPage.includes("accountEmail"));
ok("SignatureDialog save body includes accountId",
  sigPage.includes("accountId: accountId ?? undefined"));
ok('SignatureDialog shows "Editing signature for: [address]" when scoped to a mailbox',
  sigPage.includes("Editing signature for: ${accountEmail}"));

// ── 6. Compose/reply signature lookup is per-mailbox ────────────────────────
console.log("\n── 6. Compose dialog signature scoping ──");
ok("ComposeDialog scopes signaturesData query by asAccountId (not global)",
  /queryKey:\s*\[["']\/api\/signatures["'],\s*asAccountId/.test(inboxSrc));
ok("ComposeDialog fetches /api/signatures with ?accountId= when composing from a specific mailbox",
  inboxSrc.includes("`/api/signatures${qs}`") && inboxSrc.includes("`?accountId=${asAccountId}`"));

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
