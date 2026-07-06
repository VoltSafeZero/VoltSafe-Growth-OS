"use strict";
/**
 * tests/insights-drilldown.test.cjs
 * Source-grep tests for Insights Drilldown (Phase 2 Universal Drilldowns).
 * Validates route file, all metric cases, pagination, auth guards,
 * and frontend wiring across executive-dashboard, renewals, revenue-intelligence,
 * and source-attribution pages.
 */

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ✗ ${label}`);
  }
}

function readFile(rel) {
  return fs.readFileSync(path.resolve(__dirname, "..", rel), "utf8");
}

// ── Load files ────────────────────────────────────────────────────────────────
const routeFile   = readFile("server/routes-insights-drilldown.ts");
const routesMain  = readFile("server/routes.ts");
const execDash    = readFile("client/src/pages/executive-dashboard.tsx");
const renewalsPg  = readFile("client/src/pages/renewals.tsx");
const revintPg    = readFile("client/src/pages/revenue-intelligence.tsx");
const sourceAttr  = readFile("client/src/pages/source-attribution.tsx");
const sheetComp   = readFile("client/src/components/shared/universal-drilldown-sheet.tsx");

// ── Route file structure ──────────────────────────────────────────────────────
console.log("\n[1] Route file structure");
assert(routeFile.includes("registerInsightsDrilldownRoutes"), "exports registerInsightsDrilldownRoutes");
assert(routeFile.includes("requireAuth"), "calls requireAuth");
assert(routeFile.includes("requirePermission"), "calls requirePermission");
assert(routeFile.includes("/api/insights/drilldown"), "registers /api/insights/drilldown");
assert(routeFile.includes("buildPaginatedResponse"), "uses buildPaginatedResponse helper");
assert(routeFile.includes("PAGE_SIZE_MAX"), "defines PAGE_SIZE_MAX");

// ── Metrics present ───────────────────────────────────────────────────────────
console.log("\n[2] Insights metrics");
const insightsMetrics = [
  "exec_total_pipeline", "exec_weighted_forecast", "exec_open_opps",
  "exec_closed_won", "exec_stalled_opps", "exec_accepted_revenue",
  "exec_revenue_month", "exec_revenue_qtr", "exec_win_rate", "exec_avg_deal",
  "exec_awaiting_response", "exec_installs_in_progress", "exec_installs_with_blockers",
  "exec_installs_overdue", "exec_leads_total", "exec_leads_new_month",
  "exec_leads_converted", "exec_leads_no_owner",
  "revint_hot_accounts", "revint_stalled_pipeline",
  "source_by_channel",
  "relint_stale_contacts", "relint_execs_engaged",
  "cs_at_risk", "cs_renewals_due",
];
for (const m of insightsMetrics) {
  assert(routeFile.includes(`case "${m}"`), `metric case: ${m}`);
}

// ── Pagination contract ───────────────────────────────────────────────────────
console.log("\n[3] Pagination");
assert(routeFile.includes("total_pages"), "response includes total_pages");
assert(routeFile.includes("page_size"), "response includes page_size");
assert(routeFile.includes("OFFSET"), "SQL uses OFFSET");
assert(routeFile.includes("LIMIT"), "SQL uses LIMIT");
assert(routeFile.includes("safeInt"), "uses safeInt helper");

// ── SQL safety ────────────────────────────────────────────────────────────────
console.log("\n[4] SQL safety");
// metric is routed via switch statement — never interpolated into SQL
assert(routeFile.includes("switch (metric)") || routeFile.includes("switch(metric)"), "metric routed via switch (not interpolated into SQL)");
assert(routeFile.includes("sql.raw(") || routeFile.includes("sql`"), "uses drizzle sql builder");
assert(routeFile.includes("COUNT(*)"), "at least one COUNT(*) aggregate");
assert(routeFile.includes("400"), "returns 400 for unknown metric");
assert(routeFile.includes("500"), "returns 500 on internal error");

// ── Registration in routes.ts ─────────────────────────────────────────────────
console.log("\n[5] Route registration");
assert(routesMain.includes("registerInsightsDrilldownRoutes"), "registerInsightsDrilldownRoutes in routes.ts");
assert(routesMain.includes("routes-insights-drilldown"), "routes-insights-drilldown imported in routes.ts");

// ── Frontend: executive-dashboard.tsx wiring ──────────────────────────────────
console.log("\n[6] executive-dashboard.tsx wiring");
assert(execDash.includes("UniversalDrilldownSheet"), "imports UniversalDrilldownSheet");
assert(execDash.includes("/api/insights/drilldown"), "uses insights drilldown endpoint");
assert(execDash.includes("exec_total_pipeline"), "wires exec_total_pipeline");
assert(execDash.includes("exec_open_opps"), "wires exec_open_opps");
assert(execDash.includes("exec_closed_won"), "wires exec_closed_won");
assert(execDash.includes("exec_installs_in_progress"), "wires exec_installs_in_progress");
assert(execDash.includes("exec_installs_with_blockers"), "wires exec_installs_with_blockers");
assert(execDash.includes("exec_installs_overdue"), "wires exec_installs_overdue");
assert(execDash.includes("exec_leads_total"), "wires exec_leads_total");
assert(execDash.includes("exec_leads_no_owner"), "wires exec_leads_no_owner");
assert(execDash.includes("exec_leads_new_month"), "wires exec_leads_new_month");
assert(execDash.includes("exec_leads_converted"), "wires exec_leads_converted");
assert(execDash.includes("exec_awaiting_response"), "wires exec_awaiting_response");

// ── Frontend: renewals.tsx wiring ─────────────────────────────────────────────
console.log("\n[7] renewals.tsx wiring");
assert(renewalsPg.includes("UniversalDrilldownSheet"), "imports UniversalDrilldownSheet");
assert(renewalsPg.includes("/api/insights/drilldown"), "uses insights drilldown endpoint");
assert(renewalsPg.includes("cs_renewals_due"), "wires cs_renewals_due");
assert(renewalsPg.includes("cs_at_risk"), "wires cs_at_risk");

// ── Frontend: revenue-intelligence.tsx wiring ─────────────────────────────────
console.log("\n[8] revenue-intelligence.tsx wiring");
assert(revintPg.includes("UniversalDrilldownSheet"), "imports UniversalDrilldownSheet");
assert(revintPg.includes("/api/insights/drilldown"), "uses insights drilldown endpoint");
assert(revintPg.includes("revint_hot_accounts"), "wires revint_hot_accounts");
assert(revintPg.includes("revint_stalled_pipeline"), "wires revint_stalled_pipeline");

// ── Frontend: source-attribution.tsx wiring ───────────────────────────────────
console.log("\n[9] source-attribution.tsx wiring");
assert(sourceAttr.includes("UniversalDrilldownSheet"), "imports UniversalDrilldownSheet");
assert(sourceAttr.includes("/api/insights/drilldown"), "uses insights drilldown endpoint");
assert(sourceAttr.includes("source_by_channel"), "wires source_by_channel");

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Insights Drilldown: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log("\nFailed:");
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
} else {
  console.log("All insights drilldown tests passed.");
  process.exit(0);
}
