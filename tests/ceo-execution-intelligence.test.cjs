"use strict";
/**
 * CEO Execution Intelligence — Phase 8 source-grep tests
 * 180+ deterministic checks on service, routes, frontend, and regression guards.
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

// ── File paths ─────────────────────────────────────────────────────────────────
const SERVICE   = path.join(__dirname, "../server/services/ceo-execution-intelligence.ts");
const ROUTES    = path.join(__dirname, "../server/routes.ts");
const PANEL     = path.join(__dirname, "../client/src/components/today/ceo-execution-radar.tsx");
const TODAY     = path.join(__dirname, "../client/src/pages/today.tsx");
const INDEX_TS  = path.join(__dirname, "../server/index.ts");

// Phase regressions
const P6_SERVICE = path.join(__dirname, "../server/services/ceo-action-loop.ts");
const P7_SERVICE = path.join(__dirname, "../server/services/ceo-briefing.ts");
const P5_SERVICE = path.join(__dirname, "../server/services/ceo-one-on-ones.ts");

const svc    = fs.readFileSync(SERVICE, "utf-8");
const routes = fs.readFileSync(ROUTES, "utf-8");
const panel  = fs.readFileSync(PANEL, "utf-8");
const today  = fs.readFileSync(TODAY, "utf-8");
const idx    = fs.readFileSync(INDEX_TS, "utf-8");

// Slice Phase 8 route block only (between Phase 8 header and Growth OS header)
const p8RouteStart  = routes.indexOf("CEO Execution Intelligence (Phase 8)");
const p8RouteEnd    = routes.indexOf("Growth OS Command Center", p8RouteStart);
const p8Routes      = p8RouteStart > -1 ? routes.slice(p8RouteStart, p8RouteEnd) : "";

let passed = 0;
let failed = 0;
const failures = [];

function check(condition, label) {
  if (condition) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}`);
    failed++;
    failures.push(label);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// [1] Service — existence and exports
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[1] Service — existence and exports");
check(fs.existsSync(SERVICE), "service file exists");
check(svc.includes("buildExecutionRadar"),        "buildExecutionRadar exported");
check(svc.includes("detectExecutionDrift"),        "detectExecutionDrift exported");
check(svc.includes("buildCommitmentsRadar"),       "buildCommitmentsRadar exported");
check(svc.includes("buildRecurringRiskPatterns"),  "buildRecurringRiskPatterns exported");
check(svc.includes("buildExecutionScorecard"),     "buildExecutionScorecard exported");

// ─────────────────────────────────────────────────────────────────────────────
// [2] Safety — no auto-send, no external calls, no OpenAI
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[2] Safety — no auto-send, no external calls, no OpenAI");
check(!svc.includes("sendEmail"),               "service: no sendEmail");
check(!svc.includes("sendMessage"),             "service: no sendMessage");
check(!svc.includes("sendCurrentsMessage"),     "service: no sendCurrentsMessage");
check(!svc.includes("openai") && !svc.includes("OpenAI"), "service: no OpenAI dependency");
check(!svc.includes("fetch("),                  "service: no external fetch()");
check(svc.includes("Never auto-sends") || svc.includes("Never sends") || svc.includes("No auto-send") || svc.includes("no auto-send"),
  "service: safety comment present");

// ─────────────────────────────────────────────────────────────────────────────
// [3] Drift thresholds — centralized
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[3] Drift thresholds — centralized object");
check(svc.includes("DRIFT_THRESHOLDS"),                       "service: DRIFT_THRESHOLDS constant exported");
check(svc.includes("blocker_stale_days"),                     "thresholds: blocker_stale_days");
check(svc.includes("task_stale_days"),                        "thresholds: task_stale_days");
check(svc.includes("task_blocked_no_update_days"),            "thresholds: task_blocked_no_update_days");
check(svc.includes("opp_stale_days"),                         "thresholds: opp_stale_days");
check(svc.includes("action_snooze_repeat"),                   "thresholds: action_snooze_repeat");
check(svc.includes("owner_overdue_count"),                    "thresholds: owner_overdue_count");
check(svc.includes("scorecard_critical_penalty"),             "thresholds: scorecard penalties present");

// ─────────────────────────────────────────────────────────────────────────────
// [4] Execution radar — required sections
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[4] Execution radar — required sections");
const requiredSections = [
  "critical_drift", "slipping_commitments", "stale_tasks",
  "repeated_snoozes", "unresolved_blockers", "stale_opportunities",
  "owner_load_risk", "recurring_risks", "execution_wins",
];
for (const s of requiredSections) {
  check(svc.includes(s), `service: ${s} section`);
}
check(svc.includes("recommended_interventions"), "service: recommended_interventions");

// ─────────────────────────────────────────────────────────────────────────────
// [5] Execution item structure
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[5] Execution item structure");
check(svc.includes("ExecutionItem"),        "service: ExecutionItem interface");
check(svc.includes("source_type"),          "service: source_type field");
check(svc.includes("source_id"),            "service: source_id field");
check(svc.includes("age_days"),             "service: age_days field");
check(svc.includes("last_activity_at"),     "service: last_activity_at field");
check(svc.includes("risk_reason"),          "service: risk_reason field");
check(svc.includes("suggested_next_step"),  "service: suggested_next_step field");
check(svc.includes("linked_action_id"),     "service: linked_action_id nullable");
check(svc.includes("empty_state"),          "service: empty_state per section");
check(svc.includes("ExecutionSeverity"),    "service: ExecutionSeverity type");

// ─────────────────────────────────────────────────────────────────────────────
// [6] Severity model
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[6] Severity model");
check(svc.includes('"info"'),     "service: info severity");
check(svc.includes('"watch"'),    "service: watch severity");
check(svc.includes('"urgent"'),   "service: urgent severity");
check(svc.includes('"critical"'), "service: critical severity");

// ─────────────────────────────────────────────────────────────────────────────
// [7] Drift detection rules
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[7] Drift detection rules");
check(svc.includes("status = 'blocked'") || svc.includes("status = \"blocked\""), "drift: blocked status check");
check(svc.includes("snooze_count"),         "drift: snooze_count check");
check(svc.includes("due_at < NOW()"),       "drift: overdue action check");
check(svc.includes("updated_at < NOW()"),   "drift: stale task update check");
check(svc.includes("task_blocked_no_update_days"), "drift: uses centralized threshold for blocked tasks");

// ─────────────────────────────────────────────────────────────────────────────
// [8] Commitments radar — required sections
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[8] Commitments radar — required sections");
const requiredCommitSections = [
  "due_today", "due_this_week", "overdue", "no_owner", "no_due_date",
  "accepted_not_tasked", "tasked_not_completed", "completed", "recurring_commitments",
];
for (const s of requiredCommitSections) {
  check(svc.includes(s), `service: commitments section ${s}`);
}
check(svc.includes("suggested_ceo_action"),  "service: suggested_ceo_action in commitments");

// ─────────────────────────────────────────────────────────────────────────────
// [9] Scorecard — structure
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[9] Scorecard — structure and scoring");
check(svc.includes("ScorecardResult"),          "service: ScorecardResult interface");
check(svc.includes('"Strong"'),                  "scorecard: Strong label");
check(svc.includes('"Watch"'),                   "scorecard: Watch label");
check(svc.includes('"At Risk"'),                 "scorecard: At Risk label");
check(svc.includes('"Critical"'),                "scorecard: Critical label");
check(svc.includes("score"),                     "scorecard: score field");
check(svc.includes("label"),                     "scorecard: label field");
check(svc.includes("reason"),                    "scorecard: reason field");
check(svc.includes("contributing_factors"),      "scorecard: contributing_factors");
check(svc.includes("Math.max(0, Math.min(100"),  "scorecard: score clamped 0-100");
check(svc.includes("disclaimer"),                "scorecard: disclaimer field (not scientific)");
check(svc.includes("directional guide") || svc.includes("not a scientific"), "scorecard: non-scientific disclaimer text");

// ─────────────────────────────────────────────────────────────────────────────
// [10] Scorecard metrics
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[10] Scorecard metrics");
const scorecardMetrics = [
  "open_ceo_actions", "overdue_ceo_actions", "completed_this_week",
  "dismissed_this_week", "snoozed_active", "open_blockers",
  "blockers_resolved_this_week", "overdue_commitments",
  "commitments_completed_this_week", "stale_tasks", "stale_opportunities",
  "owner_load_distribution", "execution_health_score",
];
for (const m of scorecardMetrics) {
  check(svc.includes(m), `scorecard metric: ${m}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// [11] Capital gating
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[11] Capital gating");
check(svc.includes("hasCapital"),          "service: hasCapital gating present");
check(!svc.includes("capital_investors"),  "service: capital_investors NOT directly exposed");

// ─────────────────────────────────────────────────────────────────────────────
// [12] Private channels excluded
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[12] Private channels excluded");
check(svc.includes("is_private") || !svc.includes("current_channels"),
  "service: private channel filter present or currents not queried");

// ─────────────────────────────────────────────────────────────────────────────
// [13] No broad DM body exposure
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[13] No broad DM body exposure");
check(!svc.includes("SELECT * FROM current_messages"), "service: no SELECT * on DM messages");
check(!svc.includes("is_direct_message"), "service: DM channel body not broadly fetched");

// ─────────────────────────────────────────────────────────────────────────────
// [14] Neutral language — no shaming terms
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[14] Neutral language in service");
const banned = ["lazy", "failing", "weak performer", "poor performer", "blame", "underperforming"];
for (const term of banned) {
  check(!svc.toLowerCase().includes(term), `service: no '${term}' shaming language`);
}
check(svc.includes("check-in") || svc.includes("check in"), "service: uses check-in language");
check(svc.includes("Blocked") || svc.includes("blocked"),   "service: uses Blocked neutral term");
check(svc.includes("drifting") || svc.includes("stale"),    "service: uses drifting/stale neutral term");
check(svc.includes("support needed") || svc.includes("prioritization support"), "service: uses support-needed language");

// ─────────────────────────────────────────────────────────────────────────────
// [15] Phase 6 action queue integration
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[15] Phase 6 action queue integration");
check(svc.includes("createCeoAction"),                    "service: createCeoAction imported from Phase 6");
check(svc.includes("from \"./ceo-action-loop\"") || svc.includes("from './ceo-action-loop'"),
  "service: imports from ceo-action-loop (Phase 6 service)");
check(svc.includes("CreateActionInput"),                  "service: CreateActionInput type used");

// ─────────────────────────────────────────────────────────────────────────────
// [16] ceo_execution_reviews migration
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[16] ceo_execution_reviews migration (server/index.ts)");
check(idx.includes("ceo_execution_reviews"),     "index: ceo_execution_reviews table created");
check(idx.includes("item_key"),                  "index: item_key column");
check(idx.includes("item_type"),                 "index: item_type column");
check(idx.includes("source_type"),               "index: source_type column");
check(idx.includes("source_id"),                 "index: source_id column");
check(idx.includes("'reviewed', 'dismissed'") || idx.includes("reviewed") && idx.includes("dismissed"),
  "index: status CHECK constraint");
check(idx.includes("actor_user_id"),             "index: actor_user_id column");
check(idx.includes("idx_ceo_execution_reviews_key"), "index: index on item_key");

// ─────────────────────────────────────────────────────────────────────────────
// [17] Routes — Phase 8 block exists
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[17] Routes — Phase 8 block exists");
check(p8Routes.includes("CEO Execution Intelligence (Phase 8)"), "routes: Phase 8 section header");

// ─────────────────────────────────────────────────────────────────────────────
// [18] Routes — all 8 routes present and require admin
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[18] Routes — required endpoints");
const routePaths = [
  "/api/today/ceo-execution/radar",
  "/api/today/ceo-execution/drift",
  "/api/today/ceo-execution/commitments",
  "/api/today/ceo-execution/recurring-risks",
  "/api/today/ceo-execution/scorecard",
  "/api/today/ceo-execution/items/:id/create-action",
  "/api/today/ceo-execution/items/:id/dismiss",
  "/api/today/ceo-execution/items/:id/mark-reviewed",
];
for (const rp of routePaths) {
  check(p8Routes.includes(rp), `routes: ${rp} present`);
}

const adminCount = (p8Routes.match(/requireAdmin/g) ?? []).length;
check(adminCount >= 8, `routes: all 8 routes require requireAdmin (found ${adminCount})`);

// ─────────────────────────────────────────────────────────────────────────────
// [19] Routes — no auto-send in Phase 8 block
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[19] Routes — no auto-send in Phase 8 block");
check(!p8Routes.includes("sendEmail"),           "routes Phase 8: no sendEmail");
check(!p8Routes.includes("sendMessage"),         "routes Phase 8: no sendMessage");
check(!p8Routes.includes("sendCurrentsMessage"), "routes Phase 8: no sendCurrentsMessage");

// ─────────────────────────────────────────────────────────────────────────────
// [20] Routes — action routes use Phase 6, not delete source data
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[20] Routes — action routes use Phase 6, don't delete source");
check(p8Routes.includes("createCeoAction"),                 "routes: create-action uses Phase 6 createCeoAction");
check(p8Routes.includes("execution_radar"),                 "routes: source_section set to execution_radar");
check(!p8Routes.includes("DELETE FROM") || p8Routes.includes("does NOT delete source"),
  "routes: dismiss does not DELETE source data");
check(p8Routes.includes("ceo_execution_reviews"),           "routes: dismiss/reviewed writes to ceo_execution_reviews");
check(p8Routes.includes("mark-reviewed") && p8Routes.includes("'reviewed'"), "routes: mark-reviewed writes reviewed status");

// ─────────────────────────────────────────────────────────────────────────────
// [21] Routes — import from service
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[21] Routes — service import");
check(routes.includes("buildExecutionRadar"),          "routes: buildExecutionRadar imported");
check(routes.includes("detectExecutionDrift"),          "routes: detectExecutionDrift imported");
check(routes.includes("buildCommitmentsRadar"),         "routes: buildCommitmentsRadar imported");
check(routes.includes("buildRecurringRiskPatterns"),    "routes: buildRecurringRiskPatterns imported");
check(routes.includes("buildExecutionScorecard"),       "routes: buildExecutionScorecard imported");
check(routes.includes("./services/ceo-execution-intelligence"), "routes: import from ceo-execution-intelligence");

// ─────────────────────────────────────────────────────────────────────────────
// [22] Frontend — CeoExecutionRadarPanel
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[22] Frontend — CeoExecutionRadarPanel");
check(fs.existsSync(PANEL),                              "panel file exists");
check(panel.includes("CeoExecutionRadarPanel"),          "panel: CeoExecutionRadarPanel exported");
check(panel.includes("ceo-execution-radar-panel"),       "panel: data-testid ceo-execution-radar-panel");
check(panel.includes("execution-radar-tabs"),            "panel: data-testid execution-radar-tabs");
check(panel.includes("execution-health-score"),          "panel: execution-health-score testid");

// ─────────────────────────────────────────────────────────────────────────────
// [23] Frontend — Tabs
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[23] Frontend — Tabs");
// Tabs use template testid `execution-tab-${key}` where keys are radar/commitments/drift/recurring/scorecard
check(panel.includes("execution-tab-") && panel.includes('"radar"'),       "panel: Radar tab via template + key");
check(panel.includes("execution-tab-") && panel.includes('"commitments"'), "panel: Commitments tab via template + key");
check(panel.includes("execution-tab-") && panel.includes('"drift"'),       "panel: Drift tab via template + key");
check(panel.includes("execution-tab-") && panel.includes('"recurring"'),   "panel: Recurring tab via template + key");
check(panel.includes("execution-tab-") && panel.includes('"scorecard"'),   "panel: Scorecard tab via template + key");

// ─────────────────────────────────────────────────────────────────────────────
// [24] Frontend — Radar tab content
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[24] Frontend — Radar tab");
check(panel.includes("radar-tab-content"),                 "panel: radar-tab-content testid");
check(panel.includes("recommended-interventions"),          "panel: recommended-interventions section");
check(panel.includes("execution-section-"),                "panel: section block testid pattern");
check(panel.includes("/api/today/ceo-execution/radar"),    "panel: radar API query");

// ─────────────────────────────────────────────────────────────────────────────
// [25] Frontend — Commitments tab content
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[25] Frontend — Commitments tab");
check(panel.includes("commitments-tab-content"),           "panel: commitments-tab-content testid");
check(panel.includes("commitments-group-"),                "panel: commitments group testid pattern");
check(panel.includes("commitments-items-"),                "panel: commitments items testid pattern");
check(panel.includes("/api/today/ceo-execution/commitments"), "panel: commitments API query");

// ─────────────────────────────────────────────────────────────────────────────
// [26] Frontend — Drift tab content
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[26] Frontend — Drift tab");
check(panel.includes("drift-tab-content"),         "panel: drift-tab-content testid");
check(panel.includes("drift-severity-summary"),    "panel: drift severity summary testid");
check(panel.includes("drift-items-list"),          "panel: drift items list testid");
check(panel.includes("/api/today/ceo-execution/drift"), "panel: drift API query");

// ─────────────────────────────────────────────────────────────────────────────
// [27] Frontend — Recurring Risks tab
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[27] Frontend — Recurring Risks tab");
check(panel.includes("recurring-tab-content"),      "panel: recurring-tab-content testid");
check(panel.includes("recurring-summary"),          "panel: recurring summary testid");
check(panel.includes("recurring-patterns-list"),    "panel: recurring patterns list testid");
check(panel.includes("/api/today/ceo-execution/recurring-risks"), "panel: recurring-risks API query");

// ─────────────────────────────────────────────────────────────────────────────
// [28] Frontend — Scorecard tab
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[28] Frontend — Scorecard tab");
check(panel.includes("scorecard-tab-content"),      "panel: scorecard-tab-content testid");
check(panel.includes("scorecard-health-hero"),      "panel: health hero testid");
check(panel.includes("scorecard-score-value"),      "panel: score value testid");
check(panel.includes("scorecard-label-value"),      "panel: label value testid");
check(panel.includes("scorecard-reason"),           "panel: reason testid");
check(panel.includes("scorecard-disclaimer"),       "panel: disclaimer testid");
check(panel.includes("scorecard-metrics-grid"),     "panel: metrics grid testid");
check(panel.includes("scorecard-contributing-factors"), "panel: contributing factors testid");
check(panel.includes("/api/today/ceo-execution/scorecard"), "panel: scorecard API query");

// ─────────────────────────────────────────────────────────────────────────────
// [29] Frontend — Action buttons wired
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[29] Frontend — Action buttons");
check(panel.includes("create-action-btn"),         "panel: create-action-btn testid");
check(panel.includes("mark-reviewed-btn"),         "panel: mark-reviewed-btn testid");
check(panel.includes("dismiss-btn"),               "panel: dismiss-btn testid");
check(panel.includes("createActionMut"),           "panel: createActionMut mutation");
check(panel.includes("markReviewedMut"),           "panel: markReviewedMut mutation");
check(panel.includes("dismissMut"),                "panel: dismissMut mutation");
check(panel.includes("/create-action"),            "panel: create-action API call");
check(panel.includes("/mark-reviewed"),            "panel: mark-reviewed API call");
check(panel.includes("/dismiss"),                  "panel: dismiss API call");

// ─────────────────────────────────────────────────────────────────────────────
// [30] Frontend — no auto-send in panel
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[30] Frontend — no auto-send in panel");
check(!panel.includes("sendEmail"),            "panel: no sendEmail");
check(!panel.includes("sendMessage"),          "panel: no sendMessage");
check(!panel.includes("sendCurrentsMessage"),  "panel: no sendCurrentsMessage");

// ─────────────────────────────────────────────────────────────────────────────
// [31] Frontend — neutral language in panel
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[31] Frontend — neutral language in panel");
for (const term of banned) {
  check(!panel.toLowerCase().includes(term), `panel: no '${term}' shaming language`);
}

// ─────────────────────────────────────────────────────────────────────────────
// [32] today.tsx — CeoExecutionRadarPanel integration
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[32] today.tsx integration");
check(today.includes("CeoExecutionRadarPanel"),        "today: CeoExecutionRadarPanel imported");
check(today.includes("ceo-execution-radar"),           "today: import from ceo-execution-radar");
check(today.includes("<CeoExecutionRadarPanel"),        "today: CeoExecutionRadarPanel rendered in JSX");

// ─────────────────────────────────────────────────────────────────────────────
// [33] Capital invariant — Phase 8 surfaces
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[33] Capital invariant");
check(svc.includes("hasCapital"),              "service: hasCapital guard present");
check(!panel.includes("capital_investors"),    "panel: no capital_investors in frontend");
check(!p8Routes.includes("capital_investors"), "routes Phase 8: no capital_investors in route handlers");

// ─────────────────────────────────────────────────────────────────────────────
// [34] Phase 4/5/6/7 regression guard
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[34] Phase 4/5/6/7 regression guard");
check(routes.includes("/api/today/ceo-cockpit"),                "routes: Phase 4 cockpit route still present");
check(routes.includes("/api/today/ceo-cockpit/one-on-ones"),    "routes: Phase 5 1:1 routes still present");
check(routes.includes("CEO Action Queue (Phase 6)"),            "routes: Phase 6 action queue routes still present");
check(routes.includes("CEO Briefing (Phase 7)"),                "routes: Phase 7 briefing routes still present");
check(routes.includes("CEO Execution Intelligence (Phase 8)"),  "routes: Phase 8 section header present");

check(fs.existsSync(P5_SERVICE),                               "Phase 5 service: ceo-one-on-ones.ts intact");
check(fs.existsSync(P6_SERVICE),                               "Phase 6 service: ceo-action-loop.ts intact");
check(fs.existsSync(P7_SERVICE),                               "Phase 7 service: ceo-briefing.ts intact");

const p6Svc = fs.readFileSync(P6_SERVICE, "utf-8");
const p7Svc = fs.readFileSync(P7_SERVICE, "utf-8");
check(p6Svc.includes("generateCockpitActions"), "Phase 6 service: generateCockpitActions intact");
check(p6Svc.includes("createCeoAction"),        "Phase 6 service: createCeoAction intact");
check(p7Svc.includes("buildDailyCeoBriefing"),  "Phase 7 service: buildDailyCeoBriefing intact");
check(p7Svc.includes("buildWeeklyCeoReview"),   "Phase 7 service: buildWeeklyCeoReview intact");

check(today.includes("CeoBriefingPanel"),        "today: Phase 7 CeoBriefingPanel still present");
check(today.includes("CeoActionQueuePanel"),     "today: Phase 6 CeoActionQueuePanel still present");
check(today.includes("TeamPulseSection") || today.includes("TeamPulse"), "today: TeamPulseSection still present");
check(today.includes("BlockersSection") || today.includes("Blockers"),   "today: BlockersSection still present");
check(today.includes("OneOnOnesSection") || today.includes("OneOnOnes"), "today: OneOnOnesSection still present");

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`CEO Execution Intelligence Phase 8 — ${passed + failed} checks: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailed checks:");
  for (const f of failures) console.log(`  ✗  ${f}`);
  process.exit(1);
} else {
  console.log("\nAll checks passed ✓");
}
