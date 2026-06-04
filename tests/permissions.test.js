#!/usr/bin/env node
/**
 * Permission Enforcement Test Suite
 * Tests that backend API endpoints enforce section-level permissions correctly.
 * Run with: node tests/permissions.test.js
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": BASE },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status}`);
  const cookie = res.headers.get("set-cookie")?.match(/(connect\.sid=[^;]+)/)?.[1];
  if (!cookie) throw new Error(`No session cookie for ${email}`);
  // Give connect-pg-simple time to commit the session to PostgreSQL
  await sleep(400);
  return cookie;
}

function authed(cookie) {
  return async (url, opts = {}) => {
    const res = await fetch(`${BASE}${url}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        "Origin": BASE,
        Cookie: cookie,
        ...(opts.headers || {}),
      },
    });
    return res;
  };
}

async function check(label, resFn, expectedStatus) {
  const res = await resFn;
  if (res.status === expectedStatus) {
    ok(`${label} \u2192 ${res.status}`);
  } else {
    const body = await res.text().catch(() => "");
    fail(`${label} \u2192 expected ${expectedStatus}, got ${res.status}`, body.slice(0, 120));
  }
}

async function checkOneOf(label, resFn, ...expectedStatuses) {
  const res = await resFn;
  if (expectedStatuses.includes(res.status)) {
    ok(`${label} \u2192 ${res.status} (permission granted, schema validates)`);
  } else {
    const body = await res.text().catch(() => "");
    fail(
      `${label} \u2192 expected one of [${expectedStatuses.join(", ")}], got ${res.status}`,
      body.slice(0, 120)
    );
  }
}

async function run() {
  console.log("=== VoltSafe Cortex Permission Test Suite ===\n");

  // ── VIEWER USER (crm=view, all others=none) ────────────────────────────────
  console.log("── Viewer (viewer@voltsafe.com | crm=view, all others=none) ──");
  const viewerCookie = await login("viewer@voltsafe.com", "testpass1234");
  const v = authed(viewerCookie);

  // CRM reads allowed (crm=view)
  await check("GET /api/leads               [crm=view  \u2192 200]", v("/api/leads?page=1&limit=5"), 200);
  await check("GET /api/accounts            [crm=view  \u2192 200]", v("/api/accounts?page=1&limit=5"), 200);
  await check("GET /api/contacts            [crm=view  \u2192 200]", v("/api/contacts?page=1&limit=5"), 200);

  // CRM writes blocked (crm=view, need edit)
  await check("POST /api/leads              [crm=view  \u2192 403]", v("/api/leads", { method: "POST", body: JSON.stringify({ company: "X" }) }), 403);
  await check("PUT  /api/leads/1            [crm=view  \u2192 403]", v("/api/leads/1", { method: "PUT", body: JSON.stringify({ company: "X" }) }), 403);
  await check("DEL  /api/leads/1            [crm=view  \u2192 403]", v("/api/leads/1", { method: "DELETE" }), 403);
  await check("POST /api/leads/:id/convert  [crm=view  \u2192 403]", v("/api/leads/1/convert", { method: "POST" }), 403);
  await check("POST /api/accounts           [crm=view  \u2192 403]", v("/api/accounts", { method: "POST", body: JSON.stringify({ name: "X" }) }), 403);
  await check("PUT  /api/accounts/1         [crm=view  \u2192 403]", v("/api/accounts/1", { method: "PUT", body: JSON.stringify({ name: "X" }) }), 403);
  await check("POST /api/contacts           [crm=view  \u2192 403]", v("/api/contacts", { method: "POST", body: JSON.stringify({ name: "X" }) }), 403);

  // Quoting blocked (quoting=none)
  await check("GET  /api/quotes             [quot=none \u2192 403]", v("/api/quotes?page=1&limit=5"), 403);
  await check("POST /api/quotes             [quot=none \u2192 403]", v("/api/quotes", { method: "POST", body: JSON.stringify({}) }), 403);

  // Partnerships blocked (partnerships=none)
  await check("GET  /api/partnerships       [part=none \u2192 403]", v("/api/partnerships"), 403);
  await check("POST /api/partnerships       [part=none \u2192 403]", v("/api/partnerships", { method: "POST", body: JSON.stringify({}) }), 403);

  // Support/tickets blocked (support=none)
  await check("GET  /api/tickets            [supp=none \u2192 403]", v("/api/tickets"), 403);
  await check("POST /api/tickets            [supp=none \u2192 403]", v("/api/tickets", { method: "POST", body: JSON.stringify({}) }), 403);

  // Projects blocked (projects=none) — NEW
  await check("GET  /api/projects           [proj=none \u2192 403]", v("/api/projects"), 403);
  await check("POST /api/projects           [proj=none \u2192 403]", v("/api/projects", { method: "POST", body: JSON.stringify({ name: "X" }) }), 403);

  // Knowledge/assets blocked (knowledge=none) — NEW
  await check("GET  /api/assets             [know=none \u2192 403]", v("/api/assets"), 403);
  await check("GET  /api/asset-folders      [know=none \u2192 403]", v("/api/asset-folders"), 403);

  // Communications blocked (communications=none) — NEW
  await check("GET  /api/comm-lists         [comm=none \u2192 403]", v("/api/comm-lists"), 403);
  await check("POST /api/comm-lists         [comm=none \u2192 403]", v("/api/comm-lists", { method: "POST", body: JSON.stringify({ name: "X" }) }), 403);

  // Team workload blocked (team_workload=none) — NEW
  await check("GET  /api/team-workload      [wkld=none \u2192 403]", v("/api/team-workload"), 403);

  // ── MIXED USER (crm=edit, quoting=view, support=edit, knowledge=view, others=none) ──
  console.log("\n── Mixed (mixed@voltsafe.com | crm=edit, quoting=view, support=edit, knowledge=view) ──");
  const mixedCookie = await login("mixed@voltsafe.com", "testpass1234");
  const m = authed(mixedCookie);

  // CRM reads + writes allowed (crm=edit)
  await check("GET  /api/leads              [crm=edit  \u2192 200]", m("/api/leads?page=1&limit=5"), 200);
  await check("GET  /api/accounts           [crm=edit  \u2192 200]", m("/api/accounts?page=1&limit=5"), 200);
  // Write passes permission; 400 = schema validation, 201 = success — both mean permission granted
  await checkOneOf("POST /api/leads              [crm=edit  \u2192 201|400]", m("/api/leads", { method: "POST", body: JSON.stringify({ company: "MixedTest" }) }), 201, 400);

  // Quoting reads allowed, writes blocked (quoting=view)
  await check("GET  /api/quotes             [quot=view \u2192 200]", m("/api/quotes?page=1&limit=5"), 200);
  await check("POST /api/quotes             [quot=view \u2192 403]", m("/api/quotes", { method: "POST", body: JSON.stringify({}) }), 403);
  await check("DEL  /api/quote-line-items/1 [quot=view \u2192 403]", m("/api/quote-line-items/1", { method: "DELETE" }), 403);

  // Support reads + writes allowed (support=edit)
  await check("GET  /api/tickets            [supp=edit \u2192 200]", m("/api/tickets"), 200);
  await checkOneOf("POST /api/tickets            [supp=edit \u2192 201|400]", m("/api/tickets", { method: "POST", body: JSON.stringify({ subject: "Test" }) }), 201, 400);

  // Partnerships blocked (partnerships=none)
  await check("GET  /api/partnerships       [part=none \u2192 403]", m("/api/partnerships"), 403);
  await check("POST /api/partnerships       [part=none \u2192 403]", m("/api/partnerships", { method: "POST", body: JSON.stringify({}) }), 403);

  // Knowledge reads allowed, writes blocked (knowledge=view) — NEW
  await check("GET  /api/assets             [know=view \u2192 200]", m("/api/assets"), 200);
  await check("GET  /api/asset-folders      [know=view \u2192 200]", m("/api/asset-folders"), 200);
  await check("POST /api/asset-folders      [know=view \u2192 403]", m("/api/asset-folders", { method: "POST", body: JSON.stringify({ name: "X" }) }), 403);

  // Projects blocked (projects=none) — NEW
  await check("GET  /api/projects           [proj=none \u2192 403]", m("/api/projects"), 403);
  await check("POST /api/projects           [proj=none \u2192 403]", m("/api/projects", { method: "POST", body: JSON.stringify({}) }), 403);

  // Communications blocked (communications=none) — NEW
  await check("GET  /api/comm-lists         [comm=none \u2192 403]", m("/api/comm-lists"), 403);
  await check("POST /api/campaigns          [comm=none \u2192 403]", m("/api/campaigns", { method: "POST", body: JSON.stringify({}) }), 403);

  // Team workload blocked (team_workload=none) — NEW
  await check("GET  /api/team-workload      [wkld=none \u2192 403]", m("/api/team-workload"), 403);

  // ── MASTER ADMIN (bypass all permission checks) ────────────────────────────
  console.log("\n── Admin (trevor@voltsafe.com | master_admin bypass) ──");
  const adminCookie = await login("trevor@voltsafe.com", "alberni1444");
  const a = authed(adminCookie);

  await check("GET  /api/leads              [admin bypass \u2192 200]", a("/api/leads?page=1&limit=5"), 200);
  await check("GET  /api/quotes             [admin bypass \u2192 200]", a("/api/quotes?page=1&limit=5"), 200);
  await check("GET  /api/partnerships       [admin bypass \u2192 200]", a("/api/partnerships"), 200);
  await check("GET  /api/tickets            [admin bypass \u2192 200]", a("/api/tickets"), 200);
  await check("GET  /api/projects           [admin bypass \u2192 200]", a("/api/projects"), 200);
  await check("GET  /api/assets             [admin bypass \u2192 200]", a("/api/assets"), 200);
  await check("GET  /api/comm-lists         [admin bypass \u2192 200]", a("/api/comm-lists"), 200);
  await check("GET  /api/team-workload      [admin bypass \u2192 200]", a("/api/team-workload"), 200);
  await checkOneOf("POST /api/leads              [admin bypass \u2192 201|400]", a("/api/leads", { method: "POST", body: JSON.stringify({ company: "AdminTest" }) }), 201, 400);
  await checkOneOf("POST /api/quotes             [admin bypass \u2192 201|400]", a("/api/quotes", { method: "POST", body: JSON.stringify({ accountId: 1 }) }), 201, 400);
  await checkOneOf("POST /api/projects           [admin bypass \u2192 201|400]", a("/api/projects", { method: "POST", body: JSON.stringify({ name: "AdminProj" }) }), 201, 400);

  // PATCH /api/admin/users/:id/permissions validation — NEW
  console.log("\n── PATCH Permissions Validation (admin) ──");
  // Invalid payload should return 400
  await check(
    "PATCH /api/admin/users/6/permissions [bad payload \u2192 400]",
    a("/api/admin/users/6/permissions", { method: "PATCH", body: JSON.stringify({ crm: "superuser" }) }),
    400
  );
  // Valid payload should return 200
  await checkOneOf(
    "PATCH /api/admin/users/6/permissions [good payload \u2192 200]",
    a("/api/admin/users/6/permissions", { method: "PATCH", body: JSON.stringify({ crm: "view", quoting: "none", support: "none", calendar: "none", projects: "none", knowledge: "none", mail_team: {}, partnerships: "none", calendar_team: [], team_workload: "none", communications: "none" }) }),
    200
  );

  // ── UNAUTHENTICATED ACCESS (no session) ────────────────────────────────────
  console.log("\n── Unauthenticated (no session cookie) ──");
  const anon = (url, opts = {}) => fetch(`${BASE}${url}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });

  // Chat API — must require auth (anon POST without Origin gets CSRF-blocked at 403
  // before auth can return 401; both are acceptable "not allowed" responses)
  await check("GET  /api/conversations         [anon → 401]", anon("/api/conversations"), 401);
  await checkOneOf("POST /api/conversations         [anon → 401|403]", anon("/api/conversations", { method: "POST", body: JSON.stringify({ title: "x" }) }), 401, 403);
  await checkOneOf("POST /api/conversations/1/msgs  [anon → 401|403]", anon("/api/conversations/1/messages", { method: "POST", body: JSON.stringify({ content: "x" }) }), 401, 403);

  // Image generation — must require auth
  await checkOneOf("POST /api/generate-image        [anon → 401|403]", anon("/api/generate-image", { method: "POST", body: JSON.stringify({ prompt: "x" }) }), 401, 403);

  // Export routes — must require auth
  await check("GET  /api/leads/export          [anon → 401]", anon("/api/leads/export"), 401);
  await check("GET  /api/accounts/export       [anon → 401]", anon("/api/accounts/export"), 401);
  await check("GET  /api/contacts/export       [anon → 401]", anon("/api/contacts/export"), 401);
  await check("GET  /api/opportunities/export  [anon → 401]", anon("/api/opportunities/export"), 401);
  await check("GET  /api/quotes/export         [anon → 401]", anon("/api/quotes/export"), 401);
  await check("GET  /api/tickets/export        [anon → 401]", anon("/api/tickets/export"), 401);

  // Core CRM — must require auth
  await check("GET  /api/leads                 [anon → 401]", anon("/api/leads?page=1&limit=1"), 401);
  await check("GET  /api/accounts              [anon → 401]", anon("/api/accounts?page=1&limit=1"), 401);

  // ── ADMIN PRIVILEGE ESCALATION (non-admin cannot use admin write routes) ──
  console.log("\n── Admin Privilege Escalation (viewer cannot mutate admin routes) ──");
  const viewerCookieForAdmin = await login("viewer@voltsafe.com", "testpass1234");
  const v2 = authed(viewerCookieForAdmin);

  await check("POST /api/admin/users           [viewer → 403]", v2("/api/admin/users", { method: "POST", body: JSON.stringify({ name: "x", email: "x@x.com" }) }), 403);
  await check("POST /api/admin/users/6/suspend [viewer → 403]", v2("/api/admin/users/6/suspend", { method: "POST", body: JSON.stringify({}) }), 403);
  await check("POST /api/admin/users/6/reset-password [viewer → 403]", v2("/api/admin/users/6/reset-password", { method: "POST", body: JSON.stringify({ newPassword: "newpass1" }) }), 403);
  await check("DELETE /api/admin/users/6       [viewer → 403]", v2("/api/admin/users/6", { method: "DELETE" }), 403);
  await check("PUT /api/admin/users/6          [viewer → 403]", v2("/api/admin/users/6", { method: "PUT", body: JSON.stringify({ name: "x" }) }), 403);

  // ── SUMMARY ────────────────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} total`);

  if (failed > 0) {
    console.error(`\n\u274C ${failed} test(s) FAILED`);
    process.exit(1);
  } else {
    console.log(`\n\u2705 All ${passed} tests PASSED`);
    process.exit(0);
  }
}

run().catch((err) => {
  console.error("Test runner error:", err.message);
  process.exit(1);
});
