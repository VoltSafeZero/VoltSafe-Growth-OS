/**
 * Scheduled-send lifecycle regression tests.
 *
 * Tests cover:
 *  S1–S5   : schema — required fields present
 *  R1–R8   : runScheduledEmailSender (gmail-sync.ts) — correct send path, no-vanish on failure
 *  P1–P4   : POST /api/gmail/schedule (routes.ts) — userId stored at creation time
 *  G1–G2   : GET /api/gmail/scheduled (routes.ts) — returns pending + failed (not just pending)
 *  U1–U5   : UI (gmail-inbox.tsx) — failed badge, failed row rendering, badge counts only pending
 *  T1–T2   : timezone — scheduledAt stored as ISO / UTC-safe
 */

const fs   = require("fs");
const path = require("path");

const SCHEMA       = fs.readFileSync(path.join(__dirname, "../shared/schema.ts"), "utf8");
const SYNC         = fs.readFileSync(path.join(__dirname, "../server/services/gmail-sync.ts"), "utf8");
const ROUTES       = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");
const INBOX        = fs.readFileSync(path.join(__dirname, "../client/src/pages/gmail-inbox.tsx"), "utf8");
const SEED         = fs.readFileSync(path.join(__dirname, "../server/seed-production.ts"), "utf8");
const INDEX        = fs.readFileSync(path.join(__dirname, "../server/index.ts"), "utf8");

let passed = 0;
let failed = 0;

function test(id, label, fn) {
  try {
    fn();
    console.log(`  ✓ ${id}: ${label}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${id}: ${label}`);
    console.log(`    → ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function has(src, pattern)  { return (pattern instanceof RegExp) ? pattern.test(src) : src.includes(pattern); }
function must(src, pattern, msg) { assert(has(src, pattern), msg); }
function mustNot(src, pattern, msg) { assert(!has(src, pattern), msg); }

// ─── S: Schema ──────────────────────────────────────────────────────────────
console.log("\n=== S1-S5: scheduled_emails schema ===\n");

test("S1", "table has userId (user_id) column", () => {
  must(SCHEMA, /scheduledEmails.*userId.*integer|userId.*integer.*scheduled/s,
    "userId integer column not found in scheduledEmails");
});

test("S2", "table has sentMessageId (sent_message_id) column", () => {
  must(SCHEMA, /sentMessageId.*text|sent_message_id.*text/,
    "sentMessageId text column not found in scheduledEmails");
});

test("S3", "table has error column for failure messages", () => {
  must(SCHEMA, /error.*text/, "error text column not found");
});

test("S4", "table has sentAt timestamp", () => {
  must(SCHEMA, /sentAt.*timestamp|sent_at.*timestamp/, "sentAt timestamp not found");
});

test("S5", "table has status column with default 'pending'", () => {
  must(SCHEMA, /status.*pending/, "status column with default 'pending' not found");
});

// ─── R: runScheduledEmailSender ──────────────────────────────────────────────
console.log("\n=== R1-R8: runScheduledEmailSender (gmail-sync.ts) ===\n");

test("R1", "sendEmail called with correct arg order: (userId, to, subject, body, threadId)", () => {
  // Must NOT call sendEmail(email.to, ...) — that was the old broken call
  mustNot(SYNC, /sendEmail\s*\(\s*email\.to\b/,
    "sendEmail is still being called with email.to as first argument (userId position) — scrambled args bug not fixed");
});

test("R2", "sendEmail receives a numeric userId (email.userId or sendUserId)", () => {
  must(SYNC, /sendEmail\s*\(\s*sendUserId\b/,
    "sendEmail must receive sendUserId as first argument");
});

test("R3", "sentMessageId captured from sendEmail return value and stored", () => {
  must(SYNC, /result\?\.id|sentMsgId/,
    "sentMessageId (result?.id) not captured from sendEmail return value");
  must(SYNC, /sentMessageId.*sentMsgId|sentMsgId.*sentMessageId/,
    "sentMessageId not written back to scheduled_emails on success");
});

test("R4", "status set to 'sent' and sentAt set on success", () => {
  must(SYNC, /status.*"sent".*sentAt|sentAt.*status.*"sent"/s,
    "success path must set status='sent' and sentAt");
});

test("R5", "status set to 'failed' and error stored on catch — email NOT deleted", () => {
  must(SYNC, /status.*"failed".*error|error.*status.*"failed"/s,
    "failure path must set status='failed' with error message");
  // Extract the runScheduledEmailSender function body and verify it has no db.delete call.
  const fnStart = SYNC.indexOf("async function runScheduledEmailSender");
  const fnEnd   = SYNC.indexOf("\nasync function ", fnStart + 1);
  const fnBody  = fnEnd > fnStart ? SYNC.slice(fnStart, fnEnd) : SYNC.slice(fnStart, fnStart + 3000);
  mustNot(fnBody, /db\.delete/,
    "runScheduledEmailSender must NOT call db.delete — failure must mark status='failed', not delete the row");
  must(fnBody, /db\.update/,
    "runScheduledEmailSender must call db.update in the catch path to persist the failure");
});

test("R6", "fallback: if email.userId is null, query master_admin", () => {
  must(SYNC, /master_admin/,
    "scheduler must fall back to master_admin userId when email.userId is null");
});

test("R7", "if no userId can be resolved, email is marked failed (not silently dropped)", () => {
  must(SYNC, /No userId on scheduled email/,
    "must log/mark-failed when no userId can be resolved");
});

test("R8", "post-send incremental sync triggered after successful send", () => {
  must(SYNC, /runIncrementalForAll/,
    "runIncrementalForAll must be called after a successful scheduled send");
});

// ─── P: POST route — userId stored at creation time ─────────────────────────
console.log("\n=== P1-P4: POST /api/gmail/schedule (routes.ts) ===\n");

test("P1", "userId stored when inserting a new scheduled email", () => {
  must(ROUTES, /userId.*req\.session\.userId|req\.session\.userId.*userId/,
    "POST /api/gmail/schedule must store req.session.userId in the insert");
});

test("P2", "scheduledAt stored as new Date(scheduledAt) — UTC-safe conversion", () => {
  must(ROUTES, /new Date\(scheduledAt\)/,
    "scheduledAt must be converted with new Date() to ensure UTC storage");
});

test("P3", "to, body, scheduledAt validated before insert", () => {
  must(ROUTES, /!to.*!body.*!scheduledAt|to.*body.*scheduledAt.*required/,
    "POST must validate required fields before insert");
});

test("P4", "only master_admin can create scheduled emails", () => {
  must(ROUTES, /master_admin.*schedule|schedule.*master_admin/s,
    "POST /api/gmail/schedule must be gated to master_admin");
});

// ─── G: GET route — returns pending + failed ─────────────────────────────────
console.log("\n=== G1-G2: GET /api/gmail/scheduled (routes.ts) ===\n");

test("G1", "GET returns both 'pending' and 'failed' rows (not pending-only)", () => {
  must(ROUTES, /inArray.*scheduledEmails\.status.*pending.*failed|failed.*pending.*scheduledEmails/s,
    "GET /api/gmail/scheduled must return pending AND failed rows so failures are visible");
});

test("G2", "GET does NOT filter for only 'pending' (old silent-disappear query removed)", () => {
  // The old query was: .where(eq(scheduledEmails.status, "pending"))
  // It must now be an inArray call, not a bare eq check
  const oldQuery = /\.where\s*\(\s*eq\s*\(\s*scheduledEmails\.status\s*,\s*["']pending["']\s*\)\s*\)/;
  const schedSection = ROUTES.slice(ROUTES.indexOf("/api/gmail/scheduled"), ROUTES.indexOf("/api/gmail/scheduled") + 600);
  mustNot(schedSection, oldQuery,
    "GET still uses eq(status, 'pending') — old query not replaced with inArray");
});

// ─── U: UI — Scheduled tab ───────────────────────────────────────────────────
console.log("\n=== U1-U5: gmail-inbox.tsx scheduled tab ===\n");

test("U1", "ScheduledEmail type includes status field", () => {
  must(INBOX, /type ScheduledEmail.*status.*string|status.*string.*ScheduledEmail/s,
    "ScheduledEmail type must include status: string");
});

test("U2", "ScheduledEmail type includes error field", () => {
  must(INBOX, /type ScheduledEmail.*error.*string.*null|error.*null.*ScheduledEmail/s,
    "ScheduledEmail type must include error: string | null");
});

test("U3", "failed emails shown with 'Failed' badge in UI", () => {
  must(INBOX, /isFailed.*Failed|Failed.*isFailed/s,
    "UI must render a 'Failed' badge for failed scheduled emails");
});

test("U4", "badge count on nav tab only counts pending emails (not total)", () => {
  must(INBOX, /filter.*status.*===.*["']pending["'].*\.length/,
    "Badge count must filter for status === 'pending' only, not all scheduled emails");
});

test("U5", "failed emails show error message in UI", () => {
  must(INBOX, /email\.error.*Send failed|Send failed.*email\.error/,
    "failed emails must display email.error message (fallback 'Send failed')");
});

// ─── T: Timezone safety ──────────────────────────────────────────────────────
console.log("\n=== T1-T2: Timezone safety ===\n");

test("T1", "migration adds columns with IF NOT EXISTS — idempotent", () => {
  must(SEED, /ADD COLUMN IF NOT EXISTS user_id/,
    "migration must use ADD COLUMN IF NOT EXISTS for user_id");
  must(SEED, /ADD COLUMN IF NOT EXISTS sent_message_id/,
    "migration must use ADD COLUMN IF NOT EXISTS for sent_message_id");
});

test("T2", "migration registered in server/index.ts startup sequence", () => {
  must(INDEX, /migrateScheduledEmailColumns/,
    "migrateScheduledEmailColumns must be called in server/index.ts startup");
});

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log("\nAll scheduled-send lifecycle invariants verified.");
}
process.exit(failed > 0 ? 1 : 0);
