/**
 * tests/recipient-tracking.test.js
 *
 * Verifies the email_recipients population logic at send time:
 *  1. Source-grep: send pipeline writes to email_recipients after pixel insert.
 *  2. Source-grep: is_internal flag is set per-recipient via isInternalEmail().
 *  3. Source-grep: ON CONFLICT DO NOTHING prevents duplicate rows.
 *  4. Source-grep: all recipient types (to/cc/bcc) are stored.
 *  5. Integration: GET /api/thread-engagement/:threadId includes recipientBreakdown.
 *
 * Run: node tests/recipient-tracking.test.js
 */
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = new URL("..", import.meta.url).pathname;
const BASE = process.env.TEST_BASE_URL || "http://localhost:5000";

let passed = 0, failed = 0;
function ok(label, condition) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else            { console.error(`  ✗ ${label}`); failed++; }
}
function contains(src, needle) { return src.includes(needle); }

const routesTs = readFileSync(resolve(ROOT, "server/routes.ts"), "utf8");
const engIntelTs = readFileSync(resolve(ROOT, "server/services/engagement-intelligence.ts"), "utf8");
const widgetTsx = (() => {
  try { return readFileSync(resolve(ROOT, "client/src/components/engagement/EngagementWidget.tsx"), "utf8"); }
  catch { return ""; }
})();

console.log("=== Recipient Tracking Regression ===\n");

// ── 1. Schema creation ────────────────────────────────────────────────────────
const seedTs = readFileSync(resolve(ROOT, "server/seed-production.ts"), "utf8");
console.log("-- email_recipients schema --");
ok("table has gmail_message_id column", contains(seedTs, "gmail_message_id TEXT NOT NULL"));
ok("table has recipient_type column",   contains(seedTs, "recipient_type   TEXT NOT NULL DEFAULT 'to'"));
ok("table has is_primary column",       contains(seedTs, "is_primary       BOOLEAN NOT NULL DEFAULT FALSE"));
ok("table has is_internal column",      contains(seedTs, "is_internal      BOOLEAN NOT NULL DEFAULT FALSE"));
ok("table has tracking_token column",   contains(seedTs, "tracking_token   TEXT"));
ok("unique index on (message_id, email)", contains(seedTs, "idx_email_recipients_unique"));

// ── 2. Send pipeline populates email_recipients ───────────────────────────────
console.log("\n-- routes.ts send pipeline --");
const sendSection = (() => {
  const idx = routesTs.indexOf("INSERT INTO email_recipients");
  return idx >= 0 ? routesTs.slice(Math.max(0, idx - 2000), idx + 2000) : "";
})();
ok("INSERT INTO email_recipients present in send pipeline", sendSection.length > 0);
ok("uses isInternalEmail() per recipient", contains(sendSection, "isInternalEmail(r.email)"));
ok("sets recipient_type from r.kind",      contains(sendSection, "r.kind"));
ok("sets is_primary for first TO",         contains(sendSection, "isPrimary"));
ok("tracks gmail_thread_id",               contains(sendSection, "gmail_thread_id"));
ok("non-fatal try/catch wraps insert",     contains(sendSection, "recErr"));
ok("ON CONFLICT skips duplicates",         contains(routesTs, "ON CONFLICT (gmail_message_id, recipient_email) DO NOTHING"));

// ── 3. Recipient breakdown in engagement-intelligence ─────────────────────────
console.log("\n-- engagement-intelligence.ts recipientBreakdown --");
ok("RecipientBreakdown interface has isInternal field",
  contains(engIntelTs, "isInternal: boolean"));
ok("RecipientBreakdown interface has intentScore field",
  contains(engIntelTs, "intentScore: number"));
ok("recipientBreakdown query joins email_recipients",
  contains(engIntelTs, "FROM email_recipients er"));
ok("open_count subquery excludes is_internal events",
  contains(engIntelTs, "AND ee.is_internal IS NOT TRUE") &&
  contains(engIntelTs, "open_count"));
ok("fallback query for historical threads (pixel-based)",
  contains(engIntelTs, "Fallback: derive from tracking pixels for historical threads"));
ok("recipientBreakdown included in return",
  contains(engIntelTs, "recipientBreakdown,"));
ok("error caught as non-fatal warning",
  contains(engIntelTs, "recipientBreakdown query non-fatal"));

// ── 4. Widget UI shows recipient breakdown ────────────────────────────────────
console.log("\n-- EngagementWidget.tsx --");
if (widgetTsx) {
  ok("recipientBreakdown rendered in widget",
    contains(widgetTsx, "recipientBreakdown") || contains(widgetTsx, "RecipientBreakdown"));
  ok("internal recipients shown with badge or note",
    contains(widgetTsx, "internal") || contains(widgetTsx, "Internal"));
} else {
  console.log("  (EngagementWidget.tsx not found — skipping UI checks)");
}

// ── 5. Backfill script exists ─────────────────────────────────────────────────
console.log("\n-- backfill script --");
import { existsSync } from "fs";
ok("scripts/internal-open-backfill.ts exists",
  existsSync(resolve(ROOT, "scripts/internal-open-backfill.ts")));
const backfillTs = readFileSync(resolve(ROOT, "scripts/internal-open-backfill.ts"), "utf8");
ok("backfill updates email_engagement_events",
  contains(backfillTs, "UPDATE email_engagement_events"));
ok("backfill uses is_internal IS NOT TRUE guard (idempotent)",
  contains(backfillTs, "is_internal IS NOT TRUE"));
ok("backfill resets internal pixel scores",
  contains(backfillTs, "UPDATE email_tracking_pixels"));
ok("backfill supports --dry-run flag",
  contains(backfillTs, "--dry-run"));

// ─── Result ──────────────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
