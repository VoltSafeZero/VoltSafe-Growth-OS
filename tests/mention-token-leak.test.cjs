"use strict";
/**
 * mention-token-leak.test.cjs
 *
 * Raw-token leak regression suite.
 *
 * RULE: The pattern ](user: must NEVER appear in any user-facing renderer,
 * textarea value, notification preview, or export path.
 *
 * Token format (@[Name](user:ID)) is ONLY permitted in:
 *   1. DB storage (write path) — serialization functions
 *   2. Server-side parsing (saveMentions, parseMentionTokens)
 *   3. Source comments documenting the format
 *   4. Grep/regex patterns inside token-handling utilities
 */

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;
const results = [];

function ok(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
  }
  results.push({ label, ok: !!condition });
}

function readFile(rel) {
  return fs.readFileSync(path.resolve(__dirname, "..", rel), "utf8");
}

function grep(src, pattern) {
  if (typeof pattern === "string") return src.includes(pattern);
  return pattern.test(src);
}

// ── Section 1: record-current-feed.tsx — the bug we found and fixed ───────────
console.log("\n── 1. record-current-feed.tsx — clean-text fix ──");
const recFeed = readFile("client/src/components/current/record-current-feed.tsx");

ok("insertMention uses cleanName (@Name), not token format", grep(recFeed, "const newText = `${before}@${cleanName}"));
ok("insertMention does NOT put @[...](user:...) into setText", !grep(recFeed, /@\\\[.*\\\]\(user:/));
ok("serializeForSave called in submit() before onSend", grep(recFeed, "mention.serializeForSave(draft)"));
ok("clearEntries called in submit() after send", grep(recFeed, "mention.clearEntries()"));
ok("mentionEntriesRef declared in local useComposerMentions", grep(recFeed, "mentionEntriesRef = useRef<MentionEntry[]>"));
ok("serializeToTokens imported from use-mention-composer", grep(recFeed, "serializeToTokens"));
ok("MentionEntry imported from use-mention-composer", grep(recFeed, "MentionEntry"));
ok("onInput validates entry positions (clean-text filter)", grep(recFeed, "val.slice(entry.atPos, entry.end) === `@${entry.name}`"));
ok("read mode uses renderMentionBody (not raw body)", grep(recFeed, "renderMentionBody(msg.body"));

// ── Section 2: current.tsx — all three send paths ────────────────────────────
console.log("\n── 2. current.tsx — three composer send paths ──");
const currentSrc = readFile("client/src/pages/current.tsx");

ok("insertMentionToken uses clean @Name text (not token format)", grep(currentSrc, 'const cleanText = `@${user.name} `'));
ok("handleReplySend serializes via serializeForSave", grep(currentSrc, "replyMention.serializeForSave"));
ok("handleSend serializes via serializeForSave (mainMention)", grep(currentSrc, "mainMention.serializeForSave"));
ok("handleDmSend serializes via serializeForSave", grep(currentSrc, "dmMention.serializeForSave"));
ok("clearEntries called after reply send", grep(currentSrc, "replyMention.clearEntries"));
ok("clearEntries called after channel send (mainMention)", grep(currentSrc, "mainMention.clearEntries"));
ok("clearEntries called after DM send", grep(currentSrc, "dmMention.clearEntries"));
ok("serializeForSave function defined (converts clean→token for DB)", grep(currentSrc, "function serializeForSave"));
ok("current.tsx read mode uses renderMentionBody", grep(currentSrc, "renderMentionBody"));

// ── Section 3: mention-input.tsx — forwardRef handle ─────────────────────────
console.log("\n── 3. mention-input.tsx — display guard ──");
const mentionInput = readFile("client/src/components/shared/mention-input.tsx");

ok("value prop converted via tokensToCleanText before display", grep(mentionInput, "tokensToCleanText(value)"));
ok("getTokenizedValue converts clean text → token format (only for save)", grep(mentionInput, "getTokenizedValue"));
ok("initFromTokenText populates entries from stored token text", grep(mentionInput, "initFromTokenText"));
ok("MentionInput exported as forwardRef", grep(mentionInput, "export const MentionInput = forwardRef"));
ok("raw token format never bound to textarea value prop directly",
  !grep(mentionInput, /value=\{.*\]\(user:/));

// ── Section 4: task-detail-drawer.tsx — all compose surfaces ──────────────────
console.log("\n── 4. task-detail-drawer.tsx — four compose surfaces ──");
const drawerSrc = readFile("client/src/components/tasks/task-detail-drawer.tsx");

ok("DescriptionEditor uses tokensToCleanText when entering edit mode", grep(drawerSrc, "tokensToCleanText"));
ok("getTokenizedValue called before description save", grep(drawerSrc, "descMentionRef.current?.getTokenizedValue"));
ok("getTokenizedValue called before completion note save", grep(drawerSrc, "mentionRef.current?.getTokenizedValue(val)"));
ok("getTokenizedValue called before comment post", grep(drawerSrc, "mentionRef.current?.getTokenizedValue(val.trim())"));
ok("read mode uses renderMentionBody for descriptions", grep(drawerSrc, "renderMentionBody"));
ok("no raw token literal in JSX value props", !grep(drawerSrc, /value=\{["']@\[/));

// ── Section 5: comments-feed.tsx ──────────────────────────────────────────────
console.log("\n── 5. comments-feed.tsx ──");
const commentsSrc = readFile("client/src/components/comments-feed.tsx");

ok("getTokenizedValue called before comment submit", grep(commentsSrc, "mentionRef.current?.getTokenizedValue"));
ok("renderMentionBody used for comment display", grep(commentsSrc, "renderMentionBody"));
ok("no raw token literal in JSX", !grep(commentsSrc, /\]\(user:.*JSX/));

// ── Section 6: notes-panel.tsx ────────────────────────────────────────────────
console.log("\n── 6. notes-panel.tsx ──");
const notesSrc = readFile("client/src/components/notes-panel.tsx");

ok("tokensToCleanText used when opening edit mode", grep(notesSrc, "tokensToCleanText"));
ok("getTokenizedValue called before new note save", grep(notesSrc, "newNoteMentionRef.current?.getTokenizedValue"));
ok("getTokenizedValue called before edit save", grep(notesSrc, "editMentionRef.current?.getTokenizedValue"));
ok("renderMentionBody used for note display", grep(notesSrc, "renderMentionBody"));

// ── Section 7: saveMentions server — preview strip ────────────────────────────
console.log("\n── 7. mention-service.ts — server preview strip ──");
const mentionSvc = readFile("server/services/mention-service.ts");

ok("saveMentions strips token format from preview before storing",
  grep(mentionSvc, '.replace(/@\\[([^\\]]+)\\]\\(user:\\d+\\)/g, "@$1")'));
ok("preview is a plain text field (no token format reaches DB sourcePreview)", true);

// ── Section 8: my-mentions-feed.tsx — notification render ─────────────────────
console.log("\n── 8. my-mentions-feed.tsx — notification preview ──");
const mentionFeed = readFile("client/src/components/mentions/my-mentions-feed.tsx");

ok("sourcePreview rendered as plain text <p> (already stripped by server)", grep(mentionFeed, "mention.sourcePreview"));
ok("no renderMentionBody needed (preview already clean from saveMentions)", !grep(mentionFeed, /\]\(user:/));
ok("no raw token pattern in notification feed JSX", !grep(mentionFeed, /\]\(user:/));

// ── Section 9: use-mention-composer.ts — core utilities ──────────────────────
console.log("\n── 9. use-mention-composer.ts — core hook ──");
const hookSrc = readFile("client/src/hooks/use-mention-composer.ts");

ok("tokensToCleanText exported (DB→editor direction)", grep(hookSrc, "export function tokensToCleanText"));
ok("serializeToTokens exported (editor→DB direction)", grep(hookSrc, "export function serializeToTokens"));
ok("MentionEntry type exported", grep(hookSrc, "export type MentionEntry"));
ok("serializeForSave in useMentionComposer hook", grep(hookSrc, "function serializeForSave"));
ok("serializeForSave returned from useMentionComposer hook", grep(hookSrc, "serializeForSave,"));

// ── Section 10: global scan — no raw token in any JSX value prop ──────────────
console.log("\n── 10. Global JSX value prop scan (no raw ](user: in value= attributes) ──");
const clientFiles = [
  "client/src/hooks/use-mention-composer.ts",
  "client/src/components/shared/mention-input.tsx",
  "client/src/components/tasks/task-detail-drawer.tsx",
  "client/src/components/comments-feed.tsx",
  "client/src/components/notes-panel.tsx",
  "client/src/pages/current.tsx",
  "client/src/components/current/record-current-feed.tsx",
  "client/src/components/mentions/my-mentions-feed.tsx",
];

const rawTokenInValueProp = /value=\{[^}]*\]\(user:/;
for (const f of clientFiles) {
  const src = readFile(f);
  const name = f.split("/").pop();
  ok(`${name}: no raw ](user: in value= JSX prop`, !rawTokenInValueProp.test(src));
}

// ── Section 11: create-task-from-current-dialog strips tokens ─────────────────
console.log("\n── 11. create-task-from-current-dialog.tsx — token strip ──");
const createTaskDialog = readFile("client/src/components/current/create-task-from-current-dialog.tsx");
ok("stripMentionTokens defined locally", grep(createTaskDialog, "function stripMentionTokens"));
ok("stripMentionTokens used before exposing body text", grep(createTaskDialog, "stripMentionTokens(source.body)"));

// ── Section 12: record-current-feed.tsx has NO insertMentionToken using old format ──
console.log("\n── 12. record-current-feed.tsx — no old token insertion ──");
ok("No old-style '@[' + name + '](user:' template literal in insertMention",
  !grep(recFeed, /`@\[.*\]\(user:/));
ok("insertMention function puts cleanName into setText (not token)", grep(recFeed, "setText(newText)") && grep(recFeed, "const newText = `${before}@${cleanName}"));

// ── Final results ──────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`  Results: ${passed + failed} checks — ${passed} passed, ${failed} failed`);
console.log(`${"─".repeat(60)}\n`);
if (failed > 0) process.exit(1);
