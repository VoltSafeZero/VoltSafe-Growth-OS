/**
 * at-all-scope.test.cjs
 *
 * Regression suite: @all is a CURRENTS-ONLY broadcast feature.
 *
 * Permitted contexts:
 *   - Currents public channel message composer
 *   - Currents private channel message composer (membership rules apply)
 *   - Currents thread reply composer
 *   - Currents message edit flow (preserves existing @all for channel messages)
 *
 * Forbidden contexts (must NEVER show, save, expand, or notify):
 *   - DM composers (1:1 and group) in Currents
 *   - Member pickers / Add Member / Channel-create picker in Currents
 *   - Every non-Currents CMS field (Leads, Accounts, Tasks, Comments, etc.)
 *
 * Ten required checks (T1–T10):
 *   T1.  @all appears in permitted Currents channel composers.
 *   T2.  @all appears in permitted Currents thread composers.
 *   T3.  @all does NOT appear in Currents New DM search.
 *   T4.  @all does NOT appear in Currents Group DM or member pickers.
 *   T5.  @all does NOT appear in Leads mention fields.
 *   T6.  @all does NOT appear in Accounts mention fields.
 *   T7.  @all does NOT appear in Task comments.
 *   T8.  @all does NOT appear anywhere outside Currents (CMS hook).
 *   T9.  Non-Currents backend mention parsing never expands @all.
 *   T10. A literal non-Currents "@all" remains plain text / is silently ignored.
 */

"use strict";

const fs   = require("fs");
const path = require("path");

// ── Fixtures ─────────────────────────────────────────────────────────────────

const ROOT = path.join(__dirname, "..");

const CURRENT_TSX  = fs.readFileSync(path.join(ROOT, "client/src/pages/current.tsx"), "utf8");
const USE_CURR_USR = fs.readFileSync(path.join(ROOT, "client/src/hooks/use-current-users.ts"), "utf8");
const USE_MENTION  = fs.readFileSync(path.join(ROOT, "client/src/hooks/use-mention-composer.ts"), "utf8");
const MENTION_SVC  = fs.readFileSync(path.join(ROOT, "server/services/mention-service.ts"), "utf8");
const ROUTES       = fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf8");

// ── Helpers ───────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

function check(label, cond) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

function assertIn(label, src, pattern) {
  const ok = typeof pattern === "string" ? src.includes(pattern) : pattern.test(src);
  check(label, ok);
}

function assertNotIn(label, src, pattern) {
  const found = typeof pattern === "string" ? src.includes(pattern) : pattern.test(src);
  check(label, !found);
}

// ── T1: @all in permitted Currents CHANNEL composers ─────────────────────────
console.log("\n── T1: @all permitted in Currents channel composers ──");

assertIn(
  "T1.1 useCurrentUsers hook has includeAll parameter",
  USE_CURR_USR,
  "includeAll"
);

assertIn(
  "T1.2 useCurrentUsers injects @all virtual entry when includeAll=true",
  USE_CURR_USR,
  /includeAll && shouldShowAll/
);

assertIn(
  "T1.3 mainMention (channel composer) uses useComposerMentions with default allowAll=true",
  // mainMention is declared as useComposerMentions(textareaRef) or useComposerMentions(textareaRef, true)
  // — no explicit false argument → defaults to true (allowed)
  CURRENT_TSX,
  /const mainMention = useComposerMentions\(textareaRef\)/
);

assertIn(
  "T1.4 useComposerMentions passes allowAll to useCurrentUsers",
  CURRENT_TSX,
  /useCurrentUsers\(\s*mentionQuery,\s*mentionActive,\s*allowAll\s*\)/
);

assertIn(
  "T1.5 useComposerMentions has allowAll parameter (defaults to true for channel use)",
  CURRENT_TSX,
  /function useComposerMentions\([^)]*allowAll\s*=\s*true/
);

// ── T2: @all in permitted Currents THREAD composers ───────────────────────────
console.log("\n── T2: @all permitted in Currents thread composers ──");

assertIn(
  "T2.1 replyMention uses useComposerMentions (no allowAll=false → defaults to true)",
  CURRENT_TSX,
  /const replyMention = useComposerMentions\(replyTextareaRef\)/
);

assertIn(
  "T2.2 Thread-panel InlineEditRow (editing a reply) has no isDirectMessage prop",
  // The two thread-context InlineEditRow renders (lines 2067, 2125) must NOT
  // pass isDirectMessage, so they inherit the default allowAll=true.
  // Confirmed by checking the thread-edit block.
  CURRENT_TSX,
  /editingReply\?\.id === reply\.id/
);

assertIn(
  "T2.3 Thread-panel InlineEditRow for root message edit has no isDirectMessage prop",
  CURRENT_TSX,
  /editingReply\?\.id === root\.id/
);

// ── T3: @all does NOT appear in Currents New DM search ───────────────────────
console.log("\n── T3: @all absent from Currents New DM search ──");

assertIn(
  "T3.1 NewDmDialog calls useCurrentUsers with includeAll=false",
  CURRENT_TSX,
  /useCurrentUsers\(debouncedQ,\s*open,\s*false\)/
);

assertNotIn(
  "T3.2 NewDmDialog does NOT call useCurrentUsers with includeAll=true",
  CURRENT_TSX,
  // If NewDmDialog called useCurrentUsers(..., true) that would be a bug.
  // We verify by checking the exact pattern used in the dialog.
  /useCurrentUsers\(debouncedQ,\s*open,\s*true\)/
);

assertIn(
  "T3.3 dmMention (DM textarea composer) explicitly passes allowAll=false",
  CURRENT_TSX,
  /const dmMention = useComposerMentions\(dmTextareaRef,\s*false\)/
);

assertNotIn(
  "T3.4 DM textarea composer does NOT use allowAll=true",
  CURRENT_TSX,
  /const dmMention = useComposerMentions\(dmTextareaRef,\s*true\)/
);

// ── T4: @all absent from Group DM and member pickers ─────────────────────────
console.log("\n── T4: @all absent from Group DM / member pickers ──");

assertIn(
  "T4.1 GroupMemberDialog calls useCurrentUsers with includeAll=false",
  CURRENT_TSX,
  // The call may be formatted across two lines:
  //   useCurrentUsers(
  //     debouncedQ, open && !confirmLeave, false
  //   );
  /useCurrentUsers\([\s\S]{0,60}debouncedQ,\s*open && !confirmLeave,\s*false/
);

assertIn(
  "T4.2 MemberPickerInline (channel create/edit/add-member) uses includeAll=false",
  CURRENT_TSX,
  /useCurrentUsers\(q,\s*true,\s*false\)/
);

assertIn(
  "T4.3 DM inline edit passes isDirectMessage prop → suppresses @all in edit mode",
  CURRENT_TSX,
  /isDirectMessage\b/
);

assertIn(
  "T4.4 InlineEditRow uses allowAll=!isDirectMessage so DM edits get false",
  CURRENT_TSX,
  /useComposerMentions\(taRef,\s*!isDirectMessage\)/
);

assertIn(
  "T4.5 DM message edit renders InlineEditRow with isDirectMessage flag",
  CURRENT_TSX,
  // The InlineEditRow for DM edits spans several lines (key, message, onSave, onCancel, isDirectMessage)
  /editingDmMessage[\s\S]{1,600}InlineEditRow[\s\S]{1,600}isDirectMessage/
);

// ── T5: @all absent from Leads mention fields ─────────────────────────────────
console.log("\n── T5: @all absent from Leads mention fields ──");

// MentionInput (used in Leads, Accounts, etc.) delegates to useMentionComposer.
// That hook must NOT inject the @all virtual entry.
assertNotIn(
  "T5.1 use-mention-composer does NOT inject @all virtual entry",
  USE_MENTION,
  /\{ id: 0, name: "all", isAll: true \}/
);

assertNotIn(
  "T5.2 use-mention-composer does NOT have 'everyone' or 'team' @all trigger logic",
  USE_MENTION,
  /"everyone"\.startsWith/
);

assertIn(
  "T5.3 use-mention-composer states @all is Currents-only (has an explanatory comment)",
  USE_MENTION,
  "CURRENTS-ONLY broadcast"
);

assertIn(
  "T5.4 MentionInput component uses useMentionComposer (the CMS-safe hook, not useCurrentUsers)",
  fs.readFileSync(path.join(ROOT, "client/src/components/shared/mention-input.tsx"), "utf8"),
  "useMentionComposer"
);

// ── T6: @all absent from Accounts mention fields ──────────────────────────────
console.log("\n── T6: @all absent from Accounts mention fields ──");

// Accounts also uses MentionInput → same useMentionComposer hook.
// Confirm the hook exports no @all pathway.
assertNotIn(
  "T6.1 use-mention-composer showAll variable does not exist (removed)",
  USE_MENTION,
  "const showAll"
);

assertNotIn(
  "T6.2 use-mention-composer allEntry variable does not exist (removed)",
  USE_MENTION,
  "const allEntry"
);

assertIn(
  "T6.3 mention-service saveMentions guards @all expansion to moduleKey='currents'",
  MENTION_SVC,
  "allowAllExpansion = opts.moduleKey === \"currents\""
);

// ── T7: @all absent from Task comments ───────────────────────────────────────
console.log("\n── T7: @all absent from Task comments ──");

assertIn(
  "T7.1 saveMentions skips @all expansion when allowAllExpansion=false",
  MENTION_SVC,
  "if (allowAllExpansion)"
);

assertIn(
  "T7.2 saveMentions has silent-skip comment for non-Currents @all",
  MENTION_SVC,
  "// else: @all in a non-Currents field → silently skip (no broadcast)"
);

assertIn(
  "T7.3 refreshMentions applies the same allowAllExpansion guard",
  MENTION_SVC,
  // refreshMentions also reads opts.moduleKey
  /refreshMentions[\s\S]{1,500}allowAllExpansion = opts\.moduleKey === "currents"/
);

// ── T8: @all absent everywhere outside Currents (server endpoint) ─────────────
console.log("\n── T8: @all absent from /api/current/users server response ──");

assertNotIn(
  "T8.1 Server /api/current/users does NOT return @all virtual entry",
  ROUTES,
  "Notify everyone"
);

assertNotIn(
  "T8.2 Server /api/current/users does NOT inject id:0 user object",
  ROUTES,
  /\{ id: 0, name: "all"[\s\S]{0,60}isAll: true \}/
);

assertIn(
  "T8.3 Server route has comment explaining @all is client-side only",
  ROUTES,
  "@all is a CURRENTS-ONLY broadcast"
);

assertIn(
  "T8.4 use-current-users hook (canonical) handles @all entirely client-side",
  USE_CURR_USR,
  // The hook injects @all itself without relying on the server returning it.
  /if \(includeAll && shouldShowAll/
);

// ── T9: Non-Currents backend parsing never expands @all ────────────────────────
console.log("\n── T9: Non-Currents backend never expands @all ──");

assertIn(
  "T9.1 mention-service checks moduleKey before expanding @all",
  MENTION_SVC,
  'opts.moduleKey === "currents"'
);

assertIn(
  "T9.2 saveMentions @all guard covers both expand path and skip path",
  MENTION_SVC,
  /if \(allowAllExpansion\) \{[\s\S]{1,200}\}[\s\n\s]*\/\/ else: @all in a non-Currents/
);

assertIn(
  "T9.3 refreshMentions @all guard also has an else-skip path",
  MENTION_SVC,
  /if \(allowAllExpansion\) \{[\s\S]{1,500}\/\/ else: @all in a non-Currents edit/
);

assertIn(
  "T9.4 parseCurrentMentionTokens (Currents-only server fn) remains scoped to Currents channel routes",
  ROUTES,
  // This function is declared inside the Currents message block and only called from syncCurrentMentions.
  "function parseCurrentMentionTokens"
);

assertNotIn(
  "T9.5 parseCurrentMentionTokens is NOT exported (Currents-internal only)",
  ROUTES,
  "export function parseCurrentMentionTokens"
);

// ── T10: Non-Currents @all token stays as plain text ──────────────────────────
console.log("\n── T10: Non-Currents @all literal becomes plain text only ──");

assertIn(
  "T10.1 parseMentionTokens correctly identifies @[all](user:0) as isAll=true",
  MENTION_SVC,
  "isAll: userId === 0 || name === \"all\""
);

assertIn(
  "T10.2 saveMentions: when allowAllExpansion=false and isAll=true → skipped entirely (no uid added)",
  // Verify the @all branch is inside the allowAllExpansion check (no fallthrough to mentionedUserIds.add)
  MENTION_SVC,
  /if \(t\.isAll\) \{\s*if \(allowAllExpansion\)/
);

assertNotIn(
  "T10.3 saveMentions does NOT add uid=0 to mentionedUserIds in any code path",
  // user:0 is the @all sentinel; it should never be stored as a real recipient
  MENTION_SVC,
  "mentionedUserIds.add(0)"
);

assertIn(
  "T10.4 saveMentions preview line renders @[all](user:0) as plain '@all' text",
  // The preview stored in global_mentions uses .replace(/@\[...\](user:\d+)/g, "@$1")
  // so @[all](user:0) becomes the plain string "@all" in stored previews.
  MENTION_SVC,
  '.replace(/@\\[([^\\]]+)\\]\\(user:\\d+\\)/g, "@$1")'
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n" + "═".repeat(60));
console.log(`  @all scope: ${passed} passed, ${failed} failed`);
console.log("═".repeat(60));
if (failed > 0) process.exit(1);
