"use strict";
/**
 * Video 09 (cap-03) — Data Room & Materials
 * Target runtime: ~3.5–4 min
 * Storyboard: onboarding-videos/storyboards/cap-03-data-room.md
 * Run: node onboarding-videos/scripts/cap-03-data-room.cjs
 */

const {
  getBaseUrl, getCredentials,
  launchBrowser, createRecordingContext,
  login, enableDemoMode, waitForAppReady,
  pauseForViewer, pauseForNarration,
  showCallout, hideCallout, stepTitle,
  saveVideoWithReadableName,
} = require("./helpers.cjs");

async function section(page, title, url, callouts) {
  await stepTitle(page, title);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
  await pauseForViewer(1000);
  for (const [text, ms] of callouts) {
    await showCallout(page, text);
    await pauseForNarration(page, ms || 5000);
    await hideCallout(page);
    await pauseForViewer(600);
  }
}

(async () => {
  const BASE = getBaseUrl();
  const { email, password } = getCredentials();

  const browser = await launchBrowser();
  const context = await createRecordingContext(browser);
  const page    = await context.newPage();

  try {
    console.log("[cap-03] Logging in …");
    await login(page, BASE, email, password);
    await enableDemoMode(page);

    // ── SECTION 1: Introduction ──────────────────────────────────────────
    await section(page, "Data Room & Materials", `${BASE}/capital/data-room`, [
      ["The Data Room is your secure, organized repository of all investor diligence materials.", 5000],
      ["It replaces Dropbox links and email attachments with a structured, permissioned workspace.", 5500],
      ["Investors access only the documents you explicitly share with them.", 4500],
    ]);

    // ── SECTION 2: Folder Organization ──────────────────────────────────
    await section(page, "Folder Organization", `${BASE}/capital/data-room`, [
      ["Organize documents into standard folders: Financials, Legal, Team, Product, Market.", 5500],
      ["A clear structure signals operational maturity to investors doing diligence.", 5000],
      ["Investors can navigate folders independently — reducing back-and-forth email requests.", 5000],
      ["Keep folder names consistent across rounds so returning investors find materials easily.", 4500],
    ]);

    // ── SECTION 3: Document Categories ──────────────────────────────────
    await section(page, "Document Categories", `${BASE}/capital/data-room`, [
      ["Financials: models, cap table, historical P&L, and revenue projections.", 5000],
      ["Legal: incorporation documents, IP assignments, existing investor agreements.", 5000],
      ["Team: founder bios, org chart, key hire plans, and reference contacts.", 4500],
      ["Product: roadmap, technical architecture, demo recordings, and customer case studies.", 5000],
      ["Market: TAM analysis, competitive landscape, and industry research.", 4500],
    ]);

    // ── SECTION 4: Confidentiality Controls ─────────────────────────────
    await section(page, "Confidentiality & Permissions", `${BASE}/capital/data-room`, [
      ["Not all documents should be visible to all investors at every stage.", 5000],
      ["Mark sensitive documents as Confidential to restrict access to approved investors only.", 5500],
      ["For example: share the pitch deck early, but only share financials after a first meeting.", 5500],
      ["Permissions are managed per investor — fine-grained control without complex sharing links.", 5000],
    ]);

    // ── SECTION 5: Uploading Documents ──────────────────────────────────
    await section(page, "Uploading Documents", `${BASE}/capital/data-room`, [
      ["Upload documents directly from your computer into the appropriate folder.", 5000],
      ["Supported formats: PDF, DOCX, XLSX, PPTX, and common image formats.", 4500],
      ["Each upload is timestamped and versioned automatically.", 4500],
      ["Replace a document with a newer version — investors see the latest file, not the old one.", 5000],
    ]);

    // ── SECTION 6: Sharing with Investors ───────────────────────────────
    await section(page, "Sharing Documents with Investors", `${BASE}/capital/data-room`, [
      ["Assign investor access from the investor's record in the Pipeline.", 5000],
      ["Once access is granted, the investor can view their permitted documents via the portal.", 5000],
      ["You receive a notification when an investor views a document — useful engagement signal.", 5500],
      ["Revoke access at any time, for example if an investor passes on the round.", 4500],
    ]);

    // ── SECTION 7: Investor Portal ───────────────────────────────────────
    await section(page, "Investor Portal", `${BASE}/capital/updates`, [
      ["The Investor Portal is a read-only view that investors access with a secure link.", 5000],
      ["It shows only the documents they have been permitted to view.", 4500],
      ["The portal includes your company updates so investors stay informed between meetings.", 5000],
      ["No login required for investors — they access via a unique, secure URL you send them.", 5000],
    ]);

    // ── SECTION 8: Version Control ───────────────────────────────────────
    await section(page, "Version Control & Document History", `${BASE}/capital/data-room`, [
      ["Every document upload creates a new version — previous versions are retained.", 5000],
      ["This ensures investors always access the most current deck, model, or legal document.", 5000],
      ["Version history protects you during diligence — you can prove what was shared and when.", 5000],
      ["Never delete and re-upload — always use the Replace Version function to maintain history.", 4500],
    ]);

    // ── SECTION 9: Diligence Best Practices ─────────────────────────────
    await section(page, "Due Diligence Best Practices", `${BASE}/capital/data-room`, [
      ["Prepare your Data Room before you start investor outreach — not after.", 5500],
      ["A complete, well-organized data room shortens the diligence timeline significantly.", 5000],
      ["Include a data room index document at the top level for quick investor orientation.", 5000],
      ["Update documents immediately when numbers change — never let stale data circulate.", 5000],
    ]);

    // ── SECTION 10: Command Center Connection ────────────────────────────
    await section(page, "Data Room in Context", `${BASE}/capital/command-center`, [
      ["The Command Center shows data room activity — which investors are viewing materials.", 5000],
      ["Document views from investors are tracked as engagement signals in Follow-Ups.", 5000],
      ["A spike in document views often precedes an investor moving to diligence stage.", 4500],
      ["Keep your data room current — it is often the last thing an investor reviews before committing.", 5000],
    ]);

    console.log("[cap-03] Recording complete. Saving …");
  } catch (err) {
    console.error("[cap-03] FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await page.close();
    const saved = await saveVideoWithReadableName(page, "cap-03-data-room");
    await context.close();
    await browser.close();
    if (saved) console.log(`[cap-03] ✓ Saved → ${saved}`);
  }
})();
