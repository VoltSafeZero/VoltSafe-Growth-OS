"use strict";
/**
 * Video 08 (cap-02) — Investor Pipeline & Commitments
 * Target runtime: ~3.5–4 min
 * Storyboard: onboarding-videos/storyboards/cap-02-investor-pipeline.md
 * Run: node onboarding-videos/scripts/cap-02-investor-pipeline.cjs
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
    console.log("[cap-02] Logging in …");
    await login(page, BASE, email, password);
    await enableDemoMode(page);

    // ── SECTION 1: Introduction ──────────────────────────────────────────
    await section(page, "Investor Pipeline & Commitments", `${BASE}/capital/pipeline`, [
      ["This walkthrough covers how to manage investors from first contact to committed capital.", 5000],
      ["The Pipeline is the heart of your fundraising operation — every investor lives here.", 5000],
      ["Think of it like a sales CRM, but built for raising a funding round.", 4500],
    ]);

    // ── SECTION 2: Pipeline Overview ────────────────────────────────────
    await section(page, "Understanding the Pipeline View", `${BASE}/capital/pipeline`, [
      ["Each row is an investor — their firm, contact, target allocation, and current stage.", 5500],
      ["Stages flow left to right: Prospect, Meeting Booked, First Meeting, Diligence, Soft Circle, Committed.", 5500],
      ["The stage tells you exactly where each investor is in your process at a glance.", 4500],
      ["Colour coding gives you instant signal — warm investors are highlighted.", 4500],
    ]);

    // ── SECTION 3: Investor Stages ───────────────────────────────────────
    await section(page, "Moving Investors Through Stages", `${BASE}/capital/pipeline`, [
      ["Every new investor starts as a Prospect — someone you intend to approach.", 5000],
      ["Once a meeting is booked, move them to Meeting Booked to track preparation.", 5000],
      ["After a first meeting goes well, advance to First Meeting and log your notes.", 5000],
      ["Diligence means they have asked for your data room materials — a strong signal.", 4500],
      ["Soft Circle is a verbal commitment — important for forecasting, not yet confirmed.", 5000],
    ]);

    // ── SECTION 4: Rounds & Commitments ─────────────────────────────────
    await section(page, "Rounds & Commitments", `${BASE}/capital/rounds`, [
      ["The Rounds view shows your target raise amount and how much is confirmed so far.", 5000],
      ["The progress bar fills as investors move to Committed status in the Pipeline.", 5000],
      ["Hard commitments represent signed term sheets or wires received.", 4500],
      ["Soft circles are tracked separately — they inform your probability-weighted forecast.", 5000],
      ["You can see your gap-to-close at all times — no more manual spreadsheet math.", 5000],
    ]);

    // ── SECTION 5: Recording Soft Circles ───────────────────────────────
    await section(page, "Recording Soft Circles", `${BASE}/capital/pipeline`, [
      ["A soft circle is when an investor says they are likely in, but paperwork is not signed.", 5500],
      ["Record it in the Pipeline by updating the stage to Soft Circle and noting the amount.", 5500],
      ["Soft circles appear in your commitment tracker so you can see probable vs confirmed capital.", 5000],
      ["Never count a soft circle as closed — but always track them to forecast accurately.", 4500],
    ]);

    // ── SECTION 6: Logging Meetings & Notes ──────────────────────────────
    await section(page, "Logging Meetings & Notes", `${BASE}/capital/pipeline`, [
      ["After every investor meeting, log it directly in the Pipeline on their record.", 5000],
      ["Notes capture what was discussed, questions raised, and agreed next steps.", 5000],
      ["Good notes make every future conversation smarter — the AI Copilot reads them too.", 5000],
      ["Set a next action and due date so your follow-up never gets forgotten.", 4500],
    ]);

    // ── SECTION 7: Filtering & Searching ────────────────────────────────
    await section(page, "Filtering & Searching the Pipeline", `${BASE}/capital/pipeline`, [
      ["Use filters to focus on a specific stage — for example, everyone in Diligence.", 5000],
      ["Search by investor name or firm to quickly find a specific record.", 4500],
      ["Filter by allocation size to prioritise your largest potential investors.", 4500],
      ["Saved filters let your team stay focused without re-applying criteria each session.", 4500],
    ]);

    // ── SECTION 8: Command Center Summary ───────────────────────────────
    await section(page, "Pipeline View from Command Center", `${BASE}/capital/command-center`, [
      ["The Command Center always shows a live summary of your pipeline state.", 5000],
      ["You can see total investors by stage, committed capital, and risk flags in one view.", 5000],
      ["This is your morning briefing — pipeline health at a glance.", 4500],
      ["When a flag is red, click through to see which investors need immediate attention.", 4500],
    ]);

    // ── SECTION 9: Best Practices ────────────────────────────────────────
    await section(page, "Investor Pipeline — Best Practices", `${BASE}/capital/pipeline`, [
      ["Update investor stages the same day as meetings — stale data leads to missed follow-ups.", 5500],
      ["Always record the allocation amount when an investor signals interest.", 5000],
      ["Move investors backward in stage if they go quiet — an honest pipeline is more useful.", 5000],
      ["A well-maintained pipeline gives you an accurate probability-weighted raise forecast.", 5000],
    ]);

    console.log("[cap-02] Recording complete. Saving …");
  } catch (err) {
    console.error("[cap-02] FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await page.close();
    const saved = await saveVideoWithReadableName(page, "cap-02-investor-pipeline");
    await context.close();
    await browser.close();
    if (saved) console.log(`[cap-02] ✓ Saved → ${saved}`);
  }
})();
