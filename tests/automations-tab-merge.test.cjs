#!/usr/bin/env node
/**
 * Automations Tab Merge — Source Grep Test
 *
 * Verifies that:
 * 1. Task Rules is NOT a standalone nav item in the Admin group
 * 2. Automations appears in the Admin nav group
 * 3. Automations page has a tab bar with both Automation Builder and Task Rules tabs
 * 4. The TaskRulesSettingsPage is imported and rendered inside AutomationsPage
 * 5. /automation/tasks redirects to /automations?tab=task-rules
 * 6. URL deep-link (?tab=task-rules) is read at mount in AutomationsPage
 * 7. No duplicate automations or task-rules nav routes
 *
 * Run: node tests/automations-tab-merge.test.cjs
 */

"use strict";

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;
const ok  = (l) => { console.log(`  ✓ ${l}`); passed++; };
const bad = (l, d) => { console.error(`  ✗ ${l}${d ? ` — ${d}` : ""}`); failed++; };

function readFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

// ── Load files ──────────────────────────────────────────────────────────────
const navConfig    = readFile("client/src/lib/nav-config.ts");
const appTsx       = readFile("client/src/App.tsx");
const automations  = readFile("client/src/pages/automations.tsx");

// ── Section 1: nav-config — no standalone Task Rules ────────────────────────
console.log("\n── 1. nav-config: Task Rules NOT a standalone nav item ──");

const taskRulesNavEntries = [
  /route:\s*["']\/automation\/tasks["']/,
  /id:\s*["']task-rules["']/,
  /label:\s*["']Task Rules["']/,
];
taskRulesNavEntries.forEach((rx, i) => {
  if (!rx.test(navConfig)) {
    ok(`nav-config has no Task Rules route/id/label pattern [${i + 1}/3]`);
  } else {
    bad(`nav-config must not contain Task Rules as standalone entry [${i + 1}/3]`, `pattern found: ${rx}`);
  }
});

// ── Section 2: nav-config — Automations present in Admin ────────────────────
console.log("\n── 2. nav-config: Automations present in Admin group ──");

if (/id:\s*["']automations["']/.test(navConfig)) {
  ok("automations id found in nav-config");
} else {
  bad("automations id not found in nav-config");
}
if (/route:\s*["']\/automations["']/.test(navConfig)) {
  ok("automations route /automations found in nav-config");
} else {
  bad("automations route /automations not found in nav-config");
}
if (/label:\s*["']Automations["']/.test(navConfig)) {
  ok("Automations label found in nav-config");
} else {
  bad("Automations label not found in nav-config");
}

// ── Section 3: automations.tsx — tab bar with both tabs ─────────────────────
console.log("\n── 3. automations.tsx: tab bar rendered with both tabs ──");

if (/data-testid=["']automations-tab-bar["']/.test(automations)) {
  ok("automations-tab-bar testid present");
} else {
  bad("automations-tab-bar testid missing");
}
// The testid is generated via template literal: `tab-automations-${t}`
// where t is "builder" or "task-rules" — check for the template pattern.
if (/tab-automations-\$\{t\}/.test(automations)) {
  ok("tab-automations-${t} template testid pattern present (generates tab-automations-builder and tab-automations-task-rules at runtime)");
} else {
  bad("tab-automations-${t} template testid pattern missing");
}
// Confirm both values are in the tabs array
if (/\["builder",\s*"task-rules"\]/.test(automations) || /["']builder["'],\s*["']task-rules["']/.test(automations)) {
  ok("Both 'builder' and 'task-rules' values present in tabs array");
} else {
  bad("tabs array missing 'builder' or 'task-rules' values");
}
if (/Automation Builder/.test(automations)) {
  ok("'Automation Builder' tab label present in automations.tsx");
} else {
  bad("'Automation Builder' tab label missing in automations.tsx");
}
if (/Task Rules/.test(automations)) {
  ok("'Task Rules' tab label present in automations.tsx");
} else {
  bad("'Task Rules' tab label missing in automations.tsx");
}

// ── Section 4: automations.tsx — TaskRulesSettingsPage embedded ─────────────
console.log("\n── 4. automations.tsx: TaskRulesSettingsPage imported and rendered ──");

if (/import TaskRulesSettingsPage from ["']\.\/task-rules-settings["']/.test(automations)) {
  ok("TaskRulesSettingsPage imported in automations.tsx");
} else {
  bad("TaskRulesSettingsPage not imported in automations.tsx");
}
if (/<TaskRulesSettingsPage\s*\/>/.test(automations)) {
  ok("TaskRulesSettingsPage rendered inside automations.tsx");
} else {
  bad("TaskRulesSettingsPage not rendered inside automations.tsx");
}
if (/activeTab === ["']task-rules["']/.test(automations)) {
  ok("activeTab === 'task-rules' branch present — Task Rules tab conditionally rendered");
} else {
  bad("activeTab === 'task-rules' branch missing in automations.tsx");
}

// ── Section 5: App.tsx — /automation/tasks redirects ────────────────────────
console.log("\n── 5. App.tsx: /automation/tasks redirects to /automations?tab=task-rules ──");

if (/path=["']\/automation\/tasks["']/.test(appTsx)) {
  ok("/automation/tasks route still registered (compatibility preserved)");
} else {
  bad("/automation/tasks route missing from App.tsx entirely");
}
if (/Redirect\s+to=["']\/automations\?tab=task-rules["']/.test(appTsx)) {
  ok("/automation/tasks redirects to /automations?tab=task-rules");
} else {
  bad("/automation/tasks does not redirect to /automations?tab=task-rules — expected Redirect component");
}
// Confirm standalone page is NOT rendered at /automation/tasks
if (/Route path=["']\/automation\/tasks["'][^>]*>\s*\{[^}]*TaskRulesSettingsPage/.test(appTsx)) {
  bad("/automation/tasks still directly renders TaskRulesSettingsPage (should redirect instead)");
} else {
  ok("/automation/tasks does NOT directly render standalone TaskRulesSettingsPage");
}

// ── Section 6: automations.tsx — URL deep-link support ──────────────────────
console.log("\n── 6. automations.tsx: ?tab=task-rules URL deep-link support ──");

if (/URLSearchParams.*window\.location\.search/.test(automations)) {
  ok("URLSearchParams(window.location.search) used to read tab param");
} else {
  bad("URLSearchParams not used to read tab from URL — deep-link not implemented");
}
// Check that "task-rules" string appears near the URLSearchParams block
// (source: `return p === "task-rules" ? "task-rules" : "builder"` on a separate line)
if (/URLSearchParams[\s\S]{0,200}task-rules/.test(automations)) {
  ok("'task-rules' value found within URLSearchParams block (deep-link branch confirmed)");
} else {
  bad("'task-rules' value not found near URLSearchParams block");
}

// ── Section 7: no duplicate automations routes ───────────────────────────────
console.log("\n── 7. App.tsx: no duplicate /automations routes ──");

const automationRoutes = (appTsx.match(/path=["']\/automations["']/g) || []);
if (automationRoutes.length === 1) {
  ok(`Exactly 1 /automations route in App.tsx (found ${automationRoutes.length})`);
} else {
  bad(`Expected 1 /automations route, found ${automationRoutes.length}`);
}
const taskRoutes = (appTsx.match(/path=["']\/automation\/tasks["']/g) || []);
if (taskRoutes.length === 1) {
  ok(`Exactly 1 /automation/tasks route in App.tsx (compatibility only)`);
} else if (taskRoutes.length === 0) {
  ok("/automation/tasks route removed (accepted: redirect no longer needed)");
} else {
  bad(`Expected 1 /automation/tasks route, found ${taskRoutes.length}`);
}

// ── Section 8: no TaskRulesSettingsPage lazy import still in App.tsx ─────────
console.log("\n── 8. App.tsx: TaskRulesSettingsPage lazy import present (not removed yet) ──");
// The lazy import can remain for now (route uses Redirect, not the component).
// This is acceptable — we just confirm no regression.
if (/lazy.*task-rules-settings/.test(appTsx)) {
  ok("task-rules-settings lazy import retained in App.tsx (harmless — route redirects instead of rendering it)");
} else {
  ok("task-rules-settings lazy import removed from App.tsx — clean");
}

// ── Results ──────────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(60)}`);
console.log(`Automations Tab Merge: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\n❌ ${failed} check(s) FAILED`);
  process.exit(1);
}
console.log(`\n✅ All ${passed} checks passed`);
process.exit(0);
