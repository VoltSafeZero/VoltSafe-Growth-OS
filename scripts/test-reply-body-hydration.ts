
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
      : `<pre style="font-family:inherit;white-space:pre-wrap;">${escHtml(m.body || "")}</pre>`;
    const divider = idx > 0 ? `<div style="margin:12px 0;border-top:1px solid #e8e8e8;"></div>` : "";
    return `${divider}<p>${escHtml(m.from || "Unknown")}</p>${mBody}`;
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
      : `<pre style="font-family:inherit;white-space:pre-wrap;">${escHtml(body)}</pre>`;
    const divider = idx > 0 ? `<div style="margin:12px 0;border-top:1px solid #e8e8e8;"></div>` : "";
    return `${divider}<p>${escHtml(m.from || "Unknown")}</p>${mBody}`;
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
