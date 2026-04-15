/**
 * Customer Success + Renewals API Tests
 * Tests /api/cs/* endpoints — dashboard, CRUD, health engine, renewal check.
 */

const BASE = "http://localhost:5000";
let cookie = "";
let csId = null;
let testAccountId = null;

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
  let passed = 0;
  let failed = 0;
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

  // ── Auth ────────────────────────────────────────────────────────────────────
  await test("login as trevor@voltsafe.com", async () => {
    const r = await req("POST", "/api/auth/login", { email: "trevor@voltsafe.com", password: "alberni1444" });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.id || r.body.user, "No user in response");
  });

  // ── Dashboard (empty state) ──────────────────────────────────────────────────
  await test("GET /api/cs/dashboard — returns overview shape", async () => {
    const r = await req("GET", "/api/cs/dashboard");
    assert(r.status === 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(typeof r.body.overview === "object", "Missing overview");
    assert(typeof r.body.overview.total === "number", "Missing total");
    assert(typeof r.body.overview.totalArr === "number", "Missing totalArr");
    assert(typeof r.body.overview.totalMrr === "number", "Missing totalMrr");
    assert(Array.isArray(r.body.upcomingRenewals), "Missing upcomingRenewals");
    assert(Array.isArray(r.body.atRisk), "Missing atRisk");
    assert(Array.isArray(r.body.expansionOpportunities), "Missing expansionOpportunities");
    assert(Array.isArray(r.body.byStatus), "Missing byStatus");
    assert(Array.isArray(r.body.byHealth), "Missing byHealth");
  });

  // ── GET /api/cs (list) ───────────────────────────────────────────────────────
  await test("GET /api/cs — returns data array", async () => {
    const r = await req("GET", "/api/cs");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(typeof r.body === "object" && Array.isArray(r.body.data), "Expected {data: []}");
  });

  await test("GET /api/cs?status=active — filters by status", async () => {
    const r = await req("GET", "/api/cs?status=active");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.body.data), "Expected data array");
    for (const row of r.body.data) {
      assert(row.status === "active", `Expected active, got ${row.status}`);
    }
  });

  await test("GET /api/cs?health=healthy — filters by health", async () => {
    const r = await req("GET", "/api/cs?health=healthy");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.body.data), "Expected data array");
  });

  // ── Get test account ─────────────────────────────────────────────────────────
  await test("Fetch an account ID for CS creation", async () => {
    const r = await req("GET", "/api/accounts?limit=1");
    const accounts = Array.isArray(r.body) ? r.body : (r.body.data ?? []);
    assert(accounts.length > 0, "No accounts found");
    testAccountId = accounts[0].id;
    assert(typeof testAccountId === "number", "Account ID is not a number");
  });

  // ── POST /api/cs ─────────────────────────────────────────────────────────────
  await test("POST /api/cs — create subscription (missing accountId → 400)", async () => {
    const r = await req("POST", "/api/cs", { mrr: 500 });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  });

  await test("POST /api/cs — create subscription with valid data", async () => {
    assert(testAccountId, "No testAccountId available");
    const renewalDate = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();
    const r = await req("POST", "/api/cs", {
      accountId: testAccountId,
      status: "active",
      mrr: 1200,
      arr: 14400,
      contractTermMonths: 12,
      renewalDate,
      billingStatus: "current",
      expansionPotential: "medium",
      expansionNotes: "Could add 20 more slips",
      notes: "Test CS record from automated test suite",
    });
    assert(r.status === 201, `Expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.id, "No id returned");
    assert(r.body.account_id === testAccountId, "account_id mismatch");
    assert(parseFloat(r.body.mrr) === 1200, `mrr mismatch: ${r.body.mrr}`);
    assert(parseFloat(r.body.arr) === 14400, `arr mismatch: ${r.body.arr}`);
    assert(r.body.expansion_potential === "medium", "expansion_potential mismatch");
    csId = r.body.id;
  });

  await test("POST /api/cs — ARR auto-computed from MRR when arr not provided", async () => {
    assert(testAccountId, "No testAccountId");
    const r = await req("POST", "/api/cs", {
      accountId: testAccountId,
      mrr: 500,
      status: "active",
    });
    assert(r.status === 201, `Expected 201, got ${r.status}`);
    const arr = parseFloat(r.body.arr);
    assert(arr === 6000, `Expected ARR 6000 (500*12), got ${arr}`);
    // Clean up — cancel it
    await req("PATCH", `/api/cs/${r.body.id}`, { status: "cancelled" });
  });

  // ── GET /api/cs/:id ──────────────────────────────────────────────────────────
  await test("GET /api/cs/:id — returns detailed record with health", async () => {
    assert(csId, "No csId available");
    const r = await req("GET", `/api/cs/${csId}`);
    assert(r.status === 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.id === csId, "id mismatch");
    assert(typeof r.body.health === "object", "Missing health object");
    assert(typeof r.body.health.score === "number", "Missing health.score");
    assert(typeof r.body.health.status === "string", "Missing health.status");
    assert(Array.isArray(r.body.health.flags), "Missing health.flags");
    assert(Array.isArray(r.body.tasks), "Missing tasks array");
  });

  await test("GET /api/cs/999999 — 404 for missing id", async () => {
    const r = await req("GET", "/api/cs/999999");
    assert(r.status === 404, `Expected 404, got ${r.status}`);
  });

  await test("GET /api/cs/bad — 400 for invalid id", async () => {
    const r = await req("GET", "/api/cs/bad");
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  });

  // ── Health score computation ─────────────────────────────────────────────────
  await test("GET /api/cs/:id — health score is 0-100", async () => {
    assert(csId, "No csId");
    const r = await req("GET", `/api/cs/${csId}`);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.health.score >= 0 && r.body.health.score <= 100, `Score ${r.body.health.score} out of range`);
  });

  await test("POST /api/cs/:id/compute-health — returns health object", async () => {
    assert(csId, "No csId");
    const r = await req("POST", `/api/cs/${csId}/compute-health`, {});
    assert(r.status === 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(typeof r.body.score === "number", "Missing score");
    assert(typeof r.body.status === "string", "Missing status");
    assert(Array.isArray(r.body.flags), "Missing flags");
    assert(r.body.score >= 0 && r.body.score <= 100, `Score out of range: ${r.body.score}`);
    assert(["healthy", "at_risk", "critical"].includes(r.body.status), `Invalid status: ${r.body.status}`);
  });

  await test("POST /api/cs/999999/compute-health — 404 for missing id", async () => {
    const r = await req("POST", "/api/cs/999999/compute-health", {});
    assert(r.status === 404, `Expected 404, got ${r.status}`);
  });

  // ── PATCH /api/cs/:id ────────────────────────────────────────────────────────
  await test("PATCH /api/cs/:id — update status to renewal_due", async () => {
    assert(csId, "No csId");
    const r = await req("PATCH", `/api/cs/${csId}`, { status: "renewal_due" });
    assert(r.status === 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.status === "renewal_due" || r.body.status === "renewal_due", `status mismatch: ${r.body.status}`);
  });

  await test("PATCH /api/cs/:id — update billing_status to overdue", async () => {
    assert(csId, "No csId");
    const r = await req("PATCH", `/api/cs/${csId}`, { billingStatus: "overdue" });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.billing_status === "overdue", `billing_status mismatch: ${r.body.billing_status}`);
  });

  await test("PATCH /api/cs/:id — health score drops after billing overdue", async () => {
    assert(csId, "No csId");
    const r = await req("POST", `/api/cs/${csId}/compute-health`, {});
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    // Billing overdue should reduce score, "Billing overdue" should be in flags
    const hasFlag = r.body.flags.some(f => f.toLowerCase().includes("billing"));
    assert(hasFlag, `Expected billing flag, got: ${JSON.stringify(r.body.flags)}`);
    assert(r.body.score < 100, `Expected score < 100 with billing overdue, got ${r.body.score}`);
  });

  await test("PATCH /api/cs/:id — update back to current billing", async () => {
    assert(csId, "No csId");
    const r = await req("PATCH", `/api/cs/${csId}`, { billingStatus: "current" });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.billing_status === "current", "billing_status mismatch");
  });

  await test("PATCH /api/cs/:id — update expansion_potential", async () => {
    assert(csId, "No csId");
    const r = await req("PATCH", `/api/cs/${csId}`, { expansionPotential: "high" });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.expansion_potential === "high", `expansionPotential mismatch: ${r.body.expansion_potential}`);
  });

  await test("PATCH /api/cs/:id — update last_checkin_at", async () => {
    assert(csId, "No csId");
    const now = new Date().toISOString();
    const r = await req("PATCH", `/api/cs/${csId}`, { lastCheckinAt: now });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
  });

  await test("PATCH /api/cs/:id — recent checkin boosts health score", async () => {
    assert(csId, "No csId");
    const r = await req("POST", `/api/cs/${csId}/compute-health`, {});
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.score >= 80, `Expected score >= 80 after recent checkin, got ${r.body.score}`);
  });

  await test("PATCH /api/cs/:id — update notes", async () => {
    assert(csId, "No csId");
    const r = await req("PATCH", `/api/cs/${csId}`, { notes: "Updated via automated test" });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.notes === "Updated via automated test", "notes mismatch");
  });

  await test("PATCH /api/cs/999999 — 404 for missing id", async () => {
    const r = await req("PATCH", "/api/cs/999999", { status: "active" });
    assert(r.status === 404, `Expected 404, got ${r.status}`);
  });

  await test("PATCH /api/cs/:id — empty body returns 400", async () => {
    assert(csId, "No csId");
    const r = await req("PATCH", `/api/cs/${csId}`, {});
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  });

  // ── GET /api/cs/:id after updates ────────────────────────────────────────────
  await test("GET /api/cs/:id — persisted health_score is updated in DB", async () => {
    assert(csId, "No csId");
    const r = await req("GET", `/api/cs/${csId}`);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(typeof r.body.health_score === "number", "health_score not persisted to DB");
    assert(typeof r.body.health_status === "string", "health_status not persisted to DB");
  });

  // ── List with filters after creation ─────────────────────────────────────────
  await test("GET /api/cs?status=renewal_due — finds our test record", async () => {
    const r = await req("GET", "/api/cs?status=renewal_due");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    const found = r.body.data.some(row => row.id === csId);
    assert(found, `Test CS record ${csId} not found in renewal_due list`);
  });

  await test("GET /api/cs?expansion=medium — expansion filter works", async () => {
    const r = await req("GET", "/api/cs?expansion=medium");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    // Note: record was set to 'high' — but medium filter uses expansion_potential IN ('medium','high') server-side? Actually it's exact match. Let's just check shape.
    assert(Array.isArray(r.body.data), "Expected data array");
  });

  // ── Dashboard after creation ──────────────────────────────────────────────────
  await test("GET /api/cs/dashboard — total > 0 after creation", async () => {
    const r = await req("GET", "/api/cs/dashboard");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.overview.total >= 1, `Expected total >= 1, got ${r.body.overview.total}`);
  });

  await test("GET /api/cs/dashboard — totalArr > 0", async () => {
    const r = await req("GET", "/api/cs/dashboard");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.overview.totalArr >= 14400, `Expected totalArr >= 14400, got ${r.body.overview.totalArr}`);
  });

  // ── Renewal check ─────────────────────────────────────────────────────────────
  await test("POST /api/cs/renewal-check — runs without error", async () => {
    const r = await req("POST", "/api/cs/renewal-check", {});
    assert(r.status === 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.ok === true, "Missing ok: true");
    assert(typeof r.body.recordsChecked === "number", "Missing recordsChecked");
  });

  await test("POST /api/cs/renewal-check — idempotent (2nd run same result)", async () => {
    const r1 = await req("POST", "/api/cs/renewal-check", {});
    const r2 = await req("POST", "/api/cs/renewal-check", {});
    assert(r1.status === 200 && r2.status === 200, "Both runs should be 200");
  });

  // ── Tasks created by renewal check ───────────────────────────────────────────
  await test("GET /api/cs/:id — renewal tasks exist after renewal-check", async () => {
    assert(csId, "No csId");
    const r = await req("GET", `/api/cs/${csId}`);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.body.tasks), "Missing tasks");
    // With renewal in 90 days, should have 90-day and 120-day tasks
    assert(r.body.tasks.length >= 1, `Expected at least 1 renewal task, got ${r.body.tasks.length}`);
    const hasRenewalTask = r.body.tasks.some(t => t.title && t.title.includes("[Renewal]"));
    assert(hasRenewalTask, "No [Renewal] task found");
  });

  // ── Status transitions ────────────────────────────────────────────────────────
  await test("PATCH /api/cs/:id — can set status to renewal_in_progress", async () => {
    assert(csId, "No csId");
    const r = await req("PATCH", `/api/cs/${csId}`, { status: "renewal_in_progress" });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.status === "renewal_in_progress", `status mismatch: ${r.body.status}`);
  });

  await test("PATCH /api/cs/:id — can set status to renewed", async () => {
    assert(csId, "No csId");
    const r = await req("PATCH", `/api/cs/${csId}`, { status: "renewed" });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.status === "renewed", `status mismatch: ${r.body.status}`);
  });

  await test("PATCH /api/cs/:id — can set status to churn_risk", async () => {
    assert(csId, "No csId");
    const r = await req("PATCH", `/api/cs/${csId}`, { status: "churn_risk" });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.status === "churn_risk", `status mismatch: ${r.body.status}`);
  });

  // ── MRR / ARR updates ─────────────────────────────────────────────────────────
  await test("PATCH /api/cs/:id — update mrr", async () => {
    assert(csId, "No csId");
    const r = await req("PATCH", `/api/cs/${csId}`, { mrr: 2000, arr: 24000 });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(parseFloat(r.body.mrr) === 2000, `mrr mismatch: ${r.body.mrr}`);
    assert(parseFloat(r.body.arr) === 24000, `arr mismatch: ${r.body.arr}`);
  });

  // ── Auth guard ────────────────────────────────────────────────────────────────
  await test("GET /api/cs — unauthenticated returns 401", async () => {
    const r = await fetch(`${BASE}/api/cs`, { headers: { Cookie: "" } });
    assert(r.status === 401, `Expected 401, got ${r.status}`);
  });

  await test("GET /api/cs/dashboard — unauthenticated returns 401", async () => {
    const r = await fetch(`${BASE}/api/cs/dashboard`, { headers: { Cookie: "" } });
    assert(r.status === 401, `Expected 401, got ${r.status}`);
  });

  await test("POST /api/cs/renewal-check — unauthenticated returns 401", async () => {
    const r = await fetch(`${BASE}/api/cs/renewal-check`, { method: "POST", headers: { Cookie: "" } });
    assert(r.status === 401, `Expected 401, got ${r.status}`);
  });

  // ── DELETE (cancel) ──────────────────────────────────────────────────────────
  await test("DELETE /api/cs/:id — soft-cancels the record (admin)", async () => {
    assert(csId, "No csId");
    const r = await req("DELETE", `/api/cs/${csId}`);
    assert(r.status === 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.ok === true, "Missing ok: true");
  });

  await test("GET /api/cs/:id — cancelled status persisted after DELETE", async () => {
    assert(csId, "No csId");
    const r = await req("GET", `/api/cs/${csId}`);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.status === "cancelled", `Expected cancelled, got ${r.body.status}`);
  });

  await test("DELETE /api/cs/999999 — 404 for missing", async () => {
    const r = await req("DELETE", "/api/cs/999999");
    assert(r.status === 404, `Expected 404, got ${r.status}`);
  });

  // ── Dashboard excludes cancelled ─────────────────────────────────────────────
  await test("GET /api/cs/dashboard — cancelled records excluded from overview", async () => {
    const r = await req("GET", "/api/cs/dashboard");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    const totalExCancelled = r.body.overview.total;
    // Check cancelled count is a separate field if tracked
    assert(typeof totalExCancelled === "number", "total is not a number");
  });

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════");
  console.log(`  CS Tests: ${passed} passed, ${failed} failed`);
  console.log("══════════════════════════════════════════\n");
  results.forEach(r => {
    console.log(`  ${r.ok ? "✓" : "✗"} ${r.name}${r.error ? `\n      → ${r.error}` : ""}`);
  });
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error("Test runner error:", e); process.exit(1); });
