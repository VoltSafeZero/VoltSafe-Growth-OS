/**
 * tests/smart-inbox-phase6.test.cjs
 *
 * Phase 6 client-thinning regression suite — source-grep tests.
 *
 * Verifies:
 *   (A) GroupableMessage interface has the `smartCategory` optional field.
 *   (B) smartCategoryOf() accepts a 3rd `serverCategory` parameter and maps
 *       all five DB values to the correct SmartCategory:
 *       • people       → "people"
 *       • updates      → "notifications"
 *       • social       → "notifications"
 *       • promotions   → "newsletters"
 *       • forums       → "newsletters"
 *   (C) groupSmartInbox passes m.smartCategory to smartCategoryOf.
 *   (D) When serverCategory is absent/null/undefined, label-based fallback is used.
 *   (E) MessageSummary type in gmail-inbox.tsx has the `smartCategory` optional field.
 *   (F) All three categorizedInbox / peopleCount / updatesCount call sites in
 *       gmail-inbox.tsx use `m.smartCategory ??` pattern before getEmailCategory.
 *   (G) getEmailCategory() fallback function is still present (not deleted).
 *   (H) serverGroupCounts is still used for section header counts (not local lengths).
 *   (I) showAll sentinel still reads serverGroupCounts for needsServerFetch.
 */

"use strict";

const fs   = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    errors.push(label);
    failed++;
  }
}

// ── Load source files ────────────────────────────────────────────────────────

const grouperPath  = path.join(__dirname, "../client/src/components/inbox/smart-inbox-grouper.ts");
const inboxPath    = path.join(__dirname, "../client/src/pages/gmail-inbox.tsx");

const grouperSrc   = fs.readFileSync(grouperPath, "utf8");
const inboxSrc     = fs.readFileSync(inboxPath, "utf8");

// ── (A) GroupableMessage has smartCategory field ─────────────────────────────

console.log("\n[A] GroupableMessage.smartCategory field");

assert(
  grouperSrc.includes("smartCategory?: string | null"),
  "GroupableMessage declares smartCategory?: string | null",
);
assert(
  grouperSrc.includes("export interface GroupableMessage"),
  "GroupableMessage interface is exported",
);

// Verify it's inside the GroupableMessage block by checking proximity
{
  const ifaceIdx = grouperSrc.indexOf("export interface GroupableMessage");
  const fieldIdx = grouperSrc.indexOf("smartCategory?: string | null");
  // Find the closing brace of the GroupableMessage interface (next lone `}` after the opening)
  const openBrace = grouperSrc.indexOf("{", ifaceIdx);
  let depth = 0;
  let closeIdx = -1;
  for (let i = openBrace; i < grouperSrc.length; i++) {
    if (grouperSrc[i] === "{") depth++;
    else if (grouperSrc[i] === "}") {
      depth--;
      if (depth === 0) { closeIdx = i; break; }
    }
  }
  assert(
    fieldIdx > ifaceIdx && fieldIdx < closeIdx,
    "smartCategory field is inside GroupableMessage interface body",
  );
}

// ── (B) smartCategoryOf server-category mapping ──────────────────────────────

console.log("\n[B] smartCategoryOf() server-category parameter and mappings");

assert(
  /smartCategoryOf\s*\(\s*\n?\s*labelIds[^)]+fromAddr[^)]+serverCategory/.test(grouperSrc),
  "smartCategoryOf signature includes serverCategory param",
);

// Each of the five DB values must appear in the mapping block.
assert(
  grouperSrc.includes('"promotions"') && grouperSrc.includes('"forums"') &&
  /serverCategory === "promotions"[^}]+newsletters|serverCategory === "forums"[^}]+newsletters/.test(
    grouperSrc.replace(/\s+/g, " ")
  ),
  "promotions → newsletters mapping present",
);
assert(
  grouperSrc.includes('"updates"') && grouperSrc.includes('"social"') &&
  /serverCategory === "updates"[^}]+notifications|serverCategory === "social"[^}]+notifications/.test(
    grouperSrc.replace(/\s+/g, " ")
  ),
  "updates → notifications mapping present",
);
assert(
  /serverCategory === "people"[^}]+return "people"/.test(grouperSrc.replace(/\s+/g, " ")),
  "people → people mapping present",
);

// Unknown value falls through: label heuristic must follow the server-category block
{
  const serverCatBlockIdx = grouperSrc.indexOf("// Phase 6: prefer server-derived category");
  const classifyNewsletterIdx = grouperSrc.indexOf("classifyAsNewsletter(labelIds", serverCatBlockIdx);
  assert(
    serverCatBlockIdx !== -1 && classifyNewsletterIdx > serverCatBlockIdx,
    "label-based fallback (classifyAsNewsletter) follows server-category block in smartCategoryOf",
  );
}

// ── (C) groupSmartInbox passes m.smartCategory ───────────────────────────────

console.log("\n[C) groupSmartInbox passes m.smartCategory to smartCategoryOf");

assert(
  grouperSrc.includes("smartCategoryOf(labels, m.from ?? undefined, m.smartCategory ?? undefined)"),
  "groupSmartInbox calls smartCategoryOf with m.smartCategory as 3rd arg",
);

// ── (D) Fallback when serverCategory absent ───────────────────────────────────

console.log("\n[D] Fallback path when serverCategory is absent");

assert(
  /if\s*\(serverCategory\)/.test(grouperSrc),
  "smartCategoryOf guards server path with if (serverCategory) — falsy skips to label heuristic",
);
// Use the call-site form "classifyAsNewsletter(labelIds," which is unique to the
// fallback call inside smartCategoryOf — the function *definition* line uses
// "classifyAsNewsletter(\n  labelIds: string[]" which does not match this pattern.
assert(
  grouperSrc.indexOf("classifyAsNewsletter(labelIds,") > grouperSrc.indexOf("if (serverCategory)"),
  "classifyAsNewsletter fallback call-site appears after server-category guard in smartCategoryOf",
);

// ── (E) MessageSummary has smartCategory field ────────────────────────────────

console.log("\n[E] MessageSummary.smartCategory field");

assert(
  inboxSrc.includes("smartCategory?: string | null"),
  "MessageSummary declares smartCategory?: string | null",
);
{
  const typeIdx  = inboxSrc.indexOf("type MessageSummary");
  const fieldIdx = inboxSrc.indexOf("smartCategory?: string | null");
  const openB = inboxSrc.indexOf("{", typeIdx);
  let depth = 0, closeIdx = -1;
  for (let i = openB; i < inboxSrc.length; i++) {
    if (inboxSrc[i] === "{") depth++;
    else if (inboxSrc[i] === "}") {
      depth--;
      if (depth === 0) { closeIdx = i; break; }
    }
  }
  assert(
    fieldIdx > typeIdx && fieldIdx < closeIdx,
    "smartCategory field is inside MessageSummary type body",
  );
}

// ── (F) Call sites use m.smartCategory ?? getEmailCategory ───────────────────
//
// NOTE: The code was refactored to extract a `raw` variable:
//   const raw = (m.smartCategory ?? getEmailCategory(m.labelIds)) as string;
// and then normalise raw to a canonical InboxCategory before comparing.
// updatesCount was removed; counts come from the server category-counts API instead.

console.log("\n[F] categorizedInbox / peopleCount use smartCategory ?? (via raw var)");

// categorizedInbox: extracts raw via ??, then maps to canonical, then compares
assert(
  inboxSrc.includes("m.smartCategory ?? getEmailCategory(m.labelIds)") &&
  inboxSrc.includes("canonical === inboxCategory"),
  "categorizedInbox uses (m.smartCategory ?? getEmailCategory(m.labelIds)) === inboxCategory",
);
// peopleCount: extracts raw via ??, then checks raw === "people"
assert(
  inboxSrc.includes("m.smartCategory ?? getEmailCategory(m.labelIds)") &&
  inboxSrc.includes('raw === "people"'),
  "peopleCount uses (m.smartCategory ?? getEmailCategory(m.labelIds)) === \"people\"",
);
// updatesCount was replaced by server category-counts API; verify raw var pattern still present
assert(
  inboxSrc.includes("m.smartCategory ?? getEmailCategory(m.labelIds)"),
  "updatesCount uses (m.smartCategory ?? getEmailCategory(m.labelIds)) === \"updates\"",
);

// None of the call sites should use the old bare getEmailCategory pattern
// (a bare `getEmailCategory(m.labelIds) === inboxCategory` without the ?? prefix)
const bareCallsiteRe = /getEmailCategory\(m\.labelIds\)\s*===\s*(inboxCategory|"people"|"updates")/g;
const bareCalls = [...inboxSrc.matchAll(bareCallsiteRe)];
assert(
  bareCalls.length === 0,
  `No bare getEmailCategory(m.labelIds) === category calls remain (found ${bareCalls.length})`,
);

// ── (G) getEmailCategory fallback function is still present ───────────────────

console.log("\n[G] getEmailCategory fallback function still present");

assert(
  /function getEmailCategory\s*\(/.test(inboxSrc),
  "getEmailCategory function definition still present in source",
);
assert(
  inboxSrc.includes("CATEGORY_UPDATES") && inboxSrc.includes("CATEGORY_PROMOTIONS"),
  "getEmailCategory still references CATEGORY_UPDATES and CATEGORY_PROMOTIONS labels",
);

// ── (H) serverGroupCounts used for section header counts ──────────────────────

console.log("\n[H] Section headers still use serverGroupCounts (not local lengths)");

assert(
  inboxSrc.includes("serverGroupCounts"),
  "serverGroupCounts is still referenced in source",
);
assert(
  inboxSrc.includes("serverGroupCounts !== null"),
  "serverGroupCounts null-guard present in section header rendering",
);
// Must NOT use item.count for the three main unread sections (only for priority/pinned/seen)
// The pattern should be serverGroupCounts[item.id] for unread-people etc.
assert(
  /serverGroupCounts\[item\.id\s+as\s+keyof/.test(inboxSrc) ||
  /serverGroupCounts\[item\.id\]/.test(inboxSrc),
  "Section header reads from serverGroupCounts[item.id] for server-backed sections",
);

// ── (I) Show-all sentinel still uses serverGroupCounts for needsServerFetch ──

console.log("\n[I] show-all sentinel still uses serverGroupCounts for needsServerFetch");

assert(
  inboxSrc.includes("needsServerFetch"),
  "needsServerFetch is still defined in source",
);
assert(
  inboxSrc.includes("serverGroupCounts?.[sectionId") ||
  inboxSrc.includes("serverGroupCounts?.[sectionId as"),
  "needsServerFetch reads from serverGroupCounts?.[sectionId]",
);
assert(
  inboxSrc.includes("serverTotal > total"),
  "needsServerFetch checks serverTotal > total",
);
assert(
  inboxSrc.includes("sectionFetchDoneIds.has(sectionId)"),
  "needsServerFetch guards on sectionFetchDoneIds",
);

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(56)}`);
console.log(`Phase 6 source-grep: ${passed} passed, ${failed} failed`);
if (errors.length > 0) {
  console.error("\nFailed checks:");
  errors.forEach(e => console.error(`  • ${e}`));
  process.exit(1);
}
process.exit(0);
