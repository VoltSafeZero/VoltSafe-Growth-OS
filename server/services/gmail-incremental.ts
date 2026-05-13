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
  myDomain: string,
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
    const { attachments, ...emailData } = parsed;

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

    // Update label_ids if they changed
    if (parsed.labelIds && parsed.labelIds !== existing.labelIds) {
      await db.update(emailMessages)
        .set({ labelIds: parsed.labelIds, updatedAt: new Date() })
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
            const r = await upsertMessageById(gmailClient, id, account.userId, accountId, myDomain);
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
        // labelsAdded / labelsRemoved → re-fetch metadata for that message and overwrite label_ids
        const labelMutated = [...(h.labelsAdded || []), ...(h.labelsRemoved || [])];
        for (const lm of labelMutated) {
          const id = lm?.message?.id;
          if (!id) continue;
          events++;
          try {
            const meta: any = await gmailClient.users.messages.get({
              userId: "me", id, format: "metadata", metadataHeaders: [],
            });
            const newLabels: string[] = meta.data.labelIds || [];
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
    await db.update(emailAccounts)
      .set({
        lastHistoryId: sql`GREATEST(${emailAccounts.lastHistoryId}::bigint, ${endHistoryId}::bigint)::text`,
        lastIncrementalSyncAt: new Date(),
        incrementalEventCount: sql`COALESCE(${emailAccounts.incrementalEventCount}, 0) + ${events}`,
        syncErrorMessage: null,
        updatedAt: new Date(),
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
      await db.update(emailAccounts)
        .set({ lastIncrementalSyncAt: new Date(), updatedAt: new Date() })
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
