-- CTA Assets: stores uploaded CTA image files with stable public URLs
CREATE TABLE IF NOT EXISTS cta_assets (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  filename    TEXT NOT NULL UNIQUE,
  public_url  TEXT NOT NULL,
  mime_type   TEXT NOT NULL DEFAULT 'image/png',
  file_size   INTEGER,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_archived BOOLEAN NOT NULL DEFAULT FALSE
);

-- Optional FK: track which CTA asset a signature CTA uses
ALTER TABLE email_signature_ctas
  ADD COLUMN IF NOT EXISTS asset_id INTEGER REFERENCES cta_assets(id) ON DELETE SET NULL;
