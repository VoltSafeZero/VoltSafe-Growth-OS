// Source-grep regression test for the Tasks Hub floating menu + Add-a-task footer overhaul.
// Pins structure/invariants without requiring a full browser session.
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log(`  \u2713 ${label}`); }
  else { fail++; console.log(`  \u2717 ${label}`); }
}

const boardSrc = fs.readFileSync(path.join(__dirname, "../client/src/components/tasks/task-board.tsx"), "utf8");
const navSrc = fs.readFileSync(path.join(__dirname, "../client/src/components/tasks/task-floating-nav.tsx"), "utf8");
const hubSrc = fs.readFileSync(path.join(__dirname, "../client/src/pages/tasks-hub.tsx"), "utf8");
const settingsSrc = fs.readFileSync(path.join(__dirname, "../client/src/pages/settings-personal.tsx"), "utf8");
const schemaSrc = fs.readFileSync(path.join(__dirname, "../shared/schema.ts"), "utf8");
const routesSrc = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");

console.log("=== Part A: Add-a-task footer styling ===");
check("footer uses font-semibold", /button-add-task[\s\S]{0,300}font-semibold/.test(boardSrc));
check("footer keeps border-t (no spacing regression)", /border-t-2/.test(boardSrc));
check("footer has stronger hover treatment", /hover:bg-primary\/10 hover:text-primary hover:border-primary\/50/.test(boardSrc));

console.log("=== Part B/C: Floating nav rewrite ===");
check("nav exports FloatingTabKey type", /export type FloatingTabKey/.test(navSrc));
check("default tabs match spec order", /DEFAULT_FLOATING_TABS[\s\S]{0,80}\["urgentOverdue", "recentlyCompleted", "board", "calendar"\]/.test(navSrc));
check("nav container has strong border+shadow", /border-2 border-border[\s\S]{0,40}shadow-xl/.test(navSrc));
check("active tab is bold", /font-bold shadow-sm/.test(navSrc));
check("board button opens popup", /setBoardPopupOpen/.test(navSrc));
check("popup closes on outside click", /mousedown.*handleClick|handleClick.*mousedown/s.test(navSrc));
check("popup closes on Escape", /e\.key === "Escape"/.test(navSrc));
check("popup offers My Tasks and Team Tasks", /My Tasks/.test(navSrc) && /Team Tasks/.test(navSrc));
check("popup lists permittedUsers", /permittedUsers\.map|filteredUsers\.map/.test(navSrc));
check("popup has search for many users", /board-selector-search/.test(navSrc));

console.log("=== Part C: Calendar view ===");
check("calendar tab key exists in meta", /calendar: \{ label: "Calendar"/.test(navSrc));
check("tasks-hub renders TaskCalendarView", /calendarOpen \? \(\s*<TaskCalendarView/.test(hubSrc));
check("TaskCalendarView groups tasks by day", /byDay/.test(hubSrc));
check("TaskCalendarView supports month navigation", /button-calendar-prev/.test(hubSrc) && /button-calendar-next/.test(hubSrc));
check("clicking a calendar task opens existing detail drawer", /calendar-task-\$\{t\.id\}[\s\S]{0,10}`[\s\S]{0,120}onOpenTask\(t\.id\)/.test(hubSrc) || /onClick=\{\(\) => onOpenTask\(t\.id\)\}/.test(hubSrc));

console.log("=== Part D: preference + settings UI ===");
check("schema has taskFloatingMenuTabs column", /taskFloatingMenuTabs/.test(schemaSrc));
check("routes validates taskFloatingMenuTabs allowlist", /VALID_FLOATING_TABS/.test(routesSrc));
check("routes persists taskFloatingMenuTabs on PATCH", /update\.taskFloatingMenuTabs = taskFloatingMenuTabs/.test(routesSrc));
check("routes returns taskFloatingMenuTabs from /api/users/me/layout", /taskFloatingMenuTabs: users\.taskFloatingMenuTabs/.test(routesSrc));
check("settings page renders floating tab picker", /personal-settings-floating-tabs/.test(settingsSrc));
check("settings page enforces max 4 tabs", /up to 4 tabs/.test(settingsSrc));
check("settings page enforces min 1 tab", /at least one tab/.test(settingsSrc));

console.log("=== Part E: wiring/permission reuse ===");
check("hub passes permittedUsers/viewingUserId to floating nav", /permittedUsers=\{permittedUsers\}[\s\S]{0,300}boardScope=\{boardScope\}/.test(hubSrc) || (/<TaskFloatingNav/.test(hubSrc) && /permittedUsers=\{permittedUsers\}/.test(hubSrc)));
check("hub maps urgentOverdue -> overdue ViewTab", /setView\("overdue"\)/.test(hubSrc));
check("hub maps recentlyCompleted -> completed ViewTab", /setView\("completed"\)/.test(hubSrc));

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
