#!/usr/bin/env node
/**
 * disconnected-mailbox-sidebar-ui.test.js  (Playwright)
 *
 * Confirms that a disconnected (is_active=false) private mailbox:
 *
 *   U1. Appears in the sidebar Private Inboxes section with a "Reconnect" badge
 *       immediately after the page loads.
 *   U2. Does NOT have inbox messages loaded when its row is clicked
 *       (the row is an <a href> to /api/auth/gmail/connect, not an inbox-switch button).
 *   U3. Remains visible after a reconnect → disconnect cycle
 *       (re-activating the account removes it from the disconnected row; then
 *       setting is_active=false again makes it reappear).
 *
 * Test isolation: a dedicated fixture user + one inactive private mailbox are
 * created in setup and deleted unconditionally in teardown — no real account
 * rows are modified.
 *
 * Run:  node tests/disconnected-mailbox-sidebar-ui.test.js
 * Requires: server running at localhost:5000, DATABASE_URL env var set.
 */

import pg from "pg";
import bcrypt from "bcryptjs";
import { chromium } from "playwright";
import { spawnSync } from "child_process";
import { writeFileSync, chmodSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { fixtureEmail, assertTestEnvironment } from "./test-safety.cjs";

assertTestEnvironment();

const BASE       = "http://localhost:5000";
const FIXTURE_TAG = `disc-mbx-ui-${Date.now()}`;

// Fixture user credentials
const FIXTURE_USER_EMAIL = fixtureEmail("discmbxui", "user");
const FIXTURE_USER_PWD   = `discmbxui-pwd-${Date.now()}`;

let passed = 0;
let failed = 0;
const ok  = (l)    => { console.log(`  ✓ ${l}`); passed++; };
const bad = (l, d) => { console.error(`  ✗ ${l}${d ? ` — ${d}` : ""}`); failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Portable Chromium launcher (copied from mailbox-switching-ui.test.js) ───

function findHeadlessShellBinary() {
  const playwrightEnvPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const candidateCacheDirs = [
    ...(playwrightEnvPath ? [playwrightEnvPath] : []),
    join(process.cwd(), ".cache", "ms-playwright"),
    join(process.env.HOME ?? "/home/runner", ".cache", "ms-playwright"),
  ];

  for (const cacheDir of candidateCacheDirs) {
    let entries;
    try { entries = readdirSync(cacheDir); } catch { continue; }

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

  return chromium.executablePath();
}

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

  if (result.status !== 0 || !result.stdout?.trim()) return execPath;

  const libPaths = result.stdout.trim()
    .split(/\s+/)
    .filter((f) => f.startsWith("-L"))
    .map((f) => f.slice(2))
    .join(":");

  if (!libPaths) return execPath;

  const wrapperPath = "/tmp/pw-chromium-discmbx-wrapper.sh";
  writeFileSync(
    wrapperPath,
    `#!/bin/sh\nexport LD_LIBRARY_PATH="${libPaths}\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}"\nexec "${execPath}" "$@"\n`
  );
  chmodSync(wrapperPath, "755");
  console.log(`  chromium wrapper: ${wrapperPath} → ${execPath}`);
  return wrapperPath;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function setup(client) {
  const pwdHash = await bcrypt.hash(FIXTURE_USER_PWD, 10);

  // 1. Create fixture user
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
  const userId = userRow.rows[0].id;

  // 2. Create an inactive private mailbox owned by that user
  const acctRow = await client.query(
    `INSERT INTO email_accounts
       (user_id, email_address, display_name, provider, auth_status,
        is_active, is_shared, visibility_type, sync_enabled)
     VALUES
       ($1, $2, $3, 'gmail', 'expired',
        false, false, 'private_personal', false)
     RETURNING id`,
    [
      userId,
      fixtureEmail("discmbxui", "inbox"),
      `Disc Fixture ${FIXTURE_TAG}`,
    ],
  );
  const accountId = acctRow.rows[0].id;

  return { userId, accountId };
}

async function teardown(client, { userId, accountId }) {
  try {
    if (accountId) {
      await client.query(`DELETE FROM email_accounts WHERE id = $1`, [accountId]);
    }
    if (userId) {
      await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
    console.log("  (fixtures cleaned up)");
  } catch (e) {
    console.warn("  teardown error:", e.message);
  }
}

// ─── Browser helpers ──────────────────────────────────────────────────────────

async function getSessionCookie(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body:    JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status}`);
  const raw = res.headers.get("set-cookie") ?? "";
  const match = raw.match(/(connect\.sid=[^;]+)/);
  if (!match) throw new Error("No session cookie in API login response");
  return match[1];
}

/**
 * Opens the Gmail inbox page authenticated as the given user.
 * Waits for the accounts API to respond so React has had a chance to render
 * the sidebar, regardless of whether the account is active or inactive.
 */
async function openAuthenticatedInbox(browser, email, password) {
  const cookieStr = await getSessionCookie(email, password);
  const [name, ...vp] = cookieStr.split("=");
  const value = vp.join("=");

  const context = await browser.newContext();
  await context.addCookies([{
    name: name.trim(), value: value.trim(),
    domain: "localhost", path: "/",
    httpOnly: true, secure: false, sameSite: "Lax",
  }]);

  const page = await context.newPage();

  // Intercept both accounts queries so we know when the sidebar data is ready.
  const accountsReady = Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/gmail/accounts/inactive"), { timeout: 30_000 }),
    page.waitForResponse((r) => r.url().includes("/api/gmail/accounts") && !r.url().includes("/inactive"), { timeout: 30_000 }),
  ]);

  await page.goto(`${BASE}/gmail`, { waitUntil: "load", timeout: 90_000 });
  await accountsReady;

  // Give React a moment to commit the DOM after the API responses arrive.
  await sleep(600);

  return page;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL not set — cannot run UI test");
    process.exit(1);
  }

  const pool   = new pg.Pool({ connectionString: dbUrl });
  const client = await pool.connect();

  console.log("=== Disconnected Mailbox Sidebar UI Test (Playwright) ===");
  console.log(`Fixture tag: ${FIXTURE_TAG}`);

  let ids;
  try {
    ids = await setup(client);
    console.log(`Fixtures created: userId=${ids.userId} accountId=${ids.accountId}`);
  } catch (e) {
    console.error("Setup failed:", e.message);
    client.release();
    await pool.end();
    process.exit(1);
  }

  const { accountId } = ids;

  console.log("Detecting Chromium launch path…");
  const launchPath = buildChromiumLaunchPath();

  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: launchPath });

    // ── U1: Disconnected account appears in sidebar with Reconnect badge ─────
    console.log("\n── U1: Reconnect row visible in sidebar on first load ──");
    {
      const page = await openAuthenticatedInbox(browser, FIXTURE_USER_EMAIL, FIXTURE_USER_PWD);
      console.log("  Logged in, inbox loaded.");

      // Container row
      const containerSel = `[data-testid="private-inbox-disconnected-${accountId}"]`;
      const containerVisible = await page.isVisible(containerSel).catch(() => false);
      if (containerVisible) ok(`disconnected container row visible (testid=private-inbox-disconnected-${accountId})`);
      else bad(`disconnected container row visible`, `selector "${containerSel}" not found`);

      // Reconnect badge
      const badgeSel = `[data-testid="badge-reconnect-${accountId}"]`;
      const badgeVisible = await page.isVisible(badgeSel).catch(() => false);
      if (badgeVisible) ok(`Reconnect badge visible (testid=badge-reconnect-${accountId})`);
      else bad(`Reconnect badge visible`, `selector "${badgeSel}" not found`);

      // The badge must contain the word "Reconnect"
      const badgeText = badgeVisible
        ? await page.textContent(badgeSel).catch(() => "")
        : "";
      if (badgeText?.trim() === "Reconnect") ok(`Reconnect badge text is "Reconnect"`);
      else bad(`Reconnect badge text is "Reconnect"`, `got: "${badgeText?.trim()}"`);

      await page.context().close();
    }

    // ── U2: Clicking the disconnected row does NOT load inbox messages ────────
    console.log("\n── U2: Clicking disconnected row navigates to OAuth (no inbox load) ──");
    {
      const page = await openAuthenticatedInbox(browser, FIXTURE_USER_EMAIL, FIXTURE_USER_PWD);

      // Track any /api/gmail/messages requests that fire after clicking
      const messagesRequests = [];
      page.on("request", (req) => {
        if (req.url().includes("/api/gmail/messages")) {
          messagesRequests.push(req.url());
        }
      });

      // Intercept navigation so we don't actually leave the page
      await page.route("**/api/auth/gmail/connect**", (route) => route.abort());

      const btnSel = `[data-testid="btn-reconnect-private-${accountId}"]`;
      const btnVisible = await page.isVisible(btnSel).catch(() => false);
      if (!btnVisible) {
        bad(`btn-reconnect-private-${accountId} visible before click`, "button not found");
      } else {
        ok(`btn-reconnect-private-${accountId} found in sidebar`);

        // Click and wait briefly for any API calls to fire
        await page.click(btnSel).catch(() => {});
        await sleep(1500);

        // The click targets /api/auth/gmail/connect, NOT /api/gmail/messages
        const didLoadMessages = messagesRequests.length > 0;
        if (!didLoadMessages) ok(`no /api/gmail/messages request fired after clicking disconnected row`);
        else bad(`no /api/gmail/messages request fired`, `requests fired: ${JSON.stringify(messagesRequests)}`);
      }

      await page.context().close();
    }

    // ── U3: Reconnect → disconnect cycle — account reappears ─────────────────
    console.log("\n── U3: Reconnect → disconnect cycle — row reappears ──");
    {
      // Step A: re-activate the account (simulate successful reconnect)
      await client.query(
        `UPDATE email_accounts SET is_active = true, auth_status = 'active' WHERE id = $1`,
        [accountId],
      );
      console.log("  Account re-activated in DB.");

      // Open inbox — disconnected row should be GONE
      const pageA = await openAuthenticatedInbox(browser, FIXTURE_USER_EMAIL, FIXTURE_USER_PWD);
      const containerAfterReconnect = `[data-testid="private-inbox-disconnected-${accountId}"]`;
      const visibleAfterReconnect = await pageA.isVisible(containerAfterReconnect).catch(() => false);
      if (!visibleAfterReconnect) ok(`disconnected row absent after reconnect`);
      else bad(`disconnected row absent after reconnect`, "row still visible — should have disappeared");

      await pageA.context().close();

      // Step B: disconnect again (simulate token expiry)
      await client.query(
        `UPDATE email_accounts SET is_active = false, auth_status = 'expired' WHERE id = $1`,
        [accountId],
      );
      console.log("  Account deactivated again in DB.");

      // Open inbox — disconnected row should reappear
      const pageB = await openAuthenticatedInbox(browser, FIXTURE_USER_EMAIL, FIXTURE_USER_PWD);
      const containerAfterDisconnect = `[data-testid="private-inbox-disconnected-${accountId}"]`;
      const visibleAfterDisconnect = await pageB.isVisible(containerAfterDisconnect).catch(() => false);
      if (visibleAfterDisconnect) ok(`disconnected row reappears after second disconnect`);
      else bad(`disconnected row reappears after second disconnect`, "row not found — cycle broke visibility");

      const badgeAfterCycle = `[data-testid="badge-reconnect-${accountId}"]`;
      const badgeReappeared = await pageB.isVisible(badgeAfterCycle).catch(() => false);
      if (badgeReappeared) ok(`Reconnect badge reappears after reconnect → disconnect cycle`);
      else bad(`Reconnect badge reappears after cycle`, "badge not found");

      await pageB.context().close();
    }

  } finally {
    if (browser) await browser.close();
    await teardown(client, ids);
    client.release();
    await pool.end();
  }

  console.log("======================================================");
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
