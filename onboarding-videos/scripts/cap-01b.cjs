"use strict";
/** cap-01 Part B — Capital Module Overview (sections 6-11) ~110s */
const { getBaseUrl, getCredentials, launchBrowser, createRecordingContext,
  login, enableDemoMode, waitForAppReady, pauseForViewer, pauseForNarration,
  showCallout, hideCallout, stepTitle, saveVideoWithReadableName,
} = require("./helpers.cjs");

async function section(page, title, url, callouts) {
  await stepTitle(page, title);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
  await pauseForViewer(800);
  for (const [text, ms] of callouts) {
    await showCallout(page, text);
    await pauseForNarration(page, ms || 3500);
    await hideCallout(page);
    await pauseForViewer(500);
  }
}

(async () => {
  const BASE = getBaseUrl();
  const { email, password } = getCredentials();
  const browser = await launchBrowser();
  const context = await createRecordingContext(browser);
  const page = await context.newPage();
  try {
    await login(page, BASE, email, password);
    await enableDemoMode(page);

    await section(page, "Data Room — Organize Diligence Materials", `${BASE}/capital/data-room`, [
      ["The Data Room stores all investor diligence materials in organized folders.", 3500],
      ["Mark documents confidential to restrict access to approved investors only.", 3500],
      ["Shared documents become available in the investor portal automatically.", 3500],
    ]);
    await section(page, "Engagement — Track Investor Warmth", `${BASE}/capital/engagement`, [
      ["Engagement shows which investors are warm and which have gone cold.", 3500],
      ["Warmth is scored from meeting frequency, email responses, and document views.", 3500],
      ["Use this view to prioritise your outreach each week.", 3500],
    ]);
    await section(page, "Reports — Weekly Summaries & Board Updates", `${BASE}/capital/reports`, [
      ["Reports generates weekly fundraising summaries and board-ready updates.", 3500],
      ["No manual formatting — data flows directly from the Capital module.", 3500],
      ["Export as PDF to share with your board or co-founders.", 3500],
    ]);
    await section(page, "AI Copilot — Fundraising Intelligence", `${BASE}/capital/copilot`, [
      ["The AI Copilot answers investor questions from your live pipeline data.", 3500],
      ["Ask: Which investors have not responded in two weeks?", 3500],
      ["Or: Summarise the current state of our Series A pipeline.", 3500],
    ]);
    await section(page, "Daily Workflow — Putting It All Together", `${BASE}/capital/command-center`, [
      ["Morning: open Command Center, review flags, check Follow-Ups.", 3500],
      ["Log meetings from yesterday, update investor stages in the Pipeline.", 3500],
      ["End the week with a Report shared to your board. That is the Capital module.", 3500],
    ]);

    console.log("[cap-01b] Done. Saving…");
  } catch (err) {
    console.error("[cap-01b] FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await page.close();
    const saved = await saveVideoWithReadableName(page, "cap-01b");
    await context.close();
    await browser.close();
    if (saved) console.log(`[cap-01b] ✓ ${saved}`);
  }
})();
