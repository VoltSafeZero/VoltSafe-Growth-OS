/**
 * scripts/fix-cta-image-urls.ts
 *
 * Finds stale public_url values in the cta_assets table (old workspace hostnames,
 * localhost, or any host that doesn't match the current canonical URL) and rewrites
 * them so they reference only the stable /assets/cta/<filename> path.
 *
 * Usage:
 *   npx tsx scripts/fix-cta-image-urls.ts --dry-run   # preview changes
 *   npx tsx scripts/fix-cta-image-urls.ts --apply     # apply changes to database
 *
 * The script updates public_url to "/assets/cta/<filename>" (relative path stored
 * in DB). At serve time the GET /api/cta-assets route rewrites to absolute using
 * the request's X-Forwarded-Host, so the value is always correct regardless of
 * which environment serves it.
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

const DRY_RUN = !process.argv.includes("--apply");

const STALE_PATTERNS = [
  /workspace\.[^/]+\.repl\.co/,
  /localhost/,
  /127\.0\.0\.1/,
  /0\.0\.0\.0/,
  /replit\.dev/,
];

function isStale(url: string): boolean {
  return STALE_PATTERNS.some(p => p.test(url));
}

function extractFilename(url: string): string | null {
  const m = url.match(/\/assets\/cta\/([^/?#\s]+)$/);
  return m ? m[1] : null;
}

async function main() {
  console.log(`\n=== CTA Image URL Fixer (${DRY_RUN ? "DRY RUN" : "APPLY"}) ===\n`);

  const rows = (await db.execute(sql`
    SELECT id, name, filename, public_url
    FROM cta_assets
    WHERE is_archived = FALSE
    ORDER BY id
  `)).rows as Array<{ id: number; name: string; filename: string; public_url: string }>;

  if (rows.length === 0) {
    console.log("No active CTA assets found.");
    return;
  }

  console.log(`Found ${rows.length} active asset(s):\n`);

  let fixed = 0;
  let ok = 0;
  let skipped = 0;

  for (const row of rows) {
    const url = row.public_url ?? "";
    const filename = row.filename ?? "";

    if (!url) {
      console.log(`  [SKIP] #${row.id} "${row.name}" — no public_url stored`);
      skipped++;
      continue;
    }

    const stale = isStale(url);
    const filenameFromUrl = extractFilename(url);
    const canonicalPath = `/assets/cta/${filename}`;

    if (!stale && filenameFromUrl === filename) {
      console.log(`  [OK]   #${row.id} "${row.name}" — ${url}`);
      ok++;
      continue;
    }

    if (!filename) {
      console.log(`  [SKIP] #${row.id} "${row.name}" — stale URL but filename is empty, cannot fix`);
      skipped++;
      continue;
    }

    console.log(`  [FIX]  #${row.id} "${row.name}"`);
    console.log(`         old: ${url}`);
    console.log(`         new: ${canonicalPath}`);

    if (!DRY_RUN) {
      const escaped = canonicalPath.replace(/'/g, "''");
      await db.execute(sql.raw(`UPDATE cta_assets SET public_url = '${escaped}' WHERE id = ${row.id}`));
    }
    fixed++;
  }

  console.log(`\nSummary: ${ok} ok, ${fixed} to fix, ${skipped} skipped.`);

  if (DRY_RUN && fixed > 0) {
    console.log("\nRun with --apply to write changes to the database.");
  } else if (!DRY_RUN && fixed > 0) {
    console.log("\n✓ Changes applied.");
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
