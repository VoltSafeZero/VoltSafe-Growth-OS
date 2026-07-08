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
 *       returned messages from EVERY account that user owned, including
 *       team inboxes — drowning out the personal inbox.
 *
 * This test fabricates a second email_account owned by the admin user with
 * is_shared=true plus distinct email_messages rows, then asserts that
 * GET /api/gmail/messages with NO asAccountId returns ONLY personal-account
 * rows. Snapshot/restore for full isolation. NO schema changes.
 *
 * Run: node tests/mailbox-switching.test.js
 * Requires the app running at localhost:5000.
 */

import pg from "pg";

const BASE = "http://localhost:5000";
const ADMIN_EMAIL = "trevor@voltsafe.com";
const ADMIN_PWD = "alberni1444";
const ADMIN_USER_ID = 4;
const PERSONAL_ACCOUNT_ID = 1; // trevor@voltsafe.com

const FIXTURE_TAG = "mbswitch-test-" + Date.now();
const FAKE_TEAM_EMAIL = `${FIXTURE_TAG}-team@voltsafe.invalid`;

let passed = 0;
let failed = 0;
const ok = (l) => { console.log(`  \u2713 ${l}`); passed++; };
const bad = (l, d) => { console.error(`  \u2717 ${l}${d ? ` \u2014 ${d}` : ""}`); failed++; };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": BASE },
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
  headers: { "Content-Type": "application/json", Cookie: cookie, ...(opts.headers || {}) },
});

async function setup(client) {
  // 1) Create a fake "team inbox" owned by trevor (user_id=4, is_shared=true).
  const ins = await client.query(
    `INSERT INTO email_accounts
       (user_id, provider, email_address, display_name, auth_status, is_shared, refresh_token, is_active)
     VALUES ($1, 'gmail', $2, 'MBSwitch Fake Team', 'active', true, 'fake-refresh-token-mbswitch', true)
     RETURNING id`,
    [ADMIN_USER_ID, FAKE_TEAM_EMAIL]
  );
  const teamAccountId = ins.rows[0].id;

  // 2) Insert one personal-account message and one team-account message.
  // Phase 3: buildQClauses now uses is_inbox=true (derived column) instead of
  // label_ids ILIKE '%"INBOX"%'. Fixtures must set is_inbox=true so they
  // appear in q=in:inbox queries, which is what fetchLocalMessages uses.
  await client.query(
    `INSERT INTO email_messages
       (gmail_message_id, gmail_thread_id, subject, from_email, sent_at,
        snippet, owner_user_id, source_account_id, direction, label_ids,
        is_inbox, is_unread, is_starred, is_spam, is_trash, is_draft, is_sent, smart_category)
     VALUES
       ($1, $2, $3, 'someone@personal.example.com', NOW(),
        'personal mailbox sentinel', $4, $5, 'inbound', '["INBOX"]',
        true, false, false, false, false, false, false, 'people')`,
    [`${FIXTURE_TAG}-personal-msg`, `${FIXTURE_TAG}-personal-thr`,
     `MBSWITCH PERSONAL ${FIXTURE_TAG}`, ADMIN_USER_ID, PERSONAL_ACCOUNT_ID]
  );
  await client.query(
    `INSERT INTO email_messages
       (gmail_message_id, gmail_thread_id, subject, from_email, sent_at,
        snippet, owner_user_id, source_account_id, direction, label_ids,
        is_inbox, is_unread, is_starred, is_spam, is_trash, is_draft, is_sent, smart_category)
     VALUES
       ($1, $2, $3, 'someone@team.example.com', NOW(),
        'team mailbox sentinel', $4, $5, 'inbound', '["INBOX"]',
        true, false, false, false, false, false, false, 'people')`,
    [`${FIXTURE_TAG}-team-msg`, `${FIXTURE_TAG}-team-thr`,
     `MBSWITCH TEAM ${FIXTURE_TAG}`, ADMIN_USER_ID, teamAccountId]
  );

  return { teamAccountId };
}

async function teardown(client, ctx) {
  await client.query(`DELETE FROM email_messages WHERE gmail_message_id LIKE $1`, [`${FIXTURE_TAG}-%`]);
  if (ctx?.teamAccountId) {
    await client.query(`DELETE FROM email_accounts WHERE id = $1`, [ctx.teamAccountId]);
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
  const pool = new pg.Pool({ connectionString: dbUrl });
  const client = await pool.connect();

  console.log("=== Mailbox Switching Regression Test ===");
  let ctx = null;
  try {
    ctx = await setup(client);
    console.log(`Setup: fake team inbox id=${ctx.teamAccountId}, fixture tag=${FIXTURE_TAG}`);

    const cookie = await login(ADMIN_EMAIL, ADMIN_PWD);
    const call = authed(cookie);

    // ── 1. Default (no asAccountId) → must resolve to PERSONAL account only ──
    console.log("── Default (no asAccountId) returns ONLY personal-account messages ──");
    {
      const msgs = await fetchLocalMessages(call, {});
      const fixturePersonal = msgs.filter((m) => m.id === `${FIXTURE_TAG}-personal-msg`);
      const fixtureTeam     = msgs.filter((m) => m.id === `${FIXTURE_TAG}-team-msg`);
      const leakage = msgs.filter((m) => m.sourceAccountId != null && m.sourceAccountId !== PERSONAL_ACCOUNT_ID);

      if (fixturePersonal.length === 1) ok("personal-account fixture message present");
      else bad("personal-account fixture message present", `found ${fixturePersonal.length}`);

      if (fixtureTeam.length === 0) ok("team-inbox fixture message correctly EXCLUDED");
      else bad("team-inbox fixture message correctly EXCLUDED",
               `LEAKED ${fixtureTeam.length} team rows when no asAccountId given`);

      if (leakage.length === 0) ok("no rows from any account other than personal leaked");
      else bad("no rows from any account other than personal leaked",
               `${leakage.length} foreign rows (sample sourceAccountIds: ${[...new Set(leakage.map(m=>m.sourceAccountId))].slice(0,5).join(",")})`);
    }

    // ── 2. Explicit asAccountId=personal → identical result ──
    console.log("── Explicit asAccountId=PERSONAL_ACCOUNT_ID returns same personal-only set ──");
    {
      const msgs = await fetchLocalMessages(call, { asAccountId: String(PERSONAL_ACCOUNT_ID) });
      const fixtureTeam = msgs.filter((m) => m.id === `${FIXTURE_TAG}-team-msg`);
      const leakage = msgs.filter((m) => m.sourceAccountId != null && m.sourceAccountId !== PERSONAL_ACCOUNT_ID);
      if (fixtureTeam.length === 0 && leakage.length === 0)
        ok("explicit personal selection scoped correctly");
      else
        bad("explicit personal selection scoped correctly",
            `team rows=${fixtureTeam.length}, foreign rows=${leakage.length}`);
    }

    // ── 3. Explicit asAccountId=teamAccountId → returns ONLY team rows ──
    console.log("── Explicit asAccountId=teamAccountId returns ONLY team-inbox messages ──");
    {
      const msgs = await fetchLocalMessages(call, { asAccountId: String(ctx.teamAccountId) });
      const fixtureTeam     = msgs.filter((m) => m.id === `${FIXTURE_TAG}-team-msg`);
      const fixturePersonal = msgs.filter((m) => m.id === `${FIXTURE_TAG}-personal-msg`);
      const leakage = msgs.filter((m) => m.sourceAccountId != null && m.sourceAccountId !== ctx.teamAccountId);

      if (fixtureTeam.length === 1) ok("team-inbox fixture message present when explicitly selected");
      else bad("team-inbox fixture message present when explicitly selected", `found ${fixtureTeam.length}`);

      if (fixturePersonal.length === 0) ok("personal-account row correctly EXCLUDED from team-inbox view");
      else bad("personal-account row correctly EXCLUDED from team-inbox view",
               `LEAKED ${fixturePersonal.length} personal rows`);

      if (leakage.length === 0) ok("no rows from any account other than team leaked");
      else bad("no rows from any account other than team leaked", `${leakage.length} foreign rows`);
    }

    // ── 4b. asAccountId=all MUST show both personal + team messages ──
    // This is the root cause of the inbox isolation bug: when the personal inbox
    // accidentally sent asAccountId=all (instead of the specific personal account id),
    // the backend returned rows from ALL accounts the user owns — including team inboxes.
    // Fix: the frontend's appendAccountId() now sends the specific personal account id
    // for the null (personal) state, and only sends "all" for the explicit All Inboxes view.
    console.log("── asAccountId=all returns BOTH personal and team rows ──");
    {
      const msgs = await fetchLocalMessages(call, { asAccountId: "all" });
      const fixturePersonal = msgs.filter((m) => m.id === `${FIXTURE_TAG}-personal-msg`);
      const fixtureTeam     = msgs.filter((m) => m.id === `${FIXTURE_TAG}-team-msg`);

      if (fixturePersonal.length === 1) ok("asAccountId=all: personal fixture included (correct for All Inboxes)");
      else bad("asAccountId=all: personal fixture included", `found ${fixturePersonal.length}`);

      if (fixtureTeam.length === 1) ok("asAccountId=all: team fixture included (confirms bleed vector)");
      else bad("asAccountId=all: team fixture included", `found ${fixtureTeam.length}`);
    }

    // ── 4. Switching default ↔ team ↔ default returns deterministic, non-overlapping sets ──
    console.log("── Round-trip switch: default → team → default ──");
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
      else bad("first default call: personal yes, team no");
      if (teamIn(bIds) && !personalIn(bIds)) ok("team selection: team yes, personal no");
      else bad("team selection: team yes, personal no");
      if (personalIn(cIds) && !teamIn(cIds)) ok("post-switch default call: personal yes, team no");
      else bad("post-switch default call: personal yes, team no");
    }

  } finally {
    try { await teardown(client, ctx); } catch (e) { console.warn("teardown:", e.message); }
    client.release(); await pool.end();
  }

  console.log("==================================================");
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
  if (failed > 0) {
    console.error("\u274C FAILED");
    process.exit(1);
  } else {
    console.log("\u2705 All checks PASSED");
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
