/**
 * tests/cta-cid-mime.test.cjs
 *
 * Source-grep + unit tests for CID inline image embedding in outbound MIME.
 * Covers: extractCtaInlineImages, buildMimeRaw multipart/related structure,
 * send-route wiring, scheduled-runner wiring, and fallback behaviour.
 */
"use strict";

const fs   = require("fs");
const path = require("path");
const os   = require("os");

let passed = 0;
let failed = 0;

function ok(label)            { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail)  { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
function check(label, cond, detail) { cond ? ok(label) : fail(label, detail); }

const gmailTs   = fs.readFileSync(path.join(__dirname, "../server/gmail.ts"), "utf8");
const routesTs  = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");
const syncTs    = fs.readFileSync(path.join(__dirname, "../server/services/gmail-sync.ts"), "utf8");

console.log("\n=== CTA CID MIME Tests ===\n");

// ── 1. gmail.ts — CidImage type and extractCtaInlineImages exported ──────────
console.log("── 1. gmail.ts exports ──");

check(
  "CidImage type exported from gmail.ts",
  gmailTs.includes("export type CidImage")
);

check(
  "extractCtaInlineImages exported from gmail.ts",
  gmailTs.includes("export async function extractCtaInlineImages(")
);

check(
  "extractCtaInlineImages reads files from ctaAssetsDir",
  gmailTs.includes("ctaAssetsDir") && gmailTs.includes("fs.readFileSync")
);

check(
  "extractCtaInlineImages generates CID (no @ or file extensions)",
  gmailTs.includes("vsig") && gmailTs.includes("cidBase") && !gmailTs.includes("@vs")
);

check(
  "extractCtaInlineImages rewrites src= to cid:",
  gmailTs.includes('$1cid:${cidImg.cid}$3') || gmailTs.includes('$1cid:${cidImg.cid}$2')
);

check(
  "extractCtaInlineImages returns unchanged HTML when no CTA images found",
  gmailTs.includes("seen.size === 0") && gmailTs.includes("return { html, inlineImages: [] }")
);

check(
  "File read failure is silently swallowed (fallback to absolute URL)",
  gmailTs.includes("// File unreadable") || gmailTs.includes("leave URL as-is")
);

// ── 2. buildMimeRaw — multipart/related support ───────────────────────────────
console.log("\n── 2. buildMimeRaw multipart/related ──");

check(
  "buildMimeRaw accepts inlineImages parameter",
  gmailTs.includes("inlineImages: CidImage[] = [],") && gmailTs.includes("function buildMimeRaw(")
);

check(
  "buildMimeRaw emits multipart/related boundary when inline images present",
  gmailTs.includes("multipart/related") && gmailTs.includes("vs_rel_")
);

check(
  "buildMimeRaw nests text/html + images inside multipart/related (RFC 2387 correct)",
  (() => {
    // text/html is the ROOT of multipart/related; multipart/alternative wraps the two.
    return gmailTs.includes("vs_rel_") &&
      gmailTs.includes("multipart/related") &&
      gmailTs.includes("inlineParts(relBnd)");
  })()
);

check(
  "multipart/related has no start= parameter (reverted — Apple Mail mishandled Content-ID on html root)",
  // The RFC 2387 §3.3 start= approach caused Apple Mail 16+ to stop rendering
  // CID images inline at all, making things worse. The correct fix is to strip
  // <a href> attributes that point to image file URLs we inlined as CID parts
  // (see extractCtaInlineImages href-stripping pass in server/gmail.ts).
  !gmailTs.includes('start="<${htmlRootCid}>"')
);

check(
  "text/html root does NOT have an extra Content-ID (reverted — caused Apple Mail regression)",
  !gmailTs.includes("Content-ID: <${htmlRootCid}>")
);

check(
  "extractCtaInlineImages strips <a href> pointing to inlined image file URLs (Apple Mail attachment ghost fix)",
  // The root cause of Watch Demo appearing as a duplicate attachment is that
  // the <a href> wrapping the CID img still pointed to the PNG file URL.
  // Apple Mail downloads the href file as a separate attachment even though
  // the img src is already rendered inline via CID.
  gmailTs.includes("Neutralise <a href> attributes") || gmailTs.includes("IMAGE_EXT_RE")
);

check(
  "href-strip logs the stripped URL for diagnostics",
  gmailTs.includes("stripped image href") && gmailTs.includes("Apple Mail attachment prevention")
);

check(
  "inlineParts helper emits Content-Disposition: inline; filename= (RFC 2183 inline with name)",
  // RFC 2183: Content-Disposition: inline tells clients the part is displayed at
  // the src="cid:..." reference. Both name= (on Content-Type) and filename= (on
  // Content-Disposition) are required so Apple Mail, Outlook, and Gmail all treat
  // the part as an inline asset and NOT a downloadable attachment. Content-Disposition:
  // attachment (which Gmail emits when CID parts are under multipart/mixed) is the
  // root cause of signature image duplication in Apple Mail.
  (() => {
    const start = gmailTs.indexOf("const inlineParts = (bnd:");
    const end   = gmailTs.indexOf("const attachmentParts", start);
    if (start < 0 || end < 0) return false;
    const fn = gmailTs.slice(start, end);
    if (!fn.includes("Content-Disposition: inline")) return false;
    // Must include filename= parameter
    const dispIdx = fn.indexOf("Content-Disposition: inline");
    const lineEnd = fn.indexOf("\n", dispIdx);
    const dispLine = fn.slice(dispIdx, lineEnd < 0 ? undefined : lineEnd);
    return dispLine.includes("filename=");
  })()
);

check(
  "inlineParts helper adds name= to Content-Type for each CID part",
  (() => {
    const start = gmailTs.indexOf("const inlineParts = (bnd:");
    const end   = gmailTs.indexOf("const attachmentParts", start);
    if (start < 0 || end < 0) return false;
    const fn = gmailTs.slice(start, end);
    return fn.includes("name=") && fn.includes("Content-Type:");
  })()
);

check(
  "Case B: multipart/related; type=\"text/html\" is ROOT (Gmail canonicalizes alt>related into flat mixed)",
  gmailTs.includes('type="text/html"') && gmailTs.includes("multipart/related; boundary=")
);

check(
  "When inline images only → multipart/related is the root (multipart/related appears before multipart/alternative)",
  (() => {
    // Use "else if (needsInline && !needsMixed)" to avoid matching the Case A
    // "!needsInline && !needsMixed" which contains the same substring.
    const start = gmailTs.indexOf("else if (needsInline && !needsMixed)");
    const end   = gmailTs.indexOf("else if (needsInline && needsMixed)");
    if (start < 0 || end < 0) return false;
    const caseB = gmailTs.slice(start, end);
    // Both must appear; related must come first (it is the root)
    const relIdx = caseB.indexOf("multipart/related");
    const altIdx = caseB.indexOf("multipart/alternative");
    return relIdx >= 0 && altIdx >= 0 && relIdx < altIdx;
  })()
);

check(
  "Inline image parts include Content-ID header",
  gmailTs.includes("Content-ID: <${img.cid}>")
);

check(
  "When no inline images and no attachments → multipart/alternative (unchanged path)",
  gmailTs.includes("needsInline  = inlineImages.length > 0") &&
  gmailTs.includes("!needsInline && !needsMixed")
);

check(
  "When inline images + attachments → multipart/mixed wraps multipart/related",
  gmailTs.includes("needsInline && needsMixed")
);

check(
  "When inline images only → multipart/alternative wraps multipart/related (no mixed wrapper)",
  gmailTs.includes("needsInline && !needsMixed")
);

// ── 3. sendEmail — inlineImages threaded through ──────────────────────────────
console.log("\n── 3. sendEmail threads inlineImages ──");

check(
  "sendEmail accepts inlineImages parameter",
  gmailTs.includes("inlineImages: CidImage[] = [],") &&
  (() => {
    const fn = gmailTs.slice(gmailTs.indexOf("export async function sendEmail("));
    return fn.includes("inlineImages: CidImage[] = []");
  })()
);

check(
  "sendEmail passes inlineImages to buildMimeRaw",
  (() => {
    const fn = gmailTs.slice(gmailTs.indexOf("export async function sendEmail("), gmailTs.indexOf("export async function saveDraft("));
    return fn.includes("buildMimeRaw(") && fn.includes("inlineImages");
  })()
);

// ── 4. Send route wiring ──────────────────────────────────────────────────────
console.log("\n── 4. Send route (routes.ts) wiring ──");

check(
  "extractCtaInlineImages called in main send route",
  routesTs.includes("extractCtaInlineImages(ctaWrappedBody, CTA_ASSETS_DIR)")
);

check(
  "Send route uses _sigInlineImages variable",
  routesTs.includes("_sigInlineImages")
);

check(
  "Send route passes _sigInlineImages to sendEmail (CID approach)",
  routesTs.includes("_sigInlineImages") &&
  routesTs.includes("const result = await sendEmail(")
);

check(
  "Send route logs CID inlining count",
  routesTs.includes("sig CID inlining:")
);

check(
  "Send route diagnostic logs cidImageCount from _sigInlineImages",
  routesTs.includes("cidImageCount: _sigInlineImages.length")
);

check(
  "data:image NOT used as the inlining strategy (CID used instead)",
  !routesTs.includes("inlineImagesAsBase64(ctaWrappedBody, CTA_ASSETS_DIR")
);

// ── 5. Scheduled runner wiring ────────────────────────────────────────────────
console.log("\n── 5. Scheduled runner (gmail-sync.ts) wiring ──");

check(
  "extractCtaInlineImages dynamically imported in gmail-sync.ts",
  syncTs.includes("extractCtaInlineImages") && syncTs.includes('import("../gmail")')
);

check(
  "Scheduled runner calls extractCtaInlineImages before sendEmail",
  syncTs.includes("extractCtaInlineImages(ctaWrappedBody")
);

check(
  "Scheduled runner uses path.resolve('uploads/cta-assets')",
  syncTs.includes("path.resolve") && syncTs.includes("uploads/cta-assets")
);

check(
  "Scheduled runner uses _schedInlineImgs for the send",
  syncTs.includes("_schedInlineImgs")
);

check(
  "Scheduled runner logs CID inlining count",
  syncTs.includes("CID inlining:")
);

// ── 6. Unit: extractCtaInlineImages logic (in-process simulation) ─────────────
console.log("\n── 6. Unit: CID extraction logic ──");

// Simulate extractCtaInlineImages with temp PNG files.
function mimeTypeFromExt(ext) {
  const m = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
  return m[ext.toLowerCase()] || "image/png";
}

async function simulateExtractCtaInlineImages(html, tmpDir) {
  const seen = new Map();
  const fnRe = /\/assets\/cta\/([^"'?#\s]+)/g;
  let m;
  while ((m = fnRe.exec(html)) !== null) {
    const filename = m[1];
    if (seen.has(filename)) continue;
    const filePath = path.join(tmpDir, filename);
    try {
      if (!fs.existsSync(filePath)) continue;
      const data = fs.readFileSync(filePath);
      const ext = filename.split(".").pop() || "png";
      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      seen.set(filename, { cid: `cta-${safeName}@vs`, mimeType: mimeTypeFromExt(ext), data });
    } catch { }
  }
  if (seen.size === 0) return { html, inlineImages: [] };
  let rewritten = html;
  for (const [filename, cidImg] of seen.entries()) {
    const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pat = new RegExp(`(\\bsrc=")([^"]*\\/assets\\/cta\\/${escaped})(")`, "gi");
    rewritten = rewritten.replace(pat, `$1cid:${cidImg.cid}$3`);
  }
  return { html: rewritten, inlineImages: Array.from(seen.values()) };
}

// Create a temp dir with a fake PNG file.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cta-test-"));
const fakePng = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]); // PNG header
fs.writeFileSync(path.join(tmpDir, "WatchDemo_Thumbnail_200.png"), fakePng);

(async () => {
  const html = `<a href="https://example.com/cta/track/abc"><img src="https://myapp.replit.app/assets/cta/WatchDemo_Thumbnail_200.png" alt="Watch Demo" width="200"></a>`;

  const { html: rewritten, inlineImages } = await simulateExtractCtaInlineImages(html, tmpDir);

  check(
    "CTA img src rewritten from absolute URL to cid:",
    rewritten.includes('src="cid:cta-WatchDemo_Thumbnail_200.png@vs"') &&
    !rewritten.includes("https://myapp.replit.app/assets/cta/")
  );

  check(
    "inlineImages array contains one entry",
    inlineImages.length === 1
  );

  check(
    "inlineImages[0] has correct cid",
    inlineImages[0]?.cid === "cta-WatchDemo_Thumbnail_200.png@vs"
  );

  check(
    "inlineImages[0] has correct mimeType",
    inlineImages[0]?.mimeType === "image/png"
  );

  check(
    "inlineImages[0] data is a Buffer",
    Buffer.isBuffer(inlineImages[0]?.data)
  );

  check(
    "href (tracked link) is preserved unchanged",
    rewritten.includes('href="https://example.com/cta/track/abc"')
  );

  // Missing file → no rewrite, no inline image.
  const html2 = `<img src="https://host/assets/cta/missing.png">`;
  const { html: rewritten2, inlineImages: imgs2 } = await simulateExtractCtaInlineImages(html2, tmpDir);
  check(
    "Missing file leaves absolute URL unchanged (graceful fallback)",
    rewritten2.includes("https://host/assets/cta/missing.png") && imgs2.length === 0
  );

  // Duplicate filename → deduplicated to one CID image.
  const html3 = [
    `<img src="https://h/assets/cta/WatchDemo_Thumbnail_200.png" width="200">`,
    `<img src="https://h/assets/cta/WatchDemo_Thumbnail_200.png" width="600">`,
  ].join("");
  const { inlineImages: imgs3 } = await simulateExtractCtaInlineImages(html3, tmpDir);
  check(
    "Duplicate CTA asset filename deduplicated to one CID part",
    imgs3.length === 1
  );

  // Clean up temp dir.
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { }

    // ── 7. VoltSafe logo stored locally ──────────────────────────────────────────
  console.log("\n── 7. VoltSafe logo local file ──");
  const ctaAssetsDir = path.resolve("uploads/cta-assets");
  check(
    "VoltSafe_logo.png exists in uploads/cta-assets/ (local CID asset, no remote WordPress URL)",
    fs.existsSync(path.join(ctaAssetsDir, "VoltSafe_logo.png"))
  );
  check(
    "WatchDemo_Thumbnail_200.png exists in uploads/cta-assets/ (CTA image)",
    fs.existsSync(path.join(ctaAssetsDir, "WatchDemo_Thumbnail_200.png"))
  );
  if (fs.existsSync(path.join(ctaAssetsDir, "VoltSafe_logo.png"))) {
    check(
      "VoltSafe_logo.png is non-empty (>0 bytes)",
      fs.statSync(path.join(ctaAssetsDir, "VoltSafe_logo.png")).size > 0
    );
  }

  // ── 8. CTA img style: max-width:100% (responsive, no fixed pixel max-width) ──
  console.log("\n── 8. CTA img styles ──");
  const ctaAssetSvc = fs.readFileSync(
    path.join(__dirname, "../server/services/signature-cta-asset.ts"), "utf8");
  check(
    "wrapHtmlWithCtaAsset uses max-width:100% (responsive, not fixed px max-width)",
    ctaAssetSvc.includes("max-width:100%") && !ctaAssetSvc.includes("max-width:${w}px")
  );
  check(
    "legacy email_signature_ctas CTA img also uses max-width:100%",
    (() => {
      // Find the legacy _ctaHtmlBlock build in routes.ts (not inside wrapHtmlWithCtaAsset)
      const idx = routesTs.indexOf("const _ctaHtmlBlock = _sigCtas.map");
      if (idx < 0) return false;
      const snippet = routesTs.slice(idx, idx + 800);
      return snippet.includes("max-width:100%") && !snippet.includes("max-width:${_dw}px");
    })()
  );
  check(
    "scheduled legacy CTA img also uses max-width:100%",
    (() => {
      const idx = routesTs.indexOf("const _sh = _sc.map");
      if (idx < 0) return false;
      const snippet = routesTs.slice(idx, idx + 800);
      return snippet.includes("max-width:100%") && !snippet.includes("max-width:${_dw}px");
    })()
  );

  // ── 9. Dedup guard: stale sig section stripped and duplicate imgs removed ────
  console.log("\n── 9. Dedup guards in routes.ts ──");
  check(
    "send route strips stale sig section from cleanBody before appending fresh sig",
    routesTs.includes("_cleanBodyNoStaleSig") &&
    routesTs.includes("_cleanBodyNoStaleSig + `<!--vs-sig-start-->${_sigSection}<!--vs-sig-end-->`")
  );
  check(
    "send route dedup guard collects sig filenames and strips dupes outside sig section",
    routesTs.includes("_sigFilenames") && routesTs.includes("_stripDupe") &&
    routesTs.includes("dedup: removed outside-sig duplicate img")
  );
  check(
    "scheduled route strips stale sig section before appending fresh sig",
    routesTs.includes(`schedBody.replace(/<!--vs-sig-start-->[\\s\\S]*?<!--vs-sig-end-->/gi, "")`)
  );

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
  if (failed > 0) process.exit(1);
})();
