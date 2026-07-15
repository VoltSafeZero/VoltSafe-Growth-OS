-- Migration 0033: Global @mention system across all CMS modules
-- Stores normalized mention records from every surface (CURRENTS, Tasks, Activities, etc.)

CREATE TABLE IF NOT EXISTS global_mentions (
  id                 SERIAL PRIMARY KEY,
  mentioned_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type        TEXT NOT NULL,
  entity_id          INTEGER NOT NULL,
  module_key         TEXT NOT NULL,
  module_label       TEXT NOT NULL DEFAULT '',
  record_title       TEXT,
  source_preview     TEXT,
  requested_action   TEXT NOT NULL DEFAULT 'mention',
  status             TEXT NOT NULL DEFAULT 'unread'
                     CHECK (status IN ('unread','viewed','acknowledged','completed','dismissed')),
  viewed_at          TIMESTAMPTZ,
  acknowledged_at    TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  dismissed_at       TIMESTAMPTZ,
  completion_note    TEXT,
  deep_link_url      TEXT,
  is_all_mention     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_global_mentions_user
  ON global_mentions(mentioned_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_global_mentions_entity
  ON global_mentions(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_global_mentions_author
  ON global_mentions(author_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_global_mentions_unread
  ON global_mentions(mentioned_user_id, status)
  WHERE status = 'unread';
