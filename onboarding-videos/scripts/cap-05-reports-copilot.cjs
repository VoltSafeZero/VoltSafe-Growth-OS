"use strict";
/**
 * Video 11 (cap-05) — Reports & the AI Copilot
 * Storyboard: onboarding-videos/storyboards/cap-05-reports-copilot.md
 * Run: node onboarding-videos/scripts/cap-05-reports-copilot.cjs
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
    console.log("[cap-05] Logging in …");
    await login(page, BASE, email, password);
    await enableDemoMode(page);

    await stepTitle(page, "Reports & the AI Copilot");
    await page.goto(`${BASE}/capital/reports`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "Weekly briefs and board updates, generated for you");
    await pauseForNarration(page, 3500);
    await hideCallout(page);

    await stepTitle(page, "AI Copilot");
    await page.goto(`${BASE}/capital/copilot`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "Ask the Capital AI Copilot any investor question");
    await pauseForNarration(page, 4000);
    await hideCallout(page);

    await page.goto(`${BASE}/capital/command-center`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "That's the full Capital module tour");
    await pauseForViewer(2500);
    await hideCallout(page);

    console.log("[cap-05] Recording complete. Saving …");
  } catch (err) {
    console.error("[cap-05] FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await page.close();
    const saved = await saveVideoWithReadableName(page, "cap-05-reports-copilot");
    await context.close();
    await browser.close();
    if (saved) console.log(`[cap-05] ✓ Saved → ${saved}`);
  }
})();
