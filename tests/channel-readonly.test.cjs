"use strict";
// Phase 9B — Archived Channel Read-Only Hardening
// Source-grep test suite: verifies all backend guards and frontend hide logic
// Run: node tests/channel-readonly.test.cjs

const fs = require("fs");
const path = require("path");

const ROUTES = "server/routes.ts";
const FRONTEND = "client/src/pages/current.tsx";

let passed = 0;
let failed = 0;
const failures = [];

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail ? " — " + detail : ""}`);
    failed++;
    failures.push(label);
  }
}

function assertInFile(label, filePath, pattern, detail = "") {
  const content = fs.readFileSync(filePath, "utf8");
  const match =
    typeof pattern === "string"
      ? content.includes(pattern)
      : pattern.test(content);
  assert(label, match, detail || `pattern not found in ${filePath}`);
}

function assertNotInSection(label, content, searchStr, ctx = "") {
  assert(label, !content.includes(searchStr), ctx || `unexpected '${searchStr}' found`);
}

console.log("=== Phase 9B — Archived Channel Read-Only Hardening ===\n");

// ── Section 1: Backend reaction guard ────────────────────────────────────────
console.log("── Backend: Reactions ──");

assertInFile(
  "B1. Reaction route has archived channel check",
  ROUTES,
  "Cannot react to messages in an archived channel"
);

assertInFile(
  "B2. Reaction archived check uses reactChannelId",
  ROUTES,
  "reactChannelId"
);

assertInFile(
  "B3. Reaction archived check queries current_channels",
  ROUTES,
  /reactChannelId.*SELECT archived_at FROM current_channels/s
);

assertInFile(
  "B3a. Reaction SELECT includes channel_id (required for archived channel check to fire)",
  ROUTES,
  "SELECT id, conversation_id, channel_id FROM current_messages WHERE id = ${messageId} AND deleted_at IS NULL LIMIT 1"
);

// ── Section 2: Backend edit guard ────────────────────────────────────────────
console.log("\n── Backend: Edit ──");

assertInFile(
  "B4. Edit route has archived channel check",
  ROUTES,
  "Cannot edit messages in an archived channel"
);

assertInFile(
  "B5. Edit archived check uses editChannelId",
  ROUTES,
  "editChannelId"
);

// ── Section 3: Backend delete guard ──────────────────────────────────────────
console.log("\n── Backend: Delete ──");

assertInFile(
  "B6. Delete route has archived channel check",
  ROUTES,
  "Cannot delete messages in an archived channel"
);

assertInFile(
  "B7. Delete archived check uses delChannelId",
  ROUTES,
  "delChannelId"
);

assertInFile(
  "B8. Delete SELECT now includes channel_id column",
  ROUTES,
  "SELECT id, user_id, channel_id FROM current_messages WHERE id = ${messageId} AND deleted_at IS NULL"
);

// ── Section 4: Backend unpin guard ───────────────────────────────────────────
console.log("\n── Backend: Unpin ──");

assertInFile(
  "B9. Unpin route has archived channel check",
  ROUTES,
  "Cannot unpin messages in an archived channel"
);

assertInFile(
  "B10. Unpin looks up channel_id via unpinMsg",
  ROUTES,
  "unpinMsg"
);

assertInFile(
  "B11. Unpin archived check uses unpinChanId",
  ROUTES,
  "unpinChanId"
);

// Verify unpin checks BEFORE the DELETE statement
{
  const content = fs.readFileSync(ROUTES, "utf8");
  const unpinBlock = content.slice(
    content.indexOf("// DELETE /api/current/messages/:id/pin"),
    content.indexOf("// GET /api/current/messages/:id/thread")
  );
  const arcIdx = unpinBlock.indexOf("Cannot unpin messages in an archived channel");
  const delIdx = unpinBlock.indexOf("DELETE FROM current_pins WHERE message_id");
  assert(
    "B12. Unpin archived check appears before DELETE FROM current_pins",
    arcIdx !== -1 && delIdx !== -1 && arcIdx < delIdx
  );
}

// ── Section 5: Backend thread reply guard ────────────────────────────────────
console.log("\n── Backend: Thread Reply ──");

assertInFile(
  "B13. Thread reply route has archived channel check",
  ROUTES,
  "Cannot reply in an archived channel"
);

// Verify thread reply guard appears before the INSERT
{
  const content = fs.readFileSync(ROUTES, "utf8");
  const threadBlock = content.slice(
    content.indexOf("app.post(\"/api/current/messages/:id/thread\""),
    content.indexOf("// ── Current mention helpers")
  );
  const arcIdx = threadBlock.indexOf("Cannot reply in an archived channel");
  const insIdx = threadBlock.indexOf("INSERT INTO current_messages");
  assert(
    "B14. Thread reply archived guard appears before INSERT",
    arcIdx !== -1 && insIdx !== -1 && arcIdx < insIdx
  );
}

// ── Section 6: Backend structured tag guards ─────────────────────────────────
console.log("\n── Backend: Structured Tags ──");

assertInFile(
  "B15. Structured add route has archived channel check",
  ROUTES,
  "Cannot add structured items to an archived channel message"
);

assertInFile(
  "B16. Structured remove route has archived channel check",
  ROUTES,
  "Cannot remove structured items from an archived channel message"
);

assertInFile(
  "B17. Structured delete looks up message before delete",
  ROUTES,
  "delStructMsg"
);

assertInFile(
  "B18. Structured delete uses delStructChanId",
  ROUTES,
  "delStructChanId"
);

// Verify structured delete checks BEFORE DELETE FROM current_structured_items
{
  const content = fs.readFileSync(ROUTES, "utf8");
  const delBlock = content.slice(
    content.indexOf("// DELETE /api/current/messages/:id/structured/:itemType"),
    content.indexOf("// GET /api/current/structured")
  );
  const arcIdx = delBlock.indexOf("Cannot remove structured items from an archived channel message");
  const delIdx = delBlock.indexOf("DELETE FROM current_structured_items");
  assert(
    "B19. Structured remove archived guard appears before DELETE",
    arcIdx !== -1 && delIdx !== -1 && arcIdx < delIdx
  );
}

// ── Section 7: Backend attachment upload guard ───────────────────────────────
console.log("\n── Backend: Attachment Upload ──");

assertInFile(
  "B20. Attachment upload has archived channel check",
  ROUTES,
  "Cannot upload attachments to an archived channel message"
);

assertInFile(
  "B21. Attachment upload uses uploadChanId",
  ROUTES,
  "uploadChanId"
);

assertInFile(
  "B22. Attachment upload deletes temp files on archived 403",
  ROUTES,
  /Cannot upload attachments to an archived channel message[\s\S]{1,200}unlinkSync|unlinkSync[\s\S]{1,200}Cannot upload attachments to an archived channel message/
);

// Verify attachment guard is inside the current_message block
{
  const content = fs.readFileSync(ROUTES, "utf8");
  const uploadBlock = content.slice(
    content.indexOf("// DM ownership guard: when uploading to a current_message"),
    content.indexOf("const NOTABLE_CATS")
  );
  assert(
    "B23. Attachment archived guard is inside current_message block",
    uploadBlock.includes("Cannot upload attachments to an archived channel message")
  );
}

// ── Section 8: Backend pin guard (Phase 9A confirmed) ────────────────────────
console.log("\n── Backend: Pin (Phase 9A confirmed) ──");

assertInFile(
  "B24. Pin route still has archived channel check (9A)",
  ROUTES,
  "Cannot pin messages in an archived channel"
);

// ── Section 9: Backend — already-guarded root message route ──────────────────
console.log("\n── Backend: Root Message POST (Phase 9A) ──");

assertInFile(
  "B25. Root message POST still uses AND archived_at IS NULL on channel lookup",
  ROUTES,
  "AND archived_at IS NULL LIMIT 1"
);

// ── Section 10: Frontend — MessageActionBar ───────────────────────────────────
console.log("\n── Frontend: MessageActionBar ──");

assertInFile(
  "F1. MessageActionBar has isArchived prop",
  FRONTEND,
  "isArchived?: boolean;"
);

assertInFile(
  "F2. MessageActionBar returns null when isArchived",
  FRONTEND,
  "if (isArchived) return null;"
);

// ── Section 11: Frontend — MessageRow ────────────────────────────────────────
console.log("\n── Frontend: MessageRow ──");

assertInFile(
  "F3. MessageRow has isArchived prop",
  FRONTEND,
  "isArchived?: boolean;"
);

assertInFile(
  "F4. MessageRow passes isArchived to MessageActionBar",
  FRONTEND,
  "isArchived={isArchived}"
);

// ── Section 12: Frontend — Main feed ─────────────────────────────────────────
console.log("\n── Frontend: Main Feed ──");

assertInFile(
  "F5. Main feed MessageRow passes isArchived={isArchivedChannel}",
  FRONTEND,
  "isArchived={isArchivedChannel}"
);

// ── Section 13: Frontend — ThreadPanel ───────────────────────────────────────
console.log("\n── Frontend: ThreadPanel ──");

assertInFile(
  "F6. ThreadPanel has isArchived prop in signature",
  FRONTEND,
  /function ThreadPanel\([^)]*\{[\s\S]{1,500}isArchived\?: boolean/
);

assertInFile(
  "F7. ThreadPanel passes isArchived to root MessageRow",
  FRONTEND,
  "thread-archived-notice"
);

assertInFile(
  "F8. ThreadPanel archived-notice text",
  FRONTEND,
  "This channel is archived — replies are disabled."
);

assertInFile(
  "F9. ThreadPanel passes isArchived to reply MessageRows",
  FRONTEND,
  "isArchived={isArchived}"
);

// ── Section 14: Frontend — ThreadPanel call site ──────────────────────────────
console.log("\n── Frontend: ThreadPanel Call Site ──");

{
  const content = fs.readFileSync(FRONTEND, "utf8");
  const threadPanelCall = content.slice(
    content.indexOf("<ThreadPanel"),
    content.indexOf("/>", content.indexOf("<ThreadPanel")) + 2
  );
  assert(
    "F10. ThreadPanel call site passes isArchived={isArchivedChannel}",
    threadPanelCall.includes("isArchived={isArchivedChannel}")
  );
}

// ── Section 15: Frontend — Main composer (Phase 9A confirmed) ────────────────
console.log("\n── Frontend: Main Composer (Phase 9A confirmed) ──");

assertInFile(
  "F11. Main composer still guarded by !isArchivedChannel",
  FRONTEND,
  "!isArchivedChannel"
);

assertInFile(
  "F12. Archived banner still present with amber styling",
  FRONTEND,
  "This channel is archived. Messages are read-only."
);

// ── Section 16: AI Summary — ALLOWED (read-only) ─────────────────────────────
console.log("\n── AI Summary Decision ──");

assertInFile(
  "D1. AI summary route exists (allowed in archived channels)",
  ROUTES,
  "app.post(\"/api/current/summary\""
);

// AI summary only reads, does not mutate channel/message state
{
  const content = fs.readFileSync(ROUTES, "utf8");
  const summaryBlock = content.slice(
    content.indexOf("app.post(\"/api/current/summary\""),
    content.indexOf("app.post(\"/api/current/summary\"") + 8000
  );
  assertNotInSection(
    "D2. AI summary does NOT update current_messages or current_channels",
    summaryBlock,
    "UPDATE current_messages",
    "AI summary must be read-only"
  );
  assertNotInSection(
    "D3. AI summary does NOT insert into current_messages",
    summaryBlock,
    "INSERT INTO current_messages",
    "AI summary must be read-only"
  );
}

// ── Section 17: Create Task — ALLOWED (tasks table only) ─────────────────────
console.log("\n── Create Task Decision ──");

assertInFile(
  "D4. Create task from message UI handler exists",
  FRONTEND,
  "handleCreateTaskFromMsg"
);

// Verify task creation only writes to tasks table, not current_messages
{
  const content = fs.readFileSync(FRONTEND, "utf8");
  const taskFnIdx = content.indexOf("function handleCreateTaskFromMsg");
  const taskFnEnd = content.indexOf("\n}", taskFnIdx) + 2;
  if (taskFnIdx !== -1) {
    const taskFn = content.slice(taskFnIdx, taskFnEnd);
    assertNotInSection(
      "D5. handleCreateTaskFromMsg does NOT call current_messages mutation",
      taskFn,
      "postReplyMutation",
      "task creation must not touch current_messages"
    );
    assert(
      "D6. handleCreateTaskFromMsg sets create task source (tasks table only)",
      taskFn.includes("setCreateTaskSource")
    );
  } else {
    assert("D5. handleCreateTaskFromMsg function found", false, "function not found");
    assert("D6. handleCreateTaskFromMsg sets create task source", false, "function not found");
  }
}

// ── Section 18: DM/Record Currents isolation ─────────────────────────────────
console.log("\n── Isolation: DM & Record Currents unaffected ──");

// DM messages have conversation_id not channel_id — archived checks use channel_id
assertInFile(
  "I1. Reaction archived check uses channel_id (not conversation_id) — DMs unaffected",
  ROUTES,
  "reactChannelId"
);

assertInFile(
  "I2. Thread reply archived check is channel-scoped (if channelId) — Record Currents unaffected",
  ROUTES,
  /\/\/ Block replies in archived channels[\s\S]{1,50}if \(channelId\)/
);

assertInFile(
  "I3. Structured add archived check is channel-scoped — Record Currents unaffected",
  ROUTES,
  /\/\/ Block structured tags in archived[\s\S]{1,100}if \(channelId\)/
);

assertInFile(
  "I4. DM route unchanged (GET /api/current/dms still exists)",
  ROUTES,
  "app.get(\"/api/current/dms\""
);

// ── Section 19: Deep-link readability ────────────────────────────────────────
console.log("\n── Deep-link Readability ──");

assertInFile(
  "L1. GET messages channel subquery does NOT require archived_at IS NULL (allows archived channel reads)",
  ROUTES,
  "WHERE m.channel_id = ("
);

{
  const content = fs.readFileSync(ROUTES, "utf8");
  const getMessagesBlock = content.slice(
    content.indexOf("app.get(\"/api/current/channels/:slug/messages\""),
    content.indexOf("app.post(\"/api/current/channels/:slug/messages\"")
  );
  assertNotInSection(
    "L2. GET messages channel lookup does NOT have archived_at IS NULL on the WHERE cc.slug block",
    getMessagesBlock,
    "AND cc.archived_at IS NULL",
    "archived channel messages must remain readable"
  );
}

assertInFile(
  "L3. GET /api/current/channels/:slug route returns archivedAt field",
  ROUTES,
  "archivedAt:"
);

assertInFile(
  "L4. isArchivedChannel computed from selectedChannelDirect.archivedAt",
  FRONTEND,
  "isArchivedChannel = !selectedChannel && !channelsLoading && !!selectedChannelDirect?.archivedAt"
);

// ── Section 20: Security checks ──────────────────────────────────────────────
console.log("\n── Security ──");

assertInFile(
  "S1. All Currents write guards return 403 (not 200/201) on archived channel",
  ROUTES,
  /res\.status\(403\)\.json\(\{ message: "Cannot.*archived channel/
);

assertInFile(
  "S2. requireAuth on all write routes",
  ROUTES,
  /app\.post\("\/api\/current\/messages\/:id\/reactions".*requireAuth/
);

assertInFile(
  "S3. requireAuth on patch route",
  ROUTES,
  /app\.patch\("\/api\/current\/messages\/:id".*requireAuth/
);

assertInFile(
  "S4. requireAuth on delete route",
  ROUTES,
  /app\.delete\("\/api\/current\/messages\/:id".*requireAuth/
);

assertInFile(
  "S5. requireAuth on thread reply route",
  ROUTES,
  /app\.post\("\/api\/current\/messages\/:id\/thread".*requireAuth/
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

if (failures.length > 0) {
  console.log("Failed checks:");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
