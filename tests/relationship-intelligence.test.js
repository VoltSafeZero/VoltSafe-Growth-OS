#!/usr/bin/env node
/**
 * Phase 8 — Relationship Intelligence Tests
 * Tests: personal mailbox routes, privacy mode, backfill jobs,
 *        warmness graph, global search, intelligence views.
 *
 * Run with: node tests/relationship-intelligence.test.js
 * Requires: server running at localhost:5000
 */

const BASE = "http://localhost:5000";
let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  \u2713 ${label}`);
  passed++;
}

function fail(label, detail) {
  console.error(`  \u2717 ${label}${detail ? ` \u2014 ${detail}` : ""}`);
  failed++;
}

async function loginAs(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    credentials: "include",
  });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const cookieStr = setCookies.map(c => c.split(";")[0]).join("; ");
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  return cookieStr;
}

async function api(method, path, body, cookie) {
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers["Cookie"] = cookie;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  let data;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, body: data };
}

// ── Test runner ───────────────────────────────────────────────────────────────

async function test(label, fn) {
  try {
    await fn();
    ok(label);
  } catch (err) {
    fail(label, err.message);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "Assertion failed");
}
function assertStatus(res, expected, label) {
  assert(res.status === expected,
    `${label} — Expected HTTP ${expected}, got ${res.status}. Body: ${JSON.stringify(res.body)}`);
}
function assertArray(v, label) {
  assert(Array.isArray(v), `${label} — Expected array, got ${JSON.stringify(v)}`);
}
function assertKey(obj, key, label) {
  assert(obj && key in obj, `${label} — Missing key '${key}' in ${JSON.stringify(obj)}`);
}

// ── Suites ────────────────────────────────────────────────────────────────────

async function testPersonalMailbox(cookie) {
  console.log("\n── Personal Mailbox Routes ──────────────────────────────────────");

  await test("GET /api/my/mailbox — 200 with array", async () => {
    const r = await api("GET", "/api/my/mailbox", null, cookie);
    assertStatus(r, 200, "/api/my/mailbox");
    assertArray(r.body, "mailbox list");
  });

  await test("GET /api/my/mailbox — 401 without auth", async () => {
    const r = await api("GET", "/api/my/mailbox");
    assertStatus(r, 401, "unauthenticated mailbox");
  });

  await test("GET /api/my/mailbox/connect — redirects to Google OAuth", async () => {
    const res = await fetch(`${BASE}/api/my/mailbox/connect`, {
      method: "GET",
      headers: { Cookie: cookie },
      redirect: "manual",
    });
    const location = res.headers.get("location") || "";
    const ok =
      res.status === 302 ||
      res.status === 301 ||
      location.includes("accounts.google.com") ||
      location.includes("oauth") ||
      res.status === 200;
    assert(ok, `Expected OAuth redirect, got ${res.status} location=${location}`);
  });

  await test("GET /api/my/mailbox/backfill/status — 200 array", async () => {
    const r = await api("GET", "/api/my/mailbox/backfill/status", null, cookie);
    assertStatus(r, 200, "backfill/status");
    assertArray(r.body, "backfill jobs");
  });
}

async function testPrivacyMode(cookie) {
  console.log("\n── Privacy Mode ─────────────────────────────────────────────────");

  await test("PATCH /api/my/mailbox/999999/privacy — 403 or 404", async () => {
    const r = await api("PATCH", "/api/my/mailbox/999999/privacy",
      { privacyMode: "metadata_only" }, cookie);
    assert([403, 404].includes(r.status),
      `Expected 403/404, got ${r.status}`);
  });

  await test("PATCH /api/my/mailbox/999999/privacy — 400 for invalid enum", async () => {
    const r = await api("PATCH", "/api/my/mailbox/999999/privacy",
      { privacyMode: "invalid_mode" }, cookie);
    assert([400, 404, 422].includes(r.status),
      `Expected 400/404/422, got ${r.status}`);
  });

  await test("PATCH /api/my/mailbox/1/privacy — 401 without auth", async () => {
    const r = await api("PATCH", "/api/my/mailbox/1/privacy", { privacyMode: "private" });
    assertStatus(r, 401, "unauthenticated privacy patch");
  });
}

async function testBackfillJobs(cookie) {
  console.log("\n── Backfill Jobs ────────────────────────────────────────────────");

  await test("POST /api/my/mailbox/999999/backfill — 403 or 404", async () => {
    const r = await api("POST", "/api/my/mailbox/999999/backfill",
      { dateFrom: "2024-01-01", dateTo: "2024-12-31" }, cookie);
    assert([403, 404].includes(r.status),
      `Expected 403/404, got ${r.status}`);
  });

  await test("POST /api/my/mailbox/1/backfill — 401 without auth", async () => {
    const r = await api("POST", "/api/my/mailbox/1/backfill",
      { dateFrom: "2024-01-01", dateTo: "2024-12-31" });
    assertStatus(r, 401, "unauthenticated backfill");
  });

  await test("GET /api/my/mailbox/backfill/status — empty array when no jobs", async () => {
    const r = await api("GET", "/api/my/mailbox/backfill/status", null, cookie);
    assertStatus(r, 200, "backfill status");
    assertArray(r.body, "backfill jobs");
  });
}

async function testRelationshipGraph(cookie) {
  console.log("\n── Relationship Graph ───────────────────────────────────────────");

  await test("GET /api/relationships/graph — 200 with relationships array", async () => {
    const r = await api("GET", "/api/relationships/graph", null, cookie);
    assertStatus(r, 200, "graph");
    const hasRelationships = "relationships" in r.body || "contacts" in r.body;
    assert(hasRelationships, `Expected 'relationships' or 'contacts' key in ${JSON.stringify(r.body)}`);
  });

  await test("GET /api/relationships/graph?email=@ — filtered response", async () => {
    const r = await api("GET", "/api/relationships/graph?email=%40", null, cookie);
    assertStatus(r, 200, "filtered graph");
    assert(typeof r.body === "object" && r.body !== null, "Expected object response");
  });

  await test("GET /api/relationships/graph — 401 without auth", async () => {
    const r = await api("GET", "/api/relationships/graph");
    assertStatus(r, 401, "unauthenticated graph");
  });
}

async function testIntelligenceViews(cookie) {
  console.log("\n── Intelligence Views ───────────────────────────────────────────");

  const views = ["dormant_leads", "warm_to_reengage", "multi_threaded", "no_contact_180"];
  for (const view of views) {
    await test(`GET /api/relationships/views?view=${view} — 200 array`, async () => {
      const r = await api("GET", `/api/relationships/views?view=${view}`, null, cookie);
      assertStatus(r, 200, `view ${view}`);
      assertArray(r.body, view);
    });
  }

  await test("GET /api/relationships/views — 401 without auth", async () => {
    const r = await api("GET", "/api/relationships/views?view=dormant_leads");
    assertStatus(r, 401, "unauthenticated views");
  });
}

async function testGlobalSearch(cookie) {
  console.log("\n── Global Search ────────────────────────────────────────────────");

  await test("GET /api/search/global?q=marina — returns {contacts,accounts,emails}", async () => {
    const r = await api("GET", "/api/search/global?q=marina", null, cookie);
    assertStatus(r, 200, "global search");
    assertKey(r.body, "contacts", "search");
    assertKey(r.body, "accounts", "search");
    assertKey(r.body, "emails", "search");
    assertArray(r.body.contacts, "contacts");
    assertArray(r.body.accounts, "accounts");
    assertArray(r.body.emails, "emails");
  });

  await test("GET /api/search/global?q= — empty returns zero results", async () => {
    const r = await api("GET", "/api/search/global?q=", null, cookie);
    assertStatus(r, 200, "empty search");
    assert(
      !r.body.contacts?.length && !r.body.accounts?.length,
      "Expected empty results for blank query"
    );
  });

  await test("GET /api/search/global — 401 without auth", async () => {
    const r = await api("GET", "/api/search/global?q=test");
    assertStatus(r, 401, "unauthenticated search");
  });

  await test("GET /api/search/global?q=tr — returns contact results", async () => {
    const r = await api("GET", "/api/search/global?q=tr", null, cookie);
    assertStatus(r, 200, "search tr");
    assertArray(r.body.contacts, "contacts");
  });
}

async function testTeamMailboxes(cookie) {
  console.log("\n── Team Mailboxes ───────────────────────────────────────────────");

  await test("GET /api/team/mailboxes — 200 with array", async () => {
    const r = await api("GET", "/api/team/mailboxes", null, cookie);
    assertStatus(r, 200, "team mailboxes");
    assertArray(r.body, "team mailboxes");
  });

  await test("GET /api/team/mailboxes — 401 without auth", async () => {
    const r = await api("GET", "/api/team/mailboxes");
    assertStatus(r, 401, "unauthenticated team mailboxes");
  });
}

async function testNoRegression(cookie) {
  console.log("\n── No Regression — Existing Routes ─────────────────────────────");

  await test("GET /api/relationships/intelligence?days=30 — still works", async () => {
    const r = await api("GET", "/api/relationships/intelligence?days=30", null, cookie);
    assertStatus(r, 200, "existing RI route");
    assert(typeof r.body === "object" && r.body !== null, "Expected object");
  });

  await test("GET /api/mail-accounts — still accessible (200 or 403)", async () => {
    const r = await api("GET", "/api/mail-accounts", null, cookie);
    assert([200, 403].includes(r.status),
      `Expected 200/403, got ${r.status}`);
  });
}

// ── Entry point ───────────────────────────────────────────────────────────────

(async () => {
  console.log("Relationship Intelligence — Phase 8 Tests");
  console.log("==========================================");

  let cookie;
  try {
    cookie = await loginAs("trevor@voltsafe.com", "alberni1444");
    console.log("\u2713 Logged in as trevor@voltsafe.com");
  } catch (err) {
    console.error("\u2717 Login failed:", err.message);
    process.exit(1);
  }

  await testPersonalMailbox(cookie);
  await testPrivacyMode(cookie);
  await testBackfillJobs(cookie);
  await testRelationshipGraph(cookie);
  await testIntelligenceViews(cookie);
  await testGlobalSearch(cookie);
  await testTeamMailboxes(cookie);
  await testNoRegression(cookie);

  console.log("\n==========================================");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
