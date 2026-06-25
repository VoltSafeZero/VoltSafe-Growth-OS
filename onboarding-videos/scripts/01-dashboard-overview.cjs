"use strict";
/**
 * Video 01 — VoltSafe CMS Dashboard Overview
 * Storyboard: onboarding-videos/storyboards/01-dashboard-overview.md
 * Run: npm run video:dashboard
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
    console.log("[01] Logging in …");
    await login(page, BASE, email, password);
    await enableDemoMode(page);

    // ── Section 1: Role Command Center ───────────────────────────────────────
    await stepTitle(page, "Your Daily Starting Point");
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "Your daily starting point");
    await pauseForNarration(page, 4000);
    await hideCallout(page);

    // ── Section 2: Executive Dashboard ───────────────────────────────────────
    await stepTitle(page, "Executive Dashboard");
    await page.goto(`${BASE}/executive-dashboard`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "KPIs at a glance — pipeline, bookings, team activity");
    await pauseForNarration(page, 4000);
    await hideCallout(page);

    // ── Section 3: Leads ─────────────────────────────────────────────────────
    await stepTitle(page, "Leads — Your Prospect List");
    await page.goto(`${BASE}/opportunities`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "Every marina prospect lives here");
    await pauseForNarration(page, 3000);
    await hideCallout(page);

    // ── Section 4: Accounts ──────────────────────────────────────────────────
    await stepTitle(page, "Accounts — Active Relationships");
    await page.goto(`${BASE}/accounts`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "Active accounts & marinas you're working with");
    await pauseForNarration(page, 3000);
    await hideCallout(page);

    // ── Section 5: Pipeline ──────────────────────────────────────────────────
    await stepTitle(page, "Pipeline — Deals in Motion");
    await page.goto(`${BASE}/pipeline`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "Every deal, organised by stage");
    await pauseForNarration(page, 3000);
    await hideCallout(page);

    // ── Section 6: Mail ──────────────────────────────────────────────────────
    await stepTitle(page, "VoltSafe Mail — CRM-Connected Inbox");
    await page.goto(`${BASE}/gmail`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "Email built for sales — every message linked to CRM");
    await pauseForNarration(page, 3500);
    await hideCallout(page);

    // ── Section 7: AI Copilot ─────────────────────────────────────────────────
    await stepTitle(page, "Cortex AI — Your Sales Copilot");
    await page.goto(`${BASE}/executive-copilot`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "AI-powered insights: who to call, what to say, what's at risk");
    await pauseForNarration(page, 3500);
    await hideCallout(page);

    // ── Return home ──────────────────────────────────────────────────────────
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await showCallout(page, "Explore at your own pace — more detail in the next videos");
    await pauseForViewer(2500);
    await hideCallout(page);

    console.log("[01] Recording complete. Saving …");
  } catch (err) {
    console.error("[01] FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await page.close();
    const saved = await saveVideoWithReadableName(page, "01-dashboard-overview");
    await context.close();
    await browser.close();
    if (saved) console.log(`[01] ✓ Saved → ${saved}`);
  }
})();
