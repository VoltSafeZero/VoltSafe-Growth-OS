-- Migration 0034: Add entity_type to leads
-- Canonical marina classification for all lead records.
-- Replaces the implicit `marina_id IS NOT NULL` anchor condition
-- with an explicit, user-settable entity_type column.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS entity_type TEXT;

-- Phase A: backfill imported marina records (100% confidence)
UPDATE leads
SET entity_type = 'marina'
WHERE marina_id IS NOT NULL
  AND entity_type IS NULL;

-- Phase B: backfill high-confidence manually-created marina leads
-- Criteria: name contains a strong marina keyword AND not a test-suite record.
UPDATE leads
SET entity_type = 'marina'
WHERE marina_id IS NULL
  AND entity_type IS NULL
  AND source != 'test_suite'
  AND (
    LOWER(company) LIKE '%marina%'
    OR LOWER(company) LIKE '%yacht club%'
    OR LOWER(company) LIKE '%boat harbour%'
    OR LOWER(company) LIKE '%boat harbor%'
    OR LOWER(company) LIKE '%small boat harbor%'
  );
