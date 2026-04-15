#!/usr/bin/env node
/**
 * VoltSafe Cortex — Child Relink Runner (Step C)
 *
 * Usage:
 *   node scripts/relink-children.js --batchId phase2-batch3-20260415 [--dryRun]
 *
 * Operates only on migration_log rows with migration_status='verified'.
 *
 * Relinks ALL child relationships from partnership → account for each mapping:
 *
 *   Polymorphic (linked_object_type / linked_object_id):
 *     notes, attachments, activities, comments, tasks,
 *     email_associations, calendar_events, record_tags
 *
 *   Dedicated column pair:
 *     email_threads  (primary_partner_id → primary_account_id)
 *
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

// ── Child table definitions ──────────────────────────────────────────────────
//
// POLYMORPHIC tables — rows that store (object_type, object_id) or
// (linked_object_type, linked_object_id).  We rewrite type='partnership' →
// type='account' and id=partnership_id → id=account_id.
//
// DEDICATED tables — rows that hold an explicit partnership FK in one column
// and the matching account FK in another.  We NULL the partnership column and
// set the account column.
//
const POLYMORPHIC_CHILDREN = [
  // table              type_col               id_col
  { table: "notes",             typeCol: "linked_object_type", idCol: "linked_object_id" },
  { table: "attachments",       typeCol: "object_type",        idCol: "object_id"        },
  { table: "activities",        typeCol: "linked_object_type", idCol: "linked_object_id" },
  { table: "comments",          typeCol: "object_type",        idCol: "object_id"        },
  { table: "tasks",             typeCol: "linked_object_type", idCol: "linked_object_id" },
  { table: "email_associations",typeCol: "object_type",        idCol: "object_id"        },
  { table: "calendar_events",   typeCol: "linked_object_type", idCol: "linked_object_id" },
  { table: "record_tags",       typeCol: "record_type",        idCol: "record_id"        },
];

// email_threads has a dedicated column pair instead of a polymorphic pattern.
// primary_partner_id → NULL  +  primary_account_id → account_id
// (only sets primary_account_id if it is currently NULL to avoid overwriting
//  a legitimate account association that arrived separately)
const DEDICATED_CHILDREN = [
  {
    table:        "email_threads",
    partnerCol:   "primary_partner_id",
    accountCol:   "primary_account_id",
  },
];

// ── Count helpers ─────────────────────────────────────────────────────────────

async function countPolymorphic(client, table, typeCol, idCol, type, id) {
  const res = await client.query(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE ${typeCol}=$1 AND ${idCol}=$2`,
    [type, id]
  );
  return res.rows[0].n;
}

async function countDedicated(client, table, col, id) {
  const res = await client.query(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE ${col}=$1`,
    [id]
  );
  return res.rows[0].n;
}

async function getAllBefore(client, partnershipId) {
  const counts = {};
  for (const c of POLYMORPHIC_CHILDREN) {
    counts[c.table] = await countPolymorphic(
      client, c.table, c.typeCol, c.idCol, "partnership", partnershipId
    );
  }
  for (const c of DEDICATED_CHILDREN) {
    counts[`${c.table}.${c.partnerCol}`] = await countDedicated(
      client, c.table, c.partnerCol, partnershipId
    );
  }
  return counts;
}

async function getAllAfterAccount(client, accountId) {
  const counts = {};
  for (const c of POLYMORPHIC_CHILDREN) {
    counts[c.table] = await countPolymorphic(
      client, c.table, c.typeCol, c.idCol, "account", accountId
    );
  }
  for (const c of DEDICATED_CHILDREN) {
    counts[`${c.table}.${c.accountCol}`] = await countDedicated(
      client, c.table, c.accountCol, accountId
    );
  }
  return counts;
}

// ── Main ──────────────────────────────────────────────────────────────────────

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

      // Before counts (all child tables)
      const before = await getAllBefore(client, row.source_id);
      const totalBefore = Object.values(before).reduce((s, n) => s + n, 0);

      console.log(`    Before (partnership ${row.source_id}):`);
      for (const [key, n] of Object.entries(before)) {
        if (n > 0) console.log(`      ${key}: ${n}`);
      }
      if (totalBefore === 0) console.log(`      (no children to relink)`);

      if (DRY_RUN) {
        const nonZero = Object.entries(before).filter(([, n]) => n > 0);
        if (nonZero.length > 0) {
          console.log(`    [DRY RUN] Would relink:`);
          nonZero.forEach(([key, n]) => console.log(`      ${key}: ${n} row(s)`));
        } else {
          console.log(`    [DRY RUN] Nothing to relink`);
        }
        report.succeeded++;
        report.rows.push({ sourceId: row.source_id, targetId: row.target_id, before, after: null, status: "would_relink (dry run)" });
        continue;
      }

      try {
        const relinked = {};

        // ── Polymorphic children ─────────────────────────────────────────────
        for (const c of POLYMORPHIC_CHILDREN) {
          const res = await client.query(
            `UPDATE ${c.table}
             SET ${c.typeCol} = 'account', ${c.idCol} = $1
             WHERE ${c.typeCol} = 'partnership' AND ${c.idCol} = $2
             RETURNING id`,
            [row.target_id, row.source_id]
          );
          relinked[c.table] = res.rowCount;
        }

        // ── Dedicated column pair: email_threads ─────────────────────────────
        for (const c of DEDICATED_CHILDREN) {
          const res = await client.query(
            `UPDATE ${c.table}
             SET ${c.partnerCol} = NULL,
                 ${c.accountCol} = COALESCE(${c.accountCol}, $1)
             WHERE ${c.partnerCol} = $2
             RETURNING id`,
            [row.target_id, row.source_id]
          );
          relinked[`${c.table}.${c.partnerCol}`] = res.rowCount;
        }

        // After counts
        const after     = await getAllAfterAccount(client, row.target_id);
        const oldCounts = await getAllBefore(client, row.source_id); // should all be 0

        const oldTotal = Object.values(oldCounts).reduce((s, n) => s + n, 0);

        // Print moved rows
        const moved = Object.entries(relinked).filter(([, n]) => n > 0);
        if (moved.length > 0) {
          console.log(`    Relinked:`);
          moved.forEach(([key, n]) => console.log(`      ${key}: ${n} row(s)`));
        } else {
          console.log(`    Relinked: (nothing to move)`);
        }

        // Validate: old partnership counts must all be 0
        const valid = oldTotal === 0;
        console.log(`    Validation: ${valid ? "✓ PASS" : "✗ FAIL — old counts not zero"}`);

        if (!valid) {
          const residual = Object.entries(oldCounts)
            .filter(([, n]) => n > 0)
            .map(([k, n]) => `${k}=${n}`)
            .join(", ");
          const msg = `residual rows still on partnership ${row.source_id}: ${residual}`;
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

    // ── Global orphan check ────────────────────────────────────────────────────
    if (!DRY_RUN) {
      console.log(`\n  Global orphan check (partnership-typed rows pointing to deleted partnerships):`);
      let anyOrphans = false;
      for (const c of POLYMORPHIC_CHILDREN) {
        const res = await client.query(
          `SELECT COUNT(*)::int AS n FROM ${c.table}
           WHERE ${c.typeCol} = 'partnership'
             AND NOT EXISTS (SELECT 1 FROM partnerships p WHERE p.id = ${c.table}.${c.idCol})`
        );
        const n = res.rows[0].n;
        if (n > 0) {
          console.log(`    ✗ ${c.table}: ${n} orphaned row(s)`);
          anyOrphans = true;
        }
      }
      for (const c of DEDICATED_CHILDREN) {
        const res = await client.query(
          `SELECT COUNT(*)::int AS n FROM ${c.table}
           WHERE ${c.partnerCol} IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM partnerships p WHERE p.id = ${c.table}.${c.partnerCol})`
        );
        const n = res.rows[0].n;
        if (n > 0) {
          console.log(`    ✗ ${c.table}.${c.partnerCol}: ${n} orphaned row(s)`);
          anyOrphans = true;
        }
      }
      if (!anyOrphans) console.log(`    ✓ No orphans found across all child tables`);
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
      console.log(`  [${r.sourceId}→${r.targetId}] ${r.status}`);
      if (r.before) {
        const nonZero = Object.entries(r.before).filter(([, n]) => n > 0);
        if (nonZero.length > 0) {
          nonZero.forEach(([key, n]) => {
            const afterN = r.after ? (r.after[key] ?? "?") : "(no write)";
            console.log(`    ${key}: ${n}→${afterN}`);
          });
        } else {
          console.log(`    (no children)`);
        }
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

    let step = 1;
    for (const c of POLYMORPHIC_CHILDREN) {
      console.log(`-- ${step}. Restore ${c.table} to partnerships:`);
      for (const r of rows) {
        console.log(
          `UPDATE ${c.table} SET ${c.typeCol}='partnership', ${c.idCol}=${r.source_id}` +
          ` WHERE ${c.typeCol}='account' AND ${c.idCol}=${r.target_id};`
        );
      }
      step++;
    }

    for (const c of DEDICATED_CHILDREN) {
      console.log(`-- ${step}. Restore ${c.table} dedicated column pair:`);
      for (const r of rows) {
        console.log(
          `UPDATE ${c.table} SET ${c.partnerCol}=${r.source_id}, ${c.accountCol}=NULL` +
          ` WHERE ${c.accountCol}=${r.target_id} AND ${c.partnerCol} IS NULL;`
        );
      }
      step++;
    }

    console.log(`-- ${step}. Reset migration_log:`);
    console.log(
      `UPDATE migration_log SET migration_status='verified', children_migrated_at=NULL, error_message=NULL` +
      ` WHERE batch_id='${BATCH_ID}' AND migration_status='children_migrated';`
    );
    step++;

    console.log(`-- ${step}. Reset partnerships:`);
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
