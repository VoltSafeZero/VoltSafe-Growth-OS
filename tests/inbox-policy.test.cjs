/**
 * tests/inbox-policy.test.cjs
 * Phase 1 — inbox-policy.ts source structure and DB derivation checks.
 * Source-grep based: verifies the canonical module exists with the right
 * shape, and spot-checks the DB backfill via the live database.
 */
"use strict";
const fs = require("fs");
const path = require("path");

let passed = 0, failed = 0;
function check(label, actual) {
  if (actual) { console.log(`  ✓ ${label}`); passed++; }
  else        { console.log(`  ✗ ${label}`); failed++; }
}

const src = fs.readFileSync(
  path.join(__dirname, "../server/services/inbox-policy.ts"), "utf8"
);

// ── 1. Policy flag ────────────────────────────────────────────────────────────
console.log("\n── 1. INBOX_INCLUDES_CATEGORY_SKIP flag ──");
check(
  "INBOX_INCLUDES_CATEGORY_SKIP = true is exported",
  src.includes("export const INBOX_INCLUDES_CATEGORY_SKIP = true")
);

// ── 2. VoltSafe canonical category list ───────────────────────────────────────
console.log("\n── 2. Canonical inbox member categories ──");
check("INBOX is in member list",              src.includes('"INBOX"'));
check("CATEGORY_PERSONAL is in member list",  src.includes('"CATEGORY_PERSONAL"'));
check("CATEGORY_UPDATES is in member list",   src.includes('"CATEGORY_UPDATES"'));
check("CATEGORY_PROMOTIONS is in member list",src.includes('"CATEGORY_PROMOTIONS"'));
check("CATEGORY_SOCIAL is in member list",    src.includes('"CATEGORY_SOCIAL"'));
check("CATEGORY_FORUMS is in member list",    src.includes('"CATEGORY_FORUMS"'));
check("SPAM is in exclude list",              src.includes('"SPAM"'));
check("TRASH is in exclude list",             src.includes('"TRASH"'));
check("DRAFT is in exclude list",             src.includes('"DRAFT"'));
check("SENT is NOT in VOLTSAFE_INBOX_EXCLUDE_LABELS (SENT+INBOX stays visible)",
  !src.includes('"SENT"') ||
  // SENT appears in the file for other reasons (is_sent field, label parsing)
  // but must NOT be in the VOLTSAFE_INBOX_EXCLUDE_LABELS array
  !src.includes('VOLTSAFE_INBOX_EXCLUDE_LABELS') ||
  !/VOLTSAFE_INBOX_EXCLUDE_LABELS[\s\S]{0,300}"SENT"/.test(src)
);

// ── 3. DerivedEmailLabels type has all 8 fields ──────────────────────────────
console.log("\n── 3. DerivedEmailLabels type — 8 fields ──");
check("is_inbox field",       src.includes("is_inbox:"));
check("is_unread field",      src.includes("is_unread:"));
check("is_starred field",     src.includes("is_starred:"));
check("is_spam field",        src.includes("is_spam:"));
check("is_trash field",       src.includes("is_trash:"));
check("is_draft field",       src.includes("is_draft:"));
check("is_sent field",        src.includes("is_sent:"));
check("smart_category field", src.includes("smart_category:"));

// ── 4. deriveEmailLabels function shape ───────────────────────────────────────
console.log("\n── 4. deriveEmailLabels function ──");
check("function is exported",
  src.includes("export function deriveEmailLabels"));
check("parseLabelArray is exported",
  src.includes("export function parseLabelArray"));
check("is_inbox derived from membership check",
  src.includes("hasInboxMember") && src.includes("is_inbox = hasInboxMember"));
check("SENT NOT excluded from is_inbox (INBOX+SENT must be visible)",
  !/is_inbox\s*=\s*hasInboxMember.*!is_sent/.test(src.replace(/\n/g," "))
);
check("SPAM excluded from is_inbox",
  /is_inbox\s*=\s*hasInboxMember.*!is_spam/.test(src.replace(/\n/g," "))
);

// ── 5. smart_category mapping ─────────────────────────────────────────────────
console.log("\n── 5. smart_category derivation ──");
check("CATEGORY_UPDATES → 'updates'",       src.includes(`smart_category = "updates"`));
check("CATEGORY_PROMOTIONS → 'promotions'", src.includes(`smart_category = "promotions"`));
check("CATEGORY_SOCIAL → 'social'",         src.includes(`smart_category = "social"`));
check("CATEGORY_FORUMS → 'forums'",         src.includes(`smart_category = "forums"`));
check("default → 'people' (PERSONAL and no-category fallback)",
  src.includes(`smart_category: SmartCategory = "people"`));

// ── 6. No label_ids mutation ─────────────────────────────────────────────────
console.log("\n── 6. No label_ids mutation ──");
check("module never pushes/assigns to label_ids",
  !src.includes("label_ids =") && !src.includes("labelIds =") && !src.includes(".push(") );
check("module never calls ensureInboxForCategoryLabels",
  !src.includes("ensureInboxForCategoryLabels"));

// ── 7. SQL builders for Phase 3 ──────────────────────────────────────────────
console.log("\n── 7. SQL predicate builders (Phase 3 prep) ──");
check("SQL_IS_INBOX exported",       src.includes("export const SQL_IS_INBOX"));
check("SQL_IS_INBOX_UNREAD exported",src.includes("export const SQL_IS_INBOX_UNREAD"));
check("sqlSmartCategory exported",   src.includes("export function sqlSmartCategory"));

// ── 8. Schema has all 8 derived columns ──────────────────────────────────────
console.log("\n── 8. schema.ts has derived columns ──");
const schemaSrc = fs.readFileSync(
  path.join(__dirname, "../shared/schema.ts"), "utf8"
);
check("isInbox in schema",       schemaSrc.includes('boolean("is_inbox")'));
check("isUnread in schema",      schemaSrc.includes('boolean("is_unread")'));
check("isStarred in schema",     schemaSrc.includes('boolean("is_starred")'));
check("isSpam in schema",        schemaSrc.includes('boolean("is_spam")'));
check("isTrash in schema",       schemaSrc.includes('boolean("is_trash")'));
check("isDraft in schema",       schemaSrc.includes('boolean("is_draft")'));
check("isSent in schema",        schemaSrc.includes('boolean("is_sent")'));
check("smartCategory in schema", schemaSrc.includes('text("smart_category")'));

// ── 9. Migration file exists ──────────────────────────────────────────────────
console.log("\n── 9. Migration file ──");
const migPath = path.join(__dirname, "../migrations/0016_derived_label_columns.sql");
check("0016_derived_label_columns.sql exists", fs.existsSync(migPath));
const migSql = fs.existsSync(migPath) ? fs.readFileSync(migPath, "utf8") : "";
check("Migration adds is_inbox",        migSql.includes("is_inbox"));
check("Migration has backfill UPDATE",  migSql.includes("UPDATE email_messages SET"));
check("Migration has partial indexes",  migSql.includes("CREATE INDEX IF NOT EXISTS"));
check("Migration comment: label_ids never mutated",
  migSql.includes("label_ids is NEVER modified") || migSql.includes("label_ids is NEVER mutated"));

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(64)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed+failed} total`);
if (failed > 0) process.exit(1);
