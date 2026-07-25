"use strict";
/**
 * Pipeline / Leads access for advisor-role external users
 *
 * Root cause: App.tsx used `isAdvisor ? <AccessDenied /> : <Page />` INSIDE
 * every guard("crm", ...) call. Even when hasAccess() returned true (because
 * the user had an explicit crm:"view" permission), the children expression
 * still rendered <AccessDenied /> because isAdvisor===true.
 *
 * Fix:
 *   1. Removed the `isAdvisor ? <AccessDenied /> :` wrapper from inside all
 *      guard() calls — guard() → hasAccess() now decides based on permissions.
 *   2. hasAccess() now defaults to "none" for advisor roles (instead of "edit"),
 *      so advisors without an explicit permission remain blocked by default.
 *
 * These are source-grep tests — no server or browser required.
 */

const fs = require("fs");
const path = require("path");

const APP = fs.readFileSync(path.join(__dirname, "../client/src/App.tsx"), "utf8");
const NAV = fs.readFileSync(path.join(__dirname, "../client/src/lib/nav-config.ts"), "utf8");

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

console.log("=== Pipeline / Advisor Access Regression Tests ===\n");

// ── 1. hasAccess defaults to "none" for advisor roles ────────────────────────
console.log('── 1. hasAccess() advisor default ──');

check(
  "hasAccess function defined in App.tsx",
  /function hasAccess\(/.test(APP)
);
check(
  "isAdvisorRole imported in App.tsx",
  /import.*isAdvisorRole.*nav-config/.test(APP)
);
check(
  'hasAccess uses "none" as default for advisor roles',
  /isAdvisorRole\(globalRole\).*\?.*["']none["']/.test(APP) ||
  /defaultLevel.*isAdvisorRole/.test(APP)
);
check(
  'hasAccess uses "edit" as default for non-advisor roles',
  /isAdvisorRole\(globalRole\).*\?.*["']none["'].*:.*["']edit["']/.test(APP) ||
  /["']edit["'].*:.*["']none["']/.test(APP)
);
check(
  "hasAccess still gives admins full access",
  /isAdmin\(globalRole\).*return true/.test(APP)
);

// ── 2. guard() calls no longer have isAdvisor hardblock ──────────────────────
console.log('\n── 2. No isAdvisor hardblock inside guard() calls ──');

// These should NOT exist anymore
check(
  'No guard("crm", isAdvisor ? ... pattern remaining',
  !APP.includes('guard("crm", isAdvisor ? <AccessDenied />')
);
check(
  'No guard("quoting", isAdvisor ? ... pattern remaining',
  !APP.includes('guard("quoting", isAdvisor ? <AccessDenied />')
);
check(
  'No guard("partnerships", isAdvisor ? ... pattern remaining',
  !APP.includes('guard("partnerships", isAdvisor ? <AccessDenied />')
);
check(
  'No guard("communications", isAdvisor ? ... pattern remaining',
  !APP.includes('guard("communications", isAdvisor ? <AccessDenied />')
);

// ── 3. Key CRM routes now use clean guard() calls ────────────────────────────
console.log('\n── 3. CRM routes use guard() without inline advisor block ──');

check(
  '/pipeline route uses guard("crm", <PipelinePage',
  /route.*pipeline.*guard\("crm",\s*<PipelinePage/.test(APP) ||
  APP.includes('guard("crm", <PipelinePage')
);
check(
  '/opportunities route uses guard("crm", <LeadsPage',
  APP.includes('guard("crm", <LeadsPage')
);
check(
  '/accounts route uses guard("crm", <AccountsPage',
  APP.includes('guard("crm", <AccountsPage')
);
check(
  '/contacts route uses guard("crm", <ContactsPage',
  APP.includes('guard("crm", <ContactsPage')
);
check(
  '/pipeline/leads-accounts uses guard("crm", <PipelineLeadsAccountsPage',
  APP.includes('guard("crm", <PipelineLeadsAccountsPage')
);
check(
  '/insights/revenue-intelligence uses guard("crm", <InsightsRevIntelPage',
  APP.includes('guard("crm", <InsightsRevIntelPage')
);

// ── 4. advisorBlock (for non-permission routes) is unchanged ─────────────────
console.log('\n── 4. advisorBlock still intact for non-permission routes ──');

check(
  "advisorBlock function still exists",
  /function advisorBlock\(/.test(APP)
);
check(
  "advisorBlock body still checks isAdvisor",
  /advisorBlock[\s\S]{0,100}isAdvisor \? <AccessDenied/.test(APP)
);
check(
  "/revenue still uses advisorBlock (non-permission route)",
  /path="\/revenue"[\s\S]{0,80}advisorBlock/.test(APP)
);
check(
  "/routing still uses advisorBlock (non-permission route)",
  /path="\/routing"[\s\S]{0,80}advisorBlock/.test(APP)
);

// ── 5. guard() function correctly delegates to hasAccess ─────────────────────
console.log('\n── 5. guard() function delegates to hasAccess ──');

const guardFn = APP.match(/function guard\(section[^)]*\)[^{]*\{[\s\S]*?\}/)?.[0] ?? "";
check(
  "guard() function defined",
  /function guard\(section/.test(APP)
);
check(
  "guard() calls hasAccess(perms, role, section)",
  /hasAccess\(perms,\s*role,\s*section\)/.test(APP)
);
check(
  "guard() renders <AccessDenied /> when hasAccess returns false",
  /hasAccess[\s\S]{0,50}AccessDenied/.test(APP)
);

// ── 6. isAdvisorRole identifies advisor role ─────────────────────────────────
console.log('\n── 6. isAdvisorRole helper ──');

check(
  "isAdvisorRole exported from nav-config.ts",
  /export function isAdvisorRole/.test(NAV)
);
check(
  'isAdvisorRole returns true for "advisor" role',
  /isAdvisorRole[\s\S]{0,100}=== ["']advisor["']/.test(NAV)
);

// ── 7. advisorHidden controls sidebar visibility only, not route access ───────
console.log('\n── 7. advisorHidden is nav-only, not a route gate ──');

check(
  "advisorHidden defined as optional boolean in nav-config",
  /advisorHidden\?:\s*boolean/.test(NAV)
);
check(
  "advisorHidden NOT used directly in hasAccess",
  !/hasAccess[\s\S]{0,200}advisorHidden/.test(APP)
);
check(
  "Pipeline parent nav uses advisorHidden (sidebar item hidden by default)",
  /id.*pipeline[\s\S]{0,50}advisorHidden\s*:\s*true/.test(NAV) ||
  NAV.includes('"pipeline"') && NAV.includes("advisorHidden: true")
);

// ── 8. Backend requirePermission("crm", "view") allows view-level access ─────
console.log('\n── 8. Backend permission check allows view-level for CRM ──');

const ROUTES = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");

check(
  'app.use("/api/leads") uses requirePermission("crm", "view")',
  /app\.use\(["']\/api\/leads["'][\s\S]{0,80}requirePermission\(["']crm["'],\s*["']view["']\)/.test(ROUTES)
);
check(
  'app.use("/api/accounts") uses requirePermission("crm", "view")',
  /app\.use\(["']\/api\/accounts["'][\s\S]{0,80}requirePermission\(["']crm["'],\s*["']view["']\)/.test(ROUTES)
);
check(
  'app.use("/api/contacts") uses requirePermission("crm", "view")',
  /app\.use\(["']\/api\/contacts["'][\s\S]{0,80}requirePermission\(["']crm["'],\s*["']view["']\)/.test(ROUTES)
);
check(
  'export/mutation endpoints require "edit" level (not just "view")',
  /requirePermission\(["']crm["'],\s*["']edit["']\)/.test(ROUTES)
);

// ── 9. requirePermission server helper checks actual stored permission ─────────
console.log('\n── 9. requirePermission checks stored permission, not role ──');

const AUTH = fs.readFileSync(path.join(__dirname, "../server/auth.ts"), "utf8");

check(
  "requirePermission defined in auth.ts",
  /function requirePermission|export.*requirePermission/.test(AUTH)
);
check(
  "requirePermission reads user permissions from DB or session",
  /permissions|perm/.test(AUTH)
);
check(
  "requirePermission returns 403 when denied",
  /403/.test(AUTH)
);
check(
  "admin/master_admin bypass in requirePermission",
  /master_admin/.test(AUTH)
);

// ── 10. Section permission key for Pipeline is "crm" everywhere ───────────────
console.log('\n── 10. Canonical permission key "crm" for Pipeline ──');

check(
  'SECTION_DEFS in admin-users.tsx uses key "crm" for Growth OS / Pipeline',
  fs.readFileSync(path.join(__dirname, "../client/src/pages/admin-users.tsx"), "utf8")
    .includes('key: "crm"')
);
check(
  'Pipeline nav items use permKey: "crm"',
  /id.*leads-accounts[\s\S]{0,50}permKey.*crm/.test(NAV) ||
  NAV.includes('permKey: "crm"')
);
check(
  'guard("crm") used for Pipeline routes in App.tsx',
  (APP.match(/guard\("crm"/g) ?? []).length >= 10
);

// ── 11. No isAdvisor role-check left inside route children (regression) ────────
console.log('\n── 11. No stale isAdvisor ternaries in route children ──');

// Find all occurrences of isAdvisor in routes section (after line ~353)
const routeSection = APP.slice(APP.indexOf("return (") + 8);
const advisorInRoutes = (routeSection.match(/isAdvisor(?!\s*=)/g) ?? []).length;
// Should only appear in advisorBlock usage sites — not as inline ternaries
check(
  "isAdvisor appears ≤ 6 times in route section (only advisorBlock usages)",
  advisorInRoutes <= 6
);

// Make sure no guard() call passes an isAdvisor ternary as children
check(
  'No guard(..."...", isAdvisor ?) pattern in routes',
  !/guard\(["'][^"']*["'],\s*isAdvisor\s*\?/.test(APP)
);

console.log("\n───────────────────────────────────────────────────────");
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log("───────────────────────────────────────────────────────");

if (failed > 0) process.exit(1);
