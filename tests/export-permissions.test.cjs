#!/usr/bin/env node
/**
 * Export / Download Permission Enforcement — Source-Grep Tests
 *
 * Validates that every export and download route has the correct middleware
 * and that the auth helpers are implemented as expected.
 *
 * Run: node tests/export-permissions.test.cjs
 * (No live server needed — pure source code inspection)
 */

"use strict";

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

function readFile(relPath) {
  return fs.readFileSync(path.join(__dirname, "..", relPath), "utf8");
}

console.log("=== Export / Download Permission Enforcement — Source-Grep Tests ===\n");

// ──────────────────────────────────────────────────────────────────────────────
// Section 1: server/auth.ts — new helpers exist and are exported
// ──────────────────────────────────────────────────────────────────────────────
console.log("── Section 1: auth.ts — helpers ───────────────────────────────────────────");
const auth = readFile("server/auth.ts");

assert("authorizeResourceAction exported", auth.includes("export async function authorizeResourceAction"));
assert("requireExportPermission exported", auth.includes("export function requireExportPermission"));
assert("requireDownloadPermission exported", auth.includes("export function requireDownloadPermission"));
assert("requireGenerateReportPermission exported", auth.includes("export function requireGenerateReportPermission"));
assert("logExportAudit exported", auth.includes("export async function logExportAudit"));
assert("can_export flag checked", auth.includes('"can_export"'));
assert("can_download_attachment flag checked", auth.includes('"can_download_attachment"'));
assert("can_generate_report flag checked", auth.includes('"can_generate_report"'));
assert("admin bypass: master_admin always passes", auth.includes('globalRole === "master_admin"'));
assert("admin bypass: admin always passes", auth.includes('globalRole === "admin"'));
assert("explicit false denial: flagValue === false", auth.includes("flagValue === false"));
assert("403 EXPORT_FORBIDDEN code returned", auth.includes('"EXPORT_FORBIDDEN"'));
assert("403 DOWNLOAD_FORBIDDEN code returned", auth.includes('"DOWNLOAD_FORBIDDEN"'));
assert("audit log insert into export_audit_log", auth.includes("INSERT INTO export_audit_log"));
assert("audit log is fire-and-forget (non-blocking)", auth.includes("void logExportAudit"));
assert("sql imported from drizzle-orm for audit log", auth.includes("sql } from \"drizzle-orm\"") || auth.includes("sql, } from \"drizzle-orm\"") || auth.includes("{ eq, sql }"));

// ──────────────────────────────────────────────────────────────────────────────
// Section 2: routes.ts import — new helpers imported
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n── Section 2: routes.ts — import ──────────────────────────────────────────");
const routes = readFile("server/routes.ts");

assert("requireExportPermission imported in routes.ts", routes.includes("requireExportPermission"));
assert("requireDownloadPermission imported in routes.ts", routes.includes("requireDownloadPermission"));
assert("logExportAudit imported in routes.ts", routes.includes("logExportAudit"));
assert("authorizeResourceAction imported in routes.ts", routes.includes("authorizeResourceAction"));

// ──────────────────────────────────────────────────────────────────────────────
// Section 3: CRM export routes gated
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n── Section 3: CRM export routes ───────────────────────────────────────────");

assert("/api/marinas/export has requireExportPermission",
  routes.includes('"/api/marinas/export"') && routes.match(/\/api\/marinas\/export.*requireExportPermission/s));
assert("/api/leads/export has requireExportPermission",
  routes.includes('"/api/leads/export"') && routes.match(/\/api\/leads\/export.*requireExportPermission/s));
assert("/api/accounts/export has requireExportPermission",
  routes.includes('"/api/accounts/export"') && routes.match(/\/api\/accounts\/export.*requireExportPermission/s));
assert("/api/contacts/export has requireExportPermission",
  routes.includes('"/api/contacts/export"') && routes.match(/\/api\/contacts\/export.*requireExportPermission/s));
assert("/api/opportunities/export has requireExportPermission",
  routes.includes('"/api/opportunities/export"') && routes.match(/\/api\/opportunities\/export.*requireExportPermission/s));
assert("/api/comm-lists/export has requireExportPermission",
  routes.includes('"/api/comm-lists/export"') && routes.match(/\/api\/comm-lists\/export.*requireExportPermission/s));
assert("/api/campaigns/export has requireExportPermission",
  routes.includes('"/api/campaigns/export"') && routes.match(/\/api\/campaigns\/export.*requireExportPermission/s));
assert("/api/marketing/drilldown/export has requireExportPermission",
  routes.includes('"/api/marketing/drilldown/export"') && routes.match(/\/api\/marketing\/drilldown\/export.*requireExportPermission/s));

// ──────────────────────────────────────────────────────────────────────────────
// Section 4: Support / quoting / analytics export routes gated
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n── Section 4: Other module export routes ───────────────────────────────────");

assert("/api/tickets/export has requireExportPermission",
  routes.includes('"/api/tickets/export"') && routes.match(/\/api\/tickets\/export.*requireExportPermission/s));
assert("/api/quotes/export has requireExportPermission",
  routes.includes('"/api/quotes/export"') && routes.match(/\/api\/quotes\/export.*requireExportPermission/s));
assert("/api/analytics/source-attribution/export has requireExportPermission",
  routes.includes('"/api/analytics/source-attribution/export"') && routes.match(/\/api\/analytics\/source-attribution\/export.*requireExportPermission/s));

// ──────────────────────────────────────────────────────────────────────────────
// Section 5: Activities and tasks — in-body export check
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n── Section 5: Activities & tasks in-body export check ──────────────────────");

assert("/api/activities/export has authorizeResourceAction in-body check",
  routes.includes('"/api/activities/export"') && routes.includes("Not authorized to export activities")
  && routes.match(/Not authorized to export activities[\s\S]{0,500}authorizeResourceAction[\s\S]{0,200}action.*export/));
assert("/api/activities/export logs export audit on success",
  routes.match(/Not authorized to export activities[\s\S]{0,800}logExportAudit[\s\S]{0,100}allowed/));
assert("/api/tasks/export has authorizeResourceAction in-body check",
  routes.includes('"/api/tasks/export"') && routes.includes("Export permission check"));
assert("/api/tasks/export audit on success",
  routes.match(/Export permission check[\s\S]{0,500}logExportAudit[\s\S]{0,100}allowed/));

// ──────────────────────────────────────────────────────────────────────────────
// Section 6: Download routes gated
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n── Section 6: Download routes ──────────────────────────────────────────────");

assert("/api/quotes/:id/download/xlsx has requireDownloadPermission",
  routes.includes('"/api/quotes/:id/download/xlsx"') && routes.match(/\/api\/quotes\/:id\/download\/xlsx.*requireDownloadPermission/s));
assert("/api/assets/:id/download has requireDownloadPermission",
  routes.includes('"/api/assets/:id/download"') && routes.match(/\/api\/assets\/:id\/download.*requireDownloadPermission/s));
assert("/api/projects/:id/attachments/:aid/download has requireDownloadPermission",
  routes.includes('"/api/projects/:id/attachments/:aid/download"') && routes.match(/\/api\/projects\/:id\/attachments\/:aid\/download.*requireDownloadPermission/s));
assert("/api/gmail/attachments/:id/download has download permission check",
  routes.includes("Download-attachment permission check") && routes.match(/Download-attachment permission check[\s\S]{0,500}download_attachment/));
assert("/api/attachments/file/:fileName has download permission check",
  routes.includes("Download-attachment permission check (additive to section-view ACL above)"));

// ──────────────────────────────────────────────────────────────────────────────
// Section 7: Migration file
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n── Section 7: Migration file ───────────────────────────────────────────────");
const migration = readFile("migrations/0037_export_permissions.sql");

assert("export_audit_log table created", migration.includes("CREATE TABLE IF NOT EXISTS export_audit_log"));
assert("user_id column in audit log", migration.includes("user_id"));
assert("action column in audit log", migration.includes("action"));
assert("outcome column in audit log", migration.includes("outcome"));
assert("denial_reason column in audit log", migration.includes("denial_reason"));
assert("can_export backfilled for staff roles", migration.includes('"can_export":true'));
assert("can_export set false for restricted roles", migration.includes('"can_export":false'));
assert("can_download_attachment backfilled", migration.includes('"can_download_attachment"'));
assert("advisor role restricted", migration.includes("'advisor'"));
assert("read_only role restricted", migration.includes("'read_only'"));
assert("COALESCE used for NULL-safe merge", migration.includes("COALESCE(permissions"));
assert("index on user_id", migration.includes("export_audit_log_user_id_idx"));
assert("index on created_at", migration.includes("export_audit_log_created_at_idx"));

// ──────────────────────────────────────────────────────────────────────────────
// Section 8: Frontend — ExportButton component
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n── Section 8: Frontend — ExportButton ──────────────────────────────────────");
const exportBtn = readFile("client/src/components/ui/export-button.tsx");

assert("ExportButton accepts canExport prop", exportBtn.includes("canExport"));
assert("canExport=false renders blocked state", exportBtn.includes("blocked"));
assert("403 status triggers toast error", exportBtn.includes("res.status === 403"));
assert("toast on 403", exportBtn.includes("useToast"));
assert("EXPORT_FORBIDDEN message shown to user", exportBtn.includes("view-only access") || exportBtn.includes("Export not permitted"));
assert("Lock icon shown when blocked", exportBtn.includes("Lock"));
assert("button disabled when blocked", exportBtn.includes("blocked"));

// ──────────────────────────────────────────────────────────────────────────────
// Section 9: Frontend — useExportPermissions hook
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n── Section 9: Frontend — useExportPermissions hook ─────────────────────────");
const hook = readFile("client/src/hooks/use-export-permissions.ts");

assert("hook reads from /api/session/bootstrap", hook.includes("/api/session/bootstrap"));
assert("hook derives canExport", hook.includes("canExport"));
assert("hook derives canDownload", hook.includes("canDownload"));
assert("hook derives canGenerateReport", hook.includes("canGenerateReport"));
assert("admin roles always get true", hook.includes("isAdmin"));
assert("master_admin bypass", hook.includes('"master_admin"'));
assert("admin bypass", hook.includes('"admin"'));
assert("missing flag defaults to true (legacy compat)", hook.includes("!== false"));
assert("returns isAdmin", hook.includes("return { canExport"));

// ──────────────────────────────────────────────────────────────────────────────
// Section 10: Frontend — admin-users UserPermissions type
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n── Section 10: Frontend — admin-users.tsx permissions type ─────────────────");
const adminUsers = readFile("client/src/pages/admin-users.tsx");

assert("can_export in UserPermissions type", adminUsers.includes("can_export?:"));
assert("can_download_attachment in UserPermissions type", adminUsers.includes("can_download_attachment?:"));
assert("can_generate_report in UserPermissions type", adminUsers.includes("can_generate_report?:"));
assert("DEFAULT_PERMISSIONS includes can_export:true", adminUsers.includes("can_export: true"));
assert("DEFAULT_PERMISSIONS includes can_download_attachment:true", adminUsers.includes("can_download_attachment: true"));
assert("AccessTab renders export/download toggles", adminUsers.includes("can_export") && adminUsers.includes("can_download_attachment"));

// ──────────────────────────────────────────────────────────────────────────────
console.log("\n───────────────────────────────────────────────────────────────────────────");
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log("───────────────────────────────────────────────────────────────────────────");
if (failed > 0) process.exit(1);
