-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 0002_meeting_notes  (DOWN / rollback)
-- Module:    Cortex Meeting Notes — Phase B.1
--
-- Drops the 5 meeting note tables in reverse dependency order.
-- ON DELETE CASCADE from child tables means DROP TABLE on meeting_notes
-- would cascade automatically, but we drop children first for clarity.
--
-- Safe to run even if the migration was never fully applied (IF EXISTS).
-- Does NOT touch any table from 0001 or earlier.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DROP TABLE IF EXISTS meeting_note_links;
DROP TABLE IF EXISTS meeting_note_participants;
DROP TABLE IF EXISTS meeting_note_action_items;
DROP TABLE IF EXISTS meeting_note_transcript_chunks;
DROP TABLE IF EXISTS meeting_notes;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- End of migration 0002_meeting_notes (DOWN)
-- ─────────────────────────────────────────────────────────────────────────────
