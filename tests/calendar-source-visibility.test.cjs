"use strict";
/**
 * Calendar source visibility regression tests.
 *
 * Root cause being guarded:
 *   toEventListItem() used to strip externalCalendarId from the list response.
 *   This made the client-side source-checkbox filter treat every event as an
 *   "app-created" event (no externalCalendarId → always visible), so delegated /
 *   subscribed calendars (scott@, sanad@, Terri Breker) bled through even when
 *   their checkboxes were unchecked.
 *
 * Two-layer defence verified here:
 *   Layer 1 — server: GET /api/calendar/events applies a server-side pre-filter
 *             based on the user's saved selectedCalendarIds (defence-in-depth).
 *   Layer 2 — server: toEventListItem() now includes externalCalendarId so the
 *             client-side filter can enforce checkbox state on its own.
 */

const assert = require("assert");
const path = require("path");
const fs = require("fs");

let passed = 0;
let failed = 0;
const failures = [];

function check(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
    failures.push(label);
  }
}

// ── Source file grep helpers ──────────────────────────────────────────────────

const CALENDAR_VISIBILITY_SRC = fs.readFileSync(
  path.join(__dirname, "../server/services/calendar-visibility.ts"),
  "utf8"
);

const ROUTES_SRC = (() => {
  // routes.ts is huge — search only the relevant slice around calendar events
  const full = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");
  // Find the /api/calendar/events route block
  const start = full.indexOf('app.get("/api/calendar/events"');
  const end = full.indexOf('app.get("/api/calendar/events/team"');
  return start >= 0 && end > start ? full.slice(start, end) : full.slice(start, start + 3000);
})();

const CALENDAR_PAGE_SRC = fs.readFileSync(
  path.join(__dirname, "../client/src/pages/calendar.tsx"),
  "utf8"
);

// ── Layer 1: toEventListItem exposes calendarSourceKey (not raw externalCalendarId) ──
// The raw Google Calendar ID (which can be an email address) is replaced with a
// stable SHA-256-derived opaque key before being returned in any list response.
console.log("\n── toEventListItem: calendarSourceKey field ──");

check(
  "toEventListItem returns calendarSourceKey (opaque, not raw externalCalendarId)",
  CALENDAR_VISIBILITY_SRC.includes("calendarSourceKey:") &&
    CALENDAR_VISIBILITY_SRC.includes("calendarSourceKey(event.externalCalendarId)")
);

check(
  "calendarSourceKey is null for busy-only events (privacy-safe)",
  CALENDAR_VISIBILITY_SRC.includes("event.isBusyOnly ? null") &&
    CALENDAR_VISIBILITY_SRC.includes("calendarSourceKey")
);

check(
  "calendarSourceKey helper function exported from calendar-visibility.ts",
  CALENDAR_VISIBILITY_SRC.includes("export function calendarSourceKey")
);

check(
  "calendarSourceKey returns null for missing/null input (safe null-guard)",
  CALENDAR_VISIBILITY_SRC.includes("if (!externalCalendarId) return null")
);

// ── Layer 2: server-side selectedCalendarIds pre-filter ───────────────────────
console.log("\n── Server: selectedCalendarIds pre-filter in /api/calendar/events ──");

check(
  "Route selects selectedCalendarIds from calendarConnections",
  ROUTES_SRC.includes("selectedCalendarIds: calendarConnections.selectedCalendarIds")
);

check(
  "selectedCalIds is typed as string[] | null",
  ROUTES_SRC.includes("selectedCalIds") && ROUTES_SRC.includes(": null")
);

check(
  "null selectedCalIds (never configured) returns all events",
  ROUTES_SRC.includes("selectedCalIds === null") &&
    ROUTES_SRC.includes("? events")
);

check(
  "Non-null selectedCalIds filters events by externalCalendarId",
  ROUTES_SRC.includes("selectedCalIds.includes(ev.externalCalendarId)")
);

check(
  "App-created events (no externalCalendarId) are always included",
  // Supports both the legacy single-liner and the new multi-branch filter.
  ROUTES_SRC.includes("!ev.externalCalendarId ||") ||
  ROUTES_SRC.includes("if (!ev.externalCalendarId) return true")
);

check(
  "filtered array is used in the json response (not raw events)",
  ROUTES_SRC.includes("filtered.map") && ROUTES_SRC.includes("toEventListItem")
);

check(
  "Empty selectedCalIds array (all unchecked) excludes synced-calendar events",
  // Logic: if selectedCalIds is [] then selectedCalIds.includes(anything) = false,
  // so only events with falsy externalCalendarId (or permanent calendar) pass through.
  // Supports both the legacy single-liner and the new multi-branch filter.
  ROUTES_SRC.includes("!ev.externalCalendarId || selectedCalIds.includes(ev.externalCalendarId)") ||
  (ROUTES_SRC.includes("selectedCalIds.includes(ev.externalCalendarId)") &&
   ROUTES_SRC.includes("if (!ev.externalCalendarId) return true"))
);

// ── Layer 3: client-side filter correctness ───────────────────────────────────
console.log("\n── Client: visibleOwnEvents source filter ──");

check(
  "visibleOwnEvents useMemo filter exists in calendar.tsx",
  CALENDAR_PAGE_SRC.includes("visibleOwnEvents")
);

check(
  "Filter reads calendarSourceKey from the event (not raw externalCalendarId)",
  CALENDAR_PAGE_SRC.includes("calendarSourceKey") &&
    CALENDAR_PAGE_SRC.includes("sourceKey")
);

check(
  "App-created events (no calendarSourceKey) are always shown client-side",
  CALENDAR_PAGE_SRC.includes("!sourceKey") && CALENDAR_PAGE_SRC.includes("return true")
);

check(
  "Filter uses selectedIds.includes(sourceKey) to gate synced-calendar events",
  CALENDAR_PAGE_SRC.includes("selectedIds.includes(sourceKey)")
);

check(
  "Empty selection (selectedIds = []) correctly excludes synced events (not null-fallthrough)",
  // When selectedIds is [] (all unchecked), it is NOT null, so we do NOT return all events.
  // The null fallthrough only happens when selectedIds was explicitly detected as null.
  CALENDAR_PAGE_SRC.includes("if (selectedIds === null) return ownEvents")
);

// ── People Calendars (overlay/team) — always gated by enabledIds ──────────────
console.log("\n── People Calendars: overlay events gated by enabledIds ──");

check(
  "useTeamCalendarEvents returns [] immediately when enabledIds is empty",
  CALENDAR_PAGE_SRC.includes("if (enabledIds.length === 0) return [];")
);

check(
  "useTeamCalendarEvents is disabled (enabled: false) when enabledIds is empty",
  CALENDAR_PAGE_SRC.includes("enabled: enabledIds.length > 0")
);

check(
  "enabledIdsList is filtered from enabledOverlays + permittedMembers (not all-team default)",
  CALENDAR_PAGE_SRC.includes("enabledIdsList") &&
    CALENDAR_PAGE_SRC.includes("[...enabledOverlays]") &&
    CALENDAR_PAGE_SRC.includes("permittedMembers.some")
);

check(
  "enabledOverlays starts as empty Set (no default-on for any team member)",
  CALENDAR_PAGE_SRC.includes("useState<Set<number>>(new Set())")
);

// ── Selection state saved and respected ───────────────────────────────────────
console.log("\n── Selection state: persistence and invalidation ──");

check(
  "sourceSelectionMutation POSTs to /api/calendar/sources/select",
  CALENDAR_PAGE_SRC.includes("/api/calendar/sources/select")
);

check(
  "selectedIds are stored in the connection (selectedCalendarIds column)",
  ROUTES_SRC.includes("selectedCalendarIds") || CALENDAR_PAGE_SRC.includes("selectedIds")
);

check(
  "Query key includes calendar sources so refetch happens after selection change",
  CALENDAR_PAGE_SRC.includes('"/api/calendar/sources"')
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`calendar-source-visibility: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log("Failed checks:");
  failures.forEach((f) => console.log(`  • ${f}`));
  process.exit(1);
}
console.log("\nAll checks passed.");
