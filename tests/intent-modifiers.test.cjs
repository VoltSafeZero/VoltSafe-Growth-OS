"use strict";

/**
 * Intent Modifiers — source-grep tests
 *
 * Validates that the intent modifier feature is correctly wired up across:
 *  - shared config (resolveIntentModifiers, buildIntentModifierPromptBlock)
 *  - backend service (generateSuggestedNextEmail signature)
 *  - backend route (selectedIntentModifiers extraction + validation)
 *  - frontend modal (state, UI, fetch payload)
 */

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed");
}

function readFile(relPath) {
  return fs.readFileSync(path.resolve(__dirname, "..", relPath), "utf8");
}

// ── Load source files ─────────────────────────────────────────────────────────

const sharedModifiers     = readFile("shared/intent-modifiers.ts");
const crmAiSummaryService = readFile("server/services/crm-ai-summary.ts");
const routesTs            = readFile("server/routes.ts");
const modal               = readFile("client/src/components/crm/suggested-next-email-modal.tsx");

// ── Shared config ─────────────────────────────────────────────────────────────

console.log("\n── shared/intent-modifiers.ts ──");

test("exports INTENT_MODIFIERS with 10 entries", () => {
  const matches = sharedModifiers.match(/id:\s*"/g);
  assert(matches && matches.length >= 10, `Expected 10 modifier ids, found ${matches?.length ?? 0}`);
});

test("includes all 10 required modifier ids", () => {
  const required = [
    "advance_decision", "reduce_friction", "create_urgency",
    "build_trust", "executive_level", "founder_to_founder",
    "emphasize_roi", "emphasize_risk", "concise", "ask_for_meeting",
  ];
  for (const id of required) {
    assert(sharedModifiers.includes(`"${id}"`), `Missing modifier id: ${id}`);
  }
});

test("exports MAX_INTENT_MODIFIERS = 5", () => {
  assert(
    sharedModifiers.includes("MAX_INTENT_MODIFIERS = 5"),
    "MAX_INTENT_MODIFIERS must be 5"
  );
});

test("resolveIntentModifiers slices to MAX_INTENT_MODIFIERS", () => {
  assert(
    sharedModifiers.includes(".slice(0, MAX_INTENT_MODIFIERS)"),
    "resolveIntentModifiers must slice to MAX_INTENT_MODIFIERS"
  );
});

test("buildIntentModifierPromptBlock returns empty string for empty input", () => {
  assert(
    sharedModifiers.includes("if (!modifiers.length) return"),
    "buildIntentModifierPromptBlock must guard against empty array"
  );
});

test("buildIntentModifierPromptBlock includes modifier label and instruction", () => {
  assert(
    sharedModifiers.includes("m.label") && sharedModifiers.includes("m.instruction"),
    "Prompt block must reference label and instruction"
  );
});

test("exports groupModifiersByCategory helper", () => {
  assert(
    sharedModifiers.includes("groupModifiersByCategory"),
    "groupModifiersByCategory must be exported"
  );
});

test("covers all 5+ category labels", () => {
  const cats = [
    "Strategic Intent", "Relationship Intent", "Leadership Intent",
    "Persuasion Intent", "Communication Style", "Follow-Up Intent",
  ];
  for (const cat of cats) {
    assert(sharedModifiers.includes(cat), `Missing category: ${cat}`);
  }
});

// ── Backend service ───────────────────────────────────────────────────────────

console.log("\n── server/services/crm-ai-summary.ts ──");

test("imports resolveIntentModifiers and buildIntentModifierPromptBlock from shared", () => {
  assert(
    crmAiSummaryService.includes("resolveIntentModifiers") &&
    crmAiSummaryService.includes("buildIntentModifierPromptBlock"),
    "Must import both helpers from shared/intent-modifiers"
  );
});

test("generateSuggestedNextEmail accepts intentModifierIds param", () => {
  assert(
    crmAiSummaryService.includes("intentModifierIds?: string[]"),
    "Function signature must include intentModifierIds?: string[]"
  );
});

test("resolveIntentModifiers is called with intentModifierIds ?? []", () => {
  assert(
    crmAiSummaryService.includes("resolveIntentModifiers(intentModifierIds ?? [])"),
    "Service must call resolveIntentModifiers with intentModifierIds ?? []"
  );
});

test("modifier block is injected into systemPrompt array", () => {
  assert(
    crmAiSummaryService.includes("modifierBlock || null"),
    "systemPrompt array must include modifierBlock"
  );
});

test("modifier block injection is after voice/influence blocks", () => {
  const modifierIdx = crmAiSummaryService.indexOf("modifierBlock || null");
  const voiceIdx    = crmAiSummaryService.indexOf("voiceProfileBlock ? voiceProfileBlock : null");
  assert(modifierIdx > voiceIdx, "modifierBlock must appear after voiceProfileBlock in systemPrompt");
});

test("modifier block injection is before main email instruction", () => {
  const modifierIdx   = crmAiSummaryService.indexOf("modifierBlock || null");
  const instructionIdx = crmAiSummaryService.indexOf("You are writing emails on behalf of VoltSafe");
  assert(modifierIdx < instructionIdx, "modifierBlock must appear before main email instruction in systemPrompt");
});

test("no modifiers (empty array) resolves to empty block — no prompt change", () => {
  assert(
    crmAiSummaryService.includes("intentModifierIds ?? []"),
    "Defaults to empty array when intentModifierIds is undefined"
  );
});

// ── Backend route ─────────────────────────────────────────────────────────────

console.log("\n── server/routes.ts (suggest-next-email route) ──");

test("route extracts selectedIntentModifiers from req.body", () => {
  assert(
    routesTs.includes("req.body?.selectedIntentModifiers"),
    "Route must read req.body?.selectedIntentModifiers"
  );
});

test("route validates selectedIntentModifiers is an array", () => {
  assert(
    routesTs.includes("Array.isArray(rawModifiers)"),
    "Route must check Array.isArray(rawModifiers)"
  );
});

test("route filters to string-only items", () => {
  assert(
    routesTs.includes('typeof id === "string"'),
    'Route must filter modifier ids with typeof id === "string"'
  );
});

test("route limits to 5 modifiers via .slice(0, 5)", () => {
  assert(
    routesTs.includes(".slice(0, 5)"),
    "Route must slice modifiers to max 5"
  );
});

test("route falls back to empty array when not provided", () => {
  assert(
    routesTs.includes(": []"),
    "Route must fall back to [] when selectedIntentModifiers is absent"
  );
});

test("route passes intentModifierIds to generateSuggestedNextEmail", () => {
  assert(
    routesTs.includes("intentModifierIds") &&
    routesTs.includes("generateSuggestedNextEmail"),
    "Route must pass intentModifierIds to generateSuggestedNextEmail"
  );
});

test("unknown modifier ids are safely ignored (resolution happens server-side)", () => {
  assert(
    routesTs.includes("resolveIntentModifiers") ||
    crmAiSummaryService.includes("resolveIntentModifiers"),
    "Server must call resolveIntentModifiers to filter unknown ids"
  );
});

// ── Frontend modal ────────────────────────────────────────────────────────────

console.log("\n── client/src/components/crm/suggested-next-email-modal.tsx ──");

test("imports INTENT_MODIFIERS from @shared/intent-modifiers", () => {
  assert(
    modal.includes("INTENT_MODIFIERS") &&
    modal.includes("@shared/intent-modifiers"),
    "Modal must import from @shared/intent-modifiers"
  );
});

test("imports groupModifiersByCategory and MAX_INTENT_MODIFIERS", () => {
  assert(
    modal.includes("groupModifiersByCategory") && modal.includes("MAX_INTENT_MODIFIERS"),
    "Modal must import groupModifiersByCategory and MAX_INTENT_MODIFIERS"
  );
});

test("selectedModifiers state is initialized to empty array", () => {
  assert(
    modal.includes("useState<string[]>([])") || modal.includes('useState([])'),
    "Modal must have selectedModifiers state initialized to []"
  );
});

test("modifiersExpanded state exists for collapsible panel", () => {
  assert(
    modal.includes("modifiersExpanded"),
    "Modal must have modifiersExpanded state"
  );
});

test("MAX_INTENT_MODIFIERS enforced — atModifierLimit guard", () => {
  assert(
    modal.includes("atModifierLimit"),
    "Modal must use atModifierLimit to prevent selecting >5 modifiers"
  );
});

test("toggleModifier prevents adding beyond MAX_INTENT_MODIFIERS", () => {
  assert(
    modal.includes("prev.length >= MAX_INTENT_MODIFIERS"),
    "toggleModifier must return early when at limit"
  );
});

test("limit warning message shown when at max", () => {
  assert(
    modal.includes("Choose up to") && modal.includes("MAX_INTENT_MODIFIERS"),
    "Modal must show limit warning referencing MAX_INTENT_MODIFIERS"
  );
});

test("fetchSuggestedEmail accepts intentModifierIds parameter", () => {
  assert(
    modal.includes("intentModifierIds?: string[]"),
    "fetchSuggestedEmail must accept intentModifierIds param"
  );
});

test("fetchSuggestedEmail includes selectedIntentModifiers in request body", () => {
  assert(
    modal.includes("selectedIntentModifiers") && modal.includes("intentModifierIds"),
    "fetchSuggestedEmail must include selectedIntentModifiers in POST body"
  );
});

test("handleRegenerate passes selectedModifiers to fetchSuggestedEmail", () => {
  assert(
    modal.includes("handleRegenerate") && modal.includes("selectedModifiers"),
    "handleRegenerate must reference selectedModifiers"
  );
});

test("initial mount fetch does not pass modifiers (no auto-generate on change)", () => {
  const fetchCallInEffect = modal.match(/fetchSuggestedEmail\(entityType,\s*entityId,\s*effectiveVoiceId,\s*selectedInfluence\)/);
  assert(
    fetchCallInEffect && fetchCallInEffect.length > 0,
    "Initial mount fetch must not include modifiers — only Regenerate applies them"
  );
});

test("modifier panel has data-testid='panel-intent-modifiers'", () => {
  assert(
    modal.includes('data-testid="panel-intent-modifiers"'),
    "Modifier panel must have data-testid for test targeting"
  );
});

test("each modifier checkbox has data-testid='checkbox-modifier-<id>'", () => {
  assert(
    modal.includes("checkbox-modifier-${mod.id}"),
    "Each modifier checkbox must have a unique data-testid"
  );
});

test("Regenerate button label reflects active modifier count", () => {
  assert(
    modal.includes("selectedModifiers.length > 0") && modal.includes("Regenerate"),
    "Regenerate button must show modifier count hint when modifiers are selected"
  );
});

test("active modifier chips shown after generation", () => {
  assert(
    modal.includes("section-active-modifiers") && modal.includes("chip-modifier-"),
    "Active modifier chips must be rendered in suggestion view"
  );
});

test("voice profile logic is preserved (effectiveVoiceId still resolved)", () => {
  assert(
    modal.includes("effectiveVoiceId") && modal.includes("voiceProfiles"),
    "Voice profile resolution must remain intact"
  );
});

test("influence selector is preserved", () => {
  assert(
    modal.includes("selectedInfluence") && modal.includes("INFLUENCE_OPTIONS"),
    "CEO Wattson influence selector must still exist"
  );
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(48)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
