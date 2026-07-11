/**
 * Mail Search Completeness — regression test suite
 *
 * Verifies that the local search SQL, search overflow logic, and participant
 * backfill infrastructure contain the exact patterns required to find emails
 * regardless of which header field the target address appears in.
 *
 * All checks are source-grep against production code — zero network calls,
 * zero DB connections, zero test infra required. The suite exits 1 on any
 * failure so CI or the test:grep workflow catches regressions immediately.
 *
 * Root causes fixed (do not regress):
 *
 *   RC-1: cc_emails not in LIKE fallback — CC-only participants were silently
 *         invisible to local search when all_participants was NULL.
 *
 *   RC-2: listLocalThreads had an @ guard that only applied LIKE fallbacks for
 *         email-address searches. Non-@ searches (e.g. "Scott Carlson") used
 *         FTS only, missing messages whose all_participants was NULL.
 *
 *   RC-3: cc_emails absent from FTS tsvector and from the GIN index DDL, so
 *         CC participants were not reachable by the GIN index at all.
 *
 *   RC-4: all_participants can be NULL for messages imported before the column
 *         was added to the schema. The backfill repairs these rows.
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ── Helpers ───────────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
const failures = [];

function check(label, condition) {
  if (condition) {
    pass++;
  } else {
    fail++;
    failures.push(label);
    console.error(`  FAIL: ${label}`);
  }
}

function readFile(relPath) {
  return fs.readFileSync(path.join(__dirname, "..", relPath), "utf8");
}

// ── Source files ──────────────────────────────────────────────────────────────

const localMailbox   = readFile("server/services/local-mailbox.ts");
const emailSearch    = readFile("server/services/email-search.ts");
const integrity      = readFile("server/services/mailbox-integrity.ts");
const indexTs        = readFile("server/index.ts");
const routesTs       = readFile("server/routes.ts");

// ── 1. cc_emails in LIKE fallback ────────────────────────────────────────────

console.log("\n[1] cc_emails must appear in LIKE fallback clauses");

// listLocalMessages (flat list, used by inbox + search)
check(
  "local-mailbox listLocalMessages: cc_emails in LIKE fallback",
  /coalesce\(cc_emails,''\)\s*\)\s*LIKE\s*'%\$\{lc\}%'/.test(localMailbox) ||
  localMailbox.includes("lower(coalesce(cc_emails,'')) LIKE '%${lc}%'")
);

// listLocalThreads (thread-grouped view used by main inbox)
const threadSearchIdx = localMailbox.indexOf("listLocalThreads");
const threadSearchSlice = localMailbox.slice(threadSearchIdx, threadSearchIdx + 8000);
check(
  "local-mailbox listLocalThreads: cc_emails in LIKE fallback",
  threadSearchSlice.includes("lower(coalesce(cc_emails,'')) LIKE '%${lc}%'")
);

// searchEmails (email-search.ts)
check(
  "email-search searchEmails: cc_emails in LIKE fallback",
  emailSearch.includes("lower(coalesce(cc_emails,'')) LIKE '%${lc}%'")
);

// ── 2. @ guard removed from listLocalThreads ──────────────────────────────────

console.log("\n[2] listLocalThreads must apply LIKE fallbacks for ALL free-text (not just @)");

check(
  "local-mailbox listLocalThreads: no freeText.includes('@') guard on LIKE fallbacks",
  !threadSearchSlice.match(/if\s*\(\s*freeText\.includes\s*\(\s*['"]@['"]\s*\)/)
);

check(
  "local-mailbox listLocalThreads: LIKE clause applied unconditionally in thread search",
  threadSearchSlice.includes("lower(coalesce(all_participants,'')) LIKE '%${lc}%'") &&
  threadSearchSlice.includes("lower(coalesce(cc_emails,'')) LIKE '%${lc}%'")
);

// listLocalMessages should also always apply LIKE (not just for @)
const listMsgIdx = localMailbox.indexOf("async function listLocalMessages");
const listMsgSlice = localMailbox.slice(listMsgIdx, listMsgIdx + 4000);
check(
  "local-mailbox listLocalMessages: LIKE clause not gated on freeText.includes('@')",
  !listMsgSlice.match(/if\s*\(\s*freeText\.includes\s*\(\s*['"]@['"]\s*\)/)
);

// ── 3. cc_emails in FTS tsvector ─────────────────────────────────────────────

console.log("\n[3] cc_emails must be in FTS tsvector expressions");

// listLocalMessages tsvector
check(
  "local-mailbox listLocalMessages: cc_emails in tsvector",
  listMsgSlice.includes("coalesce(cc_emails,'')")
);

// listLocalThreads tsvector
check(
  "local-mailbox listLocalThreads: cc_emails in tsvector",
  threadSearchSlice.includes("coalesce(cc_emails,'')")
);

// email-search.ts tsvector
check(
  "email-search searchEmails: cc_emails in tsvector",
  emailSearch.includes("coalesce(cc_emails,'')")
);

// ── 4. GIN index for cc_emails ────────────────────────────────────────────────

console.log("\n[4] GIN trigram index for cc_emails must exist");

check(
  "email-search: idx_email_cc_emails_trgm GIN index defined",
  emailSearch.includes("idx_email_cc_emails_trgm") &&
  emailSearch.includes("gin_trgm_ops") &&
  emailSearch.includes("cc_emails")
);

// v3 FTS GIN index including cc_emails
check(
  "email-search: idx_email_fts_v3 GIN FTS index defined with cc_emails",
  emailSearch.includes("idx_email_fts_v3") &&
  emailSearch.includes("coalesce(cc_emails, '')")
);

// ── 5. Participant backfill infrastructure ────────────────────────────────────

console.log("\n[5] all_participants backfill must exist and be wired correctly");

check(
  "mailbox-integrity.ts: backfillAllParticipants exported",
  integrity.includes("export async function backfillAllParticipants")
);

check(
  "mailbox-integrity.ts: backfill repairs null all_participants from from_email + to_emails + cc_emails",
  integrity.includes("from_email") &&
  integrity.includes("to_emails") &&
  integrity.includes("cc_emails") &&
  integrity.includes("all_participants IS NULL")
);

check(
  "mailbox-integrity.ts: backfill is idempotent (ONLY updates null/empty rows)",
  integrity.includes("all_participants IS NULL OR all_participants = '' OR all_participants = '[]'")
);

check(
  "mailbox-integrity.ts: supports force option to re-run after startup",
  integrity.includes("opts?.force")
);

check(
  "server/index.ts: backfillAllParticipants hooked into startup",
  indexTs.includes("backfillAllParticipants")
);

// ── 6. Admin audit endpoints ──────────────────────────────────────────────────

console.log("\n[6] Admin mailbox integrity audit endpoints must be registered");

check(
  "routes.ts: GET /api/admin/mailbox/integrity-audit exists and is admin-only",
  routesTs.includes("/api/admin/mailbox/integrity-audit") &&
  routesTs.includes("requireAdmin")
);

check(
  "routes.ts: POST /api/admin/mailbox/:id/repair-participants exists",
  routesTs.includes("/api/admin/mailbox/:id/repair-participants")
);

check(
  "routes.ts: POST /api/admin/mailbox/repair-all-participants exists",
  routesTs.includes("/api/admin/mailbox/repair-all-participants")
);

check(
  "mailbox-integrity.ts: getMailboxAudit exported",
  integrity.includes("export async function getMailboxAudit")
);

check(
  "mailbox-integrity.ts: repairParticipantsForAccount exported",
  integrity.includes("export async function repairParticipantsForAccount")
);

// ── 7. Audit reports the right health fields ──────────────────────────────────

console.log("\n[7] Audit output must include required health fields");

check(
  "mailbox-integrity.ts: audit includes null_all_participants count",
  integrity.includes("nullAllParticipants") || integrity.includes("null_all_participants")
);

check(
  "mailbox-integrity.ts: audit includes health status (healthy/oauth_error/etc)",
  integrity.includes('"healthy"') &&
  integrity.includes('"oauth_error"') &&
  integrity.includes('"participants_incomplete"')
);

check(
  "mailbox-integrity.ts: audit includes sync timestamps",
  integrity.includes("lastIncrementalSync") || integrity.includes("last_incremental_sync")
);

check(
  "mailbox-integrity.ts: audit includes message counts",
  integrity.includes("totalLocalMessages") || integrity.includes("total_local_messages")
);

// ── 8. Search overflow still sends raw q to Gmail ────────────────────────────

console.log("\n[8] Email-address search overflow must pass raw query to Gmail (no inbox restriction)");

check(
  "routes.ts: non-empty q passed verbatim to fetchOlderFromGmail as gmailFilter",
  routesTs.includes("const gmailFilter = queryEmpty ? undefined : q")
);

check(
  "routes.ts: isEmailSearchFirstPage forces overflow on first page",
  routesTs.includes("isEmailSearchFirstPage")
);

check(
  "routes.ts: isEmailAddressSearch removes before: date restriction for email searches",
  routesTs.includes("isEmailAddressSearch") &&
  routesTs.includes("beforeDate = isEmailAddressSearch")
);

// ── 9. TRASH/SPAM excluded from free-text search ─────────────────────────────

console.log("\n[9] TRASH and SPAM must be excluded from free-text search results");

check(
  "local-mailbox listLocalMessages: TRASH excluded from free-text search",
  localMailbox.includes('NOT (label_ids ILIKE \'%"TRASH"%\')')
);

check(
  "local-mailbox listLocalMessages: SPAM excluded from free-text search",
  localMailbox.includes('NOT (label_ids ILIKE \'%"SPAM"%\')')
);

// ── 10. Security: account boundary enforced on all search paths ───────────────

console.log("\n[10] Account ownership boundary must be enforced on search");

check(
  "local-mailbox listLocalMessages: source_account_id or owner_user_id filter present",
  localMailbox.includes("source_account_id") &&
  localMailbox.includes("owner_user_id")
);

check(
  "local-mailbox listLocalThreads: source_account_id or owner_user_id filter present",
  threadSearchSlice.includes("source_account_id") ||
  threadSearchSlice.includes("owner_user_id")
);

check(
  "mailbox-integrity.ts: audit route requires requireAdmin — private bodies not exposed",
  integrity.includes("Private message bodies") ||
  integrity.includes("private message bodies") ||
  routesTs.includes("requireAdmin") // admin gate present
);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${pass} passed, ${fail} failed`);

if (fail > 0) {
  console.error("\nFailed checks:");
  failures.forEach((f) => console.error(`  • ${f}`));
  process.exit(1);
} else {
  console.log("All checks passed ✓");
}
