// Read-only comparison against an already migrated Hub database. Never prints chat contents.
// Usage: node apps/drone/scripts/benchmark-chat-reconciliation.cjs <hub.sqlite> <drone-id> [chat-name]
const Database = require('better-sqlite3');
const { ChatTranscriptRepository } = require('../dist/hub/transcript-store');
const [databasePath, droneId, chatName = 'default'] = process.argv.slice(2);
if (!databasePath || !droneId) throw new Error('Expected database path and drone ID');
const connection = new Database(databasePath, { readonly: true, fileMustExist: true });
try {
  // Bypass the constructor deliberately: this probe must never run migrations on live data.
  const repository = Object.create(ChatTranscriptRepository.prototype);
  repository.database = { read: (run) => run(connection) };
  const samples = [];
  for (let trial = 0; trial < 6; trial++) {
    for (const reconciliationOnly of trial % 2 ? [true, false] : [false, true]) {
      const started = performance.now();
      const result = repository.readRows({ droneId, chatName, indexes: [], includePending: true, reconciliationOnly });
      samples.push({ reconciliationOnly, durationMs: performance.now() - started,
        pendingCount: result.pending.length, relatedTurnCount: result.pendingTurns.length,
        // Size calculation intentionally lies outside the timed read.
        resultBytes: Buffer.byteLength(JSON.stringify(result)) });
    }
  }
  console.log(JSON.stringify({ samples }, null, 2));
} finally { connection.close(); }
