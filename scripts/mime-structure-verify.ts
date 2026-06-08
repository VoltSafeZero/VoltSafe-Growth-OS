/**
 * Real-world MIME structure verification for CTA inline images.
 * Runs the full extractCtaInlineImages → buildMimeRaw pipeline
 * using real DB data and WatchDemo CTA images specifically.
 *
 * Set SEND=1 to also fire a live test email to self.
 */
import path from "path";
import fs from "fs";
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { extractCtaInlineImages, buildMimeRawDebug } from "../server/gmail";

const CTA_ASSETS_DIR = path.resolve("uploads/cta-assets");
const MIME_DUMP_PATH = "/tmp/cid-mime-dump.txt";

async function main() {
  console.log("=== CTA MIME Structure Verification ===\n");

  // ── Step 1: Confirm WatchDemo assets are in DB with file_data ────────────
  const assets = (await db.execute(sql.raw(`
    SELECT id, filename, file_size, (file_data IS NOT NULL) as has_data, mime_type
    FROM cta_assets
    WHERE filename IN ('WatchDemo_Thumbnail_200.png', 'WatchDemo_Thumbnail_600.png')
    AND is_archived = FALSE
    ORDER BY filename
  `))).rows as any[];
  console.log("[1] CTA assets in DB:");
  assets.forEach(a => console.log(`    id=${a.id}  ${a.filename}  size=${a.file_size}  has_data=${a.has_data}`));
  if (assets.length < 2 || !assets.every(a => a.has_data)) {
    console.error("[FAIL] WatchDemo assets missing or file_data not populated");
    process.exit(1);
  }

  // ── Step 2: Craft HTML with both WatchDemo images inside sig markers ─────
  const baseUrl = "https://voltsafe-app.replit.app";
  const html = [
    "<html><body>",
    "<p>Test email body — verifying CTA CID inlining for Apple Mail.</p>",
    "<!--vs-sig-start-->",
    "<table cellpadding='0' cellspacing='0'><tr><td>",
    `<a href="${baseUrl}/watch-demo">`,
    `<img src="${baseUrl}/assets/cta/WatchDemo_Thumbnail_200.png" width="200" alt="Watch Demo" />`,
    `</a>`,
    `<a href="${baseUrl}/watch-demo">`,
    `<img src="${baseUrl}/assets/cta/WatchDemo_Thumbnail_600.png" width="600" alt="Watch Demo HD" />`,
    `</a>`,
    "</td></tr></table>",
    "<!--vs-sig-end-->",
    "</body></html>",
  ].join("\n");

  console.log("\n[2] Input HTML img srcs:", (html.match(/src="([^"]+)"/g) ?? []));

  // ── Step 3: extractCtaInlineImages ──────────────────────────────────────
  console.log("\n[3] Running extractCtaInlineImages...");
  const { html: cidHtml, inlineImages } = await extractCtaInlineImages(html, CTA_ASSETS_DIR);

  console.log("[3] Result:");
  console.log("    inlineImages.length =", inlineImages.length, "(want 2)");
  for (const img of inlineImages) {
    console.log(`    • cid=${img.cid}  bytes=${img.data.byteLength}  mime=${img.mimeType}  fname=${img.filename}`);
  }
  const htmlHasCidSrc        = /src="cid:/.test(cidHtml);
  const htmlStillHasAssetSrc = /<img[^>]*src="[^"]*\/assets\/cta\//.test(cidHtml);
  console.log("    htmlHasCidSrc =", htmlHasCidSrc, "(want true)");
  console.log("    htmlStillHasAssetSrc =", htmlStillHasAssetSrc, "(want false)");

  if (inlineImages.length === 0) {
    console.error("\n[FAIL] extractCtaInlineImages returned 0 images — GATE would fire!");
    process.exit(1);
  }

  // ── Step 4: Build raw MIME and inspect ──────────────────────────────────
  console.log("\n[4] Building raw MIME via buildMimeRawDebug...");
  const from    = "trevor@voltsafe.com";
  const to      = "trevor@voltsafe.com";
  const subject = "CTA CID Inline Structure Test — " + new Date().toISOString();

  // buildMimeRawDebug returns a plain string (decoded from base64url)
  const rawMime: string = buildMimeRawDebug(
    from, to, subject, cidHtml, [], undefined, undefined, undefined, inlineImages,
  );

  fs.writeFileSync(MIME_DUMP_PATH, rawMime, "utf-8");
  console.log("[4] Full MIME written to", MIME_DUMP_PATH, `(${rawMime.length.toLocaleString()} bytes)`);

  // ── Step 5: Print abridged MIME header tree ──────────────────────────────
  console.log("\n[5] MIME Header Tree (boundaries + headers only):\n");
  const lines = rawMime.split(/\r\n|\n/);
  let inBody = false;
  for (const line of lines) {
    if (line.startsWith("--")) {
      inBody = false;
      console.log(line.endsWith("--") ? `  └─ ${line.trim()} (end)` : `\n  ├─ ${line.trim()}`);
      continue;
    }
    if (!inBody) {
      if (line === "") { inBody = true; continue; }
      const lc = line.toLowerCase();
      if (
        lc.startsWith("content-type:") || lc.startsWith("content-disposition:") ||
        lc.startsWith("content-transfer-encoding:") || lc.startsWith("content-id:") ||
        lc.startsWith("from:") || lc.startsWith("to:") || lc.startsWith("subject:")
      ) {
        console.log("  │  " + line.trim());
      }
    }
  }

  // ── Step 6: Verification checklist ──────────────────────────────────────
  console.log("\n[6] Verification Checklist:");
  let allOk = true;

  const chk = (label: string, pass: boolean) => {
    console.log(`  ${pass ? "✓" : "✗"} ${label}`);
    if (!pass) allOk = false;
    return pass;
  };

  const mimeHasRelated = rawMime.includes("multipart/related");
  const mimeHasMixed   = rawMime.includes("multipart/mixed");
  const mimeHasAlt     = rawMime.includes("multipart/alternative");

  chk("2 inline images produced by extractCtaInlineImages", inlineImages.length === 2);
  chk("HTML has cid: src references", htmlHasCidSrc);
  chk("HTML has NO remaining /assets/cta/ img src", !htmlStillHasAssetSrc);
  chk("MIME contains multipart/related", mimeHasRelated);
  chk("MIME does NOT use multipart/alternative (would orphan CID parts)", !mimeHasAlt);
  chk("No /assets/cta/ URL in MIME img src attributes", !/<img[^>]*src="[^"]*\/assets\/cta\//.test(rawMime));

  // Verify each CID image part headers
  for (const img of inlineImages) {
    const cidMarker = `Content-ID: <${img.cid}>`;
    const idx = rawMime.indexOf(cidMarker);
    if (idx === -1) {
      chk(`CID part <${img.cid}> found in MIME`, false);
      continue;
    }
    const snippet = rawMime.substring(Math.max(0, idx - 300), idx + 100);
    chk(`CID part <${img.cid}>: Content-Type: image/png`, /content-type:\s*image\/png/i.test(snippet));
    chk(`CID part <${img.cid}>: Content-Transfer-Encoding: base64`, /content-transfer-encoding:\s*base64/i.test(snippet));
    chk(`CID part <${img.cid}>: Content-ID header`, snippet.includes(cidMarker));

    // Content-Disposition must be ABSENT (Apple Mail ghost attachment bug)
    const hasDisp = /content-disposition:/i.test(snippet);
    chk(`CID part <${img.cid}>: Content-Disposition ABSENT (Apple Mail fix)`, !hasDisp);
    if (hasDisp) {
      const dispLine = snippet.match(/content-disposition:[^\n]*/i)?.[0] ?? "";
      console.log(`    (found: ${dispLine.trim()})`);
    }
  }

  // Verify images are inside multipart/related, not loose under multipart/mixed
  const relBndMatch = rawMime.match(/multipart\/related;\s*boundary="([^"]+)"/);
  if (relBndMatch) {
    const relBnd = relBndMatch[1];
    const relStart = rawMime.indexOf(`multipart/related; boundary="${relBnd}"`);
    const relEnd   = rawMime.indexOf(`--${relBnd}--`, relStart);
    if (relStart !== -1 && relEnd !== -1) {
      const relSection = rawMime.substring(relStart, relEnd);
      chk("text/html is direct child of multipart/related", relSection.includes("Content-Type: text/html"));
      chk("ALL CID parts are inside multipart/related", inlineImages.every(i => relSection.includes(`<${i.cid}>`)));
    }
  }

  // Check no CTA images appear as attachments (should not have disposition: attachment)
  const attachmentCount = (rawMime.match(/Content-Disposition: attachment/g) ?? []).length;
  chk("No CTA images have Content-Disposition: attachment", attachmentCount === 0);

  // Determine and display the MIME case
  console.log("\n[7] MIME Structure:");
  if (mimeHasRelated && !mimeHasMixed) {
    console.log("    Case B: multipart/related → text/html + inline CID parts  ✓");
    console.log("    (No attachments — correct for signature-only email)");
  } else if (mimeHasRelated && mimeHasMixed) {
    console.log("    Case C: multipart/mixed → multipart/related → text/html + inline CID parts");
  } else if (!mimeHasRelated) {
    console.log("    ⚠ No multipart/related — CID images would be orphaned!");
    allOk = false;
  }

  console.log("\n" + (allOk ? "✅ All checks PASSED" : "❌ Some checks FAILED — see ✗ above"));
  console.log("Full MIME dump at:", MIME_DUMP_PATH, "\n");

  // ── Step 7: Optional live send ────────────────────────────────────────────
  if (process.env.SEND === "1") {
    console.log("[8] SEND=1 — firing live test email...");
    const { sendEmail } = await import("../server/gmail");
    const accs = (await db.execute(sql.raw(
      "SELECT id, email FROM gmail_accounts WHERE status = 'active' ORDER BY id LIMIT 1"
    ))).rows as any[];
    if (!accs.length) { console.error("[SEND] No active Gmail account found"); process.exit(1); }
    const acc = accs[0];
    console.log(`[SEND] Account: ${acc.email} (id=${acc.id}) → sending to self`);
    const result = await sendEmail(
      acc.id as number,
      acc.email as string,
      subject,
      cidHtml,
      undefined,    // threadId
      [],           // attachments
      undefined,    // accountId
      undefined,    // cc
      undefined,    // bcc
      undefined,    // icalContent
      inlineImages,
    );
    if ((result as any)?.messageId) {
      console.log(`[SEND] ✅ Sent! messageId=${(result as any).messageId}`);
      console.log(`[SEND] Check Gmail for: "${subject}"`);
      // Show final MIME dump from the actual send
      if (fs.existsSync("/tmp/live-sent-mime.txt")) {
        console.log("\n[SEND] Live MIME dump at: /tmp/live-sent-mime.txt");
      }
    } else {
      console.log("[SEND] result:", JSON.stringify(result));
    }
  } else {
    console.log("(Set SEND=1 to also fire a live test email)");
  }

  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error("[FATAL]", e.message, "\n", e.stack);
  process.exit(1);
});
