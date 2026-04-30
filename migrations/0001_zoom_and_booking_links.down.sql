-- ============================================================================
-- Rollback for Migration 0001: Zoom OAuth + Booking Links — Phase A.1
-- ============================================================================
-- WHEN TO RUN: only if Phase A.1 verification fails OR if the user explicitly
--              wants to revert.
--
-- DESTRUCTIVE: drops all data in the three new tables. The added column on
--              calendar_events is also dropped; any traceback data stored
--              there is lost. EXISTING calendar_events ROWS THEMSELVES ARE
--              UNTOUCHED — only the new column goes away.
--
-- Safe to re-run: yes (uses IF EXISTS).
-- ============================================================================

BEGIN;

-- 1. Drop the column on calendar_events FIRST.
--    (Required: it has a FK to booking_link_recipients, and dropping
--     booking_link_recipients while a column still references it would fail.)
DROP INDEX IF EXISTS idx_calendar_events_booking_link_recipient_id;
ALTER TABLE calendar_events
  DROP COLUMN IF EXISTS booking_link_recipient_id;

-- 2. Drop child table before parent.
DROP TABLE IF EXISTS booking_link_recipients;

-- 3. Drop parent table.
DROP TABLE IF EXISTS booking_links;

-- 4. Drop the standalone zoom_connections table.
DROP TABLE IF EXISTS zoom_connections;

COMMIT;

-- ============================================================================
-- Post-rollback verification:
--
-- SELECT count(*) FROM information_schema.tables
--   WHERE table_schema='public'
--     AND table_name IN ('zoom_connections','booking_links','booking_link_recipients');
-- -- expect 0
--
-- SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='calendar_events'
--     AND column_name='booking_link_recipient_id';
-- -- expect 0 rows
-- ============================================================================
