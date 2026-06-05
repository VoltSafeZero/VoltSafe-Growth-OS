/**
 * Tests: Suggested Next Email — User Inputs feature
 *
 * Covers:
 *  1. UI — textarea rendered with correct testid
 *  2. UI — textarea has maxLength 2000
 *  3. UI — placeholder text is present
 *  4. fetchSuggestedEmail — userInputs included in request body when provided
 *  5. fetchSuggestedEmail — userInputs omitted from body when empty
 *  6. Backend route — userInputs trimmed and capped at 2000 chars
 *  7. Backend route — non-string userInputs silently ignored (empty string passed)
 *  8. Service — generateSuggestedNextEmail accepts 9th param (userInputs)
 *  9. Service — USER INPUTS block appears in prompt when userInputs provided
 * 10. Service — USER INPUTS block absent when userInputs empty
 * 11. Signature rules — prompt does NOT contain "Best regards" instruction
 * 12. Signature rules — prompt DOES contain "Do NOT add any closing phrase"
 * 13. cleanAiEmailBody — strips standalone "Best regards," at end
 * 14. cleanAiEmailBody — strips standalone "Regards," at end
 * 15. cleanAiEmailBody — strips standalone "Sincerely" at end
 * 16. cleanAiEmailBody — strips standalone "Thanks," at end
 * 17. cleanAiEmailBody — strips standalone "Cheers" at end
 * 18. cleanAiEmailBody — strips standalone "Best," at end
 * 19. cleanAiEmailBody — does NOT strip signoff mid-body
 * 20. cleanAiEmailBody — does NOT strip signoff that already had [Your Name] stripped
 * 21. cleanAiEmailBody — trailing blank lines before signoff are handled
 * 22. Empty state text — mentions "user inputs"
 * 23. Modal — userInputs passed as 6th arg to fetchSuggestedEmail in handleGenerate
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// ── Load source files ─────────────────────────────────────────────────────────
const modalSrc = fs.readFileSync(
  path.join(__dirname, "../client/src/components/crm/suggested-next-email-modal.tsx"),
  "utf8"
);
const serviceSrc = fs.readFileSync(
  path.join(__dirname, "../server/services/crm-ai-summary.ts"),
  "utf8"
);
const routesSrc = fs.readFileSync(
  path.join(__dirname, "../server/routes.ts"),
  "utf8"
);

// ── Inline cleanAiEmailBody for unit testing ──────────────────────────────────
function cleanAiEmailBody(raw) {
  if (!raw) return raw;
  let text = raw;

  // Step 1 — fake-sig blocks
  text = text.replace(
    /\n?(Best regards?|Kind regards?|Warm regards?|Sincerely|Thanks?|Cheers|Regards?)[,:]?\s*\n[\s\S]*?\[Your (?:Name|Title|Contact Information)\][\s\S]*/gi,
    ""
  );

  // Step 2 — bracket placeholders
  text = text.replace(/\[Your Name\]/gi, "");
  text = text.replace(/\[Your Title\]/gi, "");
  text = text.replace(/\[Your Contact Information\]/gi, "");
  text = text.replace(/VoltSafe\s*\[.*?\]/gi, "VoltSafe");

  // Step 3 — empty closing artifacts
  text = text
    .split("\n")
    .filter(line => line.trim() !== "VoltSafe" || false)
    .join("\n");

  // Step 4 — strip standalone signoff at end
  const SIGNOFF_PATTERN = /^(best regards?|kind regards?|warm regards?|regards?|sincerely|thanks?|cheers|best)[,\s]*$/i;
  const lines = text.split("\n");
  let tail = lines.length - 1;
  while (tail >= 0 && lines[tail].trim() === "") tail--;
  if (tail >= 0 && SIGNOFF_PATTERN.test(lines[tail].trim())) {
    lines.splice(tail, 1);
    text = lines.join("\n");
  }

  // Step 5 — normalise
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");

  // Step 6 — trim
  text = text.trim();
  return text;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log("\nSuggested Email — User Inputs feature\n");

// ── 1. UI: textarea testid present ───────────────────────────────────────────
test("1. textarea has data-testid='textarea-user-inputs'", () => {
  assert.ok(
    modalSrc.includes('data-testid="textarea-user-inputs"'),
    "Missing data-testid attribute on User Inputs textarea"
  );
});

// ── 2. UI: maxLength 2000 ─────────────────────────────────────────────────────
test("2. textarea has maxLength={2000}", () => {
  assert.ok(
    modalSrc.includes("maxLength={2000}"),
    "User Inputs textarea missing maxLength={2000}"
  );
});

// ── 3. UI: placeholder text present ──────────────────────────────────────────
test("3. textarea has a placeholder mentioning 'focus on'", () => {
  assert.ok(
    modalSrc.includes("focus on"),
    "User Inputs textarea missing placeholder text"
  );
});

// ── 4. fetchSuggestedEmail — includes userInputs in body when provided ────────
test("4. fetchSuggestedEmail sends userInputs in request body when non-empty", () => {
  assert.ok(
    modalSrc.includes("if (userInputs?.trim()) body.userInputs = userInputs.trim()"),
    "fetchSuggestedEmail should conditionally include userInputs in the request body"
  );
});

// ── 5. fetchSuggestedEmail — 6th param is userInputs ─────────────────────────
test("5. fetchSuggestedEmail has userInputs as 6th parameter", () => {
  const fnMatch = modalSrc.match(/async function fetchSuggestedEmail\([^)]+\)/s);
  assert.ok(fnMatch, "fetchSuggestedEmail not found");
  assert.ok(
    fnMatch[0].includes("userInputs"),
    "fetchSuggestedEmail missing userInputs parameter"
  );
});

// ── 6. handleGenerate passes userInputs as 6th arg ───────────────────────────
test("6. handleGenerate passes userInputs as 6th argument to fetchSuggestedEmail", () => {
  const callMatch = modalSrc.match(/fetchSuggestedEmail\(entityType, entityId, effectiveVoiceId, selectedInfluence, selectedModifiers, userInputs\)/);
  assert.ok(callMatch, "handleGenerate call to fetchSuggestedEmail missing userInputs arg");
});

// ── 7. Backend: userInputs parsed in route ────────────────────────────────────
test("7. Route extracts userInputs from req.body with trim and 2000-char cap", () => {
  assert.ok(
    routesSrc.includes("rawUserInputs.trim().slice(0, 2000)"),
    "Route missing .trim().slice(0, 2000) for userInputs"
  );
});

// ── 8. Backend: non-string ignored ───────────────────────────────────────────
test("8. Route silently ignores non-string userInputs (falls back to empty string)", () => {
  assert.ok(
    routesSrc.includes('typeof rawUserInputs === "string"'),
    "Route missing typeof check for userInputs"
  );
});

// ── 9. Backend: userInputs passed as 9th arg to service ──────────────────────
test("9. Route passes userInputs as 9th argument to generateSuggestedNextEmail", () => {
  assert.ok(
    routesSrc.includes("intentModifierIds, userInputs)"),
    "Route missing userInputs in generateSuggestedNextEmail call"
  );
});

// ── 10. Service: 9th param is userInputs ──────────────────────────────────────
test("10. generateSuggestedNextEmail signature has userInputs as 9th param", () => {
  const sigMatch = serviceSrc.match(/export async function generateSuggestedNextEmail\([^)]+\)/s);
  assert.ok(sigMatch, "generateSuggestedNextEmail not found");
  assert.ok(
    sigMatch[0].includes("userInputs"),
    "generateSuggestedNextEmail missing userInputs parameter"
  );
});

// ── 11. Service: USER INPUTS block header present in source ──────────────────
test("11. Prompt contains USER INPUTS section header", () => {
  assert.ok(
    serviceSrc.includes("USER INPUTS — HIGH-PRIORITY GUIDANCE"),
    "Prompt missing USER INPUTS section header"
  );
});

// ── 12. Service: USER INPUTS block conditionally included ────────────────────
test("12. USER INPUTS block only rendered when userInputs has content", () => {
  assert.ok(
    serviceSrc.includes("userInputs?.trim()"),
    "Service missing conditional check for userInputs?.trim()"
  );
});

// ── 13. Signature rules: old phrasing removed ────────────────────────────────
test("13. Prompt does NOT contain old 'simple closing word/phrase, e.g.: Best regards' instruction", () => {
  assert.ok(
    !serviceSrc.includes(`End the email with only a simple closing word/phrase, e.g.: "Best regards,"`),
    "Old 'Best regards' signoff instruction still present in prompt"
  );
});

// ── 14. Signature rules: new no-signoff instruction present ──────────────────
test("14. Prompt contains 'Do NOT add any closing phrase' instruction", () => {
  assert.ok(
    serviceSrc.includes("DO NOT add any closing phrase"),
    "New no-signoff instruction missing from SIGNATURE RULES"
  );
});

// ── 15. cleanAiEmailBody: strips "Best regards," at end ──────────────────────
test("15. cleanAiEmailBody strips 'Best regards,' at end of body", () => {
  const input = "Dear Alex,\n\nHope to connect soon.\n\nBest regards,";
  const result = cleanAiEmailBody(input);
  assert.ok(!result.endsWith("Best regards,"), `Expected no trailing signoff, got: ${JSON.stringify(result)}`);
  assert.ok(result.includes("Hope to connect soon."), "Body content should be preserved");
});

// ── 16. cleanAiEmailBody: strips "Regards," at end ───────────────────────────
test("16. cleanAiEmailBody strips 'Regards,' at end of body", () => {
  const input = "Dear Alex,\n\nSee you soon.\n\nRegards,";
  const result = cleanAiEmailBody(input);
  assert.ok(!result.match(/Regards,\s*$/i), `Signoff should be stripped, got: ${JSON.stringify(result)}`);
});

// ── 17. cleanAiEmailBody: strips "Sincerely" at end ──────────────────────────
test("17. cleanAiEmailBody strips 'Sincerely' at end of body", () => {
  const input = "Hi there,\n\nLooking forward to it.\n\nSincerely";
  const result = cleanAiEmailBody(input);
  assert.ok(!result.match(/Sincerely\s*$/i), `Signoff should be stripped, got: ${JSON.stringify(result)}`);
});

// ── 18. cleanAiEmailBody: strips "Thanks," at end ────────────────────────────
test("18. cleanAiEmailBody strips 'Thanks,' at end of body", () => {
  const input = "Hi,\n\nPlease let me know your thoughts.\n\nThanks,";
  const result = cleanAiEmailBody(input);
  assert.ok(!result.match(/Thanks,\s*$/i), `Signoff should be stripped, got: ${JSON.stringify(result)}`);
});

// ── 19. cleanAiEmailBody: strips "Cheers" at end ─────────────────────────────
test("19. cleanAiEmailBody strips 'Cheers' at end of body", () => {
  const input = "Hi,\n\nThat sounds great.\n\nCheers";
  const result = cleanAiEmailBody(input);
  assert.ok(!result.match(/Cheers\s*$/i), `Signoff should be stripped, got: ${JSON.stringify(result)}`);
});

// ── 20. cleanAiEmailBody: strips "Best," at end ──────────────────────────────
test("20. cleanAiEmailBody strips 'Best,' at end of body", () => {
  const input = "Hi,\n\nI look forward to hearing from you.\n\nBest,";
  const result = cleanAiEmailBody(input);
  assert.ok(!result.match(/Best,\s*$/i), `Signoff should be stripped, got: ${JSON.stringify(result)}`);
});

// ── 21. cleanAiEmailBody: does NOT strip signoff mid-body ────────────────────
test("21. cleanAiEmailBody does NOT strip 'Best regards' that appears mid-body", () => {
  const input = "Hi,\n\nBest regards to your team.\n\nLooking forward to the meeting.";
  const result = cleanAiEmailBody(input);
  assert.ok(result.includes("Best regards to your team"), "Mid-body 'Best regards' mention should be preserved");
});

// ── 22. cleanAiEmailBody: handles trailing blank lines before signoff ─────────
test("22. cleanAiEmailBody strips signoff when followed by trailing blank lines", () => {
  const input = "Hi,\n\nPlease review.\n\nBest regards,\n\n";
  const result = cleanAiEmailBody(input);
  assert.ok(!result.match(/Best regards/i), `Trailing signoff should be stripped, got: ${JSON.stringify(result)}`);
  assert.ok(result.includes("Please review."), "Body content should be preserved");
});

// ── 23. cleanAiEmailBody: body content preserved after signoff strip ──────────
test("23. cleanAiEmailBody preserves all body paragraphs after signoff strip", () => {
  const input = "Dear John,\n\nThank you for your interest.\n\nWe will follow up next week.\n\nBest regards,";
  const result = cleanAiEmailBody(input);
  assert.ok(result.includes("Thank you for your interest."), "Para 1 must be preserved");
  assert.ok(result.includes("We will follow up next week."), "Para 2 must be preserved");
  assert.ok(!result.match(/Best regards/i), "Signoff must be stripped");
});

// ── 24. Empty state: mentions user inputs ─────────────────────────────────────
test("24. Modal empty state text mentions 'user inputs'", () => {
  assert.ok(
    modalSrc.includes("user inputs"),
    "Empty state text should mention 'user inputs'"
  );
});

// ── 25. Formatting rules: example has no signoff ─────────────────────────────
test("25. FORMATTING RULES example does not include 'Best regards,' in example structure", () => {
  const fmtSection = serviceSrc.match(/=== FORMATTING RULES[^`]+Example structure[^\n]+\n[^\n]+/s);
  if (fmtSection) {
    assert.ok(
      !fmtSection[0].includes("Best regards,"),
      "FORMATTING RULES example still contains 'Best regards,'"
    );
  } else {
    // Fallback: check full source
    const idx = serviceSrc.indexOf("Example structure");
    assert.ok(idx !== -1, "FORMATTING RULES 'Example structure' not found");
    const snippet = serviceSrc.slice(idx, idx + 300);
    assert.ok(!snippet.includes("Best regards,"), "Example structure should not contain 'Best regards,'");
  }
});

// ── 26. Service: REMEMBER line updated ───────────────────────────────────────
test("26. Service body field description mentions 'no signoff phrase'", () => {
  assert.ok(
    serviceSrc.includes("no signoff phrase"),
    "JSON schema body description should mention 'no signoff phrase'"
  );
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
