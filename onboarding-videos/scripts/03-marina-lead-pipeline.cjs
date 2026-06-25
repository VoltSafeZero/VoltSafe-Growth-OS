"use strict";
/**
 * Video 03 — Marina Lead Pipeline
 *
 * Pipeline kanban view, stage columns, opportunity cards, list view.
 * Read-only — no data is mutated.
 *
 * Run:  npm run video:pipeline
 */

const {
  getBaseUrl, getCredentials,
  launchBrowser, createRecordingContext,
  login, enableDemoMode, waitForAppReady,
  pauseForViewer, saveVideoWithReadableName,
} = require("./helpers.cjs");

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

    // Section 1: Pipeline kanban
    console.log("[03] Pipeline kanban …");
    await page.goto(`${BASE}/pipeline`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    const kanbanBtn = await page.$('[data-testid="button-kanban-view"]');
    if (kanbanBtn) { await kanbanBtn.click(); await pauseForViewer(800); }
    await pauseForViewer(3000);

    // Section 2: Scroll through pipeline stage columns
    console.log("[03] Pipeline stages …");
    const stageKeys = ["new_lead", "qualified", "discovery", "pilot_candidate", "proposal", "closed_won"];
    for (const key of stageKeys) {
      const col = await page.$(`[data-testid="column-${key}"]`);
      if (col) { await col.scrollIntoViewIfNeeded(); await pauseForViewer(1500); }
    }
    await pauseForViewer(2000);

    // Section 3: Open an opportunity card
    console.log("[03] Opening an opportunity …");
    const firstCard = await page.$('[data-testid^="pipeline-opp-"]');
    if (firstCard) {
      await firstCard.click();
      await waitForAppReady(page);
      await pauseForViewer(3500);
    }

    // Section 4: List view
    console.log("[03] List view …");
    await page.goto(`${BASE}/pipeline`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    const listBtn = await page.$('[data-testid="button-list-view"]');
    if (listBtn) { await listBtn.click(); await pauseForViewer(2000); }
    await pauseForViewer(2500);

    // Section 5: Forecast/Execution view
    console.log("[03] Forecast view …");
    await page.goto(`${BASE}/execution/forecast`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await pauseForViewer(3000);

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
