#!/usr/bin/env node
/**
 * CURRENTS Workspace Shell — Phase 5A regression tests
 *
 * Covers:
 *   N1–N8  : nav-config checks (CURRENTS top-level, below Today, label, no dup)
 *   S1–S6  : shell + backdrop component source checks
 *   A1–A2  : App.tsx wiring checks
 *   R1–R2  : reduced-motion + accessibility markers
 *   P1–P2  : performance / no-infinite-loop markers
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
    // Find the currents section block and check for Zap icon reference
    const idx = nav.indexOf('id: "currents"');
    if (idx === -1) return false;
    const block = nav.slice(idx, idx + 300);
    return block.includes("Zap");
  })());

ok("N5: CURRENTS NOT inside Work items (removed from Work group)",
  (() => {
    const workIdx = nav.indexOf('id: "work"');
    if (workIdx === -1) return true; // no work section = trivially ok
    // Find end of work section (next top-level section start)
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
console.log("\n=== S: Shell + backdrop components ===");

ok("S1: Shell file exists and exports CurrentsWorkspaceShell",
  shell.includes("CurrentsWorkspaceShell"));

ok("S2: Shell imports CurrentsWaterflowBackdrop",
  shell.includes("CurrentsWaterflowBackdrop"));

ok("S3: Shell renders backdrop inside relative container",
  shell.includes("relative") && shell.includes("CurrentsWaterflowBackdrop"));

ok("S4: Shell content layer is z-[1] (renders on top of backdrop)",
  shell.includes("z-[1]"));

ok("S5: Shell has data-testid='currents-workspace-shell'",
  shell.includes('data-testid="currents-workspace-shell"'));

ok("S6: Backdrop file exists and exports CurrentsWaterflowBackdrop",
  backdrop.includes("CurrentsWaterflowBackdrop"));

ok("S7: Backdrop has data-testid='currents-waterflow-backdrop'",
  backdrop.includes('data-testid="currents-waterflow-backdrop"'));

ok("S8: Backdrop uses aria-hidden for decorative role",
  backdrop.includes('aria-hidden="true"') || backdrop.includes("aria-hidden={true}"));

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
console.log("\n=== R: Accessibility / reduced-motion ===");

ok("R1: Backdrop CSS includes prefers-reduced-motion media query",
  backdrop.includes("prefers-reduced-motion"));

ok("R2: Backdrop pauses animations via animation-play-state under prefers-reduced-motion",
  (() => {
    // Phase 5B: gentle infinite CSS loops — reduced-motion freezes them with
    // animation-play-state: paused (no animation: none needed).
    const hasReducedBlock = backdrop.includes("prefers-reduced-motion");
    const hasPaused = backdrop.includes("animation-play-state: paused") ||
                      backdrop.includes("animation-play-state:paused");
    return hasReducedBlock && hasPaused;
  })());

// ── P: Performance markers ────────────────────────────────────────────────────
console.log("\n=== P: Performance — pure CSS, no JS animation ===");

ok("P1: Backdrop uses pure CSS animation (no JS loops)",
  (() => {
    // Phase 5B: animation is driven entirely by CSS keyframes (background-position,
    // transform, opacity) — all GPU-composited.  No JS timer or RAF loop allowed.
    const noJsLoop = !backdrop.includes("setInterval") &&
                     !backdrop.includes("requestAnimationFrame") &&
                     !backdrop.includes("useEffect");
    // Must still declare at least one @keyframes block
    const hasKeyframes = backdrop.includes("@keyframes");
    return noJsLoop && hasKeyframes;
  })());

ok("P2: No setInterval or requestAnimationFrame loop in backdrop",
  !backdrop.includes("setInterval") && !backdrop.includes("requestAnimationFrame"));

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
