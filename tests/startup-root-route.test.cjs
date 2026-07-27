"use strict";
/**
 * Startup / root-route regression tests
 *
 * Verifies that:
 *   - GET / never returns startup JSON
 *   - /healthz returns 200 immediately
 *   - /readyz is separate from /
 *   - /api/version identifies the correct project
 *   - The startup root-route guard has been removed from server/index.ts
 *
 * These are static-analysis + live-server checks combined so they work in CI
 * and in dev without needing a production build.
 */

const fs = require("fs");
const path = require("path");

const BASE = "http://127.0.0.1:5000";
let passed = 0;
let failed = 0;

function check(label, ok) {
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

async function fetchJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: r.status, contentType: r.headers.get("content-type") || "", text, json };
}

// ── Static analysis of server/index.ts ────────────────────────────────────────
console.log("\n=== Startup / Root-Route Regression Tests ===\n");
console.log("── 1. Static analysis — server/index.ts ──");

const SRC = fs.readFileSync(path.join(__dirname, "../server/index.ts"), "utf8");

// The startup guard that blocked GET / with JSON must be gone.
// Check: no app.get("/", ...) handler body within 300 chars contains "starting"
const rootGetMatch = SRC.match(/app\.get\("\/",[\s\S]{0,300}/);
const rootHandlerHasStarting = rootGetMatch
  ? rootGetMatch[0].includes('"starting"') || rootGetMatch[0].includes("'starting'")
  : false;
check(
  "No startup-JSON guard on GET /",
  !rootHandlerHasStarting
);

// /healthz must be registered before the IIFE (early, before any middleware)
const healthzIdx = SRC.indexOf('app.get("/healthz"');
const iifeIdx = SRC.indexOf("(async () => {");
check(
  "/healthz registered before startup IIFE",
  healthzIdx > 0 && iifeIdx > 0 && healthzIdx < iifeIdx
);

// /readyz must be separate from / — no startup JSON at root
check(
  "/readyz is the only endpoint returning {status:starting}",
  /\/readyz.*status.*starting/s.test(SRC)
);

// Frontend registration (registerRoutes + serveStatic/setupVite) must happen
// before the migration block
const routesIdx = SRC.indexOf("await registerRoutes(");
const migStart = SRC.indexOf("void (async () => {");
check(
  "registerRoutes called before background migration block",
  routesIdx > 0 && migStart > 0 && routesIdx < migStart
);

// serveStatic / setupVite must be registered before the migration IIFE
const serveStaticIdx = SRC.indexOf("serveStatic(app)");
check(
  "serveStatic registered before background migration block",
  serveStaticIdx > 0 && migStart > 0 && serveStaticIdx < migStart
);

// _startupComplete must only be set inside or after migrations (not before frontend serves)
// It should NOT appear before registerRoutes
const startupCompleteSetIdx = SRC.indexOf("_startupComplete = true");
check(
  "_startupComplete=true set after routes are registered",
  startupCompleteSetIdx > routesIdx
);

// /api/version must exist
check(
  "/api/version endpoint present",
  SRC.includes('app.get("/api/version"')
);

// Background migration wrapper must be fire-and-forget (void async IIFE)
check(
  "migrations wrapped in fire-and-forget void async IIFE",
  SRC.includes("void (async () => {")
);

// The background IIFE has a .catch so _startupComplete is always eventually set
check(
  "background IIFE has .catch fallback",
  /void \(async \(\) => \{[\s\S]+?\}\)\(\)\.catch/.test(SRC)
);

// ── Live server checks ────────────────────────────────────────────────────────
console.log("\n── 2. Live server checks ──");

async function runLive() {
  // GET / must return HTML, never startup JSON
  const root = await fetchJson(`${BASE}/`);
  check(
    "GET / returns HTML (not startup JSON)",
    root.contentType.includes("text/html")
  );
  check(
    "GET / body is HTML document",
    root.text.trimStart().startsWith("<!DOCTYPE html") ||
    root.text.trimStart().startsWith("<html")
  );
  check(
    "GET / does not contain {status:starting}",
    !root.text.includes('"status":"starting"')
  );

  // /healthz — always 200, no DB dependency
  const hz = await fetchJson(`${BASE}/healthz`);
  check("/healthz returns 200", hz.status === 200);
  check('/healthz status is "ok"', hz.json?.status === "ok");
  check("/healthz includes uptimeMs", typeof hz.json?.uptimeMs === "number");

  // /health — legacy alias, also 200
  const h = await fetchJson(`${BASE}/health`);
  check("/health returns 200", h.status === 200);

  // /readyz — may be 503 if still starting, but must be separate from /
  const rz = await fetchJson(`${BASE}/readyz`);
  check(
    "/readyz is separate from / (returns JSON, not HTML)",
    rz.contentType.includes("application/json")
  );
  check(
    "/readyz status is ready or starting (never missing)",
    rz.json?.status === "ready" || rz.json?.status === "starting"
  );

  // /api/version — identity check
  const ver = await fetchJson(`${BASE}/api/version`);
  check("/api/version returns 200", ver.status === 200);
  check('/api/version app is "VoltSafe Growth OS"', ver.json?.app === "VoltSafe Growth OS");
  check("/api/version includes environment", typeof ver.json?.environment === "string");
  check("/api/version includes uptimeMs", typeof ver.json?.uptimeMs === "number");

  // SPA fallback — a client-side route must also get HTML
  const spa = await fetchJson(`${BASE}/pipeline`);
  check(
    "SPA route /pipeline returns HTML (not 404 JSON)",
    spa.contentType.includes("text/html")
  );

  // API routes not swallowed by SPA fallback
  const api = await fetchJson(`${BASE}/api/session/bootstrap`);
  check(
    "/api/* routes not swallowed by SPA fallback (returns JSON, not HTML)",
    api.contentType.includes("application/json")
  );
}

runLive()
  .catch((e) => {
    console.error("\nFATAL: Live server check failed:", e?.message || e);
    failed++;
  })
  .finally(() => {
    console.log(`\n${"─".repeat(55)}`);
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log(`${"─".repeat(55)}`);
    if (failed > 0) process.exit(1);
  });
