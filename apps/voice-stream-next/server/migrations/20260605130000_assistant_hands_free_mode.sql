ALTER TABLE assistant_threads ADD COLUMN hands_free_mode INTEGER NOT NULL DEFAULT 0;

ALTER TABLE assistant_profiles ADD COLUMN default_hands_free_mode INTEGER NOT NULL DEFAULT 0;
