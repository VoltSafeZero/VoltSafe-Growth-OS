/**
 * normalize-all-email-signatures.ts
 *
 * Scans all rows in email_signatures and normalizes any that contain full
 * HTML document wrapper tags (<!DOCTYPE>, <html>, <head>, <body>).
 *
 * These wrapper tags cause the Replit WAF to return 403 Forbidden when the
 * signature is included in a POST /api/gmail/send request body.
 *
 * Usage:
 *   npx tsx scripts/normalize-all-email-signatures.ts --dry-run
 *   npx tsx scripts/normalize-all-email-signatures.ts --apply
 */

import { Pool } from "pg";
import { normalizeSignatureHtml, detectDocumentTags } from "../server/services/signature-normalizer";

const DRY_RUN = process.argv.includes("--dry-run");
const APPLY   = process.argv.includes("--apply");

if (!DRY_RUN && !APPLY) {
  console.error("Usage: npx tsx scripts/normalize-all-email-signatures.ts --dry-run | --apply");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

interface SigRow {
  id: number;
  user_id: number;
  name: string;
  html_content: string;
}

async function main() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<SigRow>(
      "SELECT id, user_id, name, html_content FROM email_signatures ORDER BY id"
    );

    console.log(`\nScanning ${rows.length} signature(s)...\n`);

    let needsNormalizing = 0;
    let alreadyClean     = 0;
    let fixed            = 0;
    let errors           = 0;

    for (const row of rows) {
      const tags = detectDocumentTags(row.html_content);
      if (!tags.any) {
        alreadyClean++;
        continue;
      }

      needsNormalizing++;
      const before  = row.html_content.length;
      const cleaned = normalizeSignatureHtml(row.html_content);
      const after   = cleaned.length;

      const removed: string[] = [];
      if (tags.hasDoctype) removed.push("DOCTYPE");
      if (tags.hasHtmlTag) removed.push("<html>");
      if (tags.hasHeadTag) removed.push("<head>..content..</head>");
      if (tags.hasBodyTag) removed.push("<body>");

      console.log(`  id=${row.id}  user=${row.user_id}  "${row.name}"`);
      console.log(`    before=${before} bytes  after=${after} bytes  removed=[${removed.join(", ")}]`);

      if (APPLY) {
        try {
          await client.query(
            "UPDATE email_signatures SET html_content = $1, updated_at = NOW() WHERE id = $2",
            [cleaned, row.id]
          );
          fixed++;
          console.log(`    ✓ normalized and saved`);
        } catch (err: any) {
          errors++;
          console.error(`    ✗ ERROR saving id=${row.id}: ${err.message}`);
        }
      }
    }

    console.log(`\n──────────────────────────────────────────────`);
    console.log(`Total signatures:      ${rows.length}`);
    console.log(`Already clean:         ${alreadyClean}`);
    console.log(`Needs normalization:   ${needsNormalizing}`);
    if (APPLY) {
      console.log(`Fixed:                 ${fixed}`);
      if (errors > 0) console.error(`Errors:                ${errors}`);
    }
    if (DRY_RUN && needsNormalizing > 0) {
      console.log(`\nRe-run with --apply to normalize the ${needsNormalizing} affected signature(s).`);
    }
    if (APPLY && errors === 0 && needsNormalizing > 0) {
      console.log(`\nAll ${fixed} signature(s) normalized successfully.`);
      console.log(`Existing users are now protected. Future saves are normalized at CRUD time.`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
