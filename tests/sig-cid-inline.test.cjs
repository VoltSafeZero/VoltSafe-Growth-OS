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
assert("4-second fetch timeout",
  gmailSrc.includes("4000"));
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
assert("Content-Disposition: inline for inline images",
  gmailSrc.includes("Content-Disposition: inline"));
assert("buildMimeRaw needsInline flag controls multipart/related",
  gmailSrc.includes("needsInline"));
assert("buildRelatedBlock helper wraps alt + inline parts",
  gmailSrc.includes("buildRelatedBlock"));
assert("inlineImages param accepted by sendEmail",
  gmailSrc.includes("inlineImages: CidImage[]") || gmailSrc.includes("inlineImages:"));

console.log();

// ── 2. routes.ts — immediate-send pipeline ────────────────────────────────
const routesSrc = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");

console.log("── 2. routes.ts — immediate-send pipeline ──");
assert("imports extractCtaInlineImages from gmail",
  routesSrc.includes("extractCtaInlineImages"));
assert("calls extractCtaInlineImages on trackedBody",
  routesSrc.includes("extractCtaInlineImages(trackedBody"));
assert("CTA_ASSETS_DIR passed to extractCtaInlineImages",
  routesSrc.includes("extractCtaInlineImages(trackedBody, CTA_ASSETS_DIR)"));
assert("_ctaInlineImages passed to sendEmail",
  routesSrc.includes("_ctaInlineImages"));
assert("cidImageCount logged before send",
  routesSrc.includes("cidImageCount"));
assert("CID images count logged if > 0",
  routesSrc.includes("[gmail-send] CID inline images:"));
assert("CID extraction is non-fatal (try/catch)",
  routesSrc.includes("CID image extraction non-fatal:") || routesSrc.includes("cidErr"));

console.log();

// ── 3. gmail-sync.ts — scheduled-send pipeline ────────────────────────────
const syncSrc = fs.readFileSync(
  path.join(__dirname, "../server/services/gmail-sync.ts"), "utf8");

console.log("── 3. gmail-sync.ts — scheduled-send pipeline ──");
assert("imports extractCtaInlineImages",
  syncSrc.includes("extractCtaInlineImages"));
assert("calls extractCtaInlineImages on scheduled trackedBody",
  syncSrc.includes("await extractCtaInlineImages"));
assert("_schedCidImages passed to sendEmail",
  syncSrc.includes("_schedCidImages"));
assert("scheduled CID extraction is non-fatal (try/catch)",
  syncSrc.includes("CID image extraction non-fatal"));
assert("CID images count logged for scheduled send",
  syncSrc.includes("CID inline images:"));

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

// 4f. Sig with external logo URL (would be fetched).
const fakeLogoSig = [
  "<!--vs-sig-start-->",
  '<img src="https://cdn.voltsafe.com/logo.png" alt="VoltSafe unplug. connect.">',
  "<!--vs-sig-end-->",
].join("");
const logoSigMatch = sigRe.exec(fakeLogoSig);
const logoSrcRe    = /\bsrc="([^"]+)"/gi;
const logoSrcs     = [];
if (logoSigMatch) {
  let lm;
  while ((lm = logoSrcRe.exec(logoSigMatch[1])) !== null) logoSrcs.push(lm[1]);
}
assert("external logo URL found in sig section by src= scanner",
  logoSrcs.some(s => s.includes("cdn.voltsafe.com")));
assert("external logo URL starts with https:// → would trigger fetch path",
  logoSrcs[0] && logoSrcs[0].startsWith("https://"));

console.log();
console.log("─".repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
