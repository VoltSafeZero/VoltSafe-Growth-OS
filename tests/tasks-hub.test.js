#!/usr/bin/env node
/**
 * Tasks Hub + Execution Queue Test Suite
 * Tests: hub views, groupBy, task shape, quick actions (complete/snooze/reassign),
 *        due date update, reminder, auth enforcement, snoozed task exclusion.
 *
 * Run with: node tests/tasks-hub.test.js
 * Requires: server running at localhost:5000
 */

const BASE = "http://localhost:5000";
let passed = 0;
let failed = 0;

function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail) { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
function expect(label, actual, expected) {
  if (actual === expected) ok(`${label} → ${actual}`);
  else fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:5000" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status}`);
  const cookie = res.headers.get("set-cookie")?.match(/(connect\.sid=[^;]+)/)?.[1];
  if (!cookie) throw new Error(`No session cookie for ${email}`);
  await sleep(300);
  return cookie;
}

async function api(method, path, body, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:5000",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

async function run() {
  console.log("\n══════════════════════════════════════════════");
  console.log("  Tasks Hub + Execution Queue Test Suite");
  console.log("══════════════════════════════════════════════\n");

  const trevorCookie = await login("trevor@voltsafe.com", "alberni1444");
  const viewerCookie = await login("viewer@voltsafe.com", "testpass1234");

  // ── T1: Hub API shape ─────────────────────────────────────────────────────
  console.log("T1: Hub API shape");
  {
    const res = await api("GET", "/api/tasks/hub?view=my&groupBy=due_date", null, trevorCookie);
    expect("GET /api/tasks/hub → 200", res.status, 200);
    const body = await res.json();

    Array.isArray(body.tasks) ? ok("body.tasks is array") : fail("body.tasks is array");
    typeof body.groups === "object" ? ok("body.groups is object") : fail("body.groups is object");
    typeof body.counts === "object" ? ok("body.counts is object") : fail("body.counts is object");
    typeof body.total === "number" ? ok("body.total is number") : fail("body.total is number");
    expect("body.view = my", body.view, "my");
    expect("body.groupBy = due_date", body.groupBy, "due_date");

    ["my_count", "team_count", "today_count", "overdue_count", "upcoming_count"].forEach(field => {
      typeof body.counts[field] === "number"
        ? ok(`counts.${field} is number`)
        : fail(`counts.${field} is number`);
    });

    if (body.tasks.length > 0) {
      const t = body.tasks[0];
      ["id", "title", "status", "priority", "ownerUserId", "ownerName"].forEach(f => {
        t[f] !== undefined ? ok(`task has field: ${f}`) : fail(`task missing field: ${f}`);
      });
      expect("task has source field", typeof t.source !== "undefined", true);
      expect("task has snoozedUntil field", "snoozedUntil" in t, true);
    } else {
      ok("No tasks — field check skipped");
    }
  }

  // ── T2: Auth enforcement ──────────────────────────────────────────────────
  console.log("\nT2: Auth enforcement");
  {
    const res = await api("GET", "/api/tasks/hub", null, null);
    expect("GET /api/tasks/hub unauthenticated → 401", res.status, 401);

    const res2 = await api("POST", "/api/tasks/1/complete", null, null);
    expect("POST /api/tasks/1/complete unauthenticated → 401", res2.status, 401);

    const res3 = await api("POST", "/api/tasks/1/snooze", null, null);
    expect("POST /api/tasks/1/snooze unauthenticated → 401", res3.status, 401);

    const res4 = await api("POST", "/api/tasks/1/reassign", null, null);
    expect("POST /api/tasks/1/reassign unauthenticated → 401", res4.status, 401);
  }

  // ── T3: All views return correct shape ─────────────────────────────────────
  console.log("\nT3: View coverage");
  const views = ["my", "team", "today", "overdue", "upcoming", "completed"];
  let testTaskId = null;
  for (const v of views) {
    const res = await api("GET", `/api/tasks/hub?view=${v}`, null, trevorCookie);
    expect(`GET /api/tasks/hub?view=${v} → 200`, res.status, 200);
    const body = await res.json();
    Array.isArray(body.tasks) ? ok(`view=${v} returns tasks array`) : fail(`view=${v} returns tasks array`);
    expect(`view=${v} body.view = ${v}`, body.view, v);
    // Grab a task id from "my" view for further tests
    if (v === "my" && body.tasks.length > 0 && !testTaskId) {
      testTaskId = body.tasks[0].id;
    }
  }

  // ── T4: GroupBy variations ────────────────────────────────────────────────
  console.log("\nT4: GroupBy variations");
  for (const g of ["due_date", "priority", "linked_record", "assignee"]) {
    const res = await api("GET", `/api/tasks/hub?view=my&groupBy=${g}`, null, trevorCookie);
    expect(`groupBy=${g} → 200`, res.status, 200);
    const body = await res.json();
    typeof body.groups === "object" ? ok(`groupBy=${g} returns groups object`) : fail(`groupBy=${g} returns groups object`);
  }

  // ── T5: Complete action ───────────────────────────────────────────────────
  console.log("\nT5: Complete action");
  if (!testTaskId) {
    ok("No test task — complete test skipped");
  } else {
    // First un-complete it if it's already done
    await api("PUT", `/api/tasks/${testTaskId}`, { status: "pending" }, trevorCookie);
    await sleep(200);

    const res = await api("POST", `/api/tasks/${testTaskId}/complete`, null, trevorCookie);
    expect(`POST /api/tasks/${testTaskId}/complete → 200`, res.status, 200);
    const body = await res.json();
    expect("complete ok:true", body.ok, true);
    expect("task.status = done", body.task?.status, "done");

    // Should now appear in completed view
    const completedRes = await api("GET", `/api/tasks/hub?view=completed`, null, trevorCookie);
    const completedBody = await completedRes.json();
    const found = completedBody.tasks.some(t => t.id === testTaskId);
    found ? ok("completed task appears in completed view") : fail("completed task appears in completed view");

    // Should NOT appear in my view
    const myRes = await api("GET", `/api/tasks/hub?view=my`, null, trevorCookie);
    const myBody = await myRes.json();
    const foundInMy = myBody.tasks.some(t => t.id === testTaskId);
    !foundInMy ? ok("completed task excluded from my view") : fail("completed task excluded from my view");

    // Restore for further tests
    await api("PUT", `/api/tasks/${testTaskId}`, { status: "pending", snoozedUntil: null }, trevorCookie);
  }

  // ── T6: Snooze action ────────────────────────────────────────────────────
  console.log("\nT6: Snooze action");
  if (!testTaskId) {
    ok("No test task — snooze test skipped");
  } else {
    const res = await api("POST", `/api/tasks/${testTaskId}/snooze`, { preset: "later_today" }, trevorCookie);
    expect(`POST /api/tasks/${testTaskId}/snooze → 200`, res.status, 200);
    const body = await res.json();
    expect("snooze ok:true", body.ok, true);
    const snoozedUntil = new Date(body.snoozedUntil);
    const now = new Date();
    const diffH = (snoozedUntil - now) / 3600000;
    (diffH >= 2 && diffH <= 5) ? ok(`snooze preset later_today ~${diffH.toFixed(1)}h`) : fail("snooze preset later_today hours range", `${diffH.toFixed(1)}h`);

    // Snoozed task should NOT appear in "my" view (it's snoozed)
    await sleep(200);
    const myRes = await api("GET", `/api/tasks/hub?view=my`, null, trevorCookie);
    const myBody = await myRes.json();
    const inMy = myBody.tasks.some(t => t.id === testTaskId);
    !inMy ? ok("snoozed task excluded from my view") : fail("snoozed task should be excluded from my view");

    // Test tomorrow_morning
    const res2 = await api("POST", `/api/tasks/${testTaskId}/snooze`, { preset: "tomorrow_morning" }, trevorCookie);
    expect("snooze tomorrow_morning → 200", res2.status, 200);
    const body2 = await res2.json();
    expect("snooze tomorrow_morning hour = 9", new Date(body2.snoozedUntil).getHours(), 9);

    // Test next_week
    const res3 = await api("POST", `/api/tasks/${testTaskId}/snooze`, { preset: "next_week" }, trevorCookie);
    expect("snooze next_week → 200", res3.status, 200);
    const body3 = await res3.json();
    const days3 = (new Date(body3.snoozedUntil) - now) / 86400000;
    (days3 >= 6 && days3 <= 8) ? ok(`snooze next_week ~${days3.toFixed(1)}d`) : fail("snooze next_week days range", `${days3.toFixed(1)}d`);

    // Clear snooze
    const clearRes = await api("PUT", `/api/tasks/${testTaskId}`, { snoozedUntil: null }, trevorCookie);
    expect("clear snooze → 200", clearRes.status, 200);

    // Invalid snooze
    const badRes = await api("POST", `/api/tasks/${testTaskId}/snooze`, {}, trevorCookie);
    expect("snooze with no preset → 400", badRes.status, 400);
  }

  // ── T7: Reassign action ───────────────────────────────────────────────────
  console.log("\nT7: Reassign action");
  if (!testTaskId) {
    ok("No test task — reassign test skipped");
  } else {
    const res = await api("POST", `/api/tasks/${testTaskId}/reassign`, { ownerUserId: 4 }, trevorCookie);
    expect(`POST /api/tasks/${testTaskId}/reassign → 200`, res.status, 200);
    const body = await res.json();
    expect("reassign ok:true", body.ok, true);
    expect("task.ownerUserId = 4", body.task?.ownerUserId, 4);

    // Missing ownerUserId
    const badRes = await api("POST", `/api/tasks/${testTaskId}/reassign`, {}, trevorCookie);
    expect("reassign without ownerUserId → 400", badRes.status, 400);

    // Non-existent task
    const notFoundRes = await api("POST", `/api/tasks/99999/reassign`, { ownerUserId: 4 }, trevorCookie);
    expect("reassign non-existent task → 404", notFoundRes.status, 404);
  }

  // ── T8: Due date update ───────────────────────────────────────────────────
  console.log("\nT8: Due date update");
  if (!testTaskId) {
    ok("No test task — due date test skipped");
  } else {
    const newDate = new Date(); newDate.setDate(newDate.getDate() + 5);
    const isoDate = newDate.toISOString().split("T")[0];
    const res = await api("PUT", `/api/tasks/${testTaskId}`, { dueDate: newDate.toISOString() }, trevorCookie);
    expect("PUT /api/tasks/:id dueDate → 200", res.status, 200);
    const body = await res.json();
    body.dueDate ? ok("task.dueDate updated") : fail("task.dueDate should be set");
  }

  // ── T9: Overdue view only shows overdue tasks ─────────────────────────────
  console.log("\nT9: Overdue view correctness");
  {
    const res = await api("GET", "/api/tasks/hub?view=overdue", null, trevorCookie);
    expect("GET /api/tasks/hub?view=overdue → 200", res.status, 200);
    const body = await res.json();
    const now = new Date();
    const allOverdue = body.tasks.every(t => {
      if (!t.dueDate) return false;
      return new Date(t.dueDate) < now;
    });
    allOverdue || body.tasks.length === 0
      ? ok(`Overdue view: all ${body.tasks.length} tasks are overdue`)
      : fail("Overdue view contains non-overdue tasks");
  }

  // ── T10: Team view shows tasks from all users ─────────────────────────────
  console.log("\nT10: Team view");
  {
    const myRes = await api("GET", "/api/tasks/hub?view=my", null, trevorCookie);
    const teamRes = await api("GET", "/api/tasks/hub?view=team", null, trevorCookie);
    const myBody = await myRes.json();
    const teamBody = await teamRes.json();
    (teamBody.total >= myBody.total)
      ? ok(`Team view (${teamBody.total}) >= My view (${myBody.total})`)
      : fail("Team view should have >= tasks vs My view");
    typeof teamBody.counts.team_count === "number" ? ok("team_count is number") : fail("team_count is number");
  }

  // ── T11: Create task with source field ─────────────────────────────────────
  console.log("\nT11: Task source field");
  {
    const res = await api("POST", "/api/tasks", {
      title: "Hub test task",
      status: "pending",
      priority: "high",
      source: "automation",
      ownerUserId: 4,
    }, trevorCookie);
    expect("POST /api/tasks → 201", res.status, 201);
    const body = await res.json();
    expect("created task source = automation", body.source, "automation");
    expect("created task priority = high", body.priority, "high");
    // Cleanup
    if (body.id) {
      await api("PUT", `/api/tasks/${body.id}`, { status: "done" }, trevorCookie);
    }
  }

  // ── T12: Hub counts consistency ───────────────────────────────────────────
  console.log("\nT12: Count consistency");
  {
    const res = await api("GET", "/api/tasks/hub?view=my", null, trevorCookie);
    const body = await res.json();
    expect("counts.my_count = total tasks in my view", body.counts.my_count, body.total);

    const overdueRes = await api("GET", "/api/tasks/hub?view=overdue", null, trevorCookie);
    const overdueBody = await overdueRes.json();
    (overdueBody.total <= body.counts.overdue_count + 2)
      ? ok(`Overdue count consistent: ${overdueBody.total} vs ${body.counts.overdue_count}`)
      : fail("Overdue count mismatch", `view=${overdueBody.total}, count=${body.counts.overdue_count}`);
  }

  // ── T13: Completed view group header regression ───────────────────────────
  // Bug: selecting the Completed tab rendered a stale "Overdue" section header
  // (because tasks that were overdue before being marked done fell into the
  // due-date "Overdue" bucket). The fix forces single-purpose tabs to use a
  // group key matching the tab itself.
  console.log("\nT13: Completed view group header regression");
  {
    const res = await api("GET", "/api/tasks/hub?view=completed&groupBy=due_date", null, trevorCookie);
    expect("GET /api/tasks/hub?view=completed → 200", res.status, 200);
    const body = await res.json();
    const groupKeys = Object.keys(body.groups || {});

    if (body.total === 0) {
      ok("Completed view has no tasks — group-key check skipped");
    } else {
      (!groupKeys.includes("Overdue"))
        ? ok("Completed view never groups tasks under 'Overdue'")
        : fail("Completed view still contains an 'Overdue' group key", JSON.stringify(groupKeys));

      groupKeys.every(k => k === "Completed")
        ? ok(`Completed view groups exclusively under 'Completed' (${groupKeys.join(", ")})`)
        : fail("Completed view has non-'Completed' group keys", JSON.stringify(groupKeys));

      body.tasks.every(t => t.status === "done" || t.status === "completed")
        ? ok("Completed view only contains done/completed tasks")
        : fail("Completed view contains a non-completed task");
    }
  }

  // ── T14: Other single-purpose views also use fixed group labels ───────────
  console.log("\nT14: Fixed group labels for single-purpose views");
  {
    const fixedViews = [
      ["today", "Due Today"],
      ["upcoming", "Upcoming"],
      ["team", "Team Tasks"],
      ["assigned_by_me", "Delegated"],
    ];
    for (const [view, expectedLabel] of fixedViews) {
      const res = await api("GET", `/api/tasks/hub?view=${view}&groupBy=due_date`, null, trevorCookie);
      const body = await res.json();
      const groupKeys = Object.keys(body.groups || {});
      if (body.total === 0) {
        ok(`${view} view has no tasks — group-key check skipped`);
      } else {
        groupKeys.every(k => k === expectedLabel)
          ? ok(`${view} view groups exclusively under '${expectedLabel}'`)
          : fail(`${view} view has unexpected group keys`, JSON.stringify(groupKeys));
      }
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("══════════════════════════════════════════════\n");
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error("Fatal:", err.message); process.exit(1); });
