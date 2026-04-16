/**
 * Live Test Tracker — API + Integration Tests (Phase 7)
 * Covers: sheet config save, tab selector config, summary data, regressions.
 * Run with: node tests/live-tracker.test.js
 * Requires: server running at localhost:5000
 */

const BASE = "http://localhost:5000";
let cookie = "";
let certProjectId = null;
let regularProjectId = null;

async function req(method, path, body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    credentials: "include",
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  if (r.headers.get("set-cookie")) cookie = r.headers.get("set-cookie").split(";")[0];
  let json;
  try { json = await r.json(); } catch { json = {}; }
  return { status: r.status, body: json };
}

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function run() {
  let passed = 0, failed = 0;
  const results = [];

  async function test(name, fn) {
    try {
      await fn();
      results.push({ name, ok: true });
      passed++;
    } catch (e) {
      results.push({ name, ok: false, error: e.message });
      failed++;
    }
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  await test("login as trevor@voltsafe.com", async () => {
    const r = await req("POST", "/api/auth/login", { email: "trevor@voltsafe.com", password: "alberni1444" });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
  });

  // ── Fixture: create a fresh cert project for tracker tests ────────────────
  await test("POST /api/projects — create cert project for tracker tests", async () => {
    const r = await req("POST", "/api/projects", {
      name: "VoltSafe Marine 3.0 Tracker Test",
      type: "certification",
      status: "active",
      description: "Integration test project for the live tracker feature.",
    });
    assert(r.status === 201, `Expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.id, "No id returned");
    assert(r.body.type === "certification", "Expected type=certification");
    certProjectId = r.body.id;
  });

  await test("POST /api/projects — create pilot project (regression guard)", async () => {
    const r = await req("POST", "/api/projects", {
      name: "Regression Pilot",
      type: "pilot",
      status: "active",
    });
    assert(r.status === 201, `Expected 201, got ${r.status}`);
    regularProjectId = r.body.id;
  });

  // ── Phase 1: Sheet source config saves ────────────────────────────────────
  await test("POST /api/projects/:id/certification — save tracker sheet URL", async () => {
    const sheetUrl = "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/edit#gid=0";
    const config = {
      defaultGid: "0",
      tabs: [
        { name: "Test Log", gid: "0" },
        { name: "Summary", gid: "123456" },
        { name: "Retests", gid: "789012" },
      ],
      columnMap: { status: "Status", result: "Result", blocker: "Blocker", retest: "Retest", dueDate: "Due Date" },
      alertHooks: { failedTest: true, blocker: true, retestRequired: false, certRisk: false },
    };
    const r = await req("POST", `/api/projects/${certProjectId}/certification`, {
      trackerSheetUrl: sheetUrl,
      trackerSheetConfig: JSON.stringify(config),
    });
    assert(r.status === 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.tracker_sheet_url === sheetUrl, `tracker_sheet_url mismatch: ${r.body.tracker_sheet_url}`);
    assert(r.body.tracker_sheet_config !== null, "tracker_sheet_config should not be null");
  });

  // ── Phase 1: GET certification — tracker fields returned ──────────────────
  await test("GET /api/projects/:id/certification — tracker_sheet_url present", async () => {
    const r = await req("GET", `/api/projects/${certProjectId}/certification`);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(typeof r.body.tracker_sheet_url === "string", "tracker_sheet_url should be a string");
    assert(r.body.tracker_sheet_url.includes("spreadsheets/d/"), "tracker_sheet_url looks wrong");
  });

  await test("GET /api/projects/:id/certification — tracker_sheet_config is valid JSON with tabs", async () => {
    const r = await req("GET", `/api/projects/${certProjectId}/certification`);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(typeof r.body.tracker_sheet_config === "string", "tracker_sheet_config should be a JSON string");
    const config = JSON.parse(r.body.tracker_sheet_config);
    assert(Array.isArray(config.tabs), "config.tabs should be an array");
    assert(config.tabs.length === 3, `Expected 3 tabs, got ${config.tabs.length}`);
    assert(config.tabs[0].name === "Test Log", `First tab name mismatch: ${config.tabs[0].name}`);
    assert(config.tabs[0].gid === "0", `First tab gid mismatch: ${config.tabs[0].gid}`);
    assert(config.tabs[1].gid === "123456", `Second tab gid mismatch: ${config.tabs[1].gid}`);
  });

  await test("GET /api/projects/:id/certification — defaultGid stored in config", async () => {
    const r = await req("GET", `/api/projects/${certProjectId}/certification`);
    const config = JSON.parse(r.body.tracker_sheet_config);
    assert(config.defaultGid === "0", `defaultGid mismatch: ${config.defaultGid}`);
  });

  // ── Phase 4: Column mapping stored ───────────────────────────────────────
  await test("GET /api/projects/:id/certification — columnMap stored in config", async () => {
    const r = await req("GET", `/api/projects/${certProjectId}/certification`);
    const config = JSON.parse(r.body.tracker_sheet_config);
    assert(config.columnMap, "columnMap should exist");
    assert(config.columnMap.status === "Status", `columnMap.status mismatch: ${config.columnMap.status}`);
    assert(config.columnMap.result === "Result", `columnMap.result mismatch: ${config.columnMap.result}`);
    assert(config.columnMap.blocker === "Blocker", `columnMap.blocker mismatch`);
    assert(config.columnMap.dueDate === "Due Date", `columnMap.dueDate mismatch`);
  });

  // ── Phase 5: Alert hooks stored ───────────────────────────────────────────
  await test("GET /api/projects/:id/certification — alertHooks stored in config", async () => {
    const r = await req("GET", `/api/projects/${certProjectId}/certification`);
    const config = JSON.parse(r.body.tracker_sheet_config);
    assert(config.alertHooks, "alertHooks should exist");
    assert(config.alertHooks.failedTest === true, "alertHooks.failedTest should be true");
    assert(config.alertHooks.blocker === true, "alertHooks.blocker should be true");
    assert(config.alertHooks.retestRequired === false, "alertHooks.retestRequired should be false");
    assert(config.alertHooks.certRisk === false, "alertHooks.certRisk should be false");
  });

  // ── Phase 4: Update tab config (PUT — full overwrite) ─────────────────────
  await test("PUT /api/projects/:id/certification — update tracker config", async () => {
    const newConfig = {
      defaultGid: "123456",
      tabs: [
        { name: "Master Log", gid: "0" },
        { name: "Summary View", gid: "123456" },
      ],
      columnMap: { status: "Test Status", result: "Pass/Fail", blocker: "Blocker?", retest: "Retest?", dueDate: "Target Date" },
      alertHooks: { failedTest: true, blocker: true, retestRequired: true, certRisk: false },
    };
    const r = await req("PUT", `/api/projects/${certProjectId}/certification`, {
      trackerSheetConfig: JSON.stringify(newConfig),
    });
    assert(r.status === 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    const config = JSON.parse(r.body.tracker_sheet_config);
    assert(config.defaultGid === "123456", `defaultGid not updated: ${config.defaultGid}`);
    assert(config.tabs.length === 2, `Expected 2 tabs after update, got ${config.tabs.length}`);
    assert(config.alertHooks.retestRequired === true, "alertHooks.retestRequired not updated");
  });

  // ── Phase 3: Summary data — milestones for cert project ──────────────────
  await test("GET /api/projects/:id/milestones — milestones available for summary panel", async () => {
    const r = await req("GET", `/api/projects/${certProjectId}/milestones`);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.body), "Expected array of milestones");
  });

  await test("GET /api/projects/:id/certification — cert status fields present for summary", async () => {
    const r = await req("GET", `/api/projects/${certProjectId}/certification`);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert("certification_status" in r.body, "certification_status field missing");
    assert("overall_risk" in r.body, "overall_risk field missing");
    assert("launch_blocker" in r.body, "launch_blocker field missing");
    assert("retest_required" in r.body, "retest_required field missing");
    assert("failure_found" in r.body, "failure_found field missing");
  });

  // ── Regression: pilot project not affected ────────────────────────────────
  await test("GET /api/projects/:id/certification — regular project has no tracker data from cert project", async () => {
    const r = await req("GET", `/api/projects/${regularProjectId}/certification`);
    assert(r.status === 200 || r.status === 404, `Unexpected status: ${r.status}`);
    if (r.status === 200 && r.body) {
      const hasNoTrackerData = !r.body.tracker_sheet_url || r.body.tracker_sheet_url === null;
      assert(hasNoTrackerData, "Regular project should not have tracker_sheet_url from cert project");
    }
  });

  await test("GET /api/projects — project list still works (no regressions)", async () => {
    const r = await req("GET", "/api/projects");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.body), "Expected array");
    assert(r.body.length > 0, "Expected at least 1 project");
  });

  // ── Cleanup: remove test projects ─────────────────────────────────────────
  await test("DELETE cert test project — cleanup", async () => {
    if (!certProjectId) return;
    const r = await req("DELETE", `/api/projects/${certProjectId}`);
    assert(r.status === 200 || r.status === 204 || r.status === 404, `Unexpected status on delete: ${r.status}`);
  });

  await test("DELETE pilot test project — cleanup", async () => {
    if (!regularProjectId) return;
    const r = await req("DELETE", `/api/projects/${regularProjectId}`);
    assert(r.status === 200 || r.status === 204 || r.status === 404, `Unexpected status on delete: ${r.status}`);
  });

  // ── Results ───────────────────────────────────────────────────────────────
  console.log("\n── Live Test Tracker API Tests ──────────────────────────────");
  for (const { name, ok, error } of results) {
    console.log(`  ${ok ? "✓" : "✗"} ${name}${!ok ? ` — ${error}` : ""}`);
  }
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
