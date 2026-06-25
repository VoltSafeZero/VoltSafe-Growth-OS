-- Calendar enrichment: per-event calendar name, structured attendees, user calendar selection
-- Additive only — no existing columns are touched.

ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS calendar_name TEXT,
  ADD COLUMN IF NOT EXISTS attendee_details JSONB;

ALTER TABLE calendar_connections
  ADD COLUMN IF NOT EXISTS selected_calendar_ids JSONB;
