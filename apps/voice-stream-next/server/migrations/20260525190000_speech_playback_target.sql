ALTER TABLE voice_settings
ADD COLUMN speech_playback_target TEXT NOT NULL DEFAULT 'auto';
