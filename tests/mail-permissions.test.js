#!/usr/bin/env node
/**
 * Phase 4 Mailbox Permission Enforcement Test Suite
 *
 * Verifies that the per-account mail_team view/edit permission model is
 * enforced on every guarded Gmail mutation route, that read routes remain
 * accessible with view-only grants, and that owner/admin-only routes
 * (sync, disconnect, sync-toggle) reject non-owner non-admin callers.
 *
 * ISOLATION STRATEGY (safe — no real user or account mutation):
 *   1. Creates a fixture viewer user   (email @example.invalid, known password).
 *   2. Creates a fixture mailbox account owned by trevor (user_id=4, is_active=true)
 *      with a fake email address @example.invalid.
 *   3. Creates one fixture message under the fixture mailbox.
 *   4. Grants the fixture viewer VIEW-only access to the fixture mailbox via
 *      permissions.mail_team = { "<fixtureAccountId>": { view: true, edit: false } }.
 *   5. Runs all assertions against fixture IDs.
 *   6. Teardown (try/finally): deletes fixture message → fixture account →
 *      fixture viewer user.  Safe to re-run.
 *
 * No real user password is ever changed.  No real email_account is ever modified.
 *
 * Run with: node tests/mail-permissions.test.js
 * Requires: server running at localhost:5000.
 */

import bcrypt from "bcryptjs";
import pg     from "pg";
import { fixtureEmail, assertTestEnvironment } from "./test-safety.cjs";

assertTestEnvironment();

const BASE        = "http://localhost:5000";
const ADMIN_EMAIL = "trevor@voltsafe.com";
const ADMIN_PWD   = "alberni1444";
const ADMIN_USER_ID  = 4;   // trevor — fixture mailbox is owned by trevor so owner-pass-through works
const WORKSPACE_ID   = 1;

let passed = 0;
let failed = 0;
const ok  = (l)    => { console.log(`  ✓ ${l}`);                              passed++; };
const bad = (l, d) => { console.error(`  ✗ ${l}${d ? ` — ${d}` : ""}`);      failed++; };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Origin": BASE },
    body:    JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status}`);
  const cookie = res.headers.get("set-cookie")?.match(/(connect\.sid=[^;]+)/)?.[1];
  if (!cookie) throw new Error(`No session cookie for ${email}`);
  await sleep(400);
  return cookie;
}

const authed = (cookie) => async (url, opts = {}) => fetch(`${BASE}${url}`, {
  ...opts,
  headers: { "Content-Type": "application/json", Cookie: cookie, Origin: BASE, ...(opts.headers || {}) },
});

async function expect(label, p, ...statuses) {
  const res = await p;
  if (statuses.includes(res.status)) {
    ok(`${label} → ${res.status}`);
  } else {
    const body = await res.text().catch(() => "");
    bad(`${label} → expected ${statuses.join("|")}, got ${res.status}`, body.slice(0, 140));
  }
}

/** Create all fixture rows. Returns ctx object for teardown. */
async function setup(client) {
  const FIXTURE_TAG = "mailperm-" + Date.now();

  // ── 1. Fixture viewer user ──────────────────────────────────────────────
  const viewerEmail = fixtureEmail("mailperm", "viewer");
  const viewerPwd   = "mailperm-viewer-" + Date.now();
  const viewerHash  = await bcrypt.hash(viewerPwd, 10);

  // Insert viewer without mail_team yet — we'll add it after we know the account ID.
  const viewerRes = await client.query(
    `INSERT INTO users
       (name, email, password, role, status, must_change_password, permissions)
     VALUES ($1, $2, $3, 'read-only', 'active', false,
             '{"crm":"none","quoting":"none","support":"none","calendar":"none","projects":"none","knowledge":"none","mail_team":{},"partnerships":"none","calendar_team":[],"team_workload":"none","communications":"none"}'::jsonb)
     RETURNING id`,
    [`MailPerm Fixture Viewer ${FIXTURE_TAG}`, viewerEmail, viewerHash],
  );
  const viewerUserId = viewerRes.rows[0].id;

  // ── 2. Fixture mailbox account under trevor (owner) ─────────────────────
  // is_active=true, auth_status='active' so resolveAccount() accepts it and
  // the owner pass-through test works without needing a real active account.
  const acctEmail = fixtureEmail("mailperm", "acct");
  const acctRes = await client.query(
    `INSERT INTO email_accounts
       (user_id, workspace_id, provider, email_address, display_name,
        auth_status, is_shared, refresh_token, is_active)
     VALUES ($1, $2, 'gmail', $3, 'MailPerm Fixture Mailbox',
             'active', false, $4, true)
     RETURNING id`,
    [ADMIN_USER_ID, WORKSPACE_ID, acctEmail, `fake-refresh-mailperm-${FIXTURE_TAG}`],
  );
  const fixtureAccountId = acctRes.rows[0].id;

  // ── 3. Fixture message in the fixture mailbox ───────────────────────────
  const msgGmailId  = `mailperm-msg-${FIXTURE_TAG}`;
  const msgThreadId = `mailperm-thr-${FIXTURE_TAG}`;
  const msgRes = await client.query(
    `INSERT INTO email_messages
       (gmail_message_id, gmail_thread_id, subject, from_email, sent_at,
        snippet, owner_user_id, source_account_id, direction, label_ids,
        is_inbox, is_unread, is_starred, is_spam, is_trash, is_draft, is_sent)
     VALUES ($1, $2, 'MailPerm Fixture Message', 'sender@example.invalid', NOW(),
             'fixture message', $3, $4, 'inbound', '["INBOX"]',
             true, false, false, false, false, false, false)
     RETURNING id`,
    [msgGmailId, msgThreadId, ADMIN_USER_ID, fixtureAccountId],
  );
  const fixtureMessageDbId = msgRes.rows[0].id;

  // ── 4. Grant fixture viewer VIEW-only access to the fixture mailbox ─────
  await client.query(
    `UPDATE users
       SET permissions = jsonb_set(
         COALESCE(permissions, '{}'::jsonb),
         '{mail_team}',
         $1::jsonb,
         true
       )
     WHERE id = $2`,
    [JSON.stringify({ [String(fixtureAccountId)]: { view: true, edit: false } }), viewerUserId],
  );

  return {
    FIXTURE_TAG,
    viewerEmail,
    viewerPwd,
    viewerUserId,
    fixtureAccountId,
    fixtureMessageDbId,
    fixtureThreadId: msgThreadId,
    msgGmailId,
  };
}

async function teardown(client, ctx) {
  if (!ctx) return;
  // Delete in FK dependency order: messages → email_accounts → users.
  if (ctx.msgGmailId) {
    await client.query(
      `DELETE FROM email_messages WHERE gmail_message_id = $1`,
      [ctx.msgGmailId],
    ).catch((e) => console.warn("teardown msg:", e.message));
  }
  if (ctx.fixtureAccountId) {
    await client.query(
      `DELETE FROM email_accounts WHERE id = $1`,
      [ctx.fixtureAccountId],
    ).catch((e) => console.warn("teardown acct:", e.message));
  }
  if (ctx.viewerUserId) {
    await client.query(
      `DELETE FROM users WHERE id = $1`,
      [ctx.viewerUserId],
    ).catch((e) => console.warn("teardown viewer:", e.message));
  }
}

async function run() {
  console.log("=== VoltSafe Phase 4 Mailbox Permission Test Suite ===\n");

  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let ctx = null;
  try {
    ctx = await setup(client);
    console.log(
      `Setup: fixture viewer id=${ctx.viewerUserId} (${ctx.viewerEmail}), ` +
      `fixture account id=${ctx.fixtureAccountId}, ` +
      `fixture message db-id=${ctx.fixtureMessageDbId}\n`,
    );

    const viewerCookie = await login(ctx.viewerEmail, ctx.viewerPwd);
    const v = authed(viewerCookie);

    // ── 1. Eight guarded Gmail mutation routes — view-only must get 403 ────
    console.log(`── view-only viewer → 403 on 8 guarded mutation routes (acct=${ctx.fixtureAccountId}) ──`);

    await expect(
      "PATCH /api/gmail/thread-record/:threadId  [edit-required]",
      v(`/api/gmail/thread-record/${encodeURIComponent(ctx.fixtureThreadId)}`, {
        method: "PATCH",
        body:   JSON.stringify({ status: "snoozed" }),
      }),
      403,
    );

    await expect(
      "POST  /api/gmail/drafts                   [edit-required]",
      v("/api/gmail/drafts", {
        method: "POST",
        body:   JSON.stringify({ asAccountId: ctx.fixtureAccountId, to: "x@example.com", subject: "x", body: "x" }),
      }),
      403,
    );

    await expect(
      "DEL   /api/gmail/drafts/:id               [edit-required]",
      v(`/api/gmail/drafts/abc?asAccountId=${ctx.fixtureAccountId}`, { method: "DELETE" }),
      403,
    );

    await expect(
      "POST  /api/gmail/messages/:id/mark-read   [edit-required]",
      v(`/api/gmail/messages/${ctx.fixtureMessageDbId}/mark-read`, {
        method: "POST",
        body:   JSON.stringify({ asAccountId: ctx.fixtureAccountId }),
      }),
      403,
    );

    await expect(
      "POST  /api/gmail/messages/:id/toggle-star [edit-required]",
      v(`/api/gmail/messages/${ctx.fixtureMessageDbId}/toggle-star`, {
        method: "POST",
        body:   JSON.stringify({ asAccountId: ctx.fixtureAccountId }),
      }),
      403,
    );

    await expect(
      "POST  /api/gmail/bulk-mark-read           [edit-required]",
      v("/api/gmail/bulk-mark-read", {
        method: "POST",
        body:   JSON.stringify({ asAccountId: ctx.fixtureAccountId, messageIds: ["xyz"], markAs: "read" }),
      }),
      403,
    );

    await expect(
      "POST  /api/gmail/bulk-archive             [edit-required]",
      v("/api/gmail/bulk-archive", {
        method: "POST",
        body:   JSON.stringify({ asAccountId: ctx.fixtureAccountId, threadIds: ["xyz"] }),
      }),
      403,
    );

    await expect(
      "POST  /api/gmail/send                     [edit-required]",
      v("/api/gmail/send", {
        method: "POST",
        body:   JSON.stringify({ asAccountId: ctx.fixtureAccountId, to: "x@example.com", subject: "x", body: "x" }),
      }),
      403,
    );

    // ── 2. Read routes — view-only viewer should still get 200 ──────────
    console.log("\n── view-only viewer → 200 on read routes ──");
    await expect("GET  /api/gmail/accounts                  [read]", v("/api/gmail/accounts"), 200);
    await expect(
      `GET  /api/gmail/messages?asAccountId=${ctx.fixtureAccountId}    [read]`,
      v(`/api/gmail/messages?asAccountId=${ctx.fixtureAccountId}&limit=5`),
      200,
    );
    await expect(
      `GET  /api/gmail/threads?asAccountId=${ctx.fixtureAccountId}     [read]`,
      v(`/api/gmail/threads?asAccountId=${ctx.fixtureAccountId}&limit=5`),
      200,
    );

    // ── 3. Sync/watch admin/owner routes — viewer must be denied ────────
    console.log("\n── view-only viewer → 403 on owner/admin sync + watch routes ──");
    await expect(
      `POST /api/gmail/accounts/${ctx.fixtureAccountId}/resync        [owner|admin]`,
      v(`/api/gmail/accounts/${ctx.fixtureAccountId}/resync`, { method: "POST" }),
      403,
    );
    await expect(
      `POST /api/gmail/accounts/${ctx.fixtureAccountId}/sync-toggle   [owner|admin]`,
      v(`/api/gmail/accounts/${ctx.fixtureAccountId}/sync-toggle`, {
        method: "POST",
        body:   JSON.stringify({ enabled: true }),
      }),
      403,
    );
    await expect(
      `POST /api/gmail/accounts/${ctx.fixtureAccountId}/disconnect    [owner|admin]`,
      v(`/api/gmail/accounts/${ctx.fixtureAccountId}/disconnect`, { method: "POST" }),
      403,
    );
    await expect(
      `GET  /api/gmail/accounts/${ctx.fixtureAccountId}/access        [owner|admin]`,
      v(`/api/gmail/accounts/${ctx.fixtureAccountId}/access`),
      403,
    );

    // ── 4. Owner/admin (Trevor) keeps expected access ──────────────────
    console.log("\n── owner/admin (trevor, master_admin) → expected access ──");
    const adminCookie = await login(ADMIN_EMAIL, ADMIN_PWD);
    const a = authed(adminCookie);

    await expect("GET  /api/gmail/accounts                  [admin read]", a("/api/gmail/accounts"), 200);
    await expect(
      `GET  /api/gmail/accounts/${ctx.fixtureAccountId}/access        [owner|admin]`,
      a(`/api/gmail/accounts/${ctx.fixtureAccountId}/access`),
      200,
    );
    await expect(
      `POST /api/gmail/accounts/${ctx.fixtureAccountId}/sync-toggle   [owner|admin]`,
      a(`/api/gmail/accounts/${ctx.fixtureAccountId}/sync-toggle`, {
        method: "POST",
        body:   JSON.stringify({ enabled: true }),
      }),
      200,
    );

    // Owner pass-through: admin/owner calling toggle-star on the fixture account.
    // Anything that is NOT 403 means the Phase 4 guard correctly allowed the owner.
    // 503 = Gmail upstream error (no real Gmail connected), 400 = schema, 200 = success.
    const starRes = await a(`/api/gmail/messages/${ctx.fixtureMessageDbId}/toggle-star`, {
      method: "POST",
      body:   JSON.stringify({ asAccountId: ctx.fixtureAccountId }),
    });
    if (starRes.status === 403) {
      bad("POST /api/gmail/messages/:id/toggle-star [owner pass-through] → 403 (guard wrongly denied owner)");
    } else {
      ok(`POST /api/gmail/messages/:id/toggle-star [owner pass-through] → ${starRes.status} (not 403 = guard allowed owner)`);
    }

  } finally {
    await teardown(client, ctx);
    await client.end();
    console.log("\nTeardown complete.");
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
  if (failed > 0) {
    console.error(`\n❌ ${failed} test(s) FAILED`);
    process.exit(1);
  }
  console.log(`\n✅ All ${passed} tests PASSED`);
  process.exit(0);
}

run().catch((err) => {
  console.error("Test runner error:", err.message);
  process.exit(1);
});
