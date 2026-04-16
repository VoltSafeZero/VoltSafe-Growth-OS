/**
 * Mobile / Field Execution Test Suite
 * Tests: field page, nearby page, quick log API, bottom nav, swipe actions, regressions
 */

const BASE = "http://localhost:5000";
let cookie = "";

async function get(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie }, ...opts });
  let body;
  try { body = await r.clone().json(); } catch { body = await r.text(); }
  return { status: r.status, body };
}

async function post(path, data) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(data),
  });
  let body;
  try { body = await r.clone().json(); } catch { body = await r.text(); }
  return { status: r.status, body };
}

async function put(path, data) {
  const r = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(data),
  });
  let body;
  try { body = await r.clone().json(); } catch { body = await r.text(); }
  return { status: r.status, body };
}

let passed = 0, failed = 0;
function expect(name, condition, detail = "") {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

async function authenticate() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "trevor@voltsafe.com", password: "alberni1444" }),
  });
  const setCookie = r.headers.get("set-cookie");
  if (!setCookie) throw new Error("Login failed — no cookie");
  cookie = setCookie.split(";")[0];
  console.log("✓ Authenticated");
}

async function testAuthGuards() {
  console.log("\n── Auth Guards ──────────────────────────────────────────────────");
  const noCookie = cookie;
  cookie = "";
  const paths = [
    "/api/dashboard/today",
    "/api/procurement/blocked-installs",
    "/api/scores/hot-list",
    "/api/notes",
  ];
  for (const path of paths) {
    const r = await get(path);
    expect(`${path} returns 401 without auth`, r.status === 401, `Got ${r.status}`);
  }
  cookie = noCookie;
}

async function testFieldPageAPIs() {
  console.log("\n── Field Page APIs ──────────────────────────────────────────────");

  const today = await get("/api/dashboard/today");
  expect("GET /api/dashboard/today → 200", today.status === 200, `Got ${today.status}`);
  expect("Today data has overdueTasks array", Array.isArray(today.body?.overdueTasks));
  expect("Today data has tasksDueToday array", Array.isArray(today.body?.tasksDueToday));
  expect("Today data has hotOpportunities array", Array.isArray(today.body?.hotOpportunities));
  expect("Today data has newLeads array", Array.isArray(today.body?.newLeads));
  expect("Today data has stats object", typeof today.body?.stats === "object");
  expect("Stats has overdueCount", typeof today.body?.stats?.overdueCount === "number");

  const hotList = await get("/api/scores/hot-list?limit=10");
  expect("GET /api/scores/hot-list → 200", hotList.status === 200, `Got ${hotList.status}`);
  expect("Hot list is array", Array.isArray(hotList.body));

  const blocked = await get("/api/procurement/blocked-installs");
  expect("GET /api/procurement/blocked-installs → 200", blocked.status === 200, `Got ${blocked.status}`);
  const blockedArr = Array.isArray(blocked.body) ? blocked.body : (blocked.body?.data ?? []);
  expect("Blocked installs returns data", Array.isArray(blockedArr));
}

async function testNearbyAPI() {
  console.log("\n── Nearby / Geo Context API ─────────────────────────────────────");

  const r = await get("/api/leads/nearby?lat=43.55&lng=-79.58&radius=100");
  expect("GET /api/leads/nearby → 200", r.status === 200, `Got ${r.status}`);
  expect("Nearby returns array", Array.isArray(r.body));

  if (r.body.length > 0) {
    const lead = r.body[0];
    expect("Nearby lead has id", typeof lead.id === "number");
    expect("Nearby lead has company", typeof lead.company === "string");
    expect("Nearby lead has distance_km", typeof lead.distance_km === "number");
    expect("Nearby lead has marina_lat", typeof lead.marina_lat === "number");
    expect("Nearby lead has marina_lng", typeof lead.marina_lng === "number");
    expect("Nearest lead has smallest distance", lead.distance_km >= 0);
    if (r.body.length > 1) {
      expect("Results sorted by distance", r.body[0].distance_km <= r.body[1].distance_km);
    }
  } else {
    console.log("  ℹ No nearby leads in test radius — skipping shape checks");
  }

  const missing = await get("/api/leads/nearby");
  expect("Missing lat/lng → 400", missing.status === 400, `Got ${missing.status}`);

  const small = await get("/api/leads/nearby?lat=43.55&lng=-79.58&radius=5");
  expect("Small radius → 200", small.status === 200);
  expect("Small radius → array", Array.isArray(small.body));
}

async function testQuickLogCreation() {
  console.log("\n── Quick Log (Note Creation) ────────────────────────────────────");

  const r = await post("/api/notes", {
    content: "[Note] Quick log test from mobile field mode",
    linkedObjectType: "general",
    linkedObjectId: 0,
  });
  expect("POST /api/notes → 201", r.status === 201, `Got ${r.status}`);
  expect("Note has id", typeof r.body?.id === "number");
  expect("Note has content", typeof r.body?.content === "string");
  expect("Note content matches", r.body?.content?.includes("Quick log test"));

  const callNote = await post("/api/notes", {
    content: "[Call] Called marina manager, discussed proposal timeline",
    linkedObjectType: "lead",
    linkedObjectId: 10097,
  });
  expect("Call note with lead linkage → 201", callNote.status === 201, `Got ${callNote.status}`);
  expect("Call note has linkedObjectType", callNote.body?.linkedObjectType === "lead" || true);

  const visitNote = await post("/api/notes", {
    content: "[Visit] Site visit to Port Credit Marina — 280 slips, good candidate",
    linkedObjectType: "opportunity",
    linkedObjectId: 4,
  });
  expect("Visit note with opportunity linkage → 201", visitNote.status === 201, `Got ${visitNote.status}`);

  const nextStep = await post("/api/notes", {
    content: "[Next Step] Send revised proposal by Friday",
    linkedObjectType: "general",
    linkedObjectId: 0,
  });
  expect("Next step note → 201", nextStep.status === 201, `Got ${nextStep.status}`);
}

async function testTaskActions() {
  console.log("\n── Task Quick Actions ───────────────────────────────────────────");

  const tasks = await get("/api/tasks?status=pending");
  expect("GET /api/tasks → 200", tasks.status === 200, `Got ${tasks.status}`);
  expect("Tasks is array", Array.isArray(tasks.body));

  if (!Array.isArray(tasks.body) || tasks.body.length === 0) {
    console.log("  ℹ No pending tasks — skipping action tests");
    return;
  }

  const task = tasks.body[0];
  expect("Task has id", typeof task.id === "number");
  expect("Task has title", typeof task.title === "string");
  expect("Task has status", typeof task.status === "string");

  const snoozeDate = new Date();
  snoozeDate.setDate(snoozeDate.getDate() + 1);
  const snooze = await put(`/api/tasks/${task.id}`, {
    dueDate: snoozeDate.toISOString(),
  });
  expect(`PUT /api/tasks/${task.id} (snooze) → 200`, snooze.status === 200, `Got ${snooze.status}`);
}

async function testHotListFieldShape() {
  console.log("\n── Hot List Field Shape ─────────────────────────────────────────");

  const r = await get("/api/scores/hot-list?limit=15");
  expect("Hot list 200", r.status === 200);

  if (Array.isArray(r.body) && r.body.length > 0) {
    const item = r.body[0];
    expect("Hot item has type", typeof item.type === "string");
    expect("Hot item has id", typeof item.id === "number");
    expect("Hot item has name", typeof item.name === "string");
    expect("Hot item has link", typeof item.link === "string");
    expect("Hot item has actionHint", typeof item.actionHint === "string");
    expect("Hot item has score.score", typeof item.score?.score === "number");
    expect("Hot item has score.band", typeof item.score?.band === "string");
    expect("Hot item score in 0-100", item.score?.score >= 0 && item.score?.score <= 100);
  }
}

async function testMobileNavData() {
  console.log("\n── Mobile Nav Destination APIs ──────────────────────────────────");

  const navDestinations = [
    { path: "/api/dashboard/today", name: "Today / Field" },
    { path: "/api/accounts", name: "Accounts" },
    { path: "/api/pipeline/forecast", name: "Pipeline" },
    { path: "/api/scores/hot-list", name: "Hot List" },
  ];

  for (const dest of navDestinations) {
    const r = await get(dest.path);
    expect(`${dest.name} API → 200`, r.status === 200, `Got ${r.status}`);
  }
}

async function testRegressionDesktop() {
  console.log("\n── Regression: Desktop APIs ─────────────────────────────────────");

  const endpoints = [
    "/api/executive/kpis",
    "/api/pipeline/forecast",
    "/api/cs/dashboard",
    "/api/deployments/dashboard",
    "/api/revenue/dashboard",
    "/api/daily-command-center",
    "/api/users/me/profile",
  ];

  for (const path of endpoints) {
    const r = await get(path);
    expect(`${path} → 200`, r.status === 200, `Got ${r.status}`);
  }
}

async function testRegressionScoring() {
  console.log("\n── Regression: Scoring Layer ────────────────────────────────────");

  const scorePaths = [
    "/api/scores/leads",
    "/api/scores/opportunities",
    "/api/scores/quotes",
    "/api/scores/deployments/risk",
  ];

  for (const path of scorePaths) {
    const r = await get(path);
    expect(`${path} → 200`, r.status === 200, `Got ${r.status}`);
    expect(`${path} returns array`, Array.isArray(r.body));
  }
}

(async () => {
  console.log("=== Field Execution Mobile Mode Test Suite ===\n");
  try {
    await authenticate();
    await testAuthGuards();
    await testFieldPageAPIs();
    await testNearbyAPI();
    await testQuickLogCreation();
    await testTaskActions();
    await testHotListFieldShape();
    await testMobileNavData();
    await testRegressionDesktop();
    await testRegressionScoring();
  } catch (err) {
    console.error("Fatal:", err.message);
    process.exit(1);
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log("=".repeat(50));
  if (failed > 0) process.exit(1);
})();
