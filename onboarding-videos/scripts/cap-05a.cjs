"use strict";
/** cap-05 Part A — Reports & AI Copilot (sections 1-5) ~110s */
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

    await section(page, "Reports & the AI Copilot", `${BASE}/capital/reports`, [
      ["Reports surface the story your data is telling — for your board and co-founders.", 3500],
      ["The AI Copilot puts fundraising intelligence at your fingertips on demand.", 3500],
      ["Together they replace manual prep with instant, data-driven executive reporting.", 3500],
    ]);
    await section(page, "Reports Overview", `${BASE}/capital/reports`, [
      ["The Reports tab generates structured fundraising summaries from your live pipeline data.", 3500],
      ["No copy-paste, no manual formatting — data flows directly from the Capital module.", 3500],
      ["Reports are generated on demand and can be exported as PDF for board sharing.", 3500],
    ]);
    await section(page, "Weekly Fundraising Summary", `${BASE}/capital/reports`, [
      ["The weekly summary covers pipeline changes, new meetings, and stage progressions.", 3500],
      ["It highlights investors who moved forward, went cold, or committed this week.", 3500],
      ["Include it in your team standup so everyone stays aligned on fundraising status.", 3500],
    ]);
    await section(page, "Board Updates & Reporting", `${BASE}/capital/reports`, [
      ["Before every board meeting, generate a fundraising report from this tab.", 3500],
      ["It shows total committed, soft-circled, remaining to target, and key pipeline metrics.", 3500],
      ["Boards respond well to data-driven updates — avoid surprises with regular reporting.", 3500],
    ]);
    await section(page, "Fundraising Summary Reports", `${BASE}/capital/reports`, [
      ["Fundraising summaries capture where you are in the round at a point in time.", 3500],
      ["They include pipeline stage breakdown, engagement metrics, and commitment velocity.", 3500],
      ["Run one at the start of each month to track round momentum over time.", 3500],
    ]);

    console.log("[cap-05a] Done. Saving…");
  } catch (err) {
    console.error("[cap-05a] FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await page.close();
    const saved = await saveVideoWithReadableName(page, "cap-05a");
    await context.close();
    await browser.close();
    if (saved) console.log(`[cap-05a] ✓ ${saved}`);
  }
})();
