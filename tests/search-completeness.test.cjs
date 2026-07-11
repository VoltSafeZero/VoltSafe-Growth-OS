"use strict";
/**
 * Search Completeness — Source-Grep Regression Tests
 *
 * Guards the two-part fix for the "307 results in Spark, far fewer in VoltSafe"
 * search completeness gap for email-address queries like `scott@voltsafe.com`.
 *
 * Root causes fixed:
 *   1. shouldOverflow required `local.messages.length < maxResults` — a full first
 *      page (50 results) always prevented overflow, so Gmail threads not yet in the
 *      local DB were permanently invisible until the user scrolled to the very end.
 *   2. wantMore = maxResults − local.messages.length → 0 when local is full —
 *      even if the condition were fixed, no messages would be fetched from Gmail.
 *   3. listLocalThreads LIKE clause only checked all_participants, not from_email /
 *      to_emails — inconsistent with listLocalMessages (minor secondary bug).
 */

const fs = require("fs");

const ROUTES = fs.readFileSync("server/routes.ts", "utf8");
const LOCAL  = fs.readFileSync("server/services/local-mailbox.ts", "utf8");

let pass = 0;
let fail = 0;

function check(desc, condition) {
  if (condition) {
    console.log("  ✓", desc);
    pass++;
  } else {
    console.log("  ✗ FAIL:", desc);
    fail++;
  }
}

// ── routes.ts: isEmailAddressSearch/isEmailSearchFirstPage defined before shouldOverflow ──
console.log("\n── routes.ts: email-address first-page overflow trigger ──");

// isEmailAddressSearch must be defined BEFORE shouldOverflow
const idxEmailSearch      = ROUTES.indexOf("const isEmailAddressSearch =");
const idxEmailFirstPage   = ROUTES.indexOf("const isEmailSearchFirstPage =");
const idxShouldOverflow   = ROUTES.indexOf("const shouldOverflow =");

check(
  "isEmailAddressSearch declared before shouldOverflow",
  idxEmailSearch !== -1 && idxEmailSearch < idxShouldOverflow,
);
check(
  "isEmailSearchFirstPage declared before shouldOverflow",
  idxEmailFirstPage !== -1 && idxEmailFirstPage < idxShouldOverflow,
);
check(
  "isEmailSearchFirstPage uses isEmailAddressSearch && !pageToken",
  ROUTES.includes("const isEmailSearchFirstPage = isEmailAddressSearch && !pageToken"),
);

// shouldOverflow now fires even when local page is FULL (via || isEmailSearchFirstPage)
check(
  "shouldOverflow contains isEmailSearchFirstPage branch",
  ROUTES.includes("isEmailSearchFirstPage"),
);
check(
  "shouldOverflow no longer requires local.messages.length < maxResults as the sole gate",
  // Old pattern: `local.localExhausted && local.messages.length < maxResults` alone.
  // New pattern wraps it in an OR with isEmailSearchFirstPage.
  ROUTES.includes("(local.localExhausted && local.messages.length < maxResults)") &&
  ROUTES.includes("isEmailSearchFirstPage"),
);
check(
  "shouldOverflow still guards !capReached",
  /const shouldOverflow[\s\S]{0,400}!capReached/.test(ROUTES),
);
check(
  "shouldOverflow still guards !isSpamOrTrashQuery",
  /const shouldOverflow[\s\S]{0,400}!isSpamOrTrashQuery/.test(ROUTES),
);
check(
  "shouldOverflow still guards canOverflow",
  /const shouldOverflow[\s\S]{0,200}canOverflow/.test(ROUTES),
);

// ── routes.ts: wantMore uses full maxResults for email first-page searches ──
console.log("\n── routes.ts: wantMore uses full limit for email first-page ──");

check(
  "wantMore is conditional on isEmailSearchFirstPage",
  ROUTES.includes("const wantMore = isEmailSearchFirstPage"),
);
check(
  "email first-page wantMore requests full maxResults (not just shortfall)",
  ROUTES.includes("? Math.min(maxResults, remainingBudget)"),
);
check(
  "normal (non-email) wantMore still uses maxResults - local.messages.length",
  ROUTES.includes(": Math.min(maxResults - local.messages.length, remainingBudget)"),
);

// The old duplicate `const isEmailAddressSearch` that was AFTER shouldOverflow must be gone
const countEmailSearchDecl = (ROUTES.match(/const isEmailAddressSearch\s*=/g) || []).length;
check(
  "isEmailAddressSearch declared exactly once (no leftover duplicate after shouldOverflow)",
  countEmailSearchDecl === 1,
);

// ── routes.ts: beforeDate still uses isEmailAddressSearch (not broken by move) ──
console.log("\n── routes.ts: beforeDate still suppressed for email searches ──");

check(
  "beforeDate conditional still references isEmailAddressSearch",
  ROUTES.includes("const beforeDate = isEmailAddressSearch"),
);
check(
  "beforeDate passes null for email-address queries",
  /const beforeDate = isEmailAddressSearch[\s\S]{0,50}null/.test(ROUTES),
);

// ── local-mailbox.ts: listLocalThreads LIKE fallback parity with listLocalMessages ──
console.log("\n── local-mailbox.ts: listLocalThreads LIKE fallback parity ──");

// Find the listLocalThreads section (after line ~541) and verify it has from_email + to_emails
const threadsSection = LOCAL.slice(LOCAL.indexOf("export async function listLocalThreads("));

check(
  "listLocalThreads free-text includes all_participants LIKE",
  threadsSection.includes("lower(coalesce(all_participants,'')) LIKE '%${lc}%'"),
);
check(
  "listLocalThreads free-text includes from_email LIKE (parity with listLocalMessages)",
  threadsSection.includes("lower(coalesce(from_email,'')) LIKE '%${lc}%'"),
);
check(
  "listLocalThreads free-text includes to_emails LIKE (parity with listLocalMessages)",
  threadsSection.includes("lower(coalesce(to_emails,'')) LIKE '%${lc}%'"),
);
check(
  "listLocalMessages free-text still has all three ILIKE fallbacks",
  LOCAL.includes("lower(coalesce(all_participants,'')) LIKE '%${lc}%' OR lower(coalesce(from_email,'')) LIKE '%${lc}%' OR lower(coalesce(to_emails,'')) LIKE '%${lc}%'"),
);

// ── routes.ts: overflow still skipped in unified-inbox mode ──
console.log("\n── routes.ts: unified-inbox still excluded from overflow ──");

check(
  "canOverflow still requires !isUnified",
  ROUTES.includes("const canOverflow = !isUnified"),
);
check(
  "isUnified derived from resolved.accountIds",
  ROUTES.includes("const isUnified = !!(resolved as any).accountIds"),
);

// ── routes.ts: isSpamOrTrashQuery still blocks overflow for category folders ──
console.log("\n── routes.ts: category folder queries still blocked ──");

check(
  "isSpamOrTrashQuery regex covers spam, trash, junk, updates, promotions, social, forums",
  ROUTES.includes("\\bin:(spam|trash|junk|updates|promotions|social|forums)\\b"),
);

// ── routes.ts: gmailFilter passes q verbatim to Gmail ──
console.log("\n── routes.ts: Gmail query verbatim pass-through ──");

check(
  "gmailFilter is set to q when query is non-empty",
  ROUTES.includes("const gmailFilter = queryEmpty ? undefined : q;"),
);

// ── Summary ──
console.log("\n────────────────────────────────────────────────────────────");
console.log(`search-completeness: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("Failed checks:");
  process.exitCode = 1;
}
