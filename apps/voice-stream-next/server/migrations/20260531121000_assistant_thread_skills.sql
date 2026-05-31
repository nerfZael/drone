CREATE TABLE IF NOT EXISTS assistant_thread_skills (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES assistant_threads(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES assistant_skills(id) ON DELETE CASCADE,
  loaded_at TEXT NOT NULL,
  PRIMARY KEY (thread_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_assistant_thread_skills_user_thread
  ON assistant_thread_skills(user_id, thread_id, loaded_at);
