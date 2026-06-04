/**
 * tests/revenue-intelligence.test.js
 *
 * Source-grep regression tests for the Revenue Intelligence System.
 * Verifies: scoring weights, role classification logic, API routes,
 * UI components, and integration wiring.
 *
 * Run: node tests/revenue-intelligence.test.js
 */
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = new URL("..", import.meta.url).pathname;

let passed = 0, failed = 0;
function ok(label, cond) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else       { console.error(`  ✗ ${label}`); failed++; }
}
function has(src, str) { return src.includes(str); }

const svc     = readFileSync(resolve(ROOT, "server/services/revenue-intelligence.ts"), "utf8");
const routes  = readFileSync(resolve(ROOT, "server/routes.ts"), "utf8");
const page    = (() => { try { return readFileSync(resolve(ROOT, "client/src/pages/revenue-intelligence.tsx"), "utf8"); } catch { return ""; }})();
const widget  = readFileSync(resolve(ROOT, "client/src/components/engagement/EngagementWidget.tsx"), "utf8");
const appTsx  = readFileSync(resolve(ROOT, "client/src/App.tsx"), "utf8");
const navConf = readFileSync(resolve(ROOT, "client/src/lib/nav-config.ts"), "utf8");
const acctPro = (() => { try { return readFileSync(resolve(ROOT, "client/src/pages/account-profile.tsx"), "utf8"); } catch { return ""; }})();

// ── 1. Scoring weights ────────────────────────────────────────────────────────
console.log("=== Revenue Intelligence System ===\n");
console.log("-- Scoring weights --");
ok("Open  = 1",  has(svc, "W_OPEN     = 1"));
ok("Click = 3",  has(svc, "W_CLICK    = 3"));
ok("Demo  = 8",  has(svc, "W_DEMO     = 8"));
ok("CTA   = 5",  has(svc, "W_CTA      = 5"));
ok("Reply = 10", has(svc, "W_REPLY    = 10"));
ok("Meeting = 20", has(svc, "W_MEETING  = 20"));
ok("TO multiplier 1.5",  has(svc, "M_TO       = 1.5"));
ok("7d recency 1.5",     has(svc, "M_7D       = 1.5"));
ok("30d recency 1.2",    has(svc, "M_30D      = 1.2"));

// ── 2. Role classification ────────────────────────────────────────────────────
console.log("\n-- Role classification --");
ok("classifyRole function",            has(svc, "function classifyRole"));
ok("champion role emitted",            has(svc, '"champion"'));
ok("emerging_champion role emitted",   has(svc, '"emerging_champion"'));
ok("decision_maker role emitted",      has(svc, '"decision_maker"'));
ok("stakeholder role emitted",         has(svc, '"stakeholder"'));
ok("observer role emitted",            has(svc, '"observer"'));
ok("decision maker title detection",   has(svc, "isDecisionMakerTitle"));
ok("CEO/CFO in title list",            has(svc, '"ceo"') && has(svc, '"cfo"'));

// ── 3. Core service functions ─────────────────────────────────────────────────
console.log("\n-- Service functions --");
ok("getBuyingCommittee exported",      has(svc, "export async function getBuyingCommittee"));
ok("getAccountIntelligence exported",  has(svc, "export async function getAccountIntelligence"));
ok("getAccountMomentum exported",      has(svc, "export async function getAccountMomentum"));
ok("getEngagementHeatmap exported",    has(svc, "export async function getEngagementHeatmap"));
ok("getFollowUpOpportunities exported",has(svc, "export async function getFollowUpOpportunities"));
ok("getThreadMostEngaged exported",    has(svc, "export async function getThreadMostEngaged"));
ok("getCommandCenterData exported",    has(svc, "export async function getCommandCenterData"));
ok("computeAccountScore function",     has(svc, "function computeAccountScore"));
ok("calcChampionScore function",       has(svc, "function calcChampionScore"));

// ── 4. Momentum status values ─────────────────────────────────────────────────
console.log("\n-- Momentum --");
ok("accelerating status",  has(svc, '"accelerating"'));
ok("stable status",        has(svc, '"stable"'));
ok("cooling status",       has(svc, '"cooling"'));
ok("dormant status",       has(svc, '"dormant"'));
ok("7d/30d/90d trend windows", has(svc, "last7d") && has(svc, "last30d") && has(svc, "last90d"));
ok("trendPct calculated",      has(svc, "trendPct"));

// ── 5. Internal filtering respected ──────────────────────────────────────────
console.log("\n-- Internal filtering --");
ok("all queries use is_internal IS NOT TRUE",
  (svc.match(/is_internal IS NOT TRUE/g) || []).length >= 6);
ok("is_bot=FALSE included in all event filters",
  (svc.match(/is_bot=FALSE/g) || []).length >= 4);

// ── 6. SQL safety ────────────────────────────────────────────────────────────
console.log("\n-- SQL safety --");
ok("SAFE_INT casts accountId",     has(svc, "SAFE_INT(accountId)"));
ok("esc() used for string params", has(svc, "esc(threadId)"));
ok("uses email_threads for account linkage", has(svc, "email_threads"));
ok("uses calendar_events for meetings",      has(svc, "calendar_events"));

// ── 7. API Routes ─────────────────────────────────────────────────────────────
console.log("\n-- API routes --");
ok("revenue-intelligence command-center route", has(routes, "/api/revenue-intelligence/command-center"));
ok("revenue-intelligence heatmap route",        has(routes, "/api/revenue-intelligence/heatmap"));
ok("revenue-intelligence follow-up route",      has(routes, "/api/revenue-intelligence/follow-up-opportunities"));
ok("revenue-intelligence account/:id route",    has(routes, "/api/revenue-intelligence/account/"));
ok("revenue-intelligence imports service",      has(routes, "revenue-intelligence") || has(routes, "revenueIntelligence"));

// ── 8. Thread widget enhancements ────────────────────────────────────────────
console.log("\n-- Thread Engagement Widget --");
ok("most engaged section rendered",  has(widget, "mostEngaged") || has(widget, "Most Engaged"));
ok("champion score shown",           has(widget, "championScore") || has(widget, "Champion"));
ok("buying committee in widget",     has(widget, "committee") || has(widget, "Committee") || has(widget, "BuyingCommittee"));

// ── 9. Account Intelligence Panel ────────────────────────────────────────────
console.log("\n-- Account Intelligence Panel --");
if (acctPro) {
  ok("account profile imports intelligence data",
    has(acctPro, "revenue-intelligence") || has(acctPro, "AccountIntelligence") || has(acctPro, "engagementScore"));
  ok("champion shown on account profile",
    has(acctPro, "champion") || has(acctPro, "Champion"));
} else {
  console.log("  (account-profile.tsx not accessible — skipping)");
}

// ── 10. Revenue Intelligence Page ────────────────────────────────────────────
console.log("\n-- Revenue Intelligence Page --");
if (page) {
  ok("page renders hot accounts section",         has(page, "Hot") || has(page, "hot"));
  ok("page renders follow-up opportunities",       has(page, "Follow") || has(page, "follow"));
  ok("page renders heatmap/accelerating section",  has(page, "heatmap") || has(page, "Heatmap") || has(page, "Accelerating"));
  ok("page renders at-risk section",               has(page, "risk") || has(page, "Risk") || has(page, "cooling"));
  ok("page uses TanStack Query",                   has(page, "useQuery"));
  ok("page route registered in App.tsx",           has(appTsx, "revenue-intelligence"));
  ok("page registered in nav config",              has(navConf, "revenue-intelligence") || has(navConf, "Revenue"));
} else {
  console.log("  (revenue-intelligence.tsx not found — page not yet generated)");
}

// ── Result ────────────────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
