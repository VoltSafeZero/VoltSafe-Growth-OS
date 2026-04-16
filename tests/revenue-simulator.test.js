/**
 * Smart Revenue Simulator — Integration Tests
 * ~45 tests covering: baseline, simulation engine, CRUD scenarios, auth guards
 *
 * Usage: node tests/revenue-simulator.test.js
 */

const BASE = "http://localhost:5000";

// ── Auth helper ──────────────────────────────────────────────────────────────

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
  return { ...opts, headers: { ...(opts.headers || {}), Cookie: sessionCookie } };
}

async function api(method, path, body) {
  const opts = authed({
    method,
    headers: { "Content-Type": "application/json" },
  });
  if (body !== undefined) opts.body = JSON.stringify(body);
  return fetch(`${BASE}${path}`, opts);
}

// ── Test runner ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    → ${err.message}`);
    failed++;
    failures.push({ name, error: err.message });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "Assertion failed");
}

function assertClose(a, b, tol = 0.05, msg) {
  const pct = Math.abs(a - b) / (Math.abs(b) || 1);
  if (pct > tol) throw new Error(msg || `Expected ${a} ≈ ${b} (±${tol * 100}%)`);
}

// ── Cleanup helper ───────────────────────────────────────────────────────────

const createdScenarios = [];

async function cleanupScenarios() {
  for (const id of createdScenarios) {
    await api("DELETE", `/api/revenue-sim/scenarios/${id}`).catch(() => {});
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

async function run() {
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(" Smart Revenue Simulator — Integration Tests");
  console.log("═══════════════════════════════════════════════════════════\n");

  await login();

  // ─────────────────────────────────────────────────────────────────────
  // GROUP 1: Baseline endpoint
  // ─────────────────────────────────────────────────────────────────────
  console.log("▸ Group 1: Baseline endpoint");

  await test("GET /api/revenue-sim/baseline returns 200", async () => {
    const res = await api("GET", "/api/revenue-sim/baseline");
    assert(res.ok, `Expected 200, got ${res.status}`);
  });

  await test("Baseline has months array", async () => {
    const res = await api("GET", "/api/revenue-sim/baseline");
    const data = await res.json();
    assert(Array.isArray(data.months), "Expected months array");
    assert(data.months.length === 12, `Expected 12 months, got ${data.months.length}`);
  });

  await test("Baseline months have required fields", async () => {
    const res = await api("GET", "/api/revenue-sim/baseline");
    const data = await res.json();
    const m = data.months[0];
    assert("month" in m, "Missing month key");
    assert("label" in m, "Missing label key");
    assert("baseline" in m, "Missing baseline key");
    assert("simulated" in m, "Missing simulated key");
    assert("delta" in m, "Missing delta key");
    assert("deltaPct" in m, "Missing deltaPct key");
    assert("dealCount" in m, "Missing dealCount key");
  });

  await test("Baseline has summary object", async () => {
    const res = await api("GET", "/api/revenue-sim/baseline");
    const data = await res.json();
    assert(data.summary, "Missing summary");
    assert("totalBaseline" in data.summary, "Missing totalBaseline");
    assert("totalSimulated" in data.summary, "Missing totalSimulated");
    assert("totalDelta" in data.summary, "Missing totalDelta");
    assert("peakMonth" in data.summary, "Missing peakMonth");
    assert("dealsIncluded" in data.summary, "Missing dealsIncluded");
  });

  await test("Baseline delta is zero (no params applied)", async () => {
    const res = await api("GET", "/api/revenue-sim/baseline");
    const data = await res.json();
    assert(data.summary.totalDelta === 0, `Expected totalDelta=0, got ${data.summary.totalDelta}`);
  });

  await test("Baseline accepts ?months=6 parameter", async () => {
    const res = await api("GET", "/api/revenue-sim/baseline?months=6");
    const data = await res.json();
    assert(data.months.length === 6, `Expected 6 months, got ${data.months.length}`);
  });

  await test("Baseline months are in chronological order", async () => {
    const res = await api("GET", "/api/revenue-sim/baseline");
    const data = await res.json();
    for (let i = 1; i < data.months.length; i++) {
      assert(
        data.months[i].month >= data.months[i - 1].month,
        `Month order broken at index ${i}: ${data.months[i - 1].month} > ${data.months[i].month}`,
      );
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GROUP 2: Simulation — identity (no changes)
  // ─────────────────────────────────────────────────────────────────────
  console.log("\n▸ Group 2: Simulation — identity params");

  await test("POST /api/revenue-sim/simulate returns 200", async () => {
    const res = await api("POST", "/api/revenue-sim/simulate", {});
    assert(res.ok, `Expected 200, got ${res.status}`);
  });

  await test("Identity params produce result close to baseline", async () => {
    const [bRes, sRes] = await Promise.all([
      api("GET", "/api/revenue-sim/baseline"),
      api("POST", "/api/revenue-sim/simulate", {
        winRateMultiplier: 1.0,
        dealSizeMultiplier: 1.0,
        velocityWeeks: 0,
        newPipelineDeals: 0,
        forecastCategory: "all",
        churnRateMonthly: 0,
        expansionRateMonthly: 0,
        months: 12,
      }),
    ]);
    const bData = await bRes.json();
    const sData = await sRes.json();
    assertClose(sData.summary.totalSimulated, bData.summary.totalBaseline, 0.05,
      `Identity sim ${sData.summary.totalSimulated} not close to baseline ${bData.summary.totalBaseline}`);
  });

  await test("Simulation returns 12 months by default", async () => {
    const res = await api("POST", "/api/revenue-sim/simulate", {});
    const data = await res.json();
    assert(data.months.length === 12, `Expected 12 months, got ${data.months.length}`);
  });

  await test("Simulation returns correct shape", async () => {
    const res = await api("POST", "/api/revenue-sim/simulate", {});
    const data = await res.json();
    assert(Array.isArray(data.months), "months not array");
    assert(typeof data.summary === "object", "summary not object");
    assert(typeof data.summary.totalBaseline === "number", "totalBaseline not number");
    assert(typeof data.summary.totalSimulated === "number", "totalSimulated not number");
    assert(typeof data.summary.totalDelta === "number", "totalDelta not number");
    assert(typeof data.summary.deltaPct === "number", "deltaPct not number");
  });

  // ─────────────────────────────────────────────────────────────────────
  // GROUP 3: Win Rate multiplier
  // ─────────────────────────────────────────────────────────────────────
  console.log("\n▸ Group 3: Win Rate multiplier");

  await test("winRateMultiplier > 1 increases simulated revenue", async () => {
    const [r1, r2] = await Promise.all([
      api("POST", "/api/revenue-sim/simulate", { winRateMultiplier: 1.0 }),
      api("POST", "/api/revenue-sim/simulate", { winRateMultiplier: 1.5 }),
    ]);
    const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
    assert(d2.summary.totalSimulated > d1.summary.totalSimulated,
      `Expected higher revenue with 1.5× win rate (${d2.summary.totalSimulated} vs ${d1.summary.totalSimulated})`);
  });

  await test("winRateMultiplier < 1 decreases simulated revenue", async () => {
    const [r1, r2] = await Promise.all([
      api("POST", "/api/revenue-sim/simulate", { winRateMultiplier: 1.0 }),
      api("POST", "/api/revenue-sim/simulate", { winRateMultiplier: 0.5 }),
    ]);
    const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
    assert(d2.summary.totalSimulated < d1.summary.totalSimulated,
      `Expected lower revenue with 0.5× win rate (${d2.summary.totalSimulated} vs ${d1.summary.totalSimulated})`);
  });

  await test("winRateMultiplier=2.0 delta is positive", async () => {
    const res = await api("POST", "/api/revenue-sim/simulate", { winRateMultiplier: 2.0 });
    const data = await res.json();
    // delta can be 0 if no deals, but never negative
    assert(data.summary.totalDelta >= 0,
      `Expected non-negative delta with 2.0× win rate, got ${data.summary.totalDelta}`);
  });

  // ─────────────────────────────────────────────────────────────────────
  // GROUP 4: Deal size multiplier
  // ─────────────────────────────────────────────────────────────────────
  console.log("\n▸ Group 4: Deal size multiplier");

  await test("dealSizeMultiplier > 1 increases revenue", async () => {
    const [r1, r2] = await Promise.all([
      api("POST", "/api/revenue-sim/simulate", { dealSizeMultiplier: 1.0 }),
      api("POST", "/api/revenue-sim/simulate", { dealSizeMultiplier: 2.0 }),
    ]);
    const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
    assert(d2.summary.totalSimulated >= d1.summary.totalSimulated,
      `Expected ≥ revenue with 2× deal size (${d2.summary.totalSimulated} vs ${d1.summary.totalSimulated})`);
  });

  await test("dealSizeMultiplier < 1 decreases revenue", async () => {
    const [r1, r2] = await Promise.all([
      api("POST", "/api/revenue-sim/simulate", { dealSizeMultiplier: 1.0 }),
      api("POST", "/api/revenue-sim/simulate", { dealSizeMultiplier: 0.5 }),
    ]);
    const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
    assert(d2.summary.totalSimulated <= d1.summary.totalSimulated,
      `Expected ≤ revenue with 0.5× deal size (${d2.summary.totalSimulated} vs ${d1.summary.totalSimulated})`);
  });

  await test("Combined 2× win rate + 2× deal size gives largest revenue", async () => {
    const [r1, r2] = await Promise.all([
      api("POST", "/api/revenue-sim/simulate", { winRateMultiplier: 1.0, dealSizeMultiplier: 1.0 }),
      api("POST", "/api/revenue-sim/simulate", { winRateMultiplier: 2.0, dealSizeMultiplier: 2.0 }),
    ]);
    const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
    assert(d2.summary.totalSimulated >= d1.summary.totalSimulated,
      `Combined 2× multipliers should give ≥ revenue (${d2.summary.totalSimulated} vs ${d1.summary.totalSimulated})`);
  });

  // ─────────────────────────────────────────────────────────────────────
  // GROUP 5: Velocity shift
  // ─────────────────────────────────────────────────────────────────────
  console.log("\n▸ Group 5: Velocity shift");

  await test("velocityWeeks=0 produces same total as baseline", async () => {
    const [bRes, sRes] = await Promise.all([
      api("GET", "/api/revenue-sim/baseline"),
      api("POST", "/api/revenue-sim/simulate", { velocityWeeks: 0 }),
    ]);
    const [bData, sData] = await Promise.all([bRes.json(), sRes.json()]);
    assertClose(sData.summary.totalSimulated, bData.summary.totalBaseline, 0.05,
      `Zero velocity should match baseline closely`);
  });

  await test("Large positive velocity shifts deals out of 12-month window → lower total", async () => {
    const [r1, r2] = await Promise.all([
      api("POST", "/api/revenue-sim/simulate", { velocityWeeks: 0, months: 12 }),
      api("POST", "/api/revenue-sim/simulate", { velocityWeeks: 26, months: 12 }),
    ]);
    const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
    assert(d2.summary.totalSimulated <= d1.summary.totalSimulated,
      `Large positive velocity should reduce 12-mo total (${d2.summary.totalSimulated} vs ${d1.summary.totalSimulated})`);
  });

  await test("Velocity shift preserves month array length", async () => {
    const res = await api("POST", "/api/revenue-sim/simulate", { velocityWeeks: 4 });
    const data = await res.json();
    assert(data.months.length === 12, `Expected 12 months, got ${data.months.length}`);
  });

  // ─────────────────────────────────────────────────────────────────────
  // GROUP 6: New pipeline deals
  // ─────────────────────────────────────────────────────────────────────
  console.log("\n▸ Group 6: New pipeline deals");

  await test("newPipelineDeals > 0 increases simulated revenue", async () => {
    const [r1, r2] = await Promise.all([
      api("POST", "/api/revenue-sim/simulate", { newPipelineDeals: 0 }),
      api("POST", "/api/revenue-sim/simulate", { newPipelineDeals: 10 }),
    ]);
    const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
    assert(d2.summary.totalSimulated >= d1.summary.totalSimulated,
      `10 new deals should give ≥ revenue (${d2.summary.totalSimulated} vs ${d1.summary.totalSimulated})`);
  });

  await test("newPipelineDeals=0 does not change baseline", async () => {
    const [bRes, sRes] = await Promise.all([
      api("GET", "/api/revenue-sim/baseline"),
      api("POST", "/api/revenue-sim/simulate", { newPipelineDeals: 0 }),
    ]);
    const [bData, sData] = await Promise.all([bRes.json(), sRes.json()]);
    assertClose(sData.summary.totalSimulated, bData.summary.totalBaseline, 0.05,
      "Zero new deals should not change total significantly");
  });

  await test("newPipelineAvgSize override is respected", async () => {
    const [r1, r2] = await Promise.all([
      api("POST", "/api/revenue-sim/simulate", { newPipelineDeals: 10, newPipelineAvgSize: 1000 }),
      api("POST", "/api/revenue-sim/simulate", { newPipelineDeals: 10, newPipelineAvgSize: 100000 }),
    ]);
    const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
    assert(d2.summary.totalSimulated > d1.summary.totalSimulated,
      `Larger avgSize should give more revenue (${d2.summary.totalSimulated} vs ${d1.summary.totalSimulated})`);
  });

  // ─────────────────────────────────────────────────────────────────────
  // GROUP 7: Forecast category filter
  // ─────────────────────────────────────────────────────────────────────
  console.log("\n▸ Group 7: Forecast category filter");

  await test("forecastCategory=all does not error", async () => {
    const res = await api("POST", "/api/revenue-sim/simulate", { forecastCategory: "all" });
    assert(res.ok, `Expected 200, got ${res.status}`);
  });

  await test("forecastCategory=commit does not error", async () => {
    const res = await api("POST", "/api/revenue-sim/simulate", { forecastCategory: "commit" });
    assert(res.ok, `Expected 200, got ${res.status}`);
  });

  await test("forecastCategory=commit_best_case does not error", async () => {
    const res = await api("POST", "/api/revenue-sim/simulate", { forecastCategory: "commit_best_case" });
    assert(res.ok, `Expected 200, got ${res.status}`);
  });

  await test("commit filter gives ≤ revenue than all", async () => {
    const [r1, r2] = await Promise.all([
      api("POST", "/api/revenue-sim/simulate", { forecastCategory: "all" }),
      api("POST", "/api/revenue-sim/simulate", { forecastCategory: "commit" }),
    ]);
    const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
    assert(d2.summary.dealsIncluded <= d1.summary.dealsIncluded,
      `Commit filter should have ≤ deals (${d2.summary.dealsIncluded} vs ${d1.summary.dealsIncluded})`);
  });

  // ─────────────────────────────────────────────────────────────────────
  // GROUP 8: Churn and expansion rates
  // ─────────────────────────────────────────────────────────────────────
  console.log("\n▸ Group 8: Churn and expansion rates");

  await test("churnRateMonthly > 0 reduces revenue vs zero churn", async () => {
    const [r1, r2] = await Promise.all([
      api("POST", "/api/revenue-sim/simulate", { churnRateMonthly: 0 }),
      api("POST", "/api/revenue-sim/simulate", { churnRateMonthly: 0.05 }),
    ]);
    const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
    assert(d2.summary.totalSimulated <= d1.summary.totalSimulated,
      `Churn should reduce revenue (${d2.summary.totalSimulated} vs ${d1.summary.totalSimulated})`);
  });

  await test("expansionRateMonthly > 0 increases revenue vs zero expansion", async () => {
    const [r1, r2] = await Promise.all([
      api("POST", "/api/revenue-sim/simulate", { expansionRateMonthly: 0 }),
      api("POST", "/api/revenue-sim/simulate", { expansionRateMonthly: 0.05 }),
    ]);
    const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
    assert(d2.summary.totalSimulated >= d1.summary.totalSimulated,
      `Expansion should increase revenue (${d2.summary.totalSimulated} vs ${d1.summary.totalSimulated})`);
  });

  await test("churn and expansion combined: expansion > churn = net positive", async () => {
    const [r1, r2] = await Promise.all([
      api("POST", "/api/revenue-sim/simulate", { churnRateMonthly: 0, expansionRateMonthly: 0 }),
      api("POST", "/api/revenue-sim/simulate", { churnRateMonthly: 0.02, expansionRateMonthly: 0.10 }),
    ]);
    const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
    assert(d2.summary.totalSimulated >= d1.summary.totalSimulated,
      `Net positive expansion (10% - 2%) should increase revenue`);
  });

  // ─────────────────────────────────────────────────────────────────────
  // GROUP 9: Projection horizon
  // ─────────────────────────────────────────────────────────────────────
  console.log("\n▸ Group 9: Projection horizon");

  await test("months=6 returns 6-month projection", async () => {
    const res = await api("POST", "/api/revenue-sim/simulate", { months: 6 });
    const data = await res.json();
    assert(data.months.length === 6, `Expected 6 months, got ${data.months.length}`);
  });

  await test("months=3 returns 3-month projection", async () => {
    const res = await api("POST", "/api/revenue-sim/simulate", { months: 3 });
    const data = await res.json();
    assert(data.months.length === 3, `Expected 3 months, got ${data.months.length}`);
  });

  await test("months=24 returns 24-month projection", async () => {
    const res = await api("POST", "/api/revenue-sim/simulate", { months: 24 });
    const data = await res.json();
    assert(data.months.length === 24, `Expected 24 months, got ${data.months.length}`);
  });

  await test("longer horizon includes more total weighted revenue", async () => {
    const [r1, r2] = await Promise.all([
      api("POST", "/api/revenue-sim/simulate", { months: 6 }),
      api("POST", "/api/revenue-sim/simulate", { months: 12 }),
    ]);
    const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
    assert(d2.summary.totalBaseline >= d1.summary.totalBaseline,
      `12-month baseline should be ≥ 6-month (${d2.summary.totalBaseline} vs ${d1.summary.totalBaseline})`);
  });

  // ─────────────────────────────────────────────────────────────────────
  // GROUP 10: CRUD — Scenarios
  // ─────────────────────────────────────────────────────────────────────
  console.log("\n▸ Group 10: CRUD — Scenarios");

  let savedScenarioId = null;

  await test("GET /api/revenue-sim/scenarios returns array", async () => {
    const res = await api("GET", "/api/revenue-sim/scenarios");
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data), "Expected array of scenarios");
  });

  await test("POST /api/revenue-sim/scenarios creates scenario", async () => {
    const simRes = await api("POST", "/api/revenue-sim/simulate", { winRateMultiplier: 1.2 });
    const sim = await simRes.json();

    const res = await api("POST", "/api/revenue-sim/scenarios", {
      name: "Test Scenario — Win Rate +20%",
      description: "Auto-created by revenue-simulator tests",
      parameters: { winRateMultiplier: 1.2 },
      projection: sim,
      baselineSnapshot: sim,
    });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    const data = await res.json();
    assert(data.id, "Expected id in response");
    assert(data.name === "Test Scenario — Win Rate +20%", "Name mismatch");
    savedScenarioId = data.id;
    createdScenarios.push(data.id);
  });

  await test("GET /api/revenue-sim/scenarios/:id returns the saved scenario", async () => {
    assert(savedScenarioId, "No saved scenario ID from prior test");
    const res = await api("GET", `/api/revenue-sim/scenarios/${savedScenarioId}`);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.id === savedScenarioId, "ID mismatch");
    assert(data.name === "Test Scenario — Win Rate +20%", "Name mismatch");
  });

  await test("GET /api/revenue-sim/scenarios lists the saved scenario", async () => {
    const res = await api("GET", "/api/revenue-sim/scenarios");
    const data = await res.json();
    const found = data.find(s => s.id === savedScenarioId);
    assert(found, "Saved scenario not found in list");
  });

  await test("PATCH /api/revenue-sim/scenarios/:id updates name", async () => {
    assert(savedScenarioId, "No saved scenario ID");
    const res = await api("PATCH", `/api/revenue-sim/scenarios/${savedScenarioId}`, {
      name: "Test Scenario — Updated Name",
    });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.name === "Test Scenario — Updated Name", "Name not updated");
  });

  await test("PATCH /api/revenue-sim/scenarios/:id updates description", async () => {
    assert(savedScenarioId, "No saved scenario ID");
    const res = await api("PATCH", `/api/revenue-sim/scenarios/${savedScenarioId}`, {
      description: "Updated description from test",
    });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.description === "Updated description from test", "Description not updated");
  });

  await test("PATCH /api/revenue-sim/scenarios/:id updates parameters", async () => {
    assert(savedScenarioId, "No saved scenario ID");
    const newParams = { winRateMultiplier: 1.5, dealSizeMultiplier: 1.3 };
    const res = await api("PATCH", `/api/revenue-sim/scenarios/${savedScenarioId}`, {
      parameters: newParams,
    });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.parameters?.winRateMultiplier === 1.5, "winRateMultiplier not updated");
  });

  await test("DELETE /api/revenue-sim/scenarios/:id removes scenario", async () => {
    assert(savedScenarioId, "No saved scenario ID");
    const delRes = await api("DELETE", `/api/revenue-sim/scenarios/${savedScenarioId}`);
    assert(delRes.ok, `Expected 200 on delete, got ${delRes.status}`);

    const getRes = await api("GET", `/api/revenue-sim/scenarios/${savedScenarioId}`);
    assert(getRes.status === 404, `Expected 404 after delete, got ${getRes.status}`);

    createdScenarios.splice(createdScenarios.indexOf(savedScenarioId), 1);
    savedScenarioId = null;
  });

  await test("POST scenarios — name is required", async () => {
    const res = await api("POST", "/api/revenue-sim/scenarios", {
      description: "Missing name",
      parameters: {},
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  await test("Multiple scenarios can be saved independently", async () => {
    const [r1, r2] = await Promise.all([
      api("POST", "/api/revenue-sim/scenarios", {
        name: "Multi Test A", parameters: { winRateMultiplier: 1.1 },
        projection: {}, baselineSnapshot: {},
      }),
      api("POST", "/api/revenue-sim/scenarios", {
        name: "Multi Test B", parameters: { winRateMultiplier: 0.8 },
        projection: {}, baselineSnapshot: {},
      }),
    ]);
    const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
    assert(d1.id !== d2.id, "Expected different IDs for concurrent saves");
    createdScenarios.push(d1.id, d2.id);
  });

  // ─────────────────────────────────────────────────────────────────────
  // GROUP 11: Auth guards
  // ─────────────────────────────────────────────────────────────────────
  console.log("\n▸ Group 11: Auth guards");

  async function unauthFetch(method, path, body) {
    const opts = { method, headers: { "Content-Type": "application/json" } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(`${BASE}${path}`, opts);
  }

  await test("GET /api/revenue-sim/baseline requires auth", async () => {
    const res = await unauthFetch("GET", "/api/revenue-sim/baseline");
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await test("POST /api/revenue-sim/simulate requires auth", async () => {
    const res = await unauthFetch("POST", "/api/revenue-sim/simulate", {});
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await test("GET /api/revenue-sim/scenarios requires auth", async () => {
    const res = await unauthFetch("GET", "/api/revenue-sim/scenarios");
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await test("POST /api/revenue-sim/scenarios requires auth", async () => {
    const res = await unauthFetch("POST", "/api/revenue-sim/scenarios", { name: "Ghost" });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await test("GET scenario by ID — 404 for non-existent", async () => {
    const res = await api("GET", "/api/revenue-sim/scenarios/99999999");
    assert(res.status === 404, `Expected 404, got ${res.status}`);
  });

  await test("DELETE scenario — 404 for non-existent", async () => {
    const res = await api("DELETE", "/api/revenue-sim/scenarios/99999999");
    assert(res.status === 404, `Expected 404, got ${res.status}`);
  });

  await test("PATCH scenario — 404 for non-existent", async () => {
    const res = await api("PATCH", "/api/revenue-sim/scenarios/99999999", { name: "Ghost" });
    assert(res.status === 404, `Expected 404, got ${res.status}`);
  });

  // ─────────────────────────────────────────────────────────────────────
  // GROUP 12: Regression — existing routes unaffected
  // ─────────────────────────────────────────────────────────────────────
  console.log("\n▸ Group 12: Regression — existing routes unaffected");

  await test("GET /api/pipeline/forecast still works", async () => {
    const res = await api("GET", "/api/pipeline/forecast");
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.periods !== undefined || Array.isArray(data), "Unexpected pipeline/forecast shape");
  });

  await test("GET /api/opportunities still works", async () => {
    const res = await api("GET", "/api/opportunities");
    assert(res.ok, `Expected 200, got ${res.status}`);
  });

  await test("GET /api/board-pack/schedules still works", async () => {
    const res = await api("GET", "/api/board-pack/schedules");
    assert(res.ok, `Expected 200, got ${res.status}`);
  });

  await test("GET /api/users/me/profile still works", async () => {
    const res = await api("GET", "/api/users/me/profile");
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.email === "trevor@voltsafe.com", "Profile email mismatch");
  });

  // ─────────────────────────────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────────────────────────────
  await cleanupScenarios();

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

run().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
