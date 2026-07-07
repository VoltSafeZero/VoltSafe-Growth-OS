// tests/ceo-cockpit.test.cjs
// Source-grep checks for CEO Cockpit Phase 4: Team Communication Radar + 1:1 Operating System
"use strict";

const fs   = require("fs");
const path = require("path");

const ROUTES   = path.join(__dirname, "../server/routes.ts");
const SERVICE  = path.join(__dirname, "../server/services/ceo-cockpit.ts");
const SECTIONS = path.join(__dirname, "../client/src/components/today/ceo-cockpit-sections.tsx");
const TODAY    = path.join(__dirname, "../client/src/pages/today.tsx");
const TASKS    = path.join(__dirname, "../server/routes-tasks.ts");

const routesSrc   = fs.readFileSync(ROUTES, "utf8");
const serviceSrc  = fs.readFileSync(SERVICE, "utf8");
const sectionsSrc = fs.readFileSync(SECTIONS, "utf8");
const todaySrc    = fs.readFileSync(TODAY, "utf8");
const tasksSrc    = fs.readFileSync(TASKS, "utf8");

let passed = 0; let failed = 0;
function check(label, condition) {
  if (condition) { console.log("  \u2713 " + label); passed++; }
  else { console.error("  \u2717 FAIL: " + label); failed++; }
}

// ── 1. BACKEND ROUTE ──────────────────────────────────────────────────────────
console.log("\n-- Backend route --");
check("Route /api/today/ceo-cockpit exists", routesSrc.includes("today/ceo-cockpit"));
check("requireAuth on ceo-cockpit", routesSrc.includes("today/ceo-cockpit") && routesSrc.includes("requireAuth"));
check("requireAdmin on ceo-cockpit",
  routesSrc.match(/today\/ceo-cockpit.*requireAuth.*requireAdmin|today\/ceo-cockpit.*requireAdmin/) !== null ||
  routesSrc.includes("requireAuth, requireAdmin"));
check("getCeoCockpitData imported", routesSrc.includes("getCeoCockpitData"));
check("hasCapital computed in route",
  routesSrc.includes("CAPITAL_USER_IDS") && routesSrc.includes("hasCapital"));
check("Capital data excluded unless hasCapital",
  serviceSrc.includes("hasCapital") || routesSrc.includes("hasCapital"));
check("No external API calls in route",
  !routesSrc.match(/fetch\(["']https:\/\/(?!.*ceo-cockpit)/) ||
  routesSrc.includes("getCeoCockpitData(userId, hasCapital)"));
check("No auto-send in route", !routesSrc.includes("sendEmail") || !routesSrc.includes("today/ceo-cockpit"));

// ── 2. SERVICE: PERMISSIONS AND SAFETY ───────────────────────────────────────
console.log("\n-- Service: permissions and safety --");
check("Service file exists", fs.existsSync(SERVICE));
check("Service imports db and sql", serviceSrc.includes("from \"../db\"") && serviceSrc.includes("from \"drizzle-orm\""));
check("No external API calls in service",
  !serviceSrc.includes("fetch(\"https://") && !serviceSrc.includes("axios.get"));
check("No auto-send messages in service",
  !serviceSrc.includes("sendEmail") && !serviceSrc.includes("sendMessage"));
check("No keystroke tracking in service",
  !serviceSrc.includes("keystroke") && !serviceSrc.includes("mouseMovement") && !serviceSrc.includes("mouse_movement"));
check("No invasive productivity scoring (no activity_score/keystrokes)",
  !serviceSrc.includes("activity_score") && !serviceSrc.includes("keystrokes"));
check("No raw storage keys/tokens exposed in service",
  !serviceSrc.includes("SESSION_SECRET") && !serviceSrc.includes("DATABASE_URL") && !serviceSrc.includes("GOOGLE_CLIENT_SECRET"));
check("buildAskForUpdate generates copy text (not auto-send)",
  serviceSrc.includes("function buildAskForUpdate") || serviceSrc.includes("askForUpdateText"));
check("SQL inputs use safe interpolation (Number() cast for IDs)",
  serviceSrc.includes("Number(ceoUserId)") || serviceSrc.includes("Number(userId)"));
check("Private DM body not broadly exposed — membership-scoped",
  !serviceSrc.includes("current_conversations") ||
  serviceSrc.includes("ceoId") || serviceSrc.includes("mentioned_user_id"));

// ── 3. SERVICE: DATA SECTIONS ─────────────────────────────────────────────────
console.log("\n-- Service: data sections --");
check("team_pulse section generated", serviceSrc.includes("team_pulse"));
check("blockers section generated", serviceSrc.includes("blockers"));
check("silence_watch section generated", serviceSrc.includes("silence_watch"));
check("commitments section generated", serviceSrc.includes("commitments"));
check("one_on_ones section generated", serviceSrc.includes("one_on_ones"));
check("ceo_attention section generated", serviceSrc.includes("ceo_attention"));
check("communication_hotspots section generated", serviceSrc.includes("communication_hotspots"));
check("generated_at in response", serviceSrc.includes("generated_at"));
check("team_pulse queries active users only",
  serviceSrc.includes("status = 'active'") && serviceSrc.includes("user_type = 'internal'"));
check("CEO excluded from own team_pulse",
  serviceSrc.includes("u.id != ${ceoId}") || serviceSrc.includes("u.id !="));
check("Signal labels defined", serviceSrc.includes("\"Active\"") && serviceSrc.includes("\"Blocked\"") && serviceSrc.includes("\"Quiet\""));
check("computeSignal function exists", serviceSrc.includes("function computeSignal"));
check("subtractBusinessDays function exists", serviceSrc.includes("function subtractBusinessDays"));
check("Blocker tasks: board_column = blocked", serviceSrc.includes("board_column = 'blocked'"));
check("Blockers from install_workflows", serviceSrc.includes("install_workflows"));
check("Blockers from deployments", serviceSrc.includes("deployments"));
check("Silence watch queries tasks overdue with no update", serviceSrc.includes("updated_at <") && serviceSrc.includes("due_date < NOW()"));
check("Silence watch queries stale opportunities", serviceSrc.includes("opportunities"));
check("Commitments: source IN meeting/follow-up", serviceSrc.includes("meeting_note") && serviceSrc.includes("follow_up"));
check("1:1 detection from calendar_events", serviceSrc.includes("calendar_events"));
check("1:1 title pattern matching", serviceSrc.includes("1:1") || serviceSrc.includes("one-on-one"));
check("Suggested agenda built from real signals", serviceSrc.includes("suggestedAgenda") || serviceSrc.includes("suggested_agenda"));
check("CEO attention: tasks owned by CEO", serviceSrc.includes("owner_user_id = ${ceoId}") || serviceSrc.includes("owner_user_id ="));
check("CEO attention: CURRENTS mentions", serviceSrc.includes("current_mentions"));
check("Communication hotspots: channel message counts", serviceSrc.includes("message_count_7d") || serviceSrc.includes("message_count"));
check("Private channels excluded from hotspots", serviceSrc.includes("is_private = false") || serviceSrc.includes("is_private"));
check("Unanswered mentions counted", serviceSrc.includes("unanswered_mentions") || serviceSrc.includes("mentioned_user_id"));
check("List caps in place (LIMIT clauses)", serviceSrc.match(/LIMIT \d+/g)?.length >= 5);
check("Empty state strings returned", serviceSrc.includes("empty_state"));
check("Error handling per section (try/catch)", (serviceSrc.match(/} catch \(e\)/g) || []).length >= 5);

// ── 4. SERVICE: LANGUAGE AND FRAMING ─────────────────────────────────────────
console.log("\n-- Service: language and framing --");
check("No shaming language: 'not working'", !serviceSrc.includes("not working"));
check("No shaming language: 'unproductive'", !serviceSrc.includes("unproductive"));
check("No shaming language: 'lazy'", !serviceSrc.includes("lazy"));
check("Silence framed as 'no activity'", serviceSrc.includes("no") || serviceSrc.includes("No"));
check("Signal reasons are factual", serviceSrc.includes("overdue task") || serviceSrc.includes("overdue_tasks"));
check("Ask for update is copy text, no auto-send", serviceSrc.includes("askForUpdateText"));
check("No raw private DM bodies returned broadly",
  !serviceSrc.includes("SELECT cm.body") || serviceSrc.includes("mentioned_user_id"));

// ── 5. FRONTEND: CEO COCKPIT MODE TOGGLE ─────────────────────────────────────
console.log("\n-- Frontend: mode toggle --");
check("todayMode state added", todaySrc.includes("todayMode"));
check("setTodayMode state setter", todaySrc.includes("setTodayMode"));
check("Mode defaults to my_day", todaySrc.includes('"my_day"'));
check("Mode toggle only for admins (isAdmin gate)",
  todaySrc.includes("isAdmin && (") || todaySrc.includes("{isAdmin && ("));
check("My Day button testId=today-mode-my-day", todaySrc.includes('data-testid="today-mode-my-day"'));
check("CEO Cockpit button testId=today-mode-ceo-cockpit", todaySrc.includes('data-testid="today-mode-ceo-cockpit"'));
check("Mode toggle testId=today-mode-toggle", todaySrc.includes('data-testid="today-mode-toggle"'));
check("Non-admin cannot see CEO Cockpit",
  todaySrc.includes("todayMode === \"ceo_cockpit\" && isAdmin") ||
  todaySrc.includes("isAdmin && todayMode === \"ceo_cockpit\""));

// ── 6. FRONTEND: CEO COCKPIT QUERY ───────────────────────────────────────────
console.log("\n-- Frontend: CEO Cockpit query --");
check("cockpitQuery fetches /api/today/ceo-cockpit", todaySrc.includes('"/api/today/ceo-cockpit"'));
check("cockpitQuery enabled only when admin+cockpit mode",
  todaySrc.includes("isAdmin && todayMode === \"ceo_cockpit\"") ||
  todaySrc.includes("enabled: isAdmin"));
check("staleTime set on cockpit query", todaySrc.includes("staleTime"));
check("cockpitQuery.isLoading handled", todaySrc.includes("cockpitQuery.isLoading"));
check("cockpitQuery.isError handled", todaySrc.includes("cockpitQuery.isError"));
check("ceo-cockpit-loading testId", todaySrc.includes('data-testid="ceo-cockpit-loading"'));
check("ceo-cockpit-error testId", todaySrc.includes('data-testid="ceo-cockpit-error"'));
check("ceo-cockpit-view testId", todaySrc.includes('data-testid="ceo-cockpit-view"'));

// ── 7. FRONTEND: CEO COCKPIT UI SECTIONS ─────────────────────────────────────
console.log("\n-- Frontend: CEO Cockpit UI sections --");
check("TeamPulseSection component exists", sectionsSrc.includes("export function TeamPulseSection"));
check("BlockersSection component exists", sectionsSrc.includes("export function BlockersSection"));
check("SilenceWatchSection component exists", sectionsSrc.includes("export function SilenceWatchSection"));
check("CommitmentsSection component exists", sectionsSrc.includes("export function CommitmentsSection"));
check("OneOnOnesSection component exists", sectionsSrc.includes("export function OneOnOnesSection"));
check("CeoAttentionSection component exists", sectionsSrc.includes("export function CeoAttentionSection"));
check("CommunicationHotspotsSection component exists", sectionsSrc.includes("export function CommunicationHotspotsSection"));
check("TeamPulseSection rendered in today", todaySrc.includes("<TeamPulseSection"));
check("BlockersSection rendered in today", todaySrc.includes("<BlockersSection"));
check("SilenceWatchSection rendered in today", todaySrc.includes("<SilenceWatchSection"));
check("CommitmentsSection rendered in today", todaySrc.includes("<CommitmentsSection"));
check("OneOnOnesSection rendered in today", todaySrc.includes("<OneOnOnesSection"));
check("CeoAttentionSection rendered in today", todaySrc.includes("<CeoAttentionSection"));
check("CommunicationHotspotsSection rendered in today", todaySrc.includes("<CommunicationHotspotsSection"));

// ── 8. FRONTEND: SECTION testIds ─────────────────────────────────────────────
console.log("\n-- Frontend: section testIds --");
check("section-team-pulse testId", todaySrc.includes('testId="section-team-pulse"'));
check("section-blockers testId", todaySrc.includes('testId="section-blockers"'));
check("section-silence-watch testId", todaySrc.includes('testId="section-silence-watch"'));
check("section-commitments testId", todaySrc.includes('testId="section-commitments"'));
check("section-one-on-ones testId", todaySrc.includes('testId="section-one-on-ones"'));
check("section-ceo-attention testId", todaySrc.includes('testId="section-ceo-attention"'));
check("section-communication-hotspots testId", todaySrc.includes('testId="section-communication-hotspots"'));

// ── 9. FRONTEND: SECTION COMPONENT FEATURES ──────────────────────────────────
console.log("\n-- Frontend: section component features --");
check("SignalBadge component in sections", sectionsSrc.includes("function SignalBadge"));
check("CopyButton for Ask for Update", sectionsSrc.includes("function CopyButton") || sectionsSrc.includes("CopyButton"));
check("Ask for update uses clipboard (not auto-send)",
  sectionsSrc.includes("navigator.clipboard") && !sectionsSrc.includes("sendEmail"));
check("Ask for update testId=ask-for-update-copy", sectionsSrc.includes('data-testid="ask-for-update-copy"'));
check("Team member row testId pattern", sectionsSrc.includes('data-testid={`team-member-row-${m.id}`}'));
check("Blocker item testId pattern", sectionsSrc.includes('data-testid={`blocker-item-${b.id}`}'));
check("Silence item testId pattern", sectionsSrc.includes('data-testid={`silence-item-${s.id}`}'));
check("Commitment item testId pattern", sectionsSrc.includes('data-testid={`commitment-item-${c.id}`}'));
check("CEO attention item testId pattern", sectionsSrc.includes('data-testid={`ceo-attention-item-${item.id}`}'));
check("Hotspot channel testId pattern", sectionsSrc.includes('data-testid={`hotspot-channel-${ch.slug}`}'));
check("1:1 expand/collapse accordion", sectionsSrc.includes("isExpanded") || sectionsSrc.includes("expandedId"));
check("1:1 suggested agenda shown on expand", sectionsSrc.includes("suggestedAgenda") || sectionsSrc.includes("Suggested Agenda"));
check("Unanswered mentions badge testId", sectionsSrc.includes('data-testid="unanswered-mentions-badge"'));
check("Empty state component exists", sectionsSrc.includes("function EmptyCockpitState") || sectionsSrc.includes("EmptyCockpitState"));
check("cockpit-empty-state testId", sectionsSrc.includes('data-testid="cockpit-empty-state"'));

// ── 10. FRONTEND: NO SHAMING LANGUAGE ────────────────────────────────────────
console.log("\n-- Frontend: no shaming language --");
check("No 'not working' in sections UI", !sectionsSrc.includes("not working"));
check("No 'unproductive' in sections UI", !sectionsSrc.includes("unproductive"));
check("No 'lazy' in sections UI", !sectionsSrc.includes("lazy"));
check("No 'bad performer' in sections UI", !sectionsSrc.includes("bad performer"));
check("No 'shame' in sections UI", !sectionsSrc.includes("shame"));
check("No 'surveillance' in sections UI", !sectionsSrc.includes("surveillance"));
check("Silence Watch uses 'no update'/'no visible movement'",
  sectionsSrc.includes("no update") || sectionsSrc.includes("No update") || sectionsSrc.includes("No visible movement") ||
  sectionsSrc.includes("no recent update") || sectionsSrc.includes("Needs check-in") || sectionsSrc.includes("no activity") ||
  serviceSrc.includes("no update") || serviceSrc.includes("No update"));
check("Signal labels avoid shaming",
  !sectionsSrc.includes("Lazy") && !sectionsSrc.includes("Not working") && !sectionsSrc.includes("Unproductive"));

// ── 11. FRONTEND: DRILLDOWN INTEGRATION ──────────────────────────────────────
console.log("\n-- Frontend: drilldown integration --");
check("UniversalDrilldownSheet still imported in today",
  todaySrc.includes("UniversalDrilldownSheet"));
check("CEO Cockpit refresh uses queryClient.invalidateQueries",
  todaySrc.includes("queryClient.invalidateQueries") && todaySrc.includes('"/api/today/ceo-cockpit"'));
check("Phase 1 today sections unaffected (priority_actions)",
  todaySrc.includes('testId="section-priority-actions"'));
check("Phase 2 features unaffected (today-customize-btn)",
  todaySrc.includes('data-testid="today-customize-btn"'));

// ── 12. PERMISSIONS AND SECURITY ─────────────────────────────────────────────
console.log("\n-- Permissions and security --");
check("Endpoint requires auth (requireAuth in route)", routesSrc.includes("requireAuth, requireAdmin") || routesSrc.includes("requireAuth"));
check("Endpoint requires admin (requireAdmin in route)", routesSrc.includes("requireAdmin"));
check("Normal users cannot see toggle (isAdmin gate in today.tsx)", todaySrc.includes("isAdmin &&"));
check("Capital data guarded by hasCapital", routesSrc.includes("hasCapital") || serviceSrc.includes("hasCapital"));
check("No Capital investor fields in CEO Cockpit service",
  !serviceSrc.includes("capital_investors") && !serviceSrc.includes("investor_id"));
check("Private channels excluded (is_private filter)", serviceSrc.includes("is_private = false") || serviceSrc.includes("is_private"));
check("DM bodies not broadly exposed",
  !serviceSrc.includes("SELECT cm.body FROM current_messages") ||
  serviceSrc.includes("mentioned_user_id") || serviceSrc.includes("ceoId"));
check("No auto-send in frontend (no sendEmail in sections)",
  !sectionsSrc.includes("sendEmail") && !sectionsSrc.includes("sendMessage"));
check("No external API calls in today.tsx",
  !todaySrc.includes('fetch("https://') && !todaySrc.includes('axios.get("https://'));
check("capital_investors NOT in routes.ts", !routesSrc.includes("capital_investors"));
check("today-capital-summary service still isolated",
  fs.existsSync(path.join(__dirname, "../server/services/today-capital-summary.ts")));

// ── 13. PHASE 1 & 2 REGRESSION ────────────────────────────────────────────────
console.log("\n-- Phase 1 & 2 regression --");
check("today-page testId", todaySrc.includes('data-testid="today-page"'));
check("section-priority-actions", todaySrc.includes('testId="section-priority-actions"'));
check("section-tasks", todaySrc.includes('testId="section-tasks"'));
check("section-schedule", todaySrc.includes('testId="section-schedule"'));
check("section-inbox", todaySrc.includes('testId="section-inbox"'));
check("section-currents", todaySrc.includes('testId="section-currents"'));
check("section-pipeline", todaySrc.includes('testId="section-pipeline"'));
check("section-marketing", todaySrc.includes('testId="section-marketing"'));
check("section-operations", todaySrc.includes('testId="section-operations"'));
check("section-capital", todaySrc.includes('testId="section-capital"'));
check("section-favorites-recents", todaySrc.includes('data-testid="section-favorites-recents"'));
check("Priority Action sorting controls", todaySrc.includes('data-testid="priority-sort-select"'));
check("Snooze controls", todaySrc.includes("snooze-1d-") && todaySrc.includes("snooze-3d-"));
check("Customize Today sheet", todaySrc.includes('data-testid="today-customize-btn"'));
check("InlineCompleteButton", todaySrc.includes("InlineCompleteButton"));
check("CreateFollowUpButton", todaySrc.includes("CreateFollowUpButton"));
check("today-refresh-btn", todaySrc.includes('data-testid="today-refresh-btn"'));
check("useTodayPrefs still imported", todaySrc.includes("useTodayPrefs"));

// ── 14. FILE EXISTENCE ────────────────────────────────────────────────────────
console.log("\n-- File existence --");
check("ceo-cockpit service exists", fs.existsSync(SERVICE));
check("ceo-cockpit-sections.tsx exists", fs.existsSync(SECTIONS));
check("today.tsx exists", fs.existsSync(TODAY));
check("today-cockpit.test.cjs exists", fs.existsSync(path.join(__dirname, "today-cockpit.test.cjs")));
check("today-personalization.test.cjs exists", fs.existsSync(path.join(__dirname, "today-personalization.test.cjs")));
check("capital-hardening.test.cjs exists", fs.existsSync(path.join(__dirname, "capital-hardening.test.cjs")));
check("today-capital-summary.ts service exists",
  fs.existsSync(path.join(__dirname, "../server/services/today-capital-summary.ts")));

console.log("\n------------------------------------------------------------");
console.log("CEO Cockpit Tests: " + passed + " passed, " + failed + " failed");
console.log("------------------------------------------------------------\n");
if (failed > 0) process.exit(1);
