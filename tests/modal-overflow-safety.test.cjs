/**
 * Modal / Popup Horizontal Overflow Safety — regression test suite
 *
 * Rule under test: "No horizontal scrolling inside popups. Ever. Text wraps,
 * content stays inside the modal, users only scroll vertically."
 *
 * Covers: shared Dialog/AlertDialog/Sheet/Drawer primitives, the global CSS
 * safety net, and the specific "Save Email to Cortex" modal that motivated
 * this fix (long subjects/snippets were overflowing horizontally).
 *
 * Run: node tests/modal-overflow-safety.test.cjs
 */

"use strict";

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, condition) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(name);
    console.error(`  FAIL: ${name}`);
  }
}

function readFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

// ── 1. Global CSS safety net ────────────────────────────────────────────────

const css = readFile("client/src/index.css");

console.log("\n[1] Global CSS — no horizontal scroll backstop");

ok("index.css sets overflow-x hidden on [role=dialog]", /\[role="dialog"\][\s\S]{0,200}overflow-x:\s*hidden/.test(css));
ok("index.css sets overflow-x hidden on [role=alertdialog]", css.includes('[role="alertdialog"]'));
ok("index.css caps dialog/alertdialog max-width to viewport", css.includes("max-width: 100vw"));
ok("index.css forces min-width: 0 on dialog descendants (flex overflow fix)", /\[role="dialog"\]\s*\*/.test(css) && css.includes("min-width: 0"));
ok("index.css caps img/table/pre max-width inside modals", css.includes("[role=\"dialog\"] img") || css.includes('[role="dialog"] img'));

// ── 2. Shared Dialog primitive ──────────────────────────────────────────────

const dialog = readFile("client/src/components/ui/dialog.tsx");

console.log("\n[2] Shared Dialog (dialog.tsx)");

ok("DialogContent sets overflow-x-hidden", dialog.includes("overflow-x-hidden"));
ok("DialogContent wraps long words (break-words)", dialog.includes("break-words"));
ok("DialogContent uses overflow-wrap anywhere for URLs/long tokens", dialog.includes("[overflow-wrap:anywhere]"));
ok("DialogContent clamps max-width to viewport", dialog.includes("max-w-[calc(100vw-2rem)]"));
ok("DialogContent still allows vertical scrolling", dialog.includes("overflow-y-auto"));
ok("Drag handle still present (no regression to draggable behavior)", dialog.includes('data-testid="dialog-drag-handle"'));
ok("Resize handle still present (no regression to resizable behavior)", dialog.includes('data-testid="dialog-resize-handle"'));
ok("Close button still present and clickable", dialog.includes("DialogPrimitive.Close") && dialog.includes("<X"));
ok("Fullscreen/expand toggle still present", dialog.includes('data-testid="button-toggle-fullscreen"'));

// ── 3. Shared AlertDialog primitive ────────────────────────────────────────

const alertDialog = readFile("client/src/components/ui/alert-dialog.tsx");

console.log("\n[3] Shared AlertDialog (alert-dialog.tsx)");

ok("AlertDialogContent sets overflow-x-hidden", alertDialog.includes("overflow-x-hidden"));
ok("AlertDialogContent wraps long words (break-words)", alertDialog.includes("break-words"));
ok("AlertDialogContent allows vertical scrolling with height cap", alertDialog.includes("overflow-y-auto") && alertDialog.includes("max-h-[90dvh]"));
ok("AlertDialogContent clamps max-width to viewport", alertDialog.includes("max-w-[calc(100vw-2rem)]"));

// ── 4. Shared Sheet primitive ───────────────────────────────────────────────

const sheet = readFile("client/src/components/ui/sheet.tsx");

console.log("\n[4] Shared Sheet (sheet.tsx)");

ok("SheetContent sets overflow-x-hidden", sheet.includes("overflow-x-hidden"));
ok("SheetContent allows vertical scrolling", sheet.includes("overflow-y-auto"));
ok("SheetContent wraps long words", sheet.includes("break-words"));
ok("Left/right sheet variants clamp width to viewport", sheet.includes("max-w-[calc(100vw-2rem)]"));

// ── 5. Shared Drawer primitive ──────────────────────────────────────────────

const drawer = readFile("client/src/components/ui/drawer.tsx");

console.log("\n[5] Shared Drawer (drawer.tsx)");

ok("DrawerContent sets overflow-x-hidden", drawer.includes("overflow-x-hidden"));
ok("DrawerContent allows vertical scrolling with height cap", drawer.includes("overflow-y-auto") && drawer.includes("max-h-[90dvh]"));
ok("DrawerContent wraps long words", drawer.includes("break-words"));

// ── 6. Save Email to Cortex modal — the reported regression ────────────────

const cortexModal = readFile("client/src/components/inbox/save-to-cortex-modal.tsx");

console.log("\n[6] Save Email to Cortex modal — specific fix");

ok("Header icon+text row constrains text column with min-w-0/flex-1", /min-w-0 flex-1[\s\S]{0,80}DialogTitle/.test(cortexModal));
ok("Modal title wraps instead of overflowing", cortexModal.includes("DialogTitle className=\"text-base font-semibold break-words"));
ok("Modal description wraps (whitespace-normal + break-words)", /DialogDescription className="[^"]*whitespace-normal[^"]*break-words/.test(cortexModal));
ok("Email subject line no longer uses truncate (must wrap, not clip)", !/text-foreground truncate/.test(cortexModal));
ok("Email subject line wraps with whitespace-normal + break-words", /text-sm font-medium text-foreground whitespace-normal break-words/.test(cortexModal));
ok("Sender/date line wraps safely", /text-xs text-muted-foreground mt-0\.5 whitespace-normal break-words/.test(cortexModal));
ok("Email snippet still line-clamped (vertical) but also wraps", /line-clamp-2 whitespace-normal break-words/.test(cortexModal));
ok("Email preview card row can wrap onto multiple lines (flex-wrap)", /items-start justify-between gap-2 flex-wrap/.test(cortexModal));
ok("'In Cortex' badge stays flex-shrink-0 so it never gets squeezed off-card", /In Cortex[\s\S]{0,40}<\/Badge>/.test(cortexModal) && cortexModal.includes("flex-shrink-0 text-[10px] bg-cyan-500/15 text-cyan-400 border-cyan-500/30 gap-1"));
ok("'Already saved to Cortex' text column has min-w-0/flex-1", /flex items-start gap-2 min-w-0 flex-1/.test(cortexModal));
ok("Update button stays flex-shrink-0 inside modal bounds", /border-cyan-500\/30 text-cyan-400 hover:bg-cyan-500\/10 flex-shrink-0/.test(cortexModal));
ok("DialogContent for this modal still caps height and scrolls vertically", cortexModal.includes('max-h-[90vh] overflow-y-auto'));

// ── Results ──────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);

if (failures.length > 0) {
  console.error("\nFailed checks:");
  failures.forEach(f => console.error(`  • ${f}`));
  process.exit(1);
}

console.log("\n✓ All modal overflow safety checks passed");
process.exit(0);
