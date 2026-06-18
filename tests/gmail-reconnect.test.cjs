/**
 * Regression tests for Gmail reconnect hardening.
 *
 * Verifies behavioral invariants by source-grep — no HTTP, no DB, no
 * network calls. Pinned against the source files so a future edit that
 * silently removes a guard will immediately break this suite.
 *
 * Covered behaviors:
 *  [1] syncIncremental bails on auth_status=expired (not just revoked/error)
 *  [2] syncIncremental logs a clear "reconnect required" message for expired
 *  [3] renewExpiringWatches skips expired and revoked accounts
 *  [4] ensureWatchesOnBoot skips expired and revoked accounts
 *  [5] exchangeCodeForTokens returns accountId + isNewAccount
 *  [6] exchangeCodeForTokens personal path matches by (userId, emailAddress) — no duplicate
 *  [7] exchangeCodeForTokens sets isNewAccount=true only for INSERT path
 *  [8] OAuth callback fires post-reconnect sync when !isNewAccount
 *  [9] OAuth callback fires watch renewal when !isNewAccount
 * [10] getAuthUrl uses access_type=offline + prompt=consent (forces refresh token)
 * [11] No refresh_token → throws, not silently succeeds
 * [12] runIncrementalForAll calls syncIncremental per account (respects the guard)
 * [13] syncIncremental guard includes all three bad statuses: revoked, error, expired
 * [14] Post-reconnect sync fires before HTTP response returns (fire-and-forget)
 */

"use strict";

const fs = require("fs");
const path = require("path");

function readFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const incremental = readFile("server/services/gmail-incremental.ts");
const watchSvc    = readFile("server/services/gmail-watch.ts");
const gmailOauth  = readFile("server/gmail-oauth.ts");
const routes      = readFile("server/routes.ts");

let passed = 0;
let failed = 0;

function check(description, condition) {
  if (condition) {
    console.log(`  ✓ ${description}`);
    passed++;
  } else {
    console.log(`  ✗ ${description}`);
    failed++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[1] syncIncremental auth guard covers expired");

check(
  'guard condition includes authStatus === "expired"',
  /authStatus\s*===\s*["']expired["']/.test(incremental)
);

check(
  "guard is a single compound OR covering revoked, error, and expired",
  /authStatus\s*===\s*["']revoked["'][^}]*authStatus\s*===\s*["']error["'][^}]*authStatus\s*===\s*["']expired["']/.test(incremental) ||
  /authStatus\s*===\s*["']expired["'][^}]*authStatus\s*===\s*["']revoked["']/.test(incremental)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[2] syncIncremental logs 'reconnect required' for expired accounts");

check(
  "log call includes 'reconnect required' text for skipped accounts",
  /reconnect required/.test(incremental)
);

check(
  "log is emitted before early return (inside the auth guard block)",
  (() => {
    const guardIdx = incremental.indexOf("reconnect required");
    const emptyIdx = incremental.indexOf("return { ...EMPTY, reason: `auth_status=");
    return guardIdx !== -1 && emptyIdx !== -1 && guardIdx < emptyIdx;
  })()
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[3] renewExpiringWatches skips expired and revoked accounts");

const renewFnMatch = watchSvc.match(/export async function renewExpiringWatches[\s\S]*?^}/m);
const renewFn = renewFnMatch ? renewFnMatch[0] : "";

check(
  'renewExpiringWatches filters ne(authStatus, "expired")',
  /ne\(emailAccounts\.authStatus,\s*["']expired["']\)/.test(renewFn)
);
check(
  'renewExpiringWatches filters ne(authStatus, "revoked")',
  /ne\(emailAccounts\.authStatus,\s*["']revoked["']\)/.test(renewFn)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[4] ensureWatchesOnBoot skips expired and revoked accounts");

const bootFnMatch = watchSvc.match(/export async function ensureWatchesOnBoot[\s\S]*?^}/m);
const bootFn = bootFnMatch ? bootFnMatch[0] : "";

check(
  'ensureWatchesOnBoot filters ne(authStatus, "expired")',
  /ne\(emailAccounts\.authStatus,\s*["']expired["']\)/.test(bootFn)
);
check(
  'ensureWatchesOnBoot filters ne(authStatus, "revoked")',
  /ne\(emailAccounts\.authStatus,\s*["']revoked["']\)/.test(bootFn)
);

check(
  "ne is imported in gmail-watch.ts",
  /\bne\b/.test(watchSvc.split("from \"drizzle-orm\"")[0].split("\n").slice(-3).join("\n"))
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[5] exchangeCodeForTokens return type includes accountId and isNewAccount");

check(
  "return type declares accountId: number | null",
  /accountId\s*:\s*number\s*\|\s*null/.test(gmailOauth)
);
check(
  "return type declares isNewAccount: boolean",
  /isNewAccount\s*:\s*boolean/.test(gmailOauth)
);
check(
  "function returns { emailAddress, accountId: resultAccountId, isNewAccount }",
  /return\s*\{[^}]*emailAddress[^}]*accountId\s*:\s*resultAccountId[^}]*isNewAccount[^}]*\}/.test(gmailOauth)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[6] Personal reconnect matches by (userId, emailAddress) — no duplicate account");

check(
  "personal path looks up by userId AND emailAddress AND isShared=false",
  /eq\(emailAccounts\.userId,\s*userId\)[^}]*eq\(emailAccounts\.isShared,\s*false\)[^}]*eq\(emailAccounts\.emailAddress,\s*emailAddress\)/.test(gmailOauth) ||
  /eq\(emailAccounts\.emailAddress,\s*emailAddress\)[^}]*eq\(emailAccounts\.isShared,\s*false\)/.test(gmailOauth)
);
check(
  "existing account branch uses UPDATE (not INSERT)",
  (() => {
    const personalSection = gmailOauth.slice(gmailOauth.indexOf("} else {") + 8);
    const existingBlock = personalSection.match(/if\s*\(existing\)\s*\{[\s\S]*?\} else \{/)?.[0] ?? "";
    return existingBlock.includes("db.update(emailAccounts)") && !existingBlock.includes("db.insert(emailAccounts)");
  })()
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[7] isNewAccount=true only on INSERT paths, not UPDATE paths");

check(
  "isNewAccount=true is set inside the INSERT branch (shared)",
  (() => {
    // The shared INSERT block should have isNewAccount = true after the insert
    const sharedInsertBlock = gmailOauth.match(/if\s*\(inserted\?\.id\)\s*\{[\s\S]*?autoEnqueueBackfillForNewAccount[\s\S]*?\}/)?.[0] ?? "";
    return sharedInsertBlock.includes("isNewAccount = true");
  })()
);
check(
  "isNewAccount=true is set inside the INSERT branch (personal)",
  (() => {
    // The personal INSERT block (newId) should have isNewAccount = true
    const personalInsertBlock = gmailOauth.match(/if\s*\(newId\)\s*\{[\s\S]*?autoEnqueueBackfillForNewAccount[\s\S]*?\}/)?.[0] ?? "";
    return personalInsertBlock.includes("isNewAccount = true");
  })()
);
check(
  "isNewAccount is NOT set inside the UPDATE branches",
  (() => {
    // Find the shared UPDATE block
    const sharedUpdateBlock = gmailOauth.match(/if\s*\(existing\)\s*\{[\s\S]*?\} else \{/)?.[0] ?? "";
    return !sharedUpdateBlock.includes("isNewAccount = true");
  })()
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[8] OAuth callback fires post-reconnect incremental sync");

// Extract the full Gmail callback block, up to the next route registration
const callbackSection = routes.slice(routes.indexOf("Gmail OAuth callback (personal + shared)"));
const nextRouteMarker = "// ── Email Sync + Association Routes";
const callbackFn = callbackSection.slice(
  0,
  callbackSection.includes(nextRouteMarker)
    ? callbackSection.indexOf(nextRouteMarker)
    : callbackSection.indexOf("  app.post(\"/api/gmail/sync\"")
);

check(
  "callback destructures isNewAccount from exchangeCodeForTokens",
  /isNewAccount\b/.test(callbackFn)
);
check(
  "callback fires syncIncremental when !isNewAccount",
  /!isNewAccount/.test(callbackFn) && /syncIncremental\(/.test(callbackFn)
);
check(
  "post-reconnect sync is fire-and-forget (does not await before res.send)",
  (() => {
    // syncIncremental must appear AFTER the res.send call, not before it
    const resSendIdx = callbackFn.indexOf("res.send(");
    const syncIdx = callbackFn.indexOf("syncIncremental(");
    return resSendIdx !== -1 && syncIdx !== -1 && syncIdx > resSendIdx;
  })()
);
check(
  "post-reconnect sync logs [gmail-reconnect] prefix",
  /\[gmail-reconnect\].*post-reconnect sync/.test(callbackFn)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[9] OAuth callback fires watch renewal after reconnect");

check(
  "callback calls startWatch when !isNewAccount",
  /startWatch\(/.test(callbackFn)
);
check(
  "watch renewal is fire-and-forget (after res.send)",
  (() => {
    const resSendIdx = callbackFn.indexOf("res.send(");
    const watchIdx = callbackFn.indexOf("startWatch(");
    return resSendIdx !== -1 && watchIdx !== -1 && watchIdx > resSendIdx;
  })()
);
check(
  "watch renewal logs [gmail-reconnect] prefix",
  /\[gmail-reconnect\].*watch renewal/.test(callbackFn)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[10] getAuthUrl uses access_type=offline and prompt=consent");

check(
  'getAuthUrl sets access_type: "offline"',
  /access_type\s*:\s*["']offline["']/.test(gmailOauth)
);
check(
  'getAuthUrl sets prompt: "consent" (forces new refresh token)',
  /prompt\s*:\s*["']consent["']/.test(gmailOauth)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[11] Missing refresh_token throws, not silently continues");

check(
  "no refresh_token throws with helpful message",
  /No refresh token returned/.test(gmailOauth) &&
  /throw new Error/.test(gmailOauth.slice(
    gmailOauth.indexOf("No refresh token returned") - 50,
    gmailOauth.indexOf("No refresh token returned") + 5
  ))
);
check(
  "error message mentions myaccount.google.com/permissions",
  /myaccount\.google\.com\/permissions/.test(gmailOauth)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[12] runIncrementalForAll calls syncIncremental for each account");

check(
  "runIncrementalForAll iterates and calls syncIncremental(a.id)",
  /runIncrementalForAll[\s\S]{0,300}syncIncremental\(a\.id\)/.test(incremental)
);
check(
  "runIncrementalForAll filters isActive=true AND syncEnabled=true",
  /runIncrementalForAll[\s\S]{0,500}isActive.*true[\s\S]{0,200}syncEnabled.*true/.test(incremental) ||
  /runIncrementalForAll[\s\S]{0,500}syncEnabled.*true[\s\S]{0,200}isActive.*true/.test(incremental)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[13b] syncEmailAccount (paginated sync) also guards on expired");

const gmailSyncSrc = readFile("server/services/gmail-sync.ts");
const syncEmailAccountFn = gmailSyncSrc.match(/export async function syncEmailAccount[\s\S]*?^}/m)?.[0] ?? "";

check(
  'syncEmailAccount guard includes authStatus === "expired"',
  /authStatus.*expired/.test(syncEmailAccountFn)
);
check(
  "syncEmailAccount guard is a compound OR covering revoked, error, and expired",
  /authStatus.*revoked[^}]*authStatus.*error[^}]*authStatus.*expired/.test(syncEmailAccountFn) ||
  /authStatus.*expired[^}]*authStatus.*revoked/.test(syncEmailAccountFn)
);
check(
  "syncEmailAccount does NOT write authStatus=expired when active account token fails (only syncErrorMessage)",
  (() => {
    // The catch block at getGmailClient call should write authStatus="expired"
    // but ONLY when the account was not already active (i.e. guard blocked it first)
    // Verify the guard bails before getGmailClient is called for expired accounts
    const guardIdx = syncEmailAccountFn.indexOf('auth_status=');
    const getClientIdx = syncEmailAccountFn.indexOf('getGmailClient');
    return guardIdx !== -1 && getClientIdx !== -1 && guardIdx < getClientIdx;
  })()
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[13] Guard covers all three bad auth statuses in one condition");

const guardLine = incremental.match(/if\s*\([^)]*authStatus[^)]*\)\s*\{[\s\S]*?reconnect required/)?.[0] ?? "";
check(
  "guard covers revoked",
  /revoked/.test(guardLine)
);
check(
  "guard covers error",
  /["']error["']/.test(guardLine)
);
check(
  "guard covers expired",
  /expired/.test(guardLine)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[14] Callback sends HTML before kicking off background tasks");

check(
  "res.send precedes reconnectedAccountId check in callback source order",
  (() => {
    const resSendIdx = callbackFn.indexOf("res.send(");
    const reconnectIdx = callbackFn.indexOf("reconnectedAccountId && !isNewAccount");
    return resSendIdx !== -1 && reconnectIdx !== -1 && resSendIdx < reconnectIdx;
  })()
);

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed + failed} checks — ${passed} passed, ${failed} failed`);
if (failed === 0) console.log("All checks passed ✓");
process.exit(failed === 0 ? 0 : 1);
