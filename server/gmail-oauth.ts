// Gmail OAuth2 using Google Cloud credentials (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET)
// Refresh token stored in system_settings DB table under key "gmail_refresh_token"
import { google } from "googleapis";
import { db } from "./db";
import { systemSettings } from "@shared/schema";
import { eq } from "drizzle-orm";

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

export function getAuthUrl(): string {
  const oauth2Client = getOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
}

export async function exchangeCodeForTokens(code: string): Promise<void> {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error("No refresh token returned. Try revoking access and reconnecting.");
  }

  await db.insert(systemSettings)
    .values({ key: "gmail_refresh_token", value: tokens.refresh_token })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value: tokens.refresh_token, updatedAt: new Date() } });

  if (tokens.access_token) {
    await db.insert(systemSettings)
      .values({ key: "gmail_access_token", value: tokens.access_token })
      .onConflictDoUpdate({ target: systemSettings.key, set: { value: tokens.access_token!, updatedAt: new Date() } });
  }
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

export async function isGmailConnected(): Promise<{ connected: boolean; tokenValid: boolean }> {
  try {
    const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, "gmail_refresh_token"));
    if (!row) return { connected: false, tokenValid: false };

    // Validate the token actually works by attempting a refresh
    try {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      if (!clientId || !clientSecret) return { connected: true, tokenValid: false };

      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
      oauth2Client.setCredentials({ refresh_token: row.value });
      await oauth2Client.refreshAccessToken();
      return { connected: true, tokenValid: true };
    } catch {
      return { connected: true, tokenValid: false };
    }
  } catch {
    return { connected: false, tokenValid: false };
  }
}
