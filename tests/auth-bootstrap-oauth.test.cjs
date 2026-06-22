/**
 * auth-bootstrap-oauth.test.cjs
 *
 * Source-grep tests for Task #36 security fixes:
 *   1. seedUsers() production guard — never seeds hard-coded credentials in prod
 *   2. OAuth CSRF nonce validation — all initiation routes set session nonce;
 *      callback validates nonce from session (not trusted from query string)
 *   3. Shared mailbox privilege escalation — flowType derived from session,
 *      master_admin re-checked in callback for shared flows
 */
"use strict";
const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  ✓ ${label}`);
  passed++;
}

function bad(label, reason) {
  console.log(`  ✗ ${label} — ${reason}`);
  failed++;
}

const authSrc = fs.readFileSync(path.join(__dirname, "../server/auth.ts"), "utf8");
const routesSrc = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");
const calendarSrc = fs.readFileSync(path.join(__dirname, "../server/calendar-sync.ts"), "utf8");

// ── 1. seedUsers() production guard ────────────────────────────────────────
console.log("\n── 1. seedUsers() production guard ──");

if (/function seedUsers/.test(authSrc))
  ok("seedUsers function is defined in auth.ts");
else
  bad("seedUsers", "not found in auth.ts");

if (/NODE_ENV.*production/.test(authSrc) || /production.*NODE_ENV/.test(authSrc))
  ok("seedUsers checks NODE_ENV before seeding");
else
  bad("seedUsers production guard", "no NODE_ENV === 'production' check found");

// The production guard must appear before the existingUsers DB query
const seedFnStart = authSrc.indexOf("function seedUsers");
const existingUsersPos = authSrc.indexOf("existingUsers", seedFnStart);
const nodeEnvPos = authSrc.indexOf("NODE_ENV", seedFnStart);
if (nodeEnvPos > seedFnStart && nodeEnvPos < existingUsersPos)
  ok("seedUsers production guard appears before DB query");
else
  bad("seedUsers guard order", "NODE_ENV check must precede the existingUsers DB query");

// The function must return before the DB query in the production branch
const seedFnText = authSrc.slice(seedFnStart, seedFnStart + 600);
if (/return/.test(seedFnText.slice(0, seedFnText.indexOf("existingUsers"))))
  ok("seedUsers returns early in production (no DB access)");
else
  bad("seedUsers early return", "does not return before DB query in production branch");

// ── 2. oauthState in SessionData ───────────────────────────────────────────
console.log("\n── 2. oauthState declared in SessionData ──");

if (/oauthState/.test(authSrc))
  ok("oauthState declared in SessionData interface");
else
  bad("oauthState SessionData", "oauthState field not found in express-session SessionData");

if (/personal.*shared.*calendar|shared.*calendar/.test(authSrc))
  ok("oauthState.type has personal | shared | calendar union");
else
  bad("oauthState type union", "personal/shared/calendar union not found");

// ── 3. OAuth initiation routes set session nonce ───────────────────────────
console.log("\n── 3. OAuth initiation routes set per-session nonce ──");

// Count randomBytes calls in OAuth initiation context (we expect ≥4: calendar, connect, connect-shared, my/mailbox/connect)
const randomBytesCalls = (routesSrc.match(/randomBytes\(32\)/g) || []).length;
if (randomBytesCalls >= 4)
  ok(`OAuth initiation routes: ${randomBytesCalls} randomBytes(32) calls found (≥4 required)`);
else
  bad("randomBytes count", `only ${randomBytesCalls} randomBytes(32) calls found, expected ≥4`);

// oauthState is stored in session in multiple places
const oauthStateStores = (routesSrc.match(/oauthState\s*=\s*\{/g) || []).length;
if (oauthStateStores >= 4)
  ok(`oauthState stored in session in ${oauthStateStores} places (≥4 required)`);
else
  bad("oauthState store count", `only ${oauthStateStores} oauthState store(s) found, expected ≥4`);

// Each storage uses type: "personal" | "shared" | "calendar"
if (/type.*"personal"/.test(routesSrc))
  ok("oauthState type 'personal' stored in at least one initiation route");
else
  bad("oauthState personal type", "type: 'personal' not found");

if (/type.*"shared"/.test(routesSrc))
  ok("oauthState type 'shared' stored in at least one initiation route");
else
  bad("oauthState shared type", "type: 'shared' not found");

if (/type.*"calendar"/.test(routesSrc))
  ok("oauthState type 'calendar' stored in at least one initiation route");
else
  bad("oauthState calendar type", "type: 'calendar' not found");

// ── 4. Callback validates nonce from session ───────────────────────────────
console.log("\n── 4. Callback validates nonce against session ──");

if (/sessionOAuth/.test(routesSrc))
  ok("callback reads sessionOAuth from session");
else
  bad("callback session read", "sessionOAuth not found in routes.ts");

if (/sessionOAuth\.nonce.*stateParam|stateParam.*sessionOAuth\.nonce/.test(routesSrc))
  ok("callback compares sessionOAuth.nonce to stateParam");
else
  bad("callback nonce comparison", "nonce !== stateParam check not found");

if (/delete.*oauthState/.test(routesSrc))
  ok("callback deletes oauthState after reading (one-time use)");
else
  bad("callback nonce consumption", "oauthState is not deleted/consumed after use");

if (/flowType\s*=\s*sessionOAuth\.type/.test(routesSrc))
  ok("callback derives flowType from session.oauthState.type (not query string)");
else
  bad("flowType source", "flowType not assigned from sessionOAuth.type");

// Callback must NOT trust req.query.state for the flow type decision
// (stateParam is used for nonce comparison only, not for branching logic)
if (!/flowType\s*=.*req\.query/.test(routesSrc))
  ok("callback does NOT assign flowType from req.query");
else
  bad("flowType isolation", "flowType appears to be assigned from req.query (unsafe)");

// ── 5. Shared inbox re-check in callback ───────────────────────────────────
console.log("\n── 5. master_admin re-check in callback for shared flows ──");

// The callback must check master_admin in the vicinity of the isShared/flowType logic
// Find callback block by offset
const callbackStart = routesSrc.indexOf('"/api/auth/google/callback"');
const callbackEnd = routesSrc.indexOf('\n  app.', callbackStart + 100);
const callbackBlock = callbackStart > 0 ? routesSrc.slice(callbackStart, callbackEnd > 0 ? callbackEnd : callbackStart + 5000) : "";

if (/master_admin/.test(callbackBlock))
  ok("callback block contains master_admin re-check for shared flows");
else
  bad("callback master_admin re-check", "master_admin check not found in callback block");

if (/isShared[\s\S]{0,600}master_admin|flowType.*shared[\s\S]{0,600}master_admin/.test(callbackBlock))
  ok("master_admin check is in the shared flow branch of callback");
else
  bad("master_admin placement", "master_admin check not clearly tied to shared flow in callback");

// ── 6. getCalendarAuthUrl accepts nonce ────────────────────────────────────
console.log("\n── 6. getCalendarAuthUrl accepts a nonce parameter ──");

if (/getCalendarAuthUrl\s*\(nonce/.test(calendarSrc))
  ok("getCalendarAuthUrl accepts a nonce parameter");
else
  bad("getCalendarAuthUrl signature", "nonce parameter not found");

if (/state.*nonce/.test(calendarSrc))
  ok("getCalendarAuthUrl passes nonce as state to Google");
else
  bad("getCalendarAuthUrl state", "nonce not passed as state");

// ── 7. /api/my/mailbox/connect guards shared flag ──────────────────────────
console.log("\n── 7. /api/my/mailbox/connect guards shared flag ──");

const myMailboxStart = routesSrc.indexOf('"/api/my/mailbox/connect"');
const myMailboxEnd = routesSrc.indexOf('\n  app.', myMailboxStart + 100);
const myMailboxBlock = myMailboxStart > 0 ? routesSrc.slice(myMailboxStart, myMailboxEnd > 0 ? myMailboxEnd : myMailboxStart + 800) : "";

if (/master_admin/.test(myMailboxBlock))
  ok("/api/my/mailbox/connect checks master_admin when shared=1");
else
  bad("/api/my/mailbox/connect master_admin guard", "no master_admin check for shared flag");

if (/403/.test(myMailboxBlock))
  ok("/api/my/mailbox/connect returns 403 for non-admin shared request");
else
  bad("/api/my/mailbox/connect 403", "403 response not found for shared guard");

if (/randomBytes/.test(myMailboxBlock) || /crypto/.test(myMailboxBlock))
  ok("/api/my/mailbox/connect generates a crypto nonce");
else
  bad("/api/my/mailbox/connect nonce", "randomBytes/crypto not found");

if (/oauthState/.test(myMailboxBlock))
  ok("/api/my/mailbox/connect stores oauthState in session");
else
  bad("/api/my/mailbox/connect session store", "oauthState not stored in session");

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
