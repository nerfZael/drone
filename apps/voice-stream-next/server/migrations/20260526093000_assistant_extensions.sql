CREATE TABLE IF NOT EXISTS assistant_extension_manifests (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  extension_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  description TEXT,
  manifest_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, extension_id)
);

CREATE TABLE IF NOT EXISTS assistant_extension_tool_routes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  target_kind TEXT NOT NULL,
  target_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, tool_name)
);
