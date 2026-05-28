-- Add shore_power field to leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS shore_power TEXT DEFAULT 'unknown';
