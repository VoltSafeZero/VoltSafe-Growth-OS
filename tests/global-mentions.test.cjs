/**
 * global-mentions.test.cjs — Source-grep regression tests for the CMS-wide @mention system.
 *
 * These tests verify structural invariants of the @mention system without
 * making live HTTP requests — suitable for CI and source-grep workflows.
 */

"use strict";

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function ok(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

function readFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function grep(content, pattern) {
  if (pattern instanceof RegExp) return pattern.test(content);
  return content.includes(pattern);
}

console.log("\n=== Global @Mention System — Source-Grep Tests ===\n");

// ── 1. Migration ──────────────────────────────────────────────────────────────
console.log("── 1. Migration (0033_global_mentions.sql) ──");
const migration = readFile("migrations/0033_global_mentions.sql");
ok("global_mentions table exists", grep(migration, "CREATE TABLE IF NOT EXISTS global_mentions"));
ok("mentioned_user_id column", grep(migration, "mentioned_user_id"));
ok("author_user_id column", grep(migration, "author_user_id"));
ok("entity_type column", grep(migration, "entity_type"));
ok("entity_id column", grep(migration, "entity_id"));
ok("module_key column", grep(migration, "module_key"));
ok("status column with CHECK constraint", grep(migration, "CHECK (status IN ('unread'"));
ok("deep_link_url column", grep(migration, "deep_link_url"));
ok("is_all_mention column", grep(migration, "is_all_mention"));
ok("index on mentioned_user_id", grep(migration, "idx_global_mentions_user"));
ok("index on entity_type/entity_id", grep(migration, "idx_global_mentions_entity"));
ok("unread partial index", grep(migration, "idx_global_mentions_unread"));

// ── 2. Mention service ────────────────────────────────────────────────────────
console.log("\n── 2. Mention Service (server/services/mention-service.ts) ──");
const service = readFile("server/services/mention-service.ts");
ok("parseMentionTokens exported", grep(service, "export function parseMentionTokens"));
ok("saveMentions exported", grep(service, "export async function saveMentions"));
ok("@all token parsed (user:0)", grep(service, "userId === 0 || name === \"all\""));
ok("@all expands to all active users", grep(service, "getAllActiveUserIds"));
ok("author excluded from own mentions", grep(service, "mentionedUserIds.delete(opts.authorId)"));
ok("INSERT INTO global_mentions", grep(service, "INSERT INTO global_mentions"));
ok("ON CONFLICT DO NOTHING", grep(service, "ON CONFLICT DO NOTHING"));
ok("errors caught not thrown", grep(service, "console.error"));
ok("is_all_mention column set", grep(service, "is_all_mention"));
ok("status defaults to 'unread'", grep(service, "'unread'"));
ok("60s cache for all-user list", grep(service, "60_000"));

// ── 3. Backend routes ─────────────────────────────────────────────────────────
console.log("\n── 3. Backend Routes (server/routes.ts) ──");
const routes = readFile("server/routes.ts");
ok("mention-service imported in routes.ts", grep(routes, "import { saveMentions } from \"./services/mention-service\""));
ok("GET /api/mentions/unread-count", grep(routes, "/api/mentions/unread-count"));
ok("GET /api/mentions", grep(routes, "app.get(\"/api/mentions\""));
ok("PATCH /api/mentions/:id", grep(routes, "app.patch(\"/api/mentions/:id\""));
ok("status filter (open/all)", grep(routes, "statusFilter === \"open\""));
ok("module filter applied", grep(routes, "moduleFilter !== \"all\""));
ok("sort options: newest/oldest/unread/module", grep(routes, "case \"oldest\""));
ok("auto-mark viewed on fetch", grep(routes, "Auto-mark unread as viewed"));
ok("VALID_STATUSES set", grep(routes, "VALID_STATUSES"));
ok("completionNote persisted", grep(routes, "completion_note"));
ok("mentioned_user_id ACL on PATCH", grep(routes, "mentioned_user_id = ${userId}"));
ok("saveMentions called in syncCurrentMentions", grep(routes, "also write to global_mentions for the CMS-wide"));
ok("@all support in /api/current/users", grep(routes, "/api/current/users"));

// ── 4. routes-tasks.ts wiring ─────────────────────────────────────────────────
console.log("\n── 4. Task Comments Wiring (server/routes-tasks.ts) ──");
const routesTasks = readFile("server/routes-tasks.ts");
ok("mention-service imported", grep(routesTasks, "import { saveMentions } from \"./services/mention-service\""));
ok("saveMentions called after comment insert", grep(routesTasks, "saveMentions({"));
ok("entityType: 'task_comment'", grep(routesTasks, "entityType: \"task_comment\""));
ok("moduleKey: 'tasks'", grep(routesTasks, "moduleKey: \"tasks\""));
ok("fire-and-forget with .catch", grep(routesTasks, ".catch(() => {})"));
ok("deepLinkUrl points to tasks page", grep(routesTasks, "deepLinkUrl: `/execution/tasks"));

// ── 5. Shared useMentionComposer hook ─────────────────────────────────────────
console.log("\n── 5. useMentionComposer Hook (client/src/hooks/use-mention-composer.ts) ──");
const hook = readFile("client/src/hooks/use-mention-composer.ts");
ok("useMentionComposer exported", grep(hook, "export function useMentionComposer"));
ok("serializeForSave exported (converts clean text → token format)", grep(hook, "serializeForSave"));
ok("parseMentionTokens available on client", grep(hook, "extractMentionedIds"));
ok("@all virtual user (id:0)", grep(hook, "id: 0, name: \"all\", isAll: true"));
ok("@ trigger detection", grep(hook, "detectMentionTrigger"));
ok("@[Name](user:ID) token format produced by serializer", grep(hook, "entry.userId"));
ok("Keyboard navigation: ArrowDown/ArrowUp/Enter/Escape", grep(hook, "ArrowDown"));
ok("handles Tab key to insert", grep(hook, "\"Tab\""));
ok("/api/current/users query", grep(hook, "/api/current/users"));
ok("@all matches 'everyone' and 'team'", grep(hook, "\"everyone\""));

// ── 6. MentionInput shared component ──────────────────────────────────────────
console.log("\n── 6. MentionInput Component (client/src/components/shared/mention-input.tsx) ──");
const mentionInput = readFile("client/src/components/shared/mention-input.tsx");
ok("MentionInput exported", grep(mentionInput, "export const MentionInput") || grep(mentionInput, "export function MentionInput"));
ok("renderMentionBody exported", grep(mentionInput, "export function renderMentionBody"));
ok("MentionDropdown portal via createPortal", grep(mentionInput, "createPortal"));
ok("@all rendered with amber color", grep(mentionInput, "amber"));
ok("highlighted mention for current user", grep(mentionInput, "isMe"));
ok("onSubmit handled on Enter (no Shift)", grep(mentionInput, "!e.shiftKey && onSubmit"));
ok("useMentionComposer hook used", grep(mentionInput, "useMentionComposer"));
ok("data-testid prop forwarded", grep(mentionInput, "data-testid"));
ok("Textarea wrapped (not a div)", grep(mentionInput, "Textarea"));
ok("dropdown positioned above textarea", grep(mentionInput, "bottom"));

// ── 7. MyMentionsFeed component ────────────────────────────────────────────────
console.log("\n── 7. MyMentionsFeed (client/src/components/mentions/my-mentions-feed.tsx) ──");
const feed = readFile("client/src/components/mentions/my-mentions-feed.tsx");
ok("MyMentionsFeed exported", grep(feed, "export function MyMentionsFeed"));
ok("useMentionsUnreadCount exported", grep(feed, "export function useMentionsUnreadCount"));
ok("queries /api/mentions", grep(feed, "/api/mentions\""));
ok("queries /api/mentions/unread-count", grep(feed, "/api/mentions/unread-count"));
ok("status filter select", grep(feed, "mentions-filter-status"));
ok("module filter select", grep(feed, "mentions-filter-module"));
ok("sort select", grep(feed, "mentions-sort"));
ok("Acknowledge action", grep(feed, "mention-ack-"));
ok("Complete action", grep(feed, "mention-complete-"));
ok("Dismiss action", grep(feed, "mention-dismiss-"));
ok("@all badge", grep(feed, "@all"));
ok("deep link navigation", grep(feed, "deepLinkUrl"));
ok("empty state with instructions", grep(feed, "mentions-empty-state"));
ok("module icons mapping", grep(feed, "MODULE_ICONS"));
ok("status styles with icons", grep(feed, "STATUS_STYLE"));
ok("fmtAgo helper", grep(feed, "fmtAgo"));
ok("maxItems prop for Today tab embedded view", grep(feed, "maxItems"));
ok("showFilters prop", grep(feed, "showFilters"));
ok("PATCH mutation on status change", grep(feed, "/api/mentions/${id}"));
ok("unread-count invalidated on status change", grep(feed, "api/mentions/unread-count"));

// ── 8. Today tab integration ──────────────────────────────────────────────────
console.log("\n── 8. Today Tab Integration (client/src/pages/today.tsx) ──");
const today = readFile("client/src/pages/today.tsx");
ok("MyMentionsFeed imported", grep(today, "import { MyMentionsFeed }"));
ok("mentions section in SECTION_CONFIG", grep(today, "{ id: \"mentions\""));
ok("My Mentions label", grep(today, "My Mentions"));
ok("mentions case in renderSection", grep(today, "case \"mentions\":"));
ok("AtSign icon used for mentions", grep(today, "AtSign"));
ok("section-mentions testId", grep(today, "section-mentions"));
ok("maxItems=5 in Today tab", grep(today, "maxItems={5}"));
ok("showFilters=false in Today tab", grep(today, "showFilters={false}"));
ok("link to /mentions full page", grep(today, "link=\"/mentions\""));

// ── 9. Task Detail Drawer integration ────────────────────────────────────────
console.log("\n── 9. Task Detail Drawer (client/src/components/tasks/task-detail-drawer.tsx) ──");
const drawer = readFile("client/src/components/tasks/task-detail-drawer.tsx");
ok("MentionInput imported", grep(drawer, "MentionInput") && grep(drawer, "renderMentionBody"));
ok("MentionInput used in CommentsBlock", grep(drawer, "<MentionInput"));
ok("renderMentionBody used for comment display", grep(drawer, "renderMentionBody(c.body)"));
ok("Enter shortcut via onSubmit", grep(drawer, "onSubmit={async"));
ok("@mention placeholder text", grep(drawer, "type @ to mention someone"));

// ── 10. App routing ───────────────────────────────────────────────────────────
console.log("\n── 10. App Routing (client/src/App.tsx) ──");
const app = readFile("client/src/App.tsx");
ok("MentionsPage lazy imported", grep(app, "const MentionsPage = lazy"));
ok("/mentions route registered", grep(app, "path=\"/mentions\""));

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n───────────────────────────────────────────────────────`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`───────────────────────────────────────────────────────\n`);
if (failed > 0) process.exit(1);
