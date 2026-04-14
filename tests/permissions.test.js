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
    headers: { "Content-Type": "application/json" },
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

  // ── MIXED USER (crm=edit, quoting=view, support=edit, others=none) ─────────
  console.log("\n── Mixed (mixed@voltsafe.com | crm=edit, quoting=view, support=edit) ──");
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

  // ── MASTER ADMIN (bypass all permission checks) ────────────────────────────
  console.log("\n── Admin (trevor@voltsafe.com | master_admin bypass) ──");
  const adminCookie = await login("trevor@voltsafe.com", "alberni1444");
  const a = authed(adminCookie);

  await check("GET  /api/leads              [admin bypass \u2192 200]", a("/api/leads?page=1&limit=5"), 200);
  await check("GET  /api/quotes             [admin bypass \u2192 200]", a("/api/quotes?page=1&limit=5"), 200);
  await check("GET  /api/partnerships       [admin bypass \u2192 200]", a("/api/partnerships"), 200);
  await check("GET  /api/tickets            [admin bypass \u2192 200]", a("/api/tickets"), 200);
  await checkOneOf("POST /api/leads              [admin bypass \u2192 201|400]", a("/api/leads", { method: "POST", body: JSON.stringify({ company: "AdminTest" }) }), 201, 400);
  await checkOneOf("POST /api/quotes             [admin bypass \u2192 201|400]", a("/api/quotes", { method: "POST", body: JSON.stringify({ accountId: 1 }) }), 201, 400);

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
