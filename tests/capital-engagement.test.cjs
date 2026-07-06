/**
 * Capital Investor Engagement Analytics — Phase 2I Source-Grep Tests
 *
 * Verifies: service functions, backend routes, security, frontend page,
 * nav wiring, App.tsx registration, command center extension, and
 * investor detail engagement panel.
 *
 * No live server required.
 */
"use strict";

const fs   = require("fs");
const path = require("path");

const ROUTES       = path.join(__dirname, "../server/routes-capital.ts");
const SERVICE      = path.join(__dirname, "../server/services/capital-engagement.ts");
const PAGE         = path.join(__dirname, "../client/src/pages/capital-engagement.tsx");
const APP_TSX      = path.join(__dirname, "../client/src/App.tsx");
const NAV          = path.join(__dirname, "../client/src/lib/nav-config.ts");
const CMD          = path.join(__dirname, "../client/src/pages/capital-command-center.tsx");
const INVESTORS    = path.join(__dirname, "../client/src/pages/capital-investors.tsx");
const DOCUMENTS    = path.join(__dirname, "../client/src/pages/capital-documents.tsx");

const routes    = fs.readFileSync(ROUTES,    "utf8");
const service   = fs.readFileSync(SERVICE,   "utf8");
const page      = fs.readFileSync(PAGE,      "utf8");
const appTsx    = fs.readFileSync(APP_TSX,   "utf8");
const nav       = fs.readFileSync(NAV,       "utf8");
const cmd       = fs.readFileSync(CMD,       "utf8");
const investors = fs.readFileSync(INVESTORS, "utf8");
const documents = fs.readFileSync(DOCUMENTS, "utf8");

let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function has(src, pattern, msg) {
  const ok = typeof pattern === "string" ? src.includes(pattern) : pattern.test(src);
  if (!ok) throw new Error(msg || `Pattern not found: ${pattern}`);
}
function hasNot(src, pattern, msg) {
  const found = typeof pattern === "string" ? src.includes(pattern) : pattern.test(src);
  if (found) throw new Error(msg || `Forbidden pattern found: ${pattern}`);
}

// ── Service: exports and structure ──────────────────────────────────────────
console.log("\n[Service: Exports]");

test("ENGAGEMENT_TIERS constant exported", () =>
  has(service, "export const ENGAGEMENT_TIERS"));
test("TIER_THRESHOLDS exported with correct values", () =>
  has(service, "TIER_THRESHOLDS") && has(service, '"Highly Engaged": 70'));
test("HIGH_VALUE_MATERIAL_TYPES exported", () =>
  has(service, "export const HIGH_VALUE_MATERIAL_TYPES"));
test("pitch_deck and financial_model in HIGH_VALUE_MATERIAL_TYPES", () =>
  has(service, "pitch_deck") && has(service, "financial_model"));
test("MEETING_ACTIVITY_TYPES exported", () =>
  has(service, "export const MEETING_ACTIVITY_TYPES"));
test("SCORE_WEIGHTS exported with numeric values", () =>
  has(service, "export const SCORE_WEIGHTS") && has(service, "inbound_reply_7d"));
test("engagementTierFromScore exported", () =>
  has(service, "export function engagementTierFromScore"));
test("extractEngagementSignals exported", () =>
  has(service, "export function extractEngagementSignals"));
test("computeEngagementScore exported", () =>
  has(service, "export function computeEngagementScore"));
test("recommendNextAction exported", () =>
  has(service, "export function recommendNextAction"));
test("buildEngagementTimeline exported", () =>
  has(service, "export function buildEngagementTimeline"));
test("computeEngagementAnalytics exported", () =>
  has(service, "export function computeEngagementAnalytics"));
test("computeMaterialEngagement exported", () =>
  has(service, "export function computeMaterialEngagement"));
test("computeCommandCenterEngagement exported", () =>
  has(service, "export function computeCommandCenterEngagement"));

// ── Service: scoring logic ───────────────────────────────────────────────────
console.log("\n[Service: Scoring Logic]");

test("do_not_contact forces Cold tier", () =>
  has(service, "do_not_contact") && has(service, '"Cold"'));
test("inbound_reply_7d gets highest weight (20)", () =>
  has(service, "inbound_reply_7d: 20"));
test("portal_opened gets weight 15", () =>
  has(service, "portal_opened: 15"));
test("commitment gets weight 20", () =>
  has(service, "commitment: 20"));
test("portal_never_opened penalty applied", () =>
  has(service, "portal_never_opened") && has(service, "SCORE_WEIGHTS.portal_never_opened"));
test("no_activity penalty applied", () =>
  has(service, "no_activity") && has(service, "SCORE_WEIGHTS.no_activity"));
test("score clamped to 0-100", () =>
  has(service, "Math.max(0, Math.min(100, score))"));
test("Passed stage forces Cold", () =>
  has(service, 'investor.stage === "Passed"'));
test("advanced stages award stage advancement bonus", () =>
  has(service, "stage_advancement") && has(service, "Diligence"));
test("financial_model trigger in recommendation", () =>
  has(service, '"Follow up now — investor viewed financial model"'));

// ── Service: tier thresholds ─────────────────────────────────────────────────
console.log("\n[Service: Tier Thresholds]");

test("Highly Engaged threshold >= 70", () =>
  has(service, ">= 70"));
test("Engaged threshold >= 45", () =>
  has(service, ">= 45"));
test("Watching threshold >= 25", () =>
  has(service, ">= 25"));
test("Stale threshold >= 10", () =>
  has(service, ">= 10"));

// ── Service: timeline builder ────────────────────────────────────────────────
console.log("\n[Service: Timeline]");

test("timeline processes activities", () =>
  has(service, "activities") && has(service, "activity_at"));
test("timeline processes email links (inbound/outbound)", () =>
  has(service, "email_inbound") || has(service, '`email_${e.direction'));
test("timeline processes portal events", () =>
  has(service, "portal_opened") && has(service, "material_viewed") && has(service, "material_downloaded"));
test("timeline processes material shares (viewed/downloaded)", () =>
  has(service, '"material_viewed"') && has(service, '"material_downloaded"'));
test("timeline deduplicates and limits events", () =>
  has(service, "seen.has(key)") && has(service, "unique.slice(0, limit)"));

// ── Service: EngagementIntelligence shape ────────────────────────────────────
console.log("\n[Service: Command Center Intelligence]");

test("EngagementIntelligence interface has top_engaged", () =>
  has(service, "top_engaged"));
test("EngagementIntelligence interface has stale_high_value", () =>
  has(service, "stale_high_value"));
test("EngagementIntelligence interface has portal_non_openers", () =>
  has(service, "portal_non_openers"));
test("EngagementIntelligence interface has recent_activity_feed", () =>
  has(service, "recent_activity_feed"));
test("EngagementIntelligence interface has materials_driving_engagement", () =>
  has(service, "materials_driving_engagement"));
test("EngagementIntelligence interface has engagement_risk_flags", () =>
  has(service, "engagement_risk_flags"));

// ── Routes: Phase 2I endpoints ───────────────────────────────────────────────
console.log("\n[Routes: Phase 2I Endpoints]");

test("GET /api/capital/engagement route registered", () =>
  has(routes, '"/api/capital/engagement"') &&
  has(routes, "requireAuth, requireCapitalAccess"));
test("GET /api/capital/investors/:id/engagement route registered", () =>
  has(routes, '"/api/capital/investors/:id/engagement"') &&
  has(routes, "requireAuth, requireCapitalAccess"));
test("engagement routes use requireCapitalAccess (not open)", () => {
  const engRouteSection = routes.match(/\/api\/capital\/engagement[\s\S]{0,200}/)?.[0] ?? "";
  has(engRouteSection, "requireCapitalAccess", "requireCapitalAccess missing from engagement route");
});
test("routes import capital-engagement service dynamically", () =>
  has(routes, "capital-engagement"));
test("extractEngagementSignals called in route", () =>
  has(routes, "extractEngagementSignals"));
test("computeEngagementScore called in route", () =>
  has(routes, "computeEngagementScore"));
test("computeEngagementAnalytics called in route", () =>
  has(routes, "computeEngagementAnalytics"));
test("computeMaterialEngagement called in route", () =>
  has(routes, "computeMaterialEngagement"));
test("investors response includes engagement data", () =>
  has(routes, "engagement_score") && has(routes, "engagement_tier"));
test("route returns analytics summary", () =>
  has(routes, "analytics") && has(routes, "material_engagement"));
test("investor engagement route returns timeline", () =>
  has(routes, "buildEngagementTimeline"));
test("all new routes use safeId for numeric params", () => {
  const idEngRoute = routes.match(/investors\/:id\/engagement[\s\S]{0,500}/)?.[0] ?? "";
  has(idEngRoute, "safeId", "safeId not used in investors/:id/engagement route");
});

// ── Routes: Access control ───────────────────────────────────────────────────
console.log("\n[Routes: Access Control]");

test("CAPITAL_ALLOWED_USER_IDS still present (Trevor = user 4)", () =>
  has(routes, "CAPITAL_ALLOWED_USER_IDS"));
test("CAPITAL_ALLOWED_EMAILS still present (Scott Carlson)", () =>
  has(routes, "scott.carlson@voltsafe.com"));
test("requireCapitalAccess still enforced", () =>
  has(routes, "requireCapitalAccess"));
test("engagement endpoint is not on the public/unauthenticated list", () => {
  // The investor portal endpoint is the only public capital endpoint
  const publicSection = routes.match(/\/api\/investor-portal\/:token[\s\S]{0,200}/)?.[0] ?? "";
  hasNot(publicSection, "/api/capital/engagement", "engagement endpoint must not be publicly accessible");
});

// ── Routes: Command center extension ────────────────────────────────────────
console.log("\n[Routes: Command Center Extension]");

test("command center response includes engagement_intel", () =>
  has(routes, "engagement_intel"));
test("computeCommandCenterEngagement called in command center route", () =>
  has(routes, "computeCommandCenterEngagement"));

// ── Frontend: engagement page ────────────────────────────────────────────────
console.log("\n[Frontend: Engagement Page]");

test("engagement page has Phase 2I comment header", () =>
  has(page, "Phase 2I"));
test("default export CapitalEngagement component", () =>
  has(page, "export default function CapitalEngagement"));
test("engagement page fetches /api/capital/engagement", () =>
  has(page, '"/api/capital/engagement"'));
test("round filter select present", () =>
  has(page, "select-round-filter"));
test("tier filter select present", () =>
  has(page, "select-tier-filter"));
test("search input present", () =>
  has(page, "input-engagement-search"));
test("summary cards section rendered", () =>
  has(page, "section-engagement-summary"));
test("card-highly-engaged testId present", () =>
  has(page, "card-highly-engaged"));
test("card-engaged testId present", () =>
  has(page, "card-engaged"));
test("card-stale-cold testId present", () =>
  has(page, "card-stale-cold"));
test("card-portal-opens-7d testId present", () =>
  has(page, "card-portal-opens-7d"));
test("card-material-views-7d testId present", () =>
  has(page, "card-material-views-7d"));
test("card-inbound-replies-7d testId present", () =>
  has(page, "card-inbound-replies-7d"));
test("investor engagement table rendered", () =>
  has(page, "investor-engagement-table"));
test("tier badge per investor row", () =>
  has(page, "badge-tier-"));
test("score bar (progress bar) rendered", () =>
  has(page, "scoreBar") || has(page, "score-bar") || has(page, "bar.pct"));
test("engagement detail expandable per investor", () =>
  has(page, "detail-engagement-"));
test("recommended action visible per investor", () =>
  has(page, "recommended-action-"));
test("signal icons (mail, globe, download, checkmark)", () =>
  has(page, "inbound_email_count") && has(page, "portal_opened") && has(page, "materials_downloaded_count"));
test("material engagement leaderboard rendered", () =>
  has(page, "section-material-engagement") && has(page, "material-engagement-list"));
test("portal non-openers section rendered", () =>
  has(page, "section-portal-non-openers"));
test("priority actions section rendered", () =>
  has(page, "section-recommended-actions"));
test("tier distribution chart rendered", () =>
  has(page, "tier-distribution-chart"));
test("tier distribution bars have testIds", () =>
  has(page, "bar-tier-highly-engaged") || has(page, 'bar-tier-${tier'));
test("stale hot investors section rendered", () =>
  has(page, "section-stale-hot"));
test("attention alerts for portal-no-engagement", () =>
  has(page, "alert-portal-no-engagement"));
test("attention alerts for hot-stale", () =>
  has(page, "alert-hot-stale"));
test("page imports Activity and TrendingUp from lucide-react", () =>
  has(page, "Activity") && has(page, "TrendingUp"));

// ── App.tsx: route registration ──────────────────────────────────────────────
console.log("\n[App.tsx: Route Registration]");

test("CapitalEngagementPage lazy imported in App.tsx", () =>
  has(appTsx, "CapitalEngagementPage") && has(appTsx, "capital-engagement"));
test("/capital/engagement route registered", () =>
  has(appTsx, '"/capital/engagement"'));
test("/capital/engagement route uses capitalGuard", () =>
  has(appTsx, "capitalGuard") && has(appTsx, "capital/engagement"));

// ── Nav config: Engagement item ──────────────────────────────────────────────
console.log("\n[Nav Config: Engagement Item]");

test("Engagement nav item added to Capital section", () =>
  has(nav, "capital-engagement") || has(nav, "Engagement"));
test("Engagement route is /capital/engagement", () =>
  has(nav, "/capital/engagement"));
test("Engagement item has capitalOnly: true (inherited from Capital section)", () => {
  const capitalSection = nav.match(/id: "capital"[\s\S]{0,2000}/)?.[0] ?? "";
  has(capitalSection, "capitalOnly: true", "capitalOnly not found in Capital section");
});

// ── Command center: engagement intel extension ───────────────────────────────
console.log("\n[Command Center: Engagement Intelligence]");

test("CommandCenterData type includes engagement_intel field", () =>
  has(cmd, "engagement_intel"));
test("command center renders engagement intel section", () =>
  has(cmd, "section-engagement-intel") || has(cmd, "Engagement Intelligence"));
test("top engaged investors rendered in command center", () =>
  has(cmd, "top_engaged") || has(cmd, "top-engaged"));
test("stale high-value investors rendered in command center", () =>
  has(cmd, "stale_high_value") || has(cmd, "stale-high-value") || has(cmd, "stale_high_value"));
test("engagement risk flags rendered in command center", () =>
  has(cmd, "engagement_risk_flags") || has(cmd, "engagement-risk-flags"));

// ── Investor detail: engagement panel ────────────────────────────────────────
console.log("\n[Investor Detail: Engagement Panel]");

test("InvestorDetail renders engagement panel or fetches engagement", () =>
  has(investors, "engagement") &&
  (has(investors, "/api/capital/investors") || has(investors, "InvestorEngagementPanel")));
test("engagement score or tier shown in investor detail", () =>
  has(investors, "engagement_score") || has(investors, "engagement_tier") ||
  has(investors, "InvestorEngagementPanel") || has(investors, "Engagement Score"));

// ── Data Room: material engagement metrics ───────────────────────────────────
console.log("\n[Data Room: Material Engagement Metrics]");

test("capital-documents references material engagement or views", () =>
  has(documents, "total_views") || has(documents, "engagement") || has(documents, "material_engagement") ||
  has(documents, "views") && has(documents, "downloads"));

// ── Security: no raw SQL injection in new routes ─────────────────────────────
console.log("\n[Security: SQL Safety]");

test("round_id param cast via safeId before use in engagement route", () => {
  const engSection = routes.match(/\/api\/capital\/engagement[\s\S]{0,1000}/)?.[0] ?? "";
  // Either safeId or Number() cast or no interpolation at all
  const hasSafe = engSection.includes("safeId") || engSection.includes("Number(") ||
                  !engSection.includes("req.query.round_id");
  assert(hasSafe, "round_id used unsafely in engagement route");
});
test("investor_id param uses safeId in per-investor engagement route", () => {
  const invEngSection = routes.match(/investors\/:id\/engagement[\s\S]{0,500}/)?.[0] ?? "";
  has(invEngSection, "safeId", "safeId not used in investor engagement route");
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`Phase 2I Engagement Tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
}
console.log("All Phase 2I engagement tests passed.\n");
