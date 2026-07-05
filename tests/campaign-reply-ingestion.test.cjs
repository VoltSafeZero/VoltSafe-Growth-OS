/**
 * Phase 8: Campaign Reply Ingestion — Source-grep test suite
 * Tests structural invariants of the ingestion service, routes, and frontend.
 */
"use strict";

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failures.push(message);
    failed++;
  }
}

function hasPattern(content, pattern) {
  if (typeof pattern === "string") return content.includes(pattern);
  return pattern.test(content);
}

function load(filePath) {
  try {
    return fs.readFileSync(path.resolve(filePath), "utf8");
  } catch {
    return "";
  }
}

const ingestion = load("server/services/campaign-reply-ingestion.ts");
const sender    = load("server/services/campaign-sender.ts");
const incr      = load("server/services/gmail-incremental.ts");
const parser    = load("server/services/email-parser.ts");
const classifier = load("server/services/campaign-reply-classifier.ts");
const routes    = load("server/routes.ts");
const index     = load("server/index.ts");
const repliesPage = load("client/src/pages/marketing-replies.tsx");
const navConfig = load("client/src/lib/nav-config.ts");
const appTsx    = load("client/src/App.tsx");

// ── Section 1: Migration ──────────────────────────────────────────────────────

console.log("\n── Section 1: Migration ─────────────────────────────────────────────");

assert(hasPattern(ingestion, "migrateReplyIngestionSchema"), "migrateReplyIngestionSchema exported");
assert(hasPattern(ingestion, "campaign_sent_messages"), "campaign_sent_messages table created");
assert(hasPattern(ingestion, "campaign_unmatched_replies"), "campaign_unmatched_replies table created");
assert(hasPattern(ingestion, "provider_message_id"), "provider_message_id column exists in campaign_sent_messages");
assert(hasPattern(ingestion, "provider_thread_id"), "provider_thread_id column exists in campaign_sent_messages");
assert(hasPattern(ingestion, "recipient_email"), "recipient_email column exists");
assert(hasPattern(ingestion, "in_reply_to"), "in_reply_to column added to email_messages via migration");
assert(hasPattern(ingestion, "ingestion_source"), "ingestion_source column added to campaign_reply_classifications");
assert(hasPattern(ingestion, "idx_csm_provider_message_id"), "index on campaign_sent_messages.provider_message_id");
assert(hasPattern(ingestion, "idx_csm_provider_thread_id"), "index on campaign_sent_messages.provider_thread_id");
assert(hasPattern(ingestion, "idx_cur_provider_message_id"), "unique index on campaign_unmatched_replies.provider_message_id");
assert(hasPattern(index, "migrateReplyIngestionSchema"), "server/index.ts calls migrateReplyIngestionSchema");
assert(hasPattern(index, "campaign-reply-ingestion"), "server/index.ts imports campaign-reply-ingestion");

// ── Section 2: campaign_sent_messages ─────────────────────────────────────────

console.log("\n── Section 2: campaign_sent_messages storage ───────────────────────");

assert(hasPattern(ingestion, "storeSentCampaignMessage"), "storeSentCampaignMessage function exported");
assert(hasPattern(ingestion, "campaign_id"), "campaign_id stored in campaign_sent_messages");
assert(hasPattern(ingestion, "campaign_recipient_id"), "campaign_recipient_id stored");
assert(hasPattern(ingestion, "ON CONFLICT DO NOTHING"), "storeSentCampaignMessage is idempotent (ON CONFLICT DO NOTHING)");
assert(hasPattern(sender, "storeSentCampaignMessage"), "campaign-sender calls storeSentCampaignMessage");
assert(hasPattern(sender, "providerMessageId"), "campaign-sender captures providerMessageId from sendEmail");
assert(hasPattern(sender, "providerThreadId"), "campaign-sender captures providerThreadId from sendEmail");
assert(hasPattern(sender, "gmailResult"), "campaign-sender captures Gmail API result");
assert(hasPattern(sender, "campaign-reply-ingestion"), "campaign-sender imports from campaign-reply-ingestion");

// ── Section 3: Matching strategy ─────────────────────────────────────────────

console.log("\n── Section 3: Matching strategy ─────────────────────────────────────");

assert(hasPattern(ingestion, "matchInboundReplyToCampaignRecipient"), "matchInboundReplyToCampaignRecipient exported");
assert(hasPattern(ingestion, "Priority 1"), "Priority 1 matching documented");
assert(hasPattern(ingestion, "Priority 2"), "Priority 2 matching documented");
assert(hasPattern(ingestion, "Priority 3"), "Priority 3 matching documented");
assert(hasPattern(ingestion, "Priority 4"), "Priority 4 (subject fallback) documented");
assert(hasPattern(ingestion, "thread_id"), "thread_id match method present");
assert(hasPattern(ingestion, "in_reply_to"), "in_reply_to match method present");
assert(hasPattern(ingestion, "references"), "references match method present");
assert(hasPattern(ingestion, "subject_fallback"), "subject_fallback match method present");
assert(hasPattern(ingestion, "LIMIT 2"), "ambiguous subject-match query fetches 2 to detect ambiguity");
assert(hasPattern(ingestion, "rows.length === 1"), "subject fallback only matches when exactly 1 candidate found");
assert(hasPattern(ingestion, "30 days"), "subject fallback limited to 30-day window");
assert(hasPattern(ingestion, /matched: false.*reason|reason.*No matching/s), "returns matched: false when no match found");

// ── Section 4: processInboundEmailForCampaignReply ─────────────────────────────

console.log("\n── Section 4: processInboundEmailForCampaignReply ───────────────────");

assert(hasPattern(ingestion, "processInboundEmailForCampaignReply"), "processInboundEmailForCampaignReply exported");
assert(hasPattern(ingestion, "voltsafe.com"), "skips emails from @voltsafe.com (outbound guard)");
assert(hasPattern(ingestion, "voltsafe.test"), "skips emails from @voltsafe.test (dev domain guard)");
assert(hasPattern(ingestion, "status: \"skipped\""), "returns skipped for internal domains");
assert(hasPattern(ingestion, "status: \"duplicate\""), "returns duplicate for already-processed messages");
assert(hasPattern(ingestion, "source_message_id"), "dedup check uses source_message_id (providerMessageId)");
assert(hasPattern(ingestion, "event_type") && hasPattern(ingestion, "'replied'"), "creates replied campaign_event on match");
assert(hasPattern(ingestion, "replied_at"), "updates replied_at on campaign_recipients");
assert(hasPattern(ingestion, "classifyCampaignReply"), "calls classifyCampaignReply on match");
assert(hasPattern(ingestion, "ingestionSource") && hasPattern(ingestion, "inbound_ingested"), "passes ingestionSource=inbound_ingested to classifier");
assert(hasPattern(ingestion, "storeUnmatchedReply"), "stores unmatched replies in queue");
assert(hasPattern(ingestion, "status: \"unmatched\""), "returns unmatched for non-matching inbound emails");
assert(hasPattern(ingestion, "status: \"matched\""), "returns matched on success");
assert(hasPattern(ingestion, "AUTO_TASK_CLASSIFICATIONS"), "auto-task set defined");
assert(hasPattern(ingestion, "meeting_request"), "meeting_request triggers auto-task");
assert(hasPattern(ingestion, "interested"), "interested triggers auto-task");
assert(!hasPattern(ingestion, "unsubscribe.*AUTO_TASK|AUTO_TASK.*unsubscribe"), "unsubscribe NOT in auto-task set");

// ── Section 5: Unmatched queue ────────────────────────────────────────────────

console.log("\n── Section 5: Unmatched queue ───────────────────────────────────────");

assert(hasPattern(ingestion, "storeUnmatchedReply"), "storeUnmatchedReply function exists");
assert(hasPattern(ingestion, "match_attempts"), "match_attempts tracked on unmatched replies");
assert(hasPattern(ingestion, "getUnmatchedReplies"), "getUnmatchedReplies exported");
assert(hasPattern(ingestion, "processUnmatchedCampaignReplies"), "processUnmatchedCampaignReplies exported");
assert(hasPattern(ingestion, "match_attempts < 5"), "retry loop stops after 5 attempts");
assert(hasPattern(ingestion, "ON CONFLICT"), "storeUnmatchedReply is idempotent on provider_message_id");
assert(hasPattern(ingestion, "status = 'matched'"), "updates status to matched when retry succeeds");

// ── Section 6: scanRecentInboundReplies ───────────────────────────────────────

console.log("\n── Section 6: scanRecentInboundReplies ──────────────────────────────");

assert(hasPattern(ingestion, "scanRecentInboundReplies"), "scanRecentInboundReplies exported");
assert(hasPattern(ingestion, "direction = 'inbound'"), "scans only inbound messages");
assert(hasPattern(ingestion, "is_reply = TRUE"), "scans only reply messages");
assert(hasPattern(ingestion, "NOT EXISTS"), "skips already-processed messages (NOT EXISTS check)");
assert(hasPattern(ingestion, "hoursBack"), "configurable time window");
assert(hasPattern(ingestion, "gmail_message_id"), "uses gmailMessageId as providerMessageId");
assert(hasPattern(ingestion, "gmail_thread_id"), "uses gmailThreadId as providerThreadId");

// ── Section 7: Gmail incremental hook ─────────────────────────────────────────

console.log("\n── Section 7: Gmail incremental hook ─────────────────────────────────");

assert(hasPattern(incr, "campaign-reply-ingestion"), "gmail-incremental imports campaign-reply-ingestion");
assert(hasPattern(incr, "processInboundEmailForCampaignReply"), "gmail-incremental calls processInboundEmailForCampaignReply");
assert(hasPattern(incr, "direction") && hasPattern(incr, "inbound") && hasPattern(incr, "isReply"), "hook is guarded to inbound + isReply only");
assert(hasPattern(incr, "fire-and-forget"), "hook is fire-and-forget (non-blocking)");
assert(hasPattern(incr, "in_reply_to"), "gmail-incremental stores in_reply_to header");

// ── Section 8: email-parser ───────────────────────────────────────────────────

console.log("\n── Section 8: email-parser ──────────────────────────────────────────");

assert(hasPattern(parser, "inReplyTo: string | null"), "ParsedEmail interface includes inReplyTo");
assert(hasPattern(parser, "inReplyTo: inReplyTo || null"), "parseGmailMessage returns inReplyTo");
assert(hasPattern(parser, "References"), "email-parser extracts References header");

// ── Section 9: classifier ingestionSource ─────────────────────────────────────

console.log("\n── Section 9: Classifier ingestionSource ─────────────────────────────");

assert(hasPattern(classifier, "ingestionSource"), "ClassifyInput includes ingestionSource field");
assert(hasPattern(classifier, "ingestion_source"), "classifier INSERT includes ingestion_source column");
assert(hasPattern(classifier, "inbound_ingested"), "classifier stores inbound_ingested as ingestion_source");

// ── Section 10: API routes ────────────────────────────────────────────────────

console.log("\n── Section 10: API routes ───────────────────────────────────────────");

assert(hasPattern(routes, "/api/marketing/replies/ingest"), "POST /api/marketing/replies/ingest route exists");
assert(hasPattern(routes, "requireAdmin"), "ingest route uses requireAdmin guard");
assert(hasPattern(routes, "/api/marketing/unmatched-replies"), "GET /api/marketing/unmatched-replies route exists");
assert(hasPattern(routes, "unmatched-replies/:id/ignore"), "POST ignore route exists");
assert(hasPattern(routes, "/api/marketing/replies/scan-recent"), "POST scan-recent admin route exists");
assert(hasPattern(routes, "retry-unmatched"), "POST retry-unmatched admin route exists");
assert(hasPattern(routes, "processInboundEmailForCampaignReply"), "routes imports processInboundEmailForCampaignReply");
assert(hasPattern(routes, "getUnmatchedReplies"), "routes imports getUnmatchedReplies");
assert(hasPattern(routes, "scanRecentInboundReplies"), "routes imports scanRecentInboundReplies");

// ── Section 11: Frontend ──────────────────────────────────────────────────────

console.log("\n── Section 11: Frontend ─────────────────────────────────────────────");

assert(hasPattern(repliesPage, "UnmatchedRepliesTab"), "UnmatchedRepliesTab component exists");
assert(hasPattern(repliesPage, "MatchedRepliesTab"), "MatchedRepliesTab component exists");
assert(hasPattern(repliesPage, '"tab-matched"'), "matched tab has testid");
assert(hasPattern(repliesPage, '"tab-unmatched"'), "unmatched tab has testid");
assert(hasPattern(repliesPage, "SourcePill"), "SourcePill component for source indicator");
assert(hasPattern(repliesPage, "inbound_ingested"), "Auto-ingested source label present");
assert(hasPattern(repliesPage, "Auto-ingested"), "Human-readable auto-ingested label");
assert(hasPattern(repliesPage, "/api/marketing/unmatched-replies"), "unmatched replies API query in frontend");
assert(hasPattern(repliesPage, "unmatched-row-"), "unmatched row testid present");
assert(hasPattern(repliesPage, "button-ignore-unmatched-"), "ignore unmatched button testid present");
assert(hasPattern(repliesPage, "Automatic reply ingestion active"), "updated ingestion status notice");
assert(!hasPattern(repliesPage, "Automatic reply ingestion not yet available"), "old gap notice removed");

// ── Section 12: Safety / compliance ──────────────────────────────────────────

console.log("\n── Section 12: Safety / compliance ──────────────────────────────────");

assert(hasPattern(ingestion, "Do NOT implement automated reply sending"), "no-auto-send spec documented");
assert(hasPattern(ingestion, "voltsafe.com"), "outbound domain guard present");
assert(hasPattern(ingestion, "fail-conservative"), "conservative matching documented");
assert(!hasPattern(ingestion, "unsubscribe.*AUTO_TASK|AUTO_TASK.*unsubscribe"), "unsubscribe blocked from auto-task");
assert(hasPattern(ingestion, /preview.*300|300.*preview|slice.*300/), "body preview truncated to 300 chars max");

// ── Section 13: Cross-suite regression ────────────────────────────────────────

console.log("\n── Section 13: Cross-suite regression ──────────────────────────────");

const phase7Test = load("tests/campaign-reply-classifier.test.cjs");
const automationTest = load("tests/campaign-automation.test.cjs");
const trackingTest = load("tests/campaign-tracking.test.cjs");
const permissionsTest = load("tests/permissions.test.js");

assert(phase7Test.length > 0, "Phase 7 classifier tests still exist");
assert(automationTest.length > 0, "Campaign automation tests still exist");
assert(trackingTest.length > 0, "Campaign tracking tests still exist");
assert(permissionsTest.length > 0, "Permissions tests still exist");

// ── Summary ───────────────────────────────────────────────────────────────────

console.log("\n───────────────────────────────────────────────────────");
console.log(`  Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log("\n  Failed checks:");
  failures.forEach(f => console.log(`    ✗ ${f}`));
}
console.log("───────────────────────────────────────────────────────");

if (failed > 0) process.exit(1);
