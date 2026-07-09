/**
 * Regression tests: Meeting Notes Capture Panel stuck "Stopping..." bug fix
 *
 * Root cause: isDone only checked for ["done","cancelled","error"] but the backend
 * sets status to "completed" when processing finishes. So isDone=false, isProcessing=false,
 * and the "Stopping..." button rendered forever because isStopping (recorderState="stopped")
 * had no isDone guard.
 *
 * Fix 1: Add "completed" and "failed" to the isDone status list.
 * Fix 2: Derive isStopping as !isDone && (recorder is stopping/stopped).
 */

"use strict";
const fs = require("fs");
const path = require("path");

const PANEL = path.join(__dirname, "../client/src/components/meeting-notes/meeting-note-capture-panel.tsx");
const src = fs.readFileSync(PANEL, "utf8");

let pass = 0;
let fail = 0;

function check(label, ok) {
  if (ok) { console.log(`  ✓ ${label}`); pass++; }
  else     { console.error(`  ✗ ${label}`); fail++; }
}

// ── Section 1: isDone includes all terminal statuses ──────────────────────────
console.log("\n§1 isDone includes all terminal backend statuses");

check(
  'isDone includes "done"',
  /isDone\s*=\s*\[[\s\S]*?"done"/.test(src)
);
check(
  'isDone includes "completed" (the actual backend terminal status)',
  /isDone\s*=\s*\[[\s\S]*?"completed"/.test(src)
);
check(
  'isDone includes "failed"',
  /isDone\s*=\s*\[[\s\S]*?"failed"/.test(src)
);
check(
  'isDone includes "cancelled"',
  /isDone\s*=\s*\[[\s\S]*?"cancelled"/.test(src)
);
check(
  'isDone includes "error"',
  /isDone\s*=\s*\[[\s\S]*?"error"/.test(src)
);
check(
  "isDone checks note.status via .includes()",
  /isDone\s*=\s*\[[\s\S]*?\]\.includes\(note\.status\)/.test(src)
);

// ── Section 2: isStopping guarded by !isDone ─────────────────────────────────
console.log("\n§2 isStopping is gated by !isDone");

check(
  "isStopping definition includes !isDone guard",
  /const isStopping\s*=\s*!isDone/.test(src)
);
check(
  "isStopping still checks recorderState === 'stopping'",
  /isStopping[\s\S]*?recorderState\s*===\s*["']stopping["']/.test(src)
);
check(
  "isStopping still checks recorderState === 'stopped'",
  /isStopping[\s\S]*?recorderState\s*===\s*["']stopped["']/.test(src)
);

// ── Section 3: Completed meeting does not render Stop/Stopping UI ─────────────
console.log("\n§3 Completed meeting cannot render active capture UI");

check(
  "Stop/Start button block gated by !isDone",
  /\{!isDone\s*&&\s*isSupported\s*&&\s*!isProcessing\s*&&/.test(src) ||
  /!isDone\s*&&\s*isSupported\s*&&\s*!isProcessing/.test(src)
);
check(
  '"Stopping…" button label gated by isStopping or stopMutation.isPending',
  // Source: {isStopping || stopMutation.isPending ? "Stopping…" : "Stop Recording"}
  /isStopping\s*\|\|\s*stopMutation\.isPending/.test(src) &&
  /["']Stopping[\u2026\.]+["']/.test(src)
);
check(
  '"Flushing final chunk…" indicator gated by isStopping',
  /isStopping.*Flushing|Flushing[\s\S]*?isStopping/.test(src)
);

// ── Section 4: isDone renders the timestamps section ─────────────────────────
console.log("\n§4 isDone state shows done-state UI");

check(
  "Done state timestamps block gated by isDone",
  /\{isDone\s*&&\s*note\.startedAt/.test(src)
);
check(
  "Done state block contains Clock icon for timestamps",
  /isDone[\s\S]{0,300}Clock/.test(src)
);

// ── Section 5: Processing state (the in-between state) ───────────────────────
console.log("\n§5 Processing state (between stop and completion)");

check(
  'isProcessing checks note.status === "processing"',
  /isProcessing\s*=\s*note\.status\s*===\s*["']processing["']/.test(src)
);
check(
  "Processing status indicator gated by !isActivelyRecording && !isStopping",
  /isProcessing\s*&&\s*!isActivelyRecording\s*&&\s*!isStopping/.test(src)
);

// ── Section 6: Core recording functionality preserved ────────────────────────
console.log("\n§6 Core recording functionality preserved");

check(
  "startRecording still called in startMutation.onSuccess",
  /startMutation[\s\S]*?startRecording\(note\.id\)/.test(src)
);
check(
  "stopRecording still wired to handleStop",
  /handleStop[\s\S]*?stopRecording\(note\.id/.test(src) ||
  /stopRecording\(note\.id.*onStopped/.test(src)
);
check(
  "stopMutation.mutate() still called as onStopped callback",
  /stopMutation\.mutate\(\)/.test(src)
);
check(
  "consent checkbox still present",
  /checkbox-consent/.test(src)
);
check(
  "Consent recorded indicator still present",
  /Consent recorded/.test(src)
);

// ── Section 7: Logic simulation ───────────────────────────────────────────────
console.log("\n§7 Simulated state logic");

// Simulate the isDone and isStopping derivation inline
function simulateState(noteStatus, recorderState) {
  const isDone = ["done", "completed", "failed", "cancelled", "error"].includes(noteStatus);
  const isStopping = !isDone && (recorderState === "stopping" || recorderState === "stopped");
  const isProcessing = noteStatus === "processing";
  const showStopBlock = !isDone && true /* isSupported */ && !isProcessing;
  return { isDone, isStopping, isProcessing, showStopBlock };
}

const afterComplete = simulateState("completed", "stopped");
check(
  'status="completed" + recorder="stopped": isDone=true',
  afterComplete.isDone === true
);
check(
  'status="completed" + recorder="stopped": isStopping=false',
  afterComplete.isStopping === false
);
check(
  'status="completed" + recorder="stopped": showStopBlock=false',
  afterComplete.showStopBlock === false
);

const duringStop = simulateState("recording", "stopping");
check(
  'status="recording" + recorder="stopping": isStopping=true (normal)',
  duringStop.isStopping === true
);
check(
  'status="recording" + recorder="stopping": showStopBlock=true (button visible)',
  duringStop.showStopBlock === true
);

const duringProcess = simulateState("processing", "stopped");
check(
  // During the processing window the recorder just stopped — isStopping=true so
  // "Flushing final chunk…" shows briefly. showStopBlock=false (isProcessing hides the button block).
  'status="processing" + recorder="stopped": showStopBlock=false (button block hidden by isProcessing)',
  duringProcess.showStopBlock === false
);
check(
  'status="processing" + recorder="stopped": isDone=false (still transitioning)',
  duringProcess.isDone === false
);

const afterFailed = simulateState("failed", "stopped");
check(
  'status="failed" + recorder="stopped": isDone=true',
  afterFailed.isDone === true
);
check(
  'status="failed" + recorder="stopped": isStopping=false',
  afterFailed.isStopping === false
);

const afterDone = simulateState("done", "stopped");
check(
  'status="done" + recorder="stopped": isDone=true (backwards compat)',
  afterDone.isDone === true
);

const afterCancelled = simulateState("cancelled", "stopped");
check(
  'status="cancelled" + recorder="stopped": isDone=true',
  afterCancelled.isDone === true
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(55)}`);
console.log(`meeting-note-capture-stuck: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
