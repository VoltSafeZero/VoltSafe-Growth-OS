"use strict";
/**
 * tests/channel-add-member.test.cjs
 * Regression suite for CURRENTS private-channel add-member bug fix.
 *
 * Root causes fixed:
 *   1. addChannelMemberMutation.onSuccess only invalidated "members" queryKey,
 *      but ChannelDetailsModal reads from "participants" queryKey → UI never
 *      refreshed after a successful add.
 *   2. The /participants endpoint read from current_messages + current_channel_preferences
 *      but NOT current_channel_members → newly added (non-posting) members never appeared.
 *   3. memberSearch didn't strip a leading "@", so "@scott" failed to match.
 *   4. No success feedback after adding a member.
 *
 * These are source-grep tests: verify code structure and invariants without
 * requiring a live server.
 */

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else           { console.error(`  ✗ ${label}`); failed++; }
}

function readFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const routes  = readFile("server/routes.ts");
const current = readFile("client/src/pages/current.tsx");
const indexTs = readFile("server/index.ts");

// ── T001: /participants endpoint includes current_channel_members in UNION ────
console.log("\n=== T001: /participants endpoint includes channel members ===");

assert(
  routes.includes("SELECT DISTINCT user_id FROM current_channel_members"),
  "/participants UNION includes current_channel_members"
);

assert(
  /SELECT DISTINCT user_id FROM current_messages[\s\S]{1,400}UNION[\s\S]{1,400}SELECT DISTINCT user_id FROM current_channel_preferences[\s\S]{1,400}UNION[\s\S]{1,400}SELECT DISTINCT user_id FROM current_channel_members/.test(routes),
  "All three UNION branches present in participants query (messages + prefs + members)"
);

// ── T002: addChannelMemberMutation invalidates BOTH query keys ───────────────
console.log("\n=== T002: addChannelMemberMutation invalidates both query keys ===");

// Narrow to the mutation definition
const addMutStart = current.indexOf("const addChannelMemberMutation = useMutation(");
const addMutEnd   = current.indexOf("const archiveChannelMutation", addMutStart);
const addMutBlock = current.slice(addMutStart, addMutEnd);

assert(
  addMutBlock.includes('"members"') || addMutBlock.includes("'members'"),
  "addChannelMemberMutation invalidates 'members' queryKey"
);

assert(
  addMutBlock.includes('"participants"') || addMutBlock.includes("'participants'"),
  "addChannelMemberMutation invalidates 'participants' queryKey"
);

assert(
  addMutBlock.includes("invalidateQueries") &&
    (addMutBlock.match(/invalidateQueries/g) || []).length >= 2,
  "addChannelMemberMutation calls invalidateQueries at least twice (members + participants)"
);

assert(
  addMutBlock.includes("toast(") && addMutBlock.includes("Member added"),
  "addChannelMemberMutation shows a success toast mentioning 'Member added'"
);

// ── T003: removeChannelMemberMutation invalidates BOTH query keys ────────────
console.log("\n=== T003: removeChannelMemberMutation invalidates both query keys ===");

const removeMutStart = current.indexOf("const removeChannelMemberMutation = useMutation(");
const removeMutEnd   = current.indexOf("const addChannelMemberMutation", removeMutStart);
const removeMutBlock = current.slice(removeMutStart, removeMutEnd);

assert(
  removeMutBlock.includes('"members"') || removeMutBlock.includes("'members'"),
  "removeChannelMemberMutation invalidates 'members' queryKey"
);

assert(
  removeMutBlock.includes('"participants"') || removeMutBlock.includes("'participants'"),
  "removeChannelMemberMutation invalidates 'participants' queryKey"
);

// ── T004: memberSearch strips leading "@" before filtering ──────────────────
console.log("\n=== T004: memberSearch '@' stripping ===");

assert(
  current.includes("replace(/^@/, \"\")") || current.includes("replace(/^@/,\"\")" ) || current.includes(".replace(/^@/,"),
  "filteredMembers strips leading '@' from search term"
);

assert(
  current.includes("memberSearchNorm") && current.includes("memberSearch.trim().replace(/^@/"),
  "Normalized search term used consistently (memberSearchNorm variable)"
);

// Both name and email are matched against the normalized term
const normFilterBlock = current.slice(
  current.indexOf("const memberSearchNorm"),
  current.indexOf("const msgsWithFiles")
);
assert(
  normFilterBlock.includes("memberSearchNorm") &&
    normFilterBlock.includes("p.name.toLowerCase()") &&
    normFilterBlock.includes("p.email.toLowerCase()"),
  "Normalized term matched against both name and email"
);

// ── T005: backend POST add-member route has ON CONFLICT DO NOTHING (no duplicates) ──
console.log("\n=== T005: No duplicate membership inserts ===");

assert(
  routes.includes("ON CONFLICT (channel_id, user_id) DO NOTHING"),
  "INSERT into current_channel_members uses ON CONFLICT DO NOTHING"
);

// ── T006: Channel creation auto-adds creator to current_channel_members ──────
console.log("\n=== T006: Channel creation auto-adds creator ===");

assert(
  /POST.*\/api\/current\/channels[\s\S]{1,2000}Auto-add creator/.test(routes),
  "Channel creation route documents auto-add of creator"
);

assert(
  /INSERT INTO current_channel_members[\s\S]{0,200}userId.*created_by|INSERT INTO current_channel_members[\s\S]{0,200}mid.*userId/.test(routes),
  "Creator and explicit members are inserted into current_channel_members at channel creation"
);

// ── T007: Startup backfill for missing creator memberships ──────────────────
console.log("\n=== T007: Startup backfill for missing private-channel creator rows ===");

assert(
  indexTs.includes("private-channel creator backfill") || indexTs.includes("backfilled") && indexTs.includes("private"),
  "server/index.ts has a startup backfill for private channel creator memberships"
);

assert(
  indexTs.includes("INSERT INTO current_channel_members") &&
    indexTs.includes("is_private = TRUE"),
  "Backfill inserts missing creator rows for private channels"
);

assert(
  indexTs.includes("ON CONFLICT (channel_id, user_id) DO NOTHING"),
  "Backfill is idempotent (ON CONFLICT DO NOTHING)"
);

// ── T008: ChannelDetailsModal receives participants prop (not fetching internally) ──
console.log("\n=== T008: ChannelDetailsModal wired correctly ===");

assert(
  current.includes("participants={channelParticipants}"),
  "ChannelDetailsModal receives channelParticipants as participants prop"
);

assert(
  current.includes('queryKey: ["/api/current/channels", selectedSlug, "participants"]'),
  "channelParticipants query uses 'participants' queryKey"
);

assert(
  current.includes(`/api/current/channels/${"`"}${"{"}encodeURIComponent(selectedSlug)${"}"}${"`"}/participants`) ||
    current.includes("/participants"),
  "channelParticipants fetches from /participants endpoint"
);

// ── T009: MemberPickerInline clears search field after selection ─────────────
console.log("\n=== T009: MemberPickerInline clears search after selection ===");

assert(
  current.includes('onClick={() => { onChange([...selectedIds, u.id]); setQ(""); }}') ||
    (current.includes("setQ(\"\")") && current.includes("onChange([...selectedIds")),
  "MemberPickerInline clears search query after a member is selected"
);

// ── T010: excludeIds keeps added members out of Add People suggestions ───────
console.log("\n=== T010: Already-added members excluded from Add People picker ===");

assert(
  current.includes("excludeIds={participants.map((p) => p.id)}"),
  "MemberPickerInline in ChannelDetailsModal excludes existing participants from suggestions"
);

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(52)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("\nSome checks failed — review the output above.");
  process.exit(1);
}
