-- Phase 2A: additive taxonomy fields.
-- Separates true market-segment classification from legacy slip-range text.
-- All columns are nullable with no defaults — existing rows are unaffected.
-- Do NOT drop or rename: leads.segment, accounts.segment, accounts.org_type.

-- Leads: market segment, normalised slip range key, integer slip count
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS market_segment  TEXT,
  ADD COLUMN IF NOT EXISTS slip_range      TEXT,
  ADD COLUMN IF NOT EXISTS slip_count_int  INTEGER;

-- Accounts: market segment, normalised slip range key
-- (slip_count already exists on accounts as slip_count — no integer duplicate needed)
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS market_segment  TEXT,
  ADD COLUMN IF NOT EXISTS slip_range      TEXT;
