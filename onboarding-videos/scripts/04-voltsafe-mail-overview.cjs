"use strict";
/**
 * Video 04 — VoltSafe Mail Overview
 * Storyboard: onboarding-videos/storyboards/04-voltsafe-mail-overview.md
 * Run: npm run video:mail
 */

const {
  getBaseUrl, getCredentials,
  launchBrowser, createRecordingContext,
  login, enableDemoMode, waitForAppReady,
  pauseForViewer, pauseForNarration,
  showCallout, hideCallout, stepTitle,
  saveVideoWithReadableName,
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

    // ── Section 1: Inbox overview ─────────────────────────────────────────────
    await stepTitle(page, "VoltSafe Mail — Your CRM-Connected Inbox");
    await page.goto(`${BASE}/gmail`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "Your inbox — every message automatically CRM-linked");
    await pauseForNarration(page, 4000);
    await hideCallout(page);

    // ── Section 2: Priority tab ───────────────────────────────────────────────
    await stepTitle(page, "Priority Inbox — Deal-Moving Emails First");
    const priorityTab = await page.$('button:has-text("Priority")');
    if (priorityTab) {
      await priorityTab.click();
      await pauseForViewer(1000);
    }
    await showCallout(page, "Priority: emails from active leads and accounts");
    await pauseForNarration(page, 3000);
    await hideCallout(page);

    // ── Section 3: People tab ─────────────────────────────────────────────────
    await stepTitle(page, "People — Conversations by Contact");
    const peopleTab = await page.$('button:has-text("People")');
    if (peopleTab) {
      await peopleTab.click();
      await pauseForViewer(1000);
    }
    await showCallout(page, "People: all threads with a single contact in one place");
    await pauseForNarration(page, 3000);
    await hideCallout(page);

    // ── Section 4: Open a message ─────────────────────────────────────────────
    await stepTitle(page, "Open a Thread — Full Context Panel");
    await page.goto(`${BASE}/gmail`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await pauseForViewer(1000);
    const firstRow = await page.$('[class*="cursor-pointer"][class*="border"]');
    if (firstRow) {
      await firstRow.click();
      await waitForAppReady(page);
      await showCallout(page, "Open any thread for the full message + CRM context");
      await pauseForNarration(page, 5000);
      await hideCallout(page);
    }

    // ── Section 5: Reply UI ───────────────────────────────────────────────────
    await stepTitle(page, "Reply — Inline, Tracked, CRM-Linked");
    const replyBtn = await page.$('button:has-text("Reply")');
    if (replyBtn) {
      await replyBtn.click();
      await pauseForViewer(1000);
      await showCallout(page, "Reply inline — signature, tracking, and CRM link automatic");
      await pauseForNarration(page, 3500);
      await hideCallout(page);
      await page.keyboard.press("Escape");
      await pauseForViewer(800);
    }

    // ── Section 6: Unread filter ──────────────────────────────────────────────
    await stepTitle(page, "Unread Filter — Start Every Day Here");
    await page.goto(`${BASE}/gmail`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    const unreadBtn = await page.$('button:has-text("Unread")');
    if (unreadBtn) {
      await unreadBtn.click();
      await pauseForViewer(1000);
    }
    await showCallout(page, "Unread filter — zero in on what needs a response");
    await pauseForNarration(page, 3000);
    await hideCallout(page);

    // ── Section 7: Compose ────────────────────────────────────────────────────
    await stepTitle(page, "Compose — New Outbound Email");
    await page.goto(`${BASE}/gmail`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    const composeBtn = await page.$('button:has-text("Compose"), button:has-text("New Email")');
    if (composeBtn) {
      await composeBtn.click();
      await waitForAppReady(page);
      await showCallout(page, "No email is sent in demo mode");
      await pauseForNarration(page, 3500);
      await hideCallout(page);
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
