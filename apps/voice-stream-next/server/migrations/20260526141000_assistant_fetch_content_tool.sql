UPDATE assistant_threads
SET enabled_tools_json = '["assistant_artifacts","speak","get_system_prompt","update_system_prompt","set_thinking_level","web_search","fetch_content"]'
WHERE enabled_tools_json = '["assistant_artifacts","speak","get_system_prompt","update_system_prompt","set_thinking_level","web_search"]';
