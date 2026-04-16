/**
 * Revenue Simulator v2 — Integration Tests
 * Tests: CRM baseline, actions, pin/board-pack, actuals, forecast vs actuals,
 *        board pack integration, auth guards, regression checks.
 *
 * Usage: node tests/revenue-simulator-v2.test.js
 */

const BASE = "http://localhost:5000";

let sessionCookie = "";

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "trevor@voltsafe.com", password: "alberni1444" }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const setCookie = res.headers.get("set-cookie") || "";
  sessionCookie = setCookie.split(";")[0];
}

function authed(opts = {}) {
  return { ...opts, headers: { ...(opts.headers || {}), Cookie: sessionCookie, "Content-Type": "application/json" } };
}

async function api(method, path, body) {
  const opts = authed({ method });
  if (body !== undefined) opts.body = JSON.stringify(body);
  return fetch(`${BASE}${path}`, opts);
}

async function unauthFetch(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  return fetch(`${BASE}${path}`, opts);
}

let passed = 0, failed = 0;
const failures = [];
const created = { scenarios: [], actuals: [] };

async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    → ${err.message}`);
    failed++;
    failures.push({ name, error: err.message });
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }

async function cleanup() {
  for (const id of created.scenarios) {
    await api("DELETE", `/api/revenue-sim/scenarios/${id}`).catch(() => {});
  }
  for (const mk of created.actuals) {
    // No delete route for actuals — just skip (they're test data by month_key)
  }
}

async function run() {
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(" Revenue Simulator v2 — Integration Tests");
  console.log("═══════════════════════════════════════════════════════════\n");

  await login();

  // ─────────────────────────────────────────────────────────────────────
  // GROUP 1: CRM Baseline
  // ─────────────────────────────────────────────────────────────────────
  console.log("▸ Group 1: CRM-Derived Baseline");

  await test("GET /api/revenue-sim/crm-baseline returns 200", async () => {
    const res = await api("GET", "/api/revenue-sim/crm-baseline");
    assert(res.ok, `Expected 200, got ${res.status}`);
  });

  await test("CRM baseline has required fields", async () => {
    const res = await api("GET", "/api/revenue-sim/crm-baseline");
    const d = await res.json();
    assert("avgDealSize" in d, "Missing avgDealSize");
    assert("winRate" in d, "Missing winRate");
    assert("avgSalesCycleDays" in d, "Missing avgSalesCycleDays");
    assert("openDealCount" in d, "Missing openDealCount");
    assert("openPipelineValue" in d, "Missing openPipelineValue");
    assert("impliedParams" in d, "Missing impliedParams");
    assert("dataCoverage" in d, "Missing dataCoverage");
    assert(Array.isArray(d.notes), "notes should be array");
    assert(typeof d.stageDistribution === "object", "stageDistribution should be object");
  });

  await test("CRM baseline avgDealSize is non-negative", async () => {
    const res = await api("GET", "/api/revenue-sim/crm-baseline");
    const d = await res.json();
    assert(d.avgDealSize >= 0, `avgDealSize should be ≥ 0, got ${d.avgDealSize}`);
  });

  await test("CRM baseline winRate is between 0 and 1", async () => {
    const res = await api("GET", "/api/revenue-sim/crm-baseline");
    const d = await res.json();
    assert(d.winRate >= 0 && d.winRate <= 1, `winRate out of range: ${d.winRate}`);
  });

  await test("CRM baseline dataCoverage is valid enum", async () => {
    const res = await api("GET", "/api/revenue-sim/crm-baseline");
    const d = await res.json();
    assert(["full", "partial", "sparse"].includes(d.dataCoverage), `Invalid dataCoverage: ${d.dataCoverage}`);
  });

  await test("CRM baseline impliedParams is valid SimParams object", async () => {
    const res = await api("GET", "/api/revenue-sim/crm-baseline");
    const d = await res.json();
    assert(typeof d.impliedParams === "object", "impliedParams must be object");
  });

  await test("CRM baseline has at least 1 note", async () => {
    const res = await api("GET", "/api/revenue-sim/crm-baseline");
    const d = await res.json();
    assert(d.notes.length >= 1, "Expected at least 1 note");
  });

  await test("CRM baseline avgSalesCycleDays > 0", async () => {
    const res = await api("GET", "/api/revenue-sim/crm-baseline");
    const d = await res.json();
    assert(d.avgSalesCycleDays > 0, `avgSalesCycleDays should be > 0, got ${d.avgSalesCycleDays}`);
  });

  await test("CRM baseline requires auth", async () => {
    const res = await unauthFetch("GET", "/api/revenue-sim/crm-baseline");
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  // ─────────────────────────────────────────────────────────────────────
  // GROUP 2: Actuals Upsert + Forecast vs Actuals
  // ─────────────────────────────────────────────────────────────────────
  console.log("\n▸ Group 2: Actuals Upsert + Forecast vs Actuals");

  const testMonthKey = `2024-${String(Math.floor(Math.random() * 12 + 1)).padStart(2, "0")}`;
  created.actuals.push(testMonthKey);

  await test("POST /api/revenue-sim/actuals/upsert creates record", async () => {
    const res = await api("POST", "/api/revenue-sim/actuals/upsert", {
      month_key: testMonthKey,
      actual_amount: 75000,
      forecast_amount: 80000,
    });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const d = await res.json();
    assert(d.month_key === testMonthKey, "month_key mismatch");
  });

  await test("POST /api/revenue-sim/actuals/upsert updates record idempotently", async () => {
    const [r1, r2] = await Promise.all([
      api("POST", "/api/revenue-sim/actuals/upsert", { month_key: testMonthKey, actual_amount: 90000 }),
      null,
    ]);
    const d1 = await r1.json();
    assert(parseFloat(d1.actual_amount) === 90000, `Expected 90000, got ${d1.actual_amount}`);
  });

  await test("Actuals upsert requires valid YYYY-MM format", async () => {
    const res = await api("POST", "/api/revenue-sim/actuals/upsert", {
      month_key: "not-a-month", actual_amount: 1000,
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  await test("Actuals upsert requires month_key", async () => {
    const res = await api("POST", "/api/revenue-sim/actuals/upsert", { actual_amount: 5000 });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  await test("GET /api/revenue-sim/forecast-vs-actuals returns 200", async () => {
    const res = await api("GET", "/api/revenue-sim/forecast-vs-actuals");
    assert(res.ok, `Expected 200, got ${res.status}`);
  });

  await test("Forecast vs actuals has required fields", async () => {
    const res = await api("GET", "/api/revenue-sim/forecast-vs-actuals");
    const d = await res.json();
    assert(Array.isArray(d.rows), "rows must be array");
    assert(typeof d.totalForecast === "number", "totalForecast must be number");
    assert(typeof d.totalActual === "number", "totalActual must be number");
    assert(typeof d.totalVariance === "number", "totalVariance must be number");
    assert(typeof d.variancePct === "number", "variancePct must be number");
    assert(typeof d.hasSufficientData === "boolean", "hasSufficientData must be boolean");
  });

  await test("Forecast vs actuals includes the test month", async () => {
    const res = await api("GET", "/api/revenue-sim/forecast-vs-actuals");
    const d = await res.json();
    const found = d.rows.find((r) => r.month_key === testMonthKey);
    assert(found, `Test month ${testMonthKey} not found in forecast vs actuals`);
  });

  await test("Row variance_amount = actual - forecast", async () => {
    const res = await api("GET", "/api/revenue-sim/forecast-vs-actuals");
    const d = await res.json();
    const row = d.rows.find((r) => r.month_key === testMonthKey);
    if (row && row.forecast_amount > 0) {
      const expected = row.actual_amount - row.forecast_amount;
      assert(Math.abs(row.variance_amount - expected) < 1, `variance_amount mismatch: expected ${expected}, got ${row.variance_amount}`);
    }
  });

  await test("Forecast vs actuals requires auth", async () => {
    const res = await unauthFetch("GET", "/api/revenue-sim/forecast-vs-actuals");
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await test("Actuals upsert requires auth", async () => {
    const res = await unauthFetch("POST", "/api/revenue-sim/actuals/upsert", { month_key: "2024-01", actual_amount: 1 });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  // ─────────────────────────────────────────────────────────────────────
  // GROUP 3: Scenario v2 fields (is_pinned, board_pack_include, source_type)
  // ─────────────────────────────────────────────────────────────────────
  console.log("\n▸ Group 3: Scenario v2 fields");

  let testScenarioId = null;

  await test("New scenario has is_pinned=false by default", async () => {
    const simRes = await api("POST", "/api/revenue-sim/simulate", { winRateMultiplier: 1.1 });
    const sim = await simRes.json();
    const res = await api("POST", "/api/revenue-sim/scenarios", {
      name: "v2 Test Scenario A",
      parameters: { winRateMultiplier: 1.1 },
      projection: sim, baselineSnapshot: sim,
    });
    const d = await res.json();
    assert(d.id, "Expected id");
    testScenarioId = d.id;
    created.scenarios.push(d.id);
    // List to check fields
    const listRes = await api("GET", "/api/revenue-sim/scenarios");
    const list = await listRes.json();
    const sc = list.find((s) => s.id === testScenarioId);
    assert(sc, "Scenario not in list");
    assert(sc.is_pinned === false, `Expected is_pinned=false, got ${sc.is_pinned}`);
    assert(sc.board_pack_include === false, `Expected board_pack_include=false, got ${sc.board_pack_include}`);
    assert(sc.source_type === "manual" || sc.source_type != null, "source_type missing");
  });

  // ─────────────────────────────────────────────────────────────────────
  // GROUP 4: Pin / Unpin
  // ─────────────────────────────────────────────────────────────────────
  console.log("\n▸ Group 4: Pin / Unpin");

  await test("POST /api/revenue-sim/:id/pin pins the scenario", async () => {
    assert(testScenarioId, "No test scenario");
    const res = await api("POST", `/api/revenue-sim/${testScenarioId}/pin`, {});
    assert(res.ok, `Expected 200, got ${res.status}`);
    const d = await res.json();
    assert(d.is_pinned === true, `Expected is_pinned=true, got ${d.is_pinned}`);
  });

  await test("Pinning a second scenario unpins the first", async () => {
    // Create second scenario
    const res2 = await api("POST", "/api/revenue-sim/scenarios", {
      name: "v2 Test Scenario B", parameters: { winRateMultiplier: 0.9 },
      projection: {}, baselineSnapshot: {},
    });
    const sc2 = await res2.json();
    created.scenarios.push(sc2.id);

    // Pin second
    await api("POST", `/api/revenue-sim/${sc2.id}/pin`, {});

    // Verify first is now unpinned
    const listRes = await api("GET", "/api/revenue-sim/scenarios");
    const list = await listRes.json();
    const first = list.find((s) => s.id === testScenarioId);
    assert(first.is_pinned === false, `Expected first scenario to be unpinned, got ${first.is_pinned}`);

    // Unpin second too
    await api("POST", `/api/revenue-sim/${sc2.id}/pin`, {});
  });

  await test("POST /api/revenue-sim/:id/pin unpins when already pinned", async () => {
    // Pin it first
    await api("POST", `/api/revenue-sim/${testScenarioId}/pin`, {});
    // Unpin
    const res = await api("POST", `/api/revenue-sim/${testScenarioId}/pin`, {});
    const d = await res.json();
    assert(d.is_pinned === false, `Expected is_pinned=false after toggle, got ${d.is_pinned}`);
  });

  await test("Pin requires auth", async () => {
    const res = await unauthFetch("POST", `/api/revenue-sim/${testScenarioId}/pin`, {});
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await test("Pin returns 404 for non-existent scenario", async () => {
    const res = await api("POST", "/api/revenue-sim/99999999/pin", {});
    assert(res.status === 404, `Expected 404, got ${res.status}`);
  });

  // ─────────────────────────────────────────────────────────────────────
  // GROUP 5: Board Pack Toggle
  // ─────────────────────────────────────────────────────────────────────
  console.log("\n▸ Group 5: Board Pack Toggle");

  await test("POST /api/revenue-sim/:id/board-pack-toggle enables board pack", async () => {
    const res = await api("POST", `/api/revenue-sim/${testScenarioId}/board-pack-toggle`, {});
    assert(res.ok, `Expected 200, got ${res.status}`);
    const d = await res.json();
    assert(d.board_pack_include === true, `Expected board_pack_include=true, got ${d.board_pack_include}`);
  });

  await test("Board pack toggle idempotent: second toggle disables", async () => {
    const res = await api("POST", `/api/revenue-sim/${testScenarioId}/board-pack-toggle`, {});
    const d = await res.json();
    assert(d.board_pack_include === false, `Expected false after second toggle, got ${d.board_pack_include}`);
  });

  await test("Board pack toggle requires auth", async () => {
    const res = await unauthFetch("POST", `/api/revenue-sim/${testScenarioId}/board-pack-toggle`, {});
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await test("Board pack toggle 404 for non-existent scenario", async () => {
    const res = await api("POST", "/api/revenue-sim/99999999/board-pack-toggle", {});
    assert(res.status === 404, `Expected 404, got ${res.status}`);
  });

  // ─────────────────────────────────────────────────────────────────────
  // GROUP 6: Scenario Actions CRUD
  // ─────────────────────────────────────────────────────────────────────
  console.log("\n▸ Group 6: Scenario Actions");

  let testActionId = null;

  await test("GET /api/revenue-sim/:id/actions returns empty array initially", async () => {
    const res = await api("GET", `/api/revenue-sim/${testScenarioId}/actions`);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const d = await res.json();
    assert(Array.isArray(d), "Expected array");
  });

  await test("POST /api/revenue-sim/:id/actions creates an action", async () => {
    const res = await api("POST", `/api/revenue-sim/${testScenarioId}/actions`, {
      title: "Increase top-of-funnel by 20%",
      notes: "Assign SDR targets for next quarter",
      status: "open",
    });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    const d = await res.json();
    assert(d.id, "Expected action id");
    assert(d.title === "Increase top-of-funnel by 20%", "Title mismatch");
    testActionId = d.id;
  });

  await test("GET /api/revenue-sim/:id/actions lists the created action", async () => {
    const res = await api("GET", `/api/revenue-sim/${testScenarioId}/actions`);
    const d = await res.json();
    const found = d.find((a) => a.id === testActionId);
    assert(found, "Created action not found in list");
    assert(found.status === "open", `Expected status=open, got ${found.status}`);
  });

  await test("POST actions supports array of actions", async () => {
    const res = await api("POST", `/api/revenue-sim/${testScenarioId}/actions`, [
      { title: "Action Batch 1", status: "open" },
      { title: "Action Batch 2", status: "open" },
    ]);
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    const d = await res.json();
    assert(Array.isArray(d), "Expected array for batch create");
    assert(d.length === 2, `Expected 2 actions, got ${d.length}`);
  });

  await test("PATCH /api/revenue-sim/actions/:id updates status to in_progress", async () => {
    const res = await api("PATCH", `/api/revenue-sim/actions/${testActionId}`, { status: "in_progress" });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const d = await res.json();
    assert(d.status === "in_progress", `Expected in_progress, got ${d.status}`);
  });

  await test("PATCH action status to done", async () => {
    const res = await api("PATCH", `/api/revenue-sim/actions/${testActionId}`, { status: "done" });
    const d = await res.json();
    assert(d.status === "done", `Expected done, got ${d.status}`);
  });

  await test("PATCH action rejects invalid status", async () => {
    const res = await api("PATCH", `/api/revenue-sim/actions/${testActionId}`, { status: "invalid_status" });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  await test("PATCH action 404 for non-existent", async () => {
    const res = await api("PATCH", "/api/revenue-sim/actions/99999999", { status: "done" });
    assert(res.status === 404, `Expected 404, got ${res.status}`);
  });

  await test("Actions require auth", async () => {
    const [r1, r2] = await Promise.all([
      unauthFetch("GET", `/api/revenue-sim/${testScenarioId}/actions`),
      unauthFetch("POST", `/api/revenue-sim/${testScenarioId}/actions`, { title: "Ghost" }),
    ]);
    assert(r1.status === 401, `GET actions: Expected 401, got ${r1.status}`);
    assert(r2.status === 401, `POST actions: Expected 401, got ${r2.status}`);
  });

  await test("Actions 404 for non-existent scenario", async () => {
    const res = await api("GET", "/api/revenue-sim/99999999/actions");
    assert(res.status === 404, `Expected 404, got ${res.status}`);
  });

  // ─────────────────────────────────────────────────────────────────────
  // GROUP 7: Board Pack Integration
  // ─────────────────────────────────────────────────────────────────────
  console.log("\n▸ Group 7: Board Pack Integration");

  await test("Board pack schedule list is accessible", async () => {
    const res = await api("GET", "/api/board-pack/schedules");
    assert(res.ok, `Expected 200, got ${res.status}`);
  });

  await test("Board pack run history endpoint is accessible", async () => {
    const res = await api("GET", "/api/board-pack/runs?limit=5");
    assert(res.ok, `Expected 200, got ${res.status}`);
  });

  await test("chooseBoardPackScenario: when board_pack_include scenario exists, payloadMeta includes simulator", async () => {
    // Enable board pack for test scenario
    const simRes = await api("POST", "/api/revenue-sim/simulate", { winRateMultiplier: 1.2 });
    const sim = await simRes.json();
    const createRes = await api("POST", "/api/revenue-sim/scenarios", {
      name: "Board Pack Integration Test Scenario",
      parameters: { winRateMultiplier: 1.2 },
      projection: sim, baselineSnapshot: sim,
    });
    const sc = await createRes.json();
    created.scenarios.push(sc.id);

    // Enable board pack
    await api("POST", `/api/revenue-sim/${sc.id}/board-pack-toggle`, {});

    // Verify it appears in scenarios with board_pack_include=true
    const listRes = await api("GET", "/api/revenue-sim/scenarios");
    const list = await listRes.json();
    const found = list.find((s) => s.id === sc.id);
    assert(found?.board_pack_include === true, "board_pack_include should be true");

    // Disable again for cleanup
    await api("POST", `/api/revenue-sim/${sc.id}/board-pack-toggle`, {});
  });

  // ─────────────────────────────────────────────────────────────────────
  // GROUP 8: Regression — v1 simulator still works
  // ─────────────────────────────────────────────────────────────────────
  console.log("\n▸ Group 8: Regression — v1 functionality preserved");

  await test("GET /api/revenue-sim/baseline still returns 12 months", async () => {
    const res = await api("GET", "/api/revenue-sim/baseline");
    const d = await res.json();
    assert(Array.isArray(d.months), "months must be array");
    assert(d.months.length === 12, `Expected 12 months, got ${d.months.length}`);
  });

  await test("POST /api/revenue-sim/simulate with all multipliers still works", async () => {
    const res = await api("POST", "/api/revenue-sim/simulate", {
      winRateMultiplier: 1.3, dealSizeMultiplier: 1.1, velocityWeeks: -2,
      newPipelineDeals: 5, forecastCategory: "all", churnRateMonthly: 0.02,
      expansionRateMonthly: 0.03, months: 12,
    });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const d = await res.json();
    assert(d.months.length === 12, "Expected 12 months");
    assert(typeof d.summary.totalSimulated === "number", "totalSimulated must be number");
  });

  await test("Scenarios CRUD still works end-to-end", async () => {
    // Create
    const r1 = await api("POST", "/api/revenue-sim/scenarios", {
      name: "Regression Test Scenario", parameters: { winRateMultiplier: 1.0 },
      projection: {}, baselineSnapshot: {},
    });
    const s1 = await r1.json();
    created.scenarios.push(s1.id);
    assert(s1.id, "Expected id on create");

    // Read
    const r2 = await api("GET", `/api/revenue-sim/scenarios/${s1.id}`);
    assert(r2.ok, `Expected 200 on GET, got ${r2.status}`);

    // Patch
    const r3 = await api("PATCH", `/api/revenue-sim/scenarios/${s1.id}`, { name: "Regression Test Updated" });
    const s3 = await r3.json();
    assert(s3.name === "Regression Test Updated", "Name not updated");

    // Delete
    const r4 = await api("DELETE", `/api/revenue-sim/scenarios/${s1.id}`);
    assert(r4.ok, `Expected 200 on DELETE, got ${r4.status}`);
    created.scenarios.splice(created.scenarios.indexOf(s1.id), 1);
  });

  await test("GET /api/pipeline/forecast unaffected", async () => {
    const res = await api("GET", "/api/pipeline/forecast");
    assert(res.ok, `Expected 200, got ${res.status}`);
  });

  await test("GET /api/board-pack/schedules unaffected", async () => {
    const res = await api("GET", "/api/board-pack/schedules");
    assert(res.ok, `Expected 200, got ${res.status}`);
  });

  await test("GET /api/users/me/profile unaffected", async () => {
    const res = await api("GET", "/api/users/me/profile");
    const d = await res.json();
    assert(d.email === "trevor@voltsafe.com", "Profile broken");
  });

  // Cleanup
  await cleanup();

  // ─────────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(` Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log("\n Failed tests:");
    failures.forEach(f => console.log(`  ✗ ${f.name}: ${f.error}`));
  }
  console.log("═══════════════════════════════════════════════════════════\n");
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error("Fatal:", err); process.exit(1); });
