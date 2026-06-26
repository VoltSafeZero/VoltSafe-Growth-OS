"use strict";
// Phase 6C source-grep test — pins all metadata completion invariants
// Tests: create-task-from-current-dialog, record-current-feed, current.tsx, task-detail-drawer
const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

// ── Load source files ──────────────────────────────────────────────────────────

const dialogSrc = fs.readFileSync(
  path.join(__dirname, "../client/src/components/current/create-task-from-current-dialog.tsx"),
  "utf8"
);
const recordFeedSrc = fs.readFileSync(
  path.join(__dirname, "../client/src/components/current/record-current-feed.tsx"),
  "utf8"
);
const currentSrc = fs.readFileSync(
  path.join(__dirname, "../client/src/pages/current.tsx"),
  "utf8"
);
const drawerSrc = fs.readFileSync(
  path.join(__dirname, "../client/src/components/tasks/task-detail-drawer.tsx"),
  "utf8"
);

// ── 1. CreateTaskSource type: summary_action_item has all context fields ────────

console.log("\n1. CreateTaskSource type — summary_action_item context fields");
assert(
  "channelSlug? field declared on summary_action_item",
  dialogSrc.includes("channelSlug?: string;")
);
assert(
  "objectType? field declared on summary_action_item",
  dialogSrc.includes("objectType?: string;")
);
assert(
  "objectId? field declared on summary_action_item",
  dialogSrc.includes("objectId?: number;")
);
assert(
  "threadRootId? field declared on summary_action_item",
  dialogSrc.includes("threadRootId?: number;")
);

// ── 2. buildSourceMeta: channel_message ──────────────────────────────────────

console.log("\n2. buildSourceMeta — channel_message shape");
assert(
  "channel_message: sourceContext = currents_channel",
  dialogSrc.includes('sourceContext: "currents_channel"')
);
assert(
  "channel_message: messageId stored",
  dialogSrc.includes("messageId: source.messageId") &&
  dialogSrc.includes('kind: "channel_message"')
);
assert(
  "channel_message: channelSlug stored",
  dialogSrc.includes("channelSlug: source.channelSlug")
);
assert(
  "channel_message: threadRootId stored (null default)",
  dialogSrc.includes("threadRootId: source.threadRootId ?? null")
);

// ── 3. buildSourceMeta: record_message ────────────────────────────────────────

console.log("\n3. buildSourceMeta — record_message shape");
assert(
  "record_message: sourceContext = currents_record",
  dialogSrc.includes('sourceContext: "currents_record"')
);
assert(
  "record_message: objectType stored",
  dialogSrc.includes("objectType: source.objectType")
);
assert(
  "record_message: objectId stored",
  dialogSrc.includes("objectId: source.objectId")
);
assert(
  "record_message: linkedObjectType mirrored in meta",
  dialogSrc.includes("linkedObjectType: source.objectType")
);
assert(
  "record_message: linkedObjectId mirrored in meta",
  dialogSrc.includes("linkedObjectId: source.objectId")
);
assert(
  "record_message: threadRootId stored",
  dialogSrc.includes("threadRootId: source.threadRootId ?? null")
);

// ── 4. buildSourceMeta: summary_action_item ──────────────────────────────────

console.log("\n4. buildSourceMeta — summary_action_item shape");
assert(
  "summary: summaryContext = currents_summary always set",
  dialogSrc.includes('summaryContext: "currents_summary"')
);
assert(
  "summary: channelSlug passed when available",
  dialogSrc.includes("meta.channelSlug = source.channelSlug")
);
assert(
  "summary: sourceContext = currents_channel when channelSlug",
  dialogSrc.includes('meta.sourceContext = "currents_channel"')
);
assert(
  "summary: objectType passed when available",
  dialogSrc.includes("meta.objectType = source.objectType")
);
assert(
  "summary: objectId passed when available",
  dialogSrc.includes("meta.objectId = source.objectId")
);
assert(
  "summary: linkedObjectType set for record context",
  dialogSrc.includes("meta.linkedObjectType = source.objectType")
);
assert(
  "summary: linkedObjectId set for record context",
  dialogSrc.includes("meta.linkedObjectId = source.objectId")
);
assert(
  "summary: sourceContext = currents_record when record only",
  dialogSrc.includes('meta.sourceContext = "currents_record"')
);
assert(
  "summary: threadRootId stored when available",
  dialogSrc.includes("meta.threadRootId = source.threadRootId")
);

// ── 5. createMutation: CRM link fields ────────────────────────────────────────

console.log("\n5. createMutation — CRM linkedObject linking");
assert(
  "record_message sets body.linkedObjectType",
  dialogSrc.includes('body.linkedObjectType = source.objectType')
);
assert(
  "record_message sets body.linkedObjectId",
  dialogSrc.includes('body.linkedObjectId = source.objectId')
);
assert(
  "summary_action_item with record context sets body.linkedObjectType",
  dialogSrc.includes('source.kind === "summary_action_item" && source.objectType')
);

// ── 6. current.tsx call sites ─────────────────────────────────────────────────

console.log("\n6. current.tsx — call sites pass context");
assert(
  "channel summary passes channelSlug",
  currentSrc.includes("channelSlug: selectedSlug") &&
  currentSrc.includes("summaryContext: `Channel: #${selectedSlug}`")
);
assert(
  "thread summary passes channelSlug",
  // Two lines near the thread summary
  (() => {
    const idx = currentSrc.indexOf("Thread in #${selectedSlug}");
    if (idx === -1) return false;
    const snippet = currentSrc.slice(Math.max(0, idx - 300), idx + 200);
    return snippet.includes("channelSlug: selectedSlug");
  })()
);
assert(
  "thread summary passes threadRootId",
  (() => {
    const idx = currentSrc.indexOf("Thread in #${selectedSlug}");
    if (idx === -1) return false;
    const snippet = currentSrc.slice(Math.max(0, idx - 300), idx + 200);
    return snippet.includes("threadRootId: threadRootId");
  })()
);

// ── 7. record-current-feed.tsx call site ─────────────────────────────────────

console.log("\n7. record-current-feed.tsx — record summary passes context");
assert(
  "record summary passes objectType",
  (() => {
    const idx = recordFeedSrc.indexOf("record Currents");
    if (idx === -1) return false;
    const snippet = recordFeedSrc.slice(Math.max(0, idx - 200), idx + 100);
    return snippet.includes("objectType,");
  })()
);
assert(
  "record summary passes objectId",
  (() => {
    const idx = recordFeedSrc.indexOf("record Currents");
    if (idx === -1) return false;
    const snippet = recordFeedSrc.slice(Math.max(0, idx - 200), idx + 100);
    return snippet.includes("objectId");
  })()
);

// ── 8. task-detail-drawer: buildCurrentsUrl ──────────────────────────────────

console.log("\n8. task-detail-drawer — buildCurrentsUrl handles both contexts");
assert(
  "buildCurrentsUrl handles currents_channel",
  drawerSrc.includes('sourceContext === "currents_channel"')
);
assert(
  "buildCurrentsUrl handles currents_record",
  drawerSrc.includes('sourceContext === "currents_record"')
);
assert(
  "buildCurrentsUrl includes threadRootId in channel URL",
  (() => {
    const idx = drawerSrc.indexOf("currents_channel");
    const snippet = drawerSrc.slice(idx, idx + 300);
    return snippet.includes("threadRootId");
  })()
);
assert(
  "buildCurrentsUrl lead special-case",
  drawerSrc.includes('/opportunities?selected=')
);
assert(
  "buildCurrentsUrl includes threadRootId in record URL",
  (() => {
    const idx = drawerSrc.indexOf("currents_record");
    const snippet = drawerSrc.slice(idx, idx + 400);
    return snippet.includes("threadRootId");
  })()
);

// ── 9. Drawer: summary block ──────────────────────────────────────────────────

console.log("\n9. task-detail-drawer — summary block");
assert(
  "summary block shows 'Created from Currents AI Summary'",
  drawerSrc.includes("Created from Currents AI Summary")
);
assert(
  "summary block has data-testid=panel-currents-source",
  (() => {
    const idx = drawerSrc.indexOf("Created from Currents AI Summary");
    const snippet = drawerSrc.slice(Math.max(0, idx - 400), idx + 50);
    return snippet.includes('data-testid="panel-currents-source"');
  })()
);
assert(
  "summary block builds soft channel URL",
  drawerSrc.includes("/current?channel=") && drawerSrc.includes("sm.channelSlug")
);
assert(
  "summary block builds soft record URL (lead case)",
  (() => {
    // softUrl is computed BEFORE the JSX return; search the whole summary block
    const blockStart = drawerSrc.indexOf("sm.summaryContext === \"currents_summary\"");
    if (blockStart === -1) return false;
    const snippet = drawerSrc.slice(blockStart, blockStart + 2000);
    return snippet.includes("selected=") && snippet.includes("tab=current");
  })()
);
assert(
  "summary block shows View in Currents link when softUrl available",
  (() => {
    const idx = drawerSrc.indexOf("Created from Currents AI Summary");
    const snippet = drawerSrc.slice(idx, idx + 1200);
    return snippet.includes('data-testid="link-view-in-currents"');
  })()
);
assert(
  "summary block shows no broken link when no context (softUrl null guard)",
  drawerSrc.includes("softUrl && softLabel")
);
assert(
  "summary block shows thread indicator when threadRootId present",
  (() => {
    const idx = drawerSrc.indexOf("Created from Currents AI Summary");
    const snippet = drawerSrc.slice(idx, idx + 1500);
    return snippet.includes("sm.threadRootId") && snippet.includes("thread");
  })()
);

// ── 10. Non-Currents tasks: no source block ───────────────────────────────────

console.log("\n10. Regression: source block only appears for current_message tasks");
assert(
  "source block gated on t.source === 'current_message'",
  drawerSrc.includes('t.source === "current_message"')
);
assert(
  "source block also requires t.source_meta truthy",
  drawerSrc.includes('t.source === "current_message" && t.source_meta')
);

// ── 11. Channel thread reply in current.tsx: threadRootId in handleCreateTaskFromMsg ─

console.log("\n11. current.tsx — channel thread reply passes threadRootId");
assert(
  "handleCreateTaskFromMsg passes threadRootId param",
  currentSrc.includes("function handleCreateTaskFromMsg(msg: Message, threadRootId?: number)")
);
assert(
  "handleCreateTaskFromMsg includes threadRootId in source",
  (() => {
    const idx = currentSrc.indexOf("handleCreateTaskFromMsg");
    const snippet = currentSrc.slice(idx, idx + 400);
    return snippet.includes("threadRootId,");
  })()
);
assert(
  "ThreadPanel passes msg with threadRootId via onCreateTaskMsg",
  currentSrc.includes("onCreateTaskMsg={handleCreateTaskFromMsg}")
);

// ── 12. Record thread reply in record-current-feed.tsx ───────────────────────

console.log("\n12. record-current-feed — record thread reply passes threadRootId");
assert(
  "handleCreateTaskFromRecordMsg has threadRootId param",
  recordFeedSrc.includes("function handleCreateTaskFromRecordMsg(msg: RecordMessage, threadRootId?: number)")
);
assert(
  "ThreadPanel (record) passes threadRootId via onCreateTask",
  recordFeedSrc.includes("onCreateTask={(m) => onCreateTask?.(m, rootId)}")
);
assert(
  "main feed thread panel wires handleCreateTaskFromRecordMsg",
  recordFeedSrc.includes("onCreateTask={handleCreateTaskFromRecordMsg}")
);

// ── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(55)}`);
console.log(`  Phase 6C metadata: ${passed} passed, ${failed} failed`);
console.log("─".repeat(55));
process.exit(failed > 0 ? 1 : 0);
