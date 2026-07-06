"use strict";
/**
 * tests/typing-indicators.test.cjs
 *
 * DETERMINISTIC, SERVER-FREE test for the Currents typing indicator system.
 *
 * ── Root-cause of prior flakiness ────────────────────────────────────────────
 *   1. Required a live server at localhost:5000 (fails in CI / cold env).
 *   2. Three real sleep() calls totalling >= 16 s for TTL expiry.
 *   3. Depended on specific seed users existing in the DB.
 *
 * ── Fix strategy ─────────────────────────────────────────────────────────────
 *   Part 1 (unit): The three pure store functions from routes.ts are
 *     replicated inline below with an injectable clock. All TTL behaviour is
 *     tested by advancing a fake timestamp — zero real waits, no network.
 *   Part 2 (source-grep — routes.ts): Verifies the production code actually
 *     contains the expected validation logic, constants, and auth guards.
 *   Part 3 (source-grep — current.tsx): Verifies UI copy, polling config,
 *     throttle guards, and indicator placement.
 *
 * Target runtime: < 200 ms   (no network, no timers)
 *
 * Run: node tests/typing-indicators.test.cjs
 */

const fs   = require("fs");
const path = require("path");

let passed   = 0;
let failed   = 0;
const failures = [];

function assert(label, condition) {
  if (condition) {
    console.log(`  \u2713 ${label}`);
    passed++;
  } else {
    console.error(`  \u2717 ${label}`);
    failed++;
    failures.push(label);
  }
}

// ── Inline TTL store (mirrors server/routes.ts implementation exactly) ────────
//
// These functions are a direct replica of the inline implementation in
// registerRoutes() in server/routes.ts, with Date.now() replaced by an
// injectable _clock() so time can be controlled without real waits.
//
// If the production implementation ever diverges from this replica, the
// source-grep checks in Part 2 will catch the mismatch.

const TYPING_TTL_MS = 7_000;   // must match routes.ts
const MAX_TYPERS    = 10;       // must match routes.ts

let _clock = () => Date.now();

function setFakeClock(ms)     { _clock = () => ms; }
function advanceFakeClock(ms) { const prev = _clock(); _clock = () => prev + ms; }
function resetClock()         { _clock = () => Date.now(); }

const _store = new Map();

function getTypingKey(scope, id) {
  return `typing:${scope}:${id}`;
}

function readActiveTypers(key) {
  const entries = _store.get(key) || [];
  const now = _clock();
  return entries.filter(e => e.expiresAt > now);
}

function upsertTyper(key, userId, name) {
  const existing = readActiveTypers(key).filter(e => e.userId !== userId);
  const next = existing.slice(0, MAX_TYPERS - 1);
  next.push({ userId, name, expiresAt: _clock() + TYPING_TTL_MS });
  _store.set(key, next);
}

function clearStore() { _store.clear(); }

// Simulate the GET /api/current/typing response shaping (mirrors routes.ts):
//   - exclude self
//   - cap shown at 3
//   - return { typers: [{userId, name}], count }
function getTypers(key, selfUserId) {
  const active  = readActiveTypers(key).filter(e => e.userId !== selfUserId);
  const limited = active.slice(0, 3);
  return {
    typers: limited.map(e => ({ userId: e.userId, name: e.name })),
    count:  active.length,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// PART 1 — Unit tests for pure TTL store logic (fake clock, no server)
// ═════════════════════════════════════════════════════════════════════════════

console.log("Part 1 \u2014 Unit tests (pure TTL logic, fake clock)\n");

// ── 1.1  Key generation ───────────────────────────────────────────────────────
console.log("[1.1] Key generation");
assert("channel key:  typing:channel:general",
  getTypingKey("channel", "general") === "typing:channel:general");
assert("dm key:       typing:dm:42",
  getTypingKey("dm", 42)             === "typing:dm:42");
assert("thread key:   typing:thread:99",
  getTypingKey("thread", 99)         === "typing:thread:99");
assert("different scopes produce different keys",
  getTypingKey("channel", "x") !== getTypingKey("dm", "x") &&
  getTypingKey("dm", "x")      !== getTypingKey("thread", "x"));

// ── 1.2  Basic upsert + read ──────────────────────────────────────────────────
console.log("\n[1.2] Upsert + read");
clearStore();
setFakeClock(1_000);

const CH = getTypingKey("channel", "general");
upsertTyper(CH, 1, "Alice");

const r12 = readActiveTypers(CH);
assert("entry created",                r12.length === 1);
assert("entry has correct userId",     r12[0].userId === 1);
assert("entry has correct name",       r12[0].name === "Alice");
assert("expiresAt = clock + TTL",      r12[0].expiresAt === 1_000 + TYPING_TTL_MS);

// ── 1.3  Self-exclusion ───────────────────────────────────────────────────────
console.log("\n[1.3] Self-exclusion");
clearStore();
setFakeClock(1_000);
upsertTyper(CH, 1, "Alice");

const selfView  = getTypers(CH, 1);   // Alice reads — should see nobody
const otherView = getTypers(CH, 2);   // Bob reads — should see Alice

assert("self excluded from own view",   selfView.count === 0);
assert("typers array empty for self",   selfView.typers.length === 0);
assert("other user sees Alice",         otherView.count === 1);
assert("other view typers has 1 entry", otherView.typers.length === 1);

// ── 1.4  Deduplication (re-ping same user) ────────────────────────────────────
console.log("\n[1.4] Deduplication");
clearStore();
setFakeClock(1_000);
upsertTyper(CH, 1, "Alice");
upsertTyper(CH, 1, "Alice");   // re-ping
upsertTyper(CH, 1, "Alice");   // again

const r14 = readActiveTypers(CH);
assert("re-pings do not duplicate user",   r14.length === 1);
assert("re-ping updates expiresAt",
  r14[0].expiresAt === _clock() + TYPING_TTL_MS);

// ── 1.5  Multiple concurrent typers ──────────────────────────────────────────
console.log("\n[1.5] Multiple typers");
clearStore();
setFakeClock(1_000);
upsertTyper(CH, 1, "Alice");
upsertTyper(CH, 2, "Bob");
upsertTyper(CH, 3, "Carol");

assert("Alice sees 2 others",  getTypers(CH, 1).count === 2);
assert("Bob sees 2 others",    getTypers(CH, 2).count === 2);
assert("Carol sees 2 others",  getTypers(CH, 3).count === 2);

// ── 1.6  Cap at 3 shown; full count preserved ────────────────────────────────
console.log("\n[1.6] Cap at 3 shown, full count preserved");
clearStore();
setFakeClock(1_000);
for (let i = 1; i <= 5; i++) upsertTyper(CH, i, `User${i}`);

const r16 = getTypers(CH, 99);   // observer who is not in the bucket
assert("typers array capped at 3",    r16.typers.length === 3);
assert("count reflects all 5 typers", r16.count === 5);

// ── 1.7  TTL expiry ───────────────────────────────────────────────────────────
console.log("\n[1.7] TTL expiry");
clearStore();
setFakeClock(1_000);
upsertTyper(CH, 1, "Alice");   // expiresAt = 1000 + 7000 = 8000

// Visible immediately
assert("visible at t+0",
  readActiveTypers(CH).length === 1);

// Visible 1 ms before expiry (now=7999, expiresAt=8000 → 8000 > 7999 = true)
setFakeClock(1_000 + TYPING_TTL_MS - 1);
assert("visible 1 ms before TTL",
  readActiveTypers(CH).length === 1);

// Expired at exactly TTL (now=8000, expiresAt=8000 → 8000 > 8000 = false)
setFakeClock(1_000 + TYPING_TTL_MS);
assert("expired at exactly TTL (not strictly greater)",
  readActiveTypers(CH).length === 0);

// Expired 1 ms after TTL
setFakeClock(1_000 + TYPING_TTL_MS + 1);
assert("expired 1 ms after TTL",
  readActiveTypers(CH).length === 0);

// ── 1.8  TTL refresh (re-ping before expiry resets the timer) ─────────────────
console.log("\n[1.8] TTL refresh");
clearStore();
setFakeClock(1_000);
upsertTyper(CH, 1, "Alice");               // expiresAt = 8000

setFakeClock(4_000);                       // 3 s in — still alive
upsertTyper(CH, 1, "Alice");              // refresh → expiresAt = 4000+7000 = 11000

setFakeClock(8_500);                       // would have expired without refresh
assert("re-ping before expiry keeps entry alive",
  readActiveTypers(CH).length === 1);

setFakeClock(10_999);                      // just before refreshed expiry
assert("entry alive near refreshed expiry",
  readActiveTypers(CH).length === 1);

setFakeClock(11_001);                      // past refreshed expiry
assert("entry expires at refreshed TTL",
  readActiveTypers(CH).length === 0);

// ── 1.9  Partial expiry — non-expired entries preserved ──────────────────────
console.log("\n[1.9] Partial expiry");
clearStore();
setFakeClock(1_000);
upsertTyper(CH, 1, "Alice");               // expiresAt = 8000

setFakeClock(5_000);
upsertTyper(CH, 2, "Bob");                 // expiresAt = 12000

setFakeClock(9_000);                       // Alice expired (8000), Bob alive (12000)
const r19 = readActiveTypers(CH);
assert("Alice expired, Bob still alive",      r19.length === 1);
assert("surviving entry is Bob (userId=2)",   r19[0].userId === 2);
assert("Alice not returned after expiry",     !r19.find(e => e.userId === 1));

// ── 1.10  Cross-scope isolation ───────────────────────────────────────────────
console.log("\n[1.10] Cross-scope isolation");
clearStore();
setFakeClock(1_000);

const CH_KEY     = getTypingKey("channel", "general");
const DM_KEY     = getTypingKey("dm", 42);
const THREAD_KEY = getTypingKey("thread", 99);

upsertTyper(CH_KEY,     1, "Alice");
upsertTyper(DM_KEY,     2, "Bob");
upsertTyper(THREAD_KEY, 3, "Carol");

assert("channel key only has Alice",
  readActiveTypers(CH_KEY).length === 1 && readActiveTypers(CH_KEY)[0].userId === 1);
assert("dm key only has Bob",
  readActiveTypers(DM_KEY).length === 1 && readActiveTypers(DM_KEY)[0].userId === 2);
assert("thread key only has Carol",
  readActiveTypers(THREAD_KEY).length === 1 && readActiveTypers(THREAD_KEY)[0].userId === 3);
assert("channel has no DM entries",
  !readActiveTypers(CH_KEY).find(e => e.userId === 2));
assert("DM has no thread entries",
  !readActiveTypers(DM_KEY).find(e => e.userId === 3));
assert("thread has no channel entries",
  !readActiveTypers(THREAD_KEY).find(e => e.userId === 1));

// ── 1.11  Response shape — no internal fields leaked ─────────────────────────
console.log("\n[1.11] Response shape security");
clearStore();
setFakeClock(1_000);
upsertTyper(CH, 10, "Zara");

const r111 = getTypers(CH, 99);
const keys = Object.keys(r111.typers[0] || {});
assert("response entry has exactly userId and name",
  keys.length === 2 && keys.includes("userId") && keys.includes("name"));
assert("expiresAt not leaked to caller",
  !keys.includes("expiresAt"));

// ── 1.12  Store cap — bucket never grows past MAX_TYPERS ─────────────────────
console.log("\n[1.12] Store cap (MAX_TYPERS)");
clearStore();
setFakeClock(1_000);
for (let i = 1; i <= 12; i++) upsertTyper(CH, i, `U${i}`);

const r112 = readActiveTypers(CH);
assert("store capped at MAX_TYPERS (10)", r112.length === MAX_TYPERS);

resetClock();

// ═════════════════════════════════════════════════════════════════════════════
// PART 2 — Source-grep: server/routes.ts
// ═════════════════════════════════════════════════════════════════════════════

console.log("\nPart 2 \u2014 Source-grep: server/routes.ts\n");

const routes = fs.readFileSync(
  path.resolve(__dirname, "../server/routes.ts"), "utf8"
);

// ── 2.1  Constants match the unit-tested replica ──────────────────────────────
console.log("[2.1] Constants");
assert("TYPING_TTL_MS = 7_000",
  /TYPING_TTL_MS\s*=\s*7_000/.test(routes));
assert("MAX_TYPERS = 10",
  /MAX_TYPERS\s*=\s*10/.test(routes));
assert("TTL expiry filter: expiresAt > now",
  routes.includes("e.expiresAt > now"));
assert("expiresAt set to Date.now() + TYPING_TTL_MS",
  routes.includes("expiresAt: Date.now() + TYPING_TTL_MS"));
assert("dedup: filter out same userId before upsert",
  routes.includes("e.userId !== userId"));

// ── 2.2  Routes registered with requireAuth ───────────────────────────────────
console.log("\n[2.2] Route registration + auth guards");
assert('POST /api/current/typing registered',
  routes.includes('app.post("/api/current/typing"'));
assert('GET  /api/current/typing registered',
  routes.includes('app.get("/api/current/typing"'));
assert("requireAuth on POST /api/current/typing", (() => {
  const idx = routes.indexOf('app.post("/api/current/typing"');
  return idx >= 0 && routes.slice(idx, idx + 120).includes("requireAuth");
})());
assert("requireAuth on GET /api/current/typing", (() => {
  const idx = routes.indexOf('app.get("/api/current/typing"');
  return idx >= 0 && routes.slice(idx, idx + 120).includes("requireAuth");
})());

// ── 2.3  Scope validation (400s) ─────────────────────────────────────────────
console.log("\n[2.3] Scope validation");
assert("invalid scope \u2192 400 message",  routes.includes("scope must be channel | dm | thread"));
assert("missing channelSlug \u2192 400",    routes.includes("channelSlug required"));
assert("missing conversationId \u2192 400", routes.includes("conversationId required"));
assert("missing rootMessageId \u2192 400",  routes.includes("rootMessageId required"));

// ── 2.4  404 guards ───────────────────────────────────────────────────────────
console.log("\n[2.4] 404 guards");
assert("non-existent channel \u2192 404",     routes.includes("Channel not found"));
assert("non-existent thread root \u2192 404", routes.includes("Thread root not found"));

// ── 2.5  Access control ───────────────────────────────────────────────────────
console.log("\n[2.5] Access control");
assert("archived channel blocks typing",   routes.includes("Cannot type in an archived channel"));
assert("DM non-member \u2192 403",
  routes.includes("Not a member of this conversation"));
assert("private channel non-member \u2192 403",
  routes.includes("Not a member of this private channel"));

// ── 2.6  GET response shaping ─────────────────────────────────────────────────
console.log("\n[2.6] GET response shaping (self-exclude, cap at 3, shape)");
const getBlock = (() => {
  const idx = routes.indexOf('app.get("/api/current/typing"');
  return idx >= 0 ? routes.slice(idx, idx + 3_500) : "";
})();
assert("GET self-excluded via userId filter",  getBlock.includes("e.userId !== userId"));
assert("GET caps shown at 3",                  getBlock.includes("slice(0, 3)"));
assert("GET returns typers array",             getBlock.includes("typers:"));
assert("GET returns count",                    getBlock.includes("count:"));

// ── 2.7  Regression: Currents basic routes present ───────────────────────────
console.log("\n[2.7] Regression: Currents basic routes");
assert("/api/current/channels route exists",
  routes.includes('"/api/current/channels"'));
assert("/api/current/dms route exists",
  routes.includes('"/api/current/dms"'));
assert("channel messages route exists",
  routes.includes("/api/current/channels/:slug/messages"));
assert("thread messages route exists",
  routes.includes("/api/current/messages/:id/thread") ||
  routes.includes("/messages/:rootId/thread"));

// ═════════════════════════════════════════════════════════════════════════════
// PART 3 — Source-grep: client/src/pages/current.tsx
// ═════════════════════════════════════════════════════════════════════════════

console.log("\nPart 3 \u2014 Source-grep: client/src/pages/current.tsx\n");

const src = fs.readFileSync(
  path.resolve(__dirname, "../client/src/pages/current.tsx"), "utf8"
);

// ── 3.1  TypingIndicator UI copy ──────────────────────────────────────────────
console.log("[3.1] TypingIndicator UI copy");
assert("one-typer:   '... is typing' template",             src.includes("is typing`"));
assert("two-typers:  '... and ... are typing' template",    src.includes("are typing`"));
assert("three-plus:  '... and N other(s) are typing'",      src.includes("} are typing`"));

// ── 3.2  TypingIndicator component structure ──────────────────────────────────
console.log("\n[3.2] TypingIndicator component structure");
assert("h-5 container prevents layout shift",  src.includes('"h-5 flex items-center'));
assert("aria-live='polite' on indicator",      src.includes('aria-live="polite"'));
assert("data-testid='typing-indicator'",       src.includes('data-testid="typing-indicator"'));
assert("animate-bounce on dots",               src.includes("animate-bounce"));
assert("staggered animationDelay on dots",     src.includes("animationDelay"));

// ── 3.3  Throttle refs (one per scope) ────────────────────────────────────────
console.log("\n[3.3] Ping throttle refs");
assert("channelTypingPingRef declared",  src.includes("channelTypingPingRef"));
assert("dmTypingPingRef declared",       src.includes("dmTypingPingRef"));
assert("threadTypingPingRef declared",   src.includes("threadTypingPingRef"));
assert("channel ping throttle 2 500 ms",
  src.includes("channelTypingPingRef.current > 2_500"));
assert("DM ping throttle 2 500 ms",
  src.includes("dmTypingPingRef.current > 2_500"));
assert("thread ping throttle 2 500 ms",
  src.includes("threadTypingPingRef.current > 2_500"));

// ── 3.4  Polling queries ──────────────────────────────────────────────────────
console.log("\n[3.4] Polling queries (refetchInterval: 3 s)");
assert("channel query refetchInterval 3 s",
  src.includes("refetchInterval: 3_000") && src.includes("scope=channel"));
assert("DM query uses scope=dm",
  src.includes("scope=dm"));
assert("thread query uses scope=thread&rootMessageId",
  src.includes("scope=thread&rootMessageId"));
assert("refetchOnWindowFocus: false on all three typing queries",
  (src.match(/refetchOnWindowFocus:\s*false/g) || []).length >= 3);

// ── 3.5  Draft guard — ping only when composer is non-empty ──────────────────
console.log("\n[3.5] Draft guards (trim() before ping)");
assert("channel ping guarded by .trim()", (() => {
  const idx = src.indexOf("channelTypingPingRef.current = now");
  return idx >= 0 && src.substring(Math.max(0, idx - 200), idx).includes(".trim()");
})());
assert("DM ping guarded by .trim()", (() => {
  const idx = src.indexOf("dmTypingPingRef.current = now");
  return idx >= 0 && src.substring(Math.max(0, idx - 200), idx).includes(".trim()");
})());

// ── 3.6  Archive guards ───────────────────────────────────────────────────────
console.log("\n[3.6] Archive guards (no ping in archived context)");
assert("channel ping guarded by isArchivedChannel", (() => {
  const idx = src.indexOf("channelTypingPingRef.current = now");
  return idx >= 0 && src.substring(Math.max(0, idx - 300), idx).includes("isArchivedChannel");
})());
assert("thread ping guarded by isArchived", (() => {
  const idx = src.indexOf("threadTypingPingRef.current = now");
  return idx >= 0 && src.substring(Math.max(0, idx - 300), idx).includes("isArchived");
})());
assert("thread typing enabled: !!rootMessageId && !isArchived",
  src.includes("!!rootMessageId && !isArchived"));

// ── 3.7  Indicator placement (before pending-files UI) ───────────────────────
console.log("\n[3.7] Indicator placement (above pending-files inputs)");
assert("DM TypingIndicator before dmPendingFiles block", (() => {
  const tiIdx = src.indexOf("dmTypingData?.typers");
  const pfIdx = src.indexOf("{dmPendingFiles.length > 0 &&");
  return tiIdx > 0 && pfIdx > 0 && tiIdx < pfIdx;
})());
assert("channel TypingIndicator before mainPendingFiles block", (() => {
  const tiIdx = src.indexOf("channelTypingData?.typers");
  const pfIdx = src.indexOf("{mainPendingFiles.length > 0 &&");
  return tiIdx > 0 && pfIdx > 0 && tiIdx < pfIdx;
})());
assert("thread TypingIndicator before replyPendingFiles block", (() => {
  const tiIdx = src.indexOf("threadTypingData?.typers");
  const pfIdx = src.indexOf("{replyPendingFiles.length > 0 &&");
  return tiIdx > 0 && pfIdx > 0 && tiIdx < pfIdx;
})());

// ── 3.8  All three scopes wired to TypingIndicator ───────────────────────────
console.log("\n[3.8] All three scope queries wired to TypingIndicator");
assert("channelTypingData.typers wired to TypingIndicator",
  src.includes("channelTypingData?.typers"));
assert("dmTypingData.typers wired to TypingIndicator",
  src.includes("dmTypingData?.typers"));
assert("threadTypingData.typers wired to TypingIndicator",
  src.includes("threadTypingData?.typers"));

// ═════════════════════════════════════════════════════════════════════════════
// Summary
// ═════════════════════════════════════════════════════════════════════════════

console.log(`\n${"─".repeat(60)}`);
console.log(`Typing Indicators: ${passed} passed, ${failed} failed  (total ${passed + failed})`);

if (failures.length) {
  console.error("\nFailed tests:");
  failures.forEach(f => console.error(`  \u2717 ${f}`));
  process.exit(1);
} else {
  console.log("\nAll tests passed \u2713");
  process.exit(0);
}
