// Phase 7D: Structured Filter Count Badges — Source-Grep Tests
"use strict";
const fs = require("fs");
const path = require("path");

const CURRENT_TSX = path.join(__dirname, "../client/src/pages/current.tsx");
const RECORD_FEED = path.join(__dirname, "../client/src/components/current/record-current-feed.tsx");

const src = fs.readFileSync(CURRENT_TSX, "utf8");
const rec = fs.readFileSync(RECORD_FEED, "utf8");

let passed = 0;
let failed = 0;

function check(label, ok) {
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
  }
}

console.log("=== Phase 7D Structured Filter Count Badges — Source-Grep Tests ===\n");

// ── 1. StructuredItemsPanel: client-side counting ──────────────────────────
console.log("── 1. StructuredItemsPanel — client-side counting (current.tsx) ──");

check(
  "counts.all computed from full data",
  src.includes("all: data.length")
);
check(
  "counts.decision computed from full data",
  src.includes('decision: data.filter(i => i.itemType === "decision").length')
);
check(
  "counts.risk computed from full data",
  src.includes('risk: data.filter(i => i.itemType === "risk").length')
);
check(
  "counts.requirement computed from full data",
  src.includes('requirement: data.filter(i => i.itemType === "requirement").length')
);
check(
  "displayed computed by client-side filter",
  src.includes('const displayed = filter === "all" ? data : data.filter(i => i.itemType === filter)')
);

// ── 2. StructuredItemsPanel: no itemType in query params ──────────────────
console.log("\n── 2. StructuredItemsPanel — no itemType passed to API (current.tsx) ──");

// The params block should NOT have `if (filter !== "all") params.set("itemType", filter)` in the structured panel area
// We check that the queryKey no longer contains filter for this panel
check(
  "queryKey does not include filter (scope+slug only)",
  src.includes('queryKey: ["/api/current/structured", scope, selectedSlug]')
);
check(
  "limit raised to 200 for full dataset fetch",
  src.includes('limit: "200"') || src.includes("limit: '200'")
);

// ── 3. StructuredItemsPanel: count badge testids ─────────────────────────
console.log("\n── 3. StructuredItemsPanel — count badge testids (current.tsx) ──");

check(
  "structured-count-all testid present",
  src.includes('data-testid={`structured-count-${value}`}') ||
  src.includes("data-testid={`structured-count-all`}") ||
  src.includes('structured-count-${value}')
);
check(
  "counts[value] rendered in badge span",
  src.includes("{counts[value]}")
);
check(
  "filter chips use inline-flex with gap for badge layout",
  src.includes('inline-flex items-center gap-1.5') || src.includes('inline-flex items-center gap-1')
);

// ── 4. StructuredItemsPanel: item list uses displayed not data ────────────
console.log("\n── 4. StructuredItemsPanel — item list uses displayed (current.tsx) ──");

check(
  "displayed.map used for items list",
  src.includes("displayed.map((item) =>") || src.includes("displayed.map(item =>")
);
check(
  "displayed.length used for empty state check",
  src.includes("displayed.length === 0")
);

// ── 5. RecordStructuredPanel: client-side counting ────────────────────────
console.log("\n── 5. RecordStructuredPanel — client-side counting (record-current-feed.tsx) ──");

check(
  "recCounts.all computed from full data",
  rec.includes("all: data.length")
);
check(
  "recCounts.decision computed from full data",
  rec.includes('decision: data.filter(i => i.itemType === "decision").length')
);
check(
  "recCounts.risk computed from full data",
  rec.includes('risk: data.filter(i => i.itemType === "risk").length')
);
check(
  "recCounts.requirement computed from full data",
  rec.includes('requirement: data.filter(i => i.itemType === "requirement").length')
);
check(
  "displayed computed by client-side filter",
  rec.includes('const displayed = filter === "all" ? data : data.filter(i => i.itemType === filter)')
);

// ── 6. RecordStructuredPanel: no itemType in query params ─────────────────
console.log("\n── 6. RecordStructuredPanel — no itemType passed to API (record-current-feed.tsx) ──");

check(
  "queryKey does not include filter (record+type+id only)",
  rec.includes('queryKey: ["/api/current/structured", "record", objectType, objectId]')
);
check(
  "limit raised to 200 for full dataset fetch",
  rec.includes('limit: "200"') || rec.includes("limit: '200'")
);

// ── 7. RecordStructuredPanel: count badge testids ────────────────────────
console.log("\n── 7. RecordStructuredPanel — count badge testids (record-current-feed.tsx) ──");

check(
  "rec-structured-count-{value} testid present",
  rec.includes("rec-structured-count-${value}") ||
  rec.includes("`rec-structured-count-${value}`")
);
check(
  "recCounts[value] rendered in badge span",
  rec.includes("{recCounts[value]}")
);

// ── 8. RecordStructuredPanel: item list uses displayed not data ───────────
console.log("\n── 8. RecordStructuredPanel — item list uses displayed (record-current-feed.tsx) ──");

check(
  "displayed.map used for items list",
  rec.includes("displayed.map((item) =>") || rec.includes("displayed.map(item =>")
);
check(
  "displayed.length used for empty state check",
  rec.includes("displayed.length === 0")
);

// ── 9. Mutation invalidation still works ─────────────────────────────────
console.log("\n── 9. Mutation invalidation — still invalidates structured panel ──");

check(
  "markStructuredMutation invalidates /api/current/structured (current.tsx)",
  src.includes('queryKey: ["/api/current/structured"]')
);
check(
  "unmarkStructuredMutation invalidates /api/current/structured (current.tsx)",
  (src.match(/queryKey: \["\/api\/current\/structured"\]/g) || []).length >= 2
);
check(
  "record markStructuredMutation invalidates /api/current/structured (record feed)",
  rec.includes('queryKey: ["/api/current/structured"]')
);

// ── 10. Scope switch: queryKey changes correctly ──────────────────────────
console.log("\n── 10. Scope switch — queryKey responds to scope + selectedSlug ──");

check(
  "scope state declared in StructuredItemsPanel",
  src.includes('const [scope, setScope] = useState<"channel" | "all">("channel")')
);
check(
  "scope included in queryKey",
  src.includes('queryKey: ["/api/current/structured", scope, selectedSlug]')
);
check(
  "scope=channel sets channel param in URL",
  src.includes('params.set("channel", selectedSlug)')
);

// ── 11. Existing features preserved ──────────────────────────────────────
console.log("\n── 11. Existing features preserved ──");

check(
  "structured-scope-channel testid still present",
  src.includes('data-testid="structured-scope-channel"')
);
check(
  "structured-scope-all testid still present",
  src.includes('data-testid="structured-scope-all"')
);
check(
  "structured-filter-{value} testid still present",
  src.includes("structured-filter-${value}")
);
check(
  "structured-items-list testid still present",
  src.includes('data-testid="structured-items-list"')
);
check(
  "structured-items-grid testid still present",
  src.includes('data-testid="structured-items-grid"')
);
check(
  "structured-item-{id} testid still present",
  src.includes("structured-item-${item.id}")
);
check(
  "structured-view-btn-{id} testid still present",
  src.includes("structured-view-btn-${item.id}")
);
check(
  "item card still shows notes when present (current.tsx)",
  src.includes("item.notes &&") || src.includes("{item.notes")
);
check(
  "item card still shows actionUrl deep-link (current.tsx)",
  src.includes("item.actionUrl") && src.includes("handleView")
);
check(
  "rec-structured-filter-{value} testid still present",
  rec.includes("rec-structured-filter-${value}")
);
check(
  "rec-structured-items-list testid still present",
  rec.includes('data-testid="rec-structured-items-list"')
);
check(
  "rec-structured-item-{id} testid still present",
  rec.includes("rec-structured-item-${item.id}")
);
check(
  "rec-structured-view-btn-{id} testid still present",
  rec.includes("rec-structured-view-btn-${item.id}")
);
check(
  "item card notes still rendered in record panel",
  rec.includes("item.notes &&") || rec.includes("{item.notes")
);

console.log(
  `\n${"─".repeat(60)}\nPhase 7D Filter Count Badges: ${passed} passed, ${failed} failed\n${"─".repeat(60)}`
);
process.exit(failed > 0 ? 1 : 0);
