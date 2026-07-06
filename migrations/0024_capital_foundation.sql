-- Phase 1: Capital module foundation
-- Tables: capital_funders, capital_grants, capital_documents, capital_activities

CREATE TABLE IF NOT EXISTS capital_funders (
  id                     SERIAL PRIMARY KEY,
  name                   TEXT NOT NULL,
  funder_type            TEXT NOT NULL DEFAULT 'Other',
  funder_persona         TEXT NOT NULL DEFAULT 'Unknown',
  organization           TEXT,
  primary_contact_name   TEXT,
  primary_contact_email  TEXT,
  primary_contact_phone  TEXT,
  website                TEXT,
  linkedin               TEXT,
  location               TEXT,
  geography_focus        TEXT,
  sector_focus           TEXT,
  investment_thesis      TEXT,
  relevant_themes        TEXT,
  cheque_size_min_cents  BIGINT,
  cheque_size_max_cents  BIGINT,
  typical_stage          TEXT,
  relationship_strength  TEXT NOT NULL DEFAULT 'Cold',
  intro_path             TEXT,
  status                 TEXT NOT NULL DEFAULT 'active',
  priority               TEXT NOT NULL DEFAULT 'Medium',
  fit_score              INTEGER,
  heat_score             INTEGER,
  expected_amount_cents  BIGINT,
  probability_percent    INTEGER,
  pipeline_stage         TEXT NOT NULL DEFAULT 'Target Identified',
  next_follow_up_at      TIMESTAMPTZ,
  last_contacted_at      TIMESTAMPTZ,
  owner_user_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS capital_grants (
  id                       SERIAL PRIMARY KEY,
  program_name             TEXT NOT NULL,
  funding_body             TEXT,
  program_type             TEXT NOT NULL DEFAULT 'Other',
  non_dilutive_or_dilutive TEXT NOT NULL DEFAULT 'Non-dilutive',
  max_funding_amount_cents BIGINT,
  cost_share_percent       INTEGER,
  eligible_costs           TEXT,
  deadline                 DATE,
  intake_type              TEXT,
  geography                TEXT,
  sector_fit               TEXT,
  eligibility_status       TEXT NOT NULL DEFAULT 'Unknown',
  application_status       TEXT NOT NULL DEFAULT 'Identified',
  required_documents       TEXT,
  reporting_burden         TEXT NOT NULL DEFAULT 'Medium',
  strategic_fit            TEXT,
  fit_score                INTEGER,
  expected_amount_cents    BIGINT,
  probability_percent      INTEGER,
  owner_user_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  next_action              TEXT,
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS capital_documents (
  id                    SERIAL PRIMARY KEY,
  document_name         TEXT NOT NULL,
  document_type         TEXT NOT NULL DEFAULT 'Other',
  version               TEXT,
  status                TEXT NOT NULL DEFAULT 'Draft',
  owner_user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  last_updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  shared_with_funder_id INTEGER REFERENCES capital_funders(id) ON DELETE SET NULL,
  shared_at             TIMESTAMPTZ,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS capital_activities (
  id            SERIAL PRIMARY KEY,
  funder_id     INTEGER REFERENCES capital_funders(id) ON DELETE SET NULL,
  grant_id      INTEGER REFERENCES capital_grants(id) ON DELETE SET NULL,
  activity_type TEXT NOT NULL DEFAULT 'Note',
  subject       TEXT,
  body          TEXT,
  activity_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at        TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_capital_funders_pipeline_stage ON capital_funders(pipeline_stage);
CREATE INDEX IF NOT EXISTS idx_capital_funders_priority       ON capital_funders(priority);
CREATE INDEX IF NOT EXISTS idx_capital_funders_funder_type    ON capital_funders(funder_type);
CREATE INDEX IF NOT EXISTS idx_capital_funders_next_followup  ON capital_funders(next_follow_up_at);
CREATE INDEX IF NOT EXISTS idx_capital_grants_deadline        ON capital_grants(deadline);
CREATE INDEX IF NOT EXISTS idx_capital_grants_app_status      ON capital_grants(application_status);
CREATE INDEX IF NOT EXISTS idx_capital_activities_funder      ON capital_activities(funder_id);
CREATE INDEX IF NOT EXISTS idx_capital_activities_grant       ON capital_activities(grant_id);
