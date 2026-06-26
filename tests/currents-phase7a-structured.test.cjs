// Phase 7A — Structured Operating Memory: source-grep tests
// Validates routes, DB migration, and UI wiring without live HTTP.

const fs = require("fs");
const path = require("path");

const routesPath = path.join(__dirname, "../server/routes.ts");
const seedPath = path.join(__dirname, "../server/seed-production.ts");
const currentTsxPath = path.join(__dirname, "../client/src/pages/current.tsx");
const recordFeedPath = path.join(__dirname, "../client/src/components/current/record-current-feed.tsx");

const routes = fs.readFileSync(routesPath, "utf8");
const seed = fs.readFileSync(seedPath, "utf8");
const currentTsx = fs.readFileSync(currentTsxPath, "utf8");
const recordFeed = fs.readFileSync(recordFeedPath, "utf8");

let passed = 0;
let failed = 0;

function check(label, cond) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

console.log("=== Phase 7A Structured Items — Source-Grep Tests ===");

// ── 1. DB Migration ────────────────────────────────────────────────────────────
console.log("\n── 1. DB Migration (seed-production.ts) ──");
check("current_structured_items table created", seed.includes("current_structured_items"));
check("message_id column declared", seed.includes("message_id") && seed.includes("current_structured_items"));
check("item_type CHECK constraint (decision|risk|requirement)", seed.includes("decision") && seed.includes("risk") && seed.includes("requirement") && seed.includes("current_structured_items"));
check("UNIQUE(message_id, item_type) constraint", seed.includes("UNIQUE") && seed.includes("message_id") && seed.includes("item_type"));
check("created_by column declared", seed.includes("created_by") && seed.includes("current_structured_items"));
check("channel_id column declared in structured table", seed.includes("channel_id") && seed.includes("current_structured_items"));
check("object_type column declared", seed.includes("object_type") && seed.includes("current_structured_items"));
check("thread_root_id column declared", seed.includes("thread_root_id") && seed.includes("current_structured_items"));

// ── 2. Backend Routes ──────────────────────────────────────────────────────────
console.log("\n── 2. Backend Routes (routes.ts) ──");
check("POST /api/current/messages/:id/structured route declared", routes.includes('app.post("/api/current/messages/:id/structured"'));
check("DELETE /api/current/messages/:id/structured/:itemType route declared", routes.includes('app.delete("/api/current/messages/:id/structured/:itemType"'));
check("GET /api/current/structured route declared", routes.includes('app.get("/api/current/structured"'));
check("VALID_STRUCTURED_TYPES set defined", routes.includes("VALID_STRUCTURED_TYPES") && routes.includes("new Set"));
check("decision/risk/requirement in VALID_STRUCTURED_TYPES", routes.includes("'decision'") && routes.includes("'risk'") && routes.includes("'requirement'"));
check("ON CONFLICT upsert for mark", routes.includes("ON CONFLICT") && routes.includes("message_id, item_type"));
check("POST route validates itemType with VALID_STRUCTURED_TYPES", routes.includes("VALID_STRUCTURED_TYPES.has(itemType)"));
check("DELETE route validates itemType with VALID_STRUCTURED_TYPES", routes.includes("VALID_STRUCTURED_TYPES.has(String(req.params.itemType)") || routes.includes("VALID_STRUCTURED_TYPES.has(itemType)"));
check("requireAuth on POST structured route", (() => {
  const i = routes.indexOf('app.post("/api/current/messages/:id/structured"');
  return i > -1 && routes.slice(i, i + 100).includes("requireAuth");
})());
check("requireAuth on DELETE structured route", (() => {
  const i = routes.indexOf('app.delete("/api/current/messages/:id/structured/:itemType"');
  return i > -1 && routes.slice(i, i + 100).includes("requireAuth");
})());
check("GET /api/current/structured supports itemType filter", routes.includes("itemType") && routes.includes("VALID_STRUCTURED_TYPES.has"));
check("GET /api/current/structured supports scope=channel filter", routes.includes("scope === \"channel\"") || routes.includes("scope === 'channel'"));
check("GET /api/current/structured supports scope=record filter", routes.includes("scope === \"record\"") || routes.includes("scope === 'record'"));

// ── 3. Structured items batch-fetched in message GETs ─────────────────────────
console.log("\n── 3. structuredItems batch-fetch in message GET routes ──");
check("channel messages GET fetches structured items", routes.includes("current_structured_items WHERE message_id = ANY"));
check("structuredItems field in channel messages response", routes.includes("structuredItems: siMap.get") || routes.includes("m.structuredItems = siMap.get"));
check("record messages GET fetches structured items", (() => {
  const occurrences = (routes.match(/current_structured_items WHERE message_id = ANY/g) || []).length;
  return occurrences >= 2;
})());
check("thread GET fetches structured items and returns them on root+replies", routes.includes("addSI") && routes.includes("root: addSI"));

// ── 4. Frontend types (current.tsx) ───────────────────────────────────────────
console.log("\n── 4. Frontend types (current.tsx) ──");
check("StructuredItem interface declared", currentTsx.includes("interface StructuredItem"));
check("StructuredItem has itemType field", currentTsx.includes("itemType: 'decision' | 'risk' | 'requirement'"));
check("Message interface has structuredItems field", currentTsx.includes("structuredItems?: StructuredItem[]"));
check("STRUCTURED_BADGE_STYLE map declared", currentTsx.includes("STRUCTURED_BADGE_STYLE"));
check("STRUCTURED_DOT_STYLE map declared", currentTsx.includes("STRUCTURED_DOT_STYLE"));
check("Bookmark icon imported", currentTsx.includes("Bookmark") && currentTsx.includes("from \"lucide-react\""));
check("DropdownMenu imported", currentTsx.includes("DropdownMenu") && currentTsx.includes("dropdown-menu"));

// ── 5. MessageActionBar (current.tsx) ─────────────────────────────────────────
console.log("\n── 5. MessageActionBar (current.tsx) ──");
check("MessageActionBar accepts structuredItems prop", currentTsx.includes("structuredItems?: StructuredItem[]") && currentTsx.includes("MessageActionBar"));
check("MessageActionBar accepts onMarkStructured prop", currentTsx.includes("onMarkStructured?: (itemType: string) => void"));
check("MessageActionBar accepts onUnmarkStructured prop", currentTsx.includes("onUnmarkStructured?: (itemType: string) => void"));
check("Mark as DropdownMenu rendered in MessageActionBar", currentTsx.includes("Mark as") || currentTsx.includes("Mark as…"));
check("data-testid btn-mark-structured present", currentTsx.includes('data-testid="btn-mark-structured"'));
check("data-testid mark-as-decision present", currentTsx.includes('data-testid={`mark-as-${type}`}') || currentTsx.includes('data-testid="mark-as-decision"'));

// ── 6. MessageRow (current.tsx) ───────────────────────────────────────────────
console.log("\n── 6. MessageRow (current.tsx) ──");
check("MessageRow accepts onMarkStructured prop", currentTsx.includes("onMarkStructured?: (messageId: number, itemType: string) => void"));
check("MessageRow accepts onUnmarkStructured prop", currentTsx.includes("onUnmarkStructured?: (messageId: number, itemType: string) => void"));
check("MessageRow renders structured badges", currentTsx.includes("structured-badge-") || currentTsx.includes("structuredItems!.map"));
check("Structured badge uses STRUCTURED_BADGE_STYLE", currentTsx.includes("STRUCTURED_BADGE_STYLE[si.itemType]"));
check("MessageActionBar receives structuredItems from message", currentTsx.includes("structuredItems={message.structuredItems}"));
check("MessageActionBar receives onMarkStructured from MessageRow", currentTsx.includes("onMarkStructured={onMarkStructured ? (t) => onMarkStructured(message.id, t) : undefined}"));

// ── 7. Main component mutations (current.tsx) ─────────────────────────────────
console.log("\n── 7. Main component mutations (current.tsx) ──");
check("markStructuredMutation declared in main component", currentTsx.includes("markStructuredMutation") && currentTsx.includes("useMutation"));
check("unmarkStructuredMutation declared in main component", currentTsx.includes("unmarkStructuredMutation") && currentTsx.includes("useMutation"));
check("POST /api/current/messages/:id/structured called in mutation", currentTsx.includes("/api/current/messages/${messageId}/structured"));
check("DELETE /api/current/messages/:id/structured/:type called", currentTsx.includes("/api/current/messages/${messageId}/structured/${itemType}") || currentTsx.includes("/api/current/messages/${mid}/structured/${itemType}"));
check("Main feed MessageRow uses onMarkStructured", currentTsx.includes("markStructuredMutation.mutate({ messageId: mid, itemType })"));
check("Main feed MessageRow uses onUnmarkStructured", currentTsx.includes("unmarkStructuredMutation.mutate({ messageId: mid, itemType })"));
check("ThreadPanel root MessageRow has onMarkStructured", (() => {
  // Find the MessageRow that renders `root`, not the InlineEditRow
  // The MessageRow immediately precedes onMarkStructured within the root branch
  const marker = "message={root}\n              grouped={false}";
  const i = currentTsx.indexOf(marker);
  return i > -1 && currentTsx.slice(i, i + 800).includes("onMarkStructured");
})());
check("ThreadPanel reply MessageRow has onMarkStructured", (() => {
  const i = currentTsx.lastIndexOf("onMarkStructured={(mid, itemType)");
  return i > -1;
})());

// ── 8. record-current-feed.tsx ────────────────────────────────────────────────
console.log("\n── 8. record-current-feed.tsx ──");
check("StructuredItem interface in record feed", recordFeed.includes("interface StructuredItem"));
check("RecordMessage has structuredItems field", recordFeed.includes("structuredItems?: StructuredItem[]"));
check("Bookmark icon imported in record feed", recordFeed.includes("Bookmark"));
check("DropdownMenu imported in record feed", recordFeed.includes("DropdownMenu") && recordFeed.includes("dropdown-menu"));
check("MessageItem accepts onMarkStructured", recordFeed.includes("onMarkStructured?: (msgId: number, itemType: string) => void"));
check("MessageItem accepts onUnmarkStructured", recordFeed.includes("onUnmarkStructured?: (msgId: number, itemType: string) => void"));
check("Structured badges rendered in MessageItem", recordFeed.includes("record-structured-badge-") || recordFeed.includes("structuredItems!.map"));
check("REC_STRUCTURED_BADGE_STYLE declared", recordFeed.includes("REC_STRUCTURED_BADGE_STYLE"));
check("Mark as dropdown in MessageItem hover bar", recordFeed.includes("mark-structured-btn-") || recordFeed.includes("onMarkStructured || onUnmarkStructured"));
check("data-testid mark-structured-btn present", recordFeed.includes("mark-structured-btn-"));
check("markStructuredMutation declared in RecordCurrentFeed", recordFeed.includes("markStructuredMutation") && recordFeed.includes("useMutation"));
check("unmarkStructuredMutation declared in RecordCurrentFeed", recordFeed.includes("unmarkStructuredMutation"));
check("Main MessageItem call passes onMarkStructured", (() => {
  const i = recordFeed.indexOf("messages.map(msg => (");
  return i > -1 && recordFeed.slice(i, i + 800).includes("onMarkStructured");
})());
check("ThreadPanel MessageItem call passes onMarkStructured", (() => {
  const i = recordFeed.indexOf("allMsgs.map((m, i)");
  return i > -1 && recordFeed.slice(i, i + 800).includes("onMarkStructured");
})());

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Phase 7A Structured Items: ${passed} passed, ${failed} failed`);
console.log(`${"─".repeat(60)}`);
if (failed > 0) process.exit(1);
