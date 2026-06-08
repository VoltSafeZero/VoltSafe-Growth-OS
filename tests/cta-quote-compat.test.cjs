"use strict";
/**
 * cta-quote-compat.test.cjs
 *
 * Regression suite for quote-style compatibility in the CTA CID inlining pipeline.
 * Verifies that src="..." and src='...' (double- and single-quoted) are both detected
 * and rewritten, and that absolute hosted CTA URLs survive the full pipeline.
 *
 * Tests are source-grep style (no live network / DB) for speed and CI stability.
 */

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.error(`  ✗ ${name}${detail ? "\n    → " + detail : ""}`);
    failed++;
  }
}

const gmailTs = fs.readFileSync(path.join(__dirname, "../server/gmail.ts"), "utf8");
const routesTs = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");
const resolverTs = fs.readFileSync(path.join(__dirname, "../server/services/cta-asset-resolver.ts"), "utf8");

// ── 1. Source scanners handle both quote styles ───────────────────────────────
console.log("\n── 1. Sig-marker srcRe: quote compatibility ──");

check(
  "Sig-marker srcRe matches single-quoted src attrs",
  gmailTs.includes(`/\\bsrc=["']([^"']+)["']/gi`)
);

check(
  "Legacy fallback srcRe matches single-quoted /assets/cta/ srcs",
  gmailTs.includes(`/\\bsrc=["']([^"']*\\/assets\\/cta\\/[^"']+)["']/gi`)
);

check(
  "resolveCtaImagesInHtml scanner handles single-quoted srcs",
  routesTs.includes(`/<img\\b[^>]*\\bsrc=["']([^"']+)["']/gi`)
);

check(
  "resolveCtaImagesInHtml filename extractor ignores single-quote and hash terminators",
  routesTs.includes(`/\\/assets\\/cta\\/([^/?#\\s"']+)/`)
);

// ── 2. Rewrite loop handles both quote styles ─────────────────────────────────
console.log("\n── 2. Rewrite loop: single-quote split/join ──");

check(
  "data: URI rewrite handles src='...' (single-quote split/join)",
  gmailTs.includes("rewritten.split(`src='${src}'`).join(`src=\"cid:${cidImg.cid}\"`)")
);

check(
  "URL regex rewrite uses quote-agnostic pattern (no double-quote-only replace)",
  // The new pattern matches src="..." OR src='...' — confirmed by the absence of
  // the old capturing-group replace and presence of the new direct replacement.
  gmailTs.includes("bsrc=[\"']${escapedSrc}[\"']") &&
  gmailTs.includes('src="cid:${cidImg.cid}"')
);

check(
  "resolveCtaImagesInHtml rewrite handles single-quoted src (split/join)",
  routesTs.includes("result.split(`src='${src}'`).join(`src=\"${dataUri}\"`)")
);

// ── 3. href strip uses quote-agnostic pattern ─────────────────────────────────
console.log("\n── 3. Href strip: quote compatibility ──");

check(
  "Href strip regex handles both quote styles",
  gmailTs.includes("bhref=[\"']${escapedSrc}[\"']")
);

check(
  "Href strip replacement normalises to href=\"#\" (no capture groups)",
  gmailTs.includes(`href="#"`) && !gmailTs.includes('`$1#$2`')
);

// ── 4. FINAL-CID-GATE: quote-agnostic ────────────────────────────────────────
console.log("\n── 4. FINAL-CID-GATE: single-quote support ──");

check(
  "_extractImgSrcs in FINAL-CID-GATE handles single-quoted src attrs",
  gmailTs.includes(`/<img\\b[^>]*\\bsrc=["']([^"']+)["']/gi`)
);

check(
  "_missingCidRefs checks both src=\"cid:\" and src='cid:' quote styles",
  gmailTs.includes("src='cid:${cid}'")
);

// ── 5. External absolute URL detection is host-agnostic ──────────────────────
console.log("\n── 5. External URL detection: any host ──");

check(
  "_leftoverHostUrls detects any https:// host with /assets/cta/ (not just image-linker)",
  gmailTs.includes("^https?:\\/\\/") || gmailTs.includes("/^https?:\\/\\//i")
);

check(
  "_leftoverHostUrls no longer hardcodes 'image-linker' hostname",
  !gmailTs.includes("_leftoverHostUrls  = _imgSrcsAfter.filter(s => /image-linker/i")
);

check(
  "MIME-PRECHECK _hasCtaUrl simplified to /\\/assets\\/cta\\//.test (no hostname hardcode)",
  routesTs.includes("_hasCtaUrl = /\\/assets\\/cta\\//.test(_cidBody)")
  && !routesTs.includes("image-linker[^\"']")
);

// ── 6. MIME-PRECHECK src extraction handles single quotes ─────────────────────
console.log("\n── 6. MIME-PRECHECK: single-quote extraction ──");

check(
  "MIME-PRECHECK pre-img srcs extraction handles single-quoted attrs",
  routesTs.includes(`/\\bsrc=["']([^"']+)["']/gi`)
);

check(
  "MIME-PRECHECK _cidRefs matches src='cid:...' too",
  routesTs.includes(`/src=["']cid:[^"']+["']/gi`)
);

check(
  "MIME-PRECHECK _hasCidInHtml detects single-quoted cid: refs",
  routesTs.includes(`/src=["']cid:/i`)
);

// ── 7. resolveCtaAsset DB lookup includes public_url basename fallback ─────────
console.log("\n── 7. resolveCtaAsset: public_url basename fallback ──");

check(
  "resolveCtaAsset DB query uses public_url LIKE '%/filename' fallback",
  resolverTs.includes("public_url LIKE '%/${safeFilename}'")
);

check(
  "resolveCtaAsset DB query is OR-combined (filename OR public_url)",
  resolverTs.includes("filename = '${safeFilename}' OR public_url LIKE")
);

// ── 8. Structural integrity ───────────────────────────────────────────────────
console.log("\n── 8. No leftover hardcoded double-quote-only patterns ──");

// The old src="([^"]+)" (double-quote-only) pattern must be gone from all scanning sites.
const oldSigScanPat = 'srcRe = /\\bsrc="([^"]+)"/gi';
check(
  "Sig-marker path no longer has double-quote-only srcRe",
  !gmailTs.includes(oldSigScanPat)
);

const oldLegacyScanPat = 'srcRe = /\\bsrc="([^"]*\\/assets\\/cta\\/[^"]+)"/gi';
check(
  "Legacy fallback path no longer has double-quote-only srcRe",
  !gmailTs.includes(oldLegacyScanPat)
);

const oldGatePat = '/<img\\b[^>]*\\bsrc="([^"]+)"/gi';
check(
  "FINAL-CID-GATE _extractImgSrcs no longer has double-quote-only pattern",
  !gmailTs.includes(oldGatePat)
);

const oldRouteScanPat = '/<img\\b[^>]*\\bsrc="([^"]+)"/gi';
check(
  "resolveCtaImagesInHtml scanner no longer has double-quote-only pattern",
  !routesTs.includes(oldRouteScanPat)
);

// ── Results ───────────────────────────────────────────────────────────────────
console.log(`\n──────────────────────────────────────────────────`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
