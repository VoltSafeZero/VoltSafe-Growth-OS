#!/usr/bin/env node
/**
 * Commit 5 regression test: foreground 15s polling fallback for
 * incremental Gmail sync.
 *
 * Commit 5 added a frontend useEffect inside client/src/pages/gmail-inbox.tsx
 * that calls the existing POST /api/gmail/sync-incremental endpoint every
 * 15s for any account whose webhook / incremental-sync state is stale,
 * gated by document.visibilityState === "visible". This is the user-facing
 * safety net since push (Pub/Sub) is unreliable in the dev environment.
 *
 * Two specific things this test pins:
 *
 *   (a) The polling REUSES the existing endpoint. T002 in the session plan
 *       collapsed to zero new code precisely because /api/gmail/sync-incremental
 *       already does the right thing (requireAuth + requireOwnerOrAdmin +
 *       syncIncremental call). If a future change adds a redundant new
 *       endpoint OR removes the existing one, this test fires.
 *
 *   (b) The frontend polling has all the safety guards in place: 15s
 *       interval, visibilityState check, per-account cooldown, in-flight
 *       guard, and the per-account staleness gates. If any of those gates
 *       gets dropped in a refactor, this test fires.
 *
 * Why source-grep instead of HTTP / Vitest:
 *   • The HTTP path requires a valid admin session cookie; test
 *     credentials in this repo have drifted (5 legacy test workflows are
 *     still failing for the same login-403 reason — pre-existing, out of
 *     scope for any open commit, documented in replit.md operational
 *     follow-ups). Adding a new test that fails for the same drift adds
 *     noise, not signal.
 *   • The actual regression we're guarding against is a SOURCE EDIT. A
 *     source-grep catches that edit at test time with zero dependencies,
 *     zero environment setup, and zero runtime cost. It runs in any
 *     environment including CI without DB or network access.
 *   • End-to-end behaviour (does mail actually appear within 15s of
 *     arrival in Gmail?) is verified manually in .dev (per the user-facing
 *     verification list in replit.md / Commit 5 entry) and via the
 *     scripts/pubsub-diagnostic.ts one-off.
 *
 * Run: node tests/foreground-polling.test.js
 * No DB writes. No schema changes. No network. No env vars. No login.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTES_PATH = join(__dirname, "..", "server", "routes.ts");
const INBOX_PATH = join(__dirname, "..", "client", "src", "pages", "gmail-inbox.tsx");

let passed = 0;
let failed = 0;
const ok = (l) => { console.log(`  \u2713 ${l}`); passed++; };
const bad = (l, d) => { console.error(`  \u2717 ${l}${d ? ` \u2014 ${d}` : ""}`); failed++; };

function run() {
  console.log("Foreground polling fallback regression test (Commit 5)");

  // ── Group A: server endpoint must exist (no rename / removal) ────────
  console.log(`\n[A] server/routes.ts — endpoint reuse`);
  let routesSrc;
  try {
    routesSrc = readFileSync(ROUTES_PATH, "utf8");
    ok("read server/routes.ts");
  } catch (e) {
    bad("read server/routes.ts", e.message);
    process.exit(1);
  }

  // The existing endpoint that the polling fallback reuses.
  if (routesSrc.includes('app.post("/api/gmail/sync-incremental"')) {
    ok('endpoint registered: POST /api/gmail/sync-incremental');
  } else {
    bad('endpoint registered: POST /api/gmail/sync-incremental',
        "renamed or removed — Commit 5 polling fallback would 404");
  }

  // The endpoint must still call requireAuth and use the per-account guard.
  // Use a single regex over a small window to keep this resilient to
  // formatting tweaks while still catching a truly broken refactor.
  const endpointWindowMatch = routesSrc.match(/app\.post\("\/api\/gmail\/sync-incremental"[\s\S]{0,800}?\}\);/);
  if (endpointWindowMatch) {
    const win = endpointWindowMatch[0];
    if (win.includes("requireAuth")) ok("sync-incremental still uses requireAuth");
    else bad("sync-incremental still uses requireAuth", "auth gate dropped");
    if (win.includes("requireOwnerOrAdmin")) ok("sync-incremental still uses requireOwnerOrAdmin per-account check");
    else bad("sync-incremental still uses requireOwnerOrAdmin per-account check", "per-account guard dropped");
    if (/syncIncremental\s*\(/.test(win)) ok("sync-incremental still calls syncIncremental()");
    else bad("sync-incremental still calls syncIncremental()", "service call removed");
  } else {
    bad("able to inspect sync-incremental handler", "couldn't locate handler block");
  }

  // No accidental duplicate of the polling endpoint (T002 was deliberately
  // collapsed; a new /poll-now route would be redundant API surface).
  if (!/\/api\/gmail\/accounts\/:id\/poll-now/.test(routesSrc)) {
    ok("no redundant /api/gmail/accounts/:id/poll-now endpoint added");
  } else {
    bad("no redundant /api/gmail/accounts/:id/poll-now endpoint added",
        "Commit 5 deliberately reused the existing endpoint instead");
  }

  // ── Group B: frontend polling safety guards ──────────────────────────
  console.log(`\n[B] client/src/pages/gmail-inbox.tsx — polling guards`);
  let inboxSrc;
  try {
    inboxSrc = readFileSync(INBOX_PATH, "utf8");
    ok("read client/src/pages/gmail-inbox.tsx");
  } catch (e) {
    bad("read client/src/pages/gmail-inbox.tsx", e.message);
    process.exit(1);
  }

  // 15s interval (the contract) is present and uses the named constant.
  if (/POLLING_TICK_MS\s*=\s*15_000/.test(inboxSrc)) {
    ok("polling tick constant: 15_000 ms");
  } else {
    bad("polling tick constant: 15_000 ms", "cadence drifted from spec");
  }
  if (/setInterval\(\s*tick\s*,\s*POLLING_TICK_MS\s*\)/.test(inboxSrc)) {
    ok("setInterval(tick, POLLING_TICK_MS) present");
  } else {
    bad("setInterval(tick, POLLING_TICK_MS) present", "interval call missing or restructured");
  }

  // visibilityState gate — the foreground-only contract.
  if (/document\.visibilityState\s*!==\s*"visible"/.test(inboxSrc)) {
    ok('document.visibilityState !== "visible" gate present');
  } else {
    bad('document.visibilityState !== "visible" gate present',
        "polling would now run on hidden tabs — burns API budget");
  }
  if (/addEventListener\(\s*"visibilitychange"/.test(inboxSrc)) {
    ok("visibilitychange listener attached for tab-wake-up");
  } else {
    bad("visibilitychange listener attached for tab-wake-up",
        "tab-wake-up moment was lost");
  }

  // Per-account guards: cooldown, in-flight, staleness.
  if (/PER_ACCOUNT_COOLDOWN_MS\s*=\s*15_000/.test(inboxSrc)) {
    ok("per-account cooldown: 15_000 ms");
  } else {
    bad("per-account cooldown: 15_000 ms", "cooldown drifted or removed");
  }
  if (/STALENESS_THRESHOLD_MS\s*=\s*60_000/.test(inboxSrc)) {
    ok("staleness threshold: 60_000 ms");
  } else {
    bad("staleness threshold: 60_000 ms", "staleness gate drifted or removed");
  }
  if (/inFlightPollRef\.current\.has\(/.test(inboxSrc)) {
    ok("in-flight guard via inFlightPollRef present");
  } else {
    bad("in-flight guard via inFlightPollRef present",
        "double-fire protection removed — same account could be polled twice in <15s");
  }
  if (/inFlightPollRef\.current\.add\(/.test(inboxSrc) && /inFlightPollRef\.current\.delete\(/.test(inboxSrc)) {
    ok("in-flight set is updated symmetrically (.add + .delete)");
  } else {
    bad("in-flight set is updated symmetrically (.add + .delete)",
        "asymmetric update would leak account ids and silently disable polling for them");
  }

  // Anti-regression: the polling hook MUST NOT skip on watchExpirationAt.
  // An earlier draft had `if (a.watchExpirationAt && ... < now) continue;`
  // which was semantically backwards — watch state governs push delivery,
  // not the history-API polling path. Expired or null watchExpirationAt is
  // precisely WHEN polling matters most. Architect review caught this and
  // it was removed. This assertion pins that removal so a future "tidy-up"
  // pass doesn't reintroduce the broken gate.
  if (!/if\s*\(\s*a\.watchExpirationAt\s*&&[\s\S]{0,80}?<\s*now\s*\)\s*continue/.test(inboxSrc)) {
    ok("anti-regression: polling does NOT skip on watchExpirationAt < now");
  } else {
    bad("anti-regression: polling does NOT skip on watchExpirationAt < now",
        "the semantically-backwards skip was reintroduced — see Commit 5 architect note");
  }

  // The auth/sync-enabled guards.
  if (/a\.authStatus\s*!==\s*"active"/.test(inboxSrc)) {
    ok('skip when authStatus !== "active"');
  } else {
    bad('skip when authStatus !== "active"',
        "polling would attempt sync on revoked/expired accounts and produce noise");
  }
  if (/a\.syncEnabled\s*===\s*false/.test(inboxSrc)) {
    ok("skip when syncEnabled === false");
  } else {
    bad("skip when syncEnabled === false",
        "polling would override a deliberate pause");
  }

  // Endpoint reuse contract — frontend hits the existing route, not a new one.
  if (/`\/api\/gmail\/sync-incremental\?accountId=\$\{a\.id\}`/.test(inboxSrc)) {
    ok("frontend posts to existing /api/gmail/sync-incremental?accountId=...");
  } else {
    bad("frontend posts to existing /api/gmail/sync-incremental?accountId=...",
        "endpoint URL drifted — would 404 against the registered route");
  }

  // Reads from accountsHealthQuery.data via a ref (no extra round-trip).
  if (/healthDataRef\.current/.test(inboxSrc)) {
    ok("polling reads from healthDataRef (no extra fetch)");
  } else {
    bad("polling reads from healthDataRef (no extra fetch)",
        "extra round-trip would defeat the point of the existing 30s health poll");
  }

  // Cache invalidation on success — UI must refresh when sync brings in mail.
  if (/queryClient\.invalidateQueries\(\{\s*queryKey:\s*\["\/api\/gmail\/messages"\]\s*\}\)/.test(inboxSrc)) {
    ok("invalidates inbox messages query on successful sync");
  } else {
    bad("invalidates inbox messages query on successful sync",
        "UI would not show new mail until the next inboxQuery 15s tick");
  }
  if (/queryClient\.invalidateQueries\(\{\s*queryKey:\s*\["\/api\/gmail\/threads"\]\s*\}\)/.test(inboxSrc)) {
    ok("invalidates threads query on successful sync");
  } else {
    bad("invalidates threads query on successful sync",
        "thread view would lag behind list view");
  }

  // Cleanup on unmount.
  if (/clearInterval\(\s*handle\s*\)/.test(inboxSrc)) {
    ok("interval cleared on unmount");
  } else {
    bad("interval cleared on unmount",
        "leak — interval would keep firing after navigating away");
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

run();
