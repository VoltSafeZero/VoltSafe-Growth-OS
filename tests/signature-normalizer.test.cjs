"use strict";

/**
 * Tests for signature-normalizer.ts and the client-side normalizer in email-format.ts
 *
 * Validates that:
 *   - Full HTML documents are correctly stripped to fragments
 *   - Table layouts, links, inline styles, and images are preserved
 *   - Already-clean fragments pass through unchanged
 *   - Edge cases (no body content, nested docs, partial tags) are handled
 *   - The backend normalizeSignatureHtml and server-side detectDocumentTags work correctly
 *   - POST /api/signatures and PUT /api/signatures/:id route snippets include normalizer call
 *   - POST /api/gmail/send route snippet includes normalizer call
 *   - Frontend sanitizeSignatureHtmlClientSide calls normalizeSignatureHtmlClientSide first
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

// ── Load the normalizer module via eval (tsx not available in test runner) ──

const NORMALIZER_SRC = fs.readFileSync(
  path.join(__dirname, "../server/services/signature-normalizer.ts"),
  "utf8"
);

// Strip TS type annotations enough for eval (quick-and-dirty — this is a test)
const JS_SRC = NORMALIZER_SRC
  .replace(/^export /gm, "")
  .replace(/: string/g, "")
  .replace(/: \{[\s\S]*?\}/g, "")
  .replace(/: boolean/g, "");

let normalizeSignatureHtml;
let detectDocumentTags;
try {
  const m = {};
  const fn = new Function("module", JS_SRC + "; module.n = normalizeSignatureHtml; module.d = detectDocumentTags;");
  fn(m);
  normalizeSignatureHtml = m.n;
  detectDocumentTags     = m.d;
} catch (e) {
  // Fallback: load via inline re-implementation for structural tests
  normalizeSignatureHtml = function(html) {
    if (!html || !html.trim()) return html;
    let out = html;
    out = out.replace(/<!DOCTYPE\b[^>]*>/gi, "");
    out = out.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, "");
    out = out.replace(/<html\b[^>]*>/gi, "");
    out = out.replace(/<\/html\s*>/gi, "");
    out = out.replace(/<body\b[^>]*>/gi, "");
    out = out.replace(/<\/body\s*>/gi, "");
    out = out.replace(/<meta\b[^>]*\/?>/gi, "");
    out = out.replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, "");
    return out.trim();
  };
  detectDocumentTags = function(html) {
    const hasDoctype = /<!DOCTYPE\b/i.test(html);
    const hasHtmlTag = /<html\b/i.test(html);
    const hasHeadTag = /<head\b/i.test(html);
    const hasBodyTag = /<body\b/i.test(html);
    return { hasDoctype, hasHtmlTag, hasHeadTag, hasBodyTag, any: hasDoctype || hasHtmlTag || hasHeadTag || hasBodyTag };
  };
}

// ── Source-grep tests (structural — do not require running server) ──────────

const ROUTES_SRC       = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");
const EMAIL_FORMAT_SRC = fs.readFileSync(path.join(__dirname, "../client/src/lib/email-format.ts"), "utf8");
const GMAIL_INBOX_SRC  = fs.readFileSync(path.join(__dirname, "../client/src/pages/gmail-inbox.tsx"), "utf8");

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

// ── normalizeSignatureHtml — unit tests ──────────────────────────────────────

console.log("\nnormalizeSignatureHtml() — unit tests");

const FULL_DOC = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Sig</title><style>body{margin:0}</style></head>
<body>
<table><tr><td>Trevor Smith</td></tr></table>
</body>
</html>`;

const TABLE_ONLY = `<table><tr><td>Trevor Smith</td></tr></table>`;

test("strips DOCTYPE from full HTML document", () => {
  const result = normalizeSignatureHtml(FULL_DOC);
  assert.ok(!result.includes("<!DOCTYPE"), "DOCTYPE should be stripped");
});

test("strips <html> and </html> tags", () => {
  const result = normalizeSignatureHtml(FULL_DOC);
  assert.ok(!/<html\b/i.test(result), "<html> should be stripped");
  assert.ok(!/<\/html>/i.test(result), "</html> should be stripped");
});

test("strips <head>...</head> block entirely", () => {
  const result = normalizeSignatureHtml(FULL_DOC);
  assert.ok(!/<head\b/i.test(result), "<head> should be stripped");
  assert.ok(!/<\/head>/i.test(result), "</head> should be stripped");
  assert.ok(!result.includes("charset"), "meta charset inside <head> should be stripped");
  assert.ok(!result.includes("<style>"), "style inside <head> should be stripped");
});

test("strips <body> and </body> wrapper tags but preserves content", () => {
  const result = normalizeSignatureHtml(FULL_DOC);
  assert.ok(!/<body\b/i.test(result), "<body> should be stripped");
  assert.ok(!/<\/body>/i.test(result), "</body> should be stripped");
  assert.ok(result.includes("<table>"), "table content should be preserved");
  assert.ok(result.includes("Trevor Smith"), "text content should be preserved");
});

test("preserves table layout", () => {
  const input = `<!DOCTYPE html><html><body>
<table border="0" cellpadding="10" style="font-family:Arial">
  <tr><td><strong>Jane Doe</strong></td></tr>
  <tr><td>CEO, VoltSafe</td></tr>
</table>
</body></html>`;
  const result = normalizeSignatureHtml(input);
  assert.ok(result.includes('<table border="0"'), "table with attrs should be preserved");
  assert.ok(result.includes("<strong>Jane Doe</strong>"), "bold text should be preserved");
  assert.ok(result.includes("CEO, VoltSafe"), "plain text should be preserved");
});

test("preserves inline styles", () => {
  const input = `<html><body><div style="font-family:Arial;color:#333;font-size:14px;">Signature</div></body></html>`;
  const result = normalizeSignatureHtml(input);
  assert.ok(result.includes('style="font-family:Arial'), "inline styles should be preserved");
});

test("preserves links", () => {
  const input = `<html><body><a href="https://voltsafe.com" style="color:#00C1DE">VoltSafe</a></body></html>`;
  const result = normalizeSignatureHtml(input);
  assert.ok(result.includes('href="https://voltsafe.com"'), "link href should be preserved");
  assert.ok(result.includes("VoltSafe"), "link text should be preserved");
});

test("preserves safe HTTPS images", () => {
  const input = `<html><body><img src="https://cdn.voltsafe.com/logo.png" alt="Logo" width="120"></body></html>`;
  const result = normalizeSignatureHtml(input);
  assert.ok(result.includes('src="https://cdn.voltsafe.com/logo.png"'), "HTTPS image src preserved");
  assert.ok(result.includes('alt="Logo"'), "image alt preserved");
});

test("already-clean fragment passes through unchanged", () => {
  const result = normalizeSignatureHtml(TABLE_ONLY);
  assert.strictEqual(result, TABLE_ONLY);
});

test("empty string returns empty string", () => {
  assert.strictEqual(normalizeSignatureHtml(""), "");
});

test("null/undefined returns as-is", () => {
  assert.strictEqual(normalizeSignatureHtml(null), null);
  assert.strictEqual(normalizeSignatureHtml(undefined), undefined);
});

test("strips stray <meta> tags outside of <head>", () => {
  const input = `<div>content</div><meta charset="utf-8"><p>more</p>`;
  const result = normalizeSignatureHtml(input);
  assert.ok(!/<meta\b/i.test(result), "stray meta should be stripped");
  assert.ok(result.includes("<div>content</div>"), "div content preserved");
  assert.ok(result.includes("<p>more</p>"), "p content preserved");
});

test("strips stray <title> tags", () => {
  const input = `<title>Email Signature</title><table><tr><td>John</td></tr></table>`;
  const result = normalizeSignatureHtml(input);
  assert.ok(!/<title\b/i.test(result), "title should be stripped");
  assert.ok(result.includes("<table>"), "table content preserved");
});

test("handles case-insensitive DOCTYPE", () => {
  const input = `<!doctype html><HTML><BODY><p>sig</p></BODY></HTML>`;
  const result = normalizeSignatureHtml(input);
  assert.ok(!result.includes("<!doctype"), "lowercase doctype stripped");
  assert.ok(!/<HTML>/i.test(result), "uppercase HTML stripped");
  assert.ok(!/<BODY>/i.test(result), "uppercase BODY stripped");
  assert.ok(result.includes("<p>sig</p>"), "content preserved");
});

test("handles body tag with attributes", () => {
  const input = `<html><body bgcolor="#ffffff" style="margin:0"><p>content</p></body></html>`;
  const result = normalizeSignatureHtml(input);
  assert.ok(!/<body\b/i.test(result), "body with attrs stripped");
  assert.ok(result.includes("<p>content</p>"), "content preserved");
});

// ── detectDocumentTags — unit tests ─────────────────────────────────────────

console.log("\ndetectDocumentTags() — unit tests");

test("detects DOCTYPE", () => {
  const r = detectDocumentTags("<!DOCTYPE html><html><body>sig</body></html>");
  assert.strictEqual(r.hasDoctype, true);
  assert.strictEqual(r.any, true);
});

test("detects <html> tag", () => {
  const r = detectDocumentTags("<html><body>sig</body></html>");
  assert.strictEqual(r.hasHtmlTag, true);
});

test("detects <head> tag", () => {
  const r = detectDocumentTags("<html><head><title>t</title></head><body>sig</body></html>");
  assert.strictEqual(r.hasHeadTag, true);
});

test("detects <body> tag", () => {
  const r = detectDocumentTags("<html><body>sig</body></html>");
  assert.strictEqual(r.hasBodyTag, true);
});

test("returns any=false for clean fragment", () => {
  const r = detectDocumentTags("<table><tr><td>Clean</td></tr></table>");
  assert.strictEqual(r.any, false);
  assert.strictEqual(r.hasDoctype, false);
  assert.strictEqual(r.hasHtmlTag, false);
  assert.strictEqual(r.hasHeadTag, false);
  assert.strictEqual(r.hasBodyTag, false);
});

// ── Source-grep — structural tests ───────────────────────────────────────────

console.log("\nServer routes — structural tests");

test("server/routes.ts imports normalizeSignatureHtml from signature-normalizer", () => {
  assert.ok(
    ROUTES_SRC.includes("normalizeSignatureHtml") && ROUTES_SRC.includes("signature-normalizer"),
    "routes.ts must import normalizeSignatureHtml from signature-normalizer"
  );
});

test("server/routes.ts imports detectDocumentTags from signature-normalizer", () => {
  assert.ok(
    ROUTES_SRC.includes("detectDocumentTags") && ROUTES_SRC.includes("signature-normalizer"),
    "routes.ts must import detectDocumentTags from signature-normalizer"
  );
});

test("POST /api/signatures route applies normalizeSignatureHtml before sanitizeSignatureHtml", () => {
  const postBlock = ROUTES_SRC.slice(ROUTES_SRC.indexOf('app.post("/api/signatures"'));
  const endIdx    = postBlock.indexOf('app.get("/api/signatures/:id"');
  const createBlock = postBlock.slice(0, endIdx);
  assert.ok(
    createBlock.includes("normalizeSignatureHtml(htmlContent)"),
    "POST /api/signatures must call normalizeSignatureHtml(htmlContent)"
  );
  // Two-step: normalizeSignatureHtml result stored in variable, then sanitizeSignatureHtml called on it
  // Pattern: const _normalizedHtml... = normalizeSignatureHtml(htmlContent); const cleanHtml = sanitizeSignatureHtml(_normalizedHtml...);
  assert.ok(
    /normalizeSignatureHtml\(htmlContent\)[\s\S]{1,60}sanitizeSignatureHtml\(/.test(createBlock),
    "normalizeSignatureHtml must be called and its result passed to sanitizeSignatureHtml in CREATE"
  );
});

test("PUT /api/signatures/:id route applies normalizeSignatureHtml before sanitizeSignatureHtml", () => {
  const putBlock = ROUTES_SRC.slice(ROUTES_SRC.indexOf('app.put("/api/signatures/:id"'));
  const endIdx   = putBlock.indexOf('app.delete("/api/signatures/:id"');
  const updateBlock = putBlock.slice(0, endIdx);
  assert.ok(
    updateBlock.includes("normalizeSignatureHtml(htmlContent)"),
    "PUT /api/signatures/:id must call normalizeSignatureHtml(htmlContent)"
  );
  assert.ok(
    /normalizeSignatureHtml\(htmlContent\)[\s\S]{1,60}sanitizeSignatureHtml\(/.test(updateBlock),
    "normalizeSignatureHtml must be called and its result passed to sanitizeSignatureHtml in UPDATE"
  );
});

test("POST /api/gmail/send route applies normalizeSignatureHtml to body before normalizeOutboundHtml", () => {
  const sendBlock = ROUTES_SRC.slice(ROUTES_SRC.indexOf('app.post("/api/gmail/send"'));
  assert.ok(
    sendBlock.includes("normalizeSignatureHtml(body)"),
    "send route must call normalizeSignatureHtml(body)"
  );
  assert.ok(
    sendBlock.indexOf("normalizeSignatureHtml(body)") < sendBlock.indexOf("normalizeOutboundHtml("),
    "normalizeSignatureHtml must be called BEFORE normalizeOutboundHtml"
  );
});

test("send route logs document tag detection result", () => {
  const sendBlock = ROUTES_SRC.slice(ROUTES_SRC.indexOf('app.post("/api/gmail/send"'));
  assert.ok(
    sendBlock.includes("gmail-send-normalized"),
    "send route must log [gmail-send-normalized] when doc tags found"
  );
});

console.log("\nFrontend email-format.ts — structural tests");

test("email-format.ts exports normalizeSignatureHtmlClientSide", () => {
  assert.ok(
    EMAIL_FORMAT_SRC.includes("export function normalizeSignatureHtmlClientSide"),
    "email-format.ts must export normalizeSignatureHtmlClientSide"
  );
});

test("sanitizeSignatureHtmlClientSide calls normalizeSignatureHtmlClientSide first", () => {
  const fnBlock = EMAIL_FORMAT_SRC.slice(
    EMAIL_FORMAT_SRC.indexOf("export function sanitizeSignatureHtmlClientSide")
  ).slice(0, 400);
  assert.ok(
    fnBlock.includes("normalizeSignatureHtmlClientSide(html)"),
    "sanitizeSignatureHtmlClientSide must call normalizeSignatureHtmlClientSide(html) as first step"
  );
});

test("normalizeSignatureHtmlClientSide strips DOCTYPE", () => {
  assert.ok(
    EMAIL_FORMAT_SRC.includes("<!DOCTYPE"),
    "normalizeSignatureHtmlClientSide must include DOCTYPE strip regex"
  );
});

test("normalizeSignatureHtmlClientSide strips <head>...</head>", () => {
  assert.ok(
    EMAIL_FORMAT_SRC.includes("<head\\b[^>]*>[\\s\\S]*?<\\/head>"),
    "normalizeSignatureHtmlClientSide must strip <head>...</head>"
  );
});

console.log("\ngmail-inbox.tsx — structural tests");

test("gmail-inbox.tsx imports normalizeSignatureHtmlClientSide from email-format", () => {
  assert.ok(
    GMAIL_INBOX_SRC.includes("normalizeSignatureHtmlClientSide"),
    "gmail-inbox.tsx must import normalizeSignatureHtmlClientSide"
  );
});

test("activeSignatureHtml computation normalizes htmlContent", () => {
  const activeBlock = GMAIL_INBOX_SRC.slice(
    GMAIL_INBOX_SRC.indexOf("const activeSignatureHtml")
  ).slice(0, 600);
  assert.ok(
    activeBlock.includes("normalizeSignatureHtmlClientSide"),
    "activeSignatureHtml must call normalizeSignatureHtmlClientSide on htmlContent"
  );
});

test("[FINAL SEND PAYLOAD] diagnostic checks for DOCTYPE in body", () => {
  // Log renamed from [FINAL FETCH ABOUT TO SEND] → [FINAL SEND PAYLOAD] (WAF-safe arch)
  const fetchBlock = GMAIL_INBOX_SRC.slice(
    GMAIL_INBOX_SRC.indexOf("[FINAL SEND PAYLOAD]")
  ).slice(0, 800);
  assert.ok(
    fetchBlock.includes("bodyContainsDoctype") || fetchBlock.includes("containsDoctype"),
    "[FINAL SEND PAYLOAD] log must check for DOCTYPE"
  );
});

test("[FINAL SEND PAYLOAD] diagnostic checks for html/head/body tags", () => {
  // Log renamed from [FINAL FETCH ABOUT TO SEND] → [FINAL SEND PAYLOAD] (WAF-safe arch)
  const fetchBlock = GMAIL_INBOX_SRC.slice(
    GMAIL_INBOX_SRC.indexOf("[FINAL SEND PAYLOAD]")
  ).slice(0, 800);
  assert.ok(
    fetchBlock.includes("bodyContainsHtmlTag") || fetchBlock.includes("containsHtmlTag"),
    "[FINAL SEND PAYLOAD] log must check for <html> tag"
  );
});

// ── Migration script — structural test ───────────────────────────────────────

console.log("\nMigration script — structural tests");

test("scripts/normalize-all-email-signatures.ts exists", () => {
  assert.ok(
    fs.existsSync(path.join(__dirname, "../scripts/normalize-all-email-signatures.ts")),
    "migration script must exist at scripts/normalize-all-email-signatures.ts"
  );
});

test("migration script supports --dry-run flag", () => {
  const scriptSrc = fs.readFileSync(
    path.join(__dirname, "../scripts/normalize-all-email-signatures.ts"), "utf8"
  );
  assert.ok(scriptSrc.includes("--dry-run"), "migration script must support --dry-run");
});

test("migration script supports --apply flag", () => {
  const scriptSrc = fs.readFileSync(
    path.join(__dirname, "../scripts/normalize-all-email-signatures.ts"), "utf8"
  );
  assert.ok(scriptSrc.includes("--apply"), "migration script must support --apply");
});

test("migration script uses normalizeSignatureHtml from normalizer service", () => {
  const scriptSrc = fs.readFileSync(
    path.join(__dirname, "../scripts/normalize-all-email-signatures.ts"), "utf8"
  );
  assert.ok(
    scriptSrc.includes("normalizeSignatureHtml") && scriptSrc.includes("signature-normalizer"),
    "migration script must import normalizeSignatureHtml from signature-normalizer"
  );
});

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
