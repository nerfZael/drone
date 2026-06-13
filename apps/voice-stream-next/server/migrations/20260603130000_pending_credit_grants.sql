CREATE TABLE IF NOT EXISTS pending_credit_grants (
  id TEXT PRIMARY KEY,
  normalized_email TEXT NOT NULL,
  email TEXT NOT NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  amount_microcredits INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  metadata_json TEXT,
  claimed_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  claimed_ledger_id TEXT REFERENCES credit_ledger(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  claimed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_pending_credit_grants_email_unclaimed
  ON pending_credit_grants(normalized_email, claimed_at);

CREATE INDEX IF NOT EXISTS idx_pending_credit_grants_created
  ON pending_credit_grants(created_at DESC);
