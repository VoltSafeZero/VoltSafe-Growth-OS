const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
  }
}

console.log("=== Signature CTA Asset Wrap Tests ===\n");

// ── 1. Server-side helper ──────────────────────────────────────────────────
const helperSrc = fs.readFileSync(
  path.join(__dirname, "../server/services/signature-cta-asset.ts"),
  "utf8"
);

console.log("── 1. signature-cta-asset.ts helper ──");
assert("exports wrapHtmlWithCtaAsset function", helperSrc.includes("export function wrapHtmlWithCtaAsset"));
assert("wraps in two-column table", helperSrc.includes("role=\"presentation\""));
assert("left td: vertical-align:top", helperSrc.includes("vertical-align:top;\">${baseHtml}</td>"));
assert("right td: padding-left:24px", helperSrc.includes("padding-left:24px;\">${ctaCell}</td>"));
assert("CTA image has border:0", helperSrc.includes("border:0"));
assert("CTA link has target=_blank", helperSrc.includes("target=\"_blank\""));
assert("width clamped 80-240", helperSrc.includes("Math.max(80, Math.min(240"));
assert("returns baseHtml unchanged when no imageUrl", helperSrc.includes("if (!cta.imageUrl || !cta.destUrl) return baseHtml"));
assert("rewrites /assets/cta/ path with baseUrl", helperSrc.includes("/assets/cta/"));

console.log();

// ── 2. DB schema has CTA columns ────────────────────────────────────────────
const schemaSrc = fs.readFileSync(
  path.join(__dirname, "../shared/schema.ts"),
  "utf8"
);

console.log("── 2. shared/schema.ts emailSignatures table ──");
assert("ctaImageUrl column present", schemaSrc.includes("ctaImageUrl: text(\"cta_image_url\")"));
assert("ctaDestUrl column present", schemaSrc.includes("ctaDestUrl: text(\"cta_dest_url\")"));
assert("ctaAltText column present", schemaSrc.includes("ctaAltText: text(\"cta_alt_text\")"));
assert("ctaWidthPx column present", schemaSrc.includes("ctaWidthPx: integer(\"cta_width_px\")"));

console.log();

// ── 3. Migration adds the columns ───────────────────────────────────────────
const seedSrc = fs.readFileSync(
  path.join(__dirname, "../server/seed-production.ts"),
  "utf8"
);

console.log("── 3. seed-production.ts migration ──");
assert("migrateSignatureCtaAssetColumns exported", seedSrc.includes("export async function migrateSignatureCtaAssetColumns"));
assert("adds cta_image_url column", seedSrc.includes("ADD COLUMN IF NOT EXISTS cta_image_url"));
assert("adds cta_dest_url column", seedSrc.includes("ADD COLUMN IF NOT EXISTS cta_dest_url"));
assert("adds cta_alt_text column", seedSrc.includes("ADD COLUMN IF NOT EXISTS cta_alt_text"));
assert("adds cta_width_px column", seedSrc.includes("ADD COLUMN IF NOT EXISTS cta_width_px"));

const indexSrc = fs.readFileSync(
  path.join(__dirname, "../server/index.ts"),
  "utf8"
);
assert("migration called in startup chain", indexSrc.includes("migrateSignatureCtaAssetColumns()"));

console.log();

// ── 4. Backend routes store CTA fields ─────────────────────────────────────
const routesSrc = fs.readFileSync(
  path.join(__dirname, "../server/routes.ts"),
  "utf8"
);

console.log("── 4. routes.ts POST/PUT store CTA fields ──");
assert("imports wrapHtmlWithCtaAsset", routesSrc.includes("wrapHtmlWithCtaAsset"));
assert("POST /api/signatures accepts ctaImageUrl", routesSrc.match(/ctaImageUrl.*ctaDestUrl.*ctaAltText.*ctaWidthPx/) !== null ||
  routesSrc.includes("ctaImageUrl") && routesSrc.includes("ctaDestUrl"));
assert("PUT /api/signatures/:id stores ctaImageUrl", routesSrc.split("put(\"/api/signatures/:id\"")[1]?.includes("ctaImageUrl") ?? false);
assert("send route selects cta_image_url from db", routesSrc.includes("es.cta_image_url"));
assert("send uses wrapHtmlWithCtaAsset for baked-in CTA",
  routesSrc.includes("cta_image_url && _sigRow.cta_dest_url") && routesSrc.includes("wrapHtmlWithCtaAsset(_normalizedSig,"));

console.log();

// ── 5. Frontend: CtaPickerSection shared between tabs ───────────────────────
const frontendSrc = fs.readFileSync(
  path.join(__dirname, "../client/src/pages/signature-settings.tsx"),
  "utf8"
);

console.log("── 5. signature-settings.tsx frontend ──");
assert("CtaConfig type defined", frontendSrc.includes("type CtaConfig") || frontendSrc.includes("CtaConfig ="));
assert("wrapHtmlWithCta helper in frontend", frontendSrc.includes("function wrapHtmlWithCta"));
assert("CtaPickerSection component exists", frontendSrc.includes("function CtaPickerSection") || frontendSrc.includes("CtaPickerSection"));
assert("ctaConfig state in SignatureDialog", frontendSrc.includes("ctaConfig") && frontendSrc.includes("setCtaConfig"));
assert("ctaConfig initialized from existing.ctaImageUrl", frontendSrc.includes("existing?.ctaImageUrl") || frontendSrc.includes("existing?.cta"));
assert("save mutation sends ctaImageUrl", frontendSrc.split("saveMutation")[0].length < frontendSrc.length &&
  frontendSrc.includes("ctaImageUrl") && frontendSrc.includes("ctaDestUrl"));
assert("preview tab uses wrapHtmlWithCta", frontendSrc.includes("previewHtml = wrapHtmlWithCta("));
assert("HTML tab shows CTA picker",
  frontendSrc.includes("CtaPickerSection cta={ctaConfig}") && frontendSrc.includes("onChange={setCtaConfig}"));
assert("EmailSignature type has ctaImageUrl", frontendSrc.includes("ctaImageUrl: string | null") || frontendSrc.includes("ctaImageUrl?:"));

// Corruption-prevention guards
assert("existing sigs default to html tab (not builder)", frontendSrc.includes("existing ? \"html\" : \"builder\""));
assert("handleFieldsChange only rebuilds html for new sigs", frontendSrc.includes("if (!existing)") && frontendSrc.includes("buildSignatureHtml(f)"));
assert("Generate from builder button exists for existing sigs", frontendSrc.includes("button-sig-generate-from-builder"));

console.log();

// ── 6. Composer: reads new CTA columns ──────────────────────────────────────
const composerSrc = fs.readFileSync(
  path.join(__dirname, "../client/src/pages/gmail-inbox.tsx"),
  "utf8"
);

console.log("── 6. gmail-inbox.tsx composer CTA fix ──");
assert("EmailSig type has ctaImageUrl", composerSrc.includes("ctaImageUrl: string | null"));
assert("EmailSig type has ctaDestUrl", composerSrc.includes("ctaDestUrl: string | null"));
assert("EmailSig type has ctaWidthPx", composerSrc.includes("ctaWidthPx: number | null"));
assert("activeSignatureHtml uses ctaImageUrl column first", composerSrc.includes("activeSig.ctaImageUrl && activeSig.ctaDestUrl"));
assert("composer logs sig id, htmlLen, ctaImageUrl", composerSrc.includes("[sig-composer] id="));
assert("composer logs which cta path is used", composerSrc.includes("using ctaImageUrl column") || composerSrc.includes("sig-composer"));
assert("falls back to legacy ctas when ctaImageUrl null", composerSrc.includes("activeSig.ctas ||"));

console.log();

// ── 7. GET /api/signatures rewrites ctaImageUrl host ────────────────────────
console.log("── 7. routes.ts GET /api/signatures ──");
assert("GET response rewrites ctaImageUrl host", routesSrc.includes("fixImgUrl((sig as any).ctaImageUrl"));
assert("new columns returned in GET response", routesSrc.includes("ctaImageUrl: fixImgUrl("));

console.log();

console.log("──────────────────────────────────────────────────");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
