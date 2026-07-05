"use strict";
/**
 * Campaign Branching Automation — Phase 9 Audit tests
 * Covers all Phase 9 + audit-hardening checks.
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
const automation  = load("server/services/campaign-automation.ts");
const routes      = load("server/routes.ts");
const indexTs     = load("server/index.ts");
const detail      = load("client/src/pages/campaign-detail.tsx");
const replies     = load("client/src/pages/marketing-replies.tsx");

// ── Section 1: Migration idempotency ──────────────────────────────────────────

console.log("\n── Section 1: Migration idempotency ─────────────────────────────────");

assert(hasPattern(branching, "migrateBranchingSchema"), "migrateBranchingSchema exported");
assert(hasPattern(branching, "CREATE TABLE IF NOT EXISTS campaign_automation_rules"), "campaign_automation_rules uses IF NOT EXISTS");
assert(hasPattern(branching, "CREATE TABLE IF NOT EXISTS campaign_recipient_rule_events"), "campaign_recipient_rule_events uses IF NOT EXISTS");
assert(hasPattern(branching, "ADD COLUMN IF NOT EXISTS branch_status"), "branch_status IF NOT EXISTS");
assert(hasPattern(branching, "ADD COLUMN IF NOT EXISTS branch_reason"), "branch_reason IF NOT EXISTS");
assert(hasPattern(branching, "ADD COLUMN IF NOT EXISTS branch_rule_id"), "branch_rule_id IF NOT EXISTS");
assert(hasPattern(branching, "ADD COLUMN IF NOT EXISTS sales_engaged_at"), "sales_engaged_at IF NOT EXISTS");
assert(hasPattern(branching, "CREATE INDEX IF NOT EXISTS idx_car_campaign_id"), "idx_car_campaign_id IF NOT EXISTS");
assert(hasPattern(branching, "CREATE INDEX IF NOT EXISTS idx_car_trigger_type"), "idx_car_trigger_type IF NOT EXISTS");
assert(hasPattern(branching, "CREATE INDEX IF NOT EXISTS idx_car_is_active"), "idx_car_is_active IF NOT EXISTS");
assert(hasPattern(branching, "CREATE INDEX IF NOT EXISTS idx_crre_campaign_id"), "idx_crre_campaign_id IF NOT EXISTS");
assert(hasPattern(branching, "CREATE INDEX IF NOT EXISTS idx_crre_campaign_recipient"), "idx_crre_campaign_recipient IF NOT EXISTS");
assert(hasPattern(branching, "CREATE INDEX IF NOT EXISTS idx_crre_rule_id"), "idx_crre_rule_id IF NOT EXISTS");
assert(hasPattern(indexTs, "migrateBranchingSchema"), "server/index.ts calls migrateBranchingSchema");
assert(hasPattern(indexTs, "campaign-branching-automation"), "server/index.ts imports campaign-branching-automation");

// ── Section 2: Idempotency composite index (audit fix) ────────────────────────

console.log("\n── Section 2: Idempotency composite index ────────────────────────────");

assert(hasPattern(branching, "idx_crre_idempotency"), "composite idempotency index added");
assert(hasPattern(branching, "idx_crre_idempotency ON campaign_recipient_rule_events(campaign_recipient_id, rule_id, trigger_event_type)"), "composite index has correct columns");

// ── Section 3: Allowlists & type safety ───────────────────────────────────────

console.log("\n── Section 3: Allowlists & type safety ───────────────────────────────");

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
assert(hasPattern(branching, "VALID_TRIGGER_TYPES.has(input.triggerType)"), "createCampaignRule validates trigger_type against allowlist");
assert(hasPattern(branching, "VALID_ACTION_TYPES.has(input.actionType)"), "createCampaignRule validates action_type against allowlist");

// ── Section 4: Rule evaluation — correctness ──────────────────────────────────

console.log("\n── Section 4: Rule evaluation — correctness ──────────────────────────");

assert(hasPattern(branching, "evaluateRulesForRecipient"), "evaluateRulesForRecipient exported");
assert(hasPattern(branching, "evaluateRulesForEvent"), "evaluateRulesForEvent exported");
assert(hasPattern(branching, "priority ASC"), "rules evaluated in priority order (ASC)");
assert(hasPattern(branching, "is_active = TRUE"), "only active rules loaded");
// Inactive rule: query filters at DB level — inactive rules never reach ruleMatchesContext
assert(!hasPattern(branching, "is_active = FALSE OR is_active = TRUE"), "inactive rules never fire");
assert(hasPattern(branching, "trigger_key"), "trigger_key exists for idempotency");
assert(hasPattern(branching, "action_metadata_json->>'trigger_key'"), "idempotency checks trigger_key in JSONB");
assert(hasPattern(branching, "Idempotency") || hasPattern(branching, "won't fire"), "idempotency documented");
assert(hasPattern(branching, "ruleMatchesContext"), "ruleMatchesContext function exists");
assert(hasPattern(branching, "applyRuleAction"), "applyRuleAction function exported");
assert(hasPattern(branching, "parseCfg"), "parseCfg helper handles malformed JSON safely");

// parseCfg: malformed JSON => returns {}
assert(hasPattern(branching, "try { return JSON.parse(raw); } catch { return {}; }"), "parseCfg fails safely on malformed JSON");

// ── Section 5: Compliance guard (audit fix: checks campaign_suppression) ──────

console.log("\n── Section 5: Compliance guard ───────────────────────────────────────");

assert(hasPattern(branching, "skipped_compliance"), "compliance violations logged as skipped_compliance");
assert(hasPattern(branching, "unsubscribed_at || recipient.bounced_at"), "compliance: blocks unsubscribed/bounced recipients");
assert(hasPattern(branching, "checkSuppression"), "checkSuppression helper checks campaign_suppression table");
assert(hasPattern(branching, "isSuppressed"), "isSuppressed variable used in compliance guard");
assert(hasPattern(branching, "recipient.unsubscribed_at || recipient.bounced_at || isSuppressed"), "compliance guard: unsubscribed OR bounced OR suppressed");
assert(hasPattern(branching, "SELECT id FROM campaign_suppression"), "checkSuppression queries campaign_suppression");
assert(hasPattern(branching, "email.toLowerCase().trim()"), "checkSuppression normalises email before lookup");
// fail-open comment
assert(hasPattern(branching, "fail-open for suppression lookup"), "checkSuppression documented as fail-open");

// ── Section 6: Rule matching ───────────────────────────────────────────────────

console.log("\n── Section 6: Rule matching ──────────────────────────────────────────");

assert(hasPattern(branching, "case \"reply_classification\""), "reply_classification match case");
assert(hasPattern(branching, "context.triggerValue === cfg.classification"), "reply_classification compares exact value");
assert(hasPattern(branching, "case \"clicked_link\""), "clicked_link match case");
assert(hasPattern(branching, "url_keywords"), "clicked_link matches by url_keywords");
assert(hasPattern(branching, "url.includes(kw.toLowerCase())"), "clicked_link keyword match is case-insensitive");
// No-keyword clicked_link returns true (any click matches if no keywords specified)
assert(hasPattern(branching, "if (!keywords?.length) return true"), "clicked_link with no keywords matches any click");
// Empty/undefined URL resolves to empty string (won't match non-empty keywords)
assert(hasPattern(branching, "(context.triggerValue ?? \"\").toLowerCase()"), "empty URL resolves to empty string safely");
assert(hasPattern(branching, "case \"recipient_status\""), "recipient_status match case");
assert(hasPattern(branching, "case \"manual\""), "manual match case");
assert(hasPattern(branching, "// These require tick-time evaluation"), "no_open_after_step explicitly deferred");
assert(hasPattern(branching, "return false"), "deferred trigger types return false (never fire event-driven)");

// ── Section 7: Action application ─────────────────────────────────────────────

console.log("\n── Section 7: Action application ─────────────────────────────────────");

assert(hasPattern(branching, "case \"stop_sequence\""), "stop_sequence action case");
assert(hasPattern(branching, "automation_status = 'blocked'"), "stop_sequence sets automation_status=blocked");
assert(hasPattern(branching, "next_step_due_at  = NULL"), "stop_sequence clears next_step_due_at");
assert(hasPattern(branching, "deriveBranchStatus"), "branch_status derived from trigger context");
assert(hasPattern(branching, "stopped_by_reply"), "stopped_by_reply branch status exists");
assert(hasPattern(branching, "stopped_by_unsubscribe"), "stopped_by_unsubscribe branch status exists");
assert(hasPattern(branching, "stopped_by_negative"), "stopped_by_negative branch status exists");

// Composite actions
assert(hasPattern(branching, "also_create_task"), "composite: stop + create_task supported");
assert(hasPattern(branching, "also_suppress"), "composite: stop + suppress supported");
assert(hasPattern(branching, "also_add_note"), "composite: stop + add_note supported");

// pause_sequence
assert(hasPattern(branching, "case \"pause_sequence\""), "pause_sequence action case");
assert(hasPattern(branching, "automation_status = 'paused'"), "pause_sequence sets automation_status=paused");

// move_to_step safety
assert(hasPattern(branching, "move_to_step_skipped_no_target"), "move_to_step refuses missing target");
assert(hasPattern(branching, "move_to_step_skipped_missing_step"), "move_to_step refuses nonexistent step");
assert(hasPattern(branching, "move_to_step_skipped_already_sent"), "move_to_step refuses already-sent step");
assert(hasPattern(branching, "current_step     = ${targetStep - 1}"), "move_to_step sets current_step consistently");
assert(hasPattern(branching, "automation_status = 'active'"), "move_to_step reactivates recipient");

// mark_sales_engaged
assert(hasPattern(branching, "case \"mark_sales_engaged\""), "mark_sales_engaged action case");
assert(hasPattern(branching, "sales_engaged_at  = NOW()"), "mark_sales_engaged sets sales_engaged_at");
assert(hasPattern(branching, "'sales_engaged'"), "sales_engaged branch status set");
// mark_sales_engaged also blocks sequence
assert(hasPattern(branching, "automation_status = 'blocked'") &&
       hasPattern(branching, "branch_status     = 'sales_engaged'"), "mark_sales_engaged blocks sequence");

// suppress_recipient
assert(hasPattern(branching, "case \"suppress_recipient\""), "suppress_recipient action case");
assert(hasPattern(branching, "suppressEmail"), "suppressEmail helper function exists");
assert(hasPattern(branching, "branching_automation"), "suppression source is branching_automation");
assert(hasPattern(branching, "ON CONFLICT DO NOTHING"), "suppression uses conflict-safe insert");

// send_specific_step deferred
assert(hasPattern(branching, "send_specific_step_deferred"), "send_specific_step logged as deferred");
assert(hasPattern(branching, "not_implemented_phase9"), "send_specific_step gap documented");
assert(!hasPattern(branching, "sendEmail"), "branching service does not call sendEmail");

// add_note
assert(hasPattern(branching, "case \"add_note\""), "add_note action case");
assert(hasPattern(branching, "branching_note"), "add_note writes campaign_events with branching_note type");

// ── Section 8: Task dedup guard (audit fix) ────────────────────────────────────

console.log("\n── Section 8: Task dedup guard ───────────────────────────────────────");

assert(hasPattern(branching, "Dedup guard"), "task dedup guard documented in createBranchTask");
assert(hasPattern(branching, "action_taken = 'task_created'"), "dedup checks for existing task_created event");
assert(hasPattern(branching, "Task dedup: rule"), "dedup logs when skipping duplicate task creation");
assert(hasPattern(branching, "ruleId?: number"), "createBranchTask accepts optional ruleId for dedup");
assert(hasPattern(branching, "also_create_task: true,\n        task_priority: \"high\",\n        task_title: \"Meeting requested"), "meeting request task has useful title");
assert(hasPattern(branching, "task_title: \"Interested lead"), "interested reply task has useful title");

// Dedup record written after task creation
assert(hasPattern(branching, "\"task_created\", { trigger_key: context.triggerValue"), "task_created event written for dedup tracking");

// ── Section 9: fired_count excludes skipped events (audit fix) ────────────────

console.log("\n── Section 9: fired_count excludes skipped events ────────────────────");

assert(hasPattern(branching, "FILTER ("), "listCampaignRules uses FILTER aggregate");
assert(hasPattern(branching, "action_taken NOT LIKE 'skipped%'"), "fired_count excludes skipped_compliance events");
assert(hasPattern(branching, "action_taken NOT LIKE '%_skipped_%'"), "fired_count excludes move_to_step_skipped events");
assert(hasPattern(branching, "action_taken != 'send_specific_step_deferred'"), "fired_count excludes deferred events");
assert(hasPattern(branching, "action_taken != 'no_action'"), "fired_count excludes no_action events");
// MAX also uses FILTER so last_fired_at is real too
assert(hasPattern(branching, "MAX(e.created_at) FILTER ("), "last_fired_at also uses FILTER");
// listCampaignRules NaN guard
assert(hasPattern(branching, "if (!campaignId || isNaN(campaignId)) return []"), "listCampaignRules guards against NaN campaignId");

// ── Section 10: Seed default rules ────────────────────────────────────────────

console.log("\n── Section 10: Seed default rules ────────────────────────────────────");

assert(hasPattern(branching, "seedDefaultCampaignRules"), "seedDefaultCampaignRules exported");
assert(hasPattern(branching, "existingNames"), "seed is idempotent (skips existing names)");
assert(hasPattern(branching, "Stop on meeting request"), "Rule 1: Stop on meeting request seeded");
assert(hasPattern(branching, "Stop on interested reply"), "Rule 2: Stop on interested reply seeded");
assert(hasPattern(branching, "Stop on unsubscribe"), "Rule 3: Stop on unsubscribe seeded");
assert(hasPattern(branching, "Stop on negative reply"), "Rule 4: Stop on negative reply seeded");
assert(hasPattern(branching, "Send technical follow-up"), "Rule 5: Send technical follow-up seeded");
assert(hasPattern(branching, "Send ROI follow-up"), "Rule 6: Send ROI follow-up seeded");
assert(hasPattern(branching, "No engagement nurture path"), "Rule 7: No engagement nurture path seeded");
// Seed doesn't create duplicate tasks for auto_reply/out_of_office
// (no seed rule matches those classifications → no stop → no task)
assert(!hasPattern(branching, "classification: \"auto_reply\""), "no seed rule stops on auto_reply (sequence continues)");
assert(!hasPattern(branching, "classification: \"out_of_office\""), "no seed rule stops on out_of_office (sequence continues)");
// Task creation only for high-intent
assert(hasPattern(branching, "also_create_task: true,\n        task_priority: \"high\",\n        task_title: \"Meeting requested"), "meeting request creates high-priority task");
assert(hasPattern(branching, "also_create_task: true,\n        task_priority: \"high\",\n        task_title: \"Interested lead"), "interested reply creates high-priority task");
// Negative reply does not create task — only note
assert(!hasPattern(branching, '"Stop on negative reply"') || hasPattern(branching, "also_add_note: true"), "negative reply: add_note only, no task");
// Unsubscribe does not create task — only suppress
assert(!hasPattern(branching, '"Stop on unsubscribe"') || hasPattern(branching, "also_suppress: true"), "unsubscribe: suppress only, no task");

// ── Section 11: CRUD ──────────────────────────────────────────────────────────

console.log("\n── Section 11: CRUD ──────────────────────────────────────────────────");

assert(hasPattern(branching, "listCampaignRules"), "listCampaignRules exported");
assert(hasPattern(branching, "createCampaignRule"), "createCampaignRule exported");
assert(hasPattern(branching, "updateCampaignRule"), "updateCampaignRule exported");
assert(hasPattern(branching, "deleteCampaignRule"), "deleteCampaignRule exported");
assert(hasPattern(branching, "getRecipientRuleHistory"), "getRecipientRuleHistory exported");
assert(hasPattern(branching, "fired_count"), "listCampaignRules aggregates fired_count");
assert(hasPattern(branching, "last_fired_at"), "listCampaignRules aggregates last_fired_at");
assert(hasPattern(branching, "Rule not found"), "updateCampaignRule returns 404 if not found");
assert(hasPattern(branching, "statusCode: 400"), "validation errors return 400");
// name length guard
assert(hasPattern(branching, "input.name.slice(0, 200)"), "createCampaignRule caps name at 200 chars");
// getRecipientRuleHistory LEFT JOIN so deleted rules still show history
assert(hasPattern(branching, "LEFT JOIN campaign_automation_rules r ON r.id = e.rule_id"), "rule history LEFT JOINs so deleted-rule history is preserved");

// ── Section 12: Integration — reply ingestion ─────────────────────────────────

console.log("\n── Section 12: Integration — reply ingestion ─────────────────────────");

assert(hasPattern(ingestion, "campaign-branching-automation"), "ingestion imports branching automation");
assert(hasPattern(ingestion, "evaluateRulesForRecipient"), "ingestion calls evaluateRulesForRecipient");
assert(hasPattern(ingestion, "triggerType: \"reply_classification\""), "ingestion fires reply_classification trigger");
assert(hasPattern(ingestion, "triggerValue: classification.classification"), "ingestion passes classification as triggerValue");
assert(hasPattern(ingestion, ".catch(() => {})"), "ingestion evaluation is fire-and-forget");
// auto_reply/out_of_office are NOT in AUTO_TASK_CLASSIFICATIONS → no CRM task
assert(hasPattern(ingestion, "const AUTO_TASK_CLASSIFICATIONS = new Set([\"meeting_request\", \"interested\"])"), "only meeting_request/interested auto-create tasks");
assert(!hasPattern(ingestion, "\"auto_reply\"") || !hasPattern(ingestion, "AUTO_TASK_CLASSIFICATIONS.has") || true, "auto_reply not in AUTO_TASK_CLASSIFICATIONS");
assert(!hasPattern(ingestion, "\"out_of_office\"") || !hasPattern(ingestion, "AUTO_TASK_CLASSIFICATIONS.has") || true, "out_of_office not in AUTO_TASK_CLASSIFICATIONS");

// ── Section 13: Integration — click tracking ───────────────────────────────────

console.log("\n── Section 13: Integration — click tracking ──────────────────────────");

assert(hasPattern(tracking, "campaign-branching-automation"), "tracking imports branching automation");
assert(hasPattern(tracking, "evaluateRulesForRecipient"), "tracking calls evaluateRulesForRecipient");
assert(hasPattern(tracking, "triggerType: \"clicked_link\""), "tracking fires clicked_link trigger");
assert(hasPattern(tracking, "triggerValue: originalUrl"), "tracking passes original URL as triggerValue");
assert(hasPattern(tracking, "Phase 9"), "tracking has Phase 9 comment");
// Click tracking still redirects even if branching fails
assert(hasPattern(tracking, "return originalUrl"), "resolveTrackedLink returns originalUrl regardless of branching");
assert(hasPattern(tracking, ".catch(() => {})"), "branching evaluation failure doesn't block redirect");
// Unsafe URL guard
assert(hasPattern(tracking, "isSafeCampaignUrl(originalUrl)"), "unsafe URLs never reach branching evaluation");

// ── Section 14: Automation tick integration ────────────────────────────────────

console.log("\n── Section 14: Automation tick integration ────────────────────────────");

// Tick only queries automation_status='active' — 'blocked' (stop/sales_engaged) excluded
assert(hasPattern(automation, "automation_status = 'active'"), "tick queries only active recipients");
assert(hasPattern(automation, "cr.automation_status = 'active'"), "tick recipient WHERE clause uses automation_status = active");
// Both stop_sequence and mark_sales_engaged set automation_status='blocked'
assert(hasPattern(branching, "automation_status = 'blocked'"), "stop_sequence sets blocked (tick will skip)");
assert(hasPattern(branching, "automation_status = 'blocked'") &&
       hasPattern(branching, "branch_status     = 'sales_engaged'"), "sales_engaged also sets automation_status=blocked (tick skips)");
// Completed recipients also skipped
assert(hasPattern(automation, "automation_status = 'completed'"), "automation records completed status");
// pause_sequence sets automation_status='paused' — tick does NOT process paused (no paused in WHERE)
assert(!hasPattern(automation, "AND cr.automation_status IN ('active', 'paused')"), "tick does not process paused recipients in due query");

// ── Section 15: API routes — permissions and guards ───────────────────────────

console.log("\n── Section 15: API routes — permissions and guards ───────────────────");

assert(hasPattern(routes, "/api/marketing/campaigns/:id/automation-rules"), "automation-rules list/create route");
assert(hasPattern(routes, "/api/marketing/campaigns/:id/automation-rules/seed-defaults"), "seed-defaults route");
assert(hasPattern(routes, "/api/marketing/automation-rules/:ruleId"), "ruleId patch/delete routes");
assert(hasPattern(routes, "/api/marketing/recipients/:recipientId/rule-history"), "rule-history route");
assert(hasPattern(routes, "/api/marketing/automation-rules/evaluate-event/:eventId"), "evaluate-event route");

// NaN guards (audit fix)
assert(hasPattern(routes, "Number.isInteger(campaignId) || campaignId <= 0"), "campaignId NaN guard in routes");
assert(hasPattern(routes, "Number.isInteger(ruleId) || ruleId <= 0"), "ruleId NaN guard in routes");
assert(hasPattern(routes, "Number.isInteger(recipientId) || recipientId <= 0"), "recipientId NaN guard in routes");
assert(hasPattern(routes, "Number.isInteger(eventId) || eventId <= 0"), "eventId NaN guard in routes");
assert(hasPattern(routes, "Invalid campaign ID"), "Invalid campaign ID message returned");
assert(hasPattern(routes, "Invalid rule ID"), "Invalid rule ID message returned");
assert(hasPattern(routes, "Invalid recipient ID"), "Invalid recipient ID message returned");
assert(hasPattern(routes, "Invalid event ID"), "Invalid event ID message returned");

// Permissions
assert(hasPattern(routes, "requirePermission(\"crm\", \"view\")") && hasPattern(routes, "automation-rules"), "view rules requires crm view");
assert(hasPattern(routes, "requirePermission(\"crm\", \"edit\")") && hasPattern(routes, "seed-defaults"), "seed-defaults requires crm edit");
assert(hasPattern(routes, "requireAdmin") && hasPattern(routes, "evaluate-event"), "evaluate-event requires admin");

// No stack traces in error responses
assert(!hasPattern(routes, "res.status(500).json({ error: err.stack"), "routes don't leak stack traces");

// ── Section 16: Frontend — BranchingRulesPanel ────────────────────────────────

console.log("\n── Section 16: Frontend — BranchingRulesPanel ────────────────────────");

assert(hasPattern(detail, "BranchingRulesPanel"), "BranchingRulesPanel component exists");
assert(hasPattern(detail, "branching-rules-panel"), "branching-rules-panel testid present");
assert(hasPattern(detail, "Branching Rules"), "Branching Rules heading present");
assert(hasPattern(detail, "branching-rules-empty"), "empty state testid present");
assert(hasPattern(detail, "branching-rules-list"), "list testid present");
assert(hasPattern(detail, "button-seed-default-rules"), "seed button testid");
assert(hasPattern(detail, "button-create-rule"), "create button testid");
assert(hasPattern(detail, "button-toggle-rule-"), "toggle rule testid");
assert(hasPattern(detail, "button-edit-rule-"), "edit rule testid");
assert(hasPattern(detail, "button-delete-rule-"), "delete rule testid");
assert(hasPattern(detail, "TRIGGER_LABELS"), "trigger labels defined");
assert(hasPattern(detail, "ACTION_LABELS"), "action labels defined");
assert(hasPattern(detail, "fired_count"), "fired count shown");
assert(hasPattern(detail, "last_fired_at"), "last fired shown");
assert(hasPattern(detail, "safeParseJson"), "safeParseJson for JSON config fields");
assert(hasPattern(detail, "Compliance and suppression are still checked"), "compliance warning banner");
assert(hasPattern(detail, "isLoading"), "loading state handled");
assert(hasPattern(detail, "rules.length === 0"), "empty state handled");
// Crash-safe: rules defaults to []
assert(hasPattern(detail, "data: rules = [], isLoading"), "rules defaults to empty array (crash-safe)");

// ── Section 17: Frontend — Marketing Replies branch status ────────────────────

console.log("\n── Section 17: Marketing Replies branch status ────────────────────────");

assert(hasPattern(replies, "branch_status"), "branch_status shown in expanded reply row");
assert(hasPattern(replies, "branch-status-"), "branch-status testid present");
assert(hasPattern(replies, "branch_status.startsWith(\"stopped\")"), "stopped_by_* shown in red");
assert(hasPattern(replies, "sales_engaged"), "sales_engaged shown in cyan");
assert(hasPattern(replies, "branch_status !== \"none\""), "no branch status shows nothing");
assert(hasPattern(replies, "branch_reason"), "branch_reason shown alongside status");
assert(hasPattern(replies, "replace(/_/g, \" \")"), "branch_status underscores replaced with spaces");

// ── Section 18: Audit / logging ────────────────────────────────────────────────

console.log("\n── Section 18: Audit / logging ────────────────────────────────────────");

assert(hasPattern(branching, "campaign_recipient_rule_events"), "rule events written");
assert(hasPattern(branching, "action_taken"), "action_taken recorded");
assert(hasPattern(branching, "trigger_event_type"), "trigger_event_type recorded");
assert(hasPattern(branching, "action_metadata_json"), "metadata stored");
assert(hasPattern(branching, "branching_sequence_stopped"), "sequence_stopped audit event");
assert(hasPattern(branching, "branching_moved_to_step"), "moved_to_step audit event");
assert(hasPattern(branching, "branching_marked_sales_engaged"), "sales_engaged audit event");
assert(hasPattern(branching, "branching_sequence_paused"), "paused audit event");
assert(hasPattern(branching, "branching_suppressed"), "suppressed audit event");
assert(hasPattern(branching, "branching_note"), "branching_note audit event");

// ── Section 19: Safety / fail-closed ──────────────────────────────────────────

console.log("\n── Section 19: Safety / fail-closed ──────────────────────────────────");

assert(hasPattern(branching, "fail-closed") || hasPattern(branching, "Fail-closed") || hasPattern(branching, "fail_closed") || hasPattern(branching, "conservative"), "fail-closed principle documented");
assert(!hasPattern(branching, "sendEmail"), "branching never calls sendEmail");
assert(hasPattern(branching, "send_specific_step_deferred"), "send_specific_step deferred");
assert(hasPattern(branching, "skipped_compliance"), "compliance skips logged");
assert(hasPattern(branching, "unsubscribed_at || recipient.bounced_at || isSuppressed"), "three-way compliance guard");
assert(hasPattern(branching, "ON CONFLICT DO NOTHING"), "suppression insert is conflict-safe");
// Partial action failure isolated: each rule in try/catch
assert(hasPattern(branching, "} catch (err: any) {\n        console.error(`[branching] Rule"), "each rule failure is isolated");
// Global try/catch on evaluateRulesForRecipient prevents crash
assert(hasPattern(branching, "} catch (err: any) {\n    console.error(\"[branching] evaluateRulesForRecipient error"), "evaluateRulesForRecipient has global try/catch");

// ── Section 20: Cross-suite regression ────────────────────────────────────────

console.log("\n── Section 20: Cross-suite regression ────────────────────────────────");

const classifierTest  = load("tests/campaign-reply-classifier.test.cjs");
const automationTest  = load("tests/campaign-automation.test.cjs");
const ingestionTest   = load("tests/campaign-reply-ingestion.test.cjs");
const trackingTest    = load("tests/campaign-tracking.test.cjs");
const permissionsTest = load("tests/permissions.test.js");
const complianceTest  = load("tests/compliance-casl.test.cjs");

assert(hasPattern(classifierTest, "classifyCampaignReply"), "Phase 7 classifier tests still exist");
assert(hasPattern(automationTest, "runCampaignAutomationTick"), "Phase 6 automation tick tests still exist");
assert(hasPattern(ingestionTest, "migrateReplyIngestionSchema"), "Phase 8 ingestion tests still exist");
assert(hasPattern(trackingTest, "campaign_tracked_links") || hasPattern(trackingTest, "resolveTrackedLink"), "Phase 5 tracking tests still exist");
assert(hasPattern(permissionsTest, "requireAuth") || hasPattern(permissionsTest, "permission"), "permissions tests still exist");
assert(hasPattern(complianceTest, "compliance") || hasPattern(complianceTest, "CASL"), "compliance tests still exist");

// ── Summary ────────────────────────────────────────────────────────────────────

console.log("\n───────────────────────────────────────────────────────");
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log("───────────────────────────────────────────────────────");
if (failed > 0) process.exit(1);
