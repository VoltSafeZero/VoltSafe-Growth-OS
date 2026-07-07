"use strict";
/**
 * Phase 17 — High-Risk Action Application Test Suite
 * Source-grep based: verifies that every live action wired in Phase 17
 * has both the backend audit call and (where applicable) the frontend
 * confirmation guard.
 *
 * No server needed — pure static analysis.
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

function readFile(relPath) {
  return fs.readFileSync(path.join(__dirname, "..", relPath), "utf8");
}

// ── Load files ────────────────────────────────────────────────────────────────
console.log("\n=== Phase 17: High-Risk Action Application ===\n");

const routesTs = readFile("server/routes.ts");
const capitalTs = readFile("server/routes-capital.ts");
const boardPackTsx = readFile("client/src/pages/board-pack.tsx");
const capitalInvestorsTsx = readFile("client/src/pages/capital-investors.tsx");
const adminUsersTsx = readFile("client/src/pages/admin-users.tsx");
const securityAuditTs = readFile("server/services/security-audit.ts");

// ── 1. Security audit service baseline ───────────────────────────────────────
console.log("1. Security audit service exports");

assert(
  securityAuditTs.includes("export async function recordHighRiskAction"),
  "recordHighRiskAction is exported"
);
assert(
  securityAuditTs.includes("export function getAuditActor"),
  "getAuditActor is exported"
);
assert(
  securityAuditTs.includes("safeAuditMetadata"),
  "safeAuditMetadata helper present"
);

// ── 2. routes.ts import ───────────────────────────────────────────────────────
console.log("\n2. routes.ts import");

assert(
  routesTs.includes('import { recordHighRiskAction, getAuditActor } from "./services/security-audit"'),
  'routes.ts imports recordHighRiskAction + getAuditActor from security-audit'
);

// ── 3. routes-capital.ts import ───────────────────────────────────────────────
console.log("\n3. routes-capital.ts import");

assert(
  capitalTs.includes('import { recordHighRiskAction, getAuditActor } from "./services/security-audit"'),
  'routes-capital.ts imports recordHighRiskAction + getAuditActor from security-audit'
);

// ── 4. Board pack routes ──────────────────────────────────────────────────────
console.log("\n4. Board pack backend audit calls");

assert(
  routesTs.includes('action: "board_pack_finalize"'),
  "board_pack_finalize audit call present"
);
assert(
  routesTs.includes('action: "board_pack_archive"'),
  "board_pack_archive audit call present"
);
assert(
  routesTs.includes('action: "board_pack_markdown_export"'),
  "board_pack_markdown_export audit call present"
);
assert(
  routesTs.includes('action: "board_pack_investor_draft"'),
  "board_pack_investor_draft audit call present"
);
assert(
  routesTs.includes('category: "board_pack_action"'),
  'board pack actions use category "board_pack_action"'
);

// Check severity
assert(
  routesTs.includes('action: "board_pack_finalize"') &&
    routesTs.match(/board_pack_finalize[^}]+severity: "critical"/s),
  "board_pack_finalize has severity critical"
);
assert(
  routesTs.includes('action: "board_pack_archive"') &&
    routesTs.match(/board_pack_archive[^}]+severity: "critical"/s),
  "board_pack_archive has severity critical"
);

// ── 5. Capital portal routes ──────────────────────────────────────────────────
console.log("\n5. Capital portal backend audit calls");

assert(
  capitalTs.includes('action: "investor_portal_access_create"'),
  "investor_portal_access_create audit call present"
);
assert(
  capitalTs.includes('action: "investor_portal_token_revoke"'),
  "investor_portal_token_revoke audit call present"
);
assert(
  capitalTs.includes('action: "investor_portal_access_delete"'),
  "investor_portal_access_delete audit call present"
);
assert(
  capitalTs.includes('action: "investor_portal_token_regenerate"'),
  "investor_portal_token_regenerate audit call present"
);

// Check fire-and-forget pattern
const capitalVoidCalls = (capitalTs.match(/void recordHighRiskAction\(/g) || []).length;
assert(capitalVoidCalls >= 4, `routes-capital.ts has ${capitalVoidCalls} fire-and-forget audit calls (expect ≥4)`);

// Check severity
assert(
  capitalTs.match(/investor_portal_token_revoke[^}]+severity: "critical"/s),
  "investor_portal_token_revoke has severity critical"
);
assert(
  capitalTs.match(/investor_portal_token_regenerate[^}]+severity: "critical"/s),
  "investor_portal_token_regenerate has severity critical"
);

// ── 6. Admin user routes ──────────────────────────────────────────────────────
console.log("\n6. Admin user backend audit calls");

assert(
  routesTs.includes('action: "user_permissions_change"'),
  "user_permissions_change audit call present"
);
assert(
  routesTs.includes('action: "user_suspend"'),
  "user_suspend audit call present"
);
assert(
  routesTs.includes('action: "user_delete"'),
  "user_delete audit call present"
);
assert(
  routesTs.includes('category: "permission_change"'),
  'permissions change uses category "permission_change"'
);
assert(
  routesTs.includes('category: "user_management"'),
  'suspend/delete use category "user_management"'
);

// Check severity
assert(
  routesTs.match(/user_permissions_change[^}]+severity: "critical"/s),
  "user_permissions_change has severity critical"
);
assert(
  routesTs.match(/user_delete[^}]+severity: "critical"/s),
  "user_delete has severity critical"
);
assert(
  routesTs.match(/user_suspend[^}]+severity: "critical"/s),
  "user_suspend has severity critical"
);

// ── 7. Currents channel routes ────────────────────────────────────────────────
console.log("\n7. Currents channel backend audit calls");

assert(
  routesTs.includes('action: "currents_channel_archive"'),
  "currents_channel_archive audit call present"
);
assert(
  routesTs.includes('action: "currents_member_add"'),
  "currents_member_add audit call present"
);
assert(
  routesTs.includes('action: "currents_member_remove"'),
  "currents_member_remove audit call present"
);
assert(
  routesTs.includes('category: "currents_membership"'),
  'currents actions use category "currents_membership"'
);

// Check metadata
assert(
  routesTs.includes("added_user_id: targetUserId"),
  "currents_member_add includes added_user_id in metadata"
);
assert(
  routesTs.includes("removed_user_id: targetUserId"),
  "currents_member_remove includes removed_user_id in metadata"
);

// ── 8. Gmail disconnect routes ────────────────────────────────────────────────
console.log("\n8. Gmail disconnect backend audit calls");

assert(
  routesTs.includes('action: "gmail_account_disconnect"'),
  "gmail_account_disconnect audit call present"
);
assert(
  routesTs.includes('action: "gmail_disconnect"'),
  "gmail_disconnect audit call present"
);
assert(
  routesTs.includes('category: "integration_change"'),
  'gmail disconnect uses category "integration_change"'
);

// Check both disconnect variants are audited
const gmailDisconnectCount = (routesTs.match(/action: "gmail_(?:account_)?disconnect"/g) || []).length;
assert(gmailDisconnectCount >= 2, `both gmail disconnect routes audited (found ${gmailDisconnectCount})`);

// ── 9. Fire-and-forget pattern in routes.ts ───────────────────────────────────
console.log("\n9. Fire-and-forget pattern (routes.ts)");

const routesVoidCalls = (routesTs.match(/void recordHighRiskAction\(/g) || []).length;
assert(routesVoidCalls >= 12, `routes.ts has ${routesVoidCalls} fire-and-forget audit calls (expect ≥12)`);

// No awaited calls (no blocking the request)
const routesAwaitCalls = (routesTs.match(/await recordHighRiskAction\(/g) || []).length;
assert(routesAwaitCalls === 0, `routes.ts has no blocking await recordHighRiskAction calls (found ${routesAwaitCalls})`);

const capitalAwaitCalls = (capitalTs.match(/await recordHighRiskAction\(/g) || []).length;
assert(capitalAwaitCalls === 0, `routes-capital.ts has no blocking await recordHighRiskAction calls (found ${capitalAwaitCalls})`);

// ── 10. Frontend ConfirmHighRiskAction — board-pack.tsx ───────────────────────
console.log("\n10. Frontend confirmation guard — board-pack.tsx");

assert(
  boardPackTsx.includes('from "@/components/security/confirm-high-risk-action"'),
  "board-pack.tsx imports ConfirmHighRiskAction"
);
assert(
  boardPackTsx.includes("confirmFinalize") && boardPackTsx.includes("setConfirmFinalize"),
  "board-pack.tsx has confirmFinalize state"
);
assert(
  boardPackTsx.includes("confirmArchive") && boardPackTsx.includes("setConfirmArchive"),
  "board-pack.tsx has confirmArchive state"
);
assert(
  boardPackTsx.includes("setConfirmFinalize(true)"),
  "finalize button opens confirmation dialog (setConfirmFinalize)"
);
assert(
  boardPackTsx.includes("setConfirmArchive(true)"),
  "archive button opens confirmation dialog (setConfirmArchive)"
);
assert(
  boardPackTsx.includes('title="Finalize this Board Pack?"'),
  "board-pack.tsx has ConfirmHighRiskAction for finalize"
);
assert(
  boardPackTsx.includes('title="Archive this Board Pack?"'),
  "board-pack.tsx has ConfirmHighRiskAction for archive"
);
assert(
  (boardPackTsx.match(/<ConfirmHighRiskAction/g) || []).length >= 2,
  "board-pack.tsx has ≥2 ConfirmHighRiskAction dialogs"
);

// ── 11. Frontend ConfirmHighRiskAction — capital-investors.tsx ────────────────
console.log("\n11. Frontend confirmation guard — capital-investors.tsx");

assert(
  capitalInvestorsTsx.includes('from "@/components/security/confirm-high-risk-action"'),
  "capital-investors.tsx imports ConfirmHighRiskAction"
);
assert(
  capitalInvestorsTsx.includes("confirmRevokeId") && capitalInvestorsTsx.includes("setConfirmRevokeId"),
  "capital-investors.tsx has confirmRevokeId state"
);
assert(
  capitalInvestorsTsx.includes("confirmDeleteId") && capitalInvestorsTsx.includes("setConfirmDeleteId"),
  "capital-investors.tsx has confirmDeleteId state"
);
assert(
  capitalInvestorsTsx.includes("confirmRegenId") && capitalInvestorsTsx.includes("setConfirmRegenId"),
  "capital-investors.tsx has confirmRegenId state"
);
assert(
  capitalInvestorsTsx.includes("setConfirmRevokeId(p.id)"),
  "revoke button opens confirmation dialog"
);
assert(
  capitalInvestorsTsx.includes("setConfirmDeleteId(p.id)"),
  "delete button opens confirmation dialog"
);
assert(
  capitalInvestorsTsx.includes("setConfirmRegenId(p.id)"),
  "regen button opens confirmation dialog"
);
assert(
  capitalInvestorsTsx.includes('title="Revoke Portal Access?"'),
  "revoke confirmation dialog has correct title"
);
assert(
  capitalInvestorsTsx.includes('title="Delete Portal Link?"'),
  "delete confirmation dialog has correct title"
);
assert(
  capitalInvestorsTsx.includes('title="Regenerate Portal Token?"'),
  "regen confirmation dialog has correct title"
);
assert(
  capitalInvestorsTsx.includes('confirmationText="DELETE"'),
  "delete portal confirmation requires typing DELETE"
);
assert(
  (capitalInvestorsTsx.match(/<ConfirmHighRiskAction/g) || []).length >= 3,
  "capital-investors.tsx has ≥3 ConfirmHighRiskAction dialogs"
);

// ── 12. Frontend ConfirmHighRiskAction — admin-users.tsx ─────────────────────
console.log("\n12. Frontend confirmation guard — admin-users.tsx");

assert(
  adminUsersTsx.includes('from "@/components/security/confirm-high-risk-action"'),
  "admin-users.tsx imports ConfirmHighRiskAction"
);
assert(
  adminUsersTsx.includes("<ConfirmHighRiskAction"),
  "admin-users.tsx uses ConfirmHighRiskAction"
);
assert(
  adminUsersTsx.includes('confirmationText="DELETE"'),
  "admin delete user requires typing DELETE to confirm"
);
assert(
  adminUsersTsx.includes("irreversible"),
  "admin delete user dialog is marked irreversible"
);
assert(
  adminUsersTsx.includes('confirmButtonLabel="Delete Permanently"'),
  "admin delete has correct confirm button label"
);
assert(
  adminUsersTsx.includes('"DELETE"') && adminUsersTsx.includes("ConfirmHighRiskAction"),
  "admin delete uses ConfirmHighRiskAction with DELETE confirmation text"
);

// ── 13. Audit severity coverage ───────────────────────────────────────────────
console.log("\n13. Audit severity coverage");

const criticalCount = (
  (routesTs.match(/severity: "critical"/g) || []).length +
  (capitalTs.match(/severity: "critical"/g) || []).length
);
assert(criticalCount >= 10, `≥10 critical-severity audit calls across routes (found ${criticalCount})`);

// ── 14. Audit metadata presence ──────────────────────────────────────────────
console.log("\n14. Audit metadata presence on key actions");

assert(
  capitalTs.includes("investor_id: invId") && capitalTs.includes("portal_access_id: portal.id"),
  "portal access create includes investor_id + portal_access_id metadata"
);
assert(
  routesTs.includes("target_role: target.globalRole"),
  "user_delete includes target_role in metadata"
);

// ── 15. No accidental blocking of the event loop ─────────────────────────────
console.log("\n15. Non-blocking fire-and-forget audit pattern");

// All void recordHighRiskAction calls must not be inside try blocks in a way
// that could block the response — we check the pattern "void record" appears
// before "res.json" in the same handler block.
const voidBeforeResPattern = /void recordHighRiskAction\([^;]+\);\s*res\.(json|status)/g;
const voidBeforeResInRoutes = (routesTs.match(voidBeforeResPattern) || []).length;
const voidBeforeResInCapital = (capitalTs.match(voidBeforeResPattern) || []).length;
assert(
  voidBeforeResInRoutes >= 8,
  `routes.ts: ≥8 void audit calls appear before res.json (found ${voidBeforeResInRoutes})`
);
assert(
  voidBeforeResInCapital >= 2,
  `routes-capital.ts: ≥2 void audit calls appear before res.json (found ${voidBeforeResInCapital})`
);

// ── 16. ConfirmHighRiskAction component integrity ────────────────────────────
console.log("\n16. ConfirmHighRiskAction component integrity");

const confirmComponentTsx = readFile("client/src/components/security/confirm-high-risk-action.tsx");

assert(
  confirmComponentTsx.includes("export function ConfirmHighRiskAction"),
  "ConfirmHighRiskAction is exported"
);
assert(
  confirmComponentTsx.includes("confirmationText"),
  "ConfirmHighRiskAction supports confirmationText prop"
);
assert(
  confirmComponentTsx.includes("irreversible"),
  "ConfirmHighRiskAction supports irreversible prop"
);
assert(
  confirmComponentTsx.includes("warningCopy"),
  "ConfirmHighRiskAction supports warningCopy prop"
);
assert(
  confirmComponentTsx.includes('data-testid="confirm-high-risk-dialog"'),
  "ConfirmHighRiskAction has data-testid on dialog"
);
assert(
  confirmComponentTsx.includes('data-testid="confirm-action-button"'),
  "ConfirmHighRiskAction has data-testid on confirm button"
);
assert(
  confirmComponentTsx.includes('data-testid="confirm-cancel-button"'),
  "ConfirmHighRiskAction has data-testid on cancel button"
);

// ── 17. Migration exists for security_audit_events ───────────────────────────
console.log("\n17. Security audit DB migration");

const migrationSql = readFile("migrations/0025_security_audit_events.sql");
assert(
  migrationSql.includes("CREATE TABLE") && migrationSql.includes("security_audit_events"),
  "migration 0025 creates security_audit_events table"
);
assert(
  migrationSql.includes("actor_user_id") && migrationSql.includes("action") && migrationSql.includes("severity"),
  "security_audit_events has actor_user_id, action, severity columns"
);

// ── 18. BLOCKED_METADATA_KEYS strips sensitive fields ────────────────────────
console.log("\n18. Metadata sanitization safety");

assert(
  securityAuditTs.includes("BLOCKED_METADATA_KEYS"),
  "security-audit.ts has BLOCKED_METADATA_KEYS set"
);
assert(
  securityAuditTs.includes('"password"') || securityAuditTs.includes("'password'"),
  "BLOCKED_METADATA_KEYS includes password"
);
assert(
  securityAuditTs.includes('"token"') || securityAuditTs.includes("'token'"),
  "BLOCKED_METADATA_KEYS includes token"
);
assert(
  securityAuditTs.includes('"access_token"') || securityAuditTs.includes("'access_token'"),
  "BLOCKED_METADATA_KEYS includes access_token"
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Phase 17 — High-Risk Action Application`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log("\nFailed checks:");
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
} else {
  console.log("All checks passed ✓");
  process.exit(0);
}
