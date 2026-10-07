import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Database } from 'bun:sqlite';
import { UsageStore } from '../src/hub/usage/UsageStore';

// Claude Code's end-of-turn totals cover the whole session so far.
const total = (input: number, output: number, cacheRead: number, reportedCost: number) => ({
  id: 'model:claude-unpriced', model: 'claude-unpriced', provider: 'anthropic', sessionId: 's1', scope: 'tree' as const,
  complete: true, input, output, cacheRead, cacheWrite: 0, reasoning: null, reportedCost, raw: {},
});

function turns(store: UsageStore) {
  const at = (minutes: number) => new Date(Date.parse(store.trackingSince) + minutes * 60_000).toISOString();
  const run = (id: string, minutes: number, observation: ReturnType<typeof total>) => store.record(
    { id, chatId: 'c1', droneId: 'd1', chatName: 'Factory', agent: 'claude', startedAt: at(minutes), status: 'done' }, [observation]);
  run('t1', 1, total(100, 50, 1000, 2));
  run('t2', 2, total(130, 80, 1600, 3.5));
  // A new process counts from zero again: its totals are already its own.
  run('t3', 3, total(20, 10, 300, 0.25));
}

test('each Claude turn counts what it added to its session, and cards fall back to the reported cost', () => {
  const store = new UsageStore(':memory:');
  try {
    turns(store);
    const [row] = store.chatActivity({ droneId: 'd1' });
    // 2 + 1.5 + 0.25, with no price for the model: the cost Claude reported.
    expect(row.estimatedCost).toBeCloseTo(3.75, 6);
    expect(row.reported).toBe(3);
    expect(row.unpriced).toBe(0);
    expect(row.tokens).toBe(1150 + 660 + 330);
    // Replaying a turn's snapshot gives the same answer.
    store.record({ id: 't2', chatId: 'c1', droneId: 'd1', chatName: 'Factory', agent: 'claude',
      startedAt: new Date(Date.parse(store.trackingSince) + 2 * 60_000).toISOString(), status: 'done' }, [total(130, 80, 1600, 3.5)]);
    expect(store.chatActivity({ droneId: 'd1' })[0].estimatedCost).toBeCloseTo(3.75, 6);
  } finally { store.close(); }
});

test('session totals recorded before the fix are repaired once, oldest first', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-claude-')), 'usage.sqlite');
  const store = new UsageStore(file);
  turns(store);
  store.close();
  // Put the rows back as they were recorded before: whole-session totals, no running totals kept.
  const db = new Database(file);
  db.run(`UPDATE observations SET input=json_extract(data_json,'$.cumulative.input'), output=json_extract(data_json,'$.cumulative.output'),
    cache_read=json_extract(data_json,'$.cumulative.cacheRead'), reported_cost=json_extract(data_json,'$.cumulative.reportedCost'),
    data_json=json_remove(json_set(data_json,'$.input',json_extract(data_json,'$.cumulative.input'),'$.output',json_extract(data_json,'$.cumulative.output'),
      '$.cacheRead',json_extract(data_json,'$.cumulative.cacheRead'),'$.reportedCost',json_extract(data_json,'$.cumulative.reportedCost')),'$.cumulative')`);
  db.run(`DELETE FROM metadata WHERE key='claude_session_turn_deltas_v1'`);
  expect((db.query('SELECT SUM(reported_cost) AS c FROM observations').get() as any).c).toBeCloseTo(5.75, 6);
  db.close();
  const reopened = new UsageStore(file);
  try {
    expect(reopened.chatActivity({ droneId: 'd1' })[0].estimatedCost).toBeCloseTo(3.75, 6);
  } finally { reopened.close(); }
});

test('a copied chat counts only what it added to the session it forked', () => {
  const store = new UsageStore(':memory:');
  try {
    turns(store);
    const at = (minutes: number) => new Date(Date.parse(store.trackingSince) + minutes * 60_000).toISOString();
    const copy = (id: string, chatId: string, minutes: number, observation: ReturnType<typeof total>, forkedFromSessionId?: string) =>
      store.record({ id, chatId, droneId: 'd1', chatName: chatId, agent: 'claude', startedAt: at(minutes), status: 'done',
        ...(forkedFromSessionId ? { forkedFromSessionId } : {}) }, [observation]);
    const cost = (chatName: string) => store.chatActivity({ droneId: 'd1' }).find((row) => row.chatName === chatName)?.estimatedCost;
    // Forked after t2, the copy starts from s1's totals then: its turn added 0.75.
    copy('f1', 'Copy', 4, { ...total(140, 90, 1700, 4.25), sessionId: 's2' }, 's1');
    expect(cost('Copy')).toBeCloseTo(0.75, 6);
    // A later snapshot that no longer names the source keeps the subtraction; so does the copy's next turn.
    copy('f1', 'Copy', 4, { ...total(140, 90, 1700, 4.25), sessionId: 's2' });
    copy('f2', 'Copy', 5, { ...total(150, 95, 1800, 5), sessionId: 's2' });
    expect(cost('Copy')).toBeCloseTo(1.5, 6);
    // Copied from a checkpoint at t1, a fork starts from s1's totals as of t1, not its latest.
    copy('g1', 'Checkpoint', 6, { ...total(110, 60, 1100, 2.5), sessionId: 's3' }, 's1');
    expect(cost('Checkpoint')).toBeCloseTo(0.5, 6);
  } finally { store.close(); }
});
