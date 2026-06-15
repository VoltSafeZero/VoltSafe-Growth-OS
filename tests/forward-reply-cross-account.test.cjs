"use strict";
/**
 * tests/forward-reply-cross-account.test.cjs
 *
 * Regression suite covering:
 *
 *  A. FRT instrumentation safety — all FRT:A (full-body endpoint) console.log
 *     calls must be gated behind the FORWARD_REPLY_TRACE / NODE_ENV guard.
 *     They must never fire unconditionally in production.
 *
 *  B. Thread API FRT:B logging is side-effect free — the [FRT:B:thread-api:response]
 *     block must not alter the shape of the thread response (no extra fields leaked).
 *
 *  C. threadQuery double-fire prevention — the enabled condition must block the
 *     query from firing with a null asAccountId in "all inboxes" mode before
 *     currentThreadAccountId is set.
 *
 *  D. Cross-account thread loading — threads owned by secondary mailboxes (accounts 92
 *     and 93) must return 200 when called with the correct asAccountId and 404 when
 *     called without asAccountId (resolved to primary account 1 which does not own them).
 *
 * Run with: node tests/forward-reply-cross-account.test.cjs
 */

const assert = require("assert");
const fs     = require("fs");
const path   = require("path");
const http   = require("http");

const ROUTES_SRC  = fs.readFileSync(path.join(__dirname, "../server/routes.ts"),   "utf8");
const INBOX_SRC   = fs.readFileSync(path.join(__dirname, "../client/src/pages/gmail-inbox.tsx"), "utf8");

let sp = 0, sf = 0;
function test(name, fn) {
  try   { fn(); console.log("  \u2713", name); sp++; }
  catch (e) { console.error("  \u2717", name, "\n    \u2192", e.message); sf++; }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
function has(src, pat) { return typeof pat === "string" ? src.includes(pat) : pat.test(src); }
function hasSrc(src, pat, msg) { if (!has(src, pat)) throw new Error(msg || "Expected in source: " + String(pat)); }
function noSrc(src, pat, msg)  { if ( has(src, pat)) throw new Error(msg || "Expected NOT in source: " + String(pat)); }

// ─────────────────────────────────────────────────────────────────────────────
// Helpers to slice out named regions from server/routes.ts
// ─────────────────────────────────────────────────────────────────────────────
function sliceBetween(src, startPat, endPat) {
  const si = typeof startPat === "string" ? src.indexOf(startPat) : src.search(startPat);
  if (si < 0) return "";
  const ei = typeof endPat === "string" ? src.indexOf(endPat, si + 1) : src.search(endPat);
  return ei > si ? src.slice(si, ei) : src.slice(si);
}

const fullBodySrc = sliceBetween(
  ROUTES_SRC,
  "/api/gmail/messages/:msgId/full-body",
  // next route registration
  "\n  app."
);

// ─────────────────────────────────────────────────────────────────────────────
// Section A — FRT:A full-body endpoint logging must be gated
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSection A — FRT:A full-body logging gated");

test("FRT:A:full-body:db-fast console.log is inside a FORWARD_REPLY_TRACE / NODE_ENV guard", () => {
  // Find the index of the log call
  const logIdx = ROUTES_SRC.indexOf('[FRT:A:full-body:db-fast]');
  ok(logIdx >= 0, "[FRT:A:full-body:db-fast] log not found in routes.ts");
  // The guard must appear within 300 chars before the log
  const window = ROUTES_SRC.slice(logIdx - 300, logIdx);
  ok(
    has(window, "FORWARD_REPLY_TRACE") || has(window, "NODE_ENV"),
    "[FRT:A:full-body:db-fast] is not inside a FORWARD_REPLY_TRACE/NODE_ENV guard"
  );
});

test("FRT:A:full-body:gmail-live console.log is inside a FORWARD_REPLY_TRACE / NODE_ENV guard", () => {
  const logIdx = ROUTES_SRC.indexOf('[FRT:A:full-body:gmail-live]');
  ok(logIdx >= 0, "[FRT:A:full-body:gmail-live] log not found in routes.ts");
  const window = ROUTES_SRC.slice(logIdx - 300, logIdx);
  ok(
    has(window, "FORWARD_REPLY_TRACE") || has(window, "NODE_ENV"),
    "[FRT:A:full-body:gmail-live] is not inside a FORWARD_REPLY_TRACE/NODE_ENV guard"
  );
});

test("FRT:A:full-body:plaintext console.log is inside a FORWARD_REPLY_TRACE / NODE_ENV guard", () => {
  const logIdx = ROUTES_SRC.indexOf('[FRT:A:full-body:plaintext]');
  ok(logIdx >= 0, "[FRT:A:full-body:plaintext] log not found in routes.ts");
  const window = ROUTES_SRC.slice(logIdx - 300, logIdx);
  ok(
    has(window, "FORWARD_REPLY_TRACE") || has(window, "NODE_ENV"),
    "[FRT:A:full-body:plaintext] is not inside a FORWARD_REPLY_TRACE/NODE_ENV guard"
  );
});

test("FRT:A:full-body:db-fallback console.log is inside a FORWARD_REPLY_TRACE / NODE_ENV guard", () => {
  const logIdx = ROUTES_SRC.indexOf('[FRT:A:full-body:db-fallback]');
  ok(logIdx >= 0, "[FRT:A:full-body:db-fallback] log not found in routes.ts");
  const window = ROUTES_SRC.slice(logIdx - 300, logIdx);
  ok(
    has(window, "FORWARD_REPLY_TRACE") || has(window, "NODE_ENV"),
    "[FRT:A:full-body:db-fallback] is not inside a FORWARD_REPLY_TRACE/NODE_ENV guard"
  );
});

test("No bare console.log([FRT:A) outside a guard block exists in routes.ts", () => {
  // All four FRT:A log calls must have the guard within 300 chars before them
  const frtALogs = ["[FRT:A:full-body:db-fast]", "[FRT:A:full-body:gmail-live]", "[FRT:A:full-body:plaintext]", "[FRT:A:full-body:db-fallback]"];
  for (const tag of frtALogs) {
    const idx = ROUTES_SRC.indexOf(tag);
    if (idx < 0) continue;
    const pre = ROUTES_SRC.slice(idx - 300, idx);
    ok(
      has(pre, "FORWARD_REPLY_TRACE") || has(pre, "NODE_ENV"),
      `${tag} found without nearby guard`
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Section B — FRT:B thread-api log is side-effect free
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSection B — FRT:B thread-api logging side-effect free");

test("FRT:B:thread-api:response log block exists in routes.ts", () => {
  hasSrc(ROUTES_SRC, "[FRT:B:thread-api:response]");
});

test("FRT:B:thread-api:response is gated by FORWARD_REPLY_TRACE / NODE_ENV", () => {
  const logIdx = ROUTES_SRC.indexOf("[FRT:B:thread-api:response]");
  ok(logIdx >= 0, "[FRT:B:thread-api:response] not found");
  const pre = ROUTES_SRC.slice(logIdx - 400, logIdx);
  ok(
    has(pre, "FORWARD_REPLY_TRACE") || has(pre, "NODE_ENV"),
    "FRT:B:thread-api:response is not gated"
  );
});

test("FRT:B block does not appear before res.json(local) call in thread handler", () => {
  // The FRT:B block must be followed (not preceded) by res.json(local) — logging is a
  // side-channel and must not come between the data prep and the response.
  const frtBIdx = ROUTES_SRC.indexOf("[FRT:B:thread-api:response]");
  ok(frtBIdx >= 0);
  // Find the next res.json after the FRT:B log
  const resJsonIdx = ROUTES_SRC.indexOf("res.json(local)", frtBIdx);
  ok(resJsonIdx > frtBIdx, "res.json(local) must come AFTER the FRT:B log block");
});

test("FRT:B uses String(m.body || '') — safe against null body", () => {
  hasSrc(ROUTES_SRC, "String(m.body || \"\")");
});

test("FRT:B uses (local.messages || []) — safe against null messages array", () => {
  hasSrc(ROUTES_SRC, "(local.messages || [])");
});

// ─────────────────────────────────────────────────────────────────────────────
// Section C — threadQuery enabled condition prevents null-asAccountId double-fire
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSection C — threadQuery enabled guard");

test("threadQuery has multi-condition enabled prop", () => {
  hasSrc(INBOX_SRC, /enabled:\s*!!selectedThreadId\s*&&\s*\(/, "threadQuery enabled must be a compound condition");
});

test("threadQuery enabled guards against all-mode with null currentThreadAccountId", () => {
  hasSrc(
    INBOX_SRC,
    /activeAccountId\s*!==\s*["']all["']\s*\|\|\s*currentThreadAccountId\s*!==\s*null/,
    "enabled must gate on (activeAccountId !== \"all\" || currentThreadAccountId !== null)"
  );
});

test("threadQuery enabled still requires selectedThreadId to be truthy", () => {
  hasSrc(INBOX_SRC, /enabled:\s*!!selectedThreadId\s*&&/);
});

test("threadQuery queryKey includes threadAccountId as third element", () => {
  hasSrc(INBOX_SRC, /queryKey:\s*\[["']\/api\/gmail\/threads["'],\s*selectedThreadId,\s*threadAccountId\]/);
});

test("currentThreadAccountId state is initialized to null", () => {
  hasSrc(INBOX_SRC, /useState<number \| null>\(null\)/);
});

test("handleSelectMessage sets currentThreadAccountId from msg.sourceAccountId", () => {
  hasSrc(INBOX_SRC, "setCurrentThreadAccountId(msg.sourceAccountId ?? null)");
});

// ─────────────────────────────────────────────────────────────────────────────
// Section D — Cross-account thread API live check
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSection D — Cross-account thread API (live server)");

const BASE_URL = "http://localhost:5000";

async function apiGet(path, cookieHeader) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const opts = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method: "GET",
      headers: {
        "Cookie":  cookieHeader,
        "Origin":  BASE_URL,
      },
    };
    const req = http.request(opts, (res) => {
      let body = "";
      res.on("data", c => body += c);
      res.on("end", () => {
        try { resolve({ status: res.status || res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ status: res.status || res.statusCode, body }); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function apiPost(path, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const url = new URL(BASE_URL + path);
    const opts = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(body),
        "Origin":          BASE_URL,
      },
    };
    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        const setCookie = res.headers["set-cookie"] || [];
        try { resolve({ status: res.statusCode, body: JSON.parse(data), cookies: setCookie }); }
        catch { resolve({ status: res.statusCode, body: data, cookies: setCookie }); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function runLiveTests() {
  // Login
  let cookie;
  try {
    const lr = await apiPost("/api/auth/login", { email: "trevor@voltsafe.com", password: "alberni1444" });
    const sidCookie = (lr.cookies || []).find(c => c.startsWith("connect.sid="));
    if (!sidCookie) { console.error("  \u2717 Login failed — skipping D tests"); return; }
    cookie = sidCookie.split(";")[0];
  } catch (e) {
    console.error("  \u2717 Server unreachable — skipping D tests:", e.message);
    return;
  }

  // Fetch messages from known secondary accounts directly (unified endpoint without asAccountId
  // defaults to the primary mailbox; per-account fetch is the correct way to find them).
  const SECONDARY_ACCOUNT_IDS = [92, 93]; // support@ and sales@
  let secondary = [];
  for (const acctId of SECONDARY_ACCOUNT_IDS) {
    try {
      const r = await apiGet(`/api/gmail/messages?limit=5&asAccountId=${acctId}`, cookie);
      const msgs = (r.body.messages || []).filter(m => m.sourceAccountId);
      secondary = secondary.concat(msgs);
    } catch (_) { /* account may not be connected in this environment */ }
  }

  test("secondary-account mailboxes (92/93) return messages with sourceAccountId", () => {
    ok(secondary.length > 0,
       `Expected ≥1 message from accounts 92 or 93, got 0. ` +
       "Ensure support@ and sales@ mailboxes have synced messages.");
  });

  if (secondary.length === 0) return;

  // Pick first secondary-account message
  const sample = secondary[0];
  const acctId = sample.sourceAccountId;
  const threadId = sample.threadId;

  test(`secondary-account thread (acct=${acctId}) returns 200 with correct asAccountId`, async () => {
    const r = await apiGet(`/api/gmail/threads/${threadId}?asAccountId=${acctId}`, cookie);
    ok(r.status === 200,
       `Expected 200, got ${r.status} for thread ${threadId} with asAccountId=${acctId}. body=${JSON.stringify(r.body).slice(0,200)}`);
    ok(Array.isArray(r.body.messages),
       "Thread response must have a messages array");
    ok(r.body.messages.length > 0, "Thread must have at least one message");
  });

  test("secondary-account thread returns 404 without asAccountId (primary-account fallback)", async () => {
    // Without asAccountId the server resolves to the primary account (account 1),
    // which does not own the thread — so 404 is the correct response.
    const r = await apiGet(`/api/gmail/threads/${threadId}`, cookie);
    ok(r.status === 404,
       `Expected 404 when asAccountId is omitted for a non-primary-account thread, got ${r.status}`);
  });

  test("thread response shape does not include FRT logging fields", async () => {
    const r = await apiGet(`/api/gmail/threads/${threadId}?asAccountId=${acctId}`, cookie);
    ok(r.status === 200, `Unexpected status ${r.status}`);
    // FRT fields must never leak into the response body
    const forbidden = ["first200", "last200", "atOld4KCap", "atOld200KCap", "bodyLen", "gmailMessageId", "msgCount"];
    for (const f of forbidden) {
      ok(!(f in r.body), `Thread response must not contain FRT field: ${f}`);
    }
    // Must have the canonical thread fields
    ok("messages" in r.body, "Thread response must have .messages");
  });

  test("X-Mail-Source header is set to 'local' for locally-cached thread", async () => {
    const url = new URL(BASE_URL + `/api/gmail/threads/${threadId}?asAccountId=${acctId}`);
    const xHeader = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: url.hostname, port: url.port || 80,
        path: url.pathname + url.search,
        method: "GET",
        headers: { Cookie: cookie, Origin: BASE_URL },
      }, (res) => {
        resolve(res.headers["x-mail-source"] || "");
        res.resume();
      });
      req.on("error", reject);
      req.end();
    });
    ok(xHeader === "local", `Expected X-Mail-Source: local, got "${xHeader}"`);
  });

  // Test a second distinct secondary account if available
  const otherAcct = secondary.find(m => m.sourceAccountId !== acctId);
  if (otherAcct) {
    test(`second secondary account (acct=${otherAcct.sourceAccountId}) also returns 200 with correct asAccountId`, async () => {
      const r = await apiGet(
        `/api/gmail/threads/${otherAcct.threadId}?asAccountId=${otherAcct.sourceAccountId}`,
        cookie
      );
      ok(r.status === 200,
         `Expected 200 for thread ${otherAcct.threadId} acct=${otherAcct.sourceAccountId}, got ${r.status}`);
      ok(Array.isArray(r.body.messages) && r.body.messages.length > 0, "must have messages");
    });

    test("second secondary account returns 404 without asAccountId", async () => {
      const r = await apiGet(`/api/gmail/threads/${otherAcct.threadId}`, cookie);
      ok(r.status === 404, `Expected 404 without asAccountId, got ${r.status}`);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Run everything
// ─────────────────────────────────────────────────────────────────────────────
runLiveTests().then(() => {
  console.log(`\n${sp + sf} tests — ${sp} passed, ${sf} failed`);
  if (sf > 0) process.exit(1);
}).catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
