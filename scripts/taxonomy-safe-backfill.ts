/**
 * taxonomy-safe-backfill.ts
 *
 * Phase 2C — safe, unambiguous backfill of the Phase 2A taxonomy columns.
 * Default: DRY-RUN. No writes unless --write is explicitly passed.
 *
 * Safe write operations (all gated by WHERE target IS NULL):
 *   1. leads.slip_range      ← leads.segment  (6 slip-range labels)
 *   2. accounts.slip_range   ← accounts.segment (6 slip-range labels)
 *   3. leads.market_segment  ← leads.segment = 'marina'
 *   4. accounts.market_segment ← accounts.segment (marina/marina_group/association/yacht_club)
 *   5. accounts.market_segment ← accounts.org_type (marina/association) — only where still NULL
 *
 * Hard rules enforced:
 *   - WHERE target_column IS NULL on every UPDATE (never overwrites existing values)
 *   - No DELETEs, no record recreation, no link/association changes
 *   - government_dock, partner, industry_association, marina_prospect → never written
 *   - null / empty string / unknown free text                        → never written
 *
 * Usage:
 *   npx tsx scripts/taxonomy-safe-backfill.ts            # dry-run report
 *   npx tsx scripts/taxonomy-safe-backfill.ts --write    # execute safe writes
 *   npx tsx scripts/taxonomy-safe-backfill.ts --json     # machine-readable output
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

const WRITE_MODE  = process.argv.includes("--write");
const JSON_OUTPUT = process.argv.includes("--json");

// ─── Safe maps ────────────────────────────────────────────────────────────────

/** Exactly 6 slip-range labels. These are the ONLY values ever written to slip_range. */
const SLIP_RANGE_ENTRIES: Array<{ raw: string; key: string }> = [
  { raw: "Less than 100", key: "less_than_100" },
  { raw: "100 to 300",    key: "100_to_300"    },
  { raw: "300 to 500",    key: "300_to_500"    },
  { raw: "500 to 700",    key: "500_to_700"    },
  { raw: "700 to 900",    key: "700_to_900"    },
  { raw: "More than 900", key: "more_than_900" },
];

/** Safe market-segment writes for leads.segment. */
const LEADS_MARKET_SEGMENT_ENTRIES: Array<{ raw: string; key: string }> = [
  { raw: "marina", key: "marina" },
];

/** Safe market-segment writes from accounts.segment. */
const ACCOUNTS_SEGMENT_MARKET_ENTRIES: Array<{ raw: string; key: string }> = [
  { raw: "marina",       key: "marina"              },
  { raw: "marina_group", key: "marina_parent_group" },
  { raw: "association",  key: "association"          },
  { raw: "yacht_club",   key: "yacht_club"           },
];

/** Safe market-segment writes from accounts.org_type (applied only where market_segment IS NULL). */
const ACCOUNTS_ORG_TYPE_MARKET_ENTRIES: Array<{ raw: string; key: string }> = [
  { raw: "marina",      key: "marina"      },
  { raw: "association", key: "association" },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface OpResult {
  name:         string;
  source:       string;
  target:       string;
  condition:    string;
  beforeNulls:  number;
  rowsAffected: number;
  afterNulls:   number;
  skipped:      boolean;
}

interface TableCounts {
  leads:              number;
  accounts:           number;
  contacts:           number;
  notes:              number;
  activities:         number;
  tasks:              number;
  email_associations: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function countNulls(table: string, col: string): Promise<number> {
  const r = await db.execute(sql.raw(
    `SELECT COUNT(*)::integer AS n FROM ${table} WHERE ${col} IS NULL`
  ));
  return Number((r.rows[0] as { n: number }).n);
}

async function rowCount(table: string): Promise<number> {
  const r = await db.execute(sql.raw(
    `SELECT COUNT(*)::integer AS n FROM ${table}`
  ));
  return Number((r.rows[0] as { n: number }).n);
}

async function getTableCounts(): Promise<TableCounts> {
  const [leads, accounts, contacts, notes, activities, tasks, email_associations] =
    await Promise.all([
      rowCount("leads"),
      rowCount("accounts"),
      rowCount("contacts"),
      rowCount("notes"),
      rowCount("activities"),
      rowCount("tasks"),
      rowCount("email_associations"),
    ]);
  return { leads, accounts, contacts, notes, activities, tasks, email_associations };
}

/**
 * For each (raw, key) pair, build a single UPDATE using CASE ... END.
 * One statement per target column — minimises round trips.
 * The WHERE clause ensures:
 *   a) segment/org_type matches one of the safe values
 *   b) target column IS NULL (never overwrites)
 */
async function runUpdate(
  table: string,
  sourceCol: string,
  targetCol: string,
  entries: Array<{ raw: string; key: string }>,
  label: string,
  dryRun: boolean,
): Promise<OpResult> {
  const before = await countNulls(table, targetCol);

  if (dryRun) {
    // Count what would be written without touching anything
    const inClause = entries.map(e => `'${e.raw.replace(/'/g, "''")}'`).join(", ");
    const r = await db.execute(sql.raw(
      `SELECT COUNT(*)::integer AS n
       FROM ${table}
       WHERE ${sourceCol} IN (${inClause})
         AND ${targetCol} IS NULL`
    ));
    const would = Number((r.rows[0] as { n: number }).n);
    return {
      name: label, source: `${table}.${sourceCol}`,
      target: `${table}.${targetCol}`,
      condition: `${targetCol} IS NULL`,
      beforeNulls: before, rowsAffected: would, afterNulls: before - would,
      skipped: true,
    };
  }

  // Build CASE expression
  const caseBranches = entries
    .map(e => `WHEN ${sourceCol} = '${e.raw.replace(/'/g, "''")}' THEN '${e.key}'`)
    .join("\n           ");
  const inClause = entries.map(e => `'${e.raw.replace(/'/g, "''")}'`).join(", ");

  const updateSql = `
    UPDATE ${table}
    SET    ${targetCol} = CASE
           ${caseBranches}
           END
    WHERE  ${sourceCol} IN (${inClause})
      AND  ${targetCol} IS NULL
  `;

  await db.execute(sql.raw(updateSql));
  const after = await countNulls(table, targetCol);

  return {
    name: label, source: `${table}.${sourceCol}`,
    target: `${table}.${targetCol}`,
    condition: `${targetCol} IS NULL`,
    beforeNulls: before, rowsAffected: before - after, afterNulls: after,
    skipped: false,
  };
}

// ─── Verification helpers ─────────────────────────────────────────────────────

/** Returns distinct market_segment values that are NOT in the allowed set. */
async function illegalMarketSegmentValues(table: string): Promise<string[]> {
  const allowed = ["marina", "marina_parent_group", "yacht_club", "association", "port_harbor"];
  const inClause = allowed.map(v => `'${v}'`).join(", ");
  const r = await db.execute(sql.raw(
    `SELECT DISTINCT market_segment
     FROM ${table}
     WHERE market_segment IS NOT NULL
       AND market_segment NOT IN (${inClause})`
  ));
  return (r.rows as Array<{ market_segment: string }>).map(x => x.market_segment);
}

/** Returns distinct slip_range values that are NOT in the allowed set. */
async function illegalSlipRangeValues(table: string): Promise<string[]> {
  const allowed = SLIP_RANGE_ENTRIES.map(e => `'${e.key}'`).join(", ");
  const r = await db.execute(sql.raw(
    `SELECT DISTINCT slip_range
     FROM ${table}
     WHERE slip_range IS NOT NULL
       AND slip_range NOT IN (${allowed})`
  ));
  return (r.rows as Array<{ slip_range: string }>).map(x => x.slip_range);
}

/** Rows that are ambiguous and should still have NULL taxonomy fields. */
async function ambiguousStillNull(): Promise<{
  accounts_govt_dock_ms_null:  number;
  accounts_partner_ms_null:    number;
  accounts_marina_prospect_ms_null: number;
}> {
  const r = await db.execute(sql.raw(`
    SELECT
      COUNT(*) FILTER (WHERE segment = 'government_dock' AND market_segment IS NULL)::integer AS govt_dock,
      COUNT(*) FILTER (WHERE (segment = 'partner' OR org_type = 'partner') AND market_segment IS NULL)::integer AS partner,
      COUNT(*) FILTER (WHERE org_type = 'marina_prospect' AND market_segment IS NULL)::integer AS marina_prospect
    FROM accounts
  `));
  const row = r.rows[0] as { govt_dock: number; partner: number; marina_prospect: number };
  return {
    accounts_govt_dock_ms_null:       Number(row.govt_dock),
    accounts_partner_ms_null:         Number(row.partner),
    accounts_marina_prospect_ms_null: Number(row.marina_prospect),
  };
}

/** Returns counts for legacy fields (must not change). */
async function legacyFieldCounts(): Promise<{
  leads_segment_non_null:        number;
  accounts_segment_non_null:     number;
  accounts_org_type_non_null:    number;
}> {
  const r = await db.execute(sql.raw(`
    SELECT
      (SELECT COUNT(*)::integer FROM leads    WHERE segment  IS NOT NULL) AS leads_seg,
      (SELECT COUNT(*)::integer FROM accounts WHERE segment  IS NOT NULL) AS accts_seg,
      (SELECT COUNT(*)::integer FROM accounts WHERE org_type IS NOT NULL) AS accts_org
  `));
  const row = r.rows[0] as { leads_seg: number; accts_seg: number; accts_org: number };
  return {
    leads_segment_non_null:     Number(row.leads_seg),
    accounts_segment_non_null:  Number(row.accts_seg),
    accounts_org_type_non_null: Number(row.accts_org),
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const dryRun = !WRITE_MODE;
  const mode = dryRun ? "dry-run" : "write";

  if (!JSON_OUTPUT) {
    const bar = "─".repeat(62);
    console.log(`\n${bar}`);
    console.log(`  Taxonomy Safe Backfill  [${dryRun ? "DRY-RUN — no writes" : "WRITE MODE — executing updates"}]`);
    console.log(`${bar}\n`);
  }

  const beforeCounts  = await getTableCounts();
  const beforeLegacy  = await legacyFieldCounts();

  // ── Run operations ───────────────────────────────────────────────────────
  const ops: OpResult[] = [];

  ops.push(await runUpdate("leads",    "segment",  "slip_range",      SLIP_RANGE_ENTRIES,               "leads.slip_range ← leads.segment",              dryRun));
  ops.push(await runUpdate("accounts", "segment",  "slip_range",      SLIP_RANGE_ENTRIES,               "accounts.slip_range ← accounts.segment",        dryRun));
  ops.push(await runUpdate("leads",    "segment",  "market_segment",  LEADS_MARKET_SEGMENT_ENTRIES,     "leads.market_segment ← leads.segment",          dryRun));
  ops.push(await runUpdate("accounts", "segment",  "market_segment",  ACCOUNTS_SEGMENT_MARKET_ENTRIES,  "accounts.market_segment ← accounts.segment",    dryRun));
  ops.push(await runUpdate("accounts", "org_type", "market_segment",  ACCOUNTS_ORG_TYPE_MARKET_ENTRIES, "accounts.market_segment ← accounts.org_type",   dryRun));

  // ── Post-run verification ────────────────────────────────────────────────
  const afterCounts         = await getTableCounts();
  const afterLegacy         = await legacyFieldCounts();
  const ambiguous           = await ambiguousStillNull();
  const illegalMS_leads     = await illegalMarketSegmentValues("leads");
  const illegalMS_accounts  = await illegalMarketSegmentValues("accounts");
  const illegalSR_leads     = await illegalSlipRangeValues("leads");
  const illegalSR_accounts  = await illegalSlipRangeValues("accounts");

  const totalRowsAffected = ops.reduce((s, o) => s + o.rowsAffected, 0);
  const writesExecuted    = dryRun ? 0 : totalRowsAffected;

  const result = {
    mode,
    dryRun,
    writesExecuted,
    totalWouldAffect: dryRun ? totalRowsAffected : undefined,
    operations: ops.map(o => ({
      name:         o.name,
      source:       o.source,
      target:       o.target,
      rowsAffected: o.rowsAffected,
      skipped:      o.skipped,
    })),
    beforeCounts,
    afterCounts,
    rowCountsUnchanged:
      beforeCounts.leads              === afterCounts.leads              &&
      beforeCounts.accounts           === afterCounts.accounts           &&
      beforeCounts.contacts           === afterCounts.contacts           &&
      beforeCounts.notes              === afterCounts.notes              &&
      beforeCounts.activities         === afterCounts.activities         &&
      beforeCounts.tasks              === afterCounts.tasks              &&
      beforeCounts.email_associations === afterCounts.email_associations,
    legacyFieldsUnchanged:
      beforeLegacy.leads_segment_non_null     === afterLegacy.leads_segment_non_null     &&
      beforeLegacy.accounts_segment_non_null  === afterLegacy.accounts_segment_non_null  &&
      beforeLegacy.accounts_org_type_non_null === afterLegacy.accounts_org_type_non_null,
    ambiguousValuesStillNull: ambiguous,
    illegalValues: {
      leads_market_segment:    illegalMS_leads,
      accounts_market_segment: illegalMS_accounts,
      leads_slip_range:        illegalSR_leads,
      accounts_slip_range:     illegalSR_accounts,
    },
  };

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  // ── Human-readable output ────────────────────────────────────────────────
  const bar = "─".repeat(62);
  for (const op of ops) {
    const flag = op.skipped ? "[would write]" : "[wrote]";
    console.log(`  ${flag}  ${op.name}`);
    if (op.skipped) {
      console.log(`             rows that would be written : ${op.rowsAffected.toLocaleString()}`);
    } else {
      console.log(`             rows written               : ${op.rowsAffected.toLocaleString()}`);
    }
  }

  console.log(`\n── Totals ─────────────────────────────────────────────────`);
  if (dryRun) {
    console.log(`  Total rows that would be written : ${totalRowsAffected.toLocaleString()}`);
    console.log(`  Writes executed                  : 0  (dry-run)`);
  } else {
    console.log(`  Total rows written               : ${writesExecuted.toLocaleString()}`);
  }

  console.log(`\n── Table row count integrity ──────────────────────────────`);
  for (const tbl of Object.keys(beforeCounts) as Array<keyof TableCounts>) {
    const same = beforeCounts[tbl] === afterCounts[tbl];
    console.log(`  ${same ? "✓" : "✗"}  ${tbl.padEnd(22)} before=${beforeCounts[tbl]}  after=${afterCounts[tbl]}`);
  }

  console.log(`\n── Legacy fields unchanged ────────────────────────────────`);
  console.log(`  ${result.legacyFieldsUnchanged ? "✓" : "✗"}  leads.segment / accounts.segment / accounts.org_type — unchanged`);

  console.log(`\n── Ambiguous values (still NULL, untouched) ───────────────`);
  console.log(`  ✓  government_dock accounts with NULL market_segment : ${ambiguous.accounts_govt_dock_ms_null}`);
  console.log(`  ✓  partner accounts with NULL market_segment         : ${ambiguous.accounts_partner_ms_null}`);
  console.log(`  ✓  marina_prospect accounts with NULL market_segment : ${ambiguous.accounts_marina_prospect_ms_null}`);

  if (illegalMS_leads.length || illegalMS_accounts.length || illegalSR_leads.length || illegalSR_accounts.length) {
    console.log(`\n✗  ILLEGAL VALUES FOUND — investigate:`);
    if (illegalMS_leads.length)    console.log(`     leads.market_segment:    ${illegalMS_leads.join(", ")}`);
    if (illegalMS_accounts.length) console.log(`     accounts.market_segment: ${illegalMS_accounts.join(", ")}`);
    if (illegalSR_leads.length)    console.log(`     leads.slip_range:        ${illegalSR_leads.join(", ")}`);
    if (illegalSR_accounts.length) console.log(`     accounts.slip_range:     ${illegalSR_accounts.join(", ")}`);
  } else {
    console.log(`\n  ✓  All written values are within the canonical allowed set`);
  }

  console.log(`\n${bar}\n`);
  return result;
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); });
