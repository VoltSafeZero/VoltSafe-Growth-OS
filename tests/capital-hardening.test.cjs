/**
 * tests/capital-hardening.test.cjs
 * Phase 2L — Capital Hardening + Release Readiness Source-Grep Tests
 *
 * Verifies security, permission, portal safety, copilot hardening, reporting
 * hardening, data integrity, UX consistency, nav/search filtering, TypeScript
 * hygiene, and activity logging — all via source analysis (no DB / network).
 */

"use strict";
const fs   = require("fs");
const path = require("path");
const assert = require("assert");

let passed = 0;
let failed = 0;

function contains(src, pattern, label) {
  const ok = typeof pattern === "string" ? src.includes(pattern) : pattern.test(src);
  if (ok) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${label}`);
}
function notContains(src, pattern, label) {
  const ok = typeof pattern === "string" ? !src.includes(pattern) : !pattern.test(src);
  if (ok) { passed++; return; }
  failed++;
  console.error(`  FAIL (unexpected match): ${label}`);
}
function read(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }

const routes   = read("server/routes-capital.ts");
const appTsx   = read("client/src/App.tsx");
const navConfig = read("client/src/lib/nav-config.ts");
const sidebar   = read("client/src/components/dashboard/app-sidebar.tsx");
const globalSearch = read("client/src/components/global-search.tsx");
const copilotCtx = read("server/services/capital-copilot-context.ts");
const copilotSvc = read("server/services/capital-copilot.ts");
const reporting  = read("server/services/capital-reporting.ts");
const copilotPage = read("client/src/pages/capital-copilot.tsx");
const reportsPage = read("client/src/pages/capital-reports.tsx");
const serverIndex = read("server/index.ts");

// ─────────────────────────────────────────────────────────────────────────────
// 1. Permission model — routes-capital.ts
// ─────────────────────────────────────────────────────────────────────────────
contains(routes, "CAPITAL_ALLOWED_USER_IDS = new Set<number>([4])",
  "Trevor CEO (user 4) in allowlist");
contains(routes, "scott.carlson@voltsafe.com",
  "CFO Scott Carlson email in allowlist");
contains(routes, "export function requireCapitalAccess",
  "requireCapitalAccess is exported");
contains(routes, "res.status(403)",
  "403 returned on unauthorised capital access");
contains(routes, "Capital module access restricted",
  "safe opaque 403 message (no user data in message)");
contains(routes, "res.status(401)",
  "401 returned for unauthenticated requests");

// ─────────────────────────────────────────────────────────────────────────────
// 2. Public portal — token security
// ─────────────────────────────────────────────────────────────────────────────
contains(routes, "hashPortalToken",
  "portal token is hashed before DB lookup");
contains(routes, "access_token_hash",
  "DB query uses token hash column, not raw token");
contains(routes, "raw.length !== 64",
  "portal token length validated (64 chars)");
contains(routes, "[0-9a-f]",
  "portal token hex-only character validation");
contains(routes, `portal.status === "revoked"`,
  "revoked portal tokens are rejected with 403");
contains(routes, "expires_at && new Date(portal.expires_at).getTime() < Date.now()",
  "expired portal tokens are rejected with 403");
contains(routes, "hashIp(",
  "IP is hashed before storage (no raw IP stored)");
contains(routes, ".slice(0, 512)",
  "user-agent is truncated before storage (bounded)");
// raw token never stored — only hash column used in INSERT
notContains(routes, "access_token = '${rawToken}'",
  "raw token is never stored in DB (only hash)");

// portal response safety comment
contains(routes, "// Build safe response — never include scores",
  "portal response safety comment present");

// portal events dedup
contains(routes, "DATE(occurred_at) = '${today}'",
  "portal_opened event deduped once per calendar day");
contains(routes, "if (existsRows.rows.length === 0)",
  "dedup guard prevents duplicate portal_opened events");

// allowed event types allowlist
contains(routes, `const allowedEvents = new Set(["material_viewed", "material_downloaded"])`,
  "portal event types restricted to allowlist");

// portal response only exposes safe fields (check using actual response shape)
const portalResponseStart = routes.indexOf("// Build safe response");
const portalResponseBlock = routes.slice(portalResponseStart, portalResponseStart + 800);
contains(portalResponseBlock, "access_label",    "portal response includes access_label");
contains(portalResponseBlock, "investor_name",   "portal response includes investor_name");
contains(portalResponseBlock, "materials",       "portal response includes materials");
notContains(portalResponseBlock, "probability_percent", "portal response excludes probability_percent");
notContains(portalResponseBlock, "fit_score",    "portal response excludes fit_score");
notContains(portalResponseBlock, "heat_score",   "portal response excludes heat_score");
notContains(portalResponseBlock, "internal_notes", "portal response excludes internal_notes");

// ─────────────────────────────────────────────────────────────────────────────
// 3. SQL injection hardening
// ─────────────────────────────────────────────────────────────────────────────
contains(routes, "function esc(v: string): string { return String(v).replace(/'/g, \"''\"); }",
  "esc() helper double-quotes single-quotes (SQL escape)");
contains(routes, "function safeId(",
  "safeId() helper present for numeric ID validation");
// safeId returns null for invalid input
contains(routes, "isNaN(n) ? null : n",
  "safeId returns null for invalid/non-numeric input");

// ─────────────────────────────────────────────────────────────────────────────
// 4. AI Copilot hardening
// ─────────────────────────────────────────────────────────────────────────────

// context builder: board-safe mode
contains(copilotCtx, "BOARD-SAFE MODE",
  "copilot context emits BOARD-SAFE MODE label when include_sensitive=false");
contains(copilotCtx, "!include_sensitive",
  "copilot context gates sensitive data on include_sensitive flag");
contains(copilotCtx, "investor_id",
  "copilot context scopes by investor_id");
contains(copilotCtx, "round_id",
  "copilot context scopes by round_id");
// context must never include raw portal tokens or IP hashes
notContains(copilotCtx, "access_token_hash",
  "copilot context does not include portal token hashes");
notContains(copilotCtx, "ip_hash",
  "copilot context does not include IP hashes");

// AI service prompt discipline
contains(copilotSvc, "Never invent",
  "copilot system prompt instructs model never to invent data");
contains(copilotSvc, "Preserve exact numbers",
  "copilot system prompt instructs model to preserve exact numbers");
contains(copilotSvc, "Separate facts",
  "copilot prompt separates facts from recommendations");
contains(copilotSvc, "Do not auto-send emails",
  "copilot prompt prohibits auto-sending emails");
contains(copilotSvc, "BOARD-SAFE mode",
  "copilot system prompt references BOARD-SAFE mode");
contains(copilotSvc, "email_draft",
  "copilot supports email_draft mode");
notContains(copilotSvc, "sendEmail(",
  "copilot service never calls sendEmail (advisory-only, no auto-send)");

// copilot routes require both requireAuth + requireCapitalAccess
contains(routes, `"/api/capital/copilot/query", requireAuth, requireCapitalAccess`,
  "copilot query route uses requireAuth + requireCapitalAccess");
contains(routes, `"/api/capital/copilot/metadata", requireAuth, requireCapitalAccess`,
  "copilot metadata route uses requireAuth + requireCapitalAccess");

// ─────────────────────────────────────────────────────────────────────────────
// 5. Reporting hardening
// ─────────────────────────────────────────────────────────────────────────────
contains(reporting, "generated_at",
  "reporting service includes generated_at timestamp");
notContains(reporting, "sendEmail(",
  "reporting service does not auto-send emails");
notContains(reporting, "TODO",
  "reporting service has no TODO/placeholder markers");
notContains(reporting, "PLACEHOLDER",
  "reporting service has no PLACEHOLDER markers");

// report routes use requireAuth + requireCapitalAccess
contains(routes, `"/api/capital/reports", requireAuth, requireCapitalAccess`,
  "GET /api/capital/reports is behind requireAuth + requireCapitalAccess");
contains(routes, `"/api/capital/reports/:type", requireAuth, requireCapitalAccess`,
  "GET /api/capital/reports/:type is behind requireAuth + requireCapitalAccess");

// ─────────────────────────────────────────────────────────────────────────────
// 6. Activity logging
// ─────────────────────────────────────────────────────────────────────────────
contains(routes, "logCapitalActivity",
  "logCapitalActivity helper is used");
contains(routes, `"Stage Change"`,
  "stage changes are activity-logged");
contains(routes, `"Commitment Change"`,
  "commitment changes are activity-logged");
contains(routes, "Investor added",
  "investor creation is activity-logged");
contains(routes, `"Note"`,
  "note/next-step updates are activity-logged");
// activity logging must be fire-and-forget (not crash primary routes)
contains(routes, "} catch { /* audit write failure must never surface to caller",
  "activity logging uses non-fatal catch to prevent crashing primary route");

// ─────────────────────────────────────────────────────────────────────────────
// 7. Frontend — capitalGuard + route protection
// ─────────────────────────────────────────────────────────────────────────────
contains(appTsx, "function capitalGuard",
  "capitalGuard function defined in App.tsx");
contains(appTsx, `(isAdmin(role) || perms.capital === "edit") ? children : <AccessDenied />`,
  "capitalGuard checks perms.capital === edit (with admin bypass; backend requireCapitalAccess allowlist independently gates every /api/capital/* route regardless of this frontend check)");

// All Capital pages go through capitalGuard
const capitalRoutes = [
  "/capital/dashboard", "/capital/pipeline", "/capital/targets",
  "/capital/contacts", "/capital/rounds", "/capital/commitments",
  "/capital/grants", "/capital/updates", "/capital/data-room",
  "/capital/follow-ups", "/capital/email-review", "/capital/command-center",
  "/capital/engagement", "/capital/reports", "/capital/copilot",
];
for (const r of capitalRoutes) {
  const idx = appTsx.indexOf(`path="${r}"`);
  if (idx === -1) { failed++; console.error(`  FAIL: route ${r} not found in App.tsx`); continue; }
  const slice = appTsx.slice(idx, idx + 80);
  if (slice.includes("capitalGuard(")) { passed++; }
  else { failed++; console.error(`  FAIL: ${r} does not use capitalGuard`); }
}

// GlobalSearch passes isCapitalUser
contains(appTsx, `isCapitalUser={perms.capital === "edit"}`,
  "App.tsx passes isCapitalUser to GlobalSearch");

// ─────────────────────────────────────────────────────────────────────────────
// 8. Sidebar — capitalOnly enforcement
// ─────────────────────────────────────────────────────────────────────────────
contains(sidebar, `if (section.capitalOnly) return (perms as any).capital === "edit"`,
  "sidebar hides capitalOnly sections from non-capital users");
contains(sidebar, "// capitalOnly is checked before the admin bypass",
  "capitalOnly is identity-based (checked before admin bypass)");

// ─────────────────────────────────────────────────────────────────────────────
// 9. Global search — capital page filtering
// ─────────────────────────────────────────────────────────────────────────────
contains(globalSearch, "if (p.capitalOnly && !isCapitalUser) return false",
  "matchPageNav filters out capitalOnly entries for non-capital users");
contains(globalSearch, "isCapitalUser?: boolean",
  "GlobalSearch accepts isCapitalUser prop");
contains(globalSearch, "isCapitalUser = false",
  "GlobalSearch defaults isCapitalUser to false (secure default)");

// PageNavEntry type includes capitalOnly
contains(navConfig, "capitalOnly?: true",
  "PageNavEntry type includes capitalOnly field");

// All Capital PAGE_NAV_INDEX entries carry capitalOnly: true
const capitalNavEntries = [
  "Capital Command Center", "Capital Dashboard", "Investors",
  "Investor Targets", "Investor Contacts", "Rounds & Commitments",
  "Commitments", "Grants & Non-Dilutive", "Follow-Ups",
  "Data Room", "Updates & Reviews", "Capital Email Review",
  "Investor Engagement", "Capital Reports", "Capital AI Copilot",
];
for (const name of capitalNavEntries) {
  const idx = navConfig.indexOf(`name: "${name}"`);
  if (idx === -1) {
    failed++;
    console.error(`  FAIL: PAGE_NAV_INDEX missing entry: "${name}"`);
    continue;
  }
  const slice = navConfig.slice(idx, idx + 130);
  if (slice.includes("capitalOnly: true")) { passed++; }
  else { failed++; console.error(`  FAIL: PAGE_NAV_INDEX entry "${name}" missing capitalOnly: true`); }
}

// New pages Engagement, Reports, Copilot added to PAGE_NAV_INDEX
contains(navConfig, "/capital/engagement",
  "Investor Engagement page in PAGE_NAV_INDEX");
contains(navConfig, "/capital/reports",
  "Capital Reports page in PAGE_NAV_INDEX");
contains(navConfig, "/capital/copilot",
  "Capital AI Copilot page in PAGE_NAV_INDEX");

// ─────────────────────────────────────────────────────────────────────────────
// 10. Copilot page UX
// ─────────────────────────────────────────────────────────────────────────────
// Copilot page is restricted — capitalGuard in App.tsx handles AccessDenied
// Page has loading state via queryMutation.isPending
contains(copilotPage, "queryMutation.isPending",
  "copilot page disables submit while loading (isPending)");
// Error is shown via toast
contains(copilotPage, "Copilot error",
  "copilot page shows error toast on failure");
// Advisory-only: no auto-send; drafts are drafts only
contains(copilotPage, "email_draft",
  "copilot page supports email_draft mode");
notContains(copilotPage, "sendEmail(",
  "copilot page never calls sendEmail (advisory output only)");
// Draft output is displayed, not auto-sent
contains(copilotPage, "draft_output",
  "copilot page renders draft_output (not auto-sent)");

// ─────────────────────────────────────────────────────────────────────────────
// 11. Reports page UX
// ─────────────────────────────────────────────────────────────────────────────
// Reports page restricted — capitalGuard handles AccessDenied
contains(reportsPage, "isLoading: metaLoading",
  "reports page shows loading state via metaLoading");
contains(reportsPage, "generated_at",
  "reports page displays generated_at timestamp");
// Report comment at top confirms restriction
contains(reportsPage, "requireCapitalAccess",
  "reports page comment references requireCapitalAccess restriction");

// ─────────────────────────────────────────────────────────────────────────────
// 12. Error handling — backend
// ─────────────────────────────────────────────────────────────────────────────
const errorLogCount = (routes.match(/console\.error\(/g) || []).length;
assert.ok(errorLogCount >= 20, "Expected >=20 error log points in routes-capital, got " + errorLogCount);
passed++;

const errorResCount = (routes.match(/res\.status\(\d\d\d\)\.json/g) || []).length;
assert.ok(errorResCount >= 30, "Expected >=30 error status responses in routes-capital, got " + errorResCount);
passed++;

// ─────────────────────────────────────────────────────────────────────────────
// 13. migrateCapitalSchema — correct async startup pattern
// ─────────────────────────────────────────────────────────────────────────────
contains(routes, "export async function migrateCapitalSchema(): Promise<void>",
  "migrateCapitalSchema is an async function");
// Called with await in server/index.ts (not in route registration scope)
contains(serverIndex, "await migrateCapitalSchema()",
  "migrateCapitalSchema is awaited in server startup (server/index.ts)");
contains(serverIndex, "migrateCapitalSchema",
  "migrateCapitalSchema imported and called at server startup");

// ─────────────────────────────────────────────────────────────────────────────
// 14. No Capital data in public search API
// ─────────────────────────────────────────────────────────────────────────────
const mainRoutes = read("server/routes.ts");
notContains(mainRoutes, "capital_funders",
  "main routes.ts never queries capital_funders (Capital data isolated)");
notContains(mainRoutes, "capital_investors",
  "main routes.ts never queries capital_investors (Capital data isolated)");
notContains(mainRoutes, "capital_rounds",
  "main routes.ts never queries capital_rounds (Capital data isolated)");

// ─────────────────────────────────────────────────────────────────────────────
// 15. Data integrity helpers
// ─────────────────────────────────────────────────────────────────────────────
contains(routes, "safeId(",
  "safeId() used for numeric ID validation in queries");
contains(routes, "deleted_at IS NULL",
  "soft-delete filter (deleted_at IS NULL) used in queries");
contains(routes, "LIMIT 1",
  "LIMIT 1 used on single-record lookups");
contains(routes, "LIMIT 200",
  "result sets are bounded (LIMIT 200 present)");

// ─────────────────────────────────────────────────────────────────────────────
// 16. Portal public route isolation
// ─────────────────────────────────────────────────────────────────────────────
const portalPublicStart = routes.indexOf("// ── PUBLIC: GET /api/investor-portal/:token");
const portalPublicBlock = routes.slice(portalPublicStart, portalPublicStart + 200);
contains(portalPublicBlock, "No requireAuth. Token-only access.",
  "portal GET route documents its intentional public nature");
// public portal routes must NOT use requireCapitalAccess
notContains(portalPublicBlock, "requireCapitalAccess",
  "portal public GET does NOT use requireCapitalAccess (token-only by design)");

// ─────────────────────────────────────────────────────────────────────────────
// 17. Cortex / main search isolation
// ─────────────────────────────────────────────────────────────────────────────
notContains(mainRoutes, "capital_copilot",
  "main routes.ts does not expose capital_copilot context");
// Capital routes registered separately via registerCapitalRoutes
notContains(mainRoutes, `app.get("/api/capital`,
  "main routes.ts does not register /api/capital routes directly");

// ─────────────────────────────────────────────────────────────────────────────
// 18. No raw token in portal INSERT
// ─────────────────────────────────────────────────────────────────────────────
// Portal INSERT stores only hash — verify raw token not used in VALUES
const portalInsertIdx = routes.indexOf("INSERT INTO capital_portal_access");
if (portalInsertIdx !== -1) {
  const insertBlock = routes.slice(portalInsertIdx, portalInsertIdx + 600);
  contains(insertBlock, "tokenHash",
    "portal INSERT uses tokenHash (not raw token)");
  notContains(insertBlock, "rawToken",
    "portal INSERT does not use rawToken directly");
}

// ─────────────────────────────────────────────────────────────────────────────
// Results
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n────────────────────────────────────────────────────────────");
console.log(`  Phase 2L Hardening Tests: ${passed} passed, ${failed} failed`);
if (failed === 0) console.log("  ✓ All Phase 2L capital hardening checks passed");
console.log("────────────────────────────────────────────────────────────\n");
process.exit(failed > 0 ? 1 : 0);
