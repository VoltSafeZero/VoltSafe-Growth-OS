#!/usr/bin/env node
/**
 * Inbox Visibility — regression tests (updated Phase 2)
 *
 * Verifies that:
 *   V1. `deriveEmailLabels` in inbox-policy.ts implements the canonical
 *       VoltSafe inbox policy (Phase 2 replaced ensureInboxForCategoryLabels).
 *   V2. The inbox query in local-mailbox.ts includes CATEGORY_* labels
 *       so category-tagged messages always appear in the inbox view.
 *   V3. The `move-to-primary` route does NOT remove CATEGORY_* labels
 *       (categories are metadata tags, not folders).
 *   V4. The `upsertMessageById` code path populates derived label columns
 *       on every insert (Phase 2 wiring — no ensureInboxForCategoryLabels).
 *   V5. The label-change path in `syncIncremental` populates derived label
 *       columns on every label update.
 *   V6. The Phase 1 backfill script exists.
 *   V7. DB state: no UNREAD inbound category-only messages are missing
 *       is_inbox=true after the canonical backfill.
 *
 * Run: node tests/inbox-visibility.test.cjs
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const pg   = require("pg").default ?? require("pg");

let passed = 0, failed = 0;
const ok  = (label)         => { console.log(`  ✓ ${label}`); passed++; };
const bad = (label, detail) => { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; };

function src(relPath) {
  return fs.readFileSync(path.join(__dirname, "..", relPath), "utf8");
}

// ── V1: deriveEmailLabels in inbox-policy.ts ──────────────────────────────────
console.log("\n── V1: deriveEmailLabels — canonical policy (Phase 2) ───────────");
{
  const policy = src("server/services/inbox-policy.ts");

  if (/export\s+function\s+deriveEmailLabels/.test(policy))
    ok("deriveEmailLabels is exported from inbox-policy.ts");
  else
    bad("deriveEmailLabels must be exported from inbox-policy.ts");

  if (/INBOX_INCLUDES_CATEGORY_SKIP\s*=\s*true/.test(policy))
    ok("INBOX_INCLUDES_CATEGORY_SKIP = true");
  else
    bad("INBOX_INCLUDES_CATEGORY_SKIP must be true");

  if (/CATEGORY_PERSONAL/.test(policy))
    ok("CATEGORY_PERSONAL is in member list");
  else
    bad("CATEGORY_PERSONAL must be in inbox member list");

  // SENT must NOT be in the deny-list (Phase 2 correction)
  if (!/VOLTSAFE_INBOX_EXCLUDE_LABELS[\s\S]{0,200}"SENT"/.test(policy))
    ok("SENT is not in VOLTSAFE_INBOX_EXCLUDE_LABELS (SENT+INBOX stays visible)");
  else
    bad("SENT must NOT be in VOLTSAFE_INBOX_EXCLUDE_LABELS");

  // is_inbox must NOT use !is_sent
  if (!policy.includes("!is_sent"))
    ok("is_inbox derivation does not use !is_sent");
  else
    bad("is_inbox derivation must not use !is_sent (SENT+INBOX must be visible)");

  if (/export\s+function\s+toDrizzleLabels/.test(policy))
    ok("toDrizzleLabels Drizzle-shape helper is exported");
  else
    bad("toDrizzleLabels must be exported from inbox-policy.ts");

  // ensureInboxForCategoryLabels must be gone
  const incFile = src("server/services/gmail-incremental.ts");
  if (!incFile.includes("ensureInboxForCategoryLabels"))
    ok("ensureInboxForCategoryLabels removed from gmail-incremental.ts");
  else
    bad("ensureInboxForCategoryLabels must be removed — Phase 2 uses deriveEmailLabels instead");
}

// ── V2: inbox query includes CATEGORY_* labels ────────────────────────────────
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

  // Phase 3: DRAFT/SPAM exclusion is now implicit in is_inbox=true (derived column).
  // Verify the INBOX branch uses is_inbox = true instead of raw label_ids ILIKE.
  if (/if \(label === "INBOX"\)[\s\S]{0,700}is_inbox = true/.test(lm))
    ok("inbox query excludes DRAFT (implicit via is_inbox=true derived column)");
  else
    bad("INBOX branch must use is_inbox = true (Phase 3 — DRAFT excluded implicitly)");

  if (/if \(label === "INBOX"\)[\s\S]{0,700}is_inbox = true/.test(lm))
    ok("inbox query excludes SPAM (implicit via is_inbox=true derived column)");
  else
    bad("INBOX branch must use is_inbox = true (Phase 3 — SPAM excluded implicitly)");
}

// ── V3: move-to-primary does NOT strip CATEGORY_* ────────────────────────────
console.log("\n── V3: move-to-primary does not strip categories ────────────────");
{
  const routes = src("server/routes.ts");

  const blockStart = routes.indexOf("/api/inbox/threads/:threadId/move-to-primary");
  const blockEnd   = routes.indexOf("\n  });", blockStart + 1);
  const block      = blockStart >= 0 ? routes.slice(blockStart, blockEnd + 6) : "";

  if (block) ok("move-to-primary route found");
  else       bad("move-to-primary route not found in routes.ts");

  const hasCatRemove = /removeLabelIds\s*=\s*\[.*CATEGORY_/.test(block);
  if (!hasCatRemove)
    ok("removeLabelIds does not contain CATEGORY_* labels");
  else
    bad("removeLabelIds must NOT include CATEGORY_* — categories are tags, not folders");

  if (/addLabelIds\s*=\s*\[.*["']INBOX["']/.test(block))
    ok("addLabelIds contains INBOX");
  else
    bad("addLabelIds must contain INBOX");
}

// ── V4: upsertMessageById wires derived columns on insert ────────────────────
console.log("\n── V4: upsertMessageById wires derived columns (Phase 2) ───────");
{
  const inc = src("server/services/gmail-incremental.ts");

  if (/import.*deriveEmailLabels.*from.*inbox-policy/.test(inc) ||
      /import.*toDrizzleLabels.*from.*inbox-policy/.test(inc))
    ok("gmail-incremental.ts imports from inbox-policy");
  else
    bad("gmail-incremental.ts must import deriveEmailLabels / toDrizzleLabels from inbox-policy");

  if (/toDrizzleLabels\(deriveEmailLabels\(/.test(inc))
    ok("toDrizzleLabels(deriveEmailLabels(...)) pattern present in write paths");
  else
    bad("upsertMessageById must call toDrizzleLabels(deriveEmailLabels(...)) on inserts/updates");

  // Must spread derived into .values()
  if (/\.values\(\s*\{.*\.\.\.derived/.test(inc.replace(/\n/g, " ")))
    ok("derived labels spread into .values() on insert");
  else
    bad("derived labels must be spread into .values() on INSERT");
}

// ── V5: label-change path wires derived columns ───────────────────────────────
console.log("\n── V5: label-change path wires derived columns (Phase 2) ───────");
{
  const inc = src("server/services/gmail-incremental.ts");

  // The label-change UPDATE .set() must include derived labels
  const hasDerivedInLabelSet =
    /newLabelsJson.*\n.*derived.*=.*toDrizzleLabels|toDrizzleLabels.*deriveEmailLabels.*newLabels/.test(inc);
  if (hasDerivedInLabelSet)
    ok("label-change path computes and writes derived labels");
  else
    bad("label-change path must call toDrizzleLabels(deriveEmailLabels(newLabelsJson))");

  // gmail-sync.ts label refresh also wires derived
  const sync = src("server/services/gmail-sync.ts");
  if (/import.*deriveEmailLabels.*from.*inbox-policy/.test(sync) ||
      /import.*toDrizzleLabels.*from.*inbox-policy/.test(sync))
    ok("gmail-sync.ts imports from inbox-policy");
  else
    bad("gmail-sync.ts must import deriveEmailLabels / toDrizzleLabels from inbox-policy");

  if (/toDrizzleLabels\(deriveEmailLabels\(/.test(sync))
    ok("gmail-sync.ts wires derived labels in write paths");
  else
    bad("gmail-sync.ts must call toDrizzleLabels(deriveEmailLabels(...)) in label refresh path");
}

// ── V6: backfill script exists ────────────────────────────────────────────────
console.log("\n── V6: Phase 1 backfill scripts exist ───────────────────────────");
{
  const p1 = path.join(__dirname, "..", "scripts/inbox-policy-backfill.ts");
  if (fs.existsSync(p1))
    ok("scripts/inbox-policy-backfill.ts exists");
  else
    bad("scripts/inbox-policy-backfill.ts must exist");

  const migPath = path.join(__dirname, "..", "migrations/0016_derived_label_columns.sql");
  if (fs.existsSync(migPath))
    ok("migrations/0016_derived_label_columns.sql exists");
  else
    bad("migrations/0016_derived_label_columns.sql must exist");

  if (fs.existsSync(migPath)) {
    const migSql = fs.readFileSync(migPath, "utf8");
    if (!migSql.includes("AND label_ids NOT LIKE '%\"SENT\"%'"))
      ok("migration backfill does not exclude SENT (corrected policy)");
    else
      bad("migration backfill SQL still has AND NOT SENT — must be removed per Phase 2 correction");
  }
}

// ── V7: DB state — category-only UNREAD messages now have is_inbox=true ──────
console.log("\n── V7: DB state — category-only UNREAD rows captured by is_inbox ─");
(async () => {
  let client;
  try {
    client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    // Check derived column is fully populated (no NULLs)
    const { rows: nullRows } = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM email_messages WHERE is_inbox IS NULL`
    );
    const nullCnt = nullRows[0]?.cnt ?? 0;
    if (nullCnt === 0)
      ok("0 rows with is_inbox IS NULL (backfill complete)");
    else
      bad(`${nullCnt} rows still have is_inbox IS NULL — run backfill`);

    // Verify CATEGORY_*-only UNREAD messages are now is_inbox=true
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
          OR label_ids ILIKE '%CATEGORY_PERSONAL%'
        )
        AND label_ids NOT ILIKE '%"SPAM"%'
        AND label_ids NOT ILIKE '%"TRASH"%'
        AND label_ids NOT ILIKE '%"DRAFT"%'
        AND label_ids NOT ILIKE '%"SENT"%'
        AND label_ids ILIKE '%UNREAD%'
        AND is_inbox = false
    `);
    const cnt = rows[0]?.cnt ?? 0;
    if (cnt === 0)
      ok("0 unread inbound category-only messages have is_inbox=false (all captured)");
    else
      bad(`${cnt} unread inbound category-only messages have is_inbox=false — policy mismatch`);

    // Verify INBOX+SENT messages are is_inbox=true (Phase 2 policy correction)
    const { rows: selfSentRows } = await client.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE is_inbox = true)::int AS inbox_true
      FROM email_messages
      WHERE label_ids LIKE '%"INBOX"%'
        AND label_ids LIKE '%"SENT"%'
        AND is_spam  = false
        AND is_trash = false
        AND is_draft = false
    `);
    const { total, inbox_true } = selfSentRows[0];
    if (total > 0 && total === inbox_true)
      ok(`${total} INBOX+SENT messages all have is_inbox=true (self-sent visible in inbox)`);
    else if (total === 0)
      ok("no INBOX+SENT messages in DB (nothing to verify)");
    else
      bad(`INBOX+SENT: ${inbox_true}/${total} have is_inbox=true — Phase 2 policy correction incomplete`);

  } catch (err) {
    bad("DB query failed", err.message);
  } finally {
    await client?.end();
  }

  console.log(`\n── Results: ${passed} passed, ${failed} failed ────────────────────────`);
  process.exit(failed > 0 ? 1 : 0);
})();
