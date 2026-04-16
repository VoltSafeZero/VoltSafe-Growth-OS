/**
 * VoltSafe Winter Support + Legacy Product Operations — Integration Tests
 * Covers: products CRUD, cases CRUD, KB CRUD, dashboard, demand-signals,
 *         scan-emails, and auth guards.
 *
 * Run: node tests/winter-support.test.js
 * Assumes a running server on http://localhost:5000
 * Login: trevor@voltsafe.com / alberni1444
 */

const BASE = "http://localhost:5000";
let cookie = "";
let createdProductId = null;
let createdCaseId = null;
let createdKbId = null;

let passed = 0;
let failed = 0;
const errors = [];

async function req(method, path, body, extraHeaders = {}) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie, ...extraHeaders },
    credentials: "include",
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  const setCookie = r.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  let data;
  try { data = await r.json(); } catch { data = null; }
  return { status: r.status, data };
}

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
    errors.push(`${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function testAuth() {
  console.log("\n[Auth]");

  // unauthenticated should return 401 for all winter routes
  const routes = [
    ["GET", "/api/winter/products"],
    ["GET", "/api/winter/cases"],
    ["GET", "/api/winter/kb"],
    ["GET", "/api/winter/dashboard"],
    ["GET", "/api/winter/demand-signals"],
    ["POST", "/api/winter/scan-emails"],
  ];
  for (const [method, path] of routes) {
    const { status } = await req(method, path, method === "POST" ? {} : undefined, { Cookie: "" });
    assert(`Auth guard: ${method} ${path} → 401`, status === 401, `got ${status}`);
  }

  // Login
  const { status, data } = await req("POST", "/api/auth/login", {
    email: "trevor@voltsafe.com",
    password: "alberni1444",
  });
  assert("Login succeeds", status === 200 || status === 201, `got ${status}`);
  assert("Login returns userId", data?.id != null || data?.user?.id != null, `data=${JSON.stringify(data)}`);
}

// ── Products ──────────────────────────────────────────────────────────────────

async function testProducts() {
  console.log("\n[Products]");

  // List (should have seed data — 3 products)
  const { status: ls, data: list } = await req("GET", "/api/winter/products");
  assert("GET /api/winter/products → 200", ls === 200, `got ${ls}`);
  assert("Products list is array", Array.isArray(list), `got ${typeof list}`);
  assert("Seed products present (≥1)", list.length >= 1, `got ${list.length}`);
  if (list.length > 0) {
    const p = list[0];
    assert("Product has name", typeof p.name === "string", JSON.stringify(p));
    assert("Product has status", typeof p.status === "string");
  }

  // Create
  const { status: cs, data: created } = await req("POST", "/api/winter/products", {
    name: "Test Winter Unit X",
    sku: "VS-TEST-X",
    version: "0.1",
    launchYear: 2023,
    certifications: ["CSA", "UL"],
    unitsSold: 100,
    channels: ["dtc"],
    status: "active",
    notes: "Test product for automated testing",
  });
  assert("POST /api/winter/products → 201", cs === 201, `got ${cs}`);
  assert("Created product has id", created?.id != null, JSON.stringify(created));
  assert("Created product has name", created?.name === "Test Winter Unit X", JSON.stringify(created));
  createdProductId = created?.id;

  // Validation — name required
  const { status: vs } = await req("POST", "/api/winter/products", { sku: "X" });
  assert("POST /api/winter/products without name → 400", vs === 400, `got ${vs}`);

  // Update
  if (createdProductId) {
    const { status: us, data: updated } = await req("PUT", `/api/winter/products/${createdProductId}`, {
      status: "relaunch_candidate",
      unitsSold: 250,
    });
    assert("PUT /api/winter/products/:id → 200", us === 200, `got ${us}`);
    assert("Updated product has status", updated?.status === "relaunch_candidate", JSON.stringify(updated));
  }

  // Update non-existent
  const { status: ns } = await req("PUT", "/api/winter/products/999999", { status: "paused" });
  assert("PUT /api/winter/products/999999 → 404", ns === 404, `got ${ns}`);
}

// ── Cases ─────────────────────────────────────────────────────────────────────

async function testCases() {
  console.log("\n[Cases]");

  // List
  const { status: ls, data: list } = await req("GET", "/api/winter/cases");
  assert("GET /api/winter/cases → 200", ls === 200, `got ${ls}`);
  assert("Cases list is array", Array.isArray(list), `got ${typeof list}`);

  // Create
  const { status: cs, data: created } = await req("POST", "/api/winter/cases", {
    customerName: "Test Marina Services",
    customerEmail: "test@testsailors.ca",
    issueType: "overheating",
    severity: "high",
    subject: "Unit gets very hot in sub-zero temps",
    bodyExcerpt: "Our Winter Gen 1 unit is overheating. It gets too hot when temperatures drop below -10.",
    country: "Canada",
    tags: ["gen1", "thermal"],
  });
  assert("POST /api/winter/cases → 201", cs === 201, `got ${cs}`);
  assert("Created case has id", created?.id != null, JSON.stringify(created));
  assert("Created case has caseNumber", typeof created?.caseNumber === "string", JSON.stringify(created));
  assert("Created case has issueType", created?.issueType === "overheating", JSON.stringify(created));
  createdCaseId = created?.id;

  // List with filters
  const { status: flts, data: filtered } = await req("GET", "/api/winter/cases?status=open");
  assert("GET /api/winter/cases?status=open → 200", flts === 200, `got ${flts}`);
  assert("Filtered cases is array", Array.isArray(filtered));

  const { status: fli, data: byIssue } = await req("GET", "/api/winter/cases?issueType=overheating");
  assert("GET /api/winter/cases?issueType=overheating → 200", fli === 200, `got ${fli}`);

  // Search
  const { status: ss, data: searched } = await req("GET", `/api/winter/cases?search=Test+Marina`);
  assert("GET /api/winter/cases?search= → 200", ss === 200, `got ${ss}`);
  assert("Search returns array", Array.isArray(searched));

  // Get single case
  if (createdCaseId) {
    const { status: gs, data: single } = await req("GET", `/api/winter/cases/${createdCaseId}`);
    assert("GET /api/winter/cases/:id → 200", gs === 200, `got ${gs}`);
    assert("Single case matches id", single?.id === createdCaseId, JSON.stringify(single));
  }

  // Update case
  if (createdCaseId) {
    const { status: us, data: updated } = await req("PUT", `/api/winter/cases/${createdCaseId}`, {
      status: "in_progress",
      severity: "critical",
      resolution: "Sending replacement unit",
    });
    assert("PUT /api/winter/cases/:id → 200", us === 200, `got ${us}`);
    assert("Updated case status", updated?.status === "in_progress", JSON.stringify(updated));
  }

  // 404 for non-existent single case
  const { status: ns } = await req("GET", "/api/winter/cases/999999");
  assert("GET /api/winter/cases/999999 → 404", ns === 404, `got ${ns}`);
}

// ── Knowledge Base ────────────────────────────────────────────────────────────

async function testKnowledgeBase() {
  console.log("\n[Knowledge Base]");

  // List (should have seed data — 7 articles)
  const { status: ls, data: list } = await req("GET", "/api/winter/kb");
  assert("GET /api/winter/kb → 200", ls === 200, `got ${ls}`);
  assert("KB list is array", Array.isArray(list), `got ${typeof list}`);
  assert("Seed KB articles present (≥1)", list.length >= 1, `got ${list.length}`);
  if (list.length > 0) {
    const a = list[0];
    assert("Article has title", typeof a.title === "string");
    assert("Article has issueType", typeof a.issueType === "string");
    assert("Article has status", typeof a.status === "string");
  }

  // Filter by issueType
  const { status: fls, data: filtered } = await req("GET", "/api/winter/kb?issueType=warranty");
  assert("GET /api/winter/kb?issueType=warranty → 200", fls === 200, `got ${fls}`);
  assert("Filtered KB is array", Array.isArray(filtered));

  // Create
  const { status: cs, data: created } = await req("POST", "/api/winter/kb", {
    title: "Test KB: Sensor failure in extreme cold",
    issueType: "troubleshooting",
    description: "Sensor may fail below -25C",
    approvedResponse: "We apologize for the inconvenience. Please return the unit for inspection.",
    internalNotes: "Known hardware defect in pre-2021 batch.",
    status: "active",
  });
  assert("POST /api/winter/kb → 201", cs === 201, `got ${cs}`);
  assert("Created article has id", created?.id != null, JSON.stringify(created));
  assert("Created article has title", created?.title === "Test KB: Sensor failure in extreme cold", JSON.stringify(created));
  createdKbId = created?.id;

  // Validation — title required
  const { status: vs } = await req("POST", "/api/winter/kb", { issueType: "warranty" });
  assert("POST /api/winter/kb without title → 400", vs === 400, `got ${vs}`);

  // Update
  if (createdKbId) {
    const { status: us, data: updated } = await req("PUT", `/api/winter/kb/${createdKbId}`, {
      status: "archived",
      internalNotes: "Superseded by updated article",
    });
    assert("PUT /api/winter/kb/:id → 200", us === 200, `got ${us}`);
    assert("Updated article has status", updated?.status === "archived", JSON.stringify(updated));
  }

  // Update non-existent
  const { status: ns } = await req("PUT", "/api/winter/kb/999999", { status: "archived" });
  assert("PUT /api/winter/kb/999999 → 404", ns === 404, `got ${ns}`);
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

async function testDashboard() {
  console.log("\n[Dashboard]");

  const { status, data } = await req("GET", "/api/winter/dashboard");
  assert("GET /api/winter/dashboard → 200", status === 200, `got ${status}`);
  assert("Dashboard has stats", data?.stats != null, JSON.stringify(data));
  assert("Dashboard stats.openCases is number", typeof data?.stats?.openCases === "number", JSON.stringify(data?.stats));
  assert("Dashboard stats.criticalCases is number", typeof data?.stats?.criticalCases === "number");
  assert("Dashboard has topIssues array", Array.isArray(data?.topIssues));
  assert("Dashboard has weeklyTrend array", Array.isArray(data?.weeklyTrend));
  assert("Dashboard has productBreakdown array", Array.isArray(data?.productBreakdown));
  assert("Dashboard has demandScore number", typeof data?.demandScore === "number");
  assert("Dashboard has revenueOpportunity number", typeof data?.revenueOpportunity === "number");
  assert("Dashboard has reorderSignals number", typeof data?.reorderSignals === "number");
  assert("demandScore is 0–100", data?.demandScore >= 0 && data?.demandScore <= 100, `got ${data?.demandScore}`);
}

// ── Demand Signals ────────────────────────────────────────────────────────────

async function testDemandSignals() {
  console.log("\n[Demand Signals]");

  const { status, data } = await req("GET", "/api/winter/demand-signals");
  assert("GET /api/winter/demand-signals → 200", status === 200, `got ${status}`);
  assert("Demand signals has byCountry array", Array.isArray(data?.byCountry));
  assert("Demand signals has retailers array", Array.isArray(data?.retailers));
  assert("Demand signals has improvements array", Array.isArray(data?.improvements));
  assert("Demand signals has monthlyTrend array", Array.isArray(data?.monthlyTrend));
  assert("Demand signals has sentiment object", data?.sentiment != null && typeof data?.sentiment === "object");
}

// ── Email Scan ────────────────────────────────────────────────────────────────

async function testScanEmails() {
  console.log("\n[Scan Emails]");

  const { status, data } = await req("POST", "/api/winter/scan-emails", { limitHours: 24 });
  assert("POST /api/winter/scan-emails → 200", status === 200, `got ${status}`);
  assert("Scan result has scanned number", typeof data?.scanned === "number", JSON.stringify(data));
  assert("Scan result has created number", typeof data?.created === "number", JSON.stringify(data));
  assert("Scan result has skipped number", typeof data?.skipped === "number", JSON.stringify(data));
  assert("created ≤ scanned", data?.created <= data?.scanned, `created=${data?.created} scanned=${data?.scanned}`);
}

// ── Run all ───────────────────────────────────────────────────────────────────

async function run() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  VoltSafe Winter Support — Integration Tests");
  console.log("═══════════════════════════════════════════════════════════");

  await testAuth();
  await testProducts();
  await testCases();
  await testKnowledgeBase();
  await testDashboard();
  await testDemandSignals();
  await testScanEmails();

  console.log("\n═══════════════════════════════════════════════════════════");
  const total = passed + failed;
  console.log(`  Results: ${passed}/${total} passed, ${failed} failed`);
  if (errors.length > 0) {
    console.log("\n  Failed assertions:");
    errors.forEach(e => console.log(`    ✗ ${e}`));
  }
  console.log("═══════════════════════════════════════════════════════════");

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => {
  console.error("Fatal test error:", e);
  process.exit(1);
});
