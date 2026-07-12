"use strict";
/** cap-03 Part B — Data Room & Materials (sections 6-10) ~110s */
const { getBaseUrl, getCredentials, launchBrowser, createRecordingContext,
  login, enableDemoMode, waitForAppReady, pauseForViewer, pauseForNarration,
  showCallout, hideCallout, stepTitle, saveVideoWithReadableName,
} = require("./helpers.cjs");

async function section(page, title, url, callouts) {
  await stepTitle(page, title);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
  await pauseForViewer(800);
  for (const [text, ms] of callouts) {
    await showCallout(page, text);
    await pauseForNarration(page, ms || 3500);
    await hideCallout(page);
    await pauseForViewer(500);
  }
}

(async () => {
  const BASE = getBaseUrl();
  const { email, password } = getCredentials();
  const browser = await launchBrowser();
  const context = await createRecordingContext(browser);
  const page = await context.newPage();
  try {
    await login(page, BASE, email, password);
    await enableDemoMode(page);

    await section(page, "Sharing Documents with Investors", `${BASE}/capital/data-room`, [
      ["Assign investor access from the investor's record in the Pipeline.", 3500],
      ["Once access is granted, the investor can view permitted documents via the portal.", 3500],
      ["You receive a notification when an investor views a document — useful signal.", 3500],
    ]);
    await section(page, "Investor Portal", `${BASE}/capital/updates`, [
      ["The Investor Portal is a read-only view that investors access via a secure link.", 3500],
      ["It shows only the documents they have been permitted to view.", 3500],
      ["The portal includes your company updates so investors stay informed between meetings.", 3500],
    ]);
    await section(page, "Version Control & Document History", `${BASE}/capital/data-room`, [
      ["Every document upload creates a new version — previous versions are retained.", 3500],
      ["Investors always access the most current deck, model, or legal document.", 3500],
      ["Version history protects you during diligence — proving what was shared and when.", 3500],
    ]);
    await section(page, "Due Diligence Best Practices", `${BASE}/capital/data-room`, [
      ["Prepare your Data Room before you start investor outreach — not after.", 3500],
      ["A complete, well-organized data room shortens the diligence timeline significantly.", 3500],
      ["Update documents immediately when numbers change — never let stale data circulate.", 3500],
    ]);
    await section(page, "Data Room in Context", `${BASE}/capital/command-center`, [
      ["The Command Center shows data room activity — which investors are viewing materials.", 3500],
      ["Document views from investors are tracked as engagement signals in Follow-Ups.", 3500],
      ["A spike in document views often precedes an investor moving to diligence stage.", 3500],
    ]);

    console.log("[cap-03b] Done. Saving…");
  } catch (err) {
    console.error("[cap-03b] FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await page.close();
    const saved = await saveVideoWithReadableName(page, "cap-03b");
    await context.close();
    await browser.close();
    if (saved) console.log(`[cap-03b] ✓ ${saved}`);
  }
})();
