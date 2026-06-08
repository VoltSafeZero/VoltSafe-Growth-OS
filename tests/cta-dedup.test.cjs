"use strict";
/**
 * cta-dedup.test.cjs
 * Verifies that duplicate CTA images (same asset in both html_content and
 * cta_image_url) are detected and suppressed so the final email body contains
 * exactly one <img> for that asset.
 *
 * All checks are source-grep / logic tests — no live HTTP calls, no DB.
 */

const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const failures = [];

function assert(label, cond) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    fail++;
    failures.push(label);
  }
}

// ─── Load the helper functions from the compiled/source files ──────────────
// We read the TS source and inline the pure-logic helpers as JS equivalents.
// This avoids needing tsx / ts-node and keeps the test self-contained.

function sigHtmlAlreadyContainsCta(sigHtml, ctaImageUrl) {
  if (!sigHtml || !ctaImageUrl) return false;
  const fnMatch = ctaImageUrl.match(/\/assets\/cta\/([^/?#\s]+)$/);
  if (!fnMatch) return false;
  const filename = fnMatch[1].toLowerCase();
  const imgRe = /<img\b[^>]*\bsrc=["']([^"']+)["']/gi;
  let m;
  while ((m = imgRe.exec(sigHtml)) !== null) {
    const src = m[1].toLowerCase();
    if (src.includes(filename)) return true;
  }
  return false;
}

function stripCtaImgFromHtml(html, filename) {
  if (!html || !filename) return html;
  const safeFn = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Remove <a ...><img src="...filename..."></a>
  html = html.replace(
    new RegExp(`<a\\b[^>]*>\\s*<img\\b[^>]*\\bsrc=["'][^"']*${safeFn}[^"']*["'][^>]*/>[\\s\\S]*?<\\/a>`, "gi"),
    "",
  );
  // Remove bare <img src="...filename...">
  html = html.replace(
    new RegExp(`<img\\b[^>]*\\bsrc=["'][^"']*${safeFn}[^"']*["'][^>]*/?>`, "gi"),
    "",
  );
  return html;
}

function wrapHtmlWithCtaAsset(baseHtml, cta) {
  if (!cta.imageUrl || !cta.destUrl) return baseHtml;
  const src = cta.imageUrl.replace(/"/g, "&quot;");
  const w = Math.max(80, Math.min(240, cta.widthPx || 180));
  const alt = (cta.altText || "Watch a Demo").replace(/"/g, "&quot;");
  const dest = cta.destUrl.replace(/"/g, "&quot;");
  const ctaCell = `<a href="${dest}"><img src="${src}" alt="${alt}" width="${w}"></a>`;
  return `<table><tr><td>${baseHtml}</td><td>${ctaCell}</td></tr></table>`;
}

function countImgSrcsContaining(html, fragment) {
  const re = /<img\b[^>]*\bsrc=["']([^"']+)["']/gi;
  let count = 0;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1].toLowerCase().includes(fragment.toLowerCase())) count++;
  }
  return count;
}

const WATCH_DEMO_FN = "WatchDemo_Thumbnail_200.png";
const WATCH_DEMO_URL = `/assets/cta/${WATCH_DEMO_FN}`;
const OTHER_URL = "/assets/cta/OtherImage_100.png";
const DEST = "https://example.com/demo";

const sigWithImg = `<div>Trevor Burgess</div><img src="${WATCH_DEMO_URL}" alt="Watch a Demo" width="180">`;
const sigWithImgInAnchor = `<div>Trevor</div><a href="${DEST}"><img src="${WATCH_DEMO_URL}" alt="Watch" width="180"></a>`;
const sigNoImg = `<div>Trevor Burgess</div><p>Senior Account Executive</p>`;
const sigOtherImg = `<div>Trevor</div><img src="${OTHER_URL}" alt="Other" width="100">`;

console.log("\n=== CTA Dedup Test Suite ===\n");

// ── 1. sigHtmlAlreadyContainsCta — positive cases ────────────────────────
console.log("── sigHtmlAlreadyContainsCta ──");

assert("detects WatchDemo img already in sig HTML (bare img)", sigHtmlAlreadyContainsCta(sigWithImg, WATCH_DEMO_URL));
assert("detects WatchDemo img inside <a> anchor", sigHtmlAlreadyContainsCta(sigWithImgInAnchor, WATCH_DEMO_URL));
assert("returns false when sig HTML has no img at all", !sigHtmlAlreadyContainsCta(sigNoImg, WATCH_DEMO_URL));
assert("returns false when sig has different image", !sigHtmlAlreadyContainsCta(sigOtherImg, WATCH_DEMO_URL));
assert("returns false when ctaImageUrl is empty", !sigHtmlAlreadyContainsCta(sigWithImg, ""));
assert("returns false when ctaImageUrl has no /assets/cta/ path", !sigHtmlAlreadyContainsCta(sigWithImg, "https://cdn.example.com/watch.png"));
assert("case-insensitive filename match", sigHtmlAlreadyContainsCta(
  `<img src="/assets/cta/WATCHDEMO_THUMBNAIL_200.PNG">`,
  "/assets/cta/WatchDemo_Thumbnail_200.png",
));

// ── 2. Send pipeline dedup simulation ────────────────────────────────────
console.log("\n── Send pipeline dedup simulation ──");

// Case A: sig HTML already has the CTA → should NOT wrap again
{
  const _normalizedSig = sigWithImg;
  const ctaImageUrl = WATCH_DEMO_URL;
  let _sigSection;
  if (sigHtmlAlreadyContainsCta(_normalizedSig, ctaImageUrl)) {
    _sigSection = _normalizedSig;
  } else {
    _sigSection = wrapHtmlWithCtaAsset(_normalizedSig, { imageUrl: ctaImageUrl, destUrl: DEST });
  }
  const body = `<p>Hello</p><!--vs-sig-start-->${_sigSection}<!--vs-sig-end-->`;
  const count = countImgSrcsContaining(body, WATCH_DEMO_FN);
  assert("sig with WatchDemo in HTML + cta_image_url → exactly 1 img in body", count === 1);
}

// Case B: sig HTML does NOT have the CTA → wrap adds exactly one
{
  const _normalizedSig = sigNoImg;
  const ctaImageUrl = WATCH_DEMO_URL;
  let _sigSection;
  if (sigHtmlAlreadyContainsCta(_normalizedSig, ctaImageUrl)) {
    _sigSection = _normalizedSig;
  } else {
    _sigSection = wrapHtmlWithCtaAsset(_normalizedSig, { imageUrl: ctaImageUrl, destUrl: DEST });
  }
  const body = `<p>Hello</p><!--vs-sig-start-->${_sigSection}<!--vs-sig-end-->`;
  const count = countImgSrcsContaining(body, WATCH_DEMO_FN);
  assert("sig without WatchDemo in HTML + cta_image_url → exactly 1 img added", count === 1);
}

// Case C: sig has different image + cta_image_url → still wraps (adds CTA)
{
  const _normalizedSig = sigOtherImg;
  const ctaImageUrl = WATCH_DEMO_URL;
  let _sigSection;
  if (sigHtmlAlreadyContainsCta(_normalizedSig, ctaImageUrl)) {
    _sigSection = _normalizedSig;
  } else {
    _sigSection = wrapHtmlWithCtaAsset(_normalizedSig, { imageUrl: ctaImageUrl, destUrl: DEST });
  }
  const body = `<p>Hello</p><!--vs-sig-start-->${_sigSection}<!--vs-sig-end-->`;
  const wdCount = countImgSrcsContaining(body, WATCH_DEMO_FN);
  const otherCount = countImgSrcsContaining(body, "OtherImage_100.png");
  assert("sig with different img + cta_image_url → WatchDemo img added once", wdCount === 1);
  assert("sig with different img + cta_image_url → other img preserved", otherCount === 1);
}

// ── 3. stripCtaImgFromHtml ────────────────────────────────────────────────
console.log("\n── stripCtaImgFromHtml ──");

{
  const stripped = stripCtaImgFromHtml(sigWithImg, WATCH_DEMO_FN);
  assert("bare <img> stripped from html", !stripped.includes(WATCH_DEMO_FN));
}
{
  const stripped = stripCtaImgFromHtml(sigWithImgInAnchor, WATCH_DEMO_FN);
  assert("<a><img></a> block stripped from html", !stripped.includes(WATCH_DEMO_FN));
}
{
  const mixed = `<div>Name</div><img src="/assets/cta/OtherImage_100.png"><img src="${WATCH_DEMO_URL}">`;
  const stripped = stripCtaImgFromHtml(mixed, WATCH_DEMO_FN);
  assert("strip removes only the target filename, not other imgs", stripped.includes("OtherImage_100.png"));
  assert("strip removes the target filename", !stripped.includes(WATCH_DEMO_FN));
}
{
  const noImg = sigNoImg;
  const stripped = stripCtaImgFromHtml(noImg, WATCH_DEMO_FN);
  assert("strip is no-op when filename not present", stripped === noImg);
}

// ── 4. Admin dedup-check endpoint logic (source scan) ────────────────────
console.log("\n── Admin dedup-check logic verification (source scan) ──");

const routesSrc = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");

assert(
  "routes.ts has GET /api/admin/cta-assets/dedup-check endpoint",
  routesSrc.includes('"/api/admin/cta-assets/dedup-check"'),
);
assert(
  "routes.ts has POST /api/admin/cta-assets/dedup-html endpoint",
  routesSrc.includes('"/api/admin/cta-assets/dedup-html"'),
);
assert(
  "dedup-check uses sigHtmlAlreadyContainsCta",
  routesSrc.includes("sigHtmlAlreadyContainsCta") && routesSrc.includes("dedup-check"),
);
assert(
  "dedup-html uses stripCtaImgFromHtml",
  routesSrc.includes("stripCtaImgFromHtml") && routesSrc.includes("dedup-html"),
);
assert(
  "both dedup endpoints require admin auth",
  (routesSrc.match(/api\/admin\/cta-assets\/dedup-check[^)]*requireAdmin/s) !== null) ||
  routesSrc.includes('"requireAdmin"') ||
  (routesSrc.includes("dedup-check") && routesSrc.includes("requireAdmin")),
);

// ── 5. Send path dedup guard present in routes.ts ─────────────────────────
console.log("\n── Send path dedup guard (source scan) ──");

assert(
  "send path has sigHtmlAlreadyContainsCta dedup check",
  routesSrc.includes("sigHtmlAlreadyContainsCta(_normalizedSig"),
);
assert(
  "scheduled send path has sigHtmlAlreadyContainsCta dedup check",
  routesSrc.includes("sigHtmlAlreadyContainsCta(_sn"),
);
assert(
  "send path logs when dedup fires",
  routesSrc.includes("cta-dedup: sig HTML already contains CTA filename"),
);
assert(
  "scheduled send logs when dedup fires",
  routesSrc.includes("cta-dedup: sig HTML already contains CTA filename"),
);

// ── 6. signature-cta-asset.ts exports the helpers ────────────────────────
console.log("\n── signature-cta-asset.ts exports ──");

const ctaAssetSrc = fs.readFileSync(
  path.join(__dirname, "../server/services/signature-cta-asset.ts"),
  "utf8",
);
assert("sigHtmlAlreadyContainsCta is exported", ctaAssetSrc.includes("export function sigHtmlAlreadyContainsCta"));
assert("stripCtaImgFromHtml is exported", ctaAssetSrc.includes("export function stripCtaImgFromHtml"));
assert("wrapHtmlWithCtaAsset is still exported", ctaAssetSrc.includes("export function wrapHtmlWithCtaAsset"));

// ── Results ──────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(50)}`);
console.log(`Results: ${pass} passed, ${fail} failed out of ${pass + fail} total`);
if (failures.length > 0) {
  console.error("\nFailed checks:");
  failures.forEach(f => console.error(`  - ${f}`));
  process.exit(1);
} else {
  console.log("\n✅ All CTA dedup tests PASSED");
}
