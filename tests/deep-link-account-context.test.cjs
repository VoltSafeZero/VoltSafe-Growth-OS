/**
 * Deep-link account context — source-grep invariants
 *
 * Verifies the "Open in VS Mail" deep-link bug fix:
 * 1. Backend: orphaned asAccountId falls back to unified lookup instead of 403.
 * 2. Frontend: isDeepLinkMode is computed from URL params (?thread= + ?account=).
 * 3. Frontend: global expired banner is suppressed in deep-link mode.
 * 4. Frontend: thread-pane source-account notice shown for disconnected mailboxes.
 *
 * All checks are source-grep — no live network calls.
 */

"use strict";
const fs = require("fs");
const path = require("path");

const ROUTES = path.join(__dirname, "../server/routes.ts");
const INBOX = path.join(__dirname, "../client/src/pages/gmail-inbox.tsx");

const routesSrc = fs.readFileSync(ROUTES, "utf8");
const inboxSrc = fs.readFileSync(INBOX, "utf8");

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

// ── Backend: thread endpoint orphan fallback ───────────────────────────────
console.log("\n[backend] thread endpoint — orphan asAccountId fallback");

check(
  "thread endpoint uses `let resolved` (reassignable for fallback)",
  /let resolved = await resolveAccount\(userId, asAccountId/.test(routesSrc)
);

check(
  "fallback block triggered when !resolved AND numeric asAccountId",
  /if \(!resolved && asAccountId && typeof asAccountId === "number"\)/.test(routesSrc)
);

check(
  "fallback calls getUserGmailAccount for primary account",
  /const fallbackAcct = await getUserGmailAccount\(userId\)/.test(routesSrc)
);

check(
  "fallback calls getAccessibleAccountIds for unified scope",
  /const allIds = await getAccessibleAccountIds\(userId, _ia, _mtp\)/.test(routesSrc)
);

check(
  "fallback constructs resolved with accountIds (unified search)",
  /resolved = \{[^}]*accountIds: allIds/.test(routesSrc)
);

check(
  "fallback logs orphaned asAccountId for observability",
  /orphaned asAccountId=/.test(routesSrc)
);

check(
  "403 guard still fires after fallback when no accounts at all",
  (() => {
    // The 403 guard for the thread endpoint must come AFTER the orphan-fallback block.
    // Search for the guard starting from after the fallback log line.
    const fallbackIdx = routesSrc.indexOf("orphaned asAccountId=");
    const guardIdx = routesSrc.indexOf("No Gmail account connected", fallbackIdx + 1);
    return fallbackIdx > 0 && guardIdx > fallbackIdx;
  })()
);

// ── Frontend: isDeepLinkMode ───────────────────────────────────────────────
console.log("\n[frontend] isDeepLinkMode computed at mount");

check(
  "isDeepLinkMode is declared as a useMemo",
  /const isDeepLinkMode = useMemo\(/.test(inboxSrc)
);

check(
  "isDeepLinkMode checks for ?thread= in URL",
  /params\.get\("thread"\)/.test(inboxSrc) && /isDeepLinkMode/.test(inboxSrc)
);

check(
  "isDeepLinkMode checks for ?account= in URL",
  /params\.get\("account"\).*isDeepLinkMode|isDeepLinkMode.*params\.get\("account"\)/s.test(inboxSrc)
);

check(
  "isDeepLinkMode has empty deps array (computed once at mount)",
  (() => {
    const idx = inboxSrc.indexOf("const isDeepLinkMode = useMemo(");
    if (idx < 0) return false;
    const snippet = inboxSrc.slice(idx, idx + 300);
    return /\}, \[\]\)/.test(snippet);
  })()
);

// ── Frontend: expired banner suppression ──────────────────────────────────
console.log("\n[frontend] global expired banner suppressed in deep-link mode");

check(
  "expired banner condition includes !isDeepLinkMode guard",
  /statusQuery\.data\?\.connected && !statusQuery\.data\?\.tokenValid && !isDeepLinkMode/.test(inboxSrc)
);

check(
  "expired banner has explanatory comment about deep-link suppression",
  /suppressed in deep-link mode/.test(inboxSrc)
);

// ── Frontend: thread-pane source account notice ────────────────────────────
console.log("\n[frontend] thread-pane disconnected source-account notice");

check(
  "notice has data-testid=deep-link-expired-source-notice",
  /data-testid="deep-link-expired-source-notice"/.test(inboxSrc)
);

check(
  "notice only renders when isDeepLinkMode is true",
  /isDeepLinkMode && currentThreadAccountId/.test(inboxSrc)
);

check(
  "notice looks up the source account by currentThreadAccountId in accountsQuery",
  /accountsQuery\.data\?\.find\(a => a\.id === currentThreadAccountId\)/.test(inboxSrc)
);

check(
  "notice only shows when account is NOT active (authStatus check)",
  /srcAcct\.authStatus === "active"/.test(inboxSrc)
);

check(
  "notice shows the account's email address",
  /srcAcct\.emailAddress/.test(inboxSrc)
);

check(
  "notice includes 'mailbox disconnected' text",
  /mailbox disconnected/.test(inboxSrc)
);

check(
  "notice includes a reconnect link to /api/auth/gmail/connect",
  /href="\/api\/auth\/gmail\/connect"/.test(inboxSrc) &&
  /Reconnect/.test(inboxSrc)
);

check(
  "notice is inside the thread subject else-branch (after isError check)",
  (() => {
    const noticeIdx = inboxSrc.indexOf("deep-link-expired-source-notice");
    const isErrorIdx = inboxSrc.indexOf("threadQuery.isError");
    return noticeIdx > isErrorIdx;
  })()
);

// ── Structural: currentThreadAccountId still initialized from URL ──────────
console.log("\n[frontend] currentThreadAccountId URL initialization intact");

check(
  "currentThreadAccountId still initialized from ?account= URL param",
  /const \[currentThreadAccountId, setCurrentThreadAccountId\] = useState.*params\.get\("account"\)/s.test(inboxSrc)
);

check(
  "setCurrentThreadAccountId called in handleSelectMessage",
  /setCurrentThreadAccountId\(msg\.sourceAccountId/.test(inboxSrc)
);

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(55)}`);
console.log(`deep-link-account-context: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
