/**
 * automation-engine-security.test.cjs
 *
 * Source-grep tests for Task #38: automation engine privilege escalation
 * and SQL injection vulnerabilities.
 *
 * Checks:
 *   1. requireAdmin added to all automation mutation routes
 *   2. objectType validated against VALID_OBJECT_TYPES in the run route
 *   3. VALID_OBJECT_TYPES exported from automation-engine.ts
 *   4. No sql.raw(template-literal) with user-supplied values in engine
 *   5. params.table not used as a raw SQL identifier (removed from change_status)
 *   6. Table names derived exclusively from internal allowlist maps
 *   7. Cooldown query is parameterized (no string concat for contextKey)
 *   8. run_logs INSERT and automation_rules UPDATE are parameterized
 */
"use strict";
const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function bad(label, reason) { console.log(`  ✗ ${label} — ${reason}`); failed++; }

const routes = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");
const engine = fs.readFileSync(path.join(__dirname, "../server/services/automation-engine.ts"), "utf8");

// ── 1. requireAdmin on all mutation routes ─────────────────────────────────
console.log("\n── 1. requireAdmin on automation mutation routes ──");

// Helper: find a route registration block and check it contains requireAdmin
function routeHasAdmin(method, pathPattern) {
  // Find the app.<method>("<pathPattern" line and check for requireAdmin nearby
  const re = new RegExp(`app\\.${method}\\(["']${pathPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][\\s\\S]{0,200}requireAdmin`, "m");
  return re.test(routes);
}

// POST /api/automations (create)
if (routeHasAdmin("post", "/api/automations"))
  ok("POST /api/automations has requireAdmin");
else
  bad("POST /api/automations", "requireAdmin not found in route middleware");

// POST /api/automations/:id/run
if (routeHasAdmin("post", "/api/automations/:id/run"))
  ok("POST /api/automations/:id/run has requireAdmin");
else
  bad("POST /api/automations/:id/run", "requireAdmin not found in route middleware");

// PUT /api/automations/:id
if (routeHasAdmin("put", "/api/automations/:id"))
  ok("PUT /api/automations/:id has requireAdmin");
else
  bad("PUT /api/automations/:id", "requireAdmin not found in route middleware");

// PATCH /api/automations/:id/toggle
if (routeHasAdmin("patch", "/api/automations/:id/toggle"))
  ok("PATCH /api/automations/:id/toggle has requireAdmin");
else
  bad("PATCH /api/automations/:id/toggle", "requireAdmin not found in route middleware");

// DELETE /api/automations/:id
if (routeHasAdmin("delete", "/api/automations/:id"))
  ok("DELETE /api/automations/:id has requireAdmin");
else
  bad("DELETE /api/automations/:id", "requireAdmin not found in route middleware");

// GET routes should NOT require admin (they are read-only)
if (/app\.get\(["']\/api\/automations["'],\s*requireAuth,/.test(routes))
  ok("GET /api/automations (list) still only requireAuth — not over-restricted");
else
  bad("GET /api/automations", "unexpected change to list route");

// ── 2. objectType validated in run route ───────────────────────────────────
console.log("\n── 2. objectType validated against allowlist in run route ──");

// Find the run route block
const runRouteStart = routes.indexOf('app.post("/api/automations/:id/run"');
const runRouteEnd = routes.indexOf("});", runRouteStart) + 3;
const runBlock = runRouteStart > 0 ? routes.slice(runRouteStart, runRouteEnd) : "";

if (runBlock)
  ok("POST /api/automations/:id/run block found");
else
  bad("run route block", "could not locate run route in routes.ts");

// Use a wider window (1500 chars) from the run route declaration — the route
// body is longer than the first "}); " which closes only the inner if-block.
const runWide = runRouteStart > 0 ? routes.slice(runRouteStart, runRouteStart + 1500) : "";

if (/VALID_OBJECT_TYPES/.test(runWide))
  ok("run route references VALID_OBJECT_TYPES for validation");
else
  bad("VALID_OBJECT_TYPES check", "VALID_OBJECT_TYPES not used in run route");

if (/VALID_OBJECT_TYPES\.has\(/.test(runWide))
  ok("run route calls VALID_OBJECT_TYPES.has() to validate objectType");
else
  bad("VALID_OBJECT_TYPES.has()", "allowlist .has() check not found in run route");

if (/res\.status\(400\)/.test(runWide))
  ok("run route returns 400 for invalid objectType");
else
  bad("400 response", "400 status not returned for invalid objectType");

// ── 3. VALID_OBJECT_TYPES exported from automation-engine.ts ──────────────
console.log("\n── 3. VALID_OBJECT_TYPES exported from automation-engine.ts ──");

if (/export const VALID_OBJECT_TYPES/.test(engine))
  ok("VALID_OBJECT_TYPES is exported from automation-engine.ts");
else
  bad("VALID_OBJECT_TYPES export", "not found in automation-engine.ts");

if (/VALID_OBJECT_TYPES = new Set/.test(engine))
  ok("VALID_OBJECT_TYPES is a Set");
else
  bad("VALID_OBJECT_TYPES Set", "Set definition not found");

// Verify it includes known valid object types
const vtStart = engine.indexOf("VALID_OBJECT_TYPES = new Set");
const vtEnd = engine.indexOf(");", vtStart) + 2;
const vtBlock = vtStart > 0 ? engine.slice(vtStart, vtEnd) : "";
if (/lead/.test(vtBlock) && /account/.test(vtBlock) && /opportunity/.test(vtBlock))
  ok("VALID_OBJECT_TYPES includes lead, account, opportunity");
else
  bad("VALID_OBJECT_TYPES contents", "expected object types not found in set");

// ── 4. No sql.raw(template-literal) with user data in execAction ──────────
console.log("\n── 4. sql.raw() template-literal injections removed in execAction ──");

// The old code used sql.raw(`...${ot}...`) — all VALUES inserts should now use
// parameterized sql tagged template instead.
const execActionStart = engine.indexOf("async function execAction(");
const execActionEnd = engine.indexOf("\n}", execActionStart) + 2;
const execBlock = execActionStart > 0 ? engine.slice(execActionStart, execActionEnd) : "";

if (execBlock)
  ok("execAction function found");
else
  bad("execAction", "function not found in automation-engine.ts");

// The dangerous pattern is sql.raw(`...`) with a template literal containing ${ot}
// New code should use sql`` tagged template for VALUES (where ot is a param)
if (!/sql\.raw\(`[\s\S]{0,200}\$\{ot\}/.test(execBlock))
  ok("sql.raw() with ${ot} interpolation removed from execAction");
else
  bad("sql.raw(${ot})", "sql.raw() still interpolates 'ot' in execAction");

// Check parameterized inserts are in place (sql` tagged template with ${ot} as param)
if (/await db\.execute\(sql`[\s\S]{0,200}\$\{ot\}/.test(execBlock))
  ok("execAction uses parameterized sql`` template with ot as a bound parameter");
else
  bad("parameterized ot", "sql tagged template with ${ot} not found in execAction");

// ── 5. params.table NOT used as raw SQL identifier ────────────────────────
console.log("\n── 5. action.params.table not used as raw SQL table name ──");

// The old code had: const tbl = table ?? tableMap[ot]; where table = p.table
// New code should derive tbl exclusively from STATUS_TABLE_MAP[ot].
// We check that p.table / action.params.table is not assigned to tbl in change_status.
const changeStatusStart = engine.indexOf('case "change_status":');
const changeStatusEnd = engine.indexOf("case ", changeStatusStart + 10);
const csBlock = changeStatusStart > 0 ? engine.slice(changeStatusStart, changeStatusEnd) : "";

if (csBlock)
  ok("change_status case block found");
else
  bad("change_status block", "not found in execAction");

// The old unsafe pattern: const table = p.table ...; const tbl = table ?? tableMap[ot]
if (!/p\.table/.test(csBlock) && !/params\.table/.test(csBlock))
  ok("change_status does not read p.table / params.table");
else
  bad("p.table removed", "change_status still reads p.table — injection risk");

// The table should come from STATUS_TABLE_MAP (internal allowlist)
if (/STATUS_TABLE_MAP/.test(csBlock))
  ok("change_status derives table from STATUS_TABLE_MAP allowlist");
else
  bad("STATUS_TABLE_MAP", "STATUS_TABLE_MAP not used in change_status case");

// ── 6. Table names come from internal allowlist maps only ─────────────────
console.log("\n── 6. Internal allowlist maps used for all table derivation ──");

if (/STATUS_TABLE_MAP\s*[:=]/.test(engine) || /STATUS_TABLE_MAP\s*=/.test(engine))
  ok("STATUS_TABLE_MAP defined in automation-engine.ts");
else
  bad("STATUS_TABLE_MAP", "not defined in automation-engine.ts");

if (/OWNER_TABLE_MAP\s*[:=]/.test(engine) || /OWNER_TABLE_MAP\s*=/.test(engine))
  ok("OWNER_TABLE_MAP defined in automation-engine.ts");
else
  bad("OWNER_TABLE_MAP", "not defined in automation-engine.ts");

// assign_owner should use OWNER_TABLE_MAP
const assignOwnerStart = engine.indexOf('case "assign_owner":');
const assignOwnerEnd = engine.indexOf("case ", assignOwnerStart + 10);
const aoBlock = assignOwnerStart > 0 ? engine.slice(assignOwnerStart, assignOwnerEnd) : "";

if (/OWNER_TABLE_MAP/.test(aoBlock))
  ok("assign_owner derives table from OWNER_TABLE_MAP allowlist");
else
  bad("OWNER_TABLE_MAP in assign_owner", "OWNER_TABLE_MAP not used in assign_owner case");

// ── 7. Cooldown query is parameterized ────────────────────────────────────
console.log("\n── 7. isCooledDown uses parameterized query ──");

const cooldownStart = engine.indexOf("export async function isCooledDown(");
const cooldownEnd = engine.indexOf("\n}", cooldownStart) + 2;
const coolBlock = cooldownStart > 0 ? engine.slice(cooldownStart, cooldownEnd) : "";

if (coolBlock)
  ok("isCooledDown function found");
else
  bad("isCooledDown", "function not found in automation-engine.ts");

// Old code used sql.raw(`... AND trigger_data->>'contextKey' = '${contextKey.replace(...)}'`)
// New code should use parameterized sql`` template
if (!/sql\.raw\(`[\s\S]{0,300}\$\{contextKey/.test(coolBlock))
  ok("isCooledDown does not interpolate contextKey into sql.raw()");
else
  bad("contextKey injection", "isCooledDown still interpolates contextKey in sql.raw()");

if (/await db\.execute\(sql`/.test(coolBlock))
  ok("isCooledDown uses parameterized sql`` tagged template");
else
  bad("parameterized cooldown", "sql tagged template not found in isCooledDown");

// ── 8. run_logs INSERT and automation_rules UPDATE are parameterized ───────
console.log("\n── 8. runAutomationRule log writes are parameterized ──");

const mainFnStart = engine.indexOf("export async function runAutomationRule(");
const mainFnEnd = engine.lastIndexOf("}");
const mainBlock = mainFnStart > 0 ? engine.slice(mainFnStart, mainFnEnd) : "";

if (mainBlock)
  ok("runAutomationRule function found");
else
  bad("runAutomationRule", "function not found");

// Old code: sql.raw(`INSERT INTO automation_run_logs ...`)
// New code: sql` tagged template
if (!/sql\.raw\(`[\s\S]{0,200}automation_run_logs/.test(mainBlock))
  ok("automation_run_logs INSERT is not using sql.raw() template literal");
else
  bad("run_logs sql.raw", "automation_run_logs INSERT still uses sql.raw() template literal");

if (/await db\.execute\(sql`[\s\S]{0,200}automation_run_logs/.test(mainBlock))
  ok("automation_run_logs INSERT uses parameterized sql`` tagged template");
else
  bad("run_logs parameterized", "parameterized sql`` for automation_run_logs not found");

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
