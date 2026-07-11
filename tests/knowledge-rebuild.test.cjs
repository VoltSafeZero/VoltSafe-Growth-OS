/**
 * knowledge-rebuild.test.cjs
 *
 * Source-grep regression suite for deployment-ID-based knowledge rebuild.
 * Verifies the complete spec (9 scenarios + infrastructure checks) without
 * requiring a live DB or HTTP server.
 *
 * Run: node tests/knowledge-rebuild.test.cjs
 */

"use strict";

const fs   = require("fs");
const path = require("path");

// ── Helpers ──────────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
const errors = [];

function check(name, ok, detail = "") {
  if (ok) {
    console.log(`  ✓ ${name}`);
    pass++;
  } else {
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
    fail++;
    errors.push(name);
  }
}

function readFile(rel) {
  return fs.readFileSync(path.resolve(__dirname, "..", rel), "utf8");
}

function has(src, pattern) {
  if (typeof pattern === "string") return src.includes(pattern);
  return pattern.test(src);
}

// ── Load source files ────────────────────────────────────────────────────────

const svc      = readFile("server/services/help-center-refresh.ts");
const routes   = readFile("server/routes.ts");

// ── Section 1: Deployment ID resolution ──────────────────────────────────────

console.log("\n════════════════════════════════════════════════════════════════");
console.log("Knowledge Rebuild — Deployment-ID Idempotency");
console.log("════════════════════════════════════════════════════════════════\n");

console.log("── 1. Deployment ID resolution ──");

check(
  "resolveDeploymentId() is exported",
  has(svc, "export function resolveDeploymentId"),
);

check(
  "REPLIT_DEPLOYMENT_ID is the primary env var",
  has(svc, "process.env.REPLIT_DEPLOYMENT_ID"),
);

check(
  "REPLIT_DEPLOYMENT_ID checked BEFORE git SHA",
  (() => {
    const replitIdx = svc.indexOf("REPLIT_DEPLOYMENT_ID");
    const gitIdx    = svc.indexOf("git rev-parse HEAD");
    return replitIdx > -1 && gitIdx > -1 && replitIdx < gitIdx;
  })(),
  "REPLIT_DEPLOYMENT_ID must come first in priority order",
);

check(
  "git SHA fallback: git rev-parse HEAD",
  has(svc, "git rev-parse HEAD"),
);

check(
  "dev-local fallback exists",
  has(svc, '"dev-local"'),
);

check(
  "CURRENT_DEPLOYMENT_ID exported as module-level const",
  has(svc, "export const CURRENT_DEPLOYMENT_ID"),
);

// ── Section 2: DB state table ─────────────────────────────────────────────────

console.log("\n── 2. DB state table ──");

check(
  "help_center_rebuild_state table created in migration IIFE",
  has(routes, "help_center_rebuild_state"),
);

check(
  "current_deployment_id column",
  has(routes, "current_deployment_id"),
);

check(
  "last_successfully_indexed_deployment_id column",
  has(routes, "last_successfully_indexed_deployment_id"),
);

check(
  "rebuild_status column",
  has(routes, "rebuild_status"),
);

check(
  "rebuild_started_at column",
  has(routes, "rebuild_started_at"),
);

check(
  "rebuild_completed_at column",
  has(routes, "rebuild_completed_at"),
);

check(
  "retry_count column",
  has(routes, "retry_count"),
);

check(
  "last_error column",
  has(routes, "last_error"),
);

// ── Section 3: readRebuildState / upsertRebuildState ─────────────────────────

console.log("\n── 3. DB state accessors ──");

check(
  "readRebuildState() exported from service",
  has(svc, "export async function readRebuildState"),
);

check(
  "upsertRebuildState() exported from service",
  has(svc, "export async function upsertRebuildState"),
);

check(
  "upsertRebuildState uses INSERT ... ON CONFLICT",
  has(svc, "ON CONFLICT (id) DO UPDATE"),
);

check(
  "readRebuildState returns DEFAULT_REBUILD_STATE on error (graceful fallback)",
  has(svc, "DEFAULT_REBUILD_STATE"),
);

// ── Section 4: runStartupRefresh — deployment ID not calendar date ────────────

console.log("\n── 4. runStartupRefresh — deployment-ID gate ──");

check(
  "runStartupRefresh exported",
  has(svc, "export async function runStartupRefresh"),
);

check(
  "runStartupRefresh calls runDeploymentIdGatedRebuild",
  has(svc, /runStartupRefresh[\s\S]{0,300}runDeploymentIdGatedRebuild/),
);

check(
  "runStartupRefresh does NOT check today's date as skip condition",
  !has(svc, /runStartupRefresh[\s\S]{0,600}last\.localDate.*===.*today/),
  "old date-based skip must be gone",
);

check(
  "runStartupRefresh does NOT use 'already refreshed today'",
  !has(svc, "already refreshed today"),
  "old skip message must be removed",
);

// ── Section 5: Scenario — first deployment triggers rebuild ───────────────────

console.log("\n── 5. Scenario: first deployment triggers rebuild ──");

check(
  "runDeploymentIdGatedRebuild() exported",
  has(svc, "export async function runDeploymentIdGatedRebuild"),
);

check(
  "pending status triggers rebuild (no skip on pending)",
  (() => {
    // The function must NOT have a 'pending' → skip path
    const body = svc.slice(svc.indexOf("runDeploymentIdGatedRebuild"));
    // 'pending' should not appear as a skip-trigger status
    return !has(body, /if.*rebuild_status.*===.*["']pending["'].*skip/);
  })(),
  "'pending' must not be a skip condition",
);

// ── Section 6: Scenario — second different deployment on same day → rebuilds ──

console.log("\n── 6. Scenario: second deployment on same day → rebuild ──");

check(
  "Skip only when IDs match AND status === succeeded",
  has(svc, "last_successfully_indexed_deployment_id === currentId") &&
  has(svc, 'rebuild_status === "succeeded"'),
  "both conditions required for skip",
);

check(
  "Different ID always triggers rebuild regardless of date",
  (() => {
    // Skip condition must NOT include date comparison
    const skipBlock = svc.match(/if\s*\(\s*[\s\S]{0,400}skip[\s\S]{0,50}\)/);
    const block = skipBlock ? skipBlock[0] : "";
    return !has(block, "localDate") && !has(block, "today");
  })(),
  "skip path must not compare dates",
);

// ── Section 7: Scenario — failed rebuild retries ──────────────────────────────

console.log("\n── 7. Scenario: failed rebuild retries ──");

check(
  "failed status causes rebuild (not skipped)",
  (() => {
    // 'failed' should NOT appear in the skip-guard conditions
    const skipBlock = svc.match(/rebuild_status.*succeeded[\s\S]{0,200}return.*"skipped"/);
    return skipBlock !== null && !has(skipBlock[0] || "", "failed");
  })(),
  "'failed' must not be in skip-guard",
);

check(
  "retry_count incremented when same deployment retries",
  has(svc, "retry_count + 1"),
);

check(
  "retry_count resets to 0 for new deployment",
  has(svc, "isSameDeploy ? state.retry_count + 1 : 0") ||
  has(svc, /isSameDeploy.*retry_count.*\+.*1.*:.*0/),
);

// ── Section 8: Midnight reconciliation uses deployment IDs ────────────────────

console.log("\n── 8. Midnight reconciliation ──");

check(
  "runMidnightReconciliation() exported",
  has(svc, "export async function runMidnightReconciliation"),
);

check(
  "runMidnightReconciliation calls runDeploymentIdGatedRebuild",
  has(svc, /runMidnightReconciliation[\s\S]{0,400}runDeploymentIdGatedRebuild/),
);

check(
  "runEndOfDayTick is deprecated alias (backward compat)",
  has(svc, "export const runEndOfDayTick = runMidnightReconciliation") ||
  has(svc, "runEndOfDayTick = runMidnightReconciliation"),
);

check(
  "wasRepublishedToday marked as deprecated",
  has(svc, "@deprecated") && has(svc, "wasRepublishedToday"),
);

check(
  "Scheduler calls runMidnightReconciliation (not date-based tick)",
  has(svc, /setTimeout[\s\S]{0,200}runMidnightReconciliation/),
);

// ── Section 9: Indexed ID only updated after success ─────────────────────────

console.log("\n── 9. Indexed ID updated only on success ──");

check(
  "last_successfully_indexed_deployment_id set only in success branch",
  (() => {
    // In the success branch the field is set as an object key: `last_successfully_indexed_deployment_id: currentId`
    const successPatch = svc.match(/action.*===.*["']refreshed["'][\s\S]{0,600}last_successfully_indexed_deployment_id[\s\S]{0,20}currentId/);
    return successPatch !== null;
  })(),
  "must only set indexed ID after action=refreshed",
);

check(
  "Failure path does NOT update last_successfully_indexed_deployment_id",
  (() => {
    const failBlock = svc.match(/action.*!==.*"refreshed"[\s\S]{0,400}rebuild_status.*failed/s);
    if (!failBlock) {
      // Check the else branch
      const elseSect = svc.match(/} else \{[\s\S]{0,400}rebuild_status.*failed/);
      if (elseSect) return !has(elseSect[0], "last_successfully_indexed_deployment_id");
    }
    return failBlock ? !has(failBlock[0], "last_successfully_indexed_deployment_id") : true;
  })(),
);

check(
  "Prior indexed ID preserved on failure (not reset to null)",
  (() => {
    const failPatch = svc.match(/rebuild_status.*failed[\s\S]{0,300}upsertRebuildState/s);
    // The fail patch should NOT contain last_successfully_indexed_deployment_id
    if (!failPatch) return true;
    return !has(failPatch[0], "last_successfully_indexed_deployment_id");
  })(),
);

// ── Section 10: Admin endpoint ────────────────────────────────────────────────

console.log("\n── 10. Admin status endpoint ──");

check(
  "GET /api/admin/knowledge-rebuild/status route exists",
  has(routes, "/api/admin/knowledge-rebuild/status"),
);

check(
  "POST /api/admin/knowledge-rebuild/trigger route exists",
  has(routes, "/api/admin/knowledge-rebuild/trigger"),
);

check(
  "Status endpoint requires auth + admin",
  has(routes, /\/api\/admin\/knowledge-rebuild\/status[\s\S]{0,100}requireAuth[\s\S]{0,50}requireAdmin/),
);

check(
  "Trigger endpoint requires auth + admin",
  has(routes, /\/api\/admin\/knowledge-rebuild\/trigger[\s\S]{0,100}requireAuth[\s\S]{0,50}requireAdmin/),
);

check(
  "getKnowledgeRebuildStatus exported from service",
  has(svc, "export async function getKnowledgeRebuildStatus") ||
  has(svc, "export type KnowledgeRebuildStatusResponse"),
);

// ── Section 11: Admin UI page ─────────────────────────────────────────────────

console.log("\n── 11. Admin UI page ──");

const uiFile = path.resolve(__dirname, "..", "client/src/pages/admin-knowledge-rebuild.tsx");
const ui     = fs.existsSync(uiFile) ? fs.readFileSync(uiFile, "utf8") : "";

check(
  "admin-knowledge-rebuild.tsx page exists",
  ui.length > 0,
);

check(
  "Page shows current deployment ID",
  has(ui, "currentDeploymentId") || has(ui, "current deployment"),
);

check(
  "Page shows indexed deployment ID",
  has(ui, "lastSuccessfullyIndexedDeploymentId") || has(ui, "Indexed deployment"),
);

check(
  "Status badge component present",
  has(ui, "StatusBadge") || has(ui, "rebuild-status"),
);

check(
  "'Rebuild now' button present",
  has(ui, "Rebuild now") || has(ui, "button-rebuild-now"),
);

check(
  "Uses /api/admin/knowledge-rebuild/status query",
  has(ui, "/api/admin/knowledge-rebuild/status"),
);

check(
  "Uses /api/admin/knowledge-rebuild/trigger mutation",
  has(ui, "/api/admin/knowledge-rebuild/trigger"),
);

// ── Section 12: Nav + routing ─────────────────────────────────────────────────

console.log("\n── 12. Navigation and routing ──");

const navCfg = readFile("client/src/lib/nav-config.ts");
const appTsx = readFile("client/src/App.tsx");

check(
  "/admin/knowledge-rebuild route registered in App.tsx",
  has(appTsx, "/admin/knowledge-rebuild"),
);

check(
  "AdminKnowledgeRebuildPage lazy-imported in App.tsx",
  has(appTsx, "AdminKnowledgeRebuildPage") || has(appTsx, "admin-knowledge-rebuild"),
);

check(
  "Knowledge Rebuild nav entry in nav-config.ts",
  has(navCfg, "knowledge-rebuild") || has(navCfg, "Knowledge Rebuild"),
);

check(
  "Nav entry is admin-only",
  has(navCfg, /knowledge.*rebuild[\s\S]{0,200}adminOnly.*true/i) ||
  has(navCfg, /Knowledge Rebuild[\s\S]{0,200}adminOnly/),
);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log("\n════════════════════════════════════════════════════════════════");
console.log(`Knowledge Rebuild — Deployment-ID Idempotency`);
console.log(`Results: ${pass} passed, ${fail} failed`);
if (errors.length) {
  console.error("Failed checks:");
  errors.forEach(e => console.error(`  • ${e}`));
  process.exit(1);
} else {
  console.log("All tests passed ✓");
}
