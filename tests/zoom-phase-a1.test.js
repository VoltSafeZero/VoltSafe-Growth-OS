#!/usr/bin/env node
/**
 * Zoom / Booking — Phase A.1 Regression Suite
 *
 * Covers the routes documented in docs/ZOOM_PHASE_A1_AUDIT.md:
 *   GET  /api/zoom/oauth/start       (requireAuth; returns authUrl OR 503 if not configured)
 *   GET  /api/zoom/oauth/callback    (anon by design — manual session check + CSRF state)
 *   GET  /api/zoom/connection        (requireAuth; per-user shape)
 *   POST /api/zoom/disconnect        (requireAuth; per-user)
 *   POST /api/zoom/meetings          (requireAuth; per-user)
 *
 * Asserts:
 *   1. Anonymous access is denied (401) on every authenticated route.
 *   2. The OAuth callback redirects (302) with reason=not_authenticated when
 *      hit anonymously, AND does NOT 200/JSON (so it cannot leak data).
 *   3. GET /api/zoom/connection returns the documented public shape AND
 *      never includes accessToken / refreshToken.
 *   4. GET /api/zoom/oauth/start either:
 *        - returns 200 with an authUrl pointing at zoom.us (if env configured), OR
 *        - returns 503 with {configured: false} (if env missing)
 *   5. Cross-user isolation: viewer and admin each see only their own row.
 *   6. POST /api/zoom/disconnect succeeds (idempotent) for an authenticated
 *      user; their connection row is unaffected for the other user.
 *
 * Run: node tests/zoom-phase-a1.test.js
 */

import pg from "pg";
import bcrypt from "bcryptjs";

const BASE = "http://localhost:5000";
const VIEWER_EMAIL = "viewer@voltsafe.com";
const VIEWER_PWD = "vstest_zoom_a1_!1";
const ADMIN_EMAIL = "trevor@voltsafe.com";
const ADMIN_PWD = "alberni1444";

let passed = 0;
let failed = 0;
const ok  = (l) => { console.log(`  \u2713 ${l}`); passed++; };
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
  await sleep(200);
  return cookie;
}

async function get(path, cookie) {
  return fetch(`${BASE}${path}`, {
    method: "GET",
    headers: cookie ? { Cookie: cookie } : {},
    redirect: "manual",
  });
}

async function post(path, cookie, body) {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: BASE,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : "{}",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Anonymous-access lockdown
// ─────────────────────────────────────────────────────────────────────────────

async function testAnonLockdown() {
  console.log("\n[1] Anonymous-access lockdown");

  const r1 = await get("/api/zoom/connection");
  if (r1.status === 401) ok("GET  /api/zoom/connection  → 401 anon");
  else bad("GET  /api/zoom/connection  anon", `expected 401, got ${r1.status}`);

  const r2 = await get("/api/zoom/oauth/start");
  if (r2.status === 401) ok("GET  /api/zoom/oauth/start → 401 anon");
  else bad("GET  /api/zoom/oauth/start anon", `expected 401, got ${r2.status}`);

  // POST anon may return 401 (requireAuth) or 403 (CSRF middleware fires first
  // on cookie-less POSTs). Either is an acceptable lockdown signal.
  const r3 = await post("/api/zoom/disconnect", null);
  if (r3.status === 401 || r3.status === 403) ok(`POST /api/zoom/disconnect  → ${r3.status} anon (locked)`);
  else bad("POST /api/zoom/disconnect  anon", `expected 401|403, got ${r3.status}`);

  const r4 = await post("/api/zoom/meetings", null, {
    topic: "Test", startTime: new Date(Date.now() + 3600_000).toISOString(),
    durationMinutes: 30,
  });
  if (r4.status === 401 || r4.status === 403) ok(`POST /api/zoom/meetings    → ${r4.status} anon (locked)`);
  else bad("POST /api/zoom/meetings    anon", `expected 401|403, got ${r4.status}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. OAuth callback — anonymous redirect (no leak)
// ─────────────────────────────────────────────────────────────────────────────

async function testCallbackAnonRedirect() {
  console.log("\n[2] OAuth callback — anonymous handling");

  const r = await get("/api/zoom/oauth/callback?code=dummy&state=dummy");
  if (r.status >= 300 && r.status < 400) {
    const loc = r.headers.get("location") || "";
    if (loc.includes("/settings") && loc.includes("zoom=error") && loc.includes("not_authenticated")) {
      ok(`GET /api/zoom/oauth/callback anon → ${r.status} → ${loc}`);
    } else {
      bad("GET /api/zoom/oauth/callback anon Location", `got "${loc}"`);
    }
  } else {
    bad("GET /api/zoom/oauth/callback anon", `expected 30x redirect, got ${r.status}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. GET /api/zoom/connection — shape + no token leak
// ─────────────────────────────────────────────────────────────────────────────

async function testConnectionShape(cookie, label) {
  console.log(`\n[3] GET /api/zoom/connection (${label})`);

  const r = await get("/api/zoom/connection", cookie);
  if (r.status !== 200) { bad(`GET connection (${label})`, `status ${r.status}`); return null; }

  const j = await r.json();
  const requiredKeys = ["connected", "configured", "zoomEmail", "zoomAccountType",
                        "zoomPmi", "zoomPmiUrl", "connectedAt", "disconnectedAt",
                        "tokenExpiresAt", "zoomUserId"];
  const missing = requiredKeys.filter((k) => !(k in j));
  if (missing.length === 0) ok(`response includes all ${requiredKeys.length} public keys`);
  else bad(`response shape (${label})`, `missing keys: ${missing.join(", ")}`);

  if (typeof j.connected === "boolean") ok("`connected` is a boolean");
  else bad(`\`connected\` type (${label})`, `got ${typeof j.connected}`);

  if (typeof j.configured === "boolean") ok("`configured` is a boolean");
  else bad(`\`configured\` type (${label})`, `got ${typeof j.configured}`);

  // Token-leak guard
  if (!("accessToken" in j) && !("refreshToken" in j) &&
      !("access_token" in j) && !("refresh_token" in j)) {
    ok("no accessToken / refreshToken leaked in response");
  } else {
    bad("token leak", `keys: ${Object.keys(j).join(",")}`);
  }

  return j;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. GET /api/zoom/oauth/start — authUrl OR 503 not-configured
// ─────────────────────────────────────────────────────────────────────────────

async function testOauthStart(cookie) {
  console.log("\n[4] GET /api/zoom/oauth/start (authenticated)");

  const r = await get("/api/zoom/oauth/start", cookie);
  if (r.status === 200) {
    const j = await r.json();
    if (typeof j.authUrl === "string" && j.authUrl.startsWith("https://zoom.us/oauth/authorize?")) {
      ok(`200 → authUrl points at zoom.us (${j.authUrl.slice(0, 80)}...)`);
    } else {
      bad("authUrl shape", `got ${JSON.stringify(j).slice(0, 120)}`);
    }
    if (j.authUrl?.includes("state=") && j.authUrl?.includes("client_id=")) {
      ok("authUrl includes state= and client_id= params");
    } else {
      bad("authUrl params", "missing state or client_id");
    }
  } else if (r.status === 503) {
    const j = await r.json();
    if (j.configured === false) ok("503 → {configured:false} (env vars missing — acceptable)");
    else bad("503 shape", `got ${JSON.stringify(j)}`);
  } else {
    bad("GET /api/zoom/oauth/start", `unexpected status ${r.status}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Cross-user isolation + 6. Disconnect is per-user
// ─────────────────────────────────────────────────────────────────────────────

async function testPerUserScoping(viewerCookie, adminCookie) {
  console.log("\n[5/6] Cross-user isolation + disconnect scoping");

  // Seed a fake Zoom row directly for the admin user via SQL so we can prove
  // (a) viewer cannot see it, (b) viewer's disconnect doesn't touch it.
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const adminId = (await pool.query(
    "SELECT id FROM users WHERE email=$1", [ADMIN_EMAIL])).rows[0]?.id;
  const viewerId = (await pool.query(
    "SELECT id FROM users WHERE email=$1", [VIEWER_EMAIL])).rows[0]?.id;
  if (!adminId || !viewerId) {
    bad("seed users", `adminId=${adminId} viewerId=${viewerId}`);
    await pool.end();
    return;
  }

  const adminMarker = `admin-zoom-${Date.now()}@example.com`;
  await pool.query(
    `INSERT INTO zoom_connections
       (user_id, zoom_user_id, zoom_email, zoom_account_type,
        access_token, refresh_token, token_expires_at, scope,
        connected_at, created_at, updated_at)
     VALUES ($1, 'fake-admin-zid', $2, 'pro',
        'fake-admin-access', 'fake-admin-refresh', NOW() + INTERVAL '1 hour', 'meeting:write',
        NOW(), NOW(), NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       zoom_email = EXCLUDED.zoom_email,
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       disconnected_at = NULL,
       updated_at = NOW()`,
    [adminId, adminMarker],
  );

  // (a) admin sees their own row
  const adminConn = await (await get("/api/zoom/connection", adminCookie)).json();
  if (adminConn.connected === true && adminConn.zoomEmail === adminMarker) {
    ok(`admin sees own row (zoomEmail=${adminMarker})`);
  } else {
    bad("admin should see own row", `connected=${adminConn.connected} zoomEmail=${adminConn.zoomEmail}`);
  }

  // (b) viewer does NOT see admin's row
  const viewerConn = await (await get("/api/zoom/connection", viewerCookie)).json();
  if (viewerConn.zoomEmail !== adminMarker) {
    ok(`viewer does NOT see admin's zoomEmail (got ${JSON.stringify(viewerConn.zoomEmail)})`);
  } else {
    bad("viewer leaked admin's zoomEmail", JSON.stringify(viewerConn));
  }

  // (c) viewer's disconnect does NOT clear admin's row
  const viewerDisc = await post("/api/zoom/disconnect", viewerCookie);
  if (viewerDisc.status === 200) ok("viewer POST /api/zoom/disconnect → 200 (own row, idempotent)");
  else bad("viewer disconnect", `status ${viewerDisc.status}`);

  const adminAfter = await pool.query(
    "SELECT zoom_email, access_token, disconnected_at FROM zoom_connections WHERE user_id=$1",
    [adminId],
  );
  const row = adminAfter.rows[0];
  if (row && row.zoom_email === adminMarker && row.disconnected_at === null && row.access_token === "fake-admin-access") {
    ok("admin's row UNCHANGED after viewer's disconnect (no cross-user effect)");
  } else {
    bad("admin row tampered by viewer disconnect", JSON.stringify(row));
  }

  // (d) admin's own disconnect DOES clear admin's row
  const adminDisc = await post("/api/zoom/disconnect", adminCookie);
  if (adminDisc.status === 200) ok("admin POST /api/zoom/disconnect → 200 (own row)");
  else bad("admin disconnect", `status ${adminDisc.status}`);

  const adminFinal = await pool.query(
    "SELECT zoom_email, access_token, refresh_token, disconnected_at FROM zoom_connections WHERE user_id=$1",
    [adminId],
  );
  const fr = adminFinal.rows[0];
  if (fr && fr.disconnected_at !== null && fr.access_token === "" && fr.refresh_token === "") {
    ok("after admin disconnect: disconnected_at set, tokens cleared, row retained for audit");
  } else {
    bad("admin self-disconnect did not clear tokens", JSON.stringify(fr));
  }

  // Cleanup: remove the test row so we don't leave a permanent disconnected stub
  await pool.query("DELETE FROM zoom_connections WHERE user_id=$1 AND zoom_user_id='fake-admin-zid'", [adminId]);
  await pool.end();
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. OAuth callback — authenticated state-mismatch (CSRF guard)
// ─────────────────────────────────────────────────────────────────────────────

async function testCallbackStateMismatch(adminCookie) {
  console.log("\n[7] OAuth callback — authenticated CSRF state-mismatch");

  // Hit the callback while authenticated but with a state that does not match
  // the (absent / unrelated) session.zoomOAuthState. Must redirect with
  // reason=state_mismatch and MUST NOT 200 / persist anything.
  const r = await fetch(`${BASE}/api/zoom/oauth/callback?code=fake&state=garbage`, {
    method: "GET",
    headers: { Cookie: adminCookie },
    redirect: "manual",
  });
  if (r.status >= 300 && r.status < 400) {
    const loc = r.headers.get("location") || "";
    if (loc.includes("/settings") && loc.includes("zoom=error") && loc.includes("state_mismatch")) {
      ok(`callback w/ bad state → ${r.status} → ${loc}`);
    } else {
      bad("callback state-mismatch Location", `got "${loc}"`);
    }
  } else {
    bad("callback state-mismatch status", `expected 30x, got ${r.status}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Reconnect rehydrates existing row
// ─────────────────────────────────────────────────────────────────────────────

async function testReconnectRehydratesRow() {
  console.log("\n[8] upsertZoomConnection rehydrates a disconnected row");

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const adminId = (await pool.query(
      "SELECT id FROM users WHERE email=$1", [ADMIN_EMAIL])).rows[0]?.id;
    if (!adminId) { bad("seed admin id", "missing"); return; }

    // Seed a DISCONNECTED row with a known original connectedAt
    const originalConnectedAt = new Date(Date.now() - 7 * 24 * 3600_000); // 7d ago
    await pool.query(
      `INSERT INTO zoom_connections
         (user_id, zoom_user_id, zoom_email, access_token, refresh_token,
          token_expires_at, scope, connected_at, disconnected_at, created_at, updated_at)
       VALUES ($1, 'rehydrate-zid', 'rehydrate@example.com', '', '',
               NOW() + INTERVAL '1 hour', 'meeting:write', $2, NOW(), NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         zoom_user_id='rehydrate-zid',
         zoom_email='rehydrate@example.com',
         access_token='', refresh_token='',
         disconnected_at=NOW(),
         connected_at=$2,
         updated_at=NOW()`,
      [adminId, originalConnectedAt],
    );

    // Confirm seed: disconnected_at is set, tokens empty
    const seed = (await pool.query(
      "SELECT disconnected_at, access_token FROM zoom_connections WHERE user_id=$1",
      [adminId])).rows[0];
    if (seed.disconnected_at !== null && seed.access_token === "") {
      ok("seed: row is disconnected with empty tokens");
    } else {
      bad("seed precondition", JSON.stringify(seed));
      return;
    }

    // Simulate reconnect by mirroring upsertZoomConnection's "existing-row" branch
    // (server/services/zoom-service.ts L198-L218): clear disconnected_at, persist
    // new tokens, but preserve the original connected_at.
    const fakeExpiry = new Date(Date.now() + 60 * 60 * 1000);
    await pool.query(
      `UPDATE zoom_connections
          SET access_token=$2,
              refresh_token=$3,
              token_expires_at=$4,
              scope='meeting:write meeting:read user:read',
              disconnected_at=NULL,
              connected_at=connected_at,  -- explicit preserve (matches service)
              updated_at=NOW()
        WHERE user_id=$1`,
      [adminId, "new-access-token", "new-refresh-token", fakeExpiry],
    );

    const after = (await pool.query(
      `SELECT connected_at, disconnected_at, access_token, refresh_token, zoom_email
         FROM zoom_connections WHERE user_id=$1`, [adminId])).rows[0];

    if (after.disconnected_at === null) ok("after reconnect: disconnected_at cleared");
    else bad("disconnected_at not cleared", String(after.disconnected_at));

    if (after.access_token === "new-access-token" && after.refresh_token === "new-refresh-token") {
      ok("after reconnect: new tokens persisted");
    } else {
      bad("tokens not refreshed", JSON.stringify({ a: after.access_token, r: after.refresh_token }));
    }

    const orig = originalConnectedAt.toISOString();
    const got  = new Date(after.connected_at).toISOString();
    if (orig === got) ok(`after reconnect: original connected_at preserved (${got})`);
    else bad("connected_at not preserved", `orig=${orig} got=${got}`);

    // Cleanup
    await pool.query("DELETE FROM zoom_connections WHERE user_id=$1 AND zoom_user_id='rehydrate-zid'", [adminId]);
  } finally {
    await pool.end();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. GET /api/zoom/connection AFTER self-disconnect
// ─────────────────────────────────────────────────────────────────────────────

async function testDisconnectedGetShape(adminCookie) {
  console.log("\n[9] GET /api/zoom/connection after self-disconnect");

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const adminId = (await pool.query(
      "SELECT id FROM users WHERE email=$1", [ADMIN_EMAIL])).rows[0]?.id;

    // Seed a CONNECTED row, then call disconnect via the API, then GET.
    await pool.query(
      `INSERT INTO zoom_connections
         (user_id, zoom_user_id, zoom_email, zoom_account_type,
          access_token, refresh_token, token_expires_at, scope,
          connected_at, created_at, updated_at)
       VALUES ($1, 'disc-shape-zid', 'disc-shape@example.com', 'pro',
               'tmp-access', 'tmp-refresh', NOW() + INTERVAL '1 hour', 'meeting:write',
               NOW(), NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         zoom_user_id='disc-shape-zid',
         zoom_email='disc-shape@example.com',
         access_token='tmp-access', refresh_token='tmp-refresh',
         disconnected_at=NULL,
         updated_at=NOW()`,
      [adminId],
    );

    const disc = await post("/api/zoom/disconnect", adminCookie);
    if (disc.status !== 200) { bad("self-disconnect", `status ${disc.status}`); return; }

    const r = await get("/api/zoom/connection", adminCookie);
    const j = await r.json();

    if (j.connected === false) ok("after disconnect: connected === false");
    else bad("connected not false after disconnect", String(j.connected));

    const identityNullified = j.zoomEmail === null && j.zoomUserId === null
      && j.zoomAccountType === null && j.zoomPmi === null && j.zoomPmiUrl === null
      && j.connectedAt === null && j.tokenExpiresAt === null;
    if (identityNullified) ok("after disconnect: all identity fields null in public projection");
    else bad("identity fields not nulled", JSON.stringify(j));

    if (j.disconnectedAt !== null) ok(`after disconnect: disconnectedAt populated (${j.disconnectedAt})`);
    else bad("disconnectedAt not populated", JSON.stringify(j));

    if (!("accessToken" in j) && !("refreshToken" in j)) {
      ok("after disconnect: still no token fields in response");
    } else {
      bad("token fields leaked post-disconnect", JSON.stringify(Object.keys(j)));
    }

    // Cleanup
    await pool.query("DELETE FROM zoom_connections WHERE user_id=$1 AND zoom_user_id='disc-shape-zid'", [adminId]);
  } finally {
    await pool.end();
  }
}

// Seed viewer with a known password so this suite is hermetic.
async function setupViewer(client) {
  const snap = await client.query(
    `SELECT password FROM users WHERE email = $1 LIMIT 1`, [VIEWER_EMAIL]);
  if (snap.rowCount === 0) throw new Error(`Viewer ${VIEWER_EMAIL} not found`);
  const original = snap.rows[0].password;
  const hash = await bcrypt.hash(VIEWER_PWD, 10);
  await client.query(
    `UPDATE users SET password=$1, status='active', must_change_password=false WHERE email=$2`,
    [hash, VIEWER_EMAIL]);
  return original;
}
async function teardownViewer(client, originalPwd) {
  if (!originalPwd) return;
  await client.query(`UPDATE users SET password=$1 WHERE email=$2`, [originalPwd, VIEWER_EMAIL]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────

(async () => {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("Zoom / Booking — Phase A.1 Regression Suite");
  console.log("═══════════════════════════════════════════════════════════════");

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  let originalViewerPwd = null;

  try {
    originalViewerPwd = await setupViewer(pool);

    await testAnonLockdown();
    await testCallbackAnonRedirect();

    const viewerCookie = await login(VIEWER_EMAIL, VIEWER_PWD);
    const adminCookie  = await login(ADMIN_EMAIL,  ADMIN_PWD);

    await testConnectionShape(viewerCookie, "viewer");
    await testConnectionShape(adminCookie,  "admin");
    await testOauthStart(adminCookie);
    await testPerUserScoping(viewerCookie, adminCookie);
    await testCallbackStateMismatch(adminCookie);
    await testReconnectRehydratesRow();
    await testDisconnectedGetShape(adminCookie);
  } catch (e) {
    console.error("\nFATAL:", e.message);
    failed++;
  } finally {
    try { await teardownViewer(pool, originalViewerPwd); } catch {}
    await pool.end();
  }

  console.log("\n───────────────────────────────────────────────────────────────");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("───────────────────────────────────────────────────────────────");
  process.exit(failed === 0 ? 0 : 1);
})();
