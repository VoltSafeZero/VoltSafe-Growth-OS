// Phase 2A — historyId-based incremental Gmail sync.
// Uses Gmail's users.history.list to fetch only the changes since the last
// known historyId, instead of re-listing the latest pages every time.
// Falls back to full paginated sync if the stored historyId is too old (404).
import { db } from "../db";
import { emailAccounts, emailMessages } from "../../shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { parseGmailMessage } from "./email-parser";
import { insertAttachmentsForMessage } from "./email-attachments";
import { runAssociationEngine } from "./association-engine";
import { routeEmailToFolders } from "./email-folder-router";
import { log } from "../index";
import { syncEmailAccount } from "./gmail-sync";

// ─── Inbox-visibility guard for category-tagged messages ─────────────────────
// Gmail can deliver inbound messages directly to a CATEGORY_* tab (Promotions,
// Updates, Social, Forums) WITHOUT the INBOX label when the user has configured
// that category to "skip inbox."  In VoltSafe, categories are metadata tags —
// not destination folders — so every inbound message must remain inbox-visible.
//
// The guard is applied:
//   1. On new message insertions (messagesAdded) — unconditionally for inbound.
//   2. On label-change events — only when the message is still UNREAD, to avoid
//      re-adding INBOX to messages the user has explicitly archived (archiving
//      removes both INBOX and UNREAD; an archived-but-unread pattern is rare and
//      we accept the small false-positive rather than permanently hiding mail).
//
// Exported so tests can verify the function directly.

const CATEGORY_LABEL_SET = ["CATEGORY_UPDATES", "CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"];
const SKIP_INBOX_LABELS  = ["SENT", "DRAFT", "SPAM", "TRASH"];

export function ensureInboxForCategoryLabels(labels: string[], requireUnread = false): string[] {
  const upper = labels.map(l => l.toUpperCase());
  if (upper.includes("INBOX")) return labels;                              // already fine
  if (!upper.some(l => CATEGORY_LABEL_SET.includes(l))) return labels;    // no category tag
  if (SKIP_INBOX_LABELS.some(l => upper.includes(l))) return labels;      // sent/draft/spam/trash
  if (requireUnread && !upper.includes("UNREAD")) return labels;           // read+archived path
  return [...labels, "INBOX"];
}

// ─── Trusted-sender override ─────────────────────────────────────────────────
// Exported so gmail-sync.ts (full page sync) can reuse the exact same guard.
//
// If a message arrives with a SPAM label but its sender is in
// spam_trusted_senders, we rewrite the labels (SPAM→INBOX) before saving
// locally and ask Gmail to move the thread to inbox (best-effort via
// threads.modify — no special OAuth scope required beyond gmail.modify).
//
// This is the primary enforcement mechanism. The Gmail Filters API
// (gmail.users.settings.filters.create) would be more permanent but requires
// the gmail.settings.basic scope which is not in our current OAuth grant.
export async function applyTrustedSenderOverride(
  emailData: { labelIds?: string | null; fromEmail?: string | null; gmailThreadId?: string | null },
  gmailClient: any,
): Promise<{ labelIds?: string | null }> {
  const rawLabels: string[] = (() => {
    if (!emailData.labelIds) return [];
    try { return JSON.parse(emailData.labelIds); } catch { return []; }
  })();

  if (!rawLabels.some((l: string) => l.toUpperCase() === "SPAM")) {
    return { labelIds: emailData.labelIds };
  }

  const fromEmail = emailData.fromEmail?.trim().toLowerCase();
  if (!fromEmail) return { labelIds: emailData.labelIds };

  try {
    const trusted = await db.execute(
      sql`SELECT 1 FROM spam_trusted_senders WHERE email = ${fromEmail} LIMIT 1`,
    );
    const rows: any[] = (trusted as any).rows ?? trusted;
    if (rows.length === 0) return { labelIds: emailData.labelIds };

    // Sender is trusted — rewrite labels: remove SPAM, ensure INBOX.
    const labelSet = new Set(rawLabels.map((l: string) => l.toUpperCase()));
    labelSet.delete("SPAM");
    labelSet.add("INBOX");
    const correctedLabels = JSON.stringify(Array.from(labelSet));

    // Best-effort: tell Gmail to also move the thread to inbox.
    if (emailData.gmailThreadId && gmailClient) {
      try {
        await gmailClient.users.threads.modify({
          userId: "me",
          id: emailData.gmailThreadId,
          requestBody: { removeLabelIds: ["SPAM"], addLabelIds: ["INBOX"] },
        });
        log(`[trusted-sender] auto-rescued thread=${emailData.gmailThreadId} from=${fromEmail}`);
      } catch { /* non-fatal — local label correction is applied regardless */ }
    }

    return { labelIds: correctedLabels };
  } catch {
    return { labelIds: emailData.labelIds };
  }
}

export type IncrementalResult = {
  ok: boolean;
  startHistoryId: string | null;
  endHistoryId: string | null;
  events: number;
  added: number;
  deleted: number;
  labelsChanged: number;
  fellBack: boolean;
  reason?: string;
};

const EMPTY: IncrementalResult = {
  ok: false,
  startHistoryId: null,
  endHistoryId: null,
  events: 0,
  added: 0,
  deleted: 0,
  labelsChanged: 0,
  fellBack: false,
};

// Persist the latest known historyId from the live Gmail profile.
async function captureProfileHistoryId(accountId: number, gmailClient: any): Promise<string | null> {
  try {
    const p = await gmailClient.users.getProfile({ userId: "me" });
    const hid = p.data.historyId ?? null;
    if (hid) {
      await db.update(emailAccounts)
        .set({ lastHistoryId: String(hid), updatedAt: new Date() })
        .where(eq(emailAccounts.id, accountId));
    }
    return hid ? String(hid) : null;
  } catch {
    return null;
  }
}

// Insert/upsert a single Gmail message into our DB by gmail_message_id.
// Phase 5 Commit 2: exported so the history-backfill helper (used by the
// /api/gmail/messages auto-overflow path) can reuse the exact same parsing,
// attachment-insertion, association-engine and folder-routing pipeline. We
// intentionally do NOT duplicate this logic — divergence would mean
// backfilled rows render differently from incrementally synced rows.
export async function upsertMessageById(
  gmailClient: any,
  gmailMessageId: string,
  ownerUserId: number,
  accountId: number,
  myEmail: string,
): Promise<{ inserted: boolean; updatedLabels: boolean }> {
  // Check existing
  const [existing] = await db
    .select({ id: emailMessages.id, labelIds: emailMessages.labelIds })
    .from(emailMessages)
    .where(eq(emailMessages.gmailMessageId, gmailMessageId))
    .limit(1);

  try {
    const msgRes = await gmailClient.users.messages.get({
      userId: "me",
      id: gmailMessageId,
      format: "full",
    });
    const parsed = parseGmailMessage(msgRes.data as any, myEmail);
    const { attachments, ...emailDataRaw } = parsed;
    // Apply trusted-sender guard before writing any labels to the DB.
    const override = await applyTrustedSenderOverride(emailDataRaw, gmailClient);
    const emailDataBase = { ...emailDataRaw, ...override };

    // Inbox-visibility guard: new inbound messages that arrive with only CATEGORY_*
    // labels (no INBOX) must still appear in the inbox.  Apply unconditionally on
    // insertion — no requireUnread because the message is brand-new.
    const insertLabels: string[] = (() => { try { return JSON.parse(emailDataBase.labelIds || "[]"); } catch { return []; } })();
    const fixedInsertLabels = ensureInboxForCategoryLabels(insertLabels, false);
    const emailData = fixedInsertLabels !== insertLabels
      ? { ...emailDataBase, labelIds: JSON.stringify(fixedInsertLabels) }
      : emailDataBase;

    if (!existing) {
      const [inserted] = await db
        .insert(emailMessages)
        .values({ ...emailData, ownerUserId, sourceAccountId: accountId })
        .onConflictDoNothing()
        .returning();
      if (inserted) {
        if (attachments.length) await insertAttachmentsForMessage(inserted.id, attachments);
        await runAssociationEngine(inserted.id);
        await routeEmailToFolders(inserted.id, ownerUserId, inserted.fromEmail ?? "");
        return { inserted: true, updatedLabels: false };
      }
      return { inserted: false, updatedLabels: false };
    }

    // Update label_ids if they changed — apply inbox-visibility guard before writing.
    // This is the critical path that was silently stripping INBOX from categorized
    // messages: upsertMessageById receives a full message.get() response from Gmail,
    // and Gmail does not include INBOX for messages it delivers to CATEGORY_* tabs.
    // We apply the same ensureInboxForCategoryLabels guard used in the label-change
    // path so the sync layer never overwrites local inbox visibility for unread mail.
    // requireUnread=true: archived messages have UNREAD removed by Gmail at archive
    // time, so we will not re-add INBOX to messages the user deliberately archived.
    if (parsed.labelIds && parsed.labelIds !== existing.labelIds) {
      const parsedLabels: string[] = (() => {
        try { return JSON.parse(parsed.labelIds); } catch { return []; }
      })();
      const guardedLabels = ensureInboxForCategoryLabels(parsedLabels, true /* requireUnread */);
      const labelIdsToWrite = guardedLabels !== parsedLabels
        ? JSON.stringify(guardedLabels)
        : parsed.labelIds;
      await db.update(emailMessages)
        .set({ labelIds: labelIdsToWrite, updatedAt: new Date() })
        .where(eq(emailMessages.id, existing.id));
      return { inserted: false, updatedLabels: true };
    }
    return { inserted: false, updatedLabels: false };
  } catch (e: any) {
    // 404 → message deleted server-side, mark TRASH locally
    if (e?.code === 404 || /Not Found/i.test(e?.message || "")) {
      if (existing) {
        await db.update(emailMessages)
          .set({ labelIds: JSON.stringify(["TRASH"]), updatedAt: new Date() })
          .where(eq(emailMessages.id, existing.id));
        return { inserted: false, updatedLabels: true };
      }
    }
    throw e;
  }
}

// Run an incremental sync for a single account using the History API.
export async function syncIncremental(accountId: number): Promise<IncrementalResult> {
  const [account] = await db.select().from(emailAccounts).where(eq(emailAccounts.id, accountId)).limit(1);
  if (!account) return { ...EMPTY, reason: "account not found" };
  if (account.authStatus === "revoked" || account.authStatus === "error") {
    return { ...EMPTY, reason: `auth_status=${account.authStatus}` };
  }

  const startHistoryId = account.lastHistoryId;
  if (!startHistoryId) {
    // Seed: do a shallow paginated sync first, then capture historyId.
    log(`[gmail-incr] account=${accountId} no lastHistoryId yet — seeding via shallow sync`);
    await syncEmailAccount(accountId, { maxPages: 1, pageSize: 100, refreshLabels: false });
    let gmailClient: any;
    try {
      const { getGmailClient } = await import("../gmail-oauth");
      gmailClient = await getGmailClient(account.userId, accountId);
    } catch (e: any) {
      return { ...EMPTY, reason: `token error: ${e.message}` };
    }
    const hid = await captureProfileHistoryId(accountId, gmailClient);
    return { ...EMPTY, ok: true, startHistoryId: null, endHistoryId: hid, reason: "seeded historyId" };
  }

  const myEmail = account.emailAddress;
  let gmailClient: any;
  try {
    const { getGmailClient } = await import("../gmail-oauth");
    gmailClient = await getGmailClient(account.userId, accountId);
  } catch (e: any) {
    return { ...EMPTY, startHistoryId, reason: `token error: ${e.message}` };
  }

  let pageToken: string | undefined = undefined;
  let events = 0;
  let added = 0;
  let deleted = 0;
  let labelsChanged = 0;
  let endHistoryId: string | null = startHistoryId;

  try {
    do {
      const histRes: any = await gmailClient.users.history.list({
        userId: "me",
        startHistoryId,
        ...(pageToken ? { pageToken } : {}),
        maxResults: 500,
      });
      pageToken = histRes.data.nextPageToken ?? undefined;
      const history = histRes.data.history || [];
      if (histRes.data.historyId) endHistoryId = String(histRes.data.historyId);

      for (const h of history) {
        // messagesAdded
        for (const ma of h.messagesAdded || []) {
          const id = ma?.message?.id;
          if (!id) continue;
          events++;
          try {
            const r = await upsertMessageById(gmailClient, id, account.userId, accountId, myEmail);
            if (r.inserted) added++;
            else if (r.updatedLabels) labelsChanged++;
          } catch (e: any) {
            log(`[gmail-incr] add err msg=${id}: ${e.message}`);
          }
        }
        // messagesDeleted
        for (const md of h.messagesDeleted || []) {
          const id = md?.message?.id;
          if (!id) continue;
          events++;
          await db.update(emailMessages)
            .set({ labelIds: JSON.stringify(["TRASH"]), updatedAt: new Date() })
            .where(eq(emailMessages.gmailMessageId, id));
          deleted++;
        }
        // labelsAdded / labelsRemoved → update local label_ids.
        //
        // Race-condition fix (May 2026): the original code re-fetched every
        // affected message via messages.get(format=metadata) and blindly
        // overwrote local label_ids with whatever Gmail returned.  This is
        // susceptible to Gmail's label-propagation lag: when the user clicks
        // "Not Spam", we call threads.modify (SPAM→INBOX), which immediately
        // triggers a Pub/Sub push, but Gmail's index can still return the
        // OLD SPAM label for a few seconds.  Result: the incremental sync
        // fires, gets SPAM back from Gmail, and silently undoes the "not spam"
        // local fix — the email reappears in spam on the next page load.
        //
        // Fix: prefer lm.message.labelIds from the history event itself
        // (the canonical post-modification state that triggered the event)
        // and only fall back to messages.get when the event doesn't carry it.
        // The history event is written atomically with the label change, so
        // it will never carry a stale pre-modification label list.
        const labelMutated = [...(h.labelsAdded || []), ...(h.labelsRemoved || [])];
        for (const lm of labelMutated) {
          const id = lm?.message?.id;
          if (!id) continue;
          events++;
          // Prefer the label list embedded in the history event (always
          // reflects the post-modification state).  Fall back to a
          // messages.get round-trip only when the event omits labelIds.
          const eventLabels: string[] | undefined =
            Array.isArray(lm?.message?.labelIds) && lm.message.labelIds.length > 0
              ? lm.message.labelIds
              : undefined;
          try {
            let newLabels: string[];
            if (eventLabels) {
              newLabels = eventLabels;
            } else {
              const meta: any = await gmailClient.users.messages.get({
                userId: "me", id, format: "metadata", metadataHeaders: [],
              });
              newLabels = meta.data.labelIds || [];
            }

            // Inbox-visibility guard (label-change path): if Gmail removes INBOX
            // from an inbound message that still has a CATEGORY_* label and is
            // still UNREAD, restore INBOX locally.  Requiring UNREAD prevents
            // re-adding INBOX to messages the user has already read and archived
            // (archiving removes both INBOX and UNREAD in one operation).
            newLabels = ensureInboxForCategoryLabels(newLabels, true /* requireUnread */);

            // Trusted-sender guard: if Gmail is adding SPAM to a message from
            // a sender the user has explicitly trusted (via "Not Spam"), override
            // the labels locally and instruct Gmail to remove SPAM + add INBOX.
            if (newLabels.some((l: string) => l.toUpperCase() === "SPAM")) {
              try {
                const [localMsg] = await db
                  .select({ fromEmail: emailMessages.fromEmail, gmailThreadId: emailMessages.gmailThreadId })
                  .from(emailMessages)
                  .where(eq(emailMessages.gmailMessageId, id))
                  .limit(1);
                if (localMsg?.fromEmail) {
                  const senderLc = localMsg.fromEmail.trim().toLowerCase();
                  const trusted = await db.execute(
                    sql`SELECT 1 FROM spam_trusted_senders WHERE email = ${senderLc} LIMIT 1`,
                  );
                  const trustedRows: any[] = (trusted as any).rows ?? trusted;
                  if (trustedRows.length > 0) {
                    // Re-apply not-spam at the Gmail level (best-effort).
                    try {
                      await gmailClient.users.threads.modify({
                        userId: "me",
                        id: localMsg.gmailThreadId,
                        requestBody: { removeLabelIds: ["SPAM"], addLabelIds: ["INBOX"] },
                      });
                    } catch { /* non-fatal — local override is applied regardless */ }
                    // Override labels locally: remove SPAM, ensure INBOX.
                    const labelSet = new Set(newLabels.map((l: string) => l.toUpperCase()));
                    labelSet.delete("SPAM");
                    labelSet.add("INBOX");
                    newLabels = Array.from(labelSet);
                    log(`[gmail-incr] trusted-sender guard applied for msg=${id} sender=${senderLc}`);
                  }
                }
              } catch { /* non-fatal — proceed with original label set */ }
            }

            const newLabelsJson = JSON.stringify(newLabels);
            const upd = await db.update(emailMessages)
              .set({ labelIds: newLabelsJson, updatedAt: new Date() })
              .where(eq(emailMessages.gmailMessageId, id))
              .returning({ id: emailMessages.id });
            if (upd.length) labelsChanged++;
          } catch (e: any) {
            if (e?.code === 404) {
              await db.update(emailMessages)
                .set({ labelIds: JSON.stringify(["TRASH"]), updatedAt: new Date() })
                .where(eq(emailMessages.gmailMessageId, id));
              labelsChanged++;
            }
          }
        }
      }
    } while (pageToken);

    // Persist new historyId + counters.
    //
    // Concurrency-safety (Commit 5 hardening — architect-flagged nit):
    //   Two concurrent syncIncremental calls for the same account both
    //   read account.lastHistoryId at the top of this function (line 128).
    //   Without atomic writes, a "last writer wins" race could:
    //     (a) regress lastHistoryId when the slower run finishes second
    //         with an older endHistoryId, causing the next sync to
    //         redundantly re-fetch a few hundred events. Not data loss —
    //         upsertMessageById's onConflictDoNothing absorbs the dup
    //         inserts — but wasted Gmail API budget.
    //     (b) lose the slower run's `events` increment to the counter,
    //         since both writers compute their increment from the same
    //         stale snapshot value.
    //
    // Fix: do both updates atomically in SQL.
    //   - lastHistoryId: GREATEST of current and our endHistoryId, cast
    //     to bigint to avoid lexicographic comparison breaking when Gmail
    //     ids cross digit-count boundaries. Cast back to text since the
    //     column type is text. NULL handling: PostgreSQL's GREATEST
    //     ignores NULLs unless all args are NULL, so a NULL existing
    //     value (shouldn't happen here — the seed branch above returns
    //     before reaching this UPDATE) would just adopt our endHistoryId.
    //   - incrementalEventCount: atomic add via SQL, COALESCE-guarded
    //     against the legacy NULL default.
    // Update lastSyncAt as well so the sidebar "synced X ago" label reflects
    // incremental syncs, not just the hourly full paginated sync.
    const now = new Date();
    await db.update(emailAccounts)
      .set({
        lastHistoryId: sql`GREATEST(${emailAccounts.lastHistoryId}::bigint, ${endHistoryId}::bigint)::text`,
        lastIncrementalSyncAt: now,
        lastSyncAt: now,
        incrementalEventCount: sql`COALESCE(${emailAccounts.incrementalEventCount}, 0) + ${events}`,
        syncErrorMessage: null,
        updatedAt: now,
      })
      .where(eq(emailAccounts.id, accountId));

    log(`[gmail-incr] account=${accountId} startHid=${startHistoryId} endHid=${endHistoryId} events=${events} added=${added} deleted=${deleted} labelsChanged=${labelsChanged}`);
    return { ok: true, startHistoryId, endHistoryId, events, added, deleted, labelsChanged, fellBack: false };

  } catch (err: any) {
    // 404 = "Requested entity was not found" → historyId too old; fall back
    const code = err?.code || err?.response?.status;
    const msg = err?.message || "";
    if (code === 404 || /history.*not found|requested entity/i.test(msg)) {
      log(`[gmail-incr] account=${accountId} historyId too old (${startHistoryId}) → falling back to paginated sync`);
      await syncEmailAccount(accountId, { maxPages: 5, pageSize: 100, refreshLabels: true });
      const hid = await captureProfileHistoryId(accountId, gmailClient);
      const fallbackNow = new Date();
      await db.update(emailAccounts)
        .set({ lastIncrementalSyncAt: fallbackNow, lastSyncAt: fallbackNow, updatedAt: fallbackNow })
        .where(eq(emailAccounts.id, accountId));
      return { ok: true, startHistoryId, endHistoryId: hid, events: 0, added: 0, deleted: 0, labelsChanged: 0, fellBack: true, reason: "history too old" };
    }
    log(`[gmail-incr] account=${accountId} fatal: ${msg}`);
    await db.update(emailAccounts)
      .set({ syncErrorMessage: msg, updatedAt: new Date() })
      .where(eq(emailAccounts.id, accountId));
    return { ...EMPTY, startHistoryId, reason: msg };
  }
}

// Convenience: run incremental sync for every active account.
export async function runIncrementalForAll(): Promise<IncrementalResult[]> {
  const accounts = await db
    .select()
    .from(emailAccounts)
    .where(and(eq(emailAccounts.isActive, true), eq(emailAccounts.syncEnabled, true)));
  const out: IncrementalResult[] = [];
  for (const a of accounts) {
    out.push(await syncIncremental(a.id));
  }
  return out;
}
