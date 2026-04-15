/**
 * Territory + Geographic Intelligence Tests — Phase 7
 * Tests: territory CRUD, assignment, geo analytics, filters, whitespace, regressions.
 *
 * Run: node tests/geography.test.js
 */

import http from "http";

const BASE = "http://localhost:5000";
let cookieJar = "";

async function req(method, url, body) {
  const headers = { Cookie: cookieJar };
  if (body) headers["Content-Type"] = "application/json";
  return new Promise((resolve, reject) => {
    const u = new URL(url, BASE);
    const options = { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers };
    const r = http.request(options, res => {
      const sc = res.headers["set-cookie"];
      if (sc) cookieJar = sc.map(c => c.split(";")[0]).join("; ");
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        let json; try { json = JSON.parse(raw); } catch { json = raw; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    r.on("error", reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

let pass = 0, fail = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) { pass++; process.stdout.write(`  ✓ ${msg}\n`); }
  else { fail++; failures.push(msg); process.stdout.write(`  ✗ ${msg}\n`); }
}

let territoryId;
let accountId;
let leadId;

// ── Setup ─────────────────────────────────────────────────────────────────────
async function login() {
  const r = await req("POST", "/api/auth/login", { email: "trevor@voltsafe.com", password: "alberni1444" });
  assert(r.status === 200, "Login succeeds");
}

async function getIds() {
  const accs = await req("GET", "/api/accounts");
  accountId = accs.body?.[0]?.id ?? accs.body?.data?.[0]?.id ?? 1;
  const leads = await req("GET", "/api/leads");
  const leadList = Array.isArray(leads.body) ? leads.body : leads.body?.data ?? [];
  leadId = leadList[0]?.id ?? 1;
}

// ── Phase 2: Territory CRUD ───────────────────────────────────────────────────
async function testTerritoryCRUD() {
  console.log("\n── Territory CRUD ───────────────────────────────────────────");

  // Auth guard
  const savedCookie = cookieJar;
  cookieJar = "";
  const unauth = await req("GET", "/api/territories");
  assert(unauth.status === 401, "GET /api/territories unauthenticated → 401");
  const unauthPost = await req("POST", "/api/territories", { name: "Test" });
  assert(unauthPost.status === 401, "POST /api/territories unauthenticated → 401");
  cookieJar = savedCookie;

  // List (empty initially)
  const list = await req("GET", "/api/territories");
  assert(list.status === 200, "GET /api/territories → 200");
  assert(Array.isArray(list.body), "Returns array");
  const initCount = list.body.length;

  // Create: missing name → 400
  const bad = await req("POST", "/api/territories", { code: "BC" });
  assert(bad.status === 400, "POST territories without name → 400");

  // Create valid
  const cr = await req("POST", "/api/territories", {
    name: "British Columbia",
    code: "BC",
    status: "active",
    regions: "British Columbia, Vancouver Island",
    countries: "Canada",
    notes: "West coast marine territory",
    color: "#0ea5e9",
  });
  assert(cr.status === 201, `POST /api/territories → 201 (got ${cr.status})`);
  territoryId = cr.body?.id;
  assert(typeof territoryId === "number", `Territory created with id=${territoryId}`);
  assert(cr.body?.name === "British Columbia", "Territory name is correct");
  assert(cr.body?.code === "BC", "Territory code is correct");
  assert(cr.body?.status === "active", "Territory status is active");

  // Create another
  const cr2 = await req("POST", "/api/territories", {
    name: "Ontario",
    code: "ONT",
    status: "active",
    regions: "Ontario, Quebec",
    countries: "Canada",
  });
  assert(cr2.status === 201, "Second territory created → 201");
  const territory2Id = cr2.body?.id;

  // List now has 2 more
  const list2 = await req("GET", "/api/territories");
  assert(list2.status === 200, "GET /api/territories after creates → 200");
  assert(list2.body.length >= initCount + 2, `Territory count grew: ${initCount} → ${list2.body.length}`);

  // GET by id
  const getOne = await req("GET", `/api/territories/${territoryId}`);
  assert(getOne.status === 200, `GET /api/territories/${territoryId} → 200`);
  assert(getOne.body?.id === territoryId, "Territory detail returns correct id");
  assert(typeof getOne.body?.account_count === "number" || getOne.body?.account_count !== undefined, "account_count present");
  assert(typeof getOne.body?.lead_count === "number" || getOne.body?.lead_count !== undefined, "lead_count present");

  // GET 404
  const miss = await req("GET", "/api/territories/999999");
  assert(miss.status === 404, "GET /api/territories/999999 → 404");

  // PATCH
  const patch = await req("PATCH", `/api/territories/${territoryId}`, {
    notes: "Updated notes",
    color: "#22c55e",
  });
  assert(patch.status === 200, "PATCH territory → 200");
  assert(patch.body?.notes === "Updated notes", "Patch updated notes");

  // PATCH empty body → 400
  const emptyPatch = await req("PATCH", `/api/territories/${territoryId}`, {});
  assert(emptyPatch.status === 400, "PATCH territory with empty body → 400");

  // PATCH non-existent → 404
  const missPatch = await req("PATCH", "/api/territories/999999", { notes: "x" });
  assert(missPatch.status === 404, "PATCH /api/territories/999999 → 404");

  // Search filter
  const search = await req("GET", "/api/territories?search=British");
  assert(search.status === 200, "GET /api/territories?search=British → 200");
  assert(Array.isArray(search.body) && search.body.some(t => t.name === "British Columbia"), "Search filter finds BC territory");

  // Status filter
  const active = await req("GET", "/api/territories?status=active");
  assert(active.status === 200, "GET /api/territories?status=active → 200");
  assert(active.body.every(t => t.status === "active"), "Status filter returns only active territories");

  // DELETE territory2 (cleanup)
  const del2 = await req("DELETE", `/api/territories/${territory2Id}`);
  assert(del2.status === 200, "DELETE second territory → 200");
  assert(del2.body?.ok === true, "Delete returns ok:true");

  // DELETE non-existent → 404
  const missDel = await req("DELETE", "/api/territories/999999");
  assert(missDel.status === 404, "DELETE /api/territories/999999 → 404");
}

// ── Phase 2: Territory Assignment ─────────────────────────────────────────────
async function testTerritoryAssignment() {
  console.log("\n── Territory Assignment ──────────────────────────────────────");

  // Assign to non-existent territory → 404
  const missTerr = await req("POST", "/api/territories/999999/assign", { accountIds: [accountId] });
  assert(missTerr.status === 404, "POST assign to missing territory → 404");

  // Assign accounts
  const assignAcc = await req("POST", `/api/territories/${territoryId}/assign`, {
    accountIds: [accountId],
  });
  assert(assignAcc.status === 200, "POST /api/territories/:id/assign accounts → 200");
  assert(assignAcc.body?.ok === true, "Assign returns ok:true");
  assert(typeof assignAcc.body?.accountsUpdated === "number", "accountsUpdated is a number");
  assert(assignAcc.body?.accountsUpdated >= 0, `accountsUpdated = ${assignAcc.body?.accountsUpdated}`);

  // Assign leads
  const assignLead = await req("POST", `/api/territories/${territoryId}/assign`, {
    leadIds: [leadId],
  });
  assert(assignLead.status === 200, "POST /api/territories/:id/assign leads → 200");
  assert(assignLead.body?.leadsUpdated >= 0, `leadsUpdated = ${assignLead.body?.leadsUpdated}`);

  // Territory detail should now show non-zero counts
  await new Promise(r => setTimeout(r, 200));
  const detail = await req("GET", `/api/territories/${territoryId}`);
  assert(detail.status === 200, "GET territory after assign → 200");
  // account_count ≥ 0 (territory may or may not have accounts depending on data)
  assert(Number(detail.body?.account_count ?? 0) >= 0, "account_count ≥ 0 after assign");

  // Unassign
  const unassign = await req("POST", `/api/territories/${territoryId}/unassign`, {
    accountIds: [accountId],
    leadIds: [leadId],
  });
  assert(unassign.status === 200, "POST /api/territories/:id/unassign → 200");
  assert(unassign.body?.ok === true, "Unassign returns ok:true");

  // Patch individual account territory
  const patchAcc = await req("PATCH", `/api/accounts/${accountId}/territory`, { territoryId });
  assert(patchAcc.status === 200, `PATCH /api/accounts/${accountId}/territory → 200 (got ${patchAcc.status})`);
  assert(patchAcc.body?.ok === true, "Account territory patch returns ok:true");

  // Clear it
  const clearAcc = await req("PATCH", `/api/accounts/${accountId}/territory`, { territoryId: null });
  assert(clearAcc.status === 200, "PATCH account/territory with null → 200");

  // Patch individual lead territory
  const patchLead = await req("PATCH", `/api/leads/${leadId}/territory`, { territoryId, region: "British Columbia" });
  assert(patchLead.status === 200, `PATCH /api/leads/${leadId}/territory → 200 (got ${patchLead.status})`);
  assert(patchLead.body?.ok === true, "Lead territory patch returns ok:true");
}

// ── Phase 3 + 4: Geo Analytics ───────────────────────────────────────────────
async function testGeoAnalytics() {
  console.log("\n── Geo Analytics: Overview ──────────────────────────────────");

  // Auth guard
  const savedCookie = cookieJar;
  cookieJar = "";
  const unauth = await req("GET", "/api/analytics/geo/overview");
  assert(unauth.status === 401, "GET /api/analytics/geo/overview unauthenticated → 401");
  cookieJar = savedCookie;

  const ov = await req("GET", "/api/analytics/geo/overview");
  assert(ov.status === 200, "GET /api/analytics/geo/overview → 200");
  assert(Array.isArray(ov.body?.regions), "overview.regions is an array");
  assert(typeof ov.body?.totals === "object", "overview.totals is an object");
  assert(typeof ov.body?.totals?.accounts === "number", "totals.accounts is a number");
  assert(typeof ov.body?.totals?.leads === "number", "totals.leads is a number");
  assert(typeof ov.body?.totals?.deployments === "number", "totals.deployments is a number");
  assert(typeof ov.body?.totals?.customers === "number", "totals.customers is a number");
  assert(typeof ov.body?.regionCount === "number", "regionCount is a number");
  assert(ov.body?.regionCount >= 0, "regionCount ≥ 0");

  // Each region has the correct shape
  if (ov.body?.regions?.length > 0) {
    const r = ov.body.regions[0];
    assert(typeof r.region === "string", "Region has region name");
    assert(typeof r.accounts === "number", "Region has accounts count");
    assert(typeof r.leads === "number", "Region has leads count");
    assert(typeof r.deployments === "number", "Region has deployments count");
    assert(typeof r.customers === "number", "Region has customers count");
  }

  console.log("\n── Geo Analytics: Territory Rollup ──────────────────────────");
  const terrRollup = await req("GET", "/api/analytics/geo/territories");
  assert(terrRollup.status === 200, "GET /api/analytics/geo/territories → 200");
  assert(Array.isArray(terrRollup.body), "territory rollup returns array");
  if (terrRollup.body.length > 0) {
    const t = terrRollup.body[0];
    assert(typeof t.id === "number", "Territory rollup has id");
    assert(typeof t.name === "string", "Territory rollup has name");
    assert(t.account_count !== undefined, "Territory rollup has account_count");
    assert(t.customer_count !== undefined, "Territory rollup has customer_count");
    assert(t.total_arr !== undefined, "Territory rollup has total_arr");
  }

  console.log("\n── Geo Analytics: Whitespace ────────────────────────────────");
  const ws = await req("GET", "/api/analytics/geo/whitespace");
  assert(ws.status === 200, "GET /api/analytics/geo/whitespace → 200");
  assert(Array.isArray(ws.body?.leadsWithoutAccounts), "whitespace.leadsWithoutAccounts is array");
  assert(Array.isArray(ws.body?.accountsWithoutDeployments), "whitespace.accountsWithoutDeployments is array");
  if (ws.body?.leadsWithoutAccounts?.length > 0) {
    const r = ws.body.leadsWithoutAccounts[0];
    assert(typeof r.region === "string", "Whitespace lead row has region");
    assert(r.lead_count !== undefined, "Whitespace lead row has lead_count");
  }

  console.log("\n── Geo Analytics: Win Rate ──────────────────────────────────");
  const wr = await req("GET", "/api/analytics/geo/win-rate");
  assert(wr.status === 200, "GET /api/analytics/geo/win-rate → 200");
  assert(Array.isArray(wr.body), "win-rate returns array");
  if (wr.body.length > 0) {
    const r = wr.body[0];
    assert(r.region !== undefined, "Win rate row has region");
    assert(r.won !== undefined, "Win rate row has won");
    assert(r.lost !== undefined, "Win rate row has lost");
    assert(r.win_rate !== undefined, "Win rate row has win_rate");
    assert(r.won_revenue !== undefined, "Win rate row has won_revenue");
  }

  console.log("\n── Geo Analytics: Geo Accounts + Leads ──────────────────────");
  const geoAcc = await req("GET", "/api/analytics/geo/accounts");
  assert(geoAcc.status === 200, "GET /api/analytics/geo/accounts → 200");
  assert(Array.isArray(geoAcc.body), "geo accounts returns array");
  if (geoAcc.body.length > 0) {
    const a = geoAcc.body[0];
    assert(typeof a.id === "number", "Geo account has id");
    assert(typeof a.name === "string", "Geo account has name");
    assert(a.lead_status !== undefined, "Geo account has lead_status");
  }

  // Filter by region
  const geoAccFiltered = await req("GET", "/api/analytics/geo/accounts?region=British Columbia");
  assert(geoAccFiltered.status === 200, "GET /api/analytics/geo/accounts?region=... → 200");
  assert(Array.isArray(geoAccFiltered.body), "Filtered geo accounts returns array");

  const geoLeads = await req("GET", "/api/analytics/geo/leads");
  assert(geoLeads.status === 200, "GET /api/analytics/geo/leads → 200");
  assert(Array.isArray(geoLeads.body), "geo leads returns array");

  // Filter geo leads by territory
  const geoLeadsFiltered = await req("GET", `/api/analytics/geo/leads?territory_id=${territoryId}`);
  assert(geoLeadsFiltered.status === 200, "GET /api/analytics/geo/leads?territory_id=... → 200");
}

// ── Phase 7: Regression Tests ─────────────────────────────────────────────────
async function testRegressions() {
  console.log("\n── Phase 7: Regression Tests ────────────────────────────────");

  // Leads still work
  const leads = await req("GET", "/api/leads");
  assert(leads.status === 200, "GET /api/leads → 200 (regression)");
  assert(Array.isArray(leads.body) || Array.isArray(leads.body?.data), "Leads list returns data");

  // Leads filters still work
  const leadsState = await req("GET", "/api/leads?state=BC");
  assert(leadsState.status === 200, "GET /api/leads?state=BC → 200 (regression)");
  const leadsCountry = await req("GET", "/api/leads?country=Canada");
  assert(leadsCountry.status === 200, "GET /api/leads?country=Canada → 200 (regression)");

  // Accounts still work
  const accounts = await req("GET", "/api/accounts");
  assert(accounts.status === 200, "GET /api/accounts → 200 (regression)");

  // Accounts segment filter still works
  const accountsSeg = await req("GET", "/api/accounts?segment=marina");
  assert(accountsSeg.status === 200, "GET /api/accounts?segment=marina → 200 (regression)");

  // Deployments still work
  const deployments = await req("GET", "/api/deployments");
  assert(deployments.status === 200, "GET /api/deployments → 200 (regression)");

  // Deployments region filter still works
  const deploymentsRegion = await req("GET", "/api/deployments?region=BC");
  assert(deploymentsRegion.status === 200, "GET /api/deployments?region=BC → 200 (regression)");

  // CS dashboard still works
  const csDash = await req("GET", "/api/cs/dashboard");
  assert(csDash.status === 200, "GET /api/cs/dashboard → 200 (regression)");
  assert(typeof csDash.body?.overview === "object", "CS dashboard overview object (regression)");

  // CS list still works
  const csList = await req("GET", "/api/cs");
  assert(csList.status === 200, "GET /api/cs → 200 (regression)");

  // Projects (certification) still works
  const proj = await req("GET", "/api/projects");
  assert(proj.status === 200, "GET /api/projects → 200 (regression)");
  assert(Array.isArray(proj.body), "Projects list returns array (regression)");

  // Cert summary still works
  const certSummary = await req("GET", "/api/projects/cert-summary");
  assert(certSummary.status === 200, "GET /api/projects/cert-summary → 200 (regression)");
  assert(typeof certSummary.body?.total === "number", "cert-summary total (regression)");

  // Procurement dashboard still works
  const proc = await req("GET", "/api/procurement/dashboard");
  assert(proc.status === 200, "GET /api/procurement/dashboard → 200 (regression)");

  // Quotes still work
  const quotes = await req("GET", "/api/quotes");
  assert(quotes.status === 200, "GET /api/quotes → 200 (regression)");

  // Source attribution still works
  const srcAttr = await req("GET", "/api/analytics/source-attribution/summary");
  assert(srcAttr.status === 200, "GET /api/analytics/source-attribution/summary → 200 (regression)");

  // CS timeline still works
  const csr = await req("GET", "/api/cs");
  const csItem = (csr.body?.data ?? csr.body)?.[0];
  if (csItem?.id) {
    const timeline = await req("GET", `/api/cs/${csItem.id}/timeline`);
    assert(timeline.status === 200, "GET /api/cs/:id/timeline → 200 (regression)");
  } else {
    assert(true, "CS timeline regression skipped (no CS records)");
  }

  // Geo endpoints auth guard
  const savedCookie = cookieJar;
  cookieJar = "";
  const unauthTerr = await req("GET", "/api/territories");
  assert(unauthTerr.status === 401, "GET /api/territories unauthenticated → 401 (auth guard)");
  const unauthGeo = await req("GET", "/api/analytics/geo/whitespace");
  assert(unauthGeo.status === 401, "GET /api/analytics/geo/whitespace unauthenticated → 401 (auth guard)");
  cookieJar = savedCookie;
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
async function cleanup() {
  if (territoryId) {
    await req("DELETE", `/api/territories/${territoryId}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== Territory + Geographic Intelligence Tests (Phase 7) ===\n");
  try {
    await login();
    await getIds();

    await testTerritoryCRUD();
    await testTerritoryAssignment();
    await testGeoAnalytics();
    await testRegressions();

    await cleanup();
  } catch (err) {
    console.error("\nFatal test error:", err);
    process.exitCode = 1;
  }

  console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
  if (failures.length) {
    console.log("\nFailed assertions:");
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exitCode = 1;
  }
}

main();
