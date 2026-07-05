ALTER TABLE assistant_threads ADD COLUMN voice_mode TEXT;

UPDATE assistant_threads
SET enabled_tools_json = json_insert(enabled_tools_json, '$[#]', 'setVoiceMode')
WHERE NOT EXISTS (
  SELECT 1 FROM json_each(assistant_threads.enabled_tools_json)
  WHERE value = 'setVoiceMode'
);

UPDATE assistant_settings
SET default_enabled_tools_json = json_insert(default_enabled_tools_json, '$[#]', 'setVoiceMode')
WHERE NOT EXISTS (
  SELECT 1 FROM json_each(assistant_settings.default_enabled_tools_json)
  WHERE value = 'setVoiceMode'
);

UPDATE assistant_profiles
SET enabled_tools_json = json_insert(enabled_tools_json, '$[#]', 'setVoiceMode')
WHERE enabled_tools_json IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM json_each(assistant_profiles.enabled_tools_json)
    WHERE value = 'setVoiceMode'
  );