"use strict";
/**
 * Video 02 — Leads, Accounts & Contacts
 *
 * Leads list → lead profile → Accounts → account detail → Contacts.
 *
 * Run:  npm run video:crm
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
    console.log("[02] Logging in …");
    await login(page, BASE, email, password);
    await enableDemoMode(page);

    // Section 1: Leads list
    console.log("[02] Leads list …");
    await page.goto(`${BASE}/opportunities`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await pauseForViewer(3000);

    // Section 2: Drill into first lead
    console.log("[02] Opening first lead …");
    const firstLeadRow = await page.waitForSelector(
      '[data-testid^="row-lead-"]',
      { timeout: 10000 }
    ).catch(() => null);
    if (firstLeadRow) {
      await firstLeadRow.click();
      await waitForAppReady(page);
      await pauseForViewer(3500);
    } else {
      console.warn("[02] No lead rows visible — skipping drill-down.");
    }

    // Section 3: Accounts list
    console.log("[02] Accounts list …");
    await page.goto(`${BASE}/accounts`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await pauseForViewer(3000);

    // Section 4: Open first account
    console.log("[02] Opening first account …");
    const firstAccount = await page.waitForSelector(
      'a[href^="/accounts/"]',
      { timeout: 10000 }
    ).catch(() => null);
    if (firstAccount) {
      await firstAccount.click();
      await waitForAppReady(page);
      await pauseForViewer(3500);
    } else {
      console.warn("[02] No account links visible — skipping.");
    }

    // Section 5: Contacts list
    console.log("[02] Contacts list …");
    await page.goto(`${BASE}/contacts`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await pauseForViewer(3000);

    // Section 6: Open first contact
    console.log("[02] Opening first contact …");
    const firstContact = await page.waitForSelector(
      '[data-testid^="contact-row-"]',
      { timeout: 10000 }
    ).catch(() => null);
    if (firstContact) {
      await firstContact.click();
      await waitForAppReady(page);
      await pauseForViewer(3500);
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
