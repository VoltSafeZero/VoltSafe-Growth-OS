/**
 * Regression suite: canonical mailbox health service + orphaned account audit.
 *
 * Uses source-grep pattern to verify production code structure, plus live-DB
 * checks to confirm indexes exist and orphaned account 91 is detected.
 *
 * Run: node tests/mailbox-health.test.cjs
 * Exit 0 = all pass, exit 1 = at least one failure.
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const { execSync } = require("child_process");

let pass = 0;
let fail = 0;

function ok(name, bool) {
  if (bool) { pass++; console.log("  ✓", name); }
  else       { fail++; console.error("  ✗", name); }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function readFile(rel) {
  return fs.readFileSync(path.resolve(__dirname, "..", rel), "utf8");
}

function runSQL(query) {
  // Write to a temp file so psql doesn't choke on embedded newlines.
  const tmp = `/tmp/mh_test_${Date.now()}.sql`;
  fs.writeFileSync(tmp, query);
  try {
    const raw = execSync(
      `psql "$DATABASE_URL" -t -A -f ${tmp}`,
      { encoding: "utf8", timeout: 15_000 }
    ).trim();
    return raw;
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

// ── 1. mailbox-health.ts structure ──────────────────────────────────────────
console.log("\n[1] mailbox-health.ts — canonical service structure");

const healthSrc = readFile("server/services/mailbox-health.ts");

ok("exports computeMailboxHealth function",
  /export function computeMailboxHealth/.test(healthSrc));

ok("exports MailboxHealthStatus type",
  /export type MailboxHealthStatus/.test(healthSrc));

ok("exports MailboxHealthResult type (type alias or interface)",
  /export (type|interface) MailboxHealthResult/.test(healthSrc));

ok("exports MailboxHealthDot type",
  /export type MailboxHealthDot/.test(healthSrc));

ok("exports healthStatusToDot utility",
  /export function healthStatusToDot/.test(healthSrc));

ok("Disabled branch present — is_active=false OR sync_enabled=false",
  /Disabled/.test(healthSrc) && /isActive/.test(healthSrc) && /syncEnabled/.test(healthSrc));

ok("OAuthReconnectRequired branch present",
  /OAuthReconnectRequired/.test(healthSrc));

ok("ReconciliationRequired branch — watch expired 7+ days",
  /ReconciliationRequired/.test(healthSrc) && /7/.test(healthSrc));

ok("SyncDelayed branch present",
  /SyncDelayed/.test(healthSrc));

ok("Healthy is the final catch-all",
  /return.*Healthy.*green.*Syncing normally/.test(healthSrc.replace(/\n/g, " ")));

ok("dot values are green/amber/red only",
  /\"green\".*\"amber\".*\"red\"/.test(healthSrc));

ok("pure function — no db import",
  !/from.*db/.test(healthSrc) && !/import.*db/.test(healthSrc));

// ── 2. routes.ts — health endpoint uses canonical service ────────────────────
console.log("\n[2] routes.ts — health endpoint wired to computeMailboxHealth");

const routesSrc = readFile("server/routes.ts");

// Find the health endpoint section (between the function start and the res.json)
const healthEndpointSection = (() => {
  const start = routesSrc.indexOf("app.get(\"/api/gmail/accounts/health\"");
  const end   = routesSrc.indexOf("res.json(annotated)", start);
  return start !== -1 && end !== -1 ? routesSrc.slice(start, end + 100) : "";
})();

ok("health endpoint found",
  healthEndpointSection.length > 0);

ok("imports computeMailboxHealth inside health handler",
  healthEndpointSection.includes("computeMailboxHealth") &&
  healthEndpointSection.includes("./services/mailbox-health"));

ok("returns healthStatus field (semantic name)",
  healthEndpointSection.includes("healthStatus:"));

ok("returns healthReason field",
  healthEndpointSection.includes("healthReason:"));

ok("status field uses healthResult.dot",
  healthEndpointSection.includes("healthResult.dot"));

// ── 3. routes.ts — reconcile + orphaned routes present ──────────────────────
console.log("\n[3] routes.ts — new admin routes");

ok("POST /api/admin/mailbox/:id/reconcile present",
  routesSrc.includes("/api/admin/mailbox/:id/reconcile"));

ok("reconcile route uses reconcileFullMailbox",
  routesSrc.includes("reconcileFullMailbox"));

ok("GET /api/admin/mailbox/orphaned-messages present",
  routesSrc.includes("/api/admin/mailbox/orphaned-messages"));

ok("orphaned route uses NOT EXISTS subquery",
  routesSrc.includes("NOT EXISTS") && routesSrc.includes("source_account_id"));

// ── 4. mailbox-reconcile.ts structure ───────────────────────────────────────
console.log("\n[4] mailbox-reconcile.ts — full reconciliation service");

const reconcileSrc = readFile("server/services/mailbox-reconcile.ts");

ok("exports reconcileFullMailbox",
  /export async function reconcileFullMailbox/.test(reconcileSrc));

ok("exports getGmailMessageCount",
  /export async function getGmailMessageCount/.test(reconcileSrc));

ok("uses in:anywhere scope in the query string (not scoped to inbox only)",
  // q = `in:anywhere...` must appear as an actual value, not just a comment reference.
  /const q = `in:anywhere/.test(reconcileSrc) || /q = "in:anywhere/.test(reconcileSrc));

ok("excludes spam and trash by default",
  reconcileSrc.includes("-in:spam") && reconcileSrc.includes("-in:trash"));

ok("refuses to run for non-active auth_status",
  reconcileSrc.includes("auth_status !== \"active\"") ||
  reconcileSrc.includes("auth_status !==") );

ok("uses same upsertMessageById pipeline as all other sync paths",
  reconcileSrc.includes("upsertMessageById"));

ok("rate-limited with p-limit CONCURRENCY=5",
  reconcileSrc.includes("pLimit") && reconcileSrc.includes("CONCURRENCY = 5"));

ok("respects maxMessages cap",
  reconcileSrc.includes("maxMessages") && reconcileSrc.includes("fetched >= maxMessages"));

// ── 5. migration file ────────────────────────────────────────────────────────
console.log("\n[5] migrations/0031_search_indexes.sql");

const migSrc = readFile("migrations/0031_search_indexes.sql");

ok("idx_email_cc_emails_trgm present",
  migSrc.includes("idx_email_cc_emails_trgm"));

ok("idx_email_all_participants_trgm present",
  migSrc.includes("idx_email_all_participants_trgm"));

ok("idx_email_fts_v3 present",
  migSrc.includes("idx_email_fts_v3"));

ok("uses IF NOT EXISTS (idempotent)",
  migSrc.includes("IF NOT EXISTS"));

ok("includes cc_emails in tsvector",
  migSrc.includes("cc_emails"));

// ── 6. Live DB — indexes actually exist ──────────────────────────────────────
console.log("\n[6] Live DB — indexes confirmed present");

function checkIndex(name) {
  try {
    const q = `SELECT count(*)::int FROM pg_indexes WHERE tablename='email_messages' AND indexname='${name}'`;
    const out = execSync(`psql "$DATABASE_URL" -t -A -c "${q}"`, { encoding: "utf8", timeout: 15_000 }).trim();
    return parseInt(out, 10) > 0;
  } catch {
    return false;
  }
}

ok("idx_email_cc_emails_trgm in pg_indexes",      checkIndex("idx_email_cc_emails_trgm"));
ok("idx_email_all_participants_trgm in pg_indexes", checkIndex("idx_email_all_participants_trgm"));
ok("idx_email_fts_v3 in pg_indexes",               checkIndex("idx_email_fts_v3"));

// ── 7. Live DB — orphaned account 91 detection ───────────────────────────────
console.log("\n[7] Live DB — orphaned account detection");

try {
  const orphanCount = (() => {
    const q = "SELECT count(*)::int FROM email_messages m WHERE NOT EXISTS (SELECT 1 FROM email_accounts a WHERE a.id = m.source_account_id)";
    const out = execSync(`psql "$DATABASE_URL" -t -A -c "${q}"`, { encoding: "utf8", timeout: 15_000 }).trim();
    return parseInt(out, 10);
  })();

  const acct91Count = (() => {
    const q = "SELECT count(*)::int FROM email_messages WHERE source_account_id = 91";
    const out = execSync(`psql "$DATABASE_URL" -t -A -c "${q}"`, { encoding: "utf8", timeout: 15_000 }).trim();
    return parseInt(out, 10);
  })();

  ok("orphaned messages detected by NOT EXISTS query (> 0 rows)",
    orphanCount > 0);

  ok("orphaned account 91 has > 1000 messages",
    acct91Count > 1000);
} catch (e) {
  console.error("Orphan check failed:", e.message);
  fail += 2;
}

// ── 8. mailbox-integrity.ts uses last_incremental_sync_at ───────────────────
console.log("\n[8] mailbox-integrity.ts — sync timestamp accuracy");

const integritySrc = readFile("server/services/mailbox-integrity.ts");

ok("imports computeMailboxHealth from ./mailbox-health",
  integritySrc.includes("computeMailboxHealth") && integritySrc.includes("./mailbox-health"));

ok("uses ea.last_incremental_sync_at (not ea.updated_at) for sync time",
  integritySrc.includes("last_incremental_sync_at") &&
  !integritySrc.includes("ea.updated_at"));

ok("MailboxAuditEntry includes canonicalHealth field",
  integritySrc.includes("canonicalHealth"));

// ── 9. Q_BASE preserved in scroll backfill ───────────────────────────────────
console.log("\n[9] gmail-history-backfill.ts — scroll backfill scope unchanged");

const backfillSrc = readFile("server/services/gmail-history-backfill.ts");

ok("scroll backfill still uses in:inbox OR in:sent for inbox-scoped scrolling",
  backfillSrc.includes("in:inbox OR in:sent"));

ok("Q_BASE constant is present and scoped to inbox+sent",
  /const Q_BASE = "in:inbox OR in:sent"/.test(backfillSrc));

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Total: ${pass + fail} | Pass: ${pass} | Fail: ${fail}`);
console.log("─".repeat(50));

if (fail > 0) {
  console.error(`\n${fail} check(s) failed.\n`);
  process.exit(1);
}
console.log("\nAll checks passed.\n");
process.exit(0);
