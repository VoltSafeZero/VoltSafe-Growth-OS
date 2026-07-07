-- Phase 16: Security Audit Events Table
-- Idempotent: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS

CREATE TABLE IF NOT EXISTS security_audit_events (
  id            SERIAL PRIMARY KEY,
  actor_user_id INTEGER,
  action        TEXT NOT NULL,
  category      TEXT NOT NULL,
  target_type   TEXT,
  target_id     TEXT,
  route         TEXT,
  severity      TEXT NOT NULL DEFAULT 'medium',
  result        TEXT NOT NULL DEFAULT 'succeeded',
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sae_actor    ON security_audit_events (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_sae_category ON security_audit_events (category);
CREATE INDEX IF NOT EXISTS idx_sae_created  ON security_audit_events (created_at DESC);
