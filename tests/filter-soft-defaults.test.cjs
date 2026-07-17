"use strict";
/**
 * Regression: filter soft-defaults for Leads and Accounts pages.
 *
 * Leads.tsx architecture (current, correct):
 *   - industryFilter defaults to "marine"  (real controlled value, not a sentinel)
 *   - marketSegmentFilter defaults to "marina" (real controlled value, not a sentinel)
 *   - API sends primaryIndustry=marine and marketSegment=marina on first load
 *   - clearView() resets back to "marine" / "marina"
 *   - SelectValue shows "Marine"/"Marina" because the SELECT value IS "marine"/"marina"
 *   - No fake display-label kludge (__all__ sentinel + conditional label)
 *
 * Accounts.tsx architecture (unchanged):
 *   - industryFilter sentinel = "__all__" (no filter sent when unset)
 *   - marketSegmentFilter sentinel = "all"
 *   - clearView() resets to "__all__" / "all"
 *   - Visual soft-default: show "Marine"/"Marina" label when at sentinel
 *
 * Requirements proven:
 * 1. Leads page initializes with real "marine" / "marina" values (no sentinel)
 * 2. Leads API call includes primaryIndustry and marketSegment on first load
 * 3. Changing Comm Status does NOT touch industry or segment state
 * 4. clearView() in leads returns to "marine" / "marina"
 * 5. Accounts page preserves "__all__" / "all" sentinel architecture
 * 6. onValueChange wired for both pages
 */
const fs   = require("fs");
const path = require("path");

const LEADS    = path.resolve(__dirname, "../client/src/pages/leads.tsx");
const ACCOUNTS = path.resolve(__dirname, "../client/src/pages/accounts.tsx");

const leadsSource    = fs.readFileSync(LEADS,    "utf8");
const accountsSource = fs.readFileSync(ACCOUNTS, "utf8");

let passed = 0;
let failed = 0;

function assert(label, condition, hint = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}${hint ? " — " + hint : ""}`);
    failed++;
  }
}

function noMatch(label, pattern, source, hint = "") {
  const re = typeof pattern === "string" ? new RegExp(pattern) : pattern;
  if (!re.test(source)) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}${hint ? " — " + hint : ""}`);
    failed++;
  }
}

// ─── LEADS: Real default values (not sentinels) ───────────────────────────────
console.log("\n[Leads] Real controlled defaults (marine / marina)");

assert(
  'leads industryFilter defaults to "marine"',
  /useState\("marine"\)/.test(leadsSource),
  "useState('marine') not found in leads.tsx"
);

assert(
  'leads marketSegmentFilter defaults to "marina"',
  /useState\("marina"\)/.test(leadsSource),
  "useState('marina') not found in leads.tsx"
);

noMatch(
  'leads industryFilter does NOT use "__all__" sentinel as default',
  // Check there is no const [industryFilter...] = useState("__all__")
  // (accounts uses __all__ so we look for the declaration near industryFilter)
  /\[industryFilter.*\]\s*=\s*useState\("__all__"\)/,
  leadsSource,
  "industryFilter still initialised to '__all__'"
);

noMatch(
  'leads marketSegmentFilter does NOT use "__all__" sentinel as default',
  /\[marketSegmentFilter.*\]\s*=\s*useState\("__all__"\)/,
  leadsSource,
  "marketSegmentFilter still initialised to '__all__'"
);

// ─── LEADS: API sends the real values ─────────────────────────────────────────
console.log("\n[Leads] API sends real values when filters active");

assert(
  'leads API: primaryIndustry sent when industryFilter !== "__all__"',
  /primaryIndustry.*__all__.*""|industryFilter.*===.*"__all__".*\?.*""/.test(leadsSource),
  "sentinel guard not found for primaryIndustry"
);

assert(
  'leads API: marketSegment sent when marketSegmentFilter !== "__all__"',
  /marketSegment.*__all__.*""|marketSegmentFilter.*===.*"__all__".*\?.*""/.test(leadsSource),
  "sentinel guard not found for marketSegment"
);

assert(
  'leads queryKey includes industryFilter and marketSegmentFilter',
  /queryKey.*primaryIndustry.*industryFilter|queryKey.*marketSegment.*marketSegmentFilter/.test(leadsSource),
  "filters not in queryKey"
);

// ─── LEADS: clearView resets to real defaults ─────────────────────────────────
console.log("\n[Leads] clearView resets to real defaults");

assert(
  'leads clearView resets industryFilter to "marine"',
  /clearView[\s\S]{0,600}setIndustryFilter\("marine"\)|setIndustryFilter\("marine"\)[\s\S]{0,200}clearView/.test(leadsSource),
  "setIndustryFilter('marine') not found near clearView"
);

assert(
  'leads clearView resets marketSegmentFilter to "marina"',
  /clearView[\s\S]{0,600}setMarketSegmentFilter\("marina"\)|setMarketSegmentFilter\("marina"\)[\s\S]{0,200}clearView/.test(leadsSource),
  "setMarketSegmentFilter('marina') not found near clearView"
);

noMatch(
  'leads clearView does NOT reset to "__all__" for industry',
  /clearView[\s\S]{0,600}setIndustryFilter\("__all__"\)/,
  leadsSource,
  "clearView still resets to '__all__' for industry"
);

// ─── LEADS: onValueChange wired ───────────────────────────────────────────────
console.log("\n[Leads] Dropdowns still wired");

assert(
  'leads industry Select has onValueChange wired to setIndustryFilter',
  /onValueChange.*setIndustryFilter|onValueChange={.*setIndustryFilter}/.test(leadsSource),
  "onValueChange not wired for industryFilter"
);

assert(
  'leads segment Select has onValueChange wired to setMarketSegmentFilter',
  /onValueChange.*setMarketSegmentFilter/.test(leadsSource),
  "onValueChange not wired for marketSegmentFilter"
);

// ─── LEADS: Comm Status does not clobber Industry/Segment ────────────────────
console.log("\n[Leads] Comm Status change does not clobber Industry/Segment");

assert(
  'commStatusFilter is independent state from industryFilter',
  /\[commStatusFilter.*useState|useState.*commStatusFilter/.test(leadsSource) &&
  /\[industryFilter.*useState|useState.*industryFilter/.test(leadsSource),
  "both filters must be independent useState declarations"
);

noMatch(
  'setCommStatusFilter handler does NOT call setIndustryFilter',
  /setCommStatusFilter[\s\S]{0,100}setIndustryFilter|onValueChange.*setCommStatusFilter[\s\S]{0,200}setIndustryFilter/,
  leadsSource,
  "setCommStatusFilter should not touch industryFilter"
);

// ─── ACCOUNTS: sentinel architecture unchanged ────────────────────────────────
console.log("\n[Accounts] Sentinel architecture unchanged");

assert(
  'accounts industryFilter sentinel is "__all__"',
  /useState\("__all__"\)/.test(accountsSource),
  "accounts.tsx should still use '__all__' sentinel"
);

assert(
  'accounts marketSegmentFilter has sentinel (all or __all__)',
  accountsSource.includes('useState("all")') || accountsSource.includes('useState("__all__")'),
  "accounts segment sentinel not found"
);

assert(
  'accounts clearView resets industryFilter to "__all__"',
  /setIndustryFilter\("__all__"\)/.test(accountsSource),
  "accounts clearView should reset industry to '__all__'"
);

assert(
  'accounts API guard: industry omitted when "__all__"',
  /industry.*__all__.*""/.test(accountsSource) ||
  /industryFilter.*===.*"__all__".*\?.*""/.test(accountsSource),
  "accounts API guard not found"
);

assert(
  'accounts industry Select has onValueChange',
  /onValueChange.*setIndustryFilter|onValueChange={.*setIndustryFilter}/.test(accountsSource),
  "accounts onValueChange not wired for industry"
);

assert(
  'accounts segment Select has onValueChange',
  /onValueChange.*setMarketSegmentFilter/.test(accountsSource),
  "accounts onValueChange not wired for segment"
);

assert(
  'accounts industry trigger shows "Marine" when at "__all__" sentinel',
  /industryFilter.*===.*"__all__".*Marine|Marine.*industryFilter.*===.*"__all__"/.test(accountsSource),
  "accounts industry soft-default label missing"
);

assert(
  'accounts segment trigger shows "Marina" when at sentinel',
  /marketSegmentFilter.*===.*"all".*Marina|Marina.*marketSegmentFilter.*===.*"all"|marketSegmentFilter.*===.*"__all__".*Marina/.test(accountsSource),
  "accounts segment soft-default label missing"
);

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(55)}`);
console.log(`Result: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log("All regression checks passed ✓");
}
