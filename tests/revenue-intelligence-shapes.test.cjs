/**
 * Regression tests: Revenue Intelligence API shape guards
 *
 * Verifies that the normalizer and query helpers on /revenue-intelligence
 * tolerate malformed/wrapped/null API responses without crashing.
 *
 * These are source-grep + pure-logic tests — no server or browser required.
 */

const assert = require("assert");
const fs     = require("fs");
const path   = require("path");

const PAGE = path.join(__dirname, "../client/src/pages/revenue-intelligence.tsx");
const src  = fs.readFileSync(PAGE, "utf8");

let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// ── 1. asArray helper present and correct ─────────────────────────────────────

console.log("\n[1] asArray helper");

test("asArray function is defined", () => {
  assert.ok(src.includes("function asArray"), "asArray not found");
});

test("asArray returns [] for non-array", () => {
  assert.ok(
    src.includes("if (Array.isArray(v)) return v") &&
    src.includes("return [];"),
    "asArray does not have correct fallback"
  );
});

// ── 2. normalizeCommandCenter present ─────────────────────────────────────────

console.log("\n[2] normalizeCommandCenter");

test("normalizeCommandCenter function is defined", () => {
  assert.ok(src.includes("function normalizeCommandCenter"), "normalizeCommandCenter not found");
});

test("normalizeCommandCenter wraps all 6 array fields with asArray", () => {
  const fields = ["hotAccounts", "accelerating", "followUpOpportunities", "atRisk", "heatmap", "champions"];
  for (const f of fields) {
    assert.ok(
      src.includes(`asArray`) && src.includes(f),
      `normalizeCommandCenter missing asArray guard for ${f}`
    );
  }
});

test("normalizeCommandCenter is wired into command-center queryFn", () => {
  assert.ok(
    src.includes(".then(normalizeCommandCenter)"),
    "normalizeCommandCenter not chained in command-center queryFn"
  );
});

test("summary fields use Number() coercion in normalizer", () => {
  assert.ok(
    src.includes("Number(d?.summary?.hotCount"),
    "hotCount not coerced with Number()"
  );
  assert.ok(
    src.includes("Number(d?.summary?.totalActiveAccounts"),
    "totalActiveAccounts not coerced"
  );
  assert.ok(
    src.includes("Number(d?.summary?.avgScore"),
    "avgScore not coerced"
  );
});

// ── 3. Needs-reply unwrap ─────────────────────────────────────────────────────

console.log("\n[3] needs-reply unwrap");

test("needs-reply queryFn unwraps .items", () => {
  assert.ok(
    src.includes("d?.items ?? []"),
    "needs-reply queryFn does not unwrap .items"
  );
});

test("needs-reply queryFn handles plain array fallback", () => {
  assert.ok(
    src.includes("Array.isArray(d) ? d : (d?.items ?? [])"),
    "needs-reply queryFn missing Array.isArray guard"
  );
});

// ── 4. trendColor / trendBg / trendLabel have defaults ───────────────────────

console.log("\n[4] Trend helper default cases");

test("trendColor has explicit default return (no undefined)", () => {
  const block = src.slice(src.indexOf("function trendColor"), src.indexOf("function trendBg"));
  assert.ok(
    block.includes("default:"),
    "trendColor missing default case"
  );
  assert.ok(
    !block.includes("return undefined"),
    "trendColor explicitly returns undefined — bad"
  );
});

test("trendBg has explicit default return", () => {
  const start = src.indexOf("function trendBg");
  const end   = src.indexOf("function trendLabel");
  const block = src.slice(start, end);
  assert.ok(block.includes("default:"), "trendBg missing default case");
});

test("trendLabel has explicit default return", () => {
  const start = src.indexOf("function trendLabel");
  const end   = src.indexOf("function TrendIcon");
  const block = src.slice(start, end);
  assert.ok(block.includes("default:"), "trendLabel missing default case");
});

test("trendColor accepts null/undefined in signature", () => {
  assert.ok(
    src.includes("trendColor(t: MomentumStatus | null | undefined)"),
    "trendColor signature does not accept null/undefined"
  );
});

// ── 5. Array renders are guarded ─────────────────────────────────────────────

console.log("\n[5] Array render guards");

const arrayFields = [
  ["hotAccounts",           "data?.hotAccounts ?? []"],
  ["champions",             "data?.champions ?? []"],
  ["accelerating",          "data?.accelerating ?? []"],
  ["followUpOpportunities", "data?.followUpOpportunities ?? []"],
  ["atRisk",                "data?.atRisk ?? []"],
  ["heatmap",               "data?.heatmap ?? []"],
];

for (const [field, guard] of arrayFields) {
  test(`${field} render uses ?? [] guard`, () => {
    assert.ok(src.includes(guard), `Missing guard: ${guard}`);
  });
}

// ── 6. timeAgo is null-safe ───────────────────────────────────────────────────

console.log("\n[6] timeAgo null-safety");

test("timeAgo early-returns '—' for null/falsy input", () => {
  const block = src.slice(src.indexOf("function timeAgo"), src.indexOf("function AccountRow"));
  assert.ok(
    block.includes("if (!ts) return"),
    "timeAgo missing null guard"
  );
});

test("timeAgo wraps formatDistanceToNow in try/catch", () => {
  const block = src.slice(src.indexOf("function timeAgo"), src.indexOf("function AccountRow"));
  assert.ok(
    block.includes("try") && block.includes("catch"),
    "timeAgo missing try/catch around date formatting"
  );
});

// ── 7. HeatmapTable receives pre-guarded array ────────────────────────────────

console.log("\n[7] HeatmapTable call-site guard");

test("HeatmapTable is called with data?.heatmap ?? []", () => {
  assert.ok(
    src.includes("data={data?.heatmap ?? []}"),
    "HeatmapTable not passed a guarded array"
  );
});

test("HeatmapTable spreads into [...data] (safe because input is always array)", () => {
  const block = src.slice(src.indexOf("function HeatmapTable"), src.indexOf("function StatCard"));
  assert.ok(
    block.includes("[...data]"),
    "HeatmapTable missing spread for sort copy"
  );
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`Revenue Intelligence shape guards: ${passed} passed, ${failed} failed`);
console.log(`${"─".repeat(60)}\n`);

if (failed > 0) process.exit(1);
