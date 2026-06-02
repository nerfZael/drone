CREATE TABLE IF NOT EXISTS assistant_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  base_profile_id TEXT REFERENCES assistant_profiles(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  wake_phrase TEXT NOT NULL,
  wake_phrase_aliases_json TEXT,
  tts_voice TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  system_prompt TEXT,
  enabled_tools_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, wake_phrase)
);

ALTER TABLE assistant_threads ADD COLUMN assistant_profile_id TEXT REFERENCES assistant_profiles(id) ON DELETE SET NULL;
ALTER TABLE voice_sessions ADD COLUMN assistant_profile_id TEXT REFERENCES assistant_profiles(id) ON DELETE SET NULL;
