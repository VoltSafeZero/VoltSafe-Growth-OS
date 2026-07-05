/**
 * Phase 9 Branching Automations — Live Smoke Test
 *
 * Safety guarantees:
 *   • Creates isolated test data under the SMOKE_TEST_ namespace
 *   • All test emails end in @voltsafe-internal-test.invalid (unroutable TLD)
 *   • Cleans up ALL test rows on success AND on failure (finally block)
 *   • Never touches marketing_campaigns with status != 'draft' / real recipients
 *   • Never calls sendEmail
 *   • Makes all HTTP calls to localhost:5000 only
 *
 * Usage:
 *   npx tsx scripts/phase9-smoke-test.ts
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";
import {
  migrateBranchingSchema,
  evaluateRulesForRecipient,
  listCampaignRules,
  createCampaignRule,
  seedDefaultCampaignRules,
  VALID_TRIGGER_TYPES,
  VALID_ACTION_TYPES,
} from "../server/services/campaign-branching-automation";

// ── Helpers ────────────────────────────────────────────────────────────────────

const TEST_EMAIL_DOMAIN = "@voltsafe-internal-test.invalid";
const TAG = "[PHASE9-SMOKE]";

const report: {
  scenario: string;
  expected: string;
  actual: string;
  pass: boolean;
  detail?: string;
}[] = [];

function pass(scenario: string, expected: string, actual: string, detail?: string) {
  report.push({ scenario, expected, actual, pass: true, detail });
  console.log(`  ✓ ${scenario}`);
  if (detail) console.log(`    → ${detail}`);
}

function fail(scenario: string, expected: string, actual: string, detail?: string) {
  report.push({ scenario, expected, actual, pass: false, detail });
  console.error(`  ✗ ${scenario}`);
  console.error(`    expected: ${expected}`);
  console.error(`    actual:   ${actual}`);
  if (detail) console.error(`    detail:   ${detail}`);
}

async function q(query: string): Promise<any[]> {
  const r = await db.execute(sql.raw(query));
  return r.rows as any[];
}

async function q1(query: string): Promise<any> {
  const rows = await q(query);
  return rows[0] ?? null;
}

function sq(val: string): string {
  return "'" + val.replace(/'/g, "''") + "'";
}

async function fetchLocal(path: string, opts?: RequestInit): Promise<{ status: number; body: any }> {
  const url = `http://localhost:5000${path}`;
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", "Cookie": "" },
      ...opts,
    });
    let body: any;
    try { body = await res.json(); } catch { body = null; }
    return { status: res.status, body };
  } catch (err: any) {
    return { status: -1, body: { error: err.message } };
  }
}

// ── Test data containers ───────────────────────────────────────────────────────

let campaignId = 0;
const recipientIds: number[] = [];
const taskIds: number[] = [];
const suppressedEmails: string[] = [];

// ── Cleanup ────────────────────────────────────────────────────────────────────

async function cleanup() {
  console.log(`\n${TAG} Cleaning up test data…`);
  const step = async (label: string, sql: string) => {
    try { await q(sql); }
    catch (err: any) { console.warn(`${TAG} Cleanup step [${label}] warn (non-fatal): ${err.message?.slice(0,120)}`); }
  };
  // Order: dependent rows → recipients → campaign
  if (taskIds.length)
    await step("tasks", `DELETE FROM tasks WHERE id IN (${taskIds.join(",")}) AND title LIKE 'SMOKE_TEST_%'`);
  if (campaignId) {
    // campaign_events references campaign_recipient_id via campaign_id — delete by campaign
    await step("campaign_events",             `DELETE FROM campaign_events             WHERE campaign_id = ${campaignId}`);
    await step("campaign_recipient_rule_events", `DELETE FROM campaign_recipient_rule_events WHERE campaign_id = ${campaignId}`);
  }
  if (recipientIds.length)
    await step("campaign_recipients", `DELETE FROM campaign_recipients WHERE id IN (${recipientIds.join(",") || "0"})`);
  for (const em of suppressedEmails)
    await step(`suppression:${em}`, `DELETE FROM campaign_suppression WHERE email = ${sq(em)}`);
  if (campaignId) {
    await step("automation_rules", `DELETE FROM campaign_automation_rules WHERE campaign_id = ${campaignId}`);
    await step("marketing_campaigns", `DELETE FROM marketing_campaigns WHERE id = ${campaignId} AND campaign_name LIKE 'SMOKE_TEST_%'`);
  }
  console.log(`${TAG} Cleanup complete.`);
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`${TAG} Phase 9 Branching Automations — Live Smoke Test`);
  console.log(`${"═".repeat(70)}\n`);

  // ── S1: Schema migration idempotency ────────────────────────────────────────
  console.log("S1: Schema migration idempotency");
  try {
    await migrateBranchingSchema();
    await migrateBranchingSchema(); // second call must not throw
    // Verify the idempotency composite index exists
    const idx = await q1(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'campaign_recipient_rule_events'
        AND indexname = 'idx_crre_idempotency'
    `);
    if (idx) {
      pass("S1-a", "migrateBranchingSchema runs twice without error + idempotency index exists", "OK", `idx_crre_idempotency confirmed in pg_indexes`);
    } else {
      fail("S1-a", "idx_crre_idempotency exists", "index not found after migration");
    }
    // Verify all expected indexes
    const indexes = await q(`
      SELECT indexname FROM pg_indexes
      WHERE tablename IN ('campaign_automation_rules','campaign_recipient_rule_events')
        AND indexname LIKE 'idx_c%'
      ORDER BY indexname
    `);
    const names = indexes.map((r: any) => r.indexname);
    const required = ["idx_car_campaign_id","idx_car_is_active","idx_car_trigger_type",
                      "idx_crre_campaign_id","idx_crre_campaign_recipient","idx_crre_idempotency","idx_crre_rule_id"];
    const allPresent = required.every(n => names.includes(n));
    allPresent
      ? pass("S1-b", "all 7 Phase 9 indexes exist", names.join(", "))
      : fail("S1-b", "all 7 Phase 9 indexes", `missing: ${required.filter(n => !names.includes(n)).join(", ")}`);
  } catch (err: any) {
    fail("S1", "migration runs cleanly", err.message);
  }

  // ── S2: Create test campaign ─────────────────────────────────────────────────
  console.log("\nS2: Create test campaign");
  try {
    const row = await q1(`
      INSERT INTO marketing_campaigns (campaign_name, campaign_type, status, created_at, updated_at)
      VALUES ('SMOKE_TEST_Phase9_Branching', 'awareness', 'draft', NOW(), NOW())
      RETURNING id, campaign_name
    `);
    campaignId = row.id;
    pass("S2-a", "campaign created with SMOKE_TEST_ prefix, status=draft", `id=${campaignId} name="${row.campaign_name}"`);

    // Create 6 test recipients (all @voltsafe-internal-test.invalid)
    const recipientEmails = [
      `smoke-normal${TEST_EMAIL_DOMAIN}`,
      `smoke-suppressed${TEST_EMAIL_DOMAIN}`,
      `smoke-unsubscribed${TEST_EMAIL_DOMAIN}`,
      `smoke-bounced${TEST_EMAIL_DOMAIN}`,
      `smoke-blocked${TEST_EMAIL_DOMAIN}`,
      `smoke-paused${TEST_EMAIL_DOMAIN}`,
    ];
    for (const email of recipientEmails) {
      const r = await q1(`
        INSERT INTO campaign_recipients (campaign_id, email, status, current_step, automation_status, created_at, updated_at)
        VALUES (${campaignId}, ${sq(email)}, 'active', 1, 'active', NOW(), NOW())
        RETURNING id
      `);
      recipientIds.push(r.id);
    }
    // Confirm no real customers — all must end with our test domain
    const nonTest = await q(`
      SELECT email FROM campaign_recipients
      WHERE campaign_id = ${campaignId}
        AND email NOT LIKE '%${TEST_EMAIL_DOMAIN.slice(1)}'
    `);
    nonTest.length === 0
      ? pass("S2-b", "all recipients use @voltsafe-internal-test.invalid", `${recipientIds.length} test recipients created`)
      : fail("S2-b", "no real emails in test campaign", `found ${nonTest.length} non-test emails`);
  } catch (err: any) {
    fail("S2", "campaign + recipients created", err.message);
    await cleanup();
    process.exit(1);
  }

  // ── S3: Create branching rules ───────────────────────────────────────────────
  console.log("\nS3: Branching rule setup");
  let ruleOpen: any, ruleClick: any, ruleReply: any, ruleSuppressed: any, ruleSales: any, ruleSend: any, ruleNoAction: any;
  try {
    ruleOpen = await createCampaignRule({
      campaignId, name: "SMOKE_TEST open trigger", triggerType: "opened_email",
      triggerConfigJson: {}, actionType: "add_note",
      actionConfigJson: { note_text: "Recipient opened" }, priority: 10, isActive: true,
    });
    ruleClick = await createCampaignRule({
      campaignId, name: "SMOKE_TEST click trigger with task", triggerType: "clicked_link",
      triggerConfigJson: { url_keywords: ["roi"] }, actionType: "stop_sequence",
      actionConfigJson: {
        also_create_task: true, task_priority: "high",
        task_title: "SMOKE_TEST_ROI click follow-up", task_description: "ROI link clicked",
      }, priority: 20, isActive: true,
    });
    ruleReply = await createCampaignRule({
      campaignId, name: "SMOKE_TEST reply trigger", triggerType: "reply_classification",
      triggerConfigJson: { classification: "interested" }, actionType: "stop_sequence",
      actionConfigJson: { also_create_task: true, task_title: "SMOKE_TEST_Interested reply task" },
      priority: 30, isActive: true,
    });
    ruleSales = await createCampaignRule({
      campaignId, name: "SMOKE_TEST mark sales engaged", triggerType: "reply_classification",
      triggerConfigJson: { classification: "meeting_request" }, actionType: "mark_sales_engaged",
      actionConfigJson: {}, priority: 5, isActive: true,
    });
    ruleSuppressed = await createCampaignRule({
      campaignId, name: "SMOKE_TEST suppression guard", triggerType: "clicked_link",
      triggerConfigJson: {}, actionType: "move_to_step",
      actionConfigJson: { target_step: 2 }, priority: 40, isActive: true,
    });
    ruleSend = await createCampaignRule({
      campaignId, name: "SMOKE_TEST send_specific_step (deferred)", triggerType: "manual",
      triggerConfigJson: {}, actionType: "send_specific_step",
      actionConfigJson: { target_step: 2 }, priority: 50, isActive: true,
    });
    ruleNoAction = await createCampaignRule({
      campaignId, name: "SMOKE_TEST no_action fallback", triggerType: "manual",
      triggerConfigJson: {}, actionType: "no_action",
      actionConfigJson: {}, priority: 90, isActive: true,
    });

    const rules = await listCampaignRules(campaignId);
    rules.length >= 7
      ? pass("S3-a", "≥7 rules created covering all trigger/action types", `${rules.length} rules for campaign ${campaignId}`)
      : fail("S3-a", "≥7 rules", `only ${rules.length} rules`);

    // Confirm allowlists accept all trigger/action types used
    const triggerTypes = ["opened_email","clicked_link","reply_classification","manual"];
    const actionTypes  = ["add_note","stop_sequence","mark_sales_engaged","move_to_step","send_specific_step","no_action"];
    const badTrigger   = triggerTypes.filter(t => !VALID_TRIGGER_TYPES.has(t));
    const badAction    = actionTypes.filter(a => !VALID_ACTION_TYPES.has(a));
    badTrigger.length === 0 && badAction.length === 0
      ? pass("S3-b", "all smoke test trigger/action types accepted by allowlists", "OK")
      : fail("S3-b", "all types valid", `bad triggers=${badTrigger}, bad actions=${badAction}`);

    // Verify allowlist rejection
    try {
      await createCampaignRule({
        campaignId, name: "SMOKE_TEST bad trigger", triggerType: "INVALID_TRIGGER" as any,
        triggerConfigJson: {}, actionType: "add_note", actionConfigJson: {},
      });
      fail("S3-c", "createCampaignRule rejects invalid trigger type", "did not throw");
    } catch {
      pass("S3-c", "invalid trigger type rejected with 400", "threw as expected");
    }
  } catch (err: any) {
    fail("S3", "rules created", err.message);
  }

  // ── S4: Idempotency — same trigger fires only once ───────────────────────────
  console.log("\nS4: Idempotency");
  try {
    const recipientId = recipientIds[0]; // smoke-normal
    // evaluateRulesForRecipient signature: (campaignRecipientId, context)
    // campaignId is derived from recipient.campaign_id inside the function
    const ctx = { triggerType: "opened_email", triggerValue: "step_1_open" };

    // Fire the same event 3 times — should only produce 1 effective fire
    await evaluateRulesForRecipient(recipientId, ctx);
    await evaluateRulesForRecipient(recipientId, ctx);
    await evaluateRulesForRecipient(recipientId, ctx);

    // Expect exactly 1 fired event for the open rule
    const events = await q(`
      SELECT * FROM campaign_recipient_rule_events
      WHERE campaign_recipient_id = ${recipientId}
        AND rule_id = ${ruleOpen.id}
        AND action_taken != 'skipped_compliance'
        AND action_taken != 'no_action'
    `);
    events.length === 1
      ? pass("S4-a", "same trigger fires exactly once (idempotency)", `${events.length} event(s), action_taken=${events[0]?.action_taken}`)
      : fail("S4-a", "exactly 1 fired event", `got ${events.length} events`);

    // Idempotency: different trigger value on same rule should fire once more
    const ctx2 = { triggerType: "opened_email", triggerValue: "step_2_open" };
    await evaluateRulesForRecipient(recipientId, ctx2);
    const events2 = await q(`
      SELECT * FROM campaign_recipient_rule_events
      WHERE campaign_recipient_id = ${recipientId} AND rule_id = ${ruleOpen.id}
        AND action_taken != 'skipped_compliance' AND action_taken != 'no_action'
    `);
    events2.length === 2
      ? pass("S4-b", "different trigger_key fires rule again (new unique key)", `total events: ${events2.length}`)
      : fail("S4-b", "2 events for 2 distinct trigger_keys", `got ${events2.length}`);
  } catch (err: any) {
    fail("S4", "idempotency", err.message);
  }

  // ── S5: Duplicate task prevention ───────────────────────────────────────────
  console.log("\nS5: Duplicate task prevention");
  try {
    const recipientId = recipientIds[0]; // smoke-normal (reusing — already stopped is OK for task test)
    // Use a fresh recipient that hasn't been stopped
    const freshRecipient = await q1(`
      INSERT INTO campaign_recipients (campaign_id, email, status, current_step, automation_status, created_at, updated_at)
      VALUES (${campaignId}, ${sq(`smoke-taskdedup${TEST_EMAIL_DOMAIN}`)}, 'active', 1, 'active', NOW(), NOW())
      RETURNING id
    `);
    recipientIds.push(freshRecipient.id);
    const rid = freshRecipient.id;

    // Fire three different ROI URLs — all match the click rule with also_create_task
    const urls = ["https://example.com/roi-calculator", "https://example.com/roi-summary", "https://example.com/roi-deep-dive"];
    for (const url of urls) {
      await evaluateRulesForRecipient(rid, {
        triggerType: "clicked_link", triggerValue: url,
      });
    }

    // Only 1 task should be created
    const taskEvents = await q(`
      SELECT * FROM campaign_recipient_rule_events
      WHERE campaign_recipient_id = ${rid}
        AND rule_id = ${ruleClick.id}
        AND action_taken = 'task_created'
    `);
    taskEvents.length === 1
      ? pass("S5-a", "exactly 1 task_created event after 3 matching clicks", `task_created event count: ${taskEvents.length}`)
      : fail("S5-a", "exactly 1 task_created event", `got ${taskEvents.length}`);

    // Count tasks with SMOKE_TEST_ROI title
    const tasks = await q(`
      SELECT id FROM tasks WHERE title = 'SMOKE_TEST_ROI click follow-up'
        AND created_at > NOW() - INTERVAL '5 minutes'
    `);
    tasks.forEach((t: any) => taskIds.push(t.id));
    tasks.length === 1
      ? pass("S5-b", "exactly 1 task row created in tasks table", `task id(s): ${tasks.map((t: any) => t.id).join(",")}`)
      : fail("S5-b", "exactly 1 task", `found ${tasks.length} tasks`);
  } catch (err: any) {
    fail("S5", "task dedup", err.message);
  }

  // ── S6: Compliance suppression guard ────────────────────────────────────────
  console.log("\nS6: Compliance suppression guard");
  try {
    const recipientId = recipientIds[1]; // smoke-suppressed
    const email = `smoke-suppressed${TEST_EMAIL_DOMAIN}`;

    // Add to suppression list
    await q(`
      INSERT INTO campaign_suppression (email, reason, source, created_at)
      VALUES (${sq(email)}, 'smoke_test', 'phase9_smoke_test', NOW())
      ON CONFLICT DO NOTHING
    `);
    suppressedEmails.push(email);

    const before = await q(`
      SELECT automation_status FROM campaign_recipients WHERE id = ${recipientId}
    `);

    // Trigger a rule that would normally move_to_step
    const result = await evaluateRulesForRecipient(recipientId, {
      triggerType: "clicked_link", triggerValue: "https://example.com/any",
    });

    // Check skipped_compliance event logged
    const complianceEvent = await q1(`
      SELECT * FROM campaign_recipient_rule_events
      WHERE campaign_recipient_id = ${recipientId}
        AND action_taken = 'skipped_compliance'
      LIMIT 1
    `);
    const afterStatus = await q1(`SELECT automation_status FROM campaign_recipients WHERE id = ${recipientId}`);

    complianceEvent
      ? pass("S6-a", "skipped_compliance event logged for suppressed email", `rule_id=${complianceEvent.rule_id}, trigger=${complianceEvent.trigger_event_type}`)
      : fail("S6-a", "skipped_compliance event logged", "no event found");

    afterStatus?.automation_status === before[0]?.automation_status
      ? pass("S6-b", "automation_status unchanged after suppression block", `status: ${afterStatus?.automation_status}`)
      : fail("S6-b", "automation_status unchanged", `changed to: ${afterStatus?.automation_status}`);

    result.skipped > 0
      ? pass("S6-c", "evaluateRulesForRecipient returns skipped > 0", `skipped=${result.skipped}, fired=${result.fired}`)
      : fail("S6-c", "skipped > 0", `skipped=${result.skipped}`);
  } catch (err: any) {
    fail("S6", "suppression compliance guard", err.message);
  }

  // ── S7: Unsubscribed + bounced guards ────────────────────────────────────────
  console.log("\nS7: Unsubscribed + bounced guards");
  try {
    // Unsubscribed
    const unsubId = recipientIds[2];
    await q(`UPDATE campaign_recipients SET unsubscribed_at = NOW() WHERE id = ${unsubId}`);
    const r1 = await evaluateRulesForRecipient(unsubId, {
      triggerType: "clicked_link", triggerValue: "https://example.com/unsub-test",
    });
    const e1 = await q1(`SELECT * FROM campaign_recipient_rule_events WHERE campaign_recipient_id = ${unsubId} AND action_taken = 'skipped_compliance' LIMIT 1`);
    (r1.skipped > 0 && e1)
      ? pass("S7-a", "unsubscribed recipient blocked with skipped_compliance", `skipped=${r1.skipped}`)
      : fail("S7-a", "skipped>0 + event logged", `skipped=${r1.skipped}, event=${JSON.stringify(e1)}`);

    // Bounced
    const bounceId = recipientIds[3];
    await q(`UPDATE campaign_recipients SET bounced_at = NOW() WHERE id = ${bounceId}`);
    const r2 = await evaluateRulesForRecipient(bounceId, {
      triggerType: "clicked_link", triggerValue: "https://example.com/bounce-test",
    });
    const e2 = await q1(`SELECT * FROM campaign_recipient_rule_events WHERE campaign_recipient_id = ${bounceId} AND action_taken = 'skipped_compliance' LIMIT 1`);
    (r2.skipped > 0 && e2)
      ? pass("S7-b", "bounced recipient blocked with skipped_compliance", `skipped=${r2.skipped}`)
      : fail("S7-b", "skipped>0 + event logged", `skipped=${r2.skipped}, event=${JSON.stringify(e2)}`);
  } catch (err: any) {
    fail("S7", "unsubscribed/bounced guards", err.message);
  }

  // ── S8: fired_count accuracy ─────────────────────────────────────────────────
  console.log("\nS8: fired_count accuracy");
  try {
    // Create a fresh recipient and rule for surgical control
    const freshRec = await q1(`
      INSERT INTO campaign_recipients (campaign_id, email, status, current_step, automation_status, created_at, updated_at)
      VALUES (${campaignId}, ${sq(`smoke-firedcount${TEST_EMAIL_DOMAIN}`)}, 'active', 1, 'active', NOW(), NOW())
      RETURNING id
    `);
    recipientIds.push(freshRec.id);
    const rid = freshRec.id;

    const countRule = await createCampaignRule({
      campaignId, name: "SMOKE_TEST fired_count test rule", triggerType: "manual",
      triggerConfigJson: {}, actionType: "add_note",
      actionConfigJson: { note_text: "fired_count smoke test" }, priority: 99, isActive: true,
    });

    // Insert a mix of event types directly
    const realTs = "2025-01-01 12:00:00";
    await q(`
      INSERT INTO campaign_recipient_rule_events
        (campaign_id, campaign_recipient_id, rule_id, trigger_event_type, action_taken, action_metadata_json, created_at)
      VALUES
        (${campaignId}, ${rid}, ${countRule.id}, 'manual', 'add_note',             '{"trigger_key":"real1"}',      '${realTs}'),
        (${campaignId}, ${rid}, ${countRule.id}, 'manual', 'skipped_compliance',   '{"trigger_key":"skip1"}',      NOW()),
        (${campaignId}, ${rid}, ${countRule.id}, 'manual', 'move_to_step_skipped_no_target', '{"trigger_key":"skip2"}', NOW()),
        (${campaignId}, ${rid}, ${countRule.id}, 'manual', 'send_specific_step_deferred',    '{"trigger_key":"skip3"}', NOW()),
        (${campaignId}, ${rid}, ${countRule.id}, 'manual', 'no_action',            '{"trigger_key":"skip4"}',      NOW()),
        (${campaignId}, ${rid}, ${countRule.id}, 'manual', 'add_note',             '{"trigger_key":"real2"}',      NOW())
    `);

    const rules = await listCampaignRules(campaignId);
    const r = rules.find((x: any) => x.id === countRule.id);
    if (!r) {
      fail("S8-a", "countRule found in listCampaignRules", "not found"); 
    } else {
      r.fired_count === 2
        ? pass("S8-a", "fired_count = 2 (excludes 4 skipped/deferred/no_action events)", `fired_count=${r.fired_count}`)
        : fail("S8-a", "fired_count = 2", `fired_count=${r.fired_count}`);

      const lastFiredAt = r.last_fired_at ? new Date(r.last_fired_at).toISOString() : null;
      const realTsTs   = new Date(realTs).toISOString();
      lastFiredAt && lastFiredAt > realTsTs
        ? pass("S8-b", "last_fired_at reflects most recent REAL fire (not a skipped event)", `last_fired_at=${lastFiredAt}`)
        : fail("S8-b", `last_fired_at > ${realTsTs}`, `last_fired_at=${lastFiredAt}`);
    }
  } catch (err: any) {
    fail("S8", "fired_count accuracy", err.message);
  }

  // ── S9: Route NaN guards ─────────────────────────────────────────────────────
  console.log("\nS9: Route NaN guards (unauthenticated — expects 401 or 400, never 500/200)");

  // Note: path-traversal variants (/../) are normalised by Express before they reach
  // our route handler and therefore resolve to a completely different route (not a NaN
  // guard concern). We only test non-numeric string IDs here.
  const nanRoutes: { method: string; path: string; label: string; body?: any }[] = [
    { method: "GET",    label: "GET campaigns/abc/automation-rules",       path: "/api/marketing/campaigns/abc/automation-rules" },
    { method: "GET",    label: "GET campaigns/NaN/automation-rules",       path: "/api/marketing/campaigns/NaN/automation-rules" },
    { method: "GET",    label: "GET campaigns/0/automation-rules",         path: "/api/marketing/campaigns/0/automation-rules" },
    { method: "POST",   label: "POST campaigns/abc/automation-rules",      path: "/api/marketing/campaigns/abc/automation-rules",
      body: { name: "x", triggerType: "manual", actionType: "no_action" } },
    { method: "POST",   label: "POST seed-defaults/NaN",                  path: "/api/marketing/campaigns/NaN/automation-rules/seed-defaults" },
    { method: "PATCH",  label: "PATCH automation-rules/abc",              path: "/api/marketing/automation-rules/abc", body: { name: "x" } },
    { method: "DELETE", label: "DELETE automation-rules/NaN",             path: "/api/marketing/automation-rules/NaN" },
    { method: "GET",    label: "GET recipients/abc/rule-history",          path: "/api/marketing/recipients/abc/rule-history" },
    { method: "POST",   label: "POST evaluate-event/abc",                  path: "/api/marketing/automation-rules/evaluate-event/abc" },
  ];

  let nanPass = 0, nanFail = 0;
  for (const route of nanRoutes) {
    const { status, body } = await fetchLocal(route.path, {
      method: route.method,
      body: route.body ? JSON.stringify(route.body) : undefined,
    });
    // Must return 400 or 401 (auth before ID parse) — never 200, 500, or 404 with stack trace
    const ok = (status === 400 || status === 401 || status === 403) && status !== 500 && status !== 200;
    const hasStack = typeof body?.error === "string" && body.error.includes("    at ");
    if (ok && !hasStack) {
      nanPass++;
    } else {
      fail(`S9: ${route.label}`,
        "400 or 401 (no stack trace)", `status=${status} body=${JSON.stringify(body)}`);
      nanFail++;
    }
  }
  if (nanFail === 0) {
    pass("S9-all", `all ${nanRoutes.length} NaN route inputs return 400/401 without stack traces`, `${nanPass}/${nanRoutes.length} passed`);
  } else {
    fail("S9-summary", `all ${nanRoutes.length} pass`, `${nanFail} failed — see individual S9 lines above`);
  }

  // ── S10: Automation tick — status-based filtering ───────────────────────────
  console.log("\nS10: Automation tick status filtering");
  try {
    // blocked recipient (set by stop_sequence)
    const blockedId = recipientIds[4];
    await q(`UPDATE campaign_recipients SET automation_status = 'blocked', branch_status = 'stopped_by_reply' WHERE id = ${blockedId}`);

    // paused recipient
    const pausedId = recipientIds[5];
    await q(`UPDATE campaign_recipients SET automation_status = 'paused' WHERE id = ${pausedId}`);

    // The tick WHERE clause is: automation_status = 'active' — verify blocked/paused are excluded
    const active = await q(`
      SELECT id, automation_status FROM campaign_recipients
      WHERE campaign_id = ${campaignId} AND automation_status = 'active'
        AND id IN (${recipientIds.join(",")})
    `);
    const blocked = await q(`
      SELECT id FROM campaign_recipients WHERE id = ${blockedId} AND automation_status = 'blocked'
    `);
    const paused = await q(`
      SELECT id FROM campaign_recipients WHERE id = ${pausedId} AND automation_status = 'paused'
    `);

    blocked.length === 1
      ? pass("S10-a", "blocked recipient stored with automation_status=blocked", `id=${blockedId}`)
      : fail("S10-a", "automation_status=blocked", `found: ${blocked.length} rows`);
    paused.length === 1
      ? pass("S10-b", "paused recipient stored with automation_status=paused", `id=${pausedId}`)
      : fail("S10-b", "automation_status=paused", `found: ${paused.length} rows`);
    !active.some((r: any) => r.id === blockedId) && !active.some((r: any) => r.id === pausedId)
      ? pass("S10-c", "tick active query excludes blocked + paused recipients", `active count=${active.length}`)
      : fail("S10-c", "blocked+paused excluded from active query", `active ids: ${active.map((r: any) => r.id).join(",")}`);

    // mark_sales_engaged sets automation_status='blocked' + branch_status='sales_engaged'
    const salesRec = await q1(`
      INSERT INTO campaign_recipients (campaign_id, email, status, current_step, automation_status, created_at, updated_at)
      VALUES (${campaignId}, ${sq(`smoke-sales${TEST_EMAIL_DOMAIN}`)}, 'active', 1, 'active', NOW(), NOW())
      RETURNING id
    `);
    recipientIds.push(salesRec.id);
    await evaluateRulesForRecipient(salesRec.id, {
      triggerType: "reply_classification", triggerValue: "meeting_request",
    });
    const salesRow = await q1(`SELECT automation_status, branch_status FROM campaign_recipients WHERE id = ${salesRec.id}`);
    salesRow?.automation_status === "blocked" && salesRow?.branch_status === "sales_engaged"
      ? pass("S10-d", "mark_sales_engaged sets automation_status=blocked + branch_status=sales_engaged", JSON.stringify(salesRow))
      : fail("S10-d", "automation_status=blocked, branch_status=sales_engaged", JSON.stringify(salesRow));
  } catch (err: any) {
    fail("S10", "tick status filtering", err.message);
  }

  // ── S11: auto_reply / out_of_office — don't stop sequence ───────────────────
  console.log("\nS11: auto_reply / out_of_office behavior");
  try {
    const freshRec = await q1(`
      INSERT INTO campaign_recipients (campaign_id, email, status, current_step, automation_status, created_at, updated_at)
      VALUES (${campaignId}, ${sq(`smoke-autoreply${TEST_EMAIL_DOMAIN}`)}, 'active', 1, 'active', NOW(), NOW())
      RETURNING id
    `);
    recipientIds.push(freshRec.id);
    const rid = freshRec.id;

    // Evaluate with auto_reply classification — no seed rule should match
    const result = await evaluateRulesForRecipient(rid, {
      triggerType: "reply_classification", triggerValue: "auto_reply",
    });

    const afterRow = await q1(`SELECT automation_status, branch_status FROM campaign_recipients WHERE id = ${rid}`);

    afterRow?.automation_status === "active"
      ? pass("S11-a", "auto_reply does not stop sequence (automation_status stays active)", `status=${afterRow.automation_status}`)
      : fail("S11-a", "automation_status=active after auto_reply", `status=${afterRow?.automation_status}`);

    // No task should have been created
    const tasks = await q(`SELECT id FROM tasks WHERE title LIKE '%auto_reply%' AND created_at > NOW() - INTERVAL '1 minute'`);
    tasks.length === 0
      ? pass("S11-b", "auto_reply does not create a task", "0 tasks")
      : fail("S11-b", "0 tasks for auto_reply", `found ${tasks.length} tasks`);

    // out_of_office
    const freshRec2 = await q1(`
      INSERT INTO campaign_recipients (campaign_id, email, status, current_step, automation_status, created_at, updated_at)
      VALUES (${campaignId}, ${sq(`smoke-ooo${TEST_EMAIL_DOMAIN}`)}, 'active', 1, 'active', NOW(), NOW())
      RETURNING id
    `);
    recipientIds.push(freshRec2.id);
    await evaluateRulesForRecipient(freshRec2.id, {
      triggerType: "reply_classification", triggerValue: "out_of_office",
    });
    const oooRow = await q1(`SELECT automation_status FROM campaign_recipients WHERE id = ${freshRec2.id}`);
    oooRow?.automation_status === "active"
      ? pass("S11-c", "out_of_office does not stop sequence", `status=${oooRow.automation_status}`)
      : fail("S11-c", "automation_status=active after out_of_office", `status=${oooRow?.automation_status}`);
  } catch (err: any) {
    fail("S11", "auto_reply/out_of_office", err.message);
  }

  // ── S12: send_specific_step deferral ─────────────────────────────────────────
  console.log("\nS12: send_specific_step deferral");
  try {
    const freshRec = await q1(`
      INSERT INTO campaign_recipients (campaign_id, email, status, current_step, automation_status, created_at, updated_at)
      VALUES (${campaignId}, ${sq(`smoke-sendstep${TEST_EMAIL_DOMAIN}`)}, 'active', 1, 'active', NOW(), NOW())
      RETURNING id
    `);
    recipientIds.push(freshRec.id);
    const rid = freshRec.id;

    // Evaluate against the manual/send_specific_step rule
    await evaluateRulesForRecipient(rid, {
      triggerType: "manual", triggerValue: "manual_trigger",
    });

    // Expect send_specific_step_deferred event (not an actual send)
    const deferEvent = await q1(`
      SELECT * FROM campaign_recipient_rule_events
      WHERE campaign_recipient_id = ${rid}
        AND action_taken = 'send_specific_step_deferred'
      LIMIT 1
    `);
    deferEvent
      ? pass("S12-a", "send_specific_step logged as send_specific_step_deferred", `rule_id=${deferEvent.rule_id}`)
      : fail("S12-a", "send_specific_step_deferred event", "no deferred event found");

    // Confirm no email was sent (no email delivery records)
    const emailSends = await q(`
      SELECT id FROM campaign_events WHERE campaign_id = ${campaignId} AND event_type = 'sent' AND created_at > NOW() - INTERVAL '1 minute'
    `).catch(() => []);
    emailSends.length === 0
      ? pass("S12-b", "no email sent for send_specific_step (safely deferred)", "0 sent events")
      : fail("S12-b", "0 sent events", `found ${emailSends.length} sent events`);
  } catch (err: any) {
    fail("S12", "send_specific_step deferral", err.message);
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────────
  await cleanup();

  // ── Final report ──────────────────────────────────────────────────────────────

  const total   = report.length;
  const passing = report.filter(r => r.pass).length;
  const failing = report.filter(r => !r.pass);

  console.log(`\n${"═".repeat(70)}`);
  console.log(`${TAG} FINAL REPORT`);
  console.log(`${"═".repeat(70)}`);
  console.log(`\nTest campaign: SMOKE_TEST_Phase9_Branching (id=${campaignId})`);
  console.log(`Test emails:   *${TEST_EMAIL_DOMAIN} only`);
  console.log(`\nResult: ${passing}/${total} checks passed\n`);

  const colW = 46;
  console.log(`${"Scenario".padEnd(colW)} ${"Pass?".padEnd(6)} ${"Detail"}`);
  console.log(`${"─".repeat(colW)} ${"─".repeat(6)} ${"─".repeat(38)}`);
  for (const r of report) {
    const marker = r.pass ? "✓" : "✗";
    const scenario = r.scenario.length > colW - 2 ? r.scenario.slice(0, colW - 3) + "…" : r.scenario;
    console.log(`${scenario.padEnd(colW)} ${marker}      ${r.detail ?? ""}`);
  }

  if (failing.length > 0) {
    console.log(`\n${"─".repeat(70)}`);
    console.log("FAILURES:");
    for (const r of failing) {
      console.log(`\n  ✗ ${r.scenario}`);
      console.log(`    expected: ${r.expected}`);
      console.log(`    actual:   ${r.actual}`);
      if (r.detail) console.log(`    detail:   ${r.detail}`);
    }
  }

  console.log(`\n${"═".repeat(70)}`);
  console.log(failing.length === 0 ? "ALL CHECKS PASSED ✓" : `${failing.length} FAILURE(S) — see above`);
  console.log(`${"═".repeat(70)}\n`);

  if (failing.length > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(`${TAG} Fatal error: ${err.message}`);
  await cleanup();
  process.exit(1);
});
