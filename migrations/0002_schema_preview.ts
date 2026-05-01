/**
 * Phase B.1 — shared/schema.ts additions preview
 *
 * THIS FILE IS FOR REVIEW ONLY.
 * Do NOT import this file anywhere.
 * The actual additions will be appended to shared/schema.ts only after approval.
 *
 * These definitions follow the exact pattern used by Phase A.1 additions
 * (zoomConnections, bookingLinks, bookingLinkRecipients).
 *
 * UUID strategy:
 *   The `uuid` column has NO .default() in Drizzle because pgcrypto is not
 *   installed. Every INSERT must supply a UUID from the application layer:
 *     import crypto from "crypto";
 *     uuid: crypto.randomUUID()
 */

import { pgTable, serial, integer, text, boolean, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// meeting_notes
// ─────────────────────────────────────────────────────────────────────────────

export const meetingNotes = pgTable("meeting_notes", {
  id: serial("id").primaryKey(),

  // App-generated — caller must supply crypto.randomUUID() on every insert.
  // No .default() because pgcrypto / uuid-ossp are not installed.
  uuid: text("uuid").notNull().unique(),

  title: text("title"),
  status: text("status").notNull().default("scheduled_prompted"),
  source: text("source").notNull(),

  // Hard FK to users (owner). Uses NO ACTION so audit row survives user deletion.
  createdBy: integer("created_by").notNull(),

  // Soft references (no FK constraint — matches existing schema pattern)
  calendarEventId: integer("calendar_event_id"),
  emailThreadId: text("email_thread_id"),   // gmail_thread_id TEXT, not email_messages.id
  emailMessageId: integer("email_message_id"),

  // Polymorphic CRM link (same pattern as tasks.linked_object_*)
  linkedObjectType: text("linked_object_type"),
  linkedObjectId: integer("linked_object_id"),

  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  durationSeconds: integer("duration_seconds"),

  platform: text("platform"),           // zoom | teams | meet | phone | in_person | other
  audioStorageKey: text("audio_storage_key"),

  rawTranscriptText: text("raw_transcript_text"),
  cleanTranscriptText: text("clean_transcript_text"),

  summaryText: text("summary_text"),
  notesText: text("notes_text"),
  decisionsText: text("decisions_text"),
  actionItemsText: text("action_items_text"),
  followupDraftText: text("followup_draft_text"),
  processingError: text("processing_error"),

  consentNoted: boolean("consent_noted").notNull().default(false),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertMeetingNoteSchema = createInsertSchema(meetingNotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertMeetingNote = z.infer<typeof insertMeetingNoteSchema>;
export type MeetingNote = typeof meetingNotes.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// meeting_note_transcript_chunks
// ─────────────────────────────────────────────────────────────────────────────

export const meetingNoteTranscriptChunks = pgTable("meeting_note_transcript_chunks", {
  id: serial("id").primaryKey(),
  meetingNoteId: integer("meeting_note_id").notNull(),  // → meeting_notes(id) CASCADE
  sequenceNo: integer("sequence_no").notNull(),
  speakerLabel: text("speaker_label"),
  startMs: integer("start_ms"),
  endMs: integer("end_ms"),
  text: text("text").notNull(),
  isFinal: boolean("is_final").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Note: UNIQUE(meeting_note_id, sequence_no) is defined in the SQL migration.
// Drizzle does not expose composite unique constraints in pgTable directly
// at the column level — the constraint is enforced by the DB via migration.

export const insertMeetingNoteTranscriptChunkSchema = createInsertSchema(meetingNoteTranscriptChunks).omit({
  id: true,
  createdAt: true,
});
export type InsertMeetingNoteTranscriptChunk = z.infer<typeof insertMeetingNoteTranscriptChunkSchema>;
export type MeetingNoteTranscriptChunk = typeof meetingNoteTranscriptChunks.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// meeting_note_action_items
// ─────────────────────────────────────────────────────────────────────────────

export const meetingNoteActionItems = pgTable("meeting_note_action_items", {
  id: serial("id").primaryKey(),
  meetingNoteId: integer("meeting_note_id").notNull(),  // → meeting_notes(id) CASCADE
  title: text("title").notNull(),
  description: text("description"),
  ownerName: text("owner_name"),
  ownerUserId: integer("owner_user_id"),   // soft ref → users.id
  dueDate: timestamp("due_date"),
  sourceQuote: text("source_quote"),
  confidenceScore: numeric("confidence_score", { precision: 4, scale: 3 }),
  // Allowed values: suggested | accepted | rejected | task_created
  status: text("status").notNull().default("suggested"),
  createdTaskId: integer("created_task_id"),  // soft ref → tasks.id
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMeetingNoteActionItemSchema = createInsertSchema(meetingNoteActionItems).omit({
  id: true,
  createdAt: true,
});
export type InsertMeetingNoteActionItem = z.infer<typeof insertMeetingNoteActionItemSchema>;
export type MeetingNoteActionItem = typeof meetingNoteActionItems.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// meeting_note_participants
// ─────────────────────────────────────────────────────────────────────────────

export const meetingNoteParticipants = pgTable("meeting_note_participants", {
  id: serial("id").primaryKey(),
  meetingNoteId: integer("meeting_note_id").notNull(),  // → meeting_notes(id) CASCADE
  name: text("name"),
  email: text("email"),
  userId: integer("user_id"),       // soft ref → users.id
  contactId: integer("contact_id"), // soft ref → contacts.id
  isInternal: boolean("is_internal").notNull().default(false),
  speakerLabel: text("speaker_label"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMeetingNoteParticipantSchema = createInsertSchema(meetingNoteParticipants).omit({
  id: true,
  createdAt: true,
});
export type InsertMeetingNoteParticipant = z.infer<typeof insertMeetingNoteParticipantSchema>;
export type MeetingNoteParticipant = typeof meetingNoteParticipants.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// meeting_note_links
// ─────────────────────────────────────────────────────────────────────────────

export const meetingNoteLinks = pgTable("meeting_note_links", {
  id: serial("id").primaryKey(),
  meetingNoteId: integer("meeting_note_id").notNull(),  // → meeting_notes(id) CASCADE
  // Allowed values: account | contact | lead | opportunity | project | ticket
  objectType: text("object_type").notNull(),
  objectId: integer("object_id").notNull(),
  relationshipType: text("relationship_type"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Note: UNIQUE(meeting_note_id, object_type, object_id) enforced by DB migration.

export const insertMeetingNoteLinkSchema = createInsertSchema(meetingNoteLinks).omit({
  id: true,
  createdAt: true,
});
export type InsertMeetingNoteLink = z.infer<typeof insertMeetingNoteLinkSchema>;
export type MeetingNoteLink = typeof meetingNoteLinks.$inferSelect;
