import { db } from "../db";
import crypto from "crypto";
import {
  meetingNotes, meetingNoteTranscriptChunks, meetingNoteActionItems,
  meetingNoteParticipants, meetingNoteLinks,
  activities, tasks, calendarEvents,
  MeetingNote,
} from "@shared/schema";
import { eq, and, desc, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  populateParticipantsFromEmails,
  computeParticipantSuggestions,
  getUserEmail,
} from "./participant-matcher";

// ── Enums / constants ────────────────────────────────────────────────────────

export const VALID_SOURCES   = ["calendar", "mail", "adhoc", "upload"] as const;
export const VALID_PLATFORMS = ["zoom", "teams", "meet", "phone", "in_person", "other"] as const;
export const VALID_OBJECT_TYPES = [
  "account", "contact", "lead", "opportunity", "project", "ticket",
] as const;
export const VALID_ACTION_ITEM_STATUSES = [
  "suggested", "accepted", "rejected", "task_created",
] as const;
export const VALID_NOTE_STATUSES = [
  "scheduled_prompted", "recording", "processing", "completed", "failed", "cancelled",
] as const;

// Status transitions: key = current status, value = allowed next statuses
const STATUS_TRANSITIONS: Record<string, string[]> = {
  scheduled_prompted: ["recording", "cancelled"],
  adhoc:              ["recording", "cancelled"],
  recording:          ["processing", "cancelled"],
  processing:         ["completed", "failed", "cancelled"],
  completed:          ["cancelled"],
  failed:             ["processing", "cancelled"],
  cancelled:          [],
};

// ── Validation schemas ────────────────────────────────────────────────────────

export const createMeetingNoteSchema = z.object({
  title:           z.string().max(200).optional(),
  source:          z.enum(VALID_SOURCES),
  platform:        z.enum(VALID_PLATFORMS).optional(),
  calendarEventId: z.number().int().positive().optional(),
  emailThreadId:   z.string().optional(),
  emailMessageId:  z.number().int().positive().optional(),
  linkedObjectType: z.enum(VALID_OBJECT_TYPES).optional(),
  linkedObjectId:  z.number().int().positive().optional(),
  consentNoted:    z.boolean().optional(),
});

export const updateMeetingNoteSchema = z.object({
  title:             z.string().max(200).optional(),
  platform:          z.enum(VALID_PLATFORMS).optional(),
  linkedObjectType:  z.enum(VALID_OBJECT_TYPES).optional(),
  linkedObjectId:    z.number().int().positive().optional(),
  notesText:         z.string().optional(),
  summaryText:       z.string().optional(),
  decisionsText:     z.string().optional(),
  consentNoted:      z.boolean().optional(),
  rawTranscriptText: z.string().nullable().optional(),
});

export const linkRecordSchema = z.object({
  objectType:       z.enum(VALID_OBJECT_TYPES),
  objectId:         z.number().int().positive(),
  relationshipType: z.string().max(100).optional(),
});

export const draftFollowupSchema = z.object({
  followupDraftText: z.string(),
});

export const createTasksSchema = z.object({
  ownerUserId:      z.number().int().positive().optional(),
  linkedObjectType: z.enum(VALID_OBJECT_TYPES).optional(),
  linkedObjectId:   z.number().int().positive().optional(),
});

// ── Permission helpers ────────────────────────────────────────────────────────

export function canAccess(note: MeetingNote, userId: number, isAdmin: boolean): boolean {
  return isAdmin || note.createdBy === userId;
}

export function sessionIsAdmin(session: any): boolean {
  const role = String(session?.globalRole ?? "");
  return role === "master_admin" || role === "admin";
}

// ── Note lookup with permission guard ────────────────────────────────────────

export async function lookupNote(
  id: number, userId: number, isAdmin: boolean,
): Promise<MeetingNote | null> {
  const [note] = await db
    .select()
    .from(meetingNotes)
    .where(eq(meetingNotes.id, id))
    .limit(1);
  if (!note) return null;
  if (!canAccess(note, userId, isAdmin)) return null;
  return note;
}

// ── Meeting provider detection ────────────────────────────────────────────────

export function detectMeetingProvider(
  meetingUrl?: string | null,
  location?: string | null,
  description?: string | null,
): { platform: typeof VALID_PLATFORMS[number] | null; joinUrl: string | null } {
  const sources = [meetingUrl, location, description].filter(Boolean) as string[];

  for (const src of sources) {
    if (/zoom\.us\//i.test(src)) {
      const m = src.match(/https?:\/\/[a-z0-9.-]*zoom\.us\/[^\s"'<>)]+/i);
      return { platform: "zoom", joinUrl: m ? m[0] : (meetingUrl ?? null) };
    }
    if (/teams\.microsoft\.com|teams\.live\.com/i.test(src)) {
      const m = src.match(/https?:\/\/teams\.[a-z.]+\/[^\s"'<>)]+/i);
      return { platform: "teams", joinUrl: m ? m[0] : (meetingUrl ?? null) };
    }
    if (/meet\.google\.com/i.test(src)) {
      const m = src.match(/https?:\/\/meet\.google\.com\/[^\s"'<>)]+/i);
      return { platform: "meet", joinUrl: m ? m[0] : (meetingUrl ?? null) };
    }
  }

  if (meetingUrl && /^https?:\/\//i.test(meetingUrl)) {
    return { platform: "other", joinUrl: meetingUrl };
  }
  return { platform: null, joinUrl: null };
}

// ── List ──────────────────────────────────────────────────────────────────────

export async function listMeetingNotes(userId: number, isAdmin: boolean) {
  const base = db
    .select({
      id:               meetingNotes.id,
      uuid:             meetingNotes.uuid,
      title:            meetingNotes.title,
      status:           meetingNotes.status,
      source:           meetingNotes.source,
      createdBy:        meetingNotes.createdBy,
      calendarEventId:  meetingNotes.calendarEventId,
      emailThreadId:    meetingNotes.emailThreadId,
      emailMessageId:   meetingNotes.emailMessageId,
      linkedObjectType: meetingNotes.linkedObjectType,
      linkedObjectId:   meetingNotes.linkedObjectId,
      startedAt:        meetingNotes.startedAt,
      endedAt:          meetingNotes.endedAt,
      durationSeconds:  meetingNotes.durationSeconds,
      platform:         meetingNotes.platform,
      audioStorageKey:  meetingNotes.audioStorageKey,
      rawTranscriptText:   meetingNotes.rawTranscriptText,
      cleanTranscriptText: meetingNotes.cleanTranscriptText,
      summaryText:      meetingNotes.summaryText,
      notesText:        meetingNotes.notesText,
      decisionsText:    meetingNotes.decisionsText,
      actionItemsText:  meetingNotes.actionItemsText,
      followupDraftText: meetingNotes.followupDraftText,
      processingError:    meetingNotes.processingError,
      processingStepText: meetingNotes.processingStepText,
      consentNoted:     meetingNotes.consentNoted,
      createdAt:        meetingNotes.createdAt,
      updatedAt:        meetingNotes.updatedAt,
      // Enrichment from linked calendar event
      calendarEventTitle:     calendarEvents.title,
      calendarEventStartTime: calendarEvents.startTime,
    })
    .from(meetingNotes)
    .leftJoin(calendarEvents, eq(meetingNotes.calendarEventId, calendarEvents.id))
    .orderBy(desc(meetingNotes.createdAt));

  if (isAdmin) return base;
  return base.where(eq(meetingNotes.createdBy, userId));
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createMeetingNote(
  userId: number,
  data: z.infer<typeof createMeetingNoteSchema>,
): Promise<MeetingNote> {
  const [note] = await db
    .insert(meetingNotes)
    .values({
      uuid:             crypto.randomUUID(),
      source:           data.source,
      title:            data.title           ?? null,
      status:           "scheduled_prompted",
      createdBy:        userId,
      platform:         data.platform        ?? null,
      calendarEventId:  data.calendarEventId ?? null,
      emailThreadId:    data.emailThreadId   ?? null,
      emailMessageId:   data.emailMessageId  ?? null,
      linkedObjectType: data.linkedObjectType ?? null,
      linkedObjectId:   data.linkedObjectId  ?? null,
      consentNoted:     data.consentNoted    ?? false,
    })
    .returning();
  return note;
}

// ── Get detail (note + all children) ─────────────────────────────────────────

export async function getMeetingNoteDetail(
  id: number, userId: number, isAdmin: boolean,
) {
  const note = await lookupNote(id, userId, isAdmin);
  if (!note) return null;

  const [chunks, actionItems, participants, links, suggestions] = await Promise.all([
    db.select()
      .from(meetingNoteTranscriptChunks)
      .where(eq(meetingNoteTranscriptChunks.meetingNoteId, id))
      .orderBy(meetingNoteTranscriptChunks.sequenceNo),
    db.select()
      .from(meetingNoteActionItems)
      .where(eq(meetingNoteActionItems.meetingNoteId, id))
      .orderBy(meetingNoteActionItems.id),
    db.select()
      .from(meetingNoteParticipants)
      .where(eq(meetingNoteParticipants.meetingNoteId, id))
      .orderBy(meetingNoteParticipants.id),
    db.select()
      .from(meetingNoteLinks)
      .where(eq(meetingNoteLinks.meetingNoteId, id))
      .orderBy(meetingNoteLinks.id),
    computeParticipantSuggestions(id).catch(() => []),
  ]);

  return { ...note, chunks, actionItems, participants, links, suggestions };
}

// ── Update ────────────────────────────────────────────────────────────────────

export async function updateMeetingNote(
  id: number, userId: number, isAdmin: boolean,
  data: z.infer<typeof updateMeetingNoteSchema>,
): Promise<MeetingNote | null> {
  const note = await lookupNote(id, userId, isAdmin);
  if (!note) return null;

  const [updated] = await db
    .update(meetingNotes)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(meetingNotes.id, id))
    .returning();
  return updated;
}

// ── Status transitions ────────────────────────────────────────────────────────

export async function startRecording(
  id: number, userId: number, isAdmin: boolean,
): Promise<{ ok: boolean; error?: string; note?: MeetingNote }> {
  const note = await lookupNote(id, userId, isAdmin);
  if (!note) return { ok: false, error: "Not found" };

  if (!note.consentNoted) {
    return { ok: false, error: "Consent must be confirmed before recording can start" };
  }

  const allowed = STATUS_TRANSITIONS[note.status] ?? [];
  if (!allowed.includes("recording")) {
    return { ok: false, error: `Cannot start recording from status '${note.status}'` };
  }

  const now = new Date();
  const [updated] = await db
    .update(meetingNotes)
    .set({ status: "recording", startedAt: now, updatedAt: now })
    .where(eq(meetingNotes.id, id))
    .returning();
  return { ok: true, note: updated };
}

export async function stopRecording(
  id: number, userId: number, isAdmin: boolean,
): Promise<{ ok: boolean; error?: string; note?: MeetingNote }> {
  const note = await lookupNote(id, userId, isAdmin);
  if (!note) return { ok: false, error: "Not found" };

  const allowed = STATUS_TRANSITIONS[note.status] ?? [];
  if (!allowed.includes("processing")) {
    return { ok: false, error: `Cannot stop recording from status '${note.status}'` };
  }

  const now = new Date();
  const durationSeconds = note.startedAt
    ? Math.round((now.getTime() - note.startedAt.getTime()) / 1000)
    : null;

  const [updated] = await db
    .update(meetingNotes)
    .set({ status: "processing", endedAt: now, durationSeconds, updatedAt: now })
    .where(eq(meetingNotes.id, id))
    .returning();
  return { ok: true, note: updated };
}

export async function processMeetingNote(
  id: number, userId: number, isAdmin: boolean,
): Promise<{ ok: boolean; error?: string; note?: MeetingNote }> {
  const note = await lookupNote(id, userId, isAdmin);
  if (!note) return { ok: false, error: "Not found" };

  // Reject if already in-flight — BUT allow retry if stuck with an error
  // (markError sets status="failed" going forward; this guard handles legacy
  //  notes that got stuck in "processing" before that fix was deployed)
  if (note.status === "processing" && !note.processingError) {
    return { ok: false, error: "Analysis is already in progress for this note" };
  }

  const allowedStatuses = ["completed", "failed", "processing"];
  if (!allowedStatuses.includes(note.status)) {
    return {
      ok: false,
      error: `Note must be in 'completed' or 'failed' status to retry analysis (current: '${note.status}')`,
    };
  }

  // Atomically claim the note by setting status="processing" in the DB right
  // now — before we return. This eliminates the race window where two concurrent
  // POST /process requests both pass the guard above but both see the old status
  // because the actual DB write was deferred to the setImmediate callback.
  const now = new Date();
  const [updated] = await db
    .update(meetingNotes)
    .set({ status: "processing", updatedAt: now })
    .where(eq(meetingNotes.id, id))
    .returning();

  console.log(`[process-service] noteId=${id} claimed for processing (prev status: ${note.status})`);
  return { ok: true, note: updated };
}

// ── Update action item status ─────────────────────────────────────────────────

export async function updateActionItemStatus(
  noteId: number, itemId: number,
  status: typeof VALID_ACTION_ITEM_STATUSES[number],
  userId: number, isAdmin: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const note = await lookupNote(noteId, userId, isAdmin);
  if (!note) return { ok: false, error: "Not found" };

  const [existing] = await db
    .select()
    .from(meetingNoteActionItems)
    .where(
      and(
        eq(meetingNoteActionItems.id, itemId),
        eq(meetingNoteActionItems.meetingNoteId, noteId),
      ),
    )
    .limit(1);

  if (!existing) return { ok: false, error: "Action item not found" };

  await db
    .update(meetingNoteActionItems)
    .set({ status })
    .where(eq(meetingNoteActionItems.id, itemId));

  return { ok: true };
}

// ── Task creation from accepted action items ───────────────────────────────────

export async function createTasksFromActionItems(
  id: number, userId: number, isAdmin: boolean,
  opts: z.infer<typeof createTasksSchema>,
): Promise<{ created: number; skipped: number }> {
  const note = await lookupNote(id, userId, isAdmin);
  if (!note) throw Object.assign(new Error("Not found"), { httpStatus: 404 });

  // Pull only items that are accepted AND have no task yet (DB-level guard against duplicates)
  const [eligible, alreadyDone] = await Promise.all([
    db
      .select()
      .from(meetingNoteActionItems)
      .where(
        and(
          eq(meetingNoteActionItems.meetingNoteId, id),
          eq(meetingNoteActionItems.status, "accepted"),
          isNull(meetingNoteActionItems.createdTaskId),
        ),
      ),
    db
      .select({ id: meetingNoteActionItems.id })
      .from(meetingNoteActionItems)
      .where(
        and(
          eq(meetingNoteActionItems.meetingNoteId, id),
          eq(meetingNoteActionItems.status, "task_created"),
        ),
      ),
  ]);

  const skipped = alreadyDone.length;
  let created   = 0;

  const targetObjectType = opts.linkedObjectType ?? note.linkedObjectType ?? null;
  const targetObjectId   = opts.linkedObjectId   ?? note.linkedObjectId   ?? null;

  for (const item of eligible) {
    const [newTask] = await db
      .insert(tasks)
      .values({
        title:            item.title,
        description:      item.description   ?? null,
        ownerUserId:      opts.ownerUserId   ?? item.ownerUserId ?? userId,
        createdByUserId:  userId,
        linkedObjectType: targetObjectType,
        linkedObjectId:   targetObjectId,
        dueDate:          item.dueDate       ?? null,
        status:           "pending",
        priority:         "medium",
        aiSuggested:      true,
        source:           "meeting_note",
        sourceLabel:      note.title         ?? "Meeting Note",
      })
      .returning({ id: tasks.id });

    await db
      .update(meetingNoteActionItems)
      .set({ status: "task_created", createdTaskId: newTask.id })
      .where(eq(meetingNoteActionItems.id, item.id));

    created++;
  }

  console.log(`[meeting-notes] create-tasks note=${id} created=${created} skipped=${skipped}`);
  return { created, skipped };
}

// ── Add note to CRM timeline ──────────────────────────────────────────────────

export async function addNoteToTimeline(
  id: number, userId: number, isAdmin: boolean,
): Promise<{ ok: boolean; error?: string; activityId?: number; skipped?: boolean }> {
  const note = await lookupNote(id, userId, isAdmin);
  if (!note) return { ok: false, error: "Not found" };

  const objectType = note.linkedObjectType;
  const objectId   = note.linkedObjectId;

  if (!objectType || !objectId) {
    return {
      ok: false,
      error: "Note must have a linked CRM object (linked_object_type + linked_object_id) before adding to timeline",
    };
  }

  const summary =
    note.summaryText ??
    note.notesText   ??
    note.title       ??
    `Meeting note — ${note.createdAt.toISOString().slice(0, 10)}`;

  // ── Duplicate guard ──────────────────────────────────────────────────────
  // activities has no meeting_note_id column, so use content-match fallback:
  // same type + same linked object + same summary text → treat as duplicate.
  const [existingActivity] = await db
    .select({ id: activities.id })
    .from(activities)
    .where(
      and(
        eq(activities.type, "meeting_note"),
        eq(activities.linkedObjectType, objectType),
        eq(activities.linkedObjectId, objectId),
        eq(activities.summary, summary),
      ),
    )
    .limit(1);

  if (existingActivity) {
    console.log(`[meeting-notes] add-to-timeline note=${id} skipped (duplicate activityId=${existingActivity.id})`);
    return { ok: true, skipped: true, activityId: existingActivity.id };
  }
  // ─────────────────────────────────────────────────────────────────────────

  const [activity] = await db
    .insert(activities)
    .values({
      linkedObjectType: objectType,
      linkedObjectId:   objectId,
      type:             "meeting_note",
      subject:          note.title ?? "Meeting Note",
      summary,
      createdBy:        userId,
    })
    .returning({ id: activities.id });

  console.log(`[meeting-notes] add-to-timeline note=${id} inserted activityId=${activity.id}`);
  return { ok: true, activityId: activity.id };
}

// ── Follow-up draft ───────────────────────────────────────────────────────────

export async function draftFollowup(
  id: number, userId: number, isAdmin: boolean,
  text: string,
): Promise<MeetingNote | null> {
  const note = await lookupNote(id, userId, isAdmin);
  if (!note) return null;

  const [updated] = await db
    .update(meetingNotes)
    .set({ followupDraftText: text, updatedAt: new Date() })
    .where(eq(meetingNotes.id, id))
    .returning();
  return updated;
}

// ── CRM link ──────────────────────────────────────────────────────────────────

export async function linkRecord(
  id: number, userId: number, isAdmin: boolean,
  objectType: string, objectId: number, relationshipType?: string,
): Promise<{ ok: boolean; error?: string; linkId?: number }> {
  const note = await lookupNote(id, userId, isAdmin);
  if (!note) return { ok: false, error: "Not found" };

  if (!VALID_OBJECT_TYPES.includes(objectType as any)) {
    return { ok: false, error: `Invalid object_type '${objectType}'` };
  }

  // Idempotent — update relationship_type if link already exists
  const [existing] = await db
    .select()
    .from(meetingNoteLinks)
    .where(
      and(
        eq(meetingNoteLinks.meetingNoteId, id),
        eq(meetingNoteLinks.objectType, objectType),
        eq(meetingNoteLinks.objectId, objectId),
      ),
    )
    .limit(1);

  if (existing) {
    if (relationshipType && existing.relationshipType !== relationshipType) {
      await db
        .update(meetingNoteLinks)
        .set({ relationshipType })
        .where(eq(meetingNoteLinks.id, existing.id));
    }
    return { ok: true, linkId: existing.id };
  }

  const [link] = await db
    .insert(meetingNoteLinks)
    .values({
      meetingNoteId:    id,
      objectType,
      objectId,
      relationshipType: relationshipType ?? null,
    })
    .returning({ id: meetingNoteLinks.id });

  return { ok: true, linkId: link.id };
}

// ── Delete ────────────────────────────────────────────────────────────────────

// ── Cancel / discard a stuck or unwanted recording ────────────────────────────
// Allowed from any non-terminal status (useful for stuck "recording" notes
// where the browser session was lost and no audio data was saved).
export async function cancelMeetingNote(
  id: number, userId: number, isAdmin: boolean,
): Promise<{ ok: boolean; error?: string; note?: MeetingNote }> {
  const note = await lookupNote(id, userId, isAdmin);
  if (!note) return { ok: false, error: "Not found" };

  const allowed = STATUS_TRANSITIONS[note.status] ?? [];
  if (!allowed.includes("cancelled")) {
    return { ok: false, error: `Cannot cancel from status '${note.status}'` };
  }

  const now = new Date();
  const [updated] = await db
    .update(meetingNotes)
    .set({ status: "cancelled", updatedAt: now })
    .where(eq(meetingNotes.id, id))
    .returning();
  return { ok: true, note: updated };
}

export async function deleteMeetingNote(
  id: number, userId: number, isAdmin: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const [note] = await db.select().from(meetingNotes).where(eq(meetingNotes.id, id)).limit(1);
  if (!note) return { ok: false, error: "Not found" };
  if (!canAccess(note, userId, isAdmin)) return { ok: false, error: "Forbidden" };

  // Cascade-delete child rows then the note itself
  await db.delete(meetingNoteLinks).where(eq(meetingNoteLinks.meetingNoteId, id));
  await db.delete(meetingNoteParticipants).where(eq(meetingNoteParticipants.meetingNoteId, id));
  await db.delete(meetingNoteActionItems).where(eq(meetingNoteActionItems.meetingNoteId, id));
  await db.delete(meetingNoteTranscriptChunks).where(eq(meetingNoteTranscriptChunks.meetingNoteId, id));
  await db.delete(meetingNotes).where(eq(meetingNotes.id, id));

  return { ok: true };
}

// ── Calendar event integration ────────────────────────────────────────────────

export async function getMeetingNoteByCalendarEvent(
  calendarEventId: number, userId: number, isAdmin: boolean,
): Promise<MeetingNote | null> {
  const [note] = await db
    .select()
    .from(meetingNotes)
    .where(eq(meetingNotes.calendarEventId, calendarEventId))
    .orderBy(desc(meetingNotes.createdAt))
    .limit(1);
  if (!note) return null;
  if (!canAccess(note, userId, isAdmin)) return null;
  return note;
}

export async function createMeetingNoteForCalendarEvent(
  calendarEventId: number, userId: number,
  data: Partial<z.infer<typeof createMeetingNoteSchema>>,
): Promise<MeetingNote> {
  // Idempotent: if a note already exists for this calendar event + user, return it
  const existing = await getMeetingNoteByCalendarEvent(calendarEventId, userId, false);
  if (existing) return existing;

  // Fetch full calendar event to auto-populate title and platform
  const [calEvent] = await db
    .select({
      title:            calendarEvents.title,
      meetingUrl:       calendarEvents.meetingUrl,
      location:         calendarEvents.location,
      description:      calendarEvents.description,
      invitees:         calendarEvents.invitees,
      linkedObjectType: calendarEvents.linkedObjectType,
      linkedObjectId:   calendarEvents.linkedObjectId,
    })
    .from(calendarEvents)
    .where(eq(calendarEvents.id, calendarEventId))
    .limit(1);

  // Detect platform from event data when not explicitly provided
  let resolvedPlatform = data.platform;
  if (!resolvedPlatform && calEvent) {
    const detected = detectMeetingProvider(calEvent.meetingUrl, calEvent.location, calEvent.description);
    resolvedPlatform = detected.platform ?? undefined;
  }

  // Use event title as default note title
  const resolvedTitle = data.title ?? calEvent?.title ?? undefined;

  // Inherit CRM link from calendar event if not explicitly provided
  const resolvedLinkedObjectType = data.linkedObjectType
    ?? (calEvent?.linkedObjectType as typeof VALID_OBJECT_TYPES[number] | undefined)
    ?? undefined;
  const resolvedLinkedObjectId = data.linkedObjectId
    ?? (calEvent?.linkedObjectId ?? undefined)
    ?? undefined;

  const note = await createMeetingNote(userId, {
    source:           data.source           ?? "calendar",
    title:            resolvedTitle,
    platform:         resolvedPlatform,
    calendarEventId,
    linkedObjectType: resolvedLinkedObjectType,
    linkedObjectId:   resolvedLinkedObjectId,
    consentNoted:     data.consentNoted,
  });

  // Seed participants from calendar event invitees (fire-and-forget, non-blocking)
  setImmediate(async () => {
    try {
      const invitees: string[] = ((calEvent?.invitees ?? []) as string[]).filter(Boolean);
      if (invitees.length === 0) return;
      const ownerEmail = await getUserEmail(userId);
      await populateParticipantsFromEmails(note.id, invitees, ownerEmail);
    } catch (err) {
      console.error(`[participant-matcher] seed error for note ${note.id}:`, err);
    }
  });

  return note;
}
