-- Daily Downloads: voice journal entries per user per day
CREATE TABLE IF NOT EXISTS daily_downloads (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  visibility TEXT NOT NULL DEFAULT 'team',
  transcript TEXT,
  summary_bullets TEXT[],
  wins TEXT[],
  blockers TEXT[],
  follow_ups TEXT[],
  duration_seconds INTEGER,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_downloads_user_date ON daily_downloads(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_downloads_date ON daily_downloads(date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_downloads_status ON daily_downloads(status);
