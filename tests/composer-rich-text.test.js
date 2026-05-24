/**
 * tests/composer-rich-text.test.js
 *
 * Regression tests for the email composer rich-text formatting pipeline.
 *
 * Covers:
 *   1. URL normalization (normalizeUrl)
 *   2. sanitizeEditorHtml via buildEmailHtml — HTML in → styled HTML out
 *   3. No markdown markers leak through
 *   4. Link anchor tag structure (target, rel, VoltSafe colour)
 *   5. Content integrity — existing body not corrupted by formatting
 *   6. Toolbar structural invariants (source-grep style)
 *
 * Run with: node tests/composer-rich-text.test.js
 */

import { spawnSync } from "child_process";
import { writeFileSync, readFileSync } from "fs";

const cwd = process.cwd();

// ── Source-grep structural tests ──────────────────────────────────────────────
// These pin the shape of the toolbar and editor without running a browser.

let structPassed = 0;
let structFailed = 0;

function structTest(name, fn) {
  try { fn(); console.log("  ✓", name); structPassed++; }
  catch (e) { console.log("  ✗", name, "→", e.message); structFailed++; }
}

function assertContains(source, pattern, msg) {
  const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  if (!regex.test(source)) throw new Error(msg || `Expected to find: ${regex}`);
}

function assertNotContains(source, pattern, msg) {
  const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  if (regex.test(source)) throw new Error(msg || `Expected NOT to find: ${regex}`);
}

console.log("\n=== Structural: composer (gmail-inbox.tsx) ===");

const composerSrc = readFileSync(`${cwd}/client/src/pages/gmail-inbox.tsx`, "utf-8");

structTest("bodyRef typed as HTMLDivElement (not HTMLTextAreaElement)", () => {
  assertContains(composerSrc, /useRef<HTMLDivElement/,
    "bodyRef must use HTMLDivElement ref type");
  assertNotContains(composerSrc, /useRef<HTMLTextAreaElement/,
    "HTMLTextAreaElement ref must be gone from bodyRef");
});

structTest("editor uses contentEditable, not <textarea>", () => {
  assertContains(composerSrc, /contentEditable/,
    "editor div must have contentEditable prop");
  // The compose body textarea should not exist any more
  const textareaAtBodyTest = /data-testid="input-email-body"[^>]*\/>|<textarea[^>]+input-email-body/;
  // Check there's no raw <textarea with the body testid
  const bodyTextarea = composerSrc.match(/<textarea[^>]+input-email-body/);
  if (bodyTextarea) throw new Error("Found <textarea data-testid=input-email-body — should be a <div contentEditable>");
});

structTest("applyFormatToEditor imported (not applyFormatToTextarea)", () => {
  assertContains(composerSrc, /applyFormatToEditor/,
    "applyFormatToEditor must be imported and used");
  assertNotContains(composerSrc, /applyFormatToTextarea/,
    "applyFormatToTextarea must not be used in the compose dialog");
});

structTest("savedRangeRef present for link selection preservation", () => {
  assertContains(composerSrc, /savedRangeRef/,
    "savedRangeRef must be defined for link-flow selection preservation");
});

structTest("handleBeforeLinkOpen callback defined", () => {
  assertContains(composerSrc, /handleBeforeLinkOpen/,
    "handleBeforeLinkOpen callback must be defined");
});

structTest("onBeforeLinkOpen passed to EmailFormatToolbar", () => {
  assertContains(composerSrc, /EmailFormatToolbar[^>]*onBeforeLinkOpen/,
    "EmailFormatToolbar must receive onBeforeLinkOpen prop");
});

structTest("htmlToCleanHtml imported (not htmlToEditorText)", () => {
  assertContains(composerSrc, /htmlToCleanHtml/,
    "htmlToCleanHtml must be imported for paste normalization");
});

console.log("\n=== Structural: toolbar (email-format-toolbar.tsx) ===");

const toolbarSrc = readFileSync(`${cwd}/client/src/components/inbox/email-format-toolbar.tsx`, "utf-8");

structTest("onBeforeLinkOpen prop declared", () => {
  assertContains(toolbarSrc, /onBeforeLinkOpen/,
    "onBeforeLinkOpen prop must be declared in EmailFormatToolbarProps");
});

structTest("onBeforeLinkOpen called before popover opens", () => {
  assertContains(toolbarSrc, /onBeforeLinkOpen\?\.\(\)/,
    "onBeforeLinkOpen must be called before the popover opens");
});

structTest("normalizeUrl imported and used for link submission", () => {
  assertContains(toolbarSrc, /normalizeUrl/,
    "normalizeUrl must be imported and used in the toolbar");
});

console.log("\n=== Structural: email-format-library (email-format.ts) ===");

const formatSrc = readFileSync(`${cwd}/client/src/lib/email-format.ts`, "utf-8");

structTest("normalizeUrl exported", () => {
  assertContains(formatSrc, /export function normalizeUrl/,
    "normalizeUrl must be an exported function");
});

structTest("htmlToCleanHtml exported", () => {
  assertContains(formatSrc, /export function htmlToCleanHtml/,
    "htmlToCleanHtml must be an exported function");
});

structTest("buildEmailHtml no longer calls markdownToHtml", () => {
  assertNotContains(formatSrc, /markdownToHtml/,
    "markdownToHtml should be removed — buildEmailHtml now handles HTML input");
});

structTest("sanitizeEditorHtml strips style= attributes", () => {
  assertContains(formatSrc, /style="\[/,
    "sanitizeEditorHtml must have a regex to strip style= attributes");
});

structTest("inbox-actions-store exports applyFormatToEditor", () => {
  const storeSrc = readFileSync(`${cwd}/client/src/components/inbox/inbox-actions-store.ts`, "utf-8");
  assertContains(storeSrc, /export function applyFormatToEditor/,
    "applyFormatToEditor must be exported from inbox-actions-store");
});

structTest("inbox-actions-store: execCommand bold used", () => {
  const storeSrc = readFileSync(`${cwd}/client/src/components/inbox/inbox-actions-store.ts`, "utf-8");
  assertContains(storeSrc, /execCommand\("bold"/,
    "execCommand('bold') must be used in applyFormatToEditor");
});

structTest("inbox-actions-store: createLink used for link command", () => {
  const storeSrc = readFileSync(`${cwd}/client/src/components/inbox/inbox-actions-store.ts`, "utf-8");
  assertContains(storeSrc, /execCommand\("createLink"/,
    "execCommand('createLink') must be used for the link command");
});

console.log(`\nStructural: ${structPassed} passed, ${structFailed} failed`);

// ── Unit tests (run via tsx) ───────────────────────────────────────────────────

const testScript = `
import { buildEmailHtml, normalizeUrl } from "${cwd}/client/src/lib/email-format.ts";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log("  ✓", name); passed++; }
  catch(e) { console.log("  ✗", name); console.log("    →", e.message); failed++; }
}
function contains(haystack, needle) {
  if (!haystack.includes(needle)) throw new Error(
    "Expected to contain: " + JSON.stringify(needle) + "\\nIn: " + haystack.slice(0, 600)
  );
}
function notContains(haystack, needle) {
  if (haystack.includes(needle)) throw new Error(
    "Expected NOT to contain: " + JSON.stringify(needle) + "\\nIn: " + haystack.slice(0, 400)
  );
}

console.log("\\n=== normalizeUrl ===");

test("bare domain gets https:// prefix", () => {
  const url = normalizeUrl("voltsafe.com");
  if (url !== "https://voltsafe.com") throw new Error("Got: " + url);
});

test("https:// URL passes through unchanged", () => {
  const url = normalizeUrl("https://voltsafe.com");
  if (url !== "https://voltsafe.com") throw new Error("Got: " + url);
});

test("http:// URL passes through unchanged", () => {
  const url = normalizeUrl("http://example.com/path?q=1");
  if (url !== "http://example.com/path?q=1") throw new Error("Got: " + url);
});

test("mailto: passes through unchanged", () => {
  const url = normalizeUrl("mailto:hello@example.com");
  if (url !== "mailto:hello@example.com") throw new Error("Got: " + url);
});

test("subdomain.domain.com gets https:// prefix", () => {
  const url = normalizeUrl("app.voltsafe.com/login");
  if (url !== "https://app.voltsafe.com/login") throw new Error("Got: " + url);
});

test("empty string returns empty string", () => {
  const url = normalizeUrl("");
  if (url !== "") throw new Error("Got: " + url);
});

test("whitespace-only string returns empty string", () => {
  const url = normalizeUrl("   ");
  if (url !== "") throw new Error("Got: " + url);
});

console.log("\\n=== buildEmailHtml — HTML input ===");

test("bold HTML passes through as <b>", () => {
  const html = buildEmailHtml("<b>bold text</b>");
  contains(html, "<b>bold text</b>");
  notContains(html, "**");
});

test("italic HTML passes through as <i>", () => {
  const html = buildEmailHtml("<i>italic text</i>");
  contains(html, "<i>italic text</i>");
  notContains(html, "*italic*");
});

test("underline HTML passes through as <u>", () => {
  const html = buildEmailHtml("<u>underlined</u>");
  contains(html, "<u>underlined</u>");
  notContains(html, "&lt;u&gt;");
});

test("plain text passes through without markdown conversion", () => {
  const html = buildEmailHtml("Hello world");
  contains(html, "Hello world");
  notContains(html, "**");
});

test("anchor tag gets target=_blank and rel=noopener", () => {
  const html = buildEmailHtml('<a href="https://voltsafe.com">VoltSafe</a>');
  contains(html, 'href="https://voltsafe.com"');
  contains(html, 'target="_blank"');
  contains(html, 'rel="noopener noreferrer"');
  contains(html, ">VoltSafe<");
  notContains(html, "[VoltSafe](");
});

test("anchor tag gets VoltSafe link colour", () => {
  const html = buildEmailHtml('<a href="https://voltsafe.com">link</a>');
  contains(html, "color:#00C1DE");
});

test("unordered list preserved", () => {
  const html = buildEmailHtml("<ul><li>Apple</li><li>Banana</li></ul>");
  contains(html, "<ul");
  contains(html, "<li>Apple</li>");
  contains(html, "<li>Banana</li>");
});

test("ordered list preserved", () => {
  const html = buildEmailHtml("<ol><li>First</li><li>Second</li></ol>");
  contains(html, "<ol");
  contains(html, "<li>First</li>");
});

test("VoltSafe body style wrapper present", () => {
  const html = buildEmailHtml("<b>Hi</b>");
  contains(html, "font-family:Arial");
  contains(html, "font-size:14px");
});

test("appendHtml appears after body", () => {
  const sig = '<div class="sig">-- Trevor</div>';
  const html = buildEmailHtml("Hello", sig);
  const bodyIdx = html.indexOf("Hello");
  const sigIdx = html.indexOf("-- Trevor");
  if (bodyIdx >= sigIdx) throw new Error("Signature must appear after body. Got: " + html.slice(0, 300));
});

test("empty body produces valid wrapper", () => {
  const html = buildEmailHtml("");
  contains(html, "font-family:Arial");
});

test("style= attributes on editor spans are stripped", () => {
  const html = buildEmailHtml('<span style="font-weight:bold;">text</span>');
  notContains(html, 'style="font-weight');
  contains(html, "text");
});

test("class= attributes are stripped", () => {
  const html = buildEmailHtml('<p class="MsoNormal">paragraph</p>');
  notContains(html, 'class="MsoNormal"');
  contains(html, "paragraph");
});

test("bold+italic together preserved", () => {
  const html = buildEmailHtml("<b>bold</b> and <i>italic</i>");
  contains(html, "<b>bold</b>");
  contains(html, "<i>italic</i>");
});

test("no markdown markers in HTML-input output", () => {
  const html = buildEmailHtml("<b>bold</b> normal <i>italic</i>");
  notContains(html, "**");
  notContains(html, "~~");
  notContains(html, "[label](");
});

console.log("\\n" + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
`;

const tmpFile = "/tmp/composer-rich-text-test.ts";
writeFileSync(tmpFile, testScript);

const result = spawnSync("npx", ["tsx", tmpFile], {
  encoding: "utf-8",
  cwd: process.cwd(),
});
process.stdout.write(result.stdout || "");
if (result.stderr) process.stderr.write(result.stderr);

const unitExitCode = result.status ?? 0;
const structExitCode = structFailed > 0 ? 1 : 0;
process.exit(unitExitCode || structExitCode);
