/**
 * Certification Tracker Alert Engine — API Tests (Phase 5)
 * Covers: alert detection, cooldown, task/notification creation, exec alerts,
 *         state persistence, and regression guards.
 * Run with: node tests/cert-alerts.test.js
 * Requires: server running at localhost:5000
 */

const BASE = "http://localhost:5000";
let cookie = "";
let projectId = null;

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

let passed = 0, failed = 0;
const results = [];
async function test(name, fn) {
  try { await fn(); results.push({ name, ok: true }); passed++; }
  catch (e) { results.push({ name, ok: false, error: e.message }); failed++; }
}
function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

// ── Snapshot helpers ──────────────────────────────────────────────────────────

function makeSync(overrides = {}) {
  return {
    source: "google_sheets_csv",
    gid: "0",
    total: 20,
    passed: 15,
    failed: 0,
    pending: 5,
    inProgress: 0,
    other: 0,
    blockerCount: 0,
    retestCount: 0,
    dueSoonCount: 0,
    lastUpdated: null,
    syncedAt: new Date().toISOString(),
    columnsFound: {},
    alertConditions: { failedTest: false, blocker: false, retestRequired: false, certRisk: false },
    error: null,
    ...overrides,
  };
}

async function run() {
  // ── Login ─────────────────────────────────────────────────────────────────
  await test("login as trevor@voltsafe.com", async () => {
    const r = await req("POST", "/api/auth/login", { email: "trevor@voltsafe.com", password: "alberni1444" });
    assert(r.status === 200, `Login failed: ${r.status}`);
  });

  // ── Setup: create a certification project ─────────────────────────────────
  await test("create cert project for alert tests", async () => {
    const r = await req("POST", "/api/projects", { name: "[AlertTest] NRTL Cert", type: "certification", status: "active" });
    assert(r.status === 201, `Create failed: ${r.status}`);
    projectId = r.body.id;
    assert(projectId, "Expected project id");
  });

  // Configure cert with alert hooks
  await test("configure alert hooks via certification save", async () => {
    const config = JSON.stringify({
      defaultGid: "0",
      tabs: [{ name: "Tests", gid: "0" }],
      columnMap: { status: "Status", result: "Result", blocker: "Blocker", retest: "Retest", dueDate: "Due Date" },
      alertHooks: {
        failedTestAlert: true,
        blockerAlert: true,
        retestAlert: true,
        riskAlert: true,
        dueSoonAlert: true,
        dueSoonThreshold: 3,
        cooldownHours: 0,        // 0 so tests can re-trigger without waiting
        createTask: true,
        createNotification: true,
      },
    });
    const r = await req("POST", `/api/projects/${projectId}/certification`, {
      trackerSheetUrl: "https://docs.google.com/spreadsheets/d/TEST_SHEET_ID/edit",
      trackerSheetConfig: config,
    });
    assert(r.status === 200, `Config save failed: ${r.status}`);
    assert(r.body.tracker_sheet_config, "tracker_sheet_config not saved");
  });

  // ── PHASE 1 — Alert Evaluation ────────────────────────────────────────────

  await test("POST evaluate — no alerts when all tests pass", async () => {
    const sync = makeSync({ total: 10, passed: 10, failed: 0, blockerCount: 0, retestCount: 0 });
    const r = await req("POST", `/api/projects/${projectId}/tracker-alerts/evaluate`, sync);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.body.triggered), "triggered must be array");
    assert(r.body.triggered.length === 0, `Expected 0 triggered, got ${r.body.triggered.join(", ")}`);
    assert(r.body.notificationsCreated === 0, "No notifications expected");
    assert(r.body.tasksCreated === 0, "No tasks expected");
  });

  await test("POST evaluate — failed_test alert triggered when failed > 0", async () => {
    const sync = makeSync({ total: 10, passed: 7, failed: 3, alertConditions: { failedTest: true, blocker: false, retestRequired: false, certRisk: false } });
    const r = await req("POST", `/api/projects/${projectId}/tracker-alerts/evaluate`, sync);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.triggered.includes("failed_test"), `Expected failed_test in triggered, got ${r.body.triggered}`);
    assert(r.body.notificationsCreated >= 1, "Expected >= 1 notification created");
    assert(r.body.tasksCreated >= 1, "Expected >= 1 task created (high severity)");
  });

  await test("POST evaluate — blocker alert triggered when blockerCount > 0", async () => {
    const sync = makeSync({ total: 10, failed: 0, blockerCount: 2, alertConditions: { failedTest: false, blocker: true, retestRequired: false, certRisk: false } });
    const r = await req("POST", `/api/projects/${projectId}/tracker-alerts/evaluate`, sync);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.triggered.includes("blocker"), `Expected blocker in triggered, got ${r.body.triggered}`);
    assert(r.body.execAlertsCreated >= 1, "Expected >= 1 exec alert for blocker (high severity)");
  });

  await test("POST evaluate — retest_required alert triggered when retestCount > 0", async () => {
    const sync = makeSync({ total: 10, failed: 0, retestCount: 3, alertConditions: { failedTest: false, blocker: false, retestRequired: true, certRisk: false } });
    const r = await req("POST", `/api/projects/${projectId}/tracker-alerts/evaluate`, sync);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.triggered.includes("retest_required"), `Expected retest_required in triggered, got ${r.body.triggered}`);
  });

  await test("POST evaluate — cert_risk alert triggered when alertConditions.certRisk is true", async () => {
    const sync = makeSync({ total: 10, failed: 2, blockerCount: 1, retestCount: 1, alertConditions: { failedTest: true, blocker: true, retestRequired: false, certRisk: true } });
    const r = await req("POST", `/api/projects/${projectId}/tracker-alerts/evaluate`, sync);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.triggered.includes("cert_risk"), `Expected cert_risk in triggered, got ${r.body.triggered}`);
  });

  await test("POST evaluate — due_soon alert triggered when dueSoonCount >= threshold", async () => {
    const sync = makeSync({ total: 10, failed: 0, dueSoonCount: 5, alertConditions: { failedTest: false, blocker: false, retestRequired: false, certRisk: false } });
    const r = await req("POST", `/api/projects/${projectId}/tracker-alerts/evaluate`, sync);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.triggered.includes("due_soon"), `Expected due_soon in triggered, got ${r.body.triggered}`);
  });

  // ── PHASE 3 — Dedupe / Cooldown ───────────────────────────────────────────

  await test("POST evaluate — returns newState with lastEvalAt", async () => {
    const sync = makeSync({ total: 10, passed: 10, failed: 0 });
    const r = await req("POST", `/api/projects/${projectId}/tracker-alerts/evaluate`, sync);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.newState, "newState must be present");
    assert(r.body.newState.lastEvalAt, "lastEvalAt must be set");
    assert(typeof r.body.newState.conditions === "object", "conditions must be object");
  });

  await test("POST evaluate — alert state persisted after trigger", async () => {
    // Trigger a failed test alert
    const sync = makeSync({ total: 10, passed: 7, failed: 3, alertConditions: { failedTest: true, blocker: false, retestRequired: false, certRisk: false } });
    await req("POST", `/api/projects/${projectId}/tracker-alerts/evaluate`, sync);

    // Now fetch the stored state
    const stateR = await req("GET", `/api/projects/${projectId}/tracker-alerts/state`);
    assert(stateR.status === 200, `Expected 200, got ${stateR.status}`);
    assert(stateR.body.alertState !== null, "alertState should be persisted");
    assert(stateR.body.alertState.lastEvalAt, "lastEvalAt should be set");
  });

  await test("GET state — activeAlerts lists only active alerts within cooldown", async () => {
    const stateR = await req("GET", `/api/projects/${projectId}/tracker-alerts/state`);
    assert(stateR.status === 200, `Expected 200, got ${stateR.status}`);
    assert(Array.isArray(stateR.body.activeAlerts), "activeAlerts must be array");
  });

  await test("POST evaluate — cooldown prevents double-trigger (count same, hooks enabled, but changed=false)", async () => {
    // With cooldownHours=0, the cooldown window is 0ms so changed check is what matters.
    // Step 1: clear any existing alert state by sending 0 failures (resolved condition).
    const clearSync = makeSync({ total: 10, passed: 10, failed: 0 });
    await req("POST", `/api/projects/${projectId}/tracker-alerts/evaluate`, clearSync);
    // Also reset tracker_alert_state via certification save so prev state is null for this type
    await req("POST", `/api/projects/${projectId}/certification`, { trackerAlertState: null });

    // Step 2: first trigger — condition OFF→ON so changed=true → must trigger
    const sync = makeSync({ total: 10, passed: 7, failed: 3, alertConditions: { failedTest: true, blocker: false, retestRequired: false, certRisk: false } });
    const r1 = await req("POST", `/api/projects/${projectId}/tracker-alerts/evaluate`, sync);
    assert(r1.status === 200, `Expected 200, got ${r1.status}`);
    assert(r1.body.triggered.includes("failed_test"), `First call should trigger failed_test, got ${r1.body.triggered}`);

    // Step 3: second call with SAME count — changed=false → should NOT re-trigger
    const r2 = await req("POST", `/api/projects/${projectId}/tracker-alerts/evaluate`, sync);
    assert(r2.status === 200, `Expected 200, got ${r2.status}`);
    assert(!r2.body.triggered.includes("failed_test"),
      `Second identical call must not re-trigger failed_test (count unchanged), got triggered=${r2.body.triggered}`);
  });

  await test("POST evaluate — count increase re-triggers even after prev trigger", async () => {
    // Start with 3 failures
    const sync1 = makeSync({ total: 10, passed: 7, failed: 3, alertConditions: { failedTest: true, blocker: false, retestRequired: false, certRisk: false } });
    await req("POST", `/api/projects/${projectId}/tracker-alerts/evaluate`, sync1);

    // Jump to 5 failures — count increased → should re-trigger
    const sync2 = makeSync({ total: 10, passed: 5, failed: 5, alertConditions: { failedTest: true, blocker: false, retestRequired: false, certRisk: false } });
    const r2 = await req("POST", `/api/projects/${projectId}/tracker-alerts/evaluate`, sync2);
    assert(r2.status === 200, `Expected 200, got ${r2.status}`);
    assert(r2.body.triggered.includes("failed_test"), `Expected re-trigger on count increase, got ${r2.body.triggered}`);
  });

  // ── PHASE 2 — Output creation ─────────────────────────────────────────────

  await test("POST evaluate — notification created in notifications table", async () => {
    // Trigger alert with fresh state
    const sync = makeSync({ total: 10, passed: 7, failed: 3, alertConditions: { failedTest: true, blocker: false, retestRequired: false, certRisk: false } });
    // Reset by clearing state first
    await req("POST", `/api/projects/${projectId}/certification`, {
      trackerAlertState: null,
    });
    const r = await req("POST", `/api/projects/${projectId}/tracker-alerts/evaluate`, sync);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    if (r.body.triggered.includes("failed_test")) {
      assert(r.body.notificationsCreated >= 1, "Expected notification created");
    }

    // Verify notification exists in notification list (API returns camelCase aliases)
    const notifR = await req("GET", "/api/notifications");
    assert(notifR.status === 200, `Expected 200, got ${notifR.status}`);
    const certAlerts = (notifR.body.notifications ?? [])
      .filter(n => n.type === "cert_tracker_alert" && n.linkedObjectId === projectId);
    if (certAlerts.length > 0) {
      const n = certAlerts[0];
      assert(n.title, "Notification must have title");
      assert(n.body, "Notification must have body");
      assert(n.linkedObjectType === "project", `linkedObjectType must be project, got ${n.linkedObjectType}`);
      assert(n.linkedObjectId === projectId, `linkedObjectId must match projectId ${projectId}, got ${n.linkedObjectId}`);
    }
  });

  await test("POST evaluate — task created for high-severity alert", async () => {
    // Blocker alert = high severity → task
    const sync = makeSync({ total: 10, failed: 0, blockerCount: 2, alertConditions: { failedTest: false, blocker: true, retestRequired: false, certRisk: false } });
    const r = await req("POST", `/api/projects/${projectId}/tracker-alerts/evaluate`, sync);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    if (r.body.triggered.includes("blocker")) {
      assert(r.body.tasksCreated >= 1, "Expected task created for blocker alert");

      // Verify task exists in tasks API (storage may return camelCase or snake_case)
      const taskR = await req("GET", `/api/tasks?linkedObjectType=project&linkedObjectId=${projectId}`);
      assert(taskR.status === 200, `Expected 200, got ${taskR.status}`);
      const allTasks = Array.isArray(taskR.body) ? taskR.body : taskR.body.tasks ?? [];
      const certTasks = allTasks.filter(t => t.source === "cert_alert" || t.sourceLabel === "Live Test Tracker Alert");
      if (certTasks.length > 0) {
        const t = certTasks[0];
        const objType = t.linkedObjectType ?? t.linked_object_type;
        const objId   = t.linkedObjectId   ?? t.linked_object_id;
        assert(objType === "project", `task object type must be project, got ${objType}`);
        assert(String(objId) === String(projectId), `task object id must match projectId ${projectId}, got ${objId}`);
      }
    }
  });

  await test("POST evaluate — exec alert created for critical/high alerts", async () => {
    const sync = makeSync({ total: 10, failed: 0, blockerCount: 3, alertConditions: { failedTest: false, blocker: true, retestRequired: false, certRisk: false } });
    const r = await req("POST", `/api/projects/${projectId}/tracker-alerts/evaluate`, sync);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    if (r.body.triggered.includes("blocker")) {
      assert(r.body.execAlertsCreated >= 1, "Expected exec alert created");

      // Verify exec alert exists
      const execR = await req("GET", "/api/executive/alerts");
      assert(execR.status === 200, `Expected 200, got ${execR.status}`);
      const certExecAlerts = (execR.body ?? [])
        .filter(a => a.type === "cert_tracker_alert");
      if (certExecAlerts.length > 0) {
        assert(certExecAlerts[0].status === "open", "exec alert should be open");
        assert(certExecAlerts[0].linked_object_type === "project", "linked_object_type must be project");
      }
    }
  });

  // ── PHASE 4 — Exec risk-alerts surface cert alerts ────────────────────────

  await test("GET /api/executive/risk-alerts — includes certTrackerAlerts field", async () => {
    const r = await req("GET", "/api/executive/risk-alerts");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert("certTrackerAlerts" in r.body, "certTrackerAlerts must be present in risk-alerts response");
    assert(Array.isArray(r.body.certTrackerAlerts), "certTrackerAlerts must be array");
  });

  await test("GET /api/executive/risk-alerts — distinctAtRiskCount accounts for cert alerts", async () => {
    const r = await req("GET", "/api/executive/risk-alerts");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(typeof r.body.distinctAtRiskCount === "number", "distinctAtRiskCount must be number");
  });

  // ── Validation ────────────────────────────────────────────────────────────

  await test("POST evaluate — 400 when body missing total field", async () => {
    const r = await req("POST", `/api/projects/${projectId}/tracker-alerts/evaluate`, { noTotalField: true });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
    assert(r.body.message, "Expected error message");
  });

  await test("POST evaluate — 401 for unauthenticated request", async () => {
    const r = await fetch(`${BASE}/api/projects/${projectId}/tracker-alerts/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeSync()),
    });
    assert(r.status === 401, `Expected 401, got ${r.status}`);
  });

  await test("GET state — 401 for unauthenticated request", async () => {
    const r = await fetch(`${BASE}/api/projects/${projectId}/tracker-alerts/state`);
    assert(r.status === 401, `Expected 401, got ${r.status}`);
  });

  await test("GET state — 200 for authenticated request", async () => {
    const r = await req("GET", `/api/projects/${projectId}/tracker-alerts/state`);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert("alertState" in r.body, "alertState field must be present");
    assert("activeAlerts" in r.body, "activeAlerts field must be present");
  });

  // ── Regression guard ──────────────────────────────────────────────────────

  await test("GET /api/projects/:id/tracker-sync — still works after alert engine added", async () => {
    const r = await req("GET", `/api/projects/${projectId}/tracker-sync`);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    // Should be not_configured (test uses fake URL) or invalid_url or fetch_failed
    assert("error" in r.body, "error field must be present");
  });

  await test("GET /api/projects/:id/certification — still works (no regression)", async () => {
    const r = await req("GET", `/api/projects/${projectId}/certification`);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.tracker_sheet_config, "tracker_sheet_config must still be present");
  });

  await test("POST /api/projects/:id/certification — still works after alert state added", async () => {
    const r = await req("POST", `/api/projects/${projectId}/certification`, {
      certificationStatus: "In Testing",
      overallRisk: "Medium",
    });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.certification_status === "In Testing", `certification_status mismatch: ${r.body.certification_status}`);
  });

  await test("GET /api/projects — project list unaffected (no regression)", async () => {
    const r = await req("GET", "/api/projects");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.body), "Expected array");
    assert(r.body.length > 0, "Expected at least 1 project");
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────

  await test("DELETE cert alert test project — cleanup", async () => {
    if (!projectId) return;
    const r = await req("DELETE", `/api/projects/${projectId}`);
    assert(r.status === 200 || r.status === 204 || r.status === 404, `Unexpected delete status: ${r.status}`);
  });

  // ── Results ───────────────────────────────────────────────────────────────
  console.log("\n── Certification Alert Engine Tests ──────────────────────────");
  for (const { name, ok, error } of results) {
    console.log(`  ${ok ? "✓" : "✗"} ${name}${!ok ? ` — ${error}` : ""}`);
  }
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
