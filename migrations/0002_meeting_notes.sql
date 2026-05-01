-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 0002_meeting_notes  (UP)
-- Module:    Cortex Meeting Notes — Phase B.1
-- Author:    VoltSafe Growth OS
-- Applied:   NOT YET — pending review
--
-- Pre-flight verified:
--   • None of the 5 tables exist in public schema (0 rows returned)
--   • pgcrypto / uuid-ossp NOT installed → uuid column has NO default;
--     the application layer generates UUIDs via crypto.randomUUID()
--   • All referenced PKs confirmed INTEGER (int4) NOT NULL
--   • Hard FK (ON DELETE CASCADE) from child tables → meeting_notes only
--   • Soft references (no FK constraint) for calendar_event_id,
--     email_message_id, owner_user_id, contact_id, created_task_id
--     following the existing linked_object_type/linked_object_id pattern
--     used throughout the schema (tasks, activities, etc.)
--
-- Rollback: migrations/0002_meeting_notes.down.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. meeting_notes ─────────────────────────────────────────────────────────
--
-- One row per meeting note session.
-- status machine: scheduled_prompted → recording → processing → completed
--                                                              → failed
--                 any state → cancelled
--
CREATE TABLE meeting_notes (
  id                    SERIAL        PRIMARY KEY,

  -- App-generated UUID (crypto.randomUUID() in Node.js).
  -- No DB DEFAULT because pgcrypto/uuid-ossp are not installed.
  uuid                  TEXT          NOT NULL,

  title                 TEXT,
  status                TEXT          NOT NULL DEFAULT 'scheduled_prompted',
  source                TEXT          NOT NULL,

  -- Hard FK to users (owner). NO ACTION on delete keeps the audit row intact
  -- if a user is ever deactivated/deleted.
  created_by            INTEGER       NOT NULL
                          REFERENCES users(id) ON DELETE NO ACTION,

  -- Soft references — no FK constraint; matched by app at query time
  calendar_event_id     INTEGER,      -- → calendar_events.id
  email_thread_id       TEXT,         -- → email_messages.gmail_thread_id (TEXT)
  email_message_id      INTEGER,      -- → email_messages.id

  -- Generic polymorphic CRM link (same pattern as tasks.linked_object_*)
  linked_object_type    TEXT,         -- account | contact | lead | opportunity | project | ticket
  linked_object_id      INTEGER,

  started_at            TIMESTAMP WITHOUT TIME ZONE,
  ended_at              TIMESTAMP WITHOUT TIME ZONE,
  duration_seconds      INTEGER,

  -- Meeting platform
  platform              TEXT,         -- zoom | teams | meet | phone | in_person | other

  -- Audio storage — key/path only, content stored outside the DB.
  -- Format: opaque string (file path, object-storage key, or base64 in B.4).
  audio_storage_key     TEXT,

  -- Transcript fields
  raw_transcript_text   TEXT,
  clean_transcript_text TEXT,

  -- AI-generated outputs
  summary_text          TEXT,
  notes_text            TEXT,
  decisions_text        TEXT,
  action_items_text     TEXT,         -- raw AI JSON before extraction into child table
  followup_draft_text   TEXT,

  -- Error capture for failed processing runs
  processing_error      TEXT,

  -- Must be TRUE before recording can start (enforced in route)
  consent_noted         BOOLEAN       NOT NULL DEFAULT FALSE,

  created_at            TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE meeting_notes
  ADD CONSTRAINT meeting_notes_uuid_unique UNIQUE (uuid);

-- Lookup by owner (most common list query)
CREATE INDEX idx_meeting_notes_created_by
  ON meeting_notes (created_by);

-- Lookup by calendar event (CalendarMeetingNotePrompt)
CREATE INDEX idx_meeting_notes_calendar_event_id
  ON meeting_notes (calendar_event_id);

-- Status filtering (recording dashboard, processing queue)
CREATE INDEX idx_meeting_notes_status
  ON meeting_notes (status);

-- Default sort for list pages
CREATE INDEX idx_meeting_notes_created_at
  ON meeting_notes (created_at DESC);


-- ── 2. meeting_note_transcript_chunks ────────────────────────────────────────
--
-- One row per transcription chunk. Used for real-time streaming display
-- and word-level timestamp alignment. Chunks are ordered by sequence_no.
--
CREATE TABLE meeting_note_transcript_chunks (
  id              SERIAL  PRIMARY KEY,

  meeting_note_id INTEGER NOT NULL
                    REFERENCES meeting_notes(id) ON DELETE CASCADE,

  sequence_no     INTEGER NOT NULL,
  speaker_label   TEXT,
  start_ms        INTEGER,
  end_ms          INTEGER,
  text            TEXT    NOT NULL,
  is_final        BOOLEAN NOT NULL DEFAULT FALSE,

  created_at      TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

-- Single-column index for fast lookup of all chunks belonging to a note
CREATE INDEX idx_meeting_note_transcript_chunks_note_id
  ON meeting_note_transcript_chunks (meeting_note_id);

-- Unique composite index — enforces ordering uniqueness AND serves as the
-- primary access pattern (WHERE meeting_note_id = ? ORDER BY sequence_no).
-- Using CREATE UNIQUE INDEX rather than ALTER TABLE ADD CONSTRAINT so the
-- index carries an explicit, query-visible name.
CREATE UNIQUE INDEX idx_meeting_note_transcript_chunks_note_seq
  ON meeting_note_transcript_chunks (meeting_note_id, sequence_no);


-- ── 3. meeting_note_action_items ─────────────────────────────────────────────
--
-- Extracted action items from AI processing.
-- Lifecycle: suggested → accepted | rejected
--            accepted  → task_created (after promote-to-task)
--
CREATE TABLE meeting_note_action_items (
  id               SERIAL          PRIMARY KEY,

  meeting_note_id  INTEGER         NOT NULL
                     REFERENCES meeting_notes(id) ON DELETE CASCADE,

  title            TEXT            NOT NULL,
  description      TEXT,
  owner_name       TEXT,

  -- Soft ref → users.id (may be null if owner not identified or external)
  owner_user_id    INTEGER,

  due_date         TIMESTAMP WITHOUT TIME ZONE,

  -- The verbatim snippet that led to this extraction (for UI display/audit)
  source_quote     TEXT,

  -- AI confidence: 0.000–1.000 (stored as numeric to avoid float rounding)
  confidence_score NUMERIC(4, 3),

  -- Promotion lifecycle. Allowed values: suggested, accepted, rejected, task_created
  status           TEXT            NOT NULL DEFAULT 'suggested',

  -- Soft ref → tasks.id (set after task creation, NULL until then)
  created_task_id  INTEGER,

  created_at       TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

-- Primary lookup: all action items for a note
CREATE INDEX idx_meeting_note_action_items_note_id
  ON meeting_note_action_items (meeting_note_id);

-- Promotion queue: find all accepted items ready for task creation
CREATE INDEX idx_meeting_note_action_items_status
  ON meeting_note_action_items (status);

-- Reverse lookup: given a task, find its source action item
CREATE INDEX idx_meeting_note_action_items_task_id
  ON meeting_note_action_items (created_task_id);


-- ── 4. meeting_note_participants ─────────────────────────────────────────────
--
-- People present in the meeting (internal and external).
-- Used for CRM link suggestions and speaker diarization labels.
--
CREATE TABLE meeting_note_participants (
  id              SERIAL   PRIMARY KEY,

  meeting_note_id INTEGER  NOT NULL
                    REFERENCES meeting_notes(id) ON DELETE CASCADE,

  name            TEXT,
  email           TEXT,

  -- Soft refs — no FK constraint (participants may be external, not in DB)
  user_id         INTEGER,    -- → users.id if participant is an internal user
  contact_id      INTEGER,    -- → contacts.id if matched to a CRM contact

  is_internal     BOOLEAN  NOT NULL DEFAULT FALSE,

  -- Speaker label from diarization (e.g. "SPEAKER_00", "SPEAKER_01")
  speaker_label   TEXT,

  created_at      TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

-- Primary lookup
CREATE INDEX idx_meeting_note_participants_note_id
  ON meeting_note_participants (meeting_note_id);

-- Email-based CRM match lookups
CREATE INDEX idx_meeting_note_participants_email
  ON meeting_note_participants (email);

-- Reverse lookup: contacts linked to notes
CREATE INDEX idx_meeting_note_participants_contact_id
  ON meeting_note_participants (contact_id);


-- ── 5. meeting_note_links ────────────────────────────────────────────────────
--
-- Explicit CRM object associations (user-confirmed or AI-suggested).
-- Uses the same polymorphic pattern as tasks.linked_object_type.
-- UNIQUE constraint prevents duplicate links.
--
CREATE TABLE meeting_note_links (
  id               SERIAL  PRIMARY KEY,

  meeting_note_id  INTEGER NOT NULL
                     REFERENCES meeting_notes(id) ON DELETE CASCADE,

  -- Allowed values (enforced in application layer):
  -- account | contact | lead | opportunity | project | ticket
  object_type      TEXT    NOT NULL,
  object_id        INTEGER NOT NULL,

  -- Optional label describing how this record relates (e.g. "primary_account")
  relationship_type TEXT,

  created_at       TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

-- Prevents duplicate CRM links; composite unique on all three discriminators
ALTER TABLE meeting_note_links
  ADD CONSTRAINT meeting_note_links_note_object_unique
    UNIQUE (meeting_note_id, object_type, object_id);

-- Single-column index: fast lookup of all links for a given note
-- (the composite unique above starts with meeting_note_id and covers this,
-- but an explicit index keeps query plans predictable on single-column filters)
CREATE INDEX idx_meeting_note_links_note_id
  ON meeting_note_links (meeting_note_id);

-- Reverse lookup index: given an object, find all notes that reference it
-- (the composite unique starts with meeting_note_id and cannot serve this)
CREATE INDEX idx_meeting_note_links_object
  ON meeting_note_links (object_type, object_id);

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- End of migration 0002_meeting_notes (UP)
-- DO NOT apply without explicit approval.
-- ─────────────────────────────────────────────────────────────────────────────
