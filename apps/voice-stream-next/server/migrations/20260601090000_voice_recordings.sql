CREATE TABLE IF NOT EXISTS voice_recordings (
  id TEXT PRIMARY KEY,
  voice_session_id TEXT NOT NULL UNIQUE REFERENCES voice_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  assistant_thread_id TEXT REFERENCES assistant_threads(id) ON DELETE SET NULL,
  mode TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  sample_rate_hz INTEGER NOT NULL,
  channels INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_voice_recordings_user_mode_created
  ON voice_recordings(user_id, mode, created_at DESC);
