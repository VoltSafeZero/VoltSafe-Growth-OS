// Gmail OAuth2 using Google Cloud credentials (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET)
// Per-user tokens stored in email_accounts.refresh_token / access_token (Phase 2).
import { google } from "googleapis";
import { db } from "./db";
import { systemSettings, emailAccounts, users } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

// Auto-backfill on new mailbox connect.
// - Default: 2024-01-01 → today for any newly connected user mailbox.
// - Special override: trevor/sales/support @voltsafe.com get 2020-01-01 → today
//   (per ops policy — these mailboxes need the longer history).
// Only fires the first time an account row is INSERTED. Reconnects that go
// through the UPDATE path are not re-enqueued.
const SPECIAL_2020_ADDRESSES = new Set([
  "trevor@voltsafe.com",
  "sales@voltsafe.com",
  "support@voltsafe.com",
]);

async function autoEnqueueBackfillForNewAccount(opts: {
  accountId: number;
  userId: number;
  emailAddress: string | null;
}): Promise<void> {
  const { accountId, userId, emailAddress } = opts;
  try {
    const dateFrom = emailAddress && SPECIAL_2020_ADDRESSES.has(emailAddress.toLowerCase())
      ? "2020-01-01"
      : "2024-01-01";
    const today = new Date().toISOString().slice(0, 10);

    // Idempotency: don't double-enqueue if a pending/running job already exists.
    const existing = await db.execute(sql.raw(
      `SELECT id FROM backfill_jobs WHERE email_account_id = ${accountId} AND status IN ('pending','running') LIMIT 1`
    ));
    if ((existing as any).rows?.length) return;

    const inserted = await db.execute(sql.raw(`
      INSERT INTO backfill_jobs (user_id, email_account_id, status, date_from, date_to)
      VALUES (${userId}, ${accountId}, 'pending', '${dateFrom}', '${today}')
      RETURNING id
    `));
    const jobId = Number((inserted as any).rows?.[0]?.id);
    if (!jobId) return;

    console.log(`[auto-backfill] enqueued job ${jobId} for account ${accountId} (${emailAddress ?? "?"}) ${dateFrom}→${today}`);

    // Fire-and-forget. The backfill service updates job status as it runs.
    const { runBackfillJob } = await import("./services/backfill-service");
    runBackfillJob({ jobId, accountId, userId, dateFrom, dateTo: today })
      .catch(err => console.error(`[auto-backfill] job ${jobId} error:`, err));
  } catch (err) {
    // Never block the OAuth callback on backfill enqueue failures.
    console.error("[auto-backfill] enqueue failed:", err);
  }
}

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
];

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ||
    (process.env.NODE_ENV === "production"
      ? "https://image-linker-burgesstrevor76.replit.app/api/auth/google/callback"
      : `https://${process.env.REPLIT_DOMAINS}/api/auth/google/callback`);

  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set");
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// getAuthUrl — generates the Google OAuth consent URL.
// Pass state="shared" to flag this as a shared workspace inbox connection.
export function getAuthUrl(state?: string): string {
  const oauth2Client = getOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    ...(state ? { state } : {}),
  });
}

// exchangeCodeForTokens — handles the OAuth callback.
// When isShared=true (state="shared" in the callback), the account is upserted by
// emailAddress so a single admin can hold multiple shared accounts without overwriting
// their personal account. The isShared flag makes it accessible workspace-wide.
export async function exchangeCodeForTokens(
  code: string,
  userId: number,
  isShared = false
): Promise<{ emailAddress: string }> {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error("No refresh token returned. Try revoking access at myaccount.google.com/permissions and reconnecting.");
  }

  // Get Gmail profile for the connecting account
  oauth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  let emailAddress = "";
  try {
    const profile = await gmail.users.getProfile({ userId: "me" });
    emailAddress = profile.data.emailAddress || "";
  } catch {}

  const displayName = emailAddress; // for shared accounts, use email as display name

  if (isShared) {
    // Shared workspace inbox: upsert by emailAddress so the admin can connect
    // multiple shared accounts without overwriting their personal record.
    const [existing] = await db
      .select({ id: emailAccounts.id })
      .from(emailAccounts)
      .where(eq(emailAccounts.emailAddress, emailAddress))
      .limit(1);

    if (existing) {
      await db.update(emailAccounts)
        .set({
          authStatus: "active",
          refreshToken: tokens.refresh_token,
          accessToken: tokens.access_token || null,
          isShared: true,
          syncEnabled: true,
          disconnectedAt: null,
          syncErrorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(emailAccounts.id, existing.id));
    } else {
      const [inserted] = await db.insert(emailAccounts).values({
        workspaceId: 1,
        userId, // connected-by user id (admin)
        provider: "gmail",
        emailAddress: emailAddress || `shared_${Date.now()}@unknown`,
        displayName,
        authStatus: "active",
        isActive: true,
        isShared: true,
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token || null,
        syncEnabled: true,
      }).returning({ id: emailAccounts.id });
      if (inserted?.id) {
        await autoEnqueueBackfillForNewAccount({
          accountId: inserted.id,
          userId,
          emailAddress: emailAddress || null,
        });
      }
    }
  } else {
    // Personal account: upsert by userId (original behaviour)
    let displayNamePersonal = emailAddress;
    try {
      const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
      if (user?.name) displayNamePersonal = user.name;
    } catch {}

    // Multi-mailbox Phase 1: key personal accounts by (userId, emailAddress) so a single
    // user can connect multiple personal Gmail addresses. Old behaviour upserted by userId
    // alone, which silently overwrote your primary account when adding a second. If we have
    // an emailAddress from Gmail profile, match on it; otherwise fall back to legacy lookup.
    const [existing] = emailAddress
      ? await db.select({ id: emailAccounts.id })
          .from(emailAccounts)
          .where(and(
            eq(emailAccounts.userId, userId),
            eq(emailAccounts.isShared, false),
            eq(emailAccounts.emailAddress, emailAddress),
          ))
          .limit(1)
      : await db.select({ id: emailAccounts.id })
          .from(emailAccounts)
          .where(and(eq(emailAccounts.userId, userId), eq(emailAccounts.isShared, false)))
          .limit(1);

    if (existing) {
      await db.update(emailAccounts)
        .set({
          emailAddress: emailAddress || undefined,
          displayName: displayNamePersonal,
          authStatus: "active",
          refreshToken: tokens.refresh_token,
          accessToken: tokens.access_token || null,
          syncEnabled: true,
          disconnectedAt: null,
          syncErrorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(emailAccounts.id, existing.id));
    } else {
      const inserted = await db.insert(emailAccounts)
        .values({
          workspaceId: 1,
          userId,
          provider: "gmail",
          emailAddress: emailAddress || `user_${userId}@unknown`,
          displayName: displayNamePersonal,
          authStatus: "active",
          isActive: true,
          isShared: false,
          refreshToken: tokens.refresh_token,
          accessToken: tokens.access_token || null,
          syncEnabled: true,
        })
        .onConflictDoNothing()
        .returning({ id: emailAccounts.id });
      const newId = inserted?.[0]?.id;
      if (newId) {
        await autoEnqueueBackfillForNewAccount({
          accountId: newId,
          userId,
          emailAddress: emailAddress || null,
        });
      }
    }

    // Legacy compat: also mirror tokens into system_settings under the original
    // single-user keys. Harmless for multi-user setups (just a constant overwrite
    // by whoever last connected); kept until the last legacy reader is removed.
    if (tokens.refresh_token) {
      await db.insert(systemSettings)
        .values({ key: "gmail_refresh_token", value: tokens.refresh_token })
        .onConflictDoUpdate({ target: systemSettings.key, set: { value: tokens.refresh_token, updatedAt: new Date() } });
    }
    if (tokens.access_token) {
      await db.insert(systemSettings)
        .values({ key: "gmail_access_token", value: tokens.access_token })
        .onConflictDoUpdate({ target: systemSettings.key, set: { value: tokens.access_token!, updatedAt: new Date() } });
    }
    if (emailAddress) {
      await db.insert(systemSettings)
        .values({ key: "gmail_address", value: emailAddress })
        .onConflictDoUpdate({ target: systemSettings.key, set: { value: emailAddress, updatedAt: new Date() } });
    }
  }

  return { emailAddress };
}

// getGmailClient resolves a Gmail API client for either a userId or a specific accountId.
// When accountId is provided (for shared mailbox access), it looks up by accountId directly,
// bypassing the userId constraint so any workspace user can access shared inboxes.
//
// Multi-user note: when no accountId is given, we prefer the user's PERSONAL account
// (is_shared=false) so that admins who also connected team inboxes don't accidentally
// pick up a shared mailbox token. This mirrors getUserGmailAccount in routes.ts.
export async function getGmailClient(userId: number, accountId?: number) {
  let refreshToken: string | null = null;

  if (accountId !== undefined) {
    // Shared account access — look up by specific accountId
    const [acct] = await db
      .select({ refreshToken: emailAccounts.refreshToken })
      .from(emailAccounts)
      .where(eq(emailAccounts.id, accountId))
      .limit(1);
    refreshToken = acct?.refreshToken ?? null;
    if (!refreshToken) throw new Error("Account has no token — please reconnect it.");
  } else {
    // Standard: per-user PERSONAL token from email_accounts.
    // is_shared=false avoids returning a team-inbox token when the same user
    // owns both. Deterministic ordering by id for stability.
    const [acct] = await db
      .select({ refreshToken: emailAccounts.refreshToken })
      .from(emailAccounts)
      .where(and(
        eq(emailAccounts.userId, userId),
        eq(emailAccounts.isActive, true),
        eq(emailAccounts.isShared, false),
      ))
      .orderBy(emailAccounts.id)
      .limit(1);
    refreshToken = acct?.refreshToken ?? null;

    // Legacy single-user migration aid: only adopt the legacy
    // system_settings.gmail_refresh_token when system_settings.gmail_address
    // matches THIS user's account email. That ensures the legacy token is only
    // ever assigned back to its original owner, never to a different user who
    // happens to be missing a token. After backfill the branch is dead.
    if (!refreshToken && acct) {
      const [acctRow] = await db
        .select({ emailAddress: emailAccounts.emailAddress })
        .from(emailAccounts)
        .where(and(
          eq(emailAccounts.userId, userId),
          eq(emailAccounts.isShared, false),
        ))
        .orderBy(emailAccounts.id)
        .limit(1);
      const myEmail = (acctRow?.emailAddress || "").toLowerCase();
      const [tokenRow] = await db.select().from(systemSettings).where(eq(systemSettings.key, "gmail_refresh_token"));
      const [addrRow]  = await db.select().from(systemSettings).where(eq(systemSettings.key, "gmail_address"));
      const legacyAddr = (addrRow?.value || "").toLowerCase();
      if (tokenRow?.value && legacyAddr && myEmail && legacyAddr === myEmail) {
        refreshToken = tokenRow.value;
        await db.update(emailAccounts)
          .set({ refreshToken, updatedAt: new Date() })
          .where(and(eq(emailAccounts.userId, userId), eq(emailAccounts.isShared, false)));
      }
    }
  }

  if (!refreshToken) {
    throw new Error("Gmail not connected for this user");
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const { credentials } = await oauth2Client.refreshAccessToken();
  oauth2Client.setCredentials(credentials);

  return google.gmail({ version: "v1", auth: oauth2Client });
}

export async function isGmailConnected(userId: number): Promise<{ connected: boolean; tokenValid: boolean; apiEnabled: boolean }> {
  try {
    // Check if this user has an active PERSONAL email_accounts record with a token.
    // is_shared=false ensures we don't report "connected" just because the user has
    // access to a team inbox.
    const [acct] = await db
      .select({ refreshToken: emailAccounts.refreshToken, authStatus: emailAccounts.authStatus })
      .from(emailAccounts)
      .where(and(
        eq(emailAccounts.userId, userId),
        eq(emailAccounts.isActive, true),
        eq(emailAccounts.isShared, false),
      ))
      .orderBy(emailAccounts.id)
      .limit(1);

    let hasToken = !!acct?.refreshToken;

    // Legacy single-user migration aid (mirror of getGmailClient): only count
    // the legacy system_settings token as "connected" when the legacy
    // gmail_address matches THIS user's account email — never cross-assign.
    if (!hasToken && acct) {
      const [acctRow] = await db
        .select({ emailAddress: emailAccounts.emailAddress })
        .from(emailAccounts)
        .where(and(eq(emailAccounts.userId, userId), eq(emailAccounts.isShared, false)))
        .orderBy(emailAccounts.id)
        .limit(1);
      const myEmail = (acctRow?.emailAddress || "").toLowerCase();
      const [tokenRow] = await db.select().from(systemSettings).where(eq(systemSettings.key, "gmail_refresh_token"));
      const [addrRow]  = await db.select().from(systemSettings).where(eq(systemSettings.key, "gmail_address"));
      const legacyAddr = (addrRow?.value || "").toLowerCase();
      hasToken = !!(tokenRow?.value && legacyAddr && myEmail && legacyAddr === myEmail);
    }

    if (!hasToken) return { connected: false, tokenValid: false, apiEnabled: true };

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return { connected: true, tokenValid: false, apiEnabled: true };

    try {
      const gmail = await getGmailClient(userId);
      await gmail.users.getProfile({ userId: "me" });
      return { connected: true, tokenValid: true, apiEnabled: true };
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg.includes("API has not been used") || msg.includes("disabled")) {
        return { connected: true, tokenValid: true, apiEnabled: false };
      }
      if (msg.includes("unauthorized_client") || msg.includes("invalid_grant") || msg.includes("Token has been expired") || msg.includes("not connected")) {
        return { connected: false, tokenValid: false, apiEnabled: true };
      }
      return { connected: true, tokenValid: false, apiEnabled: true };
    }
  } catch {
    return { connected: false, tokenValid: false, apiEnabled: true };
  }
}
