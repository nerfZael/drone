CREATE TABLE IF NOT EXISTS voice_recording_segments (
  id TEXT PRIMARY KEY,
  recording_id TEXT NOT NULL REFERENCES voice_recordings(id) ON DELETE CASCADE,
  voice_session_id TEXT NOT NULL REFERENCES voice_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  text TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  final INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(recording_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_voice_recording_segments_recording_sequence
  ON voice_recording_segments(recording_id, sequence);
