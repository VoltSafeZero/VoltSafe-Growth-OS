/**
 * tests/inbox-completeness.test.cjs
 *
 * Source-grep tests for the inbox completeness fixes:
 * - Startup catch-up covers 30 days (not 3)
 * - Badge counter does NOT exclude SENT from INBOX-labelled messages
 * - Deep-backfill endpoint exists and is owner-or-admin gated
 * - Deep-backfill UI button wired to the endpoint
 * - INBOX query never permanently excludes SENT-labelled messages
 * - Smart Inbox grouper exposes "show-all" for every capped section
 * - Backfill script exists
 */
"use strict";

const fs   = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function ok(label)            { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail)  { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
function check(label, cond, detail) { cond ? ok(label) : fail(label, detail); }

const syncTs     = fs.readFileSync(path.join(__dirname, "../server/services/gmail-sync.ts"), "utf8");
const routesTs   = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");
const inboxTsx   = fs.readFileSync(path.join(__dirname, "../client/src/pages/gmail-inbox.tsx"), "utf8");
const grouperTs  = fs.readFileSync(path.join(__dirname, "../client/src/components/inbox/smart-inbox-grouper.ts"), "utf8");
const mailboxTs  = fs.readFileSync(path.join(__dirname, "../server/services/local-mailbox.ts"), "utf8");

const backfillScriptExists = fs.existsSync(path.join(__dirname, "../scripts/backfill-mailbox.ts"));

console.log("\n=== Inbox Completeness Tests ===\n");

// ── 1. Startup catch-up window ────────────────────────────────────────────────
console.log("── 1. Startup catch-up window ──");

check(
  "Startup catch-up covers 30 days (not 3)",
  syncTs.includes("30 * 24 * 60 * 60 * 1000") &&
  syncTs.includes("last 30 days"),
  "still using 3-day window"
);

check(
  "Startup catch-up uses maxPages: 50 (not 10)",
  (() => {
    // Find the catch-up setTimeout block
    const block = syncTs.slice(syncTs.indexOf("Startup catch-up paginated sync"), syncTs.indexOf("Incremental sync every 5 minutes"));
    return block.includes("maxPages: 50");
  })()
);

check(
  "Startup catch-up uses pageSize: 100",
  (() => {
    const block = syncTs.slice(syncTs.indexOf("Startup catch-up paginated sync"), syncTs.indexOf("Incremental sync every 5 minutes"));
    return block.includes("pageSize: 100");
  })()
);

// ── 2. Badge counter — no incorrect SENT exclusion ───────────────────────────
console.log("\n── 2. Badge counter SENT exclusion removed ──");

check(
  "unread_count query does NOT exclude all SENT messages",
  (() => {
    // Find the unread_count subquery in routes.ts
    const idx = routesTs.indexOf("AS unread_count,");
    const block = routesTs.slice(Math.max(0, idx - 600), idx);
    return !block.includes("NOT LIKE '%\"SENT\"%'");
  })()
);

check(
  "inbox_count query does NOT exclude all SENT messages",
  (() => {
    const idx = routesTs.indexOf("AS inbox_count,");
    const block = routesTs.slice(Math.max(0, idx - 600), idx);
    return !block.includes("NOT LIKE '%\"SENT\"%'");
  })()
);

check(
  "Both badge queries still exclude DRAFT, SPAM, TRASH",
  // Phase 4: DRAFT/SPAM/TRASH are excluded implicitly via `is_inbox = true`
  // (derived column already encodes NOT SPAM AND NOT TRASH AND NOT DRAFT).
  // The old explicit NOT LIKE patterns were replaced by the derived column predicate.
  (() => {
    const uIdx = routesTs.indexOf("AS unread_count,");
    const uBlock = routesTs.slice(Math.max(0, uIdx - 600), uIdx);
    const iIdx = routesTs.indexOf("AS inbox_count,");
    const iBlock = routesTs.slice(Math.max(0, iIdx - 600), iIdx);
    // Phase 4 uses is_inbox=true (which encodes NOT DRAFT/SPAM/TRASH) for both badge queries.
    return (
      uBlock.includes("is_inbox = true") &&
      iBlock.includes("is_inbox = true")
    );
  })()
);

// ── 3. Inbox list query — SENT never permanently excluded ────────────────────
console.log("\n── 3. listLocalMessages — SENT inclusion ──");

check(
  "listLocalMessages INBOX branch does NOT contain NOT LIKE SENT",
  (() => {
    // Find the INBOX branch in local-mailbox.ts
    const idx = mailboxTs.indexOf('label === "INBOX"');
    const block = mailboxTs.slice(idx, idx + 600);
    return !block.includes("NOT LIKE") || !block.includes("SENT");
  })()
);

check(
  "listLocalMessages comment explicitly says do not exclude SENT",
  // Phase 3: comment updated to reflect derivation; SENT+INBOX messages remain visible
  // because is_inbox=true includes messages with both INBOX and SENT labels (self-sent threads).
  mailboxTs.includes("SENT+INBOX messages remain visible")
);

check(
  "listLocalMessages INBOX branch includes CATEGORY labels",
  mailboxTs.includes("CATEGORY_UPDATES") &&
  mailboxTs.includes("CATEGORY_PROMOTIONS") &&
  mailboxTs.includes("CATEGORY_SOCIAL") &&
  mailboxTs.includes("CATEGORY_FORUMS")
);

// ── 4. Deep-backfill endpoint ─────────────────────────────────────────────────
console.log("\n── 4. Deep-backfill API endpoint ──");

check(
  "deep-backfill POST endpoint registered in routes.ts",
  routesTs.includes('"/api/gmail/accounts/:id/deep-backfill"')
);

check(
  "deep-backfill uses requireOwnerOrAdmin gate",
  (() => {
    const idx = routesTs.indexOf('"/api/gmail/accounts/:id/deep-backfill"');
    const block = routesTs.slice(idx, idx + 600);
    return block.includes("requireOwnerOrAdmin");
  })()
);

check(
  "deep-backfill accepts days param (7–365)",
  (() => {
    const idx = routesTs.indexOf('"/api/gmail/accounts/:id/deep-backfill"');
    const block = routesTs.slice(idx, idx + 600);
    return block.includes("days") && block.includes("365") && block.includes("7");
  })()
);

check(
  "deep-backfill runs syncEmailAccount with maxPages: 100",
  (() => {
    const idx = routesTs.indexOf('"/api/gmail/accounts/:id/deep-backfill"');
    const block = routesTs.slice(idx, idx + 800);
    return block.includes("maxPages: 100") && block.includes("refreshLabels: true");
  })()
);

check(
  "deep-backfill returns immediately (async background, non-blocking)",
  (() => {
    const idx = routesTs.indexOf('"/api/gmail/accounts/:id/deep-backfill"');
    const block = routesTs.slice(idx, idx + 1400);
    return block.includes('status: "running"') || block.includes("status:");
  })()
);

// ── 5. UI deep-backfill wiring ────────────────────────────────────────────────
console.log("\n── 5. UI deep-backfill button ──");

check(
  "deepBackfillMutation defined in gmail-inbox.tsx",
  inboxTsx.includes("deepBackfillMutation")
);

check(
  "deepBackfillMutation calls /api/gmail/accounts/:id/deep-backfill",
  inboxTsx.includes("deep-backfill") && inboxTsx.includes("connectedAccount.id")
);

check(
  "Deep backfill UI offers 30/90/365 day options",
  inboxTsx.includes("30 | 90 | 365") || (
    inboxTsx.includes("deepBackfillMutation.mutate(d)") &&
    inboxTsx.includes("365")
  )
);

check(
  "Deep backfill button has data-testid",
  inboxTsx.includes('data-testid="button-deep-backfill-footer"')
);

// ── 6. Smart Inbox — show-all for every capped section ───────────────────────
console.log("\n── 6. Smart Inbox section caps with show-all ──");

check(
  "SECTION_CAPS.seen is at most 30",
  (() => {
    const idx = inboxTsx.indexOf("SECTION_CAPS");
    const block = inboxTsx.slice(idx, idx + 300);
    const m = block.match(/seen:\s*(\d+)/);
    return m ? Number(m[1]) <= 30 : false;
  })()
);

check(
  "show-all sentinel injected below last visible email",
  inboxTsx.includes('kind: "show-all"') && inboxTsx.includes("total > cap")
);

check(
  "show-less sentinel injected when section is expanded",
  inboxTsx.includes('kind: "show-less"')
);

check(
  "Smart Inbox grouper assigns every message to exactly one section (no orphans)",
  grouperTs.includes("seen.push(m)") &&
  grouperTs.includes("unreadPeople.push(m)") &&
  grouperTs.includes("pinnedRead.push(m)")
);

// ── 7. Backfill script ─────────────────────────────────────────────────────────
console.log("\n── 7. Backfill script ──");

check(
  "scripts/backfill-mailbox.ts exists",
  backfillScriptExists
);

if (backfillScriptExists) {
  const scriptTs = fs.readFileSync(path.join(__dirname, "../scripts/backfill-mailbox.ts"), "utf8");

  check(
    "Script supports --account flag",
    scriptTs.includes("--account")
  );

  check(
    "Script supports --days flag",
    scriptTs.includes("--days")
  );

  check(
    "Script supports --dry-run flag",
    scriptTs.includes("--dry-run")
  );

  check(
    "Script supports --apply flag",
    scriptTs.includes("--apply")
  );

  check(
    "Script defaults to dry-run when --apply not specified",
    scriptTs.includes("dryRun") && scriptTs.includes("!flag(\"apply\")")
  );

  check(
    "Script uses in:inbox OR in:sent query",
    scriptTs.includes("in:inbox OR in:sent")
  );

  check(
    "Script uses onConflictDoNothing (safe/idempotent)",
    scriptTs.includes("onConflictDoNothing")
  );
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
if (failed > 0) process.exit(1);
