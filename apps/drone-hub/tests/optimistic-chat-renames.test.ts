import { expect, test } from 'bun:test';
import {
  applyOptimisticChatRenames,
  pruneOptimisticChatRenames,
} from '../src/droneHub/app/optimistic-chat-renames';
import type { DroneSummary } from '../src/droneHub/types';

const drone = {
  id: 'alpha',
  chats: ['default', 'plan'],
  sideChats: [{ name: 'side-1', sourceChatName: 'plan', checkpointId: 'c1', agent: { kind: 'builtin' } }],
  chatCloneSources: { 'side-1': 'plan', 'plan copy': 'plan' },
  chatCreatedAt: { plan: '2026-09-23T10:00:00Z' },
  busyChats: ['plan'],
  draftChats: { plan: false },
} as unknown as DroneSummary;

test('a renamed chat shows under its new name everywhere the summary names it', () => {
  const renamed = applyOptimisticChatRenames(drone, { plan: 'plan b' });
  expect(renamed.chats).toEqual(['default', 'plan b']);
  expect(renamed.sideChats?.[0].sourceChatName).toBe('plan b');
  expect(renamed.chatCloneSources).toEqual({ 'side-1': 'plan b', 'plan copy': 'plan b' });
  expect(renamed.chatCreatedAt).toEqual({ 'plan b': '2026-09-23T10:00:00Z' });
  expect(renamed.busyChats).toEqual(['plan b']);
  expect(renamed.draftChats).toEqual({ 'plan b': false });
});

test('once the summary shows the rename it is used as is', () => {
  const caughtUp = { ...drone, chats: ['default', 'plan b'] } as DroneSummary;
  expect(applyOptimisticChatRenames(caughtUp, { plan: 'plan b' })).toBe(caughtUp);
  expect(pruneOptimisticChatRenames({ alpha: { plan: 'plan b' } }, [caughtUp])).toEqual({});
  // Still waiting: kept.
  const waiting = { alpha: { plan: 'plan b' } };
  expect(pruneOptimisticChatRenames(waiting, [drone])).toBe(waiting);
  // The drone is gone: dropped.
  expect(pruneOptimisticChatRenames(waiting, [])).toEqual({});
});
