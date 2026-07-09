"use strict";
/**
 * Video 10 (cap-04) — Follow-Ups & Engagement Tracking
 * Storyboard: onboarding-videos/storyboards/cap-04-followups-engagement.md
 * Run: node onboarding-videos/scripts/cap-04-followups-engagement.cjs
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
    console.log("[cap-04] Logging in …");
    await login(page, BASE, email, password);
    await enableDemoMode(page);

    await stepTitle(page, "Follow-Ups & Engagement Tracking");
    await page.goto(`${BASE}/capital/follow-ups`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "Never lose track of an investor conversation");
    await pauseForNarration(page, 3500);
    await hideCallout(page);

    await stepTitle(page, "Engagement");
    await page.goto(`${BASE}/capital/engagement`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "Who's warm and who's gone quiet");
    await pauseForNarration(page, 4000);
    await hideCallout(page);

    await page.goto(`${BASE}/capital/command-center`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "Engagement risk flags surface here automatically");
    await pauseForViewer(2500);
    await hideCallout(page);

    console.log("[cap-04] Recording complete. Saving …");
  } catch (err) {
    console.error("[cap-04] FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await page.close();
    const saved = await saveVideoWithReadableName(page, "cap-04-followups-engagement");
    await context.close();
    await browser.close();
    if (saved) console.log(`[cap-04] ✓ Saved → ${saved}`);
  }
})();
