import path from "path";
import { db } from "../db";
import { emailMessages, emailAccounts, scheduledEmails, users } from "../../shared/schema";
import { eq, and, lte, desc, inArray } from "drizzle-orm";
import { parseGmailMessage } from "./email-parser";
import { insertAttachmentsForMessage } from "./email-attachments";
import { runAssociationEngine } from "./association-engine";
import { routeEmailToFolders } from "./email-folder-router";
import { runAutoConfirmSweep, AUTO_CONFIRM_DRY_RUN } from "./auto-confirm";
import { log } from "../index";
import { applyTrustedSenderOverride } from "./gmail-incremental";
import { deriveEmailLabels, toDrizzleLabels } from "./inbox-policy";

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

  const myEmail = account.emailAddress;

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
        const parsed = parseGmailMessage(msgRes.data as any, myEmail);
        const { attachments, ...emailDataRaw } = parsed;
        // Apply trusted-sender guard so trusted senders never land in spam
        // even during a full page-by-page sync.
        const override = await applyTrustedSenderOverride(emailDataRaw, gmailClient);
        const emailData = { ...emailDataRaw, ...override };
        const derived = toDrizzleLabels(deriveEmailLabels(emailData.labelIds));
        const [inserted] = await db
          .insert(emailMessages)
          .values({ ...emailData, ownerUserId, sourceAccountId: account.id, ...derived })
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
            const derived = toDrizzleLabels(deriveEmailLabels(newLabelsJson));
            await db.update(emailMessages)
              .set({ labelIds: newLabelsJson, updatedAt: new Date(), ...derived })
              .where(eq(emailMessages.id, row.id));
            labelsRefreshed++;
          }
        } catch (e: any) {
          // 404 → message deleted in Gmail; mark as TRASH locally so it disappears from UNREAD
          if (e?.code === 404 || /Not Found/i.test(e?.message || "")) {
            const trashJson = JSON.stringify(["TRASH"]);
            const derived = toDrizzleLabels(deriveEmailLabels(trashJson));
            await db.update(emailMessages)
              .set({ labelIds: trashJson, updatedAt: new Date(), ...derived })
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
    // Resolve which user account to send from.
    // Prefer the stored userId; fall back to the first master_admin for legacy rows.
    let sendUserId: number | null = email.userId ?? null;
    if (!sendUserId) {
      const [admin] = await db.select({ id: users.id })
        .from(users)
        .where(eq(users.globalRole, "master_admin"))
        .limit(1);
      sendUserId = admin?.id ?? null;
    }

    if (!sendUserId) {
      const errMsg = "No userId on scheduled email and no master_admin found — cannot send";
      await db.update(scheduledEmails)
        .set({ status: "failed", error: errMsg })
        .where(eq(scheduledEmails.id, email.id));
      log(`[gmail-scheduled] #${email.id} FAILED: ${errMsg}`);
      continue;
    }

    log(`[gmail-scheduled] #${email.id} attempting send → to="${email.to}" subject="${email.subject}" userId=${sendUserId}`);

    try {
      // Apply the same pipeline as immediate sends:
      // normalise → CTA-wrap (injects tracked redirect URLs) → tracking pixel inject → send
      const baseUrl = process.env.PUBLIC_URL?.replace(/\/$/, "")
        ?? (process.env.REPL_SLUG && process.env.REPL_OWNER
          ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.replit.app`
          : "http://localhost:5000");

      const { normalizeOutboundHtml } = await import("./email-html-normalizer");
      const { wrapSignatureCtaLinks: wrapCta, updateSignatureCtaMessageIds: backfillCta } = await import("./signature-cta-tracker");
      const { injectTracking, generateTrackingId } = await import("../tracking");

      const cleanBody = normalizeOutboundHtml(email.body);
      // Extract plain address from "Name <addr>" or bare address
      const recipientEmail = String(email.to)
        .split(/[,;]/)[0]
        .replace(/^.*<([^>]+)>.*$/, "$1")
        .trim()
        .toLowerCase();

      let ctaWrappedBody = cleanBody;
      let _schedCtaTokens: string[] = [];
      try {
        const ctaRes = await wrapCta(cleanBody, sendUserId, recipientEmail, baseUrl);
        ctaWrappedBody = ctaRes.html;
        _schedCtaTokens = ctaRes.tokens;
      } catch (ctaErr: any) {
        log(`[gmail-scheduled] #${email.id} CTA wrap non-fatal: ${ctaErr.message}`);
      }

      const trackingId = generateTrackingId();

      // ── Convert signature/CTA images to CID inline parts (multipart/related) ──
      // Matches the immediate-send pipeline: CID avoids Apple Mail duplication and
      // ensures Gmail preserves images in the stored message body.
      const { extractCtaInlineImages } = await import("../gmail");
      const _p = path.resolve("uploads/cta-assets");
      const { html: _schedCidHtml, inlineImages: _schedInlineImgs } = await extractCtaInlineImages(ctaWrappedBody, _p);
      log(`[gmail-scheduled] #${email.id} CID inlining: ${_schedInlineImgs.length} inline image(s)`);

      let trackedBody = _schedCidHtml;
      try {
        trackedBody = injectTracking(_schedCidHtml, trackingId, baseUrl);
      } catch (trackErr: any) {
        log(`[gmail-scheduled] #${email.id} tracking inject non-fatal: ${trackErr.message}`);
      }

      // IMPORTANT: sendEmail(userId, to, subject, body, threadId?, attachments?, accountId?, cc?, bcc?, ical?, inlineImages?)
      const result = await sendEmail(
        sendUserId,
        email.to,
        email.subject || "",
        trackedBody,
        email.threadId ?? undefined,
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        _schedInlineImgs,
      );

      if (result?.id && _schedCtaTokens.length > 0) {
        backfillCta(_schedCtaTokens, String(result.id)).catch((e: any) =>
          log(`[gmail-scheduled] #${email.id} CTA msgId backfill non-fatal: ${e.message}`)
        );
      }

      const sentMsgId = result?.id ?? null;
      await db.update(scheduledEmails)
        .set({ status: "sent", sentAt: new Date(), sentMessageId: sentMsgId })
        .where(eq(scheduledEmails.id, email.id));
      log(`[gmail-scheduled] #${email.id} SENT — gmailMsgId=${sentMsgId} to=${email.to}`);

      // Proactively trigger an incremental sync so the sent message appears in
      // Sent Mail within seconds rather than waiting up to 5 minutes.
      try {
        const { runIncrementalForAll } = await import("./gmail-incremental");
        await runIncrementalForAll();
        log(`[gmail-scheduled] #${email.id} post-send sync complete`);
      } catch (syncErr: any) {
        log(`[gmail-scheduled] #${email.id} post-send sync error (non-fatal): ${syncErr.message}`);
      }
    } catch (err: any) {
      await db.update(scheduledEmails)
        .set({ status: "failed", error: err.message })
        .where(eq(scheduledEmails.id, email.id));
      log(`[gmail-scheduled] #${email.id} FAILED: ${err.message}`);
    }
  }
}

const HOUR_MS = 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

const runIncremental = async () => {
  const { runIncrementalForAll } = await import("./gmail-incremental");
  log("[gmail-sync] Scheduled incremental sync…");
  const results = await runIncrementalForAll();
  const totals = results.reduce(
    (acc, r) => ({ events: acc.events + r.events, added: acc.added + r.added, fellBack: acc.fellBack || r.fellBack }),
    { events: 0, added: 0, fellBack: false },
  );
  log(`[gmail-sync] Incremental done — accounts=${results.length} events=${totals.events} added=${totals.added}${totals.fellBack ? " (one or more fell back to paginated)" : ""}`);
};

export function startHourlySyncScheduler() {
  log("[gmail-sync] Sync scheduler started — incremental=5min, label-refresh=60min");
  log(`[auto-confirm] Sweep registered — dry-run=${AUTO_CONFIRM_DRY_RUN}, scope=contact, threshold=90`);

  // Run one incremental pass 30s after boot so emails don't wait up to 5 min after a restart
  setTimeout(async () => {
    try { await runIncremental(); } catch (err: any) {
      log(`[gmail-sync] Startup sync error: ${err.message}`);
    }
  }, 30_000);

  // Catch-up paginated sync 90s after boot: fetches the last 30 days via the
  // Gmail messages.list API (idempotent — onConflictDoNothing). Recovers any
  // messages that the incremental historyId path skipped during an outage or
  // container sleep (Replit dev containers can sleep for days, causing the
  // historyId to expire and leaving a gap of missed emails).
  // 30 days × 100 messages/page × 50 pages = up to 5,000 messages per account.
  setTimeout(async () => {
    try {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      log(`[gmail-sync] Startup catch-up paginated sync since=${since} (last 30 days)…`);
      const r = await runGmailSync({ maxPages: 50, pageSize: 100, since, refreshLabels: false });
      log(`[gmail-sync] Catch-up done — pages=${r.pages} processed=${r.processed} new=${r.newMessages}${r.hitPageLimit ? " (hit page cap — some older messages may still be missing; use deep-backfill)" : ""}`);
    } catch (err: any) {
      log(`[gmail-sync] Catch-up sync error: ${err.message}`);
    }
  }, 90_000);

  // Incremental sync every 5 minutes (historyId-based, very lightweight Gmail API calls)
  setInterval(async () => {
    try { await runIncremental(); } catch (err: any) {
      log(`[gmail-sync] Scheduled sync error: ${err.message}`);
    }
  }, 5 * MIN_MS);

  // Label-refresh pass every 60 minutes to catch read-state changes from mobile clients
  setInterval(async () => {
    try {
      await runGmailSync({ maxPages: 1, pageSize: 100, refreshLabels: true });
    } catch (err: any) {
      log(`[gmail-sync] Label refresh error: ${err.message}`);
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
