-- Additive columns for durable lifecycle lineage on migration_map.
-- Records who performed each transition, what state changed from/to,
-- and the type of transition (promote / revert / to_lead).
-- All columns are nullable so existing rows are unaffected.

ALTER TABLE migration_map
  ADD COLUMN IF NOT EXISTS transition_type         TEXT,
  ADD COLUMN IF NOT EXISTS performed_by_user_id    INTEGER,
  ADD COLUMN IF NOT EXISTS from_status             TEXT,
  ADD COLUMN IF NOT EXISTS to_status               TEXT;

-- Index for fast per-lead history lookups
CREATE INDEX IF NOT EXISTS idx_migration_map_lead_lineage
  ON migration_map (legacy_table, legacy_record_id);
CREATE INDEX IF NOT EXISTS idx_migration_map_lead_lineage_rev
  ON migration_map (new_table, new_record_id);
