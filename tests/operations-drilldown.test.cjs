"use strict";
// Source-grep test — pins Operations drilldown invariants (Phase 3 Universal Drilldowns)
// Covers: route registration, OPERATIONS_METRICS whitelist, SQL safety, response shape,
//         page wiring (install-workflows, tickets, procurement), UniversalDrilldownSheet usage
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
  path.join(__dirname, "../server/routes-operations-drilldown.ts"),
  "utf8"
);

const installSrc = fs.readFileSync(
  path.join(__dirname, "../client/src/pages/install-workflows.tsx"),
  "utf8"
);

const ticketsSrc = fs.readFileSync(
  path.join(__dirname, "../client/src/pages/tickets.tsx"),
  "utf8"
);

const procurementSrc = fs.readFileSync(
  path.join(__dirname, "../client/src/pages/procurement.tsx"),
  "utf8"
);

const projectsSrc = fs.readFileSync(
  path.join(__dirname, "../client/src/pages/projects.tsx"),
  "utf8"
);

const documentsSrc = fs.readFileSync(
  path.join(__dirname, "../client/src/pages/documents.tsx"),
  "utf8"
);

// ── 1. Route registration ─────────────────────────────────────────────────────

console.log("\n1. Route registration in server/routes.ts");
assert(
  "routes-operations-drilldown imported dynamically",
  routesSrc.includes("routes-operations-drilldown")
);
assert(
  "registerOperationsDrilldownRoutes called",
  routesSrc.includes("registerOperationsDrilldownRoutes")
);

// ── 2. Security — metric whitelist ────────────────────────────────────────────

console.log("\n2. Security — metric whitelist");
assert(
  "OPERATIONS_METRICS whitelist defined as Set",
  drilldownSrc.includes("const OPERATIONS_METRICS = new Set([")
);
assert(
  "metric validated against whitelist before SQL",
  drilldownSrc.includes("OPERATIONS_METRICS.has(metric)")
);
assert(
  "returns 400 for unknown metric",
  drilldownSrc.includes("400") && drilldownSrc.includes("Unknown metric")
);

// ── 3. Required metrics in whitelist ─────────────────────────────────────────

console.log("\n3. Required metrics in OPERATIONS_METRICS whitelist");
const requiredMetrics = [
  "active_installs",
  "overdue_installs",
  "blocked_installs",
  "tickets_open",
  "tickets_high_priority",
  "tickets_closed_recently",
  "orders_open",
  "orders_overdue",
  "orders_blocked",
  "batches_blocked",
  "active_projects",
  "overdue_projects",
];
for (const m of requiredMetrics) {
  assert(`"${m}" in whitelist`, drilldownSrc.includes(`"${m}"`));
}

// ── 4. SQL safety ─────────────────────────────────────────────────────────────

// ── 1a. Route file structure ──────────────────────────────────────────────────
console.log("\n1a. Route file structure");
assert("exports registerOperationsDrilldownRoutes", drilldownSrc.includes("export function registerOperationsDrilldownRoutes"));
assert("GET /api/operations/drilldown endpoint", drilldownSrc.includes("/api/operations/drilldown"));
assert("has buildPaginatedResponse helper", drilldownSrc.includes("buildPaginatedResponse"));
assert("has pagination (page, pageSize)", drilldownSrc.includes("pageSize") && drilldownSrc.includes("page"));
assert("requirePermission crm view applied", drilldownSrc.includes('requirePermission("crm", "view")'));
assert("dq_* metrics are admin-only gated", drilldownSrc.includes('metric.startsWith("dq_")') && drilldownSrc.includes("403"));

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

// ── 6. install-workflows.tsx wiring ──────────────────────────────────────────

console.log("\n6. install-workflows.tsx drilldown wiring");
assert(
  "UniversalDrilldownSheet imported",
  installSrc.includes("UniversalDrilldownSheet")
);
assert(
  "UniversalDrilldownConfig type imported",
  installSrc.includes("UniversalDrilldownConfig")
);
assert(
  "drilldownConfig state declared",
  installSrc.includes("drilldownConfig") && installSrc.includes("setDrilldownConfig")
);
assert(
  "active_installs metric wired",
  installSrc.includes('"active_installs"')
);
assert(
  "overdue_installs metric wired",
  installSrc.includes('"overdue_installs"')
);
assert(
  "blocked_installs metric wired",
  installSrc.includes('"blocked_installs"')
);
assert(
  "UniversalDrilldownSheet rendered with operations endpoint",
  installSrc.includes('endpoint="/api/operations/drilldown"')
);
assert(
  "summary cards have cursor-pointer on drillable metrics",
  installSrc.includes("cursor-pointer")
);

// ── 7. tickets.tsx wiring ────────────────────────────────────────────────────

console.log("\n7. tickets.tsx drilldown wiring");
assert(
  "UniversalDrilldownSheet imported",
  ticketsSrc.includes("UniversalDrilldownSheet")
);
assert(
  "drilldownConfig state declared",
  ticketsSrc.includes("drilldownConfig") && ticketsSrc.includes("setDrilldownConfig")
);
assert(
  "tickets_open metric wired",
  ticketsSrc.includes('"tickets_open"')
);
assert(
  "tickets_closed_recently metric wired",
  ticketsSrc.includes('"tickets_closed_recently"')
);
assert(
  "tickets_high_priority metric wired",
  ticketsSrc.includes('"tickets_high_priority"')
);
assert(
  "summaryCards onClick opens drilldown",
  ticketsSrc.includes("setDrilldownConfig({ metric: card.metric })")
);
assert(
  "UniversalDrilldownSheet rendered with operations endpoint",
  ticketsSrc.includes('endpoint="/api/operations/drilldown"')
);

// ── 8. procurement.tsx wiring ────────────────────────────────────────────────

console.log("\n8. procurement.tsx drilldown wiring");
assert(
  "UniversalDrilldownSheet imported",
  procurementSrc.includes("UniversalDrilldownSheet")
);
assert(
  "drilldownConfig state declared",
  procurementSrc.includes("drilldownConfig") && procurementSrc.includes("setDrilldownConfig")
);
assert(
  "orders_open metric wired (Open POs)",
  procurementSrc.includes('"orders_open"')
);
assert(
  "orders_overdue metric wired (Delayed POs)",
  procurementSrc.includes('"orders_overdue"')
);
assert(
  "batches_blocked metric wired (Blocked Batches)",
  procurementSrc.includes('"batches_blocked"')
);
assert(
  "blocked_installs metric wired in procurement KPI",
  procurementSrc.includes('"blocked_installs"')
);
assert(
  "KPI cards have cursor-pointer on drillable metrics",
  procurementSrc.includes("cursor-pointer")
);
assert(
  "UniversalDrilldownSheet rendered with operations endpoint",
  procurementSrc.includes('endpoint="/api/operations/drilldown"')
);

// ── 9. Authentication ─────────────────────────────────────────────────────────

console.log("\n9. Authentication");
assert(
  "requireAuth used in route handler",
  drilldownSrc.includes("requireAuth") || routesSrc.includes("requireAuth")
);
assert(
  "route registered with requireAuth middleware",
  drilldownSrc.includes("requireAuth") || routesSrc.includes("registerOperationsDrilldownRoutes(app, requireAuth)")
);


// ── 9+. Auth invariants (code-review security additions) ──────────────────────

console.log("\n9. Auth invariants");
assert("requirePermission crm view applied", drilldownSrc.includes('requirePermission("crm", "view")'));
assert("dq_* metrics are admin-only gated", drilldownSrc.includes('metric.startsWith("dq_")') && drilldownSrc.includes("403"));

// ── 10. projects.tsx drilldown wiring ─────────────────────────────────────────

console.log("\n10. projects.tsx drilldown wiring");
assert(
  "UniversalDrilldownSheet imported in projects.tsx",
  projectsSrc.includes("UniversalDrilldownSheet")
);
assert(
  "UniversalDrilldownConfig type imported in projects.tsx",
  projectsSrc.includes("UniversalDrilldownConfig")
);
assert(
  "drilldownConfig state declared in projects.tsx",
  projectsSrc.includes("drilldownConfig") && projectsSrc.includes("setDrilldownConfig")
);
assert(
  "active_projects metric wired in projects.tsx",
  projectsSrc.includes('"active_projects"')
);
assert(
  "overdue_projects metric wired in projects.tsx",
  projectsSrc.includes('"overdue_projects"')
);
assert(
  "completed_projects metric wired in projects.tsx",
  projectsSrc.includes('"completed_projects"')
);
assert(
  "projects_due_this_week metric wired in projects.tsx",
  projectsSrc.includes('"projects_due_this_week"')
);
assert(
  "UniversalDrilldownSheet rendered with operations endpoint in projects.tsx",
  projectsSrc.includes('endpoint="/api/operations/drilldown"')
);
assert(
  "CertSummaryStrip stat buttons have cursor-pointer",
  projectsSrc.includes("cursor-pointer")
);

// ── 11. documents.tsx drilldown wiring ───────────────────────────────────────

console.log("\n11. documents.tsx drilldown wiring");
assert(
  "UniversalDrilldownSheet imported in documents.tsx",
  documentsSrc.includes("UniversalDrilldownSheet")
);
assert(
  "UniversalDrilldownConfig type imported in documents.tsx",
  documentsSrc.includes("UniversalDrilldownConfig")
);
assert(
  "drilldownConfig state declared in documents.tsx",
  documentsSrc.includes("drilldownConfig") && documentsSrc.includes("setDrilldownConfig")
);
assert(
  "documents_total metric wired (Total Assets stat chip)",
  documentsSrc.includes('"documents_total"') && documentsSrc.includes("Total Assets")
);
assert(
  "documents_recent metric wired (Insights shortcut)",
  documentsSrc.includes('"documents_recent"') && documentsSrc.includes("Recent")
);
assert(
  "documents_stale metric wired (Insights shortcut)",
  documentsSrc.includes('"documents_stale"') && documentsSrc.includes("Stale")
);
assert(
  "documents_missing_owner metric wired (Insights shortcut)",
  documentsSrc.includes('"documents_missing_owner"') && documentsSrc.includes("No Owner")
);
assert(
  "Total Assets stat chip maps to documents_total drilldown",
  (() => {
    const totalAssetsIdx = documentsSrc.indexOf('"Total Assets"');
    const docTotalIdx = documentsSrc.indexOf('"documents_total"');
    return totalAssetsIdx !== -1 && docTotalIdx !== -1 && Math.abs(totalAssetsIdx - docTotalIdx) < 200;
  })()
);
assert(
  "all 4 count-bearing stat chips are drillable (cursor-pointer on stat buttons)",
  documentsSrc.includes("cursor-pointer") && documentsSrc.includes("setDrilldownConfig({ metric: s.metric })")
);
assert(
  "UniversalDrilldownSheet rendered with operations endpoint in documents.tsx",
  documentsSrc.includes('endpoint="/api/operations/drilldown"')
);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`Operations Drilldown: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
