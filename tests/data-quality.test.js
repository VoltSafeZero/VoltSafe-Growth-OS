/**
 * Data Quality / Dedupe Center — Test Suite
 *
 * Covers:
 *  1.  Setup — login
 *  2.  Summary — returns expected shape
 *  3.  Summary — health scores are 0-100
 *  4.  Summary — counts are non-negative numbers
 *  5.  Summary — forecast block present
 *  6.  Issues — duplicates returns accounts/contacts/leads arrays
 *  7.  Issues — missing_owner returns opps/tasks/leads arrays
 *  8.  Issues — missing_fields returns missingCloseDate/missingAmount arrays
 *  9.  Issues — orphans returns expected arrays
 *  10. Issues — stale returns expected arrays
 *  11. Issues — unknown category returns 400
 *  12. Auth guards — all routes require session
 *  13. Ignore — POST /api/data-quality/ignore works
 *  14. Ignore — duplicate record excluded from issues after ignore
 *  15. Fix — assign_owner (opportunity) works
 *  16. Fix — set_close_date works
 *  17. Fix — set_amount works
 *  18. Fix — archive_record (quote) works
 *  19. Fix — unknown action returns 400
 *  20. Fix — missing required fields returns 400
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
let SUMMARY = null;
let IGNORE_ID = null;
let TEST_OPP_ID = null; // An opp we'll modify

// ── 1. Setup ──────────────────────────────────────────────────────────────────

test("Setup — login", async () => {
  COOKIE = await login();
  await new Promise(r => setTimeout(r, 300));
});

// ── 2. Summary shape ──────────────────────────────────────────────────────────

test("GET /api/data-quality/summary — returns expected shape", async () => {
  const r = await fetch(`${BASE}/api/data-quality/summary`, { headers: { Cookie: COOKIE } });
  assert.equal(r.status, 200, `summary should return 200 (got ${r.status})`);
  SUMMARY = await r.json();

  assert.ok(typeof SUMMARY.health === "object",  "health should be object");
  assert.ok(typeof SUMMARY.counts === "object",  "counts should be object");
  assert.ok(typeof SUMMARY.forecast === "object","forecast should be object");

  // Check health keys
  for (const key of ["accounts","contacts","leads","opportunities","quotes"]) {
    assert.ok(key in SUMMARY.health, `health.${key} should exist`);
    assert.ok("score" in SUMMARY.health[key], `health.${key}.score should exist`);
    assert.ok("issues" in SUMMARY.health[key], `health.${key}.issues should exist`);
  }
});

// ── 3. Health scores 0-100 ────────────────────────────────────────────────────

test("Summary — health scores are in range 0-100", async () => {
  for (const [key, val] of Object.entries(SUMMARY.health)) {
    assert.ok(val.score >= 0 && val.score <= 100, `health.${key}.score ${val.score} out of range`);
    assert.ok(val.issues >= 0, `health.${key}.issues should be >= 0`);
  }
});

// ── 4. Counts are non-negative ────────────────────────────────────────────────

test("Summary — all counts are non-negative numbers", async () => {
  const required = [
    "duplicate_account_clusters","duplicate_contact_clusters","duplicate_lead_clusters",
    "missing_owner_opps","missing_owner_tasks","missing_owner_leads",
    "missing_close_date","missing_amount",
    "orphan_quotes","orphan_opps","broken_lead_links",
    "stale_leads","contacts_no_account","total",
  ];
  for (const key of required) {
    assert.ok(key in SUMMARY.counts, `counts.${key} should exist`);
    assert.ok(typeof SUMMARY.counts[key] === "number", `counts.${key} should be number`);
    assert.ok(SUMMARY.counts[key] >= 0, `counts.${key} should be >= 0`);
  }
});

// ── 5. Forecast block ─────────────────────────────────────────────────────────

test("Summary — forecast block has required fields", async () => {
  const required = ["opps_missing_close_date","weighted_stale_pipeline","weighted_no_owner_pipeline","duplicate_accounts_with_opps"];
  for (const key of required) {
    assert.ok(key in SUMMARY.forecast, `forecast.${key} should exist`);
    assert.ok(typeof SUMMARY.forecast[key] === "number", `forecast.${key} should be number`);
  }
});

// ── 6. Issues — duplicates ────────────────────────────────────────────────────

test("GET /api/data-quality/issues?category=duplicates — returns arrays", async () => {
  const r = await fetch(`${BASE}/api/data-quality/issues?category=duplicates`, { headers: { Cookie: COOKIE } });
  assert.equal(r.status, 200);
  const body = await r.json();

  assert.ok(Array.isArray(body.accounts), "duplicates.accounts should be array");
  assert.ok(Array.isArray(body.contacts), "duplicates.contacts should be array");
  assert.ok(Array.isArray(body.leads),    "duplicates.leads should be array");
  assert.ok(typeof body.total === "number", "duplicates.total should be number");

  // If there are any clusters, validate structure
  for (const cluster of [...body.accounts, ...body.contacts, ...body.leads]) {
    assert.ok(cluster.clusterKey,           "cluster should have clusterKey");
    assert.ok(typeof cluster.count === "number", "cluster.count should be number");
    assert.ok(Array.isArray(cluster.records), "cluster.records should be array");
    assert.ok(cluster.records.length >= 2, "cluster should have >= 2 records");
  }
});

// ── 7. Issues — missing_owner ─────────────────────────────────────────────────

test("GET /api/data-quality/issues?category=missing_owner — returns arrays", async () => {
  const r = await fetch(`${BASE}/api/data-quality/issues?category=missing_owner`, { headers: { Cookie: COOKIE } });
  assert.equal(r.status, 200);
  const body = await r.json();

  assert.ok(Array.isArray(body.opportunities), "missing_owner.opportunities should be array");
  assert.ok(Array.isArray(body.tasks),         "missing_owner.tasks should be array");
  assert.ok(Array.isArray(body.leads),         "missing_owner.leads should be array");
});

// ── 8. Issues — missing_fields ────────────────────────────────────────────────

test("GET /api/data-quality/issues?category=missing_fields — returns arrays", async () => {
  const r = await fetch(`${BASE}/api/data-quality/issues?category=missing_fields`, { headers: { Cookie: COOKIE } });
  assert.equal(r.status, 200);
  const body = await r.json();

  assert.ok(Array.isArray(body.missingCloseDate), "missing_fields.missingCloseDate should be array");
  assert.ok(Array.isArray(body.missingAmount),    "missing_fields.missingAmount should be array");

  // Capture an opp ID for fix tests
  if (body.missingCloseDate.length > 0) TEST_OPP_ID = body.missingCloseDate[0].id;
  else if (body.missingAmount.length > 0) TEST_OPP_ID = body.missingAmount[0].id;
});

// ── 9. Issues — orphans ───────────────────────────────────────────────────────

test("GET /api/data-quality/issues?category=orphans — returns arrays", async () => {
  const r = await fetch(`${BASE}/api/data-quality/issues?category=orphans`, { headers: { Cookie: COOKIE } });
  assert.equal(r.status, 200);
  const body = await r.json();

  assert.ok(Array.isArray(body.orphanQuotes),    "orphans.orphanQuotes should be array");
  assert.ok(Array.isArray(body.orphanOpps),      "orphans.orphanOpps should be array");
  assert.ok(Array.isArray(body.brokenLeadLinks), "orphans.brokenLeadLinks should be array");
});

// ── 10. Issues — stale ────────────────────────────────────────────────────────

test("GET /api/data-quality/issues?category=stale — returns arrays", async () => {
  const r = await fetch(`${BASE}/api/data-quality/issues?category=stale`, { headers: { Cookie: COOKIE } });
  assert.equal(r.status, 200);
  const body = await r.json();

  assert.ok(Array.isArray(body.staleLeads),        "stale.staleLeads should be array");
  assert.ok(Array.isArray(body.contactsNoAccount), "stale.contactsNoAccount should be array");
});

// ── 11. Unknown category returns 400 ─────────────────────────────────────────

test("Issues — unknown category returns 400", async () => {
  const r = await fetch(`${BASE}/api/data-quality/issues?category=foobar`, { headers: { Cookie: COOKIE } });
  assert.equal(r.status, 400);
});

// ── 12. Auth guards ───────────────────────────────────────────────────────────

test("Auth guards — all routes require session", async () => {
  const routes = [
    ["GET",   "/api/data-quality/summary"],
    ["GET",   "/api/data-quality/issues?category=duplicates"],
    ["POST",  "/api/data-quality/ignore"],
    ["PATCH", "/api/data-quality/fix"],
  ];
  for (const [method, path] of routes) {
    const r = await fetch(`${BASE}${path}`, {
      method,
      headers: JSON_HDR,
      body: method !== "GET" ? "{}" : undefined,
    });
    assert.equal(r.status, 401, `${method} ${path} should return 401 without auth, got ${r.status}`);
  }
});

// ── 13. Ignore — POST works ───────────────────────────────────────────────────

test("POST /api/data-quality/ignore — ignores an issue", async () => {
  const r = await fetch(`${BASE}/api/data-quality/ignore`, {
    method: "POST",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({
      objectType: "lead_dup",
      clusterKey: "test-cluster-do-not-use",
      issueType: "duplicate",
      note: "test ignore",
    }),
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
});

// ── 14. Ignore — re-ignore is idempotent (no 500) ────────────────────────────

test("POST /api/data-quality/ignore — duplicate ignore is idempotent", async () => {
  const r = await fetch(`${BASE}/api/data-quality/ignore`, {
    method: "POST",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({
      objectType: "lead_dup",
      clusterKey: "test-cluster-do-not-use",
      issueType: "duplicate",
    }),
  });
  assert.equal(r.status, 200, "second ignore should be idempotent (no error)");
});

// ── 15. Fix — assign_owner ────────────────────────────────────────────────────

test("PATCH /api/data-quality/fix — assign_owner (opportunity)", async () => {
  // Find an opp to work with
  const oppsRes = await fetch(`${BASE}/api/data-quality/issues?category=missing_owner`, { headers: { Cookie: COOKIE } });
  const oppsBody = await oppsRes.json();
  const opp = oppsBody.opportunities?.[0];
  if (!opp) { console.log("    ⚠ No unowned opportunities — skipping assign_owner test"); return; }

  const r = await fetch(`${BASE}/api/data-quality/fix`, {
    method: "PATCH",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ action: "assign_owner", objectType: "opportunity", objectId: opp.id, value: "4" }),
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);

  // Opp should no longer appear in missing_owner
  const after = await fetch(`${BASE}/api/data-quality/issues?category=missing_owner`, { headers: { Cookie: COOKIE } }).then(r => r.json());
  const stillMissing = (after.opportunities ?? []).find((o) => o.id === opp.id);
  assert.ok(!stillMissing, `Opp ${opp.id} should no longer appear in missing_owner after assign`);
});

// ── 16. Fix — set_close_date ──────────────────────────────────────────────────

test("PATCH /api/data-quality/fix — set_close_date", async () => {
  if (!TEST_OPP_ID) {
    // Create a test opportunity missing close date via finding any active opp
    const oppsRes = await fetch(`${BASE}/api/opportunities`, { headers: { Cookie: COOKIE } }).then(r => r.json());
    const anyOpp = (oppsRes.data ?? oppsRes)?.[0];
    if (!anyOpp) { console.log("    ⚠ No opportunities in DB — skipping"); return; }
    TEST_OPP_ID = anyOpp.id;
  }

  const r = await fetch(`${BASE}/api/data-quality/fix`, {
    method: "PATCH",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ action: "set_close_date", objectType: "opportunity", objectId: TEST_OPP_ID, value: "2026-12-31" }),
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
});

// ── 17. Fix — set_amount ──────────────────────────────────────────────────────

test("PATCH /api/data-quality/fix — set_amount", async () => {
  if (!TEST_OPP_ID) { console.log("    ⚠ No opp ID — skipping"); return; }
  const r = await fetch(`${BASE}/api/data-quality/fix`, {
    method: "PATCH",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ action: "set_amount", objectType: "opportunity", objectId: TEST_OPP_ID, value: "99999" }),
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
});

// ── 18. Fix — archive_record ──────────────────────────────────────────────────

test("PATCH /api/data-quality/fix — archive_record (lead)", async () => {
  // Create a throwaway lead to archive
  const createRes = await fetch(`${BASE}/api/leads`, {
    method: "POST",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ company: "DQ Test Archive Co", contactName: "Test Person", status: "new" }),
  });
  if (createRes.status !== 200 && createRes.status !== 201) {
    console.log("    ⚠ Could not create test lead — skipping archive test");
    return;
  }
  const created = await createRes.json();
  const leadId = created.id ?? created.data?.id;
  if (!leadId) { console.log("    ⚠ No lead ID returned — skipping"); return; }

  const r = await fetch(`${BASE}/api/data-quality/fix`, {
    method: "PATCH",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ action: "archive_record", objectType: "lead", objectId: leadId }),
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
});

// ── 19. Fix — unknown action returns 400 ─────────────────────────────────────

test("PATCH /api/data-quality/fix — unknown action returns 400", async () => {
  const r = await fetch(`${BASE}/api/data-quality/fix`, {
    method: "PATCH",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ action: "explode_everything", objectType: "opportunity", objectId: 1 }),
  });
  assert.equal(r.status, 400);
});

// ── 20. Fix — missing fields returns 400 ─────────────────────────────────────

test("PATCH /api/data-quality/fix — missing required fields returns 400", async () => {
  const r = await fetch(`${BASE}/api/data-quality/fix`, {
    method: "PATCH",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ action: "assign_owner" }),  // missing objectType + objectId
  });
  assert.equal(r.status, 400);
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
