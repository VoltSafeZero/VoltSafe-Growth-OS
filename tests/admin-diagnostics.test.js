#!/usr/bin/env node
/**
 * Commit 8 — Admin Diagnostic + Recovery Endpoints (source-grep test)
 *
 * Source-grep test (no live HTTP / no DB writes) — pins the structural
 * contract of the four admin endpoints introduced in Commit 8:
 *
 *   GET  /api/admin/mailbox/diagnostics
 *   GET  /api/admin/mailbox/:id/diagnostics
 *   POST /api/admin/mailbox/:id/trigger-backfill
 *   POST /api/admin/mailbox/:id/force-full-resync
 *
 * Plus the `autoEnqueueBackfillForNewAccount` export refactor in
 * server/gmail-oauth.ts that makes both the OAuth-completion path AND
 * the admin trigger-backfill path use the same canonical helper.
 *
 * Why source-grep instead of a live HTTP test:
 *   The endpoints fire long-running workers (runBackfillJob,
 *   syncIncremental) that touch real Gmail. A live test would either
 *   need a mock Gmail or make real Google API calls. Pinning the source
 *   shape catches regressions in route definitions, auth gates, payload
 *   shapes, and the trigger→worker call edges — which is the bulk of
 *   what could regress without an integration test catching it.
 *
 * Run: node tests/admin-diagnostics.test.js
 */

import fs from "node:fs";

const ROUTES   = fs.readFileSync("server/routes.ts", "utf8");
const OAUTH    = fs.readFileSync("server/gmail-oauth.ts", "utf8");

let passed = 0, failed = 0;
const ok  = (l) => { console.log(`  \u2713 ${l}`);            passed++; };
const bad = (l, d) => { console.error(`  \u2717 ${l}${d ? ` \u2014 ${d}` : ""}`); failed++; };

function assert(cond, label, detail) {
  if (cond) ok(label); else bad(label, detail);
}

console.log("\nCommit 8 — Admin Diagnostic + Recovery Endpoints source-grep tests\n");

// ── Group A: gmail-oauth.ts canonical helper export ──────────────────────────
console.log("Group A — canonical enqueue helper:");

assert(
  /export\s+async\s+function\s+autoEnqueueBackfillForNewAccount\s*\(/.test(OAUTH),
  "A1: autoEnqueueBackfillForNewAccount is exported (was previously private)"
);

assert(
  /dateFromOverride\?:\s*string/.test(OAUTH) &&
  /dateToOverride\?:\s*string/.test(OAUTH) &&
  /skipIdempotencyCheck\?:\s*boolean/.test(OAUTH),
  "A2: helper accepts dateFromOverride / dateToOverride / skipIdempotencyCheck"
);

assert(
  /skipIdempotencyCheck\s*\?[\s\S]*?:\s*`INSERT INTO backfill_jobs/.test(OAUTH) &&
  /WHERE NOT EXISTS\s*\(\s*SELECT 1 FROM backfill_jobs/.test(OAUTH) &&
  /status\s+IN\s*\(\s*'pending'\s*,\s*'running'\s*,\s*'cancelling'\s*\)/.test(OAUTH),
  "A3: idempotency uses atomic INSERT-WHERE-NOT-EXISTS guarding pending+running+cancelling, with skipIdempotencyCheck branch (architect-fixed TOCTOU)"
);

assert(
  /return\s*\{\s*enqueued:\s*true\b[^}]*\bjobId\b[^}]*\bdateFrom\b[^}]*\bdateTo\b/.test(OAUTH) &&
  /return\s*\{\s*enqueued:\s*false\s*,\s*reason:/.test(OAUTH),
  "A4: helper returns { enqueued, jobId?, dateFrom?, dateTo?, reason? } shape"
);

// ── Group B: GET /api/admin/mailbox/diagnostics (system overview) ────────────
console.log("\nGroup B — GET /api/admin/mailbox/diagnostics (system overview):");

assert(
  /app\.get\(\s*"\/api\/admin\/mailbox\/diagnostics"\s*,\s*requireAuth\s*,\s*requireAdmin\s*,/.test(ROUTES),
  "B1: route registered with requireAuth + requireAdmin"
);

const overviewBlock = ROUTES.match(
  /app\.get\(\s*"\/api\/admin\/mailbox\/diagnostics"[\s\S]*?app\.get\(\s*"\/api\/admin\/mailbox\/:id\/diagnostics"/
)?.[0] ?? "";

assert(
  /AS\s+"accountId"/.test(overviewBlock) &&
  /AS\s+"emailAddress"/.test(overviewBlock) &&
  /AS\s+"lastWebhookAt"/.test(overviewBlock) &&
  /AS\s+"lastIncrementalSyncAt"/.test(overviewBlock) &&
  /AS\s+"lastHistoryId"/.test(overviewBlock) &&
  /AS\s+"watchExpirationAt"/.test(overviewBlock) &&
  /AS\s+"storedMessageCount"/.test(overviewBlock) &&
  /AS\s+"queueDepth"/.test(overviewBlock),
  "B2: SELECT exposes all required diagnostic fields with camelCase aliases"
);

assert(
  /AS\s+"inflightBackfill"/.test(overviewBlock) &&
  /AS\s+"latestTerminalBackfill"/.test(overviewBlock) &&
  /json_build_object/.test(overviewBlock),
  "B3: inflightBackfill + latestTerminalBackfill JSON subqueries present"
);

assert(
  /webhookStaleness:\s*\{\s*[\s\S]*?ageMs:\s*webhookAgeMs\s*,\s*isStale:/.test(overviewBlock) &&
  /watch:\s*\{\s*[\s\S]*?expirationAt:[\s\S]*?isExpired:[\s\S]*?expiresInMs:/.test(overviewBlock),
  "B4: derived freshness fields (webhookStaleness, watch.isExpired, watch.expiresInMs) computed server-side"
);

assert(
  /pushConfigured/.test(overviewBlock) && /isPushConfigured/.test(overviewBlock),
  "B5: pushConfigured server-wide flag included via isPushConfigured() import"
);

// ── Group C: GET /api/admin/mailbox/:id/diagnostics (single-mailbox detail) ──
console.log("\nGroup C — GET /api/admin/mailbox/:id/diagnostics (single-mailbox detail):");

assert(
  /app\.get\(\s*"\/api\/admin\/mailbox\/:id\/diagnostics"\s*,\s*requireAuth\s*,\s*requireAdmin\s*,/.test(ROUTES),
  "C1: detail route registered with requireAuth + requireAdmin"
);

const detailBlock = ROUTES.match(
  /app\.get\(\s*"\/api\/admin\/mailbox\/:id\/diagnostics"[\s\S]*?app\.post\(\s*"\/api\/admin\/mailbox\/:id\/trigger-backfill"/
)?.[0] ?? "";

assert(
  /parseInt\(\s*req\.params\.id\s*,\s*10\s*\)/.test(detailBlock) &&
  /Invalid mailbox id/.test(detailBlock) &&
  /Mailbox not found/.test(detailBlock),
  "C2: validates :id parsing AND 404s on missing mailbox"
);

assert(
  /recentBackfills/.test(detailBlock) &&
  /FROM backfill_jobs WHERE email_account_id =/.test(detailBlock) &&
  /ORDER BY id DESC LIMIT 10/.test(detailBlock),
  "C3: returns recentBackfills (last 10 jobs for this mailbox)"
);

assert(
  /storedMessageCount/.test(detailBlock) && /lastMessageAt/.test(detailBlock),
  "C4: returns storedMessageCount + lastMessageAt for the single mailbox"
);

// ── Group D: POST /api/admin/mailbox/:id/trigger-backfill ────────────────────
console.log("\nGroup D — POST /api/admin/mailbox/:id/trigger-backfill:");

assert(
  /app\.post\(\s*"\/api\/admin\/mailbox\/:id\/trigger-backfill"\s*,\s*requireAuth\s*,\s*requireAdmin\s*,/.test(ROUTES),
  "D1: trigger route registered with requireAuth + requireAdmin"
);

const triggerBlock = ROUTES.match(
  /app\.post\(\s*"\/api\/admin\/mailbox\/:id\/trigger-backfill"[\s\S]*?app\.post\(\s*"\/api\/admin\/mailbox\/:id\/force-full-resync"/
)?.[0] ?? "";

assert(
  /import\(\s*"\.\/gmail-oauth"\s*\)/.test(triggerBlock) &&
  /autoEnqueueBackfillForNewAccount\(\s*\{/.test(triggerBlock),
  "D2: delegates to canonical autoEnqueueBackfillForNewAccount helper (single source of truth with OAuth path)"
);

assert(
  /req\.query\.force/.test(triggerBlock) &&
  /skipIdempotencyCheck:\s*force/.test(triggerBlock),
  "D3: ?force=true query param maps to skipIdempotencyCheck (admin override of in-flight guard)"
);

assert(
  /dateFromOverride/.test(triggerBlock) &&
  /dateToOverride/.test(triggerBlock) &&
  /\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\//.test(triggerBlock),
  "D4: accepts body.dateFrom/dateTo overrides AND validates YYYY-MM-DD format"
);

assert(
  /isConflict\s*=\s*\(?result\.reason[\s\S]*?in-flight job already exists/.test(triggerBlock) &&
  /res[\s\S]*?\.status\(\s*isConflict\s*\?\s*409\s*:\s*500\s*\)/.test(triggerBlock) &&
  /Not enqueued/.test(triggerBlock),
  "D5: returns 409 ONLY for in-flight conflict (admin can override with ?force=true), 500 for actual enqueue/DB failure (architect-fixed signal-blurring)"
);

// ── Group E: POST /api/admin/mailbox/:id/force-full-resync ───────────────────
console.log("\nGroup E — POST /api/admin/mailbox/:id/force-full-resync:");

assert(
  /app\.post\(\s*"\/api\/admin\/mailbox\/:id\/force-full-resync"\s*,\s*requireAuth\s*,\s*requireAdmin\s*,/.test(ROUTES),
  "E1: force-full-resync route registered with requireAuth + requireAdmin"
);

const resyncBlock = ROUTES.match(
  /app\.post\(\s*"\/api\/admin\/mailbox\/:id\/force-full-resync"[\s\S]*?app\.put\(\s*"\/api\/admin\/users\/:id"/
)?.[0] ?? "";

assert(
  /UPDATE email_accounts[\s\S]*?SET last_history_id = NULL/.test(resyncBlock),
  "E2: clears last_history_id (forces SEED branch on next syncIncremental call)"
);

assert(
  /sync_error_message = NULL/.test(resyncBlock),
  "E3: also clears sync_error_message (operator-assumed clean slate)"
);

assert(
  /import\(\s*"\.\/services\/gmail-incremental"\s*\)/.test(resyncBlock) &&
  /syncIncremental\(\s*Number\(\s*acct\.id\s*\)\s*\)/.test(resyncBlock) &&
  /\.catch\(/.test(resyncBlock),
  "E4: fires syncIncremental(accountId) async (fire-and-forget with error catch)"
);

assert(
  /req\.query\.withBackfill/.test(resyncBlock) &&
  /autoEnqueueBackfillForNewAccount/.test(resyncBlock),
  "E5: ?withBackfill=true ALSO enqueues a 1-year backfill via canonical helper"
);

assert(
  /clearedHistoryId:\s*true/.test(resyncBlock) &&
  /reseedScheduled:\s*true/.test(resyncBlock),
  "E6: response shape includes clearedHistoryId + reseedScheduled flags"
);

// ── Group F: cluster header + structural integrity ───────────────────────────
console.log("\nGroup F — structural integrity:");

assert(
  /Commit 8 — Admin diagnostic \+ recovery endpoints/.test(ROUTES),
  "F1: Commit 8 cluster header comment present (operator-readable provenance)"
);

assert(
  !/app\.get\(\s*"\/api\/admin\/mailbox\/diagnostics"[\s\S]*?app\.get\(\s*"\/api\/admin\/mailbox\/diagnostics"/.test(ROUTES),
  "F2: no duplicate registration of /api/admin/mailbox/diagnostics"
);

assert(
  !/app\.get\(\s*"\/api\/admin\/mailbox\/:id\/diagnostics"[\s\S]*?app\.get\(\s*"\/api\/admin\/mailbox\/:id\/diagnostics"/.test(ROUTES),
  "F3: no duplicate registration of /api/admin/mailbox/:id/diagnostics"
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
