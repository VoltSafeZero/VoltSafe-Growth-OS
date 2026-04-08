// Gmail OAuth2 using Google Cloud credentials (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET)
// Refresh token stored in system_settings DB table under key "gmail_refresh_token"
// email_accounts is updated after every successful OAuth exchange (Step 2).
import { google } from "googleapis";
import { db } from "./db";
import { systemSettings, emailAccounts } from "@shared/schema";
import { eq } from "drizzle-orm";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
];

// Trevor's user_id — the only connected Gmail user in Phase 1
const TREVOR_USER_ID = 4;

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

export function getAuthUrl(): string {
  const oauth2Client = getOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
}

export async function exchangeCodeForTokens(code: string): Promise<{ emailAddress: string }> {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error("No refresh token returned. Try revoking access and reconnecting.");
  }

  // ── Keep backward-compat: still store in system_settings ─────────────────
  await db.insert(systemSettings)
    .values({ key: "gmail_refresh_token", value: tokens.refresh_token })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value: tokens.refresh_token, updatedAt: new Date() } });

  if (tokens.access_token) {
    await db.insert(systemSettings)
      .values({ key: "gmail_access_token", value: tokens.access_token })
      .onConflictDoUpdate({ target: systemSettings.key, set: { value: tokens.access_token!, updatedAt: new Date() } });
  }

  // ── S2: Get Gmail profile to stamp email_accounts ─────────────────────────
  oauth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  let emailAddress = "trevor@voltsafe.com";
  try {
    const profile = await gmail.users.getProfile({ userId: "me" });
    emailAddress = profile.data.emailAddress || emailAddress;
    // Also persist in system_settings for quick lookup
    await db.insert(systemSettings)
      .values({ key: "gmail_address", value: emailAddress })
      .onConflictDoUpdate({ target: systemSettings.key, set: { value: emailAddress, updatedAt: new Date() } });
  } catch {}

  // ── S2: Upsert email_accounts for this user ───────────────────────────────
  const existing = await db
    .select({ id: emailAccounts.id })
    .from(emailAccounts)
    .where(eq(emailAccounts.userId, TREVOR_USER_ID))
    .limit(1);

  if (existing.length > 0) {
    await db.update(emailAccounts)
      .set({
        emailAddress,
        authStatus: "active",
        syncEnabled: true,
        disconnectedAt: null,
        syncErrorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(emailAccounts.userId, TREVOR_USER_ID));
  } else {
    await db.insert(emailAccounts)
      .values({
        workspaceId: 1,
        userId: TREVOR_USER_ID,
        provider: "gmail",
        emailAddress,
        displayName: "Trevor Burgess",
        authStatus: "active",
        isActive: true,
        syncEnabled: true,
      })
      .onConflictDoNothing();
  }

  return { emailAddress };
}

export async function getGmailClient() {
  const [refreshRow] = await db.select().from(systemSettings).where(eq(systemSettings.key, "gmail_refresh_token"));
  if (!refreshRow) {
    throw new Error("Gmail not connected");
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshRow.value });

  const { credentials } = await oauth2Client.refreshAccessToken();
  oauth2Client.setCredentials(credentials);

  return google.gmail({ version: "v1", auth: oauth2Client });
}

export async function isGmailConnected(): Promise<{ connected: boolean; tokenValid: boolean; apiEnabled: boolean }> {
  try {
    const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, "gmail_refresh_token"));
    if (!row) return { connected: false, tokenValid: false, apiEnabled: true };

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return { connected: true, tokenValid: false, apiEnabled: true };

    try {
      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
      oauth2Client.setCredentials({ refresh_token: row.value });
      const gmail = google.gmail({ version: "v1", auth: oauth2Client });
      await gmail.users.getProfile({ userId: "me" });
      return { connected: true, tokenValid: true, apiEnabled: true };
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg.includes("API has not been used") || msg.includes("disabled")) {
        return { connected: true, tokenValid: true, apiEnabled: false };
      }
      if (msg.includes("unauthorized_client") || msg.includes("invalid_grant") || msg.includes("Token has been expired")) {
        return { connected: true, tokenValid: false, apiEnabled: true };
      }
      return { connected: true, tokenValid: false, apiEnabled: true };
    }
  } catch {
    return { connected: false, tokenValid: false, apiEnabled: true };
  }
}
