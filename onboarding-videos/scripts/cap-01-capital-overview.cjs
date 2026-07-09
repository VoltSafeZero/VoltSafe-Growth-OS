"use strict";
/**
 * Video 07 (cap-01) — Capital Module Overview
 * Storyboard: onboarding-videos/storyboards/cap-01-capital-overview.md
 * Run: node onboarding-videos/scripts/cap-01-capital-overview.cjs
 */

const {
  getBaseUrl, getCredentials,
  launchBrowser, createRecordingContext,
  login, enableDemoMode, waitForAppReady,
  pauseForViewer, pauseForNarration,
  showCallout, hideCallout, stepTitle,
  saveVideoWithReadableName,
} = require("./helpers.cjs");

(async () => {
  const BASE = getBaseUrl();
  const { email, password } = getCredentials();

  const browser = await launchBrowser();
  const context = await createRecordingContext(browser);
  const page    = await context.newPage();

  try {
    console.log("[cap-01] Logging in …");
    await login(page, BASE, email, password);
    await enableDemoMode(page);

    await stepTitle(page, "Capital Module Overview");
    await page.goto(`${BASE}/capital/dashboard`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "Your fundraising command center");
    await pauseForNarration(page, 3500);
    await hideCallout(page);

    await stepTitle(page, "Command Center");
    await page.goto(`${BASE}/capital/command-center`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "Round progress, risk flags, and next actions in one view");
    await pauseForNarration(page, 4000);
    await hideCallout(page);

    await stepTitle(page, "Rounds");
    await page.goto(`${BASE}/capital/rounds`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "Every round you've run or are running");
    await pauseForNarration(page, 3000);
    await hideCallout(page);

    await page.goto(`${BASE}/capital/command-center`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "This is where a CFO starts every morning");
    await pauseForViewer(2500);
    await hideCallout(page);

    console.log("[cap-01] Recording complete. Saving …");
  } catch (err) {
    console.error("[cap-01] FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await page.close();
    const saved = await saveVideoWithReadableName(page, "cap-01-capital-overview");
    await context.close();
    await browser.close();
    if (saved) console.log(`[cap-01] ✓ Saved → ${saved}`);
  }
})();
