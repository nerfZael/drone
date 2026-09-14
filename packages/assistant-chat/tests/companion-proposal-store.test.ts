import { expect, test } from 'bun:test';
import { CompanionProposalStore } from '../src/companion-proposal-store';

const doc = (name: string) => JSON.stringify({ version: 1, title: name, operations: [{ id: 'group', type: 'create_group', name }] });
const ok = { ok: true, operations: [{ id: 'group', type: 'create_group' as const, status: 'completed' as const }] };
function store() { let id = 0; return new CompanionProposalStore(() => `proposal-${++id}`); }

test('independent drafts retain IDs, revisions and originating repositories across selection changes', () => {
  const proposals = store();
  const a = proposals.create({ defaultRepoPath: '/a' }, 'session', 'A');
  const b = proposals.create({ defaultRepoPath: '/b' }, 'session', 'B');
  expect(a.path).not.toBe(b.path);
  proposals.patch(a.targetId, a.revision, doc('A revised'), () => ({ defaultRepoPath: '/wrong' }), 'other-session');
  proposals.patch(b.targetId, b.revision, doc('B'), () => ({ defaultRepoPath: '/wrong' }), 'other-session');
  expect(proposals.pending).toHaveLength(2);
  expect(proposals.ready(a.targetId, '1')).toMatchObject({ context: { defaultRepoPath: '/a' }, sessionId: 'session' });
  proposals.select(a.targetId);
  expect(proposals.read().targetId).toBe(a.targetId);
  expect(() => proposals.discard(a.targetId, '0')).toThrow('STALE_PROPOSAL_REVISION');
  proposals.discard(a.targetId, '1');
  expect(proposals.selectedId).toBe(b.targetId);
  expect(proposals.list().find(item => item.targetId === a.targetId)?.status).toBe('discarded');
  expect(() => proposals.begin(a.targetId, '1')).toThrow('PROPOSAL_DISCARDED');
});

test('execution is serialized while other drafts can still be edited and discarded', () => {
  const proposals = store();
  const a = proposals.create({ defaultRepoPath: '/a' }, 'session');
  const b = proposals.create({ defaultRepoPath: '/b' }, 'session');
  for (const item of [a, b]) proposals.patch(item.targetId, '0', doc(item.targetId), () => ({ defaultRepoPath: '' }), 'session');
  const running = proposals.begin(a.targetId, '1');
  expect(() => proposals.begin(b.targetId, '1')).toThrow('PROPOSAL_EXECUTION_IN_PROGRESS');
  expect(() => proposals.discard(a.targetId, '1')).toThrow('PROPOSAL_EXECUTION_IN_PROGRESS');
  proposals.patch(b.targetId, '1', doc('Revised B'), () => ({ defaultRepoPath: '' }), 'session');
  proposals.discard(b.targetId, '2');
  expect(proposals.finish(running, ok, true)).toBe(true);
  expect(proposals.history).toHaveLength(1);
  expect(() => proposals.begin(a.targetId, '1')).toThrow('PROPOSAL_ALREADY_EXECUTED');
});

test('failed proposals do not block corrections; discard retains actual execution history', () => {
  const proposals = store();
  const a = proposals.create({ defaultRepoPath: '/a' }, 'session');
  proposals.patch(a.targetId, '0', doc('Original'), () => ({ defaultRepoPath: '' }), 'session');
  const failed = { ok: false, operations: [{ id: 'group', type: 'create_group' as const, status: 'failed' as const, error: 'Unavailable' }] };
  proposals.finish(proposals.begin(a.targetId, '1'), failed, true);
  const b = proposals.create({ defaultRepoPath: '/a' }, 'session');
  proposals.patch(b.targetId, '0', doc('Correction'), () => ({ defaultRepoPath: '' }), 'session');
  proposals.discard(a.targetId, '1');
  proposals.finish(proposals.begin(b.targetId, '1'), ok, true);
  expect(proposals.history.map(item => item.execution)).toEqual([failed, ok]);
  expect(proposals.pending).toEqual([]);
});

test('late results cannot resurrect proposals after session cleanup', () => {
  const proposals = store();
  const a = proposals.create({ defaultRepoPath: '/a' }, 'session');
  proposals.patch(a.targetId, '0', doc('A'), () => ({ defaultRepoPath: '' }), 'session');
  const running = proposals.begin(a.targetId, '1');
  proposals.clear();
  expect(proposals.finish(running, ok, true)).toBe(false);
  expect(proposals.list()).toEqual([]);
  expect(proposals.history).toEqual([]);
});
