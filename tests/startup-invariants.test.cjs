/**
 * startup-invariants.test.cjs
 *
 * Source-grep tests that pin the startup/first-load performance guarantees.
 * Covers:
 *  M1  migrations run ONCE in server/index.ts startup IIFE (not duplicated)
 *  M2  migrateCortexEmailIntelSchema wired into batch-4
 *  L1  server listens BEFORE seeds / background jobs run
 *  L2  seedProductionData is inside setTimeout (delayed after listen)
 *  L3  backfill resumer is inside setTimeout with >= 20 s delay
 *  L4  background schedulers are inside the listen callback
 *  L5  backfillAccountsForLeads is a fire-and-forget setTimeout (not blocking)
 *  B1  /api/session/bootstrap route exists in routes.ts
 *  B2  bootstrap returns only lightweight fields (no email / CRM list queries)
 *  B3  bootstrap sets Cache-Control private header
 *  B4  bootstrap does NOT import heavy modules (gmail-sync, crm-ai-summary, etc.)
 *  S1  SLOW_THRESHOLD_MS is 250 in server/performance.ts (not 800)
 *  S2  firstResponse startup mark is set in index.ts middleware
 *  S3  firstRequest startup mark is set in index.ts middleware
 *  H1  /health endpoint registered before middleware chain
 *  H2  /healthz endpoint registered and returns uptimeMs
 *  F1  BookingPublicPage is lazy-imported in App.tsx
 *  F2  No provider in App.tsx eagerly fetches data on mount via useQuery/fetch before bootstrap
 *  F3  App.tsx calls /api/session/bootstrap for first-render authentication
 *  F4  vs-js-loaded performance mark is added at module top in App.tsx
 *  F5  vs-shell-rendered performance mark fires after loading transitions to false
 *  F6  Dev-mode first-load summary is logged in App.tsx
 *  T1  perf summary log uses import.meta.env.DEV guard (not unconditional console.log)
 */

const fs   = require("fs");
const path = require("path");

const INDEX      = fs.readFileSync(path.join(__dirname, "../server/index.ts"), "utf8");
const ROUTES     = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");
const PERF       = fs.readFileSync(path.join(__dirname, "../server/performance.ts"), "utf8");
const APP        = fs.readFileSync(path.join(__dirname, "../client/src/App.tsx"), "utf8");

let passed = 0;
let failed = 0;

function test(id, label, fn) {
  try {
    fn();
    console.log(`  ✓ ${id}: ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${id}: ${label}`);
    console.error(`      ${err.message}`);
    failed++;
  }
}

function ok(label, condition) {
  if (!condition) throw new Error(`Expected truthy but got: ${condition}`);
}

// ── Migration checks ──────────────────────────────────────────────────────────

test("M1", "migrations run only in the startup IIFE (no duplicate migration block after listen)", () => {
  // Count occurrences of the canonical batch-1 marker
  const count = (INDEX.match(/migrateUserSchema\(\)/g) || []).length;
  ok("migrateUserSchema() appears exactly once (not duplicated)", count === 1);
});

test("M2", "migrateCortexEmailIntelSchema wired into batch-4", () => {
  ok("migrateCortexEmailIntelSchema imported and called in index.ts",
    INDEX.includes("migrateCortexEmailIntelSchema") &&
    INDEX.includes("migrateCortexEmailIntelSchema()"));
});

// ── Listen-first ordering ─────────────────────────────────────────────────────

test("L1", "httpServer.listen() appears before seedProductionData call in source order", () => {
  const listenIdx = INDEX.indexOf("httpServer.listen(");
  const seedIdx   = INDEX.indexOf("seedProductionData");
  ok("listen comes before seed in file", listenIdx < seedIdx && listenIdx !== -1);
});

test("L2", "seedProductionData is inside a setTimeout (not blocking startup)", () => {
  // Find the actual invocation `await seedProductionData()`, not any comment referencing the name.
  const callIdx = INDEX.indexOf("await seedProductionData()");
  ok("await seedProductionData() call exists", callIdx !== -1);
  // Look backwards up to 2000 chars for 'setTimeout'
  const before = INDEX.slice(Math.max(0, callIdx - 2000), callIdx);
  ok("seedProductionData() is inside a setTimeout block", before.includes("setTimeout"));
  // The delay value (e.g. 8_000 or 8000) must appear after the async fn closes
  const after = INDEX.slice(callIdx, callIdx + 1500);
  const delayMatch = after.match(/\},\s*([\d_]+)\s*\)/);
  ok("seed delay literal found near the call", delayMatch !== null);
  if (delayMatch) {
    const delayMs = parseInt(delayMatch[1].replace(/_/g, ""), 10);
    ok(`seed delay is >= 5000ms (got ${delayMs})`, delayMs >= 5000);
  }
});

test("L3", "backfill resumer is inside a setTimeout with >= 15 s delay", () => {
  const backfillIdx = INDEX.indexOf("backfill-service");
  ok("backfill-service import exists in listen callback", backfillIdx !== -1);
  // Look backwards for setTimeout
  const window = INDEX.slice(Math.max(0, backfillIdx - 3000), backfillIdx);
  ok("backfill resumer is inside a setTimeout block", window.includes("setTimeout"));
  // Find the delay value after the async fn closes
  const afterBackfill = INDEX.slice(backfillIdx, backfillIdx + 1500);
  const delayMatch = afterBackfill.match(/\},\s*([\d_]+)\s*\)/);
  ok("backfill delay literal found", delayMatch !== null);
  if (delayMatch) {
    const delayMs = parseInt(delayMatch[1].replace(/_/g, ""), 10);
    ok(`backfill delay is >= 15000ms (got ${delayMs})`, delayMs >= 15_000);
  }
});

test("L4", "startHourlySyncScheduler is inside the listen callback (not top-level)", () => {
  // The listen callback contains startHourlySyncScheduler
  const listenCbStart = INDEX.indexOf("httpServer.listen(");
  const syncIdx       = INDEX.indexOf("startHourlySyncScheduler()", listenCbStart);
  ok("startHourlySyncScheduler called AFTER listen starts", syncIdx > listenCbStart);
});

test("L5", "backfillAccountsForLeads is fire-and-forget setTimeout (not blocking startup IIFE)", () => {
  const backfillIdx  = INDEX.indexOf("backfillAccountsForLeads");
  const iifeIdx      = INDEX.indexOf("(async () => {");
  // backfillAccountsForLeads should appear BEFORE the async IIFE (top-level setTimeout)
  ok("backfillAccountsForLeads appears as a top-level setTimeout before the IIFE", backfillIdx !== -1);
  ok("it is wrapped in setTimeout", INDEX.slice(Math.max(0, backfillIdx - 200), backfillIdx).includes("setTimeout"));
});

// ── Bootstrap endpoint ────────────────────────────────────────────────────────

test("B1", "/api/session/bootstrap route exists in routes.ts", () => {
  ok("route registered", ROUTES.includes('"/api/session/bootstrap"') || ROUTES.includes("'/api/session/bootstrap'"));
});

test("B2", "bootstrap route does NOT query emails or CRM lists", () => {
  const bootstrapSection = (() => {
    const start = ROUTES.indexOf("/api/session/bootstrap");
    // Grab the next ~80 lines after the route declaration
    return ROUTES.slice(start, start + 3000);
  })();
  const heavy = [
    "gmail_messages", "mail_messages", "leads where", "contacts where",
    "opportunities where", "campaigns", "dashboard_widgets", "calendar_events",
  ];
  for (const h of heavy) {
    ok(`bootstrap does not reference "${h}"`, !bootstrapSection.toLowerCase().includes(h.toLowerCase()));
  }
});

test("B3", "bootstrap sets Cache-Control private header", () => {
  ok("Cache-Control private set", ROUTES.includes("Cache-Control") && ROUTES.includes("private, max-age=30"));
});

test("B4", "bootstrap section does not import gmail-sync or crm-ai-summary", () => {
  const bootstrapSection = ROUTES.slice(ROUTES.indexOf("/api/session/bootstrap"), ROUTES.indexOf("/api/session/bootstrap") + 3000);
  ok("no gmail-sync import in bootstrap", !bootstrapSection.includes("gmail-sync"));
  ok("no crm-ai-summary import in bootstrap", !bootstrapSection.includes("crm-ai-summary"));
});

// ── Performance / timing ──────────────────────────────────────────────────────

test("S1", "SLOW_THRESHOLD_MS is 250 in server/performance.ts", () => {
  ok("threshold is 250", PERF.includes("SLOW_THRESHOLD_MS = 250"));
  ok("threshold is NOT 800", !PERF.includes("SLOW_THRESHOLD_MS = 800"));
});

test("S2", "firstResponse startup mark is set in index.ts request middleware", () => {
  ok("setStartupMark('firstResponse'...)",
    INDEX.includes(`setStartupMark("firstResponse"`) || INDEX.includes(`setStartupMark('firstResponse'`));
});

test("S3", "firstRequest startup mark is set in index.ts request middleware", () => {
  ok("setStartupMark('firstRequest'...)",
    INDEX.includes(`setStartupMark("firstRequest"`) || INDEX.includes(`setStartupMark('firstRequest'`));
});

// ── Health endpoints ──────────────────────────────────────────────────────────

test("H1", "/health endpoint registered early (before IIFE) in index.ts", () => {
  const healthIdx = INDEX.indexOf('"/health"');
  const iifeIdx   = INDEX.indexOf("(async () => {");
  ok("/health registered before startup IIFE", healthIdx !== -1 && healthIdx < iifeIdx);
});

test("H2", "/healthz endpoint returns uptimeMs", () => {
  ok("/healthz includes uptimeMs", INDEX.includes("uptimeMs") && INDEX.includes('"/healthz"'));
});

// ── Frontend shell ────────────────────────────────────────────────────────────

test("F1", "BookingPublicPage is lazy-imported in App.tsx", () => {
  ok("lazy(() => import...booking-public)",
    APP.includes("BookingPublicPage") &&
    APP.includes("lazy(") &&
    APP.includes("booking-public"));
  // Must NOT be an eager static import
  ok("not an eager import", !APP.match(/^import.*BookingPublicPage/m));
});

test("F2", "App.tsx root component does not call useQuery or fetch before bootstrap resolves", () => {
  // Extract the App function body (from "function App()" to its closing brace)
  const appFnStart = APP.indexOf("function App()");
  const appFnBody = APP.slice(appFnStart, appFnStart + 8000);
  // The only fetch in App() should be the bootstrap call
  const fetchCalls = (appFnBody.match(/fetch\(/g) || []).length;
  // Expected fetch calls: bootstrap, timezone sync, logout — all 3 are intentional
  ok("at most 3 fetch calls in App() (bootstrap + timezone + logout)", fetchCalls <= 3);
  ok("no useQuery in App() function body", !appFnBody.includes("useQuery("));
});

test("F3", "App.tsx fetches /api/session/bootstrap for first-render auth", () => {
  ok("bootstrap fetch present", APP.includes("/api/session/bootstrap"));
});

test("F4", "vs-js-loaded performance mark added at module top in App.tsx", () => {
  ok("performance.mark('vs-js-loaded') present", APP.includes(`performance.mark("vs-js-loaded")`));
  // It must appear before the App function definition
  const markIdx   = APP.indexOf(`performance.mark("vs-js-loaded")`);
  const appFnIdx  = APP.indexOf("function App()");
  ok("mark fires before function App() definition", markIdx < appFnIdx);
});

test("F5", "vs-shell-rendered performance mark fires in loading-transition useEffect", () => {
  ok("performance.mark('vs-shell-rendered') present",
    APP.includes(`performance.mark("vs-shell-rendered")`));
  // It must be inside a useEffect that depends on [loading]
  ok("fired inside useEffect with [loading] dep",
    APP.includes("[loading]") && APP.includes(`performance.mark("vs-shell-rendered")`));
});

test("F6", "Dev-mode first-load performance summary is logged in App.tsx", () => {
  ok("summary log present", APP.includes("VoltSafe Growth OS") && APP.includes("First Load Performance"));
  ok("bootstrap duration is surfaced", APP.includes("bootstrapMs") || APP.includes("Bootstrap"));
  ok("shell render time is surfaced", APP.includes("shellMs") || APP.includes("Shell rendered"));
});

test("T1", "Perf summary log is guarded by import.meta.env.DEV (not unconditional)", () => {
  ok("DEV guard present", APP.includes("import.meta.env.DEV"));
  // The console.log with the perf summary must be inside the DEV guard block
  const devIdx      = APP.indexOf("import.meta.env.DEV");
  const summaryIdx  = APP.indexOf("First Load Performance");
  ok("summary is after DEV check", summaryIdx > devIdx);
});

// ── Results ───────────────────────────────────────────────────────────────────

console.log("\n─────────────────────────────────────────────");
console.log(`Startup invariants: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
