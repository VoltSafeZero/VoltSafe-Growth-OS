"use strict";
// Source-grep test — pins Work drilldown invariants (Phase 3 Universal Drilldowns)
// Covers: route registration, WORK_METRICS whitelist, SQL safety, response shape,
//         page wiring (daily-execution, tasks-hub), UniversalDrilldownSheet usage
const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

// ── Load source files ─────────────────────────────────────────────────────────

const routesSrc = fs.readFileSync(
  path.join(__dirname, "../server/routes.ts"),
  "utf8"
);

const drilldownSrc = fs.readFileSync(
  path.join(__dirname, "../server/routes-work-drilldown.ts"),
  "utf8"
);

const dailySrc = fs.readFileSync(
  path.join(__dirname, "../client/src/pages/daily-execution.tsx"),
  "utf8"
);

const tasksSrc = fs.readFileSync(
  path.join(__dirname, "../client/src/pages/tasks-hub.tsx"),
  "utf8"
);

// ── 1. Route registration ─────────────────────────────────────────────────────

console.log("\n1. Route registration in server/routes.ts");
assert(
  "routes-work-drilldown imported dynamically",
  routesSrc.includes("routes-work-drilldown")
);
assert(
  "registerWorkDrilldownRoutes called",
  routesSrc.includes("registerWorkDrilldownRoutes")
);

// ── 2. Security — metric whitelist ────────────────────────────────────────────

console.log("\n2. Security — metric whitelist");
assert(
  "WORK_METRICS whitelist defined as Set",
  drilldownSrc.includes("const WORK_METRICS = new Set([")
);
assert(
  "metric validated against whitelist before SQL",
  drilldownSrc.includes("WORK_METRICS.has(metric)")
);
assert(
  "returns 400 for unknown metric",
  drilldownSrc.includes("400") && drilldownSrc.includes("Unknown metric")
);

// ── 3. Required metrics in whitelist ─────────────────────────────────────────

console.log("\n3. Required metrics in WORK_METRICS whitelist");
const requiredMetrics = [
  "tasks_open",
  "tasks_overdue",
  "tasks_due_today",
  "tasks_due_this_week",
  "tasks_completed_today",
  "tasks_high_priority",
  "meetings_today",
  "activity_recent",
  "inbox_unread",
];
for (const m of requiredMetrics) {
  assert(`"${m}" in whitelist`, drilldownSrc.includes(`"${m}"`));
}

// ── 4. SQL safety ─────────────────────────────────────────────────────────────

// ── 1a. Route file structure ──────────────────────────────────────────────────
console.log("\n1a. Route file structure");
assert("exports registerWorkDrilldownRoutes", drilldownSrc.includes("export function registerWorkDrilldownRoutes"));
assert("GET /api/work/drilldown endpoint", drilldownSrc.includes("/api/work/drilldown"));
assert("has buildPaginatedResponse helper", drilldownSrc.includes("buildPaginatedResponse"));
assert("has pagination (page, pageSize)", drilldownSrc.includes("pageSize") && drilldownSrc.includes("page"));
assert("defaults ownerId to currentUserId (user scoping)", drilldownSrc.includes("currentUserId") && drilldownSrc.includes("req.user"));
assert("admin bypass for owner_id override", drilldownSrc.includes("isAdmin") && drilldownSrc.includes("requestedOwnerId"));

console.log("\n4. SQL safety invariants");
assert(
  "pageSize capped at PAGE_SIZE_MAX (100)",
  drilldownSrc.includes("PAGE_SIZE_MAX") && drilldownSrc.includes("100")
);
assert(
  "searchClause uses ILIKE with escaped input",
  drilldownSrc.includes("ILIKE") && drilldownSrc.includes(".replace(/'/g")
);
assert(
  "search input sliced to 100 chars",
  drilldownSrc.includes(".slice(0, 100)")
);
assert(
  "safeInt helper used for pagination params",
  drilldownSrc.includes("safeInt(")
);

// ── 5. Response shape ─────────────────────────────────────────────────────────

console.log("\n5. Response shape from buildPaginatedResponse");
assert(
  "response includes metric field",
  drilldownSrc.includes("metric,")
);
assert(
  "response includes total_pages",
  drilldownSrc.includes("total_pages")
);
assert(
  "response includes columns array",
  drilldownSrc.includes("columns,")
);
assert(
  "response includes rows array",
  drilldownSrc.includes("rows,")
);
assert(
  "response includes refreshed_at",
  drilldownSrc.includes("refreshed_at")
);
assert(
  "response includes empty_state",
  drilldownSrc.includes("empty_state")
);

// ── 6. daily-execution.tsx wiring ────────────────────────────────────────────

console.log("\n6. daily-execution.tsx drilldown wiring");
assert(
  "UniversalDrilldownSheet imported",
  dailySrc.includes("UniversalDrilldownSheet")
);
assert(
  "UniversalDrilldownConfig type imported",
  dailySrc.includes("UniversalDrilldownConfig")
);
assert(
  "drilldownConfig state declared",
  dailySrc.includes("drilldownConfig") && dailySrc.includes("setDrilldownConfig")
);
assert(
  "tasks_open metric wired to Total Open stat",
  dailySrc.includes('"tasks_open"')
);
assert(
  "tasks_due_today metric wired to Due Today stat",
  dailySrc.includes('"tasks_due_today"')
);
assert(
  "tasks_overdue metric wired to Overdue stat",
  dailySrc.includes('"tasks_overdue"')
);
assert(
  "stat cards have cursor-pointer on drillable metrics",
  dailySrc.includes("cursor-pointer")
);
assert(
  "UniversalDrilldownSheet rendered with work endpoint",
  dailySrc.includes('endpoint="/api/work/drilldown"')
);
assert(
  "stat onClick opens drilldown sheet",
  dailySrc.includes("setDrilldownConfig({ metric })")
);

// ── 7. tasks-hub.tsx wiring ───────────────────────────────────────────────────

console.log("\n7. tasks-hub.tsx drilldown wiring");
assert(
  "UniversalDrilldownSheet imported",
  tasksSrc.includes("UniversalDrilldownSheet")
);
assert(
  "UniversalDrilldownConfig type imported",
  tasksSrc.includes("UniversalDrilldownConfig")
);
assert(
  "drilldownConfig state declared",
  tasksSrc.includes("drilldownConfig") && tasksSrc.includes("setDrilldownConfig")
);
assert(
  "tasks_open metric chip wired",
  tasksSrc.includes('"tasks_open"')
);
assert(
  "tasks_due_today metric chip wired",
  tasksSrc.includes('"tasks_due_today"')
);
assert(
  "tasks_overdue metric chip wired",
  tasksSrc.includes('"tasks_overdue"')
);
assert(
  "stats chips container rendered when counts available",
  tasksSrc.includes("chip-tasks-")
);
assert(
  "chips filter out zero counts",
  tasksSrc.includes(".filter(c => (c.value ?? 0) > 0)")
);
assert(
  "UniversalDrilldownSheet rendered with work endpoint",
  tasksSrc.includes('endpoint="/api/work/drilldown"')
);
assert(
  "chip onClick opens drilldown sheet",
  tasksSrc.includes("setDrilldownConfig({ metric: chip.metric })")
);

// ── 8. Authentication ─────────────────────────────────────────────────────────

console.log("\n8. Authentication");
assert(
  "requireAuth used in route handler",
  drilldownSrc.includes("requireAuth") || routesSrc.includes("registerWorkDrilldownRoutes(app, requireAuth)")
);


// ── 8+. Auth invariants (code-review security additions) ─────────────────────

console.log("\n8. Auth invariants");
assert("defaults ownerId to currentUserId (user scoping)", drilldownSrc.includes("userId") && drilldownSrc.includes("req.user"));

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`Work Drilldown: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
