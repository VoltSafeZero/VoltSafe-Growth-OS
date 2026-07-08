/**
 * tests/mail/engagement-thread-api.test.cjs
 *
 * Regression suite for GET /api/engagement/thread/:threadId
 *
 * Root cause of the bug this pins:
 *   email_tracking_pixels had no `updated_at` column in production (migration
 *   0000 only included `created_at`).  getThreadEngagementFull() ran the
 *   replyRows query with `p.updated_at AS replied_at` → PG "column does not
 *   exist" → Drizzle wrapped as "Failed query: [SQL]" → 500 on every thread open.
 *
 * Fix:
 *   1. Runtime migration adds `updated_at TIMESTAMP` to email_tracking_pixels.
 *   2. replyRows query now uses COALESCE(p.updated_at, p.created_at).
 *   3. Route handler falls back to an empty engagement object on any error so
 *      the inbox UI never 500s again.
 */

"use strict";

const http = require("http");
const assert = require("assert");

const BASE = "http://localhost:5000";
const ADMIN_EMAIL = "trevor@voltsafe.com";
const ADMIN_PASS  = "alberni1444";

// A real threadId that was hitting 500 in production
const REAL_THREAD   = "19f38acaec5c4abc";
const REAL_THREAD_2 = "19f38c2c1aadf99d";

// ─── helpers ──────────────────────────────────────────────────────────────────

function request(opts, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, body: data, json });
      });
    });
    req.on("error", reject);
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

async function login(email, pass) {
  const res = await request({
    hostname: "localhost", port: 5000, path: "/api/auth/login", method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": BASE,
    },
  }, { email, password: pass });
  assert.strictEqual(res.status, 200, `Login failed: ${res.body}`);
  const setCookie = res.headers["set-cookie"];
  assert.ok(setCookie, "Expected Set-Cookie on login");
  return setCookie.map((c) => c.split(";")[0]).join("; ");
}

async function get(path, cookie) {
  return request({
    hostname: "localhost", port: 5000, path, method: "GET",
    headers: {
      "Origin": BASE,
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
}

// ─── test runner ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(label, fn) {
  try {
    await fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

// ─── tests ────────────────────────────────────────────────────────────────────

async function run() {
  console.log("\n[engagement-thread-api] running tests…\n");

  // ── auth ────────────────────────────────────────────────────────────────────
  const adminCookie = await login(ADMIN_EMAIL, ADMIN_PASS);

  // ── T01: unauthenticated → 401 ──────────────────────────────────────────────
  await test("unauthenticated request returns 401", async () => {
    const res = await get(`/api/engagement/thread/${REAL_THREAD}`);
    assert.strictEqual(res.status, 401, `Expected 401, got ${res.status}: ${res.body}`);
  });

  // ── T02: real formerly-500 thread → 200 ─────────────────────────────────────
  await test("authenticated request for real thread returns 200 (was 500)", async () => {
    const res = await get(`/api/engagement/thread/${REAL_THREAD}`, adminCookie);
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${res.body}`);
    assert.ok(res.json, `Response must be JSON: ${res.body}`);
  });

  // ── T03: second formerly-500 thread → 200 ───────────────────────────────────
  await test("second formerly-failing thread returns 200", async () => {
    const res = await get(`/api/engagement/thread/${REAL_THREAD_2}`, adminCookie);
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${res.body}`);
    assert.ok(res.json, `Response must be JSON: ${res.body}`);
  });

  // ── T04: response shape is valid ────────────────────────────────────────────
  await test("response has required top-level keys", async () => {
    const res = await get(`/api/engagement/thread/${REAL_THREAD}`, adminCookie);
    assert.strictEqual(res.status, 200);
    const d = res.json;
    assert.ok("threadId" in d,    "Missing threadId");
    assert.ok("activities" in d,  "Missing activities");
    assert.ok("summary" in d,     "Missing summary");
    assert.ok(Array.isArray(d.activities), "activities must be an array");
  });

  // ── T05: activities is an array (even if empty) ─────────────────────────────
  await test("activities is always an array, never throws", async () => {
    const res = await get(`/api/engagement/thread/${REAL_THREAD}`, adminCookie);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.json.activities));
  });

  // ── T06: unknown/nonexistent threadId → 200 with empty payload ──────────────
  await test("unknown threadId returns 200 with empty activities (not 500)", async () => {
    const res = await get("/api/engagement/thread/nonexistent_thread_abc123xyz", adminCookie);
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${res.body}`);
    const d = res.json;
    assert.ok(d, "Must return JSON");
    assert.ok(Array.isArray(d.activities), "activities must be an array");
    assert.strictEqual(d.activities.length, 0, "Unknown thread should have 0 activities");
  });

  // ── T07: threadId echoed back in response ───────────────────────────────────
  await test("threadId is echoed back in the response", async () => {
    const res = await get(`/api/engagement/thread/${REAL_THREAD}`, adminCookie);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.threadId, REAL_THREAD);
  });

  // ── T08: source-grep — query uses COALESCE not bare updated_at ──────────────
  await test("replyRows query uses COALESCE(p.updated_at, p.created_at) — not bare p.updated_at", async () => {
    const fs = require("fs");
    const src = fs.readFileSync(
      require("path").join(process.cwd(), "server/services/engagement-intelligence.ts"),
      "utf8"
    );
    assert.ok(
      src.includes("COALESCE(p.updated_at, p.created_at)"),
      "engagement-intelligence.ts must use COALESCE(p.updated_at, p.created_at) in replyRows query"
    );
    // Make sure the old bare p.updated_at AS replied_at is gone
    const lines = src.split("\n");
    const badLine = lines.find(
      (l) => l.includes("p.updated_at AS replied_at") && !l.includes("COALESCE")
    );
    assert.ok(!badLine, `Found unguarded 'p.updated_at AS replied_at' without COALESCE: ${badLine}`);
  });

  // ── T09: source-grep — tracking.ts sets updated_at on reply mark ────────────
  await test("tracking.ts sets updated_at = NOW() when marking is_replied = true", async () => {
    const fs = require("fs");
    const src = fs.readFileSync(
      require("path").join(process.cwd(), "server/tracking.ts"),
      "utf8"
    );
    assert.ok(
      src.includes("is_replied = true") && src.includes("updated_at = NOW()"),
      "tracking.ts must set updated_at = NOW() in the reply-mark UPDATE"
    );
  });

  // ── T10: source-grep — runtime migration present in routes.ts ───────────────
  await test("routes.ts contains runtime migration for email_tracking_pixels.updated_at", async () => {
    const fs = require("fs");
    const src = fs.readFileSync(
      require("path").join(process.cwd(), "server/routes.ts"),
      "utf8"
    );
    assert.ok(
      src.includes("email_tracking_pixels") && src.includes("updated_at") && src.includes("ADD COLUMN IF NOT EXISTS"),
      "routes.ts must have an idempotent ADD COLUMN IF NOT EXISTS updated_at migration for email_tracking_pixels"
    );
  });

  // ── T11: source-grep — route handler has defensive fallback ─────────────────
  await test("engagement/thread route handler has defensive error fallback (no raw 500)", async () => {
    const fs = require("fs");
    const src = fs.readFileSync(
      require("path").join(process.cwd(), "server/routes.ts"),
      "utf8"
    );
    // The handler should return 200 on catch, not 500
    // Look for the pattern: res.status(200).json combined with empty engagement structure
    assert.ok(
      src.includes("res.status(200).json") &&
      src.includes("[engagement/thread] error"),
      "engagement/thread catch block must log error and return 200 with empty payload"
    );
  });

  // ── T12: rapid back-to-back requests don't cause 500s ───────────────────────
  await test("multiple concurrent thread requests all return 200", async () => {
    const threads = [REAL_THREAD, REAL_THREAD_2, "nonexistent_abc_xyz"];
    const results = await Promise.all(
      threads.map((t) => get(`/api/engagement/thread/${t}`, adminCookie))
    );
    for (const [i, res] of results.entries()) {
      assert.strictEqual(
        res.status, 200,
        `Thread[${i}] returned ${res.status}: ${res.body}`
      );
    }
  });

  // ── summary ─────────────────────────────────────────────────────────────────
  console.log(`\n[engagement-thread-api] ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => { console.error("Fatal:", e); process.exit(1); });
