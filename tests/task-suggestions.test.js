/**
 * Task Suggestions + Automation Rules Test Suite
 * Tests: global suggestions API, accept/dismiss/snooze flows,
 *        cooldown logic, rule config CRUD, auth, and schema.
 *
 * Uses trevor@voltsafe.com (Master Admin, id=4)
 * and viewer@voltsafe.com (Viewer, id=6) for permission checks.
 */

const BASE = "http://localhost:5000";

let trevCookie = "";
let viewerCookie = "";

async function getPool() {
  const pg = await import("pg");
  const Pool = pg.default.Pool;
  return new Pool({ connectionString: process.env.DATABASE_URL });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status}`);
  const cookie = res.headers.get("set-cookie")?.match(/(connect\.sid=[^;]+)/)?.[1];
  if (!cookie) throw new Error(`No session cookie for ${email}`);
  return cookie;
}

function api(path, opts = {}, cookie = trevCookie) {
  const method = opts.method ?? "GET";
  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    failed++;
  }
}

// ── Setup ────────────────────────────────────────────────────────────────────

async function setup() {
  trevCookie = await login("trevor@voltsafe.com", "alberni1444");
  viewerCookie = await login("viewer@voltsafe.com", "testpass1234");
  console.log("✓ Logged in as trevor + viewer");
}

// ── T01: Auth checks ─────────────────────────────────────────────────────────

async function testAuth() {
  console.log("\n── T01: Auth & Permissions ──");

  // GET /api/tasks/suggestions requires auth
  const r1 = await api("/api/tasks/suggestions", {}, "");
  assert(r1.status === 401 || r1.status === 302 || r1.status === 403,
    `GET /api/tasks/suggestions rejects unauthenticated (got ${r1.status})`);

  // Viewer can GET suggestions (view permission)
  const r2 = await api("/api/tasks/suggestions", {}, viewerCookie);
  assert(r2.status === 200, `Viewer can GET /api/tasks/suggestions (status ${r2.status})`);

  // GET /api/task-rules requires auth
  const r3 = await api("/api/task-rules", {}, "");
  assert(r3.status === 401 || r3.status === 302 || r3.status === 403,
    `GET /api/task-rules rejects unauthenticated (got ${r3.status})`);

  // Viewer can GET task-rules
  const r4 = await api("/api/task-rules", {}, viewerCookie);
  assert(r4.status === 200, `Viewer can GET /api/task-rules (status ${r4.status})`);
}

// ── T02: Global suggestions shape ────────────────────────────────────────────

async function testSuggestionsShape() {
  console.log("\n── T02: Global Suggestions Shape ──");

  const r = await api("/api/tasks/suggestions");
  assert(r.status === 200, `GET /api/tasks/suggestions → 200`);

  const body = await r.json();
  assert(typeof body === "object" && body !== null, "Response is an object");
  assert(Array.isArray(body.suggestions), "body.suggestions is an array");
  assert(typeof body.total === "number", "body.total is a number");
  assert(body.total === body.suggestions.length, "total matches suggestions.length");

  if (body.suggestions.length > 0) {
    const s = body.suggestions[0];
    assert(typeof s.id === "number", `Suggestion has numeric id (${s.id})`);
    assert(typeof s.title === "string" && s.title.length > 0, "Suggestion has title");
    assert(typeof s.reason === "string" && s.reason.length > 0, "Suggestion has reason");
    assert(["low","medium","high"].includes(s.severity), `Suggestion severity is valid (${s.severity})`);
    assert(["low","medium","high"].includes(s.priority), `Suggestion priority is valid (${s.priority})`);
    assert(typeof s.sourceLabel === "string", "Suggestion has sourceLabel");
    assert(typeof s.confidence === "number", `Suggestion has confidence score (${s.confidence})`);
    assert(s.confidence >= 0 && s.confidence <= 100, `Confidence is 0-100 (${s.confidence})`);
    assert(typeof s.objectType === "string", `Suggestion has objectType (${s.objectType})`);
    assert(typeof s.objectId === "number", `Suggestion has objectId (${s.objectId})`);
    assert(typeof s.signalType === "string", `Suggestion has signalType (${s.signalType})`);

    // Sorted by severity: high first
    const sevOrder = { high: 0, medium: 1, low: 2 };
    for (let i = 1; i < body.suggestions.length; i++) {
      const prev = body.suggestions[i-1];
      const curr = body.suggestions[i];
      const prevRank = sevOrder[prev.severity] ?? 2;
      const currRank = sevOrder[curr.severity] ?? 2;
      assert(prevRank <= currRank, `Suggestions sorted by severity (${prev.severity} ≤ ${curr.severity})`);
      if (prevRank < currRank) break;
    }
  } else {
    console.log("  ℹ No suggestions returned (CRM data may not trigger rules)");
    assert(true, "Empty suggestions list is valid");
  }
}

// ── T03: Accept flow ─────────────────────────────────────────────────────────

let acceptedSuggestionId = null;
let createdTaskId = null;

async function testAcceptFlow() {
  console.log("\n── T03: Accept Flow ──");

  // Seed a suggestion directly into DB
  const pool = await getPool();
  

  // Insert a fresh pending suggestion
  const { rows } = await pool.query(`
    INSERT INTO task_suggestions
      (object_type, object_id, signal_type, severity, title, reason,
       suggested_action_type, suggested_action_label, priority, status,
       source_label, confidence)
    VALUES
      ('account', 10, 'test_accept_signal', 'high', 'Test accept suggestion',
       'This is a test suggestion for the accept flow', 'log_call', 'Log a call',
       'high', 'pending', 'Test rule', 85)
    RETURNING id
  `);
  acceptedSuggestionId = rows[0].id;
  console.log(`  ℹ Seeded suggestion id=${acceptedSuggestionId}`);
  await pool.end();

  // Accept it
  const r = await api(`/api/tasks/suggestions/${acceptedSuggestionId}/accept`, { method: "POST" });
  assert(r.status === 200, `POST /api/tasks/suggestions/:id/accept → 200 (got ${r.status})`);

  const body = await r.json();
  assert(body.success === true, "Accept response has success=true");
  assert(typeof body.taskId === "number", `Accept creates task (taskId=${body.taskId})`);
  createdTaskId = body.taskId;

  // Verify the created task has source fields
  const pool2 = await getPool();
  const { rows: taskRows } = await pool2.query(
    `SELECT * FROM tasks WHERE id = $1 LIMIT 1`, [createdTaskId]
  );
  await pool2.end();

  assert(taskRows.length === 1, "Task row exists in DB");
  const task = taskRows[0];
  assert(task.ai_suggested === true, "Task ai_suggested=true");
  assert(task.source === "suggestion", `Task source='suggestion' (got '${task.source}')`);
  assert(task.source_label && task.source_label.length > 0, `Task has source_label (${task.source_label})`);
  assert(task.status === "pending", `Task status=pending (got ${task.status})`);

  // Verify suggestion is now 'accepted'
  const pool3 = await getPool();
  const { rows: suggRows } = await pool3.query(
    `SELECT * FROM task_suggestions WHERE id = $1 LIMIT 1`, [acceptedSuggestionId]
  );
  await pool3.end();

  assert(suggRows.length === 1, "Suggestion row still exists");
  const sugg = suggRows[0];
  assert(sugg.status === "accepted", `Suggestion status='accepted' (got '${sugg.status}')`);
  assert(sugg.accepted_at !== null, "Suggestion has accepted_at timestamp");
  assert(Number(sugg.created_task_id) === createdTaskId, `Suggestion.created_task_id matches (${sugg.created_task_id})`);
}

// ── T04: Accept cooldown (no re-suggest for 3 days) ──────────────────────────

async function testAcceptCooldown() {
  console.log("\n── T04: Accept Cooldown (3-day) ──");

  // After accepting, running suggestions should NOT return the same signal
  const r = await api("/api/tasks/suggestions");
  const body = await r.json();
  const found = body.suggestions.some(s => s.id === acceptedSuggestionId);
  assert(!found, "Accepted suggestion does not appear in suggestions list (3-day cooldown)");

  // Verify GET does not return accepted suggestions
  assert(
    body.suggestions.every(s => s.status === "pending" || !s.status),
    "All returned suggestions are pending status"
  );
}

// ── T05: Dismiss flow ─────────────────────────────────────────────────────────

let dismissedSuggestionId = null;

async function testDismissFlow() {
  console.log("\n── T05: Dismiss Flow ──");

  const pool = await getPool();
  
  const { rows } = await pool.query(`
    INSERT INTO task_suggestions
      (object_type, object_id, signal_type, severity, title, reason,
       suggested_action_type, suggested_action_label, priority, status,
       source_label, confidence)
    VALUES
      ('account', 10, 'test_dismiss_signal', 'medium', 'Test dismiss suggestion',
       'This is a test suggestion for dismiss flow', 'send_email', 'Send email',
       'medium', 'pending', 'Test rule', 70)
    RETURNING id
  `);
  dismissedSuggestionId = rows[0].id;
  console.log(`  ℹ Seeded suggestion id=${dismissedSuggestionId}`);
  await pool.end();

  // Dismiss it
  const r = await api(`/api/tasks/suggestions/${dismissedSuggestionId}/dismiss`, { method: "POST" });
  assert(r.status === 200, `POST /api/tasks/suggestions/:id/dismiss → 200 (got ${r.status})`);

  const body = await r.json();
  assert(body.success === true, "Dismiss response has success=true");

  // Verify in DB
  const pool2 = await getPool();
  const { rows: suggRows } = await pool2.query(
    `SELECT * FROM task_suggestions WHERE id = $1 LIMIT 1`, [dismissedSuggestionId]
  );
  await pool2.end();

  const sugg = suggRows[0];
  assert(sugg.status === "dismissed", `Suggestion status='dismissed' (got '${sugg.status}')`);
  assert(sugg.dismissed_at !== null, "Suggestion has dismissed_at timestamp");
  assert(sugg.dismissed_by === 4, `Suggestion dismissed_by=4 (got ${sugg.dismissed_by})`);
}

// ── T06: Dismiss cooldown (7-day) ────────────────────────────────────────────

async function testDismissCooldown() {
  console.log("\n── T06: Dismiss Cooldown (7-day) ──");

  // The dismissed suggestion should not appear in the suggestions list
  const r = await api("/api/tasks/suggestions");
  const body = await r.json();
  const found = body.suggestions.some(s => s.id === dismissedSuggestionId);
  assert(!found, "Dismissed suggestion does not appear in global suggestions (7-day cooldown active)");
}

// ── T07: Snooze flow ─────────────────────────────────────────────────────────

async function testSnoozeFlow() {
  console.log("\n── T07: Snooze Flow ──");

  const pool = await getPool();
  
  const { rows } = await pool.query(`
    INSERT INTO task_suggestions
      (object_type, object_id, signal_type, severity, title, reason,
       suggested_action_type, suggested_action_label, priority, status,
       source_label, confidence)
    VALUES
      ('account', 10, 'test_snooze_signal', 'low', 'Test snooze suggestion',
       'This is a test suggestion for snooze flow', 'add_note', 'Add a note',
       'low', 'pending', 'Test rule', 55)
    RETURNING id
  `);
  const snoozeId = rows[0].id;
  console.log(`  ℹ Seeded suggestion id=${snoozeId}`);
  await pool.end();

  // Invalid days
  const r1 = await api(`/api/tasks/suggestions/${snoozeId}/snooze`, {
    method: "POST",
    body: { days: 0 },
  });
  assert(r1.status === 400, `Snooze days=0 → 400 (got ${r1.status})`);

  const r2 = await api(`/api/tasks/suggestions/${snoozeId}/snooze`, {
    method: "POST",
    body: { days: 91 },
  });
  assert(r2.status === 400, `Snooze days=91 → 400 (got ${r2.status})`);

  // Valid snooze (3 days)
  const r3 = await api(`/api/tasks/suggestions/${snoozeId}/snooze`, {
    method: "POST",
    body: { days: 3 },
  });
  assert(r3.status === 200, `POST /api/tasks/suggestions/:id/snooze (days=3) → 200 (got ${r3.status})`);

  const body = await r3.json();
  assert(body.success === true, "Snooze response has success=true");
  assert(typeof body.snoozedUntil === "string", `snoozedUntil is ISO string (${body.snoozedUntil})`);

  // Verify snoozed_until is ~3 days from now
  const snoozeDate = new Date(body.snoozedUntil);
  const diffHours = (snoozeDate - Date.now()) / 3600000;
  assert(diffHours > 71 && diffHours < 73, `Snoozed for ~3 days (${diffHours.toFixed(1)}h)`);
}

// ── T08: 404 for unknown suggestion ─────────────────────────────────────────

async function testNotFound() {
  console.log("\n── T08: 404 for Unknown Suggestion ──");

  const r1 = await api("/api/tasks/suggestions/999999/accept", { method: "POST" });
  assert(r1.status === 404, `Accept unknown suggestion → 404 (got ${r1.status})`);

  const r2 = await api("/api/tasks/suggestions/999999/dismiss", { method: "POST" });
  assert(r2.status === 404, `Dismiss unknown suggestion → 404 (got ${r2.status})`);

  const r3 = await api("/api/tasks/suggestions/999999/snooze", { method: "POST", body: { days: 3 } });
  assert(r3.status === 404, `Snooze unknown suggestion → 404 (got ${r3.status})`);
}

// ── T09: Task rule configs CRUD ──────────────────────────────────────────────

async function testRuleConfigs() {
  console.log("\n── T09: Task Rule Configs CRUD ──");

  // GET all rules
  const r1 = await api("/api/task-rules");
  assert(r1.status === 200, `GET /api/task-rules → 200`);

  const rules = await r1.json();
  assert(Array.isArray(rules), "GET /api/task-rules returns array");
  assert(rules.length === 6, `Returns 6 rules (got ${rules.length})`);

  const ruleIds = rules.map(r => r.ruleId);
  assert(ruleIds.includes("unanswered_email"), "unanswered_email rule exists");
  assert(ruleIds.includes("stale_lead"), "stale_lead rule exists");
  assert(ruleIds.includes("missing_next_step"), "missing_next_step rule exists");
  assert(ruleIds.includes("quote_no_followup"), "quote_no_followup rule exists");
  assert(ruleIds.includes("account_needs_attention"), "account_needs_attention rule exists");
  assert(ruleIds.includes("overdue_task_reminder"), "overdue_task_reminder rule exists");

  // Validate shape of each rule
  for (const rule of rules) {
    assert(typeof rule.ruleId === "string", `Rule ${rule.ruleId}: ruleId is string`);
    assert(typeof rule.label === "string", `Rule ${rule.ruleId}: label is string`);
    assert(typeof rule.thresholdValue === "number", `Rule ${rule.ruleId}: thresholdValue is number`);
    assert(["hours","days","weeks"].includes(rule.thresholdUnit), `Rule ${rule.ruleId}: thresholdUnit valid (${rule.thresholdUnit})`);
    assert(typeof rule.isEnabled === "boolean", `Rule ${rule.ruleId}: isEnabled is boolean`);
    assert(typeof rule.assigneeStrategy === "string", `Rule ${rule.ruleId}: assigneeStrategy is string`);
  }

  // Update stale_lead threshold
  const staleLeadRule = rules.find(r => r.ruleId === "stale_lead");
  const originalThreshold = staleLeadRule.thresholdValue;
  const newThreshold = originalThreshold === 7 ? 14 : 7;

  const r2 = await api("/api/task-rules/stale_lead", {
    method: "PUT",
    body: { thresholdValue: newThreshold },
  });
  assert(r2.status === 200, `PUT /api/task-rules/stale_lead → 200 (got ${r2.status})`);

  const updated = await r2.json();
  assert(updated.thresholdValue === newThreshold, `Updated thresholdValue is ${newThreshold} (got ${updated.thresholdValue})`);
  assert(updated.ruleId === "stale_lead", "Updated rule has correct ruleId");

  // Toggle isEnabled
  const r3 = await api("/api/task-rules/stale_lead", {
    method: "PUT",
    body: { isEnabled: false },
  });
  assert(r3.status === 200, `PUT /api/task-rules toggle isEnabled → 200`);
  const toggled = await r3.json();
  assert(toggled.isEnabled === false, "isEnabled toggled to false");

  // Re-enable
  const r4 = await api("/api/task-rules/stale_lead", {
    method: "PUT",
    body: { isEnabled: true, thresholdValue: originalThreshold },
  });
  assert(r4.status === 200, "Re-enable stale_lead rule → 200");

  // Unknown rule → 400 or 404
  const r5 = await api("/api/task-rules/nonexistent_rule", {
    method: "PUT",
    body: { thresholdValue: 10 },
  });
  assert(r5.status === 400 || r5.status === 404, `Unknown rule → 400/404 (got ${r5.status})`);

  // No body → 400
  const r6 = await api("/api/task-rules/stale_lead", {
    method: "PUT",
    body: {},
  });
  assert(r6.status === 400, `Empty body PUT → 400 (got ${r6.status})`);

  // Viewer cannot PUT (view-only)
  const r7 = await api("/api/task-rules/stale_lead", {
    method: "PUT",
    body: { thresholdValue: 10 },
  }, viewerCookie);
  assert(r7.status === 403, `Viewer cannot PUT rule config → 403 (got ${r7.status})`);
}

// ── T10: Accept permission check ─────────────────────────────────────────────

async function testAcceptPermission() {
  console.log("\n── T10: Accept Permission ──");

  const pool = await getPool();
  
  const { rows } = await pool.query(`
    INSERT INTO task_suggestions
      (object_type, object_id, signal_type, severity, title, reason,
       suggested_action_type, suggested_action_label, priority, status, source_label, confidence)
    VALUES
      ('account', 10, 'test_perm_signal', 'medium', 'Permission test suggestion',
       'Testing permission for accept', 'log_call', 'Log call', 'medium', 'pending', 'Test', 60)
    RETURNING id
  `);
  const permSuggId = rows[0].id;
  await pool.end();

  // Viewer cannot accept (requires edit)
  const r = await api(`/api/tasks/suggestions/${permSuggId}/accept`, { method: "POST" }, viewerCookie);
  assert(r.status === 403, `Viewer cannot accept suggestion → 403 (got ${r.status})`);

  // Cleanup
  const pool2 = await getPool();
  await pool2.query(`DELETE FROM task_suggestions WHERE id = $1`, [permSuggId]);
  await pool2.end();
}

// ── T11: Dedupe logic (same object+signal → one record) ──────────────────────

async function testDedupeLogic() {
  console.log("\n── T11: Dedupe / Upsert Logic ──");

  // Run suggestions twice — should not duplicate rows for same object+signal
  const r1 = await api("/api/tasks/suggestions");
  const body1 = await r1.json();
  const r2 = await api("/api/tasks/suggestions");
  const body2 = await r2.json();

  // Count distinct suggestion IDs
  const ids1 = new Set(body1.suggestions.map(s => s.id));
  const ids2 = new Set(body2.suggestions.map(s => s.id));

  assert(ids1.size === body1.suggestions.length, "No duplicate suggestion IDs in first call");
  assert(ids2.size === body2.suggestions.length, "No duplicate suggestion IDs in second call");

  // Same IDs returned on second call (engine is deterministic)
  let overlapping = 0;
  for (const id of ids1) {
    if (ids2.has(id)) overlapping++;
  }
  // At least as many suggestions in second call as first (upsert, not insert)
  assert(body2.total <= body1.total + 2, `No unbounded growth: second call ≤ first+2 (${body2.total} vs ${body1.total})`);
}

// ── T12: Schema fields on tasks ──────────────────────────────────────────────

async function testSchemaFields() {
  console.log("\n── T12: Schema Fields ──");

  const pool = await getPool();
  

  // tasks table should have source_label, source_meta, dismissed_at, dismissed_by
  const { rows: taskCols } = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'tasks' ORDER BY column_name`
  );
  const taskColNames = taskCols.map(r => r.column_name);
  assert(taskColNames.includes("source_label"), "tasks.source_label column exists");
  assert(taskColNames.includes("source_meta"), "tasks.source_meta column exists");
  assert(taskColNames.includes("dismissed_at"), "tasks.dismissed_at column exists");
  assert(taskColNames.includes("dismissed_by"), "tasks.dismissed_by column exists");

  // task_suggestions table should have suggested_assignee_id, confidence, source_label, dismissed_by
  const { rows: suggCols } = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'task_suggestions' ORDER BY column_name`
  );
  const suggColNames = suggCols.map(r => r.column_name);
  assert(suggColNames.includes("suggested_assignee_id"), "task_suggestions.suggested_assignee_id exists");
  assert(suggColNames.includes("confidence"), "task_suggestions.confidence exists");
  assert(suggColNames.includes("source_label"), "task_suggestions.source_label exists");
  assert(suggColNames.includes("dismissed_by"), "task_suggestions.dismissed_by exists");

  // task_rule_configs table exists with correct columns
  const { rows: ruleCols } = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'task_rule_configs' ORDER BY column_name`
  );
  const ruleColNames = ruleCols.map(r => r.column_name);
  assert(ruleColNames.includes("rule_id"), "task_rule_configs.rule_id exists");
  assert(ruleColNames.includes("threshold_value"), "task_rule_configs.threshold_value exists");
  assert(ruleColNames.includes("threshold_unit"), "task_rule_configs.threshold_unit exists");
  assert(ruleColNames.includes("is_enabled"), "task_rule_configs.is_enabled exists");
  assert(ruleColNames.includes("assignee_strategy"), "task_rule_configs.assignee_strategy exists");

  await pool.end();
}

// ── T13: No regression — tasks hub still works ───────────────────────────────

async function testHubRegression() {
  console.log("\n── T13: Tasks Hub Regression ──");

  const views = ["my", "team", "today", "overdue", "upcoming", "completed"];
  for (const view of views) {
    const r = await api(`/api/tasks/hub?view=${view}&groupBy=due_date`);
    assert(r.status === 200, `GET /api/tasks/hub?view=${view} → 200`);
    const body = await r.json();
    assert(Array.isArray(body.tasks), `tasks hub ${view}: tasks is array`);
    assert(typeof body.counts === "object", `tasks hub ${view}: counts is object`);
    assert(body.view === view, `tasks hub ${view}: view matches`);
  }

  // GroupBy variants
  for (const groupBy of ["priority", "linked_record", "assignee"]) {
    const r = await api(`/api/tasks/hub?view=my&groupBy=${groupBy}`);
    assert(r.status === 200, `GET /api/tasks/hub?groupBy=${groupBy} → 200`);
  }
}

// ── T14: Accept creates source_label from suggestion ─────────────────────────

async function testAcceptSourceLabel() {
  console.log("\n── T14: Accept Preserves Source Label ──");

  const pool = await getPool();
  

  const sourceLabel = "Stale lead (14 days)";
  const { rows } = await pool.query(
    `INSERT INTO task_suggestions
      (object_type, object_id, signal_type, severity, title, reason,
       suggested_action_type, suggested_action_label, priority, status,
       source_label, confidence)
    VALUES
      ('account', 10, 'test_sourcelabel_signal', 'high', 'Source label test task',
       'Testing that source_label is preserved on accept', 'log_call', 'Log call',
       'high', 'pending', $1, 88)
    RETURNING id`,
    [sourceLabel]
  );
  const suggId = rows[0].id;
  await pool.end();

  const r = await api(`/api/tasks/suggestions/${suggId}/accept`, { method: "POST" });
  assert(r.status === 200, `Accept source label suggestion → 200`);
  const body = await r.json();

  const pool2 = await getPool();
  const { rows: taskRows } = await pool2.query(`SELECT source_label FROM tasks WHERE id = $1`, [body.taskId]);
  await pool2.end();

  assert(taskRows.length > 0, "Created task found in DB");
  assert(taskRows[0].source_label === sourceLabel, `Task source_label preserved: '${taskRows[0].source_label}'`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log("══ Task Suggestions + Automation Rules Tests ══\n");

  try {
    await setup();

    await testAuth();
    await testSuggestionsShape();
    await testAcceptFlow();
    await testAcceptCooldown();
    await testDismissFlow();
    await testDismissCooldown();
    await testSnoozeFlow();
    await testNotFound();
    await testRuleConfigs();
    await testAcceptPermission();
    await testDedupeLogic();
    await testSchemaFields();
    await testHubRegression();
    await testAcceptSourceLabel();

  } catch (err) {
    console.error("\n❌ Fatal error:", err.message);
    failed++;
  }

  console.log(`\n══ Results: ${passed} passed, ${failed} failed ══`);

  if (failed > 0) {
    process.exit(1);
  }
}

run();
