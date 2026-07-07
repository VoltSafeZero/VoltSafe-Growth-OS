// tests/ceo-cockpit-ux-polish.test.cjs
// Source-grep checks for CEO Cockpit Phase 12: UX Polish, Visual Hierarchy, Mobile
"use strict";

const fs   = require("fs");
const path = require("path");

const TODAY   = path.join(__dirname, "../client/src/pages/today.tsx");
const RADAR   = path.join(__dirname, "../client/src/components/today/ceo-execution-radar.tsx");
const BRIEFING = path.join(__dirname, "../client/src/components/today/ceo-briefing.tsx");
const ACTIONS  = path.join(__dirname, "../client/src/components/today/ceo-action-queue.tsx");

const todaySrc    = fs.readFileSync(TODAY, "utf8");
const radarSrc    = fs.readFileSync(RADAR, "utf8");
const briefingSrc = fs.readFileSync(BRIEFING, "utf8");
const actionsSrc  = fs.readFileSync(ACTIONS, "utf8");

let passed = 0; let failed = 0;
function check(label, condition) {
  if (condition) { console.log("  \u2713 " + label); passed++; }
  else { console.error("  \u2717 FAIL: " + label); failed++; }
}

// ── 1. COCKPIT HEADER ─────────────────────────────────────────────────────────
console.log("\n-- Cockpit header --");

check("Cockpit header div with data-testid=ceo-cockpit-header",
  todaySrc.includes('data-testid="ceo-cockpit-header"'));
check("Cockpit title element with data-testid=ceo-cockpit-title",
  todaySrc.includes('data-testid="ceo-cockpit-title"'));
check("Cockpit title text is 'CEO Cockpit'",
  todaySrc.includes('"ceo-cockpit-title"') && todaySrc.includes('>CEO Cockpit<'));
check("Cockpit subtitle element with data-testid=ceo-cockpit-subtitle",
  todaySrc.includes('data-testid="ceo-cockpit-subtitle"'));
check("Subtitle uses TAB_SUBTITLES[cockpitTab]",
  todaySrc.includes("TAB_SUBTITLES[cockpitTab]"));
check("Refresh button with data-testid=ceo-cockpit-refresh-btn",
  todaySrc.includes('data-testid="ceo-cockpit-refresh-btn"'));
check("Refresh button invalidates ceo-cockpit query",
  todaySrc.includes('ceo-cockpit-refresh-btn') && todaySrc.includes("/api/today/ceo-cockpit"));
check("Refresh button disabled while isFetching",
  todaySrc.includes("cockpitQuery.isFetching") && todaySrc.includes("disabled={cockpitQuery.isFetching}"));
check("Last-refreshed timestamp element data-testid=ceo-cockpit-last-refreshed",
  todaySrc.includes('data-testid="ceo-cockpit-last-refreshed"'));
check("Admin badge with data-testid=ceo-cockpit-admin-badge",
  todaySrc.includes('data-testid="ceo-cockpit-admin-badge"'));
check("Admin badge contains Shield icon",
  todaySrc.includes("ceo-cockpit-admin-badge") && todaySrc.includes("Shield"));
check("fmtCockpitRefreshed helper function defined",
  todaySrc.includes("function fmtCockpitRefreshed("));
check("fmtCockpitRefreshed returns 'just now' for <1 min",
  todaySrc.includes("just now"));

// ── 2. TAB_SUBTITLES CONSTANT ─────────────────────────────────────────────────
console.log("\n-- TAB_SUBTITLES constant --");

check("TAB_SUBTITLES constant defined",
  todaySrc.includes("const TAB_SUBTITLES"));
check("TAB_SUBTITLES has overview key",
  todaySrc.includes('"overview"') && todaySrc.includes("Team pulse"));
check("TAB_SUBTITLES has actions key",
  todaySrc.includes('"actions"') && todaySrc.includes("follow-up actions"));
check("TAB_SUBTITLES has briefing key",
  todaySrc.includes('"briefing"') && todaySrc.includes("Daily priorities"));
check("TAB_SUBTITLES has execution key",
  todaySrc.includes('"execution"') && todaySrc.includes("Drift detection"));
check("TAB_SUBTITLES has forecasting key",
  todaySrc.includes('"forecasting"') && todaySrc.includes("Scenario planning"));
check("TAB_SUBTITLES has 1on1s key",
  todaySrc.includes('"1on1s"') && todaySrc.includes("agenda prep"));
check("TAB_SUBTITLES has board-pack key",
  todaySrc.includes('"board-pack"') && todaySrc.includes("investor reporting"));

// ── 3. TAB BAR — ICONS & MOBILE SCROLL ───────────────────────────────────────
console.log("\n-- Tab bar icons and mobile scroll --");

check("TAB_CONFIG constant defined",
  todaySrc.includes("const TAB_CONFIG"));
check("Tab bar uses overflow-x-auto (not flex-wrap)",
  todaySrc.includes("overflow-x-auto") && !todaySrc.match(/ceo-cockpit-tabs[^"]*flex-wrap/));
check("Tab bar hides scrollbar ([&::-webkit-scrollbar]:hidden)",
  todaySrc.includes("[&::-webkit-scrollbar]:hidden"));
check("Tab buttons use whitespace-nowrap",
  todaySrc.includes("whitespace-nowrap"));
check("Tab buttons use flex-shrink-0",
  todaySrc.includes("flex-shrink-0"));
check("LayoutDashboard icon imported for overview tab",
  todaySrc.includes("LayoutDashboard"));
check("FileText icon imported for briefing tab",
  todaySrc.includes("FileText"));
check("Activity icon imported for execution tab",
  todaySrc.includes("Activity"));
check("Users icon imported for 1on1s tab",
  todaySrc.includes("Users"));
check("BookOpen icon imported for board-pack tab",
  todaySrc.includes("BookOpen"));
check("Tab renders icon element (h-3.5 w-3.5)",
  todaySrc.includes("h-3.5 w-3.5") && todaySrc.includes("TAB_CONFIG"));
check("1:1s tab count badge rendered when data available",
  todaySrc.includes("ceo-cockpit-tab-badge-1on1s") &&
  todaySrc.includes("one_on_ones.items.length"));

// ── 4. OVERVIEW PRIORITY SUMMARY BAR ─────────────────────────────────────────
console.log("\n-- Overview priority summary bar --");

check("Priority summary bar has data-testid=ceo-priority-summary",
  todaySrc.includes('data-testid="ceo-priority-summary"'));
check("Priority summary bar only shown when urgentCount > 0",
  todaySrc.includes("urgentCount > 0"));
check("urgentCount includes blockers.count",
  todaySrc.includes("cs.blockers.count") && todaySrc.includes("urgentCount"));
check("urgentCount includes ceo_attention.count",
  todaySrc.includes("cs.ceo_attention.count") && todaySrc.includes("urgentCount"));
check("urgentCount includes commitments.overdue",
  todaySrc.includes("cs.commitments.overdue") && todaySrc.includes("urgentCount"));
check("Priority summary uses Zap icon",
  todaySrc.includes("ceo-priority-summary") && todaySrc.includes("Zap"));
check("Priority summary shows blocker count with red color",
  todaySrc.includes("text-red-400") && todaySrc.includes("blocker"));
check("Priority summary shows ceo attention count with amber color",
  todaySrc.includes("text-amber-400") && todaySrc.includes("CEO attention"));
check("Priority summary shows overdue commitment count with orange color",
  todaySrc.includes("text-orange-400") && todaySrc.includes("overdue commitment"));

// ── 5. BOARD PACK TAB — RICHER CONTENT ───────────────────────────────────────
console.log("\n-- Board Pack tab richer content --");

check("Board Pack tab has data-testid=ceo-cockpit-board-pack-tab",
  todaySrc.includes('data-testid="ceo-cockpit-board-pack-tab"'));
check("Board Pack link button has data-testid=ceo-cockpit-board-pack-link",
  todaySrc.includes('data-testid="ceo-cockpit-board-pack-link"'));
check("Board Pack tab shows BookOpen icon",
  todaySrc.includes("ceo-cockpit-board-pack-tab") && todaySrc.includes("BookOpen"));
check("Board Pack tab lists Pack Generation feature",
  todaySrc.includes("Pack Generation"));
check("Board Pack tab lists Historical Comparisons feature",
  todaySrc.includes("Historical Comparisons"));
check("Board Pack tab lists Investor Updates feature",
  todaySrc.includes("Investor Updates"));

// ── 6. EXECUTION RADAR — THEME COLORS ────────────────────────────────────────
console.log("\n-- Execution Radar theme color fixes --");

check("SectionBlock no longer uses bg-[#0d1117]",
  !radarSrc.includes("bg-[#0d1117]"));
check("SectionBlock uses bg-card/60",
  radarSrc.includes("bg-card/60"));
check("SectionBlock uses border-border/40",
  radarSrc.includes("border-border/40"));
check("SectionBlock hover uses bg-muted/30",
  radarSrc.includes("bg-muted/30"));
check("bg-[#0a0f1a] preserved on main Card (allowlisted)",
  radarSrc.includes("bg-[#0a0f1a]"));
check("No standalone text-white on item titles (use text-foreground)",
  !radarSrc.match(/\btext-white\b/));
check("ItemCard title uses text-foreground",
  radarSrc.includes("text-foreground leading-tight truncate"));
check("Scorecard label uses text-foreground",
  radarSrc.includes('"scorecard-label-value"') && radarSrc.includes("text-foreground"));
check("Scorecard metric values use text-foreground",
  radarSrc.includes("text-lg font-bold text-foreground"));
check("ItemCard bg uses bg-card/40",
  radarSrc.includes("bg-card/40"));

// ── 7. EXECUTION RADAR — CHEVRON ICONS ───────────────────────────────────────
console.log("\n-- Execution Radar expand/collapse icons --");

check("ChevronDown imported in execution radar",
  radarSrc.includes("ChevronDown"));
check("No Unicode triangle ▲ in execution radar",
  !radarSrc.includes("▲"));
check("No Unicode triangle ▼ in execution radar",
  !radarSrc.includes("▼"));
check("ChevronDown uses rotate-180 for expanded state",
  radarSrc.includes("rotate-180") && radarSrc.includes("ChevronDown"));
check("ChevronDown has transition-transform",
  radarSrc.includes("transition-transform") && radarSrc.includes("ChevronDown"));

// ── 8. BRIEFING EMPTY STATE ───────────────────────────────────────────────────
console.log("\n-- Briefing EmptyState with icon --");

check("EmptyState component has data-testid=briefing-empty-state",
  briefingSrc.includes('data-testid="briefing-empty-state"'));
check("EmptyState uses flex-col items-center layout",
  briefingSrc.includes("flex flex-col items-center"));
check("EmptyState renders CheckCircle2 icon",
  briefingSrc.includes("CheckCircle2") && briefingSrc.includes("briefing-empty-state"));
check("EmptyState icon has emerald color",
  briefingSrc.includes("emerald"));
check("EmptyState still renders the message text",
  briefingSrc.includes("{message}"));

// ── 9. ACTION QUEUE FILTER CHIPS MOBILE ──────────────────────────────────────
console.log("\n-- Action Queue filter chips mobile scroll --");

check("Filter chips use overflow-x-auto (not flex-wrap)",
  actionsSrc.includes("overflow-x-auto") && actionsSrc.includes("action-filter-chips"));
check("Filter chips hide scrollbar",
  actionsSrc.includes("[&::-webkit-scrollbar]:hidden") && actionsSrc.includes("action-filter-chips"));

// ── 10. REGRESSION GUARDS ─────────────────────────────────────────────────────
console.log("\n-- Regression guards --");

check("All 7 cockpit tab data-testids still present (dynamic template + all 7 ids in TAB_CONFIG)",
  todaySrc.includes('ceo-cockpit-tab-${tab.id}') &&
  todaySrc.includes('"overview"') &&
  todaySrc.includes('"actions"') &&
  todaySrc.includes('"briefing"') &&
  todaySrc.includes('"execution"') &&
  todaySrc.includes('"forecasting"') &&
  todaySrc.includes('"1on1s"') &&
  todaySrc.includes('"board-pack"'));
check("ceo-cockpit-view still present",
  todaySrc.includes('data-testid="ceo-cockpit-view"'));
check("ceo-cockpit-overview still present",
  todaySrc.includes('data-testid="ceo-cockpit-overview"'));
check("ceo-cockpit-actions-tab still present",
  todaySrc.includes('data-testid="ceo-cockpit-actions-tab"'));
check("ceo-cockpit-briefing-tab still present",
  todaySrc.includes('data-testid="ceo-cockpit-briefing-tab"'));
check("ceo-cockpit-execution-tab still present",
  todaySrc.includes('data-testid="ceo-cockpit-execution-tab"'));
check("ceo-cockpit-forecasting-tab still present",
  todaySrc.includes('data-testid="ceo-cockpit-forecasting-tab"'));
check("ceo-cockpit-1on1s-tab still present",
  todaySrc.includes('data-testid="ceo-cockpit-1on1s-tab"'));
check("section-team-pulse still present",
  todaySrc.includes('testId="section-team-pulse"'));
check("section-blockers still present",
  todaySrc.includes('testId="section-blockers"'));
check("section-ceo-attention still present",
  todaySrc.includes('testId="section-ceo-attention"'));
check("section-one-on-ones still present",
  todaySrc.includes('testId="section-one-on-ones"'));
check("Execution radar data-testid=ceo-execution-radar-panel still present",
  radarSrc.includes('data-testid="ceo-execution-radar-panel"'));
check("execution-health-score still present",
  radarSrc.includes('data-testid="execution-health-score"'));
check("scorecard-health-hero still present",
  radarSrc.includes('data-testid="scorecard-health-hero"'));
check("scorecard-metrics-grid still present",
  radarSrc.includes('data-testid="scorecard-metrics-grid"'));
check("execution-radar-tabs still present",
  radarSrc.includes('data-testid="execution-radar-tabs"'));
check("isAdmin gate on cockpit still enforced",
  todaySrc.includes("isAdmin"));

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(55)}`);
if (failed === 0) {
  console.log(`Passed: ${passed}   Failed: ${failed}`);
  console.log("All checks passed \u2713");
} else {
  console.error(`Passed: ${passed}   Failed: ${failed}`);
  process.exit(1);
}
