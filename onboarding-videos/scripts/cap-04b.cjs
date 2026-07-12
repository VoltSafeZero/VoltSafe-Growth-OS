"use strict";
/** cap-04 Part B — Follow-Ups & Engagement (sections 6-10) ~110s */
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

    await section(page, "Assigning Ownership", `${BASE}/capital/follow-ups`, [
      ["Every investor relationship should have one primary owner — CEO or CFO.", 3500],
      ["One person is always accountable for follow-through — secondary owners can support.", 3500],
      ["Owner assignment prevents the most common fundraising failure: no one follows up.", 3500],
    ]);
    await section(page, "Engagement Heat Map", `${BASE}/capital/engagement`, [
      ["The Engagement view visualises investor warmth across your entire pipeline.", 3500],
      ["Warmth is scored from meeting frequency, email responses, and document views.", 3500],
      ["Hot investors are actively engaged. Cold investors have gone quiet.", 3500],
    ]);
    await section(page, "Warm vs Cold — What to Do", `${BASE}/capital/engagement`, [
      ["For warm investors: maintain momentum — do not let too much time pass between touches.", 3500],
      ["For cold investors: try a different medium — if email is not working, pick up the phone.", 3500],
      ["A cold investor for 30+ days with no response should be deprioritised for now.", 3500],
    ]);
    await section(page, "Reviewing Upcoming Follow-Ups", `${BASE}/capital/follow-ups`, [
      ["Review your upcoming follow-up list every Monday morning before the week begins.", 3500],
      ["Identify which actions are due this week and confirm owners are aware.", 3500],
      ["Reschedule overdue items immediately rather than leaving them as red flags.", 3500],
    ]);
    await section(page, "Daily Workflow — Follow-Ups in Action", `${BASE}/capital/command-center`, [
      ["Morning: open Command Center, check flags, review Follow-Ups overdue list.", 3500],
      ["Log meetings and calls from yesterday before the details fade.", 3500],
      ["Afternoon: process email replies, update investor stages, assign new tasks.", 3500],
    ]);

    console.log("[cap-04b] Done. Saving…");
  } catch (err) {
    console.error("[cap-04b] FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await page.close();
    const saved = await saveVideoWithReadableName(page, "cap-04b");
    await context.close();
    await browser.close();
    if (saved) console.log(`[cap-04b] ✓ ${saved}`);
  }
})();
