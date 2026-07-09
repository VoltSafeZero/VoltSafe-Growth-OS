/**
 * tests/help-icons-toggle.test.cjs
 * Task #78 — Contextual Help Expansion + "Show Help Icons" toggle
 *
 * Source-grep tests verifying: HelpEntry schema extension, Capital subtab
 * help content, per-user showHelpIcons preference plumbing (DB → API → UI),
 * FieldHelp gating/rendering of rich content, and the sidebar subnav wiring.
 */

"use strict";
const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function contains(src, pattern, label) {
  const ok = typeof pattern === "string" ? src.includes(pattern) : pattern.test(src);
  if (ok) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${label}`);
}

function read(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }

const schema = read("shared/schema.ts");
const serverIndex = read("server/index.ts");
const helpContent = read("client/src/lib/help-content.ts");
const fieldHelp = read("client/src/components/help/field-help.tsx");
const appSidebar = read("client/src/components/dashboard/app-sidebar.tsx");
const routes = read("server/routes.ts");
const settingsPersonal = read("client/src/pages/settings-personal.tsx");

console.log("\n── 1. Schema + migration ──────────────────────────────");
contains(schema, `showHelpIcons: boolean("show_help_icons")`, "users.showHelpIcons column defined in schema");
contains(serverIndex, "ALTER TABLE users ADD COLUMN IF NOT EXISTS show_help_icons BOOLEAN NOT NULL DEFAULT true",
  "raw-SQL migration adds show_help_icons column additively");

console.log("\n── 2. HelpEntry rich-content fields ───────────────────");
contains(helpContent, "whatToDo?:", "HelpEntry has optional whatToDo field");
contains(helpContent, "whyItMatters?:", "HelpEntry has optional whyItMatters field");
contains(helpContent, "owner?:", "HelpEntry has optional owner field");
contains(helpContent, "updateCadence?:", "HelpEntry has optional updateCadence field");
contains(helpContent, "goodLooksLike?:", "HelpEntry has optional goodLooksLike field");
contains(helpContent, "commonMistakes?:", "HelpEntry has optional commonMistakes field");
contains(helpContent, "relatedActions?:", "HelpEntry has optional relatedActions field");

console.log("\n── 3. Capital subtab help content ─────────────────────");
[
  "nav.capital.commandCenter",
  "nav.capital.investors",
  "nav.capital.rounds",
  "nav.capital.followUps",
  "nav.capital.dataRoom",
  "nav.capital.engagement",
  "nav.capital.reports",
  "nav.capital.copilot",
  "nav.capital.updates",
].forEach((key) => {
  contains(helpContent, `"${key}"`, `help-content.ts has entry for ${key}`);
});

console.log("\n── 4. FieldHelp rendering + preference gating ─────────");
contains(fieldHelp, "showHelpIcons?: boolean", "CurrentUserLite includes showHelpIcons");
contains(fieldHelp, "currentUser.showHelpIcons === false", "FieldHelp hides icon when user preference is false");
contains(fieldHelp, "entry.whatToDo", "FieldHelp popover renders whatToDo");
contains(fieldHelp, "entry.whyItMatters", "FieldHelp popover renders whyItMatters");
contains(fieldHelp, "entry.goodLooksLike", "FieldHelp popover renders goodLooksLike");
contains(fieldHelp, "entry.commonMistakes", "FieldHelp popover renders commonMistakes");
contains(fieldHelp, "entry.relatedActions", "FieldHelp popover renders relatedActions");
contains(fieldHelp, "entry.owner", "FieldHelp popover renders owner");
contains(fieldHelp, "entry.updateCadence", "FieldHelp popover renders updateCadence");

console.log("\n── 5. Sidebar subnav help icons ───────────────────────");
contains(appSidebar, "SUBNAV_HELP_KEYS", "app-sidebar.tsx defines SUBNAV_HELP_KEYS map");
contains(appSidebar, `"capital-command-center": "nav.capital.commandCenter"`, "SUBNAV_HELP_KEYS maps Capital Command Center item");
contains(appSidebar, "SUBNAV_HELP_KEYS[item.id]", "subnav items render FieldHelp based on SUBNAV_HELP_KEYS");
// FieldHelp must be a SIBLING of the Link, never nested inside it (nested
// interactive elements break click semantics — the help icon would trigger navigation).
contains(appSidebar, /<\/Link>\s*\{SUBNAV_HELP_KEYS\[item\.id\]/, "subnav FieldHelp icon is rendered outside/after the Link, not nested inside it");

console.log("\n── 6. showHelpIcons API plumbing ──────────────────────");
contains(routes, "showHelpIcons: user.showHelpIcons ?? true", "GET /api/auth/me returns showHelpIcons");
contains(routes, "showHelpIcons must be a boolean", "PATCH /api/users/me/layout validates showHelpIcons type");
contains(routes, "update.showHelpIcons = showHelpIcons", "PATCH /api/users/me/layout persists showHelpIcons");
contains(routes, "showHelpIcons: users.showHelpIcons", "PATCH /api/users/me/layout returns showHelpIcons");

console.log("\n── 7. Settings UI toggle ──────────────────────────────");
contains(settingsPersonal, "switch-show-help-icons", "settings-personal.tsx renders the Show Help Icons switch");
contains(settingsPersonal, `apiRequest("PATCH", "/api/users/me/layout", { showHelpIcons: next })`,
  "toggle mutation PATCHes showHelpIcons");
contains(settingsPersonal, `queryKey: ["/api/auth/me"]`, "settings-personal.tsx reads current preference from /api/auth/me");

console.log("\n" + "=".repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
if (failed > 0) {
  console.log(`\n❌ ${failed} test(s) FAILED`);
  process.exit(1);
} else {
  console.log("\n✅ All tests PASSED");
}
