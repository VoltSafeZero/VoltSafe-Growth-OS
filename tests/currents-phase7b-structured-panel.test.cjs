#!/usr/bin/env node
/**
 * Phase 7B — Structured Items Panel: Source-Grep Tests
 * Verifies the frontend panel exists and all wiring is correct.
 */

const fs = require("fs");

let passed = 0;
let failed = 0;

function check(name, cond) {
  if (cond) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}`);
    failed++;
  }
}

const currentTsx = fs.readFileSync("client/src/pages/current.tsx", "utf8");
const recordFeed = fs.readFileSync(
  "client/src/components/current/record-current-feed.tsx",
  "utf8"
);

console.log("=== Phase 7B Structured Items Panel — Source-Grep Tests ===\n");

// ── 1. StructuredListItem interface ──────────────────────────────────────────
console.log("── 1. StructuredListItem interface (current.tsx) ──");
check("StructuredListItem interface declared", currentTsx.includes("interface StructuredListItem {"));
check("StructuredListItem has itemType field", currentTsx.includes('"decision" | "risk" | "requirement"') && currentTsx.includes("interface StructuredListItem"));
check("StructuredListItem has actionUrl field", (() => {
  const i = currentTsx.indexOf("interface StructuredListItem {");
  return i > -1 && currentTsx.slice(i, i + 600).includes("actionUrl: string | null");
})());
check("StructuredListItem has messageBody field", (() => {
  const i = currentTsx.indexOf("interface StructuredListItem {");
  return i > -1 && currentTsx.slice(i, i + 600).includes("messageBody: string | null");
})());
check("StructuredListItem has createdByName field", (() => {
  const i = currentTsx.indexOf("interface StructuredListItem {");
  return i > -1 && currentTsx.slice(i, i + 600).includes("createdByName: string | null");
})());
check("StructuredListItem has channelSlug field", (() => {
  const i = currentTsx.indexOf("interface StructuredListItem {");
  return i > -1 && currentTsx.slice(i, i + 600).includes("channelSlug: string | null");
})());

// ── 2. STRUCT_FILTER_ITEMS constant ──────────────────────────────────────────
console.log("\n── 2. Filter items constant ──");
check("STRUCT_FILTER_ITEMS constant declared", currentTsx.includes("const STRUCT_FILTER_ITEMS"));
check("STRUCT_FILTER_ITEMS includes all/decision/risk/requirement", (() => {
  const i = currentTsx.indexOf("const STRUCT_FILTER_ITEMS");
  const block = currentTsx.slice(i, i + 400);
  return block.includes('"all"') && block.includes('"decision"') && block.includes('"risk"') && block.includes('"requirement"');
})());
check("STRUCT_FILTER_ITEMS has Decisions label", currentTsx.includes('label: "Decisions"'));
check("STRUCT_FILTER_ITEMS has Risks label", currentTsx.includes('label: "Risks"'));
check("STRUCT_FILTER_ITEMS has Requirements label", currentTsx.includes('label: "Requirements"'));

// ── 3. StructuredItemsPanel component ────────────────────────────────────────
console.log("\n── 3. StructuredItemsPanel component ──");
check("StructuredItemsPanel function declared", currentTsx.includes("function StructuredItemsPanel("));
check("StructuredItemsPanel accepts selectedSlug prop", (() => {
  const i = currentTsx.indexOf("function StructuredItemsPanel(");
  return i > -1 && currentTsx.slice(i, i + 200).includes("selectedSlug: string");
})());
check("StructuredItemsPanel accepts onChannelNavigate prop", (() => {
  const i = currentTsx.indexOf("function StructuredItemsPanel(");
  return i > -1 && currentTsx.slice(i, i + 300).includes("onChannelNavigate:");
})());
check("StructuredItemsPanel uses useQuery for /api/current/structured", (() => {
  const i = currentTsx.indexOf("function StructuredItemsPanel(");
  return i > -1 && currentTsx.slice(i, i + 1200).includes('"/api/current/structured"');
})());
check("StructuredItemsPanel scope=channel filter", (() => {
  const i = currentTsx.indexOf("function StructuredItemsPanel(");
  return i > -1 && currentTsx.slice(i, i + 800).includes('"channel"') && currentTsx.slice(i, i + 800).includes('"all"');
})());
check("StructuredItemsPanel refetches every 30s", (() => {
  const i = currentTsx.indexOf("function StructuredItemsPanel(");
  return i > -1 && currentTsx.slice(i, i + 1200).includes("30_000");
})());

// ── 4. Scope toggle buttons ───────────────────────────────────────────────────
console.log("\n── 4. Scope toggle UI ──");
check("structured-scope-channel testid present", currentTsx.includes('data-testid="structured-scope-channel"'));
check("structured-scope-all testid present", currentTsx.includes('data-testid="structured-scope-all"'));
check("scope toggles between channel and all", currentTsx.includes("scope === \"channel\"") && currentTsx.includes("scope === \"all\""));

// ── 5. Filter chips ───────────────────────────────────────────────────────────
console.log("\n── 5. Filter chip UI ──");
check("structured-filter-{value} testid generated from STRUCT_FILTER_ITEMS", currentTsx.includes("`structured-filter-${value}`"));
check("filter chip uses STRUCT_FILTER_ITEMS.map", (() => {
  const i = currentTsx.indexOf("function StructuredItemsPanel(");
  return i > -1 && currentTsx.slice(i, i + 4500).includes("STRUCT_FILTER_ITEMS.map(");
})());
check("filter chip active style for decision (emerald)", (() => {
  const i = currentTsx.indexOf("function StructuredItemsPanel(");
  return i > -1 && currentTsx.slice(i, i + 2000).includes("emerald-500/15");
})());
check("filter chip active style for risk (amber)", (() => {
  const i = currentTsx.indexOf("function StructuredItemsPanel(");
  return i > -1 && currentTsx.slice(i, i + 2000).includes("amber-500/15");
})());
check("filter chip active style for requirement (purple)", (() => {
  const i = currentTsx.indexOf("function StructuredItemsPanel(");
  return i > -1 && currentTsx.slice(i, i + 2000).includes("purple-500/15");
})());

// ── 6. Item cards ─────────────────────────────────────────────────────────────
console.log("\n── 6. Item cards UI ──");
check("structured-items-list testid on scroll container", currentTsx.includes('data-testid="structured-items-list"'));
check("structured-items-grid testid on item list", currentTsx.includes('data-testid="structured-items-grid"'));
check("structured-item-{id} testid on each card", currentTsx.includes("`structured-item-${item.id}`"));
check("item card uses STRUCTURED_BADGE_STYLE", (() => {
  const i = currentTsx.indexOf("structured-items-grid");
  return i > -1 && currentTsx.slice(i, i + 2000).includes("STRUCTURED_BADGE_STYLE[item.itemType]");
})());
check("item card shows messageBody preview", (() => {
  const i = currentTsx.indexOf("structured-items-grid");
  return i > -1 && currentTsx.slice(i, i + 2000).includes("item.messageBody");
})());
check("item card shows authorName", (() => {
  const i = currentTsx.indexOf("structured-items-grid");
  return i > -1 && currentTsx.slice(i, i + 8000).includes("item.authorName");
})());
check("item card shows createdByName (marked by)", (() => {
  const i = currentTsx.indexOf("structured-items-grid");
  return i > -1 && currentTsx.slice(i, i + 8000).includes("item.createdByName");
})());
check("item card shows channelSlug source context", (() => {
  const i = currentTsx.indexOf("structured-items-grid");
  return i > -1 && currentTsx.slice(i, i + 2000).includes("item.channelSlug");
})());
check("item card shows objectType source context", (() => {
  const i = currentTsx.indexOf("structured-items-grid");
  return i > -1 && currentTsx.slice(i, i + 2000).includes("item.objectType");
})());
check("item card threadRootId shows thread context", (() => {
  const i = currentTsx.indexOf("structured-items-grid");
  return i > -1 && currentTsx.slice(i, i + 2000).includes("item.threadRootId");
})());
check("item card shows createdAt with formatTs", (() => {
  const i = currentTsx.indexOf("structured-items-grid");
  return i > -1 && currentTsx.slice(i, i + 2000).includes("formatTs(item.createdAt)");
})());
check("item card shows notes when present", (() => {
  const i = currentTsx.indexOf("structured-items-grid");
  return i > -1 && currentTsx.slice(i, i + 2000).includes("item.notes");
})());
check("structured-view-btn-{id} testid on View button", currentTsx.includes("`structured-view-btn-${item.id}`"));

// ── 7. Deep-link navigation (handleView) ──────────────────────────────────────
console.log("\n── 7. Deep-link navigation ──");
check("handleView function declared in StructuredItemsPanel", (() => {
  const i = currentTsx.indexOf("function StructuredItemsPanel(");
  return i > -1 && currentTsx.slice(i, i + 1000).includes("function handleView(");
})());
check("handleView detects /current? prefix for channel nav", (() => {
  const i = currentTsx.indexOf("function handleView(");
  return i > -1 && currentTsx.slice(i, i + 400).includes('startsWith("/current?")');
})());
check("handleView parses channel slug from URL", (() => {
  const i = currentTsx.indexOf("function handleView(");
  return i > -1 && currentTsx.slice(i, i + 400).includes('"channel"');
})());
check("handleView parses message id from URL", (() => {
  const i = currentTsx.indexOf("function handleView(");
  return i > -1 && currentTsx.slice(i, i + 400).includes('"message"');
})());
check("handleView parses thread id from URL", (() => {
  const i = currentTsx.indexOf("function handleView(");
  return i > -1 && currentTsx.slice(i, i + 400).includes('"thread"');
})());
check("handleView calls onChannelNavigate for channel items", (() => {
  const i = currentTsx.indexOf("function handleView(");
  return i > -1 && currentTsx.slice(i, i + 500).includes("onChannelNavigate(");
})());
check("handleView uses window.location.href for record items", (() => {
  const i = currentTsx.indexOf("function handleView(");
  return i > -1 && currentTsx.slice(i, i + 2000).includes("window.location.href");
})());

// ── 8. Empty / Loading / Error states ────────────────────────────────────────
console.log("\n── 8. Empty / Loading / Error states ──");
check("Loading state shows Loader2 spinner", (() => {
  const i = currentTsx.indexOf("function StructuredItemsPanel(");
  return i > -1 && currentTsx.slice(i, i + 8000).includes("isLoading") && currentTsx.slice(i, i + 8000).includes("animate-spin");
})());
check("Error state shows helpful message", (() => {
  const i = currentTsx.indexOf("function StructuredItemsPanel(");
  return i > -1 && currentTsx.slice(i, i + 8000).includes("isError") && currentTsx.slice(i, i + 8000).includes("Could not load structured items");
})());
check("Empty state for filter=all", (() => {
  const i = currentTsx.indexOf("function StructuredItemsPanel(");
  return i > -1 && currentTsx.slice(i, i + 8000).includes("No structured items yet");
})());
check("Empty state for filter=decision", (() => {
  const i = currentTsx.indexOf("function StructuredItemsPanel(");
  return i > -1 && currentTsx.slice(i, i + 8000).includes("No decisions marked yet");
})());
check("Empty state for filter=risk", (() => {
  const i = currentTsx.indexOf("function StructuredItemsPanel(");
  return i > -1 && currentTsx.slice(i, i + 8000).includes("No risks marked yet");
})());
check("Empty state for filter=requirement", (() => {
  const i = currentTsx.indexOf("function StructuredItemsPanel(");
  return i > -1 && currentTsx.slice(i, i + 8000).includes("No requirements marked yet");
})());
check("Empty state shows Bookmark icon", (() => {
  const i = currentTsx.indexOf("function StructuredItemsPanel(");
  return i > -1 && currentTsx.slice(i, i + 8000).includes("Bookmark");
})());

// ── 9. Main page view state + sidebar integration ─────────────────────────────
console.log("\n── 9. View state + sidebar wiring ──");
check("view state includes 'structured' type", currentTsx.includes('"channel" | "mentions" | "search" | "structured"'));
check("sidebar-structured testid on sidebar button", currentTsx.includes('data-testid="sidebar-structured"'));
check("sidebar Structured button sets view to structured", (() => {
  const i = currentTsx.indexOf('data-testid="sidebar-structured"');
  return i > -1 && currentTsx.slice(Math.max(0, i - 200), i + 50).includes('setView("structured")');
})());
check("sidebar Structured button shows Bookmark icon", (() => {
  const i = currentTsx.indexOf('data-testid="sidebar-structured"');
  return i > -1 && currentTsx.slice(i, i + 600).includes("Bookmark");
})());
check("sidebar Structured button has active style when view=structured", (() => {
  const i = currentTsx.indexOf('data-testid="sidebar-structured"');
  return i > -1 && currentTsx.slice(i, i + 600).includes('view === "structured"');
})());

// ── 10. Header + content view conditionals ────────────────────────────────────
console.log("\n── 10. Header + content view conditionals ──");
check("header shows Bookmark icon when view=structured", (() => {
  const i = currentTsx.indexOf('view === "structured" ? (');
  return i > -1 && currentTsx.slice(i, i + 300).includes("Bookmark") && currentTsx.slice(i, i + 300).includes("Structured Items");
})());
check("content renders StructuredItemsPanel when view=structured", (() => {
  const idx = currentTsx.lastIndexOf('view === "structured" ? (');
  return idx > -1 && currentTsx.slice(idx, idx + 300).includes("StructuredItemsPanel");
})());
check("StructuredItemsPanel receives selectedSlug", (() => {
  const i = currentTsx.indexOf("<StructuredItemsPanel");
  return i > -1 && currentTsx.slice(i, i + 200).includes("selectedSlug={selectedSlug}");
})());
check("StructuredItemsPanel onChannelNavigate sets view to channel", (() => {
  const i = currentTsx.indexOf("<StructuredItemsPanel");
  const block = currentTsx.slice(i, i + 500);
  return block.includes('setView("channel")') && block.includes("setSelectedSlug(slug)");
})());
check("StructuredItemsPanel onChannelNavigate sets threadRootId", (() => {
  const i = currentTsx.indexOf("<StructuredItemsPanel");
  return i > -1 && currentTsx.slice(i, i + 500).includes("setThreadRootId");
})());

// ── 11. Mark/unmark mutation query invalidation ───────────────────────────────
console.log("\n── 11. Mutation invalidation ──");
check("markStructuredMutation invalidates /api/current/structured", (() => {
  const i = currentTsx.indexOf("markStructuredMutation = useMutation");
  return i > -1 && currentTsx.slice(i, i + 400).includes('queryKey: ["/api/current/structured"]');
})());
check("unmarkStructuredMutation invalidates /api/current/structured", (() => {
  const i = currentTsx.indexOf("unmarkStructuredMutation = useMutation");
  return i > -1 && currentTsx.slice(i, i + 400).includes('queryKey: ["/api/current/structured"]');
})());
check("markStructuredMutation still calls invalidateFeed()", (() => {
  const i = currentTsx.indexOf("markStructuredMutation = useMutation");
  return i > -1 && currentTsx.slice(i, i + 400).includes("invalidateFeed()");
})());
check("unmarkStructuredMutation still calls invalidateFeed()", (() => {
  const i = currentTsx.indexOf("unmarkStructuredMutation = useMutation");
  return i > -1 && currentTsx.slice(i, i + 400).includes("invalidateFeed()");
})());

// ── 12. RecordStructuredPanel component ──────────────────────────────────────
console.log("\n── 12. RecordStructuredPanel (record-current-feed.tsx) ──");
check("RecordStructuredPanel function declared", recordFeed.includes("function RecordStructuredPanel("));
check("RecordStructuredPanel accepts objectType + objectId", (() => {
  const i = recordFeed.indexOf("function RecordStructuredPanel(");
  return i > -1 && recordFeed.slice(i, i + 200).includes("objectType: string") && recordFeed.slice(i, i + 200).includes("objectId: number");
})());
check("RecordStructuredPanel uses scope=record param", (() => {
  const i = recordFeed.indexOf("function RecordStructuredPanel(");
  return i > -1 && recordFeed.slice(i, i + 600).includes('scope: "record"');
})());
check("RecordStructuredPanel sends objectType + objectId in params", (() => {
  const i = recordFeed.indexOf("function RecordStructuredPanel(");
  const block = recordFeed.slice(i, i + 600);
  return block.includes("objectType,") && block.includes('objectId: String(objectId)');
})());
check("RecordStructuredPanel filter chips present", (() => {
  const i = recordFeed.indexOf("function RecordStructuredPanel(");
  return i > -1 && recordFeed.slice(i, i + 1500).includes("REC_STRUCT_FILTER_ITEMS");
})());
check("RecordStructuredPanel shows loading state", (() => {
  const i = recordFeed.indexOf("function RecordStructuredPanel(");
  return i > -1 && recordFeed.slice(i, i + 3000).includes("isLoading") && recordFeed.slice(i, i + 3000).includes("animate-spin");
})());
check("RecordStructuredPanel shows error state", (() => {
  const i = recordFeed.indexOf("function RecordStructuredPanel(");
  return i > -1 && recordFeed.slice(i, i + 3000).includes("isError") && recordFeed.slice(i, i + 3000).includes("Could not load structured items");
})());
check("RecordStructuredPanel shows empty state messages", (() => {
  const i = recordFeed.indexOf("function RecordStructuredPanel(");
  const block = recordFeed.slice(i, i + 4000);
  return block.includes("No structured items yet") && block.includes("No decisions marked yet");
})());
check("rec-structured-filter-{value} testid generated", recordFeed.includes("`rec-structured-filter-${value}`"));
check("rec-structured-items-list testid on scroll container", recordFeed.includes('data-testid="rec-structured-items-list"'));
check("rec-structured-item-{id} testid on each card", recordFeed.includes("`rec-structured-item-${item.id}`"));
check("rec-structured-view-btn-{id} testid on View button", recordFeed.includes("`rec-structured-view-btn-${item.id}`"));
check("RecordStructuredPanel View button uses window.location.href", (() => {
  const i = recordFeed.indexOf("`rec-structured-view-btn-");
  return i > -1 && recordFeed.slice(Math.max(0, i - 200), i + 100).includes("window.location.href");
})());
check("RecordStructuredPanel uses REC_STRUCTURED_BADGE_STYLE", (() => {
  const i = recordFeed.indexOf("function RecordStructuredPanel(");
  return i > -1 && recordFeed.slice(i, i + 4000).includes("REC_STRUCTURED_BADGE_STYLE");
})());
check("RecordStructuredPanel shows authorName", (() => {
  const i = recordFeed.indexOf("function RecordStructuredPanel(");
  return i > -1 && recordFeed.slice(i, i + 6000).includes("item.authorName");
})());
check("RecordStructuredPanel shows createdByName (marked by)", (() => {
  const i = recordFeed.indexOf("function RecordStructuredPanel(");
  return i > -1 && recordFeed.slice(i, i + 6000).includes("item.createdByName");
})());
check("RecordStructuredPanel uses formatDistanceToNow for dates", (() => {
  const i = recordFeed.indexOf("function RecordStructuredPanel(");
  return i > -1 && recordFeed.slice(i, i + 6000).includes("formatDistanceToNow");
})());

// ── 13. showStructured state + toggle wiring ──────────────────────────────────
console.log("\n── 13. showStructured state + toggle wiring ──");
check("showStructured state declared in RecordCurrentFeed", recordFeed.includes("const [showStructured, setShowStructured] = useState(false)"));
check("btn-structured-record testid on toggle button", recordFeed.includes('data-testid="btn-structured-record"'));
check("Structured toggle button shows Bookmark icon", (() => {
  const i = recordFeed.indexOf('data-testid="btn-structured-record"');
  return i > -1 && recordFeed.slice(i, i + 600).includes("Bookmark");
})());
check("Structured toggle button has active style when showStructured", (() => {
  const i = recordFeed.indexOf('data-testid="btn-structured-record"');
  return i > -1 && recordFeed.slice(Math.max(0, i - 300), i + 50).includes("showStructured");
})());
check("Structured toggle closes Summary panel when opening", (() => {
  const i = recordFeed.indexOf('data-testid="btn-structured-record"');
  return i > -1 && recordFeed.slice(Math.max(0, i - 300), i + 50).includes("setRecordSummaryOpen(false)");
})());
check("message list shows RecordStructuredPanel when showStructured=true", recordFeed.includes("showStructured ? (") && recordFeed.includes("<RecordStructuredPanel"));
check("RecordStructuredPanel receives objectType and objectId", (() => {
  const i = recordFeed.indexOf("<RecordStructuredPanel");
  return i > -1 && recordFeed.slice(i, i + 100).includes("objectType={objectType}") && recordFeed.slice(i, i + 100).includes("objectId={objectId}");
})());
check("search input clears showStructured when user types", recordFeed.includes("if (showStructured) setShowStructured(false)"));

// ── 14. Record feed mutation invalidation ─────────────────────────────────────
console.log("\n── 14. Record feed mutation invalidation ──");
check("record markStructuredMutation invalidates /api/current/structured", (() => {
  const i = recordFeed.indexOf("markStructuredMutation = useMutation");
  return i > -1 && recordFeed.slice(i, i + 600).includes('queryKey: ["/api/current/structured"]');
})());
check("record unmarkStructuredMutation invalidates /api/current/structured", (() => {
  const i = recordFeed.lastIndexOf("unmarkStructuredMutation = useMutation");
  return i > -1 && recordFeed.slice(i, i + 600).includes('queryKey: ["/api/current/structured"]');
})());
check("record markStructuredMutation still invalidates record messages", (() => {
  const i = recordFeed.indexOf("markStructuredMutation = useMutation");
  return i > -1 && recordFeed.slice(i, i + 400).includes('apiBase + "/messages"');
})());
check("record unmarkStructuredMutation still invalidates record messages", (() => {
  const i = recordFeed.indexOf("unmarkStructuredMutation = useMutation");
  return i > -1 && recordFeed.slice(i, i + 400).includes('apiBase + "/messages"');
})());

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Phase 7B Structured Items Panel: ${passed} passed, ${failed} failed`);
console.log(`${"─".repeat(60)}`);
if (failed > 0) process.exit(1);
