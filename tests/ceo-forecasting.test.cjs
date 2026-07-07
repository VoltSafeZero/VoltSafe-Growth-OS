// tests/ceo-forecasting.test.cjs
// Phase 9: CEO Forecasting, Scenario Planning, and Runway Intelligence
// Source-grep tests — no live server required.

"use strict";
const fs   = require("fs");
const path = require("path");

const ROUTES   = path.join(__dirname, "../server/routes.ts");
const SERVICE  = path.join(__dirname, "../server/services/ceo-forecasting.ts");
const FRONTEND = path.join(__dirname, "../client/src/components/today/ceo-forecasting.tsx");
const TODAY    = path.join(__dirname, "../client/src/pages/today.tsx");
const INDEX    = path.join(__dirname, "../server/index.ts");

const routesSrc   = fs.readFileSync(ROUTES,   "utf-8");
const serviceSrc  = fs.readFileSync(SERVICE,  "utf-8");
const frontendSrc = fs.readFileSync(FRONTEND, "utf-8");
const todaySrc    = fs.readFileSync(TODAY,    "utf-8");
const indexSrc    = fs.readFileSync(INDEX,    "utf-8");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

function has(src, pattern, label) {
  const found = typeof pattern === "string" ? src.includes(pattern) : pattern.test(src);
  if (!found) throw new Error(`Expected to find: ${label ?? String(pattern)}`);
}

function hasNot(src, pattern, label) {
  const found = typeof pattern === "string" ? src.includes(pattern) : pattern.test(src);
  if (found) throw new Error(`Should NOT find: ${label ?? String(pattern)}`);
}

// ── 1. Service file exists and exports all required functions ──────────────────
console.log("\nPhase 9: Service File");

test("service file exists", () => {
  if (!fs.existsSync(SERVICE)) throw new Error("ceo-forecasting.ts not found");
});

test("exports buildCeoForecast", () => has(serviceSrc, "export async function buildCeoForecast"));
test("exports buildScenarioPlan", () => has(serviceSrc, "export async function buildScenarioPlan"));
test("exports buildRunwayIntelligence", () => has(serviceSrc, "export async function buildRunwayIntelligence"));
test("exports buildRevenueForecast", () => has(serviceSrc, "export async function buildRevenueForecast"));
test("exports buildExecutionForecast", () => has(serviceSrc, "export async function buildExecutionForecast"));
test("exports buildFundingForecast", () => has(serviceSrc, "export async function buildFundingForecast"));
test("exports buildForecastInterventions", () => has(serviceSrc, "export async function buildForecastInterventions"));
test("exports saveScenarioNote", () => has(serviceSrc, "export async function saveScenarioNote"));
test("exports createForecastActions", () => has(serviceSrc, "export async function createForecastActions"));

// ── 2. Service imports from Phase 6, 7/8 ──────────────────────────────────────
console.log("\nPhase 9: Service Dependencies");

test("reuses Phase 8 ExecutionActorUser type", () => has(serviceSrc, "ExecutionActorUser"));
test("imports detectExecutionDrift from Phase 8", () => has(serviceSrc, "detectExecutionDrift"));
test("imports buildCommitmentsRadar from Phase 8", () => has(serviceSrc, "buildCommitmentsRadar"));
test("imports buildRecurringRiskPatterns from Phase 8", () => has(serviceSrc, "buildRecurringRiskPatterns"));
test("imports buildExecutionScorecard from Phase 8", () => has(serviceSrc, "buildExecutionScorecard"));
test("imports createCeoAction from Phase 6", () => has(serviceSrc, "createCeoAction"));
test("uses local db — no external API", () => has(serviceSrc, 'import { db } from "../db"'));

// ── 3. Safety: no auto-send, no AI, no external API ───────────────────────────
console.log("\nPhase 9: Safety Checks");

test("no sendEmail call in service", () => hasNot(serviceSrc, "sendEmail("));
test("no sendMessage call in service", () => hasNot(serviceSrc, "sendMessage("));
test("no openai call in service", () => hasNot(serviceSrc, "openai."));
test("no fetch() external call", () => hasNot(serviceSrc, /fetch\(["']https?:\/\//));
test("capital/runway gate checks hasCapital", () => has(serviceSrc, "!actorUser.hasCapital"));
test("runway returns access_denied for non-capital users", () => has(serviceSrc, "access_denied: true"));
test("runway does not invent numbers when missing", () => has(serviceSrc, "missing_inputs"));
test("no guaranteed/certain language in service", () => hasNot(serviceSrc, /\b(guaranteed|will definitely|prediction engine|scientifically predicts|financial advice)\b/));
test("uses planning assumption language", () => has(serviceSrc, "planning assumption"));
test("no private Currents channels fetched broadly", () => hasNot(serviceSrc, /channel.*is_private.*=.*true/));
test("no DM bodies broadly exposed", () => hasNot(serviceSrc, /dm.*body/i));

// ── 4. Routes exist with correct auth guards ───────────────────────────────────
console.log("\nPhase 9: Routes");

test("ceo-forecast import in routes.ts", () => has(routesSrc, "from \"./services/ceo-forecasting\""));
test("GET /api/today/ceo-forecast route", () => has(routesSrc, '"/api/today/ceo-forecast"'));
test("GET /api/today/ceo-forecast/scenarios route", () => has(routesSrc, '"/api/today/ceo-forecast/scenarios"'));
test("GET /api/today/ceo-forecast/runway route", () => has(routesSrc, '"/api/today/ceo-forecast/runway"'));
test("GET /api/today/ceo-forecast/revenue route", () => has(routesSrc, '"/api/today/ceo-forecast/revenue"'));
test("GET /api/today/ceo-forecast/execution route", () => has(routesSrc, '"/api/today/ceo-forecast/execution"'));
test("GET /api/today/ceo-forecast/funding route", () => has(routesSrc, '"/api/today/ceo-forecast/funding"'));
test("GET /api/today/ceo-forecast/interventions route", () => has(routesSrc, '"/api/today/ceo-forecast/interventions"'));
test("POST /api/today/ceo-forecast/interventions/create-actions route", () => has(routesSrc, '"/api/today/ceo-forecast/interventions/create-actions"'));
test("POST /api/today/ceo-forecast/scenario-note route", () => has(routesSrc, '"/api/today/ceo-forecast/scenario-note"'));
test("GET /api/today/ceo-forecast/notes route", () => has(routesSrc, '"/api/today/ceo-forecast/notes"'));

// ── 5. All routes require auth + admin ────────────────────────────────────────
console.log("\nPhase 9: Auth Guards");

test("forecast routes use requireAuth", () => has(routesSrc, "requireAuth, requireAdmin, async (req: any, res) => {\n    try {\n      const userId = Number((req.session as any).userId);\n      const row = await db.execute(sql`SELECT name, permissions"));
test("requireForecastCapitalAccess defined for runway/funding", () => has(routesSrc, "requireForecastCapitalAccess"));
test("runway route uses capital access guard", () => has(routesSrc, "requireForecastCapitalAccess, async (req: any, res) => {\n    try {\n      const userId = Number((req.session as any).userId);\n      const row = await db.execute(sql`SELECT name FROM users"));
test("funding route uses capital access guard", () => has(routesSrc, '"/api/today/ceo-forecast/funding", requireAuth, requireAdmin, requireForecastCapitalAccess'));
test("capital access guard checks isBoardPackUser (CEO/CFO)", () => has(routesSrc, "isBoardPackUser(u?.id, u?.email)"));
test("capital access guard returns 403 for non-capital users", () => has(routesSrc, 'Runway and funding forecasts require CEO or CFO access.'));
test("capital access guard returns 401 if unauthenticated", () => has(routesSrc, /requireForecastCapitalAccess[\s\S]{0,300}Not authenticated/));

// ── 6. CEO (Trevor) and CFO (Scott) access ────────────────────────────────────
console.log("\nPhase 9: CEO/CFO Access Patterns");

test("isBoardPackUser used to check CEO/CFO access for forecast", () => {
  const count = (routesSrc.match(/isBoardPackUser/g) || []).length;
  if (count < 2) throw new Error(`Expected isBoardPackUser used multiple times, found ${count}`);
});
test("hasCapital derived from permissions column", () => has(routesSrc, 'u?.permissions?.capital !== "none"'));

// ── 7. Runway returns empty state, not fake numbers ────────────────────────────
console.log("\nPhase 9: Runway Empty State");

test("runway empty_state field returned when missing data", () => has(serviceSrc, "empty_state: true"));
test("runway message says no estimated number shown", () => has(serviceSrc, "No runway number is shown"));
test("runway returns missing_inputs list", () => has(serviceSrc, "missing_inputs: missing"));
test("runway does not estimate without cash and burn", () => {
  const emptyBlock = serviceSrc.slice(serviceSrc.indexOf("if (!round || !cash || !burn)"), serviceSrc.indexOf("const runwayToday = cash / burn"));
  has(emptyBlock, "return {", "empty_state early return");
});
test("runway does not invent financial numbers", () => hasNot(serviceSrc, /runway_today_months:\s*\d+[^|]/));

// ── 8. Revenue forecast handles missing data gracefully ───────────────────────
console.log("\nPhase 9: Revenue Forecast");

test("revenue forecast returns section field", () => has(serviceSrc, '"revenue_forecast"'));
test("revenue handles missing probability (defaults to 20%)", () => has(serviceSrc, "COALESCE(probability_pct, 20)"));
test("revenue identifies stale opportunities (30+ days)", () => has(serviceSrc, "thirtyDaysAgo"));
test("revenue identifies slipped opportunities", () => has(serviceSrc, "slipped_opportunities"));
test("revenue identifies high-confidence opportunities", () => has(serviceSrc, "high_confidence_opportunities"));
test("revenue returns monthly_forecast array", () => has(serviceSrc, "monthly_forecast"));
test("revenue returns blockers_to_revenue", () => has(serviceSrc, "blockers_to_revenue"));
test("revenue returns recommended_ceo_actions", () => has(serviceSrc, "recommended_ceo_actions"));
test("revenue has try/catch for resilience", () => {
  const revFn = serviceSrc.slice(serviceSrc.indexOf("export async function buildRevenueForecast"), serviceSrc.indexOf("export async function buildRunwayIntelligence"));
  has(revFn, "} catch (err: any) {");
});

// ── 9. Scenario plan returns Base/Upside/Downside ─────────────────────────────
console.log("\nPhase 9: Scenario Planning");

test("scenario plan returns base_case", () => has(serviceSrc, "base_case:"));
test("scenario plan returns upside_case", () => has(serviceSrc, "upside_case:"));
test("scenario plan returns downside_case", () => has(serviceSrc, "downside_case:"));
test("each scenario has revenue_implication", () => has(serviceSrc, "revenue_implication:"));
test("each scenario has key_assumptions", () => has(serviceSrc, "key_assumptions:"));
test("each scenario has top_risks", () => has(serviceSrc, "top_risks:"));
test("each scenario has recommended_actions", () => has(serviceSrc, "recommended_actions:"));
test("base case multiplier ~0.85 for commit", () => has(serviceSrc, "commitAmt * 0.85"));
test("upside case multiplier ~0.95 for commit", () => has(serviceSrc, "commitAmt * 0.95"));
test("downside case multiplier ~0.60 for commit", () => has(serviceSrc, "commitAmt * 0.60"));
test("scenario language uses 'suggests'", () => has(serviceSrc, "Suggests"));
test("scenario language uses 'planning assumption'", () => has(serviceSrc, "planning assumption"));
test("no banned certainty phrases in scenarios", () => {
  const scenarioBlock = serviceSrc.slice(serviceSrc.indexOf("export async function buildScenarioPlan"), serviceSrc.indexOf("// ── 6."));
  hasNot(scenarioBlock, /\b(guaranteed|will definitely|scientifically predicts|financial advice)\b/);
});

// ── 10. Execution forecast reuses Phase 8 ─────────────────────────────────────
console.log("\nPhase 9: Execution Forecast");

test("execution forecast calls detectExecutionDrift", () => has(serviceSrc, "detectExecutionDrift(actorUser)"));
test("execution forecast calls buildCommitmentsRadar", () => has(serviceSrc, "buildCommitmentsRadar(actorUser)"));
test("execution forecast calls buildRecurringRiskPatterns", () => has(serviceSrc, "buildRecurringRiskPatterns(actorUser)"));
test("execution forecast calls buildExecutionScorecard", () => has(serviceSrc, "buildExecutionScorecard(actorUser)"));
test("execution forecast returns likely_slips", () => has(serviceSrc, "likelySlips"));
test("execution forecast returns at_risk_commitments", () => has(serviceSrc, "at_risk_commitments"));
test("execution forecast returns owner_load_risks", () => has(serviceSrc, "owner_load_risks"));
test("execution forecast returns stale_tasks_count", () => has(serviceSrc, "stale_tasks_count"));

// ── 11. Interventions use Phase 6 action queue ────────────────────────────────
console.log("\nPhase 9: Intervention / Action Queue Integration");

test("createForecastActions calls createCeoAction", () => has(serviceSrc, "await createCeoAction("));
test("intervention type mapped to review_commitment or follow_up", () => has(serviceSrc, "review_commitment"));
test("intervention limit is 5 max per batch", () => has(serviceSrc, "interventions.slice(0, 5)"));
test("create-actions route rejects empty array", () => has(routesSrc, '!Array.isArray(interventions) || interventions.length === 0'));
test("no sendEmail in create-actions route", () => {
  const block = routesSrc.slice(routesSrc.indexOf("interventions/create-actions"), routesSrc.indexOf("scenario-note"));
  hasNot(block, "sendEmail");
});

// ── 12. Migration: ceo_forecast_notes table ───────────────────────────────────
console.log("\nPhase 9: Migration");

test("ceo_forecast_notes migration in index.ts", () => has(indexSrc, "ceo_forecast_notes"));
test("migration uses _db.execute pattern", () => has(indexSrc, "_db.execute(_sql.raw(`\n        CREATE TABLE IF NOT EXISTS ceo_forecast_notes"));
test("migration has scenario_type column", () => has(indexSrc, "scenario_type"));
test("migration has assumptions jsonb column", () => has(indexSrc, "assumptions        JSONB"));
test("migration has created_by_user_id column", () => has(indexSrc, "created_by_user_id INTEGER NOT NULL REFERENCES users(id)"));
test("migration creates index on scenario_type", () => has(indexSrc, "idx_ceo_forecast_notes_type"));
test("migration logs ready message", () => has(indexSrc, "[migration] ceo_forecast_notes table ready."));

// ── 13. Frontend: Forecasting panel exists ────────────────────────────────────
console.log("\nPhase 9: Frontend Panel");

test("ceo-forecasting.tsx exists", () => {
  if (!fs.existsSync(FRONTEND)) throw new Error("ceo-forecasting.tsx not found");
});
test("CeoForecastingPanel exported", () => has(frontendSrc, "export function CeoForecastingPanel"));
test("panel has data-testid ceo-forecasting-panel", () => has(frontendSrc, 'data-testid="ceo-forecasting-panel"'));
test("panel imports from ceo-forecasting in today.tsx", () => has(todaySrc, "from \"@/components/today/ceo-forecasting\""));
test("CeoForecastingPanel rendered in CEO Cockpit", () => has(todaySrc, "<CeoForecastingPanel"));

// ── 14. All 7 tabs render ─────────────────────────────────────────────────────
console.log("\nPhase 9: Frontend Tabs");

test("Overview tab renders", () => has(frontendSrc, 'data-testid="forecast-tab-overview"'));
test("Scenarios tab renders", () => has(frontendSrc, 'data-testid="forecast-tab-scenarios"'));
test("Runway tab renders", () => has(frontendSrc, 'data-testid="forecast-tab-runway"'));
test("Revenue tab renders", () => has(frontendSrc, 'data-testid="forecast-tab-revenue"'));
test("Execution tab renders", () => has(frontendSrc, 'data-testid="forecast-tab-execution"'));
test("Funding tab renders", () => has(frontendSrc, 'data-testid="forecast-tab-funding"'));
test("Assumptions tab renders", () => has(frontendSrc, 'data-testid="forecast-tab-assumptions"'));
test("tab triggers have data-testid", () => has(frontendSrc, 'data-testid={`forecast-tab-trigger-${t.id}`}'));

// ── 15. Frontend: create-action button wired ──────────────────────────────────
console.log("\nPhase 9: Frontend Action Buttons");

test("create-action button exists", () => has(frontendSrc, 'data-testid="btn-create-forecast-actions"'));
test("create-action calls POST interventions/create-actions", () => has(frontendSrc, '"/api/today/ceo-forecast/interventions/create-actions"'));
test("refresh button exists", () => has(frontendSrc, 'data-testid="btn-refresh-forecast"'));
test("copy assumptions button exists", () => has(frontendSrc, 'data-testid="btn-copy-assumptions"'));
test("invalidates ceo-actions query on action creation", () => has(frontendSrc, '"/api/today/ceo-actions"'));

// ── 16. Frontend: access denied for locked sections ───────────────────────────
console.log("\nPhase 9: Frontend Capital Gate UI");

test("access denied for runway section", () => has(frontendSrc, 'data-testid={`forecast-access-denied-${section}`}'));
test("access denied for funding section", () => has(frontendSrc, "AccessDeniedCard"));
test("lock icon shown for access denied", () => has(frontendSrc, "Lock"));
test("empty state for missing runway inputs", () => has(frontendSrc, "data.missing_inputs"));

// ── 17. Scenario cards render Base/Upside/Downside ───────────────────────────
console.log("\nPhase 9: Scenario Cards");

test("scenario-card-base testid", () => has(frontendSrc, 'data-testid={`scenario-card-${variant}`}'));
test("scenario-card-upside testid", () => { has(frontendSrc, "ScenarioCard"); has(frontendSrc, "upside_case"); });
test("scenario-card-downside testid", () => { has(frontendSrc, "ScenarioCard"); has(frontendSrc, "downside_case"); });
test("overview shows mini scenario cards", () => has(frontendSrc, 'data-testid={`overview-scenario-${variant}`}'));

// ── 18. Planning language in frontend ─────────────────────────────────────────
console.log("\nPhase 9: Frontend Planning Language");

test("planning note shown in tabs", () => has(frontendSrc, "Planning assumption only"));
test("no guaranteed/certain language in frontend", () => hasNot(frontendSrc, /\b(guaranteed|will definitely|scientifically predicts|financial advice)\b/));
test("revenue tab shows slipped opportunities", () => has(frontendSrc, 'data-testid={`slipped-opp-${o.id}`}'));
test("execution tab shows likely slips", () => has(frontendSrc, 'data-testid={`likely-slip-${i}`}'));
test("intervention items have testids", () => has(frontendSrc, 'data-testid={`intervention-item-${i}`}'));

// ── 19. No duplicate forecasting modules ─────────────────────────────────────
console.log("\nPhase 9: No Duplication");

test("no duplicate buildRunwayIntelligence import", () => {
  const matches = (routesSrc.match(/buildRunwayIntelligence/g) || []).length;
  if (matches < 1) throw new Error("buildRunwayIntelligence not found in routes");
  if (matches > 5) throw new Error(`buildRunwayIntelligence appears ${matches} times — possible duplicate`);
});
test("revenue_scenarios table not duplicated (using existing table)", () => {
  const serviceMatches = (serviceSrc.match(/revenue_scenarios/g) || []).length;
  if (serviceMatches > 1) throw new Error("ceo-forecasting.ts should not duplicate revenue_scenarios table");
});

// ── 20. Phase 4/5/6/7/8 regression — key service files still exist ────────────
console.log("\nPhase 9: Prior Phase Regression");

const phase6 = path.join(__dirname, "../server/services/ceo-action-loop.ts");
const phase7 = path.join(__dirname, "../server/services/ceo-briefing.ts");
const phase8 = path.join(__dirname, "../server/services/ceo-execution-intelligence.ts");
const phase4 = path.join(__dirname, "../server/services/ceo-cockpit.ts");
const phase10 = path.join(__dirname, "../server/services/board-pack.ts");

test("Phase 4 service still exists", () => { if (!fs.existsSync(phase4)) throw new Error("ceo-cockpit.ts missing"); });
test("Phase 6 service still exists", () => { if (!fs.existsSync(phase6)) throw new Error("ceo-action-loop.ts missing"); });
test("Phase 7 service still exists", () => { if (!fs.existsSync(phase7)) throw new Error("ceo-briefing.ts missing"); });
test("Phase 8 service still exists", () => { if (!fs.existsSync(phase8)) throw new Error("ceo-execution-intelligence.ts missing"); });
test("Phase 10 service still exists", () => { if (!fs.existsSync(phase10)) throw new Error("board-pack.ts missing"); });
test("Phase 6 action queue not overwritten", () => {
  const src6 = fs.readFileSync(phase6, "utf-8");
  has(src6, "export async function createCeoAction");
});
test("Phase 8 execution not overwritten", () => {
  const src8 = fs.readFileSync(phase8, "utf-8");
  has(src8, "export async function detectExecutionDrift");
});

// ── 21. Routes: no auto-send pattern in any forecast route ───────────────────
console.log("\nPhase 9: No Auto-Send in Routes");

test("no sendEmail in forecast routes block", () => {
  const forecastBlock = routesSrc.slice(
    routesSrc.indexOf("Phase 9: CEO Forecasting"),
    routesSrc.indexOf("Board Pack — Phase 10")
  );
  hasNot(forecastBlock, "sendEmail(");
});
test("no sendMessage in forecast routes block", () => {
  const forecastBlock = routesSrc.slice(
    routesSrc.indexOf("Phase 9: CEO Forecasting"),
    routesSrc.indexOf("Board Pack — Phase 10")
  );
  hasNot(forecastBlock, "sendMessage(");
});
test("scenario-note saves locally only — no external send", () => {
  const noteBlock = routesSrc.slice(routesSrc.indexOf("scenario-note"), routesSrc.indexOf("ceo-forecast/notes"));
  hasNot(noteBlock, "sendEmail");
  hasNot(noteBlock, "sendMessage");
});

// ── Summary ────────────────────────────────────────────────────────────────────

console.log(`
------------------------------------------------------------
CEO Forecasting Tests: ${passed} passed, ${failed} failed
------------------------------------------------------------`);
process.exit(failed > 0 ? 1 : 0);
