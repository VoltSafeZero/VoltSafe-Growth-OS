/**
 * crm-filter-alignment.test.cjs
 * Source-grep test: verifies Leads and Accounts pages share the same 7-filter
 * order and both pull from shared crm-taxonomy.ts exports.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const leadsPath = path.join(root, "client/src/pages/leads.tsx");
const accountsPath = path.join(root, "client/src/pages/accounts.tsx");
const taxonomyPath = path.join(root, "client/src/lib/crm-taxonomy.ts");

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

const leadsSource = fs.readFileSync(leadsPath, "utf8");
const accountsSource = fs.readFileSync(accountsPath, "utf8");
const taxonomySource = fs.readFileSync(taxonomyPath, "utf8");

console.log("\n=== CRM Filter Alignment ===\n");

// ── Taxonomy exports ──────────────────────────────────────────────────────────
console.log("crm-taxonomy.ts exports:");
const requiredExports = [
  "FILTER_INDUSTRY_OPTIONS",
  "FILTER_SEGMENT_OPTIONS",
  "FILTER_TYPE_OPTIONS",
  "FILTER_COUNTRY_OPTIONS",
  "FILTER_PRIORITY_OPTIONS",
  "FILTER_SORT_OPTIONS",
  "getRegionsForCountry",
];
for (const exp of requiredExports) {
  assert(taxonomySource.includes(`export`) && taxonomySource.includes(exp), `exports ${exp}`);
}

// ── Both pages import shared constants ───────────────────────────────────────
console.log("\nleads.tsx imports:");
for (const exp of requiredExports) {
  assert(leadsSource.includes(exp), `imports/uses ${exp}`);
}

console.log("\naccounts.tsx imports:");
for (const exp of requiredExports) {
  assert(accountsSource.includes(exp), `imports/uses ${exp}`);
}

// ── No local COUNTRIES / getRegionsForCountry declarations in leads.tsx ───────
console.log("\nleads.tsx — no local duplicates:");
assert(
  !leadsSource.includes("const COUNTRIES ="),
  "no local COUNTRIES constant"
);
assert(
  !leadsSource.includes("function getRegionsForCountry"),
  "no local getRegionsForCountry function"
);
assert(
  !leadsSource.includes("const US_STATES"),
  "no local US_STATES constant"
);
assert(
  !leadsSource.includes("const CA_PROVINCES"),
  "no local CA_PROVINCES constant"
);

// ── Filter order: both pages have industry → segment → type → country → region → priority → sort ──
console.log("\nleads.tsx filter order:");
const leadsIndustryPos    = leadsSource.indexOf('data-testid="select-industry-filter"');
const leadsSegmentPos     = leadsSource.indexOf('data-testid="select-market-segment-filter"');
const leadsTypePos        = leadsSource.indexOf('data-testid="select-type-filter"');
const leadsCountryPos     = leadsSource.indexOf('data-testid="select-country-filter"');
const leadsRegionPos      = leadsSource.indexOf('data-testid="select-state-filter"');
const leadsPriorityPos    = leadsSource.indexOf('data-testid="select-priority-filter"');
const leadsSortPos        = leadsSource.indexOf('data-testid="select-sort"');

assert(leadsIndustryPos > 0,                               "has industry filter");
assert(leadsSegmentPos  > leadsIndustryPos,                "segment after industry");
assert(leadsTypePos     > leadsSegmentPos,                 "type after segment");
assert(leadsCountryPos  > leadsTypePos,                    "country after type");
assert(leadsRegionPos   > leadsCountryPos,                 "region after country");
assert(leadsPriorityPos > leadsRegionPos,                  "priority after region");
assert(leadsSortPos     > leadsPriorityPos,                "sort after priority");

console.log("\naccounts.tsx filter order:");
const acctIndustryPos    = accountsSource.indexOf('data-testid="select-industry-filter"');
const acctSegmentPos     = accountsSource.indexOf('data-testid="select-market-segment-filter"');
const acctTypePos        = accountsSource.indexOf('data-testid="select-type-filter"');
const acctCountryPos     = accountsSource.indexOf('data-testid="select-country-filter"');
const acctRegionPos      = accountsSource.indexOf('data-testid="select-state-filter"');
const acctPriorityPos    = accountsSource.indexOf('data-testid="select-priority-filter"');
const acctSortPos        = accountsSource.indexOf('data-testid="select-sort"');

assert(acctIndustryPos > 0,                              "has industry filter");
assert(acctSegmentPos  > acctIndustryPos,                "segment after industry");
assert(acctTypePos     > acctSegmentPos,                 "type after segment");
assert(acctCountryPos  > acctTypePos,                    "country after type");
assert(acctRegionPos   > acctCountryPos,                 "region after country");
assert(acctPriorityPos > acctRegionPos,                  "priority after region");
assert(acctSortPos     > acctPriorityPos,                "sort after priority");

// ── Old filter controls removed from accounts.tsx ────────────────────────────
console.log("\naccounts.tsx — old filters removed:");
assert(
  !accountsSource.includes('data-testid="select-segment-filter"'),
  "legacy segment filter removed"
);
assert(
  !accountsSource.includes('data-testid="select-status-filter"'),
  "stage/status filter removed from filter bar"
);
assert(
  !accountsSource.includes('data-testid="select-org-type-filter"'),
  "old org-type filter removed"
);

// ── State variables ───────────────────────────────────────────────────────────
console.log("\nleads.tsx state variables:");
assert(leadsSource.includes("typeFilter"),     "has typeFilter state");
assert(leadsSource.includes("priorityFilter"), "has priorityFilter state");
assert(leadsSource.includes("sortOption"),     "has sortOption state");

console.log("\naccounts.tsx state variables:");
assert(accountsSource.includes("industryFilter"), "has industryFilter state");
assert(accountsSource.includes("typeFilter"),     "has typeFilter state");
assert(accountsSource.includes("countryFilter"),  "has countryFilter state");
assert(accountsSource.includes("regionFilter"),   "has regionFilter state");
assert(!accountsSource.includes("segmentFilter"), "no legacy segmentFilter state");
assert(!accountsSource.includes("orgTypeFilter"), "no orgTypeFilter state");

console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
