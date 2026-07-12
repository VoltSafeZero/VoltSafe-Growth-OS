"use strict";
/**
 * Video 11 (cap-05) — Reports & the AI Copilot
 * Target runtime: ~3.5–4 min
 * Storyboard: onboarding-videos/storyboards/cap-05-reports-copilot.md
 * Run: node onboarding-videos/scripts/cap-05-reports-copilot.cjs
 */

const {
  getBaseUrl, getCredentials,
  launchBrowser, createRecordingContext,
  login, enableDemoMode, waitForAppReady,
  pauseForViewer, pauseForNarration,
  showCallout, hideCallout, stepTitle,
  saveVideoWithReadableName,
} = require("./helpers.cjs");

async function section(page, title, url, callouts) {
  await stepTitle(page, title);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
  await pauseForViewer(1000);
  for (const [text, ms] of callouts) {
    await showCallout(page, text);
    await pauseForNarration(page, ms || 5000);
    await hideCallout(page);
    await pauseForViewer(600);
  }
}

(async () => {
  const BASE = getBaseUrl();
  const { email, password } = getCredentials();

  const browser = await launchBrowser();
  const context = await createRecordingContext(browser);
  const page    = await context.newPage();

  try {
    console.log("[cap-05] Logging in …");
    await login(page, BASE, email, password);
    await enableDemoMode(page);

    // ── SECTION 1: Introduction ──────────────────────────────────────────
    await section(page, "Reports & the AI Copilot", `${BASE}/capital/reports`, [
      ["This walkthrough covers the reporting layer and AI intelligence tools in the Capital module.", 5500],
      ["Reports surface the story your data is telling — for your board, co-founders, and advisors.", 5000],
      ["The AI Copilot puts that analysis at your fingertips on demand.", 4500],
    ]);

    // ── SECTION 2: Reports Overview ──────────────────────────────────────
    await section(page, "Reports Overview", `${BASE}/capital/reports`, [
      ["The Reports tab generates structured fundraising summaries from your live pipeline data.", 5500],
      ["No copy-paste, no manual formatting — data flows directly from the Capital module.", 5000],
      ["Reports are generated on demand and can be exported as PDF or shared digitally.", 4500],
      ["Each report is timestamped so your board can track progress across meetings.", 4500],
    ]);

    // ── SECTION 3: Weekly Fundraising Summary ────────────────────────────
    await section(page, "Weekly Fundraising Summary", `${BASE}/capital/reports`, [
      ["The weekly summary covers: pipeline changes, new meetings, stage progressions.", 5000],
      ["It highlights investors who moved forward, went cold, or committed this week.", 5500],
      ["Include it in your team standup so everyone stays aligned on fundraising status.", 5000],
      ["A consistent weekly cadence builds discipline and keeps momentum through the raise.", 4500],
    ]);

    // ── SECTION 4: Board Reporting ───────────────────────────────────────
    await section(page, "Board Updates & Reporting", `${BASE}/capital/reports`, [
      ["Before every board meeting, generate a fundraising report from this tab.", 5000],
      ["It shows total committed, soft-circled, remaining to target, and key pipeline metrics.", 5500],
      ["Boards respond well to data-driven updates — avoid surprises with regular reporting.", 5000],
      ["Export and attach the report to your board deck for a professional, consistent format.", 4500],
    ]);

    // ── SECTION 5: Fundraising Summaries ────────────────────────────────
    await section(page, "Fundraising Summary Reports", `${BASE}/capital/reports`, [
      ["Fundraising summaries capture where you are in the round at a point in time.", 5000],
      ["They include pipeline stage breakdown, engagement metrics, and commitment velocity.", 5500],
      ["Run one at the start of each month to track round momentum over time.", 5000],
      ["These summaries also serve as audit documentation for your financial records.", 4500],
    ]);

    // ── SECTION 6: AI Copilot Introduction ───────────────────────────────
    await section(page, "AI Copilot — Introduction", `${BASE}/capital/copilot`, [
      ["The AI Copilot is a conversational intelligence layer built on your live Capital data.", 5000],
      ["It understands your investors, your pipeline, your notes, and your follow-up history.", 5500],
      ["You ask questions in plain language — it responds with investor-specific, data-grounded answers.", 5500],
      ["No prompt engineering required — ask it the same way you would ask a colleague.", 4500],
    ]);

    // ── SECTION 7: Asking Investor Questions ────────────────────────────
    await section(page, "Asking the Copilot Questions", `${BASE}/capital/copilot`, [
      ["Try: Which investors have not responded in the past two weeks?", 5000],
      ["Try: Who is currently in diligence and what are their outstanding questions?", 5000],
      ["Try: What is our probability-weighted committed capital right now?", 5000],
      ["Try: Summarise what Blackwood Capital said in their last three meetings.", 5000],
      ["The Copilot reads across your entire investor history to answer each question.", 4500],
    ]);

    // ── SECTION 8: Generating AI Summaries ──────────────────────────────
    await section(page, "Generating AI Summaries", `${BASE}/capital/copilot`, [
      ["Ask the Copilot to generate a board-ready pipeline summary in seconds.", 5000],
      ["It structures the output in a format ready for executive communication.", 5000],
      ["Use generated summaries as a starting point — review and refine before sharing.", 4500],
      ["Generating a weekly investor status summary takes under 30 seconds with the Copilot.", 4500],
    ]);

    // ── SECTION 9: Investor Insights ────────────────────────────────────
    await section(page, "Investor Insights from the Copilot", `${BASE}/capital/copilot`, [
      ["Ask the Copilot for insights on specific investors before a meeting.", 5000],
      ["It synthesises their meeting notes, email history, and engagement signals.", 5000],
      ["You get a briefing in plain language: what they care about, where they stand.", 5000],
      ["Walking into a meeting with this context makes every conversation more effective.", 4500],
    ]);

    // ── SECTION 10: Updates & Reviews ───────────────────────────────────
    await section(page, "Updates & Reviews", `${BASE}/capital/updates`, [
      ["Updates & Reviews is where you communicate formally with your investor base.", 5000],
      ["Log board decisions, round milestones, and key announcements here.", 5000],
      ["Investors with portal access see these updates in their investor view.", 4500],
      ["Consistent investor updates build trust and reduce ad hoc information requests.", 4500],
    ]);

    // ── SECTION 11: Putting It Together ─────────────────────────────────
    await section(page, "Reports & Copilot — Putting It Together", `${BASE}/capital/command-center`, [
      ["End of week: generate a weekly summary from Reports, share it with your team.", 5000],
      ["Before board: use the Copilot to draft your fundraising narrative, refine it, export.", 5000],
      ["Before investor meetings: ask the Copilot for a pre-meeting briefing on that investor.", 5000],
      ["Between meetings: check Updates & Reviews to keep your investor base informed.", 5000],
      ["Reporting and intelligence together create a professional, data-driven fundraise.", 5000],
    ]);

    console.log("[cap-05] Recording complete. Saving …");
  } catch (err) {
    console.error("[cap-05] FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await page.close();
    const saved = await saveVideoWithReadableName(page, "cap-05-reports-copilot");
    await context.close();
    await browser.close();
    if (saved) console.log(`[cap-05] ✓ Saved → ${saved}`);
  }
})();
