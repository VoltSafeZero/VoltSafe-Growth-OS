/**
 * capital-copilot.test.cjs — Phase 2K source-grep tests
 * All tests use file source inspection (no runtime, no DB, no network).
 */

"use strict";
const fs   = require("fs");
const path = require("path");
const assert = require("assert");

// ── File loader ───────────────────────────────────────────────────────────────

function load(rel) {
  const abs = path.join(__dirname, "..", rel);
  if (!fs.existsSync(abs)) throw new Error(`File not found: ${rel}`);
  return fs.readFileSync(abs, "utf8");
}

const ctx    = load("server/services/capital-copilot-context.ts");
const svc    = load("server/services/capital-copilot.ts");
const page   = load("client/src/pages/capital-copilot.tsx");
const routes = load("server/routes-capital.ts");
const nav    = load("client/src/lib/nav-config.ts");
const app    = load("client/src/App.tsx");
const cmd    = load("client/src/pages/capital-command-center.tsx");
const inv    = load("client/src/pages/capital-investors.tsx");

// ── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err: err.message });
    console.log(`  ✗ ${name}: ${err.message}`);
  }
}

function contains(text, pattern, label) {
  const ok = typeof pattern === "string" ? text.includes(pattern) : pattern.test(text);
  assert(ok, `Expected to find: ${pattern} [in ${label}]`);
}

// ── 1. Context builder — exports & structure ──────────────────────────────────

console.log("\n1. Context builder — exports & structure");

test("exports buildCopilotContext function",   () => contains(ctx, "export function buildCopilotContext", "ctx"));
test("exports buildBoardSafeContext function", () => contains(ctx, "export function buildBoardSafeContext", "ctx"));
test("exports CopilotRawInput interface",      () => contains(ctx, "export interface CopilotRawInput", "ctx"));
test("exports CopilotContextOptions interface",() => contains(ctx, "export interface CopilotContextOptions", "ctx"));
test("exports CopilotContext interface",       () => contains(ctx, "export interface CopilotContext", "ctx"));
test("context has text field",                 () => contains(ctx, "text:", "ctx"));
test("context has source_labels field",        () => contains(ctx, "source_labels", "ctx"));
test("context has warnings field",             () => contains(ctx, "warnings:", "ctx"));

// ── 2. Context builder — purity (no DB calls) ────────────────────────────────

console.log("\n2. Context builder — purity");

test("no db.execute in context builder",  () => assert(!ctx.includes("db.execute"),  "ctx must not call db.execute"));
test("no db.select in context builder",   () => assert(!ctx.includes("db.select"),   "ctx must not call db.select"));
test("no sql.raw in context builder",     () => assert(!ctx.includes("sql.raw"),     "ctx must not use sql.raw"));
test("imports capital-command-center",    () => contains(ctx, "capital-command-center", "ctx"));
test("imports capital-engagement",        () => contains(ctx, "capital-engagement", "ctx"));
test("imports capital-data-room",         () => contains(ctx, "capital-data-room", "ctx"));
test("imports capital-portal",            () => contains(ctx, "capital-portal", "ctx"));
test("imports capital-valuation",         () => contains(ctx, "capital-valuation", "ctx"));

// ── 3. Context builder — command center summary ──────────────────────────────

console.log("\n3. Context builder — summaries");

test("context includes command center summary (weighted pipeline)", () =>
  contains(ctx, "computeWeightedPipeline", "ctx"));
test("context includes risk flags", () =>
  contains(ctx, "computeRiskFlags", "ctx"));
test("context includes this-week actions", () =>
  contains(ctx, "computeThisWeekActions", "ctx"));
test("context includes engagement analytics", () =>
  contains(ctx, "computeEngagementAnalytics", "ctx"));
test("context includes data room intelligence", () =>
  contains(ctx, "computeDataRoomIntelligence", "ctx"));
test("context includes portal intelligence", () =>
  contains(ctx, "computePortalIntelligence", "ctx"));
test("context includes valuation summary", () =>
  contains(ctx, "computeValuationSummary", "ctx"));

// ── 4. Context builder — scoping ─────────────────────────────────────────────

console.log("\n4. Context builder — scoping");

test("context scopes by investor_id", () =>
  contains(ctx, "investor_id", "ctx"));
test("context scopes by round_id", () =>
  contains(ctx, "round_id", "ctx"));
test("investor spotlight section rendered when investor_id provided", () =>
  contains(ctx, "investor_spotlight", "ctx"));
test("context filters activities by investor_id", () =>
  contains(ctx, "entity_id === investor_id", "ctx"));
test("context filters emailLinks by investor_id", () =>
  contains(ctx, "capital_investor_id === investor_id", "ctx"));

// ── 5. Context builder — board-safe mode ─────────────────────────────────────

console.log("\n5. Context builder — board-safe mode");

test("board-safe mode excludes internal notes", () =>
  contains(ctx, "include_sensitive", "ctx"));
test("buildBoardSafeContext passes include_sensitive=false", () =>
  contains(ctx, "include_sensitive: false", "ctx"));
test("board-safe notice added to context text", () =>
  contains(ctx, "BOARD-SAFE MODE", "ctx"));
test("investor notes gated by include_sensitive", () =>
  contains(ctx, "include_sensitive", "ctx"));

// ── 6. AI service — exports & structure ──────────────────────────────────────

console.log("\n6. AI service — exports & structure");

test("exports runCopilotQuery function",  () => contains(svc, "export async function runCopilotQuery", "svc"));
test("exports buildCopilotPrompt function",() => contains(svc, "export function buildCopilotPrompt", "svc"));
test("exports VALID_COPILOT_MODES array", () => contains(svc, "export const VALID_COPILOT_MODES", "svc"));
test("exports SUGGESTED_PROMPTS object",  () => contains(svc, "export const SUGGESTED_PROMPTS", "svc"));
test("exports CopilotMode type",          () => contains(svc, "export type CopilotMode", "svc"));
test("exports CopilotAction interface",   () => contains(svc, "export interface CopilotAction", "svc"));
test("exports CopilotResponse interface", () => contains(svc, "export interface CopilotResponse", "svc"));
test("exports DraftOutput interface",     () => contains(svc, "export interface DraftOutput", "svc"));

// ── 7. AI service — prompt discipline ────────────────────────────────────────

console.log("\n7. AI service — prompt discipline");

test("system prompt says never invent",       () => contains(svc, "Never invent", "svc"));
test("system prompt says preserve numbers",   () => contains(svc, "Preserve exact numbers", "svc"));
test("system prompt separates facts from recs",() => contains(svc, "Separate facts", "svc"));
test("system prompt says do not auto-send",   () => contains(svc, "Do not auto-send", "svc"));
test("system prompt covers board-safe mode",  () => contains(svc, "BOARD-SAFE", "svc"));
test("email_draft mode includes do not send warning", () => contains(svc, "DO NOT SEND", "svc"));
test("uses buildOpenAIModelParams compat helper", () => contains(svc, "buildOpenAIModelParams", "svc"));
test("uses response_format json_object",      () => contains(svc, "json_object", "svc"));
test("handles missing API key gracefully",    () => contains(svc, "No OpenAI API key", "svc"));

// ── 8. AI service — all 8 modes defined ──────────────────────────────────────

console.log("\n8. AI service — modes");

for (const m of ["ask", "strategy", "follow_up", "board_update", "closing_plan", "data_room", "engagement", "email_draft"]) {
  test(`mode ${m} defined`, () => contains(svc, `"${m}"`, "svc"));
}

// ── 9. Routes — API endpoint ──────────────────────────────────────────────────

console.log("\n9. Routes — API endpoint");

test("POST /api/capital/copilot/query exists",    () => contains(routes, '"/api/capital/copilot/query"', "routes"));
test("GET /api/capital/copilot/metadata exists",  () => contains(routes, '"/api/capital/copilot/metadata"', "routes"));
test("copilot route uses requireCapitalAccess",   () => contains(routes, "requireCapitalAccess", "routes"));
test("route imports capital-copilot-context",     () => contains(routes, "capital-copilot-context", "routes"));
test("route imports capital-copilot",             () => contains(routes, "capital-copilot", "routes"));
test("route validates mode with VALID_COPILOT_MODES",() => contains(routes, "VALID_COPILOT_MODES", "routes"));
test("route calls buildCopilotContext",           () => contains(routes, "buildCopilotContext", "routes"));
test("route calls runCopilotQuery",               () => contains(routes, "runCopilotQuery", "routes"));
test("response includes answer",                  () => contains(routes, "answer:", "routes"));
test("response includes recommended_actions",     () => contains(routes, "recommended_actions", "routes"));

// ── 10. Frontend page — structure ────────────────────────────────────────────

console.log("\n10. Frontend page — structure");

test("page default export is CapitalCopilotPage",  () => contains(page, "export default function CapitalCopilotPage", "page"));
test("page has data-testid=capital-copilot-page",  () => contains(page, 'data-testid="capital-copilot-page"', "page"));
test("page has mode selector",                     () => contains(page, 'data-testid="copilot-mode-selector"', "page"));
test("page has round selector",                    () => contains(page, 'data-testid="copilot-round-selector"', "page"));
test("page has investor selector",                 () => contains(page, 'data-testid="copilot-investor-selector"', "page"));
test("page has include-sensitive toggle",          () => contains(page, 'data-testid="copilot-include-sensitive"', "page"));
test("page has question input",                    () => contains(page, 'data-testid="copilot-question-input"', "page"));
test("page has submit button",                     () => contains(page, 'data-testid="btn-copilot-submit"', "page"));
test("page has suggested prompts",                 () => contains(page, 'data-testid="copilot-suggested-prompts"', "page"));
test("page renders answer text",                   () => contains(page, 'data-testid="copilot-answer-text"', "page"));
test("page renders recommended actions",           () => contains(page, 'data-testid="copilot-recommended-actions"', "page"));
test("page renders draft output",                  () => contains(page, 'data-testid="copilot-draft-output"', "page"));
test("page renders context-used section",          () => contains(page, 'data-testid="copilot-context-used"', "page"));
test("page has restricted audience label",         () => contains(page, "Trevor", "page"));
test("page has empty state",                       () => contains(page, 'data-testid="copilot-empty-state"', "page"));
test("page queries /api/capital/copilot/metadata", () => contains(page, '"/api/capital/copilot/metadata"', "page"));
test("page posts to /api/capital/copilot/query",   () => contains(page, '"/api/capital/copilot/query"', "page"));
test("all 8 modes rendered in MODES array",        () => {
  for (const m of ["ask", "strategy", "follow_up", "board_update", "closing_plan", "data_room", "engagement", "email_draft"]) {
    contains(page, `"${m}"`, "page");
  }
});

// ── 11. Nav config ────────────────────────────────────────────────────────────

console.log("\n11. Nav config");

test("nav has capital-copilot id",       () => contains(nav, "capital-copilot", "nav"));
test("nav has AI Copilot label",         () => contains(nav, "AI Copilot", "nav"));
test("nav routes to /capital/copilot",   () => contains(nav, "/capital/copilot", "nav"));

// ── 12. App.tsx ───────────────────────────────────────────────────────────────

console.log("\n12. App.tsx");

test("App.tsx has lazy import for CapitalCopilotPage", () =>
  contains(app, "CapitalCopilotPage", "app"));
test("App.tsx has route for /capital/copilot",         () =>
  contains(app, "/capital/copilot", "app"));
test("capital/copilot route uses capitalGuard",        () =>
  contains(app, "capitalGuard", "app"));

// ── 13. Investor detail integration ──────────────────────────────────────────

console.log("\n13. Investor detail integration");

test("investor detail has Ask Copilot button",           () => contains(inv, "Copilot", "inv"));
test("investor detail links to /capital/copilot",        () => contains(inv, "/capital/copilot", "inv"));

// ── 14. Command center integration ───────────────────────────────────────────

console.log("\n14. Command center integration");

test("command center links to /capital/copilot",         () => contains(cmd, "/capital/copilot", "cmd"));
test("command center has Ask Copilot button",            () => contains(cmd, "Copilot", "cmd"));

// ── Summary ───────────────────────────────────────────────────────────────────

console.log("\n" + "─".repeat(60));
console.log(`  Phase 2K Tests: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  failures.forEach(f => console.log(`    FAIL: ${f.name} — ${f.err}`));
}
console.log("─".repeat(60));

if (failed > 0) process.exit(1);
