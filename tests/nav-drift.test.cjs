#!/usr/bin/env node
/**
 * Nav Drift Regression Test
 * Source-grep checks that prevent known nav drift bugs from returning.
 * Run with: node tests/nav-drift.test.cjs
 *
 * Phase 1 (2026-06-27): Wrong-page routing, duplicate items, admin mismatch,
 *   Channels → Ecosystem rename.
 * Phase 2 (2026-06-27): Label clarifications (Document Hub, Knowledge Assets,
 *   Digest Settings, Relationship Intelligence, Government & Grants).
 * Phase 3 (2026-06-27): More group obvious moves — Support Tickets, Winter
 *   Support, Territory Routing → Operations; Daily Execution → Work;
 *   Price Lists → Pipeline.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const NAV_FILE  = path.join(__dirname, "../client/src/lib/nav-config.ts");
const DOCS_FILE = path.join(__dirname, "../client/src/pages/documents.tsx");

const src     = fs.readFileSync(NAV_FILE,  "utf8");
const docsSrc = fs.readFileSync(DOCS_FILE, "utf8");

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

// ── helpers ───────────────────────────────────────────────────────────────────

/** Extract the raw text of a named section (id: "xxx") from NAV_CONFIG. */
function sectionText(id) {
  // Match from the opening brace that contains id: "<id>" up to the matching
  // closing brace+comma (end of the section object in the top-level array).
  // We look for id: "<id>" within ~80 chars of a line that starts the object,
  // then capture until the next top-level `},` or `},\n`.
  const pattern = new RegExp(
    `id: "${id}"[\\s\\S]*?(?=\\n  (?:\\{|//|\\])|\\n\\])`,
    "m"
  );
  const m = src.match(pattern);
  return m ? m[0] : "";
}

const workSection      = sectionText("work");
const pipelineSection  = sectionText("pipeline");
const opsSection       = sectionText("operations");
const insightsSection  = sectionText("insights");
const learnSection     = sectionText("learn");
const adminSection     = sectionText("admin");
const moreSection      = sectionText("more"); // expected to be empty after Phase 4E
const channelsSection  = sectionText("channels");
const currentsSection  = sectionText("currents");

// ── Phase 1: Wrong-route guards ───────────────────────────────────────────────
console.log("\nPhase 1 — Wrong-page nav item drift fixes:");

ok("No nav item routes to /intelligence/signals",
  !src.includes('route: "/intelligence/signals"'),
  "Signals & Alerts was wired to ActivityFeedPage");

ok("No nav item routes to /intelligence/briefs",
  !src.includes('route: "/intelligence/briefs"'),
  "Meeting Briefs was wired to TodayPage");

ok("No nav item routes to /execution/forecast",
  !src.includes('route: "/execution/forecast"'),
  "Forecasting was wired to PipelinePage");

// ── Phase 1: Duplicate Reports ────────────────────────────────────────────────
console.log("\nPhase 1 — Duplicate nav item (Reports = Rel. Intelligence):");

ok("No nav item routes to /relationships (duplicate Reports entry)",
  !src.includes('route: "/relationships"'),
  '"Reports" duplicated Rel. Intelligence');

ok("Relationship Intelligence canonical entry exists (/intelligence/rel-intelligence)",
  src.includes('route: "/intelligence/rel-intelligence"'),
  "Canonical Relationship Intelligence nav item must remain");

// ── Phase 1: Admin section mismatch ──────────────────────────────────────────
console.log("\nPhase 1 — adminOnly:false items stranded inside Admin section:");

ok("Email Signatures not marked adminOnly:false inside Admin group",
  !src.match(/id: "admin-signatures"[\s\S]{0,120}adminOnly: false/),
  '"admin-signatures" with adminOnly:false hidden from non-admin users');

ok("AI Voice Profiles not marked adminOnly:false inside Admin group",
  !src.match(/id: "admin-voice-profiles"[\s\S]{0,120}adminOnly: false/),
  '"admin-voice-profiles" with adminOnly:false hidden from non-admin users');

ok("Email Signatures route (/settings/signatures) exists in nav",
  src.includes('route: "/settings/signatures"'));

ok("AI Voice Profiles route (/settings/voice-profiles) exists in nav",
  src.includes('route: "/settings/voice-profiles"'));

// Email Signatures + AI Voice Profiles moved to Settings section (Phase 2L cleanup)
const settingsSection = sectionText("settings");

ok("Email Signatures is in Settings group (moved from Work)",
  settingsSection.includes('/settings/signatures'),
  "Email Signatures should be in Settings, not Work or Admin");

ok("AI Voice Profiles is in Settings group (moved from Work)",
  settingsSection.includes('/settings/voice-profiles'),
  "AI Voice Profiles should be in Settings, not Work or Admin");

ok("Email Signatures NOT in Work group after move",
  !workSection.includes('/settings/signatures'),
  "Email Signatures should no longer be in Work submenu");

ok("AI Voice Profiles NOT in Work group after move",
  !workSection.includes('/settings/voice-profiles'),
  "AI Voice Profiles should no longer be in Work submenu");

// ── Phase 1: Channels → Ecosystem ────────────────────────────────────────────
console.log("\nPhase 1 — Channels group label rename:");

ok('Channels section label is "Ecosystem"',
  channelsSection.includes('label: "Ecosystem"'),
  'Should be "Ecosystem" to avoid CURRENTS collision');

ok('Channels section label is NOT "Channels"',
  !channelsSection.includes('label: "Channels"'),
  '"Channels" conflicts with CURRENTS messaging');

// ── Phase 2: Label clarifications ────────────────────────────────────────────
console.log("\nPhase 2 — Label clarification renames:");

ok('"Asset Library" label is gone from nav',
  !src.includes('label: "Asset Library"'));

ok('"Document Hub" label exists in nav',
  src.includes('label: "Document Hub"'));

ok("Document Hub route is /documents (unchanged)",
  src.match(/label: "Document Hub"[\s\S]{0,50}route: "\/documents"/) !== null);

ok('"Assets" bare label is gone from nav',
  !src.match(/label: "Assets"[^a-zA-Z]/));

ok('"Knowledge Assets" label exists in nav',
  src.includes('label: "Knowledge Assets"'));

ok("Knowledge Assets route is /knowledge/assets (unchanged)",
  src.match(/label: "Knowledge Assets"[\s\S]{0,60}route: "\/knowledge\/assets"/) !== null);

ok('"Digest & Alerts" label is gone from nav',
  !src.includes('label: "Digest & Alerts"'));

ok('"Digest Settings" label exists in nav',
  src.includes('label: "Digest Settings"'));

ok("Digest Settings route is /alerts-digest (unchanged)",
  src.match(/label: "Digest Settings"[\s\S]{0,60}route: "\/alerts-digest"/) !== null);

ok('"Rel. Intelligence" abbreviation is gone from nav',
  !src.includes('label: "Rel. Intelligence"'));

ok('"Relationship Intelligence" label exists in nav',
  src.includes('label: "Relationship Intelligence"'));

ok("Relationship Intelligence route is /intelligence/rel-intelligence (unchanged)",
  src.match(/label: "Relationship Intelligence"[\s\S]{0,80}route: "\/intelligence\/rel-intelligence"/) !== null);

ok('documents.tsx h1 shows "Document Hub" (not "Asset Library")',
  docsSrc.includes(">Document Hub<") && !docsSrc.includes(">Asset Library<"));

// ── Phase 3: More group obvious moves ────────────────────────────────────────
console.log("\nPhase 3 — More group obvious moves:");

// Daily Execution → Work
ok("Daily Execution is in Work group",
  workSection.includes('/execution/daily'),
  "Daily Execution belongs with day-to-day work tools");

ok("Daily Execution is NOT in More group",
  !moreSection.includes('/execution/daily'),
  "Should have been moved out of More");

ok("Daily Execution route is /execution/daily (unchanged)",
  src.includes('route: "/execution/daily"'));

// Price Lists → Pipeline
ok("Price Lists is in Pipeline group",
  pipelineSection.includes('/price-lists'),
  "Price Lists supports sales/quoting workflow");

ok("Price Lists is NOT in More group",
  !moreSection.includes('/price-lists'),
  "Should have been moved out of More");

ok("Price Lists route is /price-lists (unchanged)",
  src.includes('route: "/price-lists"'));

// Territory Routing → Operations
ok("Territory Routing is in Operations group",
  opsSection.includes('/routing'),
  "Territory Routing is operational/geographic routing");

ok("Territory Routing is NOT in More group",
  !moreSection.includes('/routing'),
  "Should have been moved out of More");

ok("Territory Routing route is /routing (unchanged)",
  src.includes('route: "/routing"'));

// Support Tickets → Operations
ok("Support Tickets is in Operations group",
  opsSection.includes('/support/tickets'),
  "Support Tickets is operational/customer support workflow");

ok("Support Tickets is NOT in More group",
  !moreSection.includes('/support/tickets'),
  "Should have been moved out of More");

ok("Support Tickets route is /support/tickets (unchanged)",
  src.includes('route: "/support/tickets"'));

// Winter Support → Operations
ok("Winter Support is in Operations group",
  opsSection.includes('/winter'),
  "Winter Support is operational/seasonal workflow");

ok("Winter Support is NOT in More group",
  !moreSection.includes('/winter'),
  "Should have been moved out of More");

ok("Winter Support route is /winter (unchanged)",
  src.includes('route: "/winter"'));

// ── Phase 4A: Relationship Intelligence → Insights ───────────────────────────
console.log("\nPhase 4A — Relationship Intelligence moved to Insights:");

ok("Relationship Intelligence is in Insights group",
  insightsSection.includes('/intelligence/rel-intelligence'),
  "Should live under Insights, not More");

ok("Relationship Intelligence is NOT in More group",
  !moreSection.includes('/intelligence/rel-intelligence'),
  "Must be removed from More");

ok("Relationship Intelligence route is /intelligence/rel-intelligence (unchanged)",
  src.includes('route: "/intelligence/rel-intelligence"'));

ok('Relationship Intelligence label is still "Relationship Intelligence"',
  src.includes('label: "Relationship Intelligence"'));

// ── Phase 4B: Digest Settings → Work; Training + Help → Learn ────────────────
console.log("\nPhase 4B — Digest Settings to Work; Learn section created:");

ok("Digest Settings is in Work group",
  workSection.includes('/alerts-digest'),
  "Personal settings belong with Email Signatures and AI Voice Profiles");

ok("Digest Settings is NOT in More group",
  !moreSection.includes('/alerts-digest'),
  "Must be removed from More");

ok("Digest Settings route is /alerts-digest (unchanged)",
  src.includes('route: "/alerts-digest"'));

ok("Training is in Learn group",
  learnSection.includes('/training'),
  "Universal support content belongs in Learn");

ok("Training is NOT in More group",
  !moreSection.includes('/training'),
  "Must be removed from More");

ok("Training route is /training (unchanged)",
  src.includes('route: "/training"'));

ok("Help is in Learn group",
  learnSection.includes('/help'),
  "Universal support content belongs in Learn");

ok("Help is NOT in More group",
  !moreSection.includes('/help'),
  "Must be removed from More");

ok("Help route is /help (unchanged)",
  src.includes('route: "/help"'));

ok('Learn group exists with id "learn"',
  src.includes('id: "learn"'));

// ── Phase 4C: Revenue suite → Insights ───────────────────────────────────────
console.log("\nPhase 4C — Revenue Hub, Ops, Simulator moved to Insights:");

ok("Revenue Hub is in Insights group",
  insightsSection.includes('/revenue'),
  "Revenue Hub is an analytical tool, belongs in Insights");

ok("Revenue Hub is NOT in More group",
  !moreSection.includes('route: "/revenue"'),
  "Must be removed from More");

ok("Revenue Hub route is /revenue (unchanged)",
  src.includes('route: "/revenue"'));

ok("Revenue Ops is in Insights group",
  insightsSection.includes('/revenue-ops'),
  "Revenue Ops is an analytical tool, belongs in Insights");

ok("Revenue Ops is NOT in More group",
  !moreSection.includes('/revenue-ops'),
  "Must be removed from More");

ok("Revenue Ops route is /revenue-ops (unchanged)",
  src.includes('route: "/revenue-ops"'));

ok("Revenue Simulator is in Insights group",
  insightsSection.includes('/revenue-sim'),
  "Revenue Simulator is an analytical tool, belongs in Insights");

ok("Revenue Simulator is NOT in More group",
  !moreSection.includes('/revenue-sim'),
  "Must be removed from More");

ok("Revenue Simulator route is /revenue-sim (unchanged)",
  src.includes('route: "/revenue-sim"'));

// ── Phase 4D: Score Feedback → Insights; Data Quality → Operations ───────────
console.log("\nPhase 4D — Score Feedback to Insights; Data Quality to Operations:");

ok("Score Feedback is in Insights group",
  insightsSection.includes('/scores/feedback'),
  "Scoring intelligence belongs in Insights");

ok("Score Feedback is NOT in More group",
  !moreSection.includes('/scores/feedback'),
  "Must be removed from More");

ok("Score Feedback route is /scores/feedback (unchanged)",
  src.includes('route: "/scores/feedback"'));

ok("Data Quality is in Operations group",
  opsSection.includes('/data-quality'),
  "CRM data hygiene belongs in Operations");

ok("Data Quality is NOT in More group",
  !moreSection.includes('/data-quality'),
  "Must be removed from More");

ok("Data Quality route is /data-quality (unchanged)",
  src.includes('route: "/data-quality"'));

ok('Data Quality permKey:"crm" is unchanged',
  src.match(/id: "data-quality"[\s\S]{0,120}permKey: "crm"/) !== null);

// ── Phase 4E: Task Rules + Automations → Admin; More group retired ───────────
console.log("\nPhase 4E — Task Rules + Automations to Admin; More group retired:");

ok('More group (id: "more") no longer exists in NAV_CONFIG',
  !src.includes('id: "more"'),
  "More group must be fully removed");

ok("Task Rules standalone nav item removed from Admin (merged into Automations tab)",
  !adminSection.includes('/automation/tasks'),
  "Task Rules nav entry must be removed — functionality lives in Automations tab now");

ok("Task Rules route not in More group",
  !moreSection.includes('/automation/tasks'));

ok("Automations is in Admin group",
  adminSection.includes('/automations'),
  "Config/automation tools belong in Admin");

ok("Automations is NOT in More group",
  !moreSection.includes('/automations'));

ok("Automations route is /automations (unchanged)",
  src.includes('route: "/automations"'));

// ── Phase 4G: Task Rules merged into Automations tab ─────────────────────────
console.log("\nPhase 4G — Task Rules merged into Automations tab:");

const automationsSrc = require("fs").readFileSync(
  require("path").join(__dirname, "../client/src/pages/automations.tsx"), "utf8");
const appSrc = require("fs").readFileSync(
  require("path").join(__dirname, "../client/src/App.tsx"), "utf8");

ok('Automations page imports TaskRulesSettingsPage',
  automationsSrc.includes('import TaskRulesSettingsPage'),
  "automations.tsx must import the task-rules component");

ok('Automations page has tab-automations-* testid pattern',
  automationsSrc.includes('tab-automations-${t}') || automationsSrc.includes('tab-automations-builder'),
  "Tab buttons must have data-testid");

ok('Automations page renders both builder and task-rules tabs',
  automationsSrc.includes('"builder"') && automationsSrc.includes('"task-rules"'),
  "Both tab values must be present in source");

ok('Automations page renders <TaskRulesSettingsPage /> inside tab',
  automationsSrc.includes('<TaskRulesSettingsPage />'),
  "Task Rules content must be rendered in the tab panel");

ok('activeTab state controls tab switching',
  automationsSrc.includes('activeTab') && automationsSrc.includes('"task-rules"'),
  "Tab state must be present");

ok('/automation/tasks route still exists in App.tsx (backwards compat)',
  appSrc.includes('/automation/tasks'),
  "Standalone route kept for backwards compatibility");

ok('Admin nav has ≥8 items (Task Rules removed, Automations kept)',
  (() => {
    const adminMatch = src.match(/id:\s*"admin[\s\S]*?^\s*\]/m);
    if (!adminMatch) return false;
    const adminBlock = adminMatch[0];
    const itemMatches = [...adminBlock.matchAll(/\{\s*id:/g)];
    return itemMatches.length >= 9; // 1 group header + ≥8 items (signatures + knowledge added)
  })(),
  "Admin section should have at least 8 nav items after Task Rules removal");

// ── Phase 5A: CURRENTS promoted to top-level workspace ───────────────────────
console.log("\nPhase 5A — CURRENTS as dedicated top-level nav section:");

ok('CURRENTS top-level section exists with id "currents"',
  currentsSection.length > 0,
  'id: "currents" section not found in NAV_CONFIG');

ok('CURRENTS section label is "CURRENTS" (uppercase)',
  currentsSection.includes('"CURRENTS"'),
  'label must remain uppercase CURRENTS');

ok('CURRENTS section has url: "/current" (route unchanged)',
  currentsSection.includes('"/current"') || currentsSection.includes("'/current'"),
  'direct-link url must point to /current');

ok("CURRENTS is NOT a child item of Work group",
  !workSection.includes('"/current"'),
  'route: "/current" must be removed from Work items');

ok("CURRENTS section appears before Work in nav order",
  (() => {
    const ci = src.indexOf('id: "currents"');
    const wi = src.indexOf('id: "work"');
    return ci > -1 && wi > -1 && ci < wi;
  })(),
  "currents block must precede work block");

ok("CURRENTS section appears after Today in nav order",
  (() => {
    const ti = src.indexOf('id: "today"');
    const ci = src.indexOf('id: "currents"');
    return ti > -1 && ci > -1 && ci > ti;
  })(),
  "currents block must follow today block");

ok('More group (id: "more") still does not exist',
  !src.includes('id: "more"'),
  "More group must remain retired");

// ── Phase 11: Marketing nav simplification ────────────────────────────────────
console.log("\nPhase 11 — Marketing nav (6 items, Dashboard first):");

const marketingStart = src.indexOf('id: "marketing"');
const marketingSec   = marketingStart > -1 ? src.slice(marketingStart, marketingStart + 1400) : "";

ok('Marketing section (id: "marketing") exists',
  marketingSec.length > 0);

ok("marketing-dashboard is a child item",
  marketingSec.includes('"marketing-dashboard"'));

ok("marketing-dashboard route is /marketing/dashboard",
  marketingSec.includes('"/marketing/dashboard"') || marketingSec.includes("'/marketing/dashboard'"));

ok("marketing-hot-accounts is a child item",
  marketingSec.includes('"marketing-hot-accounts"'));

ok("marketing-hot-accounts route is /marketing/hot-accounts",
  marketingSec.includes('"/marketing/hot-accounts"') || marketingSec.includes("'/marketing/hot-accounts'"));

ok("Marketing nav has exactly 7 child items",
  (() => {
    const items = [...marketingSec.matchAll(/id: "marketing-[^"]+"/g)];
    return items.length === 7;
  })(),
  "Expected: Dashboard, Campaigns, Audiences, Hot Accounts, Engagement, Compliance, Email Tools");

ok("marketing-templates NOT a primary nav item (removed in Phase 11)",
  !marketingSec.includes('"marketing-templates"'));

ok("marketing-analytics NOT a primary nav item (removed in Phase 11)",
  !marketingSec.includes('"marketing-analytics"'));

ok("marketing-suppression NOT a primary nav item (removed in Phase 11)",
  !marketingSec.includes('"marketing-suppression"'));

// ── Phase 1–4G: Duplicate route guard ────────────────────────────────────────
console.log("\nPhase 1–4G — Duplicate routes in NAV_CONFIG:");

const routeMatches   = [...src.matchAll(/route: "([^"]+)"/g)];
const routes         = routeMatches.map(m => m[1]);
const routeCounts    = {};
for (const r of routes) routeCounts[r] = (routeCounts[r] || 0) + 1;
const duplicateRoutes = Object.entries(routeCounts)
  .filter(([, count]) => count > 1)
  .map(([r]) => r);

ok(`No duplicate routes in NAV_CONFIG (found ${duplicateRoutes.length} duplicates)`,
  duplicateRoutes.length === 0,
  duplicateRoutes.length > 0 ? `Duplicate routes: ${duplicateRoutes.join(", ")}` : "");

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n─────────────────────────────────`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error(`\n✗ ${failed} nav drift check(s) failed — see above\n`);
  process.exit(1);
} else {
  console.log(`\n✓ All nav drift checks passed\n`);
}
