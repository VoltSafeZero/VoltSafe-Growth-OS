/**
 * Phase 7E — Export Structured Items to CSV: Source-Grep Tests
 * Pins the CSV export feature for both StructuredItemsPanel and RecordStructuredPanel.
 */

"use strict";
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(
  path.join(__dirname, "../client/src/pages/current.tsx"),
  "utf8"
);
const rec = fs.readFileSync(
  path.join(__dirname, "../client/src/components/current/record-current-feed.tsx"),
  "utf8"
);

let passed = 0;
let failed = 0;
function check(label, result) {
  if (result) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

console.log("=== Phase 7E CSV Export — Source-Grep Tests ===\n");

// ── 1. CSV helper — csvEscapeField ────────────────────────────────────────────
console.log("── 1. csvEscapeField helper (current.tsx) ──");

check(
  "csvEscapeField function declared in current.tsx",
  src.includes("function csvEscapeField(")
);
check(
  "null/undefined → empty string",
  src.includes("val == null ? \"\" : String(val)")
);
check(
  "formula injection: =+-@\\t prefix guard",
  src.includes('"=+-@\\t".includes(s[0])') || src.includes("\"=+-@\\t\".includes(s[0])")
);
check(
  "formula injection: prefix with single quote",
  /s = ['"]'['"] \+ s/.test(src) || src.includes("s = \"'\" + s") || src.includes("s = \\x27 + s")
);
check(
  "double-quote escaping (replace quotes with doubled quotes)",
  src.includes('s.replace(/"/g, \'""\')')
);
check(
  "wraps field in double-quotes when needed",
  src.includes("'\"' + s.replace") || src.includes('"\\\"" + s.replace') || /'"' \+ s\.replace/.test(src)
);
check(
  "triggers quoting on comma in value",
  src.includes('s.includes(",")') || src.includes("s.includes(',')") 
);
check(
  "triggers quoting on newline in value",
  src.includes('s.includes("\\n")') || src.includes("s.includes('\\n')")
);

// ── 2. CSV helper — downloadCsv ───────────────────────────────────────────────
console.log("\n── 2. downloadCsv helper (current.tsx) ──");

check(
  "downloadCsv function declared in current.tsx",
  src.includes("function downloadCsv(")
);
check(
  "builds CSV via map+join with CRLF",
  src.includes('join(",")).join("\\r\\n")') || src.includes("join(',')").length > 0
);
check(
  "creates Blob with text/csv MIME type",
  src.includes('type: "text/csv;charset=utf-8;"')
);
check(
  "creates object URL and triggers click",
  src.includes("URL.createObjectURL(blob)") && src.includes("a.click()")
);
check(
  "revokes object URL after download",
  src.includes("URL.revokeObjectURL(url)")
);
check(
  "sets a.download to filename",
  src.includes("a.download = filename")
);

// ── 3. StructuredItemsPanel — export function ─────────────────────────────────
console.log("\n── 3. StructuredItemsPanel — handleExportCsv (current.tsx) ──");

check(
  "handleExportCsv declared inside StructuredItemsPanel",
  (() => {
    const panelStart = src.indexOf("function StructuredItemsPanel(");
    const panelEnd = src.indexOf("\nfunction ", panelStart + 1);
    const block = src.slice(panelStart, panelEnd);
    return block.includes("function handleExportCsv()");
  })()
);
check(
  "filename uses displaySlug(selectedSlug) for channel scope",
  src.includes("displaySlug(selectedSlug)")
);
check(
  "filename uses 'all' for all-currents scope",
  src.includes('"all" : "all"') || src.includes("\"all\" : \"all\"") ||
  (() => {
    const i = src.indexOf("function handleExportCsv()");
    const block = src.slice(i, i + 1000);
    return block.includes('"all"') && block.includes("scopePart");
  })()
);
check(
  "filename includes filter part (decisions/risks/requirements/all)",
  (() => {
    const i = src.indexOf("function handleExportCsv()");
    const block = src.slice(i, i + 1000);
    return block.includes("filterPart") && (block.includes('"decisions"') || block.includes('filter + "s"'));
  })()
);
check(
  "filename pattern: voltsafe-currents-structured-...",
  src.includes("`voltsafe-currents-structured-${scopePart}-${filterPart}-${date}.csv`")
);
check(
  "CSV headers include Type column",
  (() => {
    const i = src.indexOf("function handleExportCsv()");
    const block = src.slice(i, i + 2000);
    return block.includes('"Type"');
  })()
);
check(
  "CSV headers include Message Preview column",
  (() => {
    const i = src.indexOf("function handleExportCsv()");
    const block = src.slice(i, i + 2000);
    return block.includes('"Message Preview"');
  })()
);
check(
  "CSV headers include Notes column",
  (() => {
    const i = src.indexOf("function handleExportCsv()");
    const block = src.slice(i, i + 2000);
    return block.includes('"Notes"');
  })()
);
check(
  "CSV headers include Action URL column",
  (() => {
    const i = src.indexOf("function handleExportCsv()");
    const block = src.slice(i, i + 2000);
    return block.includes('"Action URL"');
  })()
);
check(
  "CSV headers include Thread Root ID column",
  (() => {
    const i = src.indexOf("function handleExportCsv()");
    const block = src.slice(i, i + 2000);
    return block.includes('"Thread Root ID"');
  })()
);
check(
  "rows use displayed (filtered) items, not raw data",
  (() => {
    const i = src.indexOf("function handleExportCsv()");
    const block = src.slice(i, i + 2000);
    return block.includes("displayed.map(");
  })()
);
check(
  "calls downloadCsv with headers+rows and filename",
  (() => {
    const i = src.indexOf("function handleExportCsv()");
    const block = src.slice(i, i + 2000);
    return block.includes("downloadCsv([headers, ...rows]");
  })()
);

// ── 4. StructuredItemsPanel — export button UI ────────────────────────────────
console.log("\n── 4. StructuredItemsPanel — export button UI (current.tsx) ──");

check(
  "structured-export-csv testid present",
  src.includes('data-testid="structured-export-csv"')
);
check(
  "export button disabled when displayed.length === 0",
  src.includes("disabled={displayed.length === 0}")
);
check(
  "export button calls handleExportCsv on click",
  src.includes("onClick={handleExportCsv}")
);
check(
  "export button has tooltip title",
  src.includes('title="Export visible structured items"')
);
check(
  "Download icon used in export button",
  src.includes("<Download className=")
);
check(
  "export button uses ml-auto for right-alignment",
  src.includes('"ml-auto inline-flex') || src.includes("ml-auto")
);
check(
  "Download imported from lucide-react in current.tsx",
  src.includes("Download,") || src.includes("Download\n")
);

// ── 5. RecordStructuredPanel — CSV helpers ────────────────────────────────────
console.log("\n── 5. RecordStructuredPanel — recCsvEscapeField + recDownloadCsv (record-current-feed.tsx) ──");

check(
  "recCsvEscapeField declared in record-current-feed.tsx",
  rec.includes("function recCsvEscapeField(")
);
check(
  "recDownloadCsv declared in record-current-feed.tsx",
  rec.includes("function recDownloadCsv(")
);
check(
  "formula injection guard in recCsvEscapeField",
  (() => {
    const i = rec.indexOf("function recCsvEscapeField(");
    const block = rec.slice(i, i + 500);
    return block.includes('"=+-@') && block.includes("\"'\" + s");
  })()
);
check(
  "Blob + click download in recDownloadCsv",
  (() => {
    const i = rec.indexOf("function recDownloadCsv(");
    const block = rec.slice(i, i + 500);
    return block.includes("URL.createObjectURL") && block.includes("a.click()");
  })()
);
check(
  "Download imported from lucide-react in record-current-feed.tsx",
  rec.includes("Download,") || rec.includes("Download\n")
);

// ── 6. RecordStructuredPanel — export function ────────────────────────────────
console.log("\n── 6. RecordStructuredPanel — handleRecExportCsv (record-current-feed.tsx) ──");

check(
  "handleRecExportCsv declared in RecordStructuredPanel",
  rec.includes("function handleRecExportCsv()")
);
check(
  "record filename pattern: voltsafe-currents-structured-{type}-{id}-...",
  rec.includes("`voltsafe-currents-structured-${objectType}-${objectId}-${filterPart}-${date}.csv`")
);
check(
  "record export uses displayed items",
  (() => {
    const i = rec.indexOf("function handleRecExportCsv(");
    const block = rec.slice(i, i + 2000);
    return block.includes("displayed.map(");
  })()
);
check(
  "record export headers include Type",
  (() => {
    const i = rec.indexOf("function handleRecExportCsv(");
    const block = rec.slice(i, i + 2000);
    return block.includes('"Type"');
  })()
);
check(
  "record export headers include Action URL",
  (() => {
    const i = rec.indexOf("function handleRecExportCsv(");
    const block = rec.slice(i, i + 2000);
    return block.includes('"Action URL"');
  })()
);
check(
  "record export headers include Record Type and Record ID",
  (() => {
    const i = rec.indexOf("function handleRecExportCsv(");
    const block = rec.slice(i, i + 2000);
    return block.includes('"Record Type"') && block.includes('"Record ID"');
  })()
);
check(
  "record export calls recDownloadCsv",
  (() => {
    const i = rec.indexOf("function handleRecExportCsv(");
    const block = rec.slice(i, i + 2000);
    return block.includes("recDownloadCsv([headers, ...rows]");
  })()
);

// ── 7. RecordStructuredPanel — export button UI ───────────────────────────────
console.log("\n── 7. RecordStructuredPanel — export button UI (record-current-feed.tsx) ──");

check(
  "rec-structured-export-csv testid present",
  rec.includes('data-testid="rec-structured-export-csv"')
);
check(
  "record export button disabled when displayed.length === 0",
  (() => {
    const i = rec.indexOf('data-testid="rec-structured-export-csv"');
    const block = rec.slice(Math.max(0, i - 200), i + 200);
    return block.includes("disabled={displayed.length === 0}");
  })()
);
check(
  "record export button calls handleRecExportCsv",
  rec.includes("onClick={handleRecExportCsv}")
);
check(
  "record export button has tooltip title",
  (() => {
    const i = rec.indexOf('data-testid="rec-structured-export-csv"');
    const block = rec.slice(Math.max(0, i - 300), i + 300);
    return block.includes('title="Export visible structured items"');
  })()
);
check(
  "Download icon used in record export button",
  (() => {
    const i = rec.indexOf('data-testid="rec-structured-export-csv"');
    const block = rec.slice(i, i + 600);
    return block.includes("<Download ");
  })()
);
check(
  "record export button uses ml-auto for right-alignment",
  (() => {
    const i = rec.indexOf('data-testid="rec-structured-export-csv"');
    const block = rec.slice(Math.max(0, i - 100), i + 200);
    return block.includes("ml-auto");
  })()
);

// ── 8. No backend export route ────────────────────────────────────────────────
console.log("\n── 8. No backend export route ──");

const rts = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");
check(
  "no /api/current/structured/export route in routes.ts",
  !rts.includes("/api/current/structured/export") && !rts.includes("structured/export")
);
check(
  "no CSV export route for /api/current/structured in routes.ts",
  !rts.includes("/api/current/structured/export") &&
  !rts.includes("current/structured.*csv") &&
  !rts.includes("/current/export")
);

// ── 9. Existing Phase 7D regressions ─────────────────────────────────────────
console.log("\n── 9. Phase 7D regressions still intact ──");

check(
  "count badges still present (structured-count-{value})",
  src.includes('data-testid={`structured-count-${value}`}') ||
  src.includes('"structured-count-all"') ||
  src.includes('structured-count-')
);
check(
  "displayed.map still used for items list",
  src.includes("displayed.map((item) =>")
);
check(
  "rec count badges still present (rec-structured-count-{value})",
  rec.includes('data-testid={`rec-structured-count-${value}`}') ||
  rec.includes('"rec-structured-count-all"') ||
  rec.includes('rec-structured-count-')
);
check(
  "rec displayed.map still used for items list",
  rec.includes("displayed.map((item) =>")
);
check(
  "Phase 7D thread invalidation still intact",
  (() => {
    const lines = src.split("\n");
    const matchLines = lines.filter(l =>
      l.includes("apiRequest") &&
      l.includes("/structured") &&
      l.includes("invalidateThread()") &&
      l.includes('"/api/current/structured"')
    );
    return matchLines.length >= 2;
  })()
);

console.log(
  `\n${"─".repeat(60)}\nPhase 7E CSV Export: ${passed} passed, ${failed} failed\n${"─".repeat(60)}`
);
process.exit(failed > 0 ? 1 : 0);
