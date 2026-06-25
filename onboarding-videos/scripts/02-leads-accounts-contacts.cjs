"use strict";
/**
 * Video 02 — Leads, Accounts & Contacts
 * Storyboard: onboarding-videos/storyboards/02-leads-accounts-contacts.md
 * Run: npm run video:crm
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
    console.log("[02] Logging in …");
    await login(page, BASE, email, password);
    await enableDemoMode(page);

    // ── Section 1: Leads list ────────────────────────────────────────────────
    await stepTitle(page, "Leads — Your Prospect List");
    await page.goto(`${BASE}/opportunities`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "Start with your prospect list");
    await pauseForNarration(page, 3500);
    await hideCallout(page);

    // Scroll down to show list
    await page.evaluate(() => window.scrollBy({ top: 200, behavior: "smooth" }));
    await showCallout(page, "Filter by industry, region, shore power, or priority");
    await pauseForNarration(page, 3000);
    await hideCallout(page);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await pauseForViewer(500);

    // ── Section 2: Lead profile ──────────────────────────────────────────────
    await stepTitle(page, "Lead Profile — Everything About One Marina");
    const firstLeadRow = await page.waitForSelector(
      '[data-testid^="row-lead-"]', { timeout: 10000 }
    ).catch(() => null);
    if (firstLeadRow) {
      await firstLeadRow.click();
      await waitForAppReady(page);
      await showCallout(page, "Everything about this lead — one view");
      await pauseForNarration(page, 4000);
      await hideCallout(page);
      await showCallout(page, "AI-powered lead score — how likely to convert");
      await pauseForNarration(page, 3000);
      await hideCallout(page);
    } else {
      console.warn("[02] No lead rows — skipping lead profile.");
    }

    // ── Section 3: Accounts list ─────────────────────────────────────────────
    await stepTitle(page, "Accounts — Active Marina Relationships");
    await page.goto(`${BASE}/accounts`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "From prospect to active account");
    await pauseForNarration(page, 3000);
    await hideCallout(page);

    // ── Section 4: Account profile ───────────────────────────────────────────
    await stepTitle(page, "Account Profile — Full Intelligence View");
    const firstAccount = await page.waitForSelector(
      'a[href^="/accounts/"]', { timeout: 10000 }
    ).catch(() => null);
    if (firstAccount) {
      await firstAccount.click();
      await waitForAppReady(page);
      await showCallout(page, "The full intelligence profile");
      await pauseForNarration(page, 4500);
      await hideCallout(page);
    } else {
      console.warn("[02] No account links — skipping account profile.");
    }

    // ── Section 5: Contacts list ─────────────────────────────────────────────
    await stepTitle(page, "Contacts — The People You Talk To");
    await page.goto(`${BASE}/contacts`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "The people behind each marina");
    await pauseForNarration(page, 3000);
    await hideCallout(page);

    // ── Section 6: Contact profile ───────────────────────────────────────────
    const firstContact = await page.waitForSelector(
      '[data-testid^="contact-row-"]', { timeout: 10000 }
    ).catch(() => null);
    if (firstContact) {
      await firstContact.click();
      await waitForAppReady(page);
      await showCallout(page, "Person-level relationship detail");
      await pauseForNarration(page, 4000);
      await hideCallout(page);
    }

    console.log("[02] Recording complete. Saving …");
  } catch (err) {
    console.error("[02] FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await page.close();
    const saved = await saveVideoWithReadableName(page, "02-leads-accounts-contacts");
    await context.close();
    await browser.close();
    if (saved) console.log(`[02] ✓ Saved → ${saved}`);
  }
})();
