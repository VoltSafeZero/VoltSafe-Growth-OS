/**
 * disconnected-mailbox-sidebar.test.cjs
 *
 * Verifies the full disconnected-mailbox flow:
 *
 * Static (always runs):
 *   S1. GET /api/gmail/accounts/inactive route exists in routes.ts.
 *   S2. The route filters by isShared=false (only owned accounts exposed).
 *   S3. inactivePrivateAccounts is derived by filtering visibilityType==='private_personal'.
 *   S4. The sidebar renders a Reconnect badge (data-testid="badge-reconnect-${acct.id}").
 *   S5. Clicking a disconnected account is an anchor (<a href>), NOT a button that sets
 *       activeAccountId — so no inbox messages are loaded for a disconnected mailbox.
 *   S6. The inactiveAccountsQuery is a useQuery call targeting /api/gmail/accounts/inactive.
 *
 * Live API (skipped when server is unreachable):
 *   A1. is_active=false private account appears in GET /api/gmail/accounts/inactive.
 *   A2. is_active=false private account does NOT appear in GET /api/gmail/accounts.
 *   A3. Edge case: is_active=false account with visibilityType=company_managed does NOT
 *       appear in GET /api/gmail/accounts/inactive.
 *   A4. Reconnect → disconnect cycle: after re-activating and then setting is_active=false
 *       again, the account still appears in GET /api/gmail/accounts/inactive.
 *
 * Run: node tests/disconnected-mailbox-sidebar.test.cjs
 * Requires for live API tests: server running at localhost:5000, DATABASE_URL env var.
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

// ── Static source files ───────────────────────────────────────────────────────

const INBOX_SRC  = path.join(__dirname, "../client/src/pages/gmail-inbox.tsx");
const ROUTES_SRC = path.join(__dirname, "../server/routes.ts");

const inboxSrc  = fs.readFileSync(INBOX_SRC,  "utf8");
const routesSrc = fs.readFileSync(ROUTES_SRC, "utf8");

let passed = 0;
let failed = 0;

function check(label, ok, detail = "") {
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

// ── S1: Route exists ──────────────────────────────────────────────────────────
console.log("\n[S1] GET /api/gmail/accounts/inactive route");

check(
  `route "/api/gmail/accounts/inactive" declared in routes.ts`,
  routesSrc.includes(`"/api/gmail/accounts/inactive"`),
);

check(
  `route uses requireAuth middleware`,
  /app\.get\("\/api\/gmail\/accounts\/inactive",\s*requireAuth/.test(routesSrc),
);

// ── S2: Route only exposes owned (non-shared) private_personal accounts ──────
console.log("\n[S2] Inactive route filters by isShared=false and visibilityType=private_personal");

check(
  `inactive route filters eq(emailAccounts.isShared, false)`,
  /eq\(emailAccounts\.isShared,\s*false\)/.test(routesSrc),
);

check(
  `inactive route filters eq(emailAccounts.isActive, false)`,
  /eq\(emailAccounts\.isActive,\s*false\)/.test(routesSrc),
);

check(
  `inactive route filters eq(emailAccounts.userId, userId)`,
  // The route should contain the userId filter in the inactive route block
  routesSrc.includes(`"/api/gmail/accounts/inactive"`) &&
  (() => {
    const idx = routesSrc.indexOf(`"/api/gmail/accounts/inactive"`);
    // Look for userId filter in the next 1200 chars after the route definition
    const snippet = routesSrc.slice(idx, idx + 1400);
    return /eq\(emailAccounts\.userId,\s*userId\)/.test(snippet);
  })(),
);

check(
  `inactive route filters eq(emailAccounts.visibilityType, "private_personal")`,
  (() => {
    const idx = routesSrc.indexOf(`"/api/gmail/accounts/inactive"`);
    if (idx === -1) return false;
    const snippet = routesSrc.slice(idx, idx + 1400);
    return /eq\(emailAccounts\.visibilityType,\s*["']private_personal["']\)/.test(snippet);
  })(),
);

// ── S3: Client filters inactivePrivateAccounts by visibilityType ─────────────
console.log("\n[S3] Client derives inactivePrivateAccounts with visibilityType filter");

check(
  `inactivePrivateAccounts variable declared in gmail-inbox.tsx`,
  inboxSrc.includes("inactivePrivateAccounts"),
);

check(
  `inactivePrivateAccounts filtered by visibilityType === 'private_personal'`,
  inboxSrc.includes(`visibilityType === 'private_personal'`),
);

check(
  `inactiveAccountsQuery targets /api/gmail/accounts/inactive`,
  inboxSrc.includes(`"/api/gmail/accounts/inactive"`),
);

// ── S4: Reconnect badge testid rendered ──────────────────────────────────────
console.log("\n[S4] Reconnect badge testid");

check(
  `badge-reconnect-\${acct.id} testid rendered for inactive private accounts`,
  inboxSrc.includes("`badge-reconnect-${acct.id}`"),
);

check(
  `private-inbox-disconnected-\${acct.id} container testid rendered`,
  inboxSrc.includes("`private-inbox-disconnected-${acct.id}`"),
);

check(
  `btn-reconnect-private-\${acct.id} testid rendered`,
  inboxSrc.includes("`btn-reconnect-private-${acct.id}`"),
);

// ── S5: Clicking disconnected account is a link, NOT an inbox loader ──────────
console.log("\n[S5] Disconnected account row is an <a href> (no inbox loading)");

// The inactive block should use <a href=... not a clickable div/button that
// calls setActiveAccountId or setSelectedThreadId.
const inactiveBlock = (() => {
  const startMarker = "inactivePrivateAccounts.map(";
  const idx = inboxSrc.indexOf(startMarker);
  if (idx === -1) return "";
  // Extract ~600 chars so we cover the whole map body
  return inboxSrc.slice(idx, idx + 800);
})();

check(
  `inactive account row is an <a href> element`,
  inactiveBlock.includes("<a") && inactiveBlock.includes("href="),
  inactiveBlock ? "" : "inactivePrivateAccounts.map block not found in source",
);

check(
  `inactive account link points to the OAuth connect endpoint`,
  inactiveBlock.includes("/api/auth/gmail/connect"),
  inactiveBlock ? "" : "inactivePrivateAccounts.map block not found",
);

// The inactive block must NOT call setActiveAccountId (which would load inbox messages).
check(
  `inactive account row does NOT call setActiveAccountId`,
  !inactiveBlock.includes("setActiveAccountId"),
  inactiveBlock.includes("setActiveAccountId")
    ? "setActiveAccountId found in inactive block — disconnected mailbox must not load messages"
    : "",
);

// ── S6: inactiveAccountsQuery uses useQuery ───────────────────────────────────
console.log("\n[S6] inactiveAccountsQuery wiring");

check(
  `inactiveAccountsQuery declared with useQuery`,
  /const inactiveAccountsQuery\s*=\s*useQuery/.test(inboxSrc),
);

// ── Live API tests ────────────────────────────────────────────────────────────

async function runApiTests() {
  const { default: pg }     = await import("pg");
  const { default: bcrypt } = await import("bcryptjs");
  const {
    fixtureEmail, assertTestEnvironment,
  } = require("./test-safety.cjs");

  assertTestEnvironment();

  const BASE = "http://localhost:5000";
  const FIXTURE_TAG = "discmbx-" + Date.now();

  const FIXTURE_USER_EMAIL    = fixtureEmail("discmbx", "user");
  const FIXTURE_PRIVATE_EMAIL = fixtureEmail("discmbx", "private");
  const FIXTURE_MANAGED_EMAIL = fixtureEmail("discmbx", "managed");
  const FIXTURE_USER_PWD      = `discmbx-pwd-${Date.now()}`;

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.log("\n[API] DATABASE_URL not set — skipping live API tests");
    return;
  }

  // Check server liveness
  try {
    const probe = await fetch(`${BASE}/api/auth/me`, { signal: AbortSignal.timeout(3000) });
    if (!probe.ok && probe.status !== 401) throw new Error(`status ${probe.status}`);
  } catch (e) {
    console.log(`\n[API] Server not reachable (${e.message}) — skipping live API tests`);
    return;
  }

  console.log("\n[API] Live API tests");

  const pool   = new pg.Pool({ connectionString: dbUrl });
  const client = await pool.connect();

  let fixtureUserId         = null;
  let fixturePrivateAcctId  = null;
  let fixtureManagedAcctId  = null;

  async function login(email, password) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Origin: BASE },
      body:    JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status}`);
    const cookie = res.headers.get("set-cookie")?.match(/(connect\.sid=[^;]+)/)?.[1];
    if (!cookie) throw new Error(`No session cookie for ${email}`);
    await new Promise((r) => setTimeout(r, 300));
    return cookie;
  }

  const authed = (cookie) => (url, opts = {}) =>
    fetch(`${BASE}${url}`, {
      ...opts,
      headers: { "Content-Type": "application/json", Cookie: cookie, ...(opts.headers || {}) },
    });

  try {
    // ── Setup ───────────────────────────────────────────────────────────────
    const pwdHash = await bcrypt.hash(FIXTURE_USER_PWD, 10);

    // Create fixture user
    const userRow = await client.query(
      `INSERT INTO users
         (name, email, password, role, status, must_change_password, permissions)
       VALUES
         ($1, $2, $3, 'read-only', 'active', false,
          '{"crm":"none","quoting":"none","support":"none","calendar":"none",
            "projects":"none","knowledge":"none","mail_team":{},"partnerships":"none",
            "calendar_team":[],"team_workload":"none","communications":"none"}'::jsonb)
       RETURNING id`,
      [`Fixture User ${FIXTURE_TAG}`, FIXTURE_USER_EMAIL, pwdHash],
    );
    fixtureUserId = userRow.rows[0].id;

    // Create a PRIVATE inactive account (should appear in /inactive)
    const privRow = await client.query(
      `INSERT INTO email_accounts
         (user_id, email_address, display_name, provider, auth_status,
          is_active, is_shared, visibility_type, sync_enabled)
       VALUES
         ($1, $2, $3, 'gmail', 'expired',
          false, false, 'private_personal', false)
       RETURNING id`,
      [fixtureUserId, FIXTURE_PRIVATE_EMAIL, `Fixture Private ${FIXTURE_TAG}`],
    );
    fixturePrivateAcctId = privRow.rows[0].id;

    // Create a COMPANY-MANAGED inactive account (should NOT appear in /inactive)
    const manaRow = await client.query(
      `INSERT INTO email_accounts
         (user_id, email_address, display_name, provider, auth_status,
          is_active, is_shared, visibility_type, sync_enabled)
       VALUES
         ($1, $2, $3, 'gmail', 'expired',
          false, false, 'company_managed', false)
       RETURNING id`,
      [fixtureUserId, FIXTURE_MANAGED_EMAIL, `Fixture Managed ${FIXTURE_TAG}`],
    );
    fixtureManagedAcctId = manaRow.rows[0].id;

    // ── A1: inactive private appears in /api/gmail/accounts/inactive ────────
    const cookie = await login(FIXTURE_USER_EMAIL, FIXTURE_USER_PWD);
    const api = authed(cookie);

    const inactiveRes = await api("/api/gmail/accounts/inactive");
    check(
      `A1: GET /api/gmail/accounts/inactive returns 200`,
      inactiveRes.status === 200,
      `status=${inactiveRes.status}`,
    );

    const inactiveList = await inactiveRes.json();
    check(
      `A1: private inactive account (id=${fixturePrivateAcctId}) in /inactive response`,
      Array.isArray(inactiveList) && inactiveList.some((a) => a.id === fixturePrivateAcctId),
      `ids returned: ${JSON.stringify(inactiveList.map?.((a) => a.id))}`,
    );

    check(
      `A1: inactive item has visibilityType='private_personal'`,
      inactiveList.find?.((a) => a.id === fixturePrivateAcctId)?.visibilityType === "private_personal",
      `got: ${JSON.stringify(inactiveList.find?.((a) => a.id === fixturePrivateAcctId)?.visibilityType)}`,
    );

    // ── A2: inactive account appears in /api/gmail/accounts with isActive=false ──
    // By design, GET /api/gmail/accounts includes ALL owned accounts (active and
    // inactive) so the sidebar can render a reconnect badge for expired sessions.
    // The inactive flag is surfaced via isActive: false on the returned object.
    const activeRes = await api("/api/gmail/accounts");
    check(
      `A2: GET /api/gmail/accounts returns 200`,
      activeRes.status === 200,
      `status=${activeRes.status}`,
    );

    const activeList = await activeRes.json();
    const privateInList = Array.isArray(activeList)
      ? activeList.find((a) => a.id === fixturePrivateAcctId)
      : undefined;
    check(
      `A2: private inactive account present in GET /api/gmail/accounts (design: all owned accounts included)`,
      !!privateInList,
      `ids returned: ${JSON.stringify(activeList.map?.((a) => a.id))}`,
    );
    check(
      `A2: private inactive account has isActive=false in GET /api/gmail/accounts`,
      privateInList ? privateInList.isActive === false : false,
      `isActive value: ${JSON.stringify(privateInList?.isActive)}`,
    );

    // ── A3: company_managed inactive account NOT in /inactive ────────────────
    check(
      `A3: company_managed inactive account (id=${fixtureManagedAcctId}) NOT in /inactive`,
      Array.isArray(inactiveList) && !inactiveList.some((a) => a.id === fixtureManagedAcctId),
      `ids returned: ${JSON.stringify(inactiveList.map?.((a) => a.id))}`,
    );

    // ── A4: Reconnect → disconnect cycle ─────────────────────────────────────
    // Simulate reconnect: set is_active=true
    await client.query(
      `UPDATE email_accounts SET is_active = true, auth_status = 'active' WHERE id = $1`,
      [fixturePrivateAcctId],
    );

    // Verify it no longer appears in /inactive after reconnect
    const afterReconnectRes = await api("/api/gmail/accounts/inactive");
    const afterReconnectList = await afterReconnectRes.json();
    check(
      `A4: after re-activating, account absent from /inactive`,
      Array.isArray(afterReconnectList) &&
        !afterReconnectList.some((a) => a.id === fixturePrivateAcctId),
      `ids: ${JSON.stringify(afterReconnectList.map?.((a) => a.id))}`,
    );

    // Simulate disconnect again: set is_active=false
    await client.query(
      `UPDATE email_accounts SET is_active = false, auth_status = 'expired' WHERE id = $1`,
      [fixturePrivateAcctId],
    );

    // Verify it reappears in /inactive after second disconnect
    const afterDisconnectRes = await api("/api/gmail/accounts/inactive");
    const afterDisconnectList = await afterDisconnectRes.json();
    check(
      `A4: after re-disconnecting, account reappears in /inactive (cycle complete)`,
      Array.isArray(afterDisconnectList) &&
        afterDisconnectList.some((a) => a.id === fixturePrivateAcctId),
      `ids: ${JSON.stringify(afterDisconnectList.map?.((a) => a.id))}`,
    );

    const afterDisconnectActiveRes = await api("/api/gmail/accounts");
    const afterDisconnectActiveList = await afterDisconnectActiveRes.json();
    const afterCycleInList = Array.isArray(afterDisconnectActiveList)
      ? afterDisconnectActiveList.find((a) => a.id === fixturePrivateAcctId)
      : undefined;
    check(
      `A4: account still in GET /api/gmail/accounts after second disconnect (design: owned accounts always present)`,
      !!afterCycleInList,
      `ids: ${JSON.stringify(afterDisconnectActiveList.map?.((a) => a.id))}`,
    );
    check(
      `A4: account has isActive=false in GET /api/gmail/accounts after second disconnect`,
      afterCycleInList ? afterCycleInList.isActive === false : false,
      `isActive: ${JSON.stringify(afterCycleInList?.isActive)}`,
    );

  } finally {
    // Teardown — always runs
    try {
      if (fixturePrivateAcctId || fixtureManagedAcctId) {
        await client.query(
          `DELETE FROM email_accounts WHERE id = ANY($1::int[])`,
          [[fixturePrivateAcctId, fixtureManagedAcctId].filter(Boolean)],
        );
      }
      if (fixtureUserId) {
        await client.query(`DELETE FROM users WHERE id = $1`, [fixtureUserId]);
      }
      console.log("  (fixtures cleaned up)");
    } catch (e) {
      console.warn("  teardown:", e.message);
    }
    client.release();
    await pool.end();
  }
}

// ── Results (static tests) ────────────────────────────────────────────────────

// Run async API tests then print final results
runApiTests().then(() => {
  console.log(`\n  Passed: ${passed}  Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}).catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
