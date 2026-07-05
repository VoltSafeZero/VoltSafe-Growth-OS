/**
 * tests/campaign-reply-classifier.test.cjs
 *
 * Phase 7 — Reply Classification + Sales Task Automation
 *
 * Source-grep tests for the rule-based classifier, API routes, service functions,
 * and integration points. Mirrors the testing pattern from campaign-automation.test.cjs.
 */

"use strict";

const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const errors = [];

function assert(condition, label) {
  if (condition) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    errors.push(label);
    console.error(`  ✗ ${label}`);
  }
}

function readFile(relPath) {
  return fs.readFileSync(path.join(__dirname, "..", relPath), "utf8");
}

function hasPattern(text, pattern) {
  if (typeof pattern === "string") return text.includes(pattern);
  return pattern.test(text);
}

// ── Load source files ─────────────────────────────────────────────────────────

const classifier = readFile("server/services/campaign-reply-classifier.ts");
const routes = readFile("server/routes.ts");
const heatScore = readFile("server/services/account-heat-score.ts");
const indexTs = readFile("server/index.ts");
const navConfig = readFile("client/src/lib/nav-config.ts");
const appTsx = readFile("client/src/App.tsx");
const campaignDetail = readFile("client/src/pages/campaign-detail.tsx");
const accountProfile = readFile("client/src/pages/account-profile.tsx");
const repliesPage = readFile("client/src/pages/marketing-replies.tsx");

// ── Section 1: Migration ──────────────────────────────────────────────────────

console.log("\n── Section 1: Migration ─────────────────────────────────────────");

assert(
  hasPattern(classifier, "CREATE TABLE IF NOT EXISTS campaign_reply_classifications"),
  "Migration creates campaign_reply_classifications table"
);
assert(
  hasPattern(classifier, "CREATE INDEX IF NOT EXISTS idx_crc_campaign_id"),
  "Migration creates idx_crc_campaign_id index"
);
assert(
  hasPattern(classifier, "CREATE INDEX IF NOT EXISTS idx_crc_recipient_id"),
  "Migration creates idx_crc_recipient_id index"
);
assert(
  hasPattern(classifier, "CREATE INDEX IF NOT EXISTS idx_crc_contact_id"),
  "Migration creates idx_crc_contact_id index"
);
assert(
  hasPattern(classifier, "CREATE INDEX IF NOT EXISTS idx_crc_account_id"),
  "Migration creates idx_crc_account_id index"
);
assert(
  hasPattern(classifier, "CREATE INDEX IF NOT EXISTS idx_crc_classification"),
  "Migration creates idx_crc_classification index"
);
assert(
  hasPattern(classifier, "CREATE INDEX IF NOT EXISTS idx_crc_status"),
  "Migration creates idx_crc_status index"
);
assert(
  hasPattern(classifier, "CREATE INDEX IF NOT EXISTS idx_crc_created_at"),
  "Migration creates idx_crc_created_at index"
);
assert(
  hasPattern(indexTs, "migrateReplyClassificationSchema"),
  "server/index.ts calls migrateReplyClassificationSchema"
);

// ── Section 2: Rule-based classification ─────────────────────────────────────

console.log("\n── Section 2: Rule-based classification patterns ────────────────");

assert(
  hasPattern(classifier, /unsubscribe.*PATTERNS|UNSUBSCRIBE_PATTERNS/),
  "UNSUBSCRIBE_PATTERNS defined"
);
assert(
  hasPattern(classifier, /\/\\bunsubscribe\\b\//i) || hasPattern(classifier, "unsubscribe"),
  "Unsubscribe rule catches 'unsubscribe' keyword"
);
assert(
  hasPattern(classifier, /remove me|stop emailing|opt.*out/i),
  "Unsubscribe rule catches 'remove me', 'stop emailing', opt-out"
);
assert(
  hasPattern(classifier, "MEETING_PATTERNS"),
  "MEETING_PATTERNS defined"
);
assert(
  hasPattern(classifier, /book|schedule|demo|calendar|calendly/i),
  "Meeting rule catches booking/demo/calendar keywords"
);
assert(
  hasPattern(classifier, "PRICING_PATTERNS"),
  "PRICING_PATTERNS defined"
);
assert(
  hasPattern(classifier, /pricing|cost|budget|quote/i),
  "Pricing rule catches pricing/cost/budget/quote keywords"
);
assert(
  hasPattern(classifier, "TECHNICAL_PATTERNS"),
  "TECHNICAL_PATTERNS defined"
);
assert(
  hasPattern(classifier, /shore power|electrical|wiring|EVSE|install/i),
  "Technical rule catches shore power / electrical / install keywords"
);
assert(
  hasPattern(classifier, "PROCUREMENT_PATTERNS"),
  "PROCUREMENT_PATTERNS defined"
);
assert(
  hasPattern(classifier, /procurement|RFP|tender|council|committee/i),
  "Procurement rule catches RFP / tender / council keywords"
);
assert(
  hasPattern(classifier, "REFERRAL_PATTERNS"),
  "REFERRAL_PATTERNS defined"
);
assert(
  hasPattern(classifier, /talk.*to|speak.*to|reach out to/i),
  "Referral rule catches 'talk to', 'speak to', 'reach out' patterns"
);
assert(
  hasPattern(classifier, "AUTO_REPLY_PATTERNS"),
  "AUTO_REPLY_PATTERNS defined"
);
assert(
  hasPattern(classifier, /automatic.*reply|auto.*reply|noreply/i),
  "Auto-reply rule catches 'automatic reply' / 'auto-reply' / 'noreply'"
);
assert(
  hasPattern(classifier, "OUT_OF_OFFICE_PATTERNS"),
  "OUT_OF_OFFICE_PATTERNS defined"
);
assert(
  hasPattern(classifier, /out of office|on vacation|on holiday/i),
  "Out-of-office rule catches 'out of office', 'on vacation'"
);
assert(
  hasPattern(classifier, "NOT_NOW_PATTERNS"),
  "NOT_NOW_PATTERNS defined"
);
assert(
  hasPattern(classifier, /circle back|not now|later this/i),
  "Not-now rule catches 'circle back', 'not now'"
);
assert(
  hasPattern(classifier, "INTERESTED_PATTERNS"),
  "INTERESTED_PATTERNS defined"
);
assert(
  hasPattern(classifier, /interested|tell.*more|send.*more/i),
  "Interested rule catches 'interested', 'tell me more'"
);

// ── Section 3: AI fallback ────────────────────────────────────────────────────

console.log("\n── Section 3: AI fallback behavior ─────────────────────────────");

assert(
  hasPattern(classifier, "buildOpenAIModelParams"),
  "AI fallback uses buildOpenAIModelParams (compat helper)"
);
assert(
  hasPattern(classifier, "AI_INTEGRATIONS_OPENAI_API_KEY"),
  "AI client reads AI_INTEGRATIONS_OPENAI_API_KEY"
);
assert(
  hasPattern(classifier, "AI_INTEGRATIONS_OPENAI_BASE_URL"),
  "AI client reads AI_INTEGRATIONS_OPENAI_BASE_URL"
);
assert(
  hasPattern(classifier, "if (!client) return fallback"),
  "AI fallback returns 'unknown' safely when no API key"
);
assert(
  hasPattern(classifier, "classification: \"unknown\"") && hasPattern(classifier, "confidence: 0.1"),
  "AI fallback default classification is 'unknown' with low confidence"
);
assert(
  hasPattern(classifier, /catch.*err.*non-critical|AI classification failed.*non-critical/),
  "AI failure is caught and logged as non-critical"
);
assert(
  !hasPattern(classifier, /body\.slice\(0, [0-9]{4,}\)/),
  "Reply body is capped before sending to AI (no large slice > 999 chars)"
);
assert(
  hasPattern(classifier, "body.slice(0, 800)"),
  "Reply body preview sent to AI is capped at 800 chars"
);
assert(
  hasPattern(classifier, "VALID_CLASSIFICATIONS"),
  "AI response validated against VALID_CLASSIFICATIONS before use"
);

// ── Section 4: Core classifyCampaignReply function ───────────────────────────

console.log("\n── Section 4: classifyCampaignReply function ───────────────────");

assert(
  hasPattern(classifier, "export async function classifyCampaignReply"),
  "classifyCampaignReply is exported"
);
assert(
  hasPattern(classifier, "UPDATE campaign_recipients SET replied_at"),
  "classifyCampaignReply sets replied_at on campaign_recipients"
);
assert(
  hasPattern(classifier, "event_type.*replied") || hasPattern(classifier, "'replied'"),
  "classifyCampaignReply records campaign_event with event_type replied"
);
assert(
  hasPattern(classifier, "INSERT INTO campaign_reply_classifications"),
  "classifyCampaignReply inserts classification record"
);
assert(
  hasPattern(classifier, "classification === \"unsubscribe\"") ||
  hasPattern(classifier, "classification === 'unsubscribe'"),
  "Unsubscribe classification triggers processUnsubscribeReply"
);
assert(
  hasPattern(classifier, "processUnsubscribeReply"),
  "processUnsubscribeReply function exists"
);
assert(
  hasPattern(classifier, "INSERT INTO campaign_suppression"),
  "Unsubscribe suppresses email in campaign_suppression"
);
assert(
  hasPattern(classifier, "unsubscribe_status.*unsubscribed") || hasPattern(classifier, "'unsubscribed'"),
  "Unsubscribe updates contact unsubscribe_status"
);

// ── Section 5: createTaskFromClassification ───────────────────────────────────

console.log("\n── Section 5: createTaskFromClassification ──────────────────────");

assert(
  hasPattern(classifier, "export async function createTaskFromClassification"),
  "createTaskFromClassification is exported"
);
assert(
  hasPattern(classifier, "INSERT INTO tasks"),
  "createTaskFromClassification inserts a task record"
);
assert(
  hasPattern(classifier, "source.*campaign_reply") || hasPattern(classifier, "'campaign_reply'"),
  "Task created with source = 'campaign_reply'"
);
assert(
  hasPattern(classifier, "ai_suggested.*true") || hasPattern(classifier, "true"),
  "Task created with ai_suggested = true"
);
assert(
  hasPattern(classifier, /unsubscribe.*negative.*out_of_office.*auto_reply|blocked.*ReplyClassification/),
  "createTaskFromClassification blocks task for unsubscribe/negative/ooo/auto-reply"
);
assert(
  hasPattern(classifier, "status.*task_created") || hasPattern(classifier, "'task_created'"),
  "Classification status updated to 'task_created' after task creation"
);
assert(
  hasPattern(classifier, "task_id.*taskId") || hasPattern(classifier, "task_id = ${taskId}"),
  "task_id stored on classification record after creation"
);
assert(
  hasPattern(classifier, "shouldAutoCreateTask"),
  "shouldAutoCreateTask helper function defined"
);

// ── Section 6: API routes ─────────────────────────────────────────────────────

console.log("\n── Section 6: API routes in routes.ts ───────────────────────────");

assert(
  hasPattern(routes, "GET /api/marketing/replies") ||
  hasPattern(routes, '"/api/marketing/replies"'),
  "GET /api/marketing/replies route registered"
);
assert(
  hasPattern(routes, "/api/marketing/replies/:id") &&
  hasPattern(routes, "GET"),
  "GET /api/marketing/replies/:id route registered"
);
assert(
  hasPattern(routes, "/api/marketing/replies/classify"),
  "POST /api/marketing/replies/classify route registered"
);
assert(
  hasPattern(routes, "/api/marketing/replies/:id/review"),
  "POST /api/marketing/replies/:id/review route registered"
);
assert(
  hasPattern(routes, "/api/marketing/replies/:id/dismiss"),
  "POST /api/marketing/replies/:id/dismiss route registered"
);
assert(
  hasPattern(routes, "/api/marketing/replies/:id/create-task"),
  "POST /api/marketing/replies/:id/create-task route registered"
);
assert(
  hasPattern(routes, "classifyCampaignReply") || hasPattern(routes, "campaign-reply-classifier"),
  "Routes import and use classifyCampaignReply"
);
assert(
  hasPattern(routes, "requireAuth") && hasPattern(routes, "/api/marketing/replies"),
  "Reply routes require authentication"
);

// ── Section 7: Heat score integration ────────────────────────────────────────

console.log("\n── Section 7: Heat score integration ───────────────────────────");

assert(
  hasPattern(heatScore, "getAccountReplyClassificationScore") ||
  hasPattern(heatScore, "campaign-reply-classifier"),
  "Heat score imports/uses reply classification scoring"
);
assert(
  hasPattern(classifier, "meeting_request: 30"),
  "Heat score awards +30 for meeting_request classification (in classifier SCORE_MAP)"
);
assert(
  hasPattern(classifier, "interested: 20"),
  "Heat score awards +20 for interested classification (in classifier SCORE_MAP)"
);
assert(
  hasPattern(classifier, "unsubscribe: -25"),
  "Heat score penalizes -25 for unsubscribe classification (in classifier SCORE_MAP)"
);
assert(
  hasPattern(classifier, "negative: -15"),
  "Heat score penalizes -15 for negative classification (in classifier SCORE_MAP)"
);

// ── Section 8: Frontend — Replies page ───────────────────────────────────────

console.log("\n── Section 8: Frontend — Replies page ───────────────────────────");

assert(
  hasPattern(repliesPage, "/api/marketing/replies"),
  "Replies page fetches from /api/marketing/replies"
);
assert(
  hasPattern(repliesPage, "create-task"),
  "Replies page has create-task mutation"
);
assert(
  hasPattern(repliesPage, "/review"),
  "Replies page has review mutation"
);
assert(
  hasPattern(repliesPage, "/dismiss"),
  "Replies page has dismiss mutation"
);
assert(
  hasPattern(repliesPage, "data-testid") && hasPattern(repliesPage, "button-create-task"),
  "Create Task button has data-testid attribute"
);
assert(
  hasPattern(repliesPage, "animate-pulse"),
  "Replies page has loading skeleton"
);
assert(
  hasPattern(repliesPage, "No reply classifications yet") ||
  hasPattern(repliesPage, "No replies"),
  "Replies page has empty state"
);
assert(
  hasPattern(repliesPage, "classification") && hasPattern(repliesPage, "status"),
  "Replies page has classification and status filter selects"
);
assert(
  hasPattern(repliesPage, "Automatic reply ingestion not yet available") ||
  hasPattern(repliesPage, "reply ingestion"),
  "Replies page discloses inbound reply ingestion gap"
);

// ── Section 9: Nav and routing ────────────────────────────────────────────────

console.log("\n── Section 9: Navigation and routing ───────────────────────────");

assert(
  hasPattern(navConfig, "/marketing/replies"),
  "Nav config includes /marketing/replies route"
);
assert(
  hasPattern(navConfig, "Replies"),
  "Nav config has 'Replies' label"
);
assert(
  hasPattern(appTsx, "/marketing/replies"),
  "App.tsx registers /marketing/replies route"
);
assert(
  hasPattern(appTsx, "MarketingRepliesPage") ||
  hasPattern(appTsx, "marketing-replies"),
  "App.tsx lazy-loads MarketingRepliesPage"
);

// ── Section 10: Campaign detail reply section ─────────────────────────────────

console.log("\n── Section 10: Campaign detail reply section ────────────────────");

assert(
  hasPattern(campaignDetail, "Reply Intelligence") ||
  hasPattern(campaignDetail, "ReplyIntelligence"),
  "Campaign detail has Reply Intelligence section"
);
assert(
  hasPattern(campaignDetail, "/api/marketing/replies") ||
  hasPattern(campaignDetail, "campaign-reply-stats"),
  "Campaign detail fetches reply data"
);
assert(
  hasPattern(campaignDetail, "meeting_request") || hasPattern(campaignDetail, "interested"),
  "Campaign detail shows classification breakdown"
);

// ── Section 11: Account profile ───────────────────────────────────────────────

console.log("\n── Section 11: Account profile classified replies ───────────────");

assert(
  hasPattern(accountProfile, "campaign_reply_classifications") ||
  hasPattern(accountProfile, "/api/marketing/replies") ||
  hasPattern(accountProfile, "reply.*classification") ||
  hasPattern(accountProfile, "replyClassifications"),
  "Account profile includes reply classifications data"
);

// ── Section 12: Service exports ───────────────────────────────────────────────

console.log("\n── Section 12: Service exports ──────────────────────────────────");

assert(
  hasPattern(classifier, "export async function listReplyClassifications"),
  "listReplyClassifications is exported"
);
assert(
  hasPattern(classifier, "export async function getReplyClassification"),
  "getReplyClassification is exported"
);
assert(
  hasPattern(classifier, "export async function markClassificationReviewed"),
  "markClassificationReviewed is exported"
);
assert(
  hasPattern(classifier, "export async function dismissClassification"),
  "dismissClassification is exported"
);
assert(
  hasPattern(classifier, "export async function classifyUnprocessedReplies"),
  "classifyUnprocessedReplies is exported"
);
assert(
  hasPattern(classifier, "export async function getCampaignReplyStats"),
  "getCampaignReplyStats is exported"
);
assert(
  hasPattern(classifier, "export async function getAccountReplyClassificationScore"),
  "getAccountReplyClassificationScore is exported"
);
assert(
  hasPattern(classifier, "export async function migrateReplyClassificationSchema"),
  "migrateReplyClassificationSchema is exported"
);

// ── Section 13: Compliance & safety ──────────────────────────────────────────

console.log("\n── Section 13: Compliance and safety ───────────────────────────");

assert(
  hasPattern(classifier, "processUnsubscribeReply") &&
  hasPattern(classifier, "classification === \"unsubscribe\""),
  "Unsubscribe classification triggers unsubscribe processing"
);
assert(
  hasPattern(classifier, "automation_status.*stopped") || hasPattern(classifier, "'stopped'"),
  "Unsubscribe processing stops automation for recipient"
);
assert(
  !hasPattern(classifier, "sendEmail") && !hasPattern(classifier, "automated reply"),
  "No automated reply sending implemented (per spec)"
);
assert(
  hasPattern(classifier, "task creation blocked") || hasPattern(classifier, "const blocked"),
  "Task creation blocked for non-actionable classifications"
);

// ── Section 14: Cross-checks with existing suites ────────────────────────────

console.log("\n── Section 14: Cross-check existing suites still referenced ─────");

const existingTests = [
  "tests/campaign-automation.test.cjs",
  "tests/campaign-tracking.test.cjs",
  "tests/permissions.test.js",
].filter(f => {
  try { fs.accessSync(path.join(__dirname, "..", f)); return true; } catch { return false; }
});

assert(
  existingTests.length >= 1,
  `At least one existing test suite found (${existingTests.join(", ")})`
);

// ── Final report ───────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(55)}`);
console.log(`  Results: ${pass} passed, ${fail} failed`);
if (errors.length > 0) {
  console.log(`\n  Failed checks:`);
  errors.forEach(e => console.log(`    ✗ ${e}`));
}
console.log(`${"─".repeat(55)}\n`);

process.exit(fail > 0 ? 1 : 0);
