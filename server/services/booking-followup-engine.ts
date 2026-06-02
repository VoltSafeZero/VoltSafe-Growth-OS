/**
 * Phase D — Booking Follow-Up Automation
 *
 * Scans booking_link_recipients and creates suggested follow-up tasks for
 * the booking-link owner in three scenarios:
 *
 *   R1 SENT_NOT_OPENED      — sent_at older than SENT_NOT_OPENED_DAYS,
 *                              no first_viewed_at yet, not revoked.
 *   R2 OPENED_NOT_BOOKED    — first_viewed_at older than
 *                              OPENED_NOT_BOOKED_DAYS, not booked, not revoked.
 *   R3 POST_MEETING_FOLLOWUP — booked, the linked calendar_event.end_time
 *                              has passed by at least POST_MEETING_HOURS.
 *
 * Tasks are created with:
 *   source     = 'booking_followup'
 *   sourceMeta = { recipientId, kind }     ← idempotency key
 *
 * Re-runs are safe: a unique guard query "WHERE source='booking_followup'
 * AND sourceMeta->>'recipientId'=:id AND sourceMeta->>'kind'=:kind"
 * blocks duplicate inserts. We do NOT re-create after a user dismisses,
 * completes, or archives a task — the row still satisfies the guard.
 *
 * The CRM record link is best-effort:
 *   recipient_email → contacts.email   (preferred; populates accountId too)
 *                  → leads.contact_email (fallback)
 *                  → null              (no CRM link, task still owner-scoped)
 *
 * No schema changes. No new dependencies. Uses the same idempotency pattern
 * (source + sourceMeta jsonb) already used by engagement-rules.ts.
 */

import { db } from "../db";
import {
  bookingLinks, bookingLinkRecipients, contacts, leads, calendarEvents, tasks,
} from "@shared/schema";
import { and, eq, isNull, isNotNull, lte, sql } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// Tunable thresholds — adjust here, no schema/migration needed.
// ─────────────────────────────────────────────────────────────────────────────
export const SENT_NOT_OPENED_DAYS    = 3;
export const OPENED_NOT_BOOKED_DAYS  = 2;
export const POST_MEETING_HOURS      = 2;
/** Cap on how many tasks a single scan creates (safety valve). */
export const MAX_TASKS_PER_SCAN      = 200;
/** Scheduler tick interval (6h matches engagement-scheduler). */
export const FOLLOWUP_SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type FollowupKind =
  | "sent_not_opened"
  | "opened_not_booked"
  | "post_meeting_followup";

export interface FollowupRunResult {
  scanned:  { sentNotOpened: number; openedNotBooked: number; postMeeting: number };
  created:  number;
  skipped:  number;
  perKind:  Record<FollowupKind, number>;
  taskIds:  number[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-row helpers
// ─────────────────────────────────────────────────────────────────────────────

interface CrmLink {
  linkedObjectType: "contact" | "lead" | null;
  linkedObjectId:   number | null;
  accountId:        number | null;
}

async function resolveCrmLink(email: string): Promise<CrmLink> {
  const lc = email.toLowerCase();
  const [c] = await db
    .select({ id: contacts.id, accountId: contacts.accountId })
    .from(contacts)
    .where(sql`LOWER(${contacts.email}) = ${lc}`)
    .limit(1);
  if (c) return { linkedObjectType: "contact", linkedObjectId: c.id, accountId: c.accountId ?? null };

  const [l] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(sql`LOWER(${leads.contactEmail}) = ${lc}`)
    .limit(1);
  if (l) return { linkedObjectType: "lead", linkedObjectId: l.id, accountId: null };

  return { linkedObjectType: null, linkedObjectId: null, accountId: null };
}

/** Idempotency guard — true if a follow-up task already exists for this (recipient, kind). */
async function alreadyHasTask(recipientId: number, kind: FollowupKind): Promise<boolean> {
  const [row] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(
      eq(tasks.source, "booking_followup"),
      sql`${tasks.sourceMeta}->>'recipientId' = ${String(recipientId)}`,
      sql`${tasks.sourceMeta}->>'kind' = ${kind}`,
    ))
    .limit(1);
  return !!row;
}

interface CreateArgs {
  ownerUserId: number;
  recipientId: number;
  recipientEmail: string;
  bookingLinkName: string;
  kind: FollowupKind;
  title: string;
  description: string;
  dueDate: Date;
  priority?: "low" | "medium" | "high";
}

async function createFollowupTask(a: CreateArgs): Promise<number | null> {
  if (await alreadyHasTask(a.recipientId, a.kind)) return null;
  const crm = await resolveCrmLink(a.recipientEmail);
  const [row] = await db.insert(tasks).values({
    title:            a.title,
    description:      a.description,
    ownerUserId:      a.ownerUserId,
    createdByUserId:  a.ownerUserId,
    linkedObjectType: crm.linkedObjectType,
    linkedObjectId:   crm.linkedObjectId,
    accountId:        crm.accountId,
    status:           "pending",
    priority:         a.priority ?? "medium",
    dueDate:          a.dueDate,
    aiSuggested:      true,
    source:           "booking_followup",
    sourceLabel:      a.bookingLinkName,
    sourceMeta:       {
      recipientId: a.recipientId,
      kind:        a.kind,
      email:       a.recipientEmail,
    },
  }).returning({ id: tasks.id });
  return row?.id ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scan / Create — one pass
// ─────────────────────────────────────────────────────────────────────────────

interface ScanRow {
  recipientId:   number;
  recipientEmail: string;
  ownerUserId:   number;
  linkName:      string;
  sentAt:        Date | null;
  firstViewedAt: Date | null;
  bookedAt:      Date | null;
  meetingEndAt:  Date | null;
}

async function fetchSentNotOpened(now: Date): Promise<ScanRow[]> {
  const cutoff = new Date(now.getTime() - SENT_NOT_OPENED_DAYS * 86400_000);
  const rows = await db
    .select({
      recipientId:    bookingLinkRecipients.id,
      recipientEmail: bookingLinkRecipients.recipientEmail,
      ownerUserId:    bookingLinks.ownerUserId,
      linkName:       bookingLinks.name,
      sentAt:         bookingLinkRecipients.sentAt,
      firstViewedAt:  bookingLinkRecipients.firstViewedAt,
      bookedAt:       bookingLinkRecipients.bookedAt,
    })
    .from(bookingLinkRecipients)
    .innerJoin(bookingLinks, eq(bookingLinks.id, bookingLinkRecipients.bookingLinkId))
    .where(and(
      isNotNull(bookingLinkRecipients.sentAt),
      isNull(bookingLinkRecipients.firstViewedAt),
      isNull(bookingLinkRecipients.bookedAt),
      isNull(bookingLinkRecipients.revokedAt),
      lte(bookingLinkRecipients.sentAt, cutoff),
    ))
    .limit(MAX_TASKS_PER_SCAN);
  return rows.map((r) => ({ ...r, meetingEndAt: null }));
}

async function fetchOpenedNotBooked(now: Date): Promise<ScanRow[]> {
  const cutoff = new Date(now.getTime() - OPENED_NOT_BOOKED_DAYS * 86400_000);
  const rows = await db
    .select({
      recipientId:    bookingLinkRecipients.id,
      recipientEmail: bookingLinkRecipients.recipientEmail,
      ownerUserId:    bookingLinks.ownerUserId,
      linkName:       bookingLinks.name,
      sentAt:         bookingLinkRecipients.sentAt,
      firstViewedAt:  bookingLinkRecipients.firstViewedAt,
      bookedAt:       bookingLinkRecipients.bookedAt,
    })
    .from(bookingLinkRecipients)
    .innerJoin(bookingLinks, eq(bookingLinks.id, bookingLinkRecipients.bookingLinkId))
    .where(and(
      isNotNull(bookingLinkRecipients.firstViewedAt),
      isNull(bookingLinkRecipients.bookedAt),
      isNull(bookingLinkRecipients.revokedAt),
      lte(bookingLinkRecipients.firstViewedAt, cutoff),
    ))
    .limit(MAX_TASKS_PER_SCAN);
  return rows.map((r) => ({ ...r, meetingEndAt: null }));
}

async function fetchPostMeeting(now: Date): Promise<ScanRow[]> {
  const cutoff = new Date(now.getTime() - POST_MEETING_HOURS * 3600_000);
  const rows = await db
    .select({
      recipientId:    bookingLinkRecipients.id,
      recipientEmail: bookingLinkRecipients.recipientEmail,
      ownerUserId:    bookingLinks.ownerUserId,
      linkName:       bookingLinks.name,
      sentAt:         bookingLinkRecipients.sentAt,
      firstViewedAt:  bookingLinkRecipients.firstViewedAt,
      bookedAt:       bookingLinkRecipients.bookedAt,
      meetingEndAt:   calendarEvents.endTime,
    })
    .from(bookingLinkRecipients)
    .innerJoin(bookingLinks,    eq(bookingLinks.id, bookingLinkRecipients.bookingLinkId))
    .innerJoin(calendarEvents,  eq(calendarEvents.id, bookingLinkRecipients.bookedCalendarEventId))
    .where(and(
      isNotNull(bookingLinkRecipients.bookedAt),
      isNull(bookingLinkRecipients.revokedAt),
      isNotNull(calendarEvents.endTime),
      lte(calendarEvents.endTime, cutoff),
    ))
    .limit(MAX_TASKS_PER_SCAN);
  return rows;
}

function buildPayload(kind: FollowupKind, row: ScanRow, now: Date) {
  const email = row.recipientEmail;
  const link  = row.linkName;
  switch (kind) {
    case "sent_not_opened":
      return {
        title:       `Follow up: ${email} hasn't opened booking link`,
        description: `Sent on ${row.sentAt?.toISOString().slice(0,10)} via "${link}". No open after ${SENT_NOT_OPENED_DAYS} days — consider a nudge or alternate channel.`,
        dueDate:     new Date(now.getTime() + 24 * 3600_000),
        priority:    "medium" as const,
      };
    case "opened_not_booked":
      return {
        title:       `Nudge: ${email} opened but didn't book`,
        description: `First viewed on ${row.firstViewedAt?.toISOString().slice(0,10)} via "${link}". ${OPENED_NOT_BOOKED_DAYS}+ days with no booking — they're warm; reach out.`,
        dueDate:     new Date(now.getTime() + 12 * 3600_000),
        priority:    "high" as const,
      };
    case "post_meeting_followup":
      return {
        title:       `Post-meeting follow-up: ${email}`,
        description: `Meeting via "${link}" wrapped on ${row.meetingEndAt?.toISOString().slice(0,16).replace("T"," ")}. Send recap, next steps, or proposal.`,
        dueDate:     new Date(now.getTime() + 24 * 3600_000),
        priority:    "high" as const,
      };
  }
}

/**
 * Run one scan pass. Pure: takes optional `now` for deterministic tests.
 * Idempotent: if called twice, the second call creates 0 new tasks.
 *
 * AUTO-TASK CREATION IS DISABLED. Tasks must be created explicitly by users.
 * The scan logic is preserved so it can be re-enabled by removing the early return.
 */
export async function runFollowupScan(now: Date = new Date()): Promise<FollowupRunResult> {
  // Auto-task creation from booking follow-up events is disabled.
  // Remove this block to re-enable.
  console.log("[booking-followup] scan skipped — auto-task creation is disabled");
  return {
    scanned: { sentNotOpened: 0, openedNotBooked: 0, postMeeting: 0 },
    created: 0, skipped: 0,
    perKind: { sent_not_opened: 0, opened_not_booked: 0, post_meeting_followup: 0 },
    taskIds: [],
  };

  const [r1, r2, r3] = await Promise.all([
    fetchSentNotOpened(now),
    fetchOpenedNotBooked(now),
    fetchPostMeeting(now),
  ]);

  const result: FollowupRunResult = {
    scanned: { sentNotOpened: r1.length, openedNotBooked: r2.length, postMeeting: r3.length },
    created: 0,
    skipped: 0,
    perKind: { sent_not_opened: 0, opened_not_booked: 0, post_meeting_followup: 0 },
    taskIds: [],
  };

  const passes: { kind: FollowupKind; rows: ScanRow[] }[] = [
    { kind: "sent_not_opened",       rows: r1 },
    { kind: "opened_not_booked",     rows: r2 },
    { kind: "post_meeting_followup", rows: r3 },
  ];

  for (const { kind, rows } of passes) {
    for (const row of rows) {
      if (result.created >= MAX_TASKS_PER_SCAN) break;
      const payload = buildPayload(kind, row, now);
      const id = await createFollowupTask({
        ownerUserId:     row.ownerUserId,
        recipientId:     row.recipientId,
        recipientEmail:  row.recipientEmail,
        bookingLinkName: row.linkName,
        kind,
        ...payload,
      });
      if (id == null) result.skipped++;
      else { result.created++; result.perKind[kind]++; result.taskIds.push(id); }
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduler — register from server boot
// ─────────────────────────────────────────────────────────────────────────────
let started = false;
export function startFollowupScheduler(): void {
  if (started) return;
  started = true;
  setTimeout(() => {
    runFollowupScan().then(
      (r) => console.log(`[booking-followup] initial scan: created=${r.created} skipped=${r.skipped}`),
      (e) => console.error("[booking-followup] initial scan error:", e),
    );
  }, 30_000);
  setInterval(() => {
    runFollowupScan().then(
      (r) => console.log(`[booking-followup] tick: created=${r.created} skipped=${r.skipped}`),
      (e) => console.error("[booking-followup] periodic scan error:", e),
    );
  }, FOLLOWUP_SCAN_INTERVAL_MS);
  console.log(`[booking-followup] scheduler armed — interval=${FOLLOWUP_SCAN_INTERVAL_MS / 3600_000}h`);
}
