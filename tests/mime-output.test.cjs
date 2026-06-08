"use strict";
/**
 * Actual raw-MIME output tests for buildMimeRaw (Cases A-D).
 *
 * These tests call buildMimeRawDebug via a tsx subprocess, parse the decoded
 * MIME string, and assert on the exact structure.  Source-grep tests pass even
 * when the structure is wrong because they only check the source code; these
 * tests fail fast when Gmail would canonicalize the output into the broken
 * multipart/mixed layout.
 *
 * Required structure summary:
 *   Case A (no CID, no att) : multipart/alternative → [text/plain, text/html]
 *   Case B (CID, no att)    : multipart/related     → [text/html DIRECT, CID…]
 *   Case C (CID + att)      : multipart/mixed       → [multipart/related → [text/html, CID…], att…]
 *   Case D (att, no CID)    : multipart/mixed       → [multipart/alternative → [plain, html], att…]
 */

const { execSync } = require("child_process");
const path = require("path");

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

// ── Generate MIME output ─────────────────────────────────────────────────────
let cases;
try {
  const raw = execSync("npx tsx scripts/test-mime-generate.ts", {
    encoding: "utf8",
    timeout: 30000,
    cwd: path.resolve(__dirname, ".."),
  });
  cases = JSON.parse(raw.trim());
} catch (e) {
  console.error("FATAL: test-mime-generate.ts failed:\n", e.stderr || e.message);
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Return the first Content-Type header line in the MIME string. */
function rootCt(mime) {
  return mime.split(/\r?\n/).find(l => l.startsWith("Content-Type:")) ?? "";
}

/** Return every Content-Type header line in the MIME string. */
function allCt(mime) {
  return mime.split(/\r?\n/).filter(l => l.startsWith("Content-Type:"));
}

/** True if the MIME contains the pattern. */
function has(mime, pattern) {
  return typeof pattern === "string" ? mime.includes(pattern) : pattern.test(mime);
}

// ── Case A: no inline images, no attachments ─────────────────────────────────
console.log("\n── Case A: no CID images, no attachments ──");
{
  const m = cases.caseA;
  check("root is multipart/alternative",        rootCt(m).includes("multipart/alternative"));
  check("contains text/plain part",             has(m, "Content-Type: text/plain;"));
  check("contains text/html part",              has(m, "Content-Type: text/html;"));
  check("no multipart/related",                !has(m, "multipart/related"));
  check("no multipart/mixed",                  !has(m, "multipart/mixed"));
  check("no CID parts",                        !has(m, "Content-ID:"));
  check("no X-Attachment-Content-Disposition", !has(m, "X-Attachment-Content-Disposition"));
}

// ── Case B1: one inline image, no attachments ────────────────────────────────
console.log("\n── Case B1: one CID image, no attachments ──");
{
  const m = cases.caseB1;
  const cts = allCt(m);

  check("root is multipart/related",            rootCt(m).includes("multipart/related"));
  check("root has type=\"text/html\"",          rootCt(m).includes('type="text/html"'));
  check("second Content-Type is text/html",     cts[1]?.includes("text/html") ?? false);
  check("text/html is DIRECT (not via alt)",   !cts[1]?.includes("multipart/alternative") ?? true);
  check("NO multipart/alternative anywhere",   !has(m, "multipart/alternative"));
  check("has exactly one CID part",             (m.match(/Content-ID:/g) || []).length === 1);
  check("CID value is <vsigtest1abc>",          has(m, "Content-ID: <vsigtest1abc>"));
  check("CID part has Content-Type image/png",  has(m, "Content-Type: image/png;"));
  check("CID part has name= with extension",    /Content-Type: image\/png; name="[^"]+\.(png|jpg|jpeg|gif|webp)"/i.test(m));
  // Apple Mail ghost-attachment fix: CID parts must NOT have Content-Disposition.
  // RFC 2392 §2 — Content-ID alone is sufficient to mark a part as inline.
  check("CID part has NO Content-Disposition (Apple Mail ghost-attachment fix)", !has(m, "Content-Disposition: inline"));
  check("name= on Content-Type has extension",  /Content-Type: image\/png; name="[^"]+\.(png|jpg|jpeg|gif|webp)"/i.test(m));
  check("no X-Attachment-Content-Disposition", !has(m, "X-Attachment-Content-Disposition"));
  check("no real attachment (no disposition: attachment)", !has(m, "Content-Disposition: attachment"));
}

// ── Case B2: two inline images, no attachments ───────────────────────────────
console.log("\n── Case B2: two CID images, no attachments ──");
{
  const m = cases.caseB2;

  check("root is multipart/related",            rootCt(m).includes("multipart/related"));
  check("NO multipart/alternative anywhere",   !has(m, "multipart/alternative"));
  check("has exactly two CID parts",            (m.match(/Content-ID:/g) || []).length === 2);
  check("first CID <vsigtest1abc> present",     has(m, "Content-ID: <vsigtest1abc>"));
  check("second CID <vsigtest2abc> present",    has(m, "Content-ID: <vsigtest2abc>"));
  check("both image types present (png + jpeg)",
    has(m, "image/png") && has(m, "image/jpeg"));
  check("png filename has .png extension",
    /Content-Type: image\/png; name="[^"]*\.png"/i.test(m));
  check("jpeg filename has .jpg extension",
    /Content-Type: image\/jpeg; name="[^"]*\.jpg"/i.test(m));
  check("no X-Attachment-Content-Disposition", !has(m, "X-Attachment-Content-Disposition"));
}

// ── Case C: one inline image + one real attachment ───────────────────────────
console.log("\n── Case C: one CID image + one real attachment ──");
{
  const m = cases.caseC;

  check("root is multipart/mixed",              rootCt(m).includes("multipart/mixed"));
  check("multipart/related is first sub-part",  m.slice(0, 600).includes("multipart/related"));
  check("related has type=\"text/html\"",       m.slice(0, 600).includes('type="text/html"'));
  // related's first child must be text/html, not multipart/alternative
  // afterRelated starts mid-line at "multipart/related; ..." so the first
  // Content-Type line found (index 0) is the FIRST child inside that boundary.
  const afterRelated = m.slice(m.indexOf("multipart/related"));
  const firstCtInRelated = afterRelated.split(/\r?\n/)
    .filter(l => l.startsWith("Content-Type:"))[0] ?? "";
  check("related's first child is text/html",   firstCtInRelated.includes("text/html"));
  check("NO multipart/alternative inside related", (() => {
    const relStart = m.indexOf("multipart/related");
    const relEnd   = m.indexOf("multipart/mixed", relStart + 1);
    const relBlock = relEnd > relStart ? m.slice(relStart, relEnd) : m.slice(relStart);
    return !relBlock.includes("multipart/alternative");
  })());
  check("has exactly one CID part",             (m.match(/Content-ID:/g) || []).length === 1);
  check("real attachment has Content-Disposition: attachment",
    has(m, "Content-Disposition: attachment"));
  check("attachment filename is doc.pdf",       has(m, 'filename="doc.pdf"'));
  check("no X-Attachment-Content-Disposition", !has(m, "X-Attachment-Content-Disposition"));
}

// ── Case D: real attachment, no inline images ────────────────────────────────
console.log("\n── Case D: attachment only, no CID images ──");
{
  const m = cases.caseD;

  check("root is multipart/mixed",              rootCt(m).includes("multipart/mixed"));
  check("contains multipart/alternative",       has(m, "multipart/alternative"));
  check("contains text/plain part",             has(m, "Content-Type: text/plain;"));
  check("contains text/html part",              has(m, "Content-Type: text/html;"));
  check("contains real attachment",             has(m, "Content-Disposition: attachment"));
  check("no CID parts",                        !has(m, "Content-ID:"));
  check("no X-Attachment-Content-Disposition", !has(m, "X-Attachment-Content-Disposition"));
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
if (failed > 0) process.exit(1);
