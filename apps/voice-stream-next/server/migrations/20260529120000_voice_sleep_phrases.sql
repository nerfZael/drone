ALTER TABLE voice_settings ADD COLUMN unlock_phrase TEXT NOT NULL DEFAULT 'wake up now';
ALTER TABLE voice_settings ADD COLUMN shutdown_phrase TEXT NOT NULL DEFAULT 'shut down completely';
