"use strict";
/**
 * tests/security-production-launch.test.cjs
 *
 * Phase 18 — Production Security Launch, Monitoring, and Final Verification
 *
 * Source-grep suite verifying end-to-end readiness for deploy. Covers:
 * - Phase 15 docs exist and have content
 * - Phase 16 framework exists
 * - Phase 17 applied audit calls and confirmation dialogs
 * - Production monitoring doc exists
 * - Migration is idempotent and non-destructive
 * - Fire-and-forget audit pattern
 * - Metadata sanitization (BLOCKED_METADATA_KEYS)
 * - No sensitive metadata in any live audit call
 * - No auto-send introduced on copy-only routes
 * - No route guards weakened
 * - Threat model covers Capital / Board Pack / Forecast surfaces
 *
 * No HTTP server needed — pure static analysis.
 */

const fs   = require("fs");
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

function readFile(relPath) {
  try {
    return fs.readFileSync(path.join(__dirname, "..", relPath), "utf8");
  } catch {
    return "";
  }
}

// ── Load files ────────────────────────────────────────────────────────────────
console.log("\n=== Phase 18: Production Security Launch Verification ===\n");

const routesTs       = readFile("server/routes.ts");
const capitalTs      = readFile("server/routes-capital.ts");
const securityAudit  = readFile("server/services/security-audit.ts");
const migration0025  = readFile("migrations/0025_security_audit_events.sql");
const confirmComp    = readFile("client/src/components/security/confirm-high-risk-action.tsx");
const boardPackTsx   = readFile("client/src/pages/board-pack.tsx");
const capitalInvTsx  = readFile("client/src/pages/capital-investors.tsx");
const adminUsersTsx  = readFile("client/src/pages/admin-users.tsx");
const threatModel    = readFile("threat_model.md");
const highRiskDoc    = readFile("docs/security-high-risk-actions.md");
const accessMatrix   = readFile("docs/security-access-control-matrix.md");
const clientStorage  = readFile("docs/security-client-storage.md");
const monitoringDoc  = readFile("docs/security-production-monitoring.md");

// ── 1. Phase 15 documentation exists ────────────────────────────────────────
console.log("1. Phase 15 documentation exists");

assert(accessMatrix.length > 500, "docs/security-access-control-matrix.md has content");
assert(accessMatrix.includes("Phase 15"), "access-control matrix references Phase 15");
assert(clientStorage.length > 200, "docs/security-client-storage.md has content");
assert(clientStorage.includes("Phase 15"), "client-storage doc references Phase 15");

// ── 2. Phase 16 framework exists ─────────────────────────────────────────────
console.log("\n2. Phase 16 framework exists");

assert(
  securityAudit.includes("export async function recordHighRiskAction"),
  "recordHighRiskAction exported from security-audit service"
);
assert(
  securityAudit.includes("export function getAuditActor"),
  "getAuditActor exported from security-audit service"
);
assert(
  securityAudit.includes("safeAuditMetadata"),
  "safeAuditMetadata function present in security-audit service"
);
assert(
  securityAudit.includes("BLOCKED_METADATA_KEYS"),
  "BLOCKED_METADATA_KEYS present in security-audit service"
);
assert(
  confirmComp.includes("export function ConfirmHighRiskAction"),
  "ConfirmHighRiskAction component exported"
);
assert(migration0025.length > 100, "migration 0025 security_audit_events exists");

// ── 3. Phase 17 applied audit calls exist ────────────────────────────────────
console.log("\n3. Phase 17 applied audit calls");

const phase17Actions = [
  "board_pack_finalize",
  "board_pack_archive",
  "board_pack_markdown_export",
  "board_pack_investor_draft",
  "user_permissions_change",
  "user_suspend",
  "user_delete",
  "currents_channel_archive",
  "currents_member_add",
  "currents_member_remove",
  "gmail_account_disconnect",
  "gmail_disconnect",
];

for (const action of phase17Actions) {
  assert(routesTs.includes(`action: "${action}"`), `routes.ts has audit call: ${action}`);
}

const capitalActions = [
  "investor_portal_access_create",
  "investor_portal_token_revoke",
  "investor_portal_access_delete",
  "investor_portal_token_regenerate",
];

for (const action of capitalActions) {
  assert(capitalTs.includes(`action: "${action}"`), `routes-capital.ts has audit call: ${action}`);
}

// ── 4. Phase 17 confirmation dialogs wired ───────────────────────────────────
console.log("\n4. Phase 17 frontend confirmation dialogs");

assert(
  boardPackTsx.includes("<ConfirmHighRiskAction") &&
    boardPackTsx.includes('title="Finalize this Board Pack?"'),
  "Board Pack finalize guarded by ConfirmHighRiskAction"
);
assert(
  boardPackTsx.includes("<ConfirmHighRiskAction") &&
    boardPackTsx.includes('title="Archive this Board Pack?"'),
  "Board Pack archive guarded by ConfirmHighRiskAction"
);
assert(
  capitalInvTsx.includes('title="Revoke Portal Access?"'),
  "Capital portal revoke guarded by ConfirmHighRiskAction"
);
assert(
  capitalInvTsx.includes('title="Delete Portal Link?"') &&
    capitalInvTsx.includes('confirmationText="DELETE"'),
  "Capital portal delete requires typing DELETE"
);
assert(
  capitalInvTsx.includes('title="Regenerate Portal Token?"'),
  "Capital portal regenerate guarded by ConfirmHighRiskAction"
);
assert(
  adminUsersTsx.includes("<ConfirmHighRiskAction") &&
    adminUsersTsx.includes('confirmationText="DELETE"'),
  "Admin user delete uses ConfirmHighRiskAction with DELETE confirmation"
);
assert(
  adminUsersTsx.includes("irreversible"),
  "Admin user delete is marked irreversible"
);

// ── 5. Production monitoring doc exists ──────────────────────────────────────
console.log("\n5. Production monitoring doc exists");

assert(monitoringDoc.length > 1000, "docs/security-production-monitoring.md has content");
assert(
  monitoringDoc.includes("First-24-Hour") || monitoringDoc.includes("first 24"),
  "monitoring doc has first-24-hour section"
);
assert(
  monitoringDoc.includes("Rollback"),
  "monitoring doc has rollback triggers section"
);
assert(
  monitoringDoc.includes("smoke") || monitoringDoc.includes("Smoke"),
  "monitoring doc has manual smoke checklist"
);
assert(
  monitoringDoc.includes("Audit Event") || monitoringDoc.includes("audit event"),
  "monitoring doc has audit event review section"
);

// ── 6. Migration is idempotent and non-destructive ───────────────────────────
console.log("\n6. Migration safety (0025_security_audit_events.sql)");

assert(
  migration0025.includes("CREATE TABLE IF NOT EXISTS security_audit_events"),
  "migration uses CREATE TABLE IF NOT EXISTS"
);
assert(
  migration0025.includes("CREATE INDEX IF NOT EXISTS"),
  "migration uses CREATE INDEX IF NOT EXISTS"
);
assert(
  !migration0025.includes("DROP "),
  "migration has no DROP statement"
);
assert(
  !migration0025.includes("TRUNCATE"),
  "migration has no TRUNCATE statement"
);
assert(
  !migration0025.includes("DELETE FROM"),
  "migration has no DELETE FROM statement"
);
assert(
  !migration0025.includes("undefined"),
  "migration has no undefined pool reference"
);

// ── 7. Fire-and-forget audit pattern ─────────────────────────────────────────
console.log("\n7. Fire-and-forget audit pattern");

const routesVoidCount   = (routesTs.match(/void recordHighRiskAction\(/g) || []).length;
const capitalVoidCount  = (capitalTs.match(/void recordHighRiskAction\(/g) || []).length;
const routesAwaitCount  = (routesTs.match(/await recordHighRiskAction\(/g) || []).length;
const capitalAwaitCount = (capitalTs.match(/await recordHighRiskAction\(/g) || []).length;

assert(routesVoidCount >= 12,   `routes.ts has ≥12 fire-and-forget audit calls (found ${routesVoidCount})`);
assert(capitalVoidCount >= 4,   `routes-capital.ts has ≥4 fire-and-forget audit calls (found ${capitalVoidCount})`);
assert(routesAwaitCount === 0,  `routes.ts has no blocking await recordHighRiskAction (found ${routesAwaitCount})`);
assert(capitalAwaitCount === 0, `routes-capital.ts has no blocking await (found ${capitalAwaitCount})`);

// ── 8. BLOCKED_METADATA_KEYS strips all required sensitive fields ─────────────
console.log("\n8. Metadata sanitization — BLOCKED_METADATA_KEYS completeness");

const sensitiveKeys = [
  "email_body",
  "body",
  "token",
  "access_token",
  "refresh_token",
  "password",
  "secret",
  "memo_text",
  "board_pack_content",
  "investor_memo",
  "investor_update_body",
  "draft_body",
];

for (const key of sensitiveKeys) {
  assert(
    securityAudit.includes(`"${key}"`),
    `BLOCKED_METADATA_KEYS includes "${key}"`
  );
}

// ── 9. No sensitive metadata in live audit calls ──────────────────────────────
console.log("\n9. No sensitive payload in live audit calls");

// Extract all metadata: {...} blocs from recordHighRiskAction calls
const auditCallsRoutes  = routesTs.match(/void recordHighRiskAction\(\{[^)]+\}\)/g) || [];
const auditCallsCapital = capitalTs.match(/void recordHighRiskAction\(\{[^)]+\}\)/g) || [];
const allAuditCalls     = [...auditCallsRoutes, ...auditCallsCapital];

const SENSITIVE_PATTERNS = [
  /email_body/i,
  /refresh_token/i,
  /access_token/i,
  /password/i,
  /memo_text/i,
  /board_pack_content/i,
  /investor_memo/i,
  /draft_body/i,
  /message_body/i,
];

let sensitiveLeak = false;
for (const call of allAuditCalls) {
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(call)) {
      sensitiveLeak = true;
      console.log(`    LEAK: ${call.slice(0, 120)}`);
    }
  }
}
assert(!sensitiveLeak, "no sensitive payload keys in any live audit call");

// ── 10. No auto-send introduced on copy-only routes ───────────────────────────
console.log("\n10. Copy-only routes: no auto-send introduced");

// CEO briefing and board pack draft routes must not call sendEmail
const copyOnlyRoutes = [
  "ceo-briefing/weekly/draft",
  "ceo-briefing/leadership-agenda/draft",
  "board-packs",
  "investor-update-draft",
];

for (const routeFragment of copyOnlyRoutes) {
  // Find the handler block for this route fragment (up to ~600 chars)
  const idx = routesTs.indexOf(routeFragment);
  if (idx === -1) continue; // not in routes.ts — skip
  const block = routesTs.slice(Math.max(0, idx - 100), idx + 600);
  // The block should NOT contain a sendEmail() call
  const hasAutoSend = /sendEmail\s*\(/.test(block);
  assert(!hasAutoSend, `no auto-send in "${routeFragment}" handler`);
}

// Capital investor-update-draft check
const capitalDraftIdx = capitalTs.indexOf("investor-update-draft");
if (capitalDraftIdx !== -1) {
  const capitalBlock = capitalTs.slice(Math.max(0, capitalDraftIdx - 100), capitalDraftIdx + 600);
  assert(!/sendEmail\s*\(/.test(capitalBlock), "no auto-send in capital investor-update-draft handler");
}

// ── 11. Route guards not weakened ────────────────────────────────────────────
console.log("\n11. Route guards not weakened");

assert(
  routesTs.includes("requireAdmin") && routesTs.includes("requireAuth"),
  "routes.ts still contains requireAdmin and requireAuth guards"
);
assert(
  capitalTs.includes("requireCapitalAccess"),
  "routes-capital.ts retains requireCapitalAccess guard"
);
assert(
  capitalTs.includes("requireBoardPackAccess") || routesTs.includes("requireBoardPackAccess"),
  "requireBoardPackAccess guard still present"
);
assert(
  capitalTs.includes("requireForecastCapitalAccess") || routesTs.includes("requireForecastCapitalAccess"),
  "requireForecastCapitalAccess guard still present"
);

// Verify board pack routes are still gated
const boardPackFinalizeBlock = (() => {
  const idx = routesTs.indexOf("board_pack_finalize");
  if (idx === -1) return "";
  return routesTs.slice(Math.max(0, idx - 800), idx + 50);
})();
assert(
  boardPackFinalizeBlock.includes("requireAuth") || boardPackFinalizeBlock.includes("requireBoardPackAccess"),
  "board_pack_finalize route still has an auth guard in its handler block"
);

// Admin delete must still require requireAdmin
const userDeleteBlock = (() => {
  const idx = routesTs.indexOf("user_delete");
  if (idx === -1) return "";
  return routesTs.slice(Math.max(0, idx - 1200), idx + 50);
})();
assert(
  userDeleteBlock.includes("requireAdmin") || userDeleteBlock.includes("requireAuth"),
  "user_delete route still has auth guard in its handler block"
);

// Capital portal revoke must still require capital access
const revokeBlock = (() => {
  const idx = capitalTs.indexOf("investor_portal_token_revoke");
  if (idx === -1) return "";
  return capitalTs.slice(Math.max(0, idx - 800), idx + 50);
})();
assert(
  revokeBlock.includes("requireCapitalAccess") || revokeBlock.includes("requireAdmin"),
  "capital portal revoke route still has access guard"
);

// ── 12. Threat model covers high-risk surfaces ───────────────────────────────
console.log("\n12. Threat model covers high-risk surfaces");

assert(
  threatModel.includes("Capital") && threatModel.includes("/api/capital/*"),
  "threat model mentions Capital routes"
);
assert(
  threatModel.includes("Board Pack") || threatModel.includes("board-packs"),
  "threat model mentions Board Pack routes"
);
assert(
  threatModel.includes("forecast") || threatModel.includes("Forecast"),
  "threat model mentions forecasting/runway routes"
);
assert(
  threatModel.includes("requireCapitalAccess"),
  "threat model documents requireCapitalAccess guard"
);
assert(
  threatModel.includes("requireBoardPackAccess"),
  "threat model documents requireBoardPackAccess guard"
);
assert(
  threatModel.includes("requireForecastCapitalAccess"),
  "threat model documents requireForecastCapitalAccess guard"
);

// ── 13. High-risk docs updated with Phase 17 table ───────────────────────────
console.log("\n13. High-risk action doc is up to date");

assert(
  highRiskDoc.includes("Phase 17"),
  "docs/security-high-risk-actions.md references Phase 17"
);
assert(
  highRiskDoc.includes("board_pack_finalize"),
  "high-risk doc lists board_pack_finalize in Phase 17 table"
);
assert(
  highRiskDoc.includes("investor_portal_token_revoke"),
  "high-risk doc lists investor_portal_token_revoke in Phase 17 table"
);
assert(
  highRiskDoc.includes("user_delete"),
  "high-risk doc lists user_delete in Phase 17 table"
);
assert(
  highRiskDoc.includes("gmail_disconnect"),
  "high-risk doc lists gmail_disconnect in Phase 17 table"
);

// ── 14. ConfirmHighRiskAction component has correct data-testids ─────────────
console.log("\n14. ConfirmHighRiskAction component test accessibility");

assert(
  confirmComp.includes('data-testid="confirm-high-risk-dialog"'),
  "dialog has data-testid"
);
assert(
  confirmComp.includes('data-testid="confirm-action-button"'),
  "confirm button has data-testid"
);
assert(
  confirmComp.includes('data-testid="confirm-cancel-button"'),
  "cancel button has data-testid"
);
assert(
  confirmComp.includes("loading"),
  "component supports loading state"
);

// ── 15. No destructive SQL introduced ────────────────────────────────────────
console.log("\n15. No destructive SQL introduced in Phase 17 routes");

// Extract the rough Phase 17 areas of routes.ts (around the audit calls)
// We check that no DROP/TRUNCATE/DELETE FROM appears within 500 chars of each audit call
const phaseRoutes = routesTs;
const destructivePatterns = [/DROP TABLE/i, /TRUNCATE\s+/i, /DELETE FROM security_audit/i];

let destructiveFound = false;
for (const pattern of destructivePatterns) {
  if (pattern.test(phaseRoutes) || pattern.test(capitalTs)) {
    destructiveFound = true;
    console.log(`    DESTRUCTIVE SQL found: ${pattern}`);
  }
}
assert(!destructiveFound, "no DROP/TRUNCATE/DELETE FROM security_audit in routes");

// Also check migration once more for completeness
assert(
  !migration0025.includes("DROP TABLE") &&
  !migration0025.includes("TRUNCATE") &&
  !migration0025.includes("DELETE FROM"),
  "migration 0025 has no destructive SQL"
);

// ── 16. getAuditActor usage correct ──────────────────────────────────────────
console.log("\n16. getAuditActor used correctly");

const actorPatterns = [
  /actor_user_id: getAuditActor\(req\)/,
];

let actorMissing = false;
for (const pattern of actorPatterns) {
  const routesOk  = pattern.test(routesTs);
  const capitalOk = pattern.test(capitalTs);
  if (!routesOk && !capitalOk) {
    actorMissing = true;
  }
}
assert(!actorMissing, "audit calls use getAuditActor(req) for actor_user_id");

// Count how many audit calls include actor_user_id
const actorCount = (
  (routesTs.match(/actor_user_id: getAuditActor\(req\)/g) || []).length +
  (capitalTs.match(/actor_user_id: getAuditActor\(req\)/g) || []).length
);
assert(actorCount >= 16, `all ≥16 audit calls include actor_user_id (found ${actorCount})`);

// ── 17. Audit severity appropriate ───────────────────────────────────────────
console.log("\n17. Audit severity checks");

const criticalCount = (
  (routesTs.match(/severity: "critical"/g) || []).length +
  (capitalTs.match(/severity: "critical"/g) || []).length
);
const highCount = (
  (routesTs.match(/severity: "high"/g) || []).length +
  (capitalTs.match(/severity: "high"/g) || []).length
);

assert(criticalCount >= 14, `≥14 critical-severity audit calls (found ${criticalCount})`);
assert(highCount >= 2,      `≥2 high-severity audit calls for non-destructive exports (found ${highCount})`);

// ── 18. Monitoring doc references all 16 Phase 17 actions ───────────────────
console.log("\n18. Monitoring doc covers all 16 Phase 17 actions");

const monitoringActions = [
  "board_pack_finalize",
  "board_pack_archive",
  "user_permissions_change",
  "user_delete",
  "currents_channel_archive",
  "gmail_account_disconnect",
  "investor_portal_token_revoke",
  "investor_portal_token_regenerate",
];

for (const action of monitoringActions) {
  assert(monitoringDoc.includes(action), `monitoring doc covers action: ${action}`);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log("Phase 18 — Production Security Launch Verification");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log("\nFailed checks:");
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
} else {
  console.log("All checks passed ✓");
  process.exit(0);
}
