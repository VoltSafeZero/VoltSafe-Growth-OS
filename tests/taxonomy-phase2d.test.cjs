/**
 * Phase 2D — API/forms/filters for taxonomy fields
 * Source-grep regression tests to pin all plumbing for
 * marketSegment + slipRange + slipCountInt across storage,
 * routes, leads page, and accounts page.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. server/storage.ts
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n[1] server/storage.ts — interface + implementation");
{
  const src = read("server/storage.ts");

  assert(
    "getLeads interface has marketSegment?: string",
    /getLeads\(options\?:.*marketSegment\?:\s*string/.test(src)
  );
  assert(
    "getAccounts interface has marketSegment?: string",
    /getAccounts\(options\?:.*marketSegment\?:\s*string/.test(src)
  );
  assert(
    "getLeads impl signature has marketSegment?: string",
    /async getLeads\(options\?:.*marketSegment\?:\s*string/.test(src)
  );
  assert(
    "getAccounts impl signature has marketSegment?: string",
    /async getAccounts\(options\?:.*marketSegment\?:\s*string/.test(src)
  );
  assert(
    "getLeads impl filters on leads.marketSegment",
    /eq\(leads\.marketSegment,\s*options(?:\?\.|\.)marketSegment\)/.test(src)
  );
  assert(
    "getAccounts impl filters on accounts.marketSegment",
    /eq\(accounts\.marketSegment,\s*options(?:\?\.|\.)marketSegment\)/.test(src)
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 2. server/routes.ts
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n[2] server/routes.ts — GET /api/leads, GET /api/accounts, conversion");
{
  const src = read("server/routes.ts");

  assert(
    "GET /api/leads destructures marketSegment from req.query",
    /const\s*\{[^}]*marketSegment[^}]*\}\s*=\s*req\.query/.test(src)
  );
  assert(
    "GET /api/leads passes marketSegment to storage.getLeads",
    /storage\.getLeads\([^)]*marketSegment[^)]*\)/.test(src) ||
      /marketSegment:\s*marketSegment/.test(src)
  );
  assert(
    "GET /api/accounts destructures marketSegment from req.query",
    /const\s*\{[^}]*marketSegment[^}]*\}\s*=\s*req\.query/.test(src)
  );
  assert(
    "GET /api/accounts passes marketSegment to storage.getAccounts",
    /storage\.getAccounts\([^)]*marketSegment[^)]*\)/.test(src) ||
      /marketSegment:\s*marketSegment/.test(src)
  );
  assert(
    "Conversion payload preserves marketSegment from lead",
    /Phase 2D.*preserve taxonomy|lead.*marketSegment|marketSegment.*lead\.marketSegment/.test(src)
  );
  assert(
    "Conversion payload preserves slipRange from lead",
    /slipRange.*lead.*slipRange|lead.*slipRange/.test(src)
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 3. client/src/pages/leads.tsx
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n[3] client/src/pages/leads.tsx — state, query, forms, filter UI");
{
  const src = read("client/src/pages/leads.tsx");

  assert(
    "imports MARKET_SEGMENT_OPTIONS from crm-taxonomy",
    /MARKET_SEGMENT_OPTIONS/.test(src)
  );
  assert(
    "imports SLIP_RANGE_OPTIONS from crm-taxonomy",
    /SLIP_RANGE_OPTIONS/.test(src)
  );
  assert(
    "marketSegmentFilter state declared",
    /marketSegmentFilter,\s*setMarketSegmentFilter/.test(src)
  );
  assert(
    "queryKey includes marketSegment",
    /queryKey.*marketSegment/.test(src)
  );
  assert(
    "queryFn sets marketSegment param",
    /params\.set\("marketSegment",\s*marketSegmentFilter\)/.test(src)
  );
  assert(
    "currentFiltersJson includes marketSegment",
    /currentFiltersJson.*marketSegment/.test(src)
  );
  assert(
    "applyView restores marketSegment",
    /f\.marketSegment.*setMarketSegmentFilter/.test(src)
  );
  assert(
    "clearView resets marketSegmentFilter",
    /clearView.*setMarketSegmentFilter|setMarketSegmentFilter.*clearView/.test(src) ||
      /clearView[^}]*setMarketSegmentFilter/.test(src)
  );
  assert(
    "filter UI has select-market-segment-filter testid",
    /data-testid="select-market-segment-filter"/.test(src)
  );
  assert(
    "EditLeadForm state has marketSegment",
    /marketSegment:.*lead.*marketSegment/.test(src)
  );
  assert(
    "EditLeadForm state has slipRange",
    /slipRange:.*lead.*slipRange/.test(src)
  );
  assert(
    "EditLeadForm state has slipCountInt",
    /slipCountInt:.*lead.*slipCountInt/.test(src)
  );
  assert(
    "EditLeadForm submit passes marketSegment",
    /marketSegment:\s*form\.marketSegment/.test(src)
  );
  assert(
    "EditLeadForm submit passes slipRange",
    /slipRange:\s*form\.slipRange/.test(src)
  );
  assert(
    "EditLeadForm submit converts slipCountInt to number",
    /slipCountInt:.*Number\(form\.slipCountInt\)/.test(src)
  );
  assert(
    "EditLeadForm UI has select-edit-market-segment testid",
    /data-testid="select-edit-market-segment"/.test(src)
  );
  assert(
    "EditLeadForm UI has select-edit-slip-range testid",
    /data-testid="select-edit-slip-range"/.test(src)
  );
  assert(
    "EditLeadForm UI has input-edit-slip-count-int testid",
    /data-testid="input-edit-slip-count-int"/.test(src)
  );
  assert(
    "CreateLeadForm state has marketSegment",
    /marketSegment:\s*""/.test(src)
  );
  assert(
    "CreateLeadForm state has slipRange",
    /slipRange:\s*""/.test(src)
  );
  assert(
    "CreateLeadForm UI has select-market-segment testid",
    /data-testid="select-market-segment"/.test(src)
  );
  assert(
    "CreateLeadForm UI has select-slip-range testid",
    /data-testid="select-slip-range"/.test(src)
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 4. client/src/pages/accounts.tsx
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n[4] client/src/pages/accounts.tsx — state, query, forms, filter UI");
{
  const src = read("client/src/pages/accounts.tsx");

  assert(
    "imports MARKET_SEGMENT_OPTIONS from crm-taxonomy",
    /MARKET_SEGMENT_OPTIONS/.test(src)
  );
  assert(
    "imports SLIP_RANGE_OPTIONS from crm-taxonomy",
    /SLIP_RANGE_OPTIONS/.test(src)
  );
  assert(
    "marketSegmentFilter state declared",
    /marketSegmentFilter,\s*setMarketSegmentFilter/.test(src)
  );
  assert(
    "queryKey includes marketSegment",
    /queryKey.*marketSegment/.test(src)
  );
  assert(
    "queryFn sets marketSegment param",
    /params\.set\("marketSegment",\s*marketSegmentFilter\)/.test(src)
  );
  assert(
    "currentFiltersJson includes marketSegment",
    /marketSegment:\s*marketSegmentFilter/.test(src)
  );
  assert(
    "loadSavedView restores marketSegment",
    /setMarketSegmentFilter\(f\.marketSegment/.test(src)
  );
  assert(
    "resetFilters resets marketSegmentFilter",
    /setMarketSegmentFilter\("all"\)/.test(src)
  );
  assert(
    "isFiltered checks marketSegmentFilter",
    /isFiltered.*marketSegmentFilter|marketSegmentFilter.*!==.*"all".*isFiltered/.test(src) ||
      /marketSegmentFilter !== "all"/.test(src)
  );
  assert(
    "mobile filter count includes marketSegmentFilter",
    /\[.*marketSegmentFilter.*\]\.filter\(v => v !== "all"\)/.test(src)
  );
  assert(
    "filter UI has select-market-segment-filter testid",
    /data-testid="select-market-segment-filter"/.test(src)
  );
  assert(
    "EditAccountForm state has marketSegment",
    /marketSegment:.*account.*marketSegment/.test(src)
  );
  assert(
    "EditAccountForm state has slipRange",
    /slipRange:.*account.*slipRange/.test(src)
  );
  assert(
    "EditAccountForm UI has select-edit-market-segment testid",
    /data-testid="select-edit-market-segment"/.test(src)
  );
  assert(
    "EditAccountForm UI has select-edit-slip-range testid",
    /data-testid="select-edit-slip-range"/.test(src)
  );
  assert(
    "CreateAccountForm state has marketSegment",
    /marketSegment:\s*""/.test(src)
  );
  assert(
    "CreateAccountForm state has slipRange",
    /slipRange:\s*""/.test(src)
  );
  assert(
    "CreateAccountForm UI has select-account-market-segment testid",
    /data-testid="select-account-market-segment"/.test(src)
  );
  assert(
    "CreateAccountForm UI has select-account-slip-range testid",
    /data-testid="select-account-slip-range"/.test(src)
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Phase 2D: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
