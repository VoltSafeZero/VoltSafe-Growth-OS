"use strict";
/** cap-02 Part A — Investor Pipeline & Commitments (sections 1-5) ~110s */
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

    await section(page, "Investor Pipeline & Commitments", `${BASE}/capital/pipeline`, [
      ["The Pipeline is the heart of your fundraising operation — every investor lives here.", 3500],
      ["Think of it like a CRM built specifically for raising a funding round.", 3500],
      ["Every investor has a stage, an allocation target, and a contact owner.", 3500],
    ]);
    await section(page, "Understanding the Pipeline View", `${BASE}/capital/pipeline`, [
      ["Each row shows the investor, their firm, target allocation, and current stage.", 3500],
      ["Stages flow left to right: Prospect, First Meeting, Diligence, Soft Circle, Committed.", 3500],
      ["Colour coding gives you instant signal — warm investors are highlighted.", 3500],
    ]);
    await section(page, "Moving Investors Through Stages", `${BASE}/capital/pipeline`, [
      ["Every new investor starts as a Prospect — someone you plan to approach.", 3500],
      ["After a successful first meeting, advance them to First Meeting and log notes.", 3500],
      ["Diligence means they asked for data room access — a strong buying signal.", 3500],
    ]);
    await section(page, "Rounds & Commitments — Tracking Progress", `${BASE}/capital/rounds`, [
      ["The Rounds view shows your target raise against what is confirmed so far.", 3500],
      ["The progress bar fills automatically as investors move to Committed in the Pipeline.", 3500],
      ["Hard commitments are signed. You can see your gap-to-close at all times.", 3500],
    ]);
    await section(page, "Recording Soft Circles", `${BASE}/capital/pipeline`, [
      ["A soft circle is a verbal commitment — not signed, but highly likely.", 3500],
      ["Record it in the Pipeline by updating the stage to Soft Circle and noting the amount.", 3500],
      ["Soft circles inform your probability-weighted forecast — never count them as closed.", 3500],
    ]);

    console.log("[cap-02a] Done. Saving…");
  } catch (err) {
    console.error("[cap-02a] FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await page.close();
    const saved = await saveVideoWithReadableName(page, "cap-02a");
    await context.close();
    await browser.close();
    if (saved) console.log(`[cap-02a] ✓ ${saved}`);
  }
})();
