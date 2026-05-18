/**
 * audit-email-associations.ts
 *
 * Audits all records in email_associations and verifies each linked object
 * still exists in its correct source table. Reports orphaned/mislabelled
 * records and writes a summary — does NOT delete anything by default.
 *
 * Usage:
 *   npx tsx scripts/audit-email-associations.ts
 *     → report only; exit 1 if any issues found
 *
 *   npx tsx scripts/audit-email-associations.ts --fix
 *     → auto-patch objectType for records where the object exists in a
 *       different CRM table (e.g. lead→account after lead conversion)
 *
 *   npx tsx scripts/audit-email-associations.ts --delete-orphans
 *     → delete ONLY records whose objectId does not exist in ANY CRM table
 *       (true orphans — object was permanently deleted). Does NOT delete
 *       wrong-type records; combine with --fix for both corrections at once.
 *
 *   npx tsx scripts/audit-email-associations.ts --fix --delete-orphans
 *     → apply both corrections in one pass
 *
 * Exit codes:
 *   0 — clean (or all fixable issues were resolved)
 *   1 — issues remain after fixes
 *   2 — script error
 *
 * Safety guarantees:
 *   • Never touches the referenced lead/account/contact/opportunity/partner
 *     records themselves — only email_associations rows.
 *   • --delete-orphans only removes rows where the CRM object is truly gone
 *     from ALL candidate tables; wrong-type rows are never deleted by this flag.
 *   • Dry-runs are the default; nothing is written without an explicit flag.
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

const FIX_MODE          = process.argv.includes("--fix");
const DELETE_ORPHANS    = process.argv.includes("--delete-orphans");

interface AssocRow {
  id: number;
  email_message_id: number;
  object_type: string;
  object_id: number;
  object_name: string | null;
  confidence_score: number | null;
  is_auto: boolean;
  is_user_confirmed: boolean;
  created_at: Date;
}

interface AuditResult {
  id: number;
  objectType: string;
  objectId: number;
  objectName: string | null;
  confidenceScore: number | null;
  status: "ok" | "orphaned" | "wrong_type";
  detail: string;
  suggestedFix?: string;
}

async function checkExists(table: string, id: number): Promise<boolean> {
  const r = await db.execute(sql.raw(`SELECT 1 FROM ${table} WHERE id = ${id} LIMIT 1`));
  return r.rows.length > 0;
}

async function findAlternativeType(objectId: number, wrongType: string): Promise<string | null> {
  const alternatives: Record<string, string[]> = {
    account:     ["leads", "contacts"],
    lead:        ["accounts", "contacts"],
    contact:     ["leads", "accounts"],
    opportunity: ["leads"],
    partner:     [],
  };
  const candidates = alternatives[wrongType] ?? [];
  for (const table of candidates) {
    if (await checkExists(table, objectId)) {
      const typeMap: Record<string, string> = {
        leads:    "lead",
        accounts: "account",
        contacts: "contact",
      };
      return typeMap[table] ?? table;
    }
  }
  return null;
}

const TABLE_FOR_TYPE: Record<string, string> = {
  account:     "accounts",
  lead:        "leads",
  contact:     "contacts",
  opportunity: "opportunities",
  partner:     "partnerships",
};

async function main() {
  console.log("=".repeat(60));
  console.log("VoltSafe Email Associations Audit");
  const modeLabel = [
    FIX_MODE       && "FIX wrong-type",
    DELETE_ORPHANS && "DELETE orphans",
  ].filter(Boolean).join(" + ") || "REPORT ONLY";
  console.log(`Mode: ${modeLabel}`);
  console.log("=".repeat(60));

  const rows = await db.execute(sql.raw(`
    SELECT id, email_message_id, object_type, object_id, object_name,
           confidence_score, is_auto, is_user_confirmed, created_at
    FROM email_associations
    ORDER BY id
  `));

  const assocs = rows.rows as AssocRow[];
  console.log(`\nTotal records: ${assocs.length}\n`);

  const results: AuditResult[] = [];
  let okCount        = 0;
  let orphanCount    = 0;
  let wrongTypeCount = 0;
  let fixedCount     = 0;
  let deletedCount   = 0;

  for (const row of assocs) {
    const table = TABLE_FOR_TYPE[row.object_type];
    if (!table) {
      // Truly unknown objectType — treat as orphan
      orphanCount++;
      const r: AuditResult = {
        id: row.id,
        objectType: row.object_type,
        objectId: row.object_id,
        objectName: row.object_name,
        confidenceScore: row.confidence_score,
        status: "orphaned",
        detail: `Unknown objectType "${row.object_type}" — no source table mapping`,
      };
      results.push(r);
      if (DELETE_ORPHANS) {
        await db.execute(sql.raw(`DELETE FROM email_associations WHERE id = ${row.id}`));
        deletedCount++;
        console.log(`  DELETED #${row.id}: unknown objectType="${row.object_type}" id=${row.object_id}`);
      }
      continue;
    }

    const exists = await checkExists(table, row.object_id);
    if (exists) {
      okCount++;
      continue;
    }

    // Record not found in its expected table — check alternatives
    const altType = await findAlternativeType(row.object_id, row.object_type);

    if (altType) {
      // Wrong type — object exists but under a different CRM type
      wrongTypeCount++;
      const detail = `objectType="${row.object_type}" but record ${row.object_id} exists in ${TABLE_FOR_TYPE[altType] ?? altType} → should be "${altType}"`;
      results.push({
        id: row.id,
        objectType: row.object_type,
        objectId: row.object_id,
        objectName: row.object_name,
        confidenceScore: row.confidence_score,
        status: "wrong_type",
        detail,
        suggestedFix: `UPDATE email_associations SET object_type='${altType}' WHERE id=${row.id};`,
      });

      if (FIX_MODE) {
        await db.execute(sql.raw(
          `UPDATE email_associations SET object_type='${altType}', updated_at=now() WHERE id=${row.id}`
        ));
        fixedCount++;
        console.log(`  FIXED #${row.id}: ${row.object_type} → ${altType} (objectId=${row.object_id})`);
      }
    } else {
      // True orphan — object is gone from all CRM tables
      orphanCount++;
      const r: AuditResult = {
        id: row.id,
        objectType: row.object_type,
        objectId: row.object_id,
        objectName: row.object_name,
        confidenceScore: row.confidence_score,
        status: "orphaned",
        detail: `${row.object_type} #${row.object_id} ("${row.object_name ?? "?"}") not found in any CRM table — object was deleted or never created`,
      };
      results.push(r);

      if (DELETE_ORPHANS) {
        await db.execute(sql.raw(`DELETE FROM email_associations WHERE id = ${row.id}`));
        deletedCount++;
        console.log(`  DELETED #${row.id}: orphaned ${row.object_type} #${row.object_id} ("${row.object_name ?? "?"}")`);
      }
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("SUMMARY");
  console.log("─".repeat(60));
  console.log(`  ✓ OK (verified in source table):         ${okCount}`);
  console.log(`  ⚠ Wrong type (object exists, mislabeled): ${wrongTypeCount}`);
  console.log(`  ✗ Orphaned (object not found anywhere):  ${orphanCount}`);
  if (FIX_MODE)       console.log(`  ✎ Auto-fixed wrong-type records:         ${fixedCount}`);
  if (DELETE_ORPHANS) console.log(`  🗑 Deleted orphaned records:              ${deletedCount}`);

  // Issues that remain after any fixes
  const remainingIssues = results.filter(r => {
    if (r.status === "wrong_type" && FIX_MODE) return false;        // patched
    if (r.status === "orphaned"   && DELETE_ORPHANS) return false;  // deleted
    return true;
  });

  if (results.length > 0) {
    console.log("\n" + "─".repeat(60));
    console.log("ISSUES DETAIL");
    console.log("─".repeat(60));
    for (const r of results) {
      const marker = r.status === "wrong_type" ? "⚠" : "✗";
      const resolved =
        (r.status === "wrong_type" && FIX_MODE) ||
        (r.status === "orphaned"   && DELETE_ORPHANS);
      const tag = resolved ? " [RESOLVED]" : "";
      console.log(`\n${marker} email_associations #${r.id}${tag}`);
      console.log(`  objectType:      ${r.objectType}`);
      console.log(`  objectId:        ${r.objectId}`);
      console.log(`  objectName:      ${r.objectName ?? "(null)"}`);
      console.log(`  confidenceScore: ${r.confidenceScore ?? 0}%`);
      console.log(`  detail:          ${r.detail}`);
      if (r.suggestedFix && !FIX_MODE) {
        console.log(`  suggestedFix:    ${r.suggestedFix}`);
      }
    }

    // Confidence distribution of all issues (pre-fix)
    console.log("\n" + "─".repeat(60));
    console.log("CONFIDENCE DISTRIBUTION OF ISSUES");
    console.log("─".repeat(60));
    const bins: Record<string, number> = { "0-17%": 0, "18-49%": 0, "50-79%": 0, "80-100%": 0 };
    for (const r of results) {
      const s = r.confidenceScore ?? 0;
      if (s <= 17)       bins["0-17%"]++;
      else if (s <= 49)  bins["18-49%"]++;
      else if (s <= 79)  bins["50-79%"]++;
      else               bins["80-100%"]++;
    }
    for (const [range, count] of Object.entries(bins)) {
      if (count > 0) console.log(`  ${range}: ${count}`);
    }

    console.log("\n" + "─".repeat(60));
    if (!FIX_MODE && wrongTypeCount > 0) {
      console.log("Run with --fix to auto-correct wrong-type records.");
    }
    if (!DELETE_ORPHANS && orphanCount > 0) {
      console.log("Run with --delete-orphans to remove true orphan records.");
      console.log("Orphaned records are logged only until that flag is set.");
    }
  } else {
    console.log("\n✓ All email_associations records are correctly typed and verified.");
  }

  console.log("\nAudit complete.");
  process.exit(remainingIssues.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Audit failed:", err);
  process.exit(2);
});
