"use strict";
/**
 * comms-filter-defaults.test.cjs
 *
 * Verifies the correct default filter state for Industry (marine) and
 * Segment Type (marina) on the Leads page, and that changing Comms or any
 * other filter does not erase unrelated filter state.
 */

const fs = require("fs");

let passed = 0;
let failed = 0;
const failures = [];

function ok(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
    failures.push(label);
  }
}

const leadsPage = fs.readFileSync("client/src/pages/leads.tsx", "utf8");

// ── 1. Initial state defaults ────────────────────────────────────────────────
console.log("\n[1] Default filter state initialization");

ok("industryFilter initializes to 'marine' (not '__all__' or '')",
  /useState\(["']marine["']\)/.test(
    leadsPage.slice(leadsPage.indexOf("[industryFilter"), leadsPage.indexOf("[industryFilter") + 80)
  ));

ok("marketSegmentFilter initializes to 'marina' (not '__all__' or '')",
  /useState\(["']marina["']\)/.test(
    leadsPage.slice(leadsPage.indexOf("[marketSegmentFilter"), leadsPage.indexOf("[marketSegmentFilter") + 80)
  ));

ok("No fake span-label hack for Industry (span>Marine removed)",
  !leadsPage.includes("<span>Marine</span>") || !leadsPage.includes("industryFilter === \"__all__\""));

ok("No fake span-label hack for Segment (span>Marina removed)",
  !leadsPage.includes("<span>Marina</span>") || !leadsPage.includes("marketSegmentFilter === \"__all__\""));

// ── 2. Controlled Select uses real value ─────────────────────────────────────
console.log("\n[2] Controlled Select values");

ok("Industry Select value={industryFilter} — fully controlled",
  /Select value=\{industryFilter\}/.test(leadsPage));

ok("Segment Select value={marketSegmentFilter} — fully controlled",
  /Select value=\{marketSegmentFilter\}/.test(leadsPage));

ok("Industry SelectTrigger uses <SelectValue /> not conditional span",
  (() => {
    const industryBlock = leadsPage.slice(
      leadsPage.indexOf('data-testid="select-industry-filter"'),
      leadsPage.indexOf('data-testid="select-industry-filter"') + 200
    );
    return industryBlock.includes("<SelectValue />") && !industryBlock.includes("<span>Marine");
  })());

ok("Segment SelectTrigger uses <SelectValue /> not conditional span",
  (() => {
    const segBlock = leadsPage.slice(
      leadsPage.indexOf('data-testid="select-market-segment-filter"'),
      leadsPage.indexOf('data-testid="select-market-segment-filter"') + 200
    );
    return segBlock.includes("<SelectValue />") && !segBlock.includes("<span>Marina");
  })());

// ── 3. All-option uses canonical sentinel ────────────────────────────────────
console.log("\n[3] All-option sentinel values");

ok("All Industries option has value='__all__'",
  leadsPage.includes('value="__all__">All Industries'));

ok("All Segments option has value='__all__'",
  leadsPage.includes('value="__all__">All Segments'));

// ── 4. Reset / clearView returns to marine + marina ──────────────────────────
console.log("\n[4] clearView resets to marine + marina (not __all__)");

const clearViewLine = leadsPage.split("\n").find(l => l.includes("const clearView"));
ok("clearView resets industryFilter to 'marine'",
  clearViewLine ? clearViewLine.includes('setIndustryFilter("marine")') : false);

ok("clearView resets marketSegmentFilter to 'marina'",
  clearViewLine ? clearViewLine.includes('setMarketSegmentFilter("marina")') : false);

ok("clearView does NOT reset industryFilter to '__all__'",
  clearViewLine ? !clearViewLine.includes('setIndustryFilter("__all__")') : true);

ok("clearView does NOT reset marketSegmentFilter to '__all__'",
  clearViewLine ? !clearViewLine.includes('setMarketSegmentFilter("__all__")') : true);

// ── 5. API query key includes filters ────────────────────────────────────────
console.log("\n[5] API query key includes industry/segment filters");

ok("Query key maps industryFilter to primaryIndustry param",
  /primaryIndustry:\s*industryFilter.*===.*"__all__".*\?.*"".*:.*industryFilter/.test(leadsPage) ||
  /primaryIndustry:\s*industryFilter === "__all__" \? "" : industryFilter/.test(leadsPage));

ok("Query key maps marketSegmentFilter to marketSegment param",
  /marketSegment:\s*marketSegmentFilter.*===.*"__all__".*\?.*"".*:.*marketSegmentFilter/.test(leadsPage) ||
  /marketSegment:\s*marketSegmentFilter === "__all__" \? "" : marketSegmentFilter/.test(leadsPage));

// ── 6. Comms onValueChange uses safe spread pattern ──────────────────────────
console.log("\n[6] Comms filter change preserves other filter state");

ok("commStatusFilter has its own independent useState",
  /\[commStatusFilter,\s*setCommStatusFilter\]\s*=\s*useState/.test(leadsPage));

ok("Comms Select onValueChange only calls setCommStatusFilter (not setIndustryFilter)",
  (() => {
    const commBlock = leadsPage.slice(
      leadsPage.indexOf('data-testid="select-comm-status"') > 0
        ? leadsPage.indexOf('data-testid="select-comm-status"')
        : leadsPage.indexOf("commStatusFilter"),
      leadsPage.indexOf("commStatusFilter") + 600
    );
    return commBlock.includes("setCommStatusFilter") && !commBlock.includes("setIndustryFilter");
  })());

ok("No setFilters({...}) object replacement pattern (each filter has own setState)",
  !leadsPage.includes("setFilters({") && !leadsPage.includes("setFilters( {"));

// ── 7. All filter setters are independent (no accidental state clobbering) ───
console.log("\n[7] Each filter uses independent setState — no clobbering");

ok("setIndustryFilter is a dedicated setter (not a merged-object setter)",
  (leadsPage.match(/setIndustryFilter\(/g) || []).length >= 2);

ok("setMarketSegmentFilter is a dedicated setter",
  (leadsPage.match(/setMarketSegmentFilter\(/g) || []).length >= 2);

ok("setCommStatusFilter is a dedicated setter",
  (leadsPage.match(/setCommStatusFilter\(/g) || []).length >= 2);

// ── 8. Saved-view restoration preserves canonical values ─────────────────────
console.log("\n[8] Saved-view restoration");

ok("Saved-view restore sets industryFilter from f.primaryIndustry",
  /f\.primaryIndustry.*setIndustryFilter|setIndustryFilter.*f\.primaryIndustry/.test(leadsPage));

ok("Saved-view restore sets marketSegmentFilter from f.marketSegment",
  /f\.marketSegment.*setMarketSegmentFilter|setMarketSegmentFilter.*f\.marketSegment/.test(leadsPage));

// ── Summary ──────────────────────────────────────────────────────────────────
console.log("\n────────────────────────────────────────────────────────────");
console.log(`  Results: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log("\n  Failed checks:");
  failures.forEach(f => console.log(`    ✗ ${f}`));
}
console.log("────────────────────────────────────────────────────────────");
process.exit(failed > 0 ? 1 : 0);
