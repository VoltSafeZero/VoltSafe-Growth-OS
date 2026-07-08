/**
 * tests/mailbox-privacy.test.cjs
 *
 * Source-grep regression suite for the private personal mailbox visibility system.
 * 20 scenarios. All checks are structural (source-code pattern verification).
 *
 * Run: node tests/mailbox-privacy.test.cjs
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ── helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const errors = [];

function check(label, fn) {
  try {
    const ok = fn();
    if (ok) {
      console.log(`  ✓ ${label}`);
      passed++;
    } else {
      console.log(`  ✗ ${label}`);
      failed++;
      errors.push(label);
    }
  } catch (e) {
    console.log(`  ✗ ${label} — threw: ${e.message}`);
    failed++;
    errors.push(`${label} (threw: ${e.message})`);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function contains(src, pattern) {
  if (pattern instanceof RegExp) return pattern.test(src);
  return src.includes(pattern);
}

// ── load source files ─────────────────────────────────────────────────────────

const routes      = read("server/routes.ts");
const gmailOauth  = read("server/gmail-oauth.ts");
const mailboxSettings = read("client/src/pages/mailbox-settings.tsx");
const gmailInbox  = read("client/src/pages/gmail-inbox.tsx");
const migration   = read("migrations/0027_mailbox_visibility.sql");

// ── SCENARIO 1-5: Core access control in routes.ts ───────────────────────────

console.log("\n[S1-S5] Core access control — getAccessibleAccountIds / getAccessibleAccounts");

check(
  "S1: getAccessibleAccountIds excludes private_personal accounts owned by others",
  () => contains(routes, "COALESCE(visibility_type, 'private_personal') != 'private_personal'")
);

check(
  "S2: getAccessibleAccountIds collects non-owned accessible accounts (no admin bypass)",
  () => contains(routes, "Non-owned accounts: private_personal is NEVER accessible by others — no admin bypass")
);

check(
  "S3: getAccessibleAccounts uses raw SQL to filter non-owned private_personal out",
  () => contains(routes, "Non-owned: private_personal is blocked for ALL non-owners (no admin bypass)")
);

check(
  "S4: getAccessibleAccounts admin path still filters private_personal at SQL level",
  () => {
    // The raw SQL query itself blocks private_personal — admin only governs what's left
    const inFn = routes.match(/async function getAccessibleAccounts[\s\S]+?return \[\.\.\.ownAccts/)?.[0] ?? "";
    return contains(inFn, "COALESCE(visibility_type, 'private_personal') != 'private_personal'");
  }
);

check(
  "S5: getAccessibleAccountIds returns union of own accounts + accessible non-owned",
  () => contains(routes, "return [...new Set([...ownIds, ...accessibleNonOwned])]")
);

// ── SCENARIO 6-9: resolveAccount & requireAccountEditAccess ──────────────────

console.log("\n[S6-S9] resolveAccount & requireAccountEditAccess admin bypass removal");

check(
  "S6: resolveAccount fetches visibility_type before allowing non-owner access",
  () => contains(routes, "vtRowRA") && contains(routes, "visibilityTypeRA === 'private_personal'")
);

check(
  "S7: resolveAccount returns null for private_personal non-owner (no admin bypass)",
  () => {
    const block = routes.match(/\/\/ private_personal: no access for non-owners[\s\S]+?if \(visibilityTypeRA === 'private_personal'\) return null/)?.[0] ?? "";
    return block.length > 0;
  }
);

check(
  "S8: requireAccountEditAccess checks visibility_type before admin bypass",
  () => contains(routes, "vtRowEdit") && contains(routes, "visibilityTypeEdit === 'private_personal'")
);

check(
  "S9: requireAccountEditAccess returns 403 for private_personal regardless of admin role",
  () => contains(routes, 'res.status(403).json({ message: "You do not have access to this private mailbox." })')
);

// ── SCENARIO 10-12: OAuth connect flow ───────────────────────────────────────

console.log("\n[S10-S12] OAuth connect flow with visibility type");

check(
  "S10: /api/my/mailbox/connect reads visibilityType query param with allowlist validation",
  () => contains(routes, 'const VALID_VT = ["private_personal", "team_shared", "company_managed"]')
);

check(
  "S11: /api/my/mailbox/connect gates team_shared / company_managed to master_admin only",
  () => contains(routes, 'Only master admins can connect shared or company-managed mailboxes.')
);

check(
  "S12: OAuth callback passes visibilityTypeCB to exchangeCodeForTokens as 4th param",
  () => contains(routes, "await exchangeCodeForTokens(code, userId, isShared, visibilityTypeCB)")
);

// ── SCENARIO 13-14: gmail-oauth.ts stores visibility_type ────────────────────

console.log("\n[S13-S14] exchangeCodeForTokens saves visibility_type to DB");

check(
  "S13: exchangeCodeForTokens accepts visibilityType as 4th parameter",
  () => contains(gmailOauth, "visibilityType = 'private_personal'")
);

check(
  "S14: exchangeCodeForTokens persists visibility_type via raw SQL UPDATE after insert",
  () => contains(gmailOauth, "UPDATE email_accounts SET visibility_type = '${vt}' WHERE id = ${resultAccountId}")
);

// ── SCENARIO 15: PATCH /api/my/mailbox/:id/visibility route ──────────────────

console.log("\n[S15] PATCH visibility route");

check(
  "S15: PATCH /api/my/mailbox/:id/visibility route exists and validates visibilityType",
  () => contains(routes, "PATCH /api/my/mailbox/:id/visibility") &&
        contains(routes, 'visibilityType must be: ')
);

// ── SCENARIO 16: /api/gmail/accounts returns visibilityType ──────────────────

console.log("\n[S16] /api/gmail/accounts visibility type annotation");

check(
  "S16: /api/gmail/accounts annotates each account with visibilityType from DB",
  () => contains(routes, "vtMap.get(a.id) ?? (a.isShared ? 'team_shared' : 'private_personal')")
);

// ── SCENARIO 17-18: Migration ─────────────────────────────────────────────────

console.log("\n[S17-S18] Migration correctness");

check(
  "S17: migration adds visibility_type column with DEFAULT private_personal",
  () => contains(migration, "ADD COLUMN IF NOT EXISTS visibility_type TEXT NOT NULL DEFAULT 'private_personal'")
);

check(
  "S18: migration correctly classifies is_shared=TRUE accounts as team_shared",
  () => contains(migration, "SET visibility_type = 'team_shared'\n  WHERE is_shared = TRUE")
);

// ── SCENARIO 19-20: Frontend ──────────────────────────────────────────────────

console.log("\n[S19-S20] Frontend lock icon and visibility picker");

check(
  "S19: gmail-inbox.tsx shows lock icon on private_personal personal account",
  () => contains(gmailInbox, "visibilityType === 'private_personal'") &&
        contains(gmailInbox, "Private mailbox — only visible to you")
);

check(
  "S20: mailbox-settings.tsx has visibility picker dialog with private_personal / team_shared / company_managed options",
  () => contains(mailboxSettings, "showVisibilityPicker") &&
        contains(mailboxSettings, `visibility-option-\${value}`) &&
        contains(mailboxSettings, '"private_personal" as const') &&
        contains(mailboxSettings, '"team_shared" as const') &&
        contains(mailboxSettings, '"company_managed" as const')
);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
if (errors.length) {
  console.log("\nFailed checks:");
  errors.forEach((e) => console.log(`  - ${e}`));
  process.exit(1);
} else {
  console.log("All checks passed ✓");
  process.exit(0);
}
