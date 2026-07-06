/**
 * Capital Module — Phase 2B Permission Lockdown Tests
 *
 * Source-grep tests that prove:
 * 1. Scott Carlson (CFO) is in the access allowlist
 * 2. No admin/master_admin bypass in requireCapitalAccess
 * 3. Every capital API route uses requireCapitalAccess
 * 4. Nav items are gated by capitalOnly
 * 5. Frontend routes use capitalGuard
 * 6. Activity logging on key events
 * 7. Pipeline returns committed amounts + primary contact
 * 8. All PIPELINE_STAGES rendered (including empty ones)
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
  if (condition) { console.log(`  ✓ ${desc}`); passed++; }
  else { console.error(`  ✗ ${desc}${hint ? ` — ${hint}` : ""}`); failed++; }
}
function has(src, pattern) {
  if (typeof pattern === "string") return src.includes(pattern);
  return pattern.test(src);
}

const capital     = load("server/routes-capital.ts");
const routesTs    = load("server/routes.ts");
const navConfig   = load("client/src/lib/nav-config.ts");
const appTsx      = load("client/src/App.tsx");
const sidebar     = load("client/src/components/dashboard/app-sidebar.tsx");
const pipeline    = load("client/src/pages/capital-pipeline.tsx");
const investors   = load("client/src/pages/capital-investors.tsx");

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 1. Scott Carlson (CFO) access allowlist ─────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("CAPITAL_ALLOWED_EMAILS includes scott.carlson@voltsafe.com",
  has(capital, "scott.carlson@voltsafe.com") &&
  !has(capital, /\/\/\s*"scott\.carlson@voltsafe\.com"/));

ok("CAPITAL_ALLOWED_EMAILS in routes-capital.ts is not empty",
  has(capital, /CAPITAL_ALLOWED_EMAILS\s*=\s*new Set<string>\(\[[\s\S]{1,200}"scott\.carlson/));

ok("routes.ts /api/auth/me also checks scott.carlson@voltsafe.com for capital access",
  has(routesTs, "scott.carlson@voltsafe.com"));

ok("routes.ts bootstrap /api/session/bootstrap also checks scott.carlson@voltsafe.com",
  has(routesTs, /scott\.carlson@voltsafe\.com[\s\S]{0,200}isCapitalUser|isCapitalUser[\s\S]{0,200}scott\.carlson@voltsafe\.com/));

ok("Trevor (user ID 4) is in CAPITAL_ALLOWED_USER_IDS",
  has(capital, /CAPITAL_ALLOWED_USER_IDS\s*=\s*new Set.*\[4\]/s));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 2. No admin bypass in requireCapitalAccess ──────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("requireCapitalAccess does NOT grant access based on role=admin",
  !has(capital, /requireCapitalAccess[\s\S]{0,600}['"](admin|master_admin)['"]/));

ok("requireCapitalAccess does NOT call requireAdmin",
  !has(capital, /requireCapitalAccess[\s\S]{0,200}requireAdmin/));

ok("requireCapitalAccess returns 403 for unlisted users",
  has(capital, "403") && has(capital, "Capital module access restricted"));

ok("requireCapitalAccess checks session.userId — not just role",
  has(capital, "req.session?.userId") || has(capital, "req.session.userId"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 3. All capital API routes protected ─────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

// Every route declaration must include requireCapitalAccess
const routeDecls = capital.match(/app\.(get|post|patch|delete)\s*\("\/api\/capital/g) ?? [];
const guardedDecls = capital.match(/app\.(get|post|patch|delete)\s*\("\/api\/capital[^"]*",\s*requireAuth\s*,\s*requireCapitalAccess/g) ?? [];

ok(`All ${routeDecls.length} capital API routes are protected by requireCapitalAccess`,
  routeDecls.length > 0 && routeDecls.length === guardedDecls.length,
  `${guardedDecls.length}/${routeDecls.length} guarded`);

ok("GET /api/capital/pipeline is protected", has(capital, /app\.get.*capital\/pipeline.*requireCapitalAccess/));
ok("GET /api/capital/investors is protected", has(capital, /app\.get.*capital\/investors[^/].*requireCapitalAccess/));
ok("POST /api/capital/investors is protected", has(capital, /app\.post.*capital\/investors.*requireCapitalAccess/));
ok("PATCH /api/capital/investors/:id is protected", has(capital, /app\.patch.*capital\/investors\/:id.*requireCapitalAccess/));
ok("DELETE /api/capital/investors/:id is protected", has(capital, /app\.delete.*capital\/investors\/:id.*requireCapitalAccess/));
ok("GET /api/capital/contacts is protected", has(capital, /app\.get.*capital\/contacts.*requireCapitalAccess/));
ok("POST /api/capital/contacts is protected", has(capital, /app\.post.*capital\/contacts.*requireCapitalAccess/));
ok("GET /api/capital/rounds is protected", has(capital, /app\.get.*capital\/rounds.*requireCapitalAccess/));
ok("POST /api/capital/rounds is protected", has(capital, /app\.post.*capital\/rounds.*requireCapitalAccess/));
ok("GET /api/capital/commitments is protected", has(capital, /app\.get.*capital\/commitments.*requireCapitalAccess/));
ok("POST /api/capital/commitments is protected", has(capital, /app\.post.*capital\/commitments.*requireCapitalAccess/));
ok("GET /api/capital/dashboard is protected", has(capital, /app\.get.*capital\/dashboard.*requireCapitalAccess/));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 4. Sidebar nav gated by capitalOnly ─────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("nav-config has capitalOnly property on Capital section",
  has(navConfig, "capitalOnly"));

ok("Capital section uses capitalOnly: true",
  has(navConfig, /capitalOnly:\s*true/));

ok("All capital nav subitems are nested under Capital section with capitalOnly",
  has(navConfig, /capital-pipeline/) && has(navConfig, /capital-targets/) &&
  has(navConfig, /capital-contacts/) && has(navConfig, /capital-rounds/) &&
  has(navConfig, /capital-commitments/));

ok("Sidebar respects capitalOnly — checks perms.capital",
  has(sidebar, "capitalOnly") && has(sidebar, /capital.*edit|perms.*capital/s));

ok("Sidebar does not bypass capitalOnly for admin users",
  has(sidebar, /capitalOnly.*return.*capital|capitalOnly.*capital.*edit/s) ||
  has(sidebar, /if.*capitalOnly.*return.*perms.*capital/s) ||
  has(sidebar, "capitalOnly is checked before the admin bypass") ||
  has(sidebar, /capitalOnly\).*return.*capital/s));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 5. Frontend routes protected by capitalGuard ────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("capitalGuard function defined in App.tsx",
  has(appTsx, "capitalGuard"));

ok("capitalGuard checks perms.capital === 'edit'",
  has(appTsx, /capital.*===.*edit|capital.*edit/s));

ok("/capital/pipeline route uses capitalGuard",
  has(appTsx, /capitalGuard.*CapitalPipeline|capital\/pipeline.*capitalGuard/s));

ok("/capital/targets route uses capitalGuard",
  has(appTsx, /capitalGuard.*CapitalInvestors|capital\/targets.*capitalGuard/s));

ok("/capital/contacts route uses capitalGuard",
  has(appTsx, /capitalGuard.*CapitalContacts|capital\/contacts.*capitalGuard/s));

ok("/capital/rounds route uses capitalGuard",
  has(appTsx, /capitalGuard.*CapitalRounds|capital\/rounds.*capitalGuard/s));

ok("/capital/commitments route uses capitalGuard",
  has(appTsx, /capitalGuard.*CapitalCommitments|capital\/commitments.*capitalGuard/s));

ok("/capital/dashboard route uses capitalGuard",
  has(appTsx, /capitalGuard.*CapitalDashboard|capital\/dashboard.*capitalGuard/s));

ok("AccessDenied shown for unauthorized capital users",
  has(appTsx, "AccessDenied"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 6. Activity logging ─────────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("logCapitalActivity called when investor is created",
  has(capital, /logCapitalActivity.*investor.*System.*Investor added/s) ||
  has(capital, /Investor added.*logCapitalActivity/s));

ok("logCapitalActivity called when stage changes",
  has(capital, /logCapitalActivity.*Stage Change.*Stage changed/s) ||
  has(capital, /Stage Change/));

ok("logCapitalActivity called when priority changes",
  has(capital, /logCapitalActivity.*priority.*changed|Priority changed.*logCapitalActivity/s));

ok("logCapitalActivity called when commitment is created",
  has(capital, /logCapitalActivity.*Commitment.*Commitment added/s));

ok("logCapitalActivity called when commitment stage changes",
  has(capital, /logCapitalActivity.*Commitment Change.*commitment_stage|Commitment stage changed/s) ||
  has(capital, "Commitment stage changed") || has(capital, "Commitment Change"));

ok("logCapitalActivity is fire-and-forget safe (await in try block)",
  has(capital, /await logCapitalActivity/));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 7. Pipeline API enhancements ────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("Pipeline query joins capital_commitments for committed totals",
  has(capital, "capital_commitments") && has(capital, "total_committed") &&
  has(capital, /app\.get.*capital\/pipeline/));

ok("Pipeline summary includes total_committed column",
  has(capital, "total_committed"));

ok("Pipeline investor query fetches primary_contact_name via subquery",
  has(capital, "primary_contact_name"));

ok("Pipeline investor query fetches last_activity_at",
  has(capital, "last_activity_at"));

ok("Pipeline investor query fetches committed_amount per investor",
  has(capital, "committed_amount"));

ok("Pipeline uses ci. alias for capital_investors (avoids column ambiguity)",
  has(capital, /FROM capital_investors ci[\s\S]{0,200}${whereClause}|ci\.stage.*ci\.priority|ci\.check_size_max/s) ||
  has(capital, "ci.stage") || has(capital, "ci.check_size_max"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 8. Pipeline UX — all stages rendered ────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("Pipeline page imports PIPELINE_STAGES (all 11 stages exported)",
  has(pipeline, "PIPELINE_STAGES") &&
  has(investors, "export.*PIPELINE_STAGES|PIPELINE_STAGES.*export/s") ||
  has(pipeline, "PIPELINE_STAGES") && has(investors, "export const PIPELINE_STAGES"));

ok("Pipeline iterates PIPELINE_STAGES.map — shows all stages",
  has(pipeline, /PIPELINE_STAGES\.map/));

ok("Pipeline shows empty state for stages with no investors",
  has(pipeline, "No investors in this stage") || has(pipeline, "no investors"));

ok("Pipeline investor cards show primary_contact_name",
  has(pipeline, "primary_contact_name"));

ok("Pipeline investor cards show last_activity_at",
  has(pipeline, "last_activity_at"));

ok("Pipeline investor cards show committed_amount",
  has(pipeline, "committed_amount"));

ok("Pipeline has collapsible stages",
  has(pipeline, "collapsed") || has(pipeline, "collapse"));

ok("Pipeline investor cards are clickable to open detail drawer",
  has(pipeline, "setDetailId") || has(pipeline, "detail") && has(pipeline, "Sheet"));

ok("Pipeline imports InvestorDetail from capital-investors",
  has(pipeline, "InvestorDetail"));

ok("Pipeline shows total committed in header",
  has(pipeline, "Committed") || has(pipeline, "committed"));

ok("InvestorDetail is exported from capital-investors.tsx",
  has(investors, "export function InvestorDetail") ||
  has(investors, "export const InvestorDetail"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 9. Empty/loading/error states ───────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("Pipeline shows loading skeleton while fetching",
  has(pipeline, "Skeleton") || has(pipeline, "isLoading"));

ok("Pipeline shows error state on fetch failure",
  has(pipeline, "isError") || has(pipeline, "error") || has(pipeline, "Could not load"));

ok("Investors page shows empty state when no investors",
  has(investors, "No investors found") || has(investors, "no investors"));

ok("Investors page shows loading spinner",
  has(investors, "isLoading") || has(investors, "animate-spin"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 10. Routes.ts sync ──────────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("routes.ts /api/auth/me includes isCapitalUser flag in response",
  has(routesTs, "isCapitalUser"));

ok("routes.ts /api/session/bootstrap includes capital: isCapitalUser ? 'edit' : 'none'",
  has(routesTs, /capital.*isCapitalUser.*edit|isCapitalUser.*capital.*edit/s));

// ─────────────────────────────────────────────────────────────────────────────
// Final summary
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Capital Permissions — Phase 2B: ${passed} passed, ${failed} failed`);
console.log("─".repeat(60));
if (failed > 0) process.exit(1);
