/**
 * tests/cta-asset-system.test.js
 *
 * Source-grep + structural + integration-simulation tests for the CTA Asset system.
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
    "email-html-normalizer.ts excludes data-vs-cta-id from attribute stripping",
    normSrc.includes("data-(?!vs-cta-id=)"),
  );
  check(
    "email-format.ts excludes data-vs-cta-id from attribute stripping",
    fmtSrc.includes("data-(?!vs-cta-id=)"),
  );
  check(
    "email-format.ts anchor rebuild preserves data-vs-cta-id attribute",
    fmtSrc.includes("data-vs-cta-id") && fmtSrc.includes("ctaAttr"),
  );
  check(
    "email-format.ts anchor rebuild uses 4-group regex (pre + href + post + label)",
    fmtSrc.includes("(_full, pre, href, post, label)"),
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
    "no early return when split is null — fallback to full-body scan",
    !trackerSrc.includes("if (!split) return { html, tokens: [] }"),
  );
  check(
    "fallback: uses split ?? [html, '', '']",
    trackerSrc.includes('split ?? [html, "", ""]'),
  );
  check(
    "sig-section step 1 gated on split being non-null",
    trackerSrc.includes("if (split && ctaRows.length > 0)"),
  );
  check(
    "tracker looks for data-vs-cta-id in body (step 2 regex)",
    trackerSrc.includes("data-vs-cta-id"),
  );
  check(
    "body CTA step 2 processes body CTAs with bodyCTARe regex",
    trackerSrc.includes("bodyCTARe"),
  );
  check(
    "body CTA inserts into signature_cta_clicks",
    trackerSrc.includes("INSERT INTO signature_cta_clicks"),
  );
  check(
    "step 1 and step 2 both present",
    trackerSrc.includes("// ── 1.") && trackerSrc.includes("// ── 2."),
  );
  check(
    "body CTA step 2 comment notes it runs without sig markers",
    trackerSrc.includes("runs whether or not signature markers"),
  );
  check("isSafeCtaUrl is exported", trackerSrc.includes("export function isSafeCtaUrl"));
  check("updateSignatureCtaMessageIds is exported", trackerSrc.includes("export async function updateSignatureCtaMessageIds"));
  check("recordSignatureCtaClick is exported", trackerSrc.includes("export async function recordSignatureCtaClick"));
}

console.log("\n── 3. Integration simulation: anchor rebuild preserves data-vs-cta-id ──");
{
  // Simulate the email-format.ts anchor rebuild logic inline to verify it preserves
  // data-vs-cta-id through the sanitization pass.
  const VOLTSAFE_LINK_COLOR = "#00C1DE";

  function simulateAnchorRebuild(html) {
    return html.replace(
      /<a\b([^>]*)\bhref="([^"]*)"([^>]*)>([\s\S]*?)<\/a>/gi,
      (_full, pre, href, post, label) => {
        const safe = href.replace(/"/g, "&quot;").trim();
        if (safe && !/^(https?:|mailto:|tel:|\/[^/]|#)/i.test(safe)) {
          return label;
        }
        const allAttrs = pre + " " + post;
        const ctaIdMatch = /data-vs-cta-id="(\d+)"/.exec(allAttrs);
        const ctaAttr = ctaIdMatch ? ` data-vs-cta-id="${ctaIdMatch[1]}"` : "";
        return `<a href="${safe}"${ctaAttr} target="_blank" rel="noopener noreferrer" style="color:${VOLTSAFE_LINK_COLOR};">${label}</a>`;
      },
    );
  }

  const inputWithCtaId = `<a href="https://voltsafe.com/demo" data-vs-cta-id="42" style="display:inline-block;">Watch Demo</a>`;
  const output = simulateAnchorRebuild(inputWithCtaId);

  check(
    "anchor rebuild retains data-vs-cta-id='42' in output",
    output.includes('data-vs-cta-id="42"'),
  );
  check(
    "anchor rebuild retains href",
    output.includes('href="https://voltsafe.com/demo"'),
  );
  check(
    "anchor rebuild adds target=_blank and rel attributes",
    output.includes('target="_blank"') && output.includes('rel="noopener noreferrer"'),
  );

  const inputWithoutCtaId = `<a href="https://example.com">Normal link</a>`;
  const outputNormal = simulateAnchorRebuild(inputWithoutCtaId);
  check(
    "normal anchors (no data-vs-cta-id) are not given the attribute",
    !outputNormal.includes("data-vs-cta-id"),
  );
  check(
    "unsafe protocol stripped (javascript:)",
    simulateAnchorRebuild(`<a href="javascript:alert(1)">x</a>`) === "x",
  );
}

console.log("\n── 4. Integration simulation: body CTA wrapping without sig markers ────");
{
  // Simulate the tracker's split-fallback logic and body CTA processing flow.
  // We verify that a body CTA anchor survives to the point where bodyCTARe would match it.

  const SIG_START = "<!--vs-sig-start-->";

  function splitSigSection(html) {
    const s = html.indexOf(SIG_START);
    if (s === -1) return null;
    const END = "<!--vs-sig-end-->";
    const e = html.indexOf(END, s);
    if (e === -1) return null;
    return [html.slice(0, s), html.slice(s + SIG_START.length, e), html.slice(e + END.length)];
  }

  const bodyCTARe = /<a\b[^>]*\bdata-vs-cta-id="(\d+)"[^>]*>/gi;

  // Email WITHOUT signature markers but WITH a body CTA
  const htmlNoSig = `<p>Hi there,</p><br><a href="https://voltsafe.com/demo" data-vs-cta-id="7" target="_blank">Watch Demo</a><br><p>Best,</p>`;
  const splitNoSig = splitSigSection(htmlNoSig);
  const [beforeNoSig] = splitNoSig ?? [htmlNoSig, "", ""];

  bodyCTARe.lastIndex = 0;
  const matchNoSig = bodyCTARe.exec(beforeNoSig);
  check(
    "body CTA with data-vs-cta-id is found in full body when no sig markers",
    matchNoSig !== null && matchNoSig[1] === "7",
  );

  // Email WITH signature markers — body CTA should still be in "before" section
  const htmlWithSig = `<p>Hi,</p><a href="https://voltsafe.com/demo" data-vs-cta-id="3" target="_blank">Demo</a><!--vs-sig-start--><p>Regards, Trevor</p><!--vs-sig-end-->`;
  const splitWithSig = splitSigSection(htmlWithSig);
  const [beforeWithSig] = splitWithSig ?? [htmlWithSig, "", ""];

  bodyCTARe.lastIndex = 0;
  const matchWithSig = bodyCTARe.exec(beforeWithSig);
  check(
    "body CTA is found in 'before' section when sig markers present",
    matchWithSig !== null && matchWithSig[1] === "3",
  );

  // No body CTA — bodyCTARe should not match
  const htmlNoCta = `<p>Just regular text</p><!--vs-sig-start--><!--vs-sig-end-->`;
  const [beforeNoCta] = splitSigSection(htmlNoCta) ?? [htmlNoCta, "", ""];
  bodyCTARe.lastIndex = 0;
  check(
    "emails without body CTAs produce no match",
    bodyCTARe.exec(beforeNoCta) === null,
  );
}

console.log("\n── 5. DB migration for cta_assets ──────────────────────────────────────");
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

console.log("\n── 6. Route registrations in routes.ts ─────────────────────────────────");
{
  const routesSrc = read("server/routes.ts");

  check("ctaUpload multer defined", routesSrc.includes("const ctaUpload = multer("));
  check("CTA_ASSETS_DIR constant defined", routesSrc.includes("const CTA_ASSETS_DIR"));
  // Check the CTA-specific multer section (not the whole file, which has other multers)
  const ctaMulterStart = routesSrc.indexOf("const ctaUpload = multer(");
  const ctaMulterEnd   = routesSrc.indexOf("});", ctaMulterStart) + 3;
  const ctaMulterCode  = ctaMulterStart >= 0 ? routesSrc.slice(ctaMulterStart, ctaMulterEnd) : "";
  check("CTA multer fileFilter rejects GIF (PNG/JPG/WEBP only)", !ctaMulterCode.includes('"image/gif"'));
  check("public /assets/cta/:filename registered (no auth)", routesSrc.includes('app.get("/assets/cta/:filename"'));
  check("POST /api/cta-assets/upload registered", routesSrc.includes('app.post("/api/cta-assets/upload"'));
  check("GET /api/cta-assets registered", routesSrc.includes('app.get("/api/cta-assets"'));
  check("PUT /api/cta-assets/:id registered", routesSrc.includes('app.put("/api/cta-assets/:id"'));
  check("DELETE /api/cta-assets/:id registered", routesSrc.includes('app.delete("/api/cta-assets/:id"'));
  check("UUID filename validation in public route", routesSrc.includes("[0-9a-f-]+"));
  check("immutable cache header set", routesSrc.includes("immutable"));
  check("?forPicker=true supported in GET /api/signature-ctas", routesSrc.includes("forPicker"));
  check("delete soft-archives and checks in-use", routesSrc.includes("is_archived = TRUE") && routesSrc.includes("asset_id = ${id}"));
  check("POST /api/signature-ctas persists assetId", routesSrc.includes("asset_id)\n        VALUES") || routesSrc.includes("asset_id, created_at") || routesSrc.includes("tracking_enabled, asset_id"));
  check("PUT /api/signature-ctas/:id updates asset_id", routesSrc.includes("asset_id         = ${assetId"));
  check("publicUrl uses env-var origin (PUBLIC_URL / REPL_SLUG)", routesSrc.includes("process.env.PUBLIC_URL") && routesSrc.includes("REPL_SLUG"));
}

console.log("\n── 7. Composer CTA insert (gmail-inbox.tsx) ────────────────────────────");
{
  const inboxSrc = read("client/src/pages/gmail-inbox.tsx");

  check("ImagePlus icon imported", inboxSrc.includes("ImagePlus"));
  check("showCtaPicker state declared", inboxSrc.includes("showCtaPicker"));
  check("ctaPickerQuery fetches ?forPicker=true", inboxSrc.includes("forPicker=true"));
  check("insertCtaIntoBody function defined", inboxSrc.includes("function insertCtaIntoBody"));
  check("CTA HTML uses data-vs-cta-id attribute", inboxSrc.includes("data-vs-cta-id"));
  check('Insert CTA toolbar button has data-testid="button-insert-cta"', inboxSrc.includes('data-testid="button-insert-cta"'));
  check("Insertion looks for <!--vs-sig-start--> marker", inboxSrc.includes("vs-sig-start"));
  check("Insertion looks for sign-off phrase (regards|cheers|…)", inboxSrc.includes("regards|cheers|sincerely|thanks|best"));
  check("Insertion looks for lone first-name sign-off in last 30% of body", inboxSrc.includes("0.7"));
  check("All candidate positions use Math.min (whichever comes first)", inboxSrc.includes("Math.min(...candidates)"));
  check("Image CTA HTML includes display:block img tag", inboxSrc.includes('style="display:block;border:0;'));
  check("Button/text CTA renders as styled anchor with brand color", inboxSrc.includes("background:#00C1DE"));
}

console.log("\n── 8. Signature settings CTA assets (signature-settings.tsx) ───────────");
{
  const sigSrc = read("client/src/pages/signature-settings.tsx");

  check("CtaAsset type defined", sigSrc.includes("type CtaAsset ="));
  check("CtaAssetLibraryTab component defined", sigSrc.includes("function CtaAssetLibraryTab"));
  check("CtaDialog has file upload functionality", sigSrc.includes("handleFileUpload") && sigSrc.includes("/api/cta-assets/upload"));
  check("CtaDialog tracks selectedAssetId state", sigSrc.includes("selectedAssetId"));
  check("Upload sets selectedAssetId from uploaded asset", sigSrc.includes("setSelectedAssetId(asset.id)"));
  check("Library picker selection sets selectedAssetId", sigSrc.includes("setSelectedAssetId(asset.id); setShowLibrary(false)"));
  check("Manual URL input clears selectedAssetId", sigSrc.includes("setSelectedAssetId(null)"));
  check("Mutation body includes assetId field", sigSrc.includes("assetId: selectedAssetId"));
  check("CtaDialog has library picker toggle", sigSrc.includes("showLibrary") && sigSrc.includes("libraryQuery"));
  check("Preset auto-looks up WatchDemo asset by name", sigSrc.includes("watchdemo"));
  check("Preset shows fallback toast when no asset found", sigSrc.includes("Upload a") && sigSrc.includes("WatchDemo"));
  check("Preset URL updated to /sdemo", sigSrc.includes("voltsafemarine.com/sdemo"));
  check("Page-level Signatures tab", sigSrc.includes('data-testid="tab-signatures"'));
  check("Page-level CTA Assets tab", sigSrc.includes('data-testid="tab-cta-assets"'));
  check("Asset delete uses AlertDialog confirmation", sigSrc.includes('data-testid="button-asset-delete-confirm"'));
  check("File inputs accept PNG/JPG/WEBP only (no GIF)", !sigSrc.includes("image/gif"));
}

console.log("\n── 9. uploads/cta-assets directory exists ──────────────────────────────");
{
  check("uploads/cta-assets directory created", fs.existsSync(path.resolve(root, "uploads/cta-assets")));
}

console.log(`\n────────────────────────────────────────────────────────────────────────`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
