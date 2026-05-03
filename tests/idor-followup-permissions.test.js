#!/usr/bin/env node
/**
 * IDOR Follow-up Permission Regression Suite
 *
 * Verifies the fixes for the 12 requireAuth-only :id routes flagged in
 * docs/PERMISSION_AUDIT.md "SEPARATE TICKET" section.
 *
 * Real fixes (covered here):
 *   - GET /api/email-messages/:id/associations    — mail_team gate
 *   - GET /api/confluence/pages/:id               — knowledge.view
 *   - GET /api/projects/:id                       — projects.view
 *   - GET /api/projects/:id/certification         — projects.view
 *   - GET /api/projects/:id/milestones            — projects.view
 *   - GET /api/projects/:id/tracker-sync          — projects.view
 *   - GET /api/projects/:id/tracker-alerts/state  — projects.view
 *   - GET /api/projects/:id/timeline              — projects.view
 *   - GET /api/opportunities/:id/contacts         — crm.view
 *   - GET /api/accounts/:id/contacts              — crm.view
 *   - GET /api/leads/:id/contacts                 — crm.view
 *
 * False positive (not re-tested here, covered by mail-permissions suite):
 *   - GET /api/gmail/accounts/:id/access — already calls requireOwnerOrAdmin
 *
 * Strategy:
 *   1. Snapshot viewer.permissions, then set ALL three modules to "none"
 *      (knowledge / projects / crm) and grant mail_team[1].view=true.
 *   2. Each route must respond 403 for the viewer.
 *   3. Admin must still receive 200 (or another non-403 acceptable status).
 *   4. For email-messages/:id/associations, additionally confirm that a viewer
 *      with mail_team[1].view=true on a message anchored to account 1 is NOT
 *      blocked by the ACL (status != 403).
 *   5. Restore on teardown.
 *
 * Run with: node tests/idor-followup-permissions.test.js
 * Requires: server at localhost:5000, viewer@voltsafe.com seeded.
 */

import bcrypt from "bcryptjs";
import pg from "pg";

const BASE = "http://localhost:5000";
const VIEWER_EMAIL = "viewer@voltsafe.com";
const VIEWER_PWD = "vstest_idor_!1";
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
    bad(`${label}`, `expected NOT 403, got 403: ${body.slice(0, 140)}`);
  } else {
    ok(`${label} \u2192 ${res.status} (not blocked by ACL)`);
  }
}

async function setup(client) {
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
  // All three modules forbidden so the new requirePermission gates deny.
  // mail_team[1].view granted so the email-messages/associations route
  // ALLOWS the viewer for messages anchored to account 1 (positive case).
  const perms = {
    knowledge: "none",
    projects: "none",
    crm: "none",
    mail_team: { [String(ACCOUNT_ID)]: { view: true, edit: false } },
  };
  await client.query(
    `UPDATE users SET permissions = $1::jsonb WHERE email = $2`,
    [JSON.stringify(perms), VIEWER_EMAIL]
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
  const projectId = (await one(`SELECT id FROM projects ORDER BY id LIMIT 1`))?.id ?? null;
  const oppId = (await one(`SELECT id FROM opportunities ORDER BY id LIMIT 1`))?.id ?? null;
  const accountId = (await one(`SELECT id FROM accounts ORDER BY id LIMIT 1`))?.id ?? null;
  const leadId = (await one(`SELECT id FROM leads ORDER BY id LIMIT 1`))?.id ?? null;
  const sharedMsgId = (await one(
    `SELECT id FROM email_messages WHERE source_account_id = $1 ORDER BY id LIMIT 1`,
    ACCOUNT_ID,
  ))?.id ?? null;
  // A message anchored to a DIFFERENT account (or NULL) so the negative
  // mail_team test exercises the deny path.
  const otherMsgId = (await one(
    `SELECT id FROM email_messages WHERE source_account_id IS DISTINCT FROM $1 ORDER BY id LIMIT 1`,
    ACCOUNT_ID,
  ))?.id ?? null;
  // A confluence page id is opaque & remote — pick a clearly invalid one.
  // The permission check must run BEFORE any Confluence call, so 403 is
  // expected regardless of whether the page exists.
  const confId = "999999999";
  return { projectId, oppId, accountId, leadId, sharedMsgId, otherMsgId, confId };
}

async function run() {
  console.log("=== VoltSafe IDOR Follow-up Permission Regression Suite ===\n");

  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let original = null;
  try {
    original = await setup(client);
    console.log(
      `Setup: viewer reset; knowledge/projects/crm = none, mail_team[${ACCOUNT_ID}].view=true\n`
    );

    const viewerCookie = await login(VIEWER_EMAIL, VIEWER_PWD);
    const adminCookie = await login(ADMIN_EMAIL, ADMIN_PWD);
    const v = authed(viewerCookie);
    const a = authed(adminCookie);

    const ids = await pickIds(client);
    console.log(`IDs: ${JSON.stringify(ids)}\n`);

    // ── 1. /api/projects/:id* — viewer (projects=none) must get 403 ──────────
    console.log("── 1. /api/projects/:id* — viewer (projects=none) ──");
    if (ids.projectId == null) {
      console.log("  (skipped: no projects in DB)");
    } else {
      const pid = ids.projectId;
      await expectStatus(`GET /api/projects/${pid}`, v(`/api/projects/${pid}`), 403);
      await expectStatus(`GET /api/projects/${pid}/certification`, v(`/api/projects/${pid}/certification`), 403);
      await expectStatus(`GET /api/projects/${pid}/milestones`, v(`/api/projects/${pid}/milestones`), 403);
      await expectStatus(`GET /api/projects/${pid}/tracker-sync`, v(`/api/projects/${pid}/tracker-sync`), 403);
      await expectStatus(`GET /api/projects/${pid}/tracker-alerts/state`, v(`/api/projects/${pid}/tracker-alerts/state`), 403);
      await expectStatus(`GET /api/projects/${pid}/timeline`, v(`/api/projects/${pid}/timeline`), 403);
      // IDOR vector: probing arbitrary ID must also 403 (gate before lookup)
      await expectStatus(`GET /api/projects/999999  (probing IDOR)`, v(`/api/projects/999999`), 403);
    }

    // ── 2. /api/projects/:id — admin retains access ──────────────────────────
    console.log("\n── 2. /api/projects/:id — admin retains access ──");
    if (ids.projectId != null) {
      const pid = ids.projectId;
      await expectStatus(`GET /api/projects/${pid}  (admin)`, a(`/api/projects/${pid}`), 200);
      await expectStatus(`GET /api/projects/${pid}/milestones  (admin)`, a(`/api/projects/${pid}/milestones`), 200);
      await expectStatus(`GET /api/projects/${pid}/timeline  (admin)`, a(`/api/projects/${pid}/timeline`), 200);
    }

    // ── 3. /api/{opportunities,accounts,leads}/:id/contacts — viewer (crm=none) ──
    console.log("\n── 3. CRM contact-link routes — viewer (crm=none) ──");
    if (ids.oppId != null)
      await expectStatus(`GET /api/opportunities/${ids.oppId}/contacts`, v(`/api/opportunities/${ids.oppId}/contacts`), 403);
    if (ids.accountId != null)
      await expectStatus(`GET /api/accounts/${ids.accountId}/contacts`, v(`/api/accounts/${ids.accountId}/contacts`), 403);
    if (ids.leadId != null)
      await expectStatus(`GET /api/leads/${ids.leadId}/contacts`, v(`/api/leads/${ids.leadId}/contacts`), 403);
    // IDOR probe
    await expectStatus(`GET /api/accounts/999999/contacts  (probing IDOR)`, v(`/api/accounts/999999/contacts`), 403);

    // ── 4. CRM contact-link routes — admin retains access ────────────────────
    console.log("\n── 4. CRM contact-link routes — admin retains access ──");
    if (ids.oppId != null)
      await expectStatus(`GET /api/opportunities/${ids.oppId}/contacts  (admin)`, a(`/api/opportunities/${ids.oppId}/contacts`), 200);
    if (ids.accountId != null)
      await expectStatus(`GET /api/accounts/${ids.accountId}/contacts  (admin)`, a(`/api/accounts/${ids.accountId}/contacts`), 200);
    if (ids.leadId != null)
      await expectStatus(`GET /api/leads/${ids.leadId}/contacts  (admin)`, a(`/api/leads/${ids.leadId}/contacts`), 200);

    // ── 5. /api/confluence/pages/:id — viewer (knowledge=none) ───────────────
    console.log("\n── 5. /api/confluence/pages/:id — viewer (knowledge=none) ──");
    await expectStatus(
      `GET /api/confluence/pages/${ids.confId}  (viewer)`,
      v(`/api/confluence/pages/${ids.confId}`),
      403,
    );

    // ── 6. /api/email-messages/:id/associations — mail_team gate ─────────────
    console.log("\n── 6. /api/email-messages/:id/associations — mail_team gate ──");
    if (ids.sharedMsgId == null) {
      console.log(`  (skipped: no email_messages anchored to account_id=${ACCOUNT_ID})`);
    } else {
      // Viewer has mail_team[1].view=true → should NOT be blocked
      await expectNot403(
        `GET /api/email-messages/${ids.sharedMsgId}/associations  (viewer w/ shared access)`,
        v(`/api/email-messages/${ids.sharedMsgId}/associations`),
      );
    }
    if (ids.otherMsgId == null) {
      console.log(`  (skipped: no email_messages outside account_id=${ACCOUNT_ID} for negative case)`);
    } else {
      // Viewer has NO grant on that other mailbox → must 403
      await expectStatus(
        `GET /api/email-messages/${ids.otherMsgId}/associations  (viewer no shared access)`,
        v(`/api/email-messages/${ids.otherMsgId}/associations`),
        403,
      );
    }
    // IDOR probe with an obviously bogus ID — gate runs before DB lookup
    // for the mail_team check, so we expect 404 (msg not found) rather than
    // 200, and CRITICALLY never the raw associations of someone else's msg.
    await expectStatus(
      `GET /api/email-messages/999999999/associations  (probing IDOR)`,
      v(`/api/email-messages/999999999/associations`),
      404,
    );

    // ── 7. Unauthenticated access — all routes must 401 ──────────────────────
    console.log("\n── 7. Unauthenticated — all flagged routes must 401 ──");
    if (ids.projectId != null) {
      const r = await fetch(`${BASE}/api/projects/${ids.projectId}`);
      r.status === 401 ? ok(`GET /api/projects/${ids.projectId} \u2192 401`)
                       : bad(`GET /api/projects/${ids.projectId}`, `expected 401, got ${r.status}`);
    }
    if (ids.accountId != null) {
      const r = await fetch(`${BASE}/api/accounts/${ids.accountId}/contacts`);
      r.status === 401 ? ok(`GET /api/accounts/${ids.accountId}/contacts \u2192 401`)
                       : bad(`GET /api/accounts/${ids.accountId}/contacts`, `expected 401, got ${r.status}`);
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
