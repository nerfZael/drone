const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');
const { ChatTranscriptRepository } = require('../../dist/hub/transcript-store');

test('reconciliation skips completed sent payloads but preserves active and repairable prompts', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE prompts (sequence INTEGER, prompt_id TEXT, drone_id TEXT, chat_name TEXT,
      created_at TEXT, updated_at TEXT, state TEXT, prompt TEXT, payload_json TEXT, last_error TEXT);
      CREATE TABLE canonical_chat_turns (drone_id TEXT, chat_name TEXT, turn_id TEXT, at TEXT,
        prompt_at TEXT, completed_at TEXT, turn_json TEXT);`);
    const insert = db.prepare('INSERT INTO prompts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const turn = db.prepare('INSERT INTO canonical_chat_turns VALUES (?, ?, ?, ?, ?, ?, ?)');
    const at = '2026-09-07T20:51:00Z';
    insert.run(1, 'done', 'd', 'c', at, at, 'sent', 'done', '{"privateHistory":"' + 'x'.repeat(1_000_000) + '"}', null);
    insert.run(2, 'active', 'd', 'c', at, at, 'sent', 'active', '{"model":"model","fileChangesBaseline":{"kept":true}}', null);
    insert.run(3, 'repair', 'd', 'c', at, at, 'failed', 'repair', '{"attachments":["keep"]}', 'failure');
    insert.run(4, 'cancelled', 'd', 'c', at, at, 'cancelled', 'cancelled', '{}', null);
    // Invalid historical JSON proves reconciliation never reads/parses it.
    for (const id of ['done', 'repair']) turn.run('d', 'c', id, at, at, at, 'not-json');
    const repo = Object.create(ChatTranscriptRepository.prototype);
    repo.database = { read: (run) => run(db) };
    const rows = repo.readRows({ droneId: 'd', chatName: 'c', indexes: [], includePending: true, reconciliationOnly: true });
    assert.deepEqual(rows.pending.map((p) => p.id), ['active', 'repair']);
    assert.deepEqual(rows.pending[0].fileChangesBaseline, { kept: true });
    assert.deepEqual(rows.pending[1].attachments, ['keep']);
    assert.equal(rows.pendingTurns[0].id, 'repair');
    assert.equal(rows.pendingTurns[0].completedAt, at);
    assert.equal(rows.pendingTurns[0].output, '');
    assert.equal(db.prepare('SELECT length(payload_json) AS size FROM prompts WHERE prompt_id = ?').get('done').size, 1_000_021);
  } finally { db.close(); }
});
