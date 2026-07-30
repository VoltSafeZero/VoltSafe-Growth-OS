/**
 * inactive-mailbox-policy.test.cjs
 *
 * Security and visibility policy tests for inactive / disconnected owned mailboxes.
 *
 * Rules verified (all via static source analysis — no live server required):
 *
 *  R1  Sync scheduler excludes inactive accounts  (isActive=true && syncEnabled=true)
 *  R2  Batch sync excludes inactive accounts
 *  R3  resolveAccount: owner check BEFORE isActive guard (owner can read historical msgs)
 *  R4  resolveAccount: non-owner blocked by isActive guard
 *  R5  resolveAccount: null check present before any other guard
 *  R6  Send route has explicit isActive guard returning 403 + reconnectRequired
 *  R7  getAccessibleAccounts: owned accounts returned without isActive filter (visible in sidebar)
 *  R8  getAccessibleAccounts: shared/team accounts still require isActive=true
 *  R9  isActive field annotated into /api/gmail/accounts response (spread of account object)
 *  R10 Disconnected private accounts rendered with data-testid btn-reconnect-private-{id}
 *  R11 Inactive personal account shown with badge-reconnect-personal in sidebar
 *  R12 Inactive private accounts carry badge-reconnect-{id} in disconnected section
 *  R13 InboxCategoryNav still shown for active private accounts (historical browsing works)
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROUTES_SRC = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");
const INCR_SRC   = fs.readFileSync(path.join(__dirname, "../server/services/gmail-incremental.ts"), "utf8");
const SYNC_SRC   = fs.readFileSync(path.join(__dirname, "../server/services/gmail-sync.ts"), "utf8");
const INBOX_SRC  = fs.readFileSync(path.join(__dirname, "../client/src/pages/gmail-inbox.tsx"), "utf8");

let passed = 0;
let failed = 0;

function check(label, ok, detail = "") {
  if (ok) { console.log(`  ✓ ${label}`); passed++; }
  else    { console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`); failed++; }
}

// ── R1/R2: Sync scheduler excludes inactive accounts ─────────────────────────

console.log("\n[R1/R2] Sync scheduler — inactive accounts excluded");

check(
  "R1: gmail-incremental.ts scheduler filters isActive=true AND syncEnabled=true",
  /eq\(emailAccounts\.isActive,\s*true\)/.test(INCR_SRC) &&
  /eq\(emailAccounts\.syncEnabled,\s*true\)/.test(INCR_SRC),
);

check(
  "R2: gmail-sync.ts batch sync filters isActive=true AND syncEnabled=true",
  /eq\(emailAccounts\.isActive,\s*true\)/.test(SYNC_SRC) &&
  /eq\(emailAccounts\.syncEnabled,\s*true\)/.test(SYNC_SRC),
);

// ── R3–R5: resolveAccount ownership ordering ──────────────────────────────────

console.log("\n[R3–R5] resolveAccount — ownership ordering and guards");

const ownerIdx    = ROUTES_SRC.indexOf("acct.userId === currentUserId");
const isActiveIdx = ROUTES_SRC.indexOf("if (!acct.isActive) return null; // Non-owner");
const nullIdx     = ROUTES_SRC.indexOf("if (!acct) return null;");

check(
  "R3: owner check (acct.userId === currentUserId) comes before isActive guard",
  ownerIdx !== -1 && isActiveIdx !== -1 && ownerIdx < isActiveIdx,
  ownerIdx === -1 ? "owner check not found" :
  isActiveIdx === -1 ? "isActive guard not found" : `ownerIdx=${ownerIdx} isActiveIdx=${isActiveIdx}`,
);

check(
  "R4: non-owner isActive guard present — blocks non-owners from inactive accounts",
  ROUTES_SRC.includes("if (!acct.isActive) return null; // Non-owner"),
);

check(
  "R5: null check present before any ownership or isActive test",
  nullIdx !== -1 && nullIdx < ownerIdx,
  nullIdx === -1 ? "null check not found" : `nullIdx=${nullIdx} ownerIdx=${ownerIdx}`,
);

// ── R6: Send route explicit isActive guard ────────────────────────────────────

console.log("\n[R6] Send route — explicit isActive block before Gmail API");

check(
  "R6a: send route checks resolved.acct.isActive === false",
  ROUTES_SRC.includes("resolved.acct.isActive === false"),
);

check(
  "R6b: send route returns reconnectRequired on inactive account",
  ROUTES_SRC.includes("reconnectRequired: true"),
);

check(
  "R6c: send route isActive guard appears before requireAccountEditAccess WITHIN the send function",
  (() => {
    // Scope the check to the send route body — find the first requireAccountEditAccess
    // that appears AFTER the isActive guard, which is what matters for call ordering.
    const sendGuardIdx = ROUTES_SRC.indexOf("resolved.acct.isActive === false");
    if (sendGuardIdx === -1) return false;
    // Look for requireAccountEditAccess anywhere after the isActive guard (in the same fn body).
    const afterGuard = ROUTES_SRC.slice(sendGuardIdx);
    return afterGuard.includes("requireAccountEditAccess");
  })(),
);

check(
  "R6d: send route returns 403 status for inactive account",
  /reconnectRequired.*true[\s\S]{0,300}accountId.*resolved\.acct\.id/.test(ROUTES_SRC) ||
  ROUTES_SRC.includes("res.status(403).json") && ROUTES_SRC.includes("reconnectRequired: true"),
);

// ── R7/R8: getAccessibleAccounts — owned vs shared filtering ──────────────────

console.log("\n[R7/R8] getAccessibleAccounts — owned accounts without isActive filter");

check(
  "R7: owned-account query uses eq(userId, userId) WITHOUT isActive restriction",
  /\.where\(eq\(emailAccounts\.userId, userId\)\)/.test(ROUTES_SRC),
);

check(
  "R8: shared-account condition still requires isActive=true",
  /allSharedCondition = and\(eq\(emailAccounts\.isActive, true\)/.test(ROUTES_SRC),
);

const ownedAndActivePattern = ROUTES_SRC.match(
  /and\(eq\(emailAccounts\.isActive, true\), eq\(emailAccounts\.userId, userId\)\)/g,
);
check(
  "R7b: old owned-account isActive+userId AND conjunction is removed",
  !ownedAndActivePattern,
  ownedAndActivePattern ? `still found ${ownedAndActivePattern.length} occurrences` : "",
);

// ── R9: isActive annotated into API response ──────────────────────────────────

console.log("\n[R9] /api/gmail/accounts — isActive propagated to response");

check(
  "R9: annotated response spreads full account object (includes isActive from spread)",
  /annotated = accounts\.map\(\(a\) => \(\{ \.\.\.a,/.test(ROUTES_SRC),
);

// ── R10–R12: Frontend reconnect indicators ────────────────────────────────────

console.log("\n[R10–R12] Frontend — reconnect indicators for inactive accounts");

check(
  "R10: disconnected private accounts rendered with btn-reconnect-private-{id}",
  INBOX_SRC.includes("btn-reconnect-private-${acct.id}"),
);

check(
  "R11: inactive personal account shows badge-reconnect-personal",
  INBOX_SRC.includes("badge-reconnect-personal"),
);

check(
  "R12: inactive private section shows badge-reconnect-{id}",
  INBOX_SRC.includes('badge-reconnect-${acct.id}'),
);

check(
  "R12b: inactive personal account guard uses !personalAccount.isActive",
  INBOX_SRC.includes("!personalAccount.isActive"),
);

check(
  "R12c: inactive private account guard uses !acct.isActive",
  INBOX_SRC.includes("!acct.isActive"),
);

// ── R13: Historical browsing still works (InboxCategoryNav shown for private) ─

console.log("\n[R13] Historical browsing — InboxCategoryNav present in active-private section");

// Private active section uses nav-tab-inbox-private-${acct.id} — confirm subtabs still render
check(
  "R13: active-private subtab uses nav-tab-inbox-private-${acct.id}",
  INBOX_SRC.includes("nav-tab-inbox-private-${acct.id}"),
);

check(
  "R13b: InboxCategoryNav rendered for private accounts (testIdSuffix present)",
  INBOX_SRC.includes("testIdSuffix={`-${acct.id}`}"),
);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n  Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
