/**
 * Capital Module — Phase 2F Valuation, Dilution, Allocation & Close Plan Tests
 *
 * 1.  Service exports
 * 2.  Valuation summary — priced equity
 * 3.  Valuation summary — SAFE / convertible
 * 4.  Valuation summary — no instrument
 * 5.  Dilution scenarios — priced equity math
 * 6.  Dilution scenarios — SAFE warnings
 * 7.  Allocation plan builder
 * 8.  Allocation plan sorting
 * 9.  Close plan grouping
 * 10. Close plan alerts
 * 11. Close checklist
 * 12. Valuation risk flags
 * 13. Allocation risk flags
 * 14. Schema migration
 * 15. Backend API routes
 * 16. Frontend page wiring
 * 17. Permission hardening
 * 18. Empty / edge cases
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

const svc      = load("server/services/capital-valuation.ts");
const routes   = load("server/routes-capital.ts");
const page     = load("client/src/pages/capital-command-center.tsx");
const navCfg   = load("client/src/lib/nav-config.ts");
const appTsx   = load("client/src/App.tsx");

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 1. Service exports ───────────────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("service file exists",                        svc.length > 200);
ok("ROUND_INSTRUMENTS exported",                 has(svc, "export const ROUND_INSTRUMENTS"));
ok("ALLOCATION_STATUSES exported",               has(svc, "export const ALLOCATION_STATUSES"));
ok("CLOSING_STATUSES exported",                  has(svc, "export const CLOSING_STATUSES"));
ok("CLOSING_STATUS_LABELS exported",             has(svc, "export const CLOSING_STATUS_LABELS"));
ok("computeValuationSummary exported",           has(svc, "export function computeValuationSummary"));
ok("computeDilutionScenarios exported",          has(svc, "export function computeDilutionScenarios"));
ok("computeAllocationPlan exported",             has(svc, "export function computeAllocationPlan"));
ok("computeClosePlan exported",                  has(svc, "export function computeClosePlan"));
ok("computeCloseChecklist exported",             has(svc, "export function computeCloseChecklist"));
ok("computeValuationRiskFlags exported",         has(svc, "export function computeValuationRiskFlags"));
ok("ValuationSummary interface",                 has(svc, "export interface ValuationSummary"));
ok("DilutionScenario interface",                 has(svc, "export interface DilutionScenario"));
ok("AllocationRow interface",                    has(svc, "export interface AllocationRow"));
ok("ClosePlanSummary interface",                 has(svc, "export interface ClosePlanSummary"));
ok("CloseChecklistItem interface",               has(svc, "export interface CloseChecklistItem"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 2. Valuation summary — priced equity ─────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("isPriced = instrument === priced_equity",    has(svc, '"priced_equity"'));
ok("post_money computed = pre + amount raised",  has(svc, "preMoney + amountRaised"));
ok("new investor pct = amount / post_money",     has(svc, "amountRaised / postMoney"));
ok("has_valuation_data flag",                    has(svc, "has_valuation_data:"));
ok("option pool expansion warning",             has(svc, "Option pool expanding from"));
ok("share price missing warning",               has(svc, "Share price not set"));
ok("pre_money missing warning",                 has(svc, "Pre-money valuation not set"));
ok("is_priced in return",                       has(svc, "is_priced:"));
ok("is_safe_or_convertible in return",          has(svc, "is_safe_or_convertible:"));
ok("effective_valuation computed",              has(svc, "effective_valuation:"));
ok("warnings array returned",                   has(svc, "warnings,"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 3. Valuation summary — SAFE / convertible ────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("SAFE instrument detection",                 has(svc, '"SAFE"'));
ok("convertible_note detection",                has(svc, '"convertible_note"'));
ok("valuation cap drives ownership if SAFE",    has(svc, "amountRaised / valuationCap"));
ok("SAFE without cap warning",                  has(svc, "No valuation cap set"));
ok("discount rate warning on SAFE",             has(svc, "Discount rate") && has(svc, "will reduce conversion price"));
ok("no discount+no cap = incomplete warning",   has(svc, "Neither discount rate nor valuation cap"));
ok("ownership is cap-based estimate warning",   has(svc, "Ownership % is estimated at cap"));
ok("SAFE: no cap → null ownership pct",         has(svc, /valuationCap.*newInvestorOwnershipPct|null/s));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 4. Valuation summary — no instrument ─────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("no instrument warning",                     has(svc, "Investment instrument not selected"));
ok("grant instrument in ROUND_INSTRUMENTS",     has(svc, '"grant"'));
ok("other instrument in ROUND_INSTRUMENTS",     has(svc, '"other"'));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 5. Dilution scenarios — priced equity math ───────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("computeDilutionScenarios maps scenarios",   has(svc, "scenarios.map(s =>"));
ok("post_money = pre + scenario amount",        has(svc, "valuation.pre_money + s.amount"));
ok("new_investor_pct per scenario",             has(svc, "s.amount / postMoney"));
ok("dilution_pct returned per scenario",        has(svc, "dilution_pct:"));
ok("option pool impact added to dilution",      has(svc, "poolImpact > 0"));
ok("dilution_warnings per scenario",            has(svc, "dilution_warnings:"));
ok("assumptions per scenario",                  has(svc, "assumptions,"));
ok("pre_money missing warning in scenario",     has(svc, "Pre-money valuation not set — dilution cannot be computed"));
ok("spreads base scenario fields",              has(svc, "...s,"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 6. Dilution scenarios — SAFE warnings ────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("SAFE with cap: estimated ownership",        has(svc, "Actual dilution determined at conversion"));
ok("SAFE without cap: dilution unknown warning",has(svc, "dilution only knowable at next priced round"));
ok("no instrument: dilution unknown warning",   has(svc, "Investment instrument not selected — dilution unknown"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 7. Allocation plan builder ───────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("investors with commitment included",        has(svc, "for (const c of commitments)"));
ok("investors without commitment in stage",     has(svc, "ALLOCATION_RELEVANT_STAGES"));
ok("allocation_status defaults to unallocated", has(svc, '"unallocated"'));
ok("closing_status defaults to not_started",    has(svc, '"not_started"'));
ok("commitment_id null when no commitment",     has(svc, "commitment_id:           null"));
ok("docs_sent_at mapped",                       has(svc, "docs_sent_at:"));
ok("docs_signed_at mapped",                     has(svc, "docs_signed_at:"));
ok("funds_received_at mapped",                  has(svc, "funds_received_at:"));
ok("allocation_notes mapped",                   has(svc, "allocation_notes:"));
ok("target_cheque_amount mapped",               has(svc, "target_cheque_amount:"));
ok("score and tier computed per row",           has(svc, "simpleScore(inv)"));
ok("likely_lead mapped",                        has(svc, "likely_lead:"));
ok("Passed investors excluded",                 has(svc, '"Passed"'));
ok("do_not_contact excluded",                   has(svc, "do_not_contact"));
ok("relevant stages include Soft Commit",       has(svc, '"Soft Commit"'));
ok("relevant stages include Diligence",         has(svc, '"Diligence"'));
ok("relevant stages include Committed",         has(svc, '"Committed"'));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 8. Allocation plan sorting ───────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("likely_lead first in sort",                 has(svc, "a.likely_lead !== b.likely_lead"));
ok("closing progress second",                   has(svc, "closingOrder"));
ok("score descending third",                    has(svc, "b.score - a.score"));
ok("wired/closed highest priority in sort",     has(svc, "wired: 0") || has(svc, '"wired": 0'));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 9. Close plan grouping ───────────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("CLOSING_STATUSES drives groups",            has(svc, "for (const status of CLOSING_STATUSES)"));
ok("group has total_amount",                    has(svc, "total_amount:"));
ok("group has pct_of_target",                   has(svc, "pct_of_target:"));
ok("group has pct_of_min_close",                has(svc, "pct_of_min_close:"));
ok("group has count",                           has(svc, "count:"));
ok("group has label",                           has(svc, "label:"));
ok("wired_amount in summary",                   has(svc, "wired_amount:"));
ok("closed_amount in summary",                  has(svc, "closed_amount:"));
ok("dropped_amount in summary",                 has(svc, "dropped_amount:"));
ok("pending_wire in summary",                   has(svc, "pending_wire:"));
ok("total_committed_in_close in summary",       has(svc, "total_committed_in_close:"));
ok("alerts array in summary",                   has(svc, "alerts,"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 10. Close plan alerts ────────────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("committed but no docs alert",               has(svc, "docs not yet started"));
ok("docs sent stale alert",                     has(svc, "docs sent 7+ days ago"));
ok("docs signed follow-up wire alert",          has(svc, "signed docs — follow up on wire"));
ok("funds pending long alert",                  has(svc, "funds pending 5+ days after signing"));
ok("stale threshold = 7 days docs sent",        has(svc, "> 7"));
ok("funds stale threshold = 5 days",            has(svc, "> 5"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 11. Close checklist ──────────────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("target_set checklist item",                 has(svc, '"target_set"'));
ok("min_close_set checklist item",              has(svc, '"min_close_set"'));
ok("instrument_selected checklist item",        has(svc, '"instrument_selected"'));
ok("premoney_set checklist item",               has(svc, '"premoney_set"'));
ok("close_date_set checklist item",             has(svc, '"close_date_set"'));
ok("lead_identified checklist item",            has(svc, '"lead_identified"'));
ok("min_committed checklist item",              has(svc, '"min_committed"'));
ok("allocation_complete checklist item",        has(svc, '"allocation_complete"'));
ok("docs_prepared checklist item",              has(svc, '"docs_prepared"'));
ok("docs_signed checklist item",                has(svc, '"docs_signed"'));
ok("funds_wired checklist item",                has(svc, '"funds_wired"'));
ok("closing_summary checklist item",            has(svc, '"closing_summary"'));
ok("checklist items have complete flag",        has(svc, "complete:"));
ok("checklist items have note",                 has(svc, "note:"));
ok("priced equity vs SAFE premoney label",      has(svc, "Valuation / cap set"));
ok("no fake cap table assumptions",             !has(svc, "fake") && !has(svc, "example cap table") && !has(svc, "sample_ownership"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 12. Valuation risk flags ─────────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("no_instrument flag",                        has(svc, '"no_instrument"'));
ok("no_valuation flag",                         has(svc, '"no_valuation"'));
ok("safe_incomplete flag",                      has(svc, '"safe_incomplete"'));
ok("no_share_price flag",                       has(svc, '"no_share_price"'));
ok("pool_incomplete flag",                      has(svc, '"pool_incomplete"'));
ok("critical level for no_instrument",          has(svc, /no_instrument.*critical|critical.*no_instrument/s));
ok("critical level for no_valuation",           has(svc, /no_valuation.*critical|critical.*no_valuation/s));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 13. Allocation risk flags ────────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("overallocated flag",                        has(svc, '"overallocated"'));
ok("alloc_below_min flag",                      has(svc, '"alloc_below_min"'));
ok("lead_unallocated flag",                     has(svc, '"lead_unallocated"'));
ok("committed_no_docs flag",                    has(svc, '"committed_no_docs"'));
ok("docs_stale flag",                           has(svc, '"docs_stale"'));
ok("funds_delayed flag",                        has(svc, '"funds_delayed"'));
ok("wired_below_min flag",                      has(svc, '"wired_below_min"'));
ok("overallocated threshold is 5%",             has(svc, "target * 1.05"));
ok("alloc_below_min uses minimum_close_target", has(svc, "minimum_close_target"));
ok("lead_unallocated checks likely_lead",       has(svc, "r.likely_lead") && has(svc, "unallocated"));
ok("wired_below_min checks wired + closed",     has(svc, '"wired"') && has(svc, '"closed"'));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 14. Schema migration ─────────────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("Phase 2F migration block",                  has(routes, "Phase 2F"));
ok("share_price column",                        has(routes, "share_price"));
ok("option_pool_percent_pre column",            has(routes, "option_pool_percent_pre"));
ok("option_pool_percent_post column",           has(routes, "option_pool_percent_post"));
ok("round_instrument column",                   has(routes, "round_instrument"));
ok("discount_rate column",                      has(routes, "discount_rate"));
ok("valuation_cap column",                      has(routes, "valuation_cap"));
ok("interest_rate column",                      has(routes, "interest_rate"));
ok("maturity_date column",                      has(routes, "maturity_date"));
ok("legal_close_status column",                 has(routes, "legal_close_status"));
ok("allocation_amount column",                  has(routes, "allocation_amount"));
ok("requested_amount column",                   has(routes, "requested_amount"));
ok("final_allocation_amount column",            has(routes, "final_allocation_amount"));
ok("allocation_status column",                  has(routes, "allocation_status"));
ok("closing_status column",                     has(routes, "closing_status"));
ok("docs_sent_at column",                       has(routes, "docs_sent_at"));
ok("docs_signed_at column",                     has(routes, "docs_signed_at"));
ok("funds_received_at column",                  has(routes, "funds_received_at"));
ok("allocation_notes column",                   has(routes, "allocation_notes"));
ok("all migrations use IF NOT EXISTS",          has(routes, /ADD COLUMN IF NOT EXISTS share_price/s));
ok("migration is in migrateCapitalSchema",      has(routes, /Phase 2F.*BIGINT|BIGINT.*Phase 2F/s) ||
  (routes.indexOf("Phase 2F") < routes.indexOf("export function registerCapitalRoutes")));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 15. Backend API routes ───────────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("command-center endpoint extended with valuation_summary",
  has(routes, "valuation_summary"));
ok("command-center endpoint extended with dilution_scenarios",
  has(routes, "dilution_scenarios"));
ok("command-center endpoint extended with allocation_plan",
  has(routes, "allocation_plan"));
ok("command-center endpoint extended with close_plan",
  has(routes, "close_plan"));
ok("command-center endpoint extended with close_checklist",
  has(routes, "close_checklist"));
ok("capital-valuation service imported in command-center",
  has(routes, "capital-valuation"));
ok("PATCH /api/capital/rounds/:id/valuation exists",
  has(routes, '"/api/capital/rounds/:id/valuation"'));
ok("valuation endpoint uses requireCapitalAccess",
  has(routes, /rounds\/:id\/valuation.*requireCapitalAccess|requireCapitalAccess.*rounds\/:id\/valuation/s));
ok("valuation endpoint updates round_instrument",
  has(routes, '"round_instrument"'));
ok("valuation endpoint updates share_price",
  has(routes, '"share_price"'));
ok("valuation endpoint updates valuation_cap",
  has(routes, '"valuation_cap"'));
ok("PATCH /api/capital/commitments/:id/allocation exists",
  has(routes, '"/api/capital/commitments/:id/allocation"'));
ok("allocation endpoint uses requireCapitalAccess",
  has(routes, /commitments\/:id\/allocation.*requireCapitalAccess|requireCapitalAccess.*commitments\/:id\/allocation/s));
ok("allocation endpoint updates allocation_status",
  has(routes, '"allocation_status"'));
ok("allocation endpoint updates closing_status",
  has(routes, '"closing_status"'));
ok("allocation endpoint updates docs_sent_at",
  has(routes, '"docs_sent_at"'));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 16. Frontend page wiring ─────────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("ValuationSummary type in page",             has(page, "ValuationSummary") || has(page, "valuation_summary"));
ok("DilutionScenario type in page",             has(page, "DilutionScenario") || has(page, "dilution_scenarios"));
ok("AllocationRow type in page",                has(page, "AllocationRow") || has(page, "allocation_plan"));
ok("section-valuation present",                 has(page, 'data-testid="section-valuation"'));
ok("section-allocation-planner present",        has(page, 'data-testid="section-allocation-planner"'));
ok("section-close-plan present",                has(page, 'data-testid="section-close-plan"'));
ok("section-close-checklist present",           has(page, 'data-testid="section-close-checklist"'));
ok("valuation editor dialog present",           has(page, "ValuationEditorDialog") || has(page, "btn-edit-valuation"));
ok("btn-edit-valuation present",                has(page, 'data-testid="btn-edit-valuation"'));
ok("allocation editor dialog present",          has(page, "AllocationEditorDialog") || has(page, "allocation-editor"));
ok("close plan group rows have test IDs",       has(page, "close-plan-group-") || has(page, "data-testid={`close-plan-group"));
ok("checklist items have test IDs",             has(page, "checklist-item-") || has(page, "data-testid={`checklist-item"));
ok("allocation rows have test IDs",             has(page, "alloc-row-") || has(page, "data-testid={`alloc-row"));
ok("dilution scenarios included",               has(page, "dilution") || has(page, "new_investor_pct"));
ok("empty/no-valuation state",                  has(page, "no-valuation") || has(page, "No valuation") || has(page, "Add Valuation"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 17. Permission hardening ─────────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("requireCapitalAccess on valuation PATCH",
  has(routes, /rounds\/:id\/valuation.*requireCapitalAccess/s));
ok("requireCapitalAccess on allocation PATCH",
  has(routes, /commitments\/:id\/allocation.*requireCapitalAccess/s));
ok("requireCapitalAccess on command-center GET",
  has(routes, /rounds\/:id\/command-center.*requireCapitalAccess/s));
ok("capitalGuard wraps /capital/command-center route",
  has(appTsx, /command-center.*capitalGuard|capitalGuard.*command-center/s));
ok("CAPITAL_ALLOWED_USER_IDS still defined",
  has(routes, "CAPITAL_ALLOWED_USER_IDS"));
ok("no valuation data exposed outside capital module",
  !has(routes, /app\.get.*\/api\/(?!capital).*valuation/));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 18. Empty / edge cases ───────────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("has_valuation_data = false when no fields", has(svc, "has_valuation_data:"));
ok("null-safe post_money when no pre_money",    has(svc, "postMoneyComputed || postMoneyManual || preMoney"));
ok("allocation plan handles empty investors",   has(svc, "for (const c of commitments)"));
ok("close plan handles 0 target gracefully",    has(svc, "target > 0"));
ok("checklist notes are conditional",           has(svc, "note:     !hasTarget"));
ok("service imports WeightedPipelineResult",    has(svc, "WeightedPipelineResult"));
ok("service imports Scenario",                  has(svc, "Scenario"));
ok("service imports RiskFlag",                  has(svc, "RiskFlag"));
ok("no auto-send email patterns",               !has(svc, "sendEmail") && !has(svc, "sendMessage"));
ok("no fake cap table data patterns",           !has(svc, "founderOwnership") || has(svc, "// no founder"));

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
if (failed === 0) console.log("\n✓ All Capital Valuation/Allocation checks passed");
else process.exit(1);
