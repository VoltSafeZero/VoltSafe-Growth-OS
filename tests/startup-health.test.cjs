"use strict";

/**
 * Startup & health-check regression tests.
 *
 * All checks are source-grep based (no live server needed) so they run
 * reliably in the test:grep suite without timing-sensitive ECONNREFUSED errors.
 */

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function ok(label, cond) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

const indexSrc = fs.readFileSync(
  path.join(__dirname, "../server/index.ts"),
  "utf8"
);

console.log("=== Startup & Health-Check Regression Tests ===");

// ── Section 1: Liveness endpoints registered before middleware ───────────────
console.log("\n── 1. Liveness endpoints — registered early ──");

// Both health endpoints must appear before the async IIFE
const healthPos    = indexSrc.indexOf('app.get("/health"');
const healthzPos   = indexSrc.indexOf('app.get("/healthz"');
const readyzPos    = indexSrc.indexOf('app.get("/readyz"');
const iifePos      = indexSrc.indexOf("(async () => {");
const listenEarlyPos = indexSrc.indexOf("// ── Bind port IMMEDIATELY");

ok("/health registered",    healthPos  > -1);
ok("/healthz registered",   healthzPos > -1);
ok("/readyz registered",    readyzPos  > -1);
ok("/health before async IIFE",  healthPos  < iifePos);
ok("/healthz before async IIFE", healthzPos < iifePos);
ok("/readyz before async IIFE",  readyzPos  < iifePos);
ok("early listen comment present", listenEarlyPos > -1);
ok("early listen before migrations", listenEarlyPos < indexSrc.indexOf("// ── Schema migrations"));

// ── Section 2: listen() called early (before migrations) ────────────────────
console.log("\n── 2. Port binding order ──");

const earlyListenPromise = indexSrc.includes("await new Promise<void>((portResolve)");
ok("listen wrapped in Promise for early binding", earlyListenPromise);

// There should be exactly ONE httpServer.listen() call in the IIFE
const listenMatches = [...indexSrc.matchAll(/httpServer\.listen\s*\(/g)];
ok("exactly 1 httpServer.listen() in file", listenMatches.length === 1);

// The listen call must appear BEFORE the Schema migrations comment
const earlyListenIdx   = indexSrc.indexOf("httpServer.listen(");
const migrationsBatchIdx = indexSrc.indexOf("// Batch 1: core base schemas");
ok("listen() before migrations batch", earlyListenIdx < migrationsBatchIdx);

// ── Section 3: _startupComplete flag ────────────────────────────────────────
console.log("\n── 3. Startup readiness flag ──");

ok("_startupComplete declared as false", indexSrc.includes("let _startupComplete = false"));
ok("_startupComplete = true after routes",
  indexSrc.includes("_startupComplete = true"));

// The flag must be set AFTER registerRoutes (routes registered before background jobs)
const startupFlagIdx  = indexSrc.indexOf("_startupComplete = true");
const registerRoutesIdx = indexSrc.indexOf("await registerRoutes(httpServer, app)");
ok("_startupComplete set after registerRoutes", startupFlagIdx > registerRoutesIdx);

// /readyz uses the flag
ok("/readyz checks _startupComplete", 
  indexSrc.includes("if (_startupComplete)") &&
  indexSrc.indexOf("if (_startupComplete)") > readyzPos);

// ── Section 4: / root startup guard ─────────────────────────────────────────
console.log("\n── 4. Root-path startup guard (Replit health check) ──");

ok('app.get("/", ... root guard present',
  indexSrc.includes('app.get("/", (req, res, next) => {'));
ok("root guard returns 200 during startup",
  indexSrc.includes('res.status(200).json({ status: "starting"'));
ok("root guard calls next() when startup complete",
  indexSrc.includes("if (_startupComplete) return next();"));
ok("root guard registered before middleware", 
  indexSrc.indexOf('app.get("/", (req, res, next)') < iifePos);

// ── Section 5: Migration error logging ──────────────────────────────────────
console.log("\n── 5. Migration error logging ──");

ok("catch migErr typed as any",
  indexSrc.includes("} catch (migErr: any) {"));
ok("migration error logs pg code field",
  indexSrc.includes("code:       migErr?.code"));
ok("migration error logs pg detail field",
  indexSrc.includes("detail:     migErr?.detail"));
ok("migration error logs pg table field",
  indexSrc.includes("table:      migErr?.table"));
ok("migration error logs pg constraint field",
  indexSrc.includes("constraint: migErr?.constraint"));

// ── Section 6: Cortex auto-ingest error logging ──────────────────────────────
console.log("\n── 6. Cortex auto-ingest error logging ──");

const gmailIncrSrc = fs.readFileSync(
  path.join(__dirname, "../server/services/gmail-incremental.ts"),
  "utf8"
);

ok("cortex error logs pg code",
  gmailIncrSrc.includes("pg code=${err?.code"));
ok("cortex error logs pg detail",
  gmailIncrSrc.includes("detail=${err?.detail"));
ok("cortex import failure logged",
  gmailIncrSrc.includes("[cortex-auto-ingest] import failed"));

// ── Section 7: Background jobs after routes ──────────────────────────────────
console.log("\n── 7. Background jobs after routes ──");

const bgJobsIdx = indexSrc.indexOf("startHourlySyncScheduler()");
ok("startHourlySyncScheduler called after registerRoutes",
  bgJobsIdx > registerRoutesIdx);
ok("startHourlySyncScheduler called after _startupComplete = true",
  bgJobsIdx > startupFlagIdx);

const backfillIdx = indexSrc.indexOf("[backfill-resumer]");
ok("backfill-resumer after routes", backfillIdx > registerRoutesIdx);

// Old multi-line httpServer.listen({port, host, reusePort}, () => {...}) must not exist.
// The new early listen uses a single-line argument form.
ok("no old multi-line httpServer.listen() block",
  !indexSrc.includes("httpServer.listen(\n    {\n      port,\n      host: \"0.0.0.0\","));

// ── Section 8: Cortex auto-ingest migration ──────────────────────────────────
console.log("\n── 8. Cortex migration idempotency ──");

const cortexSrc = fs.readFileSync(
  path.join(__dirname, "../server/services/cortex-auto-ingest.ts"),
  "utf8"
);

ok("CREATE TABLE IF NOT EXISTS", cortexSrc.includes("CREATE TABLE IF NOT EXISTS cortex_auto_ingest_domains"));
ok("ADD COLUMN IF NOT EXISTS last_matched_at", cortexSrc.includes("ADD COLUMN IF NOT EXISTS last_matched_at"));
ok("ADD COLUMN IF NOT EXISTS match_count", cortexSrc.includes("ADD COLUMN IF NOT EXISTS match_count"));
ok("migration function exported", cortexSrc.includes("export async function migrateAutoIngestDomainsSchema"));
ok("cortex migration in batch-2 Promise.all",
  indexSrc.includes('import("./services/cortex-auto-ingest").then(({ migrateAutoIngestDomainsSchema }) => migrateAutoIngestDomainsSchema())'));

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(55)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`${"─".repeat(55)}`);
if (failed > 0) process.exit(1);
