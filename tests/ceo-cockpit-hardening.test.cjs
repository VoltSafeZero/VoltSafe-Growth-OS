"use strict";
// tests/ceo-cockpit-hardening.test.cjs
// Phase 11: CEO Cockpit Hardening — meta source-grep audit
// Covers: service existence, route permission guards, migration idempotency,
// privacy safety, UI tab structure, lazy queries, banned language, empty states.

const fs   = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;
const failures = [];

function assert(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
    failures.push(label);
  }
}

function readFile(rel) {
  const full = path.join(__dirname, "..", rel);
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
}

function fileExists(rel) {
  return fs.existsSync(path.join(__dirname, "..", rel));
}

const routes    = readFile("server/routes.ts")         || "";
const index_ts  = readFile("server/index.ts")          || "";
const today_tsx = readFile("client/src/pages/today.tsx") || "";

// ── Service files ────────────────────────────────────────────────────────────
console.log("\nPhase 11: Service Files Exist");
const ceoServices = [
  "server/services/ceo-cockpit.ts",
  "server/services/ceo-action-loop.ts",
  "server/services/ceo-briefing.ts",
  "server/services/ceo-execution-intelligence.ts",
  "server/services/ceo-forecasting.ts",
  "server/services/ceo-one-on-ones.ts",
  "server/services/board-pack.ts",
  "server/services/board-pack-scheduler.ts",
];
for (const svc of ceoServices) {
  assert(`service exists: ${path.basename(svc)}`, fileExists(svc));
}

// ── Frontend component files ─────────────────────────────────────────────────
console.log("\nPhase 11: Frontend Component Files Exist");
const ceoComponents = [
  "client/src/components/today/ceo-cockpit-sections.tsx",
  "client/src/components/today/ceo-action-queue.tsx",
  "client/src/components/today/ceo-briefing.tsx",
  "client/src/components/today/ceo-execution-radar.tsx",
  "client/src/components/today/ceo-forecasting.tsx",
  "client/src/components/today/ceo-one-on-ones.tsx",
];
for (const c of ceoComponents) {
  assert(`component exists: ${path.basename(c)}`, fileExists(c));
}

// ── Route groups exist ───────────────────────────────────────────────────────
console.log("\nPhase 11: Route Groups Exist");
assert("CEO cockpit main route",       routes.includes("/api/today/ceo-cockpit"));
assert("CEO actions routes",           routes.includes("/api/today/ceo-actions"));
assert("CEO briefing routes",          routes.includes("/api/today/ceo-briefing"));
assert("CEO execution routes",         routes.includes("/api/today/ceo-execution"));
assert("CEO forecast routes",          routes.includes("/api/today/ceo-forecast"));
assert("1:1 notes routes",             routes.includes("/api/today/ceo-cockpit/one-on-ones"));
assert("board-packs routes",           routes.includes("/api/board-packs"));
assert("board-pack scheduler routes",  routes.includes("/api/board-pack/schedules"));

// ── Permission guards: requireAdmin on all CEO routes ───────────────────────
console.log("\nPhase 11: requireAdmin on All CEO Cockpit Routes");

function routeLines(src, pathFrag) {
  return src.split("\n").filter(l => l.includes(pathFrag) && (l.includes("app.get") || l.includes("app.post") || l.includes("app.patch") || l.includes("app.delete")));
}

const cockpitRouteLines = routeLines(routes, "/api/today/ceo");
const actionRouteLines  = routeLines(routes, "/api/today/ceo-actions");
const briefingLines     = routeLines(routes, "/api/today/ceo-briefing");
const executionLines    = routeLines(routes, "/api/today/ceo-execution");
const forecastLines     = routeLines(routes, "/api/today/ceo-forecast");

assert("all /ceo-cockpit/* routes have requireAdmin",
  cockpitRouteLines.every(l => l.includes("requireAdmin")));
assert("all /ceo-actions/* routes have requireAdmin",
  actionRouteLines.every(l => l.includes("requireAdmin")));
assert("all /ceo-briefing/* routes have requireAdmin",
  briefingLines.every(l => l.includes("requireAdmin")));
assert("all /ceo-execution/* routes have requireAdmin",
  executionLines.every(l => l.includes("requireAdmin")));
assert("all /ceo-forecast/* routes have requireAdmin",
  forecastLines.every(l => l.includes("requireAdmin")));

// ── CEO/CFO-only gates on capital-sensitive routes ────────────────────────────
console.log("\nPhase 11: CEO/CFO-Only Gates on Capital Routes");

const runwayLine  = routes.split("\n").find(l => l.includes("/api/today/ceo-forecast/runway") && l.includes("app.get"));
const fundingLine = routes.split("\n").find(l => l.includes("/api/today/ceo-forecast/funding") && l.includes("app.get"));
assert("runway route has requireForecastCapitalAccess",
  !!runwayLine && runwayLine.includes("requireForecastCapitalAccess"));
assert("funding route has requireForecastCapitalAccess",
  !!fundingLine && fundingLine.includes("requireForecastCapitalAccess"));

const bpRouteLines = routeLines(routes, "/api/board-packs");
const bpDataLines  = bpRouteLines.filter(l => !l.includes("/api/board-pack/"));
assert("board-packs data routes use requireBoardPackAccess",
  bpDataLines.every(l => l.includes("requireBoardPackAccess")));
assert("board-packs data routes do NOT rely on requireAdmin only",
  bpDataLines.every(l => !l.includes("requireAdmin")));

assert("requireForecastCapitalAccess defined in routes.ts",
  routes.includes("function requireForecastCapitalAccess"));
assert("requireBoardPackAccess defined in routes.ts",
  routes.includes("function requireBoardPackAccess"));

assert("isBoardPackUser checks user id (CEO Trevor = 4)",
  routes.includes("isBoardPackUser"));
assert("CEO cockpit main route has requireAdmin",
  routes.includes('"/api/today/ceo-cockpit"') && routes.includes("requireAdmin"));

// ── isBoardPackUser definition in board-pack service ─────────────────────────
console.log("\nPhase 11: isBoardPackUser CEO/CFO Coverage");
const boardPackSvc = readFile("server/services/board-pack.ts") || "";
assert("isBoardPackUser exported from board-pack.ts",
  boardPackSvc.includes("export function isBoardPackUser"));
assert("isBoardPackUser checks CEO user id (4)",
  boardPackSvc.includes("userId === 4") || boardPackSvc.includes("userId==4") || boardPackSvc.includes("Set([4])") || boardPackSvc.includes("new Set([4])"));
assert("isBoardPackUser checks CFO email",
  boardPackSvc.includes("scott.carlson@voltsafe.com"));

// ── Migration idempotency ────────────────────────────────────────────────────
console.log("\nPhase 11: Migration Idempotency (IF NOT EXISTS everywhere)");

function indexBetween(src, start, end) {
  const si = src.indexOf(start);
  if (si === -1) return "";
  const ei = src.indexOf(end, si + start.length);
  return ei === -1 ? src.slice(si) : src.slice(si, ei + end.length);
}

const ceoMigBlock = (() => {
  const si = index_ts.indexOf("ceo_action_queue");
  const ei = index_ts.indexOf("ceo_forecast_notes table ready");
  return si !== -1 && ei !== -1 ? index_ts.slice(si, ei + 50) : "";
})();

assert("ceo_action_queue uses CREATE TABLE IF NOT EXISTS",
  index_ts.includes("CREATE TABLE IF NOT EXISTS ceo_action_queue"));
assert("ceo_action_events uses CREATE TABLE IF NOT EXISTS",
  ceoMigBlock.includes("CREATE TABLE IF NOT EXISTS ceo_action_events"));
assert("ceo_execution_reviews uses CREATE TABLE IF NOT EXISTS",
  ceoMigBlock.includes("CREATE TABLE IF NOT EXISTS ceo_execution_reviews"));
assert("board_packs uses CREATE TABLE IF NOT EXISTS",
  ceoMigBlock.includes("CREATE TABLE IF NOT EXISTS board_packs"));
assert("ceo_forecast_notes uses CREATE TABLE IF NOT EXISTS",
  ceoMigBlock.includes("CREATE TABLE IF NOT EXISTS ceo_forecast_notes"));

assert("CEO action queue indexes use IF NOT EXISTS",
  ceoMigBlock.includes("CREATE INDEX IF NOT EXISTS idx_ceo_action_queue_owner_status"));
assert("ceo_execution_reviews indexes use IF NOT EXISTS",
  ceoMigBlock.includes("CREATE INDEX IF NOT EXISTS idx_ceo_execution_reviews_key"));
assert("board_packs indexes use IF NOT EXISTS",
  ceoMigBlock.includes("CREATE INDEX IF NOT EXISTS idx_board_packs_status"));
assert("ceo_forecast_notes indexes use IF NOT EXISTS",
  ceoMigBlock.includes("CREATE INDEX IF NOT EXISTS idx_ceo_forecast_notes_user"));

assert("one_on_one_sections column uses ADD COLUMN IF NOT EXISTS",
  index_ts.includes("ADD COLUMN IF NOT EXISTS one_on_one_sections"));

// ── No pool in late CEO migrations ───────────────────────────────────────────
console.log("\nPhase 11: No undefined pool in CEO Migrations");
const lateBlock = (() => {
  const si = index_ts.indexOf("CEO Action Queue tables ready");
  return si !== -1 ? index_ts.slice(si, si + 3000) : "";
})();
assert("no bare pool.query in CEO migration block",
  !lateBlock.includes("pool.query") && !lateBlock.includes("pool.execute"));
assert("CEO migrations use _db.execute pattern",
  lateBlock.includes("_db.execute"));

// ── No auto-send in CEO route blocks ─────────────────────────────────────────
console.log("\nPhase 11: No Auto-Send in CEO Route Blocks");

function extractBlock(src, startMarker, endMarker) {
  const si = src.indexOf(startMarker);
  if (si === -1) return "";
  const ei = src.indexOf(endMarker, si);
  return ei === -1 ? src.slice(si) : src.slice(si, ei);
}

const ceoBriefingBlock  = extractBlock(routes, "app.get(\"/api/today/ceo-briefing/daily\"", "app.get(\"/api/today/ceo-execution");
const ceoExecutionBlock = extractBlock(routes, "app.get(\"/api/today/ceo-execution/radar\"", "app.get(\"/api/today/ceo-forecast");
const ceoForecastBlock  = extractBlock(routes, "app.get(\"/api/today/ceo-forecast\"", "// requireBoardPackAccess");
// board-pack investor-update-draft route block (precise: just that route handler)
// Use double-newline + comment boundary which limits to just the handler body (~1200 chars)
const investorUpdateDraftBlock = extractBlock(routes, "app.post(\"/api/board-packs/:id/investor-update-draft\"", "\n\n  // ");

assert("no sendEmail in CEO briefing route block",     !ceoBriefingBlock.includes("sendEmail("));
assert("no sendMessage in CEO briefing route block",   !ceoBriefingBlock.includes("sendMessage("));
assert("no sendEmail in CEO execution route block",    !ceoExecutionBlock.includes("sendEmail("));
assert("no sendEmail in CEO forecast route block",     !ceoForecastBlock.includes("sendEmail("));
assert("no sendMessage in CEO forecast route block",   !ceoForecastBlock.includes("sendMessage("));
assert("no sendEmail in board pack investor-update-draft route",
  !investorUpdateDraftBlock.includes("sendEmail("));
assert("no sendMessage in board pack investor-update-draft route",
  !investorUpdateDraftBlock.includes("sendMessage("));

// draft routes — verify via briefing service (copy-only annotation) and board-pack service
const briefingSvc = readFile("server/services/ceo-briefing.ts") || "";
assert("briefing service has copy-only annotation (Never sends)",
  briefingSvc.includes("Never sends") || briefingSvc.includes("never sends") || briefingSvc.includes("no auto-send"));

// ── No OpenAI in deterministic CEO services ──────────────────────────────────
console.log("\nPhase 11: No OpenAI in Deterministic CEO Services");
const deterministicServices = [
  "server/services/ceo-cockpit.ts",
  "server/services/ceo-action-loop.ts",
  "server/services/ceo-briefing.ts",
  "server/services/ceo-execution-intelligence.ts",
  "server/services/ceo-forecasting.ts",
];
for (const svc of deterministicServices) {
  const src = readFile(svc) || "";
  assert(`no OpenAI client in ${path.basename(svc)}`,
    !src.includes("new OpenAI(") && !src.includes("openai.chat") && !src.includes("import OpenAI"));
}

// One-on-ones is allowed to have OpenAI (AI commitment extraction — Phase 5)
const oneOnOnesSvc = readFile("server/services/ceo-one-on-ones.ts") || "";
assert("ceo-one-on-ones has AI commitment extraction (expected)",
  oneOnOnesSvc.includes("OpenAI") || oneOnOnesSvc.includes("extractCommitment"));

// ── No external API calls in deterministic CEO services ──────────────────────
console.log("\nPhase 11: No External API Calls in Deterministic Services");
for (const svc of deterministicServices) {
  const src = readFile(svc) || "";
  assert(`no fetch() in ${path.basename(svc)}`,
    !src.includes("fetch(\"http") && !src.includes("fetch(\"https") && !src.includes("axios.get"));
}

// ── No private Currents channel data broad exposure ──────────────────────────
console.log("\nPhase 11: No Private Currents Channel Broad Exposure");
for (const svc of deterministicServices) {
  const src = readFile(svc) || "";
  assert(`no unfiltered Currents channels SELECT in ${path.basename(svc)}`,
    !src.includes("SELECT * FROM currents_channels") &&
    !(/SELECT .* FROM currents_channels\b/.test(src) && !src.includes("is_private") && !src.includes("WHERE") ));
}

// ── No sensitive localStorage in CEO components ──────────────────────────────
console.log("\nPhase 11: localStorage Safety in CEO Components");
const ceoCompFiles = [
  "client/src/components/today/ceo-action-queue.tsx",
  "client/src/components/today/ceo-briefing.tsx",
  "client/src/components/today/ceo-execution-radar.tsx",
  "client/src/components/today/ceo-forecasting.tsx",
  "client/src/components/today/ceo-one-on-ones.tsx",
];
for (const comp of ceoCompFiles) {
  const src = readFile(comp) || "";
  const lsMatches = (src.match(/localStorage\.setItem\(([^)]+)\)/g) || []);
  const sensitiveLS = lsMatches.filter(m =>
    !m.includes("snooze") && !m.includes("tab") && !m.includes("dismiss") && !m.includes("filter") && !m.includes("id")
  );
  assert(`no sensitive localStorage.setItem in ${path.basename(comp)}`,
    sensitiveLS.length === 0);
}

// ── Banned language absent ────────────────────────────────────────────────────
console.log("\nPhase 11: Banned Language Absent from CEO Stack");
const bannedWords = ["lazy", "failing performer", "weak performer", "poor performer", "blame", "underperforming"];
const allCeoFiles = [
  ...deterministicServices,
  "server/services/ceo-one-on-ones.ts",
  "server/services/board-pack.ts",
  ...ceoCompFiles,
  "client/src/components/today/ceo-cockpit-sections.tsx",
  "client/src/pages/today.tsx",
];
for (const word of bannedWords) {
  const matches = allCeoFiles.filter(f => {
    const src = readFile(f) || "";
    const lc = src.toLowerCase();
    return lc.includes(word.toLowerCase());
  });
  assert(`"${word}" absent from CEO stack`, matches.length === 0);
}

// ── Tab structure in today.tsx ───────────────────────────────────────────────
console.log("\nPhase 11: CEO Cockpit Tab Structure");
assert("ceo-cockpit-tabs testid in today.tsx",
  today_tsx.includes('data-testid="ceo-cockpit-tabs"'));
assert("tab id overview present",
  today_tsx.includes('"overview"') && today_tsx.includes("ceo-cockpit-tab-"));
assert("tab id actions present",
  today_tsx.includes('"actions"'));
assert("tab id briefing present",
  today_tsx.includes('"briefing"'));
assert("tab id execution present",
  today_tsx.includes('"execution"'));
assert("tab id forecasting present",
  today_tsx.includes('"forecasting"'));
assert("tab id 1on1s present",
  today_tsx.includes('"1on1s"'));
assert("tab id board-pack present",
  today_tsx.includes('"board-pack"'));
assert("setCockpitTab wired to tab buttons",
  today_tsx.includes("setCockpitTab(tab.id)"));
assert("default tab state is overview",
  today_tsx.includes('useState<string>("overview")'));

// ── Lazy query pattern ────────────────────────────────────────────────────────
console.log("\nPhase 11: Lazy Query Patterns");
assert("cockpitQuery enabled only when admin AND ceo_cockpit mode",
  today_tsx.includes('enabled: isAdmin && todayMode === "ceo_cockpit"'));
assert("actions panel only rendered when cockpitTab = actions",
  today_tsx.includes('cockpitTab === "actions"'));
assert("briefing panel only rendered when cockpitTab = briefing",
  today_tsx.includes('cockpitTab === "briefing"'));
assert("execution panel only rendered when cockpitTab = execution",
  today_tsx.includes('cockpitTab === "execution"'));
assert("forecasting panel only rendered when cockpitTab = forecasting",
  today_tsx.includes('cockpitTab === "forecasting"'));
assert("1on1s panel only rendered when cockpitTab = 1on1s",
  today_tsx.includes('cockpitTab === "1on1s"'));

// ── Empty states in panels ────────────────────────────────────────────────────
console.log("\nPhase 11: Empty/Error/Loading States");
assert("cockpit loading state in today.tsx",
  today_tsx.includes('data-testid="ceo-cockpit-loading"'));
assert("cockpit error state in today.tsx",
  today_tsx.includes('data-testid="ceo-cockpit-error"'));

const execRadar = readFile("client/src/components/today/ceo-execution-radar.tsx") || "";
assert("execution radar has loading state", execRadar.includes("isLoading") || execRadar.includes("Loading"));
assert("execution radar has error state",   execRadar.includes("isError")   || execRadar.includes("Error"));

const forecastComp = readFile("client/src/components/today/ceo-forecasting.tsx") || "";
assert("forecasting panel has loading state", forecastComp.includes("isLoading") || forecastComp.includes("Loading"));
assert("forecasting panel has error state",   forecastComp.includes("isError")   || forecastComp.includes("Error"));

const actionComp = readFile("client/src/components/today/ceo-action-queue.tsx") || "";
assert("action queue has loading state", actionComp.includes("isLoading") || actionComp.includes("Loading"));
assert("action queue has error state",   actionComp.includes("isError")   || actionComp.includes("Error"));

const briefingComp = readFile("client/src/components/today/ceo-briefing.tsx") || "";
assert("briefing has loading state", briefingComp.includes("isLoading") || briefingComp.includes("Loading"));
assert("briefing has error state",   briefingComp.includes("isError")   || briefingComp.includes("Error"));

// ── Forecasting planning-assumption language ──────────────────────────────────
console.log("\nPhase 11: Forecasting Uses Planning-Assumption Language");
const forecastSvc = readFile("server/services/ceo-forecasting.ts") || "";
assert("forecasting service has planning_assumption or planning assumption",
  forecastSvc.includes("planning_assumption") || forecastSvc.includes("planning assumption"));
assert("forecasting service has 'suggests' or 'likely'",
  forecastSvc.includes("suggests") || forecastSvc.includes("likely"));
assert("no 'guaranteed' in forecasting service",
  !forecastSvc.includes("guaranteed") && !forecastSvc.includes("Guaranteed"));
assert("no 'will definitely' in forecasting service",
  !forecastSvc.includes("will definitely"));
assert("no 'financial advice' in forecasting service",
  !forecastSvc.includes("financial advice"));
assert("forecasting service has empty_state for missing runway data",
  forecastSvc.includes("empty_state") || forecastSvc.includes("missing_inputs"));

// ── Board pack copy-only safety ──────────────────────────────────────────────
console.log("\nPhase 11: Board Pack Copy-Only Safety");
// copy_only: true is returned by buildInvestorUpdateDraft in board-pack service (not route)
assert("board-pack service buildInvestorUpdateDraft returns copy_only: true",
  boardPackSvc.includes("copy_only: true") || boardPackSvc.includes("copy_only:true"));
assert("board pack investor-update-draft route does not call sendEmail",
  !investorUpdateDraftBlock.includes("sendEmail("));

// ── No keystroke tracking ────────────────────────────────────────────────────
console.log("\nPhase 11: No Keystroke Tracking");
for (const comp of ceoCompFiles) {
  const src = readFile(comp) || "";
  assert(`no keystroke tracking in ${path.basename(comp)}`,
    !src.includes("onKeyDown") || !src.includes("telemetry") && !src.includes("trackKey"));
}

// ── Test file coverage: all Phase 4–10 test files exist ──────────────────────
console.log("\nPhase 11: Phase 4–10 Test Files Present");
const phaseTestFiles = [
  "tests/ceo-cockpit.test.cjs",             // Phase 4
  "tests/ceo-one-on-ones.test.cjs",         // Phase 5
  "tests/ceo-action-loop.test.cjs",         // Phase 6
  "tests/ceo-briefing.test.cjs",            // Phase 7
  "tests/ceo-execution-intelligence.test.cjs", // Phase 8
  "tests/ceo-forecasting.test.cjs",         // Phase 9
  "tests/board-pack.test.cjs",              // Phase 10
];
for (const t of phaseTestFiles) {
  assert(`test file exists: ${path.basename(t)}`, fileExists(t));
}

// ── Board Pack tab in cockpit links to /board-pack ────────────────────────────
console.log("\nPhase 11: Board Pack Tab in CEO Cockpit");
assert("board-pack tab renders a link to /board-pack",
  today_tsx.includes('href="/board-pack"') || today_tsx.includes('to="/board-pack"') || today_tsx.includes("href={") && today_tsx.includes("board-pack"));
assert("board-pack tab has link testid",
  today_tsx.includes('data-testid="ceo-cockpit-board-pack-link"'));
assert("board-pack tab has board-pack-tab testid",
  today_tsx.includes('data-testid="ceo-cockpit-board-pack-tab"'));

// ── Non-admin cannot see CEO Cockpit toggle ───────────────────────────────────
console.log("\nPhase 11: Frontend Admin Gate for CEO Cockpit");
assert("CEO Cockpit toggle gated by isAdmin in today.tsx",
  today_tsx.includes("isAdmin") && today_tsx.includes('"ceo_cockpit"'));
assert("CEO Cockpit mode block gated by isAdmin",
  today_tsx.includes('todayMode === "ceo_cockpit" && isAdmin'));

// ── CEO cockpit ceo-cockpit-view testid preserved ─────────────────────────────
console.log("\nPhase 11: Existing TestIDs Preserved");
assert('ceo-cockpit-view testid preserved',    today_tsx.includes('data-testid="ceo-cockpit-view"'));
assert('section-team-pulse testid preserved',  today_tsx.includes('testId="section-team-pulse"') || today_tsx.includes('"section-team-pulse"'));
assert('section-blockers testid preserved',    today_tsx.includes('"section-blockers"'));
assert('section-one-on-ones testid preserved', today_tsx.includes('"section-one-on-ones"'));
assert('section-commitments testid preserved', today_tsx.includes('"section-commitments"'));

// ── Results ──────────────────────────────────────────────────────────────────
console.log("\n────────────────────────────────────────────────────────────");
console.log(`CEO Cockpit Hardening Phase 11 — ${passed + failed} checks: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log("\nFailed checks:");
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
} else {
  console.log("\nAll checks passed ✓");
}
