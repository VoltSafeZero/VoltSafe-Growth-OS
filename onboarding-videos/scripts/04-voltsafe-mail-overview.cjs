"use strict";
/**
 * Video 04 — VoltSafe Mail Overview
 *
 * Inbox, categories, message view, reply UI. NO emails are sent.
 *
 * Run:  npm run video:mail
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
    console.log("[04] Logging in …");
    await login(page, BASE, email, password);
    await enableDemoMode(page);

    // Section 1: Inbox overview
    console.log("[04] VoltSafe Mail inbox …");
    await page.goto(`${BASE}/gmail`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await pauseForViewer(3000);

    // Section 2: Priority tab
    const priorityTab = await page.$('button:has-text("Priority")');
    if (priorityTab) { await priorityTab.click(); await pauseForViewer(2000); }

    // Section 3: People tab
    const peopleTab = await page.$('button:has-text("People")');
    if (peopleTab) { await peopleTab.click(); await pauseForViewer(2000); }

    // Section 4: Open a message
    console.log("[04] Opening a message …");
    await page.goto(`${BASE}/gmail`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await pauseForViewer(1500);
    const firstRow = await page.$('[class*="cursor-pointer"][class*="border"]');
    if (firstRow) {
      await firstRow.click();
      await waitForAppReady(page);
      await pauseForViewer(3500);
    }

    // Section 5: Reply UI (don't send)
    const replyBtn = await page.$('button:has-text("Reply")');
    if (replyBtn) {
      await replyBtn.click();
      await pauseForViewer(3000);
      await page.keyboard.press("Escape");
      await pauseForViewer(800);
    }

    // Section 6: Unread filter
    console.log("[04] Unread filter …");
    await page.goto(`${BASE}/gmail`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    const unreadBtn = await page.$('button:has-text("Unread")');
    if (unreadBtn) { await unreadBtn.click(); await pauseForViewer(2500); }

    // Section 7: Compose (demo mode blocks send)
    console.log("[04] Compose (demo — send blocked) …");
    await page.goto(`${BASE}/gmail`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    const composeBtn = await page.$('button:has-text("Compose"), button:has-text("New Email")');
    if (composeBtn) {
      await composeBtn.click();
      await waitForAppReady(page);
      await pauseForViewer(3000);
      await page.keyboard.press("Escape");
      await pauseForViewer(800);
    }

    console.log("[04] Recording complete. Saving …");
  } catch (err) {
    console.error("[04] FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await page.close();
    const saved = await saveVideoWithReadableName(page, "04-voltsafe-mail-overview");
    await context.close();
    await browser.close();
    if (saved) console.log(`[04] ✓ Saved → ${saved}`);
  }
})();
