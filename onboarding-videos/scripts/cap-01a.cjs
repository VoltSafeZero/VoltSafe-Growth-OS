"use strict";
/** cap-01 Part A — Capital Module Overview (sections 1-5) ~110s */
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

    await section(page, "Welcome to the Capital Module", `${BASE}/capital/command-center`, [
      ["The Capital module is your end-to-end fundraising operating system.", 3500],
      ["It replaces spreadsheets and disconnected tools with one unified workspace.", 3500],
      ["Everything a CFO or CEO needs to run a funding round lives here.", 3500],
    ]);
    await section(page, "Command Center — Your Daily Dashboard", `${BASE}/capital/command-center`, [
      ["Open the Command Center every morning to see your fundraising health at a glance.", 3500],
      ["KPIs at the top show committed capital, soft circles, and remaining gap-to-target.", 3500],
      ["Red flags indicate investors overdue for follow-up or who have gone quiet.", 3500],
    ]);
    await section(page, "Follow-Ups — Never Miss an Investor", `${BASE}/capital/follow-ups`, [
      ["The Follow-Ups tab tracks every outstanding investor action in one place.", 3500],
      ["Each entry shows the investor, action required, assigned owner, and due date.", 3500],
      ["Overdue items are highlighted — prioritise these first every morning.", 3500],
    ]);
    await section(page, "Investor Pipeline", `${BASE}/capital/pipeline`, [
      ["The Pipeline shows every investor you are tracking for this round.", 3500],
      ["Investors move through stages: Prospect → Meeting → Diligence → Committed.", 3500],
      ["Each card shows the investor's firm, target allocation, and current stage.", 3500],
    ]);
    await section(page, "Rounds & Commitments", `${BASE}/capital/rounds`, [
      ["Rounds tracks your target raise against confirmed and soft-circled capital.", 3500],
      ["Hard commitments are signed. Soft circles are verbal indications of interest.", 3500],
      ["The progress bar updates automatically as investors commit.", 3500],
    ]);

    console.log("[cap-01a] Done. Saving…");
  } catch (err) {
    console.error("[cap-01a] FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await page.close();
    const saved = await saveVideoWithReadableName(page, "cap-01a");
    await context.close();
    await browser.close();
    if (saved) console.log(`[cap-01a] ✓ ${saved}`);
  }
})();
