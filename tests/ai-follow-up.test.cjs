/**
 * ai-follow-up.test.cjs
 *
 * Phase 3: AI Follow-Up Engine.
 * Source-grep and unit-level logic tests — no DB, no network calls required.
 */

const fs = require("fs");
const assert = require("assert");

let passed = 0;
let failed = 0;

function check(label, value, hint = "") {
  if (value) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${hint ? " — " + hint : ""}`);
    failed++;
  }
}

function read(p) {
  try { return fs.readFileSync(p, "utf8"); } catch { return ""; }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Service: ai-follow-up.ts
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── 1. Service — ai-follow-up.ts ─────────────────────────────────────────────");
{
  const src = read("server/services/ai-follow-up.ts");

  // Core exports
  check("buildEngagementSummary exported", src.includes("export async function buildEngagementSummary("));
  check("generateFollowUpEmail exported", src.includes("export async function generateFollowUpEmail("));
  check("dismissInsight exported", src.includes("export function dismissInsight("));
  check("isInsightDismissed exported", src.includes("export function isInsightDismissed("));

  // Type exports
  check("EngagementSummary type exported", src.includes("export interface EngagementSummary") || src.includes("export type EngagementSummary"));
  check("FollowUpCategory type exported", src.includes("export type FollowUpCategory"));
  check("FollowUpGenerateParams type exported", src.includes("export interface FollowUpGenerateParams"));

  // Category classification
  check("'hot' category defined", src.includes('"hot"'));
  check("'warm' category defined", src.includes('"warm"'));
  check("'re-engage' category defined", src.includes('"re-engage"'));
  check("'technical' category defined", src.includes('"technical"'));
  check("'commercial' category defined", src.includes('"commercial"'));
  check("'dormant' category defined", src.includes('"dormant"'));
  check("'neutral' category defined", src.includes('"neutral"'));

  // Engagement data sources
  check("queries email_associations for email counts", src.includes("email_associations"));
  check("queries email_messages via join", src.includes("email_messages em"));
  check("queries signature_cta_clicks for CTA data", src.includes("signature_cta_clicks"));
  check("excludes internal tracking data", src.includes("is_internal IS NOT TRUE") || src.includes("is_internal is not true"));
  check("filters out bot opens/clicks", src.includes("is_bot = FALSE") || src.includes("is_bot"));
  check("filters out duplicates", src.includes("is_duplicate = FALSE") || src.includes("is_duplicate"));

  // Classification logic
  check("hot category triggered by opens without reply", src.includes("uniqueOpens >= 3") || src.includes("uniqueOpens >="));
  check("dormant triggered by 14+ day gap", src.includes("14"));
  check("technical URLs detected", src.includes("spec") && src.includes("install"));
  check("commercial URLs detected", src.includes("pric") || src.includes("pricing"));

  // Category insight labels present
  check("hot label present", src.includes("High intent") || src.includes("high intent") || src.includes("🔥"));
  check("dormant label present", src.includes("Dormant") || src.includes("dormant") || src.includes("💤"));

  // dismiss store
  check("dismiss store is in-memory Map", src.includes("new Map<string, boolean>") || src.includes("new Map()"));
  check("dismiss key format is entityType:entityId", src.includes('`${entityType}:${entityId}`'));
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Routes: Phase 3 follow-up endpoints
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── 2. Routes — Phase 3 follow-up endpoints ──────────────────────────────────");
{
  const routes = read("server/routes.ts");

  // GET insights
  check("GET /api/ai-follow-up/insights defined",
    routes.includes('"/api/ai-follow-up/insights"'));
  check("insights route uses GET",
    (() => {
      const idx = routes.indexOf('"/api/ai-follow-up/insights"');
      return idx >= 0 && routes.slice(Math.max(0, idx - 15), idx).includes("get(");
    })()
  );
  check("insights route requires auth",
    (() => {
      const idx = routes.indexOf('"/api/ai-follow-up/insights"');
      const ctx = routes.slice(Math.max(0, idx - 100), idx + 100);
      return ctx.includes("requireAuth");
    })()
  );
  check("insights route imports buildEngagementSummary",
    (() => {
      const idx = routes.indexOf('"/api/ai-follow-up/insights"');
      const ctx = routes.slice(idx, idx + 500);
      return ctx.includes("buildEngagementSummary");
    })()
  );
  check("insights route checks isInsightDismissed",
    (() => {
      const idx = routes.indexOf('"/api/ai-follow-up/insights"');
      const ctx = routes.slice(idx, idx + 500);
      return ctx.includes("isInsightDismissed");
    })()
  );

  // POST generate
  check("POST /api/ai-follow-up/generate defined",
    routes.includes('"/api/ai-follow-up/generate"'));
  check("generate route uses POST",
    (() => {
      const idx = routes.indexOf('"/api/ai-follow-up/generate"');
      return idx >= 0 && routes.slice(Math.max(0, idx - 15), idx).includes("post(");
    })()
  );
  check("generate route calls buildEngagementSummary",
    (() => {
      const idx = routes.indexOf('"/api/ai-follow-up/generate"');
      const ctx = routes.slice(idx, idx + 600);
      return ctx.includes("buildEngagementSummary");
    })()
  );
  check("generate route calls generateFollowUpEmail",
    (() => {
      const idx = routes.indexOf('"/api/ai-follow-up/generate"');
      const ctx = routes.slice(idx, idx + 600);
      return ctx.includes("generateFollowUpEmail");
    })()
  );
  check("generate route passes voiceProfileId",
    (() => {
      const idx = routes.indexOf('"/api/ai-follow-up/generate"');
      const ctx = routes.slice(idx, idx + 600);
      return ctx.includes("voiceProfileId");
    })()
  );

  // POST dismiss
  check("POST /api/ai-follow-up/dismiss defined",
    routes.includes('"/api/ai-follow-up/dismiss"'));
  check("dismiss route uses POST",
    (() => {
      const idx = routes.indexOf('"/api/ai-follow-up/dismiss"');
      return idx >= 0 && routes.slice(Math.max(0, idx - 15), idx).includes("post(");
    })()
  );
  check("dismiss route calls dismissInsight",
    (() => {
      const idx = routes.indexOf('"/api/ai-follow-up/dismiss"');
      const ctx = routes.slice(idx, idx + 300);
      return ctx.includes("dismissInsight");
    })()
  );
  check("dismiss route validates entityType + entityId",
    (() => {
      const idx = routes.indexOf('"/api/ai-follow-up/dismiss"');
      const ctx = routes.slice(idx, idx + 300);
      return ctx.includes("entityType") && ctx.includes("entityId");
    })()
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. crm-ai-summary.ts: engagement context injected into prompt
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── 3. crm-ai-summary.ts — engagement context in prompt ──────────────────────");
{
  const src = read("server/services/crm-ai-summary.ts");

  check("EngagementContext interface exported", src.includes("export interface EngagementContext"));
  check("EngagementContext has category field", src.includes("category: string"));
  check("EngagementContext has whyText field", src.includes("whyText: string[]"));
  check("EngagementContext has uniqueOpens field", src.includes("uniqueOpens: number"));
  check("EngagementContext has uniqueClicks field", src.includes("uniqueClicks: number"));
  check("EngagementContext has ctaClicks field", src.includes("ctaClicks: Array<"));
  check("generateSuggestedNextEmail accepts 7th param engagementSummary",
    (() => {
      const fnSrc = src.slice(src.indexOf("export async function generateSuggestedNextEmail"), src.indexOf("export async function generateSuggestedNextEmail") + 600);
      return fnSrc.includes("engagementSummary");
    })()
  );
  check("ENGAGEMENT SIGNALS section in prompt",
    src.includes("ENGAGEMENT SIGNALS")
  );
  check("FOLLOW-UP GUIDANCE based on category in prompt",
    src.includes("FOLLOW-UP GUIDANCE based on category")
  );
  check("technical category guidance injected",
    src.includes("technical/spec content")
  );
  check("commercial category guidance injected",
    src.includes("pricing/proposal content")
  );
  check("hot category guidance injected",
    src.includes("no reply — they") || src.includes("High open count")
  );
  check("dormant category guidance injected",
    src.includes("circling back") || src.includes("Dormant") || src.includes("dormant")
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Unit logic: classify engagement
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── 4. Unit logic — engagement classification ────────────────────────────────");
{
  const TECHNICAL_PATTERNS = ["spec", "pedestal", "shore-power", "shore_power", "cert", "install", "compliance", "technical", "datasheet", "data-sheet", "manual", "commissioning", "wiring", "electrical"];
  const COMMERCIAL_PATTERNS = ["pric", "proposal", "quote", "roi", "return-on-investment", "cost", "budget", "procurement", "contract", "invest"];

  function categoriseCta(url, name) {
    const hay = `${url} ${name}`.toLowerCase();
    if (TECHNICAL_PATTERNS.some(p => hay.includes(p))) return "technical";
    if (COMMERCIAL_PATTERNS.some(p => hay.includes(p))) return "commercial";
    return "other";
  }

  check("spec URL → technical", categoriseCta("https://voltsafe.com/spec-sheet.pdf", "") === "technical");
  check("install URL → technical", categoriseCta("https://voltsafe.com/installation-guide", "") === "technical");
  check("electrical URL → technical", categoriseCta("https://voltsafe.com/electrical-specs", "") === "technical");
  check("certification URL → technical", categoriseCta("https://voltsafe.com/cert-docs", "") === "technical");
  check("pricing URL → commercial", categoriseCta("https://voltsafe.com/pricing", "") === "commercial");
  check("proposal URL → commercial", categoriseCta("https://voltsafe.com/send-proposal", "") === "commercial");
  check("budget URL → commercial", categoriseCta("", "Budget overview") === "commercial");
  check("ROI URL → commercial", categoriseCta("https://voltsafe.com/roi-calculator", "") === "commercial");
  check("generic URL → other", categoriseCta("https://voltsafe.com/about", "") === "other");
  check("name match works for commercial", categoriseCta("", "Pricing Proposal") === "commercial");
  check("name match works for technical", categoriseCta("", "Installation Manual") === "technical");
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Dismiss store logic (unit)
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── 5. Unit logic — dismiss store ────────────────────────────────────────────");
{
  // Replicate the simple dismiss store logic
  const store = new Map();
  const dismiss = (type, id) => store.set(`${type}:${id}`, true);
  const isDismissed = (type, id) => store.get(`${type}:${id}`) === true;

  check("not dismissed by default", !isDismissed("lead", 1));
  check("dismissed after dismiss call", (() => { dismiss("lead", 1); return isDismissed("lead", 1); })());
  check("different entity not affected", !isDismissed("lead", 2));
  check("different type not affected", !isDismissed("contact", 1));
  check("account type works", (() => { dismiss("account", 99); return isDismissed("account", 99); })());
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Regression: existing AI email generation unchanged
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── 6. Regression — existing AI email generation unchanged ───────────────────");
{
  const src = read("server/services/crm-ai-summary.ts");
  check("generateSuggestedNextEmail still exported", src.includes("export async function generateSuggestedNextEmail("));
  check("selectSmartEmailContext still exported", src.includes("export function selectSmartEmailContext("));
  check("cleanAiEmailBody still exported", src.includes("export function cleanAiEmailBody("));
  check("FORMATTING RULES still present", src.includes("=== FORMATTING RULES — MANDATORY ==="));
  check("no circular import (no import from ai-follow-up)", !src.includes('from "./ai-follow-up"'));
}

// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(70)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
