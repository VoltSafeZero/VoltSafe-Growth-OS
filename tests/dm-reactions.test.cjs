/**
 * Phase 13A — DM / Group DM Message Reactions Parity
 *
 * Checks:
 *  [Backend — 1:1 DM]
 *  - React to a 1:1 DM message → 200, added: true
 *  - Reaction appears in DM fetch with count=1 and reacted=true
 *  - Toggle same reaction → 200, added: false (idempotent remove)
 *  - Reaction gone from DM fetch after toggle off
 *  - reacted=false when a different user reacted (not current user)
 *  [Backend — Group DM]
 *  - React to a group DM message → 200, added: true
 *  - Group DM fetch returns reaction with count and reacted
 *  - Toggle off group DM reaction → 200, added: false
 *  [Backend — security]
 *  - Non-member cannot react to 1:1 DM message → 403
 *  - Non-member cannot react to group DM message → 403 (if applicable)
 *  - Unauthenticated request → 401
 *  - Invalid emoji rejected → 400
 *  - Non-existent message → 404
 *  - Deleted DM message cannot be reacted to → 404
 *  [Backend — route structure (source-grep)]
 *  - Reaction route gated by requireAuth
 *  - DM fetch returns reactions array with per-user reacted flag
 *  - Membership check uses current_conversation_members
 *  - Deleted message check uses deleted_at IS NULL
 *  - Emoji allowlist prevents injection
 *  [Frontend — source-grep]
 *  - DM MessageRow uses onToggleReaction (not onReact)
 *  - DM MessageRow uses grouped prop (not isConsecutive)
 *  - DM MessageRow sets isAdmin={false} and isArchived={false}
 *  - dmReactMutation invalidates DM messages query key
 *  - ReactionStrip uses onToggle={onToggleReaction} in MessageRow
 *  - MessageActionBar bridges onReact → onToggleReaction
 *  - ReactionStrip renders reacted styling
 *  [Regression]
 *  - Archived channel reaction still blocked
 *  - Phase 12C/12B/12A/11B/11A routes intact
 */

"use strict";

const fs = require("fs");
const assert = require("assert/strict");

const BASE = "http://localhost:5000";
const ORIGIN = "http://localhost:5000";

let passed = 0;
let failed = 0;

async function test(label, fn) {
  try {
    await fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

async function login(email, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });
  if (!r.ok && r.status !== 302) throw new Error(`Login failed for ${email}: ${r.status}`);
  const raw = r.headers.get("set-cookie") || "";
  const match = raw.match(/connect\.sid=([^;]+)/);
  if (!match) throw new Error(`No session cookie for ${email}`);
  return match[0];
}

async function api(method, path, body, cookie) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie || "", Origin: ORIGIN },
    redirect: "manual",
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  let data;
  try { data = await r.json(); } catch { data = null; }
  return { status: r.status, data };
}

async function main() {
  console.log("\n── DM / Group DM Message Reactions (Phase 13A) ──────────────────────────\n");

  const src = fs.readFileSync("client/src/pages/current.tsx", "utf8");
  const routes = fs.readFileSync("server/routes.ts", "utf8");

  // ── State ──────────────────────────────────────────────────────────────────
  let cookieTrevor = "";
  let cookieViewer = "";
  let dmConvId = 0;         // 1:1 DM between trevor + viewer (conv_id=4)
  let groupConvId = 0;      // group DM trevor is a member of (conv_id=3)
  let nonMemberConvId = 0;  // 1:1 DM trevor+lowperm — viewer NOT in it (conv_id=5)
  let dmMsgId = 0;
  let groupMsgId = 0;
  let nonMemberMsgId = 0;
  let deletedMsgId = 0;

  // ── Login ──────────────────────────────────────────────────────────────────
  await test("login trevor (primary test user)", async () => {
    cookieTrevor = await login("trevor@voltsafe.com", "alberni1444");
    assert.ok(cookieTrevor, "should have session cookie");
  });

  await test("login viewer (second user — member of 1:1 DM, not of non-member conv)", async () => {
    cookieViewer = await login("viewer@voltsafe.com", "testpass1234");
    assert.ok(cookieViewer, "should have session cookie");
  });

  // ── Setup ──────────────────────────────────────────────────────────────────
  console.log("\n  [setup]");

  await test("setup: get or create 1:1 DM with viewer (id=6)", async () => {
    const r = await api("POST", "/api/current/dms", { userId: 6 }, cookieTrevor);
    assert.ok(r.status === 200 || r.status === 201, `expected 200/201, got ${r.status}: ${JSON.stringify(r.data)}`);
    dmConvId = r.data.conversationId;
    assert.ok(dmConvId > 0, "should have conversationId");
  });

  await test("setup: create test message in 1:1 DM", async () => {
    const r = await api("POST", `/api/current/dms/${dmConvId}/messages`, { body: "reaction test 13a" }, cookieTrevor);
    assert.equal(r.status, 201, `expected 201, got ${r.status}: ${JSON.stringify(r.data)}`);
    dmMsgId = r.data.id;
    assert.ok(dmMsgId > 0, "should have message id");
  });

  await test("setup: create message to be deleted", async () => {
    const r = await api("POST", `/api/current/dms/${dmConvId}/messages`, { body: "will be deleted 13a" }, cookieTrevor);
    assert.equal(r.status, 201, `expected 201, got ${r.status}: ${JSON.stringify(r.data)}`);
    deletedMsgId = r.data.id;
    assert.ok(deletedMsgId > 0, "should have message id");
  });

  await test("setup: delete the to-be-deleted message", async () => {
    const r = await api("DELETE", `/api/current/messages/${deletedMsgId}`, undefined, cookieTrevor);
    assert.ok(r.status === 200 || r.status === 204, `expected 200/204, got ${r.status}`);
  });

  await test("setup: get or create non-member DM (trevor + lowperm id=8, viewer excluded)", async () => {
    const r = await api("POST", "/api/current/dms", { userId: 8 }, cookieTrevor);
    assert.ok(r.status === 200 || r.status === 201, `expected 200/201, got ${r.status}: ${JSON.stringify(r.data)}`);
    nonMemberConvId = r.data.conversationId;
    assert.ok(nonMemberConvId > 0, "should have conversationId");
  });

  await test("setup: create message in non-member DM", async () => {
    const r = await api("POST", `/api/current/dms/${nonMemberConvId}/messages`, { body: "non-member test 13a" }, cookieTrevor);
    assert.equal(r.status, 201, `expected 201, got ${r.status}: ${JSON.stringify(r.data)}`);
    nonMemberMsgId = r.data.id;
    assert.ok(nonMemberMsgId > 0, "should have message id");
  });

  await test("setup: confirm viewer NOT in non-member DM → 403", async () => {
    const r = await api("GET", `/api/current/dms/${nonMemberConvId}/messages`, undefined, cookieViewer);
    assert.equal(r.status, 403, `viewer should not be in trevor-lowperm DM, got ${r.status}`);
  });

  await test("setup: find group DM trevor is a member of", async () => {
    const r = await api("GET", "/api/current/dms", undefined, cookieTrevor);
    assert.equal(r.status, 200);
    const groupDms = (r.data || []).filter((c) => c.type === "group_dm");
    assert.ok(groupDms.length > 0, "trevor must have at least one group DM");
    groupConvId = groupDms[0].conversationId;
    assert.ok(groupConvId > 0, "should have group conv id");
  });

  await test("setup: create test message in group DM", async () => {
    const r = await api("POST", `/api/current/dms/${groupConvId}/messages`, { body: "group react test 13a" }, cookieTrevor);
    assert.equal(r.status, 201, `expected 201, got ${r.status}: ${JSON.stringify(r.data)}`);
    groupMsgId = r.data.id;
    assert.ok(groupMsgId > 0, "should have message id");
  });

  // ── Backend: 1:1 DM reactions ──────────────────────────────────────────────
  console.log("\n  [backend: 1:1 DM reactions]");

  await test("1:1 DM: react with 👍 → 200, added: true", async () => {
    const r = await api("POST", `/api/current/messages/${dmMsgId}/reactions`, { emoji: "👍" }, cookieTrevor);
    assert.equal(r.status, 200, `got ${r.status}: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.ok, true);
    assert.equal(r.data.added, true);
  });

  await test("1:1 DM: reaction in fetch — count=1, reacted=true", async () => {
    const r = await api("GET", `/api/current/dms/${dmConvId}/messages`, undefined, cookieTrevor);
    assert.equal(r.status, 200);
    const msg = (r.data || []).find((m) => m.id === dmMsgId);
    assert.ok(msg, "test message must be in response");
    const rxn = (msg.reactions || []).find((rx) => rx.emoji === "👍");
    assert.ok(rxn, "👍 reaction must be present");
    assert.equal(rxn.count, 1, "count must be 1");
    assert.equal(rxn.reacted, true, "reacted must be true");
  });

  await test("1:1 DM: toggle 👍 again → 200, added: false (removed)", async () => {
    const r = await api("POST", `/api/current/messages/${dmMsgId}/reactions`, { emoji: "👍" }, cookieTrevor);
    assert.equal(r.status, 200, `got ${r.status}: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.added, false, "second call must toggle reaction off");
  });

  await test("1:1 DM: reaction gone from fetch after toggle off", async () => {
    const r = await api("GET", `/api/current/dms/${dmConvId}/messages`, undefined, cookieTrevor);
    assert.equal(r.status, 200);
    const msg = (r.data || []).find((m) => m.id === dmMsgId);
    assert.ok(msg, "test message must still be in response");
    const rxn = (msg.reactions || []).find((rx) => rx.emoji === "👍");
    assert.ok(!rxn, "👍 reaction must be gone after toggle off");
  });

  await test("1:1 DM: viewer (member) CAN react to message → 200", async () => {
    const r = await api("POST", `/api/current/messages/${dmMsgId}/reactions`, { emoji: "🎉" }, cookieViewer);
    assert.equal(r.status, 200, `DM member must be able to react, got ${r.status}`);
    assert.equal(r.data.added, true);
  });

  await test("1:1 DM: reacted=false for trevor when only viewer reacted", async () => {
    const r = await api("GET", `/api/current/dms/${dmConvId}/messages`, undefined, cookieTrevor);
    assert.equal(r.status, 200);
    const msg = (r.data || []).find((m) => m.id === dmMsgId);
    assert.ok(msg, "test message must be in response");
    const rxn = (msg.reactions || []).find((rx) => rx.emoji === "🎉");
    assert.ok(rxn, "trevor must see viewer's 🎉 reaction");
    assert.equal(rxn.count, 1);
    assert.equal(rxn.reacted, false, "trevor did not react with 🎉 — reacted must be false");
  });

  await test("1:1 DM: trevor also reacts 🎉 → count becomes 2, reacted=true for trevor", async () => {
    await api("POST", `/api/current/messages/${dmMsgId}/reactions`, { emoji: "🎉" }, cookieTrevor);
    const r = await api("GET", `/api/current/dms/${dmConvId}/messages`, undefined, cookieTrevor);
    const msg = (r.data || []).find((m) => m.id === dmMsgId);
    const rxn = (msg.reactions || []).find((rx) => rx.emoji === "🎉");
    assert.ok(rxn, "🎉 reaction must be present");
    assert.equal(rxn.count, 2, "both users reacted — count must be 2");
    assert.equal(rxn.reacted, true, "trevor reacted — reacted must be true");
    // clean up both
    await api("POST", `/api/current/messages/${dmMsgId}/reactions`, { emoji: "🎉" }, cookieTrevor);
    await api("POST", `/api/current/messages/${dmMsgId}/reactions`, { emoji: "🎉" }, cookieViewer);
  });

  // ── Backend: Group DM reactions ────────────────────────────────────────────
  console.log("\n  [backend: group DM reactions]");

  await test("group DM: react with 🔥 → 200, added: true", async () => {
    const r = await api("POST", `/api/current/messages/${groupMsgId}/reactions`, { emoji: "🔥" }, cookieTrevor);
    assert.equal(r.status, 200, `got ${r.status}: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.ok, true);
    assert.equal(r.data.added, true);
  });

  await test("group DM: reaction in fetch — count=1, reacted=true", async () => {
    const r = await api("GET", `/api/current/dms/${groupConvId}/messages`, undefined, cookieTrevor);
    assert.equal(r.status, 200);
    const msg = (r.data || []).find((m) => m.id === groupMsgId);
    assert.ok(msg, "group test message must be in response");
    const rxn = (msg.reactions || []).find((rx) => rx.emoji === "🔥");
    assert.ok(rxn, "🔥 reaction must be present");
    assert.equal(rxn.count, 1);
    assert.equal(rxn.reacted, true);
  });

  await test("group DM: toggle 🔥 → 200, added: false", async () => {
    const r = await api("POST", `/api/current/messages/${groupMsgId}/reactions`, { emoji: "🔥" }, cookieTrevor);
    assert.equal(r.status, 200);
    assert.equal(r.data.added, false);
  });

  await test("group DM: messages include reactions array (shape check)", async () => {
    const r = await api("GET", `/api/current/dms/${groupConvId}/messages`, undefined, cookieTrevor);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.data) && r.data.length > 0, "must return messages array");
    const msg = r.data[0];
    assert.ok(Array.isArray(msg.reactions), "each message must have reactions array");
  });

  // ── Backend: security ──────────────────────────────────────────────────────
  console.log("\n  [backend: security]");

  await test("security: non-member (viewer) cannot react to non-member DM message → 403", async () => {
    const r = await api("POST", `/api/current/messages/${nonMemberMsgId}/reactions`, { emoji: "👍" }, cookieViewer);
    assert.equal(r.status, 403, `non-member must get 403, got ${r.status}: ${JSON.stringify(r.data)}`);
    assert.ok((r.data?.message || "").toLowerCase().includes("member") ||
              (r.data?.message || "").toLowerCase().includes("not"),
              "error message must indicate membership issue");
  });

  await test("security: unauthenticated request → 401", async () => {
    const r = await api("POST", `/api/current/messages/${dmMsgId}/reactions`, { emoji: "👍" }, "");
    assert.equal(r.status, 401, `unauthenticated must get 401, got ${r.status}`);
  });

  await test("security: invalid emoji rejected → 400", async () => {
    const r = await api("POST", `/api/current/messages/${dmMsgId}/reactions`, { emoji: "custom_bad" }, cookieTrevor);
    assert.equal(r.status, 400, `invalid emoji must get 400, got ${r.status}`);
  });

  await test("security: empty emoji rejected → 400", async () => {
    const r = await api("POST", `/api/current/messages/${dmMsgId}/reactions`, { emoji: "" }, cookieTrevor);
    assert.equal(r.status, 400, `empty emoji must get 400, got ${r.status}`);
  });

  await test("security: non-existent message → 404", async () => {
    const r = await api("POST", "/api/current/messages/999999999/reactions", { emoji: "👍" }, cookieTrevor);
    assert.equal(r.status, 404, `non-existent message must get 404, got ${r.status}`);
  });

  await test("security: deleted DM message cannot be reacted to → 404", async () => {
    const r = await api("POST", `/api/current/messages/${deletedMsgId}/reactions`, { emoji: "👍" }, cookieTrevor);
    assert.equal(r.status, 404, `deleted message must get 404, got ${r.status}: ${JSON.stringify(r.data)}`);
  });

  // ── Backend: response shape ────────────────────────────────────────────────
  console.log("\n  [backend: DM message response shape]");

  await test("DM messages response includes reactions array on every message", async () => {
    const r = await api("GET", `/api/current/dms/${dmConvId}/messages`, undefined, cookieTrevor);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.data) && r.data.length > 0, "must return messages");
    for (const msg of r.data.slice(0, 3)) {
      assert.ok(Array.isArray(msg.reactions), `message ${msg.id} must have reactions array`);
    }
  });

  await test("DM reaction shape has emoji, count (number), reacted (boolean)", async () => {
    // Add a reaction to inspect shape
    await api("POST", `/api/current/messages/${dmMsgId}/reactions`, { emoji: "🚀" }, cookieTrevor);
    const r = await api("GET", `/api/current/dms/${dmConvId}/messages`, undefined, cookieTrevor);
    const msg = (r.data || []).find((m) => m.id === dmMsgId);
    const rxn = (msg.reactions || []).find((rx) => rx.emoji === "🚀");
    assert.ok(rxn, "must find 🚀 reaction");
    assert.ok("emoji" in rxn && "count" in rxn && "reacted" in rxn, "must have emoji/count/reacted fields");
    assert.equal(typeof rxn.count, "number");
    assert.equal(typeof rxn.reacted, "boolean");
    // clean up
    await api("POST", `/api/current/messages/${dmMsgId}/reactions`, { emoji: "🚀" }, cookieTrevor);
  });

  // ── Source-grep: backend ───────────────────────────────────────────────────
  console.log("\n  [source-grep: backend route structure]");

  await test("routes: POST /api/current/messages/:id/reactions registered", async () => {
    assert.ok(routes.includes('app.post("/api/current/messages/:id/reactions"'), "reaction route must exist");
  });

  await test("routes: reaction route gated by requireAuth", async () => {
    const idx = routes.indexOf('app.post("/api/current/messages/:id/reactions"');
    const block = routes.slice(idx, idx + 100);
    assert.ok(block.includes("requireAuth"), "reaction route must require auth");
  });

  await test("routes: reaction route checks conversation_id membership (DM guard)", async () => {
    const idx = routes.indexOf('app.post("/api/current/messages/:id/reactions"');
    const block = routes.slice(idx, idx + 1500);
    assert.ok(block.includes("current_conversation_members"), "must check DM membership");
  });

  await test("routes: reaction route checks deleted_at IS NULL", async () => {
    const idx = routes.indexOf('app.post("/api/current/messages/:id/reactions"');
    const block = routes.slice(idx, idx + 1000);
    assert.ok(block.includes("deleted_at IS NULL"), "must exclude deleted messages");
  });

  await test("routes: reaction route blocks archived channel reactions", async () => {
    assert.ok(routes.includes("Cannot react to messages in an archived channel"), "archived channel reaction block must exist");
  });

  await test("routes: emoji allowlist prevents injection", async () => {
    const idx = routes.indexOf('app.post("/api/current/messages/:id/reactions"');
    const block = routes.slice(idx, idx + 600);
    assert.ok(block.includes("ALLOWED"), "emoji must be validated against allowlist");
  });

  await test("routes: DM fetch LATERAL join returns reactions with reacted flag", async () => {
    const idx = routes.indexOf("// GET /api/current/dms/:id/messages");
    const block = routes.slice(idx, idx + 2000);
    assert.ok(block.includes("current_reactions"), "DM fetch must join current_reactions");
    assert.ok(block.includes("reacted"), "DM fetch must include per-user reacted flag");
  });

  await test("routes: DM fetch mapper includes reactions: r.reactions", async () => {
    const idx = routes.indexOf("// GET /api/current/dms/:id/messages");
    const block = routes.slice(idx, idx + 3500);
    assert.ok(block.includes("reactions: r.reactions"), "mapper must include reactions field");
  });

  // ── Source-grep: frontend ──────────────────────────────────────────────────
  console.log("\n  [source-grep: frontend DM MessageRow]");

  // Window must be >1343 chars (measured distance from dmMessages.map( to onToggleReaction)
  const DM_MAP_WINDOW = 2000;

  await test("src: DM MessageRow uses onToggleReaction (not onReact)", async () => {
    const dmMsgIdx = src.indexOf("dmMessages.map(");
    assert.ok(dmMsgIdx > 0, "dmMessages.map must exist");
    const block = src.slice(dmMsgIdx, dmMsgIdx + DM_MAP_WINDOW);
    assert.ok(block.includes("onToggleReaction"), "DM MessageRow must use onToggleReaction prop");
    assert.ok(!block.includes("onReact={("), "DM MessageRow must NOT pass onReact={( — that prop is ignored");
  });

  await test("src: DM MessageRow uses grouped={isConsecutive} (not isConsecutive=)", async () => {
    const dmMsgIdx = src.indexOf("dmMessages.map(");
    const block = src.slice(dmMsgIdx, dmMsgIdx + DM_MAP_WINDOW);
    assert.ok(block.includes("grouped={isConsecutive}"), "DM MessageRow must use grouped={isConsecutive}");
    assert.ok(!block.includes("isConsecutive={isConsecutive}"), "DM MessageRow must NOT use isConsecutive={isConsecutive}");
  });

  await test("src: DM MessageRow sets isAdmin={false}", async () => {
    const dmMsgIdx = src.indexOf("dmMessages.map(");
    const block = src.slice(dmMsgIdx, dmMsgIdx + DM_MAP_WINDOW);
    assert.ok(block.includes("isAdmin={false}"), "DM MessageRow must set isAdmin={false}");
  });

  await test("src: DM MessageRow sets isArchived={false} (reactions always available in DMs)", async () => {
    const dmMsgIdx = src.indexOf("dmMessages.map(");
    const block = src.slice(dmMsgIdx, dmMsgIdx + DM_MAP_WINDOW);
    assert.ok(block.includes("isArchived={false}"), "DM MessageRow must set isArchived={false}");
  });

  await test("src: DM onToggleReaction wired to dmReactMutation.mutate", async () => {
    const dmMsgIdx = src.indexOf("dmMessages.map(");
    const block = src.slice(dmMsgIdx, dmMsgIdx + DM_MAP_WINDOW);
    assert.ok(block.includes("dmReactMutation.mutate"), "onToggleReaction must call dmReactMutation.mutate");
  });

  await test("src: dmReactMutation defined as useMutation", async () => {
    assert.ok(src.includes("const dmReactMutation = useMutation"), "dmReactMutation must be defined");
  });

  await test("src: dmReactMutation posts to /api/current/messages/:id/reactions", async () => {
    const idx = src.indexOf("const dmReactMutation = useMutation");
    const block = src.slice(idx, idx + 300);
    assert.ok(block.includes("/api/current/messages/") && block.includes("reactions"), "must post to reactions endpoint");
  });

  await test("src: dmReactMutation invalidates DM messages query on success", async () => {
    const idx = src.indexOf("const dmReactMutation = useMutation");
    const block = src.slice(idx, idx + 400);
    assert.ok(block.includes("/api/current/dms"), "must invalidate DM messages query key");
  });

  // Window must be >4429 chars (measured distance from function MessageRow( to onToggle={onToggleReaction})
  const MSG_ROW_WINDOW = 5000;

  await test("src: ReactionStrip wired to onToggleReaction inside MessageRow", async () => {
    const idx = src.indexOf("function MessageRow(");
    assert.ok(idx > 0, "function MessageRow must exist");
    const block = src.slice(idx, idx + MSG_ROW_WINDOW);
    assert.ok(block.includes("onToggle={onToggleReaction}"), "ReactionStrip must be wired to onToggleReaction");
  });

  await test("src: MessageActionBar bridges onReact → onToggleReaction in MessageRow", async () => {
    const idx = src.indexOf("function MessageRow(");
    const block = src.slice(idx, idx + MSG_ROW_WINDOW);
    assert.ok(
      block.includes("onReact={(emoji) => onToggleReaction("),
      "MessageActionBar onReact must bridge to onToggleReaction"
    );
  });

  await test("src: ReactionStrip defined with reactions/messageId/onToggle", async () => {
    const idx = src.indexOf("function ReactionStrip(");
    assert.ok(idx > 0, "ReactionStrip component must be defined");
    const block = src.slice(idx, idx + 300);
    assert.ok(block.includes("reactions"), "ReactionStrip must have reactions prop");
    assert.ok(block.includes("onToggle"), "ReactionStrip must have onToggle prop");
    assert.ok(block.includes("messageId"), "ReactionStrip must have messageId prop");
  });

  await test("src: ReactionStrip applies primary styling for reacted state", async () => {
    const idx = src.indexOf("function ReactionStrip(");
    const block = src.slice(idx, idx + 700);
    assert.ok(block.includes("r.reacted"), "must check r.reacted for conditional styling");
    assert.ok(block.includes("bg-primary"), "must apply primary color when reacted");
  });

  await test("src: MessageActionBar returns null for archived (DM isArchived={false} keeps it visible)", async () => {
    const idx = src.indexOf("function MessageActionBar(");
    const block = src.slice(idx, idx + 1200);
    assert.ok(block.includes("if (isArchived) return null"), "MessageActionBar must guard on isArchived");
  });

  await test("src: PRESET_REACTIONS allowlist defined (used by EmojiPickerPopover)", async () => {
    assert.ok(src.includes("PRESET_REACTIONS"), "PRESET_REACTIONS must be defined");
  });

  // ── Source-grep: backend fix pins ─────────────────────────────────────────
  console.log("\n  [source-grep: backend fix pins]");

  await test("routes: reaction SELECT includes channel_id (required for archived channel guard to fire)", async () => {
    assert.ok(
      routes.includes("SELECT id, conversation_id, channel_id FROM current_messages WHERE id = ${messageId} AND deleted_at IS NULL LIMIT 1"),
      "reaction route SELECT must include channel_id — without it archived_at check is unreachable"
    );
  });

  await test("routes: reaction route uses msgRows channel_id for archived check", async () => {
    const idx = routes.indexOf('app.post("/api/current/messages/:id/reactions"');
    const block = routes.slice(idx, idx + 1500);
    assert.ok(block.includes("reactChannelId"), "reactChannelId must be derived from msgRows.rows[0].channel_id");
    assert.ok(block.includes("SELECT archived_at FROM current_channels"), "archived_at check must query current_channels");
  });

  // ── Live: archived channel reaction blocked ────────────────────────────────
  console.log("\n  [live: archived channel reaction block]");

  let archivedChannelId = 0;
  let archivedChannelSlug = "";
  let archivedChannelMsgId = 0;
  const tempChannelName = `Temp Audit 13A ${Date.now()}`;

  await test("archived channel: create temp channel (as admin)", async () => {
    const r = await api("POST", "/api/current/channels", { name: tempChannelName, description: "" }, cookieTrevor);
    assert.ok(r.status === 200 || r.status === 201, `expected 200/201, got ${r.status}: ${JSON.stringify(r.data)}`);
    archivedChannelId = r.data.id;
    archivedChannelSlug = r.data.slug;
    assert.ok(archivedChannelId > 0, "should have channel id");
    assert.ok(archivedChannelSlug, "should have channel slug");
  });

  await test("archived channel: post a message to temp channel (via slug)", async () => {
    const r = await api("POST", `/api/current/channels/${archivedChannelSlug}/messages`, { body: "audit13a test" }, cookieTrevor);
    assert.equal(r.status, 201, `expected 201, got ${r.status}: ${JSON.stringify(r.data)}`);
    archivedChannelMsgId = r.data.id;
    assert.ok(archivedChannelMsgId > 0, "should have message id");
  });

  await test("archived channel: can react before archiving → 200", async () => {
    const r = await api("POST", `/api/current/messages/${archivedChannelMsgId}/reactions`, { emoji: "👍" }, cookieTrevor);
    assert.equal(r.status, 200, `pre-archive reaction must succeed, got ${r.status}`);
    // toggle off
    await api("POST", `/api/current/messages/${archivedChannelMsgId}/reactions`, { emoji: "👍" }, cookieTrevor);
  });

  await test("archived channel: archive the temp channel (as admin)", async () => {
    const r = await api("POST", `/api/current/channels/${archivedChannelId}/archive`, {}, cookieTrevor);
    assert.ok(r.status === 200, `archive must succeed, got ${r.status}: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.ok, true);
  });

  await test("archived channel: react to channel message after archiving → 403", async () => {
    const r = await api("POST", `/api/current/messages/${archivedChannelMsgId}/reactions`, { emoji: "👍" }, cookieTrevor);
    assert.equal(r.status, 403, `archived channel reaction must be blocked (403), got ${r.status}: ${JSON.stringify(r.data)}`);
    assert.ok((r.data?.message || "").includes("archived"), "error message must mention 'archived'");
  });

  await test("archived channel: unarchive to restore (cleanup)", async () => {
    const r = await api("POST", `/api/current/channels/${archivedChannelId}/unarchive`, {}, cookieTrevor);
    assert.ok(r.status === 200, `unarchive must succeed, got ${r.status}`);
  });

  // ── Regression ─────────────────────────────────────────────────────────────
  console.log("\n  [regression]");

  await test("regression: archived channel reaction block present in routes.ts", async () => {
    assert.ok(routes.includes("Cannot react to messages in an archived channel"), "archived channel reaction guard must remain");
  });

  await test("regression: reactChannelId archived check still present", async () => {
    assert.ok(routes.includes("reactChannelId"), "reactChannelId check must remain");
  });

  await test("regression: Phase 12C participants route intact", async () => {
    assert.ok(routes.includes("/api/current/channels/:slug/participants"), "Phase 12C route must remain");
  });

  await test("regression: Phase 12B presence routes intact", async () => {
    assert.ok(routes.includes("/api/current/presence/heartbeat"), "Phase 12B heartbeat route must remain");
  });

  await test("regression: Phase 12A typing route intact", async () => {
    assert.ok(routes.includes("/api/current/typing"), "Phase 12A typing route must remain");
  });

  await test("regression: Phase 11B group DM members route intact", async () => {
    assert.ok(routes.includes("/api/current/dms/:id/members"), "Phase 11B add-members route must remain");
  });

  await test("regression: Phase 11A group DM create route intact", async () => {
    assert.ok(routes.includes('app.post("/api/current/dms"'), "Phase 11A DM create route must remain");
  });

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n── Results: ${passed + failed} tests — ${passed} passed, ${failed} failed ─────────────────────────\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
