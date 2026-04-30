-- ============================================================================
-- Migration 0001: Zoom OAuth + Booking Links — Phase A.1
-- ============================================================================
-- Authorized: 2026-04-30 by user (Trevor) for VoltSafe Growth OS
-- Scope: Zoom one-click + per-user recipient-only booking links
-- Reversible: yes — see 0001_zoom_and_booking_links.down.sql
-- Safe to re-run: yes (uses IF NOT EXISTS)
-- Touches existing data: NO (only ADD COLUMN to calendar_events; existing rows
--                        get NULL for the new column, behavior unchanged)
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. zoom_connections
--    One row per Cortex user who has connected their Zoom account.
--    Stores OAuth tokens and (denormalized) Zoom profile fields so the app
--    can create real Zoom meetings on the user's behalf without re-fetching
--    their profile every time.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS zoom_connections (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER NOT NULL UNIQUE,        -- soft FK -> users.id
  zoom_user_id        TEXT,                            -- Zoom's internal user id
  zoom_email          TEXT,
  zoom_account_type   TEXT,                            -- "Basic" | "Pro" | "Business"
  zoom_pmi            TEXT,                            -- Personal Meeting ID, e.g. "1234567890"
  zoom_pmi_url        TEXT,                            -- full URL to PMI room
  access_token        TEXT NOT NULL,
  refresh_token       TEXT NOT NULL,
  token_expires_at    TIMESTAMP NOT NULL,
  scope               TEXT,                            -- space-separated OAuth scopes granted
  connected_at        TIMESTAMP NOT NULL DEFAULT now(),
  disconnected_at     TIMESTAMP,                       -- nullable; set on disconnect
  created_at          TIMESTAMP NOT NULL DEFAULT now(),
  updated_at          TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zoom_connections_user_id
  ON zoom_connections(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. booking_links
--    Owner-defined link templates ("30-min intro", "1-hour deep dive", etc.).
--    `availability` is JSONB so the owner can edit working hours per day-of-week
--    in a single round-trip without joining a child table.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS booking_links (
  id                       SERIAL PRIMARY KEY,
  owner_user_id            INTEGER NOT NULL,           -- soft FK -> users.id
  name                     TEXT NOT NULL,
  description              TEXT,                       -- markdown shown to invitee
  slug                     TEXT NOT NULL UNIQUE,       -- URL slug, e.g. "intro-30"
  slot_minutes             INTEGER NOT NULL DEFAULT 30,
  buffer_minutes           INTEGER NOT NULL DEFAULT 0,
  advance_days             INTEGER NOT NULL DEFAULT 14,
  min_notice_hours         INTEGER NOT NULL DEFAULT 4,
  time_zone                TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  availability             JSONB NOT NULL DEFAULT '[]'::jsonb,
                                                       -- shape:
                                                       --   [{ "dow": 1, "start": "09:00", "end": "17:00" }, ...]
                                                       -- dow: 0=Sunday ... 6=Saturday
  location_type            TEXT NOT NULL DEFAULT 'zoom',
                                                       -- 'zoom' | 'phone' | 'in_person' | 'other'
  location_value           TEXT,                       -- meeting URL template, phone, or address
  require_recipient_match  BOOLEAN NOT NULL DEFAULT TRUE,
  active                   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMP NOT NULL DEFAULT now(),
  updated_at               TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_links_owner_user_id
  ON booking_links(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_booking_links_active
  ON booking_links(active) WHERE active = TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. booking_link_recipients
--    Per-recipient tokens. This is what makes "viewable only by recipient" work:
--    the URL embeds (slug, token); server only serves the booking page if the
--    token matches a row here, AND (when require_recipient_match is true) the
--    invitee re-confirms the email at booking time.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS booking_link_recipients (
  id                          SERIAL PRIMARY KEY,
  booking_link_id             INTEGER NOT NULL
                                REFERENCES booking_links(id) ON DELETE CASCADE,
  recipient_email             TEXT NOT NULL,
  token                       TEXT NOT NULL UNIQUE,    -- 32-byte URL-safe random
  sent_at                     TIMESTAMP,                -- when invite email was sent
  first_viewed_at             TIMESTAMP,                -- engagement signal
  view_count                  INTEGER NOT NULL DEFAULT 0,
  booked_calendar_event_id    INTEGER,                  -- soft FK -> calendar_events.id
  booked_at                   TIMESTAMP,
  revoked_at                  TIMESTAMP,                -- owner-initiated kill switch
  created_at                  TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT booking_link_recipients_link_email_unique
    UNIQUE (booking_link_id, recipient_email)
);

CREATE INDEX IF NOT EXISTS idx_booking_link_recipients_token
  ON booking_link_recipients(token);
CREATE INDEX IF NOT EXISTS idx_booking_link_recipients_link_id
  ON booking_link_recipients(booking_link_id);
CREATE INDEX IF NOT EXISTS idx_booking_link_recipients_email
  ON booking_link_recipients(recipient_email);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. calendar_events.booking_link_recipient_id  (ADDITIVE COLUMN)
--    Nullable trace-back so events created via a booking can be traced to the
--    link + recipient that produced them. Existing rows get NULL — no behavior
--    change for any code path that doesn't read this column.
--
--    ON DELETE SET NULL: if a recipient row is deleted, the calendar event
--    survives but loses its booking trace.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS booking_link_recipient_id INTEGER
    REFERENCES booking_link_recipients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_calendar_events_booking_link_recipient_id
  ON calendar_events(booking_link_recipient_id)
  WHERE booking_link_recipient_id IS NOT NULL;

COMMIT;

-- ============================================================================
-- Post-flight verification (run separately, NOT inside the transaction):
--
-- SELECT count(*) FROM information_schema.tables
--   WHERE table_schema='public'
--     AND table_name IN ('zoom_connections','booking_links','booking_link_recipients');
-- -- expect 3
--
-- SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='calendar_events'
--     AND column_name='booking_link_recipient_id';
-- -- expect 1 row
--
-- SELECT count(*) FROM calendar_events;
-- -- compare to count taken before migration; should be IDENTICAL
-- ============================================================================
