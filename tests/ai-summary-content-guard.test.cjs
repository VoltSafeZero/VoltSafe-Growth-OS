"use strict";
/**
 * ai-summary-content-guard.test.cjs
 *
 * Source-grep tests that pin the AI Summary content guard and hasContent fix.
 *
 * Covers:
 *  1. Backend: content validation guard in generateCrmAiSummary
 *  2. Backend: tokenLimit raised to 3000 so model has room to complete JSON
 *  3. Backend: finish_reason logging present
 *  4. Frontend: hasContent requires actual non-empty fields (not just a truthy {})
 *  5. openai-compat: buildOpenAIModelParams does not touch response_format or messages
 */

const fs = require("fs");
const path = require("path");

const SUMMARY_SVC = path.join(__dirname, "../server/services/crm-ai-summary.ts");
const SUMMARY_CARD = path.join(__dirname, "../client/src/components/crm/ai-summary-card.tsx");
const COMPAT = path.join(__dirname, "../server/services/openai-compat.ts");

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

const svc  = fs.readFileSync(SUMMARY_SVC,  "utf8");
const card = fs.readFileSync(SUMMARY_CARD, "utf8");
const compat = fs.readFileSync(COMPAT, "utf8");

// ── Section 1: tokenLimit raised to 3000 ─────────────────────────────────────
console.log("\n── Backend: tokenLimit raised to 3000 ──");

assert(
  svc.includes('buildOpenAIModelParams("gpt-5-mini", { tokenLimit: 3000, temperature: 0.3 })'),
  "AI summary uses tokenLimit: 3000 (was 1200 — caused empty {} from model)"
);
assert(
  !svc.includes('buildOpenAIModelParams("gpt-5-mini", { tokenLimit: 1200'),
  "Old tokenLimit: 1200 no longer present in summary generation call"
);

// ── Section 2: content validation guard ──────────────────────────────────────
console.log("\n── Backend: content validation guard ──");

assert(
  svc.includes("const hasAnyContent = !!"),
  "hasAnyContent guard declared in generateCrmAiSummary"
);
assert(
  svc.includes("parsed.executiveSummary") && svc.includes("parsed.keyPeople"),
  "guard checks executiveSummary and keyPeople"
);
assert(
  svc.includes("parsed.currentStatus"),
  "guard checks currentStatus"
);
assert(
  svc.includes("parsed.opportunitiesAndRisks") && svc.includes("parsed.suggestedNextSteps"),
  "guard checks opportunitiesAndRisks and suggestedNextSteps"
);
assert(
  svc.includes("parsed.relevantHistory"),
  "guard checks relevantHistory"
);
assert(
  svc.includes("if (!hasAnyContent)"),
  "guard throws when all fields are empty"
);
assert(
  svc.includes("Model returned empty content"),
  "guard error message mentions empty content"
);
assert(
  svc.includes("Previous summary preserved"),
  "guard message confirms previous summary is preserved"
);

// ── Section 3: empty content never saved as success ───────────────────────────
console.log("\n── Backend: empty content never overwrites good summary ──");

// The guard THROWS before the UPDATE query when content is empty.
// Verify that the throw comes BEFORE the UPDATE by checking order in the file.
const guardIdx   = svc.indexOf("if (!hasAnyContent)");
const updateIdx  = svc.indexOf("status = 'success'");
assert(
  guardIdx > 0 && updateIdx > 0 && guardIdx < updateIdx,
  "content guard appears before the UPDATE success query"
);

// On failure the catch block only updates status/error_message — never summary_json (in SQL)
const catchBlock = svc.substring(svc.indexOf("} catch (err: any) {"), svc.indexOf("console.error(`[crm-ai-summary]") + 200);
assert(
  !catchBlock.includes("summary_json ="),
  "catch block never sets summary_json in SQL — previous good summary preserved on failure"
);

// ── Section 4: finish_reason and raw logging ──────────────────────────────────
console.log("\n── Backend: diagnostic logging ──");

assert(
  svc.includes("finishReason = completion.choices[0]?.finish_reason"),
  "finishReason captured from completion"
);
assert(
  svc.includes("finish_reason=${finishReason} raw_chars=${raw.length}"),
  "finish_reason and raw_chars logged for every generation"
);
assert(
  svc.includes("finish_reason=${finishReason}) — preserving previous summary"),
  "empty content warning log includes finish_reason"
);
assert(
  svc.includes("sections: executiveSummary="),
  "success log shows which sections were populated"
);

// ── Section 5: frontend hasContent requires actual fields ─────────────────────
console.log("\n── Frontend: hasContent requires non-empty fields ──");

assert(
  card.includes("Content requires at least one non-empty field"),
  "hasContent comment explains the {} guard"
);
assert(
  card.includes("s.summaryJson.executiveSummary ||"),
  "hasContent checks executiveSummary"
);
assert(
  card.includes("s.summaryJson.keyPeople && s.summaryJson.keyPeople.length > 0"),
  "hasContent checks keyPeople.length"
);
assert(
  card.includes("s.summaryJson.currentStatus ||"),
  "hasContent checks currentStatus"
);
assert(
  card.includes("s.summaryJson.opportunitiesAndRisks && s.summaryJson.opportunitiesAndRisks.length > 0"),
  "hasContent checks opportunitiesAndRisks.length"
);
assert(
  card.includes("s.summaryJson.suggestedNextSteps && s.summaryJson.suggestedNextSteps.length > 0"),
  "hasContent checks suggestedNextSteps.length"
);
assert(
  card.includes("s.summaryJson.relevantHistory && s.summaryJson.relevantHistory.length > 0"),
  "hasContent checks relevantHistory.length"
);

// ── Section 6: response_format not touched by buildOpenAIModelParams ──────────
console.log("\n── openai-compat: response_format and messages untouched ──");

assert(
  !compat.includes("response_format"),
  "buildOpenAIModelParams never touches response_format"
);
assert(
  !compat.includes("result.messages"),
  "buildOpenAIModelParams never sets messages in result object"
);
assert(
  !compat.includes("result.model"),
  "buildOpenAIModelParams never sets model in result object"
);

// ── Section 7: response_format still present at the call site ─────────────────
console.log("\n── Backend: response_format still passed at call site ──");

assert(
  svc.includes('response_format: { type: "json_object" }'),
  "crm-ai-summary.ts still passes response_format: json_object"
);

// ── Section 8: key rendering logic untouched in card ─────────────────────────
console.log("\n── Frontend: key rendering paths intact ──");

assert(
  card.includes("json.executiveSummary &&"),
  "executiveSummary section still renders"
);
assert(
  card.includes("json.keyPeople && json.keyPeople.length > 0"),
  "Key People section still renders when keyPeople exist"
);
assert(
  card.includes("data-testid=\"key-people-list\""),
  "key-people-list testid present"
);
assert(
  card.includes("data-testid=\"button-compose-new-email-from-summary\""),
  "Compose New Email button still present"
);
assert(
  card.includes("data-testid=\"button-suggest-next-email\""),
  "Suggested Email button still present"
);
assert(
  card.includes("json.opportunitiesAndRisks && json.opportunitiesAndRisks.length > 0"),
  "Opportunities & Risks section still renders"
);
assert(
  card.includes("json.suggestedNextSteps && json.suggestedNextSteps.length > 0"),
  "Suggested Next Steps section still renders"
);
assert(
  card.includes("json.relevantHistory && json.relevantHistory.length > 0"),
  "Key History section still renders"
);

// ── Section 9: failed state still preserves previous summary ─────────────────
console.log("\n── Frontend: failed state preserves previous summary ──");

assert(
  card.includes("s?.status === \"failed\" && s.errorMessage"),
  "failed-but-has-content banner still rendered when previous summary exists"
);
assert(
  card.includes("Last update failed — showing previous summary"),
  "failed banner text still present"
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n────────────────────────────────────────────────────────────");
console.log(`ai-summary-content-guard: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
