"use strict";
/**
 * ai-summary-key-people-email.test.cjs
 *
 * Source-grep tests that pin the Key People recipient-selection feature
 * added to AiSummaryCard and SuggestedNextEmailModal.
 *
 * Strategy: grep source files for the invariants we must preserve.
 * No HTTP calls — fast and deterministic.
 */

const fs = require("fs");
const path = require("path");

const CARD = path.join(__dirname, "../client/src/components/crm/ai-summary-card.tsx");
const MODAL = path.join(__dirname, "../client/src/components/crm/suggested-next-email-modal.tsx");
const HANDOFF = path.join(__dirname, "../client/src/lib/compose-handoff.ts");

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

const card = fs.readFileSync(CARD, "utf8");
const modal = fs.readFileSync(MODAL, "utf8");
const handoff = fs.readFileSync(HANDOFF, "utf8");

// ── Section 1: AiSummaryCard structure ───────────────────────────────────────
console.log("\n── AiSummaryCard: Key People checkboxes ──");

assert(
  card.includes("SelectedKeyPerson"),
  "SelectedKeyPerson interface exists"
);
assert(
  card.includes("selectedKeyPeople") && card.includes("useState<SelectedKeyPerson[]>"),
  "selectedKeyPeople state is an ordered array of SelectedKeyPerson"
);
assert(
  card.includes("function toggleKeyPerson"),
  "toggleKeyPerson helper function defined"
);
assert(
  card.includes("function getComposeRecipients"),
  "getComposeRecipients helper function defined"
);
assert(
  card.includes("function handleComposeNewEmail"),
  "handleComposeNewEmail handler defined"
);

// ── Section 2: Selection order logic ─────────────────────────────────────────
console.log("\n── Selection order: first selected = TO, rest = CC ──");

assert(
  card.includes("selectedKeyPeople[0].email"),
  "First selected key person email goes to TO"
);
assert(
  card.includes("selectedKeyPeople.slice(1).map(p => p.email).join"),
  "Remaining selected key people emails go to CC (joined)"
);
assert(
  /prev\.some.*email.*===.*person\.email/.test(card) ||
  /prev\.some\(p => p\.email === person\.email\)/.test(card),
  "Toggle checks by email for deduplication"
);
assert(
  /prev\.filter\(p => p\.email !== person\.email\)/.test(card),
  "Unchecking removes person from ordered array"
);
assert(
  /return \[\.\.\.prev, person\]/.test(card),
  "Checking appends person to end of array (preserves selection order)"
);

// ── Section 3: Compose New Email button ──────────────────────────────────────
console.log("\n── Compose New Email button ──");

assert(
  card.includes('data-testid="button-compose-new-email-from-summary"'),
  "Compose New Email button has testid"
);
assert(
  card.includes("handleComposeNewEmail"),
  "Compose New Email button calls handleComposeNewEmail"
);
assert(
  card.includes("setPendingCompose"),
  "handleComposeNewEmail calls setPendingCompose (uses in-app composer)"
);
assert(
  card.includes('subject: "", body: ""'),
  "Compose New Email passes blank subject and body"
);
assert(
  !card.includes("mailto:"),
  "Compose New Email never uses mailto links"
);
assert(
  card.includes('setLocation("/gmail")'),
  "Compose New Email navigates to in-app gmail route"
);

// ── Section 4: Suggested Email button moved to Key People area ────────────────
console.log("\n── Suggested Email button in Key People action area ──");

assert(
  card.includes('data-testid="button-suggest-next-email"'),
  "Suggested Email button has correct testid"
);
assert(
  card.includes("key-people-email-actions"),
  "Key People email actions section has testid"
);
assert(
  card.includes("email-action-buttons"),
  "Email action buttons container has testid"
);

// ── Section 5: Only key people with email are selectable ─────────────────────
console.log("\n── Key People: disabled when no email ──");

assert(
  card.includes("!!(p.email && p.email.trim())") ||
  card.includes("p.email && p.email.trim()"),
  "hasEmail check verifies email exists and is non-empty"
);
assert(
  card.includes("disabled={!hasEmail}"),
  "Checkbox is disabled when no email"
);
assert(
  card.includes('"No email address available"'),
  "Disabled state shows accessible reason"
);
assert(
  /if \(!hasEmail.*return/.test(card.replace(/\n/g, " ")),
  "toggleKeyPerson guard prevents selection of no-email contacts"
);

// ── Section 6: Accessibility ──────────────────────────────────────────────────
console.log("\n── Accessibility labels ──");

assert(
  card.includes("aria-label={hasEmail ? `Select ${p.name} for email`"),
  "Checkbox has accessible label including person name"
);
assert(
  card.includes('data-testid={`checkbox-key-person-${i}`}'),
  "Each checkbox has unique testid"
);
assert(
  card.includes('data-testid={`key-person-row-${i}`}'),
  "Each key person row has unique testid"
);

// ── Section 7: Recipient hint text ────────────────────────────────────────────
console.log("\n── Recipient count hint text ──");

assert(
  card.includes('"1 recipient selected"'),
  "Single selection shows '1 recipient selected'"
);
assert(
  card.includes("recipients: 1 To,") && card.includes("Cc"),
  "Multi-selection hint shows To/Cc breakdown"
);
assert(
  card.includes('data-testid="text-recipient-hint"'),
  "Recipient hint has testid"
);

// ── Section 8: Passes initialTo/initialCc to modal ───────────────────────────
console.log("\n── AiSummaryCard passes recipients to SuggestedNextEmailModal ──");

assert(
  card.includes("initialTo={recipientTo || undefined}"),
  "initialTo passed to SuggestedNextEmailModal"
);
assert(
  card.includes("initialCc={recipientCc || undefined}"),
  "initialCc passed to SuggestedNextEmailModal"
);

// ── Section 9: SuggestedNextEmailModal accepts and uses initialTo/initialCc ───
console.log("\n── SuggestedNextEmailModal: initialTo/initialCc props ──");

assert(
  modal.includes("initialTo?: string"),
  "SuggestedNextEmailModal has optional initialTo prop"
);
assert(
  modal.includes("initialCc?: string"),
  "SuggestedNextEmailModal has optional initialCc prop"
);
assert(
  modal.includes("initialTo, initialCc") && modal.includes("}: Props"),
  "SuggestedNextEmailModal destructures initialTo and initialCc"
);

// ── Section 10: Recipient override logic in handleContinue ───────────────────
console.log("\n── SuggestedNextEmailModal: recipient override in handleContinue ──");

assert(
  modal.includes("effectiveTo") && modal.includes("effectiveCc"),
  "effectiveTo and effectiveCc variables computed for override"
);
assert(
  /initialTo !== undefined && initialTo !== ""/.test(modal),
  "effectiveTo prefers initialTo when non-empty"
);
assert(
  /to: effectiveTo/.test(modal),
  "payload.to uses effectiveTo"
);
assert(
  /cc: effectiveCc/.test(modal),
  "payload.cc uses effectiveCc"
);

// ── Section 11: Recipient override display in modal ───────────────────────────
console.log("\n── SuggestedNextEmailModal: display shows overridden recipients ──");

assert(
  modal.includes("recipientsOverridden"),
  "recipientsOverridden flag computed"
);
assert(
  modal.includes("Recipients pre-filled from selected Key People"),
  "Visual indicator shown when recipients are overridden"
);
assert(
  /displayTo.*displayCc/.test(modal.replace(/\n/g, " ")),
  "displayTo and displayCc used in fields display"
);

// ── Section 12: Existing behavior preserved ───────────────────────────────────
console.log("\n── Existing behavior preserved ──");

assert(
  card.includes('data-testid="button-regenerate-summary"'),
  "Regenerate button still present"
);
assert(
  card.includes('data-testid="button-toggle-ai-summary"'),
  "Collapse/expand toggle still present"
);
assert(
  card.includes('data-testid="ai-summary-section"'),
  "AI Summary section testid preserved"
);
assert(
  card.includes("data-testid=\"button-generate-summary\""),
  "Generate Now button for empty state still present"
);
assert(
  modal.includes("handleGenerate"),
  "SuggestedNextEmailModal handleGenerate still present"
);
assert(
  modal.includes("PENDING_COMPOSE_KEY"),
  "compose-handoff sessionStorage fallback still present in modal"
);

// ── Section 13: compose-handoff interface ─────────────────────────────────────
console.log("\n── compose-handoff: interface supports cc field ──");

assert(
  handoff.includes("cc?: string"),
  "ComposeHandoff interface has optional cc field"
);
assert(
  handoff.includes("to: string"),
  "ComposeHandoff interface has required to field"
);
assert(
  handoff.includes("subject: string") && handoff.includes("body: string"),
  "ComposeHandoff has subject and body fields"
);

// ── Section 14: No external email client ──────────────────────────────────────
console.log("\n── No external email clients ──");

assert(
  !card.includes("mailto:"),
  "AiSummaryCard never uses mailto: links"
);
assert(
  !card.includes("window.open"),
  "AiSummaryCard never opens external windows"
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n────────────────────────────────────────────────────────────");
console.log(`ai-summary-key-people-email: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
