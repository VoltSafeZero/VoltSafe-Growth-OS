"use strict";
/**
 * tests/forward-reply-live-pipeline.test.cjs
 *
 * End-to-end pipeline verification for forward / reply-all / schedule-send.
 *
 * Unlike the structural source-grep tests, this file runs the REAL server-side
 * functions (normalizeSignatureHtml, normalizeOutboundHtml, applySignatureSendSanitizer,
 * sig strip+replace) against realistic payloads and inspects the final HTML.
 *
 * Three live paths tested:
 *   Path 1 — Forward a rich HTML email (images, tables, links, nested quotes, prior sig)
 *   Path 2 — Reply-All to a multi-message thread
 *   Path 3 — Schedule-send a forward containing quoted content
 *
 * Run with: node tests/forward-reply-live-pipeline.test.cjs
 */

const { execSync } = require("child_process");
const path         = require("path");

// ── Run the tsx pipeline simulation ─────────────────────────────────────────
let result;
try {
  const raw = execSync("npx tsx scripts/test-forward-reply-pipeline.ts", {
    encoding: "utf8",
    timeout:  60_000,
    cwd:      path.resolve(__dirname, ".."),
  });
  result = JSON.parse(raw.trim());
} catch (e) {
  console.error("FATAL: pipeline script failed:\n", e.stderr || e.message);
  process.exit(1);
}

// ── Test helpers ─────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function check(label, cond, detail) {
  if (cond) {
    console.log("  \u2713", label);
    passed++;
  } else {
    console.error("  \u2717 FAIL:", label, detail ? "\n    \u2192 " + detail : "");
    failed++;
  }
}
function has(html, str)    { return html.includes(str); }
function notHas(html, str) { return !html.includes(str); }
function sigBlockContents(html) {
  const si = html.indexOf("<!--vs-sig-start-->");
  const ei = html.indexOf("<!--vs-sig-end-->");
  if (si === -1 || ei === -1) return "";
  return html.slice(si + "<!--vs-sig-start-->".length, ei);
}

// ─────────────────────────────────────────────────────────────────────────────
// PATH 1 — Forward a rich HTML email
// ─────────────────────────────────────────────────────────────────────────────
const p1 = result.path1_forward;
console.log("\n\u2550\u2550 Path 1: Forward rich HTML email \u2550\u2550");
console.log("  Stage lengths:", p1.stages);

console.log("\n  [1a] Body content present in final HTML");
check("user text 'FYI forwarding' present",     has(p1.final_html, "FYI forwarding"));
check("'Lights. Camera. Impact.' (h2) present", has(p1.final_html, "Lights. Camera. Impact."));
check("banner image URL present",               has(p1.final_html, "header-1200x400.jpg"));
check("'47% YoY' revenue stat present",         has(p1.final_html, "47%"));
check("table row 'Pacific Northwest' present",  has(p1.final_html, "Pacific Northwest"));
check("table row '$284,000' present",           has(p1.final_html, "$284,000"));
check("table row 'Great Lakes' present",        has(p1.final_html, "Great Lakes"));
check("table row '$406,000' present",           has(p1.final_html, "$406,000"));
check("Download Report link present",           has(p1.final_html, "https://voltsafe.com/q3-report"));
check("Forwarded message header present",       has(p1.final_html, "Forwarded message"));
check("From: jane@ocean.com header present",    has(p1.final_html, "jane@ocean.com"));
check("Subject header present",                 has(p1.final_html, "Your Story Deserves the Spotlight"));

console.log("\n  [1b] Nested quoted replies preserved");
check("nested quote 'prev@partner.com' present",   has(p1.final_html, "prev@partner.com"));
check("nested quote 'marina is very happy' present",  has(p1.final_html, "marina is very happy"));
check("nested quote 'Q3 update coming' present",    has(p1.final_html, "Q3 update coming next week"));

console.log("\n  [1c] Prior signature from original email preserved");
check("prior sig \"Canada's Ocean Supercluster\" present", has(p1.final_html, "Canada"));
check("prior sig 'Jane Doe' present",              has(p1.final_html, "Jane Doe"));

console.log("\n  [1d] VoltSafe signature appended correctly");
check("VoltSafe sig 'TREVOR BURGESS' present",     has(p1.final_html, "TREVOR BURGESS"));
check("VoltSafe sig watch-demo.jpg present",       has(p1.final_html, "watch-demo.jpg"));
check("exactly one sig marker block",              p1.sig_block_count === 1,
  "sig_block_count=" + p1.sig_block_count);

console.log("\n  [1e] Forward content is OUTSIDE the signature marker block");
const p1Sig = sigBlockContents(p1.final_html);
check("'Lights. Camera. Impact.' NOT inside sig block",
  notHas(p1Sig, "Lights. Camera. Impact."),
  "forwarded h2 found inside sig block");
check("'Pacific Northwest' NOT inside sig block",
  notHas(p1Sig, "Pacific Northwest"),
  "forwarded table data found inside sig block");
check("banner image NOT inside sig block",
  notHas(p1Sig, "header-1200x400.jpg"),
  "forwarded image found inside sig block");
check("nested quotes NOT inside sig block",
  notHas(p1Sig, "marina is very happy"),
  "nested quoted reply found inside sig block");
check("Forwarded-message header NOT inside sig block",
  notHas(p1Sig, "Forwarded message"),
  "forwarded block header found inside sig block");

console.log("\n  [1f] User text comes before quoted block");
const p1Body = p1.body_before_sig;
check("user text in body-before-sig",  has(p1Body, "FYI forwarding"));
check("forward header in body-before-sig",
  has(p1Body, "Forwarded message"),
  "forwarded block not found before sig marker");

// ─────────────────────────────────────────────────────────────────────────────
// PATH 2 — Reply-All to a multi-message thread
// ─────────────────────────────────────────────────────────────────────────────
const p2 = result.path2_reply_all;
console.log("\n\u2550\u2550 Path 2: Reply-All multi-message thread \u2550\u2550");
console.log("  Stage lengths:", p2.stages);

console.log("\n  [2a] New reply text present");
check("reply text present",              has(p2.final_html, "Happy to help"));
check("VoltSafe sig appended",           has(p2.final_html, "TREVOR BURGESS"));
check("exactly one sig marker block",    p2.sig_block_count === 1,
  "sig_block_count=" + p2.sig_block_count);

console.log("\n  [2b] Prior thread history preserved");
check("deployment timeline link present",     has(p2.final_html, "deployment timeline"));
check("pricing link present",                 has(p2.final_html, "https://voltsafe.com/pricing"));
check("Site A Pacific Northwest present",     has(p2.final_html, "Pacific Northwest Marina"));
check("Site B Great Lakes present",           has(p2.final_html, "Great Lakes Harbour"));
check("Site C Gulf Coast present",            has(p2.final_html, "Gulf Coast Marina"));

console.log("\n  [2c] Inline quoted prior message preserved");
check("trevor@voltsafe.com in inline quote",  has(p2.final_html, "trevor@voltsafe.com"));
check("inline quote text 'openings for all three' present",
  has(p2.final_html, "openings for all three sites"));
check("inline quote 'pricing details by end of week' present",
  has(p2.final_html, "pricing details by end of week"));

console.log("\n  [2d] Prior thread history is OUTSIDE the signature marker block");
const p2Sig = sigBlockContents(p2.final_html);
check("'Pacific Northwest Marina' NOT inside sig block",
  notHas(p2Sig, "Pacific Northwest Marina"),
  "quoted thread content found inside sig block");
check("'pricing details' NOT inside sig block",
  notHas(p2Sig, "pricing details"),
  "inline quoted message found inside sig block");

// ─────────────────────────────────────────────────────────────────────────────
// PATH 3 — Scheduled send with forwarded content
// ─────────────────────────────────────────────────────────────────────────────
const p3 = result.path3_schedule;
console.log("\n\u2550\u2550 Path 3: Scheduled send with forwarded content \u2550\u2550");
console.log("  Stage lengths:", p3.stages);

console.log("\n  [3a] Scheduled user text present");
check("sched user text present",         has(p3.final_html, "Scheduling this for Monday"));
check("VoltSafe sig appended",           has(p3.final_html, "TREVOR BURGESS"));
check("exactly one sig marker block",    p3.sig_block_count === 1,
  "sig_block_count=" + p3.sig_block_count);

console.log("\n  [3b] Quoted forward content preserved in scheduled email");
check("'EV charging infrastructure' present",  has(p3.final_html, "EV charging infrastructure"));
check("'Hardware (50 units)' table row present",    has(p3.final_html, "Hardware (50 units)"));
check("'$80,000' table cell present",          has(p3.final_html, "$80,000"));
check("'$25,000' installation row present",    has(p3.final_html, "$25,000"));
check("'$15,000' software row present",        has(p3.final_html, "$15,000"));
check("cfo@corp.com mailto link present",      has(p3.final_html, "mailto:cfo@corp.com"));
check("proposal link present",                 has(p3.final_html, "https://corp.com/ev-proposal"));
check("Forwarded message header present",      has(p3.final_html, "Forwarded message"));

console.log("\n  [3c] Scheduled quoted content is OUTSIDE sig markers");
const p3Sig = sigBlockContents(p3.final_html);
check("'EV charging' NOT inside sig block",
  notHas(p3Sig, "EV charging"),
  "scheduled forward content found inside sig block");
check("'$80,000' NOT inside sig block",
  notHas(p3Sig, "$80,000"),
  "scheduled forward table found inside sig block");
check("'cfo@corp.com' NOT inside sig block",
  notHas(p3Sig, "cfo@corp.com"),
  "scheduled forward link found inside sig block");

// ─────────────────────────────────────────────────────────────────────────────
// Cross-cutting: pipeline stage size checks (nothing silently drops content)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n\u2550\u2550 Pipeline stage size integrity \u2550\u2550");

check("Path 1: final HTML not shorter than input by >30% (no bulk stripping)",
  p1.stages.final_length >= p1.stages.after_emergency_strip_length * 0.7,
  "final=" + p1.stages.final_length + " input=" + p1.stages.after_emergency_strip_length);

check("Path 2: final HTML not shorter than input by >30%",
  p2.stages.final_length >= p2.stages.after_emergency_strip_length * 0.7,
  "final=" + p2.stages.final_length + " input=" + p2.stages.after_emergency_strip_length);

check("Path 3: final HTML not shorter than input by >30%",
  p3.stages.final_length >= p3.stages.after_emergency_strip_length * 0.7,
  "final=" + p3.stages.final_length + " input=" + p3.stages.after_emergency_strip_length);

check("Path 1: normalizeOutboundHtml does not drop >30% of content",
  p1.stages.after_normalize_outbound_length >= p1.stages.after_normalize_sig_length * 0.7,
  "outbound_normalizer out=" + p1.stages.after_normalize_outbound_length +
  " in=" + p1.stages.after_normalize_sig_length);

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n" + "\u2500".repeat(60));
console.log("Results: " + passed + " passed, " + failed + " failed out of " + (passed + failed) + " total");
if (failed > 0) process.exit(1);
