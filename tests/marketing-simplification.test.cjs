#!/usr/bin/env node
/**
 * Marketing Simplification — Phase 11 Regression Tests
 *
 * Pins the Phase 11 changes:
 *   - Marketing nav has exactly 6 items (Dashboard, Campaigns, Audiences,
 *     Replies, Hot Accounts, Compliance)
 *   - Templates, Analytics, Suppression are NOT in the primary nav
 *   - Marketing Dashboard page exists and has required sections
 *   - Hot Accounts page exists as a standalone route
 *   - automation_mode selector exists in the campaign create dialog
 *   - Advanced sections are behind the advanced tab in campaign-detail
 *   - CampaignROISection call is removed from analytics render
 */

"use strict";

const fs   = require("fs");
const path = require("path");

const NAV_FILE        = path.join(__dirname, "../client/src/lib/nav-config.ts");
const APP_FILE        = path.join(__dirname, "../client/src/App.tsx");
const CAMPAIGNS_FILE  = path.join(__dirname, "../client/src/pages/marketing-campaigns.tsx");
const DETAIL_FILE     = path.join(__dirname, "../client/src/pages/campaign-detail.tsx");
const ANALYTICS_FILE  = path.join(__dirname, "../client/src/pages/marketing-analytics.tsx");
const DASHBOARD_FILE  = path.join(__dirname, "../client/src/pages/marketing-dashboard.tsx");
const HOT_FILE        = path.join(__dirname, "../client/src/pages/marketing-hot-accounts.tsx");

const nav       = fs.readFileSync(NAV_FILE,        "utf8");
const app       = fs.readFileSync(APP_FILE,         "utf8");
const campaigns = fs.readFileSync(CAMPAIGNS_FILE,   "utf8");
const detail    = fs.readFileSync(DETAIL_FILE,      "utf8");
const analytics = fs.readFileSync(ANALYTICS_FILE,   "utf8");
const dashboard = fs.readFileSync(DASHBOARD_FILE,   "utf8");
const hot       = fs.readFileSync(HOT_FILE,         "utf8");

let passed = 0;
let failed = 0;

function ok(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

// ── Extract marketing section text ────────────────────────────────────────────
function marketingSectionText() {
  const start = nav.indexOf('id: "marketing"');
  if (start === -1) return "";
  // Grab ~800 chars from the section start — enough to cover all 6 items
  return nav.slice(start, start + 1200);
}
const mSec = marketingSectionText();

// ── 1. Nav structure ─────────────────────────────────────────────────────────
console.log("\nMarketing nav structure:");

ok('Marketing section exists (id: "marketing")',
  mSec.length > 0);

ok("Dashboard is the first marketing nav item",
  mSec.includes('"marketing-dashboard"') &&
  mSec.indexOf('"marketing-dashboard"') < mSec.indexOf('"marketing-campaigns"'),
  "Dashboard must precede Campaigns");

ok("marketing-dashboard route is /marketing/dashboard",
  mSec.includes('"/marketing/dashboard"') || mSec.includes("'/marketing/dashboard'"));

ok("marketing-hot-accounts item exists",
  mSec.includes('"marketing-hot-accounts"'));

ok("Hot Accounts route is /marketing/hot-accounts",
  mSec.includes('"/marketing/hot-accounts"') || mSec.includes("'/marketing/hot-accounts'"));

// Count marketing child items
const itemMatches = [...mSec.matchAll(/id: "marketing-[^"]+"/g)];
ok(`Marketing nav has exactly 6 items (found ${itemMatches.length})`,
  itemMatches.length === 6,
  `Items: ${itemMatches.map(m => m[0]).join(", ")}`);

ok("Templates is NOT a primary marketing nav item",
  !mSec.includes('"marketing-templates"'),
  "marketing-templates must be removed from primary nav");

ok("Analytics is NOT a primary marketing nav item",
  !mSec.includes('"marketing-analytics"'),
  "marketing-analytics must be removed from primary nav");

ok("Suppression is NOT a primary marketing nav item",
  !mSec.includes('"marketing-suppression"'),
  "marketing-suppression must be removed from primary nav");

// ── 2. App.tsx routes ─────────────────────────────────────────────────────────
console.log("\nApp.tsx route registrations:");

ok("MarketingDashboardPage is lazily imported in App.tsx",
  app.includes("MarketingDashboardPage") || app.includes("marketing-dashboard"),
  "lazy import must exist");

ok("MarketingHotAccountsPage is lazily imported in App.tsx",
  app.includes("MarketingHotAccountsPage") || app.includes("marketing-hot-accounts"),
  "lazy import must exist");

ok("/marketing/dashboard route is registered",
  app.includes('"/marketing/dashboard"') || app.includes("'/marketing/dashboard'"));

ok("/marketing/hot-accounts route is registered",
  app.includes('"/marketing/hot-accounts"') || app.includes("'/marketing/hot-accounts'"));

ok("/marketing redirect targets /marketing/dashboard",
  app.includes("/marketing/dashboard"));

// ── 3. Marketing Dashboard page ───────────────────────────────────────────────
console.log("\nMarketing Dashboard page:");

ok("dashboard page exports default function",
  dashboard.includes("export default function"));

ok("dashboard page has data-testid=campaign-health or campaign health section",
  dashboard.includes("campaign-health") || dashboard.includes("Campaign Health"),
  "Campaign Health section required");

ok("dashboard page has hot accounts section",
  dashboard.includes("hot-account") || dashboard.includes("Hot Account") || dashboard.includes("account-heat"),
  "Hot Accounts section required");

ok("dashboard page uses /api/marketing/account-heat endpoint",
  dashboard.includes("/api/marketing/account-heat"),
  "must use correct account-heat endpoint");

// ── 4. Hot Accounts page ──────────────────────────────────────────────────────
console.log("\nHot Accounts page:");

ok("hot-accounts page exports default function",
  hot.includes("export default function"));

ok("hot-accounts page has heat filter chips (data-testid heat-filter-*)",
  hot.includes("heat-filter-") || hot.includes("heatLabel"),
  "heat filter chips required");

ok("hot-accounts page uses /api/marketing/account-heat",
  hot.includes("/api/marketing/account-heat"),
  "must use correct endpoint");

ok("hot-accounts page has expandable rows",
  hot.includes("expanded") || hot.includes("ChevronDown") || hot.includes("chevron"),
  "expandable row state required");

// ── 5. automation_mode in campaigns create dialog ─────────────────────────────
console.log("\nAutomation mode in campaign create dialog:");

ok("automationMode field in create form state",
  campaigns.includes("automationMode"),
  "automationMode must be in the form state object");

ok("select-automation-mode data-testid present",
  campaigns.includes('data-testid="select-automation-mode"') ||
  campaigns.includes("select-automation-mode"),
  "data-testid required for test targeting");

ok('automation_mode default is "manual"',
  campaigns.includes('"manual"') && campaigns.includes("automationMode"),
  "default must be manual");

ok("automationMode includes manual/assisted/full options",
  campaigns.includes('"manual"') &&
  campaigns.includes('"assisted"') &&
  campaigns.includes('"full"'),
  "all three options required");

ok("form reset includes automationMode: manual",
  campaigns.includes("automationMode: \"manual\""),
  "reset form must include automationMode");

// ── 6. Campaign detail tabs ────────────────────────────────────────────────────
console.log("\nCampaign detail tab structure:");

ok("activeTab state declared in CampaignDetailPage",
  detail.includes("activeTab") && detail.includes("setActiveTab"),
  "useState for activeTab required");

ok("campaign-detail-tabs data-testid present",
  detail.includes('data-testid="campaign-detail-tabs"'),
  "tab bar must have testid");

ok("overview tab is generated (template literal or literal testid)",
  detail.includes('"tab-overview"') || detail.includes("'tab-overview'") ||
  detail.includes('tab-${tab}') || detail.includes('"overview"'),
  "overview tab value must appear in tab bar render");

ok("advanced tab is generated (template literal or literal testid)",
  detail.includes('"tab-advanced"') || detail.includes("'tab-advanced'") ||
  detail.includes('tab-${tab}') || detail.includes('"advanced"'),
  "advanced tab value must appear in tab bar render");

ok("compliance tab is generated (template literal or literal testid)",
  detail.includes('"tab-compliance"') || detail.includes("'tab-compliance'") ||
  detail.includes('tab-${tab}') || detail.includes('"compliance"'),
  "compliance tab value must appear in tab bar render");

ok("BranchingRulesPanel is behind advanced tab",
  (() => {
    const advIdx  = detail.indexOf('activeTab === "advanced"');
    const branchIdx = detail.indexOf("BranchingRulesPanel");
    return advIdx > -1 && branchIdx > advIdx;
  })(),
  "BranchingRulesPanel must appear after activeTab==='advanced' check");

ok("attribution tab is generated (template literal or literal testid)",
  detail.includes('"tab-attribution"') || detail.includes("'tab-attribution'") ||
  detail.includes('tab-${tab}') || detail.includes('"attribution"'),
  "attribution tab value must appear in tab bar render");

ok("CampaignAttributionSection is behind its own dedicated attribution tab (not advanced)",
  (() => {
    const attrTabIdx = detail.indexOf('activeTab === "attribution"');
    const attrIdx = detail.indexOf("CampaignAttributionSection");
    const defIdx  = detail.indexOf("function CampaignAttributionSection");
    return attrTabIdx > -1 && attrIdx > attrTabIdx && attrIdx < defIdx;
  })(),
  "CampaignAttributionSection usage must be behind its own activeTab==='attribution' check (Phase 10 UI review moved it off the advanced tab)");

ok("BranchingRulesPanel remains the only panel behind advanced tab (attribution moved out)",
  (() => {
    const advIdx = detail.indexOf('activeTab === "advanced"');
    const defIdx = detail.indexOf("function CampaignAttributionSection");
    const advancedBlock = defIdx > -1 ? detail.slice(advIdx, defIdx) : detail.slice(advIdx);
    return advIdx > -1 && !advancedBlock.includes("CampaignAttributionSection");
  })(),
  "advanced tab block must no longer render CampaignAttributionSection");

ok("automationMode field on Campaign type",
  detail.includes("automationMode"),
  "Campaign type must include automationMode field");

ok("automation-mode-badge data-testid present",
  detail.includes("automation-mode-badge"),
  "automation mode badge testid required");

// ── 7. Analytics ROI section (Phase 10: re-added as CampaignRoiAttributionSection) ──
console.log("\nMarketing Analytics cleanup:");

ok("legacy <CampaignROISection /> call is NOT rendered in analytics",
  !analytics.includes("<CampaignROISection />") && !analytics.includes("<CampaignROISection/>"),
  "legacy ROI section must not be called in render (superseded by CampaignRoiAttributionSection)");

ok("<CampaignRoiAttributionSection /> IS rendered in analytics (Phase 10)",
  analytics.includes("<CampaignRoiAttributionSection />") || analytics.includes("<CampaignRoiAttributionSection/>"),
  "Phase 10 Campaign ROI / Pipeline Attribution section must be rendered in Marketing Analytics");

ok("AutomationMetricsSection is still present in analytics",
  analytics.includes("AutomationMetricsSection"),
  "AutomationMetricsSection must be retained");

ok("HotAccountsSection is still present in analytics",
  analytics.includes("HotAccountsSection"),
  "HotAccountsSection must be retained in analytics");

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n─────────────────────────────────`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error(`\n✗ ${failed} check(s) failed — see above\n`);
  process.exit(1);
} else {
  console.log(`\n✓ All marketing simplification checks passed\n`);
}
