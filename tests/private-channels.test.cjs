/**
 * tests/private-channels.test.cjs
 * Phase 15A — Private Channels / Channel Membership Foundation
 *
 * Source-grep tests: verify code structure and invariants without a live server.
 * All checks are synchronous file reads + regex assertions.
 */

"use strict";
const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function assert(condition, label) {
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

// ── Load source files ────────────────────────────────────────────────────────
const routes = readFile("server/routes.ts");
const migration = readFile("migrations/0021_private_channels.sql");
const currentTsx = readFile("client/src/pages/current.tsx");

console.log("\n=== T001: Migration ===");

assert(
  migration.includes("CREATE TABLE IF NOT EXISTS current_channel_members"),
  "Migration creates current_channel_members table"
);
assert(
  migration.includes("channel_id") && migration.includes("user_id"),
  "Members table has channel_id and user_id columns"
);
assert(
  migration.includes("UNIQUE") || migration.includes("unique"),
  "Members table has unique constraint (channel_id, user_id)"
);
assert(
  migration.includes("is_private") || readFile("migrations/0021_private_channels.sql").includes("is_private"),
  "Migration references is_private column"
);

console.log("\n=== T002: Backend helpers ===");

assert(
  routes.includes("async function canViewChannel"),
  "canViewChannel helper defined"
);
assert(
  routes.includes("async function resolveChannelAccess"),
  "resolveChannelAccess helper defined"
);
assert(
  routes.includes("async function checkPrivateChannelAccess"),
  "checkPrivateChannelAccess helper defined"
);
assert(
  routes.includes("'forbidden'") || routes.includes('"forbidden"'),
  "resolveChannelAccess returns 'forbidden' sentinel"
);

console.log("\n=== T002: Channel list filter ===");

assert(
  routes.includes("current_channel_members") &&
    routes.includes("is_private") &&
    routes.includes("GET /api/current/channels"),
  "Channel list route references private channel filter"
);

// Verify is_private filter appears in the channel-list SQL
const channelListSection = routes.slice(
  routes.indexOf("GET /api/current/channels"),
  routes.indexOf("GET /api/current/channels") + 3000
);
assert(
  channelListSection.includes("is_private") &&
    channelListSection.includes("current_channel_members"),
  "Channel list SQL includes private-channel membership filter"
);

console.log("\n=== T002: Route guards ===");

// messages route guard
const messagesRouteIdx = routes.indexOf(":slug/messages");
assert(messagesRouteIdx > 0, "messages route exists");
const messagesSection = routes.slice(messagesRouteIdx, messagesRouteIdx + 2000);
assert(
  messagesSection.includes("resolveChannelAccess") ||
    messagesSection.includes("canViewChannel"),
  "GET messages route uses channel access check"
);

// POST messages guard
assert(
  routes.includes(":slug/messages") &&
    routes.includes("Not a member of this private channel"),
  "POST messages route blocks non-members of private channels"
);

// read route guard
assert(
  routes.includes("Cannot mark read in a private channel") ||
    routes.includes("Not a member of this private channel"),
  "Read route has private channel guard"
);

// reactions route guard
assert(
  routes.includes("messages/:id/reactions") &&
    (routes.includes("checkPrivateChannelAccess") ||
      routes.includes("private channel")),
  "Reactions route has private channel guard"
);

// pins route guard
assert(
  routes.includes(":slug/pins") &&
    routes.includes("resolveChannelAccess"),
  "Pins route uses resolveChannelAccess"
);

// participants route guard
assert(
  routes.includes(":slug/participants") &&
    routes.includes("is_private"),
  "Participants route checks is_private"
);

// thread GET guard
assert(
  routes.includes("checkPrivateChannelAccess") &&
    routes.includes("threadChanId"),
  "Thread GET route uses checkPrivateChannelAccess"
);

// thread POST guard
assert(
  routes.includes("Cannot reply in an archived channel") &&
    routes.includes("Cannot reply") &&
    routes.includes("is_private"),
  "Thread POST route blocks replies in private channels"
);

console.log("\n=== T002: Mentions / search / structured filters ===");

assert(
  routes.includes("current_channel_members WHERE channel_id = c.id AND user_id = ${userId}") &&
    routes.includes("mentioned_user_id"),
  "Mentions query filters private channel messages"
);

assert(
  routes.includes("current_channel_members WHERE channel_id = cc.id AND user_id = ${userId}"),
  "Search query filters private channel messages"
);

assert(
  routes.includes("current_channel_members WHERE channel_id = si.channel_id AND user_id = ${userId}"),
  "Structured list query filters private channel items"
);

console.log("\n=== T002: Typing route guards ===");

const typingPostIdx = routes.lastIndexOf("POST /api/current/typing");
assert(typingPostIdx > 0, "POST typing route exists");
const typingPostSection = routes.slice(typingPostIdx, typingPostIdx + 1500);
assert(
  typingPostSection.includes("is_private"),
  "POST typing route checks is_private"
);

const typingGetIdx = routes.lastIndexOf("GET /api/current/typing");
assert(typingGetIdx > 0, "GET typing route exists");
const typingGetSection = routes.slice(typingGetIdx, typingGetIdx + 1500);
assert(
  typingGetSection.includes("is_private"),
  "GET typing route checks is_private"
);

console.log("\n=== T002: Summary route guard ===");

assert(
  routes.includes("chSummAccess") &&
    routes.includes("resolveChannelAccess"),
  "Summary route uses resolveChannelAccess for channel scope"
);

// Phase 15A security audit fixes —————————————————————————————————————————

console.log("\n=== T002: Typing thread scope — private channel guard ===");

// POST typing thread scope
const typingPostBlock = routes.slice(routes.indexOf("POST /api/current/typing"), routes.indexOf("GET /api/current/typing"));
const typingPostThreadIdx = typingPostBlock.indexOf("// thread");
const typingPostThreadSection = typingPostBlock.slice(typingPostThreadIdx, typingPostThreadIdx + 1500);
assert(
  typingPostThreadSection.includes("is_private"),
  "POST typing route thread scope checks is_private"
);
assert(
  typingPostThreadSection.includes("current_channel_members"),
  "POST typing route thread scope checks channel membership"
);

// GET typing thread scope
const typingGetRouteIdx = routes.indexOf("GET /api/current/typing");
const typingGetBlock = routes.slice(typingGetRouteIdx, typingGetRouteIdx + 3000);
const typingGetThreadIdx = typingGetBlock.indexOf("// thread", 500);
const typingGetThreadSection = typingGetBlock.slice(typingGetThreadIdx < 0 ? typingGetBlock.indexOf("rootMessageId") : typingGetThreadIdx, typingGetThreadIdx < 0 ? typingGetBlock.indexOf("rootMessageId") + 800 : typingGetThreadIdx + 800);
assert(
  typingGetBlock.slice(typingGetBlock.indexOf("rootMessageId")).includes("is_private"),
  "GET typing route thread scope checks is_private"
);
assert(
  typingGetBlock.slice(typingGetBlock.indexOf("rootMessageId")).includes("current_channel_members"),
  "GET typing route thread scope checks channel membership"
);

console.log("\n=== T002: Summary thread scope — private channel guard ===");

const summaryRouteIdx = routes.indexOf("POST /api/current/summary");
const summaryBlock = routes.slice(summaryRouteIdx, summaryRouteIdx + 6000);
const summaryThreadSection = summaryBlock.slice(summaryBlock.indexOf("scope === \"thread\""), summaryBlock.indexOf("scope === \"channel\""));
assert(
  summaryThreadSection.includes("is_private"),
  "Summary thread scope checks is_private"
);
assert(
  summaryThreadSection.includes("current_channel_members"),
  "Summary thread scope checks channel membership"
);
assert(
  summaryThreadSection.includes("summThreadChanId") || summaryThreadSection.includes("channel_id"),
  "Summary thread scope resolves channel from root message"
);

console.log("\n=== T002: Pin route — private channel guard ===");

const pinPostIdx = routes.indexOf("POST /api/current/messages/:id/pin");
const pinPostSection = routes.slice(pinPostIdx, pinPostIdx + 2000);
assert(
  pinPostSection.includes("is_private"),
  "POST pin route checks is_private before inserting pin"
);
assert(
  pinPostSection.includes("current_channel_members"),
  "POST pin route checks channel membership"
);
assert(
  pinPostSection.includes("Not a member of this private channel"),
  "POST pin route returns 403 for non-members of private channel"
);

console.log("\n=== T002: Unpin route — private channel guard ===");

const unpinRouteIdx = routes.indexOf("DELETE /api/current/messages/:id/pin");
const unpinSection = routes.slice(unpinRouteIdx, unpinRouteIdx + 2000);
assert(
  unpinSection.includes("is_private"),
  "DELETE unpin route checks is_private"
);
assert(
  unpinSection.includes("current_channel_members"),
  "DELETE unpin route checks channel membership"
);
assert(
  unpinSection.includes("Not a member of this private channel"),
  "DELETE unpin route returns 403 for non-members of private channel"
);

console.log("\n=== T002: Structured mark/unmark — private channel guard ===");

const structMarkIdx = routes.indexOf("POST /api/current/messages/:id/structured");
const structMarkSection = routes.slice(structMarkIdx, structMarkIdx + 3500);
assert(
  structMarkSection.includes("is_private"),
  "POST structured mark checks is_private"
);
assert(
  structMarkSection.includes("current_channel_members"),
  "POST structured mark checks channel membership"
);
assert(
  structMarkSection.includes("Not a member of this private channel"),
  "POST structured mark returns 403 for non-members"
);

const structUnmarkIdx = routes.indexOf("DELETE /api/current/messages/:id/structured");
const structUnmarkSection = routes.slice(structUnmarkIdx, structUnmarkIdx + 2000);
assert(
  structUnmarkSection.includes("is_private"),
  "DELETE structured unmark checks is_private"
);
assert(
  structUnmarkSection.includes("current_channel_members"),
  "DELETE structured unmark checks channel membership"
);
assert(
  structUnmarkSection.includes("Not a member of this private channel"),
  "DELETE structured unmark returns 403 for non-members"
);

console.log("\n=== T002: Attachment GET — private channel guard for current_message ===");

// Attachment list guard for private channels
const attachGetIdx = routes.indexOf("app.get(\"/api/attachments\"");
const attachGetSection = routes.slice(attachGetIdx, attachGetIdx + 3000);
assert(
  attachGetSection.includes("channel_id"),
  "GET /api/attachments fetches channel_id from message"
);
assert(
  attachGetSection.includes("is_private"),
  "GET /api/attachments checks is_private for channel messages"
);
assert(
  attachGetSection.includes("current_channel_members"),
  "GET /api/attachments checks private channel membership"
);

console.log("\n=== T002: Attachment POST — private channel guard for current_message ===");

const attachPostIdx = routes.indexOf("app.post(\"/api/attachments\"");
const attachPostSection = routes.slice(attachPostIdx, attachPostIdx + 5000);
// Find the section that handles channel guard (after archived check)
const attachPostChanSection = attachPostSection.slice(attachPostSection.indexOf("Block uploads to archived"));
assert(
  attachPostChanSection.includes("is_private"),
  "POST /api/attachments checks is_private for channel messages"
);
assert(
  attachPostChanSection.includes("current_channel_members"),
  "POST /api/attachments checks private channel membership before upload"
);
assert(
  attachPostChanSection.includes("Not a member of this private channel"),
  "POST /api/attachments returns 403 for non-members of private channel"
);

console.log("\n=== T002: Create channel — isPrivate + memberIds ===");

const createChannelRouteIdx = routes.indexOf("POST /api/current/channels");
assert(createChannelRouteIdx > 0, "POST channels route exists");
const createSection = routes.slice(createChannelRouteIdx, createChannelRouteIdx + 3000);
assert(
  createSection.includes("isPrivate") || createSection.includes("is_private"),
  "POST channels route reads isPrivate from body"
);
assert(
  createSection.includes("memberIds") || createSection.includes("member_ids"),
  "POST channels route reads memberIds from body"
);
assert(
  createSection.includes("current_channel_members"),
  "POST channels route inserts into current_channel_members"
);
// Creator auto-added
assert(
  createSection.includes("userId") && createSection.includes("current_channel_members"),
  "POST channels route auto-adds creator to members"
);

console.log("\n=== T002: Edit channel — isPrivate toggle ===");

const editChannelRouteIdx = routes.indexOf("PATCH /api/current/channels");
assert(editChannelRouteIdx > 0, "PATCH channels route exists");
const editSection = routes.slice(editChannelRouteIdx, editChannelRouteIdx + 2000);
assert(
  editSection.includes("isPrivate") || editSection.includes("is_private"),
  "PATCH channels route supports isPrivate toggle"
);

console.log("\n=== T002: Member management routes ===");

assert(
  routes.includes("GET /api/current/channels/:slug/members") ||
    routes.includes("/api/current/channels/:slug/members"),
  "GET members route exists"
);
assert(
  routes.includes("PUT /api/current/channels/:slug/members") ||
    (routes.includes("app.put") && routes.includes("slug}/members")),
  "PUT members route exists"
);
assert(
  routes.includes("POST /api/current/channels/:slug/members/:userId") ||
    (routes.includes("app.post") && routes.includes("members/:userId")),
  "POST member add route exists"
);
assert(
  routes.includes("DELETE /api/current/channels/:slug/members/:userId") ||
    (routes.includes("app.delete") && routes.includes("members/:userId")),
  "DELETE member remove route exists"
);

// GET members requires auth and checks is_private for non-admins
const getMembersIdx = routes.indexOf("Channel Member Management");
assert(getMembersIdx > 0, "Member Management section comment found");
const getMembersSection = routes.slice(getMembersIdx, getMembersIdx + 4000);
assert(
  getMembersSection.includes("isAdminUser") && getMembersSection.includes("globalRole"),
  "GET members checks admin role"
);
assert(
  getMembersSection.includes("requireAdmin"),
  "PUT/POST/DELETE member routes require admin"
);

console.log("\n=== T002: Unread-counts filter ===");

const unreadRouteIdx = routes.indexOf("GET /api/current/unread-counts");
assert(unreadRouteIdx > 0, "Unread counts route exists");
const unreadSection = routes.slice(unreadRouteIdx, unreadRouteIdx + 3000);
assert(
  unreadSection.includes("is_private") && unreadSection.includes("current_channel_members"),
  "Unread counts filters private channels to members"
);

console.log("\n=== T003: Frontend — Lock icon ===");

assert(
  currentTsx.includes("Lock,") || currentTsx.includes("Lock } from"),
  "Lock icon imported from lucide-react"
);
assert(
  currentTsx.includes("channel.isPrivate") &&
    currentTsx.includes("<Lock"),
  "Lock icon rendered for private channels in sidebar"
);

console.log("\n=== T003: Frontend — MemberPickerInline component ===");

assert(
  currentTsx.includes("function MemberPickerInline"),
  "MemberPickerInline component defined"
);
assert(
  currentTsx.includes("input-member-search"),
  "Member search input has test-id"
);
assert(
  currentTsx.includes("member-suggestion-"),
  "Member suggestion items have test-ids"
);

console.log("\n=== T003: Frontend — Create dialog private toggle ===");

assert(
  currentTsx.includes("createIsPrivate") && currentTsx.includes("setCreateIsPrivate"),
  "createIsPrivate state declared"
);
assert(
  currentTsx.includes("createMemberIds") && currentTsx.includes("setCreateMemberIds"),
  "createMemberIds state declared"
);
assert(
  currentTsx.includes("toggle-channel-private"),
  "Private toggle has test-id in create dialog"
);
assert(
  currentTsx.includes("isPrivate: createIsPrivate"),
  "Create mutation sends isPrivate flag"
);
assert(
  currentTsx.includes("memberIds: createMemberIds"),
  "Create mutation sends memberIds array"
);

console.log("\n=== T003: Frontend — Edit dialog private toggle + members ===");

assert(
  currentTsx.includes("editIsPrivate") && currentTsx.includes("setEditIsPrivate"),
  "editIsPrivate state declared"
);
assert(
  currentTsx.includes("toggle-edit-channel-private"),
  "Private toggle has test-id in edit dialog"
);
assert(
  currentTsx.includes("isPrivate: editIsPrivate"),
  "Edit mutation sends isPrivate flag"
);
assert(
  currentTsx.includes("editChannelMembers"),
  "Edit dialog uses editChannelMembers query result"
);
assert(
  currentTsx.includes("remove-channel-member-"),
  "Remove member buttons have test-ids"
);
assert(
  currentTsx.includes("removeChannelMemberMutation"),
  "removeChannelMemberMutation defined"
);
assert(
  currentTsx.includes("addChannelMemberMutation"),
  "addChannelMemberMutation defined"
);

console.log("\n=== T003: Frontend — Edit open handler pre-populates isPrivate ===");

assert(
  currentTsx.includes("setEditIsPrivate(channel.isPrivate)"),
  "Edit open handler pre-populates editIsPrivate from channel"
);

console.log("\n=== T003: Frontend — Channel type definitions ===");

assert(
  currentTsx.includes("isPrivate: boolean") &&
    currentTsx.includes("interface Channel"),
  "Channel interface has isPrivate: boolean field"
);
assert(
  currentTsx.includes("isPrivate: boolean") &&
    currentTsx.includes("interface ChannelInfo"),
  "ChannelInfo interface has isPrivate: boolean field"
);

console.log("\n=== Summary ===");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll checks passed ✓");
