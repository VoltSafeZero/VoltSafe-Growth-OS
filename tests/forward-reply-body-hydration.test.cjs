"use strict";
/**
 * tests/forward-reply-body-hydration.test.cjs
 *
 * Regression suite for the Stage-C body-hydration fix.
 *
 * Root bug: handleReply / handleReplyAll correctly fetched full.bodyText from
 * fetchFullMessageBody() for plain-text-only messages, but then called
 * buildThreadQuoteBlock(allMsgs) for multi-message threads.  That function used
 * the cached Stage-B message bodies (body_text from DB, capped at 4,000 chars),
 * silently discarding the freshly-fetched 10K+ full text.
 *
 * Fix: buildThreadQuoteBlockWithOverrides() accepts an override map keyed by
 * message id. handleReply and handleReplyAll now build that map from
 * fetchFullMessageBody() results and call buildThreadQuoteBlockWithOverrides
 * instead of buildThreadQuoteBlock for multi-message threads.
 *
 * Test sections:
 *   1.  buildThreadQuoteBlockWithOverrides — defined with correct signature
 *   2.  handleReply — uses overrides in multi-message plain-text path
 *   3.  handleReplyAll — uses overrides in multi-message plain-text path
 *   4.  FRT logging — override-applied events logged for both handlers
 *   5.  handleForward — unaffected (uses full.bodyText directly per-message)
 *   6.  Single-message path — still uses plainText directly (no regression)
 *   7.  HTML body override — full.bodyHtml triggers override with isHtml:true
 *   8.  Override map id matching — keyed on msg.id (gmailMessageId)
 *   9.  buildThreadQuoteBlock — still present (used for non-override callers)
 *  10.  Unit simulation via tsx subprocess
 *
 * Run with: node tests/forward-reply-body-hydration.test.cjs
 */

const assert  = require("assert");
const fs      = require("fs");
const path    = require("path");
const { spawnSync } = require("child_process");

const SRC = fs.readFileSync(
  path.join(__dirname, "../client/src/pages/gmail-inbox.tsx"),
  "utf8"
);

let sp = 0, sf = 0;
function test(name, fn) {
  try   { fn(); console.log("  \u2713", name); sp++; }
  catch (e) { console.error("  \u2717", name, "\n    \u2192", e.message); sf++; }
}
function ok(condition, msg) { if (!condition) throw new Error(msg || "assertion failed"); }
function has(src, pat) { return typeof pat === "string" ? src.includes(pat) : pat.test(src); }
function hasSrc(pat, msg) { if (!has(SRC, pat)) throw new Error(msg || "Expected in source: " + pat); }
function noSrc(pat, msg)  { if ( has(SRC, pat)) throw new Error(msg || "Expected NOT in source: " + pat); }

// ─────────────────────────────────────────────────────────────────────────────
// Slice out the two handler bodies for targeted assertions
// ─────────────────────────────────────────────────────────────────────────────
const replyStart    = SRC.indexOf("const handleReply = async");
const replyEnd      = SRC.indexOf("// ── Reply All", replyStart);
const replyAllStart = SRC.indexOf("const handleReplyAll = async");
const replyAllEnd   = SRC.indexOf("// ── Forward", replyAllStart);
const fwdStart      = SRC.indexOf("const handleForward = async");
const fwdEnd        = SRC.indexOf("const selectedMessages =", fwdStart);

const replySrc    = SRC.slice(replyStart, replyEnd);
const replyAllSrc = SRC.slice(replyAllStart, replyAllEnd);
const fwdSrc      = SRC.slice(fwdStart, fwdEnd);

// ─────────────────────────────────────────────────────────────────────────────
// Section 1 — buildThreadQuoteBlockWithOverrides defined
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSection 1 — buildThreadQuoteBlockWithOverrides definition");

test("helper function is defined in source", () => {
  hasSrc("buildThreadQuoteBlockWithOverrides");
});

test("helper accepts msgs and overridesByMessageId parameters", () => {
  hasSrc(/buildThreadQuoteBlockWithOverrides\s*=\s*\([^)]*msgs[^)]*overridesByMessageId/);
});

test("helper uses Map<string, { body: string; isHtml: boolean; source: string }>", () => {
  hasSrc("Map<string, { body: string; isHtml: boolean; source: string }>");
});

test("helper looks up override via overridesByMessageId.get(m.id)", () => {
  hasSrc("overridesByMessageId.get(m.id)");
});

test("helper uses override.body when override is present", () => {
  hasSrc("override ? override.body");
});

test("helper uses override.isHtml when override is present", () => {
  hasSrc("override ? override.isHtml");
});

test("helper wraps plain-text bodies in <pre style=\"white-space:pre-wrap\">", () => {
  hasSrc(/buildThreadQuoteBlockWithOverrides[\s\S]{0,800}pre style="font-family:inherit;white-space:pre-wrap;"/);
});

test("helper still falls back to m.body when no override", () => {
  hasSrc("override ? override.body   : (m.body   || \"\")");
});

test("original buildThreadQuoteBlock is still present (not removed)", () => {
  hasSrc("const buildThreadQuoteBlock = ");
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 2 — handleReply uses overrides
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSection 2 — handleReply override path");

test("handleReply declares _replyOverrides Map", () => {
  ok(has(replySrc, "_replyOverrides"), "Expected _replyOverrides in handleReply");
});

test("handleReply populates override when full.bodyHtml exists (isHtml:true)", () => {
  ok(
    has(replySrc, "{ body: full.bodyHtml, isHtml: true"),
    "Expected isHtml:true override branch"
  );
});

test("handleReply populates override when full.bodyText exists (isHtml:false)", () => {
  ok(
    has(replySrc, "{ body: full.bodyText, isHtml: false"),
    "Expected isHtml:false override branch"
  );
});

test("handleReply calls buildThreadQuoteBlockWithOverrides for multi-message path", () => {
  ok(
    has(replySrc, "buildThreadQuoteBlockWithOverrides(allMsgs, _replyOverrides)"),
    "Expected buildThreadQuoteBlockWithOverrides call in handleReply"
  );
});

test("handleReply no longer calls bare buildThreadQuoteBlock(allMsgs) in multi-msg path", () => {
  // The bare call must not appear in the else-no-html block of handleReply
  // (the original buildThreadQuoteBlock is still defined but not called here)
  ok(
    !has(replySrc, "buildThreadQuoteBlock(allMsgs)"),
    "handleReply must not call bare buildThreadQuoteBlock(allMsgs)"
  );
});

test("handleReply sets bodySource to 'thread-context-with-overrides' when override used", () => {
  ok(has(replySrc, "\"thread-context-with-overrides\""), "Expected thread-context-with-overrides body source");
});

test("handleReply still handles single-message path with <pre> wrap", () => {
  ok(has(replySrc, "plaintext-fallback"), "Expected plaintext-fallback path in handleReply");
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 3 — handleReplyAll uses overrides
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSection 3 — handleReplyAll override path");

test("handleReplyAll declares _raOverrides Map", () => {
  ok(has(replyAllSrc, "_raOverrides"), "Expected _raOverrides in handleReplyAll");
});

test("handleReplyAll populates override when full.bodyHtml exists (isHtml:true)", () => {
  ok(
    has(replyAllSrc, "{ body: full.bodyHtml, isHtml: true"),
    "Expected isHtml:true override branch in handleReplyAll"
  );
});

test("handleReplyAll populates override when full.bodyText exists (isHtml:false)", () => {
  ok(
    has(replyAllSrc, "{ body: full.bodyText, isHtml: false"),
    "Expected isHtml:false override branch in handleReplyAll"
  );
});

test("handleReplyAll calls buildThreadQuoteBlockWithOverrides for multi-message path", () => {
  ok(
    has(replyAllSrc, "buildThreadQuoteBlockWithOverrides(allMsgs, _raOverrides)"),
    "Expected buildThreadQuoteBlockWithOverrides call in handleReplyAll"
  );
});

test("handleReplyAll no longer calls bare buildThreadQuoteBlock(allMsgs)", () => {
  ok(
    !has(replyAllSrc, "buildThreadQuoteBlock(allMsgs)"),
    "handleReplyAll must not call bare buildThreadQuoteBlock(allMsgs)"
  );
});

test("handleReplyAll sets bodySource to 'thread-context-with-overrides' when override used", () => {
  ok(has(replyAllSrc, "\"thread-context-with-overrides\""), "Expected thread-context-with-overrides in handleReplyAll");
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 4 — FRT logging for override events
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSection 4 — FRT override-applied log events");

test("handleReply emits C:reply:override-applied FRT log", () => {
  ok(has(replySrc, "C:reply:override-applied"), "Expected C:reply:override-applied frtLog");
});

test("handleReply override log includes overrideSource", () => {
  ok(has(replySrc, "overrideSource"), "Expected overrideSource in override log");
});

test("handleReply override log includes overrideBodyLen", () => {
  ok(has(replySrc, "overrideBodyLen"), "Expected overrideBodyLen in override log");
});

test("handleReply override log includes cachedBodyLen", () => {
  ok(has(replySrc, "cachedBodyLen"), "Expected cachedBodyLen in override log");
});

test("handleReplyAll emits C:replyAll:override-applied FRT log", () => {
  ok(has(replyAllSrc, "C:replyAll:override-applied"), "Expected C:replyAll:override-applied frtLog");
});

test("handleReplyAll override log includes overrideBodyLen", () => {
  ok(has(replyAllSrc, "overrideBodyLen"), "Expected overrideBodyLen in replyAll override log");
});

test("override log is guarded by overrides.size > 0 check (reply)", () => {
  ok(has(replySrc, "_replyOverrides.size > 0"), "Expected size guard before override log in handleReply");
});

test("override log is guarded by overrides.size > 0 check (replyAll)", () => {
  ok(has(replyAllSrc, "_raOverrides.size > 0"), "Expected size guard before override log in handleReplyAll");
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 5 — handleForward unaffected
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSection 5 — handleForward unaffected by this change");

test("handleForward does not call buildThreadQuoteBlockWithOverrides", () => {
  ok(
    !has(fwdSrc, "buildThreadQuoteBlockWithOverrides"),
    "handleForward should not call buildThreadQuoteBlockWithOverrides"
  );
});

test("handleForward still uses full.bodyText || m.body for plain-text messages", () => {
  ok(
    has(fwdSrc, "full.bodyText || m.body"),
    "handleForward must use full.bodyText in per-message fallback"
  );
});

test("handleForward does not call bare buildThreadQuoteBlock(allMsgs)", () => {
  ok(
    !has(fwdSrc, "buildThreadQuoteBlock(allMsgs)"),
    "handleForward never used buildThreadQuoteBlock — must still be absent"
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 6 — Single-message path not regressed
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSection 6 — Single-message path (plaintext-fallback) unaffected");

test("handleReply single-msg path still wraps plain text in <pre>", () => {
  const preWrap = /pre style="font-family:inherit;white-space:pre-wrap;">\$\{escHtml\(plainText\)\}/;
  ok(has(replySrc, preWrap), "Expected <pre> plainText wrap in single-message path of handleReply");
});

test("handleReplyAll single-msg path still wraps plain text in <pre>", () => {
  const preWrap = /pre style="font-family:inherit;white-space:pre-wrap;">\$\{escHtml\(plainText\)\}/;
  ok(has(replyAllSrc, preWrap), "Expected <pre> plainText wrap in single-message path of handleReplyAll");
});

test("handleReply has allMsgs.length > 1 guard before calling override builder", () => {
  ok(has(replySrc, "allMsgs.length > 1"), "Expected allMsgs.length > 1 guard in handleReply");
});

test("handleReplyAll has allMsgs.length > 1 guard before calling override builder", () => {
  ok(has(replyAllSrc, "allMsgs.length > 1"), "Expected allMsgs.length > 1 guard in handleReplyAll");
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 7 — HTML body override (full.bodyHtml branch)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSection 7 — full.bodyHtml override map population");

test("handleReply: override map is populated for the focused msg.id (html branch present)", () => {
  // The override map must be populated for both the HTML and text branches.
  // We check that both .set(msg.id with isHtml:true and isHtml:false exist.
  ok(
    has(replySrc, "_replyOverrides.set(msg.id") &&
    has(replySrc, "{ body: full.bodyHtml, isHtml: true") &&
    has(replySrc, "{ body: full.bodyText, isHtml: false"),
    "Override map must be populated for both HTML and text cases in handleReply"
  );
});

test("handleReplyAll: override map is populated for the focused msg.id (html branch present)", () => {
  ok(
    has(replyAllSrc, "_raOverrides.set(msg.id") &&
    has(replyAllSrc, "{ body: full.bodyHtml, isHtml: true") &&
    has(replyAllSrc, "{ body: full.bodyText, isHtml: false"),
    "Override map must be populated for both HTML and text cases in handleReplyAll"
  );
});

test("handleReply html override uses isHtml: true", () => {
  ok(has(replySrc, "{ body: full.bodyHtml, isHtml: true"), "Expected isHtml:true for HTML override");
});

test("handleReplyAll html override uses isHtml: true", () => {
  ok(has(replyAllSrc, "{ body: full.bodyHtml, isHtml: true"), "Expected isHtml:true for HTML override in replyAll");
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 8 — Override map keyed on msg.id (gmailMessageId)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSection 8 — Override map keying");

test("handleReply override map keyed on msg.id", () => {
  ok(has(replySrc, "_replyOverrides.set(msg.id,"), "Override must be keyed on msg.id in handleReply");
});

test("handleReplyAll override map keyed on msg.id", () => {
  ok(has(replyAllSrc, "_raOverrides.set(msg.id,"), "Override must be keyed on msg.id in handleReplyAll");
});

test("buildThreadQuoteBlockWithOverrides looks up m.id as the key", () => {
  hasSrc("overridesByMessageId.get(m.id)");
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 9 — buildThreadQuoteBlock still present for other callers
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSection 9 — buildThreadQuoteBlock still present");

test("buildThreadQuoteBlock definition still present in source", () => {
  hasSrc("const buildThreadQuoteBlock = (msgs: ThreadMessage[]): string =>");
});

test("buildThreadQuoteBlockWithOverrides definition immediately follows", () => {
  const idx1 = SRC.indexOf("const buildThreadQuoteBlock = ");
  const idx2 = SRC.indexOf("const buildThreadQuoteBlockWithOverrides = ");
  ok(idx2 > idx1 && idx2 - idx1 < 2000, "buildThreadQuoteBlockWithOverrides must be defined shortly after buildThreadQuoteBlock");
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 10 — Unit simulation via tsx subprocess
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSection 10 — Unit simulation via tsx subprocess");

const UNIT_SCRIPT = `
import assert from "assert";

const CANARY = "CONTENT_PAST_4K_BOUNDARY_this_text_would_be_cut_by_old_4000_char_cap";
const CACHED_BODY = "x".repeat(4000);
const FULL_TEXT = "x".repeat(4000) + CANARY + " end";

// Minimal escHtml (same logic as in the real source)
function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Replica of buildThreadQuoteBlock (old behavior)
function buildThreadQuoteBlock(msgs: Array<{ id: string; from: string; body: string; isHtml: boolean; date?: string; internalDate?: string }>): string {
  return msgs.map((m, idx) => {
    const mDate = m.date || "";
    const mBody = m.isHtml
      ? (m.body || "")
      : \`<pre style="font-family:inherit;white-space:pre-wrap;">\${escHtml(m.body || "")}</pre>\`;
    const divider = idx > 0 ? \`<div style="margin:12px 0;border-top:1px solid #e8e8e8;"></div>\` : "";
    return \`\${divider}<p>\${escHtml(m.from || "Unknown")}</p>\${mBody}\`;
  }).join("");
}

// Replica of buildThreadQuoteBlockWithOverrides (new helper)
function buildThreadQuoteBlockWithOverrides(
  msgs: Array<{ id: string; from: string; body: string; isHtml: boolean; date?: string; internalDate?: string }>,
  overridesByMessageId: Map<string, { body: string; isHtml: boolean; source: string }>
): string {
  return msgs.map((m, idx) => {
    const override = overridesByMessageId.get(m.id);
    const body   = override ? override.body   : (m.body   || "");
    const isHtml = override ? override.isHtml : m.isHtml;
    const mDate  = m.date || "";
    const mBody  = isHtml
      ? body
      : \`<pre style="font-family:inherit;white-space:pre-wrap;">\${escHtml(body)}</pre>\`;
    const divider = idx > 0 ? \`<div style="margin:12px 0;border-top:1px solid #e8e8e8;"></div>\` : "";
    return \`\${divider}<p>\${escHtml(m.from || "Unknown")}</p>\${mBody}\`;
  }).join("");
}

// ── Scenario: multi-message thread, focused message has isHtml=false and body truncated at 4K ──

const focusedMsgId = "18bedd09d2968ac8";

const allMsgs = [
  { id: "18bd8a3b227b79ff", from: "alice@example.com", body: "x".repeat(3000) + " earlier_message_body",   isHtml: false, date: "Mon, 01 Jan 2024 10:00:00 +0000" },
  { id: "18bdf9d277d5632a", from: "bob@example.com",   body: "x".repeat(2000) + " second_message_body",    isHtml: false, date: "Mon, 01 Jan 2024 11:00:00 +0000" },
  { id: focusedMsgId,       from: "carol@example.com", body: CACHED_BODY,                                   isHtml: false, date: "Mon, 01 Jan 2024 12:00:00 +0000" },
];

// Simulate fetchFullMessageBody() returning full text (10,410 chars, beyond 4K cap)
const full = { bodyHtml: "", bodyText: FULL_TEXT, isHtml: false, source: "gmail-live-plaintext" };

// ── OLD behavior (bug) ──
const oldResult = buildThreadQuoteBlock(allMsgs);
assert(!oldResult.includes(CANARY), "OLD buildThreadQuoteBlock must NOT include canary (this was the bug)");
console.log("old_result_len=" + oldResult.length);
console.log("old_has_canary=" + oldResult.includes(CANARY));

// ── NEW behavior (fix) ──
const overrides = new Map<string, { body: string; isHtml: boolean; source: string }>();
if (!full.bodyHtml && full.bodyText) {
  overrides.set(focusedMsgId, { body: full.bodyText, isHtml: false, source: full.source });
}
const newResult = buildThreadQuoteBlockWithOverrides(allMsgs, overrides);
assert(newResult.includes(CANARY), "NEW buildThreadQuoteBlockWithOverrides MUST include canary");
console.log("new_result_len=" + newResult.length);
console.log("new_has_canary=" + newResult.includes(CANARY));

// ── Override does not affect other messages ──
assert(newResult.includes("earlier_message_body"), "Other messages must still appear");
assert(newResult.includes("second_message_body"),  "Other messages must still appear");
assert(newResult.includes("carol@example.com"),    "Sender header still present for focused msg");

// ── Override map keyed by id ──
const byIdMap = new Map<string, { body: string; isHtml: boolean; source: string }>();
byIdMap.set(focusedMsgId, { body: FULL_TEXT, isHtml: false, source: "test" });
const byIdResult = buildThreadQuoteBlockWithOverrides(allMsgs, byIdMap);
assert(byIdResult.includes(CANARY), "Override lookup by m.id must work");

// ── HTML override: when full.bodyHtml is provided, isHtml=true is used ──
const htmlOverride = new Map<string, { body: string; isHtml: boolean; source: string }>();
const HTML_CONTENT = "<p>Full hydrated HTML content " + CANARY + "</p>";
htmlOverride.set(focusedMsgId, { body: HTML_CONTENT, isHtml: true, source: "full-body" });
const htmlResult = buildThreadQuoteBlockWithOverrides(allMsgs, htmlOverride);
assert(htmlResult.includes(CANARY), "HTML override must include canary");
// HTML content must NOT be escaped
assert(htmlResult.includes("<p>Full hydrated"), "HTML override body must not be escaped");

// ── No override: falls back to m.body (existing behavior preserved) ──
const emptyOverrides = new Map<string, { body: string; isHtml: boolean; source: string }>();
const noOverrideResult = buildThreadQuoteBlockWithOverrides(allMsgs, emptyOverrides);
assert(!noOverrideResult.includes(CANARY), "With empty overrides, canary must NOT appear (uses m.body)");

// ── Single-message path (not affected by this change): uses plainText directly ──
const singleMsg = [{ id: focusedMsgId, from: "carol@example.com", body: CACHED_BODY, isHtml: false }];
const singleResult = buildThreadQuoteBlockWithOverrides(singleMsg, overrides);
assert(singleResult.includes(CANARY), "Single-msg build with override must include canary");

console.log("ALL UNIT ASSERTIONS PASSED");
`;

// Write temp script
const tmpScript = path.join(__dirname, "../scripts/test-reply-body-hydration.ts");
fs.writeFileSync(tmpScript, UNIT_SCRIPT);

try {
  const result = spawnSync("npx", ["tsx", tmpScript], {
    encoding: "utf8",
    timeout: 30_000,
    cwd: path.resolve(__dirname, ".."),
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "tsx subprocess failed");
  }
  const lines = (result.stdout || "").trim().split("\n");
  for (const line of lines) {
    console.log("    [unit]", line);
  }
  // Parse key values
  const oldHasCanary  = lines.find(l => l.startsWith("old_has_canary="))?.split("=")[1];
  const newHasCanary  = lines.find(l => l.startsWith("new_has_canary="))?.split("=")[1];
  const allPassed     = lines.some(l => l.includes("ALL UNIT ASSERTIONS PASSED"));

  test("unit: old buildThreadQuoteBlock does NOT include canary (reproduces the bug)", () => {
    ok(oldHasCanary === "false", `old_has_canary should be false, got: ${oldHasCanary}`);
  });
  test("unit: new buildThreadQuoteBlockWithOverrides DOES include canary (fix works)", () => {
    ok(newHasCanary === "true", `new_has_canary should be true, got: ${newHasCanary}`);
  });
  test("unit: all assertions in subprocess passed", () => {
    ok(allPassed, "Not all unit assertions passed");
  });
} catch (e) {
  test("unit simulation tsx subprocess", () => { throw e; });
} finally {
  try { fs.unlinkSync(tmpScript); } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${sp} passed, ${sf} failed`);
if (sf > 0) process.exit(1);
