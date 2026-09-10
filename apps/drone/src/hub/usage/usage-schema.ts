export const USAGE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, drone_id TEXT, name TEXT, repo TEXT);
  CREATE TABLE IF NOT EXISTS executions (
    id TEXT PRIMARY KEY, chat_id TEXT, drone_id TEXT, chat_name TEXT, repo TEXT,
    agent TEXT NOT NULL, purpose TEXT NOT NULL, started_at TEXT NOT NULL,
    status TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS executions_chat ON executions(chat_id, started_at);
  CREATE INDEX IF NOT EXISTS executions_date ON executions(started_at);
  CREATE TABLE IF NOT EXISTS execution_snapshots (
    execution_id TEXT PRIMARY KEY REFERENCES executions(id), observed_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS prices (
    id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL,
    effective_at TEXT NOT NULL, created_at TEXT NOT NULL, data_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS prices_lookup ON prices(provider, model, effective_at);
  CREATE TABLE IF NOT EXISTS observations (
    execution_id TEXT NOT NULL REFERENCES executions(id), id TEXT NOT NULL,
    model TEXT NOT NULL, provider TEXT NOT NULL, input REAL, output REAL,
    cache_read REAL, cache_write REAL, reasoning REAL, complete INTEGER NOT NULL,
    price_id TEXT, estimated_cost REAL, reported_cost REAL, data_json TEXT NOT NULL,
    PRIMARY KEY(execution_id, id)
  );
`;
