-- Migration 0027: Private personal mailbox visibility type + access grants
-- Adds visibility_type column to email_accounts and creates mailbox_access_grants table.

-- Step 1: Add visibility_type column (default private_personal — safest default)
ALTER TABLE email_accounts
  ADD COLUMN IF NOT EXISTS visibility_type TEXT NOT NULL DEFAULT 'private_personal';

-- Step 2: Migrate existing accounts from is_shared flag + email heuristics
-- is_shared=TRUE → team_shared
UPDATE email_accounts
  SET visibility_type = 'team_shared'
  WHERE is_shared = TRUE;

-- @voltsafe.com accounts that are NOT shared → company_managed
-- (personal voltsafe.com work accounts: trevor@voltsafe.com, etc.)
UPDATE email_accounts
  SET visibility_type = 'company_managed'
  WHERE is_shared = FALSE
    AND (
      email_address LIKE '%@voltsafe.com'
      OR email_address LIKE 'sales@%'
      OR email_address LIKE 'support@%'
      OR email_address LIKE 'info@%'
      OR email_address LIKE 'hello@%'
      OR email_address LIKE 'billing@%'
      OR email_address LIKE 'ops@%'
      OR email_address LIKE 'admin@%'
    );

-- Personal non-company accounts stay as private_personal (the DEFAULT above)

-- Step 3: Create mailbox_access_grants table
-- Used to give specific users read/send/manage access to team_shared and company_managed mailboxes.
-- private_personal mailboxes NEVER appear here — they are owner-only with no exceptions.
CREATE TABLE IF NOT EXISTS mailbox_access_grants (
  id              SERIAL PRIMARY KEY,
  mailbox_account_id INTEGER NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_level    TEXT NOT NULL DEFAULT 'viewer',  -- owner | viewer | sender | manager
  can_read        BOOLEAN NOT NULL DEFAULT TRUE,
  can_send        BOOLEAN NOT NULL DEFAULT FALSE,
  can_manage      BOOLEAN NOT NULL DEFAULT FALSE,
  granted_by      INTEGER REFERENCES users(id),
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT mailbox_access_grants_unique UNIQUE(mailbox_account_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_mag_mailbox ON mailbox_access_grants(mailbox_account_id);
CREATE INDEX IF NOT EXISTS idx_mag_user    ON mailbox_access_grants(user_id);
