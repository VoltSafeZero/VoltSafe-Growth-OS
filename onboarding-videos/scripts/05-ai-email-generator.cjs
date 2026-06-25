"use strict";
/**
 * Video 05 — AI Email Generator
 *
 * Account intelligence panel, AI-suggested email, compose review.
 * NO emails are sent.
 *
 * Run:  npm run video:ai-email
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
    console.log("[05] Logging in …");
    await login(page, BASE, email, password);
    await enableDemoMode(page);

    // Section 1: Accounts list
    console.log("[05] Accounts list …");
    await page.goto(`${BASE}/accounts`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await pauseForViewer(2500);

    // Section 2: Open first account profile
    console.log("[05] Account profile …");
    const firstAccount = await page.waitForSelector(
      'a[href^="/accounts/"]', { timeout: 10000 }
    ).catch(() => null);
    if (firstAccount) {
      await firstAccount.click();
      await waitForAppReady(page);
      await pauseForViewer(2500);
    } else {
      await page.goto(`${BASE}/accounts/1`, { waitUntil: "domcontentloaded" });
      await waitForAppReady(page);
      await pauseForViewer(2000);
    }

    // Section 3: Account intelligence panel
    console.log("[05] Intelligence panel …");
    const intelPanel = await page.$('[data-testid="account-intelligence-panel"]');
    if (intelPanel) { await intelPanel.scrollIntoViewIfNeeded(); await pauseForViewer(2500); }

    // Section 4: Suggested action
    const suggested = await page.$('[data-testid="text-suggested-action"]');
    if (suggested) { await suggested.scrollIntoViewIfNeeded(); await pauseForViewer(2000); }

    // Section 5: AI suggested email button
    console.log("[05] AI email modal …");
    const aiBtn = await page.$(
      'button:has-text("Suggested Email"), button:has-text("AI Email"), ' +
      'button:has-text("Generate Email"), button:has-text("Suggest")'
    );
    if (aiBtn) {
      await aiBtn.scrollIntoViewIfNeeded();
      await pauseForViewer(800);
      await aiBtn.click();
      await waitForAppReady(page);
      await pauseForViewer(4000);
      // Close without sending
      const closeBtn = await page.$('[aria-label="Close"], button:has-text("Cancel")');
      if (closeBtn) await closeBtn.click();
      else await page.keyboard.press("Escape");
      await pauseForViewer(1000);
    } else {
      console.warn("[05] AI email button not found — showing compose instead.");
    }

    // Section 6: Compose as review step (send blocked by demo mode)
    console.log("[05] Compose review (demo — send blocked) …");
    await page.goto(`${BASE}/gmail`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await pauseForViewer(1500);
    const composeBtn = await page.$('button:has-text("Compose"), button:has-text("New Email")');
    if (composeBtn) {
      await composeBtn.click();
      await waitForAppReady(page);
      await pauseForViewer(3000);
      await page.keyboard.press("Escape");
      await pauseForViewer(800);
    }

    console.log("[05] Recording complete. Saving …");
  } catch (err) {
    console.error("[05] FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await page.close();
    const saved = await saveVideoWithReadableName(page, "05-ai-email-generator");
    await context.close();
    await browser.close();
    if (saved) console.log(`[05] ✓ Saved → ${saved}`);
  }
})();
