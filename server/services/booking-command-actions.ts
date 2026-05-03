/**
 * Phase H — Booking Command Center: One-Click Actions
 *
 * Creates follow-up tasks from Command Center cards with strict owner scoping
 * and dedup against existing pending booking_followup tasks (kind-aware).
 *
 * Tasks are written with:
 *   source     = 'booking_followup'  (so the existing engine + bucket logic
 *                                     surfaces / suppresses them uniformly)
 *   sourceMeta = { source: 'booking_command_center', kind, recipientId,
 *                  bookingLinkId, email }
 */

import { db } from "../db";
import { eq, and, sql, inArray } from "drizzle-orm";
import {
  tasks, bookingLinks, bookingLinkRecipients,
  contacts, leads,
} from "@shared/schema";

export type ActionKind =
  | "HOT_OPENED_NOT_BOOKED"
  | "BOOKED_NO_QUOTE"
  | "REVENUE_LEAK";

export const ALLOWED_KINDS: ActionKind[] = [
  "HOT_OPENED_NOT_BOOKED",
  "BOOKED_NO_QUOTE",
  "REVENUE_LEAK",
];

const ACTIVE_STATUSES_NOT_IN = ["done", "completed", "dismissed", "cancelled"];

/** Permission/validation errors carry an HTTP status hint for the route. */
export class CommandActionError extends Error {
  status: number;
  constructor(status: number, msg: string) { super(msg); this.status = status; }
}

interface CreateInput {
  callerUserId:   number;
  callerIsAdmin:  boolean;
  kind:           ActionKind;
  recipientId:    number;
  bookingLinkId?: number;
  note?:          string;
}

interface CreateResult {
  created:       boolean;       // false = pre-existing pending task returned
  taskId:        number;
  kind:          ActionKind;
  recipientId:   number;
  bookingLinkId: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CRM resolution — best-effort link to contact > lead, by email (LOWER match)
// ─────────────────────────────────────────────────────────────────────────────
async function resolveCrmLink(email: string): Promise<{
  linkedObjectType: string | null;
  linkedObjectId:   number | null;
  accountId:        number | null;
}> {
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

// ─────────────────────────────────────────────────────────────────────────────
// Title / description per kind
// ─────────────────────────────────────────────────────────────────────────────
function copyForKind(kind: ActionKind, linkName: string, email: string, note?: string): {
  title: string; description: string; priority: "low" | "medium" | "high";
} {
  const noteSuffix = note && note.trim() ? `\n\nNote: ${note.trim()}` : "";
  switch (kind) {
    case "HOT_OPENED_NOT_BOOKED":
      return {
        title:       `Follow up — opened booking link, not booked: ${email}`,
        description: `Recipient opened "${linkName}" but has not booked. Send a personal nudge.${noteSuffix}`,
        priority:    "medium",
      };
    case "BOOKED_NO_QUOTE":
      return {
        title:       `Send quote — booked meeting, no quote yet: ${email}`,
        description: `Meeting was booked via "${linkName}" but no quote has been sent. Draft and send a quote.${noteSuffix}`,
        priority:    "high",
      };
    case "REVENUE_LEAK":
      return {
        title:       `Recover stalled quote — booked + quoted, not won: ${email}`,
        description: `"${linkName}" produced a meeting and quote(s) but no acceptance. Chase the close.${noteSuffix}`,
        priority:    "high",
      };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dedup — kind-aware pending booking_followup task lookup
// ─────────────────────────────────────────────────────────────────────────────
async function findExistingPendingTask(
  recipientId: number, kind: ActionKind,
): Promise<number | null> {
  const [row] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(
      eq(tasks.source, "booking_followup"),
      sql`${tasks.sourceMeta}->>'recipientId' = ${String(recipientId)}`,
      sql`${tasks.sourceMeta}->>'kind' = ${kind}`,
      sql`${tasks.status} NOT IN ('done','completed','dismissed','cancelled')`,
    ))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Returns a Set<`${recipientId}:${kind}`> of recipients with an OPEN
 * booking_command_center / booking_followup task for that kind. Used by the
 * Command Center service to suppress already-actioned cards.
 */
export async function pendingActionKeysFor(
  recipientIds: number[], kinds: ActionKind[],
): Promise<Set<string>> {
  if (recipientIds.length === 0 || kinds.length === 0) return new Set();
  const rows = await db
    .select({
      rid:  sql<string>`${tasks.sourceMeta}->>'recipientId'`,
      kind: sql<string>`${tasks.sourceMeta}->>'kind'`,
    })
    .from(tasks)
    .where(and(
      eq(tasks.source, "booking_followup"),
      sql`${tasks.sourceMeta}->>'recipientId' = ANY(${sql.raw(
        `ARRAY[${recipientIds.map((n) => Number(n)).join(",")}]::text[]`,
      )})`,
      inArray(sql`${tasks.sourceMeta}->>'kind'`, kinds as unknown as string[]),
      sql`${tasks.status} NOT IN ('done','completed','dismissed','cancelled')`,
    ));
  const set = new Set<string>();
  for (const r of rows) {
    if (r.rid && r.kind) set.add(`${r.rid}:${r.kind}`);
  }
  return set;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry — create one follow-up task from a Command Center card
// ─────────────────────────────────────────────────────────────────────────────
export async function createFollowupTaskFromCommandCenter(
  input: CreateInput,
): Promise<CreateResult> {
  const { callerUserId, callerIsAdmin, kind, recipientId, note } = input;

  if (!ALLOWED_KINDS.includes(kind)) {
    throw new CommandActionError(400, `Unsupported kind: ${kind}`);
  }
  if (!Number.isInteger(recipientId) || recipientId <= 0) {
    throw new CommandActionError(400, "recipientId must be a positive integer");
  }
  if (note != null && (typeof note !== "string" || note.length > 500)) {
    throw new CommandActionError(400, "note must be a string ≤ 500 chars");
  }

  // Load recipient + booking link in one round-trip; drives ownership check.
  const [rec] = await db
    .select({
      recipientId:    bookingLinkRecipients.id,
      recipientEmail: bookingLinkRecipients.recipientEmail,
      bookingLinkId:  bookingLinks.id,
      bookingLinkName: bookingLinks.name,
      ownerUserId:    bookingLinks.ownerUserId,
      revokedAt:      bookingLinkRecipients.revokedAt,
    })
    .from(bookingLinkRecipients)
    .innerJoin(bookingLinks, eq(bookingLinks.id, bookingLinkRecipients.bookingLinkId))
    .where(eq(bookingLinkRecipients.id, recipientId))
    .limit(1);

  if (!rec) {
    throw new CommandActionError(404, "Recipient not found");
  }
  if (rec.revokedAt) {
    throw new CommandActionError(400, "Recipient is revoked");
  }
  // Optional bookingLinkId sanity — if caller passes one, it must match.
  if (input.bookingLinkId != null && input.bookingLinkId !== rec.bookingLinkId) {
    throw new CommandActionError(400, "bookingLinkId does not match recipient");
  }
  // Owner scoping — non-admins may only act on their own booking link recipients.
  if (!callerIsAdmin && rec.ownerUserId !== callerUserId) {
    throw new CommandActionError(403, "Forbidden: recipient not owned by caller");
  }

  // Dedup — return existing pending task if one already exists for (recipient,kind).
  const existingId = await findExistingPendingTask(recipientId, kind);
  if (existingId != null) {
    return {
      created:       false,
      taskId:        existingId,
      kind,
      recipientId,
      bookingLinkId: rec.bookingLinkId,
    };
  }

  const copy = copyForKind(kind, rec.bookingLinkName, rec.recipientEmail, note);
  const crm  = await resolveCrmLink(rec.recipientEmail);
  const dueDate = new Date(Date.now() + 24 * 3600_000);

  const [created] = await db.insert(tasks).values({
    title:            copy.title,
    description:      copy.description,
    ownerUserId:      rec.ownerUserId,            // task belongs to link owner, not caller
    createdByUserId:  callerUserId,
    linkedObjectType: crm.linkedObjectType,
    linkedObjectId:   crm.linkedObjectId,
    accountId:        crm.accountId,
    status:           "pending",
    priority:         copy.priority,
    dueDate,
    aiSuggested:      false,
    source:           "booking_followup",
    sourceLabel:      rec.bookingLinkName,
    sourceMeta:       {
      source:        "booking_command_center",
      kind,
      recipientId:   rec.recipientId,
      bookingLinkId: rec.bookingLinkId,
      email:         rec.recipientEmail,
    },
  }).returning({ id: tasks.id });

  return {
    created:       true,
    taskId:        created.id,
    kind,
    recipientId:   rec.recipientId,
    bookingLinkId: rec.bookingLinkId,
  };
}
