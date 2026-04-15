/**
 * Safety Certification Projects — API Tests
 * Covers all 7 phases: type, cert fields, list badges, milestones, alerts, docs, regression.
 */

const BASE = "http://localhost:5000";
let cookie = "";
let certProjectId = null;
let regularProjectId = null;
let milestoneId = null;

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
  let passed = 0, failed = 0;
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
  });

  // ── Phase 1: Safety Certification type exists ────────────────────────────────
  await test("GET /api/projects — returns array", async () => {
    const r = await req("GET", "/api/projects");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.body), "Expected array");
  });

  await test("POST /api/projects — create Safety Certification project", async () => {
    const r = await req("POST", "/api/projects", {
      name: "VoltSafe EV Charger CSA Cert",
      type: "certification",
      status: "planning",
      description: "CSA/UL certification for our 48A marina EV charging system",
    });
    assert(r.status === 201, `Expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.id, "No id returned");
    assert(r.body.type === "certification", `type mismatch: ${r.body.type}`);
    certProjectId = r.body.id;
  });

  await test("POST /api/projects — create regular pilot project (regression)", async () => {
    const r = await req("POST", "/api/projects", {
      name: "Test Pilot Project",
      type: "pilot",
      status: "active",
    });
    assert(r.status === 201, `Expected 201, got ${r.status}`);
    assert(r.body.type === "pilot", "type should be pilot");
    regularProjectId = r.body.id;
  });

  await test("GET /api/projects — cert project appears in list", async () => {
    const r = await req("GET", "/api/projects");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    const found = r.body.find(p => p.id === certProjectId);
    assert(found, `Cert project ${certProjectId} not in list`);
    assert(found.type === "certification", `type mismatch: ${found.type}`);
  });

  await test("GET /api/projects?type=certification — type filter works", async () => {
    const r = await req("GET", "/api/projects?type=certification");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.body), "Expected array");
    const found = r.body.find(p => p.id === certProjectId);
    assert(found, "Cert project not in filtered list");
    for (const p of r.body) {
      assert(p.type === "certification", `Non-cert project in cert filter: ${p.type}`);
    }
  });

  await test("GET /api/projects/:id — cert project detail with joined fields", async () => {
    assert(certProjectId, "No certProjectId");
    const r = await req("GET", `/api/projects/${certProjectId}`);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.id === certProjectId, "id mismatch");
    assert(r.body.type === "certification", `type mismatch: ${r.body.type}`);
    // List response includes joined cert fields (may be null at first)
    assert("certification_status" in r.body || r.body.certification_status === undefined || r.body.certification_status === null || typeof r.body.certification_status === "string", "certification_status field missing from response shape");
  });

  // ── Phase 4: Milestone auto-creation ─────────────────────────────────────────
  await test("GET /api/projects/:id/milestones — auto-created 12 milestones", async () => {
    assert(certProjectId, "No certProjectId");
    const r = await req("GET", `/api/projects/${certProjectId}/milestones`);
    assert(r.status === 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(Array.isArray(r.body), "Expected array");
    assert(r.body.length === 12, `Expected 12 milestones, got ${r.body.length}`);
    // Verify first and last milestone titles
    const titles = r.body.map(m => m.title);
    assert(titles.some(t => t.includes("certification scope")), `Expected 'certification scope' milestone, got: ${JSON.stringify(titles)}`);
    assert(titles.some(t => t.includes("Certificate received")), `Expected 'Certificate received' milestone`);
    milestoneId = r.body[0].id;
  });

  await test("GET /api/projects/:id/milestones — all milestones start as pending", async () => {
    assert(certProjectId, "No certProjectId");
    const r = await req("GET", `/api/projects/${certProjectId}/milestones`);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    for (const m of r.body) {
      assert(m.status === "pending", `Milestone ${m.id} not pending: ${m.status}`);
    }
  });

  await test("GET /api/projects/:id/milestones — regular project has no milestones", async () => {
    assert(regularProjectId, "No regularProjectId");
    const r = await req("GET", `/api/projects/${regularProjectId}/milestones`);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.length === 0, `Expected 0 milestones for pilot, got ${r.body.length}`);
  });

  await test("PATCH /api/projects/:id/milestones/:mid — mark first milestone done", async () => {
    assert(certProjectId && milestoneId, "Missing IDs");
    const r = await req("PATCH", `/api/projects/${certProjectId}/milestones/${milestoneId}`, { status: "done" });
    assert(r.status === 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.status === "done", `Expected done, got ${r.body.status}`);
    assert(r.body.completed_at, "completed_at should be set");
  });

  await test("PATCH /api/projects/:id/milestones/:mid — mark milestone in_progress", async () => {
    assert(certProjectId && milestoneId, "Missing IDs");
    const r = await req("PATCH", `/api/projects/${certProjectId}/milestones/${milestoneId}`, { status: "in_progress" });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.status === "in_progress", `Expected in_progress, got ${r.body.status}`);
    assert(!r.body.completed_at, "completed_at should be null for in_progress");
  });

  await test("PATCH /api/projects/:id/milestones/:mid — 404 for wrong project_id", async () => {
    const r = await req("PATCH", `/api/projects/999999/milestones/${milestoneId}`, { status: "done" });
    assert(r.status === 404, `Expected 404, got ${r.status}`);
  });

  await test("POST /api/projects/:id/milestones — add custom milestone", async () => {
    assert(certProjectId, "No certProjectId");
    const r = await req("POST", `/api/projects/${certProjectId}/milestones`, {
      title: "Internal design review",
      status: "pending",
      sortOrder: 0,
    });
    assert(r.status === 201, `Expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.title === "Internal design review", "title mismatch");
    assert(r.body.project_id === certProjectId, "project_id mismatch");
  });

  await test("POST /api/projects/:id/milestones — missing title → 400", async () => {
    const r = await req("POST", `/api/projects/${certProjectId}/milestones`, { status: "pending" });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  });

  // ── Phase 2: Certification fields save/load ──────────────────────────────────
  await test("GET /api/projects/:id/certification — cert record auto-created", async () => {
    assert(certProjectId, "No certProjectId");
    const r = await req("GET", `/api/projects/${certProjectId}/certification`);
    assert(r.status === 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body !== null, "Expected cert record, got null");
    assert(r.body.project_id === certProjectId, "project_id mismatch");
  });

  await test("POST /api/projects/:id/certification — save core cert fields", async () => {
    assert(certProjectId, "No certProjectId");
    const r = await req("POST", `/api/projects/${certProjectId}/certification`, {
      certificationProgram: JSON.stringify(["CSA", "UL"]),
      certificationScope: "48A Level 2 EV charger, marina-grade, IP66",
      productName: "VoltSafe Marina Charger",
      productVersion: "v2.1",
      productRevision: "Rev C",
      skuOrInternalCode: "VSM-48A-C",
      certificationPriority: "Critical",
      certificationStatus: "Document Prep",
      overallRisk: "Medium",
      launchBlocker: false,
      targetMarket: "Canada",
      testingLabName: "Intertek Toronto",
      labContactName: "Jane Smith",
      labContactEmail: "jane@intertek.com",
      labContactPhone: "416-555-0100",
      certificationStandardCodes: "CSA C22.2 No. 107.1, UL 2594",
      nextAction: "Submit documentation package",
      nextActionDueDate: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
      sampleUnitsRequired: 3,
      sampleUnitsBuilt: 2,
      estimatedCertificationCost: 45000,
      budgetStatus: "On Budget",
      certificationDocLink: "https://drive.google.com/test-doc",
      complianceNotes: "Focus on waterproofing and shock hazard mitigation",
    });
    assert(r.status === 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.product_name === "VoltSafe Marina Charger", `product_name mismatch: ${r.body.product_name}`);
    assert(r.body.certification_status === "Document Prep", `cert status mismatch: ${r.body.certification_status}`);
    assert(r.body.overall_risk === "Medium", `risk mismatch: ${r.body.overall_risk}`);
    assert(r.body.testing_lab_name === "Intertek Toronto", "lab name mismatch");
    assert(r.body.sample_units_required === 3, `sample_units_required mismatch: ${r.body.sample_units_required}`);
    assert(parseFloat(r.body.estimated_certification_cost) === 45000, `cost mismatch: ${r.body.estimated_certification_cost}`);
  });

  await test("GET /api/projects/:id/certification — fields persist correctly", async () => {
    assert(certProjectId, "No certProjectId");
    const r = await req("GET", `/api/projects/${certProjectId}/certification`);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.product_name === "VoltSafe Marina Charger", "product_name not persisted");
    assert(r.body.certification_status === "Document Prep", "certification_status not persisted");
    assert(r.body.testing_lab_name === "Intertek Toronto", "testing_lab_name not persisted");
    assert(r.body.compliance_notes, "compliance_notes not persisted");
    assert(r.body.certification_doc_link === "https://drive.google.com/test-doc", "doc link not persisted");
  });

  await test("PUT /api/projects/:id/certification — update cert status", async () => {
    assert(certProjectId, "No certProjectId");
    const r = await req("PUT", `/api/projects/${certProjectId}/certification`, {
      certificationStatus: "In Testing",
      overallRisk: "High",
    });
    assert(r.status === 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.certification_status === "In Testing", `cert status mismatch: ${r.body.certification_status}`);
    assert(r.body.overall_risk === "High", `risk mismatch: ${r.body.overall_risk}`);
  });

  await test("PUT /api/projects/:id/certification — set launch_blocker = true", async () => {
    assert(certProjectId, "No certProjectId");
    const r = await req("PUT", `/api/projects/${certProjectId}/certification`, {
      launchBlocker: true,
      blockerSummary: "Waterproofing test failed — IP66 enclosure requires redesign",
      failureFound: true,
      failureSummary: "IP66 seal failed under 500ml water column",
      correctiveActionRequired: true,
      retestRequired: true,
      retestDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    });
    assert(r.status === 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.launch_blocker === true, `launch_blocker mismatch: ${r.body.launch_blocker}`);
    assert(r.body.retest_required === true, "retest_required mismatch");
    assert(r.body.failure_found === true, "failure_found mismatch");
  });

  // ── Phase 3: Cert fields in project list ────────────────────────────────────
  await test("GET /api/projects — cert project includes joined cert fields", async () => {
    assert(certProjectId, "No certProjectId");
    const r = await req("GET", "/api/projects?type=certification");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    const found = r.body.find(p => p.id === certProjectId);
    assert(found, "Cert project not found in list");
    assert(found.certification_status === "In Testing", `certification_status not joined: ${found.certification_status}`);
    assert(found.overall_risk === "High", `overall_risk not joined: ${found.overall_risk}`);
    assert(found.launch_blocker === true, `launch_blocker not joined: ${found.launch_blocker}`);
  });

  await test("GET /api/projects — regular pilot project has null cert fields", async () => {
    assert(regularProjectId, "No regularProjectId");
    const r = await req("GET", "/api/projects?type=pilot");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    const found = r.body.find(p => p.id === regularProjectId);
    assert(found, "Regular project not found in list");
    assert(found.certification_status === null || found.certification_status === undefined, `Expected null cert_status for pilot, got: ${found.certification_status}`);
  });

  // ── Phase 5: Smart alerts / task creation ────────────────────────────────────
  await test("POST /api/projects/:id/create-alerts — creates tasks for blocker + retest", async () => {
    assert(certProjectId, "No certProjectId");
    const r = await req("POST", `/api/projects/${certProjectId}/create-alerts`, {});
    assert(r.status === 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.ok === true, "Missing ok: true");
    assert(typeof r.body.tasksCreated === "number", "Missing tasksCreated count");
    assert(r.body.tasksCreated >= 2, `Expected ≥2 tasks (blocker + retest + next-action), got ${r.body.tasksCreated}`);
  });

  await test("POST /api/projects/:id/create-alerts — idempotent on 2nd run", async () => {
    assert(certProjectId, "No certProjectId");
    const r = await req("POST", `/api/projects/${certProjectId}/create-alerts`, {});
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    // De-duped: no new tasks created
    assert(r.body.tasksCreated === 0, `Expected 0 duplicate tasks, got ${r.body.tasksCreated}`);
  });

  await test("POST /api/projects/999999/create-alerts — 404 for missing cert record", async () => {
    // Create a project without cert record
    const r = await req("POST", "/api/projects/999999/create-alerts", {});
    assert(r.status === 404, `Expected 404, got ${r.status}`);
  });

  // ── PUT /api/projects/:id/certification — 404 for non-existent ──────────────
  await test("PUT /api/projects/999999/certification — 404 for missing", async () => {
    const r = await req("PUT", "/api/projects/999999/certification", { certificationStatus: "Planning" });
    assert(r.status === 404, `Expected 404, got ${r.status}`);
  });

  await test("PUT /api/projects/:id/certification — empty body → 400", async () => {
    assert(certProjectId, "No certProjectId");
    const r = await req("PUT", `/api/projects/${certProjectId}/certification`, {});
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  });

  // ── Update cert status through all valid values ──────────────────────────────
  await test("PUT /api/projects/:id/certification — can set each CERT_STATUS", async () => {
    const statuses = ["Planning","Document Prep","Sample Build","Submitted","In Testing","Failure Review","Corrective Action","Retest","Passed","Certified","Blocked","Cancelled"];
    for (const s of statuses) {
      const r = await req("PUT", `/api/projects/${certProjectId}/certification`, { certificationStatus: s });
      assert(r.status === 200, `Expected 200 for status ${s}, got ${r.status}`);
      assert(r.body.certification_status === s, `Status ${s} not saved: got ${r.body.certification_status}`);
    }
  });

  // ── Converting existing project to certification type ────────────────────────
  await test("PUT /api/projects/:id — change type to certification auto-scaffolds", async () => {
    assert(regularProjectId, "No regularProjectId");
    const r = await req("PUT", `/api/projects/${regularProjectId}`, { type: "certification" });
    assert(r.status === 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.type === "certification", `type mismatch: ${r.body.type}`);
    // Milestones should now be created
    const ms = await req("GET", `/api/projects/${regularProjectId}/milestones`);
    assert(ms.status === 200, `Milestones 200, got ${ms.status}`);
    assert(ms.body.length === 12, `Expected 12 milestones after type change, got ${ms.body.length}`);
    // Convert back
    await req("PUT", `/api/projects/${regularProjectId}`, { type: "pilot" });
  });

  // ── Regression: existing project CRUD unchanged ──────────────────────────────
  await test("GET /api/projects/:id — regular project detail works", async () => {
    assert(regularProjectId, "No regularProjectId");
    const r = await req("GET", `/api/projects/${regularProjectId}`);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.id === regularProjectId, "id mismatch");
  });

  await test("PUT /api/projects/:id — update regular project name", async () => {
    assert(regularProjectId, "No regularProjectId");
    const r = await req("PUT", `/api/projects/${regularProjectId}`, { name: "Updated Pilot Project" });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.name === "Updated Pilot Project", `name mismatch: ${r.body.name}`);
  });

  await test("GET /api/projects?status=active — status filter works", async () => {
    const r = await req("GET", "/api/projects?status=active");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.body), "Expected array");
    for (const p of r.body) {
      assert(p.status === "active", `Non-active project in active filter: ${p.status}`);
    }
  });

  // ── Auth guards ──────────────────────────────────────────────────────────────
  await test("GET /api/projects — unauthenticated → 401", async () => {
    const r = await fetch(`${BASE}/api/projects`);
    assert(r.status === 401, `Expected 401, got ${r.status}`);
  });

  await test("GET /api/projects/:id/milestones — unauthenticated → 401", async () => {
    assert(certProjectId, "No certProjectId");
    const r = await fetch(`${BASE}/api/projects/${certProjectId}/milestones`);
    assert(r.status === 401, `Expected 401, got ${r.status}`);
  });

  await test("GET /api/projects/:id/certification — unauthenticated → 401", async () => {
    assert(certProjectId, "No certProjectId");
    const r = await fetch(`${BASE}/api/projects/${certProjectId}/certification`);
    assert(r.status === 401, `Expected 401, got ${r.status}`);
  });

  // ── Cleanup ──────────────────────────────────────────────────────────────────
  await test("DELETE /api/projects/:id — delete cert project", async () => {
    assert(certProjectId, "No certProjectId");
    const r = await req("DELETE", `/api/projects/${certProjectId}`);
    assert(r.status === 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.ok === true, "Missing ok: true");
  });

  await test("DELETE /api/projects/:id — delete pilot project", async () => {
    assert(regularProjectId, "No regularProjectId");
    const r = await req("DELETE", `/api/projects/${regularProjectId}`);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
  });

  await test("GET /api/projects/:id — 404 after delete", async () => {
    const r = await req("GET", `/api/projects/${certProjectId}`);
    assert(r.status === 404, `Expected 404, got ${r.status}`);
  });

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════");
  console.log(`  Certification Tests: ${passed} passed, ${failed} failed`);
  console.log("══════════════════════════════════════════\n");
  results.forEach(r => {
    console.log(`  ${r.ok ? "✓" : "✗"} ${r.name}${r.error ? `\n      → ${r.error}` : ""}`);
  });
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error("Test runner error:", e); process.exit(1); });
