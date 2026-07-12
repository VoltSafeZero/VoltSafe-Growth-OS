"use strict";
/** cap-05 Part B — Reports & AI Copilot (sections 6-11) ~110s */
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

    await section(page, "AI Copilot — Introduction", `${BASE}/capital/copilot`, [
      ["The AI Copilot is a conversational intelligence layer built on your live Capital data.", 3500],
      ["It understands your investors, your pipeline, your notes, and your follow-up history.", 3500],
      ["Ask questions in plain language — it responds with investor-specific, grounded answers.", 3500],
    ]);
    await section(page, "Asking the Copilot Questions", `${BASE}/capital/copilot`, [
      ["Try: Which investors have not responded in the past two weeks?", 3500],
      ["Try: Who is currently in diligence and what are their outstanding questions?", 3500],
      ["Try: What is our probability-weighted committed capital right now?", 3500],
    ]);
    await section(page, "Generating AI Summaries", `${BASE}/capital/copilot`, [
      ["Ask the Copilot to generate a board-ready pipeline summary in seconds.", 3500],
      ["It structures the output in a format ready for executive communication.", 3500],
      ["Use generated summaries as a starting point — review and refine before sharing.", 3500],
    ]);
    await section(page, "Investor Insights from the Copilot", `${BASE}/capital/copilot`, [
      ["Ask the Copilot for insights on specific investors before a meeting.", 3500],
      ["It synthesises their meeting notes, email history, and engagement signals.", 3500],
      ["You get a briefing in plain language: what they care about, where they stand.", 3500],
    ]);
    await section(page, "Reports & Copilot — Putting It Together", `${BASE}/capital/command-center`, [
      ["End of week: generate a weekly summary from Reports, share with your team.", 3500],
      ["Before board: use the Copilot to draft your fundraising narrative, refine, export.", 3500],
      ["Reporting and intelligence together create a professional, data-driven fundraise.", 3500],
    ]);

    console.log("[cap-05b] Done. Saving…");
  } catch (err) {
    console.error("[cap-05b] FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await page.close();
    const saved = await saveVideoWithReadableName(page, "cap-05b");
    await context.close();
    await browser.close();
    if (saved) console.log(`[cap-05b] ✓ ${saved}`);
  }
})();
