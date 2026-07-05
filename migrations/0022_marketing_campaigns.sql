-- Phase 16: Marketing & Campaign Intelligence
-- Adds full campaign engine: campaigns, segments, email sequences,
-- recipients, events, templates, suppression list.
-- Also adds marina persona / adoption intelligence columns to accounts,
-- and email consent / bounce flags to contacts.

-- ── Account: marina intelligence fields ─────────────────────────────────────
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS marina_persona           text,
  ADD COLUMN IF NOT EXISTS adoption_stage           text,
  ADD COLUMN IF NOT EXISTS adoption_readiness_score integer,
  ADD COLUMN IF NOT EXISTS decision_complexity      text,
  ADD COLUMN IF NOT EXISTS procurement_style        text,
  ADD COLUMN IF NOT EXISTS likely_buyer             text,
  ADD COLUMN IF NOT EXISTS likely_influencers       text,
  ADD COLUMN IF NOT EXISTS primary_pain             text,
  ADD COLUMN IF NOT EXISTS secondary_pain           text,
  ADD COLUMN IF NOT EXISTS recommended_campaign     text,
  ADD COLUMN IF NOT EXISTS recommended_cta          text,
  ADD COLUMN IF NOT EXISTS recommended_first_play   text;

-- ── Contact: email consent / deliverability flags ────────────────────────────
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS do_not_email       boolean NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_bounced      boolean NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_unsubscribed boolean NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS contact_type       text;

-- ── Campaign Segments (Audiences) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaign_segments (
  id               SERIAL PRIMARY KEY,
  segment_name     text NOT NULL,
  description      text,
  filters_json     jsonb,
  segment_type     text NOT NULL DEFAULT 'dynamic',
  saved_by_user_id integer REFERENCES users(id),
  recipient_count  integer NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Marketing Campaigns ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id                  SERIAL PRIMARY KEY,
  campaign_name       text NOT NULL,
  campaign_type       text NOT NULL DEFAULT 'awareness',
  goal                text,
  status              text NOT NULL DEFAULT 'draft',
  owner_user_id       integer REFERENCES users(id),
  segment_id          integer REFERENCES campaign_segments(id),
  start_date          date,
  end_date            date,
  total_recipients    integer NOT NULL DEFAULT 0,
  sent_count          integer NOT NULL DEFAULT 0,
  delivered_count     integer NOT NULL DEFAULT 0,
  opened_count        integer NOT NULL DEFAULT 0,
  clicked_count       integer NOT NULL DEFAULT 0,
  replied_count       integer NOT NULL DEFAULT 0,
  bounced_count       integer NOT NULL DEFAULT 0,
  unsubscribed_count  integer NOT NULL DEFAULT 0,
  demo_booked_count   integer NOT NULL DEFAULT 0,
  notes               text,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mktg_camp_status ON marketing_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_mktg_camp_owner  ON marketing_campaigns(owner_user_id);

-- ── Campaign Email Sequence Steps ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaign_emails (
  id              SERIAL PRIMARY KEY,
  campaign_id     integer NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  step_number     integer NOT NULL DEFAULT 1,
  subject         text NOT NULL,
  body_html       text,
  body_text       text,
  delay_days      integer NOT NULL DEFAULT 0,
  sender_user_id  integer REFERENCES users(id),
  status          text NOT NULL DEFAULT 'draft',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_camp_emails_campaign ON campaign_emails(campaign_id);

-- ── Campaign Recipients ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaign_recipients (
  id                SERIAL PRIMARY KEY,
  campaign_id       integer NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  contact_id        integer REFERENCES contacts(id),
  account_id        integer REFERENCES accounts(id),
  email             text NOT NULL,
  name              text,
  marina_persona    text,
  adoption_stage    text,
  role              text,
  status            text NOT NULL DEFAULT 'pending',
  current_step      integer NOT NULL DEFAULT 0,
  last_sent_at      TIMESTAMPTZ,
  opened_count      integer NOT NULL DEFAULT 0,
  clicked_count     integer NOT NULL DEFAULT 0,
  replied_at        TIMESTAMPTZ,
  bounced_at        TIMESTAMPTZ,
  unsubscribed_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_camp_recip_campaign ON campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_camp_recip_contact  ON campaign_recipients(contact_id);
CREATE INDEX IF NOT EXISTS idx_camp_recip_account  ON campaign_recipients(account_id);

-- ── Campaign Events ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaign_events (
  id               SERIAL PRIMARY KEY,
  campaign_id      integer NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  recipient_id     integer REFERENCES campaign_recipients(id),
  contact_id       integer REFERENCES contacts(id),
  account_id       integer REFERENCES accounts(id),
  event_type       text NOT NULL,
  event_timestamp  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata         jsonb
);

CREATE INDEX IF NOT EXISTS idx_camp_events_campaign ON campaign_events(campaign_id);
CREATE INDEX IF NOT EXISTS idx_camp_events_type     ON campaign_events(event_type);

-- ── Campaign Templates ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaign_templates (
  id                SERIAL PRIMARY KEY,
  template_name     text NOT NULL,
  persona           text,
  stakeholder_role  text,
  campaign_type     text,
  subject           text,
  body_html         text,
  body_text         text,
  recommended_cta   text,
  is_starter        boolean NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Campaign Suppression List ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaign_suppression (
  id         SERIAL PRIMARY KEY,
  email      text,
  domain     text,
  reason     text,
  source     text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_camp_suppress_email  ON campaign_suppression(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_camp_suppress_domain ON campaign_suppression(domain) WHERE domain IS NOT NULL;

-- ── Seed starter templates ────────────────────────────────────────────────────
INSERT INTO campaign_templates (template_name, persona, stakeholder_role, campaign_type, subject, body_text, recommended_cta, is_starter) VALUES
('Marina Owner ROI', 'Premium Independent Marina', 'Owner', 'awareness',
 'Shore Power Is Billable Infrastructure — Is Yours Working for You?',
 'Many marinas are leaving money on the dock through outdated shore power billing. Smart shore power turns a utility expense into a managed, measurable revenue asset — with full visibility for owners.',
 'Book a marina revenue + shore power assessment', TRUE),
('GM Operations', NULL, 'GM', 'problem_based',
 'Managing Shore Power Shouldn''t Mean Manual Readings and Mystery Outages',
 'Managing shore power should not require manual readings, mystery outages, and boater complaints. VoltSafe gives GMs real-time visibility, automated billing, and fewer dock headaches.',
 'See how smart shore power simplifies marina operations', TRUE),
('Harbormaster Safety', NULL, 'Harbormaster', 'stakeholder_specific',
 'Shore Power Problems Usually Land on Your Team First',
 'Shore power issues become safety issues — and they usually land on the harbormaster first. VoltSafe''s smart monitoring catches problems before they become incidents.',
 'Review VoltSafe''s marina safety approach', TRUE),
('Marine Electrician Technical', NULL, 'Marine Electrician', 'stakeholder_specific',
 'Safer Shore Power Design. Smarter Diagnostics.',
 'VoltSafe gives marinas smarter shore power without relying on exposed legacy connection points. Better diagnostics, clearer install specs, and fewer mystery failures.',
 'Request technical overview', TRUE),
('Municipal / Port Infrastructure', 'Port Authority Marina', 'Port Manager', 'municipal_port',
 'Public Marina Infrastructure Needs to Be Safer, Smarter, and More Resilient',
 'Public marina infrastructure is under pressure to become safer, smarter, and more resilient. VoltSafe aligns with electrification mandates, safety compliance, and demand response readiness.',
 'Explore smart shore power for public marina infrastructure', TRUE),
('Premium Independent Marina', 'Premium Independent Marina', NULL, 'awareness',
 'Modernize the Dock — Without the Complexity',
 'Premium marinas are modernizing shore power because boaters now expect safer, cleaner, smarter dock infrastructure. Reduce operational friction and improve the boater experience.',
 'Book a marina modernization call', TRUE),
('Marina Group / Multi-Site', 'Marina Group / Multi-Site Operator', NULL, 'awareness',
 'Standardize Shore Power Across All Your Locations',
 'Multi-site operators benefit from centralized visibility, standardized infrastructure, and recurring software value — across every location from one dashboard.',
 'Review portfolio-wide shore power strategy', TRUE),
('Resort / Destination Marina', 'Resort / Destination Marina', NULL, 'awareness',
 'Upgrade the Guest Power Experience',
 'Premium guest experience starts at the dock. Clean design, reliable power, and smart metering differentiate resort marinas from the competition.',
 'Upgrade the guest power experience', TRUE),
('Developer / New Build', 'Developer / New Build', 'Developer', 'developer_newbuild',
 'Specify Next-Generation Shore Power from Day One',
 'New marina projects should not be specifying yesterday''s shore power infrastructure into tomorrow''s waterfront. Avoid costly retrofits by specifying VoltSafe from the start.',
 'Discuss VoltSafe for new marina projects', TRUE),
('Mom & Pop Nurture', 'Mom & Pop Marina', NULL, 're_engagement',
 'Safer Dock Power. Less Hassle.',
 'Fewer headaches, safer dock power, easier billing, practical modernization. VoltSafe works for marinas of all sizes — including yours.',
 'See if VoltSafe fits your marina', TRUE)
ON CONFLICT DO NOTHING;
