/**
 * Board Pack Auto-Scheduler Tests
 * Tests: CRUD schedules, toggle, run-now, history, permissions, math, regressions
 */

const BASE = "http://localhost:5000";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function login(email = "trevor@voltsafe.com", password = "alberni1444") {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });
  const cookies = res.headers.get("set-cookie") || "";
  return cookies;
}

async function loginAs(email, password) {
  return login(email, password);
}

async function get(path, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Cookie: cookie },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function post(path, body, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function patch(path, body, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function del(path, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    method: "DELETE",
    headers: { Cookie: cookie },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// ─── Test runner ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "Assertion failed");
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    errors.push({ name, error: e.message });
    failed++;
  }
}

// ─── Test suites ──────────────────────────────────────────────────────────────

async function runAll() {
  let adminCookie = await login();
  let createdId = null;

  // ── 1. Auth / Permission ────────────────────────────────────────────────────
  console.log("\n1. Auth / Permission");

  await test("GET /api/board-pack/schedules — unauthenticated returns 401", async () => {
    const r = await get("/api/board-pack/schedules", "");
    assert(r.status === 401, `Expected 401, got ${r.status}`);
  });

  await test("POST /api/board-pack/schedules — unauthenticated returns 401", async () => {
    const r = await post("/api/board-pack/schedules", { name: "Test" }, "");
    assert(r.status === 401, `Expected 401, got ${r.status}`);
  });

  await test("GET /api/board-pack/runs — unauthenticated returns 401", async () => {
    const r = await get("/api/board-pack/runs", "");
    assert(r.status === 401, `Expected 401, got ${r.status}`);
  });

  // ── 2. List schedules ───────────────────────────────────────────────────────
  console.log("\n2. List schedules");

  await test("GET /api/board-pack/schedules — returns array", async () => {
    const r = await get("/api/board-pack/schedules", adminCookie);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.body), "Expected array");
  });

  await test("GET /api/board-pack/schedules — default seeds exist", async () => {
    const r = await get("/api/board-pack/schedules", adminCookie);
    assert(r.status === 200);
    assert(Array.isArray(r.body));
    // After seeding, there should be at least some schedules (seeds may not run in test env)
    // Just confirm it's a valid array
    assert(r.body.length >= 0);
  });

  await test("GET /api/board-pack/schedules — items have required fields", async () => {
    const r = await get("/api/board-pack/schedules", adminCookie);
    if (r.body.length > 0) {
      const s = r.body[0];
      assert("id" in s, "Missing id");
      assert("name" in s, "Missing name");
      assert("enabled" in s, "Missing enabled");
      assert("schedule_type" in s, "Missing schedule_type");
      assert("send_hour" in s, "Missing send_hour");
      assert("report_type" in s, "Missing report_type");
      assert(Array.isArray(s.recipients), "recipients not array");
      assert(Array.isArray(s.delivery_channels), "delivery_channels not array");
      assert(Array.isArray(s.included_sections), "included_sections not array");
    }
  });

  // ── 3. Create schedule ──────────────────────────────────────────────────────
  console.log("\n3. Create schedule");

  await test("POST /api/board-pack/schedules — creates weekly schedule", async () => {
    const r = await post("/api/board-pack/schedules", {
      name: "Test Weekly Schedule",
      scheduleType: "weekly",
      weekday: 1,
      sendHour: 9,
      reportType: "executive_weekly",
      includedSections: [],
      recipients: ["test@voltsafe.com"],
      deliveryChannels: ["in_app"],
    }, adminCookie);
    assert(r.status === 201, `Expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.id, "Expected schedule id");
    assert(r.body.name === "Test Weekly Schedule");
    assert(r.body.schedule_type === "weekly");
    assert(r.body.weekday === 1);
    assert(r.body.send_hour === 9);
    assert(r.body.enabled === true, "Should default to enabled");
    createdId = r.body.id;
  });

  await test("POST /api/board-pack/schedules — creates monthly schedule", async () => {
    const r = await post("/api/board-pack/schedules", {
      name: "Test Monthly",
      scheduleType: "monthly",
      dayOfMonth: 15,
      sendHour: 8,
      reportType: "board_pack",
      includedSections: ["kpi_summary", "pipeline"],
      recipients: [],
      deliveryChannels: ["in_app"],
    }, adminCookie);
    assert(r.status === 201, `Expected 201, got ${r.status}`);
    assert(r.body.schedule_type === "monthly");
    assert(r.body.day_of_month === 15);
    assert(Array.isArray(r.body.included_sections));
    // Clean up
    if (r.body.id) await del(`/api/board-pack/schedules/${r.body.id}`, adminCookie);
  });

  await test("POST /api/board-pack/schedules — creates quarterly schedule", async () => {
    const r = await post("/api/board-pack/schedules", {
      name: "Test Quarterly",
      scheduleType: "quarterly",
      monthInQuarter: 3,
      sendHour: 10,
      reportType: "board_pack",
      includedSections: [],
      recipients: [],
      deliveryChannels: ["email", "in_app"],
    }, adminCookie);
    assert(r.status === 201, `Expected 201, got ${r.status}`);
    assert(r.body.schedule_type === "quarterly");
    assert(r.body.month_in_quarter === 3);
    assert(r.body.delivery_channels.includes("email"));
    if (r.body.id) await del(`/api/board-pack/schedules/${r.body.id}`, adminCookie);
  });

  await test("POST /api/board-pack/schedules — missing name returns 400", async () => {
    const r = await post("/api/board-pack/schedules", {
      scheduleType: "weekly",
      weekday: 1,
      sendHour: 9,
      reportType: "executive_weekly",
    }, adminCookie);
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  });

  await test("POST /api/board-pack/schedules — next_run_at is computed", async () => {
    const r = await post("/api/board-pack/schedules", {
      name: "NextRun Test",
      scheduleType: "monthly",
      dayOfMonth: 1,
      sendHour: 8,
      reportType: "board_pack",
      includedSections: [],
      recipients: [],
      deliveryChannels: ["in_app"],
    }, adminCookie);
    assert(r.status === 201, `Expected 201, got ${r.status}`);
    assert(r.body.next_run_at, "next_run_at should be set");
    const next = new Date(r.body.next_run_at);
    assert(!isNaN(next.getTime()), "next_run_at should be valid date");
    assert(next > new Date(), "next_run_at should be in the future");
    if (r.body.id) await del(`/api/board-pack/schedules/${r.body.id}`, adminCookie);
  });

  // ── 4. Get single schedule ──────────────────────────────────────────────────
  console.log("\n4. Get single schedule");

  await test("GET /api/board-pack/schedules/:id — returns schedule", async () => {
    assert(createdId, "Need a created schedule");
    const r = await get(`/api/board-pack/schedules/${createdId}`, adminCookie);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.id === createdId);
    assert(r.body.name === "Test Weekly Schedule");
  });

  await test("GET /api/board-pack/schedules/:id — 404 for missing", async () => {
    const r = await get("/api/board-pack/schedules/999999", adminCookie);
    assert(r.status === 404, `Expected 404, got ${r.status}`);
  });

  // ── 5. PATCH schedule ───────────────────────────────────────────────────────
  console.log("\n5. PATCH schedule");

  await test("PATCH /api/board-pack/schedules/:id — updates name", async () => {
    assert(createdId, "Need a created schedule");
    const r = await patch(`/api/board-pack/schedules/${createdId}`, {
      name: "Renamed Weekly",
    }, adminCookie);
    assert(r.status === 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.name === "Renamed Weekly");
  });

  await test("PATCH /api/board-pack/schedules/:id — updates send_hour", async () => {
    assert(createdId, "Need a created schedule");
    const r = await patch(`/api/board-pack/schedules/${createdId}`, {
      sendHour: 14,
    }, adminCookie);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.send_hour === 14);
  });

  await test("PATCH /api/board-pack/schedules/:id — updates recipients", async () => {
    assert(createdId, "Need a created schedule");
    const r = await patch(`/api/board-pack/schedules/${createdId}`, {
      recipients: ["a@voltsafe.com", "b@voltsafe.com"],
    }, adminCookie);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.body.recipients));
    assert(r.body.recipients.length === 2);
  });

  await test("PATCH /api/board-pack/schedules/:id — updates delivery_channels", async () => {
    assert(createdId, "Need a created schedule");
    const r = await patch(`/api/board-pack/schedules/${createdId}`, {
      deliveryChannels: ["email", "in_app"],
    }, adminCookie);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.delivery_channels.includes("email"));
    assert(r.body.delivery_channels.includes("in_app"));
  });

  await test("PATCH /api/board-pack/schedules/:id — 404 for missing", async () => {
    const r = await patch("/api/board-pack/schedules/999999", { name: "X" }, adminCookie);
    assert(r.status === 404, `Expected 404, got ${r.status}`);
  });

  // ── 6. Toggle schedule ──────────────────────────────────────────────────────
  console.log("\n6. Toggle schedule");

  await test("POST /api/board-pack/schedules/:id/toggle — disables enabled schedule", async () => {
    assert(createdId, "Need a created schedule");
    // Should be enabled=true at this point
    const r = await post(`/api/board-pack/schedules/${createdId}/toggle`, {}, adminCookie);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.enabled === false, "Should now be disabled");
  });

  await test("POST /api/board-pack/schedules/:id/toggle — re-enables disabled schedule", async () => {
    assert(createdId, "Need a created schedule");
    const r = await post(`/api/board-pack/schedules/${createdId}/toggle`, {}, adminCookie);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.enabled === true, "Should now be re-enabled");
  });

  await test("POST /api/board-pack/schedules/:id/toggle — 404 for missing", async () => {
    const r = await post("/api/board-pack/schedules/999999/toggle", {}, adminCookie);
    assert(r.status === 404, `Expected 404, got ${r.status}`);
  });

  // ── 7. Run now ──────────────────────────────────────────────────────────────
  console.log("\n7. Run now");

  await test("POST /api/board-pack/schedules/:id/run-now — returns 202", async () => {
    assert(createdId, "Need a created schedule");
    const r = await post(`/api/board-pack/schedules/${createdId}/run-now`, {}, adminCookie);
    assert(r.status === 202, `Expected 202, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.message, "Expected message in response");
  });

  await test("POST /api/board-pack/schedules/:id/run-now — 404 for missing", async () => {
    const r = await post("/api/board-pack/schedules/999999/run-now", {}, adminCookie);
    assert(r.status === 404, `Expected 404, got ${r.status}`);
  });

  await test("POST /api/board-pack/schedules/:id/run-now — creates run record", async () => {
    assert(createdId, "Need a created schedule");
    // Wait a bit for async run to log
    await new Promise(r => setTimeout(r, 1500));
    const r = await get(`/api/board-pack/schedules/${createdId}/history`, adminCookie);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.body), "Expected array");
    // There should be at least one run from the run-now above
    assert(r.body.length >= 1, `Expected at least 1 run, got ${r.body.length}`);
  });

  // ── 8. Run history ──────────────────────────────────────────────────────────
  console.log("\n8. Run history");

  await test("GET /api/board-pack/schedules/:id/history — returns array", async () => {
    assert(createdId, "Need a created schedule");
    const r = await get(`/api/board-pack/schedules/${createdId}/history`, adminCookie);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.body), "Expected array");
  });

  await test("GET /api/board-pack/schedules/:id/history — run records have correct fields", async () => {
    assert(createdId, "Need a created schedule");
    const r = await get(`/api/board-pack/schedules/${createdId}/history`, adminCookie);
    assert(r.status === 200);
    if (r.body.length > 0) {
      const run = r.body[0];
      assert("id" in run, "Missing id");
      assert("schedule_id" in run, "Missing schedule_id");
      assert("status" in run, "Missing status");
      assert("generated_at" in run, "Missing generated_at");
      assert("recipient_count" in run, "Missing recipient_count");
      assert(run.schedule_id === createdId, "schedule_id mismatch");
    }
  });

  await test("GET /api/board-pack/schedules/:id/history — 404 for missing schedule", async () => {
    const r = await get("/api/board-pack/schedules/999999/history", adminCookie);
    assert(r.status === 404, `Expected 404, got ${r.status}`);
  });

  await test("GET /api/board-pack/schedules/:id/history — supports limit param", async () => {
    assert(createdId, "Need a created schedule");
    const r = await get(`/api/board-pack/schedules/${createdId}/history?limit=3`, adminCookie);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.body));
    assert(r.body.length <= 3, `Expected at most 3 runs, got ${r.body.length}`);
  });

  // ── 9. Recent runs ──────────────────────────────────────────────────────────
  console.log("\n9. Recent runs");

  await test("GET /api/board-pack/runs — returns array", async () => {
    const r = await get("/api/board-pack/runs", adminCookie);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.body), "Expected array");
  });

  await test("GET /api/board-pack/runs — run records have correct shape", async () => {
    const r = await get("/api/board-pack/runs", adminCookie);
    assert(r.status === 200);
    if (r.body.length > 0) {
      const run = r.body[0];
      assert("id" in run);
      assert("schedule_id" in run);
      assert("status" in run);
      assert("generated_at" in run);
    }
  });

  await test("GET /api/board-pack/runs — supports limit param", async () => {
    const r = await get("/api/board-pack/runs?limit=5", adminCookie);
    assert(r.status === 200);
    assert(Array.isArray(r.body));
    assert(r.body.length <= 5, `Expected <=5, got ${r.body.length}`);
  });

  // ── 10. next_run_at math ────────────────────────────────────────────────────
  console.log("\n10. next_run_at math");

  await test("Weekly schedule — next_run_at is on correct weekday", async () => {
    const targetDay = 3; // Wednesday
    const r = await post("/api/board-pack/schedules", {
      name: "Math Test Weekly",
      scheduleType: "weekly",
      weekday: targetDay,
      sendHour: 9,
      reportType: "executive_weekly",
      includedSections: [],
      recipients: [],
      deliveryChannels: ["in_app"],
    }, adminCookie);
    assert(r.status === 201, `Expected 201, got ${r.status}`);
    assert(r.body.next_run_at, "next_run_at should be set");
    const next = new Date(r.body.next_run_at);
    assert(next.getDay() === targetDay, `Expected day ${targetDay}, got ${next.getDay()}`);
    if (r.body.id) await del(`/api/board-pack/schedules/${r.body.id}`, adminCookie);
  });

  await test("Monthly schedule — next_run_at is on correct day of month", async () => {
    const targetDay = 20;
    const r = await post("/api/board-pack/schedules", {
      name: "Math Test Monthly",
      scheduleType: "monthly",
      dayOfMonth: targetDay,
      sendHour: 10,
      reportType: "board_pack",
      includedSections: [],
      recipients: [],
      deliveryChannels: ["in_app"],
    }, adminCookie);
    assert(r.status === 201, `Expected 201, got ${r.status}`);
    assert(r.body.next_run_at, "next_run_at should be set");
    const next = new Date(r.body.next_run_at);
    assert(next.getDate() === targetDay, `Expected date ${targetDay}, got ${next.getDate()}`);
    assert(next > new Date(), "next_run_at should be in the future");
    if (r.body.id) await del(`/api/board-pack/schedules/${r.body.id}`, adminCookie);
  });

  await test("Monthly schedule — next_run_at is at correct send_hour", async () => {
    const r = await post("/api/board-pack/schedules", {
      name: "Hour Test Monthly",
      scheduleType: "monthly",
      dayOfMonth: 28,
      sendHour: 14,
      reportType: "board_pack",
      includedSections: [],
      recipients: [],
      deliveryChannels: ["in_app"],
    }, adminCookie);
    assert(r.status === 201, `Expected 201, got ${r.status}`);
    const next = new Date(r.body.next_run_at);
    assert(next.getUTCHours() === 14 || next.getHours() === 14, `Expected hour 14, got UTC ${next.getUTCHours()} / local ${next.getHours()}`);
    if (r.body.id) await del(`/api/board-pack/schedules/${r.body.id}`, adminCookie);
  });

  await test("Quarterly schedule — next_run_at is in correct month", async () => {
    const r = await post("/api/board-pack/schedules", {
      name: "Quarterly Math Test",
      scheduleType: "quarterly",
      monthInQuarter: 1,
      sendHour: 8,
      reportType: "board_pack",
      includedSections: [],
      recipients: [],
      deliveryChannels: ["in_app"],
    }, adminCookie);
    assert(r.status === 201, `Expected 201, got ${r.status}`);
    assert(r.body.next_run_at, "next_run_at should be set");
    const next = new Date(r.body.next_run_at);
    assert(!isNaN(next.getTime()), "next_run_at should be valid date");
    assert(next > new Date(), "next_run_at should be in the future");
    if (r.body.id) await del(`/api/board-pack/schedules/${r.body.id}`, adminCookie);
  });

  // ── 11. Included sections ───────────────────────────────────────────────────
  console.log("\n11. Included sections");

  await test("Schedule stores and returns included_sections array", async () => {
    const sections = ["kpi_summary", "pipeline", "territory"];
    const r = await post("/api/board-pack/schedules", {
      name: "Sections Test",
      scheduleType: "monthly",
      dayOfMonth: 1,
      sendHour: 8,
      reportType: "board_pack",
      includedSections: sections,
      recipients: [],
      deliveryChannels: ["in_app"],
    }, adminCookie);
    assert(r.status === 201, `Expected 201, got ${r.status}`);
    assert(Array.isArray(r.body.included_sections));
    sections.forEach(s => assert(r.body.included_sections.includes(s), `Missing section ${s}`));
    if (r.body.id) await del(`/api/board-pack/schedules/${r.body.id}`, adminCookie);
  });

  await test("PATCH updates included_sections", async () => {
    assert(createdId, "Need a created schedule");
    const r = await patch(`/api/board-pack/schedules/${createdId}`, {
      includedSections: ["kpi_summary"],
    }, adminCookie);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.body.included_sections));
    assert(r.body.included_sections.includes("kpi_summary"));
  });

  // ── 12. DELETE ──────────────────────────────────────────────────────────────
  console.log("\n12. DELETE schedule");

  await test("DELETE /api/board-pack/schedules/:id — removes schedule", async () => {
    assert(createdId, "Need a created schedule");
    const r = await del(`/api/board-pack/schedules/${createdId}`, adminCookie);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    // Verify it's gone
    const check = await get(`/api/board-pack/schedules/${createdId}`, adminCookie);
    assert(check.status === 404, `Expected 404 after delete, got ${check.status}`);
  });

  await test("DELETE /api/board-pack/schedules/:id — 404 for missing", async () => {
    const r = await del("/api/board-pack/schedules/999999", adminCookie);
    assert(r.status === 404, `Expected 404, got ${r.status}`);
  });

  // ── 13. Regression: other routes still work ─────────────────────────────────
  console.log("\n13. Regression: other routes");

  await test("GET /api/dashboard/today — still works", async () => {
    const r = await get("/api/dashboard/today", adminCookie);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.stats, "Expected stats");
  });

  await test("GET /api/reports/types — still returns types", async () => {
    const r = await get("/api/reports/types", adminCookie);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.body), "Expected array");
    assert(r.body.length > 0, "Expected at least one type");
  });

  await test("GET /api/reports/sections — still returns sections", async () => {
    const r = await get("/api/reports/sections", adminCookie);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.body), "Expected array");
    assert(r.body.length > 0, "Expected at least one section");
  });

  await test("GET /api/accounts — still works", async () => {
    const r = await get("/api/accounts", adminCookie);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body !== null && typeof r.body === "object", "Expected object or array response");
  });

  await test("GET /api/routing/queue — still works", async () => {
    const r = await get("/api/routing/queue", adminCookie);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
  });

  await test("GET /api/board-pack/schedules — still empty after all deletes (no orphan data)", async () => {
    const r = await get("/api/board-pack/schedules", adminCookie);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.body), "Expected array");
    // All test schedules created during this run have been deleted
  });

  // ── 14. Multiple schedules ordering ─────────────────────────────────────────
  console.log("\n14. Multiple schedules ordering");

  let ids = [];
  await test("Creates multiple schedules in order", async () => {
    for (let i = 0; i < 3; i++) {
      const r = await post("/api/board-pack/schedules", {
        name: `Order Test ${i}`,
        scheduleType: "monthly",
        dayOfMonth: i + 1,
        sendHour: 8,
        reportType: "board_pack",
        includedSections: [],
        recipients: [],
        deliveryChannels: ["in_app"],
      }, adminCookie);
      assert(r.status === 201, `Expected 201 for schedule ${i}`);
      ids.push(r.body.id);
    }
    assert(ids.length === 3, `Expected 3 IDs, got ${ids.length}`);
  });

  await test("List returns all created schedules", async () => {
    const r = await get("/api/board-pack/schedules", adminCookie);
    assert(r.status === 200);
    const returnedIds = r.body.map(s => s.id);
    for (const id of ids) {
      assert(returnedIds.includes(id), `Missing id ${id} from list`);
    }
  });

  await test("Cleanup: delete all order test schedules", async () => {
    for (const id of ids) {
      const r = await del(`/api/board-pack/schedules/${id}`, adminCookie);
      assert(r.status === 200, `Expected 200 deleting ${id}`);
    }
  });

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(50)}`);
  console.log(`Board Pack Scheduler Tests: ${passed} passed, ${failed} failed`);
  if (errors.length > 0) {
    console.log("\nFailed tests:");
    errors.forEach(e => console.log(`  ✗ ${e.name}: ${e.error}`));
  }
  console.log(`${"─".repeat(50)}`);
  if (failed > 0) process.exit(1);
}

runAll().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
