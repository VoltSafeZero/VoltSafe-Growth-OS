/**
 * scripts/test-forward-reply-pipeline.ts
 *
 * Called by tests/forward-reply-live-pipeline.test.cjs via:
 *   execSync("npx tsx scripts/test-forward-reply-pipeline.ts")
 *
 * Simulates the complete send pipeline for all three paths:
 *   Path 1 — Forward a rich HTML email (images, tables, links, nested quotes, prior sig)
 *   Path 2 — Reply-All to a multi-message thread
 *   Path 3 — Schedule-send a forward containing quoted content
 *
 * Each path runs through the REAL server-side functions in the same order
 * as POST /api/gmail/send:
 *   1. Frontend: buildEmailHtml(userBody) + quotedBlock (no sig markers on quoted block)
 *   2. Frontend: emergencyStripDangerousHtml (client safety strip before POST)
 *   3. Server:   normalizeSignatureHtml       (doc-tag strip)
 *   4. Server:   normalizeOutboundHtml         (style/junk normalizer)
 *   5. Server:   applySignatureSendSanitizer   (sig-section sanitizer)
 *   6. Server:   sig strip + replace           (stale-sig removal + fresh sig append)
 *
 * Outputs a single JSON line so the CJS test can parse and inspect it.
 */

import { buildEmailHtml, emergencyStripDangerousHtml } from "../client/src/lib/email-format.js";
import { normalizeSignatureHtml }                      from "../server/services/signature-normalizer.js";
import { normalizeOutboundHtml }                       from "../server/services/email-html-normalizer.js";
import { applySignatureSendSanitizer }                  from "../server/services/signature-html-sanitizer.js";

// ── Constants ─────────────────────────────────────────────────────────────────
const BASE_URL     = "https://test.voltsafe.com";
const MOCK_SIG_HTML =
  "<table><tr>" +
  "<td><b>TREVOR BURGESS</b><br/>Co-Founder &amp; CEO<br/>VoltSafe Inc.<br/>" +
  "410-1444 Alberni St. Vancouver, BC<br/>M: +1 778 688 0498</td>" +
  '<td><a href="https://voltsafe.com/demo"><img src="https://assets.voltsafe.com/watch-demo.jpg" ' +
  'width="200" alt="Watch a Demo"/></a></td>' +
  "</tr></table>";

// ── Pipeline helper — mirrors POST /api/gmail/send exactly ───────────────────
function runServerPipeline(bodyFromFrontend: string): {
  afterNormalizeSig:       string;
  afterNormalizeOutbound:  string;
  afterSigSanitizer:       string;
  afterSigStripAndReplace: string;
} {
  // Step 3 — server: normalizeSignatureHtml (strips <!DOCTYPE>, <html>, <body> wrappers)
  const afterNormalizeSig = normalizeSignatureHtml(bodyFromFrontend);

  // Step 4 — server: normalizeOutboundHtml (style/junk whitelist normalizer)
  // Step 5 — server: applySignatureSendSanitizer (only touches content inside sig markers)
  const afterSigSanitizer = applySignatureSendSanitizer(
    normalizeOutboundHtml(afterNormalizeSig),
    BASE_URL,
  );

  // Step 6 — server: strip stale sig block, append fresh signature
  const noStaleSig = afterSigSanitizer.replace(/<!--vs-sig-start-->[\s\S]*?<!--vs-sig-end-->/gi, "");
  const afterSigStripAndReplace =
    noStaleSig + `<!--vs-sig-start-->${MOCK_SIG_HTML}<!--vs-sig-end-->`;

  return {
    afterNormalizeSig,
    afterNormalizeOutbound: normalizeOutboundHtml(afterNormalizeSig),
    afterSigSanitizer,
    afterSigStripAndReplace,
  };
}

function runFrontendCompose(userBody: string, quotedBlock: string): {
  rawHtml:             string;
  afterEmergencyStrip: string;
} {
  // Step 1 — frontend: build body div + append quoted block OUTSIDE sig markers
  let html = buildEmailHtml(userBody);
  if (quotedBlock) html = html + quotedBlock;

  // Step 2 — frontend: emergency strip (removes data: URIs, script, iframe, svg)
  const { result: afterStrip } = emergencyStripDangerousHtml(html);
  return { rawHtml: html, afterEmergencyStrip: afterStrip };
}

// ── Rich original email (Canada's Ocean Supercluster style) ──────────────────
const RICH_ORIGINAL_EMAIL =
  '<h2 style="color:#0057b8;font-family:Arial,sans-serif;">Lights. Camera. Impact.</h2>' +
  '<img src="https://cdn.example.com/header-1200x400.jpg" alt="Banner" width="600" style="display:block;"/>' +
  "<p>Dear Valued Partner,</p>" +
  "<p>We are excited to share our <strong>Q3 results</strong>. Revenue is up <b>47%</b> YoY.</p>" +
  '<table cellpadding="8" border="1" style="border-collapse:collapse;width:100%;">' +
    "<tr><th>Region</th><th>Units Sold</th><th>Revenue</th></tr>" +
    "<tr><td>Pacific Northwest</td><td>142</td><td>$284,000</td></tr>" +
    "<tr><td>Great Lakes</td><td>89</td><td>$178,000</td></tr>" +
    "<tr><td>Gulf Coast</td><td>203</td><td>$406,000</td></tr>" +
  "</table>" +
  '<p><a href="https://voltsafe.com/q3-report" style="color:#00C1DE;">Download Full Report</a></p>' +
  // nested quoted replies
  '<blockquote style="border-left:3px solid #ccc;padding-left:16px;">' +
    "<p><em>On Jun 10, prev@partner.com wrote:</em></p>" +
    "<p>Our marina is very happy with the deployment. The chargers are working great.</p>" +
    '<blockquote style="border-left:3px solid #bbb;padding-left:12px;">' +
      "<p><em>On Jun 8, trevor@voltsafe.com wrote:</em></p>" +
      "<p>Q3 update coming next week. We have great results to share!</p>" +
    "</blockquote>" +
  "</blockquote>" +
  // prior signature in the original email
  '<p style="color:#787f84;font-size:12px;">Canada\'s Ocean Supercluster | Vancouver, BC</p>' +
  '<table style="font-family:Arial,sans-serif;"><tr>' +
    "<td><b>Jane Doe</b><br/>CEO, Ocean Supercluster<br/>jane@ocean.com</td>" +
  "</tr></table>";

// Build the forwarded block (mirrors buildForwardedBlockHtml in gmail-inbox.tsx)
function buildForwardedBlock(from: string, date: string, subject: string, to: string, body: string) {
  return (
    '<div style="margin-top:24px;padding-top:16px;border-top:2px solid #e0e0e0;font-family:Arial,sans-serif;font-size:13px;color:#555;">' +
    '<p style="margin:0 0 8px 0;font-weight:bold;color:#333;">---------- Forwarded message ----------</p>' +
    `<p style="margin:0 0 2px 0;"><b>From:</b> ${from}</p>` +
    `<p style="margin:0 0 2px 0;"><b>Date:</b> ${date}</p>` +
    `<p style="margin:0 0 2px 0;"><b>Subject:</b> ${subject}</p>` +
    `<p style="margin:0 0 12px 0;"><b>To:</b> ${to}</p>` +
    `<div>${body}</div>` +
    "</div>"
  );
}

// Build the reply quote block (mirrors buildReplyQuoteBlockHtml in gmail-inbox.tsx)
function buildReplyQuoteBlock(from: string, date: string, body: string) {
  return (
    '<div style="margin-top:16px;padding-top:12px;border-top:1px solid #e0e0e0;">' +
    `<p style="margin:0 0 8px 0;font-size:12px;color:#555;">On ${date}, ${from} wrote:</p>` +
    '<blockquote style="margin:0;padding-left:16px;border-left:3px solid #ccc;color:#555;">' +
    body +
    "</blockquote>" +
    "</div>"
  );
}

// ── Path 1: Forward a rich HTML email ─────────────────────────────────────────
const path1QuotedBlock = buildForwardedBlock(
  "Jane Doe &lt;jane@ocean.com&gt;",
  "Fri, Jun 12 2026 06:41:00 GMT-0700",
  "[accounting@voltsafe.com] Your Story Deserves the Spotlight",
  "accounting@voltsafe.com",
  RICH_ORIGINAL_EMAIL,
);
const path1Frontend = runFrontendCompose(
  "<p>FYI forwarding this for your review.</p>",
  path1QuotedBlock,
);
const path1Pipeline = runServerPipeline(path1Frontend.afterEmergencyStrip);

// ── Path 2: Reply-All to multi-message thread ─────────────────────────────────
// Simulate a thread with multiple messages, quoting the last one (msg.body from DB)
const THREAD_LAST_MESSAGE =
  "<p>Following up on our discussion about the marina expansion project.</p>" +
  "<p>Can we schedule a call to discuss the <b>deployment timeline</b> and " +
  '<a href="https://voltsafe.com/pricing" style="color:#00C1DE;">pricing options</a>?</p>' +
  "<p>We have three sites that need <strong>EV charging infrastructure</strong>:</p>" +
  "<ul>" +
    "<li>Site A — Pacific Northwest Marina (142 slips)</li>" +
    "<li>Site B — Great Lakes Harbour (89 slips)</li>" +
    "<li>Site C — Gulf Coast Marina (203 slips)</li>" +
  "</ul>" +
  // The prior quoted history inline in the email (normal Gmail inline quoting)
  '<blockquote style="border-left:3px solid #ccc;padding-left:1ex;">' +
    "<p>On Jun 14, trevor@voltsafe.com wrote:</p>" +
    "<p>Great to hear from you. Our Q3 deployment schedule has openings for all three sites.</p>" +
    "<p>I'll send over pricing details by end of week.</p>" +
  "</blockquote>";
const path2QuotedBlock = buildReplyQuoteBlock(
  "marina-ceo@example.com",
  "Mon Jun 15 2026 09:30:00",
  THREAD_LAST_MESSAGE,
);
const path2Frontend = runFrontendCompose(
  "<p>Happy to help — here is what we can offer for all three sites.</p>",
  path2QuotedBlock,
);
const path2Pipeline = runServerPipeline(path2Frontend.afterEmergencyStrip);

// ── Path 3: Scheduled send with forwarded content ─────────────────────────────
// Same as Path 1 but simulating the schedule route.
// The schedule route does the same pipeline (normalizeSignatureHtml → normalizeOutboundHtml
// → applySignatureSendSanitizer → sig strip/replace) via schedBody.
const path3QuotedBlock = buildForwardedBlock(
  "CFO &lt;cfo@corp.com&gt;",
  "Thu Jun 11 2026",
  "Q3 Budget Proposal — $120,000 EV Charging",
  "partner@example.com",
  "<p>Please find attached our Q3 budget proposal for <b>EV charging infrastructure</b>.</p>" +
  '<table><tr><th>Item</th><th>Cost</th></tr>' +
  "<tr><td>Hardware (50 units)</td><td>$80,000</td></tr>" +
  "<tr><td>Installation</td><td>$25,000</td></tr>" +
  "<tr><td>Software license (3yr)</td><td>$15,000</td></tr>" +
  "</table>" +
  '<p>Questions? Contact <a href="mailto:cfo@corp.com">cfo@corp.com</a> or visit ' +
  '<a href="https://corp.com/ev-proposal">our proposal page</a>.</p>',
);
const path3Frontend = runFrontendCompose(
  "<p>Scheduling this for Monday morning. Please review the proposal below.</p>",
  path3QuotedBlock,
);
const path3Pipeline = runServerPipeline(path3Frontend.afterEmergencyStrip);

// ── Sig placement helpers ─────────────────────────────────────────────────────
function sigBlockContents(html: string): string {
  const si = html.indexOf("<!--vs-sig-start-->");
  const ei = html.indexOf("<!--vs-sig-end-->");
  if (si === -1 || ei === -1) return "";
  return html.slice(si + "<!--vs-sig-start-->".length, ei);
}
function bodyBeforeSig(html: string): string {
  const si = html.indexOf("<!--vs-sig-start-->");
  return si === -1 ? html : html.slice(0, si);
}
function sigBlockCount(html: string): number {
  return (html.match(/<!--vs-sig-start-->/gi) || []).length;
}

// ── Output JSON ──────────────────────────────────────────────────────────────
const output = {
  path1_forward: {
    label: "Forward rich HTML email",
    stages: {
      frontend_raw_length:             path1Frontend.rawHtml.length,
      after_emergency_strip_length:    path1Frontend.afterEmergencyStrip.length,
      after_normalize_sig_length:      path1Pipeline.afterNormalizeSig.length,
      after_normalize_outbound_length: path1Pipeline.afterNormalizeOutbound.length,
      after_sig_sanitizer_length:      path1Pipeline.afterSigSanitizer.length,
      final_length:                    path1Pipeline.afterSigStripAndReplace.length,
    },
    final_html: path1Pipeline.afterSigStripAndReplace,
    sig_block_contents: sigBlockContents(path1Pipeline.afterSigStripAndReplace),
    body_before_sig:    bodyBeforeSig(path1Pipeline.afterSigStripAndReplace),
    sig_block_count:    sigBlockCount(path1Pipeline.afterSigStripAndReplace),
  },
  path2_reply_all: {
    label: "Reply-All to multi-message thread",
    stages: {
      frontend_raw_length:             path2Frontend.rawHtml.length,
      after_emergency_strip_length:    path2Frontend.afterEmergencyStrip.length,
      final_length:                    path2Pipeline.afterSigStripAndReplace.length,
    },
    final_html: path2Pipeline.afterSigStripAndReplace,
    sig_block_contents: sigBlockContents(path2Pipeline.afterSigStripAndReplace),
    body_before_sig:    bodyBeforeSig(path2Pipeline.afterSigStripAndReplace),
    sig_block_count:    sigBlockCount(path2Pipeline.afterSigStripAndReplace),
  },
  path3_schedule: {
    label: "Scheduled send with forwarded content",
    stages: {
      frontend_raw_length:             path3Frontend.rawHtml.length,
      after_emergency_strip_length:    path3Frontend.afterEmergencyStrip.length,
      after_normalize_sig_length:      path3Pipeline.afterNormalizeSig.length,
      after_normalize_outbound_length: path3Pipeline.afterNormalizeOutbound.length,
      after_sig_sanitizer_length:      path3Pipeline.afterSigSanitizer.length,
      final_length:                    path3Pipeline.afterSigStripAndReplace.length,
    },
    final_html: path3Pipeline.afterSigStripAndReplace,
    sig_block_contents: sigBlockContents(path3Pipeline.afterSigStripAndReplace),
    body_before_sig:    bodyBeforeSig(path3Pipeline.afterSigStripAndReplace),
    sig_block_count:    sigBlockCount(path3Pipeline.afterSigStripAndReplace),
  },
};

process.stdout.write(JSON.stringify(output) + "\n");
