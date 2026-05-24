/**
 * tests/email-html-sanitize.test.js
 *
 * Verifies the email formatting pipeline (buildEmailHtml + normalizeOutboundHtml).
 *
 * buildEmailHtml now accepts rich-text HTML from the contenteditable editor
 * (not markdown text). Tests have been updated accordingly.
 *
 * Run with: node tests/email-html-sanitize.test.js
 */

import { spawnSync } from "child_process";
import { writeFileSync } from "fs";

const cwd = process.cwd();

const testScript = `
import { buildEmailHtml } from "${cwd}/client/src/lib/email-format.ts";
import { normalizeOutboundHtml } from "${cwd}/server/services/email-html-normalizer.ts";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log("  ✓", name); passed++; }
  catch(e) { console.log("  ✗", name); console.log("    →", e.message); failed++; }
}
function contains(haystack, needle) {
  if (!haystack.includes(needle)) throw new Error("Expected to contain: " + JSON.stringify(needle) + "\\nIn: " + haystack.slice(0, 400));
}
function notContains(haystack, needle) {
  if (haystack.includes(needle)) throw new Error("Expected NOT to contain: " + JSON.stringify(needle) + "\\nIn: " + haystack.slice(0, 400));
}

console.log("\\n=== buildEmailHtml (HTML input) ===");

test("plain text becomes wrapped body", () => {
  const html = buildEmailHtml("Hello world");
  contains(html, "font-family:Arial");
  contains(html, "Hello world");
});

test("bold <b> tag passes through", () => {
  const html = buildEmailHtml("Hello <b>world</b> today");
  contains(html, "<b>world</b>");
  notContains(html, "**");
});

test("italic <i> tag passes through", () => {
  const html = buildEmailHtml("Hello <i>world</i> today");
  contains(html, "<i>world</i>");
});

test("underline <u> tag passes through — no double-encoding", () => {
  const html = buildEmailHtml("Hello <u>world</u> today");
  contains(html, "<u>world</u>");
  notContains(html, "&lt;u&gt;");
});

test("strikethrough <s> tag passes through", () => {
  const html = buildEmailHtml("Hello <s>world</s> today");
  contains(html, "<s>world</s>");
  notContains(html, "~~");
});

test("anchor tag gets target, rel, and VoltSafe colour", () => {
  const html = buildEmailHtml('<a href="https://voltsafe.com">VoltSafe</a>');
  contains(html, 'href="https://voltsafe.com"');
  contains(html, 'target="_blank"');
  contains(html, 'rel="noopener noreferrer"');
  contains(html, ">VoltSafe<");
  notContains(html, "[VoltSafe](");
});

test("unordered list <ul><li> preserved", () => {
  const html = buildEmailHtml("<ul><li>Apple</li><li>Banana</li><li>Cherry</li></ul>");
  contains(html, "<ul");
  contains(html, "<li>Apple</li>");
  contains(html, "<li>Banana</li>");
  contains(html, "<li>Cherry</li>");
});

test("ordered list <ol><li> preserved", () => {
  const html = buildEmailHtml("<ol><li>First</li><li>Second</li><li>Third</li></ol>");
  contains(html, "<ol");
  contains(html, "<li>First</li>");
});

test("style= attributes stripped", () => {
  const html = buildEmailHtml('<b style="font-weight:900;">bold</b>');
  contains(html, "<b>bold</b>");
  notContains(html, 'style="font-weight');
});

test("class= attributes stripped", () => {
  const html = buildEmailHtml('<p class="MsoNormal">paragraph</p>');
  notContains(html, 'class="MsoNormal"');
  contains(html, "paragraph");
});

test("appendHtml is appended after body div", () => {
  const sig = '<div class="sig">-- Trevor</div>';
  const html = buildEmailHtml("Hello", sig);
  const bodyIdx = html.indexOf("Hello");
  const sigIdx = html.indexOf("-- Trevor");
  if (bodyIdx >= sigIdx) throw new Error("Signature should come after body, got: " + html.slice(0, 200));
});

test("bold and italic in same line", () => {
  const html = buildEmailHtml("<b>bold</b> and <i>italic</i> text");
  contains(html, "<b>bold</b>");
  contains(html, "<i>italic</i>");
});

test("empty body produces valid wrapper", () => {
  const html = buildEmailHtml("");
  contains(html, "font-family:Arial");
});

test("no markdown markers leak into HTML output", () => {
  const html = buildEmailHtml("<b>bold</b> normal <i>italic</i>");
  notContains(html, "**bold**");
  notContains(html, "*italic*");
  notContains(html, "~~");
  notContains(html, "[label](");
});

console.log("\\n=== normalizeOutboundHtml ===");

test("Word MsoNormal class is stripped", () => {
  const dirty = '<p class="MsoNormal" style="font-family:Calibri">Hello</p>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "MsoNormal");
  notContains(clean, "Calibri");
  contains(clean, "Hello");
});

test("Word conditional comments are stripped", () => {
  const dirty = '<!--[if gte mso 9]><xml><w:WordDocument/></xml><![endif]-->Hello';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "[if gte mso");
  contains(clean, "Hello");
});

test("Word o:p tags are stripped", () => {
  const dirty = 'Hello<o:p></o:p> world';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "o:p");
  contains(clean, "Hello");
});

test("mso-* CSS properties are stripped", () => {
  const dirty = '<p style="font-size:12pt;mso-line-height-rule:exactly;">Hello</p>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "mso-");
  contains(clean, "Hello");
});

test("Google Docs class pattern c0 c1 c2 is stripped", () => {
  const dirty = '<p class="c0 c5"><span class="c2">Hello from Google Docs</span></p>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, 'class="c0');
  contains(clean, "Hello from Google Docs");
});

test("span with external font-family is unwrapped", () => {
  const dirty = '<p>Hello <span style="font-family:Calibri;font-size:11pt;color:red;">world</span></p>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "Calibri");
  notContains(clean, "font-size:11pt");
  contains(clean, "world");
});

test("font tag is unwrapped", () => {
  const dirty = '<font face="Times New Roman" color="green">Hello</font>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "<font");
  notContains(clean, "Times New Roman");
  contains(clean, "Hello");
});

test("VoltSafe body wrapper is preserved", () => {
  const proper = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111111;line-height:1.6;margin-bottom:24px;">Hello</div>';
  const clean = normalizeOutboundHtml(proper);
  contains(clean, "font-family:Arial");
  contains(clean, "Hello");
});

test("body without wrapper gets wrapped", () => {
  const raw = '<p>Hello world</p>';
  const clean = normalizeOutboundHtml(raw);
  contains(clean, "font-family:Arial");
  contains(clean, "Hello world");
});

test("ChatGPT/AI span output stripped", () => {
  const dirty = '<span style="color:rgb(0,0,0);font-family:-apple-system,BlinkMacSystemFont;">Hello AI world</span>';
  const clean = normalizeOutboundHtml(dirty);
  notContains(clean, "-apple-system");
  notContains(clean, "BlinkMacSystemFont");
  contains(clean, "Hello AI world");
});

test("bold/italic/underline semantic tags preserved", () => {
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111111;line-height:1.6;margin-bottom:24px;"><b>Bold</b> and <i>Italic</i> and <u>Underline</u></div>';
  const clean = normalizeOutboundHtml(html);
  contains(clean, "<b>Bold</b>");
  contains(clean, "<i>Italic</i>");
  contains(clean, "<u>Underline</u>");
});

test("list structure is preserved", () => {
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111111;line-height:1.6;margin-bottom:24px;"><ul style="margin:4px 0;padding-left:24px;"><li>Item 1</li><li>Item 2</li></ul></div>';
  const clean = normalizeOutboundHtml(html);
  contains(clean, "<ul");
  contains(clean, "<li>Item 1</li>");
  contains(clean, "<li>Item 2</li>");
});

test("links with VoltSafe color preserved", () => {
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111111;line-height:1.6;margin-bottom:24px;"><a href="https://voltsafe.com" style="color:#00C1DE;">VoltSafe</a></div>';
  const clean = normalizeOutboundHtml(html);
  contains(clean, "#00C1DE");
  contains(clean, 'href="https://voltsafe.com"');
});

console.log("\\n=== Full pipeline (HTML editor → send) ===");

test("HTML email survives normalize with formatting intact", () => {
  const composed = "<b>Scott</b>,<br>Please review the <a href=\\"https://voltsafe.com/p\\">proposal</a>.<br><ul><li>Item 1</li><li>Item 2</li></ul>Thanks";
  const built = buildEmailHtml(composed);
  const normalized = normalizeOutboundHtml(built);
  contains(normalized, "<b>Scott</b>");
  contains(normalized, 'href="https://voltsafe.com/p"');
  contains(normalized, "<li>Item 1</li>");
  contains(normalized, "Thanks");
  contains(normalized, "font-family:Arial");
});

test("Word-style dirty HTML is cleaned by normalize", () => {
  const word = '<p class="MsoNormal" style="font-family:Calibri;font-size:11pt;mso-margin-top-alt:auto;"><b>Revenue</b> Update<o:p></o:p></p><ul><li class="MsoNormal">Revenue up 12%</li></ul>';
  const clean = normalizeOutboundHtml(word);
  notContains(clean, "MsoNormal");
  notContains(clean, "Calibri");
  notContains(clean, "o:p");
  contains(clean, "<b>Revenue</b>");
  contains(clean, "Revenue up 12%");
});

test("Google Docs HTML is cleaned by normalize", () => {
  const gdocs = '<p class="c0"><span class="c1" style="font-family:Arial;font-size:10pt;color:#000000;">Hello from Docs</span></p>';
  const clean = normalizeOutboundHtml(gdocs);
  notContains(clean, 'class="c0"');
  notContains(clean, 'class="c1"');
  notContains(clean, "font-size:10pt");
  contains(clean, "Hello from Docs");
});

console.log("\\n" + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
`;

const tmpFile = "/tmp/email-sanitize-test.ts";
writeFileSync(tmpFile, testScript);

const result = spawnSync("npx", ["tsx", tmpFile], {
  encoding: "utf-8",
  cwd: process.cwd(),
});
process.stdout.write(result.stdout || "");
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 0);
