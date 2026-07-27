#!/usr/bin/env node
/**
 * Release smoke-test script
 *
 * Usage:
 *   node scripts/verify-release.mjs <BASE_URL> [EXPECTED_COMMIT_SHA]
 *
 * Example:
 *   node scripts/verify-release.mjs https://voltsafe.replit.app
 *
 * Exit 0 = all checks pass (safe to promote).
 * Exit 1 = one or more checks failed (do NOT promote).
 */

const [, , BASE_URL, EXPECTED_SHA] = process.argv;

if (!BASE_URL) {
  console.error("Usage: node scripts/verify-release.mjs <BASE_URL> [EXPECTED_COMMIT_SHA]");
  process.exit(1);
}

const base = BASE_URL.replace(/\/$/, "");
let passed = 0;
let failed = 0;

function check(label, ok, detail = "") {
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

async function get(path, timeoutMs = 12000) {
  const url = `${base}${path}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    return { ok: true, status: r.status, contentType: r.headers.get("content-type") || "", text, json };
  } catch (e) {
    return { ok: false, status: 0, contentType: "", text: "", json: null, error: e?.message };
  }
}

/** Poll /readyz until ready or timeout */
async function waitForReady(maxMs = 90_000, intervalMs = 3000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const r = await get("/readyz", 5000);
    if (r.json?.status === "ready") return true;
    await new Promise(res => setTimeout(res, intervalMs));
  }
  return false;
}

console.log(`\n=== VoltSafe Release Smoke Test ===`);
console.log(`Target: ${base}\n`);

// ── 1. Liveness ───────────────────────────────────────────────────────────────
console.log("── 1. Liveness (/healthz) ──");
const hz = await get("/healthz");
check("/healthz reachable", hz.ok, hz.error);
check("/healthz returns 200", hz.status === 200, `got ${hz.status}`);
check('/healthz status is "ok"', hz.json?.status === "ok");

// ── 2. Readiness ─────────────────────────────────────────────────────────────
console.log("\n── 2. Readiness (/readyz) ──");
console.log("   Waiting for /readyz to become ready (up to 90s)…");
const isReady = await waitForReady();
check("/readyz transitioned to ready", isReady);

// ── 3. Version / identity ─────────────────────────────────────────────────────
console.log("\n── 3. Identity (/api/version) ──");
const ver = await get("/api/version");
check("/api/version returns 200", ver.status === 200, `got ${ver.status}`);
check('/api/version app is "VoltSafe Growth OS"', ver.json?.app === "VoltSafe Growth OS", `got: ${ver.json?.app}`);
check("/api/version environment present", typeof ver.json?.environment === "string");
if (EXPECTED_SHA) {
  check(
    `/api/version commitSha matches ${EXPECTED_SHA.slice(0, 8)}`,
    ver.json?.commitSha === EXPECTED_SHA,
    `got: ${ver.json?.commitSha}`
  );
}

// ── 4. Root HTML ──────────────────────────────────────────────────────────────
console.log("\n── 4. Root HTML (/) ──");
const root = await get("/");
check("GET / returns 200", root.status === 200, `got ${root.status}`);
check("GET / content-type is text/html", root.contentType.includes("text/html"), root.contentType);
check("GET / returns HTML document", root.text.trimStart().startsWith("<!DOCTYPE html") || root.text.trimStart().startsWith("<html"));
check('GET / does NOT return {"status":"starting"}', !root.text.includes('"status":"starting"'));
check("GET / contains VoltSafe app root", root.text.includes("VoltSafe") || root.text.includes("id=\"root\""));

// ── 5. SPA fallback ───────────────────────────────────────────────────────────
console.log("\n── 5. SPA fallback ──");
const spa = await get("/pipeline");
check("SPA route /pipeline returns 200", spa.status === 200, `got ${spa.status}`);
check("SPA route /pipeline returns HTML", spa.contentType.includes("text/html"), spa.contentType);

// ── 6. API not swallowed ──────────────────────────────────────────────────────
console.log("\n── 6. API routes not swallowed ──");
const api = await get("/api/session/bootstrap");
check("/api/* returns JSON (not HTML)", api.contentType.includes("application/json"), api.contentType);

// ── 7. Wrong project guard ────────────────────────────────────────────────────
console.log("\n── 7. Project identity guard ──");
check(
  "Response identifies VoltSafe (not a different project)",
  ver.json?.app === "VoltSafe Growth OS" &&
  !root.text.includes("image-linker") &&
  !root.text.includes("wrong-project")
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(55)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`${"─".repeat(55)}`);
if (failed > 0) {
  console.error("\n🚫  Release gate FAILED — do not promote this deployment.");
  process.exit(1);
} else {
  console.log("\n✅  All checks passed — deployment is promotable.");
  process.exit(0);
}
