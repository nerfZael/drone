const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { resetDroneRootDirForTests } = require('../../dist/host/paths');
const { resetHubDatabaseForTests } = require('../../dist/host/hub-database');
const {
  upsertChatInStore, readTranscriptTurnsFromStore, readChatRowsFromStore,
  resetTranscriptStoreForTests,
} = require('../../dist/hub/transcript-store');

test('transcript pages preserve ordering, projections and content across sparse and contiguous reads', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-transcript-pagination-'));
  const previous = process.env.DRONE_DATA_DIR;
  process.env.DRONE_DATA_DIR = root;
  resetDroneRootDirForTests();
  resetTranscriptStoreForTests();
  t.after(async () => {
    resetTranscriptStoreForTests();
    await resetHubDatabaseForTests();
    if (previous === undefined) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = previous;
    resetDroneRootDirForTests();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const chat = { droneId: 'pagination', chatName: 'default' };
  const turns = Array.from({ length: 425 }, (_, index) => {
    const at = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
    return {
      id: `turn-${index}`, at, promptAt: at, completedAt: at,
      prompt: `prompt ${index}`, ok: true, output: `${index}:` + 'output '.repeat(1000),
      activity: { version: 1, source: 'codex', updatedAt: at, messages: [], truncated: false },
    };
  });
  await upsertChatInStore({ ...chat, chatEntry: { createdAt: turns[0].at, turns: [...turns].reverse() } });
  const selections = [
    [], [0], [4, 5, 6], [424, 2, 0, 2, -1, 1.5, 900],
    Array.from({ length: 425 }, (_, i) => i),
    [...Array.from({ length: 400 }, (_, i) => i), 424],
  ];
  for (const activityMode of ['full', 'summary', 'none']) {
    for (const indexes of selections) {
      const expected = [...new Set(indexes.filter((i) => Number.isSafeInteger(i) && i >= 0 && i < turns.length))].sort((a, b) => a - b);
      const transcript = readTranscriptTurnsFromStore({ ...chat, indexes, activityMode });
      const rows = readChatRowsFromStore({ ...chat, indexes, activityMode, includePending: false });
      assert.equal(transcript.count, turns.length);
      assert.deepEqual(rows.turns, transcript.turns);
      assert.deepEqual(transcript.turns.map((row) => row.index), expected);
      for (const { index, turn } of transcript.turns) {
        assert.equal(turn.id, turns[index].id);
        assert.equal(turn.output, turns[index].output);
        if (activityMode === 'full') assert.ok(turn.activity);
        else assert.equal(turn.activity, undefined);
        if (activityMode === 'summary') assert.ok(turn.activitySummary);
        if (activityMode === 'none') assert.equal(turn.activitySummary, undefined);
      }
    }
  }
});
