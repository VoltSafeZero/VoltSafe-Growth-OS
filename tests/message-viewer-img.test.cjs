"use strict";
/**
 * tests/message-viewer-img.test.cjs
 *
 * Source-grep tests for the email message viewer image rendering fix.
 *
 * Verifies that:
 *  1. sanitize-html.ts extends DOMPurify's ALLOWED_URI_REGEXP to pass
 *     data:image/(png|jpeg|jpg|gif|webp|svg+xml) URIs through.
 *  2. sanitizeEmailHtml passes ALLOWED_URI_REGEXP to DOMPurify.
 *  3. All safe URI types are preserved (https, data:image, cid proxy).
 *  4. Dangerous URI types are still blocked (data:text, data:application, javascript:).
 *  5. The MessageBody useMemo in gmail-inbox.tsx adds diagnostic logging.
 *  6. The cid: proxy rewrite still runs before sanitization.
 */

const fs   = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function ok(label)           { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail) { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
function check(label, cond, detail) { cond ? ok(label) : fail(label, detail); }

const sanitizeTs   = fs.readFileSync(path.join(__dirname, "../client/src/lib/sanitize-html.ts"),  "utf8");
const inboxTsx     = fs.readFileSync(path.join(__dirname, "../client/src/pages/gmail-inbox.tsx"), "utf8");

console.log("\n=== Message Viewer Image Rendering Tests ===\n");

// ── 1. sanitize-html.ts — EMAIL_ALLOWED_URI_REGEXP ────────────────────────────
console.log("── 1. sanitize-html.ts — ALLOWED_URI_REGEXP ──");

check(
  "EMAIL_ALLOWED_URI_REGEXP constant declared",
  sanitizeTs.includes("EMAIL_ALLOWED_URI_REGEXP")
);

check(
  "Allows data:image/png",
  sanitizeTs.includes("data:image") && sanitizeTs.includes("png")
);

check(
  "Allows data:image/jpeg",
  sanitizeTs.includes("jpeg")
);

check(
  "Allows data:image/gif",
  sanitizeTs.includes("gif")
);

check(
  "Allows data:image/webp",
  sanitizeTs.includes("webp")
);

check(
  "Allows data:image/svg+xml",
  sanitizeTs.includes("svg") && (sanitizeTs.includes("svg\\+xml") || sanitizeTs.includes("svg+xml"))
);

check(
  "Regex anchored to start of URI (^ present)",
  (() => {
    const re = sanitizeTs.slice(sanitizeTs.indexOf("EMAIL_ALLOWED_URI_REGEXP"), sanitizeTs.indexOf("EMAIL_ALLOWED_URI_REGEXP") + 400);
    return re.includes("/^");
  })()
);

check(
  "data:image subtype separator [;,] present (prevents data:image/png.exe bypass)",
  sanitizeTs.includes("[;,]") || sanitizeTs.includes("[;,]")
);

// ── 2. sanitizeEmailHtml passes ALLOWED_URI_REGEXP to DOMPurify ───────────────
console.log("\n── 2. sanitizeEmailHtml — DOMPurify config ──");

check(
  "sanitizeEmailHtml passes ALLOWED_URI_REGEXP option",
  (() => {
    const fn = sanitizeTs.slice(sanitizeTs.indexOf("export function sanitizeEmailHtml("));
    return fn.includes("ALLOWED_URI_REGEXP");
  })()
);

check(
  "ALLOWED_URI_REGEXP references EMAIL_ALLOWED_URI_REGEXP",
  (() => {
    const fn = sanitizeTs.slice(sanitizeTs.indexOf("export function sanitizeEmailHtml("));
    return fn.includes("EMAIL_ALLOWED_URI_REGEXP");
  })()
);

check(
  "sanitizeRichText does NOT pass ALLOWED_URI_REGEXP (stricter — no data:image needed)",
  (() => {
    const start = sanitizeTs.indexOf("export function sanitizeRichText(");
    const end   = sanitizeTs.indexOf("export function", start + 1);
    const fn    = sanitizeTs.slice(start, end === -1 ? start + 500 : end);
    return !fn.includes("ALLOWED_URI_REGEXP");
  })()
);

// ── 3. gmail-inbox.tsx — MessageBody preprocessing ────────────────────────────
console.log("\n── 3. gmail-inbox.tsx — MessageBody preprocessing ──");

check(
  "cid: proxy rewrite still present before sanitizeEmailHtml",
  inboxTsx.includes("src=\"cid:") || inboxTsx.includes('src="cid:') ||
  inboxTsx.includes("cid-image/")
);

check(
  "cid: rewrite runs only when gmailMessageId is provided",
  inboxTsx.includes("gmailMessageId") && inboxTsx.includes("cid-image/")
);

check(
  "Diagnostic logging block uses [message-viewer-img] prefix",
  inboxTsx.includes("[message-viewer-img]")
);

check(
  "Diagnostic logs originalSrc",
  inboxTsx.includes("originalSrc")
);

check(
  "Diagnostic logs finalSrc",
  inboxTsx.includes("finalSrc")
);

check(
  "Diagnostic logs allowed flag",
  inboxTsx.includes("allowed=")
);

check(
  "Diagnostic logs reason",
  inboxTsx.includes("reason=")
);

check(
  "Diagnostic gated by DEV or __VS_IMG_DEBUG__ flag (not always-on)",
  inboxTsx.includes("__VS_IMG_DEBUG__") || inboxTsx.includes("import.meta.env.DEV")
);

// ── 4. Functional: ALLOWED_URI_REGEXP pattern correctness ─────────────────────
console.log("\n── 4. Functional: URI regex pattern correctness ──");

// Extract the EMAIL_ALLOWED_URI_REGEXP value from the source.
let uriRegex = null;
try {
  const m = sanitizeTs.match(/EMAIL_ALLOWED_URI_REGEXP\s*=\s*(\/(?:[^/\\]|\\.)+\/[gimsuy]*)/);
  if (m) {
    uriRegex = eval(m[1]); // eslint-disable-line no-eval
  }
} catch (_) {}

if (!uriRegex) {
  fail("EMAIL_ALLOWED_URI_REGEXP could not be extracted for functional tests", "check regex literal format");
} else {
  const cases = [
    // Should pass
    { uri: "https://example.com/logo.png",               expect: true,  label: "https:// URL passes" },
    { uri: "http://cdn.example.com/img.jpg",              expect: true,  label: "http:// URL passes" },
    { uri: "data:image/png;base64,iVBORw0KGgo=",         expect: true,  label: "data:image/png;base64 passes" },
    { uri: "data:image/jpeg;base64,/9j/4AAQ=",           expect: true,  label: "data:image/jpeg;base64 passes" },
    { uri: "data:image/gif;base64,R0lGOD=",              expect: true,  label: "data:image/gif;base64 passes" },
    { uri: "data:image/webp;base64,UklGR=",              expect: true,  label: "data:image/webp;base64 passes" },
    { uri: "data:image/svg+xml;base64,PHN2Z=",           expect: true,  label: "data:image/svg+xml;base64 passes" },
    { uri: "/api/gmail/messages/abc/cid-image/vsig1",    expect: true,  label: "cid proxy path (relative) passes" },
    { uri: "cid:vsig1abc",                               expect: true,  label: "cid: URI passes (for cid: allowlist)" },
    // Should fail
    { uri: "javascript:alert(1)",                        expect: false, label: "javascript: blocked" },
    { uri: "data:text/html,<script>alert(1)</script>",   expect: false, label: "data:text/html blocked" },
    { uri: "data:application/javascript,alert(1)",       expect: false, label: "data:application/js blocked" },
    { uri: "vbscript:msgbox(1)",                         expect: false, label: "vbscript: blocked" },
  ];

  for (const { uri, expect: shouldPass, label } of cases) {
    const result = uriRegex.test(uri);
    check(label, result === shouldPass,
      `expected ${shouldPass ? "PASS" : "BLOCK"} but got ${result ? "PASS" : "BLOCK"} for "${uri}"`
    );
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n──────────────────────────────────────────────────");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
