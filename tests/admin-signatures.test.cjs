"use strict";
const fs = require("fs");
const path = require("path");

let passed = 0, failed = 0;
function ok(label, condition) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else           { console.error(`  ✗ ${label}`); failed++; }
}

const routesSrc  = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");
const authSrc    = fs.readFileSync(path.join(__dirname, "../server/auth.ts"), "utf8");
const adminPage  = fs.readFileSync(path.join(__dirname, "../client/src/pages/admin-signatures.tsx"), "utf8");
const sigPage    = fs.readFileSync(path.join(__dirname, "../client/src/pages/signature-settings.tsx"), "utf8");
const appSrc     = fs.readFileSync(path.join(__dirname, "../client/src/App.tsx"), "utf8");
const navSrc     = fs.readFileSync(path.join(__dirname, "../client/src/lib/nav-config.ts"), "utf8");

// ── 1. Backend — canManageAnyUserSignature helper ─────────────────────────────
console.log("── 1. Backend permission helper ──");
ok("canManageAnyUserSignature defined in routes.ts",
  routesSrc.includes("function canManageAnyUserSignature(session: any): boolean"));
ok("canManageAnyUserSignature checks master_admin only (not admin)",
  routesSrc.includes('"master_admin"') &&
  routesSrc.includes("canManageAnyUserSignature") &&
  !routesSrc.includes('globalRole || "") === "admin"'));
ok("canManageAnyUserSignature returns true only for master_admin",
  routesSrc.includes('=== "master_admin"') &&
  routesSrc.includes("canManageAnyUserSignature"));

// ── 2. Backend routes exist ───────────────────────────────────────────────────
console.log("\n── 2. Backend routes ──");
ok('GET /api/admin/users/signatures route registered',
  routesSrc.includes('app.get("/api/admin/users/signatures"'));
ok('GET /api/admin/users/:userId/signature route registered',
  routesSrc.includes('app.get("/api/admin/users/:userId/signature"'));
ok('PUT /api/admin/users/:userId/signature route registered',
  routesSrc.includes('app.put("/api/admin/users/:userId/signature"'));

// ── 3. Backend — authorization enforced on all 3 routes ──────────────────────
console.log("\n── 3. Backend authorization ──");
const listIdx = routesSrc.indexOf('app.get("/api/admin/users/signatures"');
const getIdx  = routesSrc.indexOf('app.get("/api/admin/users/:userId/signature"');
const putIdx  = routesSrc.indexOf('app.put("/api/admin/users/:userId/signature"');

ok("GET /api/admin/users/signatures: requireAuth + requireAdmin in middleware",
  listIdx !== -1 && routesSrc.slice(listIdx, listIdx + 120).includes("requireAuth") &&
  routesSrc.slice(listIdx, listIdx + 120).includes("requireAdmin"));
ok("GET /api/admin/users/:userId/signature: requireAuth + requireAdmin in middleware",
  getIdx !== -1 && routesSrc.slice(getIdx, getIdx + 120).includes("requireAuth") &&
  routesSrc.slice(getIdx, getIdx + 120).includes("requireAdmin"));
ok("PUT /api/admin/users/:userId/signature: requireAuth + requireAdmin in middleware",
  putIdx !== -1 && routesSrc.slice(putIdx, putIdx + 120).includes("requireAuth") &&
  routesSrc.slice(putIdx, putIdx + 120).includes("requireAdmin"));

ok("GET list: 403 when not master_admin",
  routesSrc.slice(listIdx, listIdx + 400).includes("Master Admin access required"));
ok("GET user sig: 403 when not master_admin",
  routesSrc.slice(getIdx, getIdx + 400).includes("Master Admin access required"));
ok("PUT user sig: 403 when not master_admin",
  routesSrc.slice(putIdx, putIdx + 500).includes("Master Admin access required"));

ok("requireAdmin from auth.ts covers admin + master_admin (not just master_admin)",
  authSrc.includes('"master_admin"') && authSrc.includes('"admin"'));
ok("canManageAnyUserSignature is the extra master_admin-only gate (stricter than requireAdmin)",
  routesSrc.includes("canManageAnyUserSignature(req.session)"));

// ── 4. Backend — target user validation ──────────────────────────────────────
console.log("\n── 4. Backend — target user validation ──");
const putBlock = routesSrc.slice(putIdx, putIdx + 5000);
ok("PUT: validates target user exists before saving",
  putBlock.includes("User not found"));
ok("PUT: validates name + htmlContent required",
  putBlock.includes('"name and htmlContent are required"'));
ok("PUT: CTA asset guard applied (same as self-service)",
  putBlock.includes("archived or missing CTA asset"));
ok("PUT: uses normalizeSignatureHtml (same pipeline)",
  putBlock.includes("normalizeSignatureHtml"));
ok("PUT: uses sanitizeSignatureHtml (same pipeline)",
  putBlock.includes("sanitizeSignatureHtml"));
ok("PUT: upserts — updates existing sig if user has one",
  putBlock.includes("existingSigs.length > 0"));
ok("PUT: creates new sig if user has none",
  putBlock.includes("db.insert(emailSignatures)"));
ok("PUT: audit log records actor and target userId",
  putBlock.includes("actorUserId") && putBlock.includes("targetUserId"));
ok("PUT: console.log records actor/target for audit trail",
  putBlock.includes("admin-sig") && putBlock.includes("actor="));

// ── 5. Backend — regular user cannot pass userId to self-service endpoints ───
console.log("\n── 5. Backend — self-service scoped to req.user ──");
const selfGetIdx = routesSrc.indexOf('app.get("/api/signatures"');
const selfPostIdx = routesSrc.indexOf('app.post("/api/signatures"');
const selfPutIdx  = routesSrc.indexOf('app.put("/api/signatures/:id"');

ok("GET /api/signatures: scoped to session userId only",
  selfGetIdx !== -1 &&
  routesSrc.slice(selfGetIdx, selfGetIdx + 300).includes("userId") &&
  !routesSrc.slice(selfGetIdx, selfGetIdx + 300).includes("req.query.userId") &&
  !routesSrc.slice(selfGetIdx, selfGetIdx + 300).includes("req.body.userId"));
ok("POST /api/signatures: scoped to session userId only",
  selfPostIdx !== -1 &&
  !routesSrc.slice(selfPostIdx, selfPostIdx + 400).includes("req.body.userId") &&
  !routesSrc.slice(selfPostIdx, selfPostIdx + 400).includes("req.query.userId"));
// Per-mailbox signatures (see signature-per-mailbox.test.cjs): ownership is
// now owner-or-admin per mailbox via assertSignatureAccountAccess, with a
// strict per-user fallback for legacy (emailAccountId === null) rows —
// not a single global `userId` WHERE clause anymore.
ok("PUT /api/signatures/:id: scoped via assertSignatureAccountAccess (mailbox) or strict per-user fallback (legacy)",
  selfPutIdx !== -1 &&
  routesSrc.slice(selfPutIdx, selfPutIdx + 2000).includes("assertSignatureAccountAccess") &&
  routesSrc.slice(selfPutIdx, selfPutIdx + 2000).includes("existing.userId !== userId && !isAdmin"));

// ── 6. Backend — image URL rewriting in GET /api/admin/users/:userId/signature
console.log("\n── 6. Backend — image URL rewriting ──");
const getBlock = routesSrc.slice(getIdx, getIdx + 1500);
ok("GET admin sig: rewrites ctaImageUrl to current host",
  getBlock.includes("fixImgUrl"));
ok("GET admin sig: rewrites /assets/cta/ srcs in htmlContent",
  getBlock.includes("fixHtml"));

// ── 7. Frontend — SignatureDialog exported ───────────────────────────────────
console.log("\n── 7. Frontend — SignatureDialog exports ──");
ok("SignatureDialog is exported from signature-settings.tsx",
  sigPage.includes("export function SignatureDialog("));
ok("adminTargetUser prop defined in SignatureDialog",
  sigPage.includes("adminTargetUser?:") && sigPage.includes("id: number; name: string; email: string"));
ok("SignatureDialog header shows target user name in admin mode",
  sigPage.includes("Edit Signature — ${adminTargetUser.name}") ||
  sigPage.includes("`Edit Signature — ${adminTargetUser.name}`"));
ok("SignatureDialog description shows target email in admin mode",
  sigPage.includes("adminTargetUser.email"));
ok("saveMutation uses PUT /api/admin/users/:userId/signature when adminTargetUser set",
  sigPage.includes("/api/admin/users/${adminTargetUser.id}/signature"));
ok("saveMutation: admin path always uses PUT (upsert)",
  sigPage.includes('apiRequest("PUT", `/api/admin/users/${adminTargetUser.id}/signature`'));
ok("onSuccess invalidates admin query key on save",
  sigPage.includes("/api/admin/users/signatures"));
ok("onSuccess toast shows target user name for admin saves",
  sigPage.includes("adminTargetUser ? `Signature saved for ${adminTargetUser.name}`") ||
  sigPage.includes("Signature saved for ${adminTargetUser.name}"));

// ── 8. Frontend — helpers exported ───────────────────────────────────────────
console.log("\n── 8. Frontend — exported helpers and types ──");
ok("EmailSignature type exported",      sigPage.includes("export type EmailSignature"));
ok("SigFields type exported",           sigPage.includes("export type SigFields"));
ok("CtaConfig type exported",           sigPage.includes("export type CtaConfig"));
ok("DEFAULT_FIELDS const exported",     sigPage.includes("export const DEFAULT_FIELDS"));
ok("DEFAULT_CTA_CONFIG const exported", sigPage.includes("export const DEFAULT_CTA_CONFIG"));
ok("buildSignatureHtml exported",       sigPage.includes("export function buildSignatureHtml"));
ok("htmlToPlainText exported",          sigPage.includes("export function htmlToPlainText"));
ok("wrapHtmlWithCta exported",          sigPage.includes("export function wrapHtmlWithCta"));

// ── 9. Frontend — admin-signatures.tsx page ───────────────────────────────────
console.log("\n── 9. Frontend — admin-signatures.tsx ──");
ok("page renders access denied for non-master_admin",
  adminPage.includes("Master Admin Only"));
ok("page imports SignatureDialog from signature-settings",
  adminPage.includes("import { SignatureDialog }") &&
  adminPage.includes("@/pages/signature-settings"));
ok("page fetches /api/admin/users/signatures",
  adminPage.includes("/api/admin/users/signatures"));
ok("page fetches /api/admin/users/:userId/signature on edit",
  adminPage.includes("/api/admin/users/${") && adminPage.includes("/signature"));
ok("page passes adminTargetUser to SignatureDialog",
  adminPage.includes("adminTargetUser={editTarget.user}"));
ok("page passes existing signature data to SignatureDialog",
  adminPage.includes("existing={editTarget.signature}"));
ok("page has search filter",
  adminPage.includes("input-admin-sig-search") || adminPage.includes("Search by name"));
ok("page shows user table with Edit buttons",
  adminPage.includes("button-edit-sig-"));
ok("page shows hasSignature status column",
  adminPage.includes("hasSignature"));
ok("page shows updatedAt column",
  adminPage.includes("updatedAt"));
ok("edit button disabled while loading",
  adminPage.includes("loadingUserId === user.userId"));
ok("isMasterAdmin check uses currentUserGlobalRole prop",
  adminPage.includes('currentUserGlobalRole === "master_admin"'));

// ── 10. Frontend — App.tsx routing ───────────────────────────────────────────
console.log("\n── 10. Frontend — App.tsx routing ──");
ok("AdminSignaturesPage lazy imported in App.tsx",
  appSrc.includes('import("@/pages/admin-signatures")'));
ok("/admin/signatures route registered in App.tsx",
  appSrc.includes('path="/admin/signatures"'));
ok("route passes currentUserGlobalRole prop",
  appSrc.includes("currentUserGlobalRole={user.globalRole"));

// ── 11. Frontend — nav-config.ts ─────────────────────────────────────────────
console.log("\n── 11. Frontend — nav-config.ts ──");
ok("User Signatures nav item added",
  navSrc.includes("/admin/signatures"));
ok("User Signatures nav item is admin-only",
  navSrc.includes('"admin-user-signatures"') &&
  navSrc.includes("adminOnly: true"));

// ── 12. Signature consistency — admin path uses same HTML pipeline ─────────
console.log("\n── 12. Signature pipeline consistency ──");
ok("admin PUT uses normalizeSignatureHtml (same as self-service PUT)",
  putBlock.includes("normalizeSignatureHtml") &&
  routesSrc.slice(selfPutIdx, selfPutIdx + 3000).includes("normalizeSignatureHtml"));
ok("admin PUT uses sanitizeSignatureHtml (same as self-service PUT)",
  putBlock.includes("sanitizeSignatureHtml") &&
  routesSrc.slice(selfPutIdx, selfPutIdx + 3000).includes("sanitizeSignatureHtml"));
ok("admin PUT: CTA asset guard same as self-service",
  putBlock.includes("is_archived = FALSE") &&
  routesSrc.slice(selfPutIdx, selfPutIdx + 2200).includes("is_archived = FALSE"));
ok("wrapHtmlWithCta in sig-settings still uses width:200px",
  sigPage.includes("width:200px") && sigPage.includes("max-width:200px"));
ok("buildSignatureHtml used by admin UI via exported function",
  sigPage.includes("export function buildSignatureHtml") &&
  adminPage.includes("signature-settings"));

console.log("\n" + "─".repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
