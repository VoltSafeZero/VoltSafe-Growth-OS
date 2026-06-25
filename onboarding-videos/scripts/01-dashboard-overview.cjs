"use strict";
/**
 * Video 01 — VoltSafe CMS Dashboard Overview
 *
 * Shows the main dashboard, high-level navigation, and a quick tour of
 * the CRM, Mail, Accounts, Leads, Pipeline, and AI areas.
 *
 * Run:  npm run video:dashboard
 */

const {
  getBaseUrl, getCredentials,
  launchBrowser, createRecordingContext,
  login, enableDemoMode, waitForAppReady,
  pauseForViewer, saveVideoWithReadableName,
} = require("./helpers.cjs");

(async () => {
  const BASE = getBaseUrl();
  const { email, password } = getCredentials();

  const browser = await launchBrowser();
  const context = await createRecordingContext(browser);
  const page    = await context.newPage();

  try {
    console.log("[01] Logging in …");
    await login(page, BASE, email, password);
    await enableDemoMode(page);

    // Section 1: Role Command Center (home)
    console.log("[01] Dashboard / home …");
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await pauseForViewer(3000);

    // Section 2: Executive Dashboard
    console.log("[01] Executive Dashboard …");
    await page.goto(`${BASE}/executive-dashboard`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await pauseForViewer(3500);

    // Section 3: CRM — Leads
    console.log("[01] Leads (CRM) …");
    await page.goto(`${BASE}/opportunities`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await pauseForViewer(2500);

    // Section 4: Accounts
    console.log("[01] Accounts …");
    await page.goto(`${BASE}/accounts`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await pauseForViewer(2500);

    // Section 5: Pipeline
    console.log("[01] Pipeline …");
    await page.goto(`${BASE}/pipeline`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await pauseForViewer(2500);

    // Section 6: VoltSafe Mail
    console.log("[01] VoltSafe Mail …");
    await page.goto(`${BASE}/gmail`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await pauseForViewer(3000);

    // Section 7: AI Copilot
    console.log("[01] AI Copilot …");
    await page.goto(`${BASE}/executive-copilot`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await pauseForViewer(3000);

    // Section 8: Return home
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await pauseForViewer(2000);

    console.log("[01] Recording complete. Saving …");
  } catch (err) {
    console.error("[01] FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await page.close();
    const saved = await saveVideoWithReadableName(page, "01-dashboard-overview");
    await context.close();
    await browser.close();
    if (saved) console.log(`[01] ✓ Saved → ${saved}`);
  }
})();
