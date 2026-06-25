"use strict";
/**
 * Video 03 — Marina Lead Pipeline
 * Storyboard: onboarding-videos/storyboards/03-marina-lead-pipeline.md
 * Run: npm run video:pipeline
 */

const {
  getBaseUrl, getCredentials,
  launchBrowser, createRecordingContext,
  login, enableDemoMode, waitForAppReady,
  pauseForViewer, pauseForNarration,
  showCallout, hideCallout, stepTitle,
  saveVideoWithReadableName,
} = require("./helpers.cjs");

const STAGE_LABELS = {
  new_lead:       "Stage 1: New Lead — first contact, not yet qualified",
  qualified:      "Stage 2: Qualified — BANT confirmed",
  discovery:      "Stage 3: Discovery — active conversations",
  pilot_candidate:"Stage 4: Pilot Candidate — deployment agreed",
  proposal:       "Stage 5: Proposal — formal quote submitted",
  closed_won:     "Stage 6: Closed Won — contract signed",
};

(async () => {
  const BASE = getBaseUrl();
  const { email, password } = getCredentials();

  const browser = await launchBrowser();
  const context = await createRecordingContext(browser);
  const page    = await context.newPage();

  try {
    console.log("[03] Logging in …");
    await login(page, BASE, email, password);
    await enableDemoMode(page);

    // ── Section 1: Pipeline kanban ────────────────────────────────────────────
    await stepTitle(page, "Marina Lead Pipeline");
    await page.goto(`${BASE}/pipeline`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    const kanbanBtn = await page.$('[data-testid="button-kanban-view"]');
    if (kanbanBtn) { await kanbanBtn.click(); await pauseForViewer(600); }
    await showCallout(page, "Your deal board — every active opportunity by stage");
    await pauseForNarration(page, 3500);
    await hideCallout(page);

    // ── Section 2: Walk each stage column ─────────────────────────────────────
    await stepTitle(page, "Pipeline Stages — New Lead to Closed Won");
    for (const [key, label] of Object.entries(STAGE_LABELS)) {
      const col = await page.$(`[data-testid="column-${key}"]`);
      if (col) {
        await col.scrollIntoViewIfNeeded();
        await showCallout(page, label);
        await pauseForNarration(page, 2500);
        await hideCallout(page);
        await pauseForViewer(400);
      }
    }

    // ── Section 3: Open an opportunity card ───────────────────────────────────
    await stepTitle(page, "Deal Card — Full Opportunity Detail");
    const firstCard = await page.$('[data-testid^="pipeline-opp-"]');
    if (firstCard) {
      await firstCard.scrollIntoViewIfNeeded();
      await firstCard.click();
      await waitForAppReady(page);
      await showCallout(page, "Full deal detail here — value, contacts, timeline, next step");
      await pauseForNarration(page, 5000);
      await hideCallout(page);
    }

    // ── Section 4: List view ──────────────────────────────────────────────────
    await stepTitle(page, "List View — Quick Pipeline Scan");
    await page.goto(`${BASE}/pipeline`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    const listBtn = await page.$('[data-testid="button-list-view"]');
    if (listBtn) { await listBtn.click(); await pauseForViewer(600); }
    await showCallout(page, "List view for a quick pipeline scan");
    await pauseForNarration(page, 3000);
    await hideCallout(page);

    // ── Section 5: Forecast view ──────────────────────────────────────────────
    await stepTitle(page, "Forecast — Committed vs. Pipeline");
    await page.goto(`${BASE}/execution/forecast`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "Forecast: committed revenue vs. monthly target");
    await pauseForNarration(page, 3500);
    await hideCallout(page);

    console.log("[03] Recording complete. Saving …");
  } catch (err) {
    console.error("[03] FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await page.close();
    const saved = await saveVideoWithReadableName(page, "03-marina-lead-pipeline");
    await context.close();
    await browser.close();
    if (saved) console.log(`[03] ✓ Saved → ${saved}`);
  }
})();
