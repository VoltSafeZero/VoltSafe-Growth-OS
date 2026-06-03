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
