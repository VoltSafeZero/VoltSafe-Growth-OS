"use strict";
/**
 * Video 09 (cap-03) — Data Room & Materials
 * Storyboard: onboarding-videos/storyboards/cap-03-data-room.md
 * Run: node onboarding-videos/scripts/cap-03-data-room.cjs
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
    console.log("[cap-03] Logging in …");
    await login(page, BASE, email, password);
    await enableDemoMode(page);

    await stepTitle(page, "Data Room & Materials");
    await page.goto(`${BASE}/capital/data-room`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "Diligence materials, organized by folder");
    await pauseForNarration(page, 3500);
    await hideCallout(page);

    await showCallout(page, "Mark confidentiality per document");
    await pauseForNarration(page, 3000);
    await hideCallout(page);

    await page.goto(`${BASE}/capital/command-center`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "Shared materials show up in the investor portal automatically");
    await pauseForViewer(3000);
    await hideCallout(page);

    console.log("[cap-03] Recording complete. Saving …");
  } catch (err) {
    console.error("[cap-03] FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await page.close();
    const saved = await saveVideoWithReadableName(page, "cap-03-data-room");
    await context.close();
    await browser.close();
    if (saved) console.log(`[cap-03] ✓ Saved → ${saved}`);
  }
})();
