/**
 * taxonomy-backfill-preview.ts
 *
 * READ-ONLY preview of how legacy segment / slip data would map into the
 * Phase 2A taxonomy fields (market_segment, slip_range, slip_count_int).
 *
 * Produces a detailed report. Zero writes — ever.
 * A --write flag is accepted but always rejected with an error to prevent
 * accidental execution during development.
 *
 * Usage:
 *   npx tsx scripts/taxonomy-backfill-preview.ts
 *   npx tsx scripts/taxonomy-backfill-preview.ts --json   (machine-readable)
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

// ─── Safety guard ─────────────────────────────────────────────────────────────
if (process.argv.includes("--write")) {
  console.error("[taxonomy-preview] ERROR: --write flag is disabled. This script is read-only.");
  process.exit(1);
}

const JSON_OUTPUT = process.argv.includes("--json");

// ─── Canonical safe maps ──────────────────────────────────────────────────────

/**
 * Safe slip-range mapping.
 * Source: leads.segment, accounts.segment (when value is a free-text slip label).
 * Only entries in this map are ever written — everything else is skipped.
 */
export const SLIP_RANGE_MAP: Record<string, string> = {
  "Less than 100": "less_than_100",
  "100 to 300":    "100_to_300",
  "300 to 500":    "300_to_500",
  "500 to 700":    "500_to_700",
  "700 to 900":    "700_to_900",
  "More than 900": "more_than_900",
};

/**
 * Safe market-segment mapping.
 * Source: leads.segment, accounts.segment, accounts.org_type.
 * Only entries in this map are ever written — everything else is skipped.
 */
export const MARKET_SEGMENT_MAP: Record<string, string> = {
  "marina":        "marina",
  "marina_group":  "marina_parent_group",
  "yacht_club":    "yacht_club",
  "association":   "association",
  "port_harbor":   "port_harbor",
};

/**
 * Values explicitly flagged as ambiguous — never mapped, reported separately.
 * These need a human decision before any backfill can run.
 */
export const AMBIGUOUS_SEGMENT_VALUES = new Set<string>([
  "partner",
  "government_dock",
]);

// ─── Classification helpers ────────────────────────────────────────────────────

export type SegmentClass =
  | { type: "slip_range";      mapped: string }
  | { type: "market_segment";  mapped: string }
  | { type: "ambiguous" }
  | { type: "unmapped";        raw: string }
  | { type: "null" };

/** Classify a raw segment/org_type string into one of the canonical categories. */
export function classifySegment(raw: string | null | undefined): SegmentClass {
  if (!raw || raw.trim() === "") return { type: "null" };
  const trimmed = raw.trim();
  if (SLIP_RANGE_MAP[trimmed])       return { type: "slip_range",     mapped: SLIP_RANGE_MAP[trimmed] };
  if (MARKET_SEGMENT_MAP[trimmed])   return { type: "market_segment", mapped: MARKET_SEGMENT_MAP[trimmed] };
  if (AMBIGUOUS_SEGMENT_VALUES.has(trimmed)) return { type: "ambiguous" };
  return { type: "unmapped", raw: trimmed };
}

/**
 * Parse leads.slips (free-text) to an integer slip count.
 * Returns null for anything that isn't a plain positive integer string.
 * Does NOT parse slip-range labels ("Less than 100", etc.).
 */
export function parseSlipCount(raw: string | null | undefined): number | null {
  if (!raw || raw.trim() === "") return null;
  const n = parseInt(raw.trim(), 10);
  if (!isFinite(n) || n < 0 || String(n) !== raw.trim()) return null;
  return n;
}

// ─── Query helpers ─────────────────────────────────────────────────────────────

async function getValueCounts(table: "leads" | "accounts", column: string): Promise<Map<string | null, number>> {
  const rows = await db.execute(sql.raw(`
    SELECT ${column} AS val, COUNT(*)::integer AS cnt
    FROM ${table}
    GROUP BY ${column}
  `));
  const map = new Map<string | null, number>();
  for (const r of rows.rows as Array<{ val: string | null; cnt: number }>) {
    map.set(r.val, Number(r.cnt));
  }
  return map;
}

async function getTotalCount(table: "leads" | "accounts"): Promise<number> {
  const r = await db.execute(sql.raw(`SELECT COUNT(*)::integer AS cnt FROM ${table}`));
  return Number((r.rows[0] as { cnt: number }).cnt);
}

async function getLeadSlipCounts(): Promise<Map<string | null, number>> {
  return getValueCounts("leads", "slips");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runPreview() {
  const [
    totalLeads,
    totalAccounts,
    leadSegmentCounts,
    accountSegmentCounts,
    accountOrgTypeCounts,
    leadSlipsCounts,
  ] = await Promise.all([
    getTotalCount("leads"),
    getTotalCount("accounts"),
    getValueCounts("leads", "segment"),
    getValueCounts("accounts", "segment"),
    getValueCounts("accounts", "org_type"),
    getLeadSlipCounts(),
  ]);

  // ── Leads: segment → slipRange or marketSegment ────────────────────────────
  const leadSegmentReport = tally(leadSegmentCounts);

  // ── Accounts: segment → slipRange or marketSegment ────────────────────────
  const accountSegmentReport = tally(accountSegmentCounts);

  // ── Accounts: org_type → marketSegment ────────────────────────────────────
  const accountOrgTypeReport = tally(accountOrgTypeCounts);

  // ── Leads: slips → slipCountInt ───────────────────────────────────────────
  let slipsParseable = 0;
  let slipsUnparseable = 0;
  const slipsUnparseableDetail = new Map<string, number>();
  for (const [val, cnt] of leadSlipsCounts) {
    if (parseSlipCount(val) !== null) {
      slipsParseable += cnt;
    } else {
      slipsUnparseable += cnt;
      if (val !== null) {
        slipsUnparseableDetail.set(val, (slipsUnparseableDetail.get(val) ?? 0) + cnt);
      }
    }
  }

  // ── Combined ambiguous values (segment across both tables) ────────────────
  const ambiguousMap = new Map<string, number>();
  const collectAmbiguous = (report: TallyReport) => {
    for (const [raw, cnt] of report.ambiguous) {
      ambiguousMap.set(raw, (ambiguousMap.get(raw) ?? 0) + cnt);
    }
  };
  collectAmbiguous(leadSegmentReport);
  collectAmbiguous(accountSegmentReport);
  collectAmbiguous(accountOrgTypeReport);

  const result = {
    totalLeads,
    totalAccounts,
    leads: {
      segment: leadSegmentReport,
      slipCountInt: {
        parseable: slipsParseable,
        unparseable: slipsUnparseable,
        unparseableDetail: Object.fromEntries(slipsUnparseableDetail),
      },
    },
    accounts: {
      segment: accountSegmentReport,
      orgType: accountOrgTypeReport,
    },
    ambiguousValues: Object.fromEntries(ambiguousMap),
    writesDryRun: true,
    writesExecuted: 0,
  };

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  printReport(result, {
    leadSegmentReport,
    accountSegmentReport,
    accountOrgTypeReport,
    slipsParseable,
    slipsUnparseable,
    slipsUnparseableDetail,
    ambiguousMap,
    totalLeads,
    totalAccounts,
  });

  return result;
}

// ─── Tally helper ─────────────────────────────────────────────────────────────

interface TallyReport {
  slipRangeMappable:    number;
  marketSegmentMappable: number;
  ambiguous:            Map<string, number>;
  unmapped:             Map<string, number>;
  nullRows:             number;
  slipRangeDetail:      Map<string, { mapped: string; count: number }>;
  marketSegmentDetail:  Map<string, { mapped: string; count: number }>;
}

function tally(counts: Map<string | null, number>): TallyReport {
  const report: TallyReport = {
    slipRangeMappable: 0,
    marketSegmentMappable: 0,
    ambiguous: new Map(),
    unmapped: new Map(),
    nullRows: 0,
    slipRangeDetail: new Map(),
    marketSegmentDetail: new Map(),
  };
  for (const [val, cnt] of counts) {
    const cls = classifySegment(val);
    if      (cls.type === "null")           { report.nullRows += cnt; }
    else if (cls.type === "slip_range")     {
      report.slipRangeMappable += cnt;
      report.slipRangeDetail.set(val as string, { mapped: cls.mapped, count: cnt });
    }
    else if (cls.type === "market_segment") {
      report.marketSegmentMappable += cnt;
      report.marketSegmentDetail.set(val as string, { mapped: cls.mapped, count: cnt });
    }
    else if (cls.type === "ambiguous")      { report.ambiguous.set(val as string, cnt); }
    else if (cls.type === "unmapped")       { report.unmapped.set(cls.raw, cnt); }
  }
  return report;
}

// ─── Print ────────────────────────────────────────────────────────────────────

function printReport(result: ReturnType<typeof runPreview> extends Promise<infer T> ? T : never, extra: {
  leadSegmentReport: TallyReport;
  accountSegmentReport: TallyReport;
  accountOrgTypeReport: TallyReport;
  slipsParseable: number;
  slipsUnparseable: number;
  slipsUnparseableDetail: Map<string, number>;
  ambiguousMap: Map<string, number>;
  totalLeads: number;
  totalAccounts: number;
}) {
  const {
    leadSegmentReport, accountSegmentReport, accountOrgTypeReport,
    slipsParseable, slipsUnparseable, slipsUnparseableDetail,
    ambiguousMap, totalLeads, totalAccounts,
  } = extra;

  const bar = "─".repeat(60);
  console.log(`\n${bar}`);
  console.log("  Taxonomy Backfill Preview  [DRY RUN — zero writes]");
  console.log(`${bar}\n`);

  console.log(`  Total leads   : ${totalLeads.toLocaleString()}`);
  console.log(`  Total accounts: ${totalAccounts.toLocaleString()}`);

  console.log(`\n── leads.segment ──────────────────────────────────────────`);
  console.log(`  → slip_range     (safely mappable): ${leadSegmentReport.slipRangeMappable.toLocaleString()}`);
  for (const [raw, { mapped, count }] of leadSegmentReport.slipRangeDetail) {
    console.log(`       "${raw}"  →  ${mapped}  (${count.toLocaleString()})`);
  }
  console.log(`  → market_segment (safely mappable): ${leadSegmentReport.marketSegmentMappable.toLocaleString()}`);
  for (const [raw, { mapped, count }] of leadSegmentReport.marketSegmentDetail) {
    console.log(`       "${raw}"  →  ${mapped}  (${count.toLocaleString()})`);
  }
  if (leadSegmentReport.ambiguous.size > 0) {
    console.log(`  ⚠ ambiguous (NOT mapped):`);
    for (const [raw, cnt] of leadSegmentReport.ambiguous) {
      console.log(`       "${raw}"  (${cnt.toLocaleString()})`);
    }
  }
  if (leadSegmentReport.unmapped.size > 0) {
    console.log(`  ? unknown free text (NOT mapped):`);
    for (const [raw, cnt] of leadSegmentReport.unmapped) {
      console.log(`       "${raw}"  (${cnt.toLocaleString()})`);
    }
  }
  console.log(`  · null / empty (untouched): ${leadSegmentReport.nullRows.toLocaleString()}`);

  console.log(`\n── leads.slips → slip_count_int ───────────────────────────`);
  console.log(`  → parseable integers : ${slipsParseable.toLocaleString()}`);
  console.log(`  → unparseable (skip) : ${slipsUnparseable.toLocaleString()}`);
  if (slipsUnparseableDetail.size > 0) {
    for (const [raw, cnt] of slipsUnparseableDetail) {
      console.log(`       "${raw}"  (${cnt.toLocaleString()})`);
    }
  }

  console.log(`\n── accounts.segment ───────────────────────────────────────`);
  console.log(`  → slip_range     (safely mappable): ${accountSegmentReport.slipRangeMappable.toLocaleString()}`);
  for (const [raw, { mapped, count }] of accountSegmentReport.slipRangeDetail) {
    console.log(`       "${raw}"  →  ${mapped}  (${count.toLocaleString()})`);
  }
  console.log(`  → market_segment (safely mappable): ${accountSegmentReport.marketSegmentMappable.toLocaleString()}`);
  for (const [raw, { mapped, count }] of accountSegmentReport.marketSegmentDetail) {
    console.log(`       "${raw}"  →  ${mapped}  (${count.toLocaleString()})`);
  }
  if (accountSegmentReport.ambiguous.size > 0) {
    console.log(`  ⚠ ambiguous (NOT mapped):`);
    for (const [raw, cnt] of accountSegmentReport.ambiguous) {
      console.log(`       "${raw}"  (${cnt.toLocaleString()})`);
    }
  }
  if (accountSegmentReport.unmapped.size > 0) {
    console.log(`  ? unknown free text (NOT mapped):`);
    for (const [raw, cnt] of accountSegmentReport.unmapped) {
      console.log(`       "${raw}"  (${cnt.toLocaleString()})`);
    }
  }
  console.log(`  · null / empty (untouched): ${accountSegmentReport.nullRows.toLocaleString()}`);

  console.log(`\n── accounts.org_type → market_segment ─────────────────────`);
  console.log(`  → market_segment (safely mappable): ${accountOrgTypeReport.marketSegmentMappable.toLocaleString()}`);
  for (const [raw, { mapped, count }] of accountOrgTypeReport.marketSegmentDetail) {
    console.log(`       "${raw}"  →  ${mapped}  (${count.toLocaleString()})`);
  }
  if (accountOrgTypeReport.ambiguous.size > 0) {
    console.log(`  ⚠ ambiguous (NOT mapped):`);
    for (const [raw, cnt] of accountOrgTypeReport.ambiguous) {
      console.log(`       "${raw}"  (${cnt.toLocaleString()})`);
    }
  }
  if (accountOrgTypeReport.unmapped.size > 0) {
    console.log(`  ? unknown / no safe mapping (skip):`);
    for (const [raw, cnt] of accountOrgTypeReport.unmapped) {
      console.log(`       "${raw}"  (${cnt.toLocaleString()})`);
    }
  }
  console.log(`  · null / empty (untouched): ${accountOrgTypeReport.nullRows.toLocaleString()}`);

  if (ambiguousMap.size > 0) {
    console.log(`\n── All ambiguous values (combined, need human decision) ───`);
    for (const [raw, cnt] of ambiguousMap) {
      console.log(`  ⚠  "${raw}"  —  ${cnt.toLocaleString()} total row(s)`);
    }
  }

  console.log(`\n── Safety summary ─────────────────────────────────────────`);
  console.log(`  Writes executed : 0`);
  console.log(`  Dry run         : true`);
  console.log(`${bar}\n`);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

runPreview()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); });
