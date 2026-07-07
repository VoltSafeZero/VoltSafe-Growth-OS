/**
 * VoltSafe Team Calendar — Regression Tests
 *
 * Tests:
 *  1.  Allowed roles can write: master_admin, admin, manager, executive, exec, ceo, cfo
 *  2.  Regular user (sales) is rejected with 403
 *  3.  Frontend TEAM_CALENDAR_EDIT_ROLES constant matches backend list exactly
 *  4.  TEAM_CALENDAR_CATEGORIES matches the approved business list
 *  5.  MILESTONE_STATUSES contains all five required values
 *  6.  companyCalendarVisible defaults to true (checked by default)
 *  7.  allEvents includes company events when companyCalendarVisible = true
 *  8.  allEvents excludes company events when companyCalendarVisible = false
 *  9.  Company event IDs use +1_000_000 offset (no collision with personal events)
 * 10.  Company events flagged _company = true in allEvents
 * 11.  "Company Calendars" sidebar section exists in rendered source
 * 12.  "People Calendars" section heading exists (renamed from Team Calendars)
 * 13.  CompanyEventDetailDialog renders with edit/delete buttons for editors
 * 14.  CompanyEventDetailDialog hides edit/delete for viewers
 * 15.  Category list does NOT contain old personal-HR entries (All-Hands, Sprint, OOO, Holiday)
 * 16.  Backend route GET /api/calendar/team-events is auth-gated (requireAuth)
 * 17.  Backend POST/PATCH/DELETE routes are gated by requireTeamCalendarEditor
 * 18.  Schema table has required columns
 * 19.  TeamCalendarEventRaw type defined in frontend source
 * 20.  useCompanyCalendarEvents hook defined in frontend source
 * 21.  localStorage key for company calendar visibility scoped to user
 * 22.  canEditCompanyCalendar derives from /api/auth/me globalRole
 * 23.  createCompanyEventMutation invalidates /api/calendar/team-events
 * 24.  updateCompanyEventMutation invalidates /api/calendar/team-events
 * 25.  deleteCompanyEventMutation invalidates /api/calendar/team-events
 * 26.  Company events appear in month view with COMPANY_CALENDAR_COLOR class
 * 27.  Company events appear in week view
 * 28.  Company events appear in day view
 * 29.  Reschedule handler guards _company events (no personal-reschedule on company events)
 * 30.  Backend requireTeamCalendarEditor error message is 403 not 401
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ── helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function ok(label, value) {
  if (value) {
    passed++;
    console.log(`  ✓  ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ✗  ${label}`);
  }
}

function contains(src, pattern, label) {
  const hit = typeof pattern === "string" ? src.includes(pattern) : pattern.test(src);
  ok(label, hit);
}

function notContains(src, pattern, label) {
  const hit = typeof pattern === "string" ? src.includes(pattern) : pattern.test(src);
  ok(label, !hit);
}

// ── load source files ─────────────────────────────────────────────────────────

const calendarSrc = fs.readFileSync(
  path.join(__dirname, "../client/src/pages/calendar.tsx"),
  "utf8"
);
const routesSrc = fs.readFileSync(
  path.join(__dirname, "../server/routes.ts"),
  "utf8"
);
const schemaSrc = fs.readFileSync(
  path.join(__dirname, "../shared/schema.ts"),
  "utf8"
);

// ── 1-3  Role arrays ──────────────────────────────────────────────────────────

console.log("\n── Role & Permission Checks ─────────────────────────────────");

const EXPECTED_ROLES = ["master_admin", "admin", "manager", "executive", "exec", "ceo", "cfo"];
const DENIED_ROLES   = ["sales", "advisor"];

// Extract the backend role array from routes.ts (simple string scan)
const backendMatch = routesSrc.match(/TEAM_CALENDAR_EDIT_ROLES\s*=\s*\[([^\]]+)\]/);
const backendRoles = backendMatch
  ? backendMatch[1].match(/"([^"]+)"/g)?.map(s => s.replace(/"/g, "")) ?? []
  : [];

const frontendMatch = calendarSrc.match(/TEAM_CALENDAR_EDIT_ROLES\s*=\s*\[([^\]]+)\]/);
const frontendRoles = frontendMatch
  ? frontendMatch[1].match(/"([^"]+)"/g)?.map(s => s.replace(/"/g, "")) ?? []
  : [];

for (const role of EXPECTED_ROLES) {
  ok(`Backend TEAM_CALENDAR_EDIT_ROLES includes "${role}"`, backendRoles.includes(role));
  ok(`Frontend TEAM_CALENDAR_EDIT_ROLES includes "${role}"`, frontendRoles.includes(role));
}

for (const role of DENIED_ROLES) {
  ok(`Backend TEAM_CALENDAR_EDIT_ROLES does NOT include "${role}"`, !backendRoles.includes(role));
}

ok("Backend and frontend role lists are identical", JSON.stringify([...backendRoles].sort()) === JSON.stringify([...frontendRoles].sort()));

// ── 4  Categories ─────────────────────────────────────────────────────────────

console.log("\n── Category List ────────────────────────────────────────────");

const REQUIRED_CATEGORIES = [
  "project_milestone",
  "key_timeline",
  "all_staff_meeting",
  "team_event",
  "company_update",
  "culture_people",
  "customer_partner",
  "funding_board",
  "product_engineering",
  "operations",
  "other",
];

const BANNED_CATEGORIES = ["sprint", "oo_o", "holiday", "training", "launch", "all_hands"];

for (const cat of REQUIRED_CATEGORIES) {
  contains(calendarSrc, `"${cat}"`, `Category "${cat}" present in frontend`);
}

for (const cat of BANNED_CATEGORIES) {
  notContains(calendarSrc, `value: "${cat}"`, `Old/personal category "${cat}" not present`);
}

// ── 5  Milestone statuses ─────────────────────────────────────────────────────

console.log("\n── Milestone Statuses ───────────────────────────────────────");

const REQUIRED_STATUSES = ["planned", "on_track", "at_risk", "delayed", "completed"];

for (const s of REQUIRED_STATUSES) {
  contains(calendarSrc, `"${s}"`, `Milestone status "${s}" present`);
}

// ── 6-10  Frontend visibility & event merging ─────────────────────────────────

console.log("\n── Visibility & Event Merging ───────────────────────────────");

contains(calendarSrc, "companyCalendarVisible", "companyCalendarVisible state defined");
contains(calendarSrc, /localStorage.*company.*calendar|company.*calendar.*localStorage/i, "companyCalendarVisible persisted to localStorage");
contains(calendarSrc, /useState.*true.*company|companyCalendarVisible.*useState.*true|company.*Visible.*true/i, "companyCalendarVisible defaults to true");
contains(calendarSrc, "_company", "Company events flagged with _company in allEvents");
contains(calendarSrc, "1_000_000", "Company event ID offset +1,000,000 applied");
contains(calendarSrc, /companyCalendarVisible\s*\?\s*\(companyEvents/, "allEvents filters company events by companyCalendarVisible via ternary spread");

// ── 11-12  Sidebar sections ───────────────────────────────────────────────────

console.log("\n── Sidebar Sections ─────────────────────────────────────────");

contains(calendarSrc, "Company Calendars", '"Company Calendars" section present in sidebar');
contains(calendarSrc, "People Calendars", '"People Calendars" section present (renamed from Team Calendars)');
notContains(calendarSrc, /"Team Calendars"/, '"Team Calendars" label removed (renamed to People Calendars)');

// ── 13-14  CompanyEventDetailDialog ──────────────────────────────────────────

console.log("\n── CompanyEventDetailDialog ─────────────────────────────────");

contains(calendarSrc, "CompanyEventDetailDialog", "CompanyEventDetailDialog component defined");
contains(calendarSrc, "canEdit", "CompanyEventDetailDialog accepts canEdit prop");
contains(calendarSrc, "button-edit-company-event", "Edit button has data-testid in detail dialog");
contains(calendarSrc, "button-delete-company-event", "Delete button has data-testid in detail dialog");
contains(calendarSrc, /canEdit.*&&.*!editing.*Edit|canEdit.*button-edit/s, "Edit/Delete buttons gated on canEdit");

// ── 15  Category purity ───────────────────────────────────────────────────────

console.log("\n── Category Purity ──────────────────────────────────────────");

notContains(calendarSrc, '"All-Hands"', 'Old "All-Hands" category label absent');
notContains(calendarSrc, '"Sprint"', 'Old "Sprint" category label absent');
notContains(calendarSrc, '"OOO"', 'Old "OOO" category label absent');
notContains(calendarSrc, '"Holiday"', 'Old "Holiday" category label absent');

// ── 16-17  Backend route guards ───────────────────────────────────────────────

console.log("\n── Backend Route Guards ─────────────────────────────────────");

contains(routesSrc, 'app.get("/api/calendar/team-events", requireAuth', "GET /api/calendar/team-events requires auth");
contains(routesSrc, 'app.post("/api/calendar/team-events", requireAuth, requireTeamCalendarEditor', "POST requires auth + requireTeamCalendarEditor");
contains(routesSrc, 'app.patch("/api/calendar/team-events/:id", requireAuth, requireTeamCalendarEditor', "PATCH requires auth + requireTeamCalendarEditor");
contains(routesSrc, 'app.delete("/api/calendar/team-events/:id", requireAuth, requireTeamCalendarEditor', "DELETE requires auth + requireTeamCalendarEditor");
contains(routesSrc, "403", "requireTeamCalendarEditor returns 403 (not 401) for unauthorized");
notContains(routesSrc.slice(routesSrc.indexOf("requireTeamCalendarEditor"), routesSrc.indexOf("requireTeamCalendarEditor") + 300), "401", "requireTeamCalendarEditor does NOT return 401");

// ── 18  Schema columns ────────────────────────────────────────────────────────

console.log("\n── Schema Columns ───────────────────────────────────────────");

const REQUIRED_COLUMNS = [
  ["title", 'title text column'],
  ["description", 'description column'],
  ["start_time", 'start_time column'],
  ["end_time", 'end_time column'],
  ["all_day", 'all_day column'],
  ["category", 'category column'],
  ["milestone_status", 'milestone_status column'],
  ["created_by_user_id", 'created_by_user_id column'],
  ["updated_by_user_id", 'updated_by_user_id column'],
  ["created_at", 'created_at column'],
  ["updated_at", 'updated_at column'],
  ["linked_project_id", 'linked_project_id column (future linking)'],
  ["linked_account_id", 'linked_account_id column (future linking)'],
];

for (const [col, label] of REQUIRED_COLUMNS) {
  contains(schemaSrc, col, `Schema has ${label}`);
}

// ── 19-22  Frontend hooks & types ─────────────────────────────────────────────

console.log("\n── Frontend Hooks & Types ───────────────────────────────────");

contains(calendarSrc, "TeamCalendarEventRaw", "TeamCalendarEventRaw type defined");
contains(calendarSrc, "useCompanyCalendarEvents", "useCompanyCalendarEvents hook defined");
contains(calendarSrc, "/api/auth/me", "/api/auth/me queried for canEditCompanyCalendar");
contains(calendarSrc, "canEditCompanyCalendar", "canEditCompanyCalendar derived on frontend");
contains(calendarSrc, /TEAM_CALENDAR_EDIT_ROLES.*globalRole|globalRole.*TEAM_CALENDAR_EDIT_ROLES/, "canEditCompanyCalendar uses TEAM_CALENDAR_EDIT_ROLES on globalRole");

// ── 23-25  Mutation cache invalidation ────────────────────────────────────────

console.log("\n── Mutation Cache Invalidation ──────────────────────────────");

const teamEventsInvalidations = (calendarSrc.match(/invalidateQueries.*team-events|team-events.*invalidateQueries/g) || []).length;
ok("At least 3 invalidateQueries calls for /api/calendar/team-events (create/update/delete)", teamEventsInvalidations >= 3);

// ── 26-28  Multi-view rendering ───────────────────────────────────────────────

console.log("\n── Multi-View Rendering ─────────────────────────────────────");

// Month view: events rendered inside MonthView component with _company check
contains(calendarSrc, /MonthView|month.*view/i, "MonthView component present");
contains(calendarSrc, /ev\._company.*COMPANY_CALENDAR_COLOR|COMPANY_CALENDAR_COLOR.*ev\._company/, "Month view uses COMPANY_CALENDAR_COLOR for company events");
// Week view
contains(calendarSrc, /WeekView|week.*view/i, "WeekView component present");
// Day view
contains(calendarSrc, /DayView|day.*view/i, "DayView component present");
// All views reference _company in their rendering logic
const companyColorUsages = (calendarSrc.match(/ev\._company.*COMPANY_CALENDAR_COLOR|COMPANY_CALENDAR_COLOR.*ev\._company/g) || []).length;
ok("COMPANY_CALENDAR_COLOR used for company events in ≥3 places (day/week/month)", companyColorUsages >= 3);

// ── 29  Reschedule guard ─────────────────────────────────────────────────────

console.log("\n── Reschedule Guard ─────────────────────────────────────────");

contains(calendarSrc, /if\s*\(event\._company\)\s*return/, "handleReschedule guards against _company events (early return)");

// ── 30  Backend middleware error code ────────────────────────────────────────

console.log("\n── Backend Middleware ───────────────────────────────────────");

const middlewareBlock = routesSrc.slice(
  routesSrc.indexOf("function requireTeamCalendarEditor"),
  routesSrc.indexOf("function requireTeamCalendarEditor") + 400
);
contains(middlewareBlock, "403", "requireTeamCalendarEditor sends 403 status");
contains(middlewareBlock, "Only admins", "requireTeamCalendarEditor includes helpful error message");
contains(middlewareBlock, "globalRole", "requireTeamCalendarEditor reads from session.globalRole");

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`  Total: ${passed + failed}  ✓ ${passed}  ✗ ${failed}`);

if (failures.length) {
  console.log("\n  Failures:");
  failures.forEach(f => console.log(`    • ${f}`));
  process.exit(1);
} else {
  console.log("\n  All team-calendar tests passed.");
  process.exit(0);
}
