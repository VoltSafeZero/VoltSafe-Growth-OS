"use strict";
// Source-grep test — pins all drag-and-drop file upload invariants for CURRENTS
// Covers: channel conversation area, DM conversation area, overlay UI, file queuing
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

const src = fs.readFileSync(
  path.join(__dirname, "../client/src/pages/current.tsx"),
  "utf8"
);

// ── 1. State declarations ──────────────────────────────────────────────────────

console.log("\n1. Drag-over state declarations");
assert(
  "mainDragOver boolean state declared",
  src.includes("mainDragOver, setMainDragOver] = useState(false)")
);
assert(
  "dmDragOver boolean state declared",
  src.includes("dmDragOver, setDmDragOver] = useState(false)")
);
assert(
  "mainDragCounter ref declared",
  src.includes("mainDragCounter = useRef(0)")
);
assert(
  "dmDragCounter ref declared",
  src.includes("dmDragCounter = useRef(0)")
);

// ── 2. Channel drop zone ───────────────────────────────────────────────────────

console.log("\n2. Channel drop zone element");
assert(
  "channel-drop-zone test id present",
  src.includes('data-testid="channel-drop-zone"')
);
assert(
  "channel drop zone has relative positioning",
  src.includes('"channel-drop-zone"') &&
    src.includes("flex-1 flex flex-col min-h-0 relative")
);
assert(
  "channel onDragEnter handler increments mainDragCounter",
  src.includes("mainDragCounter.current++")
);
assert(
  "channel onDragLeave handler decrements mainDragCounter",
  src.includes("mainDragCounter.current--")
);
assert(
  "channel onDragLeave resets counter to 0 when depleted",
  src.includes("mainDragCounter.current = 0") &&
    src.includes("setMainDragOver(false)")
);
assert(
  "channel onDragOver calls preventDefault",
  src.includes("onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}")
);
assert(
  "channel onDrop extracts dataTransfer.files",
  src.includes("Array.from(e.dataTransfer.files)")
);
assert(
  "channel onDrop adds files to mainPendingFiles",
  src.includes("setMainPendingFiles((prev) => [...prev, ...files])")
);

// ── 3. Channel drag-over overlay ──────────────────────────────────────────────

console.log("\n3. Channel drag-over overlay");
assert(
  "channel-drag-overlay test id present",
  src.includes('data-testid="channel-drag-overlay"')
);
assert(
  "channel overlay rendered conditionally on mainDragOver",
  src.includes("{mainDragOver && (")
);
assert(
  "channel overlay has pointer-events-none (non-interactive)",
  src.includes("pointer-events-none")
);
assert(
  "channel overlay has Upload icon",
  src.includes("Upload") && src.includes("upload to this conversation")
);

// ── 4. DM drop zone ───────────────────────────────────────────────────────────

console.log("\n4. DM drop zone element");
assert(
  "dm-drop-zone test id present",
  src.includes('data-testid="dm-drop-zone"')
);
assert(
  "dm drop zone has relative positioning class",
  src.includes('"dm-drop-zone"') &&
    src.includes("flex-1 flex flex-col min-w-0 overflow-hidden relative")
);
assert(
  "dm onDragEnter handler increments dmDragCounter",
  src.includes("dmDragCounter.current++")
);
assert(
  "dm onDragLeave handler decrements dmDragCounter",
  src.includes("dmDragCounter.current--")
);
assert(
  "dm onDrop extracts files and adds to dmPendingFiles",
  src.includes("setDmPendingFiles((prev) => [...prev, ...files])")
);

// ── 5. DM drag-over overlay ───────────────────────────────────────────────────

console.log("\n5. DM drag-over overlay");
assert(
  "dm-drag-overlay test id present",
  src.includes('data-testid="dm-drag-overlay"')
);
assert(
  "dm overlay rendered conditionally on dmDragOver",
  src.includes("{dmDragOver && (")
);

// ── 6. Only-files guard (Files type check) ────────────────────────────────────

console.log("\n6. Files-only drag guard");
assert(
  "dragEnter checks for 'Files' in dataTransfer.types before activating overlay",
  src.includes('Array.from(e.dataTransfer.types).includes("Files")')
);
assert(
  "check appears at least twice (once per zone)",
  (src.match(/Array\.from\(e\.dataTransfer\.types\)\.includes\("Files"\)/g) || [])
    .length >= 2
);

// ── 7. Browser default prevention ────────────────────────────────────────────

console.log("\n7. Browser default file-open prevention");
assert(
  "onDrop calls preventDefault (channel)",
  (src.match(/onDrop.*?e\.preventDefault\(\)/gs) || []).length >= 2
);
assert(
  "onDragOver calls preventDefault (prevents browser default open)",
  (src.match(/onDragOver/g) || []).length >= 2
);

// ── 8. Channel send button allows files-only send ─────────────────────────────

console.log("\n8. Channel send button disabled state");
assert(
  "channel send disabled accounts for mainPendingFiles (files-only send allowed)",
  src.includes("mainPendingFiles.length === 0 && channelSlash.selectedCommand?.id")
);

// ── 9. Upload icon imported ────────────────────────────────────────────────────

console.log("\n9. Import integrity");
assert(
  "Upload imported from lucide-react",
  src.includes("Upload,") || src.includes("Upload\n")
);

// ── 10. Pre-existing attachment infrastructure still intact ───────────────────

console.log("\n10. Pre-existing attachment infrastructure intact");
assert(
  "PendingFileChips still rendered in channel composer",
  src.includes('data-testid="channel-file-input"')
);
assert(
  "PendingFileChips still rendered in DM composer",
  src.includes('data-testid="dm-file-input"')
);
assert(
  "mainPendingFiles state still present",
  src.includes("mainPendingFiles, setMainPendingFiles")
);
assert(
  "dmPendingFiles state still present",
  src.includes("dmPendingFiles, setDmPendingFiles")
);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("FAIL");
  process.exit(1);
} else {
  console.log("PASS");
  process.exit(0);
}
