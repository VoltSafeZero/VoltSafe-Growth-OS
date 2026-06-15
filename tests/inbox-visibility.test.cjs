#!/usr/bin/env node
/**
 * Inbox Visibility — regression tests
 *
 * Verifies that:
 *   V1. `ensureInboxForCategoryLabels` correctly adds INBOX to inbound
 *       category-tagged messages and leaves other cases untouched.
 *   V2. The inbox query in local-mailbox.ts includes CATEGORY_* labels
 *       so category-tagged messages always appear in the inbox view.
 *   V3. The `move-to-primary` route does NOT remove CATEGORY_* labels
 *       (categories are metadata tags, not folders).
 *   V4. The `upsertMessageById` code path applies the INBOX guard for
 *       new insertions.
 *   V5. The label-change path in `syncIncremental` applies the INBOX guard
 *       with `requireUnread=true` to avoid restoring archived messages.
 *   V6. The backfill script exists and is idempotent (source-grep).
 *   V7. DB state: no UNREAD inbound category-only messages are missing INBOX
 *       after the backfill has been applied.
 *
 * Run: node tests/inbox-visibility.test.cjs
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const pg   = require("pg").default ?? require("pg");

let passed = 0, failed = 0;
const ok  = (label)       => { console.log(`  ✓ ${label}`); passed++; };
const bad = (label, detail) => { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; };

// ── Helper: read a source file ─────────────────────────────────────────────
function src(relPath) {
  return fs.readFileSync(path.join(__dirname, "..", relPath), "utf8");
}

// ── V1: ensureInboxForCategoryLabels logic (source-grep) ──────────────────
console.log("\n── V1: ensureInboxForCategoryLabels function ────────────────────");
{
  const inc = src("server/services/gmail-incremental.ts");

  // Function is exported
  if (/export\s+function\s+ensureInboxForCategoryLabels/.test(inc))
    ok("ensureInboxForCategoryLabels is exported");
  else
    bad("ensureInboxForCategoryLabels must be exported from gmail-incremental.ts");

  // Handles requireUnread parameter
  if (/requireUnread/.test(inc))
    ok("function accepts requireUnread parameter");
  else
    bad("function must accept requireUnread parameter");

  // Returns labels unchanged when INBOX already present
  if (/upper\.includes\("INBOX"\)\s*\)?\s*return labels/.test(inc))
    ok("returns unchanged when INBOX already present");
  else
    bad("must return early when INBOX already present");

  // Skips SENT/DRAFT/SPAM/TRASH
  if (/SKIP_INBOX_LABELS/.test(inc) || /["']SENT["']/.test(inc))
    ok("skips SENT/DRAFT/SPAM/TRASH messages");
  else
    bad("must skip SENT/DRAFT/SPAM/TRASH");
}

// ── V2: inbox query includes CATEGORY_* labels ────────────────────────────
console.log("\n── V2: inbox query in local-mailbox.ts ──────────────────────────");
{
  const lm = src("server/services/local-mailbox.ts");

  if (/CATEGORY_UPDATES/.test(lm))
    ok("inbox query includes CATEGORY_UPDATES");
  else
    bad("inbox query must include CATEGORY_UPDATES");

  if (/CATEGORY_PROMOTIONS/.test(lm))
    ok("inbox query includes CATEGORY_PROMOTIONS");
  else
    bad("inbox query must include CATEGORY_PROMOTIONS");

  if (/CATEGORY_SOCIAL/.test(lm))
    ok("inbox query includes CATEGORY_SOCIAL");
  else
    bad("inbox query must include CATEGORY_SOCIAL");

  if (/CATEGORY_FORUMS/.test(lm))
    ok("inbox query includes CATEGORY_FORUMS");
  else
    bad("inbox query must include CATEGORY_FORUMS");

  // Must exclude DRAFT/SPAM/TRASH
  if (/NOT ILIKE.*DRAFT/.test(lm))
    ok("inbox query excludes DRAFT");
  else
    bad("inbox query must exclude DRAFT");

  if (/NOT ILIKE.*SPAM/.test(lm))
    ok("inbox query excludes SPAM");
  else
    bad("inbox query must exclude SPAM");
}

// ── V3: move-to-primary does NOT strip CATEGORY_* ─────────────────────────
console.log("\n── V3: move-to-primary does not strip categories ────────────────");
{
  const routes = src("server/routes.ts");

  // Locate the move-to-primary handler block
  const blockStart = routes.indexOf("/api/inbox/threads/:threadId/move-to-primary");
  const blockEnd   = routes.indexOf("\n  });", blockStart + 1);
  const block      = blockStart >= 0 ? routes.slice(blockStart, blockEnd + 6) : "";

  if (block) ok("move-to-primary route found");
  else       { bad("move-to-primary route not found in routes.ts"); }

  // removeLabelIds must be an empty array or omit CATEGORY_*
  const hasCatRemove = /removeLabelIds\s*=\s*\[.*CATEGORY_/.test(block);
  if (!hasCatRemove)
    ok("removeLabelIds does not contain CATEGORY_* labels");
  else
    bad("removeLabelIds must NOT include CATEGORY_* — categories are tags, not folders");

  // addLabelIds must contain INBOX
  if (/addLabelIds\s*=\s*\[.*["']INBOX["']/.test(block))
    ok("addLabelIds contains INBOX");
  else
    bad("addLabelIds must contain INBOX");
}

// ── V4: upsertMessageById applies the INBOX guard on insertion ────────────
console.log("\n── V4: upsertMessageById applies INBOX guard on insert ──────────");
{
  const inc = src("server/services/gmail-incremental.ts");

  if (/ensureInboxForCategoryLabels\(insertLabels/.test(inc))
    ok("INBOX guard applied to insertLabels in upsertMessageById");
  else
    bad("upsertMessageById must call ensureInboxForCategoryLabels on new insertions");

  // Guard applied before the !existing insert branch
  const guardIdx  = inc.indexOf("ensureInboxForCategoryLabels(insertLabels");
  const insertIdx = inc.indexOf("if (!existing)");
  if (guardIdx >= 0 && insertIdx >= 0 && guardIdx < insertIdx)
    ok("INBOX guard runs before the !existing insert branch");
  else
    bad("INBOX guard must run before the !existing insert branch in upsertMessageById");
}

// ── V5: label-change path applies guard with requireUnread=true ───────────
console.log("\n── V5: label-change path uses requireUnread guard ───────────────");
{
  const inc = src("server/services/gmail-incremental.ts");

  // Must call ensureInboxForCategoryLabels with true in the label-change area
  if (/ensureInboxForCategoryLabels\(newLabels,\s*true/.test(inc))
    ok("label-change path calls ensureInboxForCategoryLabels(newLabels, true)");
  else
    bad("label-change path must call ensureInboxForCategoryLabels(newLabels, true)");

  // requireUnread comment / reference present
  if (/requireUnread/.test(inc))
    ok("requireUnread is referenced in the source");
  else
    bad("requireUnread must be referenced in gmail-incremental.ts");
}

// ── V6: backfill script exists and is idempotent ──────────────────────────
console.log("\n── V6: backfill script ──────────────────────────────────────────");
{
  const scriptPath = "scripts/inbox-visibility-backfill.ts";
  const exists = fs.existsSync(path.join(__dirname, "..", scriptPath));

  if (exists) ok("inbox-visibility-backfill.ts exists");
  else        { bad("scripts/inbox-visibility-backfill.ts must exist"); }

  if (exists) {
    const bk = src(scriptPath);

    // Idempotency: WHERE clause must guard against re-adding INBOX
    if (/NOT ILIKE.*INBOX/.test(bk))
      ok("backfill WHERE clause guards against re-adding INBOX (idempotent)");
    else
      bad("backfill script must be idempotent — WHERE clause must exclude messages that already have INBOX");

    // Only processes UNREAD messages
    if (/UNREAD/.test(bk))
      ok("backfill scoped to UNREAD messages only");
    else
      bad("backfill must be scoped to UNREAD messages to avoid restoring archived mail");

    // Excludes SENT/SPAM/TRASH/DRAFT
    if (/SENT/.test(bk) && /SPAM/.test(bk) && /TRASH/.test(bk))
      ok("backfill excludes SENT/SPAM/TRASH");
    else
      bad("backfill must exclude SENT, SPAM, TRASH");
  }
}

// ── V7: DB state check ────────────────────────────────────────────────────
console.log("\n── V7: DB state — unread category-only messages have INBOX ─────");
(async () => {
  let client;
  try {
    client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    const { rows } = await client.query(`
      SELECT COUNT(*)::int AS cnt
      FROM email_messages
      WHERE
        label_ids NOT ILIKE '%"INBOX"%' AND label_ids NOT ILIKE '%INBOX%'
        AND (
          label_ids ILIKE '%CATEGORY_UPDATES%'
          OR label_ids ILIKE '%CATEGORY_PROMOTIONS%'
          OR label_ids ILIKE '%CATEGORY_SOCIAL%'
          OR label_ids ILIKE '%CATEGORY_FORUMS%'
        )
        AND label_ids NOT ILIKE '%"SPAM"%'
        AND label_ids NOT ILIKE '%"TRASH"%'
        AND label_ids NOT ILIKE '%"DRAFT"%'
        AND label_ids NOT ILIKE '%"SENT"%'
        AND label_ids ILIKE '%UNREAD%'
    `);
    const cnt = rows[0]?.cnt ?? 0;
    if (cnt === 0)
      ok("0 unread inbound category-only messages missing INBOX (backfill complete)");
    else
      bad(`${cnt} unread inbound category-only messages still missing INBOX — run inbox-visibility-backfill.ts`, String(cnt));
  } catch (err) {
    bad("DB query failed", err.message);
  } finally {
    await client?.end();
  }

  console.log(`\n── Results: ${passed} passed, ${failed} failed ────────────────────────`);
  process.exit(failed > 0 ? 1 : 0);
})();
