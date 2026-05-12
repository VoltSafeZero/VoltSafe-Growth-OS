/**
 * tests/paste-normalizer.test.js
 *
 * Proves that pasted HTML from every common source is cleaned by the
 * VoltSafe Mail paste-normalization pipeline.
 *
 * Tests are split into two layers:
 *
 *   Layer 1 — normalizeOutboundHtml (server-side safety net)
 *     Verifies that dirty HTML from each paste source, after going through
 *     the server normalizer, produces clean VoltSafe-branded output.
 *     This layer does NOT require a browser and runs entirely in Node.js.
 *
 *   Layer 2 — buildEmailHtml pipeline
 *     Verifies that plain text with markdown markers (the output of the
 *     client-side paste handler) round-trips correctly through buildEmailHtml
 *     and normalizeOutboundHtml.
 *
 * Note: htmlToEditorText() uses DOMParser and is browser-only. Its behaviour
 * is validated indirectly here: for each paste source we show that the HTML
 * that WOULD have leaked to the backend (if the client-side handler were
 * bypassed) is still cleaned by the server normalizer.
 *
 * Run with: node tests/paste-normalizer.test.js
 */

import { spawnSync } from "child_process";
import { writeFileSync } from "fs";

const cwd = process.cwd();

const testScript = `
import { normalizeOutboundHtml } from "${cwd}/server/services/email-html-normalizer.ts";
import { buildEmailHtml } from "${cwd}/client/src/lib/email-format.ts";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log("  ✓", name); passed++; }
  catch(e) { console.log("  ✗", name); console.log("    →", e.message); failed++; }
}
function contains(haystack, needle) {
  if (!haystack.includes(needle))
    throw new Error("Expected to contain: " + JSON.stringify(needle) + "\\nGot: " + haystack.slice(0, 500));
}
function notContains(haystack, needle) {
  if (haystack.includes(needle))
    throw new Error("Expected NOT to contain: " + JSON.stringify(needle) + "\\nGot: " + haystack.slice(0, 500));
}

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE DOCS
// ─────────────────────────────────────────────────────────────────────────────
console.log("\\n=== Google Docs paste ===");

test("GDocs: class=c0 c5 stripped, content preserved", () => {
  const dirty = '<p class="c0 c5"><span class="c2">Hello from Google Docs</span></p>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, 'class="c0');
  notContains(clean, 'class="c2');
  contains(clean, "Hello from Google Docs");
});

test("GDocs: docs-internal-guid attribute stripped", () => {
  const dirty = '<p id="docs-internal-guid-abc123" class="c1">Hello</p>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "docs-internal-guid");
  contains(clean, "Hello");
});

test("GDocs: external font-family/size/color in span stripped", () => {
  const dirty = '<span style="font-family:Arial;font-size:10pt;color:#000000;">Styled text</span>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "font-size:10pt");
  notContains(clean, "color:#000000");
  contains(clean, "Styled text");
});

test("GDocs: <b style=font-weight:normal> GDocs hack cleaned", () => {
  const dirty = '<b style="font-weight:normal;font-family:Roboto;">Normal-weight text</b>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "font-weight:normal");
  notContains(clean, "Roboto");
  contains(clean, "Normal-weight text");
});

test("GDocs: nested span tree stripped to text only", () => {
  const dirty =
    '<span class="c1"><span class="c3" style="color:#333;">Deeply <span style="font-size:9pt;">nested</span> content</span></span>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "<span");
  contains(clean, "Deeply");
  contains(clean, "nested");
  contains(clean, "content");
});

test("GDocs: bulleted list preserved", () => {
  const dirty =
    '<ul class="c4"><li class="c0 c7"><p class="c0"><span class="c2">First item</span></p></li>' +
    '<li class="c0 c7"><p class="c0"><span class="c2">Second item</span></p></li></ul>';
  const clean = normalizeOutboundHtml(dirty);
  contains(clean, "<ul");
  contains(clean, "First item");
  contains(clean, "Second item");
});

test("GDocs: link href preserved, external color stripped", () => {
  const dirty =
    '<a class="c5" href="https://voltsafe.com" style="color:#1155cc;text-decoration:underline;">VoltSafe</a>';
  const clean = normalizeOutboundHtml(dirty);
  contains(clean, 'href="https://voltsafe.com"');
  contains(clean, "VoltSafe");
  notContains(clean, "1155cc");
});

// ─────────────────────────────────────────────────────────────────────────────
// MICROSOFT WORD
// ─────────────────────────────────────────────────────────────────────────────
console.log("\\n=== Microsoft Word paste ===");

test("Word: MsoNormal class stripped", () => {
  const dirty = '<p class="MsoNormal" style="font-family:Calibri;font-size:11pt;">Hello</p>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "MsoNormal");
  notContains(clean, "Calibri");
  notContains(clean, "11pt");
  contains(clean, "Hello");
});

test("Word: conditional comments stripped", () => {
  const dirty = '<!--[if gte mso 9]><xml><w:WordDocument/></xml><![endif]-->Hello';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "[if gte mso");
  contains(clean, "Hello");
});

test("Word: o:p namespace tags stripped", () => {
  const dirty = 'Hello<o:p></o:p> world';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "o:p");
  contains(clean, "Hello");
});

test("Word: mso-* CSS properties stripped", () => {
  const dirty = '<p style="font-size:12pt;mso-line-height-rule:exactly;mso-margin-top-alt:auto;">Hello</p>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "mso-");
  notContains(clean, "12pt");
  contains(clean, "Hello");
});

test("Word: w: namespace tags stripped", () => {
  const dirty = '<w:body><w:p>Hello</w:p></w:body>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "w:body");
  notContains(clean, "w:p");
  contains(clean, "Hello");
});

test("Word: MsoBodyText class and font override stripped", () => {
  const dirty = '<p class="MsoBodyText" style="font-family:Times New Roman;font-size:12pt;color:#000000;">Revenue update</p>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "MsoBodyText");
  notContains(clean, "Times New Roman");
  contains(clean, "Revenue update");
});

test("Word: font tag stripped", () => {
  const dirty = '<font face="Calibri" color="#333333" size="3">Word font tag text</font>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "<font");
  notContains(clean, "Calibri");
  contains(clean, "Word font tag text");
});

test("Word: bold preserved through normalization", () => {
  const dirty = '<p class="MsoNormal"><b>Bold revenue</b> update<o:p></o:p></p>';
  const clean = normalizeOutboundHtml(dirty);
  contains(clean, "<b>Bold revenue</b>");
});

test("Word: unordered list preserved", () => {
  const dirty =
    '<ul style="margin-top:0in;" type="disc">' +
    '<li class="MsoNormal" style="mso-list:l0 level1 lfo1;">Revenue up 12%</li>' +
    '<li class="MsoNormal" style="mso-list:l0 level1 lfo1;">Marina count 34</li></ul>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "MsoNormal");
  notContains(clean, "mso-list");
  contains(clean, "<ul");
  contains(clean, "Revenue up 12%");
  contains(clean, "Marina count 34");
});

// ─────────────────────────────────────────────────────────────────────────────
// GMAIL
// ─────────────────────────────────────────────────────────────────────────────
console.log("\\n=== Gmail paste ===");

test("Gmail: gmail_default class stripped", () => {
  const dirty = '<div class="gmail_default" style="font-family:arial,helvetica,sans-serif;font-size:small;">Hello</div>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "gmail_default");
  notContains(clean, "font-size:small");
  contains(clean, "Hello");
});

test("Gmail: gmail_attr class stripped", () => {
  const dirty = '<div class="gmail_attr">On Mon, May 12 wrote:</div>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "gmail_attr");
  contains(clean, "On Mon, May 12 wrote:");
});

test("Gmail: dir=ltr attribute stripped", () => {
  const dirty = '<div dir="ltr">Hello world</div>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, 'dir="ltr"');
  contains(clean, "Hello world");
});

test("Gmail: data-* attributes stripped", () => {
  const dirty = '<p data-smartmail="gmail_signature" data-reactid="42">Signature</p>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "data-smartmail");
  notContains(clean, "data-reactid");
  contains(clean, "Signature");
});

test("Gmail: inline font-size:small override stripped", () => {
  const dirty = '<span style="font-size:small;font-family:Verdana;">Small text</span>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "font-size:small");
  notContains(clean, "Verdana");
  contains(clean, "Small text");
});

// ─────────────────────────────────────────────────────────────────────────────
// CHATGPT / CLAUDE / AI TOOL OUTPUT
// ─────────────────────────────────────────────────────────────────────────────
console.log("\\n=== ChatGPT/Claude AI output paste ===");

test("ChatGPT: -apple-system/-BlinkMacSystemFont stripped", () => {
  const dirty = '<span style="color:rgb(0,0,0);font-family:-apple-system,BlinkMacSystemFont,Segoe UI;">Hello AI world</span>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "-apple-system");
  notContains(clean, "BlinkMacSystemFont");
  notContains(clean, "Segoe UI");
  contains(clean, "Hello AI world");
});

test("ChatGPT: data-pm-slice ProseMirror attribute stripped", () => {
  const dirty = '<p data-pm-slice="1 1 []">This is AI content</p>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "data-pm-slice");
  contains(clean, "This is AI content");
});

test("Claude: inline rgb() colors stripped", () => {
  const dirty = '<p style="color:rgb(26,26,26);font-size:16px;line-height:1.8;font-family:Georgia,serif;">Claude output</p>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "rgb(26,26,26)");
  notContains(clean, "Georgia");
  notContains(clean, "font-size:16px");
  contains(clean, "Claude output");
});

test("AI: bulleted list structure preserved", () => {
  const dirty =
    '<ul style="list-style-type:disc;margin:0;padding:0 0 0 24px;">' +
    '<li style="color:rgb(0,0,0);font-family:-apple-system;">Point one</li>' +
    '<li style="color:rgb(0,0,0);font-family:-apple-system;">Point two</li>' +
    '</ul>';
  const clean = normalizeOutboundHtml(dirty);
  contains(clean, "<ul");
  contains(clean, "Point one");
  contains(clean, "Point two");
  notContains(clean, "-apple-system");
});

test("AI: numbered list structure preserved", () => {
  const dirty =
    '<ol style="list-style-type:decimal;font-family:ui-sans-serif;">' +
    '<li style="font-size:16px;">First step</li>' +
    '<li style="font-size:16px;">Second step</li>' +
    '</ol>';
  const clean = normalizeOutboundHtml(dirty);
  contains(clean, "<ol");
  contains(clean, "First step");
  contains(clean, "Second step");
  notContains(clean, "ui-sans-serif");
});

test("AI: semantic bold/italic preserved", () => {
  const dirty =
    '<p style="font-family:ui-monospace;"><strong>Important:</strong> <em>This is emphasized</em> text</p>';
  const clean = normalizeOutboundHtml(dirty);
  contains(clean, "<strong>Important:</strong>");
  contains(clean, "<em>This is emphasized</em>");
  notContains(clean, "ui-monospace");
});

test("AI: links preserved, external style stripped", () => {
  const dirty =
    '<p>See <a href="https://voltsafe.com/demo" style="color:rgb(0,112,210);text-decoration:underline;">our demo</a> here</p>';
  const clean = normalizeOutboundHtml(dirty);
  contains(clean, 'href="https://voltsafe.com/demo"');
  contains(clean, "our demo");
  notContains(clean, "rgb(0,112,210)");
});

// ─────────────────────────────────────────────────────────────────────────────
// WEB PAGES
// ─────────────────────────────────────────────────────────────────────────────
console.log("\\n=== Web page paste ===");

test("Web: arbitrary div with background-color and border stripped", () => {
  const dirty =
    '<div style="background-color:#f5f5f5;border:1px solid #e0e0e0;padding:16px;font-family:Helvetica Neue;font-size:15px;">' +
    'Card content from a web page</div>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "background-color:#f5f5f5");
  notContains(clean, "border:1px solid");
  notContains(clean, "Helvetica Neue");
  notContains(clean, "font-size:15px");
  contains(clean, "Card content from a web page");
});

test("Web: h1 heading external styles stripped", () => {
  const dirty = '<h1 style="font-size:32px;font-weight:700;color:#1a1a1a;letter-spacing:-0.02em;">Page Title</h1>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "font-size:32px");
  notContains(clean, "letter-spacing");
  contains(clean, "Page Title");
});

test("Web: Notion class patterns stripped", () => {
  const dirty = '<div class="notion-text-block"><p class="notion-page-content">Notion content</p></div>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "notion-text-block");
  notContains(clean, "notion-page-content");
  contains(clean, "Notion content");
});

test("Web: Substack/Medium CSS module class patterns stripped", () => {
  const dirty = '<p class="ProseMirror-Text">Substack text</p>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "ProseMirror-Text");
  contains(clean, "Substack text");
});

test("Web: table content extracted as text", () => {
  const dirty =
    '<table style="border-collapse:collapse;width:100%;">' +
    '<tr><td style="padding:8px;border:1px solid #ccc;font-weight:bold;">Q1</td>' +
    '<td style="padding:8px;border:1px solid #ccc;">$1.2M</td></tr></table>';
  const clean = normalizeOutboundHtml(dirty);
  contains(clean, "Q1");
  contains(clean, "$1.2M");
  notContains(clean, "border:1px solid #ccc");
  notContains(clean, "border-collapse");
});

// ─────────────────────────────────────────────────────────────────────────────
// MIXED FONTS AND SIZES
// ─────────────────────────────────────────────────────────────────────────────
console.log("\\n=== Mixed fonts and sizes ===");

test("Mixed: multiple different font-family overrides all stripped", () => {
  const dirty =
    '<p style="font-family:Georgia,serif;font-size:18px;">First para</p>' +
    '<p style="font-family:Verdana,sans-serif;font-size:13px;">Second para</p>' +
    '<p style="font-family:Courier New,monospace;font-size:11pt;">Third para</p>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "Georgia");
  notContains(clean, "Verdana");
  notContains(clean, "Courier New");
  notContains(clean, "font-size:18px");
  notContains(clean, "font-size:13px");
  notContains(clean, "11pt");
  contains(clean, "First para");
  contains(clean, "Second para");
  contains(clean, "Third para");
});

test("Mixed: color overrides stripped from all elements", () => {
  const dirty =
    '<p style="color:#FF0000;">Red text</p>' +
    '<p style="color:blue;">Blue text</p>' +
    '<p style="color:rgb(100,200,50);">Green text</p>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "color:#FF0000");
  notContains(clean, "color:blue");
  notContains(clean, "rgb(100,200,50)");
  contains(clean, "Red text");
  contains(clean, "Blue text");
  contains(clean, "Green text");
});

test("Mixed: line-height / margin / padding overrides stripped", () => {
  const dirty =
    '<p style="line-height:2.5;margin-top:20px;margin-bottom:20px;padding:10px;">Spaced text</p>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "line-height:2.5");
  notContains(clean, "margin-top:20px");
  notContains(clean, "padding:10px");
  contains(clean, "Spaced text");
});

// ─────────────────────────────────────────────────────────────────────────────
// INLINE SPANS AND NESTED CSS
// ─────────────────────────────────────────────────────────────────────────────
console.log("\\n=== Inline spans and nested CSS ===");

test("Spans: 4-level deep nesting unwrapped to plain text", () => {
  const dirty =
    '<span class="outer" style="color:red;">' +
    '<span class="mid" style="font-size:12pt;">' +
    '<span style="font-family:Calibri;">' +
    '<span style="letter-spacing:0.05em;">Deep span text</span>' +
    '</span></span></span>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "<span");
  notContains(clean, "Calibri");
  notContains(clean, "letter-spacing");
  contains(clean, "Deep span text");
});

test("Spans: inline background-color and padding stripped", () => {
  const dirty = '<span style="background-color:#FFFF00;padding:2px 4px;">Highlighted text</span>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "background-color");
  notContains(clean, "padding");
  contains(clean, "Highlighted text");
});

test("Spans: text-transform and opacity stripped", () => {
  const dirty = '<span style="text-transform:uppercase;opacity:0.8;font-weight:300;">Styled span</span>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "text-transform");
  notContains(clean, "opacity");
  contains(clean, "Styled span");
});

// ─────────────────────────────────────────────────────────────────────────────
// BULLETED AND NUMBERED LISTS
// ─────────────────────────────────────────────────────────────────────────────
console.log("\\n=== Bulleted and numbered lists ===");

test("Lists: plain ul/li preserved", () => {
  const html = buildEmailHtml("- Alpha\\n- Beta\\n- Gamma");
  const clean = normalizeOutboundHtml(html);
  contains(clean, "<ul");
  contains(clean, "<li>Alpha</li>");
  contains(clean, "<li>Beta</li>");
  contains(clean, "<li>Gamma</li>");
});

test("Lists: plain ol/li preserved", () => {
  const html = buildEmailHtml("1. First\\n2. Second\\n3. Third");
  const clean = normalizeOutboundHtml(html);
  contains(clean, "<ol");
  contains(clean, "<li>First</li>");
  contains(clean, "<li>Second</li>");
  contains(clean, "<li>Third</li>");
});

test("Lists: Word-style li class stripped, items preserved", () => {
  const dirty =
    '<ul type="disc" style="margin-top:0;">' +
    '<li class="MsoNormal" style="mso-list:l0;font-family:Calibri;">Item A</li>' +
    '<li class="MsoNormal" style="mso-list:l0;font-family:Calibri;">Item B</li>' +
    '</ul>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "MsoNormal");
  notContains(clean, "Calibri");
  contains(clean, "<ul");
  contains(clean, "Item A");
  contains(clean, "Item B");
});

test("Lists: GDocs ul class stripped, items preserved", () => {
  const dirty =
    '<ul class="c4 lst-kix_abc"><li class="c0 c7"><p class="c0"><span class="c2">Alpha</span></p></li>' +
    '<li class="c0 c7"><p class="c0"><span class="c2">Beta</span></p></li></ul>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "c4 lst-kix");
  contains(clean, "<ul");
  contains(clean, "Alpha");
  contains(clean, "Beta");
});

// ─────────────────────────────────────────────────────────────────────────────
// LINKS
// ─────────────────────────────────────────────────────────────────────────────
console.log("\\n=== Links ===");

test("Links: href preserved, external color stripped", () => {
  const dirty = '<a href="https://voltsafe.com" style="color:#1155cc;text-decoration:underline;">VoltSafe</a>';
  const clean = normalizeOutboundHtml(dirty);
  contains(clean, 'href="https://voltsafe.com"');
  contains(clean, "VoltSafe");
  notContains(clean, "1155cc");
});

test("Links: VoltSafe link color preserved", () => {
  const html = buildEmailHtml("Visit [VoltSafe](https://voltsafe.com) now");
  const clean = normalizeOutboundHtml(html);
  contains(clean, 'href="https://voltsafe.com"');
  contains(clean, "#00C1DE");
});

test("Links: multiple links in body all preserved", () => {
  const html = buildEmailHtml(
    "See [demo](https://demo.voltsafe.com) and [docs](https://docs.voltsafe.com)"
  );
  const clean = normalizeOutboundHtml(html);
  contains(clean, "demo.voltsafe.com");
  contains(clean, "docs.voltsafe.com");
});

// ─────────────────────────────────────────────────────────────────────────────
// FULL PIPELINE — VoltSafe body style always present
// ─────────────────────────────────────────────────────────────────────────────
console.log("\\n=== Full pipeline / VoltSafe style guarantee ===");

test("Pipeline: output always has VoltSafe font-family", () => {
  const sources = [
    '<p class="MsoNormal" style="font-family:Calibri;">Word content</p>',
    '<p class="c0"><span class="c1">Google Docs</span></p>',
    '<span style="font-family:-apple-system;">AI output</span>',
    '<div class="gmail_default" style="font-family:arial;font-size:small;">Gmail content</div>',
    '<p style="font-family:Georgia,serif;font-size:18px;">Web page</p>',
  ];
  for (const src of sources) {
    const clean = normalizeOutboundHtml(src);
    if (!clean.includes("font-family:Arial"))
      throw new Error("Missing VoltSafe font-family for source: " + src.slice(0, 80));
  }
});

test("Pipeline: typed text survives roundtrip unchanged", () => {
  const typed = "Hello **Scott**,\\n\\nPlease review the [proposal](https://voltsafe.com/p).\\n\\n- Item 1\\n- Item 2\\n\\nThanks";
  const built = buildEmailHtml(typed);
  const clean = normalizeOutboundHtml(built);
  contains(clean, "<b>Scott</b>");
  contains(clean, 'href="https://voltsafe.com/p"');
  contains(clean, "<li>Item 1</li>");
  contains(clean, "Thanks");
  contains(clean, "font-family:Arial");
});

test("Pipeline: bold/italic markers in editor text render correctly", () => {
  const typed = "**Bold point** and *italic note*";
  const html = buildEmailHtml(typed);
  const clean = normalizeOutboundHtml(html);
  contains(clean, "<b>Bold point</b>");
  contains(clean, "<i>italic note</i>");
});

test("Pipeline: semantic bold/italic preserved through normalize", () => {
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111111;line-height:1.6;margin-bottom:24px;"><b>Bold</b> and <i>Italic</i> and <u>Underline</u></div>';
  const clean = normalizeOutboundHtml(html);
  contains(clean, "<b>Bold</b>");
  contains(clean, "<i>Italic</i>");
  contains(clean, "<u>Underline</u>");
});

test("Pipeline: empty body produces valid wrapper", () => {
  const html = buildEmailHtml("");
  const clean = normalizeOutboundHtml(html);
  contains(clean, "font-family:Arial");
});

test("Pipeline: body without wrapper gets wrapped", () => {
  const raw = "<p>Hello world</p>";
  const clean = normalizeOutboundHtml(raw);
  contains(clean, "font-family:Arial");
  contains(clean, "Hello world");
});

console.log("\\n" + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
`;

const tmpFile = "/tmp/paste-normalizer-test.ts";
writeFileSync(tmpFile, testScript);

const result = spawnSync("npx", ["tsx", tmpFile], {
  encoding: "utf-8",
  cwd: process.cwd(),
  timeout: 60_000,
});
process.stdout.write(result.stdout || "");
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 0);
