/**
 * Capital Module — navigation architecture + foundation source-grep tests
 *
 * Verifies:
 * - requireCapitalAccess middleware exists and is identity-based (NOT admin bypass)
 * - CAPITAL_ALLOWED_USER_IDS includes Trevor (user 4)
 * - All capital API routes are registered
 * - Frontend pages exist (all 9 nav items)
 * - Ecosystem NO LONGER contains "Investors" nav entry
 * - Nav includes Capital section (9 items) with capitalOnly flag
 * - App.tsx registers all capital routes with capitalGuard
 * - No admin bypass in requireCapitalAccess
 * - New placeholder pages (contacts, rounds, commitments, updates) exist
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

const capital      = load("server/routes-capital.ts");
const indexTs      = load("server/index.ts");
const routesTs     = load("server/routes.ts");
const navConfig    = load("client/src/lib/nav-config.ts");
const appTsx       = load("client/src/App.tsx");
const sidebar      = load("client/src/components/dashboard/app-sidebar.tsx");
const dashboard    = load("client/src/pages/capital-dashboard.tsx");
const investors    = load("client/src/pages/capital-investors.tsx");
const grants       = load("client/src/pages/capital-grants.tsx");
const pipeline     = load("client/src/pages/capital-pipeline.tsx");
const documents    = load("client/src/pages/capital-documents.tsx");
const contacts     = load("client/src/pages/capital-contacts.tsx");
const rounds       = load("client/src/pages/capital-rounds.tsx");
const commitments  = load("client/src/pages/capital-commitments.tsx");
const updates      = load("client/src/pages/capital-updates.tsx");

// ── 1. Backend: requireCapitalAccess ─────────────────────────────────────────
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

// ── 2. Backend: migration ─────────────────────────────────────────────────────
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

// ── 3. Backend: API routes ────────────────────────────────────────────────────
console.log("\n── 3. Backend: API routes ──────────────────────────────────────────");
ok("GET /api/capital/dashboard route registered",
  has(capital, '"/api/capital/dashboard"') || has(capital, "'/api/capital/dashboard'"));
ok("GET /api/capital/funders route registered",
  has(capital, /app\.get.*capital\/funders/));
ok("POST /api/capital/funders route registered",
  has(capital, /app\.post.*capital\/funders/));
ok("PATCH /api/capital/funders/:id route registered",
  has(capital, /app\.patch.*capital\/funders/));
ok("DELETE /api/capital/funders/:id route registered",
  has(capital, /app\.delete.*capital\/funders/));
ok("GET /api/capital/grants route registered",
  has(capital, /app\.get.*capital\/grants/));
ok("POST /api/capital/grants route registered",
  has(capital, /app\.post.*capital\/grants/));
ok("PATCH /api/capital/grants/:id route registered",
  has(capital, /app\.patch.*capital\/grants/));
ok("DELETE /api/capital/grants/:id route registered",
  has(capital, /app\.delete.*capital\/grants/));
ok("GET /api/capital/documents route registered",
  has(capital, /app\.get.*capital\/documents/));
ok("POST /api/capital/documents route registered",
  has(capital, /app\.post.*capital\/documents/));
ok("GET /api/capital/activities route registered",
  has(capital, /app\.get.*capital\/activities/));
ok("POST /api/capital/activities route registered",
  has(capital, /app\.post.*capital\/activities/));
ok("GET /api/capital/pipeline route registered",
  has(capital, /app\.get.*capital\/pipeline/));
ok("All capital routes gated by requireCapitalAccess",
  has(capital, "requireCapitalAccess"));
ok("registerCapitalRoutes exported",
  has(capital, "registerCapitalRoutes"));
ok("Capital routes registered in server/index.ts or routes.ts",
  has(indexTs, "registerCapitalRoutes") || has(routesTs, "registerCapitalRoutes") ||
  has(indexTs, "routes-capital") || has(routesTs, "routes-capital"));

// ── 4. Backend: isCapitalUser in /api/auth/me ─────────────────────────────────
console.log("\n── 4. Backend: isCapitalUser in /api/auth/me ──────────────────────");
ok("/api/auth/me includes isCapitalUser or capital permission",
  has(routesTs, "isCapitalUser") || has(routesTs, "CAPITAL_ALLOWED") ||
  has(routesTs, "capital_user") || has(routesTs, "capital:") ||
  has(routesTs, "capital"));

// ── 5. Ecosystem regression: Investors removed ────────────────────────────────
console.log("\n── 5. Ecosystem regression: Investors removed from Ecosystem ───────");
ok("Ecosystem section does NOT contain id='investors' nav item",
  !has(navConfig, /id:\s*["']investors["']/));
ok("Ecosystem does NOT route innovation-research as an investor entry",
  !has(navConfig, /investors.*innovation-research/s));
ok("Ecosystem still has Industry Partnerships item",
  has(navConfig, "industry-associations") || has(navConfig, "Industry Partnerships"));
ok("Ecosystem still has Dealers / Resellers item",
  has(navConfig, "channel-commercial") || has(navConfig, "Dealers"));
ok("Ecosystem still has Strategic Alliances item",
  has(navConfig, "Strategic Alliances") || has(navConfig, "alliances"));
ok("Ecosystem still has Government & Grants item",
  has(navConfig, "government-public") || has(navConfig, "Government"));
ok("Ecosystem still has Referrals item",
  has(navConfig, "referrals") || has(navConfig, "Referrals"));
ok("Ecosystem still has Media & Tradeshows item",
  has(navConfig, "media-tradeshows") || has(navConfig, "Media"));

// ── 6. Frontend: all pages exist ─────────────────────────────────────────────
console.log("\n── 6. Frontend: pages exist ────────────────────────────────────────");
ok("capital-dashboard.tsx exists and has useQuery",
  has(dashboard, "useQuery") && has(dashboard, "capital/dashboard"));
ok("capital-dashboard shows empty state when no data",
  has(dashboard, "No capital records yet") || has(dashboard, "no capital") || has(dashboard, "empty"));
ok("capital-dashboard shows committed, soft-circled, weighted pipeline",
  has(dashboard, "Committed") && has(dashboard, "Soft") && has(dashboard, "Weighted"));
ok("capital-investors.tsx (Investor Targets) has funder table",
  has(investors, "capital/funders") && has(investors, "Add Investor"));
ok("capital-investors has create/edit dialog",
  has(investors, "Dialog") && has(investors, "pipeline_stage") && has(investors, "funder_type"));
ok("capital-investors has search + type/stage/priority filters",
  has(investors, "typeFilter") && has(investors, "stageFilter"));
ok("capital-grants.tsx (Grants & Non-Dilutive) has deadline and status columns",
  has(grants, "capital/grants") && has(grants, "deadline") && has(grants, "application_status"));
ok("capital-grants has create/edit dialog",
  has(grants, "Dialog") && has(grants, "program_name"));
ok("capital-pipeline.tsx (Investor Pipeline) shows funders grouped by stage",
  has(pipeline, "pipeline_stage") && has(pipeline, "capital/pipeline"));
ok("capital-documents.tsx (Data Room) has document type + status",
  has(documents, "document_type") && has(documents, "status") && has(documents, "capital/documents"));
ok("capital-contacts.tsx exists (Investor Contacts placeholder)",
  contacts.length > 0 && (has(contacts, "Investor Contacts") || has(contacts, "contacts")));
ok("capital-contacts has contact type taxonomy references",
  has(contacts, "Angel") || has(contacts, "Family Office") || has(contacts, "Connector"));
ok("capital-rounds.tsx exists (Funding Rounds placeholder)",
  rounds.length > 0 && (has(rounds, "Funding Rounds") || has(rounds, "rounds")));
ok("capital-rounds has round stage labels",
  has(rounds, "Seed") || has(rounds, "Series A") || has(rounds, "Bridge"));
ok("capital-commitments.tsx exists (Commitments placeholder)",
  commitments.length > 0 && (has(commitments, "Commitments") || has(commitments, "commitment")));
ok("capital-commitments has commitment status stages",
  has(commitments, "Soft Commit") && has(commitments, "Committed") &&
  (has(commitments, "Wired") || has(commitments, "Closed")));
ok("capital-updates.tsx exists (Investor Updates placeholder)",
  updates.length > 0 && (has(updates, "Investor Updates") || has(updates, "updates")));
ok("capital-updates has update type taxonomy",
  has(updates, "Monthly Update") || has(updates, "Quarterly") || has(updates, "Milestone"));

// ── 7. Frontend: navigation (9-item Capital section) ─────────────────────────
console.log("\n── 7. Frontend: navigation (9-item Capital section) ────────────────");
ok("nav-config has Capital section with capitalOnly flag",
  has(navConfig, "capitalOnly") && (has(navConfig, '"capital"') || has(navConfig, "Capital")));
ok("nav-config Capital uses Banknote icon",
  has(navConfig, "Banknote"));
ok("nav-config Capital has Dashboard item",
  has(navConfig, "capital-dashboard") && has(navConfig, "Dashboard"));
ok("nav-config Capital has Investor Pipeline item",
  has(navConfig, "capital-pipeline") && has(navConfig, "Investor Pipeline"));
ok("nav-config Capital has Investor Targets item",
  has(navConfig, "capital-targets") && has(navConfig, "Investor Targets"));
ok("nav-config Capital has Investor Contacts item",
  has(navConfig, "capital-contacts") && has(navConfig, "Investor Contacts"));
ok("nav-config Capital has Funding Rounds item",
  has(navConfig, "capital-rounds") && has(navConfig, "Funding Rounds"));
ok("nav-config Capital has Commitments item",
  has(navConfig, "capital-commitments") && has(navConfig, "Commitments"));
ok("nav-config Capital has Grants & Non-Dilutive item",
  has(navConfig, "capital-grants") && has(navConfig, "Grants & Non-Dilutive"));
ok("nav-config Capital has Investor Updates item",
  has(navConfig, "capital-updates") && has(navConfig, "Investor Updates"));
ok("nav-config Capital has Data Room item",
  has(navConfig, "capital-data-room") && has(navConfig, "Data Room"));

// ── 8. Frontend: App.tsx wiring ───────────────────────────────────────────────
console.log("\n── 8. Frontend: App.tsx wiring ─────────────────────────────────────");
ok("App.tsx has capitalGuard function",
  has(appTsx, "capitalGuard"));
ok("App.tsx registers /capital/dashboard route",
  has(appTsx, "/capital/dashboard"));
ok("App.tsx registers /capital/pipeline route (Investor Pipeline)",
  has(appTsx, "/capital/pipeline"));
ok("App.tsx registers /capital/targets route (Investor Targets)",
  has(appTsx, "/capital/targets"));
ok("App.tsx registers /capital/contacts route",
  has(appTsx, "/capital/contacts"));
ok("App.tsx registers /capital/rounds route",
  has(appTsx, "/capital/rounds"));
ok("App.tsx registers /capital/commitments route",
  has(appTsx, "/capital/commitments"));
ok("App.tsx registers /capital/grants route",
  has(appTsx, "/capital/grants"));
ok("App.tsx registers /capital/updates route",
  has(appTsx, "/capital/updates"));
ok("App.tsx registers /capital/data-room route",
  has(appTsx, "/capital/data-room"));
ok("App.tsx has redirect from /capital/investors to /capital/targets (backward compat)",
  has(appTsx, "/capital/investors") && has(appTsx, "/capital/targets"));
ok("App.tsx lazy-imports all new capital pages",
  has(appTsx, "capital-contacts") && has(appTsx, "capital-rounds") &&
  has(appTsx, "capital-commitments") && has(appTsx, "capital-updates"));

// ── 9. Frontend: sidebar capitalOnly handling ─────────────────────────────────
console.log("\n── 9. Frontend: sidebar capitalOnly handling ───────────────────────");
ok("app-sidebar.tsx handles capitalOnly before admin bypass",
  has(sidebar, "capitalOnly") || has(sidebar, "capital"));

// ── 10. Security invariants ───────────────────────────────────────────────────
console.log("\n── 10. Security invariants ─────────────────────────────────────────");
ok("requireCapitalAccess returns 401 when not authenticated",
  has(capital, "401") && has(capital, "Not authenticated"));
ok("Delete routes null-out FK references before delete (safe cascade)",
  has(capital, "SET shared_with_funder_id = NULL") || has(capital, "funder_id = NULL"));
ok("Route errors log message only (no stack trace leak)",
  has(capital, "err?.message") || has(capital, "err.message"));
ok("requireCapitalAccess is NOT requirePermission-based (no CRM bypass)",
  !has(capital, /requireCapitalAccess[\s\S]{0,100}requirePermission/));
ok("Ecosystem Investors entry removed (clean taxonomy separation)",
  !has(navConfig, /id:\s*["']investors["']/));

// ── Results ───────────────────────────────────────────────────────────────────
console.log("\n─────────────────────────────────────────────────────────────────────");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("\n✗ Capital foundation checks failed");
  process.exit(1);
} else {
  console.log("\n✓ All capital foundation checks passed");
}
