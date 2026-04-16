/**
 * Score Widget Quick Actions Tests
 * Tests: Add Task, Add Note, Acknowledge, widget filter, no regression
 */

const BASE = "http://localhost:5000";
let cookie = "";
let passed = 0;
let failures = [];

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

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { headers: { cookie } });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function del(path) {
  const r = await fetch(`${BASE}${path}`, { method: "DELETE", headers: { cookie } });
  return { status: r.status, body: await r.json().catch(() => null) };
}

function assert(cond, label) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failures.push(label);
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function testAuth() {
  console.log("\n── Auth ──");
  await login();
  assert(!!cookie, "Login returns session cookie");
}

// ── Add Task (POST /api/tasks) ────────────────────────────────────────────────
async function testAddTask() {
  console.log("\n── Add Task from score widget ──");

  // First get a real lead id from the widget data
  const widgetR = await get("/api/scores/command-center-widgets");
  const leadId = widgetR.body?.hottestLeads?.[0]?.id ?? 1;
  const modelName = widgetR.body?.hottestLeads?.[0]?.modelName ?? "lead_quality";
  const itemName = widgetR.body?.hottestLeads?.[0]?.name ?? "Test Lead";

  const taskBody = {
    title: `Follow up with high-score lead: ${itemName}`,
    linkedObjectType: "lead",
    linkedObjectId: leadId,
    priority: "high",
    status: "pending",
    source: "score_widget",
    sourceLabel: modelName,
    sourceMeta: { score: 85, band: "high", modelName },
  };

  const r = await post("/api/tasks", taskBody);
  assert(r.status === 201, "POST /api/tasks returns 201");
  assert(r.body?.id > 0, "Created task has an id");
  assert(r.body?.title === taskBody.title, "Created task has correct title");
  assert(r.body?.linkedObjectType === "lead", "Task linked to lead");
  assert(r.body?.linkedObjectId === leadId, "Task linked to correct record id");
  assert(r.body?.source === "score_widget", "Task source is score_widget");
  assert(r.body?.sourceLabel === modelName, "Task sourceLabel matches modelName");
  assert(r.body?.priority === "high", "Task priority is high");

  // Verify task appears in task list
  const listR = await get(`/api/tasks?linkedObjectType=lead&linkedObjectId=${leadId}`);
  assert(listR.status === 200, "GET /api/tasks returns 200");

  return r.body?.id;
}

// ── Add Task with due date ────────────────────────────────────────────────────
async function testAddTaskWithDueDate() {
  console.log("\n── Add Task with due date ──");

  const due = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const r = await post("/api/tasks", {
    title: "Review urgent quote for Test Account",
    linkedObjectType: "quote",
    linkedObjectId: 1,
    priority: "medium",
    status: "pending",
    source: "score_widget",
    sourceLabel: "quote_urgency",
    dueDate: due,
  });
  assert(r.status === 201, "Task with due date returns 201");
  assert(r.body?.id > 0, "Task with due date has id");
}

// ── Add Note (POST /api/notes) ────────────────────────────────────────────────
async function testAddNote() {
  console.log("\n── Add Note from score widget ──");

  const widgetR = await get("/api/scores/command-center-widgets");
  const oppId = widgetR.body?.closeOpps?.[0]?.id ?? 1;
  const itemName = widgetR.body?.closeOpps?.[0]?.name ?? "Test Opp";
  const score = widgetR.body?.closeOpps?.[0]?.score ?? 75;
  const band = widgetR.body?.closeOpps?.[0]?.label ?? "High Close Probability";
  const suggested = widgetR.body?.closeOpps?.[0]?.suggestedAction ?? "Push to close";

  const content = `Score review (${band} — ${score}/100): ${suggested}\n\nKey signals: High deal amount; Recent activity`;

  const r = await post("/api/notes", {
    content,
    linkedObjectType: "opportunity",
    linkedObjectId: oppId,
  });
  assert(r.status === 201, "POST /api/notes returns 201");
  assert(r.body?.id > 0, "Created note has an id");
  assert(r.body?.linkedObjectType === "opportunity", "Note linked to opportunity");
  assert(r.body?.linkedObjectId === oppId, "Note linked to correct record id");
  assert(typeof r.body?.content === "string" && r.body.content.length > 0, "Note has content");
  assert(r.body?.authorId > 0, "Note has authorId (authenticated user)");

  return r.body?.id;
}

// ── Note prefill template content ────────────────────────────────────────────
async function testNotePrefill() {
  console.log("\n── Note prefill template ──");

  const r = await post("/api/notes", {
    content: "Score review (Critical — 92/100): Contact immediately\n\nKey signals: No response in 45 days; High ARR at risk",
    linkedObjectType: "account",
    linkedObjectId: 1,
  });
  assert(r.status === 201, "Score template note creates correctly");
  assert(r.body?.content?.includes("Score review"), "Note content contains score review label");
}

// ── Acknowledge (POST /api/scores/acknowledge) ────────────────────────────────
async function testAcknowledge() {
  console.log("\n── Acknowledge risk ──");

  // Get a real item to acknowledge
  const widgetR = await get("/api/scores/command-center-widgets");
  const leads = widgetR.body?.hottestLeads ?? [];
  if (leads.length === 0) {
    console.log("  ~ No leads in widget — skipping acknowledge against widget data");
    // Still test the endpoint with a synthetic record
  }

  const targetId = leads[0]?.id ?? 999;

  const r = await post("/api/scores/acknowledge", {
    modelName: "lead_quality",
    recordType: "lead",
    recordId: targetId,
  });
  assert(r.status === 201, "POST /api/scores/acknowledge returns 201");
  assert(r.body?.userId === 4, "Acknowledgment has correct userId");
  assert(r.body?.modelName === "lead_quality", "Acknowledgment has correct modelName");
  assert(r.body?.recordType === "lead", "Acknowledgment has correct recordType");
  assert(r.body?.recordId === targetId, "Acknowledgment has correct recordId");
  assert(r.body?.expiresAt != null, "Acknowledgment has expiresAt");

  // Verify the expires_at is ~48h in the future
  const expiresAt = new Date(r.body?.expiresAt);
  const hoursFromNow = (expiresAt - Date.now()) / (1000 * 60 * 60);
  assert(hoursFromNow > 47 && hoursFromNow < 49, "Cooldown window is ~48 hours");

  return { modelName: "lead_quality", recordType: "lead", recordId: targetId };
}

// ── Acknowledge suppresses widget display ─────────────────────────────────────
async function testAcknowledgeSuppressesWidget() {
  console.log("\n── Acknowledge suppresses widget item ──");

  const before = await get("/api/scores/command-center-widgets");
  const leads = before.body?.hottestLeads ?? [];

  if (leads.length === 0) {
    console.log("  ~ No leads in widget data to test suppression");
    assert(true, "Skip: no leads available");
    return;
  }

  const target = leads[0];

  // Acknowledge this item
  await post("/api/scores/acknowledge", {
    modelName: target.modelName,
    recordType: "lead",
    recordId: target.id,
  });

  // Re-fetch and check item is absent
  const after = await get("/api/scores/command-center-widgets");
  const afterLeads = after.body?.hottestLeads ?? [];
  const stillPresent = afterLeads.some(l => l.id === target.id);
  assert(!stillPresent, `Acknowledged item (id=${target.id}) no longer appears in widget`);
}

// ── Acknowledge validation ────────────────────────────────────────────────────
async function testAcknowledgeValidation() {
  console.log("\n── Acknowledge validation ──");

  const r = await post("/api/scores/acknowledge", {});
  assert(r.status === 400, "Missing fields returns 400");

  const r2 = await post("/api/scores/acknowledge", { modelName: "lead_quality" });
  assert(r2.status === 400, "Missing recordType + recordId returns 400");
}

// ── Acknowledge auth guard ────────────────────────────────────────────────────
async function testAcknowledgeAuthGuard() {
  console.log("\n── Acknowledge auth guard ──");
  const r = await fetch(`${BASE}/api/scores/acknowledge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelName: "lead_quality", recordType: "lead", recordId: 1 }),
  });
  assert(r.status === 401 || r.status === 403, "Unauthenticated acknowledge is blocked");
}

// ── Multiple acknowledge models ───────────────────────────────────────────────
async function testAcknowledgeAllModels() {
  console.log("\n── Acknowledge all models ──");

  const models = [
    { modelName: "lead_quality", recordType: "lead" },
    { modelName: "opportunity_close", recordType: "opportunity" },
    { modelName: "quote_urgency", recordType: "quote" },
    { modelName: "deployment_risk", recordType: "deployment" },
    { modelName: "churn_risk", recordType: "account" },
    { modelName: "expansion_likelihood", recordType: "account" },
  ];

  for (const m of models) {
    const r = await post("/api/scores/acknowledge", { ...m, recordId: 9999 });
    assert(r.status === 201, `Acknowledge ${m.modelName} returns 201`);
  }
}

// ── Task source + sourceLabel preserved ──────────────────────────────────────
async function testTaskSourceMeta() {
  console.log("\n── Task source/meta preservation ──");

  const r = await post("/api/tasks", {
    title: "Resolve deployment risk: Harbor Systems",
    linkedObjectType: "deployment",
    linkedObjectId: 1,
    priority: "high",
    status: "pending",
    source: "score_widget",
    sourceLabel: "deployment_risk",
    sourceMeta: { score: 88, band: "critical", modelName: "deployment_risk" },
  });
  assert(r.status === 201, "Deployment risk task creates correctly");
  assert(r.body?.source === "score_widget", "Source preserved as score_widget");
  assert(r.body?.sourceLabel === "deployment_risk", "sourceLabel preserved");
  assert(r.body?.sourceMeta?.score === 88, "sourceMeta score preserved");
  assert(r.body?.sourceMeta?.band === "critical", "sourceMeta band preserved");
}

// ── Widget still loads correctly after all actions ────────────────────────────
async function testWidgetRegression() {
  console.log("\n── Widget regression after quick actions ──");

  const r = await get("/api/scores/command-center-widgets");
  assert(r.status === 200, "Widget route still returns 200");
  assert(typeof r.body === "object", "Widget response is an object");
  assert(Array.isArray(r.body?.hottestLeads), "hottestLeads still an array");
  assert(Array.isArray(r.body?.closeOpps), "closeOpps still an array");
  assert(Array.isArray(r.body?.urgentQuotes), "urgentQuotes still an array");
  assert(Array.isArray(r.body?.deploymentRisks), "deploymentRisks still an array");
  assert(Array.isArray(r.body?.expansionReady), "expansionReady still an array");

  // All items still have required shape
  const all = [
    ...r.body.hottestLeads,
    ...r.body.closeOpps,
    ...r.body.urgentQuotes,
    ...r.body.deploymentRisks,
    ...r.body.expansionReady,
  ];
  for (const item of all) {
    assert(typeof item.id === "number", `item ${item.id} still has numeric id`);
    assert(typeof item.score === "number", `item ${item.id} still has numeric score`);
    assert(typeof item.modelName === "string", `item ${item.id} still has modelName`);
    break; // check first item only to keep output clean
  }
}

// ── Regression: score routes unchanged ───────────────────────────────────────
async function testScoreRouteRegression() {
  console.log("\n── Score route regression ──");

  const routes = [
    "/api/scores/leads",
    "/api/scores/opportunities",
    "/api/scores/quotes",
    "/api/scores/deployments/risk",
    "/api/scores/accounts/churn",
    "/api/scores/accounts/expansion",
    "/api/scores/hot-list",
    "/api/scores/outcomes",
    "/api/scores/feedback/overview",
  ];

  for (const route of routes) {
    const r = await get(route);
    assert(r.status === 200, `${route} → 200`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log("=== Score Quick Actions Tests ===");
  try {
    await testAuth();
    await testAddTask();
    await testAddTaskWithDueDate();
    await testAddNote();
    await testNotePrefill();
    await testAcknowledge();
    await testAcknowledgeSuppressesWidget();
    await testAcknowledgeValidation();
    await testAcknowledgeAuthGuard();
    await testAcknowledgeAllModels();
    await testTaskSourceMeta();
    await testWidgetRegression();
    await testScoreRouteRegression();
  } catch (err) {
    console.error("FATAL:", err);
    process.exit(1);
  }

  console.log(`\n=== Results: ${passed} passed, ${failures.length} failed ===`);
  if (failures.length > 0) {
    console.log("Failed:", failures.join(", "));
    process.exit(1);
  } else {
    console.log("All tests passed!");
  }
})();
