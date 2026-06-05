ALTER TABLE assistant_skills ADD COLUMN managed_by_extension_id TEXT;
ALTER TABLE assistant_skills ADD COLUMN managed_skill_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS assistant_skills_extension_skill_unique
ON assistant_skills(user_id, managed_by_extension_id, managed_skill_key)
WHERE managed_by_extension_id IS NOT NULL AND managed_skill_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS assistant_thread_execution_targets (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES assistant_threads(id) ON DELETE CASCADE,
  slot TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, thread_id, slot)
);

UPDATE assistant_threads
SET enabled_tools_json = json_insert(enabled_tools_json, '$[#]', 'list_execution_targets')
WHERE NOT EXISTS (
  SELECT 1 FROM json_each(assistant_threads.enabled_tools_json)
  WHERE value = 'list_execution_targets'
);

UPDATE assistant_threads
SET enabled_tools_json = json_insert(enabled_tools_json, '$[#]', 'set_execution_target')
WHERE NOT EXISTS (
  SELECT 1 FROM json_each(assistant_threads.enabled_tools_json)
  WHERE value = 'set_execution_target'
);

UPDATE assistant_settings
SET default_enabled_tools_json = json_insert(default_enabled_tools_json, '$[#]', 'list_execution_targets')
WHERE NOT EXISTS (
  SELECT 1 FROM json_each(assistant_settings.default_enabled_tools_json)
  WHERE value = 'list_execution_targets'
);

UPDATE assistant_settings
SET default_enabled_tools_json = json_insert(default_enabled_tools_json, '$[#]', 'set_execution_target')
WHERE NOT EXISTS (
  SELECT 1 FROM json_each(assistant_settings.default_enabled_tools_json)
  WHERE value = 'set_execution_target'
);
