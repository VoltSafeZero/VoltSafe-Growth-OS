/**
 * Real-world MIME structure verification for CTA inline images.
 * Runs the full extractCtaInlineImages → buildMimeRaw pipeline
 * using real DB data and dumps the resulting MIME tree to inspect.
 *
 * Also optionally sends a live test email when SEND=1 env var is set.
 */
import path from "path";
import fs from "fs";
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { extractCtaInlineImages, buildMimeRawDebug } from "../server/gmail";

const CTA_ASSETS_DIR = path.resolve("uploads/cta-assets");
const MIME_DUMP_PATH = "/tmp/cid-mime-dump.txt";

async function getSigWithCta(): Promise<{ html: string; userId: number } | null> {
  // Find a signature whose html_content references /assets/cta/ images
  const rows = (await db.execute(sql.raw(`
    SELECT es.id, es.user_id, es.html_content
    FROM email_signatures es
    WHERE es.html_content LIKE '%/assets/cta/%'
    ORDER BY es.updated_at DESC NULLS LAST
    LIMIT 1
  `))).rows as any[];
  if (!rows.length) return null;
  return { html: rows[0].html_content as string, userId: rows[0].user_id as number };
}

async function main() {
  console.log("=== CTA MIME Structure Verification ===\n");

  // ── Step 1: Get real signature HTML ─────────────────────────────────────
  const sig = await getSigWithCta();
  if (!sig) {
    console.error("[FAIL] No signature found with /assets/cta/ images in DB");
    process.exit(1);
  }
  const ctaSrcs = (sig.html.match(/src="([^"]*\/assets\/cta\/[^"]+)"/gi) ?? []);
  console.log("[1] Found signature with CTA images:");
  console.log("    userId =", sig.userId);
  console.log("    ctaSrcs =", ctaSrcs);
  console.log("    htmlLen =", sig.html.length);

  // ── Step 2: Wrap in vs-sig-start/end markers (simulates send pipeline) ──
  const wrappedHtml = `<html><body><p>Test email body — verifying CTA CID inlining.</p><!--vs-sig-start-->${sig.html}<!--vs-sig-end--></body></html>`;

  // ── Step 3: extractCtaInlineImages ──────────────────────────────────────
  console.log("\n[2] Running extractCtaInlineImages...");
  const { html: cidHtml, inlineImages } = await extractCtaInlineImages(wrappedHtml, CTA_ASSETS_DIR);

  console.log("[2] Result:");
  console.log("    inlineImages.length =", inlineImages.length);
  for (const img of inlineImages) {
    console.log(`    • cid=${img.cid}  bytes=${img.data.byteLength}  mime=${img.mimeType}  fname=${img.filename}`);
  }
  const htmlHasCidSrc = /src="cid:/.test(cidHtml);
  const htmlStillHasAssetSrc = /<img[^>]*src="[^"]*\/assets\/cta\//.test(cidHtml);
  console.log("    htmlHasCidSrc =", htmlHasCidSrc);
  console.log("    htmlStillHasAssetSrc =", htmlStillHasAssetSrc);

  if (inlineImages.length === 0) {
    console.error("\n[FAIL] extractCtaInlineImages returned 0 images — GATE would fire!");
    process.exit(1);
  }

  // ── Step 4: Build raw MIME and inspect structure ─────────────────────────
  console.log("\n[3] Building raw MIME via buildMimeRawDebug...");
  const from = "test@voltsafe.com";
  const to = "verify@example.com";
  const subject = "CTA CID Inline Test — " + new Date().toISOString();

  const { rawMime } = buildMimeRawDebug(from, to, subject, cidHtml, [], undefined, undefined, undefined, inlineImages);

  // Write full MIME to file for inspection
  fs.writeFileSync(MIME_DUMP_PATH, rawMime, "utf-8");
  console.log("[3] Full MIME written to", MIME_DUMP_PATH, `(${rawMime.length} bytes)`);

  // ── Step 5: Parse and display MIME tree ──────────────────────────────────
  console.log("\n[4] MIME Structure Tree:\n");
  const lines = rawMime.split(/\r\n|\n/);

  // Print header lines and part boundaries
  let inBody = false;
  let partCount = 0;
  let headerLines: string[] = [];
  const boundaryStack: string[] = [];
  const tree: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect boundary markers
    if (line.startsWith("--") && !line.startsWith("---")) {
      const bnd = line.replace(/^--/, "").replace(/--$/, "").trim();
      if (line.endsWith("--")) {
        tree.push(`  END BOUNDARY: ${line.trim()}`);
      } else {
        tree.push(`PART: ${line.trim()}`);
        partCount++;
        headerLines = [];
        inBody = false;
      }
      continue;
    }

    // Track important header lines
    if (!inBody) {
      if (line === "") {
        inBody = true;
        continue;
      }
      const key = line.toLowerCase();
      if (
        key.startsWith("content-type:") ||
        key.startsWith("content-disposition:") ||
        key.startsWith("content-transfer-encoding:") ||
        key.startsWith("content-id:") ||
        key.startsWith("from:") ||
        key.startsWith("to:") ||
        key.startsWith("subject:")
      ) {
        tree.push("  " + line.trim());
      }
    }
  }

  tree.forEach(l => console.log(l));
  console.log(`\n  Total MIME parts detected: ${partCount}`);

  // ── Step 6: Checklist ─────────────────────────────────────────────────────
  console.log("\n[5] Verification Checklist:");

  const check = (label: string, pass: boolean) => {
    console.log(`  ${pass ? "✓" : "✗"} ${label}`);
    return pass;
  };

  const mimeHasRelated = rawMime.includes("multipart/related");
  const mimeHasMixed   = rawMime.includes("multipart/mixed");
  const mimeHasAlt     = rawMime.includes("multipart/alternative");
  const mimeHasCidRef  = rawMime.includes("cid:");
  const noAssetSrc     = !/<img[^>]*src="[^"]*\/assets\/cta\//.test(rawMime);

  // Check each CTA image MIME part
  let imageParts: { ok: boolean; cid: string; hasCT: boolean; hasTE: boolean; hasCID: boolean; hasDisp: boolean }[] = [];
  for (const img of inlineImages) {
    const cidMarker = `Content-ID: <${img.cid}>`;
    const idx = rawMime.indexOf(cidMarker);
    if (idx === -1) {
      imageParts.push({ ok: false, cid: img.cid, hasCT: false, hasTE: false, hasCID: false, hasDisp: false });
      continue;
    }
    // Grab the 300 chars around this CID header for inspection
    const snippet = rawMime.substring(idx - 200, idx + 200);
    const hasCT   = /content-type:\s*image\/png/i.test(snippet);
    const hasTE   = /content-transfer-encoding:\s*base64/i.test(snippet);
    const hasCID  = snippet.includes(`Content-ID: <${img.cid}>`);
    const hasDisp = /content-disposition:\s*inline/i.test(snippet);
    imageParts.push({ ok: hasCT && hasTE && hasCID, cid: img.cid, hasCT, hasTE, hasCID, hasDisp });
  }

  let allOk = true;
  allOk = check(`extractCtaInlineImages produced ${inlineImages.length} inline images (want 2)`, inlineImages.length === 2) && allOk;
  allOk = check("HTML has cid: src references", htmlHasCidSrc) && allOk;
  allOk = check("HTML does NOT still have /assets/cta/ img src", !htmlStillHasAssetSrc) && allOk;
  allOk = check("MIME contains multipart/related container", mimeHasRelated) && allOk;
  allOk = check("MIME does NOT use multipart/alternative for inline-image case (would break CID)", !mimeHasAlt || mimeHasRelated) && allOk;
  allOk = check("MIME contains cid: references", mimeHasCidRef) && allOk;
  allOk = check("MIME has no /assets/cta/ in img src after send pipeline", noAssetSrc) && allOk;

  for (const ip of imageParts) {
    allOk = check(`CID part <${ip.cid}>: Content-Type: image/png`, ip.hasCT) && allOk;
    allOk = check(`CID part <${ip.cid}>: Content-Transfer-Encoding: base64`, ip.hasTE) && allOk;
    allOk = check(`CID part <${ip.cid}>: Content-ID header present`, ip.hasCID) && allOk;
    console.log(`  ${ip.hasDisp ? "✓" : "·"} CID part <${ip.cid}>: Content-Disposition: inline (${ip.hasDisp ? "present" : "absent — omitted per RFC 2392"})`);
  }

  // Correct structure: CTA images are children of multipart/related, not siblings of text/html under multipart/mixed
  const relBndMatch = rawMime.match(/multipart\/related;\s*boundary="([^"]+)"/);
  if (relBndMatch) {
    const relBnd = relBndMatch[1];
    // Find the related section
    const relStart = rawMime.indexOf(`Content-Type: multipart/related; boundary="${relBnd}"`);
    const relEnd   = rawMime.indexOf(`--${relBnd}--`, relStart);
    if (relStart !== -1 && relEnd !== -1) {
      const relSection = rawMime.substring(relStart, relEnd + `--${relBnd}--`.length);
      const htmlInRelated  = relSection.includes("Content-Type: text/html");
      const imagesInRelated = inlineImages.every(img => relSection.includes(`Content-ID: <${img.cid}>`));
      allOk = check("text/html is inside multipart/related (correct structure)", htmlInRelated) && allOk;
      allOk = check("All CID image parts are inside multipart/related (not loose under mixed)", imagesInRelated) && allOk;
    }
  }

  // Show the top-level MIME type
  const topLevel = lines.find(l => l.toLowerCase().startsWith("content-type: multipart/"));
  console.log("\n[6] Top-level MIME type:", topLevel ?? "(not found — check dump)");

  // Case B or C?
  if (mimeHasRelated && !mimeHasMixed) {
    console.log("    → Case B: multipart/related is ROOT (no attachments) ✓");
  } else if (mimeHasRelated && mimeHasMixed) {
    console.log("    → Case C: multipart/mixed wraps multipart/related (has attachments)");
  } else if (!mimeHasRelated) {
    console.log("    → PROBLEM: No multipart/related found — CID images are orphaned!");
    allOk = false;
  }

  console.log("\n" + (allOk ? "✅ All checks PASSED" : "❌ Some checks FAILED — see ✗ above"));
  console.log("\nFull MIME dump at:", MIME_DUMP_PATH);

  // ── Optional live send ────────────────────────────────────────────────────
  if (process.env.SEND === "1") {
    console.log("\n[7] SEND=1 — sending live test email...");
    const { sendEmail } = await import("../server/gmail");
    // Find a real Gmail account
    const accs = (await db.execute(sql.raw(
      "SELECT id, email FROM gmail_accounts WHERE status = 'active' ORDER BY id LIMIT 1"
    ))).rows as any[];
    if (!accs.length) { console.error("[SEND] No active Gmail account found"); process.exit(1); }
    const acc = accs[0];
    console.log(`[SEND] Using account: ${acc.email} (id=${acc.id})`);
    const result = await sendEmail(
      acc.id,
      acc.email,
      acc.email,  // send to self
      subject,
      cidHtml,
      [],
      undefined,
      undefined,
      undefined,
      inlineImages,
    );
    console.log("[SEND] Result:", JSON.stringify(result));
    if (result.messageId) {
      console.log(`[SEND] ✅ Sent! messageId=${result.messageId}`);
      console.log(`[SEND] Check Gmail for message with subject: ${subject}`);
    } else {
      console.log("[SEND] ❌ Send failed");
    }
  } else {
    console.log("\n(Set SEND=1 to also fire a live test email to self)");
  }

  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error("[FATAL]", e.message, e.stack);
  process.exit(1);
});
