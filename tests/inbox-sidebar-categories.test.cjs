#!/usr/bin/env node
// tests/inbox-sidebar-categories.test.cjs
// Behavioural source-code checks verifying the canonical inbox sidebar category system.
// Covers: shared constant, 3 sidebar sections, onFilter routing, badge labels,
// unread loader termination, legacy-tab dead-code, and InboxCategory type.
"use strict";
const fs = require("fs");
const path = require("path");

const INBOX_SRC = path.join(__dirname, "../client/src/pages/gmail-inbox.tsx");
const inboxSrc  = fs.readFileSync(INBOX_SRC, "utf8");

let passed = 0; let failed = 0; const failures = [];
function check(name, condition) {
  if (condition) { passed++; console.log(`  ✅  ${name}`); }
  else           { failed++; failures.push(name); console.log(`  ❌  ${name}`); }
}

// ── 1. INBOX_CATEGORY_TABS constant ──────────────────────────────────────────
console.log("\n── INBOX_CATEGORY_TABS constant ─────────────────────────────────────────");

check('INBOX_CATEGORY_TABS constant defined at module level',
  /const INBOX_CATEGORY_TABS\s*=\s*\[/.test(inboxSrc));

const ctMatch = inboxSrc.match(/const INBOX_CATEGORY_TABS\s*=\s*\[([\s\S]*?)\];/);
const ctBlock = ctMatch ? ctMatch[1] : "";
const ctKeys  = [...ctBlock.matchAll(/key:\s*["'](\w+)["']/g)].map(m => m[1]);

check('INBOX_CATEGORY_TABS has exactly 4 entries',      ctKeys.length === 4);
check('INBOX_CATEGORY_TABS entry: "all"',               ctKeys.includes("all"));
check('INBOX_CATEGORY_TABS entry: "people"',            ctKeys.includes("people"));
check('INBOX_CATEGORY_TABS entry: "newsletters"',       ctKeys.includes("newsletters"));
check('INBOX_CATEGORY_TABS entry: "notifications"',     ctKeys.includes("notifications"));
check('INBOX_CATEGORY_TABS entry: no "updates"',        !ctKeys.includes("updates"));
check('INBOX_CATEGORY_TABS entry: no "promotions"',     !ctKeys.includes("promotions"));
check('INBOX_CATEGORY_TABS entry: no "social"',         !ctKeys.includes("social"));
check('INBOX_CATEGORY_TABS entry: no "forums"',         !ctKeys.includes("forums"));

// ── 2. All 3 sidebar sections use the shared constant ─────────────────────────
console.log("\n── Sidebar sections use shared constant ─────────────────────────────────");

// After InboxCategoryNav refactor: one .map inside the shared component; 4 <InboxCategoryNav> call sites.
const mapUsages = [...inboxSrc.matchAll(/INBOX_CATEGORY_TABS\.map/g)].length;
check('INBOX_CATEGORY_TABS.map appears exactly 1 time (inside shared InboxCategoryNav component)',
  mapUsages === 1);
const navUsages = [...inboxSrc.matchAll(/<InboxCategoryNav\b/g)].length;
check('<InboxCategoryNav> used at exactly 4 call sites (personal + fallback + private + team)',
  navUsages === 4);

// The shared constant defines key:"all" as InboxCategory exactly once.
// Sidebar sections use INBOX_CATEGORY_TABS.map — no additional inline copies.
const inlineArrays = [...inboxSrc.matchAll(/\{\s*key:\s*["']all["']\s+as\s+(?:const|InboxCategory)/g)].length;
check('key:"all" as InboxCategory appears exactly once (only in INBOX_CATEGORY_TABS constant, never inline)',
  inlineArrays === 1);

// After InboxCategoryNav refactor: testid is nav-inbox-cat-${key}${testIdSuffix}.
// Personal/fallback pass no testIdSuffix (empty string); private/team pass `-${acct.id}`.
check('InboxCategoryNav renders nav-inbox-cat-${key}${testIdSuffix} pattern',
  inboxSrc.includes('nav-inbox-cat-${key}${testIdSuffix}'));
check('Private/team InboxCategoryNav usages pass testIdSuffix={`-${acct.id}`}',
  /testIdSuffix=\{`-\$\{acct\.id\}`\}/.test(inboxSrc));

// ── 3. onFilter uses canonical inboxCategory routing ─────────────────────────
console.log("\n── onFilter canonical routing ───────────────────────────────────────────");

check('onFilter does NOT route to setTab("updates")',    !inboxSrc.includes('setTab("updates")')  );
check('onFilter does NOT route to setTab("promotions")',!inboxSrc.includes('setTab("promotions")'));
check('onFilter does NOT route to setTab("social")',    !inboxSrc.includes('setTab("social")')   );
check('onFilter does NOT route to setTab("forums")',    !inboxSrc.includes('setTab("forums")')   );

check('onFilter catMap: CATEGORY_UPDATES → "notifications"',
  /CATEGORY_UPDATES\s*:\s*["']notifications["']/.test(inboxSrc));
check('onFilter catMap: CATEGORY_PROMOTIONS → "newsletters"',
  /CATEGORY_PROMOTIONS\s*:\s*["']newsletters["']/.test(inboxSrc));
check('onFilter catMap: CATEGORY_SOCIAL → "notifications"',
  /CATEGORY_SOCIAL\s*:\s*["']notifications["']/.test(inboxSrc));
check('onFilter catMap: CATEGORY_FORUMS → "newsletters"',
  /CATEGORY_FORUMS\s*:\s*["']newsletters["']/.test(inboxSrc));
check('onFilter calls setInboxCategory(dest) after setTab("inbox")',
  /setTab\("inbox"\)[\s\S]{0,80}setInboxCategory\(dest\)/.test(inboxSrc));

// ── 4. CATEGORY_BADGE_CONFIG uses canonical display names ────────────────────
console.log("\n── CATEGORY_BADGE_CONFIG canonical labels ───────────────────────────────");

const cfgMatch = inboxSrc.match(/const CATEGORY_BADGE_CONFIG[\s\S]*?\};/);
const cfgBlock = cfgMatch ? cfgMatch[0] : "";

check('CATEGORY_BADGE_CONFIG: CATEGORY_UPDATES label is "Notifications"',
  /CATEGORY_UPDATES[\s\S]{0,40}label:\s*["']Notifications["']/.test(cfgBlock));
check('CATEGORY_BADGE_CONFIG: CATEGORY_PROMOTIONS label is "Newsletters"',
  /CATEGORY_PROMOTIONS[\s\S]{0,40}label:\s*["']Newsletters["']/.test(cfgBlock));
check('CATEGORY_BADGE_CONFIG: CATEGORY_SOCIAL label is "Notifications"',
  /CATEGORY_SOCIAL[\s\S]{0,40}label:\s*["']Notifications["']/.test(cfgBlock));
check('CATEGORY_BADGE_CONFIG: CATEGORY_FORUMS label is "Newsletters"',
  /CATEGORY_FORUMS[\s\S]{0,40}label:\s*["']Newsletters["']/.test(cfgBlock));
check('CATEGORY_BADGE_CONFIG: no entry with label "Updates"',
  !/label:\s*["']Updates["']/.test(cfgBlock));
check('CATEGORY_BADGE_CONFIG: no entry with label "Promotions"',
  !/label:\s*["']Promotions["']/.test(cfgBlock));
check('CATEGORY_BADGE_CONFIG: no entry with label "Social"',
  !/label:\s*["']Social["']/.test(cfgBlock));
check('CATEGORY_BADGE_CONFIG: no entry with label "Forums"',
  !/label:\s*["']Forums["']/.test(cfgBlock));

// ── 5. InboxCategory type ─────────────────────────────────────────────────────
console.log("\n── InboxCategory type ───────────────────────────────────────────────────");

check('InboxCategory type is "all"|"people"|"newsletters"|"notifications"',
  /type InboxCategory\s*=\s*["']all["']\s*\|\s*["']people["']\s*\|\s*["']newsletters["']\s*\|\s*["']notifications["']/.test(inboxSrc));
check('InboxCategory does NOT include "updates"',
  !/type InboxCategory[\s\S]{0,120}"updates"/.test(inboxSrc));
check('InboxCategory does NOT include "promotions"',
  !/type InboxCategory[\s\S]{0,120}"promotions"/.test(inboxSrc));
check('InboxCategory does NOT include "priority"',
  !/type InboxCategory[\s\S]{0,120}"priority"/.test(inboxSrc));

// ── 6. Unread loader termination guard ───────────────────────────────────────
console.log("\n── Unread loader termination ────────────────────────────────────────────");

check('Unread loader guards with inboxQuery.isFetching (terminates when query settles)',
  /crmFilter === ["']unread["'][\s\S]{0,200}inboxQuery\.isFetching/.test(inboxSrc));
check('Unread loader guards with inboxQuery.isLoading',
  /crmFilter === ["']unread["'][\s\S]{0,200}inboxQuery\.isLoading/.test(inboxSrc));
check('Unread loader requires BOTH isLoading and isFetching (OR guard)',
  /crmFilter === ["']unread["'][\s\S]{0,250}inboxQuery\.isLoading\s*\|\|\s*inboxQuery\.isFetching/.test(inboxSrc));

// ── 7. Legacy category tab dead-code disabled ─────────────────────────────────
console.log("\n── Legacy isCategoryTab disabled ────────────────────────────────────────");

check('isCategoryTab is hardcoded false (legacy tab path disabled)',
  /const isCategoryTab\s*=\s*false/.test(inboxSrc));
check('No active tab === "updates" comparison (old category tab routing gone)',
  !/tab\s*===\s*["']updates["']/.test(inboxSrc));
check('No active tab === "promotions" comparison',
  !/tab\s*===\s*["']promotions["']/.test(inboxSrc));
check('No active tab === "social" comparison',
  !/tab\s*===\s*["']social["']/.test(inboxSrc));
check('No active tab === "forums" comparison',
  !/tab\s*===\s*["']forums["']/.test(inboxSrc));

// ── 8. No legacy provider label text visible in any render path ──────────────
console.log("\n── No legacy provider labels in render paths ────────────────────────────");

// These labels must NOT appear as user-visible text in JSX (they can still
// appear as keys/identifiers in CATEGORY_BADGE_CONFIG and DB mappings).
// We check they don't appear as literal JSX text content (>{label}</span> style).
check('Row badge never shows text "Updates" (canonical: "Notifications")',
  !/>\s*Updates\s*<\//.test(inboxSrc));
check('Row badge never shows text "Promotions" (canonical: "Newsletters")',
  !/>\s*Promotions\s*<\//.test(inboxSrc));
check('Row badge never shows text "Social" (canonical: "Notifications")',
  !/>\s*Social\s*<\//.test(inboxSrc));
check('Row badge never shows text "Forums" (canonical: "Newsletters")',
  !/>\s*Forums\s*<\//.test(inboxSrc));
check('No sidebar tab labelled "Updates"',
  !/label:\s*["']Updates["']/.test(inboxSrc));
check('No sidebar tab labelled "Promotions"',
  !/label:\s*["']Promotions["']/.test(inboxSrc));
check('No sidebar tab labelled "Priority" in INBOX_CATEGORY_TABS',
  !/INBOX_CATEGORY_TABS[\s\S]{0,200}"Priority"/.test(inboxSrc));

// ── 9. getEmailCategory returns canonical values ──────────────────────────────
console.log("\n── getEmailCategory canonical return values ──────────────────────────────");

check('getEmailCategory returns "newsletters" (not "promotions")',
  /getEmailCategory[\s\S]{0,300}return "newsletters"/.test(inboxSrc));
check('getEmailCategory returns "notifications" (not "updates")',
  /getEmailCategory[\s\S]{0,300}return "notifications"/.test(inboxSrc));
check('getEmailCategory returns "people" as default',
  /getEmailCategory[\s\S]{0,300}return "people"/.test(inboxSrc));

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n────────────────────────────────────────────────────────────────────");
console.log(`Results: ${passed}/${passed + failed} checks passed`);
if (failed > 0) {
  console.log(`\nFailed checks:`);
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
} else {
  console.log("\nAll inbox-sidebar-categories checks passed. ✅");
  process.exit(0);
}
