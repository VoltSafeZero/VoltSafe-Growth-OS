"use strict";
/** cap-02 Part B — Investor Pipeline & Commitments (sections 6-10) ~110s */
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

    await section(page, "Logging Meetings & Notes", `${BASE}/capital/pipeline`, [
      ["After every investor meeting, log it immediately — memory fades fast.", 3500],
      ["Record the date, attendees, what was discussed, and key signals from the conversation.", 3500],
      ["Set a next action and due date so your follow-up never gets forgotten.", 3500],
    ]);
    await section(page, "Filtering & Searching the Pipeline", `${BASE}/capital/pipeline`, [
      ["Use filters to focus on a specific stage — for example, everyone in Diligence.", 3500],
      ["Search by investor name or firm to quickly find a specific record.", 3500],
      ["Filter by allocation size to prioritise your largest potential investors first.", 3500],
    ]);
    await section(page, "Investor Contacts & Relationships", `${BASE}/capital/pipeline`, [
      ["Each investor record links to their key contacts — managing partner, associate, analyst.", 3500],
      ["Track who internally owns the relationship to avoid conflicting outreach.", 3500],
      ["Good contact management shortens the time from first meeting to commitment.", 3500],
    ]);
    await section(page, "Pipeline View from Command Center", `${BASE}/capital/command-center`, [
      ["The Command Center always shows a live summary of your pipeline state.", 3500],
      ["You can see total investors by stage, committed capital, and risk flags in one view.", 3500],
      ["When a flag is red, click through to see which investors need immediate attention.", 3500],
    ]);
    await section(page, "Investor Pipeline — Best Practices", `${BASE}/capital/pipeline`, [
      ["Update investor stages the same day as meetings — stale data leads to missed follow-ups.", 3500],
      ["Always record the allocation amount when an investor signals interest.", 3500],
      ["A well-maintained pipeline gives you an accurate probability-weighted raise forecast.", 3500],
    ]);

    console.log("[cap-02b] Done. Saving…");
  } catch (err) {
    console.error("[cap-02b] FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await page.close();
    const saved = await saveVideoWithReadableName(page, "cap-02b");
    await context.close();
    await browser.close();
    if (saved) console.log(`[cap-02b] ✓ ${saved}`);
  }
})();
