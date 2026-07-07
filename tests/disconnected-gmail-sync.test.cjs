/**
 * disconnected-gmail-sync.test.cjs
 *
 * Source-grep tests verifying that disconnected/expired Gmail accounts
 * are skipped cleanly — no 500 errors, no noisy log spam, no wasted
 * Gmail API calls.
 *
 * Four guards are required (all tested here):
 *   G1. syncIncremental() skips at service level (auth_status check)
 *   G2. runIncrementalForAll() excludes non-active accounts at DB level
 *   G3. Backfill scripts pre-check auth_status before calling getGmailClient
 *   G4. Inbox on-demand overflow is gated on authStatus === "active"
 */

"use strict";

const fs   = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

function readFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

// ─── File contents ───────────────────────────────────────────────────────────

const incremental   = readFile("server/services/gmail-incremental.ts");
const attBackfill   = readFile("scripts/attachment-backfill-all.ts");
const htmlBackfill  = readFile("scripts/html-backfill-all.ts");
const routes        = readFile("server/routes.ts");

// ─── G1: syncIncremental service-level skip guard ───────────────────────────

console.log("\n── G1: syncIncremental() service-level skip ──");

check(
  "syncIncremental checks authStatus === 'revoked'",
  incremental.includes('account.authStatus === "revoked"') ||
  incremental.includes("account.authStatus === 'revoked'"),
);

check(
  "syncIncremental checks authStatus === 'expired'",
  incremental.includes('account.authStatus === "expired"') ||
  incremental.includes("account.authStatus === 'expired'"),
);

check(
  "syncIncremental checks authStatus === 'error'",
  incremental.includes('account.authStatus === "error"') ||
  incremental.includes("account.authStatus === 'error'"),
);

check(
  "syncIncremental returns EMPTY reason on skip (no throw)",
  incremental.includes('reason: `auth_status=${account.authStatus}`') ||
  incremental.includes("reason: `auth_status=${account.authStatus}`"),
);

check(
  "syncIncremental logs the skip at info level",
  incremental.includes("auth_status=") && incremental.includes("reconnect required"),
);

// ─── G2: runIncrementalForAll DB-level filter ────────────────────────────────

console.log("\n── G2: runIncrementalForAll() DB filter excludes non-active accounts ──");

// Isolate the function body
const rifaStart = incremental.indexOf("export async function runIncrementalForAll");
const rifaEnd   = incremental.indexOf("\n}", rifaStart) + 2;
const rifaBody  = incremental.slice(rifaStart, rifaEnd);

check(
  "runIncrementalForAll filters syncEnabled = true",
  rifaBody.includes("syncEnabled") && rifaBody.includes("true"),
);

check(
  "runIncrementalForAll filters authStatus = 'active' at DB query",
  rifaBody.includes("authStatus") && rifaBody.includes('"active"'),
);

check(
  "runIncrementalForAll uses eq() with authStatus (Drizzle parameterized)",
  rifaBody.includes("eq(emailAccounts.authStatus"),
);

check(
  "runIncrementalForAll: expired accounts filtered in SQL not runtime loop",
  // Guard is in the where() clause, not in an if-check inside the for loop
  rifaBody.includes("eq(emailAccounts.authStatus") &&
  !rifaBody.includes('a.authStatus'),
);

// ─── G3: Backfill scripts — auth_status pre-check ───────────────────────────

console.log("\n── G3: Backfill scripts — auth_status pre-check before getGmailClient ──");

check(
  "attachment-backfill-all.ts checks authStatus !== 'active'",
  attBackfill.includes('acct.authStatus !== "active"') ||
  attBackfill.includes("acct.authStatus !== 'active'"),
);

check(
  "attachment-backfill-all.ts logs [skip] with auth_status reason",
  attBackfill.includes("[skip]") && attBackfill.includes("auth_status="),
);

check(
  "attachment-backfill-all.ts exits cleanly (exit 0) for disconnected accounts",
  attBackfill.includes("process.exit(0)"),
);

// Compare against the actual *call* (await getGmailClient), not the import declaration
check(
  "attachment-backfill-all.ts auth check appears BEFORE await getGmailClient call",
  attBackfill.indexOf('acct.authStatus !== "active"') < attBackfill.indexOf("await getGmailClient"),
);

check(
  "html-backfill-all.ts checks authStatus !== 'active'",
  htmlBackfill.includes('acct.authStatus !== "active"') ||
  htmlBackfill.includes("acct.authStatus !== 'active'"),
);

check(
  "html-backfill-all.ts logs [skip] with auth_status reason",
  htmlBackfill.includes("[skip]") && htmlBackfill.includes("auth_status="),
);

check(
  "html-backfill-all.ts exits cleanly (exit 0) for disconnected accounts",
  htmlBackfill.includes("process.exit(0)"),
);

// Compare against the actual *call* (await getGmailClient), not the import declaration
check(
  "html-backfill-all.ts auth check appears BEFORE await getGmailClient call",
  htmlBackfill.indexOf('acct.authStatus !== "active"') < htmlBackfill.indexOf("await getGmailClient"),
);

// ─── G4: Inbox route — canOverflow gated on authStatus === "active" ──────────

console.log("\n── G4: Inbox route canOverflow gated on authStatus === 'active' ──");

const coLine = routes.split("\n").find(l => l.includes("canOverflow") && l.includes("acct"));
check(
  "canOverflow assignment found in routes.ts",
  !!coLine,
);

check(
  "canOverflow requires acct.authStatus === 'active'",
  !!coLine && (
    coLine.includes('authStatus === "active"') ||
    coLine.includes("authStatus === 'active'")
  ),
);

check(
  "canOverflow still requires acct.id (not weakened)",
  !!coLine && coLine.includes("acct?.id"),
);

check(
  "canOverflow still requires acct.emailAddress (not weakened)",
  !!coLine && coLine.includes("acct?.emailAddress"),
);

// ─── B: sync-incremental route — structure checks ────────────────────────────

console.log("\n── B: sync-incremental route — route structure ──");

// Use a larger window (2000 chars) to capture try/catch and res.json
const routeStart = routes.indexOf('app.post("/api/gmail/sync-incremental"');
const routeSnippet = routeStart >= 0 ? routes.slice(routeStart, routeStart + 2000) : "";

check(
  "sync-incremental route exists in routes.ts",
  routeSnippet.length > 0,
);

check(
  "sync-incremental route uses requireAuth",
  routeSnippet.includes("requireAuth"),
);

check(
  "sync-incremental route calls both syncIncremental and runIncrementalForAll",
  routeSnippet.includes("syncIncremental") && routeSnippet.includes("runIncrementalForAll"),
);

check(
  "sync-incremental route wraps in try/catch (prevents unhandled 500 on skip)",
  routeSnippet.includes("try {") || routeSnippet.includes("try{"),
);

check(
  "sync-incremental route returns JSON on success",
  routeSnippet.includes("res.json("),
);

check(
  "sync-incremental route catch block returns 500 only on real throws",
  routeSnippet.includes("res.status(500)") && routeSnippet.includes("catch (err"),
);

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"═".repeat(56)}`);
console.log(`   disconnected-gmail-sync: ${passed} passed, ${failed} failed`);
console.log("═".repeat(56));

if (failed > 0) process.exit(1);
