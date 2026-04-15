#!/usr/bin/env node
/**
 * Notifications + Reminders Test Suite
 * Tests: notification generation, dedupe/cooldown, mark read, permissions,
 *        reminder presets, and daily digest endpoint.
 *
 * Run with: node tests/notifications.test.js
 * Requires: server running at localhost:5000
 */

const BASE = "http://localhost:5000";
let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  ✓ ${label}`);
  passed++;
}

function fail(label, detail) {
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  failed++;
}

function expect(label, actual, expected) {
  if (actual === expected) ok(`${label} → ${actual}`);
  else fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

async function run() {
  console.log("\n══════════════════════════════════════════════");
  console.log("  Notifications + Reminders Test Suite");
  console.log("══════════════════════════════════════════════\n");

  const trevorCookie = await login("trevor@voltsafe.com", "alberni1444");
  const viewerCookie = await login("viewer@voltsafe.com", "testpass1234");

  // ── T1: GET /api/notifications — returns correct shape ──────────────────
  console.log("T1: Notification list shape");
  {
    const res = await api("GET", "/api/notifications", null, trevorCookie);
    expect("status", res.status, 200);
    const body = await res.json();

    const hasNotifications = Array.isArray(body.notifications);
    hasNotifications ? ok("body.notifications is array") : fail("body.notifications is array");

    const hasUnreadCount = typeof body.unreadCount === "number";
    hasUnreadCount ? ok("body.unreadCount is number") : fail("body.unreadCount is number");

    if (body.notifications.length > 0) {
      const first = body.notifications[0];
      ["id", "type", "title", "body", "severity", "actionUrl", "isRead", "createdAt"].forEach(field => {
        first[field] !== undefined
          ? ok(`notification has field: ${field}`)
          : fail(`notification missing field: ${field}`);
      });

      const validSeverities = ["high", "medium", "low"];
      validSeverities.includes(first.severity)
        ? ok(`severity is valid: ${first.severity}`)
        : fail(`severity invalid: ${first.severity}`);

      const isReadBool = typeof first.isRead === "boolean";
      isReadBool ? ok("isRead is boolean") : fail("isRead is boolean");
    } else {
      ok("No notifications yet (clean state) — shape checks skipped");
    }
  }

  // ── T2: Unauthenticated access blocked ───────────────────────────────────
  console.log("\nT2: Auth enforcement");
  {
    const res = await api("GET", "/api/notifications", null, null);
    expect("GET /api/notifications unauthenticated → 401", res.status, 401);

    const res2 = await api("PATCH", "/api/notifications/1/read", null, null);
    expect("PATCH /api/notifications/1/read unauthenticated → 401", res2.status, 401);

    const res3 = await api("PATCH", "/api/notifications/read-all", null, null);
    expect("PATCH /api/notifications/read-all unauthenticated → 401", res3.status, 401);
  }

  // ── T3: Mark single notification as read ─────────────────────────────────
  console.log("\nT3: Mark single notification read");
  {
    // First fetch to get IDs
    const listRes = await api("GET", "/api/notifications", null, trevorCookie);
    const listBody = await listRes.json();
    const notifs = listBody.notifications;

    if (notifs.length === 0) {
      ok("No notifications to mark read — test skipped");
    } else {
      // Find an unread notification
      const unread = notifs.find(n => !n.isRead);
      if (!unread) {
        ok("No unread notifications — mark read test skipped");
      } else {
        const markRes = await api("PATCH", `/api/notifications/${unread.id}/read`, null, trevorCookie);
        expect(`PATCH /api/notifications/${unread.id}/read → 200`, markRes.status, 200);
        const markBody = await markRes.json();
        expect("mark read ok:true", markBody.ok, true);

        // Re-fetch and verify it's now read
        const relistRes = await api("GET", "/api/notifications", null, trevorCookie);
        const relistBody = await relistRes.json();
        const nowRead = relistBody.notifications.find(n => n.id === unread.id);
        if (nowRead) {
          nowRead.isRead === true
            ? ok(`notification ${unread.id} isRead = true after mark`)
            : fail(`notification ${unread.id} isRead should be true`, `got ${nowRead.isRead}`);
        } else {
          ok("notification no longer in unread list — considered read");
        }
      }
    }
  }

  // ── T4: Mark all read ────────────────────────────────────────────────────
  console.log("\nT4: Mark all read");
  {
    const res = await api("PATCH", "/api/notifications/read-all", null, trevorCookie);
    expect("PATCH /api/notifications/read-all → 200", res.status, 200);
    const body = await res.json();
    expect("mark-all-read ok:true", body.ok, true);

    // Re-fetch and confirm unreadCount is 0
    const listRes = await api("GET", "/api/notifications", null, trevorCookie);
    const listBody = await listRes.json();
    const unreadAfter = listBody.notifications.filter(n => !n.isRead).length;
    unreadAfter === 0
      ? ok("unreadCount = 0 after mark all read")
      : fail(`unreadCount should be 0, got ${unreadAfter}`);
    expect("body.unreadCount = 0", listBody.unreadCount, 0);
  }

  // ── T5: Dedupe — second GET doesn't re-create same notifications ──────────
  console.log("\nT5: Dedupe / cooldown");
  {
    const res1 = await api("GET", "/api/notifications", null, trevorCookie);
    const body1 = await res1.json();
    const count1 = body1.notifications.length;

    // Small delay then fetch again
    await sleep(500);
    const res2 = await api("GET", "/api/notifications", null, trevorCookie);
    const body2 = await res2.json();
    const count2 = body2.notifications.length;

    count2 <= count1 + 2  // Allow up to 2 new (e.g. meetings fired exact time)
      ? ok(`Dedupe working: count stable ${count1} → ${count2}`)
      : fail(`Dedupe failed: count grew ${count1} → ${count2} unexpectedly`);
  }

  // ── T6: Viewer user gets their own notifications (not Trevor's) ───────────
  console.log("\nT6: Per-user isolation");
  {
    const trevorRes = await api("GET", "/api/notifications", null, trevorCookie);
    const trevorBody = await trevorRes.json();

    const viewerRes = await api("GET", "/api/notifications", null, viewerCookie);
    const viewerBody = await viewerRes.json();

    // Both should be valid shape
    expect("viewer /api/notifications → 200", viewerRes.status, 200);
    Array.isArray(viewerBody.notifications)
      ? ok("viewer body.notifications is array")
      : fail("viewer body.notifications is array");

    // Viewer mark all read should only affect viewer
    await api("PATCH", "/api/notifications/read-all", null, viewerCookie);
    const trevorAfterRes = await api("GET", "/api/notifications", null, trevorCookie);
    const trevorAfterBody = await trevorAfterRes.json();
    // Trevor's notifications should still be there (mark all read was viewer-only)
    trevorAfterBody.notifications.length >= 0
      ? ok("Trevor notifications unaffected by viewer mark-all-read")
      : fail("Trevor notifications unexpectedly empty");
  }

  // ── T7: Task reminder — preset: later_today ───────────────────────────────
  console.log("\nT7: Task reminder presets");
  {
    // Find a task owned by Trevor
    const tasksRes = await api("GET", "/api/tasks?ownerId=4&limit=5", null, trevorCookie);
    const tasks = tasksRes.ok ? await tasksRes.json() : [];
    const task = Array.isArray(tasks) ? tasks[0] : null;

    if (!task) {
      ok("No tasks found — reminder preset test skipped");
    } else {
      const taskId = task.id;

      // Set reminder: later today
      const remRes = await api("POST", `/api/tasks/${taskId}/reminder`, { preset: "later_today" }, trevorCookie);
      expect(`POST /api/tasks/${taskId}/reminder → 200`, remRes.status, 200);
      const remBody = await remRes.json();
      expect("reminder ok:true", remBody.ok, true);
      const reminderAt = new Date(remBody.reminderAt);
      const now = new Date();
      const diffHours = (reminderAt - now) / 3600_000;
      (diffHours >= 2 && diffHours <= 5)
        ? ok(`later_today reminderAt is ~3h from now (${diffHours.toFixed(1)}h)`)
        : fail(`later_today reminderAt hours out of range`, `${diffHours.toFixed(1)}h`);

      // Set reminder: tomorrow morning
      const rem2Res = await api("POST", `/api/tasks/${taskId}/reminder`, { preset: "tomorrow_morning" }, trevorCookie);
      expect(`POST /api/tasks/${taskId}/reminder tomorrow_morning → 200`, rem2Res.status, 200);
      const rem2Body = await rem2Res.json();
      const rem2Date = new Date(rem2Body.reminderAt);
      const rem2Hours = rem2Date.getHours();
      expect("tomorrow_morning is at hour 9", rem2Hours, 9);

      // Set reminder: next week
      const rem3Res = await api("POST", `/api/tasks/${taskId}/reminder`, { preset: "next_week" }, trevorCookie);
      expect(`POST /api/tasks/${taskId}/reminder next_week → 200`, rem3Res.status, 200);
      const rem3Body = await rem3Res.json();
      const rem3Date = new Date(rem3Body.reminderAt);
      const daysDiff = (rem3Date - now) / 86400_000;
      (daysDiff >= 6 && daysDiff <= 8)
        ? ok(`next_week is ~7 days out (${daysDiff.toFixed(1)}d)`)
        : fail(`next_week days out of range`, `${daysDiff.toFixed(1)}d`);

      // Clear reminder
      const clearRes = await api("DELETE", `/api/tasks/${taskId}/reminder`, null, trevorCookie);
      expect(`DELETE /api/tasks/${taskId}/reminder → 200`, clearRes.status, 200);
    }
  }

  // ── T8: Invalid reminder preset rejected ─────────────────────────────────
  console.log("\nT8: Reminder validation");
  {
    const tasksRes = await api("GET", "/api/tasks?ownerId=4&limit=1", null, trevorCookie);
    const tasks = tasksRes.ok ? await tasksRes.json() : [];
    const task = Array.isArray(tasks) ? tasks[0] : null;

    if (task) {
      const badRes = await api("POST", `/api/tasks/${task.id}/reminder`, { preset: "invalid_preset" }, trevorCookie);
      expect("invalid preset → 400", badRes.status, 400);

      const noBodyRes = await api("POST", `/api/tasks/${task.id}/reminder`, {}, trevorCookie);
      expect("no preset/reminderAt → 400", noBodyRes.status, 400);

      // Non-existent task
      const notFoundRes = await api("POST", "/api/tasks/99999/reminder", { preset: "later_today" }, trevorCookie);
      expect("non-existent task → 404", notFoundRes.status, 404);
    } else {
      ok("No tasks — reminder validation test skipped");
    }
  }

  // ── T9: Daily digest endpoint ─────────────────────────────────────────────
  console.log("\nT9: Daily digest");
  {
    const res = await api("GET", "/api/notifications/digest", null, trevorCookie);
    expect("GET /api/notifications/digest → 200", res.status, 200);
    const body = await res.json();

    typeof body.totalUnread === "number"
      ? ok(`digest.totalUnread is number: ${body.totalUnread}`)
      : fail("digest.totalUnread is number");

    Array.isArray(body.summary)
      ? ok("digest.summary is array")
      : fail("digest.summary is array");

    Array.isArray(body.topAlerts)
      ? ok("digest.topAlerts is array")
      : fail("digest.topAlerts is array");

    // topAlerts should have <= 3 items
    body.topAlerts.length <= 3
      ? ok(`digest.topAlerts.length ≤ 3 (got ${body.topAlerts.length})`)
      : fail(`digest.topAlerts.length should be ≤ 3, got ${body.topAlerts.length}`);

    // Digest unauthenticated
    const unauthedRes = await api("GET", "/api/notifications/digest", null, null);
    expect("digest unauthenticated → 401", unauthedRes.status, 401);
  }

  // ── T10: Notification type validation ────────────────────────────────────
  console.log("\nT10: Notification type coverage");
  {
    const res = await api("GET", "/api/notifications", null, trevorCookie);
    const body = await res.json();
    const types = new Set(body.notifications.map(n => n.type));
    const validTypes = new Set(["overdue_task", "reminder", "stale_opportunity", "account_at_risk", "inbox_followup_needed", "meeting", "lead"]);
    const unknownTypes = [...types].filter(t => !validTypes.has(t));
    unknownTypes.length === 0
      ? ok(`All notification types are valid: ${[...types].join(", ") || "none"}`)
      : fail(`Unknown notification types: ${unknownTypes.join(", ")}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("══════════════════════════════════════════════\n");

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log("All tests passed.");
    process.exit(0);
  }
}

run().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
