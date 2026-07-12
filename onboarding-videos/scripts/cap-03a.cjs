"use strict";
/** cap-03 Part A — Data Room & Materials (sections 1-5) ~110s */
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

    await section(page, "Data Room & Materials", `${BASE}/capital/data-room`, [
      ["The Data Room is your secure repository of all investor diligence materials.", 3500],
      ["It replaces Dropbox links and email attachments with a structured workspace.", 3500],
      ["Investors access only the documents you explicitly share with them.", 3500],
    ]);
    await section(page, "Folder Organization", `${BASE}/capital/data-room`, [
      ["Organize documents into standard folders: Financials, Legal, Team, Product, Market.", 3500],
      ["A clear structure signals operational maturity to investors doing diligence.", 3500],
      ["Investors can navigate folders independently — reducing email back-and-forth.", 3500],
    ]);
    await section(page, "Document Categories", `${BASE}/capital/data-room`, [
      ["Financials: models, cap table, historical P&L, and revenue projections.", 3500],
      ["Legal: incorporation documents, IP assignments, and existing investor agreements.", 3500],
      ["Team: founder bios, org chart, key hire plans, and reference contacts.", 3500],
    ]);
    await section(page, "Confidentiality & Permissions", `${BASE}/capital/data-room`, [
      ["Not all documents should be visible to all investors at every stage.", 3500],
      ["Mark sensitive documents as Confidential to restrict access to approved investors only.", 3500],
      ["Share the pitch deck early, but only share financials after a first meeting.", 3500],
    ]);
    await section(page, "Uploading Documents", `${BASE}/capital/data-room`, [
      ["Upload documents directly from your computer into the appropriate folder.", 3500],
      ["Supported formats: PDF, DOCX, XLSX, PPTX, and common image formats.", 3500],
      ["Each upload is timestamped and versioned automatically — no data is ever lost.", 3500],
    ]);

    console.log("[cap-03a] Done. Saving…");
  } catch (err) {
    console.error("[cap-03a] FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await page.close();
    const saved = await saveVideoWithReadableName(page, "cap-03a");
    await context.close();
    await browser.close();
    if (saved) console.log(`[cap-03a] ✓ ${saved}`);
  }
})();
