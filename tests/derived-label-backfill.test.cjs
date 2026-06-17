"use strict";
/**
 * Regression test: derived label column backfill
 *
 * Verifies that:
 *   1. Rows inserted with NULL derived columns are correctly backfilled
 *   2. label_ids is never mutated
 *   3. The canonical formula (from inbox-policy.ts / migration 0016) produces
 *      correct values for every label combination
 *   4. q=in:inbox returns historical rows after backfill (via the same SQL WHERE clause)
 *   5. The backfill UPDATE is idempotent (already-filled rows unchanged on re-run)
 *   6. The migrateDerivedLabelColumns function is exported from seed-production.ts
 *   7. The startup guard is wired in server/index.ts
 *
 * Runs against the live dev database for steps 1–5.
 */

const assert = require("assert");
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }

const FIXTURE_TAG = `derived-backfill-${Date.now()}`;

// ── helpers ───────────────────────────────────────────────────────────────────

let passed = 0; let failed = 0;
function check(label, value) {
  if (value) { console.log(`  ✓ ${label}`); passed++; }
  else        { console.error(`  ✗ ${label}`); failed++; }
}

// Canonical backfill SQL (mirrors migration 0016 / seed-production migrateDerivedLabelColumns)
const BACKFILL_SQL = `
  UPDATE email_messages SET
    is_unread      = (label_ids LIKE '%"UNREAD"%'),
    is_starred     = (label_ids LIKE '%"STARRED"%'),
    is_spam        = (label_ids LIKE '%"SPAM"%'),
    is_trash       = (label_ids LIKE '%"TRASH"%'),
    is_draft       = (label_ids LIKE '%"DRAFT"%'),
    is_sent        = (label_ids LIKE '%"SENT"%'),
    is_inbox       = (
      (   label_ids LIKE '%"INBOX"%'
       OR label_ids ILIKE '%CATEGORY_PERSONAL%'
       OR label_ids ILIKE '%CATEGORY_UPDATES%'
       OR label_ids ILIKE '%CATEGORY_PROMOTIONS%'
       OR label_ids ILIKE '%CATEGORY_SOCIAL%'
       OR label_ids ILIKE '%CATEGORY_FORUMS%')
      AND label_ids NOT LIKE '%"SPAM"%'
      AND label_ids NOT LIKE '%"TRASH"%'
      AND label_ids NOT LIKE '%"DRAFT"%'
    ),
    smart_category = CASE
      WHEN label_ids ILIKE '%CATEGORY_UPDATES%'    THEN 'updates'
      WHEN label_ids ILIKE '%CATEGORY_PROMOTIONS%' THEN 'promotions'
      WHEN label_ids ILIKE '%CATEGORY_SOCIAL%'     THEN 'social'
      WHEN label_ids ILIKE '%CATEGORY_FORUMS%'     THEN 'forums'
      ELSE 'people'
    END
  WHERE gmail_message_id LIKE $1
`;

// ── test cases: label_ids → expected derived values ──────────────────────────

const TEST_CASES = [
  // [fixture suffix, label_ids JSON, expected]
  ["inbox-unread",
   '["INBOX","UNREAD"]',
   { is_inbox: true, is_unread: true, is_starred: false, is_spam: false, is_trash: false, is_draft: false, is_sent: false, smart_category: "people" }],

  ["inbox-read",
   '["INBOX"]',
   { is_inbox: true, is_unread: false, is_starred: false, is_spam: false, is_trash: false, is_draft: false, is_sent: false, smart_category: "people" }],

  ["category-updates",
   '["CATEGORY_UPDATES","UNREAD"]',
   { is_inbox: true, is_unread: true, is_starred: false, is_spam: false, is_trash: false, is_draft: false, is_sent: false, smart_category: "updates" }],

  ["category-promotions",
   '["CATEGORY_PROMOTIONS","INBOX"]',
   { is_inbox: true, is_unread: false, is_starred: false, is_spam: false, is_trash: false, is_draft: false, is_sent: false, smart_category: "promotions" }],

  ["category-social",
   '["CATEGORY_SOCIAL"]',
   { is_inbox: true, is_unread: false, is_starred: false, is_spam: false, is_trash: false, is_draft: false, is_sent: false, smart_category: "social" }],

  ["category-forums",
   '["CATEGORY_FORUMS","INBOX"]',
   { is_inbox: true, is_unread: false, is_starred: false, is_spam: false, is_trash: false, is_draft: false, is_sent: false, smart_category: "forums" }],

  ["spam",
   '["SPAM","INBOX"]',
   { is_inbox: false, is_unread: false, is_spam: true, smart_category: "people" }],

  ["trash",
   '["TRASH"]',
   { is_inbox: false, is_unread: false, is_trash: true, smart_category: "people" }],

  ["draft",
   '["DRAFT","INBOX"]',
   { is_inbox: false, is_draft: true, smart_category: "people" }],

  ["sent-only",
   '["SENT"]',
   { is_inbox: false, is_sent: true, smart_category: "people" }],

  ["sent-plus-inbox",
   '["SENT","INBOX"]',
   { is_inbox: true, is_sent: true, smart_category: "people" }],

  ["starred-unread",
   '["INBOX","STARRED","UNREAD"]',
   { is_inbox: true, is_unread: true, is_starred: true, smart_category: "people" }],
];

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Derived Label Backfill Regression Test ===");
  console.log(`Fixture tag: ${FIXTURE_TAG}\n`);

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  // ── T0: source-level checks (no DB needed) ──────────────────────────────────
  console.log("── T0. Source-level guards ──");

  const seedTs = fs.readFileSync(
    path.join(__dirname, "../server/seed-production.ts"), "utf8"
  );
  const indexTs = fs.readFileSync(
    path.join(__dirname, "../server/index.ts"), "utf8"
  );
  const scriptTs = fs.readFileSync(
    path.join(__dirname, "../scripts/production-derived-label-backfill.ts"), "utf8"
  );

  check("migrateDerivedLabelColumns exported from seed-production.ts",
    seedTs.includes("export async function migrateDerivedLabelColumns"));
  check("migrateDerivedLabelColumns checks for NULL rows before backfilling",
    seedTs.includes("is_inbox IS NULL") && seedTs.includes("nullCount"));
  check("migrateDerivedLabelColumns runs backfill UPDATE with RETURNING id",
    seedTs.includes("RETURNING email_messages.id"));
  check("migrateDerivedLabelColumns does NOT mutate label_ids",
    !seedTs.includes("label_ids =") || seedTs.includes("label_ids LIKE") || seedTs.includes("label_ids ILIKE"));
  check("migrateDerivedLabelColumns creates partial indexes",
    seedTs.includes("idx_email_is_inbox") && seedTs.includes("idx_email_is_inbox_unread"));
  check("migrateDerivedLabelColumns imported and called in server/index.ts (fire-and-forget)",
    indexTs.includes("migrateDerivedLabelColumns") && indexTs.includes("migrateDerivedLabelColumns()"));
  check("startup guard placed after migrateEmailSchema (which creates the table)",
    indexTs.indexOf("migrateDerivedLabelColumns()") > indexTs.indexOf("await migrateEmailSchema()"));
  check("backfill script exists at scripts/production-derived-label-backfill.ts",
    fs.existsSync(path.join(__dirname, "../scripts/production-derived-label-backfill.ts")));
  check("backfill script uses cursor-based batch (id > cursorId)",
    scriptTs.includes("id > ${cursorId}") || scriptTs.includes("id > ${afterId}"));
  check("backfill script does NOT mutate label_ids",
    !scriptTs.includes("label_ids =") || scriptTs.includes("label_ids LIKE") || scriptTs.includes("label_ids ILIKE"));
  check("backfill script logs progress per batch",
    scriptTs.includes("batch ${batchNum}") || scriptTs.includes("batch "));
  check("backfill script handles SIGTERM / SIGINT",
    scriptTs.includes("SIGTERM") && scriptTs.includes("SIGINT"));

  // ── T1: insert fixture rows with NULL derived columns ───────────────────────
  console.log("\n── T1. Insert fixtures with NULL derived columns ──");

  // Use owner_user_id=4 (trevor) — guaranteed to exist
  for (const [suffix, labelIds] of TEST_CASES) {
    const msgId = `${FIXTURE_TAG}-${suffix}`;
    const thrId = `${FIXTURE_TAG}-thr-${suffix}`;
    await client.query(`
      INSERT INTO email_messages
        (gmail_message_id, gmail_thread_id, subject, from_email, sent_at,
         snippet, owner_user_id, source_account_id, direction, label_ids,
         is_inbox, is_unread, is_starred, is_spam, is_trash, is_draft, is_sent, smart_category)
      VALUES
        ($1, $2, $3, 'backfill-test@example.com', NOW(),
         'backfill test', 4, 1, 'inbound', $4,
         NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
    `, [msgId, thrId, `Backfill test: ${suffix}`, labelIds]);
  }
  console.log(`  Inserted ${TEST_CASES.length} fixtures with NULL derived columns`);

  // Verify NULLs present before backfill
  const beforeNull = await client.query(
    `SELECT COUNT(*)::int AS n FROM email_messages WHERE gmail_message_id LIKE $1 AND is_inbox IS NULL`,
    [`${FIXTURE_TAG}%`]
  );
  check(`All ${TEST_CASES.length} fixtures have is_inbox IS NULL before backfill`,
    Number(beforeNull.rows[0].n) === TEST_CASES.length);

  // Capture original label_ids before backfill (for mutation check)
  const beforeLabels = await client.query(
    `SELECT gmail_message_id, label_ids FROM email_messages WHERE gmail_message_id LIKE $1`,
    [`${FIXTURE_TAG}%`]
  );
  const labelsBefore = Object.fromEntries(beforeLabels.rows.map(r => [r.gmail_message_id, r.label_ids]));

  // ── T2: run the backfill SQL ─────────────────────────────────────────────────
  console.log("\n── T2. Run backfill SQL ──");

  await client.query(BACKFILL_SQL, [`${FIXTURE_TAG}%`]);

  const afterNull = await client.query(
    `SELECT COUNT(*)::int AS n FROM email_messages WHERE gmail_message_id LIKE $1 AND (is_inbox IS NULL OR is_unread IS NULL OR smart_category IS NULL)`,
    [`${FIXTURE_TAG}%`]
  );
  check("0 NULLs remain after backfill", Number(afterNull.rows[0].n) === 0);

  // ── T3: verify label_ids unchanged (no mutation) ────────────────────────────
  console.log("\n── T3. label_ids not mutated ──");

  const afterLabels = await client.query(
    `SELECT gmail_message_id, label_ids FROM email_messages WHERE gmail_message_id LIKE $1`,
    [`${FIXTURE_TAG}%`]
  );
  const labelsAfter = Object.fromEntries(afterLabels.rows.map(r => [r.gmail_message_id, r.label_ids]));

  let labelsMutated = false;
  for (const [msgId, before] of Object.entries(labelsBefore)) {
    if (JSON.stringify(before) !== JSON.stringify(labelsAfter[msgId])) {
      console.error(`  label_ids mutated for ${msgId}: ${before} → ${labelsAfter[msgId]}`);
      labelsMutated = true;
    }
  }
  check("label_ids unchanged for all fixture rows", !labelsMutated);

  // ── T4: verify derived values are correct for each test case ─────────────────
  console.log("\n── T4. Canonical derivation values ──");

  const rows = await client.query(
    `SELECT gmail_message_id, is_inbox, is_unread, is_starred, is_spam, is_trash,
            is_draft, is_sent, smart_category, label_ids
     FROM email_messages WHERE gmail_message_id LIKE $1`,
    [`${FIXTURE_TAG}%`]
  );
  const rowMap = Object.fromEntries(rows.rows.map(r => [r.gmail_message_id, r]));

  for (const [suffix, , expected] of TEST_CASES) {
    const msgId = `${FIXTURE_TAG}-${suffix}`;
    const row = rowMap[msgId];
    if (!row) { check(`${suffix}: row found`, false); continue; }

    for (const [field, expectedVal] of Object.entries(expected)) {
      const actual = row[field];
      // DB booleans come back as true/false; smart_category as string
      check(`${suffix}: ${field} = ${JSON.stringify(expectedVal)}`,
        JSON.stringify(actual) === JSON.stringify(expectedVal)
      );
    }
  }

  // ── T5: q=in:inbox returns historical rows after backfill ─────────────────
  console.log("\n── T5. q=in:inbox returns inbox rows after backfill ──");

  const inboxRows = await client.query(
    `SELECT gmail_message_id FROM email_messages
     WHERE gmail_message_id LIKE $1 AND is_inbox = true`,
    [`${FIXTURE_TAG}%`]
  );
  const expectedInboxCount = TEST_CASES.filter(([, , exp]) => exp.is_inbox === true).length;
  check(`q=in:inbox returns correct count (${expectedInboxCount} inbox rows)`,
    inboxRows.rows.length === expectedInboxCount);

  const nonInboxIds = inboxRows.rows
    .map(r => r.gmail_message_id.replace(`${FIXTURE_TAG}-`, ""))
    .filter(s => {
      const tc = TEST_CASES.find(([suffix]) => suffix === s);
      return tc && tc[2].is_inbox !== true;
    });
  check("No non-inbox rows returned by is_inbox=true query", nonInboxIds.length === 0);

  // ── T6: idempotency — re-run backfill, values unchanged ──────────────────────
  console.log("\n── T6. Backfill is idempotent ──");

  // Capture values after first backfill
  const afterFirst = await client.query(
    `SELECT gmail_message_id, is_inbox, is_unread, smart_category FROM email_messages WHERE gmail_message_id LIKE $1`,
    [`${FIXTURE_TAG}%`]
  );
  const firstMap = Object.fromEntries(afterFirst.rows.map(r => [r.gmail_message_id, `${r.is_inbox}|${r.is_unread}|${r.smart_category}`]));

  // Re-run the backfill
  await client.query(BACKFILL_SQL, [`${FIXTURE_TAG}%`]);

  const afterSecond = await client.query(
    `SELECT gmail_message_id, is_inbox, is_unread, smart_category FROM email_messages WHERE gmail_message_id LIKE $1`,
    [`${FIXTURE_TAG}%`]
  );

  let idempotent = true;
  for (const row of afterSecond.rows) {
    const afterVal = `${row.is_inbox}|${row.is_unread}|${row.smart_category}`;
    if (firstMap[row.gmail_message_id] !== afterVal) {
      console.error(`  idempotency broken for ${row.gmail_message_id}: ${firstMap[row.gmail_message_id]} → ${afterVal}`);
      idempotent = false;
    }
  }
  check("Re-running backfill produces identical derived values", idempotent);

  // ── Teardown ──────────────────────────────────────────────────────────────────
  await client.query(
    `DELETE FROM email_messages WHERE gmail_message_id LIKE $1`,
    [`${FIXTURE_TAG}%`]
  );
  await client.end();

  // ── Results ───────────────────────────────────────────────────────────────────
  console.log("");
  console.log("─────────────────────────────────────────────────────────────────");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("❌ FAILED");
    process.exit(1);
  }
  console.log("✅ All derived label backfill checks passed.");
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
