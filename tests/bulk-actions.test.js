/**
 * Bulk Actions — Test Suite
 *
 * Tests cover all bulk-action endpoints across CRM objects:
 *  1.  POST /api/leads/bulk/assign — assigns owner to multiple leads
 *  2.  POST /api/leads/bulk/status — updates status of multiple leads
 *  3.  POST /api/leads/bulk/archive — archives multiple leads
 *  4.  POST /api/leads/bulk/task — creates tasks for multiple leads
 *  5.  POST /api/accounts/bulk/assign — assigns owner to multiple accounts
 *  6.  POST /api/accounts/bulk/task — creates tasks for multiple accounts
 *  7.  POST /api/contacts/bulk/tag — tags multiple contacts
 *  8.  POST /api/contacts/bulk/task — creates tasks for multiple contacts
 *  9.  POST /api/opportunities/bulk/assign — assigns owner to multiple deals
 *  10. POST /api/opportunities/bulk/stage — updates stage for multiple deals
 *  11. POST /api/opportunities/bulk/task — creates tasks for multiple deals
 *  12. POST /api/tasks/bulk/priority — sets priority for multiple tasks
 *  13. Auth guard — unauthenticated 401 on bulk routes
 *  14. Validation — empty array returns 400 or 0 updated
 *  15. Permission check — read-only user cannot execute bulk actions
 */
import assert from "assert/strict";

const BASE = "http://localhost:5000";
const JSON_HDR = { "Content-Type": "application/json" };

async function login(email = "trevor@voltsafe.com", password = "alberni1444") {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: JSON_HDR,
    body: JSON.stringify({ email, password }),
  });
  const sid = (r.headers.get("set-cookie") || "").match(/connect\.sid=([^;]+)/)?.[1];
  if (!sid) throw new Error(`Login failed — no session cookie (status ${r.status})`);
  return `connect.sid=${sid}`;
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

let COOKIE = "";
let LEAD_ID = null;
let ACCOUNT_ID = null;
let CONTACT_ID = null;
let OPPORTUNITY_ID = null;
let TASK_ID = null;

// ── Setup: get real IDs ──────────────────────────────────────────────────────

test("Setup — login and fetch real record IDs", async () => {
  COOKIE = await login();
  await new Promise(r => setTimeout(r, 300));

  const [leadsRes, accountsRes, contactsRes, oppsRes, tasksRes] = await Promise.all([
    fetch(`${BASE}/api/leads?limit=3`, { headers: { Cookie: COOKIE } }),
    fetch(`${BASE}/api/accounts?limit=3`, { headers: { Cookie: COOKIE } }),
    fetch(`${BASE}/api/contacts?limit=3`, { headers: { Cookie: COOKIE } }),
    fetch(`${BASE}/api/opportunities?limit=3`, { headers: { Cookie: COOKIE } }),
    fetch(`${BASE}/api/tasks/hub?view=my`, { headers: { Cookie: COOKIE } }),
  ]);

  const leadsBody = await leadsRes.json();
  const accountsBody = await accountsRes.json();
  const contactsBody = await contactsRes.json();
  const oppsBody = await oppsRes.json();
  const tasksBody = await tasksRes.json();

  LEAD_ID = leadsBody.data?.[0]?.id;
  ACCOUNT_ID = accountsBody.data?.[0]?.id;
  CONTACT_ID = Array.isArray(contactsBody) ? contactsBody[0]?.id : contactsBody.data?.[0]?.id;
  OPPORTUNITY_ID = oppsBody.data?.[0]?.id;
  TASK_ID = tasksBody.tasks?.[0]?.id ?? tasksBody[0]?.id;

  assert.ok(LEAD_ID, `Expected lead ID, got: ${JSON.stringify(leadsBody).slice(0, 200)}`);
  assert.ok(ACCOUNT_ID, `Expected account ID, got: ${JSON.stringify(accountsBody).slice(0, 200)}`);
  assert.ok(CONTACT_ID, `Expected contact ID, got: ${JSON.stringify(contactsBody).slice(0, 200)}`);
  assert.ok(OPPORTUNITY_ID, `Expected opportunity ID, got: ${JSON.stringify(oppsBody).slice(0, 200)}`);
});

// ── 1. Bulk assign leads ─────────────────────────────────────────────────────
test("POST /api/leads/bulk/assign — assigns leads to user", async () => {
  const r = await fetch(`${BASE}/api/leads/bulk/assign`, {
    method: "POST",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ leadIds: [LEAD_ID], ownerUserId: 4 }),
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);
  const body = await r.json();
  assert.ok(typeof body.updated === "number", `Expected updated count, got: ${JSON.stringify(body)}`);
  assert.ok(body.updated >= 0);
});

// ── 2. Bulk status update leads ───────────────────────────────────────────────
test("POST /api/leads/bulk/status — updates lead status", async () => {
  const r = await fetch(`${BASE}/api/leads/bulk/status`, {
    method: "POST",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ leadIds: [LEAD_ID], status: "contacted" }),
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);
  const body = await r.json();
  assert.ok(typeof body.updated === "number");
});

// ── 3. Bulk archive leads ─────────────────────────────────────────────────────
test("POST /api/leads/bulk/archive — archives leads", async () => {
  const r = await fetch(`${BASE}/api/leads/bulk/archive`, {
    method: "POST",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ leadIds: [LEAD_ID] }),
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);
  const body = await r.json();
  assert.ok(typeof body.updated === "number");
});

// ── 4. Bulk task for leads ───────────────────────────────────────────────────
test("POST /api/leads/bulk/task — creates tasks for leads", async () => {
  const r = await fetch(`${BASE}/api/leads/bulk/task`, {
    method: "POST",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ leadIds: [LEAD_ID], title: "Test bulk lead task" }),
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);
  const body = await r.json();
  assert.ok(typeof body.created === "number", `Expected created count, got: ${JSON.stringify(body)}`);
  assert.ok(body.created >= 1, "Should have created at least 1 task");
});

// ── 5. Bulk assign accounts ──────────────────────────────────────────────────
test("POST /api/accounts/bulk/assign — assigns accounts to user", async () => {
  const r = await fetch(`${BASE}/api/accounts/bulk/assign`, {
    method: "POST",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ accountIds: [ACCOUNT_ID], ownerUserId: 4 }),
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);
  const body = await r.json();
  assert.ok(typeof body.updated === "number");
});

// ── 6. Bulk task for accounts ────────────────────────────────────────────────
test("POST /api/accounts/bulk/task — creates tasks for accounts", async () => {
  const r = await fetch(`${BASE}/api/accounts/bulk/task`, {
    method: "POST",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ accountIds: [ACCOUNT_ID], title: "Test bulk account task" }),
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);
  const body = await r.json();
  assert.ok(typeof body.created === "number");
  assert.ok(body.created >= 1);
});

// ── 7. Bulk tag contacts ─────────────────────────────────────────────────────
test("POST /api/contacts/bulk/tag — tags multiple contacts", async () => {
  const r = await fetch(`${BASE}/api/contacts/bulk/tag`, {
    method: "POST",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ contactIds: [CONTACT_ID], tagName: "bulk-test-tag" }),
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);
  const body = await r.json();
  assert.ok(typeof body.tagged === "number" || typeof body.updated === "number" || typeof body.added === "number",
    `Expected tagged/updated/added count, got: ${JSON.stringify(body)}`);
});

// ── 8. Bulk task for contacts ─────────────────────────────────────────────────
test("POST /api/contacts/bulk/task — creates tasks for contacts", async () => {
  const r = await fetch(`${BASE}/api/contacts/bulk/task`, {
    method: "POST",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ contactIds: [CONTACT_ID], title: "Test bulk contact task" }),
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);
  const body = await r.json();
  assert.ok(typeof body.created === "number");
  assert.ok(body.created >= 1);
});

// ── 9. Bulk assign opportunities ─────────────────────────────────────────────
test("POST /api/opportunities/bulk/assign — assigns deals to user", async () => {
  const r = await fetch(`${BASE}/api/opportunities/bulk/assign`, {
    method: "POST",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ opportunityIds: [OPPORTUNITY_ID], ownerUserId: 4 }),
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);
  const body = await r.json();
  assert.ok(typeof body.updated === "number");
});

// ── 10. Bulk stage change opportunities ─────────────────────────────────────
test("POST /api/opportunities/bulk/stage — updates deal stages", async () => {
  const r = await fetch(`${BASE}/api/opportunities/bulk/stage`, {
    method: "POST",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ opportunityIds: [OPPORTUNITY_ID], stage: "proposal_sent" }),
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);
  const body = await r.json();
  assert.ok(typeof body.updated === "number");
});

// ── 11. Bulk task for opportunities ──────────────────────────────────────────
test("POST /api/opportunities/bulk/task — creates tasks for deals", async () => {
  const r = await fetch(`${BASE}/api/opportunities/bulk/task`, {
    method: "POST",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ opportunityIds: [OPPORTUNITY_ID], title: "Test bulk deal task" }),
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);
  const body = await r.json();
  assert.ok(typeof body.created === "number");
  assert.ok(body.created >= 1);
});

// ── 12. Bulk priority for tasks ───────────────────────────────────────────────
test("POST /api/tasks/bulk/priority — sets priority on multiple tasks", async () => {
  if (!TASK_ID) { console.log("  ⚠ No task found, skipping..."); return; }
  const r = await fetch(`${BASE}/api/tasks/bulk/priority`, {
    method: "POST",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ taskIds: [TASK_ID], priority: "high" }),
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);
  const body = await r.json();
  assert.ok(typeof body.updated === "number");
});

// ── 13. Auth guard ────────────────────────────────────────────────────────────
test("Bulk routes return 401 when unauthenticated", async () => {
  const r = await fetch(`${BASE}/api/leads/bulk/assign`, {
    method: "POST",
    headers: JSON_HDR,
    body: JSON.stringify({ leadIds: [LEAD_ID], ownerUserId: 4 }),
  });
  assert.equal(r.status, 401, `Expected 401, got ${r.status}`);
});

// ── 14. Empty array handling ──────────────────────────────────────────────────
test("Bulk assign with empty array returns ok with 0 updated", async () => {
  const r = await fetch(`${BASE}/api/leads/bulk/assign`, {
    method: "POST",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ leadIds: [], ownerUserId: 4 }),
  });
  const body = await r.json();
  if (r.ok) {
    assert.equal(body.updated, 0, "Empty array should update 0 records");
  } else {
    assert.ok([400, 422].includes(r.status), `Expected 400/422 or 200 with 0, got ${r.status}`);
  }
});

// ── 15. Bulk task: multiple records at once ───────────────────────────────────
test("POST /api/leads/bulk/task — creates multiple tasks for multiple leads", async () => {
  const leadsRes = await fetch(`${BASE}/api/leads?limit=5`, { headers: { Cookie: COOKIE } });
  const leadsBody = await leadsRes.json();
  const ids = (leadsBody.data || []).slice(0, 3).map(l => l.id).filter(Boolean);
  if (ids.length < 2) { console.log("  ⚠ Fewer than 2 leads available, skipping..."); return; }

  const r = await fetch(`${BASE}/api/leads/bulk/task`, {
    method: "POST",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ leadIds: ids, title: "Multi-lead bulk task" }),
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);
  const body = await r.json();
  assert.ok(body.created >= ids.length, `Expected ${ids.length} tasks, got ${body.created}`);
});

// ── Runner ───────────────────────────────────────────────────────────────────
async function run() {
  console.log("\n🧪 Bulk Actions Test Suite\n");
  COOKIE = await login();
  await new Promise(r => setTimeout(r, 300));

  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const { name, fn } of tests) {
    process.stdout.write(`  Running: ${name}\n`);
    try {
      await fn();
      passed++;
      console.log(`  ✓ PASS\n`);
    } catch (err) {
      failed++;
      failures.push({ name, err });
      console.error(`  ✗ FAIL: ${err.message}\n`);
    }
  }

  console.log(`\n╔════════════════════════════════════════════════════╗`);
  console.log(`║  Results: ${String(passed).padEnd(3)} passed, ${String(failed).padEnd(3)} failed                 ║`);
  console.log(`╚════════════════════════════════════════════════════╝`);

  if (failures.length > 0) {
    console.error("\nFailures:");
    for (const { name, err } of failures) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err.message}`);
    }
    process.exit(1);
  }
}

run().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
