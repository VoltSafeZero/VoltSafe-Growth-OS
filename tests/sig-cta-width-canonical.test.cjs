"use strict";
/**
 * sig-cta-width-canonical.test.cjs
 *
 * Asserts that every CTA / signature image generation path in the codebase
 * produces the bulletproof 200px fixed-width pattern described in the task.
 *
 * No network calls — pure source-grep / in-process logic checks.
 */

const fs   = require("fs");
const path = require("path");
const assert = require("assert");

let passed = 0;
let failed = 0;

function ok(label, cond) {
  if (cond) { console.log(`✓ ${label}`); passed++; }
  else       { console.error(`✗ ${label}`); failed++; }
}

// ── helper: read a source file ──────────────────────────────────────────────
function src(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

// ── helper: build the CTA HTML using the canonical service fn ───────────────
function buildCtaHtml(baseHtml, cta, baseUrl) {
  // Inline the same logic as signature-cta-asset.ts (no TS compilation needed
  // for the test — we read the generated output string directly via the module
  // pattern we care about: fixed widths in the source string).
  // The test is source-grep based for compile-independence.
  return null; // unused — we test source strings below
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. CANONICAL SERVICE — server/services/signature-cta-asset.ts
// ═══════════════════════════════════════════════════════════════════════════
const ctaAsset = src("server/services/signature-cta-asset.ts");

ok("service: CTA_IMAGE_WIDTH constant is 200",
  /export const CTA_IMAGE_WIDTH\s*=\s*200/.test(ctaAsset));

ok("service: CTA img width=\"200\"",
  /img\b[^>]*\bwidth="200"/.test(ctaAsset));

ok("service: CTA img style contains width:200px",
  /style="[^"]*width:200px/.test(ctaAsset));

ok("service: CTA img style contains max-width:200px",
  /style="[^"]*max-width:200px/.test(ctaAsset));

ok("service: CTA img style contains min-width:200px",
  /style="[^"]*min-width:200px/.test(ctaAsset));

ok("service: CTA img style does NOT contain max-width:100%",
  !ctaAsset.includes("max-width:100%"));

ok("service: CTA img has border=\"0\"",
  /img\b[^>]*\bborder="0"/.test(ctaAsset));

ok("service: CTA parent td width=\"224\"",
  /td\b[^>]*\bwidth="224"/.test(ctaAsset));

ok("service: CTA parent td style contains min-width:224px",
  /style="[^"]*min-width:224px/.test(ctaAsset));

ok("service: outer table width=\"620\"",
  /table\b[^>]*\bwidth="620"/.test(ctaAsset));

ok("service: outer table contains table-layout:fixed",
  ctaAsset.includes("table-layout:fixed"));

ok("service: left td width=\"396\"",
  /td\b[^>]*\bwidth="396"/.test(ctaAsset));

ok("service: left td style contains max-width:396px",
  /style="[^"]*max-width:396px/.test(ctaAsset));

// ═══════════════════════════════════════════════════════════════════════════
// 2. FRONTEND COMPOSE PREVIEW — client/src/pages/gmail-inbox.tsx
// ═══════════════════════════════════════════════════════════════════════════
const inboxSrc = src("client/src/pages/gmail-inbox.tsx");

// Extract the activeSignatureHtml block (between the two comment markers)
const inboxCtaBlock = inboxSrc.slice(
  inboxSrc.indexOf("// ── New format: CTA stored as separate columns"),
  inboxSrc.indexOf("// ── Legacy format: CTA from email_signature_ctas table") + 500,
);

ok("inbox new-format: CTA img width=\"200\"",
  /img\b[^>]*\bwidth="200"/.test(inboxCtaBlock));

ok("inbox new-format: CTA img style contains width:200px",
  /style="[^"]*width:200px/.test(inboxCtaBlock));

ok("inbox new-format: CTA img style contains max-width:200px",
  /style="[^"]*max-width:200px/.test(inboxCtaBlock));

ok("inbox new-format: CTA img style contains min-width:200px",
  /style="[^"]*min-width:200px/.test(inboxCtaBlock));

ok("inbox new-format: CTA img style does NOT contain max-width:100%",
  !inboxCtaBlock.includes("max-width:100%"));

ok("inbox new-format: outer table contains width=\"620\"",
  /table\b[^>]*\bwidth="620"/.test(inboxCtaBlock));

ok("inbox new-format: outer table contains table-layout:fixed",
  inboxCtaBlock.includes("table-layout:fixed"));

ok("inbox new-format: CTA td width=\"224\"",
  /td\b[^>]*\bwidth="224"/.test(inboxCtaBlock));

ok("inbox new-format: CTA td style contains min-width:224px",
  /style="[^"]*min-width:224px/.test(inboxCtaBlock));

// Legacy CTA path
const legacyCtaBlock = inboxSrc.slice(
  inboxSrc.indexOf("// ── Legacy format: CTA from email_signature_ctas table"),
  inboxSrc.indexOf("// Side-by-side table layout") + 600,
);

ok("inbox legacy: CTA img width=\"200\"",
  /img\b[^>]*\bwidth="200"/.test(legacyCtaBlock));

ok("inbox legacy: outer table contains table-layout:fixed",
  legacyCtaBlock.includes("table-layout:fixed"));

ok("inbox legacy: CTA img does NOT contain max-width:100%",
  !legacyCtaBlock.includes("max-width:100%"));

// ═══════════════════════════════════════════════════════════════════════════
// 3. SIGNATURE SETTINGS — client/src/pages/signature-settings.tsx
// ═══════════════════════════════════════════════════════════════════════════
const sigSettingsSrc = src("client/src/pages/signature-settings.tsx");

ok("sig-settings DEFAULT_CTA_CONFIG widthPx is \"200\"",
  /DEFAULT_CTA_CONFIG[\s\S]{0,200}widthPx:\s*"200"/.test(sigSettingsSrc));

ok("sig-settings ctaWidthPx fallback is 200 (not 180)",
  /ctaWidthPx\s*\?\?\s*200/.test(sigSettingsSrc) &&
  !/ctaWidthPx\s*\?\?\s*180/.test(sigSettingsSrc));

const wrapFn = sigSettingsSrc.slice(
  sigSettingsSrc.indexOf("function wrapHtmlWithCta("),
  sigSettingsSrc.indexOf("// ─── CTA Picker Section"),
);

ok("sig-settings wrapHtmlWithCta: img width=\"200\"",
  /img\b[^>]*\bwidth="200"/.test(wrapFn));

ok("sig-settings wrapHtmlWithCta: img style contains width:200px",
  /style="[^"]*width:200px/.test(wrapFn));

ok("sig-settings wrapHtmlWithCta: img style contains max-width:200px",
  /style="[^"]*max-width:200px/.test(wrapFn));

ok("sig-settings wrapHtmlWithCta: img style contains min-width:200px",
  /style="[^"]*min-width:200px/.test(wrapFn));

ok("sig-settings wrapHtmlWithCta: outer table table-layout:fixed",
  wrapFn.includes("table-layout:fixed"));

ok("sig-settings wrapHtmlWithCta: outer table width=\"620\"",
  /table\b[^>]*\bwidth="620"/.test(wrapFn));

ok("sig-settings wrapHtmlWithCta: CTA td width=\"224\"",
  /td\b[^>]*\bwidth="224"/.test(wrapFn));

ok("sig-settings wrapHtmlWithCta: does NOT use max-width:100%",
  !wrapFn.includes("max-width:100%"));

// ═══════════════════════════════════════════════════════════════════════════
// 4. BACKEND — server/routes.ts (scheduled send + immediate send legacy paths)
// ═══════════════════════════════════════════════════════════════════════════
const routesSrc = src("server/routes.ts");

// Find both legacy CTA map blocks (one for scheduled, one for immediate send)
// by anchoring on unique surrounding code
const schedIdx = routesSrc.indexOf("_fixScImg = (url: string)");
const immIdx   = routesSrc.indexOf("_fixCtaImg = (url: string)");
assert(schedIdx !== -1, "could not find scheduled-send legacy block");
assert(immIdx   !== -1, "could not find immediate-send legacy block");

const schedBlock = routesSrc.slice(schedIdx, schedIdx + 2000);
const immBlock   = routesSrc.slice(immIdx, immIdx + 2000);

ok("routes scheduled-send legacy: img width=\"200\"",
  /img\b[^>]*\bwidth="200"/.test(schedBlock));

ok("routes scheduled-send legacy: img style contains width:200px",
  /style="[^"]*width:200px/.test(schedBlock));

ok("routes scheduled-send legacy: img style contains max-width:200px",
  /style="[^"]*max-width:200px/.test(schedBlock));

ok("routes scheduled-send legacy: img style contains min-width:200px",
  /style="[^"]*min-width:200px/.test(schedBlock));

ok("routes scheduled-send legacy: outer table table-layout:fixed",
  schedBlock.includes("table-layout:fixed"));

ok("routes scheduled-send legacy: outer table width=\"620\"",
  /table\b[^>]*\bwidth="620"/.test(schedBlock));

ok("routes scheduled-send legacy: CTA td width=\"224\"",
  /td\b[^>]*\bwidth="224"/.test(schedBlock));

ok("routes scheduled-send legacy: does NOT use max-width:100%",
  !schedBlock.includes("max-width:100%"));

ok("routes immediate-send legacy: img width=\"200\"",
  /img\b[^>]*\bwidth="200"/.test(immBlock));

ok("routes immediate-send legacy: img style contains width:200px",
  /style="[^"]*width:200px/.test(immBlock));

ok("routes immediate-send legacy: img style contains max-width:200px",
  /style="[^"]*max-width:200px/.test(immBlock));

ok("routes immediate-send legacy: img style contains min-width:200px",
  /style="[^"]*min-width:200px/.test(immBlock));

ok("routes immediate-send legacy: outer table table-layout:fixed",
  immBlock.includes("table-layout:fixed"));

ok("routes immediate-send legacy: outer table width=\"620\"",
  /table\b[^>]*\bwidth="620"/.test(immBlock));

ok("routes immediate-send legacy: CTA td width=\"224\"",
  /td\b[^>]*\bwidth="224"/.test(immBlock));

ok("routes immediate-send legacy: does NOT use max-width:100%",
  !immBlock.includes("max-width:100%"));

// ═══════════════════════════════════════════════════════════════════════════
// 5. VOLTASAFE LOGO IMG — in DB html_content (we test what is stored in DB)
//    For source tests we verify the sig builder produces the right logo pattern.
//    The actual DB row was fixed by migration — tested via query in a separate
//    script; here we verify the PATTERN we expect is in our source strings.
// ═══════════════════════════════════════════════════════════════════════════

// Ensure no source file still generates a logo with max-width:100%
// (besides help-center which uses a markdown-to-html transformer — excluded)
const allSources = [
  "server/services/signature-cta-asset.ts",
  "server/routes.ts",
  "client/src/pages/gmail-inbox.tsx",
  "client/src/pages/signature-settings.tsx",
].map(f => src(f)).join("\n");

ok("no remaining max-width:100% in any CTA/sig generation source",
  !/(wrapHtmlWithCta|vs-sig|ctaCell|ctaLink|ctaHtml|ctaBlock|_sh\b|_ctaHtmlBlock)[\s\S]{0,300}max-width:100%/.test(allSources));

// ═══════════════════════════════════════════════════════════════════════════
// 6. CID REWRITE — only replaces src, does not rebuild the img tag
// ═══════════════════════════════════════════════════════════════════════════
const cidRewriteBlock = inboxSrc.slice(
  inboxSrc.indexOf("// 1. Resolve cid: references BEFORE DOMPurify"),
  inboxSrc.indexOf("// 1. Resolve cid: references BEFORE DOMPurify") + 500,
);

ok("CID rewrite only replaces src= attribute (not whole img tag)",
  /replace\(.*cid:/.test(cidRewriteBlock) &&
  !/img\s+src=/.test(cidRewriteBlock));

// ═══════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${passed + failed} checks: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  console.error(`\n❌ ${failed} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\n✅ All CTA canonical-width checks passed.");
}
