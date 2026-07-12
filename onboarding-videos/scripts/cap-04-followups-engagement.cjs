"use strict";
/**
 * Video 10 (cap-04) — Follow-Ups & Engagement Tracking
 * Target runtime: ~3.5–4 min
 * Storyboard: onboarding-videos/storyboards/cap-04-followups-engagement.md
 * Run: node onboarding-videos/scripts/cap-04-followups-engagement.cjs
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
    console.log("[cap-04] Logging in …");
    await login(page, BASE, email, password);
    await enableDemoMode(page);

    // ── SECTION 1: Introduction ──────────────────────────────────────────
    await section(page, "Follow-Ups & Engagement Tracking", `${BASE}/capital/follow-ups`, [
      ["Fundraising is relationship management at scale — follow-up is everything.", 5000],
      ["This module ensures no investor conversation falls through the cracks.", 5000],
      ["Every touchpoint is logged, every owner is assigned, every deadline is tracked.", 4500],
    ]);

    // ── SECTION 2: Follow-Ups Overview ──────────────────────────────────
    await section(page, "Follow-Ups View Overview", `${BASE}/capital/follow-ups`, [
      ["The Follow-Ups list shows all outstanding investor actions sorted by urgency.", 5000],
      ["Each row shows the investor, the action required, the assigned owner, and the due date.", 5500],
      ["Overdue items are highlighted in red — prioritise these first each morning.", 5000],
      ["Filter by owner to see only your actions, or view the full team queue.", 4500],
    ]);

    // ── SECTION 3: Logging Meetings ──────────────────────────────────────
    await section(page, "Logging Investor Meetings", `${BASE}/capital/follow-ups`, [
      ["After every investor meeting, log it immediately — memory fades fast.", 5000],
      ["Record the date, attendees, what was discussed, and key signals from the conversation.", 5500],
      ["Note any objections raised — these become talking points for the next meeting.", 5000],
      ["A meeting log creates a permanent record that the AI Copilot can reference later.", 4500],
    ]);

    // ── SECTION 4: Logging Calls & Emails ───────────────────────────────
    await section(page, "Logging Calls & Emails", `${BASE}/capital/follow-ups`, [
      ["Every call and email exchange with an investor should be logged, even brief ones.", 5500],
      ["Calls: log duration, participants, key takeaways, and agreed next steps.", 5000],
      ["Emails: note the date, subject, and whether the investor responded.", 4500],
      ["Consistent logging builds an accurate picture of investor engagement over time.", 4500],
    ]);

    // ── SECTION 5: Creating Follow-Up Tasks ──────────────────────────────
    await section(page, "Creating Follow-Up Tasks", `${BASE}/capital/follow-ups`, [
      ["After every interaction, create a follow-up task with a specific due date.", 5000],
      ["Vague next steps get forgotten — be precise: send the model by Friday, call Tuesday.", 5500],
      ["Assign the task to the right team member — ownership means accountability.", 5000],
      ["Tasks roll up to the Command Center so leadership can see pending investor actions.", 4500],
    ]);

    // ── SECTION 6: Assigning Owners ──────────────────────────────────────
    await section(page, "Assigning Ownership", `${BASE}/capital/follow-ups`, [
      ["Every investor relationship should have one primary owner — usually the CEO or CFO.", 5000],
      ["Secondary owners can support, but one person is always accountable for follow-through.", 5000],
      ["Assign tasks to other team members when they have the right relationship or expertise.", 5000],
      ["Owner assignment prevents the single most common fundraising failure: no one follows up.", 5000],
    ]);

    // ── SECTION 7: Engagement Heat Map ───────────────────────────────────
    await section(page, "Engagement Heat Map", `${BASE}/capital/engagement`, [
      ["The Engagement view visualises investor warmth across your entire pipeline.", 5000],
      ["Warmth is scored from signals: meeting frequency, email responses, document views.", 5500],
      ["Hot investors are actively engaged and likely moving toward a decision.", 4500],
      ["Cold investors have gone quiet — a follow-up strategy is needed immediately.", 5000],
    ]);

    // ── SECTION 8: Warm vs Cold Investors ───────────────────────────────
    await section(page, "Warm vs Cold — What to Do", `${BASE}/capital/engagement`, [
      ["For warm investors: maintain momentum — do not let too much time pass between touches.", 5500],
      ["For cold investors: try a different medium — if email is not working, pick up the phone.", 5500],
      ["Sometimes a cold investor needs a new information hook — a milestone, a new customer.", 5000],
      ["If an investor goes cold for 30+ days with no response, consider deprioritising them.", 4500],
    ]);

    // ── SECTION 9: Reviewing Upcoming Follow-Ups ─────────────────────────
    await section(page, "Reviewing Upcoming Follow-Ups", `${BASE}/capital/follow-ups`, [
      ["Review your upcoming follow-up list every Monday morning before the week begins.", 5000],
      ["Identify which actions are due this week and confirm owners are aware.", 5000],
      ["Reschedule any overdue items immediately rather than leaving them as red flags.", 4500],
      ["A 20-minute weekly review prevents a disorganised fundraise.", 4500],
    ]);

    // ── SECTION 10: Daily Workflow ────────────────────────────────────────
    await section(page, "Daily Workflow Example", `${BASE}/capital/command-center`, [
      ["Morning: open Command Center, check for red flags and overdue follow-ups.", 5000],
      ["Review the Engagement view — which investors have gone cold since yesterday?", 5000],
      ["Log any meetings or calls from the previous day before the details fade.", 5000],
      ["Afternoon: process email replies, update stages, assign new follow-up tasks.", 5000],
      ["End of day: confirm all tasks have owners and due dates — nothing open-ended.", 5000],
    ]);

    console.log("[cap-04] Recording complete. Saving …");
  } catch (err) {
    console.error("[cap-04] FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await page.close();
    const saved = await saveVideoWithReadableName(page, "cap-04-followups-engagement");
    await context.close();
    await browser.close();
    if (saved) console.log(`[cap-04] ✓ Saved → ${saved}`);
  }
})();
