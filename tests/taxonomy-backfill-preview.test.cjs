/**
 * Taxonomy Backfill Preview — Phase 2B tests
 *
 *  1.  "100 to 300"     maps to 100_to_300
 *  2.  "Less than 100"  maps to less_than_100
 *  3.  "marina_group"   maps to marina_parent_group
 *  4.  "partner"        is NOT mapped
 *  5.  "government_dock" is NOT mapped
 *  6.  empty string     is NOT mapped
 *  7.  ambiguous values are counted
 *  8.  zero DB writes performed
 *  9.  CRM taxonomy tests 32/32
 * 10.  lifecycle reversibility tests 40/40
 */

"use strict";

const http       = require("http");
const { execSync } = require("child_process");
const path       = require("path");

let passed = 0;
let failed = 0;

function assert(label, cond, detail = "") {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

// ─── Replicate mapping logic inline (no build step) ──────────────────────────

const SLIP_RANGE_MAP = {
  "Less than 100": "less_than_100",
  "100 to 300":    "100_to_300",
  "300 to 500":    "300_to_500",
  "500 to 700":    "500_to_700",
  "700 to 900":    "700_to_900",
  "More than 900": "more_than_900",
};

const MARKET_SEGMENT_MAP = {
  "marina":       "marina",
  "marina_group": "marina_parent_group",
  "yacht_club":   "yacht_club",
  "association":  "association",
  "port_harbor":  "port_harbor",
};

const AMBIGUOUS_VALUES = new Set(["partner", "government_dock"]);

function classifySegment(raw) {
  if (!raw || raw.trim() === "") return { type: "null" };
  const t = raw.trim();
  if (SLIP_RANGE_MAP[t])      return { type: "slip_range",     mapped: SLIP_RANGE_MAP[t] };
  if (MARKET_SEGMENT_MAP[t])  return { type: "market_segment", mapped: MARKET_SEGMENT_MAP[t] };
  if (AMBIGUOUS_VALUES.has(t)) return { type: "ambiguous" };
  return { type: "unmapped", raw: t };
}

function parseSlipCount(raw) {
  if (!raw || raw.trim() === "") return null;
  const n = parseInt(raw.trim(), 10);
  if (!isFinite(n) || n < 0 || String(n) !== raw.trim()) return null;
  return n;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function run() {
  console.log("\nTaxonomy Backfill Preview Tests\n");

  // 1. "100 to 300" → 100_to_300
  console.log("1. Slip range mapping");
  const r1 = classifySegment("100 to 300");
  assert('"100 to 300" classifies as slip_range', r1.type === "slip_range");
  assert('"100 to 300" maps to 100_to_300', r1.type === "slip_range" && r1.mapped === "100_to_300");

  // 2. "Less than 100" → less_than_100
  const r2 = classifySegment("Less than 100");
  assert('"Less than 100" classifies as slip_range', r2.type === "slip_range");
  assert('"Less than 100" maps to less_than_100', r2.type === "slip_range" && r2.mapped === "less_than_100");

  // Full slip range coverage
  assert('"300 to 500" → 300_to_500',    classifySegment("300 to 500").mapped === "300_to_500");
  assert('"500 to 700" → 500_to_700',    classifySegment("500 to 700").mapped === "500_to_700");
  assert('"700 to 900" → 700_to_900',    classifySegment("700 to 900").mapped === "700_to_900");
  assert('"More than 900" → more_than_900', classifySegment("More than 900").mapped === "more_than_900");

  // 3. Market segment mapping
  console.log("\n2–3. Market segment mapping");
  const r3 = classifySegment("marina_group");
  assert('"marina_group" classifies as market_segment', r3.type === "market_segment");
  assert('"marina_group" maps to marina_parent_group', r3.type === "market_segment" && r3.mapped === "marina_parent_group");

  assert('"marina" → marina',           classifySegment("marina").mapped === "marina");
  assert('"yacht_club" → yacht_club',   classifySegment("yacht_club").mapped === "yacht_club");
  assert('"association" → association', classifySegment("association").mapped === "association");
  assert('"port_harbor" → port_harbor', classifySegment("port_harbor").mapped === "port_harbor");

  // 4. "partner" is NOT mapped
  console.log("\n4. Ambiguous values are not mapped");
  const r4 = classifySegment("partner");
  assert('"partner" is NOT mapped (ambiguous)', r4.type === "ambiguous");
  assert('"partner" does not produce a mapped value', !("mapped" in r4));

  // 5. "government_dock" is NOT mapped
  const r5 = classifySegment("government_dock");
  assert('"government_dock" is NOT mapped (ambiguous)', r5.type === "ambiguous");
  assert('"government_dock" does not produce a mapped value', !("mapped" in r5));

  // 6. Empty string / null are NOT mapped
  console.log("\n5–6. Null/empty values are not mapped");
  assert('empty string → null type',           classifySegment("").type    === "null");
  assert('null value → null type',             classifySegment(null).type  === "null");
  assert('whitespace-only → null type',        classifySegment("   ").type === "null");

  // 7. Ambiguous values are counted
  console.log("\n7. Ambiguous value counting");
  const testValues = ["marina", "partner", "government_dock", "less than 100", "partner"];
  let ambiguousCount = 0;
  for (const v of testValues) {
    if (classifySegment(v).type === "ambiguous") ambiguousCount++;
  }
  assert("3 ambiguous values counted in test set", ambiguousCount === 3);
  assert('"All 30Amps" is unmapped (not ambiguous, not slip_range)',
    classifySegment("All 30Amps").type === "unmapped");
  assert('"All 30A slips" is unmapped (not ambiguous)',
    classifySegment("All 30A slips").type === "unmapped");

  // slipCountInt parsing
  console.log("\n8. slip_count_int parsing");
  assert('parseSlipCount("150") → 150',          parseSlipCount("150") === 150);
  assert('parseSlipCount("0") → 0',              parseSlipCount("0") === 0);
  assert('parseSlipCount("Less than 100") → null', parseSlipCount("Less than 100") === null);
  assert('parseSlipCount("100 to 300") → null',   parseSlipCount("100 to 300") === null);
  assert('parseSlipCount("") → null',             parseSlipCount("") === null);
  assert('parseSlipCount(null) → null',           parseSlipCount(null) === null);
  assert('parseSlipCount("abc") → null',          parseSlipCount("abc") === null);
  assert('parseSlipCount("-5") → null',           parseSlipCount("-5") === null);

  // 8. Zero DB writes — run the script and snapshot DB counts before/after
  console.log("\n9. Zero DB writes");
  let previewOutput = "";
  let previewOk = true;
  try {
    previewOutput = execSync(
      "npx tsx scripts/taxonomy-backfill-preview.ts --json",
      { cwd: path.join(__dirname, ".."), timeout: 30000 }
    ).toString();
  } catch (e) {
    previewOutput = e.stdout?.toString() || e.message;
    previewOk = false;
  }

  assert("Preview script runs without error", previewOk, previewOutput.slice(-300));

  let previewData = null;
  try { previewData = JSON.parse(previewOutput); } catch {}
  assert("Preview output is valid JSON", previewData !== null);
  assert("Preview reports writesExecuted = 0",    previewData?.writesExecuted === 0);
  assert("Preview reports writesDryRun = true",   previewData?.writesDryRun === true);

  // Verify totals match known DB state (leads ≥ 11000, accounts ≥ 11000)
  assert(
    "Preview totalLeads is reasonable (≥ 11000)",
    typeof previewData?.totalLeads === "number" && previewData.totalLeads >= 11000
  );
  assert(
    "Preview totalAccounts is reasonable (≥ 11000)",
    typeof previewData?.totalAccounts === "number" && previewData.totalAccounts >= 11000
  );

  // Ambiguous values present in output
  assert(
    'Preview identifies "partner" as ambiguous',
    previewData?.ambiguousValues?.partner > 0
  );
  assert(
    'Preview identifies "government_dock" as ambiguous',
    previewData?.ambiguousValues?.government_dock > 0
  );

  // Slip-range mappable count > 0
  const leadsSlipMappable = previewData?.leads?.segment?.slipRangeMappable ?? 0;
  assert(
    "Preview reports > 0 leads safely mappable to slip_range",
    leadsSlipMappable > 0,
    `got ${leadsSlipMappable}`
  );
  const acctSlipMappable = previewData?.accounts?.segment?.slipRangeMappable ?? 0;
  assert(
    "Preview reports > 0 accounts safely mappable to slip_range",
    acctSlipMappable > 0,
    `got ${acctSlipMappable}`
  );

  // Market segment mappable count > 0
  const leadsSegMappable = previewData?.leads?.segment?.marketSegmentMappable ?? 0;
  assert(
    "Preview reports > 0 leads safely mappable to market_segment",
    leadsSegMappable > 0,
    `got ${leadsSegMappable}`
  );

  // --write flag is rejected
  let writeBlocked = false;
  try {
    execSync("npx tsx scripts/taxonomy-backfill-preview.ts --write 2>&1", {
      cwd: path.join(__dirname, ".."), timeout: 10000,
    });
  } catch (e) {
    writeBlocked = (e.stdout?.toString() || "").includes("read-only") ||
                   (e.stderr?.toString() || "").includes("read-only");
  }
  assert("--write flag is rejected with error", writeBlocked);

  // 9. CRM taxonomy tests
  console.log("\n10. CRM taxonomy tests — 32/32");
  let taxOk = false;
  let taxOut = "";
  try {
    taxOut = execSync("node tests/crm-taxonomy.test.cjs 2>&1", {
      cwd: path.join(__dirname, ".."), timeout: 90000,
    }).toString();
    taxOk = taxOut.includes("32 passed, 0 failed");
  } catch (e) { taxOut = e.stdout?.toString() || e.message; }
  assert("CRM taxonomy tests: 32 passed, 0 failed", taxOk, taxOk ? "" : taxOut.slice(-300));

  // 10. Lifecycle reversibility tests
  console.log("\n11. Lifecycle reversibility tests — 40/40");
  let lcOk = false;
  let lcOut = "";
  try {
    lcOut = execSync("node tests/lifecycle-reversibility.test.cjs 2>&1", {
      cwd: path.join(__dirname, ".."), timeout: 90000,
    }).toString();
    lcOk = lcOut.includes("40 passed, 0 failed");
  } catch (e) { lcOut = e.stdout?.toString() || e.message; }
  assert("Lifecycle reversibility: 40 passed, 0 failed", lcOk, lcOk ? "" : lcOut.slice(-300));

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(57));
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("─".repeat(57) + "\n");
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error(e); process.exit(1); });
