#!/usr/bin/env tsx
/**
 * Calendar Privacy Visibility Policy — unit tests for the pure resolver logic.
 * Run with:
 *
 *   npx tsx tests/calendar-privacy.unit.ts
 *
 * No live server required and NO database touched — imports only the pure
 * functions from server/services/calendar-visibility.ts (resolveCalendarVisibility,
 * sanitizeEventForBusyOnly, classifyCalendarConnection). DB-backed helpers
 * (loadConnectionVisibilityMap, loadEventConnectionIds) are exercised via the
 * live-server smoke script instead (scripts/calendar-privacy-smoke.md notes).
 *
 * Covers the 20 spec test cases:
 *  1-4:   company_managed work calendar — elevated roles see full details for ANY user
 *  5-7:   company_managed — non-elevated roles follow calendar_team permission (resolver assumes caller pre-filtered)
 *  8-11:  private_personal calendar — busy-only for everyone except owner, REGARDLESS of role (admin included)
 *  12-14: external_calendar — same busy-only rule as private_personal
 *  15:    team_shared calendar — full details for any internal user, no edit
 *  16:    owner always gets full details + edit, on every visibility type
 *  17:    sanitizeEventForBusyOnly strips all sensitive fields and labels "Busy"
 *  18:    classifyCalendarConnection — @voltsafe.com => company_managed
 *  19:    classifyCalendarConnection — non-@voltsafe.com => private_personal
 *  20:    canEdit is false for every non-owner scenario (view-only enforcement)
 */

import {
  resolveCalendarVisibility,
  sanitizeEventForBusyOnly,
  classifyCalendarConnection,
  type CalendarAccountInfo,
} from "../server/services/calendar-visibility";

let passed = 0;
let failed = 0;

function ok(label: string) {
  console.log(`  \u2713 ${label}`);
  passed++;
}
function fail(label: string, detail?: string) {
  console.error(`  \u2717 ${label}${detail ? ` \u2014 ${detail}` : ""}`);
  failed++;
}
function assertEq<T>(label: string, actual: T, expected: T) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) ok(label);
  else fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function assertTrue(label: string, cond: boolean) {
  if (cond) ok(label);
  else fail(label);
}

const OWNER_ID = 100;
const OTHER_ID = 200;

function acct(visibilityType: CalendarAccountInfo["visibilityType"]): CalendarAccountInfo {
  return { visibilityType, userId: OWNER_ID };
}

console.log("\n=== Calendar Privacy Visibility Policy — resolver unit tests ===\n");

// ── 1-4: company_managed — elevated roles get full details for ANY internal user ──
for (const role of ["master_admin", "admin", "exec"]) {
  const r = resolveCalendarVisibility({ id: OTHER_ID, globalRole: role }, acct("company_managed"), OWNER_ID);
  assertTrue(`[company_managed] ${role} can view full details of any user's work calendar`, r.canViewDetails === true && r.reason === "elevated_role");
  assertTrue(`[company_managed] ${role} cannot edit without explicit permission`, r.canEdit === false);
}
{
  const r = resolveCalendarVisibility({ id: OTHER_ID, globalRole: "master_admin" }, null, OWNER_ID);
  assertTrue("[company_managed] null calendarAccount (native event) defaults to company_managed for elevated role", r.canViewDetails === true);
}

// ── 5-7: company_managed — non-elevated roles fall through to explicit_permission ──
{
  const r = resolveCalendarVisibility({ id: OTHER_ID, globalRole: "sales_rep" }, acct("company_managed"), OWNER_ID);
  assertEq("[company_managed] non-elevated role reason is explicit_permission (caller must pre-filter by calendar_team)", r.reason, "explicit_permission");
  assertTrue("[company_managed] non-elevated role cannot edit", r.canEdit === false);
}
{
  const r = resolveCalendarVisibility({ id: OTHER_ID, globalRole: "support" }, acct("company_managed"), OWNER_ID);
  assertEq("[company_managed] another non-elevated role also gets explicit_permission reason", r.reason, "explicit_permission");
}

// ── 8-11: private_personal — busy-only for everyone except owner, REGARDLESS of role ──
for (const role of ["master_admin", "admin", "exec", "sales_rep"]) {
  const r = resolveCalendarVisibility({ id: OTHER_ID, globalRole: role }, acct("private_personal"), OWNER_ID);
  assertTrue(`[private_personal] ${role} (non-owner) gets busy-only, NOT full details`, r.canViewDetails === false && r.canViewBusyOnly === true);
  assertEq(`[private_personal] ${role} resolver reason is private_calendar`, r.reason, "private_calendar");
}

// ── 12-14: external_calendar — same busy-only rule ──
for (const role of ["master_admin", "admin", "exec"]) {
  const r = resolveCalendarVisibility({ id: OTHER_ID, globalRole: role }, acct("external_calendar"), OWNER_ID);
  assertTrue(`[external_calendar] ${role} (non-owner) gets busy-only`, r.canViewDetails === false && r.canViewBusyOnly === true);
}

// ── 15: team_shared — full details for any internal user, no edit ──
{
  const r = resolveCalendarVisibility({ id: OTHER_ID, globalRole: "sales_rep" }, acct("team_shared"), OWNER_ID);
  assertTrue("[team_shared] any internal user gets full details", r.canViewDetails === true && r.reason === "team_shared");
  assertTrue("[team_shared] no edit without explicit permission", r.canEdit === false);
}

// ── 16: owner always gets full details + edit, on every visibility type ──
for (const vt of ["private_personal", "external_calendar", "company_managed", "team_shared"] as const) {
  const r = resolveCalendarVisibility({ id: OWNER_ID, globalRole: "sales_rep" }, acct(vt), OWNER_ID);
  assertTrue(`[owner] owner always sees full details on ${vt}`, r.canViewDetails === true && r.canEdit === true && r.reason === "owner");
}

// ── 17: sanitizeEventForBusyOnly strips all sensitive fields ──
{
  const rawEvent = {
    id: 1, userId: OWNER_ID, title: "1:1 with CFO re: Series B",
    description: "Confidential financials attached", location: "123 Main St",
    meetingUrl: "https://zoom.us/j/12345", invitees: ["cfo@voltsafe.com"],
    attendeeDetails: [{ email: "cfo@voltsafe.com", name: "CFO" }],
    startTime: new Date("2026-07-10T14:00:00Z"), endTime: new Date("2026-07-10T15:00:00Z"),
    status: "scheduled", calendarName: "Personal", externalProvider: "google", externalId: "abc123",
    linkedObjectType: "contact", linkedObjectId: 42, color: "#ff0000",
  };
  const sanitized = sanitizeEventForBusyOnly(rawEvent);
  assertEq("[sanitize] title becomes 'Busy'", sanitized.title, "Busy");
  assertEq("[sanitize] description is stripped", sanitized.description, null);
  assertEq("[sanitize] location is stripped", sanitized.location, null);
  assertEq("[sanitize] meetingUrl is stripped", sanitized.meetingUrl, null);
  assertEq("[sanitize] invitees are stripped", sanitized.invitees, null);
  assertEq("[sanitize] attendeeDetails are stripped", sanitized.attendeeDetails, null);
  assertEq("[sanitize] calendarName is stripped", sanitized.calendarName, null);
  assertEq("[sanitize] externalProvider/externalId are stripped", [sanitized.externalProvider, sanitized.externalId], [null, null]);
  assertEq("[sanitize] linkedObjectType/linkedObjectId are stripped", [sanitized.linkedObjectType, sanitized.linkedObjectId], [null, null]);
  assertTrue("[sanitize] startTime/endTime survive (needed for busy/free)", sanitized.startTime === rawEvent.startTime && sanitized.endTime === rawEvent.endTime);
  assertTrue("[sanitize] isBusyOnly flag set", sanitized.isBusyOnly === true);
  assertEq("[sanitize] visibilityLabel is 'Busy'", sanitized.visibilityLabel, "Busy");
}

// ── 18-19: classifyCalendarConnection domain rules ──
assertEq("[classify] @voltsafe.com => company_managed", classifyCalendarConnection("trevor@voltsafe.com"), "company_managed");
assertEq("[classify] non-@voltsafe.com => private_personal", classifyCalendarConnection("trevor@gmail.com"), "private_personal");
assertEq("[classify] case-insensitive domain match", classifyCalendarConnection("Trevor@VoltSafe.COM"), "company_managed");
assertEq("[classify] null/empty email defaults to private_personal (fail-closed)", classifyCalendarConnection(null), "private_personal");

// ── 20: canEdit is false for every non-owner scenario (view-only enforcement) ──
{
  const scenarios: Array<[string, CalendarAccountInfo]> = [
    ["company_managed + elevated", acct("company_managed")],
    ["team_shared", acct("team_shared")],
    ["private_personal", acct("private_personal")],
    ["external_calendar", acct("external_calendar")],
  ];
  let allNoEdit = true;
  for (const [, info] of scenarios) {
    const r = resolveCalendarVisibility({ id: OTHER_ID, globalRole: "master_admin" }, info, OWNER_ID);
    if (r.canEdit !== false) allNoEdit = false;
  }
  assertTrue("[view-only] no non-owner scenario grants canEdit=true (view-only, no edit without explicit permission)", allNoEdit);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
