#!/usr/bin/env node
/**
 * Task Hub Access — Delegated Search Parity Test
 *
 * Proves that GET /api/tasks/search scopes results to tasks the caller is
 * authorised to see, mirroring canAccessTask() semantics including the
 * delegated-task case:
 *
 *   User B (trevor) creates a task and delegates ownership to User C (mixed).
 *   User A (viewer) is granted hub-access to User B (trevor, the creator).
 *   User A must be able to find that task via search, even though trevor is
 *   not the owner — exactly as the board and direct task endpoints allow it.
 *
 * Run with: node tests/task-hub-access-search.test.cjs
 * Requires: server running at localhost:5000, trevor/viewer/mixed seeded.
 */

"use strict";
const BASE = "http://localhost:5000";
let passed = 0;
let failed = 0;

function ok(label)         { console.log(`  ✓ ${label}`);                       passed++; }
function fail(label, msg)  { console.error(`  ✗ ${label}${msg ? ` — ${msg}` : ""}`); failed++; }

async function apiFetch(path, { method = "GET", body, cookie } = {}) {
  const headers = { "Content-Type": "application/json", "Origin": BASE };
  if (cookie) headers["Cookie"] = cookie;
  return fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function login(email, password) {
  const res = await apiFetch("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status}`);
  const raw = res.headers.get("set-cookie") ?? "";
  const match = raw.match(/(connect\.sid=[^;]+)/);
  if (!match) throw new Error(`No session cookie for ${email}`);
  return match[1];
}

async function run() {
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  Task Hub Access — Delegated Search Parity");
  console.log("══════════════════════════════════════════════════════════════\n");

  // ── Setup ──────────────────────────────────────────────────────────────────
  const adminCookie  = await login("trevor@voltsafe.com", "alberni1444");
  const viewerCookie = await login("viewer@voltsafe.com",  "testpass1234");

  // Resolve user IDs from /api/auth/me equivalents so we don't hardcode
  const adminMe  = await (await apiFetch("/api/auth/me",  { cookie: adminCookie  })).json().catch(() => null);
  const viewerMe = await (await apiFetch("/api/auth/me",  { cookie: viewerCookie })).json().catch(() => null);

  // Fall back to known seed IDs if the endpoint isn't available
  const adminId  = adminMe?.id  ?? 4;
  const viewerId = viewerMe?.id ?? 6;

  // Owner for the delegated task — a third user that viewer does NOT have
  // hub-access to.  "mixed" (id=7) is seeded alongside trevor and viewer.
  const delegateOwnerId = 7;

  // Unique title so later searches are unambiguous
  const uniqueTitle = `DelegSearch-${Date.now()}`;

  // ── T1: Create a delegated task (trevor=creator, mixed=owner) ─────────────
  console.log("T1: Create task as trevor with owner=mixed (delegated task)");
  {
    const res = await apiFetch("/api/tasks", {
      method:  "POST",
      cookie:  adminCookie,
      body:    { title: uniqueTitle, status: "pending", priority: "medium", ownerUserId: delegateOwnerId },
    });
    res.status === 201 ? ok(`POST /api/tasks → 201`) : fail("POST /api/tasks → 201", `got ${res.status}`);
    var taskId = (await res.json().catch(() => ({}))).id;
    taskId ? ok(`task created with id=${taskId}`) : fail("task id in response");
  }

  // ── T2: Viewer cannot find the task before hub-access grant ───────────────
  console.log("\nT2: Search as viewer (no hub-access) — must NOT return task");
  {
    const res = await apiFetch(`/api/tasks/search?q=${encodeURIComponent(uniqueTitle)}`, { cookie: viewerCookie });
    res.ok ? ok("GET /api/tasks/search → 200") : fail("GET /api/tasks/search → 200", `got ${res.status}`);
    const results = await res.json().catch(() => []);
    const found = Array.isArray(results) && results.some(t => t.id === taskId);
    !found ? ok("task NOT visible to viewer before hub-access grant") : fail("task should NOT be visible before grant", `found id=${taskId}`);
  }

  // ── T3: Grant viewer hub-access to trevor (the creator) ───────────────────
  console.log("\nT3: Grant viewer hub-access to trevor (admin action)");
  let grantId = null;
  {
    const res = await apiFetch("/api/tasks/hub-access/permissions", {
      method: "POST",
      cookie: adminCookie,
      body:   { viewerUserId: viewerId, targetUserId: adminId, permissionLevel: "view" },
    });
    res.ok ? ok("POST /api/tasks/hub-access/permissions → 200") : fail("hub-access grant succeeded", `status=${res.status}`);

    // Fetch the grant ID so we can revoke it afterwards
    const listRes = await apiFetch("/api/tasks/hub-access/permissions", { cookie: adminCookie });
    const list    = await listRes.json().catch(() => []);
    const grant   = Array.isArray(list) && list.find(g => g.viewerUserId === viewerId && g.targetUserId === adminId);
    grantId = grant?.id ?? null;
    grantId ? ok(`grant recorded id=${grantId}`) : fail("grant id in permissions list");
  }

  // ── T4: Viewer can now find the delegated task via search ─────────────────
  console.log("\nT4: Search as viewer WITH hub-access to creator — must find task");
  {
    const res = await apiFetch(`/api/tasks/search?q=${encodeURIComponent(uniqueTitle)}`, { cookie: viewerCookie });
    res.ok ? ok("GET /api/tasks/search → 200") : fail("GET /api/tasks/search → 200", `got ${res.status}`);
    const results = await res.json().catch(() => []);
    const found = Array.isArray(results) && results.some(t => t.id === taskId);
    found
      ? ok("delegated task IS visible to viewer after hub-access to creator")
      : fail("delegated task should be visible after hub-access to creator", `results=${JSON.stringify(results)}`);
  }

  // ── T5: Revoke hub-access — task disappears again ─────────────────────────
  console.log("\nT5: Revoke hub-access — task must NOT be visible again");
  if (grantId) {
    const delRes = await apiFetch(`/api/tasks/hub-access/permissions/${grantId}`, {
      method: "DELETE",
      cookie: adminCookie,
    });
    delRes.ok ? ok(`DELETE /api/tasks/hub-access/permissions/${grantId} → 200`) : fail("hub-access revoke", `status=${delRes.status}`);

    const res = await apiFetch(`/api/tasks/search?q=${encodeURIComponent(uniqueTitle)}`, { cookie: viewerCookie });
    const results = await res.json().catch(() => []);
    const found = Array.isArray(results) && results.some(t => t.id === taskId);
    !found
      ? ok("task NOT visible after hub-access revocation")
      : fail("task should NOT be visible after revocation");
  } else {
    fail("T5 skipped — no grantId to revoke");
  }

  // ── T6: Admin always sees the task ────────────────────────────────────────
  console.log("\nT6: Admin always finds any task regardless of hub-access");
  {
    const res = await apiFetch(`/api/tasks/search?q=${encodeURIComponent(uniqueTitle)}`, { cookie: adminCookie });
    const results = await res.json().catch(() => []);
    const found = Array.isArray(results) && results.some(t => t.id === taskId);
    found ? ok("admin can always find the task") : fail("admin should always find the task");
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────
  if (taskId) {
    await apiFetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body:   { archived: true },
    }).catch(() => {});
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("══════════════════════════════════════════════════════════════\n");
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error("[fatal]", err.message); process.exit(1); });
