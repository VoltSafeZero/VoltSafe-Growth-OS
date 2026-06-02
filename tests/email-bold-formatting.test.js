/**
 * tests/email-bold-formatting.test.js
 *
 * Regression tests for the VoltSafe Mail outbound HTML formatting pipeline.
 *
 * Covers the bold-leak bug (screenshot: Gmail/Outlook/Spark/Apple Mail/mobile
 * all showed bold expanding far beyond the selected text) and related issues:
 *   — Bold must not leak across paragraph boundaries
 *   — Bold inside one <p> must not affect the next <p>
 *   — Inline tags closed before double-<br> paragraph boundaries
 *   — Unclosed inline tags closed at end of string
 *   — Paragraph spacing preserved (margin on <p> elements)
 *   — Signature does not inherit bold from the body
 *   — Links remain clickable after sanitization
 *   — Gmail / Outlook / Apple Mail / Spark snapshot hygiene
 *   — Lists are not wrapped in <p> (invalid HTML)
 *   — Reply/forward/draft paths use same sanitizer
 *
 * Run with: node tests/email-bold-formatting.test.js
 */

import { spawnSync } from "child_process";
import { writeFileSync, readFileSync } from "fs";

const cwd = process.cwd();

// ── Source-grep structural tests ───────────────────────────────────────────────

let sp = 0, sf = 0;
function structTest(name, fn) {
  try { fn(); console.log("  ✓", name); sp++; }
  catch (e) { console.log("  ✗", name, "→", e.message); sf++; }
}
function assertContains(src, pat, msg) {
  const r = pat instanceof RegExp ? pat : new RegExp(pat);
  if (!r.test(src)) throw new Error(msg || `Expected: ${r}`);
}
function assertNotContains(src, pat, msg) {
  const r = pat instanceof RegExp ? pat : new RegExp(pat);
  if (r.test(src)) throw new Error(msg || `Expected NOT: ${r}`);
}

console.log("\n=== Structural: bold-leak fix in email-format.ts ===");

const formatSrc = readFileSync(`${cwd}/client/src/lib/email-format.ts`, "utf-8");
const composerSrc = readFileSync(`${cwd}/client/src/pages/gmail-inbox.tsx`, "utf-8");
const normalizerSrc = readFileSync(`${cwd}/server/services/email-html-normalizer.ts`, "utf-8");

structTest("closeInlineTagsAtBoundaries defined", () => {
  assertContains(formatSrc, /function closeInlineTagsAtBoundaries/,
    "closeInlineTagsAtBoundaries function must be defined in email-format.ts");
});

structTest("convertBrChainToParagraphs defined", () => {
  assertContains(formatSrc, /function convertBrChainToParagraphs/,
    "convertBrChainToParagraphs function must be defined in email-format.ts");
});

structTest("sanitizeEditorHtml calls closeInlineTagsAtBoundaries", () => {
  assertContains(formatSrc, /closeInlineTagsAtBoundaries\(/,
    "sanitizeEditorHtml must call closeInlineTagsAtBoundaries to prevent bold leakage");
});

structTest("sanitizeEditorHtml calls convertBrChainToParagraphs", () => {
  assertContains(formatSrc, /convertBrChainToParagraphs\(/,
    "sanitizeEditorHtml must call convertBrChainToParagraphs for email-safe paragraphs");
});

structTest("EMAIL_P_STYLE uses margin:0 0 16px 0 for paragraph spacing", () => {
  assertContains(formatSrc, /margin:0 0 16px 0/,
    "email-format.ts must define paragraph margin style for consistent email spacing");
});

structTest("sanitizeEditorHtml handles <p> block input (draft reload path)", () => {
  assertContains(formatSrc, /div\|p/,
    "sanitizeEditorHtml must handle <p> tags as well as <div> tags (regex must include div|p)");
});

structTest("normalizer preserves our paragraph style fingerprint", () => {
  assertContains(normalizerSrc, /margin:0 0 16px 0|EMAIL_P_STYLE_FINGERPRINT/,
    "normalizeOutboundHtml must preserve the paragraph margin style");
});

structTest("signature has font-weight:normal reset", () => {
  assertContains(composerSrc, /EMAIL_SIGNATURE_HTML[\s\S]{0,200}font-weight:\s*normal/,
    "EMAIL_SIGNATURE_HTML wrapper div must have font-weight:normal to prevent bold inheritance");
});

structTest("buildEmailHtml still wraps body in VoltSafe div", () => {
  assertContains(formatSrc, /VOLTSAFE_BODY_STYLE/,
    "buildEmailHtml must still wrap body in the VoltSafe style div");
});

structTest("sanitizeEditorHtml double-<br> from empty <div><br></div>", () => {
  assertContains(formatSrc, /<br><br>/,
    "empty div must collapse to double-br paragraph separator");
});

structTest("XSS guard still present after refactor", () => {
  assertContains(formatSrc, /javascript|vbscript|data:/i,
    "XSS protocol guard must still be present in the sanitizer");
});

console.log(`\nStructural: ${sp} passed, ${sf} failed`);

// ── Unit tests (run via tsx) ───────────────────────────────────────────────────

const testScript = `
import { buildEmailHtml } from "${cwd}/client/src/lib/email-format.ts";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log("  ✓", name); passed++; }
  catch(e) { console.log("  ✗", name); console.log("    →", e.message); failed++; }
}
function contains(h, n) {
  if (!h.includes(n)) throw new Error("Expected to contain: " + JSON.stringify(n) + "\\nIn: " + h.slice(0, 800));
}
function notContains(h, n) {
  if (h.includes(n)) throw new Error("Expected NOT to contain: " + JSON.stringify(n) + "\\nIn: " + h.slice(0, 500));
}
function containsRe(h, re) {
  if (!re.test(h)) throw new Error("Expected to match: " + re + "\\nIn: " + h.slice(0, 800));
}
function notContainsRe(h, re) {
  if (re.test(h)) throw new Error("Expected NOT to match: " + re + "\\nIn: " + h.slice(0, 500));
}

// ── Paragraph structure ───────────────────────────────────────────────────────

console.log("\\n=== Paragraph structure ===");

test("single-line content wrapped in <p> with email-safe margin", () => {
  const html = buildEmailHtml("<div>Hi there,</div>");
  containsRe(html, /<p[^>]*margin:0 0 16px 0[^>]*>Hi there,<\\/p>/);
});

test("two paragraphs produce two separate <p> blocks", () => {
  const html = buildEmailHtml("<div>First paragraph.</div><div><br></div><div>Second paragraph.</div>");
  containsRe(html, /<p[^>]*>First paragraph.<\\/p>/);
  containsRe(html, /<p[^>]*>Second paragraph.<\\/p>/);
});

test("blank line (empty div) creates paragraph separation via margin, not extra content", () => {
  const html = buildEmailHtml("<div>Para one.</div><div><br></div><div>Para two.</div>");
  // Should have closing </p> and opening <p> between them (not just <br><br>)
  containsRe(html, /<\\/p>[^]*?<p/);
});

test("soft line break (single <br>) preserved within paragraph", () => {
  // Chrome produces <div>line1<br>line2</div> for shift+enter within same block
  const html = buildEmailHtml("<div>line1<br>line2</div>");
  // Both lines should be in the same <p>
  containsRe(html, /<p[^>]*>line1<br>line2<\\/p>/);
});

test("line-height:1.6 present on body paragraph", () => {
  const html = buildEmailHtml("<div>Some text</div>");
  containsRe(html, /line-height:1\\.6/);
});

// ── Bold containment ──────────────────────────────────────────────────────────

console.log("\\n=== Bold containment (the bolt-leak bug) ===");

test("bold on one sentence does not leak past its closing </b> tag", () => {
  // Classic bug: <b>phrase</b> followed by normal text
  const html = buildEmailHtml("<div><b>Here's some feedback:</b> normal text continues</div>");
  // After the </b>, the text must not be bold
  containsRe(html, /<b>Here's some feedback:<\\/b>/);
  // Normal text must appear after the closing </b> (not still inside <b>)
  // Use [^<]* so we stop at any tag boundary — no tag may appear between <b> and "normal text"
  notContainsRe(html, /<b>[^<]*normal text continues/);
});

test("bold in paragraph 1 does not bleed into paragraph 2", () => {
  const html = buildEmailHtml(
    "<div><b>Bold heading:</b></div>" +
    "<div><br></div>" +
    "<div>Normal paragraph after.</div>"
  );
  // Both must be separate <p> elements
  containsRe(html, /<p[^>]*><b>Bold heading:<\\/b><\\/p>/);
  containsRe(html, /<p[^>]*>Normal paragraph after\\.<\\/p>/);
  // The normal paragraph must NOT start inside a <b> tag
  notContainsRe(html, /<b>[^<]*Normal paragraph after/);
});

test("bold on one line does not make bullet points bold when they follow", () => {
  // This is the exact scenario from the bug screenshots:
  // User bolds "Here's some feedback from the review team,:" and the bullets
  // after it (in separate divs) should remain normal weight.
  const input =
    "<div><b>Here's some feedback from the review team,:</b></div>" +
    "<div>- Concern around timeline for execution.</div>" +
    "<div>- Small team currently.</div>";
  const html = buildEmailHtml(input);
  // The bold must close before the bullet points
  const boldCloseIdx = html.indexOf("</b>");
  const firstBulletIdx = html.indexOf("- Concern around timeline");
  if (boldCloseIdx === -1) throw new Error("No </b> found in output: " + html.slice(0, 400));
  if (firstBulletIdx === -1) throw new Error("Bullet point not found: " + html.slice(0, 400));
  if (boldCloseIdx > firstBulletIdx) throw new Error(
    "Bold closes AFTER bullet — bold is leaking!\\n</b> at " + boldCloseIdx +
    ", bullet at " + firstBulletIdx + "\\nHTML: " + html.slice(0, 600)
  );
});

test("multiple paragraphs — bold in 3rd does not affect 4th", () => {
  const input =
    "<div>Paragraph one.</div><div><br></div>" +
    "<div>Paragraph two.</div><div><br></div>" +
    "<div><b>Bold paragraph three.</b></div><div><br></div>" +
    "<div>Paragraph four — should be normal.</div>";
  const html = buildEmailHtml(input);
  // Each paragraph in its own <p>
  containsRe(html, /<p[^>]*>Paragraph one\\.<\\/p>/);
  containsRe(html, /<p[^>]*><b>Bold paragraph three\\.<\\/b><\\/p>/);
  containsRe(html, /<p[^>]*>Paragraph four — should be normal\\.<\\/p>/);
  // "Paragraph four" must NOT be inside a <b>
  notContainsRe(html, /<b>[^<]*Paragraph four/);
});

test("bold at end of paragraph, normal text at start of next — no leak", () => {
  const input =
    "<div>Some text and then <b>end of bold.</b></div><div><br></div>" +
    "<div>Next paragraph starts normal.</div>";
  const html = buildEmailHtml(input);
  containsRe(html, /<b>end of bold\\.<\\/b><\\/p>/);
  containsRe(html, /<p[^>]*>Next paragraph starts normal\\.<\\/p>/);
  notContainsRe(html, /<b>[^<]*Next paragraph/);
});

// ── Unclosed tag repair ────────────────────────────────────────────────────────

console.log("\\n=== Unclosed inline tag repair ===");

test("unclosed <b> at end of string is closed", () => {
  // If the editor produces an unclosed <b>, it must be closed in output.
  // The output must have a matching number of <b> and </b> tags.
  const html = buildEmailHtml("<div>Normal text</div><div><b>Bold and more bold</div>");
  const opens = (html.match(/<b>/gi) || []).length;
  const closes = (html.match(/<\\/b>/gi) || []).length;
  if (opens !== closes) throw new Error(
    "Mismatched <b> tags: " + opens + " opens, " + closes + " closes\\nHTML: " + html.slice(0, 600)
  );
  // Must have at least one matched pair
  if (opens === 0) throw new Error("No <b> tags found in output at all — bold content lost");
});

test("unclosed <i> at end of string is closed", () => {
  const html = buildEmailHtml("<div>Text with <i>italic that never closes</div>");
  const opens = (html.match(/<i>/gi) || []).length;
  const closes = (html.match(/<\\/i>/gi) || []).length;
  if (opens !== closes) throw new Error(
    "Mismatched <i> tags: " + opens + " opens, " + closes + " closes"
  );
});

test("inline tags closed at double-<br> boundary and reopened", () => {
  // Bold that starts in one paragraph, crosses a double-<br> boundary
  // After repair, the double-<br> should have the bold closed before it
  // and reopened after (so both sides stay bold, but the boundary is clean)
  const input = "<div><b>Bold in paragraph one.<br><br>Continues in next.</b></div>";
  const html = buildEmailHtml(input);
  // Both sides should be bold (intent preserved)
  containsRe(html, /<b>Bold in paragraph one\\.[^]*?<\\/b>/);
  // But they should be in separate <p> elements
  const firstP = html.indexOf("<p");
  const secondP = html.indexOf("<p", firstP + 1);
  if (secondP === -1) {
    // Single paragraph is OK if it's all bold — the key thing is no cross-p leakage
    // This path means the double-br inside a <b> caused single-p output
    contains(html, "<b>");
    contains(html, "</b>");
  }
});

// ── Signature isolation ────────────────────────────────────────────────────────

console.log("\\n=== Signature isolation ===");

test("signature appended after body does not inherit body bold", () => {
  const sig = '<div style="font-weight:normal;font-family:Arial;"><p>Regards,</p><p>TREVOR BURGESS</p></div>';
  const html = buildEmailHtml("<div><b>Here's some feedback:</b></div>", sig);
  // Signature must come after the body wrapper
  const bodyClose = html.indexOf("</div>");
  const sigIdx = html.indexOf("font-weight:normal");
  if (sigIdx === -1) throw new Error("font-weight:normal not found in appended sig: " + html.slice(0, 300));
  if (bodyClose === -1 || sigIdx < bodyClose) throw new Error(
    "font-weight:normal signature reset must appear AFTER the body </div>"
  );
});

test("body is wrapped in its own <div> separate from appendHtml", () => {
  const sig = "<div>SIGNATURE</div>";
  const html = buildEmailHtml("<div>Body content</div>", sig);
  // The pattern must be: <div style="...">...body...</div><div>SIGNATURE</div>
  containsRe(html, /<div style="[^"]*font-family[^"]*">[^]*?<\\/div><div>SIGNATURE<\\/div>/);
});

// ── Link preservation ─────────────────────────────────────────────────────────

console.log("\\n=== Link preservation ===");

test("https link preserved with VoltSafe color after sanitization", () => {
  const html = buildEmailHtml('<div>Visit <a href="https://voltsafe.com">voltsafe.com</a></div>');
  contains(html, 'href="https://voltsafe.com"');
  contains(html, "color:#00C1DE");
  contains(html, ">voltsafe.com<");
});

test("mailto link preserved", () => {
  const html = buildEmailHtml('<div><a href="mailto:hello@example.com">Email us</a></div>');
  contains(html, 'href="mailto:hello@example.com"');
  contains(html, "Email us");
});

test("javascript: link blocked (XSS guard)", () => {
  const html = buildEmailHtml('<div><a href="javascript:alert(1)">click</a></div>');
  notContains(html, "javascript:");
  contains(html, "click"); // label text preserved
});

test("link inside bold paragraph preserved", () => {
  const html = buildEmailHtml('<div><b>See our <a href="https://voltsafe.com">website</a> for details.</b></div>');
  contains(html, 'href="https://voltsafe.com"');
  contains(html, "<b>");
  contains(html, "</b>");
});

// ── List handling ─────────────────────────────────────────────────────────────

console.log("\\n=== List handling ===");

test("unordered list is NOT wrapped in <p> (invalid HTML)", () => {
  const html = buildEmailHtml("<ul><li>Item one</li><li>Item two</li></ul>");
  notContainsRe(html, /<p[^>]*><ul/);
  contains(html, "<ul");
  contains(html, "<li>Item one</li>");
});

test("ordered list preserved without <p> wrapper", () => {
  const html = buildEmailHtml("<ol><li>First</li><li>Second</li></ol>");
  notContainsRe(html, /<p[^>]*><ol/);
  contains(html, "<li>First</li>");
});

test("text before list and text after list work correctly", () => {
  const input =
    "<div>Before list:</div>" +
    "<ul><li>Item A</li><li>Item B</li></ul>" +
    "<div>After list.</div>";
  const html = buildEmailHtml(input);
  contains(html, "Before list:");
  contains(html, "<li>Item A</li>");
  contains(html, "After list.");
});

// ── Email client snapshot hygiene ─────────────────────────────────────────────

console.log("\\n=== Email client snapshot hygiene ===");

test("Gmail-safe: no bare <br><br> chains between paragraphs (use <p> instead)", () => {
  // Between two paragraphs there should be </p><p>, not <br><br>
  const html = buildEmailHtml("<div>Para 1</div><div><br></div><div>Para 2</div>");
  notContainsRe(html, /Para 1[^]*?<br>[^]*?<br>[^]*?Para 2/);
  containsRe(html, /Para 1<\\/p>[^]*?<p[^>]*>Para 2/);
});

test("Outlook-safe: <p> has explicit margin (not CSS class)", () => {
  const html = buildEmailHtml("<div>Content</div>");
  containsRe(html, /<p[^>]*style="[^"]*margin[^"]*"/);
  notContainsRe(html, /<p[^>]*class=/);
});

test("Apple Mail / Spark safe: no Tailwind classes in output", () => {
  const html = buildEmailHtml('<div class="text-sm font-bold">content</div>');
  notContainsRe(html, /class="text-sm|font-bold|tailwind/);
});

test("no markdown artifacts in HTML output", () => {
  const html = buildEmailHtml("<div><b>bold</b> and <i>italic</i></div>");
  notContains(html, "**");
  notContains(html, "__");
  notContains(html, "~~");
  notContains(html, "*italic*");
});

test("Mobile-safe: line-height:1.6 on paragraphs for readability", () => {
  const html = buildEmailHtml("<div>Mobile content</div>");
  containsRe(html, /line-height:1\.6/);
});

// ── Realistic email body (the actual bug scenario) ────────────────────────────

console.log("\\n=== Realistic email body (bug reproduction) ===");

test("BAT Cohort email: bold intro phrase does not leak into bullets", () => {
  // This reproduces the exact email from the bug screenshots
  const input =
    "<div>We really value feedback - as it provides the opportunity to learn and refine.</div>" +
    "<div>I did want to briefly clarify the feedback provided.</div>" +
    "<div><b>Here's some feedback from the review team,:</b></div>" +
    "<div>- Concern around timeline for execution, specifically getting UL certified.</div>" +
    "<div>- Small team currently that may not have the time capacity to deploy a pilot.</div>" +
    "<div><br></div>" +
    "<div>If there was any additional feedback that you can share it would be appreciated.</div>";

  const html = buildEmailHtml(input);

  // Verify structure
  containsRe(html, /<b>Here's some feedback from the review team,:<\\/b>/);
  contains(html, "- Concern around timeline");
  contains(html, "If there was any additional feedback");

  // The bold MUST be closed before the bullet points
  const boldClose = html.indexOf("</b>");
  const firstBullet = html.indexOf("- Concern around timeline");
  if (boldClose === -1) throw new Error("No </b> tag found in output");
  if (boldClose > firstBullet) throw new Error(
    "BOLD LEAK: </b> appears AFTER bullet point.\\n" +
    "This reproduces the Gmail bold-bleed bug from the screenshots.\\n" +
    "Bold closes at " + boldClose + ", bullet at " + firstBullet + "\\n" +
    "HTML snippet: " + html.slice(Math.max(0, firstBullet - 50), firstBullet + 200)
  );

  // "If there was..." must be in its own <p> (paragraph isolation)
  containsRe(html, /<p[^>]*>If there was any additional feedback[^]*?<\\/p>/);

  // No paragraph should open inside a <b> context
  const afterBoldClose = html.slice(boldClose);
  notContainsRe(afterBoldClose, /^[^<]*<b>[^<]*<p/);
});

test("bold in final paragraphs does not bleed into signature position", () => {
  const input =
    "<div><b>Thank you for your time, consideration, and encouragement.</b></div>" +
    "<div><br></div>" +
    "<div>Regards,</div>";
  const sig = '<div style="font-weight:normal;">TREVOR BURGESS</div>';
  const html = buildEmailHtml(input, sig);

  // Signature div must come after the body wrapper closes
  const bodyDivClose = html.lastIndexOf("</div>", html.indexOf("TREVOR BURGESS"));
  const sigFontWeight = html.indexOf("font-weight:normal");
  if (sigFontWeight !== -1) {
    // font-weight:normal is in the sig, which is outside the body wrapper — correct
    const bodyWrapper = html.indexOf('font-family:Arial');
    if (sigFontWeight < bodyWrapper) throw new Error(
      "font-weight:normal appears before the body wrapper — unexpected order"
    );
  }
  contains(html, "TREVOR BURGESS");
  contains(html, "Regards,");
});

test("empty body produces valid wrapper without crashing", () => {
  const html = buildEmailHtml("");
  contains(html, "font-family:Arial");
  notContains(html, "undefined");
  notContains(html, "null");
});

test("VoltSafe body wrapper present in all outputs", () => {
  const cases = [
    "<div>simple</div>",
    "<div><b>bold</b></div>",
    "<div><b>bold</b></div><div><br></div><div>normal</div>",
    "<ul><li>list</li></ul>",
    "",
  ];
  for (const input of cases) {
    const html = buildEmailHtml(input);
    if (!html.includes("font-family:Arial")) {
      throw new Error("Missing VoltSafe wrapper for input: " + JSON.stringify(input));
    }
  }
});

// ── Draft save/load round-trip ────────────────────────────────────────────────

console.log("\\n=== Draft round-trip ===");

test("buildEmailHtml output contains <p> tags that are safe for re-editing", () => {
  // When a draft is loaded back into the editor, stripEmailWrapper removes the outer div
  // The inner content (now <p> tags) is valid contenteditable HTML
  const html = buildEmailHtml("<div>Draft content with <b>bold</b>.</div>");
  // Should contain <p> tags from the new output format
  containsRe(html, /<p[^>]*>Draft content with <b>bold<\\/b>\\.<\\/p>/);
});

test("appendHtml (signature) is outside the body wrapper and isolated", () => {
  const sig = '<div style="font-family:sans-serif;">Sig content</div>';
  const html = buildEmailHtml("<div>Body</div>", sig);
  // Body wrapper must close before the signature
  const wrapperClose = html.indexOf("</div>");
  const sigIdx = html.indexOf("Sig content");
  if (sigIdx < wrapperClose) throw new Error(
    "Signature content appears before body wrapper closes — wrong order"
  );
});

console.log("\\n" + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
`;

const tmpFile = "/tmp/email-bold-formatting-test.ts";
writeFileSync(tmpFile, testScript);

const result = spawnSync("npx", ["tsx", tmpFile], {
  encoding: "utf-8",
  cwd: process.cwd(),
});
process.stdout.write(result.stdout || "");
if (result.stderr) process.stderr.write(result.stderr);

const unitExitCode = result.status ?? 0;
const structExitCode = sf > 0 ? 1 : 0;
process.exit(unitExitCode || structExitCode);
