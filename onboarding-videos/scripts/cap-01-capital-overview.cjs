"use strict";
/**
 * Video 07 (cap-01) — Capital Module Overview
 * Target runtime: ~3.5–4 min
 * Storyboard: onboarding-videos/storyboards/cap-01-capital-overview.md
 * Run: node onboarding-videos/scripts/cap-01-capital-overview.cjs
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
    console.log("[cap-01] Logging in …");
    await login(page, BASE, email, password);
    await enableDemoMode(page);

    // ── SECTION 1: Welcome ───────────────────────────────────────────────
    await section(page, "Welcome to the Capital Module", `${BASE}/capital/command-center`, [
      ["The Capital module is your end-to-end fundraising operating system.", 5000],
      ["It replaces spreadsheets, email threads, and disconnected tools with one unified workspace.", 5500],
      ["Everything a CFO or CEO needs to run a funding round lives here.", 4500],
    ]);

    // ── SECTION 2: Command Center ────────────────────────────────────────
    await section(page, "Command Center", `${BASE}/capital/command-center`, [
      ["The Command Center is your daily dashboard — open it every morning.", 5000],
      ["It surfaces round progress, investor risk flags, and outstanding next actions.", 5500],
      ["KPIs at the top show how much is committed, soft-circled, and remaining to target.", 5000],
      ["Red flags indicate investors who are overdue for follow-up or have gone quiet.", 4500],
    ]);

    // ── SECTION 3: Follow-Ups ────────────────────────────────────────────
    await section(page, "Follow-Ups", `${BASE}/capital/follow-ups`, [
      ["The Follow-Ups tab is where you track every investor conversation.", 5000],
      ["Each entry shows the investor name, last contact date, and what action is due.", 5000],
      ["You can log meetings, calls, and emails directly from this view.", 4500],
      ["Items turn red when a follow-up is overdue — nothing falls through the cracks.", 5000],
    ]);

    // ── SECTION 4: Investor Pipeline ─────────────────────────────────────
    await section(page, "Investor Pipeline", `${BASE}/capital/pipeline`, [
      ["The Investor Pipeline shows every investor you are tracking for this round.", 5000],
      ["Investors move through stages: Prospect → Meeting → Diligence → Soft Circle → Committed.", 5500],
      ["Each card shows the investor's firm, target allocation, and current stage.", 4500],
      ["Use filters to focus on a specific stage or to find investors by name.", 4500],
    ]);

    // ── SECTION 5: Rounds & Commitments ─────────────────────────────────
    await section(page, "Rounds & Commitments", `${BASE}/capital/rounds`, [
      ["Rounds & Commitments tracks your target raise amount against what is confirmed.", 5000],
      ["Hard commitments are signed. Soft circles are verbal indications of interest.", 5000],
      ["The progress bar updates automatically as investors move to committed status.", 4500],
      ["You can run multiple rounds simultaneously — each is tracked independently.", 4500],
    ]);

    // ── SECTION 6: Data Room ─────────────────────────────────────────────
    await section(page, "Data Room", `${BASE}/capital/data-room`, [
      ["The Data Room stores all diligence materials investors will need.", 5000],
      ["Organize documents into folders: Financials, Legal, Team, Product, Market.", 5000],
      ["Mark documents confidential to control which investors can view them.", 4500],
      ["Shared documents become available through the investor portal automatically.", 4500],
    ]);

    // ── SECTION 7: Engagement Tracking ──────────────────────────────────
    await section(page, "Engagement Tracking", `${BASE}/capital/engagement`, [
      ["The Engagement view shows you which investors are warm and which have gone cold.", 5000],
      ["Warmth is calculated from email opens, meeting frequency, and follow-up activity.", 5000],
      ["Investors who have not been contacted in 14+ days are flagged automatically.", 4500],
      ["Use this view to prioritise your outreach each week.", 4500],
    ]);

    // ── SECTION 8: Reports ───────────────────────────────────────────────
    await section(page, "Reports", `${BASE}/capital/reports`, [
      ["The Reports tab generates weekly fundraising summaries and board-ready updates.", 5000],
      ["Reports pull live data — no manual formatting or copy-paste required.", 4500],
      ["Each report includes pipeline status, committed capital, and key risk flags.", 4500],
      ["Export reports as PDF to share with your board or co-founders.", 4500],
    ]);

    // ── SECTION 9: AI Copilot ────────────────────────────────────────────
    await section(page, "AI Copilot", `${BASE}/capital/copilot`, [
      ["The AI Copilot is your on-demand fundraising intelligence layer.", 5000],
      ["Ask it questions like: Which investors have not responded in two weeks?", 5000],
      ["Or: Summarise the current state of our Series A pipeline.", 4500],
      ["The Copilot reads your live data and responds with investor-specific context.", 5000],
    ]);

    // ── SECTION 10: Updates & Reviews ───────────────────────────────────
    await section(page, "Updates & Reviews", `${BASE}/capital/updates`, [
      ["Updates & Reviews is where you track board updates and investor communications.", 5000],
      ["Log key decisions, round updates, and formal notices to your investor base.", 4500],
      ["This creates a clean audit trail of how you communicated through the raise.", 4500],
    ]);

    // ── SECTION 11: Daily Workflow ───────────────────────────────────────
    await section(page, "Daily Workflow — Putting It Together", `${BASE}/capital/command-center`, [
      ["A typical CFO morning: open Command Center, review flags, check Follow-Ups.", 5500],
      ["Log any meetings from yesterday, update investor stages in the Pipeline.", 5000],
      ["Run a quick engagement check — reach out to any investor who has gone quiet.", 5000],
      ["End the week by generating a Report and sharing it with your board.", 5000],
      ["That is the Capital module — one place for everything in your raise.", 5000],
    ]);

    console.log("[cap-01] Recording complete. Saving …");
  } catch (err) {
    console.error("[cap-01] FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await page.close();
    const saved = await saveVideoWithReadableName(page, "cap-01-capital-overview");
    await context.close();
    await browser.close();
    if (saved) console.log(`[cap-01] ✓ Saved → ${saved}`);
  }
})();
