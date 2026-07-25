"use strict";
/**
 * Export & Download Permissions — Regression Tests
 *
 * Root cause: permissionsBodySchema in the PATCH /api/admin/users/:id/permissions
 * route was missing can_export / can_download_attachment / can_generate_report.
 * Zod strips unknown keys by default, so false values were silently dropped and
 * the DB update overwrote the entire permissions JSON without those flags.
 * On re-fetch, DEFAULT_PERMISSIONS applied true, making checkboxes snap back.
 *
 * These tests are source-grep style — they verify the production code structure
 * directly without needing a running server or DB.
 */

const fs = require("fs");
const path = require("path");

const ROUTES = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");
const ADMIN_USERS = fs.readFileSync(path.join(__dirname, "../client/src/pages/admin-users.tsx"), "utf8");
const AUTH = fs.readFileSync(path.join(__dirname, "../server/auth.ts"), "utf8");

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

console.log("=== Export & Download Permissions — Regression Tests ===\n");

// ── 1. Backend Zod schema includes all three flags ──────────────────────────
console.log("── 1. Backend permissionsBodySchema includes boolean export flags ──");

// Extract schema block first (used by multiple checks below)
const schemaBlockEarly = ROUTES.match(/const permissionsBodySchema\s*=\s*z\.object\(\{[\s\S]*?\}\);/)?.[0] ?? "";
check(
  "can_export: z.boolean().optional() in permissionsBodySchema",
  /can_export\s*:\s*z\.boolean\(\)\.optional\(\)/.test(schemaBlockEarly)
);
check(
  "can_download_attachment: z.boolean().optional() in permissionsBodySchema",
  /can_download_attachment\s*:\s*z\.boolean\(\)\.optional\(\)/.test(schemaBlockEarly)
);
check(
  "can_generate_report: z.boolean().optional() in permissionsBodySchema",
  /can_generate_report\s*:\s*z\.boolean\(\)\.optional\(\)/.test(schemaBlockEarly)
);

// ── 2. Schema block contains all three flags together (no split/missing) ────
console.log("\n── 2. All three flags present in the same schema object ──");

const schemaBlock = ROUTES.match(/const permissionsBodySchema\s*=\s*z\.object\(\{[\s\S]*?\}\);/)?.[0] ?? "";
check(
  "Schema block found",
  schemaBlock.length > 0
);
check(
  "can_export in schema block",
  schemaBlock.includes("can_export")
);
check(
  "can_download_attachment in schema block",
  schemaBlock.includes("can_download_attachment")
);
check(
  "can_generate_report in schema block",
  schemaBlock.includes("can_generate_report")
);
check(
  "All three flags use z.boolean()",
  (schemaBlock.match(/z\.boolean\(\)/g) ?? []).length >= 3
);
check(
  "All three flags marked optional()",
  (schemaBlock.match(/\.optional\(\)/g) ?? []).length >= 3 + 2 // 2 for mail_team sub-fields don't use optional
);

// ── 3. Backend does NOT incorrectly exempt based on acting user role ─────────
console.log("\n── 3. Acting-user vs target-user separation in PATCH route ──");

const patchBlock = ROUTES.match(/app\.patch\("\/api\/admin\/users\/:id\/permissions"[\s\S]*?\}\s*\}\s*\)\s*;/)?.[0] ?? "";
check(
  "PATCH /api/admin/users/:id/permissions route found",
  patchBlock.length > 0
);
// Exemption should NOT check actor role and then skip saving
check(
  "Route does not apply 'isAdmin' exemption to skip persisting flags",
  !patchBlock.includes("master_admin") || patchBlock.indexOf("master_admin") < patchBlock.indexOf("parsed.data")
);
check(
  "Route uses parsed.data (validated body) for DB update",
  patchBlock.includes("parsed.data")
);
check(
  "Route returns updated permissions",
  patchBlock.includes("returning") && patchBlock.includes("permissions")
);

// ── 4. Frontend isAdminUser check uses TARGET user's globalRole ──────────────
console.log("\n── 4. Frontend: isAdminUser checks target user, not acting user ──");

// The AccessTab component receives `user` (the target) as a prop
// isAdminUser must derive from user.globalRole (target), not from currentUser
const accessTabBlock = ADMIN_USERS.match(/function AccessTab\(\{[^}]*\}[^{]*\{[\s\S]*?\nfunction /)?.[0] ?? ADMIN_USERS;
check(
  "isAdminUser defined in AccessTab",
  /const isAdminUser\s*=/.test(accessTabBlock)
);
check(
  "isAdminUser reads user.globalRole (target user's role)",
  /isAdminUser\s*=\s*\[.*master_admin.*\]\.includes\(user\.globalRole\)/.test(accessTabBlock)
);
check(
  "isAdminUser does NOT read currentUser.globalRole",
  !/isAdminUser\s*=\s*\[.*master_admin.*\]\.includes\(currentUser\.globalRole\)/.test(accessTabBlock)
);

// ── 5. Frontend updateFlag sends the value including false ───────────────────
console.log("\n── 5. Frontend updateFlag persists boolean value (including false) ──");

check(
  "updateFlag function defined",
  /function updateFlag\(flag/.test(ADMIN_USERS)
);
check(
  "updateFlag uses [flag]: value (not [flag]: value || true)",
  /\[flag\]\s*:\s*value(?!\s*\|\|)/.test(ADMIN_USERS)
);
check(
  "updateFlag calls permsMutation.mutate",
  /updateFlag[\s\S]{0,200}permsMutation\.mutate/.test(ADMIN_USERS)
);
check(
  "onChange handler passes e.target.checked (boolean) to updateFlag",
  /onChange.*e\s*=>\s*updateFlag\(flag,\s*e\.target\.checked\)/.test(ADMIN_USERS)
);

// ── 6. Frontend checkbox disabled only while pending, not by admin exemption ──
console.log("\n── 6. Frontend checkbox disabled only while mutation pending ──");

const checkboxBlock = ADMIN_USERS.match(/\{.*flag.*label.*description.*\}.*\.map.*\(\{.*flag.*\}.*=>\s*\{[\s\S]*?disabled=\{[^}]*\}/)?.[0] ?? "";
check(
  "Export flag checkboxes exist in the render output",
  ADMIN_USERS.includes("can_export") && ADMIN_USERS.includes("can_download_attachment")
);
check(
  "Checkbox disabled prop is permsMutation.isPending (not isAdmin check)",
  /disabled=\{permsMutation\.isPending\}/.test(ADMIN_USERS)
);
check(
  "Checkbox disabled does NOT reference isAdminUser or currentUser for export flags",
  !(/disabled=\{[^}]*(isAdminUser|currentUser)[^}]*\}/.test(ADMIN_USERS))
);

// ── 7. Default permissions include all three flags as true ───────────────────
console.log("\n── 7. DEFAULT_PERMISSIONS baseline ──");

check(
  "DEFAULT_PERMISSIONS includes can_export: true",
  /DEFAULT_PERMISSIONS[\s\S]{0,300}can_export\s*:\s*true/.test(ADMIN_USERS) ||
  /can_export\s*:\s*true[\s\S]{0,300}DEFAULT_PERMISSIONS/.test(ADMIN_USERS)
);
check(
  "DEFAULT_PERMISSIONS includes can_download_attachment: true",
  /can_download_attachment\s*:\s*true/.test(ADMIN_USERS)
);
check(
  "DEFAULT_PERMISSIONS includes can_generate_report: true",
  /can_generate_report\s*:\s*true/.test(ADMIN_USERS)
);

// ── 8. Enabled computed with !== false (nullish-safe) ────────────────────────
console.log("\n── 8. enabled flag uses !== false (treats null/undefined as true) ──");

check(
  "enabled = perms[flag] !== false (not === true, not truthy coerce)",
  /enabled\s*=\s*perms\[flag\]\s*!==\s*false/.test(ADMIN_USERS)
);
check(
  "enabled does NOT use Boolean(perms[flag]) which would coerce null to false",
  !/enabled\s*=\s*Boolean\(perms\[flag\]\)/.test(ADMIN_USERS)
);

// ── 9. Admin-target users see locked screen, not broken controls ─────────────
console.log("\n── 9. Admin target users shown locked screen, not editable controls ──");

check(
  "isAdminUser gate returns early with locked UI",
  /if\s*\(isAdminUser\)\s*\{[\s\S]{0,400}return\s*\(/.test(ADMIN_USERS)
);
check(
  "Locked UI mentions Admin users have full access",
  /Admin users have full access/.test(ADMIN_USERS)
);
check(
  "Locked UI mentions Master Admins bypass restrictions",
  /Master Admins and Admins bypass/.test(ADMIN_USERS)
);

// ── 10. auth.ts export helpers use target-user permissions (not acting user) ──
console.log("\n── 10. auth.ts export permission helpers ──");

check(
  "requireCanExport middleware defined in auth.ts",
  /requireCanExport|requireExport/.test(AUTH)
);
check(
  "Export action maps to can_export field name",
  /export.*can_export|can_export.*export/.test(AUTH)
);
check(
  "Admin exemption applied for the REQUEST user (master_admin/admin bypass)",
  // auth.ts authorizeResourceAction: checks globalRole === master_admin first,
  // then falls through to can_export flag check — both must be present
  /globalRole === ["']master_admin["']/.test(AUTH) && /EXPORT_PERMISSION_FLAG|can_export/.test(AUTH)
);

// ── 11. No || true or ternary that coerces false → true ─────────────────────
console.log("\n── 11. No boolean coercion bugs ──");

check(
  "No 'can_export || true' pattern",
  !/can_export\s*\|\|\s*true/.test(ROUTES) && !/can_export\s*\|\|\s*true/.test(ADMIN_USERS)
);
check(
  "No 'can_download_attachment || true' pattern",
  !/can_download_attachment\s*\|\|\s*true/.test(ROUTES) && !/can_download_attachment\s*\|\|\s*true/.test(ADMIN_USERS)
);
check(
  "No 'can_generate_report || true' pattern",
  !/can_generate_report\s*\|\|\s*true/.test(ROUTES) && !/can_generate_report\s*\|\|\s*true/.test(ADMIN_USERS)
);
check(
  "No 'value ? value : true' anti-pattern in updateFlag context",
  !/\[flag\]\s*:\s*value\s*\?\s*value\s*:\s*true/.test(ADMIN_USERS)
);

// ── 12. Route file structure invariants ─────────────────────────────────────
console.log("\n── 12. Route structure invariants ──");

check(
  "PATCH /api/admin/users/:id/permissions requires requireAuth",
  /app\.patch\(["']\/api\/admin\/users\/:id\/permissions["'][\s\S]{0,50}requireAuth/.test(ROUTES)
);
check(
  "PATCH /api/admin/users/:id/permissions requires requireAdmin",
  /app\.patch\(["']\/api\/admin\/users\/:id\/permissions["'][\s\S]{0,80}requireAdmin/.test(ROUTES)
);
check(
  "Route validates body with permissionsBodySchema.safeParse",
  /permissionsBodySchema\.safeParse\(req\.body\)/.test(ROUTES)
);
check(
  "Route returns 400 on validation failure",
  /parsed\.success[\s\S]{0,100}400/.test(ROUTES) || /!parsed\.success[\s\S]{0,100}400/.test(ROUTES)
);
check(
  "Route records high risk action (audit trail)",
  /recordHighRiskAction[\s\S]{0,200}user_permissions_change/.test(ROUTES)
);

console.log("\n───────────────────────────────────────────────────────");
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log("───────────────────────────────────────────────────────");

if (failed > 0) process.exit(1);
