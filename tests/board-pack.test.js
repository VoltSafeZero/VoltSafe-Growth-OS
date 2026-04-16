/**
 * Executive PDF / Board Pack Export — Phase 7 Tests
 * Tests: metadata endpoints, report composition, section filtering,
 *        narrative bullets, preset CRUD, export shape, no regression.
 */
import fetch from "node-fetch";

const BASE = process.env.TEST_BASE_URL || "http://localhost:5000";

async function loginAs(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie") || "";
  const match = setCookie.match(/connect\.sid=[^;]+/);
  return match ? match[0] : null;
}

async function authedFetch(cookie, path, opts = {}) {
  return fetch(`${BASE}${path}`, {
    ...opts,
    headers: { ...(opts.headers || {}), Cookie: cookie },
  });
}

function json(cookie, path, opts = {}) {
  return authedFetch(cookie, path, {
    ...opts,
    headers: { ...(opts.headers || {}), "Content-Type": "application/json" },
  }).then(r => r.json());
}

function post(cookie, path, body) {
  return json(cookie, path, { method: "POST", body: JSON.stringify(body) });
}

// ── Runner ────────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function pass(label) { console.log(`  ✅ ${label}`); passed++; }
function fail(label, detail) { console.log(`  ❌ ${label}`); if (detail) console.log(`     ${detail}`); failed++; }
async function check(label, fn) {
  try { await fn(); pass(label); }
  catch (e) { fail(label, e.message); }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────
let cookie;
const createdPresetIds = [];

async function createPreset(body) {
  const preset = await post(cookie, "/api/reports/presets", body);
  if (preset.id) createdPresetIds.push(preset.id);
  return preset;
}

async function cleanup() {
  for (const id of createdPresetIds) {
    await authedFetch(cookie, `/api/reports/presets/${id}`, { method: "DELETE" });
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function runMetadataTests() {
  console.log("\n── Metadata Endpoints ───────────────────────────────────────────────────────");

  await check("GET /api/reports/types → 200, array of ≥5 types", async () => {
    const res = await authedFetch(cookie, "/api/reports/types");
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("Expected array");
    if (data.length < 5) throw new Error(`Expected ≥5 types, got ${data.length}`);
    const first = data[0];
    if (!first.value || !first.label || !first.description) throw new Error(`Shape wrong: ${JSON.stringify(first)}`);
  });

  await check("GET /api/reports/types — includes executive_weekly, board_pack, fundraising_snapshot", async () => {
    const data = await json(cookie, "/api/reports/types");
    const values = data.map(t => t.value);
    for (const v of ["executive_weekly", "board_pack", "fundraising_snapshot", "monthly_leadership", "ops_review"]) {
      if (!values.includes(v)) throw new Error(`Missing type: ${v}`);
    }
  });

  await check("GET /api/reports/sections → array of ≥11 sections with key/label/description/defaultFor", async () => {
    const res = await authedFetch(cookie, "/api/reports/sections");
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("Expected array");
    if (data.length < 11) throw new Error(`Expected ≥11 sections, got ${data.length}`);
    const first = data[0];
    if (!first.key || !first.label || !first.description || !Array.isArray(first.defaultFor)) {
      throw new Error(`Section shape wrong: ${JSON.stringify(first)}`);
    }
  });

  await check("GET /api/reports/sections — includes all 11 expected section keys", async () => {
    const data = await json(cookie, "/api/reports/sections");
    const keys = data.map(s => s.key);
    const expected = [
      "kpi_summary", "pipeline_forecast", "quote_snapshot", "installs_deployments",
      "procurement_risks", "certification_oversight", "customer_success",
      "geography_territory", "source_attribution", "risk_blockers", "narrative_bullets",
    ];
    for (const k of expected) {
      if (!keys.includes(k)) throw new Error(`Missing section key: ${k}`);
    }
  });

  await check("Metadata endpoints — unauthenticated → 401", async () => {
    const res1 = await fetch(`${BASE}/api/reports/types`);
    const res2 = await fetch(`${BASE}/api/reports/sections`);
    if (res1.status !== 401) throw new Error(`types: Expected 401, got ${res1.status}`);
    if (res2.status !== 401) throw new Error(`sections: Expected 401, got ${res2.status}`);
  });
}

async function runComposeTests() {
  console.log("\n── Phase 1 — Report Data Composer ──────────────────────────────────────────");

  await check("POST /api/reports/compose → 200, returns meta + sections", async () => {
    const res = await authedFetch(cookie, "/api/reports/compose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportType: "executive_weekly" }),
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const data = await res.json();
    if (!data.meta) throw new Error("meta missing");
    if (data.meta.reportType !== "executive_weekly") throw new Error("reportType mismatch");
    if (!data.meta.generatedAt) throw new Error("generatedAt missing");
    if (!Array.isArray(data.meta.sectionsIncluded)) throw new Error("sectionsIncluded not array");
  });

  await check("POST /compose — kpiSummary has expected numeric fields", async () => {
    const data = await post(cookie, "/api/reports/compose", { reportType: "executive_weekly", sections: ["kpi_summary"] });
    const k = data.kpiSummary;
    if (!k) throw new Error("kpiSummary missing");
    const numFields = ["totalPipeline", "weightedPipeline", "commitAmount", "closedWonAmount", "totalOpps", "stalledCount",
      "acceptedRevenue", "winRate", "totalLeads", "convertedLeads", "conversionRate", "installsInProgress",
      "installsComplete", "installBlockers", "overdueTasks", "unownedLeads"];
    for (const f of numFields) {
      if (typeof k[f] !== "number") throw new Error(`kpiSummary.${f} is not a number: ${k[f]}`);
    }
  });

  await check("POST /compose — pipelineForecast has periods array and totals", async () => {
    const data = await post(cookie, "/api/reports/compose", { reportType: "board_pack", sections: ["pipeline_forecast"] });
    const p = data.pipelineForecast;
    if (!p) throw new Error("pipelineForecast missing");
    if (!Array.isArray(p.periods)) throw new Error("periods not array");
    if (typeof p.totalWeightedForecast !== "number") throw new Error("totalWeightedForecast not a number");
    if (typeof p.totalCommit !== "number") throw new Error("totalCommit not a number");
    if (typeof p.totalBestCase !== "number") throw new Error("totalBestCase not a number");
    if (p.periods.length > 0) {
      const period = p.periods[0];
      for (const f of ["month", "label", "commitAmount", "bestCaseAmount", "pipelineAmount", "closedWonAmount", "totalWeighted"]) {
        if (period[f] === undefined) throw new Error(`Period missing field: ${f}`);
      }
    }
  });

  await check("POST /compose — quoteSnapshot has correct shape", async () => {
    const data = await post(cookie, "/api/reports/compose", { reportType: "board_pack", sections: ["quote_snapshot"] });
    const q = data.quoteSnapshot;
    if (!q) throw new Error("quoteSnapshot missing");
    for (const f of ["total", "sent", "accepted", "declined", "expired", "awaitingResponse", "acceptedRevenue", "winRate"]) {
      if (typeof q[f] !== "number") throw new Error(`quoteSnapshot.${f} not a number: ${q[f]}`);
    }
    if (!Array.isArray(q.recentQuotes)) throw new Error("recentQuotes not array");
  });

  await check("POST /compose — installsDeployments has correct shape", async () => {
    const data = await post(cookie, "/api/reports/compose", { reportType: "ops_review", sections: ["installs_deployments"] });
    const i = data.installsDeployments;
    if (!i) throw new Error("installsDeployments missing");
    for (const f of ["total", "inProgress", "pendingKickoff", "complete", "onHold", "withBlockers", "overdue", "completedThisMonth"]) {
      if (typeof i[f] !== "number") throw new Error(`installsDeployments.${f} not a number`);
    }
    if (!Array.isArray(i.recentBlockers)) throw new Error("recentBlockers not array");
  });

  await check("POST /compose — procurementRisks has correct shape", async () => {
    const data = await post(cookie, "/api/reports/compose", { reportType: "ops_review", sections: ["procurement_risks"] });
    const p = data.procurementRisks;
    if (!p) throw new Error("procurementRisks missing");
    for (const f of ["lowStockItems", "pendingPOs", "blockedInstalls"]) {
      if (typeof p[f] !== "number") throw new Error(`procurementRisks.${f} not a number`);
    }
    if (!Array.isArray(p.criticalItems)) throw new Error("criticalItems not array");
  });

  await check("POST /compose — certificationOversight has correct shape", async () => {
    const data = await post(cookie, "/api/reports/compose", { reportType: "board_pack", sections: ["certification_oversight"] });
    const c = data.certificationOversight;
    if (!c) throw new Error("certificationOversight missing");
    for (const f of ["total", "certified", "blocked", "atRisk", "onTrack", "retestRequired", "certExpiring90d"]) {
      if (typeof c[f] !== "number") throw new Error(`certificationOversight.${f} not a number`);
    }
    if (!Array.isArray(c.nextDueItems)) throw new Error("nextDueItems not array");
  });

  await check("POST /compose — customerSuccess has correct shape", async () => {
    const data = await post(cookie, "/api/reports/compose", { reportType: "board_pack", sections: ["customer_success"] });
    const cs = data.customerSuccess;
    if (!cs) throw new Error("customerSuccess missing");
    for (const f of ["healthy", "atRisk", "critical", "renewalValue30d", "renewalValue60d", "renewalValue90d", "totalRenewalExposure"]) {
      if (typeof cs[f] !== "number") throw new Error(`customerSuccess.${f} not a number`);
    }
    if (!Array.isArray(cs.highRiskAccounts)) throw new Error("highRiskAccounts not array");
  });

  await check("POST /compose — geographyTerritory has correct shape", async () => {
    const data = await post(cookie, "/api/reports/compose", { reportType: "board_pack", sections: ["geography_territory"] });
    const g = data.geographyTerritory;
    if (!g) throw new Error("geographyTerritory missing");
    if (!Array.isArray(g.regions)) throw new Error("regions not array");
    if (typeof g.whitespaceCount !== "number") throw new Error("whitespaceCount not a number");
    if (g.regions.length > 0) {
      const r = g.regions[0];
      for (const f of ["region", "leadCount", "accountCount", "oppCount", "pipelineValue"]) {
        if (r[f] === undefined) throw new Error(`Region missing field: ${f}`);
      }
    }
  });

  await check("POST /compose — sourceAttribution has correct shape", async () => {
    const data = await post(cookie, "/api/reports/compose", { reportType: "board_pack", sections: ["source_attribution"] });
    const s = data.sourceAttribution;
    if (!s) throw new Error("sourceAttribution missing");
    if (!Array.isArray(s.sources)) throw new Error("sources not array");
    if (s.sources.length > 0) {
      const src = s.sources[0];
      for (const f of ["source", "totalLeads", "convertedLeads", "totalOpps", "wonOpps", "totalRevenue", "conversionRate"]) {
        if (src[f] === undefined) throw new Error(`Source missing field: ${f}`);
      }
    }
  });

  await check("POST /compose — riskBlockers has correct shape", async () => {
    const data = await post(cookie, "/api/reports/compose", { reportType: "executive_weekly", sections: ["risk_blockers"] });
    const r = data.riskBlockers;
    if (!r) throw new Error("riskBlockers missing");
    for (const f of ["stalledOpps", "awaitingQuotes", "installBlockers", "overdueTasks"]) {
      if (!Array.isArray(r[f])) throw new Error(`riskBlockers.${f} not array`);
    }
    for (const f of ["unownedLeads", "dqRisks"]) {
      if (typeof r[f] !== "number") throw new Error(`riskBlockers.${f} not a number`);
    }
  });
}

async function runFilterTests() {
  console.log("\n── Phase 1 — Filtering ─────────────────────────────────────────────────────");

  await check("Section filter — only requested sections are present in response", async () => {
    const data = await post(cookie, "/api/reports/compose", {
      reportType: "board_pack",
      sections: ["kpi_summary", "quote_snapshot"],
    });
    if (!data.kpiSummary) throw new Error("kpiSummary missing when requested");
    if (!data.quoteSnapshot) throw new Error("quoteSnapshot missing when requested");
    if (data.pipelineForecast !== undefined) throw new Error("pipelineForecast should not be present");
    if (data.riskBlockers !== undefined) throw new Error("riskBlockers should not be present");
    if (data.certificationOversight !== undefined) throw new Error("certificationOversight should not be present");
  });

  await check("Section filter — single section only returns that section", async () => {
    const data = await post(cookie, "/api/reports/compose", { reportType: "ops_review", sections: ["installs_deployments"] });
    if (!data.installsDeployments) throw new Error("installsDeployments missing");
    if (data.kpiSummary !== undefined) throw new Error("kpiSummary should not be present");
    if (data.pipelineForecast !== undefined) throw new Error("pipelineForecast should not be present");
  });

  await check("Date range filter — dateFrom/dateTo passed in meta", async () => {
    const data = await post(cookie, "/api/reports/compose", {
      reportType: "executive_weekly",
      sections: ["kpi_summary"],
      dateFrom: "2025-01-01",
      dateTo: "2025-12-31",
    });
    if (!data.meta.dateFrom) throw new Error("dateFrom missing from meta");
    if (!data.meta.dateTo) throw new Error("dateTo missing from meta");
  });

  await check("Region filter — region stored in meta", async () => {
    const data = await post(cookie, "/api/reports/compose", {
      reportType: "board_pack",
      sections: ["geography_territory"],
      region: "Pacific Northwest",
    });
    if (data.meta.region !== "Pacific Northwest") throw new Error(`Expected region in meta, got ${data.meta.region}`);
  });

  await check("All sections — compose with all 11 sections returns complete report", async () => {
    const allSections = [
      "kpi_summary", "pipeline_forecast", "quote_snapshot", "installs_deployments",
      "procurement_risks", "certification_oversight", "customer_success",
      "geography_territory", "source_attribution", "risk_blockers", "narrative_bullets",
    ];
    const data = await post(cookie, "/api/reports/compose", { reportType: "board_pack", sections: allSections });
    for (const key of ["kpiSummary", "pipelineForecast", "quoteSnapshot", "installsDeployments",
      "procurementRisks", "certificationOversight", "customerSuccess",
      "geographyTerritory", "sourceAttribution", "riskBlockers"]) {
      if (data[key] === undefined) throw new Error(`${key} missing from full report`);
    }
    if (!Array.isArray(data.narrativeBullets)) throw new Error("narrativeBullets not array");
  });
}

async function runNarrativeTests() {
  console.log("\n── Phase 5 — Narrative Bullets ─────────────────────────────────────────────");

  await check("narrative_bullets section → returns non-empty array of strings", async () => {
    const data = await post(cookie, "/api/reports/compose", { reportType: "board_pack", sections: ["kpi_summary", "source_attribution", "narrative_bullets"] });
    if (!Array.isArray(data.narrativeBullets)) throw new Error("narrativeBullets not array");
    if (data.narrativeBullets.length < 1) throw new Error("Expected at least 1 narrative bullet");
    for (const b of data.narrativeBullets) {
      if (typeof b !== "string" || b.length < 5) throw new Error(`Invalid bullet: ${b}`);
    }
  });

  await check("narrative_bullets not present when section excluded", async () => {
    const data = await post(cookie, "/api/reports/compose", { reportType: "board_pack", sections: ["kpi_summary"] });
    if (data.narrativeBullets !== undefined) throw new Error("narrativeBullets should not be present");
  });

  await check("Narrative bullets are deterministic (same data → same result)", async () => {
    const body = { reportType: "executive_weekly", sections: ["kpi_summary", "narrative_bullets"] };
    const data1 = await post(cookie, "/api/reports/compose", body);
    const data2 = await post(cookie, "/api/reports/compose", body);
    if (!data1.narrativeBullets || !data2.narrativeBullets) throw new Error("narrativeBullets missing");
    if (data1.narrativeBullets.length !== data2.narrativeBullets.length) throw new Error("Bullets differ in count between calls");
    for (let i = 0; i < data1.narrativeBullets.length; i++) {
      if (data1.narrativeBullets[i] !== data2.narrativeBullets[i]) throw new Error(`Bullet ${i} differs: "${data1.narrativeBullets[i]}" vs "${data2.narrativeBullets[i]}"`);
    }
  });
}

async function runPresetTests() {
  console.log("\n── Phase 6 — Saved Report Configs ──────────────────────────────────────────");

  await check("GET /api/reports/presets → 200 with array", async () => {
    const res = await authedFetch(cookie, "/api/reports/presets");
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("Expected array");
  });

  await check("POST /api/reports/presets → creates preset with correct shape", async () => {
    const preset = await createPreset({
      name: "TEST_PRESET_WEEKLY",
      reportType: "executive_weekly",
      dateRangePreset: "this_week",
      includedSections: ["kpi_summary", "risk_blockers"],
      description: "Test weekly exec preset",
    });
    if (!preset.id) throw new Error("id missing");
    if (preset.name !== "TEST_PRESET_WEEKLY") throw new Error(`name mismatch: ${preset.name}`);
    if (preset.reportType !== "executive_weekly") throw new Error(`reportType mismatch: ${preset.reportType}`);
    if (!Array.isArray(preset.includedSections)) throw new Error("includedSections not array");
    if (preset.includedSections.length !== 2) throw new Error(`Expected 2 sections, got ${preset.includedSections.length}`);
  });

  await check("POST /api/reports/presets without name → 400", async () => {
    const res = await authedFetch(cookie, "/api/reports/presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportType: "board_pack" }),
    });
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
  });

  await check("GET /api/reports/presets/:id → returns single preset", async () => {
    const preset = await createPreset({ name: "TEST_GET_PRESET", reportType: "board_pack", dateRangePreset: "this_month", includedSections: [] });
    const fetched = await json(cookie, `/api/reports/presets/${preset.id}`);
    if (fetched.id !== preset.id) throw new Error(`ID mismatch: ${fetched.id}`);
    if (fetched.name !== "TEST_GET_PRESET") throw new Error(`name mismatch: ${fetched.name}`);
  });

  await check("GET /api/reports/presets/99999 → 404", async () => {
    const res = await authedFetch(cookie, "/api/reports/presets/99999");
    if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
  });

  await check("PUT /api/reports/presets/:id → updates preset", async () => {
    const preset = await createPreset({ name: "TEST_UPDATE_PRESET", reportType: "executive_weekly", dateRangePreset: "this_month", includedSections: ["kpi_summary"] });
    const updated = await json(cookie, `/api/reports/presets/${preset.id}`, {
      method: "PUT",
      body: JSON.stringify({ name: "TEST_UPDATE_PRESET_RENAMED", dateRangePreset: "this_quarter" }),
    });
    if (updated.name !== "TEST_UPDATE_PRESET_RENAMED") throw new Error(`Expected renamed name, got ${updated.name}`);
    if (updated.dateRangePreset !== "this_quarter") throw new Error(`Expected this_quarter, got ${updated.dateRangePreset}`);
  });

  await check("DELETE /api/reports/presets/:id → deletes preset", async () => {
    const preset = await createPreset({ name: "TEST_DELETE_PRESET", reportType: "board_pack", dateRangePreset: "last_quarter", includedSections: [] });
    const delRes = await authedFetch(cookie, `/api/reports/presets/${preset.id}`, { method: "DELETE" });
    if (delRes.status !== 200) throw new Error(`Expected 200, got ${delRes.status}`);
    const again = await authedFetch(cookie, `/api/reports/presets/${preset.id}`);
    if (again.status !== 404) throw new Error("Expected 404 after deletion");
    const idx = createdPresetIds.indexOf(preset.id);
    if (idx !== -1) createdPresetIds.splice(idx, 1);
  });

  await check("Presets appear in list after creation", async () => {
    const preset = await createPreset({ name: "TEST_LIST_PRESET", reportType: "ops_review", dateRangePreset: "last_month", includedSections: ["installs_deployments"] });
    const list = await json(cookie, "/api/reports/presets");
    const found = list.find(p => p.id === preset.id);
    if (!found) throw new Error("Preset not found in list");
  });

  await check("Presets — unauthenticated → 401", async () => {
    const res = await fetch(`${BASE}/api/reports/presets`);
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
  });
}

async function runExportShapeTests() {
  console.log("\n── Phase 3 — Export Route Shape ────────────────────────────────────────────");

  await check("POST /compose returns valid JSON with meta.generatedAt as ISO string", async () => {
    const data = await post(cookie, "/api/reports/compose", { reportType: "fundraising_snapshot" });
    if (!data.meta?.generatedAt) throw new Error("meta.generatedAt missing");
    const d = new Date(data.meta.generatedAt);
    if (isNaN(d.getTime())) throw new Error(`generatedAt is not a valid date: ${data.meta.generatedAt}`);
  });

  await check("POST /compose unauthenticated → 401", async () => {
    const res = await fetch(`${BASE}/api/reports/compose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportType: "executive_weekly" }),
    });
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
  });

  await check("POST /compose — all 5 report types succeed", async () => {
    for (const rt of ["executive_weekly", "monthly_leadership", "board_pack", "fundraising_snapshot", "ops_review"]) {
      const data = await post(cookie, "/api/reports/compose", { reportType: rt, sections: ["kpi_summary"] });
      if (!data.meta) throw new Error(`${rt}: meta missing`);
      if (data.meta.reportType !== rt) throw new Error(`${rt}: reportType mismatch in meta`);
    }
  });

  await check("POST /compose — empty sections list → all sections included", async () => {
    const data = await post(cookie, "/api/reports/compose", { reportType: "board_pack", sections: [] });
    if (!data.meta) throw new Error("meta missing");
    if (!data.kpiSummary) throw new Error("kpiSummary missing with empty sections");
  });
}

async function runRegressionTests() {
  console.log("\n── Regression — No regression to existing systems ──────────────────────────");

  await check("GET /api/executive/kpis → still works", async () => {
    const res = await authedFetch(cookie, "/api/executive/kpis");
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const data = await res.json();
    if (!data.pipeline) throw new Error("pipeline missing from exec KPIs");
  });

  await check("GET /api/pipeline/forecast → still works", async () => {
    const res = await authedFetch(cookie, "/api/pipeline/forecast");
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.periods)) throw new Error("periods not array");
  });

  await check("GET /api/analytics/source-attribution/summary → still works", async () => {
    const res = await authedFetch(cookie, "/api/analytics/source-attribution/summary");
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  });

  await check("GET /api/automations → still works", async () => {
    const res = await authedFetch(cookie, "/api/automations");
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("Expected array");
  });

  await check("GET /api/accounts → still works", async () => {
    const res = await authedFetch(cookie, "/api/accounts?limit=1");
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  });

  await check("GET /api/documents → still works", async () => {
    const res = await authedFetch(cookie, "/api/documents");
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  });

  await check("GET /api/cs/dashboard → still works", async () => {
    const res = await authedFetch(cookie, "/api/cs/dashboard");
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  });

  await check("GET /api/projects/cert-summary → still works", async () => {
    const res = await authedFetch(cookie, "/api/projects/cert-summary");
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log("\n📄 Executive PDF / Board Pack Export Tests\n");
try {
  cookie = await loginAs("trevor@voltsafe.com", "alberni1444");
  if (!cookie) throw new Error("Login failed");

  await runMetadataTests();
  await runComposeTests();
  await runFilterTests();
  await runNarrativeTests();
  await runPresetTests();
  await runExportShapeTests();
  await runRegressionTests();
} finally {
  await cleanup();
}

console.log("\n── Summary ──────────────────────────────────────────────────────────────────");
console.log(`  Total: ${passed + failed} | ✅ ${passed} passed | ❌ ${failed} failed`);
if (failed > 0) process.exit(1);
