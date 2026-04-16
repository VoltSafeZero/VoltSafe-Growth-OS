const BASE = "http://localhost:5000";
let cookie = "";

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "trevor@voltsafe.com", password: "alberni1444" }),
  });
  const headers = r.headers.get("set-cookie") || "";
  cookie = headers.split(";")[0];
  if (!cookie) throw new Error("Login failed — no cookie");
}

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { headers: { cookie } });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
    failures.push(label);
  }
}

async function testAuth() {
  console.log("\n── Auth ──");
  await login();
  assert(!!cookie, "Login returns session cookie");
  const r = await get("/api/auth/me");
  assert(r.status === 200, "GET /api/auth/me returns 200");
  assert(r.body?.id === 4, "auth/me returns correct user id=4");
}

async function testCommandCenterWidgetsEndpoint() {
  console.log("\n── GET /api/scores/command-center-widgets ──");

  const r = await get("/api/scores/command-center-widgets");
  assert(r.status === 200, "Returns 200");
  assert(r.body && typeof r.body === "object", "Response is an object");

  const data = r.body;
  assert(Array.isArray(data.hottestLeads),    "Has hottestLeads array");
  assert(Array.isArray(data.closeOpps),       "Has closeOpps array");
  assert(Array.isArray(data.urgentQuotes),    "Has urgentQuotes array");
  assert(Array.isArray(data.deploymentRisks), "Has deploymentRisks array");
  assert(Array.isArray(data.churnRisks),      "Has churnRisks array");
  assert(Array.isArray(data.expansionReady),  "Has expansionReady array");

  assert(data.hottestLeads.length <= 5,    "hottestLeads ≤ 5 items");
  assert(data.closeOpps.length <= 5,       "closeOpps ≤ 5 items");
  assert(data.urgentQuotes.length <= 5,    "urgentQuotes ≤ 5 items");
  assert(data.deploymentRisks.length <= 5, "deploymentRisks ≤ 5 items");
  assert(data.churnRisks.length <= 5,      "churnRisks ≤ 5 items");
  assert(data.expansionReady.length <= 5,  "expansionReady ≤ 5 items");

  return data;
}

async function testScoredItemShape(data) {
  console.log("\n── Scored item shape ──");

  const allArrays = [
    ["hottestLeads", data.hottestLeads],
    ["closeOpps", data.closeOpps],
    ["urgentQuotes", data.urgentQuotes],
    ["deploymentRisks", data.deploymentRisks],
    ["churnRisks", data.churnRisks],
    ["expansionReady", data.expansionReady],
  ];

  for (const [key, items] of allArrays) {
    if (items.length === 0) { console.log(`  ~ ${key}: empty (ok)`); continue; }
    const item = items[0];
    assert(typeof item.id === "number", `${key}[0].id is number`);
    assert(typeof item.name === "string", `${key}[0].name is string`);
    assert(typeof item.score === "number", `${key}[0].score is number`);
    assert(["low", "medium", "high", "critical"].includes(item.band), `${key}[0].band is valid`);
    assert(typeof item.confidence === "number", `${key}[0].confidence is number`);
    assert(Array.isArray(item.reasons), `${key}[0].reasons is array`);
    assert(typeof item.suggestedAction === "string" && item.suggestedAction.length > 0, `${key}[0].suggestedAction is non-empty string`);
    assert(typeof item.link === "string" && item.link.startsWith("/"), `${key}[0].link starts with /`);
    assert(item.score >= 0 && item.score <= 100, `${key}[0].score in [0,100]`);
    assert(item.confidence >= 0 && item.confidence <= 100, `${key}[0].confidence in [0,100]`);
  }
}

async function testDeltaFields(data) {
  console.log("\n── Delta fields ──");

  const allArrays = [
    ["hottestLeads", data.hottestLeads],
    ["closeOpps", data.closeOpps],
    ["urgentQuotes", data.urgentQuotes],
    ["deploymentRisks", data.deploymentRisks],
    ["churnRisks", data.churnRisks],
    ["expansionReady", data.expansionReady],
  ];

  for (const [key, items] of allArrays) {
    if (items.length === 0) continue;
    const item = items[0];
    assert("delta" in item, `${key}[0] has delta field`);
    assert("previousScore" in item, `${key}[0] has previousScore field`);
    assert("previousBand" in item, `${key}[0] has previousBand field`);
    assert(item.delta === null || typeof item.delta === "number", `${key}[0].delta is null or number`);
    assert(item.previousScore === null || typeof item.previousScore === "number", `${key}[0].previousScore is null or number`);
  }
}

async function testSortOrder(data) {
  console.log("\n── Sort order (score descending) ──");

  const toCheck = [
    ["hottestLeads", data.hottestLeads],
    ["closeOpps", data.closeOpps],
    ["churnRisks", data.churnRisks],
    ["expansionReady", data.expansionReady],
  ];

  for (const [key, items] of toCheck) {
    if (items.length < 2) { console.log(`  ~ ${key}: < 2 items, skipping`); continue; }
    let sorted = true;
    for (let i = 1; i < items.length; i++) {
      if (items[i].score > items[i - 1].score) { sorted = false; break; }
    }
    assert(sorted, `${key} sorted by score desc`);
  }
}

async function testSuggestedActions(data) {
  console.log("\n── Suggested action content ──");

  const checks = [
    ["hottestLeads",    ["today", "week", "nurture", "qualify", "reach"]],
    ["closeOpps",       ["close", "advance", "stage", "engage", "review", "push"]],
    ["urgentQuotes",    ["quote", "follow", "status", "schedule"]],
    ["deploymentRisks", ["escalat", "review", "unblock", "monitor"]],
    ["churnRisks",      ["escalat", "check", "monitor", "cs"]],
    ["expansionReady",  ["expansion", "explore", "qbr", "opportunity", "flag"]],
  ];

  for (const [key, phrases] of checks) {
    const items = data[key];
    if (!items || items.length === 0) continue;
    const action = (items[0].suggestedAction ?? "").toLowerCase();
    const matches = phrases.some(p => action.includes(p.toLowerCase()));
    assert(matches, `${key}[0].suggestedAction is role-relevant ("${items[0].suggestedAction}")`);
  }
}

async function testLinks(data) {
  console.log("\n── Deep links ──");

  if (data.hottestLeads.length > 0)
    assert(data.hottestLeads[0].link.startsWith("/leads/"), "hottestLeads link → /leads/:id");
  if (data.closeOpps.length > 0)
    assert(data.closeOpps[0].link.startsWith("/pipeline/"), "closeOpps link → /pipeline/:id");
  if (data.urgentQuotes.length > 0)
    assert(data.urgentQuotes[0].link.startsWith("/quotes/"), "urgentQuotes link → /quotes/:id");
  if (data.deploymentRisks.length > 0)
    assert(data.deploymentRisks[0].link.startsWith("/deployments/"), "deploymentRisks link → /deployments/:id");
  if (data.churnRisks.length > 0)
    assert(data.churnRisks[0].link.startsWith("/accounts/"), "churnRisks link → /accounts/:id");
  if (data.expansionReady.length > 0)
    assert(data.expansionReady[0].link.startsWith("/accounts/"), "expansionReady link → /accounts/:id");
}

async function testModelNames(data) {
  console.log("\n── Model names ──");

  const expected = {
    hottestLeads:    "lead_quality",
    closeOpps:       "opportunity_close",
    urgentQuotes:    "quote_urgency",
    deploymentRisks: "deployment_risk",
    churnRisks:      "churn_risk",
    expansionReady:  "expansion_likelihood",
  };

  for (const [key, modelName] of Object.entries(expected)) {
    const items = data[key];
    if (!items || items.length === 0) continue;
    assert(items[0].modelName === modelName,
      `${key}[0].modelName = "${modelName}" (got "${items[0].modelName}")`);
  }
}

async function testBulkScoreRoutes() {
  console.log("\n── Existing bulk score routes ──");

  const routes = [
    "/api/scores/leads",
    "/api/scores/opportunities",
    "/api/scores/quotes",
    "/api/scores/deployments/risk",
    "/api/scores/accounts/churn",
    "/api/scores/accounts/expansion",
    "/api/scores/hot-list",
  ];

  for (const route of routes) {
    const r = await get(route);
    assert(r.status === 200, `GET ${route} → 200`);
    assert(Array.isArray(r.body), `GET ${route} → array`);
  }
}

async function testAuthProtection() {
  console.log("\n── Auth protection ──");

  const r = await fetch(`${BASE}/api/scores/command-center-widgets`);
  assert(r.status === 401 || r.status === 403, "Unauthenticated request blocked (401/403)");
}

async function testScoreHistory() {
  console.log("\n── Score outcomes / snapshots ──");

  const r = await get("/api/scores/outcomes");
  assert(r.status === 200, "GET /api/scores/outcomes returns 200");
  const isValid = Array.isArray(r.body) || (r.body && typeof r.body === "object");
  assert(isValid, "Score outcomes returns array or object");
}

async function testFeedbackOverview() {
  console.log("\n── Score feedback overview ──");

  const r = await get("/api/scores/feedback/overview");
  assert(r.status === 200, "GET /api/scores/feedback/overview → 200");
  assert(r.body && typeof r.body === "object", "Feedback overview is object");
}

async function testRegressions() {
  console.log("\n── Regression checks ──");

  const routes = [
    ["/api/pipeline/forecast",       "pipeline forecast"],
    ["/api/executive/kpis",          "executive kpis"],
    ["/api/cs/dashboard",            "cs dashboard"],
    ["/api/revenue/dashboard",       "revenue dashboard"],
    ["/api/daily-command-center",    "daily command center"],
    ["/api/executive/risk-alerts",   "executive risk alerts"],
    ["/api/deployments/dashboard",   "deployments dashboard"],
    ["/api/projects/cert-summary",   "cert summary"],
  ];

  for (const [path, label] of routes) {
    const r = await get(path);
    assert(r.status === 200, `${label} → 200`);
  }
}

async function run() {
  console.log("=== Predictive Score Tuning Tests ===");

  await testAuth();
  const data = await testCommandCenterWidgetsEndpoint();
  await testScoredItemShape(data);
  await testDeltaFields(data);
  await testSortOrder(data);
  await testSuggestedActions(data);
  await testLinks(data);
  await testModelNames(data);
  await testBulkScoreRoutes();
  await testAuthProtection();
  await testScoreHistory();
  await testFeedbackOverview();
  await testRegressions();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failures.length > 0) {
    console.log("\nFailed:");
    failures.forEach(f => console.log(`  ✗ ${f}`));
    process.exit(1);
  } else {
    console.log("All tests passed!");
    process.exit(0);
  }
}

run().catch(e => {
  console.error("Test runner error:", e);
  process.exit(1);
});
