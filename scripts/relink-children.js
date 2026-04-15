#!/usr/bin/env node
/**
 * VoltSafe Cortex — Child Relink Runner (Step C)
 *
 * Usage:
 *   node scripts/relink-children.js --batchId phase2-batch3-20260415 [--dryRun]
 *
 * Operates only on migration_log rows with migration_status='verified'.
 * Relinks notes and attachments from partnership → account for each mapping.
 * Validates before/after counts. Prints rollback SQL on completion.
 * Updates statuses to 'children_migrated' on success.
 *
 * Safe to run with --dryRun first — shows what would be relinked, no writes.
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
  console.error("Usage: node scripts/relink-children.js --batchId <batch_id> [--dryRun]");
  process.exit(1);
}

const BATCH_ID = args.batchId;
const DRY_RUN  = !!args.dryRun;

async function getCounts(client, objectType, objectId) {
  const n = await client.query(
    `SELECT COUNT(*)::int AS n FROM notes WHERE linked_object_type=$1 AND linked_object_id=$2`,
    [objectType, objectId]
  );
  const a = await client.query(
    `SELECT COUNT(*)::int AS n FROM attachments WHERE object_type=$1 AND object_id=$2`,
    [objectType, objectId]
  );
  return { notes: n.rows[0].n, attachments: a.rows[0].n };
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  console.log("=".repeat(62));
  console.log("VoltSafe Cortex — Child Relink Runner (Step C)");
  console.log("=".repeat(62));
  console.log(`  Batch ID: ${BATCH_ID}`);
  console.log(`  Dry Run : ${DRY_RUN ? "YES — no writes" : "NO — will write to DB"}`);
  console.log("=".repeat(62));

  try {
    // Fetch verified rows for this batch
    const logRes = await client.query(
      `SELECT id AS log_id, source_id, target_id
       FROM migration_log
       WHERE batch_id = $1 AND migration_status = 'verified'
       ORDER BY source_id`,
      [BATCH_ID]
    );
    const rows = logRes.rows;

    if (rows.length === 0) {
      const summaryRes = await client.query(
        `SELECT migration_status, COUNT(*)::int AS n
         FROM migration_log WHERE batch_id = $1
         GROUP BY migration_status`,
        [BATCH_ID]
      );
      if (summaryRes.rows.length === 0) {
        console.log(`\nNo rows found for batch "${BATCH_ID}".`);
        console.log("Run migrate-partnerships.js then verify-migration.js first.");
      } else {
        console.log(`\nNo 'verified' rows found. Current batch status:`);
        summaryRes.rows.forEach(r => console.log(`  ${r.migration_status}: ${r.n}`));
        console.log("Run verify-migration.js first.");
      }
      process.exit(0);
    }

    console.log(`\nVerified rows to process: ${rows.length}\n`);

    const report = { total: rows.length, succeeded: 0, failed: 0, rows: [] };

    for (const row of rows) {
      console.log(
        `  ── [partnerships.id=${row.source_id} → accounts.id=${row.target_id}] ──`
      );

      // Before counts
      const before = await getCounts(client, "partnership", row.source_id);
      console.log(`    Before: notes=${before.notes}  attachments=${before.attachments}`);

      if (DRY_RUN) {
        console.log(`    [DRY RUN] Would relink ${before.notes} note(s) and ${before.attachments} attachment(s)`);
        report.succeeded++;
        report.rows.push({ sourceId: row.source_id, targetId: row.target_id, before, after: null, status: "would_relink (dry run)" });
        continue;
      }

      try {
        // Relink notes
        const notesUpdate = await client.query(
          `UPDATE notes
           SET linked_object_type = 'account', linked_object_id = $1
           WHERE linked_object_type = 'partnership' AND linked_object_id = $2
           RETURNING id`,
          [row.target_id, row.source_id]
        );

        // Relink attachments
        const attachUpdate = await client.query(
          `UPDATE attachments
           SET object_type = 'account', object_id = $1
           WHERE object_type = 'partnership' AND object_id = $2
           RETURNING id`,
          [row.target_id, row.source_id]
        );

        // After counts
        const after    = await getCounts(client, "account",      row.target_id);
        const oldCount = await getCounts(client, "partnership",  row.source_id);

        console.log(`    Relinked: notes=${notesUpdate.rowCount}  attachments=${attachUpdate.rowCount}`);
        console.log(`    After (account): notes=${after.notes}  attachments=${after.attachments}`);

        // Validate
        const valid = (
          oldCount.notes        === 0             &&
          oldCount.attachments  === 0             &&
          after.notes           === before.notes  &&
          after.attachments     === before.attachments
        );
        console.log(`    Validation: ${valid ? "✓ PASS" : "✗ FAIL"}`);

        if (!valid) {
          const msg = [
            `old partnership counts not zero (notes=${oldCount.notes} attach=${oldCount.attachments})`,
            `new account counts: notes=${after.notes}/${before.notes} attach=${after.attachments}/${before.attachments}`,
          ].join("; ");
          await client.query(
            `UPDATE migration_log SET error_message = $1 WHERE id = $2`,
            [msg, row.log_id]
          );
          report.failed++;
          report.rows.push({ sourceId: row.source_id, targetId: row.target_id, before, after, status: "failed", error: msg });
          continue;
        }

        // Update statuses
        await client.query(
          `UPDATE migration_log
           SET migration_status = 'children_migrated', children_migrated_at = NOW()
           WHERE id = $1`,
          [row.log_id]
        );
        await client.query(
          `UPDATE partnerships SET migration_status = 'children_migrated' WHERE id = $1`,
          [row.source_id]
        );

        report.succeeded++;
        report.rows.push({ sourceId: row.source_id, targetId: row.target_id, before, after, status: "children_migrated" });
      } catch (err) {
        console.error(`    ERROR: ${err.message}`);
        report.failed++;
        report.rows.push({ sourceId: row.source_id, targetId: row.target_id, before, status: "failed", error: err.message });
      }
    }

    // Global orphan check
    if (!DRY_RUN) {
      const orphanNotes = await client.query(
        `SELECT COUNT(*)::int AS n FROM notes n
         WHERE n.linked_object_type = 'partnership'
           AND NOT EXISTS (SELECT 1 FROM partnerships p WHERE p.id = n.linked_object_id)`
      );
      const orphanAttach = await client.query(
        `SELECT COUNT(*)::int AS n FROM attachments a
         WHERE a.object_type = 'partnership'
           AND NOT EXISTS (SELECT 1 FROM partnerships p WHERE p.id = a.object_id)`
      );
      console.log(
        `\n  Orphan check: notes=${orphanNotes.rows[0].n}  attachments=${orphanAttach.rows[0].n}` +
        (orphanNotes.rows[0].n === 0 && orphanAttach.rows[0].n === 0 ? " ✓" : " ✗ INVESTIGATE")
      );
    }

    // ── Report ────────────────────────────────────────────────────────────────
    console.log("\n" + "=".repeat(62));
    console.log("Step C — Child Relink Report");
    console.log("=".repeat(62));
    console.log(`  Total     : ${report.total}`);
    console.log(`  Succeeded : ${report.succeeded}`);
    console.log(`  Failed    : ${report.failed}`);
    console.log("");

    for (const r of report.rows) {
      const before = r.before || {};
      const after  = r.after  || {};
      console.log(`  [${r.sourceId}→${r.targetId}] ${r.status}`);
      if (r.before != null) {
        const noteArrow   = r.after != null ? `${before.notes}→${after.notes ?? "?"}` : `${before.notes} (no write)`;
        const attachArrow = r.after != null ? `${before.attachments}→${after.attachments ?? "?"}` : `${before.attachments} (no write)`;
        console.log(`    notes: ${noteArrow}  |  attachments: ${attachArrow}`);
      }
      if (r.error) console.log(`    ERROR: ${r.error}`);
    }

    if (report.succeeded > 0 && report.failed === 0 && !DRY_RUN) {
      console.log(`\nNext step: perform Step D cutover — see docs/MIGRATION_CUTOVER.md`);
    }

    // ── Rollback SQL ──────────────────────────────────────────────────────────
    console.log("\n" + "-".repeat(62));
    console.log("ROLLBACK SQL (run manually if cutover needs reverting):");
    console.log("-".repeat(62));
    console.log("-- 1. Restore notes to partnerships:");
    for (const r of rows) {
      console.log(
        `UPDATE notes SET linked_object_type='partnership', linked_object_id=${r.source_id}` +
        ` WHERE linked_object_type='account' AND linked_object_id=${r.target_id};`
      );
    }
    console.log("-- 2. Restore attachments to partnerships:");
    for (const r of rows) {
      console.log(
        `UPDATE attachments SET object_type='partnership', object_id=${r.source_id}` +
        ` WHERE object_type='account' AND object_id=${r.target_id};`
      );
    }
    console.log("-- 3. Reset migration_log:");
    console.log(
      `UPDATE migration_log SET migration_status='verified', children_migrated_at=NULL, error_message=NULL` +
      ` WHERE batch_id='${BATCH_ID}' AND migration_status='children_migrated';`
    );
    console.log("-- 4. Reset partnerships:");
    for (const r of rows) {
      console.log(`UPDATE partnerships SET migration_status='migrated' WHERE id=${r.source_id};`);
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
