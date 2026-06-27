-- Phase 15A: Private Channels / Channel Membership Foundation
-- is_private column already exists on current_channels (DEFAULT FALSE)
-- Only new artifact is the current_channel_members table

CREATE TABLE IF NOT EXISTS current_channel_members (
  id          SERIAL PRIMARY KEY,
  channel_id  INTEGER NOT NULL REFERENCES current_channels(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  INTEGER REFERENCES users(id),
  UNIQUE (channel_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ccm_channel_id ON current_channel_members(channel_id);
CREATE INDEX IF NOT EXISTS idx_ccm_user_id    ON current_channel_members(user_id);
