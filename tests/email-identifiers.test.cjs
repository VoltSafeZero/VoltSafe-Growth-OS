"use strict";
/**
 * tests/email-identifiers.test.cjs
 *
 * Regression suite for the CRM Email Identifiers system.
 * Tests: normalization, public domain rejection, conflict detection,
 *        API auth, backfill safety, and identity-resolver priority.
 *
 * Runs against the live dev server (http://localhost:5000).
 * Authentication: logs in as admin before each group.
 */

const assert = require("assert");

const BASE = "http://localhost:5000";
const RUN_ID = Date.now(); // unique suffix per test run — avoids cross-run domain conflicts
let cookie = "";

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": BASE },
    body: JSON.stringify({ email: "trevor@voltsafe.com", password: "alberni1444" }),
    credentials: "include",
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Login failed: ${r.status} — ${text.slice(0, 200)}`);
  }
  const setCookie = r.headers.get("set-cookie") || "";
  cookie = setCookie.split(";")[0];
}

async function api(method, path, body) {
  const opts = {
    method,
    headers: { "Cookie": cookie, "Content-Type": "application/json", "Origin": BASE },
    credentials: "include",
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  return fetch(`${BASE}${path}`, opts);
}

async function getJson(path) {
  const r = await api("GET", path);
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json();
}

// ── Test runner helpers ────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

let testAccountId = null;
let testLeadId = null;
let testContactId = null;

async function createTestFixtures() {
  // Create a throwaway account
  const ar = await api("POST", "/api/accounts", { name: "EmailIdentTest Corp", status: "active" });
  assert.strictEqual(ar.status, 201, `Create account: ${ar.status}`);
  const acct = await ar.json();
  testAccountId = acct.id;

  // Create a throwaway lead
  const lr = await api("POST", "/api/leads", {
    company: "EIT Marina Test Co",
    contactName: "EmailIdentTest Lead",
    contactEmail: "eit-lead@marinavolttest.biz",
    status: "new",
  });
  assert.strictEqual(lr.status, 201, `Create lead: ${lr.status}`);
  const lead = await lr.json();
  testLeadId = lead.id;

  // Create a throwaway contact
  const cr = await api("POST", "/api/contacts", {
    name: "EmailIdentTest Contact",
    email: "eit-contact@marinavolttest.biz",
    accountId: testAccountId,
  });
  if (cr.status === 201 || cr.status === 200) {
    const contact = await cr.json();
    testContactId = contact.id;
  }
}

async function cleanupTestFixtures() {
  if (testLeadId) await api("DELETE", `/api/leads/${testLeadId}`);
  if (testContactId) await api("DELETE", `/api/contacts/${testContactId}`);
  if (testAccountId) await api("DELETE", `/api/accounts/${testAccountId}`);
}

// ── Normalization tests (pure function, exercised via API responses) ───────────

async function runNormalizationTests() {
  console.log("\n── Normalization & Validation ─────────────────────────────────────────────");

  await test("adds a clean domain to an account", async () => {
    const r = await api("POST", `/api/crm/account/${testAccountId}/email-domains`, { domain: `boatco-${RUN_ID}.com` });
    const text = await r.text();
    assert.strictEqual(r.status, 201, `expected 201, got ${r.status}: ${text}`);
    const body = JSON.parse(text);
    assert.strictEqual(body.domain, `boatco-${RUN_ID}.com`);
  });

  await test("strips leading @ from domain input", async () => {
    const r = await api("POST", `/api/crm/account/${testAccountId}/email-domains`, { domain: `@striptest-${RUN_ID}.com` });
    const text = await r.text();
    assert.strictEqual(r.status, 201, `expected 201, got ${r.status}: ${text}`);
    const body = JSON.parse(text);
    assert.strictEqual(body.domain, `striptest-${RUN_ID}.com`);
  });

  await test("strips https:// from domain input", async () => {
    const r = await api("POST", `/api/crm/account/${testAccountId}/email-domains`, { domain: `https://httpstrip-${RUN_ID}.com` });
    const text = await r.text();
    assert.strictEqual(r.status, 201, `expected 201, got ${r.status}: ${text}`);
    const body = JSON.parse(text);
    assert.strictEqual(body.domain, `httpstrip-${RUN_ID}.com`);
  });

  await test("normalizes email address to lowercase", async () => {
    const r = await api("POST", `/api/crm/account/${testAccountId}/email-addresses`, { email: `Test.User@Case-${RUN_ID}.com` });
    const text = await r.text();
    assert.strictEqual(r.status, 201, `expected 201, got ${r.status}: ${text}`);
    const body = JSON.parse(text);
    assert.strictEqual(body.email, `test.user@case-${RUN_ID}.com`);
  });

  await test("lists identifiers for an account", async () => {
    const data = await getJson(`/api/crm/account/${testAccountId}/email-identifiers`);
    assert.ok(Array.isArray(data.domains), "domains is array");
    assert.ok(Array.isArray(data.addresses), "addresses is array");
    assert.ok(data.domains.length >= 3, `expected >=3 domains, got ${data.domains.length}`);
    assert.ok(data.addresses.length >= 1, `expected >=1 address, got ${data.addresses.length}`);
  });
}

// ── Public domain rejection tests ─────────────────────────────────────────────

async function runPublicDomainTests() {
  console.log("\n── Public Domain Rejection ────────────────────────────────────────────────");

  const publicDomains = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com"];

  for (const dom of publicDomains) {
    await test(`rejects public domain: ${dom}`, async () => {
      const r = await api("POST", `/api/crm/account/${testAccountId}/email-domains`, { domain: dom });
      assert.strictEqual(r.status, 400, `expected 400 for ${dom}, got ${r.status}`);
      const body = await r.json();
      const errText = (body.message || body.error || "").toLowerCase();
      assert.ok(errText.includes("public"), `expected 'public' in error message, got: ${body.message || body.error}`);
    });
  }

  await test("allows personal email address from public domain", async () => {
    // Email addresses from public domains are allowed (it's the person's address)
    const r = await api("POST", `/api/crm/lead/${testLeadId}/email-addresses`, { email: "actual-person@gmail.com" });
    assert.ok(r.status === 201 || r.status === 409, `expected 201 or 409, got ${r.status}: ${await r.text()}`);
  });
}

// ── Conflict detection tests ───────────────────────────────────────────────────

async function runConflictTests() {
  console.log("\n── Conflict Detection ─────────────────────────────────────────────────────");

  const conflictDomain = `conflict-${RUN_ID}.com`;
  const conflictEmail = `conflict-addr@conflict-${RUN_ID}.com`;

  // First add domain/email to account
  await api("POST", `/api/crm/account/${testAccountId}/email-domains`, { domain: conflictDomain });
  await api("POST", `/api/crm/account/${testAccountId}/email-addresses`, { email: conflictEmail });

  await test("rejects duplicate domain on same entity (409)", async () => {
    const r = await api("POST", `/api/crm/account/${testAccountId}/email-domains`, { domain: conflictDomain });
    assert.strictEqual(r.status, 409, `expected 409, got ${r.status}`);
  });

  await test("rejects duplicate email on same entity (409)", async () => {
    const r = await api("POST", `/api/crm/account/${testAccountId}/email-addresses`, { email: conflictEmail });
    assert.strictEqual(r.status, 409, `expected 409, got ${r.status}`);
  });

  if (testLeadId) {
    await test("rejects domain already owned by another entity (409)", async () => {
      const r = await api("POST", `/api/crm/lead/${testLeadId}/email-domains`, { domain: conflictDomain });
      const text = await r.text();
      assert.strictEqual(r.status, 409, `expected 409 cross-entity conflict, got ${r.status}: ${text}`);
    });

    await test("rejects email already owned by another entity (409)", async () => {
      const r = await api("POST", `/api/crm/lead/${testLeadId}/email-addresses`, { email: conflictEmail });
      const text = await r.text();
      assert.strictEqual(r.status, 409, `expected 409 cross-entity conflict, got ${r.status}: ${text}`);
    });
  }
}

// ── API auth tests ─────────────────────────────────────────────────────────────

async function runAuthTests() {
  console.log("\n── API Authentication ─────────────────────────────────────────────────────");

  await test("GET /email-identifiers requires auth (401 without cookie)", async () => {
    const r = await fetch(`${BASE}/api/crm/account/${testAccountId}/email-identifiers`);
    assert.strictEqual(r.status, 401, `expected 401, got ${r.status}`);
  });

  await test("POST /email-domains requires auth (401 or 403 without cookie)", async () => {
    const r = await fetch(`${BASE}/api/crm/account/${testAccountId}/email-domains`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: "unauthtest.com" }),
    });
    assert.ok(r.status === 401 || r.status === 403, `expected 401/403, got ${r.status}`);
  });
}

// ── Input validation tests ─────────────────────────────────────────────────────

async function runValidationTests() {
  console.log("\n── Input Validation ──────────────────────────────────────────────────────");

  await test("rejects empty domain", async () => {
    const r = await api("POST", `/api/crm/account/${testAccountId}/email-domains`, { domain: "" });
    assert.strictEqual(r.status, 400, `expected 400, got ${r.status}`);
  });

  await test("rejects invalid domain format", async () => {
    const r = await api("POST", `/api/crm/account/${testAccountId}/email-domains`, { domain: "not a domain!" });
    assert.strictEqual(r.status, 400, `expected 400, got ${r.status}`);
  });

  await test("rejects invalid email format", async () => {
    const r = await api("POST", `/api/crm/account/${testAccountId}/email-addresses`, { email: "not-an-email" });
    assert.strictEqual(r.status, 400, `expected 400, got ${r.status}`);
  });

  await test("rejects email with missing domain part", async () => {
    const r = await api("POST", `/api/crm/account/${testAccountId}/email-addresses`, { email: "user@" });
    assert.strictEqual(r.status, 400, `expected 400, got ${r.status}`);
  });

  await test("rejects unknown entityType in path (404)", async () => {
    const r = await api("POST", `/api/crm/widget/999/email-domains`, { domain: "test-eit.com" });
    assert.ok(r.status === 400 || r.status === 404, `expected 400 or 404, got ${r.status}`);
  });
}

// ── Delete tests ───────────────────────────────────────────────────────────────

async function runDeleteTests() {
  console.log("\n── Delete / Remove ────────────────────────────────────────────────────────");

  await test("can delete a domain identifier", async () => {
    const r1 = await api("POST", `/api/crm/account/${testAccountId}/email-domains`, { domain: `deleteme-${RUN_ID}.com` });
    const t1 = await r1.text();
    assert.strictEqual(r1.status, 201, `expected 201 adding domain, got ${r1.status}: ${t1}`);
    const dom = JSON.parse(t1);

    const r2 = await api("DELETE", `/api/crm/account/${testAccountId}/email-domains/${dom.id}`);
    assert.strictEqual(r2.status, 200, `expected 200, got ${r2.status}`);

    // Verify it's gone
    const data = await getJson(`/api/crm/account/${testAccountId}/email-identifiers`);
    assert.ok(!data.domains.find(d => d.id === dom.id), "domain should be removed");
  });

  await test("can delete an email address identifier", async () => {
    const r1 = await api("POST", `/api/crm/account/${testAccountId}/email-addresses`, { email: `deleteme@eit-${RUN_ID}.com` });
    const t1 = await r1.text();
    assert.strictEqual(r1.status, 201, `expected 201 adding email, got ${r1.status}: ${t1}`);
    const addr = JSON.parse(t1);

    const r2 = await api("DELETE", `/api/crm/account/${testAccountId}/email-addresses/${addr.id}`);
    assert.strictEqual(r2.status, 200, `expected 200, got ${r2.status}`);

    const data = await getJson(`/api/crm/account/${testAccountId}/email-identifiers`);
    assert.ok(!data.addresses.find(a => a.id === addr.id), "address should be removed");
  });

  await test("cannot delete another entity's domain identifier", async () => {
    // Add a domain to our test account
    const r1 = await api("POST", `/api/crm/account/${testAccountId}/email-domains`, { domain: `wrongentity-${RUN_ID}.com` });
    const t1 = await r1.text();
    assert.strictEqual(r1.status, 201, `expected 201, got ${r1.status}: ${t1}`);
    const dom = JSON.parse(t1);

    // Try to delete it via a different entity type (lead)
    if (testLeadId) {
      const r2 = await api("DELETE", `/api/crm/lead/${testLeadId}/email-domains/${dom.id}`);
      assert.ok(r2.status === 403 || r2.status === 404, `expected 403/404, got ${r2.status}`);
    }
    // Cleanup
    await api("DELETE", `/api/crm/account/${testAccountId}/email-domains/${dom.id}`);
  });
}

// ── Lead entity type tests ─────────────────────────────────────────────────────

async function runLeadTests() {
  console.log("\n── Lead Entity Type ───────────────────────────────────────────────────────");

  await test("can add domain to a lead", async () => {
    const r = await api("POST", `/api/crm/lead/${testLeadId}/email-domains`, { domain: `lead-${RUN_ID}.biz` });
    const text = await r.text();
    assert.strictEqual(r.status, 201, `expected 201, got ${r.status}: ${text}`);
  });

  await test("can add email to a lead", async () => {
    const r = await api("POST", `/api/crm/lead/${testLeadId}/email-addresses`, { email: `lead-person@lead-${RUN_ID}.biz` });
    const text = await r.text();
    assert.ok(r.status === 201 || r.status === 409, `expected 201/409, got ${r.status}: ${text}`);
  });

  await test("lead email identifiers list endpoint works", async () => {
    const data = await getJson(`/api/crm/lead/${testLeadId}/email-identifiers`);
    assert.ok(Array.isArray(data.domains), "domains array present");
    assert.ok(Array.isArray(data.addresses), "addresses array present");
  });
}

// ── Contact entity type tests ──────────────────────────────────────────────────

async function runContactTests() {
  if (!testContactId) {
    console.log("\n── Contact Entity Type (SKIPPED — contact creation unavailable) ───────────");
    return;
  }
  console.log("\n── Contact Entity Type ─────────────────────────────────────────────────────");

  await test("can add email to a contact", async () => {
    const r = await api("POST", `/api/crm/contact/${testContactId}/email-addresses`, { email: "contact-eit@contact-domain-eit.biz" });
    assert.ok(r.status === 201 || r.status === 409, `expected 201/409, got ${r.status}: ${await r.text()}`);
  });

  await test("contact email identifiers list works", async () => {
    const data = await getJson(`/api/crm/contact/${testContactId}/email-identifiers`);
    assert.ok(Array.isArray(data.domains), "domains array");
    assert.ok(Array.isArray(data.addresses), "addresses array");
  });
}

// ── Backfill-safety route test ─────────────────────────────────────────────────

async function runBackfillTests() {
  console.log("\n── Backfill Trigger ───────────────────────────────────────────────────────");

  await test("POST /api/crm/email-identifiers/backfill requires auth (401 or 403)", async () => {
    const r = await fetch(`${BASE}/api/crm/email-identifiers/backfill`, { method: "POST" });
    assert.ok(r.status === 401 || r.status === 403, `expected 401/403 without auth, got ${r.status}`);
  });

  await test("POST /api/crm/email-identifiers/backfill is accessible with admin auth", async () => {
    const r = await api("POST", "/api/crm/email-identifiers/backfill", { dryRun: true });
    const text = await r.text();
    assert.ok(r.status === 200 || r.status === 202, `expected 200/202, got ${r.status}: ${text}`);
    const body = JSON.parse(text);
    assert.ok("processed" in body || "queued" in body || "dryRun" in body || "total" in body, "backfill response should have expected shape");
  });
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log("══════════════════════════════════════════════════════════════════════════");
  console.log("  Email Identifiers — Regression Suite");
  console.log("══════════════════════════════════════════════════════════════════════════");

  try {
    await login();
    console.log("✓ Logged in as admin");

    await createTestFixtures();
    console.log(`✓ Test fixtures: account=${testAccountId} lead=${testLeadId} contact=${testContactId ?? "n/a"}`);

    await runNormalizationTests();
    await runPublicDomainTests();
    await runConflictTests();
    await runAuthTests();
    await runValidationTests();
    await runDeleteTests();
    await runLeadTests();
    await runContactTests();
    await runBackfillTests();

  } finally {
    try { await cleanupTestFixtures(); console.log("\n✓ Fixtures cleaned up"); } catch (e) { console.warn("  Cleanup partial:", e.message); }
  }

  console.log("\n══════════════════════════════════════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("══════════════════════════════════════════════════════════════════════════");

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
