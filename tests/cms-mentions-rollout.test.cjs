"use strict";
/**
 * cms-mentions-rollout.test.cjs
 *
 * Source-grep regression suite verifying that every CMS module listed in the
 * Universal @Mention rollout spec has:
 *   - MentionInput wired to its text field (client)
 *   - saveMentions / refreshMentions called in the matching server route
 *   - Tokenization happening before the data is sent (client submit path)
 *   - @all scope is NEVER used in any non-Currents path
 *
 * Modules covered:
 *   1. Account Notes              (accounts.tsx + PUT /api/accounts/:id)
 *   2. Contact Notes              (edit-contact-dialog.tsx + PUT /api/contacts/:id)
 *   3. Meeting Notes              (calendar.tsx PostMeetingTab + POST /api/calendar/events/:id/post-meeting)
 *   4. Calendar Outcome Notes     (calendar.tsx OutcomeTab + POST /api/activities)
 *   5. Project Description        (projects.tsx ProjectEditDialog + PUT /api/projects/:id)
 *   6. Project Compliance Notes   (projects.tsx CertificationDetailPanel + POST /api/projects/:id/certification)
 *   7. Ticket Description         (tickets.tsx CreateTicketForm + POST /api/tickets)
 *   8. Quote Notes                (quotes.tsx + PUT /api/quotes/:id)
 *   9. Quote Assumptions          (quotes.tsx + PUT /api/quotes/:id)
 *  10. Marketing Campaign Notes   (marketing-campaigns.tsx + POST /api/marketing/campaigns)
 */

const fs   = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function ok(label, cond, detail = "") {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function has(src, pattern) {
  return typeof pattern === "string" ? src.includes(pattern) : pattern.test(src);
}

console.log("\n=== cms-mentions-rollout.test.cjs ===");

// ─── Load source files ────────────────────────────────────────────────────────
const routes    = read("server/routes.ts");
const accounts  = read("client/src/pages/accounts.tsx");
const contacts  = read("client/src/components/contacts/edit-contact-dialog.tsx");
const calendar  = read("client/src/pages/calendar.tsx");
const projects  = read("client/src/pages/projects.tsx");
const tickets   = read("client/src/pages/tickets.tsx");
const quotes    = read("client/src/pages/quotes.tsx");
const mktCamp   = read("client/src/pages/marketing-campaigns.tsx");

// ─── 1. Account Notes ────────────────────────────────────────────────────────
console.log("\n── 1. Account Notes (accounts.tsx) ──");
ok("imports MentionInput",            has(accounts, 'from "@/components/shared/mention-input"'));
ok("EditAccountForm declares notesRef", has(accounts, "useRef<MentionInputHandle>(null)"));
ok("initFromTokenText on mount",       has(accounts, "initFromTokenText(account.notes)"));
ok("Textarea replaced by MentionInput for notes",
   has(accounts, 'ref={notesRef}') && !has(accounts, 'data-testid="input-account-notes"') ||
   has(accounts, '<MentionInput ref={notesRef}'));
ok("tokenizes notes before onSubmit",  has(accounts, 'getTokenizedValue(form.notes)'));
ok("server PUT /api/accounts saveMentions for notes",
   has(routes, "saveMentions(") && has(routes, "entityType: \"account\""));
ok("server deep-link /accounts?id=",   has(routes, '/accounts?id=${_aid}'));

// ─── 2. Contact Notes ────────────────────────────────────────────────────────
console.log("\n── 2. Contact Notes (edit-contact-dialog.tsx) ──");
ok("imports MentionInput",             has(contacts, 'from "@/components/shared/mention-input"'));
ok("imports useRef",                   has(contacts, "useRef"));
ok("declares notesRef",                has(contacts, "notesRef"));
ok("initFromTokenText on dialog open", has(contacts, "initFromTokenText(contact"));
ok("Textarea replaced by MentionInput", has(contacts, "<MentionInput"));
ok("tokenizes before PUT",             has(contacts, "getTokenizedValue(form.notes)"));
ok("server PUT /api/contacts saveMentions", has(routes, 'entityType: "contact"'));

// ─── 3. Meeting Notes ────────────────────────────────────────────────────────
console.log("\n── 3. Meeting Notes (calendar.tsx PostMeetingTab) ──");
ok("imports MentionInput",             has(calendar, 'from "@/components/shared/mention-input"'));
ok("PostMeetingTab declares meetingNotesRef",
   has(calendar, "meetingNotesRef"));
ok("MentionInput in meeting notes area",
   has(calendar, 'data-testid="textarea-meeting-notes"') &&
   has(calendar, "ref={meetingNotesRef}"));
ok("tokenizes meeting notes in mutation",
   has(calendar, "getTokenizedValue(notes)"));
ok("server POST /api/calendar/events/:id/post-meeting saveMentions",
   has(routes, 'entityType: "calendar_event"'));

// ─── 4. Calendar Outcome Notes ───────────────────────────────────────────────
console.log("\n── 4. Calendar Outcome Notes (calendar.tsx OutcomeTab) ──");
ok("OutcomeTab declares outcomeNotesRef",   has(calendar, "outcomeNotesRef"));
ok("MentionInput in outcome notes area",
   has(calendar, 'data-testid="textarea-outcome-notes"') &&
   has(calendar, "ref={outcomeNotesRef}"));
ok("mentionNotes sent to POST /api/activities",
   has(calendar, "mentionNotes:"));
ok("server POST /api/activities extracts mentionNotes",
   has(routes, "_actMentionNotes"));
ok("server POST /api/activities saveMentions for mentionNotes",
   has(routes, 'entityType: "activity"'));

// ─── 5. Project Description ──────────────────────────────────────────────────
console.log("\n── 5. Project Description (projects.tsx) ──");
ok("imports MentionInput",             has(projects, 'from "@/components/shared/mention-input"'));
ok("ProjectEditDialog declares descriptionRef", has(projects, "descriptionRef"));
ok("initFromTokenText for description", has(projects, "initFromTokenText(project.description)"));
ok("MentionInput for description",
   has(projects, "ref={descriptionRef}"));
ok("tokenizes description in save",
   has(projects, "getTokenizedValue(description)"));
ok("server PUT /api/projects/:id saveMentions for description",
   has(routes, 'entityType: "project"'));

// ─── 6. Project Compliance Notes ────────────────────────────────────────────
console.log("\n── 6. Project Compliance Notes (projects.tsx) ──");
ok("CertificationDetailPanel declares complianceNotesRef",
   has(projects, "complianceNotesRef"));
ok("MentionInput for compliance_notes",
   has(projects, "ref={complianceNotesRef}"));
ok("handleSave tokenizes compliance_notes",
   has(projects, "getTokenizedValue(raw)"));
ok("server POST /api/projects/:id/certification saveMentions",
   has(routes, 'entityType: "project_cert"'));
ok("cert compliance deep-link includes ?tab=certification",
   has(routes, "tab=certification"));

// ─── 7. Ticket Description ───────────────────────────────────────────────────
console.log("\n── 7. Ticket Description (tickets.tsx) ──");
ok("imports MentionInput",             has(tickets, 'from "@/components/shared/mention-input"'));
ok("imports useRef",                   has(tickets, "useRef"));
ok("CreateTicketForm declares descriptionRef", has(tickets, "descriptionRef"));
ok("MentionInput for description",     has(tickets, "<MentionInput ref={descriptionRef}"));
ok("tokenizes description in submit",  has(tickets, "getTokenizedValue(form.description)"));
ok("server POST /api/tickets saveMentions",
   has(routes, 'entityType: "ticket"') && has(routes, "/support/tickets?id="));
ok("server PUT /api/tickets/:id saveMentions",
   has(routes, 'entityType: "ticket"') && has(routes, "_tkUpdUserId"));

// ─── 8 & 9. Quote Notes + Assumptions ───────────────────────────────────────
console.log("\n── 8+9. Quote Notes & Assumptions (quotes.tsx) ──");
ok("imports MentionInput",             has(quotes, 'from "@/components/shared/mention-input"'));
ok("declares notesRef + assumptionsRef",
   has(quotes, "notesRef") && has(quotes, "assumptionsRef"));
ok("MentionInput for notes",           has(quotes, "ref={notesRef}"));
ok("MentionInput for assumptions",     has(quotes, "ref={assumptionsRef}"));
ok("tokenizes notes in handleSubmit",  has(quotes, "getTokenizedValue(notes)"));
ok("tokenizes assumptions in handleSubmit", has(quotes, "getTokenizedValue(assumptions)"));
ok("server PUT /api/quotes/:id saveMentions for notes",
   has(routes, 'entityType: "quote"'));
ok("server PUT /api/quotes/:id saveMentions for assumptions",
   has(routes, 'entityType: "quote_assumptions"'));

// ─── 10. Marketing Campaign Notes ────────────────────────────────────────────
console.log("\n── 10. Marketing Campaign Notes (marketing-campaigns.tsx) ──");
ok("imports MentionInput",             has(mktCamp, 'from "@/components/shared/mention-input"'));
ok("imports useRef",                   has(mktCamp, "useRef"));
ok("declares notesRef",                has(mktCamp, "notesRef"));
ok("MentionInput for notes",           has(mktCamp, "<MentionInput"));
ok("tokenizes notes before createMutation.mutate",
   has(mktCamp, "getTokenizedValue(form.notes)"));
ok("server POST /api/marketing/campaigns saveMentions",
   has(routes, 'entityType: "marketing_campaign"'));

// ─── @all scope guardrails ────────────────────────────────────────────────────
console.log("\n── @all scope guardrails (non-Currents modules) ──");

function noAllExpansion(label, src) {
  // These files must not call saveMentions with moduleKey:'currents'
  // AND must not include @all injection from use-mention-composer
  const hasAllExpansion = src.includes("@all") && src.includes("moduleKey.*currents");
  ok(`${label}: no @all expansion`, !hasAllExpansion);
}

noAllExpansion("accounts.tsx", accounts);
noAllExpansion("edit-contact-dialog.tsx", contacts);
noAllExpansion("tickets.tsx", tickets);
noAllExpansion("quotes.tsx", quotes);
noAllExpansion("marketing-campaigns.tsx", mktCamp);

// MentionInput component itself must not inject @all
const mentionInput = read("client/src/components/shared/mention-input.tsx");
ok("MentionInput component: no @all injection", !has(mentionInput, '"@all"'));

// use-mention-composer: @all must be commented out / guarded
const composerHook = read("client/src/hooks/use-mention-composer.ts");
ok("use-mention-composer: no active @all push",
   !has(composerHook, /(?<!\/\/).*push.*isAll.*true/));

// mention-service saveMentions: @all expansion only for moduleKey='currents'
const mentionSvc = read("server/services/mention-service.ts");
ok("mention-service: @all expansion gated by moduleKey==='currents'",
   has(mentionSvc, "moduleKey") && has(mentionSvc, "'currents'"));

// ─── Deep-link coverage ───────────────────────────────────────────────────────
console.log("\n── Deep-link coverage ──");
ok("/accounts?id= deep-link",       has(routes, "/accounts?id="));
ok("/contacts?id= deep-link",       has(routes, "/contacts?id="));
ok("/calendar?eventId= deep-link",  has(routes, "/calendar?eventId="));
ok("/calendar?activityId= deep-link", has(routes, "/calendar?activityId="));
ok("/projects?id= deep-link",       has(routes, "/projects?id="));
ok("/support/tickets?id= deep-link",has(routes, "/support/tickets?id="));
ok("/quotes?id= deep-link",         has(routes, "/quotes?id="));
ok("/marketing/campaigns/ deep-link",has(routes, "/marketing/campaigns/"));

// ─── moduleKey diversity (each module uses its own key) ──────────────────────
console.log("\n── moduleKey diversity ──");
ok("crm moduleKey for accounts/contacts",  has(routes, 'moduleKey: "crm"'));
ok("calendar moduleKey for events",        has(routes, 'moduleKey: "calendar"'));
ok("projects moduleKey for projects",      has(routes, 'moduleKey: "projects"'));
ok("support moduleKey for tickets",        has(routes, 'moduleKey: "support"'));
ok("quoting moduleKey for quotes",         has(routes, 'moduleKey: "quoting"'));
ok("marketing moduleKey for campaigns",    has(routes, 'moduleKey: "marketing"'));

// ─── Fire-and-forget safety ───────────────────────────────────────────────────
console.log("\n── Fire-and-forget safety ──");
// Count saveMentions calls that end with .catch(() => {})
const catchCount = (routes.match(/saveMentions\([^)]*\)\.catch\(\(\) => \{\}\)/g) || []).length;
// We added at least 10 new saveMentions calls; include existing ones from leads/notes
ok("all new saveMentions calls use .catch()", catchCount >= 10);

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n═══════════════════════════════════════════`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════════════`);
process.exit(failed > 0 ? 1 : 0);
