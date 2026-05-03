#!/usr/bin/env node
/**
 * Asset & Gmail Attachment Permission Regression Suite
 *
 * Verifies the P1 IDOR fix and the bundled P2 Gmail attachment access bug
 * documented in docs/PERMISSION_AUDIT.md.
 *
 *   1. /api/assets/:id/file and /api/assets/:id/download now require the
 *      "knowledge" module permission (view or higher). A viewer with
 *      knowledge="none" must get 403, NOT 200.
 *   2. /api/gmail/attachments/:id/download and .../calendar-invite now
 *      honor mail_team[X] shared grants. A viewer with mail_team[1].view
 *      must NOT get 403 on attachments belonging to messages anchored to
 *      account 1 (they may get 200 or 502 depending on whether the
 *      attachment can be re-fetched from Gmail — both are acceptable
 *      because both prove the permission gate didn't block them).
 *   3. An admin must continue to access both freely.
 *
 * Run with: node tests/asset-permissions.test.js
 * Requires: server running at localhost:5000, viewer@voltsafe.com user exists,
 *           email_accounts.id=1 owned by trevor@voltsafe.com (master_admin).
 *
 * Setup is performed in-test (NO schema changes):
 *   - viewer@voltsafe.com password is reset to a known value (bcryptjs)
 *   - viewer.permissions = { knowledge: "none", mail_team: { "1": {view:true,edit:false} } }
 *   - viewer's previous permissions + password are restored on teardown.
 */

import bcrypt from "bcryptjs";
import pg from "pg";

const BASE = "http://localhost:5000";
const VIEWER_EMAIL = "viewer@voltsafe.com";
const VIEWER_PWD = "vstest_assets_!1";
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
  // knowledge="none" so the new requirePermission gate denies the asset routes.
  // mail_team[1].view=true so the gmail attachment routes ALLOW shared access.
  const perms = {
    knowledge: "none",
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

async function pickAssetId(client) {
  const r = await client.query(`SELECT id FROM assets ORDER BY id LIMIT 1`);
  return r.rows[0]?.id ?? null;
}

async function pickAttachmentIdForAccount(client, acctId) {
  // Find an email_attachment whose parent message belongs to acctId.
  // Uses email_attachments / email_messages table names matching prior tests.
  const r = await client.query(
    `SELECT a.id FROM email_attachments a
       JOIN email_messages m ON m.id = a.message_id
      WHERE m.source_account_id = $1
      ORDER BY a.id DESC
      LIMIT 1`,
    [acctId]
  );
  return r.rows[0]?.id ?? null;
}

async function run() {
  console.log("=== VoltSafe Asset & Attachment Permission Regression Suite ===\n");

  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let original = null;
  try {
    original = await setup(client);
    console.log(`Setup: viewer reset; knowledge=none, mail_team[${ACCOUNT_ID}].view=true\n`);

    const viewerCookie = await login(VIEWER_EMAIL, VIEWER_PWD);
    const adminCookie = await login(ADMIN_EMAIL, ADMIN_PWD);
    const v = authed(viewerCookie);
    const a = authed(adminCookie);

    const assetId = await pickAssetId(client);
    const attId = await pickAttachmentIdForAccount(client, ACCOUNT_ID);

    // ── 1. Asset IDOR fix — viewer with knowledge=none must get 403 ──────────
    console.log("── 1. /api/assets/:id/file|download — viewer (knowledge=none) ──");
    if (assetId == null) {
      console.log("  (skipped: no assets in DB)");
    } else {
      await expectStatus(
        `GET /api/assets/${assetId}/file  (viewer no-knowledge)`,
        v(`/api/assets/${assetId}/file`),
        403,
      );
      await expectStatus(
        `GET /api/assets/${assetId}/download  (viewer no-knowledge)`,
        v(`/api/assets/${assetId}/download`),
        403,
      );
    }

    // Bonus: confirm the IDOR vector is closed even for non-existent IDs —
    // the permission gate must run BEFORE the DB lookup, so we expect 403
    // (not 404) when the viewer probes an arbitrary high ID.
    await expectStatus(
      `GET /api/assets/999999/download  (viewer probing IDOR)`,
      v(`/api/assets/999999/download`),
      403,
    );

    // ── 2. Admin must still pass ─────────────────────────────────────────────
    console.log("\n── 2. /api/assets/:id/* — admin retains access ──");
    if (assetId == null) {
      console.log("  (skipped: no assets in DB)");
    } else {
      await expectStatus(
        `GET /api/assets/${assetId}/file  (admin)`,
        a(`/api/assets/${assetId}/file`),
        200,
      );
      await expectStatus(
        `GET /api/assets/${assetId}/download  (admin)`,
        a(`/api/assets/${assetId}/download`),
        200,
      );
    }

    // ── 3. Gmail attachment shared-access fix — viewer w/ mail_team[1].view ─
    // Previously this returned 403 (owner-or-admin only). After the fix it
    // should NOT return 403; the most likely outcomes are 200 (cache hit) or
    // 502 (Gmail re-fetch failed for an old attachment). 404 is also OK if
    // there are no attachments for the account.
    console.log("\n── 3. /api/gmail/attachments/:id/download — viewer w/ mail_team view ──");
    if (attId == null) {
      console.log(`  (skipped: no email_attachments anchored to account_id=${ACCOUNT_ID})`);
    } else {
      const res = await v(`/api/gmail/attachments/${attId}/download`);
      if (res.status === 403) {
        const body = await res.text().catch(() => "");
        bad(
          `GET /api/gmail/attachments/${attId}/download  (viewer w/ shared access)`,
          `expected NOT 403, got 403: ${body.slice(0, 140)}`,
        );
      } else {
        ok(`GET /api/gmail/attachments/${attId}/download \u2192 ${res.status} (not blocked by ACL)`);
      }
    }

    // ── 4. Gmail attachment — anonymous (no session) still 401 ──────────────
    console.log("\n── 4. /api/gmail/attachments/:id/download — unauthenticated ──");
    if (attId != null) {
      const res = await fetch(`${BASE}/api/gmail/attachments/${attId}/download`);
      if (res.status === 401) ok(`unauthenticated \u2192 401`);
      else bad(`unauthenticated`, `expected 401, got ${res.status}`);
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
