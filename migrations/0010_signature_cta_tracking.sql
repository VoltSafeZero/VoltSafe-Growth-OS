-- Signature CTA Tracking (2026-06)
-- Stores CTA button/image configs per signature, and per-send click-tracking tokens.

CREATE TABLE IF NOT EXISTS email_signature_ctas (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL,
  signature_id    INTEGER REFERENCES email_signatures(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'image',
  destination_url TEXT NOT NULL,
  image_url       TEXT,
  alt_text        TEXT DEFAULT 'Click to learn more',
  width_px        INTEGER DEFAULT 200,
  tracking_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_signature_ctas_user_id      ON email_signature_ctas(user_id);
CREATE INDEX IF NOT EXISTS idx_email_signature_ctas_signature_id ON email_signature_ctas(signature_id);

-- One row per CTA per sent email — generated at send time, token embedded in email body
CREATE TABLE IF NOT EXISTS signature_cta_clicks (
  id               SERIAL PRIMARY KEY,
  token            TEXT NOT NULL UNIQUE,
  signature_cta_id INTEGER REFERENCES email_signature_ctas(id) ON DELETE SET NULL,
  signature_id     INTEGER,
  sent_by_user_id  INTEGER NOT NULL,
  recipient_email  TEXT NOT NULL,
  gmail_message_id TEXT,
  cta_name         TEXT,
  destination_url  TEXT NOT NULL,
  contact_id       INTEGER,
  account_id       INTEGER,
  click_count      INTEGER NOT NULL DEFAULT 0,
  last_clicked_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signature_cta_clicks_token  ON signature_cta_clicks(token);
CREATE INDEX IF NOT EXISTS idx_signature_cta_clicks_sender ON signature_cta_clicks(sent_by_user_id);
CREATE INDEX IF NOT EXISTS idx_signature_cta_clicks_cta_id ON signature_cta_clicks(signature_cta_id);

-- Raw click events per token (privacy-safe: IP is hashed)
CREATE TABLE IF NOT EXISTS signature_cta_click_events (
  id           SERIAL PRIMARY KEY,
  token        TEXT NOT NULL,
  ip_hash      TEXT,
  user_agent   TEXT,
  is_bot       BOOLEAN NOT NULL DEFAULT FALSE,
  is_duplicate BOOLEAN NOT NULL DEFAULT FALSE,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sig_cta_click_events_token ON signature_cta_click_events(token);
