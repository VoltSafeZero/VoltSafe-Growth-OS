"use strict";
/**
 * mention-display-rule.test.cjs
 *
 * Source-grep regression test: raw @[Name](user:ID) tokens must NEVER appear
 * in any textarea value prop or text content rendered directly to the DOM.
 *
 * RULE: DB stores token format; textarea editor state is ALWAYS clean text.
 *
 * This test pins invariants in the source code to prevent accidental regressions.
 */

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function ok(label, cond, detail = "") {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

function readFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function has(src, pattern) {
  if (typeof pattern === "string") return src.includes(pattern);
  return pattern.test(src);
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. Core hook invariants (use-mention-composer.ts)
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n=== mention-display-rule.test.cjs ===");
console.log("\n── 1. Core hook (use-mention-composer.ts) ──");

const hookSrc = readFile("client/src/hooks/use-mention-composer.ts");

ok("tokensToCleanText exported", has(hookSrc, "export function tokensToCleanText"));
ok("tokensToCleanText strips token format", has(hookSrc, 'text.replace(/@\\[([^\\]]+)\\]\\(user:\\d+\\)/g, "@$1")'));
ok("parseTokensToEntries exported", has(hookSrc, "export function parseTokensToEntries"));
ok("serializeToTokens exported", has(hookSrc, "export function serializeToTokens"));
ok("extractMentionedIds exported", has(hookSrc, "export function extractMentionedIds"));
ok("MentionEntry type exported", has(hookSrc, "export type MentionEntry"));
ok("insertMention inserts clean text (NOT token format)", !has(hookSrc, /insertMention[^}]*`@\[/));
ok("hook exposes serializeForSave", has(hookSrc, "serializeForSave"));
ok("hook exposes initFromTokenText", has(hookSrc, "initFromTokenText"));
ok("hook exposes updateEntryPositions", has(hookSrc, "updateEntryPositions"));

// ──────────────────────────────────────────────────────────────────────────────
// 2. MentionInput component invariants (mention-input.tsx)
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n── 2. MentionInput component (mention-input.tsx) ──");

const inputSrc = readFile("client/src/components/shared/mention-input.tsx");

ok("MentionInputHandle interface exported", has(inputSrc, "export interface MentionInputHandle"));
ok("getTokenizedValue in handle", has(inputSrc, "getTokenizedValue"));
ok("initFromTokenText in handle", has(inputSrc, "initFromTokenText"));
ok("forwardRef used", has(inputSrc, "forwardRef"));
ok("useImperativeHandle used", has(inputSrc, "useImperativeHandle"));
ok("display guard converts token-format value to clean text", has(inputSrc, "tokensToCleanText(value)"));
ok("guard fires on /@\\[/ detection", has(inputSrc, '/@\\[/.test(value)'));
ok("renderMentionBody exported", has(inputSrc, "export function renderMentionBody"));
ok("insertMention in component uses clean text (no bare token)", !has(inputSrc, /Textarea.*value.*@\[/));
ok("MentionInput passes updateEntryPositions on onChange", has(inputSrc, "updateEntryPositions"));

// ──────────────────────────────────────────────────────────────────────────────
// 3. task-detail-drawer.tsx — all compose paths serialize before save
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n── 3. task-detail-drawer.tsx ──");

const drawerSrc = readFile("client/src/components/tasks/task-detail-drawer.tsx");

ok("imports MentionInputHandle", has(drawerSrc, "type MentionInputHandle"));
ok("imports tokensToCleanText", has(drawerSrc, "tokensToCleanText"));
ok("DescriptionEditor: initial converted to clean text via tokensToCleanText",
  has(drawerSrc, "tokensToCleanText(initial)"));
ok("DescriptionEditor: getTokenizedValue called before PATCH",
  has(drawerSrc, "getTokenizedValue(val)"));
ok("DescriptionEditor: MentionInput has ref prop",
  has(drawerSrc, "ref={mentionRef}"));
ok("CompletionNotes: getTokenizedValue called before PATCH",
  /CompletionNotes[\s\S]{0,1500}getTokenizedValue/.test(drawerSrc));
ok("CommentsBlock: getTokenizedValue called before POST",
  /CommentsBlock[\s\S]{0,2000}getTokenizedValue/.test(drawerSrc));
ok("NewTaskForm: descMentionRef declared",
  has(drawerSrc, "descMentionRef"));
ok("NewTaskForm: getTokenizedValue used for description field",
  /descMentionRef.*getTokenizedValue|getTokenizedValue.*description/.test(drawerSrc));
ok("NewTaskForm description MentionInput has ref",
  has(drawerSrc, "ref={descMentionRef}") && has(drawerSrc, "input-new-task-description"));

// ──────────────────────────────────────────────────────────────────────────────
// 4. comments-feed.tsx — serialize before post
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n── 4. comments-feed.tsx ──");

const commentsSrc = readFile("client/src/components/comments-feed.tsx");

ok("imports MentionInputHandle", has(commentsSrc, "MentionInputHandle"));
ok("mentionRef declared", has(commentsSrc, "mentionRef"));
ok("MentionInput has ref prop", has(commentsSrc, "ref={mentionRef}"));
ok("getTokenizedValue called before mutate", has(commentsSrc, "getTokenizedValue"));
ok("handleSubmit serializes", /handleSubmit[\s\S]{0,200}getTokenizedValue/.test(commentsSrc));

// ──────────────────────────────────────────────────────────────────────────────
// 5. notes-panel.tsx — serialize before create and update
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n── 5. notes-panel.tsx ──");

const notesSrc = readFile("client/src/components/notes-panel.tsx");

ok("imports MentionInputHandle", has(notesSrc, "MentionInputHandle"));
ok("imports tokensToCleanText", has(notesSrc, "tokensToCleanText"));
ok("newNoteMentionRef declared", has(notesSrc, "newNoteMentionRef"));
ok("editMentionRef declared", has(notesSrc, "editMentionRef"));
ok("new-note MentionInput has ref", has(notesSrc, "ref={newNoteMentionRef}"));
ok("edit MentionInput has ref", has(notesSrc, "ref={editMentionRef}"));
ok("createMutation accepts content param", has(notesSrc, "mutationFn: async (content: string)"));
ok("new-note serialize before create", /newNoteMentionRef.*getTokenizedValue|getTokenizedValue.*newContent/.test(notesSrc));
ok("edit serialize before update", /editMentionRef.*getTokenizedValue|getTokenizedValue.*editContent/.test(notesSrc));
ok("startEdit converts tokens to clean text", has(notesSrc, "tokensToCleanText(note.content)"));
ok("startEdit re-populates registry via initFromTokenText", has(notesSrc, "initFromTokenText(note.content"));

// ──────────────────────────────────────────────────────────────────────────────
// 6. current.tsx — CURRENTS inline mention system
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n── 6. current.tsx CURRENTS composer ──");

const currentSrc = readFile("client/src/pages/current.tsx");

ok("insertMentionToken inserts clean text (NOT token format)",
  !has(currentSrc, /`@\[.*\]\(user:\${user\.id}\) `/));
ok("insertMentionToken produces @{user.name} clean text",
  has(currentSrc, "`@${user.name} `"));
ok("useComposerMentions has mentionEntriesRef",
  has(currentSrc, "mentionEntriesRef"));
ok("useComposerMentions exposes serializeForSave",
  has(currentSrc, "serializeForSave"));
ok("useComposerMentions exposes clearEntries",
  has(currentSrc, "clearEntries"));
ok("useComposerMentions exposes updateEntryPositions",
  has(currentSrc, "updateEntryPositions"));
ok("handleReplySend serializes via serializeForSave",
  /handleReplySend[\s\S]{0,400}serializeForSave/.test(currentSrc));
ok("handleSend serializes via serializeForSave",
  /handleSend[\s\S]{0,800}serializeForSave/.test(currentSrc));
ok("handleDmSend serializes via serializeForSave",
  /handleDmSend[\s\S]{0,400}serializeForSave/.test(currentSrc));
ok("clearEntries called after reply send", has(currentSrc, "replyMention.clearEntries()"));
ok("clearEntries called after channel send", has(currentSrc, "mainMention.clearEntries()"));
ok("clearEntries called after DM send", has(currentSrc, "dmMention.clearEntries()"));

// ──────────────────────────────────────────────────────────────────────────────
// 7. No raw token literals in JSX value/defaultValue props
//    (belt-and-suspenders: grep for obvious leaks)
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n── 7. No raw token literals in JSX ──");

// These files must NOT have a <Textarea value={...tokens...} or defaultValue containing raw tokens
const filesToAudit = [
  "client/src/components/tasks/task-detail-drawer.tsx",
  "client/src/components/comments-feed.tsx",
  "client/src/components/notes-panel.tsx",
  "client/src/pages/current.tsx",
];

// The display guard inside MentionInput handles runtime values, but we
// also ensure there are no static string literals with token format leaked into JSX.
const RAW_TOKEN_LITERAL = /@\[.*\]\(user:\d+\)/;
for (const rel of filesToAudit) {
  const src = readFile(rel);
  const basename = path.basename(rel);
  // Allow the pattern inside string regexes and comments, but flag JSX string literals
  const jsxStringTokens = src.match(/(?:value|defaultValue)=["'`][^"'`]*@\[[^\]]+\]\(user:\d+\)/g);
  ok(`${basename}: no raw token literals in JSX value props`, !jsxStringTokens,
    jsxStringTokens ? `found: ${jsxStringTokens[0]}` : "");
}

// ──────────────────────────────────────────────────────────────────────────────
// 8. Read-mode uses renderMentionBody (not plain text rendering of body)
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n── 8. Read-mode render ──");

ok("task-detail-drawer: read mode uses renderMentionBody",
  has(drawerSrc, "renderMentionBody(initial)") || has(drawerSrc, "renderMentionBody("));
ok("comments-feed: read mode uses renderMentionBody",
  has(commentsSrc, "renderMentionBody(c.body)") || has(commentsSrc, "renderMentionBody("));
ok("notes-panel: read mode uses renderMentionBody",
  has(notesSrc, "renderMentionBody(note.content)") || has(notesSrc, "renderMentionBody("));
ok("current.tsx: read mode uses renderMentionBody",
  has(currentSrc, "renderMentionBody("));

// ──────────────────────────────────────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log("─".repeat(60));
if (failed > 0) process.exit(1);
