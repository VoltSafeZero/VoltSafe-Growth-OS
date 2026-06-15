"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const inboxSrc = fs.readFileSync(path.join(__dirname, "../client/src/pages/gmail-inbox.tsx"), "utf8");
const fmtSrc   = fs.readFileSync(path.join(__dirname, "../client/src/lib/email-format.ts"), "utf8");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; }
}

// ── email-format.ts exports ──────────────────────────────────────────────────
test("stripSignatureSection is exported from email-format.ts", () => {
  assert.ok(fmtSrc.includes("export function stripSignatureSection"),
    "stripSignatureSection must be exported");
});
test("stripSignatureSection removes vs-sig markers and content (inline logic)", () => {
  const strip = (html) =>
    html.replace(/<!--vs-sig-start-->[\s\S]*?<!--vs-sig-end-->/gi, "").trim();
  const result = strip("<p>hello</p><!--vs-sig-start--><table>sig</table><!--vs-sig-end-->");
  assert.ok(!result.includes("sig"), "sig content must be removed");
  assert.ok(result.includes("hello"), "user content must be preserved");
  const noMarkers = strip("<p>body only</p>");
  assert.strictEqual(noMarkers, "<p>body only</p>", "no markers → passthrough");
});

// ── sendMutation — no signature HTML in body ─────────────────────────────────
const sendStart = inboxSrc.indexOf("const sendMutation = useMutation");
const sendEnd   = inboxSrc.indexOf("const draftMutation = useMutation");
const sendBlock = inboxSrc.slice(sendStart, sendEnd);

test("sendMutation does NOT call sanitizeSignatureHtmlClientSide for send body", () => {
  assert.ok(
    !sendBlock.includes("safeSigHtml = sanitizeSignatureHtmlClientSide(activeSignatureHtml)"),
    "sendMutation must NOT sanitize activeSignatureHtml for inclusion in body"
  );
});
test("sendMutation builds body with buildEmailHtml(body) only, quotedBlock appended separately", () => {
  // After fix: quotedBlock must NOT be the 2nd arg to buildEmailHtml.
  // buildEmailHtml wraps its 2nd arg in <!--vs-sig-start--> markers; the server
  // then strips those markers to insert the real signature, which would silently
  // discard the entire forward/reply history.
  assert.ok(
    !sendBlock.includes("buildEmailHtml(body, quotedBlock)"),
    "sendMutation must NOT pass quotedBlock as 2nd arg to buildEmailHtml (sig marker trap)"
  );
  assert.ok(
    sendBlock.includes("buildEmailHtml(body)"),
    "sendMutation must call buildEmailHtml(body) with no quotedBlock arg"
  );
  assert.ok(
    sendBlock.includes("if (quotedBlock) htmlBody = htmlBody + quotedBlock"),
    "sendMutation must append quotedBlock directly after buildEmailHtml(body)"
  );
});
test("sendMutation includes selectedSignatureId in finalPayload", () => {
  assert.ok(
    sendBlock.includes("selectedSignatureId: effectiveSigId"),
    "finalPayload must include selectedSignatureId: effectiveSigId"
  );
});
test("sendMutation [FINAL SEND PAYLOAD] log replaces old [FINAL FETCH ABOUT TO SEND]", () => {
  assert.ok(sendBlock.includes('[FINAL SEND PAYLOAD]'), "must log [FINAL SEND PAYLOAD]");
  assert.ok(!sendBlock.includes('[FINAL FETCH ABOUT TO SEND]'), "old log name must be gone");
});
test("[FINAL SEND PAYLOAD] log includes bodyContainsSignature field", () => {
  assert.ok(inboxSrc.includes("bodyContainsSignature:"), "must check bodyContainsSignature");
});
test("[FINAL SEND PAYLOAD] log includes selectedSignatureId field", () => {
  assert.ok(
    inboxSrc.includes("selectedSignatureId:    finalPayload.selectedSignatureId") ||
    inboxSrc.includes("selectedSignatureId: finalPayload.selectedSignatureId"),
    "must log selectedSignatureId value"
  );
});
test("[FINAL SEND PAYLOAD] log includes bodyContainsDoctype", () => {
  assert.ok(inboxSrc.includes("bodyContainsDoctype:"), "must check bodyContainsDoctype");
});
test("[FINAL SEND PAYLOAD] log includes bodyContainsHtmlTag", () => {
  assert.ok(inboxSrc.includes("bodyContainsHtmlTag:"), "must check bodyContainsHtmlTag");
});
test("[FINAL SEND PAYLOAD] log includes bodyContainsHeadTag", () => {
  assert.ok(inboxSrc.includes("bodyContainsHeadTag:"), "must check bodyContainsHeadTag");
});
test("[FINAL SEND PAYLOAD] log includes bodyContainsBodyTag", () => {
  assert.ok(inboxSrc.includes("bodyContainsBodyTag:"), "must check bodyContainsBodyTag");
});

// ── scheduleMutation — same architecture ─────────────────────────────────────
// scheduleMutation appears AFTER draftMutation; use a forward window from its index.
const schedStart2 = inboxSrc.indexOf("const scheduleMutation = useMutation");
const schedBlock  = inboxSrc.slice(schedStart2, schedStart2 + 2000);

test("scheduleMutation does NOT use safeSchedSigHtml", () => {
  assert.ok(!schedBlock.includes("safeSchedSigHtml"),
    "scheduleMutation must NOT use safeSchedSigHtml");
});
test("scheduleMutation sends selectedSignatureId", () => {
  assert.ok(
    schedBlock.includes("selectedSignatureId: effectiveSigId"),
    "scheduleMutation must include selectedSignatureId in request"
  );
});
test("scheduleMutation builds body with buildEmailHtml(body) only, schedQuotedBlock appended separately", () => {
  assert.ok(
    !schedBlock.includes("buildEmailHtml(body, schedQuotedBlock)"),
    "scheduleMutation must NOT pass schedQuotedBlock as 2nd arg to buildEmailHtml (sig marker trap)"
  );
  assert.ok(
    schedBlock.includes("buildEmailHtml(body)"),
    "scheduleMutation must call buildEmailHtml(body) with no schedQuotedBlock arg"
  );
  assert.ok(
    schedBlock.includes("if (schedQuotedBlock) htmlBody = htmlBody + schedQuotedBlock"),
    "scheduleMutation must append schedQuotedBlock directly after buildEmailHtml(body)"
  );
});

// ── import sanity ─────────────────────────────────────────────────────────────
test("normalizeSignatureHtmlClientSide still imported for display", () => {
  assert.ok(
    inboxSrc.includes("normalizeSignatureHtmlClientSide"),
    "normalizeSignatureHtmlClientSide must be kept for activeSignatureHtml display"
  );
});
test("activeSignatureHtml preview still uses normalizeSignatureHtmlClientSide", () => {
  assert.ok(
    inboxSrc.includes("normalizeSignatureHtmlClientSide(activeSig.htmlContent"),
    "activeSignatureHtml must still normalize for display/preview"
  );
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
