/**
 * tests/execution.test.js
 * Daily Execution + Reminder System — comprehensive test suite
 * Phases: API, bulk actions, reminders, digest, settings, permissions, regression
 */

import assert from "assert";

const BASE = "http://localhost:5000";
let cookie = "";
let viewerCookie = "";

async function api(path, opts = {}) {
  return fetch(`${BASE}${path}`, {
    headers: { Cookie: cookie, "Content-Type": "application/json", ...opts.headers },
    credentials: "include",
    ...opts,
    body: opts.body ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)) : undefined,
  });
}

async function viewerApi(path, opts = {}) {
  return fetch(`${BASE}${path}`, {
    headers: { Cookie: viewerCookie, "Content-Type": "application/json", ...opts.headers },
    credentials: "include",
    ...opts,
    body: opts.body ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)) : undefined,
  });
}

async function getPool() {
  const { default: pg } = await import("pg");
  const { Pool } = pg;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

let pass = 0;
let fail = 0;

function ok(condition, msg) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    pass++;
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    fail++;
  }
}

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "trevor@voltsafe.com", password: "alberni1444" }),
  });
  cookie = r.headers.get("set-cookie")?.match(/(connect\.sid=[^;]+)/)?.[1] ?? "";

  const v = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "viewer@voltsafe.com", password: "testpass1234" }),
  });
  viewerCookie = v.headers.get("set-cookie")?.match(/(connect\.sid=[^;]+)/)?.[1] ?? "";

  ok(cookie.length > 0, "Logged in as trevor");
  ok(viewerCookie.length > 0, "Logged in as viewer");
}

async function seedTaskForUser(userId = 4, overrideDue = null) {
  const pool = await getPool();
  const due = overrideDue ?? new Date(Date.now() - 86_400_000).toISOString();
  const result = await pool.query(
    `INSERT INTO tasks (title, status, priority, owner_user_id, due_date, source, created_at, updated_at)
     VALUES ($1, 'pending', 'high', $2, $3, 'manual', NOW(), NOW())
     RETURNING id`,
    [`Test execution task ${Date.now()}`, userId, due]
  );
  await pool.end();
  return result.rows[0].id;
}

async function deleteTask(id) {
  const pool = await getPool();
  await pool.query(`DELETE FROM task_reminder_logs WHERE task_id = $1`, [id]);
  await pool.query(`DELETE FROM tasks WHERE id = $1`, [id]);
  await pool.end();
}

// ── T01: Auth ────────────────────────────────────────────────────────────────
async function t01_auth() {
  console.log("\n── T01: Auth & Permissions ──");

  let r = await fetch(`${BASE}/api/execution/today`);
  ok(r.status === 401, "GET /api/execution/today → 401 unauthenticated");

  r = await fetch(`${BASE}/api/execution/summary`);
  ok(r.status === 401, "GET /api/execution/summary → 401 unauthenticated");

  r = await viewerApi("/api/execution/today");
  ok(r.status === 200, "Viewer can GET /api/execution/today");

  r = await viewerApi("/api/execution/summary");
  ok(r.status === 200, "Viewer can GET /api/execution/summary");
}

// ── T02: /api/execution/today shape ──────────────────────────────────────────
async function t02_today_shape() {
  console.log("\n── T02: /api/execution/today Shape ──");

  const r = await api("/api/execution/today");
  ok(r.status === 200, "GET /api/execution/today → 200");

  const body = await r.json();
  ok(typeof body === "object" && body !== null, "Body is object");
  ok(Array.isArray(body.mustDoToday), "mustDoToday is array");
  ok(Array.isArray(body.overdue), "overdue is array");
  ok(Array.isArray(body.newlyAssigned), "newlyAssigned is array");
  ok(Array.isArray(body.awaitingReply), "awaitingReply is array");
  ok(Array.isArray(body.recentlyCompleted), "recentlyCompleted is array");
  ok(typeof body.suggestionsReady === "number", "suggestionsReady is number");
  ok(typeof body.meta === "object", "meta is object");
  ok(typeof body.meta.counts === "object", "meta.counts is object");
  ok(typeof body.meta.counts.overdue === "number", "meta.counts.overdue is number");
}

// ── T03: /api/execution/summary shape ────────────────────────────────────────
async function t03_summary_shape() {
  console.log("\n── T03: /api/execution/summary Shape ──");

  const r = await api("/api/execution/summary");
  ok(r.status === 200, "GET /api/execution/summary → 200");

  const body = await r.json();
  ok(typeof body.totalOpen === "number", "totalOpen is number");
  ok(typeof body.overdueCount === "number", "overdueCount is number");
  ok(typeof body.dueToday === "number", "dueToday is number");
  ok(typeof body.completionRateLast7d === "number", "completionRateLast7d is number");
  ok(body.completionRateLast7d >= 0 && body.completionRateLast7d <= 100, "completionRate 0–100");
  ok(typeof body.avgAgeOfOpenTasksDays === "number", "avgAgeOfOpenTasksDays is number");
  ok(Array.isArray(body.topBlockedOwners), "topBlockedOwners is array");
  ok(Array.isArray(body.topStaleLinkedRecords), "topStaleLinkedRecords is array");
}

// ── T04: remind-now ───────────────────────────────────────────────────────────
async function t04_remind_now() {
  console.log("\n── T04: Remind Now ──");

  const taskId = await seedTaskForUser(4, new Date(Date.now() - 2 * 86_400_000).toISOString());
  console.log(`  ℹ Seeded task id=${taskId}`);

  const r = await api(`/api/tasks/${taskId}/remind-now`, { method: "POST" });
  ok(r.status === 200, "POST /api/tasks/:id/remind-now → 200");

  const body = await r.json();
  ok(body.ok === true, "Response ok=true");

  const pool = await getPool();
  const logRows = await pool.query(`SELECT * FROM task_reminder_logs WHERE task_id = $1`, [taskId]);
  ok(logRows.rows.length > 0, "Reminder log entry created");
  ok(logRows.rows[0].reminder_type === "manual", "reminderType=manual");

  const taskRow = await pool.query(`SELECT reminder_count FROM tasks WHERE id = $1`, [taskId]);
  ok(Number(taskRow.rows[0].reminder_count) >= 1, "reminder_count incremented");
  await pool.end();

  await deleteTask(taskId);
}

// ── T05: remind-now 404 ───────────────────────────────────────────────────────
async function t05_remind_now_404() {
  console.log("\n── T05: Remind Now 404 ──");
  const r = await api("/api/tasks/999999/remind-now", { method: "POST" });
  ok(r.status === 404, "Remind unknown task → 404");
}

// ── T06: escalate ────────────────────────────────────────────────────────────
async function t06_escalate() {
  console.log("\n── T06: Escalate ──");

  const taskId = await seedTaskForUser(4, new Date(Date.now() - 5 * 86_400_000).toISOString());
  console.log(`  ℹ Seeded task id=${taskId}`);

  const r = await api(`/api/tasks/${taskId}/escalate`, { method: "POST" });
  ok(r.status === 200, "POST /api/tasks/:id/escalate → 200");

  const body = await r.json();
  ok(body.ok === true, "Response ok=true");
  ok(body.escalationLevel === 1, `escalationLevel=1 (got ${body.escalationLevel})`);

  const r2 = await api(`/api/tasks/${taskId}/escalate`, { method: "POST" });
  const body2 = await r2.json();
  ok(body2.escalationLevel === 2, `escalationLevel increments to 2`);

  const pool = await getPool();
  const logRow = await pool.query(`SELECT reminder_type FROM task_reminder_logs WHERE task_id = $1 LIMIT 1`, [taskId]);
  ok(logRow.rows.length > 0 && logRow.rows[0].reminder_type === "escalation", "Escalation log entry created");
  await pool.end();

  await deleteTask(taskId);
}

// ── T07: escalate 404 ────────────────────────────────────────────────────────
async function t07_escalate_404() {
  console.log("\n── T07: Escalate 404 ──");
  const r = await api("/api/tasks/999999/escalate", { method: "POST" });
  ok(r.status === 404, "Escalate unknown task → 404");
}

// ── T08: bulk complete ────────────────────────────────────────────────────────
async function t08_bulk_complete() {
  console.log("\n── T08: Bulk Complete ──");

  const id1 = await seedTaskForUser(4);
  const id2 = await seedTaskForUser(4);
  console.log(`  ℹ Seeded tasks id=${id1}, id=${id2}`);

  const r = await api("/api/tasks/bulk/complete", {
    method: "POST",
    body: { taskIds: [id1, id2] },
  });
  ok(r.status === 200, "POST /api/tasks/bulk/complete → 200");

  const body = await r.json();
  ok(body.ok === true, "Response ok=true");
  ok(body.updated === 2, `updated=2 (got ${body.updated})`);

  const pool = await getPool();
  const rows = await pool.query(`SELECT status FROM tasks WHERE id = ANY($1::int[])`, [[id1, id2]]);
  ok(rows.rows.every((r) => r.status === "completed"), "Both tasks marked completed");
  await pool.end();

  await deleteTask(id1);
  await deleteTask(id2);
}

// ── T09: bulk complete validation ────────────────────────────────────────────
async function t09_bulk_complete_validation() {
  console.log("\n── T09: Bulk Complete Validation ──");

  let r = await api("/api/tasks/bulk/complete", { method: "POST", body: { taskIds: [] } });
  ok(r.status === 400, "Empty taskIds → 400");

  r = await api("/api/tasks/bulk/complete", { method: "POST", body: {} });
  ok(r.status === 400, "Missing taskIds → 400");
}

// ── T10: bulk reassign ────────────────────────────────────────────────────────
async function t10_bulk_reassign() {
  console.log("\n── T10: Bulk Reassign ──");

  const id1 = await seedTaskForUser(4);
  console.log(`  ℹ Seeded task id=${id1}`);

  const r = await api("/api/tasks/bulk/reassign", {
    method: "POST",
    body: { taskIds: [id1], assigneeUserId: 4 },
  });
  ok(r.status === 200, "POST /api/tasks/bulk/reassign → 200");

  const body = await r.json();
  ok(body.ok === true, "Response ok=true");
  ok(body.updated === 1, `updated=1 (got ${body.updated})`);

  await deleteTask(id1);
}

// ── T11: bulk reassign validation ────────────────────────────────────────────
async function t11_bulk_reassign_validation() {
  console.log("\n── T11: Bulk Reassign Validation ──");

  let r = await api("/api/tasks/bulk/reassign", {
    method: "POST",
    body: { taskIds: [1], assigneeUserId: null },
  });
  ok(r.status === 400, "Missing assigneeUserId → 400");

  r = await api("/api/tasks/bulk/reassign", {
    method: "POST",
    body: { taskIds: [], assigneeUserId: 4 },
  });
  ok(r.status === 400, "Empty taskIds → 400");
}

// ── T12: bulk snooze ─────────────────────────────────────────────────────────
async function t12_bulk_snooze() {
  console.log("\n── T12: Bulk Snooze ──");

  const id1 = await seedTaskForUser(4);
  const id2 = await seedTaskForUser(4);
  console.log(`  ℹ Seeded tasks id=${id1}, id=${id2}`);

  const r = await api("/api/tasks/bulk/snooze", {
    method: "POST",
    body: { taskIds: [id1, id2], days: 3 },
  });
  ok(r.status === 200, "POST /api/tasks/bulk/snooze → 200");

  const body = await r.json();
  ok(body.ok === true, "Response ok=true");
  ok(body.updated === 2, `updated=2 (got ${body.updated})`);
  ok(typeof body.snoozedUntil === "string", "snoozedUntil is ISO string");

  const snoozedDate = new Date(body.snoozedUntil);
  const diffHours = (snoozedDate - Date.now()) / 3_600_000;
  ok(diffHours > 70 && diffHours < 74, `Snoozed ~3 days (${diffHours.toFixed(1)}h)`);

  const pool = await getPool();
  const rows = await pool.query(`SELECT snoozed_until FROM tasks WHERE id = ANY($1::int[])`, [[id1, id2]]);
  ok(rows.rows.every((r) => r.snoozed_until !== null), "Both tasks have snoozed_until set");
  await pool.end();

  await deleteTask(id1);
  await deleteTask(id2);
}

// ── T13: bulk snooze validation ───────────────────────────────────────────────
async function t13_bulk_snooze_validation() {
  console.log("\n── T13: Bulk Snooze Validation ──");

  let r = await api("/api/tasks/bulk/snooze", { method: "POST", body: { taskIds: [1], days: 0 } });
  ok(r.status === 400, "Snooze days=0 → 400");

  r = await api("/api/tasks/bulk/snooze", { method: "POST", body: { taskIds: [1], days: 100 } });
  ok(r.status === 400, "Snooze days=100 → 400");

  r = await api("/api/tasks/bulk/snooze", { method: "POST", body: { taskIds: [] } });
  ok(r.status === 400, "Empty taskIds → 400");
}

// ── T14: execution settings GET (defaults) ───────────────────────────────────
async function t14_settings_get_defaults() {
  console.log("\n── T14: Execution Settings GET (defaults) ──");

  const pool = await getPool();
  await pool.query(`DELETE FROM execution_settings WHERE user_id = 4`);
  await pool.end();

  const r = await api("/api/execution/settings");
  ok(r.status === 200, "GET /api/execution/settings → 200");

  const body = await r.json();
  ok(body.reminderHour === 9, `reminderHour defaults to 9 (got ${body.reminderHour})`);
  ok(body.overdueEscalationDays === 3, `overdueEscalationDays defaults to 3`);
  ok(body.maxRemindersPerDay === 3, `maxRemindersPerDay defaults to 3`);
  ok(body.managerDigestEnabled === true, "managerDigestEnabled defaults to true");
  ok(body.suggestionsInDigest === true, "suggestionsInDigest defaults to true");
  ok(body.bulkConfirmEnabled === true, "bulkConfirmEnabled defaults to true");
}

// ── T15: execution settings PUT ──────────────────────────────────────────────
async function t15_settings_put() {
  console.log("\n── T15: Execution Settings PUT ──");

  const r = await api("/api/execution/settings", {
    method: "PUT",
    body: {
      reminderHour: 8,
      overdueEscalationDays: 5,
      maxRemindersPerDay: 2,
      managerDigestEnabled: false,
      suggestionsInDigest: false,
    },
  });
  ok(r.status === 200, "PUT /api/execution/settings → 200");

  const body = await r.json();
  ok(body.reminderHour === 8, `reminderHour updated to 8`);
  ok(body.overdueEscalationDays === 5, `overdueEscalationDays updated to 5`);
  ok(body.maxRemindersPerDay === 2, `maxRemindersPerDay updated to 2`);
  ok(body.managerDigestEnabled === false, "managerDigestEnabled updated to false");
  ok(body.suggestionsInDigest === false, "suggestionsInDigest updated to false");
}

// ── T16: execution settings validation ───────────────────────────────────────
async function t16_settings_validation() {
  console.log("\n── T16: Execution Settings Validation ──");

  let r = await api("/api/execution/settings", {
    method: "PUT",
    body: { reminderHour: 25 },
  });
  ok(r.status === 400, "reminderHour=25 → 400");

  r = await api("/api/execution/settings", {
    method: "PUT",
    body: { maxRemindersPerDay: 0 },
  });
  ok(r.status === 400, "maxRemindersPerDay=0 → 400");
}

// ── T17: settings permission ──────────────────────────────────────────────────
async function t17_settings_permission() {
  console.log("\n── T17: Settings Permission ──");

  const r = await viewerApi("/api/execution/settings", {
    method: "PUT",
    body: { reminderHour: 7 },
  });
  ok(r.status === 403, "Viewer cannot PUT settings → 403");
}

// ── T18: bulk action permissions ─────────────────────────────────────────────
async function t18_bulk_permissions() {
  console.log("\n── T18: Bulk Action Permissions ──");

  let r = await viewerApi("/api/tasks/bulk/complete", {
    method: "POST",
    body: { taskIds: [1] },
  });
  ok(r.status === 403, "Viewer cannot bulk complete → 403");

  r = await viewerApi("/api/tasks/bulk/reassign", {
    method: "POST",
    body: { taskIds: [1], assigneeUserId: 4 },
  });
  ok(r.status === 403, "Viewer cannot bulk reassign → 403");

  r = await viewerApi("/api/tasks/bulk/snooze", {
    method: "POST",
    body: { taskIds: [1], days: 1 },
  });
  ok(r.status === 403, "Viewer cannot bulk snooze → 403");

  r = await viewerApi("/api/tasks/999/remind-now", { method: "POST" });
  ok(r.status === 403, "Viewer cannot remind-now → 403");

  r = await viewerApi("/api/tasks/999/escalate", { method: "POST" });
  ok(r.status === 403, "Viewer cannot escalate → 403");
}

// ── T19: digest ───────────────────────────────────────────────────────────────
async function t19_digest() {
  console.log("\n── T19: Digest ──");

  const pool = await getPool();
  await pool.query(`DELETE FROM task_digests WHERE user_id = 4 AND digest_type = 'morning_personal' AND delivered_at >= CURRENT_DATE`);
  await pool.query(`DELETE FROM notifications WHERE user_id = 4 AND type = 'digest' AND created_at >= CURRENT_DATE`);
  await pool.end();

  const r = await api("/api/execution/digest", {
    method: "POST",
    body: { type: "morning_personal", force: true },
  });
  ok(r.status === 200, "POST /api/execution/digest → 200");

  const body = await r.json();
  ok(body.skipped !== true, "Digest not skipped");
  ok(body.type === "morning_personal", `Digest type matches (got ${body.type})`);
  ok(typeof body.stats === "object", "stats object present");
  ok(typeof body.stats.totalOpen === "number", "stats.totalOpen is number");
  ok(typeof body.stats.dueToday === "number", "stats.dueToday is number");
  ok(Array.isArray(body.mustDoToday), "mustDoToday is array");
  ok(Array.isArray(body.overdue), "overdue is array");
  ok(typeof body.pendingSuggestions === "number", "pendingSuggestions is number");
  ok(typeof body.generatedAt === "string", "generatedAt is string");

  const pool2 = await getPool();
  const digestRow = await pool2.query(`SELECT * FROM task_digests WHERE user_id = 4 AND digest_type = 'morning_personal' ORDER BY id DESC LIMIT 1`);
  ok(digestRow.rows.length > 0, "Digest persisted to task_digests table");

  const notifRow = await pool2.query(`SELECT * FROM notifications WHERE user_id = 4 AND type = 'digest' ORDER BY id DESC LIMIT 1`);
  ok(notifRow.rows.length > 0, "Digest notification created");
  await pool2.end();
}

// ── T20: digest cooldown ──────────────────────────────────────────────────────
async function t20_digest_cooldown() {
  console.log("\n── T20: Digest Cooldown ──");

  const r = await api("/api/execution/digest", {
    method: "POST",
    body: { type: "morning_personal" },
  });
  ok(r.status === 200, "Digest cooldown returns 200");

  const body = await r.json();
  ok(body.skipped === true, "Second digest same day skipped (cooldown)");
}

// ── T21: digest invalid type ──────────────────────────────────────────────────
async function t21_digest_invalid_type() {
  console.log("\n── T21: Digest Invalid Type ──");

  const r = await api("/api/execution/digest", {
    method: "POST",
    body: { type: "nonexistent_type" },
  });
  ok(r.status === 400, "Invalid digest type → 400");
}

// ── T22: run-reminders ────────────────────────────────────────────────────────
async function t22_run_reminders() {
  console.log("\n── T22: Run Reminders ──");

  const r = await api("/api/execution/run-reminders", { method: "POST" });
  ok(r.status === 200, "POST /api/execution/run-reminders → 200");

  const body = await r.json();
  ok(body.ok === true, "Response ok=true");
  ok(typeof body.created === "number", "body.created is number");
  ok(typeof body.escalated === "number", "body.escalated is number");
  ok(body.created >= 0, "created >= 0");
}

// ── T23: schema columns ───────────────────────────────────────────────────────
async function t23_schema_columns() {
  console.log("\n── T23: Schema Columns ──");

  const pool = await getPool();
  const cols = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'tasks'
  `);
  const taskCols = cols.rows.map((r) => r.column_name);

  ok(taskCols.includes("completed_at"), "tasks.completed_at exists");
  ok(taskCols.includes("last_reminded_at"), "tasks.last_reminded_at exists");
  ok(taskCols.includes("reminder_count"), "tasks.reminder_count exists");
  ok(taskCols.includes("escalation_level"), "tasks.escalation_level exists");

  const tables = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('task_reminder_logs','task_digests','execution_settings')
  `);
  const tableNames = tables.rows.map((r) => r.table_name);
  ok(tableNames.includes("task_reminder_logs"), "task_reminder_logs table exists");
  ok(tableNames.includes("task_digests"), "task_digests table exists");
  ok(tableNames.includes("execution_settings"), "execution_settings table exists");

  const rlCols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'task_reminder_logs'`);
  const rlColNames = rlCols.rows.map((r) => r.column_name);
  ok(rlColNames.includes("task_id"), "task_reminder_logs.task_id exists");
  ok(rlColNames.includes("reminder_type"), "task_reminder_logs.reminder_type exists");
  ok(rlColNames.includes("channel"), "task_reminder_logs.channel exists");

  await pool.end();
}

// ── T24: reminder engine rules (via HTTP) ─────────────────────────────────────
async function t24_reminder_engine() {
  console.log("\n── T24: Reminder Engine Rules ──");

  const r = await api("/api/execution/rules");
  ok(r.status === 200, "GET /api/execution/rules → 200");

  const body = await r.json();
  ok(Array.isArray(body.rules), "body.rules is array");
  ok(body.rules.length >= 5, `Has at least 5 rules (got ${body.rules.length})`);

  const ruleIds = body.rules.map((r) => r.id);
  ok(ruleIds.includes("due_today_morning"), "due_today_morning rule exists");
  ok(ruleIds.includes("overdue_reminder"), "overdue_reminder rule exists");
  ok(ruleIds.includes("high_priority_escalation"), "high_priority_escalation rule exists");
  ok(ruleIds.includes("untouched_task"), "untouched_task rule exists");
  ok(ruleIds.includes("suggestion_ignored"), "suggestion_ignored rule exists");

  for (const rule of body.rules) {
    ok(typeof rule.id === "string", `Rule ${rule.id}: id is string`);
    ok(typeof rule.label === "string", `Rule ${rule.id}: label is string`);
    ok(typeof rule.cooldownHours === "number", `Rule ${rule.id}: cooldownHours is number`);
    ok(typeof rule.escalates === "boolean", `Rule ${rule.id}: escalates is boolean`);
  }
}

// ── T25: reminder engine trigger logic (via HTTP + DB) ────────────────────────
async function t25_reminder_trigger_logic() {
  console.log("\n── T25: Reminder Trigger Logic ──");

  // Seed a 2-day-overdue task, run reminders, verify a log entry was created
  const overdueDue = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const taskId = await seedTaskForUser(4, overdueDue);
  console.log(`  ℹ Seeded overdue task id=${taskId}`);

  // Clear any existing reminder logs for this task to get a clean count
  const pool = await getPool();
  await pool.query(`DELETE FROM task_reminder_logs WHERE task_id = $1`, [taskId]);

  const r = await api("/api/execution/run-reminders", { method: "POST" });
  ok(r.status === 200, "run-reminders succeeds for overdue task");

  const logRows = await pool.query(
    `SELECT reminder_type FROM task_reminder_logs WHERE task_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [taskId]
  );
  ok(logRows.rows.length > 0, "overdue_reminder rule created a log entry for 2d overdue task");

  // Verify cooldown: run again — should NOT create a duplicate log within the same cooldown window
  const countBefore = logRows.rows.length;
  await api("/api/execution/run-reminders", { method: "POST" });
  const countAfter = (await pool.query(`SELECT id FROM task_reminder_logs WHERE task_id = $1`, [taskId])).rows.length;
  ok(countAfter === countBefore, "Cooldown prevents duplicate reminders within window");

  await pool.end();
  await deleteTask(taskId);
}

// ── T26: regression — tasks hub unbroken ─────────────────────────────────────
async function t26_regression_tasks_hub() {
  console.log("\n── T26: Regression — Tasks Hub ──");

  for (const view of ["my", "team", "today", "overdue", "upcoming", "completed"]) {
    const r = await api(`/api/tasks/hub?view=${view}`);
    ok(r.status === 200, `tasks hub view=${view} → 200`);
    const body = await r.json();
    ok(Array.isArray(body.tasks), `view=${view}: tasks is array`);
    ok(typeof body.counts === "object", `view=${view}: counts is object`);
  }
}

// ── T27: regression — task suggestions unbroken ───────────────────────────────
async function t27_regression_suggestions() {
  console.log("\n── T27: Regression — Task Suggestions ──");

  const r = await api("/api/tasks/suggestions");
  ok(r.status === 200, "GET /api/tasks/suggestions → 200");

  const body = await r.json();
  ok(typeof body === "object", "Suggestions body is object");
  ok(Array.isArray(body.suggestions), "suggestions is array");
  ok(typeof body.total === "number", "total is number");
}

// ── T28: search fix regression ────────────────────────────────────────────────
async function t28_search_fix() {
  console.log("\n── T28: Global Search Fix ──");

  const r = await api("/api/search?q=marina");
  ok(r.status === 200, "GET /api/search?q=marina → 200");

  const body = await r.json();
  ok(typeof body === "object" && Array.isArray(body.results), "Search returns {results:[]}");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log("══ Daily Execution + Reminder System Tests ══\n");

  try {
    await login();

    await t01_auth();
    await t02_today_shape();
    await t03_summary_shape();
    await t04_remind_now();
    await t05_remind_now_404();
    await t06_escalate();
    await t07_escalate_404();
    await t08_bulk_complete();
    await t09_bulk_complete_validation();
    await t10_bulk_reassign();
    await t11_bulk_reassign_validation();
    await t12_bulk_snooze();
    await t13_bulk_snooze_validation();
    await t14_settings_get_defaults();
    await t15_settings_put();
    await t16_settings_validation();
    await t17_settings_permission();
    await t18_bulk_permissions();
    await t19_digest();
    await t20_digest_cooldown();
    await t21_digest_invalid_type();
    await t22_run_reminders();
    await t23_schema_columns();
    await t24_reminder_engine();
    await t25_reminder_trigger_logic();
    await t26_regression_tasks_hub();
    await t27_regression_suggestions();
    await t28_search_fix();

  } catch (err) {
    console.error("\nUnhandled error:", err);
    fail++;
  }

  console.log(`\n══ Results: ${pass} passed, ${fail} failed ══`);
  if (fail > 0) process.exit(1);
}

run();
