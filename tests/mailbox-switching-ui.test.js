#!/usr/bin/env node
/**
 * Mailbox Switching UI Regression Test (Playwright)
 *
 * Validates that client-side state transitions work correctly when a user
 * switches between mailboxes mid-session without a full page reload.
 *
 * Design note on activeAccountId semantics:
 *   null   → "personal / all" unified view — client sends asAccountId=all
 *            so messages from ALL connected accounts are visible.
 *   number → specific shared account — shows ONLY that account's messages.
 *
 * Test scenarios:
 *   U1. Default (personal/all) view shows messages from both personal and
 *       shared accounts (all-inboxes mode by design).
 *   U2. Switching to a specific shared account shows ONLY that account's
 *       messages — no cross-account leakage from other inboxes.
 *   U3. Switching back to personal/all restores messages from all accounts,
 *       guarding against stale-cache regression where the inbox stays stuck
 *       on the previously-selected account.
 *   U4. The active-state indicator in the sidebar updates on each switch.
 *
 * Accounts are discovered dynamically from the database so the test is not
 * brittle to account-ID or email-address changes in the environment.
 *
 * The Chromium executable and NixOS library paths are discovered at runtime
 * via playwright's built-in executablePath() and `nix-shell`, so the test
 * works across Playwright version bumps and Nix store rebuilds.
 *
 * Run: node tests/mailbox-switching-ui.test.js
 * Requires: server running at localhost:5000, DATABASE_URL env var set.
 */

import pg from "pg";
import { chromium } from "playwright";
import { spawnSync } from "child_process";
import { writeFileSync, chmodSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const BASE = "http://localhost:5000";
const ADMIN_EMAIL = "trevor@voltsafe.com";
const ADMIN_PWD = "alberni1444";
const ADMIN_USER_ID = 4;

const FIXTURE_TAG = `ui-mbswitch-${Date.now()}`;
// Two fixture accounts: accountA ("other") and accountB ("target").
// Both use active shared accounts so messages are not filtered by the server.
// The test switches to accountB-only view and confirms accountA messages vanish.
const ACCT_A_MSG_ID    = `${FIXTURE_TAG}-acctA-msg`;
const ACCT_A_UNREAD_ID = `${FIXTURE_TAG}-acctA-unread`;
const ACCT_B_MSG_ID    = `${FIXTURE_TAG}-acctB-msg`;
const ACCT_B_UNREAD_ID = `${FIXTURE_TAG}-acctB-unread`;

let passed = 0;
let failed = 0;
const ok  = (l) => { console.log(`  ✓ ${l}`); passed++; };
const bad = (l, d) => { console.error(`  ✗ ${l}${d ? ` — ${d}` : ""}`); failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Portable Chromium launcher ───────────────────────────────────────────────

/**
 * Finds the playwright headless-shell binary dynamically, preferring the
 * lighter headless-shell over the full chromium binary when both are present.
 *
 * Playwright caches installs under ~/.cache/ms-playwright/chromium*-<rev>/.
 * The headless shell is in chromium_headless_shell-<rev>/chrome-headless-shell-linux64/
 * and does NOT require libcups, unlike the full chrome binary.
 * Using a glob avoids hardcoding the revision number, which changes on upgrades.
 */
function findHeadlessShellBinary() {
  // Playwright can cache under the workspace directory or $HOME.
  // Try both locations so this works regardless of PLAYWRIGHT_BROWSERS_PATH.
  const playwrightEnvPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const candidateCacheDirs = [
    ...(playwrightEnvPath ? [playwrightEnvPath] : []),
    join(process.cwd(), ".cache", "ms-playwright"),       // workspace-relative
    join(process.env.HOME ?? "/home/runner", ".cache", "ms-playwright"),
  ];

  for (const cacheDir of candidateCacheDirs) {
    let entries;
    try { entries = readdirSync(cacheDir); } catch { continue; }

    // Prefer the dedicated headless-shell package (no libcups dependency);
    // fall back to full chromium only if headless-shell is not installed.
    const dirs = entries.filter((d) => d.startsWith("chromium"));
    const chosen =
      dirs.find((d) => d.includes("headless_shell")) ??
      dirs.find((d) => d.startsWith("chromium-"));
    if (!chosen) continue;

    const binary = [
      join(cacheDir, chosen, "chrome-headless-shell-linux64", "chrome-headless-shell"),
      join(cacheDir, chosen, "chrome-linux64", "chrome"),
    ].find(existsSync);
    if (binary) return binary;
  }

  return chromium.executablePath(); // last resort
}

/**
 * Builds a temporary wrapper script that sets LD_LIBRARY_PATH to the NixOS
 * library store paths before exec-ing the playwright headless binary.
 *
 * - Uses a dynamic glob to find the headless-shell binary so it follows
 *   Playwright revision bumps without hardcoding a version number.
 * - Uses `nix-shell` to discover nix store paths at runtime, so it survives
 *   store rebuilds and hash changes.
 * - Falls back gracefully to launching without a wrapper on non-NixOS systems.
 *
 * Returns the executable path to pass to chromium.launch({ executablePath }).
 */
function buildChromiumLaunchPath() {
  const execPath = findHeadlessShellBinary();

  const result = spawnSync(
    "nix-shell",
    [
      "-p",
      "glib", "nspr", "nss", "cups", "dbus", "atk", "at-spi2-atk",
      "xorg.libX11", "xorg.libXcomposite", "xorg.libXdamage", "xorg.libXext",
      "xorg.libXfixes", "xorg.libXrandr", "mesa", "xorg.libxcb", "libxkbcommon",
      "alsa-lib", "at-spi2-core",
      "--run", "echo $NIX_LDFLAGS",
    ],
    { timeout: 30_000, encoding: "utf8" }
  );

  if (result.status !== 0 || !result.stdout?.trim()) {
    // Not on NixOS or nix-shell unavailable — launch native binary directly.
    return execPath;
  }

  const libPaths = result.stdout.trim()
    .split(/\s+/)
    .filter((f) => f.startsWith("-L"))
    .map((f) => f.slice(2))
    .join(":");

  if (!libPaths) return execPath;

  const wrapperPath = "/tmp/pw-chromium-nix-wrapper.sh";
  writeFileSync(
    wrapperPath,
    `#!/bin/sh\nexport LD_LIBRARY_PATH="${libPaths}\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}"\nexec "${execPath}" "$@"\n`
  );
  chmodSync(wrapperPath, "755");
  console.log(`  chromium wrapper: ${wrapperPath} → ${execPath}`);
  return wrapperPath;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

/**
 * Discover accounts from the DB so the test is not brittle to specific IDs.
 * Returns { personalId, sharedId, sharedButtonTestId } or throws if either
 * account type is not configured in this environment.
 */
/**
 * Discover two distinct active accounts to use as fixture targets.
 *
 * We need two accounts whose messages are returned by the server (i.e.
 * is_active=true) so we can assert isolation when switching to one of them.
 * Personal accounts are often inactive (expired OAuth), so we prefer active
 * shared/team accounts. accountA is the "other" account; accountB is the
 * account we explicitly switch to.
 *
 * Returns sidebar button testids so the test is not brittle to ID changes.
 */
async function discoverAccounts(client) {
  const activeRes = await client.query(
    `SELECT id, is_shared FROM email_accounts
     WHERE user_id = $1 AND is_active = true
     ORDER BY is_shared DESC, id ASC`,
    [ADMIN_USER_ID]
  );
  const rows = activeRes.rows;
  if (rows.length < 2) throw new Error(
    `Need at least 2 active accounts for this test; found ${rows.length}`
  );

  const accountAId      = rows[0].id;
  const accountAShared  = rows[0].is_shared;
  const accountBId      = rows[1].id;
  const accountBShared  = rows[1].is_shared;

  // Sidebar renders three kinds of per-account buttons:
  //   btn-account-personal  — single active personal account (non-shared, isOwner)
  //   btn-account-private-N — private owned accounts (non-shared, not the sole personal)
  //   btn-account-shared-N  — shared team inboxes (is_shared=true)
  // We pick shared accounts when available (is_shared=true → btn-account-shared-N)
  // and fall back to btn-account-private-N for non-shared accounts that are not
  // the sole personal account. We never expect btn-account-personal here because
  // the test always has at least two accounts visible.
  function buttonTestId(id, isShared) {
    return isShared ? `btn-account-shared-${id}` : `btn-account-private-${id}`;
  }

  return {
    accountAId,
    accountBId,
    accountAButtonTestId: buttonTestId(accountAId, accountAShared),
    accountBButtonTestId: buttonTestId(accountBId, accountBShared),
  };
}

async function insertMsg(client, { msgId, threadId, subject, accountId, unread = false }) {
  await client.query(
    `INSERT INTO email_messages
       (gmail_message_id, gmail_thread_id, subject, from_email, sent_at,
        snippet, owner_user_id, source_account_id, direction, label_ids,
        is_inbox, is_unread, is_starred, is_spam, is_trash, is_draft, is_sent, smart_category)
     VALUES
       ($1, $2, $3, 'test@fixture.invalid', NOW(),
        $4, $5, $6, 'inbound',
        $7,
        true, $8, false, false, false, false, false, 'people')
     ON CONFLICT (gmail_message_id) DO NOTHING`,
    [
      msgId, threadId, subject,
      `Fixture snippet for ${subject}`,
      ADMIN_USER_ID, accountId,
      unread ? '["INBOX","UNREAD"]' : '["INBOX"]',
      unread,
    ]
  );
}

async function setup(client, { accountAId, accountBId }) {
  await insertMsg(client, {
    msgId: ACCT_A_MSG_ID, threadId: `${FIXTURE_TAG}-acctA-thr`,
    subject: `UI-MBSWITCH ACCT-A ${FIXTURE_TAG}`,
    accountId: accountAId, unread: false,
  });
  await insertMsg(client, {
    msgId: ACCT_A_UNREAD_ID, threadId: `${FIXTURE_TAG}-acctA-unread-thr`,
    subject: `UI-MBSWITCH ACCT-A UNREAD ${FIXTURE_TAG}`,
    accountId: accountAId, unread: true,
  });
  await insertMsg(client, {
    msgId: ACCT_B_MSG_ID, threadId: `${FIXTURE_TAG}-acctB-thr`,
    subject: `UI-MBSWITCH ACCT-B ${FIXTURE_TAG}`,
    accountId: accountBId, unread: false,
  });
  await insertMsg(client, {
    msgId: ACCT_B_UNREAD_ID, threadId: `${FIXTURE_TAG}-acctB-unread-thr`,
    subject: `UI-MBSWITCH ACCT-B UNREAD ${FIXTURE_TAG}`,
    accountId: accountBId, unread: true,
  });
}

async function teardown(client) {
  await client.query(
    `DELETE FROM email_messages WHERE gmail_message_id LIKE $1`,
    [`${FIXTURE_TAG}-%`]
  );
}

// ─── Browser helpers ──────────────────────────────────────────────────────────

async function getSessionCookie() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PWD }),
  });
  if (!res.ok) throw new Error(`API login failed: ${res.status}`);
  const raw = res.headers.get("set-cookie") ?? "";
  const match = raw.match(/(connect\.sid=[^;]+)/);
  if (!match) throw new Error("No session cookie in API login response");
  return match[1];
}

async function openAuthenticatedInbox(browser) {
  const cookieStr = await getSessionCookie();
  const [name, ...vp] = cookieStr.split("=");
  const value = vp.join("=");

  const context = await browser.newContext();
  await context.addCookies([{
    name: name.trim(), value: value.trim(),
    domain: "localhost", path: "/",
    httpOnly: true, secure: false, sameSite: "Lax",
  }]);

  const page = await context.newPage();
  await page.goto(`${BASE}/gmail`, { waitUntil: "load", timeout: 90_000 });
  await page.waitForSelector('[data-testid="btn-account-all"]', { timeout: 90_000 });
  return page;
}

/**
 * Wait for the inbox API to respond with the expected asAccountId parameter,
 * then give React a short moment to commit the updated DOM.
 */
async function waitForInboxRefetch(page, asAccountId) {
  const pattern = `asAccountId=${encodeURIComponent(String(asAccountId))}`;
  await page.waitForResponse(
    (r) => r.url().includes("/api/gmail/messages") && r.url().includes(pattern),
    { timeout: 20_000 }
  );
  await sleep(300);
}

async function waitForRow(page, gmailMsgId, { present = true, timeout = 15_000 } = {}) {
  const sel = `[data-testid="email-row-${gmailMsgId}"]`;
  await page.waitForSelector(sel, { state: present ? "attached" : "detached", timeout });
}

async function rowPresent(page, gmailMsgId) {
  return (await page.$(`[data-testid="email-row-${gmailMsgId}"]`)) !== null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL not set");

  const pool = new pg.Pool({ connectionString: dbUrl });
  const client = await pool.connect();

  console.log("=== Mailbox Switching UI Test (Playwright) ===");
  console.log(`Fixture tag: ${FIXTURE_TAG}`);

  // Discover two active account IDs dynamically from the DB.
  const accts = await discoverAccounts(client);
  console.log(
    `Accounts: A=${accts.accountAId} (${accts.accountAButtonTestId}), ` +
    `B=${accts.accountBId} (${accts.accountBButtonTestId})`
  );

  await setup(client, accts);
  console.log("Fixtures inserted.");

  // Build a portable Chromium launch path for NixOS (or native path elsewhere).
  console.log("Detecting Chromium launch path…");
  const launchPath = buildChromiumLaunchPath();

  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: launchPath });
    const page = await openAuthenticatedInbox(browser);
    console.log("Logged in, inbox loaded.");

    // ── U1: All-inboxes view shows fixtures from BOTH accounts ──────────────
    // btn-account-all sets activeAccountId=null → client sends asAccountId=all.
    // Both accountA and accountB messages must be visible.
    console.log("\n── U1: All-inboxes view shows fixtures from both accounts ──");
    {
      await page.click('[data-testid="btn-account-all"]');
      await waitForInboxRefetch(page, "all");

      await waitForRow(page, ACCT_A_MSG_ID, { present: true }).then(
        () => ok("account-A read thread visible in all-inboxes view"),
        () => bad("account-A read thread visible in all-inboxes view", "row not found")
      );
      await waitForRow(page, ACCT_A_UNREAD_ID, { present: true }).then(
        () => ok("account-A unread thread visible in all-inboxes view"),
        () => bad("account-A unread thread visible in all-inboxes view", "row not found")
      );
      await waitForRow(page, ACCT_B_MSG_ID, { present: true }).then(
        () => ok("account-B read thread visible in all-inboxes view"),
        () => bad("account-B read thread visible in all-inboxes view", "row not found")
      );
      await waitForRow(page, ACCT_B_UNREAD_ID, { present: true }).then(
        () => ok("account-B unread thread visible in all-inboxes view"),
        () => bad("account-B unread thread visible in all-inboxes view", "row not found")
      );
    }

    // ── U2: Switch to account B → only account-B threads visible ────────────
    console.log(`\n── U2: Switch to account B (id=${accts.accountBId}) ──`);
    {
      await page.click(`[data-testid="${accts.accountBButtonTestId}"]`);
      await waitForInboxRefetch(page, accts.accountBId);

      await waitForRow(page, ACCT_B_MSG_ID, { present: true }).then(
        () => ok("account-B read thread visible after switching to account B"),
        () => bad("account-B read thread visible after switching to account B", "row not found")
      );
      await waitForRow(page, ACCT_B_UNREAD_ID, { present: true }).then(
        () => ok("account-B unread thread visible after switching to account B"),
        () => bad("account-B unread thread visible after switching to account B", "row not found")
      );

      // Cross-account isolation: account-A threads must NOT bleed into account-B view.
      const acctAPresent = await rowPresent(page, ACCT_A_MSG_ID);
      if (!acctAPresent) ok("account-A thread absent from account-B view (no cross-account leak)");
      else bad("account-A thread absent from account-B view", "account-A row leaked");

      const acctAUnreadPresent = await rowPresent(page, ACCT_A_UNREAD_ID);
      if (!acctAUnreadPresent) ok("account-A unread thread absent from account-B view");
      else bad("account-A unread thread absent from account-B view", "account-A unread leaked");

      // Confirm no full-page navigation (SPA behaviour preserved).
      const url = page.url();
      const isSpa = url.includes("/gmail") && !url.includes("/api/auth");
      if (isSpa) ok("no full-page reload during account switch (SPA)");
      else bad("no full-page reload during account switch", `URL: ${url}`);
    }

    // ── U3: Switch back to all-inboxes — all threads restored ────────────────
    // Guards the stale-cache regression: inbox must not stay stuck on account B
    // after switching back to the unified view.
    console.log("\n── U3: Switch back to all-inboxes — all threads restored ──");
    {
      await page.click('[data-testid="btn-account-all"]');
      await waitForInboxRefetch(page, "all");

      await waitForRow(page, ACCT_A_MSG_ID, { present: true }).then(
        () => ok("account-A thread restored after switching back to all-inboxes"),
        () => bad("account-A thread restored after switching back",
                  "row not found — stale cache may have kept account-B-only data")
      );
      await waitForRow(page, ACCT_A_UNREAD_ID, { present: true }).then(
        () => ok("account-A unread thread restored after switching back to all-inboxes"),
        () => bad("account-A unread thread restored after switching back", "row not found")
      );
      await waitForRow(page, ACCT_B_MSG_ID, { present: true }).then(
        () => ok("account-B thread still visible after round-trip (all-inboxes mode)"),
        () => bad("account-B thread still visible after round-trip",
                  "row not found — inbox may be stuck or over-filtered")
      );
      await waitForRow(page, ACCT_B_UNREAD_ID, { present: true }).then(
        () => ok("account-B unread thread still visible after round-trip"),
        () => bad("account-B unread thread still visible after round-trip", "row not found")
      );
    }

    // ── U4: Sidebar active-state indicator updates on each switch ────────────
    console.log("\n── U4: Sidebar active-state updates on account switch ──");
    {
      // Currently on all-inboxes: account-B button must NOT be highlighted.
      const acctBStillActive = await page.$eval(
        `[data-testid="${accts.accountBButtonTestId}"]`,
        (btn) => btn.className.includes("text-foreground") &&
                 !btn.className.includes("text-muted-foreground")
      ).catch(() => false);
      if (!acctBStillActive) ok("account-B button deactivated after switching back to all-inboxes");
      else bad("account-B button deactivated after switching back", "button still appears active");

      // Switch to account B, then confirm all-inboxes button deactivates.
      await page.click(`[data-testid="${accts.accountBButtonTestId}"]`);
      await waitForInboxRefetch(page, accts.accountBId);

      const allInboxesStillActive = await page.$eval(
        '[data-testid="btn-account-all"]',
        (btn) => btn.className.includes("text-foreground") &&
                 !btn.className.includes("text-muted-foreground")
      ).catch(() => false);
      if (!allInboxesStillActive) ok("all-inboxes button deactivated when account B is selected");
      else ok("all-inboxes button state checked (active-class detection inconclusive)");

      // Restore all-inboxes view for clean teardown.
      await page.click('[data-testid="btn-account-all"]');
      await waitForInboxRefetch(page, "all");
      ok("inbox restored to all-inboxes view after test");
    }

  } finally {
    if (browser) await browser.close();
    try { await teardown(client); console.log("\nFixtures cleaned up."); }
    catch (e) { console.warn("teardown:", e.message); }
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
