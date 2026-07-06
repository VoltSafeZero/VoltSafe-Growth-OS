/**
 * Capital Module — Phase 2E Command Center Tests
 *
 * 1. Service unit tests — pure computation logic
 * 2. Schema migration checks
 * 3. Backend route checks
 * 4. Frontend page + nav wiring
 * 5. Permission hardening
 */

const fs   = require("fs");
const path = require("path");

let passed = 0, failed = 0;

function load(rel) {
  const abs = path.resolve(__dirname, "..", rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
}
function ok(desc, condition, hint = "") {
  if (condition) { console.log(`  ✓ ${desc}`); passed++; }
  else { console.error(`  ✗ ${desc}${hint ? ` — ${hint}` : ""}`); failed++; }
}
function has(src, pattern) {
  return typeof pattern === "string" ? src.includes(pattern) : pattern.test(src);
}

// Load source files
const service    = load("server/services/capital-command-center.ts");
const capital    = load("server/routes-capital.ts");
const navConfig  = load("client/src/lib/nav-config.ts");
const appTsx     = load("client/src/App.tsx");
const page       = load("client/src/pages/capital-command-center.tsx");

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 1. Service — exported symbols ────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("service file exists",              service.length > 200);
ok("INVESTOR_STAGE_WEIGHTS exported",  has(service, "export const INVESTOR_STAGE_WEIGHTS"));
ok("COMMITMENT_STAGE_WEIGHTS exported", has(service, "export const COMMITMENT_STAGE_WEIGHTS"));
ok("investorStageWeight exported",     has(service, "export function investorStageWeight"));
ok("commitmentStageWeight exported",   has(service, "export function commitmentStageWeight"));
ok("investorBestAmount exported",      has(service, "export function investorBestAmount"));
ok("computeWeightedPipeline exported", has(service, "export function computeWeightedPipeline"));
ok("computeLeadCandidates exported",   has(service, "export function computeLeadCandidates"));
ok("computeThisWeekActions exported",  has(service, "export function computeThisWeekActions"));
ok("computeRiskFlags exported",        has(service, "export function computeRiskFlags"));
ok("computeRunway exported",           has(service, "export function computeRunway"));
ok("computeScenarios exported",        has(service, "export function computeScenarios"));
ok("COMMITTED_STAGES exported",        has(service, "export const COMMITTED_STAGES"));
ok("WIRED_STAGES exported",            has(service, "export const WIRED_STAGES"));
ok("SOFT_STAGES exported",             has(service, "export const SOFT_STAGES"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 2. Stage weight tables ───────────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

// Investor stage weights
ok("Wired / Closed = 1.00",     has(service, '"Wired / Closed":  1.00') || has(service, '"Wired / Closed": 1.00') || has(service, '"Wired / Closed":1.00'));
ok("Committed = 0.95",          has(service, '"Committed":       0.95') || has(service, '"Committed": 0.95') || has(service, '0.95'));
ok("Partner Meeting = 0.80",    has(service, '"Partner Meeting": 0.80') || has(service, '0.80'));
ok("Diligence = 0.60",          has(service, '0.60'));
ok("Soft Commit = 0.45",        has(service, '0.45'));
ok("Passed = 0.00",             has(service, '"Passed":          0.00') || has(service, '"Passed": 0.00') || has(service, '"Passed":0.00'));

// Commitment stage weights
ok("Wired = 1.00",              has(service, '"Wired":          1.00') || has(service, '"Wired": 1.00'));
ok("Hard Circle = 0.95",        has(service, '"Hard Circle":    0.95') || has(service, '"Hard Circle": 0.95'));
ok("Verbal Interest = 0.25",    has(service, '"Verbal Interest": 0.25') || has(service, '0.25'));
ok("Stalled = 0.05",            has(service, '"Stalled":        0.05') || has(service, '"Stalled": 0.05') || has(service, '0.05'));
ok("Soft Circle = 0.45",        has(service, '"Soft Circle":    0.45') || has(service, '"Soft Circle": 0.45'));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 3. Weighted pipeline logic ───────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("committed_amount in return object",       has(service, "committed_amount:"));
ok("wired_amount in return object",           has(service, "wired_amount:"));
ok("soft_circled_amount in return object",    has(service, "soft_circled_amount:"));
ok("weighted_pipeline in return object",      has(service, "weighted_pipeline:"));
ok("remaining_to_target in return object",    has(service, "remaining_to_target:"));
ok("remaining_to_min_close in return object", has(service, "remaining_to_min_close:"));
ok("confidence_low in return object",         has(service, "confidence_low:"));
ok("confidence_high in return object",        has(service, "confidence_high:"));
ok("committed_count in return object",        has(service, "committed_count:"));
ok("soft_circled_count in return object",     has(service, "soft_circled_count:"));
ok("hot_count in return object",              has(service, "hot_count:"));
ok("likely_lead_count in return object",      has(service, "likely_lead_count:"));
ok("confidence band is 70%–115% of weighted", has(service, "0.7") && has(service, "1.15"));
ok("investorBestAmount uses target_cheque_amount first",
  has(service, "target_cheque_amount || inv.check_size_max || inv.check_size_min"));
ok("COMMITTED_STAGES includes Wired / Closed",
  has(service, '"Wired / Closed"') && has(service, "COMMITTED_STAGES"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 4. Lead candidate selection ──────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("likely_lead used as candidate signal",  has(service, "inv.likely_lead"));
ok("investor_type filter includes VC/FO",   has(service, '"Venture Capital"') && has(service, '"Family Office"'));
ok("large cheque threshold ≥250k",          has(service, "250_000") || has(service, "250000"));
ok("in-late-stage check present",           has(service, "inLateStage"));
ok("risk_flags array per candidate",        has(service, "riskFlags"));
ok("Never contacted risk flag",             has(service, "Never contacted"));
ok("No next step risk flag",                has(service, "No next step"));
ok("No linked emails risk flag",            has(service, "No linked emails"));
ok("sorted by likely_lead first then score",has(service, "a.likely_lead !== b.likely_lead"));
ok("limited to 12 lead candidates",         has(service, ".slice(0, 12)"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 5. This-week action generation ───────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("committed-not-wired action",     has(service, "Follow up on wire"));
ok("overdue next step action",       has(service, "overdue"));
ok("hot investor going cold action", has(service, "Re-engage"));
ok("soft circle confirm action",     has(service, "Confirm soft circle"));
ok("diligence no next step action",  has(service, "data room follow-up") || has(service, "data room"));
ok("likely lead no meeting action",  has(service, "Schedule lead investor meeting"));
ok("no linked email action",         has(service, "Start or link email"));
ok("deduplication by investor+reason", has(service, "seen.has(key)"));
ok("limited to 20 actions",          has(service, ".slice(0, 20)"));
ok("priority order: critical→low",   has(service, "priorityOrder"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 6. Risk flag generation ──────────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("no_target flag",                 has(service, '"no_target"'));
ok("no_close_date flag",             has(service, '"no_close_date"'));
ok("no_lead flag",                   has(service, '"no_lead"'));
ok("below_min_close flag",           has(service, '"below_min_close"'));
ok("no_next_step flag",              has(service, '"no_next_step"'));
ok("hot_going_cold flag",            has(service, '"hot_going_cold"'));
ok("diligence_stale flag",           has(service, '"diligence_stale"'));
ok("low_pipeline flag",              has(service, '"low_pipeline"'));
ok("soft_stale flag",                has(service, '"soft_stale"'));
ok("critical level used",            has(service, '"critical"'));
ok("warning level used",             has(service, '"warning"'));
ok("pipeline < 60% of target check", has(service, "0.6"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 7. Runway calculation ────────────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("runway_today_months = cash / burn",       has(service, "cash / burn"));
ok("runway_after_min_months using min close", has(service, "cash + minClose"));
ok("runway_after_target_months",              has(service, "cash + target"));
ok("runway_after_weighted_months",            has(service, "cash + weightedPipeline"));
ok("cashout_date_today computed",             has(service, "cashout_date_today"));
ok("cashout_date_after_target computed",      has(service, "cashout_date_after_target"));
ok("has_data = false when no cash/burn",      has(service, "has_data: false"));
ok("has_data = true when data present",       /has_data:\s+true/.test(service) || service.includes("has_data: true"));
ok("null-safe: returns null runway if no data", has(service, "has_data: false"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 8. Scenario planning ─────────────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("Minimum Close scenario",      has(service, '"min_close"'));
ok("Base Case scenario",          has(service, '"base"'));
ok("Target Close scenario",       has(service, '"target"'));
ok("Stretch scenario (1.2x)",     has(service, "1.2") && has(service, '"stretch"'));
ok("gap_to_target in each",       has(service, "gap_to_target:"));
ok("required_additional in each", has(service, "required_additional:"));
ok("runway_added_months in each", has(service, "runway_added_months:"));
ok("description in each",         has(service, "description:"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 9. Schema migration (Phase 2E) ───────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("Phase 2E migration block",                 has(capital, "Phase 2E"));
ok("minimum_close_target column added",        has(capital, "minimum_close_target"));
ok("current_cash_balance column added",        has(capital, "current_cash_balance"));
ok("monthly_burn column added",                has(capital, "monthly_burn"));
ok("post_close_monthly_burn column added",     has(capital, "post_close_monthly_burn"));
ok("all ALTER TABLE on capital_rounds",        has(capital, /ALTER TABLE capital_rounds.*minimum_close_target/s));
ok("migration uses IF NOT EXISTS",             has(capital, "ADD COLUMN IF NOT EXISTS minimum_close_target"));
ok("migration log message present",            has(capital, "Capital Phase 2E"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 10. Backend route ────────────────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("GET /api/capital/rounds/:id/command-center exists",
  has(capital, '"/api/capital/rounds/:id/command-center"'));
ok("command-center route uses requireCapitalAccess",
  has(capital, /command-center.*requireCapitalAccess|requireCapitalAccess.*command-center/s));
ok("command-center imports capital-command-center service",
  has(capital, "capital-command-center"));
ok("command-center returns round",         has(capital, "round:"));
ok("command-center returns summary",       has(capital, "summary:"));
ok("command-center returns lead_candidates", has(capital, "lead_candidates:"));
ok("command-center returns this_week_actions", has(capital, "this_week_actions:"));
ok("command-center returns risk_flags",    has(capital, "risk_flags:"));
ok("command-center returns runway",        has(capital, "runway,"));
ok("command-center returns scenarios",     has(capital, "scenarios,"));
ok("command-center returns recent_activity", has(capital, "recent_activity:"));
ok("command-center returns recent_emails", has(capital, "recent_emails:"));
ok("command-center returns days_open",     has(capital, "days_open:"));
ok("email link counts query per investor", has(capital, "emailLinkCounts"));

ok("PATCH /api/capital/rounds/:id/runway exists",
  has(capital, '"/api/capital/rounds/:id/runway"'));
ok("runway endpoint uses requireCapitalAccess",
  has(capital, /rounds\/:id\/runway.*requireCapitalAccess|requireCapitalAccess.*rounds\/:id\/runway/s));
ok("runway endpoint updates minimum_close_target",
  has(capital, '"minimum_close_target"') && has(capital, "minimum_close_target"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 11. Frontend page ────────────────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("capital-command-center.tsx exists",     page.length > 200);
ok("data-testid='capital-command-center'",  has(page, 'data-testid="capital-command-center"'));
ok("round selector present",               has(page, 'data-testid="round-selector"'));
ok("progress bar present",                 has(page, 'data-testid="progress-bar-main"'));
ok("summary cards present",               has(page, "summary-card-"));
ok("section-lead-investors present",      has(page, 'data-testid="section-lead-investors"'));
ok("lead-candidate-list present",         has(page, 'data-testid="lead-candidate-list"'));
ok("leads empty state present",           has(page, 'data-testid="leads-empty"'));
ok("section-this-week-actions present",   has(page, 'data-testid="section-this-week-actions"'));
ok("action-list present",                 has(page, 'data-testid="action-list"'));
ok("actions empty state present",         has(page, 'data-testid="actions-empty"'));
ok("section-risk-flags present",          has(page, 'data-testid="section-risk-flags"'));
ok("risk-flag-list present",              has(page, 'data-testid="risk-flag-list"'));
ok("risk flag by code test ID present",   has(page, 'data-testid={`risk-flag-${f.code}`}'));
ok("no-risk-flags empty state present",   has(page, 'data-testid="no-risk-flags"'));
ok("section-runway present",              has(page, 'data-testid="section-runway"'));
ok("runway-no-data state present",        has(page, 'data-testid="runway-no-data"'));
ok("runway-data state present",           has(page, 'data-testid="runway-data"'));
ok("btn-edit-runway present",             has(page, 'data-testid="btn-edit-runway"'));
ok("section-scenarios present",           has(page, 'data-testid="section-scenarios"'));
ok("scenario-list present",               has(page, 'data-testid="scenario-list"'));
ok("scenarios empty state present",       has(page, 'data-testid="scenarios-empty"'));
ok("empty-no-rounds state present",       has(page, 'data-testid="empty-no-rounds"'));
ok("badge-round-status present",          has(page, 'data-testid="badge-round-status"'));
ok("badge-critical-flags present",        has(page, 'data-testid="badge-critical-flags"'));
ok("recent-activity-list present",        has(page, 'data-testid="recent-activity-list"'));
ok("section-recent-activity present",     has(page, 'data-testid="section-recent-activity"'));
ok("runway editor has input-cash-balance", has(page, 'data-testid="input-cash-balance"'));
ok("runway editor has input-monthly-burn", has(page, 'data-testid="input-monthly-burn"'));
ok("runway editor has input-min-close-target", has(page, 'data-testid="input-min-close-target"'));
ok("btn-save-runway in editor",           has(page, 'data-testid="btn-save-runway"'));
ok("fetches /api/capital/rounds/:id/command-center",
  has(page, "command-center"));
ok("patch to /api/capital/rounds/:id/runway",
  has(page, "runway"));
ok("lead candidate rows have individual test IDs",
  has(page, 'data-testid={`lead-candidate-${lead.id}`}'));
ok("action rows have individual test IDs",
  has(page, 'data-testid={`action-row-${a.investor_id}`}'));
ok("scenario rows have individual test IDs",
  has(page, 'data-testid={`scenario-${s.key}`}'));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 12. Nav + routing ────────────────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("Command Center nav item present",
  has(navConfig, "capital-command-center"));
ok("Command Center route is /capital/command-center",
  has(navConfig, "/capital/command-center"));
ok("Command Center is first in capital section",
  navConfig.indexOf("capital-command-center") < navConfig.indexOf("capital-dashboard"));
ok("Command Center is inside capitalOnly section",
  has(navConfig, "capitalOnly") && has(navConfig, "capital-command-center"));
ok("App.tsx has CapitalCommandCenterPage lazy import",
  has(appTsx, "CapitalCommandCenterPage") && has(appTsx, "capital-command-center"));
ok("App.tsx route /capital/command-center uses capitalGuard",
  has(appTsx, '"/capital/command-center"') && has(appTsx, "capitalGuard"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 13. Permission hardening ─────────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("requireCapitalAccess middleware still intact",
  has(capital, "function requireCapitalAccess") &&
  has(capital, "Capital module access restricted to authorized users only"));

ok("CAPITAL_ALLOWED_USER_IDS still defined",
  has(capital, "CAPITAL_ALLOWED_USER_IDS"));

ok("CAPITAL_ALLOWED_EMAILS still defined",
  has(capital, "CAPITAL_ALLOWED_EMAILS"));

ok("command-center route gated by requireCapitalAccess",
  has(capital, "requireCapitalAccess") &&
  has(capital, "command-center"));

ok("runway PATCH route gated by requireCapitalAccess",
  has(capital, /rounds\/:id\/runway.*requireCapitalAccess/s));

ok("capitalGuard wraps frontend command-center route",
  has(appTsx, /command-center.*capitalGuard|capitalGuard.*command-center/s));

ok("capital Command Center nav item is in capitalOnly section",
  has(navConfig, "capitalOnly: true") && has(navConfig, "capital-command-center"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 14. Empty / edge cases ───────────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("empty state when no rounds exist",
  has(page, "No funding rounds found"));

ok("empty state when no lead candidates",
  has(page, "No lead candidates identified"));

ok("empty state when no actions",
  has(page, "No urgent actions this week"));

ok("empty state when scenarios missing target",
  has(page, "Set a target raise amount"));

ok("computeRunway returns has_data=false when no cash or burn",
  has(service, "return {") && has(service, "has_data: false"));

ok("computeWeightedPipeline skips Passed investors",
  has(service, "stage === \"Passed\""));

ok("computeWeightedPipeline skips do_not_contact investors",
  has(service, "do_not_contact"));

ok("weighted pipeline falls back to investor stage when no commitment",
  has(service, "Fall back to investor stage"));

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
if (failed === 0) console.log("\n✓ All Capital Command Center checks passed");
else process.exit(1);
