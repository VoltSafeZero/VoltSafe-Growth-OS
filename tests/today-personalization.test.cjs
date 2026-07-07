// tests/today-personalization.test.cjs
// Source-grep checks for Today Page Phase 2: Personalization, Sorting, Action Completion.
"use strict";

const fs   = require("fs");
const path = require("path");

const TODAY  = path.join(__dirname, "../client/src/pages/today.tsx");
const PREFS  = path.join(__dirname, "../client/src/hooks/use-today-prefs.ts");
const ROUTES = path.join(__dirname, "../server/routes.ts");
const TASKS  = path.join(__dirname, "../server/routes-tasks.ts");

const todaySrc  = fs.readFileSync(TODAY, "utf8");
const prefsSrc  = fs.readFileSync(PREFS, "utf8");
const routesSrc = fs.readFileSync(ROUTES, "utf8");
const tasksSrc  = fs.readFileSync(TASKS, "utf8");

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    console.log("  \u2713 " + label);
    passed++;
  } else {
    console.error("  \u2717 FAIL: " + label);
    failed++;
  }
}

// 1. PREFERENCE HOOK
console.log("\n-- use-today-prefs.ts --");
check("Exports useTodayPrefs", prefsSrc.includes("export function useTodayPrefs"));
check("Key scoped by userId (vs_today_prefs_)", prefsSrc.includes("vs_today_prefs_"));
check("TodayPrefs has sectionOrder", prefsSrc.includes("sectionOrder"));
check("TodayPrefs has hiddenSections", prefsSrc.includes("hiddenSections"));
check("TodayPrefs has pinnedSections", prefsSrc.includes("pinnedSections"));
check("TodayPrefs has compact", prefsSrc.includes("compact"));
check("TodayPrefs has snoozedItems", prefsSrc.includes("snoozedItems"));
check("TodayPrefs has sortBy", prefsSrc.includes("sortBy"));
check("SnoozeEntry has id/type/until only (no sensitive text)",
  prefsSrc.includes("id: string") && prefsSrc.includes("type: string") && prefsSrc.includes("until: number") &&
  !prefsSrc.includes("title:") && !prefsSrc.includes("body:") && !prefsSrc.includes("name:"));
check("Expired snooze entries pruned on read", prefsSrc.includes("until > now"));
check("Exposes setSectionOrder", prefsSrc.includes("setSectionOrder"));
check("Exposes toggleSectionVisibility", prefsSrc.includes("toggleSectionVisibility"));
check("Exposes togglePin", prefsSrc.includes("togglePin"));
check("Exposes setCompact", prefsSrc.includes("setCompact"));
check("Exposes setSortBy", prefsSrc.includes("setSortBy"));
check("Exposes snoozeItem", prefsSrc.includes("snoozeItem"));
check("Exposes unsnoozeItem", prefsSrc.includes("unsnoozeItem"));
check("Exposes isSnoozed", prefsSrc.includes("isSnoozed"));
check("Exposes resetPrefs", prefsSrc.includes("resetPrefs"));
check("Snooze expiry uses day math", prefsSrc.includes("days * 24 * 60 * 60 * 1000"));
check("localStorage wrapped in try/catch", prefsSrc.includes("} catch {"));
check("Default sortBy is severity", prefsSrc.includes('"severity"'));
check("sortBy accepts severity/time/source",
  prefsSrc.includes('"severity"') && prefsSrc.includes('"time"') && prefsSrc.includes('"source"'));

// 2. PREFERENCE INTEGRATION IN today.tsx
console.log("\n-- today.tsx: preference integration --");
check("Imports useTodayPrefs", todaySrc.includes("useTodayPrefs"));
check("useTodayPrefs called with userId", todaySrc.includes("prefs = useTodayPrefs(userId)"));
check("sectionOrder preferences applied", todaySrc.includes("prefs.sectionOrder"));
check("hiddenSections preferences applied", todaySrc.includes("hiddenSections"));
check("pinnedSections preferences applied", todaySrc.includes("pinnedSections"));
check("compact preference applied", todaySrc.includes("prefs.compact"));
check("localStorage scoped by userId", prefsSrc.includes("storageKey(userId)"));

// 3. CUSTOMIZE TODAY SHEET
console.log("\n-- today.tsx: Customize Today sheet --");
check("CustomizeTodaySheet component exists", todaySrc.includes("function CustomizeTodaySheet"));
check("CustomizeTodaySheet rendered in TodayPage", todaySrc.includes("<CustomizeTodaySheet"));
check("Customize trigger testId=today-customize-btn", todaySrc.includes('data-testid="today-customize-btn"'));
check("Sheet testId=customize-today-sheet", todaySrc.includes('data-testid="customize-today-sheet"'));
check("Section order list testId=section-order-list", todaySrc.includes('data-testid="section-order-list"'));
check("Up/down ordering buttons exist", todaySrc.includes("section-up-") && todaySrc.includes("section-down-"));
check("Section pin toggle in sheet", todaySrc.includes("section-pin-"));
check("Section hide/show toggle in sheet", todaySrc.includes("section-toggle-"));
check("Compact mode toggle exists", todaySrc.includes("compact-mode-switch") || todaySrc.includes("compact-mode-toggle"));
check("Reset layout button testId=reset-layout-btn", todaySrc.includes('data-testid="reset-layout-btn"'));
check("resetPrefs called by reset button", todaySrc.includes("resetPrefs"));
check("priority_actions marked alwaysVisible", todaySrc.includes("alwaysVisible: true"));
check("always-on badge shown for locked sections", todaySrc.includes("always on"));
check("Capital section marked capitalOnly in SECTION_CONFIG", todaySrc.includes("capitalOnly: true"));

// 4. PRIORITY ACTIONS SORTING
console.log("\n-- today.tsx: Priority Actions sorting --");
check("sortActions function exists", todaySrc.includes("function sortActions"));
check("Sort by severity implemented", todaySrc.includes('sortBy === "severity"'));
check("Sort by time implemented", todaySrc.includes('sortBy === "time"'));
check("Sort by source implemented", todaySrc.includes('sortBy === "source"'));
check("Sort select testId=priority-sort-select", todaySrc.includes('data-testid="priority-sort-select"'));
check("Sort options: severity/time/source",
  todaySrc.includes('value="severity"') && todaySrc.includes('value="time"') && todaySrc.includes('value="source"'));
check("Source badge on each Priority Action", todaySrc.includes("action.source"));
check("Severity badge on each Priority Action", todaySrc.includes("<SeverityBadge severity={action.severity}"));
check("Due time shown on action when available", todaySrc.includes("action.dueAt"));

// 5. SNOOZE
console.log("\n-- today.tsx: snooze controls --");
check("SnoozeMenu component exists", todaySrc.includes("function SnoozeMenu"));
check("Snooze until tomorrow option", todaySrc.includes("snooze-1d-"));
check("Snooze 3 days option", todaySrc.includes("snooze-3d-"));
check("Unsnooze option exists", todaySrc.includes("unsnooze-"));
check("Snoozed items filtered from list", todaySrc.includes("isSnoozed(a.id)"));
check("Critical items get caution warning", todaySrc.includes("critical") && todaySrc.includes("snooze with caution"));
check("Snoozed count indicator shown", todaySrc.includes("snoozed-count"));
check("Snooze passes id and type, not text", todaySrc.includes("onSnooze(action.id, action.type,"));

// 6. INLINE TASK ACTIONS
console.log("\n-- today.tsx: inline task actions --");
check("InlineCompleteButton component exists", todaySrc.includes("function InlineCompleteButton"));
check("Complete calls POST /api/tasks/:id/complete",
  todaySrc.includes("`/api/tasks/${taskId}/complete`"));
check("Complete button testId=complete-task-{id}",
  todaySrc.includes('data-testid={`complete-task-${taskId}`}'));
check("Complete uses apiRequest", todaySrc.includes('apiRequest("POST", `/api/tasks/${taskId}/complete`)'));
check("Complete invalidates today summary",
  todaySrc.includes("queryClient.invalidateQueries") && todaySrc.includes("/api/today/summary"));
check("Toast on complete success", todaySrc.includes('"Task marked complete"'));
check("Toast on complete error", todaySrc.includes('"Failed to complete task"'));
check("CreateFollowUpButton component exists", todaySrc.includes("function CreateFollowUpButton"));
check("Follow-up calls POST /api/tasks", todaySrc.includes('apiRequest("POST", "/api/tasks"'));
check("Follow-up input testId=followup-task-input", todaySrc.includes('data-testid="followup-task-input"'));
check("Follow-up submit testId=followup-task-submit", todaySrc.includes('data-testid="followup-task-submit"'));
check("Follow-up popover testId=create-followup-popover", todaySrc.includes('data-testid="create-followup-popover"'));
check("Follow-up trigger testId=create-followup-btn", todaySrc.includes('data-testid="create-followup-btn"'));
check("Follow-up body uses status/priority (no Capital fields)",
  todaySrc.includes('"pending"') && todaySrc.includes('"medium"'));
check("Toast on follow-up created", todaySrc.includes('"Follow-up task created"'));

// 7. SECTION CARD ENHANCEMENTS
console.log("\n-- today.tsx: SectionCard enhancements --");
check("SectionCard accepts isPinned", todaySrc.includes("isPinned?:"));
check("SectionCard accepts onTogglePin", todaySrc.includes("onTogglePin?:"));
check("SectionCard accepts onHide", todaySrc.includes("onHide?:"));
check("SectionCard accepts onRefresh", todaySrc.includes("onRefresh?:"));
check("Section menu shown when pin/hide/refresh present", todaySrc.includes("section-menu"));
check("Pin icon shown when pinned", todaySrc.includes("{isPinned && <Pin"));
check("Ring style on pinned sections", todaySrc.includes("ring-1 ring-primary/30"));
check("Hide menu item testId={testId}-hide", todaySrc.includes('data-testid={`${testId}-hide`}'));
check("Pin menu item testId={testId}-pin", todaySrc.includes('data-testid={`${testId}-pin`}'));
check("Refresh menu item testId={testId}-refresh", todaySrc.includes('data-testid={`${testId}-refresh`}'));

// 8. SECTION ORDER / VISIBILITY
console.log("\n-- today.tsx: section order and visibility --");
check("SECTION_CONFIG defines canonical section list", todaySrc.includes("SECTION_CONFIG"));
check("DEFAULT_ORDER derived from SECTION_CONFIG", todaySrc.includes("DEFAULT_ORDER"));
check("buildRenderGroups function exists", todaySrc.includes("function buildRenderGroups"));
check("KNOWN_PAIRS for 2-col layout", todaySrc.includes("KNOWN_PAIRS"));
check("Adjacent pairs in md:grid-cols-2", todaySrc.includes("grid-cols-1 md:grid-cols-2"));
check("priority_actions always visible", todaySrc.includes("alwaysVisible) return true"));
check("Capital gated by isCapital",
  todaySrc.includes("capitalOnly && !isCapital") || todaySrc.includes("!isCapital || !s.capital"));
check("today-header-actions container", todaySrc.includes('data-testid="today-header-actions"'));

// 9. REFRESH CONTROLS
console.log("\n-- today.tsx: refresh controls --");
check("Refresh button testId=today-refresh-btn", todaySrc.includes('data-testid="today-refresh-btn"'));
check("animate-spin while fetching", todaySrc.includes("animate-spin"));
check("Per-section refresh wired to handleRefresh", todaySrc.includes("onRefresh: handleRefresh"));
check("generated_at shown with testId=today-generated-at", todaySrc.includes('data-testid="today-generated-at"'));

// 10. EMPTY STATES
console.log("\n-- today.tsx: empty states --");
check("EmptyState component exists", todaySrc.includes("function EmptyState"));
check("Priority Actions empty state with CheckCircle2", todaySrc.includes("CheckCircle2"));
check("Sections use empty_state from API", todaySrc.includes("data.empty_state"));
check("Favorites empty state", todaySrc.includes("No favorites yet"));
check("Recents empty state", todaySrc.includes("No recent pages yet"));
check("Snoozed-all state shows count", todaySrc.includes("snoozedCount > 0") && todaySrc.includes("snoozed."));

// 11. MOBILE / RESPONSIVE
console.log("\n-- today.tsx: mobile/responsive --");
check("Header uses flex-wrap", todaySrc.includes("flex-wrap"));
check("Metric chips use flex-wrap", todaySrc.includes("flex gap-2 flex-wrap"));
check("Outer container sm:p-6 padding", todaySrc.includes("p-4 sm:p-6"));
check("Sheet width w-80 sm:w-96", todaySrc.includes("w-80 sm:w-96"));
check("FavoritesRecents grid-cols-1 sm:grid-cols-2", todaySrc.includes("grid-cols-1 sm:grid-cols-2"));
check("Compact reduces chip padding", todaySrc.includes('compact ? "px-2 py-1.5"'));

// 12. PERMISSIONS / SECURITY
console.log("\n-- today.tsx: permissions and security --");
check("Capital section returns null if not isCapital",
  todaySrc.includes("if (!isCapital || !s.capital) return null"));
check("isCapital from permissions.capital === edit",
  todaySrc.includes('permissions?.capital === "edit"'));
check("Capital section not shown to non-capital users",
  todaySrc.includes("capitalOnly && !isCapital"));
check("Complete uses POST not GET",
  todaySrc.includes('apiRequest("POST", `/api/tasks/${taskId}/complete`)'));
check("No Capital investor fields in follow-up task",
  !todaySrc.includes("capital_investor") && !todaySrc.includes("investor_id"));
check("Snooze stores id/type/days not text",
  todaySrc.includes("onSnooze(action.id, action.type,") && !todaySrc.includes("onSnooze(action.title"));
check("No direct external API calls in today.tsx",
  !todaySrc.includes('fetch("https://') && !todaySrc.includes('axios.get("https://'));
check("today/summary still requires auth", routesSrc.includes("today/summary") && routesSrc.includes("requireAuth"));
check("capital_investors NOT in routes.ts", !routesSrc.includes("capital_investors"));
check("today-capital-summary service still exists",
  fs.existsSync(path.join(__dirname, "../server/services/today-capital-summary.ts")));

// 13. BACKEND API SAFETY
console.log("\n-- backend API safety --");
check("POST /api/tasks/:id/complete in routes-tasks.ts", tasksSrc.includes("tasks/:id/complete"));
check("POST /api/tasks in routes.ts for follow-up", routesSrc.includes('"/api/tasks"') && routesSrc.includes("requireAuth"));
check("No DELETE from today page", !todaySrc.includes('apiRequest("DELETE"'));
check("No email send from today page",
  !todaySrc.includes('"/api/gmail/send"') && !todaySrc.includes("sendEmail"));

// 14. PHASE 1 REGRESSION
console.log("\n-- Phase 1 regression --");
check("GET /api/today/summary still in routes.ts", routesSrc.includes("today/summary"));
check("today-page testId still present", todaySrc.includes('data-testid="today-page"'));
check("section-priority-actions testId", todaySrc.includes('testId="section-priority-actions"'));
check("section-tasks testId", todaySrc.includes('testId="section-tasks"'));
check("section-schedule testId", todaySrc.includes('testId="section-schedule"'));
check("section-inbox testId", todaySrc.includes('testId="section-inbox"'));
check("section-currents testId", todaySrc.includes('testId="section-currents"'));
check("section-pipeline testId", todaySrc.includes('testId="section-pipeline"'));
check("section-marketing testId", todaySrc.includes('testId="section-marketing"'));
check("section-operations testId", todaySrc.includes('testId="section-operations"'));
check("section-capital testId", todaySrc.includes('testId="section-capital"'));
check("MetricChip testIds present",
  todaySrc.includes("chip-tasks-due-today") && todaySrc.includes("chip-inbox-unread") && todaySrc.includes("chip-pipeline-stalled"));
check("today-retry-btn on error", todaySrc.includes('data-testid="today-retry-btn"'));
check("today-loading skeleton", todaySrc.includes('data-testid="today-loading"'));
check("FavoritesRecentsSection present", todaySrc.includes("FavoritesRecentsSection"));
check("UniversalDrilldownSheet wired in Tasks", todaySrc.includes("UniversalDrilldownSheet"));

// 15. FILE EXISTENCE
console.log("\n-- file existence --");
check("use-today-prefs.ts exists", fs.existsSync(PREFS));
check("today.tsx exists", fs.existsSync(TODAY));
check("today-cockpit.test.cjs exists", fs.existsSync(path.join(__dirname, "today-cockpit.test.cjs")));
check("capital-hardening.test.cjs exists", fs.existsSync(path.join(__dirname, "capital-hardening.test.cjs")));
check("today-capital-summary.ts service exists",
  fs.existsSync(path.join(__dirname, "../server/services/today-capital-summary.ts")));

console.log("\n------------------------------------------------------------");
console.log("Today Personalization: " + passed + " passed, " + failed + " failed");
console.log("------------------------------------------------------------\n");
if (failed > 0) process.exit(1);
