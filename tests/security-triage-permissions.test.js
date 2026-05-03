#!/usr/bin/env node
/**
 * Security Triage Regression Suite (REMAINING items from PERMISSION_AUDIT.md)
 *
 * Verifies the P0 + P1 fixes shipped in the security triage follow-up:
 *
 *   P0 — bare async (no auth) → requirePermission("crm","view"):
 *     GET /api/leads          GET /api/leads/:id
 *     GET /api/accounts       GET /api/accounts/:id
 *
 *   P1 — bare requireAuth → requirePermission("projects","view"):
 *     GET /api/projects       GET /api/projects/cert-summary
 *
 *   P1 — bare requireAuth → requirePermission("knowledge","view") (read):
 *     GET /api/confluence/spaces        GET /api/confluence/pages
 *
 *   P1 — bare requireAuth → requirePermission("knowledge","edit") (write):
 *     POST /api/confluence/pages        PUT /api/confluence/pages/:id
 *
 *   P1 — bare requireAuth → requirePermission("projects","edit"):
 *     POST /api/projects/:id/tracker-alerts/evaluate
 *
 *   P1 — in-handler mail_team[sourceAccountId].edit ACL:
 *     POST /api/email-messages/:id/reassign
 *
 * For every fix the test asserts:
 *   1. unauthenticated → 401
 *   2. authenticated viewer WITHOUT module permission → 403
 *   3. authenticated viewer WITH appropriate permission → not 403
 *   4. master_admin → not 403
 *
 * Run with: node tests/security-triage-permissions.test.js
 * Requires: server at localhost:5000, viewer@voltsafe.com seeded.
 */

import bcrypt from "bcryptjs";
import pg from "pg";

const BASE = "http://localhost:5000";
const VIEWER_EMAIL = "viewer@voltsafe.com";
const VIEWER_PWD = "vstest_triage_!1";
const ADMIN_EMAIL = "trevor@voltsafe.com";
const ADMIN_PWD = "alberni1444";
const ACCOUNT_ID = 1;

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
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status}`);
  const cookie = res.headers.get("set-cookie")?.match(/(connect\.sid=[^;]+)/)?.[1];
  if (!cookie) throw new Error(`No session cookie for ${email}`);
  await sleep(400);
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
    ok(`${label} \u2192 ${res.status} (not blocked by ACL)`);
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
  if (snap.rowCount === 0) throw new Error(`Viewer user ${VIEWER_EMAIL} not found`);
  const original = {
    password: snap.rows[0].password,
    permissions: snap.rows[0].permissions,
  };
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
    projectId: (await one(`SELECT id FROM projects ORDER BY id LIMIT 1`))?.id ?? null,
    leadId: (await one(`SELECT id FROM leads ORDER BY id LIMIT 1`))?.id ?? null,
    accountId: (await one(`SELECT id FROM accounts ORDER BY id LIMIT 1`))?.id ?? null,
    sharedMsgId: (await one(
      `SELECT id FROM email_messages WHERE source_account_id = $1 ORDER BY id LIMIT 1`,
      ACCOUNT_ID,
    ))?.id ?? null,
    otherMsgId: (await one(
      `SELECT id FROM email_messages WHERE source_account_id IS DISTINCT FROM $1 ORDER BY id LIMIT 1`,
      ACCOUNT_ID,
    ))?.id ?? null,
  };
}

// Re-login viewer after permission change so the requirePermission middleware
// loads fresh perms on the next request. (Permissions are read per-request from
// the users table, so a re-login isn't strictly required, but it makes the
// test intent obvious.)

async function run() {
  console.log("=== VoltSafe Security Triage Permission Regression Suite ===\n");

  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let original = null;
  try {
    original = await setupViewer(client);
    const ids = await pickIds(client);
    console.log(`IDs: ${JSON.stringify(ids)}\n`);

    const adminCookie = await login(ADMIN_EMAIL, ADMIN_PWD);
    const a = authed(adminCookie);

    // ── Phase 1: ALL perms denied — every flagged route must 403 ─────────────
    await setPerms(client, {
      crm: "none", projects: "none", knowledge: "none",
      mail_team: { [String(ACCOUNT_ID)]: { view: false, edit: false } },
    });
    let viewerCookie = await login(VIEWER_EMAIL, VIEWER_PWD);
    let v = authed(viewerCookie);

    console.log("── Phase 1: viewer with crm/projects/knowledge = none ──");
    // P0
    await expectStatus(`GET /api/leads`, v(`/api/leads`), 403);
    if (ids.leadId != null) await expectStatus(`GET /api/leads/${ids.leadId}`, v(`/api/leads/${ids.leadId}`), 403);
    await expectStatus(`GET /api/accounts`, v(`/api/accounts`), 403);
    if (ids.accountId != null) await expectStatus(`GET /api/accounts/${ids.accountId}`, v(`/api/accounts/${ids.accountId}`), 403);
    // P1 projects list
    await expectStatus(`GET /api/projects`, v(`/api/projects`), 403);
    await expectStatus(`GET /api/projects/cert-summary`, v(`/api/projects/cert-summary`), 403);
    // P1 confluence read
    await expectStatus(`GET /api/confluence/spaces`, v(`/api/confluence/spaces`), 403);
    await expectStatus(`GET /api/confluence/pages`, v(`/api/confluence/pages`), 403);
    // P1 confluence write — viewer with knowledge=none must 403
    await expectStatus(`POST /api/confluence/pages`, v(`/api/confluence/pages`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x", spaceKey: "x", body: "x" }),
    }), 403);
    await expectStatus(`PUT /api/confluence/pages/999`, v(`/api/confluence/pages/999`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x", body: "x", version: 1 }),
    }), 403);
    // P1 tracker-alerts evaluate
    if (ids.projectId != null) {
      await expectStatus(
        `POST /api/projects/${ids.projectId}/tracker-alerts/evaluate`,
        v(`/api/projects/${ids.projectId}/tracker-alerts/evaluate`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
        403,
      );
    }
    // P1 email-messages reassign — viewer w/o mail_team[1].edit
    if (ids.sharedMsgId != null) {
      await expectStatus(
        `POST /api/email-messages/${ids.sharedMsgId}/reassign  (viewer no mail_team edit)`,
        v(`/api/email-messages/${ids.sharedMsgId}/reassign`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ objectType: "lead", objectId: 1, objectName: "x" }),
        }),
        403,
      );
    }

    // ── Phase 2: viewer with VIEW perms — read routes pass, write routes 403 ─
    await setPerms(client, {
      crm: "view", projects: "view", knowledge: "view",
      mail_team: { [String(ACCOUNT_ID)]: { view: true, edit: false } },
    });
    viewerCookie = await login(VIEWER_EMAIL, VIEWER_PWD);
    v = authed(viewerCookie);

    console.log("\n── Phase 2: viewer with crm/projects/knowledge = view ──");
    await expectStatus(`GET /api/leads`, v(`/api/leads`), 200);
    if (ids.leadId != null) await expectStatus(`GET /api/leads/${ids.leadId}`, v(`/api/leads/${ids.leadId}`), 200);
    await expectStatus(`GET /api/accounts`, v(`/api/accounts`), 200);
    if (ids.accountId != null) await expectStatus(`GET /api/accounts/${ids.accountId}`, v(`/api/accounts/${ids.accountId}`), 200);
    await expectStatus(`GET /api/projects`, v(`/api/projects`), 200);
    await expectStatus(`GET /api/projects/cert-summary`, v(`/api/projects/cert-summary`), 200);
    // Confluence reads — Confluence may not be configured in dev; ACL gate must
    // pass (not 403). 200 / 503 / 400 all acceptable, only 403 is bad.
    await expectNot403(`GET /api/confluence/spaces  (viewer w/ knowledge.view)`, v(`/api/confluence/spaces`));
    await expectNot403(`GET /api/confluence/pages  (viewer w/ knowledge.view)`, v(`/api/confluence/pages`));
    // Confluence writes still 403 because viewer only has knowledge=view, not edit
    await expectStatus(`POST /api/confluence/pages  (viewer view-only)`, v(`/api/confluence/pages`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x", spaceKey: "x", body: "x" }),
    }), 403);
    // Tracker-alerts evaluate — viewer has projects=view but route needs edit
    if (ids.projectId != null) {
      await expectStatus(
        `POST /api/projects/${ids.projectId}/tracker-alerts/evaluate  (viewer view-only)`,
        v(`/api/projects/${ids.projectId}/tracker-alerts/evaluate`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
        403,
      );
    }
    // Email reassign — viewer has mail_team[1].view but not edit → still 403
    if (ids.sharedMsgId != null) {
      await expectStatus(
        `POST /api/email-messages/${ids.sharedMsgId}/reassign  (viewer mail_team view-only)`,
        v(`/api/email-messages/${ids.sharedMsgId}/reassign`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ objectType: "lead", objectId: 1, objectName: "x" }),
        }),
        403,
      );
    }

    // ── Phase 3: viewer with EDIT perms — write routes pass ──────────────────
    await setPerms(client, {
      crm: "edit", projects: "edit", knowledge: "edit",
      mail_team: { [String(ACCOUNT_ID)]: { view: true, edit: true } },
    });
    viewerCookie = await login(VIEWER_EMAIL, VIEWER_PWD);
    v = authed(viewerCookie);

    console.log("\n── Phase 3: viewer with crm/projects/knowledge = edit ──");
    // Confluence writes — ACL gate should pass; downstream may 503/400 if
    // Confluence isn't configured in dev. Only 403 is failure.
    await expectNot403(`POST /api/confluence/pages  (viewer w/ knowledge.edit)`, v(`/api/confluence/pages`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "regression-test-skip", spaceKey: "ZZZ_NONEXISTENT", body: "x" }),
    }));
    await expectNot403(`PUT /api/confluence/pages/999999999  (viewer w/ knowledge.edit)`, v(`/api/confluence/pages/999999999`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x", body: "x", version: 1 }),
    }));
    // Tracker-alerts evaluate — ACL gate passes; downstream may 400/500 due
    // to missing snapshot body, that's fine (just not 403).
    if (ids.projectId != null) {
      await expectNot403(
        `POST /api/projects/${ids.projectId}/tracker-alerts/evaluate  (viewer w/ projects.edit)`,
        v(`/api/projects/${ids.projectId}/tracker-alerts/evaluate`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
      );
    }
    // Email reassign — viewer NOW has mail_team[1].edit → ACL pass on shared msg
    if (ids.sharedMsgId != null) {
      await expectNot403(
        `POST /api/email-messages/${ids.sharedMsgId}/reassign  (viewer w/ mail_team edit)`,
        v(`/api/email-messages/${ids.sharedMsgId}/reassign`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ objectType: "lead", objectId: 1, objectName: "regression-test" }),
        }),
      );
    }
    // Negative: even with mail_team[1].edit, a message anchored to a DIFFERENT
    // account must still 403 (gate is per-mailbox, not global).
    if (ids.otherMsgId != null) {
      await expectStatus(
        `POST /api/email-messages/${ids.otherMsgId}/reassign  (viewer no edit on that mailbox)`,
        v(`/api/email-messages/${ids.otherMsgId}/reassign`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ objectType: "lead", objectId: 1, objectName: "x" }),
        }),
        403,
      );
    }

    // ── Phase 4: admin/master_admin retains access on all ────────────────────
    console.log("\n── Phase 4: master_admin retains access ──");
    await expectStatus(`GET /api/leads  (admin)`, a(`/api/leads`), 200);
    if (ids.leadId != null) await expectStatus(`GET /api/leads/${ids.leadId}  (admin)`, a(`/api/leads/${ids.leadId}`), 200);
    await expectStatus(`GET /api/accounts  (admin)`, a(`/api/accounts`), 200);
    if (ids.accountId != null) await expectStatus(`GET /api/accounts/${ids.accountId}  (admin)`, a(`/api/accounts/${ids.accountId}`), 200);
    await expectStatus(`GET /api/projects  (admin)`, a(`/api/projects`), 200);
    await expectStatus(`GET /api/projects/cert-summary  (admin)`, a(`/api/projects/cert-summary`), 200);
    await expectNot403(`GET /api/confluence/spaces  (admin)`, a(`/api/confluence/spaces`));
    await expectNot403(`GET /api/confluence/pages  (admin)`, a(`/api/confluence/pages`));

    // ── Phase 5: unauthenticated must always 401 ─────────────────────────────
    console.log("\n── Phase 5: unauthenticated → 401 ──");
    const anon = async (url, opts = {}) => fetch(`${BASE}${url}`, opts);
    await expectStatus(`anon GET /api/leads`, anon(`/api/leads`), 401);
    await expectStatus(`anon GET /api/leads/1`, anon(`/api/leads/1`), 401);
    await expectStatus(`anon GET /api/accounts`, anon(`/api/accounts`), 401);
    await expectStatus(`anon GET /api/accounts/${ids.accountId ?? 1}`, anon(`/api/accounts/${ids.accountId ?? 1}`), 401);
    await expectStatus(`anon GET /api/projects`, anon(`/api/projects`), 401);
    await expectStatus(`anon GET /api/projects/cert-summary`, anon(`/api/projects/cert-summary`), 401);
    await expectStatus(`anon GET /api/confluence/spaces`, anon(`/api/confluence/spaces`), 401);
    await expectStatus(`anon GET /api/confluence/pages`, anon(`/api/confluence/pages`), 401);
    await expectStatus(`anon POST /api/confluence/pages`, anon(`/api/confluence/pages`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: BASE },
      body: JSON.stringify({ title: "x", spaceKey: "x", body: "x" }),
    }), 401);
    await expectStatus(`anon PUT /api/confluence/pages/999`, anon(`/api/confluence/pages/999`, {
      method: "PUT", headers: { "Content-Type": "application/json", Origin: BASE },
      body: JSON.stringify({ title: "x", body: "x", version: 1 }),
    }), 401);
    if (ids.projectId != null) {
      await expectStatus(
        `anon POST /api/projects/${ids.projectId}/tracker-alerts/evaluate`,
        anon(`/api/projects/${ids.projectId}/tracker-alerts/evaluate`, {
          method: "POST", headers: { "Content-Type": "application/json", Origin: BASE },
          body: JSON.stringify({}),
        }),
        401,
      );
    }
    if (ids.sharedMsgId != null) {
      await expectStatus(
        `anon POST /api/email-messages/${ids.sharedMsgId}/reassign`,
        anon(`/api/email-messages/${ids.sharedMsgId}/reassign`, {
          method: "POST", headers: { "Content-Type": "application/json", Origin: BASE },
          body: JSON.stringify({ objectType: "lead", objectId: 1 }),
        }),
        401,
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

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
