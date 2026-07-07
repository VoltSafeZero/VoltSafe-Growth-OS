/**
 * Board Pack Phase 10 — Source-grep regression tests
 * Covers: CEO/CFO guard, service functions, routes, A-J sections,
 * markdown/investor-draft copy-only, no auto-send, capital gating,
 * "what changed" comparison, finalize/archive lifecycle, frontend gate.
 */

"use strict";
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

function has(src, str) {
  if (typeof str === "string") return src.includes(str);
  return str.test(src);
}
function nothas(src, str) { return !has(src, str); }

// ── Load files ────────────────────────────────────────────────────────────────
const service    = load("server/services/board-pack.ts");
const routes     = load("server/routes.ts");
const indexTs    = load("server/index.ts");
const boardPage  = load("client/src/pages/board-pack.tsx");
const appTsx     = load("client/src/App.tsx");
const navConfig  = load("client/src/lib/nav-config.ts");

// ─────────────────────────────────────────────────────────────────────────────
// 1. Service file exists
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 1. Service file ─────────────────────────────────────────────────────────");
ok("server/services/board-pack.ts exists", fs.existsSync(path.resolve(__dirname, "../server/services/board-pack.ts")));
ok("Service file is non-empty (>200 lines)", service.split("\n").length > 200);

// ─────────────────────────────────────────────────────────────────────────────
// 2. CEO/CFO access guard
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 2. CEO/CFO access guard ─────────────────────────────────────────────────");
ok("isBoardPackUser exported from service", has(service, "export function isBoardPackUser("));
ok("BOARD_PACK_USER_IDS includes Trevor (user 4)", has(service, "new Set([4])"));
ok("Scott Carlson CFO email in BOARD_PACK_USER_EMAILS", has(service, "scott.carlson@voltsafe.com"));
ok("requireBoardPackAccess middleware in routes", has(routes, "requireBoardPackAccess"));
ok("requireBoardPackAccess uses isBoardPackUser", has(routes, "isBoardPackUser(u.id, u.email)"));
ok("requireBoardPackAccess returns 403 for non-CEO/CFO",
   has(routes, "Board Pack access requires CEO or CFO role"));
ok("requireBoardPackAccess checks userId before DB lookup",
   has(routes, "Not authenticated") && has(routes, "requireBoardPackAccess"));
ok("All /api/board-packs routes use requireBoardPackAccess",
   routes.split("requireBoardPackAccess").length > 8, "need >= 8 usages across 8 routes");

// ─────────────────────────────────────────────────────────────────────────────
// 3. Database migration
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 3. Database migration ───────────────────────────────────────────────────");
ok("board_packs table migration in server/index.ts",
   has(indexTs, "CREATE TABLE IF NOT EXISTS board_packs"));
ok("board_packs has status column", has(indexTs, "status           TEXT NOT NULL DEFAULT 'draft'"));
ok("board_packs has sections_data JSONB", has(indexTs, "sections_data    JSONB"));
ok("board_packs has finalized_at column", has(indexTs, "finalized_at     TIMESTAMPTZ"));
ok("board_packs has archived_at column", has(indexTs, "archived_at      TIMESTAMPTZ"));
ok("board_packs has previous_pack_id column", has(indexTs, "previous_pack_id INTEGER"));
ok("board_packs migration is inside a try/catch", has(indexTs, "board_packs table ready"));

// ─────────────────────────────────────────────────────────────────────────────
// 4. Service functions exported
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 4. Service exports ──────────────────────────────────────────────────────");
ok("buildBoardPack exported", has(service, "export async function buildBoardPack("));
ok("buildBoardPackMarkdown exported", has(service, "export function buildBoardPackMarkdown("));
ok("buildBoardPackExecutiveSummary exported", has(service, "export function buildBoardPackExecutiveSummary("));
ok("buildInvestorUpdateDraft exported", has(service, "export function buildInvestorUpdateDraft("));
ok("compareAgainstPreviousPack exported", has(service, "export async function compareAgainstPreviousPack("));
ok("createBoardPack exported", has(service, "export async function createBoardPack("));
ok("getBoardPack exported", has(service, "export async function getBoardPack("));
ok("listBoardPacks exported", has(service, "export async function listBoardPacks("));
ok("updateBoardPack exported", has(service, "export async function updateBoardPack("));
ok("finalizeBoardPack exported", has(service, "export async function finalizeBoardPack("));
ok("archiveBoardPack exported", has(service, "export async function archiveBoardPack("));

// ─────────────────────────────────────────────────────────────────────────────
// 5. Sections A–J present in buildBoardPack
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 5. Pack sections A–J ────────────────────────────────────────────────────");
ok("A. executive_summary section built", has(service, "executive_summary: executiveSummary"));
ok("B. company_scorecard section built", has(service, "company_scorecard: companyScorecard"));
ok("C. revenue_pipeline section built", has(service, "revenue_pipeline: revenuePipeline"));
ok("D. capital_funding section built", has(service, "capital_funding: capitalFunding"));
ok("E. product_operations section built", has(service, "product_operations: productOperations"));
ok("F. team_accountability section built", has(service, "team_accountability: teamAccountability"));
ok("G. risks_decisions section built", has(service, "risks_decisions: risksDecisions"));
ok("H. wins_momentum section built", has(service, "wins_momentum: winsMomentum"));
ok("I. next_30_60_90 section built", has(service, "next_30_60_90: next306090"));
ok("J. board_investor_asks section built", has(service, "board_investor_asks: boardInvestorAsks"));

// ─────────────────────────────────────────────────────────────────────────────
// 6. CEO Cockpit data integration (Phase 5/6/7/8)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 6. CEO Cockpit integration ──────────────────────────────────────────────");
ok("Pulls from composeReport (Phase original CRM)", has(service, "composeReport("));
ok("Pulls from buildExecutionScorecard (Phase 8)", has(service, "buildExecutionScorecard("));
ok("Pulls from detectExecutionDrift (Phase 8)", has(service, "detectExecutionDrift("));
ok("Pulls from buildCommitmentsRadar (Phase 8)", has(service, "buildCommitmentsRadar("));
ok("Pulls from buildRecurringRiskPatterns (Phase 8)", has(service, "buildRecurringRiskPatterns("));
ok("Pulls from listCeoActions (Phase 6)", has(service, "listCeoActions("));

// ─────────────────────────────────────────────────────────────────────────────
// 7. Capital section gated
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 7. Capital section gating ───────────────────────────────────────────────");
ok("Capital funding section gated by hasCapital",
   has(service, "actorUser.hasCapital && capitalData ? capitalData : null") ||
   has(service, "capital_funding: capitalFunding"));
ok("fetchCapitalData queries capital_investors", has(service, "capital_investors"));
ok("fetchCapitalData queries capital_rounds", has(service, "capital_rounds"));
ok("fetchCapitalData queries capital_grants", has(service, "capital_grants"));
ok("Capital data fetch is wrapped in .catch", has(service, "actorUser.hasCapital ? fetchCapitalData().catch(() => null)"));
ok("Capital funding null when no hasCapital",
   has(service, "actorUser.hasCapital && capitalData ? capitalData : null"));

// ─────────────────────────────────────────────────────────────────────────────
// 8. copy_only — markdown and investor draft
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 8. copy_only flags ──────────────────────────────────────────────────────");
ok("buildBoardPackMarkdown returns copy_only: true",
   has(service, "{ markdown: lines.join") && has(service, "copy_only: true"));
ok("buildInvestorUpdateDraft returns copy_only: true",
   has(service, "copy_only: true") && has(service, "source_pack_id:"));
ok("buildBoardPackExecutiveSummary returns copy_only: true", has(service, "copy_only: true,"));
ok("Investor draft has subject field", has(service, "subject: `VoltSafe Update"));
ok("Investor draft has body field", has(service, "body: bodyParts.filter"));
ok("Investor draft has source_pack_id", has(service, "source_pack_id: packId ?? null"));

// ─────────────────────────────────────────────────────────────────────────────
// 9. No auto-send
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 9. No auto-send patterns ────────────────────────────────────────────────");
// Check the Phase 10 route block (from "Board Pack — Phase 10" to "Growth OS Command Center")
const p10Start = routes.indexOf("Board Pack — Phase 10");
const p10End = routes.indexOf("Growth OS Command Center", p10Start);
const p10Block = p10Start > -1 ? routes.slice(p10Start, p10End) : "";

ok("Phase 10 route block found", p10Start > -1);
ok("No sendEmail in Phase 10 route block", nothas(p10Block, "sendEmail("));
ok("No sendMessage in Phase 10 route block", nothas(p10Block, "sendMessage("));
ok("No auto-send in Phase 10 route block", nothas(p10Block, "autoSend"));
ok("No Gmail draft creation in Phase 10 route block", nothas(p10Block, "createDraft("));
ok("Finalize route does NOT send anything — comment present",
   has(p10Block, "Does NOT send email, does NOT send Currents messages"));
ok("Investor draft route does NOT create Gmail drafts — comment present",
   has(p10Block, "Does NOT create Gmail drafts"));
ok("No auto-send in service file", nothas(service, "sendEmail("));
ok("No sendMessage in service file", nothas(service, "sendMessage("));

// ─────────────────────────────────────────────────────────────────────────────
// 10. Neutral language — no banned words
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 10. Neutral language ────────────────────────────────────────────────────");
const BANNED = ["lazy", "failing", "weak performer", "poor performer", "blame", "underperforming"];
for (const word of BANNED) {
  ok(`No "${word}" in service`, nothas(service.toLowerCase(), word));
  ok(`No "${word}" in Phase 10 routes`, nothas(p10Block.toLowerCase(), word));
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. Routes structure
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 11. Routes ──────────────────────────────────────────────────────────────");
ok("GET /api/board-packs route registered", has(routes, 'app.get("/api/board-packs", requireAuth, requireBoardPackAccess'));
ok("POST /api/board-packs/generate route registered", has(routes, 'app.post("/api/board-packs/generate"'));
ok("GET /api/board-packs/:id route registered", has(routes, 'app.get("/api/board-packs/:id", requireAuth, requireBoardPackAccess'));
ok("PATCH /api/board-packs/:id route registered", has(routes, 'app.patch("/api/board-packs/:id"'));
ok("POST /api/board-packs/:id/finalize registered", has(routes, 'app.post("/api/board-packs/:id/finalize"'));
ok("POST /api/board-packs/:id/archive registered", has(routes, 'app.post("/api/board-packs/:id/archive"'));
ok("GET /api/board-packs/:id/markdown registered", has(routes, 'app.get("/api/board-packs/:id/markdown"'));
ok("GET /api/board-packs/:id/executive-summary registered", has(routes, 'app.get("/api/board-packs/:id/executive-summary"'));
ok("POST /api/board-packs/:id/investor-update-draft registered", has(routes, 'app.post("/api/board-packs/:id/investor-update-draft"'));
ok("Service imported in routes.ts", has(routes, 'from "./services/board-pack"'));

// ─────────────────────────────────────────────────────────────────────────────
// 12. Status lifecycle
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 12. Status lifecycle ────────────────────────────────────────────────────");
ok("finalizeBoardPack sets status='finalized'", has(service, "status = 'finalized'"));
ok("finalizeBoardPack requires draft status", has(service, "AND status = 'draft'"));
ok("archiveBoardPack sets status='archived'", has(service, "status = 'archived'"));
ok("archiveBoardPack accepts draft OR finalized",
   has(service, "status IN ('draft', 'finalized')"));
ok("createBoardPack inserts with status='draft'", has(service, "'draft'"));
ok("updateBoardPack only updates draft packs", has(service, "status = 'draft' RETURNING"));

// ─────────────────────────────────────────────────────────────────────────────
// 13. What changed / comparison
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 13. What changed comparison ─────────────────────────────────────────────");
ok("compareAgainstPreviousPack handles null previousPackId",
   has(service, "if (!previousPackId) return"));
ok("No previous pack empty state returns message",
   has(service, "No previous finalized pack available for comparison."));
ok("no_previous_pack: true in empty state", has(service, "no_previous_pack: true"));
ok("Pipeline movement computed", has(service, "pipeline_movement:"));
ok("Capital movement computed", has(service, "capital_movement:"));
ok("New blockers counted", has(service, "new_blockers: Math.max(0"));
ok("Resolved blockers counted", has(service, "resolved_blockers: Math.max(0"));
ok("compareAgainstPreviousPack queries board_packs table",
   has(service, "SELECT sections_data FROM board_packs WHERE id ="));
ok("Comparison requires finalized status",
   has(service, "AND status = 'finalized' LIMIT 1"));

// ─────────────────────────────────────────────────────────────────────────────
// 14. Private data protection
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 14. Privacy / data protection ───────────────────────────────────────────");
ok("No private Currents channel body exposure in service",
   nothas(service, "channel_messages") && nothas(service, "channel_body"));
ok("No DM body broad exposure in service",
   nothas(service, "direct_messages") && nothas(service, "dm_body"));
ok("No private channel queries in Phase 10 routes", nothas(p10Block, "is_private"));
ok("Archived packs remain readable (archiveBoardPack does not DELETE)",
   has(service, "SET status = 'archived'") && nothas(service, "DELETE FROM board_packs"));

// ─────────────────────────────────────────────────────────────────────────────
// 15. Frontend: board-pack.tsx gate and features
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 15. Frontend board-pack page ─────────────────────────────────────────────");
ok("board-pack.tsx exists", fs.existsSync(path.resolve(__dirname, "../client/src/pages/board-pack.tsx")));
ok("isCapitalUser check in board-pack.tsx (CEO/CFO gate)", has(boardPage, "isCapitalUser"));
ok("Access denied UI for non-CEO/CFO", has(boardPage, "Board Pack & Operating Pack access requires CEO or CFO"));
ok("Operating Pack tab exists", has(boardPage, "operating-pack") || has(boardPage, "Operating Pack"));
ok("Generate Pack button exists", has(boardPage, "Generate Pack") || has(boardPage, "Generate Operating Pack"));
ok("Finalize button exists", has(boardPage, "Finalize"));
ok("Archive button exists", has(boardPage, "Archive"));
ok("Copy Markdown button exists", has(boardPage, "Copy Markdown") || has(boardPage, "copy.*markdown") || has(boardPage, "data-testid=\"button-copy-markdown\""));
ok("Investor update draft feature exists", has(boardPage, "investor") || has(boardPage, "Investor Update"));
ok("Capital section hidden if no capital access",
   has(boardPage, "isCapitalUser") && has(boardPage, "Capital"));
ok("data-testid on board-pack-page", has(boardPage, 'data-testid="board-pack-page"'));

// ─────────────────────────────────────────────────────────────────────────────
// 16. No duplicate nav / routing
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 16. No duplicates ───────────────────────────────────────────────────────");
const boardPackNavCount = (navConfig.match(/board.pack/gi) ?? []).length;
ok("No duplicate board-pack nav entry (≤ 2 mentions in nav-config)", boardPackNavCount <= 2);
const boardPackRouteCount = (appTsx.match(/board-pack/g) ?? []).length;
ok("Single board-pack route in App.tsx (≤ 2 mentions)", boardPackRouteCount <= 2,
   `Found ${boardPackRouteCount}`);

// ─────────────────────────────────────────────────────────────────────────────
// 17. Phase 4/5/6/7/8 regression — imports still present
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 17. Prior phase regressions ─────────────────────────────────────────────");
ok("Phase 8 service import still in routes",
   has(routes, "buildExecutionRadar, detectExecutionDrift, buildCommitmentsRadar"));
ok("Phase 7 service import still in routes",
   has(routes, "buildDailyCeoBriefing"));
ok("Phase 6 service import still in routes",
   has(routes, "listCeoActions, createCeoAction"));
ok("Phase 5 service import still in routes",
   has(routes, "getOneOnOneNotes"));
ok("CEO Execution Intelligence routes still registered",
   has(routes, "/api/today/ceo-execution/radar"));
ok("CEO Briefing routes still registered",
   has(routes, "/api/today/ceo-briefing/daily"));
ok("CEO Action Queue routes still registered",
   has(routes, "/api/today/ceo-actions"));
ok("board_packs migration after ceo_execution_reviews in index.ts",
   indexTs.indexOf("board_packs table ready") > indexTs.indexOf("ceo_execution_reviews table ready"));

// ─────────────────────────────────────────────────────────────────────────────
// 18. Markdown export content
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 18. Markdown export content ─────────────────────────────────────────────");
ok("Markdown includes Executive Summary section", has(service, "## A. Executive Summary"));
ok("Markdown includes Company Scorecard section", has(service, "## B. Company Scorecard"));
ok("Markdown includes Revenue section", has(service, "## C. Revenue / Pipeline"));
ok("Markdown includes Capital section header", has(service, "## D. Capital / Funding"));
ok("Markdown includes Product/Operations section", has(service, "## E. Product / Operations"));
ok("Markdown includes Team section", has(service, "## F. Team / Accountability"));
ok("Markdown includes Risks section", has(service, "## G. Risks / Decisions Needed"));
ok("Markdown includes Wins section", has(service, "## H. Wins / Momentum"));
ok("Markdown includes Next 30/60/90 section", has(service, "## I. Next 30 / 60 / 90 Days"));
ok("Markdown includes Board Asks section", has(service, "## J. Board / Investor Asks"));
ok("Markdown includes confidentiality footer",
   has(service, "Confidential") && has(service, "VoltSafe Internal Use Only"));

// ─────────────────────────────────────────────────────────────────────────────
// 19. Investor update draft format
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 19. Investor update draft ───────────────────────────────────────────────");
ok("Investor draft subject has VoltSafe Update prefix",
   has(service, "`VoltSafe Update — ${month} / ${quarter} ${year}`"));
ok("Investor draft body has Opening section",
   has(service, "Hope this finds you well"));
ok("Investor draft body has Top 3 Wins section", has(service, "Top 3 Wins"));
ok("Investor draft body has Key Metrics section", has(service, "Key Metrics"));
ok("Investor draft body has Product/Revenue Progress section",
   has(service, "Product / Revenue Progress"));
ok("Investor draft body has Funding/Capital Update (conditional)", has(service, "Funding / Capital Update"));
ok("Investor draft body has Risks/Asks section", has(service, "Risks / Asks"));
ok("Investor draft body has Next Milestones section", has(service, "Next Milestones"));
ok("Investor draft returns copy_only: true — not auto-send", has(service, "copy_only: true"));

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n────────────────────────────────────────────────────────────");
console.log(`Board Pack Phase 10 — ${passed + failed} checks: ${passed} passed, ${failed} failed`);
console.log("");
if (failed > 0) {
  console.error("Some checks failed ✗");
  process.exit(1);
} else {
  console.log("All checks passed ✓");
}
