"use strict";
/**
 * Tests for the blank-body guard in the Suggested Next Email modal.
 *
 * Five scenarios (requirements):
 *  1. API returns blank body  → frontend error message appears.
 *  2. Specific error message  → "Email body could not be generated. Please regenerate or write one manually."
 *  3. Body textarea is editable (present and writable) after a failed generation.
 *  4. Once the user types a non-empty body, Continue in Mail is enabled.
 *  5. Continue in Mail sends the manually entered body (uses editedBody).
 *
 * All checks are source-grep based (no live server required).
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const MODAL_PATH = path.join(
  __dirname,
  "../client/src/components/crm/suggested-next-email-modal.tsx"
);

const src = fs.readFileSync(MODAL_PATH, "utf8");

let passed = 0;
let failed = 0;

function check(description, condition) {
  if (condition) {
    console.log(`  ✓ ${description}`);
    passed++;
  } else {
    console.error(`  ✗ ${description}`);
    failed++;
  }
}

// ── State: generationAttempted flag ─────────────────────────────────────────
console.log("\n── generationAttempted state ──");

check(
  "generationAttempted state declared",
  src.includes("generationAttempted") && src.includes("setGenerationAttempted")
);

check(
  "generationAttempted initialised to false",
  src.includes("useState(false)") &&
    src.includes("generationAttempted")
);

check(
  "setGenerationAttempted(true) called inside handleGenerate",
  src.includes("setGenerationAttempted(true)")
);

// ── Scenario 1 & 2: Specific error message on blank body ────────────────────
console.log("\n── Scenario 1+2: blank body → exact error message ──");

const REQUIRED_ERROR =
  "Email body could not be generated. Please regenerate or write one manually.";

check(
  "Exact required error message is present in source",
  src.includes(REQUIRED_ERROR)
);

check(
  "Error message is set via setError() call",
  src.includes(`setError("${REQUIRED_ERROR}")`)
);

check(
  "Empty-body guard (data.body?.trim()) precedes the setError call",
  (() => {
    const guardIdx = src.indexOf("data.body?.trim()");
    const errorIdx = src.indexOf(`setError("${REQUIRED_ERROR}")`);
    return guardIdx !== -1 && errorIdx !== -1 && guardIdx < errorIdx;
  })()
);

// ── Scenario 3: Body textarea is present and editable after failed generation ─
console.log("\n── Scenario 3: manual-body textarea visible after failed generation ──");

check(
  "manual-body-section div has data-testid='manual-body-section'",
  src.includes('data-testid="manual-body-section"')
);

check(
  "manual-body-section is gated on generationAttempted && !loading && !suggestion",
  src.includes("generationAttempted && !loading && !suggestion")
);

check(
  "textarea inside manual-body-section has data-testid='textarea-email-body'",
  (() => {
    const sectionIdx = src.indexOf('data-testid="manual-body-section"');
    const textareaIdx = src.indexOf('data-testid="textarea-email-body"', sectionIdx);
    return sectionIdx !== -1 && textareaIdx !== -1 && textareaIdx - sectionIdx < 800;
  })()
);

check(
  "manual textarea value is bound to editedBody",
  (() => {
    const sectionIdx = src.indexOf('data-testid="manual-body-section"');
    const valIdx = src.indexOf("value={editedBody}", sectionIdx);
    return sectionIdx !== -1 && valIdx !== -1 && valIdx - sectionIdx < 800;
  })()
);

check(
  "manual textarea onChange updates editedBody",
  (() => {
    const sectionIdx = src.indexOf('data-testid="manual-body-section"');
    const onChangeIdx = src.indexOf("setEditedBody(", sectionIdx);
    return sectionIdx !== -1 && onChangeIdx !== -1 && onChangeIdx - sectionIdx < 800;
  })()
);

check(
  "manual textarea has a rows attribute (visible size)",
  (() => {
    const sectionIdx = src.indexOf('data-testid="manual-body-section"');
    const rowsIdx = src.indexOf("rows=", sectionIdx);
    return sectionIdx !== -1 && rowsIdx !== -1 && rowsIdx - sectionIdx < 800;
  })()
);

check(
  "manual textarea has a placeholder",
  (() => {
    const sectionIdx = src.indexOf('data-testid="manual-body-section"');
    const phIdx = src.indexOf("placeholder=", sectionIdx);
    return sectionIdx !== -1 && phIdx !== -1 && phIdx - sectionIdx < 800;
  })()
);

// ── Scenario 4: Continue in Mail is visible when generationAttempted ─────────
console.log("\n── Scenario 4: Continue in Mail visible after failed generation ──");

check(
  "Continue in Mail condition includes generationAttempted && !loading",
  src.includes("generationAttempted && !loading")
);

check(
  "Continue in Mail button (data-testid) is inside the generationAttempted check",
  (() => {
    const condIdx = src.indexOf("generationAttempted && !loading");
    const btnIdx = src.indexOf('data-testid="button-continue-suggested-email"');
    return condIdx !== -1 && btnIdx !== -1 && btnIdx > condIdx;
  })()
);

check(
  "Continue in Mail disabled when editedBody is empty (!editedBody.trim())",
  src.includes("!editedBody.trim()")
);

// ── Scenario 5: Continue in Mail sends editedBody (manually entered) ─────────
console.log("\n── Scenario 5: handleContinue sends editedBody ──");

check(
  "handleContinue guard checks editedBody.trim() not suggestion",
  src.includes("if (!editedBody.trim()) return;")
);

check(
  "handleContinue uses optional-chain for suggestion?.to (works when suggestion is null)",
  src.includes("suggestion?.to")
);

check(
  "handleContinue uses optional-chain for suggestion?.cc",
  src.includes("suggestion?.cc")
);

check(
  "handleContinue uses effectiveSubject that falls back when suggestion is null",
  src.includes("suggestion?.subject ?? \"Follow-up\"")
);

check(
  "payload subject uses effectiveSubject (not hardcoded suggestion.subject)",
  src.includes("subject: effectiveSubject")
);

check(
  "rawBody uses editedBody (manually typed content flows to payload)",
  (() => {
    const rawIdx = src.indexOf("const rawBody =");
    const editedIdx = src.indexOf("editedBody", rawIdx);
    return rawIdx !== -1 && editedIdx !== -1 && editedIdx - rawIdx < 200;
  })()
);

// ── Error banner shown to user (red banner for failed generation) ─────────────
console.log("\n── Error display ──");

check(
  "Error banner renders the error string from state",
  src.includes("{error}") && src.includes("text-red-400")
);

check(
  "Error banner visible on !loading && error",
  src.includes("!loading && error &&")
);

// ── Summary ──────────────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(60));
console.log(`suggested-email-blank-body-guard: ${passed} passed, ${failed} failed`);
console.log("─".repeat(60));

process.exit(failed > 0 ? 1 : 0);
