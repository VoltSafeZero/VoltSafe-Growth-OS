-- Voice DNA Training (2026-06)
-- Adds training-metadata columns to ai_voice_profiles for the "Train My Voice" feature.
-- Existing rows get NULL values — the feature is opt-in only.

ALTER TABLE ai_voice_profiles ADD COLUMN IF NOT EXISTS training_source     TEXT;          -- 'sent_mail' | 'manual' | 'gpt_import'
ALTER TABLE ai_voice_profiles ADD COLUMN IF NOT EXISTS training_email_count INTEGER;       -- how many sent emails were analysed
ALTER TABLE ai_voice_profiles ADD COLUMN IF NOT EXISTS trained_at           TIMESTAMPTZ;   -- when training last ran
ALTER TABLE ai_voice_profiles ADD COLUMN IF NOT EXISTS voice_dna_json       TEXT;          -- structured Voice DNA analysis (JSON)
