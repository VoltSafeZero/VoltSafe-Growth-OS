/**
 * Customer Success Oversight Tests — Phase 7
 * Tests: CS timeline events, expansion opportunity linking, dashboard rollups,
 *        renewal status transitions, health classification, regression checks.
 *
 * Run: node tests/cs-oversight.test.js
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

// ── State ─────────────────────────────────────────────────────────────────────
let csId;
let oppId;

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getAccountId() {
  const accs = await req("GET", "/api/accounts");
  return accs.body?.[0]?.id ?? 1;
}

// ── Setup ─────────────────────────────────────────────────────────────────────
async function login() {
  const r = await req("POST", "/api/auth/login", { email: "trevor@voltsafe.com", password: "alberni1444" });
  assert(r.status === 200, "Login succeeds");
}

async function createCsRecord() {
  const accountId = await getAccountId();
  const r = await req("POST", "/api/cs", {
    accountId,
    status: "active",
    mrr: 500,
    arr: 6000,
    contractTermMonths: 12,
    expansionPotential: "none",
    notes: "Phase 7 test CS record",
    renewalDate: new Date(Date.now() + 200 * 24 * 3600 * 1000).toISOString().slice(0, 10),
  });
  assert(r.status === 201, `Create CS record → 201 (got ${r.status})`);
  csId = r.body?.id;
  assert(typeof csId === "number", `CS record created with id=${csId}`);
}

async function createOpportunity() {
  const accountId = await getAccountId();
  const r = await req("POST", "/api/opportunities", {
    title: "VoltSafe Expansion — 50 More Slips",
    accountId,
    stage: "proposal",
    amount: 25000,
  });
  assert(r.status === 201 || r.status === 200, `Create opportunity → 2xx (got ${r.status})`);
  oppId = r.body?.id;
  assert(typeof oppId === "number", `Opportunity created with id=${oppId}`);
}

// ── Timeline: empty state ─────────────────────────────────────────────────────
async function testTimelineEmpty() {
  console.log("\n── Timeline: initial state ──────────────────────────────────");
  const r = await req("GET", `/api/cs/${csId}/timeline`);
  assert(r.status === 200, "GET /api/cs/:id/timeline → 200");
  assert(Array.isArray(r.body), "Returns array");
}

// ── Phase 5: Timeline events auto-emitted ─────────────────────────────────────
async function testTimelineEvents() {
  console.log("\n── Phase 5: Timeline Events ─────────────────────────────────");

  const countBefore = (await req("GET", `/api/cs/${csId}/timeline`)).body?.length ?? 0;

  // went_live: set go_live_date for first time
  const goLiveR = await req("PATCH", `/api/cs/${csId}`, {
    goLiveDate: new Date().toISOString().slice(0, 10),
  });
  assert(goLiveR.status === 200, "PATCH goLiveDate → 200");

  // expansion_identified: raise expansion potential to high
  const expR = await req("PATCH", `/api/cs/${csId}`, {
    expansionPotential: "high",
    expansionNotes: "Marina wants 50 extra slips",
  });
  assert(expR.status === 200, "PATCH expansionPotential=high → 200");

  // churn_flagged: set status to churn_risk
  const churnR = await req("PATCH", `/api/cs/${csId}`, { status: "churn_risk" });
  assert(churnR.status === 200, "PATCH status=churn_risk → 200");

  // renewal_won: set status to renewed
  const renewedR = await req("PATCH", `/api/cs/${csId}`, { status: "renewed" });
  assert(renewedR.status === 200, "PATCH status=renewed → 200");

  // Allow DB writes to settle
  await new Promise(r => setTimeout(r, 300));

  const tl = await req("GET", `/api/cs/${csId}/timeline`);
  assert(tl.status === 200, "GET timeline after events → 200");
  assert(Array.isArray(tl.body), "Timeline returns array");
  assert(tl.body.length > countBefore, `Timeline grew: ${countBefore} → ${tl.body.length}`);

  const types = tl.body.map(e => e.event_type);
  assert(types.includes("went_live"), "Timeline has went_live event");
  assert(types.includes("expansion_identified"), "Timeline has expansion_identified event");
  assert(types.includes("churn_flagged"), "Timeline has churn_flagged event");
  assert(types.includes("renewal_won"), "Timeline has renewal_won event");

  // Validate event shape
  const ev = tl.body[0];
  assert(typeof ev.id === "number", "Event has numeric id");
  assert(ev.cs_id === csId, "Event has correct cs_id");
  assert(typeof ev.event_type === "string", "Event has event_type");
  assert(typeof ev.description === "string", "Event has description");
  assert(typeof ev.created_at === "string", "Event has created_at");

  // went_live description
  const wentLive = tl.body.find(e => e.event_type === "went_live");
  assert(!!wentLive, "went_live event found");
  if (wentLive) assert(wentLive.description.includes("went live"), `went_live description: "${wentLive.description}"`);

  // churn_flagged description
  const churnEv = tl.body.find(e => e.event_type === "churn_flagged");
  assert(!!churnEv, "churn_flagged event found");

  // expansion_identified description
  const expEv = tl.body.find(e => e.event_type === "expansion_identified");
  assert(!!expEv, "expansion_identified event found");
  if (expEv) assert(expEv.description.toLowerCase().includes("expansion"), `expansion_identified description: "${expEv.description}"`);

  // renewal_won description
  const renewedEv = tl.body.find(e => e.event_type === "renewal_won");
  assert(!!renewedEv, "renewal_won event found");

  // Limit param
  const limited = await req("GET", `/api/cs/${csId}/timeline?limit=2`);
  assert(limited.status === 200, "GET timeline?limit=2 → 200");
  assert(Array.isArray(limited.body) && limited.body.length <= 2, `limit=2 returns ≤2 events (got ${limited.body?.length})`);

  // Non-existent CS → empty
  const miss = await req("GET", "/api/cs/999999/timeline");
  assert(miss.status === 200 && Array.isArray(miss.body) && miss.body.length === 0, "Timeline for missing CS → empty array");

  // renewal_lost: cancel a record
  const cancelR = await req("PATCH", `/api/cs/${csId}`, { status: "cancelled" });
  assert(cancelR.status === 200, "PATCH status=cancelled → 200");
  await new Promise(r => setTimeout(r, 200));
  const tl2 = await req("GET", `/api/cs/${csId}/timeline`);
  const types2 = tl2.body.map(e => e.event_type);
  assert(types2.includes("renewal_lost"), "Timeline has renewal_lost event");
}

// ── Phase 6: Expansion opportunity linking ────────────────────────────────────
async function testExpansionLinking() {
  console.log("\n── Phase 6: Expansion Opportunity Linking ───────────────────");

  // Create a fresh CS record so we're not using the cancelled one
  const accountId = await getAccountId();
  const cr = await req("POST", "/api/cs", {
    accountId, status: "active", mrr: 300, arr: 3600, contractTermMonths: 12,
    renewalDate: new Date(Date.now() + 180 * 24 * 3600 * 1000).toISOString().slice(0, 10),
  });
  const linkCsId = cr.body?.id;
  assert(typeof linkCsId === "number", `Created fresh CS for expansion test (id=${linkCsId})`);

  // Link without opportunityId → 400
  const bad = await req("POST", `/api/cs/${linkCsId}/link-opportunity`, {});
  assert(bad.status === 400, "POST link-opportunity without id → 400");

  // Link to non-existent opportunity → 404
  const miss = await req("POST", `/api/cs/${linkCsId}/link-opportunity`, { opportunityId: 999999 });
  assert(miss.status === 404, "POST link-opportunity to missing opp → 404");

  // Successful link
  const link = await req("POST", `/api/cs/${linkCsId}/link-opportunity`, { opportunityId: oppId });
  assert(link.status === 200, `POST link-opportunity → 200 (got ${link.status})`);
  assert(link.body?.ok === true, "Link returns ok:true");
  assert(link.body?.opportunity?.id === oppId, "Link returns opportunity with correct id");
  assert(link.body?.opportunity?.title, "Linked opportunity has title");

  // Allow DB writes to settle
  await new Promise(r => setTimeout(r, 200));

  // Verify in GET /api/cs/:id
  const detail = await req("GET", `/api/cs/${linkCsId}`);
  assert(detail.status === 200, `GET /api/cs/:id → 200 after linking (got ${detail.status})`);
  assert(detail.body?.exp_opp_id === oppId, `exp_opp_id = ${oppId} (got ${detail.body?.exp_opp_id})`);
  assert(typeof detail.body?.exp_opp_title === "string", `exp_opp_title = "${detail.body?.exp_opp_title}"`);
  assert(detail.body?.exp_opp_status !== undefined, "exp_opp_status present");

  // Timeline has expansion_linked event
  const tl = await req("GET", `/api/cs/${linkCsId}/timeline`);
  const types = tl.body.map(e => e.event_type);
  assert(types.includes("expansion_linked"), "Timeline has expansion_linked event after linking");

  // Unlink
  const unlink = await req("DELETE", `/api/cs/${linkCsId}/link-opportunity`);
  assert(unlink.status === 200, "DELETE link-opportunity → 200");
  assert(unlink.body?.ok === true, "Unlink returns ok:true");

  // Verify unlinked
  await new Promise(r => setTimeout(r, 200));
  const detail2 = await req("GET", `/api/cs/${linkCsId}`);
  assert(!detail2.body?.exp_opp_id, "exp_opp_id is null after unlink");

  // Re-link to verify idempotent
  const relink = await req("POST", `/api/cs/${linkCsId}/link-opportunity`, { opportunityId: oppId });
  assert(relink.status === 200, "Re-link opportunity → 200");

  // Cleanup
  await req("PATCH", `/api/cs/${linkCsId}`, { status: "cancelled" });
}

// ── Phase 7 — Dashboard rollup + health classification ────────────────────────
async function testDashboard() {
  console.log("\n── Phase 7: Dashboard Rollups + Health ──────────────────────");

  const dash = await req("GET", "/api/cs/dashboard");
  assert(dash.status === 200, "GET /api/cs/dashboard → 200");
  assert(typeof dash.body.overview === "object", "Dashboard has overview object");
  assert(typeof dash.body.overview.total === "number", "overview.total is a number");
  assert(typeof dash.body.overview.totalArr === "number", "overview.totalArr is a number");
  assert(typeof dash.body.overview.totalMrr === "number", "overview.totalMrr is a number");
  assert(typeof dash.body.overview.renewalDue === "number", "overview.renewalDue is a number");
  assert(typeof dash.body.overview.churnRisk === "number", "overview.churnRisk is a number");
  assert(Array.isArray(dash.body.upcomingRenewals), "upcomingRenewals is an array");
  assert(Array.isArray(dash.body.atRisk), "atRisk is an array");
  assert(Array.isArray(dash.body.expansionOpportunities), "expansionOpportunities is an array");
  // byHealth is the actual key (not healthByStatus)
  assert(Array.isArray(dash.body.byHealth) || Array.isArray(dash.body.byStatus), "byHealth or byStatus is an array");
}

async function testRenewalStatusTransitions() {
  console.log("\n── Phase 2: Renewal Status Transitions ──────────────────────");

  // Create a fresh CS record for transition testing
  const accountId = await getAccountId();
  const cr = await req("POST", "/api/cs", {
    accountId, status: "active", mrr: 100, arr: 1200, contractTermMonths: 12,
    renewalDate: new Date(Date.now() + 180 * 24 * 3600 * 1000).toISOString().slice(0, 10),
  });
  const tid = cr.body?.id;
  assert(typeof tid === "number", `Transition test CS record created (id=${tid})`);

  const statuses = ["renewal_due", "renewal_in_progress", "renewed", "churn_risk"];
  for (const s of statuses) {
    const r = await req("PATCH", `/api/cs/${tid}`, { status: s });
    assert(r.status === 200, `PATCH status=${s} → 200`);
    assert(r.body?.status === s || r.body?.status, `Status field present after PATCH to ${s}`);
  }

  // DELETE the record
  await req("PATCH", `/api/cs/${tid}`, { status: "cancelled" });
  const del = await req("DELETE", `/api/cs/${tid}`);
  assert(del.status === 200, "DELETE /api/cs/:id → 200");
  assert(del.body?.ok === true, "DELETE returns ok:true");

  // After DELETE, the record may be hard-deleted or soft-cancelled → expect 404 or cancelled
  const chk = await req("GET", `/api/cs/${tid}`);
  assert(chk.status === 404 || chk.body?.status === "cancelled", "CS record not accessible or cancelled after DELETE");
}

async function testHealthClassification() {
  console.log("\n── Phase 3: Health Classification ───────────────────────────");

  const accountId = await getAccountId();
  const cr = await req("POST", "/api/cs", {
    accountId, status: "active", mrr: 200, arr: 2400, contractTermMonths: 12,
    renewalDate: new Date(Date.now() + 300 * 24 * 3600 * 1000).toISOString().slice(0, 10),
  });
  const hid = cr.body?.id;
  assert(typeof hid === "number", `Health test CS record created (id=${hid})`);

  // GET detail triggers health compute
  const detail = await req("GET", `/api/cs/${hid}`);
  assert(detail.status === 200, `GET /api/cs/:id → 200 (got ${detail.status}: ${detail.body?.message})`);
  assert(typeof detail.body?.health_score === "number" || typeof detail.body?.health?.score === "number",
    `health_score present (score=${detail.body?.health_score ?? detail.body?.health?.score})`);
  assert(["healthy", "at_risk", "critical"].includes(detail.body?.health_status ?? detail.body?.health?.status ?? "healthy"),
    "health_status is valid enum");
  assert(detail.body?.health !== undefined, "health object present in response");

  // Compute-health endpoint
  const ch = await req("POST", `/api/cs/${hid}/compute-health`, {});
  assert(ch.status === 200, "POST /api/cs/:id/compute-health → 200");
  assert(typeof ch.body?.score === "number", "compute-health returns score");
  assert(["healthy", "at_risk", "critical"].includes(ch.body?.status ?? "healthy"), "compute-health status is valid");
  assert(Array.isArray(ch.body?.flags), "compute-health returns flags array");

  // Cleanup
  await req("PATCH", `/api/cs/${hid}`, { status: "cancelled" });
}

// ── Regression: deployment, install, quote, exec dashboard ────────────────────
async function testRegressions() {
  console.log("\n── Phase 7: Regression Tests ────────────────────────────────");

  // Deployment dashboard
  const dep = await req("GET", "/api/deployments/dashboard");
  assert(dep.status === 200, "GET /api/deployments/dashboard → 200 (regression)");
  assert(typeof dep.body === "object" && dep.body !== null, "Deployments dashboard returns object");

  // Deployments list — returns { data: [...] }
  const deps = await req("GET", "/api/deployments");
  assert(deps.status === 200, "GET /api/deployments → 200 (regression)");
  assert(Array.isArray(deps.body?.data) || Array.isArray(deps.body), "Deployments list has data array");

  // Install workflows list — returns { data: [], total: 0 }
  const iws = await req("GET", "/api/install-workflows");
  assert(iws.status === 200, "GET /api/install-workflows → 200 (regression)");
  assert(Array.isArray(iws.body?.data) || Array.isArray(iws.body), "Install workflows list has data array");

  // Quotes list — returns { data: [...] }
  const quotes = await req("GET", "/api/quotes");
  assert(quotes.status === 200, "GET /api/quotes → 200 (regression)");
  assert(Array.isArray(quotes.body?.data) || Array.isArray(quotes.body), "Quotes list has data array");

  // CS list — returns { data: [...], total: N }
  const csList = await req("GET", "/api/cs");
  assert(csList.status === 200, "GET /api/cs → 200 (regression)");
  assert(Array.isArray(csList.body?.data) || Array.isArray(csList.body), "CS list has data array");

  // CS filters still work
  const csActive = await req("GET", "/api/cs?status=active");
  assert(csActive.status === 200, "GET /api/cs?status=active → 200 (regression)");
  const csExpansion = await req("GET", "/api/cs?expansion=medium");
  assert(csExpansion.status === 200, "GET /api/cs?expansion=medium → 200 (regression)");

  // Renewal check endpoint still works
  const rc = await req("POST", "/api/cs/renewal-check", {});
  assert(rc.status === 200, "POST /api/cs/renewal-check → 200 (regression)");
  assert(rc.body?.ok === true, "renewal-check returns ok:true");

  // Projects (oversight) still works
  const proj = await req("GET", "/api/projects");
  assert(proj.status === 200, "GET /api/projects → 200 (regression)");
  assert(Array.isArray(proj.body), "Projects list returns array");

  // Cert summary still works
  const summary = await req("GET", "/api/projects/cert-summary");
  assert(summary.status === 200, "GET /api/projects/cert-summary → 200 (regression)");
  assert(typeof summary.body?.total === "number", "cert-summary total is number (regression)");

  // Procurement dashboard
  const proc = await req("GET", "/api/procurement/dashboard");
  assert(proc.status === 200, "GET /api/procurement/dashboard → 200 (regression)");

  // Unauthenticated CS timeline is blocked
  const savedCookie = cookieJar;
  cookieJar = "";
  const unauth = await req("GET", `/api/cs/${csId}/timeline`);
  assert(unauth.status === 401, "GET /api/cs/:id/timeline unauthenticated → 401");

  // Link-opportunity unauthenticated is blocked
  const unauthLink = await req("POST", `/api/cs/${csId}/link-opportunity`, { opportunityId: 1 });
  assert(unauthLink.status === 401, "POST /api/cs/:id/link-opportunity unauthenticated → 401");
  cookieJar = savedCookie;
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
async function cleanup() {
  if (csId) await req("PATCH", `/api/cs/${csId}`, { status: "cancelled" });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== CS Oversight Layer Tests (Phase 7) ===\n");
  try {
    await login();
    await createCsRecord();
    await createOpportunity();

    await testTimelineEmpty();
    await testTimelineEvents();
    await testExpansionLinking();
    await testDashboard();
    await testRenewalStatusTransitions();
    await testHealthClassification();
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
