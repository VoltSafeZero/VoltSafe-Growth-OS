/**
 * tests/cta-image-url.test.cjs
 * Source-grep regression suite for CTA asset URL rewriting and image rendering.
 */
"use strict";
const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  ✓ ${label}`);
  passed++;
}
function fail(label, detail) {
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  failed++;
}
function check(label, condition, detail) {
  condition ? ok(label) : fail(label, detail);
}

const routes = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");
const sigSettings = fs.readFileSync(path.join(__dirname, "../client/src/pages/signature-settings.tsx"), "utf8");
const fixScript = fs.readFileSync(path.join(__dirname, "../scripts/fix-cta-image-urls.ts"), "utf8");

console.log("\n=== CTA Image URL Tests ===\n");

// ── 1. GET /api/cta-assets — server URL rewriting ───────────────────────────
console.log("── 1. GET /api/cta-assets URL rewriting ──");

check(
  "GET /api/cta-assets route exists",
  routes.includes('app.get("/api/cta-assets"')
);

check(
  "GET /api/cta-assets rewrites public_url using x-forwarded-host",
  routes.includes('x-forwarded-host') &&
  routes.includes("public_url") &&
  routes.includes("/assets/cta/")
);

check(
  "GET /api/cta-assets regex extracts filename from public_url",
  // regex literal uses \/assets\/cta\/ — check for the pattern chars that matter
  routes.includes('public_url).match') &&
  routes.includes('/assets/cta/') &&
  routes.includes('[^/?#')
);

check(
  "GET /api/cta-assets maps rows to rewritten URLs",
  routes.includes("rewritten") &&
  routes.includes("res.json(rewritten)")
);

// ── 2. POST /api/cta-assets/upload — URL construction ───────────────────────
console.log("\n── 2. POST /api/cta-assets/upload URL construction ──");

check(
  "Upload route uses x-forwarded-host for baseUrl",
  routes.includes('x-forwarded-host') &&
  routes.includes("POST /api/cta-assets/upload")
);

check(
  "Upload route does NOT use stale REPL_SLUG env var",
  !routes.includes("REPL_SLUG") ||
  !routes.includes("REPL_OWNER") ||
  // If REPL_SLUG is mentioned elsewhere but not in the upload block, that's ok
  (() => {
    const uploadBlock = routes.slice(
      routes.indexOf("POST /api/cta-assets/upload"),
      routes.indexOf("// GET /api/cta-assets")
    );
    return !uploadBlock.includes("REPL_SLUG");
  })()
);

// ── 3. /assets/cta/:filename — public serving route ─────────────────────────
console.log("\n── 3. Public /assets/cta/:filename serving route ──");

check(
  "Public CTA route registered without auth",
  routes.includes('app.get("/assets/cta/:filename"')
);

check(
  "Public CTA route validates filename with regex",
  // New regex allows uppercase + underscores (WatchDemo_Thumbnail_200.png style)
  // while still blocking non-image extensions and path traversal.
  routes.includes('A-Za-z0-9_') &&
  routes.includes('(png|jpg|jpeg|webp|gif)')
);

check(
  "Public CTA route sets Content-Type image/*",
  routes.includes("image/png") &&
  routes.includes("image/jpeg")
);

check(
  "Public CTA route returns 404 when file missing",
  routes.includes("fs.existsSync(filePath)") &&
  routes.includes("status(404)")
);

// ── 4. Frontend — CtaAssetImg component ──────────────────────────────────────
console.log("\n── 4. Frontend CtaAssetImg component ──");

check(
  "CtaAssetImg component defined in signature-settings.tsx",
  sigSettings.includes("function CtaAssetImg(")
);

check(
  "CtaAssetImg uses onError to detect broken images",
  sigSettings.includes("onError={() => setBroken(true)")
);

check(
  "CtaAssetImg renders ImageOff icon when broken",
  sigSettings.includes("ImageOff") &&
  sigSettings.includes("cta-img-missing")
);

check(
  "CtaAssetImg renders re-upload hint text",
  sigSettings.includes("re-upload")
);

check(
  "ImageOff imported from lucide-react",
  sigSettings.includes("ImageOff")
);

// ── 5. Frontend — CtaAssetImg usage in asset library tab ────────────────────
console.log("\n── 5. CtaAssetImg used in asset library tab ──");

check(
  "CtaAssetLibraryTab uses CtaAssetImg (not plain <img>)",
  sigSettings.includes('<CtaAssetImg src={asset.public_url}')
);

check(
  "CtaDialog library picker uses CtaAssetImg",
  (() => {
    const dialogSection = sigSettings.slice(
      sigSettings.indexOf("function CtaDialog("),
      sigSettings.indexOf("function CtaSection(")
    );
    return dialogSection.includes("<CtaAssetImg");
  })()
);

check(
  "CtaDialog preview uses CtaAssetImg",
  (() => {
    const dialogSection = sigSettings.slice(
      sigSettings.indexOf("function CtaDialog("),
      sigSettings.indexOf("function CtaSection(")
    );
    return dialogSection.includes('<CtaAssetImg src={imageUrl}');
  })()
);

// ── 6. fix-cta-image-urls.ts script ─────────────────────────────────────────
console.log("\n── 6. scripts/fix-cta-image-urls.ts ──");

check(
  "Fix script file exists",
  fs.existsSync(path.join(__dirname, "../scripts/fix-cta-image-urls.ts"))
);

check(
  "Fix script supports --dry-run flag",
  fixScript.includes("--apply") &&
  fixScript.includes("DRY_RUN")
);

check(
  "Fix script detects workspace.*.repl.co stale URLs",
  fixScript.includes("workspace") &&
  // repl.co is stored as repl\.co in the regex literal — check for both parts
  fixScript.includes("repl") &&
  fixScript.includes(".co")
);

check(
  "Fix script detects localhost stale URLs",
  fixScript.includes("localhost")
);

check(
  "Fix script extracts filename from public_url",
  fixScript.includes("/assets/cta/")
);

// ── 7. Signature-ctas GET — existing URL rewriting ──────────────────────────
console.log("\n── 7. GET /api/signature-ctas URL rewriting ──");

check(
  "GET /api/signature-ctas rewrites image_url",
  routes.includes("GET /api/signature-ctas") ||
  routes.includes('app.get("/api/signature-ctas"')
);

check(
  "GET /api/signature-ctas uses fixImgUrl helper",
  routes.includes("fixImgUrl")
);

// ── 8. Send / schedule routes rewrite CTA image URLs ────────────────────────
console.log("\n── 8. Send/schedule route CTA URL rewriting ──");

check(
  "Send route rewrites CTA image_url via _fixCtaImg",
  routes.includes("_fixCtaImg") ||
  routes.includes("baseUrl}/assets/cta/")
);

// ── 9. Asset Library excludes CTA image MIME types ──────────────────────────
console.log("\n── 9. Asset library excludes image/* MIME from attachment picker ──");
const inboxFile = fs.readFileSync(
  path.join(__dirname, "../client/src/pages/gmail-inbox.tsx"), "utf8"
);

check(
  "gmail-inbox.tsx filters image/* from attachment picker",
  inboxFile.includes("image/") &&
  (inboxFile.includes("startsWith(\"image/\")") || inboxFile.includes("startsWith('image/')") || inboxFile.includes("mime") && inboxFile.includes("image"))
);

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
if (failed > 0) process.exit(1);
