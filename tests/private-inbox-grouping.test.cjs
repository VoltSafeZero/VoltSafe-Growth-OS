// tests/private-inbox-grouping.test.cjs
// Regression: private Gmail accounts appear under PRIVATE INBOXES,
// work/team inboxes are never displaced or hidden.

const fs = require("fs");
const src = fs.readFileSync("client/src/pages/gmail-inbox.tsx", "utf8");
const routesSrc = fs.readFileSync("server/routes.ts", "utf8");

let pass = 0, fail = 0;
function check(label, condition) {
  if (condition) { console.log(`  ✓ ${label}`); pass++; }
  else { console.error(`  ✗ ${label}`); fail++; }
}

console.log("=== Private Inbox Grouping Regression ===");

console.log("── ConnectedAccount type includes visibilityType ──");
check("visibilityType field in ConnectedAccount type",
  /type ConnectedAccount = \{[^}]*visibilityType: string/.test(src));

console.log("── Three-way account grouping computed ──");
check("workAccounts derived from company_managed",
  /workAccounts\s*=\s*allAccounts\.filter.*visibilityType.*company_managed/.test(src));
check("privateAccounts derived from private_personal + isOwner (multiline)",
  /privateAccounts\s*=\s*allAccounts\.filter[\s\S]{0,200}private_personal[\s\S]{0,50}isOwner/.test(src));
check("sharedAccounts excludes private_personal",
  /sharedAccounts.*filter[\s\S]{0,300}visibilityType.*private_personal.*return false/.test(src));
check("sharedAccounts excludes isOwner",
  /sharedAccounts.*filter[\s\S]{0,100}isOwner.*return false/.test(src));

console.log("── personalAccount prefers work account ──");
check("personalAccount = workAccounts[0] first",
  /personalAccount\s*=\s*workAccounts\[0\]/.test(src));

console.log("── connectedAccount prefers company_managed ──");
check("connectedAccount prefers company_managed",
  /connectedAccount[\s\S]{0,300}visibilityType.*company_managed[\s\S]{0,200}isOwner/.test(src));

console.log("── Sidebar section labels ──");
check("WORK INBOX section label present",   /Work Inbox/.test(src));
check("TEAM INBOXES section label present", /Team Inboxes/.test(src));
check("PRIVATE INBOXES section label present", /Private Inboxes/.test(src));
check("WORK INBOX shown only when hasMultipleSections",
  /hasMultipleSections[\s\S]{0,200}Work Inbox/.test(src));

console.log("── PRIVATE INBOXES section guarded by privateAccounts.length ──");
check("Private Inboxes section guarded by privateAccounts.length > 0",
  /privateAccounts\.length > 0/.test(src));
check("Private Inboxes label inside the guard block",
  /privateAccounts\.length > 0[\s\S]{0,400}Private Inboxes/.test(src));
check("Private inbox rows use btn-account-private- testid",
  /btn-account-private-/.test(src));
check("Private inbox rows show lock tooltip",
  /Private.*only you can see this inbox/.test(src));
check("Private inbox subtabs render when active",
  /nav-tab-inbox-private-/.test(src));
check("Add private inbox link present",
  /Add private inbox/.test(src));

console.log("── All Inboxes count ──");
check("totalAccessibleAccounts = work + team + private",
  /totalAccessibleAccounts\s*=\s*workAccounts\.length.*sharedAccounts\.length.*privateAccounts\.length/.test(src));
check("All Inboxes button gated on totalAccessibleAccounts > 1",
  /totalAccessibleAccounts > 1/.test(src));
check("All Inboxes badge displays totalAccessibleAccounts",
  /\{totalAccessibleAccounts\}/.test(src));

console.log("── Migration SQL ──");
check("team_shared UPDATE catches private_personal default",
  /UPDATE email_accounts SET visibility_type = 'team_shared'[\s\S]{0,120}visibility_type = 'private_personal'/.test(routesSrc));
check("company_managed UPDATE catches private_personal default",
  /UPDATE email_accounts SET visibility_type = 'company_managed'[\s\S]{0,300}visibility_type = 'private_personal'/.test(routesSrc));
check("company_managed UPDATE targets @voltsafe.com domain",
  /email_address LIKE '%@voltsafe\.com'/.test(routesSrc));

console.log("── accounts API annotates visibilityType per account ──");
check("GET /api/gmail/accounts uses vtMap to resolve visibilityType",
  /vtMap\.get\(a\.id\)/.test(routesSrc));
check("accounts API normalizes emailAddress from snake_case email_address",
  /emailAddress\s*=\s*a\.emailAddress\s*\?\?\s*a\.email_address/.test(routesSrc));
check("accounts API normalizes isShared from snake_case is_shared",
  /isShared\s*=\s*a\.isShared\s*\?\?\s*a\.is_shared/.test(routesSrc));
check("accounts API normalizes userId from snake_case user_id",
  /userId.*=\s*a\.userId\s*\?\?\s*a\.user_id/.test(routesSrc));
check("frontend emailAddress access guarded with || fallback",
  /acct\.emailAddress \|\| acct\.displayName \|\|/.test(src));

console.log("────────────────────────────────────────────────────────────");
console.log(`Results: ${pass + fail} checks — ${pass} passed, ${fail} failed`);
if (fail === 0) console.log("All checks passed ✓");
else { console.error(`${fail} check(s) FAILED`); process.exit(1); }
