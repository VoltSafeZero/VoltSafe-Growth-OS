/**
 * Regression tests: CURRENTS emoji picker scroll-dismiss bug fix
 *
 * Root cause: document scroll listener (capture phase) was closing the picker
 * on ANY scroll event, including scrolls inside the emoji grid itself.
 *
 * Fix: onScroll handler now checks whether the scroll originated inside
 * pickerRef before calling setOpen(false).
 */

"use strict";
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "../client/src/pages/current.tsx");
const src = fs.readFileSync(SRC, "utf8");

let pass = 0;
let fail = 0;

function check(label, ok) {
  if (ok) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.error(`  ✗ ${label}`);
    fail++;
  }
}

// ── Section 1: onScroll guard ─────────────────────────────────────────────────
console.log("\n§1 onScroll handler checks pickerRef before closing");

check(
  "onScroll receives event param (not zero-arg)",
  /function onScroll\(e:\s*Event\)/.test(src)
);

check(
  "onScroll returns early when scroll target is inside pickerRef",
  /pickerRef\.current\.contains\(e\.target as Node\)\s*\)\s*return/.test(src)
);

check(
  "setOpen\(false\) only called after the pickerRef guard",
  (() => {
    // The guard line must appear BEFORE setOpen(false) inside the onScroll fn
    const fnMatch = src.match(/function onScroll\(e:\s*Event\)\s*\{([\s\S]*?)setOpen\(false\)/);
    if (!fnMatch) return false;
    const body = fnMatch[1];
    return /pickerRef\.current\.contains/.test(body);
  })()
);

check(
  "scroll listener still registered on document with capture:true",
  /document\.addEventListener\("scroll",\s*onScroll,\s*true\)/.test(src)
);

check(
  "scroll listener cleanup still present",
  /document\.removeEventListener\("scroll",\s*onScroll,\s*true\)/.test(src)
);

// ── Section 2: mousedown outside-click still works ────────────────────────────
console.log("\n§2 Outside-click (mousedown) guard preserved");

check(
  "mousedown listener registered on document",
  /document\.addEventListener\("mousedown",\s*onDown\)/.test(src)
);

check(
  "onDown checks pickerRef.contains before closing",
  /pickerRef\.current\s*&&\s*!pickerRef\.current\.contains\(e\.target as Node\)/.test(src)
);

check(
  "onDown checks triggerRef.contains before closing",
  /triggerRef\.current\s*&&\s*!triggerRef\.current\.contains\(e\.target as Node\)/.test(src)
);

// ── Section 3: Emoji grid scroll container ────────────────────────────────────
console.log("\n§3 Emoji grid scroll container is self-contained");

check(
  "emoji grid has overflow-y-auto class",
  /overflow-y-auto flex-1/.test(src)
);

check(
  "emoji grid has maxHeight style to cap visible area",
  /maxHeight:\s*2[0-9]{2}/.test(src)
);

check(
  "emoji grid has overscrollBehavior: contain to prevent chaining",
  /overscrollBehavior:\s*["']contain["']/.test(src)
);

check(
  "emoji grid has onWheel stopPropagation to prevent background page scroll",
  /onWheel=\{.*e\.stopPropagation\(\)/.test(src)
);

// ── Section 4: picker is portal-rendered and uses fixed position ──────────────
console.log("\n§4 Picker is portal-rendered at document.body");

check(
  "createPortal used for picker overlay",
  /createPortal\(/.test(src)
);

check(
  "picker container uses position:fixed",
  /position:\s*["']fixed["']/.test(src)
);

check(
  "picker has high z-index (9999)",
  /zIndex:\s*9999/.test(src)
);

// ── Section 5: picker ref attached ───────────────────────────────────────────
console.log("\n§5 pickerRef attached to picker container");

check(
  "pickerRef declared as useRef<HTMLDivElement>",
  /pickerRef\s*=\s*useRef<HTMLDivElement>/.test(src)
);

check(
  "pickerRef attached to picker div via ref={pickerRef}",
  /ref=\{pickerRef\}/.test(src)
);

// ── Section 6: critical functionality preserved ───────────────────────────────
console.log("\n§6 Emoji picker core functionality preserved");

check(
  "selectEmoji still calls handleEmoji (emoji insertion)",
  /function selectEmoji[\s\S]*?handleEmoji\(emoji\)/.test(src)
);

check(
  "selectEmoji still calls setOpen(false) on selection",
  /function selectEmoji[\s\S]*?setOpen\(false\)/.test(src)
);

check(
  "search input still wired (onChange sets search state)",
  /onChange=\{\(e\)\s*=>\s*setSearch\(e\.target\.value\)\}/.test(src)
);

check(
  "category tabs still rendered",
  /allCategories\.map\(/.test(src)
);

check(
  "custom emoji upload button still present",
  /Upload custom emoji/.test(src)
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`emoji-picker-scroll: ${pass} passed, ${fail} failed`);

if (fail > 0) process.exit(1);
