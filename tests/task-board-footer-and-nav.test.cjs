/**
 * tests/task-board-footer-and-nav.test.cjs
 *
 * Tasks Hub — column footer spacing + floating bottom nav regression suite.
 * Source-grep tests (no live server required).
 *
 * Verifies:
 *   (A) Board row containers use `items-start` so columns are NOT stretched
 *       to equal height by flex cross-axis stretch (the root cause of the
 *       footer gap — columns default to align-items: stretch in a flex row).
 *   (B) The task-list div inside each column still has overflow-y-auto +
 *       min-h-0 (so long columns still scroll and short columns don't grow).
 *   (C) The "+ Add a task" footer button is still a normal in-flow element
 *       (no mt-auto / justify-between / absolute / sticky positioning hacks).
 *   (D) Drag/drop handlers, column header, and card rendering are preserved.
 *   (E) TaskFloatingNav component exists with all four required items:
 *       Inbox, Planner, Board (active), Switch boards.
 *   (F) The floating nav is fixed at bottom-center of the viewport.
 *   (G) Missing routes (Planner, Switch boards) are non-crashing stubs
 *       ("Coming soon" toast), not broken links or thrown errors.
 *   (H) Board item is marked active and is a no-op (already on this page).
 *   (I) Inbox item navigates to a real, existing route.
 *   (J) TaskFloatingNav is imported and rendered on the Tasks Hub page.
 *   (K) Dark/light mode safety — nav uses theme CSS variables only, no
 *       hardcoded light/dark-only colors.
 */

"use strict";

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    errors.push(label);
    failed++;
  }
}

const boardPath = path.join(__dirname, "..", "client/src/components/tasks/task-board.tsx");
const navPath = path.join(__dirname, "..", "client/src/components/tasks/task-floating-nav.tsx");
const hubPath = path.join(__dirname, "..", "client/src/pages/tasks-hub.tsx");

const boardSrc = fs.readFileSync(boardPath, "utf8");
const navSrc = fs.readFileSync(navPath, "utf8");
const hubSrc = fs.readFileSync(hubPath, "utf8");

// ── (A) Board row uses items-start, not default stretch ─────────────────────

console.log("\n[A] Board row containers use items-start (fixes footer gap)");

const boardRowMatches = boardSrc.match(/className="flex items-start gap-3 overflow-x-auto pb-4[^"]*"/g) || [];
assert(
  boardRowMatches.length >= 2,
  "Both the loading-skeleton row and the real board-container row use `flex items-start gap-3 overflow-x-auto`",
);
assert(
  !/className="flex gap-3 overflow-x-auto pb-4/.test(boardSrc),
  "No remaining board row uses plain `flex gap-3` without items-start (would re-introduce stretch)",
);

// ── (B) Task list still scrolls within tall columns ─────────────────────────

console.log("\n[B] Task list column still supports internal scrolling");

assert(
  /flex-1 p-2 space-y-2 overflow-y-auto min-h-0/.test(boardSrc),
  "Task list div keeps flex-1 + overflow-y-auto + min-h-0 (scrolls when column hits max-h cap)",
);
assert(
  /max-h-\[calc\(100vh-220px\)\]/.test(boardSrc),
  "Column still caps its own max-height so very long columns scroll instead of growing the page",
);

// ── (C) Footer button remains a normal in-flow element ──────────────────────

console.log("\n[C] Footer button has no forced-bottom layout hacks");

assert(
  !/mt-auto/.test(boardSrc),
  "No mt-auto used to fake footer placement",
);
assert(
  !/justify-between/.test(boardSrc.split("\n").filter(l => l.includes("flex flex-col") && l.includes("max-h-[calc")).join("\n")),
  "Column container does not use justify-between to position the footer",
);

// ── (D) Existing board behavior preserved ───────────────────────────────────

console.log("\n[D] Drag/drop, header, and card rendering preserved");

assert(boardSrc.includes("onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.value); }}"), "Column onDragOver handler preserved");
assert(boardSrc.includes("handleColumnDrop") || boardSrc.includes("onDrop={() => {"), "Column onDrop handler preserved");
assert(boardSrc.includes("data-testid=\"board-container\""), "board-container test id preserved");

// ── (E) TaskFloatingNav has all four required items ─────────────────────────

console.log("\n[E] TaskFloatingNav defines Inbox, Planner, Board, Switch boards");

assert(navSrc.includes('key: "inbox"') && navSrc.includes('label: "Inbox"'), "Inbox item present");
assert(navSrc.includes('key: "planner"') && navSrc.includes('label: "Planner"'), "Planner item present");
assert(navSrc.includes('key: "board"') && navSrc.includes('label: "Board"'), "Board item present");
assert(navSrc.includes('key: "switch-boards"') && navSrc.includes('label: "Switch boards"'), "Switch boards item present");

// ── (F) Fixed bottom-center positioning ──────────────────────────────────────

console.log("\n[F] Floating nav is fixed at bottom-center of the viewport");

assert(/fixed bottom-4 left-1\/2 -translate-x-1\/2/.test(navSrc), "Nav container uses fixed + bottom-4 + left-1/2 + -translate-x-1/2 (bottom-center)");
assert(/z-40/.test(navSrc), "Nav container has an explicit z-index so it floats above page content");

// ── (G) Non-crashing stubs for missing routes ────────────────────────────────

console.log("\n[G] Planner and Switch boards are non-crashing stubs");

assert(navSrc.includes('toast({ title: "Coming soon"'), "Missing-route items show a 'Coming soon' toast instead of navigating to a broken route");
assert(
  (navSrc.match(/case "planner":/g) || []).length === 1 && (navSrc.match(/case "switch-boards":/g) || []).length === 1,
  "Both planner and switch-boards cases are explicitly handled in the click switch (no default/fallthrough crash)",
);

// ── (H) Board item is active + no-op ─────────────────────────────────────────

console.log("\n[H] Board item is marked active and does not navigate away");

assert(/isActive = item\.key === "board"/.test(navSrc), "Board item is computed as the active item");
assert(/case "board":[\s\S]{0,120}break;/.test(navSrc), "Board click handler is a no-op (break with no navigate/toast call)");

// ── (I) Inbox navigates to a real route ──────────────────────────────────────

console.log("\n[I] Inbox item navigates to an existing route");

assert(navSrc.includes('navigate("/gmail")'), "Inbox item calls navigate('/gmail'), a real registered route");

// ── (J) Wired into the Tasks Hub page ────────────────────────────────────────

console.log("\n[J] TaskFloatingNav is imported and rendered on the Tasks Hub page");

assert(hubSrc.includes('import { TaskFloatingNav } from "@/components/tasks/task-floating-nav";'), "TaskFloatingNav is imported in tasks-hub.tsx");
assert(hubSrc.includes("<TaskFloatingNav />"), "TaskFloatingNav is rendered in the Tasks Hub page JSX");

// ── (K) Dark/light mode safety ────────────────────────────────────────────────

console.log("\n[K] Floating nav uses theme CSS variables, not hardcoded colors");

assert(
  /bg-background\/95/.test(navSrc) && /border-border\/50/.test(navSrc),
  "Nav pill uses bg-background/border-border theme tokens (adapts automatically to dark/light mode)",
);
assert(
  !/#[0-9a-fA-F]{3,6}/.test(navSrc),
  "No hardcoded hex colors in the floating nav component",
);
assert(
  /bg-primary text-primary-foreground/.test(navSrc),
  "Active (Board) item uses theme-aware bg-primary/text-primary-foreground, not a hardcoded color",
);

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(56)}`);
console.log(`Tasks Hub footer + floating nav: ${passed} passed, ${failed} failed`);
if (errors.length > 0) {
  console.error("\nFailed checks:");
  errors.forEach(e => console.error(`  • ${e}`));
  process.exit(1);
}
process.exit(0);
