// tests/nav-consolidation.test.cjs
// Source-grep tests for the Navigation Consolidation Pass.
// Verifies: nav structure, item counts, new hub pages, routes, search, permissions.

const fs   = require("fs");
const path = require("path");
const { execSync } = require("child_process");

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

function grep(pattern, file) {
  try {
    const count = execSync(`grep -c "${pattern}" ${file}`, { cwd: path.join(__dirname, "..") }).toString().trim();
    return Number(count) >= 1;
  } catch { return false; }
}

// ── 1. nav-config.ts structure ────────────────────────────────────────────────
console.log("\n[1] nav-config.ts — section labels and item counts");
{
  const src = readFile("client/src/lib/nav-config.ts");

  // Section labels
  assert(contains(src, 'label: "Work"'),       "Work section exists");
  assert(contains(src, 'label: "Pipeline"'),   "Pipeline section exists");
  assert(contains(src, 'label: "Operations"'), "Operations section exists");
  assert(contains(src, 'label: "Insights"'),   "Insights section exists");
  assert(contains(src, 'label: "Ecosystem"'),  "Ecosystem section exists");
  assert(contains(src, 'label: "Marketing"'),  "Marketing section exists");
  assert(contains(src, 'label: "Capital"'),    "Capital section exists");
  assert(contains(src, 'label: "Learn"'),      "Learn section exists");
  assert(contains(src, 'label: "Admin"'),      "Admin section exists");

  // capitalOnly still on Capital section
  assert(contains(src, "capitalOnly: true"),   "Capital section has capitalOnly: true");

  // DesktopNavSection now has capitalOnly field
  assert(contains(src, "capitalOnly?: boolean"), "DesktopNavSection type has capitalOnly field");

  // getDesktopSections maps capitalOnly
  assert(contains(src, "capitalOnly: s.capitalOnly"), "getDesktopSections maps capitalOnly");

  // PAGE_NAV_INDEX exported
  assert(contains(src, "export const PAGE_NAV_INDEX"), "PAGE_NAV_INDEX exported");
  assert(contains(src, "export type PageNavEntry"),    "PageNavEntry type exported");

  // Work items (6)
  const workItems = [
    ["mission-control",  "Mission Control"],
    ["inbox",            "Inbox & Mail"],
    ["tasks",            "Tasks & Execution"],
    ["calendar",         "Calendar & Meetings"],
    ["my-travel",        "Travel"],
    ["personal-settings","Personal Settings"],
  ];
  for (const [id, label] of workItems) {
    assert(contains(src, `id: "${id}"`), `Work item "${id}" exists`);
    assert(contains(src, `"${label}"`), `Work item label "${label}" exists`);
  }

  // Work removed items NOT in nav (no route entry in items array)
  // Work Calendar, Meeting Notes, etc. should not appear as nav item routes
  // (They can appear in PAGE_NAV_INDEX — we check for that below)
  assert(!contains(src, 'id: "work-calendar"'),   "Work Calendar removed from sidebar items");
  assert(!contains(src, 'id: "meeting-notes"'),   "Meeting Notes removed from sidebar items");
  assert(!contains(src, 'id: "activity"'),         "Activity Feed removed from sidebar items");
  assert(!contains(src, 'id: "email-signatures"'), "Email Signatures removed from sidebar items");
  assert(!contains(src, 'id: "ai-voice-profiles"'),"AI Voice Profiles removed from sidebar items");
  assert(!contains(src, 'id: "daily-execution"'),  "Daily Execution removed from sidebar items");
  assert(!contains(src, 'id: "digest-alerts"'),    "Digest Settings removed from sidebar items");

  // Pipeline items (6)
  const pipelineItems = [
    ["pipeline",        "Snapshot"],
    ["leads-accounts",  "Leads & Accounts"],
    ["contacts",        "Contacts"],
    ["quotes-renewals", "Quotes & Renewals"],
    ["outreach",        "Outreach"],
    ["revenue-tools",   "Revenue Tools"],
  ];
  for (const [id, label] of pipelineItems) {
    assert(contains(src, `id: "${id}"`), `Pipeline item "${id}" exists`);
    assert(contains(src, `"${label}"`), `Pipeline item label "${label}" exists`);
  }

  // Pipeline removed items
  assert(!contains(src, 'id: "accounts"'),          "Accounts removed as separate nav item");
  assert(!contains(src, 'id: "renewals"'),           "Renewals removed as separate nav item");
  assert(!contains(src, 'id: "booking-analytics"'),  "Booking Analytics removed from sidebar");
  assert(!contains(src, 'id: "notes"'),              "Notes removed from sidebar");
  assert(!contains(src, 'id: "won"'),                "Accounts Won removed from sidebar");
  assert(!contains(src, 'id: "price-lists"'),        "Price Lists id renamed to revenue-tools");

  // Operations items (6)
  const opsItems = [
    ["install-deployments",  "Install & Deployments"],
    ["projects",             "Projects"],
    ["procurement",          "Procurement"],
    ["support",              "Support"],
    ["knowledge-documents",  "Knowledge & Documents"],
    ["data-quality",         "Data Quality"],
  ];
  for (const [id, label] of opsItems) {
    assert(contains(src, `id: "${id}"`), `Operations item "${id}" exists`);
    assert(contains(src, `"${label}"`), `Operations item label "${label}" exists`);
  }

  // Operations removed items
  assert(!contains(src, 'id: "install-workflows"'), "install-workflows renamed to install-deployments");
  assert(!contains(src, 'id: "deployments"'),        "Deployments removed from sidebar");
  assert(!contains(src, 'id: "events"'),             "Events removed from sidebar");
  assert(!contains(src, 'id: "communications"'),     "Communications removed from sidebar");
  assert(!contains(src, 'id: "documents"'),          "documents id renamed to knowledge-documents");
  assert(!contains(src, 'id: "assets"'),             "Knowledge Assets removed from sidebar");
  assert(!contains(src, 'id: "territory-routing"'),  "Territory Routing removed from sidebar");
  assert(!contains(src, 'id: "tickets"'),            "tickets id renamed to support");
  assert(!contains(src, 'id: "winter-support"'),     "Winter Support removed from sidebar");

  // Insights items (6)
  const insightsItems = [
    ["exec-dashboard",       "Executive Dashboard"],
    ["revenue-intelligence", "Revenue Intelligence"],
    ["attribution",          "Attribution"],
    ["rel-intelligence",     "Relationship Intel"],
    ["cortex",               "Cortex"],
    ["simulators-feedback",  "Simulators & Feedback"],
  ];
  for (const [id, label] of insightsItems) {
    assert(contains(src, `id: "${id}"`), `Insights item "${id}" exists`);
    assert(contains(src, `"${label}"`), `Insights item label "${label}" exists`);
  }

  // Insights removed items
  assert(!contains(src, 'id: "source-attribution"'),  "source-attribution renamed to attribution");
  assert(!contains(src, 'id: "copilot"'),              "copilot renamed to cortex");
  assert(!contains(src, 'id: "cortex-intel-library"'),"cortex-intel-library removed from sidebar");
  assert(!contains(src, 'id: "territory"'),            "territory removed from sidebar");
  assert(!contains(src, 'id: "revenue-hub"'),          "revenue-hub removed from sidebar");
  assert(!contains(src, 'id: "revenue-ops"'),          "revenue-ops removed from sidebar");
  assert(!contains(src, 'id: "revenue-sim"'),          "revenue-sim id removed (now simulators-feedback)");
  assert(!contains(src, 'id: "score-feedback"'),       "score-feedback removed from sidebar");

  // Ecosystem items (5)
  const ecoItems = [
    ["partners",     "Partners"],
    ["channels",     "Channels"],
    ["govt",         "Government & Grants"],
    ["referrals",    "Referrals"],
    ["events-media", "Events & Media"],
  ];
  for (const [id, label] of ecoItems) {
    assert(contains(src, `id: "${id}"`), `Ecosystem item "${id}" exists`);
    assert(contains(src, `"${label}"`), `Ecosystem item label "${label}" exists`);
  }

  // Ecosystem: alliances removed, industry/dealers/media renamed
  assert(!contains(src, 'id: "alliances"'), "Strategic Alliances removed from sidebar");
  assert(!contains(src, 'id: "industry"'),  "industry renamed to partners");
  assert(!contains(src, 'id: "dealers"'),   "dealers renamed to channels");
  assert(!contains(src, 'id: "media"'),     "media renamed to events-media");

  // Marketing items (5)
  const mktItems = [
    ["marketing-dashboard",  "Dashboard"],
    ["marketing-campaigns",  "Campaigns"],
    ["marketing-audiences",  "Audiences"],
    ["marketing-engagement", "Engagement"],
    ["marketing-compliance", "Compliance"],
  ];
  for (const [id, label] of mktItems) {
    assert(contains(src, `id: "${id}"`), `Marketing item "${id}" exists`);
  }

  // Marketing: Replies + Hot Accounts removed as separate items
  assert(!contains(src, 'id: "marketing-replies"'),      "marketing-replies removed from sidebar");
  assert(!contains(src, 'id: "marketing-hot-accounts"'), "marketing-hot-accounts removed from sidebar");
  assert(contains(src, 'route: "/marketing/engagement"'),"Marketing Engagement hub route wired");

  // Capital items (6, capitalOnly)
  const capItems = [
    ["capital-command-center", "Command Center"],
    ["capital-investors",      "Investors"],
    ["capital-rounds",         "Rounds & Commitments"],
    ["capital-follow-ups",     "Follow-Ups"],
    ["capital-data-room",      "Data Room"],
    ["capital-updates",        "Updates & Reviews"],
  ];
  for (const [id, label] of capItems) {
    assert(contains(src, `id: "${id}"`), `Capital item "${id}" exists`);
    assert(contains(src, `"${label}"`), `Capital item label "${label}" exists`);
  }

  // Capital removed items
  assert(!contains(src, 'id: "capital-dashboard"'),   "capital-dashboard removed from sidebar");
  assert(!contains(src, 'id: "capital-targets"'),     "capital-targets removed from sidebar");
  assert(!contains(src, 'id: "capital-contacts"'),    "capital-contacts removed from sidebar");
  assert(!contains(src, 'id: "capital-commitments"'), "capital-commitments removed from sidebar");
  assert(!contains(src, 'id: "capital-grants"'),      "capital-grants removed from sidebar");
  assert(!contains(src, 'id: "capital-email-review"'),"capital-email-review removed from sidebar");

  // Admin items (5)
  const adminItems = [
    ["admin-users",        "Users & Roles"],
    ["admin-integrations", "Integrations"],
    ["admin-mailboxes",    "Mailboxes & Signatures"],
    ["admin-settings",     "System Settings"],
    ["automations",        "Automations"],
  ];
  for (const [id, label] of adminItems) {
    assert(contains(src, `id: "${id}"`), `Admin item "${id}" exists`);
    assert(contains(src, `"${label}"`), `Admin item label "${label}" exists`);
  }

  // Admin removed items
  assert(!contains(src, 'id: "admin-task-access"'),   "admin-task-access removed from sidebar");
  assert(!contains(src, 'id: "admin-user-signatures"'),"admin-user-signatures removed from sidebar");
  assert(!contains(src, 'id: "admin-roles"'),          "admin-roles removed from sidebar");
  assert(!contains(src, 'id: "admin-search"'),         "admin-search removed from sidebar");
}

// ── 2. PAGE_NAV_INDEX — all old routes preserved ──────────────────────────────
console.log("\n[2] PAGE_NAV_INDEX — old page names findable via ⌘K");
{
  const src = readFile("client/src/lib/nav-config.ts");

  const oldPageNames = [
    "Work Calendar", "Meeting Notes", "Activity Feed",
    "Email Signatures", "AI Voice Profiles", "Digest Settings",
    "Booking Outreach", "Booking Analytics", "Accounts Won",
    "Renewals", "Notes",
    "Deployments", "Territory Routing", "Winter Support", "Communications",
    "Knowledge Assets",
    "Revenue Hub", "Revenue Ops", "Score Feedback",
    "Cortex Intel Library", "Executive Copilot",
    "Source Attribution", "Territory & Geo",
    "Strategic Alliances",
    "Media & Tradeshows",
    "Industry Partnerships", "Dealers",
    "Marketing Replies", "Hot Accounts",
    "Capital Dashboard", "Investor Pipeline", "Investor Targets",
    "Investor Contacts", "Funding Rounds", "Commitments",
    "Grants & Non-Dilutive", "Investor Updates",
    "Capital Email Review",
    "Task Hub Access", "Role Manager",
    "User Signatures", "Global Search",
  ];

  for (const name of oldPageNames) {
    assert(contains(src, name), `PAGE_NAV_INDEX contains old page name "${name}"`);
  }

  // All old routes present in index
  const oldRoutes = [
    "/work/team-calendar", "/meeting-notes", "/activity",
    "/settings/signatures", "/settings/voice-profiles", "/alerts-digest",
    "/booking-analytics", "/revenue/deals", "/renewals", "/notes",
    "/deployments", "/routing", "/winter",
    "/execution/communications", "/knowledge/assets",
    "/revenue", "/revenue-ops", "/scores/feedback",
    "/cortex/intel", "/geography",
    "/strategy/partnerships/manufacturing",
    "/strategy/partnerships/media-tradeshows",
    "/capital/dashboard", "/capital/targets", "/capital/contacts",
    "/capital/commitments", "/capital/grants", "/capital/email-review",
    "/admin/task-hub-access", "/admin/roles", "/admin/signatures", "/search",
  ];
  for (const route of oldRoutes) {
    assert(contains(src, `route: "${route}"`), `PAGE_NAV_INDEX has route "${route}"`);
  }

  // Partnership media-tradeshows is in PAGE_NAV_INDEX even though App.tsx uses
  // a catch-all :typeSlug route (not a literal path).  Verify it above.
}

// ── 3. All old routes still registered in App.tsx ─────────────────────────────
console.log("\n[3] App.tsx — all old routes still registered");
{
  const src = readFile("client/src/App.tsx");

  const routes = [
    "/work/team-calendar", "/meeting-notes", "/activity",
    "/settings/signatures", "/settings/voice-profiles", "/alerts-digest",
    "/booking-outreach", "/booking-analytics", "/revenue/deals", "/renewals",
    "/notes", "/deployments", "/routing", "/winter",
    "/execution/communications", "/knowledge/assets",
    "/revenue", "/revenue-sim", "/revenue-ops", "/scores/feedback",
    "/cortex/intel", "/geography",
    "/capital/dashboard", "/capital/targets", "/capital/contacts",
    "/capital/commitments", "/capital/grants", "/capital/email-review",
    "/admin/task-hub-access", "/admin/roles", "/admin/signatures", "/search",
    "/marketing/replies", "/marketing/hot-accounts",
  ];
  // Partnership sub-routes use a catch-all :typeSlug param in App.tsx — verify the parent route only
  assert(contains(src, '"/strategy/partnerships/:typeSlug"'), "App.tsx has partnerships catch-all route");

  for (const route of routes) {
    assert(contains(src, `"${route}"`), `App.tsx has route "${route}"`);
  }

  // New hub routes registered
  assert(contains(src, '"/marketing/engagement"'), "App.tsx has /marketing/engagement route");
  assert(contains(src, '"/settings/personal"'),    "App.tsx has /settings/personal route");

  // New page components imported
  assert(contains(src, "MarketingEngagementPage"), "MarketingEngagementPage imported");
  assert(contains(src, "PersonalSettingsPage"),    "PersonalSettingsPage imported");

  // Old redirects still present
  assert(contains(src, '"/tasks"'),        "App.tsx has /tasks redirect");
  assert(contains(src, '"/leads"'),        "App.tsx has /leads redirect");
  assert(contains(src, '"/tickets"'),      "App.tsx has /tickets redirect");
  assert(contains(src, '"/calendar"'),     "App.tsx has /calendar redirect");
  assert(contains(src, '"/automations"'),  "App.tsx has /automations route");
}

// ── 4. Marketing Engagement hub page ─────────────────────────────────────────
console.log("\n[4] marketing-engagement.tsx hub page");
{
  const ENGAGEMENT = "client/src/pages/marketing-engagement.tsx";
  assert(fs.existsSync(path.join(__dirname, "..", ENGAGEMENT)), "marketing-engagement.tsx exists");
  const src = readFile(ENGAGEMENT);

  assert(contains(src, "marketing-engagement-hub"), "Page has testid");
  assert(contains(src, "/marketing/replies"),        "Links to /marketing/replies");
  assert(contains(src, "/marketing/hot-accounts"),   "Links to /marketing/hot-accounts");
  assert(contains(src, "engagement-card-replies"),   "Replies card has testid");
  assert(contains(src, "engagement-card-hot-accounts"), "Hot Accounts card has testid");
  assert(contains(src, '"/marketing/dashboard"'),    "Quick link to Marketing Dashboard");
  assert(contains(src, "/marketing/campaigns"),      "Quick link to Campaigns");
  assert(contains(src, "Engagement"),                "Page title is Engagement");
  assert(contains(src, "Replies"),                   "Shows Replies label");
  assert(contains(src, "Hot Accounts"),              "Shows Hot Accounts label");
}

// ── 5. Personal Settings hub page ─────────────────────────────────────────────
console.log("\n[5] settings-personal.tsx hub page");
{
  const PERSONAL = "client/src/pages/settings-personal.tsx";
  assert(fs.existsSync(path.join(__dirname, "..", PERSONAL)), "settings-personal.tsx exists");
  const src = readFile(PERSONAL);

  assert(contains(src, "personal-settings-hub"),                "Page has testid");
  assert(contains(src, "/settings/signatures"),                  "Links to /settings/signatures");
  assert(contains(src, "/settings/voice-profiles"),              "Links to /settings/voice-profiles");
  assert(contains(src, "/alerts-digest"),                        "Links to /alerts-digest");
  assert(contains(src, "personal-settings-card-signatures"),     "Signatures card has testid");
  assert(contains(src, "personal-settings-card-voice-profiles"), "Voice Profiles card has testid");
  assert(contains(src, "personal-settings-card-digest"),         "Digest card has testid");
  assert(contains(src, "Personal Settings"),                     "Page title is Personal Settings");
  assert(contains(src, "Email Signatures"),                      "Shows Email Signatures label");
  assert(contains(src, "AI Voice Profiles"),                     "Shows AI Voice Profiles label");
  assert(contains(src, "Digest"),                                "Shows Digest label");
  assert(contains(src, 'href: "/settings"'),                     "Links to Account Settings");
}

// ── 6. global-search.tsx page navigation ─────────────────────────────────────
console.log("\n[6] global-search.tsx page navigation");
{
  const src = readFile("client/src/components/global-search.tsx");

  assert(contains(src, "PAGE_NAV_INDEX"),           "Imports PAGE_NAV_INDEX");
  assert(contains(src, "matchPageNav"),              "matchPageNav function exists");
  assert(contains(src, "pageNavResults"),            "Uses pageNavResults");
  assert(contains(src, "search-section-pages"),      "Pages section has testid");
  assert(contains(src, "search-result-page-"),       "Page results have testids");
  assert(contains(src, "Navigate to"),               "Shows 'Navigate to' section label");
  assert(contains(src, "aliases"),                   "matchPageNav checks aliases");
  assert(contains(src, "LayoutDashboard"),           "Page result uses LayoutDashboard icon");
  assert(contains(src, "Search pages, contacts"),    "Placeholder updated");
  assert(contains(src, "p.section"),                 "Shows section in result subtitle");
}

// ── 7. Permissions preserved ──────────────────────────────────────────────────
console.log("\n[7] Permissions preserved");
{
  const navSrc = readFile("client/src/lib/nav-config.ts");
  const sidebarSrc = readFile("client/src/components/dashboard/app-sidebar.tsx");

  // Capital still capitalOnly
  assert(contains(navSrc, "capitalOnly: true"), "Capital section still capitalOnly: true");
  assert(contains(sidebarSrc, "capitalOnly"),   "Sidebar still checks capitalOnly");

  // Pipeline still advisorHidden
  assert(contains(navSrc, 'id: "pipeline"') && contains(navSrc, "advisorHidden: true"),
    "Pipeline section still advisorHidden");

  // Admin routes still have adminOnly
  assert(contains(navSrc, 'id: "admin-users"') && contains(navSrc, "adminOnly: true"),
    "Admin items still have adminOnly: true");

  // permKey guards still in place
  assert(contains(navSrc, 'permKey: "crm"'),        "crm permKey still used");
  assert(contains(navSrc, 'permKey: "quoting"'),     "quoting permKey still used");
  assert(contains(navSrc, 'permKey: "projects"'),    "projects permKey still used");
  assert(contains(navSrc, 'permKey: "support"'),     "support permKey still used");
  assert(contains(navSrc, 'permKey: "calendar"'),    "calendar permKey still used");
  assert(contains(navSrc, 'permKey: "partnerships"'),"partnerships permKey still used");
}

// ── 8. No duplicate nav item IDs ──────────────────────────────────────────────
console.log("\n[8] No duplicate nav item IDs");
{
  const src = readFile("client/src/lib/nav-config.ts");
  const idMatches = [...src.matchAll(/\bid:\s*"([^"]+)"/g)].map(m => m[1]);
  const seen = new Set();
  const dupes = [];
  for (const id of idMatches) {
    if (seen.has(id)) dupes.push(id);
    seen.add(id);
  }
  assert(dupes.length === 0, `No duplicate nav item IDs (found: ${dupes.join(", ") || "none"})`);
}

// ── 9. Sidebar child count ≤7 per section ─────────────────────────────────────
console.log("\n[9] Sidebar child count ≤7 per section");
{
  const navSrc = readFile("client/src/lib/nav-config.ts");

  // Count items per section by splitting on section boundaries
  const sections = {
    work: 0, pipeline: 0, operations: 0, insights: 0,
    channels: 0, marketing: 0, capital: 0, learn: 0, admin: 0,
  };

  // Count id: entries between section markers
  const workBlock = navSrc.match(/id: "work"[\s\S]*?(?=id: "pipeline")/)?.[0] ?? "";
  sections.work = (workBlock.match(/\bid: "[^"]+"/g) ?? []).length - 1; // -1 for section id
  assert(sections.work <= 7, `Work has ≤7 items (has ${sections.work})`);

  const pipelineBlock = navSrc.match(/id: "pipeline"[\s\S]*?(?=id: "operations")/)?.[0] ?? "";
  sections.pipeline = (pipelineBlock.match(/\bid: "[^"]+"/g) ?? []).length - 1;
  assert(sections.pipeline <= 7, `Pipeline has ≤7 items (has ${sections.pipeline})`);

  const opsBlock = navSrc.match(/id: "operations"[\s\S]*?(?=id: "insights")/)?.[0] ?? "";
  sections.operations = (opsBlock.match(/\bid: "[^"]+"/g) ?? []).length - 1;
  assert(sections.operations <= 7, `Operations has ≤7 items (has ${sections.operations})`);

  const insightsBlock = navSrc.match(/id: "insights"[\s\S]*?(?=id: "channels")/)?.[0] ?? "";
  sections.insights = (insightsBlock.match(/\bid: "[^"]+"/g) ?? []).length - 1;
  assert(sections.insights <= 7, `Insights has ≤7 items (has ${sections.insights})`);

  const ecoBlock = navSrc.match(/id: "channels"[\s\S]*?(?=id: "marketing")/)?.[0] ?? "";
  sections.channels = (ecoBlock.match(/\bid: "[^"]+"/g) ?? []).length - 1;
  assert(sections.channels <= 7, `Ecosystem has ≤7 items (has ${sections.channels})`);

  const mktBlock = navSrc.match(/id: "marketing"[\s\S]*?(?=id: "capital")/)?.[0] ?? "";
  sections.marketing = (mktBlock.match(/\bid: "[^"]+"/g) ?? []).length - 1;
  assert(sections.marketing <= 7, `Marketing has ≤7 items (has ${sections.marketing})`);
  assert(sections.marketing === 5, `Marketing has exactly 5 items (has ${sections.marketing})`);

  const adminBlock = navSrc.match(/id: "admin"[\s\S]*?(?=\];\s*function projectLabel)/)?.[0] ?? "";
  sections.admin = (adminBlock.match(/\bid: "[^"]+"/g) ?? []).length - 1;
  assert(sections.admin <= 7, `Admin has ≤7 items (has ${sections.admin})`);
  assert(sections.admin === 5, `Admin has exactly 5 items (has ${sections.admin})`);
}

// ── 10. Hub pages link to correct sub-pages ───────────────────────────────────
console.log("\n[10] Hub page links verified");
{
  const engSrc = readFile("client/src/pages/marketing-engagement.tsx");
  assert(contains(engSrc, 'href="/marketing/replies"'),       "Engagement hub: replies link correct");
  assert(contains(engSrc, 'href="/marketing/hot-accounts"'),  "Engagement hub: hot-accounts link correct");
  assert(contains(engSrc, '"/marketing/dashboard"'),          "Engagement hub: dashboard quick link");

  const persSrc = readFile("client/src/pages/settings-personal.tsx");
  assert(contains(persSrc, 'href="/settings/signatures"'),    "Personal hub: signatures link correct");
  assert(contains(persSrc, 'href="/settings/voice-profiles"'),"Personal hub: voice-profiles link correct");
  assert(contains(persSrc, 'href="/alerts-digest"'),          "Personal hub: alerts-digest link correct");
  assert(contains(persSrc, 'href: "/settings"'),              "Personal hub: settings link correct");
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log(`\nFailed assertions:`);
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
} else {
  console.log(`\nAll Navigation Consolidation tests passed ✓`);
  process.exit(0);
}
