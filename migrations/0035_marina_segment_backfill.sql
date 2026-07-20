-- Migration 0035: Backfill market_segment and primary_industry for marina_directory leads
--
-- CONTEXT
-- Leads imported from the marina_directory source were originally inserted without
-- market_segment='marina' set in some import paths (the MX hardcoded batch and any
-- bulk CSV imports run before the importer was patched). The UI "Marina" filter in
-- storage.ts:417-429 was querying only market_segment='marina', which silently hid
-- the ~10,843 records that came in without that field populated.
--
-- FIX
-- 1. This migration backfills the missing values — idempotent, the WHERE clause
--    skips already-correct rows so it is safe to run more than once.
-- 2. The application filter (storage.ts) was broadened to OR
--    (market_segment='marina' OR source='marina_directory' OR primary_industry='marine').
-- 3. The MX importer path (storage.ts importMarinasAsLeads) was patched to set
--    marketSegment:'marina' on all future inserts.
--
-- PRE-FLIGHT VERIFICATION (run before applying):
--   SELECT COUNT(*) FROM leads
--   WHERE source = 'marina_directory'
--     AND (market_segment IS NULL OR market_segment != 'marina');
--   -- Expected on first run: large positive number (~10,843)
--   -- Expected on re-run: 0

UPDATE leads
SET
  market_segment   = 'marina',
  primary_industry = 'marine'
WHERE source = 'marina_directory'
  AND (
    market_segment   IS NULL
    OR market_segment   = ''
    OR market_segment   != 'marina'
    OR primary_industry IS NULL
    OR primary_industry  = ''
    OR primary_industry != 'marine'
  );

-- POST-FLIGHT VERIFICATION (run after applying and record results):
--
--   SELECT COUNT(*) FROM leads
--   WHERE source = 'marina_directory'
--     AND (market_segment IS NULL OR market_segment != 'marina');
--   -- Expected: 0
--
--   SELECT COUNT(*) FROM leads WHERE source = 'marina_directory';
--   -- Record: total marina_directory records
--
--   SELECT
--     COALESCE(NULLIF(TRIM(country),''), '(blank)') AS country,
--     COUNT(*) AS cnt
--   FROM leads
--   WHERE source = 'marina_directory'
--   GROUP BY 1 ORDER BY 2 DESC;
--   -- Record: country distribution
--
--   SELECT COUNT(*) FROM leads
--   WHERE market_segment = 'marina' OR source = 'marina_directory';
--   -- Record: total visible under Marina filter
