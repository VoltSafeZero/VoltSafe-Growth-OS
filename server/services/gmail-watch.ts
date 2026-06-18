// Phase 2A — Gmail watch lifecycle.
// Calls users.watch with a Pub/Sub topic so Gmail pushes change events to our
// webhook. Persists watchExpirationAt and auto-renews 24h before expiry.
//
// Requires env GMAIL_PUBSUB_TOPIC (e.g. "projects/voltsafe-gcp/topics/gmail-push").
// If unset, watch is skipped and the system falls back to historyId polling.
import { db } from "../db";
import { emailAccounts } from "../../shared/schema";
import { eq, and, isNotNull, lte, ne } from "drizzle-orm";
import { log } from "../index";

export type WatchStartResult = {
  ok: boolean;
  expirationMs?: number;
  historyId?: string;
  topic?: string;
  reason?: string;
};

function getTopic(): string | null {
  return (process.env.GMAIL_PUBSUB_TOPIC || "").trim() || null;
}

export function isPushConfigured(): boolean {
  return getTopic() !== null;
}

// Start (or refresh) a Gmail watch for a single account.
export async function startWatch(accountId: number): Promise<WatchStartResult> {
  const topic = getTopic();
  if (!topic) {
    return { ok: false, reason: "GMAIL_PUBSUB_TOPIC env var not set — push disabled, using historyId polling instead" };
  }

  const [account] = await db.select().from(emailAccounts).where(eq(emailAccounts.id, accountId)).limit(1);
  if (!account) return { ok: false, reason: "account not found" };
  if (!account.refreshToken) return { ok: false, reason: "no refresh token" };

  let gmailClient: any;
  try {
    const { getGmailClient } = await import("../gmail-oauth");
    gmailClient = await getGmailClient(account.userId, accountId);
  } catch (e: any) {
    return { ok: false, reason: `token error: ${e.message}` };
  }

  try {
    const r: any = await gmailClient.users.watch({
      userId: "me",
      requestBody: {
        topicName: topic,
        labelFilterAction: "include",
        // No labelIds → watch all changes (all label changes, all new mail)
      },
    });
    const expirationMs = Number(r.data.expiration); // ms epoch
    const historyId = r.data.historyId ? String(r.data.historyId) : undefined;

    await db.update(emailAccounts)
      .set({
        watchExpirationAt: expirationMs ? new Date(expirationMs) : null,
        watchHistoryId: historyId ?? null,
        watchTopic: topic,
        // Seed lastHistoryId if we don't have one yet (so incremental works from now)
        ...(account.lastHistoryId ? {} : { lastHistoryId: historyId ?? null }),
        updatedAt: new Date(),
      })
      .where(eq(emailAccounts.id, accountId));

    log(`[gmail-watch] account=${accountId} watch started, expires=${new Date(expirationMs).toISOString()}, historyId=${historyId}`);
    return { ok: true, expirationMs, historyId, topic };
  } catch (e: any) {
    const msg = e?.message || String(e);
    log(`[gmail-watch] account=${accountId} watch FAILED: ${msg}`);
    return { ok: false, reason: msg };
  }
}

// Stop watching for a single account.
export async function stopWatch(accountId: number): Promise<{ ok: boolean; reason?: string }> {
  const [account] = await db.select().from(emailAccounts).where(eq(emailAccounts.id, accountId)).limit(1);
  if (!account) return { ok: false, reason: "account not found" };
  let gmailClient: any;
  try {
    const { getGmailClient } = await import("../gmail-oauth");
    gmailClient = await getGmailClient(account.userId, accountId);
  } catch (e: any) {
    return { ok: false, reason: `token error: ${e.message}` };
  }
  try {
    await gmailClient.users.stop({ userId: "me" });
    await db.update(emailAccounts)
      .set({ watchExpirationAt: null, watchHistoryId: null, watchTopic: null, updatedAt: new Date() })
      .where(eq(emailAccounts.id, accountId));
    log(`[gmail-watch] account=${accountId} watch stopped`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: e.message };
  }
}

// Renew any watches that expire within the next 24 hours.
export async function renewExpiringWatches(): Promise<number> {
  if (!isPushConfigured()) return 0;
  const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const due = await db
    .select()
    .from(emailAccounts)
    .where(and(
      eq(emailAccounts.isActive, true),
      eq(emailAccounts.syncEnabled, true),
      ne(emailAccounts.authStatus, "expired"),
      ne(emailAccounts.authStatus, "revoked"),
      isNotNull(emailAccounts.watchExpirationAt),
      lte(emailAccounts.watchExpirationAt, cutoff),
    ));
  let renewed = 0;
  for (const a of due) {
    const r = await startWatch(a.id);
    if (r.ok) renewed++;
  }
  if (renewed) log(`[gmail-watch] renewed ${renewed} expiring watches`);
  return renewed;
}

// Boot helper: ensure a watch exists for every active account when push is configured.
export async function ensureWatchesOnBoot(): Promise<void> {
  if (!isPushConfigured()) {
    log("[gmail-watch] GMAIL_PUBSUB_TOPIC not set — skipping watch registration (incremental polling still active)");
    return;
  }
  const accounts = await db
    .select()
    .from(emailAccounts)
    .where(and(
      eq(emailAccounts.isActive, true),
      eq(emailAccounts.syncEnabled, true),
      ne(emailAccounts.authStatus, "expired"),
      ne(emailAccounts.authStatus, "revoked"),
    ));
  for (const a of accounts) {
    const needsStart = !a.watchExpirationAt || a.watchExpirationAt.getTime() < Date.now() + 24 * 60 * 60 * 1000;
    if (needsStart) {
      await startWatch(a.id);
    }
  }
}

const HOUR_MS = 60 * 60 * 1000;
export function startWatchRenewalScheduler() {
  log(`[gmail-watch] renewal scheduler started — push configured: ${isPushConfigured()}`);
  // Renew once shortly after boot, then every 6 hours
  setTimeout(() => { ensureWatchesOnBoot().catch(() => {}); }, 10_000);
  setInterval(() => { renewExpiringWatches().catch(() => {}); }, 6 * HOUR_MS);
}
