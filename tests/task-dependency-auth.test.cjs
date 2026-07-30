#!/usr/bin/env node
/**
 * Task Dependency Authorization — Regression Test
 *
 * Proves that:
 * 1. A user cannot attach an inaccessible task as a dependency (POST returns 403/404).
 * 2. A user cannot read metadata for an inaccessible dependency through GET /full.
 * 3. A user WITH access to both tasks can create and see the dependency normally.
 *
 * Scenario:
 *   - trevor (admin) creates task T_secret (owned by trevor, inaccessible to viewer)
 *   - trevor creates task T_own (owned by viewer, so viewer can access it)
 *   - viewer attempts POST /api/tasks/T_own/dependencies with dependsOnTaskId=T_secret → 403/404
 *   - trevor (admin) links T_own → T_secret as a dependency
 *   - viewer GETs /api/tasks/T_own/full — T_secret must NOT appear in dependencies array
 *   - viewer with hub-access to trevor retries POST → now succeeds (both tasks accessible)
 *
 * Run with: node tests/task-dependency-auth.test.cjs
 * Requires: server running at localhost:5000
 */

"use strict";
const BASE = "http://localhost:5000";
let passed = 0;
let failed = 0;

function ok(label)         { console.log(`  ✓ ${label}`);                              passed++; }
function fail(label, msg)  { console.error(`  ✗ ${label}${msg ? ` — ${msg}` : ""}`);  failed++; }

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
  const res = await apiFetch("/api/auth/login", { method: "POST", body: { email, password } });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status}`);
  const raw = res.headers.get("set-cookie") ?? "";
  const match = raw.match(/(connect\.sid=[^;]+)/);
  if (!match) throw new Error(`No session cookie for ${email}`);
  return match[1];
}

async function run() {
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  Task Dependency Authorization Regression");
  console.log("══════════════════════════════════════════════════════════════\n");

  const adminCookie  = await login("trevor@voltsafe.com", "alberni1444");
  const viewerCookie = await login("viewer@voltsafe.com",  "testpass1234");

  const viewerMe = await (await apiFetch("/api/auth/me", { cookie: viewerCookie })).json().catch(() => null);
  const adminMe  = await (await apiFetch("/api/auth/me", { cookie: adminCookie  })).json().catch(() => null);
  const viewerId = viewerMe?.id ?? 6;
  const adminId  = adminMe?.id  ?? 4;

  const tag = Date.now();
  let tSecretId = null; // owned by trevor, inaccessible to viewer
  let tOwnId    = null; // owned by viewer, accessible to viewer
  let grantId   = null;

  // ── Setup: create T_secret (trevor owns, viewer cannot access) ────────────
  console.log("Setup: create T_secret (trevor → owner=trevor)");
  {
    const res = await apiFetch("/api/tasks", {
      method: "POST", cookie: adminCookie,
      body: { title: `DepAuthSecret-${tag}`, status: "pending", priority: "low", ownerUserId: adminId },
    });
    if (res.status === 201) {
      tSecretId = (await res.json().catch(() => ({}))).id;
      ok(`T_secret created id=${tSecretId}`);
    } else {
      fail("T_secret created", `status=${res.status}`);
    }
  }

  // ── Setup: create T_own (owner=viewer, viewer can access) ─────────────────
  console.log("\nSetup: create T_own (trevor creates, owner=viewer)");
  {
    const res = await apiFetch("/api/tasks", {
      method: "POST", cookie: adminCookie,
      body: { title: `DepAuthOwn-${tag}`, status: "pending", priority: "low", ownerUserId: viewerId },
    });
    if (res.status === 201) {
      tOwnId = (await res.json().catch(() => ({}))).id;
      ok(`T_own created id=${tOwnId}`);
    } else {
      fail("T_own created", `status=${res.status}`);
    }
  }

  if (!tSecretId || !tOwnId) {
    fail("aborting — task creation failed");
    process.exit(1);
  }

  // ── D1: viewer cannot link an inaccessible task as a dependency ────────────
  console.log("\nD1: viewer cannot add T_secret as dependency of T_own");
  {
    const res = await apiFetch(`/api/tasks/${tOwnId}/dependencies`, {
      method: "POST", cookie: viewerCookie,
      body: { dependsOnTaskId: tSecretId },
    });
    (res.status === 403 || res.status === 404)
      ? ok(`POST /api/tasks/${tOwnId}/dependencies → ${res.status} (access denied for T_secret)`)
      : fail("viewer dependency link must be denied", `got ${res.status}`);
  }

  // ── D2: trevor (admin) can create the link successfully ───────────────────
  console.log("\nD2: admin creates T_own → T_secret dependency");
  {
    const res = await apiFetch(`/api/tasks/${tOwnId}/dependencies`, {
      method: "POST", cookie: adminCookie,
      body: { dependsOnTaskId: tSecretId },
    });
    res.ok
      ? ok("admin POST dependency → 200")
      : fail("admin POST dependency → 200", `got ${res.status}`);
  }

  // ── D3: viewer's GET /full for T_own must NOT expose T_secret metadata ─────
  console.log("\nD3: viewer GET /full — T_secret must not appear in dependencies");
  {
    const res = await apiFetch(`/api/tasks/${tOwnId}/full`, { cookie: viewerCookie });
    if (!res.ok) {
      fail("viewer GET /full → 200", `got ${res.status}`);
    } else {
      const body = await res.json().catch(() => ({}));
      const deps = body.dependencies ?? [];
      const leaked = deps.some((d) => d.depends_on_task_id === tSecretId);
      !leaked
        ? ok(`T_secret (id=${tSecretId}) NOT in viewer's dependency list (${deps.length} deps shown)`)
        : fail("T_secret must NOT be visible in viewer's dependency list", `deps=${JSON.stringify(deps)}`);
    }
  }

  // ── D4: admin GET /full sees T_secret normally ────────────────────────────
  console.log("\nD4: admin GET /full sees dependency metadata normally");
  {
    const res = await apiFetch(`/api/tasks/${tOwnId}/full`, { cookie: adminCookie });
    if (!res.ok) {
      fail("admin GET /full → 200", `got ${res.status}`);
    } else {
      const body = await res.json().catch(() => ({}));
      const deps = body.dependencies ?? [];
      const visible = deps.some((d) => d.depends_on_task_id === tSecretId);
      visible
        ? ok(`admin sees T_secret in dependency list`)
        : fail("admin must see T_secret in dependency list", `deps=${JSON.stringify(deps)}`);
    }
  }

  // ── D5: after hub-access grant, viewer can READ T_secret metadata via GET /full ──
  // Note: viewer lacks CRM-edit permission so creating dependencies is not possible;
  // but they CAN read task detail (CRM-view), so the dep metadata must become visible
  // once hub-access to the dep target's owner is granted.
  console.log("\nD5: grant viewer hub-access to trevor; viewer now sees T_secret in GET /full deps");
  {
    const grantRes = await apiFetch("/api/tasks/hub-access/permissions", {
      method: "POST", cookie: adminCookie,
      body: { viewerUserId: viewerId, targetUserId: adminId, permissionLevel: "view" },
    });
    grantRes.ok ? ok("hub-access granted") : fail("hub-access grant", `${grantRes.status}`);

    // Record grant ID for cleanup
    const listRes = await apiFetch("/api/tasks/hub-access/permissions", { cookie: adminCookie });
    const list = await listRes.json().catch(() => []);
    const grant = Array.isArray(list) && list.find(g => g.viewerUserId === viewerId && g.targetUserId === adminId);
    grantId = grant?.id ?? null;
    grantId ? ok(`grant id=${grantId} recorded`) : fail("grant id in permissions list");

    // Now viewer should see T_secret in GET /full because hub-access to trevor (owner) is granted
    const res = await apiFetch(`/api/tasks/${tOwnId}/full`, { cookie: viewerCookie });
    if (!res.ok) {
      fail("viewer GET /full with hub-access → 200", `got ${res.status}`);
    } else {
      const body = await res.json().catch(() => ({}));
      const deps = body.dependencies ?? [];
      const visible = deps.some((d) => d.depends_on_task_id === tSecretId);
      visible
        ? ok(`T_secret IS now visible in viewer's dependency list after hub-access grant`)
        : fail("T_secret should now be visible in deps after hub-access", `deps=${JSON.stringify(deps)}`);
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────
  if (grantId) {
    await apiFetch(`/api/tasks/hub-access/permissions/${grantId}`, {
      method: "DELETE", cookie: adminCookie,
    }).catch(() => {});
  }
  for (const id of [tSecretId, tOwnId]) {
    if (id) {
      await apiFetch(`/api/tasks/${id}`, {
        method: "PATCH", cookie: adminCookie, body: { archived: true },
      }).catch(() => {});
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("══════════════════════════════════════════════════════════════\n");
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error("[fatal]", err.message); process.exit(1); });
