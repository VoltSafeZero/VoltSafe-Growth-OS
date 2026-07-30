#!/usr/bin/env node
/**
 * Mailbox Switching Regression Test
 *
 * Reproduces and pins the bug where clicking your personal inbox would
 * silently show another mailbox's data because:
 *   (1) `getUserGmailAccount` did not filter is_shared=false, so a team
 *       inbox connected by the same user could win the LIMIT 1 race.
 *   (2) `resolveAccount`'s default branch returned `accountId: undefined`,
 *       so `local-mailbox.ts` fell through to `owner_user_id = userId` and
 *       returned messages from EVERY account that user owned.
 *
 * ISOLATION STRATEGY (safe — no real account mutation):
 *   Creates a wholly isolated fixture user (email ending @example.invalid)
 *   whose only email_accounts are the two fixture mailboxes created for this
 *   test.  Because the fixture user has NO competing real accounts,
 *   getUserGmailAccount() unambiguously returns the fixture personal account
 *   without needing to deactivate any real rows.  The fixture user and both
 *   fixture accounts are deleted in teardown whether the test passes or fails.
 *
 * Run: node tests/mailbox-switching.test.js
 * Requires the app running at localhost:5000.
 */

import pg        from "pg";
import bcrypt    from "bcryptjs";
import { fixtureEmail, assertTestEnvironment } from "./test-safety.cjs";

assertTestEnvironment();

const BASE        = "http://localhost:5000";
const FIXTURE_TAG = "mbswitch-" + Date.now();

// Fixture email addresses — all @example.invalid (safe, unreachable, clearly test data)
const FIXTURE_USER_EMAIL     = fixtureEmail("mbswitch", "user");
const FAKE_PERSONAL_EMAIL    = fixtureEmail("mbswitch", "personal");
const FAKE_TEAM_EMAIL        = fixtureEmail("mbswitch", "team");
const FIXTURE_USER_PWD       = "mbswitch-test-pwd-" + Date.now();

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
  headers: { "Content-Type": "application/json", Cookie: cookie, ...(opts.headers || {}) },
});

/**
 * Setup: create a fixture user + two fixture mailboxes owned by that user.
 *
 * No real user rows are modified.  No real email_account rows are deactivated.
 * getUserGmailAccount(fixtureUserId) returns the fixture personal account
 * because it is the only non-shared active account for that user.
 */
async function setup(client) {
  // 1) Create the fixture user.
  const pwdHash = await bcrypt.hash(FIXTURE_USER_PWD, 10);
  const userRes = await client.query(
    `INSERT INTO users
       (name, email, password, role, status, must_change_password, permissions)
     VALUES
       ($1, $2, $3, 'read-only', 'active', false,
        '{"crm":"none","quoting":"none","support":"none","calendar":"none","projects":"none","knowledge":"none","mail_team":{},"partnerships":"none","calendar_team":[],"team_workload":"none","communications":"none"}'::jsonb)
     RETURNING id`,
    [`MBSwitch Fixture ${FIXTURE_TAG}`, FIXTURE_USER_EMAIL, pwdHash],
  );
  const fixtureUserId = userRes.rows[0].id;

  // 2) Create the fixture personal account (is_shared=false, is_active=true).
  //    workspace_id=1 matches the dev workspace so session-resolution works.
  const personalIns = await client.query(
    `INSERT INTO email_accounts
       (user_id, workspace_id, provider, email_address, display_name,
        auth_status, is_shared, refresh_token, is_active)
     VALUES ($1, 1, 'gmail', $2, 'MBSwitch Fixture Personal',
             'active', false, $3, true)
     RETURNING id`,
    [fixtureUserId, FAKE_PERSONAL_EMAIL, `fake-refresh-personal-${FIXTURE_TAG}`],
  );
  const personalAccountId = personalIns.rows[0].id;

  // 3) Create the fixture team inbox (is_shared=true, is_active=true).
  const teamIns = await client.query(
    `INSERT INTO email_accounts
       (user_id, workspace_id, provider, email_address, display_name,
        auth_status, is_shared, refresh_token, is_active)
     VALUES ($1, 1, 'gmail', $2, 'MBSwitch Fixture Team',
             'active', true, $3, true)
     RETURNING id`,
    [fixtureUserId, FAKE_TEAM_EMAIL, `fake-refresh-team-${FIXTURE_TAG}`],
  );
  const teamAccountId = teamIns.rows[0].id;

  // 4) Insert one message per account.
  //    is_inbox=true required so buildQClauses "in:inbox" finds them.
  await client.query(
    `INSERT INTO email_messages
       (gmail_message_id, gmail_thread_id, subject, from_email, sent_at,
        snippet, owner_user_id, source_account_id, direction, label_ids,
        is_inbox, is_unread, is_starred, is_spam, is_trash, is_draft, is_sent, smart_category)
     VALUES ($1, $2, $3, 'sender@personal.example.invalid', NOW(),
             'personal mailbox sentinel', $4, $5, 'inbound', '["INBOX"]',
             true, false, false, false, false, false, false, 'people')`,
    [
      `${FIXTURE_TAG}-personal-msg`,
      `${FIXTURE_TAG}-personal-thr`,
      `MBSWITCH PERSONAL ${FIXTURE_TAG}`,
      fixtureUserId,
      personalAccountId,
    ],
  );
  await client.query(
    `INSERT INTO email_messages
       (gmail_message_id, gmail_thread_id, subject, from_email, sent_at,
        snippet, owner_user_id, source_account_id, direction, label_ids,
        is_inbox, is_unread, is_starred, is_spam, is_trash, is_draft, is_sent, smart_category)
     VALUES ($1, $2, $3, 'sender@team.example.invalid', NOW(),
             'team mailbox sentinel', $4, $5, 'inbound', '["INBOX"]',
             true, false, false, false, false, false, false, 'people')`,
    [
      `${FIXTURE_TAG}-team-msg`,
      `${FIXTURE_TAG}-team-thr`,
      `MBSWITCH TEAM ${FIXTURE_TAG}`,
      fixtureUserId,
      teamAccountId,
    ],
  );

  return { fixtureUserId, personalAccountId, teamAccountId };
}

async function teardown(client, ctx) {
  if (!ctx) return;
  // Delete in dependency order.
  await client.query(
    `DELETE FROM email_messages WHERE gmail_message_id LIKE $1`,
    [`${FIXTURE_TAG}-%`],
  );
  if (ctx.teamAccountId) {
    await client.query(`DELETE FROM email_accounts WHERE id = $1`, [ctx.teamAccountId]);
  }
  if (ctx.personalAccountId) {
    await client.query(`DELETE FROM email_accounts WHERE id = $1`, [ctx.personalAccountId]);
  }
  if (ctx.fixtureUserId) {
    await client.query(`DELETE FROM users WHERE id = $1`, [ctx.fixtureUserId]);
  }
}

async function fetchLocalMessages(call, params) {
  const qs = new URLSearchParams({ limit: "100", q: "in:inbox", source: "local", ...params });
  const res = await call(`/api/gmail/messages?${qs}`);
  if (!res.ok) throw new Error(`/api/gmail/messages -> ${res.status}`);
  const json = await res.json();
  return json.messages || [];
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL not set");
  const pool   = new pg.Pool({ connectionString: dbUrl });
  const client = await pool.connect();

  console.log("=== Mailbox Switching Regression Test ===");
  console.log(`Fixture tag:  ${FIXTURE_TAG}`);
  console.log(`Fixture user: ${FIXTURE_USER_EMAIL}`);
  let ctx = null;
  try {
    ctx = await setup(client);
    console.log(
      `Setup: fixture user id=${ctx.fixtureUserId}, ` +
      `personal id=${ctx.personalAccountId}, team id=${ctx.teamAccountId}`,
    );

    // Login as the fixture user — no real user credentials involved.
    const cookie = await login(FIXTURE_USER_EMAIL, FIXTURE_USER_PWD);
    const call   = authed(cookie);

    // ── 1. Default (no asAccountId) → must resolve to PERSONAL account only ──
    // getUserGmailAccount(fixtureUserId) finds only the fixture personal account
    // (is_shared=false, is_active=true) because the fixture user has no other
    // non-shared active accounts — no real-account interference possible.
    console.log("\n── Default (no asAccountId) returns ONLY personal-account messages ──");
    {
      const msgs           = await fetchLocalMessages(call, {});
      const fixturePersonal = msgs.filter((m) => m.id === `${FIXTURE_TAG}-personal-msg`);
      const fixtureTeam     = msgs.filter((m) => m.id === `${FIXTURE_TAG}-team-msg`);
      const leakage         = msgs.filter((m) => m.sourceAccountId != null && m.sourceAccountId !== ctx.personalAccountId);

      if (fixturePersonal.length === 1) ok("personal-account fixture message present");
      else bad("personal-account fixture message present", `found ${fixturePersonal.length}`);

      if (fixtureTeam.length === 0) ok("team-inbox fixture message correctly EXCLUDED");
      else bad("team-inbox fixture message correctly EXCLUDED",
               `LEAKED ${fixtureTeam.length} team rows when no asAccountId given`);

      if (leakage.length === 0) ok("no rows from any account other than personal leaked");
      else bad("no rows from any account other than personal leaked",
               `${leakage.length} foreign rows (sample ids: ${[...new Set(leakage.map(m => m.sourceAccountId))].slice(0, 5).join(",")})`);
    }

    // ── 2. Explicit asAccountId=personal → identical result ──
    console.log("\n── Explicit asAccountId=personalAccountId returns same personal-only set ──");
    {
      const msgs           = await fetchLocalMessages(call, { asAccountId: String(ctx.personalAccountId) });
      const fixturePersonal = msgs.filter((m) => m.id === `${FIXTURE_TAG}-personal-msg`);
      const fixtureTeam     = msgs.filter((m) => m.id === `${FIXTURE_TAG}-team-msg`);
      const leakage         = msgs.filter((m) => m.sourceAccountId != null && m.sourceAccountId !== ctx.personalAccountId);
      if (fixturePersonal.length === 1 && fixtureTeam.length === 0 && leakage.length === 0)
        ok("explicit personal selection scoped correctly");
      else
        bad("explicit personal selection scoped correctly",
            `personal=${fixturePersonal.length}, team rows=${fixtureTeam.length}, foreign rows=${leakage.length}`);
    }

    // ── 3. Explicit asAccountId=teamAccountId → returns ONLY team rows ──
    console.log("\n── Explicit asAccountId=teamAccountId returns ONLY team-inbox messages ──");
    {
      const msgs           = await fetchLocalMessages(call, { asAccountId: String(ctx.teamAccountId) });
      const fixtureTeam     = msgs.filter((m) => m.id === `${FIXTURE_TAG}-team-msg`);
      const fixturePersonal = msgs.filter((m) => m.id === `${FIXTURE_TAG}-personal-msg`);
      const leakage         = msgs.filter((m) => m.sourceAccountId != null && m.sourceAccountId !== ctx.teamAccountId);

      if (fixtureTeam.length === 1) ok("team-inbox fixture message present when explicitly selected");
      else bad("team-inbox fixture message present when explicitly selected", `found ${fixtureTeam.length}`);

      if (fixturePersonal.length === 0) ok("personal-account row correctly EXCLUDED from team-inbox view");
      else bad("personal-account row correctly EXCLUDED from team-inbox view",
               `LEAKED ${fixturePersonal.length} personal rows`);

      if (leakage.length === 0) ok("no rows from any account other than team leaked");
      else bad("no rows from any account other than team leaked", `${leakage.length} foreign rows`);
    }

    // ── 4. Round-trip: default → team → default ──
    console.log("\n── Round-trip switch: default → team → default ──");
    {
      const a = await fetchLocalMessages(call, {});
      const b = await fetchLocalMessages(call, { asAccountId: String(ctx.teamAccountId) });
      const c = await fetchLocalMessages(call, {});

      const aIds = new Set(a.map((m) => m.id));
      const bIds = new Set(b.map((m) => m.id));
      const cIds = new Set(c.map((m) => m.id));

      const personalIn = (s) => s.has(`${FIXTURE_TAG}-personal-msg`);
      const teamIn     = (s) => s.has(`${FIXTURE_TAG}-team-msg`);

      if (personalIn(aIds) && !teamIn(aIds)) ok("first default call: personal yes, team no");
      else bad("first default call: personal yes, team no",
               `personalIn=${personalIn(aIds)}, teamIn=${teamIn(aIds)}`);
      if (teamIn(bIds) && !personalIn(bIds)) ok("team selection: team yes, personal no");
      else bad("team selection: team yes, personal no",
               `teamIn=${teamIn(bIds)}, personalIn=${personalIn(bIds)}`);
      if (personalIn(cIds) && !teamIn(cIds)) ok("post-switch default call: personal yes, team no");
      else bad("post-switch default call: personal yes, team no",
               `personalIn=${personalIn(cIds)}, teamIn=${teamIn(cIds)}`);
    }

    // ── 5. Expired/absent session → 401 (no stale data) ──
    console.log("\n── Expired/absent session cookie → 401 on messages and category-counts ──");
    {
      const noAuthCall = (url) => fetch(`${BASE}${url}`, {
        headers: { "Content-Type": "application/json" },
      });

      const msgsRes = await noAuthCall(
        `/api/gmail/messages?limit=50&q=in:inbox&source=local&asAccountId=${ctx.personalAccountId}`,
      );
      if (msgsRes.status === 401) ok("/api/gmail/messages returns 401 when session is absent");
      else bad("/api/gmail/messages returns 401 when session is absent",
               `got ${msgsRes.status} instead`);

      const ccRes = await noAuthCall(
        `/api/gmail/category-counts?asAccountId=${ctx.personalAccountId}`,
      );
      if (ccRes.status === 401) ok("/api/gmail/category-counts returns 401 when session is absent");
      else bad("/api/gmail/category-counts returns 401 when session is absent",
               `got ${ccRes.status} instead`);

      const msgsBody = await msgsRes.json().catch(() => null);
      if (msgsBody && !msgsBody.messages) ok("401 body contains no 'messages' array (no stale data leaked)");
      else bad("401 body contains no 'messages' array (no stale data leaked)",
               `body=${JSON.stringify(msgsBody)?.slice(0, 120)}`);
    }

  } finally {
    try { await teardown(client, ctx); } catch (e) { console.warn("teardown error:", e.message); }
    client.release();
    await pool.end();
  }

  console.log("==================================================");
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
  if (failed > 0) {
    console.error("❌ FAILED");
    process.exit(1);
  } else {
    console.log("✅ All checks PASSED");
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
