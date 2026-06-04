#!/usr/bin/env node
/**
 * Category Folders Visibility Layer — regression tests
 *
 * Verifies that the four Gmail category folders (Newsletters & Updates,
 * Promotions, Social, Forums & Communities) are correctly wired in
 * local-mailbox.ts, routes.ts, and gmail-inbox.tsx.
 *
 * Uses source-grep strategy — no server or browser required.
 * Run with: node tests/category-folders.test.js
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function src(relPath) {
  return readFileSync(resolve(root, relPath), "utf8");
}

function has(text, pattern) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  return re.test(text);
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    passed++;
  } catch (e) {
    console.error(`  \u2717 ${name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const inbox     = src("client/src/pages/gmail-inbox.tsx");
const routes    = src("server/routes.ts");
const localMail = src("server/services/local-mailbox.ts");

// ── Tab type & state ──────────────────────────────────────────────────────────
console.log("\n[Tab type & state]");

test("tab type includes all four category values", () =>
  assert(has(inbox, /"updates".*"promotions".*"social".*"forums"/), "tab union type not found"));

test("CATEGORY_TABS constant defined", () =>
  assert(has(inbox, /CATEGORY_TABS/), "CATEGORY_TABS not found"));

test("isCategoryTab derived boolean exists", () =>
  assert(has(inbox, /isCategoryTab/), "isCategoryTab not found"));

// ── Local-mailbox label mapping ───────────────────────────────────────────────
console.log("\n[Local-mailbox label mapping]");

test("CATEGORY_LABEL_MAP maps UPDATES", () =>
  assert(has(localMail, /UPDATES.*CATEGORY_UPDATES/), "UPDATES mapping missing"));

test("CATEGORY_LABEL_MAP maps PROMOTIONS", () =>
  assert(has(localMail, /PROMOTIONS.*CATEGORY_PROMOTIONS/), "PROMOTIONS mapping missing"));

test("CATEGORY_LABEL_MAP maps SOCIAL", () =>
  assert(has(localMail, /SOCIAL.*CATEGORY_SOCIAL/), "SOCIAL mapping missing"));

test("CATEGORY_LABEL_MAP maps FORUMS", () =>
  assert(has(localMail, /FORUMS.*CATEGORY_FORUMS/), "FORUMS mapping missing"));

// ── Overflow guard ────────────────────────────────────────────────────────────
console.log("\n[Overflow guard]");

test("isSpamOrTrashQuery includes in:updates", () =>
  assert(has(routes, /isSpamOrTrashQuery.*updates/), "overflow guard missing updates"));

test("isSpamOrTrashQuery includes in:promotions", () =>
  assert(has(routes, /isSpamOrTrashQuery.*promotions/), "overflow guard missing promotions"));

test("isSpamOrTrashQuery includes in:social", () =>
  assert(has(routes, /isSpamOrTrashQuery.*social/), "overflow guard missing social"));

test("isSpamOrTrashQuery includes in:forums", () =>
  assert(has(routes, /isSpamOrTrashQuery.*forums/), "overflow guard missing forums"));

// ── Category counts API route ─────────────────────────────────────────────────
console.log("\n[Category counts API route]");

test("GET /api/gmail/category-counts route defined", () =>
  assert(has(routes, /app\.get\(["']\/api\/gmail\/category-counts["']/), "route not found"));

test("counts CATEGORY_UPDATES", () =>
  assert(has(routes, /CATEGORY_UPDATES/), "CATEGORY_UPDATES not counted"));

test("counts CATEGORY_PROMOTIONS", () =>
  assert(has(routes, /CATEGORY_PROMOTIONS/), "CATEGORY_PROMOTIONS not counted"));

test("counts CATEGORY_SOCIAL", () =>
  assert(has(routes, /CATEGORY_SOCIAL/), "CATEGORY_SOCIAL not counted"));

test("counts CATEGORY_FORUMS", () =>
  assert(has(routes, /CATEGORY_FORUMS/), "CATEGORY_FORUMS not counted"));

test("returns total and unread fields", () =>
  assert(has(routes, /updates_total/) && has(routes, /updates_unread/), "total/unread fields missing"));

test("excludes TRASH and SPAM from counts", () =>
  assert(has(routes, /TRASH.*SPAM|SPAM.*TRASH/), "trash/spam exclusion missing"));

// ── Move-to-primary API route ─────────────────────────────────────────────────
console.log("\n[Move-to-primary API route]");

test("POST /api/inbox/threads/:threadId/move-to-primary defined", () =>
  assert(has(routes, /app\.post\(["']\/api\/inbox\/threads\/:threadId\/move-to-primary["']/), "route not found"));

test("route is protected by requireAuth", () =>
  assert(has(routes, /move-to-primary["'],\s*requireAuth/), "requireAuth missing"));

test("adds INBOX label", () =>
  assert(has(routes, /addLabelIds.*\[.*"INBOX".*\]/), "addLabelIds INBOX not found"));

test("removes CATEGORY_UPDATES label", () =>
  assert(has(routes, /removeLabelIds.*CATEGORY_UPDATES/), "removeLabelIds CATEGORY_UPDATES not found"));

test("removes CATEGORY_PROMOTIONS label", () =>
  assert(has(routes, /removeLabelIds.*CATEGORY_PROMOTIONS/), "removeLabelIds CATEGORY_PROMOTIONS not found"));

test("calls mirrorLabelChangeForThreads", () =>
  assert(has(routes, /mirrorLabelChangeForThreads/), "mirrorLabelChangeForThreads not called"));

test("calls Gmail threads.modify", () =>
  assert(has(routes, /threads\.modify/), "threads.modify not called"));

// ── Frontend query hooks ──────────────────────────────────────────────────────
console.log("\n[Frontend query hooks]");

test("categoryQuery fetches with in:${tab} param", () =>
  assert(has(inbox, /in:\$\{tab\}/), "in:${tab} param not found"));

test("categoryQuery enabled only when isCategoryTab", () =>
  assert(has(inbox, /enabled:\s*isCategoryTab/), "enabled guard missing"));

test("categoryCountsQuery fetches /api/gmail/category-counts", () =>
  assert(has(inbox, /\/api\/gmail\/category-counts/), "category-counts URL not found"));

test("categoryCountsQuery polls every 60s", () =>
  assert(has(inbox, /60_000/), "60s poll not found"));

// ── Sidebar category items ────────────────────────────────────────────────────
console.log("\n[Sidebar category items]");

test("sidebar nav-tab-* testids use template literal with key", () =>
  assert(has(inbox, /nav-tab-\$\{key\}/), "nav-tab-${key} testid pattern missing"));

test("sidebar categories map iterates updates key", () =>
  assert(has(inbox, /"updates"/), "updates key missing from category map"));

test("sidebar categories map iterates promotions key", () =>
  assert(has(inbox, /"promotions"/), "promotions key missing from category map"));

test("sidebar categories map iterates social key", () =>
  assert(has(inbox, /"social"/), "social key missing from category map"));

test("sidebar categories map iterates forums key", () =>
  assert(has(inbox, /"forums"/), "forums key missing from category map"));

test("sidebar label 'Newsletters & Updates'", () =>
  assert(has(inbox, /Newsletters & Updates/), "label missing"));

test("sidebar label 'Promotions'", () =>
  assert(has(inbox, /Promotions/), "label missing"));

test("sidebar label 'Social'", () =>
  assert(has(inbox, /Social/), "label missing"));

test("sidebar label 'Forums & Communities'", () =>
  assert(has(inbox, /Forums & Communities/), "label missing"));

test("badge reads from categoryCountsQuery.data", () =>
  assert(has(inbox, /categoryCountsQuery\.data/), "badge data binding missing"));

test("badge capped at 99+", () =>
  assert(has(inbox, /99\+/), "99+ cap missing"));

// ── Message rendering ─────────────────────────────────────────────────────────
console.log("\n[Message list rendering]");

test("category-email-row-* testid present", () =>
  assert(has(inbox, /category-email-row-/), "row testid missing"));

test("button-open-category-thread-* testid present", () =>
  assert(has(inbox, /button-open-category-thread-/), "open-thread testid missing"));

test("button-move-to-primary-* testid present", () =>
  assert(has(inbox, /button-move-to-primary-/), "move-to-primary testid missing"));

test("move button calls moveToPrimaryMutation.mutate(msg.threadId)", () =>
  assert(has(inbox, /moveToPrimaryMutation\.mutate\(msg\.threadId\)/), "mutate call missing"));

test("isCategoryTab renders categoryQuery messages", () =>
  assert(has(inbox, /isCategoryTab/), "isCategoryTab render block missing"));

test("unread emails bolded", () =>
  assert(has(inbox, /isUnread.*font-semibold|font-semibold.*isUnread/), "unread bold missing"));

// ── Guards and smart inbox ────────────────────────────────────────────────────
console.log("\n[Guards & smart inbox]");

test("isSmartView excludes isCategoryTab", () =>
  assert(has(inbox, /!isCategoryTab/), "isSmartView category exclusion missing"));

test("isLoading uses categoryQuery.isLoading for category tabs", () =>
  assert(has(inbox, /isCategoryTab.*categoryQuery\.isLoading/), "isLoading category path missing"));

test("loading skeleton guard skips category (has own skeleton)", () =>
  assert(has(inbox, /!isCategoryTab && isLoading|!isCategoryTab.*isLoading/), "skeleton guard not updated"));

// ── moveToPrimaryMutation frontend ────────────────────────────────────────────
console.log("\n[moveToPrimaryMutation frontend]");

test("endpoint path is move-to-primary", () =>
  assert(has(inbox, /move-to-primary/), "endpoint missing"));

test("onSuccess removes thread from all category caches", () =>
  assert(has(inbox, /for.*CATEGORY_TABS|setQueryData.*category/), "cache invalidation missing"));

test("onSuccess invalidates inbox query", () =>
  assert(has(inbox, /invalidateQueries.*inbox/), "inbox invalidation missing"));

test("onSuccess invalidates category-counts", () =>
  assert(has(inbox, /invalidateQueries.*category-counts/), "counts invalidation missing"));

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(55)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log("─".repeat(55));

if (failed > 0) process.exit(1);
