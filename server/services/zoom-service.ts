/**
 * zoom-service.ts — Phase A.2
 *
 * Thin service layer over the zoom_connections table.
 * Handles token refresh, connection lookup, upsert, and disconnect.
 *
 * Real Zoom OAuth is wired up later (Phase A.3).  For now, the service
 * provides all the primitives so that:
 *  - routes can call lookupZoomConnection / upsertZoomConnection / disconnectZoom
 *  - a future OAuth callback handler only needs to call upsertZoomConnection
 *  - token refresh is centralised in one place
 *
 * Env vars consumed (optional — app gracefully handles absence):
 *   ZOOM_CLIENT_ID        Zoom OAuth app client id
 *   ZOOM_CLIENT_SECRET    Zoom OAuth app client secret
 *   ZOOM_REDIRECT_URI     OAuth redirect URI registered in Zoom marketplace
 */

import { db } from "../db";
import { zoomConnections } from "@shared/schema";
import { eq } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// Config helpers
// ─────────────────────────────────────────────────────────────────────────────

export function getZoomClientId(): string | undefined {
  return process.env.ZOOM_CLIENT_ID;
}

export function getZoomClientSecret(): string | undefined {
  return process.env.ZOOM_CLIENT_SECRET;
}

export function getZoomRedirectUri(): string | undefined {
  return process.env.ZOOM_REDIRECT_URI;
}

/** Returns true only when all three Zoom OAuth env vars are configured. */
export function isZoomConfigured(): boolean {
  return !!(getZoomClientId() && getZoomClientSecret() && getZoomRedirectUri());
}

// ─────────────────────────────────────────────────────────────────────────────
// OAuth helpers (Phase A.3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the Zoom OAuth authorization URL.
 * Caller generates + stores the `state` value (CSRF token) before calling.
 * Throws if ZOOM_CLIENT_ID or ZOOM_REDIRECT_URI are not set.
 */
export function buildZoomAuthorizationUrl(state: string): string {
  const clientId = getZoomClientId();
  const redirectUri = getZoomRedirectUri();
  if (!clientId || !redirectUri) {
    throw new Error(
      "Zoom OAuth not configured — ZOOM_CLIENT_ID and ZOOM_REDIRECT_URI must be set",
    );
  }
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  });
  return `https://zoom.us/oauth/authorize?${params.toString()}`;
}

export interface ZoomTokenResponse {
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  scope: string;
}

/**
 * Exchanges a Zoom authorization code for an access + refresh token pair.
 * Throws on HTTP error or missing env vars.
 * NEVER logs the returned tokens.
 */
export async function exchangeZoomCodeForTokens(code: string): Promise<ZoomTokenResponse> {
  const clientId = getZoomClientId();
  const clientSecret = getZoomClientSecret();
  const redirectUri = getZoomRedirectUri();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Zoom OAuth not configured — env vars missing");
  }
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const resp = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Zoom token exchange failed (${resp.status}): ${text.slice(0, 200)}`);
  }
  const json: any = await resp.json();
  const expiresIn: number = json.expires_in ?? 3600;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
    scope: json.scope ?? "",
  };
}

export interface ZoomUserProfile {
  zoomUserId: string;
  zoomEmail: string;
  zoomAccountType: string | null;
  zoomPmi: string | null;
  zoomPmiUrl: string | null;
}

/**
 * Fetches the authenticated user's Zoom profile using their access token.
 * Throws on HTTP errors — caller must catch.
 * NEVER logs the access token.
 */
export async function fetchZoomUserProfile(accessToken: string): Promise<ZoomUserProfile> {
  const resp = await fetch("https://api.zoom.us/v2/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Zoom profile fetch failed (${resp.status}): ${text.slice(0, 200)}`);
  }
  const json: any = await resp.json();
  // Zoom account types: 1=basic, 2=pro, 3=corp/business
  const accountTypeMap: Record<number, string> = { 1: "basic", 2: "pro", 3: "corp" };
  return {
    zoomUserId: json.id,
    zoomEmail: json.email,
    zoomAccountType: accountTypeMap[json.type as number] ?? String(json.type ?? "unknown"),
    zoomPmi: json.pmi ? String(json.pmi) : null,
    zoomPmiUrl: json.personal_meeting_url ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection lookup
// ─────────────────────────────────────────────────────────────────────────────

export type ZoomConnectionRow = typeof zoomConnections.$inferSelect;

/**
 * Returns the active Zoom connection for a user, or null if none exists /
 * the user has disconnected.
 */
export async function lookupZoomConnection(userId: number): Promise<ZoomConnectionRow | null> {
  const [row] = await db
    .select()
    .from(zoomConnections)
    .where(eq(zoomConnections.userId, userId))
    .limit(1);
  return row ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Upsert — called from OAuth callback
// ─────────────────────────────────────────────────────────────────────────────

export interface ZoomTokenPayload {
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  scope: string;
  zoomUserId?: string;
  zoomEmail?: string;
  zoomAccountType?: string;
  zoomPmi?: string;
  zoomPmiUrl?: string;
}

/**
 * Creates or updates the Zoom connection for a user.
 * Called after a successful OAuth exchange.
 */
export async function upsertZoomConnection(
  userId: number,
  payload: ZoomTokenPayload,
): Promise<ZoomConnectionRow> {
  const now = new Date();

  const existing = await lookupZoomConnection(userId);

  if (existing) {
    const [updated] = await db
      .update(zoomConnections)
      .set({
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
        tokenExpiresAt: payload.tokenExpiresAt,
        scope: payload.scope,
        zoomUserId: payload.zoomUserId ?? existing.zoomUserId,
        zoomEmail: payload.zoomEmail ?? existing.zoomEmail,
        zoomAccountType: payload.zoomAccountType ?? existing.zoomAccountType,
        zoomPmi: payload.zoomPmi ?? existing.zoomPmi,
        zoomPmiUrl: payload.zoomPmiUrl ?? existing.zoomPmiUrl,
        disconnectedAt: null,
        connectedAt: existing.connectedAt,
        updatedAt: now,
      })
      .where(eq(zoomConnections.userId, userId))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(zoomConnections)
    .values({
      userId,
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      tokenExpiresAt: payload.tokenExpiresAt,
      scope: payload.scope,
      zoomUserId: payload.zoomUserId ?? null,
      zoomEmail: payload.zoomEmail ?? null,
      zoomAccountType: payload.zoomAccountType ?? null,
      zoomPmi: payload.zoomPmi ?? null,
      zoomPmiUrl: payload.zoomPmiUrl ?? null,
      connectedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return created;
}

// ─────────────────────────────────────────────────────────────────────────────
// Disconnect
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Marks the connection as disconnected (sets disconnectedAt, clears tokens).
 * The row is retained for audit purposes.
 */
export async function disconnectZoom(userId: number): Promise<void> {
  const now = new Date();
  await db
    .update(zoomConnections)
    .set({
      disconnectedAt: now,
      accessToken: "",
      refreshToken: "",
      updatedAt: now,
    })
    .where(eq(zoomConnections.userId, userId));
}

// ─────────────────────────────────────────────────────────────────────────────
// Token refresh (stub — real implementation wired in Phase A.3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Refreshes the access token using the stored refresh_token.
 * Returns the updated connection row.
 *
 * Currently a stub: returns the existing row unchanged until the real Zoom
 * OAuth exchange is wired up in Phase A.3.
 */
export async function refreshZoomTokenIfNeeded(
  userId: number,
): Promise<ZoomConnectionRow | null> {
  const conn = await lookupZoomConnection(userId);
  if (!conn || conn.disconnectedAt) return null;

  const nowMs = Date.now();
  const expiresMs = conn.tokenExpiresAt.getTime();

  // Refresh 5 minutes before expiry
  if (expiresMs - nowMs > 5 * 60 * 1000) return conn;

  if (!isZoomConfigured()) {
    console.warn("[zoom-service] Token needs refresh but ZOOM_CLIENT_SECRET not set — skipping");
    return conn;
  }

  try {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: conn.refreshToken,
    });
    const basicAuth = Buffer.from(
      `${getZoomClientId()}:${getZoomClientSecret()}`,
    ).toString("base64");

    const resp = await fetch("https://zoom.us/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("[zoom-service] Token refresh failed:", resp.status, text);
      return conn;
    }

    const json: any = await resp.json();
    const expiresIn: number = json.expires_in ?? 3600;
    const newExpiry = new Date(Date.now() + expiresIn * 1000);

    return upsertZoomConnection(userId, {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? conn.refreshToken,
      tokenExpiresAt: newExpiry,
      scope: json.scope ?? conn.scope ?? "",
    });
  } catch (err) {
    console.error("[zoom-service] refreshZoomTokenIfNeeded error:", err);
    return conn;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Safe public projection (strips tokens before sending to client)
// ─────────────────────────────────────────────────────────────────────────────

export interface ZoomConnectionPublic {
  connected: boolean;
  zoomEmail: string | null;
  zoomUserId: string | null;
  zoomAccountType: string | null;
  zoomPmi: string | null;
  zoomPmiUrl: string | null;
  tokenExpiresAt: Date | null;
  connectedAt: Date | null;
  disconnectedAt: Date | null;
}

export function toPublicZoomConnection(
  row: ZoomConnectionRow | null,
): ZoomConnectionPublic {
  if (!row || row.disconnectedAt) {
    return {
      connected: false,
      zoomEmail: null,
      zoomUserId: null,
      zoomAccountType: null,
      zoomPmi: null,
      zoomPmiUrl: null,
      tokenExpiresAt: null,
      connectedAt: null,
      disconnectedAt: row?.disconnectedAt ?? null,
    };
  }
  return {
    connected: true,
    zoomEmail: row.zoomEmail,
    zoomUserId: row.zoomUserId,
    zoomAccountType: row.zoomAccountType,
    zoomPmi: row.zoomPmi,
    zoomPmiUrl: row.zoomPmiUrl,
    tokenExpiresAt: row.tokenExpiresAt,
    connectedAt: row.connectedAt,
    disconnectedAt: null,
  };
}
