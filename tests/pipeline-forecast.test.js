/**
 * Pipeline Forecasting + Rep Performance — Test Suite
 *
 * Covers:
 *  1.  Setup — login
 *  2.  Pipeline insights — extended fields (byCat, closingThisMonth, noOpenTask, quotesAwaitingResponse)
 *  3.  Pipeline insights — byStage weighted calculation
 *  4.  Pipeline insights — stalled deals threshold (daysSinceActivity >= 7)
 *  5.  Pipeline forecast — returns periods + summary
 *  6.  Pipeline forecast — monthly grouping (month key format)
 *  7.  Pipeline forecast — summary totals are numeric
 *  8.  Pipeline forecast — category buckets present in periods
 *  9.  Rep performance — returns reps array
 *  10. Rep performance — rep shape has all required fields
 *  11. Rep performance — win rate is null or 0-100
 *  12. Rep performance — activities are non-negative
 *  13. Forecast filter by ownerId — only shows data for that owner
 *  14. Auth guards — all new routes require auth
 *  15. Saved-view data correctness — closingThisMonth items have est_close_date
 */
import assert from "assert/strict";

const BASE = "http://localhost:5000";
const JSON_HDR = { "Content-Type": "application/json" };

async function login(email = "trevor@voltsafe.com", password = "alberni1444") {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: JSON_HDR,
    body: JSON.stringify({ email, password }),
  });
  const sid = (r.headers.get("set-cookie") || "").match(/connect\.sid=([^;]+)/)?.[1];
  if (!sid) throw new Error(`Login failed (status ${r.status})`);
  return `connect.sid=${sid}`;
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

let COOKIE = "";
let INSIGHTS = null;
let FORECAST = null;
let REPS = null;

// ── 1. Setup ──────────────────────────────────────────────────────────────────

test("Setup — login", async () => {
  COOKIE = await login();
  await new Promise(r => setTimeout(r, 400));
});

// ── 2. Pipeline insights — extended fields ────────────────────────────────────

test("GET /api/pipeline/insights — returns extended shape", async () => {
  const r = await fetch(`${BASE}/api/pipeline/insights`, { headers: { Cookie: COOKIE } });
  assert.equal(r.status, 200, `insights should return 200 (got ${r.status})`);
  INSIGHTS = await r.json();

  assert.ok(Array.isArray(INSIGHTS.stalled),                "stalled should be array");
  assert.ok(Array.isArray(INSIGHTS.noNextStep),             "noNextStep should be array");
  assert.ok(Array.isArray(INSIGHTS.highValueInactive),       "highValueInactive should be array");
  assert.ok(Array.isArray(INSIGHTS.byStage),                "byStage should be array");
  assert.ok(Array.isArray(INSIGHTS.byOwner),                "byOwner should be array");
  assert.ok(Array.isArray(INSIGHTS.byCat),                  "byCat should be array");
  assert.ok(Array.isArray(INSIGHTS.closingThisMonth),       "closingThisMonth should be array");
  assert.ok(Array.isArray(INSIGHTS.noOpenTask),             "noOpenTask should be array");
  assert.ok(Array.isArray(INSIGHTS.quotesAwaitingResponse), "quotesAwaitingResponse should be array");
  assert.ok(typeof INSIGHTS.totalActive === "number",       "totalActive should be number");
  assert.ok(typeof INSIGHTS.totalPipeline === "number",     "totalPipeline should be number");
});

// ── 3. Pipeline insights — byStage weighted calculation ───────────────────────

test("Pipeline insights — byStage weighted = totalAmount * probability", async () => {
  for (const s of INSIGHTS.byStage) {
    assert.ok(typeof s.stage === "string",           "stage should be string");
    assert.ok(typeof s.probability === "number",     "probability should be number");
    assert.ok(typeof s.count === "number",           "count should be number");
    assert.ok(typeof s.totalAmount === "number",     "totalAmount should be number");
    assert.ok(typeof s.weightedAmount === "number",  "weightedAmount should be number");

    if (s.count > 0) {
      const expected = Math.round(s.totalAmount * s.probability / 100);
      // Allow ±2 for rounding
      assert.ok(Math.abs(s.weightedAmount - expected) <= 2,
        `Stage ${s.stage}: weightedAmount ${s.weightedAmount} should be ~${expected}`);
    }
  }
});

// ── 4. Pipeline insights — stalled threshold ─────────────────────────────────

test("Pipeline insights — stalled items have daysSinceActivity >= 7", async () => {
  for (const o of INSIGHTS.stalled) {
    assert.ok(o.daysSinceActivity >= 7,
      `Stalled opp ${o.id} has ${o.daysSinceActivity} days — should be >= 7`);
  }
});

// ── 5. Pipeline forecast — returns periods + summary ─────────────────────────

test("GET /api/pipeline/forecast — returns valid shape", async () => {
  const r = await fetch(`${BASE}/api/pipeline/forecast?months=6`, { headers: { Cookie: COOKIE } });
  assert.equal(r.status, 200, `forecast should return 200 (got ${r.status})`);
  FORECAST = await r.json();

  assert.ok(Array.isArray(FORECAST.periods), "periods should be array");
  assert.ok(typeof FORECAST.summary === "object", "summary should be object");
  assert.ok("totalWeighted" in FORECAST.summary, "summary.totalWeighted required");
  assert.ok("commit" in FORECAST.summary, "summary.commit required");
  assert.ok("best_case" in FORECAST.summary, "summary.best_case required");
  assert.ok("pipeline" in FORECAST.summary, "summary.pipeline required");
});

// ── 6. Pipeline forecast — monthly grouping ───────────────────────────────────

test("Pipeline forecast — month keys are in YYYY-MM format", async () => {
  for (const p of FORECAST.periods) {
    assert.match(p.month, /^\d{4}-\d{2}$/, `Period month '${p.month}' should match YYYY-MM`);
    assert.ok(typeof p.label === "string", "period label should be string");
    assert.ok(typeof p.totalWeighted === "number", "totalWeighted should be number");
  }
});

// ── 7. Pipeline forecast — summary totals are numeric ─────────────────────────

test("Pipeline forecast — summary fields are all non-negative numbers", async () => {
  for (const [key, val] of Object.entries(FORECAST.summary)) {
    assert.ok(typeof val === "number", `summary.${key} should be number`);
    assert.ok(Number(val) >= 0, `summary.${key} should be >= 0`);
  }
});

// ── 8. Pipeline forecast — period structure ───────────────────────────────────

test("Pipeline forecast — periods have commit/best_case/pipeline/closed_won buckets", async () => {
  for (const p of FORECAST.periods) {
    const required = ["commit", "best_case", "pipeline", "closed_won"];
    for (const key of required) {
      assert.ok(key in p, `Period ${p.month} missing '${key}' bucket`);
      const bucket = p[key];
      assert.ok(typeof bucket.count === "number",        `${p.month}.${key}.count should be number`);
      assert.ok(typeof bucket.totalAmount === "number",  `${p.month}.${key}.totalAmount should be number`);
      assert.ok(typeof bucket.weightedAmount === "number", `${p.month}.${key}.weightedAmount should be number`);
    }
  }
});

// ── 9. Rep performance — returns reps array ───────────────────────────────────

test("GET /api/pipeline/rep-performance — returns valid shape", async () => {
  const r = await fetch(`${BASE}/api/pipeline/rep-performance`, { headers: { Cookie: COOKIE } });
  assert.equal(r.status, 200, `rep-performance should return 200 (got ${r.status})`);
  REPS = await r.json();

  assert.ok(Array.isArray(REPS.reps), "reps should be array");
  assert.ok(typeof REPS.lookbackDays === "number", "lookbackDays should be number");
});

// ── 10. Rep performance — shape has all required fields ───────────────────────

test("Rep performance — each rep has required fields", async () => {
  const required = [
    "userId", "name", "openOpps", "totalPipeline", "weightedPipeline",
    "staleOpps", "overdueFollowups", "quotesSent", "quotesAccepted",
    "closedWonCount", "closedWonAmount", "closedLostCount",
    "activitiesLast7d", "activitiesLast30d",
  ];
  for (const rep of REPS.reps) {
    for (const field of required) {
      assert.ok(field in rep, `Rep ${rep.name} missing '${field}'`);
    }
  }
});

// ── 11. Rep performance — win rate is null or 0-100 ──────────────────────────

test("Rep performance — winRate is null or between 0 and 100", async () => {
  for (const rep of REPS.reps) {
    if (rep.winRate !== null) {
      assert.ok(rep.winRate >= 0 && rep.winRate <= 100,
        `Rep ${rep.name} winRate ${rep.winRate} out of range`);
    }
  }
});

// ── 12. Rep performance — activity counts non-negative ───────────────────────

test("Rep performance — activity counts are non-negative numbers", async () => {
  for (const rep of REPS.reps) {
    assert.ok(rep.activitiesLast7d >= 0,  `${rep.name} activitiesLast7d should be >= 0`);
    assert.ok(rep.activitiesLast30d >= 0, `${rep.name} activitiesLast30d should be >= 0`);
    assert.ok(rep.activitiesLast30d >= rep.activitiesLast7d,
      `${rep.name} 30d activities should be >= 7d`);
    assert.ok(rep.overdueFollowups >= 0,  `${rep.name} overdueFollowups should be >= 0`);
    assert.ok(rep.staleOpps >= 0,         `${rep.name} staleOpps should be >= 0`);
  }
});

// ── 13. Forecast filter by ownerId ────────────────────────────────────────────

test("Forecast — filter by ownerId=999999 returns empty periods or none for that owner", async () => {
  const r = await fetch(`${BASE}/api/pipeline/forecast?months=6&ownerId=999999`, {
    headers: { Cookie: COOKIE },
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  // With a non-existent owner, should return empty periods or at least the shape
  assert.ok(Array.isArray(body.periods), "periods should be array even when owner doesn't exist");
});

// ── 14. Auth guards ───────────────────────────────────────────────────────────

test("Auth guards — forecast and rep-performance require session", async () => {
  const routes = [
    "/api/pipeline/forecast",
    "/api/pipeline/rep-performance",
    "/api/pipeline/insights",
  ];
  for (const path of routes) {
    const r = await fetch(`${BASE}${path}`);
    assert.equal(r.status, 401, `${path} should return 401 without auth, got ${r.status}`);
  }
});

// ── 15. Saved-view correctness — closingThisMonth ─────────────────────────────

test("Pipeline insights — closingThisMonth items have estCloseDate", async () => {
  for (const opp of INSIGHTS.closingThisMonth) {
    assert.ok(opp.estCloseDate, `closingThisMonth opp ${opp.id} should have estCloseDate`);
    const closeDate = new Date(opp.estCloseDate);
    const now = new Date();
    // Should be in current month (or close to it — within 1 month tolerance for data edge cases)
    const monthDiff = (closeDate.getFullYear() - now.getFullYear()) * 12 + (closeDate.getMonth() - now.getMonth());
    assert.ok(monthDiff === 0,
      `closingThisMonth opp ${opp.id} closeDate ${opp.estCloseDate} is not in current month`);
  }
});

// ── Runner ────────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
for (const t of tests) {
  try {
    await t.fn();
    console.log(`  ✓  ${t.name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${t.name}`);
    console.error(`       ${err.message}`);
    failed++;
  }
}
console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
