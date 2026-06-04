/**
 * tests/cta-asset-system.test.js
 *
 * Source-grep + structural tests for the CTA Asset Upload + Insert System.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

let passed = 0;
let failed = 0;

function check(desc, condition) {
  if (condition) {
    console.log(`  ✓ ${desc}`);
    passed++;
  } else {
    console.error(`  ✗ ${desc}`);
    failed++;
  }
}

function read(relPath) {
  return fs.readFileSync(path.resolve(root, relPath), "utf-8");
}

console.log("\n── 1. data-vs-cta-id preservation (sanitizers) ────────────────────────");
{
  const normSrc = read("server/services/email-html-normalizer.ts");
  const fmtSrc  = read("client/src/lib/email-format.ts");

  check(
    "email-html-normalizer.ts excludes data-vs-cta-id from stripping regex",
    normSrc.includes("data-(?!vs-cta-id=)"),
  );
  check(
    "email-format.ts excludes data-vs-cta-id from stripping regex",
    fmtSrc.includes("data-(?!vs-cta-id=)"),
  );
  check(
    "normalizer preserves HTML comments (required for sig markers)",
    !normSrc.includes("removeComments") && !normSrc.includes("<!--") === false,
  );
}

console.log("\n── 2. signature-cta-tracker body CTA processing ────────────────────────");
{
  const trackerSrc = read("server/services/signature-cta-tracker.ts");

  check(
    "wrapSignatureCtaLinks function is exported",
    trackerSrc.includes("export async function wrapSignatureCtaLinks"),
  );
  check(
    "tracker looks for data-vs-cta-id in body",
    trackerSrc.includes("data-vs-cta-id"),
  );
  check(
    "tracker processes body CTAs with dedicated regex",
    trackerSrc.includes("bodyCTARe") || trackerSrc.includes("bodyCta"),
  );
  check(
    "tracker inserts signature_cta_clicks rows for body CTAs",
    trackerSrc.includes("INSERT INTO signature_cta_clicks"),
  );
  check(
    "tracker handles sig-section CTAs (step 1) and body CTAs (step 2)",
    trackerSrc.includes("// ── 1.") && trackerSrc.includes("// ── 2."),
  );
  check(
    "isSafeCtaUrl is exported",
    trackerSrc.includes("export function isSafeCtaUrl"),
  );
  check(
    "updateSignatureCtaMessageIds is exported",
    trackerSrc.includes("export async function updateSignatureCtaMessageIds"),
  );
  check(
    "recordSignatureCtaClick is exported",
    trackerSrc.includes("export async function recordSignatureCtaClick"),
  );
}

console.log("\n── 3. DB migration for cta_assets ──────────────────────────────────────");
{
  const migPath = "migrations/0011_cta_assets.sql";
  check("migration file exists", fs.existsSync(path.resolve(root, migPath)));
  if (fs.existsSync(path.resolve(root, migPath))) {
    const migSrc = read(migPath);
    check("migration creates cta_assets table", migSrc.includes("CREATE TABLE IF NOT EXISTS cta_assets"));
    check("migration adds asset_id FK to email_signature_ctas", migSrc.includes("ADD COLUMN IF NOT EXISTS asset_id"));
    check("migration includes public_url column", migSrc.includes("public_url"));
    check("migration includes is_archived column", migSrc.includes("is_archived"));
  }
}

console.log("\n── 4. Route registrations in routes.ts ─────────────────────────────────");
{
  const routesSrc = read("server/routes.ts");

  check(
    "ctaUpload multer instance is defined",
    routesSrc.includes("const ctaUpload = multer("),
  );
  check(
    "CTA_ASSETS_DIR constant is defined",
    routesSrc.includes("const CTA_ASSETS_DIR"),
  );
  check(
    'public /assets/cta/:filename route registered (no auth)',
    routesSrc.includes('app.get("/assets/cta/:filename"'),
  );
  check(
    "POST /api/cta-assets/upload route registered",
    routesSrc.includes('app.post("/api/cta-assets/upload"'),
  );
  check(
    "GET /api/cta-assets route registered",
    routesSrc.includes('app.get("/api/cta-assets"'),
  );
  check(
    "PUT /api/cta-assets/:id route registered",
    routesSrc.includes('app.put("/api/cta-assets/:id"'),
  );
  check(
    "DELETE /api/cta-assets/:id route registered",
    routesSrc.includes('app.delete("/api/cta-assets/:id"'),
  );
  check(
    "public CTA file route validates UUID filename pattern",
    routesSrc.includes("[0-9a-f-]+"),
  );
  check(
    "public CTA file route sets immutable cache header",
    routesSrc.includes("immutable"),
  );
  check(
    "?forPicker=true supported in GET /api/signature-ctas",
    routesSrc.includes("forPicker"),
  );
  check(
    "delete route archives (soft delete) — does not destroy file",
    routesSrc.includes("is_archived = TRUE"),
  );
  check(
    "delete route checks for in-use assets before archiving",
    routesSrc.includes("asset_id = ${id}"),
  );
}

console.log("\n── 5. Composer CTA insert (gmail-inbox.tsx) ────────────────────────────");
{
  const inboxSrc = read("client/src/pages/gmail-inbox.tsx");

  check("ImagePlus icon imported", inboxSrc.includes("ImagePlus"));
  check(
    "showCtaPicker state declared",
    inboxSrc.includes("showCtaPicker"),
  );
  check(
    "ctaPickerQuery fetches /api/signature-ctas?forPicker=true",
    inboxSrc.includes("forPicker=true"),
  );
  check(
    "insertCtaIntoBody function defined",
    inboxSrc.includes("function insertCtaIntoBody"),
  );
  check(
    "CTA HTML uses data-vs-cta-id attribute",
    inboxSrc.includes("data-vs-cta-id"),
  );
  check(
    'Insert CTA toolbar button has data-testid="button-insert-cta"',
    inboxSrc.includes('data-testid="button-insert-cta"'),
  );
  check(
    "CTA insert looks for sign-off paragraph before inserting",
    inboxSrc.includes("regards|cheers|sincerely|thanks|best"),
  );
  check(
    "image CTA HTML includes display:block img tag",
    inboxSrc.includes('style="display:block;border:0;'),
  );
  check(
    "button/text CTA renders as styled anchor",
    inboxSrc.includes("background:#00C1DE"),
  );
}

console.log("\n── 6. Signature settings CTA assets (signature-settings.tsx) ───────────");
{
  const sigSrc = read("client/src/pages/signature-settings.tsx");

  check("CtaAsset type defined", sigSrc.includes("type CtaAsset ="));
  check("CtaAssetLibraryTab component defined", sigSrc.includes("function CtaAssetLibraryTab"));
  check(
    "CtaDialog has file upload functionality",
    sigSrc.includes("handleFileUpload") && sigSrc.includes("/api/cta-assets/upload"),
  );
  check(
    "CtaDialog has library picker toggle",
    sigSrc.includes("showLibrary") && sigSrc.includes("libraryQuery"),
  );
  check(
    "Preset destination URL updated to /sdemo",
    sigSrc.includes("voltsafemarine.com/sdemo"),
  );
  check(
    'Page-level Signatures tab has data-testid="tab-signatures"',
    sigSrc.includes('data-testid="tab-signatures"'),
  );
  check(
    'Page-level CTA Assets tab has data-testid="tab-cta-assets"',
    sigSrc.includes('data-testid="tab-cta-assets"'),
  );
  check(
    "Asset library delete uses AlertDialog confirmation",
    sigSrc.includes('data-testid="button-asset-delete-confirm"'),
  );
  check(
    "Asset rename uses inline input with renamingId/renameVal",
    sigSrc.includes("renamingId") && sigSrc.includes("renameVal"),
  );
  check(
    "CtaDialog shows image preview when imageUrl is set",
    sigSrc.includes("imageUrl && (") || sigSrc.includes("{imageUrl && ("),
  );
}

console.log("\n── 7. uploads/cta-assets directory exists ──────────────────────────────");
{
  check(
    "uploads/cta-assets directory created",
    fs.existsSync(path.resolve(root, "uploads/cta-assets")),
  );
}

console.log(`\n────────────────────────────────────────────────────────────────────────`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
