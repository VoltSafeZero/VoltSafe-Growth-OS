// Regression test for VoltSafe Mail sidebar unread-count badges.
//
// Feature (spec sections A-G):
//   A. Category totals next to WORK INBOX, TEAM INBOXES, PRIVATE INBOXES headers.
//   B. Per-account unread badge next to each email account row.
//   C. "All Inboxes" shows the sum of the three category totals (no double counting).
//   D. Folder-level counts (e.g. Drafts) are unaffected — still draft counts, not unread.
//   E. Permission-safe — counts only come from healthById, which is populated from
//      GET /api/gmail/accounts/health, an endpoint already scoped server-side to
//      accounts the current user can see (owned + explicitly shared). No new
//      client-side account enumeration is introduced.
//
// This is a source-grep test (per project convention for complex UI components with
// worker/network dependencies) — it pins the structural invariants in
// client/src/pages/gmail-inbox.tsx rather than driving a full browser E2E flow.

const fs = require("fs");
const path = require("path");

let failures = 0;
function check(name, condition) {
  if (condition) {
    console.log(`PASS: ${name}`);
  } else {
    console.error(`FAIL: ${name}`);
    failures++;
  }
}

const inboxPath = path.join(__dirname, "..", "client/src/pages/gmail-inbox.tsx");
const src = fs.readFileSync(inboxPath, "utf8");

// ── Source of truth: computed totals derived from healthById (already permission-scoped) ──
check(
  "unreadOfAccount() helper reads healthById.get(acct.id)?.unreadCount",
  /unreadOfAccount\s*=\s*\([^)]*\)\s*=>\s*healthById\.get\([^)]*\)\?\.unreadCount/.test(src)
);
check(
  "workUnreadTotal is computed by reducing over workAccounts",
  /workUnreadTotal\s*=\s*workAccounts\.reduce/.test(src)
);
check(
  "teamUnreadTotal is computed by reducing over sharedAccounts",
  /teamUnreadTotal\s*=\s*sharedAccounts\.reduce/.test(src)
);
check(
  "privateUnreadTotal is computed by reducing over privateAccounts",
  /privateUnreadTotal\s*=\s*privateAccounts\.reduce/.test(src)
);

// ── C. All Inboxes = sum of the three category totals, no double counting ──
check(
  "allInboxesUnreadTotal sums workUnreadTotal + teamUnreadTotal + privateUnreadTotal",
  /allInboxesUnreadTotal\s*=\s*workUnreadTotal\s*\+\s*teamUnreadTotal\s*\+\s*privateUnreadTotal/.test(src)
);
check(
  '"All Inboxes" row renders allInboxesUnreadTotal via badge-unread-all-inboxes testid',
  /data-testid="badge-unread-all-inboxes"/.test(src) &&
    /\{allInboxesUnreadTotal\}/.test(src)
);

// ── A. Category header badges ──
check(
  "WORK INBOX header renders workUnreadTotal via badge-unread-work-inbox testid",
  /data-testid="badge-unread-work-inbox"/.test(src) && /\{workUnreadTotal\}/.test(src)
);
check(
  "TEAM INBOXES header renders teamUnreadTotal via badge-unread-team-inboxes testid",
  /data-testid="badge-unread-team-inboxes"/.test(src) && /\{teamUnreadTotal\}/.test(src)
);
check(
  "PRIVATE INBOXES header renders privateUnreadTotal via badge-unread-private-inboxes testid",
  /data-testid="badge-unread-private-inboxes"/.test(src) && /\{privateUnreadTotal\}/.test(src)
);

// ── B. Per-account row badges — present for personal, team, and private rows ──
const accountBadgeOccurrences = src.match(/data-testid=\{`badge-unread-account-\$\{[^}]+\}`\}/g) || [];
check(
  "at least 3 per-account unread badges are wired (personal, team, private rows)",
  accountBadgeOccurrences.length >= 3
);
check(
  "team-inbox row badge falls back to unreadOfAccount(acct) when inactive",
  /isThisActive \? serverInboxUnreadCount : unreadOfAccount\(acct\)/.test(src)
);
check(
  "personal-account row badge falls back to unreadOfAccount(personalAccount) when inactive",
  /activeAccountId === null \? serverInboxUnreadCount : unreadOfAccount\(personalAccount\)/.test(src)
);

// ── D. Folder-level counts (Drafts, etc.) must remain untouched by this feature ──
// Draft counts are sourced from a distinct draftsCount/folder query, never from
// unreadOfAccount()/healthById — pin that no folder-count call site was rewired.
const draftsBadgeBlocks = src.match(/data-testid=\{`nav-tab-drafts[^`]*`\}[\s\S]{0,400}/g) || [];
check(
  "Drafts nav tab(s) exist and do not reference unreadOfAccount/healthById for their badge",
  draftsBadgeBlocks.length > 0 &&
    draftsBadgeBlocks.every((b) => !/unreadOfAccount|healthById/.test(b))
);

// ── E. Permission safety — totals are derived only from already-filtered account arrays ──
check(
  "no new fetch/query introduced for unread totals (reuses existing healthById state)",
  !/useQuery\([^)]*unread-total/.test(src)
);
check(
  "healthById is populated from the permission-scoped accounts/health endpoint",
  /\/api\/gmail\/accounts\/health/.test(src) &&
    /healthById/.test(src)
);

console.log("");
if (failures === 0) {
  console.log(`✅ All ${accountBadgeOccurrences.length >= 3 ? "" : ""}checks passed (0 failures)`);
  process.exit(0);
} else {
  console.error(`❌ ${failures} check(s) failed`);
  process.exit(1);
}
