/**
 * Saved Views — Test Suite
 *
 * Tests cover all CRUD operations for saved views + set-default:
 *  1.  GET /api/saved-views?pageKey=leads — returns array (possibly empty)
 *  2.  POST /api/saved-views — creates a saved view
 *  3.  GET /api/saved-views?pageKey=leads — includes the newly created view
 *  4.  PUT /api/saved-views/:id — updates name and filtersJson
 *  5.  PATCH /api/saved-views/:id/set-default — sets view as default
 *  6.  GET /api/saved-views?pageKey=leads — the default view has isDefault=true
 *  7.  PATCH /api/saved-views/:id/set-default (2nd view) — switches default
 *  8.  DELETE /api/saved-views/:id — deletes the view
 *  9.  GET /api/saved-views?pageKey=leads — deleted view no longer appears
 *  10. isShared=true view is accessible via accounts pageKey
 *  11. Auth guard — unauthenticated 401 on saved-view routes
 *  12. pageKey isolation — accounts views don't appear in leads response
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
let VIEW_ID = null;
let VIEW2_ID = null;

// ── 1. List views (possibly empty) ───────────────────────────────────────────
test("GET /api/saved-views?pageKey=leads — returns array", async () => {
  const r = await fetch(`${BASE}/api/saved-views?pageKey=leads`, {
    headers: { Cookie: COOKIE },
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);
  const body = await r.json();
  assert.ok(Array.isArray(body), `Expected array, got ${typeof body}`);
});

// ── 2. Create a saved view ────────────────────────────────────────────────────
test("POST /api/saved-views — creates a saved view", async () => {
  const r = await fetch(`${BASE}/api/saved-views`, {
    method: "POST",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({
      name: "Test Leads View",
      pageKey: "leads",
      filtersJson: JSON.stringify({ status: "contacted", country: "us" }),
      sortBy: "company",
      sortOrder: "asc",
      isShared: false,
    }),
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);
  const body = await r.json();
  assert.ok(body.id, `Expected view id, got: ${JSON.stringify(body)}`);
  assert.equal(body.name, "Test Leads View");
  assert.equal(body.pageKey, "leads");
  VIEW_ID = body.id;
});

// ── 3. List views includes new view ──────────────────────────────────────────
test("GET /api/saved-views?pageKey=leads — new view appears in list", async () => {
  const r = await fetch(`${BASE}/api/saved-views?pageKey=leads`, {
    headers: { Cookie: COOKIE },
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);
  const body = await r.json();
  const found = body.find(v => v.id === VIEW_ID);
  assert.ok(found, `Could not find view ID ${VIEW_ID} in response`);
  assert.equal(found.name, "Test Leads View");
});

// ── 4. Update the saved view ──────────────────────────────────────────────────
test("PUT /api/saved-views/:id — updates name and filtersJson", async () => {
  const r = await fetch(`${BASE}/api/saved-views/${VIEW_ID}`, {
    method: "PUT",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({
      name: "Updated Leads View",
      filtersJson: JSON.stringify({ status: "qualified" }),
    }),
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);
  const body = await r.json();
  assert.equal(body.name, "Updated Leads View");
});

// ── 5. Set default view ───────────────────────────────────────────────────────
test("PATCH /api/saved-views/:id/set-default — marks view as default", async () => {
  const r = await fetch(`${BASE}/api/saved-views/${VIEW_ID}/set-default`, {
    method: "PATCH",
    headers: { ...JSON_HDR, Cookie: COOKIE },
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);
  const body = await r.json();
  assert.ok(body.id === VIEW_ID || body.success === true || body.ok === true || typeof body.updated === "number",
    `Expected success response, got: ${JSON.stringify(body)}`);
});

// ── 6. Default view shows isDefault=true ─────────────────────────────────────
test("GET /api/saved-views?pageKey=leads — isDefault is set on the default view", async () => {
  const r = await fetch(`${BASE}/api/saved-views?pageKey=leads`, {
    headers: { Cookie: COOKIE },
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);
  const body = await r.json();
  const found = body.find(v => v.id === VIEW_ID);
  assert.ok(found, `Could not find view ID ${VIEW_ID}`);
  assert.equal(found.isDefault, true, `Expected isDefault=true, got: ${found.isDefault}`);
});

// ── 7. Create a second view and set it as default ────────────────────────────
test("PATCH /api/saved-views/:id/set-default — switching default clears old default", async () => {
  const createRes = await fetch(`${BASE}/api/saved-views`, {
    method: "POST",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({
      name: "Second Leads View",
      pageKey: "leads",
      filtersJson: JSON.stringify({ status: "all" }),
      isShared: false,
    }),
  });
  assert.ok(createRes.ok, `Expected 200 creating second view, got ${createRes.status}`);
  const view2 = await createRes.json();
  VIEW2_ID = view2.id;

  const setDefaultRes = await fetch(`${BASE}/api/saved-views/${VIEW2_ID}/set-default`, {
    method: "PATCH",
    headers: { ...JSON_HDR, Cookie: COOKIE },
  });
  assert.ok(setDefaultRes.ok, `Expected 200 setting default, got ${setDefaultRes.status}`);

  const listRes = await fetch(`${BASE}/api/saved-views?pageKey=leads`, {
    headers: { Cookie: COOKIE },
  });
  const list = await listRes.json();

  const view1 = list.find(v => v.id === VIEW_ID);
  const view2Updated = list.find(v => v.id === VIEW2_ID);

  assert.ok(view2Updated?.isDefault === true, `Expected view2 isDefault=true, got: ${view2Updated?.isDefault}`);
  if (view1) {
    assert.ok(!view1.isDefault, `Expected view1 isDefault=false after switching, got: ${view1.isDefault}`);
  }
});

// ── 8. Delete the first view ──────────────────────────────────────────────────
test("DELETE /api/saved-views/:id — deletes the view", async () => {
  const r = await fetch(`${BASE}/api/saved-views/${VIEW_ID}`, {
    method: "DELETE",
    headers: { Cookie: COOKIE },
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);
});

// ── 9. Deleted view no longer appears ────────────────────────────────────────
test("GET /api/saved-views?pageKey=leads — deleted view is gone", async () => {
  const r = await fetch(`${BASE}/api/saved-views?pageKey=leads`, {
    headers: { Cookie: COOKIE },
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);
  const body = await r.json();
  const found = body.find(v => v.id === VIEW_ID);
  assert.ok(!found, `Expected deleted view to not appear, but found it: ${JSON.stringify(found)}`);
});

// ── 10. Shared view is visible ────────────────────────────────────────────────
test("POST /api/saved-views — shared view is returned in list", async () => {
  const createRes = await fetch(`${BASE}/api/saved-views`, {
    method: "POST",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({
      name: "Shared Accounts View",
      pageKey: "accounts",
      filtersJson: JSON.stringify({ segment: "marina" }),
      isShared: true,
    }),
  });
  assert.ok(createRes.ok, `Expected 200, got ${createRes.status}`);
  const shared = await createRes.json();
  assert.ok(shared.id, "Expected id");

  const listRes = await fetch(`${BASE}/api/saved-views?pageKey=accounts`, {
    headers: { Cookie: COOKIE },
  });
  assert.ok(listRes.ok);
  const list = await listRes.json();
  const found = list.find(v => v.id === shared.id);
  assert.ok(found, "Shared view should appear in accounts list");
  assert.equal(found.isShared, true);

  await fetch(`${BASE}/api/saved-views/${shared.id}`, {
    method: "DELETE",
    headers: { Cookie: COOKIE },
  });
});

// ── 11. Auth guard ────────────────────────────────────────────────────────────
test("GET /api/saved-views — 401 when unauthenticated", async () => {
  const r = await fetch(`${BASE}/api/saved-views?pageKey=leads`);
  assert.equal(r.status, 401, `Expected 401, got ${r.status}`);
});

// ── 12. pageKey isolation ─────────────────────────────────────────────────────
test("GET /api/saved-views — pageKey isolates views per section", async () => {
  const [leadsRes, accountsRes] = await Promise.all([
    fetch(`${BASE}/api/saved-views?pageKey=leads`, { headers: { Cookie: COOKIE } }),
    fetch(`${BASE}/api/saved-views?pageKey=accounts`, { headers: { Cookie: COOKIE } }),
  ]);
  const leadsViews = await leadsRes.json();
  const accountsViews = await accountsRes.json();

  for (const view of leadsViews) {
    assert.equal(view.pageKey, "leads", `Lead view has wrong pageKey: ${view.pageKey}`);
  }
  for (const view of accountsViews) {
    assert.equal(view.pageKey, "accounts", `Account view has wrong pageKey: ${view.pageKey}`);
  }
});

// ── Cleanup ───────────────────────────────────────────────────────────────────
test("Cleanup — delete view2 created during testing", async () => {
  if (!VIEW2_ID) return;
  const r = await fetch(`${BASE}/api/saved-views/${VIEW2_ID}`, {
    method: "DELETE",
    headers: { Cookie: COOKIE },
  });
  assert.ok(r.ok, `Expected 200 cleaning up view2, got ${r.status}`);
});

// ── Runner ───────────────────────────────────────────────────────────────────
async function run() {
  console.log("\n🧪 Saved Views Test Suite\n");
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
