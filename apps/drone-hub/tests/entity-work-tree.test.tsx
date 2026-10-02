import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { EntityEvent, EntitySnapshot } from '@entity/core';
import { EntityWorkTree } from '../src/droneHub/entity/EntityWorkTree';

let seq = 0;
const ev = (t: number, type: string, by: string, data: Record<string, unknown> = {}): EntityEvent => ({ seq: ++seq, t, at: 1_790_000_000_000 + t, type, by, data });
type Limb = EntitySnapshot['limbs'][number];
const limb = (id: string, over: Partial<Limb> = {}): Limb => ({ id, kind: 'llm', role: 'task', name: id, status: 'running', runs: [], createdAt: 0, claims: [], ...over });

test('the Work tab leads finished requests with their outcome, lists what is running, and says what was asked and not started', () => {
  const breakdown = ev(1000, 'chat_message', 'user', { text: 'Give me a breakdown of the repo' });
  const polish = ev(2000, 'chat_message', 'user', { text: 'Keep polishing the README in rounds' });
  const events = [breakdown, polish];
  const snapshot = {
    status: 'idle', t: 200_000,
    limbs: [
      limb('head', { role: 'head' }),
      limb('worker-1', { name: 'Repo breakdown', status: 'done', createdAt: 1100, endedAt: 60_000, cause: { kind: 'user', seqs: [breakdown.seq] }, replyTo: breakdown.seq,
        result: 'A persistent multiplayer RTS: React client, one Bun server.', points: [{ label: 'Stack', text: 'TypeScript, React, Bun.' }, { label: 'Caveats', text: 'Docs lag the code.' }] }),
      limb('worker-2', { name: 'Recheck', createdAt: 150_000, cause: { kind: 'heartbeat' }, why: 'One file was missed; you did not ask.' }),
    ],
    asks: [
      { id: 'ask-1', kind: 'do', text: 'Break down the repo', seqs: [breakdown.seq], t: 1000, status: 'resolved', workers: ['worker-1'], resolved: { by: 'worker-1', t: 60_000 } },
      { id: 'ask-2', kind: 'do', text: 'Polish the README in rounds', seqs: [polish.seq], t: 2000, status: 'open', workers: [] },
    ],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0.4, unpriced: 0 },
  } as unknown as EntitySnapshot;
  const html = renderToStaticMarkup(<EntityWorkTree snapshot={snapshot} events={events} live={false} onWorker={() => undefined} />);
  expect(html).toContain('A persistent multiplayer RTS'); // the outcome leads
  expect(html).toContain('Stack'); // with its first points
  expect(html).toContain('Running now');
  expect(html).toContain('Started by the entity · One file was missed; you did not ask.');
  expect(html).toContain('Asked, not started');
  expect(html).toContain('Polish the README in rounds');
});
