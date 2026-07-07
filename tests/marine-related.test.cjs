/**
 * tests/marine-related.test.cjs
 *
 * Source-grep regression tests for the Marine Related email tagging feature.
 * Verifies the key structural invariants without spinning up a real server.
 */

const fs = require("fs");
const path = require("path");

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

function readFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

console.log("\n=== Marine Related Feature Tests ===\n");

// ── Backend: routes.ts ────────────────────────────────────────────────────────
console.log("routes.ts — migration & API endpoints:");
const routes = readFile("server/routes.ts");

check(
  "marine_related_email_tags CREATE TABLE IF NOT EXISTS present",
  routes.includes("CREATE TABLE IF NOT EXISTS marine_related_email_tags"),
);
check(
  "marine_related_senders CREATE TABLE IF NOT EXISTS present",
  routes.includes("CREATE TABLE IF NOT EXISTS marine_related_senders"),
);
check(
  "idx_marine_tags_thread_user unique index present",
  routes.includes("idx_marine_tags_thread_user"),
);
check(
  "idx_marine_senders_user_email unique index present",
  routes.includes("idx_marine_senders_user_email"),
);
check(
  "GET /api/gmail/marine-related/data route registered",
  routes.includes('"/api/gmail/marine-related/data"'),
);
check(
  "POST /api/gmail/marine-related/toggle route registered",
  routes.includes('"/api/gmail/marine-related/toggle"'),
);
check(
  "toggle route reads existing tag before insert",
  routes.includes("marine_related_email_tags WHERE gmail_thread_id"),
);
check(
  "toggle route deletes when already tagged",
  routes.includes("DELETE FROM marine_related_email_tags WHERE gmail_thread_id"),
);
check(
  "toggle route inserts marine sender rule on new tag",
  routes.includes("INSERT INTO marine_related_senders"),
);
check(
  "@voltsafe.com senders excluded from sender rules (isInternal guard)",
  routes.includes("@voltsafe.com"),
);
check(
  "category-counts SQL includes marine_unread count",
  routes.includes("marine_unread"),
);
check(
  "category-counts response includes marine field",
  routes.includes("marine:     { total: 0, unread: r.marine_unread"),
);
check(
  "marine count joins marine_related_email_tags in SQL",
  routes.includes("marine_related_email_tags mrt"),
);
check(
  "marine count joins marine_related_senders in SQL",
  routes.includes("marine_related_senders mrs"),
);

// ── Frontend: email-actions-toolbar.tsx ──────────────────────────────────────
console.log("\nemail-actions-toolbar.tsx — anchor icon & props:");
const toolbar = readFile("client/src/components/inbox/email-actions-toolbar.tsx");

check(
  "Anchor imported from lucide-react",
  toolbar.includes("Anchor,"),
);
check(
  "isMarineRelated prop declared in EmailActionsToolbarProps",
  toolbar.includes("isMarineRelated?: boolean"),
);
check(
  "onToggleMarineRelated prop declared in EmailActionsToolbarProps",
  toolbar.includes("onToggleMarineRelated?: () => void"),
);
check(
  "isMarineRelated destructured in EmailActionsToolbarImpl",
  toolbar.includes("isMarineRelated = false,"),
);
check(
  "action-marine-related data-testid present",
  toolbar.includes('data-testid="action-marine-related"'),
);
check(
  "Anchor icon rendered in toolbar",
  toolbar.includes("<Anchor"),
);
check(
  "active state uses cyan color",
  toolbar.includes("text-cyan-400 bg-cyan-500/15"),
);
check(
  "tooltip says Tag as Marine Related",
  toolbar.includes("Tag as Marine Related"),
);
check(
  "tooltip says Remove Marine Related tag",
  toolbar.includes("Remove Marine Related tag"),
);
check(
  "anchor only shown when onToggleMarineRelated provided",
  toolbar.includes("{onToggleMarineRelated && ("),
);

// ── Frontend: gmail-inbox.tsx ─────────────────────────────────────────────────
console.log("\ngmail-inbox.tsx — InboxCategory, subtab, queries, pill badge:");
const inbox = readFile("client/src/pages/gmail-inbox.tsx");

check(
  'InboxCategory type includes "marine"',
  inbox.includes('"marine"') && inbox.includes("InboxCategory"),
);
check(
  "Anchor imported from lucide-react",
  inbox.includes("Anchor,"),
);
check(
  "marineDataQuery fetches /api/gmail/marine-related/data",
  inbox.includes("/api/gmail/marine-related/data"),
);
check(
  "marineThreadIds Set computed from query data",
  inbox.includes("marineThreadIds"),
);
check(
  "marineSenderEmails Set computed from query data",
  inbox.includes("marineSenderEmails"),
);
check(
  "countSnapshot includes marine field",
  inbox.includes("inbox, people, marine, updates"),
);
check(
  "sidebarCategoryBadges includes marine",
  inbox.includes("marine:     countSnapshot.marine"),
);
check(
  "inboxCategoryServerUnread handles marine case",
  inbox.includes('inboxCategory === "marine"'),
);
check(
  "Marine Related subtab entry in sidebar array",
  inbox.includes('"Marine Related"') && inbox.includes("{ key: \"marine\" as const"),
);
check(
  "Anchor icon used for marine subtab",
  inbox.includes("Icon: Anchor"),
);
check(
  "categorizedInbox marine branch filters by marineThreadIds and marineSenderEmails",
  inbox.includes("marineThreadIds.has(m.threadId)") && inbox.includes("marineSenderEmails.has"),
);
check(
  "toggleMarineMutation defined",
  inbox.includes("toggleMarineMutation"),
);
check(
  "marine-badge data-testid on anchor pill in email row",
  inbox.includes('data-testid={`marine-badge-${msg.id}`}'),
);
check(
  "isMarineRelated prop passed to both toolbar instances",
  (inbox.match(/isMarineRelated=/g) || []).length >= 2,
);
check(
  "onToggleMarineRelated passed to both toolbar instances",
  (inbox.match(/onToggleMarineRelated=/g) || []).length >= 2,
);
check(
  "marine toggle mutation POSTs to /api/gmail/marine-related/toggle",
  inbox.includes('"/api/gmail/marine-related/toggle"'),
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
