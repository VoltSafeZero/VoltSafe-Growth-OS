-- 0030: Multimodal cortex ingestion — file metadata columns
-- Enables text paste, file upload, image, audio, and voice source types.
ALTER TABLE cortex_email_intel ADD COLUMN IF NOT EXISTS original_filename TEXT;
ALTER TABLE cortex_email_intel ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT;
ALTER TABLE cortex_email_intel ADD COLUMN IF NOT EXISTS file_mime_type TEXT;
