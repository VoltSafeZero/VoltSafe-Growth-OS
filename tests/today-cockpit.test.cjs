// tests/today-cockpit.test.cjs
// Source-grep tests for the Today Page Executive Operating Cockpit.
// Checks backend route structure, permission guards, section caps, and
// frontend component structure — without requiring a live server.

"use strict";
const fs   = require("fs");
const path = require("path");

const ROUTES    = path.join(__dirname, "../server/routes.ts");
const TODAY_PAGE = path.join(__dirname, "../client/src/pages/today.tsx");

const routesSrc = fs.readFileSync(ROUTES, "utf-8");
const pageSrc   = fs.readFileSync(TODAY_PAGE, "utf-8");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

function has(src, pattern, label) {
  const found = typeof pattern === "string" ? src.includes(pattern) : pattern.test(src);
  if (!found) throw new Error(`Expected to find: ${label ?? String(pattern)}`);
}

function hasNot(src, pattern, label) {
  const found = typeof pattern === "string" ? src.includes(pattern) : pattern.test(src);
  if (found) throw new Error(`Should NOT find: ${label ?? String(pattern)}`);
}

// ────────────────────────────────────────────────────────────────────────────
// BACKEND — routes.ts
// ────────────────────────────────────────────────────────────────────────────

console.log("\n[backend] /api/today/summary route\n");

test("route is registered", () => {
  has(routesSrc, 'app.get("/api/today/summary"', "/api/today/summary route exists");
});

test("route requires authentication", () => {
  has(routesSrc, /app\.get\("\/api\/today\/summary",\s*requireAuth/, "requireAuth on /api/today/summary");
});

test("generated_at is returned", () => {
  has(routesSrc, "generated_at: now.toISOString()", "generated_at field in response");
});

test("priority_actions section exists", () => {
  has(routesSrc, "priority_actions:", "priority_actions key in response");
});

test("priority_actions capped at 10", () => {
  has(routesSrc, "priorityActions.slice(0, 10)", "priority actions sliced at 10");
});

test("schedule section exists", () => {
  has(routesSrc, '"Schedule"', "Schedule title in response");
});

test("tasks section exists", () => {
  has(routesSrc, "drilldown_endpoint: \"/api/work/drilldown\"", "tasks drilldown_endpoint in response");
});

test("inbox section exists — local email_messages only", () => {
  has(routesSrc, "unread_inbox:", "unread_inbox count in inbox section");
});

test("inbox uses local email_messages table (no direct Gmail API)", () => {
  // The today/summary endpoint must NOT make outbound Gmail API calls
  const summaryBlock = routesSrc.slice(
    routesSrc.indexOf('app.get("/api/today/summary"'),
    routesSrc.indexOf('// ── Growth OS Command Center')
  );
  hasNot(summaryBlock, "gmail.users", "no direct Gmail API calls in /api/today/summary");
  hasNot(summaryBlock, "googleapis.com", "no googleapis.com calls in /api/today/summary");
});

test("currents section exists", () => {
  has(routesSrc, "channel_messages:", "channel_messages in currents section");
  has(routesSrc, "dm_messages:", "dm_messages in currents section");
});

test("currents respects channel membership (current_channel_members)", () => {
  has(routesSrc, "current_channel_members", "membership check in CURRENTS query");
});

test("currents respects DM membership (current_conversation_members)", () => {
  has(routesSrc, "current_conversation_members", "DM membership check in CURRENTS query");
});

test("currents private channel exclusion via try/catch safety", () => {
  has(routesSrc, "_currentsErr", "CURRENTS failure handled safely");
});

test("pipeline section exists with drilldown endpoint", () => {
  has(routesSrc, "drilldown_endpoint: \"/api/pipeline/drilldown\"", "pipeline drilldown endpoint");
});

test("marketing section exists with drilldown endpoint", () => {
  has(routesSrc, "drilldown_endpoint: \"/api/marketing/drilldown\"", "marketing drilldown endpoint");
});

test("operations section exists with drilldown endpoint", () => {
  has(routesSrc, "drilldown_endpoint: \"/api/operations/drilldown\"", "operations drilldown endpoint");
});

test("capital section is null for non-Capital users", () => {
  has(routesSrc, "capital:   capitalSection", "capital field in response");
  // Capital section is delegated to today-capital-summary service which returns null when !hasCapital
  has(routesSrc, "getTodayCapitalSection", "getTodayCapitalSection service called in route");
});

test("capital section only populated if hasCapital", () => {
  // getTodayCapitalSection receives hasCapital param and returns null when false
  has(routesSrc, "getTodayCapitalSection(userId, hasCapital, now)", "hasCapital passed to service");
});

test("capital access uses CAPITAL_USER_IDS = new Set([4])", () => {
  // In the today/summary block
  const summaryBlock = routesSrc.slice(
    routesSrc.indexOf('app.get("/api/today/summary"'),
    routesSrc.indexOf('// ── Growth OS Command Center')
  );
  has(summaryBlock, "CAPITAL_USER_IDS = new Set([4])", "CAPITAL_USER_IDS = new Set([4]) in today/summary");
  has(summaryBlock, "scott.carlson@voltsafe.com", "scott.carlson capital email in today/summary");
});

test("capital uses capital_investors table (via isolated service)", () => {
  // Query lives in server/services/today-capital-summary.ts, not routes.ts (isolation invariant)
  const serviceSrc = fs.readFileSync(
    path.join(__dirname, "../server/services/today-capital-summary.ts"), "utf-8"
  );
  has(serviceSrc, "capital_investors", "capital_investors table queried in today-capital-summary service");
  has(serviceSrc, "getTodayCapitalSection", "getTodayCapitalSection exported from service");
});

test("task queries are user-scoped by owner_user_id", () => {
  const summaryBlock = routesSrc.slice(
    routesSrc.indexOf('app.get("/api/today/summary"'),
    routesSrc.indexOf('// ── Growth OS Command Center')
  );
  has(summaryBlock, "owner_user_id = ${userId}", "task queries scoped by owner_user_id");
});

test("calendar queries are user-scoped by user_id", () => {
  const summaryBlock = routesSrc.slice(
    routesSrc.indexOf('app.get("/api/today/summary"'),
    routesSrc.indexOf('// ── Growth OS Command Center')
  );
  has(summaryBlock, "user_id = ${userId}", "calendar_events scoped by user_id");
});

test("schedule capped at 8 items", () => {
  has(routesSrc, "LIMIT 8", "schedule items capped at LIMIT 8");
});

test("tasks capped at 5 per category", () => {
  const summaryBlock = routesSrc.slice(
    routesSrc.indexOf('app.get("/api/today/summary"'),
    routesSrc.indexOf('// ── Growth OS Command Center')
  );
  has(summaryBlock, "LIMIT 5", "task queries capped at LIMIT 5");
});

test("hot opportunities capped at 5", () => {
  const summaryBlock = routesSrc.slice(
    routesSrc.indexOf('app.get("/api/today/summary"'),
    routesSrc.indexOf('// ── Growth OS Command Center')
  );
  has(summaryBlock, "LIMIT 5", "hot_opportunities LIMIT 5");
});

test("empty_state strings exist in all sections", () => {
  has(routesSrc, "empty_state: \"Nothing urgent right now", "priority_actions empty_state");
  has(routesSrc, "empty_state: \"No meetings scheduled today", "schedule empty_state");
  has(routesSrc, "empty_state: \"No tasks due today", "tasks empty_state");
  has(routesSrc, "empty_state: \"Inbox is clear", "inbox empty_state");
  has(routesSrc, "empty_state: \"No new messages", "currents empty_state");
  has(routesSrc, "empty_state: \"No active opportunities", "pipeline empty_state");
  has(routesSrc, "empty_state: \"No active campaigns", "marketing empty_state");
  has(routesSrc, "empty_state: \"No operational blockers", "operations empty_state");
});

test("operations uses blockers field (not status=blocked) for blocked installs", () => {
  has(routesSrc, "blockers IS NOT NULL AND blockers != ''", "blocked_installs uses blockers field");
});

test("error handler logs and returns 500", () => {
  const summaryBlock = routesSrc.slice(
    routesSrc.indexOf('app.get("/api/today/summary"'),
    routesSrc.indexOf('// ── Growth OS Command Center')
  );
  has(summaryBlock, 'console.error("[today] GET /api/today/summary:', "error handler with log");
  has(summaryBlock, "res.status(500).json", "500 on error");
});

test("no raw session tokens or storage keys exposed in response", () => {
  const summaryBlock = routesSrc.slice(
    routesSrc.indexOf('app.get("/api/today/summary"'),
    routesSrc.indexOf('// ── Growth OS Command Center')
  );
  hasNot(summaryBlock, "SESSION_SECRET", "SESSION_SECRET not in today/summary response");
  hasNot(summaryBlock, "refresh_token", "refresh_token not in today/summary response");
});

// ────────────────────────────────────────────────────────────────────────────
// FRONTEND — today.tsx
// ────────────────────────────────────────────────────────────────────────────

console.log("\n[frontend] today.tsx cockpit page\n");

test("page uses /api/today/summary", () => {
  has(pageSrc, '"/api/today/summary"', "queryKey includes /api/today/summary");
});

test("loading skeleton exists", () => {
  has(pageSrc, 'data-testid="today-loading"', "today-loading testid present");
  has(pageSrc, "CockpitSkeleton", "CockpitSkeleton component");
});

test("error state with retry button exists", () => {
  has(pageSrc, 'data-testid="today-error"', "today-error testid");
  has(pageSrc, 'data-testid="today-retry-btn"', "today-retry-btn testid");
  has(pageSrc, "summaryQuery.refetch()", "refetch on retry");
});

test("Priority Actions section exists", () => {
  // SectionCard receives testId prop; data-testid appears on the child content wrapper
  has(pageSrc, 'testId="section-priority-actions"', "section-priority-actions testId prop");
  has(pageSrc, "PriorityActionsSection", "PriorityActionsSection component");
  has(pageSrc, 'data-testid="priority-actions-list"', "priority-actions-list testid");
});

test("Schedule section exists", () => {
  has(pageSrc, 'testId="section-schedule"', "section-schedule testId prop");
  has(pageSrc, "ScheduleSection", "ScheduleSection component");
  has(pageSrc, 'data-testid="schedule-list"', "schedule-list testid");
});

test("Tasks section exists", () => {
  has(pageSrc, 'testId="section-tasks"', "section-tasks testId prop");
  has(pageSrc, "TasksSection", "TasksSection component");
  has(pageSrc, 'data-testid="tasks-section-content"', "tasks-section-content testid");
});

test("Inbox section exists", () => {
  has(pageSrc, 'testId="section-inbox"', "section-inbox testId prop");
  has(pageSrc, "InboxSection", "InboxSection component");
  has(pageSrc, 'data-testid="inbox-section-content"', "inbox-section-content testid");
});

test("CURRENTS section exists", () => {
  has(pageSrc, 'testId="section-currents"', "section-currents testId prop");
  has(pageSrc, "CurrentsSection", "CurrentsSection component");
  has(pageSrc, 'data-testid="currents-list"', "currents-list testid");
});

test("Pipeline section exists", () => {
  has(pageSrc, 'testId="section-pipeline"', "section-pipeline testId prop");
  has(pageSrc, "PipelineSection", "PipelineSection component");
  has(pageSrc, 'data-testid="pipeline-section-content"', "pipeline-section-content testid");
});

test("Marketing section exists", () => {
  has(pageSrc, 'testId="section-marketing"', "section-marketing testId prop");
  has(pageSrc, "MarketingSection", "MarketingSection component");
  has(pageSrc, 'data-testid="marketing-section-content"', "marketing-section-content testid");
});

test("Operations section exists", () => {
  has(pageSrc, 'testId="section-operations"', "section-operations testId prop");
  has(pageSrc, "OperationsSection", "OperationsSection component");
  has(pageSrc, 'data-testid="operations-section-content"', "operations-section-content testid");
});

test("Capital section is permission-gated", () => {
  has(pageSrc, "isCapital && s.capital", "Capital section gated by isCapital");
  has(pageSrc, 'testId="section-capital"', "section-capital testId prop");
  has(pageSrc, "CapitalSection", "CapitalSection component");
  has(pageSrc, 'data-testid="capital-section-content"', "capital-section-content testid");
});

test("isCapital derived from permissions.capital === edit", () => {
  has(pageSrc, 'permissions?.capital === "edit"', "isCapital from permissions.capital");
});

test("Favorites and Recents section exists", () => {
  has(pageSrc, 'data-testid="favorites-recents-section"', "favorites-recents-section testid");
  has(pageSrc, "FavoritesRecentsSection", "FavoritesRecentsSection component");
  has(pageSrc, 'testId="section-favorites"', "section-favorites testId prop");
  has(pageSrc, 'testId="section-recents"', "section-recents testId prop");
});

test("usePageFavorites and useRecentPages used", () => {
  has(pageSrc, "usePageFavorites", "usePageFavorites hook used");
  has(pageSrc, "useRecentPages", "useRecentPages hook used");
});

test("favorites/recents respect Capital gating", () => {
  has(pageSrc, "FavoritesRecentsSection({ isCapitalUser", "isCapitalUser passed to FavoritesRecentsSection");
  has(pageSrc, "usePageFavorites(isCapitalUser, isAdmin)", "usePageFavorites receives isCapitalUser");
  has(pageSrc, "useRecentPages(isCapitalUser, isAdmin)", "useRecentPages receives isCapitalUser");
});

test("UniversalDrilldownSheet integration exists", () => {
  has(pageSrc, "UniversalDrilldownSheet", "UniversalDrilldownSheet imported and used");
  has(pageSrc, "UniversalDrilldownConfig", "UniversalDrilldownConfig type imported");
});

test("drilldown wired for tasks", () => {
  has(pageSrc, 'endpoint={data.drilldown_endpoint} metric="tasks_overdue"', "tasks_overdue metric");
  has(pageSrc, 'endpoint={data.drilldown_endpoint} metric="tasks_due_today"', "tasks_due_today metric");
});

test("drilldown wired for pipeline", () => {
  has(pageSrc, 'endpoint={data.drilldown_endpoint} metric="opportunities_stalled"', "opportunities_stalled metric");
});

test("drilldown wired for marketing", () => {
  has(pageSrc, 'endpoint={data.drilldown_endpoint} metric="campaigns_blocked"', "campaigns_blocked metric");
});

test("drilldown wired for operations", () => {
  has(pageSrc, 'endpoint={data.drilldown_endpoint} metric="blocked_installs"', "blocked_installs metric");
});

test("View all links exist on sections with link prop", () => {
  has(pageSrc, "link={s.schedule.link}", "schedule View all link");
  has(pageSrc, "link={s.tasks.link}", "tasks View all link");
  has(pageSrc, "link={s.inbox.link}", "inbox View all link");
  has(pageSrc, "link={s.pipeline.link}", "pipeline View all link");
  has(pageSrc, "link={s.marketing.link}", "marketing View all link");
  has(pageSrc, "link={s.operations.link}", "operations View all link");
});

test("refresh button exists", () => {
  has(pageSrc, 'data-testid="today-refresh-btn"', "today-refresh-btn testid");
  has(pageSrc, "handleRefresh", "handleRefresh function");
  has(pageSrc, "queryClient.invalidateQueries", "cache invalidated on refresh");
});

test("generated_at displayed", () => {
  has(pageSrc, 'data-testid="today-generated-at"', "today-generated-at testid");
  has(pageSrc, "generatedAt", "generatedAt variable used");
});

test("severity badges in Priority Actions", () => {
  has(pageSrc, "SeverityBadge", "SeverityBadge component");
  has(pageSrc, "SEVERITY_STYLES", "SEVERITY_STYLES map");
  has(pageSrc, '"critical"', "critical severity level in styles");
  has(pageSrc, '"high"', "high severity level in styles");
});

test("empty states rendered in each section", () => {
  has(pageSrc, "EmptyState", "EmptyState component used");
  has(pageSrc, "data.empty_state", "empty_state from API used");
});

test("no hardcoded fake dashboard stats", () => {
  hasNot(pageSrc, /const.*=\s*42[^;]*;/, "no hardcoded 42 stats");
  hasNot(pageSrc, /const.*=\s*100[^;]*;/, "no hardcoded 100 stats");
  hasNot(pageSrc, "mockData", "no mockData");
  hasNot(pageSrc, "fakeData", "no fakeData");
});

test("page does not import today-widgets (replaced by cockpit)", () => {
  hasNot(pageSrc, "today-widgets", "today-widgets not imported in new cockpit page");
});

test("page does not import DashboardGrid (replaced by cockpit)", () => {
  hasNot(pageSrc, "DashboardGrid", "DashboardGrid not imported in new cockpit page");
});

// ────────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────────

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
