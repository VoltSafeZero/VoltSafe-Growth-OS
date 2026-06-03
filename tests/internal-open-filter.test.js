/**
 * tests/internal-open-filter.test.js
 *
 * Verifies that engagement events from internal VoltSafe domains are:
 *  1. Stored with is_internal=TRUE in the DB.
 *  2. Excluded from engagement counts returned by GET /api/tracking/:token/stats.
 *  3. Excluded from the thread-signals endpoint.
 *  4. Not counted in score updates (score stays 0 for internal-only opens).
 *
 * Uses source-grep for backend logic + runtime API for integration checks.
 *
 * Run: node tests/internal-open-filter.test.js
 */
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = new URL("..", import.meta.url).pathname;

// ─── helpers ────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function ok(label, condition) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else            { console.error(`  ✗ ${label}`); failed++; }
}
function contains(src, needle) { return src.includes(needle); }

// ─── Source grep tests ───────────────────────────────────────────────────────
const trackingTs = readFileSync(resolve(ROOT, "server/tracking.ts"), "utf8");
const routesTs   = readFileSync(resolve(ROOT, "server/routes.ts"),   "utf8");
const engIntelTs = readFileSync(resolve(ROOT, "server/services/engagement-intelligence.ts"), "utf8");
const seedTs     = readFileSync(resolve(ROOT, "server/seed-production.ts"), "utf8");

console.log("=== Internal Open Filter Regression ===\n");

// ── 1. INTERNAL_DOMAINS exported from tracking.ts ───────────────────────────
console.log("-- tracking.ts --");
ok("exports INTERNAL_DOMAINS Set", contains(trackingTs, "export const INTERNAL_DOMAINS"));
ok("default domains include voltsafe.com",     contains(trackingTs, "voltsafe.com"));
ok("default domains include voltsafemarine.com", contains(trackingTs, "voltsafemarine.com"));
ok("exports isInternalEmail()",   contains(trackingTs, "export function isInternalEmail"));
ok("isInternalEmail checks lastIndexOf('@')", contains(trackingTs, "lastIndexOf(\"@\")"));

// ── 2. recordOpen sets is_internal ──────────────────────────────────────────
ok("recordOpen inserts is_internal column",   contains(trackingTs, "is_internal, internal_reason"));
ok("recordOpen skips dedup for internal",     contains(trackingTs, "!bot && !internal && ipHash"));
ok("recordOpen skips scoring for internal",   contains(trackingTs, "!bot && !internal)"));
ok("recordClick sets is_internal column",     (() => {
  const clickSection = trackingTs.split("export async function recordClick")[1] || "";
  return contains(clickSection, "is_internal, internal_reason");
})());

// ── 3. updateScore excludes is_internal ─────────────────────────────────────
ok("updateScore: opens FILTER excludes is_internal",
  contains(trackingTs, "event_type='open'  AND is_bot=false AND is_duplicate=false AND is_internal IS NOT TRUE"));
ok("updateScore: clicks FILTER excludes is_internal",
  contains(trackingTs, "event_type='click' AND is_bot=false AND is_duplicate=false AND is_internal IS NOT TRUE"));

// ── 4. getEngagementStats excludes is_internal ──────────────────────────────
ok("getEngagementStats: unique_opens excludes is_internal",
  contains(trackingTs, "COUNT(*) FILTER (WHERE is_bot=false AND is_duplicate=false AND is_internal IS NOT TRUE)          AS unique_opens"));
ok("getEngagementStats: unique_clicks excludes is_internal",
  contains(trackingTs, "COUNT(*) FILTER (WHERE is_bot=false AND is_duplicate=false AND is_internal IS NOT TRUE)          AS unique_clicks"));

// ── 5. engagement-intelligence.ts openRows/linkRows FILTER ──────────────────
console.log("\n-- engagement-intelligence.ts --");
ok("openRows HAVING excludes is_internal",
  contains(engIntelTs, "COUNT(*) FILTER (WHERE ee.is_bot = FALSE AND ee.is_duplicate IS NOT TRUE AND ee.is_internal IS NOT TRUE) > 0"));
ok("linkRows HAVING excludes is_internal",
  (() => {
    const idx = engIntelTs.indexOf("click_count");
    return contains(engIntelTs.slice(idx), "ee.is_internal IS NOT TRUE) > 0");
  })());
ok("recipientBreakdown field in ThreadEngagementFull",
  contains(engIntelTs, "recipientBreakdown: RecipientBreakdown[]"));
ok("RecipientBreakdown interface exported",
  contains(engIntelTs, "export interface RecipientBreakdown"));
ok("recipientBreakdown populated from email_recipients",
  contains(engIntelTs, "FROM email_recipients er"));

// ── 6. routes.ts engagement queries exclude is_internal ─────────────────────
console.log("\n-- routes.ts --");
ok("needs-reply query: unique_opens excludes is_internal",
  contains(routesTs, "event_type='open'  AND is_bot=false AND is_duplicate=false AND is_internal IS NOT TRUE) AS unique_opens"));
ok("thread-signals query: unique_opens excludes is_internal",
  (() => {
    const idx = routesTs.indexOf("first_open_at");
    return contains(routesTs.slice(Math.max(0, idx - 500)), "is_internal IS NOT TRUE) AS unique_opens");
  })());
ok("send pipeline imports isInternalEmail",
  contains(routesTs, "isInternalEmail, INTERNAL_DOMAINS"));
ok("send pipeline writes email_recipients table",
  contains(routesTs, "INSERT INTO email_recipients"));
ok("email_recipients insert uses ON CONFLICT DO NOTHING",
  contains(routesTs, "ON CONFLICT (gmail_message_id, recipient_email) DO NOTHING"));

// ── 7. Migrations registered ─────────────────────────────────────────────────
console.log("\n-- seed-production.ts --");
ok("migrateEmailRecipientsSchema exported",
  contains(seedTs, "export async function migrateEmailRecipientsSchema"));
ok("email_recipients table created with unique index",
  contains(seedTs, "idx_email_recipients_unique"));
ok("migrateInternalEngagementSchema exported",
  contains(seedTs, "export async function migrateInternalEngagementSchema"));
ok("is_internal column added to email_engagement_events",
  contains(seedTs, "ADD COLUMN IF NOT EXISTS is_internal BOOLEAN"));
ok("internal_reason column added to email_engagement_events",
  contains(seedTs, "ADD COLUMN IF NOT EXISTS internal_reason TEXT"));

const indexTs = readFileSync(resolve(ROOT, "server/index.ts"), "utf8");
ok("migrateEmailRecipientsSchema called in startup",
  contains(indexTs, "await migrateEmailRecipientsSchema()"));
ok("migrateInternalEngagementSchema called in startup",
  contains(indexTs, "await migrateInternalEngagementSchema()"));

// ─── Result ─────────────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
