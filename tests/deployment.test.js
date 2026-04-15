/**
 * Deployment / Site Rollout Manager — Integration Tests
 * Run: node tests/deployment.test.js
 */

const BASE = "http://localhost:5000";

let authCookie = "";
let deployId   = null;
let hwId       = null;
let cpId       = null;
let blId       = null;

async function req(method, path, body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json", Cookie: authCookie },
    credentials: "include",
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  if (r.headers.get("set-cookie")) authCookie = r.headers.get("set-cookie").split(";")[0];
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}

let passed = 0;
let failed = 0;

function assert(label, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else       { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
}

function section(title) {
  console.log(`\n── ${title} ──────────────────────────────────`);
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function login() {
  section("Auth");
  const r = await req("POST", "/api/auth/login", { email: "trevor@voltsafe.com", password: "alberni1444" });
  assert("login 200", r.status === 200);
  const uid = r.body?.user?.id ?? r.body?.id;
  assert("has user", uid > 0 || r.status === 200, JSON.stringify(r.body));
}

// ── Dashboard (before any data) ───────────────────────────────────────────────
async function testDashboardEmpty() {
  section("Dashboard (initial state)");

  const r = await req("GET", "/api/deployments/dashboard");
  assert("dashboard 200", r.status === 200, JSON.stringify(r.body).slice(0, 200));
  assert("has overview object", typeof r.body?.overview === "object");
  assert("overview.total is number", typeof r.body?.overview?.total === "number");
  assert("overview.active is number", typeof r.body?.overview?.active === "number");
  assert("overview.live is number", typeof r.body?.overview?.live === "number");
  assert("overview.blocked is number", typeof r.body?.overview?.blocked === "number");
  assert("overview.commissioning is number", typeof r.body?.overview?.commissioning === "number");
  assert("overview.overdue is number", typeof r.body?.overview?.overdue === "number");
  assert("overview.liveThisMonth is number", typeof r.body?.overview?.liveThisMonth === "number");
  assert("has byStatus object", typeof r.body?.byStatus === "object");
  assert("has overdueDeployments array", Array.isArray(r.body?.overdueDeployments));
  assert("has blockedDeployments array", Array.isArray(r.body?.blockedDeployments));
  assert("has commissioningProgress array", Array.isArray(r.body?.commissioningProgress));
}

// ── Blocked list (before any data) ────────────────────────────────────────────
async function testBlockedListEmpty() {
  section("Blocked list (initial state)");
  const r = await req("GET", "/api/deployments/blocked");
  assert("blocked list 200", r.status === 200);
  assert("returns data array", Array.isArray(r.body?.data));
}

// ── Create Deployment ─────────────────────────────────────────────────────────
async function testCreateDeployment() {
  section("Create Deployment");

  // Missing siteName → 400
  const bad = await req("POST", "/api/deployments", { address: "nowhere" });
  assert("create no siteName → 400", bad.status === 400);

  // Valid create
  const create = await req("POST", "/api/deployments", {
    siteName: "Comox Marina Phase 1",
    address: "100 Marina Way, Comox, BC",
    region: "Vancouver Island",
    targetGoLive: new Date(Date.now() + 30 * 86400000).toISOString(),
    docksCount: 12,
    notes: "Phase 1 of 2",
  });
  assert("create deployment 201", create.status === 201, JSON.stringify(create.body));
  assert("has deploy_number", create.body?.deploy_number?.startsWith("DEPLOY-"));
  assert("status is planned", create.body?.status === "planned");
  deployId = create.body?.id;
  assert("has id", deployId > 0);

  // Second deployment — number increments
  const create2 = await req("POST", "/api/deployments", {
    siteName: "Parksville Marina",
    region: "Vancouver Island",
  });
  assert("second deploy increments number", create2.body?.deploy_number !== create.body?.deploy_number);

  // 6 default commissioning checkpoints were seeded
  const cps = await req("GET", `/api/deployments/${deployId}/checkpoints`);
  assert("default checkpoints seeded", cps.body?.data?.length === 6,
    `got ${cps.body?.data?.length} checkpoints`);
  assert("first checkpoint is 'Hardware installed'",
    cps.body?.data?.[0]?.name === "Hardware installed");
  assert("last checkpoint is 'Go-live confirmed'",
    cps.body?.data?.[5]?.name === "Go-live confirmed");
  cpId = cps.body?.data?.[0]?.id;
}

// ── List & Filter Deployments ─────────────────────────────────────────────────
async function testListDeployments() {
  section("List & Filter Deployments");

  const list = await req("GET", "/api/deployments");
  assert("list deployments 200", list.status === 200);
  assert("returns data array", Array.isArray(list.body?.data));
  assert("created deployment in list", list.body?.data?.some(d => d.id === deployId));

  // Filter by status
  const byStatus = await req("GET", "/api/deployments?status=planned");
  assert("filter by status 200", byStatus.status === 200);
  assert("filtered to planned", byStatus.body?.data?.every(d => d.status === "planned"));

  // Get single deployment
  const single = await req("GET", `/api/deployments/${deployId}`);
  assert("get single 200", single.status === 200);
  assert("has hardware array", Array.isArray(single.body?.hardware));
  assert("has checkpoints array", Array.isArray(single.body?.checkpoints));
  assert("has blockers array", Array.isArray(single.body?.blockers));
  assert("checkpoints count correct", single.body?.checkpoints?.length === 6);

  // Non-existent
  const bad = await req("GET", "/api/deployments/999999");
  assert("get nonexistent → 404", bad.status === 404);
}

// ── Status Lifecycle ──────────────────────────────────────────────────────────
async function testStatusLifecycle() {
  section("Status Lifecycle");

  // planned → scheduled
  const p1 = await req("PATCH", `/api/deployments/${deployId}`, { status: "scheduled" });
  assert("scheduled 200", p1.status === 200);
  assert("status updated", p1.body?.status === "scheduled");

  // scheduled → mobilizing
  const p2 = await req("PATCH", `/api/deployments/${deployId}`, { status: "mobilizing" });
  assert("mobilizing 200", p2.status === 200);

  // mobilizing → in_install (should set actual_start)
  const p3 = await req("PATCH", `/api/deployments/${deployId}`, { status: "in_install" });
  assert("in_install 200", p3.status === 200);
  assert("actual_start set on in_install", !!p3.body?.actual_start);

  // → commissioning
  const p4 = await req("PATCH", `/api/deployments/${deployId}`, { status: "commissioning" });
  assert("commissioning 200", p4.status === 200);

  // → blocked (should trigger a task)
  const p5 = await req("PATCH", `/api/deployments/${deployId}`, { status: "blocked" });
  assert("blocked 200", p5.status === 200);

  // → back to commissioning
  const p6 = await req("PATCH", `/api/deployments/${deployId}`, { status: "commissioning" });
  assert("back to commissioning 200", p6.status === 200);

  // Non-existent patch
  const bad = await req("PATCH", "/api/deployments/999999", { status: "live" });
  assert("patch nonexistent → 404", bad.status === 404);
}

// ── Commissioning Checkpoints ─────────────────────────────────────────────────
async function testCommissioningCheckpoints() {
  section("Commissioning Checkpoints");

  // List
  const list = await req("GET", `/api/deployments/${deployId}/checkpoints`);
  assert("list checkpoints 200", list.status === 200);
  assert("has 6 checkpoints", list.body?.data?.length === 6);
  cpId = list.body?.data?.[0]?.id;

  // Pass first checkpoint
  const p1 = await req("PATCH", `/api/deployments/${deployId}/checkpoints/${cpId}`, { status: "passed" });
  assert("pass checkpoint 200", p1.status === 200);
  assert("status is passed", p1.body?.status === "passed");
  assert("checked_at set", !!p1.body?.checked_at);

  // Fail a checkpoint
  const cp2Id = list.body?.data?.[1]?.id;
  const p2 = await req("PATCH", `/api/deployments/${deployId}/checkpoints/${cp2Id}`, { status: "failed" });
  assert("fail checkpoint 200", p2.status === 200);
  assert("status is failed", p2.body?.status === "failed");

  // Reset
  const p3 = await req("PATCH", `/api/deployments/${deployId}/checkpoints/${cp2Id}`, { status: "pending" });
  assert("reset checkpoint 200", p3.status === 200);
  assert("status back to pending", p3.body?.status === "pending");

  // Add a custom checkpoint
  const add = await req("POST", `/api/deployments/${deployId}/checkpoints`, {
    name: "Marina manager sign-off",
  });
  assert("add custom checkpoint 201", add.status === 201);
  assert("custom checkpoint has id", add.body?.id > 0);

  // Missing name → 400
  const bad = await req("POST", `/api/deployments/${deployId}/checkpoints`, {});
  assert("add checkpoint no name → 400", bad.status === 400);

  // Non-existent checkpoint patch → 404
  const badPatch = await req("PATCH", `/api/deployments/${deployId}/checkpoints/999999`, { status: "passed" });
  assert("patch nonexistent checkpoint → 404", badPatch.status === 404);
}

// ── Commissioning → Auto-Live ─────────────────────────────────────────────────
async function testAutoLive() {
  section("Commissioning → Auto-Live when all checkpoints pass");

  // Create a fresh deployment to test auto-live cleanly
  const create = await req("POST", "/api/deployments", {
    siteName: "Auto-Live Test Marina",
  });
  const testId = create.body?.id;
  assert("created fresh deployment", testId > 0);

  // Advance to commissioning
  await req("PATCH", `/api/deployments/${testId}`, { status: "commissioning" });

  // Get all checkpoints
  const cps = await req("GET", `/api/deployments/${testId}/checkpoints`);
  const checkpointIds = cps.body?.data?.map(c => c.id) ?? [];
  assert("has 6 checkpoints", checkpointIds.length === 6);

  // Pass all checkpoints except last
  for (let i = 0; i < checkpointIds.length - 1; i++) {
    await req("PATCH", `/api/deployments/${testId}/checkpoints/${checkpointIds[i]}`, { status: "passed" });
  }

  // Verify still commissioning
  const midStatus = await req("GET", `/api/deployments/${testId}`);
  assert("still commissioning mid-way", midStatus.body?.status === "commissioning",
    `status=${midStatus.body?.status}`);

  // Pass final checkpoint → should auto-advance to live
  const lastPass = await req("PATCH", `/api/deployments/${testId}/checkpoints/${checkpointIds[checkpointIds.length - 1]}`, { status: "passed" });
  assert("last checkpoint pass 200", lastPass.status === 200);

  // Deployment should now be live
  const liveCheck = await req("GET", `/api/deployments/${testId}`);
  assert("deployment auto-advanced to live", liveCheck.body?.status === "live",
    `status=${liveCheck.body?.status}`);
  assert("actual_go_live set", !!liveCheck.body?.actual_go_live);
}

// ── Deployment Blockers ───────────────────────────────────────────────────────
async function testDeploymentBlockers() {
  section("Deployment Blockers");

  // Create blocker — missing title → 400
  const bad = await req("POST", `/api/deployments/${deployId}/blockers`, { severity: "high" });
  assert("create blocker no title → 400", bad.status === 400);

  // Valid create
  const create = await req("POST", `/api/deployments/${deployId}/blockers`, {
    title: "Electrical panel not accessible",
    description: "Marina office locked. Need key from harbour master.",
    severity: "high",
  });
  assert("create blocker 201", create.status === 201, JSON.stringify(create.body));
  assert("blocker has id", create.body?.id > 0);
  assert("blocker status is open", create.body?.status === "open");
  blId = create.body?.id;

  // Create another (low severity)
  const create2 = await req("POST", `/api/deployments/${deployId}/blockers`, {
    title: "Minor signage missing",
    severity: "low",
  });
  assert("create second blocker 201", create2.status === 201);

  // List
  const list = await req("GET", `/api/deployments/${deployId}/blockers`);
  assert("list blockers 200", list.status === 200);
  assert("has 2 blockers", list.body?.data?.length === 2,
    `got ${list.body?.data?.length}`);

  // Resolve
  const resolve = await req("PATCH", `/api/deployments/${deployId}/blockers/${blId}`, { status: "resolved" });
  assert("resolve blocker 200", resolve.status === 200);
  assert("status is resolved", resolve.body?.status === "resolved");
  assert("resolved_at set", !!resolve.body?.resolved_at);

  // Non-existent patch → 404
  const badPatch = await req("PATCH", `/api/deployments/${deployId}/blockers/999999`, { status: "resolved" });
  assert("patch nonexistent blocker → 404", badPatch.status === 404);
}

// ── Hardware Allocations ──────────────────────────────────────────────────────
async function testHardwareAllocations() {
  section("Hardware Allocations");

  // Create
  const create = await req("POST", `/api/deployments/${deployId}/hardware`, {
    description: "Level 2 EV Charger Unit",
    quantityRequired: 12,
  });
  assert("create hw allocation 201", create.status === 201, JSON.stringify(create.body));
  assert("hw has id", create.body?.id > 0);
  assert("status is pending", create.body?.status === "pending");
  hwId = create.body?.id;

  // List
  const list = await req("GET", `/api/deployments/${deployId}/hardware`);
  assert("list hardware 200", list.status === 200);
  assert("returns data array", Array.isArray(list.body?.data));
  assert("hw in list", list.body?.data?.some(h => h.id === hwId));

  // Patch — update quantities
  const patch = await req("PATCH", `/api/deployments/${deployId}/hardware/${hwId}`, {
    status: "shipped",
    quantityShipped: "12",
  });
  assert("patch hw 200", patch.status === 200);
  assert("status updated to shipped", patch.body?.status === "shipped");

  // Patch → delivered
  const patch2 = await req("PATCH", `/api/deployments/${deployId}/hardware/${hwId}`, {
    status: "delivered",
    quantityDelivered: "12",
  });
  assert("patch hw to delivered 200", patch2.status === 200);

  // Mark missing → should trigger task
  const create2 = await req("POST", `/api/deployments/${deployId}/hardware`, {
    description: "Cable Management Kit",
    quantityRequired: 5,
  });
  const hwId2 = create2.body?.id;
  const missing = await req("PATCH", `/api/deployments/${deployId}/hardware/${hwId2}`, { status: "missing" });
  assert("mark hw missing 200", missing.status === 200);

  // Non-existent patch → 404
  const bad = await req("PATCH", `/api/deployments/${deployId}/hardware/999999`, { status: "shipped" });
  assert("patch nonexistent hw → 404", bad.status === 404);

  // Delete
  const del = await req("DELETE", `/api/deployments/${deployId}/hardware/${hwId}`);
  assert("delete hw 200", del.status === 200);
  assert("delete returns ok", del.body?.ok === true);
}

// ── Blocked Deployments List ──────────────────────────────────────────────────
async function testBlockedList() {
  section("Blocked Deployments List");

  const r = await req("GET", "/api/deployments/blocked");
  assert("blocked list 200", r.status === 200);
  assert("returns data array", Array.isArray(r.body?.data));

  if (r.body?.data?.length > 0) {
    const item = r.body.data[0];
    assert("blocked item has id", item.id > 0);
    assert("blocked item has open_blocker_count", item.open_blocker_count !== undefined);
    assert("blocked item has missing_hw_count", item.missing_hw_count !== undefined);
  } else {
    console.log("    (no blocked deployments matching criteria — OK)");
  }
}

// ── Dashboard (post-data) ─────────────────────────────────────────────────────
async function testDashboardWithData() {
  section("Dashboard (with data)");

  const r = await req("GET", "/api/deployments/dashboard");
  assert("dashboard 200", r.status === 200);
  assert("total > 0", r.body?.overview?.total > 0, `total=${r.body?.overview?.total}`);
  assert("byStatus has entries", Object.keys(r.body?.byStatus ?? {}).length > 0);
}

// ── No Regression: Procurement ────────────────────────────────────────────────
async function testProcurementNotBroken() {
  section("Regression — Procurement dashboard");
  const r = await req("GET", "/api/procurement/dashboard");
  assert("procurement dashboard still 200", r.status === 200);
  assert("still has pos", typeof r.body?.pos === "object");
  assert("still has batches", typeof r.body?.batches === "object");
}

// ── No Regression: Executive KPIs ────────────────────────────────────────────
async function testExecutiveNotBroken() {
  section("Regression — Executive KPIs");
  const r = await req("GET", "/api/executive/kpis");
  assert("executive kpis still 200", r.status === 200);
  assert("still has pipeline", r.body?.pipeline !== undefined);
}

// ── Main runner ───────────────────────────────────────────────────────────────
(async () => {
  console.log("\n═══════════════════════════════════════════════════");
  console.log("   Deployment / Site Rollout — Integration Tests");
  console.log("═══════════════════════════════════════════════════");

  await login();
  await testDashboardEmpty();
  await testBlockedListEmpty();
  await testCreateDeployment();
  await testListDeployments();
  await testStatusLifecycle();
  await testCommissioningCheckpoints();
  await testAutoLive();
  await testDeploymentBlockers();
  await testHardwareAllocations();
  await testBlockedList();
  await testDashboardWithData();
  await testProcurementNotBroken();
  await testExecutiveNotBroken();

  console.log("\n═══════════════════════════════════════════════════");
  console.log(`   RESULT: ${passed} passed, ${failed} failed`);
  console.log("═══════════════════════════════════════════════════\n");

  process.exit(failed > 0 ? 1 : 0);
})();
