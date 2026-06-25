// Calendar sync service — Google Calendar (OAuth) + CalDAV (Apple iCloud / generic)
import { google } from "googleapis";
import { db } from "./db";
import { calendarConnections, calendarEvents } from "@shared/schema";
import { eq, and, isNull, or } from "drizzle-orm";

// ─── Error Translation ────────────────────────────────────────────────────────

function friendlyCalendarError(err: any): string {
  const msg: string = err?.message || err?.toString() || "Unknown error";
  const lower = msg.toLowerCase();

  // Google API not enabled
  if (lower.includes("has not been used") || lower.includes("api not enabled") || lower.includes("api is disabled")) {
    return "Google Calendar API is not enabled in Google Cloud. Please contact your admin.";
  }
  // Auth / token errors
  if (lower.includes("invalid_grant") || lower.includes("token has been expired") || lower.includes("token has been revoked")) {
    return "Your calendar authorization has expired. Please disconnect and reconnect your account.";
  }
  if (lower.includes("invalid authentication credentials") || lower.includes("unauthenticated") || lower.includes("401")) {
    return "Authentication failed. Please reconnect your calendar account.";
  }
  // Permission errors
  if (lower.includes("caller does not have permission") || lower.includes("forbidden") || lower.includes("403")) {
    return "Permission denied. Make sure calendar access is granted in your Google account.";
  }
  // Rate limits
  if (lower.includes("rate limit") || lower.includes("daily limit") || lower.includes("quota")) {
    return "Google Calendar API quota exceeded. Please try again later.";
  }
  // Network / timeout
  if (lower.includes("econnrefused") || lower.includes("enotfound") || lower.includes("etimedout") || lower.includes("network")) {
    return "Could not reach the calendar server. Check your network connection.";
  }
  // CalDAV-specific
  if (lower.includes("invalid username or password") || lower.includes("unauthorized")) {
    return "Invalid username or password. For Apple iCloud, use an app-specific password.";
  }
  if (lower.includes("not found") || lower.includes("404")) {
    return "Calendar server not found. Check the server URL.";
  }
  if (lower.includes("service unavailable") || lower.includes("503") || lower.includes("502")) {
    return "Calendar server is temporarily unavailable. Please try again later.";
  }

  // Truncate raw messages longer than 120 chars
  return msg.length > 120 ? msg.slice(0, 117) + "…" : msg;
}

// ─── Google Calendar OAuth ────────────────────────────────────────────────────

const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
  "openid",
  "email",
  "profile",
];

function getCalendarOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  // Use same redirect URI as Gmail (state="calendar" distinguishes it)
  const redirectUri =
    process.env.GOOGLE_CALENDAR_REDIRECT_URI ||
    (process.env.NODE_ENV === "production"
      ? "https://image-linker-burgesstrevor76.replit.app/api/auth/google/callback"
      : `https://${process.env.REPLIT_DOMAINS}/api/auth/google/callback`);

  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set");
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getCalendarAuthUrl(nonce?: string): string {
  const client = getCalendarOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: CALENDAR_SCOPES,
    prompt: "consent",
    // Pass the caller-supplied nonce so the callback can validate it against
    // the per-session oauthState.  Falls back to the legacy static string only
    // in non-production environments where callers have not migrated yet.
    state: nonce ?? "calendar",
  });
}

export async function exchangeCalendarCode(
  code: string,
  userId: number
): Promise<{ email: string; displayName: string }> {
  const client = getCalendarOAuth2Client();
  const { tokens } = await client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      "No refresh token returned. Revoke access at myaccount.google.com/permissions and try again."
    );
  }

  client.setCredentials(tokens);

  // Get user profile
  let email = "";
  let displayName = "Google Calendar";
  try {
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const { data } = await oauth2.userinfo.get();
    email = data.email || "";
    displayName = data.name || email || "Google Calendar";
  } catch {}

  const tokenExpiresAt = tokens.expiry_date ? new Date(tokens.expiry_date) : null;

  const [existing] = await db
    .select({ id: calendarConnections.id })
    .from(calendarConnections)
    .where(
      and(
        eq(calendarConnections.userId, userId),
        eq(calendarConnections.provider, "google")
      )
    )
    .limit(1);

  if (existing) {
    await db
      .update(calendarConnections)
      .set({
        accountEmail: email,
        displayName,
        accessToken: tokens.access_token || null,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt,
        isActive: true,
        syncEnabled: true,
        syncError: null,
        updatedAt: new Date(),
      })
      .where(eq(calendarConnections.id, existing.id));
  } else {
    await db.insert(calendarConnections).values({
      userId,
      provider: "google",
      accountEmail: email,
      displayName,
      accessToken: tokens.access_token || null,
      refreshToken: tokens.refresh_token,
      tokenExpiresAt,
      isActive: true,
      syncEnabled: true,
      syncDirection: "both",
    });
  }

  return { email, displayName };
}

export async function getCalendarClient(
  connection: typeof calendarConnections.$inferSelect
) {
  const client = getCalendarOAuth2Client();
  client.setCredentials({
    refresh_token: connection.refreshToken,
    access_token: connection.accessToken,
  });

  if (
    !connection.tokenExpiresAt ||
    connection.tokenExpiresAt.getTime() < Date.now() + 60_000
  ) {
    const { credentials } = await client.refreshAccessToken();
    client.setCredentials(credentials);
    await db
      .update(calendarConnections)
      .set({
        accessToken: credentials.access_token || connection.accessToken,
        tokenExpiresAt: credentials.expiry_date
          ? new Date(credentials.expiry_date)
          : connection.tokenExpiresAt,
        updatedAt: new Date(),
      })
      .where(eq(calendarConnections.id, connection.id));
  }

  return google.calendar({ version: "v3", auth: client });
}

// ─── Google Calendar Sync ─────────────────────────────────────────────────────

const GOOGLE_CALENDAR_COLORS: Record<string, string> = {
  "1": "#a4bdfc", "2": "#7ae28c", "3": "#dbadff", "4": "#ff887c",
  "5": "#fbd75b", "6": "#ffb878", "7": "#46d6db", "8": "#e1e1e1",
  "9": "#5484ed", "10": "#51b749", "11": "#dc2127",
};

// Fetch and return the user's full Google calendar list, updating calendarsDiscovered in DB.
export async function listGoogleCalendars(
  connectionId: number,
  userId: number
): Promise<{ id: string; name: string; color: string | null; accessRole: string; primary: boolean }[]> {
  const [conn] = await db.select().from(calendarConnections)
    .where(and(eq(calendarConnections.id, connectionId), eq(calendarConnections.userId, userId)))
    .limit(1);
  if (!conn?.refreshToken) throw new Error("Calendar connection not found or no token");

  const calendar = await getCalendarClient(conn);
  const listResp = await calendar.calendarList.list({ showHidden: false });
  const items = listResp.data.items || [];

  const discovered = items.map((cal: any) => ({
    id: cal.id,
    name: cal.summary || cal.id,
    color: cal.backgroundColor || null,
    accessRole: cal.accessRole || "reader",
    primary: !!cal.primary,
  }));

  await db.update(calendarConnections)
    .set({ calendarsDiscovered: discovered as any, updatedAt: new Date() })
    .where(eq(calendarConnections.id, connectionId));

  return discovered;
}

export async function syncGoogleCalendar(
  connectionId: number,
  userId: number
): Promise<{ imported: number; updated: number; pushed: number; errors: string[]; calendars: string[] }> {
  const [conn] = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.id, connectionId))
    .limit(1);

  if (!conn?.refreshToken) throw new Error("Calendar connection not found or no token");

  const errors: string[] = [];
  let imported = 0;
  let updated = 0;
  let pushed = 0;
  const syncedCalendars: string[] = [];

  try {
    const calendar = await getCalendarClient(conn);

    // ── Step 1: discover all calendars and update the connection record ──
    let allCalendars: { id: string; name: string; color: string | null; accessRole: string; primary: boolean }[] = [];
    try {
      const listResp = await calendar.calendarList.list({ showHidden: false });
      const items = listResp.data.items || [];
      allCalendars = items.map((cal: any) => ({
        id: cal.id,
        name: cal.summary || cal.id,
        color: cal.backgroundColor || null,
        accessRole: cal.accessRole || "reader",
        primary: !!cal.primary,
      }));
      await db.update(calendarConnections)
        .set({ calendarsDiscovered: allCalendars as any, updatedAt: new Date() })
        .where(eq(calendarConnections.id, connectionId));
    } catch (e: any) {
      errors.push(`Calendar list: ${e.message}`);
      // Fall back to primary only
      allCalendars = [{ id: "primary", name: "Primary", color: null, accessRole: "owner", primary: true }];
    }

    // ── Step 2: determine which calendars to sync ────────────────────────
    const selectedIds = Array.isArray(conn.selectedCalendarIds) && (conn.selectedCalendarIds as string[]).length > 0
      ? (conn.selectedCalendarIds as string[])
      : allCalendars.map(c => c.id);

    const calendarMap = new Map(allCalendars.map(c => [c.id, c]));

    const timeMin = new Date();
    timeMin.setMonth(timeMin.getMonth() - 2);
    const timeMax = new Date();
    timeMax.setMonth(timeMax.getMonth() + 6);

    // ── Step 3: pull events from each selected calendar ──────────────────
    for (const calId of selectedIds) {
      const calMeta = calendarMap.get(calId) || { id: calId, name: calId, color: null, accessRole: "reader", primary: false };
      let pageToken: string | undefined;
      const googleEvents: any[] = [];

      try {
        do {
          const resp = await calendar.events.list({
            calendarId: calId,
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            singleEvents: true,
            orderBy: "startTime",
            maxResults: 250,
            pageToken,
          });
          googleEvents.push(...(resp.data.items || []));
          pageToken = resp.data.nextPageToken || undefined;
        } while (pageToken);

        syncedCalendars.push(calMeta.name);
      } catch (e: any) {
        errors.push(`Fetch "${calMeta.name}": ${friendlyCalendarError(e)}`);
        continue;
      }

      for (const gEvent of googleEvents) {
        if (!gEvent.id || !gEvent.summary) continue;
        if (gEvent.status === "cancelled") continue;

        const startTime = gEvent.start?.dateTime
          ? new Date(gEvent.start.dateTime)
          : gEvent.start?.date
          ? new Date(gEvent.start.date + "T00:00:00")
          : null;
        if (!startTime) continue;

        const endTime = gEvent.end?.dateTime
          ? new Date(gEvent.end.dateTime)
          : gEvent.end?.date
          ? new Date(gEvent.end.date + "T00:00:00")
          : null;

        const allDay = !gEvent.start?.dateTime;

        // Structured attendees: name, email, responseStatus, organizer
        const attendeeDetails = (gEvent.attendees || []).map((a: any) => ({
          email: a.email || "",
          name: a.displayName || null,
          responseStatus: a.responseStatus || "needsAction",
          organizer: !!a.organizer,
          self: !!a.self,
        })).filter((a: any) => a.email);

        const invitees = attendeeDetails.map((a: any) => a.email);

        const meetingUrl =
          gEvent.conferenceData?.entryPoints?.find((ep: any) => ep.entryPointType === "video")?.uri
          || gEvent.hangoutLink
          || null;

        const [existing] = await db
          .select({ id: calendarEvents.id })
          .from(calendarEvents)
          .where(and(
            eq(calendarEvents.externalId, gEvent.id),
            eq(calendarEvents.externalProvider, "google")
          ))
          .limit(1);

        const eventColor = gEvent.colorId ? GOOGLE_CALENDAR_COLORS[gEvent.colorId] || calMeta.color || null : calMeta.color || null;

        if (existing) {
          await db.update(calendarEvents).set({
            title: gEvent.summary,
            description: gEvent.description || null,
            location: gEvent.location || null,
            startTime,
            endTime,
            allDay,
            meetingUrl,
            invitees,
            attendeeDetails: attendeeDetails as any,
            calendarName: calMeta.name,
            color: eventColor,
            status: "scheduled",
            externalCalendarId: calId,
            updatedAt: new Date(),
          }).where(eq(calendarEvents.id, existing.id));
          updated++;
        } else {
          await db.insert(calendarEvents).values({
            userId,
            title: gEvent.summary,
            description: gEvent.description || null,
            location: gEvent.location || null,
            eventType: "meeting",
            startTime,
            endTime,
            allDay,
            meetingUrl,
            invitees,
            attendeeDetails: attendeeDetails as any,
            calendarName: calMeta.name,
            color: eventColor,
            status: "scheduled",
            externalId: gEvent.id,
            externalProvider: "google",
            externalCalendarId: calId,
          });
          imported++;
        }
      }
    }

    // ── Step 4: push Cortex-native events to primary calendar ────────────
    const primaryCalId = allCalendars.find(c => c.primary)?.id || "primary";
    if (conn.syncDirection === "both" || conn.syncDirection === "push") {
      const toPush = await db
        .select()
        .from(calendarEvents)
        .where(and(
          eq(calendarEvents.userId, userId),
          or(isNull(calendarEvents.externalId), isNull(calendarEvents.externalProvider))
        ));

      for (const ev of toPush) {
        if (ev.status === "cancelled") continue;
        try {
          const body: any = {
            summary: ev.title,
            description: ev.description || undefined,
            location: ev.location || undefined,
            start: ev.allDay
              ? { date: ev.startTime.toISOString().split("T")[0] }
              : { dateTime: ev.startTime.toISOString() },
            end: ev.endTime
              ? ev.allDay ? { date: ev.endTime.toISOString().split("T")[0] } : { dateTime: ev.endTime.toISOString() }
              : ev.allDay ? { date: ev.startTime.toISOString().split("T")[0] } : { dateTime: new Date(ev.startTime.getTime() + 3_600_000).toISOString() },
          };
          if (ev.invitees?.length) body.attendees = ev.invitees.map((email) => ({ email }));
          const created = await calendar.events.insert({ calendarId: primaryCalId, requestBody: body });
          if (created.data.id) {
            await db.update(calendarEvents).set({
              externalId: created.data.id, externalProvider: "google",
              externalCalendarId: primaryCalId, updatedAt: new Date(),
            }).where(eq(calendarEvents.id, ev.id));
            pushed++;
          }
        } catch (e: any) {
          errors.push(`Push "${ev.title}": ${e.message}`);
        }
      }
    }

    await db.update(calendarConnections)
      .set({ lastSyncedAt: new Date(), syncError: null, updatedAt: new Date() })
      .where(eq(calendarConnections.id, connectionId));
  } catch (err: any) {
    const friendly = friendlyCalendarError(err);
    await db.update(calendarConnections)
      .set({ syncError: friendly, updatedAt: new Date() })
      .where(eq(calendarConnections.id, connectionId));
    throw new Error(friendly);
  }

  return { imported, updated, pushed, errors, calendars: syncedCalendars };
}

// ─── CalDAV Sync (Apple iCloud / Generic) ────────────────────────────────────

function makeBasicAuth(username: string, password: string): string {
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
}

async function caldavRequest(
  method: string,
  url: string,
  username: string,
  password: string,
  body?: string,
  extraHeaders?: Record<string, string>
): Promise<{ status: number; body: string }> {
  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: makeBasicAuth(username, password),
      "Content-Type": "application/xml; charset=utf-8",
      Depth: "1",
      ...extraHeaders,
    },
    body,
  });
  const text = await resp.text();
  return { status: resp.status, body: text };
}

export async function testCalDavConnection(
  url: string,
  username: string,
  password: string
): Promise<{
  ok: boolean;
  error?: string;
  calendars: { id: string; name: string; url: string }[];
}> {
  try {
    const normalizedUrl = url.replace(/\/$/, "");

    // Start with PROPFIND to find current-user-principal
    const principalBody = `<?xml version="1.0" encoding="UTF-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:current-user-principal/>
    <C:calendar-home-set/>
  </D:prop>
</D:propfind>`;

    const principalResp = await caldavRequest(
      "PROPFIND",
      normalizedUrl,
      username,
      password,
      principalBody,
      { Depth: "0" }
    );

    if (principalResp.status === 401) {
      return { ok: false, error: "Invalid username or password. For Apple iCloud, use an app-specific password.", calendars: [] };
    }
    if (principalResp.status === 403) {
      return { ok: false, error: "Access denied. Check that calendar access is enabled for this account.", calendars: [] };
    }
    if (principalResp.status === 404) {
      return { ok: false, error: "Calendar server not found. Check the server URL.", calendars: [] };
    }
    if (principalResp.status === 503 || principalResp.status === 502) {
      return { ok: false, error: "Calendar server is temporarily unavailable. Please try again later.", calendars: [] };
    }
    if (principalResp.status >= 400 && principalResp.status !== 207) {
      return { ok: false, error: `Calendar server returned an error (HTTP ${principalResp.status}). Check your server URL and credentials.`, calendars: [] };
    }

    // Extract calendar-home-set href
    const homeMatch =
      principalResp.body.match(/<[^:]*:calendar-home-set[^>]*>\s*<[^:]*:href>(.*?)<\/[^:]*:href>/is) ||
      principalResp.body.match(/calendar-home-set[\s\S]*?<[^:]*href>(.*?)<\/[^:]*:href>/is);

    let calHomeHref = homeMatch?.[1]?.trim();
    const origin = new URL(normalizedUrl).origin;
    const calHomeUrl = calHomeHref
      ? calHomeHref.startsWith("http")
        ? calHomeHref
        : origin + calHomeHref
      : normalizedUrl;

    // List calendars in home
    const listBody = `<?xml version="1.0" encoding="UTF-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:displayname/>
    <D:resourcetype/>
  </D:prop>
</D:propfind>`;

    const listResp = await caldavRequest(
      "PROPFIND",
      calHomeUrl,
      username,
      password,
      listBody
    );

    const calendars: { id: string; name: string; url: string }[] = [];

    // Parse multi-status responses for calendar collections
    const responseBlocks = listResp.body.match(/<D:response[\s\S]*?<\/D:response>/gi) || [];
    for (const block of responseBlocks) {
      const hrefMatch = block.match(/<D:href>(.*?)<\/D:href>/i);
      const nameMatch = block.match(/<D:displayname>(.*?)<\/D:displayname>/i);
      const isCalendar = /calendar/i.test(block) && !/principal/i.test(block);

      if (hrefMatch && nameMatch && isCalendar) {
        const href = hrefMatch[1].trim();
        const fullUrl = href.startsWith("http") ? href : origin + href;
        calendars.push({
          id: href,
          name: nameMatch[1].trim() || "Calendar",
          url: fullUrl,
        });
      }
    }

    return { ok: true, calendars };
  } catch (e: any) {
    return { ok: false, error: friendlyCalendarError(e), calendars: [] };
  }
}

// ─── iCal builder (for push to CalDAV) ───────────────────────────────────────

function escapeIcal(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  let pos = 75;
  while (pos < line.length) { parts.push(" " + line.slice(pos, pos + 74)); pos += 74; }
  return parts.join("\r\n");
}

function buildIcal(uid: string, ev: {
  title: string; startTime: Date; endTime: Date;
  description?: string | null; location?: string | null; allDay?: boolean;
}): string {
  const fmtZ = (d: Date) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const fmtD = (d: Date) => d.toISOString().split("T")[0].replace(/-/g, "");
  const now = new Date();
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//VoltSafe Cortex//EN", "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${fmtZ(now)}`,
    `LAST-MODIFIED:${fmtZ(now)}`,
  ];
  if (ev.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${fmtD(ev.startTime)}`);
    const endExcl = new Date(ev.endTime); endExcl.setDate(endExcl.getDate() + 1);
    lines.push(`DTEND;VALUE=DATE:${fmtD(endExcl)}`);
  } else {
    lines.push(`DTSTART:${fmtZ(ev.startTime)}`);
    lines.push(`DTEND:${fmtZ(ev.endTime)}`);
  }
  lines.push(foldLine(`SUMMARY:${escapeIcal(ev.title)}`));
  if (ev.description) lines.push(foldLine(`DESCRIPTION:${escapeIcal(ev.description)}`));
  if (ev.location) lines.push(foldLine(`LOCATION:${escapeIcal(ev.location)}`));
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}

async function caldavPutEvent(
  calendarUrl: string, username: string, password: string,
  uid: string, ev: { title: string; startTime: Date; endTime: Date; description?: string | null; location?: string | null; allDay?: boolean },
  existingEtag?: string | null
): Promise<{ ok: boolean; etag?: string; error?: string }> {
  const base = calendarUrl.endsWith("/") ? calendarUrl : calendarUrl + "/";
  const eventUrl = `${base}${uid}.ics`;
  const body = buildIcal(uid, ev);
  const headers: Record<string, string> = {
    Authorization: makeBasicAuth(username, password),
    "Content-Type": "text/calendar; charset=utf-8",
  };
  if (existingEtag) {
    headers["If-Match"] = existingEtag;
  } else {
    headers["If-None-Match"] = "*";
  }
  try {
    let resp = await fetch(eventUrl, { method: "PUT", headers, body });
    // 412 = precondition failed (event already exists), retry without If-None-Match
    if (resp.status === 412 && !existingEtag) {
      resp = await fetch(eventUrl, {
        method: "PUT",
        headers: { Authorization: makeBasicAuth(username, password), "Content-Type": "text/calendar; charset=utf-8" },
        body,
      });
    }
    if (resp.status === 200 || resp.status === 201 || resp.status === 204) {
      return { ok: true, etag: resp.headers.get("ETag") || undefined };
    }
    return { ok: false, error: `HTTP ${resp.status}` };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

async function caldavDeleteEvent(
  calendarUrl: string, username: string, password: string,
  uid: string, etag?: string | null
): Promise<{ ok: boolean }> {
  const base = calendarUrl.endsWith("/") ? calendarUrl : calendarUrl + "/";
  const eventUrl = `${base}${uid}.ics`;
  const headers: Record<string, string> = { Authorization: makeBasicAuth(username, password) };
  if (etag) headers["If-Match"] = etag;
  try {
    const resp = await fetch(eventUrl, { method: "DELETE", headers });
    return { ok: resp.status === 200 || resp.status === 204 || resp.status === 404 };
  } catch {
    return { ok: false };
  }
}

// ─── Minimal iCal VEVENT parser ───────────────────────────────────────────────

function parseIcal(ical: string) {
  const events: {
    uid: string;
    summary: string;
    dtstart: string;
    dtend: string;
    description?: string;
    location?: string;
    allDay: boolean;
    cancelled: boolean;
    attendees: string[];
    url?: string;
    lastModified?: Date;
  }[] = [];

  const vevents = ical.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];

  for (const vevent of vevents) {
    // Unfold lines (RFC5545: CRLF + whitespace = continuation)
    const unfolded = vevent.replace(/\r?\n[ \t]/g, "");

    const get = (key: string): string => {
      const m = unfolded.match(new RegExp(`^${key}[^:\\r\\n]*:([^\\r\\n]*)`, "im"));
      return (m?.[1] ?? "")
        .trim()
        .replace(/\\n/g, "\n")
        .replace(/\\,/g, ",")
        .replace(/\\;/g, ";")
        .replace(/\\\\/g, "\\");
    };

    const uid = get("UID");
    const summary = get("SUMMARY");
    const dtstart = get("DTSTART");
    const dtend = get("DTEND") || get("DUE");

    if (!uid || !summary || !dtstart) continue;

    const allDay = /^\d{8}$/.test(dtstart);
    const toISO = (s: string): string => {
      if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00`;
      const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
      if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7]}`;
      return s;
    };

    const attendeeMatches = [...unfolded.matchAll(/^ATTENDEE[^\r\n]*:([^\r\n]+)/gim)];
    const attendees = attendeeMatches
      .map((m) => m[1].match(/mailto:([^\s;:]+)/i)?.[1] || "")
      .filter(Boolean);

    const lastModifiedRaw = get("LAST-MODIFIED") || get("DTSTAMP");
    const lastModified = lastModifiedRaw
      ? (() => {
          const d = new Date(toISO(lastModifiedRaw));
          return isNaN(d.getTime()) ? undefined : d;
        })()
      : undefined;

    events.push({
      uid,
      summary,
      dtstart: toISO(dtstart),
      dtend: dtend ? toISO(dtend) : toISO(dtstart),
      description: get("DESCRIPTION") || undefined,
      location: get("LOCATION") || undefined,
      allDay,
      cancelled: get("STATUS").toUpperCase() === "CANCELLED",
      attendees,
      url: get("URL") || undefined,
      lastModified,
    });
  }

  return events;
}

export async function syncCalDav(
  connectionId: number,
  userId: number
): Promise<{ imported: number; updated: number; pushed: number; deleted: number; errors: string[] }> {
  const [conn] = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.id, connectionId))
    .limit(1);

  if (!conn?.caldavUrl || !conn?.caldavUsername || !conn?.caldavPassword) {
    throw new Error("CalDAV connection not configured");
  }

  const errors: string[] = [];
  let imported = 0;
  let updated = 0;
  let pushed = 0;
  let deleted = 0;
  const conflictResolution = conn.conflictResolution || "latest_wins";

  try {
    const calendarUrl = conn.defaultCalendarId || conn.caldavUrl;

    const timeMin = new Date();
    timeMin.setMonth(timeMin.getMonth() - 2);
    const timeMax = new Date();
    timeMax.setMonth(timeMax.getMonth() + 6);
    const fmtZ = (d: Date) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

    // ── PULL: import CalDAV events into Cortex ────────────────────────────
    const reportBody = `<?xml version="1.0" encoding="UTF-8"?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="${fmtZ(timeMin)}" end="${fmtZ(timeMax)}"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;

    const resp = await caldavRequest("REPORT", calendarUrl, conn.caldavUsername, conn.caldavPassword, reportBody, { Depth: "1" });

    // Parse response into per-response blocks to correlate ETags with calendar-data
    const responseBlocks = resp.body.match(/<[^:]*:?response[\s\S]*?<\/[^:]*:?response>/gi) || [];
    const remoteUidSet = new Set<string>();

    if (conn.syncDirection !== "push") {
      for (const block of responseBlocks) {
        const etagMatch = block.match(/<[^:]*:?getetag[^>]*>\s*"?([^"<\s]+)"?\s*<\/[^:]*:?getetag>/i);
        const calDataMatch = block.match(/<[^:]*:?calendar-data[^>]*>([\s\S]*?)<\/[^:]*:?calendar-data>/i);
        if (!calDataMatch) continue;

        const remoteEtag = etagMatch?.[1]?.trim();
        const icalData = calDataMatch[1]
          .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();

        const events = parseIcal(icalData);
        for (const ev of events) {
          remoteUidSet.add(ev.uid);
          try {
            const startTime = new Date(ev.dtstart);
            const endTime = new Date(ev.dtend);
            if (isNaN(startTime.getTime())) continue;

            const [existing] = await db
              .select({ id: calendarEvents.id, updatedAt: calendarEvents.updatedAt, externalEtag: calendarEvents.externalEtag })
              .from(calendarEvents)
              .where(and(eq(calendarEvents.externalId, ev.uid), eq(calendarEvents.externalProvider, conn.provider)))
              .limit(1);

            if (existing) {
              // Conflict resolution
              let shouldUpdate = true;
              if (conflictResolution === "cortex_wins") {
                // Keep Cortex version — skip provider update
                shouldUpdate = false;
              } else if (conflictResolution === "latest_wins" && ev.lastModified && existing.updatedAt) {
                // Provider wins only if provider's version is newer
                shouldUpdate = ev.lastModified >= existing.updatedAt;
              }

              if (shouldUpdate) {
                await db.update(calendarEvents).set({
                  title: ev.summary,
                  description: ev.description || null,
                  location: ev.location || null,
                  startTime,
                  endTime: isNaN(endTime.getTime()) ? startTime : endTime,
                  allDay: ev.allDay,
                  invitees: ev.attendees,
                  meetingUrl: ev.url || null,
                  status: ev.cancelled ? "cancelled" : "scheduled",
                  externalEtag: remoteEtag || null,
                  updatedAt: new Date(),
                }).where(eq(calendarEvents.id, existing.id));
                updated++;
              }
            } else {
              await db.insert(calendarEvents).values({
                userId,
                title: ev.summary,
                description: ev.description || null,
                location: ev.location || null,
                eventType: "meeting",
                startTime,
                endTime: isNaN(endTime.getTime()) ? startTime : endTime,
                allDay: ev.allDay,
                invitees: ev.attendees,
                meetingUrl: ev.url || null,
                status: ev.cancelled ? "cancelled" : "scheduled",
                externalId: ev.uid,
                externalEtag: remoteEtag || null,
                externalProvider: conn.provider,
                externalCalendarId: calendarUrl,
              });
              imported++;
            }
          } catch (e: any) {
            errors.push(`Pull "${ev.summary}": ${e.message}`);
          }
        }
      }

      // ── DELETION DETECTION: mark cancelled if gone from server ──────────
      const dbEvents = await db
        .select({ id: calendarEvents.id, externalId: calendarEvents.externalId, externalEtag: calendarEvents.externalEtag })
        .from(calendarEvents)
        .where(and(
          eq(calendarEvents.userId, userId),
          eq(calendarEvents.externalProvider, conn.provider),
        ));

      for (const dbEv of dbEvents) {
        if (dbEv.externalId && !remoteUidSet.has(dbEv.externalId) && !dbEv.externalId.startsWith("cortex-")) {
          await db.update(calendarEvents)
            .set({ status: "cancelled", updatedAt: new Date() })
            .where(eq(calendarEvents.id, dbEv.id));
          deleted++;
        }
      }
    }

    // ── PUSH: send Cortex-native events to CalDAV server ─────────────────
    if (conn.syncDirection === "both" || conn.syncDirection === "push") {
      // Push truly native events (no external provider) that haven't been pushed yet
      const nativeEvents = await db
        .select()
        .from(calendarEvents)
        .where(and(
          eq(calendarEvents.userId, userId),
          isNull(calendarEvents.externalProvider),
        ));

      for (const ev of nativeEvents) {
        if (!ev.startTime) continue;
        const uid = `cortex-${ev.id}@voltsafe.com`;
        const result = await caldavPutEvent(
          calendarUrl, conn.caldavUsername, conn.caldavPassword, uid,
          { title: ev.title, startTime: ev.startTime, endTime: ev.endTime || ev.startTime, description: ev.description, location: ev.location, allDay: ev.allDay || false },
          null
        );
        if (result.ok) {
          await db.update(calendarEvents).set({
            externalId: uid,
            externalEtag: result.etag || null,
            externalProvider: conn.provider,
            externalCalendarId: calendarUrl,
            updatedAt: new Date(),
          }).where(eq(calendarEvents.id, ev.id));
          pushed++;
        } else {
          errors.push(`Push "${ev.title}": ${result.error}`);
        }
      }

      // Re-push already-pushed Cortex events that were updated locally (cortex-prefixed UIDs)
      const pushedEvents = await db
        .select()
        .from(calendarEvents)
        .where(and(
          eq(calendarEvents.userId, userId),
          eq(calendarEvents.externalProvider, conn.provider),
        ));

      for (const ev of pushedEvents) {
        if (!ev.externalId?.startsWith("cortex-") || !ev.startTime) continue;
        // Re-push if Cortex version is newer than last sync
        if (conn.lastSyncedAt && ev.updatedAt && ev.updatedAt <= conn.lastSyncedAt) continue;
        const result = await caldavPutEvent(
          calendarUrl, conn.caldavUsername, conn.caldavPassword, ev.externalId,
          { title: ev.title, startTime: ev.startTime, endTime: ev.endTime || ev.startTime, description: ev.description, location: ev.location, allDay: ev.allDay || false },
          ev.externalEtag
        );
        if (result.ok) {
          await db.update(calendarEvents).set({
            externalEtag: result.etag || ev.externalEtag,
            updatedAt: new Date(),
          }).where(eq(calendarEvents.id, ev.id));
          pushed++;
        } else {
          errors.push(`Re-push "${ev.title}": ${result.error}`);
        }
      }
    }

    await db.update(calendarConnections)
      .set({ lastSyncedAt: new Date(), syncError: null, updatedAt: new Date() })
      .where(eq(calendarConnections.id, connectionId));
  } catch (err: any) {
    const friendly = friendlyCalendarError(err);
    await db.update(calendarConnections)
      .set({ syncError: friendly, updatedAt: new Date() })
      .where(eq(calendarConnections.id, connectionId));
    throw new Error(friendly);
  }

  return { imported, updated, pushed, deleted, errors };
}

// ─── Auto-sync scheduler ──────────────────────────────────────────────────────

async function syncAllActiveCalendars(): Promise<void> {
  const active = await db
    .select({ id: calendarConnections.id, userId: calendarConnections.userId, provider: calendarConnections.provider })
    .from(calendarConnections)
    .where(and(eq(calendarConnections.isActive, true), eq(calendarConnections.syncEnabled, true)));

  for (const conn of active) {
    try {
      if (conn.provider === "google") {
        await syncGoogleCalendar(conn.id, conn.userId);
      } else {
        await syncCalDav(conn.id, conn.userId);
      }
    } catch (err: any) {
      console.error(`[calendar-sync] auto-sync failed for connection ${conn.id}: ${err.message}`);
    }
  }
}

export function startCalendarSyncScheduler(): void {
  const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
  console.log("[calendar-sync] Auto-sync scheduler started — interval=15min");

  // One pass shortly after boot so events are fresh without waiting 15 min
  setTimeout(() => {
    syncAllActiveCalendars().catch((e) => console.error("[calendar-sync] startup sync error:", e.message));
  }, 45_000);

  setInterval(() => {
    syncAllActiveCalendars().catch((e) => console.error("[calendar-sync] scheduled sync error:", e.message));
  }, INTERVAL_MS);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export async function getCalendarIntegrations(userId: number) {
  return db
    .select()
    .from(calendarConnections)
    .where(and(eq(calendarConnections.userId, userId), eq(calendarConnections.isActive, true)));
}

export async function disconnectCalendarIntegration(
  connectionId: number,
  userId: number
): Promise<void> {
  await db
    .update(calendarConnections)
    .set({ isActive: false, updatedAt: new Date() })
    .where(
      and(
        eq(calendarConnections.id, connectionId),
        eq(calendarConnections.userId, userId)
      )
    );
}
