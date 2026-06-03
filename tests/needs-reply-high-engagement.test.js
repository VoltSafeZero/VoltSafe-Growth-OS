/**
 * tests/needs-reply-high-engagement.test.js
 *
 * Source-grep tests for the "Needs Reply — High Engagement" widget.
 * Covers: scoring, sorting, reply detection, exclusions, routing,
 * empty state, engagement pills, intent badges, quick actions,
 * and widget registration.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;

function check(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

// ── Load source files ─────────────────────────────────────────────────────────

const routes = readFileSync(join(__dirname, "../server/routes.ts"), "utf8");
const widget = readFileSync(join(__dirname, "../client/src/components/today/NeedsReplyWidget.tsx"), "utf8");
const today  = readFileSync(join(__dirname, "../client/src/components/today/today-widgets.tsx"), "utf8");
const action = readFileSync(join(__dirname, "../client/src/components/command-centers/action-widgets.tsx"), "utf8");
const config = readFileSync(join(__dirname, "../client/src/lib/dashboard-config.ts"), "utf8");

// ── Backend endpoint ──────────────────────────────────────────────────────────

console.log("\n── Backend endpoint ──");

check("GET /api/dashboard/needs-reply-high-engagement registered",
  routes.includes("/api/dashboard/needs-reply-high-engagement"));

check("Endpoint is behind requireAuth",
  routes.includes('"/api/dashboard/needs-reply-high-engagement", requireAuth'));

check("Response wraps items array",
  routes.includes("res.json({ items })"));

// ── Scoring ───────────────────────────────────────────────────────────────────

console.log("\n── Scoring ──");

check("Open event scores 1 point",
  routes.includes("open_count,  0) * 1") ||
  routes.includes("open_count, 0) * 1") ||
  routes.includes("opens_count, 0) * 1") ||
  (routes.includes("opens * 1") || routes.includes("opensCount * 1")));

check("Click event scores 3 points",
  routes.includes("* 3") && routes.includes("click_count"));

check("CTA click scores 5 points",
  routes.includes("* 5") && routes.includes("cta_clicks"));

check("Video/demo click scores 8 points",
  routes.includes("* 8") && routes.includes("video_clicks"));

check("Awaiting reply bonus of 10 points",
  routes.includes("? 10 : 0") && routes.includes("awaiting_reply_since"));

check("engagementScore returned in API items",
  routes.includes("engagementScore"));

check("intentLevel computed and returned",
  routes.includes("intentLevel"));

check("very_high_intent at score >= 16",
  routes.includes("16") && routes.includes("very_high_intent"));

check("high_intent at score >= 6",
  routes.includes(">= 6") && routes.includes("high_intent"));

check("interested at score >= 1",
  routes.includes(">= 1") && routes.includes("interested"));

// ── Engagement source parity with InboxSignalBadge ────────────────────────────

console.log("\n── Engagement source parity ──");

check("Uses is_duplicate=false (matching InboxSignalBadge exactly)",
  routes.includes("is_duplicate=false"));

check("Uses is_bot=false filter",
  routes.includes("is_bot=false"));

check("Uses LEFT JOIN LATERAL for engagement events",
  routes.includes("LEFT JOIN LATERAL") && routes.includes("tracking_id = p.tracking_id"));

check("Filters to outbound direction only",
  routes.includes("direction = 'outbound'"));

check("Identifies demo CTAs by name (demo, watch) and URL",
  routes.includes("'%demo%'") && routes.includes("'%watch%'"));

check("CTA clicks and video clicks are separate",
  routes.includes("cta_clicks") && routes.includes("video_clicks"));

// ── Exclusion filters ─────────────────────────────────────────────────────────

console.log("\n── Exclusions ──");

check("Excludes reply_status='done'",
  routes.includes("NOT IN ('done'") && routes.includes("reply_status"));

check("Excludes reply_status='no_reply_needed'",
  routes.includes("'no_reply_needed'") && routes.includes("reply_status"));

check("Excludes workflow_state='closed'",
  routes.includes("'closed'") && routes.includes("workflow_state"));

check("Excludes workflow_state='archived'",
  routes.includes("'archived'") && routes.includes("workflow_state"));

check("Excludes SPAM threads",
  routes.includes('"SPAM"') && routes.includes("label_ids"));

check("Excludes TRASH threads",
  routes.includes('"TRASH"') && routes.includes("label_ids"));

check("HAVING clause ensures only threads with real engagement",
  routes.includes("HAVING") && routes.includes("unique_opens") && routes.includes("> 0"));

// ── Reply detection ───────────────────────────────────────────────────────────

console.log("\n── Reply detection ──");

check("needsReply=true when awaiting_reply_since set",
  routes.includes("awaitingReply") && routes.includes("needsReply"));

check("needsReply=true when reply_status='needs_reply'",
  routes.includes("needs_reply") && routes.includes("needsReply"));

check("waitingDays computed from awaiting_reply_since or last_email_at",
  routes.includes("waitingBase") && routes.includes("waitingDays") && routes.includes("86400000"));

check("routeTarget uses /gmail?thread= with encodeURIComponent",
  routes.includes("/gmail?thread=") && routes.includes("encodeURIComponent"));

// ── Sort options (client-side) ────────────────────────────────────────────────

console.log("\n── Sort options ──");

check("Sort: Highest Engagement",
  widget.includes("highest_engagement") && widget.includes("Highest Engagement"));

check("Sort: Most Recent Engagement",
  widget.includes("most_recent") && widget.includes("Most Recent Engagement"));

check("Sort: Longest Waiting",
  widget.includes("longest_waiting") && widget.includes("Longest Waiting"));

check("Sort: Newest Email",
  widget.includes("newest_email") && widget.includes("Newest Email"));

check("Sort: Highest Intent",
  widget.includes("highest_intent") && widget.includes("Highest Intent"));

check("sortItems function covers all 5 sort keys",
  widget.includes("sortItems") &&
  ["highest_engagement","most_recent","longest_waiting","newest_email","highest_intent"]
    .every(k => widget.includes(k)));

check("Default sort is highest_engagement",
  widget.includes('"highest_engagement"') || widget.includes("'highest_engagement'"));

check("Sort dropdown has data-testid",
  widget.includes("sort-control-needs-reply"));

// ── Empty state ───────────────────────────────────────────────────────────────

console.log("\n── Empty state ──");

check("Empty headline: No high-engagement replies waiting.",
  widget.includes("No high-engagement replies waiting."));

check("Empty subline: Inbox is behaving for once.",
  widget.includes("Inbox is behaving for once."));

check("Empty state has data-testid",
  widget.includes("empty-state-needs-reply"));

// ── Engagement pills ──────────────────────────────────────────────────────────

console.log("\n── Engagement pills ──");

check("Opens pill shows Opened N×",
  widget.includes("Opened") && widget.includes("opensCount") && widget.includes("pill-opens-"));

check("Clicks pill shows N Clicks",
  widget.includes("Click") && widget.includes("clickCount") && widget.includes("pill-clicks-"));

check("Demo Viewed pill for video clicks",
  widget.includes("Demo Viewed") && widget.includes("videoClicks") && widget.includes("pill-video-"));

check("CTA Clicked pill for CTA clicks",
  widget.includes("CTA Clicked") && widget.includes("ctaClicks") && widget.includes("pill-cta-"));

// ── Intent badge ──────────────────────────────────────────────────────────────

console.log("\n── Intent badge ──");

check("very_high_intent → red badge",
  widget.includes("very_high_intent") && widget.includes("text-red-400"));

check("high_intent → amber badge",
  widget.includes("high_intent") && widget.includes("text-amber-400"));

check("interested → blue badge",
  widget.includes("interested") && widget.includes("text-blue-400"));

check("Intent badge has data-testid badge-intent-",
  widget.includes("badge-intent-"));

// ── Routing ───────────────────────────────────────────────────────────────────

console.log("\n── Routing ──");

check("Row link navigates to routeTarget (thread URL)",
  widget.includes("routeTarget") && widget.includes("href"));

check("Reply quick action navigates to thread with ?action=reply",
  widget.includes("/gmail?thread=") && widget.includes("action=reply"));

// ── Quick actions ─────────────────────────────────────────────────────────────

console.log("\n── Quick actions ──");

check("Reply button present with data-testid btn-reply-",
  widget.includes("btn-reply-") && widget.includes("Reply"));

check("Snooze 3 days button present with data-testid btn-snooze-",
  widget.includes("btn-snooze-") && widget.includes("Snooze 3 days"));

check("No Reply Needed button with data-testid btn-no-reply-",
  widget.includes("btn-no-reply-") && widget.includes("No reply needed"));

check("Snooze sends snoozedUntil 3 days from now",
  widget.includes("snoozedUntil") && widget.includes("3 * 24 * 60 * 60 * 1000"));

check("Snooze patches /api/gmail/thread-record/",
  widget.includes("/api/gmail/thread-record/"));

check("No Reply Needed patches with replyStatus: no_reply_needed",
  widget.includes("no_reply_needed") && widget.includes("/api/gmail/thread-record/"));

check("Quick action success invalidates widget query cache",
  widget.includes("invalidateQueries") &&
  widget.includes("/api/dashboard/needs-reply-high-engagement"));

check("Quick actions only visible on hover (opacity-0 / opacity-100)",
  widget.includes("opacity-0") && widget.includes("opacity-100") && widget.includes("showActions"));

// ── Waiting days UI ───────────────────────────────────────────────────────────

console.log("\n── Waiting days ──");

check("7+ waiting days shown in red",
  widget.includes("waitingDays >= 7") && widget.includes("text-red-400"));

check("3–6 waiting days shown in amber",
  widget.includes("waitingDays >= 3") && widget.includes("text-amber-400"));

check("Waiting days has data-testid waiting-days-",
  widget.includes("waiting-days-"));

// ── Widget registration ───────────────────────────────────────────────────────

console.log("\n── Widget registration ──");

check("Registered in TODAY_ACTION_WIDGET_MAP",
  today.includes("today_needs_reply_high_engagement") &&
  today.includes("NeedsReplyHighEngagementWidget"));

check("Registered in TODAY_WIDGET_SIZE_HINTS with minH: 8",
  today.includes("today_needs_reply_high_engagement") && today.includes("minH: 8"));

check("Registered in TODAY_WIDGET_DEFS with correct label",
  today.includes("Needs Reply — High Engagement") &&
  today.includes("today_needs_reply_high_engagement"));

check("Imported in today-widgets.tsx",
  today.includes("NeedsReplyWidget") && today.includes("NeedsReplyHighEngagementWidget"));

check("Registered in ACTION_WIDGET_MAP",
  action.includes("needs_reply_high_engagement") &&
  action.includes("NeedsReplyHighEngagementWidget"));

check("Imported in action-widgets.tsx",
  action.includes("NeedsReplyWidget"));

check("Registered in NEW_WIDGETS config",
  config.includes("needs_reply_high_engagement") &&
  config.includes("Needs Reply — High Engagement"));

check("Added to UNIVERSAL_EXTRAS",
  config.includes("needs_reply_high_engagement") &&
  config.includes("UNIVERSAL_EXTRAS"));

check("Description matches spec",
  config.includes("People actively engaging with emails that still need a response."));

// ── Shell structure ───────────────────────────────────────────────────────────

console.log("\n── Shell & structure ──");

check("Uses ActionWidgetShell",
  widget.includes("ActionWidgetShell"));

check("Widget id is needs_reply_high_engagement",
  widget.includes('"needs_reply_high_engagement"'));

check("Shows count badge",
  widget.includes("count={count}"));

check("Rows have data-testid needs-reply-row-",
  widget.includes("needs-reply-row-"));

check("Count badge has data-testid count-badge-needs-reply",
  widget.includes("count-badge-needs-reply"));

check("Engagement pills container has data-testid pills-",
  widget.includes("pills-"));

check("Row metadata section has data-testid meta-",
  widget.includes("meta-"));

check("Quick actions container has data-testid quick-actions-",
  widget.includes("quick-actions-"));

// ── Result ────────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);
