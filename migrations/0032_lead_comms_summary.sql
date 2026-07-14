-- Lead Communication Summary table
-- Stores aggregated email communication data per lead, computed from email_messages
-- matched by lead.contact_email. Updated by backfill + incremental sync.

CREATE TABLE IF NOT EXISTS lead_comms_summary (
  lead_id INTEGER PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  last_outgoing_at TIMESTAMPTZ,
  last_incoming_at TIMESTAMPTZ,
  last_comm_at TIMESTAMPTZ,
  outgoing_count INTEGER NOT NULL DEFAULT 0,
  incoming_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lcs_last_comm_at ON lead_comms_summary(last_comm_at);
CREATE INDEX IF NOT EXISTS idx_lcs_last_outgoing_at ON lead_comms_summary(last_outgoing_at);
CREATE INDEX IF NOT EXISTS idx_lcs_outgoing_count ON lead_comms_summary(outgoing_count);
CREATE INDEX IF NOT EXISTS idx_lcs_incoming_count ON lead_comms_summary(incoming_count);
