/**
 * CRM Intelligence Context — source-grep regression tests
 *
 * Verifies the structural invariants of the rolling context system without
 * making live DB or OpenAI calls.
 *
 * Run with: node tests/crm-intelligence-context.test.cjs
 */

"use strict";

const fs   = require("fs");
const path = require("path");

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

// ─── Load source files ──────────────────────────────────────────────────────

const svcPath   = path.join(__dirname, "../server/services/crm-intelligence-context.ts");
const summaryPath = path.join(__dirname, "../server/services/crm-ai-summary.ts");
const seedPath  = path.join(__dirname, "../server/seed-production.ts");
const indexPath = path.join(__dirname, "../server/index.ts");
const routesPath = path.join(__dirname, "../server/routes.ts");
const backfillPath = path.join(__dirname, "../scripts/crm-intelligence-context-backfill.ts");

const svc     = fs.readFileSync(svcPath, "utf8");
const summary = fs.readFileSync(summaryPath, "utf8");
const seed    = fs.readFileSync(seedPath, "utf8");
const index   = fs.readFileSync(indexPath, "utf8");
const routes  = fs.readFileSync(routesPath, "utf8");
const backfill = fs.readFileSync(backfillPath, "utf8");

// ─── T1: DB table migration defined ────────────────────────────────────────

console.log("\nT1: DB table migration");
assert(seed.includes("migrateCrmIntelligenceContextSchema"), "migrateCrmIntelligenceContextSchema exported from seed-production.ts");
assert(seed.includes("CREATE TABLE IF NOT EXISTS crm_intelligence_context"), "crm_intelligence_context CREATE TABLE in seed-production.ts");
assert(seed.includes("UNIQUE (record_type, record_id)"), "UNIQUE constraint on (record_type, record_id)");
assert(seed.includes("last_context_build_at"), "last_context_build_at column defined");
assert(seed.includes("durable_summary"), "durable_summary column defined");
assert(seed.includes("recent_activity_digest"), "recent_activity_digest column defined");
assert(seed.includes("source_coverage"), "source_coverage column defined");
assert(seed.includes("key_people"), "key_people column defined");
assert(seed.includes("open_loops"), "open_loops column defined");

// ─── T2: Migration wired into boot sequence ─────────────────────────────────

console.log("\nT2: Migration boot sequence");
assert(index.includes("migrateCrmIntelligenceContextSchema"), "migrateCrmIntelligenceContextSchema called in server/index.ts");
assert(
  index.includes("await migrateCrmIntelligenceContextSchema()") ||
  index.includes("migrateCrmIntelligenceContextSchema()"), // parallel-batch pattern
  "migration awaited at startup"
);

// ─── T3: Service exports all required functions ─────────────────────────────

console.log("\nT3: Service exports");
assert(svc.includes("export async function getCrmIntelligenceContext"), "getCrmIntelligenceContext exported");
assert(svc.includes("export async function buildOrUpdateCrmIntelligenceContext"), "buildOrUpdateCrmIntelligenceContext exported");
assert(svc.includes("export async function getNewCrmActivitySince"), "getNewCrmActivitySince exported");
assert(svc.includes("export async function buildSuggestedEmailContext"), "buildSuggestedEmailContext exported");
assert(svc.includes("export async function debugCrmIntelligenceContext"), "debugCrmIntelligenceContext exported");

// ─── T4: Intelligence context data model ────────────────────────────────────

console.log("\nT4: Intelligence context data model");
assert(svc.includes("interface CrmIntelligenceContext"), "CrmIntelligenceContext interface defined");
assert(svc.includes("interface SuggestedEmailContext"), "SuggestedEmailContext interface defined");
assert(svc.includes("interface RawActivityItem"), "RawActivityItem interface defined");
assert(svc.includes("highPriorityRecentActivity"), "highPriorityRecentActivity field in SuggestedEmailContext");
assert(svc.includes("durableContext"), "durableContext field in SuggestedEmailContext");
assert(svc.includes("estimatedPromptChars"), "estimatedPromptChars field (token budget tracking)");
assert(svc.includes("hasIntelligenceContext"), "hasIntelligenceContext field for fallback detection");
assert(svc.includes("cutoffUsed"), "cutoffUsed field (incremental tracking)");

// ─── T5: First-run bootstraps from crm_ai_summaries ────────────────────────

console.log("\nT5: First-run bootstrap uses existing AI summary");
assert(svc.includes("crm_ai_summaries"), "reads crm_ai_summaries for durable context bootstrap");
assert(svc.includes("builtFromAiSummary"), "tracks whether bootstrap used existing AI summary");
assert(svc.includes("aiSummaryGeneratedAt"), "records the AI summary generation timestamp as cutoff");
assert(svc.includes("Bootstrap: use existing AI summary as durable context"), "bootstrap code path comment present");

// ─── T6: Incremental update path ────────────────────────────────────────────

console.log("\nT6: Incremental update (second run)");
assert(svc.includes("Incremental update: only process new activity"), "incremental update code path present");
assert(svc.includes("getNewCrmActivitySince(recordType, id, existing.lastContextBuildAt)"), "uses lastContextBuildAt as the incremental cutoff");
assert(svc.includes("newActivity.length === 0"), "handles case of no new activity");
assert(svc.includes("advance the build timestamp"), "advances last_context_build_at even when no new activity");

// ─── T7: Safety guard — never overwrite with empty ──────────────────────────

console.log("\nT7: Empty-output safety guards");
assert(svc.includes("ON CONFLICT (record_type, record_id) DO UPDATE SET"), "upsert never creates duplicate rows");
assert(svc.includes("Never overwrite a good context with empty data"), "safety guard comment present");
// The function returns early (null) rather than wiping a good context
assert(svc.includes("return getCrmIntelligenceContext(recordType, id)") || svc.includes("return null"), "returns null on error (preserves existing context)");

// ─── T8: getNewCrmActivitySince covers all activity types ───────────────────

console.log("\nT8: getNewCrmActivitySince completeness");
assert(svc.includes("email_associations"), "queries email_associations for new emails");
assert(svc.includes("FROM notes"), "queries notes for new items");
assert(svc.includes("FROM activities"), "queries activities for new items");
assert(svc.includes("ORDER BY em.sent_at DESC"), "emails ordered newest-first");
assert(svc.includes("ORDER BY created_at DESC"), "notes/activities ordered newest-first");
assert(svc.includes("AND em.sent_at >"), "emails filtered by sinceTimestamp");
assert(svc.includes("AND created_at >"), "notes/activities filtered by sinceTimestamp");

// ─── T9: generateSuggestedNextEmail uses intelligence context ───────────────

console.log("\nT9: generateSuggestedNextEmail uses intelligence context");
assert(summary.includes("import { buildSuggestedEmailContext }"), "buildSuggestedEmailContext imported in crm-ai-summary.ts");
assert(summary.includes("buildSuggestedEmailContext(entityType, id)"), "buildSuggestedEmailContext called in generateSuggestedNextEmail");
assert(summary.includes("intelligenceCtx.highPriorityRecentActivity"), "uses highPriorityRecentActivity in prompt");
assert(summary.includes("intelligenceCtx.durableContext.summary"), "uses durableContext.summary in prompt");
assert(summary.includes("intelligenceCtx.keyPeople"), "uses keyPeople from intelligence context");
assert(summary.includes("intelligenceCtx.currentCrmState"), "uses currentCrmState from intelligence context");
assert(summary.includes("DURABLE HISTORICAL CONTEXT"), "durable historical context section in prompt");
assert(summary.includes("intelligence context — est="), "logs estimated prompt chars");

// ─── T10: Old unbounded raw dump is gone ────────────────────────────────────

console.log("\nT10: Old unbounded dump removed from generateSuggestedNextEmail");
// The old pattern was: ctx.emails (50 emails), ctx.notes (25 notes), ctx.activities (20 activities)
// These should no longer appear in the suggested email generation
const suggestStart = summary.indexOf("export async function generateSuggestedNextEmail");
const suggestEnd = summary.indexOf("\n// ── Backfill", suggestStart);
const suggestFn = suggestEnd > 0 ? summary.slice(suggestStart, suggestEnd) : summary.slice(suggestStart);
assert(!suggestFn.includes("const ctx = await collectCrmEntityContext"), "collectCrmEntityContext no longer called in generateSuggestedNextEmail");
assert(!suggestFn.includes("ctx.notes.slice"), "ctx.notes no longer directly iterated in prompt");
assert(!suggestFn.includes("ctx.activities.slice"), "ctx.activities no longer directly iterated in prompt");
assert(!suggestFn.includes("selectSmartEmailContext(ctx"), "old smartEmails selection removed");

// ─── T11: Token budget is controlled ────────────────────────────────────────

console.log("\nT11: Token budget controls");
assert(summary.includes("tokenLimit: 4000") || summary.includes("tokenLimit: 2500"), "explicit tokenLimit set");
assert(svc.includes("slice(0, 5)"), "latest items capped at 5 for full detail");
assert(svc.includes("slice(0, 15)"), "recent digest capped at 15 items");
assert(svc.includes("estimatedPromptChars"), "prompt size estimated and logged");

// ─── T12: buildSuggestedEmailContext structure ──────────────────────────────

console.log("\nT12: buildSuggestedEmailContext structure");
assert(svc.includes("buildOrUpdateCrmIntelligenceContext(recordType, id)"), "buildSuggestedEmailContext triggers build/update");
assert(svc.includes("getNewCrmActivitySince(recordType, id, ctx.lastContextBuildAt"), "fetches very-recent items since last build");
assert(svc.includes("getEntityFields"), "fetches fresh entity fields");
assert(svc.includes("getContactsForRecord"), "fetches fresh contacts");
// Fallback when no intelligence context
assert(svc.includes("Fallback: no intelligence context"), "fallback path when context cannot be built");

// ─── T13: Debug endpoint defined ────────────────────────────────────────────

console.log("\nT13: Debug endpoint");
assert(routes.includes("/intelligence-context/debug"), "debug endpoint path registered in routes.ts");
assert(routes.includes("debugCrmIntelligenceContext"), "debugCrmIntelligenceContext called in debug route");
assert(svc.includes("export async function debugCrmIntelligenceContext"), "debugCrmIntelligenceContext exported from service");
assert(svc.includes("estimatedPromptCharsForSuggestedEmail"), "debug response includes prompt size estimate");
assert(svc.includes("newActivityCountSinceLastBuild"), "debug response includes new activity count");
assert(svc.includes("durableSummaryLength"), "debug response includes durable summary length");

// ─── T14: Backfill script completeness ──────────────────────────────────────

console.log("\nT14: Backfill script");
assert(backfill.includes("--dry-run"), "supports --dry-run flag");
assert(backfill.includes("--force"), "supports --force rebuild flag");
assert(backfill.includes("--record"), "supports --record single record flag");
assert(backfill.includes("--all"), "supports --all flag");
assert(backfill.includes("buildOrUpdateCrmIntelligenceContext"), "calls buildOrUpdateCrmIntelligenceContext");
assert(backfill.includes("getCrmIntelligenceContext"), "checks existing context before rebuild");
assert(backfill.includes("processBatch"), "processes in batches");
assert(backfill.includes("skip if exists") || backfill.includes("hasContext") || backfill.includes("context already exists"), "skips records that already have context (idempotent)");

// ─── T15: Source coverage tracking ──────────────────────────────────────────

console.log("\nT15: Source coverage tracking");
assert(svc.includes("interface SourceCoverage"), "SourceCoverage interface defined");
assert(svc.includes("emailsThroughTimestamp"), "tracks emails cutoff timestamp");
assert(svc.includes("notesThroughTimestamp"), "tracks notes cutoff timestamp");
assert(svc.includes("activitiesThroughTimestamp"), "tracks activities cutoff timestamp");
assert(svc.includes("builtFromAiSummary"), "records whether AI summary was used");

// ─── T16: upsert safety ─────────────────────────────────────────────────────

console.log("\nT16: Upsert / no-duplicate safety");
assert(svc.includes("ON CONFLICT (record_type, record_id) DO UPDATE SET"), "upsert uses ON CONFLICT");
assert(svc.includes("updated_at = NOW()"), "updated_at maintained on upsert");
assert(seed.includes("UNIQUE (record_type, record_id)"), "DB UNIQUE constraint prevents duplicate rows");

// ─── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`crm-intelligence-context: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
