-- CEO Wattson Influence Level (2026-06)
-- Adds a per-user control for how strongly the CEO Wattson executive
-- voice style is applied during email generation.
-- Valid values: 0, 25, 50, 75, 100
-- Default: 75 (CEO Wattson)

ALTER TABLE user_ai_settings
  ADD COLUMN IF NOT EXISTS ceo_wattson_influence_level INTEGER NOT NULL DEFAULT 75;

-- Enforce allowed values
ALTER TABLE user_ai_settings
  DROP CONSTRAINT IF EXISTS chk_wattson_influence_level;

ALTER TABLE user_ai_settings
  ADD CONSTRAINT chk_wattson_influence_level
  CHECK (ceo_wattson_influence_level IN (0, 25, 50, 75, 100));

-- Post-flight verification:
-- SELECT user_id, default_voice_profile_id, ceo_wattson_influence_level FROM user_ai_settings LIMIT 10;
