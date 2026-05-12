/**
 * tests/email-html-sanitize.test.js
 *
 * Verifies the email formatting pipeline (buildEmailHtml + normalizeOutboundHtml).
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

console.log("\\n=== buildEmailHtml ===");

test("plain text becomes wrapped body", () => {
  const html = buildEmailHtml("Hello world");
  contains(html, "font-family:Arial");
  contains(html, "Hello world");
});

test("bold **text** converts to <b>", () => {
  const html = buildEmailHtml("Hello **world** today");
  contains(html, "<b>world</b>");
  notContains(html, "**");
});

test("italic *text* converts to <i>", () => {
  const html = buildEmailHtml("Hello *world* today");
  contains(html, "<i>world</i>");
});

test("underline <u>text</u> passthrough — no double-encoding", () => {
  const html = buildEmailHtml("Hello <u>world</u> today");
  contains(html, "<u>world</u>");
  notContains(html, "&lt;u&gt;");
});

test("strikethrough ~~text~~ converts to <s>", () => {
  const html = buildEmailHtml("Hello ~~world~~ today");
  contains(html, "<s>world</s>");
  notContains(html, "~~");
});

test("markdown link [label](url) converts to <a>", () => {
  const html = buildEmailHtml("Visit [VoltSafe](https://voltsafe.com) now");
  contains(html, 'href="https://voltsafe.com"');
  contains(html, ">VoltSafe<");
  notContains(html, "[VoltSafe](");
});

test("unordered list - items become <ul><li>", () => {
  const html = buildEmailHtml("- Apple\\n- Banana\\n- Cherry");
  contains(html, "<ul");
  contains(html, "<li>Apple</li>");
  contains(html, "<li>Banana</li>");
  contains(html, "<li>Cherry</li>");
  notContains(html, "- Apple");
});

test("ordered list 1. 2. 3. becomes <ol><li>", () => {
  const html = buildEmailHtml("1. First\\n2. Second\\n3. Third");
  contains(html, "<ol");
  contains(html, "<li>First</li>");
  notContains(html, "1. First");
});

test("HTML special chars are escaped in plain text", () => {
  const html = buildEmailHtml("Price: <$100 & > $50");
  contains(html, "&lt;$100");
  contains(html, "&amp;");
  contains(html, "&gt; $50");
});

test("appendHtml is appended after body div", () => {
  const sig = '<div class="sig">-- Trevor</div>';
  const html = buildEmailHtml("Hello", sig);
  const bodyIdx = html.indexOf("Hello");
  const sigIdx = html.indexOf("-- Trevor");
  if (bodyIdx >= sigIdx) throw new Error("Signature should come after body, got: " + html.slice(0, 200));
});

test("bold and italic in same line", () => {
  const html = buildEmailHtml("**bold** and *italic* text");
  contains(html, "<b>bold</b>");
  contains(html, "<i>italic</i>");
});

test("empty body produces valid wrapper", () => {
  const html = buildEmailHtml("");
  contains(html, "font-family:Arial");
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

console.log("\\n=== Full pipeline ===");

test("typed email survives normalize unchanged", () => {
  const typed = "Hello **Scott**,\\n\\nPlease review the [proposal](https://voltsafe.com/p).\\n\\n- Item 1\\n- Item 2\\n\\nThanks";
  const built = buildEmailHtml(typed);
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
