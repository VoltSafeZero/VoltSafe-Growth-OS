"use strict";
/**
 * Video 06 — Account Intelligence View
 * Storyboard: onboarding-videos/storyboards/06-account-intelligence-view.md
 * Run: npm run video:account
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
    console.log("[06] Logging in …");
    await login(page, BASE, email, password);
    await enableDemoMode(page);

    // ── Section 1: Accounts list ──────────────────────────────────────────────
    await stepTitle(page, "Find the Account You're Calling");
    await page.goto(`${BASE}/accounts`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "Find the account before any call or email");
    await pauseForNarration(page, 3000);
    await hideCallout(page);

    // ── Section 2: Open account profile ──────────────────────────────────────
    await stepTitle(page, "Account Intelligence — Know Everything Before You Call");
    const firstAccount = await page.waitForSelector(
      'a[href^="/accounts/"]', { timeout: 10000 }
    ).catch(() => null);
    if (firstAccount) {
      await firstAccount.click();
    } else {
      await page.goto(`${BASE}/accounts/1`, { waitUntil: "domcontentloaded" });
    }
    await waitForAppReady(page);
    await pauseForNarration(page, 3000);

    // ── Section 3: Header ─────────────────────────────────────────────────────
    const accountName = await page.$('[data-testid="text-account-name"]');
    if (accountName) {
      await accountName.scrollIntoViewIfNeeded();
      await showCallout(page, "Marina overview at a glance");
      await pauseForNarration(page, 3000);
      await hideCallout(page);
    }

    // ── Section 4: Quick actions ──────────────────────────────────────────────
    await stepTitle(page, "Quick Actions — Log, Task, Deal, Website");
    const quickActions = await page.$('[data-testid="field-quick-actions"]');
    if (quickActions) {
      await quickActions.scrollIntoViewIfNeeded();
      await showCallout(page, "Log a note, create a task, or open a deal — one click");
      await pauseForNarration(page, 3000);
      await hideCallout(page);
    }

    // ── Section 5: Intelligence panel ────────────────────────────────────────
    await stepTitle(page, "AI Pre-Call Brief");
    const intelPanel = await page.$('[data-testid="account-intelligence-panel"]');
    if (intelPanel) {
      await intelPanel.scrollIntoViewIfNeeded();
      await showCallout(page, "Your AI pre-call brief — read this before every call");
      await pauseForNarration(page, 5000);
      await hideCallout(page);
    }

    // ── Section 6: Champion card ──────────────────────────────────────────────
    const champion = await page.$('[data-testid="champion-card"]');
    if (champion) {
      await champion.scrollIntoViewIfNeeded();
      await showCallout(page, "Champion contact — warmth, role, last contact date");
      await pauseForNarration(page, 3000);
      await hideCallout(page);
    }

    // ── Section 7: Activity timeline ─────────────────────────────────────────
    await stepTitle(page, "Activity Timeline — Full Relationship History");
    const timeline = await page.$('[data-testid="account-activity-timeline"]');
    if (timeline) {
      await timeline.scrollIntoViewIfNeeded();
      await showCallout(page, "Every call, email, and note — in sequence");
      await pauseForNarration(page, 4000);
      await hideCallout(page);
    }

    // ── Section 8: Open opportunities ────────────────────────────────────────
    await stepTitle(page, "Open Deals — Check Stage & Value");
    const openOpps = await page.$('[data-testid="account-open-opportunities"]');
    if (openOpps) {
      await openOpps.scrollIntoViewIfNeeded();
      await showCallout(page, "Active deals linked to this account — stage & value");
      await pauseForNarration(page, 3000);
      await hideCallout(page);
    }

    // ── Section 9: Email history ──────────────────────────────────────────────
    await stepTitle(page, "Email History — Every Thread");
    const emailSubject = await page.$('[data-testid^="email-subject-"]');
    if (emailSubject) {
      await emailSubject.scrollIntoViewIfNeeded();
      await showCallout(page, "Email history — every thread with this account");
      await pauseForNarration(page, 4000);
      await hideCallout(page);
    }

    // ── Section 10: Notes / bottom of page ───────────────────────────────────
    await stepTitle(page, "Notes — Capture Every Conversation");
    await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));
    await pauseForViewer(1200);
    await showCallout(page, "Review activity before every outreach");
    await pauseForNarration(page, 3500);
    await hideCallout(page);

    // ── Section 11: Back to list ──────────────────────────────────────────────
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
