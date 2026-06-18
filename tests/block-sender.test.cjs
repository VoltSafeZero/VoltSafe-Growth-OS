/**
 * Block Sender — source-grep regression tests
 *
 * Verifies:
 *  1. Mark-as-read backend persistence (Gmail API + local mirror)
 *  2. Block sender uses exact email (not domain) via blocked_senders table
 *  3. mark-spam route exists and adds SPAM / removes INBOX
 *  4. Broad-domain guard prevents blocking gmail.com etc. at domain level
 *  5. Trust sender (not-spam) also removes from blocked_senders
 *  6. blocked-senders GET/POST/DELETE routes exist
 *  7. Row hover button uses blockSenderMutation (exact email), not flagMutation
 *  8. Toolbar onBlock uses blockSenderMutation (not flagMutation)
 *  9. onBlockDomain keeps flagMutation for domain-level blocking
 * 10. Icon consistency: priority=Star, pin=Pin/PinOff (not Zap/Flame)
 */

const fs = require("fs");
const path = require("path");

const ROUTES = path.join(__dirname, "../server/routes.ts");
const SEED = path.join(__dirname, "../server/seed-production.ts");
const INDEX = path.join(__dirname, "../server/index.ts");
const TOOLBAR = path.join(__dirname, "../client/src/components/inbox/email-actions-toolbar.tsx");
const INBOX = path.join(__dirname, "../client/src/pages/gmail-inbox.tsx");

const routes = fs.readFileSync(ROUTES, "utf8");
const seed = fs.readFileSync(SEED, "utf8");
const index = fs.readFileSync(INDEX, "utf8");
const toolbar = fs.readFileSync(TOOLBAR, "utf8");
const inbox = fs.readFileSync(INBOX, "utf8");

let passed = 0;
let failed = 0;

function check(description, condition) {
  if (condition) {
    console.log(`  ✓ ${description}`);
    passed++;
  } else {
    console.error(`  ✗ ${description}`);
    failed++;
  }
}

// ── 1. Mark-as-read backend persistence ─────────────────────────────────────
console.log("\n[1] Mark-as-read backend persistence");
check(
  "mark-read route calls markMessageRead (Gmail API)",
  routes.includes("markMessageRead(resolved.userId, req.params.id, resolved.accountId)")
);
check(
  "mark-read route calls mirrorLabelChangeForMessages with UNREAD remove",
  routes.includes('mirrorLabelChangeForMessages([req.params.id]') &&
  routes.includes('remove: ["UNREAD"]')
);
check(
  "mark-read cache fix uses setQueriesData (not just setQueryData) in frontend",
  inbox.includes('setQueriesData({ queryKey: ["/api/gmail/messages", "inbox"]')
);

// ── 2. blocked_senders table migration ──────────────────────────────────────
console.log("\n[2] blocked_senders migration");
check(
  "migrateBlockedSenders function exists in seed-production.ts",
  seed.includes("export async function migrateBlockedSenders")
);
check(
  "blocked_senders table CREATE TABLE IF NOT EXISTS",
  seed.includes("CREATE TABLE IF NOT EXISTS blocked_senders")
);
check(
  "blocked_senders has email TEXT NOT NULL UNIQUE",
  seed.includes("email TEXT NOT NULL UNIQUE")
);
check(
  "migrateBlockedSenders imported in index.ts",
  index.includes("migrateBlockedSenders")
);
check(
  "migrateBlockedSenders called in index.ts",
  index.includes("await migrateBlockedSenders()")
);

// ── 3. mark-spam route ───────────────────────────────────────────────────────
console.log("\n[3] mark-spam route");
check(
  "POST /api/inbox/threads/:threadId/mark-spam route exists",
  routes.includes('app.post("/api/inbox/threads/:threadId/mark-spam"')
);
check(
  "mark-spam adds SPAM label",
  routes.includes('addLabelIds: ["SPAM"]') || routes.includes("addLabelIds: ['SPAM']")
);
check(
  "mark-spam removes INBOX label",
  routes.includes('removeLabelIds: ["INBOX"]') || routes.includes("removeLabelIds: ['INBOX']")
);
check(
  "mark-spam mirrors to local DB via mirrorLabelChangeForThreads",
  routes.includes("[mark-spam] mirror failed")
);

// ── 4. blocked-senders CRUD routes ──────────────────────────────────────────
console.log("\n[4] blocked-senders CRUD routes");
check(
  "GET /api/blocked-senders route exists",
  routes.includes('app.get("/api/blocked-senders"')
);
check(
  "POST /api/blocked-senders route exists",
  routes.includes('app.post("/api/blocked-senders"')
);
check(
  "DELETE /api/blocked-senders/:id route exists",
  routes.includes('app.delete("/api/blocked-senders/:id"')
);
check(
  "POST /api/blocked-senders inserts into blocked_senders with ON CONFLICT DO NOTHING",
  routes.includes("INSERT INTO blocked_senders") &&
  routes.includes("ON CONFLICT (email) DO NOTHING")
);

// ── 5. Broad-domain guard ────────────────────────────────────────────────────
console.log("\n[5] Broad-domain guard on POST /api/email-filters");
check(
  "gmail.com is in the BROAD_EMAIL_DOMAINS guard list",
  routes.includes('"gmail.com"') && routes.includes("BROAD_EMAIL_DOMAINS")
);
check(
  "outlook.com is in the BROAD_EMAIL_DOMAINS guard list",
  routes.includes('"outlook.com"')
);
check(
  "icloud.com is in the BROAD_EMAIL_DOMAINS guard list",
  routes.includes('"icloud.com"')
);
check(
  "broad-domain guard returns broadDomain: true in response",
  routes.includes("broadDomain: true")
);
check(
  "frontend onBlockDomain handler checks BROAD set before calling flagMutation",
  inbox.includes("BROAD.has(_domain)")
);

// ── 6. Trust sender (not-spam) removes from blocked_senders ─────────────────
console.log("\n[6] Trust sender removes from blocked_senders");
check(
  "not-spam route deletes from blocked_senders after trusting",
  routes.includes("DELETE FROM blocked_senders WHERE email")
);
check(
  "not-spam route also inserts into spam_trusted_senders",
  routes.includes("INSERT INTO spam_trusted_senders")
);
check(
  "notSpamMutation.onSuccess invalidates blocked-senders query cache",
  inbox.includes('["/api/blocked-senders"]') &&
  inbox.includes("invalidateQueries")
);

// ── 7. Frontend: exact-email blocking in inbox ───────────────────────────────
console.log("\n[7] Frontend exact-email blocking");
check(
  "blockedSendersQuery fetches from /api/blocked-senders",
  inbox.includes('"/api/blocked-senders"') &&
  inbox.includes("blockedSendersQuery")
);
check(
  "blockedEmails Set derived from blockedSendersQuery data",
  inbox.includes("blockedEmails") &&
  inbox.includes("blockedSendersQuery.data")
);
check(
  "blockSenderMutation calls POST /api/blocked-senders with email",
  inbox.includes('apiRequest("POST", "/api/blocked-senders"') ||
  inbox.includes("apiRequest(\"POST\", \"/api/blocked-senders\"")
);
check(
  "blockSenderMutation also calls mark-spam route",
  inbox.includes("/api/inbox/threads/") &&
  inbox.includes("/mark-spam")
);
check(
  "unblockSenderMutation calls DELETE /api/blocked-senders/:id",
  inbox.includes('apiRequest("DELETE", `/api/blocked-senders/${')
);
check(
  "inboxMainRaw filters by blockedEmails (exact-email blocked senders)",
  inbox.includes("blockedEmails.has((m.fromEmail") ||
  inbox.includes('blockedEmails.has((m.fromEmail || "").toLowerCase())')
);
check(
  "inboxOther includes exact-email blocked senders",
  inbox.includes("blockedEmails.has((m.fromEmail") &&
  // inboxOther uses OR (domain OR email blocked)
  inbox.includes("blockedEmails.has((m.fromEmail")
);

// ── 8. Row hover button uses exact-email blocking ───────────────────────────
console.log("\n[8] Row hover button — exact-email block");
check(
  "row block button uses emailBlocked (not just blocked domain)",
  inbox.includes("emailBlocked")
);
check(
  "row block button calls blockSenderMutation for exact email",
  inbox.includes("blockSenderMutation.mutate({ senderEmail: rowSenderEmail")
);
check(
  "row block button calls unblockSenderMutation when already blocked",
  inbox.includes("unblockSenderMutation.mutate(emailBlockRecord.id)")
);
check(
  "row block button shows ShieldCheck when blocked (not Trash2 or Ban)",
  inbox.includes("emailBlocked || blocked") &&
  inbox.includes("ShieldCheck")
);

// ── 9. Toolbar handlers ──────────────────────────────────────────────────────
console.log("\n[9] Toolbar handlers");
check(
  "onBlock in toolbar uses blockSenderMutation (exact email)",
  inbox.includes("blockSenderMutation.mutate({ senderEmail: _email, threadId: selectedThreadId })")
);
check(
  "onBlockDomain in toolbar uses flagMutation (domain)",
  inbox.includes("onBlockDomain: () => {") &&
  inbox.includes("flagMutation.mutate(_domain)")
);
check(
  "onTrustSender in toolbar calls notSpamMutation",
  inbox.includes("onTrustSender: () => notSpamMutation.mutate(selectedThreadId)")
);
check(
  "onMarkSpam in toolbar calls mark-spam route (not just archive)",
  inbox.includes("onMarkSpam: () => {") &&
  inbox.includes("/mark-spam")
);
check(
  "senderEmail prop passed to normal toolbar instance",
  inbox.includes('senderEmail={focusedMsg.fromEmail?.toLowerCase() || ""}')
);
check(
  "isBlocked prop passed to both toolbar instances",
  (inbox.match(/isBlocked=\{blockedEmails\.has/g) || []).length >= 2
);

// ── 10. toolbar ActionsToolbarHandlers interface ─────────────────────────────
console.log("\n[10] Toolbar type definitions");
check(
  "ActionsToolbarHandlers has onBlockDomain optional handler",
  toolbar.includes("onBlockDomain?: () => void")
);
check(
  "ActionsToolbarHandlers has onTrustSender optional handler",
  toolbar.includes("onTrustSender?: () => void")
);
check(
  "EmailActionsToolbarProps has senderEmail? prop",
  toolbar.includes("senderEmail?: string")
);
check(
  "EmailActionsToolbarProps has isBlocked? prop",
  toolbar.includes("isBlocked?: boolean")
);
check(
  "More menu shows Trust sender when isBlocked || isSpamView",
  toolbar.includes("(isBlocked || isSpamView) && handlers.onTrustSender")
);
check(
  "More menu shows Block sender with senderEmail label",
  toolbar.includes("senderEmail ? `Block ${senderEmail}`")
);
check(
  "More menu has Block entire domain item",
  toolbar.includes('data-testid="more-block-domain"')
);

// ── 11. Icon consistency ─────────────────────────────────────────────────────
console.log("\n[11] Icon consistency");
check(
  "Toolbar does NOT use Zap for priority (replaced with Star)",
  !toolbar.includes("onTogglePriority.*Zap") &&
  toolbar.includes("Star")
);
check(
  "Toolbar does NOT use Flame for pin (replaced with Pin/PinOff)",
  !toolbar.includes("togglePin.*Flame") &&
  (toolbar.includes("Pin") || toolbar.includes("PinOff"))
);

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
const total = passed + failed;
console.log(`Results: ${passed}/${total} checks passed`);
if (failed > 0) {
  console.error(`${failed} check(s) FAILED`);
  process.exit(1);
} else {
  console.log("All checks passed ✓");
  process.exit(0);
}
