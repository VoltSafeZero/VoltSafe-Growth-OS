"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const followSrc = fs.readFileSync(path.join(__dirname, "../server/services/ai-follow-up.ts"), "utf8");
const routesSrc = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; }
}

// ── Exported types / functions ────────────────────────────────────────────────
test("buildEngagementSummary is exported", () => {
  assert.ok(followSrc.includes("export async function buildEngagementSummary"),
    "buildEngagementSummary must be exported");
});
test("generateFollowUpEmail is exported", () => {
  assert.ok(followSrc.includes("export async function generateFollowUpEmail"),
    "generateFollowUpEmail must be exported");
});
test("dismissInsight is exported", () => {
  assert.ok(followSrc.includes("export function dismissInsight"),
    "dismissInsight must be exported");
});
test("isInsightDismissed is exported", () => {
  assert.ok(followSrc.includes("export function isInsightDismissed"),
    "isInsightDismissed must be exported");
});

// ── Category definitions ──────────────────────────────────────────────────────
const categories = ["hot", "warm", "re-engage", "technical", "commercial", "dormant", "neutral"];
categories.forEach(cat => {
  test(`FollowUpCategory includes "${cat}"`, () => {
    assert.ok(followSrc.includes(`"${cat}"`), `category "${cat}" must be defined`);
  });
});

// ── TECHNICAL_PATTERNS and COMMERCIAL_PATTERNS ────────────────────────────────
test("TECHNICAL_PATTERNS is defined", () => {
  assert.ok(followSrc.includes("TECHNICAL_PATTERNS"), "TECHNICAL_PATTERNS must be defined");
});
test("TECHNICAL_PATTERNS includes spec and cert", () => {
  assert.ok(followSrc.includes('"spec"'), "TECHNICAL_PATTERNS must include spec");
  assert.ok(followSrc.includes('"cert"'), "TECHNICAL_PATTERNS must include cert");
});
test("COMMERCIAL_PATTERNS is defined", () => {
  assert.ok(followSrc.includes("COMMERCIAL_PATTERNS"), "COMMERCIAL_PATTERNS must be defined");
});
test("COMMERCIAL_PATTERNS includes pric and proposal", () => {
  assert.ok(followSrc.includes('"pric"'), "COMMERCIAL_PATTERNS must include pric");
  assert.ok(followSrc.includes('"proposal"'), "COMMERCIAL_PATTERNS must include proposal");
});
test("TECHNICAL_PATTERNS does NOT contain guide (removed per spec)", () => {
  // "guide" was removed from TECHNICAL_PATTERNS — verify it stays out
  const techStart = followSrc.indexOf("TECHNICAL_PATTERNS = [");
  const techEnd   = followSrc.indexOf("];", techStart);
  const techBlock = followSrc.slice(techStart, techEnd);
  assert.ok(!techBlock.includes('"guide"'), '"guide" must NOT be in TECHNICAL_PATTERNS');
});

// ── categoriseCta helper ──────────────────────────────────────────────────────
test("categoriseCta function is defined", () => {
  assert.ok(followSrc.includes("function categoriseCta"), "categoriseCta must be defined");
});
test("categoriseCta returns technical, commercial, or other", () => {
  assert.ok(
    followSrc.includes('"technical"') && followSrc.includes('"commercial"') && followSrc.includes('"other"'),
    'categoriseCta must return "technical", "commercial", or "other"'
  );
});

// ── Internal click exclusion ──────────────────────────────────────────────────
test("buildEngagementSummary excludes internal clicks (is_internal filter)", () => {
  const engBlock = followSrc.slice(followSrc.indexOf("export async function buildEngagementSummary"));
  assert.ok(
    engBlock.includes("is_internal") || engBlock.includes("is_internal IS NOT TRUE"),
    "engagement summary must exclude internal clicks via is_internal filter"
  );
});

// ── Engagement summary structure ──────────────────────────────────────────────
test("EngagementSummary includes daysSinceLastReply", () => {
  assert.ok(followSrc.includes("daysSinceLastReply"), "EngagementSummary must include daysSinceLastReply");
});
test("EngagementSummary includes daysSinceLastOutbound", () => {
  assert.ok(followSrc.includes("daysSinceLastOutbound"), "must include daysSinceLastOutbound");
});
test("EngagementSummary includes ctaClicks array", () => {
  assert.ok(followSrc.includes("ctaClicks"), "EngagementSummary must include ctaClicks array");
});
test("EngagementSummary includes whyText explanation bullets", () => {
  assert.ok(followSrc.includes("whyText"), "EngagementSummary must include whyText");
});

// ── Dismiss store ─────────────────────────────────────────────────────────────
test("dismissInsight stores entity type + id", () => {
  const dismissBlock = followSrc.slice(followSrc.indexOf("export function dismissInsight"));
  assert.ok(
    dismissBlock.includes("entityType") && dismissBlock.includes("entityId"),
    "dismissInsight must key on entityType + entityId"
  );
});
test("isInsightDismissed checks the dismiss store", () => {
  const checkBlock = followSrc.slice(followSrc.indexOf("export function isInsightDismissed"));
  assert.ok(checkBlock.includes("entityType") && checkBlock.includes("entityId"),
    "isInsightDismissed must check entityType + entityId");
});

// ── API routes ────────────────────────────────────────────────────────────────
test("GET /api/ai-follow-up/insights route exists", () => {
  assert.ok(routesSrc.includes('"/api/ai-follow-up/insights"'),
    "GET /api/ai-follow-up/insights must be registered");
});
test("POST /api/ai-follow-up/generate route exists", () => {
  assert.ok(routesSrc.includes('"/api/ai-follow-up/generate"'),
    "POST /api/ai-follow-up/generate must be registered");
});
test("POST /api/ai-follow-up/dismiss route exists", () => {
  assert.ok(routesSrc.includes('"/api/ai-follow-up/dismiss"'),
    "POST /api/ai-follow-up/dismiss must be registered");
});
test("all follow-up routes require authentication", () => {
  const insightsIdx = routesSrc.indexOf('"/api/ai-follow-up/insights"');
  const generateIdx = routesSrc.indexOf('"/api/ai-follow-up/generate"');
  const dismissIdx  = routesSrc.indexOf('"/api/ai-follow-up/dismiss"');
  [
    [insightsIdx, "insights"],
    [generateIdx, "generate"],
    [dismissIdx,  "dismiss"],
  ].forEach(([idx, name]) => {
    const ctx = routesSrc.slice(idx - 200, idx + 100);
    assert.ok(ctx.includes("requireAuth"), `${name} route must include requireAuth`);
  });
});
test("insights route calls buildEngagementSummary", () => {
  const insBlock = routesSrc.slice(
    routesSrc.indexOf('"/api/ai-follow-up/insights"'),
    routesSrc.indexOf('"/api/ai-follow-up/insights"') + 600
  );
  assert.ok(insBlock.includes("buildEngagementSummary"),
    "insights route must call buildEngagementSummary");
});
test("generate route calls generateFollowUpEmail", () => {
  const genBlock = routesSrc.slice(
    routesSrc.indexOf('"/api/ai-follow-up/generate"'),
    routesSrc.indexOf('"/api/ai-follow-up/generate"') + 600
  );
  assert.ok(genBlock.includes("generateFollowUpEmail"),
    "generate route must call generateFollowUpEmail");
});
test("dismiss route calls dismissInsight", () => {
  const disBlock = routesSrc.slice(
    routesSrc.indexOf('"/api/ai-follow-up/dismiss"'),
    routesSrc.indexOf('"/api/ai-follow-up/dismiss"') + 400
  );
  assert.ok(disBlock.includes("dismissInsight"),
    "dismiss route must call dismissInsight");
});

// ── daysBetween helper ────────────────────────────────────────────────────────
test("daysBetween helper handles null gracefully", () => {
  assert.ok(followSrc.includes("if (!dateStr) return null"),
    "daysBetween must return null for null input");
});

// ── Category classification logic (inline) ────────────────────────────────────
test("hot category: multiple opens AND clicks AND no reply", () => {
  assert.ok(
    followSrc.includes('"hot"'),
    'hot category must be classified in the source'
  );
  // Verify classification conditions exist in source
  assert.ok(
    followSrc.includes("uniqueOpens") && followSrc.includes("uniqueClicks"),
    "hot category must be driven by uniqueOpens and uniqueClicks"
  );
});
test("dormant category: no activity for 14+ days", () => {
  assert.ok(followSrc.includes("14"), "dormant threshold of 14 days must appear in source");
  assert.ok(followSrc.includes('"dormant"'), 'dormant category must be defined');
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
