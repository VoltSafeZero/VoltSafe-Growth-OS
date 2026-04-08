import { db } from "../db";
import { emailMessages, emailAccounts, scheduledEmails } from "../../shared/schema";
import { eq, and, lte } from "drizzle-orm";
import { parseGmailMessage } from "./email-parser";
import { runAssociationEngine } from "./association-engine";
import { routeEmailToFolders } from "./email-folder-router";
import { log } from "../index";

// Trevor's user ID — the only Gmail user connected in Phase 1
const TREVOR_USER_ID = 4;

// ─── Per-account sync (S2 core) ──────────────────────────────────────────────
// Syncs one email_accounts row. All emails inserted are stamped with that
// account's owner_user_id and source_account_id so isolation is guaranteed.
export async function syncEmailAccount(
  accountId: number,
  limit = 100
): Promise<{ processed: number; newMessages: number }> {
  // 1. Load the account record
  const [account] = await db
    .select()
    .from(emailAccounts)
    .where(and(eq(emailAccounts.id, accountId), eq(emailAccounts.syncEnabled, true)))
    .limit(1);

  if (!account) {
    log(`[gmail-sync] account ${accountId} not found or sync disabled — skipping`);
    return { processed: 0, newMessages: 0 };
  }

  if (account.authStatus === "revoked" || account.authStatus === "error") {
    log(`[gmail-sync] account ${accountId} (${account.emailAddress}) auth_status=${account.authStatus} — skipping`);
    return { processed: 0, newMessages: 0 };
  }

  const ownerUserId = account.userId;

  // 2. Get Gmail client — Phase 1: always Trevor's system_settings token
  let gmailClient: any;
  try {
    const { getGmailClient } = await import("../gmail-oauth");
    gmailClient = await getGmailClient();
  } catch (err: any) {
    log(`[gmail-sync] account ${accountId} token error: ${err.message}`);
    await db.update(emailAccounts)
      .set({ authStatus: "expired", syncErrorMessage: err.message, updatedAt: new Date() })
      .where(eq(emailAccounts.id, accountId));
    return { processed: 0, newMessages: 0 };
  }

  // 3. Get my domain for direction classification
  let myDomain = account.emailAddress.split("@")[1] || "voltsafe.com";

  // 4. Fetch message list
  const listRes = await gmailClient.users.messages.list({
    userId: "me",
    maxResults: limit,
    q: "in:inbox OR in:sent",
  });
  const messageIds = listRes.data.messages || [];

  let newCount = 0;
  let processedCount = 0;

  for (const { id } of messageIds) {
    if (!id) continue;
    const existing = await db
      .select({ id: emailMessages.id })
      .from(emailMessages)
      .where(eq(emailMessages.gmailMessageId, id))
      .limit(1);
    if (existing.length > 0) { processedCount++; continue; }

    try {
      const msgRes = await gmailClient.users.messages.get({
        userId: "me", id, format: "full",
      });
      const parsed = parseGmailMessage(msgRes.data as any, myDomain);
      const [inserted] = await db
        .insert(emailMessages)
        .values({
          ...parsed,
          ownerUserId,
          sourceAccountId: account.id,
        })
        .onConflictDoNothing()
        .returning();

      if (inserted) {
        await runAssociationEngine(inserted.id);
        await routeEmailToFolders(inserted.id, ownerUserId, inserted.fromEmail ?? "");
        newCount++;
      }
    } catch (msgErr: any) {
      log(`[gmail-sync] Error processing message ${id}: ${msgErr.message}`);
    }
    processedCount++;
  }

  // 5. Stamp last_sync_at on success
  await db.update(emailAccounts)
    .set({
      lastSyncAt: new Date(),
      authStatus: "active",
      syncErrorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(emailAccounts.id, accountId));

  log(`[gmail-sync] account ${accountId} (${account.emailAddress}) — processed: ${processedCount}, new: ${newCount}`);
  return { processed: processedCount, newMessages: newCount };
}

// ─── runGmailSync: backwards-compat wrapper ───────────────────────────────────
// Finds all active email_accounts and delegates to syncEmailAccount.
// Phase 1: only one account exists (Trevor's). Phase 2: iterates all.
export async function runGmailSync(limit = 100): Promise<{ processed: number; newMessages: number }> {
  const accounts = await db
    .select()
    .from(emailAccounts)
    .where(and(eq(emailAccounts.isActive, true), eq(emailAccounts.syncEnabled, true)));

  if (accounts.length === 0) {
    log("[gmail-sync] No active email accounts — skipping");
    return { processed: 0, newMessages: 0 };
  }

  let totalProcessed = 0;
  let totalNew = 0;

  for (const acct of accounts) {
    const result = await syncEmailAccount(acct.id, limit);
    totalProcessed += result.processed;
    totalNew += result.newMessages;
  }

  return { processed: totalProcessed, newMessages: totalNew };
}

// ─── Scheduled email sender ───────────────────────────────────────────────────
async function runScheduledEmailSender() {
  const now = new Date();
  const due = await db.select().from(scheduledEmails).where(
    and(eq(scheduledEmails.status, "pending"), lte(scheduledEmails.scheduledAt, now))
  );
  if (!due.length) return;
  const { sendEmail } = await import("../gmail");
  for (const email of due) {
    try {
      await sendEmail(email.to, email.subject || "", email.body, email.threadId ?? undefined);
      await db.update(scheduledEmails).set({ status: "sent", sentAt: new Date() }).where(eq(scheduledEmails.id, email.id));
      log(`[gmail-scheduled] Sent scheduled email #${email.id} to ${email.to}`);
    } catch (err: any) {
      await db.update(scheduledEmails).set({ status: "failed", error: err.message }).where(eq(scheduledEmails.id, email.id));
      log(`[gmail-scheduled] Failed to send scheduled email #${email.id}: ${err.message}`);
    }
  }
}

const HOUR_MS = 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

export function startHourlySyncScheduler() {
  log("[gmail-sync] Hourly sync scheduler started");

  setInterval(async () => {
    try {
      log("[gmail-sync] Running scheduled sync…");
      await runGmailSync(200);
    } catch (err: any) {
      log(`[gmail-sync] Scheduled sync error: ${err.message}`);
    }
  }, HOUR_MS);

  setInterval(async () => {
    try { await runScheduledEmailSender(); } catch {}
  }, MIN_MS);
}
