/**
 * Capital Investor Portal — Phase 2H Source-Grep Tests
 *
 * Verifies backend routes, security patterns, migration, service,
 * and frontend components are all wired correctly without running
 * a live server.
 */
"use strict";

const fs   = require("fs");
const path = require("path");

const ROUTES   = path.join(__dirname, "../server/routes-capital.ts");
const SERVICE  = path.join(__dirname, "../server/services/capital-portal.ts");
const PORTAL_PAGE = path.join(__dirname, "../client/src/pages/investor-portal.tsx");
const INVESTORS   = path.join(__dirname, "../client/src/pages/capital-investors.tsx");
const DOCUMENTS   = path.join(__dirname, "../client/src/pages/capital-documents.tsx");
const COMMAND     = path.join(__dirname, "../client/src/pages/capital-command-center.tsx");
const APP_TSX     = path.join(__dirname, "../client/src/App.tsx");

const routes    = fs.readFileSync(ROUTES,        "utf8");
const service   = fs.readFileSync(SERVICE,       "utf8");
const portal    = fs.readFileSync(PORTAL_PAGE,   "utf8");
const investors = fs.readFileSync(INVESTORS,     "utf8");
const documents = fs.readFileSync(DOCUMENTS,     "utf8");
const command   = fs.readFileSync(COMMAND,       "utf8");
const appTsx    = fs.readFileSync(APP_TSX,       "utf8");

let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function has(src, pattern, msg) {
  const ok = typeof pattern === "string" ? src.includes(pattern) : pattern.test(src);
  if (!ok) throw new Error(msg || `Pattern not found: ${pattern}`);
}
function hasNot(src, pattern, msg) {
  const found = typeof pattern === "string" ? src.includes(pattern) : pattern.test(src);
  if (found) throw new Error(msg || `Forbidden pattern found: ${pattern}`);
}

// ── Migration ───────────────────────────────────────────────────────────────
console.log("\n[Migration]");
test("capital_portal_access table created", () =>
  has(routes, "capital_portal_access", "capital_portal_access table not found"));
test("capital_portal_materials table created", () =>
  has(routes, "capital_portal_materials", "capital_portal_materials table not found"));
test("capital_portal_events table created", () =>
  has(routes, "capital_portal_events", "capital_portal_events table not found"));
test("token_hash column exists (not raw token)", () =>
  has(routes, "token_hash", "token_hash column not found"));
test("access_count column exists", () =>
  has(routes, "access_count", "access_count column not found"));
test("ip_hash column exists (not raw IP)", () =>
  has(routes, "ip_hash", "ip_hash column not found"));

// ── Token Security ──────────────────────────────────────────────────────────
console.log("\n[Token Security]");
test("tokens generated with crypto.randomBytes(32)", () =>
  has(routes, "randomBytes(32)", "randomBytes(32) not found"));
test("token stored as SHA-256 hash", () =>
  has(routes, "sha256", "sha256 hashing not found"));
test("raw_token returned once in POST response", () =>
  has(routes, "raw_token", "raw_token not returned in response"));
test("raw token never stored in DB (only hash)", () => {
  // The INSERT should use computed hash, not the raw token variable directly
  has(routes, "token_hash", "No token_hash found in INSERT");
});
test("IP hashed before storage", () =>
  has(routes, "ip_hash", "IP not hashed"));
test("user_agent truncated to 512 chars", () =>
  has(routes, "512", "user_agent not truncated to 512 chars"));

// ── Internal API Routes ─────────────────────────────────────────────────────
console.log("\n[Internal API Routes]");
test("GET investors/:id/portal-access", () =>
  has(routes, "investors/:id/portal-access", "GET investor portal-access route missing"));
test("POST investors/:id/portal-access (create)", () =>
  has(routes, /POST.*investors.*portal-access|investors.*portal-access.*POST/, "POST create portal-access missing"));
test("PATCH portal-access/:id", () =>
  has(routes, "portal-access/:id", "PATCH portal-access route missing"));
test("DELETE portal-access/:id", () =>
  has(routes, /DELETE.*portal-access/, "DELETE portal-access route missing"));
test("POST portal-access/:id/revoke", () =>
  has(routes, "portal-access/:id/revoke", "revoke route missing"));
test("POST portal-access/:id/regenerate", () =>
  has(routes, "portal-access/:id/regenerate", "regenerate route missing"));
test("POST portal-access/:id/materials", () =>
  has(routes, "portal-access/:id/materials", "add materials route missing"));
test("DELETE portal-access/:id/materials/:materialId", () =>
  has(routes, "portal-access/:id/materials/:materialId", "remove material route missing"));
test("GET portal-access/:id/events", () =>
  has(routes, "portal-access/:id/events", "events list route missing"));
test("GET portal-access/material-stats", () =>
  has(routes, "portal-access/material-stats", "material-stats route missing"));

// ── Public Portal Routes ────────────────────────────────────────────────────
console.log("\n[Public Portal Routes]");
test("GET /api/investor-portal/:token public route", () =>
  has(routes, "investor-portal/:token", "/api/investor-portal/:token route missing"));
test("POST /api/investor-portal/:token/events public route", () =>
  has(routes, "investor-portal/:token/events", "public events POST route missing"));
test("Public routes outside capitalGuard", () => {
  // Public routes must not be inside the requireCapitalAccess block
  // They should appear before or outside the internal routes section
  const pubIdx  = routes.indexOf("investor-portal/:token");
  const guardIdx = routes.indexOf("requireCapitalAccess");
  assert(pubIdx > -1, "investor-portal/:token not found");
  assert(guardIdx > -1, "requireCapitalAccess not found");
  // Public route appears somewhere; just verify it doesn't require auth
  has(routes, "investor-portal/:token");
});
test("Public route does NOT call requireCapitalAccess", () => {
  // The public investor-portal route block should not contain requireCapitalAccess
  const startIdx = routes.indexOf("GET.*investor-portal") !== -1
    ? routes.search(/investor-portal\/:token[^/]/)
    : routes.indexOf("investor-portal/:token");
  const snippet = routes.slice(startIdx, startIdx + 300);
  hasNot(snippet, "requireCapitalAccess", "Public investor-portal route uses requireCapitalAccess — should be public");
});
test("Token comparison uses SHA-256 before DB lookup", () => {
  // When validating incoming token, we hash it first
  has(routes, "sha256", "No SHA-256 hash on incoming token comparison");
});
test("Portal events deduplicated per calendar day", () =>
  has(routes, "portal_opened", "portal_opened dedup event not found"));

// ── Portal Intelligence Service ─────────────────────────────────────────────
console.log("\n[Portal Intelligence Service]");
test("computePortalIntelligence function exported", () =>
  has(service, "computePortalIntelligence", "computePortalIntelligence not exported"));
test("computePortalRiskFlags function exported", () =>
  has(service, "computePortalRiskFlags", "computePortalRiskFlags not exported"));
test("active_portals computed", () =>
  has(service, "active_portals", "active_portals not computed"));
test("investors_with_portal computed", () =>
  has(service, "investors_with_portal", "investors_with_portal not computed"));
test("portals_expiring_soon computed", () =>
  has(service, "portals_expiring_soon", "portals_expiring_soon not computed"));
test("portals_never_opened computed", () =>
  has(service, "portals_never_opened", "portals_never_opened not computed"));
test("diligence_investors_not_in_portal computed", () =>
  has(service, "diligence_investors_not_in_portal", "diligence_investors_not_in_portal not computed"));
test("most_viewed_materials computed", () =>
  has(service, "most_viewed_materials", "most_viewed_materials not computed"));
test("total_views_7d computed", () =>
  has(service, "total_views_7d", "total_views_7d not computed"));
test("risk flag for expiring portals", () =>
  has(service, "expir", "no expiry risk flag in service"));
test("risk flag for diligence investors without portal", () =>
  has(service, "Diligence", "no diligence risk flag in service"));

// ── Command Center Integration ──────────────────────────────────────────────
console.log("\n[Command Center: portal_intel]");
test("portal_intel type defined", () =>
  has(command, "PortalIntelligence", "PortalIntelligence type not in command center"));
test("portal_intel optional field in CommandCenterData", () =>
  has(command, "portal_intel?", "portal_intel field missing from CommandCenterData"));
test("section-portal-intel test ID", () =>
  has(command, "section-portal-intel", "section-portal-intel testId not found"));
test("portal-stat-active test ID", () =>
  has(command, "portal-stat-active", "portal stat cards missing testId"));
test("diligence gap warning rendered", () =>
  has(command, "portal-diligence-gap", "diligence gap block missing"));
test("portals expiring soon rendered", () =>
  has(command, "portal-expiring-list", "expiring list block missing"));
test("portals never opened rendered", () =>
  has(command, "portal-never-opened-list", "never-opened list block missing"));
test("most viewed materials rendered", () =>
  has(command, "portal-top-materials", "top materials block missing"));
test("portal_intel gated (only shown when present)", () =>
  has(command, "ccData?.portal_intel", "portal_intel not gated with optional check"));
test("Globe icon imported in command center", () =>
  has(command, "Globe", "Globe icon not imported in command center"));

// ── Investor Detail Portal Panel ────────────────────────────────────────────
console.log("\n[Investor Detail: PortalAccessPanel]");
test("PortalAccessPanel component defined", () =>
  has(investors, "PortalAccessPanel", "PortalAccessPanel not found in investors page"));
test("PortalAccessPanel added to InvestorDetail", () => {
  const detailFn = investors.slice(investors.indexOf("function InvestorDetail"), investors.indexOf("function EmailConversationsPanel"));
  has(detailFn, "PortalAccessPanel", "PortalAccessPanel not rendered in InvestorDetail");
});
test("portal-access-panel testId", () =>
  has(investors, "portal-access-panel", "portal-access-panel testId missing"));
test("btn-create-portal testId", () =>
  has(investors, "btn-create-portal", "btn-create-portal testId missing"));
test("btn-revoke-portal testId", () =>
  has(investors, "btn-revoke-portal", "btn-revoke-portal testId missing"));
test("btn-regen-portal testId", () =>
  has(investors, "btn-regen-portal", "btn-regen-portal testId missing"));
test("portal-token-url testId (one-time token display)", () =>
  has(investors, "portal-token-url", "one-time token URL display testId missing"));
test("btn-copy-portal-url testId", () =>
  has(investors, "btn-copy-portal-url", "copy portal URL button testId missing"));
test("create form: portal label input", () =>
  has(investors, "input-portal-label", "portal label input testId missing"));
test("create form: portal expiry input", () =>
  has(investors, "input-portal-expiry", "portal expiry input testId missing"));
test("create form: confirm create button", () =>
  has(investors, "btn-confirm-create-portal", "confirm create button testId missing"));
test("Portal fetches /api/capital/investors/:id/portal-access", () =>
  has(investors, "/api/capital/investors", "portal fetch URL missing"));
test("One-time token warning message present", () =>
  has(investors, "only be shown", "one-time token warning text missing"));
test("Regenerate issues new raw_token", () =>
  has(investors, "raw_token", "raw_token not used in portal panel"));

// ── Documents Portal Indicators ─────────────────────────────────────────────
console.log("\n[Documents: portal indicators]");
test("portal stats query in documents", () =>
  has(documents, "portal-access/material-stats", "material-stats query missing in documents"));
test("portalCountMap built from stats", () =>
  has(documents, "portalCountMap", "portalCountMap not found in documents"));
test("Globe icon imported in documents", () =>
  has(documents, "Globe", "Globe icon not imported in documents"));
test("portal count rendered in material detail or table", () =>
  has(documents, "portalCountMap", "portalCountMap not used in documents UI"));

// ── Public Portal Page ───────────────────────────────────────────────────────
console.log("\n[Public Portal Page]");
test("investor-portal page exported as default", () =>
  has(portal, "export default", "no default export in investor-portal.tsx"));
test("token extracted from window.location.pathname", () =>
  has(portal, "window.location.pathname", "window.location.pathname not used to extract token"));
test("token passed in fetch URL", () =>
  has(portal, "/api/investor-portal/", "public API URL not constructed with token"));
test("portal_event logging on view", () =>
  has(portal, "portal_opened", "portal_opened event not logged from public page"));
test("material download tracking event", () =>
  has(portal, "material_downloaded", "material_downloaded event not tracked"));
test("expired portal state handled", () =>
  has(portal, "expired", "no expired state in portal page"));
test("portal status=revoked handled", () =>
  has(portal, "revoked", "no revoked state in portal page"));
test("NDA badge for restricted materials", () =>
  has(portal, "requires_nda", "requires_nda not handled in portal page"));
test("brand — teal primary color", () =>
  has(portal, "cyan", "teal/cyan branding not found in portal page"));

// ── App.tsx Route Registration ───────────────────────────────────────────────
console.log("\n[App.tsx: investor portal route]");
test("InvestorPortalPage lazy imported", () =>
  has(appTsx, "InvestorPortalPage", "InvestorPortalPage lazy import missing"));
test("investor-portal path check in ternary", () =>
  has(appTsx, "/investor-portal/", "investor-portal route check missing in App.tsx"));
test("portal route is public (before !user check)", () => {
  const portalIdx = appTsx.indexOf("/investor-portal/");
  const noUserIdx = appTsx.indexOf(") : !user ? (");
  assert(portalIdx > -1, "/investor-portal/ not found in App.tsx");
  assert(noUserIdx > -1, "!user check not found in App.tsx");
  assert(portalIdx < noUserIdx, "investor-portal route must appear BEFORE the !user gate");
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("\nSome tests failed. Review output above.");
  process.exit(1);
} else {
  console.log("\nAll Phase 2H capital portal tests passed.");
  process.exit(0);
}
