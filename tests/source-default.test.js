#!/usr/bin/env node
/**
 * Commit 4.1 regression test: source param default
 *
 * After Commit 4 removed the mailSource toggle from the frontend, the
 * server-side default for the `source` query param was still "gmail".
 * That meant every list request silently bypassed the local mirror and
 * round-tripped to Gmail's REST API — invisible for trevor (his mirror is
 * always fresh) but catastrophic for shared mailboxes (sales/support saw
 * only the live recent-N slice instead of their historical archive).
 *
 * Commit 4.1 flipped the default to "local" on three endpoints:
 *   /api/gmail/messages
 *   /api/gmail/threads
 *   /api/gmail/threads/:id
 *
 * This test pins that behaviour at the SOURCE LEVEL — it greps
 * server/routes.ts and asserts every `req.query.source` default reads
 * "local", not "gmail". That's the precise mistake we're guarding against
 * (someone re-typing `|| "gmail"` in any of the three places, or
 * adding a new list-route copy-pasted from the old shape).
 *
 * Why source-grep instead of an HTTP smoke test:
 *   • Live HTTP testing requires a valid admin session cookie. Test
 *     credentials in this repo have drifted; all five existing
 *     test workflows are currently failing for the same login-403 reason.
 *     A new test that fails for the same drift adds noise, not signal.
 *   • The actual regression we're guarding against is a source-code edit.
 *     A source-grep catches that edit at test time with zero dependencies,
 *     zero environment setup, and zero runtime cost. It runs in any
 *     environment including CI without DB or network access.
 *   • The HTTP behaviour is verified manually in .dev (per the user-
 *     facing verification list in replit.md / Commit 4.1 entry).
 *
 * Run: node tests/source-default.test.js
 * No DB writes. No schema changes. No network. No env vars. No login.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTES_PATH = join(__dirname, "..", "server", "routes.ts");

let passed = 0;
let failed = 0;
const ok = (l) => { console.log(`  \u2713 ${l}`); passed++; };
const bad = (l, d) => { console.error(`  \u2717 ${l}${d ? ` \u2014 ${d}` : ""}`); failed++; };

function run() {
  console.log("Source default regression test (Commit 4.1)");
  console.log(`  scanning: ${ROUTES_PATH}`);

  let src;
  try {
    src = readFileSync(ROUTES_PATH, "utf8");
    ok("read server/routes.ts");
  } catch (e) {
    bad("read server/routes.ts", e.message);
    process.exit(1);
  }

  // 1) NO occurrences of the regressed pattern. This is the strongest assertion:
  //    if anyone re-introduces `|| "gmail"` next to req.query.source on ANY
  //    new or existing list route, this test fails immediately.
  const regressedPattern = /\(req\.query\.source\s+as\s+string\)\s*\|\|\s*"gmail"/g;
  const regressedMatches = src.match(regressedPattern) || [];
  if (regressedMatches.length === 0) {
    ok('no `(req.query.source as string) || "gmail"` defaults remain');
  } else {
    bad('no `(req.query.source as string) || "gmail"` defaults remain',
        `found ${regressedMatches.length} occurrence(s) — Commit 4.1 regression`);
  }

  // 2) The expected pattern IS present. We expect exactly 3 — one per
  //    affected endpoint. Drift from 3 means either we lost one (regression)
  //    or someone added a new list route without thinking about the default
  //    (worth a deliberate decision — fail loud and force a re-read of
  //    Commit 4.1's note in replit.md).
  const correctPattern = /\(req\.query\.source\s+as\s+string\)\s*\|\|\s*"local"/g;
  const correctMatches = src.match(correctPattern) || [];
  if (correctMatches.length === 3) {
    ok('exactly 3 `(req.query.source as string) || "local"` defaults present');
  } else {
    bad('exactly 3 `(req.query.source as string) || "local"` defaults present',
        `expected 3, found ${correctMatches.length} — investigate before extending`);
  }

  // 3) Each of the three named routes is still registered. Cheap belt-and-
  //    suspenders so a future rename of the route doesn't silently move
  //    the default out from under us without anyone noticing.
  const routesExpected = [
    'app.get("/api/gmail/messages"',
    'app.get("/api/gmail/threads"',
    'app.get("/api/gmail/threads/:id"',
  ];
  for (const needle of routesExpected) {
    if (src.includes(needle)) ok(`route registered: ${needle.slice(8)}`);
    else bad(`route registered: ${needle.slice(8)}`, "not found in routes.ts");
  }

  // 4) Each `|| "local"` line is preceded (within ~12 lines, allowing for
  //    inline comment blocks above the default) by an `if (!resolved)`
  //    early return — sanity-checks that the default flip didn't
  //    accidentally land in some unrelated code path with a structurally
  //    similar query-param read.
  const lines = src.split("\n");
  // Non-global regex to avoid lastIndex state bleed across lines.
  const perLinePattern = /\(req\.query\.source\s+as\s+string\)\s*\|\|\s*"local"/;
  const localDefaultLines = [];
  lines.forEach((line, i) => {
    if (perLinePattern.test(line)) localDefaultLines.push(i);
  });
  for (const idx of localDefaultLines) {
    const window = lines.slice(Math.max(0, idx - 12), idx).join("\n");
    if (/if\s*\(\s*!\s*resolved\s*\)/.test(window)) {
      ok(`source default at line ${idx + 1} is downstream of resolveAccount`);
    } else {
      bad(`source default at line ${idx + 1} is downstream of resolveAccount`,
          "no `if (!resolved)` guard found in the 12 lines above");
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

run();
