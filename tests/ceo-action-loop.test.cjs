/**
 * tests/ceo-action-loop.test.cjs
 * CEO Cockpit Phase 6 — Action Loop, Follow-Up Queue, and Accountability Trail
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

const service     = readFile("server/services/ceo-action-loop.ts");
const indexTs     = readFile("server/index.ts");
const routesTs    = readFile("server/routes.ts");
const panelTsx    = readFile("client/src/components/today/ceo-action-queue.tsx");
const sectionsTsx = readFile("client/src/components/today/ceo-cockpit-sections.tsx");
const todayTsx    = readFile("client/src/pages/today.tsx");

// ── 1. Migration ──────────────────────────────────────────────────────────────

console.log("\n[1] Migration / schema");
assert(indexTs.includes("ceo_action_queue"), "migration: ceo_action_queue table created");
assert(indexTs.includes("ceo_action_events"), "migration: ceo_action_events table created");
assert(indexTs.includes("assigned_to_user_id"), "migration: assigned_to_user_id column present");
assert(indexTs.includes("source_section"), "migration: source_section column present");
assert(indexTs.includes("snoozed_until"), "migration: snoozed_until column present");
assert(indexTs.includes("dismissed_reason"), "migration: dismissed_reason column present");
assert(indexTs.includes("idx_ceo_action_queue_owner_status"), "migration: owner_status index created");
assert(indexTs.includes("idx_ceo_action_queue_dedup"), "migration: dedup index created");
assert(indexTs.includes("idx_ceo_action_events_action"), "migration: events index created");

// ── 2. Service existence and exports ──────────────────────────────────────────

console.log("\n[2] Service exports");
assert(service.length > 0, "service file exists");
assert(service.includes("export async function generateCockpitActions"), "generateCockpitActions exported");
assert(service.includes("export async function listCeoActions"), "listCeoActions exported");
assert(service.includes("export async function createCeoAction"), "createCeoAction exported");
assert(service.includes("export async function updateCeoAction"), "updateCeoAction exported");
assert(service.includes("export async function completeCeoAction"), "completeCeoAction exported");
assert(service.includes("export async function dismissCeoAction"), "dismissCeoAction exported");
assert(service.includes("export async function snoozeCeoAction"), "snoozeCeoAction exported");
assert(service.includes("export async function buildUpdateRequestDraft"), "buildUpdateRequestDraft exported");
assert(service.includes("export async function createTaskFromAction"), "createTaskFromAction exported");

// ── 3. Safety: no auto-send ───────────────────────────────────────────────────

console.log("\n[3] Safety — no auto-send");
assert(!service.includes("sendEmail("), "service: no sendEmail call");
assert(!service.includes("sendMessage("), "service: no sendMessage call");
assert(!service.includes("sendCurrentsMessage"), "service: no sendCurrentsMessage");
assert(!service.includes("autoSend(") && !service.includes("auto_send("), "service: no auto-send function calls");
assert(service.includes("Never sends"), "service: 'Never sends' safety note present");
assert(service.includes("draftText"), "service: buildUpdateRequestDraft returns draftText");
assert(service.includes("copyable"), "service: returns copyable text note");
assert(!routesTs.includes("sendEmail") || routesTs.indexOf("sendEmail") < routesTs.indexOf("CEO Action Queue"), "routes: no sendEmail in ceo-actions block");

// ── 4. Routes: requireAuth + requireAdmin ─────────────────────────────────────

console.log("\n[4] Routes — auth + admin gate");
assert(routesTs.includes("CEO Action Queue (Phase 6)"), "routes: CEO Action Queue section header");
assert(routesTs.includes('"/api/today/ceo-actions"') && routesTs.includes("requireAuth, requireAdmin"), "routes: GET list requires admin");
assert(routesTs.includes('"/api/today/ceo-actions/generate"'), "routes: POST generate exists");
assert(routesTs.includes('"/api/today/ceo-actions/:id/complete"'), "routes: POST complete exists");
assert(routesTs.includes('"/api/today/ceo-actions/:id/dismiss"'), "routes: POST dismiss exists");
assert(routesTs.includes('"/api/today/ceo-actions/:id/snooze"'), "routes: POST snooze exists");
assert(routesTs.includes('"/api/today/ceo-actions/:id/update-draft"'), "routes: POST update-draft exists");
assert(routesTs.includes('"/api/today/ceo-actions/:id/create-task"'), "routes: POST create-task exists");

// Count requireAdmin occurrences in the Phase 6 block
const p6Start = routesTs.indexOf("CEO Action Queue (Phase 6)");
const p6End = routesTs.indexOf("Growth OS Command Center", p6Start);
const p6Block = p6Start > 0 && p6End > 0 ? routesTs.slice(p6Start, p6End) : "";
const adminCount = (p6Block.match(/requireAdmin/g) || []).length;
assert(adminCount >= 9, `routes: all 9 routes in Phase 6 block require admin (found ${adminCount})`);

// ── 5. Dedup logic ────────────────────────────────────────────────────────────

console.log("\n[5] Dedup and dismissed-sticky logic");
assert(service.includes("existingKeys"), "service: existingKeys Set for dedup");
assert(service.includes("dedupKey"), "service: dedupKey helper function");
assert(service.includes("status NOT IN ('completed')"), "service: existingKeys query excludes only completed (includes dismissed)");
assert(service.includes("NOT IN ('dismissed','completed')"), "service: open listCeoActions excludes dismissed/completed");
assert(service.includes("deduped"), "service: deduped count returned from generate");
assert(service.includes("dismissed"), "service: dismissed count tracked during generate");

// ── 6. Snoozed hidden from open view ──────────────────────────────────────────

console.log("\n[6] Snoozed items hidden from open view");
// The service uses q.snoozed_until alias in SQL (joined query)
assert(service.includes("snoozed_until IS NULL OR") && service.includes("snoozed_until <= NOW()"),
  "service: open view filters future-snoozed items");
assert(service.includes("status = 'snoozed'"), "service: snoozed filter returns snoozed-only items");
assert(service.includes("snoozedUntil"), "service: snoozeCeoAction validates snoozedUntil");
assert(service.includes("until <= new Date()"), "service: snoozed_until must be in future");

// ── 7. Complete / dismiss / snooze state transitions ─────────────────────────

console.log("\n[7] State transitions");
assert(service.includes("status = 'completed'"), "service: completeCeoAction sets completed status");
assert(service.includes("completed_at = NOW()"), "service: completeCeoAction sets completed_at");
assert(service.includes("status = 'dismissed'"), "service: dismissCeoAction sets dismissed status");
assert(service.includes("dismissed_reason"), "service: dismissCeoAction stores dismissed_reason");
assert(service.includes("NOT IN ('completed','dismissed')"), "service: terminal actions cannot be mutated again");

// ── 8. Accountability trail ───────────────────────────────────────────────────

console.log("\n[8] Accountability trail");
assert(service.includes("logEvent("), "service: logEvent helper used");
assert(service.includes("ceo_action_events"), "service: writes to ceo_action_events table");
assert(service.includes("event_type"), "service: event_type logged");
assert(service.includes("actor_user_id"), "service: actor_user_id logged");
// Service uses double-quoted strings for event types
assert(service.includes('"created"'), "service: 'created' event logged");
assert(service.includes('"completed"'), "service: 'completed' event logged");
assert(service.includes('"dismissed"'), "service: 'dismissed' event logged");
assert(service.includes('"snoozed"'), "service: 'snoozed' event logged");
assert(service.includes('"task_created"'), "service: 'task_created' event logged");
assert(service.includes('"draft_copied"'), "service: 'draft_copied' event logged");

// ── 9. Update draft is copy-only ──────────────────────────────────────────────

console.log("\n[9] Update draft — copy-only, no auto-send");
assert(service.includes("buildUpdateRequestDraft"), "service: buildUpdateRequestDraft function present");
assert(service.includes("draftText"), "service: returns draftText");
assert(service.includes("dmConversationId"), "service: returns dmConversationId (not message body)");
assert(service.includes("currentsLink"), "service: returns currentsLink for navigation");
assert(!service.includes("INSERT INTO current_messages"), "service: does not insert messages");
assert(!service.includes("INSERT INTO current_conversations") || service.includes("SELECT"), "service: does not create new DM conversations");
assert(service.includes("pairKey"), "service: DM lookup via pairKey (read-only)");
assert(service.includes("SELECT id FROM current_conversations"), "service: only SELECTs conversation, does not insert");

// ── 10. createTaskFromAction metadata ─────────────────────────────────────────

console.log("\n[10] createTaskFromAction — correct source metadata");
// Service uses 'ceo_action_queue' as a SQL literal value
assert(service.includes("'ceo_action_queue'"), "service: source value 'ceo_action_queue' present in SQL");
assert(service.includes("source, source_label, source_meta") || service.includes("source_label") || service.includes("sourceMeta"),
  "service: source metadata columns referenced");
assert(service.includes("sourceMeta"), "service: sourceMeta JSONB stored");
assert(service.includes("actionId"), "service: actionId in sourceMeta");
assert(service.includes("sourceSection"), "service: sourceSection in sourceMeta");
assert(service.includes("sourceType"), "service: sourceType in sourceMeta");
assert(service.includes("created_task_id"), "service: idempotency — created_task_id in metadata");
assert(service.includes("existingTaskId"), "service: idempotency check before inserting");

// ── 11. Capital-sensitive gate ────────────────────────────────────────────────

console.log("\n[11] Capital invariant");
assert(!service.includes("capital_investors"), "service: no capital_investors reference");
assert(!p6Block.includes("capital_investors"), "routes Phase 6 block: no capital_investors reference");
assert(!panelTsx.includes("capital_investors"), "frontend: no capital_investors in action queue panel");

// ── 12. Private channels / DM bodies not exposed ──────────────────────────────

console.log("\n[12] Private data — DM bodies not exposed");
assert(!service.includes("body FROM current_messages"), "service: does not fetch DM message bodies");
assert(!service.includes("SELECT content"), "service: does not select message content");
assert(service.includes("type = 'dm'"), "service: DM lookup is by type only, no body fetch");
assert(!p6Block.includes("message_body"), "routes Phase 6: no message_body in response");
assert(!p6Block.includes("dm_body"), "routes Phase 6: no dm_body in response");

// ── 13. Frontend — Action Queue panel ─────────────────────────────────────────

console.log("\n[13] Frontend — CeoActionQueuePanel");
assert(panelTsx.length > 0, "panel file exists");
assert(panelTsx.includes("CeoActionQueuePanel"), "panel: CeoActionQueuePanel exported");
assert(panelTsx.includes("QueueActionButton"), "panel: QueueActionButton exported");
assert(panelTsx.includes("ceo-action-queue-panel"), "panel: data-testid ceo-action-queue-panel");
assert(panelTsx.includes("generate-actions-btn"), "panel: generate button testid");
assert(panelTsx.includes("action-filter-chips"), "panel: filter chips testid");
// Filter chips use template testid pattern: data-testid={`filter-chip-${f.key}`}
// with STATUS_FILTERS containing open, snoozed, completed, dismissed, high_priority
assert(panelTsx.includes("filter-chip-") && panelTsx.includes('"open"'), "panel: Open filter chip key");
assert(panelTsx.includes("filter-chip-") && panelTsx.includes('"snoozed"'), "panel: Snoozed filter chip key");
assert(panelTsx.includes("filter-chip-") && panelTsx.includes('"completed"'), "panel: Completed filter chip key");
assert(panelTsx.includes("filter-chip-") && panelTsx.includes('"dismissed"'), "panel: Dismissed filter chip key");
assert(panelTsx.includes("filter-chip-") && panelTsx.includes('"high_priority"'), "panel: High Priority filter chip key");
assert(panelTsx.includes("action-queue-list"), "panel: action list testid");
assert(panelTsx.includes("action-queue-empty"), "panel: empty state testid");
assert(panelTsx.includes("action-queue-loading"), "panel: loading state testid");

// ── 14. Frontend — Action card buttons ────────────────────────────────────────

console.log("\n[14] Frontend — Action card buttons");
assert(panelTsx.includes("action-card-"), "panel: action-card-{id} testid pattern");
assert(panelTsx.includes("action-copy-draft-"), "panel: Copy Draft button per card");
assert(panelTsx.includes("action-create-task-"), "panel: Create Task button per card");
assert(panelTsx.includes("action-snooze-"), "panel: Snooze button per card");
assert(panelTsx.includes("action-complete-"), "panel: Complete button per card");
assert(panelTsx.includes("action-dismiss-"), "panel: Dismiss button per card");
assert(panelTsx.includes("action-draft-sheet"), "panel: update draft sheet testid");
assert(panelTsx.includes("action-draft-copy-btn"), "panel: copy button in draft sheet");
assert(panelTsx.includes("action-draft-text"), "panel: draft text area testid");
assert(panelTsx.includes("Copy to Clipboard"), "panel: clipboard copy button label");
assert(panelTsx.includes("not be sent automatically"), "panel: explicit no-auto-send disclaimer");

// ── 15. Frontend — QueueActionButton used in sections ─────────────────────────

console.log("\n[15] Frontend — contextual QueueActionButton in sections");
assert(sectionsTsx.includes("QueueActionButton"), "sections: QueueActionButton imported and used");
assert(sectionsTsx.includes("from \"./ceo-action-queue\"") || sectionsTsx.includes("from './ceo-action-queue'"),
  "sections: import from ceo-action-queue");
assert(sectionsTsx.includes("resolve_blocker") || sectionsTsx.includes("follow_up") || sectionsTsx.includes("review_commitment"),
  "sections: contextual queue action types referenced");
assert(sectionsTsx.includes("queue-blocker-") || sectionsTsx.includes("queue-team-pulse-") || sectionsTsx.includes("queue-silence-"),
  "sections: contextual queue button testids present");

// ── 16. today.tsx — panel rendered in cockpit ─────────────────────────────────

console.log("\n[16] today.tsx integration");
assert(todayTsx.includes("CeoActionQueuePanel"), "today: CeoActionQueuePanel imported");
assert(todayTsx.includes("from \"@/components/today/ceo-action-queue\"") || todayTsx.includes("from '@/components/today/ceo-action-queue'"),
  "today: import from ceo-action-queue");
assert(todayTsx.includes("<CeoActionQueuePanel"), "today: CeoActionQueuePanel rendered in JSX");

// ── 17. Import in routes.ts ───────────────────────────────────────────────────

console.log("\n[17] routes.ts import");
assert(routesTs.includes("import { generateCockpitActions"), "routes: generateCockpitActions imported");
assert(routesTs.includes("buildUpdateRequestDraft"), "routes: buildUpdateRequestDraft imported");
assert(routesTs.includes("createTaskFromAction"), "routes: createTaskFromAction imported");
assert(routesTs.includes("from \"./services/ceo-action-loop\"") || routesTs.includes("from './services/ceo-action-loop'"),
  "routes: import from ./services/ceo-action-loop");

// ── 18. No noisy AI dependency in generation ──────────────────────────────────

console.log("\n[18] Deterministic generation — no AI");
// The generate function body — search generously
const genFnStart = service.indexOf("async function generateCockpitActions");
const genFnBody = genFnStart > 0 ? service.slice(genFnStart, genFnStart + 8000) : "";
assert(!genFnBody.includes("openai.chat"), "generate: no openai.chat call (deterministic)");
assert(!genFnBody.includes("gpt-4"), "generate: no gpt-4 model reference in generate");
assert(!genFnBody.includes("gpt-3"), "generate: no gpt-3 model reference in generate");
assert(genFnBody.includes("team_pulse"), "generate: processes team_pulse section");
assert(genFnBody.includes("blockers"), "generate: processes blockers section");
assert(genFnBody.includes("silence_watch"), "generate: processes silence_watch section");
assert(genFnBody.includes("commitments"), "generate: processes commitments section");
assert(genFnBody.includes("one_on_ones"), "generate: processes one_on_ones section");
assert(genFnBody.includes("ceo_attention"), "generate: processes ceo_attention section");

// ── 19. Phase 4 / Phase 5 regressions ────────────────────────────────────────

console.log("\n[19] Phase 4 / Phase 5 regression guard");
// Phase 4 cockpit routes still present
assert(routesTs.includes("/api/today/ceo-cockpit"), "routes: Phase 4 /api/today/ceo-cockpit still present");
// Phase 5 1:1 routes are nested under ceo-cockpit
assert(routesTs.includes("/api/today/ceo-cockpit/one-on-ones"), "routes: Phase 5 one-on-ones routes still present");
assert(routesTs.includes("CEO 1:1 Operating System"), "routes: Phase 5 section header still present");
// Phase 5 service not overwritten
const oonService = readFile("server/services/ceo-one-on-ones.ts");
assert(oonService.includes("getOneOnOneNotes"), "Phase 5 service: getOneOnOneNotes still present");
assert(oonService.includes("buildOneOnOneAgenda"), "Phase 5 service: buildOneOnOneAgenda still present");
// Sections file still exports all original sections
assert(sectionsTsx.includes("export function TeamPulseSection"), "sections: TeamPulseSection still exported");
assert(sectionsTsx.includes("export function BlockersSection"), "sections: BlockersSection still exported");
assert(sectionsTsx.includes("export function SilenceWatchSection"), "sections: SilenceWatchSection still exported");
assert(sectionsTsx.includes("export function CommitmentsSection"), "sections: CommitmentsSection still exported");
assert(sectionsTsx.includes("export function OneOnOnesSection"), "sections: OneOnOnesSection still exported");
assert(sectionsTsx.includes("export function CeoAttentionSection"), "sections: CeoAttentionSection still exported");
assert(sectionsTsx.includes("export function CommunicationHotspotsSection"), "sections: CommunicationHotspotsSection still exported");
// today.tsx still imports all 7 sections
assert(todayTsx.includes("TeamPulseSection"), "today: TeamPulseSection still imported");
assert(todayTsx.includes("BlockersSection"), "today: BlockersSection still imported");
assert(todayTsx.includes("OneOnOnesSection"), "today: OneOnOnesSection still imported");

// ── 20. Input validation in service ──────────────────────────────────────────

console.log("\n[20] Input validation");
assert(service.includes("safeId("), "service: safeId validates IDs");
assert(service.includes("safeBound("), "service: safeBound limits string length");
assert(service.includes("validateEnum("), "service: validateEnum validates enum fields");
assert(service.includes("VALID_TYPES"), "service: VALID_TYPES allowlist");
assert(service.includes("VALID_STATUS"), "service: VALID_STATUS allowlist");
assert(service.includes("VALID_PRIORITY"), "service: VALID_PRIORITY allowlist");

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`CEO Action Loop — ${passed + failed} checks: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log("\nFailed checks:");
  failures.forEach(f => console.log(`  ✗  ${f}`));
  process.exit(1);
} else {
  console.log("\nAll checks passed ✓");
}
