-- Rollback for migration 0035: marina_segment_backfill
--
-- This rollback is intentionally a NO-OP.
--
-- The backfill set market_segment='marina' and primary_industry='marine' only
-- on rows that previously had NULL, blank, or incorrect values. We cannot know
-- which rows had NULL vs. a different original value at the time of the original
-- import, so restoring the pre-migration state would require the original raw
-- import data, which is not stored in the database.
--
-- If you need to reverse this for a specific record, set market_segment manually:
--   UPDATE leads SET market_segment = NULL WHERE id = <id>;
--
-- VERIFICATION after "rollback":
--   SELECT COUNT(*) FROM leads WHERE source = 'marina_directory' AND market_segment = 'marina';
--   -- Will still show ~10,848 because we cannot reverse a data backfill safely.

SELECT 'Migration 0035 rollback: no-op — backfill cannot be safely reversed without original import state.' AS note;
