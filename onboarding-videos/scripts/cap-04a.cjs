"use strict";
/** cap-04 Part A — Follow-Ups & Engagement (sections 1-5) ~110s */
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

    await section(page, "Follow-Ups & Engagement Tracking", `${BASE}/capital/follow-ups`, [
      ["Fundraising is relationship management at scale — follow-up is everything.", 3500],
      ["This module ensures no investor conversation falls through the cracks.", 3500],
      ["Every touchpoint is logged, every owner is assigned, every deadline is tracked.", 3500],
    ]);
    await section(page, "Follow-Ups View Overview", `${BASE}/capital/follow-ups`, [
      ["The Follow-Ups list shows all outstanding investor actions sorted by urgency.", 3500],
      ["Each row shows the investor, the action required, the assigned owner, and the due date.", 3500],
      ["Overdue items are highlighted in red — prioritise these every morning.", 3500],
    ]);
    await section(page, "Logging Investor Meetings", `${BASE}/capital/follow-ups`, [
      ["After every investor meeting, log it immediately — memory fades fast.", 3500],
      ["Record the date, attendees, what was discussed, and key signals from the conversation.", 3500],
      ["Note any objections raised — these become talking points for the next meeting.", 3500],
    ]);
    await section(page, "Logging Calls & Emails", `${BASE}/capital/follow-ups`, [
      ["Every call and email exchange with an investor should be logged, even brief ones.", 3500],
      ["Calls: log duration, participants, key takeaways, and agreed next steps.", 3500],
      ["Consistent logging builds an accurate picture of investor engagement over time.", 3500],
    ]);
    await section(page, "Creating Follow-Up Tasks", `${BASE}/capital/follow-ups`, [
      ["After every interaction, create a follow-up task with a specific due date.", 3500],
      ["Be precise: send the model by Friday, call Tuesday — vague tasks get forgotten.", 3500],
      ["Tasks roll up to the Command Center so leadership can see pending investor actions.", 3500],
    ]);

    console.log("[cap-04a] Done. Saving…");
  } catch (err) {
    console.error("[cap-04a] FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await page.close();
    const saved = await saveVideoWithReadableName(page, "cap-04a");
    await context.close();
    await browser.close();
    if (saved) console.log(`[cap-04a] ✓ ${saved}`);
  }
})();
