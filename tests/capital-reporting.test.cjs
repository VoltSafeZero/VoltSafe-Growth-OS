/**
 * Capital Board / CFO Reporting Pack — Phase 2J Source-Grep Tests
 *
 * Verifies: service functions, backend routes, security, frontend page,
 * nav wiring, App.tsx registration, and command center integration.
 *
 * No live server required.
 */
"use strict";

const fs   = require("fs");
const path = require("path");

const SERVICE  = path.join(__dirname, "../server/services/capital-reporting.ts");
const ROUTES   = path.join(__dirname, "../server/routes-capital.ts");
const PAGE     = path.join(__dirname, "../client/src/pages/capital-reports.tsx");
const APP_TSX  = path.join(__dirname, "../client/src/App.tsx");
const NAV      = path.join(__dirname, "../client/src/lib/nav-config.ts");
const CMD      = path.join(__dirname, "../client/src/pages/capital-command-center.tsx");

const service = fs.readFileSync(SERVICE, "utf8");
const routes  = fs.readFileSync(ROUTES,  "utf8");
const page    = fs.readFileSync(PAGE,    "utf8");
const appTsx  = fs.readFileSync(APP_TSX, "utf8");
const nav     = fs.readFileSync(NAV,     "utf8");
const cmd     = fs.readFileSync(CMD,     "utf8");

let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${label}: ${err.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function contains(text, pattern, label) {
  const ok = typeof pattern === "string"
    ? text.includes(pattern)
    : pattern.test(text);
  assert(ok, `Expected to find: ${pattern} [in ${label}]`);
}

function notContains(text, pattern, label) {
  const ok = typeof pattern === "string"
    ? !text.includes(pattern)
    : !pattern.test(text);
  assert(ok, `Should NOT contain: ${pattern} [in ${label}]`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. SERVICE: exports & types
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n1. Service — exports & type definitions");

test("exports REPORT_TYPES array", () =>
  contains(service, "export const REPORT_TYPES", "service"));

test("exports REPORT_TYPE_META record", () =>
  contains(service, "export const REPORT_TYPE_META", "service"));

test("exports assembleReport function", () =>
  contains(service, "export function assembleReport(", "service"));

test("exports reportToMarkdown function", () =>
  contains(service, "export function reportToMarkdown(", "service"));

test("exports reportToCsv function", () =>
  contains(service, "export function reportToCsv(", "service"));

test("defines ReportType union type", () =>
  contains(service, 'export type ReportType = "weekly_brief"', "service"));

test("includes all 4 report types", () => {
  for (const t of ["weekly_brief", "board_update", "cfo_closing", "engagement"]) {
    contains(service, t, "service");
  }
});

test("has_csv true for cfo_closing", () =>
  contains(service, "cfo_closing", "service") &&
  contains(service, "has_csv:     true", "service"));

test("has_csv false for weekly_brief", () => {
  const wbIdx = service.indexOf("weekly_brief:");
  const nextBlock = service.slice(wbIdx, wbIdx + 300);
  contains(nextBlock, "has_csv:     false", "service weekly_brief block");
});

test("audience for board_update is Board of Directors", () =>
  contains(service, "Board of Directors", "service"));

test("exports WeeklyBriefReport interface", () =>
  contains(service, "export interface WeeklyBriefReport", "service"));

test("exports BoardUpdateReport interface", () =>
  contains(service, "export interface BoardUpdateReport", "service"));

test("exports CfoClosingReport interface", () =>
  contains(service, "export interface CfoClosingReport", "service"));

test("exports EngagementReport interface", () =>
  contains(service, "export interface EngagementReport", "service"));

test("exports ReportInput interface", () =>
  contains(service, "export interface ReportInput", "service"));

test("exports ReportOptions interface", () =>
  contains(service, "export interface ReportOptions", "service"));

// ─────────────────────────────────────────────────────────────────────────────
// 2. SERVICE: pure — no DB calls
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n2. Service — purity (no DB calls)");

test("no db.execute in service", () =>
  notContains(service, "db.execute", "service"));

test("no db.select in service", () =>
  notContains(service, "db.select(", "service"));

test("no sql.raw in service", () =>
  notContains(service, "sql.raw(", "service"));

test("imports from existing capital services", () => {
  contains(service, "capital-command-center.js", "service");
  contains(service, "capital-valuation.js", "service");
  contains(service, "capital-engagement.js", "service");
  contains(service, "capital-data-room.js", "service");
  contains(service, "capital-portal.js", "service");
});

test("assembleReport dispatches to 4 sub-builders", () => {
  for (const t of ["weekly_brief", "board_update", "cfo_closing", "engagement"]) {
    contains(service, `"${t}"`, "service");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. SERVICE: report content
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n3. Service — report section correctness");

test("weekly brief includes round_status", () =>
  contains(service, "round_status:", "service"));

test("weekly brief includes pipeline_momentum", () =>
  contains(service, "pipeline_momentum:", "service"));

test("weekly brief includes this_week_priority", () =>
  contains(service, "this_week_priority:", "service"));

test("weekly brief includes engagement_pulse", () =>
  contains(service, "engagement_pulse:", "service"));

test("weekly brief includes data_room_status", () =>
  contains(service, "data_room_status:", "service"));

test("board update includes round_headline", () =>
  contains(service, "round_headline:", "service"));

test("board update includes valuation_summary", () =>
  contains(service, "valuation_summary:", "service"));

test("board update includes pipeline_table", () =>
  contains(service, "pipeline_table:", "service"));

test("board update includes management_asks", () =>
  contains(service, "management_asks:", "service"));

test("cfo closing includes close_summary", () =>
  contains(service, "close_summary:", "service"));

test("cfo closing includes allocation_table", () =>
  contains(service, "allocation_table:", "service"));

test("cfo closing includes checklist_items", () =>
  contains(service, "checklist_items:", "service"));

test("cfo closing includes runway_scenarios", () =>
  contains(service, "runway_scenarios:", "service"));

test("engagement report includes analytics", () =>
  contains(service, "analytics,", "service"));

test("engagement report includes top_engaged", () =>
  contains(service, "top_engaged:", "service"));

test("engagement report includes follow_up_recommendations", () =>
  contains(service, "follow_up_recommendations:", "service"));

test("markdown generators exist for all 4 types", () => {
  for (const fn of [
    "weeklyBriefToMarkdown",
    "boardUpdateToMarkdown",
    "cfoClosingToMarkdown",
    "engagementToMarkdown",
  ]) {
    contains(service, fn, "service");
  }
});

test("reportToCsv returns null for non-csv types", () =>
  contains(service, "return null;", "service"));

test("reportToCsv handles cfo_closing", () =>
  contains(service, '"cfo_closing"', "service") &&
  contains(service, "allocation_table", "service"));

test("reportToCsv handles engagement", () =>
  contains(service, '"engagement"', "service") &&
  contains(service, "top_engaged", "service"));

// ─────────────────────────────────────────────────────────────────────────────
// 4. ROUTES: API endpoints
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n4. Routes — API endpoints");

test("GET /api/capital/reports endpoint exists", () =>
  contains(routes, '"/api/capital/reports"', "routes"));

test("GET /api/capital/reports/:type endpoint exists", () =>
  contains(routes, '"/api/capital/reports/:type"', "routes"));

test("reports routes use requireAuth + requireCapitalAccess", () => {
  const idx = routes.indexOf('"/api/capital/reports"');
  assert(idx > -1, "reports route not found");
  const block = routes.slice(idx - 100, idx + 200);
  contains(block, "requireCapitalAccess", "routes reports block");
});

test("reports/:type route uses requireCapitalAccess", () => {
  const idx = routes.indexOf('"/api/capital/reports/:type"');
  assert(idx > -1, "reports/:type route not found");
  const block = routes.slice(idx - 100, idx + 200);
  contains(block, "requireCapitalAccess", "routes reports/:type block");
});

test("routes dynamically import capital-reporting service", () =>
  contains(routes, "capital-reporting", "routes"));

test("routes handle format=markdown", () =>
  contains(routes, "format", "routes") &&
  contains(routes, "markdown", "routes"));

test("routes handle format=csv", () =>
  contains(routes, "csv", "routes"));

test("routes return report_types in GET /api/capital/reports", () =>
  contains(routes, "REPORT_TYPE_META", "routes"));

test("routes call assembleReport", () =>
  contains(routes, "assembleReport(", "routes"));

test("routes call reportToMarkdown", () =>
  contains(routes, "reportToMarkdown(", "routes"));

test("routes call reportToCsv", () =>
  contains(routes, "reportToCsv(", "routes"));

// ─────────────────────────────────────────────────────────────────────────────
// 5. PAGE: structure and test IDs
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n5. Frontend page — structure");

test("page default export is CapitalReportsPage", () =>
  contains(page, "export default function CapitalReportsPage(", "page"));

test("page has data-testid=capital-reports-page", () =>
  contains(page, 'data-testid="capital-reports-page"', "page"));

test("page has report-type-selector test id", () =>
  contains(page, 'data-testid="report-type-selector"', "page"));

test("page has report-type buttons for all 4 types", () => {
  contains(page, 'data-testid={`report-type-${type}`}', "page");
  for (const t of ["weekly_brief", "board_update", "cfo_closing", "engagement"]) {
    contains(page, `"${t}"`, "page");
  }
});

test("page has round selector", () =>
  contains(page, 'data-testid="report-round-selector"', "page"));

test("page has generate report button", () =>
  contains(page, 'data-testid="btn-generate-report"', "page"));

test("page has copy markdown button", () =>
  contains(page, 'data-testid="btn-copy-markdown"', "page"));

test("page has export csv button", () =>
  contains(page, 'data-testid="btn-export-csv"', "page"));

test("page has include-sensitive toggle", () =>
  contains(page, 'data-testid="toggle-include-sensitive"', "page"));

test("page has empty state", () =>
  contains(page, 'data-testid="empty-state"', "page"));

test("page renders WeeklyBriefView", () =>
  contains(page, "WeeklyBriefView", "page"));

test("page renders BoardUpdateView", () =>
  contains(page, "BoardUpdateView", "page"));

test("page renders CfoClosingView", () =>
  contains(page, "CfoClosingView", "page"));

test("page renders EngagementView", () =>
  contains(page, "EngagementView", "page"));

test("page queries /api/capital/reports for metadata", () =>
  contains(page, '"/api/capital/reports"', "page"));

test("page fetches /api/capital/reports/:type for generation", () =>
  contains(page, "/api/capital/reports/${selectedType}", "page"));

test("page supports format=markdown for copy", () =>
  contains(page, "format", "page") &&
  contains(page, "markdown", "page"));

test("page supports format=csv for download", () =>
  contains(page, "format", "page") &&
  contains(page, "csv", "page"));

test("page shows restricted audience label", () =>
  contains(page, "Trevor", "page") ||
  contains(page, "Scott", "page"));

// ─────────────────────────────────────────────────────────────────────────────
// 6. NAV CONFIG: Reports item
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n6. Nav config — Reports item");

test("nav config includes capital-reports id", () =>
  contains(nav, "capital-reports", "nav"));

test("nav config routes to /capital/reports", () =>
  contains(nav, "/capital/reports", "nav"));

test("nav config has Reports label", () =>
  contains(nav, '"Reports"', "nav"));

// ─────────────────────────────────────────────────────────────────────────────
// 7. APP.TSX: lazy import + route
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n7. App.tsx — lazy import and route registration");

test("App.tsx has lazy import for CapitalReportsPage", () =>
  contains(appTsx, "CapitalReportsPage", "App.tsx"));

test("App.tsx imports from capital-reports page", () =>
  contains(appTsx, "capital-reports", "App.tsx"));

test("App.tsx has route for /capital/reports", () =>
  contains(appTsx, '"/capital/reports"', "App.tsx"));

test("capital/reports route uses capitalGuard", () => {
  const idx = appTsx.indexOf('"/capital/reports"');
  assert(idx > -1, "/capital/reports route not found");
  const block = appTsx.slice(idx - 50, idx + 200);
  contains(block, "capitalGuard", "App.tsx reports route block");
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. COMMAND CENTER: Generate Reports link
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n8. Command center — Reports link");

test("command center links to /capital/reports", () =>
  contains(cmd, "/capital/reports", "command-center"));

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`  Phase 2J Tests: ${passed} passed, ${failed} failed`);
console.log(`${"─".repeat(60)}\n`);

if (failed > 0) process.exit(1);
