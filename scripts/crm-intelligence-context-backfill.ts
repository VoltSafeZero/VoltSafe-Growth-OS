/**
 * CRM Intelligence Context Backfill
 *
 * Builds / refreshes crm_intelligence_context rows for every lead, account,
 * and contact that has meaningful CRM activity.
 *
 * Usage:
 *   npx tsx scripts/crm-intelligence-context-backfill.ts [--dry-run] [--all]
 *   npx tsx scripts/crm-intelligence-context-backfill.ts --record lead:42
 *
 * Options:
 *   --dry-run   list records that would be processed, no writes
 *   --all       process all leads + accounts + contacts (default)
 *   --record    process a single record (e.g. "lead:42" or "account:7")
 *   --force     rebuild even if context already exists
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";
import {
  buildOrUpdateCrmIntelligenceContext,
  getCrmIntelligenceContext,
  type CrmEntityType,
} from "../server/services/crm-intelligence-context";

const BATCH = 10;
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const forceRebuild = args.includes("--force");
const recordArg = args.find(a => a.startsWith("--record="))?.split("=")[1]
  || (args.indexOf("--record") !== -1 ? args[args.indexOf("--record") + 1] : undefined);

async function loadIds(table: string, orderCol = "id"): Promise<number[]> {
  const r = await db.execute(sql.raw(`SELECT id FROM ${table} ORDER BY ${orderCol} ASC`));
  return ((r as any).rows || []).map((row: any) => Number(row.id));
}

async function processRecord(type: CrmEntityType, id: number): Promise<void> {
  if (dryRun) {
    const existing = await getCrmIntelligenceContext(type, id);
    console.log(`[dry-run] ${type}:${id} — hasContext=${!!existing} lastBuildAt=${existing?.lastContextBuildAt || "none"}`);
    return;
  }

  if (!forceRebuild) {
    const existing = await getCrmIntelligenceContext(type, id);
    if (existing) {
      console.log(`[skip] ${type}:${id} — context exists (lastBuildAt=${existing.lastContextBuildAt})`);
      return;
    }
  }

  try {
    const ctx = await buildOrUpdateCrmIntelligenceContext(type, id);
    if (ctx) {
      console.log(`[ok] ${type}:${id} — durable=${ctx.durableSummary.length} chars | keyPeople=${ctx.keyPeople.length} | recentItems=${ctx.recentActivityDigest.length} | cutoff=${ctx.lastContextBuildAt}`);
    } else {
      console.log(`[skip] ${type}:${id} — no activity, skipped`);
    }
  } catch (err: any) {
    console.error(`[error] ${type}:${id} — ${err?.message}`);
  }
}

async function processBatch(items: Array<{ type: CrmEntityType; id: number }>): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    await Promise.all(batch.map(({ type, id }) => processRecord(type, id)));
    console.log(`  … processed ${Math.min(i + BATCH, items.length)} / ${items.length}`);
  }
}

async function main(): Promise<void> {
  console.log(`\n=== CRM Intelligence Context Backfill ===`);
  console.log(`Mode: ${dryRun ? "DRY RUN" : forceRebuild ? "FORCE REBUILD" : "INCREMENTAL"}`);

  if (recordArg) {
    const [type, rawId] = recordArg.split(":");
    const id = parseInt(rawId);
    if (!["lead", "account", "contact"].includes(type) || isNaN(id)) {
      console.error(`Invalid --record format. Expected: lead:42 | account:7 | contact:13`);
      process.exit(1);
    }
    console.log(`\nProcessing single record: ${type}:${id}`);
    await processRecord(type as CrmEntityType, id);
    console.log("\nDone.");
    return;
  }

  // Process all entity types
  for (const type of ["lead", "account", "contact"] as CrmEntityType[]) {
    const ids = await loadIds(`${type}s`);
    console.log(`\n[${type}] ${ids.length} records`);
    if (ids.length > 0) {
      await processBatch(ids.map(id => ({ type, id })));
    }
  }

  console.log("\n=== Backfill complete ===\n");
}

main().then(() => process.exit(0)).catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
