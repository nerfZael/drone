UPDATE assistant_threads
SET enabled_tools_json = '["assistant_artifacts","speak","get_system_prompt","update_system_prompt","set_thinking_level","web_search","fetch_content","create_new_thread"]'
WHERE enabled_tools_json = '["assistant_artifacts","speak","get_system_prompt","update_system_prompt","set_thinking_level","web_search","fetch_content"]';

UPDATE assistant_settings
SET default_enabled_tools_json = '["assistant_artifacts","speak","get_system_prompt","update_system_prompt","set_thinking_level","web_search","fetch_content","create_new_thread"]'
WHERE default_enabled_tools_json = '["assistant_artifacts","speak","get_system_prompt","update_system_prompt","set_thinking_level","web_search","fetch_content"]';
