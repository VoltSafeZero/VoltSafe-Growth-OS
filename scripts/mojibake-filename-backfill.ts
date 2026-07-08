#!/usr/bin/env npx tsx
/**
 * Mojibake Filename Backfill
 * ===========================
 * One-time idempotent script that repairs corrupted (mojibake) filenames in the
 * attachments table.  The upload route now calls fixMojibakeFilename() at persist
 * time, but any rows uploaded *before* that fix was deployed still carry the
 * mis-decoded latin1-as-UTF-8 value
 * (e.g. "Screenshot 2026-07-07 at 8.01.09â¯PM.png").
 *
 * Safety:
 *   • Only processes rows whose stored name contains characters in U+0080–U+00FF.
 *     These are the latin-1 supplement codepoints produced when a UTF-8 multi-byte
 *     sequence is mis-decoded byte-by-byte as latin1.  Pure ASCII strings and strings
 *     that already contain correctly encoded Unicode characters above U+00FF (e.g.
 *     U+202F narrow no-break space used by macOS screenshot names) do NOT have chars
 *     in this range, so those rows are never touched.
 *   • Rejects any candidate fix that introduces path separators (/, \) or NUL bytes
 *     that were not present in the original.
 *   • Only writes when the fixed value differs from the stored value.  Fully
 *     idempotent: re-running after a previous pass does nothing.
 *
 * Default scope: Currents-linked attachments (object_type = 'current_message').
 * Set OBJ_TYPE=all to widen to every row in the attachments table.
 *
 * Both the display name (original_name) and the stored filename (file_name) are
 * checked and repaired when corrupted.
 *
 * Run:
 *   npx tsx scripts/mojibake-filename-backfill.ts
 *   DRY_RUN=1 npx tsx scripts/mojibake-filename-backfill.ts
 *   OBJ_TYPE=all npx tsx scripts/mojibake-filename-backfill.ts
 *   BATCH_SIZE=200 npx tsx scripts/mojibake-filename-backfill.ts
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const DRY_RUN = process.env.DRY_RUN === "1";
const OBJ_TYPE_ENV = (process.env.OBJ_TYPE ?? "current_message").trim();
const SCOPE_ALL = OBJ_TYPE_ENV === "all";
const OBJ_TYPE = SCOPE_ALL ? null : OBJ_TYPE_ENV;
const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? 500);

/**
 * Returns true if the name contains characters in the Latin-1 supplement block
 * (U+0080–U+00FF).  This is the telltale signature of mis-decoded UTF-8: each
 * byte of a multi-byte UTF-8 sequence (e.g. 0xE2, 0x80, 0xAF for U+202F) is
 * interpreted as its latin1 codepoint, producing characters in this range.
 *
 * Strings that are pure ASCII or that already contain correctly encoded Unicode
 * characters above U+00FF will NOT have chars in this range, so they are skipped.
 */
function hasMojibakeSignature(name: string): boolean {
  for (let i = 0; i < name.length; i++) {
    const cp = name.charCodeAt(i);
    if (cp >= 0x80 && cp <= 0xFF) return true;
  }
  return false;
}

/**
 * Attempt to repair a mojibake filename.
 *
 * Returns the repaired string, or the original if:
 *   • the string has no mojibake signature (ASCII or chars above U+00FF)
 *   • the latin1→utf8 round-trip produces replacement characters (U+FFFD)
 *   • the result would introduce path separators or NUL bytes not in the original
 */
function fixMojibakeFilename(name: string): string {
  if (!name) return name;
  if (!hasMojibakeSignature(name)) return name;
  try {
    const reDecoded = Buffer.from(name, "latin1").toString("utf8");
    if (reDecoded.includes("\uFFFD")) return name;
    // Safety: reject if the fix introduces path separators or NUL bytes
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
  console.log(`[mojibake-backfill] Starting${DRY_RUN ? " (DRY RUN — no writes)" : ""}…`);
  console.log(`[mojibake-backfill] scope=${OBJ_TYPE ?? "all object types"}  batch=${BATCH_SIZE}`);

  const whereClause = OBJ_TYPE
    ? `WHERE object_type = '${OBJ_TYPE.replace(/'/g, "''")}'`
    : "";

  const countResult = await db.execute(sql.raw(`
    SELECT COUNT(*)::int AS n FROM attachments ${whereClause}
  `));
  const total = Number((countResult as any).rows?.[0]?.n ?? 0);
  console.log(`[mojibake-backfill] Total attachments in scope: ${total}`);

  let offset = 0;
  let totalScanned = 0;
  let fixedOriginalName = 0;
  let fixedFileName = 0;
  let totalSkipped = 0;
  let totalSafetyBlocked = 0;
  let totalErrors = 0;
  const examples: { id: number; field: string; before: string; after: string }[] = [];

  while (true) {
    const rows = await db.execute(sql.raw(`
      SELECT id, original_name, file_name, object_type
      FROM attachments
      ${whereClause}
      ORDER BY id
      LIMIT ${BATCH_SIZE} OFFSET ${offset}
    `));
    type Row = { id: number; original_name: string; file_name: string; object_type: string };
    const batch = ((rows as any).rows ?? []) as Row[];
    if (batch.length === 0) break;

    offset += batch.length;
    totalScanned += batch.length;

    for (const row of batch) {
      const origBefore = row.original_name ?? "";
      const fileBefore = row.file_name ?? "";

      // Skip rows with no mojibake signature in either field
      if (!hasMojibakeSignature(origBefore) && !hasMojibakeSignature(fileBefore)) {
        totalSkipped++;
        continue;
      }

      const origAfter = fixMojibakeFilename(origBefore);
      const fileAfter = fixMojibakeFilename(fileBefore);

      const origChanged = origAfter !== origBefore;
      const fileChanged = fileAfter !== fileBefore;

      // If hasMojibakeSignature was true but fixMojibakeFilename returned original
      // (safety-blocked or U+FFFD), count and skip.
      if (!origChanged && !fileChanged) {
        totalSafetyBlocked++;
        continue;
      }

      if (examples.length < 10) {
        if (origChanged) examples.push({ id: row.id, field: "original_name", before: origBefore, after: origAfter });
        if (fileChanged && examples.length < 10) examples.push({ id: row.id, field: "file_name", before: fileBefore, after: fileAfter });
      }

      if (!DRY_RUN) {
        try {
          const setParts: string[] = [];
          if (origChanged) setParts.push(`original_name = '${origAfter.replace(/'/g, "''")}'`);
          if (fileChanged) setParts.push(`file_name = '${fileAfter.replace(/'/g, "''")}'`);
          await db.execute(sql.raw(`
            UPDATE attachments
            SET ${setParts.join(", ")}
            WHERE id = ${row.id}
          `));
          if (origChanged) fixedOriginalName++;
          if (fileChanged) fixedFileName++;
        } catch (err: any) {
          console.error(`[mojibake-backfill] UPDATE error id=${row.id}: ${err.message}`);
          totalErrors++;
        }
      } else {
        if (origChanged) fixedOriginalName++;
        if (fileChanged) fixedFileName++;
      }
    }

    if (totalScanned % 1000 === 0 || batch.length < BATCH_SIZE) {
      console.log(
        `[mojibake-backfill] scanned=${totalScanned}/${total}` +
        `  orig_fixed=${fixedOriginalName}  file_fixed=${fixedFileName}` +
        `  skipped=${totalSkipped}  safety_blocked=${totalSafetyBlocked}  errors=${totalErrors}`
      );
    }
  }

  console.log(`\n========== MOJIBAKE FILENAME BACKFILL REPORT ==========`);
  console.log(`dry_run             : ${DRY_RUN}`);
  console.log(`scope               : ${OBJ_TYPE ?? "all object types"}`);
  console.log(`total scanned       : ${totalScanned}`);
  console.log(`original_name fixed : ${fixedOriginalName}`);
  console.log(`file_name fixed     : ${fixedFileName}`);
  console.log(`rows skipped (ok)   : ${totalSkipped}  (ASCII or chars above U+00FF — not mojibake)`);
  console.log(`safety blocked      : ${totalSafetyBlocked}  (mojibake detected but fix was unsafe)`);
  console.log(`errors              : ${totalErrors}`);
  if (examples.length > 0) {
    console.log(`\nExample repairs (up to 10):`);
    for (const ex of examples) {
      console.log(`  id=${ex.id}  field=${ex.field}`);
      console.log(`    before: ${JSON.stringify(ex.before)}`);
      console.log(`    after : ${JSON.stringify(ex.after)}`);
    }
  }
  console.log(`\nTip: run with DRY_RUN=1 first to preview repairs before writing.`);
  console.log(`=======================================================`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("[mojibake-backfill] Fatal:", err.message);
  process.exit(1);
});
