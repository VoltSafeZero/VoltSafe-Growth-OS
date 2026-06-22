/**
 * knowledge-asset-svg.test.cjs
 *
 * Source-grep tests for Task #37: stored SVG XSS in knowledge asset uploads.
 *
 * Checks:
 *   1. image/svg+xml removed from ALLOWED_ASSET_MIME_TYPES
 *   2. assetUpload fileFilter uses explicit allowlist only (no startsWith wildcard)
 *   3. ACTIVE_CONTENT_MIME_TYPES blocklist defined with SVG + HTML + JS
 *   4. sendAssetFile forces attachment + application/octet-stream for active content
 *   5. X-Content-Type-Options: nosniff added to every asset file response
 */
"use strict";
const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function bad(label, reason) { console.log(`  ✗ ${label} — ${reason}`); failed++; }

const src = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");

// ── 1. SVG removed from upload allowlist ──────────────────────────────────
console.log("\n── 1. SVG removed from ALLOWED_ASSET_MIME_TYPES ──");

// Find the ALLOWED_ASSET_MIME_TYPES block by offset
const allowedStart = src.indexOf("ALLOWED_ASSET_MIME_TYPES = new Set");
const allowedEnd = src.indexOf(");", allowedStart) + 2;
const allowedBlock = allowedStart > 0 ? src.slice(allowedStart, allowedEnd) : "";

if (allowedBlock)
  ok("ALLOWED_ASSET_MIME_TYPES set defined");
else
  bad("ALLOWED_ASSET_MIME_TYPES", "Set definition not found");

if (!/image\/svg\+xml/.test(allowedBlock))
  ok("image/svg+xml is NOT in ALLOWED_ASSET_MIME_TYPES");
else
  bad("SVG in allowlist", "image/svg+xml must be removed from ALLOWED_ASSET_MIME_TYPES");

if (/image\/jpeg/.test(allowedBlock) && /image\/png/.test(allowedBlock))
  ok("Standard image types (jpeg, png) remain in allowlist");
else
  bad("Standard images", "image/jpeg or image/png missing from allowlist");

// ── 2. fileFilter uses explicit allowlist only ────────────────────────────
console.log("\n── 2. assetUpload fileFilter — explicit allowlist, no wildcard ──");

// Find the assetUpload multer block
const assetUploadStart = src.indexOf("const assetUpload = multer");
const assetUploadEnd = src.indexOf("});", assetUploadStart) + 3;
const filterBlock = assetUploadStart > 0 ? src.slice(assetUploadStart, assetUploadEnd) : "";

if (/ALLOWED_ASSET_MIME_TYPES\.has\(file\.mimetype\)/.test(filterBlock))
  ok("fileFilter uses ALLOWED_ASSET_MIME_TYPES.has() check");
else
  bad("fileFilter allowlist check", "ALLOWED_ASSET_MIME_TYPES.has() not found in filter");

if (!/startsWith\("image\/"/.test(filterBlock) && !/startsWith\('image\/'/.test(filterBlock))
  ok("fileFilter does NOT use startsWith('image/') wildcard");
else
  bad("fileFilter wildcard removed", "startsWith('image/') wildcard must be removed");

// ── 3. ACTIVE_CONTENT_MIME_TYPES blocklist ────────────────────────────────
console.log("\n── 3. ACTIVE_CONTENT_MIME_TYPES blocklist defined ──");

const activeStart = src.indexOf("ACTIVE_CONTENT_MIME_TYPES = new Set");
const activeEnd = src.indexOf(");", activeStart) + 2;
const activeBlock = activeStart > 0 ? src.slice(activeStart, activeEnd) : "";

if (activeBlock)
  ok("ACTIVE_CONTENT_MIME_TYPES Set defined");
else
  bad("ACTIVE_CONTENT_MIME_TYPES", "Set definition not found");

if (/image\/svg\+xml/.test(activeBlock))
  ok("ACTIVE_CONTENT_MIME_TYPES includes image/svg+xml");
else
  bad("SVG in blocklist", "image/svg+xml not found in ACTIVE_CONTENT_MIME_TYPES");

if (/text\/html/.test(activeBlock))
  ok("ACTIVE_CONTENT_MIME_TYPES includes text/html");
else
  bad("html in blocklist", "text/html not found in ACTIVE_CONTENT_MIME_TYPES");

if (/application\/javascript|text\/javascript/.test(activeBlock))
  ok("ACTIVE_CONTENT_MIME_TYPES includes javascript types");
else
  bad("js in blocklist", "javascript MIME not found in ACTIVE_CONTENT_MIME_TYPES");

// ── 4. sendAssetFile forces safe disposition + MIME for active content ─────
console.log("\n── 4. sendAssetFile forces attachment for active-content types ──");

const sendFnStart = src.indexOf("function sendAssetFile(");
const sendFnEnd = src.indexOf("\n  }", sendFnStart) + 4;
const sendFnBlock = sendFnStart > 0 ? src.slice(sendFnStart, sendFnEnd) : "";

if (sendFnBlock)
  ok("sendAssetFile function found");
else
  bad("sendAssetFile", "function not found");

if (/isActiveContent/.test(sendFnBlock))
  ok("sendAssetFile computes isActiveContent flag");
else
  bad("isActiveContent flag", "isActiveContent variable not found in sendAssetFile");

if (/ACTIVE_CONTENT_MIME_TYPES/.test(sendFnBlock))
  ok("sendAssetFile references ACTIVE_CONTENT_MIME_TYPES blocklist");
else
  bad("blocklist reference", "ACTIVE_CONTENT_MIME_TYPES not used inside sendAssetFile");

if (/safeDisposition/.test(sendFnBlock) || /isActiveContent.*attachment/.test(sendFnBlock))
  ok("sendAssetFile uses safeDisposition to force 'attachment' for active content");
else
  bad("forced attachment", "safeDisposition or 'attachment' override not found");

if (/application\/octet-stream/.test(sendFnBlock))
  ok("sendAssetFile overrides Content-Type to application/octet-stream for active content");
else
  bad("octet-stream override", "application/octet-stream not found in sendAssetFile");

// ── 5. X-Content-Type-Options: nosniff ────────────────────────────────────
console.log("\n── 5. X-Content-Type-Options: nosniff header added ──");

if (/X-Content-Type-Options/.test(sendFnBlock) && /nosniff/.test(sendFnBlock))
  ok("sendAssetFile sets X-Content-Type-Options: nosniff");
else
  bad("nosniff header", "X-Content-Type-Options: nosniff not set in sendAssetFile");

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
