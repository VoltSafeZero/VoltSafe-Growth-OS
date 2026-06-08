-- Persist CTA asset image bytes in the database.
-- Disk storage under uploads/cta-assets/ is ephemeral in production (wiped on
-- deploy restart). Without this column, extractCtaInlineImages falls back to an
-- HTTP fetch of the same ephemeral URL which also returns 404, so CID inlining
-- returns inlineImages:[] and Apple Mail renders images as attachments.
-- Storing bytes here gives the send pipeline a persistent source of truth.
ALTER TABLE cta_assets ADD COLUMN IF NOT EXISTS file_data BYTEA;
