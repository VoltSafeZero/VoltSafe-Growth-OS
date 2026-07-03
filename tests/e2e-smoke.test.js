/**
 * Authenticated E2E Smoke Test — VoltSafe Growth OS
 *
 * Verifies sidebar structure and CURRENTS route after login.
 * Requires env vars; skips cleanly when missing.
 *
 * Usage:
 *   E2E_BASE_URL=http://localhost:5000 \
 *   E2E_EMAIL=admin@voltsafe.com \
 *   E2E_PASSWORD=yourpassword \
 *   node tests/e2e-smoke.test.js
 *
 * Against production:
 *   E2E_BASE_URL=https://yourapp.replit.app \
 *   E2E_EMAIL=... E2E_PASSWORD=... \
 *   node tests/e2e-smoke.test.js
 *
 * If any env var is missing the test exits 0 with a skip message.
 * This ensures normal CI / test:grep readiness reports are not broken
 * when credentials are not present.
 *
 * See docs/e2e-smoke-guide.md for full documentation.
 */

"use strict";

const BASE_URL  = process.env.E2E_BASE_URL;
const EMAIL     = process.env.E2E_EMAIL;
const PASSWORD  = process.env.E2E_PASSWORD;
const HEADLESS  = process.env.E2E_HEADLESS !== "false"; // headless by default
const SLOW_MO   = Number(process.env.E2E_SLOW_MO) || 0;
const TIMEOUT   = Number(process.env.E2E_TIMEOUT_MS) || 15_000;

// ── Skip cleanly when credentials are absent ─────────────────────────────────
if (!BASE_URL || !EMAIL || !PASSWORD) {
  console.log("⏭  skipped: requires E2E_BASE_URL, E2E_EMAIL, and E2E_PASSWORD");
  process.exit(0);
}

// ── Minimal tap-style reporter ────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function ok(label) {
  passed++;
  console.log(`  ✓ ${label}`);
}

function bad(label, detail) {
  failed++;
  const msg = detail ? `${label} — ${detail}` : label;
  failures.push(msg);
  console.log(`  ✗ ${msg}`);
}

// ── Playwright import ─────────────────────────────────────────────────────────
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (e) {
  console.error("Playwright not found. Run: npm install playwright");
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function waitForSelector(page, sel, opts = {}) {
  return page.waitForSelector(sel, { timeout: TIMEOUT, ...opts });
}

async function exists(page, sel) {
  try {
    await page.waitForSelector(sel, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function notExists(page, sel) {
  return !(await exists(page, sel));
}

/**
 * Return the top-to-bottom Y-position of a testid element.
 * Used to verify ordering in the sidebar.
 */
async function yOf(page, testid) {
  const el = page.$(`[data-testid="${testid}"]`);
  if (!el) return Infinity;
  try {
    const box = await (await page.$(`[data-testid="${testid}"]`)).boundingBox();
    return box ? box.y : Infinity;
  } catch {
    return Infinity;
  }
}

// ── Main test runner ──────────────────────────────────────────────────────────
(async () => {
  const browser = await chromium.launch({ headless: HEADLESS, slowMo: SLOW_MO });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  try {
    // ── Section 1: Login ───────────────────────────────────────────────────
    console.log("\n── 1. Login ──");

    await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });

    const emailInput = await page.$('[data-testid="input-login-email"]');
    if (!emailInput) { bad("login email input found"); }
    else {
      await emailInput.fill(EMAIL);
      ok("email filled");
    }

    const pwInput = await page.$('[data-testid="input-login-password"]');
    if (!pwInput) { bad("login password input found"); }
    else {
      await pwInput.fill(PASSWORD);
      ok("password filled");
    }

    await Promise.all([
      page.waitForNavigation({ timeout: TIMEOUT, waitUntil: "networkidle" }).catch(() => {}),
      page.click('[data-testid="button-login"]'),
    ]);

    // Verify login succeeded — sidebar home link is the post-login landmark
    const loggedIn = await exists(page, '[data-testid="link-sidebar-home"]');
    if (loggedIn) {
      ok("login succeeded — sidebar visible");
    } else {
      bad("login succeeded — sidebar not found after submit");
      // Cannot continue without sidebar
      await browser.close();
      printSummary();
      process.exit(failed > 0 ? 1 : 0);
    }

    // ── Section 2: Top-level sidebar sections ─────────────────────────────
    console.log("\n── 2. Sidebar top-level sections ──");

    // Today
    if (await exists(page, '[data-testid="nav-section-today"]')) {
      ok("Today section present");
    } else {
      bad("Today section present");
    }

    // CURRENTS
    if (await exists(page, '[data-testid="nav-section-currents"]')) {
      ok("CURRENTS section present");
    } else {
      bad("CURRENTS section present");
    }

    // Work
    if (await exists(page, '[data-testid="nav-section-work"]')) {
      ok("Work section present");
    } else {
      bad("Work section present");
    }

    // Learn
    if (await exists(page, '[data-testid="nav-section-learn"]')) {
      ok("Learn section present");
    } else {
      bad("Learn section present");
    }

    // ── Section 3: Retired sections — must NOT appear ─────────────────────
    console.log("\n── 3. Retired nav entries absent ──");

    if (await notExists(page, '[data-testid="nav-section-more"]')) {
      ok("More section NOT present (retired)");
    } else {
      bad("More section should be retired but is visible");
    }

    // "Asset Library" was renamed to "Knowledge Assets" — should not appear
    // as a user-facing sidebar label
    const pageText = await page.textContent("body");
    if (!/Asset Library/.test(pageText)) {
      ok("'Asset Library' label not visible in sidebar");
    } else {
      // It might legitimately appear in page content — narrow to sidebar only
      const sidebarEl = await page.$('[data-sidebar="sidebar"]');
      const sidebarText = sidebarEl ? await sidebarEl.textContent() : "";
      if (!/Asset Library/.test(sidebarText)) {
        ok("'Asset Library' label not present in sidebar element");
      } else {
        bad("'Asset Library' label found in sidebar (should be 'Knowledge Assets')");
      }
    }

    // Task Rules must not be a standalone sidebar entry
    if (await notExists(page, '[data-testid="nav-task-rules"]')) {
      ok("Task Rules NOT a standalone sidebar label");
    } else {
      bad("Task Rules appears as standalone sidebar item (should be inside Automations)");
    }

    // ── Section 4: Ordering — CURRENTS before Work ────────────────────────
    console.log("\n── 4. CURRENTS appears above Work ──");

    const yCurrents = await yOf(page, "nav-section-currents");
    const yWork     = await yOf(page, "nav-section-work");
    const yToday    = await yOf(page, "nav-section-today");

    if (yToday < yCurrents) {
      ok("Today is above CURRENTS (correct order)");
    } else {
      bad("Today should appear above CURRENTS");
    }

    if (yCurrents < yWork) {
      ok("CURRENTS is above Work (correct order)");
    } else {
      bad("CURRENTS should appear above Work");
    }

    // ── Section 5: Learn sub-items (Training, Help) ───────────────────────
    console.log("\n── 5. Learn section items ──");

    // Expand Learn section
    await page.click('[data-testid="nav-section-learn"]');
    await page.waitForTimeout(300);

    if (await exists(page, '[data-testid="nav-training"]')) {
      ok("Training item present inside Learn");
    } else {
      bad("Training item missing from Learn section");
    }

    if (await exists(page, '[data-testid="nav-help"]')) {
      ok("Help item present inside Learn");
    } else {
      bad("Help item missing from Learn section");
    }

    // ── Section 6: Work sub-items (Document Hub) ──────────────────────────
    console.log("\n── 6. Work section items ──");

    await page.click('[data-testid="nav-section-work"]');
    await page.waitForTimeout(300);

    if (await exists(page, '[data-testid="nav-document-hub"]')) {
      ok("Document Hub item present inside Work");
    } else {
      bad("Document Hub item missing from Work section");
    }

    // ── Section 7: Admin items (if admin account) ─────────────────────────
    console.log("\n── 7. Admin section items ──");

    const hasAdmin = await exists(page, '[data-testid="nav-section-admin"]');
    if (!hasAdmin) {
      ok("Admin section not visible (non-admin account — skipping admin checks)");
    } else {
      await page.click('[data-testid="nav-section-admin"]');
      await page.waitForTimeout(300);

      if (await exists(page, '[data-testid="nav-automations"]')) {
        ok("Automations item present inside Admin");
      } else {
        bad("Automations item missing from Admin section");
      }

      if (await notExists(page, '[data-testid="nav-task-rules"]')) {
        ok("Task Rules NOT a standalone Admin item (lives inside Automations tab)");
      } else {
        bad("Task Rules should NOT be a standalone Admin item");
      }
    }

    // ── Section 8: CURRENTS route loads ───────────────────────────────────
    console.log("\n── 8. CURRENTS route ──");

    // Click CURRENTS section button to navigate
    await page.click('[data-testid="nav-section-currents"]');
    await page.waitForTimeout(800);

    // Also try navigating directly in case the section is collapsed
    const url = page.url();
    if (!url.includes("/current")) {
      await page.goto(`${BASE_URL}/current`, { waitUntil: "networkidle" });
    }

    if (await exists(page, '[data-testid="currents-workspace-shell"]')) {
      ok("CURRENTS workspace shell loaded");
    } else {
      bad("CURRENTS workspace shell not found at /current");
    }

    // No error boundary — check for known React error class
    const hasErrorBoundary = await page.$(".error-boundary, [data-error-boundary]");
    if (!hasErrorBoundary) {
      ok("No error boundary / crash detected");
    } else {
      bad("Error boundary element found — CURRENTS may have crashed");
    }

    // Check URL landed on /current
    const finalUrl = page.url();
    if (finalUrl.includes("/current")) {
      ok(`CURRENTS URL confirmed: ${finalUrl}`);
    } else {
      bad(`CURRENTS URL unexpected: ${finalUrl}`);
    }

    // ── Section 9: Theme — no crash check ────────────────────────────────
    console.log("\n── 9. Theme smoke (visual crash check) ──");

    // Verify the page is still rendering content (not a white/blank screen)
    const bodyText = (await page.textContent("body")).trim();
    if (bodyText.length > 20) {
      ok("Page body has rendered content (not blank)");
    } else {
      bad("Page body appears blank — possible render crash");
    }

    // ── Section 10: /automations?tab=task-rules deep-link ────────────────
    console.log("\n── 10. Automations ?tab=task-rules deep-link ──");

    await page.goto(`${BASE_URL}/automations?tab=task-rules`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    const deepLinkUrl = page.url();
    if (deepLinkUrl.includes("/automations")) {
      ok("Deep-link to /automations?tab=task-rules did not redirect to login");
    } else {
      bad(`Deep-link redirected unexpectedly: ${deepLinkUrl}`);
    }

    // No crash on this route
    const automationsText = (await page.textContent("body")).trim();
    if (automationsText.length > 20) {
      ok("Automations page rendered content (not blank)");
    } else {
      bad("Automations page appears blank");
    }

  } catch (err) {
    bad("Unexpected error during smoke test", err.message);
    console.error(err);
  } finally {
    await browser.close();
  }

  printSummary();
  process.exit(failed > 0 ? 1 : 0);
})();

function printSummary() {
  console.log("\n" + "=".repeat(60));
  if (failures.length > 0) {
    console.log("Failures:");
    failures.forEach((f) => console.log(`  ✗ ${f}`));
    console.log("=".repeat(60));
  }
  console.log(`E2E Smoke: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log("\n✅ All smoke checks passed");
  } else {
    console.log("\n❌ Smoke test FAILED");
  }
}
