/**
 * tests/star-removal.test.cjs
 *
 * Regression suite: star/unstar has been completely removed from VoltSafe
 * Mail's UI.  Users must not be able to star or unstar any email from within
 * the application.  The backend toggle-star route and the is_starred DB column
 * are intentionally preserved as read-only provider metadata — only the UI
 * surface is removed.
 *
 * All checks are static source-grep (no server required).
 *
 * §6 checklist:
 *  R1  toggleStarMutation removed from gmail-inbox.tsx
 *  R2  isStarred() UI helper removed from gmail-inbox.tsx
 *  R3  Keyboard shortcut 's' for star removed
 *  R4  Row hover star button removed from inbox list
 *  R5  Thread-header star button removed
 *  R6  "Starred" badge span removed from thread header
 *  R7  "Starred" CRM filter chip removed from filter bar
 *  R8  crmFilter === "starred" branch removed from filter logic
 *  R9  "starred" removed from CrmInboxFilter type
 * R10  onToggleStar removed from ActionsToolbarHandlers interface
 * R11  isStarred prop removed from EmailActionsToolbarProps
 * R12  Star button (data-testid="action-star") removed from toolbar render
 * R13  Star icon import removed from email-actions-toolbar.tsx
 * R14  Both EmailActionsToolbar call sites pass no isStarred/onToggleStar
 * R15  Backend toggle-star route still exists (non-destructive)
 */

"use strict";

const fs   = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

// ── Load source files ────────────────────────────────────────────────────────

const INBOX    = path.join(__dirname, "../client/src/pages/gmail-inbox.tsx");
const TOOLBAR  = path.join(__dirname, "../client/src/components/inbox/email-actions-toolbar.tsx");
const ROUTES   = path.join(__dirname, "../server/routes.ts");
const GROUPER  = path.join(__dirname, "../client/src/components/inbox/smart-inbox-grouper.ts");

const inbox   = fs.readFileSync(INBOX,   "utf8");
const toolbar = fs.readFileSync(TOOLBAR, "utf8");
const routes  = fs.readFileSync(ROUTES,  "utf8");
const grouper = fs.readFileSync(GROUPER, "utf8");

// ── R1: toggleStarMutation removed ──────────────────────────────────────────
console.log("\n── R1. toggleStarMutation ──");
check(
  "R1a: toggleStarMutation not declared in gmail-inbox.tsx",
  !inbox.includes("toggleStarMutation")
);

// ── R2: isStarred() UI helper removed ───────────────────────────────────────
console.log("\n── R2. isStarred() UI helper ──");
check(
  "R2a: isStarred function not declared in gmail-inbox.tsx",
  !inbox.includes("function isStarred(")
);
check(
  "R2b: isStarred() not called anywhere in gmail-inbox.tsx",
  !inbox.includes("isStarred(")
);

// ── R3: Keyboard shortcut 's' for star removed ───────────────────────────────
console.log("\n── R3. Keyboard shortcut 's' ──");
check(
  "R3a: 's' keyboard shortcut no longer triggers star action",
  !inbox.includes("toggleStarMutation.mutate") &&
  !(inbox.includes(`case "s"`) && inbox.includes("star"))
);
check(
  "R3b: 'Star / unstar' legend entry removed from shortcuts panel",
  !inbox.includes("Star / unstar")
);

// ── R4: Row hover star button removed ────────────────────────────────────────
console.log("\n── R4. Row hover star button ──");
check(
  "R4a: button-star-{id} testid not in inbox page",
  !inbox.includes("button-star-${msg.id}") && !inbox.includes('"button-star-"')
);
check(
  "R4b: 'Add to starred' tooltip not in inbox row",
  !inbox.includes("Add to starred")
);
check(
  "R4c: 'Remove star' tooltip not in inbox row",
  !inbox.includes("Remove star")
);

// ── R5: Thread-header star button removed ────────────────────────────────────
console.log("\n── R5. Thread-header star button ──");
check(
  "R5a: button-star-thread testid not in inbox page",
  !inbox.includes("button-star-thread")
);
check(
  "R5b: headerStarred variable not in inbox page",
  !inbox.includes("headerStarred")
);

// ── R6: "Starred" badge span removed from thread header ──────────────────────
console.log("\n── R6. Starred badge span ──");
check(
  "R6a: Starred badge text not in thread header area",
  !inbox.includes('"Starred"') || !inbox.includes("fill-amber-400")
    ? !inbox.includes("fill-amber-400") || !inbox.includes("> Starred")
    : false
);
// More targeted check — the specific badge pattern
check(
  "R6b: inline Starred badge (Star + 'Starred' text) removed",
  !inbox.includes("isStarred(focusedMsg.labelIds)")
);

// ── R7: "Starred" CRM filter chip removed ────────────────────────────────────
console.log("\n── R7. Starred filter chip ──");
check(
  "R7a: Starred filter chip not in filter bar array",
  !inbox.includes('key: "starred", label: "Starred"') &&
  !inbox.includes('label: "Starred"')
);

// ── R8: crmFilter === "starred" branch removed ───────────────────────────────
console.log("\n── R8. crmFilter starred branch ──");
check(
  'R8a: crmFilter === "starred" filter branch not in inbox page',
  !inbox.includes('crmFilter === "starred"')
);
check(
  'R8b: follow-up filter no longer uses isStarred',
  !inbox.includes('isStarred(m.labelIds)')
);

// ── R9: "starred" removed from CrmInboxFilter type ──────────────────────────
console.log("\n── R9. CrmInboxFilter type ──");
check(
  'R9a: "starred" not in CrmInboxFilter union type',
  !inbox.includes('"starred" | ') && !inbox.includes('| "starred"')
);

// ── R10: onToggleStar removed from ActionsToolbarHandlers ────────────────────
console.log("\n── R10. onToggleStar handler interface ──");
check(
  "R10a: onToggleStar not in ActionsToolbarHandlers interface",
  !toolbar.includes("onToggleStar")
);

// ── R11: isStarred prop removed from EmailActionsToolbarProps ────────────────
console.log("\n── R11. isStarred toolbar prop ──");
check(
  "R11a: isStarred prop not in EmailActionsToolbarProps",
  !toolbar.includes("isStarred")
);
check(
  "R11b: isStarred not destructured in toolbar impl",
  !toolbar.includes("isStarred,")
);

// ── R12: Star button (action-star) removed from toolbar render ───────────────
console.log("\n── R12. action-star button ──");
check(
  'R12a: data-testid="action-star" not in toolbar',
  !toolbar.includes('"action-star"')
);

// ── R13: Star icon import removed from email-actions-toolbar.tsx ─────────────
console.log("\n── R13. Star icon import ──");
check(
  "R13a: Star not imported in email-actions-toolbar.tsx",
  !toolbar.includes("Star,") && !toolbar.includes("  Star\n")
);

// ── R14: Both call sites pass no star props ──────────────────────────────────
console.log("\n── R14. Call sites — no star props passed ──");
check(
  "R14a: inbox page does not pass isStarred= to EmailActionsToolbar",
  !inbox.includes("isStarred={")
);
check(
  "R14b: inbox page does not pass onToggleStar to EmailActionsToolbar handlers",
  !inbox.includes("onToggleStar:")
);

// ── R15: Backend toggle-star route preserved ─────────────────────────────────
console.log("\n── R15. Backend route preserved (non-destructive) ──");
check(
  "R15a: POST /api/gmail/messages/:id/toggle-star route still exists in routes.ts",
  routes.includes("/toggle-star")
);
check(
  "R15b: is_starred column reference still exists in routes.ts (metadata preserved)",
  routes.includes("is_starred")
);

// ── Bonus: smart-inbox-grouper ────────────────────────────────────────────────
console.log("\n── B1. smart-inbox-grouper.ts ──");
// isStarredMsg may remain as an exported helper but must not be CALLED
// anywhere in the grouper (it has no callers — Priority section was removed).
const grouperCallSites = grouper.split("\n").filter(line =>
  line.includes("isStarredMsg(") && !line.trimStart().startsWith("export function")
);
check(
  "B1a: isStarredMsg is never called in smart-inbox-grouper.ts (no Priority section logic)",
  grouperCallSites.length === 0
);

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
const total = passed + failed;
console.log(`Results: ${passed}/${total} checks passed`);
if (failed > 0) {
  console.error(`\n${failed} check(s) FAILED`);
  process.exit(1);
} else {
  console.log("\nAll star-removal regression checks passed.");
}
