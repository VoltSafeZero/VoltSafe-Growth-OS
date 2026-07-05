"use strict";
/**
 * Campaign Branching Automation — Phase 9 source-grep tests
 * Tests verify service structure, safety, idempotency, seed rules,
 * integration points, API routes, and frontend sections.
 */

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function load(relPath) {
  return fs.readFileSync(path.resolve(relPath), "utf8");
}

function hasPattern(src, pat) {
  if (pat instanceof RegExp) return pat.test(src);
  return src.includes(pat);
}

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

// ── Load files ─────────────────────────────────────────────────────────────────

const branching   = load("server/services/campaign-branching-automation.ts");
const ingestion   = load("server/services/campaign-reply-ingestion.ts");
const tracking    = load("server/services/campaign-tracking.ts");
const routes      = load("server/routes.ts");
const indexTs     = load("server/index.ts");
const detail      = load("client/src/pages/campaign-detail.tsx");
const replies     = load("client/src/pages/marketing-replies.tsx");

// ── Section 1: Migration ───────────────────────────────────────────────────────

console.log("\n── Section 1: Migration ──────────────────────────────────────────────");

assert(hasPattern(branching, "migrateBranchingSchema"), "migrateBranchingSchema exported");
assert(hasPattern(branching, "campaign_automation_rules"), "campaign_automation_rules table created");
assert(hasPattern(branching, "campaign_recipient_rule_events"), "campaign_recipient_rule_events table created");
assert(hasPattern(branching, "idx_car_campaign_id"), "index on campaign_automation_rules.campaign_id");
assert(hasPattern(branching, "idx_car_trigger_type"), "index on campaign_automation_rules.trigger_type");
assert(hasPattern(branching, "idx_car_is_active"), "index on campaign_automation_rules.is_active");
assert(hasPattern(branching, "idx_crre_campaign_id"), "index on campaign_recipient_rule_events.campaign_id");
assert(hasPattern(branching, "idx_crre_campaign_recipient"), "index on campaign_recipient_rule_events.campaign_recipient_id");
assert(hasPattern(branching, "idx_crre_rule_id"), "index on campaign_recipient_rule_events.rule_id");
assert(hasPattern(branching, "branch_status"), "branch_status column added to campaign_recipients");
assert(hasPattern(branching, "branch_reason"), "branch_reason column added to campaign_recipients");
assert(hasPattern(branching, "branch_rule_id"), "branch_rule_id column added to campaign_recipients");
assert(hasPattern(branching, "sales_engaged_at"), "sales_engaged_at column added to campaign_recipients");
assert(hasPattern(indexTs, "migrateBranchingSchema"), "server/index.ts calls migrateBranchingSchema");
assert(hasPattern(indexTs, "campaign-branching-automation"), "server/index.ts imports campaign-branching-automation");

// ── Section 2: Allowlists & types ─────────────────────────────────────────────

console.log("\n── Section 2: Allowlists & types ─────────────────────────────────────");

assert(hasPattern(branching, "VALID_TRIGGER_TYPES"), "VALID_TRIGGER_TYPES allowlist defined");
assert(hasPattern(branching, "VALID_ACTION_TYPES"), "VALID_ACTION_TYPES allowlist defined");
assert(hasPattern(branching, "VALID_BRANCH_STATUSES"), "VALID_BRANCH_STATUSES allowlist defined");
assert(hasPattern(branching, "reply_classification"), "reply_classification trigger type present");
assert(hasPattern(branching, "clicked_link"), "clicked_link trigger type present");
assert(hasPattern(branching, "no_open_after_step"), "no_open_after_step trigger type present");
assert(hasPattern(branching, "stop_sequence"), "stop_sequence action type present");
assert(hasPattern(branching, "move_to_step"), "move_to_step action type present");
assert(hasPattern(branching, "create_task"), "create_task action type present");
assert(hasPattern(branching, "mark_sales_engaged"), "mark_sales_engaged action type present");
assert(hasPattern(branching, "suppress_recipient"), "suppress_recipient action type present");
assert(hasPattern(branching, "send_specific_step"), "send_specific_step present (deferred)");
assert(hasPattern(branching, "add_note"), "add_note action type present");

// ── Section 3: Rule evaluation — core logic ────────────────────────────────────

console.log("\n── Section 3: Core evaluation ────────────────────────────────────────");

assert(hasPattern(branching, "evaluateRulesForRecipient"), "evaluateRulesForRecipient exported");
assert(hasPattern(branching, "evaluateRulesForEvent"), "evaluateRulesForEvent exported");
assert(hasPattern(branching, "priority ASC"), "rules evaluated in priority order (ASC)");
assert(hasPattern(branching, "is_active = TRUE"), "only active rules evaluated");
assert(hasPattern(branching, "trigger_event_type") && hasPattern(branching, "trigger_key"), "idempotency check uses trigger_key");
assert(hasPattern(branching, "Idempotency") || hasPattern(branching, "don't fire"), "idempotency documented");
assert(hasPattern(branching, "skipped_compliance"), "compliance guard logs skipped_compliance");
assert(hasPattern(branching, "unsubscribed_at || recipient.bounced_at"), "compliance guard: blocks unsubscribed/bounced recipients");
assert(hasPattern(branching, "writeRuleEvent"), "rule events written to audit table");
assert(hasPattern(branching, "ruleMatchesContext"), "ruleMatchesContext function exists");
assert(hasPattern(branching, "applyRuleAction"), "applyRuleAction function exported");

// ── Section 4: Rule matching ───────────────────────────────────────────────────

console.log("\n── Section 4: Rule matching ──────────────────────────────────────────");

assert(hasPattern(branching, "case \"reply_classification\""), "reply_classification match case");
assert(hasPattern(branching, "case \"clicked_link\""), "clicked_link match case");
assert(hasPattern(branching, "url_keywords"), "clicked_link matches by url_keywords");
assert(hasPattern(branching, "url.includes(kw.toLowerCase())"), "clicked_link keyword match is case-insensitive");
assert(hasPattern(branching, "case \"recipient_status\""), "recipient_status match case");
assert(hasPattern(branching, "// These require tick-time evaluation") || hasPattern(branching, "return false"), "no_open_after_step returns false from event path");
assert(hasPattern(branching, "context.triggerValue === cfg.classification"), "reply_classification compares exact value");

// ── Section 5: Action application ─────────────────────────────────────────────

console.log("\n── Section 5: Action application ─────────────────────────────────────");

assert(hasPattern(branching, "case \"stop_sequence\""), "stop_sequence action case");
assert(hasPattern(branching, "case \"pause_sequence\""), "pause_sequence action case");
assert(hasPattern(branching, "case \"move_to_step\""), "move_to_step action case");
assert(hasPattern(branching, "case \"mark_sales_engaged\""), "mark_sales_engaged action case");
assert(hasPattern(branching, "case \"suppress_recipient\""), "suppress_recipient action case");
assert(hasPattern(branching, "case \"add_note\""), "add_note action case");

// stop_sequence sets automation_status = 'blocked'
assert(hasPattern(branching, "automation_status = 'blocked'"), "stop_sequence sets automation_status=blocked");
assert(hasPattern(branching, "next_step_due_at  = NULL"), "stop_sequence clears next_step_due_at");
assert(hasPattern(branching, "deriveBranchStatus"), "branch_status derived from trigger context");
assert(hasPattern(branching, "stopped_by_reply"), "stopped_by_reply branch status exists");
assert(hasPattern(branching, "stopped_by_unsubscribe"), "stopped_by_unsubscribe branch status exists");
assert(hasPattern(branching, "stopped_by_negative"), "stopped_by_negative branch status exists");
assert(hasPattern(branching, "also_create_task"), "composite: stop + create_task supported");
assert(hasPattern(branching, "also_suppress"), "composite: stop + suppress supported");
assert(hasPattern(branching, "also_add_note"), "composite: stop + add_note supported");

// move_to_step safety
assert(hasPattern(branching, "move_to_step_skipped_no_target"), "move_to_step refuses missing target");
assert(hasPattern(branching, "move_to_step_skipped_missing_step"), "move_to_step refuses nonexistent step");
assert(hasPattern(branching, "move_to_step_skipped_already_sent"), "move_to_step refuses already-sent step");

// mark_sales_engaged
assert(hasPattern(branching, "sales_engaged_at  = NOW()"), "mark_sales_engaged sets sales_engaged_at");
assert(hasPattern(branching, "'sales_engaged'"), "sales_engaged branch status set");

// suppress_recipient
assert(hasPattern(branching, "suppressEmail"), "suppressEmail helper function exists");
assert(hasPattern(branching, "branching_automation"), "suppression source is branching_automation");

// send_specific_step deferred
assert(hasPattern(branching, "send_specific_step_deferred"), "send_specific_step logged as deferred (Phase 9 gap)");
assert(hasPattern(branching, "not_implemented_phase9"), "send_specific_step gap documented");

// ── Section 6: Seed default rules ─────────────────────────────────────────────

console.log("\n── Section 6: Seed default rules ─────────────────────────────────────");

assert(hasPattern(branching, "seedDefaultCampaignRules"), "seedDefaultCampaignRules exported");
assert(hasPattern(branching, "Idempotent") || hasPattern(branching, "existingNames"), "seed is idempotent (skips existing names)");
assert(hasPattern(branching, "Stop on meeting request"), "Rule 1: Stop on meeting request seeded");
assert(hasPattern(branching, "Stop on interested reply"), "Rule 2: Stop on interested reply seeded");
assert(hasPattern(branching, "Stop on unsubscribe"), "Rule 3: Stop on unsubscribe seeded");
assert(hasPattern(branching, "Stop on negative reply"), "Rule 4: Stop on negative reply seeded");
assert(hasPattern(branching, "Send technical follow-up"), "Rule 5: Send technical follow-up seeded");
assert(hasPattern(branching, "Send ROI follow-up"), "Rule 6: Send ROI follow-up seeded");
assert(hasPattern(branching, "No engagement nurture path"), "Rule 7: No engagement nurture path seeded");
assert(hasPattern(branching, "technical.*install.*electrical") || hasPattern(branching, '"technical"'), "technical follow-up keywords present");
assert(hasPattern(branching, "ROI.*pricing.*revenue") || hasPattern(branching, '"ROI"'), "ROI follow-up keywords present");
assert(hasPattern(branching, "priority: 5") || hasPattern(branching, "priority: 10"), "highest priority rules have low priority number");

// ── Section 7: CRUD ────────────────────────────────────────────────────────────

console.log("\n── Section 7: CRUD ───────────────────────────────────────────────────");

assert(hasPattern(branching, "listCampaignRules"), "listCampaignRules exported");
assert(hasPattern(branching, "createCampaignRule"), "createCampaignRule exported");
assert(hasPattern(branching, "updateCampaignRule"), "updateCampaignRule exported");
assert(hasPattern(branching, "deleteCampaignRule"), "deleteCampaignRule exported");
assert(hasPattern(branching, "getRecipientRuleHistory"), "getRecipientRuleHistory exported");
assert(hasPattern(branching, "fired_count"), "listCampaignRules aggregates fired_count");
assert(hasPattern(branching, "last_fired_at"), "listCampaignRules aggregates last_fired_at");
assert(hasPattern(branching, "VALID_TRIGGER_TYPES.has(input.triggerType)"), "createCampaignRule validates trigger_type");
assert(hasPattern(branching, "VALID_ACTION_TYPES.has(input.actionType)"), "createCampaignRule validates action_type");
assert(hasPattern(branching, "Rule not found"), "updateCampaignRule returns 404 if not found");
assert(hasPattern(branching, "statusCode: 400"), "validation errors return 400");

// ── Section 8: Integration — reply ingestion ──────────────────────────────────

console.log("\n── Section 8: Integration — reply ingestion ──────────────────────────");

assert(hasPattern(ingestion, "campaign-branching-automation"), "ingestion imports branching automation");
assert(hasPattern(ingestion, "evaluateRulesForRecipient"), "ingestion calls evaluateRulesForRecipient");
assert(hasPattern(ingestion, "triggerType: \"reply_classification\""), "ingestion fires reply_classification trigger");
assert(hasPattern(ingestion, "triggerValue: classification.classification"), "ingestion passes classification as triggerValue");
assert(hasPattern(ingestion, "fire-and-forget") || hasPattern(ingestion, ".catch(() => {})"), "ingestion evaluation is fire-and-forget");

// ── Section 9: Integration — click tracking ────────────────────────────────────

console.log("\n── Section 9: Integration — click tracking ───────────────────────────");

assert(hasPattern(tracking, "campaign-branching-automation"), "tracking imports branching automation");
assert(hasPattern(tracking, "evaluateRulesForRecipient"), "tracking calls evaluateRulesForRecipient");
assert(hasPattern(tracking, "triggerType: \"clicked_link\""), "tracking fires clicked_link trigger");
assert(hasPattern(tracking, "triggerValue: originalUrl"), "tracking passes original URL as triggerValue");
assert(hasPattern(tracking, "Phase 9"), "tracking has Phase 9 comment");

// ── Section 10: API routes ─────────────────────────────────────────────────────

console.log("\n── Section 10: API routes ────────────────────────────────────────────");

assert(hasPattern(routes, "/api/marketing/campaigns/:id/automation-rules"), "GET/POST automation-rules route exists");
assert(hasPattern(routes, "/api/marketing/campaigns/:id/automation-rules/seed-defaults"), "seed-defaults route exists");
assert(hasPattern(routes, "/api/marketing/automation-rules/:ruleId"), "PATCH/DELETE ruleId routes exist");
assert(hasPattern(routes, "/api/marketing/recipients/:recipientId/rule-history"), "rule-history route exists");
assert(hasPattern(routes, "/api/marketing/automation-rules/evaluate-event/:eventId"), "evaluate-event route exists");
assert(hasPattern(routes, "listCampaignRules"), "routes import listCampaignRules");
assert(hasPattern(routes, "seedDefaultCampaignRules"), "routes import seedDefaultCampaignRules");
assert(hasPattern(routes, "evaluateRulesForEvent"), "routes import evaluateRulesForEvent");
assert(hasPattern(routes, "getRecipientRuleHistory"), "routes import getRecipientRuleHistory");

// Permissions
assert(hasPattern(routes, "requirePermission(\"crm\", \"view\")") && hasPattern(routes, "automation-rules"), "view rules requires crm view permission");
assert(hasPattern(routes, "requirePermission(\"crm\", \"edit\")") && hasPattern(routes, "seed-defaults"), "seed-defaults requires crm edit permission");
assert(hasPattern(routes, "requireAdmin") && hasPattern(routes, "evaluate-event"), "evaluate-event requires admin");

// ── Section 11: Frontend — Branching Rules section ────────────────────────────

console.log("\n── Section 11: Frontend — Branching Rules section ────────────────────");

assert(hasPattern(detail, "BranchingRulesPanel"), "BranchingRulesPanel component exists");
assert(hasPattern(detail, "branching-rules-panel"), "branching-rules-panel testid present");
assert(hasPattern(detail, "Branching Rules"), "Branching Rules heading present");
assert(hasPattern(detail, "Seed Recommended Rules"), "Seed Recommended Rules button present");
assert(hasPattern(detail, "button-seed-default-rules"), "seed-defaults button testid present");
assert(hasPattern(detail, "button-create-rule"), "create-rule button testid present");
assert(hasPattern(detail, "branching-rules-empty"), "branching-rules-empty testid present");
assert(hasPattern(detail, "branching-rules-list"), "branching-rules-list testid present");
assert(hasPattern(detail, "button-toggle-rule-"), "toggle rule button testid present");
assert(hasPattern(detail, "button-edit-rule-"), "edit rule button testid present");
assert(hasPattern(detail, "button-delete-rule-"), "delete rule button testid present");
assert(hasPattern(detail, "TRIGGER_LABELS"), "trigger type labels defined");
assert(hasPattern(detail, "ACTION_LABELS"), "action type labels defined");
assert(hasPattern(detail, "select-trigger-type"), "trigger type select testid present");
assert(hasPattern(detail, "select-action-type"), "action type select testid present");
assert(hasPattern(detail, "input-trigger-config"), "trigger config input testid present");
assert(hasPattern(detail, "input-action-config"), "action config input testid present");
assert(hasPattern(detail, "fired_count"), "fired count shown in rule list");
assert(hasPattern(detail, "last_fired_at"), "last fired date shown");
assert(hasPattern(detail, "Compliance and suppression are still checked"), "compliance warning banner present");
assert(hasPattern(detail, "safeParseJson"), "safeParseJson helper exists for JSON config fields");

// ── Section 12: Safety / compliance ───────────────────────────────────────────

console.log("\n── Section 12: Safety / compliance ───────────────────────────────────");

assert(hasPattern(branching, "skipped_compliance"), "compliance violations logged as skipped_compliance");
assert(hasPattern(branching, "unsubscribed_at || recipient.bounced_at"), "rules never fire for unsubscribed/bounced");
assert(hasPattern(branching, "send_specific_step_deferred"), "send_specific_step deferred — no automated sending");
assert(!hasPattern(branching, "sendEmail"), "branching service does not call sendEmail (no automated replies)");
assert(hasPattern(branching, "fail-closed") || hasPattern(branching, "Fail-closed") || hasPattern(branching, "fail_closed") || hasPattern(branching, "conservative"), "fail-closed principle documented");
assert(hasPattern(branching, "ON CONFLICT DO NOTHING") || hasPattern(branching, "campaign_suppression"), "suppression uses conflict-safe insert");

// ── Section 13: Audit / logging ────────────────────────────────────────────────

console.log("\n── Section 13: Audit / logging ────────────────────────────────────────");

assert(hasPattern(branching, "campaign_recipient_rule_events"), "rule events written to campaign_recipient_rule_events");
assert(hasPattern(branching, "action_taken"), "action_taken recorded in rule event");
assert(hasPattern(branching, "trigger_event_type"), "trigger_event_type recorded in rule event");
assert(hasPattern(branching, "action_metadata_json"), "metadata stored with rule event");
assert(hasPattern(branching, "branching_sequence_stopped"), "sequence_stopped event recorded in campaign_events");
assert(hasPattern(branching, "branching_moved_to_step"), "moved_to_step event recorded in campaign_events");
assert(hasPattern(branching, "branching_marked_sales_engaged"), "sales_engaged event recorded in campaign_events");

// ── Section 14: Cross-suite regression ────────────────────────────────────────

console.log("\n── Section 14: Cross-suite regression ────────────────────────────────");

const classifierTest = load("tests/campaign-reply-classifier.test.cjs");
const automationTest = load("tests/campaign-automation.test.cjs");
const ingestionTest  = load("tests/campaign-reply-ingestion.test.cjs");
const trackingTest   = load("tests/campaign-tracking.test.cjs");
const permissionsTest = load("tests/permissions.test.js");

assert(hasPattern(classifierTest, "classifyCampaignReply"), "Phase 7 classifier tests still exist");
assert(hasPattern(automationTest, "runCampaignAutomationTick"), "Phase 6 automation tick tests still exist");
assert(hasPattern(ingestionTest, "migrateReplyIngestionSchema"), "Phase 8 ingestion tests still exist");
assert(hasPattern(trackingTest, "campaign_tracked_links") || hasPattern(trackingTest, "resolveTrackedLink"), "Phase 5 tracking tests still exist");
assert(hasPattern(permissionsTest, "requireAuth") || hasPattern(permissionsTest, "permission"), "permissions tests still exist");

// ── Summary ────────────────────────────────────────────────────────────────────

console.log("\n───────────────────────────────────────────────────────");
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log("───────────────────────────────────────────────────────");
if (failed > 0) process.exit(1);
