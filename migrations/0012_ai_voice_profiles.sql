-- AI Voice Profiles (2026-06)
-- Enables "Train From GPT" — users can import GPT instructions, knowledge docs,
-- and example emails to create reusable AI voice profiles for email generation.

-- ── Core voice profile table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_voice_profiles (
  id                    SERIAL PRIMARY KEY,
  owner_user_id         INTEGER,                          -- NULL = global profile
  name                  TEXT NOT NULL,
  description           TEXT,
  profile_type          TEXT NOT NULL DEFAULT 'user',     -- 'global' | 'user'
  system_instructions   TEXT,
  style_rules           TEXT,
  forbidden_phrases     TEXT,                             -- newline-separated
  preferred_phrases     TEXT,                             -- newline-separated
  example_messages_json TEXT DEFAULT '[]',               -- JSON array of strings
  knowledge_summary     TEXT,
  source_label          TEXT,                             -- e.g. "CEO Wattson GPT"
  is_default            BOOLEAN NOT NULL DEFAULT FALSE,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_voice_profiles_owner     ON ai_voice_profiles(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_ai_voice_profiles_type      ON ai_voice_profiles(profile_type);
CREATE INDEX IF NOT EXISTS idx_ai_voice_profiles_is_active ON ai_voice_profiles(is_active);

-- ── Knowledge files attached to a voice profile ──────────────────────────────
CREATE TABLE IF NOT EXISTS ai_voice_profile_files (
  id                SERIAL PRIMARY KEY,
  voice_profile_id  INTEGER NOT NULL REFERENCES ai_voice_profiles(id) ON DELETE CASCADE,
  original_filename TEXT NOT NULL,
  file_type         TEXT NOT NULL DEFAULT 'text',   -- 'text' | 'pdf' | 'docx'
  extracted_text    TEXT,
  text_summary      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_voice_profile_files_profile ON ai_voice_profile_files(voice_profile_id);

-- ── Per-user AI settings ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_ai_settings (
  user_id                   INTEGER PRIMARY KEY,
  default_voice_profile_id  INTEGER REFERENCES ai_voice_profiles(id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Seed: CEO Wattson global profile ─────────────────────────────────────────
INSERT INTO ai_voice_profiles (
  owner_user_id,
  name,
  description,
  profile_type,
  system_instructions,
  style_rules,
  forbidden_phrases,
  preferred_phrases,
  example_messages_json,
  knowledge_summary,
  source_label,
  is_default,
  is_active
) VALUES (
  NULL,
  'CEO Wattson',
  'Trevor Burgess founder/CEO voice for VoltSafe communications. Direct, commercially grounded, warm, and specific. Writes like a real human — not a marketing department.',
  'global',
  'Write like Trevor Burgess, CEO and Co-Founder of VoltSafe. Use a direct, plainspoken, commercially grounded founder tone. Be clear, warm, confident, and specific. Write like a real human, not a marketing department. Avoid corporate fluff. Focus on momentum, next steps, business value, trust, and practical outcomes. Keep emails concise unless detail is required. Ask clean next-step questions. Do not over-explain. Do not sound robotic.',
  '- Clear subject line
- Short opening
- Direct reason for the email
- Tie message to the recipient/account context
- Make the value obvious
- Use plain English
- End with a simple next step
- Avoid hype
- Avoid long paragraphs
- Avoid generic AI phrases',
  'I hope this email finds you well
Just checking in
Circle back
Touch base
Synergy
Revolutionary
Game-changing
Leverage our solution
Cutting-edge',
  'Quick note
The reason I''m reaching out
The practical value is
It may be worth a short conversation
A simple next step would be
Here''s what matters
The opportunity is straightforward',
  '[]',
  'Trevor Burgess is CEO and Co-Founder of VoltSafe, a marina electrification company. VoltSafe builds smart shore power systems for marinas — safe, connected, and remotely managed. The company sells to marina operators and dock managers who care about safety, liability reduction, and modern amenities for boaters. Trevor writes like a founder: direct, warm, no fluff.',
  'CEO Wattson (Built-in)',
  TRUE,
  TRUE
) ON CONFLICT DO NOTHING;

-- Post-flight verification:
-- SELECT id, name, profile_type, is_default FROM ai_voice_profiles;
-- SELECT COUNT(*) FROM ai_voice_profile_files;
-- SELECT COUNT(*) FROM user_ai_settings;
