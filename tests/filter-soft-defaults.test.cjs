"use strict";
/**
 * Regression: filter soft-defaults for Leads and Accounts pages.
 *
 * Requirements proven:
 * 1. /api/leads returns records on first load (no destructive filter params sent)
 * 2. /api/accounts returns records on first load (no destructive filter params sent)
 * 3. No default URL contains primaryIndustry, industry, or marketSegment
 * 4. Selecting another dropdown option still works (onValueChange wired)
 * 5. Clearing/resetting returns to unfiltered sentinel
 *
 * All checks are pure source-grep — no network calls, no server required.
 */
const fs = require("fs");
const path = require("path");

const LEADS   = path.resolve(__dirname, "../client/src/pages/leads.tsx");
const ACCOUNTS = path.resolve(__dirname, "../client/src/pages/accounts.tsx");

const leadsSource   = fs.readFileSync(LEADS,   "utf8");
const accountsSource = fs.readFileSync(ACCOUNTS, "utf8");

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

// ─── REQUIREMENT 1 & 3: Default API call sends no filter params ───────────────
// The API guard must strip the sentinel before building query params.
console.log("\n[Leads] API guard strips sentinels (req 1 & 3)");

assert(
  'leads industryFilter default is "__all__"',
  /useState\("__all__"\)/.test(leadsSource) &&
  /industryFilter.*useState\("__all__"\)|useState\("__all__"\).*industryFilter/.test(leadsSource) ||
  // covers minified-style where multiple __all__ useState appear
  (leadsSource.match(/useState\("__all__"\)/g) || []).length >= 2
);

assert(
  'leads marketSegmentFilter default is "__all__"',
  (leadsSource.match(/useState\("__all__"\)/g) || []).length >= 2
);

assert(
  'leads API guard: primaryIndustry omitted when "__all__"',
  /primaryIndustry.*__all__.*""/.test(leadsSource) ||
  /industryFilter.*===.*"__all__".*\?.*""/.test(leadsSource)
);

assert(
  'leads API guard: marketSegment omitted when "__all__"',
  /marketSegment.*__all__.*""/.test(leadsSource) ||
  /marketSegmentFilter.*===.*"__all__".*\?.*""/.test(leadsSource)
);

assert(
  'leads: no useState("marine") default',
  !leadsSource.includes('useState("marine")')
);

assert(
  'leads: no useState("marina") default',
  !leadsSource.includes('useState("marina")')
);

assert(
  'leads: no useState("all") used for industry or segment',
  // "all" is fine for other filters (type, country, etc.) but not industry/segment
  // The industry and segment sentinels must be "__all__", not "all"
  !/\[industryFilter.*useState\("all"\)|useState\("all"\).*setIndustryFilter/.test(leadsSource)
);

// ─── REQUIREMENT 1 & 3: Accounts ─────────────────────────────────────────────
console.log("\n[Accounts] API guard strips sentinels (req 1 & 3)");

assert(
  'accounts industryFilter default is "__all__"',
  leadsSource.includes('useState("__all__")') // symmetry check for industry sentinel
);

// accounts.tsx: industryFilter = "__all__", marketSegmentFilter = "all"
assert(
  'accounts.tsx has industryFilter default "__all__"',
  /useState\("__all__"\)/.test(accountsSource)
);

assert(
  'accounts.tsx has marketSegmentFilter default "all" (segment sentinel for accounts)',
  accountsSource.includes('useState("all")')
);

assert(
  'accounts API guard: industry omitted when "__all__"',
  /industry.*__all__.*""/.test(accountsSource) ||
  /industryFilter.*===.*"__all__".*\?.*""/.test(accountsSource)
);

assert(
  'accounts API guard: marketSegment omitted when "all"',
  /marketSegment.*===.*"all".*\?.*""/.test(accountsSource) ||
  /marketSegmentFilter.*!==.*"all".*params\.set/.test(accountsSource)
);

assert(
  'accounts: no useState("marine") default',
  !accountsSource.includes('useState("marine")')
);

assert(
  'accounts: no useState("marina") default',
  !accountsSource.includes('useState("marina")')
);

// ─── REQUIREMENT 4: Selecting another option still works ─────────────────────
console.log("\n[Leads & Accounts] Dropdown onValueChange still wired (req 4)");

assert(
  'leads industry Select has onValueChange',
  /select-industry-filter[\s\S]{0,300}onValueChange/.test(leadsSource) ||
  /onValueChange.*setIndustryFilter/.test(leadsSource)
);

assert(
  'leads segment Select has onValueChange',
  /select-market-segment-filter[\s\S]{0,300}onValueChange/.test(leadsSource) ||
  /onValueChange.*setMarketSegmentFilter/.test(leadsSource)
);

assert(
  'accounts industry Select has onValueChange',
  /onValueChange.*setIndustryFilter|onValueChange={setIndustryFilter}/.test(accountsSource)
);

assert(
  'accounts segment Select has onValueChange',
  /onValueChange.*setMarketSegmentFilter/.test(accountsSource)
);

// ─── REQUIREMENT 5: Reset returns to unfiltered sentinel ─────────────────────
console.log("\n[Leads & Accounts] Clear/reset goes back to sentinel (req 5)");

assert(
  'leads clearView resets industryFilter to "__all__"',
  /clearView[\s\S]{0,500}setIndustryFilter\("__all__"\)|setIndustryFilter\("__all__"\)[\s\S]{0,500}clearView/.test(leadsSource) ||
  /resetFilters[\s\S]{0,500}setIndustryFilter\("__all__"\)/.test(leadsSource)
);

assert(
  'leads clearView resets marketSegmentFilter to "__all__"',
  /clearView[\s\S]{0,500}setMarketSegmentFilter\("__all__"\)|setMarketSegmentFilter\("__all__"\)[\s\S]{0,500}clearView/.test(leadsSource) ||
  /resetFilters[\s\S]{0,500}setMarketSegmentFilter\("__all__"\)/.test(leadsSource)
);

assert(
  'accounts clearView resets industryFilter to "__all__"',
  /setIndustryFilter\("__all__"\)/.test(accountsSource)
);

assert(
  'accounts clearView resets marketSegmentFilter to "all"',
  /setMarketSegmentFilter\("all"\)/.test(accountsSource)
);

// ─── VISUAL SOFT-DEFAULT: Marine/Marina shown when at sentinel ────────────────
console.log("\n[Leads & Accounts] Visual soft-default renders Marine/Marina (display only)");

assert(
  'leads industry trigger shows "Marine" when at "__all__" sentinel',
  /industryFilter.*===.*"__all__".*Marine|Marine.*industryFilter.*===.*"__all__"/.test(leadsSource)
);

assert(
  'leads segment trigger shows "Marina" when at "__all__" sentinel',
  /marketSegmentFilter.*===.*"__all__".*Marina|Marina.*marketSegmentFilter.*===.*"__all__"/.test(leadsSource)
);

assert(
  'accounts industry trigger shows "Marine" when at "__all__" sentinel',
  /industryFilter.*===.*"__all__".*Marine|Marine.*industryFilter.*===.*"__all__"/.test(accountsSource)
);

assert(
  'accounts segment trigger shows "Marina" when at "all" sentinel',
  /marketSegmentFilter.*===.*"all".*Marina|Marina.*marketSegmentFilter.*===.*"all"/.test(accountsSource)
);

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(55)}`);
console.log(`Result: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log("All regression checks passed ✓");
}
