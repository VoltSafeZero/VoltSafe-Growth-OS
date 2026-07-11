-- Migration 0031: Full-text and trigram search indexes for email_messages
-- Moves the GIN indexes previously created at runtime (in server/services/email-search.ts)
-- into a proper tracked migration so they are created exactly once, survive restarts,
-- and are visible in the migration history.
--
-- All indexes use IF NOT EXISTS so running this migration twice is a no-op.

-- Trigram index: cc_emails — fast LIKE '%term%' lookups on CC recipients.
-- Requires the pg_trgm extension (available in standard Postgres installs).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_email_cc_emails_trgm
  ON email_messages USING GIN (cc_emails gin_trgm_ops);

-- Trigram index: all_participants — fast LIKE '%term%' lookups across all
-- participant addresses in a message.
CREATE INDEX IF NOT EXISTS idx_email_all_participants_trgm
  ON email_messages USING GIN (all_participants gin_trgm_ops);

-- Full-text GIN index v3: includes cc_emails alongside all previously indexed
-- fields so CC-only recipients are reachable by tsquery.
-- Replaces idx_email_fts_v2 (subject + from_email + all_participants + body_text).
CREATE INDEX IF NOT EXISTS idx_email_fts_v3
  ON email_messages USING GIN (
    to_tsvector('english',
      coalesce(subject, '')          || ' ' ||
      coalesce(from_email, '')       || ' ' ||
      coalesce(all_participants, '') || ' ' ||
      coalesce(cc_emails, '')        || ' ' ||
      coalesce(body_text, '')
    )
  );
