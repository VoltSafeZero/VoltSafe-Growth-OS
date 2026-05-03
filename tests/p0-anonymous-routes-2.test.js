#!/usr/bin/env node
/**
 * P0 Anonymous Route Lockdown — Commit #2 Regression Suite
 *
 * Verifies the deferred P0-anon routes patched in commit #2 (per
 * docs/ROUTE_SECURITY_SWEEP.md). Routes covered:
 *
 *   CRM utility reads (crm.view):
 *     GET /api/metrics
 *     GET /api/sales
 *     GET /api/chart-data
 *     GET /api/dashboard/summary
 *     GET /api/marinas/states
 *     GET /api/leads/states
 *     GET /api/leads/nearby
 *     GET /api/accounts/:id/infrastructure
 *     GET /api/comm-lists
 *     GET /api/comm-lists/export
 *     GET /api/campaigns
 *     GET /api/campaigns/:id
 *     GET /api/campaigns/export
 *     GET /api/comments
 *
 *   Geocode (requireAuth only):
 *     GET /api/geocode/search?q=...
 *
 *   Team workload (team_workload.view):
 *     GET /api/team-workload
 *
 *   CRM mutations (crm.edit):
 *     POST /api/tasks/:id/snooze
 *     POST /api/tasks/:id/reassign
 *     POST /api/tasks/:id/complete   (handled by routes-tasks.ts canEdit; duplicate removed)
 *
 * Phases:
 *   1. anonymous → 401
 *   2. viewer (crm/team_workload = none) → 403  (geocode/search → not 403, just requireAuth)
 *   3. viewer (crm/team_workload = view) → reads pass; CRM-edit writes still 403
 *   4. viewer (crm = edit) → write routes pass ACL
 *   5. master_admin → not 403
 */

import bcrypt from "bcryptjs";
import pg from "pg";

const BASE = "http://localhost:5000";
const VIEWER_EMAIL = "viewer@voltsafe.com";
const VIEWER_PWD = "vstest_p0c2_!1";
const ADMIN_EMAIL = "trevor@voltsafe.com";
const ADMIN_PWD = "alberni1444";

let passed = 0;
let failed = 0;
const ok = (l) => { console.log(`  \u2713 ${l}`); passed++; };
const bad = (l, d) => { console.error(`  \u2717 ${l}${d ? ` \u2014 ${d}` : ""}`); failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login ${email}: ${res.status}`);
  const cookie = res.headers.get("set-cookie")?.match(/(connect\.sid=[^;]+)/)?.[1];
  if (!cookie) throw new Error(`No session cookie for ${email}`);
  await sleep(350);
  return cookie;
}

const authed = (cookie) => async (url, opts = {}) => fetch(`${BASE}${url}`, {
  ...opts,
  headers: { Cookie: cookie, Origin: BASE, ...(opts.headers || {}) },
});

async function expectStatus(label, p, ...statuses) {
  const res = await p;
  if (statuses.includes(res.status)) {
    ok(`${label} \u2192 ${res.status}`);
  } else {
    const body = await res.text().catch(() => "");
    bad(`${label} \u2192 expected ${statuses.join("|")}, got ${res.status}`, body.slice(0, 140));
  }
}

async function expectNot403(label, p) {
  const res = await p;
  if (res.status === 403) {
    const body = await res.text().catch(() => "");
    bad(label, `expected NOT 403, got 403: ${body.slice(0, 140)}`);
  } else {
    ok(`${label} \u2192 ${res.status} (ACL passed)`);
  }
}

async function setPerms(client, perms) {
  await client.query(
    `UPDATE users SET permissions = $1::jsonb WHERE email = $2`,
    [JSON.stringify(perms), VIEWER_EMAIL],
  );
}

async function setupViewer(client) {
  const snap = await client.query(
    `SELECT password, permissions FROM users WHERE email = $1 LIMIT 1`,
    [VIEWER_EMAIL],
  );
  if (snap.rowCount === 0) throw new Error(`Viewer ${VIEWER_EMAIL} not found`);
  const original = { password: snap.rows[0].password, permissions: snap.rows[0].permissions };
  const hash = await bcrypt.hash(VIEWER_PWD, 10);
  await client.query(
    `UPDATE users SET password = $1, status = 'active', must_change_password = false WHERE email = $2`,
    [hash, VIEWER_EMAIL],
  );
  return original;
}

async function teardown(client, original) {
  if (!original) return;
  await client.query(
    `UPDATE users SET password = $1, permissions = $2 WHERE email = $3`,
    [original.password, original.permissions, VIEWER_EMAIL],
  );
}

async function pickIds(client) {
  const one = async (s) => (await client.query(s)).rows[0];
  return {
    accountId:  (await one(`SELECT id FROM accounts ORDER BY id LIMIT 1`))?.id ?? null,
    campaignId: (await one(`SELECT id FROM campaign_drafts ORDER BY id LIMIT 1`))?.id ?? null,
    taskId:     (await one(`SELECT id FROM tasks ORDER BY id LIMIT 1`))?.id ?? null,
  };
}

const CRM_READ_ROUTES = (ids) => [
  { method: "GET", url: "/api/metrics" },
  { method: "GET", url: "/api/sales" },
  { method: "GET", url: "/api/chart-data" },
  { method: "GET", url: "/api/dashboard/summary" },
  { method: "GET", url: "/api/marinas/states" },
  { method: "GET", url: "/api/leads/states" },
  { method: "GET", url: "/api/leads/nearby?lat=49.2&lng=-123.1&radius=200&limit=10" },
  ids.accountId != null
    ? { method: "GET", url: `/api/accounts/${ids.accountId}/infrastructure` }
    : null,
  { method: "GET", url: "/api/comm-lists" },
  { method: "GET", url: "/api/comm-lists/export" },
  { method: "GET", url: "/api/campaigns" },
  ids.campaignId != null
    ? { method: "GET", url: `/api/campaigns/${ids.campaignId}` }
    : null,
  { method: "GET", url: "/api/campaigns/export" },
  { method: "GET", url: "/api/comments?objectType=lead&objectId=1" },
].filter(Boolean);

const TEAM_WORKLOAD_ROUTES = [
  { method: "GET", url: "/api/team-workload" },
];

const GEOCODE_ROUTE = { method: "GET", url: "/api/geocode/search?q=Vancouver&limit=1" };

const TASK_WRITE_ROUTES = (ids) => [
  ids.taskId != null
    ? { method: "POST", url: `/api/tasks/${ids.taskId}/snooze`,   body: { preset: "later_today" } }
    : null,
  ids.taskId != null
    ? { method: "POST", url: `/api/tasks/${ids.taskId}/reassign`, body: { ownerUserId: 1 } }
    : null,
  ids.taskId != null
    ? { method: "POST", url: `/api/tasks/${ids.taskId}/complete`, body: {} }
    : null,
].filter(Boolean);

async function run() {
  console.log("=== VoltSafe P0 Anonymous Route Lockdown — Commit #2 Regression ===\n");

  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let original = null;
  try {
    original = await setupViewer(client);
    const ids = await pickIds(client);
    console.log(`IDs: ${JSON.stringify(ids)}\n`);

    const crmReads = CRM_READ_ROUTES(ids);
    const writes = TASK_WRITE_ROUTES(ids);
    const allReads = [...crmReads, ...TEAM_WORKLOAD_ROUTES, GEOCODE_ROUTE];
    const all = [...allReads, ...writes];

    const adminCookie = await login(ADMIN_EMAIL, ADMIN_PWD);
    const a = authed(adminCookie);

    // ── Phase 1: anonymous → 401 ────────────────────────────────────────────
    console.log(`── Phase 1: unauthenticated → 401 (${all.length} routes) ──`);
    for (const r of all) {
      const opts = r.method === "POST"
        ? { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify(r.body) }
        : { headers: { Origin: BASE } };
      await expectStatus(`anon ${r.method} ${r.url}`, fetch(`${BASE}${r.url}`, opts), 401);
    }

    // ── Phase 2: viewer with all P0-relevant perms = none ───────────────────
    console.log("\n── Phase 2: viewer crm/team_workload = none → 403 ──");
    await setPerms(client, { crm: "none", support: "none", partnerships: "none", team_workload: "none", communications: "none" });
    let viewerCookie = await login(VIEWER_EMAIL, VIEWER_PWD);
    let v = authed(viewerCookie);

    for (const r of crmReads) {
      await expectStatus(`viewer(none) ${r.method} ${r.url}`, v(r.url), 403);
    }
    for (const r of TEAM_WORKLOAD_ROUTES) {
      await expectStatus(`viewer(none) ${r.method} ${r.url}`, v(r.url), 403);
    }
    // geocode/search has only requireAuth — should pass auth and be 200/400/etc, not 403
    await expectNot403(`viewer(none) GET ${GEOCODE_ROUTE.url} (auth-only)`, v(GEOCODE_ROUTE.url));
    for (const r of writes) {
      await expectStatus(
        `viewer(none) ${r.method} ${r.url}`,
        v(r.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(r.body) }),
        403,
      );
    }

    // ── Phase 3: viewer with view perms → reads pass; writes still 403 ─────
    console.log("\n── Phase 3: viewer crm/team_workload = view ──");
    await setPerms(client, { crm: "view", support: "view", partnerships: "view", team_workload: "view", communications: "view" });
    viewerCookie = await login(VIEWER_EMAIL, VIEWER_PWD);
    v = authed(viewerCookie);

    for (const r of allReads) {
      await expectNot403(`viewer(view) ${r.method} ${r.url}`, v(r.url));
    }
    for (const r of writes) {
      await expectStatus(
        `viewer(view, no edit) ${r.method} ${r.url}`,
        v(r.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(r.body) }),
        403,
      );
    }

    // ── Phase 4: viewer with crm = edit → write routes pass ACL ────────────
    console.log("\n── Phase 4: viewer crm = edit → write routes pass ──");
    await setPerms(client, { crm: "edit", support: "view", partnerships: "view", team_workload: "view", communications: "view" });
    viewerCookie = await login(VIEWER_EMAIL, VIEWER_PWD);
    v = authed(viewerCookie);

    for (const r of writes) {
      await expectNot403(
        `viewer(edit) ${r.method} ${r.url}`,
        v(r.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(r.body) }),
      );
    }

    // ── Phase 5: master_admin → not 403 on every read ──────────────────────
    console.log("\n── Phase 5: master_admin → not 403 ──");
    for (const r of allReads) {
      await expectNot403(`admin ${r.method} ${r.url}`, a(r.url));
    }

  } catch (err) {
    bad(`runner crashed`, err?.message || String(err));
  } finally {
    await teardown(client, original);
    await client.end();
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
