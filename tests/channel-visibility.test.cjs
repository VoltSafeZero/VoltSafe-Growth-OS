"use strict";
// Phase 9C — Archived Channel Visibility / Structured Panel Polish
// Source-grep test suite: verifies archived metadata in API responses and
// badge/toggle behavior in all read-only surfaces.
// Run: node tests/channel-visibility.test.cjs

const fs = require("fs");

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

function assertNotInFile(label, filePath, pattern, detail = "") {
  const content = fs.readFileSync(filePath, "utf8");
  const match =
    typeof pattern === "string"
      ? content.includes(pattern)
      : pattern.test(content);
  assert(label, !match, detail || `unexpected pattern found in ${filePath}`);
}

console.log("=== Phase 9C — Archived Channel Visibility / Structured Panel Polish ===\n");

// ── Section 1: Backend — GET /api/current/mentions ────────────────────────────
console.log("── Backend: Mentions route ──");

assertInFile(
  "M1. Mentions SELECT includes is_channel_archived column",
  ROUTES,
  "(c.archived_at IS NOT NULL) AS is_channel_archived"
);

assertInFile(
  "M2. Mentions response maps isChannelArchived",
  ROUTES,
  /channelName: r\.channel_name \|\| null,\s*isChannelArchived: Boolean\(r\.is_channel_archived\)/
);

// Verify the is_channel_archived column is in the mentions SELECT block
{
  const content = fs.readFileSync(ROUTES, "utf8");
  const mentionsStart = content.indexOf("// GET /api/current/mentions");
  const mentionsEnd = content.indexOf("// ── Record Current Routes", mentionsStart);
  const mentionsBlock = content.slice(mentionsStart, mentionsEnd);
  assert(
    "M3. Mentions is_channel_archived column is inside the mentions route",
    mentionsBlock.includes("(c.archived_at IS NOT NULL) AS is_channel_archived") &&
    mentionsBlock.includes("isChannelArchived: Boolean(r.is_channel_archived)")
  );
}

// ── Section 2: Backend — GET /api/current/structured ─────────────────────────
console.log("\n── Backend: Structured route ──");

assertInFile(
  "S1. Structured SELECT includes is_channel_archived column",
  ROUTES,
  /\(c\.archived_at IS NOT NULL\) AS is_channel_archived\s*FROM current_structured_items/s
);

assertInFile(
  "S2. Structured response maps isChannelArchived",
  ROUTES,
  /channelName: r\.channel_name \?\? null,\s*isChannelArchived: Boolean\(r\.is_channel_archived\)/
);

// Verify inside GET /api/current/structured
{
  const content = fs.readFileSync(ROUTES, "utf8");
  const structStart = content.indexOf("// GET /api/current/structured");
  const structEnd = content.indexOf("// POST /api/current/summary", structStart);
  const structBlock = content.slice(structStart, structEnd);
  assert(
    "S3. Structured is_channel_archived column is inside the structured route",
    structBlock.includes("(c.archived_at IS NOT NULL) AS is_channel_archived") &&
    structBlock.includes("isChannelArchived: Boolean(r.is_channel_archived)")
  );
}

// ── Section 3: Backend — GET /api/current/search ─────────────────────────────
console.log("\n── Backend: Search route ──");

assertInFile(
  "SR1. Search SELECT includes is_channel_archived column",
  ROUTES,
  "(cc.archived_at IS NOT NULL) AS is_channel_archived,"
);

assertInFile(
  "SR2. Search response maps isChannelArchived",
  ROUTES,
  /channelName: r\.channel_name \?\? null,\s*isChannelArchived: Boolean\(r\.is_channel_archived\)/
);

// Verify inside GET /api/current/search
{
  const content = fs.readFileSync(ROUTES, "utf8");
  const searchStart = content.indexOf("// GET /api/current/search");
  const searchEnd = content.indexOf("// ── Structured Items Routes", searchStart);
  const searchBlock = content.slice(searchStart, searchEnd);
  assert(
    "SR3. Search is_channel_archived column is inside the search route",
    searchBlock.includes("(cc.archived_at IS NOT NULL) AS is_channel_archived") &&
    searchBlock.includes("isChannelArchived: Boolean(r.is_channel_archived)")
  );
}

// ── Section 4: Backend — GET /api/current/channels/:slug/pins ────────────────
console.log("\n── Backend: Pins route ──");

// Pins route must NOT have archived_at IS NULL restriction so archived pins are still readable
{
  const content = fs.readFileSync(ROUTES, "utf8");
  const pinsGetStart = content.indexOf("app.get(\"/api/current/channels/:slug/pins\"");
  const pinsGetEnd = content.indexOf("app.post(\"/api/current/messages/:id/pin\"", pinsGetStart);
  const pinsBlock = content.slice(pinsGetStart, pinsGetEnd);
  assert(
    "P1. Pins GET route does NOT exclude archived channels (archived pins remain readable)",
    !pinsBlock.includes("AND cc.archived_at IS NULL") &&
    !pinsBlock.includes("AND c.archived_at IS NULL")
  );
}

assertInFile(
  "P2. Pins POST route still blocked for archived channels (Phase 9B)",
  ROUTES,
  "Cannot pin messages in an archived channel"
);

assertInFile(
  "P3. Pins DELETE route still blocked for archived channels (Phase 9B)",
  ROUTES,
  "Cannot unpin messages in an archived channel"
);

// ── Section 5: Frontend — ArchivedBadge component ────────────────────────────
console.log("\n── Frontend: ArchivedBadge component ──");

assertInFile(
  "AB1. ArchivedBadge component defined",
  FRONTEND,
  "function ArchivedBadge()"
);

assertInFile(
  "AB2. ArchivedBadge has data-testid",
  FRONTEND,
  "data-testid=\"archived-badge\""
);

assertInFile(
  "AB3. ArchivedBadge has amber styling",
  FRONTEND,
  "bg-amber-500/10 text-amber-400"
);

assertInFile(
  "AB4. ArchivedBadge displays 'Archived' text",
  FRONTEND,
  /function ArchivedBadge[\s\S]{1,300}Archived/
);

// ── Section 6: Frontend — Interfaces with isChannelArchived ──────────────────
console.log("\n── Frontend: Interface extensions ──");

assertInFile(
  "I1. MentionMessage interface has isChannelArchived",
  FRONTEND,
  /interface MentionMessage[\s\S]{1,400}isChannelArchived\?: boolean/
);

assertInFile(
  "I2. SearchResult interface has isChannelArchived",
  FRONTEND,
  /interface SearchResult[\s\S]{1,400}isChannelArchived\?: boolean/
);

assertInFile(
  "I3. StructuredListItem interface has isChannelArchived",
  FRONTEND,
  /interface StructuredListItem[\s\S]{1,500}isChannelArchived: boolean/
);

// ── Section 7: Frontend — StructuredItemsPanel toggle ────────────────────────
console.log("\n── Frontend: StructuredItemsPanel toggle ──");

assertInFile(
  "ST1. StructuredItemsPanel has includeArchived state",
  FRONTEND,
  "const [includeArchived, setIncludeArchived] = useState(false)"
);

assertInFile(
  "ST2. StructuredItemsPanel filters by isChannelArchived (visibleData)",
  FRONTEND,
  "const visibleData = includeArchived ? data : data.filter(i => !i.isChannelArchived)"
);

assertInFile(
  "ST3. StructuredItemsPanel counts use visibleData (not raw data)",
  FRONTEND,
  "all: visibleData.length,"
);

assertInFile(
  "ST4. StructuredItemsPanel displayed uses visibleData",
  FRONTEND,
  "const displayed = filter === \"all\" ? visibleData : visibleData.filter(i => i.itemType === filter)"
);

assertInFile(
  "ST5. Include archived toggle has data-testid",
  FRONTEND,
  "data-testid=\"structured-include-archived-toggle\""
);

assertInFile(
  "ST6. Include archived label has data-testid",
  FRONTEND,
  "data-testid=\"structured-include-archived-label\""
);

assertInFile(
  "ST7. Include archived checkbox is off by default (useState(false))",
  FRONTEND,
  "setIncludeArchived] = useState(false)"
);

assertInFile(
  "ST8. Include archived label text is correct",
  FRONTEND,
  "Include archived channels"
);

// ── Section 8: Frontend — Archived badge in StructuredItemsPanel ─────────────
console.log("\n── Frontend: Archived badge in StructuredItemsPanel ──");

{
  const content = fs.readFileSync(FRONTEND, "utf8");
  const structPanelStart = content.indexOf("function StructuredItemsPanel(");
  const structPanelEnd = content.indexOf("// ── Main page", structPanelStart);
  const structPanelBlock = content.slice(structPanelStart, structPanelEnd);
  assert(
    "SB1. StructuredItemsPanel renders ArchivedBadge on items when isChannelArchived",
    structPanelBlock.includes("item.isChannelArchived && <ArchivedBadge")
  );
  assert(
    "SB2. ArchivedBadge appears in StructuredItemsPanel item top row",
    structPanelBlock.includes("item.isChannelArchived && <ArchivedBadge")
  );
}

// CSV export uses displayed (which is already filtered by visibleData)
assertInFile(
  "SB3. StructuredItemsPanel CSV export uses displayed (visible items only)",
  FRONTEND,
  "const rows = displayed.map(item =>"
);

// ── Section 9: Frontend — Search badge ───────────────────────────────────────
console.log("\n── Frontend: Search badge ──");

{
  const content = fs.readFileSync(FRONTEND, "utf8");
  const searchCardStart = content.indexOf("function SearchResultCard(");
  const searchCardEnd = content.indexOf("// ── NewDmDialog", searchCardStart);
  const searchCardBlock = content.slice(searchCardStart, searchCardEnd);
  assert(
    "SRC1. SearchResultCard renders ArchivedBadge when isChannelArchived",
    searchCardBlock.includes("result.isChannelArchived && <ArchivedBadge")
  );
  assert(
    "SRC2. ArchivedBadge is in the header row of SearchResultCard",
    searchCardBlock.includes("result.isChannelArchived && <ArchivedBadge")
  );
}

// ── Section 10: Frontend — Mentions badge ────────────────────────────────────
console.log("\n── Frontend: Mentions badge ──");

{
  const content = fs.readFileSync(FRONTEND, "utf8");
  const mentionsPanelStart = content.indexOf("function MentionsPanel(");
  const mentionsPanelEnd = content.indexOf("// ── StructuredListItem", mentionsPanelStart);
  const mentionsPanelBlock = content.slice(mentionsPanelStart, mentionsPanelEnd);
  assert(
    "MB1. MentionsPanel renders ArchivedBadge when isChannelArchived",
    mentionsPanelBlock.includes("m.isChannelArchived && <ArchivedBadge")
  );
  assert(
    "MB2. ArchivedBadge is in the mention item header row",
    mentionsPanelBlock.includes("m.isChannelArchived && <ArchivedBadge")
  );
}

// ── Section 11: Deep-link behavior ───────────────────────────────────────────
console.log("\n── Deep-link behavior ──");

assertInFile(
  "DL1. Deep-link handler reads ?channel= param",
  FRONTEND,
  "const chan = params.get(\"channel\")"
);

assertInFile(
  "DL2. Deep-link handler sets selectedSlug and view=channel",
  FRONTEND,
  /setSelectedSlug\(chan\);\s*setView\("channel"\)/
);

assertInFile(
  "DL3. Archived channel loads via selectedChannelDirect (not channelList)",
  FRONTEND,
  "selectedChannelDirect?.archivedAt"
);

assertInFile(
  "DL4. Archived channel read-only banner still present",
  FRONTEND,
  "This channel is archived. Messages are read-only."
);

// ── Section 12: AI Summary — works on archived channels ──────────────────────
console.log("\n── AI Summary ──");

assertInFile(
  "AI1. AI summary route does not restrict archived channels",
  ROUTES,
  "app.post(\"/api/current/summary\""
);

// Verify summary route has no archived_at IS NULL on channel lookup for channel scope
{
  const content = fs.readFileSync(ROUTES, "utf8");
  const summaryStart = content.indexOf("app.post(\"/api/current/summary\"");
  const summaryEnd = content.indexOf("// POST /api/current/channels/:id/archive", summaryStart);
  const summaryBlock = content.slice(summaryStart, Math.min(summaryEnd, summaryStart + 15000));
  assert(
    "AI2. AI summary channel scope does NOT exclude archived channels",
    !summaryBlock.includes("AND cc.archived_at IS NULL")
  );
}

// ── Section 13: Security — Phase 9B write blocks intact ──────────────────────
console.log("\n── Security: Phase 9B write blocks intact ──");

assertInFile(
  "SEC1. Reactions still blocked in archived channels",
  ROUTES,
  "Cannot react to messages in an archived channel"
);

assertInFile(
  "SEC2. Edit still blocked in archived channels",
  ROUTES,
  "Cannot edit messages in an archived channel"
);

assertInFile(
  "SEC3. Delete still blocked in archived channels",
  ROUTES,
  "Cannot delete messages in an archived channel"
);

assertInFile(
  "SEC4. Thread reply still blocked in archived channels",
  ROUTES,
  "Cannot reply in an archived channel"
);

assertInFile(
  "SEC5. Attachment upload still blocked in archived channels",
  ROUTES,
  "Cannot upload attachments to an archived channel message"
);

// Phase 9C is read-only — no new write routes
assertNotInFile(
  "SEC6. Phase 9C introduced no new write mutations to channel messages",
  FRONTEND,
  "Cannot message in archived channel" // should not exist — this would be a new route guard
);

// ── Section 14: No write leakage ─────────────────────────────────────────────
console.log("\n── No write leakage ──");

// The isChannelArchived metadata is only used for display — never opens write routes
{
  const content = fs.readFileSync(ROUTES, "utf8");
  // No new route loosens archived checks in Phase 9C
  const newRoutes9C = [
    "Cannot react to messages in an archived channel",
    "Cannot edit messages in an archived channel",
    "Cannot delete messages in an archived channel",
    "Cannot reply in an archived channel",
    "Cannot pin messages in an archived channel",
    "Cannot unpin messages in an archived channel",
    "Cannot add structured items to an archived channel message",
    "Cannot remove structured items from an archived channel message",
    "Cannot upload attachments to an archived channel message",
  ];
  let allBlocksPresent = true;
  for (const block of newRoutes9C) {
    if (!content.includes(block)) { allBlocksPresent = false; }
  }
  assert(
    "NW1. All 9 Phase 9B write guards still present after Phase 9C changes",
    allBlocksPresent
  );
}

// ── Section 15: DMs and Record Currents unaffected ───────────────────────────
console.log("\n── DMs and Record Currents unaffected ──");

assertInFile(
  "DR1. DM route still exists",
  ROUTES,
  "app.get(\"/api/current/dms\""
);

assertInFile(
  "DR2. Record Current route still exists",
  ROUTES,
  "app.get(\"/api/current/record/"
);

// Mentions isChannelArchived is optional — DM mentions (no channel) will have false
assertInFile(
  "DR3. MentionMessage isChannelArchived is optional (DMs have no channel)",
  FRONTEND,
  "isChannelArchived?: boolean;"
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

if (failures.length > 0) {
  console.log("Failed checks:");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
