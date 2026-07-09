"use strict";
/**
 * Video 08 (cap-02) — Investor Pipeline & Commitments
 * Storyboard: onboarding-videos/storyboards/cap-02-investor-pipeline.md
 * Run: node onboarding-videos/scripts/cap-02-investor-pipeline.cjs
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
    console.log("[cap-02] Logging in …");
    await login(page, BASE, email, password);
    await enableDemoMode(page);

    await stepTitle(page, "Investor Pipeline & Commitments");
    await page.goto(`${BASE}/capital/pipeline`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "Investors move through stages just like sales deals");
    await pauseForNarration(page, 3500);
    await hideCallout(page);

    await stepTitle(page, "Targets");
    await page.goto(`${BASE}/capital/targets`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "Your full investor target list");
    await pauseForNarration(page, 3000);
    await hideCallout(page);

    await stepTitle(page, "Commitments");
    await page.goto(`${BASE}/capital/commitments`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "Soft circles and hard commitments, tracked against target");
    await pauseForNarration(page, 4000);
    await hideCallout(page);

    await page.goto(`${BASE}/capital/command-center`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "Committed vs. target rolls up here");
    await pauseForViewer(2500);
    await hideCallout(page);

    console.log("[cap-02] Recording complete. Saving …");
  } catch (err) {
    console.error("[cap-02] FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await page.close();
    const saved = await saveVideoWithReadableName(page, "cap-02-investor-pipeline");
    await context.close();
    await browser.close();
    if (saved) console.log(`[cap-02] ✓ Saved → ${saved}`);
  }
})();
