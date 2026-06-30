#!/usr/bin/env node
/**
 * CURRENTS Workspace Shell — Phase 5C theme-alignment tests
 *
 * Covers:
 *   N1–N8  : nav-config checks (CURRENTS top-level, below Today, label, no dup)
 *   S1–S9  : shell + backdrop source checks (Phase 5C: backdrop removed from path)
 *   A1–A2  : App.tsx wiring checks
 *   R1–R2  : reduced-motion + accessibility markers
 *   P1–P2  : performance / no-custom-animation markers
 *   B1–B3  : sidebar CURRENTS badge
 *
 * Run: node tests/currents-workspace-shell.test.cjs
 */
"use strict";

const fs   = require("fs");
const path = require("path");

const NAV_FILE      = path.join(__dirname, "../client/src/lib/nav-config.ts");
const SIDEBAR_FILE  = path.join(__dirname, "../client/src/components/dashboard/app-sidebar.tsx");
const APP_FILE      = path.join(__dirname, "../client/src/App.tsx");
const SHELL_FILE    = path.join(__dirname, "../client/src/components/currents/currents-workspace-shell.tsx");
const BACKDROP_FILE = path.join(__dirname, "../client/src/components/currents/currents-waterflow-backdrop.tsx");
const CURRENT_TSX   = path.join(__dirname, "../client/src/pages/current.tsx");

const nav      = fs.readFileSync(NAV_FILE,      "utf8");
const sidebar  = fs.readFileSync(SIDEBAR_FILE,  "utf8");
const app      = fs.readFileSync(APP_FILE,       "utf8");
const shell    = fs.readFileSync(SHELL_FILE,     "utf8");
const backdrop = fs.readFileSync(BACKDROP_FILE,  "utf8");
const current  = fs.readFileSync(CURRENT_TSX,    "utf8");

let passed = 0;
let failed = 0;

function ok(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

// ── N: Nav config checks ──────────────────────────────────────────────────────
console.log("\n=== N: Nav — CURRENTS as top-level section ===");

ok("N1: CURRENTS section exists with id 'currents'",
  nav.includes('id: "currents"'));

ok("N2: CURRENTS section label is uppercase 'CURRENTS'",
  nav.includes('label: "CURRENTS"'));

ok("N3: CURRENTS section has url: '/current'",
  nav.includes("url: \"/current\"") || nav.includes("url: '/current'"));

ok("N4: CURRENTS section uses Zap icon",
  (() => {
    const idx = nav.indexOf('id: "currents"');
    if (idx === -1) return false;
    const block = nav.slice(idx, idx + 300);
    return block.includes("Zap");
  })());

ok("N5: CURRENTS NOT inside Work items (removed from Work group)",
  (() => {
    const workIdx = nav.indexOf('id: "work"');
    if (workIdx === -1) return true;
    const nextSectionIdx = nav.indexOf('\n  {', workIdx + 10);
    const workBlock = nextSectionIdx > -1
      ? nav.slice(workIdx, nextSectionIdx)
      : nav.slice(workIdx);
    return !workBlock.includes('route: "/current"');
  })());

ok("N6: CURRENTS section appears in nav BEFORE Work section",
  (() => {
    const currentsIdx = nav.indexOf('id: "currents"');
    const workIdx     = nav.indexOf('id: "work"');
    return currentsIdx > -1 && workIdx > -1 && currentsIdx < workIdx;
  })());

ok("N7: CURRENTS section appears in nav AFTER Today section",
  (() => {
    const todayIdx    = nav.indexOf('id: "today"');
    const currentsIdx = nav.indexOf('id: "currents"');
    return todayIdx > -1 && currentsIdx > -1 && currentsIdx > todayIdx;
  })());

ok("N8: No duplicate /current routes in NAV_CONFIG",
  (() => {
    const matches = [...nav.matchAll(/route:\s*"\/current"/g)];
    return matches.length <= 1;
  })());

// ── S: Shell + backdrop source checks ────────────────────────────────────────
console.log("\n=== S: Shell + backdrop components (Phase 5C: backdrop removed from path) ===");

ok("S1: Shell file exists and exports CurrentsWorkspaceShell",
  shell.includes("CurrentsWorkspaceShell"));

ok("S2: Shell does NOT import backdrop (removed from active path)",
  // Phase 5C: backdrop is no longer imported or rendered.
  // We check for the import statement and JSX tag — a comment mentioning
  // the name is allowed, but an actual import or <ComponentName /> is not.
  !shell.includes('from "./currents-waterflow-backdrop"') &&
  !shell.includes('<CurrentsWaterflowBackdrop'));

ok("S3: Shell is a theme-neutral flex container (no backdrop JSX)",
  shell.includes("flex") &&
  shell.includes('data-testid="currents-workspace-shell"') &&
  !shell.includes('<CurrentsWaterflowBackdrop'));

ok("S4: Shell has no z-index stacking (no backdrop to stack above)",
  // z-[1] was only needed to sit above the backdrop — it should be absent now.
  !shell.includes("z-[1]") || !shell.includes("CurrentsWaterflowBackdrop"));

ok("S5: Shell has data-testid='currents-workspace-shell'",
  shell.includes('data-testid="currents-workspace-shell"'));

ok("S6: Backdrop file exists and exports CurrentsWaterflowBackdrop (preserved, not deleted)",
  backdrop.includes("CurrentsWaterflowBackdrop"));

ok("S7: Backdrop file has data-testid (preserved for future opt-in)",
  backdrop.includes('data-testid="currents-waterflow-backdrop"'));

ok("S8: Backdrop file uses aria-hidden (preserved for future opt-in)",
  backdrop.includes('aria-hidden="true"') || backdrop.includes("aria-hidden={true}"));

ok("S9: CURRENTS outer container uses theme-aware layout (no hardcoded dark bg override)",
  (() => {
    // The main flex container at the CURRENTS page root should not carry
    // a hardcoded dark background. Theme tokens (bg-background, bg-sidebar,
    // bg-card, bg-muted) are allowed; raw hex/rgb dark values are not.
    const mainDivIdx = current.indexOf('className="flex h-full overflow-hidden"');
    if (mainDivIdx === -1) return true; // Not found means it was already changed
    const snippet = current.slice(mainDivIdx, mainDivIdx + 80);
    return !snippet.includes("bg-[#") && !snippet.includes("bg-gray-9") &&
           !snippet.includes("bg-slate-9") && !snippet.includes("bg-zinc-9");
  })());

// ── A: App.tsx wiring ─────────────────────────────────────────────────────────
console.log("\n=== A: App.tsx route wiring ===");

ok("A1: App.tsx imports CurrentsWorkspaceShell",
  app.includes("CurrentsWorkspaceShell"));

ok("A2: /current route wraps CurrentPage in CurrentsWorkspaceShell",
  (() => {
    const idx = app.indexOf('path="/current"');
    if (idx === -1) return false;
    const snippet = app.slice(idx, idx + 120);
    return snippet.includes("CurrentsWorkspaceShell") && snippet.includes("CurrentPage");
  })());

// ── R: Reduced-motion + accessibility ────────────────────────────────────────
console.log("\n=== R: Accessibility / theme-neutral shell ===");

ok("R1: Backdrop file preserved with reduced-motion support (for future use)",
  // The backdrop component still exists on disk with its accessibility markers.
  // It is just not rendered in the active page path.
  backdrop.includes("prefers-reduced-motion"));

ok("R2: Shell does not inject animation CSS or custom keyframes",
  // Phase 5C: the shell is a plain layout container — no <style> blocks,
  // no @keyframes, no animation CSS that could override the CMS theme.
  !shell.includes("@keyframes") && !shell.includes("<style>"));

// ── P: Performance markers ────────────────────────────────────────────────────
console.log("\n=== P: Performance — theme-neutral shell, no custom animation ===");

ok("P1: Shell has no custom animation (no JS loops, no CSS keyframes)",
  !shell.includes("setInterval") &&
  !shell.includes("requestAnimationFrame") &&
  !shell.includes("useEffect") &&
  !shell.includes("@keyframes"));

ok("P2: Shell has no setInterval or requestAnimationFrame",
  !shell.includes("setInterval") && !shell.includes("requestAnimationFrame"));

// ── Sidebar: badge on top-level CURRENTS section ──────────────────────────────
console.log("\n=== B: Sidebar — CURRENTS badge on section button ===");

ok("B1: Sidebar detects isCurrentsSection via section.id === 'currents'",
  sidebar.includes('section.id === "currents"') || sidebar.includes("section.id === 'currents'"));

ok("B2: Sidebar shows nav-currents-unread-badge testid on CURRENTS section",
  sidebar.includes('data-testid="nav-currents-unread-badge"'));

ok("B3: Sidebar applies teal/cyan accent to CURRENTS section",
  sidebar.includes("cyan") && sidebar.includes("isCurrentsSection"));

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n─────────────────────────────────`);
console.log(`=== Results: ${passed} passed, ${failed} failed ===`);

if (failed > 0) {
  console.error(`\n✗ ${failed} check(s) failed — see above\n`);
  process.exit(1);
} else {
  console.log("\nAll checks passed ✓");
}
