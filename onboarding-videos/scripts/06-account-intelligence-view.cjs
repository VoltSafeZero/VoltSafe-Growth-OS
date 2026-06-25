"use strict";
/**
 * Video 06 — Account Intelligence View
 *
 * Account profile deep-dive: header, quick actions, intelligence panel,
 * champion card, activity timeline, open opportunities, email history, notes.
 *
 * Run:  npm run video:account
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
    console.log("[06] Logging in …");
    await login(page, BASE, email, password);
    await enableDemoMode(page);

    // Section 1: Accounts list
    console.log("[06] Accounts list …");
    await page.goto(`${BASE}/accounts`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await pauseForViewer(2500);

    // Section 2: Open an account
    console.log("[06] Opening account profile …");
    const firstAccount = await page.waitForSelector(
      'a[href^="/accounts/"]', { timeout: 10000 }
    ).catch(() => null);
    if (firstAccount) {
      await firstAccount.click();
    } else {
      await page.goto(`${BASE}/accounts/1`, { waitUntil: "domcontentloaded" });
    }
    await waitForAppReady(page);
    await pauseForViewer(3000);

    // Section 3: Account name + header
    const accountName = await page.$('[data-testid="text-account-name"]');
    if (accountName) { await accountName.scrollIntoViewIfNeeded(); await pauseForViewer(2000); }

    // Section 4: Quick actions
    const quickActions = await page.$('[data-testid="field-quick-actions"]');
    if (quickActions) { await quickActions.scrollIntoViewIfNeeded(); await pauseForViewer(2000); }

    // Section 5: Intelligence panel
    console.log("[06] Intelligence panel …");
    const intelPanel = await page.$('[data-testid="account-intelligence-panel"]');
    if (intelPanel) { await intelPanel.scrollIntoViewIfNeeded(); await pauseForViewer(2500); }

    const champion = await page.$('[data-testid="champion-card"]');
    if (champion) { await champion.scrollIntoViewIfNeeded(); await pauseForViewer(2000); }

    // Section 6: Activity timeline
    const timeline = await page.$('[data-testid="account-activity-timeline"]');
    if (timeline) { await timeline.scrollIntoViewIfNeeded(); await pauseForViewer(2500); }

    // Section 7: Open opportunities
    const openOpps = await page.$('[data-testid="account-open-opportunities"]');
    if (openOpps) { await openOpps.scrollIntoViewIfNeeded(); await pauseForViewer(2500); }

    // Section 8: Email history
    const emailSubject = await page.$('[data-testid^="email-subject-"]');
    if (emailSubject) { await emailSubject.scrollIntoViewIfNeeded(); await pauseForViewer(2500); }

    // Section 9: Scroll to bottom (notes / next steps)
    console.log("[06] Notes / next steps …");
    await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));
    await pauseForViewer(3000);

    // Section 10: Back to accounts
    const backBtn = await page.$('[data-testid="button-back"]');
    if (backBtn) {
      await backBtn.click();
      await waitForAppReady(page);
      await pauseForViewer(2000);
    }

    console.log("[06] Recording complete. Saving …");
  } catch (err) {
    console.error("[06] FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await page.close();
    const saved = await saveVideoWithReadableName(page, "06-account-intelligence-view");
    await context.close();
    await browser.close();
    if (saved) console.log(`[06] ✓ Saved → ${saved}`);
  }
})();
