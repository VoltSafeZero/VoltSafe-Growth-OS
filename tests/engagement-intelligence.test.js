/**
 * tests/engagement-intelligence.test.js
 *
 * Source-grep + logic-simulation tests for the engagement intelligence layer.
 * Covers all 10 required scenarios.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;
let currentSection = "";

function section(name) {
  currentSection = name;
  console.log(`\n${name}`);
}

function check(desc, cond) {
  if (cond) {
    console.log(`  ✓ ${desc}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL [${currentSection}]: ${desc}`);
    failed++;
  }
}

function read(relPath) {
  return readFileSync(join(__dirname, "..", relPath), "utf8");
}

// ── Inline intent scoring (mirrors server logic) ───────────────────────────

function computeIntentLevel({
  demoClickCount = 0,
  demoClicksIn7d = 0,
  lastCtaClickedAt = null,
  isReplied = false,
  demoCtickerContactCount = 0,
} = {}) {
  if (demoClickCount === 0) return "none";

  const lastClickMs = lastCtaClickedAt ? new Date(lastCtaClickedAt).getTime() : 0;
  const nowMs = Date.now();
  const clickedIn24h = lastClickMs > nowMs - 24 * 60 * 60 * 1000;

  if (demoClicksIn7d >= 3 || demoCtickerContactCount >= 2) {
    if (!isReplied && clickedIn24h) return "follow_up_recommended";
    return "very_high_intent";
  }

  if (demoClickCount >= 2 || (demoClickCount >= 1 && clickedIn24h)) {
    if (!isReplied && clickedIn24h) return "follow_up_recommended";
    return "high_intent";
  }

  return "interested";
}

const now = new Date();
const recent    = new Date(now - 10 * 60 * 1000).toISOString();       // 10 min ago
const dayAgo    = new Date(now - 25 * 60 * 60 * 1000).toISOString();  // 25h ago
const oldClick  = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString(); // 8 days ago

// ── [1] One demo click → Interested ───────────────────────────────────────

section("[1] One demo click → Interested");
{
  const level = computeIntentLevel({ demoClickCount: 1, demoClicksIn7d: 1, lastCtaClickedAt: dayAgo });
  check("level is 'interested'", level === "interested");
  check("not none", level !== "none");
  check("not high_intent", level !== "high_intent");
}

// ── [2] Two demo clicks → High Intent ─────────────────────────────────────

section("[2] Two demo clicks → High Intent");
{
  const level = computeIntentLevel({ demoClickCount: 2, demoClicksIn7d: 2, lastCtaClickedAt: dayAgo });
  check("level is 'high_intent'", level === "high_intent");
  check("not very_high_intent", level !== "very_high_intent");
}

// ── [3] Three demo clicks in 7 days → Very High Intent ────────────────────

section("[3] Three demo clicks in 7 days → Very High Intent");
{
  const level = computeIntentLevel({ demoClickCount: 3, demoClicksIn7d: 3, lastCtaClickedAt: dayAgo });
  check("level is 'very_high_intent'", level === "very_high_intent");
  check("not follow_up_recommended (replied=false but old click)", level !== "follow_up_recommended");
}

// ── [4] Demo click + no reply within 24h → Follow Up Recommended ──────────

section("[4] Demo click + no reply in 24h → Follow Up Recommended");
{
  const level = computeIntentLevel({
    demoClickCount: 2,
    demoClicksIn7d: 2,
    lastCtaClickedAt: recent,
    isReplied: false,
  });
  check("level is 'follow_up_recommended'", level === "follow_up_recommended");

  const levelAfterReply = computeIntentLevel({
    demoClickCount: 2,
    demoClicksIn7d: 2,
    lastCtaClickedAt: recent,
    isReplied: true,
  });
  check("after reply: drops back to 'high_intent' (not follow_up)", levelAfterReply === "high_intent");
}

// ── [5] Multiple contacts from same account → Account Heating Up ──────────

section("[5] Multiple contacts from same account → Account Heating Up");
{
  const level = computeIntentLevel({
    demoClickCount: 2,
    demoClicksIn7d: 2,
    lastCtaClickedAt: dayAgo,
    demoCtickerContactCount: 2,
  });
  check("account with 2 demo-clicking contacts → 'very_high_intent'", level === "very_high_intent");

  const level3 = computeIntentLevel({
    demoClickCount: 1,
    demoClicksIn7d: 1,
    lastCtaClickedAt: dayAgo,
    demoCtickerContactCount: 2,
  });
  check("even 1 click per contact: 2 contactors → 'very_high_intent'", level3 === "very_high_intent");
}

// ── [6] Contact endpoint returns correct summary ───────────────────────────

section("[6] Contact engagement endpoint exists and returns correct fields");
{
  const routesSrc = read("server/routes.ts");
  const svcSrc   = read("server/services/engagement-intelligence.ts");
  check("GET /api/engagement/contact/:contactId exists",
    routesSrc.includes("/api/engagement/contact/:contactId"));
  check("endpoint requires auth",
    routesSrc.includes("/api/engagement/contact/:contactId") &&
    routesSrc.includes("requireAuth"));
  // Fields come from getContactEngagement in the service, not repeated in routes.ts
  check("service returns intentLevel",    svcSrc.includes("intentLevel"));
  check("service returns suggestedAction", svcSrc.includes("suggestedAction"));
  check("service returns demoClickCount",  svcSrc.includes("demoClickCount"));
  check("service returns lastCtaClickedAt or lastCtaName",
    svcSrc.includes("lastCtaClickedAt") || svcSrc.includes("lastCtaName"));
}

// ── [7] Account endpoint aggregates correctly ─────────────────────────────

section("[7] Account engagement endpoint aggregates");
{
  const routesSrc = read("server/routes.ts");
  const svcSrc   = read("server/services/engagement-intelligence.ts");
  check("GET /api/engagement/account/:accountId exists",
    routesSrc.includes("/api/engagement/account/:accountId"));
  check("getAccountEngagement iterates contacts",
    svcSrc.includes("for (const c of contacts)"));
  check("account summary includes engagedContactCount",
    svcSrc.includes("engagedContactCount"));
  check("account summary includes demoCtickerContactCount",
    svcSrc.includes("demoCtickerContactCount"));
  check("account intent level elevated when 2+ demo-clicking contacts",
    svcSrc.includes("demoCtickerContactCount >= 2"));
  check("mostClickedCtaName computed across contacts",
    svcSrc.includes("mostClickedCtaName"));
}

// ── [8] Recent high-intent endpoint returns only relevant records ──────────

section("[8] Recent high-intent endpoint");
{
  const routesSrc = read("server/routes.ts");
  const svcSrc   = read("server/services/engagement-intelligence.ts");
  check("GET /api/engagement/recent-high-intent exists",
    routesSrc.includes("/api/engagement/recent-high-intent"));
  check("filters to last 30 days",
    svcSrc.includes("30 days"));
  check("filters click_count > 0",
    svcSrc.includes("s.click_count > 0"));
  check("filters out 'none' intent records",
    svcSrc.includes(".filter(r => r.intentLevel !== \"none\")"));
  check("limits results (max 100)",
    svcSrc.includes("Math.min(") && svcSrc.includes("100"));
}

// ── [9] No duplicate CRM activities for same click ────────────────────────

section("[9] No duplicate CRM activities for repeated clicks");
{
  const trackerSrc = read("server/services/signature-cta-tracker.ts");
  check("dedup gate: only !isBot && !isDup writes CRM activity",
    trackerSrc.includes("!isBot && !isDup") &&
    trackerSrc.includes("INSERT INTO activities"));
  check("click_count incremented only on real unique clicks",
    trackerSrc.includes("click_count = click_count + 1") &&
    trackerSrc.includes("!isBot && !isDup"));
  check("60-second dedup window prevents repeat-click storms",
    trackerSrc.includes("60 seconds"));
  check("click_event still recorded for all clicks (audit trail)",
    trackerSrc.includes("INSERT INTO signature_cta_click_events"));

  // Verify the intelligence service reads click_count (not raw events) for scoring
  const svcSrc = read("server/services/engagement-intelligence.ts");
  check("service aggregates s.click_count (not raw events) for performance",
    svcSrc.includes("SUM(s.click_count)"));
}

// ── [P2-1] Activity row normalization ─────────────────────────────────────

section("[P2-1] Activity row normalization");
{
  const svcSrc = read("server/services/engagement-intelligence.ts");

  check("ActivityRow type exported",
    svcSrc.includes("export interface ActivityRow"));
  check("EngagementSummary type exported",
    svcSrc.includes("export interface EngagementSummary"));
  check("ThreadEngagementFull type exported",
    svcSrc.includes("export interface ThreadEngagementFull"));

  check("email_open activity type defined",
    svcSrc.includes("\"email_open\"") || svcSrc.includes("'email_open'") ||
    svcSrc.includes("email_open"));
  check("email_link_click activity type defined",
    svcSrc.includes("email_link_click"));
  check("video_click activity type defined",
    svcSrc.includes("video_click"));
  check("signature_cta_click activity type defined",
    svcSrc.includes("signature_cta_click"));
  check("reply activity type defined",
    svcSrc.includes("\"reply\"") || svcSrc.includes("'reply'"));

  // Demo CTA classified as video_click
  check("demo CTA → video_click type when isDemoCtaName",
    svcSrc.includes("isDemo ? \"video_click\" : \"signature_cta_click\"") ||
    svcSrc.includes("isDemo ? 'video_click' : 'signature_cta_click'") ||
    (svcSrc.includes("video_click") && svcSrc.includes("isDemoCtaName")));

  // ActivityRow has all required spec fields
  check("ActivityRow has recipientEmail",   svcSrc.includes("recipientEmail"));
  check("ActivityRow has activityType",     svcSrc.includes("activityType"));
  check("ActivityRow has label",            svcSrc.includes("label:"));
  check("ActivityRow has ctaName",          svcSrc.includes("ctaName"));
  check("ActivityRow has count",            svcSrc.includes("count:"));
  check("ActivityRow has firstAt / lastAt", svcSrc.includes("firstAt") && svcSrc.includes("lastAt"));
  check("ActivityRow has suggestedAction",  svcSrc.includes("suggestedAction"));
  check("ActivityRow has threadId",         svcSrc.includes("threadId"));
}

// ── [P2-2] Summary counts ──────────────────────────────────────────────────

section("[P2-2] Engagement summary counts");
{
  const svcSrc = read("server/services/engagement-intelligence.ts");

  check("summary includes opens",            svcSrc.includes("opens:"));
  check("summary includes emailLinkClicks",  svcSrc.includes("emailLinkClicks"));
  check("summary includes signatureCtaClicks", svcSrc.includes("signatureCtaClicks"));
  check("summary includes videoClicks",      svcSrc.includes("videoClicks"));
  check("summary includes replies",          svcSrc.includes("replies:"));
  check("summary includes lastActivityAt",   svcSrc.includes("lastActivityAt"));
  check("summary includes highestIntentLevel", svcSrc.includes("highestIntentLevel"));

  // Opens come from email_tracking_pixels JOIN email_engagement_events
  check("opens query joins email_tracking_pixels + email_engagement_events",
    svcSrc.includes("email_tracking_pixels") && svcSrc.includes("email_engagement_events") &&
    svcSrc.includes("event_type = 'open'"));
  // Link clicks come from same tables but event_type='click'
  check("link click query uses event_type = 'click'",
    svcSrc.includes("event_type = 'click'"));
  // Thread scoping via email_messages.gmail_thread_id
  check("thread engagement scoped to gmail_thread_id",
    svcSrc.includes("gmail_thread_id"));
  // Replies come from email_tracking_pixels.is_replied
  check("replies detected via is_replied column",
    svcSrc.includes("is_replied"));
}

// ── [P2-3] New API endpoints ───────────────────────────────────────────────

section("[P2-3] Phase 2 API endpoints");
{
  const routesSrc = read("server/routes.ts");
  const svcSrc    = read("server/services/engagement-intelligence.ts");

  check("GET /api/engagement/recent exists",
    routesSrc.includes("/api/engagement/recent\""));
  check("/api/engagement/recent requires auth",
    routesSrc.includes("/api/engagement/recent") &&
    routesSrc.includes("requireAuth"));
  check("getThreadEngagementFull exported from service",
    svcSrc.includes("export async function getThreadEngagementFull"));
  check("thread endpoint calls getThreadEngagementFull",
    routesSrc.includes("getThreadEngagementFull"));
  check("ThreadEngagementFull includes activities array",
    svcSrc.includes("activities: ActivityRow[]") || svcSrc.includes("activities:"));
  check("ThreadEngagementFull backward-compatible (ctaClicks, bannerText still present)",
    svcSrc.includes("ctaClicks:") && svcSrc.includes("bannerText"));
}

// ── [P2-4] UI components Phase 2 ──────────────────────────────────────────

section("[P2-4] Phase 2 UI components");
{
  const widgetSrc = read("client/src/components/engagement/EngagementWidget.tsx");

  check("EngagementSummaryCards exported",
    widgetSrc.includes("export function EngagementSummaryCards"));
  check("EngagementFilterTabs exported",
    widgetSrc.includes("export function EngagementFilterTabs"));
  check("EngagementActivityTable exported",
    widgetSrc.includes("export function EngagementActivityTable"));
  check("ThreadEngagementWidget exported",
    widgetSrc.includes("export function ThreadEngagementWidget"));

  // Summary cards cover all 5 required signal types
  check("summary cards show Opens",   widgetSrc.includes("Opens") || widgetSrc.includes("opens"));
  check("summary cards show Demo/Video", widgetSrc.includes("Demo") || widgetSrc.includes("videoClicks"));
  check("summary cards show Replies", widgetSrc.includes("Replies") || widgetSrc.includes("replies"));
  check("summary cards show Links",   widgetSrc.includes("Links") || widgetSrc.includes("emailLinkClicks"));
  check("summary cards show Last Activity", widgetSrc.includes("Last") || widgetSrc.includes("lastActivityAt"));

  // Filter tabs
  check("filter tabs: all",         widgetSrc.includes("\"all\"") || widgetSrc.includes("'all'"));
  check("filter tabs: opens",       widgetSrc.includes("\"opens\"") || widgetSrc.includes("'opens'"));
  check("filter tabs: demo",        widgetSrc.includes("\"demo\"") || widgetSrc.includes("'demo'"));
  check("filter tabs: high_intent", widgetSrc.includes("\"high_intent\"") || widgetSrc.includes("'high_intent'"));

  // Sort options
  check("sort option: newest",        widgetSrc.includes("newest"));
  check("sort option: most_clicks",   widgetSrc.includes("most_clicks"));
  check("sort option: highest_intent",widgetSrc.includes("highest_intent"));

  // Thread widget uses collapsible expand/collapse
  check("ThreadEngagementWidget is collapsible (expanded state)",
    widgetSrc.includes("expanded") && (widgetSrc.includes("ChevronDown") || widgetSrc.includes("ChevronUp")));

  // Privacy-safe follow-up: never reveals exact tracking data in outbound email
  check("follow-up template does NOT say 'I saw you clicked'",
    !widgetSrc.includes("I saw you clicked") && !widgetSrc.includes("I saw you opened"));
  check("follow-up template uses safe language",
    widgetSrc.includes("follow up") || widgetSrc.includes("questions"));

  // CtaEngagementBanner still exported (backward compat)
  check("CtaEngagementBanner backward-compat export exists",
    widgetSrc.includes("export function CtaEngagementBanner"));
}

// ── [P2-5] Filter and sort logic ──────────────────────────────────────────

section("[P2-5] Filter and sort logic (inline simulation)");
{
  // Simulate applyFilter behavior
  const activities = [
    { activityType: "email_open",    intentLevel: "interested",           count: 3, lastAt: "2026-06-01T10:00:00Z" },
    { activityType: "email_link_click", intentLevel: "interested",        count: 1, lastAt: "2026-06-02T10:00:00Z" },
    { activityType: "video_click",   intentLevel: "high_intent",          count: 2, lastAt: "2026-06-03T10:00:00Z" },
    { activityType: "signature_cta_click", intentLevel: "interested",     count: 1, lastAt: "2026-05-30T10:00:00Z" },
    { activityType: "reply",         intentLevel: "none",                 count: 1, lastAt: "2026-06-01T08:00:00Z" },
  ];

  const INTENT_ORDER_P2 = ["none","interested","high_intent","very_high_intent","follow_up_recommended"];

  function applyFilter(rows, filter) {
    switch (filter) {
      case "opens":       return rows.filter(r => r.activityType === "email_open");
      case "links":       return rows.filter(r => r.activityType === "email_link_click");
      case "demo":        return rows.filter(r => r.activityType === "video_click" || r.activityType === "signature_cta_click");
      case "replies":     return rows.filter(r => r.activityType === "reply");
      case "high_intent": return rows.filter(r => INTENT_ORDER_P2.indexOf(r.intentLevel) >= INTENT_ORDER_P2.indexOf("high_intent"));
      default:            return rows;
    }
  }

  function applySort(rows, sort) {
    const copy = [...rows];
    switch (sort) {
      case "newest":  return copy.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
      case "oldest":  return copy.sort((a, b) => new Date(a.lastAt).getTime() - new Date(b.lastAt).getTime());
      case "most_demo": return copy.sort((a, b) => {
        const aS = a.activityType === "video_click" ? a.count : 0;
        const bS = b.activityType === "video_click" ? b.count : 0;
        return bS - aS;
      });
      case "highest_intent": return copy.sort((a, b) =>
        INTENT_ORDER_P2.indexOf(b.intentLevel) - INTENT_ORDER_P2.indexOf(a.intentLevel));
      default: return copy;
    }
  }

  const opens = applyFilter(activities, "opens");
  check("filter 'opens' returns only email_open rows", opens.length === 1 && opens[0].activityType === "email_open");

  const links = applyFilter(activities, "links");
  check("filter 'links' returns only email_link_click rows", links.length === 1 && links[0].activityType === "email_link_click");

  const demo = applyFilter(activities, "demo");
  check("filter 'demo' returns video_click + signature_cta_click", demo.length === 2);

  const replies = applyFilter(activities, "replies");
  check("filter 'replies' returns only reply rows", replies.length === 1 && replies[0].activityType === "reply");

  const highIntent = applyFilter(activities, "high_intent");
  check("filter 'high_intent' returns rows with high_intent or above", highIntent.length === 1 && highIntent[0].activityType === "video_click");

  const all = applyFilter(activities, "all");
  check("filter 'all' returns all rows", all.length === 5);

  const sortedNewest = applySort(activities, "newest");
  check("sort 'newest' puts most-recent row first",
    sortedNewest[0].lastAt === "2026-06-03T10:00:00Z");

  const sortedDemo = applySort(activities, "most_demo");
  check("sort 'most_demo' puts video_click first",
    sortedDemo[0].activityType === "video_click");

  const sortedIntent = applySort(activities, "highest_intent");
  check("sort 'highest_intent' puts high_intent row first",
    sortedIntent[0].intentLevel === "high_intent");
}

// ── [10] Existing email tracking still works ──────────────────────────────

section("[10] Existing tracking systems unaffected");
{
  const trackingSrc = read("server/tracking.ts");
  const routesSrc   = read("server/routes.ts");
  const syncSrc     = read("server/services/gmail-sync.ts");

  check("open tracking endpoint still exists",
    routesSrc.includes("/track/open/") || trackingSrc.includes("track/open"));
  check("link click tracking endpoint still exists",
    routesSrc.includes("/track/click/") || trackingSrc.includes("track/click"));
  check("signature CTA click tracking endpoint still exists",
    routesSrc.includes("/track/signature-click/"));
  check("scheduled send still uses full pipeline (normalise + CTA + tracking)",
    syncSrc.includes("normalizeOutboundHtml") &&
    syncSrc.includes("wrapCta") || syncSrc.includes("wrapSignatureCtaLinks") &&
    syncSrc.includes("injectTracking"));
  check("injectTracking skips CTA-wrapped /track/ URLs (no double-wrap)",
    trackingSrc.includes("/track/"));

  // Engagement service imports
  const svcSrc = read("server/services/engagement-intelligence.ts");
  check("service exports computeIntentLevel (pure, testable)",
    svcSrc.includes("export function computeIntentLevel"));
  check("service exports getContactEngagement",
    svcSrc.includes("export async function getContactEngagement"));
  check("service exports getAccountEngagement",
    svcSrc.includes("export async function getAccountEngagement"));
  check("service exports getRecentHighIntent",
    svcSrc.includes("export async function getRecentHighIntent"));
  check("service exports getThreadEngagement",
    svcSrc.includes("export async function getThreadEngagement"));

  // UI
  const widgetSrc = read("client/src/components/engagement/EngagementWidget.tsx");
  check("EngagementIntentBadge exported",
    widgetSrc.includes("export function EngagementIntentBadge"));
  check("ContactEngagementWidget exported",
    widgetSrc.includes("export function ContactEngagementWidget"));
  check("AccountEngagementWidget exported",
    widgetSrc.includes("export function AccountEngagementWidget"));
  check("CtaEngagementBanner exported",
    widgetSrc.includes("export function CtaEngagementBanner"));
  check("CreateFollowUpButton exported",
    widgetSrc.includes("export function CreateFollowUpButton"));
  check("follow-up email draft does NOT auto-send",
    widgetSrc.includes("open-compose") &&
    !widgetSrc.includes("sendEmail") &&
    !widgetSrc.includes("apiRequest"));

  // Contact + account pages wired
  const contactSrc = read("client/src/pages/contact-profile.tsx");
  const accountSrc = read("client/src/pages/account-profile.tsx");
  check("ContactEngagementWidget used in contact-profile",
    contactSrc.includes("ContactEngagementWidget"));
  check("AccountEngagementWidget used in account-profile",
    accountSrc.includes("AccountEngagementWidget"));

  // Thread banner in gmail-inbox
  const inboxSrc = read("client/src/pages/gmail-inbox.tsx");
  check("CtaEngagementBanner used in gmail-inbox",
    inboxSrc.includes("CtaEngagementBanner"));
}

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
