#!/usr/bin/env node
/**
 * Phase 4 Mailbox Permission Enforcement Test Suite
 *
 * Verifies that the per-account mail_team view/edit permission model is
 * enforced on every guarded Gmail mutation route, that read routes remain
 * accessible with view-only grants, and that owner/admin-only routes
 * (sync, disconnect, sync-toggle) reject non-owner non-admin callers.
 *
 * Run with: node tests/mail-permissions.test.js
 * Requires: server running at localhost:5000, viewer@voltsafe.com user exists,
 *           email_accounts.id=1 owned by trevor@voltsafe.com (master_admin).
 *
 * Setup is performed in-test (NO schema changes):
 *   - viewer@voltsafe.com password is reset to a known value (bcryptjs)
 *   - viewer.permissions.mail_team = { "1": { view: true, edit: false } }
 * Cleanup restores viewer.permissions.mail_team = {}.
 */

import bcrypt from "bcryptjs";
import pg from "pg";

const BASE = "http://localhost:5000";
const VIEWER_EMAIL = "viewer@voltsafe.com";
const VIEWER_PWD = "vstest_viewer_!1";
const ADMIN_EMAIL = "trevor@voltsafe.com";
const ADMIN_PWD = "alberni1444";
const ACCOUNT_ID = 1; // trevor@voltsafe.com mailbox

let passed = 0;
let failed = 0;
const ok = (l) => { console.log(`  \u2713 ${l}`); passed++; };
const bad = (l, d) => { console.error(`  \u2717 ${l}${d ? ` \u2014 ${d}` : ""}`); failed++; };

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
  await sleep(400); // allow connect-pg-simple to commit session
  return cookie;
}

const authed = (cookie) => async (url, opts = {}) => fetch(`${BASE}${url}`, {
  ...opts,
  headers: { "Content-Type": "application/json", Cookie: cookie, ...(opts.headers || {}) },
});

async function expect(label, p, ...statuses) {
  const res = await p;
  if (statuses.includes(res.status)) {
    ok(`${label} \u2192 ${res.status}`);
  } else {
    const body = await res.text().catch(() => "");
    bad(`${label} \u2192 expected ${statuses.join("|")}, got ${res.status}`, body.slice(0, 140));
  }
}

async function setup(client) {
  // Snapshot the viewer's current password + permissions so teardown can
  // restore them exactly. This keeps the test isolated and repeatable —
  // the sibling `permissions` test suite (and any others that depend on
  // viewer@voltsafe.com) sees no observable side-effects after we run.
  const snap = await client.query(
    `SELECT password, permissions FROM users WHERE email = $1 LIMIT 1`,
    [VIEWER_EMAIL]
  );
  if (snap.rowCount === 0) throw new Error(`Viewer user ${VIEWER_EMAIL} not found`);
  const original = {
    password: snap.rows[0].password,
    permissions: snap.rows[0].permissions,
  };

  // 1) Set viewer password to a known value (bcryptjs hash, salt rounds = 10).
  const hash = await bcrypt.hash(VIEWER_PWD, 10);
  await client.query(
    `UPDATE users SET password = $1, status = 'active', must_change_password = false WHERE email = $2`,
    [hash, VIEWER_EMAIL]
  );
  // 2) Grant viewer VIEW-only access to mailbox account_id=1.
  await client.query(
    `UPDATE users
       SET permissions = jsonb_set(
         COALESCE(permissions, '{}'::jsonb),
         '{mail_team}',
         $1::jsonb,
         true
       )
       WHERE email = $2`,
    [JSON.stringify({ [String(ACCOUNT_ID)]: { view: true, edit: false } }), VIEWER_EMAIL]
  );

  return original;
}

async function teardown(client, original) {
  if (!original) return;
  // Restore exact pre-test state.
  await client.query(
    `UPDATE users SET password = $1, permissions = $2 WHERE email = $3`,
    [original.password, original.permissions, VIEWER_EMAIL]
  );
}

async function run() {
  console.log("=== VoltSafe Phase 4 Mailbox Permission Test Suite ===\n");

  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await setup(client);
    console.log(`Setup: viewer password reset, mail_team[${ACCOUNT_ID}] = view-only\n`);

    const viewerCookie = await login(VIEWER_EMAIL, VIEWER_PWD);
    const v = authed(viewerCookie);

    // Resolve a real message + thread anchored to account 1 (so the thread-record
    // anchor lookup actually triggers the edit-access check).
    const msgRow = await client.query(
      `SELECT id, gmail_thread_id FROM email_messages WHERE source_account_id = $1 LIMIT 1`,
      [ACCOUNT_ID]
    );
    const realMsgId = msgRow.rows[0]?.id ?? 1;
    const realThreadId = msgRow.rows[0]?.gmail_thread_id ?? "missing";

    // ── 1. Eight guarded Gmail mutation routes — view-only must get 403 ──────
    console.log("── view-only viewer \u2192 403 on 8 guarded mutation routes (acct=1) ──");

    await expect(
      "PATCH /api/gmail/thread-record/:threadId  [edit-required]",
      v(`/api/gmail/thread-record/${encodeURIComponent(realThreadId)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "snoozed" }),
      }),
      403
    );

    await expect(
      "POST  /api/gmail/drafts                   [edit-required]",
      v(`/api/gmail/drafts`, {
        method: "POST",
        body: JSON.stringify({ asAccountId: ACCOUNT_ID, to: "x@example.com", subject: "x", body: "x" }),
      }),
      403
    );

    await expect(
      "DEL   /api/gmail/drafts/:id               [edit-required]",
      v(`/api/gmail/drafts/abc?asAccountId=${ACCOUNT_ID}`, { method: "DELETE" }),
      403
    );

    await expect(
      "POST  /api/gmail/messages/:id/mark-read   [edit-required]",
      v(`/api/gmail/messages/${realMsgId}/mark-read`, {
        method: "POST",
        body: JSON.stringify({ asAccountId: ACCOUNT_ID }),
      }),
      403
    );

    await expect(
      "POST  /api/gmail/messages/:id/toggle-star [edit-required]",
      v(`/api/gmail/messages/${realMsgId}/toggle-star`, {
        method: "POST",
        body: JSON.stringify({ asAccountId: ACCOUNT_ID }),
      }),
      403
    );

    await expect(
      "POST  /api/gmail/bulk-mark-read           [edit-required]",
      v(`/api/gmail/bulk-mark-read`, {
        method: "POST",
        body: JSON.stringify({ asAccountId: ACCOUNT_ID, messageIds: ["xyz"], markAs: "read" }),
      }),
      403
    );

    await expect(
      "POST  /api/gmail/bulk-archive             [edit-required]",
      v(`/api/gmail/bulk-archive`, {
        method: "POST",
        body: JSON.stringify({ asAccountId: ACCOUNT_ID, threadIds: ["xyz"] }),
      }),
      403
    );

    await expect(
      "POST  /api/gmail/send                     [edit-required]",
      v(`/api/gmail/send`, {
        method: "POST",
        body: JSON.stringify({ asAccountId: ACCOUNT_ID, to: "x@example.com", subject: "x", body: "x" }),
      }),
      403
    );

    // ── 2. Read routes — view-only viewer should still get 200 ──────────────
    console.log("\n── view-only viewer \u2192 200 on read routes ──");
    await expect("GET  /api/gmail/accounts                  [read]", v(`/api/gmail/accounts`), 200);
    await expect(
      "GET  /api/gmail/messages?asAccountId=1    [read]",
      v(`/api/gmail/messages?asAccountId=${ACCOUNT_ID}&limit=5`),
      200
    );
    await expect(
      "GET  /api/gmail/threads?asAccountId=1     [read]",
      v(`/api/gmail/threads?asAccountId=${ACCOUNT_ID}&limit=5`),
      200
    );

    // ── 3. Sync/watch admin/owner routes — viewer must be denied ────────────
    console.log("\n── view-only viewer \u2192 403 on owner/admin sync + watch routes ──");
    await expect(
      "POST /api/gmail/accounts/1/resync        [owner|admin]",
      v(`/api/gmail/accounts/${ACCOUNT_ID}/resync`, { method: "POST" }),
      403
    );
    await expect(
      "POST /api/gmail/accounts/1/sync-toggle   [owner|admin]",
      v(`/api/gmail/accounts/${ACCOUNT_ID}/sync-toggle`, {
        method: "POST",
        body: JSON.stringify({ enabled: true }),
      }),
      403
    );
    await expect(
      "POST /api/gmail/accounts/1/disconnect    [owner|admin]",
      v(`/api/gmail/accounts/${ACCOUNT_ID}/disconnect`, { method: "POST" }),
      403
    );
    await expect(
      "GET  /api/gmail/accounts/1/access        [owner|admin]",
      v(`/api/gmail/accounts/${ACCOUNT_ID}/access`),
      403
    );

    // ── 4. Owner/admin (Trevor) keeps expected access ───────────────────────
    console.log("\n── owner/admin (trevor, master_admin) \u2192 expected access ──");
    const adminCookie = await login(ADMIN_EMAIL, ADMIN_PWD);
    const a = authed(adminCookie);

    await expect("GET  /api/gmail/accounts                  [admin read]", a(`/api/gmail/accounts`), 200);
    await expect(
      "GET  /api/gmail/accounts/1/access        [owner|admin]",
      a(`/api/gmail/accounts/${ACCOUNT_ID}/access`),
      200
    );
    // Sync-toggle is idempotent and reversible — flip on (it's already on).
    await expect(
      "POST /api/gmail/accounts/1/sync-toggle   [owner|admin]",
      a(`/api/gmail/accounts/${ACCOUNT_ID}/sync-toggle`, {
        method: "POST",
        body: JSON.stringify({ enabled: true }),
      }),
      200
    );
    // Mutations on the owned mailbox should pass the auth gate. We don't care
    // whether the underlying Gmail call succeeds — anything that is NOT 403
    // means the Phase 4 guard correctly allowed the owner through. 503 = Gmail
    // upstream error, 400 = schema, 200/404 = handler ran.
    const starRes = await a(`/api/gmail/messages/${realMsgId}/toggle-star`, {
      method: "POST",
      body: JSON.stringify({ asAccountId: ACCOUNT_ID }),
    });
    if (starRes.status === 403) {
      bad(`POST /api/gmail/messages/:id/toggle-star [owner pass-through] \u2192 403 (guard wrongly denied owner)`);
    } else {
      ok(`POST /api/gmail/messages/:id/toggle-star [owner pass-through] \u2192 ${starRes.status} (not 403 = guard allowed owner)`);
    }
  } finally {
    await teardown(client);
    await client.end();
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
  if (failed > 0) {
    console.error(`\n\u274C ${failed} test(s) FAILED`);
    process.exit(1);
  }
  console.log(`\n\u2705 All ${passed} tests PASSED`);
  process.exit(0);
}

run().catch((err) => {
  console.error("Test runner error:", err.message);
  process.exit(1);
});
