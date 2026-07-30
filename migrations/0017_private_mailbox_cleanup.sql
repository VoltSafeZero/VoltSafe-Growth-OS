-- 0017: Private mailbox column registration + revoked account cleanup
-- The visibility_type column was added via raw SQL outside the Drizzle schema.
-- This migration ensures it exists, sets a safe default, and marks revoked
-- email_accounts as is_active=false so they are excluded from active mailbox lists
-- and sync jobs. Message data is preserved; no DELETE.
--
-- Idempotent — safe to re-run.

-- Ensure visibility_type column exists (may already be present from prior raw migration)
ALTER TABLE email_accounts
  ADD COLUMN IF NOT EXISTS visibility_type text DEFAULT 'company_managed';

-- Mark revoked accounts inactive so they are excluded from getAccessibleAccounts
-- (which filters is_active = true). This does not delete any messages or threads.
UPDATE email_accounts
SET is_active = false
WHERE auth_status = 'revoked'
  AND is_active = true;
