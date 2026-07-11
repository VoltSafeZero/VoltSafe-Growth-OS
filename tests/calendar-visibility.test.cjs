/**
 * Calendar Visibility — Source-Grep Regression Tests
 *
 * Verifies the client-side filtering logic that ensures only selected calendar
 * sources appear in the grid. Uses source-grep to pin key invariants without
 * needing a live server.
 */

const fs = require("fs");
const path = require("path");

const CALENDAR_FILE = path.join(__dirname, "../client/src/pages/calendar.tsx");
const src = fs.readFileSync(CALENDAR_FILE, "utf8");

let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg ?? "Assertion failed");
}

console.log("=== Calendar Visibility — Source-Grep Tests ===");

// ── 1. visibleOwnEvents memo exists ─────────────────────────────────────────
console.log("\n── 1. visibleOwnEvents filtering memo ──");

test("visibleOwnEvents useMemo defined in component", () => {
  assert(src.includes("const visibleOwnEvents = useMemo("), "visibleOwnEvents memo not found");
});

test("visibleOwnEvents filters by calendarSourceKey", () => {
  assert(
    src.includes("calendarSourceKey") && src.includes("selectedIds.includes(sourceKey)"),
    "filtering by calendarSourceKey + selectedIds.includes(sourceKey) missing"
  );
});

test("app-created events (no calendarSourceKey) pass through when selectedIds is null", () => {
  // When no primary calendar is found, selectedIds stays null and all events show
  assert(
    src.includes("if (selectedIds === null) return ownEvents"),
    "null selectedIds passthrough (return all events) missing"
  );
});

test("when selectedIds is null, default to primary-only (not all)", () => {
  assert(
    src.includes("selectedIds ?? (primaryKey ? [primaryKey] : null)"),
    "primary-only default not found"
  );
});

test("visibleOwnEvents memo depends on [ownEvents, sourcesData]", () => {
  assert(src.includes("}, [ownEvents, sourcesData]);"), "memo deps not found");
});

// ── 2. toggleCalendarSource — no more null for "all selected" ──────────────
console.log("\n── 2. toggleCalendarSource default & save behavior ──");

test("toggleCalendarSource uses primary-only default (not allIds)", () => {
  const fnMatch = src.match(/const toggleCalendarSource[\s\S]{0,800}?selectedIds: next \}/);
  assert(fnMatch, "toggleCalendarSource function not matched");
  const fn = fnMatch[0];
  assert(!fn.includes("?? all"), "still using ?? all (all-IDs fallback) — should be primary-only");
  assert(fn.includes("primaryKey ? [primaryKey] : []"), "primary-only fallback not found in toggle");
});

test("toggleCalendarSource never saves null to persist 'all selected'", () => {
  const fnMatch = src.match(/const toggleCalendarSource[\s\S]{0,800}?selectedIds: next \}/);
  assert(fnMatch, "toggleCalendarSource function not matched");
  const fn = fnMatch[0];
  assert(!fn.includes("null : next"), "toggle still uses null-for-all pattern");
  assert(fn.includes("selectedIds: next }"), "toggle must always save explicit array");
});

// ── 3. My Calendars checkbox default ────────────────────────────────────────
console.log("\n── 3. My Calendars checkbox rendering default ──");

test("My Calendars checkbox uses primary-only default", () => {
  assert(
    src.includes("selectedIds ?? (primaryKey ? [primaryKey] : [])"),
    "checkbox current fallback not primary-only"
  );
});

test("My Calendars panel rendered with test-id", () => {
  assert(src.includes('data-testid="my-calendars-panel"'), "my-calendars-panel testid missing");
});

// ── 4. All render paths use visibleOwnEvents ─────────────────────────────────
console.log("\n── 4. Render paths use visibleOwnEvents ──");

test("allEvents spread uses visibleOwnEvents (not raw ownEvents)", () => {
  assert(src.includes("...visibleOwnEvents,"), "allEvents spread not using visibleOwnEvents");
  // Ensure the old pattern is not present in allEvents context
  const allEventsBlock = src.match(/const allEvents[\s\S]{0,200}/);
  assert(allEventsBlock && !allEventsBlock[0].includes("...(ownEvents ?? [])"),
    "allEvents still spreading raw ownEvents");
});

test("NowNextStrip uses visibleOwnEvents", () => {
  assert(src.includes("events={visibleOwnEvents}"), "no visibleOwnEvents prop found");
});

test("WorkdayAgendaPanel uses visibleOwnEvents", () => {
  // Search for the JSX usage site (not the function definition)
  const usageIdx = src.indexOf("<WorkdayAgendaPanel");
  assert(usageIdx !== -1, "WorkdayAgendaPanel JSX usage not found");
  const snippet = src.slice(usageIdx, usageIdx + 400);
  assert(snippet.includes("events={visibleOwnEvents}"), "WorkdayAgendaPanel not using visibleOwnEvents");
});

test("DailyRollupCard uses visibleOwnEvents", () => {
  // Search for the JSX usage site (not the function definition)
  const usageIdx = src.indexOf("<DailyRollupCard");
  assert(usageIdx !== -1, "DailyRollupCard JSX usage not found");
  const snippet = src.slice(usageIdx, usageIdx + 400);
  assert(snippet.includes("events={visibleOwnEvents}"), "DailyRollupCard not using visibleOwnEvents");
});

test("todayOwnEvents memo uses visibleOwnEvents", () => {
  assert(
    src.includes("return visibleOwnEvents") || src.includes("visibleOwnEvents\n      .filter(e => !e._team"),
    "todayOwnEvents not using visibleOwnEvents"
  );
});

test("suggestedOpenings memo uses visibleOwnEvents", () => {
  assert(src.includes("computeSuggestedOpenings(currentDate, visibleOwnEvents,"),
    "suggestedOpenings not using visibleOwnEvents");
});

test("Tasks-to-schedule panel uses visibleOwnEvents", () => {
  assert(src.includes("computeSuggestedOpenings(new Date(), visibleOwnEvents,"),
    "Tasks-to-schedule still uses raw ownEvents");
});

// ── 5. Team Calendars overlay still correctly gated ─────────────────────────
console.log("\n── 5. Team Calendar overlay correctness ──");

test("enabledOverlays gates team event fetch", () => {
  assert(src.includes("enabled: enabledIds.length > 0"), "team event fetch not gated on enabledIds");
});

test("teamEvents only fetched when enabledIdsList non-empty", () => {
  assert(src.includes("if (enabledIds.length === 0) return [];"), "empty guard missing");
});

test("Team Calendars checkbox uses enabledOverlays state", () => {
  assert(src.includes("enabledOverlays.has(member.id)"), "enabledOverlays check missing");
});

// ── 6. No stray raw ownEvents in render ──────────────────────────────────────
console.log("\n── 6. No leaked raw ownEvents in render paths ──");

test("NowNextStrip does not receive raw ownEvents", () => {
  const strip = src.indexOf("NowNextStrip");
  assert(strip !== -1);
  const snippet = src.slice(strip, strip + 500);
  assert(!snippet.includes("ownEvents ?? []"), "NowNextStrip still using raw ownEvents");
});

test("DailyRollupCard does not receive raw ownEvents", () => {
  const drc = src.indexOf("DailyRollupCard");
  assert(drc !== -1);
  const snippet = src.slice(drc, drc + 500);
  assert(!snippet.includes("ownEvents ?? []"), "DailyRollupCard still using raw ownEvents");
});

test("WorkdayAgendaPanel does not receive raw ownEvents", () => {
  const usageIdx = src.indexOf("<WorkdayAgendaPanel");
  assert(usageIdx !== -1);
  const snippet = src.slice(usageIdx, usageIdx + 500);
  assert(!snippet.includes("ownEvents ?? []"), "WorkdayAgendaPanel still using raw ownEvents");
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(60)}`);
console.log(`Calendar Visibility Bug Fix`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log("All tests passed ✓");
} else {
  console.log(`${failed} test(s) FAILED`);
  process.exit(1);
}
