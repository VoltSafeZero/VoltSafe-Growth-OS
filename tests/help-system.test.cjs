// Regression tests for the global VoltSafe CMS field help/info icon system (PART X).
// Run directly with: node tests/help-system.test.cjs
//
// Covers:
//  1. Reusable FieldHelp component exists with required props/behavior (aria-label,
//     keyboard Escape handling, Radix Popover for click-outside/focus support).
//  2. Centralized help-content registry exists with getHelpContent() lookup + fallback.
//  3. Missing helpKey does not crash — returns HELP_FALLBACK, only warns in dev.
//  4. Permission scoping — restrictedToEmails gates Capital CFO-onboarding sample entry
//     to trevor@voltsafe.com + scott@voltsafe.com only.
//  5. Sidebar module labels (Today, Currents, Work, Pipeline, Operations, Insights,
//     Marketing, Capital, Feed/CORTEX, Learn) are wired to FieldHelp via helpKeys.
//  6. Example help content entries required by the spec (Create/Search/Filter/Sort/
//     Owner/Priority/Status/Last Touch/Next Action/AI Summary/Archive/Delete) exist.
//  7. Analytics event name "cms_help_opened" is emitted on open.

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;
const failures = [];

function check(label, condition) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(label);
  }
}

function read(relPath) {
  return fs.readFileSync(path.join(__dirname, "..", relPath), "utf8");
}

// ── 1. FieldHelp component ─────────────────────────────────────────────────
const fieldHelpSrc = read("client/src/components/help/field-help.tsx");

check("FieldHelp component is exported", /export function FieldHelp/.test(fieldHelpSrc));
check("FieldHelp accepts a helpKey prop", /helpKey:\s*string/.test(fieldHelpSrc));
check("FieldHelp sets aria-label on the trigger", /aria-label=\{ariaLabel/.test(fieldHelpSrc));
check("FieldHelp handles Escape to close", /e\.key === "Escape"/.test(fieldHelpSrc) && /onEscapeKeyDown/.test(fieldHelpSrc));
check("FieldHelp uses Radix Popover (click-outside + focus support built in)", /from "@\/components\/ui\/popover"/.test(fieldHelpSrc));
check("FieldHelp uses the centralized registry via getHelpContent", /getHelpContent\(helpKey/.test(fieldHelpSrc));
check("FieldHelp shows value-nature badges (sample/AI-generated/etc.)", /entry\.valueNature/.test(fieldHelpSrc));
check("FieldHelp logs cms_help_opened analytics event", /cms_help_opened/.test(fieldHelpSrc));
check("FieldHelp popover width is bounded to avoid mobile horizontal scroll/clipping", /max-w-\[calc\(100vw/.test(fieldHelpSrc));
check("FieldHelp is a small subtle icon (not a large button)", /h-3\.5 w-3\.5/.test(fieldHelpSrc));
// Note: the icon was intentionally redesigned from a plain "i" glyph to a shared
// circle-i SVG (client/src/components/icons/info-icon.tsx) across later commits
// ("Update info icon component across multiple application modules", "Update
// sidebar indicators to use consistent info icon"). This assertion is updated to
// match that current, deliberate design instead of the earlier plain-glyph one.
const infoIconSrc = read("client/src/components/icons/info-icon.tsx");
check("FieldHelp renders the shared InfoIcon (circle-i) component, not raw lucide-react", /<InfoIcon\b/.test(fieldHelpSrc) && !/from "lucide-react"/.test(fieldHelpSrc));
check("Shared InfoIcon is a self-contained inline SVG (not a raster asset)", /<svg/.test(infoIconSrc) && /<circle/.test(infoIconSrc));

// ── 2/3. Centralized registry + fallback behavior ──────────────────────────
const registrySrc = read("client/src/lib/help-content.ts");

check("HELP_CONTENT registry is exported", /export const HELP_CONTENT/.test(registrySrc));
check("getHelpContent() lookup function is exported", /export function getHelpContent/.test(registrySrc));
check("HELP_FALLBACK generic message exists", /Help content for this field has not been added yet\./.test(registrySrc));
check("getHelpContent falls back (never throws) on missing key", /if \(!entry\)/.test(registrySrc) && /return HELP_FALLBACK/.test(registrySrc));
check("Missing-key dev warning is gated to development only", /import\.meta\.env\?\.DEV/.test(registrySrc));

// ── 4. Permission scoping via restrictedToEmails ────────────────────────────
check("HelpEntry supports restrictedToEmails for permission scoping", /restrictedToEmails\?:\s*string\[\]/.test(registrySrc));
{
  const sampleDataIdx = registrySrc.indexOf('"capital.sampleData"');
  const nextEntryIdx = registrySrc.indexOf("\n  },", sampleDataIdx);
  const sampleDataBlock = sampleDataIdx >= 0 && nextEntryIdx > sampleDataIdx
    ? registrySrc.slice(sampleDataIdx, nextEntryIdx)
    : "";
  check(
    "Capital sample-data help entry is restricted to Trevor + Scott only",
    /restrictedToEmails:\s*\[\s*"trevor@voltsafe\.com"\s*,\s*"scott@voltsafe\.com"\s*\]/.test(sampleDataBlock)
  );
}
check(
  "getHelpContent enforces restrictedToEmails against the caller's email (case-insensitive)",
  /entry\.restrictedToEmails/.test(registrySrc) && /toLowerCase\(\)/.test(registrySrc)
);
check(
  "Restricted entries fall back to generic content for non-allowed users (no data leak)",
  /if \(!allowed\) return HELP_FALLBACK;/.test(registrySrc)
);

// ── 5. Sidebar module coverage ───────────────────────────────────────────────
const sidebarSrc = read("client/src/components/dashboard/app-sidebar.tsx");

check("Sidebar imports FieldHelp", /from "@\/components\/help\/field-help"/.test(sidebarSrc));
check("Sidebar defines a section->helpKey map covering all first-pass modules", /const SECTION_HELP_KEYS/.test(sidebarSrc));
[
  "today", "currents", "work", "pipeline", "operations", "insights", "marketing", "capital", "feed-cortex", "learn",
].forEach((id) => {
  check(`Sidebar help map includes section "${id}"`, sidebarSrc.includes(`${id === "feed-cortex" ? '"feed-cortex"' : id + ":"}`));
});
check("Sidebar renders FieldHelp next to the section label", /<FieldHelp\s*\n\s*helpKey=\{SECTION_HELP_KEYS\[section\.id\]\}/.test(sidebarSrc));
check(
  "Sidebar renders the help icon as a sibling of the section button, not nested inside it (avoids invalid button-in-button DOM nesting)",
  /<\/button>\s*\{SECTION_HELP_KEYS\[section\.id\] && \(\s*\n\s*<FieldHelp/.test(sidebarSrc)
);

// ── 6. Required example help content entries from the spec ─────────────────
[
  ["action.create", "Buttons are sneaky like that."],
  ["action.search", "Search filters the current page or module."],
  ["action.filter", "clear filters before assuming the system ate it"],
  ["action.sort", "does not edit the records"],
  ["crm.owner", "digital furniture"],
  ["crm.priority", "should be handled first"],
  ["crm.status", "Update it when the real-world situation changes"],
  ["crm.lastTouch", "relationship may be cooling off"],
  ["crm.nextAction", "specific, assigned, and dated"],
  ["crm.aiSummary", "not a sworn witness"],
  ["action.archive", "without permanently deleting it"],
  ["action.delete", "undo fairy has limited working hours"],
].forEach(([key, snippet]) => {
  check(`Registry has "${key}" help entry with spec-required copy`, registrySrc.includes(key) && registrySrc.includes(snippet));
});

// ── 7. Module/audience metadata present for permission-aware rendering ─────
check("HelpEntry tracks module + audience for permission-aware display", /module: string/.test(registrySrc) && /audience: HelpAudience/.test(registrySrc));
check("HelpAudience type distinguishes capital-only content", /"capital-users"/.test(registrySrc));

console.log("=".repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
if (failed > 0) {
  console.log("\nFailed checks:");
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  console.log("\n❌ Some tests FAILED");
  process.exit(1);
} else {
  console.log("\n✅ All tests PASSED");
}
