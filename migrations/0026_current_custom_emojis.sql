-- Custom emoji table for Currents module
CREATE TABLE IF NOT EXISTS current_custom_emojis (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  image_url     TEXT NOT NULL,
  uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add conversation_id to current_pins for DM message pinning
ALTER TABLE current_pins
  ADD COLUMN IF NOT EXISTS conversation_id INTEGER REFERENCES current_conversations(id) ON DELETE CASCADE;

-- Allow pinning DM messages (conversation-scoped pins have no channel_id/object_type)
DROP INDEX IF EXISTS current_pins_channel_message_unique;
CREATE UNIQUE INDEX IF NOT EXISTS current_pins_channel_message_unique
  ON current_pins (channel_id, message_id) WHERE channel_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS current_pins_conv_message_unique
  ON current_pins (conversation_id, message_id) WHERE conversation_id IS NOT NULL;
