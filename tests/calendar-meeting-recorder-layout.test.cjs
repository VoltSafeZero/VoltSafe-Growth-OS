#!/usr/bin/env node
/**
 * Calendar & Meetings layout regression suite
 *
 * Covers the fix for:
 *  A) "Meetings & Recorder" section sitting immediately below the calendar
 *     block (not pushed down by sidebar height) — no large fixed-height
 *     spacer, structural order preserved across Month/Week/Day views.
 *  B) Meeting Recorder hero/action card — visually distinct primary CTA
 *     ("Start Recording") above a secondary "Recording History" list.
 *
 * Source-grep style (per project convention for structural/CSS invariants
 * that don't need a live browser). Run with:
 *   node tests/calendar-meeting-recorder-layout.test.cjs
 */

const fs = require("fs");

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  \u2713 ${label}`);
  passed++;
}
function fail(label, detail) {
  console.error(`  \u2717 ${label}${detail ? ` \u2014 ${detail}` : ""}`);
  failed++;
}
function read(path) {
  return fs.readFileSync(path, "utf8");
}
function must(path, pattern, label) {
  const src = read(path);
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  if (re.test(src)) ok(label);
  else fail(label, `pattern not found in ${path}`);
}
function mustNot(path, pattern, label) {
  const src = read(path);
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  if (!re.test(src)) ok(label);
  else fail(label, `forbidden pattern found in ${path}`);
}

const CAL = "client/src/pages/calendar.tsx";
const MNL = "client/src/components/meeting-notes/meeting-notes-list.tsx";

console.log("\n=== calendar.tsx: structural placement (A) ===");

// Only ONE "calendar-meeting-notes-section" mount point should exist — the
// old duplicate that lived after the sidebar (causing the big gap) must be
// gone.
{
  const src = read(CAL);
  const matches = src.match(/data-testid="calendar-meeting-notes-section"/g) || [];
  if (matches.length === 1) ok("exactly one calendar-meeting-notes-section mount point");
  else fail("exactly one calendar-meeting-notes-section mount point", `found ${matches.length}`);
}

// The Meetings & Recorder section must be inside the same flex column as the
// calendar Card, declared BEFORE the sidebar's "flex flex-col gap-3" column,
// so its vertical position is independent of sidebar height.
{
  const src = read(CAL);
  const cardIdx = src.indexOf('<Card className="border-border/50 flex-1 min-w-0">');
  const meetingIdx = src.indexOf('data-testid="calendar-meeting-notes-section"');
  const sidebarIdx = src.indexOf('<div className="flex flex-col gap-3">');
  if (cardIdx !== -1 && meetingIdx !== -1 && sidebarIdx !== -1 && cardIdx < meetingIdx && meetingIdx < sidebarIdx) {
    ok("Meetings & Recorder is declared between the calendar Card and the sidebar column");
  } else {
    fail("Meetings & Recorder is declared between the calendar Card and the sidebar column",
      `cardIdx=${cardIdx} meetingIdx=${meetingIdx} sidebarIdx=${sidebarIdx}`);
  }
}

must(CAL, /flex-1 min-w-0 flex flex-col gap-4/, "calendar column wraps Card + Meetings section in its own flex column (independent of sidebar height)");

console.log("\n=== calendar.tsx: no large fixed-height spacer ===");

mustNot(CAL, /min-h-\[(7|8|9)\d{2}px\]|min-h-\[1[0-9]{3}px\]/, "no min-h-[700px+] style spacer classes introduced");
mustNot(CAL, /style=\{\{\s*height:\s*["']\d{3,}px/, "no inline fixed pixel-height hacks");

console.log("\n=== calendar.tsx: DayView internal scroller unaffected ===");
must(CAL, /max-h-\[600px\] overflow-y-auto/, "DayView keeps its own internal scroll container (capped, not page-stretching)");

console.log("\n=== meeting-notes-list.tsx: hero recorder card (B) ===");

must(MNL, /data-testid="card-meeting-recorder-hero"/, "hero Meeting Recorder card exists");
must(MNL, /Meeting Recorder/, "hero card title text 'Meeting Recorder'");
must(MNL, /Capture, transcribe and follow up on meetings/, "hero card subtitle present");
must(MNL, /Start Recording/, "primary CTA labeled 'Start Recording'");
must(MNL, /Upload Recording/, "secondary CTA labeled 'Upload Recording'");
must(MNL, /data-testid="button-upload-recording"/, "secondary upload CTA has stable test id");
must(MNL, /data-testid="button-new-meeting-note-calendar"/, "primary CTA retains stable test id used by the create mutation");

console.log("\n=== meeting-notes-list.tsx: Recording History secondary section (C) ===");
must(MNL, /Recording History/, "'Recording History' heading present");
must(MNL, /data-testid="heading-meeting-notes-section"/, "history heading has stable test id");

// Structural order: hero card must appear BEFORE the Recording History
// heading, which must appear BEFORE the list container.
{
  const src = read(MNL);
  const heroIdx = src.indexOf('data-testid="card-meeting-recorder-hero"');
  const historyIdx = src.indexOf("Recording History");
  const listIdx = src.indexOf("{/* List */}");
  if (heroIdx !== -1 && historyIdx !== -1 && listIdx !== -1 && heroIdx < historyIdx && historyIdx < listIdx) {
    ok("structural order: hero card -> Recording History heading -> list");
  } else {
    fail("structural order: hero card -> Recording History heading -> list",
      `heroIdx=${heroIdx} historyIdx=${historyIdx} listIdx=${listIdx}`);
  }
}

// Visual distinctness: the hero card must use a stronger visual treatment
// (border/background/ring) than the plain muted history heading.
must(MNL, /className="relative overflow-hidden rounded-xl border border-primary\/30 bg-gradient-to-br[\s\S]{0,200}data-testid="card-meeting-recorder-hero"/,
  "hero card has high-contrast styling (primary-tinted border + gradient background)");
must(MNL, /text-xs font-medium text-muted-foreground uppercase tracking-wide" data-testid="heading-meeting-notes-section"/,
  "Recording History heading uses muted/secondary styling (visually subordinate to hero card)");

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
