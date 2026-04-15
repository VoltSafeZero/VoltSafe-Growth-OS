/**
 * Install / Onboarding Workflow — Test Suite
 * 20 tests covering full lifecycle
 */

const BASE = "http://localhost:5000";

// ── Auth helper ───────────────────────────────────────────────────────────────
async function getAuthCookie() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "trevor@voltsafe.com", password: "alberni1444" }),
  });
  if (!r.ok) throw new Error(`Login failed: ${r.status}`);
  const setCookie = r.headers.get("set-cookie");
  return setCookie?.match(/connect\.sid=[^;]+/)?.[0] ?? "";
}

let cookie = "";
let workflowId = null;
let milestoneId = null;
let secondWfId = null;

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const results = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
    results.push({ name, ok: true });
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`      → ${err.message}`);
    failed++;
    results.push({ name, ok: false, error: err.message });
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg ?? "Assertion failed"); }
function assertEq(a, b, msg) { if (a !== b) throw new Error(msg ?? `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

// ── Helpers ───────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

// ─────────────────────────────────────────────────────────────────────────────
async function runAll() {
  console.log("\n=== Install / Onboarding Workflow Test Suite ===\n");

  cookie = await getAuthCookie();

  // ── Section 1: Summary endpoint before any data ─────────────────────────
  console.log("── Section 1: Summary ─────────────────────────────────────");

  await test("GET /api/install-workflows/summary returns shape", async () => {
    const { status, data } = await api("GET", "/api/install-workflows/summary");
    assertEq(status, 200, `Expected 200, got ${status}`);
    assert(typeof data.total === "number", "total missing");
    assert(typeof data.overdue === "number", "overdue missing");
    assert(typeof data.withBlockers === "number", "withBlockers missing");
    assert(typeof data.byStatus === "object", "byStatus missing");
  });

  // ── Section 2: Create workflows ──────────────────────────────────────────
  console.log("\n── Section 2: Create Workflows ────────────────────────────");

  await test("POST /api/install-workflows creates with default milestones", async () => {
    const kickoff = new Date(Date.now() + 86400000).toISOString();
    const { status, data } = await api("POST", "/api/install-workflows", {
      title: "TEST Install — Quayside Marina",
      ownerUserId: 4,
      kickoffDate: kickoff,
      targetCompletionDate: new Date(Date.now() + 60 * 86400000).toISOString(),
      notes: "Test install workflow",
      siteAddress: "123 Dock St, Victoria, BC",
    });
    assertEq(status, 201, `Expected 201, got ${status}: ${JSON.stringify(data)}`);
    assert(data.workflowId, "workflowId missing");
    workflowId = data.workflowId;
  });

  await test("POST /api/install-workflows requires title", async () => {
    const { status } = await api("POST", "/api/install-workflows", { ownerUserId: 4 });
    assertEq(status, 400, `Expected 400, got ${status}`);
  });

  await test("POST second workflow for listing tests", async () => {
    const { status, data } = await api("POST", "/api/install-workflows", {
      title: "TEST Install — Harbor Lights Marina",
      ownerUserId: 4,
    });
    assertEq(status, 201, `Expected 201, got ${status}`);
    secondWfId = data.workflowId;
  });

  // ── Section 3: List / filter ─────────────────────────────────────────────
  console.log("\n── Section 3: List & Filter ───────────────────────────────");

  await test("GET /api/install-workflows returns paginated list", async () => {
    const { status, data } = await api("GET", "/api/install-workflows");
    assertEq(status, 200, `Expected 200, got ${status}`);
    assert(Array.isArray(data.data), "data.data should be array");
    assert(typeof data.total === "number", "total missing");
    assert(data.data.length >= 2, `Expected ≥2 workflows, got ${data.data.length}`);
  });

  await test("GET /api/install-workflows?status=pending_kickoff filters correctly", async () => {
    const { status, data } = await api("GET", "/api/install-workflows?status=pending_kickoff");
    assertEq(status, 200, `Expected 200, got ${status}`);
    for (const wf of data.data) {
      assertEq(wf.status, "pending_kickoff", `Expected pending_kickoff, got ${wf.status}`);
    }
  });

  await test("GET /api/install-workflows list includes progressPct", async () => {
    const { data } = await api("GET", "/api/install-workflows");
    const wf = data.data.find(w => w.id === workflowId);
    assert(wf, "Created workflow not in list");
    assert(typeof wf.progressPct === "number", "progressPct missing");
    assert(typeof wf.milestoneTotal === "number", "milestoneTotal missing");
    assert(typeof wf.milestoneDone === "number", "milestoneDone missing");
  });

  // ── Section 4: Detail view ────────────────────────────────────────────────
  console.log("\n── Section 4: Detail View ─────────────────────────────────");

  await test("GET /api/install-workflows/:id returns detail with milestones", async () => {
    const { status, data } = await api("GET", `/api/install-workflows/${workflowId}`);
    assertEq(status, 200, `Expected 200, got ${status}`);
    assert(data.id === workflowId, "id mismatch");
    assert(Array.isArray(data.milestones), "milestones missing");
    assertEq(data.milestones.length, 8, `Expected 8 default milestones, got ${data.milestones.length}`);
    assert(Array.isArray(data.tasks), "tasks missing");
    assert(typeof data.progressPct === "number", "progressPct missing");
    milestoneId = data.milestones[0].id;
  });

  await test("GET /api/install-workflows/:id — milestones have correct fields", async () => {
    const { data } = await api("GET", `/api/install-workflows/${workflowId}`);
    const m = data.milestones[0];
    assert(m.name, "milestone name missing");
    assert(m.description, "milestone description missing");
    assert(typeof m.sortOrder === "number" || typeof m.sort_order === "number", "sort_order missing");
    assert(m.status === "pending", `Expected pending, got ${m.status}`);
  });

  await test("GET /api/install-workflows/404 returns 404", async () => {
    const { status } = await api("GET", "/api/install-workflows/9999999");
    assertEq(status, 404, `Expected 404, got ${status}`);
  });

  // ── Section 5: Update workflow ────────────────────────────────────────────
  console.log("\n── Section 5: Update Workflow ─────────────────────────────");

  await test("PATCH /api/install-workflows/:id updates status", async () => {
    const { status, data } = await api("PATCH", `/api/install-workflows/${workflowId}`, {
      status: "in_progress",
    });
    assertEq(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
    assert(data.ok, "ok missing");
    assertEq(data.workflow.status, "in_progress", `Expected in_progress, got ${data.workflow.status}`);
  });

  await test("PATCH /api/install-workflows/:id updates blockers", async () => {
    const { status, data } = await api("PATCH", `/api/install-workflows/${workflowId}`, {
      blockers: "Waiting on electrical permit from city",
    });
    assertEq(status, 200, `Expected 200, got ${status}`);
    assert(data.workflow.blockers.includes("electrical"), "blockers not saved");
  });

  await test("PATCH /api/install-workflows/:id rejects empty body", async () => {
    const { status } = await api("PATCH", `/api/install-workflows/${workflowId}`, {});
    assertEq(status, 400, `Expected 400, got ${status}`);
  });

  await test("PATCH /api/install-workflows/:id status=complete sets actual_completion_date", async () => {
    // Create a throwaway workflow and complete it
    const { data: cData } = await api("POST", "/api/install-workflows", { title: "TEST Complete Me", ownerUserId: 4 });
    const { status, data } = await api("PATCH", `/api/install-workflows/${cData.workflowId}`, { status: "complete" });
    assertEq(status, 200, `Expected 200, got ${status}`);
    assertEq(data.workflow.status, "complete", `Expected complete`);
    assert(data.workflow.actual_completion_date, "actual_completion_date should be set");
    // Cleanup
    await api("DELETE", `/api/install-workflows/${cData.workflowId}`);
  });

  // ── Section 6: Milestone management ──────────────────────────────────────
  console.log("\n── Section 6: Milestones ──────────────────────────────────");

  await test("PATCH milestone — mark in_progress", async () => {
    const { status, data } = await api("PATCH", `/api/install-workflows/${workflowId}/milestones/${milestoneId}`, {
      status: "in_progress",
    });
    assertEq(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
    assert(data.ok, "ok missing");
  });

  await test("PATCH milestone — mark complete sets completedAt", async () => {
    const { status } = await api("PATCH", `/api/install-workflows/${workflowId}/milestones/${milestoneId}`, {
      status: "complete",
    });
    assertEq(status, 200, `Expected 200, got ${status}`);
    const { data: wfData } = await api("GET", `/api/install-workflows/${workflowId}`);
    const m = wfData.milestones.find(m => m.id === milestoneId);
    assert(m?.completed_at || m?.completedAt, "completedAt not set");
    assertEq(wfData.milestoneDone, 1, `Expected 1 done, got ${wfData.milestoneDone}`);
  });

  await test("POST /api/install-workflows/:id/milestones adds custom milestone", async () => {
    const { status, data } = await api("POST", `/api/install-workflows/${workflowId}/milestones`, {
      name: "Custom Safety Inspection",
      description: "Marina-specific ABYC safety check",
      dueDate: new Date(Date.now() + 21 * 86400000).toISOString(),
    });
    assertEq(status, 201, `Expected 201, got ${status}: ${JSON.stringify(data)}`);
    assert(data.id, "milestone id missing");
  });

  await test("POST milestone requires name", async () => {
    const { status } = await api("POST", `/api/install-workflows/${workflowId}/milestones`, {
      description: "No name provided",
    });
    assertEq(status, 400, `Expected 400, got ${status}`);
  });

  // ── Section 7: Auto-complete ───────────────────────────────────────────────
  console.log("\n── Section 7: Auto-complete Behavior ─────────────────────");

  await test("Auto-completes workflow when all milestones done", async () => {
    // Create isolated workflow and immediately complete all milestones
    const { data: cData } = await api("POST", "/api/install-workflows", { title: "TEST AutoComplete", ownerUserId: 4 });
    const tId = cData.workflowId;
    const { data: detail } = await api("GET", `/api/install-workflows/${tId}`);
    const milestones = detail.milestones;

    // Complete all except last (to test incremental)
    for (let i = 0; i < milestones.length - 1; i++) {
      await api("PATCH", `/api/install-workflows/${tId}/milestones/${milestones[i].id}`, { status: "complete" });
    }
    // Workflow should NOT yet be complete
    const { data: mid } = await api("GET", `/api/install-workflows/${tId}`);
    assert(mid.status !== "complete", "Workflow should not yet be complete");

    // Complete the last one
    await api("PATCH", `/api/install-workflows/${tId}/milestones/${milestones[milestones.length-1].id}`, { status: "complete" });
    const { data: final } = await api("GET", `/api/install-workflows/${tId}`);
    assertEq(final.status, "complete", `Expected complete after all done, got ${final.status}`);
    assert(final.actual_completion_date, "actual_completion_date should be set on auto-complete");

    // Cleanup
    await api("DELETE", `/api/install-workflows/${tId}`);
  });

  // ── Section 8: From-quote endpoint ───────────────────────────────────────
  console.log("\n── Section 8: From-Quote Trigger ──────────────────────────");

  await test("POST /api/install-workflows/from-quote/:quoteId rejects non-accepted quote", async () => {
    // Get any quote that is NOT accepted
    const qRes = await fetch(`${BASE}/api/quotes?limit=5`, { headers: { Cookie: cookie } });
    const qData = await qRes.json();
    const draftQ = (qData.data ?? []).find(q => q.status !== "accepted");
    if (!draftQ) { console.log("      (skip — no non-accepted quotes in DB)"); return; }
    const { status } = await api("POST", `/api/install-workflows/from-quote/${draftQ.id}`, {});
    assertEq(status, 400, `Expected 400 for non-accepted quote, got ${status}`);
  });

  await test("POST /api/install-workflows/from-quote/:quoteId — 404 for unknown quote", async () => {
    const { status } = await api("POST", "/api/install-workflows/from-quote/9999999", {});
    assertEq(status, 404, `Expected 404, got ${status}`);
  });

  // ── Section 9: Delete ─────────────────────────────────────────────────────
  console.log("\n── Section 9: Delete ──────────────────────────────────────");

  await test("DELETE /api/install-workflows/:id removes workflow and milestones", async () => {
    const { status: del } = await api("DELETE", `/api/install-workflows/${secondWfId}`);
    assertEq(del, 200, `Expected 200, got ${del}`);
    const { status: get } = await api("GET", `/api/install-workflows/${secondWfId}`);
    assertEq(get, 404, `Expected 404 after delete, got ${get}`);
  });

  // ── Section 10: Summary post-change ──────────────────────────────────────
  console.log("\n── Section 10: Summary Accuracy ───────────────────────────");

  await test("Summary withBlockers count reflects workflows with blockers text", async () => {
    const { data } = await api("GET", "/api/install-workflows/summary");
    assert(typeof data.withBlockers === "number", "withBlockers not a number");
    assert(data.withBlockers >= 1, `Expected ≥1 with blockers (we set one), got ${data.withBlockers}`);
  });

  // ── Cleanup primary test workflow ─────────────────────────────────────────
  await api("DELETE", `/api/install-workflows/${workflowId}`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(52)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  if (failed > 0) {
    console.log("\nFailed tests:");
    results.filter(r => !r.ok).forEach(r => console.log(`  ✗ ${r.name}: ${r.error}`));
    process.exit(1);
  } else {
    console.log("All tests passed ✓");
  }
}

runAll().catch(err => {
  console.error("Test runner error:", err.message);
  process.exit(1);
});
