/**
 * tests/inbox-count-reconciliation.test.cjs
 *
 * Invariant tests for inbox category count integrity.
 *
 * CANONICAL UNIT: unread THREADS (COUNT DISTINCT gmail_thread_id).
 * The inbox list shows one row per thread (dedupByThread). Badges must count
 * threads so the badge number matches the visible row count.
 *
 * Part A — source-grep: structural checks (no server needed).
 *   Verifies the reconciliation endpoint is registered, gated, and returns
 *   the right shape including delta and drift fields.
 *   Also verifies category-counts uses COUNT(DISTINCT) not COUNT(*).
 *
 * Part B — live API: calls GET /api/gmail/inbox-debug and asserts:
 *   • threads.delta === 0
 *       (People + Updates + Promotions + Social + Forums === Inbox unread threads)
 *   • messages.delta === 0
 *       (same check at message level — must also reconcile)
 *   • drift.missing_inbox_unread === 0
 *       (no unread CATEGORY_* messages are silently missing INBOX label)
 *   • drift.multi_category === 0
 *       (no message carries two CATEGORY_* labels)
 *   • messages.priority_unread is present and labeled as NOT additive
 *       (starred messages are an overlay — also counted inside People/Updates/etc)
 *
 * MAINTENANCE NOTE
 * ────────────────
 * Part B fails when categories drift (e.g. new Gmail behaviour skips INBOX on
 * category messages). Run scripts/inbox-visibility-backfill.ts to repair, then
 * re-run this test.
 */

"use strict";

const fs      = require("fs");
const path    = require("path");
const http    = require("http");

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

// ── load source ─────────────────────────────────────────────────────────────

const routesSrc    = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");
const inboxPageSrc = fs.readFileSync(path.join(__dirname, "../client/src/pages/gmail-inbox.tsx"), "utf8");

// ── Part A: source-grep ──────────────────────────────────────────────────────

console.log("\n── A1. Reconciliation endpoint registration ──");

assert(
  routesSrc.includes('"/api/gmail/inbox-debug"'),
  'GET /api/gmail/inbox-debug route registered in routes.ts'
);
assert(
  routesSrc.includes('"requireAdmin"') || routesSrc.includes(', requireAdmin,'),
  'reconciliation endpoint is gated by requireAdmin'
);

// Find the endpoint block
const debugIdx = routesSrc.indexOf('"/api/gmail/inbox-debug"');
const debugBlock = debugIdx !== -1 ? routesSrc.slice(debugIdx, debugIdx + 5000) : "";

assert(
  debugBlock.includes("requireAdmin"),
  "requireAdmin is in the inbox-debug handler chain"
);
// Use a larger window — the endpoint body can be >5000 chars
const bigBlock = debugIdx !== -1 ? routesSrc.slice(debugIdx, debugIdx + 12000) : "";

assert(
  bigBlock.includes("bucket_sum"),
  "endpoint computes bucket_sum"
);
assert(
  bigBlock.includes("delta"),
  "endpoint computes delta (inbox_unread - bucket_sum)"
);
assert(
  bigBlock.includes("missing_inbox_unread"),
  "endpoint includes missing_inbox_unread drift check"
);
assert(
  bigBlock.includes("multi_category"),
  "endpoint includes multi_category drift check"
);
assert(
  bigBlock.includes("priority_unread"),
  "endpoint exposes priority_unread (starred overlay)"
);
assert(
  bigBlock.includes("overlay") || bigBlock.includes("NOT add"),
  "endpoint documents priority as non-additive overlay in note field"
);

console.log("\n── A2. Category-counts uses same definitions as reconciliation ──");

// Phase 4: category-counts and inbox-debug both use derived columns (smart_category,
// is_inbox, is_unread) instead of label_ids ILIKE patterns. Numbers stay in sync
// because both endpoints use the identical predicates.
assert(
  routesSrc.includes("smart_category = 'updates'") &&
  routesSrc.includes("smart_category = 'promotions'") &&
  routesSrc.includes("smart_category = 'social'") &&
  routesSrc.includes("smart_category = 'forums'"),
  "routes.ts uses smart_category derived column for all four categories (Phase 4)"
);

// Canonical unit check: category-counts must use COUNT(DISTINCT ...) not COUNT(*)
// for the unread badge counts. Threads are the canonical unit because the inbox
// list shows one row per thread (dedupByThread).
const catCountsIdx = routesSrc.indexOf('"/api/gmail/category-counts"');
const catCountsBlock = catCountsIdx !== -1 ? routesSrc.slice(catCountsIdx, catCountsIdx + 4000) : "";
assert(
  catCountsBlock.includes("COUNT(DISTINCT gmail_thread_id)"),
  "category-counts endpoint uses COUNT(DISTINCT gmail_thread_id) — canonical thread unit"
);
assert(
  !catCountsBlock.includes("COUNT(*) FILTER"),
  "category-counts endpoint does NOT use COUNT(*) for unread badges"
);

// Health endpoint unread_count must also use DISTINCT threads
const healthIdx = routesSrc.indexOf('"/api/gmail/accounts/health"');
const healthBlock = healthIdx !== -1 ? routesSrc.slice(healthIdx, healthIdx + 3000) : "";
assert(
  healthBlock.includes("count(distinct m.gmail_thread_id)"),
  "accounts/health endpoint uses count(distinct) for unread_count badge"
);

// Phase 4: people_unread definition uses smart_category = 'people' (includes CATEGORY_PERSONAL).
// Old definition was INBOX + UNREAD + NOT CATEGORY_* (excluded CATEGORY_PERSONAL).
const peopleDefInDebug = bigBlock.indexOf("AS people_unread");
const peopleSnippet = peopleDefInDebug !== -1
  ? bigBlock.slice(Math.max(0, peopleDefInDebug - 200), peopleDefInDebug + 50)
  : "";
assert(
  peopleSnippet.includes("smart_category = 'people'"),
  "people_unread SQL uses smart_category = 'people' (Phase 4 — includes CATEGORY_PERSONAL)"
);
assert(
  peopleSnippet.includes("is_inbox = true"),
  "people_unread SQL uses is_inbox = true (Phase 4 — derived column)"
);
assert(
  peopleSnippet.includes("is_unread = true"),
  "people_unread SQL uses is_unread = true (Phase 4 — derived column)"
);
assert(
  !peopleSnippet.includes("NOT ILIKE '%CATEGORY_UPDATES"),
  "people_unread no longer uses NOT ILIKE CATEGORY_UPDATES exclusion (Phase 4)"
);

console.log("\n── A3. Priority UI removed — no isPriority annotation in section header ──");

// The Priority section was removed from smart-inbox. Verify the UI no longer
// contains the old isPriority overlay annotation block.
assert(
  !inboxPageSrc.includes('isPriority && ('),
  "Priority overlay annotation removed from smart section header"
);
assert(
  !inboxPageSrc.includes('"priority"') ||
  // Allow "priority" in unrelated contexts like task priority fields
  !inboxPageSrc.includes('inboxCategory === "priority"'),
  "Priority is not an active inboxCategory value"
);

console.log("\n── A4. Reconciliation script ──");

assert(
  fs.existsSync(path.join(__dirname, "../scripts/inbox-count-reconciliation.ts")),
  "scripts/inbox-count-reconciliation.ts exists"
);
const scriptSrc = fs.readFileSync(
  path.join(__dirname, "../scripts/inbox-count-reconciliation.ts"), "utf8"
);
assert(scriptSrc.includes("bucket_sum"),     "script computes bucket_sum");
assert(scriptSrc.includes("delta"),          "script checks delta === 0");
assert(scriptSrc.includes("missing_inbox"),  "script checks missing_inbox_unread");
assert(scriptSrc.includes("multi_category"), "script checks multi_category");

// ── Part B: live API ─────────────────────────────────────────────────────────

console.log("\n── B1. Live API — inbox count invariant ──");

const BASE = "http://localhost:5000";

function apiFetch(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const { method = "GET", body, cookie } = opts;
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: "localhost",
      port: 5000,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        "Origin": "http://localhost:5000",
        ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
    };
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers }); }
        catch { resolve({ status: res.statusCode, body: data, headers: res.headers }); }
      });
    });
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function runLiveTests() {
  // Login as admin
  const loginRes = await apiFetch("/api/auth/login", {
    method: "POST",
    body: { email: "trevor@voltsafe.com", password: "alberni1444" },
  });
  const cookie = loginRes.headers["set-cookie"]?.[0]?.split(";")[0];
  assert(loginRes.status === 200, `[auth] login status 200 (got ${loginRes.status})`);
  if (loginRes.status !== 200) {
    console.error("  ✗ Cannot continue live tests without login");
    return;
  }

  // Call reconciliation endpoint
  const debugRes = await apiFetch("/api/gmail/inbox-debug?asAccountId=all", { cookie });
  assert(debugRes.status === 200, `GET /api/gmail/inbox-debug returns 200 (got ${debugRes.status})`);
  if (debugRes.status !== 200) {
    console.error("  response:", debugRes.body);
    return;
  }

  const d = debugRes.body;

  // Print count table
  // CANONICAL UNIT: threads (badges count threads to match the list which shows
  // one row per thread). Message counts are shown for reference only.
  const threadBucketSum = (d.threads?.people ?? 0) + (d.threads?.updates ?? 0)
    + (d.threads?.promotions ?? 0) + (d.threads?.social ?? 0) + (d.threads?.forums ?? 0);
  const threadsDelta = (d.threads?.inbox_unread ?? -1) - threadBucketSum;
  console.log("");
  console.log("  === LIVE COUNT TABLE (CANONICAL: threads) ===");
  console.log(`  inbox_unread_threads:  ${d.threads?.inbox_unread}  ← what badge shows`);
  console.log(`    people_threads:      ${d.threads?.people}`);
  console.log(`    updates_threads:     ${d.threads?.updates}`);
  console.log(`    promotions_threads:  ${d.threads?.promotions}`);
  console.log(`    social_threads:      ${d.threads?.social}`);
  console.log(`    forums_threads:      ${d.threads?.forums}`);
  console.log(`    thread_bucket_sum:   ${threadBucketSum}`);
  console.log(`    threads_delta:       ${threadsDelta}  ← must be 0 (canonical DISTINCT ON CTE)`);
  console.log(`  === MESSAGE COUNTS (reference only) ===`);
  console.log(`  inbox_unread_msgs:     ${d.messages?.inbox_unread}`);
  console.log(`    people_msgs:         ${d.messages?.buckets?.people}`);
  console.log(`    updates_msgs:        ${d.messages?.buckets?.updates}`);
  console.log(`    promotions_msgs:     ${d.messages?.buckets?.promotions}`);
  console.log(`    social_msgs:         ${d.messages?.buckets?.social}`);
  console.log(`    forums_msgs:         ${d.messages?.buckets?.forums}`);
  console.log(`    msg_bucket_sum:      ${d.messages?.bucket_sum}`);
  console.log(`    messages_delta:      ${d.messages?.delta}  ← must be 0`);
  console.log(`    priority_unread:     ${d.messages?.priority_unread}  (overlay, not additive)`);
  console.log(`  === DRIFT ===`);
  console.log(`  missing_inbox:         ${d.drift?.missing_inbox_unread}  ← must be 0`);
  console.log(`  multi_category:        ${d.drift?.multi_category}  ← must be 0`);
  console.log("");

  // Invariant checks — CANONICAL UNIT: threads
  // Thread counts now use a DISTINCT ON CTE (latest unread inbox message per thread
  // determines its category), so threadsDelta MUST be exactly 0.
  assert(
    typeof d.threads?.inbox_unread === "number",
    "response includes threads.inbox_unread (canonical thread count)"
  );
  assert(
    threadsDelta === 0,
    `[THREADS] canonical CTE: People+Updates+Promotions+Social+Forums === inbox_unread_threads (delta=${threadsDelta})`
  );

  // Message-level reconciliation — smart_category is mutually exclusive per message so delta must be 0.
  assert(
    typeof d.messages?.delta === "number",
    "response includes messages.delta (number)"
  );
  assert(
    d.messages?.delta === 0,
    `[MSGS] People+Updates+Promotions+Social+Forums === inbox unread messages exactly (delta=${d.messages?.delta})`
  );
  assert(
    (d.drift?.missing_inbox_unread ?? 0) === 0,
    `no unread CATEGORY_* messages are missing INBOX label (got ${d.drift?.missing_inbox_unread})`
  );
  assert(
    d.drift?.multi_category === 0,
    `no message carries two CATEGORY_* labels (got ${d.drift?.multi_category})`
  );
  assert(
    typeof d.messages?.priority_unread === "number",
    "response exposes priority_unread count (read-only metadata — star/unstar removed from UI)"
  );
  assert(
    d.ok === true,
    `endpoint reports ok=true — all invariants satisfied (ok=${d.ok}, msg delta=${d.messages?.delta}, thread delta=${threadsDelta})`
  );

  // Verify 403 for non-admin
  const viewerLogin = await apiFetch("/api/auth/login", {
    method: "POST",
    body: { email: "viewer@voltsafe.com", password: "testpass1234" },
  });
  if (viewerLogin.status === 200) {
    const viewerCookie = viewerLogin.headers["set-cookie"]?.[0]?.split(";")[0];
    const viewerRes = await apiFetch("/api/gmail/inbox-debug", { cookie: viewerCookie });
    assert(viewerRes.status === 403, `non-admin GET /api/gmail/inbox-debug returns 403 (got ${viewerRes.status})`);
  }
}

runLiveTests()
  .catch(err => {
    console.error("  Live test error:", err.message);
    failed++;
  })
  .finally(() => {
    console.log(`\n${"─".repeat(55)}`);
    console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
    if (failed > 0) {
      console.error(`\n${failed} test(s) failed.`);
      process.exit(1);
    } else {
      console.log("\nAll tests passed.");
    }
  });
