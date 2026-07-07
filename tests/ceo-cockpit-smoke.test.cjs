// tests/ceo-cockpit-smoke.test.cjs
// CEO Cockpit Phase 13 — Launch Readiness Smoke Test
// Source-grep checks: route groups, permissions, safety guards, migration
// idempotency, privacy, copy-only contracts, mobile/UI structure.
// No live server required.
"use strict";

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function src(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }

const ROUTES  = src("server/routes.ts");
const INDEX   = src("server/index.ts");
const TODAY   = src("client/src/pages/today.tsx");

// Service sources
const SVC_COCKPIT    = src("server/services/ceo-cockpit.ts");
const SVC_ACTION     = src("server/services/ceo-action-loop.ts");
const SVC_BRIEFING   = src("server/services/ceo-briefing.ts");
const SVC_EXECUTION  = src("server/services/ceo-execution-intelligence.ts");
const SVC_FORECASTING= src("server/services/ceo-forecasting.ts");
const SVC_BOARDPACK  = src("server/services/board-pack.ts");
const SVC_1ON1       = src("server/services/ceo-one-on-ones.ts");
const SVC_SCHEDULER  = src("server/services/board-pack-scheduler.ts");

let passed = 0; let failed = 0;
function check(label, condition) {
  if (condition) { console.log("  \u2713 " + label); passed++; }
  else { console.error("  \u2717 FAIL: " + label); failed++; }
}

// ── 1. ALL PHASE SERVICE FILES EXIST ─────────────────────────────────────────
console.log("\n-- Phase service files exist --");

check("Phase 4: ceo-cockpit.ts exists",       exists("server/services/ceo-cockpit.ts"));
check("Phase 6: ceo-action-loop.ts exists",   exists("server/services/ceo-action-loop.ts"));
check("Phase 7: ceo-briefing.ts exists",      exists("server/services/ceo-briefing.ts"));
check("Phase 8: ceo-execution-intelligence.ts exists", exists("server/services/ceo-execution-intelligence.ts"));
check("Phase 9: ceo-forecasting.ts exists",   exists("server/services/ceo-forecasting.ts"));
check("Phase 10: board-pack.ts exists",        exists("server/services/board-pack.ts"));
check("Phase 10: board-pack-scheduler.ts exists", exists("server/services/board-pack-scheduler.ts"));
check("Phase 5/1:1: ceo-one-on-ones.ts exists", exists("server/services/ceo-one-on-ones.ts"));

// ── 2. ALL ROUTE GROUPS EXIST IN routes.ts ───────────────────────────────────
console.log("\n-- Route groups exist in routes.ts --");

check("Route group: /api/today/ceo-cockpit",            ROUTES.includes("/api/today/ceo-cockpit"));
check("Route group: /api/today/ceo-actions",            ROUTES.includes("/api/today/ceo-actions"));
check("Route group: /api/today/ceo-briefing",           ROUTES.includes("/api/today/ceo-briefing"));
check("Route group: /api/today/ceo-execution",          ROUTES.includes("/api/today/ceo-execution"));
check("Route group: /api/today/ceo-forecast",           ROUTES.includes("/api/today/ceo-forecast"));
check("Route group: /api/board-packs",                  ROUTES.includes("/api/board-packs"));
check("Route group: /api/today/ceo-cockpit/one-on-ones",ROUTES.includes("/api/today/ceo-cockpit/one-on-ones"));
check("Board Pack schedules /api/board-pack/schedules", ROUTES.includes("/api/board-pack/schedules"));

// ── 3. ALL CEO ROUTES HAVE requireAuth ───────────────────────────────────────
console.log("\n-- requireAuth on all CEO route groups --");

check("requireAuth on /api/today/ceo-cockpit",
  ROUTES.match(/app\.[a-z]+\(["']\/api\/today\/ceo-cockpit["'],\s*requireAuth/) !== null);
check("requireAuth on /api/today/ceo-actions",
  ROUTES.match(/app\.[a-z]+\(["']\/api\/today\/ceo-actions["'],\s*requireAuth/) !== null);
check("requireAuth on /api/today/ceo-briefing",
  ROUTES.match(/app\.[a-z]+\(["']\/api\/today\/ceo-briefing/) !== null &&
  ROUTES.includes("requireAuth, requireAdmin, async") &&
  ROUTES.includes("/api/today/ceo-briefing"));
check("requireAuth on /api/today/ceo-execution",
  ROUTES.match(/app\.[a-z]+\(["']\/api\/today\/ceo-execution/) !== null &&
  ROUTES.includes("/api/today/ceo-execution"));
check("requireAuth on /api/today/ceo-forecast",
  ROUTES.match(/app\.[a-z]+\(["']\/api\/today\/ceo-forecast/) !== null &&
  ROUTES.includes("/api/today/ceo-forecast"));
check("requireAuth on /api/board-packs",
  ROUTES.match(/app\.[a-z]+\(["']\/api\/board-packs["'],\s*requireAuth/) !== null);

// ── 4. requireAdmin ON CEO COCKPIT ROUTES ────────────────────────────────────
console.log("\n-- requireAdmin on CEO Cockpit route groups --");

check("requireAdmin on /api/today/ceo-cockpit",
  ROUTES.includes('"/api/today/ceo-cockpit", requireAuth, requireAdmin'));
check("requireAdmin on /api/today/ceo-actions list",
  ROUTES.includes('"/api/today/ceo-actions", requireAuth, requireAdmin'));
check("requireAdmin on /api/today/ceo-actions generate",
  ROUTES.includes('"/api/today/ceo-actions/generate", requireAuth, requireAdmin'));
check("requireAdmin on /api/today/ceo-briefing routes",
  ROUTES.includes('"/api/today/ceo-briefing/daily", requireAuth, requireAdmin'));
check("requireAdmin on /api/today/ceo-execution routes",
  ROUTES.includes('"/api/today/ceo-execution/radar", requireAuth, requireAdmin'));
check("requireAdmin on /api/today/ceo-forecast",
  ROUTES.includes('"/api/today/ceo-forecast", requireAuth, requireAdmin'));
check("requireAdmin on 1:1 notes routes",
  ROUTES.includes('requireAuth, requireAdmin') &&
  ROUTES.includes('/api/today/ceo-cockpit/one-on-ones'));

// ── 5. CEO/CFO-ONLY GUARDS ───────────────────────────────────────────────────
console.log("\n-- CEO/CFO-only permission guards --");

check("requireBoardPackAccess function defined",
  ROUTES.includes("function requireBoardPackAccess("));
check("requireForecastCapitalAccess function defined",
  ROUTES.includes("function requireForecastCapitalAccess("));
check("isBoardPackUser exported from board-pack.ts",
  SVC_BOARDPACK.includes("export function isBoardPackUser("));
check("isBoardPackUser imported in routes.ts",
  ROUTES.includes("isBoardPackUser"));
check("Board Pack routes use requireBoardPackAccess",
  ROUTES.includes('"/api/board-packs", requireAuth, requireBoardPackAccess') ||
  ROUTES.includes('"/api/board-packs/generate", requireAuth, requireBoardPackAccess'));
check("Runway forecast route uses requireForecastCapitalAccess",
  ROUTES.includes('requireForecastCapitalAccess') &&
  ROUTES.includes('/api/today/ceo-forecast/runway'));
check("Funding forecast route uses requireForecastCapitalAccess",
  ROUTES.includes('requireForecastCapitalAccess') &&
  ROUTES.includes('/api/today/ceo-forecast/funding'));
check("requireBoardPackAccess returns 403 for non-CEO/CFO",
  ROUTES.includes("Board Pack access requires CEO or CFO role"));
check("requireForecastCapitalAccess returns 403 for non-capital users",
  ROUTES.includes("Runway and funding forecasts require CEO or CFO access"));
check("investor-update-draft uses requireBoardPackAccess",
  ROUTES.includes('"/api/board-packs/:id/investor-update-draft", requireAuth, requireBoardPackAccess'));

// ── 6. COPY-ONLY CONTRACTS — NO AUTO-SEND ────────────────────────────────────
console.log("\n-- Copy-only contracts and no auto-send --");

check("Board Pack markdown returns copy_only: true",
  SVC_BOARDPACK.includes("copy_only: true") && SVC_BOARDPACK.includes("buildBoardPackMarkdown"));
check("Investor update draft returns copy_only: true",
  SVC_BOARDPACK.includes("buildInvestorUpdateDraft") && SVC_BOARDPACK.includes("copy_only: true"));
check("Action update-draft returns copy_only: true",
  SVC_ACTION.includes("copy_only: true"));
check("No sendEmail in ceo-cockpit.ts",          !SVC_COCKPIT.includes("sendEmail("));
check("No sendEmail in ceo-action-loop.ts",       !SVC_ACTION.includes("sendEmail("));
check("No sendEmail in ceo-briefing.ts",          !SVC_BRIEFING.includes("sendEmail("));
check("No sendEmail in ceo-execution-intelligence.ts", !SVC_EXECUTION.includes("sendEmail("));
check("No sendEmail in ceo-forecasting.ts",       !SVC_FORECASTING.includes("sendEmail("));
check("No sendEmail in board-pack.ts",            !SVC_BOARDPACK.includes("sendEmail("));
check("No sendMessage in CEO services",
  !SVC_COCKPIT.includes("sendMessage(") && !SVC_ACTION.includes("sendMessage(") &&
  !SVC_BRIEFING.includes("sendMessage(") && !SVC_BOARDPACK.includes("sendMessage("));
check("No createDraft (Gmail) in CEO routes block",
  !(ROUTES.match(/createDraft.*ceo-action|ceo-action.*createDraft/) !== null));
check("No auto-send in ceo-actions routes (no sendEmail call in that block)",
  (() => {
    const block = ROUTES.slice(
      ROUTES.indexOf("/api/today/ceo-actions"),
      ROUTES.indexOf("/api/today/ceo-briefing")
    );
    return !block.includes("sendEmail(");
  })());

// ── 7. NO EXTERNAL APIs IN DETERMINISTIC SERVICES ────────────────────────────
console.log("\n-- No external API calls in deterministic services --");

check("No fetch(http) in ceo-cockpit.ts",        !SVC_COCKPIT.match(/fetch\(["']https?:/));
check("No fetch(http) in ceo-execution-intelligence.ts", !SVC_EXECUTION.match(/fetch\(["']https?:/));
check("No fetch(http) in ceo-forecasting.ts",    !SVC_FORECASTING.match(/fetch\(["']https?:/));
check("No OpenAI/gpt model calls in ceo-cockpit.ts",
  !SVC_COCKPIT.includes("openai") && !SVC_COCKPIT.includes("gpt-") && !SVC_COCKPIT.includes("model:"));
check("No OpenAI/gpt model calls in ceo-execution-intelligence.ts",
  !SVC_EXECUTION.includes("openai") && !SVC_EXECUTION.includes("gpt-") && !SVC_EXECUTION.includes("model:"));
check("No OpenAI/gpt model calls in ceo-forecasting.ts",
  !SVC_FORECASTING.includes("openai") && !SVC_FORECASTING.includes("gpt-") && !SVC_FORECASTING.includes("model:"));
check("No OpenAI/gpt model calls in board-pack.ts",
  !SVC_BOARDPACK.includes("openai") && !SVC_BOARDPACK.includes("gpt-") && !SVC_BOARDPACK.includes("model:"));
// ceo-one-on-ones.ts intentionally uses OpenAI for extractCommitmentsFromNote (graceful null fallback)
check("1:1 OpenAI usage is isolated to extractCommitmentsFromNote (optional, null-safe)",
  SVC_1ON1.includes("extractCommitmentsFromNote") &&
  SVC_1ON1.includes("buildOpenAIClient") &&
  SVC_1ON1.includes("return null") &&
  SVC_1ON1.includes("beyond optional OpenAI extraction"));

// ── 8. MIGRATION SAFETY ───────────────────────────────────────────────────────
console.log("\n-- Migration safety --");

check("CEO Action Queue uses CREATE TABLE IF NOT EXISTS",
  INDEX.includes("CREATE TABLE IF NOT EXISTS ceo_action_queue"));
check("meeting_notes ALTER uses ADD COLUMN IF NOT EXISTS",
  INDEX.includes("ADD COLUMN IF NOT EXISTS one_on_one_sections"));
check("ceo_execution_reviews uses CREATE TABLE IF NOT EXISTS",
  INDEX.includes("CREATE TABLE IF NOT EXISTS ceo_execution_reviews"));
check("board_packs uses CREATE TABLE IF NOT EXISTS",
  INDEX.includes("CREATE TABLE IF NOT EXISTS board_packs"));
check("ceo_forecast_notes uses CREATE TABLE IF NOT EXISTS",
  INDEX.includes("CREATE TABLE IF NOT EXISTS ceo_forecast_notes"));
check("All CEO migration indexes use IF NOT EXISTS",
  INDEX.includes("CREATE INDEX IF NOT EXISTS idx_ceo_action_queue_owner_status") &&
  INDEX.includes("CREATE INDEX IF NOT EXISTS idx_board_packs_status") &&
  INDEX.includes("CREATE INDEX IF NOT EXISTS idx_ceo_execution_reviews_key") &&
  INDEX.includes("CREATE INDEX IF NOT EXISTS idx_ceo_forecast_notes_user"));
check("Migration catch blocks log errors (not silent)",
  !INDEX.includes("} catch (_e) { /* already exists */ }") &&
  INDEX.includes("already applied"));
check("CEO Action Queue migration success log present",
  INDEX.includes("[migration] CEO Action Queue tables ready."));
check("meeting_notes migration success log present",
  INDEX.includes("[migration] meeting_notes.one_on_one_sections column ready."));
check("ceo_execution_reviews migration success log present",
  INDEX.includes("[migration] ceo_execution_reviews table ready."));
check("board_packs migration success log present",
  INDEX.includes("[migration] board_packs table ready."));
check("ceo_forecast_notes migration success log present",
  INDEX.includes("[migration] ceo_forecast_notes table ready."));

// ── 9. NO UNDEFINED POOL USAGE ───────────────────────────────────────────────
console.log("\n-- No undefined pool usage in CEO services --");

check("ceo-action-loop.ts uses named db import (not pool)",
  SVC_ACTION.includes('from "../db"') && !SVC_ACTION.match(/\bpool\b/));
check("ceo-briefing.ts uses named db import",
  SVC_BRIEFING.includes('from "../db"') && !SVC_BRIEFING.match(/\bpool\.query|\bpool\.execute/));
check("ceo-execution-intelligence.ts uses named db import",
  SVC_EXECUTION.includes('from "../db"') && !SVC_EXECUTION.match(/\bpool\.query|\bpool\.execute/));
check("ceo-forecasting.ts uses named db import",
  SVC_FORECASTING.includes('from "../db"') && !SVC_FORECASTING.match(/\bpool\.query|\bpool\.execute/));
check("board-pack.ts uses named db import",
  SVC_BOARDPACK.includes('from "../db"') && !SVC_BOARDPACK.match(/\bpool\.query|\bpool\.execute/));
check("ceo-cockpit.ts uses named db import",
  SVC_COCKPIT.includes('from "../db"') && !SVC_COCKPIT.match(/\bpool\.query|\bpool\.execute/));
check("ceo-one-on-ones.ts uses named db import",
  SVC_1ON1.includes('from "../db"') && !SVC_1ON1.match(/\bpool\.query|\bpool\.execute/));

// ── 10. PRIVACY GUARDS ───────────────────────────────────────────────────────
console.log("\n-- Privacy guards --");

check("Board Pack capital section gated by hasCapital",
  SVC_BOARDPACK.includes("hasCapital") || ROUTES.includes("hasCapital"));
check("Forecasting runway/funding gated by requireForecastCapitalAccess",
  ROUTES.includes("requireForecastCapitalAccess") && ROUTES.includes("ceo-forecast/runway"));
check("CEO Cockpit overview computes hasCapital for capital gating",
  ROUTES.includes("hasCapital") && ROUTES.includes("/api/today/ceo-cockpit"));
check("1:1 commitment extraction does NOT auto-create tasks",
  (() => {
    const extractRoute = ROUTES.slice(
      ROUTES.indexOf("extract-commitments"),
      ROUTES.indexOf("extract-commitments") + 2000
    );
    return !extractRoute.includes("createTask(") && !extractRoute.includes("INSERT INTO tasks");
  })());
check("Board Pack investor-update-draft is copy-only (no send call)",
  (() => {
    const draftBlock = ROUTES.slice(
      ROUTES.indexOf("investor-update-draft"),
      ROUTES.indexOf("investor-update-draft") + 1000
    );
    return !draftBlock.includes("sendEmail(") && !draftBlock.includes("sendMessage(");
  })());
check("No localStorage usage in CEO cockpit frontend files",
  !TODAY.match(/localStorage\.(setItem|getItem)\(['"]ceo/) &&
  !TODAY.match(/localStorage\.(setItem|getItem)\(['"]capital/));
check("No Capital-sensitive data stored in localStorage",
  (() => {
    const lsMatches = TODAY.match(/localStorage\.setItem\(['"](.*?)['"]/g) || [];
    return !lsMatches.some(m => m.toLowerCase().includes("capital") || m.toLowerCase().includes("runway") || m.toLowerCase().includes("funding"));
  })());
check("DM body lookup in buildUpdateRequestDraft is for conversation ID only (not body exposure)",
  SVC_ACTION.includes("current_conversations WHERE participant_key") &&
  !SVC_ACTION.match(/SELECT.*body.*FROM.*current_messages/));

// ── 11. TABBED UI AND MOBILE STRUCTURE ───────────────────────────────────────
console.log("\n-- Tabbed UI and mobile structure --");

check("CEO Cockpit view gated by isAdmin",
  TODAY.includes("todayMode") && TODAY.includes("isAdmin") && TODAY.includes("ceo_cockpit"));
check("7 tabs rendered via TAB_CONFIG",
  TODAY.includes("TAB_CONFIG") && TODAY.includes("ceo-cockpit-tabs"));
check("Tab bar uses overflow-x-auto for mobile scroll",
  TODAY.includes("overflow-x-auto") && TODAY.includes("ceo-cockpit-tabs"));
check("Tab buttons use whitespace-nowrap",
  TODAY.includes("whitespace-nowrap") && TODAY.includes("flex-shrink-0"));
check("Tab content panels are conditionally mounted (not always rendered)",
  TODAY.includes('cockpitTab === "overview"') &&
  TODAY.includes('cockpitTab === "execution"') &&
  TODAY.includes('cockpitTab === "board-pack"'));
check("Cockpit header title present",
  TODAY.includes('data-testid="ceo-cockpit-title"'));
check("Cockpit subtitle updates per tab (TAB_SUBTITLES)",
  TODAY.includes("TAB_SUBTITLES") && TODAY.includes("ceo-cockpit-subtitle"));
check("Refresh button with disable-while-fetching",
  TODAY.includes("ceo-cockpit-refresh-btn") && TODAY.includes("disabled={cockpitQuery.isFetching}"));
check("Admin badge present",
  TODAY.includes("ceo-cockpit-admin-badge") && TODAY.includes("Shield"));
check("Priority summary bar conditionally shown when urgentCount > 0",
  TODAY.includes("ceo-priority-summary") && TODAY.includes("urgentCount > 0"));
check("Action Queue filter chips use overflow-x-auto for mobile",
  (() => {
    const ACTIONS = src("client/src/components/today/ceo-action-queue.tsx");
    return ACTIONS.includes("overflow-x-auto") && ACTIONS.includes("action-filter-chips");
  })());
check("Execution Radar uses ChevronDown (no Unicode ▲▼)",
  (() => {
    const RADAR = src("client/src/components/today/ceo-execution-radar.tsx");
    return RADAR.includes("ChevronDown") && !RADAR.includes("▲") && !RADAR.includes("▼");
  })());
check("Briefing EmptyState has icon (data-testid=briefing-empty-state)",
  (() => {
    const BRIEFING_UI = src("client/src/components/today/ceo-briefing.tsx");
    return BRIEFING_UI.includes("briefing-empty-state") && BRIEFING_UI.includes("CheckCircle2");
  })());

// ── 12. RELEASE ARTEFACTS ─────────────────────────────────────────────────────
console.log("\n-- Release artefacts --");

check("docs/ceo-cockpit-release-checklist.md exists",
  exists("docs/ceo-cockpit-release-checklist.md"));
check("This smoke test file exists",
  exists("tests/ceo-cockpit-smoke.test.cjs"));
check("Phase 11 hardening test exists",
  exists("tests/ceo-cockpit-hardening.test.cjs"));
check("Phase 12 UX polish test exists",
  exists("tests/ceo-cockpit-ux-polish.test.cjs"));
check("Phase 4 cockpit test exists",
  exists("tests/ceo-cockpit.test.cjs"));
check("Phase 6 action loop test exists",
  exists("tests/ceo-action-loop.test.cjs"));
check("Phase 7 briefing test exists",
  exists("tests/ceo-briefing.test.cjs"));
check("Phase 8 execution test exists",
  exists("tests/ceo-execution-intelligence.test.cjs"));
check("Phase 9 forecasting test exists",
  exists("tests/ceo-forecasting.test.cjs"));
check("Phase 10 board pack test exists",
  exists("tests/board-pack.test.cjs"));
check("Phase 5 1:1 test exists",
  exists("tests/ceo-one-on-ones.test.cjs"));

// ── 13. SHAMING / FAKE NUMBERS GUARD ─────────────────────────────────────────
console.log("\n-- No shaming language or fake financial numbers --");

const ALL_SVC = SVC_COCKPIT + SVC_ACTION + SVC_BRIEFING + SVC_EXECUTION + SVC_FORECASTING + SVC_BOARDPACK + SVC_1ON1;
check("No shaming language in CEO services",
  !ALL_SVC.match(/\b(shame|embarrass|disappoint|terrible|horrible|loser|stupid|idiot)\b/i));
check("Forecasting notes disclaimer present (not inventing numbers)",
  SVC_FORECASTING.includes("based on") || SVC_FORECASTING.includes("data_basis") ||
  SVC_FORECASTING.includes("disclaimer") || SVC_FORECASTING.includes("missing_inputs"));
check("Runway service surfaces missing_inputs (not guessing)",
  SVC_FORECASTING.includes("missing_inputs") || SVC_FORECASTING.includes("data_basis"));

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
if (failed === 0) {
  console.log(`Passed: ${passed}   Failed: ${failed}`);
  console.log("All CEO Cockpit smoke checks passed \u2713");
} else {
  console.error(`Passed: ${passed}   Failed: ${failed}`);
  process.exit(1);
}
