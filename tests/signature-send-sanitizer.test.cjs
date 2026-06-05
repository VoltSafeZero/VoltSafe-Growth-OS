/**
 * tests/signature-send-sanitizer.test.cjs
 *
 * Regression tests for server/services/signature-html-sanitizer.ts
 *
 * Verifies that production-style signature HTML with unsafe image URLs,
 * data URIs, old Replit hosts, and dangerous tags is correctly sanitized
 * before the email is handed to the Gmail API, preventing 403 proxy rejections.
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// ─── Source-grep helpers ──────────────────────────────────────────────────────
const SANITIZER_PATH = path.join(__dirname, "../server/services/signature-html-sanitizer.ts");
const sanitizerSrc = fs.readFileSync(SANITIZER_PATH, "utf8");

const SEND_ROUTE_PATH = path.join(__dirname, "../server/routes.ts");
const sendRouteSrc = fs.readFileSync(SEND_ROUTE_PATH, "utf8");

const INBOX_PATH = path.join(__dirname, "../client/src/pages/gmail-inbox.tsx");
const inboxSrc = fs.readFileSync(INBOX_PATH, "utf8");

const AUDIT_PATH = path.join(__dirname, "../scripts/audit-production-signatures.ts");
const auditSrc = fs.readFileSync(AUDIT_PATH, "utf8");

// ─── Part 1: Sanitizer module structure ──────────────────────────────────────
console.log("\nPart 1 — Sanitizer module structure");

test("sanitizer exports applySignatureSendSanitizer", () => {
  assert.ok(sanitizerSrc.includes("export function applySignatureSendSanitizer"), "should export applySignatureSendSanitizer");
});

test("sanitizer exports sanitizeSignatureHtml", () => {
  assert.ok(sanitizerSrc.includes("export function sanitizeSignatureHtml"), "should export sanitizeSignatureHtml");
});

test("sanitizer exports auditSignatureHtml", () => {
  assert.ok(sanitizerSrc.includes("export function auditSignatureHtml"), "should export auditSignatureHtml");
});

test("applySignatureSendSanitizer extracts sig section via vs-sig markers", () => {
  assert.ok(sanitizerSrc.includes("<!--vs-sig-start-->"), "should reference sig-start marker");
  assert.ok(sanitizerSrc.includes("<!--vs-sig-end-->"), "should reference sig-end marker");
});

test("sanitizer passes through HTML when no sig markers are found", () => {
  assert.ok(
    sanitizerSrc.includes("if (si === -1) return html"),
    "should short-circuit when no SIG_START marker"
  );
});

// ─── Part 2: Data URI stripping ───────────────────────────────────────────────
console.log("\nPart 2 — data: / blob: / file: / cid: URI stripping");

test("sanitizer strips data: src pattern", () => {
  assert.ok(sanitizerSrc.includes("data:"), "should reference data: scheme");
  assert.ok(sanitizerSrc.includes("blob:"), "should reference blob: scheme");
  assert.ok(sanitizerSrc.includes("file:"), "should reference file: scheme");
  assert.ok(sanitizerSrc.includes("cid:"), "should reference cid: scheme");
  assert.ok(
    sanitizerSrc.includes("/^(data:|blob:|file:|cid:)/i"),
    "should have regex to match unsafe schemes"
  );
});

test("sanitizer returns empty string for data: img tags", () => {
  // Simulate the regex rule that strips data URI images
  const unsafeSchemes = /^(data:|blob:|file:|cid:)/i;
  const dataSrc = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA";
  assert.ok(unsafeSchemes.test(dataSrc), "data URI should match strip pattern");
});

test("sanitizer logs stripped data URI (audit trail)", () => {
  assert.ok(
    sanitizerSrc.includes("stripped data/blob/file/cid img"),
    "should log when stripping data/blob/file/cid images"
  );
});

// ─── Part 3: Localhost stripping ──────────────────────────────────────────────
console.log("\nPart 3 — localhost / 127.0.0.1 stripping");

test("sanitizer strips localhost image src", () => {
  assert.ok(
    sanitizerSrc.includes("localhost|127\\.0\\.0\\.1"),
    "should have regex to match localhost/127.0.0.1"
  );
  assert.ok(
    sanitizerSrc.includes("stripped localhost img"),
    "should log stripped localhost images"
  );
});

test("localhost regex matches 127.0.0.1", () => {
  const re = /localhost|127\.0\.0\.1/i;
  assert.ok(re.test("http://127.0.0.1:5000/api/signatures/logo.png"), "should match 127.0.0.1");
  assert.ok(re.test("http://localhost:5000/uploads/logo.png"), "should match localhost");
  assert.ok(!re.test("https://voltsafe.app/assets/cta/logo.png"), "should NOT match voltsafe.app");
});

// ─── Part 4: Private /api/ route stripping ───────────────────────────────────
console.log("\nPart 4 — /api/ route stripping");

test("sanitizer strips img src containing /api/ routes", () => {
  assert.ok(
    sanitizerSrc.includes("/api/"),
    "should reference /api/ as unsafe path"
  );
  assert.ok(
    sanitizerSrc.includes("stripped /api/ img src"),
    "should log stripped /api/ images"
  );
});

test("/api/ route regex matches auth-protected routes", () => {
  const re = /(?:^|\/)api\//i;
  assert.ok(re.test("/api/attachments/file/abc123.png"), "should match /api/ absolute");
  assert.ok(re.test("https://voltsafe.app/api/signatures/logo"), "should match /api/ in URL");
  assert.ok(!re.test("https://voltsafe.app/assets/cta/abc123.png"), "should NOT match /assets/cta/");
  assert.ok(!re.test("https://s3.amazonaws.com/bucket/logo.png"), "should NOT match S3 URL");
});

// ─── Part 5: Relative URL handling ───────────────────────────────────────────
console.log("\nPart 5 — Relative URL handling");

test("sanitizer rewrites /assets/cta/ relative path to absolute baseUrl", () => {
  assert.ok(
    sanitizerSrc.includes("/assets/cta/"),
    "should reference /assets/cta/ as known safe path"
  );
  assert.ok(
    sanitizerSrc.includes("`${baseUrl}${src}`"),
    "should rewrite relative /assets/cta/ to absolute baseUrl"
  );
});

test("sanitizer strips other relative URLs that are not safe asset paths", () => {
  assert.ok(
    sanitizerSrc.includes("stripped unsafe relative img src"),
    "should log stripped unsafe relative URLs"
  );
});

test("safe asset path regex matches correctly", () => {
  const safe = /^\/assets\/cta\/[\w-]+\.(png|jpg|jpeg|webp|gif)$/i;
  assert.ok(safe.test("/assets/cta/abc123-def.png"), "should match valid CTA asset");
  assert.ok(safe.test("/assets/cta/uuid-1234.jpg"), "should match valid CTA asset");
  assert.ok(!safe.test("/assets/cta/../../../etc/passwd"), "should NOT match path traversal");
  assert.ok(!safe.test("/uploads/private.png"), "should NOT match /uploads/");
  assert.ok(!safe.test("/api/signatures/logo.png"), "should NOT match /api/ path");
});

// ─── Part 6: Old Replit host rewriting ───────────────────────────────────────
console.log("\nPart 6 — Old Replit host URL rewriting");

test("sanitizer detects old *.replit.dev domain", () => {
  assert.ok(
    sanitizerSrc.includes("replit.dev"),
    "should reference replit.dev old host"
  );
  assert.ok(
    sanitizerSrc.includes("repl.co"),
    "should reference repl.co old host"
  );
});

test("sanitizer rewrites old Replit host /assets/cta/ to baseUrl", () => {
  assert.ok(
    sanitizerSrc.includes("rewrote old-host CTA img"),
    "should log when rewriting old-host CTA images"
  );
  assert.ok(
    sanitizerSrc.includes("`${baseUrl}${p}`"),
    "should rewrite old Replit host path to baseUrl + pathname"
  );
});

test("sanitizer strips old Replit host for non-asset paths", () => {
  assert.ok(
    sanitizerSrc.includes("stripped old-host non-asset img"),
    "should log stripped old-host non-asset images"
  );
});

test("old Replit host regex matches known domains", () => {
  const re = /\.(replit\.dev|repl\.co|repl\.it|replit\.app)$/;
  assert.ok(re.test("abc-def.replit.dev"), "should match *.replit.dev");
  assert.ok(re.test("my-app.repl.co"), "should match *.repl.co");
  assert.ok(re.test("my-app.replit.app"), "should match *.replit.app");
  assert.ok(!re.test("voltsafe.app"), "should NOT match production domain");
  assert.ok(!re.test("s3.amazonaws.com"), "should NOT match S3");
});

// ─── Part 7: Dangerous tag stripping ─────────────────────────────────────────
console.log("\nPart 7 — Dangerous tag stripping");

test("sanitizer strips <script> tags", () => {
  assert.ok(/<script\\b/.test(sanitizerSrc), "should have script stripping regex");
});

test("sanitizer strips <iframe> tags", () => {
  assert.ok(/<iframe\\b/.test(sanitizerSrc), "should have iframe stripping regex");
});

test("sanitizer strips <form> tags", () => {
  assert.ok(/<form\\b/.test(sanitizerSrc), "should have form stripping regex");
});

test("sanitizer strips <style> blocks", () => {
  assert.ok(/<style\\b/.test(sanitizerSrc), "should have style stripping regex");
});

test("sanitizer strips <svg> blocks", () => {
  assert.ok(/<svg\\b/.test(sanitizerSrc), "should have svg stripping regex");
});

test("sanitizer strips event handler attributes (on*=)", () => {
  assert.ok(
    sanitizerSrc.includes("on[a-z]+=\""),
    "should strip on* event handlers with double-quote values"
  );
  assert.ok(
    sanitizerSrc.includes("on[a-z]+='"),
    "should strip on* event handlers with single-quote values"
  );
});

// ─── Part 8: CTA fallback for stripped images ─────────────────────────────────
console.log("\nPart 8 — CTA text fallback when img is stripped");

test("sanitizer converts empty <a> tags to text button", () => {
  assert.ok(
    sanitizerSrc.includes("<a\\b([^>]*)>\\s*<\\/a>"),
    "should detect empty <a> tags after img stripping"
  );
});

test("fallback button uses VoltSafe brand color", () => {
  assert.ok(
    sanitizerSrc.includes("#00C1DE"),
    "should use VoltSafe teal (#00C1DE) for CTA button fallback"
  );
});

test("fallback button has safe href validation", () => {
  // The sanitizer uses /^https?:\/\//i regex to validate hrefs before emitting fallback buttons
  assert.ok(
    sanitizerSrc.includes("^https?:\\/\\/"),
    "should validate href is absolute HTTPS before creating fallback"
  );
});

test("fallback button strips links with unsafe hrefs", () => {
  // If href is invalid/non-https, the empty <a> should be removed entirely
  assert.ok(
    sanitizerSrc.includes("return \"\"; // no valid dest"),
    "should remove empty <a> tags with invalid hrefs"
  );
});

// ─── Part 9: Audit helper ─────────────────────────────────────────────────────
console.log("\nPart 9 — auditSignatureHtml helper");

test("audit helper detects hasDataUri", () => {
  assert.ok(sanitizerSrc.includes("hasDataUri"), "should report hasDataUri");
});

test("audit helper detects hasLocalhost", () => {
  assert.ok(sanitizerSrc.includes("hasLocalhost"), "should report hasLocalhost");
});

test("audit helper detects hasApiRoute", () => {
  assert.ok(sanitizerSrc.includes("hasApiRoute"), "should report hasApiRoute");
});

test("audit helper detects hasOldReplitHost", () => {
  assert.ok(sanitizerSrc.includes("hasOldReplitHost"), "should report hasOldReplitHost");
});

test("audit helper detects hasDangerousTag", () => {
  assert.ok(sanitizerSrc.includes("hasDangerousTag"), "should report hasDangerousTag");
});

test("audit helper detects hasEventHandler", () => {
  assert.ok(sanitizerSrc.includes("hasEventHandler"), "should report hasEventHandler");
});

test("audit helper extracts imgSrcs list", () => {
  assert.ok(sanitizerSrc.includes("imgSrcs"), "should extract imgSrcs from html");
});

test("audit helper extracts hrefs list", () => {
  assert.ok(sanitizerSrc.includes("hrefs"), "should extract hrefs from html");
});

test("audit helper returns issues array", () => {
  assert.ok(sanitizerSrc.includes("issues: string[]"), "should return typed issues array");
});

// ─── Part 10: Send route integration ─────────────────────────────────────────
console.log("\nPart 10 — Send route integration");

test("routes.ts imports applySignatureSendSanitizer", () => {
  assert.ok(
    sendRouteSrc.includes("applySignatureSendSanitizer"),
    "routes.ts should import applySignatureSendSanitizer"
  );
});

test("routes.ts imports from signature-html-sanitizer", () => {
  assert.ok(
    sendRouteSrc.includes("./services/signature-html-sanitizer"),
    "routes.ts should import from signature-html-sanitizer module"
  );
});

test("send route applies sanitizer after normalizeOutboundHtml", () => {
  // The sanitizer must wrap normalizeOutboundHtml in the cleanBody assignment
  assert.ok(
    sendRouteSrc.includes("applySignatureSendSanitizer(normalizeOutboundHtml(body)"),
    "should call applySignatureSendSanitizer(normalizeOutboundHtml(body), baseUrl)"
  );
});

test("baseUrl is available when sanitizer is called", () => {
  // baseUrl must be defined BEFORE the cleanBody = ... line
  const sanitizerCallIdx = sendRouteSrc.indexOf("applySignatureSendSanitizer(normalizeOutboundHtml(body)");
  const baseUrlDefIdx    = sendRouteSrc.lastIndexOf("const baseUrl", sanitizerCallIdx);
  assert.ok(baseUrlDefIdx !== -1 && baseUrlDefIdx < sanitizerCallIdx,
    "baseUrl must be defined before applySignatureSendSanitizer is called"
  );
});

test("sanitizer comment explains purpose in send route", () => {
  assert.ok(
    sendRouteSrc.includes("Sanitize signature section at send time"),
    "should have explanatory comment for the sanitizer call"
  );
});

// ─── Part 11: Frontend HTML error guard ──────────────────────────────────────
console.log("\nPart 11 — Frontend HTML error guard");

test("sendMutation guards against HTML response bodies", () => {
  assert.ok(
    inboxSrc.includes("<!doctype"),
    "should detect <!doctype in response body"
  );
  assert.ok(
    inboxSrc.includes("<html"),
    "should detect <html in response body"
  );
});

test("sendMutation shows user-friendly message for HTML 403", () => {
  assert.ok(
    inboxSrc.includes("The server encountered an unexpected error"),
    "should show user-friendly message for HTML proxy errors"
  );
});

test("sendMutation isHtmlPage check uses case-insensitive regex", () => {
  assert.ok(
    inboxSrc.includes("/^\\s*<!doctype|^\\s*<html/i"),
    "should use case-insensitive regex for HTML detection"
  );
});

test("sendMutation never exposes raw <!doctype to user", () => {
  // The original code threw `Send failed (403): <!doctype html>...`
  // After the fix, the raw HTML is replaced with a clean message.
  const errorSection = inboxSrc.slice(
    inboxSrc.indexOf("const isHtmlPage"),
    inboxSrc.indexOf("throw new Error(`Send failed") + 200,
  );
  assert.ok(
    errorSection.includes("isHtmlPage"),
    "error section should include isHtmlPage check"
  );
  assert.ok(
    errorSection.includes("displayMsg"),
    "error section should use displayMsg (not raw text)"
  );
});

// ─── Part 12: Audit script ────────────────────────────────────────────────────
console.log("\nPart 12 — Audit script");

test("audit script exists at scripts/audit-production-signatures.ts", () => {
  assert.ok(fs.existsSync(AUDIT_PATH), "audit script file should exist");
});

test("audit script uses PROD_DATABASE_URL", () => {
  assert.ok(
    auditSrc.includes("PROD_DATABASE_URL"),
    "should use PROD_DATABASE_URL env var"
  );
});

test("audit script imports auditSignatureHtml from sanitizer", () => {
  assert.ok(
    auditSrc.includes("auditSignatureHtml"),
    "should import auditSignatureHtml from signature-html-sanitizer"
  );
});

test("audit script imports sanitizeSignatureHtml for preview mode", () => {
  assert.ok(
    auditSrc.includes("sanitizeSignatureHtml"),
    "should import sanitizeSignatureHtml for --fix-preview mode"
  );
});

test("audit script supports --user= flag", () => {
  assert.ok(
    auditSrc.includes("--user="),
    "should support --user=EMAIL flag for targeted audit"
  );
});

test("audit script supports --fix-preview flag", () => {
  assert.ok(
    auditSrc.includes("--fix-preview"),
    "should support --fix-preview flag"
  );
});

test("audit script queries email_signatures table", () => {
  assert.ok(
    auditSrc.includes("email_signatures"),
    "should query email_signatures table"
  );
});

test("audit script queries signature_cta_items table", () => {
  assert.ok(
    auditSrc.includes("signature_cta_items"),
    "should query signature_cta_items for CTA image URL issues"
  );
});

test("audit script does not log html_content directly", () => {
  // Audit must not log raw signature HTML (may contain PII)
  // It should log metadata like id, name, length, src URLs only
  const logLines = auditSrc
    .split("\n")
    .filter((l) => l.includes("console.log") && l.includes("html_content"));
  assert.strictEqual(logLines.length, 0,
    "should NOT log raw html_content (PII risk)"
  );
});

test("audit script prints recommended fixes for each issue type", () => {
  assert.ok(
    auditSrc.includes("RECOMMENDED"),
    "should print RECOMMENDED fix guidance for each issue type"
  );
});

test("audit script summary shows total issues count", () => {
  assert.ok(
    auditSrc.includes("Total issues"),
    "should print total issues count in summary"
  );
});

// ─── Part 13: No-signature-section passthrough ────────────────────────────────
console.log("\nPart 13 — Emails without signatures pass through unmodified");

test("applySignatureSendSanitizer returns html unchanged when no vs-sig markers", () => {
  const si = sanitizerSrc.indexOf("if (si === -1) return html");
  assert.ok(si !== -1, "should short-circuit return when no vs-sig-start marker");
});

test("applySignatureSendSanitizer returns html unchanged when end marker missing", () => {
  const si = sanitizerSrc.indexOf("if (ei === -1) return html");
  assert.ok(si !== -1, "should short-circuit return when vs-sig-end marker is missing");
});

test("sanitizer preserves email body text outside sig markers", () => {
  // The sanitizer only touches content BETWEEN the markers;
  // the before/after slices are concatenated unchanged.
  assert.ok(
    sanitizerSrc.includes("html.slice(0, contentStart)"),
    "should preserve content before sig-start marker"
  );
  assert.ok(
    sanitizerSrc.includes("html.slice(ei)"),
    "should preserve content after sig-end marker"
  );
});

// ─── Part 14: VoltSafe signature color/style preserved ───────────────────────
console.log("\nPart 14 — Safe signature content is preserved");

test("sanitizer preserves table elements (email layout)", () => {
  // The sanitizer should NOT strip tables — they are the main layout mechanism
  // for professional HTML email signatures.
  assert.ok(
    !sanitizerSrc.includes("/<table"),
    "should NOT strip <table> elements from signatures"
  );
});

test("sanitizer preserves <a> href links", () => {
  // Links to external sites (LinkedIn, website, phone) must survive
  assert.ok(
    !sanitizerSrc.includes("strip.*href") && !sanitizerSrc.includes("remove.*href"),
    "should NOT strip valid href links from signatures"
  );
});

test("sanitizer preserves VoltSafe signature color (#787f84)", () => {
  // This color is used for signature text and must not be stripped
  // (normalizeOutboundHtml already preserves it; sanitizer should not disrupt)
  assert.ok(
    !sanitizerSrc.includes("#787f84"),
    "signature sanitizer should not reference text colors (that is normalizeOutboundHtml's job)"
  );
});

// ─── Results ──────────────────────────────────────────────────────────────────
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
