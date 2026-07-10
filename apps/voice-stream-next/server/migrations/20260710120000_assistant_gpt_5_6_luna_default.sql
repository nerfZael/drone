UPDATE assistant_settings
SET default_model = 'gpt-5.6-luna'
WHERE default_model = 'gpt-5.5'
  AND default_thinking_level = 'medium';
