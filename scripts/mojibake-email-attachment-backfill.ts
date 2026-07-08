#!/usr/bin/env npx tsx
/**
 * Mojibake Email-Attachment Filename Backfill
 * ============================================
 * One-time idempotent script that repairs corrupted (mojibake) filenames in the
 * email_attachments table.  The email-parser now calls fixMojibakeFilename() at
 * parse time for newly-ingested messages, but rows stored *before* that fix was
 * deployed may still carry the mis-decoded latin1-as-UTF-8 value
 * (e.g. "Screenshot 2026-07-07 at 8.01.09â¯PM.png").
 *
 * Safety:
 *   • Only processes rows whose filename contains characters in U+0080–U+00FF.
 *     These are the latin-1 supplement codepoints produced when a UTF-8 multi-byte
 *     sequence is mis-decoded byte-by-byte as latin1.  Pure ASCII strings and
 *     strings that already contain correctly encoded Unicode characters above
 *     U+00FF (e.g. U+202F narrow no-break space used by macOS screenshot names)
 *     do NOT have chars in this range, so those rows are never touched.
 *   • Rejects any candidate fix that introduces path separators (/, \) or NUL
 *     bytes that were not present in the original.
 *   • Only writes when the fixed value differs from the stored value.  Fully
 *     idempotent: re-running after a previous pass does nothing.
 *
 * Run:
 *   npx tsx scripts/mojibake-email-attachment-backfill.ts
 *   DRY_RUN=1 npx tsx scripts/mojibake-email-attachment-backfill.ts
 *   BATCH_SIZE=200 npx tsx scripts/mojibake-email-attachment-backfill.ts
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const DRY_RUN = process.env.DRY_RUN === "1";
const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? 500);

function hasMojibakeSignature(name: string): boolean {
  for (let i = 0; i < name.length; i++) {
    const cp = name.charCodeAt(i);
    if (cp >= 0x80 && cp <= 0xFF) return true;
  }
  return false;
}

function fixMojibakeFilename(name: string): string {
  if (!name) return name;
  if (!hasMojibakeSignature(name)) return name;
  try {
    const reDecoded = Buffer.from(name, "latin1").toString("utf8");
    if (reDecoded.includes("\uFFFD")) return name;
    const dangerousIntroduced =
      (!name.includes("/") && reDecoded.includes("/")) ||
      (!name.includes("\\") && reDecoded.includes("\\")) ||
      (!name.includes("\0") && reDecoded.includes("\0"));
    if (dangerousIntroduced) return name;
    return reDecoded;
  } catch {
    return name;
  }
}

async function main() {
  console.log(`[email-attach-mojibake] Starting${DRY_RUN ? " (DRY RUN — no writes)" : ""}…`);
  console.log(`[email-attach-mojibake] batch=${BATCH_SIZE}`);

  const countResult = await db.execute(sql.raw(`
    SELECT COUNT(*)::int AS n FROM email_attachments
  `));
  const total = Number((countResult as any).rows?.[0]?.n ?? 0);
  console.log(`[email-attach-mojibake] Total email_attachments rows: ${total}`);

  let offset = 0;
  let totalScanned = 0;
  let totalFixed = 0;
  let totalSkipped = 0;
  let totalSafetyBlocked = 0;
  let totalErrors = 0;
  const examples: { id: number; before: string; after: string }[] = [];

  while (true) {
    const rows = await db.execute(sql.raw(`
      SELECT id, filename
      FROM email_attachments
      ORDER BY id
      LIMIT ${BATCH_SIZE} OFFSET ${offset}
    `));
    type Row = { id: number; filename: string | null };
    const batch = ((rows as any).rows ?? []) as Row[];
    if (batch.length === 0) break;

    offset += batch.length;
    totalScanned += batch.length;

    for (const row of batch) {
      const before = row.filename ?? "";
      if (!before || !hasMojibakeSignature(before)) {
        totalSkipped++;
        continue;
      }

      const after = fixMojibakeFilename(before);

      if (after === before) {
        totalSafetyBlocked++;
        continue;
      }

      if (examples.length < 10) {
        examples.push({ id: row.id, before, after });
      }

      if (!DRY_RUN) {
        try {
          await db.execute(sql.raw(`
            UPDATE email_attachments
            SET filename = '${after.replace(/'/g, "''")}'
            WHERE id = ${row.id}
          `));
          totalFixed++;
        } catch (err: any) {
          console.error(`[email-attach-mojibake] UPDATE error id=${row.id}: ${err.message}`);
          totalErrors++;
        }
      } else {
        totalFixed++;
      }
    }

    if (totalScanned % 1000 === 0 || batch.length < BATCH_SIZE) {
      console.log(
        `[email-attach-mojibake] scanned=${totalScanned}/${total}` +
        `  fixed=${totalFixed}  skipped=${totalSkipped}` +
        `  safety_blocked=${totalSafetyBlocked}  errors=${totalErrors}`
      );
    }
  }

  console.log(`\n========== EMAIL ATTACHMENT MOJIBAKE FILENAME BACKFILL REPORT ==========`);
  console.log(`dry_run         : ${DRY_RUN}`);
  console.log(`total scanned   : ${totalScanned}`);
  console.log(`filename fixed  : ${totalFixed}`);
  console.log(`rows skipped    : ${totalSkipped}  (ASCII or chars above U+00FF — not mojibake)`);
  console.log(`safety blocked  : ${totalSafetyBlocked}  (mojibake detected but fix was unsafe)`);
  console.log(`errors          : ${totalErrors}`);
  if (examples.length > 0) {
    console.log(`\nExample repairs (up to 10):`);
    for (const ex of examples) {
      console.log(`  id=${ex.id}`);
      console.log(`    before: ${JSON.stringify(ex.before)}`);
      console.log(`    after : ${JSON.stringify(ex.after)}`);
    }
  }
  console.log(`\nTip: run with DRY_RUN=1 first to preview repairs before writing.`);
  console.log(`=========================================================================`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("[email-attach-mojibake] Fatal:", err.message);
  process.exit(1);
});
