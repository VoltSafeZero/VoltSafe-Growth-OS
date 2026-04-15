#!/usr/bin/env node
/**
 * VoltSafe Cortex — Partnership → Account Migration Runner (Step A)
 *
 * Usage:
 *   node scripts/migrate-partnerships.js \
 *     --category government \
 *     --orgType partner \
 *     --partnerClass funding \
 *     --batchId phase2-batch3-20260415 \
 *     [--dryRun] \
 *     [--ranByUserId 4]
 *
 * Required:
 *   --category     Source partnerships.category value  (e.g. government, strategic_industry)
 *   --orgType      Target accounts.org_type value      (e.g. partner, association, regulatory)
 *   --batchId      Unique batch ID — recommend: phase2-batchN-YYYYMMDD
 *
 * Optional:
 *   --partnerClass Target accounts.partner_class        (e.g. funding, strategic — omit for null)
 *   --dryRun       Preview changes without any DB writes
 *   --ranByUserId  User ID logged in migration_log     (default: 4)
 *
 * Duplicate detection criteria (any match → flagged, not auto-merged):
 *   - Exact or partial name match (case-insensitive)
 *   - Website domain match
 */


import pg from "pg";
const { Pool } = pg;

// ── Arg parsing ───────────────────────────────────────────────────────────────
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
    "Usage: node scripts/migrate-partnerships.js --category <cat> --orgType <type> --batchId <id> [--partnerClass <cls>] [--dryRun]"
  );
  process.exit(1);
}

const CATEGORY     = args.category;
const ORG_TYPE     = args.orgType;
const PARTNER_CLASS = args.partnerClass || null;
const BATCH_ID     = args.batchId;
const DRY_RUN      = !!args.dryRun;
const RAN_BY       = parseInt(args.ranByUserId || "4", 10);

// ── Segment inference (extend as new org_types are added) ─────────────────────
const SEGMENT_MAP = {
  partner:         "partner",
  association:     "association",
  regulatory:      "partner",
  research:        "partner",
  enterprise:      "marina_group",
  marina_prospect: "marina",
  marina_customer: "marina",
  pilot_site:      "marina",
  marina_group:    "marina_group",
};
const segment = SEGMENT_MAP[ORG_TYPE] || "marina";

// ── Duplicate detection ───────────────────────────────────────────────────────
async function findDuplicateCandidates(client, p) {
  const seen = new Set();
  const candidates = [];

  // 1. Exact or partial name match
  const nameRes = await client.query(
    `SELECT id, name, org_type, website, state_province
     FROM accounts
     WHERE lower(trim(name)) = lower(trim($1))
        OR lower(trim(name)) LIKE lower(trim($2))`,
    [p.name, `%${p.name}%`]
  );
  for (const row of nameRes.rows) {
    if (!seen.has(row.id)) { seen.add(row.id); candidates.push({ ...row, reason: "name_match" }); }
  }

  // 2. Website domain match
  if (p.website) {
    const domain = p.website.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
    if (domain) {
      const webRes = await client.query(
        `SELECT id, name, org_type, website, state_province
         FROM accounts WHERE lower(website) LIKE $1`,
        [`%${domain}%`]
      );
      for (const row of webRes.rows) {
        if (!seen.has(row.id)) { seen.add(row.id); candidates.push({ ...row, reason: "website_match" }); }
      }
    }
  }

  return candidates;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  console.log("=".repeat(62));
  console.log("VoltSafe Cortex — Migration Runner (Step A)");
  console.log("=".repeat(62));
  console.log(`  Category     : ${CATEGORY}`);
  console.log(`  Org Type     : ${ORG_TYPE}`);
  console.log(`  Partner Class: ${PARTNER_CLASS || "(none)"}`);
  console.log(`  Segment      : ${segment}`);
  console.log(`  Batch ID     : ${BATCH_ID}`);
  console.log(`  Ran By User  : ${RAN_BY}`);
  console.log(`  Dry Run      : ${DRY_RUN ? "YES — no writes" : "NO — will write to DB"}`);
  console.log("=".repeat(62));

  try {
    // Guard: batch_id must not already exist (prevents accidental re-runs)
    if (!DRY_RUN) {
      const batchCheck = await client.query(
        `SELECT COUNT(*)::int AS n FROM migration_log WHERE batch_id = $1`,
        [BATCH_ID]
      );
      if (batchCheck.rows[0].n > 0) {
        console.error(
          `\nERROR: batch_id "${BATCH_ID}" already has ${batchCheck.rows[0].n} rows in migration_log.`
        );
        console.error("Use a new --batchId or review the existing batch before re-running.");
        process.exit(1);
      }
    }

    // Fetch source rows
    const sourceRes = await client.query(
      `SELECT * FROM partnerships
       WHERE category = $1 AND migration_status = 'legacy'
       ORDER BY id`,
      [CATEGORY]
    );
    const sources = sourceRes.rows;

    console.log(
      `\nSource rows (category='${CATEGORY}', migration_status='legacy'): ${sources.length}`
    );
    if (sources.length === 0) {
      console.log("Nothing to migrate. Exiting.");
      process.exit(0);
    }

    const report = { total: sources.length, migrated: 0, duplicates: 0, failed: 0, rows: [] };

    for (const p of sources) {
      console.log(`\n  ── [partnerships.id=${p.id}] "${p.name}" ──`);

      // Duplicate check
      const candidates = await findDuplicateCandidates(client, p);

      if (candidates.length > 0) {
        console.log(`  → ${candidates.length} duplicate candidate(s) — flagged for manual review (no auto-merge)`);
        candidates.forEach(c =>
          console.log(`    candidate: accounts.id=${c.id} name="${c.name}" reason=${c.reason}`)
        );

        if (!DRY_RUN) {
          await client.query(
            `INSERT INTO migration_log
               (migration_name, batch_id, source_table, source_id, target_table,
                migration_status, migrated_at, ran_by_user_id, error_message)
             VALUES ($1, $2, 'partnerships', $3, 'accounts', 'duplicate_review', NOW(), $4, $5)`,
            [
              "partnerships-to-accounts-phase2",
              BATCH_ID, p.id, RAN_BY,
              `Duplicate candidates: accounts.ids=${candidates.map(c => c.id).join(",")}; reasons=${candidates.map(c => c.reason).join(",")}`,
            ]
          );
        }
        report.duplicates++;
        report.rows.push({
          sourceId: p.id, name: p.name,
          status: "duplicate_review",
          candidates: candidates.map(c => ({ id: c.id, name: c.name, reason: c.reason })),
        });
        continue;
      }

      // Migrate
      console.log(`  → No duplicates found — migrating`);
      if (DRY_RUN) {
        console.log(
          `  → [DRY RUN] Would INSERT account: name="${p.name}" org_type=${ORG_TYPE} partner_class=${PARTNER_CLASS}`
        );
        report.migrated++;
        report.rows.push({ sourceId: p.id, name: p.name, status: "would_migrate (dry run)" });
        continue;
      }

      try {
        // INSERT account
        const accRes = await client.query(
          `INSERT INTO accounts
             (name, website, state_province, country, org_type, partner_class,
              converted_from_partnership_id, segment, lead_status, priority)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'new', 'medium')
           RETURNING id`,
          [
            p.name,
            p.website   || null,
            p.region    || null,
            p.country   || null,
            ORG_TYPE,
            PARTNER_CLASS,
            p.id,
            segment,
          ]
        );
        const newAccountId = accRes.rows[0].id;
        console.log(`  → Created accounts.id=${newAccountId}`);

        // Write migration_log
        await client.query(
          `INSERT INTO migration_log
             (migration_name, batch_id, source_table, source_id, target_table,
              target_id, migration_status, migrated_at, ran_by_user_id)
           VALUES ($1, $2, 'partnerships', $3, 'accounts', $4, 'migrated', NOW(), $5)`,
          ["partnerships-to-accounts-phase2", BATCH_ID, p.id, newAccountId, RAN_BY]
        );

        // Update partnerships row
        await client.query(
          `UPDATE partnerships
           SET migrated_account_id = $1,
               migration_status    = 'migrated',
               migration_batch_id  = $2,
               migrated_at         = NOW()
           WHERE id = $3`,
          [newAccountId, BATCH_ID, p.id]
        );

        report.migrated++;
        report.rows.push({ sourceId: p.id, name: p.name, status: "migrated", targetId: newAccountId });
      } catch (err) {
        console.error(`  → ERROR: ${err.message}`);
        report.failed++;
        report.rows.push({ sourceId: p.id, name: p.name, status: "failed", error: err.message });
      }
    }

    // ── Report ────────────────────────────────────────────────────────────────
    console.log("\n" + "=".repeat(62));
    console.log("Step A — Migration Report");
    console.log("=".repeat(62));
    console.log(`  Source rows       : ${report.total}`);
    console.log(`  Migrated          : ${report.migrated}`);
    console.log(`  Duplicate/Review  : ${report.duplicates}`);
    console.log(`  Failed            : ${report.failed}`);
    console.log("");
    console.log("  Row summary:");
    for (const r of report.rows) {
      let detail = "";
      if (r.targetId)   detail = ` → accounts.id=${r.targetId}`;
      if (r.candidates) detail = ` → candidates: ${r.candidates.map(c => `${c.id}(${c.reason})`).join(", ")}`;
      if (r.error)      detail = ` → ${r.error}`;
      console.log(`    [${r.sourceId}] "${r.name}" — ${r.status}${detail}`);
    }

    if (report.duplicates > 0) {
      console.log(`\n  ACTION REQUIRED: ${report.duplicates} row(s) need manual review before proceeding.`);
    }
    if (report.migrated > 0 && !DRY_RUN) {
      console.log(`\nNext step:`);
      console.log(`  node scripts/verify-migration.js --batchId ${BATCH_ID}`);
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
