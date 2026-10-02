import { expect, test } from 'bun:test';
import type { EntityEvent, EntitySnapshot } from '@entity/core';
import { deriveWork } from '../src/droneHub/entity/EntityWork';
import { deriveTree } from '../src/droneHub/entity/work-tree-model';

let seq = 0;
const ev = (t: number, type: string, by: string, data: Record<string, unknown> = {}): EntityEvent => ({ seq: ++seq, t, at: t, type, by, data });
type Limb = EntitySnapshot['limbs'][number];
type Ask = NonNullable<EntitySnapshot['asks']>[number];
const limb = (id: string, over: Partial<Limb> = {}): Limb => ({ id, kind: 'llm', role: 'task', name: id, status: 'running', runs: [], createdAt: 0, claims: [], ...over });
const ask = (id: string, seqs: number[], text: string, over: Partial<Ask> = {}): Ask => ({ id, kind: 'do', text, seqs, t: 0, status: 'open', workers: [], ...over });
const snap = (t: number, limbs: Limb[], asks: Ask[] = []) => ({ status: 'running', t, limbs: [limb('head', { role: 'head' }), ...limbs], asks }) as unknown as EntitySnapshot;
const tree = (s: EntitySnapshot, events: EntityEvent[]) => deriveTree(s, events, deriveWork(s, events).workers);

test('deriveTree: one request per thing asked; a batch stays together; work the entity started itself is its own request', () => {
  const m1 = ev(1000, 'chat_message', 'user', { text: 'audit the landing page, graphics and gameplay' });
  const m2 = ev(5000, 'chat_message', 'user', { text: 'what do you see?' });
  const events = [m1, ev(1100, 'group_started', 'head', { id: 'group-1', title: 'Frontier review' }), m2];
  const s = snap(100_000, [
    limb('worker-2', { name: 'Landing', group: 'group-1', createdAt: 1100, cause: { kind: 'user', seqs: [m1.seq] }, replyTo: m1.seq, status: 'done', result: 'Copy overpromises', points: [{ label: 'Honest copy', text: 'Remove the patrol claim.' }] }),
    limb('worker-3', { name: 'Graphics', group: 'group-1', createdAt: 1100, cause: { kind: 'user', seqs: [m1.seq] }, replyTo: m1.seq }),
    limb('worker-4', { name: 'Gameplay', group: 'group-1', createdAt: 1100, cause: { kind: 'user', seqs: [m1.seq] }, replyTo: m1.seq }),
    // Started on the head's own heartbeat: not credited to the latest message.
    limb('worker-9', { name: 'Recheck', createdAt: 60_000, cause: { kind: 'heartbeat' }, why: 'The audit missed one file; you did not ask.', replyTo: m2.seq }),
  ], [ask('ask-1', [m1.seq], 'Audit the landing page, graphics and gameplay', { workers: ['worker-2', 'worker-3', 'worker-4'] })]);
  const t = tree(s, events);
  expect(t.requests.map(r => [r.title, r.self, r.status, r.stages])).toEqual([
    ['Frontier review', false, 'running', [['worker-2', 'worker-3', 'worker-4']]],
    ['Recheck', true, 'running', [['worker-9']]],
  ]);
  expect(t.requests[0].asks.map(a => a.id)).toEqual(['ask-1']);
  expect(t.requests[0].words).toBe('audit the landing page, graphics and gameplay');
  expect(t.requests[1].why).toContain('you did not ask');
  expect(t.requests[0].workers.find(w => w.id === 'worker-2')!.points).toEqual([{ label: 'Honest copy', text: 'Remove the patrol claim.' }]);
  expect(t.running).toHaveLength(2);
});

test('deriveTree: waiting agents sit below what they wait for, and the one the rest led to is the outcome', () => {
  const m = ev(1000, 'chat_message', 'user', { text: 'plan the first three tickets' });
  const s = snap(100_000, [
    limb('w1', { name: 'Ownership fix', status: 'done', createdAt: 1100, endedAt: 2000, cause: { kind: 'user', seqs: [m.seq] } }),
    limb('w2', { name: 'Two-player tests', status: 'done', createdAt: 1100, endedAt: 3000, after: 'w1', cause: { kind: 'user', seqs: [m.seq] } }),
    limb('w3', { name: 'Release order', status: 'done', createdAt: 1100, endedAt: 4000, after: 'w2', result: 'Ship honest orders first.', cause: { kind: 'user', seqs: [m.seq] } }),
  ]);
  const [r] = tree(s, [m]).requests;
  expect(r.stages).toEqual([['w1'], ['w2'], ['w3']]);
  expect(r.status).toBe('done');
  expect(r.outcome?.id).toBe('w3');
  expect(r.title).toBe('plan the first three tickets');
});

test('deriveTree: a run that read two messages files its work under the ask it serves, and an ask nothing took shows as untaken', () => {
  const readme = ev(1000, 'chat_message', 'user', { text: 'keep polishing the README' });
  const audit = ev(2000, 'chat_message', 'user', { text: 'audit the docs' });
  const s = snap(100_000, [
    limb('w1', { name: 'Docs audit', createdAt: 2500, cause: { kind: 'user', seqs: [readme.seq, audit.seq] }, replyTo: audit.seq }),
  ], [
    ask('ask-1', [readme.seq], 'Polish the README in rounds', { t: 1000 }),
    ask('ask-2', [audit.seq], 'Audit the docs', { t: 2000, workers: ['w1'] }),
  ]);
  const t = tree(s, [readme, audit]);
  expect(t.requests.map(r => r.key)).toEqual([`msg:${audit.seq}`]);
  expect(t.untaken.map(a => a.text)).toEqual(['Polish the README in rounds']);
});

test('deriveTree: work that combines a batch sits below all of it, belongs with it even when started on the batch ending, and is the outcome', () => {
  const m = ev(1000, 'chat_message', 'user', { text: 'audit three areas, then one list' });
  const events = [m, ev(1100, 'group_started', 'head', { id: 'group-1', title: 'Audit' })];
  const area = (id: string) => limb(id, { group: 'group-1', status: 'done', createdAt: 1100, endedAt: 5000, cause: { kind: 'user', seqs: [m.seq] } });
  const s = snap(100_000, [area('a'), area('b'), area('c'),
    limb('combine', { name: 'Combined list', status: 'done', createdAt: 5100, endedAt: 9000, afterGroup: 'group-1', after: 'group-1', cause: { kind: 'batch' }, result: 'One list of 10.' })]);
  const [r] = tree(s, events).requests;
  expect(r.stages).toEqual([['a', 'b', 'c'], ['combine']]);
  expect(r.deps.combine).toEqual(['a', 'b', 'c']);
  expect(r.waitsOnBatch.combine).toBe('Audit');
  expect(r.outcome?.id).toBe('combine');
});

test('reportSection: a point opens the part of the report under its heading, down to the next heading at its level', async () => {
  const { reportSection, reportOf } = await import('../src/droneHub/entity/ReportPoints');
  const report = '# Audit\n\n## 1. Fix the public promise\nCopy advertises patrol.\n\n### Evidence\n`landing.tsx`\n\n## 2. Add a checklist\nSeedship first.\n';
  expect(reportSection(report, '1. Fix the public promise')).toBe('Copy advertises patrol.\n\n### Evidence\n`landing.tsx`');
  expect(reportSection(report, '§ 2. Add a checklist')).toBe('Seedship first.');
  expect(reportSection(report, 'Missing')).toBe('');
  expect(reportOf(['notes.txt', 'a.md', 'b.md'])).toBe('b.md');
});

test('reportSection: a point without a named section still finds a numbered heading by its label', async () => {
  const { reportSection } = await import('../src/droneHub/entity/ReportPoints');
  expect(reportSection('## 3. Honest copy\nRemove the patrol claim.\n## 4. Next\n', 'Honest copy')).toBe('Remove the patrol claim.');
});

test('pausesOf: running time leaves out pauses and the time the Hub was down before a restore', async () => {
  const { pausesOf } = await import('../src/droneHub/entity/work-tree-model');
  const events = [ev(166_000, 'session_paused', 'user'), ev(4_388_000, 'session_restored', 'system', { downtime_ms: 4_000_000 })];
  expect(pausesOf(events, 4_400_000)).toEqual([[166_000, 4_400_000]]);
  const crashed = [ev(100_000, 'session_restored', 'system', { downtime_ms: 60_000 }), ev(100_000, 'session_paused', 'system'), ev(130_000, 'session_resumed', 'user')];
  expect(pausesOf(crashed, 200_000)).toEqual([[40_000, 100_000], [100_000, 130_000]]);
});
