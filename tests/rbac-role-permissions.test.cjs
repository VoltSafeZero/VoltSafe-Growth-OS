#!/usr/bin/env node
/**
 * RBAC / Role-Visibility Regression Suite
 *
 * Covers the "Advisor Test" role-audit fix:
 *  A) Simulators & Feedback / Revenue Simulator — master_admin/admin/manager/exec/sales only
 *  B) Plan My Travel Day — "Single-day visits" only for the same privileged roles
 *  C) Leads Nearby / My Travel widgets — same allowlist, enforced dashboard-wide
 *
 * Source-grep style (per project convention for UI/permission invariants that
 * don't need a live browser): pins the exact server + client enforcement
 * points so a future refactor can't silently drop one of them. Run with:
 *   node tests/rbac-role-permissions.test.cjs
 */

const fs = require("fs");

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  \u2713 ${label}`);
  passed++;
}
function fail(label, detail) {
  console.error(`  \u2717 ${label}${detail ? ` \u2014 ${detail}` : ""}`);
  failed++;
}
function read(path) {
  return fs.readFileSync(path, "utf8");
}
function must(path, pattern, label) {
  const src = read(path);
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  if (re.test(src)) ok(label);
  else fail(label, `pattern not found in ${path}`);
}

console.log("\n=== shared/rbac.ts: single source of truth ===");
must("shared/rbac.ts", /PRIVILEGED_SALES_ROLES\s*=\s*\[/, "PRIVILEGED_SALES_ROLES exported");
must("shared/rbac.ts", /"master_admin"/, "includes master_admin");
must("shared/rbac.ts", /"admin"/, "includes admin");
must("shared/rbac.ts", /"manager"/, "includes manager");
must("shared/rbac.ts", /"exec"/, "includes exec");
must("shared/rbac.ts", /"sales"/, "includes sales");
must("shared/rbac.ts", /export const canAccessRevenueSimulator/, "canAccessRevenueSimulator exported");
must("shared/rbac.ts", /export const canUseSalesTravelTools/, "canUseSalesTravelTools exported");

console.log("\n=== A) Server-side: Revenue Simulator API gate ===");
must("server/auth.ts", /requirePrivilegedSalesRole/, "requirePrivilegedSalesRole middleware defined");
must("server/auth.ts", /isPrivilegedSalesRole/, "auth.ts imports isPrivilegedSalesRole from shared/rbac");
{
  const routes = read("server/routes.ts");
  const revSimIdx = routes.indexOf('"/api/revenue-sim');
  if (revSimIdx === -1) fail("A: /api/revenue-sim route present", "route not found");
  else {
    const windowSrc = routes.slice(Math.max(0, revSimIdx - 400), revSimIdx + 200);
    if (/requirePrivilegedSalesRole/.test(windowSrc)) ok("A: /api/revenue-sim gated by requirePrivilegedSalesRole");
    else fail("A: /api/revenue-sim gated by requirePrivilegedSalesRole", "middleware not found near route registration");
  }
}

console.log("\n=== B) Server-side: sales travel / leads-nearby API gate ===");
{
  const routes = read("server/routes.ts");
  for (const routePath of ['"/api/leads/nearby', '"/api/travel/my-day']) {
    const idx = routes.indexOf(routePath);
    if (idx === -1) { fail(`B: route ${routePath} present`, "not found"); continue; }
    const windowSrc = routes.slice(Math.max(0, idx - 400), idx + 200);
    if (/requirePrivilegedSalesRole/.test(windowSrc)) ok(`B: ${routePath} gated by requirePrivilegedSalesRole`);
    else fail(`B: ${routePath} gated by requirePrivilegedSalesRole`, "middleware not found near route registration");
  }
}

console.log("\n=== A) Client-side: route guard ===");
must("client/src/App.tsx", /import \{ canAccessRevenueSimulator \} from "@shared\/rbac"/, "App.tsx imports canAccessRevenueSimulator");
must("client/src/App.tsx", /function simulatorBlock/, "simulatorBlock() route guard defined");
must("client/src/App.tsx", /path="\/revenue-sim">\{\(\) => simulatorBlock/, "/revenue-sim uses simulatorBlock");
must("client/src/App.tsx", /path="\/insights\/simulators-feedback">\{\(\) => simulatorBlock/, "/insights/simulators-feedback uses simulatorBlock");

console.log("\n=== A) Client-side: nav hiding ===");
must("client/src/lib/nav-config.ts", /allowedGlobalRoles/, "nav-config.ts has allowedGlobalRoles field");
must("client/src/lib/nav-config.ts", /simulators-feedback/, "simulators-feedback nav item present");

console.log("\n=== B) Client-side: Plan My Travel Day chooser ===");
must(
  "client/src/components/travel/plan-day-chooser-dialog.tsx",
  /canUseSalesTravelTools/,
  "plan-day-chooser-dialog imports canUseSalesTravelTools"
);
must(
  "client/src/components/travel/plan-day-chooser-dialog.tsx",
  /canPlanSingleDay\s*&&/,
  "\"Single-day visits\" button is conditionally rendered (not just disabled)"
);
{
  const src = read("client/src/components/travel/plan-day-chooser-dialog.tsx");
  if (/disabled=\{!canPlanSingleDay\}/.test(src)) {
    fail("B: Single-day visits is hidden, not shown disabled", "found a disabled= binding on the gated button");
  } else {
    ok("B: Single-day visits is hidden entirely for unauthorized roles (not shown disabled)");
  }
}

console.log("\n=== C) Widget visibility: Leads Nearby / My Travel ===");
{
  const cfg = read("client/src/lib/dashboard-config.ts");
  const leadsIdx = cfg.indexOf("leads_nearby");
  const travelIdx = cfg.indexOf("my_travel");
  if (leadsIdx === -1) fail("C: leads_nearby widget def present", "not found");
  else {
    const nextKeyIdx = cfg.indexOf("my_travel:", leadsIdx);
    const w = cfg.slice(leadsIdx, nextKeyIdx > -1 ? nextKeyIdx : leadsIdx + 800);
    if (/allowedGlobalRoles/.test(w)) ok("C: leads_nearby has allowedGlobalRoles visibility rule");
    else fail("C: leads_nearby has allowedGlobalRoles visibility rule", "not found in def window");
  }
  if (travelIdx === -1) fail("C: my_travel widget def present", "not found");
  else {
    const w = cfg.slice(travelIdx, travelIdx + 800);
    if (/allowedGlobalRoles/.test(w)) ok("C: my_travel has allowedGlobalRoles visibility rule");
    else fail("C: my_travel has allowedGlobalRoles visibility rule", "not found in def window");
  }
  must(
    "client/src/lib/dashboard-config.ts",
    /rule\.allowedGlobalRoles\?\.length/,
    "C: canUserSeeWidget() enforces allowedGlobalRoles centrally"
  );
  must(
    "client/src/lib/dashboard-config.ts",
    /if \(canUserSeeWidget\(profile, w\)\) widgets\.push\(w\)/,
    "C: buildDashboardConfig() filters every widget through canUserSeeWidget (covers dashboard, picker, and reset-defaults, which all consume config.widgets)"
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
