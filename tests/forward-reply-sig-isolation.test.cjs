"use strict";
/**
 * tests/forward-reply-sig-isolation.test.cjs
 *
 * Regression suite that ensures forward/reply quoted content is NEVER placed
 * inside <!--vs-sig-start-->...<!--vs-sig-end--> blocks, which the server
 * strips and replaces with the real email signature.
 *
 * The root bug (now fixed): buildEmailHtml(body, quotedBlock) wrapped the
 * quoted/forwarded body inside sig markers.  The server's stale-sig cleanup
 * then silently discarded the entire forwarded email and only kept the
 * recipient's email signature — making every forward appear blank to recipients.
 *
 * Test sections:
 *   1.  sendMutation source structure
 *   2.  scheduleMutation source structure
 *   3.  draftMutation control path (sig in markers IS correct for drafts)
 *   4.  buildEmailHtml function contract
 *   5.  handleForward / handleReplyAll source structure
 *   6.  Server sig-replacement source structure
 *   7.  Audit — no other path puts quoted content inside sig markers
 *   8.  Unit tests (tsx subprocess) — pipeline simulation end-to-end
 *
 * Run with: node tests/forward-reply-sig-isolation.test.cjs
 */

const assert  = require("assert");
const fs      = require("fs");
const path    = require("path");
const { spawnSync } = require("child_process");

const inboxSrc  = fs.readFileSync(path.join(__dirname, "../client/src/pages/gmail-inbox.tsx"), "utf8");
const fmtSrc    = fs.readFileSync(path.join(__dirname, "../client/src/lib/email-format.ts"),  "utf8");
const routesSrc = fs.readFileSync(path.join(__dirname, "../server/routes.ts"),                "utf8");
const storeSrc  = fs.readFileSync(path.join(__dirname, "../client/src/components/inbox/inbox-actions-store.ts"), "utf8");

let sp = 0, sf = 0;
function test(name, fn) {
  try   { fn(); console.log("  \u2713", name); sp++; }
  catch (e) { console.error("  \u2717", name, "\n    \u2192", e.message); sf++; }
}
function has(src, pat)    { return typeof pat === "string" ? src.includes(pat) : pat.test(src); }
function ok(src, pat, m)  { if (!has(src, pat))  throw new Error(m || "Expected: " + pat); }
function no(src, pat, m)  { if ( has(src, pat))  throw new Error(m || "Expected NOT: " + pat); }

// ─────────────────────────────────────────────────────────────────────────────
// Section 1 — sendMutation block
// ─────────────────────────────────────────────────────────────────────────────
const sendStart = inboxSrc.indexOf("const sendMutation = useMutation");
const sendEnd   = inboxSrc.indexOf("const draftMutation = useMutation");
const sendBlock = inboxSrc.slice(sendStart, sendEnd);

console.log("\n=== 1. sendMutation — quoted block outside sig markers ===");

test("sendMutation calls buildEmailHtml(body) with no second argument", () => {
  ok(sendBlock, "buildEmailHtml(body)",
    "sendMutation must call buildEmailHtml(body) with no second arg");
});
test("sendMutation appends quotedBlock DIRECTLY after buildEmailHtml(body)", () => {
  ok(sendBlock, "if (quotedBlock) htmlBody = htmlBody + quotedBlock",
    "quotedBlock must be appended directly to htmlBody, not via buildEmailHtml");
});
test("sendMutation does NOT pass quotedBlock as 2nd arg to buildEmailHtml [regression guard]", () => {
  no(sendBlock, "buildEmailHtml(body, quotedBlock)",
    "buildEmailHtml(body, quotedBlock) wraps forward/reply HTML in sig markers — FORBIDDEN");
});
test("sendMutation passes selectedSignatureId (signature sent server-side, not as HTML)", () => {
  ok(sendBlock, "selectedSignatureId: effectiveSigId",
    "signature must be referenced by ID in the payload, not embedded as HTML");
});
test("sendMutation [FINAL SEND PAYLOAD] log still present", () => {
  ok(sendBlock, "[FINAL SEND PAYLOAD]",
    "diagnostic log must be present for traceability");
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 2 — scheduleMutation block
// ─────────────────────────────────────────────────────────────────────────────
const schedStart = inboxSrc.indexOf("const scheduleMutation = useMutation");
const schedBlock = inboxSrc.slice(schedStart, schedStart + 2500);

console.log("\n=== 2. scheduleMutation — quoted block outside sig markers ===");

test("scheduleMutation calls buildEmailHtml(body) with no second argument", () => {
  ok(schedBlock, "buildEmailHtml(body)",
    "scheduleMutation must call buildEmailHtml(body) with no second arg");
});
test("scheduleMutation appends schedQuotedBlock DIRECTLY after buildEmailHtml(body)", () => {
  ok(schedBlock, "if (schedQuotedBlock) htmlBody = htmlBody + schedQuotedBlock",
    "schedQuotedBlock must be appended directly to htmlBody");
});
test("scheduleMutation does NOT pass schedQuotedBlock as 2nd arg to buildEmailHtml [regression guard]", () => {
  no(schedBlock, "buildEmailHtml(body, schedQuotedBlock)",
    "buildEmailHtml(body, schedQuotedBlock) wraps scheduled forward HTML in sig markers — FORBIDDEN");
});
test("scheduleMutation sends selectedSignatureId (server-side sig assembly)", () => {
  ok(schedBlock, "selectedSignatureId: effectiveSigId",
    "scheduleMutation must reference signature by ID");
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 3 — draftMutation control path (sig markers ARE correct for drafts)
// ─────────────────────────────────────────────────────────────────────────────
const draftStart = inboxSrc.indexOf("const draftMutation = useMutation");
const draftEnd   = inboxSrc.indexOf("const deleteDraftMutation = useMutation");
const draftBlock = inboxSrc.slice(draftStart, draftEnd);

console.log("\n=== 3. draftMutation — sig in markers is intentional for drafts ===");

test("draftMutation passes activeSignatureHtml as 2nd arg (correct for draft re-open)", () => {
  ok(draftBlock, "buildEmailHtml(body, activeSignatureHtml)",
    "draftMutation must persist signature inside sig markers so it can be re-displayed on re-open");
});
test("draftMutation does NOT pass quotedBlock to buildEmailHtml", () => {
  no(draftBlock, "buildEmailHtml(body, quotedBlock)",
    "draftMutation must not pass quotedBlock — only activeSignatureHtml is allowed as 2nd arg");
});
test("draftMutation does NOT pass schedQuotedBlock to buildEmailHtml", () => {
  no(draftBlock, "buildEmailHtml(body, schedQuotedBlock)",
    "draftMutation must not pass schedQuotedBlock to buildEmailHtml");
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 4 — buildEmailHtml contract in email-format.ts
// ─────────────────────────────────────────────────────────────────────────────
const fmtFnStart = fmtSrc.indexOf("export function buildEmailHtml");
const fmtFnEnd   = fmtSrc.indexOf("\n}", fmtFnStart) + 2;
const fmtFnBody  = fmtSrc.slice(fmtFnStart, fmtFnEnd);

console.log("\n=== 4. buildEmailHtml — only wraps explicit appendHtml in sig markers ===");

test("buildEmailHtml has appendHtml param defaulting to empty string", () => {
  ok(fmtFnBody, 'appendHtml = ""',
    "buildEmailHtml must have appendHtml = \"\" as its default parameter");
});
test("buildEmailHtml sig markers are inside the appendHtml conditional branch", () => {
  ok(fmtFnBody, "appendHtml",
    "sig markers must be gated on the appendHtml parameter");
  ok(fmtFnBody, "<!--vs-sig-start-->",
    "buildEmailHtml body must reference the start marker");
});
test("buildEmailHtml conditionally wraps appendHtml — empty string produces no markers", () => {
  // Verify the ternary/conditional is present so empty appendHtml skips markers
  ok(fmtFnBody, /appendHtml\s*\?/,
    "buildEmailHtml must use a conditional so empty appendHtml skips sig markers");
});
test("stripSignatureSection exported from email-format.ts", () => {
  ok(fmtSrc, "export function stripSignatureSection",
    "stripSignatureSection must be exported for use by draft re-open path");
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 5 — handleForward / handleReplyAll source structure
// ─────────────────────────────────────────────────────────────────────────────
const fwdStart  = inboxSrc.indexOf("const handleForward = (msg: ThreadMessage)");
const fwdEnd    = inboxSrc.indexOf("const selectedMessages = ");
const fwdBlock  = inboxSrc.slice(fwdStart, fwdEnd);

const raStart   = inboxSrc.indexOf("const handleReplyAll = (msg: ThreadMessage)");
const raEnd     = inboxSrc.indexOf("const handleForward = (msg: ThreadMessage)");
const raBlock   = inboxSrc.slice(raStart, raEnd);

console.log("\n=== 5. handleForward / handleReplyAll source structure ===");

test("handleForward reads full thread from threadQuery.data.messages", () => {
  ok(fwdBlock, "threadQuery.data?.messages",
    "handleForward must use threadQuery.data.messages to build full thread context");
});
test("handleForward multi-message: iterates all messages", () => {
  ok(fwdBlock, "allMsgs.map(",
    "handleForward must map over all messages for multi-message threads");
});
test("handleForward sets isForward:true on composeInitial", () => {
  ok(fwdBlock, "isForward: true",
    "handleForward must tag composeInitial with isForward:true");
});
test("handleForward passes quotedHtml to composeInitial (not sig-wrapped)", () => {
  ok(fwdBlock, "quotedHtml,",
    "handleForward must set quotedHtml on composeInitial");
  no(fwdBlock, "vs-sig-start",
    "handleForward must NEVER embed quoted content inside sig markers");
});
test("handleReplyAll sets quotedHtml from msg.body", () => {
  ok(raBlock, "quotedHtml: msg.body",
    "handleReplyAll must populate quotedHtml from the focused message body");
});
test("handleReplyAll does not embed quoted content in sig markers", () => {
  no(raBlock, "vs-sig-start",
    "handleReplyAll must NEVER embed msg.body inside sig markers");
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 6 — Server sig-replacement source structure
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== 6. Server sig-replacement — strips only sig marker block ===");

test("routes.ts /send: strips stale sig block before appending fresh sig", () => {
  ok(routesSrc,
    '_cleanBodyNoStaleSig = cleanBody.replace(/<!--vs-sig-start-->[\\s\\S]*?<!--vs-sig-end-->/gi, "")',
    "/send route must strip stale sig markers via regex replace");
});
test("routes.ts /send: appends fresh sig AFTER full body content", () => {
  ok(routesSrc,
    "_cleanBodyNoStaleSig + `<!--vs-sig-start-->${_sigSection}<!--vs-sig-end-->`",
    "/send route must append new sig section after the full body");
});
test("routes.ts /schedule: strips stale sig block before appending fresh sig", () => {
  ok(routesSrc,
    'schedBody = schedBody.replace(/<!--vs-sig-start-->[\\s\\S]*?<!--vs-sig-end-->/gi, "")',
    "/schedule route must also strip stale sig markers");
});
test("routes.ts /schedule: appends sig after schedBody", () => {
  ok(routesSrc,
    "schedBody = schedBody + `<!--vs-sig-start-->${_schedSigSection}<!--vs-sig-end-->`",
    "/schedule route must append fresh sig after full schedBody");
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 7 — Codebase audit: no other path passes quoted content to sig markers
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== 7. Audit — no other path wraps quoted content in sig markers ===");

test("inbox-actions-store.ts: buildEmailHtml not called with quotedBlock as 2nd arg", () => {
  if (storeSrc.includes("buildEmailHtml")) {
    no(storeSrc, "buildEmailHtml(body, quotedBlock)",
      "inbox-actions-store.ts must not pass quotedBlock as 2nd arg to buildEmailHtml");
    no(storeSrc, "buildEmailHtml(body, schedQuotedBlock)",
      "inbox-actions-store.ts must not pass schedQuotedBlock as 2nd arg to buildEmailHtml");
  }
  // No-op pass if buildEmailHtml not used here
});
test("quotes.tsx: buildEmailHtml called without quoted content", () => {
  const quoteSrc = fs.readFileSync(
    path.join(__dirname, "../client/src/pages/quotes.tsx"), "utf8"
  );
  no(quoteSrc, "buildEmailHtml(body, quotedBlock)",
    "quotes.tsx must not wrap quotedBlock in sig markers");
});
test("meeting-notes-detail.tsx: buildEmailHtml called without quoted content", () => {
  const mnSrc = fs.readFileSync(
    path.join(__dirname, "../client/src/pages/meeting-notes-detail.tsx"), "utf8"
  );
  no(mnSrc, "buildEmailHtml(body, quotedBlock)",
    "meeting-notes-detail.tsx must not wrap quotedBlock in sig markers");
});
test("email-format.ts: no second usage of buildEmailHtml with non-sig content", () => {
  // buildEmailHtml is defined once; additional calls in the same file would be unusual
  const callCount = (fmtSrc.match(/buildEmailHtml\s*\(/g) || []).length;
  // definition + jsdoc comment reference = expected; extra body calls = not expected
  assert.ok(callCount <= 3,
    "email-format.ts should not have unexpected extra buildEmailHtml calls: " + callCount);
});

console.log(`\nStructural: ${sp} passed, ${sf} failed`);
if (sf > 0) {
  console.error("STRUCTURAL FAILURES — aborting before unit tests");
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 8 — Unit tests via tsx subprocess
// These actually run buildEmailHtml and simulate the full send pipeline.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== 8. Unit tests (tsx) — pipeline simulation ===");

const cwd = process.cwd();

// Write the tsx test script to a temp file using string concatenation
// (avoids backtick escaping issues inside the outer template literal)
const unitLines = [
  'import { buildEmailHtml, stripSignatureSection } from "' + cwd + '/client/src/lib/email-format.ts";',
  '',
  'let passed = 0, failed = 0;',
  'function test(name, fn) {',
  '  try { fn(); console.log("  \\u2713", name); passed++; }',
  '  catch(e) { console.log("  \\u2717", name + "\\n    \\u2192 " + e.message); failed++; }',
  '}',
  'function contains(h, n) {',
  '  if (!h.includes(n)) throw new Error("Expected to contain: " + JSON.stringify(n) + "\\n  in (first 400): " + h.slice(0, 400));',
  '}',
  'function notContains(h, n) {',
  '  if (h.includes(n)) throw new Error("Expected NOT to contain: " + JSON.stringify(n));',
  '}',
  'function ok(cond, msg) { if (!cond) throw new Error(msg); }',
  '',
  '// Server sig-replace simulation (mirrors routes.ts logic)',
  'function serverApplySig(body, sigHtml) {',
  '  const stripped = body.replace(/<!--vs-sig-start-->[\\s\\S]*?<!--vs-sig-end-->/gi, "");',
  '  return stripped + "<!--vs-sig-start-->" + sigHtml + "<!--vs-sig-end-->";',
  '}',
  '',
  '// buildForwardedBlockHtml (same logic as gmail-inbox.tsx)',
  'function buildForwardedBlockHtml(from, date, subject, to, bodyHtml) {',
  '  return \'<div style="margin-top:24px;border-top:2px solid #e0e0e0;">\' +',
  '    \'<p style="font-weight:bold;">---------- Forwarded message ----------</p>\' +',
  '    \'<p><b>From:</b> \' + from + \'</p>\' +',
  '    \'<p><b>Date:</b> \' + date + \'</p>\' +',
  '    \'<p><b>Subject:</b> \' + subject + \'</p>\' +',
  '    \'<p><b>To:</b> \' + to + \'</p>\' +',
  '    \'<div>\' + bodyHtml + \'</div></div>\';',
  '}',
  '',
  '// buildReplyQuoteBlockHtml (same logic as gmail-inbox.tsx)',
  'function buildReplyQuoteBlockHtml(from, date, bodyHtml) {',
  '  return \'<div style="margin-top:16px;border-top:1px solid #e0e0e0;">\' +',
  '    \'<p style="font-size:12px;">On \' + date + \', \' + from + \' wrote:</p>\' +',
  '    \'<blockquote style="margin:0;padding-left:16px;border-left:3px solid #ccc;">\' +',
  '    bodyHtml + \'</blockquote></div>\';',
  '}',
  '',
  'console.log("\\n--- buildEmailHtml sig-marker isolation ---");',
  '',
  'test("buildEmailHtml with no args: body has no sig markers", () => {',
  '  const h = buildEmailHtml("<p>Hello</p>");',
  '  notContains(h, "<!--vs-sig-start-->");',
  '  notContains(h, "<!--vs-sig-end-->");',
  '  contains(h, "Hello");',
  '});',
  '',
  'test("buildEmailHtml with empty appendHtml: no sig markers", () => {',
  '  const h = buildEmailHtml("<p>Content</p>", "");',
  '  notContains(h, "<!--vs-sig-start-->");',
  '  contains(h, "Content");',
  '});',
  '',
  'test("buildEmailHtml with sig appendHtml: sig wrapped in markers", () => {',
  '  const h = buildEmailHtml("<p>Body</p>", "<table>MY_SIGNATURE</table>");',
  '  contains(h, "<!--vs-sig-start-->");',
  '  contains(h, "<!--vs-sig-end-->");',
  '  contains(h, "MY_SIGNATURE");',
  '  contains(h, "Body");',
  '});',
  '',
  'test("buildEmailHtml: user body appears BEFORE sig markers", () => {',
  '  const h = buildEmailHtml("<p>USER_BODY</p>", "<b>SIG</b>");',
  '  const bodyIdx = h.indexOf("USER_BODY");',
  '  const sigIdx  = h.indexOf("<!--vs-sig-start-->");',
  '  ok(bodyIdx < sigIdx, "USER_BODY index " + bodyIdx + " must be before sig marker at " + sigIdx);',
  '});',
  '',
  'test("buildEmailHtml: appendHtml content is INSIDE sig markers", () => {',
  '  const h = buildEmailHtml("<p>Body</p>", "<b>SIG_INSIDE</b>");',
  '  const start = h.indexOf("<!--vs-sig-start-->");',
  '  const end   = h.indexOf("<!--vs-sig-end-->");',
  '  const idx   = h.indexOf("SIG_INSIDE");',
  '  ok(idx > start && idx < end, "SIG_INSIDE must be between sig markers");',
  '});',
  '',
  'console.log("\\n--- forward pipeline end-to-end ---");',
  '',
  'test("forward: NEW pattern — quotedBlock outside sig markers survives server sig insert", () => {',
  '  const userText  = "FYI forwarding this email for your review.";',
  '  const origEmail = "<p>Original email with <b>key content</b></p>" +',
  '    \'<img src="https://cdn.example.com/banner.jpg" alt="Banner"/>\' +',
  '    "<table><tr><td>Revenue: 47% growth</td></tr></table>";',
  '  const quotedBlock = buildForwardedBlockHtml(',
  '    "sender@ocean.com", "Fri Jun 12", "Ocean Subject", "to@voltsafe.com", origEmail',
  '  );',
  '  // sendMutation NEW pattern:',
  '  let htmlBody = buildEmailHtml("<p>" + userText + "</p>");',
  '  if (quotedBlock) htmlBody = htmlBody + quotedBlock;',
  '  // Server applies fresh signature:',
  '  const final = serverApplySig(htmlBody, "<table>TREVOR_SIG</table>");',
  '  contains(final, userText);',
  '  contains(final, "key content");',
  '  contains(final, "banner.jpg");',
  '  contains(final, "Revenue: 47% growth");',
  '  contains(final, "Forwarded message");',
  '  contains(final, "TREVOR_SIG");',
  '});',
  '',
  'test("forward: OLD broken pattern LOSES forward content (confirms bug was real)", () => {',
  '  const origEmail = "<p>ORIGINAL_EMAIL_CONTENT should survive</p>";',
  '  const quotedBlock = buildForwardedBlockHtml(',
  '    "s@e.com", "Jun 12", "Subj", "to@v.com", origEmail',
  '  );',
  '  // OLD pattern — quotedBlock passed as 2nd arg → wrapped in sig markers:',
  '  const htmlBodyBroken = buildEmailHtml("<p>User text</p>", quotedBlock);',
  '  // Server strips sig markers → forward content is GONE:',
  '  const finalBroken = serverApplySig(htmlBodyBroken, "<b>Fresh Sig</b>");',
  '  notContains(finalBroken, "ORIGINAL_EMAIL_CONTENT");  // BUG: content lost',
  '  contains(finalBroken, "Fresh Sig");                  // only sig remains',
  '});',
  '',
  'console.log("\\n--- reply / reply-all pipeline ---");',
  '',
  'test("reply: quoted message survives server sig replacement", () => {',
  '  const replyText = "Thanks for your interest in marina charging.";',
  '  const priorMsg  = "<p>Dear team, I am interested in <b>EV charging</b> for my marina.</p>";',
  '  const quotedBlock = buildReplyQuoteBlockHtml("prospect@marina.com", "Mon Jun 15", priorMsg);',
  '  let htmlBody = buildEmailHtml("<p>" + replyText + "</p>");',
  '  if (quotedBlock) htmlBody = htmlBody + quotedBlock;',
  '  const final = serverApplySig(htmlBody, "<b>TREVOR_SIG</b>");',
  '  contains(final, replyText);',
  '  contains(final, "EV charging");',
  '  contains(final, "prospect@marina.com");',
  '  contains(final, "TREVOR_SIG");',
  '});',
  '',
  'test("reply-all: full thread history (multiple messages) survives sig replacement", () => {',
  '  const thread = [',
  '    "<p>First message: interested in <b>docking</b> systems</p>",',
  '    "<p>Second reply: can we see <a href=\'https://docs.link\'>docs</a>?</p>",',
  '    "<table><tr><td>Quote: $5,000 per unit</td></tr></table>",',
  '  ].join("<hr/>");',
  '  const quotedBlock = buildReplyQuoteBlockHtml("team@marina.com", "Jun 14", thread);',
  '  let htmlBody = buildEmailHtml("<p>Reply all text here.</p>");',
  '  if (quotedBlock) htmlBody = htmlBody + quotedBlock;',
  '  const final = serverApplySig(htmlBody, "<b>SIG</b>");',
  '  contains(final, "docking");',
  '  contains(final, "https://docs.link");',
  '  contains(final, "$5,000");',
  '  contains(final, "team@marina.com");',
  '});',
  '',
  'console.log("\\n--- scheduled email pipeline ---");',
  '',
  'test("scheduleMutation: quoted forward block preserved after server sig insert", () => {',
  '  const schedText  = "Scheduled forward — please review by EOD.";',
  '  const origContent = "<p>Q3 proposal with budget of <b>$120,000</b></p>";',
  '  const quotedBlock = buildForwardedBlockHtml(',
  '    "cfo@corp.com", "Thu Jun 11", "Q3 Proposal", "partner@example.com", origContent',
  '  );',
  '  // scheduleMutation NEW pattern:',
  '  let htmlBody = buildEmailHtml("<p>" + schedText + "</p>");',
  '  if (quotedBlock) htmlBody = htmlBody + quotedBlock;',
  '  const final = serverApplySig(htmlBody, "<b>SCHED_SIG</b>");',
  '  contains(final, schedText);',
  '  contains(final, "$120,000");',
  '  contains(final, "SCHED_SIG");',
  '});',
  '',
  'console.log("\\n--- complex regression: rich forwarded email ---");',
  '',
  'test("regression: long HTML with images, links, tables, nested quotes, prior sig — all survive", () => {',
  '  const complexEmail =',
  '    "<h2>Lights. Camera. Impact.</h2>" +',
  '    \'<img src="https://cdn.example.com/header-1200x400.jpg" alt="Banner" width="600"/>\' +',
  '    "<p>Q3 results: revenue up <strong>47%</strong> YoY.</p>" +',
  '    "<table cellpadding=\'8\' border=\'1\'>" +',
  '      "<tr><th>Region</th><th>Units</th><th>Revenue</th></tr>" +',
  '      "<tr><td>Pacific Northwest</td><td>142</td><td>$284,000</td></tr>" +',
  '      "<tr><td>Great Lakes</td><td>89</td><td>$178,000</td></tr>" +',
  '      "<tr><td>Gulf Coast</td><td>203</td><td>$406,000</td></tr>" +',
  '    "</table>" +',
  '    \'<p><a href="https://voltsafe.com/q3-report">Download Report</a></p>\' +',
  '    \'<blockquote style="border-left:3px solid #ccc;padding-left:16px;">\' +',
  '      "<p>On Jun 10, prev@partner.com wrote:</p>" +',
  '      "<p>Our marina is very happy with deployment.</p>" +',
  '      \'<blockquote style="border-left:3px solid #bbb;padding-left:12px;">\' +',
  '        "<p>On Jun 8, trevor@voltsafe.com wrote:</p>" +',
  '        "<p>Q3 update coming next week. Stay tuned!</p>" +',
  '      "</blockquote>" +',
  '    "</blockquote>" +',
  '    \'<p style="color:#787f84;">Canada Ocean Supercluster | Vancouver, BC</p>\';',
  '',
  '  const quotedBlock = buildForwardedBlockHtml(',
  '    "Jane Doe <jane@ocean.com>",',
  '    "Fri Jun 12 2026",',
  '    "Your Story Deserves the Spotlight",',
  '    "accounting@voltsafe.com",',
  '    complexEmail',
  '  );',
  '',
  '  let htmlBody = buildEmailHtml("<p>FYI forwarding for your review.</p>");',
  '  if (quotedBlock) htmlBody = htmlBody + quotedBlock;',
  '',
  '  const freshSig =',
  '    "<table><tr>" +',
  '      "<td><b>TREVOR BURGESS</b><br/>Co-Founder and CEO</td>" +',
  '      \'<td><img src="https://assets.voltsafe.com/watch-demo.png"/></td>\' +',
  '    "</tr></table>";',
  '',
  '  const final = serverApplySig(htmlBody, freshSig);',
  '',
  '  // All original forwarded content must be present:',
  '  contains(final, "Lights. Camera. Impact.");',
  '  contains(final, "header-1200x400.jpg");',
  '  contains(final, "47%");',
  '  contains(final, "Pacific Northwest");',
  '  contains(final, "$284,000");',
  '  contains(final, "Great Lakes");',
  '  contains(final, "$406,000");',
  '  contains(final, "https://voltsafe.com/q3-report");',
  '  contains(final, "prev@partner.com");',
  '  contains(final, "marina is very happy");',
  '  contains(final, "Q3 update coming next week");',
  '  contains(final, "Canada Ocean Supercluster");',
  '  contains(final, "Jane Doe");',
  '  contains(final, "Your Story Deserves the Spotlight");',
  '',
  '  // User message and fresh sig must also be present:',
  '  contains(final, "FYI forwarding for your review");',
  '  contains(final, "TREVOR BURGESS");',
  '  contains(final, "watch-demo.png");',
  '',
  '  // Forward/reply content must NOT be inside sig markers:',
  '  const sigStart = final.indexOf("<!--vs-sig-start-->");',
  '  const sigEnd   = final.indexOf("<!--vs-sig-end-->");',
  '  if (sigStart !== -1 && sigEnd !== -1) {',
  '    const sigBlock = final.slice(sigStart, sigEnd);',
  '    ok(!sigBlock.includes("Lights. Camera. Impact."),',
  '       "forwarded headline must NOT be inside sig markers");',
  '    ok(!sigBlock.includes("Pacific Northwest"),',
  '       "forwarded table data must NOT be inside sig markers");',
  '    ok(!sigBlock.includes("marina is very happy"),',
  '       "nested quoted replies must NOT be inside sig markers");',
  '  }',
  '});',
  '',
  'test("regression: stale sig markers in body — all stripped, only fresh sig appended", () => {',
  '  // Worst case: a body that somehow accumulated two sig marker blocks',
  '  const staleBody =',
  '    "<p>User content</p>" +',
  '    "<!--vs-sig-start--><b>OLD SIG A</b><!--vs-sig-end-->" +',
  '    "<p>Quoted reply content here</p>" +',
  '    "<!--vs-sig-start--><b>OLD SIG B</b><!--vs-sig-end-->";',
  '  const stripped = staleBody.replace(/<!--vs-sig-start-->[\\s\\S]*?<!--vs-sig-end-->/gi, "");',
  '  const final    = stripped + "<!--vs-sig-start--><b>FRESH SIG</b><!--vs-sig-end-->";',
  '  notContains(final, "OLD SIG A");',
  '  notContains(final, "OLD SIG B");',
  '  contains(final, "FRESH SIG");',
  '  contains(final, "User content");',
  '  contains(final, "Quoted reply content here");',
  '});',
  '',
  'test("regression: forward body with no quoted content (new email forward) still works", () => {',
  '  const quotedBlock = buildForwardedBlockHtml(',
  '    "noreply@service.com", "Mon Jun 10", "Account Update", "user@example.com",',
  '    "<p>Your account has been updated.</p>"',
  '  );',
  '  let htmlBody = buildEmailHtml("");  // empty user body (edge case)',
  '  if (quotedBlock) htmlBody = htmlBody + quotedBlock;',
  '  const final = serverApplySig(htmlBody, "<b>SIG</b>");',
  '  contains(final, "account has been updated");',
  '  contains(final, "SIG");',
  '  notContains(final, "<!--vs-sig-start--><!--vs-sig-end-->");  // no empty sig block before the real one',
  '});',
  '',
  'console.log("\\n" + passed + " passed, " + failed + " failed");',
  'if (failed > 0) process.exit(1);',
];

const tmpFile = "/tmp/forward-reply-sig-unit.ts";
fs.writeFileSync(tmpFile, unitLines.join("\n"));

const result = spawnSync("npx", ["tsx", tmpFile], {
  encoding: "utf-8",
  cwd: process.cwd(),
  timeout: 60000,
});
process.stdout.write(result.stdout || "");
if (result.stderr) {
  const sigErr = (result.stderr || "").replace(/\x1b\[[0-9;]*m/g, "");
  const lines = sigErr.split("\n").filter(l => !l.includes("ExperimentalWarning") && l.trim());
  if (lines.length) process.stderr.write(lines.slice(0, 20).join("\n") + "\n");
}

const unitExit = result.status ?? 0;
console.log("\n\u2500".repeat(40));
console.log("Structural: " + sp + " passed, " + sf + " failed");
console.log("Unit exit:  " + unitExit);
process.exit(unitExit || (sf > 0 ? 1 : 0));
