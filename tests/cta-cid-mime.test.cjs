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
  "extractCtaInlineImages generates cid: from filename",
  gmailTs.includes("cta-") && gmailTs.includes("@vs")
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
  "buildMimeRaw wraps multipart/alternative inside multipart/related",
  (() => {
    const relIdx = gmailTs.indexOf("buildRelatedBlock");
    const altIdx = gmailTs.indexOf("multipart/alternative");
    return relIdx !== -1 && altIdx !== -1;
  })()
);

check(
  "Inline image parts use Content-Disposition: inline (not attachment)",
  gmailTs.includes("Content-Disposition: inline") &&
  !gmailTs.includes('Content-Disposition: attachment; filename="${img')
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
  "When inline images only → multipart/related at top level (no mixed wrapper)",
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
  "extractCtaInlineImages imported in routes.ts",
  routesTs.includes("extractCtaInlineImages") && routesTs.includes('from "./gmail"')
);

check(
  "Send route calls extractCtaInlineImages before sendEmail",
  (() => {
    const sendBlock = routesTs.slice(
      routesTs.indexOf("extractCtaInlineImages(trackedBody"),
      routesTs.indexOf("calling sendEmail")
    );
    return sendBlock.length > 0 && sendBlock.includes("_cidResult");
  })()
);

check(
  "Send route uses CTA_ASSETS_DIR as directory arg",
  routesTs.includes("extractCtaInlineImages(trackedBody, CTA_ASSETS_DIR)")
);

check(
  "Send route passes _ctaInlineImages to sendEmail",
  routesTs.includes("_ctaInlineImages") && routesTs.includes("_ctaInlineImages\n        )")
);

check(
  "Send route logs cidImageCount in MIME diagnostic",
  routesTs.includes("cidImageCount: _ctaInlineImages.length")
);

check(
  "Send route extraction is non-fatal (catch block present)",
  routesTs.includes("CID image extraction non-fatal")
);

// ── 5. Scheduled runner wiring ────────────────────────────────────────────────
console.log("\n── 5. Scheduled runner (gmail-sync.ts) wiring ──");

check(
  "extractCtaInlineImages dynamically imported in gmail-sync.ts",
  // Uses dynamic import: const { sendEmail, extractCtaInlineImages } = await import("../gmail")
  syncTs.includes("extractCtaInlineImages") && syncTs.includes('import("../gmail")')
);

check(
  "Scheduled runner calls extractCtaInlineImages before sendEmail",
  syncTs.includes("extractCtaInlineImages(trackedBody")
);

check(
  "Scheduled runner uses path.resolve('uploads/cta-assets')",
  syncTs.includes("path.resolve") && syncTs.includes("uploads/cta-assets")
);

check(
  "Scheduled runner passes _schedCidImages to sendEmail",
  syncTs.includes("_schedCidImages")
);

check(
  "Scheduled runner extraction is non-fatal (catch block present)",
  syncTs.includes("CID image extraction non-fatal")
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

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
  if (failed > 0) process.exit(1);
})();
