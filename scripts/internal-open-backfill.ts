/**
 * scripts/internal-open-backfill.ts
 *
 * Retroactively marks existing email_engagement_events rows as is_internal = TRUE
 * when the recipient_email belongs to an internal VoltSafe domain.
 *
 * Safe to run multiple times (idempotent via WHERE is_internal IS NOT TRUE guard).
 *
 * Usage:
 *   npx tsx scripts/internal-open-backfill.ts [--dry-run]
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { isInternalEmail, INTERNAL_DOMAINS } from "../server/tracking";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log(`[backfill] internal-open-backfill started (dry_run=${DRY_RUN})`);
  console.log(`[backfill] Internal domains: ${[...INTERNAL_DOMAINS].join(", ")}`);

  // Count how many rows are candidates
  const [count] = (await db.execute(sql.raw(`
    SELECT COUNT(*) AS total
    FROM email_engagement_events
    WHERE is_internal IS NOT TRUE
      AND recipient_email IS NOT NULL
  `))).rows as any[];
  console.log(`[backfill] candidate events (is_internal IS NOT TRUE, has recipient_email): ${count?.total ?? 0}`);

  if (DRY_RUN) {
    // Show a sample
    const sample = (await db.execute(sql.raw(`
      SELECT recipient_email, COUNT(*) AS cnt
      FROM email_engagement_events
      WHERE is_internal IS NOT TRUE
        AND recipient_email IS NOT NULL
      GROUP BY recipient_email
      ORDER BY cnt DESC
      LIMIT 20
    `))).rows as any[];
    console.log("[backfill] DRY RUN — sample recipient_emails and event counts:");
    for (const r of sample) {
      const internal = isInternalEmail(r.recipient_email);
      if (internal) console.log(`  [INTERNAL] ${r.recipient_email}: ${r.cnt} events`);
    }
    console.log("[backfill] DRY RUN complete — no changes written.");
    process.exit(0);
  }

  // Build domain LIKE clauses from the configured set
  const domainClauses = [...INTERNAL_DOMAINS]
    .map(d => `LOWER(recipient_email) LIKE '%@${d}'`)
    .join(" OR ");

  if (!domainClauses) {
    console.log("[backfill] No internal domains configured — nothing to do.");
    process.exit(0);
  }

  const start = Date.now();
  let totalUpdated = 0;
  const BATCH = 5000;

  while (true) {
    const res = (await db.execute(sql.raw(`
      UPDATE email_engagement_events
      SET
        is_internal     = TRUE,
        internal_reason = 'backfill:' || split_part(LOWER(recipient_email), '@', 2)
      WHERE id IN (
        SELECT id FROM email_engagement_events
        WHERE is_internal IS NOT TRUE
          AND recipient_email IS NOT NULL
          AND (${domainClauses})
        LIMIT ${BATCH}
      )
    `))).rowCount ?? 0;

    totalUpdated += Number(res);
    if (Number(res) === 0) break;
    process.stdout.write(`\r[backfill] updated ${totalUpdated} events...`);
    await new Promise(r => setTimeout(r, 50));
  }

  console.log(`\n[backfill] Done — ${totalUpdated} events marked is_internal=TRUE in ${Date.now() - start}ms`);

  // Also backfill email_tracking_pixels score = 0 for internal recipient pixels
  // (they should not contribute to scores)
  const pixelRes = (await db.execute(sql.raw(`
    UPDATE email_tracking_pixels
    SET
      engagement_score = 0,
      signal_level     = 'none',
      is_hot           = FALSE
    WHERE recipient_email IS NOT NULL
      AND (${domainClauses})
      AND (engagement_score > 0 OR signal_level != 'none' OR is_hot = TRUE)
  `))).rowCount ?? 0;
  console.log(`[backfill] Reset ${pixelRes} pixel rows for internal recipients.`);

  process.exit(0);
}

main().catch(err => {
  console.error("[backfill] Fatal:", err);
  process.exit(1);
});
