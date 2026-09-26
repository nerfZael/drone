import { expect, test } from 'bun:test';
import type { EntityEvent, EntitySnapshot } from '@entity/core';
import { deriveWork } from '../src/droneHub/entity/EntityWork';

let seq = 0;
const ev = (t: number, type: string, by: string, data: Record<string, unknown> = {}): EntityEvent => ({ seq: ++seq, t, at: t, type, by, data });
const limb = (id: string, over: Partial<EntitySnapshot['limbs'][number]> = {}): EntitySnapshot['limbs'][number] => ({
  id, kind: 'llm', role: 'task', name: id, status: 'running', runs: [], createdAt: 0, claims: [], ...over,
});

test('deriveWork: states, links, blocks, questions and spend come from the snapshot; the now line and summaries from the log', () => {
  const m1 = ev(1000, 'chat_message', 'user', { text: 'fix the test' });
  const m2 = ev(2000, 'chat_message', 'user', { text: 'do the same for signup' });
  const events: EntityEvent[] = [
    m1,
    ev(2500, 'limb_spawned', 'voice', { id: 'task-1', fork_of: null }),
    ev(3000, 'tool_called', 'task-1', { run: 'r1', name: 'edit_file', summary: 'src/a.ts' }),
    m2,
    ev(3100, 'limb_spawned', 'voice', { id: 'task-2', fork_of: 'task-1' }),
    ev(3200, 'tool_called', 'task-2', { run: 'r2', name: 'write_file', summary: 'src/b.ts' }),
    ev(3300, 'tool_done', 'task-2', { run: 'r2', name: 'write_file', ok: false, note: 'refused: "src/b.ts" is claimed by task-1 (writing) since 2.0s ago' }),
    ev(3400, 'chat_message', 'task-3', { text: 'date-fns or dayjs?', reply_to: m1.seq, question: true }),
    ev(3500, 'work_summary', 'system', { limb: 'task-1', done: ['found the bug'], doing: ['fixing a.ts'], next: ['run tests'] }),
    ev(3600, 'run_finished', 'task-4', { usage: { input: 1000, output: 200, cost: 0.12 } }),
  ];
  const snapshot = {
    status: 'running', t: 5000,
    limbs: [
      limb('head', { role: 'head', runs: [{ id: 'h', reason: 'claim conflict', startedAt: 4000 }] }),
      limb('task-1', { name: 'Login fix', runs: [{ id: 'r1', reason: 'task assigned', startedAt: 2500 }], replyTo: m1.seq, claims: ['src/a.ts'] }),
      limb('task-2', { runs: [{ id: 'r2', reason: 'forked', startedAt: 3100 }], replyTo: m2.seq, forkOf: 'task-1', blockedBy: { limb: 'task-1', path: 'src/b.ts' } }),
      limb('task-3', { replyTo: m1.seq, asking: 8 }),
      limb('task-4', { status: 'done', result: 'tests pass', endedAt: 3700, usage: { input: 1000, output: 200, cost: 0.12 } }),
      limb('task-5', { status: 'waiting', waitFor: 'task-1', after: 'task-1' }),
      limb('task-6', { runs: [{ id: 'r6', reason: 'task assigned', startedAt: 4500 }] }),
    ],
    usage: { input: 1000, output: 200, cost: 0.12 },
  } as unknown as EntitySnapshot;

  const { workers, head, costTotal } = deriveWork(snapshot, events);
  const w = Object.fromEntries(workers.map(x => [x.id, x]));
  expect(head?.reason).toBe('claim conflict');
  expect(w['task-1']).toMatchObject({ state: 'act', label: 'editing', claims: ['src/a.ts'] });
  expect(w['task-1'].now).toMatchObject({ verb: 'editing', object: 'src/a.ts' });
  expect(w['task-1'].replyTo).toBe(m1.seq);
  expect(w['task-1'].steps?.done).toEqual(['found the bug']);
  expect(w['task-2']).toMatchObject({ state: 'need', label: 'blocked', parent: 'task-1' });
  expect(w['task-3']).toMatchObject({ state: 'need', label: 'asking you' });
  expect(w['task-4']).toMatchObject({ state: 'done', cost: 0.12, durationMs: 3700 });
  // User-facing text names workers; ids stay for the runtime.
  expect(w['task-5']).toMatchObject({ state: 'wait', label: 'after Login fix' });
  expect(w['task-2']).toMatchObject({ blockedBy: 'task-1' });
  expect(w['task-2'].now?.object).toBe('"src/b.ts" is held by Login fix');
  expect(w['task-3'].now?.object).toBe('date-fns or dayjs?');
  expect(w['task-5'].after).toBe('task-1');
  expect(w['task-6']).toMatchObject({ state: 'think', label: 'thinking' });
  expect(costTotal).toBeCloseTo(0.12);
});
