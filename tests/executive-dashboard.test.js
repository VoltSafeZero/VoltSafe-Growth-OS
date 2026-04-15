/**
 * Executive Dashboard / Board Reporting — Test Suite
 * Tests: KPI aggregation, filters, risk alerts, board mode, no regression
 */

const BASE = "http://localhost:5000";
let cookie = "";

// ── Auth ─────────────────────────────────────────────────────────────────────
async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "trevor@voltsafe.com", password: "alberni1444" }),
  });
  const hdrs = r.headers.get("set-cookie") ?? "";
  cookie = hdrs.split(";")[0];
  return r.ok;
}

async function get(path) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { Cookie: cookie },
    credentials: "include",
  });
  return { status: r.status, body: await r.json() };
}

// ── Test Runner ───────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];

function section(label) { console.log(`\n── ${label} ${"─".repeat(Math.max(0, 50 - label.length))}`); }
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, msg) { console.log(`  ✗ ${label} — ${msg}`); failed++; failures.push(`${label}: ${msg}`); }
function assert(cond, label, msg = "condition false") { cond ? ok(label) : fail(label, msg); }
function assertNum(v, label) { assert(typeof v === "number" && !isNaN(v), label, `expected number, got ${typeof v} (${v})`); }
function assertGte(v, min, label) { assert(v >= min, label, `${v} < ${min}`); }
function assertRange(v, lo, hi, label) { assert(v >= lo && v <= hi, label, `${v} not in [${lo},${hi}]`); }
/** Extract scalar from KpiDelta object or pass through plain number */
function cur(v) { if (v !== null && typeof v === "object" && "current" in v) return v.current; return v; }

// ── Main ─────────────────────────────────────────────────────────────────────
console.log("=== Executive Dashboard / Board Reporting Test Suite ===");

async function waitForServer(retries = 20, delayMs = 500) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "trevor@voltsafe.com", password: "alberni1444" }) });
      if (r.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, delayMs));
  }
  return false;
}

async function run() {
  const ready = await waitForServer();
  if (!ready) { console.error("Server not ready after retries"); process.exit(1); }
  const authed = await login();
  if (!authed) { console.error("Login failed"); process.exit(1); }

  // ─────────────────────────────────────────────────────────────────────────
  section("Section 1: /api/executive/kpis — Response Shape");
  const { status: kpiStatus, body: kpis } = await get("/api/executive/kpis");

  assert(kpiStatus === 200,   "KPI endpoint returns 200");
  assert(typeof kpis === "object", "KPI response is an object");
  assert("asOf" in kpis || "metadata" in kpis, "Response has asOf timestamp or metadata block");
  assert("pipeline" in kpis, "Response has pipeline section");
  assert("quotes" in kpis,   "Response has quotes section");
  assert("installs" in kpis, "Response has installs section");
  assert("leads" in kpis,    "Response has leads section");
  assert("risks" in kpis,    "Response has risks section");

  // ─────────────────────────────────────────────────────────────────────────
  section("Section 2: /api/executive/kpis — Pipeline KPIs");
  const pl = kpis.pipeline ?? {};

  assertNum(cur(pl.totalPipeline),    "pipeline.totalPipeline is a number");
  assertNum(cur(pl.weightedPipeline), "pipeline.weightedPipeline is a number");
  assertNum(pl.commitAmount,          "pipeline.commitAmount is a number");
  assertNum(pl.bestCaseAmount,        "pipeline.bestCaseAmount is a number");
  assertNum(cur(pl.totalOpps),        "pipeline.totalOpps is a number");
  assertNum(pl.closedWonCount,        "pipeline.closedWonCount is a number");
  assertNum(pl.closedWonAmount,       "pipeline.closedWonAmount is a number");
  assertNum(pl.stalledCount,          "pipeline.stalledCount is a number");
  assertGte(cur(pl.totalPipeline), 0, "totalPipeline >= 0");
  assertGte(cur(pl.totalOpps), 0,     "totalOpps >= 0");
  assert(cur(pl.weightedPipeline) <= cur(pl.totalPipeline) + 1,
    "weightedPipeline <= totalPipeline (probability-discounted)",
    `${cur(pl.weightedPipeline)} > ${cur(pl.totalPipeline)}`);

  // ─────────────────────────────────────────────────────────────────────────
  section("Section 3: /api/executive/kpis — Quotes & Revenue KPIs");
  const qt = kpis.quotes ?? {};

  assertNum(qt.total,             "quotes.total is a number");
  assertNum(qt.sent,              "quotes.sent is a number");
  assertNum(qt.accepted,          "quotes.accepted is a number");
  assertNum(qt.declined,          "quotes.declined is a number");
  assertNum(qt.expired,           "quotes.expired is a number");
  assertNum(qt.awaitingResponse,  "quotes.awaitingResponse is a number");
  assertNum(cur(qt.acceptedRevenue), "quotes.acceptedRevenue is a number");
  assertNum(cur(qt.winRate),         "quotes.winRate is a number");
  assertNum(qt.acceptedRevenueMonth, "quotes.acceptedRevenueMonth is a number");
  assertNum(qt.acceptedRevenueQtr,   "quotes.acceptedRevenueQtr is a number");
  assertRange(cur(qt.winRate), 0, 100, "winRate is 0–100");
  assertGte(cur(qt.acceptedRevenue), 0, "acceptedRevenue >= 0");
  assertGte(qt.acceptedRevenueQtr, qt.acceptedRevenueMonth - 1,
    "qtr revenue >= monthly revenue (qtr includes month)");

  // ─────────────────────────────────────────────────────────────────────────
  section("Section 4: /api/executive/kpis — Install KPIs");
  const iw = kpis.installs ?? {};

  assertNum(iw.total,          "installs.total is a number");
  assertNum(iw.inProgress,     "installs.inProgress is a number");
  assertNum(iw.pendingKickoff, "installs.pendingKickoff is a number");
  assertNum(iw.complete,       "installs.complete is a number");
  assertNum(iw.onHold,         "installs.onHold is a number");
  assertNum(iw.withBlockers,   "installs.withBlockers is a number");
  assertNum(cur(iw.completedMonth), "installs.completedMonth is a number");
  assertNum(iw.completedQtr,        "installs.completedQtr is a number");
  assertGte(iw.completedQtr, cur(iw.completedMonth) - 1,
    "completedQtr >= completedMonth");

  // ─────────────────────────────────────────────────────────────────────────
  section("Section 5: /api/executive/kpis — Lead KPIs");
  const ld = kpis.leads ?? {};

  assertNum(ld.total,          "leads.total is a number");
  assertNum(ld.converted,      "leads.converted is a number");
  assertNum(cur(ld.newThisMonth), "leads.newThisMonth is a number");
  assertNum(ld.noOwner,        "leads.noOwner is a number");
  assertGte(ld.total, ld.converted, "total leads >= converted");
  assertGte(ld.total, 1000, "sanity: total leads >= 1,000 (real data)");

  // ─────────────────────────────────────────────────────────────────────────
  section("Section 6: /api/executive/kpis — Risks section");
  const rk = kpis.risks ?? {};

  assertNum(rk.overdueTaskCount,     "risks.overdueTaskCount is a number");
  assertNum(rk.stalledOpps,          "risks.stalledOpps is a number");
  assertNum(rk.stalledAmount,        "risks.stalledAmount is a number");
  assertNum(rk.installsWithBlockers, "risks.installsWithBlockers is a number");
  assertNum(rk.quotesAwaitingReply,  "risks.quotesAwaitingReply is a number");
  assertNum(rk.leadsNoOwner,         "risks.leadsNoOwner is a number");
  assertGte(rk.stalledAmount, 0, "stalledAmount >= 0");

  // ─────────────────────────────────────────────────────────────────────────
  section("Section 7: /api/executive/kpis — Date Filter");
  const { body: kpisFiltered } = await get("/api/executive/kpis?dateFrom=2025-01-01&dateTo=2025-03-31");

  assert(typeof kpisFiltered === "object" && kpisFiltered.pipeline,
    "Date-filtered KPIs return valid shape");
  assert(kpisFiltered.leads.total <= kpis.leads.total,
    "Date-filtered leads count <= unfiltered leads count");

  // ─────────────────────────────────────────────────────────────────────────
  section("Section 8: /api/executive/kpis — Future Date Filter");
  const { body: futureKpis } = await get("/api/executive/kpis?dateFrom=2099-01-01&dateTo=2099-12-31");

  assert(typeof futureKpis === "object" && "leads" in futureKpis,
    "Future date filter still returns valid shape");
  assert(futureKpis.leads.total === 0,
    "No leads in far-future date range (data integrity)");

  // ─────────────────────────────────────────────────────────────────────────
  section("Section 9: /api/executive/kpis — Owner Filter");
  const { body: ownerKpis } = await get("/api/executive/kpis?ownerId=4");

  assert(typeof ownerKpis === "object" && "pipeline" in ownerKpis,
    "Owner-filtered KPIs return valid shape");
  assertNum(cur(ownerKpis.pipeline.totalPipeline), "Owner-filtered pipeline is a number");
  assert(cur(ownerKpis.pipeline.totalPipeline) <= cur(kpis.pipeline.totalPipeline) + 1,
    "Owner-filtered pipeline <= total pipeline");

  // ─────────────────────────────────────────────────────────────────────────
  section("Section 10: /api/executive/risk-alerts — Shape");
  const { status: riskStatus, body: risks } = await get("/api/executive/risk-alerts");

  assert(riskStatus === 200, "Risk alerts endpoint returns 200");
  assert(typeof risks === "object", "Risk alerts response is an object");
  assert(Array.isArray(risks.stalledOpps),    "stalledOpps is an array");
  assert(Array.isArray(risks.awaitingQuotes), "awaitingQuotes is an array");
  assert(Array.isArray(risks.installBlockers),"installBlockers is an array");
  assert(Array.isArray(risks.overdueTasks),   "overdueTasks is an array");
  assert(typeof risks.dqRisks === "object",   "dqRisks is an object");
  assert(Array.isArray(risks.unownedLeads),   "unownedLeads is an array");

  // ─────────────────────────────────────────────────────────────────────────
  section("Section 11: /api/executive/risk-alerts — Stalled Opps");
  if (risks.stalledOpps.length > 0) {
    const r = risks.stalledOpps[0];
    assert("id" in r,          "stalledOpp has id");
    assert("title" in r,       "stalledOpp has title");
    assert("days_stale" in r,  "stalledOpp has days_stale");
    assertGte(r.days_stale, 21, "stalledOpp.days_stale >= 21");
  } else {
    ok("No stalled opps (threshold not reached — valid)");
  }

  // ─────────────────────────────────────────────────────────────────────────
  section("Section 12: /api/executive/risk-alerts — Awaiting Quotes");
  if (risks.awaitingQuotes.length > 0) {
    const r = risks.awaitingQuotes[0];
    assert("id" in r,            "awaitingQuote has id");
    assert("quote_number" in r,  "awaitingQuote has quote_number");
    assert("days_waiting" in r,  "awaitingQuote has days_waiting");
    assertGte(r.days_waiting, 14, "awaitingQuote.days_waiting >= 14");
  } else {
    ok("No quotes awaiting >14d (valid)");
  }

  // ─────────────────────────────────────────────────────────────────────────
  section("Section 13: /api/executive/risk-alerts — DQ Risks");
  const dq = risks.dqRisks;
  assert("leads_no_owner" in dq,  "dqRisks has leads_no_owner");
  assert("opps_no_owner" in dq,   "dqRisks has opps_no_owner");
  assert("opps_stale_30d" in dq,  "dqRisks has opps_stale_30d");
  assert("quotes_stale_30d" in dq,"dqRisks has quotes_stale_30d");
  assertGte(parseInt(dq.leads_no_owner ?? 0), 0, "leads_no_owner >= 0");
  assertGte(parseInt(dq.opps_stale_30d ?? 0),  0, "opps_stale_30d >= 0");

  // ─────────────────────────────────────────────────────────────────────────
  section("Section 14: /api/executive/risk-alerts — Unowned Leads");
  if (risks.unownedLeads.length > 0) {
    const u = risks.unownedLeads[0];
    assert("id" in u,         "unownedLead has id");
    assert("company" in u,    "unownedLead has company");
    assert("created_at" in u, "unownedLead has created_at");
  } else {
    ok("No unowned leads (valid)");
  }

  // ─────────────────────────────────────────────────────────────────────────
  section("Section 15: /api/executive/risk-alerts — Owner Filter");
  const { body: riskOwner } = await get("/api/executive/risk-alerts?ownerId=4");

  assert(Array.isArray(riskOwner.stalledOpps), "Owner-filtered risk alerts: stalledOpps is array");
  if (riskOwner.stalledOpps.length > 0 && riskOwner.stalledOpps[0].owner_name) {
    ok("Owner-filtered stalled opps contain owner_name");
  } else {
    ok("Owner-filtered risk alerts responded (no matches or no name — valid)");
  }

  // ─────────────────────────────────────────────────────────────────────────
  section("Section 16: Cross-Consistency — KPIs vs Risk Alerts");
  assert(rk.stalledOpps === risks.stalledOpps.length || rk.stalledOpps >= risks.stalledOpps.length,
    "kpis.risks.stalledOpps consistent with risk-alerts list length",
    `kpi says ${rk.stalledOpps}, list has ${risks.stalledOpps.length}`);
  assert(rk.quotesAwaitingReply === risks.awaitingQuotes.length || rk.quotesAwaitingReply >= risks.awaitingQuotes.length,
    "kpis.risks.quotesAwaitingReply consistent with awaiting quotes list",
    `kpi says ${rk.quotesAwaitingReply}, list has ${risks.awaitingQuotes.length}`);

  // ─────────────────────────────────────────────────────────────────────────
  section("Section 17: Source Attribution Rollup Inclusion");
  const { status: srcStatus, body: srcSummary } = await get("/api/analytics/source-attribution/summary");
  assert(srcStatus === 200, "Source attribution still returns 200 after exec dashboard add");
  assertGte(srcSummary.totalLeads, 1000, "Source attribution totalLeads still >= 1,000");

  // ─────────────────────────────────────────────────────────────────────────
  section("Section 18: No Regression — Existing Endpoints");
  const regressionChecks = [
    ["/api/pipeline/forecast?months=3", (b) => Array.isArray(b.periods) && b.periods.length > 0, "pipeline/forecast returns periods array"],
    ["/api/pipeline/rep-performance",   (b) => Array.isArray(b.reps),  "rep-performance returns reps array"],
    ["/api/install-workflows/summary",  (b) => typeof b.total === "number", "install-workflows/summary has total"],
    ["/api/data-quality/summary",       (b) => b.health && b.health.accounts, "data-quality/summary has health.accounts"],
    ["/api/opportunities",              (b) => Array.isArray(b.data), "opportunities returns data array"],
    ["/api/quotes",                     (b) => Array.isArray(b.data), "quotes returns data array"],
    ["/api/leads",                      (b) => Array.isArray(b.data), "leads returns data array"],
  ];

  for (const [path, check, label] of regressionChecks) {
    const { body } = await get(path);
    assert(check(body), label, "shape mismatch: " + JSON.stringify(body).slice(0, 80));
  }

  // ─────────────────────────────────────────────────────────────────────────
  section("Section 19: asOf Timestamp Validity");
  // asOf was moved to metadata.generatedAt in the hardened API; accept either.
  const tsStr = kpis.asOf ?? kpis.metadata?.generatedAt;
  const ts = new Date(tsStr);
  assert(!isNaN(ts.getTime()), "asOf is a valid ISO timestamp");
  assert(Date.now() - ts.getTime() < 60_000, "asOf is within last 60 seconds");

  // ─────────────────────────────────────────────────────────────────────────
  section("Section 20: Unauthenticated Access Denied");
  const unauthedR = await fetch(`${BASE}/api/executive/kpis`);
  assert(unauthedR.status === 401, "Unauthenticated KPI request returns 401");
  const unauthedRA = await fetch(`${BASE}/api/executive/risk-alerts`);
  assert(unauthedRA.status === 401, "Unauthenticated risk-alerts request returns 401");

  // ─────────────────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${"─".repeat(52)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${total} tests`);
  if (failures.length) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  ✗ ${f}`));
    process.exit(1);
  } else {
    console.log("All tests passed ✓");
  }
}

run().catch(err => { console.error("Fatal:", err); process.exit(1); });
