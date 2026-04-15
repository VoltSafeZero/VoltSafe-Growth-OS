/**
 * Executive KPI Hardening Tests
 * Covers: shared module contracts, delta math, prior-period derivation,
 *         API response shape, summary bullets, metadata freshness, risk severity.
 */

const BASE = "http://localhost:5000";
const LOGIN = { email: "trevor@voltsafe.com", password: "alberni1444" };

let cookie = "";

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(LOGIN),
  });
  const h = r.headers.get("set-cookie") ?? "";
  cookie = h.split(";")[0];
  if (!cookie) throw new Error("Login failed — no cookie");
}

function api(path) {
  return fetch(`${BASE}${path}`, {
    headers: { Cookie: cookie },
    credentials: "include",
  });
}

// ── Tiny test runner ─────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const results = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    results.push({ status: "PASS", name });
  } catch (e) {
    failed++;
    results.push({ status: "FAIL", name, error: e.message });
    console.error(`  FAIL: ${name}\n       ${e.message}`);
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertNum(v, label) { assert(typeof v === "number" && !isNaN(v), `${label} must be a number, got ${JSON.stringify(v)}`); }
function assertStr(v, label) { assert(typeof v === "string", `${label} must be a string, got ${JSON.stringify(v)}`); }

// ── Delta shape validator ─────────────────────────────────────────────────────
function assertDelta(d, label) {
  assert(d !== null && typeof d === "object", `${label}: expected KpiDelta object, got ${JSON.stringify(d)}`);
  assertNum(d.current,  `${label}.current`);
  assertNum(d.previous, `${label}.previous`);
  assertNum(d.delta,    `${label}.delta`);
  assert(d.pctDelta === null || typeof d.pctDelta === "number", `${label}.pctDelta must be number|null`);
  assert(["up","down","flat"].includes(d.trend), `${label}.trend must be up|down|flat, got ${d.trend}`);
  // Arithmetic correctness
  const expectedDelta = d.current - d.previous;
  assert(Math.abs(d.delta - expectedDelta) < 0.01, `${label}.delta arithmetic: expected ${expectedDelta}, got ${d.delta}`);
  if (d.previous !== 0) {
    // calcDelta returns 1 decimal place: Math.round(ratio*1000)/10
    const expectedPct = Math.round((expectedDelta / Math.abs(d.previous)) * 1000) / 10;
    assert(Math.abs(d.pctDelta - expectedPct) < 0.05,
      `${label}.pctDelta: expected ${expectedPct}, got ${d.pctDelta}`);
  } else {
    assert(d.pctDelta === null || d.pctDelta === 0, `${label}.pctDelta with prior=0 must be null or 0`);
  }
  // Trend direction
  if (d.delta > 0) assert(d.trend === "up",   `${label}: delta>0 → trend should be "up"`);
  if (d.delta < 0) assert(d.trend === "down",  `${label}: delta<0 → trend should be "down"`);
  if (d.delta === 0) assert(d.trend === "flat", `${label}: delta=0 → trend should be "flat"`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log("\n🔍  Executive KPI Hardening Tests\n");
  await login();

  // ── 1. Fetch KPI endpoint ─────────────────────────────────────────────────
  let kpis;
  await test("GET /api/executive/kpis — 200 OK", async () => {
    const r = await api("/api/executive/kpis");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    kpis = await r.json();
  });

  // ── 2. Metadata block ─────────────────────────────────────────────────────
  await test("metadata block present", async () => {
    assert(kpis.metadata, "metadata key missing");
  });

  await test("metadata.generatedAt is ISO string", async () => {
    assertStr(kpis.metadata.generatedAt, "metadata.generatedAt");
    assert(!isNaN(Date.parse(kpis.metadata.generatedAt)), "generatedAt must be valid date");
  });

  await test("metadata.comparisonMode is valid enum", async () => {
    const valid = ["explicit_range","month_over_month","quarter_over_quarter"];
    assert(valid.includes(kpis.metadata.comparisonMode),
      `comparisonMode '${kpis.metadata.comparisonMode}' not in ${valid}`);
  });

  await test("metadata.priorFrom and priorTo are ISO strings", async () => {
    assertStr(kpis.metadata.priorFrom, "metadata.priorFrom");
    assertStr(kpis.metadata.priorTo,   "metadata.priorTo");
    assert(!isNaN(Date.parse(kpis.metadata.priorFrom)), "priorFrom must be valid date");
    assert(!isNaN(Date.parse(kpis.metadata.priorTo)),   "priorTo must be valid date");
    assert(new Date(kpis.metadata.priorFrom) < new Date(kpis.metadata.priorTo),
      "priorFrom must be before priorTo");
  });

  await test("metadata.stalledThresholdDays === 21", async () => {
    assert(kpis.metadata.stalledThresholdDays === 21,
      `Expected stalledThresholdDays=21, got ${kpis.metadata.stalledThresholdDays}`);
  });

  await test("metadata.quoteAwaitingThresholdDays === 14", async () => {
    assert(kpis.metadata.quoteAwaitingThresholdDays === 14,
      `Expected quoteAwaitingThresholdDays=14, got ${kpis.metadata.quoteAwaitingThresholdDays}`);
  });

  await test("metadata.ownerId null when no filter", async () => {
    assert(kpis.metadata.ownerId === null, `Expected ownerId=null, got ${kpis.metadata.ownerId}`);
  });

  await test("metadata.comparisonMode=month_over_month on unfiltered call", async () => {
    assert(kpis.metadata.comparisonMode === "month_over_month",
      `Expected month_over_month, got ${kpis.metadata.comparisonMode}`);
  });

  // ── 3. Pipeline delta fields ──────────────────────────────────────────────
  await test("pipeline.totalPipeline is KpiDelta", async () => {
    assertDelta(kpis.pipeline.totalPipeline, "pipeline.totalPipeline");
  });

  await test("pipeline.weightedPipeline is KpiDelta", async () => {
    assertDelta(kpis.pipeline.weightedPipeline, "pipeline.weightedPipeline");
  });

  await test("pipeline.totalOpps is KpiDelta", async () => {
    assertDelta(kpis.pipeline.totalOpps, "pipeline.totalOpps");
  });

  await test("pipeline scalar fields are numbers (non-delta)", async () => {
    assertNum(kpis.pipeline.commitAmount,  "commitAmount");
    assertNum(kpis.pipeline.bestCaseAmount,"bestCaseAmount");
    assertNum(kpis.pipeline.stalledCount,  "stalledCount");
  });

  // ── 4. Quotes delta fields ────────────────────────────────────────────────
  await test("quotes.acceptedRevenue is KpiDelta", async () => {
    assertDelta(kpis.quotes.acceptedRevenue, "quotes.acceptedRevenue");
  });

  await test("quotes.winRate is KpiDelta", async () => {
    assertDelta(kpis.quotes.winRate, "quotes.winRate");
  });

  await test("quotes.winRate.current in [0,100]", async () => {
    const wr = kpis.quotes.winRate.current;
    assert(wr >= 0 && wr <= 100, `winRate.current must be 0-100, got ${wr}`);
  });

  await test("quotes scalar fields present", async () => {
    assertNum(kpis.quotes.total,            "quotes.total");
    assertNum(kpis.quotes.sent,             "quotes.sent");
    assertNum(kpis.quotes.accepted,         "quotes.accepted");
    assertNum(kpis.quotes.acceptedMonth,    "quotes.acceptedMonth");
    assertNum(kpis.quotes.acceptedRevenueMonth, "quotes.acceptedRevenueMonth");
    assertNum(kpis.quotes.acceptedQtr,      "quotes.acceptedQtr");
    assertNum(kpis.quotes.acceptedRevenueQtr,   "quotes.acceptedRevenueQtr");
  });

  // ── 5. Installs delta fields ──────────────────────────────────────────────
  await test("installs.completedMonth is KpiDelta", async () => {
    assertDelta(kpis.installs.completedMonth, "installs.completedMonth");
  });

  await test("installs scalar fields present", async () => {
    assertNum(kpis.installs.total,          "installs.total");
    assertNum(kpis.installs.withBlockers,   "installs.withBlockers");
    assertNum(kpis.installs.completedQtr,   "installs.completedQtr");
  });

  // ── 6. Leads delta fields ─────────────────────────────────────────────────
  await test("leads.newThisMonth is KpiDelta", async () => {
    assertDelta(kpis.leads.newThisMonth, "leads.newThisMonth");
  });

  await test("leads.convertedMonth is KpiDelta", async () => {
    assertDelta(kpis.leads.convertedMonth, "leads.convertedMonth");
  });

  await test("leads scalar fields present", async () => {
    assertNum(kpis.leads.total,     "leads.total");
    assertNum(kpis.leads.converted, "leads.converted");
    assertNum(kpis.leads.noOwner,   "leads.noOwner");
  });

  // ── 7. Summary bullets ───────────────────────────────────────────────────
  await test("summaryBullets is array", async () => {
    assert(Array.isArray(kpis.summaryBullets), "summaryBullets must be array");
  });

  await test("summaryBullets has 1–5 entries", async () => {
    const len = kpis.summaryBullets.length;
    assert(len >= 1 && len <= 5, `Expected 1-5 bullets, got ${len}`);
  });

  await test("every summaryBullet is a non-empty string", async () => {
    for (const b of kpis.summaryBullets) {
      assert(typeof b === "string" && b.trim().length > 0, `Bullet must be non-empty string, got ${JSON.stringify(b)}`);
    }
  });

  // ── 8. Risks block ─────────────────────────────────────────────────────────
  await test("risks block present with all expected fields", async () => {
    assert(kpis.risks,                        "risks missing");
    assertNum(kpis.risks.overdueTaskCount,    "risks.overdueTaskCount");
    assertNum(kpis.risks.stalledOpps,         "risks.stalledOpps");
    assertNum(kpis.risks.stalledAmount,       "risks.stalledAmount");
    assertNum(kpis.risks.installsWithBlockers,"risks.installsWithBlockers");
    assertNum(kpis.risks.quotesAwaitingReply, "risks.quotesAwaitingReply");
    assertNum(kpis.risks.leadsNoOwner,        "risks.leadsNoOwner");
  });

  await test("risks.severity is an object with string values", async () => {
    assert(kpis.risks.severity && typeof kpis.risks.severity === "object",
      "risks.severity must be an object");
    const valid = ["low","medium","high","critical"];
    for (const [k, v] of Object.entries(kpis.risks.severity)) {
      assert(valid.includes(v), `severity[${k}]='${v}' not in ${valid}`);
    }
  });

  await test("risks.distinctAtRiskCount is a non-negative number", async () => {
    assertNum(kpis.risks.distinctAtRiskCount, "risks.distinctAtRiskCount");
    assert(kpis.risks.distinctAtRiskCount >= 0, "distinctAtRiskCount must be >= 0");
  });

  // ── 9. Explicit date-range filter → comparisonMode="explicit_range" ────────
  let kpisFiltered;
  await test("date filter: comparisonMode=explicit_range", async () => {
    const r = await api("/api/executive/kpis?dateFrom=2025-01-01&dateTo=2025-06-30");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    kpisFiltered = await r.json();
    assert(kpisFiltered.metadata.comparisonMode === "explicit_range",
      `Expected explicit_range, got ${kpisFiltered.metadata.comparisonMode}`);
  });

  await test("date filter: metadata reflects dateFrom/dateTo", async () => {
    assert(kpisFiltered.metadata.dateFrom === "2025-01-01",
      `Expected dateFrom=2025-01-01, got ${kpisFiltered.metadata.dateFrom}`);
    assert(kpisFiltered.metadata.dateTo === "2025-06-30",
      `Expected dateTo=2025-06-30, got ${kpisFiltered.metadata.dateTo}`);
  });

  await test("date filter: priorFrom < priorTo < dateFrom", async () => {
    const pf = new Date(kpisFiltered.metadata.priorFrom);
    const pt = new Date(kpisFiltered.metadata.priorTo);
    const df = new Date(kpisFiltered.metadata.dateFrom);
    assert(pf < pt, "priorFrom must be before priorTo");
    assert(pt <= df, "priorTo must be <= dateFrom");
  });

  await test("date filter: delta fields still present", async () => {
    assertDelta(kpisFiltered.pipeline.totalPipeline,   "filtered pipeline.totalPipeline");
    assertDelta(kpisFiltered.quotes.acceptedRevenue,   "filtered quotes.acceptedRevenue");
    assertDelta(kpisFiltered.leads.newThisMonth,        "filtered leads.newThisMonth");
  });

  // ── 10. Owner filter → metadata.ownerId set ───────────────────────────────
  let kpisOwner;
  await test("owner filter: metadata.ownerId reflects filter", async () => {
    const r = await api("/api/executive/kpis?ownerId=4");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    kpisOwner = await r.json();
    assert(kpisOwner.metadata.ownerId === 4,
      `Expected ownerId=4, got ${kpisOwner.metadata.ownerId}`);
  });

  await test("owner filter: delta fields still present", async () => {
    assertDelta(kpisOwner.pipeline.totalPipeline, "owner-filtered pipeline.totalPipeline");
  });

  // ── 11. Risk-alerts endpoint ──────────────────────────────────────────────
  let alerts;
  await test("GET /api/executive/risk-alerts — 200 OK", async () => {
    const r = await api("/api/executive/risk-alerts");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    alerts = await r.json();
  });

  await test("risk-alerts: all buckets present", async () => {
    assert(Array.isArray(alerts.stalledOpps),    "stalledOpps must be array");
    assert(Array.isArray(alerts.awaitingQuotes), "awaitingQuotes must be array");
    assert(Array.isArray(alerts.installBlockers),"installBlockers must be array");
    assert(Array.isArray(alerts.overdueTasks),   "overdueTasks must be array");
    assert(Array.isArray(alerts.unownedLeads),   "unownedLeads must be array");
    assert(alerts.dqRisks && typeof alerts.dqRisks === "object", "dqRisks must be object");
  });

  await test("risk-alerts: severity object present with valid values", async () => {
    assert(alerts.severity && typeof alerts.severity === "object", "alerts.severity must be object");
    const valid = ["low","medium","high","critical"];
    for (const [k, v] of Object.entries(alerts.severity)) {
      assert(valid.includes(v), `alerts.severity[${k}]='${v}' not valid`);
    }
  });

  await test("risk-alerts: distinctAtRiskCount is non-negative number", async () => {
    assertNum(alerts.distinctAtRiskCount, "alerts.distinctAtRiskCount");
    assert(alerts.distinctAtRiskCount >= 0, "distinctAtRiskCount must be >= 0");
  });

  await test("risk-alerts: stalledThresholdDays === 21", async () => {
    assert(alerts.stalledThresholdDays === 21,
      `Expected 21, got ${alerts.stalledThresholdDays}`);
  });

  await test("risk-alerts: awaitingThresholdDays === 14", async () => {
    assert(alerts.awaitingThresholdDays === 14,
      `Expected 14, got ${alerts.awaitingThresholdDays}`);
  });

  await test("risk-alerts stalled opps have days_stale field", async () => {
    for (const opp of alerts.stalledOpps) {
      assert(typeof opp.days_stale === "number" || opp.days_stale !== undefined,
        `Stalled opp id=${opp.id} missing days_stale`);
    }
  });

  // ── 12. Determinism: two rapid calls return same comparisonMode ───────────
  await test("comparisonMode is deterministic across two calls", async () => {
    const [r1, r2] = await Promise.all([
      api("/api/executive/kpis").then(r => r.json()),
      api("/api/executive/kpis").then(r => r.json()),
    ]);
    assert(r1.metadata.comparisonMode === r2.metadata.comparisonMode,
      "comparisonMode must be consistent across calls");
    assert(r1.metadata.priorFrom === r2.metadata.priorFrom,
      "priorFrom must be consistent across calls");
  });

  // ── 13. Delta arithmetic edge cases: call with month boundaries ───────────
  await test("KpiDelta: delta = current - previous always holds", async () => {
    const d = kpis.pipeline.totalPipeline;
    const diff = Math.abs(d.current - d.previous - d.delta);
    assert(diff < 0.01, `Arithmetic violated: ${d.current} - ${d.previous} ≠ ${d.delta}`);
  });

  await test("weighted pipeline is <= total pipeline (sanity check)", async () => {
    const wp = kpis.pipeline.weightedPipeline.current;
    const tp = kpis.pipeline.totalPipeline.current;
    assert(wp <= tp + 0.01, `Weighted (${wp}) should not exceed total (${tp})`);
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  for (const r of results) {
    const icon = r.status === "PASS" ? "✓" : "✗";
    console.log(`  ${icon}  ${r.name}${r.error ? `\n       → ${r.error}` : ""}`);
  }
  console.log(`${"─".repeat(60)}\n`);

  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error("Fatal:", e); process.exit(1); });
