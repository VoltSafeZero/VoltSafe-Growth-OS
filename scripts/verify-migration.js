#!/usr/bin/env node
/**
 * VoltSafe Cortex — Migration Verification Runner (Step B)
 *
 * Usage:
 *   node scripts/verify-migration.js --batchId phase2-batch3-20260415
 *
 * Processes all migration_log rows with migration_status='migrated' for the batch.
 * Runs 8 checks per row; marks passing rows 'verified', records failure messages.
 *
 * Checks performed:
 *   1. Target account exists
 *   2. converted_from_partnership_id matches source partnership id
 *   3. org_type is set (non-null/empty)
 *   4. name is populated
 *   5. segment is populated
 *   6. partnership.migration_status reflects a migrated state
 *   7. partnership.migrated_account_id matches target
 *   8. partnership.migration_batch_id matches this batch
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
  console.error("Usage: node scripts/verify-migration.js --batchId <batch_id>");
  process.exit(1);
}

const BATCH_ID = args.batchId;
const MIGRATED_STATUSES = ["migrated", "verified", "children_migrated", "complete"];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  console.log("=".repeat(62));
  console.log("VoltSafe Cortex — Verification Runner (Step B)");
  console.log("=".repeat(62));
  console.log(`  Batch ID: ${BATCH_ID}`);
  console.log("=".repeat(62));

  try {
    // Fetch rows to verify
    const logRes = await client.query(
      `SELECT id AS log_id, source_id, target_id, migration_status
       FROM migration_log
       WHERE batch_id = $1 AND migration_status = 'migrated'
       ORDER BY source_id`,
      [BATCH_ID]
    );
    const logRows = logRes.rows;

    if (logRows.length === 0) {
      // Check other states for this batch
      const summaryRes = await client.query(
        `SELECT migration_status, COUNT(*)::int AS n
         FROM migration_log WHERE batch_id = $1
         GROUP BY migration_status ORDER BY migration_status`,
        [BATCH_ID]
      );
      if (summaryRes.rows.length === 0) {
        console.log(`\nNo migration_log rows found for batch "${BATCH_ID}".`);
        console.log("Run migrate-partnerships.js first.");
      } else {
        console.log(`\nNo 'migrated' rows to verify. Current batch status:`);
        summaryRes.rows.forEach(r => console.log(`  ${r.migration_status}: ${r.n}`));
      }
      process.exit(0);
    }

    console.log(`\nRows to verify: ${logRows.length}\n`);

    const report = { total: logRows.length, verified: 0, failed: 0, rows: [] };

    for (const log of logRows) {
      console.log(`  ── [partnerships.id=${log.source_id} → accounts.id=${log.target_id}] ──`);

      const checks = [];
      const errors = [];

      // Fetch source and target
      const pRes = await client.query(`SELECT * FROM partnerships WHERE id = $1`, [log.source_id]);
      const aRes = await client.query(`SELECT * FROM accounts WHERE id = $1`, [log.target_id]);
      const p = pRes.rows[0];
      const a = aRes.rows[0];

      // Check 1: account exists
      const c1 = !!a;
      checks.push({ name: "account_exists", pass: c1 });
      if (!c1) errors.push("Target account not found in accounts table");

      if (a) {
        // Check 2: converted_from_partnership_id
        const c2 = a.converted_from_partnership_id === log.source_id;
        checks.push({ name: "source_link_correct", pass: c2 });
        if (!c2) errors.push(
          `converted_from_partnership_id=${a.converted_from_partnership_id} (expected ${log.source_id})`
        );

        // Check 3: org_type set
        const c3 = !!(a.org_type && a.org_type.trim());
        checks.push({ name: "org_type_populated", pass: c3 });
        if (!c3) errors.push("org_type is null or empty");

        // Check 4: name populated
        const c4 = !!(a.name && a.name.trim());
        checks.push({ name: "name_populated", pass: c4 });
        if (!c4) errors.push("name is null or empty");

        // Check 5: segment populated
        const c5 = !!(a.segment && a.segment.trim());
        checks.push({ name: "segment_populated", pass: c5 });
        if (!c5) errors.push("segment is null or empty");
      }

      // Checks 6–8: partnership row state
      const c6 = p && MIGRATED_STATUSES.includes(p.migration_status);
      checks.push({ name: "partnership_status_updated", pass: !!c6 });
      if (!c6) errors.push(
        `partnership.migration_status="${p?.migration_status}" (expected one of: ${MIGRATED_STATUSES.join(",")})`
      );

      const c7 = p && p.migrated_account_id === log.target_id;
      checks.push({ name: "partnership_back_ref_correct", pass: !!c7 });
      if (!c7) errors.push(
        `partnership.migrated_account_id=${p?.migrated_account_id} (expected ${log.target_id})`
      );

      const c8 = p && p.migration_batch_id === BATCH_ID;
      checks.push({ name: "batch_id_match", pass: !!c8 });
      if (!c8) errors.push(
        `partnership.migration_batch_id="${p?.migration_batch_id}" (expected "${BATCH_ID}")`
      );

      // Print check results
      checks.forEach(c => console.log(`    ${c.pass ? "✓" : "✗"} ${c.name}`));

      const allPass = checks.every(c => c.pass);

      if (allPass) {
        await client.query(
          `UPDATE migration_log
           SET migration_status = 'verified', verified_at = NOW()
           WHERE id = $1`,
          [log.log_id]
        );
        console.log(`    → marked verified`);
        report.verified++;
        report.rows.push({
          sourceId: log.source_id, targetId: log.target_id,
          status: "verified",
          checks: checks.map(c => c.name),
        });
      } else {
        const errMsg = errors.join("; ");
        await client.query(
          `UPDATE migration_log SET error_message = $1 WHERE id = $2`,
          [errMsg, log.log_id]
        );
        console.log(`    → FAILED: ${errMsg}`);
        report.failed++;
        report.rows.push({
          sourceId: log.source_id, targetId: log.target_id,
          status: "failed", errors,
        });
      }
    }

    // ── Report ────────────────────────────────────────────────────────────────
    console.log("\n" + "=".repeat(62));
    console.log("Step B — Verification Report");
    console.log("=".repeat(62));
    console.log(`  Total   : ${report.total}`);
    console.log(`  Verified: ${report.verified}`);
    console.log(`  Failed  : ${report.failed}`);

    if (report.failed > 0) {
      console.log("\n  FAILURES (must be resolved before Step C):");
      report.rows
        .filter(r => r.status === "failed")
        .forEach(r => {
          console.log(`    [${r.sourceId}→${r.targetId}]`);
          (r.errors || []).forEach(e => console.log(`      • ${e}`));
        });
    }

    if (report.verified > 0 && report.failed === 0) {
      console.log(`\nNext step:`);
      console.log(`  node scripts/relink-children.js --batchId ${BATCH_ID} --dryRun`);
      console.log(`  node scripts/relink-children.js --batchId ${BATCH_ID}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error("\nFatal error:", err.message);
  process.exit(1);
});
