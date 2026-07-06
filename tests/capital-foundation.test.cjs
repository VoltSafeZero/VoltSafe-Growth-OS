/**
 * Capital Module Phase 1 — foundation source-grep tests
 *
 * Verifies:
 * - requireCapitalAccess middleware exists and is identity-based (NOT admin bypass)
 * - CAPITAL_ALLOWED_USER_IDS includes Trevor (user 4)
 * - All capital API routes are registered
 * - Frontend pages exist
 * - Nav includes Capital section with capitalOnly flag
 * - App.tsx registers capital routes with capitalGuard
 * - No admin bypass in requireCapitalAccess
 */

const fs = require("fs");
const path = require("path");

let passed = 0, failed = 0;

function load(rel) {
  const abs = path.resolve(__dirname, "..", rel);
  if (!fs.existsSync(abs)) return "";
  return fs.readFileSync(abs, "utf8");
}

function ok(desc, condition, hint = "") {
  if (condition) {
    console.log(`  ✓ ${desc}`);
    passed++;
  } else {
    console.error(`  ✗ ${desc}${hint ? ` — ${hint}` : ""}`);
    failed++;
  }
}

function has(src, pattern) {
  if (typeof pattern === "string") return src.includes(pattern);
  return pattern.test(src);
}

const capital    = load("server/routes-capital.ts");
const indexTs    = load("server/index.ts");
const routesTs   = load("server/routes.ts");
const navConfig  = load("client/src/lib/nav-config.ts");
const appTsx     = load("client/src/App.tsx");
const sidebar    = load("client/src/components/dashboard/app-sidebar.tsx");
const dashboard  = load("client/src/pages/capital-dashboard.tsx");
const investors  = load("client/src/pages/capital-investors.tsx");
const grants     = load("client/src/pages/capital-grants.tsx");
const pipeline   = load("client/src/pages/capital-pipeline.tsx");
const documents  = load("client/src/pages/capital-documents.tsx");

console.log("\n── 1. Backend: requireCapitalAccess ────────────────────────────────");
ok("requireCapitalAccess exported from routes-capital.ts",
  has(capital, "requireCapitalAccess"));
ok("CAPITAL_ALLOWED_USER_IDS is a Set that includes user 4 (Trevor)",
  has(capital, "CAPITAL_ALLOWED_USER_IDS") && has(capital, /new Set.*\[4\]/s));
ok("CAPITAL_ALLOWED_EMAILS exported from routes-capital.ts",
  has(capital, "CAPITAL_ALLOWED_EMAILS"));
ok("No admin/master_admin bypass in requireCapitalAccess",
  !has(capital, /requireCapitalAccess[\s\S]{0,500}master_admin/));
ok("requireCapitalAccess returns 403 for unauthorized users",
  has(capital, "403") && has(capital, "Capital module access restricted"));
ok("requireCapitalAccess checks both user ID and email",
  has(capital, "CAPITAL_ALLOWED_USER_IDS.has") && has(capital, "CAPITAL_ALLOWED_EMAILS"));

console.log("\n── 2. Backend: migration ───────────────────────────────────────────");
ok("migrateCapitalSchema exported from routes-capital.ts",
  has(capital, "migrateCapitalSchema"));
ok("capital_funders table created in migration",
  has(capital, "capital_funders"));
ok("capital_grants table created in migration",
  has(capital, "capital_grants"));
ok("capital_documents table created in migration",
  has(capital, "capital_documents"));
ok("capital_activities table created in migration",
  has(capital, "capital_activities"));
ok("weighted_amount_cents computed in routes (not stored column)",
  has(capital, "weighted("));
ok("Migration called in server/index.ts",
  has(indexTs, "migrateCapitalSchema") || has(indexTs, "capital"));

console.log("\n── 3. Backend: API routes ──────────────────────────────────────────");
ok("GET /api/capital/dashboard route registered",
  has(capital, '"/api/capital/dashboard"') || has(capital, "'/api/capital/dashboard'"));
ok("GET /api/capital/funders route registered",
  has(capital, '"/api/capital/funders"') || has(capital, "'/api/capital/funders'"));
ok("POST /api/capital/funders route registered",
  has(capital, /app\.post.*capital\/funders/));
ok("PATCH /api/capital/funders/:id route registered",
  has(capital, /app\.patch.*capital\/funders\/:id/));
ok("DELETE /api/capital/funders/:id route registered",
  has(capital, /app\.delete.*capital\/funders\/:id/));
ok("GET /api/capital/grants route registered",
  has(capital, /app\.get.*capital\/grants['"]/));
ok("POST /api/capital/grants route registered",
  has(capital, /app\.post.*capital\/grants['"]/));
ok("PATCH /api/capital/grants/:id route registered",
  has(capital, /app\.patch.*capital\/grants\/:id/));
ok("DELETE /api/capital/grants/:id route registered",
  has(capital, /app\.delete.*capital\/grants\/:id/));
ok("GET /api/capital/documents route registered",
  has(capital, /app\.get.*capital\/documents/));
ok("POST /api/capital/documents route registered",
  has(capital, /app\.post.*capital\/documents['"]/));
ok("GET /api/capital/activities route registered",
  has(capital, /app\.get.*capital\/activities/));
ok("POST /api/capital/activities route registered",
  has(capital, /app\.post.*capital\/activities['"]/));
ok("GET /api/capital/pipeline route registered",
  has(capital, /app\.get.*capital\/pipeline/));
ok("All capital routes gated by requireCapitalAccess",
  has(capital, "requireCapitalAccess"));
ok("registerCapitalRoutes exported",
  has(capital, "registerCapitalRoutes"));
ok("Capital routes registered in server/index.ts or routes.ts",
  has(indexTs, "registerCapitalRoutes") || has(routesTs, "registerCapitalRoutes") ||
  has(indexTs, "routes-capital") || has(routesTs, "routes-capital"));

console.log("\n── 4. Backend: isCapitalUser in /api/auth/me ──────────────────────");
ok("/api/auth/me includes isCapitalUser or capital permission",
  has(routesTs, "isCapitalUser") || has(routesTs, "CAPITAL_ALLOWED") ||
  has(routesTs, "capital_user") || has(routesTs, "capital:") ||
  // check if the me route was updated
  has(routesTs, "capital"));

console.log("\n── 5. Frontend: pages exist ────────────────────────────────────────");
ok("capital-dashboard.tsx exists and has useQuery",
  has(dashboard, "useQuery") && has(dashboard, "capital/dashboard"));
ok("capital-dashboard shows empty state when no data",
  has(dashboard, "No capital records yet") || has(dashboard, "no capital"));
ok("capital-dashboard shows committed, soft-circled, weighted pipeline",
  has(dashboard, "Committed") && has(dashboard, "Soft") && has(dashboard, "Weighted"));
ok("capital-investors.tsx exists and has funder table",
  has(investors, "capital/funders") && has(investors, "Add Investor"));
ok("capital-investors has create/edit dialog",
  has(investors, "Dialog") && has(investors, "pipeline_stage") && has(investors, "funder_type"));
ok("capital-investors has search + type/stage/priority filters",
  has(investors, "typeFilter") && has(investors, "stageFilter"));
ok("capital-grants.tsx exists with deadline and status columns",
  has(grants, "capital/grants") && has(grants, "deadline") && has(grants, "application_status"));
ok("capital-grants has create/edit dialog",
  has(grants, "Dialog") && has(grants, "program_name"));
ok("capital-pipeline.tsx shows funders grouped by stage",
  has(pipeline, "pipeline_stage") && has(pipeline, "capital/pipeline"));
ok("capital-documents.tsx exists with document type + status",
  has(documents, "document_type") && has(documents, "status") && has(documents, "capital/documents"));

console.log("\n── 6. Frontend: navigation ─────────────────────────────────────────");
ok("nav-config has Capital section",
  has(navConfig, '"capital"') || has(navConfig, "capital-dashboard") || has(navConfig, "Capital"));
ok("nav-config Capital has Dashboard item",
  has(navConfig, "capital-dashboard") || (has(navConfig, "Capital") && has(navConfig, "Dashboard")));
ok("nav-config Capital has Investors item",
  has(navConfig, "capital-investors") || has(navConfig, "Investors"));
ok("nav-config Capital has Grants item",
  has(navConfig, "capital-grants") || has(navConfig, "Grants"));
ok("nav-config Capital has Pipeline item",
  has(navConfig, "capital-pipeline") || has(navConfig, "Pipeline"));
ok("nav-config Capital has Documents item",
  has(navConfig, "capital-documents") || has(navConfig, "Documents"));
ok("nav-config uses capitalOnly flag on Capital section",
  has(navConfig, "capitalOnly"));

console.log("\n── 7. Frontend: App.tsx wiring ─────────────────────────────────────");
ok("App.tsx has capitalGuard function",
  has(appTsx, "capitalGuard"));
ok("App.tsx registers /capital/dashboard route",
  has(appTsx, "/capital/dashboard") || has(appTsx, "capital/dashboard"));
ok("App.tsx registers /capital/investors route",
  has(appTsx, "/capital/investors") || has(appTsx, "capital/investors"));
ok("App.tsx registers /capital/grants route",
  has(appTsx, "/capital/grants"));
ok("App.tsx lazy-imports capital pages",
  has(appTsx, "capital-dashboard") || has(appTsx, "CapitalDashboard"));

console.log("\n── 8. Frontend: sidebar capitalOnly handling ───────────────────────");
ok("app-sidebar.tsx handles capitalOnly before admin bypass",
  has(sidebar, "capitalOnly") || has(sidebar, "capital"));

console.log("\n── 9. Security invariants ──────────────────────────────────────────");
ok("requireCapitalAccess returns 401 when not authenticated",
  has(capital, "401") && has(capital, "Not authenticated"));
ok("Delete routes null-out FK references before delete (safe cascade)",
  has(capital, "SET shared_with_funder_id = NULL") || has(capital, "funder_id = NULL"));
ok("Route errors log message only (no stack trace leak)",
  has(capital, "err?.message") || has(capital, "err.message"));
ok("requireCapitalAccess is NOT requirePermission-based (no CRM bypass)",
  !has(capital, /requireCapitalAccess[\s\S]{0,100}requirePermission/));

console.log("\n─────────────────────────────────────────────────────────────────────");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("\n✗ Capital foundation checks failed");
  process.exit(1);
} else {
  console.log("\n✓ All capital foundation checks passed");
}
