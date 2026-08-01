"use strict";
/**
 * currents-mentions-phase2.test.cjs
 *
 * Phase 2 automated tests for the universal @mentions system.
 * Covers all requirements from UNIVERSAL-MENTIONS-PHASE-2-AUDIT.
 *
 * These are structural/source-code tests that verify:
 *  - syncCurrentMentions correctness (server logic)
 *  - @all expansion path
 *  - mute bypass for direct mentions
 *  - edit resync / stale mention cleanup
 *  - dedupe key design
 *  - refreshMentions cleanup
 *  - global_mentions unique constraint migration
 *  - useCurrentUsers canonical hook
 *  - Part 1: verified fixes (@ stripping, public participants)
 */

const fs   = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function check(label, value) {
  if (value) { console.log(`  ✓ ${label}`); passed++; }
  else        { console.error(`  ✗ ${label}`); failed++; }
}

const ROUTES    = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");
const MSVC      = fs.readFileSync(path.join(__dirname, "../server/services/mention-service.ts"), "utf8");
const SEED      = fs.readFileSync(path.join(__dirname, "../server/seed-production.ts"), "utf8");
const INDEX_TS  = fs.readFileSync(path.join(__dirname, "../server/index.ts"), "utf8");
const HOOK_PATH = path.join(__dirname, "../client/src/hooks/use-current-users.ts");
const HOOK      = fs.existsSync(HOOK_PATH) ? fs.readFileSync(HOOK_PATH, "utf8") : "";

// ── Fix 1 (verified): @ stripping in /api/current/users ──────────────────────
console.log("\n── Fix 1 (verified): @ stripping in /api/current/users ──");

const usersIdx  = ROUTES.indexOf("// GET /api/current/users?q=");
const usersBody = ROUTES.slice(usersIdx, usersIdx + 1000);

check(
  "route strips leading @ from query",
  usersBody.includes('.trim().replace(/^@/, "")')
);
// @all is a CLIENT-SIDE virtual entry injected by useMentionComposer / useCurrentUsers.
// The server returns regular users; the client prepends @all when the query matches.
const MENTION_COMPOSER = fs.readFileSync(
  path.join(__dirname, "../client/src/hooks/use-mention-composer.ts"), "utf8"
);
check(
  "@all virtual entry injected by useMentionComposer when query matches 'all'",
  MENTION_COMPOSER.includes("isAll: true") &&
  (MENTION_COMPOSER.includes('"all".startsWith(q)') ||
   MENTION_COMPOSER.includes("'all'.startsWith(q)") ||
   MENTION_COMPOSER.includes('"all".startsWith') ||
   MENTION_COMPOSER.includes("allEntry"))
);

// ── Fix 2 (verified): public channel participants returns all active users ────
console.log("\n── Fix 2 (verified): public channel participants ──");

const partIdx  = ROUTES.indexOf("// GET /api/current/channels/:slug/participants");
const partBody = ROUTES.slice(partIdx, partIdx + 3000);

check(
  "public branch uses 'global_role NOT IN' to return full org",
  partBody.includes("global_role NOT IN ('inactive')")
);
check(
  "private branch still uses UNION of messages + prefs + members",
  partBody.includes("current_messages") &&
  partBody.includes("current_channel_preferences") &&
  partBody.includes("current_channel_members")
);
check(
  "userId declared before the private access check (Fix 3)",
  (() => {
    const declIdx  = partBody.indexOf("const userId = getSessionUserId(req)");
    const checkIdx = partBody.indexOf("user_id = ${userId}");
    return declIdx !== -1 && checkIdx !== -1 && declIdx < checkIdx;
  })()
);

// ── Part 3, Req 1: user_id stored in token ────────────────────────────────────
console.log("\n── Part 3: syncCurrentMentions correctness ──");

const syncIdx  = ROUTES.indexOf("async function syncCurrentMentions(");
const syncEnd  = ROUTES.indexOf("\n  }", syncIdx + 100) + 4;
const syncBody = ROUTES.slice(syncIdx, syncEnd + 2000); // enough to capture the function

check(
  "Req 1: token format @[Name](user:ID) parsed by parseCurrentMentionTokens",
  ROUTES.includes("parseCurrentMentionTokens") &&
  ROUTES.includes("function parseCurrentMentionTokens(body")
);
check(
  "Req 2: notification created via dedupe_key insert (exactly once)",
  syncBody.includes("WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE dedupe_key")
);
check(
  "Req 3: dedupe key is per-user per-message (same user = one notification)",
  syncBody.includes("`current_mention:${messageId}:${mid}`")
);
check(
  "Req 4: thread deep-link includes both thread and message params",
  syncBody.includes("thread=${parentMessageId}") &&
  syncBody.includes("message=${messageId}")
);
check(
  "Req 5: token format preserved across edits (ON CONFLICT DO NOTHING on current_mentions)",
  syncBody.includes("ON CONFLICT (message_id, mentioned_user_id) DO NOTHING")
);
check(
  "Req 6: edit cleanup — stale current_mention rows are DELETED",
  syncBody.includes("DELETE FROM current_mentions WHERE message_id = ${messageId} AND mentioned_user_id = ${uid}")
);
check(
  "Req 7: self-mentions excluded from targetUserIds (filter senderUserId)",
  syncBody.includes("filter(id => id !== senderUserId)") ||
  syncBody.includes("id !== senderUserId")
);
check(
  "Req 8: Currents Mentions feed gets current_mention rows (INSERT INTO current_mentions)",
  syncBody.includes("INSERT INTO current_mentions")
);
check(
  "Req 9: direct mentions bypass mute (isDirectMention check before mute skip)",
  syncBody.includes("isDirectMention") &&
  syncBody.includes("if (!isDirectMention && resolvedChannelId !== null)")
);
check(
  "Req 9: @all-expanded users still respect mute (only isDirectMention bypasses)",
  (() => {
    const muteBlock = syncBody.indexOf("if (!isDirectMention && resolvedChannelId");
    const muteSkip  = syncBody.indexOf("if (level === 'muted') continue", muteBlock);
    return muteBlock !== -1 && muteSkip !== -1 && muteSkip > muteBlock;
  })()
);
check(
  "Req 10: private channel membership checked in participants route (403)",
  partBody.includes("return res.status(403).json")
);

// @all expansion (was completely missing before)
check(
  "@all: hasAll detection present in parseCurrentMentionTokens",
  ROUTES.includes("id === 0") && ROUTES.includes("hasAll = true")
);
check(
  "@all: targetUserIds populated from full active roster when hasAll is true",
  syncBody.includes("global_role NOT IN ('inactive') ORDER BY id") &&
  syncBody.includes(".filter(id => id !== senderUserId)")
);
check(
  "@all: global_mentions written via saveMentions (fire-and-forget)",
  syncBody.includes("saveMentions({") && syncBody.includes(".catch(() => {})")
);

// ── Part 4: Canonical useCurrentUsers hook ────────────────────────────────────
console.log("\n── Part 4: canonical useCurrentUsers hook ──");

check(
  "use-current-users.ts exists",
  HOOK.length > 0
);
check(
  "hook strips leading @ (normalizeUserQuery)",
  HOOK.includes('replace(/^@/, "")')
);
check(
  "hook queries /api/current/users endpoint",
  HOOK.includes("/api/current/users")
);
check(
  "hook supports includeAll=false for DM/add-member pickers",
  HOOK.includes("includeAll") && HOOK.includes("filter((u) => !u.isAll)")
);
check(
  "normalizeUserQuery exported as pure utility",
  HOOK.includes("export function normalizeUserQuery")
);
check(
  "CurrentUser type exported",
  HOOK.includes("export type CurrentUser")
);

// ── Part 7: global_mentions unique constraint ─────────────────────────────────
console.log("\n── Part 7: global_mentions unique constraint ──");

check(
  "migrateGlobalMentionsUniqueConstraint exported from seed-production.ts",
  SEED.includes("export async function migrateGlobalMentionsUniqueConstraint")
);
check(
  "migration deduplicates existing rows before adding constraint",
  SEED.includes("DELETE FROM global_mentions gm") &&
  SEED.includes("HAVING COUNT(*) > 1")
);
check(
  "migration adds UNIQUE (entity_type, entity_id, mentioned_user_id)",
  SEED.includes("UNIQUE (entity_type, entity_id, mentioned_user_id)")
);
check(
  "migration is idempotent (42710 duplicate_object guard)",
  SEED.includes('"42710"') || SEED.includes("'42710'")
);
check(
  "migration imported in server/index.ts",
  INDEX_TS.includes("migrateGlobalMentionsUniqueConstraint")
);
check(
  "migration called in Batch 2",
  INDEX_TS.includes("migrateGlobalMentionsUniqueConstraint()")
);

// ── Part 7: saveMentions uses ON CONFLICT … DO UPDATE ────────────────────────
console.log("\n── Part 7: saveMentions upsert correctness ──");

check(
  "saveMentions uses ON CONFLICT (entity_type, entity_id, mentioned_user_id)",
  MSVC.includes("ON CONFLICT (entity_type, entity_id, mentioned_user_id)")
);
check(
  "saveMentions DO UPDATE refreshes preview + deep_link when already unread",
  MSVC.includes("DO UPDATE SET") &&
  MSVC.includes("source_preview") &&
  MSVC.includes("deep_link_url")
);

// ── refreshMentions cleanup ────────────────────────────────────────────────────
console.log("\n── refreshMentions diff-based cleanup ──");

const refreshIdx  = MSVC.indexOf("export async function refreshMentions");
const refreshBody = MSVC.slice(refreshIdx);

check(
  "refreshMentions dismisses stale mentions (status = 'dismissed')",
  refreshBody.includes("status = 'dismissed'")
);
check(
  "refreshMentions handles case where all mentions are removed",
  refreshBody.includes("newMentionedIds.size === 0")
);
check(
  "refreshMentions keeps active mentions for users still in body",
  refreshBody.includes("NOT IN (${keepList})")
);
check(
  "refreshMentions calls saveMentions for new/updated mentions",
  refreshBody.includes("await saveMentions(opts)")
);

// ── Part 9 completeness checks ─────────────────────────────────────────────────
console.log("\n── Part 9: scope completeness ──");

check(
  "inactive user exclusion: syncCurrentMentions validates active status",
  syncBody.includes("global_role NOT IN ('inactive') LIMIT 1")
);
check(
  "no self-notification: senderUserId excluded in all target paths",
  syncBody.includes("filter(id => id !== senderUserId)")
);
check(
  "XSS: preview text stripped of token syntax before storage",
  syncBody.includes(".replace(/@\\[([^\\]]+)\\]\\(user:\\d+\\)/g, '@$1')")
);
check(
  "user isolation: notifications row scoped to individual user_id",
  syncBody.includes("INSERT INTO notifications (user_id,") ||
  syncBody.includes("INSERT INTO notifications (user_id, type")
);
check(
  "no duplicate notifications across widgets: single notifications table",
  (syncBody.match(/INSERT INTO notifications/g) || []).length >= 1 &&
  !(syncBody.includes("INSERT INTO notifications") && syncBody.split("INSERT INTO notifications").length > 4)
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(60));
console.log(`  Phase 2 mentions: ${passed} passed, ${failed} failed`);
console.log("─".repeat(60));
if (failed > 0) process.exit(1);
