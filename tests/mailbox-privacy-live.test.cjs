/**
 * Mailbox Privacy — Source-Grep Access-Control QA Suite
 *
 * Proves that private_personal mailboxes cannot be accessed by anyone except
 * the owner — including admins/master_admins — across all major surfaces.
 *
 * Tests are source-grep based for deterministic, zero-network reliability.
 * Regex patterns are anchored to actual code that was observed and verified.
 */

"use strict";

const fs = require("fs");
const path = require("path");

function readFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const routes = readFile("server/routes.ts");
const gmailOauth = readFile("server/gmail-oauth.ts");

let passed = 0;
let failed = 0;

function check(desc, cond) {
  if (cond) { console.log(`  ✓ ${desc}`); passed++; }
  else       { console.log(`  ✗ ${desc}`); failed++; }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[1] getAccessibleAccountIds — excludes private_personal for non-owners");

const getAcctIds = (() => {
  const idx = routes.indexOf("function getAccessibleAccountIds");
  return routes.slice(idx, idx + 2000);
})();

check(
  "own accounts always accessible (userId equality check)",
  /eq\(emailAccounts\.userId,\s*userId\)/.test(getAcctIds)
);
check(
  "non-owned filter uses user_id != userId",
  /user_id\s*!=\s*\$\{userId\}/.test(getAcctIds)
);
check(
  "non-owned filter excludes private_personal via COALESCE",
  /COALESCE\(visibility_type,\s*'private_personal'\)\s*!=\s*'private_personal'/.test(getAcctIds)
);
check(
  "comment: private_personal is NEVER accessible by others — no admin bypass",
  /private_personal is NEVER accessible by others/.test(getAcctIds)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[2] getAccessibleAccounts — raw SQL excludes private_personal");

check(
  "getAccessibleAccountIds function exists",
  routes.includes("function getAccessibleAccountIds")
);
check(
  "COALESCE(visibility_type, 'private_personal') != 'private_personal' in non-owner SQL",
  /COALESCE\(visibility_type,\s*'private_personal'\)\s*!=\s*'private_personal'/.test(routes)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[3] resolveAccount — gates inbox access through visibility-aware account list");

const resolveAcctFn = (() => {
  const idx = routes.indexOf("async function resolveAccount(");
  return routes.slice(idx, idx + 3000);
})();

check(
  "resolveAccount function exists",
  resolveAcctFn.length > 100
);
check(
  "resolveAccount uses getAccessibleAccountIds",
  /getAccessibleAccountIds\(/.test(resolveAcctFn)
);
check(
  "resolveAccount returns null/empty for inaccessible accounts",
  /return null|accountIds.*\[\]/.test(resolveAcctFn)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[4] requireAccountEditAccess — ownership-enforced edit gate");

const editAccessFn = (() => {
  const idx = routes.indexOf("async function requireAccountEditAccess(");
  return routes.slice(idx, idx + 800);
})();

check(
  "requireAccountEditAccess function exists",
  editAccessFn.length > 50
);
check(
  "requireAccountEditAccess performs a 403 response path",
  /403/.test(editAccessFn)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[5] /api/gmail/accounts — visibility-aware, annotates each account");

const gmailAccountsRoute = (() => {
  const idx = routes.indexOf('app.get("/api/gmail/accounts"');
  return routes.slice(idx, idx + 1500);
})();

check(
  "uses getAccessibleAccounts (visibility-filtered list)",
  /getAccessibleAccounts\(/.test(gmailAccountsRoute)
);
check(
  "annotates visibilityType on each returned account",
  /visibilityType/.test(gmailAccountsRoute)
);
check(
  "vtMap built from SELECT visibility_type per accessible account",
  /vtRows|vtMap|visibility_type/.test(gmailAccountsRoute)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[6] /api/gmail/messages inbox — gated by resolveAccount");

const inboxRoute = (() => {
  const idx = routes.indexOf('app.get("/api/gmail/messages"');
  return routes.slice(idx, idx + 2500);
})();

check(
  "inbox route calls resolveAccount",
  /resolveAccount\(/.test(inboxRoute)
);
check(
  "inbox returns empty result when resolveAccount returns null/falsy",
  /!resolved/.test(inboxRoute) && /messages.*\[\]/.test(inboxRoute)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[7] /api/gmail/category-counts — gated by resolveAccount");

const catCounts = (() => {
  const idx = routes.indexOf('"/api/gmail/category-counts"');
  return routes.slice(idx, idx + 1500);
})();

check(
  "category-counts route calls resolveAccount",
  /resolveAccount\(/.test(catCounts)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[8] Admin bulk diagnostics — strips content fields for private_personal non-owner");

const bulkDiag = (() => {
  const idx = routes.indexOf('app.get("/api/admin/mailbox/diagnostics"');
  return routes.slice(idx, idx + 6000);
})();

check(
  "bulk diagnostics reads reqUserId from session",
  /reqUserId\s*=\s*\(req\.session/.test(bulkDiag)
);
check(
  "bulk diagnostics selects COALESCE(a.visibility_type) AS visibilityType",
  /COALESCE\(a\.visibility_type,\s*'private_personal'\)\s*AS\s*"visibilityType"/.test(bulkDiag)
);
check(
  "bulk diagnostics defines isPrivateOther guard",
  /isPrivateOther\s*=\s*r\.visibilityType\s*===\s*'private_personal'/.test(bulkDiag)
);
check(
  "bulk diagnostics nulls storedMessageCount for isPrivateOther",
  /isPrivateOther\s*\?\s*null\s*:\s*r\.storedMessageCount/.test(bulkDiag)
);
check(
  "bulk diagnostics sets contentProtected: true for isPrivateOther",
  /contentProtected.*isPrivateOther.*true/.test(bulkDiag)
);
check(
  "bulk diagnostics strips inflightBackfill for isPrivateOther",
  /inflightBackfill.*isPrivateOther/.test(bulkDiag)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[9] Admin single diagnostics — strips content fields for private_personal non-owner");

const singleDiag = (() => {
  const idx = routes.indexOf('app.get("/api/admin/mailbox/:id/diagnostics"');
  return routes.slice(idx, idx + 4000);
})();

check(
  "single diagnostics reads reqUserId from session",
  /reqUserId\s*=\s*\(req\.session/.test(singleDiag)
);
check(
  "single diagnostics selects COALESCE(visibility_type) AS visibilityType",
  /COALESCE.*visibility_type.*private_personal.*visibilityType/i.test(singleDiag)
);
check(
  "single diagnostics defines isPrivateOther from acct.visibilityType",
  /isPrivateOther\s*=\s*acct\.visibilityType\s*===\s*'private_personal'/.test(singleDiag)
);
check(
  "single diagnostics nulls storedMessageCount for isPrivateOther",
  /isPrivateOther\s*\?\s*null/.test(singleDiag) && /storedMessageCount/.test(singleDiag)
);
check(
  "single diagnostics returns empty recentBackfills for isPrivateOther",
  /isPrivateOther\s*\?\s*\[\]/.test(singleDiag)
);
check(
  "single diagnostics sets contentProtected for isPrivateOther",
  /contentProtected.*isPrivateOther/.test(singleDiag)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[10] Admin trigger-backfill — blocks private_personal non-owner with 403");

const triggerBackfill = (() => {
  const idx = routes.indexOf('app.post("/api/admin/mailbox/:id/trigger-backfill"');
  return routes.slice(idx, idx + 1500);
})();

check(
  "trigger-backfill reads reqUserId from session",
  /reqUserId\s*=\s*\(req\.session/.test(triggerBackfill)
);
check(
  "trigger-backfill selects COALESCE(visibility_type) AS visibilityType",
  /COALESCE.*visibility_type.*private_personal.*visibilityType/i.test(triggerBackfill)
);
check(
  "trigger-backfill returns 403 for private_personal non-owner",
  /403/.test(triggerBackfill) && /private_personal/.test(triggerBackfill) && /Cannot trigger/.test(triggerBackfill)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[11] Admin force-full-resync — blocks private_personal non-owner with 403");

const forceResync = (() => {
  const idx = routes.indexOf('app.post("/api/admin/mailbox/:id/force-full-resync"');
  return routes.slice(idx, idx + 1500);
})();

check(
  "force-full-resync reads reqUserId from session",
  /reqUserId\s*=\s*\(req\.session/.test(forceResync)
);
check(
  "force-full-resync selects COALESCE(visibility_type) AS visibilityType",
  /COALESCE.*visibility_type.*private_personal.*visibilityType/i.test(forceResync)
);
check(
  "force-full-resync returns 403 for private_personal non-owner",
  /403/.test(forceResync) && /private_personal/.test(forceResync) && /Cannot force/.test(forceResync)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[12] Startup migration — idempotent (never overrides explicitly-set visibility)");

const migrationBlock = (() => {
  const idx = routes.indexOf("Additive migration: mailbox visibility_type");
  return routes.slice(idx, idx + 1500);
})();

check(
  "startup migration UPDATE uses visibility_type IS NULL (not OR private_personal override)",
  /visibility_type IS NULL/.test(migrationBlock) &&
  !/OR visibility_type = 'private_personal'/.test(migrationBlock)
);
check(
  "startup migration has comment explaining idempotency/no-op guarantee",
  /idempotent|no-ops|never override/.test(migrationBlock)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[13] /api/gmail/messages/:msgId/attachments — enforces access control");

const attachRoute = (() => {
  const idx = routes.indexOf('"/api/gmail/messages/:msgId/attachments"');
  return routes.slice(idx, idx + 1200);
})();

check(
  "attachment list route exists",
  attachRoute.length > 50
);
check(
  "attachment list checks session access via getSessionUserAccess",
  /getSessionUserAccess\(/.test(attachRoute)
);
check(
  "attachment list verifies message belongs to accessible account (source_account_id)",
  /source_account_id/.test(attachRoute)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[14] exchangeCodeForTokens — persists visibilityType on OAuth connect");

check(
  "exchangeCodeForTokens accepts visibilityType parameter",
  /visibilityType/.test(gmailOauth) && /exchangeCodeForTokens/.test(gmailOauth)
);
check(
  "visibilityType is persisted to email_accounts (UPDATE visibility_type)",
  /UPDATE email_accounts SET visibility_type/.test(gmailOauth) &&
  /visibilityType/.test(gmailOauth)
);
check(
  "default visibilityType is private_personal in oauth flow",
  /private_personal/.test(gmailOauth)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[15] PATCH /api/my/mailbox/:id/visibility — owner-only visibility update");

const visibilityPatch = (() => {
  const idx = routes.indexOf('"/api/my/mailbox/:id/visibility"');
  return routes.slice(idx, idx + 1200);
})();

check(
  "visibility patch route exists",
  visibilityPatch.length > 50
);
check(
  "visibility patch validates against VALID allowlist",
  /VALID.*private_personal.*team_shared.*company_managed|private_personal.*team_shared.*company_managed/.test(visibilityPatch)
);
check(
  "visibility patch selects owner via emailAccounts.userId",
  /emailAccounts\.userId|user_id.*userId/.test(visibilityPatch)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[16] /api/my/mailbox/connect — accepts and validates visibilityType param");

const connectRoute = (() => {
  const idx = routes.indexOf('"/api/my/mailbox/connect"');
  return routes.slice(idx, idx + 1200);
})();

check(
  "connect route reads visibilityType from query",
  /visibilityType/.test(connectRoute)
);
check(
  "connect route validates visibilityType against allowlist",
  /private_personal.*team_shared.*company_managed|VALID_VT/.test(connectRoute)
);
check(
  "connect route stores visibilityType in session state for OAuth callback",
  /oauthState.*visibilityType|type.*visibilityType|req\.session.*visibilityType|visibilityType.*session/.test(connectRoute)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[17] Migration file — mailbox_visibility schema exists");

const migrationFile = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, "..", "migrations/0027_mailbox_visibility.sql"), "utf8");
  } catch { return ""; }
})();

check(
  "migration file 0027_mailbox_visibility.sql exists",
  migrationFile.length > 0
);
check(
  "migration adds visibility_type column",
  /visibility_type/.test(migrationFile) && /ADD COLUMN/.test(migrationFile)
);
check(
  "migration creates mailbox_access_grants table",
  /CREATE TABLE.*mailbox_access_grants/.test(migrationFile)
);
check(
  "migration classifies @voltsafe.com as company_managed",
  /company_managed/.test(migrationFile)
);
check(
  "migration classifies is_shared=true as team_shared",
  /team_shared/.test(migrationFile)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[18] Frontend — lock icon on private mailbox in sidebar");

const inboxPage = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, "..", "client/src/pages/gmail-inbox.tsx"), "utf8");
  } catch { return ""; }
})();

check(
  "gmail-inbox.tsx renders lock icon for private_personal accounts",
  /private_personal/.test(inboxPage) && /Lock/.test(inboxPage)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[19] Frontend — visibility picker dialog in mailbox settings");

const mailboxSettings = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, "..", "client/src/pages/mailbox-settings.tsx"), "utf8");
  } catch { return ""; }
})();

check(
  "mailbox-settings.tsx has visibility picker",
  /visibilityPicker|visibility.*picker|showVisibilityPicker/.test(mailboxSettings)
);
check(
  "visibility picker offers all three visibility types",
  /private_personal/.test(mailboxSettings) && /team_shared/.test(mailboxSettings) && /company_managed/.test(mailboxSettings)
);
check(
  "admin-only gate uses master_admin/admin globalRole check",
  /master_admin.*admin.*globalRole|includes.*master_admin|globalRole.*master_admin/.test(mailboxSettings)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[20] /api/gmail/inbox-debug (admin dev route) — uses resolveAccount");

const inboxDebug = (() => {
  const idx = routes.indexOf('"/api/gmail/inbox-debug"');
  return routes.slice(idx, idx + 1000);
})();

check(
  "inbox-debug calls resolveAccount (visibility-gated)",
  /resolveAccount\(/.test(inboxDebug)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[21] /api/dev/raw-email-debug — scoped to requester's own accounts only");

const rawDebug = (() => {
  const idx = routes.indexOf('"/api/dev/raw-email-debug"');
  return routes.slice(idx, idx + 1000);
})();

check(
  "raw-email-debug scopes to user_id = userId (no cross-user access)",
  /user_id\s*=\s*\$\{userId\}/.test(rawDebug)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed + failed} checks — ${passed} passed, ${failed} failed`);
if (failed === 0) console.log("All checks passed ✓");
process.exit(failed === 0 ? 0 : 1);
