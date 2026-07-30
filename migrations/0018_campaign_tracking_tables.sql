-- Migration 0018: campaign_recipients + campaign_events
-- Required by server/services/account-heat-score.ts (heat-score dimensions 2).
-- The heat-score service uses Drizzle typed queries against these tables;
-- validateHeatScoreSchema() at startup will fail gracefully if they are absent.

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id               SERIAL PRIMARY KEY,
  campaign_draft_id INTEGER NOT NULL REFERENCES campaign_drafts(id) ON DELETE CASCADE,
  contact_id       INTEGER,
  account_id       INTEGER,
  email            TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',  -- pending | sent | bounced | unsubscribed
  sent_at          TIMESTAMP,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_account_id
  ON campaign_recipients(account_id);

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign_draft_id
  ON campaign_recipients(campaign_draft_id);

CREATE TABLE IF NOT EXISTS campaign_events (
  id                SERIAL PRIMARY KEY,
  campaign_draft_id INTEGER NOT NULL REFERENCES campaign_drafts(id) ON DELETE CASCADE,
  recipient_id      INTEGER NOT NULL REFERENCES campaign_recipients(id) ON DELETE CASCADE,
  contact_id        INTEGER,
  account_id        INTEGER,
  event_type        TEXT NOT NULL,   -- open | click | reply | unsubscribe | bounce
  url               TEXT,
  ip_hash           TEXT,
  is_bot            BOOLEAN NOT NULL DEFAULT FALSE,
  occurred_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_events_recipient_id
  ON campaign_events(recipient_id);

CREATE INDEX IF NOT EXISTS idx_campaign_events_account_id
  ON campaign_events(account_id);
