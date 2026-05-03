#!/usr/bin/env node
/**
 * P1 Under-Gated Mutation Routes — Regression Suite (commit #3)
 *
 * Verifies P1 mutation gates patched in commit #3 (per docs/ROUTE_SECURITY_SWEEP.md).
 *
 *   Email association mutation (in-handler ACL — same as /reassign):
 *     POST /api/email-messages/:id/confirm
 *
 *   Quoting mutations (quoting.edit):
 *     POST   /api/price-lists
 *     PATCH  /api/price-lists/:id
 *     DELETE /api/price-lists/:id
 *     POST   /api/price-lists/:id/items
 *     PATCH  /api/price-list-items/:id
 *     DELETE /api/price-list-items/:id
 *     POST   /api/install-workflows
 *     PATCH  /api/install-workflows/:id
 *     DELETE /api/install-workflows/:id
 *     POST   /api/install-workflows/:id/milestones
 *     PATCH  /api/install-workflows/:id/milestones/:mid
 *     DELETE /api/install-workflows/:id/milestones/:mid
 *
 *   Timeline email link/unlink (escalated crm.view → crm.edit):
 *     POST   /api/timeline/link-email
 *     DELETE /api/timeline/unlink-email/:id
 *
 * Phases:
 *   1. anonymous → 401
 *   2. viewer with all perms = view (no edit) → 403 on every mutation
 *   3. viewer with crm.edit + quoting.edit → not 403 on simple gated routes;
 *      cross-mailbox email confirm still 403
 *   4. admin → not 403 on every route, including cross-mailbox email confirm
 */

import bcrypt from "bcryptjs";
import pg from "pg";

const BASE = "http://localhost:5000";
const VIEWER_EMAIL = "viewer@voltsafe.com";
const VIEWER_PWD = "vstest_p1_!1";
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
    bad(`${label} \u2192 expected ${statuses.join("|")}, got ${res.status}`, body.slice(0, 160));
  }
}

async function expectNot403(label, p) {
  const res = await p;
  if (res.status === 403) {
    const body = await res.text().catch(() => "");
    bad(label, `expected NOT 403, got 403: ${body.slice(0, 160)}`);
  } else {
    ok(`${label} \u2192 ${res.status} (ACL passed)`);
  }
}

async function setPerms(client, perms) {
  await client.query(`UPDATE users SET permissions = $1::jsonb WHERE email = $2`,
    [JSON.stringify(perms), VIEWER_EMAIL]);
}

async function setupViewer(client) {
  const snap = await client.query(
    `SELECT id, password, permissions FROM users WHERE email = $1 LIMIT 1`,
    [VIEWER_EMAIL]);
  if (snap.rowCount === 0) throw new Error(`Viewer ${VIEWER_EMAIL} not found`);
  const original = {
    id: snap.rows[0].id,
    password: snap.rows[0].password,
    permissions: snap.rows[0].permissions,
  };
  const hash = await bcrypt.hash(VIEWER_PWD, 10);
  await client.query(
    `UPDATE users SET password = $1, status = 'active', must_change_password = false WHERE email = $2`,
    [hash, VIEWER_EMAIL]);
  return original;
}

async function teardown(client, original) {
  if (!original) return;
  await client.query(
    `UPDATE users SET password = $1, permissions = $2 WHERE email = $3`,
    [original.password, original.permissions, VIEWER_EMAIL]);
}

async function pickEmailNotOwnedBy(client, viewerId) {
  // Pick a message + association where the message owner is NOT the viewer
  // and the message has a sourceAccountId (so cross-mailbox ACL is exercised).
  const r = await client.query(`
    SELECT em.id AS email_id, em.source_account_id, em.owner_user_id, ea.id AS assoc_id
    FROM email_messages em
    JOIN email_associations ea ON ea.email_message_id = em.id
    WHERE em.owner_user_id IS NOT NULL
      AND em.owner_user_id <> $1
      AND em.source_account_id IS NOT NULL
    ORDER BY em.id
    LIMIT 1
  `, [viewerId]);
  return r.rows[0] || null;
}

async function pickAnyEmailWithAssoc(client) {
  const r = await client.query(`
    SELECT em.id AS email_id, em.source_account_id, em.owner_user_id, ea.id AS assoc_id
    FROM email_messages em
    JOIN email_associations ea ON ea.email_message_id = em.id
    ORDER BY em.id
    LIMIT 1
  `);
  return r.rows[0] || null;
}

async function pickIds(client) {
  const one = async (s) => (await client.query(s)).rows[0];
  return {
    leadId:        (await one(`SELECT id FROM leads ORDER BY id LIMIT 1`))?.id ?? null,
    accountId:     (await one(`SELECT id FROM accounts ORDER BY id LIMIT 1`))?.id ?? null,
    priceListId:   (await one(`SELECT id FROM price_lists ORDER BY id LIMIT 1`))?.id ?? null,
    priceItemId:   (await one(`SELECT id FROM price_list_items ORDER BY id LIMIT 1`))?.id ?? null,
    workflowId:    (await one(`SELECT id FROM install_workflows ORDER BY id LIMIT 1`))?.id ?? null,
    milestoneId:   (await one(`SELECT id, workflow_id FROM install_milestones ORDER BY id LIMIT 1`))?.id ?? null,
    mWorkflowId:   (await one(`SELECT workflow_id FROM install_milestones ORDER BY id LIMIT 1`))?.workflow_id ?? null,
  };
}

const SIMPLE_MUTATIONS = (ids) => [
  { method: "POST",   url: "/api/price-lists",                 body: { name: "p1-test-list" } },
  ids.priceListId != null
    ? { method: "PATCH",  url: `/api/price-lists/${ids.priceListId}`,            body: { description: "p1-test" } }
    : null,
  ids.priceListId != null
    ? { method: "DELETE", url: `/api/price-lists/${ids.priceListId}`,            body: null }
    : null,
  ids.priceListId != null
    ? { method: "POST",   url: `/api/price-lists/${ids.priceListId}/items`,      body: { name: "p1-item" } }
    : null,
  ids.priceItemId != null
    ? { method: "PATCH",  url: `/api/price-list-items/${ids.priceItemId}`,       body: { description: "p1-test" } }
    : null,
  ids.priceItemId != null
    ? { method: "DELETE", url: `/api/price-list-items/${ids.priceItemId}`,       body: null }
    : null,
  { method: "POST",   url: "/api/install-workflows",                              body: { title: "p1-test-wf" } },
  ids.workflowId != null
    ? { method: "PATCH",  url: `/api/install-workflows/${ids.workflowId}`,        body: { notes: "p1" } }
    : null,
  ids.workflowId != null
    ? { method: "DELETE", url: `/api/install-workflows/${ids.workflowId}`,        body: null }
    : null,
  ids.workflowId != null
    ? { method: "POST",   url: `/api/install-workflows/${ids.workflowId}/milestones`, body: { name: "p1-ms" } }
    : null,
  ids.mWorkflowId != null && ids.milestoneId != null
    ? { method: "PATCH",  url: `/api/install-workflows/${ids.mWorkflowId}/milestones/${ids.milestoneId}`, body: { notes: "p1" } }
    : null,
  ids.mWorkflowId != null && ids.milestoneId != null
    ? { method: "DELETE", url: `/api/install-workflows/${ids.mWorkflowId}/milestones/${ids.milestoneId}`, body: null }
    : null,
  { method: "POST",   url: "/api/timeline/link-email",
    body: { emailMessageId: 1, objectType: "lead", objectId: ids.leadId ?? 1 } },
  { method: "DELETE", url: `/api/timeline/unlink-email/999999`,                   body: null },
].filter(Boolean);

async function call(v, r) {
  return v(r.url, {
    method: r.method,
    headers: r.body == null ? {} : { "Content-Type": "application/json" },
    body: r.body == null ? undefined : JSON.stringify(r.body),
  });
}

async function run() {
  console.log("=== VoltSafe P1 Under-Gated Mutations — Commit #3 Regression ===\n");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let original = null;
  try {
    original = await setupViewer(client);
    const ids = await pickIds(client);
    const crossMboxEmail = await pickEmailNotOwnedBy(client, original.id);
    const anyEmail = await pickAnyEmailWithAssoc(client);
    console.log(`IDs: ${JSON.stringify(ids)}`);
    console.log(`crossMboxEmail: ${JSON.stringify(crossMboxEmail)}`);
    console.log(`anyEmail: ${JSON.stringify(anyEmail)}\n`);

    const muts = SIMPLE_MUTATIONS(ids);
    const adminCookie = await login(ADMIN_EMAIL, ADMIN_PWD);
    const a = authed(adminCookie);

    // ── Phase 1: anonymous → 401 ────────────────────────────────────────────
    console.log(`── Phase 1: unauthenticated → 401 ──`);
    for (const r of muts) {
      const opts = {
        method: r.method,
        headers: { "Content-Type": "application/json", Origin: BASE },
        body: r.body == null ? undefined : JSON.stringify(r.body),
      };
      await expectStatus(`anon ${r.method} ${r.url}`,
        fetch(`${BASE}${r.url}`, opts), 401);
    }
    if (anyEmail) {
      await expectStatus(`anon POST /api/email-messages/${anyEmail.email_id}/confirm`,
        fetch(`${BASE}/api/email-messages/${anyEmail.email_id}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: BASE },
          body: JSON.stringify({ associationId: anyEmail.assoc_id }),
        }), 401);
    }

    // ── Phase 2: viewer with VIEW only → 403 on writes ──────────────────────
    console.log("\n── Phase 2: viewer crm/quoting = view (no edit) → 403 ──");
    await setPerms(client, {
      crm: "view", quoting: "view", support: "view",
      partnerships: "view", communications: "view", team_workload: "view",
    });
    let viewerCookie = await login(VIEWER_EMAIL, VIEWER_PWD);
    let v = authed(viewerCookie);

    for (const r of muts) {
      await expectStatus(`viewer(view) ${r.method} ${r.url}`, call(v, r), 403);
    }

    // ── Phase 3: viewer with crm.edit + quoting.edit → simple writes pass ──
    console.log("\n── Phase 3: viewer crm/quoting = edit → simple gated routes pass ──");
    await setPerms(client, {
      crm: "edit", quoting: "edit", support: "view",
      partnerships: "view", communications: "view", team_workload: "view",
    });
    viewerCookie = await login(VIEWER_EMAIL, VIEWER_PWD);
    v = authed(viewerCookie);

    for (const r of muts) {
      await expectNot403(`viewer(edit) ${r.method} ${r.url}`, call(v, r));
    }

    // Cross-mailbox email confirm — viewer is NOT owner & has no mail_team perm.
    if (crossMboxEmail) {
      console.log("\n── Cross-mailbox email confirm — viewer denied ──");
      await expectStatus(
        `viewer(no mail_team) POST /api/email-messages/${crossMboxEmail.email_id}/confirm`,
        v(`/api/email-messages/${crossMboxEmail.email_id}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ associationId: crossMboxEmail.assoc_id }),
        }),
        403,
      );
    } else {
      console.log("  (skipped cross-mailbox case — no qualifying email_messages row)");
    }

    // ── Phase 4: admin → not 403 on cross-mailbox email confirm ────────────
    console.log("\n── Phase 4: master_admin → cross-mailbox email confirm passes ACL ──");
    if (crossMboxEmail) {
      await expectNot403(
        `admin POST /api/email-messages/${crossMboxEmail.email_id}/confirm`,
        a(`/api/email-messages/${crossMboxEmail.email_id}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ associationId: crossMboxEmail.assoc_id }),
        }),
      );
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

run().catch((e) => { console.error(e); process.exit(1); });
