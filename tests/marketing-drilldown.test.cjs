// tests/marketing-drilldown.test.cjs
// Source-grep tests for the Marketing Module Universal Drilldown system.
// Verifies backend endpoint + 6 marketing pages + reusable sheet component.

const fs   = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ✗ FAIL: ${label}`);
  }
}

function readFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function contains(src, pattern) {
  if (typeof pattern === "string") return src.includes(pattern);
  return pattern.test(src);
}

// ── 1. Backend drilldown endpoint ─────────────────────────────────────────────
console.log("\n[1] Backend endpoint in server/routes.ts");
{
  const BACKEND_GREP_CMD = `grep -c "GET /api/marketing/drilldown" server/routes.ts`;
  // We test by reading routes.ts (large file - use partial grep approach)
  const { execSync } = require("child_process");
  try {
    const count = execSync(BACKEND_GREP_CMD, { cwd: path.join(__dirname, "..") }).toString().trim();
    assert(Number(count) >= 1, "GET /api/marketing/drilldown endpoint registered");
  } catch (e) {
    assert(false, "GET /api/marketing/drilldown endpoint registered");
  }

  // Check specific metrics are supported
  const { execSync: exec2 } = require("child_process");
  const metrics = [
    "unknown_jurisdiction", "jurisdiction_canada", "jurisdiction_us",
    "express_consent", "implied_active", "implied_expiring_30", "implied_expiring_60",
    "implied_expiring_90", "implied_expired", "missing_consent_proof", "unknown_consent",
    "us_biz_eligible", "us_opted_out", "unsubscribed", "suppressed", "quarantined",
    "campaigns_blocked", "avg_unsub_rate", "avg_bounce_rate", "spam_complaint_rate",
    "all_campaigns", "active_campaigns", "consent_source", "form_opt_in_rate",
    "audience_contacts", "replies_total", "replies_pending", "replies_auto_ingested",
    "replies_task_created", "hot_accounts_by_label",
  ];
  for (const m of metrics) {
    try {
      const count = exec2(`grep -c "${m}" server/routes.ts`, { cwd: path.join(__dirname, "..") }).toString().trim();
      assert(Number(count) >= 1, `Backend metric "${m}" supported`);
    } catch (e) {
      assert(false, `Backend metric "${m}" supported`);
    }
  }

  // Verify endpoint has requireAuth + requirePermission
  try {
    const routesSnip = exec2(
      `grep -A3 "GET /api/marketing/drilldown" server/routes.ts`,
      { cwd: path.join(__dirname, "..") }
    ).toString();
    assert(routesSnip.includes("requireAuth"), "Endpoint uses requireAuth");
    assert(routesSnip.includes("requirePermission"), "Endpoint uses requirePermission");
  } catch (e) {
    assert(false, "Endpoint auth guards");
  }
}

// ── 2. Reusable MarketingDrilldownSheet component ─────────────────────────────
console.log("\n[2] Reusable MarketingDrilldownSheet component");
{
  const SHEET = "client/src/components/marketing/marketing-drilldown-sheet.tsx";
  assert(fs.existsSync(path.join(__dirname, "..", SHEET)), "marketing-drilldown-sheet.tsx file exists");

  const src = readFile(SHEET);

  assert(contains(src, "export function MarketingDrilldownSheet"), "MarketingDrilldownSheet exported");
  assert(contains(src, "export type DrilldownConfig"), "DrilldownConfig type exported");
  assert(contains(src, "DrilldownConfig"), "DrilldownConfig type defined");
  assert(contains(src, "/api/marketing/drilldown"), "Fetches from /api/marketing/drilldown");
  assert(contains(src, "side=\"right\""), "Sheet opens from right side");
  assert(contains(src, "data-testid=\"marketing-drilldown-sheet\""), "Sheet has testid");
  assert(contains(src, "input-drilldown-search"), "Search input has testid");
  assert(contains(src, "drilldown-table"), "Table has testid");
  assert(contains(src, "drilldown-empty"), "Empty state has testid");
  assert(contains(src, "drilldown-pagination"), "Pagination footer has testid");
  assert(contains(src, "btn-drilldown-prev"), "Previous page button testid");
  assert(contains(src, "btn-drilldown-next"), "Next page button testid");
  assert(contains(src, "btn-drilldown-refresh"), "Refresh button testid");
  assert(contains(src, "btn-drilldown-close"), "Close button testid");
  assert(contains(src, "total_pages"), "Handles total_pages for pagination");
  assert(contains(src, "page_size"), "Handles page_size pagination param");
  assert(contains(src, "staleTime: 30000"), "30s stale time for caching");
  assert(contains(src, "extraParams"), "Supports extraParams for extra query params");
  assert(contains(src, "consent_status"), "Renders consent_status badge");
  assert(contains(src, "jurisdiction"), "Renders jurisdiction badge");
  assert(contains(src, "suppression_status"), "Renders suppression badge");
  assert(contains(src, "unsub_rate"), "Renders unsub_rate with color");
  assert(contains(src, "bounce_rate"), "Renders bounce_rate with color");
  assert(contains(src, "classification"), "Renders classification badge");
  assert(contains(src, "sentiment"), "Renders sentiment badge");
  assert(contains(src, "reply_body_preview"), "Truncates reply body preview");
  assert(contains(src, "href={`/contacts/"), "Name cell links to contact page");
  assert(contains(src, "href={`/accounts/"), "Account cell links to account page");
  assert(contains(src, "href={`/marketing/campaigns/"), "Campaign cell links to campaign page");
  assert(contains(src, "RefreshCw"), "Refresh icon used");
  assert(contains(src, "animate-spin"), "Loading spinner on refresh");
  assert(contains(src, "refreshed_at"), "Shows refreshed-at timestamp");
  assert(contains(src, "empty_state"), "Shows custom empty_state message from API");
  assert(contains(src, "drilldown-row-"), "Table rows have dynamic testids");
  assert(contains(src, "drilldown-total"), "Total badge has testid");
}

// ── 3. Compliance Dashboard ───────────────────────────────────────────────────
console.log("\n[3] compliance-dashboard.tsx");
{
  const src = readFile("client/src/pages/compliance-dashboard.tsx");

  assert(contains(src, "MarketingDrilldownSheet"), "Imports MarketingDrilldownSheet");
  assert(contains(src, "DrilldownConfig"), "Imports DrilldownConfig");
  assert(contains(src, "const [drilldown, setDrilldown]"), "Has drilldown state");
  assert(contains(src, "<MarketingDrilldownSheet"), "Renders MarketingDrilldownSheet");
  assert(contains(src, "onClose={() => setDrilldown(null)}"), "Sheet has onClose handler");

  // StatCard now accepts onClick prop
  assert(contains(src, "onClick?: () => void;"), "StatCard accepts onClick prop");
  assert(contains(src, "View details →"), "StatCard shows drill hint text");
  assert(contains(src, "cursor-pointer hover:border-primary"), "StatCard has hover style when clickable");
  assert(contains(src, 'data-testid={`stat-card-'), "StatCard has dynamic testid");

  // All major metric groups are wired
  const STAT_CARDS = [
    ["jurisdiction_canada", "Canada jurisdiction"],
    ["jurisdiction_us", "US jurisdiction"],
    ["jurisdiction_other", "Other jurisdiction"],
    ["unknown_jurisdiction", "Unknown jurisdiction"],
    ["express_consent", "Express consent"],
    ["implied_active", "Implied active"],
    ["implied_expiring_30", "Implied expiring 30d"],
    ["implied_expiring_60", "Implied expiring 60d"],
    ["implied_expiring_90", "Implied expiring 90d"],
    ["implied_expired", "Implied expired"],
    ["missing_consent_proof", "Missing consent proof"],
    ["unknown_consent", "Unknown consent"],
    ["us_biz_eligible", "US B2B eligible"],
    ["us_opted_out", "US opted-out"],
    ["unsubscribed", "Unsubscribed"],
    ["suppressed", "Suppressed"],
    ["quarantined", "Quarantined"],
    ["campaigns_blocked", "Campaigns blocked"],
    ["avg_unsub_rate", "Avg unsub rate"],
    ["avg_bounce_rate", "Avg bounce rate"],
    ["spam_complaint_rate", "Spam complaint rate"],
    ["form_opt_in_rate", "Form opt-in rate"],
  ];
  for (const [metric, label] of STAT_CARDS) {
    assert(contains(src, `metric: "${metric}"`), `StatCard opens drilldown for "${metric}" (${label})`);
  }

  // PieChart segment click
  assert(contains(src, "onClick={(entry) =>"), "PieChart segments clickable via onClick");
  assert(contains(src, "cursor=\"pointer\""), "PieChart has cursor=pointer");
  assert(contains(src, "jurisdiction_canada"), "Pie click maps to jurisdiction_canada");

  // Consent source breakdown
  assert(contains(src, "metric: \"consent_source\""), "Consent source breakdown clickable");
  assert(contains(src, "extraParams: { source:"), "Consent source passes source extraParam");
  assert(contains(src, "consent-source-row-"), "Consent source rows have testids");

  // Campaign health table rows
  assert(contains(src, "campaign-health-row-"), "Campaign health table rows have testids");
  assert(contains(src, "hover:bg-primary/5 cursor-pointer"), "Campaign rows have hover drilldown style");
}

// ── 4. Marketing Dashboard ────────────────────────────────────────────────────
console.log("\n[4] marketing-dashboard.tsx");
{
  const src = readFile("client/src/pages/marketing-dashboard.tsx");

  assert(contains(src, "MarketingDrilldownSheet"), "Imports MarketingDrilldownSheet");
  assert(contains(src, "const [drilldown, setDrilldown]"), "Has drilldown state");
  assert(contains(src, "<MarketingDrilldownSheet"), "Renders MarketingDrilldownSheet");
  assert(contains(src, "onClose={() => setDrilldown(null)}"), "Sheet has onClose handler");

  // Campaign health cards
  assert(contains(src, "metric: \"active_campaigns\""), "Active campaigns card opens drilldown");
  assert(contains(src, "metric: \"campaigns_blocked\""), "Blocked campaigns card opens drilldown");
  assert(contains(src, "metric: \"campaigns_needs_approval\""), "Needs approval card opens drilldown");
  assert(contains(src, "metric: \"campaigns_with_replies\""), "Campaigns with replies card opens drilldown");

  // Compliance health cards
  assert(contains(src, "metric: \"unsubscribed\""), "Unsubscribes card opens drilldown");
  assert(contains(src, "metric: \"suppressed\""), "Suppression issues card opens drilldown");
  assert(contains(src, "metric: \"implied_expiring_30\""), "Consent expiry card opens drilldown");

  // Campaign cards are now buttons
  assert(contains(src, "campaign-health-${s.label"), "Campaign health cards have dynamic testids");
  assert(contains(src, "compliance-metric-"), "Compliance metric cards have testids");

  assert(contains(src, "View details →"), "Cards show drill hint");
}

// ── 5. Marketing Campaigns ────────────────────────────────────────────────────
console.log("\n[5] marketing-campaigns.tsx");
{
  const src = readFile("client/src/pages/marketing-campaigns.tsx");

  assert(contains(src, "MarketingDrilldownSheet"), "Imports MarketingDrilldownSheet");
  assert(contains(src, "const [drilldown, setDrilldown]"), "Has drilldown state");
  assert(contains(src, "<MarketingDrilldownSheet"), "Renders MarketingDrilldownSheet");

  // Summary stats are now buttons
  assert(contains(src, "metric: \"all_campaigns\""), "Total campaigns stat opens drilldown");
  assert(contains(src, "metric: \"active_campaigns\""), "Active campaigns stat opens drilldown");
  assert(contains(src, "campaign-stat-"), "Campaign stat buttons have testids");
  assert(contains(src, "cursor-pointer hover:border-primary"), "Stat buttons have hover style");
}

// ── 6. Hot Accounts ───────────────────────────────────────────────────────────
console.log("\n[6] marketing-hot-accounts.tsx");
{
  const src = readFile("client/src/pages/marketing-hot-accounts.tsx");

  assert(contains(src, "MarketingDrilldownSheet"), "Imports MarketingDrilldownSheet");
  assert(contains(src, "const [drilldown, setDrilldown]"), "Has drilldown state");
  assert(contains(src, "<MarketingDrilldownSheet"), "Renders MarketingDrilldownSheet");

  assert(contains(src, "metric: \"hot_accounts_by_label\""), "Heat filter cards open drilldown");
  assert(contains(src, "extraParams: { label }"), "Filter cards pass label extraParam");
  assert(contains(src, "heat-filter-"), "Heat filter cards have testids");
  assert(contains(src, "setDrilldown({ metric:"), "setDrilldown called on filter card click");
}

// ── 7. Replies ────────────────────────────────────────────────────────────────
console.log("\n[7] marketing-replies.tsx");
{
  const src = readFile("client/src/pages/marketing-replies.tsx");

  assert(contains(src, "MarketingDrilldownSheet"), "Imports MarketingDrilldownSheet");
  assert(contains(src, "const [drilldown, setDrilldown]"), "Has drilldown state");
  assert(contains(src, "<MarketingDrilldownSheet"), "Renders MarketingDrilldownSheet");

  assert(contains(src, "metric: \"replies_total\""), "Total replies stat opens drilldown");
  assert(contains(src, "metric: \"replies_pending\""), "Pending replies stat opens drilldown");
  assert(contains(src, "metric: \"replies_auto_ingested\""), "Auto-ingested replies stat opens drilldown");
  assert(contains(src, "metric: \"replies_task_created\""), "Task-created replies stat opens drilldown");

  // Cards are now clickable
  assert(contains(src, "reply-stat-"), "Reply stat cards have testids");
  assert(contains(src, "hover:border-primary"), "Reply stat cards have hover style");
  assert(contains(src, "cursor-pointer"), "Reply stat cards are cursor-pointer");
  assert(contains(src, "→"), "Reply stat cards show arrow hint");
}

// ── 8. Audiences ─────────────────────────────────────────────────────────────
console.log("\n[8] marketing-audiences.tsx");
{
  const src = readFile("client/src/pages/marketing-audiences.tsx");

  assert(contains(src, "MarketingDrilldownSheet"), "Imports MarketingDrilldownSheet");
  assert(contains(src, "const [drilldown, setDrilldown]"), "Has drilldown state");
  assert(contains(src, "<MarketingDrilldownSheet"), "Renders MarketingDrilldownSheet");

  assert(contains(src, "metric: \"audience_contacts\""), "Audience recipient count opens drilldown");
  assert(contains(src, "extraParams: { segment_id: seg.id }"), "Audience passes segment_id extraParam");
  assert(contains(src, "audience-count-"), "Audience count buttons have testids");
  assert(contains(src, "contacts →"), "Audience count shows clickable affordance");
  assert(contains(src, "text-primary hover:text-primary"), "Audience count styled as primary link");
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(55)}`);
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log(`\nFailed assertions:`);
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
} else {
  console.log(`\nAll Marketing Drilldown tests passed ✓`);
  process.exit(0);
}
