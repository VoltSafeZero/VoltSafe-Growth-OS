#!/usr/bin/env node
/**
 * VoltSafe Cortex — Post-Cutover Audit (Step E)
 *
 * Usage:
 *   node scripts/post-cutover-audit.js --batchId phase2-batch1-20260415
 *
 * Validates a completed migration batch end-to-end across four check groups:
 *
 *   Group 1 — Account linkage
 *     For every migration_log row: account exists, back-refs are correct,
 *     required fields are populated, partnership row is in a migrated state.
 *
 *   Group 2 — Lifecycle completeness
 *     migration_status is 'children_migrated' or 'complete'; all timestamps
 *     (migrated_at, verified_at, children_migrated_at) are non-null.
 *
 *   Group 3 — No residual children on partnership side
 *     All 9 child tables checked: zero rows still pointing to source
 *     partnership IDs via type='partnership' / primary_partner_id.
 *
 *   Group 4 — No orphan children introduced
 *     Global scan: any child row pointing to type='account' where the
 *     account_id does not exist in accounts table.
 *
 * Exits 0 if all checks pass, 1 if any fail.
 */

import pg from "pg";
const { Pool } = pg;

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      result[key] = next && !next.startsWith("--") ? next : true;
      if (next && !next.startsWith("--")) i++;
    }
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));

if (!args.batchId) {
  console.error("ERROR: --batchId is required");
  console.error("Usage: node scripts/post-cutover-audit.js --batchId <batch_id>");
  process.exit(1);
}

const BATCH_ID = args.batchId;

// ── Child table definitions (mirrors relink-children.js) ─────────────────────
const POLYMORPHIC_CHILDREN = [
  { table: "notes",              typeCol: "linked_object_type", idCol: "linked_object_id" },
  { table: "attachments",        typeCol: "object_type",        idCol: "object_id"        },
  { table: "activities",         typeCol: "linked_object_type", idCol: "linked_object_id" },
  { table: "comments",           typeCol: "object_type",        idCol: "object_id"        },
  { table: "tasks",              typeCol: "linked_object_type", idCol: "linked_object_id" },
  { table: "email_associations", typeCol: "object_type",        idCol: "object_id"        },
  { table: "calendar_events",    typeCol: "linked_object_type", idCol: "linked_object_id" },
  { table: "record_tags",        typeCol: "record_type",        idCol: "record_id"        },
];
const DEDICATED_CHILDREN = [
  { table: "email_threads", partnerCol: "primary_partner_id", accountCol: "primary_account_id" },
];

const COMPLETED_STATUSES = ["children_migrated", "complete"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function check(label, pass, detail = null) {
  const icon = pass ? "✓" : "✗";
  const line = `      ${icon} ${label}`;
  console.log(detail && !pass ? `${line} — ${detail}` : line);
  return pass;
}

async function countResidual(client, table, typeCol, idCol, partnershipId) {
  const res = await client.query(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE ${typeCol}='partnership' AND ${idCol}=$1`,
    [partnershipId]
  );
  return res.rows[0].n;
}

async function countGlobalOrphans(client, table, typeCol, idCol) {
  const res = await client.query(
    `SELECT COUNT(*)::int AS n
     FROM ${table}
     WHERE ${typeCol} = 'account'
       AND NOT EXISTS (
         SELECT 1 FROM accounts a WHERE a.id = ${table}.${idCol}
       )`
  );
  return res.rows[0].n;
}

async function countDedicatedResidual(client, table, partnerCol, partnershipId) {
  const res = await client.query(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE ${partnerCol}=$1`,
    [partnershipId]
  );
  return res.rows[0].n;
}

async function countDedicatedOrphans(client, table, accountCol) {
  const res = await client.query(
    `SELECT COUNT(*)::int AS n
     FROM ${table}
     WHERE ${accountCol} IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM accounts a WHERE a.id = ${table}.${accountCol}
       )`
  );
  return res.rows[0].n;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  const runAt = new Date().toISOString();
  let totalChecks = 0;
  let failedChecks = 0;

  function rec(pass) {
    totalChecks++;
    if (!pass) failedChecks++;
    return pass;
  }

  console.log("=".repeat(62));
  console.log("VoltSafe Cortex — Post-Cutover Audit (Step E)");
  console.log("=".repeat(62));
  console.log(`  Batch ID : ${BATCH_ID}`);
  console.log(`  Run at   : ${runAt}`);
  console.log("=".repeat(62));

  try {
    // ── Fetch batch rows ───────────────────────────────────────────────────────
    const logRes = await client.query(
      `SELECT id AS log_id, source_id, target_id, migration_status,
              migrated_at, verified_at, children_migrated_at, error_message
       FROM migration_log
       WHERE batch_id = $1
       ORDER BY source_id`,
      [BATCH_ID]
    );
    const rows = logRes.rows;

    if (rows.length === 0) {
      console.log(`\nNo migration_log rows found for batch "${BATCH_ID}".`);
      console.log("Run migrate-partnerships.js first.");
      process.exit(1);
    }

    console.log(`\n  Rows in batch : ${rows.length}`);
    console.log(`  Statuses      : ${[...new Set(rows.map(r => r.migration_status))].join(", ")}`);

    // ════════════════════════════════════════════════════════════════════════
    // GROUP 1 — Account linkage
    // ════════════════════════════════════════════════════════════════════════
    console.log("\n" + "─".repeat(62));
    console.log("GROUP 1 — Account Linkage");
    console.log("─".repeat(62));
    console.log("  Confirms each partnership maps to a valid, correctly-configured account.\n");

    const g1Results = [];

    for (const row of rows) {
      console.log(`  [partnerships.id=${row.source_id} → accounts.id=${row.target_id}]`);

      const pRes = await client.query(`SELECT * FROM partnerships WHERE id=$1`, [row.source_id]);
      const aRes = await client.query(`SELECT * FROM accounts     WHERE id=$1`, [row.target_id]);
      const p = pRes.rows[0];
      const a = aRes.rows[0];

      const checks = [
        // 1.1  Account exists
        rec(check("account exists in accounts table",
          !!a,
          `accounts.id=${row.target_id} not found`)),

        // 1.2  Name matches
        rec(check("account name matches partnership name",
          !!a && !!p && a.name?.trim().toLowerCase() === p.name?.trim().toLowerCase(),
          a ? `account.name="${a.name}" vs partnership.name="${p?.name}"` : "account missing")),

        // 1.3  converted_from_partnership_id back-ref
        rec(check("account.converted_from_partnership_id is correct",
          !!a && a.converted_from_partnership_id === row.source_id,
          a ? `got ${a.converted_from_partnership_id}, expected ${row.source_id}` : "account missing")),

        // 1.4  org_type populated
        rec(check("account.org_type is set",
          !!a && !!(a.org_type?.trim()),
          "org_type is null or empty")),

        // 1.5  segment populated
        rec(check("account.segment is set",
          !!a && !!(a.segment?.trim()),
          "segment is null or empty")),

        // 1.6  Partnership migration_status is a valid migrated state
        rec(check("partnership.migration_status is a migrated state",
          !!p && ["migrated", "verified", "children_migrated", "complete"].includes(p.migration_status),
          p ? `got "${p.migration_status}"` : "partnership row missing")),

        // 1.7  Partnership.migrated_account_id matches target
        rec(check("partnership.migrated_account_id matches target account",
          !!p && p.migrated_account_id === row.target_id,
          p ? `got ${p.migrated_account_id}, expected ${row.target_id}` : "partnership row missing")),

        // 1.8  Partnership.migration_batch_id matches
        rec(check("partnership.migration_batch_id matches this batch",
          !!p && p.migration_batch_id === BATCH_ID,
          p ? `got "${p.migration_batch_id}"` : "partnership row missing")),
      ];

      const rowPass = checks.every(Boolean);
      g1Results.push({ sourceId: row.source_id, targetId: row.target_id, pass: rowPass });
      console.log(`    → ${rowPass ? "PASS" : "FAIL"}\n`);
    }

    // ════════════════════════════════════════════════════════════════════════
    // GROUP 2 — Lifecycle completeness
    // ════════════════════════════════════════════════════════════════════════
    console.log("─".repeat(62));
    console.log("GROUP 2 — Lifecycle Completeness");
    console.log("─".repeat(62));
    console.log("  Confirms migration_log timestamps and final status are set.\n");

    const g2Results = [];

    for (const row of rows) {
      console.log(`  [log_id=${row.log_id}] partnerships.id=${row.source_id}`);

      const checks = [
        // 2.1  Status is fully completed
        rec(check("migration_status is 'children_migrated' or 'complete'",
          COMPLETED_STATUSES.includes(row.migration_status),
          `got "${row.migration_status}"`)),

        // 2.2  migrated_at set
        rec(check("migrated_at timestamp is set",
          !!row.migrated_at,
          "migrated_at is null — Step A may not have completed")),

        // 2.3  verified_at set
        rec(check("verified_at timestamp is set",
          !!row.verified_at,
          "verified_at is null — Step B may not have completed")),

        // 2.4  children_migrated_at set
        rec(check("children_migrated_at timestamp is set",
          !!row.children_migrated_at,
          "children_migrated_at is null — Step C may not have completed")),

        // 2.5  No error_message
        rec(check("no error_message recorded",
          !row.error_message,
          row.error_message ? `error: "${row.error_message}"` : null)),
      ];

      const rowPass = checks.every(Boolean);
      g2Results.push({ logId: row.log_id, sourceId: row.source_id, pass: rowPass });
      console.log(`    → ${rowPass ? "PASS" : "FAIL"}\n`);
    }

    // ════════════════════════════════════════════════════════════════════════
    // GROUP 3 — No residual children on partnership side
    // ════════════════════════════════════════════════════════════════════════
    console.log("─".repeat(62));
    console.log("GROUP 3 — No Residual Children on Partnership Side");
    console.log("─".repeat(62));
    console.log("  Confirms zero child rows still attached to source partnership IDs.\n");

    const g3Results = [];

    for (const row of rows) {
      console.log(`  [partnerships.id=${row.source_id}] — checking all ${POLYMORPHIC_CHILDREN.length + DEDICATED_CHILDREN.length} child tables`);

      const tableResults = [];

      for (const c of POLYMORPHIC_CHILDREN) {
        const n = await countResidual(client, c.table, c.typeCol, c.idCol, row.source_id);
        const pass = n === 0;
        rec(check(`${c.table} — ${n} partnership-linked row(s) remaining`, pass,
          `${n} row(s) still have ${c.typeCol}='partnership' AND ${c.idCol}=${row.source_id}`));
        tableResults.push(pass);
      }

      for (const c of DEDICATED_CHILDREN) {
        const n = await countDedicatedResidual(client, c.table, c.partnerCol, row.source_id);
        const pass = n === 0;
        rec(check(`${c.table}.${c.partnerCol} — ${n} row(s) still set`, pass,
          `${n} row(s) still have ${c.partnerCol}=${row.source_id}`));
        tableResults.push(pass);
      }

      const rowPass = tableResults.every(Boolean);
      g3Results.push({ sourceId: row.source_id, pass: rowPass });
      console.log(`    → ${rowPass ? "PASS" : "FAIL"}\n`);
    }

    // ════════════════════════════════════════════════════════════════════════
    // GROUP 4 — No orphan children introduced (global scan)
    // ════════════════════════════════════════════════════════════════════════
    console.log("─".repeat(62));
    console.log("GROUP 4 — No Orphan Children Introduced (Global)");
    console.log("─".repeat(62));
    console.log("  Global scan: child rows pointing to accounts that do not exist.\n");

    const g4Results = [];

    console.log("  Polymorphic tables (type='account' AND account missing):");
    for (const c of POLYMORPHIC_CHILDREN) {
      const n = await countGlobalOrphans(client, c.table, c.typeCol, c.idCol);
      const pass = n === 0;
      rec(check(`${c.table} — ${n} orphaned account-linked row(s)`, pass,
        `${n} row(s) with ${c.typeCol}='account' point to non-existent account`));
      g4Results.push(pass);
    }

    console.log("\n  Dedicated column tables (account_id set but account missing):");
    for (const c of DEDICATED_CHILDREN) {
      const n = await countDedicatedOrphans(client, c.table, c.accountCol);
      const pass = n === 0;
      rec(check(`${c.table}.${c.accountCol} — ${n} orphaned row(s)`, pass,
        `${n} row(s) with ${c.accountCol} pointing to non-existent account`));
      g4Results.push(pass);

      // Also confirm no dangling primary_partner_id for batch source IDs
      for (const row of rows) {
        const n2 = await countDedicatedResidual(client, c.table, c.partnerCol, row.source_id);
        const pass2 = n2 === 0;
        rec(check(`${c.table}.${c.partnerCol} — ${n2} dangling ref(s) to partnership ${row.source_id}`, pass2,
          `${n2} thread(s) still have ${c.partnerCol}=${row.source_id}`));
        g4Results.push(pass2);
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // FINAL VERDICT
    // ════════════════════════════════════════════════════════════════════════
    const allPass = failedChecks === 0;

    console.log("\n" + "=".repeat(62));
    console.log("AUDIT VERDICT");
    console.log("=".repeat(62));
    console.log(`  Batch ID       : ${BATCH_ID}`);
    console.log(`  Rows audited   : ${rows.length}`);
    console.log(`  Total checks   : ${totalChecks}`);
    console.log(`  Passed         : ${totalChecks - failedChecks}`);
    console.log(`  Failed         : ${failedChecks}`);
    console.log("");

    // Group summaries
    const g1Fail = g1Results.filter(r => !r.pass).length;
    const g2Fail = g2Results.filter(r => !r.pass).length;
    const g3Fail = g3Results.filter(r => !r.pass).length;
    const g4Fail = g4Results.filter(r => !r).length;

    console.log(`  Group 1  Account Linkage          : ${g1Fail === 0 ? "PASS" : `FAIL (${g1Fail} row(s))`}`);
    console.log(`  Group 2  Lifecycle Completeness   : ${g2Fail === 0 ? "PASS" : `FAIL (${g2Fail} row(s))`}`);
    console.log(`  Group 3  No Residual Children     : ${g3Fail === 0 ? "PASS" : `FAIL (${g3Fail} row(s))`}`);
    console.log(`  Group 4  No Orphan Children       : ${g4Fail === 0 ? "PASS" : `FAIL (${g4Fail} check(s))`}`);

    console.log("");
    if (allPass) {
      console.log("  ██████████████████████████████████████████████████████████");
      console.log("  ██                                                      ██");
      console.log("  ██   ✓  AUDIT PASSED — batch is fully cutover-ready    ██");
      console.log("  ██                                                      ██");
      console.log("  ██████████████████████████████████████████████████████████");
    } else {
      console.log("  ██████████████████████████████████████████████████████████");
      console.log("  ██                                                      ██");
      console.log("  ██   ✗  AUDIT FAILED — investigate failures above      ██");
      console.log("  ██                                                      ██");
      console.log("  ██████████████████████████████████████████████████████████");
    }

    console.log("");
    process.exit(allPass ? 0 : 1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error("\nFatal error:", err.message);
  process.exit(1);
});
