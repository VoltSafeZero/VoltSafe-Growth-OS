/**
 * contact-creation-regression.test.cjs
 *
 * Source-grep regression suite for the React error #310 fix in the
 * "New Contact" flow (contacts-panel + use-toast).
 *
 * Covers:
 *   T1  use-toast.ts   — listener registered with [] dep (not [state])
 *   T2  contacts-panel — openCreateDialog is synchronous (not async)
 *   T3  contacts-panel — popover closed before dialog opened
 *   T4  contacts-panel — dialog opened before async IIFE (no blocking await)
 *   T5  contacts-panel — no blocking "Can't create contact here" toast error
 *   T6  contacts-panel — null accountId path works (setResolvedAccountId(null))
 *   T7  contacts-panel — background IIFE resolves account for leads/opps
 *   T8  create-contact-dialog — accepts accountId: number | null
 *   T9  create-contact-dialog — needsOrgPicker shows picker when accountId null
 *   T10 create-contact-dialog — org picker only hidden when accountId provided
 *   T11 React safety — no render-phase setState in contacts-panel
 *   T12 React safety — no render-phase setState in create-contact-dialog
 *   T13 use-toast.ts   — listener cleanup removes by indexOf (stable identity)
 *   T14 contacts-panel — setOpen(false) textually precedes setCreateOpen(true)
 *   T15 contacts-panel — toast import still present (link/error toasts intact)
 *
 * Run: node tests/contact-creation-regression.test.cjs
 */
"use strict";

const fs   = require("fs");
const path = require("path");

const root          = path.resolve(__dirname, "..");
const toastPath     = path.join(root, "client/src/hooks/use-toast.ts");
const panelPath     = path.join(root, "client/src/components/contacts/contacts-panel.tsx");
const dialogPath    = path.join(root, "client/src/components/contacts/create-contact-dialog.tsx");

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
  if (condition) {
    console.log(`  \u2713 ${label}`);
    passed++;
  } else {
    console.error(`  \u2717 ${label}${detail ? " \u2014 " + detail : ""}`);
    failed++;
  }
}

// ── Load sources ──────────────────────────────────────────────────────────────
const toast  = fs.readFileSync(toastPath,  "utf8");
const panel  = fs.readFileSync(panelPath,  "utf8");
const dialog = fs.readFileSync(dialogPath, "utf8");

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Return the character offset of `needle` inside `src`, or -1.
 * Used for ordering checks (A must appear before B).
 */
function pos(src, needle) {
  return src.indexOf(needle);
}

/**
 * Extract the body of a named function / arrow function from source.
 * Scans from the declaration forward, counting braces, and returns the
 * captured text.  Falls back to the full source on parse failure so
 * individual assertions still run against meaningful text.
 */
function extractFnBody(src, declarationSubstring) {
  const start = src.indexOf(declarationSubstring);
  if (start === -1) return "";
  let depth = 0;
  let inside = false;
  let bodyStart = -1;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") {
      depth++;
      if (!inside) { inside = true; bodyStart = i; }
    } else if (src[i] === "}") {
      depth--;
      if (inside && depth === 0) {
        return src.slice(bodyStart, i + 1);
      }
    }
  }
  return src.slice(start); // fallback
}

// ─────────────────────────────────────────────────────────────────────────────
// T1–T2: use-toast.ts — correct useEffect dependency
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== T1-T2: use-toast.ts listener registration ===\n");

// T1: dependency array must be [] not [state]
assert(
  "T1: useEffect dep is [] (not [state])",
  !toast.includes("}, [state])"),
  "Found `}, [state])` — listener re-registers on every toast state update"
);

// T2: the empty-dep variant must be present
assert(
  "T2: useEffect dep is [] (empty array present)",
  /listeners\.push\(setState\)[\s\S]{0,200}},\s*\[\s*\]\s*\)/.test(toast),
  "Expected `listeners.push(setState)` followed by `}, [])` within 200 chars"
);

// T13: cleanup still uses indexOf to remove by identity
assert(
  "T13: listener cleanup uses indexOf for identity-based removal",
  toast.includes("listeners.indexOf(setState)"),
  "Cleanup must remove by identity so stale closures are not left registered"
);

// ─────────────────────────────────────────────────────────────────────────────
// T3–T7: contacts-panel — openCreateDialog synchronous shape
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== T3-T7, T11, T14-T15: contacts-panel.tsx openCreateDialog ===\n");

// T3: openCreateDialog must NOT be declared async
assert(
  "T3: openCreateDialog is not async (synchronous function)",
  !panel.includes("const openCreateDialog = async"),
  "async openCreateDialog allows await before setOpen(false), enabling concurrent renders"
);

// T4: setOpen(false) must appear in the panel source
assert(
  "T4: setOpen(false) present — popover is closed synchronously",
  panel.includes("setOpen(false)"),
  "setOpen(false) missing from contacts-panel.tsx"
);

// T14: setOpen(false) textually precedes setCreateOpen(true) in the function
const openFnBody = extractFnBody(panel, "const openCreateDialog = () =>");
assert(
  "T14: setOpen(false) appears before setCreateOpen(true) in openCreateDialog",
  openFnBody.length > 0 &&
  pos(openFnBody, "setOpen(false)") < pos(openFnBody, "setCreateOpen(true)"),
  "Popover must be closed before the dialog is opened to prevent concurrent render"
);

// T5: blocking toast error removed — dialog always opens
assert(
  "T5: no blocking \"Can't create contact here\" toast error",
  !panel.includes("Can't create contact here"),
  "Blocking toast prevents contact creation from leads without linked accounts"
);

// T6: null accountId path — setResolvedAccountId(null) present
assert(
  "T6: setResolvedAccountId(null) called — dialog opens without an account id",
  openFnBody.includes("setResolvedAccountId(null)"),
  "Must allow opening dialog with null accountId for leads with no linked account"
);

// T7: background IIFE for async account resolution present
assert(
  "T7: background IIFE resolves account id for leads/opportunities",
  openFnBody.includes("(async ()") || openFnBody.includes("(async()"),
  "Missing async IIFE for background account id resolution in openCreateDialog"
);

// T11: no render-phase setState calls — check that setters only appear inside
//      callbacks, effects, or the IIFE (not bare in the component body / JSX)
//      Strategy: verify the function body contains no set…() call that is
//      directly in JSX (inside a JSX expression like `{setFoo(…)}`).
assert(
  "T11: no setState in JSX expression context in contacts-panel",
  !/\{[^}]*set[A-Z]\w+\s*\([^)]*\)\s*\}/.test(
    panel.replace(/on[A-Z]\w+\s*=\s*\{[^}]*\}/g, "") // strip event-handler attrs
  ),
  "Detected a setState call directly in a JSX curly expression (render phase)"
);

// T15: useToast / toast still imported (link and error toasts are intact)
assert(
  "T15: useToast still imported in contacts-panel",
  panel.includes("useToast"),
  "useToast must remain for link/error toasts"
);
assert(
  "T15: toast still used for link success",
  panel.includes("Contact linked"),
  "\"Contact linked\" success toast must remain"
);

// ─────────────────────────────────────────────────────────────────────────────
// T8–T10, T12: create-contact-dialog — null accountId path
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== T8-T10, T12: create-contact-dialog.tsx null accountId path ===\n");

// T8: prop type accepts number | null
assert(
  "T8: accountId prop typed as number | null",
  dialog.includes("accountId: number | null") ||
  dialog.includes("accountId?: number | null") ||
  dialog.includes("accountId: number|null"),
  "accountId must accept null so the dialog can open from unlinked leads"
);

// T9: needsOrgPicker derived from !accountId (truthy when null)
assert(
  "T9: needsOrgPicker = !accountId (shows org picker when null)",
  dialog.includes("needsOrgPicker = !accountId"),
  "Dialog must show the org picker when no accountId is provided"
);

// T10: org picker section rendered when needsOrgPicker is true
assert(
  "T10: org picker conditionally rendered on needsOrgPicker",
  dialog.includes("needsOrgPicker") && dialog.includes("orgPickerOpen"),
  "Org picker must be conditionally rendered based on needsOrgPicker"
);

// T12: no setState call in JSX expression in create-contact-dialog
assert(
  "T12: no setState in JSX expression context in create-contact-dialog",
  !/\{[^}]*set[A-Z]\w+\s*\([^)]*\)\s*\}/.test(
    dialog.replace(/on[A-Z]\w+\s*=\s*\{[^}]*\}/g, "")
  ),
  "Detected a setState call directly in a JSX curly expression (render phase)"
);

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
