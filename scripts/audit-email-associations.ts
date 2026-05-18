/**
 * audit-email-associations.ts
 *
 * Audits all records in email_associations and verifies each linked object
 * still exists in its correct source table. Reports orphaned/mislabelled
 * records and writes a summary — does NOT delete anything.
 *
 * Usage:
 *   npx tsx scripts/audit-email-associations.ts
 *   npx tsx scripts/audit-email-associations.ts --fix   # patch objectType where
 *                                                        # object exists in a
 *                                                        # different table
 *
 * Exit code 0 = clean. Exit code 1 = issues found (check the log).
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

const FIX_MODE = process.argv.includes("--fix");

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
    account: ["leads", "contacts"],
    lead: ["accounts", "contacts"],
    contact: ["leads", "accounts"],
    opportunity: ["leads"],
    partner: [],
  };
  const candidates = alternatives[wrongType] ?? [];
  for (const table of candidates) {
    if (await checkExists(table, objectId)) {
      const typeMap: Record<string, string> = {
        leads: "lead",
        accounts: "account",
        contacts: "contact",
      };
      return typeMap[table] ?? table;
    }
  }
  return null;
}

const TABLE_FOR_TYPE: Record<string, string> = {
  account: "accounts",
  lead: "leads",
  contact: "contacts",
  opportunity: "opportunities",
  partner: "partnerships",
};

async function main() {
  console.log("=".repeat(60));
  console.log("VoltSafe Email Associations Audit");
  console.log(`Mode: ${FIX_MODE ? "FIX (will patch wrong objectType)" : "REPORT ONLY"}`);
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
  let okCount = 0;
  let orphanCount = 0;
  let wrongTypeCount = 0;
  let fixedCount = 0;

  for (const row of assocs) {
    const table = TABLE_FOR_TYPE[row.object_type];
    if (!table) {
      results.push({
        id: row.id,
        objectType: row.object_type,
        objectId: row.object_id,
        objectName: row.object_name,
        confidenceScore: row.confidence_score,
        status: "orphaned",
        detail: `Unknown objectType "${row.object_type}" — no source table mapping`,
      });
      orphanCount++;
      continue;
    }

    const exists = await checkExists(table, row.object_id);
    if (exists) {
      okCount++;
      continue;
    }

    // Record not found in expected table — check if it exists in another table
    const altType = await findAlternativeType(row.object_id, row.object_type);
    if (altType) {
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
        console.log(`  FIXED #${row.id}: ${row.object_type} → ${altType} (id=${row.object_id})`);
      }
    } else {
      orphanCount++;
      results.push({
        id: row.id,
        objectType: row.object_type,
        objectId: row.object_id,
        objectName: row.object_name,
        confidenceScore: row.confidence_score,
        status: "orphaned",
        detail: `${row.object_type} #${row.object_id} ("${row.object_name ?? "?"}") not found in any CRM table — record was deleted or never existed`,
      });
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("SUMMARY");
  console.log("─".repeat(60));
  console.log(`  ✓ OK (verified in source table): ${okCount}`);
  console.log(`  ⚠ Wrong type (record exists, wrong label): ${wrongTypeCount}`);
  console.log(`  ✗ Orphaned (record not found anywhere): ${orphanCount}`);
  if (FIX_MODE) console.log(`  ✎ Auto-fixed wrong-type records: ${fixedCount}`);

  if (results.length > 0) {
    console.log("\n" + "─".repeat(60));
    console.log("ISSUES DETAIL");
    console.log("─".repeat(60));
    for (const r of results) {
      const marker = r.status === "wrong_type" ? "⚠" : "✗";
      console.log(`\n${marker} email_associations #${r.id}`);
      console.log(`  objectType:      ${r.objectType}`);
      console.log(`  objectId:        ${r.objectId}`);
      console.log(`  objectName:      ${r.objectName ?? "(null)"}`);
      console.log(`  confidenceScore: ${r.confidenceScore ?? 0}%`);
      console.log(`  detail:          ${r.detail}`);
      if (r.suggestedFix && !FIX_MODE) {
        console.log(`  suggestedFix:    ${r.suggestedFix}`);
      }
    }

    // ── Confidence distribution of stale records ──
    console.log("\n" + "─".repeat(60));
    console.log("CONFIDENCE DISTRIBUTION OF ISSUES");
    console.log("─".repeat(60));
    const bins: Record<string, number> = { "0-17%": 0, "18-49%": 0, "50-79%": 0, "80-100%": 0 };
    for (const r of results) {
      const s = r.confidenceScore ?? 0;
      if (s <= 17) bins["0-17%"]++;
      else if (s <= 49) bins["18-49%"]++;
      else if (s <= 79) bins["50-79%"]++;
      else bins["80-100%"]++;
    }
    for (const [range, count] of Object.entries(bins)) {
      console.log(`  ${range}: ${count}`);
    }

    console.log("\n" + "─".repeat(60));
    if (!FIX_MODE) {
      console.log("Run with --fix to auto-correct wrong-type records.");
      console.log("Orphaned records are logged only — manual review recommended before deletion.");
    }
  } else {
    console.log("\n✓ All email_associations records are correctly typed and verified.");
  }

  console.log("\nAudit complete.");
  process.exit(results.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Audit failed:", err);
  process.exit(2);
});
