/**
 * tests/inactive-send-guard-runtime.test.cjs
 *
 * RUNTIME HTTP tests for the inactive-mailbox send guard.
 * Uses direct DB inserts for fixture setup (same pattern as
 * disconnected-mailbox-sidebar.test.cjs) then exercises the live
 * POST /api/gmail/send endpoint.
 *
 *  G1  Active owned mailbox passes the isActive guard (no reconnectRequired 403)
 *  G2  Inactive owned mailbox → 403
 *  G3  Inactive: JSON body contains reconnectRequired=true
 *  G4  Inactive: JSON body contains correct accountId
 *  G5  Inactive: guard message indicates disconnected (not a Gmail API error)
 *  G6  Non-owner send attempt on inactive private account → 403
 *  G7  Non-owner 403 is NOT reconnectRequired (different code path)
 *  G8  New-compose (no threadId): inactive → 403 + reconnectRequired
 *  G9  Reply (threadId present): inactive → 403 + reconnectRequired
 *  G10 Forward (isForward=true): inactive → 403 + reconnectRequired
 *  G11 Active shared team inbox: view-only fixture blocked by EDIT guard, not isActive guard
 */

"use strict";

const { fixtureEmail, assertTestEnvironment } = require("./test-safety.cjs");

assertTestEnvironment();

const BASE = "http://localhost:5000";

let passed = 0;
let failed = 0;

function check(label, ok, detail = "") {
  if (ok) { console.log(`  ✓ ${label}`); passed++; }
  else    { console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`); failed++; }
}

async function post(path, body, jar) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: BASE,
      ...(jar ? { Cookie: jar } : {}),
    },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await r.json(); } catch (_) {}
  return { status: r.status, json };
}

async function get(path, jar) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { Origin: BASE, ...(jar ? { Cookie: jar } : {}) },
  });
  let json = null;
  try { json = await r.json(); } catch (_) {}
  return { status: r.status, json };
}

async function login(email, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`Login ${email}: ${r.status}`);
  const c = r.headers.get("set-cookie")?.match(/(connect\.sid=[^;]+)/)?.[1];
  if (!c) throw new Error("No session cookie");
  await new Promise(resolve => setTimeout(resolve, 250));
  return c;
}

function sendPayload(extra = {}) {
  return {
    to: "recipient@example.invalid",
    subject: "Guard runtime test",
    body: "<p>Guard runtime test body</p>",
    ...extra,
  };
}

(async () => {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.log("[inactive-send-guard-runtime] DATABASE_URL not set — skipping runtime tests");
    process.exit(0);
  }

  // Check server liveness
  try {
    const probe = await fetch(`${BASE}/api/auth/me`, { signal: AbortSignal.timeout(3000) });
    if (!probe.ok && probe.status !== 401) throw new Error(`status ${probe.status}`);
  } catch (e) {
    console.log(`[inactive-send-guard-runtime] Server not reachable (${e.message}) — skipping`);
    process.exit(0);
  }

  const { default: pg }     = await import("pg");
  const { default: bcrypt } = await import("bcryptjs");

  const pool   = new pg.Pool({ connectionString: dbUrl });
  const client = await pool.connect();

  const TAG              = `isguard-${Date.now()}`;
  const OWNER_EMAIL      = fixtureEmail("isguard", "owner");
  const NONOWNER_EMAIL   = fixtureEmail("isguard", "nonowner");
  const INACTIVE_EMAIL   = fixtureEmail("isguard", "inactive");
  const OWNER_PWD        = `ownerPwd-${TAG}`;
  const NONOWNER_PWD     = `nonownerPwd-${TAG}`;

  let ownerUserId    = null;
  let nonownerUserId = null;
  let inactiveAcctId = null;
  let ownerCookie    = null;
  let nonownerCookie = null;
  let activeAcctId   = null;     // ID of an active shared account for G11

  console.log(`\n[Setup] TAG=${TAG}`);

  try {
    const pwdHashOwner    = await bcrypt.hash(OWNER_PWD,    10);
    const pwdHashNonowner = await bcrypt.hash(NONOWNER_PWD, 10);

    // Create fixture owner user
    const ownerRow = await client.query(
      `INSERT INTO users (name, email, password, role, status, must_change_password, permissions)
       VALUES ($1, $2, $3, 'member', 'active', false,
         '{"crm":"none","quoting":"none","support":"none","calendar":"none","projects":"none",
           "knowledge":"none","mail_team":{},"partnerships":"none",
           "calendar_team":[],"team_workload":"none","communications":"none"}'::jsonb)
       RETURNING id`,
      [`OwnerFixture ${TAG}`, OWNER_EMAIL, pwdHashOwner],
    );
    ownerUserId = ownerRow.rows[0].id;

    // Create fixture non-owner user
    const nonRow = await client.query(
      `INSERT INTO users (name, email, password, role, status, must_change_password, permissions)
       VALUES ($1, $2, $3, 'member', 'active', false,
         '{"crm":"none","quoting":"none","support":"none","calendar":"none","projects":"none",
           "knowledge":"none","mail_team":{},"partnerships":"none",
           "calendar_team":[],"team_workload":"none","communications":"none"}'::jsonb)
       RETURNING id`,
      [`NonOwnerFixture ${TAG}`, NONOWNER_EMAIL, pwdHashNonowner],
    );
    nonownerUserId = nonRow.rows[0].id;

    // Create an INACTIVE private_personal account owned by the owner
    const inactRow = await client.query(
      `INSERT INTO email_accounts
         (user_id, email_address, display_name, provider, auth_status,
          is_active, is_shared, visibility_type, sync_enabled)
       VALUES ($1, $2, $3, 'gmail', 'expired', false, false, 'private_personal', false)
       RETURNING id`,
      [ownerUserId, INACTIVE_EMAIL, `Inactive fixture ${TAG}`],
    );
    inactiveAcctId = inactRow.rows[0].id;

    console.log(`  ownerUserId=${ownerUserId} nonownerUserId=${nonownerUserId} inactiveAcctId=${inactiveAcctId}`);

    ownerCookie    = await login(OWNER_EMAIL,    OWNER_PWD);
    nonownerCookie = await login(NONOWNER_EMAIL, NONOWNER_PWD);

    // Find an active account accessible to the owner (use a shared team inbox)
    const accts = await get("/api/gmail/accounts", ownerCookie);
    const active = (accts.json || []).find(a => a.isActive === true);
    activeAcctId = active?.id ?? null;

    // ── G1: Active account passes the isActive guard ──────────────────────────
    console.log("\n[G1] Active owned/accessible account — passes isActive guard");
    if (activeAcctId) {
      const r = await post("/api/gmail/send", sendPayload({ asAccountId: activeAcctId }), ownerCookie);
      check(
        "G1: active account send does NOT return reconnectRequired",
        r.json?.reconnectRequired !== true,
        `status=${r.status} body=${JSON.stringify(r.json)?.slice(0, 120)}`,
      );
      check(
        "G1b: active account not blocked by isActive guard (no 403+reconnectRequired)",
        !(r.status === 403 && r.json?.reconnectRequired === true),
        `got status=${r.status}`,
      );
    } else {
      console.log("  ⚠ No active account found for owner fixture — G1 owner-active path skipped");
    }

    // ── G2–G5, G8–G10: Inactive account → 403 + reconnectRequired ────────────
    console.log("\n[G2–G5, G8–G10] Inactive account → 403 + reconnectRequired");

    // G8/G2: new-compose
    const r8 = await post("/api/gmail/send", sendPayload({ asAccountId: inactiveAcctId }), ownerCookie);
    check("G8/G2: new-compose inactive → 403",              r8.status === 403,                         `got ${r8.status}`);
    check("G3:    JSON contains reconnectRequired=true",     r8.json?.reconnectRequired === true,       JSON.stringify(r8.json));
    check("G4:    JSON contains correct accountId",          r8.json?.accountId === inactiveAcctId,     `got ${r8.json?.accountId}`);
    check("G5:    message says disconnected (not Gmail err)", r8.json?.message?.includes("disconnected"), r8.json?.message);

    // G9: reply
    const r9 = await post("/api/gmail/send",
      sendPayload({ asAccountId: inactiveAcctId, threadId: "fake-thread-guard-test" }),
      ownerCookie,
    );
    check("G9:  reply inactive → 403",                  r9.status === 403,                    `got ${r9.status}`);
    check("G9b: reply reconnectRequired=true",          r9.json?.reconnectRequired === true);

    // G10: forward
    const r10 = await post("/api/gmail/send",
      sendPayload({ asAccountId: inactiveAcctId, isForward: true }),
      ownerCookie,
    );
    check("G10:  forward inactive → 403",               r10.status === 403,                   `got ${r10.status}`);
    check("G10b: forward reconnectRequired=true",       r10.json?.reconnectRequired === true);

    // ── G6–G7: Non-owner cannot send through inactive private mailbox ─────────
    console.log("\n[G6–G7] Non-owner → 403, but NOT reconnectRequired");
    const r6 = await post("/api/gmail/send", sendPayload({ asAccountId: inactiveAcctId }), nonownerCookie);
    check(
      "G6:  non-owner send on inactive private → 403",
      r6.status === 403,
      `got ${r6.status} body=${JSON.stringify(r6.json)?.slice(0, 80)}`,
    );
    check(
      "G7:  non-owner 403 is NOT reconnectRequired (resolveAccount returns null for non-owner)",
      r6.json?.reconnectRequired !== true,
      JSON.stringify(r6.json),
    );

    // ── G11: Active team inbox — view-only blocked by EDIT guard, not isActive ─
    console.log("\n[G11] Active team inbox — view-only blocked by edit guard, not isActive guard");
    {
      const allAccts = await get("/api/gmail/accounts", ownerCookie);
      const teamAcct = (allAccts.json || []).find(a => a.isShared === true && a.isActive === true);
      if (teamAcct) {
        const r11 = await post("/api/gmail/send", sendPayload({ asAccountId: teamAcct.id }), nonownerCookie);
        check(
          "G11: view-only non-owner on active team inbox → 403",
          r11.status === 403,
          `got ${r11.status}`,
        );
        check(
          "G11b: team inbox block is NOT reconnectRequired (edit-access guard path)",
          r11.json?.reconnectRequired !== true,
          JSON.stringify(r11.json),
        );
      } else {
        console.log("  ⚠ No shared active account visible to fixture — G11 skipped");
      }
    }

  } catch (e) {
    console.error("Fatal error:", e.message);
    failed++;
  } finally {
    // Teardown
    try {
      if (inactiveAcctId) await client.query("DELETE FROM email_accounts WHERE id = $1", [inactiveAcctId]);
      if (ownerUserId)    await client.query("DELETE FROM users WHERE id = $1",           [ownerUserId]);
      if (nonownerUserId) await client.query("DELETE FROM users WHERE id = $1",           [nonownerUserId]);
      console.log("  Fixtures cleaned up.");
    } catch (e2) {
      console.error("Teardown error:", e2.message);
    }
    client.release();
    await pool.end();

    console.log(`\n  Passed: ${passed}  Failed: ${failed}`);
    process.exit(failed > 0 ? 1 : 0);
  }
})();
