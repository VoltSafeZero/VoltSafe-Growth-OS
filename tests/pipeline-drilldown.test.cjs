"use strict";
/**
 * tests/pipeline-drilldown.test.cjs
 * Source-grep tests for Pipeline Drilldown (Phase 2 Universal Drilldowns).
 * Validates route file structure, all metric cases, pagination, auth guards,
 * and frontend wiring — without spawning the server.
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
const routeFile   = readFile("server/routes-pipeline-drilldown.ts");
const routesMain  = readFile("server/routes.ts");
const pipelinePg  = readFile("client/src/pages/pipeline.tsx");
const quotesPg    = readFile("client/src/pages/quotes.tsx");
const bookingPg   = readFile("client/src/pages/booking-outreach.tsx");
const sheetComp   = readFile("client/src/components/shared/universal-drilldown-sheet.tsx");

// ── Route file structure ──────────────────────────────────────────────────────
console.log("\n[1] Route file structure");
assert(routeFile.includes("registerPipelineDrilldownRoutes"), "exports registerPipelineDrilldownRoutes");
assert(routeFile.includes("requireAuth"), "calls requireAuth");
assert(routeFile.includes("requirePermission"), "calls requirePermission");
assert(routeFile.includes("/api/pipeline/drilldown"), "registers /api/pipeline/drilldown");
assert(routeFile.includes("PAGE_SIZE_MAX"), "defines PAGE_SIZE_MAX");
assert(routeFile.includes("buildPaginatedResponse"), "uses buildPaginatedResponse helper");

// ── Metrics present ───────────────────────────────────────────────────────────
console.log("\n[2] Pipeline metrics");
const pipelineMetrics = [
  "active_deals", "total_pipeline", "weighted_pipeline", "stalled_deals",
  "no_next_step", "high_value_inactive", "closing_this_month", "no_activity_14d",
  "awaiting_quote", "commit_deals", "best_case_deals", "overdue_close",
  "no_open_task", "leads_total", "leads_no_owner", "leads_stale",
  "leads_new_month", "leads_converted", "contacts_total", "contacts_missing_email",
  "quotes_awaiting", "quotes_accepted", "quotes_declined",
  "renewals_at_risk", "renewals_overdue",
  "booking_outreach_sent", "booking_outreach_opened", "booking_outreach_booked",
];
for (const m of pipelineMetrics) {
  assert(routeFile.includes(`case "${m}"`), `metric case: ${m}`);
}

// ── Pagination contract ───────────────────────────────────────────────────────
console.log("\n[3] Pagination");
assert(routeFile.includes("total_pages"), "response includes total_pages");
assert(routeFile.includes("page_size"), "response includes page_size");
assert(routeFile.includes("OFFSET"), "SQL uses OFFSET for pagination");
assert(routeFile.includes("LIMIT"), "SQL uses LIMIT for page size");
assert(routeFile.includes("safeInt"), "uses safeInt for safe query params");

// ── SQL safety ────────────────────────────────────────────────────────────────
console.log("\n[4] SQL safety");
// metric is read from query and used in a switch statement — never interpolated into SQL
assert(routeFile.includes("switch (metric)") || routeFile.includes("switch(metric)"), "metric routed via switch (not interpolated into SQL)");
assert(routeFile.includes("sql.raw(") || routeFile.includes("sql`"), "uses drizzle sql builder");
assert(routeFile.includes("COUNT(*)"), "at least one COUNT(*) aggregate");
assert(routeFile.includes("400"), "returns 400 for unknown metric");
assert(routeFile.includes("500"), "returns 500 on internal error");

// ── Registration in routes.ts ─────────────────────────────────────────────────
console.log("\n[5] Route registration");
assert(routesMain.includes("registerPipelineDrilldownRoutes"), "registerPipelineDrilldownRoutes called in routes.ts");
assert(routesMain.includes("routes-pipeline-drilldown"), "routes-pipeline-drilldown imported in routes.ts");

// ── Frontend: UniversalDrilldownSheet component ───────────────────────────────
console.log("\n[6] UniversalDrilldownSheet component");
assert(sheetComp.includes("UniversalDrilldownConfig"), "exports UniversalDrilldownConfig type");
assert(sheetComp.includes("endpoint"), "accepts endpoint prop");
assert(sheetComp.includes("metric"), "config has metric field");
assert(sheetComp.includes("total_pages"), "handles total_pages for pagination");
assert(sheetComp.includes("Sheet"), "uses Sheet component");

// ── Frontend: pipeline.tsx wiring ─────────────────────────────────────────────
console.log("\n[7] pipeline.tsx drilldown wiring");
assert(pipelinePg.includes("UniversalDrilldownSheet"), "imports UniversalDrilldownSheet");
assert(pipelinePg.includes("/api/pipeline/drilldown"), "uses pipeline drilldown endpoint");
assert(pipelinePg.includes("drilldown"), "has drilldown state");
assert(pipelinePg.includes("active_deals"), "wires active_deals metric");
assert(pipelinePg.includes("closing_this_month"), "wires closing_this_month metric");

// ── Frontend: quotes.tsx wiring ───────────────────────────────────────────────
console.log("\n[8] quotes.tsx drilldown wiring");
assert(quotesPg.includes("UniversalDrilldownSheet"), "imports UniversalDrilldownSheet");
assert(quotesPg.includes("/api/pipeline/drilldown"), "uses pipeline drilldown endpoint");
assert(quotesPg.includes("quotes_awaiting"), "wires quotes_awaiting metric");
assert(quotesPg.includes("quotes_accepted"), "wires quotes_accepted metric");
assert(quotesPg.includes("quotes_declined"), "wires quotes_declined metric");

// ── Frontend: booking-outreach.tsx wiring ────────────────────────────────────
console.log("\n[9] booking-outreach.tsx drilldown wiring");
assert(bookingPg.includes("UniversalDrilldownSheet"), "imports UniversalDrilldownSheet");
assert(bookingPg.includes("/api/pipeline/drilldown"), "uses pipeline drilldown endpoint");
assert(bookingPg.includes("booking_outreach_sent"), "wires booking_outreach_sent metric");
assert(bookingPg.includes("booking_outreach_opened"), "wires booking_outreach_opened metric");
assert(bookingPg.includes("booking_outreach_booked"), "wires booking_outreach_booked metric");

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Pipeline Drilldown: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log("\nFailed:");
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
} else {
  console.log("All pipeline drilldown tests passed.");
  process.exit(0);
}
