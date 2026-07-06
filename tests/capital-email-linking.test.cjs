/**
 * Capital Module — Phase 2D Email Linking Tests
 *
 * Source-grep tests for:
 * 1. Schema migration — capital_email_links + capital_email_review tables
 * 2. Capital Email Linker service — matching rules + free-domain guard
 * 3. Backend routes — email conversations, links, review queue
 * 4. Email context upgrade — linked conversations included
 * 5. Gmail incremental hook — fire-and-forget capital linking
 * 6. Frontend — EmailConversationsPanel, Email Review page, nav item
 * 7. Toolbar — isCapitalUser prop, Link to Capital action
 * 8. Deduplication + activity logging
 * 9. Permission hardening — requireCapitalAccess on all new routes
 */

const fs = require("fs");
const path = require("path");

let passed = 0, failed = 0;

function load(rel) {
  const abs = path.resolve(__dirname, "..", rel);
  if (!fs.existsSync(abs)) return "";
  return fs.readFileSync(abs, "utf8");
}
function ok(desc, condition, hint = "") {
  if (condition) { console.log(`  ✓ ${desc}`); passed++; }
  else { console.error(`  ✗ ${desc}${hint ? ` — ${hint}` : ""}`); failed++; }
}
function has(src, pattern) {
  if (typeof pattern === "string") return src.includes(pattern);
  return pattern.test(src);
}

const capital    = load("server/routes-capital.ts");
const linker     = load("server/services/capital-email-linker.ts");
const incremental= load("server/services/gmail-incremental.ts");
const investors  = load("client/src/pages/capital-investors.tsx");
const emailReview= load("client/src/pages/capital-email-review.tsx");
const navConfig  = load("client/src/lib/nav-config.ts");
const appTsx     = load("client/src/App.tsx");
const toolbar    = load("client/src/components/inbox/email-actions-toolbar.tsx");

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 1. Schema migration ─────────────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("Phase 2D migration block exists",
  has(capital, "Phase 2D"));

ok("capital_email_links table created",
  has(capital, "CREATE TABLE IF NOT EXISTS capital_email_links"));

ok("capital_email_links has capital_investor_id FK",
  has(capital, /capital_email_links[\s\S]{0,800}capital_investor_id/));

ok("capital_email_links has capital_contact_id nullable",
  has(capital, /capital_contact_id\s+INTEGER.*ON DELETE SET NULL/));

ok("capital_email_links has email_thread_id column",
  has(capital, "email_thread_id") && has(capital, "capital_email_links"));

ok("capital_email_links has deleted_at for soft-delete",
  has(capital, /capital_email_links[\s\S]{0,1200}deleted_at/));

ok("capital_email_links unique index on thread+investor where not deleted",
  has(capital, "idx_capital_email_links_thread_investor") &&
  has(capital, "WHERE deleted_at IS NULL AND email_thread_id IS NOT NULL"));

ok("capital_email_review table created",
  has(capital, "CREATE TABLE IF NOT EXISTS capital_email_review"));

ok("capital_email_review has status column with default 'pending'",
  has(capital, /status\s+TEXT NOT NULL DEFAULT 'pending'/));

ok("capital_email_review has guessed_investor_id",
  has(capital, "guessed_investor_id"));

ok("capital_activities gets email_thread_id column",
  has(capital, "ALTER TABLE capital_activities ADD COLUMN IF NOT EXISTS email_thread_id"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 2. Capital Email Linker service ─────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("linker service file exists",
  linker.length > 100);

ok("FREE_DOMAINS exported with generic domains",
  has(linker, "export const FREE_DOMAINS") &&
  has(linker, '"gmail.com"') &&
  has(linker, '"outlook.com"') &&
  has(linker, '"yahoo.com"') &&
  has(linker, '"icloud.com"') &&
  has(linker, '"proton.me"'));

ok("tryCapitalEmailLink exported",
  has(linker, "export async function tryCapitalEmailLink"));

ok("manualCapitalEmailLink exported",
  has(linker, "export async function manualCapitalEmailLink"));

ok("exact contact email matching (capital_contacts.email)",
  has(linker, "LOWER(cc.email) = "));

ok("free-domain guard prevents auto-link",
  has(linker, "FREE_DOMAINS.has(domain)"));

ok("low-confidence match goes to review queue",
  has(linker, "capital_email_review") &&
  has(linker, "'pending'"));

ok("upsertEmailActivity deduplicates by thread + investor",
  has(linker, "email_thread_id") &&
  has(linker, "ON CONFLICT DO NOTHING"));

ok("upsertEmailLink updates latest_message_at on existing thread",
  has(linker, "GREATEST") &&
  has(linker, "latest_message_at"));

ok("manualCapitalEmailLink updates last_touch_at",
  has(linker, "UPDATE capital_investors SET last_touch_at = NOW()"));

ok("upsertEmailActivity uses email_thread_id for dedup",
  has(linker, "email_thread_id = '${esc(threadId)}'") ||
  has(linker, "email_thread_id ="));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 3. Backend routes ───────────────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("GET /api/capital/investors/:id/email-conversations exists",
  has(capital, '"/api/capital/investors/:id/email-conversations"'));

ok("email-conversations route uses requireCapitalAccess",
  has(capital, /email-conversations.*requireCapitalAccess|requireCapitalAccess.*email-conversations/s));

ok("POST /api/capital/email-links exists",
  has(capital, '"/api/capital/email-links"'));

ok("PATCH /api/capital/email-links/:id exists",
  has(capital, '"/api/capital/email-links/:id"'));

ok("DELETE /api/capital/email-links/:id exists",
  has(capital, "DELETE") && has(capital, "/api/capital/email-links/:id"));

ok("POST /api/capital/email-links/auto-link-message exists",
  has(capital, "auto-link-message"));

ok("GET /api/capital/email-review exists",
  has(capital, '"/api/capital/email-review"'));

ok("POST /api/capital/email-review/:id/approve exists",
  has(capital, "email-review/:id/approve"));

ok("POST /api/capital/email-review/:id/reject exists",
  has(capital, "email-review/:id/reject"));

ok("POST /api/capital/email-review/:id/ignore exists",
  has(capital, "email-review/:id/ignore"));

ok("all email-review routes use requireCapitalAccess",
  has(capital, /email-review.*requireCapitalAccess|requireCapitalAccess.*email-review/s));

ok("approve route calls manualCapitalEmailLink",
  has(capital, "manualCapitalEmailLink"));

ok("soft-delete uses deleted_at",
  has(capital, "deleted_at = NOW()"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 4. Email context upgrade ────────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("email-context includes linked_email_conversations",
  has(capital, "linked_email_conversations"));

ok("email-context queries capital_email_links",
  has(capital, "email-context") && has(capital, "capital_email_links"));

ok("email-context filters out deleted links",
  has(capital, "cel.deleted_at IS NULL"));

ok("email-context returns thread_id in response",
  has(capital, "thread_id: e.email_thread_id"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 5. Gmail sync hook ──────────────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("gmail-incremental imports capital-email-linker fire-and-forget",
  has(incremental, "capital-email-linker"));

ok("tryCapitalEmailLink called with inserted.id",
  has(incremental, "tryCapitalEmailLink(inserted.id)"));

ok("hook is fire-and-forget (never awaited, uses .catch)",
  has(incremental, /capital-email-linker[\s\S]{0,200}\.catch/));

ok("hook does not block primary sync path",
  has(incremental, /import.*capital-email-linker.*\.then[\s\S]{0,200}\.catch\(\)/s) ||
  has(incremental, "import(\"./capital-email-linker\")"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 6. Frontend — investor detail + email review page ───────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("EmailConversationsPanel component defined in capital-investors.tsx",
  has(investors, "function EmailConversationsPanel"));

ok("EmailConversationsPanel mounted inside InvestorDetail",
  has(investors, "<EmailConversationsPanel investorId={investor.id}"));

ok("empty state text matches spec",
  has(investors, "No linked investor email conversations yet"));

ok("email-conversations-panel test ID present",
  has(investors, 'data-testid="email-conversations-panel"'));

ok("email-conversations-empty test ID present",
  has(investors, 'data-testid="email-conversations-empty"'));

ok("EmailConversationsPanel queries /api/capital/investors/:id/email-conversations",
  has(investors, "email-conversations"));

ok("unlink button present in EmailConversationsPanel",
  has(investors, "Unlink") || has(investors, "btn-unlink"));

ok("open-in-mail link present",
  has(investors, "Open in Mail") || has(investors, "btn-open-thread"));

ok("capital-email-review.tsx page exists",
  emailReview.length > 100);

ok("Email Review page has email-review-list test ID",
  has(emailReview, 'data-testid="email-review-list"'));

ok("Email Review page has empty state",
  has(emailReview, 'data-testid="email-review-empty"'));

ok("Email Review approve button present",
  has(emailReview, "btn-approve"));

ok("Email Review reject button present",
  has(emailReview, "btn-reject"));

ok("Email Review ignore button present",
  has(emailReview, "btn-ignore"));

ok("Email Review has approve investor selector",
  has(emailReview, "select-approve-investor") || has(emailReview, "capital_investor_id"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 7. Nav + routing ────────────────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("nav-config has capital-email-review item",
  has(navConfig, "capital-email-review"));

ok("nav-config Email Review route is /capital/email-review",
  has(navConfig, "/capital/email-review"));

ok("Email Review nav item is under capitalOnly section",
  has(navConfig, "capitalOnly") && has(navConfig, "capital-email-review"));

ok("App.tsx has lazy import for CapitalEmailReviewPage",
  has(appTsx, "CapitalEmailReviewPage") &&
  has(appTsx, "capital-email-review"));

ok("App.tsx has route for /capital/email-review",
  has(appTsx, '"/capital/email-review"'));

ok("App.tsx email-review route uses capitalGuard",
  has(appTsx, /email-review.*capitalGuard|capitalGuard.*email-review/));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 8. Email toolbar — Capital link action ──────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("isCapitalUser prop added to EmailActionsToolbarProps",
  has(toolbar, "isCapitalUser"));

ok("more-link-capital test ID present in dropdown",
  has(toolbar, 'data-testid="more-link-capital"'));

ok("Link to Capital only shown when isCapitalUser is true",
  has(toolbar, "isCapitalUser") &&
  has(toolbar, "more-link-capital"));

ok("capital-link-modal test ID present",
  has(toolbar, 'data-testid="capital-link-modal"'));

ok("input-capital-search test ID present",
  has(toolbar, 'data-testid="input-capital-search"'));

ok("btn-confirm-capital-link test ID present",
  has(toolbar, 'data-testid="btn-confirm-capital-link"'));

ok("toolbar posts to /api/capital/email-links",
  has(toolbar, "/api/capital/email-links"));

ok("toolbar passes email_thread_id to link payload",
  has(toolbar, "email_thread_id: threadId"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 9. Permission hardening ─────────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("CAPITAL_ALLOWED_USER_IDS and CAPITAL_ALLOWED_EMAILS still defined",
  has(capital, "CAPITAL_ALLOWED_USER_IDS") && has(capital, "CAPITAL_ALLOWED_EMAILS"));

ok("requireCapitalAccess middleware unchanged",
  has(capital, "function requireCapitalAccess") &&
  has(capital, "Capital module access restricted to authorized users only"));

ok("POST /api/capital/email-links uses requireCapitalAccess",
  has(capital, /POST.*email-links.*requireCapitalAccess|requireCapitalAccess.*email-links/s));

ok("GET /api/capital/email-review uses requireCapitalAccess",
  has(capital, /email-review.*requireCapitalAccess|requireCapitalAccess.*email-review/s));

ok("auto-link-message uses requireCapitalAccess",
  has(capital, /auto-link-message[\s\S]{0,200}requireCapitalAccess|requireCapitalAccess[\s\S]{0,200}auto-link-message/));

ok("capital toolbar link only shown to isCapitalUser",
  has(toolbar, "{isCapitalUser && (") || has(toolbar, "isCapitalUser &&"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 10. Deduplication / idempotency ─────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("upsertEmailLink checks for existing thread+investor link before insert",
  has(linker, "SELECT id FROM capital_email_links") &&
  has(linker, "deleted_at IS NULL"));

ok("ON CONFLICT DO NOTHING prevents duplicate activity rows",
  has(linker, "ON CONFLICT DO NOTHING"));

ok("review queue uses ON CONFLICT DO NOTHING",
  has(linker, "INSERT INTO capital_email_review") && has(linker, "ON CONFLICT DO NOTHING"));

ok("activity dedup checks email_thread_id before insert",
  has(linker, "email_thread_id") && has(linker, "existing.rows.length > 0"));

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
if (failed === 0) console.log("\n✓ All Capital Email Linking checks passed");
else process.exit(1);
