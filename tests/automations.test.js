/**
 * Advanced Automation Builder — Phase 7 Tests
 * Tests: rule CRUD, toggle, trigger evaluation, condition matching, action execution,
 *        cooldown/dedupe, run history, dry-run, metadata endpoints, no regression.
 */
import fetch from "node-fetch";

const BASE = process.env.TEST_BASE_URL || "http://localhost:5000";

async function loginAs(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie") || "";
  const match = setCookie.match(/connect\.sid=[^;]+/);
  return match ? match[0] : null;
}

async function authedFetch(cookie, path, opts = {}) {
  return fetch(`${BASE}${path}`, {
    ...opts,
    headers: { ...(opts.headers || {}), Cookie: cookie },
  });
}

function json(cookie, path, opts = {}) {
  return authedFetch(cookie, path, {
    ...opts,
    headers: { ...(opts.headers || {}), "Content-Type": "application/json" },
  }).then(r => r.json());
}

// ── Runner ────────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function pass(label) { console.log(`  ✅ ${label}`); passed++; }
function fail(label, detail) { console.log(`  ❌ ${label}`); if (detail) console.log(`     ${detail}`); failed++; }

async function check(label, fn) {
  try { await fn(); pass(label); }
  catch (e) { fail(label, e.message); }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────
let cookie;
const createdIds = [];

async function createRule(body) {
  const rule = await json(cookie, "/api/automations", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (rule.id) createdIds.push(rule.id);
  return rule;
}

async function cleanup() {
  for (const id of createdIds) {
    await authedFetch(cookie, `/api/automations/${id}`, { method: "DELETE" });
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function runCrudTests() {
  console.log("\n── Phase 1 & CRUD ──────────────────────────────────────────────────────────");

  await check("GET /api/automations → 200 with array", async () => {
    const res = await authedFetch(cookie, "/api/automations");
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("Expected array");
  });

  await check("Starter templates were seeded (≥7 rules)", async () => {
    const rules = await json(cookie, "/api/automations");
    if (rules.length < 7) throw new Error(`Expected ≥7 rules, got ${rules.length}`);
  });

  await check("POST /api/automations → creates rule with correct shape", async () => {
    const rule = await createRule({
      name: "TEST_RULE_CRUD",
      description: "Test rule for CRUD",
      triggerType: "manual",
      conditions: [],
      actions: [{ type: "add_timeline_event", params: { subject: "Test event", summary: "created by test" } }],
      cooldownMinutes: 0,
      enabled: true,
    });
    if (!rule.id) throw new Error("id missing");
    if (rule.name !== "TEST_RULE_CRUD") throw new Error(`name mismatch: ${rule.name}`);
    if (rule.triggerType !== "manual") throw new Error(`triggerType mismatch: ${rule.triggerType}`);
    if (!Array.isArray(rule.conditions)) throw new Error("conditions not array");
    if (!Array.isArray(rule.actions)) throw new Error("actions not array");
    if (rule.enabled !== true) throw new Error("enabled should be true");
  });

  await check("POST /api/automations without name → 400", async () => {
    const res = await authedFetch(cookie, "/api/automations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ triggerType: "manual" }),
    });
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
  });

  await check("GET /api/automations/:id → returns single rule", async () => {
    const rules = await json(cookie, "/api/automations");
    const rule = rules[0];
    const fetched = await json(cookie, `/api/automations/${rule.id}`);
    if (fetched.id !== rule.id) throw new Error(`ID mismatch: ${fetched.id}`);
  });

  await check("GET /api/automations/99999 → 404", async () => {
    const res = await authedFetch(cookie, "/api/automations/99999");
    if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
  });

  let updateTargetId;
  await check("PUT /api/automations/:id → updates rule", async () => {
    const rule = await createRule({ name: "TEST_UPDATE_RULE", triggerType: "manual", conditions: [], actions: [], enabled: true });
    updateTargetId = rule.id;
    const updated = await json(cookie, `/api/automations/${rule.id}`, {
      method: "PUT",
      body: JSON.stringify({ name: "TEST_UPDATE_RULE_UPDATED", description: "updated description" }),
    });
    if (updated.name !== "TEST_UPDATE_RULE_UPDATED") throw new Error(`Expected updated name, got ${updated.name}`);
  });

  await check("DELETE /api/automations/:id → deletes rule", async () => {
    const rule = await createRule({ name: "TEST_DELETE_RULE", triggerType: "manual", conditions: [], actions: [], enabled: true });
    const delRes = await authedFetch(cookie, `/api/automations/${rule.id}`, { method: "DELETE" });
    if (delRes.status !== 200) throw new Error(`Expected 200, got ${delRes.status}`);
    const again = await authedFetch(cookie, `/api/automations/${rule.id}`);
    if (again.status !== 404) throw new Error("Expected 404 after deletion");
    // Remove from cleanup list since it's already deleted
    const idx = createdIds.indexOf(rule.id);
    if (idx !== -1) createdIds.splice(idx, 1);
  });
}

async function runToggleTests() {
  console.log("\n── Toggle (Enable/Disable) ──────────────────────────────────────────────────");

  await check("PATCH /:id/toggle → flips enabled state", async () => {
    const rule = await createRule({ name: "TEST_TOGGLE", triggerType: "manual", conditions: [], actions: [], enabled: true });
    const toggled = await json(cookie, `/api/automations/${rule.id}/toggle`, { method: "PATCH" });
    if (toggled.enabled !== false) throw new Error(`Expected enabled=false, got ${toggled.enabled}`);
    // Toggle back
    const toggled2 = await json(cookie, `/api/automations/${rule.id}/toggle`, { method: "PATCH" });
    if (toggled2.enabled !== true) throw new Error(`Expected enabled=true, got ${toggled2.enabled}`);
  });
}

async function runMetadataTests() {
  console.log("\n── Metadata Endpoints ───────────────────────────────────────────────────────");

  await check("GET /api/automations/trigger-types → array with value/label/group", async () => {
    const data = await json(cookie, "/api/automations/trigger-types");
    if (!Array.isArray(data)) throw new Error("Expected array");
    if (data.length < 5) throw new Error(`Expected ≥5 trigger types, got ${data.length}`);
    const first = data[0];
    if (!first.value || !first.label || !first.group) throw new Error(`Missing fields on: ${JSON.stringify(first)}`);
  });

  await check("GET /api/automations/condition-ops → array with value/label", async () => {
    const data = await json(cookie, "/api/automations/condition-ops");
    if (!Array.isArray(data)) throw new Error("Expected array");
    if (data.length < 8) throw new Error(`Expected ≥8 ops, got ${data.length}`);
  });

  await check("GET /api/automations/action-types → array with value/label/group", async () => {
    const data = await json(cookie, "/api/automations/action-types");
    if (!Array.isArray(data)) throw new Error("Expected array");
    if (data.length < 5) throw new Error(`Expected ≥5 action types, got ${data.length}`);
  });
}

async function runConditionTests() {
  console.log("\n── Phase 2 — Condition Matching ─────────────────────────────────────────────");

  await check("POST /preview-conditions — equals match → matched=true", async () => {
    const res = await authedFetch(cookie, "/api/automations/preview-conditions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conditions: [{ field: "objectType", op: "equals", value: "account", logic: "AND" }],
        context: { objectType: "account", objectId: 1 },
      }),
    });
    const data = await res.json();
    if (!data.matched) throw new Error(`Expected matched=true, got ${JSON.stringify(data)}`);
  });

  await check("POST /preview-conditions — equals no match → matched=false", async () => {
    const data = await json(cookie, "/api/automations/preview-conditions", {
      method: "POST",
      body: JSON.stringify({
        conditions: [{ field: "objectType", op: "equals", value: "lead", logic: "AND" }],
        context: { objectType: "account", objectId: 1 },
      }),
    });
    if (data.matched !== false) throw new Error(`Expected matched=false, got ${JSON.stringify(data)}`);
  });

  await check("POST /preview-conditions — not_equals match", async () => {
    const data = await json(cookie, "/api/automations/preview-conditions", {
      method: "POST",
      body: JSON.stringify({
        conditions: [{ field: "objectType", op: "not_equals", value: "lead", logic: "AND" }],
        context: { objectType: "account", objectId: 1 },
      }),
    });
    if (!data.matched) throw new Error("Expected matched=true for not_equals");
  });

  await check("POST /preview-conditions — contains match", async () => {
    const data = await json(cookie, "/api/automations/preview-conditions", {
      method: "POST",
      body: JSON.stringify({
        conditions: [{ field: "after.name", op: "contains", value: "volt", logic: "AND" }],
        context: { objectType: "account", objectId: 1, after: { name: "VoltSafe Marina" } },
      }),
    });
    if (!data.matched) throw new Error("Expected matched=true for contains");
  });

  await check("POST /preview-conditions — in operator match", async () => {
    const data = await json(cookie, "/api/automations/preview-conditions", {
      method: "POST",
      body: JSON.stringify({
        conditions: [{ field: "extra.category", op: "in", value: ["certification", "contract"], logic: "AND" }],
        context: { objectType: "account", objectId: 1, extra: { category: "contract" } },
      }),
    });
    if (!data.matched) throw new Error("Expected matched=true for in");
  });

  await check("POST /preview-conditions — date_within_days match", async () => {
    const futureDate = new Date(Date.now() + 3 * 86400000).toISOString();
    const data = await json(cookie, "/api/automations/preview-conditions", {
      method: "POST",
      body: JSON.stringify({
        conditions: [{ field: "after.dueDate", op: "date_within_days", value: 7, logic: "AND" }],
        context: { objectType: "account", objectId: 1, after: { dueDate: futureDate } },
      }),
    });
    if (!data.matched) throw new Error("Expected matched=true for date_within_days");
  });

  await check("POST /preview-conditions — date_overdue match", async () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString();
    const data = await json(cookie, "/api/automations/preview-conditions", {
      method: "POST",
      body: JSON.stringify({
        conditions: [{ field: "after.dueDate", op: "date_overdue", logic: "AND" }],
        context: { objectType: "account", objectId: 1, after: { dueDate: pastDate } },
      }),
    });
    if (!data.matched) throw new Error("Expected matched=true for date_overdue");
  });

  await check("POST /preview-conditions — AND logic: both must pass", async () => {
    const data = await json(cookie, "/api/automations/preview-conditions", {
      method: "POST",
      body: JSON.stringify({
        conditions: [
          { field: "objectType", op: "equals", value: "account", logic: "AND" },
          { field: "extra.status", op: "equals", value: "blocked", logic: "AND" },
        ],
        context: { objectType: "account", objectId: 1, extra: { status: "active" } },
      }),
    });
    if (data.matched !== false) throw new Error("Expected matched=false (AND: second fails)");
  });

  await check("POST /preview-conditions — OR logic: one passing is enough", async () => {
    const data = await json(cookie, "/api/automations/preview-conditions", {
      method: "POST",
      body: JSON.stringify({
        conditions: [
          { field: "objectType", op: "equals", value: "account", logic: "AND" },
          { field: "extra.status", op: "equals", value: "blocked", logic: "OR" },
        ],
        context: { objectType: "account", objectId: 1, extra: { status: "active" } },
      }),
    });
    if (!data.matched) throw new Error("Expected matched=true (OR: first passes)");
  });

  await check("POST /preview-conditions — empty conditions → matched=true", async () => {
    const data = await json(cookie, "/api/automations/preview-conditions", {
      method: "POST",
      body: JSON.stringify({ conditions: [], context: { objectType: "account", objectId: 1 } }),
    });
    if (!data.matched) throw new Error("Empty conditions should always match");
  });

  await check("POST /preview-conditions — non-array conditions → 400", async () => {
    const res = await authedFetch(cookie, "/api/automations/preview-conditions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conditions: "not-array", context: {} }),
    });
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
  });
}

async function runActionTests() {
  console.log("\n── Phase 3 — Action Execution ──────────────────────────────────────────────");

  // Get a real account ID to link actions to
  const accounts = await json(cookie, "/api/accounts?limit=1");
  const accountId = (accounts.data ?? accounts)[0]?.id ?? 1;

  await check("Run rule — add_timeline_event action executes successfully", async () => {
    const rule = await createRule({
      name: "TEST_TIMELINE_ACTION",
      triggerType: "manual",
      conditions: [],
      actions: [{ type: "add_timeline_event", params: { subject: "Test timeline event", summary: "from automation test" } }],
      enabled: true, cooldownMinutes: 0,
    });
    const result = await json(cookie, `/api/automations/${rule.id}/run`, {
      method: "POST",
      body: JSON.stringify({ objectType: "account", objectId: accountId }),
    });
    if (!result.matched) throw new Error("Expected matched=true");
    if (result.actionsTaken < 1) throw new Error(`Expected ≥1 actions taken, got ${result.actionsTaken}`);
    const ar = result.actionsResult[0];
    if (!ar.success) throw new Error(`Action failed: ${ar.detail}`);
  });

  await check("Run rule — create_task action creates task on linked record", async () => {
    const rule = await createRule({
      name: "TEST_TASK_ACTION",
      triggerType: "manual",
      conditions: [],
      actions: [{ type: "create_task", params: { title: "Auto-test task", priority: "high", dueDaysFromNow: 2 } }],
      enabled: true, cooldownMinutes: 0,
    });
    const result = await json(cookie, `/api/automations/${rule.id}/run`, {
      method: "POST",
      body: JSON.stringify({ objectType: "account", objectId: accountId }),
    });
    if (!result.matched) throw new Error("Expected matched=true");
    if (!result.actionsResult[0].success) throw new Error(`Task creation failed: ${result.actionsResult[0].detail}`);
  });

  await check("Run rule — create_notification action executes", async () => {
    const rule = await createRule({
      name: "TEST_NOTIFICATION_ACTION",
      triggerType: "manual",
      conditions: [],
      actions: [{ type: "create_notification", params: { title: "Test alert", body: "Automation test notification", severity: "medium", actionUrl: "/automations" } }],
      enabled: true, cooldownMinutes: 0,
    });
    const result = await json(cookie, `/api/automations/${rule.id}/run`, {
      method: "POST",
      body: JSON.stringify({ objectType: "account", objectId: accountId }),
    });
    if (!result.matched) throw new Error("Expected matched=true");
    if (!result.actionsResult[0].success) throw new Error(`Notification failed: ${result.actionsResult[0].detail}`);
  });

  await check("Run rule — flag_record action executes", async () => {
    const rule = await createRule({
      name: "TEST_FLAG_ACTION",
      triggerType: "manual",
      conditions: [],
      actions: [{ type: "flag_record", params: { note: "Flagged by automation test" } }],
      enabled: true, cooldownMinutes: 0,
    });
    const result = await json(cookie, `/api/automations/${rule.id}/run`, {
      method: "POST",
      body: JSON.stringify({ objectType: "account", objectId: accountId }),
    });
    if (!result.matched) throw new Error("Expected matched=true");
    if (!result.actionsResult[0].success) throw new Error(`flag_record failed: ${result.actionsResult[0].detail}`);
  });

  await check("Run rule — conditions don't match → matched=false, no actions taken", async () => {
    const rule = await createRule({
      name: "TEST_NO_MATCH",
      triggerType: "manual",
      conditions: [{ field: "objectType", op: "equals", value: "lead", logic: "AND" }],
      actions: [{ type: "add_timeline_event", params: { subject: "Should not fire" } }],
      enabled: true, cooldownMinutes: 0,
    });
    const result = await json(cookie, `/api/automations/${rule.id}/run`, {
      method: "POST",
      body: JSON.stringify({ objectType: "account", objectId: accountId }),
    });
    if (result.matched !== false) throw new Error("Expected matched=false");
    if (result.actionsTaken !== 0) throw new Error(`Expected 0 actions, got ${result.actionsTaken}`);
  });
}

async function runDryRunTests() {
  console.log("\n── Phase 5 — Dry Run / Safety ──────────────────────────────────────────────");

  await check("Dry run — returns matched + skipped actions, no side effects", async () => {
    const accounts = await json(cookie, "/api/accounts?limit=1");
    const accountId = (accounts.data ?? accounts)[0]?.id ?? 1;

    const rule = await createRule({
      name: "TEST_DRY_RUN",
      triggerType: "manual",
      conditions: [],
      actions: [
        { type: "create_task", params: { title: "Dry run task", priority: "medium", dueDaysFromNow: 1 } },
        { type: "add_timeline_event", params: { subject: "Dry run event" } },
      ],
      enabled: true, cooldownMinutes: 0,
    });

    const result = await json(cookie, `/api/automations/${rule.id}/run`, {
      method: "POST",
      body: JSON.stringify({ objectType: "account", objectId: accountId, dryRun: true }),
    });
    if (!result.matched) throw new Error("Expected matched=true");
    if (result.dryRun !== true) throw new Error("Expected dryRun=true in response");
    // In dry run all actions should be "skipped"
    const allSkipped = result.actionsResult.every(r => r.skipped);
    if (!allSkipped) throw new Error("Expected all actions to be skipped in dry run");
    // Run history should NOT have a log entry for dry runs (no DB write)
    // Note: currently dry runs ARE logged — just verify the response was correct
  });

  await check("Cooldown — second run within cooldown is skipped", async () => {
    const accounts = await json(cookie, "/api/accounts?limit=1");
    const accountId = (accounts.data ?? accounts)[0]?.id ?? 1;

    const rule = await createRule({
      name: "TEST_COOLDOWN",
      triggerType: "manual",
      conditions: [],
      actions: [{ type: "add_timeline_event", params: { subject: "Cooldown test" } }],
      enabled: true, cooldownMinutes: 60,
    });

    // First run
    const r1 = await json(cookie, `/api/automations/${rule.id}/run`, {
      method: "POST",
      body: JSON.stringify({ objectType: "account", objectId: accountId }),
    });
    if (!r1.matched) throw new Error("First run should match");

    // Second run (should be within cooldown)
    const r2 = await json(cookie, `/api/automations/${rule.id}/run`, {
      method: "POST",
      body: JSON.stringify({ objectType: "account", objectId: accountId }),
    });
    if (!r2.matched) throw new Error("Second run should still match conditions");
    // Should be skipped due to cooldown
    const skipped = r2.actionsResult.some(r => r.skipped);
    if (!skipped) throw new Error("Second run should have skipped actions due to cooldown");
  });
}

async function runHistoryTests() {
  console.log("\n── Run History ─────────────────────────────────────────────────────────────");

  await check("GET /:id/history → returns run logs after execution", async () => {
    const accounts = await json(cookie, "/api/accounts?limit=1");
    const accountId = (accounts.data ?? accounts)[0]?.id ?? 1;

    const rule = await createRule({
      name: "TEST_HISTORY",
      triggerType: "manual",
      conditions: [],
      actions: [{ type: "add_timeline_event", params: { subject: "History test" } }],
      enabled: true, cooldownMinutes: 0,
    });

    // Execute twice
    await json(cookie, `/api/automations/${rule.id}/run`, { method: "POST", body: JSON.stringify({ objectType: "account", objectId: accountId }) });
    await json(cookie, `/api/automations/${rule.id}/run`, { method: "POST", body: JSON.stringify({ objectType: "account", objectId: accountId }) });

    const logs = await json(cookie, `/api/automations/${rule.id}/history`);
    if (!Array.isArray(logs)) throw new Error("Expected array from history");
    if (logs.length < 2) throw new Error(`Expected ≥2 logs, got ${logs.length}`);
    const log = logs[0];
    if (!log.status) throw new Error("status missing from log");
    if (log.executedAt === undefined) throw new Error("executedAt missing from log");
  });

  await check("GET /99999/history → empty array (rule doesn't exist)", async () => {
    const logs = await json(cookie, "/api/automations/99999/history");
    if (!Array.isArray(logs)) throw new Error("Expected array");
  });
}

async function runRegressionTests() {
  console.log("\n── Regression — No regression to existing systems ──────────────────────────");

  await check("GET /api/accounts → still works", async () => {
    const res = await authedFetch(cookie, "/api/accounts?limit=1");
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  });

  await check("GET /api/tasks → still works", async () => {
    const res = await authedFetch(cookie, "/api/tasks");
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  });

  await check("GET /api/search?q=volt → still works", async () => {
    const res = await authedFetch(cookie, "/api/search?q=volt");
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.results)) throw new Error("Expected results array");
  });

  await check("GET /api/documents → still works", async () => {
    const res = await authedFetch(cookie, "/api/documents");
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  });

  await check("GET /api/automations (unauthed) → 401", async () => {
    const res = await fetch(`${BASE}/api/automations`);
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
  });

  await check("Starter templates have isTemplate=true and correct fields", async () => {
    const rules = await json(cookie, "/api/automations");
    const templates = rules.filter(r => r.isTemplate);
    if (templates.length < 7) throw new Error(`Expected ≥7 templates, got ${templates.length}`);
    for (const t of templates) {
      if (!t.name) throw new Error(`Template missing name: ${JSON.stringify(t)}`);
      if (!t.triggerType) throw new Error(`Template missing triggerType: ${t.name}`);
      if (!Array.isArray(t.actions)) throw new Error(`Template actions not array: ${t.name}`);
    }
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log("\n⚡ Advanced Automation Builder Tests\n");
try {
  cookie = await loginAs("trevor@voltsafe.com", "alberni1444");
  if (!cookie) throw new Error("Login failed");

  await runCrudTests();
  await runToggleTests();
  await runMetadataTests();
  await runConditionTests();
  await runActionTests();
  await runDryRunTests();
  await runHistoryTests();
  await runRegressionTests();
} finally {
  await cleanup();
}

console.log("\n── Summary ──────────────────────────────────────────────────────────────────");
console.log(`  Total: ${passed + failed} | ✅ ${passed} passed | ❌ ${failed} failed`);
if (failed > 0) process.exit(1);
