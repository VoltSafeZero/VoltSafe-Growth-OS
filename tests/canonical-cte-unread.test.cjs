/**
 * tests/canonical-cte-unread.test.cjs
 *
 * Regression suite for the local-mailbox query structure.
 *
 * Key architectural facts verified here:
 *
 *   1. listLocalMessages() uses a FLAT SELECT from email_messages — no
 *      DISTINCT ON CTE.  is_unread and is_starred are used directly in the
 *      WHERE clause against the base table, so they are always visible.
 *
 *   2. listLocalThreads() uses a DISTINCT ON subquery where the WHERE clause
 *      (containing is_unread / is_starred / is_inbox predicates) is applied
 *      INSIDE the subquery against email_messages.  The outer query only
 *      references sent_at and id (the cursor), both of which are projected.
 *
 *   3. The inbox-debug thread-count CTE uses WITH MATERIALIZED to ensure a
 *      single consistent snapshot, preventing the bucket sum from drifting
 *      from inbox_unread_threads.
 *
 *   4. All four derived columns (is_inbox, is_unread, is_starred,
 *      smart_category) exist on the email_messages table.
 *
 *   5. Live endpoints return HTTP 200 for every query variant that exercises
 *      is_unread — no "column does not exist" errors.
 *
 * Part A — static source checks (no server required).
 * Part B — live API checks (server must be running).
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const http = require("http");

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

// ── Load source ──────────────────────────────────────────────────────────────

const MAILBOX = path.join(__dirname, "../server/services/local-mailbox.ts");
const ROUTES  = path.join(__dirname, "../server/routes.ts");

const mailbox = fs.readFileSync(MAILBOX, "utf8");
const routes  = fs.readFileSync(ROUTES,  "utf8");

// ── Part A: source-grep ──────────────────────────────────────────────────────

console.log("\n── A1. listLocalMessages — flat SELECT, no outer CTE ──");

// listLocalMessages uses buildQClauses which pushes `is_unread = true` and
// `is_starred = true` directly into WHERE.  The query reads from email_messages
// directly, so these columns are always accessible.
assert(
  mailbox.includes("is_unread = true") && mailbox.includes("is_starred = true"),
  "buildQClauses pushes is_unread = true and is_starred = true predicates"
);
assert(
  mailbox.includes("FROM email_messages"),
  "listLocalMessages queries email_messages directly (flat SELECT)"
);

// Verify the listLocalMessages SELECT list does NOT require is_unread in the
// projection (it uses it only in WHERE, never in the outer SELECT columns).
const listMsgBlock = (() => {
  const idx = mailbox.indexOf("export async function listLocalMessages(");
  return idx !== -1 ? mailbox.slice(idx, idx + 10000) : "";
})();
assert(
  listMsgBlock.includes("FROM email_messages") &&
  !listMsgBlock.includes("WITH canonical") &&
  !listMsgBlock.includes("WITH dedup"),
  "listLocalMessages has no CTE — flat SELECT from email_messages"
);

console.log("\n── A2. listLocalThreads — DISTINCT ON subquery structure ──");

const listThreadsBlock = (() => {
  const idx = mailbox.indexOf("DISTINCT ON (gmail_thread_id)");
  return idx !== -1 ? mailbox.slice(Math.max(0, idx - 200), idx + 500) : "";
})();
assert(
  listThreadsBlock.includes("DISTINCT ON (gmail_thread_id)"),
  "listLocalThreads contains DISTINCT ON (gmail_thread_id)"
);
// The WHERE clause (with is_unread / is_inbox predicates) is applied inside
// the subquery against the base table.
assert(
  listThreadsBlock.indexOf("${whereSql}") < listThreadsBlock.indexOf("ORDER BY gmail_thread_id"),
  "whereSql is inside the DISTINCT ON subquery (before its ORDER BY)"
);
// The outer query only needs sent_at and id — both are in the inner projection.
assert(
  listThreadsBlock.includes("gmail_thread_id AS id, snippet, sent_at"),
  "inner DISTINCT ON projects id (gmail_thread_id), snippet, sent_at — the cursor columns"
);
// Outer cursor clause uses only sent_at and id
assert(
  mailbox.includes("AND (sent_at IS NULL AND id < ") &&
  mailbox.includes("AND (sent_at, id) < ("),
  "outer cursor clause only references sent_at and id (both projected)"
);

console.log("\n── A3. inbox-debug MATERIALIZED CTE ──");

const debugIdx = routes.indexOf('"/api/gmail/inbox-debug"');
const debugBlock = debugIdx !== -1 ? routes.slice(debugIdx, debugIdx + 14000) : "";
assert(
  debugBlock.includes("WITH thread_canonical AS MATERIALIZED"),
  "inbox-debug uses WITH ... AS MATERIALIZED to guarantee single consistent snapshot"
);
assert(
  debugBlock.includes("SELECT DISTINCT ON (gmail_thread_id)"),
  "thread_canonical CTE uses DISTINCT ON (gmail_thread_id)"
);
// The thread count SELECT from thread_canonical is in its own subquery
assert(
  debugBlock.includes("COUNT(*)::int                                                            AS inbox_unread_threads") ||
  debugBlock.includes("COUNT(*)::int") && debugBlock.includes("AS inbox_unread_threads"),
  "thread count CTE computes inbox_unread_threads via COUNT(*)"
);
assert(
  debugBlock.includes("COUNT(*) FILTER (WHERE smart_category = 'people')::int") &&
  debugBlock.includes("AS people_unread_threads"),
  "CTE bucket counts use COUNT(*) FILTER per smart_category"
);
// ok formula includes thread reconciliation invariant
const okIdx = debugBlock.indexOf("ok:");
const okSnippet = okIdx !== -1 ? debugBlock.slice(okIdx, okIdx + 300) : "";
assert(
  okSnippet.includes("inbox_unread_threads") &&
  okSnippet.includes("people_unread_threads") &&
  okSnippet.includes("promotions_unread_threads"),
  "ok formula includes thread reconciliation invariant"
);

console.log("\n── A4. Derived column usage — Phase 3 patterns ──");

assert(
  mailbox.includes("is_inbox = true") && mailbox.includes("is_unread = true") &&
  mailbox.includes("is_starred = true"),
  "local-mailbox.ts uses all three Phase-3 derived column predicates"
);
assert(
  !mailbox.includes("label_ids ILIKE '%\"UNREAD\"%'") &&
  !mailbox.includes("label_ids ILIKE '%UNREAD%'"),
  "is:unread no longer uses label_ids ILIKE pattern (Phase 3 migration complete)"
);
assert(
  !mailbox.includes("label_ids ILIKE '%\"STARRED\"%'") &&
  !mailbox.includes("label_ids ILIKE '%STARRED%'"),
  "is:starred no longer uses label_ids ILIKE pattern (Phase 3 migration complete)"
);

// ── Part B: live API ─────────────────────────────────────────────────────────

console.log("\n── B1. Live API — is:unread returns 200 for all mailboxes ──");

function apiFetch(p, opts = {}) {
  return new Promise((resolve, reject) => {
    const { method = "GET", body, cookie } = opts;
    const bs = body ? JSON.stringify(body) : null;
    const options = {
      hostname: "localhost", port: 5000, path: p, method,
      headers: {
        "Content-Type": "application/json",
        "Origin": "http://localhost:5000",
        ...(bs ? { "Content-Length": Buffer.byteLength(bs) } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
    };
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers }); }
        catch { resolve({ status: res.statusCode, body: data, headers: res.headers }); }
      });
    });
    req.on("error", reject);
    if (bs) req.write(bs);
    req.end();
  });
}

async function runLiveTests() {
  const loginRes = await apiFetch("/api/auth/login", {
    method: "POST",
    body: { email: "trevor@voltsafe.com", password: "alberni1444" },
  });
  const cookie = loginRes.headers["set-cookie"]?.[0]?.split(";")[0];
  assert(loginRes.status === 200, `[auth] login 200 (got ${loginRes.status})`);
  if (loginRes.status !== 200) { console.error("  cannot continue live tests without login"); return; }

  // Get accounts
  const acctRes = await apiFetch("/api/gmail/accounts", { cookie });
  const accounts = Array.isArray(acctRes.body) ? acctRes.body : [];
  assert(accounts.length > 0, `at least one Gmail account returned (got ${accounts.length})`);

  const queries = [
    { q: "in:inbox",               label: "in:inbox" },
    { q: "in:inbox is:unread",     label: "in:inbox is:unread" },
    { q: "in:people is:unread",    label: "in:people is:unread" },
    { q: "in:newsletters is:unread", label: "in:newsletters is:unread" },
    { q: "in:notifications is:unread", label: "in:notifications is:unread" },
  ];

  for (const acct of accounts.slice(0, 5)) {
    for (const { q, label } of queries) {
      const url = `/api/gmail/messages?q=${encodeURIComponent(q)}&asAccountId=${acct.id}`;
      const r = await apiFetch(url, { cookie });
      const msgs = r.body?.messages ?? [];
      const hasColErr = typeof r.body === "string" && r.body.includes("does not exist");
      const hasLocalErr = r.body?.error?.includes?.("Local mailbox query failed") ||
                         (typeof r.body === "string" && r.body.includes("Local mailbox query failed"));
      assert(
        r.status === 200,
        `[${acct.emailAddress}] ${label} → 200 (got ${r.status}${hasColErr ? " — column does not exist" : ""})`
      );
      assert(
        !hasColErr,
        `[${acct.emailAddress}] ${label} — no "column does not exist" error`
      );
      assert(
        !hasLocalErr,
        `[${acct.emailAddress}] ${label} — no "Local mailbox query failed" error`
      );
    }
  }

  // Verify inbox-debug thread reconciliation is exact (MATERIALIZED CTE)
  console.log("\n── B2. inbox-debug thread reconciliation exact ──");
  const debugRes = await apiFetch("/api/gmail/inbox-debug?asAccountId=all", { cookie });
  assert(debugRes.status === 200, `GET /api/gmail/inbox-debug returns 200 (got ${debugRes.status})`);
  if (debugRes.status === 200) {
    const d = debugRes.body;
    const t = d.threads ?? {};
    const bucketSum = (t.people ?? 0) + (t.updates ?? 0) + (t.promotions ?? 0) +
                      (t.social ?? 0) + (t.forums ?? 0);
    const threadDelta = (t.inbox_unread ?? -1) - bucketSum;
    console.log(`  thread counts: inbox=${t.inbox_unread} people=${t.people} updates=${t.updates} promotions=${t.promotions} social=${t.social} forums=${t.forums} sum=${bucketSum} delta=${threadDelta}`);
    assert(
      threadDelta === 0,
      `thread_bucket_sum === inbox_unread_threads (delta=${threadDelta}; MATERIALIZED CTE ensures single snapshot)`
    );
    assert(
      d.ok === true,
      `endpoint ok=true (msg delta=${d.messages?.delta}, thread delta=${threadDelta})`
    );
  }
}

runLiveTests()
  .catch(err => { console.error("  live test error:", err.message); failed++; })
  .finally(() => {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
    if (failed > 0) {
      console.error(`\n${failed} test(s) failed.`);
      process.exit(1);
    } else {
      console.log("\nAll tests passed.");
    }
  });
