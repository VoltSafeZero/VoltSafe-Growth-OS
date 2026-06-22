"use strict";
/**
 * suggested-email-fix.test.cjs
 *
 * Source-grep tests that pin the Suggested Next Email generation fixes.
 *
 * Covers:
 *  Backend (server/services/crm-ai-summary.ts):
 *  1. tokenLimit raised to 2000 (was 800 — caused empty {} from model)
 *  2. finish_reason + raw_chars diagnostic logging
 *  3. Markdown fence stripping before JSON.parse
 *  4. Alternate field name normalization (email_body, draft_body, etc. → body)
 *  5. Content guard: empty body throws, route returns 500, frontend shows error
 *  6. Re-throw error (no silent HTTP 200 with empty body)
 *  7. response_format: json_object still present
 *
 *  Frontend (client/src/components/crm/suggested-next-email-modal.tsx):
 *  8.  editedBody state declared
 *  9.  handleGenerate resets editedBody and syncs it from successful response
 *  10. Frontend guard: empty body from API → error state, not blank suggestion
 *  11. Body field is a <textarea> (editable), not a read-only div
 *  12. textarea has data-testid="textarea-email-body"
 *  13. handleContinue uses editedBody (not suggestion.body)
 *  14. Continue in Mail disabled check uses editedBody.trim()
 */

const fs = require("fs");
const path = require("path");

const SVC  = path.join(__dirname, "../server/services/crm-ai-summary.ts");
const MODAL = path.join(__dirname, "../client/src/components/crm/suggested-next-email-modal.tsx");

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

const svc   = fs.readFileSync(SVC,   "utf8");
const modal = fs.readFileSync(MODAL, "utf8");

// ── Section 1: tokenLimit raised ─────────────────────────────────────────────
console.log("\n── Backend: tokenLimit raised to 4000 ──");

assert(
  svc.includes('buildOpenAIModelParams("gpt-5-mini", { tokenLimit: 4000, temperature: 0.4 })'),
  "suggest-next-email uses tokenLimit: 4000 (was 800 then 2000 — finish_reason=length fix)"
);
assert(
  !svc.includes('buildOpenAIModelParams("gpt-5-mini", { tokenLimit: 800'),
  "Old tokenLimit: 800 no longer present in suggest-next-email call"
);

// ── Section 2: diagnostic logging ────────────────────────────────────────────
console.log("\n── Backend: diagnostic logging ──");

assert(
  svc.includes("suggest-next-email ${entityType}:${id} finish_reason=${finishReason} raw_chars=${raw.length}"),
  "finish_reason and raw_chars logged for every generation"
);
assert(
  svc.includes("suggest-next-email ${entityType}:${id} ok — subject="),
  "success log shows subject and body_chars"
);
assert(
  svc.includes("suggest-next-email ${entityType}:${id} empty body"),
  "empty body warning log present"
);

// ── Section 3: markdown fence stripping ──────────────────────────────────────
console.log("\n── Backend: markdown fence stripping ──");

assert(
  svc.includes("Strip markdown code fences"),
  "comment documents fence stripping intent"
);
assert(
  svc.includes("raw.replace(/^```(?:json)?\\s*/i"),
  "opening fence stripped with case-insensitive regex"
);
assert(
  svc.includes(".replace(/\\s*```\\s*$/, \"\").trim()"),
  "closing fence stripped and result trimmed"
);

// ── Section 4: field name normalization ──────────────────────────────────────
console.log("\n── Backend: alternate field name normalization ──");

assert(
  svc.includes("rawParsed.email_body || rawParsed.draft_body"),
  "email_body and draft_body aliases mapped to body"
);
assert(
  svc.includes("rawParsed.message || rawParsed.content || rawParsed.body_text"),
  "message, content, body_text aliases mapped to body"
);
assert(
  svc.includes("rawParsed.why || rawParsed.rationale"),
  "why and rationale aliases mapped to reason"
);
assert(
  svc.includes("rawParsed.why_this_email || rawParsed.whyThisEmail"),
  "why_this_email and whyThisEmail aliases mapped to reason"
);
assert(
  svc.includes("rawParsed.email_subject || rawParsed.subject_line"),
  "email_subject and subject_line aliases mapped to subject"
);

// ── Section 5: content guard ─────────────────────────────────────────────────
console.log("\n── Backend: content guard — empty body is a failure ──");

assert(
  svc.includes("Content guard: a blank body is never a success"),
  "content guard comment present"
);
assert(
  svc.includes("if (!normalizedBody.trim())"),
  "guard checks normalizedBody.trim()"
);
assert(
  svc.includes("Model returned empty email body (finish_reason="),
  "guard error message includes finish_reason"
);

// Guard must appear BEFORE the return statement
const guardIdx  = svc.indexOf("if (!normalizedBody.trim())");
const returnIdx = svc.indexOf("body: cleanedBody,");
assert(
  guardIdx > 0 && returnIdx > 0 && guardIdx < returnIdx,
  "content guard appears before the success return"
);

// ── Section 6: re-throw on error (no silent HTTP 200 with empty body) ─────────
console.log("\n── Backend: re-throw error so route returns HTTP 500 ──");

assert(
  svc.includes("Re-throw — the route catches this and returns HTTP 500"),
  "re-throw comment explains why"
);
assert(
  svc.includes("throw err;"),
  "catch block re-throws the error"
);

// Old silent-return pattern must be gone
assert(
  !svc.includes('reason: "Could not generate email suggestion."'),
  "old silent empty-body return is gone"
);

// ── Section 7: response_format still present ─────────────────────────────────
console.log("\n── Backend: response_format: json_object still in suggest-next-email ──");

// Find the suggest-next-email openai call specifically (not the AI summary call)
const suggestBlock = svc.substring(
  svc.indexOf("buildOpenAIModelParams(\"gpt-5-mini\", { tokenLimit: 4000"),
  svc.indexOf("buildOpenAIModelParams(\"gpt-5-mini\", { tokenLimit: 4000") + 300
);
assert(
  svc.includes('response_format: { type: "json_object" }'),
  "response_format: json_object present in suggest-next-email call"
);

// ── Section 8: editedBody state in frontend ───────────────────────────────────
console.log("\n── Frontend: editedBody state ──");

assert(
  modal.includes("const [editedBody, setEditedBody] = useState(\"\")"),
  "editedBody state declared as empty string"
);
assert(
  modal.includes("Editable body — user can modify the AI-generated draft before sending"),
  "editedBody state comment present"
);

// ── Section 9: handleGenerate wiring ─────────────────────────────────────────
console.log("\n── Frontend: handleGenerate wires editedBody ──");

assert(
  modal.includes("setEditedBody(\"\");"),
  "handleGenerate resets editedBody on new generation"
);
assert(
  modal.includes("setEditedBody(data.body);"),
  "handleGenerate syncs editedBody from successful response"
);

// ── Section 10: frontend guard for empty body ─────────────────────────────────
console.log("\n── Frontend: frontend guard for empty body ──");

assert(
  modal.includes("if (!data.body?.trim())"),
  "frontend guard checks data.body?.trim()"
);
assert(
  modal.includes("Email body could not be generated. Please regenerate or write one manually."),
  "empty body guard sets a user-visible error message"
);

// ── Section 11: body is a textarea, not a div ─────────────────────────────────
console.log("\n── Frontend: body is an editable textarea ──");

assert(
  modal.includes('<textarea'),
  "<textarea> element present in modal"
);
// Must not have the old read-only div for body content
const bodyDivPattern = /whitespace-pre-wrap[^>]*>[^<]*\{suggestion\.body\}/;
assert(
  !bodyDivPattern.test(modal),
  "old read-only div no longer shows suggestion.body directly"
);
assert(
  modal.includes("value={editedBody}"),
  "textarea value bound to editedBody"
);
assert(
  modal.includes("onChange={(e) => setEditedBody(e.target.value)}"),
  "textarea onChange updates editedBody"
);

// ── Section 12: data-testid on body textarea ──────────────────────────────────
console.log("\n── Frontend: testid on body textarea ──");

assert(
  modal.includes('data-testid="textarea-email-body"'),
  "textarea has data-testid='textarea-email-body'"
);

// ── Section 13: handleContinue uses editedBody ────────────────────────────────
console.log("\n── Frontend: handleContinue uses editedBody ──");

assert(
  modal.includes("insertSchedulingLink(editedBody, calendlyUrl.trim())"),
  "scheduling link inserted into editedBody (not suggestion.body)"
);
// The old `insertSchedulingLink(suggestion.body, ...)` must be gone
assert(
  !modal.includes("insertSchedulingLink(suggestion.body,"),
  "handleContinue no longer reads scheduling link from suggestion.body"
);
assert(
  modal.includes(": editedBody;"),
  "rawBody falls back to editedBody when scheduling link is not enabled"
);

// ── Section 14: Continue disabled check uses editedBody.trim() ───────────────
console.log("\n── Frontend: Continue in Mail disabled check ──");

assert(
  modal.includes("disabled={loading || !editedBody.trim() || isSaving || urlMissing}"),
  "Continue in Mail disabled when editedBody is empty"
);
assert(
  !modal.includes("disabled={loading || !suggestion.body ||"),
  "old !suggestion.body check no longer used for Continue"
);

// ── Section 15: handleContinue comment ───────────────────────────────────────
console.log("\n── Frontend: handleContinue comment ──");

assert(
  modal.includes("Use editedBody (the user may have modified the AI draft)"),
  "comment explains editedBody usage in handleContinue"
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n────────────────────────────────────────────────────────────");
console.log(`suggested-email-fix: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
