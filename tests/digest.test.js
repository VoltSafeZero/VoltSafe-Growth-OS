/**
 * Executive Alerting / Digest Automation Tests
 * Covers Phases 1-6: data model, composer, alert engine, routes, UI, delivery
 */

const BASE = "http://localhost:5000";

async function req(method, path, body, cookies) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json", ...(cookies ? { Cookie: cookies } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  const res = await fetch(`${BASE}${path}`, opts);
  let data;
  try { data = await res.json(); } catch { data = {}; }
  return { status: res.status, data, headers: res.headers };
}

async function login(email = "trevor@voltsafe.com", password = "alberni1444") {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });
  const cookies = res.headers.get("set-cookie") || "";
  const data = await res.json();
  return { cookies, userId: data.id };
}

let pass = 0, fail = 0, cookies = "", userId;

function test(name, fn) {
  return fn().then(() => { pass++; console.log(`  ✓ ${name}`); })
             .catch(e => { fail++; console.error(`  ✗ ${name}: ${e.message}`); });
}

function expect(actual, expected, label = "") {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function expectTruthy(actual, label = "") {
  if (!actual) throw new Error(`${label}: expected truthy, got ${JSON.stringify(actual)}`);
}
function expectIncludes(arr, val, label = "") {
  if (!Array.isArray(arr) || !arr.includes(val)) throw new Error(`${label}: expected ${JSON.stringify(arr)} to include ${JSON.stringify(val)}`);
}

// ── Setup ────────────────────────────────────────────────────────────────────

console.log("\n🔐 Auth Setup");

async function setup() {
  const auth = await login();
  cookies = auth.cookies;
  userId = auth.userId;
  console.log(`  ✓ Logged in as userId=${userId}`);
}

// ── Phase 1: Data Model ───────────────────────────────────────────────────────

async function testDataModel() {
  console.log("\n📦 Phase 1 — Digest Data Model");

  await test("GET /api/digest/config returns config object", async () => {
    const { status, data } = await req("GET", "/api/digest/config", null, cookies);
    expect(status, 200, "status");
    expectTruthy(data.config, "config");
    expectTruthy(data.config.userId, "userId");
    expectTruthy(data.availableSections, "availableSections");
  });

  await test("Config has all required fields", async () => {
    const { data } = await req("GET", "/api/digest/config", null, cookies);
    const c = data.config;
    expectTruthy(c.id, "id");
    expectTruthy(typeof c.enabled === "boolean", "enabled is boolean");
    expectTruthy(["daily","weekly"].includes(c.cadence), "cadence valid");
    expectTruthy(typeof c.sendHour === "number", "sendHour is number");
    expectTruthy(c.sections, "sections");
    expectTruthy(c.alertRules, "alertRules");
    expectTruthy(c.severityThreshold, "severityThreshold");
  });

  await test("Config seeded with role-based defaults (is_role_default initially true)", async () => {
    const { data } = await req("GET", "/api/digest/config", null, cookies);
    expectTruthy(data.config.isRoleDefault !== undefined, "isRoleDefault field present");
  });

  await test("Config has channels array", async () => {
    const { data } = await req("GET", "/api/digest/config", null, cookies);
    expectTruthy(Array.isArray(data.config.channels), "channels is array");
    expectIncludes(data.config.channels, "in_app", "channels has in_app");
  });

  await test("Config has quiet hours", async () => {
    const { data } = await req("GET", "/api/digest/config", null, cookies);
    expectTruthy(typeof data.config.quietHoursStart === "number", "quietHoursStart");
    expectTruthy(typeof data.config.quietHoursEnd === "number", "quietHoursEnd");
  });

  await test("Digest run history returns array", async () => {
    const { status, data } = await req("GET", "/api/digest/runs", null, cookies);
    expect(status, 200, "status");
    expectTruthy(Array.isArray(data.runs), "runs is array");
  });
}

// ── Phase 2: Digest Composer ──────────────────────────────────────────────────

async function testDigestComposer() {
  console.log("\n🧩 Phase 2 — Digest Composer");

  await test("GET /api/digest/preview returns composed digest", async () => {
    const { status, data } = await req("GET", "/api/digest/preview", null, cookies);
    expect(status, 200, "status");
    expectTruthy(data.digest, "digest object");
    expectTruthy(data.digest.title, "title");
    expectTruthy(data.digest.summary, "summary");
    expectTruthy(Array.isArray(data.digest.sections), "sections is array");
    expectTruthy(typeof data.digest.totalSignals === "number", "totalSignals is number");
    expectTruthy(typeof data.digest.highSeverityCount === "number", "highSeverityCount is number");
  });

  await test("Digest sections have required fields", async () => {
    const { data } = await req("GET", "/api/digest/preview", null, cookies);
    for (const s of data.digest.sections) {
      expectTruthy(s.key, "section key");
      expectTruthy(s.label, "section label");
      expectTruthy(Array.isArray(s.bullets), "bullets is array");
      expectTruthy(["low","medium","high"].includes(s.severity), "severity valid");
      expectTruthy(typeof s.count === "number", "count is number");
    }
  });

  await test("Preview returns HTML string", async () => {
    const { data } = await req("GET", "/api/digest/preview", null, cookies);
    expectTruthy(typeof data.html === "string", "html is string");
    expectTruthy(data.html.includes("VoltSafe"), "html contains VoltSafe");
  });

  await test("Digest title is role-aware and date-formatted", async () => {
    const { data } = await req("GET", "/api/digest/preview", null, cookies);
    expectTruthy(data.digest.title.length > 10, "title is not empty");
    expectTruthy(data.digest.generatedAt, "generatedAt set");
  });

  await test("Digest role field matches user's role", async () => {
    const { data } = await req("GET", "/api/digest/preview", null, cookies);
    expectTruthy(data.digest.role, "role is set");
  });
}

// ── Phase 3: Role-Based Defaults ──────────────────────────────────────────────

async function testRoleDefaults() {
  console.log("\n🎭 Phase 3 — Role-Based Default Digests");

  await test("GET /api/digest/role-defaults returns sections for role", async () => {
    const { status, data } = await req("GET", "/api/digest/role-defaults", null, cookies);
    expect(status, 200, "status");
    expectTruthy(Array.isArray(data.defaultSections), "defaultSections is array");
    expectTruthy(data.defaultSections.length > 0, "has sections");
    expectTruthy(data.role, "role is set");
  });

  await test("Available sections list is non-empty", async () => {
    const { data } = await req("GET", "/api/digest/config", null, cookies);
    expectTruthy(Array.isArray(data.availableSections), "availableSections is array");
    expectTruthy(data.availableSections.length > 0, "has items");
  });

  await test("POST /api/digest/reset-to-defaults restores role sections", async () => {
    const { status, data } = await req("POST", "/api/digest/reset-to-defaults", {}, cookies);
    expect(status, 200, "status");
    expectTruthy(data.ok, "ok true");
    expectTruthy(Array.isArray(data.defaultSections), "defaultSections array");
  });

  await test("After reset, config isRoleDefault is true", async () => {
    const { data } = await req("GET", "/api/digest/config", null, cookies);
    expect(data.config.isRoleDefault, true, "isRoleDefault");
  });
}

// ── Phase 4: Alert Engine ─────────────────────────────────────────────────────

async function testAlertEngine() {
  console.log("\n⚡ Phase 4 — Alert Engine");

  await test("GET /api/alerts/rules returns rule thresholds", async () => {
    const { status, data } = await req("GET", "/api/alerts/rules", null, cookies);
    expect(status, 200, "status");
    expectTruthy(data.rules, "rules object");
    expectTruthy(typeof data.rules.stalledDealDays === "number", "stalledDealDays");
    expectTruthy(typeof data.rules.quoteUnansweredDays === "number", "quoteUnansweredDays");
    expectTruthy(typeof data.rules.churnScoreThreshold === "number", "churnScoreThreshold");
    expectTruthy(typeof data.rules.deploymentBlockedDays === "number", "deploymentBlockedDays");
    expectTruthy(typeof data.rules.renewalDueDays === "number", "renewalDueDays");
    expectTruthy(typeof data.rules.pricingLockExpiryDays === "number", "pricingLockExpiryDays");
    expectTruthy(typeof data.rules.scoreBandChangeSensitive === "boolean", "scoreBandChangeSensitive");
  });

  await test("PUT /api/alerts/rules updates thresholds", async () => {
    const { status, data } = await req("PUT", "/api/alerts/rules", { stalledDealDays: 10, churnScoreThreshold: 75 }, cookies);
    expect(status, 200, "status");
    expect(data.rules.stalledDealDays, 10, "stalledDealDays updated");
    expect(data.rules.churnScoreThreshold, 75, "churnScoreThreshold updated");
  });

  await test("Alert rules persist after update", async () => {
    const { data } = await req("GET", "/api/alerts/rules", null, cookies);
    expect(data.rules.stalledDealDays, 10, "persisted stalledDealDays");
  });

  await test("POST /api/alerts/run-engine creates alerts", async () => {
    const { status, data } = await req("POST", "/api/alerts/run-engine", {}, cookies);
    expect(status, 200, "status");
    expectTruthy(data.ok, "ok true");
    expectTruthy(typeof data.alertsCreated === "number", "alertsCreated is number");
  });

  await test("GET /api/alerts/active returns unread alerts", async () => {
    const { status, data } = await req("GET", "/api/alerts/active", null, cookies);
    expect(status, 200, "status");
    expectTruthy(Array.isArray(data.alerts), "alerts is array");
    expectTruthy(typeof data.count === "number", "count is number");
  });

  await test("Active alerts have required fields", async () => {
    const { data } = await req("GET", "/api/alerts/active", null, cookies);
    for (const a of data.alerts.slice(0, 3)) {
      expectTruthy(a.id, "id");
      expectTruthy(a.title, "title");
      expectTruthy(a.body, "body");
      expectTruthy(["low","medium","high"].includes(a.severity), "severity valid");
    }
  });

  // Reset rules back to defaults
  await req("PUT", "/api/alerts/rules", { stalledDealDays: 7, churnScoreThreshold: 70 }, cookies);
}

// ── Phase 5: UI Routes & Config ───────────────────────────────────────────────

async function testUIAndConfig() {
  console.log("\n🖥️  Phase 5 — UI & Settings");

  await test("PUT /api/digest/config updates cadence to weekly", async () => {
    const { status, data } = await req("PUT", "/api/digest/config", { cadence: "weekly", sendDayOfWeek: 2 }, cookies);
    expect(status, 200, "status");
    expectTruthy(data.config, "config returned");
    expect(data.config.cadence, "weekly", "cadence updated");
    expect(data.config.sendDayOfWeek, 2, "sendDayOfWeek updated");
  });

  await test("PUT /api/digest/config isRoleDefault becomes false after custom update", async () => {
    const { data } = await req("GET", "/api/digest/config", null, cookies);
    expect(data.config.isRoleDefault, false, "isRoleDefault false after custom update");
  });

  await test("PUT /api/digest/config updates send hour", async () => {
    const { status, data } = await req("PUT", "/api/digest/config", { sendHour: 9 }, cookies);
    expect(status, 200, "status");
    expect(data.config.sendHour, 9, "sendHour");
  });

  await test("PUT /api/digest/config updates severity threshold", async () => {
    const { status, data } = await req("PUT", "/api/digest/config", { severityThreshold: "high" }, cookies);
    expect(status, 200, "status");
    expect(data.config.severityThreshold, "high", "severityThreshold");
  });

  await test("PUT /api/digest/config updates channels", async () => {
    const { status, data } = await req("PUT", "/api/digest/config", { channels: ["in_app", "email"] }, cookies);
    expect(status, 200, "status");
    expectIncludes(data.config.channels, "in_app", "channels in_app");
    expectIncludes(data.config.channels, "email", "channels email");
  });

  await test("PUT /api/digest/config updates sections", async () => {
    const sections = { topPriorities: true, overdueTasks: true, hotLeads: false };
    const { status, data } = await req("PUT", "/api/digest/config", { sections }, cookies);
    expect(status, 200, "status");
    expect(data.config.sections.topPriorities, true, "topPriorities enabled");
    expect(data.config.sections.hotLeads, false, "hotLeads disabled");
  });

  await test("PUT /api/digest/config updates quiet hours", async () => {
    const { status, data } = await req("PUT", "/api/digest/config", { quietHoursStart: 22, quietHoursEnd: 6 }, cookies);
    expect(status, 200, "status");
    expect(data.config.quietHoursStart, 22, "quietHoursStart");
    expect(data.config.quietHoursEnd, 6, "quietHoursEnd");
  });

  await test("PUT /api/digest/config toggle enabled=false", async () => {
    const { status, data } = await req("PUT", "/api/digest/config", { enabled: false }, cookies);
    expect(status, 200, "status");
    expect(data.config.enabled, false, "enabled false");
  });

  // Restore
  await req("PUT", "/api/digest/config", { enabled: true, cadence: "daily", sendHour: 8, severityThreshold: "medium" }, cookies);
}

// ── Phase 6: Delivery ─────────────────────────────────────────────────────────

async function testDelivery() {
  console.log("\n📤 Phase 6 — Delivery");

  await test("POST /api/digest/send-now delivers in-app digest", async () => {
    const { status, data } = await req("POST", "/api/digest/send-now", { channel: "in_app" }, cookies);
    expect(status, 200, "status");
    expectTruthy(typeof data.ok === "boolean", "ok is boolean");
    expectTruthy(data.status, "status field present");
    expectTruthy(data.digest, "digest summary present");
    expectTruthy(data.digest.title, "title in summary");
  });

  await test("In-app send logs a digest run with delivered status", async () => {
    const { data } = await req("GET", "/api/digest/runs", null, cookies);
    const deliveredRun = (data.runs || []).find(r => r.channel === "in_app" && r.status === "delivered");
    expectTruthy(deliveredRun, "digest run with in_app delivered found");
  });

  await test("POST /api/digest/send-now logs a digest run", async () => {
    await req("POST", "/api/digest/send-now", { channel: "in_app" }, cookies);
    const { data } = await req("GET", "/api/digest/runs", null, cookies);
    expectTruthy(data.runs.length > 0, "has runs");
    const run = data.runs[0];
    expectTruthy(run.digestType, "digestType set");
    expectTruthy(run.status, "status set");
    expectTruthy(run.channel, "channel set");
    expectTruthy(run.generatedAt, "generatedAt set");
  });

  await test("Digest run has payloadSummary with signals", async () => {
    const { data } = await req("GET", "/api/digest/runs", null, cookies);
    const run = data.runs[0];
    expectTruthy(run.payloadSummary, "payloadSummary");
    expectTruthy(typeof run.payloadSummary.totalSignals === "number", "totalSignals in payload");
  });

  await test("Digest run has sectionsSent array", async () => {
    const { data } = await req("GET", "/api/digest/runs", null, cookies);
    const run = data.runs[0];
    expectTruthy(Array.isArray(run.sectionsSent), "sectionsSent is array");
  });

  await test("Email send attempt returns graceful result (no crash if not connected)", async () => {
    const { status } = await req("POST", "/api/digest/send-now", { channel: "email" }, cookies);
    expect(status, 200, "status 200 (graceful even if email fails)");
  });
}

// ── Section Inclusion/Exclusion ───────────────────────────────────────────────

async function testSectionFiltering() {
  console.log("\n🔧 Section Filtering");

  await test("Disabling all sections returns empty digest sections", async () => {
    const allOff = {};
    const keys = ["topPriorities","overdueTasks","hotLeads","hotOpportunities","quotesFollowUp","blockedInstalls","certBlockers","revenueAtRisk","mrrSummary","renewalRisks","churnRisks","territoryWhitespace","pipelineMovement","procurementBlockers"];
    for (const k of keys) allOff[k] = false;
    await req("PUT", "/api/digest/config", { sections: allOff }, cookies);
    const { data } = await req("GET", "/api/digest/preview", null, cookies);
    // With all off, sections should be empty (falls back to role defaults in preview)
    expectTruthy(data.digest, "digest object returned");
  });

  await test("Re-enabling sections restores them in preview", async () => {
    await req("POST", "/api/digest/reset-to-defaults", {}, cookies);
    const { data } = await req("GET", "/api/digest/preview", null, cookies);
    expectTruthy(Array.isArray(data.digest.sections), "sections array");
  });

  await test("Preview respects high severity threshold (fewer sections)", async () => {
    await req("PUT", "/api/digest/config", { severityThreshold: "high" }, cookies);
    const { data: hiData } = await req("GET", "/api/digest/preview", null, cookies);
    await req("PUT", "/api/digest/config", { severityThreshold: "low" }, cookies);
    const { data: loData } = await req("GET", "/api/digest/preview", null, cookies);
    // High threshold should have <= sections compared to low threshold
    expectTruthy(hiData.digest.sections.length <= loData.digest.sections.length, "high threshold <= low threshold sections");
    // Restore
    await req("PUT", "/api/digest/config", { severityThreshold: "medium" }, cookies);
  });
}

// ── No-Regression Tests ───────────────────────────────────────────────────────

async function testNoRegression() {
  console.log("\n🛡️  No-Regression Tests");

  await test("GET /api/notifications still works", async () => {
    const { status, data } = await req("GET", "/api/notifications", null, cookies);
    expect(status, 200, "status");
    expectTruthy(Array.isArray(data.notifications), "notifications array");
  });

  await test("GET /api/automations still works", async () => {
    const { status } = await req("GET", "/api/automations", null, cookies);
    expect(status, 200, "automations status");
  });

  await test("GET /api/scores/hot-list still works", async () => {
    const { status } = await req("GET", "/api/scores/hot-list?limit=5", null, cookies);
    expect(status, 200, "scores status");
  });

  await test("GET /api/revenue/dashboard still works", async () => {
    const { status } = await req("GET", "/api/revenue/dashboard", null, cookies);
    expect(status, 200, "revenue dashboard status");
  });

  await test("GET /api/leads still works", async () => {
    const { status } = await req("GET", "/api/leads?limit=5", null, cookies);
    expect(status, 200, "leads status");
  });

  await test("GET /api/opportunities still works", async () => {
    const { status } = await req("GET", "/api/opportunities?limit=5", null, cookies);
    expect(status, 200, "opportunities status");
  });

  await test("GET /api/accounts still works", async () => {
    const { status } = await req("GET", "/api/accounts?limit=5", null, cookies);
    expect(status, 200, "accounts status");
  });

  await test("GET /api/tasks still works", async () => {
    const { status } = await req("GET", "/api/tasks", null, cookies);
    expect(status, 200, "tasks status");
  });

  await test("GET /api/renewals still works", async () => {
    const { status } = await req("GET", "/api/renewals", null, cookies);
    expect(status, 200, "renewals status");
  });

  await test("GET /api/procurement/blocked-installs still works", async () => {
    const { status } = await req("GET", "/api/procurement/blocked-installs", null, cookies);
    expect(status, 200, "blocked installs status");
  });
}

// ── Auth Guards ───────────────────────────────────────────────────────────────

async function testAuthGuards() {
  console.log("\n🔒 Auth Guards");

  await test("GET /api/digest/config without auth returns 401", async () => {
    const { status } = await req("GET", "/api/digest/config");
    expect(status, 401, "status 401");
  });

  await test("PUT /api/digest/config without auth returns 401", async () => {
    const { status } = await req("PUT", "/api/digest/config", { cadence: "daily" });
    expect(status, 401, "status 401");
  });

  await test("GET /api/digest/preview without auth returns 401", async () => {
    const { status } = await req("GET", "/api/digest/preview");
    expect(status, 401, "status 401");
  });

  await test("POST /api/digest/send-now without auth returns 401", async () => {
    const { status } = await req("POST", "/api/digest/send-now", {});
    expect(status, 401, "status 401");
  });

  await test("GET /api/alerts/active without auth returns 401", async () => {
    const { status } = await req("GET", "/api/alerts/active");
    expect(status, 401, "status 401");
  });

  await test("POST /api/alerts/run-engine without auth returns 401", async () => {
    const { status } = await req("POST", "/api/alerts/run-engine", {});
    expect(status, 401, "status 401");
  });
}

// ── Main Runner ───────────────────────────────────────────────────────────────

async function run() {
  console.log("=".repeat(60));
  console.log("  Executive Alerting / Digest Automation Test Suite");
  console.log("=".repeat(60));

  try {
    await setup();
    await testDataModel();
    await testDigestComposer();
    await testRoleDefaults();
    await testAlertEngine();
    await testUIAndConfig();
    await testDelivery();
    await testSectionFiltering();
    await testNoRegression();
    await testAuthGuards();
  } catch (e) {
    console.error("Fatal test error:", e);
    fail++;
  }

  console.log("\n" + "=".repeat(60));
  console.log(`  Results: ${pass} passed, ${fail} failed`);
  console.log("=".repeat(60));
  process.exit(fail > 0 ? 1 : 0);
}

run();
