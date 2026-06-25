"use strict";
/**
 * Video 05 — AI Email Generator
 * Storyboard: onboarding-videos/storyboards/05-ai-email-generator.md
 * Run: npm run video:ai-email
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
    console.log("[05] Logging in …");
    await login(page, BASE, email, password);
    await enableDemoMode(page);

    // ── Section 1: Accounts list ──────────────────────────────────────────────
    await stepTitle(page, "Start With the Account");
    await page.goto(`${BASE}/accounts`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "Start with the account you're reaching out to");
    await pauseForNarration(page, 3000);
    await hideCallout(page);

    // ── Section 2: Open account profile ──────────────────────────────────────
    await stepTitle(page, "Account Profile — Review Before You Write");
    const firstAccount = await page.waitForSelector(
      'a[href^="/accounts/"]', { timeout: 10000 }
    ).catch(() => null);
    if (firstAccount) {
      await firstAccount.click();
      await waitForAppReady(page);
    } else {
      await page.goto(`${BASE}/accounts/1`, { waitUntil: "domcontentloaded" });
      await waitForAppReady(page);
    }
    await showCallout(page, "Review intelligence before you write a single word");
    await pauseForNarration(page, 4000);
    await hideCallout(page);

    // ── Section 3: Intelligence panel ────────────────────────────────────────
    await stepTitle(page, "Intelligence Panel — Your AI Pre-Call Brief");
    const intelPanel = await page.$('[data-testid="account-intelligence-panel"]');
    if (intelPanel) {
      await intelPanel.scrollIntoViewIfNeeded();
      await showCallout(page, "AI-curated context: champion, deals, last activity");
      await pauseForNarration(page, 4500);
      await hideCallout(page);
    }

    // ── Section 4: Suggested action ──────────────────────────────────────────
    const suggested = await page.$('[data-testid="text-suggested-action"]');
    if (suggested) {
      await suggested.scrollIntoViewIfNeeded();
      await showCallout(page, "What Cortex recommends you do next");
      await pauseForNarration(page, 3000);
      await hideCallout(page);
    }

    // ── Section 5: AI email button ────────────────────────────────────────────
    await stepTitle(page, "Generate a Suggested Email");
    const aiBtn = await page.$(
      'button:has-text("Suggested Email"), button:has-text("AI Email"), ' +
      'button:has-text("Generate Email"), button:has-text("Suggest")'
    );
    if (aiBtn) {
      await aiBtn.scrollIntoViewIfNeeded();
      await showCallout(page, "Generate a suggested email from CRM context");
      await pauseForViewer(1500);
      await hideCallout(page);
      await aiBtn.click();
      await waitForAppReady(page);

      await showCallout(page, "Cortex is writing your personalised draft…");
      await pauseForNarration(page, 4500);
      await hideCallout(page);

      await showCallout(page, "Review, edit, or regenerate with different instructions");
      await pauseForNarration(page, 5000);
      await hideCallout(page);

      const closeBtn = await page.$('[aria-label="Close"], button:has-text("Cancel")');
      if (closeBtn) await closeBtn.click();
      else await page.keyboard.press("Escape");
      await pauseForViewer(800);
    } else {
      console.warn("[05] AI email button not found.");
    }

    // ── Section 6: Compose for final review ──────────────────────────────────
    await stepTitle(page, "Compose — Final Review Before Sending");
    await page.goto(`${BASE}/gmail`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await pauseForViewer(1000);
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
