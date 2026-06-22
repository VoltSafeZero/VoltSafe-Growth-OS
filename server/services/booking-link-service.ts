/**
 * booking-link-service.ts — Phase A.2
 *
 * Service layer for booking_links and booking_link_recipients.
 *
 * Responsibilities:
 *  - Create / update / list booking links (scoped to ownerUserId)
 *  - Generate recipient-specific tokens
 *  - Revoke recipient tokens
 *  - Read public booking info (safe projection — no internal tokens)
 *
 * All DB access goes through this layer; routes stay thin.
 */

import crypto from "crypto";
import { db } from "../db";
import { bookingLinks, bookingLinkRecipients, calendarEvents } from "@shared/schema";
import { eq, and, isNull, isNotNull, lt, gt } from "drizzle-orm";
import { z } from "zod";
import { createZoomMeetingForBooking } from "./zoom-meeting-service";

// ─────────────────────────────────────────────────────────────────────────────
// Validation schemas (shared between service and routes)
// ─────────────────────────────────────────────────────────────────────────────

/** Single availability window for one day-of-week. */
export const availabilityWindowSchema = z.object({
  dow: z.number().int().min(0).max(6),
  start: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "start must be HH:MM")
    .refine((s) => {
      const [h, m] = s.split(":").map(Number);
      return h >= 0 && h <= 23 && m >= 0 && m <= 59;
    }, "start time out of range"),
  end: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "end must be HH:MM")
    .refine((s) => {
      const [h, m] = s.split(":").map(Number);
      return h >= 0 && h <= 23 && m >= 0 && m <= 59;
    }, "end time out of range"),
}).refine(
  (w) => w.end > w.start,
  { message: "end time must be after start time", path: ["end"] },
);

export const availabilitySchema = z.array(availabilityWindowSchema).max(28);

/** Schema for creating a booking link. */
export const createBookingLinkSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  slug: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase letters, digits, or hyphens"),
  slotMinutes: z.number().int().min(5).max(480).default(30),
  bufferMinutes: z.number().int().min(0).max(120).default(0),
  advanceDays: z.number().int().min(1).max(365).default(14),
  minNoticeHours: z.number().int().min(0).max(168).default(4),
  timeZone: z.string().min(1).max(60).default("America/Los_Angeles"),
  availability: availabilitySchema.default([]),
  locationType: z
    .enum(["zoom", "phone", "in_person", "other"])
    .default("zoom"),
  locationValue: z.string().max(500).optional(),
  requireRecipientMatch: z.boolean().default(true),
  active: z.boolean().default(true),
});

export type CreateBookingLinkInput = z.infer<typeof createBookingLinkSchema>;

/** Schema for updating a booking link (all fields optional). */
export const updateBookingLinkSchema = createBookingLinkSchema.partial().omit({ slug: true });
export type UpdateBookingLinkInput = z.infer<typeof updateBookingLinkSchema>;

/** Schema for adding a recipient. */
export const addRecipientSchema = z.object({
  recipientEmail: z.string().email("invalid email address"),
});

export type AddRecipientInput = z.infer<typeof addRecipientSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type BookingLinkRow = typeof bookingLinks.$inferSelect;
export type BookingLinkRecipientRow = typeof bookingLinkRecipients.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Public-safe URL validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true iff `url` is a syntactically valid http/https URL whose
 * hostname is exactly `zoom.us` or any subdomain of `zoom.us`. Uses the
 * WHATWG URL parser so substring tricks like
 * `https://evil.com#zoom.us/x`, `https://evil.com/zoom.us/x`, or
 * `https://evil.com?zoom.us/` cannot slip past — the hostname is the
 * authoritative origin component.
 */
export function isZoomJoinUrl(url: string | null | undefined): url is string {
  if (!url || typeof url !== "string") return false;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  const host = parsed.hostname.toLowerCase();
  return host === "zoom.us" || host.endsWith(".zoom.us");
}

// ─────────────────────────────────────────────────────────────────────────────
// Server-side slot validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thrown by confirmBooking() when the requested slot violates the booking
 * link's scheduling rules.  The route catches this and returns HTTP 422 so
 * the caller knows the slot itself is the problem (not a server error).
 */
export class BookingSlotError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "BookingSlotError";
  }
}

/** Return the day-of-week (0=Sunday…6=Saturday) of `date` in `tz`. */
function dowInTz(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).formatToParts(date);
  const day = parts.find((p) => p.type === "weekday")?.value ?? "";
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(day);
}

/** Return the local time as "HH:MM" in `tz`. */
function hhmmInTz(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${h}:${m}`;
}

/**
 * Validates a proposed slot against the booking link's scheduling rules.
 *
 * Rules enforced (all server-side, matching what the public UI shows):
 *  1. slotStart must be at least `minNoticeHours` from now.
 *  2. slotStart must not be further than `advanceDays` from now.
 *  3. If availability windows are configured, the entire slot
 *     (slotStart … slotStart + slotMinutes) must fall within a window
 *     whose day-of-week matches — evaluated in the link's timezone.
 *
 * Returns null if the slot is valid; returns a human-readable reason string
 * if it violates a rule.
 */
export function validateSlotAgainstLink(
  link: {
    slotMinutes: number;
    advanceDays: number;
    minNoticeHours: number;
    timeZone: string;
    availability: { dow: number; start: string; end: string }[];
  },
  slotStart: string,
): string | null {
  const start = new Date(slotStart);
  if (isNaN(start.getTime())) return "slotStart is not a valid date";

  const now = Date.now();

  // Rule 1: minimum notice
  const minNoticeMs = link.minNoticeHours * 3_600_000;
  if (start.getTime() < now + minNoticeMs) {
    return `Slot must be at least ${link.minNoticeHours} hour(s) from now`;
  }

  // Rule 2: booking horizon
  const horizonMs = link.advanceDays * 86_400_000;
  if (start.getTime() > now + horizonMs) {
    return `Slot is further than ${link.advanceDays} day(s) in advance`;
  }

  // Rule 3: availability windows (only enforced when windows are defined)
  const windows = link.availability;
  if (windows && windows.length > 0) {
    const tz = link.timeZone || "UTC";
    const slotDow = dowInTz(start, tz);
    const slotStartHHMM = hhmmInTz(start, tz);
    const slotEnd = new Date(start.getTime() + link.slotMinutes * 60_000);
    const slotEndHHMM = hhmmInTz(slotEnd, tz);

    const fits = windows.some(
      (w) =>
        w.dow === slotDow &&
        slotStartHHMM >= w.start &&
        slotEndHHMM <= w.end,
    );

    if (!fits) {
      return "Slot does not fall within the booking link's available hours";
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Booking link CRUD
// ─────────────────────────────────────────────────────────────────────────────

/** List all booking links for a given owner, newest first. */
export async function listBookingLinks(ownerUserId: number): Promise<BookingLinkRow[]> {
  return db
    .select()
    .from(bookingLinks)
    .where(eq(bookingLinks.ownerUserId, ownerUserId))
    .orderBy(bookingLinks.createdAt);
}

/** Get a single booking link by id, verifying ownership. Returns null if not found or wrong owner. */
export async function getBookingLink(
  id: number,
  ownerUserId: number,
): Promise<BookingLinkRow | null> {
  const [row] = await db
    .select()
    .from(bookingLinks)
    .where(and(eq(bookingLinks.id, id), eq(bookingLinks.ownerUserId, ownerUserId)))
    .limit(1);
  return row ?? null;
}

/** Get a booking link by slug (public lookup — no owner filter). */
export async function getBookingLinkBySlug(slug: string): Promise<BookingLinkRow | null> {
  const [row] = await db
    .select()
    .from(bookingLinks)
    .where(and(eq(bookingLinks.slug, slug), eq(bookingLinks.active, true)))
    .limit(1);
  return row ?? null;
}

/** Create a new booking link. Throws if the slug is already taken. */
export async function createBookingLink(
  ownerUserId: number,
  input: CreateBookingLinkInput,
): Promise<BookingLinkRow> {
  // Guard: slug uniqueness
  const existing = await db
    .select({ id: bookingLinks.id })
    .from(bookingLinks)
    .where(eq(bookingLinks.slug, input.slug))
    .limit(1);
  if (existing.length > 0) {
    const err = new Error(`Slug "${input.slug}" is already taken`);
    (err as any).status = 409;
    throw err;
  }

  const now = new Date();
  const [created] = await db
    .insert(bookingLinks)
    .values({
      ownerUserId,
      name: input.name,
      description: input.description ?? null,
      slug: input.slug,
      slotMinutes: input.slotMinutes ?? 30,
      bufferMinutes: input.bufferMinutes ?? 0,
      advanceDays: input.advanceDays ?? 14,
      minNoticeHours: input.minNoticeHours ?? 4,
      timeZone: input.timeZone ?? "America/Los_Angeles",
      availability: input.availability ?? [],
      locationType: input.locationType ?? "zoom",
      locationValue: input.locationValue ?? null,
      requireRecipientMatch: input.requireRecipientMatch ?? true,
      active: input.active ?? true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return created;
}

/** Update a booking link (owner-scoped). Returns null if not found / not owner. */
export async function updateBookingLink(
  id: number,
  ownerUserId: number,
  input: UpdateBookingLinkInput,
): Promise<BookingLinkRow | null> {
  const existing = await getBookingLink(id, ownerUserId);
  if (!existing) return null;

  const setValues: Partial<BookingLinkRow> = { updatedAt: new Date() };
  if (input.name !== undefined) setValues.name = input.name;
  if (input.description !== undefined) setValues.description = input.description ?? null;
  if (input.slotMinutes !== undefined) setValues.slotMinutes = input.slotMinutes;
  if (input.bufferMinutes !== undefined) setValues.bufferMinutes = input.bufferMinutes;
  if (input.advanceDays !== undefined) setValues.advanceDays = input.advanceDays;
  if (input.minNoticeHours !== undefined) setValues.minNoticeHours = input.minNoticeHours;
  if (input.timeZone !== undefined) setValues.timeZone = input.timeZone;
  if (input.availability !== undefined) setValues.availability = input.availability;
  if (input.locationType !== undefined) setValues.locationType = input.locationType;
  if (input.locationValue !== undefined) setValues.locationValue = input.locationValue ?? null;
  if (input.requireRecipientMatch !== undefined) setValues.requireRecipientMatch = input.requireRecipientMatch;
  if (input.active !== undefined) setValues.active = input.active;

  const [updated] = await db
    .update(bookingLinks)
    .set(setValues)
    .where(and(eq(bookingLinks.id, id), eq(bookingLinks.ownerUserId, ownerUserId)))
    .returning();
  return updated ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipient token management
// ─────────────────────────────────────────────────────────────────────────────

/** Generate a cryptographically secure 32-byte URL-safe token. */
function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * List all recipients for a booking link (owner-scoped).
 * Returns [] if the link doesn't belong to the owner.
 */
export async function listRecipients(
  bookingLinkId: number,
  ownerUserId: number,
): Promise<BookingLinkRecipientRow[]> {
  // Verify ownership first
  const link = await getBookingLink(bookingLinkId, ownerUserId);
  if (!link) return [];
  return db
    .select()
    .from(bookingLinkRecipients)
    .where(eq(bookingLinkRecipients.bookingLinkId, bookingLinkId))
    .orderBy(bookingLinkRecipients.createdAt);
}

/**
 * Add a recipient to a booking link.
 * Idempotent: if the (link, email) pair already exists, returns the existing row.
 * Returns null if the booking link doesn't exist / wrong owner.
 */
export async function addRecipient(
  bookingLinkId: number,
  ownerUserId: number,
  email: string,
): Promise<BookingLinkRecipientRow | null> {
  const link = await getBookingLink(bookingLinkId, ownerUserId);
  if (!link) return null;

  const normalizedEmail = email.toLowerCase().trim();

  // Idempotency: return existing active row if present
  const [existing] = await db
    .select()
    .from(bookingLinkRecipients)
    .where(
      and(
        eq(bookingLinkRecipients.bookingLinkId, bookingLinkId),
        eq(bookingLinkRecipients.recipientEmail, normalizedEmail),
      ),
    )
    .limit(1);
  if (existing && !existing.revokedAt) return existing;

  const token = generateToken();
  const now = new Date();
  const [created] = await db
    .insert(bookingLinkRecipients)
    .values({
      bookingLinkId,
      recipientEmail: normalizedEmail,
      token,
      viewCount: 0,
      createdAt: now,
    })
    .returning();
  return created;
}

/**
 * Revoke a recipient token by recipient row id (owner-scoped via link).
 * Returns true if revoked, false if not found / already revoked / wrong owner.
 */
export async function revokeRecipient(
  recipientId: number,
  ownerUserId: number,
): Promise<boolean> {
  // Fetch recipient and verify via booking link ownership
  const [recipient] = await db
    .select()
    .from(bookingLinkRecipients)
    .where(eq(bookingLinkRecipients.id, recipientId))
    .limit(1);
  if (!recipient) return false;

  const link = await getBookingLink(recipient.bookingLinkId, ownerUserId);
  if (!link) return false;

  if (recipient.revokedAt) return false; // already revoked

  await db
    .update(bookingLinkRecipients)
    .set({ revokedAt: new Date() })
    .where(eq(bookingLinkRecipients.id, recipientId));
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public token lookup
// ─────────────────────────────────────────────────────────────────────────────

export interface PublicBookingView {
  bookingLink: {
    name: string;
    description: string | null;
    slug: string;
    slotMinutes: number;
    bufferMinutes: number;
    advanceDays: number;
    minNoticeHours: number;
    timeZone: string;
    availability: { dow: number; start: string; end: string }[];
    locationType: string;
    requireRecipientMatch: boolean;
  };
  recipientEmail: string;
  alreadyBooked: boolean;
  bookedAt: Date | null;
  /**
   * If alreadyBooked, the projected event details so the recipient can rejoin
   * after page refresh. Always omits any sensitive fields (startUrl, owner id,
   * tokens). Null when not booked or the linked event has been deleted.
   */
  bookedEvent: {
    startTime: Date;
    endTime: Date;
    zoomJoinUrl: string | null;
  } | null;
}

/**
 * Resolves a public booking URL token to the scheduling info an invitee needs.
 * Does NOT expose the raw token, other recipients, or internal IDs.
 * Returns null if the token is invalid, revoked, or the link is inactive.
 */
export async function resolvePublicToken(token: string): Promise<PublicBookingView | null> {
  const [recipient] = await db
    .select()
    .from(bookingLinkRecipients)
    .where(eq(bookingLinkRecipients.token, token))
    .limit(1);

  if (!recipient || recipient.revokedAt) return null;

  const [link] = await db
    .select()
    .from(bookingLinks)
    .where(and(eq(bookingLinks.id, recipient.bookingLinkId), eq(bookingLinks.active, true)))
    .limit(1);

  if (!link) return null;

  // Record first view
  const now = new Date();
  await db
    .update(bookingLinkRecipients)
    .set({
      firstViewedAt: recipient.firstViewedAt ?? now,
      viewCount: recipient.viewCount + 1,
    })
    .where(eq(bookingLinkRecipients.id, recipient.id));

  // If already booked AND the calendar event still exists, surface the
  // SAFE subset of event fields (start, end, join URL) so the public page
  // can show a "rejoin" UI on refresh. Never project meetingUrl unless its
  // hostname is zoom.us or a *.zoom.us subdomain (defence-in-depth via
  // proper URL parsing — guards against the field being misused for
  // non-zoom links we might persist later, and against URLs that merely
  // *contain* the substring "zoom.us/" outside the hostname, e.g.
  // "https://evil.com#zoom.us/...").
  let bookedEvent: PublicBookingView["bookedEvent"] = null;
  if (recipient.bookedAt && recipient.bookedCalendarEventId) {
    const [evt] = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.id, recipient.bookedCalendarEventId))
      .limit(1);
    if (evt) {
      bookedEvent = {
        startTime: evt.startTime,
        endTime:   evt.endTime ?? evt.startTime,
        zoomJoinUrl: isZoomJoinUrl(evt.meetingUrl) ? evt.meetingUrl : null,
      };
    }
  }

  return {
    bookingLink: {
      name: link.name,
      description: link.description,
      slug: link.slug,
      slotMinutes: link.slotMinutes,
      bufferMinutes: link.bufferMinutes,
      advanceDays: link.advanceDays,
      minNoticeHours: link.minNoticeHours,
      timeZone: link.timeZone,
      availability: (link.availability as { dow: number; start: string; end: string }[]) ?? [],
      locationType: link.locationType,
      requireRecipientMatch: link.requireRecipientMatch,
    },
    recipientEmail: recipient.recipientEmail,
    alreadyBooked: !!recipient.bookedAt,
    bookedAt: recipient.bookedAt,
    bookedEvent,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Booking confirmation
// ─────────────────────────────────────────────────────────────────────────────

export const confirmBookingSchema = z.object({
  slotStart:      z.string().datetime({ message: "slotStart must be an ISO 8601 datetime" }),
  attendeeName:   z.string().max(200).optional(),
  attendeeEmail:  z.string().email().max(320).optional(),
});

export interface ConfirmBookingResult {
  calendarEventId: number;
  startTime: Date;
  endTime: Date;
  zoomJoinUrl: string | null;
  zoomMeetingId: string | null;
  zoomPassword: string | null;
  alreadyBooked: boolean;
}

/**
 * Confirms a booking for the given public recipient token.
 * - Validates token is still live and not already booked.
 * - Attempts to create a Zoom meeting for the link owner (gracefully skipped if
 *   the owner has no Zoom connection or the API call fails).
 * - Inserts a calendar_events row linked back to the recipient.
 * - Marks the recipient row as booked.
 * Returns null if the token is invalid/revoked.
 * Returns { alreadyBooked: true } if the slot was already taken.
 */
export async function confirmBooking(
  token: string,
  data: { slotStart: string; attendeeName?: string; attendeeEmail?: string },
): Promise<ConfirmBookingResult | null> {
  // 1. Resolve recipient
  const [recipient] = await db
    .select()
    .from(bookingLinkRecipients)
    .where(eq(bookingLinkRecipients.token, token))
    .limit(1);

  if (!recipient || recipient.revokedAt) return null;

  // 2. Guard: already booked
  if (recipient.bookedAt) {
    const event = recipient.bookedCalendarEventId
      ? await db
          .select()
          .from(calendarEvents)
          .where(eq(calendarEvents.id, recipient.bookedCalendarEventId))
          .limit(1)
          .then((r) => r[0])
      : null;
    return {
      calendarEventId: recipient.bookedCalendarEventId ?? 0,
      startTime:       event?.startTime ?? new Date(data.slotStart),
      endTime:         event?.endTime ?? new Date(data.slotStart),
      zoomJoinUrl:     event?.meetingUrl ?? null,
      zoomMeetingId:   null,
      zoomPassword:    null,
      alreadyBooked:   true,
    };
  }

  // 3. Get active booking link
  const [link] = await db
    .select()
    .from(bookingLinks)
    .where(and(eq(bookingLinks.id, recipient.bookingLinkId), eq(bookingLinks.active, true)))
    .limit(1);

  if (!link) return null;

  // 3b. SERVER-SIDE SLOT VALIDATION
  // The public page only shows slots that pass these rules, but the server
  // must enforce them too because any token holder can POST an arbitrary
  // slotStart — there is no signature or round-trip integrity guarantee.
  const availability = (link.availability as { dow: number; start: string; end: string }[]) ?? [];
  const slotError = validateSlotAgainstLink(
    {
      slotMinutes:    link.slotMinutes,
      advanceDays:    link.advanceDays,
      minNoticeHours: link.minNoticeHours,
      timeZone:       link.timeZone ?? "UTC",
      availability,
    },
    data.slotStart,
  );
  if (slotError) {
    throw new BookingSlotError(slotError);
  }

  // 3c. RECIPIENT MATCH — when enabled, the caller must supply the email address
  // that this booking token was issued to. Without this check any token holder
  // who obtained the URL (e.g. from a forwarded invite) could book on behalf of
  // the intended recipient without proving they are that person.
  if (link.requireRecipientMatch) {
    const supplied = (data.attendeeEmail ?? "").toLowerCase().trim();
    const expected = recipient.recipientEmail.toLowerCase().trim();
    if (!supplied || supplied !== expected) {
      throw new BookingSlotError(
        "This booking link requires confirming the email address it was sent to"
      );
    }
  }

  // 3d. BUFFER CONFLICT — if the link has a bufferMinutes setting, reject slots
  // that would leave less than that buffer around any existing calendar event
  // owned by the same user.  The check is advisory on the client but mandatory
  // here so no token holder can bypass it by posting an arbitrary slotStart.
  if (link.bufferMinutes > 0) {
    const _reqStart = new Date(data.slotStart);
    const _reqEnd   = new Date(_reqStart.getTime() + link.slotMinutes * 60_000);
    const _bufMs    = link.bufferMinutes * 60_000;
    const _bufStart = new Date(_reqStart.getTime() - _bufMs);
    const _bufEnd   = new Date(_reqEnd.getTime()   + _bufMs);
    const _conflicts = await db
      .select({ id: calendarEvents.id })
      .from(calendarEvents)
      .where(and(
        eq(calendarEvents.userId, link.ownerUserId),
        isNotNull(calendarEvents.endTime),
        lt(calendarEvents.startTime, _bufEnd),
        gt(calendarEvents.endTime!, _bufStart),
      ))
      .limit(1);
    if (_conflicts.length > 0) {
      throw new BookingSlotError(
        `This slot conflicts with an existing booking — a ${link.bufferMinutes}-minute buffer is required between meetings`
      );
    }
  }

  // 4. Calculate times
  const startTime = new Date(data.slotStart);
  const endTime   = new Date(startTime.getTime() + link.slotMinutes * 60_000);
  const now       = new Date();

  // 5. ATOMIC RESERVATION (Phase A.3 — concurrent-confirm race fix)
  //
  // Compare-and-set: only the request that flips `booked_at` from NULL to NOW()
  // is allowed to proceed. Postgres UPDATE … WHERE booked_at IS NULL is atomic
  // under the default READ COMMITTED isolation: only one concurrent UPDATE
  // matches the predicate; the other observes the new value and matches 0 rows.
  //
  // We also include `revoked_at IS NULL` in the predicate so that a token
  // revoked between the initial SELECT (step 1) and this reservation cannot
  // sneak through (TOCTOU defence).
  //
  // This avoids holding a DB row lock across the (slow) Zoom API call, while
  // still guaranteeing exactly-once semantics for first-time confirmation.
  const reserved = await db
    .update(bookingLinkRecipients)
    .set({ bookedAt: now })
    .where(and(
      eq(bookingLinkRecipients.id, recipient.id),
      isNull(bookingLinkRecipients.bookedAt),
      isNull(bookingLinkRecipients.revokedAt),
    ))
    .returning({ id: bookingLinkRecipients.id });

  if (reserved.length === 0) {
    // We lost the race. The winner has reserved the recipient but may still
    // be mid-flight (Zoom create + calendar insert). Re-read with a short
    // bounded wait so the common case returns the canonical calendarEventId
    // rather than a placeholder. Total wait <= ~500ms; well within the
    // budget of an HTTP request the user is already waiting on.
    const POLL_INTERVAL_MS = 100;
    const POLL_MAX = 20; // 20 × 100ms = 2000ms ceiling — covers Zoom-create + DB commit under contention
    let latest: typeof recipient | undefined;
    for (let i = 0; i < POLL_MAX; i++) {
      const [row] = await db
        .select()
        .from(bookingLinkRecipients)
        .where(eq(bookingLinkRecipients.id, recipient.id))
        .limit(1);
      latest = row;
      if (row?.bookedCalendarEventId) break;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    const event = latest?.bookedCalendarEventId
      ? await db
          .select()
          .from(calendarEvents)
          .where(eq(calendarEvents.id, latest.bookedCalendarEventId))
          .limit(1)
          .then((r) => r[0])
      : null;

    console.log(
      `[booking] race-loser token=${token.slice(0, 8)}… recipientId=${recipient.id} ` +
      `existingCalEventId=${latest?.bookedCalendarEventId ?? "<in-flight>"}`,
    );

    return {
      calendarEventId: latest?.bookedCalendarEventId ?? 0,
      startTime:       event?.startTime ?? startTime,
      endTime:         event?.endTime ?? endTime,
      zoomJoinUrl:     event?.meetingUrl ?? null,
      zoomMeetingId:   null,
      zoomPassword:    null,
      alreadyBooked:   true,
    };
  }

  // 5b. Live-state revalidation: even though the reservation succeeded, the
  // booking link itself may have been deactivated between the initial fetch
  // (step 3) and the reservation. If so, release the reservation and 404.
  const [linkLive] = await db
    .select()
    .from(bookingLinks)
    .where(and(eq(bookingLinks.id, link.id), eq(bookingLinks.active, true)))
    .limit(1);

  if (!linkLive) {
    await db
      .update(bookingLinkRecipients)
      .set({ bookedAt: null })
      .where(eq(bookingLinkRecipients.id, recipient.id));
    return null;
  }

  // 6. We won the reservation. Now do the slow / external work.
  //
  // Failure semantics:
  //   - Zoom call (6a) is best-effort and never throws; null on failure.
  //   - DB writes (6b + 6c) run inside a single transaction so they atomically
  //     commit or both roll back. This means the catch block can safely clear
  //     `booked_at` without ever creating a duplicate calendar_events row on
  //     retry (architect-flagged hardening, Phase A.3).
  let zoomMeeting: Awaited<ReturnType<typeof createZoomMeetingForBooking>> = null;
  try {
    // 6a. Try to create Zoom meeting (best-effort; never throws)
    zoomMeeting = await createZoomMeetingForBooking(link.ownerUserId, {
      topic:           link.name,
      startTime,
      durationMinutes: link.slotMinutes,
      timezone:        link.timeZone ?? undefined,
      attendeeEmail:   recipient.recipientEmail,
      attendeeName:    data.attendeeName,
      agenda:          link.description ?? undefined,
    });

    // 6b + 6c. Atomic: insert the calendar event AND link it back onto the
    // (already-reserved) recipient row. If either fails, both roll back, and
    // the outer catch will safely release the reservation.
    const calEvent = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(calendarEvents)
        .values({
          userId:                  link.ownerUserId,
          title:                   link.name,
          description:             link.description,
          eventType:               "meeting",
          startTime,
          endTime,
          allDay:                  false,
          location:                zoomMeeting?.joinUrl ?? null,
          meetingUrl:              zoomMeeting?.joinUrl ?? null,
          status:                  "scheduled",
          invitees:                [recipient.recipientEmail],
          bookingLinkRecipientId:  recipient.id,
          createdAt:               now,
          updatedAt:               now,
        })
        .returning();

      await tx
        .update(bookingLinkRecipients)
        .set({ bookedCalendarEventId: created.id })
        .where(eq(bookingLinkRecipients.id, recipient.id));

      return created;
    });

    console.log(
      `[booking] confirmed token=${token.slice(0, 8)}… calEventId=${calEvent.id} zoom=${zoomMeeting ? zoomMeeting.meetingId : "none"}`,
    );

    return {
      calendarEventId: calEvent.id,
      startTime,
      endTime,
      zoomJoinUrl:   zoomMeeting?.joinUrl   ?? null,
      zoomMeetingId: zoomMeeting?.meetingId ?? null,
      zoomPassword:  zoomMeeting?.password  ?? null,
      alreadyBooked: false,
    };
  } catch (err) {
    // Transaction rolled back → no calendar_events row exists for this
    // recipient, so it's safe to release the reservation. (Even if the Zoom
    // meeting was created, it would only be orphaned on the Zoom side; we
    // never persisted a reference to it locally.)
    try {
      await db
        .update(bookingLinkRecipients)
        .set({ bookedAt: null })
        .where(and(
          eq(bookingLinkRecipients.id, recipient.id),
          // Defence-in-depth: only release if no calendar_event was linked.
          // If somehow one exists (concurrent winner), leave booked_at alone.
          isNull(bookingLinkRecipients.bookedCalendarEventId),
        ));
    } catch (releaseErr: unknown) {
      console.error(
        `[booking] failed to release reservation for recipientId=${recipient.id}:`,
        (releaseErr as Error).message,
      );
    }
    throw err;
  }
}
