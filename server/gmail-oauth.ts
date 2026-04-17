// Gmail OAuth2 using Google Cloud credentials (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET)
// Per-user tokens stored in email_accounts.refresh_token / access_token (Phase 2).
import { google } from "googleapis";
import { db } from "./db";
import { systemSettings, emailAccounts, users } from "@shared/schema";
import { eq, and } from "drizzle-orm";

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
      await db.insert(emailAccounts).values({
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
      });
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
      await db.insert(emailAccounts)
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
        .onConflictDoNothing();
    }

    // Backward compat: also store in system_settings (Trevor's personal account only)
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

// Trevor's user_id — only user whose token falls back to system_settings for Phase 1 compat
const TREVOR_USER_ID = 4;

// getGmailClient resolves a Gmail API client for either a userId or a specific accountId.
// When accountId is provided (for shared mailbox access), it looks up by accountId directly,
// bypassing the userId constraint so any workspace user can access shared inboxes.
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
    if (!refreshToken) throw new Error("Shared account has no token — please reconnect it.");
  } else {
    // Standard: per-user token from email_accounts
    const [acct] = await db
      .select({ refreshToken: emailAccounts.refreshToken })
      .from(emailAccounts)
      .where(and(eq(emailAccounts.userId, userId), eq(emailAccounts.isActive, true)))
      .limit(1);
    refreshToken = acct?.refreshToken ?? null;

    // Fallback ONLY for Trevor: read from system_settings if email_accounts.refresh_token is empty
    if (!refreshToken && userId === TREVOR_USER_ID) {
      const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, "gmail_refresh_token"));
      if (row?.value) {
        refreshToken = row.value;
        // Opportunistically backfill email_accounts so fallback isn't needed next time
        if (acct) {
          await db.update(emailAccounts)
            .set({ refreshToken, updatedAt: new Date() })
            .where(eq(emailAccounts.userId, userId));
        }
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
    // Check if this user has an active email_accounts record with a token
    const [acct] = await db
      .select({ refreshToken: emailAccounts.refreshToken, authStatus: emailAccounts.authStatus })
      .from(emailAccounts)
      .where(and(eq(emailAccounts.userId, userId), eq(emailAccounts.isActive, true)))
      .limit(1);

    let hasToken = !!acct?.refreshToken;

    // Fallback ONLY for Trevor: check system_settings if email_accounts has no token yet
    if (!hasToken && userId === TREVOR_USER_ID) {
      const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, "gmail_refresh_token"));
      hasToken = !!row?.value;
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
