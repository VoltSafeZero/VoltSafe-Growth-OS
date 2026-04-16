/**
 * Territory Routing + Travel Engine — Test Suite
 * Tests: ranking logic, nearby filtering, trip CRUD, direction links,
 *        command center integration, no regression to geo/field/scoring.
 */

const BASE = "http://localhost:5000";
let sessionCookie = "";

// ── Auth helper ───────────────────────────────────────────────────────────────
async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "trevor@voltsafe.com", password: "alberni1444" }),
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  sessionCookie = setCookie.split(";")[0];
  return res.ok;
}

function get(path) {
  return fetch(`${BASE}${path}`, {
    headers: { Cookie: sessionCookie },
  });
}

function post(path, body) {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: sessionCookie },
    body: JSON.stringify(body),
  });
}

function patch(path, body) {
  return fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: sessionCookie },
    body: JSON.stringify(body),
  });
}

function del(path) {
  return fetch(`${BASE}${path}`, {
    method: "DELETE",
    headers: { Cookie: sessionCookie },
  });
}

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failures.push({ name, error: e.message });
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg ?? "Assertion failed");
}
function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg ?? `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function assertIn(arr, val, msg) {
  if (!arr.includes(val)) throw new Error(msg ?? `Expected one of [${arr}], got ${val}`);
}

// ── State shared across tests ─────────────────────────────────────────────────
let createdPlanId = null;
let createdStopId = null;

// ── Coords that have leads in the DB (via marinas in BC/ON) ──────────────────
// Use a broad radius to hit any data
const TEST_LAT = 49.2827;
const TEST_LNG = -123.1207; // Vancouver BC

// ── Test Suites ───────────────────────────────────────────────────────────────
async function runAll() {
  console.log("\n=== Territory Routing + Travel Engine Tests ===\n");

  const loggedIn = await login();
  assert(loggedIn, "Login failed");

  // ── 1. AUTH GUARDS ──────────────────────────────────────────────────────────
  console.log("\n--- Auth Guards ---");

  await test("GET /api/routing/nearby-ranked without auth returns 401", async () => {
    const r = await fetch(`${BASE}/api/routing/nearby-ranked?lat=49&lng=-123`);
    assertEqual(r.status, 401);
  });

  await test("GET /api/routing/plans without auth returns 401", async () => {
    const r = await fetch(`${BASE}/api/routing/plans`);
    assertEqual(r.status, 401);
  });

  await test("GET /api/routing/suggestions without auth returns 401", async () => {
    const r = await fetch(`${BASE}/api/routing/suggestions?lat=49&lng=-123`);
    assertEqual(r.status, 401);
  });

  await test("POST /api/routing/plans without auth returns 401", async () => {
    const r = await fetch(`${BASE}/api/routing/plans`, { method: "POST" });
    assertEqual(r.status, 401);
  });

  // ── 2. NEARBY RANKED — PARAMETER VALIDATION ─────────────────────────────────
  console.log("\n--- Nearby Ranked: Input Validation ---");

  await test("GET /api/routing/nearby-ranked without lat/lng returns 400", async () => {
    const r = await get("/api/routing/nearby-ranked");
    assertEqual(r.status, 400);
    const body = await r.json();
    assert(body.message, "Should have error message");
  });

  await test("GET /api/routing/nearby-ranked with lat only returns 400", async () => {
    const r = await get("/api/routing/nearby-ranked?lat=49.28");
    assertEqual(r.status, 400);
  });

  await test("GET /api/routing/nearby-ranked returns valid structure", async () => {
    const r = await get(`/api/routing/nearby-ranked?lat=${TEST_LAT}&lng=${TEST_LNG}&radius=500&maxStops=10`);
    assertEqual(r.status, 200);
    const body = await r.json();
    assert(Array.isArray(body.stops), "stops should be array");
    assert(typeof body.total === "number", "total should be number");
    assert(typeof body.radiusKm === "number", "radiusKm should be number");
    assertEqual(body.lat, TEST_LAT);
    assertEqual(body.lng, TEST_LNG);
  });

  // ── 3. RANKING LOGIC ────────────────────────────────────────────────────────
  console.log("\n--- Ranking Logic ---");

  await test("Ranked stops have required fields", async () => {
    const r = await get(`/api/routing/nearby-ranked?lat=${TEST_LAT}&lng=${TEST_LNG}&radius=500&maxStops=20`);
    const { stops } = await r.json();
    if (stops.length > 0) {
      const s = stops[0];
      assert(typeof s.entityType === "string", "entityType missing");
      assert(typeof s.entityId === "number", "entityId missing");
      assert(typeof s.entityName === "string", "entityName missing");
      assert(typeof s.distanceKm === "number", "distanceKm missing");
      assert(typeof s.predictiveScore === "number", "predictiveScore missing");
      assert(typeof s.compositeScore === "number", "compositeScore missing");
      assert(Array.isArray(s.reasons), "reasons should be array");
      assert(s.reasons.length > 0, "reasons should not be empty");
      assert(typeof s.link === "string", "link missing");
      assert(typeof s.priorityColor === "string", "priorityColor missing");
    }
  });

  await test("Ranked stops are ordered by compositeScore descending", async () => {
    const r = await get(`/api/routing/nearby-ranked?lat=${TEST_LAT}&lng=${TEST_LNG}&radius=500&maxStops=30`);
    const { stops } = await r.json();
    for (let i = 0; i < stops.length - 1; i++) {
      assert(
        stops[i].compositeScore >= stops[i + 1].compositeScore,
        `Stop ${i} (${stops[i].compositeScore}) not >= stop ${i+1} (${stops[i+1].compositeScore})`
      );
    }
  });

  await test("compositeScore is between 0 and 100", async () => {
    const r = await get(`/api/routing/nearby-ranked?lat=${TEST_LAT}&lng=${TEST_LNG}&radius=500&maxStops=30`);
    const { stops } = await r.json();
    for (const s of stops) {
      assert(s.compositeScore >= 0 && s.compositeScore <= 100,
        `compositeScore ${s.compositeScore} out of range for ${s.entityName}`);
    }
  });

  await test("predictiveScore is between 0 and 100", async () => {
    const r = await get(`/api/routing/nearby-ranked?lat=${TEST_LAT}&lng=${TEST_LNG}&radius=500&maxStops=30`);
    const { stops } = await r.json();
    for (const s of stops) {
      assert(s.predictiveScore >= 0 && s.predictiveScore <= 100,
        `predictiveScore ${s.predictiveScore} out of range`);
    }
  });

  await test("priorityColor is one of valid values", async () => {
    const r = await get(`/api/routing/nearby-ranked?lat=${TEST_LAT}&lng=${TEST_LNG}&radius=500&maxStops=30`);
    const { stops } = await r.json();
    for (const s of stops) {
      assertIn(["red","orange","yellow","green"], s.priorityColor, `Invalid color: ${s.priorityColor}`);
    }
  });

  await test("entityType is one of valid values", async () => {
    const r = await get(`/api/routing/nearby-ranked?lat=${TEST_LAT}&lng=${TEST_LNG}&radius=500&maxStops=30`);
    const { stops } = await r.json();
    for (const s of stops) {
      assertIn(["lead","account","opportunity","deployment"], s.entityType, `Invalid type: ${s.entityType}`);
    }
  });

  await test("reasons contain distance string", async () => {
    const r = await get(`/api/routing/nearby-ranked?lat=${TEST_LAT}&lng=${TEST_LNG}&radius=500&maxStops=10`);
    const { stops } = await r.json();
    if (stops.length > 0) {
      const s = stops[0];
      const hasDistance = s.reasons.some(r => r.includes("km"));
      assert(hasDistance, `First reason should include 'km', got: ${JSON.stringify(s.reasons)}`);
    }
  });

  // ── 4. NEARBY FILTERING ─────────────────────────────────────────────────────
  console.log("\n--- Nearby Filtering ---");

  await test("Types filter: only leads returned when types=lead", async () => {
    const r = await get(`/api/routing/nearby-ranked?lat=${TEST_LAT}&lng=${TEST_LNG}&radius=500&maxStops=30&types=lead`);
    const { stops } = await r.json();
    for (const s of stops) {
      assertEqual(s.entityType, "lead", `Expected only leads, got: ${s.entityType}`);
    }
  });

  await test("Types filter: only accounts returned when types=account", async () => {
    const r = await get(`/api/routing/nearby-ranked?lat=${TEST_LAT}&lng=${TEST_LNG}&radius=500&maxStops=30&types=account`);
    const { stops } = await r.json();
    for (const s of stops) {
      assertEqual(s.entityType, "account", `Expected only accounts, got: ${s.entityType}`);
    }
  });

  await test("Radius capping: stops within radius", async () => {
    const smallRadius = 5;
    const r = await get(`/api/routing/nearby-ranked?lat=${TEST_LAT}&lng=${TEST_LNG}&radius=${smallRadius}&maxStops=50`);
    const { stops } = await r.json();
    for (const s of stops) {
      assert(s.distanceKm <= smallRadius + 0.5, // small tolerance for floating point
        `Stop ${s.entityName} distance ${s.distanceKm} exceeds radius ${smallRadius}`);
    }
  });

  await test("maxStops limits result count", async () => {
    const r = await get(`/api/routing/nearby-ranked?lat=${TEST_LAT}&lng=${TEST_LNG}&radius=500&maxStops=3`);
    const { stops } = await r.json();
    assert(stops.length <= 3, `Expected <= 3 stops, got ${stops.length}`);
  });

  await test("scoreThreshold filters out low-score stops", async () => {
    const r = await get(`/api/routing/nearby-ranked?lat=${TEST_LAT}&lng=${TEST_LNG}&radius=500&maxStops=50&scoreThreshold=60`);
    const { stops } = await r.json();
    for (const s of stops) {
      assert(s.predictiveScore >= 60, `Score ${s.predictiveScore} below threshold 60`);
    }
  });

  await test("urgencyFilter=overdue returns only stops with overdue in reasons", async () => {
    const r = await get(`/api/routing/nearby-ranked?lat=${TEST_LAT}&lng=${TEST_LNG}&radius=500&maxStops=30&urgencyFilter=overdue`);
    const { stops } = await r.json();
    for (const s of stops) {
      const hasOverdue = s.reasons.some(r => r.toLowerCase().includes("overdue"));
      assert(hasOverdue, `Stop ${s.entityName} missing overdue reason: ${JSON.stringify(s.reasons)}`);
    }
  });

  await test("urgencyFilter=hot returns only high/critical scoring stops", async () => {
    const r = await get(`/api/routing/nearby-ranked?lat=${TEST_LAT}&lng=${TEST_LNG}&radius=500&maxStops=30&urgencyFilter=hot`);
    const { stops } = await r.json();
    for (const s of stops) {
      assertIn(["critical","high"], s.scoreLabel, `Stop has non-hot label: ${s.scoreLabel}`);
    }
  });

  // ── 5. DIRECTIONS URL GENERATION ────────────────────────────────────────────
  console.log("\n--- Direction Link Generation ---");

  await test("GET /api/routing/directions returns google, apple, waze URLs", async () => {
    const r = await get("/api/routing/directions?lat=49.28&lng=-123.12&label=Test+Marina");
    assertEqual(r.status, 200);
    const body = await r.json();
    assert(typeof body.google === "string", "google URL missing");
    assert(typeof body.apple === "string", "apple URL missing");
    assert(typeof body.waze === "string", "waze URL missing");
  });

  await test("Google directions URL contains lat/lng", async () => {
    const r = await get("/api/routing/directions?lat=49.28&lng=-123.12&label=Test");
    const { google } = await r.json();
    assert(google.includes("49.28"), "Google URL missing lat");
    assert(google.includes("-123.12"), "Google URL missing lng");
  });

  await test("Apple directions URL starts with maps://", async () => {
    const r = await get("/api/routing/directions?lat=49.28&lng=-123.12&label=Test");
    const { apple } = await r.json();
    assert(apple.startsWith("maps://"), `Apple URL should start with maps://, got: ${apple}`);
  });

  await test("Waze directions URL contains waze.com", async () => {
    const r = await get("/api/routing/directions?lat=49.28&lng=-123.12&label=Test");
    const { waze } = await r.json();
    assert(waze.includes("waze.com"), `Waze URL should contain waze.com, got: ${waze}`);
  });

  await test("GET /api/routing/directions without coords returns 400", async () => {
    const r = await get("/api/routing/directions");
    assertEqual(r.status, 400);
  });

  // ── 6. TRIP PLAN CRUD ────────────────────────────────────────────────────────
  console.log("\n--- Trip Plan CRUD ---");

  await test("GET /api/routing/plans returns array", async () => {
    const r = await get("/api/routing/plans");
    assertEqual(r.status, 200);
    const body = await r.json();
    assert(Array.isArray(body), "Should return array");
  });

  await test("POST /api/routing/plans creates a plan", async () => {
    const r = await post("/api/routing/plans", {
      name: "Test Trip BC Coast",
      radiusKm: 75,
      maxStops: 8,
      notes: "Automated test trip",
    });
    assertEqual(r.status, 201);
    const body = await r.json();
    assert(body.id, "Should have id");
    assertEqual(body.name, "Test Trip BC Coast");
    assertEqual(body.status, "draft");
    assert(Math.abs(body.radius_km - 75) < 0.01, `Expected radiusKm 75, got ${body.radius_km}`);
    createdPlanId = body.id;
  });

  await test("POST /api/routing/plans without name returns 400", async () => {
    const r = await post("/api/routing/plans", { radiusKm: 50 });
    assertEqual(r.status, 400);
  });

  await test("GET /api/routing/plans/:id returns plan with stops array", async () => {
    const r = await get(`/api/routing/plans/${createdPlanId}`);
    assertEqual(r.status, 200);
    const body = await r.json();
    assertEqual(body.id, createdPlanId);
    assert(Array.isArray(body.stops), "Should have stops array");
    assertEqual(body.stops.length, 0);
  });

  await test("GET /api/routing/plans/:id for non-existent returns 404", async () => {
    const r = await get("/api/routing/plans/99999999");
    assertEqual(r.status, 404);
  });

  await test("PATCH /api/routing/plans/:id updates plan name", async () => {
    const r = await patch(`/api/routing/plans/${createdPlanId}`, {
      name: "Updated Trip Name",
      status: "active",
    });
    assertEqual(r.status, 200);
    const body = await r.json();
    assertEqual(body.name, "Updated Trip Name");
    assertEqual(body.status, "active");
  });

  // ── 7. TRIP STOP CRUD ────────────────────────────────────────────────────────
  console.log("\n--- Trip Stop CRUD ---");

  await test("POST /api/routing/plans/:id/stops adds a stop", async () => {
    const r = await post(`/api/routing/plans/${createdPlanId}/stops`, {
      entityType: "lead",
      entityId: 1,
      entityName: "Test Marina Lead",
      entitySubtype: "prospect",
      lat: 49.28,
      lng: -123.12,
      address: "123 Test St, Vancouver",
      score: 72,
      compositeScore: 65.5,
      rank: 1,
      reasons: ["3.2 km away", "Lead score 72 (high)", "1 overdue task"],
      sortOrder: 0,
    });
    assertEqual(r.status, 201);
    const body = await r.json();
    assert(body.id, "Should have stop id");
    assertEqual(body.entity_type, "lead");
    assertEqual(body.entity_id, 1);
    assertEqual(body.entity_name, "Test Marina Lead");
    assert(!body.visited, "Should not be visited");
    createdStopId = body.id;
  });

  await test("POST /api/routing/plans/:id/stops without required fields returns 400", async () => {
    const r = await post(`/api/routing/plans/${createdPlanId}/stops`, {
      entityId: 2,
    });
    assertEqual(r.status, 400);
  });

  await test("GET /api/routing/plans/:id shows added stop", async () => {
    const r = await get(`/api/routing/plans/${createdPlanId}`);
    const body = await r.json();
    assertEqual(body.stops.length, 1);
    assertEqual(body.stops[0].id, createdStopId);
  });

  await test("PATCH /api/routing/plans/:id/stops/:stopId marks stop as visited", async () => {
    const r = await patch(`/api/routing/plans/${createdPlanId}/stops/${createdStopId}`, {
      visited: true,
      visitNotes: "Great meeting with the marina manager",
    });
    assertEqual(r.status, 200);
    const body = await r.json();
    assert(body.visited, "Should be visited");
    assert(body.visit_notes, "Should have visit notes");
    assert(body.visited_at, "Should have visited_at timestamp");
  });

  await test("PATCH stop: unmark visited clears visited_at", async () => {
    const r = await patch(`/api/routing/plans/${createdPlanId}/stops/${createdStopId}`, {
      visited: false,
    });
    assertEqual(r.status, 200);
    const body = await r.json();
    assert(!body.visited, "Should not be visited");
    assert(!body.visited_at, "visited_at should be cleared");
  });

  await test("PATCH stop: update sortOrder", async () => {
    const r = await patch(`/api/routing/plans/${createdPlanId}/stops/${createdStopId}`, {
      sortOrder: 5,
    });
    assertEqual(r.status, 200);
    const body = await r.json();
    assertEqual(parseInt(body.sort_order), 5);
  });

  await test("GET /api/routing/plans lists plan with stop_count", async () => {
    const r = await get("/api/routing/plans");
    const plans = await r.json();
    const plan = plans.find(p => p.id === createdPlanId);
    assert(plan, "Should find the created plan");
    assertEqual(parseInt(plan.stop_count), 1);
  });

  await test("DELETE /api/routing/plans/:id/stops/:stopId removes stop", async () => {
    const r = await del(`/api/routing/plans/${createdPlanId}/stops/${createdStopId}`);
    assertEqual(r.status, 200);
    const planR = await get(`/api/routing/plans/${createdPlanId}`);
    const plan = await planR.json();
    assertEqual(plan.stops.length, 0);
  });

  // ── 8. TRIP COMPLETION ───────────────────────────────────────────────────────
  console.log("\n--- Trip Lifecycle ---");

  await test("PATCH /api/routing/plans/:id with status=completed marks plan complete", async () => {
    const r = await patch(`/api/routing/plans/${createdPlanId}`, { status: "completed" });
    assertEqual(r.status, 200);
    const body = await r.json();
    assertEqual(body.status, "completed");
  });

  await test("DELETE /api/routing/plans/:id deletes plan and stops", async () => {
    // Add a stop first then delete the plan
    await post(`/api/routing/plans/${createdPlanId}/stops`, {
      entityType: "account", entityId: 10, entityName: "Test Account", sortOrder: 0,
    });
    const r = await del(`/api/routing/plans/${createdPlanId}`);
    assertEqual(r.status, 200);
    const checkR = await get(`/api/routing/plans/${createdPlanId}`);
    assertEqual(checkR.status, 404);
  });

  // ── 9. ROUTE SUGGESTIONS ─────────────────────────────────────────────────────
  console.log("\n--- Route Suggestions ---");

  await test("GET /api/routing/suggestions without coords returns empty suggestions", async () => {
    const r = await get("/api/routing/suggestions");
    assertEqual(r.status, 200);
    const body = await r.json();
    assert(Array.isArray(body.suggestions), "Should return suggestions array");
    assertEqual(body.suggestions.length, 0, "No coords = no suggestions");
  });

  await test("GET /api/routing/suggestions with coords returns array", async () => {
    const r = await get(`/api/routing/suggestions?lat=${TEST_LAT}&lng=${TEST_LNG}`);
    assertEqual(r.status, 200);
    const body = await r.json();
    assert(Array.isArray(body.suggestions), "Should return suggestions array");
  });

  await test("Route suggestions have required shape", async () => {
    const r = await get(`/api/routing/suggestions?lat=${TEST_LAT}&lng=${TEST_LNG}`);
    const { suggestions } = await r.json();
    for (const s of suggestions) {
      assert(typeof s.title === "string", "title missing");
      assert(typeof s.subtitle === "string", "subtitle missing");
      assert(typeof s.count === "number", "count missing");
      assert(typeof s.type === "string", "type missing");
      assert(typeof s.link === "string", "link missing");
    }
  });

  // ── 10. COMMAND CENTER INTEGRATION ──────────────────────────────────────────
  console.log("\n--- Command Center Integration ---");

  await test("GET /api/daily-command-center still returns 200 (no regression)", async () => {
    const r = await get("/api/daily-command-center");
    assertEqual(r.status, 200);
    const body = await r.json();
    assert(body.sections, "Should have sections");
  });

  await test("GET /api/scores/hot-list still returns 200 (no regression)", async () => {
    const r = await get("/api/scores/hot-list");
    assertEqual(r.status, 200);
    const body = await r.json();
    assert(Array.isArray(body), "Should return array");
  });

  // ── 11. GEO + FIELD MODE REGRESSION ─────────────────────────────────────────
  console.log("\n--- Geo & Field Mode Regression ---");

  await test("GET /api/leads/nearby still works (no regression)", async () => {
    const r = await get(`/api/leads/nearby?lat=${TEST_LAT}&lng=${TEST_LNG}&radius=500`);
    assertEqual(r.status, 200);
    const body = await r.json();
    assert(Array.isArray(body), "Should return array");
  });

  await test("GET /api/geocode/search still works (no regression)", async () => {
    const r = await get("/api/geocode/search?q=Vancouver+BC");
    assertEqual(r.status, 200);
    const body = await r.json();
    assert(body.lat, "Should have lat");
    assert(body.lng, "Should have lng");
  });

  await test("GET /api/territories still works (no regression)", async () => {
    const r = await get("/api/territories");
    assertEqual(r.status, 200);
    const body = await r.json();
    assert(Array.isArray(body), "Should return array");
  });

  await test("GET /api/analytics/geo/overview still works (no regression)", async () => {
    const r = await get("/api/analytics/geo/overview");
    assertEqual(r.status, 200);
  });

  await test("GET /api/dashboard/today still works (field mode, no regression)", async () => {
    const r = await get("/api/dashboard/today");
    assertEqual(r.status, 200);
    const body = await r.json();
    assert(body.stats || body.tasksDueToday !== undefined, "Should have dashboard data");
  });

  await test("GET /api/procurement/blocked-installs still works (no regression)", async () => {
    const r = await get("/api/procurement/blocked-installs");
    assertEqual(r.status, 200);
  });

  // ── 12. SCORING REGRESSION ───────────────────────────────────────────────────
  console.log("\n--- Scoring Regression ---");

  await test("GET /api/scores/feedback/overview still works", async () => {
    const r = await get("/api/scores/feedback/overview");
    assertEqual(r.status, 200);
  });

  await test("GET /api/scores/accuracy still works", async () => {
    const r = await get("/api/scores/accuracy");
    assertEqual(r.status, 200);
  });

  await test("GET /api/scores/recommendations still works", async () => {
    const r = await get("/api/scores/recommendations");
    assertEqual(r.status, 200);
  });

  // ── 13. MULTI-TYPE RANKING ────────────────────────────────────────────────────
  console.log("\n--- Multi-Type Ranking ---");

  await test("Multi-type query returns mixed entity types", async () => {
    const r = await get(`/api/routing/nearby-ranked?lat=${TEST_LAT}&lng=${TEST_LNG}&radius=500&maxStops=50&types=lead,account,opportunity,deployment`);
    const { stops } = await r.json();
    const types = new Set(stops.map(s => s.entityType));
    // At minimum should have leads and/or accounts (most common with coords)
    assert(types.size > 0, "Should return at least one entity type");
  });

  await test("Opportunities query returns opportunity type stops", async () => {
    const r = await get(`/api/routing/nearby-ranked?lat=${TEST_LAT}&lng=${TEST_LNG}&radius=500&maxStops=30&types=opportunity`);
    const { stops } = await r.json();
    for (const s of stops) {
      assertEqual(s.entityType, "opportunity");
    }
  });

  await test("Deployments query returns deployment type stops", async () => {
    const r = await get(`/api/routing/nearby-ranked?lat=${TEST_LAT}&lng=${TEST_LNG}&radius=500&maxStops=30&types=deployment`);
    const { stops } = await r.json();
    for (const s of stops) {
      assertEqual(s.entityType, "deployment");
    }
  });

  await test("Leads have link starting with /leads/", async () => {
    const r = await get(`/api/routing/nearby-ranked?lat=${TEST_LAT}&lng=${TEST_LNG}&radius=500&maxStops=10&types=lead`);
    const { stops } = await r.json();
    for (const s of stops) {
      assert(s.link.startsWith("/leads/"), `Expected /leads/ link, got: ${s.link}`);
    }
  });

  await test("Accounts have link starting with /accounts/", async () => {
    const r = await get(`/api/routing/nearby-ranked?lat=${TEST_LAT}&lng=${TEST_LNG}&radius=500&maxStops=10&types=account`);
    const { stops } = await r.json();
    for (const s of stops) {
      assert(s.link.startsWith("/accounts/"), `Expected /accounts/ link, got: ${s.link}`);
    }
  });

  // ── SUMMARY ──────────────────────────────────────────────────────────────────
  console.log("\n============================================================");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log("\n  Failures:");
    failures.forEach(f => console.log(`  ✗ ${f.name}: ${f.error}`));
  }
  console.log("============================================================\n");

  process.exit(failed > 0 ? 1 : 0);
}

runAll().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
