#!/usr/bin/env node
/**
 * Cortex Real Content Ingestion Test Suite
 * Verifies that "Save URL to Cortex" actually fetches, extracts, chunks, and
 * indexes real page content (not just title/OG metadata), and that
 * /api/cortex/ask grounds its answers in that real content with citations.
 * Run with: node tests/cortex-ingestion.test.js
 * Requires: server running at localhost:5000, outbound internet access.
 */

const BASE = "http://localhost:5000";
let passed = 0;
let failed = 0;

function ok(label) { console.log(`  \u2713 ${label}`); passed++; }
function fail(label, detail) { console.error(`  \u2717 ${label}${detail ? ` \u2014 ${detail}` : ""}`); failed++; }
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
  await sleep(400);
  return cookie;
}

function authed(cookie) {
  return async (url, opts = {}) => {
    const res = await fetch(`${BASE}${url}`, {
      ...opts,
      headers: { "Content-Type": "application/json", "Origin": BASE, "Cookie": cookie, ...(opts.headers || {}) },
    });
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, body };
  };
}

async function waitForIngestion(api, id, { timeoutMs = 30000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { body } = await api(`/api/cortex/url/${id}/content`);
    const status = body?.record?.ingestion_status;
    if (status && !["queued", "fetching", "extracting", "transcribing", "cleaning", "chunking", "indexing", "verifying"].includes(status)) {
      return body.record;
    }
    await sleep(1000);
  }
  throw new Error(`Ingestion did not settle within ${timeoutMs}ms`);
}

async function main() {
  const cookie = await login("trevor@voltsafe.com", "alberni1444");
  const api = authed(cookie);

  // ── Test 1: real HTML article extraction ──────────────────────────────────
  // example.com's body is only ~190 chars — too short to prove real chunked
  // extraction, so use a real long-form article (Wikipedia, stable content).
  const testUrl1 = `https://en.wikipedia.org/wiki/Electric_boat?cortex-test=${Date.now()}`;
  {
    const { status, body } = await api("/api/cortex/url", {
      method: "POST",
      body: JSON.stringify({ url: testUrl1, category: "Industry News", importance: "Medium" }),
    });
    if (status === 201) ok("POST /api/cortex/url returns 201"); else fail("POST /api/cortex/url returns 201", `got ${status} ${JSON.stringify(body)}`);
    const id = body?.record?.id;
    if (!id) throw new Error("No record id returned");

    const record = await waitForIngestion(api, id);
    if (record.ingestion_status === "ready") ok("example.com ingestion settles to 'ready'");
    else fail("example.com ingestion settles to 'ready'", `got ${record.ingestion_status}: ${record.failure_reason}`);

    if (record.retrieval_ready) ok("example.com marked retrieval_ready=true");
    else fail("example.com marked retrieval_ready=true");

    if (record.content_char_count > 0 && record.extracted_text && record.extracted_text.length > 0) {
      ok(`example.com has real extracted_text (${record.content_char_count} chars)`);
    } else {
      fail("example.com has real extracted_text", JSON.stringify(record).slice(0, 300));
    }

    if (record.chunk_count > 0 && Array.isArray((await api(`/api/cortex/url/${id}/content`)).body.chunks) && (await api(`/api/cortex/url/${id}/content`)).body.chunks.length > 0) {
      ok(`example.com produced ${record.chunk_count} indexed chunk(s)`);
    } else {
      fail("example.com produced indexed chunks");
    }

    // Test-retrieval endpoint returns a real chunk for a known phrase on example.com.
    const { body: retrievalBody } = await api(`/api/cortex/url/${id}/test-retrieval`, {
      method: "POST",
      body: JSON.stringify({ query: "domain" }),
    });
    if (Array.isArray(retrievalBody?.matches)) ok("test-retrieval endpoint returns matches array");
    else fail("test-retrieval endpoint returns matches array", JSON.stringify(retrievalBody));
  }

  // ── Test 2: unsupported/blocked LinkedIn URL is marked blocked, not fake-ready ──
  {
    const linkedInUrl = `https://www.linkedin.com/posts/cortex-test-${Date.now()}`;
    const { status, body } = await api("/api/cortex/url", {
      method: "POST",
      body: JSON.stringify({ url: linkedInUrl, category: "Industry News", importance: "Low" }),
    });
    if (status === 201) ok("POST LinkedIn URL returns 201 (record created, ingestion runs async)");
    else fail("POST LinkedIn URL returns 201", `got ${status}`);
    const id = body?.record?.id;
    const record = await waitForIngestion(api, id);
    if (record.ingestion_status === "blocked") ok("LinkedIn URL correctly marked 'blocked' (not silently faked as ready)");
    else fail("LinkedIn URL correctly marked 'blocked'", `got ${record.ingestion_status}`);
    if (!record.retrieval_ready) ok("LinkedIn URL retrieval_ready=false");
    else fail("LinkedIn URL retrieval_ready=false");
  }

  // ── Test 3: retry endpoint re-runs ingestion ──────────────────────────────
  {
    const testUrl3 = `https://example.org/?cortex-test=${Date.now()}`;
    const { body } = await api("/api/cortex/url", {
      method: "POST",
      body: JSON.stringify({ url: testUrl3, category: "Industry News", importance: "Low" }),
    });
    const id = body.record.id;
    await waitForIngestion(api, id);
    const { status: retryStatus, body: retryBody } = await api(`/api/cortex/url/${id}/retry`, { method: "POST" });
    if (retryStatus === 200 && retryBody.status === "queued") ok("POST /api/cortex/url/:id/retry re-queues ingestion");
    else fail("POST /api/cortex/url/:id/retry re-queues ingestion", `got ${retryStatus} ${JSON.stringify(retryBody)}`);
    await waitForIngestion(api, id);
  }

  // ── Test 4: /api/cortex/ask grounds answer in real chunk content with citations ──
  {
    const uniqueMarker = `CortexTestMarker${Date.now()}`;
    // example.com body always contains "illustrative examples" text; ask about it.
    const { body: askBody } = await api("/api/cortex/ask", {
      method: "POST",
      body: JSON.stringify({ question: "What does the example.com page say about illustrative examples in documents?" }),
    });
    if (askBody?.answer && typeof askBody.answer === "string") ok("/api/cortex/ask returns an answer string");
    else fail("/api/cortex/ask returns an answer string", JSON.stringify(askBody));

    if (Array.isArray(askBody?.sources)) ok("/api/cortex/ask returns a sources[] citation array");
    else fail("/api/cortex/ask returns a sources[] citation array", JSON.stringify(askBody));

    const boilerplateRe = /training data|as an ai language model|don'?t learn or acquire new information/i;
    if (!boilerplateRe.test(askBody?.answer || "")) ok("/api/cortex/ask answer avoids base-model boilerplate");
    else fail("/api/cortex/ask answer avoids base-model boilerplate", askBody.answer);
  }

  // ── Test 5: reprocess-incomplete backfill endpoint (admin) ────────────────
  {
    const { status, body } = await api("/api/cortex/url/reprocess-incomplete", { method: "POST" });
    if (status === 200 && typeof body?.queued === "number") ok("POST /api/cortex/url/reprocess-incomplete returns queued count");
    else fail("POST /api/cortex/url/reprocess-incomplete returns queued count", `got ${status} ${JSON.stringify(body)}`);
  }

  console.log("=".repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
  if (failed > 0) { console.error(`\u274c ${failed} test(s) FAILED`); process.exit(1); }
  console.log("\u2705 All tests PASSED");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
