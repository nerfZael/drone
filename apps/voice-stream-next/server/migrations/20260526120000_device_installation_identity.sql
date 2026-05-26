ALTER TABLE devices ADD COLUMN installation_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_user_type_installation
  ON devices(user_id, device_type, installation_id)
  WHERE installation_id IS NOT NULL;

ALTER TABLE desktop_auth_requests ADD COLUMN installation_id TEXT;
