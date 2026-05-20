-- Additive column for parent-account hierarchy readiness.
-- Links a child marina Account to its parent operating group Account
-- (e.g. an individual marina → its Safe Harbor / Suntex / MarineMax parent).
--
-- Nullable — no existing rows are affected.
-- No FK constraint added yet: keeps this migration fully reversible without
-- cascade concerns. A FK + hierarchy UI will be added in a future phase once
-- the marina_parent_group segment classification is backfilled.

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS parent_account_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_accounts_parent_account_id
  ON accounts (parent_account_id);
