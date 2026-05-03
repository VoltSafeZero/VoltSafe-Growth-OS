#!/usr/bin/env node
/**
 * P0 Anonymous Route Lockdown — Regression Suite
 *
 * Verifies the 26 routes locked down in the P0-anon commit (per
 * docs/ROUTE_SECURITY_SWEEP.md). All previously accepted unauthenticated
 * traffic and returned real CRM/support/partnerships data; now they require
 * a session AND the appropriate module permission.
 *
 * Routes covered (26):
 *   CRM exports + lists + reads (crm.view):
 *     GET /api/marinas/export
 *     GET /api/leads/export
 *     GET /api/accounts/export
 *     GET /api/contacts/export
 *     GET /api/opportunities/export
 *     GET /api/marinas
 *     GET /api/contacts
 *     GET /api/opportunities
 *     GET /api/opportunities/:id/stage-history
 *
 *   Support reads (support.view):
 *     GET /api/tickets/export
 *     GET /api/tickets
 *     GET /api/tickets/:id
 *
 *   Partnerships reads (partnerships.view):
 *     GET /api/partnerships
 *     GET /api/partnerships/:id
 *     GET /api/ecosystem/organizations
 *     GET /api/ecosystem/organizations/:id
 *     GET /api/ecosystem/people
 *     GET /api/ecosystem/people/:id
 *     GET /api/ecosystem/relationships
 *     GET /api/ecosystem/relationships/:id
 *     GET /api/ecosystem/events
 *     GET /api/ecosystem/events/:id
 *     GET /api/ecosystem/regions
 *     GET /api/ecosystem/regions/:id
 *
 *   CRM mutations (crm.edit):
 *     POST /api/leads/:id/geocode-address
 *     POST /api/comments
 *
 * For each route asserts:
 *   1. unauthenticated  → 401
 *   2. viewer with module = none → 403
 *   3. viewer with module = view  → not 403 (write routes still 403 here for crm)
 *   4. viewer with module = edit  → not 403 (write routes succeed here)
 *   5. master_admin → 200 / not 403
 *
 * Run: node tests/p0-anonymous-routes.test.js
 */

import bcrypt from "bcryptjs";
import pg from "pg";

const BASE = "http://localhost:5000";
const VIEWER_EMAIL = "viewer@voltsafe.com";
const VIEWER_PWD = "vstest_p0_!1";
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
    [JSON.stringify(perms), VIEWER_EMAIL]
  );
}

async function setupViewer(client) {
  const snap = await client.query(
    `SELECT password, permissions FROM users WHERE email = $1 LIMIT 1`,
    [VIEWER_EMAIL]
  );
  if (snap.rowCount === 0) throw new Error(`Viewer ${VIEWER_EMAIL} not found`);
  const original = { password: snap.rows[0].password, permissions: snap.rows[0].permissions };
  const hash = await bcrypt.hash(VIEWER_PWD, 10);
  await client.query(
    `UPDATE users SET password = $1, status = 'active', must_change_password = false WHERE email = $2`,
    [hash, VIEWER_EMAIL]
  );
  return original;
}

async function teardown(client, original) {
  if (!original) return;
  await client.query(
    `UPDATE users SET password = $1, permissions = $2 WHERE email = $3`,
    [original.password, original.permissions, VIEWER_EMAIL]
  );
}

async function pickIds(client) {
  const one = async (s, ...args) => (await client.query(s, args)).rows[0];
  return {
    leadId:        (await one(`SELECT id FROM leads ORDER BY id LIMIT 1`))?.id ?? null,
    oppId:         (await one(`SELECT id FROM opportunities ORDER BY id LIMIT 1`))?.id ?? null,
    ticketId:      (await one(`SELECT id FROM tickets ORDER BY id LIMIT 1`))?.id ?? null,
    partnerId:     (await one(`SELECT id FROM partnerships ORDER BY id LIMIT 1`))?.id ?? null,
    ecoOrgId:      (await one(`SELECT id FROM ecosystem_organizations ORDER BY id LIMIT 1`))?.id ?? null,
    ecoPersonId:   (await one(`SELECT id FROM ecosystem_people ORDER BY id LIMIT 1`))?.id ?? null,
    ecoRelId:      (await one(`SELECT id FROM ecosystem_relationships ORDER BY id LIMIT 1`))?.id ?? null,
    ecoEventId:    (await one(`SELECT id FROM ecosystem_events ORDER BY id LIMIT 1`))?.id ?? null,
    ecoRegionId:   (await one(`SELECT id FROM ecosystem_regions ORDER BY id LIMIT 1`))?.id ?? null,
  };
}

const READ_ROUTES = (ids) => [
  // CRM (crm.view)
  { method: "GET", url: "/api/marinas/export",                 module: "crm" },
  { method: "GET", url: "/api/leads/export",                   module: "crm" },
  { method: "GET", url: "/api/accounts/export",                module: "crm" },
  { method: "GET", url: "/api/contacts/export",                module: "crm" },
  { method: "GET", url: "/api/opportunities/export",           module: "crm" },
  { method: "GET", url: "/api/marinas",                        module: "crm" },
  { method: "GET", url: "/api/contacts",                       module: "crm" },
  { method: "GET", url: "/api/opportunities",                  module: "crm" },
  ids.oppId != null
    ? { method: "GET", url: `/api/opportunities/${ids.oppId}/stage-history`, module: "crm" }
    : null,
  // Support (support.view)
  { method: "GET", url: "/api/tickets/export",                 module: "support" },
  { method: "GET", url: "/api/tickets",                        module: "support" },
  ids.ticketId != null
    ? { method: "GET", url: `/api/tickets/${ids.ticketId}`,    module: "support" }
    : null,
  // Partnerships (partnerships.view)
  { method: "GET", url: "/api/partnerships",                   module: "partnerships" },
  ids.partnerId != null
    ? { method: "GET", url: `/api/partnerships/${ids.partnerId}`, module: "partnerships" }
    : null,
  { method: "GET", url: "/api/ecosystem/organizations",        module: "partnerships" },
  ids.ecoOrgId != null
    ? { method: "GET", url: `/api/ecosystem/organizations/${ids.ecoOrgId}`, module: "partnerships" }
    : null,
  { method: "GET", url: "/api/ecosystem/people",               module: "partnerships" },
  ids.ecoPersonId != null
    ? { method: "GET", url: `/api/ecosystem/people/${ids.ecoPersonId}`,    module: "partnerships" }
    : null,
  { method: "GET", url: "/api/ecosystem/relationships",        module: "partnerships" },
  ids.ecoRelId != null
    ? { method: "GET", url: `/api/ecosystem/relationships/${ids.ecoRelId}`, module: "partnerships" }
    : null,
  { method: "GET", url: "/api/ecosystem/events",               module: "partnerships" },
  ids.ecoEventId != null
    ? { method: "GET", url: `/api/ecosystem/events/${ids.ecoEventId}`,     module: "partnerships" }
    : null,
  { method: "GET", url: "/api/ecosystem/regions",              module: "partnerships" },
  ids.ecoRegionId != null
    ? { method: "GET", url: `/api/ecosystem/regions/${ids.ecoRegionId}`,   module: "partnerships" }
    : null,
].filter(Boolean);

const MUTATION_ROUTES = (ids) => [
  ids.leadId != null
    ? {
        method: "POST",
        url: `/api/leads/${ids.leadId}/geocode-address`,
        module: "crm",
        body: {},
      }
    : null,
  {
    method: "POST",
    url: "/api/comments",
    module: "crm",
    body: { objectType: "lead", objectId: ids.leadId ?? 1, content: "p0-regression-test" },
  },
].filter(Boolean);

async function run() {
  console.log("=== VoltSafe P0 Anonymous Route Lockdown — Regression Suite ===\n");

  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let original = null;
  try {
    original = await setupViewer(client);
    const ids = await pickIds(client);
    console.log(`IDs: ${JSON.stringify(ids)}\n`);

    const reads = READ_ROUTES(ids);
    const writes = MUTATION_ROUTES(ids);
    const all = [...reads, ...writes];

    const adminCookie = await login(ADMIN_EMAIL, ADMIN_PWD);
    const a = authed(adminCookie);

    // ── Phase 1: anonymous → 401 on every route ─────────────────────────────
    console.log(`── Phase 1: unauthenticated → 401 (${all.length} routes) ──`);
    for (const r of all) {
      const opts = r.method === "POST"
        ? { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify(r.body) }
        : { headers: { Origin: BASE } };
      await expectStatus(`anon ${r.method} ${r.url}`, fetch(`${BASE}${r.url}`, opts), 401);
    }

    // ── Phase 2: viewer with all perms = none → 403 on every route ──────────
    console.log("\n── Phase 2: viewer crm/support/partnerships = none → 403 ──");
    await setPerms(client, { crm: "none", support: "none", partnerships: "none" });
    let viewerCookie = await login(VIEWER_EMAIL, VIEWER_PWD);
    let v = authed(viewerCookie);

    for (const r of all) {
      const opts = r.method === "POST"
        ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(r.body) }
        : {};
      await expectStatus(`viewer(none) ${r.method} ${r.url}`, v(r.url, opts), 403);
    }

    // ── Phase 3: viewer with view perms — reads pass, writes still 403 ──────
    console.log("\n── Phase 3: viewer crm/support/partnerships = view ──");
    await setPerms(client, { crm: "view", support: "view", partnerships: "view" });
    viewerCookie = await login(VIEWER_EMAIL, VIEWER_PWD);
    v = authed(viewerCookie);

    for (const r of reads) {
      await expectNot403(`viewer(view) ${r.method} ${r.url}`, v(r.url));
    }
    for (const r of writes) {
      await expectStatus(
        `viewer(view, no edit) ${r.method} ${r.url}`,
        v(r.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(r.body),
        }),
        403,
      );
    }

    // ── Phase 4: viewer with edit perms — writes pass ACL ───────────────────
    console.log("\n── Phase 4: viewer crm = edit → write routes pass ──");
    await setPerms(client, { crm: "edit", support: "view", partnerships: "view" });
    viewerCookie = await login(VIEWER_EMAIL, VIEWER_PWD);
    v = authed(viewerCookie);

    for (const r of writes) {
      // ACL gate must pass; downstream may 200/400/500 (geocode hits Nominatim,
      // comments may have schema constraints) — only 403 is failure.
      await expectNot403(
        `viewer(edit) ${r.method} ${r.url}`,
        v(r.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(r.body),
        }),
      );
    }

    // ── Phase 5: master_admin → not 403 on every route ──────────────────────
    console.log("\n── Phase 5: master_admin → not 403 ──");
    for (const r of reads) {
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
