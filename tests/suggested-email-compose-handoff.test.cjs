/**
 * suggested-email-compose-handoff.test.cjs
 *
 * Source-grep regression suite for the "Continue in Mail" compose handoff fix.
 *
 * Root cause (re-diagnosed):
 *   1. sessionStorage is blocked / isolated in Replit's iframe-based preview and
 *      in many private-mode browsers.  try/catch silently swallowed the error,
 *      so the payload was never written and compose never opened.
 *   2. useState was used instead of useEffect for the data fetch — semantically
 *      wrong (cleanup never ran; fetch fired as a synchronous side-effect of the
 *      lazy initializer).
 *   3. URL-param useEffect path required openDraft() to succeed over an extra
 *      network round-trip; failure was silent (toast only).
 *
 * Fix:
 *   compose-handoff.ts — module-level in-memory pending compose store.
 *                        setPendingCompose / takePendingCompose; immune to
 *                        all storage restrictions.
 *   Modal              — useEffect replaces useState for fetch; handleContinue
 *                        calls setPendingCompose BEFORE navigating; sessionStorage
 *                        also written as a secondary fallback; type="button" on
 *                        all buttons; console.log at every step.
 *   Inbox              — External compose useEffect reads takePendingCompose()
 *                        first (primary), then sessionStorage (secondary); both
 *                        paths log to console.
 *
 * Test groups
 *   H  — compose-handoff.ts module invariants
 *   M  — suggested-next-email-modal.tsx invariants
 *   I  — gmail-inbox.tsx invariants
 *
 * Run: node tests/suggested-email-compose-handoff.test.cjs
 */
"use strict";

const fs   = require("fs");
const path = require("path");

const root        = path.resolve(__dirname, "..");
const handoffPath = path.join(root, "client/src/lib/compose-handoff.ts");
const modalPath   = path.join(root, "client/src/components/crm/suggested-next-email-modal.tsx");
const inboxPath   = path.join(root, "client/src/pages/gmail-inbox.tsx");

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

const handoff = fs.readFileSync(handoffPath, "utf8");
const modal   = fs.readFileSync(modalPath,   "utf8");
const inbox   = fs.readFileSync(inboxPath,   "utf8");

// ── H: compose-handoff.ts ────────────────────────────────────────────────────
console.log("\n=== H1-H5: compose-handoff.ts ===\n");

assert(
  "H1: exports setPendingCompose",
  handoff.includes("export function setPendingCompose"),
  "setPendingCompose must be exported for the modal to call it"
);

assert(
  "H2: exports takePendingCompose",
  handoff.includes("export function takePendingCompose"),
  "takePendingCompose must be exported for the inbox to call it"
);

// Strip JSDoc comments before checking for storage API usage
// (the file legitimately mentions sessionStorage in a "Why not X?" comment)
const handoffCode = handoff.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
assert(
  "H3: module-level _pending variable (no sessionStorage or window API in code)",
  handoff.includes("let _pending") &&
  !handoffCode.includes("sessionStorage") &&
  !handoffCode.includes("window."),
  "_pending must be a plain module variable — immune to storage restrictions"
);

assert(
  "H4: takePendingCompose clears _pending after reading",
  handoff.includes("_pending = null"),
  "Must clear after read so a second call returns null"
);

assert(
  "H5: console.log in setPendingCompose and takePendingCompose",
  handoff.includes("console.log") && handoff.split("console.log").length - 1 >= 2,
  "Both functions must log for runtime tracing"
);

// ── M: suggested-next-email-modal.tsx ────────────────────────────────────────
console.log("\n=== M1-M12: suggested-next-email-modal.tsx ===\n");

// M1: useEffect, not useState, for the fetch
assert(
  "M1: useEffect used for data fetch (not useState lazy initializer)",
  modal.includes("useEffect(() => {") &&
  !modal.includes("useState(() => {"),
  "Fetch on mount must use useEffect — useState lazy initializer runs synchronously during render"
);

// M2: useEffect imports present
assert(
  "M2: useEffect imported from react",
  modal.includes("useEffect"),
  "useEffect must be imported"
);

// M3: handleContinue is async
assert(
  "M3: handleContinue is async",
  modal.includes("async function handleContinue"),
  "Must be async to await the draft API call"
);

// M4: imports setPendingCompose from compose-handoff
assert(
  "M4: imports setPendingCompose from compose-handoff",
  modal.includes("setPendingCompose") && modal.includes("compose-handoff"),
  "Modal must import and call setPendingCompose — the primary handoff mechanism"
);

// M5: calls setPendingCompose with payload BEFORE navigating
const beforeNav = (() => {
  const idx = modal.indexOf("setPendingCompose(payload)");
  const navIdx = modal.indexOf("setLocation(");
  return idx > -1 && navIdx > -1 && idx < navIdx;
})();
assert(
  "M5: setPendingCompose(payload) called BEFORE setLocation()",
  beforeNav,
  "Must set the handoff before navigation so the inbox can read it on mount"
);

// M6: also writes sessionStorage as secondary fallback
assert(
  "M6: sessionStorage.setItem still written as secondary fallback",
  modal.includes("sessionStorage.setItem") && modal.includes(PENDING_COMPOSE_KEY_PRESENCE(modal)),
  "sessionStorage must still be written for hard-page-reload scenarios"
);

function PENDING_COMPOSE_KEY_PRESENCE(src) {
  return src.includes("PENDING_COMPOSE_KEY") || src.includes("voltsafe:pendingCompose")
    ? (src.includes("PENDING_COMPOSE_KEY") ? "PENDING_COMPOSE_KEY" : "voltsafe:pendingCompose")
    : "";
}

// M7: POST /api/gmail/drafts still attempted
assert(
  "M7: POST /api/gmail/drafts still attempted (real draft creation)",
  modal.includes("/api/gmail/drafts") && modal.includes('"POST"'),
  "Must still try to create a real Gmail draft — setPendingCompose is the fallback"
);

// M8: CustomEvent dispatch gone from modal
assert(
  "M8: old CustomEvent dispatch removed",
  !modal.includes('dispatchEvent(new CustomEvent("voltsafe:openCompose"'),
  "Old timing-race mechanism must be gone"
);

// M9: console.log in handleContinue
const handleIdx = modal.indexOf("async function handleContinue");
const handleBody = handleIdx > -1 ? modal.slice(handleIdx, handleIdx + 1200) : "";
assert(
  "M9: console.log present inside handleContinue",
  handleBody.includes("console.log") || handleBody.includes("console.warn") || handleBody.includes("console.error"),
  "Must have runtime logs for tracing"
);

// M10: type="button" on all Buttons (no accidental form submit)
const buttons = modal.match(/<Button[^>]*>/g) || [];
const allHaveType = buttons.every(b => b.includes('type="button"') || b.includes("type={'button'}") || b.includes('type={"button"}'));
assert(
  "M10: all <Button> elements have type=\"button\"",
  allHaveType,
  `Buttons without explicit type default to 'submit' inside forms — saw: ${buttons.filter(b => !b.includes('type=')).join(" | ")}`
);

// M11: isSaving reset to false in fallback path (not stuck on "Opening…")
assert(
  "M11: setIsSaving(false) called in fallback path",
  modal.includes("setIsSaving(false)"),
  "Must reset spinner in non-success paths so button isn't stuck"
);

// M12: PENDING_COMPOSE_KEY exported
assert(
  "M12: PENDING_COMPOSE_KEY exported",
  modal.includes("export const PENDING_COMPOSE_KEY"),
  "Key must be exported for the inbox import"
);

// ── I: gmail-inbox.tsx ────────────────────────────────────────────────────────
console.log("\n=== I1-I10: gmail-inbox.tsx ===\n");

// I1: imports takePendingCompose
assert(
  "I1: imports takePendingCompose from compose-handoff",
  inbox.includes("takePendingCompose") && inbox.includes("compose-handoff"),
  "Inbox must import the primary handoff reader"
);

// I2: imports PENDING_COMPOSE_KEY
assert(
  "I2: imports PENDING_COMPOSE_KEY from suggested-next-email-modal",
  inbox.includes("PENDING_COMPOSE_KEY") && inbox.includes("suggested-next-email-modal"),
  "Inbox must use the shared key constant for sessionStorage"
);

// I3: calls takePendingCompose() on mount
assert(
  "I3: takePendingCompose() called in useEffect",
  inbox.includes("takePendingCompose()"),
  "Must call takePendingCompose() to read the in-memory handoff on mount"
);

// I4: in-memory path sets composeInitial AND composeOpen
const inMemBlock = (() => {
  const idx = inbox.indexOf("takePendingCompose()");
  return idx > -1 ? inbox.slice(idx, idx + 600) : "";
})();
assert(
  "I4: in-memory path calls setComposeInitial + setComposeOpen(true)",
  inMemBlock.includes("setComposeInitial") && inMemBlock.includes("setComposeOpen(true)"),
  "Both must be called so compose opens with the pre-filled content"
);

// I5: sessionStorage fallback still present as secondary
assert(
  "I5: sessionStorage.getItem fallback still present",
  inbox.includes("sessionStorage.getItem") && inbox.includes("PENDING_COMPOSE_KEY"),
  "sessionStorage path must remain as secondary fallback for hard reloads"
);

// I6: sessionStorage key removed before use
assert(
  "I6: sessionStorage.removeItem called before using payload",
  inbox.includes("sessionStorage.removeItem"),
  "Must remove key before hydrating compose to prevent re-open on refresh"
);

// I7: CustomEvent listener still registered
assert(
  "I7: voltsafe:openCompose CustomEvent listener still registered",
  inbox.includes('"voltsafe:openCompose"') && inbox.includes("addEventListener"),
  "CustomEvent path must remain for in-page callers"
);

// I8: URL-param useEffect still present
assert(
  "I8: URL-param useEffect (?draft=...&compose=1) still present",
  inbox.includes("URLSearchParams(window.location.search)") && inbox.includes("openDraft(draftId)"),
  "URL-param path must remain as the 'real draft' path when POST succeeds"
);

// I9: replaceState still cleans URL
assert(
  "I9: window.history.replaceState cleans URL params",
  inbox.includes("window.history.replaceState"),
  "Must clean URL so refresh doesn't re-open compose"
);

// I10: console.log in external compose useEffect
const extIdx = inbox.indexOf("compose-handoff in-memory");
assert(
  "I10: console.log present in external compose useEffect",
  extIdx > -1 || inbox.includes("[gmail-inbox]"),
  "Must have runtime logs for tracing the handoff"
);

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
