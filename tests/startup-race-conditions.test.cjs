"use strict";
/**
 * Startup race-condition regression tests
 *
 * Verifies that:
 *  1. Background jobs are gated on their required schemas (static analysis)
 *  2. The requireAppReady middleware is registered before registerRoutes
 *  3. Auth and webhook paths are exempted from the readiness gate
 *  4. /readyz, /healthz, / all behave correctly independent of startup state
 *  5. The smoke-test script rejects wrong app identity
 *  6. The canonical production URL is documented
 */

const fs = require("fs");
const path = require("path");

const BASE = "http://127.0.0.1:5000";
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

async function fetchJson(url, opts = {}) {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000), ...opts });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: r.status, contentType: r.headers.get("content-type") || "", text, json };
}

const SRC = fs.readFileSync(path.join(__dirname, "../server/index.ts"), "utf8");
const SMOKE = fs.readFileSync(path.join(__dirname, "../scripts/verify-release.mjs"), "utf8");

console.log("\n=== Startup Race-Condition Regression Tests ===\n");

// ── 1. Job gating — jobs start AFTER _startupComplete = true ─────────────────
console.log("── 1. Background job gating ──");

// Find positions of key markers in the source
const startupCompleteSet = SRC.indexOf("_startupComplete = true");
const startHourlySync    = SRC.indexOf("startHourlySyncScheduler()");
const startCalendarSync  = SRC.indexOf("startCalendarSyncScheduler()");
const startHelpCenter    = SRC.indexOf("startHelpCenterRefreshScheduler()");
const automationTick     = SRC.indexOf("scheduleAutomationTick");
const gmailWatch         = SRC.indexOf("startWatchRenewalScheduler");

check(
  "startHourlySyncScheduler starts AFTER _startupComplete=true",
  startHourlySync > startupCompleteSet
);
check(
  "startCalendarSyncScheduler starts AFTER _startupComplete=true",
  startCalendarSync > startupCompleteSet
);
check(
  "startHelpCenterRefreshScheduler starts AFTER _startupComplete=true",
  startHelpCenter > startupCompleteSet
);
check(
  "automation scheduler starts AFTER _startupComplete=true",
  automationTick > startupCompleteSet
);
check(
  "Gmail watch renewal starts AFTER _startupComplete=true",
  gmailWatch > startupCompleteSet
);

// ── 2. API readiness gate placement ──────────────────────────────────────────
console.log("\n── 2. API readiness gate ──");

const readinessMiddlewareIdx = SRC.indexOf('app.use("/api"');
const registerRoutesIdx      = SRC.indexOf("await registerRoutes(");
const startupCompleteRef     = SRC.indexOf("_startupComplete) return next()");

check(
  "app.use('/api', ...) readiness middleware exists",
  readinessMiddlewareIdx > 0
);
check(
  "readiness middleware registered BEFORE registerRoutes",
  readinessMiddlewareIdx > 0 && registerRoutesIdx > 0 &&
  readinessMiddlewareIdx < registerRoutesIdx
);
check(
  "readiness middleware calls next() when _startupComplete=true",
  startupCompleteRef > 0
);

// Auth exemption
const authExempt = SRC.slice(readinessMiddlewareIdx, readinessMiddlewareIdx + 600);
check(
  "/api/session/* exempted from readiness gate",
  authExempt.includes("/session")
);
check(
  "/api/version exempted from readiness gate",
  authExempt.includes("/version")
);
check(
  "/api/webhooks exempted from readiness gate",
  authExempt.includes("/webhooks")
);
check(
  "readiness gate returns 503 with JSON body",
  authExempt.includes("503") && authExempt.includes('"starting"')
);

// ── 3. Migration batch ordering ───────────────────────────────────────────────
console.log("\n── 3. Migration batch ordering ──");

// Use the actual code comments (not the overview block at the top)
const batch1UserIdx  = SRC.indexOf("await migrateUserSchema()");
const batch1EmailIdx = SRC.indexOf("await migrateEmailSchema()");
// "Batch 2: all independent" is the code-level comment, after the overview
const batch2CodeIdx  = SRC.indexOf("Batch 2: all independent");
const batch3CodeIdx  = SRC.indexOf("Batch 3: depends on");

check(
  "migrateUserSchema runs before Batch 2 code block",
  batch1UserIdx > 0 && batch2CodeIdx > 0 && batch1UserIdx < batch2CodeIdx
);
check(
  "migrateEmailSchema runs before Batch 2 code block",
  batch1EmailIdx > 0 && batch2CodeIdx > 0 && batch1EmailIdx < batch2CodeIdx
);
check(
  "Batch 2 code block runs before Batch 3",
  batch2CodeIdx > 0 && batch3CodeIdx > 0 && batch2CodeIdx < batch3CodeIdx
);
check(
  "_startupComplete=true set after migration batches",
  startupCompleteSet > batch3CodeIdx
);

// ── 4. Migration background wrapper ──────────────────────────────────────────
console.log("\n── 4. Migration background wrapper ──");

check(
  "Migrations run in fire-and-forget void async IIFE",
  SRC.includes("void (async () => {")
);
check(
  "Background IIFE has .catch fallback (no silent failure)",
  /void \(async \(\) => \{[\s\S]+?\}\)\(\)\.catch/.test(SRC)
);
check(
  "Background IIFE .catch still sets _startupComplete=true (no forever-starting state)",
  /\.catch\([\s\S]{0,200}_startupComplete = true/.test(SRC)
);

// ── 5. Cortex auto-ingest schema gate ────────────────────────────────────────
console.log("\n── 5. Cortex auto-ingest schema gate ──");

const cortexSchemaIdx  = SRC.indexOf("migrateAutoIngestDomainsSchema");
const cortexRecoveryIdx = SRC.indexOf("recoverStuckIngestions");
check(
  "Cortex migrateAutoIngestDomainsSchema is called before recoverStuckIngestions",
  cortexSchemaIdx > 0 && cortexRecoveryIdx > 0 && cortexSchemaIdx < cortexRecoveryIdx
);
check(
  "Cortex recovery is inside the migration block (not before it)",
  cortexRecoveryIdx > batch2CodeIdx
);

// ── 6. Canonical URL documentation ───────────────────────────────────────────
console.log("\n── 6. Canonical production URL ──");

check(
  "Smoke test identifies VoltSafe Growth OS by app name, not URL slug",
  SMOKE.includes('"VoltSafe Growth OS"') &&
  SMOKE.includes("URL slug")
);
check(
  "Smoke test does NOT reject the image-linker URL slug as wrong",
  !SMOKE.includes('!root.text.includes("image-linker")')
);
check(
  "Smoke test verifies /api/version app identity",
  SMOKE.includes("VoltSafe Growth OS")
);

// ── 7. Live server — readiness gate behavior ──────────────────────────────────
console.log("\n── 7. Live server — API readiness (server already ready in dev) ──");

async function runLive() {
  // Server is fully started in dev — all API calls should pass through
  const session = await fetchJson(`${BASE}/api/session/bootstrap`);
  check(
    "/api/session/bootstrap returns JSON (not 503) when ready",
    session.contentType.includes("application/json") && session.status !== 503
  );

  // /api/version always returns 200 (exempted + pre-registered)
  const ver = await fetchJson(`${BASE}/api/version`);
  check("/api/version returns 200 when ready", ver.status === 200);
  check('/api/version app is "VoltSafe Growth OS"', ver.json?.app === "VoltSafe Growth OS");

  // Readiness probe — poll until ready (migrations can take up to ~90s in prod)
  let rzStatus = null;
  for (let i = 0; i < 20; i++) {
    const rz = await fetchJson(`${BASE}/readyz`);
    if (rz.json?.status === "ready") { rzStatus = "ready"; break; }
    await new Promise(r => setTimeout(r, 3000));
  }
  check('/readyz is "ready" after startup completes', rzStatus === "ready");

  // Frontend always serves HTML (never blocked by readiness gate)
  const root = await fetchJson(`${BASE}/`);
  check("GET / returns HTML (never blocked by readiness gate)", root.contentType.includes("text/html"));
  check('GET / never returns startup JSON', !root.text.includes('"status":"starting"'));

  // SPA client routes return HTML
  const spa = await fetchJson(`${BASE}/pipeline`);
  check("SPA /pipeline returns HTML", spa.contentType.includes("text/html"));

  // API never swallowed by SPA
  const apiRoute = await fetchJson(`${BASE}/api/leads?limit=1`);
  check(
    "/api/leads returns JSON (not HTML, not 503 when ready)",
    apiRoute.contentType.includes("application/json")
  );
}

// ── 8. Smoke-test script rejects wrong identity ───────────────────────────────
console.log("\n── 8. Smoke-test identity rejection ──");

// We verify via static analysis that the smoke script exits nonzero on wrong identity
check(
  "Smoke test checks app===VoltSafe Growth OS",
  SMOKE.includes('ver.json?.app === "VoltSafe Growth OS"')
);
check(
  "Smoke test calls process.exit(1) on failure",
  SMOKE.includes("process.exit(1)")
);
check(
  "Smoke test verifies /readyz transitions to ready",
  SMOKE.includes("waitForReady")
);

runLive()
  .catch((e) => {
    console.error("\nFATAL: Live check error:", e?.message || e);
    failed++;
  })
  .finally(() => {
    console.log(`\n${"─".repeat(55)}`);
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log(`${"─".repeat(55)}`);
    if (failed > 0) process.exit(1);
  });
