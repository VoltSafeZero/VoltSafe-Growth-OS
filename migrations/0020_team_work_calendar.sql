-- Team Work Calendar: schedule entries, recurring defaults, audit log

CREATE TABLE IF NOT EXISTS team_work_schedule_entries (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  status TEXT NOT NULL DEFAULT 'not_updated',
  location_type TEXT,
  location_name TEXT,
  work_focus TEXT,
  availability TEXT,
  notes TEXT,
  visibility TEXT NOT NULL DEFAULT 'team',
  is_recurring_override BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INTEGER NOT NULL,
  updated_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_work_schedule_defaults (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  day_of_week INTEGER NOT NULL,
  default_status TEXT NOT NULL,
  default_start_time TEXT,
  default_end_time TEXT,
  default_location_type TEXT,
  default_location_name TEXT,
  default_availability TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, day_of_week)
);

CREATE TABLE IF NOT EXISTS team_work_schedule_audit_log (
  id SERIAL PRIMARY KEY,
  entry_id INTEGER,
  changed_by INTEGER NOT NULL,
  change_type TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_twse_user_date ON team_work_schedule_entries(user_id, date);
CREATE INDEX IF NOT EXISTS idx_twse_date ON team_work_schedule_entries(date);
CREATE INDEX IF NOT EXISTS idx_twsd_user ON team_work_schedule_defaults(user_id);
