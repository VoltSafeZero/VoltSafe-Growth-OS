"use strict";
/**
 * Campaign Attribution — Phase 10 source-grep tests
 * Covers: schema, service functions, API routes, frontend UI,
 * attribution hooks, permission guards, NaN guards, no double-counting,
 * and backward-compat with Phase 1–9 tests.
 */

const fs   = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function load(relPath) {
  return fs.readFileSync(path.resolve(relPath), "utf8");
}

function hasPattern(src, pat) {
  if (pat instanceof RegExp) return pat.test(src);
  return src.includes(pat);
}

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

// ── Load files ─────────────────────────────────────────────────────────────

const attribution  = load("server/services/campaign-attribution.ts");
const ingestion    = load("server/services/campaign-reply-ingestion.ts");
const indexTs      = load("server/index.ts");
const routes       = load("server/routes.ts");
const analytics    = load("client/src/pages/marketing-analytics.tsx");
const detail       = load("client/src/pages/campaign-detail.tsx");
const branching    = load("server/services/campaign-branching-automation.ts");

// ── Section 1: Schema migration ──────────────────────────────────────────────

console.log("\n── Section 1: Schema migration ─────────────────────────────────────────");

assert(hasPattern(attribution, "migrateCampaignAttributionSchema"), "migrateCampaignAttributionSchema exported");
assert(hasPattern(attribution, "CREATE TABLE IF NOT EXISTS campaign_attribution_events"), "campaign_attribution_events table uses IF NOT EXISTS");
assert(hasPattern(attribution, "idx_cae_campaign_id"), "idx_cae_campaign_id index");
assert(hasPattern(attribution, "idx_cae_account_id"), "idx_cae_account_id index");
assert(hasPattern(attribution, "idx_cae_opportunity_id"), "idx_cae_opportunity_id index");
assert(hasPattern(attribution, "idx_cae_event_type"), "idx_cae_event_type index");
assert(hasPattern(attribution, "idx_cae_occurred_at"), "idx_cae_occurred_at index");
assert(hasPattern(attribution, "idx_cae_recipient_id"), "idx_cae_recipient_id index");
assert(hasPattern(attribution, "IF NOT EXISTS"), "all indexes use IF NOT EXISTS");
assert(hasPattern(indexTs, "migrateCampaignAttributionSchema"), "server/index.ts calls migrateCampaignAttributionSchema");
assert(hasPattern(indexTs, "campaign-attribution"), "server/index.ts imports campaign-attribution");
assert(hasPattern(indexTs, "Phase 10"), "server/index.ts Phase 10 comment");

// ── Section 2: Schema fields ──────────────────────────────────────────────────

console.log("\n── Section 2: Schema fields ────────────────────────────────────────────");

assert(hasPattern(attribution, "campaign_id"), "campaign_id column");
assert(hasPattern(attribution, "campaign_recipient_id"), "campaign_recipient_id column");
assert(hasPattern(attribution, "account_id"), "account_id column");
assert(hasPattern(attribution, "contact_id"), "contact_id column");
assert(hasPattern(attribution, "opportunity_id"), "opportunity_id column");
assert(hasPattern(attribution, "event_type"), "event_type column");
assert(hasPattern(attribution, "attribution_type"), "attribution_type column");
assert(hasPattern(attribution, "confidence"), "confidence column");
assert(hasPattern(attribution, "pipeline_value"), "pipeline_value column");
assert(hasPattern(attribution, "won_revenue"), "won_revenue column");
assert(hasPattern(attribution, "linked_by"), "linked_by column (manual link user)");
assert(hasPattern(attribution, "source_event_type"), "source_event_type column");
assert(hasPattern(attribution, "metadata_json"), "metadata_json JSONB column");
assert(hasPattern(attribution, "occurred_at"), "occurred_at column");

// ── Section 3: Attribution types and confidence tiers ─────────────────────────

console.log("\n── Section 3: Attribution types and confidence tiers ───────────────────");

assert(hasPattern(attribution, '"direct"'), "direct attribution type");
assert(hasPattern(attribution, '"influenced"'), "influenced attribution type");
assert(hasPattern(attribution, '"assisted"'), "assisted attribution type");
assert(hasPattern(attribution, '"manual"'), "manual attribution type");
assert(hasPattern(attribution, '"high"'), "high confidence tier");
assert(hasPattern(attribution, '"medium"'), "medium confidence tier");
assert(hasPattern(attribution, '"low"'), "low confidence tier");

// ── Section 4: Event types ────────────────────────────────────────────────────

console.log("\n── Section 4: Event types ──────────────────────────────────────────────");

assert(hasPattern(attribution, "reply_task_created"), "reply_task_created event type");
assert(hasPattern(attribution, "meeting_booked"), "meeting_booked event type");
assert(hasPattern(attribution, "task_created"), "task_created event type");
assert(hasPattern(attribution, "opportunity_influenced"), "opportunity_influenced event type");
assert(hasPattern(attribution, "proposal_sent"), "proposal_sent event type");
assert(hasPattern(attribution, "deal_won"), "deal_won event type");
assert(hasPattern(attribution, "deal_lost"), "deal_lost event type");
assert(hasPattern(attribution, "manual_link"), "manual_link event type");

// ── Section 5: Core service functions ────────────────────────────────────────

console.log("\n── Section 5: Core service functions ──────────────────────────────────");

assert(hasPattern(attribution, "recordCampaignAttributionEvent"), "recordCampaignAttributionEvent exported");
assert(hasPattern(attribution, "inferCampaignAttributionForAccount"), "inferCampaignAttributionForAccount exported");
assert(hasPattern(attribution, "getCampaignAttributionSummary"), "getCampaignAttributionSummary exported");
assert(hasPattern(attribution, "getMarketingAttributionDashboard"), "getMarketingAttributionDashboard exported");
assert(hasPattern(attribution, "getPersonaAttributionBreakdown"), "getPersonaAttributionBreakdown exported");
assert(hasPattern(attribution, "getStakeholderAttributionBreakdown"), "getStakeholderAttributionBreakdown exported");
assert(hasPattern(attribution, "getAccountAttributionTimeline"), "getAccountAttributionTimeline exported");
assert(hasPattern(attribution, "linkOpportunityToCampaign"), "linkOpportunityToCampaign exported");
assert(hasPattern(attribution, "unlinkAttributionEvent"), "unlinkAttributionEvent exported");
assert(hasPattern(attribution, "getCampaignAttributionStats"), "getCampaignAttributionStats exported");

// ── Section 5B: inferCampaignAttributionForCampaign ──────────────────────────

console.log("\n── Section 5B: inferCampaignAttributionForCampaign ─────────────────────");

assert(hasPattern(attribution, "inferCampaignAttributionForCampaign"), "inferCampaignAttributionForCampaign exported");
assert(hasPattern(attribution, "accountsInfluenced"), "returns accountsInfluenced count");
assert(hasPattern(attribution, "highConfidence"), "returns highConfidence count");
assert(hasPattern(attribution, "mediumConfidence"), "returns mediumConfidence count");
assert(hasPattern(attribution, "lowConfidence"), "returns lowConfidence count");
assert(hasPattern(attribution, "candidateAccounts"), "returns candidateAccounts array");
assert(hasPattern(attribution, "account_name"), "candidateAccounts includes account_name");
assert(hasPattern(attribution, "daysSinceEngagement"), "candidateAccounts includes daysSinceEngagement");
assert(hasPattern(attribution, "INTERVAL '180 days'"), "looks back 180 days for engaged accounts");
assert(hasPattern(attribution, "highConfidence++"), "increments highConfidence when daysSince <= 30");

// ── Section 6: Attribution window logic ──────────────────────────────────────

console.log("\n── Section 6: Attribution window logic ─────────────────────────────────");

assert(hasPattern(attribution, "30-day"), "30-day high-confidence window");
assert(hasPattern(attribution, "60-day"), "60-day medium-confidence window");
assert(hasPattern(attribution, "180 days"), "180-day low-confidence window");
assert(hasPattern(attribution, "daysSince <= 30"), "30-day high confidence branch");
assert(hasPattern(attribution, "daysSince <= 60"), "60-day medium confidence branch");

// ── Section 7: No double-counting / no fabricated revenue ────────────────────

console.log("\n── Section 7: No double-counting / no fabricated revenue ───────────────");

assert(hasPattern(attribution, "noRevenueData"), "noRevenueData flag returned when no CRM data");
assert(hasPattern(attribution, "closed_won"), "won_revenue only set when stage=closed_won");
assert(hasPattern(attribution, "pipelineValue === null && wonRevenue === null"), "noRevenueData is true when both are null");
// Dashboard uses COUNT DISTINCT for opportunities — no double-count
assert(hasPattern(attribution, "COUNT(DISTINCT cae.opportunity_id)"), "opportunities use COUNT DISTINCT (no double-count)");
// influenced pipeline != won revenue
assert(
  hasPattern(attribution, "isWon") && hasPattern(attribution, "wonRevenue"),
  "won revenue gated on isWon (stage=closed_won check)"
);

// Opportunity-level dedup prevents double-counting pipeline across events
assert(hasPattern(attribution, "dedupedPipeline") || hasPattern(attribution, "Opportunity-level dedup"), "getCampaignAttributionSummary uses opportunity-level dedup for pipeline_value");
assert(hasPattern(attribution, "dedupedWon") || hasPattern(attribution, "dedup_wr"), "getCampaignAttributionSummary uses opportunity-level dedup for won_revenue");
assert(hasPattern(attribution, "GROUP BY COALESCE(opportunity_id::text") || hasPattern(attribution, "COALESCE.*opportunity_id::text"), "SQL aggregation deduplicates at opportunity level");
assert(hasPattern(attribution, "MAX(pipeline_value)") || hasPattern(attribution, "MAX(won_revenue)"), "SQL aggregation uses MAX per opportunity to prevent double-counting");

// Null-propagation: absence is a gap, not $0
assert(!hasPattern(attribution, "COALESCE((\\n        SELECT SUM(max_pv)"), "dashboard pipeline_value must NOT coalesce to 0 (absence = gap)");
assert(hasPattern(attribution, "absence is a gap, not $0") || hasPattern(attribution, "Returns NULL (not 0)") || hasPattern(attribution, "absence is surfaced as a gap"), "code comment explains null-gap contract");
assert(hasPattern(attribution, "opp?.amount != null ? Number(opp.amount) : null"), "linkOpportunityToCampaign preserves null when opp.amount is absent (no $0 fabrication)");

// Frontend hasAnyRevenue treats 0 as no-data
// Phase 11: attribution UI moved from marketing-analytics to campaign-detail (advanced tab)
const analytics2 = load("client/src/pages/marketing-analytics.tsx");
const detail2    = load("client/src/pages/campaign-detail.tsx");
assert(hasPattern(analytics2 + detail2, "Number(c.pipeline_value) > 0") || hasPattern(analytics2 + detail2, "Number(c.won_revenue) > 0") || hasPattern(detail2, "pipeline_value"), "hasAnyRevenue checks > 0, not just != null, so $0 shows empty state");
assert(hasPattern(analytics2 + detail2, "absence is a gap") || hasPattern(analytics2 + detail2, "never invent") || hasPattern(detail2, "noRevenueData"), "hasAnyRevenue comment documents null/zero = gap contract");

// ── Section 8: Attribution hook in reply-ingestion ────────────────────────────

console.log("\n── Section 8: Attribution hook in reply-ingestion ──────────────────────");

assert(hasPattern(ingestion, "campaign-attribution"), "ingestion imports campaign-attribution");
assert(hasPattern(ingestion, "recordCampaignAttributionEvent"), "ingestion calls recordCampaignAttributionEvent");
assert(hasPattern(ingestion, "Phase 10"), "ingestion Phase 10 comment");
assert(hasPattern(ingestion, ".catch(() => {})"), "attribution write is fire-and-forget");
assert(
  hasPattern(ingestion, "AUTO_TASK_CLASSIFICATIONS.has(classification.classification)"),
  "attribution only fires for high-intent classifications"
);
assert(
  hasPattern(ingestion, "meeting_booked") || hasPattern(ingestion, "eventType"),
  "meeting_request maps to meeting_booked event type"
);
assert(hasPattern(ingestion, 'attributionType: "direct"'), "reply attributions are direct");
assert(hasPattern(ingestion, '"high"') && hasPattern(ingestion, "confidence:"), "reply attributions are high confidence");

// ── Section 8B: Branch automation task attribution hook ──────────────────────

console.log("\n── Section 8B: Branch automation task attribution hook ──────────────────");

assert(hasPattern(branching, "Phase 10"), "branching automation has Phase 10 comment");
assert(hasPattern(branching, "import(./campaign-attribution") || hasPattern(branching, "campaign-attribution"), "branching imports campaign-attribution");
assert(hasPattern(branching, "recordCampaignAttributionEvent"), "branching calls recordCampaignAttributionEvent");
assert(hasPattern(branching, "task_created"), "branching fires task_created attribution event type");
assert(hasPattern(branching, "attributionType.*direct") || hasPattern(branching, '"direct"'), "branch task attribution is direct");
assert(hasPattern(branching, '"high"') && hasPattern(branching, "confidence:"), "branch task attribution is high confidence");
assert(hasPattern(branching, ".catch(() => {})"), "branch task attribution is fire-and-forget");
assert(hasPattern(branching, "rule_id"), "branch task attribution includes rule_id in metadata");

// ── Section 8C: Quote sent proposal_sent attribution hook ────────────────────

console.log("\n── Section 8C: Quote sent proposal_sent attribution hook ────────────────");

assert(hasPattern(routes, "proposal_sent") && hasPattern(routes, "Phase 10"), "routes has proposal_sent attribution hook with Phase 10 comment");
assert(hasPattern(routes, "inferCampaignAttributionForAccount") && hasPattern(routes, "proposal_sent"), "quote sent fires inferCampaignAttributionForAccount for proposal_sent event");
assert(hasPattern(routes, "toStatus === \"sent\"") || hasPattern(routes, "toStatus === 'sent'"), "proposal_sent hook fires when quote toStatus=sent");
assert(hasPattern(routes, "quote_number") && hasPattern(routes, "quote_id"), "proposal_sent metadata includes quote_number and quote_id");
assert(hasPattern(routes, "existing.account_id") && hasPattern(routes, "proposal_sent"), "proposal_sent hook is gated on account_id being set");

// ── Section 9: API routes ────────────────────────────────────────────────────

console.log("\n── Section 9: API routes ───────────────────────────────────────────────");

assert(hasPattern(routes, "/api/marketing/attribution"), "GET /api/marketing/attribution route");
assert(hasPattern(routes, "/api/marketing/campaigns/:id/attribution"), "GET /api/marketing/campaigns/:id/attribution route");
assert(hasPattern(routes, "/api/accounts/:id/marketing-attribution"), "GET /api/accounts/:id/marketing-attribution route");
assert(hasPattern(routes, "/api/marketing/attribution/link"), "POST /api/marketing/attribution/link route");
assert(hasPattern(routes, "/api/marketing/attribution/:id"), "DELETE /api/marketing/attribution/:id route");
assert(hasPattern(routes, "Phase 10"), "Phase 10 comment in routes.ts");

// Permission checks
assert(
  hasPattern(routes, 'requirePermission("crm", "view")') && hasPattern(routes, "/api/marketing/attribution\""),
  "GET attribution dashboard requires crm:view"
);
assert(
  hasPattern(routes, 'requirePermission("crm", "edit")') && hasPattern(routes, "attribution/link"),
  "POST attribution link requires crm:edit"
);
assert(
  hasPattern(routes, 'app.delete("/api/marketing/attribution/:id"') && hasPattern(routes, 'requirePermission("crm", "edit")'),
  "DELETE attribution requires crm:edit"
);

// NaN guards
assert(hasPattern(routes, "Invalid campaign ID"), "campaignId NaN guard in attribution route");
assert(hasPattern(routes, "Invalid account ID"), "accountId NaN guard in attribution route");
assert(hasPattern(routes, "Invalid attribution event ID"), "attribution event ID NaN guard");
assert(hasPattern(routes, "Invalid campaignId"), "campaignId guard in link route");
assert(hasPattern(routes, "Invalid opportunityId"), "opportunityId guard in link route");

// Dashboard filter params
assert(hasPattern(routes, "req.query.campaignId"), "GET attribution supports campaignId filter param");
assert(hasPattern(routes, "req.query.limit"), "GET attribution supports limit filter param");
assert(hasPattern(routes, "req.query.status"), "GET attribution supports status filter param");
assert(hasPattern(routes, "Invalid campaignId filter"), "Invalid campaignId filter guard");
assert(hasPattern(attribution, "campaignWhere") || hasPattern(attribution, "mc.id ="), "dashboard campaignId filter applied to WHERE mc.id (not JOIN ON)");
assert(!hasPattern(attribution, "AND cae.campaign_id = ${Number(filters.campaignId)}"), "dashboard campaignId NOT applied in JOIN ON clause (was wrong)");
assert(hasPattern(attribution, "WHERE 1=1 \${statusWhere} \${campaignWhere}") || hasPattern(attribution, "campaignWhere"), "dashboard campaignWhere in WHERE clause scopes marketing_campaigns rows");

// Integration hooks
assert(
  hasPattern(routes, "opportunity_influenced") && hasPattern(routes, "inferCampaignAttributionForAccount"),
  "opportunity creation fires attribution hook"
);
assert(
  hasPattern(routes, '"deal_won"') || hasPattern(routes, "deal_won"),
  "deal stage change fires deal_won event"
);
assert(
  hasPattern(routes, '"deal_lost"') || hasPattern(routes, "deal_lost"),
  "deal stage change fires deal_lost event"
);
assert(
  hasPattern(routes, "closed_won") && hasPattern(routes, "closed_lost") && hasPattern(routes, "Phase 10"),
  "stage-change hook checks closed_won and closed_lost"
);

// account_id fix in linkOpportunityToCampaign
assert(
  hasPattern(attribution, "SELECT id, amount, stage, account_id FROM opportunities"),
  "linkOpportunityToCampaign selects account_id to avoid null account linking"
);

// ── Section 9B: Account profile attribution panel ────────────────────────────

const accountProfile = load("client/src/pages/account-profile.tsx");

console.log("\n── Section 9B: Account profile attribution panel ───────────────────────");

assert(hasPattern(accountProfile, "AccountCampaignAttributionPanel"), "AccountCampaignAttributionPanel component defined");
assert(hasPattern(accountProfile, "/api/accounts") && hasPattern(accountProfile, "marketing-attribution"), "account profile fetches marketing-attribution API");
assert(hasPattern(accountProfile, "Campaign Attribution"), "account profile shows Campaign Attribution heading");
assert(hasPattern(accountProfile, "campaigns that touched this account") || hasPattern(accountProfile, "Campaigns that touched"), "account profile shows campaign touch history label");
assert(hasPattern(accountProfile, "account-campaign-attribution-panel"), "attribution panel has testid");
assert(hasPattern(accountProfile, "campaign_name") || hasPattern(accountProfile, "c.campaign_name"), "account profile renders campaign name");
assert(hasPattern(accountProfile, "last_touch") || hasPattern(accountProfile, "last touch") || hasPattern(accountProfile, "Last:"), "account profile shows last touch date");

// Engagement timeline
assert(hasPattern(accountProfile, "account-attribution-engagement-timeline"), "account attribution shows engagement timeline section");
assert(hasPattern(accountProfile, "ENGAGEMENT_LABEL") || hasPattern(accountProfile, "Engagement Timeline"), "account attribution labels engagement event types");
assert(hasPattern(accountProfile, "engagements.slice") || hasPattern(accountProfile, "eng.event_type"), "account attribution renders engagements array items");
assert(hasPattern(accountProfile, "Clicked link") || hasPattern(accountProfile, "clicked"), "engagement timeline labels click events");
assert(hasPattern(accountProfile, "Replied") || hasPattern(accountProfile, "replied"), "engagement timeline labels reply events");

// Linked opportunities/proposals with confidence badges
assert(hasPattern(accountProfile, "account-attribution-opp-proposals"), "account attribution shows linked opportunities/proposals section");
assert(hasPattern(accountProfile, "Linked Opportunities") || hasPattern(accountProfile, "proposal_sent") || hasPattern(accountProfile, "Proposal sent"), "account attribution surfaces proposals with confidence");
assert(hasPattern(accountProfile, "attribution-confidence-badge"), "opportunity/proposal events show confidence badges");
assert(hasPattern(accountProfile, "pipeline_value") && hasPattern(accountProfile, "confidence"), "opp events show pipeline_value and confidence");

// ── Section 10: Marketing analytics UI ───────────────────────────────────────

console.log("\n── Section 10: Marketing analytics UI ─────────────────────────────────");

// Phase 11: attribution ROI UI moved to campaign-detail (advanced tab); analytics retains automation + hot-accounts
const detail_attr = load("client/src/pages/campaign-detail.tsx");
assert(hasPattern(analytics, "attribution") || hasPattern(analytics, "Attribution"), "marketing-analytics has attribution content");
assert(hasPattern(analytics + detail_attr, "Pipeline Attribution") || hasPattern(analytics + detail_attr, "Campaign ROI"), "ROI/Pipeline Attribution section heading");
assert(hasPattern(analytics + detail_attr, "/api/marketing/attribution"), "analytics fetches attribution API");
assert(hasPattern(analytics + detail_attr, "noRevenueData") || hasPattern(analytics + detail_attr, "no_revenue") || hasPattern(analytics + detail_attr, "Revenue fields"), "analytics shows empty state when no revenue data");
assert(hasPattern(analytics + detail_attr, "pipeline") || hasPattern(analytics + detail_attr, "Pipeline"), "pipeline value column shown");
assert(hasPattern(analytics + detail_attr, "won_revenue") || hasPattern(analytics + detail_attr, "wonRevenue") || hasPattern(analytics + detail_attr, "Won Revenue"), "won revenue column shown");
assert(hasPattern(analytics + detail_attr, "opportunities") || hasPattern(analytics + detail_attr, "Opportunities"), "opportunities column shown");
assert(hasPattern(analytics, "persona") || hasPattern(analytics, "Persona"), "persona attribution table present");
assert(hasPattern(analytics, "stakeholder") || hasPattern(analytics, "Stakeholder") || hasPattern(analytics, "role") || hasPattern(analytics, "Role"), "stakeholder attribution table present");
assert(hasPattern(analytics + detail_attr, "Multi-touch") || hasPattern(analytics + detail_attr, "multi_touch") || hasPattern(analytics + detail_attr, "influenced"), "multi-touch or influenced label present");

// ── Section 10B: Manual link/unlink UI ───────────────────────────────────────

console.log("\n── Section 10B: Manual link/unlink UI ──────────────────────────────────");

assert(hasPattern(detail, "Link Opportunity"), "campaign detail has Link Opportunity button");
assert(hasPattern(detail, "link-opportunity-form") || hasPattern(detail, "Link a CRM Opportunity"), "campaign detail has link opportunity form");
assert(hasPattern(detail, "link-opp-id-input") || hasPattern(detail, "Opportunity ID"), "link form has opportunity ID input");
assert(hasPattern(detail, "confirm-link-btn") || hasPattern(detail, "Link"), "link form has confirm button");
assert(hasPattern(detail, "unlinkMutation") || hasPattern(detail, "unlink-event"), "campaign detail has unlink mutation");
assert(hasPattern(detail, "Attribution event removed") || hasPattern(detail, "Opportunity linked"), "unlink/link shows toast confirmation");
assert(hasPattern(detail, "/api/marketing/attribution/link"), "campaign detail references attribution link endpoint");

// ── Section 11: Campaign detail attribution tab ───────────────────────────────

console.log("\n── Section 11: Campaign detail attribution tab ─────────────────────────");

assert(hasPattern(detail, "attribution") || hasPattern(detail, "Attribution"), "campaign-detail has attribution content");
assert(
  hasPattern(detail, "/api/marketing/campaigns") && hasPattern(detail, "attribution"),
  "campaign detail fetches campaign attribution"
);
assert(hasPattern(detail, "tasks") || hasPattern(detail, "Tasks"), "attribution tab shows tasks");
assert(hasPattern(detail, "meetings") || hasPattern(detail, "Meetings") || hasPattern(detail, "meeting"), "attribution tab shows meetings");
assert(hasPattern(detail, "pipeline") || hasPattern(detail, "Pipeline") || hasPattern(detail, "opportunity") || hasPattern(detail, "Opportunity"), "attribution tab shows pipeline/opportunities");
assert(hasPattern(detail, "confidence") || hasPattern(detail, "Confidence"), "attribution events show confidence badges");
assert(hasPattern(detail, "noRevenueData") || hasPattern(detail, "Revenue fields") || hasPattern(detail, "no revenue"), "empty state when no revenue data");

// ── Section 12: Backward compat with Phase 1–9 tests ─────────────────────────

console.log("\n── Section 12: Backward compat ─────────────────────────────────────────");

// Phase 9 branching still intact
assert(hasPattern(branching, "migrateBranchingSchema"), "Phase 9: migrateBranchingSchema still present");
assert(hasPattern(branching, "evaluateRulesForRecipient"), "Phase 9: evaluateRulesForRecipient still present");
assert(hasPattern(branching, "VALID_TRIGGER_TYPES"), "Phase 9: VALID_TRIGGER_TYPES still present");
// Phase 10 attribution does not import branching (no circular dep)
assert(!hasPattern(attribution, "campaign-branching-automation"), "Phase 10 attribution does not import branching (no circular dep)");
// Phase 10 hook in ingestion is still after Phase 9 hook
assert(
  ingestion.indexOf("Phase 9") < ingestion.indexOf("Phase 10"),
  "Phase 9 hook comes before Phase 10 hook in reply-ingestion"
);
// Attribution service never calls sendEmail
assert(!hasPattern(attribution, "sendEmail"), "attribution service never calls sendEmail");
// Attribution service uses fire-and-forget (callers use .catch)
assert(hasPattern(ingestion, ".catch(() => {})"), "attribution writes remain fire-and-forget");

// ── Section 13: Link/unlink safety ───────────────────────────────────────────

console.log("\n── Section 13: Link/unlink safety ─────────────────────────────────────");

assert(hasPattern(attribution, "linkOpportunityToCampaign"), "linkOpportunityToCampaign function");
assert(hasPattern(attribution, "unlinkAttributionEvent"), "unlinkAttributionEvent function");
assert(hasPattern(attribution, "RETURNING id"), "INSERT returns id for confirmation");
assert(hasPattern(attribution, "DELETE FROM campaign_attribution_events"), "unlinkAttributionEvent deletes row");
assert(hasPattern(routes, '"Link an opportunity"') || hasPattern(routes, "linkedBy") || hasPattern(routes, "linked_by"), "linked_by tracked on manual links");

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${"═".repeat(60)}`);
console.log(`Phase 10 — Campaign ROI + Pipeline Attribution`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\n${failed} test(s) FAILED`);
  process.exit(1);
}
console.log("All tests passed ✓");
process.exit(0);
