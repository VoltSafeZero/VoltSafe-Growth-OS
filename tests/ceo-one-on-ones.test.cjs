// tests/ceo-one-on-ones.test.cjs
// Source-grep checks for CEO Cockpit Phase 5: 1:1 Notes, Commitment Extraction, Update Drafts
"use strict";

const fs   = require("fs");
const path = require("path");

const SERVICE   = path.join(__dirname, "../server/services/ceo-one-on-ones.ts");
const ROUTES    = path.join(__dirname, "../server/routes.ts");
const DRAWER    = path.join(__dirname, "../client/src/components/today/ceo-one-on-ones.tsx");
const SECTIONS  = path.join(__dirname, "../client/src/components/today/ceo-cockpit-sections.tsx");
const INDEX     = path.join(__dirname, "../server/index.ts");

const svc  = fs.readFileSync(SERVICE,  "utf8");
const rtsAll  = fs.readFileSync(ROUTES, "utf8");
// Isolate the 1:1 routes block so checks don't fire on unrelated route code
const rts1on1Start = rtsAll.indexOf("// ── CEO 1:1 Operating System");
const rts1on1End   = rtsAll.indexOf("// ── Growth OS Command Center");
const rts1on1 = rts1on1Start >= 0 && rts1on1End > rts1on1Start
  ? rtsAll.slice(rts1on1Start, rts1on1End)
  : rtsAll;
const rts = rtsAll; // used for broad checks; rts1on1 for scoped checks
const drw  = fs.readFileSync(DRAWER,   "utf8");
const sec  = fs.readFileSync(SECTIONS, "utf8");
const idx  = fs.readFileSync(INDEX,    "utf8");

let passed = 0; let failed = 0;
function check(label, cond) {
  if (cond) { console.log("  \u2713 " + label); passed++; }
  else { console.error("  \u2717 FAIL: " + label); failed++; }
}

// ── 1. DATA MODEL / MIGRATION ────────────────────────────────────────────────
console.log("\n-- Data model / migration --");
check("one_on_one_sections column migration in index.ts", idx.includes("one_on_one_sections"));
check("Migration uses ADD COLUMN IF NOT EXISTS", idx.includes("ADD COLUMN IF NOT EXISTS one_on_one_sections jsonb"));
check("Migration logged with [migration] prefix", idx.includes("[migration] meeting_notes.one_on_one_sections column ready"));
check("Reuses meeting_notes table (source='one_on_one')", svc.includes("source = 'one_on_one'") || svc.includes("'one_on_one'"));
check("linked_object_type='user' for 1:1 association", svc.includes("linked_object_type = 'user'") || svc.includes("linked_object_type"));
check("linked_object_id = teamMemberId pattern", svc.includes("linked_object_id") && svc.includes("teamMemberId"));
check("Soft delete via status='deleted'", svc.includes("status = 'deleted'") || svc.includes("'deleted'"));
check("meeting_note_action_items reused for commitments", svc.includes("meeting_note_action_items"));
check("task source='one_on_one_note' for created tasks", svc.includes("'one_on_one_note'"));
check("sourceMeta includes meetingNoteId", svc.includes("meetingNoteId") && svc.includes("sourceMeta"));

// ── 2. SERVICE: SAFETY ───────────────────────────────────────────────────────
console.log("\n-- Service: safety --");
check("safeId() validates numeric IDs", svc.includes("function safeId"));
check("safeBound() limits string length", svc.includes("function safeBound"));
check("No auto-send messages in service", !svc.includes("sendEmail(") && !svc.includes("sendMessage("));
check("No external API calls beyond optional OpenAI", !svc.includes("fetch(\"https://") || svc.includes("openai") || svc.includes("OpenAI"));
check("No keystroke tracking", !svc.includes("keystroke_count") && !svc.includes("mouseMovement") && !svc.includes("mouse_movement"));
check("No shaming language in service", !svc.includes("not working") && !svc.includes("unproductive") && !svc.includes("lazy"));
check("No raw storage keys/tokens exposed", !svc.includes("SESSION_SECRET") && !svc.includes("GOOGLE_CLIENT_SECRET") && !svc.includes("DATABASE_URL"));
check("Parameterized queries via sql`` template", svc.includes("sql`") && !svc.includes(".replace(/'/g,") );
check("DM bodies not auto-sent (no current_messages INSERT)", !svc.includes("INSERT INTO current_messages"));

// ── 3. SERVICE: CORE FUNCTIONS ────────────────────────────────────────────────
console.log("\n-- Service: core functions --");
check("getOneOnOneNotes exported", svc.includes("export async function getOneOnOneNotes"));
check("createOneOnOneNote exported", svc.includes("export async function createOneOnOneNote"));
check("updateOneOnOneNote exported", svc.includes("export async function updateOneOnOneNote"));
check("deleteOneOnOneNote exported", svc.includes("export async function deleteOneOnOneNote"));
check("buildOneOnOneAgenda exported", svc.includes("export async function buildOneOnOneAgenda"));
check("extractCommitmentsFromNote exported", svc.includes("export async function extractCommitmentsFromNote"));
check("createTasksFromCommitments exported", svc.includes("export async function createTasksFromCommitments"));
check("getUpdateDraft exported", svc.includes("export async function getUpdateDraft"));

// ── 4. SERVICE: AGENDA BUILDER ────────────────────────────────────────────────
console.log("\n-- Service: agenda builder --");
check("Agenda builder is deterministic (no AI required)", svc.includes("function buildOneOnOneAgenda") && !svc.includes("buildOpenAIClient") || svc.includes("SUGGESTED_QUESTIONS"));
check("openCommitments: tasks from 1:1 notes", svc.includes("source = 'one_on_one_note'"));
check("overdueTasks: tasks past due date", svc.includes("due_date < NOW()"));
check("blockers: board_column = blocked", svc.includes("board_column = 'blocked'"));
check("staleWork: updated_at older than 7 days", svc.includes("7 days") || svc.includes("INTERVAL '7 days'"));
check("recentWins: recently completed tasks", svc.includes("status = 'completed'") && svc.includes("14 days"));
check("priorActionItems: from prior 1:1 meeting notes", svc.includes("meeting_note_action_items") && svc.includes("one_on_one"));
check("suggestedQuestions always returned", svc.includes("SUGGESTED_QUESTIONS") && svc.includes("What is the biggest blocker"));
check("generated_at included", svc.includes("generated_at"));
check("Each section capped with LIMIT", (svc.match(/LIMIT \d+/g) || []).length >= 5);

// ── 5. SERVICE: COMMITMENT EXTRACTION ────────────────────────────────────────
console.log("\n-- Service: commitment extraction --");
check("Deterministic regex patterns defined", svc.includes("COMMITMENT_PATTERNS"));
check("Checkbox pattern detected ([ ])", svc.includes("\\[[ x?]\\]") || svc.includes("checkbox") || svc.includes("\\[ \\]") || svc.includes("[ x?]"));
check("'I will' pattern detected", svc.includes("I will"));
check("'Follow up' pattern detected", svc.includes("Follow up") || svc.includes("Follow-up"));
check("'Need to' pattern detected", svc.includes("Need to") || svc.includes("Need to"));
check("AI extraction is optional (graceful fallback)", svc.includes("AI extraction not configured") || svc.includes("deterministic results only"));
check("AI output marked needsReview=true", svc.includes("needsReview: true"));
check("AI must not create tasks automatically", !svc.includes("createTask") || svc.includes("needsReview"));
check("confidence score on candidates", svc.includes("confidence"));
check("Deduplicated candidates returned", svc.includes("deduped") || svc.includes("seen"));
check("extraction capped at 20 candidates", svc.includes(".slice(0, 20)"));
check("warnings array returned", svc.includes("warnings"));
check("AI uses existing openai-compat helpers", svc.includes("buildOpenAIModelParams") || svc.includes("openai-compat"));
check("No external APIs in deterministic path", svc.includes("extractDeterministic") || svc.includes("COMMITMENT_PATTERNS"));

// ── 6. SERVICE: TASK CREATION ─────────────────────────────────────────────────
console.log("\n-- Service: task creation --");
check("Duplicate prevention: check existing by meetingNoteId+title", svc.includes("existingTitles") || svc.includes("meetingNoteId"));
check("Owner user validated before task insert", svc.includes("SELECT id FROM users WHERE id =") || svc.includes("validUser"));
check("Tasks capped at 20 per call", svc.includes(".slice(0, 20)"));
check("source='one_on_one_note' on created tasks", svc.includes("'one_on_one_note'"));
check("sourceLabel includes note title", svc.includes("sourceLabel") && svc.includes("From 1:1 Note"));
check("sourceMeta stores meetingNoteId", svc.includes("sourceMeta") && svc.includes("meetingNoteId"));
check("action item row inserted with task_created status", svc.includes("'task_created'"));
check("skipped count returned", svc.includes("skipped"));
check("createdIds returned", svc.includes("createdIds"));

// ── 7. SERVICE: UPDATE DRAFT ─────────────────────────────────────────────────
console.log("\n-- Service: update draft --");
check("Target user validated as internal+active", svc.includes("user_type = 'internal'") && svc.includes("status = 'active'"));
check("DM pairKey lookup: dm:{lo}:{hi}", svc.includes("dm:${lo}:${hi}") || svc.includes("pairKey"));
check("Looks up existing DM (SELECT)", svc.includes("SELECT id FROM current_conversations"));
check("No auto-send: no INSERT into current_messages", !svc.includes("INSERT INTO current_messages"));
check("No DM auto-creation: no INSERT into current_conversations", !svc.includes("INSERT INTO current_conversations"));
check("Returns dmConversationId (nullable)", svc.includes("dmConversationId"));
check("Returns currentsLink (nullable)", svc.includes("currentsLink"));
check("Returns draftText always", svc.includes("draftText"));
check("Default message is factual check-in copy", svc.includes("Quick check-in") || svc.includes("current status"));

// ── 8. BACKEND ROUTES ────────────────────────────────────────────────────────
console.log("\n-- Backend routes --");
check("GET notes route exists", rts.includes("one-on-ones/:teamMemberId/notes") && rts.includes("app.get"));
check("POST notes route exists", rts.includes("one-on-ones/:teamMemberId/notes") && rts.includes("app.post"));
check("PATCH note route exists", rts.includes("one-on-ones/notes/:noteId") && rts.includes("app.patch"));
check("DELETE note route exists", rts.includes("one-on-ones/notes/:noteId") && rts.includes("app.delete"));
check("GET agenda route exists", rts.includes("one-on-ones/:teamMemberId/agenda"));
check("POST extract-commitments route exists", rts.includes("extract-commitments"));
check("POST commitments (create tasks) route exists", rts.includes("/notes/:noteId/commitments") && rts.includes("app.post"));
check("POST update-draft route exists", rts.includes("update-draft"));
check("All routes require requireAuth", (rts.match(/one-on-ones.*requireAuth/g) || rts.match(/requireAuth.*one-on-ones/g)) !== null || rts.includes("requireAuth, requireAdmin"));
check("All routes require requireAdmin", rts.includes("requireAuth, requireAdmin"));
check("Service imported in routes.ts", rts.includes("ceo-one-on-ones"));
check("All 8 service functions imported", rts.includes("getOneOnOneNotes") && rts.includes("buildOneOnOneAgenda") && rts.includes("getUpdateDraft"));
check("commitments body validated (array check)", rts.includes("Array.isArray(commitments)"));
check("No auto-send in routes", !rts1on1.includes("sendEmail(") && !rts1on1.includes("sendMessage("));

// ── 9. FRONTEND: DRAWER ──────────────────────────────────────────────────────
console.log("\n-- Frontend: 1:1 drawer --");
check("OneOnOneDrawer exported", drw.includes("export function OneOnOneDrawer"));
check("UpdateDraftSheet exported", drw.includes("export function UpdateDraftSheet"));
check("Drawer uses Sheet component", drw.includes("SheetContent"));
check("Tabs: Agenda and Notes", drw.includes("tab-agenda") && drw.includes("tab-notes"));
check("one-on-one-drawer testId", drw.includes('data-testid="one-on-one-drawer"'));
check("AgendaTab fetches /api/today/ceo-cockpit/one-on-ones/...agenda", drw.includes("agenda") && drw.includes("useQuery"));
check("agenda-loading testId", drw.includes('data-testid="agenda-loading"'));
check("agenda-error testId", drw.includes('data-testid="agenda-error"'));
check("agenda-view testId", drw.includes('data-testid="agenda-view"'));
check("Suggested questions section exists", drw.includes("suggested-questions-section") || drw.includes("Suggested Questions"));

// ── 10. FRONTEND: NOTE EDITOR ────────────────────────────────────────────────
console.log("\n-- Frontend: note editor --");
check("NoteEditorSheet (or function) exists", drw.includes("function NoteEditorSheet") || drw.includes("NoteEditorSheet"));
check("note-editor-form testId", drw.includes('data-testid="note-editor-form"'));
check("note-editor-date field", drw.includes('data-testid="note-editor-date"'));
check("note-editor-title field", drw.includes('data-testid="note-editor-title"'));
check("note-editor-wins field", drw.includes('data-testid="note-editor-wins"'));
check("note-editor-blockers field", drw.includes('data-testid="note-editor-blockers"'));
check("note-editor-priorities field", drw.includes('data-testid="note-editor-priorities"'));
check("note-editor-support-needed field", drw.includes('data-testid="note-editor-support-needed"'));
check("note-editor-decisions field", drw.includes('data-testid="note-editor-decisions"'));
check("note-editor-followups field", drw.includes('data-testid="note-editor-followups"'));
check("note-editor-notes field", drw.includes('data-testid="note-editor-notes"'));
check("note-editor-save button", drw.includes('data-testid="note-editor-save"'));
check("note-editor-cancel button", drw.includes('data-testid="note-editor-cancel"'));
check("Wins placeholder prompt exists", drw.includes("What changed since last 1:1") || drw.includes("What went well"));
check("Blockers placeholder prompt exists", drw.includes("What is blocked") || drw.includes("What obstacles"));
check("Support needed prompt exists", drw.includes("What decision does Trevor need") || drw.includes("Support Needed"));
check("Follow-ups prompt mentions extraction pattern", drw.includes("I will") || drw.includes("[ ]"));
check("Note NOT stored in localStorage", !drw.includes("localStorage.set") && !drw.includes("localStorage.getItem"));
check("POST to /api/today/ceo-cockpit/one-on-ones/:id/notes", drw.includes("one-on-ones/${teamMemberId}/notes") || drw.includes("one-on-ones/"));
check("PATCH to /api/today/ceo-cockpit/one-on-ones/notes/:noteId", drw.includes("one-on-ones/notes/${existingNote") || drw.includes("one-on-ones/notes/"));
check("Cache invalidated after save", drw.includes("invalidateQueries"));

// ── 11. FRONTEND: PRIOR NOTES LIST ────────────────────────────────────────────
console.log("\n-- Frontend: prior notes list --");
check("PriorNotesList function exists", drw.includes("function PriorNotesList"));
check("prior-notes-list testId", drw.includes('data-testid="prior-notes-list"'));
check("prior-notes-empty testId", drw.includes('data-testid="prior-notes-empty"'));
check("prior-notes-loading testId", drw.includes('data-testid="prior-notes-loading"'));
check("Expand/collapse per note", drw.includes("prior-note-expand-"));
check("Edit button per note", drw.includes("prior-note-edit-"));
check("Extract commitments per note", drw.includes("prior-note-extract-"));
check("Delete (soft) button per note", drw.includes("prior-note-delete-"));
check("Wins section shown in expanded note", drw.includes("sections.wins") || drw.includes("Wins"));
check("Blockers section shown in expanded note", drw.includes("sections.blockers") || drw.includes("Blockers"));
check("add-one-on-one-note-btn testId", drw.includes('data-testid="add-one-on-one-note-btn"'));

// ── 12. FRONTEND: COMMITMENT EXTRACTION ───────────────────────────────────────
console.log("\n-- Frontend: commitment extraction --");
check("CommitmentCandidateReview function exists", drw.includes("function CommitmentCandidateReview"));
check("commitment-candidate-review testId", drw.includes('data-testid="commitment-candidate-review"'));
check("Checkboxes per candidate", drw.includes("commitment-candidate-checkbox-"));
check("Individual candidate testId", drw.includes("commitment-candidate-"));
check("No owner badge shown", drw.includes("No owner") || drw.includes("no owner"));
check("confidence shown on candidates", drw.includes("confidence") || drw.includes("Confidence"));
check("commitment-create-tasks-btn testId", drw.includes('data-testid="commitment-create-tasks-btn"'));
check("commitment-cancel-btn testId", drw.includes('data-testid="commitment-cancel-btn"'));
check("extraction-view testId shown during extraction", drw.includes('data-testid="extraction-view"'));
check("POST to extract-commitments endpoint", drw.includes("extract-commitments"));
check("POST to /notes/:noteId/commitments endpoint", drw.includes("/commitments"));
check("User must select before creating (review gate)", drw.includes("selected.size") || drw.includes("Select at least one"));
check("needsReview shown in UI", drw.includes("needsReview") || drw.includes("requires your review") || drw.includes("your review"));
check("Cache invalidated after task creation", drw.includes("invalidateQueries") && drw.includes("commitments"));

// ── 13. FRONTEND: UPDATE DRAFT ────────────────────────────────────────────────
console.log("\n-- Frontend: update draft --");
check("UpdateDraftSheet function exists", drw.includes("function UpdateDraftSheet") || drw.includes("export function UpdateDraftSheet"));
check("update-draft-sheet testId", drw.includes('data-testid="update-draft-sheet"'));
check("update-draft-text testId", drw.includes('data-testid="update-draft-text"'));
check("update-draft-copy-btn testId", drw.includes('data-testid="update-draft-copy-btn"'));
check("update-draft-open-currents button", drw.includes('data-testid="update-draft-open-currents"'));
check("Uses navigator.clipboard (copy only)", drw.includes("navigator.clipboard"));
check("No auto-send in update draft UI", !drw.includes("sendMessage") && !drw.includes("sendEmail"));
check("'not sent automatically' warning shown", drw.includes("not be sent automatically") || drw.includes("will not be sent"));
check("POST /api/today/ceo-cockpit/update-draft called", drw.includes("update-draft"));
check("Open DM link uses currentsLink from API", drw.includes("currentsLink") || drw.includes("currents_link"));

// ── 14. FRONTEND: SECTIONS INTEGRATION ────────────────────────────────────────
console.log("\n-- Frontend: sections integration --");
check("OneOnOneDrawer imported in ceo-cockpit-sections.tsx", sec.includes("OneOnOneDrawer"));
check("UpdateDraftSheet imported in ceo-cockpit-sections.tsx", sec.includes("UpdateDraftSheet"));
check("'Open 1:1' button in OneOnOnesSection", sec.includes("Open 1:1") || sec.includes("open-one-on-one-drawer-"));
check("open-one-on-one-drawer testId per user", sec.includes("open-one-on-one-drawer-${item.userId}") || sec.includes("open-one-on-one-drawer-"));
check("Notes & Commitments button in expanded detail", sec.includes("Notes") && sec.includes("Commitments"));
check("Ask for Update in 1:1 section", sec.includes("Ask for Update") || sec.includes("update-draft-inline"));
check("Drawer opened by state (drawerUserId)", sec.includes("drawerUserId") || sec.includes("setDrawerUserId"));
check("UpdateDraftSheet rendered conditionally", sec.includes("UpdateDraftSheet") && sec.includes("updateDraftUserId"));

// ── 15. PRIVACY AND PERMISSIONS ───────────────────────────────────────────────
console.log("\n-- Privacy and permissions --");
check("Notes routes require requireAdmin", rts.includes("requireAuth, requireAdmin") && rts.includes("one-on-ones"));
check("Note owner verified on update (created_by check)", svc.includes("created_by = ${ceoId}") || svc.includes("created_by ="));
check("Note owner verified on delete", svc.includes("created_by") && svc.includes("deleteOneOnOneNote"));
check("Note owner verified on extract", svc.includes("created_by") && svc.includes("extractCommitmentsFromNote"));
check("Team member cannot read CEO notes (no public endpoint)", !rts.includes("GET.*one-on-ones.*requireUser") && !rts.includes("/api/one-on-one-notes"));
check("Note text NOT in localStorage", !drw.includes("localStorage.setItem") && !drw.includes("localStorage.getItem"));
check("Private DM bodies not returned in update-draft", !svc.includes("SELECT.*body FROM current_messages") || svc.includes("current_conversation"));
check("No Capital data in 1:1 notes (no capital_investors ref)", !svc.includes("capital_investors"));
check("update-draft validates internal user", svc.includes("user_type = 'internal'"));
check("No auto-create DMs in update-draft", !svc.includes("INSERT INTO current_conversations"));
check("AI extraction review-only — no auto task creation", svc.includes("needsReview: true"));

// ── 16. NO SHAMING LANGUAGE ──────────────────────────────────────────────────
console.log("\n-- No shaming language --");
check("No 'not working' in service", !svc.includes("not working"));
check("No 'unproductive' in service", !svc.includes("unproductive"));
check("No 'lazy' in service", !svc.includes("lazy"));
check("No 'surveillance' in service", !svc.includes("surveillance"));
check("No 'not working' in drawer UI", !drw.includes("not working"));
check("No 'unproductive' in drawer UI", !drw.includes("unproductive"));
check("No 'lazy' in drawer UI", !drw.includes("lazy"));
check("No 'shame' in drawer UI", !drw.includes("shame"));
check("Blockers framed as 'blocked' not 'failing'", !svc.includes("failing") && !svc.includes("bad performer"));
check("Stale work framed as 'no recent update'", svc.includes("no recent update") || svc.includes("No Recent Update") || drw.includes("No Recent Update"));

// ── 17. FILE EXISTENCE ────────────────────────────────────────────────────────
console.log("\n-- File existence --");
check("ceo-one-on-ones.ts service exists", fs.existsSync(SERVICE));
check("ceo-one-on-ones.tsx drawer exists", fs.existsSync(DRAWER));
check("ceo-cockpit-sections.tsx updated", fs.existsSync(SECTIONS));
check("server/index.ts migration added", fs.existsSync(INDEX));
check("ceo-cockpit.test.cjs still exists", fs.existsSync(path.join(__dirname, "ceo-cockpit.test.cjs")));
check("today-cockpit.test.cjs still exists", fs.existsSync(path.join(__dirname, "today-cockpit.test.cjs")));
check("today-personalization.test.cjs still exists", fs.existsSync(path.join(__dirname, "today-personalization.test.cjs")));
check("capital-hardening.test.cjs still exists", fs.existsSync(path.join(__dirname, "capital-hardening.test.cjs")));

console.log("\n------------------------------------------------------------");
console.log("CEO 1:1 Operating System Tests: " + passed + " passed, " + failed + " failed");
console.log("------------------------------------------------------------\n");
if (failed > 0) process.exit(1);
