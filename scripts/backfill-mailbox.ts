/**
 * scripts/backfill-mailbox.ts
 *
 * Backfills missing emails for one or more @voltsafe.com mailboxes by fetching
 * Gmail messages.list for a configurable date window and inserting/updating
 * any messages not already in the local DB.
 *
 * Usage:
 *   npx tsx scripts/backfill-mailbox.ts --account trevor@voltsafe.com --days 30 --dry-run
 *   npx tsx scripts/backfill-mailbox.ts --account sales@voltsafe.com --days 90 --apply
 *   npx tsx scripts/backfill-mailbox.ts --account all --days 365 --apply
 *
 * Options:
 *   --account <email|all>  Email address of the mailbox to backfill (or "all").
 *   --days <N>             How many days back to fetch (default 30, max 365).
 *   --dry-run              Report what would be inserted/updated without writing.
 *   --apply                Write changes to the database.
 *   --page-size <N>        Messages per Gmail API page (default 100, max 500).
 *   --max-pages <N>        Maximum pages to walk per account (default 100).
 */

import { db } from "../server/db";
import { emailAccounts, emailMessages } from "../shared/schema";
import { eq, and } from "drizzle-orm";

// ── Argument parsing ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function flag(name: string): boolean { return args.includes(`--${name}`); }
function opt(name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const accountArg = opt("account", "all");
const days       = Math.min(365, Math.max(1, Number(opt("days", "30")) || 30));
const pageSize   = Math.min(500, Math.max(1,  Number(opt("page-size", "100")) || 100));
const maxPages   = Math.min(500, Math.max(1,  Number(opt("max-pages", "100")) || 100));
const dryRun     = flag("dry-run") || !flag("apply");

if (!flag("dry-run") && !flag("apply")) {
  console.log("⚠️  Neither --dry-run nor --apply specified — defaulting to --dry-run. Pass --apply to write.");
}

const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

console.log(`\n=== VoltSafe Mail Backfill ===`);
console.log(`  account  : ${accountArg}`);
console.log(`  window   : last ${days} days (since ${since})`);
console.log(`  mode     : ${dryRun ? "DRY-RUN (no writes)" : "APPLY (will insert/update)"}`);
console.log(`  pageSize : ${pageSize} · maxPages : ${maxPages}`);
console.log("");

async function main() {
  // ── Load accounts ──────────────────────────────────────────────────────────
  const allAccounts = await db.select().from(emailAccounts)
    .where(and(eq(emailAccounts.isActive, true), eq(emailAccounts.syncEnabled, true)));

  const targets = accountArg === "all"
    ? allAccounts
    : allAccounts.filter(a => a.emailAddress?.toLowerCase() === accountArg.toLowerCase());

  if (targets.length === 0) {
    console.error(`❌ No active synced account found matching "${accountArg}".`);
    console.error(`   Active accounts: ${allAccounts.map(a => a.emailAddress).join(", ") || "(none)"}`);
    process.exit(1);
  }

  console.log(`Found ${targets.length} account(s): ${targets.map(a => a.emailAddress).join(", ")}\n`);

  let grandTotal = 0;
  let grandNew   = 0;
  let grandUpdated = 0;
  let grandSkipped = 0;

  for (const account of targets) {
    const accountId = account.id;
    const email     = account.emailAddress;
    console.log(`─── ${email} (id=${accountId}) ───`);

    let gmailClient: any;
    try {
      const { getGmailClient } = await import("../server/gmail-oauth");
      gmailClient = await getGmailClient(account.userId, accountId);
    } catch (e: any) {
      console.error(`  ❌ Token error: ${e.message} — skipping`);
      continue;
    }

    const q = `in:inbox OR in:sent after:${since.replace(/-/g, "/")}`;
    console.log(`  Gmail query: "${q}"`);

    let pageToken: string | undefined;
    let pages     = 0;
    let fetched   = 0;
    let inserted  = 0;
    let updated   = 0;
    let skipped   = 0;
    let hitCap    = false;

    do {
      let listRes: any;
      try {
        listRes = await gmailClient.users.messages.list({
          userId: "me",
          maxResults: pageSize,
          q,
          ...(pageToken ? { pageToken } : {}),
        });
      } catch (e: any) {
        console.error(`  ❌ messages.list error on page ${pages + 1}: ${e.message}`);
        break;
      }

      pages++;
      pageToken = listRes.data.nextPageToken ?? undefined;
      const ids: { id: string }[] = listRes.data.messages || [];
      fetched += ids.length;

      if (ids.length === 0) break;

      for (const { id } of ids) {
        if (!id) continue;

        // Check existing
        const [existing] = await db.select({ id: emailMessages.id, labelIds: emailMessages.labelIds })
          .from(emailMessages)
          .where(eq(emailMessages.gmailMessageId, id))
          .limit(1);

        if (existing) {
          // Refresh labels in apply mode
          if (!dryRun) {
            try {
              const meta = await gmailClient.users.messages.get({
                userId: "me", id, format: "metadata", metadataHeaders: [],
              });
              const newLabels = JSON.stringify(meta.data.labelIds || []);
              if (newLabels !== existing.labelIds) {
                await db.update(emailMessages)
                  .set({ labelIds: newLabels, updatedAt: new Date() })
                  .where(eq(emailMessages.id, existing.id));
                updated++;
                console.log(`  ↺ labels updated: ${id}`);
              } else {
                skipped++;
              }
            } catch { skipped++; }
          } else {
            skipped++;
          }
          continue;
        }

        // Message missing from local DB
        if (dryRun) {
          console.log(`  + would insert: ${id} (missing from DB)`);
          inserted++;
          continue;
        }

        // Apply: fetch full message and insert
        try {
          const { parseGmailMessage } = await import("../server/services/email-parser");
          const { insertAttachmentsForMessage } = await import("../server/services/email-attachments");
          const { runAssociationEngine } = await import("../server/services/association-engine");
          const { routeEmailToFolders } = await import("../server/services/email-folder-router");
          const { applyTrustedSenderOverride } = await import("../server/services/gmail-incremental");

          const msgRes = await gmailClient.users.messages.get({ userId: "me", id, format: "full" });
          const parsed = parseGmailMessage(msgRes.data as any, email ?? "");
          const { attachments, ...emailDataRaw } = parsed;
          const override = await applyTrustedSenderOverride(emailDataRaw, gmailClient);
          const emailData = { ...emailDataRaw, ...override };

          const [row] = await db.insert(emailMessages)
            .values({ ...emailData, ownerUserId: account.userId, sourceAccountId: accountId })
            .onConflictDoNothing()
            .returning();

          if (row) {
            if (attachments.length) await insertAttachmentsForMessage(row.id, attachments);
            await runAssociationEngine(row.id);
            await routeEmailToFolders(row.id, account.userId, row.fromEmail ?? "");
            inserted++;
            console.log(`  + inserted: ${id} — "${(emailData as any).subject || "(no subject)"}" from=${(emailData as any).fromEmail}`);
          } else {
            skipped++;
          }
        } catch (e: any) {
          console.error(`  ❌ insert error for ${id}: ${e.message}`);
          skipped++;
        }
      }

      if (pages >= maxPages) {
        if (pageToken) hitCap = true;
        break;
      }
    } while (pageToken);

    const status = hitCap ? " (hit page cap — run again with --max-pages higher for more)" : "";
    console.log(`  pages=${pages} fetched=${fetched} ${dryRun ? "would-insert" : "inserted"}=${inserted} updated=${updated} skipped=${skipped}${status}\n`);

    grandTotal   += fetched;
    grandNew     += inserted;
    grandUpdated += updated;
    grandSkipped += skipped;
  }

  console.log("═══ Summary ═══");
  console.log(`  Accounts   : ${targets.length}`);
  console.log(`  Fetched    : ${grandTotal} Gmail messages checked`);
  console.log(`  ${dryRun ? "Would insert" : "Inserted"}  : ${grandNew} missing messages`);
  console.log(`  Labels upd : ${grandUpdated}`);
  console.log(`  Already OK : ${grandSkipped}`);
  if (dryRun && grandNew > 0) {
    console.log(`\n  → Run with --apply to write ${grandNew} missing message(s) to the database.`);
  } else if (!dryRun && grandNew === 0) {
    console.log(`\n  ✓ All messages already in database — nothing to add.`);
  }
  console.log("");

  process.exit(0);
}

main().catch(err => {
  console.error("Fatal:", err?.message ?? err);
  process.exit(1);
});
