// Calendar Privacy Visibility Policy — central resolver.
//
// Mirrors the mailbox `visibility_type` model (private_personal / company_managed /
// team_shared) used for email_accounts, extended with `external_calendar`.
//
// CRITICAL CONSTRAINT: admin / master_admin / exec privilege MUST NOT override
// private-calendar privacy. Only the calendar owner ever sees full details for a
// private_personal or external_calendar connection. Everyone else gets busy/free
// + start/end time only, labeled "Busy" / "Unavailable".
//
// Every calendar-reading endpoint, widget, or AI context builder MUST route
// visibility decisions through resolveCalendarVisibility() rather than
// re-implementing role checks locally.

import { db } from "../db";
import { sql } from "drizzle-orm";

export type CalendarVisibilityType =
  | "private_personal"
  | "company_managed"
  | "team_shared"
  | "external_calendar";

export interface RequestingUser {
  id: number;
  globalRole: string | null | undefined;
}

export interface CalendarAccountInfo {
  visibilityType: CalendarVisibilityType | null | undefined;
  userId: number;
}

export interface CalendarVisibilityResult {
  canViewDetails: boolean;
  canViewBusyOnly: boolean;
  canEdit: boolean;
  reason:
    | "owner"
    | "elevated_role"
    | "team_shared"
    | "explicit_permission"
    | "private_calendar"
    | "no_permission";
  visibilityType: CalendarVisibilityType;
}

// Roles that may view FULL DETAILS of any internal user's @voltsafe.com work
// calendar (view-only — editing still requires ownership or an explicit grant).
const ELEVATED_ROLES = new Set(["master_admin", "admin", "exec", "executive", "ceo", "cfo"]);

const PRIVATE_TYPES = new Set<CalendarVisibilityType>(["private_personal", "external_calendar"]);

/**
 * Classifies a calendar connection at creation/sync time, following the
 * mailbox domain-enforcement precedent:
 *   @voltsafe.com                → company_managed
 *   non-@voltsafe.com (Gmail/Outlook/etc, personally connected) → private_personal
 * `external_calendar` is reserved for connections explicitly flagged as
 * belonging to an outside organization/shared resource (never auto-assigned
 * from a bare email address) — callers may pass it explicitly when known.
 */
export function classifyCalendarConnection(accountEmail: string | null | undefined): CalendarVisibilityType {
  const email = (accountEmail || "").toLowerCase().trim();
  if (email.endsWith("@voltsafe.com")) return "company_managed";
  return "private_personal";
}

/**
 * Central resolver. Every calendar-reading code path MUST call this before
 * returning event data for a user other than the event owner.
 *
 * `calendarAccount` is null for native VoltSafe events that were never synced
 * from an external/personal calendar connection — those are treated as the
 * owner's default company_managed work calendar.
 */
export function resolveCalendarVisibility(
  requestingUser: RequestingUser,
  calendarAccount: CalendarAccountInfo | null,
  eventOwnerUserId: number
): CalendarVisibilityResult {
  const visibilityType: CalendarVisibilityType = calendarAccount?.visibilityType ?? "company_managed";

  const isOwner = requestingUser.id === eventOwnerUserId;
  if (isOwner) {
    return { canViewDetails: true, canViewBusyOnly: false, canEdit: true, reason: "owner", visibilityType };
  }

  // Private personal / external calendars: NEVER expose details to a non-owner,
  // regardless of role. This check runs before any role check by design.
  if (PRIVATE_TYPES.has(visibilityType)) {
    return { canViewDetails: false, canViewBusyOnly: true, canEdit: false, reason: "private_calendar", visibilityType };
  }

  // team_shared calendars (e.g. company-wide shared resource calendars) are
  // visible in full to every internal user by design — same as mailbox team_shared.
  if (visibilityType === "team_shared") {
    return { canViewDetails: true, canViewBusyOnly: false, canEdit: false, reason: "team_shared", visibilityType };
  }

  // company_managed (@voltsafe.com work calendar): elevated roles get full
  // view-only access to ANY internal user's work calendar.
  const role = requestingUser.globalRole ?? "";
  if (ELEVATED_ROLES.has(role)) {
    return { canViewDetails: true, canViewBusyOnly: false, canEdit: false, reason: "elevated_role", visibilityType };
  }

  // Non-elevated internal users: fall back to existing company visibility rules
  // (users.permissions.calendar_team grants) — the caller is expected to have
  // already filtered eventOwnerUserId against that permission list before
  // reaching this resolver. If we get here, the caller already granted access.
  return { canViewDetails: true, canViewBusyOnly: false, canEdit: false, reason: "explicit_permission", visibilityType };
}

/**
 * Strips a calendar event down to the busy/free-safe shape: only start/end
 * time and a generic "Busy" label survive. No title, description, location,
 * meeting link, attendees, invitees, notes, conference URL, attachments, or
 * organizer details may leak through this function.
 */
export function sanitizeEventForBusyOnly<T extends Record<string, any>>(event: T): Record<string, any> {
  return {
    id: event.id,
    userId: event.userId,
    title: "Busy",
    description: null,
    eventType: "busy",
    startTime: event.startTime,
    endTime: event.endTime,
    allDay: event.allDay ?? false,
    location: null,
    meetingUrl: null,
    invitees: null,
    attendeeDetails: null,
    linkedObjectType: null,
    linkedObjectId: null,
    color: null,
    status: event.status,
    calendarName: null,
    externalProvider: null,
    externalId: null,
    isBusyOnly: true,
    visibilityLabel: "Busy",
  };
}

/**
 * Looks up the visibility_type + owner for the calendar connection(s) tied to
 * a batch of userIds, keyed by connection id, for use when resolving many
 * events at once (e.g. team calendar views). Falls back gracefully if the
 * column/table isn't reachable.
 */
export async function loadConnectionVisibilityMap(
  connectionIds: number[]
): Promise<Map<number, CalendarAccountInfo>> {
  const map = new Map<number, CalendarAccountInfo>();
  const ids = connectionIds.filter((id) => Number.isFinite(id));
  if (ids.length === 0) return map;
  try {
    const rows = await db.execute(
      sql.raw(
        `SELECT id, user_id AS "userId", COALESCE(visibility_type, 'private_personal') AS "visibilityType"
         FROM calendar_connections WHERE id IN (${ids.join(",")})`
      )
    );
    for (const r of (rows as any).rows as any[]) {
      map.set(Number(r.id), { userId: Number(r.userId), visibilityType: r.visibilityType });
    }
  } catch (e: any) {
    console.error("[calendar-visibility] loadConnectionVisibilityMap error:", e.message);
  }
  return map;
}

/**
 * calendar_events.connection_id is an additive raw-SQL column (not part of the
 * Drizzle schema, per project convention), so it is never returned by
 * `db.select().from(calendarEvents)`. Callers must look it up separately via
 * this helper and merge it into event objects before calling
 * resolveCalendarVisibility().
 */
export async function loadEventConnectionIds(eventIds: number[]): Promise<Map<number, number | null>> {
  const map = new Map<number, number | null>();
  const ids = eventIds.filter((id) => Number.isFinite(id));
  if (ids.length === 0) return map;
  try {
    const rows = await db.execute(
      sql.raw(`SELECT id, connection_id AS "connectionId" FROM calendar_events WHERE id IN (${ids.join(",")})`)
    );
    for (const r of (rows as any).rows as any[]) {
      map.set(Number(r.id), r.connectionId != null ? Number(r.connectionId) : null);
    }
  } catch (e: any) {
    console.error("[calendar-visibility] loadEventConnectionIds error:", e.message);
  }
  return map;
}

/**
 * Given an event's connectionId (may be null for native/manual events) and the
 * event owner's userId, resolves the CalendarAccountInfo to pass into
 * resolveCalendarVisibility(). Native events with no connection default to the
 * owner's company_managed work calendar.
 */
export function accountInfoForEvent(
  connectionId: number | null | undefined,
  eventOwnerUserId: number,
  connectionMap: Map<number, CalendarAccountInfo>
): CalendarAccountInfo | null {
  if (connectionId == null) return null;
  return connectionMap.get(connectionId) ?? { userId: eventOwnerUserId, visibilityType: "company_managed" };
}
