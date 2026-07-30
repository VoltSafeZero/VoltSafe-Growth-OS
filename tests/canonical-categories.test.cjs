/**
 * canonical-categories.test.cjs
 *
 * Source-grep regression suite for the canonical Smart Inbox taxonomy.
 *
 * Asserts:
 *   - InboxCategory type contains only: "all" | "people" | "newsletters" | "notifications"
 *   - Legacy categories (updates, promotions, social, forums, priority) never appear as
 *     sidebar tab keys or InboxCategory type members
 *   - Both sidebar tab arrays use exactly the 3 canonical categories
 *   - getEmailCategory maps legacy labels to the 3-category taxonomy
 *   - sidebarCategoryBadges uses newsletters/notifications not raw Gmail categories
 *   - Warmness recompute uses correct column name (to_emails not to_email)
 */

"use strict";
const fs = require("fs");
const path = require("path");

const INBOX = path.join(__dirname, "../client/src/pages/gmail-inbox.tsx");
const BACKFILL = path.join(__dirname, "../server/services/backfill-service.ts");

const inboxSrc   = fs.readFileSync(INBOX,   "utf8");
const backfillSrc = fs.readFileSync(BACKFILL, "utf8");

let passed = 0;
let failed = 0;

function check(description, condition) {
  if (condition) {
    console.log(`  ✅  ${description}`);
    passed++;
  } else {
    console.error(`  ❌  ${description}`);
    failed++;
  }
}

console.log("\n── Canonical InboxCategory type ──────────────────────────────────────");

// Type must include the 3 canonical values
check(
  'InboxCategory type contains "people"',
  inboxSrc.includes('"people"') && /type InboxCategory.*people/.test(inboxSrc)
);
check(
  'InboxCategory type contains "newsletters"',
  /type InboxCategory[^;]*newsletters/.test(inboxSrc)
);
check(
  'InboxCategory type contains "notifications"',
  /type InboxCategory[^;]*notifications/.test(inboxSrc)
);

// Type must NOT contain legacy values as type members
const typeMatch = inboxSrc.match(/type InboxCategory\s*=\s*[^;]+;/);
const typeDecl = typeMatch ? typeMatch[0] : "";
check(
  'InboxCategory type does NOT contain "updates"',
  !typeDecl.includes('"updates"')
);
check(
  'InboxCategory type does NOT contain "promotions"',
  !typeDecl.includes('"promotions"')
);
check(
  'InboxCategory type does NOT contain "social"',
  !typeDecl.includes('"social"')
);
check(
  'InboxCategory type does NOT contain "forums"',
  !typeDecl.includes('"forums"')
);
check(
  'InboxCategory type does NOT contain "priority"',
  !typeDecl.includes('"priority"')
);

console.log("\n── getEmailCategory mapping ───────────────────────────────────────────");

check(
  'CATEGORY_PROMOTIONS maps to "newsletters"',
  inboxSrc.includes('CATEGORY_PROMOTIONS') && 
  /CATEGORY_PROMOTIONS.*newsletters|newsletters.*CATEGORY_PROMOTIONS/.test(inboxSrc)
);
check(
  'CATEGORY_FORUMS maps to "newsletters"',
  /CATEGORY_FORUMS.*newsletters|newsletters.*CATEGORY_FORUMS/.test(inboxSrc)
);
check(
  'CATEGORY_UPDATES maps to "notifications"',
  /CATEGORY_UPDATES.*notifications|notifications.*CATEGORY_UPDATES/.test(inboxSrc)
);
check(
  'CATEGORY_SOCIAL maps to "notifications"',
  /CATEGORY_SOCIAL.*notifications|notifications.*CATEGORY_SOCIAL/.test(inboxSrc)
);
check(
  'getEmailCategory return type includes "newsletters"',
  /getEmailCategory.*:.*newsletters/.test(inboxSrc)
);
check(
  'getEmailCategory return type includes "notifications"',
  /getEmailCategory.*:.*notifications/.test(inboxSrc)
);
check(
  'getEmailCategory does NOT return "updates"',
  !/"updates"/.test(
    (inboxSrc.match(/function getEmailCategory[\s\S]*?\n\}/) || [""])[0]
  )
);
check(
  'getEmailCategory does NOT return "promotions"',
  !/"promotions"/.test(
    (inboxSrc.match(/function getEmailCategory[\s\S]*?\n\}/) || [""])[0]
  )
);

console.log("\n── Sidebar tab arrays ─────────────────────────────────────────────────");

// Count occurrences of canonical category keys in the tab arrays
const tabArrayBlocks = [...inboxSrc.matchAll(/key:\s*"(all|people|newsletters|notifications|updates|promotions|social|forums|forums)"\s*as const/g)];
const tabKeys = tabArrayBlocks.map(m => m[1]);

check(
  'Sidebar has "newsletters" tab key',
  tabKeys.includes("newsletters")
);
check(
  'Sidebar has "notifications" tab key',
  tabKeys.includes("notifications")
);
check(
  'Sidebar does NOT have "updates" tab key',
  !tabKeys.includes("updates")
);
check(
  'Sidebar does NOT have "promotions" tab key',
  !tabKeys.includes("promotions")
);
check(
  'Sidebar does NOT have "social" tab key',
  !tabKeys.includes("social")
);
check(
  'Sidebar does NOT have "forums" tab key',
  !tabKeys.includes("forums")
);

// 3 sidebar sections × 4 keys: personal, private, team (all, people, newsletters, notifications)
const allKeys   = tabKeys.filter(k => k === "all").length;
const peopleKeys = tabKeys.filter(k => k === "people").length;
const nlKeys    = tabKeys.filter(k => k === "newsletters").length;
const notifKeys = tabKeys.filter(k => k === "notifications").length;
check(
  'All 3 sidebar sections render "all" key (count = 3)',
  allKeys === 3
);
check(
  'All 3 sidebar sections render "people" key (count = 3)',
  peopleKeys === 3
);
check(
  'All 3 sidebar sections render "newsletters" key (count = 3)',
  nlKeys === 3
);
check(
  'All 3 sidebar sections render "notifications" key (count = 3)',
  notifKeys === 3
);

console.log("\n── sidebarCategoryBadges ─────────────────────────────────────────────");

check(
  'sidebarCategoryBadges has .newsletters field',
  /sidebarCategoryBadges\s*=.*newsletters/s.test(inboxSrc)
);
check(
  'sidebarCategoryBadges has .notifications field',
  /sidebarCategoryBadges\s*=.*notifications/s.test(inboxSrc)
);
check(
  'sidebarCategoryBadges does NOT have .updates field',
  !/sidebarCategoryBadges\s*=\s*useMemo[\s\S]*?updates:/.test(inboxSrc)
);
// Check for "promotions:" as an object key (word boundary, not as part of countSnapshot.promotions)
check(
  'sidebarCategoryBadges does NOT have a "promotions:" key',
  (() => {
    const memo = inboxSrc.match(/const sidebarCategoryBadges\s*=\s*useMemo\(\s*\(\)\s*=>\s*\(\{([\s\S]*?)\}\)/);
    if (!memo) return false; // can't parse — fail safe
    return !/^\s*promotions\s*:/.test(memo[1]);
  })()
);
check(
  'newsletters badge aggregates promotions + forums from countSnapshot',
  /newsletters\s*:\s*countSnapshot\.promotions\s*\+\s*countSnapshot\.forums/.test(inboxSrc)
);
check(
  'notifications badge aggregates updates + social from countSnapshot',
  /notifications\s*:\s*countSnapshot\.updates\s*\+\s*countSnapshot\.social/.test(inboxSrc)
);

console.log("\n── Breadcrumb labels ─────────────────────────────────────────────────");

check(
  'Breadcrumb renders "Newsletters" for newsletters category',
  /inboxCategory === "newsletters".*"Newsletters"/.test(inboxSrc)
);
check(
  'Breadcrumb renders "Notifications" for notifications category',
  /inboxCategory === "notifications".*"Notifications"/.test(inboxSrc)
);
check(
  'Breadcrumb does NOT render "Updates" label',
  !/inboxCategory === "updates"/.test(inboxSrc)
);
check(
  'Breadcrumb does NOT render "Promotions" label',
  !/inboxCategory === "promotions"/.test(inboxSrc)
);

console.log("\n── inboxCategoryQ query tokens ────────────────────────────────────────");

check(
  'inboxCategoryQ handles "newsletters" category',
  /inboxCategory === "newsletters"/.test(inboxSrc)
);
check(
  'inboxCategoryQ handles "notifications" category',
  /inboxCategory === "notifications"/.test(inboxSrc)
);
check(
  'inboxCategoryQ does NOT have "in:updates" branch for sidebar category',
  !/inboxCategory === "updates"\s*\)\s*return "in:updates/.test(inboxSrc)
);
check(
  'inboxCategoryQ does NOT have "in:promotions" branch for sidebar category',
  !/inboxCategory === "promotions"\s*\)\s*return "in:promotions/.test(inboxSrc)
);

console.log("\n── Legacy category normalization in categorizedInbox ─────────────────");

check(
  'categorizedInbox normalizes "promotions" → "newsletters"',
  /promotions.*newsletters|newsletters.*promotions/.test(
    (inboxSrc.match(/const categorizedInbox[\s\S]*?;/) || [""])[0]
  ) || inboxSrc.includes('"promotions" || raw === "forums")  ? "newsletters"')
);
check(
  'categorizedInbox normalizes "updates" → "notifications"',
  inboxSrc.includes('"updates"  || raw === "social")  ? "notifications"') ||
  /updates.*notifications|notifications.*updates/.test(
    (inboxSrc.match(/const categorizedInbox[\s\S]*?;/) || [""])[0]
  )
);

console.log("\n── Warmness recompute SQL ─────────────────────────────────────────────");

check(
  'computeWarmness uses "to_emails" column (not "to_email")',
  backfillSrc.includes("to_emails") && !backfillSrc.includes("to_email\b")
);
check(
  'computeWarmness uses UNION ALL to expand to_emails JSON array',
  /UNION ALL/.test(backfillSrc) && /jsonb_array_elements_text\(to_emails::jsonb\)/.test(backfillSrc)
);
check(
  'computeWarmness outbound expansion uses to_emails',
  /jsonb_array_elements_text\(to_emails::jsonb\)/.test(backfillSrc)
);
check(
  'computeWarmness does NOT reference singular to_email column',
  !/\bto_email\b/.test(backfillSrc)
);

console.log("\n── Priority / star UI removal ────────────────────────────────────────");

check(
  'No "priority" sidebar tab key in inbox',
  !/key:\s*"priority"\s*as const/.test(inboxSrc)
);
check(
  'No Priority label in sidebar tab arrays',
  !/label:\s*"Priority"/.test(inboxSrc)
);

console.log("\n────────────────────────────────────────────────────────────────────");
console.log(`Results: ${passed}/${passed + failed} checks passed`);
if (failed > 0) {
  console.error(`\n${failed} check(s) FAILED`);
  process.exit(1);
} else {
  console.log("\nAll canonical-category checks passed. ✅");
  process.exit(0);
}
