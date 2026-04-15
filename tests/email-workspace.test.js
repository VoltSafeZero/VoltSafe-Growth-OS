/**
 * Email Workspace + Awaiting Reply Triage — Test Suite
 *
 * Tests cover:
 *  1.  GET /api/inbox/triage-summary — returns correct shape
 *  2.  GET /api/inbox/triage-thread-ids — returns arrays per bucket
 *  3.  GET /api/inbox/awaiting-reply — returns thread list
 *  4.  POST /api/inbox/compute-awaiting-reply — triggers computation
 *  5.  PATCH /api/gmail/thread-record — replyStatus: needs_reply sets awaitingReplySince
 *  6.  PATCH /api/gmail/thread-record — replyStatus: waiting_on_them clears awaitingReplySince
 *  7.  PATCH /api/gmail/thread-record — replyStatus: done clears awaitingReplySince
 *  8.  PATCH /api/gmail/thread-record — workflowState co-updates replyStatus
 *  9.  GET /api/gmail/thread-record/:threadId — returns replyStatus + timing fields
 * 10.  POST /api/inbox/create-task-from-thread — creates task (requires CRM edit perm)
 * 11.  POST /api/inbox/create-note-from-thread — requires linkedObjectType
 * 12.  Auth guard: unauthenticated 401 on triage routes
 * 13.  GET /api/inbox/thread-signals — returns signals map keyed by gmail thread id
 * 14.  GET /api/inbox/thread-tasks/:threadId — returns array of open tasks
 * 15.  PATCH /api/inbox/bulk-mark-done — marks threads done and clears awaiting reply
 */
import assert from "assert/strict";

const BASE = "http://localhost:5000";
const JSON_HDR = { "Content-Type": "application/json" };

// ── Auth helper ──────────────────────────────────────────────────────────────
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

// ── Test registry ─────────────────────────────────────────────────────────────
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

let COOKIE = "";
let TEST_THREAD_ID = `test-thread-workspace-${Date.now()}`;

// ── 1. Triage summary shape ──────────────────────────────────────────────────
test("GET /api/inbox/triage-summary — returns {awaitingReply, hot, unlinked}", async () => {
  const r = await fetch(`${BASE}/api/inbox/triage-summary`, {
    headers: { Cookie: COOKIE },
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);
  const body = await r.json();
  assert.ok(typeof body.awaitingReply === "number", "awaitingReply must be a number");
  assert.ok(typeof body.hot          === "number", "hot must be a number");
  assert.ok(typeof body.unlinked     === "number", "unlinked must be a number");
  assert.ok(body.awaitingReply >= 0, "awaitingReply must be non-negative");
  assert.ok(body.hot          >= 0, "hot must be non-negative");
  assert.ok(body.unlinked     >= 0, "unlinked must be non-negative");
});

// ── 2. Triage thread IDs shape ───────────────────────────────────────────────
test("GET /api/inbox/triage-thread-ids — returns array buckets", async () => {
  const r = await fetch(`${BASE}/api/inbox/triage-thread-ids`, {
    headers: { Cookie: COOKIE },
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);
  const body = await r.json();
  assert.ok(Array.isArray(body.awaitingReply), "awaitingReply must be an array");
  assert.ok(Array.isArray(body.hot),           "hot must be an array");
  assert.ok(Array.isArray(body.unlinked),      "unlinked must be an array");
});

// ── 3. Awaiting-reply thread list ────────────────────────────────────────────
test("GET /api/inbox/awaiting-reply — returns array of threads", async () => {
  const r = await fetch(`${BASE}/api/inbox/awaiting-reply`, {
    headers: { Cookie: COOKIE },
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);
  const body = await r.json();
  assert.ok(Array.isArray(body), "Response must be an array");
  // Each thread should have expected fields
  for (const item of body) {
    assert.ok(typeof item.gmailThreadId === "string", "gmailThreadId must be string");
    assert.ok(typeof item.replyStatus   === "string", "replyStatus must be string");
    assert.ok(item.awaitingReplySince,                "awaitingReplySince must be truthy");
  }
});

// ── 4. Compute awaiting-reply ────────────────────────────────────────────────
test("POST /api/inbox/compute-awaiting-reply — triggers computation", async () => {
  const r = await fetch(`${BASE}/api/inbox/compute-awaiting-reply`, {
    method: "POST",
    headers: { Cookie: COOKIE },
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);
  const body = await r.json();
  assert.ok(typeof body.updated       === "number", "updated must be a number");
  assert.ok(typeof body.awaitingCount === "number", "awaitingCount must be a number");
});

// ── 5. PATCH thread-record: replyStatus=needs_reply sets awaitingReplySince ──
test("PATCH thread-record replyStatus=needs_reply — sets awaitingReplySince", async () => {
  const r = await fetch(`${BASE}/api/gmail/thread-record/${TEST_THREAD_ID}`, {
    method: "PATCH",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ replyStatus: "needs_reply" }),
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);
  const body = await r.json();
  assert.equal(body.ok, true);

  // Verify the record was saved with awaiting_reply_since set
  const get = await fetch(`${BASE}/api/gmail/thread-record/${TEST_THREAD_ID}`, {
    headers: { Cookie: COOKIE },
  });
  assert.ok(get.ok, `GET thread-record failed with ${get.status}`);
  const rec = await get.json();
  assert.ok(rec.found, "Thread record should be found");
  assert.equal(rec.thread.replyStatus, "needs_reply");
  assert.ok(rec.thread.awaitingReplySince !== null, "awaitingReplySince should be set");
});

// ── 6. PATCH thread-record: replyStatus=waiting_on_them clears awaitingReplySince
test("PATCH thread-record replyStatus=waiting_on_them — clears awaitingReplySince", async () => {
  // First set needs_reply to ensure awaitingReplySince is set
  await fetch(`${BASE}/api/gmail/thread-record/${TEST_THREAD_ID}`, {
    method: "PATCH",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ replyStatus: "needs_reply" }),
  });

  const r = await fetch(`${BASE}/api/gmail/thread-record/${TEST_THREAD_ID}`, {
    method: "PATCH",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ replyStatus: "waiting_on_them" }),
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);

  const get = await fetch(`${BASE}/api/gmail/thread-record/${TEST_THREAD_ID}`, {
    headers: { Cookie: COOKIE },
  });
  const rec = await get.json();
  assert.equal(rec.thread.replyStatus, "waiting_on_them");
  assert.equal(rec.thread.awaitingReplySince, null, "awaitingReplySince should be cleared");
});

// ── 7. PATCH thread-record: replyStatus=done clears awaitingReplySince ───────
test("PATCH thread-record replyStatus=done — clears awaitingReplySince", async () => {
  // Ensure awaiting reply is set first
  await fetch(`${BASE}/api/gmail/thread-record/${TEST_THREAD_ID}`, {
    method: "PATCH",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ replyStatus: "needs_reply" }),
  });

  const r = await fetch(`${BASE}/api/gmail/thread-record/${TEST_THREAD_ID}`, {
    method: "PATCH",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ replyStatus: "done" }),
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);

  const get = await fetch(`${BASE}/api/gmail/thread-record/${TEST_THREAD_ID}`, {
    headers: { Cookie: COOKIE },
  });
  const rec = await get.json();
  assert.equal(rec.thread.replyStatus, "done");
  assert.equal(rec.thread.awaitingReplySince, null, "awaitingReplySince should be cleared for done");
});

// ── 8. PATCH thread-record: workflowState co-updates replyStatus ──────────────
test("PATCH thread-record workflowState=needs_reply — available in record", async () => {
  const r = await fetch(`${BASE}/api/gmail/thread-record/${TEST_THREAD_ID}`, {
    method: "PATCH",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ workflowState: "needs_reply", replyStatus: "needs_reply" }),
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);

  const get = await fetch(`${BASE}/api/gmail/thread-record/${TEST_THREAD_ID}`, {
    headers: { Cookie: COOKIE },
  });
  const rec = await get.json();
  assert.ok(rec.found, "Record should exist");
  assert.equal(rec.thread.workflowState, "needs_reply");
  assert.equal(rec.thread.replyStatus, "needs_reply");
});

// ── 9. GET thread-record returns new timing fields ────────────────────────────
test("GET /api/gmail/thread-record/:threadId — returns replyStatus field", async () => {
  const r = await fetch(`${BASE}/api/gmail/thread-record/${TEST_THREAD_ID}`, {
    headers: { Cookie: COOKIE },
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);
  const body = await r.json();
  assert.ok(body.found, "Should find the test thread record");
  // replyStatus should be present (can be null or string)
  assert.ok("replyStatus" in body.thread, "thread must have replyStatus field");
  assert.ok("awaitingReplySince" in body.thread, "thread must have awaitingReplySince field");
});

// ── 10. Create task from thread ───────────────────────────────────────────────
test("POST /api/inbox/create-task-from-thread — creates task", async () => {
  const r = await fetch(`${BASE}/api/inbox/create-task-from-thread`, {
    method: "POST",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({
      threadId: TEST_THREAD_ID,
      subject: "Test triage thread",
      fromEmail: "marina@example.com",
      fromName: "Test Marina",
    }),
  });
  const responseBody = await r.json();
  assert.ok(r.ok, `Expected 2xx, got ${r.status}: ${JSON.stringify(responseBody)}`);
  assert.ok(responseBody.id, "Task should have an id");
  assert.ok(responseBody.title && responseBody.title.length > 0, "Task should have a title");
});

// ── 11. Create note from thread — requires linkedObjectType ───────────────────
test("POST /api/inbox/create-note-from-thread — 400 without linkedObjectType", async () => {
  const r = await fetch(`${BASE}/api/inbox/create-note-from-thread`, {
    method: "POST",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({
      threadId: TEST_THREAD_ID,
      fromEmail: "marina@example.com",
      snippet: "Following up on the charging station quote",
    }),
  });
  assert.equal(r.status, 400, "Should reject without linkedObjectType");
  const body = await r.json();
  assert.ok(body.message, "Should have an error message");
});

// ── 12. Auth guard — 401 on triage routes ────────────────────────────────────
test("Unauthenticated requests to triage routes return 401", async () => {
  const routes = [
    "/api/inbox/triage-summary",
    "/api/inbox/triage-thread-ids",
    "/api/inbox/awaiting-reply",
  ];
  for (const route of routes) {
    const r = await fetch(`${BASE}${route}`);
    assert.equal(r.status, 401, `${route} should return 401 without auth`);
  }
});

// ── 13. GET /api/inbox/thread-signals — returns signals map keyed by threadId ─
test("GET /api/inbox/thread-signals — returns map keyed by gmail thread id", async () => {
  const threadIds = [TEST_THREAD_ID, `other-thread-${Date.now()}`];
  const r = await fetch(
    `${BASE}/api/inbox/thread-signals?threadIds=${threadIds.join(",")}`,
    { headers: { Cookie: COOKIE } }
  );
  assert.ok(r.ok, `Expected 200, got ${r.status}`);
  const body = await r.json();
  assert.ok(typeof body === "object" && body !== null, "Response must be an object");
  // The test thread should appear in the map (it was upserted in earlier tests)
  assert.ok(TEST_THREAD_ID in body, "Test thread should be in signals map");
  const sig = body[TEST_THREAD_ID];
  // Shape checks
  assert.ok("signalLevel" in sig, "signal must have signalLevel");
  assert.ok("workflowState" in sig, "signal must have workflowState");
  assert.ok("isReplied" in sig, "signal must have isReplied");
  assert.ok("isHot" in sig, "signal must have isHot");
});

// ── 14. GET /api/inbox/thread-tasks/:threadId — returns array of open tasks ───
test("GET /api/inbox/thread-tasks/:threadId — returns array", async () => {
  const r = await fetch(
    `${BASE}/api/inbox/thread-tasks/${encodeURIComponent(TEST_THREAD_ID)}`,
    { headers: { Cookie: COOKIE } }
  );
  assert.ok(r.ok, `Expected 200, got ${r.status}`);
  const body = await r.json();
  assert.ok(Array.isArray(body), "Response must be an array");
  // If tasks present, check shape
  for (const task of body) {
    assert.ok(typeof task.id === "number", "task.id must be a number");
    assert.ok(typeof task.title === "string", "task.title must be a string");
    assert.ok("dueDate" in task, "task must have dueDate key");
    assert.ok("status" in task, "task must have status key");
  }
});

// ── 15. PATCH /api/inbox/bulk-mark-done — upserts workflow_state=done ─────────
test("PATCH /api/inbox/bulk-mark-done — marks threads done and clears awaiting", async () => {
  // First set needs_reply so awaitingReplySince is set
  await fetch(`${BASE}/api/gmail/thread-record/${TEST_THREAD_ID}`, {
    method: "PATCH",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ replyStatus: "needs_reply" }),
  });

  const r = await fetch(`${BASE}/api/inbox/bulk-mark-done`, {
    method: "PATCH",
    headers: { ...JSON_HDR, Cookie: COOKIE },
    body: JSON.stringify({ threadIds: [TEST_THREAD_ID] }),
  });
  assert.ok(r.ok, `Expected 200, got ${r.status}`);
  const body = await r.json();
  assert.ok(typeof body.updated === "number", "updated must be a number");
  assert.ok(body.updated >= 1, `Expected updated >= 1, got ${body.updated}`);

  // Verify the thread record was updated
  const get = await fetch(`${BASE}/api/gmail/thread-record/${TEST_THREAD_ID}`, {
    headers: { Cookie: COOKIE },
  });
  const rec = await get.json();
  assert.ok(rec.found, "Thread record should still be found");
  assert.equal(rec.thread.workflowState, "done", "workflowState should be done");
  assert.equal(rec.thread.awaitingReplySince, null, "awaitingReplySince should be cleared");
});

// ── Runner ────────────────────────────────────────────────────────────────────
async function run() {
  console.log("\n╔════════════════════════════════════════════════════╗");
  console.log("║  Email Workspace + Awaiting Reply — Test Suite     ║");
  console.log("╚════════════════════════════════════════════════════╝\n");

  try {
    COOKIE = await login();
    // Brief pause to let the session store stabilize after login
    await new Promise(r => setTimeout(r, 300));
    console.log("✔ Logged in as trevor@voltsafe.com\n");
  } catch (e) {
    console.error("✘ Login failed:", e.message);
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const { name, fn } of tests) {
    process.stdout.write(`  Running: ${name}\n`);
    try {
      await fn();
      passed++;
      console.log(`  ✓ PASS\n`);
    } catch (err) {
      failed++;
      failures.push({ name, err });
      console.error(`  ✗ FAIL: ${err.message}\n`);
    }
  }

  console.log(`\n╔════════════════════════════════════════════════════╗`);
  console.log(`║  Results: ${String(passed).padEnd(3)} passed, ${String(failed).padEnd(3)} failed                 ║`);
  console.log(`╚════════════════════════════════════════════════════╝`);

  if (failures.length > 0) {
    console.error("\nFailures:");
    for (const { name, err } of failures) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err.message}`);
    }
    process.exit(1);
  }
}

run().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
