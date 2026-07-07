/**
 * tests/ceo-briefing.test.cjs
 * CEO Cockpit Phase 7 — Daily Briefing, Weekly Review, Team Briefings, Leadership Agenda
 * Source-grep test suite — no real HTTP calls.
 */
"use strict";

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓  ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ✗  ${label}`);
  }
}

function readFile(rel) {
  try { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }
  catch { return ""; }
}

// ── Files ─────────────────────────────────────────────────────────────────────

const service    = readFile("server/services/ceo-briefing.ts");
const routesTs   = readFile("server/routes.ts");
const panelTsx   = readFile("client/src/components/today/ceo-briefing.tsx");
const todayTsx   = readFile("client/src/pages/today.tsx");

// ── 1. Service file ───────────────────────────────────────────────────────────

console.log("\n[1] Service file exists and exports");
assert(service.length > 0, "service file exists");
assert(service.includes("export async function buildDailyCeoBriefing"), "buildDailyCeoBriefing exported");
assert(service.includes("export async function buildWeeklyCeoReview"), "buildWeeklyCeoReview exported");
assert(service.includes("export async function buildTeamMemberBriefing"), "buildTeamMemberBriefing exported");
assert(service.includes("export async function buildLeadershipMeetingAgenda"), "buildLeadershipMeetingAgenda exported");
assert(service.includes("export async function buildWeeklyReviewDraft"), "buildWeeklyReviewDraft exported");

// ── 2. Safety: no auto-send ───────────────────────────────────────────────────

console.log("\n[2] Safety — no auto-send, no external API calls");
assert(!service.includes("sendEmail("), "service: no sendEmail call");
assert(!service.includes("sendMessage("), "service: no sendMessage call");
assert(!service.includes("sendCurrentsMessage"), "service: no sendCurrentsMessage call");
assert(!service.includes("openai.chat"), "service: no OpenAI dependency");
assert(!service.includes("fetch("), "service: no external fetch() calls");
assert(service.includes("Never sends"), "service: 'Never sends' safety note present");
assert(service.includes("No auto-send"), "service: 'No auto-send' in header comment");
assert(service.includes("Returns copyable text only"), "service: copy-only note for draft functions");

// ── 3. Daily briefing sections ────────────────────────────────────────────────

console.log("\n[3] Daily briefing — required sections");
assert(service.includes("new_blockers"), "service: new_blockers section");
assert(service.includes("unresolved_actions"), "service: unresolved_actions section");
assert(service.includes("overdue_tasks"), "service: overdue_tasks section");
assert(service.includes("stale_opportunities"), "service: stale_opportunities section");
assert(service.includes("commitments_due_soon"), "service: commitments_due_soon section");
assert(service.includes("one_on_ones_today"), "service: one_on_ones_today section");
assert(service.includes("currents_hotspots"), "service: currents_hotspots section");
assert(service.includes("ceo_owned_items"), "service: ceo_owned_items section");
assert(service.includes("top_priorities"), "service: top_priorities array");
assert(service.includes("is_private = false"), "service: private channels excluded from currents hotspots");

// ── 4. Severity model ─────────────────────────────────────────────────────────

console.log("\n[4] Severity model");
assert(service.includes("\"info\"") || service.includes("'info'"), "service: info severity");
assert(service.includes("\"watch\"") || service.includes("'watch'"), "service: watch severity");
assert(service.includes("\"urgent\"") || service.includes("'urgent'"), "service: urgent severity");
assert(service.includes("\"critical\"") || service.includes("'critical'"), "service: critical severity");
assert(service.includes("BriefingSeverity"), "service: BriefingSeverity type defined");
assert(service.includes("empty_state"), "service: each section has empty_state");
assert(service.includes("reason:"), "service: each section has reason field");

// ── 5. Weekly review sections ─────────────────────────────────────────────────

console.log("\n[5] Weekly review — required fields");
assert(service.includes("action_summary"), "service: action_summary in weekly review");
assert(service.includes("blockers_summary"), "service: blockers_summary in weekly review");
assert(service.includes("tasks_summary"), "service: tasks_summary in weekly review");
assert(service.includes("commitments_summary"), "service: commitments_summary in weekly review");
assert(service.includes("team_pulse"), "service: team_pulse in weekly review");
assert(service.includes("opportunity_movement"), "service: opportunity_movement in weekly review");
assert(service.includes("top_wins"), "service: top_wins in weekly review");
assert(service.includes("top_risks"), "service: top_risks in weekly review");
assert(service.includes("leadership_agenda_preview"), "service: leadership_agenda_preview in weekly review");
// Date range support
assert(service.includes("startDate"), "service: startDate option supported");
assert(service.includes("endDate"), "service: endDate option supported");

// ── 6. Weekly review date range ───────────────────────────────────────────────

console.log("\n[6] Weekly review date range support");
assert(service.includes("options.startDate"), "service: startDate read from options");
assert(service.includes("options.endDate"), "service: endDate read from options");
assert(service.includes("7 * 24 * 60 * 60 * 1000"), "service: default 7-day window");

// ── 7. Capital gating ─────────────────────────────────────────────────────────

console.log("\n[7] Capital gating");
assert(service.includes("hasCapital"), "service: hasCapital gating present");
assert(service.includes("actorUser.hasCapital"), "service: capital data only included when hasCapital = true");
assert(service.includes("capital_summary"), "service: capital_summary section gated");
assert(service.includes("capital_movement"), "service: capital_movement gated in weekly review");
// Capital data must not appear outside of hasCapital guard
const capitalBlock = service.match(/if\s*\(actorUser\.hasCapital\)[^}]+capital_investors/s);
assert(!!capitalBlock, "service: capital_investors only queried inside hasCapital guard");

// ── 8. Private channels excluded ─────────────────────────────────────────────

console.log("\n[8] Private channels excluded");
assert(service.includes("is_private = false"), "service: is_private = false filter on channels");
assert(service.includes("type != 'dm'") || service.includes("type <> 'dm'"), "service: DM channels excluded");
assert(!service.includes("is_private = true"), "service: never fetches private channels");

// ── 9. DM bodies not broadly exposed ─────────────────────────────────────────

console.log("\n[9] No broad DM body exposure");
assert(!service.includes("SELECT content FROM current_messages"), "service: no broad DM content SELECT");
assert(!service.includes("SELECT body FROM current_messages"), "service: no DM body SELECT");
assert(!service.includes("SELECT * FROM current_messages"), "service: no SELECT * on DM messages");

// ── 10. Neutral language in team briefing ────────────────────────────────────

console.log("\n[10] Team briefing — neutral operational language");
// Required neutral terms
assert(service.includes("Needs check-in") || service.includes("check-in"), "service: uses 'check-in' language");
assert(service.includes("Blocked"), "service: uses 'Blocked' neutral term");
assert(service.includes("Quiet"), "service: uses 'Quiet' neutral term");
assert(service.includes("Momentum"), "service: uses 'Momentum' neutral term");
assert(service.includes("Follow-up suggested") || service.includes("Needs follow-up"), "service: uses 'follow-up' language");
// Forbidden shaming words
assert(!service.includes("lazy"), "service: no 'lazy' shaming language");
assert(!service.includes("failing"), "service: no 'failing' shaming language");
assert(!service.includes("poor performance"), "service: no 'poor performance' language");
assert(!service.includes("blame"), "service: no 'blame' language");
// Neutral operational fields
assert(service.includes("talking_points"), "service: talking_points field");
assert(service.includes("support_questions"), "service: support_questions field");
assert(service.includes("operational_status"), "service: operational_status field (neutral)");

// ── 11. Leadership agenda sections ───────────────────────────────────────────

console.log("\n[11] Leadership agenda — required sections");
assert(service.includes("decisions_needed"), "service: decisions_needed agenda section");
assert(service.includes("blockers_to_clear"), "service: blockers_to_clear agenda section");
assert(service.includes("commitments_due"), "service: commitments_due agenda section");
assert(service.includes("customer_revenue"), "service: customer_revenue agenda section");
assert(service.includes("product_ops_risks"), "service: product_ops_risks agenda section");
assert(service.includes("wins"), "service: wins agenda section");
assert(service.includes("follow_ups"), "service: follow_ups agenda section");
// Required fields per agenda item
assert(service.includes("why_it_matters"), "service: why_it_matters field per agenda item");
assert(service.includes("suggested_prompt"), "service: suggested_prompt field per agenda item");
assert(service.includes("linked_id"), "service: linked_id metadata per agenda item");
assert(service.includes("linked_type"), "service: linked_type metadata per agenda item");
// Copy text
assert(service.includes("copy_text"), "service: copy_text field in agenda output");

// ── 12. Draft routes — copy-only ─────────────────────────────────────────────

console.log("\n[12] Draft routes — copy-only, no auto-send");
assert(service.includes("buildWeeklyReviewDraft"), "service: buildWeeklyReviewDraft function present");
assert(service.includes("draftText"), "service: buildWeeklyReviewDraft returns draftText");
// Draft function must not call send functions
const draftFnStart = service.indexOf("export async function buildWeeklyReviewDraft");
const draftFnBody = draftFnStart > 0 ? service.slice(draftFnStart, draftFnStart + 800) : "";
assert(!draftFnBody.includes("sendEmail"), "draft function: no sendEmail");
assert(!draftFnBody.includes("sendMessage"), "draft function: no sendMessage");
assert(draftFnBody.includes("draftText"), "draft function: returns draftText field");

// ── 13. Routes — auth + admin gating ─────────────────────────────────────────

console.log("\n[13] Routes — auth + admin required");
assert(routesTs.includes("CEO Briefing (Phase 7)"), "routes: CEO Briefing Phase 7 section header");
assert(routesTs.includes('"/api/today/ceo-briefing/daily"') && routesTs.includes("requireAdmin"), "routes: daily route requires admin");
assert(routesTs.includes('"/api/today/ceo-briefing/weekly"'), "routes: weekly route exists");
assert(routesTs.includes('"/api/today/ceo-briefing/team-member/:userId"'), "routes: team-member route exists");
assert(routesTs.includes('"/api/today/ceo-briefing/leadership-agenda"'), "routes: leadership-agenda route exists");
assert(routesTs.includes('"/api/today/ceo-briefing/weekly/draft"'), "routes: weekly draft route exists");
assert(routesTs.includes('"/api/today/ceo-briefing/leadership-agenda/draft"'), "routes: agenda draft route exists");

// Count requireAdmin in phase 7 block
const p7Start = routesTs.indexOf("CEO Briefing (Phase 7)");
const p7End = routesTs.indexOf("Growth OS Command Center", p7Start);
const p7Block = p7Start > 0 && p7End > 0 ? routesTs.slice(p7Start, p7End) : "";
const adminCount = (p7Block.match(/requireAdmin/g) || []).length;
assert(adminCount >= 6, `routes: all 6 routes in Phase 7 block require admin (found ${adminCount})`);

// ── 14. Routes — no auto-send in briefing block ───────────────────────────────

console.log("\n[14] Routes — no auto-send in Phase 7 block");
assert(!p7Block.includes("sendEmail("), "routes Phase 7: no sendEmail");
assert(!p7Block.includes("sendMessage("), "routes Phase 7: no sendMessage");
assert(!p7Block.includes("sendCurrentsMessage"), "routes Phase 7: no sendCurrentsMessage");
// Draft routes annotated as copy-only
assert(p7Block.includes("Returns copyable text only") || p7Block.includes("copy-only"), "routes: draft routes annotated as copy-only");

// ── 15. Routes — import ───────────────────────────────────────────────────────

console.log("\n[15] Routes — service import");
assert(routesTs.includes("buildDailyCeoBriefing"), "routes: buildDailyCeoBriefing imported");
assert(routesTs.includes("buildWeeklyCeoReview"), "routes: buildWeeklyCeoReview imported");
assert(routesTs.includes("buildTeamMemberBriefing"), "routes: buildTeamMemberBriefing imported");
assert(routesTs.includes("buildLeadershipMeetingAgenda"), "routes: buildLeadershipMeetingAgenda imported");
assert(routesTs.includes("buildWeeklyReviewDraft"), "routes: buildWeeklyReviewDraft imported");
assert(routesTs.includes("from \"./services/ceo-briefing\"") || routesTs.includes("from './services/ceo-briefing'"),
  "routes: import from ./services/ceo-briefing");

// ── 16. Frontend — CEO Briefing panel ────────────────────────────────────────

console.log("\n[16] Frontend — CeoBriefingPanel");
assert(panelTsx.length > 0, "panel file exists");
assert(panelTsx.includes("export function CeoBriefingPanel"), "panel: CeoBriefingPanel exported");
assert(panelTsx.includes("ceo-briefing-panel"), "panel: data-testid ceo-briefing-panel");

// ── 17. Frontend — Tabs ───────────────────────────────────────────────────────

console.log("\n[17] Frontend — Tabs");
assert(panelTsx.includes("ceo-briefing-tabs"), "panel: tabs container testid");
// Tabs use template testid `briefing-tab-${key}` where keys are today/weekly/agenda/team
assert(panelTsx.includes("briefing-tab-") && panelTsx.includes('"today"'), "panel: Today tab testid via template + key");
assert(panelTsx.includes("briefing-tab-") && panelTsx.includes('"weekly"'), "panel: Weekly Review tab testid via template + key");
assert(panelTsx.includes("briefing-tab-") && panelTsx.includes('"agenda"'), "panel: Leadership Agenda tab testid via template + key");
assert(panelTsx.includes("briefing-tab-") && panelTsx.includes('"team"'), "panel: Team Briefings tab testid via template + key");

// ── 18. Frontend — Today tab ──────────────────────────────────────────────────

console.log("\n[18] Frontend — Today tab");
assert(panelTsx.includes("briefing-today-tab"), "panel: today tab content testid");
assert(panelTsx.includes("briefing-top-priorities"), "panel: top priorities section testid");
assert(panelTsx.includes("briefing-priority-"), "panel: priority item testid pattern");
assert(panelTsx.includes("/api/today/ceo-briefing/daily"), "panel: daily briefing API query");
assert(panelTsx.includes("Copy briefing"), "panel: copy briefing button");

// ── 19. Frontend — Weekly Review tab ─────────────────────────────────────────

console.log("\n[19] Frontend — Weekly Review tab");
assert(panelTsx.includes("briefing-weekly-tab"), "panel: weekly tab content testid");
assert(panelTsx.includes("briefing-date-range"), "panel: date range selector testid");
assert(panelTsx.includes("briefing-start-date"), "panel: start date input testid");
assert(panelTsx.includes("briefing-end-date"), "panel: end date input testid");
assert(panelTsx.includes("briefing-weekly-summary-cards"), "panel: summary cards testid");
assert(panelTsx.includes("briefing-stat-completed"), "panel: completed actions stat");
assert(panelTsx.includes("briefing-stat-unresolved"), "panel: unresolved actions stat");
assert(panelTsx.includes("briefing-stat-overdue"), "panel: overdue tasks stat");
assert(panelTsx.includes("briefing-stat-wins"), "panel: wins stat");
assert(panelTsx.includes("briefing-weekly-draft-btn"), "panel: copy weekly review button");
assert(panelTsx.includes("briefing-weekly-draft-sheet"), "panel: weekly draft sheet testid");
assert(panelTsx.includes("briefing-weekly-draft-text"), "panel: weekly draft textarea testid");
assert(panelTsx.includes("briefing-opp-movement"), "panel: opportunity movement section");
assert(panelTsx.includes("briefing-commitments-summary"), "panel: commitments summary section");
assert(panelTsx.includes("briefing-top-wins"), "panel: top wins section");
assert(panelTsx.includes("briefing-top-risks"), "panel: top risks section");

// ── 20. Frontend — Leadership Agenda tab ─────────────────────────────────────

console.log("\n[20] Frontend — Leadership Agenda tab");
assert(panelTsx.includes("briefing-agenda-tab"), "panel: agenda tab content testid");
assert(panelTsx.includes("briefing-agenda-sections"), "panel: agenda sections container testid");
assert(panelTsx.includes("briefing-agenda-copy-btn"), "panel: copy agenda button testid");
assert(panelTsx.includes("briefing-agenda-draft-sheet"), "panel: agenda draft sheet testid");
assert(panelTsx.includes("briefing-agenda-draft-text"), "panel: agenda draft textarea testid");
assert(panelTsx.includes("/api/today/ceo-briefing/leadership-agenda"), "panel: leadership agenda API query");
assert(panelTsx.includes("PRIORITY_BADGE"), "panel: priority badge styling");

// ── 21. Frontend — Team Briefings tab ────────────────────────────────────────

console.log("\n[21] Frontend — Team Briefings tab");
assert(panelTsx.includes("briefing-team-tab"), "panel: team tab content testid");
assert(panelTsx.includes("briefing-member-selector"), "panel: member selector testid");
assert(panelTsx.includes("briefing-member-select"), "panel: member select dropdown testid");
assert(panelTsx.includes("briefing-member-header"), "panel: member header testid");
assert(panelTsx.includes("briefing-member-status"), "panel: member operational status testid");
assert(panelTsx.includes("briefing-member-task-stats"), "panel: task stats testid");
assert(panelTsx.includes("briefing-talking-points"), "panel: talking points section testid");
assert(panelTsx.includes("briefing-support-questions"), "panel: support questions section testid");
assert(panelTsx.includes("briefing-member-actions"), "panel: open actions section testid");
assert(panelTsx.includes("briefing-member-wins"), "panel: recent wins section testid");
assert(panelTsx.includes("briefing-member-commitments"), "panel: commitments section testid");
assert(panelTsx.includes("/api/today/ceo-briefing/team-member"), "panel: team member API query");

// ── 22. Frontend — Copy buttons ───────────────────────────────────────────────

console.log("\n[22] Frontend — Copy buttons and no-auto-send disclaimers");
assert(panelTsx.includes("briefing-copy-btn"), "panel: copy button testid on CopyButton component");
assert(panelTsx.includes("Copy to Clipboard"), "panel: 'Copy to Clipboard' label");
assert(panelTsx.includes("will not be sent automatically"), "panel: no-auto-send disclaimer on draft sheets");
assert(panelTsx.includes("copy-only draft"), "panel: copy-only language in draft disclaimer");

// ── 23. Frontend — Action queue integration ───────────────────────────────────

console.log("\n[23] Frontend — Action queue integration (Phase 6 reuse)");
assert(panelTsx.includes("briefing-create-action-"), "panel: create-action button testid pattern");
assert(panelTsx.includes("/api/today/ceo-actions"), "panel: references Phase 6 action queue API");
assert(panelTsx.includes("onQueueAction"), "panel: onQueueAction callback for action creation");

// ── 24. today.tsx integration ─────────────────────────────────────────────────

console.log("\n[24] today.tsx integration");
assert(todayTsx.includes("CeoBriefingPanel"), "today: CeoBriefingPanel imported");
assert(todayTsx.includes("from \"@/components/today/ceo-briefing\"") || todayTsx.includes("from '@/components/today/ceo-briefing'"),
  "today: import from ceo-briefing");
assert(todayTsx.includes("<CeoBriefingPanel"), "today: CeoBriefingPanel rendered in JSX");

// ── 25. Capital invariant ─────────────────────────────────────────────────────

console.log("\n[25] Capital invariant (Phase 7 surfaces)");
// capital_investors references must always be inside hasCapital guard
const capRefs = (service.match(/capital_investors/g) || []).length;
const capGuards = (service.match(/actorUser\.hasCapital/g) || []).length;
assert(capGuards >= 1, "service: hasCapital guard present for capital data");
// Frontend must not reference capital_investors directly
assert(!panelTsx.includes("capital_investors"), "panel: no capital_investors in frontend");
// Routes Phase 7 must not expose capital_investors without guard
assert(!p7Block.includes("capital_investors"), "routes Phase 7: no capital_investors in route handlers");

// ── 26. Phase 4/5/6 regression guard ─────────────────────────────────────────

console.log("\n[26] Phase 4/5/6 regression guard");
assert(routesTs.includes("/api/today/ceo-cockpit"), "routes: Phase 4 cockpit route still present");
assert(routesTs.includes("/api/today/ceo-cockpit/one-on-ones"), "routes: Phase 5 1:1 routes still present");
assert(routesTs.includes("/api/today/ceo-actions"), "routes: Phase 6 action queue routes still present");
assert(routesTs.includes("CEO Action Queue (Phase 6)"), "routes: Phase 6 section header still present");
assert(routesTs.includes("CEO Briefing (Phase 7)"), "routes: Phase 7 section header present");

// Phase 5 service not overwritten
const oonService = readFile("server/services/ceo-one-on-ones.ts");
assert(oonService.includes("getOneOnOneNotes"), "Phase 5 service: getOneOnOneNotes intact");
assert(oonService.includes("buildOneOnOneAgenda"), "Phase 5 service: buildOneOnOneAgenda intact");

// Phase 6 service not overwritten
const actionService = readFile("server/services/ceo-action-loop.ts");
assert(actionService.includes("generateCockpitActions"), "Phase 6 service: generateCockpitActions intact");
assert(actionService.includes("buildUpdateRequestDraft"), "Phase 6 service: buildUpdateRequestDraft intact");

// today.tsx still has all original sections
assert(todayTsx.includes("CeoActionQueuePanel"), "today: Phase 6 CeoActionQueuePanel still present");
assert(todayTsx.includes("TeamPulseSection"), "today: TeamPulseSection still present");
assert(todayTsx.includes("BlockersSection"), "today: BlockersSection still present");
assert(todayTsx.includes("OneOnOnesSection"), "today: OneOnOnesSection still present");

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`CEO Briefing Phase 7 — ${passed + failed} checks: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log("\nFailed checks:");
  failures.forEach(f => console.log(`  ✗  ${f}`));
  process.exit(1);
} else {
  console.log("\nAll checks passed ✓");
}
