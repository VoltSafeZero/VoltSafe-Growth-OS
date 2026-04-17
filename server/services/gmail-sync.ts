import { db } from "../db";
import { emailMessages, emailAccounts, scheduledEmails } from "../../shared/schema";
import { eq, and, lte, desc, inArray } from "drizzle-orm";
import { parseGmailMessage } from "./email-parser";
import { insertAttachmentsForMessage } from "./email-attachments";
import { runAssociationEngine } from "./association-engine";
import { routeEmailToFolders } from "./email-folder-router";
import { runAutoConfirmSweep, AUTO_CONFIRM_DRY_RUN } from "./auto-confirm";
import { log } from "../index";

// Multi-user note: this module is fully account-scoped. Each call to
// syncEmailAccount() resolves credentials via the account's owner
// (account.userId), so any number of personal/shared accounts across any
// number of users sync correctly without per-user assumptions.

// Default page size when paginating (Gmail max is 500)
const PAGE_SIZE = 100;
// Hard ceiling so a single sync can't run forever
const ABSOLUTE_MAX_PAGES = 500;
// Refresh label_ids for the N most recent stored messages on each sync
// (so read-state changes made in Gmail/Spark propagate back to our UI)
const LABEL_REFRESH_RECENT = 200;

export type SyncOpts = {
  /** Cap pages walked (defaults to 1 for the legacy "shallow" behavior). */
  maxPages?: number;
  /** Page size (1..500). */
  pageSize?: number;
  /** Gmail search query override. Default: "in:inbox OR in:sent". */
  q?: string;
  /** Only fetch messages newer than this date (YYYY-MM-DD). Appends "after:". */
  since?: string;
  /** If true, re-fetch label_ids for the LABEL_REFRESH_RECENT latest stored messages. */
  refreshLabels?: boolean;
};

export type SyncResult = {
  processed: number;
  newMessages: number;
  pages: number;
  labelsRefreshed: number;
  hitPageLimit: boolean;
};

// ─── Per-account sync ────────────────────────────────────────────────────────
export async function syncEmailAccount(
  accountId: number,
  opts: SyncOpts | number = {},
): Promise<SyncResult> {
  // Back-compat: legacy callers passed a number `limit`
  const o: SyncOpts = typeof opts === "number" ? { maxPages: 1, pageSize: opts } : opts;
  const pageSize = Math.max(1, Math.min(500, o.pageSize ?? PAGE_SIZE));
  const maxPages = Math.max(1, Math.min(ABSOLUTE_MAX_PAGES, o.maxPages ?? 1));
  const refreshLabels = o.refreshLabels ?? false;

  const [account] = await db
    .select()
    .from(emailAccounts)
    .where(and(eq(emailAccounts.id, accountId), eq(emailAccounts.syncEnabled, true)))
    .limit(1);

  const empty: SyncResult = { processed: 0, newMessages: 0, pages: 0, labelsRefreshed: 0, hitPageLimit: false };

  if (!account) {
    log(`[gmail-sync] account ${accountId} not found or sync disabled — skipping`);
    return empty;
  }
  if (account.authStatus === "revoked" || account.authStatus === "error") {
    log(`[gmail-sync] account ${accountId} (${account.emailAddress}) auth_status=${account.authStatus} — skipping`);
    return empty;
  }

  const ownerUserId = account.userId;
  let gmailClient: any;
  try {
    const { getGmailClient } = await import("../gmail-oauth");
    // CRITICAL: pass account.id so the client uses THIS account's token. Without
    // accountId, getGmailClient resolves the owner's PERSONAL token, which would
    // fetch the owner's personal mailbox while we tag the rows with this
    // account's source_account_id — a cross-mailbox data leak for shared inboxes.
    gmailClient = await getGmailClient(ownerUserId, account.id);
  } catch (err: any) {
    log(`[gmail-sync] account ${accountId} token error: ${err.message}`);
    await db.update(emailAccounts)
      .set({ authStatus: "expired", syncErrorMessage: err.message, updatedAt: new Date() })
      .where(eq(emailAccounts.id, accountId));
    return empty;
  }

  const myDomain = account.emailAddress.split("@")[1] || "voltsafe.com";

  let q = o.q ?? "in:inbox OR in:sent";
  if (o.since) q = `${q} after:${o.since.replace(/-/g, "/")}`;

  let pageToken: string | undefined = undefined;
  let pages = 0;
  let processed = 0;
  let newCount = 0;
  let hitPageLimit = false;

  // ── Fetch loop ──────────────────────────────────────────────────────────
  do {
    const listRes = await gmailClient.users.messages.list({
      userId: "me",
      maxResults: pageSize,
      q,
      ...(pageToken ? { pageToken } : {}),
    });
    pages++;
    const messageIds = listRes.data.messages || [];
    pageToken = listRes.data.nextPageToken ?? undefined;

    for (const { id } of messageIds) {
      if (!id) continue;
      const existing = await db
        .select({ id: emailMessages.id })
        .from(emailMessages)
        .where(eq(emailMessages.gmailMessageId, id))
        .limit(1);
      if (existing.length > 0) { processed++; continue; }

      try {
        const msgRes = await gmailClient.users.messages.get({ userId: "me", id, format: "full" });
        const parsed = parseGmailMessage(msgRes.data as any, myDomain);
        const { attachments, ...emailData } = parsed;
        const [inserted] = await db
          .insert(emailMessages)
          .values({ ...emailData, ownerUserId, sourceAccountId: account.id })
          .onConflictDoNothing()
          .returning();

        if (inserted) {
          if (attachments.length) await insertAttachmentsForMessage(inserted.id, attachments);
          await runAssociationEngine(inserted.id);
          await routeEmailToFolders(inserted.id, ownerUserId, inserted.fromEmail ?? "");
          newCount++;
        }
      } catch (msgErr: any) {
        log(`[gmail-sync] Error processing message ${id}: ${msgErr.message}`);
      }
      processed++;
    }

    if (pages >= maxPages) {
      if (pageToken) hitPageLimit = true;
      break;
    }
  } while (pageToken);

  // ── Label refresh: keep recent messages' read/star/label state in sync ──
  let labelsRefreshed = 0;
  if (refreshLabels) {
    try {
      const recent = await db
        .select({ id: emailMessages.id, gmailMessageId: emailMessages.gmailMessageId, labelIds: emailMessages.labelIds })
        .from(emailMessages)
        .where(eq(emailMessages.sourceAccountId, account.id))
        .orderBy(desc(emailMessages.sentAt))
        .limit(LABEL_REFRESH_RECENT);

      for (const row of recent) {
        if (!row.gmailMessageId) continue;
        try {
          const meta = await gmailClient.users.messages.get({
            userId: "me",
            id: row.gmailMessageId,
            format: "metadata",
            metadataHeaders: [],
          });
          const newLabels: string[] = meta.data.labelIds || [];
          const newLabelsJson = JSON.stringify(newLabels);
          if (newLabelsJson !== (row.labelIds || "")) {
            await db.update(emailMessages)
              .set({ labelIds: newLabelsJson, updatedAt: new Date() })
              .where(eq(emailMessages.id, row.id));
            labelsRefreshed++;
          }
        } catch (e: any) {
          // 404 → message deleted in Gmail; mark as TRASH locally so it disappears from UNREAD
          if (e?.code === 404 || /Not Found/i.test(e?.message || "")) {
            await db.update(emailMessages)
              .set({ labelIds: JSON.stringify(["TRASH"]), updatedAt: new Date() })
              .where(eq(emailMessages.id, row.id));
            labelsRefreshed++;
          }
        }
      }
    } catch (err: any) {
      log(`[gmail-sync] label refresh failed for account ${accountId}: ${err.message}`);
    }
  }

  await db.update(emailAccounts)
    .set({
      lastSyncAt: new Date(),
      authStatus: "active",
      syncErrorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(emailAccounts.id, accountId));

  log(`[gmail-sync] account ${accountId} (${account.emailAddress}) — pages=${pages} processed=${processed} new=${newCount} labelsRefreshed=${labelsRefreshed}${hitPageLimit ? " (hit page cap, more available)" : ""}`);
  return { processed, newMessages: newCount, pages, labelsRefreshed, hitPageLimit };
}

// ─── runGmailSync: backwards-compat wrapper ──────────────────────────────────
export async function runGmailSync(
  opts: SyncOpts | number = {},
): Promise<SyncResult> {
  const accounts = await db
    .select()
    .from(emailAccounts)
    .where(and(eq(emailAccounts.isActive, true), eq(emailAccounts.syncEnabled, true)));

  const empty: SyncResult = { processed: 0, newMessages: 0, pages: 0, labelsRefreshed: 0, hitPageLimit: false };
  if (accounts.length === 0) {
    log("[gmail-sync] No active email accounts — skipping");
    return empty;
  }

  const agg: SyncResult = { ...empty };
  for (const acct of accounts) {
    const r = await syncEmailAccount(acct.id, opts);
    agg.processed += r.processed;
    agg.newMessages += r.newMessages;
    agg.pages += r.pages;
    agg.labelsRefreshed += r.labelsRefreshed;
    agg.hitPageLimit = agg.hitPageLimit || r.hitPageLimit;
  }
  return agg;
}

// ─── Scheduled email sender ──────────────────────────────────────────────────
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
  log("[gmail-sync] Hourly sync scheduler started — pagination + label-refresh enabled");
  log(`[auto-confirm] Sweep registered — dry-run=${AUTO_CONFIRM_DRY_RUN}, scope=contact, threshold=90`);

  setInterval(async () => {
    try {
      // Phase 2A: prefer historyId-based incremental sync; fall back to paginated walk.
      const { runIncrementalForAll } = await import("./gmail-incremental");
      log("[gmail-sync] Scheduled incremental sync…");
      const results = await runIncrementalForAll();
      const totals = results.reduce(
        (acc, r) => ({ events: acc.events + r.events, added: acc.added + r.added, fellBack: acc.fellBack || r.fellBack }),
        { events: 0, added: 0, fellBack: false },
      );
      log(`[gmail-sync] Incremental done — accounts=${results.length} events=${totals.events} added=${totals.added}${totals.fellBack ? " (one or more fell back to paginated)" : ""}`);
      // Always run a small label-refresh pass on top stored msgs to catch read-state changes
      // even when no history events fired (e.g. user marked-read in mobile app between syncs).
      await runGmailSync({ maxPages: 1, pageSize: 100, refreshLabels: true });
    } catch (err: any) {
      log(`[gmail-sync] Scheduled sync error: ${err.message}`);
    }
  }, HOUR_MS);

  setInterval(async () => {
    try { await runAutoConfirmSweep(); } catch (err: any) {
      log(`[auto-confirm] Scheduler error: ${err.message}`);
    }
  }, HOUR_MS);

  setInterval(async () => {
    try { await runScheduledEmailSender(); } catch {}
  }, MIN_MS);
}
