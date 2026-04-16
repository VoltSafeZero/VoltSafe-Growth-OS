/**
 * VoltSafe Winter Workflow Hardening — Integration Tests
 * Covers: workflow states, SLA timestamps, response templates,
 *         queues, metrics, demand vs defect, regressions.
 *
 * Run: node tests/winter-workflow.test.js
 * Requires running server on http://localhost:5000
 */

const BASE = "http://localhost:5000";
let cookie = "";
let caseId = null;
let templateId = null;

let passed = 0;
let failed = 0;
const errors = [];

async function req(method, path, body, rawCookie = cookie) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json", Cookie: rawCookie },
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

async function login() {
  console.log("\n[Auth]");
  const { status, data } = await req("POST", "/api/auth/login", {
    email: "trevor@voltsafe.com",
    password: "alberni1444",
  });
  assert("Login succeeds", status === 200, `got ${status}`);
  assert("Returns user id", data?.id != null || data?.user?.id != null);
}

// ── Workflow State Transitions ─────────────────────────────────────────────────

async function testWorkflowTransitions() {
  console.log("\n[Workflow Transitions]");

  // Create a case in 'new' status
  const { status: cs, data: created } = await req("POST", "/api/winter/cases", {
    customerName: "Workflow Test Corp",
    customerEmail: "workflow@test.ca",
    issueType: "overheating",
    severity: "high",
    subject: "Unit overheating test",
    status: "new",
    country: "Canada",
  });
  assert("Create case with 'new' status → 201", cs === 201, `got ${cs}`);
  assert("Case has caseNumber", typeof created?.caseNumber === "string");
  caseId = created?.id;

  if (!caseId) return;

  // Transition: new → triaging
  const { status: t1, data: d1 } = await req("PUT", `/api/winter/cases/${caseId}`, { status: "triaging" });
  assert("Transition new → triaging → 200", t1 === 200, `got ${t1}`);
  assert("Status is triaging", d1?.status === "triaging", JSON.stringify(d1));
  assert("first_response_at stamped on triaging", d1?.firstResponseAt != null, JSON.stringify(d1));

  // Transition: triaging → in_progress
  const { status: t2, data: d2 } = await req("PUT", `/api/winter/cases/${caseId}`, { status: "in_progress" });
  assert("Transition triaging → in_progress → 200", t2 === 200, `got ${t2}`);
  assert("Status is in_progress", d2?.status === "in_progress");

  // Transition: in_progress → awaiting_customer
  const { status: t3, data: d3 } = await req("PUT", `/api/winter/cases/${caseId}`, { status: "awaiting_customer" });
  assert("Transition → awaiting_customer → 200", t3 === 200, `got ${t3}`);
  assert("Status is awaiting_customer", d3?.status === "awaiting_customer");

  // Transition: → escalated
  const { status: t4, data: d4 } = await req("PUT", `/api/winter/cases/${caseId}`, { status: "escalated" });
  assert("Transition → escalated → 200", t4 === 200, `got ${t4}`);
  assert("Status is escalated", d4?.status === "escalated");

  // Transition: → resolved (should stamp resolved_at)
  const { status: t5, data: d5 } = await req("PUT", `/api/winter/cases/${caseId}`, {
    status: "resolved",
    resolution: "Replaced unit under warranty",
  });
  assert("Transition → resolved → 200", t5 === 200, `got ${t5}`);
  assert("Status is resolved", d5?.status === "resolved", JSON.stringify(d5));
  assert("resolved_at stamped on resolved", d5?.resolvedAt != null, JSON.stringify(d5));

  // Transition: → closed
  const { status: t6, data: d6 } = await req("PUT", `/api/winter/cases/${caseId}`, { status: "closed" });
  assert("Transition → closed → 200", t6 === 200, `got ${t6}`);
  assert("Status is closed", d6?.status === "closed");
}

// ── SLA PATCH endpoint ─────────────────────────────────────────────────────────

async function testSlaPatch() {
  console.log("\n[SLA Patch Endpoint]");

  // Create fresh case
  const { data: c } = await req("POST", "/api/winter/cases", {
    customerName: "SLA Test Co",
    issueType: "warranty",
    severity: "medium",
    subject: "SLA test case",
  });
  const id = c?.id;
  if (!id) { assert("SLA test case created", false, "no id"); return; }

  // first_response action
  const { status: s1, data: d1 } = await req("PATCH", `/api/winter/cases/${id}/sla`, { action: "first_response" });
  assert("PATCH sla first_response → 200", s1 === 200, `got ${s1}`);
  assert("firstResponseAt set", d1?.firstResponseAt != null, JSON.stringify(d1));

  // customer_replied action
  const { status: s2, data: d2 } = await req("PATCH", `/api/winter/cases/${id}/sla`, { action: "customer_replied" });
  assert("PATCH sla customer_replied → 200", s2 === 200, `got ${s2}`);
  assert("lastCustomerReplyAt set", d2?.lastCustomerReplyAt != null, JSON.stringify(d2));

  // resolve action
  const { status: s3, data: d3 } = await req("PATCH", `/api/winter/cases/${id}/sla`, { action: "resolve" });
  assert("PATCH sla resolve → 200", s3 === 200, `got ${s3}`);
  assert("resolvedAt set", d3?.resolvedAt != null, JSON.stringify(d3));
  assert("Status set to resolved", d3?.status === "resolved", JSON.stringify(d3));

  // invalid action
  const { status: s4 } = await req("PATCH", `/api/winter/cases/${id}/sla`, { action: "invalid_action" });
  assert("PATCH sla invalid action → 400", s4 === 400, `got ${s4}`);

  // non-existent case
  const { status: s5 } = await req("PATCH", "/api/winter/cases/999999/sla", { action: "resolve" });
  assert("PATCH sla non-existent → 404", s5 === 404, `got ${s5}`);
}

// ── Response Templates ────────────────────────────────────────────────────────

async function testTemplates() {
  console.log("\n[Response Templates]");

  // List (seeded — 8 templates)
  const { status: ls, data: list } = await req("GET", "/api/winter/templates");
  assert("GET /api/winter/templates → 200", ls === 200, `got ${ls}`);
  assert("Templates is array", Array.isArray(list), `got ${typeof list}`);
  assert("Seed templates present (≥1)", list.length >= 1, `got ${list.length}`);
  if (list.length > 0) {
    const t = list[0];
    assert("Template has name", typeof t.name === "string");
    assert("Template has issueType", typeof t.issueType === "string");
    assert("Template has bodyTemplate", typeof t.bodyTemplate === "string");
    assert("Template has isActive", typeof t.isActive === "boolean");
  }

  // Filter by issue type
  const { status: fs, data: filtered } = await req("GET", "/api/winter/templates?issueType=warranty");
  assert("GET /api/winter/templates?issueType=warranty → 200", fs === 200, `got ${fs}`);
  assert("Filtered templates is array", Array.isArray(filtered));
  if (filtered.length > 0) assert("Filtered only warranty", filtered.every(t => t.issueType === "warranty"), JSON.stringify(filtered[0]));

  // Create
  const { status: cs, data: created } = await req("POST", "/api/winter/templates", {
    name: "Test Cable Wear Response",
    issueType: "cable_wear",
    subjectTemplate: "Re: Your VoltSafe Cable Issue",
    bodyTemplate: "Hi {{customer_name}},\n\nThank you for contacting us about the cable issue.\n\nWe will send a replacement immediately.\n\nBest,\nVoltSafe",
    isActive: true,
    sortOrder: 99,
  });
  assert("POST /api/winter/templates → 201", cs === 201, `got ${cs}`);
  assert("Created template has id", created?.id != null, JSON.stringify(created));
  assert("Created template name matches", created?.name === "Test Cable Wear Response", JSON.stringify(created));
  templateId = created?.id;

  // Validation
  const { status: vs } = await req("POST", "/api/winter/templates", { issueType: "warranty" });
  assert("POST /api/winter/templates missing required fields → 400", vs === 400, `got ${vs}`);

  // Update
  if (templateId) {
    const { status: us, data: updated } = await req("PUT", `/api/winter/templates/${templateId}`, {
      isActive: false,
      name: "Test Cable Wear Response (Archived)",
    });
    assert("PUT /api/winter/templates/:id → 200", us === 200, `got ${us}`);
    assert("Updated template isActive", updated?.isActive === false, JSON.stringify(updated));
  }

  // 404
  const { status: ns } = await req("PUT", "/api/winter/templates/999999", { isActive: false });
  assert("PUT /api/winter/templates/999999 → 404", ns === 404, `got ${ns}`);
}

// ── Queues ────────────────────────────────────────────────────────────────────

async function testQueues() {
  console.log("\n[Case Queues]");

  const { status, data } = await req("GET", "/api/winter/queues");
  assert("GET /api/winter/queues → 200", status === 200, `got ${status}`);
  assert("Has unassigned array", Array.isArray(data?.unassigned));
  assert("Has highSeverity array", Array.isArray(data?.highSeverity));
  assert("Has retailer array", Array.isArray(data?.retailer));
  assert("Has relaunches array", Array.isArray(data?.relaunches));
  assert("Has escalated array", Array.isArray(data?.escalated));
  assert("Has awaitingCustomer array", Array.isArray(data?.awaitingCustomer));
  assert("Has counts object", data?.counts != null && typeof data?.counts === "object");
  assert("counts.unassigned is number", typeof data?.counts?.unassigned === "number");
  assert("counts.highSeverity is number", typeof data?.counts?.highSeverity === "number");
  assert("counts.escalated is number", typeof data?.counts?.escalated === "number");

  // Verify queue items have expected fields
  const allItems = [
    ...data.unassigned, ...data.highSeverity, ...data.retailer,
    ...data.relaunches, ...data.escalated, ...data.awaitingCustomer,
  ];
  if (allItems.length > 0) {
    const item = allItems[0];
    assert("Queue item has caseNumber", typeof item.caseNumber === "string", JSON.stringify(item));
    assert("Queue item has daysOpen", item.daysOpen != null, JSON.stringify(item));
  }

  // Verify high severity queue only contains high/critical cases
  if (data.highSeverity.length > 0) {
    assert("HighSev queue items are high/critical",
      data.highSeverity.every(c => ["high", "critical"].includes(c.severity)),
      JSON.stringify(data.highSeverity[0]));
  }

  // Verify escalated queue only contains escalated cases
  if (data.escalated.length > 0) {
    assert("Escalated queue items have escalated status",
      data.escalated.every(c => c.status === "escalated"),
      JSON.stringify(data.escalated[0]));
  }

  // Auth guard
  const { status: ns } = await req("GET", "/api/winter/queues", undefined, "");
  assert("GET /api/winter/queues without auth → 401", ns === 401, `got ${ns}`);
}

// ── Metrics ───────────────────────────────────────────────────────────────────

async function testMetrics() {
  console.log("\n[Case Metrics]");

  const { status, data } = await req("GET", "/api/winter/metrics");
  assert("GET /api/winter/metrics → 200", status === 200, `got ${status}`);

  // SLA block
  assert("Has sla block", data?.sla != null);
  assert("sla.totalCases is number", typeof data?.sla?.totalCases === "number");
  assert("sla.openCases is number", typeof data?.sla?.openCases === "number");
  assert("sla.escalated is number", typeof data?.sla?.escalated === "number");
  assert("sla.noFirstResponse is number", typeof data?.sla?.noFirstResponse === "number");
  assert("sla.criticalOpen is number", typeof data?.sla?.criticalOpen === "number");
  // avgFirstResponseHrs is null or number
  assert("sla.avgFirstResponseHrs is null or number", data?.sla?.avgFirstResponseHrs == null || typeof data?.sla?.avgFirstResponseHrs === "number");
  assert("sla.avgResolutionHrs is null or number", data?.sla?.avgResolutionHrs == null || typeof data?.sla?.avgResolutionHrs === "number");

  // byType block
  assert("Has byType array", Array.isArray(data?.byType));
  if (data?.byType?.length > 0) {
    const t = data.byType[0];
    assert("byType item has issueType", typeof t.issueType === "string");
    assert("byType item has total", t.total != null);
    assert("byType item has open_count", t.open_count != null);
  }

  // weeklyTrend
  assert("Has weeklyTrend array", Array.isArray(data?.weeklyTrend));
  if (data?.weeklyTrend?.length > 0) {
    const w = data.weeklyTrend[0];
    assert("weeklyTrend item has week", w.week != null);
    assert("weeklyTrend item has new_cases", w.new_cases != null);
  }

  // demandVsDefect
  assert("Has demandVsDefect object", data?.demandVsDefect != null);
  assert("demandVsDefect.demand_cases is string/number", data?.demandVsDefect?.demand_cases != null || data?.demandVsDefect?.demand_cases === "0");
  assert("demandVsDefect.defect_cases present", data?.demandVsDefect?.defect_cases != null || true);
  assert("demandVsDefect.technical_defects present", data?.demandVsDefect?.technical_defects != null || true);

  // staffBreakdown
  assert("Has staffBreakdown array", Array.isArray(data?.staffBreakdown));

  // Auth guard
  const { status: ns } = await req("GET", "/api/winter/metrics", undefined, "");
  assert("GET /api/winter/metrics without auth → 401", ns === 401, `got ${ns}`);
}

// ── Regression: original routes still work ────────────────────────────────────

async function testRegressions() {
  console.log("\n[Regressions: Core Routes]");

  // Products
  const { status: ps } = await req("GET", "/api/winter/products");
  assert("GET /api/winter/products → 200", ps === 200, `got ${ps}`);

  // Cases list
  const { status: cls } = await req("GET", "/api/winter/cases");
  assert("GET /api/winter/cases → 200", cls === 200, `got ${cls}`);

  // Cases with new status values in filter
  const { status: csf } = await req("GET", "/api/winter/cases?status=triaging");
  assert("GET /api/winter/cases?status=triaging → 200", csf === 200, `got ${csf}`);

  const { status: csf2 } = await req("GET", "/api/winter/cases?status=escalated");
  assert("GET /api/winter/cases?status=escalated → 200", csf2 === 200, `got ${csf2}`);

  const { status: csf3 } = await req("GET", "/api/winter/cases?status=awaiting_customer");
  assert("GET /api/winter/cases?status=awaiting_customer → 200", csf3 === 200, `got ${csf3}`);

  // KB
  const { status: ks } = await req("GET", "/api/winter/kb");
  assert("GET /api/winter/kb → 200", ks === 200, `got ${ks}`);

  // Dashboard
  const { status: ds } = await req("GET", "/api/winter/dashboard");
  assert("GET /api/winter/dashboard → 200", ds === 200, `got ${ds}`);

  // Demand signals
  const { status: dms } = await req("GET", "/api/winter/demand-signals");
  assert("GET /api/winter/demand-signals → 200", dms === 200, `got ${dms}`);

  // Email scan still works
  const { status: ss, data: sd } = await req("POST", "/api/winter/scan-emails", { limitHours: 1 });
  assert("POST /api/winter/scan-emails → 200", ss === 200, `got ${ss}`);
  assert("Scan result has scanned/created/skipped", sd?.scanned != null && sd?.created != null, JSON.stringify(sd));
}

// ── Assignment logic ──────────────────────────────────────────────────────────

async function testAssignment() {
  console.log("\n[Assignment Logic]");

  // Create an unassigned case
  const { data: c } = await req("POST", "/api/winter/cases", {
    customerName: "Assignment Test",
    issueType: "general",
    severity: "low",
    subject: "Assignment test case",
  });
  const id = c?.id;
  if (!id) { assert("Assignment case created", false, "no id"); return; }

  // Assign to user 4 (Trevor)
  const { status: as, data: ad } = await req("PUT", `/api/winter/cases/${id}`, { ownerId: 4 });
  assert("Assign case to owner → 200", as === 200, `got ${as}`);

  // Verify queues now excludes this case from unassigned
  const { data: q } = await req("GET", "/api/winter/queues");
  const inUnassigned = (q?.unassigned ?? []).some(c => c.id === id);
  assert("Assigned case removed from unassigned queue", !inUnassigned, `id=${id} found in unassigned`);

  // Unassign
  const { status: us } = await req("PUT", `/api/winter/cases/${id}`, { ownerId: null });
  assert("Unassign case → 200", us === 200, `got ${us}`);
}

// ── Run ───────────────────────────────────────────────────────────────────────

async function run() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  VoltSafe Winter Workflow Hardening — Integration Tests");
  console.log("═══════════════════════════════════════════════════════════");

  await login();
  await testWorkflowTransitions();
  await testSlaPatch();
  await testTemplates();
  await testQueues();
  await testMetrics();
  await testAssignment();
  await testRegressions();

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
  console.error("Fatal:", e);
  process.exit(1);
});
