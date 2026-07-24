"use strict";
/**
 * Calendar / Today Schedule Parity — Source-Grep Test Suite
 *
 * Verifies that the Today page Schedule, dashboard widget, and Calendar &
 * Meetings all use the SAME canonical event pipeline — no independent SQL
 * queries for calendar events.
 *
 * Zero network calls — source-grep only.
 */

const fs   = require("fs");
const path = require("path");
const assert = require("assert");

const routesSrc = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");
const storageSrc = fs.readFileSync(path.join(__dirname, "../server/storage.ts"), "utf8");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// ── 1. Shared helper exists ──────────────────────────────────────────────────
console.log("\n── 1. Shared unified calendar helper ──");

test("getFilteredCalendarEventsForUser helper is defined in routes.ts", () => {
  assert(
    routesSrc.includes("async function getFilteredCalendarEventsForUser"),
    "getFilteredCalendarEventsForUser helper not found in routes.ts"
  );
});

test("helper uses storage.getCalendarEvents (Drizzle ORM, same as /api/calendar/events)", () => {
  const helperIdx = routesSrc.indexOf("async function getFilteredCalendarEventsForUser");
  const helperSlice = routesSrc.slice(helperIdx, helperIdx + 3000);
  assert(
    helperSlice.includes("storage.getCalendarEvents"),
    "helper does not call storage.getCalendarEvents — raw SQL is still being used"
  );
});

test("helper applies selectedCalendarIds filter (respects user calendar selections)", () => {
  const helperIdx = routesSrc.indexOf("async function getFilteredCalendarEventsForUser");
  const helperSlice = routesSrc.slice(helperIdx, helperIdx + 3000);
  assert(
    helperSlice.includes("selectedCalendarIds"),
    "helper does not apply selectedCalendarIds filtering"
  );
});

test("helper always includes permanent @voltsafe.com primary calendar", () => {
  const helperIdx = routesSrc.indexOf("async function getFilteredCalendarEventsForUser");
  const helperSlice = routesSrc.slice(helperIdx, helperIdx + 3000);
  assert(
    helperSlice.includes("@voltsafe.com"),
    "helper does not enforce permanent @voltsafe.com calendar inclusion"
  );
});

test("helper treats null selectedCalIds as 'never configured' → return everything", () => {
  const helperIdx = routesSrc.indexOf("async function getFilteredCalendarEventsForUser");
  const helperSlice = routesSrc.slice(helperIdx, helperIdx + 3000);
  assert(
    helperSlice.includes("selectedCalIds === null"),
    "helper missing null-selectedCalIds guard"
  );
});

test("helper preserves app-created events (no externalCalendarId) always", () => {
  const helperIdx = routesSrc.indexOf("async function getFilteredCalendarEventsForUser");
  const helperSlice = routesSrc.slice(helperIdx, helperIdx + 3000);
  assert(
    helperSlice.includes("externalCalendarId"),
    "helper does not handle app-created events (no externalCalendarId)"
  );
});

// ── 2. /api/dashboard/today uses the helper ─────────────────────────────────
console.log("\n── 2. /api/dashboard/today uses unified helper ──");

test("/api/dashboard/today calls getFilteredCalendarEventsForUser", () => {
  const routeIdx = routesSrc.indexOf('app.get("/api/dashboard/today"');
  assert(routeIdx !== -1, "/api/dashboard/today route not found");
  const routeSlice = routesSrc.slice(routeIdx, routeIdx + 8000);
  assert(
    routeSlice.includes("getFilteredCalendarEventsForUser"),
    "/api/dashboard/today does not call getFilteredCalendarEventsForUser"
  );
});

test("/api/dashboard/today does NOT use a raw SQL calendar query", () => {
  const routeIdx = routesSrc.indexOf('app.get("/api/dashboard/today"');
  const nextRouteIdx = routesSrc.indexOf("app.get(", routeIdx + 10);
  const routeSlice = routesSrc.slice(routeIdx, nextRouteIdx > routeIdx ? nextRouteIdx : routeIdx + 8000);
  const hasRawSqlCalendar = /FROM calendar_events WHERE user_id/.test(routeSlice);
  assert(
    !hasRawSqlCalendar,
    "/api/dashboard/today still contains raw SQL 'FROM calendar_events WHERE user_id' — independent pipeline not removed"
  );
});

// ── 3. /api/today/summary schedule uses the helper ──────────────────────────
console.log("\n── 3. /api/today/summary uses unified helper ──");

test("/api/today/summary calls getFilteredCalendarEventsForUser for schedule section", () => {
  const routeIdx = routesSrc.indexOf('app.get("/api/today/summary"');
  assert(routeIdx !== -1, "/api/today/summary route not found");
  const routeSlice = routesSrc.slice(routeIdx, routeIdx + 12000);
  assert(
    routeSlice.includes("getFilteredCalendarEventsForUser"),
    "/api/today/summary does not call getFilteredCalendarEventsForUser"
  );
});

test("/api/today/summary schedule section does NOT have LIMIT 8 cap", () => {
  const routeIdx = routesSrc.indexOf('app.get("/api/today/summary"');
  const routeSlice = routesSrc.slice(routeIdx, routeIdx + 12000);
  // Check for raw SQL with LIMIT 8 specifically in the schedule section
  const hasLimitedSqlSchedule =
    routeSlice.includes("LIMIT 8") &&
    routeSlice.includes("FROM calendar_events") &&
    routeSlice.includes("status != 'cancelled'");
  assert(
    !hasLimitedSqlSchedule,
    "/api/today/summary still uses raw SQL with LIMIT 8 for schedule — independent pipeline not removed"
  );
});

test("/api/today/summary: schedule section does NOT use raw SQL calendar query", () => {
  const routeIdx = routesSrc.indexOf('app.get("/api/today/summary"');
  // Only slice until the next major route — don't over-read
  const nextSectionIdx = routesSrc.indexOf("// ── CEO Cockpit", routeIdx);
  const routeSlice = routesSrc.slice(routeIdx, nextSectionIdx > routeIdx ? nextSectionIdx : routeIdx + 12000);
  const hasRawSqlCalendar = /FROM calendar_events\s+WHERE user_id/.test(routeSlice);
  assert(
    !hasRawSqlCalendar,
    "/api/today/summary still contains raw SQL 'FROM calendar_events WHERE user_id' — independent pipeline not removed"
  );
});

// ── 4. /api/calendar/events still uses storage.getCalendarEvents ─────────────
console.log("\n── 4. /api/calendar/events canonical pipeline intact ──");

test("/api/calendar/events still calls storage.getCalendarEvents (not broken)", () => {
  const routeIdx = routesSrc.indexOf('app.get("/api/calendar/events"');
  assert(routeIdx !== -1, "/api/calendar/events route not found");
  const routeSlice = routesSrc.slice(routeIdx, routeIdx + 5000);
  assert(
    routeSlice.includes("storage.getCalendarEvents"),
    "/api/calendar/events no longer calls storage.getCalendarEvents"
  );
});

test("/api/calendar/events applies selectedCalendarIds filter (unchanged)", () => {
  const routeIdx = routesSrc.indexOf('app.get("/api/calendar/events"');
  const routeSlice = routesSrc.slice(routeIdx, routeIdx + 5000);
  assert(
    routeSlice.includes("selectedCalendarIds"),
    "/api/calendar/events no longer applies selectedCalendarIds filter"
  );
});

// ── 5. storage.getCalendarEvents uses Drizzle ORM (not raw SQL) ─────────────
console.log("\n── 5. storage.getCalendarEvents integrity ──");

test("storage.getCalendarEvents uses Drizzle ORM (db.select().from(calendarEvents))", () => {
  assert(
    storageSrc.includes("db.select().from(calendarEvents)") || storageSrc.includes(".from(calendarEvents)"),
    "storage.getCalendarEvents does not use Drizzle ORM select"
  );
});

test("storage.getCalendarEvents filters status !== 'cancelled'", () => {
  const fnIdx = storageSrc.indexOf("async getCalendarEvents(");
  const fnSlice = storageSrc.slice(fnIdx, fnIdx + 1000);
  assert(
    fnSlice.includes("cancelled"),
    "storage.getCalendarEvents does not filter out cancelled events"
  );
});

test("storage.getCalendarEvents orders by startTime ASC", () => {
  const fnIdx = storageSrc.indexOf("async getCalendarEvents(");
  const fnSlice = storageSrc.slice(fnIdx, fnIdx + 1000);
  assert(
    fnSlice.includes("startTime") || fnSlice.includes("start_time"),
    "storage.getCalendarEvents does not order by startTime"
  );
});

// ── 6. No new independent calendar pipelines ──────────────────────────────
console.log("\n── 6. No other independent calendar pipelines ──");

test("getMeetingsWidget (today-widgets) uses /api/dashboard/today (shared route)", () => {
  const widgetSrc = fs.readFileSync(
    path.join(__dirname, "../client/src/components/today/today-widgets.tsx"),
    "utf8"
  );
  assert(
    widgetSrc.includes("/api/dashboard/today"),
    "today-widgets.tsx does not use /api/dashboard/today"
  );
  // Must NOT have a direct /api/calendar/events call of its own
  assert(
    !widgetSrc.includes("/api/calendar/events"),
    "today-widgets.tsx has its own /api/calendar/events call — independent pipeline"
  );
});

test("today.tsx ScheduleSection sources from /api/today/summary (unified route)", () => {
  const todaySrc = fs.readFileSync(
    path.join(__dirname, "../client/src/pages/today.tsx"),
    "utf8"
  );
  assert(
    todaySrc.includes("/api/today/summary"),
    "today.tsx does not use /api/today/summary"
  );
  // Must NOT have a direct /api/calendar/events call of its own
  assert(
    !todaySrc.includes("/api/calendar/events"),
    "today.tsx has its own /api/calendar/events call — independent pipeline"
  );
});

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("FAILED");
  process.exit(1);
}
console.log("ALL PASSED");
