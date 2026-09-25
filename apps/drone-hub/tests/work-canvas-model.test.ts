import { expect, test } from 'bun:test';
import type { EntityEvent, EntitySnapshot } from '@entity/core';
import { deriveCanvas, layoutCanvas, type FoldRow, type GroupNode, type WorkRow } from '../src/droneHub/entity/work-canvas-model';

let seq = 0;
const ev = (t: number, type: string, by: string, data: Record<string, unknown> = {}): EntityEvent => ({ seq: ++seq, t, at: t, type, by, data });
const limb = (id: string, over: Partial<EntitySnapshot['limbs'][number]> = {}): EntitySnapshot['limbs'][number] => ({
  id, kind: 'llm', role: 'task', name: id, status: 'running', runs: [], createdAt: 0, claims: [], ...over,
});
const snap = (t: number, limbs: EntitySnapshot['limbs']) => ({ status: 'running', t, limbs: [limb('head', { role: 'head' }), ...limbs] }) as unknown as EntitySnapshot;
const none = { openFolds: new Set<string>(), pinned: new Set<string>(), keepFinished: 0, keepMessages: 0 };

test('deriveCanvas: rows in time order, lineage columns, arrows, and folds for work and talk that need nothing', () => {
  const m1 = ev(1000, 'chat_message', 'user', { text: 'fix login' });
  const m2 = ev(2000, 'chat_message', 'user', { text: 'same for signup' });
  const m3 = ev(3000, 'chat_message', 'user', { text: 'thanks' });
  const m4 = ev(4000, 'chat_message', 'user', { text: 'bump the version' });
  const m5 = ev(5000, 'chat_message', 'user', { text: 'then write docs' });
  const events = [
    m1, ev(1100, 'limb_spawned', 'head', { id: 'task-1' }),
    m2, ev(2100, 'limb_spawned', 'head', { id: 'task-2', fork_of: 'task-1' }),
    m3, ev(3100, 'chat_message', 'head', { text: 'you are welcome' }),
    m4, ev(4100, 'limb_spawned', 'head', { id: 'task-3' }),
    m5, ev(5100, 'limb_spawned', 'head', { id: 'task-4', after: 'task-2' }),
    ev(6000, 'steered', 'user', { id: 'task-2', text: 'keep the old API' }),
  ];
  const snapshot = snap(200_000, [
    limb('task-1', { status: 'done', createdAt: 1100, endedAt: 10_000, replyTo: m1.seq }),
    limb('task-2', { createdAt: 2100, replyTo: m2.seq, runs: [{ id: 'r', reason: 'x', startedAt: 2100, voice: true }] }),
    limb('task-3', { status: 'done', createdAt: 4100, endedAt: 5000, replyTo: m4.seq }),
    limb('task-4', { createdAt: 5100, replyTo: m5.seq, waitFor: 'task-2' }),
  ]);
  const model = deriveCanvas(snapshot, events, none);
  const shape = model.rows.map(r => r.kind === 'work' ? `work ${r.key}` : `fold ${r.key} ${(r as FoldRow).finished}/${(r as FoldRow).messages}`);
  // task-1 finished long ago but stays: task-2, still running, was forked from it.
  expect(shape).toEqual([`work m${m1.seq}`, `work m${m2.seq}`, `fold m${m3.seq} 1/1`, `work m${m5.seq}`, `fold d${events[10].seq} 0/1`]);
  const cols = model.rows.filter((r): r is WorkRow => r.kind === 'work').map(r => r.stacks.map(s => `${s.id}@${s.col}`).join());
  expect(cols).toEqual(['task-1@0', 'task-2@1', 'task-4@2']);
  expect((model.rows[1] as WorkRow).line.tag).toBe('→ task-2 · fork of task-1');
  expect(model.edges.map(e => `${e.kind} ${e.from} ${e.to} ${e.released ?? ''}`)).toEqual(['fork card:task-1 card:task-2 ', 'wait card:task-2 card:task-4 false']);
  expect(model.shownAs.get('task-3')).toBe(`fold:m${m3.seq}`);
  expect(model.attention).toEqual([{ id: 'task-4', kind: 'wait', text: 'task-4 starts after task-2' }]);
  const fold = model.rows[2] as FoldRow;
  expect(fold.items.map(i => ('kind' in i ? `row ${i.key}` : `${i.text}: ${i.tag}`))).toEqual(['thanks: answered in chat', `row m${m4.seq}`]);

  // Opening the fold shows its work again; pinning finished work keeps it out of folds.
  expect(deriveCanvas(snapshot, events, { ...none, openFolds: new Set([`m${m3.seq}`]) }).shownAs.get('task-3')).toBe('card:task-3');
  expect(deriveCanvas(snapshot, events, { ...none, pinned: new Set(['task-3']) }).rows.map(r => r.kind)).toEqual(['work', 'work', 'fold', 'work', 'work', 'fold']);
  // By default the most recently finished work and messages stay in view.
  expect(deriveCanvas(snapshot, events, { openFolds: new Set(), pinned: new Set() }).rows.map(r => r.kind)).toEqual(['work', 'work', 'line', 'work', 'work', 'line']);
  // Finished only recently: not folded yet.
  expect(deriveCanvas({ ...snapshot, t: 30_000 }, events, none).shownAs.get('task-3')).toBe('card:task-3');
});

test('deriveCanvas: a batch is one group card; workers that need you also get their own card; queued work is counted', () => {
  const m1 = ev(1000, 'chat_message', 'user', { text: 'fix the open bugs' });
  const ids = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'];
  const events = [m1, ev(1050, 'group_started', 'head', { id: 'group-9', title: 'Open bugs', count: 6 }), ...ids.map((id, i) => ev(1100 + i, 'limb_spawned', 'head', { id, group: 'group-9' }))];
  const status = { b1: 'done', b2: 'done', b3: 'running', b4: 'running', b5: 'failed', b6: 'queued' } as const;
  const snapshot = snap(5000, ids.map((id, i) => limb(id, { status: status[id as keyof typeof status], group: 'group-9', replyTo: m1.seq, createdAt: 1100 + i, endedAt: status[id as keyof typeof status] === 'done' ? 3000 : undefined })));
  const model = deriveCanvas(snapshot, events, none);
  const row = model.rows[0] as WorkRow;
  expect(row.line.tag).toBe('→ 6 workers · Open bugs');
  expect(row.stacks.map(s => s.kind === 'group' ? `group ${s.title} ${s.members.length}` : `card ${s.id}`)).toEqual(['group Open bugs 6', 'card b5']);
  expect((row.stacks[0] as GroupNode).members.map(w => w.label)).toEqual(['done', 'done', 'idle', 'idle', 'failed', 'queued']);
  expect(model.shownAs.get('b3')).toBe('group:group-9');
  expect(model.shownAs.get('b5')).toBe('card:b5');
  expect(model.attention.map(a => a.text)).toEqual(['b5: failed', '1 queued']);

  // Four plain workers from one message group too, without a batch.
  const m2 = ev(6000, 'chat_message', 'user', { text: 'try four approaches' });
  const plain = ['p1', 'p2', 'p3', 'p4'];
  const model2 = deriveCanvas(snap(7000, plain.map(id => limb(id, { replyTo: m2.seq, createdAt: 6100 }))), [m2, ...plain.map(id => ev(6100, 'limb_spawned', 'head', { id }))], none);
  expect((model2.rows[0] as WorkRow).stacks.map(s => s.kind)).toEqual(['group']);

  // Past three pulled-out workers, the rest become one compact list.
  const m3 = ev(8000, 'chat_message', 'user', { text: 'fix ten' });
  const ten = Array.from({ length: 10 }, (_, i) => `f${i}`);
  const model3 = deriveCanvas(snap(9000, ten.map((id, i) => limb(id, { replyTo: m3.seq, createdAt: 8100, status: i < 5 ? 'failed' : 'running' }))), [m3, ...ten.map(id => ev(8100, 'limb_spawned', 'head', { id }))], none);
  const stacks = (model3.rows[0] as WorkRow).stacks;
  expect(stacks.map(s => s.kind)).toEqual(['group', 'card', 'card', 'card', 'more']);
  expect(stacks[4].kind === 'more' && stacks[4].items.map(w => w.id)).toEqual(['f3', 'f4']);
  expect(model3.shownAs.get('f4')).toBe(`more:${stacks[4].id}`);
});

test('layoutCanvas: rows stack in time order, columns follow lineage, and a row is as tall as its tallest column', () => {
  const m1 = ev(1000, 'chat_message', 'user', { text: 'a' });
  const m2 = ev(2000, 'chat_message', 'user', { text: 'b' });
  const events = [m1, ev(1100, 'limb_spawned', 'head', { id: 'task-1' }), m2, ev(2100, 'limb_spawned', 'head', { id: 'task-2', fork_of: 'task-1' }), ev(2200, 'limb_spawned', 'head', { id: 'task-3', fork_of: 'task-1' })];
  const snapshot = snap(3000, [limb('task-1', { replyTo: m1.seq, createdAt: 1100 }), limb('task-2', { replyTo: m2.seq, createdAt: 2100 }), limb('task-3', { replyTo: m2.seq, createdAt: 2200 })]);
  const layout = layoutCanvas(deriveCanvas(snapshot, events, none), id => (id.startsWith('card:') ? { w: 288, h: 100 } : { w: 236, h: 30 }));
  const at = Object.fromEntries(layout.placed.map(p => [p.id, [p.x, p.y]]));
  expect(at['card:task-1']).toEqual([268, 0]);
  expect(at[`line:m${m2.seq}`]).toEqual([0, 118]);
  expect(at['card:task-2']).toEqual([604, 118]);
  expect(at['card:task-3']).toEqual([604, 226]);
  expect(layout.rules).toEqual([109]);
  expect(layout.height).toBe(118 + 208 + 18);
});
