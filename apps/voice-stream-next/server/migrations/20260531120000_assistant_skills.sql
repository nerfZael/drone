CREATE TABLE IF NOT EXISTS assistant_skills (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  markdown_body TEXT NOT NULL DEFAULT '',
  tool_names_json TEXT NOT NULL DEFAULT '[]',
  disable_model_invocation INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, slug)
);

UPDATE assistant_threads
SET enabled_tools_json = json_insert(enabled_tools_json, '$[#]', 'load_skill')
WHERE NOT EXISTS (
  SELECT 1 FROM json_each(assistant_threads.enabled_tools_json)
  WHERE value = 'load_skill'
);

UPDATE assistant_settings
SET default_enabled_tools_json = json_insert(default_enabled_tools_json, '$[#]', 'load_skill')
WHERE NOT EXISTS (
  SELECT 1 FROM json_each(assistant_settings.default_enabled_tools_json)
  WHERE value = 'load_skill'
);
