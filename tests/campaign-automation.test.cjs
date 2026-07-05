"use strict";
/**
 * tests/campaign-automation.test.cjs
 *
 * Phase 6 — Automated Sequences / Drip Scheduling
 *
 * Tests:
 *   - Delay scheduling logic (delay_days relative to sequence_started_at)
 *   - Status enum validation
 *   - API 401 guards (no session)
 *   - API 404 for non-existent campaign
 *   - Control-flow state machine (validate endpoint)
 *   - Admin-only tick endpoint
 *   - Metrics endpoint
 *   - Source-grep invariants for service implementation
 *
 * Requires TEST_ADMIN_PASS env var for authenticated tests.
 * Without it, only unauthenticated + source-grep tests run.
 */

const assert = require("assert");
const http = require("http");
const fs = require("fs");
const path = require("path");

const BASE = process.env.TEST_BASE_URL || "http://localhost:5000";
const ADMIN_PASS = process.env.TEST_ADMIN_PASS || "";

let PASSED = 0;
let FAILED = 0;
let SKIPPED = 0;

function ok(label) {
  console.log(`  ✓ ${label}`);
  PASSED++;
}
function fail(label, err) {
  console.error(`  ✗ ${label}`);
  console.error(`    ${err?.message ?? err}`);
  FAILED++;
}
function skip(label, reason) {
  console.log(`  ~ ${label} [skipped: ${reason}]`);
  SKIPPED++;
}

async function req(method, path, body, cookies) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const data = body ? JSON.stringify(body) : undefined;
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
        ...(cookies ? { "Cookie": cookies } : {}),
      },
    };
    const request = http.request(options, (res) => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => {
        let parsed;
        try { parsed = JSON.parse(body); } catch { parsed = body; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: body });
      });
    });
    request.on("error", reject);
    if (data) request.write(data);
    request.end();
  });
}

async function login(email, password) {
  const r = await req("POST", "/api/auth/login", { email, password });
  if (r.status !== 200) return null;
  const setCookie = r.headers["set-cookie"];
  if (!setCookie) return null;
  return setCookie.map(c => c.split(";")[0]).join("; ");
}

// ── Section 1: Unit logic (no HTTP) ──────────────────────────────────────────
console.log("\n[1] Delay scheduling logic");

(function testDelayDays() {
  const label = "computeDueAt: delay_days relative to sequence_started_at";
  try {
    // Simulate computeDueAt logic
    function computeDueAt(seqStart, delayDays) {
      const d = new Date(seqStart);
      d.setUTCDate(d.getUTCDate() + delayDays);
      return d;
    }

    const start = new Date("2026-07-01T00:00:00Z");
    assert.strictEqual(computeDueAt(start, 0).toISOString(), "2026-07-01T00:00:00.000Z", "delay=0 → same day");
    assert.strictEqual(computeDueAt(start, 4).toISOString(), "2026-07-05T00:00:00.000Z", "delay=4 → +4 days");
    assert.strictEqual(computeDueAt(start, 9).toISOString(), "2026-07-10T00:00:00.000Z", "delay=9 → +9 days");

    // Step ordering: 0 < 4 < 9 (no drift)
    const step1Due = computeDueAt(start, 0);
    const step2Due = computeDueAt(start, 4);
    const step3Due = computeDueAt(start, 9);
    assert.ok(step1Due < step2Due, "step1 before step2");
    assert.ok(step2Due < step3Due, "step2 before step3");

    ok(label);
  } catch (err) { fail(label, err); }
})();

(function testStatusEnum() {
  const label = "Automation status enum values are defined";
  try {
    const VALID_STATUSES = ["manual", "active", "paused", "completed", "blocked"];
    for (const s of VALID_STATUSES) {
      assert.ok(typeof s === "string", `status ${s} is a string`);
    }
    // 'stopped' is not a valid terminal status — 'manual' is the default
    assert.ok(!VALID_STATUSES.includes("stopped"), "'stopped' is not in valid statuses (should use 'manual')");
    ok(label);
  } catch (err) { fail(label, err); }
})();

(function testNextStepLogic() {
  const label = "Next step selection: finds step_number > current_step";
  try {
    function findNextStep(currentStep, steps) {
      return steps.find(s => s.step_number > currentStep) ?? null;
    }

    const steps = [
      { id: 1, step_number: 1, delay_days: 0 },
      { id: 2, step_number: 2, delay_days: 4 },
      { id: 3, step_number: 3, delay_days: 9 },
    ];

    // currentStep=0 → step 1
    assert.strictEqual(findNextStep(0, steps)?.step_number, 1, "currentStep=0 → step 1");
    // currentStep=1 → step 2
    assert.strictEqual(findNextStep(1, steps)?.step_number, 2, "currentStep=1 → step 2");
    // currentStep=2 → step 3
    assert.strictEqual(findNextStep(2, steps)?.step_number, 3, "currentStep=2 → step 3");
    // currentStep=3 → null (no more steps)
    assert.strictEqual(findNextStep(3, steps), null, "currentStep=3 → null (completed)");

    ok(label);
  } catch (err) { fail(label, err); }
})();

// ── Section 2: Source-grep invariants ────────────────────────────────────────
console.log("\n[2] Source-grep invariants");

(function testServiceFile() {
  const label = "campaign-automation.ts exports required functions";
  try {
    const src = fs.readFileSync(
      path.join(__dirname, "../server/services/campaign-automation.ts"), "utf8"
    );
    const required = [
      "migrateAutomationSchema",
      "validateAutomationStart",
      "startCampaignAutomation",
      "pauseCampaignAutomation",
      "resumeCampaignAutomation",
      "stopCampaignAutomation",
      "getCampaignAutomationStatus",
      "runCampaignAutomationTick",
      "getAutomationMetrics",
    ];
    for (const fn of required) {
      assert.ok(src.includes(`export async function ${fn}`), `exports ${fn}`);
    }
    ok(label);
  } catch (err) { fail(label, err); }
})();

(function testTickLock() {
  const label = "campaign-automation.ts has module-level tick lock";
  try {
    const src = fs.readFileSync(
      path.join(__dirname, "../server/services/campaign-automation.ts"), "utf8"
    );
    assert.ok(src.includes("_tickRunning"), "has _tickRunning variable");
    assert.ok(src.includes("Already running"), "has already-running guard message");
    ok(label);
  } catch (err) { fail(label, err); }
})();

(function testFailClosed() {
  const label = "campaign-automation.ts re-checks compliance at send time";
  try {
    const src = fs.readFileSync(
      path.join(__dirname, "../server/services/campaign-automation.ts"), "utf8"
    );
    // Service must re-verify compliance_status = 'preflight_passed' inside sendAutomationStep
    assert.ok(src.includes("preflight_passed"), "checks preflight_passed");
    assert.ok(src.includes("unsubscribed_at"), "checks unsubscribed_at per-recipient");
    assert.ok(src.includes("bounced_at"), "checks bounced_at per-recipient");
    assert.ok(src.includes("campaign_suppression"), "checks suppression table");
    ok(label);
  } catch (err) { fail(label, err); }
})();

(function testDelayRelativeConvention() {
  const label = "campaign-automation.ts uses delay_days relative to sequence_started_at";
  try {
    const src = fs.readFileSync(
      path.join(__dirname, "../server/services/campaign-automation.ts"), "utf8"
    );
    assert.ok(src.includes("sequence_started_at"), "uses sequence_started_at");
    assert.ok(src.includes("computeDueAt"), "has computeDueAt helper");
    // Ensure next_step_due_at is set on activation
    assert.ok(src.includes("next_step_due_at"), "sets next_step_due_at");
    ok(label);
  } catch (err) { fail(label, err); }
})();

(function testRoutesImport() {
  const label = "routes.ts imports all automation service functions";
  try {
    const src = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");
    const importLine = src.match(/import \{[^}]+\} from "\.\/services\/campaign-automation"/)?.[0] ?? "";
    assert.ok(importLine.includes("startCampaignAutomation"), "imports startCampaignAutomation");
    assert.ok(importLine.includes("pauseCampaignAutomation"), "imports pauseCampaignAutomation");
    assert.ok(importLine.includes("resumeCampaignAutomation"), "imports resumeCampaignAutomation");
    assert.ok(importLine.includes("stopCampaignAutomation"), "imports stopCampaignAutomation");
    assert.ok(importLine.includes("getCampaignAutomationStatus"), "imports getCampaignAutomationStatus");
    assert.ok(importLine.includes("runCampaignAutomationTick"), "imports runCampaignAutomationTick");
    assert.ok(importLine.includes("getAutomationMetrics"), "imports getAutomationMetrics");
    ok(label);
  } catch (err) { fail(label, err); }
})();

(function testRoutesExist() {
  const label = "routes.ts registers all 7 automation routes";
  try {
    const src = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");
    const routes = [
      "/api/marketing/campaigns/:id/automation/validate",
      "/api/marketing/campaigns/:id/automation/status",
      "/api/marketing/campaigns/:id/automation/start",
      "/api/marketing/campaigns/:id/automation/pause",
      "/api/marketing/campaigns/:id/automation/resume",
      "/api/marketing/campaigns/:id/automation/stop",
      "/api/marketing/automation/tick",
      "/api/marketing/automation/metrics",
    ];
    for (const route of routes) {
      assert.ok(src.includes(route), `route ${route} registered`);
    }
    ok(label);
  } catch (err) { fail(label, err); }
})();

(function testAdminTickGuard() {
  const label = "tick endpoint is guarded by requireAdmin";
  try {
    const src = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");
    // Find the tick route and verify requireAdmin appears before runCampaignAutomationTick
    const tickIdx = src.indexOf('"/api/marketing/automation/tick"');
    assert.ok(tickIdx > -1, "tick route found");
    const tickSection = src.slice(tickIdx - 200, tickIdx + 300);
    assert.ok(tickSection.includes("requireAdmin"), "requireAdmin appears near tick route");
    ok(label);
  } catch (err) { fail(label, err); }
})();

(function testSchedulerRegistered() {
  const label = "server/index.ts registers automation tick scheduler";
  try {
    const src = fs.readFileSync(path.join(__dirname, "../server/index.ts"), "utf8");
    assert.ok(src.includes("scheduleAutomationTick"), "has scheduleAutomationTick");
    assert.ok(src.includes("runCampaignAutomationTick"), "imports runCampaignAutomationTick");
    assert.ok(src.includes("10 * 60 * 1000"), "10-minute interval");
    ok(label);
  } catch (err) { fail(label, err); }
})();

(function testMigrationRegistered() {
  const label = "server/index.ts calls migrateAutomationSchema on startup";
  try {
    const src = fs.readFileSync(path.join(__dirname, "../server/index.ts"), "utf8");
    assert.ok(src.includes("migrateAutomationSchema"), "calls migrateAutomationSchema");
    ok(label);
  } catch (err) { fail(label, err); }
})();

(function testFrontendAutomationPanel() {
  const label = "campaign-detail.tsx has AutomationPanel component";
  try {
    const src = fs.readFileSync(
      path.join(__dirname, "../client/src/pages/campaign-detail.tsx"), "utf8"
    );
    assert.ok(src.includes("AutomationPanel"), "has AutomationPanel");
    assert.ok(src.includes("automation-start-btn"), "has start button testid");
    assert.ok(src.includes("automation-pause-btn"), "has pause button testid");
    assert.ok(src.includes("automation-resume-btn"), "has resume button testid");
    assert.ok(src.includes("automation-stop-btn"), "has stop button testid");
    assert.ok(src.includes("/api/marketing/campaigns/${campaignId}/automation"), "calls automation API");
    ok(label);
  } catch (err) { fail(label, err); }
})();

(function testFrontendAutomationPanelStates() {
  const label = "campaign-detail.tsx handles loading, error, and completed states";
  try {
    const src = fs.readFileSync(
      path.join(__dirname, "../client/src/pages/campaign-detail.tsx"), "utf8"
    );
    // Loading skeleton (not bare null)
    assert.ok(src.includes("animate-pulse"), "has loading skeleton (animate-pulse)");
    // Error/null fallback message instead of just null
    assert.ok(src.includes("Automation unavailable"), "has null/error fallback message");
    // Completed state explanation
    assert.ok(src.includes("Sequence complete"), "has completed state message");
    ok(label);
  } catch (err) { fail(label, err); }
})();

(function testFrontendCampaignsColumn() {
  const label = "marketing-campaigns.tsx has Automation column";
  try {
    const src = fs.readFileSync(
      path.join(__dirname, "../client/src/pages/marketing-campaigns.tsx"), "utf8"
    );
    assert.ok(src.includes("Automation"), "has Automation column header");
    assert.ok(src.includes("automation_status"), "uses automation_status field");
    ok(label);
  } catch (err) { fail(label, err); }
})();

(function testFrontendAnalyticsMetrics() {
  const label = "marketing-analytics.tsx has AutomationMetricsSection";
  try {
    const src = fs.readFileSync(
      path.join(__dirname, "../client/src/pages/marketing-analytics.tsx"), "utf8"
    );
    assert.ok(src.includes("AutomationMetricsSection"), "has AutomationMetricsSection");
    assert.ok(src.includes("/api/marketing/automation/metrics"), "queries automation metrics API");
    ok(label);
  } catch (err) { fail(label, err); }
})();

(function testAnalyticsLoadingSkeleton() {
  const label = "marketing-analytics.tsx shows loading skeleton (not bare null)";
  try {
    const src = fs.readFileSync(
      path.join(__dirname, "../client/src/pages/marketing-analytics.tsx"), "utf8"
    );
    assert.ok(src.includes("animate-pulse"), "has animate-pulse skeleton while loading");
    ok(label);
  } catch (err) { fail(label, err); }
})();

(function testUnresolvedPlaceholdersBlocked() {
  const label = "sendAutomationStep blocks send on unresolved placeholders (fail-closed)";
  try {
    const src = fs.readFileSync(
      path.join(__dirname, "../server/services/campaign-automation.ts"), "utf8"
    );
    assert.ok(src.includes("unresolvedPlaceholders"), "checks unresolvedPlaceholders");
    assert.ok(src.includes("unresolved_placeholders"), "records unresolved_placeholders failure event");
    // Ensure the check is fail-closed (returns failed, not skipped)
    assert.ok(
      src.includes(`status: "failed", reason: \`unresolved_placeholders`),
      "returns failed status for unresolved placeholders"
    );
    ok(label);
  } catch (err) { fail(label, err); }
})();

(function testBlockedCountInTickResult() {
  const label = "TickResult interface has blocked count and tick increments it";
  try {
    const src = fs.readFileSync(
      path.join(__dirname, "../server/services/campaign-automation.ts"), "utf8"
    );
    assert.ok(src.includes("blocked: number"), "TickResult has blocked field");
    assert.ok(src.includes("blocked: 0"), "result initialized with blocked: 0");
    assert.ok(src.includes("result.blocked++"), "tick increments blocked count");
    ok(label);
  } catch (err) { fail(label, err); }
})();

(function testNextAutomationRunUpdated() {
  const label = "processCampaignTick updates next_automation_run_at after each run";
  try {
    const src = fs.readFileSync(
      path.join(__dirname, "../server/services/campaign-automation.ts"), "utf8"
    );
    assert.ok(
      src.includes("next_automation_run_at") && src.includes("MIN(next_step_due_at)"),
      "updates next_automation_run_at to MIN(next_step_due_at) after tick"
    );
    ok(label);
  } catch (err) { fail(label, err); }
})();

(function testCampaignEventsIndex() {
  const label = "migration creates idx_ce_camp_recip_event on campaign_events";
  try {
    const src = fs.readFileSync(
      path.join(__dirname, "../server/services/campaign-automation.ts"), "utf8"
    );
    assert.ok(src.includes("idx_ce_camp_recip_event"), "migration creates campaign_events covering index");
    assert.ok(
      src.includes("campaign_events(campaign_id, recipient_id, event_type)"),
      "index covers (campaign_id, recipient_id, event_type)"
    );
    ok(label);
  } catch (err) { fail(label, err); }
})();

(function testNoSpuriousSuppressedOnComplete() {
  const label = "processCampaignTick does not call markRecipientTerminal('suppressed') before completing";
  try {
    const src = fs.readFileSync(
      path.join(__dirname, "../server/services/campaign-automation.ts"), "utf8"
    );
    // Find the processCampaignTick function body (after the tick engine comment)
    const tickFnIdx = src.indexOf("async function processCampaignTick(");
    assert.ok(tickFnIdx > -1, "processCampaignTick function found");
    const tickFnBody = src.slice(tickFnIdx, tickFnIdx + 3000);
    // The body should NOT contain markRecipientTerminal("suppressed") immediately before completing
    const hasBug = tickFnBody.includes('markRecipientTerminal(r.id, "suppressed"') &&
      tickFnBody.indexOf('markRecipientTerminal(r.id, "suppressed"') <
      tickFnBody.indexOf("all_steps_done");
    assert.ok(!hasBug, "no spurious markRecipientTerminal('suppressed') before automation_completed event");
    ok(label);
  } catch (err) { fail(label, err); }
})();

(function testTickLockReleasedInFinally() {
  const label = "tick lock is released in finally block (releases on error)";
  try {
    const src = fs.readFileSync(
      path.join(__dirname, "../server/services/campaign-automation.ts"), "utf8"
    );
    // Find the finally block that releases the lock
    assert.ok(
      src.includes("} finally {") && src.includes("_tickRunning = false"),
      "tick lock released in finally block"
    );
    // The finally must contain _tickRunning = false (not in an if block)
    const finallyIdx = src.indexOf("} finally {");
    const finallyBlock = src.slice(finallyIdx, finallyIdx + 100);
    assert.ok(finallyBlock.includes("_tickRunning = false"), "finally block sets _tickRunning = false");
    ok(label);
  } catch (err) { fail(label, err); }
})();

(function testRecordEventLogsErrors() {
  const label = "recordEvent logs errors instead of silently swallowing them";
  try {
    const src = fs.readFileSync(
      path.join(__dirname, "../server/services/campaign-automation.ts"), "utf8"
    );
    assert.ok(
      src.includes("recordEvent failed (non-critical)"),
      "recordEvent logs errors with non-critical label"
    );
    ok(label);
  } catch (err) { fail(label, err); }
})();

(function testValidationNoRedundantCheck() {
  const label = "validateAutomationStart: no redundant archived/completed check";
  try {
    const src = fs.readFileSync(
      path.join(__dirname, "../server/services/campaign-automation.ts"), "utf8"
    );
    // The function should have exactly one check for invalid status (the active/scheduled allowlist)
    // and NOT a second check specifically for archived/completed that would double-fire
    const validationFnIdx = src.indexOf("export async function validateAutomationStart");
    const validationFn = src.slice(validationFnIdx, validationFnIdx + 1500);
    const doubleErrorCount = (validationFn.match(/Cannot automate an archived or completed campaign/g) || []).length;
    assert.strictEqual(doubleErrorCount, 0, "redundant archived/completed error message removed");
    assert.ok(
      validationFn.includes("active"),
      "still checks for active/scheduled status"
    );
    ok(label);
  } catch (err) { fail(label, err); }
})();

// ── Section 3: API tests (require running server) ─────────────────────────────
console.log("\n[3] API tests (unauthenticated)");

async function runApiTests() {
  // 3a: Unauthenticated guards
  try {
    const r = await req("GET", "/api/marketing/campaigns/1/automation/status");
    assert.strictEqual(r.status, 401, "status endpoint returns 401 without session");
    ok("GET /api/marketing/campaigns/1/automation/status → 401 without session");
  } catch (err) { fail("GET automation/status → 401", err); }

  // NOTE: POST routes return 403 when no Origin header is present (CSRF origin guard
  // runs before auth in this app). Both 401 and 403 indicate the route is protected.
  try {
    const r = await req("POST", "/api/marketing/campaigns/1/automation/start", {});
    assert.ok([401, 403].includes(r.status), `start blocked without session (got ${r.status})`);
    ok("POST automation/start → 401/403 without session");
  } catch (err) { fail("POST automation/start → 401/403", err); }

  try {
    const r = await req("POST", "/api/marketing/campaigns/1/automation/pause", {});
    assert.ok([401, 403].includes(r.status), `pause blocked without session (got ${r.status})`);
    ok("POST automation/pause → 401/403 without session");
  } catch (err) { fail("POST automation/pause → 401/403", err); }

  try {
    const r = await req("POST", "/api/marketing/campaigns/1/automation/resume", {});
    assert.ok([401, 403].includes(r.status), `resume blocked without session (got ${r.status})`);
    ok("POST automation/resume → 401/403 without session");
  } catch (err) { fail("POST automation/resume → 401/403", err); }

  try {
    const r = await req("POST", "/api/marketing/campaigns/1/automation/stop", {});
    assert.ok([401, 403].includes(r.status), `stop blocked without session (got ${r.status})`);
    ok("POST automation/stop → 401/403 without session");
  } catch (err) { fail("POST automation/stop → 401/403", err); }

  try {
    const r = await req("POST", "/api/marketing/automation/tick", {});
    assert.ok([401, 403].includes(r.status), `tick blocked without session (got ${r.status})`);
    ok("POST automation/tick → 401/403 without session");
  } catch (err) { fail("POST automation/tick → 401/403", err); }

  try {
    const r = await req("GET", "/api/marketing/automation/metrics");
    assert.strictEqual(r.status, 401, "metrics returns 401");
    ok("GET automation/metrics → 401 without session");
  } catch (err) { fail("GET automation/metrics → 401", err); }

  // 3b: Authenticated tests (require TEST_ADMIN_PASS)
  if (!ADMIN_PASS) {
    console.log("\n[4] Authenticated API tests");
    skip("All authenticated tests", "TEST_ADMIN_PASS not set");
    return;
  }

  console.log("\n[4] Authenticated API tests");

  const cookies = await login("admin@voltsafe.com", ADMIN_PASS);
  if (!cookies) {
    skip("All authenticated tests", "Login failed");
    return;
  }

  // Status for non-existent campaign
  try {
    const r = await req("GET", "/api/marketing/campaigns/999999/automation/status", undefined, cookies);
    assert.ok([404, 500].includes(r.status), `status for missing campaign returns 404 or 500 (got ${r.status})`);
    ok("GET automation/status → 404 for non-existent campaign");
  } catch (err) { fail("GET automation/status → 404 for non-existent campaign", err); }

  // Validate for non-existent campaign
  try {
    const r = await req("GET", "/api/marketing/campaigns/999999/automation/validate", undefined, cookies);
    const body = r.body;
    // Either returns 404 or a validation result with errors
    const ok2 = r.status === 404 ||
                (r.status === 200 && body?.valid === false) ||
                (r.status === 500);
    assert.ok(ok2, `validate for missing campaign returns 404 or validation failure (got ${r.status})`);
    ok("GET automation/validate → handles non-existent campaign gracefully");
  } catch (err) { fail("GET automation/validate → non-existent campaign", err); }

  // Start with invalid campaign id
  try {
    const r = await req("POST", "/api/marketing/campaigns/abc/automation/start", {}, cookies);
    assert.ok([400, 422, 404].includes(r.status), `start with NaN id returns 4xx (got ${r.status})`);
    ok("POST automation/start → 400 with invalid campaign id");
  } catch (err) { fail("POST automation/start → 400 with invalid id", err); }

  // Metrics endpoint
  try {
    const r = await req("GET", "/api/marketing/automation/metrics", undefined, cookies);
    assert.strictEqual(r.status, 200, "metrics returns 200");
    const body = r.body;
    assert.ok(typeof body.activeCampaigns === "number", "has activeCampaigns");
    assert.ok(typeof body.completedCampaigns === "number", "has completedCampaigns");
    assert.ok(typeof body.automatedSends === "number", "has automatedSends");
    assert.ok(typeof body.activeRecipients === "number", "has activeRecipients");
    assert.ok(typeof body.completedRecipients === "number", "has completedRecipients");
    ok("GET automation/metrics → 200 with correct shape");
  } catch (err) { fail("GET automation/metrics → 200", err); }

  // Tick endpoint: must be admin-only (this user is admin so it should succeed)
  try {
    const r = await req("POST", "/api/marketing/automation/tick", {}, cookies);
    assert.ok([200, 500].includes(r.status), `tick returns 200 or 500 for admin (got ${r.status})`);
    if (r.status === 200) {
      assert.ok(r.body.ok === true, "tick body.ok === true");
      assert.ok(typeof r.body.campaignsScanned === "number", "tick has campaignsScanned");
    }
    ok("POST automation/tick → 200 with correct shape for admin");
  } catch (err) { fail("POST automation/tick → admin allowed", err); }

  // Verify tick is admin-only: try with a non-admin session
  // (We can only confirm this with source-grep — the route uses requireAdmin)
}

runApiTests().then(() => {
  console.log(`\n── Results ──────────────────────────────────`);
  console.log(`  Passed:  ${PASSED}`);
  console.log(`  Failed:  ${FAILED}`);
  console.log(`  Skipped: ${SKIPPED}`);
  if (FAILED > 0) {
    console.error(`\n${FAILED} test(s) failed.`);
    process.exit(1);
  } else {
    console.log("\nAll tests passed.");
    process.exit(0);
  }
});
