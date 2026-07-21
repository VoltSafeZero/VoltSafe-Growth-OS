-- Export / Download permission flags and audit log table
-- Part of the strict export-restriction hardening (Phase 1)

-- ── Audit log table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS export_audit_log (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER,
  user_name     TEXT,
  action        TEXT        NOT NULL,
  module        TEXT,
  resource_id   TEXT,
  endpoint      TEXT        NOT NULL,
  outcome       TEXT        NOT NULL,     -- 'allowed' | 'denied'
  denial_reason TEXT,
  ip_address    TEXT,
  user_agent    TEXT,
  created_at    TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS export_audit_log_user_id_idx   ON export_audit_log(user_id);
CREATE INDEX IF NOT EXISTS export_audit_log_created_at_idx ON export_audit_log(created_at DESC);

-- ── Backfill permission flags into existing users ────────────────────────────
-- Active staff roles: grant export / download (preserves existing access)
UPDATE users
SET permissions = COALESCE(permissions, '{}'::jsonb) ||
  '{"can_export":true,"can_download_attachment":true,"can_generate_report":true}'::jsonb
WHERE global_role IN ('master_admin','admin','manager','exec','sales','engineer','customer_success','analyst');

-- Restricted roles: explicitly deny
UPDATE users
SET permissions = COALESCE(permissions, '{}'::jsonb) ||
  '{"can_export":false,"can_download_attachment":false,"can_generate_report":false}'::jsonb
WHERE global_role IN ('advisor','read_only');

-- Any remaining roles not covered above: grant by default (backward compat)
UPDATE users
SET permissions = COALESCE(permissions, '{}'::jsonb) ||
  '{"can_export":true,"can_download_attachment":true,"can_generate_report":true}'::jsonb
WHERE (permissions->>'can_export') IS NULL;
