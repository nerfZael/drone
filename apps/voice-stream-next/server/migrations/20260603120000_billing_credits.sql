CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  amount_microcredits INTEGER NOT NULL,
  balance_after_microcredits INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_created
  ON credit_ledger(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_actor_created
  ON credit_ledger(actor_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS billable_usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id TEXT REFERENCES assistant_threads(id) ON DELETE SET NULL,
  run_id TEXT REFERENCES assistant_runs(id) ON DELETE SET NULL,
  tool_call_id TEXT REFERENCES assistant_tool_calls(id) ON DELETE SET NULL,
  ledger_id TEXT REFERENCES credit_ledger(id) ON DELETE SET NULL,
  service TEXT NOT NULL,
  provider TEXT NOT NULL,
  credential_source TEXT NOT NULL,
  model TEXT,
  operation TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  unit_count INTEGER NOT NULL DEFAULT 0,
  vendor_cost_micros INTEGER NOT NULL DEFAULT 0,
  charged_microcredits INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_billable_usage_user_created
  ON billable_usage_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billable_usage_thread_created
  ON billable_usage_events(thread_id, created_at DESC);
