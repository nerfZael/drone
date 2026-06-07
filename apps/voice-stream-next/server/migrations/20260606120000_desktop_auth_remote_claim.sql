ALTER TABLE desktop_auth_requests ADD COLUMN claimed_server_url TEXT;
ALTER TABLE desktop_auth_requests ADD COLUMN claimed_device_id TEXT;
ALTER TABLE desktop_auth_requests ADD COLUMN claimed_device_display_name TEXT;
