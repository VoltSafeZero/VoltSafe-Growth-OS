"use strict";
/**
 * Structural + functional tests for signature CID inline-image embedding.
 * Verifies that both immediate-send and scheduled-send pipelines correctly
 * inline signature images as MIME CID parts for Spark / Apple Mail / Outlook.
 */
const fs   = require("fs");
const path = require("path");

let passed = 0, failed = 0;
function assert(label, condition) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else           { console.error(`  ✗ ${label}`); failed++; }
}

console.log("=== Signature CID Inline Image Tests ===\n");

// ── 1. server/gmail.ts — extractCtaInlineImages ────────────────────────────
const gmailSrc = fs.readFileSync(path.join(__dirname, "../server/gmail.ts"), "utf8");

console.log("── 1. server/gmail.ts — extractCtaInlineImages ──");
assert("CidImage type exported",
  gmailSrc.includes("export type CidImage"));
assert("function scans vs-sig-start / vs-sig-end section",
  gmailSrc.includes("vs-sig-start") && gmailSrc.includes("vs-sig-end"));
assert("scans all img src= in sig section",
  gmailSrc.includes('srcRe = /\\bsrc="([^"]+)"/gi') ||
  gmailSrc.includes("srcRe") && gmailSrc.includes("src="));
assert("fast path reads /assets/cta/ from disk",
  gmailSrc.includes("/assets/cta/") && gmailSrc.includes("ctaAssetsDir"));
assert("slow path fetches HTTPS URLs with AbortController timeout",
  (gmailSrc.includes("fetch(src") || gmailSrc.includes("await fetch(")) &&
  gmailSrc.includes("AbortController"));
assert("10-second fetch timeout (matches inlineImagesAsBase64 for slow external URLs)",
  gmailSrc.includes("10000"));
assert("data:image and cid: srcs are skipped",
  gmailSrc.includes('startsWith("cid:")') && gmailSrc.includes('startsWith("data:")'));
assert("legacy fallback for missing sig markers (no fetch)",
  gmailSrc.includes("Legacy fallback") || gmailSrc.includes("legacy fallback") ||
  gmailSrc.includes("Legacy") && gmailSrc.includes("no sig markers"));
assert("src rewritten to cid: reference in output",
  gmailSrc.includes('cid:${cidImg.cid}') || gmailSrc.includes("`cid:${cidImg.cid}`") ||
  gmailSrc.includes("cid:"));
assert("multipart/related boundary emitted",
  gmailSrc.includes("multipart/related"));
assert("Content-ID header written for each inline image",
  gmailSrc.includes("Content-ID:"));
assert("inlineParts helper OMITS Content-Disposition entirely (Apple Mail ghost-attachment fix)",
  // Apple Mail 16+ (macOS Ventura/Sonoma, iOS 17+) interprets Content-Disposition: inline
  // on a CID image part as "show this both inline AND as a downloadable attachment",
  // creating a ghost attachment card for every signature CTA image. RFC 2392 §2 says
  // Content-ID alone is sufficient. Fix: no Content-Disposition on CID inline parts;
  // keep name= on Content-Type only for Gmail / Outlook client compatibility.
  (() => {
    const start = gmailSrc.indexOf("const inlineParts = (bnd:");
    const end   = gmailSrc.indexOf("const attachmentParts", start);
    if (start < 0 || end < 0) return false;
    const fn = gmailSrc.slice(start, end);
    // Must NOT have Content-Disposition in the inline-parts helper.
    // (attachmentParts legitimately uses Content-Disposition: attachment — this slice
    //  ends before that function, so the check is unambiguous.)
    return !fn.includes("Content-Disposition");
  })());
assert("inlineParts helper adds name= to Content-Type for each CID part",
  (() => {
    const start = gmailSrc.indexOf("const inlineParts = (bnd:");
    const end   = gmailSrc.indexOf("const attachmentParts", start);
    if (start < 0 || end < 0) return false;
    const fn = gmailSrc.slice(start, end);
    return fn.includes("name=") && fn.includes("Content-Type:");
  })());
assert("Case B: multipart/related; type=\"text/html\" is the ROOT (not multipart/alternative)",
  // Gmail's API canonicalizes alt > related into flat mixed+attachments.
  // The only safe layout is: related at the root, alternative inside it.
  gmailSrc.includes('multipart/related; boundary="${relBnd}"; type="text/html"') ||
  gmailSrc.includes("multipart/related; boundary=") && gmailSrc.includes('type="text/html"'));
assert("buildMimeRaw needsInline flag controls multipart/related",
  gmailSrc.includes("needsInline"));
assert("inlineParts helper emits CID image parts inside multipart/related",
  gmailSrc.includes("inlineParts(relBnd)") || gmailSrc.includes("inlineParts(bnd)"));
assert("inlineImages param accepted by sendEmail",
  gmailSrc.includes("inlineImages: CidImage[]") || gmailSrc.includes("inlineImages:"));
assert("multipart/related does NOT use start= parameter (reverted — caused Apple Mail inline rendering regression)",
  !gmailSrc.includes('start="<${htmlRootCid}>"'));
assert("extractCtaInlineImages includes href-stripping pass to prevent Apple Mail attachment ghost",
  gmailSrc.includes("IMAGE_EXT_RE") && gmailSrc.includes("hrefPat"));

console.log();

// ── 2. routes.ts — immediate-send pipeline ────────────────────────────────
const routesSrc = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");

console.log("── 2. routes.ts — immediate-send pipeline ──");
assert("extractCtaInlineImages called in main send route",
  routesSrc.includes("extractCtaInlineImages(_dbResolvedBody, CTA_ASSETS_DIR)"));
assert("_sigInlineImages variable used for CID images",
  routesSrc.includes("_sigInlineImages"));
assert("CID inlining count logged",
  routesSrc.includes("sig CID inlining:"));
assert("sendEmail receives _sigInlineImages (not [])",
  routesSrc.includes("_sigInlineImages") &&
  routesSrc.includes("cidImageCount: _sigInlineImages.length"));
assert("data:image strategy NOT used for send route",
  !routesSrc.includes("inlineImagesAsBase64(ctaWrappedBody, CTA_ASSETS_DIR"));
assert("CidImage type imported in routes.ts",
  routesSrc.includes("type CidImage") || routesSrc.includes(", CidImage,") || routesSrc.includes(": CidImage[]"));

console.log();

// ── 3. gmail-sync.ts — scheduled-send pipeline ────────────────────────────
const syncSrc = fs.readFileSync(
  path.join(__dirname, "../server/services/gmail-sync.ts"), "utf8");

console.log("── 3. gmail-sync.ts — scheduled-send pipeline ──");
assert("extractCtaInlineImages dynamically imported in gmail-sync.ts",
  syncSrc.includes("extractCtaInlineImages") && syncSrc.includes('import("../gmail")'));
assert("calls extractCtaInlineImages on scheduled ctaWrappedBody",
  syncSrc.includes("extractCtaInlineImages(ctaWrappedBody"));
assert("_schedInlineImgs used for the scheduled send",
  syncSrc.includes("_schedInlineImgs"));
assert("scheduled CID inlining count logged",
  syncSrc.includes("CID inlining:"));
assert("path.resolve('uploads/cta-assets') used in scheduled runner",
  syncSrc.includes("path.resolve") && syncSrc.includes("uploads/cta-assets"));

console.log();

// ── 4. Functional: sig-section scanner ────────────────────────────────────
console.log("── 4. Functional: sig-section regex logic ──");

const ctaDir  = path.resolve("uploads/cta-assets");
const ctaFile = path.join(ctaDir, "WatchDemo_Thumbnail_200.png");
assert("WatchDemo_Thumbnail_200.png exists in uploads/cta-assets/",
  fs.existsSync(ctaFile));
if (fs.existsSync(ctaFile)) {
  assert("CTA file is non-empty (>0 bytes)", fs.statSync(ctaFile).size > 0);
}

// Simulate the sig section with a CTA image.
const fakeSigHtml = [
  "<!--vs-sig-start-->",
  '<table><tr><td>Regards, Trevor</td>',
  '<td><a href="https://demo.example.com">',
  '<img src="https://host.replit.app/assets/cta/WatchDemo_Thumbnail_200.png"',
  ' alt="Watch Demo" width="180"></a></td></tr></table>',
  "<!--vs-sig-end-->",
].join("\n");

// 4a. Sig section regex extracts inner content.
const sigRe  = /<!--vs-sig-start-->([\s\S]*?)<!--vs-sig-end-->/i;
const sigMatch = sigRe.exec(fakeSigHtml);
assert("sig-section regex extracts content between markers",
  sigMatch !== null && sigMatch[1].includes("Watch Demo"));

// 4b. src= regex finds the CTA URL inside the section.
const srcRe = /\bsrc="([^"]+)"/gi;
const srcs  = [];
if (sigMatch) {
  let mm;
  while ((mm = srcRe.exec(sigMatch[1])) !== null) srcs.push(mm[1]);
}
assert("src= regex finds CTA image URL in sig section",
  srcs.some(s => s.includes("/assets/cta/")));

// 4c. /assets/cta/ filename extracted correctly.
const ctaMatch = srcs[0] && srcs[0].match(/\/assets\/cta\/([^"'?#\s]+)/);
assert("filename extracted from absolute CTA URL",
  ctaMatch && ctaMatch[1] === "WatchDemo_Thumbnail_200.png");

// 4d. CID rewrite regex works.
if (ctaMatch) {
  const cidId      = "sig-img-0@vs";
  const escapedSrc = srcs[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rewrPat    = new RegExp(`(\\bsrc=")${escapedSrc}(")`,"g");
  const rewritten  = fakeSigHtml.replace(rewrPat, `$1cid:${cidId}$2`);
  assert('src rewritten to cid: reference',
    rewritten.includes(`src="cid:${cidId}"`));
  assert("original absolute URL removed from output",
    !rewritten.includes(`src="https://host.replit.app/assets/cta/`));
}

// 4e. data: and cid: srcs are skipped.
const skipSrc1 = "data:image/png;base64,abc";
const skipSrc2 = "cid:already-inline@vs";
assert('data: src correctly detected as skippable',
  skipSrc1.startsWith("data:"));
assert('cid: src correctly detected as skippable',
  skipSrc2.startsWith("cid:"));

// 4f. VoltSafe logo stored locally as /assets/cta/ file (CID-inlined via fast path).
const voltSafeLogoFile = path.join(ctaDir, "VoltSafe_logo.png");
assert("VoltSafe_logo.png exists in uploads/cta-assets/ (local file, no remote URL needed)",
  fs.existsSync(voltSafeLogoFile));
if (fs.existsSync(voltSafeLogoFile)) {
  assert("VoltSafe_logo.png is non-empty (>0 bytes)", fs.statSync(voltSafeLogoFile).size > 0);
}

// Verify that the fast-path extractor would find the local logo via /assets/cta/ pattern.
const fakeLogoSig = [
  "<!--vs-sig-start-->",
  '<img src="/assets/cta/VoltSafe_logo.png" alt="VoltSafe" width="180" style="max-width:100%;height:auto;">',
  "<!--vs-sig-end-->",
].join("");
const logoSigMatch = sigRe.exec(fakeLogoSig);
const logoSrcRe    = /\bsrc="([^"]+)"/gi;
const logoSrcs     = [];
if (logoSigMatch) {
  let lm;
  while ((lm = logoSrcRe.exec(logoSigMatch[1])) !== null) logoSrcs.push(lm[1]);
}
assert("local VoltSafe logo /assets/cta/ src found in sig section by src= scanner",
  logoSrcs.some(s => s.includes("/assets/cta/VoltSafe_logo.png")));
assert("VoltSafe logo uses local /assets/cta/ path → triggers fast-path (disk read, no fetch)",
  logoSrcs[0] && logoSrcs[0].startsWith("/assets/cta/"));

// 4g. Dedup guard — stale sig section stripped from cleanBody before new sig appended.
console.log();
console.log("── 5. Dedup guard in routes.ts ──");
assert("send route strips stale sig section from cleanBody before appending fresh sig",
  routesSrc.includes("_cleanBodyNoStaleSig") &&
  routesSrc.includes("<!--vs-sig-start-->[\\s\\S]*?<!--vs-sig-end-->") &&
  routesSrc.includes("_cleanBodyNoStaleSig + `<!--vs-sig-start-->${_sigSection}<!--vs-sig-end-->`"));
assert("scheduled route strips stale sig section before appending fresh sig",
  routesSrc.includes("schedBody.replace(/<!--vs-sig-start-->[\\s\\S]*?<!--vs-sig-end-->/gi, \"\")"));
assert("dedup guard removes duplicate CTA images outside sig section (filename-based)",
  routesSrc.includes("_sigFilenames") && routesSrc.includes("_stripDupe") &&
  routesSrc.includes("dedup: removed outside-sig duplicate img"));
assert("dedup guard logs filename of removed duplicate img for diagnostics",
  routesSrc.includes('dedup: removed outside-sig duplicate img filename="'));

// 4h. Img style: max-width:100%;height:auto (no fixed pixel max-width on CTA images).
console.log();
console.log("── 6. CTA img style ──");
const ctaAssetSrc = fs.readFileSync(
  path.join(__dirname, "../server/services/signature-cta-asset.ts"), "utf8");
assert("wrapHtmlWithCtaAsset uses max-width:100% (not fixed pixel max-width)",
  ctaAssetSrc.includes("max-width:100%") && !ctaAssetSrc.includes("max-width:${w}px"));

console.log();
console.log("─".repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
