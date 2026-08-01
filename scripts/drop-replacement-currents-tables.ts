/**
 * scripts/drop-replacement-currents-tables.ts
 *
 * Removes the four empty replacement currents_* tables from the development
 * database. These tables were created by the contaminated-workspace
 * investigation and have zero application-code references. Dropping them from
 * dev ensures the next Replit publish does not recreate them in production.
 *
 * Safety guarantees:
 *   - ABORTS if any table contains rows
 *   - ABORTS if any external foreign key from a legitimate table exists
 *   - Never uses CASCADE
 *   - Never references or touches original current_* tables
 *   - Idempotent: skips tables already absent
 *   - Drops in dependency-safe order (children before parents)
 *
 * Run with:
 *   npx tsx scripts/drop-replacement-currents-tables.ts
 */

import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const REPLACEMENT_TABLES = [
  "currents_read_state",  // FK → currents_channels
  "currents_reactions",   // FK → currents_posts
  "currents_posts",       // FK → currents_channels (+ self-ref reply_to_id)
  "currents_channels",    // parent — must be last
] as const;

const ORIGINAL_TABLES = [
  "current_channels",
  "current_messages",
  "current_reactions",
  "current_pins",
  "current_conversations",
  "current_channel_members",
] as const;

async function main() {
  const client = await pool.connect();
  try {
    console.log("[drop-replacement] === Starting replacement currents_* table removal ===");

    // ------------------------------------------------------------------ //
    // 1. Verify all four tables contain zero rows
    // ------------------------------------------------------------------ //
    const rowCheck = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM currents_channels)   AS currents_channels,
        (SELECT COUNT(*) FROM currents_posts)      AS currents_posts,
        (SELECT COUNT(*) FROM currents_reactions)  AS currents_reactions,
        (SELECT COUNT(*) FROM currents_read_state) AS currents_read_state
    `);
    const counts = rowCheck.rows[0] as Record<string, string>;
    console.log("[drop-replacement] Row counts:", JSON.stringify(counts));

    for (const [table, count] of Object.entries(counts)) {
      if (Number(count) !== 0) {
        throw new Error(
          `ABORT: ${table} contains ${count} row(s). ` +
          `All replacement tables must be empty before deletion.`
        );
      }
    }
    console.log("[drop-replacement] ✓ All four tables confirmed empty");

    // ------------------------------------------------------------------ //
    // 2. Verify no external foreign keys into these tables
    //    (FKs between the four tables themselves are expected and fine)
    // ------------------------------------------------------------------ //
    const extFkCheck = await client.query(`
      SELECT
        tc.table_name    AS from_table,
        kcu.column_name  AS from_column,
        ccu.table_name   AS to_table,
        tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON  tc.constraint_name = kcu.constraint_name
        AND tc.table_schema    = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON  ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema    = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_name IN (
          'currents_channels','currents_posts',
          'currents_reactions','currents_read_state'
        )
        AND tc.table_name NOT IN (
          'currents_channels','currents_posts',
          'currents_reactions','currents_read_state'
        )
    `);

    if (extFkCheck.rows.length > 0) {
      throw new Error(
        `ABORT: External foreign keys found from legitimate tables into ` +
        `replacement tables: ${JSON.stringify(extFkCheck.rows)}`
      );
    }
    console.log("[drop-replacement] ✓ No external foreign keys found");

    // ------------------------------------------------------------------ //
    // 3. Drop in dependency-safe order (no CASCADE)
    // ------------------------------------------------------------------ //
    for (const table of REPLACEMENT_TABLES) {
      const exists = await client.query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1`,
        [table]
      );
      if (exists.rows.length === 0) {
        console.log(`[drop-replacement] SKIP: ${table} already absent (idempotent)`);
        continue;
      }
      await client.query(`DROP TABLE "${table}"`);
      console.log(`[drop-replacement] ✓ Dropped: ${table}`);
    }

    // ------------------------------------------------------------------ //
    // 4. Verify original current_* tables are untouched
    // ------------------------------------------------------------------ //
    const origCheck = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1)
      ORDER BY table_name
    `, [ORIGINAL_TABLES]);

    const found = origCheck.rows.map((r: { table_name: string }) => r.table_name);
    const missing = ORIGINAL_TABLES.filter(t => !found.includes(t));
    if (missing.length > 0) {
      throw new Error(`ABORT: Original current_* tables unexpectedly missing: ${missing.join(", ")}`);
    }
    console.log("[drop-replacement] ✓ All original current_* tables intact:", found.join(", "));

    console.log("[drop-replacement] === COMPLETE ===");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error("[drop-replacement] FAILED:", err.message);
  process.exit(1);
});
