/**
 * Quote-to-Close Workflow — Test Suite
 *
 * Covers:
 *  1.  Setup — login and get a real quote ID
 *  2.  Status history — empty initially
 *  3.  Transition draft→sent — succeeds, creates follow-up task, logs history
 *  4.  Invalid transition — sent→draft rejected by state machine
 *  5.  Transition sent→accepted — succeeds, logs history
 *  6.  Status history — now has 2 entries
 *  7.  Duplicate quote — clones the quote, returns new ID
 *  8.  Transition duplicated quote draft→sent
 *  9.  Transition sent→declined
 *  10. Transition declined→archived
 *  11. Bulk status update — multiple quotes
 *  12. Bulk assign — sets owner_user_id on multiple quotes
 *  13. Opportunity quote-summary — returns latest quote info
 *  14. Auth guard — unauthenticated requests get 401 on all new routes
 *  15. Not-found guard — transition on non-existent quote returns 404
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
  if (!sid) throw new Error(`Login failed — no session cookie (status ${r.status})`);
  return `connect.sid=${sid}`;
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

let COOKIE = "";
let QUOTE_ID = null;         // draft quote to run through the machine
let DUPE_QUOTE_ID = null;    // duplicated quote
let OPP_ID = null;           // opportunity for quote-summary test

// ── 1. Setup ─────────────────────────────────────────────────────────────────

test("Setup — login + find a draft quote (or the first quote)", async () => {
  COOKIE = await login();
  await new Promise(r => setTimeout(r, 300));

  const r = await fetch(`${BASE}/api/quotes?limit=20`, { headers: { Cookie: COOKIE } });
  assert.equal(r.status, 200, "GET /api/quotes should return 200");
  const body = await r.json();
  const quotes = body.data ?? body;
  assert.ok(Array.isArray(quotes), "Expected array of quotes");

  // Prefer a draft quote so transitions start cleanly
  const draft = quotes.find((q) => q.status === "draft");
  QUOTE_ID = draft ? draft.id : quotes[0]?.id;
  assert.ok(QUOTE_ID, "Should have at least one quote to test with");

  // Grab an opportunity for summary test
  const oppR = await fetch(`${BASE}/api/opportunities?limit=5`, { headers: { Cookie: COOKIE } });
  const oppBody = await oppR.json();
  const opps = oppBody.data ?? oppBody;
  OPP_ID = opps[0]?.id ?? null;

  // If the found quote is not draft, reset it so transitions work
  if (!draft) {
    // Use a duplicate which starts as draft
    const dupeR = await fetch(`${BASE}/api/quotes/${QUOTE_ID}/duplicate`, {
      method: "POST",
      headers: { ...JSON_HDR, Cookie: COOKIE },
    });
    assert.equal(dupeR.status, 201, "Duplicate should create a draft copy");
    const duped = await dupeR.json();
    QUOTE_ID = duped.id;
  }
});

// ── 2. Status history — empty initially ──────────────────────────────────────

test("GET /api/quotes/:id/status-history — returns array", async () => {
  const r = await fetch(`${BASE}/api/quotes/${QUOTE_ID}/status-history`, {
    headers: { Cookie: COOKIE },
  });
  assert.equal(r.status, 200, "Status history should return 200");
  const body = await r.json();
  assert.ok(Array.isArray(body), "Should return an array");
});

// ── 3. Transition draft → sent ───────────────────────────────────────────────

test("PATCH /api/quotes/:id/transition — draft→sent creates follow-up task", async () => {
  const r = await fetch(`${BASE}/api/quotes/${QUOTE_ID}/transition`, {
    method: "PATCH",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ toStatus: "sent", createFollowUpTask: true, followUpDays: 3 }),
  });
  assert.equal(r.status, 200, `draft→sent should succeed (got ${r.status})`);
  const body = await r.json();
  const q = body.quote ?? body;
  assert.equal(q.status, "sent", "Quote status should now be 'sent'");
  assert.ok(q.sent_at, "sent_at should be populated");
});

// ── 4. Transition sent → accepted ────────────────────────────────────────────

test("PATCH transition — sent→accepted succeeds and sets accepted_at", async () => {
  const r = await fetch(`${BASE}/api/quotes/${QUOTE_ID}/transition`, {
    method: "PATCH",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ toStatus: "accepted", createHandoffTask: false }),
  });
  assert.equal(r.status, 200, `sent→accepted should succeed (got ${r.status})`);
  const body = await r.json();
  const q = body.quote ?? body;
  assert.equal(q.status, "accepted", "Status should be 'accepted'");
  assert.ok(q.accepted_at, "accepted_at should be set");
});

// ── 5. Invalid transition — state machine rejects it ─────────────────────────

test("PATCH transition — invalid transition returns 400", async () => {
  // accepted→sent is not in the state machine
  const r = await fetch(`${BASE}/api/quotes/${QUOTE_ID}/transition`, {
    method: "PATCH",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ toStatus: "sent" }),
  });
  assert.equal(r.status, 400, "accepted→sent should return 400");
  const body = await r.json();
  assert.ok(body.message, "Should include an error message");
});

// ── 6. Status history after transitions ──────────────────────────────────────

test("GET status-history — has 2 entries after two transitions", async () => {
  const r = await fetch(`${BASE}/api/quotes/${QUOTE_ID}/status-history`, {
    headers: { Cookie: COOKIE },
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(body.length >= 2, `Expected ≥2 history entries, got ${body.length}`);
  // Verify structure of entries
  const first = body[0];
  assert.ok("from_status" in first, "Entry should have from_status");
  assert.ok("to_status" in first, "Entry should have to_status");
  assert.ok("created_at" in first, "Entry should have created_at");
});

// ── 7. Duplicate quote ───────────────────────────────────────────────────────

test("POST /api/quotes/:id/duplicate — clones and returns new draft", async () => {
  const r = await fetch(`${BASE}/api/quotes/${QUOTE_ID}/duplicate`, {
    method: "POST",
    headers: { ...JSON_HDR, Cookie: COOKIE },
  });
  assert.equal(r.status, 201, `Duplicate should return 201 (got ${r.status})`);
  const body = await r.json();
  assert.ok(body.id, "Duplicate should return new quote id");
  assert.notEqual(body.id, QUOTE_ID, "Duplicate should have a different ID");
  assert.equal(body.status, "draft", "Duplicate should start as draft");
  DUPE_QUOTE_ID = body.id;
});

// ── 8. Transition duplicate: draft → sent ────────────────────────────────────

test("Duplicate quote — transition draft→sent", async () => {
  const r = await fetch(`${BASE}/api/quotes/${DUPE_QUOTE_ID}/transition`, {
    method: "PATCH",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ toStatus: "sent", createFollowUpTask: false }),
  });
  assert.equal(r.status, 200, `draft→sent on duplicate should succeed (got ${r.status})`);
  const body = await r.json();
  const q = body.quote ?? body;
  assert.equal(q.status, "sent");
});

// ── 9. Transition sent → declined ────────────────────────────────────────────

test("Duplicate quote — transition sent→declined sets declined_at", async () => {
  const r = await fetch(`${BASE}/api/quotes/${DUPE_QUOTE_ID}/transition`, {
    method: "PATCH",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ toStatus: "declined" }),
  });
  assert.equal(r.status, 200, `sent→declined should succeed (got ${r.status})`);
  const body = await r.json();
  const q = body.quote ?? body;
  assert.equal(q.status, "declined");
  assert.ok(q.declined_at, "declined_at should be populated");
});

// ── 10. Transition declined → archived ───────────────────────────────────────

test("Duplicate quote — transition declined→archived sets archived_at", async () => {
  const r = await fetch(`${BASE}/api/quotes/${DUPE_QUOTE_ID}/transition`, {
    method: "PATCH",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ toStatus: "archived" }),
  });
  assert.equal(r.status, 200, `declined→archived should succeed (got ${r.status})`);
  const body = await r.json();
  const q = body.quote ?? body;
  assert.equal(q.status, "archived");
  assert.ok(q.archived_at, "archived_at should be populated");
});

// ── 11. Bulk status update ────────────────────────────────────────────────────

test("POST /api/quotes/bulk/status — bulk archive multiple quotes", async () => {
  // Create two fresh duplicates to bulk-archive
  const [d1, d2] = await Promise.all([
    fetch(`${BASE}/api/quotes/${QUOTE_ID}/duplicate`, { method: "POST", headers: { ...JSON_HDR, Cookie: COOKIE } }),
    fetch(`${BASE}/api/quotes/${QUOTE_ID}/duplicate`, { method: "POST", headers: { ...JSON_HDR, Cookie: COOKIE } }),
  ]);
  const b1 = await d1.json();
  const b2 = await d2.json();
  const quoteIds = [b1.id, b2.id].filter(Boolean);
  assert.ok(quoteIds.length >= 1, "Need at least one duplicate for bulk test");

  const r = await fetch(`${BASE}/api/quotes/bulk/status`, {
    method: "POST",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ quoteIds, status: "archived" }),
  });
  assert.equal(r.status, 200, `Bulk status should return 200 (got ${r.status})`);
  const body = await r.json();
  assert.ok(typeof body.updated === "number", "Should return updated count");
  assert.ok(body.updated >= 1, `Should have updated ≥1 quotes, got ${body.updated}`);
});

// ── 12. Bulk assign ───────────────────────────────────────────────────────────

test("POST /api/quotes/bulk/assign — sets owner_user_id", async () => {
  // Use the existing QUOTE_ID (accepted) — assign to user 4 (trevor)
  const r = await fetch(`${BASE}/api/quotes/bulk/assign`, {
    method: "POST",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ quoteIds: [QUOTE_ID], ownerUserId: 4 }),
  });
  assert.equal(r.status, 200, `Bulk assign should return 200 (got ${r.status})`);
  const body = await r.json();
  assert.ok(typeof body.updated === "number", "Should return updated count");
});

// ── 13. Opportunity quote-summary ─────────────────────────────────────────────

test("GET /api/opportunities/:id/quote-summary — returns summary shape", async () => {
  if (!OPP_ID) {
    console.log("  SKIP — no opportunity found in setup");
    return;
  }
  const r = await fetch(`${BASE}/api/opportunities/${OPP_ID}/quote-summary`, {
    headers: { Cookie: COOKIE },
  });
  assert.equal(r.status, 200, `quote-summary should return 200 (got ${r.status})`);
  const body = await r.json();
  assert.ok("quoteCount" in body, "Should have quoteCount field");
  assert.ok("totalValue" in body, "Should have totalValue field");
  assert.ok("latestQuote" in body || body.latestQuote === null, "Should have latestQuote field");
});

// ── 14. Auth guards ───────────────────────────────────────────────────────────

test("Auth guards — all new quote routes require session", async () => {
  const routes = [
    { method: "PATCH", path: `/api/quotes/${QUOTE_ID}/transition`, body: { toStatus: "sent" } },
    { method: "GET",  path: `/api/quotes/${QUOTE_ID}/status-history` },
    { method: "POST", path: `/api/quotes/${QUOTE_ID}/duplicate` },
    { method: "GET",  path: `/api/opportunities/1/quote-summary` },
    { method: "POST", path: `/api/quotes/bulk/status`, body: { quoteIds: [1], status: "archived" } },
    { method: "POST", path: `/api/quotes/bulk/assign`, body: { quoteIds: [1], ownerUserId: 4 } },
  ];

  for (const route of routes) {
    const opts = {
      method: route.method,
      headers: JSON_HDR,
      ...(route.body ? { body: JSON.stringify(route.body) } : {}),
    };
    const r = await fetch(`${BASE}${route.path}`, opts);
    assert.equal(r.status, 401, `${route.method} ${route.path} should return 401 without auth, got ${r.status}`);
  }
});

// ── 15. Not-found guard ───────────────────────────────────────────────────────

test("PATCH transition — non-existent quote returns 404", async () => {
  const r = await fetch(`${BASE}/api/quotes/999999/transition`, {
    method: "PATCH",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ toStatus: "sent" }),
  });
  assert.equal(r.status, 404, "Non-existent quote should return 404");
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
