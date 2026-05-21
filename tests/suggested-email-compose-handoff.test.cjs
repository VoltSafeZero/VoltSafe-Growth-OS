/**
 * suggested-email-compose-handoff.test.cjs
 *
 * Source-grep regression suite for the "Continue in Mail" compose handoff fix.
 *
 * Root cause: handleContinue() dispatched a CustomEvent then navigated to
 * /gmail.  Because navigation unmounts the CRM page and mounts gmail-inbox,
 * the event listener (registered in a mount-time useEffect) never existed when
 * the event fired — timing race, draft lost every time.
 *
 * Fix:
 *   Modal  — async handleContinue() POSTs to /api/gmail/drafts, navigates to
 *            /gmail?draft=<id>&compose=1; falls back to sessionStorage.
 *   Inbox  — mount-time useEffect reads URL params (draft+compose) and calls
 *            openDraft() using the same path as clicking a Drafts row;
 *            separate mount-time check reads sessionStorage fallback.
 *
 * Tests:
 *   M1  Modal no longer uses synchronous CustomEvent as its only mechanism
 *   M2  handleContinue is async
 *   M3  Modal POSTs to /api/gmail/drafts
 *   M4  Modal navigates to /gmail?draft= URL pattern on success
 *   M5  Modal writes sessionStorage fallback key on failure path
 *   M6  Modal exports PENDING_COMPOSE_KEY constant (shared key)
 *   M7  Modal shows loading/spinner while saving draft
 *   I1  Inbox reads URL params (draft + compose) on mount
 *   I2  Inbox calls openDraft() when URL params present
 *   I3  Inbox cleans URL after reading params (replaceState)
 *   I4  Inbox reads sessionStorage fallback on mount
 *   I5  Inbox clears sessionStorage key before using payload
 *   I6  CustomEvent listener still present (backwards compat)
 *   I7  Inbox uses setComposeOpen(true) for both paths
 *   I8  openDraft uses the same fetch /api/gmail/drafts/:id pattern
 *
 * Run: node tests/suggested-email-compose-handoff.test.cjs
 */
"use strict";

const fs   = require("fs");
const path = require("path");

const root       = path.resolve(__dirname, "..");
const modalPath  = path.join(root, "client/src/components/crm/suggested-next-email-modal.tsx");
const inboxPath  = path.join(root, "client/src/pages/gmail-inbox.tsx");

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

const modal = fs.readFileSync(modalPath, "utf8");
const inbox = fs.readFileSync(inboxPath, "utf8");

// ── M: Modal (suggested-next-email-modal.tsx) ─────────────────────────────────
console.log("\n=== M1-M8: suggested-next-email-modal.tsx ===\n");

// M1: CustomEvent dispatch is gone (was the broken mechanism)
assert(
  "M1: CustomEvent 'voltsafe:openCompose' dispatch removed from modal",
  !modal.includes('dispatchEvent(new CustomEvent("voltsafe:openCompose"'),
  "Found dispatchEvent(new CustomEvent) — old broken timing-race mechanism still present"
);

// M2: handleContinue is now async
assert(
  "M2: handleContinue is declared async",
  modal.includes("async function handleContinue"),
  "handleContinue must be async to await draft creation"
);

// M3: Modal POSTs to /api/gmail/drafts
assert(
  "M3: Modal POSTs to /api/gmail/drafts",
  modal.includes("/api/gmail/drafts") && modal.includes('"POST"'),
  "Modal must POST to /api/gmail/drafts to create a real, persistable draft"
);

// M4: Modal navigates to /gmail?draft=…&compose=1 on success
assert(
  "M4: Modal navigates with ?draft=...&compose=1 on success",
  modal.includes("draft=") && modal.includes("compose=1"),
  "On successful draft creation, must navigate to /gmail?draft=<id>&compose=1"
);

// M5: sessionStorage fallback write present
assert(
  "M5: sessionStorage fallback write present",
  modal.includes("sessionStorage.setItem") && modal.includes("pendingCompose"),
  "Must write compose payload to sessionStorage as fallback for when draft API is unavailable"
);

// M6: PENDING_COMPOSE_KEY constant exported
assert(
  "M6: PENDING_COMPOSE_KEY constant exported",
  modal.includes("export const PENDING_COMPOSE_KEY"),
  "PENDING_COMPOSE_KEY must be exported so inbox and tests use the same key"
);

// M7: isSaving state + spinner shown while draft is being created
assert(
  "M7: isSaving state present — button shows loading state",
  modal.includes("isSaving") && modal.includes("Loader2"),
  "Must show a loading spinner while the draft POST is in-flight"
);

// ── I: Inbox (gmail-inbox.tsx) ────────────────────────────────────────────────
console.log("\n=== I1-I8: gmail-inbox.tsx ===\n");

// I1: Inbox reads URL params for draft + compose
assert(
  "I1: Inbox reads URL params — URLSearchParams(window.location.search)",
  inbox.includes("URLSearchParams(window.location.search)"),
  "Must read URL params to detect ?draft=<id>&compose=1 on mount"
);

// I2: Inbox calls openDraft with the URL param
assert(
  "I2: Inbox calls openDraft(draftId) when URL params present",
  inbox.includes("openDraft(draftId)"),
  "Must call openDraft() with the draft ID from URL params"
);

// I3: Inbox cleans URL after reading params
assert(
  "I3: Inbox cleans URL params after reading them (replaceState)",
  inbox.includes("window.history.replaceState") && inbox.includes("window.location.pathname"),
  "Must clean ?draft&compose params from URL so refresh doesn't re-open compose"
);

// I4: Inbox checks sessionStorage for pendingCompose on mount
assert(
  "I4: Inbox reads sessionStorage fallback on mount",
  inbox.includes("sessionStorage.getItem") && inbox.includes("pendingCompose"),
  "Must read sessionStorage key on mount as fallback for when draft creation failed"
);

// I5: Inbox clears the sessionStorage key before using payload
assert(
  "I5: Inbox removes sessionStorage key before using payload",
  inbox.includes("sessionStorage.removeItem"),
  "Must remove the sessionStorage key so it doesn't re-open compose on next visit"
);

// I6: CustomEvent listener still present for backwards compat
assert(
  "I6: voltsafe:openCompose CustomEvent listener still registered",
  inbox.includes('"voltsafe:openCompose"') && inbox.includes("addEventListener"),
  "CustomEvent listener must be kept for any in-page callers that fire while inbox is mounted"
);

// I7: Both paths call setComposeOpen(true)
const pendingBlock = (() => {
  const idx = inbox.indexOf("sessionStorage.getItem");
  return idx > -1 ? inbox.slice(idx, idx + 500) : "";
})();
assert(
  "I7: sessionStorage fallback path calls setComposeOpen(true)",
  pendingBlock.includes("setComposeOpen(true)"),
  "The sessionStorage path must open the compose window"
);

// I8: openDraft uses /api/gmail/drafts/:id (same path as draft row click)
assert(
  "I8: openDraft fetches /api/gmail/drafts/:id — unified draft hydration",
  inbox.includes("/api/gmail/drafts/${draftId}") || inbox.includes("`/api/gmail/drafts/${draftId}`"),
  "openDraft must fetch the draft content from /api/gmail/drafts/:id"
);

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(55)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
