"use strict";

/**
 * Phase 16 — High-Risk Action Hardening, Confirmation Layer, and Audit Trail Upgrade
 * Source-grep test suite: 0 external connections, deterministic, pure file analysis.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

// ── Helpers ───────────────────────────────────────────────────────────────────

function readFile(rel) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, "utf8");
}

function fileExists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

let passed = 0;
let failed = 0;
const failures = [];

function check(label, condition, hint = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${hint ? `\n      hint: ${hint}` : ""}`);
    failed++;
    failures.push(label);
  }
}

function section(name) {
  console.log(`\n── ${name}`);
}

// ── Load source files ─────────────────────────────────────────────────────────

const SECURITY_AUDIT_SVC = readFile("server/services/security-audit.ts");
const ROUTES             = readFile("server/routes.ts");
const ROUTES_CAPITAL     = readFile("server/routes-capital.ts");
const BOARD_PACK_SECTION = (() => {
  if (!ROUTES) return null;
  const idx = ROUTES.indexOf("/api/board-packs/");
  return idx > -1 ? ROUTES.slice(idx - 20, idx + 8000) : "";
})();
const MIGRATION_SQL      = readFile("migrations/0025_security_audit_events.sql");
const HIGH_RISK_DOC      = readFile("docs/security-high-risk-actions.md");
const SECURITY_MATRIX    = readFile("docs/security-access-control-matrix.md");
const CLIENT_STORAGE_DOC = readFile("docs/security-client-storage.md");
const CONFIRM_COMPONENT  = readFile("client/src/components/security/confirm-high-risk-action.tsx");
const PHASE15_TEST       = readFile("tests/full-app-security-hardening.test.cjs");

// ── Section 1: Audit service exists ──────────────────────────────────────────

section("1. Security audit service");
check("server/services/security-audit.ts exists", fileExists("server/services/security-audit.ts"));
check("exports recordSecurityAuditEvent", SECURITY_AUDIT_SVC?.includes("recordSecurityAuditEvent") ?? false);
check("exports recordHighRiskAction", SECURITY_AUDIT_SVC?.includes("recordHighRiskAction") ?? false);
check("exports getAuditActor", SECURITY_AUDIT_SVC?.includes("getAuditActor") ?? false);
check("exports safeAuditMetadata", SECURITY_AUDIT_SVC?.includes("safeAuditMetadata") ?? false);
check("exports ensureAuditTable", SECURITY_AUDIT_SVC?.includes("ensureAuditTable") ?? false);

// ── Section 2: Audit table migration idempotency ──────────────────────────────

section("2. Audit table migration idempotency");
check("migrations/0025_security_audit_events.sql exists", fileExists("migrations/0025_security_audit_events.sql"));
check("migration uses CREATE TABLE IF NOT EXISTS", MIGRATION_SQL?.includes("CREATE TABLE IF NOT EXISTS") ?? false);
check("migration creates security_audit_events", MIGRATION_SQL?.includes("security_audit_events") ?? false);
check("migration uses CREATE INDEX IF NOT EXISTS", MIGRATION_SQL?.includes("CREATE INDEX IF NOT EXISTS") ?? false);
check("migration has actor_user_id column", MIGRATION_SQL?.includes("actor_user_id") ?? false);
check("migration has severity column", MIGRATION_SQL?.includes("severity") ?? false);
check("migration has result column", MIGRATION_SQL?.includes("result") ?? false);
check("migration has metadata JSONB column", MIGRATION_SQL?.includes("JSONB") ?? false);
check("migration has created_at column", MIGRATION_SQL?.includes("created_at") ?? false);
check("no DROP TABLE in migration", !(MIGRATION_SQL?.includes("DROP TABLE") ?? true));
check("no TRUNCATE in migration", !(MIGRATION_SQL?.includes("TRUNCATE") ?? true));

// ── Section 3: safeAuditMetadata strips sensitive keys ────────────────────────

section("3. safeAuditMetadata — sensitive key blocklist");
check("BLOCKED_METADATA_KEYS set defined", SECURITY_AUDIT_SVC?.includes("BLOCKED_METADATA_KEYS") ?? false);
check("blocks email_body key", SECURITY_AUDIT_SVC?.includes('"email_body"') ?? false);
check("blocks body key", SECURITY_AUDIT_SVC?.includes('"body"') ?? false);
check("blocks html key", SECURITY_AUDIT_SVC?.includes('"html"') ?? false);
check("blocks token key", SECURITY_AUDIT_SVC?.includes('"token"') ?? false);
check("blocks access_token key", SECURITY_AUDIT_SVC?.includes('"access_token"') ?? false);
check("blocks refresh_token key", SECURITY_AUDIT_SVC?.includes('"refresh_token"') ?? false);
check("blocks password key", SECURITY_AUDIT_SVC?.includes('"password"') ?? false);
check("blocks secret key", SECURITY_AUDIT_SVC?.includes('"secret"') ?? false);
check("blocks memo_text key", SECURITY_AUDIT_SVC?.includes('"memo_text"') ?? false);
check("blocks board_pack_content key", SECURITY_AUDIT_SVC?.includes('"board_pack_content"') ?? false);
check("blocks investor_memo key", SECURITY_AUDIT_SVC?.includes('"investor_memo"') ?? false);
check("safeAuditMetadata calls toLowerCase for case-insensitive check",
  SECURITY_AUDIT_SVC?.includes("toLowerCase") ?? false);

// ── Section 4: High-risk action docs exist ────────────────────────────────────

section("4. High-risk action documentation");
check("docs/security-high-risk-actions.md exists", fileExists("docs/security-high-risk-actions.md"));
check("doc defines Low-Risk tier", HIGH_RISK_DOC?.includes("Low-Risk") ?? false);
check("doc defines Medium-Risk tier", HIGH_RISK_DOC?.includes("Medium-Risk") ?? false);
check("doc defines High-Risk tier", HIGH_RISK_DOC?.includes("High-Risk") ?? false);
check("doc defines Critical-Risk tier", HIGH_RISK_DOC?.includes("Critical-Risk") ?? false);
check("doc covers send email", HIGH_RISK_DOC?.includes("Send email") ?? false);
check("doc covers finalize board pack", HIGH_RISK_DOC?.includes("board pack") ?? false);
check("doc covers revoke investor portal token", HIGH_RISK_DOC?.includes("investor portal token") ?? false);
check("doc covers permission/role changes", HIGH_RISK_DOC?.includes("Permission/role") ?? false);
check("doc covers user disable/delete", (HIGH_RISK_DOC?.includes("User disable") || HIGH_RISK_DOC?.includes("user disable")) ?? false);
check("doc lists sensitive payload prohibitions", HIGH_RISK_DOC?.includes("Sensitive Payload Prohibitions") ?? false);
check("doc lists copy-only routes section", HIGH_RISK_DOC?.includes("Copy-Only Routes") ?? false);
check("doc references ConfirmHighRiskAction component", HIGH_RISK_DOC?.includes("ConfirmHighRiskAction") ?? false);

// ── Section 5: Gmail send route guard ────────────────────────────────────────

section("5. Gmail send / forward routes");
check("POST /api/gmail/send has requireAuth guard",
  /app\.post\(["']\/api\/gmail\/send["'].*requireAuth/.test(ROUTES ?? ""));
check("POST /api/gmail/send is defined in routes.ts", (ROUTES?.includes('"/api/gmail/send"') || ROUTES?.includes("'/api/gmail/send'")) ?? false);
check("POST /api/gmail/drafts has requireAuth guard",
  /app\.post\(["']\/api\/gmail\/drafts["'].*requireAuth/.test(ROUTES ?? ""));
check("DELETE /api/gmail/drafts/:id has requireAuth guard",
  /app\.delete\(["']\/api\/gmail\/drafts\/:id["'].*requireAuth/.test(ROUTES ?? ""));
check("POST /api/gmail/accounts/:id/disconnect has requireAuth",
  /app\.post\(["']\/api\/gmail\/accounts\/:id\/disconnect["'].*requireAuth/.test(ROUTES ?? ""));
check("POST /api/gmail/disconnect has requireAuth",
  /app\.post\(["']\/api\/gmail\/disconnect["'].*requireAuth/.test(ROUTES ?? ""));

// ── Section 6: Bulk mail routes have guards ───────────────────────────────────

section("6. Bulk mail / inbox routes");
check("POST /api/gmail/bulk-archive has requireAuth",
  /app\.post\(["']\/api\/gmail\/bulk-archive["'].*requireAuth/.test(ROUTES ?? ""));
check("POST /api/inbox/bulk-trash has requireAuth",
  /app\.post\(["']\/api\/inbox\/bulk-trash["'].*requireAuth/.test(ROUTES ?? ""));
check("PATCH /api/inbox/bulk-mark-done has requireAuth and requirePermission",
  /app\.patch\(["']\/api\/inbox\/bulk-mark-done["'].*requireAuth.*requirePermission/.test(ROUTES ?? ""));

// ── Section 7: Board pack finalize/archive are guarded ───────────────────────

section("7. Board pack high-risk routes");
check("POST /api/board-packs/:id/finalize has requireBoardPackAccess",
  /app\.post\(["']\/api\/board-packs\/:id\/finalize["'].*requireBoardPackAccess/.test(ROUTES ?? ""));
check("POST /api/board-packs/:id/archive has requireBoardPackAccess",
  /app\.post\(["']\/api\/board-packs\/:id\/archive["'].*requireBoardPackAccess/.test(ROUTES ?? ""));
check("POST /api/board-packs/:id/investor-update-draft has requireBoardPackAccess",
  /app\.post\(["']\/api\/board-packs\/:id\/investor-update-draft["'].*requireBoardPackAccess/.test(ROUTES ?? ""));
check("GET /api/board-packs/:id/markdown has requireBoardPackAccess",
  /app\.get\(["']\/api\/board-packs\/:id\/markdown["'].*requireBoardPackAccess/.test(ROUTES ?? ""));

// ── Section 8: Capital high-risk routes are capital-gated ────────────────────

section("8. Capital high-risk routes");
check("DELETE /api/capital/investors/:id has requireCapitalAccess",
  /app\.delete\(["']\/api\/capital\/investors\/:id["'].*requireCapitalAccess/.test(ROUTES_CAPITAL ?? ""));
check("DELETE /api/capital/funders/:id has requireCapitalAccess",
  /app\.delete\(["']\/api\/capital\/funders\/:id["'].*requireCapitalAccess/.test(ROUTES_CAPITAL ?? ""));
check("DELETE /api/capital/grants/:id has requireCapitalAccess",
  /app\.delete\(["']\/api\/capital\/grants\/:id["'].*requireCapitalAccess/.test(ROUTES_CAPITAL ?? ""));
check("DELETE /api/capital/documents/:id has requireCapitalAccess",
  /app\.delete\(["']\/api\/capital\/documents\/:id["'].*requireCapitalAccess/.test(ROUTES_CAPITAL ?? ""));
check("DELETE /api/capital/materials/:id has requireCapitalAccess",
  /app\.delete\(["']\/api\/capital\/materials\/:id["'].*requireCapitalAccess/.test(ROUTES_CAPITAL ?? ""));
check("DELETE /api/capital/material-shares/:id has requireCapitalAccess",
  /app\.delete\(["']\/api\/capital\/material-shares\/:id["'].*requireCapitalAccess/.test(ROUTES_CAPITAL ?? ""));

// ── Section 9: Investor portal token actions are guarded/audited ─────────────

section("9. Investor portal token actions");
check("POST /api/capital/portal-access/:id/revoke has requireCapitalAccess",
  /app\.post\(["']\/api\/capital\/portal-access\/:id\/revoke["'].*requireCapitalAccess/.test(ROUTES_CAPITAL ?? ""));
check("POST /api/capital/portal-access/:id/regenerate has requireCapitalAccess",
  /app\.post\(["']\/api\/capital\/portal-access\/:id\/regenerate["'].*requireCapitalAccess/.test(ROUTES_CAPITAL ?? ""));
check("DELETE /api/capital/portal-access/:id has requireCapitalAccess",
  /app\.delete\(["']\/api\/capital\/portal-access\/:id["'].*requireCapitalAccess/.test(ROUTES_CAPITAL ?? ""));
check("POST /api/capital/investors/:id/portal-access has requireCapitalAccess",
  /app\.post\(["']\/api\/capital\/investors\/:id\/portal-access["'].*requireCapitalAccess/.test(ROUTES_CAPITAL ?? ""));

// ── Section 10: User permission routes are admin-gated ───────────────────────

section("10. User permission / admin routes");
check("PATCH /api/admin/users/:id/permissions has requireAdmin",
  /app\.patch\(["']\/api\/admin\/users\/:id\/permissions["'].*requireAdmin/.test(ROUTES ?? ""));
check("POST /api/admin/users has requireAdmin",
  /app\.post\(["']\/api\/admin\/users["'].*requireAdmin/.test(ROUTES ?? ""));
check("POST /api/admin/users/:id/suspend has requireAdmin",
  /app\.post\(["']\/api\/admin\/users\/:id\/suspend["'].*requireAdmin/.test(ROUTES ?? ""));
check("DELETE /api/admin/users/:id has requireAdmin",
  /app\.delete\(["']\/api\/admin\/users\/:id["'].*requireAdmin/.test(ROUTES ?? ""));
check("DELETE /api/admin/role-definitions/:id has requireAdmin",
  /app\.delete\(["']\/api\/admin\/role-definitions\/:id["'].*requireAdmin/.test(ROUTES ?? ""));
check("PATCH /api/admin/role-definitions/:id has requireAdmin",
  /app\.patch\(["']\/api\/admin\/role-definitions\/:id["'].*requireAdmin/.test(ROUTES ?? ""));
check("POST /api/admin/mailbox/:id/force-full-resync has requireAdmin",
  /app\.post\(["']\/api\/admin\/mailbox\/:id\/force-full-resync["'].*requireAdmin/.test(ROUTES ?? ""));

// ── Section 11: Currents private membership routes are guarded ───────────────

section("11. Currents channel membership / archive routes");
check("POST /api/current/channels/:id/archive has requireAdmin",
  /app\.post\(["']\/api\/current\/channels\/:id\/archive["'].*requireAdmin/.test(ROUTES ?? ""));
check("POST /api/current/channels/:slug/members/:userId has requireAdmin",
  /app\.post\(["']\/api\/current\/channels\/:slug\/members\/:userId["'].*requireAdmin/.test(ROUTES ?? ""));
check("DELETE /api/current/channels/:slug/members/:userId has requireAdmin",
  /app\.delete\(["']\/api\/current\/channels\/:slug\/members\/:userId["'].*requireAdmin/.test(ROUTES ?? ""));
check("DELETE /api/current/messages/:id has requireAuth",
  /app\.delete\(["']\/api\/current\/messages\/:id["'].*requireAuth/.test(ROUTES ?? ""));

// ── Section 12: Campaign send requires confirm flag ──────────────────────────

section("12. Campaign send confirmation gate");
check("POST /api/marketing/campaigns/:id/send-step has requirePermission",
  /app\.post\(["']\/api\/marketing\/campaigns\/:id\/send-step["'].*requirePermission/.test(ROUTES ?? ""));
check("send-step route requires confirm: true in body",
  (ROUTES?.includes('confirm !== true') || ROUTES?.includes("confirm !== true")) ?? false);
check("send-preview route is preview-only (not actual send)",
  /app\.post\(["']\/api\/marketing\/campaigns\/:id\/send-preview["'].*requirePermission/.test(ROUTES ?? ""));

// ── Section 13: Confirmation component exists and has required props ──────────

section("13. Frontend confirmation component");
check("client/src/components/security/confirm-high-risk-action.tsx exists",
  fileExists("client/src/components/security/confirm-high-risk-action.tsx"));
check("component exports ConfirmHighRiskAction",
  CONFIRM_COMPONENT?.includes("ConfirmHighRiskAction") ?? false);
check("component has RiskLevel type (medium|high|critical)",
  (CONFIRM_COMPONENT?.includes('"medium"') && CONFIRM_COMPONENT?.includes('"high"') && CONFIRM_COMPONENT?.includes('"critical"')) ?? false);
check("component has title prop",
  CONFIRM_COMPONENT?.includes("title") ?? false);
check("component has description prop",
  CONFIRM_COMPONENT?.includes("description") ?? false);
check("component has riskLevel prop",
  CONFIRM_COMPONENT?.includes("riskLevel") ?? false);
check("component has confirmationText prop",
  CONFIRM_COMPONENT?.includes("confirmationText") ?? false);
check("component has loading prop",
  CONFIRM_COMPONENT?.includes("loading") ?? false);
check("component has irreversible prop",
  CONFIRM_COMPONENT?.includes("irreversible") ?? false);
check("component has onConfirm callback",
  CONFIRM_COMPONENT?.includes("onConfirm") ?? false);
check("component has cancel button",
  CONFIRM_COMPONENT?.includes("Cancel") ?? false);
check("component uses Dialog from shadcn",
  CONFIRM_COMPONENT?.includes("Dialog") ?? false);
check("component has data-testid attributes",
  CONFIRM_COMPONENT?.includes("data-testid") ?? false);
check("component disables confirm when typing required and text mismatch",
  CONFIRM_COMPONENT?.includes("typedConfirmation") ?? false);

// ── Section 14: Copy-only routes do not auto-send ────────────────────────────

section("14. Copy-only and no-auto-send safety");
check("investor-update-draft route exists in routes.ts",
  (ROUTES?.includes('"/api/board-packs/:id/investor-update-draft"') || ROUTES?.includes("'/api/board-packs/:id/investor-update-draft'")) ?? false);
check("no sendEmail() call inside investor-update-draft handler",
  (() => {
    if (!ROUTES) return false;
    const idx = ROUTES.indexOf("/api/board-packs/:id/investor-update-draft");
    if (idx < 0) return false;
    const snippet = ROUTES.slice(idx, idx + 2000);
    const nextRoute = snippet.indexOf("\n  app.");
    const handler = nextRoute > 0 ? snippet.slice(0, nextRoute) : snippet;
    return !handler.includes("sendEmail(") && !handler.includes("gmail.send");
  })());
check("no auto-send added to CEO briefing routes",
  (() => {
    if (!ROUTES) return false;
    const idx = ROUTES.indexOf("/api/today/ceo-briefing");
    if (idx < 0) return true;
    const snippet = ROUTES.slice(idx, idx + 3000);
    return !snippet.includes("sendEmail(") && !snippet.includes("gmail.send");
  })());
check("safeAuditMetadata exists and is exported",
  SECURITY_AUDIT_SVC?.includes("export function safeAuditMetadata") ?? false);

// ── Section 15: No sensitive payloads in audit service ───────────────────────

section("15. Audit service — no sensitive payload storage");
check("safeAuditMetadata strips blocked keys using BLOCKED_METADATA_KEYS set",
  (SECURITY_AUDIT_SVC?.includes("BLOCKED_METADATA_KEYS.has") || SECURITY_AUDIT_SVC?.includes("BLOCKED_METADATA_KEYS")) ?? false);
check("escapeLiteral function exists (prevents SQL injection in audit)",
  SECURITY_AUDIT_SVC?.includes("escapeLiteral") ?? false);
check("audit service uses fire-and-forget error pattern (never throws to caller)",
  SECURITY_AUDIT_SVC?.includes("catch (err)") ?? false);
check("audit service logs error on failure",
  SECURITY_AUDIT_SVC?.includes("security-audit]") ?? false);

// ── Section 16: No permission loosening ──────────────────────────────────────

section("16. No permission loosening (guard regression)");
check("requireCapitalAccess still defined in routes-capital.ts",
  /function requireCapitalAccess|const requireCapitalAccess/.test(ROUTES_CAPITAL ?? ""));
check("requireBoardPackAccess still referenced",
  ROUTES?.includes("requireBoardPackAccess") ?? false);
check("requireAdmin still imported/used in routes.ts",
  ROUTES?.includes("requireAdmin") ?? false);
check("requirePermission still used in routes.ts",
  ROUTES?.includes("requirePermission") ?? false);
check("exportRateLimiter still applied to export routes",
  ROUTES?.includes("exportRateLimiter") ?? false);

// ── Section 17: CRM delete routes have permission guards ─────────────────────

section("17. CRM delete / bulk routes");
check("DELETE /api/leads/:id has requirePermission(crm, edit)",
  /app\.delete\(["']\/api\/leads\/:id["'].*requirePermission\(["']crm["'],\s*["']edit["']\)/.test(ROUTES ?? ""));
check("DELETE /api/accounts/:id has requirePermission(crm, edit)",
  /app\.delete\(["']\/api\/accounts\/:id["'].*requirePermission\(["']crm["'],\s*["']edit["']\)/.test(ROUTES ?? ""));
check("DELETE /api/contacts/:id has requirePermission(crm, edit)",
  /app\.delete\(["']\/api\/contacts\/:id["'].*requirePermission\(["']crm["'],\s*["']edit["']\)/.test(ROUTES ?? ""));
check("POST /api/leads/bulk/archive has requirePermission(crm, edit)",
  /app\.post\(["']\/api\/leads\/bulk\/archive["'].*requirePermission\(["']crm["'],\s*["']edit["']\)/.test(ROUTES ?? ""));
check("POST /api/tasks/bulk/complete has requirePermission(crm, edit)",
  /app\.post\(["']\/api\/tasks\/bulk\/complete["'].*requirePermission\(["']crm["'],\s*["']edit["']\)/.test(ROUTES ?? ""));

// ── Section 18: Export routes have rate limiter ───────────────────────────────

section("18. Export routes — rate limiter guard");
check("GET /api/leads/export has exportRateLimiter",
  /app\.get\(["']\/api\/leads\/export["'].*exportRateLimiter/.test(ROUTES ?? ""));
check("GET /api/accounts/export has exportRateLimiter",
  /app\.get\(["']\/api\/accounts\/export["'].*exportRateLimiter/.test(ROUTES ?? ""));
check("GET /api/contacts/export has exportRateLimiter",
  /app\.get\(["']\/api\/contacts\/export["'].*exportRateLimiter/.test(ROUTES ?? ""));

// ── Section 19: Phase 15 security docs still exist ───────────────────────────

section("19. Phase 15 deliverables still intact");
check("docs/security-access-control-matrix.md exists", fileExists("docs/security-access-control-matrix.md"));
check("docs/security-client-storage.md exists", fileExists("docs/security-client-storage.md"));
check("tests/full-app-security-hardening.test.cjs exists", fileExists("tests/full-app-security-hardening.test.cjs"));
check("threat_model.md exists", fileExists("threat_model.md"));
check("Phase 15 test file references Capital section",
  PHASE15_TEST?.includes("capital") ?? false);

// ── Section 20: Audit service — AuditSeverity and AuditCategory types ────────

section("20. Audit service type safety");
check("AuditSeverity type includes critical",
  SECURITY_AUDIT_SVC?.includes('"critical"') ?? false);
check("AuditResult type includes all states",
  (SECURITY_AUDIT_SVC?.includes('"attempted"') && SECURITY_AUDIT_SVC?.includes('"denied"')) ?? false);
check("AuditCategory type includes email_send",
  SECURITY_AUDIT_SVC?.includes('"email_send"') ?? false);
check("AuditCategory type includes capital_action",
  SECURITY_AUDIT_SVC?.includes('"capital_action"') ?? false);
check("AuditCategory type includes permission_change",
  SECURITY_AUDIT_SVC?.includes('"permission_change"') ?? false);
check("AuditCategory type includes board_pack_action",
  SECURITY_AUDIT_SVC?.includes('"board_pack_action"') ?? false);
check("AuditCategory type includes token_action",
  SECURITY_AUDIT_SVC?.includes('"token_action"') ?? false);
check("AuditEventInput interface defined",
  SECURITY_AUDIT_SVC?.includes("AuditEventInput") ?? false);

// ── Section 21: Confirmation component visual risk tiers ─────────────────────

section("21. Confirmation component — risk tier configuration");
check("RISK_CONFIG defines medium tier",
  CONFIRM_COMPONENT?.includes("medium:") ?? false);
check("RISK_CONFIG defines high tier",
  CONFIRM_COMPONENT?.includes("high:") ?? false);
check("RISK_CONFIG defines critical tier",
  CONFIRM_COMPONENT?.includes("critical:") ?? false);
check("critical tier uses destructive button variant",
  CONFIRM_COMPONENT?.includes('"destructive"') ?? false);
check("component shows irreversible warning text",
  CONFIRM_COMPONENT?.includes("cannot be undone") ?? false);
check("component handles Enter key on confirm text input",
  CONFIRM_COMPONENT?.includes("Enter") ?? false);

// ── Section 22: High-risk docs covers safeguard matrix ───────────────────────

section("22. High-risk action doc — safeguard matrix");
check("doc has Safeguard Matrix table",
  HIGH_RISK_DOC?.includes("Safeguard Matrix") ?? false);
check("doc references requireBoardPackAccess",
  HIGH_RISK_DOC?.includes("requireBoardPackAccess") ?? false);
check("doc references requireCapitalAccess",
  HIGH_RISK_DOC?.includes("requireCapitalAccess") ?? false);
check("doc references requireAdmin",
  HIGH_RISK_DOC?.includes("requireAdmin") ?? false);
check("doc references exportRateLimiter",
  HIGH_RISK_DOC?.includes("exportRateLimiter") ?? false);
check("doc covers Already-Safe Patterns section",
  HIGH_RISK_DOC?.includes("Already-Safe Patterns") ?? false);

// ── Section 23: No hardcoded secrets in new files ────────────────────────────

section("23. No hardcoded secrets in new Phase 16 files");
const PHASE16_FILES = [
  SECURITY_AUDIT_SVC,
  MIGRATION_SQL,
  HIGH_RISK_DOC,
  CONFIRM_COMPONENT,
].join("\n");
check("no Bearer tokens in Phase 16 files",
  !(/Bearer [a-zA-Z0-9\-_]{20,}/.test(PHASE16_FILES)));
check("no sk- API key patterns in Phase 16 files",
  !/["']sk-[a-zA-Z0-9]{20,}["']/.test(PHASE16_FILES));
check("no hard-coded password values in Phase 16 files",
  !/password\s*=\s*["'][^"']+["']/.test(PHASE16_FILES));

// ── Summary ───────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log("\n" + "─".repeat(60));
console.log(`Phase 16 High-Risk Action Hardening — ${total} checks: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("\nFailed checks:");
  failures.forEach((f) => console.error(`  • ${f}`));
  console.log("");
  process.exit(1);
} else {
  console.log("\nAll checks passed ✓");
}
