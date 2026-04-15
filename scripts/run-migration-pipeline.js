#!/usr/bin/env node
/**
 * VoltSafe Cortex — Migration Pipeline Safety Wrapper
 *
 * Usage:
 *   node scripts/run-migration-pipeline.js \
 *     --category   research_academic \
 *     --orgType    research \
 *     --batchId    phase2-batch3-20260415 \
 *     [--partnerClass <cls>]
 *
 * This is a READ + DRY-RUN only wrapper. It never writes to the database.
 *
 * What it does:
 *   1. Runs Step A --dryRun  → shows what would migrate
 *   2. Checks migration_log for any existing rows in this batch and shows state
 *   3. Runs Step C --dryRun  → shows child relinks if verified rows exist
 *   4. Prints the exact live commands to execute in order
 *
 * Operators must run live commands manually. This script cannot trigger writes.
 */

import { execSync } from "child_process";
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

const REQUIRED = ["category", "orgType", "batchId"];
const missing = REQUIRED.filter(k => !args[k]);
if (missing.length) {
  console.error(`ERROR: Missing required args: ${missing.map(k => "--" + k).join(", ")}`);
  console.error(
    "Usage: node scripts/run-migration-pipeline.js --category <cat> --orgType <type> --batchId <id> [--partnerClass <cls>]"
  );
  process.exit(1);
}

const CATEGORY      = args.category;
const ORG_TYPE      = args.orgType;
const PARTNER_CLASS = args.partnerClass || null;
const BATCH_ID      = args.batchId;

const BASE_CMD = [
  `--category   ${CATEGORY}`,
  `--orgType    ${ORG_TYPE}`,
  PARTNER_CLASS ? `--partnerClass ${PARTNER_CLASS}` : null,
  `--batchId    ${BATCH_ID}`,
].filter(Boolean).join(" \\\n    ");

function divider(label) {
  console.log("\n" + "═".repeat(62));
  console.log(`  ${label}`);
  console.log("═".repeat(62));
}

function runScript(cmd) {
  try {
    execSync(cmd, { stdio: "inherit", env: process.env });
    return true;
  } catch {
    return false;
  }
}

async function getBatchState(client) {
  const res = await client.query(
    `SELECT migration_status, COUNT(*)::int AS n
     FROM migration_log WHERE batch_id = $1
     GROUP BY migration_status`,
    [BATCH_ID]
  );
  return Object.fromEntries(res.rows.map(r => [r.migration_status, r.n]));
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  const runAt = new Date().toISOString();

  console.log("╔" + "═".repeat(60) + "╗");
  console.log("║  VoltSafe Cortex — Migration Pipeline Safety Wrapper      ║");
  console.log("╚" + "═".repeat(60) + "╝");
  console.log(`  Category    : ${CATEGORY}`);
  console.log(`  Org Type    : ${ORG_TYPE}`);
  console.log(`  Partner Cls : ${PARTNER_CLASS ?? "(none)"}`);
  console.log(`  Batch ID    : ${BATCH_ID}`);
  console.log(`  Started     : ${runAt}`);
  console.log(`  Mode        : DRY RUN ONLY — no writes will occur`);
  console.log("─".repeat(62));

  try {
    // ── Current batch state ────────────────────────────────────────────────
    const state = await getBatchState(client);
    const statuses = Object.keys(state);

    if (statuses.length > 0) {
      console.log(`\n  ⚠ Batch "${BATCH_ID}" already has rows in migration_log:`);
      for (const [status, n] of Object.entries(state)) {
        console.log(`    ${status}: ${n}`);
      }
      if (state.complete) {
        console.log("\n  ✓ This batch is already COMPLETE. Nothing to run.");
        client.release();
        await pool.end();
        process.exit(0);
      }
    } else {
      console.log(`\n  Batch "${BATCH_ID}" has no existing migration_log rows — clean slate.`);
    }

    // ── Step A — Dry run ──────────────────────────────────────────────────
    divider("STEP A — Migration Dry Run (no writes)");
    const stepACmdDry = [
      "node scripts/migrate-partnerships.js",
      `    --category   ${CATEGORY}`,
      `    --orgType    ${ORG_TYPE}`,
      PARTNER_CLASS ? `    --partnerClass ${PARTNER_CLASS}` : null,
      `    --batchId    ${BATCH_ID}`,
      "    --dryRun",
    ].filter(Boolean).join(" \\\n");

    runScript(stepACmdDry.replace(/\s+/g, " ").trim());

    // ── Step C — Dry run (only if verified rows exist) ────────────────────
    const stateAfterA = await getBatchState(client);
    const hasVerified = !!(stateAfterA.verified);
    const hasMigrated = !!(stateAfterA.migrated);

    if (hasVerified) {
      divider("STEP C — Child Relink Dry Run (no writes)");
      console.log("  Found 'verified' rows — running Step C dry run.\n");
      runScript(`node scripts/relink-children.js --batchId ${BATCH_ID} --dryRun`);
    } else if (hasMigrated) {
      divider("STEP C — Child Relink Dry Run");
      console.log("  'migrated' rows found but not yet verified.");
      console.log("  Run Step B (verify) first, then re-run this wrapper to see Step C dry run.");
    } else {
      divider("STEP C — Child Relink Dry Run");
      console.log("  No verified rows in migration_log for this batch.");
      console.log("  Step C dry run will be available after Steps A + B complete.");
    }

    // ── Next steps: exact commands ─────────────────────────────────────────
    divider("NEXT STEPS — Copy-paste live commands in order");

    console.log("\n  1️  Step A — Live migration (run only after dry run looks correct):\n");
    console.log(`  node scripts/migrate-partnerships.js \\`);
    console.log(`    --category   ${CATEGORY} \\`);
    if (PARTNER_CLASS) console.log(`    --partnerClass ${PARTNER_CLASS} \\`);
    console.log(`    --orgType    ${ORG_TYPE} \\`);
    console.log(`    --batchId    ${BATCH_ID}`);

    console.log("\n  2️  Step B — Verify:\n");
    console.log(`  node scripts/verify-migration.js --batchId ${BATCH_ID}`);

    console.log("\n  3️  Step C — Relink children (dry run first):\n");
    console.log(`  node scripts/relink-children.js --batchId ${BATCH_ID} --dryRun`);
    console.log(`  node scripts/relink-children.js --batchId ${BATCH_ID}`);

    console.log("\n  4️  Step D — Mark complete after frontend cutover checklist:\n");
    console.log(`  psql "$DATABASE_URL" -c "UPDATE migration_log SET migration_status='complete' WHERE batch_id='${BATCH_ID}' AND migration_status='children_migrated';"`);
    console.log(`  psql "$DATABASE_URL" -c "UPDATE partnerships SET migration_status='complete' WHERE migration_batch_id='${BATCH_ID}' AND migration_status='children_migrated';"`);

    console.log("\n  5️  Step E — Post-cutover audit:\n");
    console.log(`  node scripts/post-cutover-audit.js --batchId ${BATCH_ID}`);

    console.log("\n" + "─".repeat(62));
    console.log(`  Finished    : ${new Date().toISOString()}`);
    console.log("─".repeat(62));
    console.log("\n  ✓ Pipeline wrapper complete. No writes were made.\n");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error("\nFatal error:", err.message);
  process.exit(1);
});
