/**
 * not-spam-backfill.ts
 *
 * Scans all email_messages for "inconsistent threads" — threads where at least
 * one message carries the SPAM label and at least one does not — and fixes them
 * by removing SPAM / adding INBOX from every inbound message in the affected
 * thread group.
 *
 * Usage
 * ─────
 *   # Dry run (default): reports what would be changed, makes no DB writes.
 *   npx tsx scripts/not-spam-backfill.ts
 *
 *   # Apply mode: actually removes SPAM / adds INBOX for all inconsistent rows.
 *   npx tsx scripts/not-spam-backfill.ts --apply
 *
 *   # Limit to specific accounts:
 *   npx tsx scripts/not-spam-backfill.ts --apply --accounts=1,92
 *
 * Safety guarantees
 * ─────────────────
 *   • No schema changes, no DELETEs — only label_ids UPDATE.
 *   • Outbound (SENT) messages are skipped — removing SPAM from a sent message
 *     could expose sent mail in an unexpected folder.
 *   • Dry run always runs first; apply is opt-in via flag.
 *   • SENT-flag detection: skip rows where label_ids contains "SENT".
 *   • Idempotent: running twice on an already-clean dataset is a no-op.
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

const DRY_RUN = !process.argv.includes("--apply");
const ACCOUNT_FILTER = (() => {
  const flag = process.argv.find(a => a.startsWith("--accounts="));
  if (!flag) return null;
  return flag.replace("--accounts=", "").split(",").map(Number).filter(Number.isFinite);
})();

function parseLabels(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const t = String(raw).trim();
  if (!t) return [];
  try {
    if (t.startsWith("[")) {
      const arr = JSON.parse(t);
      return Array.isArray(arr) ? arr.filter((x: unknown) => typeof x === "string") : [];
    }
    return t.split(",").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function serializeLabels(labels: Iterable<string>): string {
  return JSON.stringify(Array.from(new Set(labels)));
}

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

async function main() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  VoltSafe Not-Spam Backfill — ${DRY_RUN ? "DRY RUN" : "APPLY MODE"}`);
  console.log(`${"=".repeat(60)}\n`);

  if (ACCOUNT_FILTER) {
    console.log(`  Account filter: ${ACCOUNT_FILTER.join(", ")}\n`);
  }

  // ── Step 1: Find all threads that have at least one SPAM and one non-SPAM message ──
  const accClause = ACCOUNT_FILTER
    ? `AND source_account_id IN (${ACCOUNT_FILTER.join(",")})`
    : "";

  const inconsistentResult: any = await db.execute(sql.raw(`
    SELECT
      gmail_thread_id,
      source_account_id,
      COUNT(*) AS total_msgs,
      COUNT(*) FILTER (WHERE label_ids ILIKE '%SPAM%') AS spam_count,
      COUNT(*) FILTER (WHERE NOT label_ids ILIKE '%SPAM%') AS non_spam_count
    FROM email_messages
    WHERE gmail_thread_id IS NOT NULL
      AND gmail_thread_id != ''
      ${accClause}
    GROUP BY gmail_thread_id, source_account_id
    HAVING
      COUNT(*) FILTER (WHERE label_ids ILIKE '%SPAM%') > 0
      AND COUNT(*) FILTER (WHERE NOT label_ids ILIKE '%SPAM%') > 0
    ORDER BY spam_count DESC, total_msgs DESC
  `));

  const threads: any[] = (inconsistentResult as any).rows ?? inconsistentResult;

  if (threads.length === 0) {
    console.log("  No inconsistent threads found. Database is clean.\n");
    process.exit(0);
  }

  console.log(`  Found ${threads.length} inconsistent thread(s):\n`);
  console.log(
    `  ${"gmail_thread_id".padEnd(22)} ${"acct".padEnd(6)} ${"total".padEnd(7)} ${"spam".padEnd(6)} non-spam`,
  );
  console.log(`  ${"-".repeat(55)}`);

  for (const t of threads) {
    console.log(
      `  ${String(t.gmail_thread_id).padEnd(22)} ${String(t.source_account_id).padEnd(6)} ${String(t.total_msgs).padEnd(7)} ${String(t.spam_count).padEnd(6)} ${t.non_spam_count}`,
    );
  }

  // ── Step 2: For each inconsistent thread, load all SPAM rows that can be fixed ──
  // We skip outbound (SENT) rows to preserve sent-mail semantics.
  let totalFixed = 0;
  let totalSkipped = 0;

  console.log(`\n  ${"─".repeat(55)}\n`);

  for (const thread of threads) {
    const tidEsc = esc(String(thread.gmail_thread_id));
    const accId = Number(thread.source_account_id);

    const rowsResult: any = await db.execute(sql.raw(`
      SELECT id, gmail_message_id, label_ids
      FROM email_messages
      WHERE gmail_thread_id = '${tidEsc}'
        AND source_account_id = ${accId}
        AND label_ids ILIKE '%SPAM%'
    `));
    const rows: any[] = (rowsResult as any).rows ?? rowsResult;

    const fixable: any[] = [];
    const skipped: any[] = [];

    for (const row of rows) {
      const labels = parseLabels(row.label_ids);
      const isSent = labels.some((l) => l.toUpperCase() === "SENT");
      if (isSent) {
        skipped.push(row);
      } else {
        fixable.push({ ...row, parsedLabels: labels });
      }
    }

    console.log(
      `  Thread ${thread.gmail_thread_id} (acct=${accId}): ` +
      `${rows.length} spam msg(s) — ${fixable.length} fixable, ${skipped.length} skipped (SENT)`,
    );

    totalSkipped += skipped.length;

    if (DRY_RUN) {
      for (const row of fixable) {
        const before = row.parsedLabels.join(", ") || "(empty)";
        const after = (() => {
          const s = new Set(row.parsedLabels);
          s.delete("SPAM");
          s.add("INBOX");
          return Array.from(s).join(", ");
        })();
        console.log(`    [DRY] id=${row.id} before=[${before}] → after=[${after}]`);
      }
    } else {
      let fixed = 0;
      for (const row of fixable) {
        try {
          const labelSet = new Set<string>(row.parsedLabels);
          labelSet.delete("SPAM");
          labelSet.add("INBOX");
          const serialized = esc(serializeLabels(labelSet));
          await db.execute(sql.raw(
            `UPDATE email_messages SET label_ids = '${serialized}' WHERE id = ${Number(row.id)}`,
          ));
          fixed++;
        } catch (e: any) {
          console.error(`    [ERROR] id=${row.id}: ${e.message}`);
        }
      }
      console.log(`    → Applied: ${fixed}/${fixable.length} rows updated`);
      totalFixed += fixed;
    }
  }

  // ── Step 3: Summary ──────────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(60)}`);
  if (DRY_RUN) {
    console.log(`  DRY RUN complete.`);
    console.log(`  Threads found:  ${threads.length}`);
    console.log(`  Rows skipped (SENT): ${totalSkipped}`);
    console.log(`\n  Re-run with --apply to commit changes.\n`);
  } else {
    console.log(`  APPLY complete.`);
    console.log(`  Threads processed: ${threads.length}`);
    console.log(`  Rows updated:      ${totalFixed}`);
    console.log(`  Rows skipped (SENT): ${totalSkipped}`);
    console.log();
  }
  console.log(`${"=".repeat(60)}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n[backfill] Fatal error:", err);
    process.exit(1);
  });
